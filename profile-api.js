/** Spielerportal V8: server-confirmed, identity-bound match results.
 * The browser has READ access only. No endpoint accepts wins or scores.
 * Matches are booked atomically once per server-owned match ID.
 */
export function installProfileStats(app,{admin,getFirestore,isReady=()=>true}) {
  const MATCHES='verified_matches_v8', STATS='player_stats_v8', PROFILES='player_profiles_v1';
  const clean=(s,max=48)=>String(s??'').replace(/[<>\u0000-\u001f\u007f]/g,'').trim().slice(0,max);
  const validUid=x=>typeof x==='string' && /^[A-Za-z0-9_-]{8,128}$/.test(x);
  const db=()=>{if(!isReady())return null;try{return getFirestore()||null;}catch{return null;}};
  async function identity(idToken){
    if(typeof idToken!=='string'||idToken.length<80||idToken.length>8000||!admin.apps.length||!isReady())return null;
    try{
      const decoded=await admin.auth().verifyIdToken(idToken,true);
      if(!validUid(decoded.uid))return null;
      const store=db();if(!store)return null;
      const p=await store.collection(PROFILES).doc(decoded.uid).get();
      if(!p.exists||p.data()?.setupComplete===false)return null;
      return {uid:decoded.uid,name:clean(p.data()?.name,24)||'Spieler'};
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
    const tEnd=Number(finishedAt)||Date.now(),tStart=Number(startedAt)||tEnd;
    if(tStart>tEnd||tStart<946684800000||tEnd>Date.now()+60000)throw Error('DATE_INVALID');
    const store=db();if(!store)throw Error('DATABASE_UNAVAILABLE');
    const ref=store.collection(MATCHES).doc(`${game}_${matchId}`);
    const statsRefs=roster.map(p=>store.collection(STATS).doc(p.uid));
    const histories=roster.map(p=>store.collection('player_match_history_v8').doc(p.uid).collection('matches').doc(`${game}_${matchId}`));
    const item={game,matchId,players:roster,winnerUids:winners,startedAt:tStart,finishedAt:tEnd,durationMs:Math.max(0,tEnd-tStart),reason:clean(reason,32),scores,createdAt:Date.now()};
    return store.runTransaction(async tx=>{
      // Read ALL transaction documents before attempting any write.
      const old=await tx.get(ref);
      if(old.exists)return {ok:true,duplicate:true};
      const existing=[];for(const sr of statsRefs)existing.push(await tx.get(sr));
      tx.create(ref,item);
      roster.forEach((p,i)=>{
        const win=winners.includes(p.uid),draw=winners.length>1;
        const prev=existing[i].exists?existing[i].data():{};
        const by=prev?.byGame&&typeof prev.byGame==='object'?{...prev.byGame}:{};
        const prior=by[game]||{};
        const delta={games:1,wins:win&&!draw?1:0,losses:!win?1:0,draws:draw&&win?1:0};
        by[game]={games:(Number(prior.games)||0)+1,wins:(Number(prior.wins)||0)+delta.wins,losses:(Number(prior.losses)||0)+delta.losses,draws:(Number(prior.draws)||0)+delta.draws};
        tx.set(statsRefs[i],{uid:p.uid,games:(Number(prev.games)||0)+1,wins:(Number(prev.wins)||0)+delta.wins,losses:(Number(prev.losses)||0)+delta.losses,draws:(Number(prev.draws)||0)+delta.draws,byGame:by,updatedAt:tEnd});
        tx.create(histories[i],{game,matchId,finishedAt:tEnd,durationMs:item.durationMs,place:win?(draw?'draw':'win'):'loss',score:Number.isFinite(scores[p.seat])?scores[p.seat]:null,players:roster.map(({uid,name,seat})=>({uid,name,seat})),winnerUids:winners});
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
      return res.json({ok:true,stats:{games:Number(d.games)||0,wins:Number(d.wins)||0,losses:Number(d.losses)||0,draws:Number(d.draws)||0,byGame:d.byGame||{}},matches:history.docs.map(x=>x.data()),verifiedGames:['barikade','kreuz'],pendingGames:['skyjo','business']});
    }catch(e){console.error('[profile/stats]',e?.message||e);return res.status(500).json({ok:false,error:'STATS_READ_FAILED'});}
  });
  return {identity,book};
}
