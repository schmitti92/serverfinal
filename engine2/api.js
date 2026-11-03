/** Shared MiniGame Engine 2.0 HTTP adapter.
 * One authenticated identity, one generic room collection and a pluggable game rule module.
 * Isolated from the existing lobby and legacy engines.
 */
import {randomInt,randomUUID} from 'node:crypto';
import {createRoom,dispatch,project} from './MiniGameEngine2.js';
import {createGame,chooseDoor,revealNext,botAction,getResult,publicGame} from './games/drei-schatzkammern/rules.js';
const COLLECTION='minigame_engine2_rooms_v1';
const GAME='drei-schatzkammern';
const bad=(status,code)=>Object.assign(new Error(code),{status});
const CODE=/^[A-HJ-NP-Z2-9]{6}$/;
const letters='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code=()=>Array.from({length:6},()=>letters[randomInt(letters.length)]).join('');
export function installEngine2Api(app,{verifyProfile,getFirestore}){
 const db=()=>getFirestore();
 const ref=(store,id)=>store.collection(COLLECTION).doc(id);
 async function identity(req,res,next){
  try{
   const token=/^Bearer (\\S+)$/i.exec(String(req.get('authorization')||''))?.[1];
   if(!token)throw bad(401,'LOGIN_REQUIRED');
   const user=await verifyProfile(token);
   if(!user?.uid)throw bad(401,'PROFILE_REQUIRED');
   req.engine2User={id:user.uid,name:String(user.name||'Spieler').slice(0,32)};
   if(!db())throw bad(503,'DATABASE_UNAVAILABLE');
   next();
  }catch(e){res.status(e.status||401).json({ok:false,error:e.message||'LOGIN_REQUIRED'});}
 }
 const output=(room,id)=>({ok:true,room:project(room.engine,id),game:room.game?{...publicGame(room.game,id),lastReveal:room.lastReveal||null}:null,gameId:room.engine.match?.gameId||null});
 async function transact(roomId,actor,fn){
  if(!CODE.test(roomId))throw bad(400,'INVALID_ROOM_CODE');
  return db().runTransaction(async t=>{
   const document=ref(db(),roomId),snap=await t.get(document);
   if(!snap.exists)throw bad(404,'ROOM_NOT_FOUND');
   const current=snap.data();
   if(current.engine.closed)throw bad(410,'ROOM_CLOSED');
   const next=fn(current);
   t.set(document,next);
   return output(next,actor);
  });
 }
 const wrap=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(e){res.status(e.status||409).json({ok:false,error:e.message||'ENGINE2_ERROR'});}};
 const cmd=(room,type,actor,extra={})=>{
  const result=dispatch(room.engine,{type,actorId:actor,commandId:randomUUID(),expectedRevision:room.engine.revision,now:Date.now(),...extra});
  room.engine=result.state;
 };
 app.post('/api/engine2/rooms',identity,wrap(async req=>{
  const count=Number(req.body?.bots??0);
  if(!Number.isInteger(count)||count<0||count>3)throw bad(400,'INVALID_BOTS');
  const actor=req.engine2User;
  for(let tries=0;tries<8;tries++){
   const id=code(),document=ref(db(),id);
   const result=await db().runTransaction(async t=>{
    const snap=await t.get(document);if(snap.exists)return null;
    const room={engine:createRoom({roomId:id,hostId:actor.id,hostName:actor.name,botPreset:count,now:Date.now()}),game:null};
    t.create(document,room);return output(room,actor.id);
   });
   if(result)return result;
  }
  throw bad(503,'ROOM_CODE_EXHAUSTED');
 }));
 app.post('/api/engine2/rooms/:code/join',identity,wrap(async req=>{
  const actor=req.engine2User;
  return transact(req.params.code,actor.id,room=>{
   if(room.engine.match&&!['finished','invalid','aborted'].includes(room.engine.match.phase))throw bad(409,'MATCH_ALREADY_ACTIVE');
   if(!room.engine.members.some(p=>p.id===actor.id))cmd(room,'join',actor.id,{name:actor.name});
   return room;
  });
 }));
 app.get('/api/engine2/rooms/:code',identity,wrap(async req=>{
  const id=req.params.code.toUpperCase();
  if(!CODE.test(id))throw bad(400,'INVALID_ROOM_CODE');
  const snap=await ref(db(),id).get();
  if(!snap.exists)throw bad(404,'ROOM_NOT_FOUND');
  const room=snap.data();
  if(!room.engine.members.some(p=>p.id===req.engine2User.id))throw bad(403,'NOT_A_MEMBER');
  return output(room,req.engine2User.id);
 }));
 app.post('/api/engine2/rooms/:code/prepare',identity,wrap(async req=>{
  const actor=req.engine2User.id;
  return transact(req.params.code,actor,room=>{
   if(room.engine.hostId!==actor)throw bad(403,'HOST_ONLY');
   cmd(room,'prepare',actor,{matchId:randomUUID(),gameId:GAME});
   room.game=createGame({players:room.engine.match.roster,lockedDoors:Array.from({length:3},()=>randomInt(3))});room.lastReveal=null;
   return room;
  });
 }));
 app.post('/api/engine2/rooms/:code/ready',identity,wrap(async req=>{
  const actor=req.engine2User.id;
  return transact(req.params.code,actor,room=>{
   cmd(room,'ready',actor);
   if(room.engine.match.phase==='countdown')cmd(room,'tick',room.engine.hostId,{now:room.engine.match.startedAt});
   return room;
  });
 }));
 app.post('/api/engine2/rooms/:code/choose',identity,wrap(async req=>{
  const actor=req.engine2User.id,door=req.body?.door;
  return transact(req.params.code,actor,room=>{
   if(room.engine.match?.phase!=='playing'||!room.game)throw bad(409,'NOT_PLAYING');
   if(!room.engine.match.roster.includes(actor))throw bad(403,'NOT_SELECTED');
   room.game=chooseDoor(room.game,actor,door);
   for(const bot of room.game.alive.filter(id=>id.startsWith('bot:')&&!Object.hasOwn(room.game.choices,id))){
    const choice=botAction(room.game,bot,room.game.round+room.engine.revision);
    room.game=chooseDoor(room.game,bot,choice.door);
   }
   if(room.game.phase==='revealing'){
    const round=room.game.round,roundChoices={...room.game.choices};
    while(room.game.phase==='revealing')room.game=revealNext(room.game);
    room.lastReveal={round:round+1,doors:room.game.reveals.length?room.game.reveals:room.game.lockedDoors[round]===undefined?[]:[0,1,2].map(door=>({door,locked:door===room.game.lockedDoors[round],visitors:Object.entries(roundChoices).filter(([,chosen])=>chosen===door).map(([id])=>id)}))};
    if(room.game.finished){
     const result=getResult(room.game);
     for(const id of room.engine.match.roster)cmd(room,'submit-result',id,{verified:true,score:result.winnerIds.includes(id)?1:0});
    }
   }
   return room;
  });
 }));
 app.post('/api/engine2/rooms/:code/close',identity,wrap(async req=>{
  const actor=req.engine2User.id;
  return transact(req.params.code,actor,room=>{cmd(room,'close',actor);return room;});
 }));
}
