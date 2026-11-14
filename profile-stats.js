/** Spielerportal V8B: resilient server-confirmed, identity-bound results.
 * The browser has READ access only. No endpoint accepts wins or scores.
 * Matches are booked atomically once per server-owned match ID.
 */
export function installProfileStats(app,{admin,getFirestore,isReady=()=>true,clock=()=>Date.now()}) {
  const MATCHES='verified_matches_v8', STATS='player_stats_v8', PROFILES='player_profiles_v1';
  const clean=(s,max=48)=>String(s??'').replace(/[<>\u0000-\u001f\u007f]/g,'').trim().slice(0,max);
  const validUid=x=>typeof x==='string' && /^[A-Za-z0-9_-]{8,128}$/.test(x);
  const db=()=>{if(!isReady())return null;try{return getFirestore()||null;}catch{return null;}};
  const count=n=>Number.isSafeInteger(n)&&n>=0?n:0;
  const safeScore=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e8?n:null;
  // Render owns only the temporary name cache. Every request still verifies
  // Firebase Auth with checkRevoked=true; this does NOT cache authorization.
  // Completed profiles are safe to cache for a minute because updates/initial
  // onboarding synchronously invalidate them in the profile API.
  const PROFILE_NAME_TTL_MS=60_000;
  const PROFILE_NAME_CACHE_MAX=1000;
  const identityProfiles=new Map();
  const identityCacheCounters={hits:0,sharedReads:0,documentReads:0,invalidations:0};
  function identityCacheStats(){
    // Aggregate RAM-only counters: no Firestore query, no user identifier.
    return {...identityCacheCounters,entries:identityProfiles.size,ttlMs:PROFILE_NAME_TTL_MS};
  }
  function invalidateIdentity(uid){
    if(validUid(uid)&&identityProfiles.delete(uid))identityCacheCounters.invalidations++;
  }
  function trimIdentityCache(now){
    if(identityProfiles.size<PROFILE_NAME_CACHE_MAX)return;
    for(const [uid,entry] of identityProfiles){
      if(entry.expires&&entry.expires<=now)identityProfiles.delete(uid);
    }
    if(identityProfiles.size>=PROFILE_NAME_CACHE_MAX)
      identityProfiles.delete(identityProfiles.keys().next().value);
  }
  async function identity(idToken){
    if(typeof idToken!=='string'||idToken.length<80||idToken.length>8000||!admin.apps.length||!isReady())return null;
    try{
      const decoded=await admin.auth().verifyIdToken(idToken,true);
      if(!validUid(decoded.uid))return null;
      const store=db();if(!store)return null;
      const uid=decoded.uid,now=clock();
      const cached=identityProfiles.get(uid);
      if(cached?.name&&cached.expires>now){
        identityCacheCounters.hits++;
        return {uid,name:cached.name};
      }
      if(cached?.pending){
        identityCacheCounters.sharedReads++;
        const name=await cached.pending;
        return name?{uid,name}:null;
      }
      // Singleflight: simultaneous SKYJO/Hub requests for one profile do
      // one Firestore document get(), not one get() per connected client call.
      identityCacheCounters.documentReads++;
      const pending=(async()=>{
        const snap=await store.collection(PROFILES).doc(uid).get();
        if(!snap.exists||snap.data()?.setupComplete===false)return null;
        return clean(snap.data()?.name,24)||'Spieler';
      })();
      const entry={pending};
      trimIdentityCache(now);
      identityProfiles.set(uid,entry);
      try{
        const name=await pending;
        // A profile edit can invalidate while the query is in flight.
        // The old query must never restore stale names to the cache.
        if(identityProfiles.get(uid)===entry){
          if(name)identityProfiles.set(uid,{name,expires:clock()+PROFILE_NAME_TTL_MS});
          else identityProfiles.delete(uid);
        }
        return name?{uid,name}:null;
      }catch{
        if(identityProfiles.get(uid)===entry)identityProfiles.delete(uid);
        return null;
      }
    }catch{return null;}
  }
  // Only trusted, internal server code calls book(); no public POST route exists.
  async function book({game,matchId,players,winnerUids=[],startedAt,finishedAt,reason='completed',scores={}}){
    if(!['barikade','kreuz'].includes(game))throw Error('GAME_NOT_VERIFIED');
    if(typeof matchId!=='string'||!(/^[A-Za-z0-9_-]{12,120}$/.test(matchId)))throw Error('MATCH_ID_INVALID');
    if(!Array.isArray(players)||players.length<2||players.length>6)throw Error('PLAYER_COUNT_INVALID');
    const unique=new Set();
    const roster=players.map(p=>{
      if(!validUid(p?.uid)||unique.has(p.uid))throw Error('SEATS_NOT_DISTINCT_AUTHENTICATED');
      unique.add(p.uid);return {uid:p.uid,name:clean(p.name,24)||'Spieler',seat:clean(p.seat,12)};
    });
    if(!Array.isArray(winnerUids)||!winnerUids.length||winnerUids.some(u=>!unique.has(u)))throw Error('WINNER_NOT_IN_MATCH');
    const winners=[...new Set(winnerUids)];
    // Match timestamps are created by the server; reject obviously corrupted restores.
    const tEnd=Number(finishedAt)||Date.now(),tStart=Number(startedAt)||tEnd;
    if(!Number.isSafeInteger(tStart)||!Number.isSafeInteger(tEnd)||
       tStart>tEnd||tStart<946684800000||tEnd>Date.now()+60000||tEnd-tStart>30*86400000)
      throw Error('DATE_INVALID');
    const matchScores={};
    if(scores&&typeof scores==='object'&&!Array.isArray(scores)){
      for(const p of roster){const s=safeScore(scores[p.seat]);if(s!==null)matchScores[p.seat]=s;}
    }
    const store=db();if(!store)throw Error('DATABASE_UNAVAILABLE');
    const ref=store.collection(MATCHES).doc(`${game}_${matchId}`);
    const statsRefs=roster.map(p=>store.collection(STATS).doc(p.uid));
    const histories=roster.map(p=>store.collection('player_match_history_v8').doc(p.uid).collection('matches').doc(`${game}_${matchId}`));
    const item={game,matchId,players:roster,winnerUids:winners,startedAt:tStart,finishedAt:tEnd,durationMs:Math.max(0,tEnd-tStart),reason:clean(reason,32),scores:matchScores,createdAt:Date.now()};
    return store.runTransaction(async tx=>{
      // Read ALL transaction documents before attempting any write.
      const old=await tx.get(ref);
      if(old.exists){
        const prior=old.data()||{};
        const samePlayers=Array.isArray(prior.players)&&prior.players.length===roster.length&&
          roster.every(p=>prior.players.some(q=>q.uid===p.uid&&q.seat===p.seat));
        const sameWinners=Array.isArray(prior.winnerUids)&&prior.winnerUids.length===winners.length&&
          winners.every(uid=>prior.winnerUids.includes(uid));
        // Never silently consider contradictory data a valid duplicate.
        if(prior.game!==game||prior.matchId!==matchId||!samePlayers||!sameWinners)
          throw Error('MATCH_ID_COLLISION');
        return {ok:true,duplicate:true};
      }
      const existing=[];for(const sr of statsRefs)existing.push(await tx.get(sr));
      // Barikade and KreuzKunter keep their match statistics but earn no DOG chests.
      tx.create(ref,item);
      roster.forEach((p,i)=>{
        const win=winners.includes(p.uid),draw=winners.length>1;
        const prev=existing[i].exists?existing[i].data():{};
        const by=prev?.byGame&&typeof prev.byGame==='object'?{...prev.byGame}:{};
        const prior=by[game]||{};
        const delta={games:1,wins:win&&!draw?1:0,losses:!win?1:0,draws:draw&&win?1:0};
        by[game]={games:count(prior.games)+1,wins:count(prior.wins)+delta.wins,losses:count(prior.losses)+delta.losses,draws:count(prior.draws)+delta.draws};
        tx.set(statsRefs[i],{uid:p.uid,games:count(prev.games)+1,wins:count(prev.wins)+delta.wins,losses:count(prev.losses)+delta.losses,draws:count(prev.draws)+delta.draws,byGame:by,updatedAt:tEnd});
        tx.create(histories[i],{game,matchId,finishedAt:tEnd,durationMs:item.durationMs,place:win?(draw?'draw':'win'):'loss',score:matchScores[p.seat]??null,players:roster.map(({uid,name,seat})=>({uid,name,seat})),winnerUids:winners});
      });
      return {ok:true,duplicate:false};
    });
  }
  // This route relies on installProfileApi's /api/profile bearer-token middleware.
  app.get('/api/profile/stats',async(req,res)=>{
    if(!validUid(req.profileUid))return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
    const store=db();if(!store)return res.status(503).json({ok:false,error:'DATABASE_UNAVAILABLE'});
    try{
      const ref=store.collection(STATS).doc(req.profileUid);
      const [snap,history]=await Promise.all([ref.get(),store.collection('player_match_history_v8').doc(req.profileUid).collection('matches').orderBy('finishedAt','desc').limit(12).get()]);
      const d=snap.exists?snap.data():{};
      const byGame={};for(const game of ['barikade','kreuz']){
        const g=d.byGame?.[game];if(g)byGame[game]={games:count(g.games),wins:count(g.wins),losses:count(g.losses),draws:count(g.draws)};
      }
      // Return only the logged-in player's match history; do not expose other players' Firebase UIDs.
      const matches=history.docs.map(x=>{const m=x.data();return {
        game:m.game,matchId:m.matchId,finishedAt:m.finishedAt,durationMs:m.durationMs,
        place:m.place,score:m.score??null
      };});
      return res.json({ok:true,stats:{games:count(d.games),wins:count(d.wins),losses:count(d.losses),draws:count(d.draws),byGame},matches,verifiedGames:['barikade','kreuz'],pendingGames:['skyjo','business']});
    }catch(e){console.error('[profile/stats]',e?.message||e);return res.status(500).json({ok:false,error:'STATS_READ_FAILED'});}
  });
  return {identity,invalidateIdentity,identityCacheStats,book};
}
