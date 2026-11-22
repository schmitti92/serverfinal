/**
 * P6: isolated opt-in HTTP entry for TEST-ONLY PostgreSQL DOG rooms.
 *
 * The public shared /api/hub/rooms and /hub socket routes are NEVER
 * intercepted, patched or mirrored. A missing feature flag does not
 * open a PG connection and does not install action/read routes.
 *
 * For real pilot trials, a separately authorized service must seed a
 * private P-prefix SQL room. This API intentionally offers NO client
 * room-creation endpoint and NO migration of existing 3-digit DOG rooms.
 */
import {createDogPostgresPilotCoordinator} from './dog-postgres-pilot-coordinator.js';

const ROUTE='/api/hub/dog/pg-pilot';
const BEARER=/^Bearer (\S+)$/i;
const errorStatus=code=>{
 if(code==='DOG_PG_LOGIN_REQUIRED')return 401;
 if(code==='DOG_PG_PILOT_ONLY'||code==='DOG_PG_PILOT_BAD_ACTION')return 400;
 if(code==='DOG_PG_ROOM_NOT_AVAILABLE'||code==='DOG_PG_WRONG_MATCH')return 404;
 if(code==='DOG_PG_PAYOUT_PENDING')return 503;
 if(/^DOG_(?:STORAGE|PG)_[A-Z_]*(?:STALE|CONFLICT|COLLISION|PENDING|UNAVAILABLE)/.test(code))
  return 409;
 return 503;
};
function codeOf(err){
 const code=String(err?.code||err?.message||'');
 return /^DOG_[A-Z0-9_]{5,90}$/.test(code)?
  code:'DOG_PG_PILOT_UNAVAILABLE';
}
function respondFailure(res,err){
 const code=codeOf(err);
 if(code==='DOG_PG_PAYOUT_PENDING')res.set?.('Retry-After','2');
 return res.status(errorStatus(code)).json({ok:false,error:code});
}
function bearer(req){
 const raw=String(req.get?.('authorization')||'');
 const token=BEARER.exec(raw)?.[1];
 if(!token||token.length>12000)return null;
 return token;
}
export function installDogPostgresPilotHttp(app,{
 enabled=false,getPool,verifyProfile,getFirestore,
 coordinatorFactory=createDogPostgresPilotCoordinator,
 clock=Date.now
}={}){
 if(!app||typeof app.get!=='function'||typeof app.post!=='function')
  throw new TypeError('Explicit Express app required');
 // No credentials, database identifiers, room codes, Firebase project IDs
 // or player information should ever appear in public diagnostic responses.
 app.get(ROUTE+'/status',(_req,res)=>res.json({
  ok:true,enabled:enabled===true,
  scope:'isolated-test-only-pg-dog-rooms',
  publicLobby:'firestore-unchanged'
 }));
 if(enabled!==true)
  return {enabled:false};
 if(typeof getPool!=='function'||typeof verifyProfile!=='function'||
    typeof getFirestore!=='function'||typeof coordinatorFactory!=='function'||
    typeof clock!=='function')
  throw new TypeError('Pilot requires explicit verified Firebase and durable PG providers');

 let connection=null;
 async function coordinator(){
  if(connection)return connection;
  const starting=(async()=>{
   const pool=await getPool();
   if(!pool||typeof pool.query!=='function'||typeof pool.connect!=='function')
    throw Error('DOG_PG_PILOT_INVALID_POOL');
   // Fail closed when the required durable journal or completion proof
   // migrations were not installed. Never downgrade to RAM or Firebase.
   const check=await pool.query(
    "SELECT to_regclass('dog_room_states') AS room,"+
    "to_regclass('dog_room_pending_rewards') AS rewards,"+
    "to_regclass('dog_room_reward_completions') AS completions"
   );
   const row=check.rows?.[0];
   if(!row?.room||!row?.rewards||!row?.completions)
    throw Error('DOG_PG_PILOT_SCHEMA_MISSING');
   return coordinatorFactory({pool,verifyProfile,getFirestore,clock});
  })();
  connection=starting;
  try{return await starting}
  catch(e){if(connection===starting)connection=null;throw e}
 }
 const invoke=operation=>async(req,res)=>{
  const token=bearer(req);
  if(!token)return res.status(401).json({ok:false,error:'DOG_PG_LOGIN_REQUIRED'});
  // P-prefix code is NEVER a normal 3-digit/6-letter legacy room route.
  // Reject before touching PG or Firebase.
  const code=String(req.params?.code||'');
  if(!/^P[A-HJ-NP-Z2-9]{5}$/.test(code))
   return res.status(400).json({ok:false,error:'DOG_PG_PILOT_ONLY'});
  try{
   const runtime=await coordinator();
   const result=await operation(runtime,req,token,code);
   return res.json({ok:true,...result});
  }catch(e){return respondFailure(res,e)}
 };
 app.get(ROUTE+'/rooms/:code',invoke((pilot,_req,token,code)=>
  pilot.read({token,code})));
 app.post(ROUTE+'/rooms/:code/action',invoke((pilot,req,token,code)=>{
  const body=req.body||{};
  return pilot.move({
   token,code,
   matchId:body.matchId,
   expectedDogRevision:body.expectedDogRevision,
   actionId:body.actionId,
   action:body.action
  });
 }));
 return {enabled:true};
}
