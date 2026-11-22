/**
 * Phase P4 PREPARATION ONLY. Never import this from a live DOG route until
 * a durable Postgres database, Firestore XP bridge, and settlement scheduler
 * are explicitly connected and tested together.
 *
 * Terminal DOG moves are staged in SQL, not published. The playable room
 * stays at its preceding version while a pending-finish row freezes all
 * further mutations. Only after the Firestore receipt confirms XP is the
 * finished room published and a room-changed outbox row inserted.
 *
 * Christmas/seasonal matches are intentionally unsupported.
 */
import {reduceDogClassicInPostgresRoom} from './dog-postgres-classic-adapter.js';
import {dogPostgresSettlementProof} from './dog-postgres-xp-settlement.js';
import {dogPostgresActionHash} from './dog-postgres-room-store.js';

const CODE=/^(?:[0-9]{3}|[A-HJ-NP-Z2-9]{6})$/;
const ACTION_ID=/^[-a-zA-Z0-9_:]{8,90}$/;
const MATCH_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WINDOW_MS=24*60*60*1000;
const fail=code=>{const e=new Error(code);e.code=code;throw e};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function createDogPostgresFinalization({
  pool,clock=Date.now,reduce=reduceDogClassicInPostgresRoom
}={}){
 if(!pool||typeof pool.query!=='function'||typeof pool.connect!=='function'||
    typeof clock!=='function'||typeof reduce!=='function')
  throw new TypeError('Explicit durable Postgres Pool and server DOG reducer required');

 async function stageFinalMove({
  code,matchId,uid,actionId,expectedDogRevision,action,authorize
 }={}){
  if(!CODE.test(String(code||''))||!MATCH_UUID.test(String(matchId||''))||
     typeof uid!=='string'||!uid||!ACTION_ID.test(String(actionId||''))||
     !Number.isSafeInteger(expectedDogRevision)||expectedDogRevision<0||
     !action||typeof action!=='object'||Array.isArray(action)||
     typeof authorize!=='function')
   fail('DOG_PG_FINAL_INVALID_ACTION');
  const hash=dogPostgresActionHash(uid,expectedDogRevision,action);
  const client=await pool.connect();
  let open=false;
  try{
   await client.query('BEGIN');open=true;
   // FOR UPDATE shares the exact room row lock of ordinary commitMove().
   const lock=await client.query(
    'SELECT snapshot,version,match_id,expires_at_ms FROM dog_room_states WHERE room_code=$1 FOR UPDATE',
    [code]);
   const row=lock.rows?.[0];
   if(!row||Number(row.expires_at_ms)<=clock())fail('DOG_PG_FINAL_ROOM_MISSING');
   const before=structuredClone(row.snapshot);
   if(before.phase!=='playing'||before.match?.game!=='dog'||
      before.match.id!==matchId)fail('DOG_PG_FINAL_WRONG_MATCH');
   if(!before.players?.some(p=>p.uid===uid)||
      !before.match.dogRoster?.some(p=>p.uid===uid&&!p.bot&&!p.inactive))
    fail('DOG_PG_FINAL_NOT_PARTICIPANT');
   if(before.match.dogChristmasEligibilityChecked!==true||
      before.match.christmas?.enabled===true||
      before.match.dog?.phase==='finished')
    fail('DOG_PG_FINAL_TRANSACTION_REQUIRED');
   await authorize(structuredClone(before),{uid,matchId,action});
   const found=await client.query(
    'SELECT match_id,action_id,actor_uid,request_hash,fingerprint FROM dog_room_pending_finishes WHERE room_code=$1',
    [code]);
   if(found.rows?.length){
    const waiting=found.rows[0];
    if(waiting.match_id===matchId&&waiting.action_id===actionId&&
       waiting.actor_uid===uid&&waiting.request_hash===hash){
      await client.query('COMMIT');open=false;
      return {pending:true,replayed:true,fingerprint:waiting.fingerprint};
    }
    fail('DOG_PG_FINAL_ALREADY_PENDING');
   }
   if(before.match.dog.revision!==expectedDogRevision)
    fail('DOG_PG_FINAL_STALE_REVISION');
   const candidate=structuredClone(before);
   // The real DOG rules and automatic bots are executed exactly ONCE.
   // They must have no external side effects. The random terminal outcome
   // is stored durably before any attempt to pay XP.
   const outcome=reduce(candidate,{uid,matchId,action,actionId},{allowFinished:true});
   if(outcome&&typeof outcome.then==='function')fail('DOG_PG_FINAL_ASYNC_REDUCER');
   const after=outcome?.room||candidate;
   if(after.phase!==before.phase||after.game!==before.game||
      after.hostUid!==before.hostUid||
      !same(after.players,before.players)||
      !same(after.match?.dogRoster,before.match?.dogRoster)||
      !same(after.match?.members,before.match?.members)||
      !same(after.match?.dogResearchSkills,before.match?.dogResearchSkills)||
      !same(after.match?.christmas,before.match?.christmas)||
      after.match?.dog?.phase!=='finished')
    fail('DOG_PG_FINAL_NOT_FINISHING');
   const stamp=clock();
   after.revision=Number(row.version)+1;
   after.updatedAt=stamp;after.expiresAt=stamp+WINDOW_MS;
   const finishedAt=stamp;
   const {fingerprint}=dogPostgresSettlementProof({
    room:after,finishedAt
   },code,matchId);
   const serialized=JSON.stringify(after);
   if(Buffer.byteLength(serialized,'utf8')>900000)
    fail('DOG_PG_FINAL_STATE_TOO_LARGE');
   await client.query(
    'INSERT INTO dog_room_pending_finishes (room_code,match_id,action_id,actor_uid,request_hash,base_version,finished_snapshot,finished_at_ms,fingerprint,created_at_ms) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)',
    [code,matchId,actionId,uid,hash,Number(row.version),serialized,finishedAt,fingerprint,stamp]);
   await client.query('COMMIT');open=false;
   // No room update or WebSocket outbox until Firestore has paid everyone.
   return {pending:true,replayed:false,fingerprint};
  }catch(e){
   if(open)try{await client.query('ROLLBACK')}catch(_e){}
   throw e;
  }finally{client.release();}
 }

 async function loadPendingMatch({roomCode,matchId}={}){
  if(!CODE.test(String(roomCode||''))||!MATCH_UUID.test(String(matchId||'')))
   fail('DOG_PG_FINAL_INVALID_ID');
  const q=await pool.query(
   'SELECT finished_snapshot,finished_at_ms FROM dog_room_pending_finishes WHERE room_code=$1 AND match_id=$2',
   [roomCode,matchId]);
  const row=q.rows?.[0];
  return row?{room:structuredClone(row.finished_snapshot),
   finishedAt:Number(row.finished_at_ms)}:null;
 }

 async function markComplete({roomCode,matchId,fingerprint}={}){
  if(!CODE.test(String(roomCode||''))||!MATCH_UUID.test(String(matchId||''))||
     !/^[a-f0-9]{64}$/.test(String(fingerprint||'')))
   fail('DOG_PG_FINAL_INVALID_CONFIRMATION');
  const client=await pool.connect();
  let open=false;
  try{
   await client.query('BEGIN');open=true;
   const locked=await client.query(
    'SELECT snapshot,version,match_id,expires_at_ms FROM dog_room_states WHERE room_code=$1 FOR UPDATE',
    [roomCode]);
   const prior=locked.rows?.[0];
   if(!prior)fail('DOG_PG_FINAL_ROOM_MISSING');
   const job=await client.query(
    'SELECT match_id,action_id,actor_uid,request_hash,base_version,finished_snapshot,finished_at_ms,fingerprint FROM dog_room_pending_finishes WHERE room_code=$1',
    [roomCode]);
   const waiting=job.rows?.[0];
   if(!waiting){
    // A Postgres commit can have succeeded even if Render missed its ACK.
    // Do not reinsert the winner action or emit an extra outbox message.
    if(prior.snapshot?.match?.id===matchId&&
       prior.snapshot?.match?.pgSettledFingerprint===fingerprint){
      await client.query('COMMIT');open=false;
      return {confirmed:true,replayed:true,room:structuredClone(prior.snapshot)};
    }
    fail('DOG_PG_FINAL_NOT_PENDING');
   }
   if(waiting.match_id!==matchId||waiting.fingerprint!==fingerprint)
    fail('DOG_PG_FINAL_PROOF_MISMATCH');
   if(Number(prior.version)!==Number(waiting.base_version))
    fail('DOG_PG_FINAL_STALE_ROOM');
   const after=structuredClone(waiting.finished_snapshot);
   const proof=dogPostgresSettlementProof({
    room:after,finishedAt:Number(waiting.finished_at_ms)
   },roomCode,matchId);
   if(proof.fingerprint!==fingerprint)fail('DOG_PG_FINAL_PROOF_MISMATCH');
   after.revision=Number(prior.version)+1;
   after.match.dogCounters.recorded=true;
   after.match.pgSettledFingerprint=fingerprint;
   const now=clock();
   after.updatedAt=now;after.expiresAt=now+WINDOW_MS;
   const write=await client.query(
    'UPDATE dog_room_states SET snapshot=$2::jsonb,version=$3,expires_at_ms=$4,updated_at_ms=$5 WHERE room_code=$1 AND version=$6',
    [roomCode,JSON.stringify(after),after.revision,after.expiresAt,now,Number(prior.version)]);
   if(write.rowCount!==1)fail('DOG_PG_FINAL_STALE_ROOM');
   await client.query(
    'INSERT INTO dog_room_actions (room_code,match_id,action_id,actor_uid,request_hash,room_version,created_at_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [roomCode,matchId,waiting.action_id,waiting.actor_uid,
     waiting.request_hash,after.revision,now]);
   await client.query(
    'INSERT INTO dog_room_outbox (room_code,match_id,action_id,room_version,topic,created_at_ms) VALUES ($1,$2,$3,$4,$5,$6)',
    [roomCode,matchId,waiting.action_id,after.revision,'room-changed',now]);
   await client.query(
    'DELETE FROM dog_room_pending_finishes WHERE room_code=$1 AND match_id=$2',
    [roomCode,matchId]);
   await client.query('COMMIT');open=false;
   return {confirmed:true,replayed:false,room:after};
  }catch(e){
   if(open)try{await client.query('ROLLBACK')}catch(_e){}
   throw e;
  }finally{client.release();}
 }
 return {stageFinalMove,loadPendingMatch,markComplete};
}
