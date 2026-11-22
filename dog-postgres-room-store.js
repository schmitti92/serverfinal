/**
 * Phase P3 (DORMANT): durable DOG room storage for an eventual Render Postgres
 * migration. The live hub still uses Firestore. Nothing in this module
 * connects to a database or changes production behavior unless explicitly
 * given a pg-compatible Pool by a future, separately reviewed integration.
 *
 * The durable transaction is a single room lock + idempotent action receipt
 * + complete private room snapshot + notification outbox.
 *
 * Restricted to NON-SEASONAL non-finishing DOG moves until a verified reward
 * settlement/outbox consumer exists. Do not make a cross-DB reward grant from
 * the reducer: it is deliberately NOT part of the SQL transaction.
 */
import {createHash} from 'node:crypto';

const CODE=/^(?:[0-9]{3}|[A-HJ-NP-Z2-9]{6})$/;
const ACTION_ID=/^[-a-zA-Z0-9_:]{8,90}$/;
const WINDOW_MS=24*60*60*1000;
const TOPIC='room-changed';

export function dogStorageError(code){
 const error=new Error(code);
 error.code=code;
 return error;
}
const fail=code=>{throw dogStorageError(code)};
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object'){
  const sorted={};
  for(const key of Object.keys(value).sort())sorted[key]=canonical(value[key]);
  return sorted;
 }
 if(typeof value==='number'&&!Number.isFinite(value))fail('DOG_STORAGE_BAD_ACTION');
 if(value===undefined||typeof value==='function'||typeof value==='symbol'||typeof value==='bigint')
  fail('DOG_STORAGE_BAD_ACTION');
 return value;
}
function requestHash(actorUid,expectedDogRevision,action){
 return createHash('sha256')
  .update(JSON.stringify(canonical({actorUid,expectedDogRevision,action})))
  .digest('hex');
}
function validRoom(room,code){
 return room&&room.code===code&&room.match?.game==='dog'&&
  typeof room.match.id==='string'&&room.match.id.length>=8&&
  Number.isSafeInteger(room.revision)&&room.revision>=1&&
  Number.isSafeInteger(room.expiresAt)&&room.expiresAt>0;
}
function validateBasicMove(room,{uid,matchId}){
 if(room.phase!=='playing'||room.match?.game!=='dog'||room.match.id!==matchId)
  fail('DOG_STORAGE_WRONG_MATCH');
 if(!room.players?.some(p=>p.uid===uid)||
    !room.match.dogRoster?.some(p=>p.uid===uid&&!p.bot&&!p.inactive))
  fail('DOG_STORAGE_NOT_PARTICIPANT');
 if(room.match.dogChristmasEligibilityChecked!==true||
    room.match.christmas?.enabled===true||
    room.match.dog?.phase==='finished')
  fail('DOG_STORAGE_TRANSACTION_REQUIRED');
}
export function createDogPostgresRoomStore({pool,clock=Date.now}={}){
 if(!pool||typeof pool.query!=='function'||typeof pool.connect!=='function')
  throw new TypeError('A pg-compatible Pool must be injected explicitly');
 async function getRoom(code){
  if(!CODE.test(code))fail('DOG_STORAGE_BAD_ROOM');
  const result=await pool.query(
   'SELECT snapshot,version,expires_at_ms FROM dog_room_states WHERE room_code=$1',
   [code]);
  const row=result.rows?.[0];
  if(!row||Number(row.expires_at_ms)<=clock())return null;
  return {room:structuredClone(row.snapshot),version:Number(row.version)};
 }
 // Called ONLY by an authenticated server workflow after a new match has
 // been created. A conflicting re-seed must never overwrite a running room.
 async function seedRoom(room){
  const code=room?.code;
  if(!CODE.test(String(code||''))||!validRoom(room,code))
   fail('DOG_STORAGE_BAD_ROOM');
  const initialVersion=room.revision;
  const payload=structuredClone(room);
  const result=await pool.query(
   'INSERT INTO dog_room_states (room_code,match_id,version,snapshot,expires_at_ms,updated_at_ms) VALUES ($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT (room_code) DO NOTHING RETURNING match_id,version',
   [code,room.match.id,initialVersion,JSON.stringify(payload),room.expiresAt,clock()]);
  if(result.rowCount===1)return {created:true,version:initialVersion};
  const existing=await pool.query('SELECT match_id,version FROM dog_room_states WHERE room_code=$1',[code]);
  if(existing.rows?.[0]?.match_id!==room.match.id)
   fail('DOG_STORAGE_SEED_CONFLICT');
  return {created:false,version:Number(existing.rows[0].version)};
 }
 async function commitMove({code,matchId,actionId,uid,expectedDogRevision,action,authorize,reduce}){
  if(!CODE.test(code)||typeof matchId!=='string'||matchId.length<8||
     !ACTION_ID.test(actionId)||typeof uid!=='string'||!uid||
     !Number.isSafeInteger(expectedDogRevision)||expectedDogRevision<0||
     !action||typeof action!=='object'||Array.isArray(action)||
     typeof authorize!=='function'||typeof reduce!=='function')
    fail('DOG_STORAGE_BAD_ACTION');
  const hash=requestHash(uid,expectedDogRevision,action);
  const client=await pool.connect();
  let open=false;
  try{
   await client.query('BEGIN');open=true;
   const lock=await client.query(
    'SELECT snapshot,version,match_id,expires_at_ms FROM dog_room_states WHERE room_code=$1 FOR UPDATE',
    [code]);
   const row=lock.rows?.[0];
   if(!row||Number(row.expires_at_ms)<=clock())fail('DOG_STORAGE_ROOM_MISSING');
   const before=structuredClone(row.snapshot);
   // Authenticate and authorize with the CURRENT durable roster, not a
   // stale WebSocket projection. The application supplies its verifier.
   validateBasicMove(before,{uid,matchId});
   await authorize(before,{uid,matchId,action});
   const receipts=await client.query(
    'SELECT request_hash,room_version FROM dog_room_actions WHERE room_code=$1 AND match_id=$2 AND action_id=$3',
    [code,matchId,actionId]);
   const existing=receipts.rows?.[0];
   if(existing){
    if(existing.request_hash!==hash)fail('DOG_STORAGE_ACTION_ID_COLLISION');
    await client.query('COMMIT');open=false;
    return {room:before,version:Number(row.version),replayed:true};
   }
   if(before.match?.dog?.revision!==expectedDogRevision)
    fail('DOG_STORAGE_STALE_REVISION');
   const candidate=structuredClone(before);
   // The reducer must be a pure, synchronous rules function. It must never
   // grant wallets/XP, access Firestore or produce externally visible effects.
   const returned=reduce(candidate,{uid,matchId,action});
   if(returned&&typeof returned.then==='function')
    fail('DOG_STORAGE_ASYNC_REDUCER_FORBIDDEN');
   const after=returned?.room||candidate;
   if(!validRoom(after,code)||after.match?.id!==matchId||
      after.match.dogChristmasEligibilityChecked!==true||
      after.match.christmas?.enabled===true||
      after.match.dog?.phase==='finished'||
      !Number.isSafeInteger(after.match.dog?.revision)||
      after.match.dog.revision<=before.match.dog.revision||
      after.match.dogCounters?.recorded!==before.match.dogCounters?.recorded)
    fail('DOG_STORAGE_TRANSACTION_REQUIRED');
   // The adapter owns these monotonic values, not a client action body.
   after.revision=Number(row.version)+1;
   after.updatedAt=clock();
   after.expiresAt=clock()+WINDOW_MS;
   const write=await client.query(
    'UPDATE dog_room_states SET snapshot=$2::jsonb,version=$3,expires_at_ms=$4,updated_at_ms=$5 WHERE room_code=$1 AND version=$6',
    [code,JSON.stringify(after),after.revision,after.expiresAt,after.updatedAt,Number(row.version)]);
   if(write.rowCount!==1)fail('DOG_STORAGE_VERSION_CONFLICT');
   await client.query(
    'INSERT INTO dog_room_actions (room_code,match_id,action_id,actor_uid,request_hash,room_version,created_at_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [code,matchId,actionId,uid,hash,after.revision,clock()]);
   // ONLY an event pointer: never write hands, decks, cards, wallet values,
   // or player identities into the fan-out queue.
   await client.query(
    'INSERT INTO dog_room_outbox (room_code,match_id,action_id,room_version,topic,created_at_ms) VALUES ($1,$2,$3,$4,$5,$6)',
    [code,matchId,actionId,after.revision,TOPIC,clock()]);
   await client.query('COMMIT');open=false;
   return {room:after,version:after.revision,replayed:false};
  }catch(error){
   if(open)try{await client.query('ROLLBACK')}catch(_e){}
   throw error;
  }finally{client.release();}
 }
 // Only event pointers leave the outbox; reconnect always fetches a
 // private per-user projection from the durable room snapshot separately.
 async function pendingEvents(limit=100){
  const size=Math.max(1,Math.min(1000,Number.isInteger(limit)?limit:100));
  const r=await pool.query(
   'SELECT event_id,room_code,match_id,room_version,topic FROM dog_room_outbox WHERE delivered_at_ms IS NULL ORDER BY event_id LIMIT $1',
   [size]);
  return r.rows||[];
 }
 async function acknowledgeEvent(eventId){
  if(!Number.isSafeInteger(eventId)||eventId<1)fail('DOG_STORAGE_BAD_EVENT');
  await pool.query(
   'UPDATE dog_room_outbox SET delivered_at_ms=$2 WHERE event_id=$1 AND delivered_at_ms IS NULL',
   [eventId,clock()]);
 }
 return {getRoom,seedRoom,commitMove,pendingEvents,acknowledgeEvent};
}
