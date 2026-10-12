/** Protected hub-only Business room state. Legacy Business games are unchanged.
 * Beta: authenticates account, match and active seat. Does not validate financial rules.
 */
const MATCH_CODE=/^D[A-HJ-NP-Z2-9]{9}$/;
const COLL='spielesammlung_hub_business_v1';
const err=(status,message)=>Object.assign(new Error(message),{status});
const safeName=s=>String(s||'').trim().replace(/\s+/g,' ').slice(0,18);
function roster(game){return Array.isArray(game?.players)?game.players.map(p=>safeName(p?.name)):[];}
function validRoster(game,seat){
 const names=roster(game),allowed=seat.members.map(m=>m.name);
 return names.length===allowed.length&&names.every((n,i)=>n===allowed[i]);
}
function basicGame(game,seat){
 return !!game&&typeof game==='object'&&!Array.isArray(game)&&validRoster(game,seat)&&
   game.targetRounds===seat.settings.rounds&&Number.isInteger(game.current)&&game.current>=0&&game.current<seat.members.length&&
   Number.isInteger(game.turnNumber)&&game.turnNumber>=1&&Number.isFinite(game.bank)&&
   game.gameEnded===false&&Array.isArray(game.market)&&Array.isArray(game.deck);
}
export function installHubBusiness(app,{verifyProfile,getSeat,getFirestore}){
 const db=()=>{try{return getFirestore()||null;}catch{return null;}};
 async function authorize(req){
   const code=String(req.params.gameCode||'');if(!MATCH_CODE.test(code))throw err(400,'INVALID_MATCH_CODE');
   const token=/^Bearer (\S+)$/i.exec(String(req.get('authorization')||''))?.[1];
   if(!token)throw err(401,'LOGIN_REQUIRED');
   const profile=await verifyProfile(token);if(!profile?.uid)throw err(401,'LOGIN_REQUIRED');
   const seat=await getSeat(code,profile);
   if(seat?.error)throw err(seat.error==='DATABASE_UNAVAILABLE'?503:403,seat.error);
   if(!seat?.members?.some(m=>m.uid===profile.uid))throw err(403,'NOT_A_PARTICIPANT');
   return seat;
 }
 const wrap=fn=>async(req,res)=>{
   try{const seat=await authorize(req);const store=db();if(!store)throw err(503,'DATABASE_UNAVAILABLE');
     return res.status(200).json({ok:true,...await fn(req,seat,store)});
   }catch(e){if((e?.status||500)>=500)console.error('[hub/business]',e?.message||e);
     return res.status(e?.status||500).json({ok:false,error:e?.status?e.message:'SERVER_ERROR'});}
 };
 const ref=(db,seat)=>db.collection(COLL).doc(seat.gameCode);
 const result=(snap,seat)=>{
   const d=snap.exists?snap.data():null;
   if(d&&d.matchId!==seat.matchId)throw err(409,'WRONG_MATCH');
   return d;
 };
 const publicView=(d,seat,rev)=>({found:!!d,code:seat.gameCode,rev:d?.rev||0,
   phase:d?.phase||'waiting',hostName:seat.members.find(m=>m.uid===seat.hostUid)?.name||'',
   players:seat.members.map(m=>({name:m.name,host:m.uid===seat.hostUid,online:false})),
   settings:seat.settings,myName:seat.name,host:seat.host,matchId:seat.matchId,
   ...(rev!==undefined&&rev===d?.rev?{unchanged:true}:{game:d?.game||null})});
 app.get('/api/hub/business/:gameCode',wrap(async(req,seat,store)=>{
   const d=result(await ref(store,seat).get(),seat);
   const rev=/^\d+$/.test(String(req.query?.rev||''))?Number(req.query.rev):undefined;
   return publicView(d,seat,rev);
 }));
 app.post('/api/hub/business/:gameCode/bootstrap',wrap(async(req,seat,store)=>{
   if(!seat.host)throw err(403,'HOST_ONLY');
   if(req.body?.matchId!==seat.matchId)throw err(409,'WRONG_MATCH');
   if(!basicGame(req.body.game,seat)||req.body.game.turnNumber!==1)throw err(400,'INVALID_INITIAL_GAME');
   const doc=ref(store,seat);
   const data=await store.runTransaction(async tx=>{
     const cur=result(await tx.get(doc),seat);
     if(cur)return cur; // Only one init wins; never overwrite an existing match
     const value={matchId:seat.matchId,code:seat.gameCode,rev:1,phase:'game',game:req.body.game,updatedAtMs:Date.now()};
     tx.set(doc,value);return value;
   });
   return publicView(data,seat);
 }));
 app.post('/api/hub/business/:gameCode/state',wrap(async(req,seat,store)=>{
   const baseRev=req.body?.baseRev,incoming=req.body?.game;
   if(!Number.isInteger(baseRev)||baseRev<1)throw err(400,'INVALID_REVISION');
   const doc=ref(store,seat);
   return await store.runTransaction(async tx=>{
     const old=result(await tx.get(doc),seat);
     if(!old)throw err(404,'NO_GAME');
     if(old.phase!=='game')throw err(409,'GAME_ALREADY_FINISHED');
     if(old.rev!==baseRev)throw err(409,'REVISION_CONFLICT');
     const current=old.game;
     if(current?.players?.[current.current]?.name!==seat.name)throw err(403,'NOT_YOUR_TURN');
     if(!incoming||!validRoster(incoming,seat)||incoming.targetRounds!==seat.settings.rounds||
       !Number.isInteger(incoming.turnNumber)||incoming.turnNumber<current.turnNumber||incoming.turnNumber>current.turnNumber+1||
       !Number.isInteger(incoming.current)||incoming.current<0||incoming.current>=seat.members.length||
       typeof incoming.gameEnded!=='boolean'||!Number.isFinite(incoming.bank))throw err(400,'INVALID_GAME_STATE');
     // No official rank rewards; the browser is still responsible for game mathematics.
     const next={...old,rev:old.rev+1,phase:incoming.gameEnded?'finished':'game',game:incoming,updatedAtMs:Date.now()};
     tx.set(doc,next);return {code:seat.gameCode,rev:next.rev,phase:next.phase,updatedAtMs:next.updatedAtMs};
   });
 }));
 async function isFinished(match){
   if(match?.game!=='business')return false;
   const store=db();if(!store)return false;
   const snap=await store.collection(COLL).doc(match.gameCode).get();
   const doc=snap.exists?snap.data():null;
   return doc?.matchId===match.id&&doc?.phase==='finished'&&doc?.game?.gameEnded===true;
 }
 return {isFinished};
}
