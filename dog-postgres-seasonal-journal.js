/**
 * P5 PREPARATION ONLY — durable PostgreSQL journal for seasonal DOG moves.
 *
 * THIS MODULE IS NOT CONNECTED TO LIVE HUB/RENDER. It needs an explicitly
 * provisioned durable PG pool, Firebase payout bridges and a recovery worker
 * before any real room may be routed through it.
 *
 * Ordinary moves: one SQL transaction saves the room + action ID + outbox.
 * Reward/finishing moves: one SQL transaction freezes the COMPLETE PRIVATE
 * before/after move, server-awarded vouchers and an immutable fingerprint.
 * No visible board change or outbox until the Firestore receipt has credited
 * the whole payout. The final ACK then publishes in one SQL transaction.
 *
 * Never send the pending record over WebSocket: it includes decks and hands.
 */
import {dogPostgresActionHash} from './dog-postgres-room-store.js';
import {reduceDogSeasonalInPostgresRoom} from './dog-postgres-seasonal-adapter.js';
import {dogPostgresChristmasRewardProof} from './dog-postgres-christmas-settlement.js';
import {dogPostgresSeasonalFinalProof} from './dog-postgres-seasonal-final-settlement.js';

const CODE=/^(?:[0-9]{3}|[A-HJ-NP-Z2-9]{6})$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION_ID=/^[-a-zA-Z0-9_:]{8,90}$/;
const WINDOW_MS=24*60*60*1000;
const TOPIC='room-changed';
const fail=code=>{const e=new Error(code);e.code=code;throw e};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const proof=(record,finished,code,matchId,actionId)=>{
 if(finished)return dogPostgresSeasonalFinalProof({
  before:record.before,room:record.after,
  vouchers:record.vouchers,actionId,
  finishedAt:record.recordedAt
 },code,matchId).fingerprint;
 return dogPostgresChristmasRewardProof(record,{
  roomCode:code,matchId,actionId
 }).fingerprint;
};
const settled=(x)=>x&&Array.isArray(x.vouchers)&&
 x.delta&&typeof x.rewardBearing==='boolean'&&
 typeof x.finished==='boolean';

export function createDogPostgresSeasonalJournal({
 pool,clock=Date.now,reduce=reduceDogSeasonalInPostgresRoom,
 eventActive=()=>true
}={}){
 if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function'||
    typeof clock!=='function'||typeof reduce!=='function'||
    typeof eventActive!=='function')
  throw new TypeError('Durable Postgres Pool, trusted seasonal reducer and clock required');

 async function commitSeasonalMove({
  code,matchId,uid,actionId,expectedDogRevision,action,authorize
 }={}){
  if(!CODE.test(String(code||''))||!UUID.test(String(matchId||''))||
     typeof uid!=='string'||!uid||!ACTION_ID.test(String(actionId||''))||
     !Number.isSafeInteger(expectedDogRevision)||expectedDogRevision<0||
     !action||typeof action!=='object'||Array.isArray(action)||
     typeof authorize!=='function')
   fail('DOG_PG_SEASONAL_INVALID_ACTION');
  const hash=dogPostgresActionHash(uid,expectedDogRevision,action);
  const client=await pool.connect();
  let open=false;
  try{
   await client.query('BEGIN');open=true;
   const locked=await client.query(
    'SELECT snapshot,version,match_id,expires_at_ms FROM dog_room_states WHERE room_code=$1 FOR UPDATE',
    [code]);
   const row=locked.rows?.[0];
   if(!row||Number(row.expires_at_ms)<=clock())
    fail('DOG_PG_SEASONAL_ROOM_MISSING');
   const before=structuredClone(row.snapshot);
   if(before.phase!=='playing'||before.match?.game!=='dog'||
      before.match.id!==matchId||
      before.match.dogChristmasEligibilityChecked!==true||
      before.match.christmas?.enabled!==true||
      before.match.dog?.phase==='finished')
    fail('DOG_PG_SEASONAL_WRONG_MATCH');
   if(!before.players?.some(p=>p.uid===uid)||
      !before.match.dogRoster?.some(p=>p.uid===uid&&!p.bot&&!p.inactive))
    fail('DOG_PG_SEASONAL_NOT_PARTICIPANT');
   // Callers MUST have already verified the Firebase identity; this hook
   // may enforce additional account/scope constraints using the CURRENT
   // private PG room, never an old browser-supplied member list.
   await authorize(structuredClone(before),{uid,matchId,action});
   const [pending,finishedPending]=await Promise.all([
    client.query(
     'SELECT match_id,action_id,actor_uid,request_hash,fingerprint,is_final FROM dog_room_pending_rewards WHERE room_code=$1',
     [code]),
    client.query(
     'SELECT action_id FROM dog_room_pending_finishes WHERE room_code=$1',
     [code])
   ]);
   if(finishedPending.rows?.length)fail('DOG_PG_SEASONAL_SETTLEMENT_PENDING');
   const waiting=pending.rows?.[0];
   if(waiting){
    if(waiting.match_id===matchId&&waiting.action_id===actionId&&
       waiting.actor_uid===uid&&waiting.request_hash===hash){
      await client.query('COMMIT');open=false;
      return {pending:true,finished:waiting.is_final,
       replayed:true,fingerprint:waiting.fingerprint};
    }
    fail('DOG_PG_SEASONAL_SETTLEMENT_PENDING');
   }
   const existing=await client.query(
    'SELECT request_hash,room_version FROM dog_room_actions WHERE room_code=$1 AND match_id=$2 AND action_id=$3',
    [code,matchId,actionId]);
   const receipt=existing.rows?.[0];
   if(receipt){
    if(receipt.request_hash!==hash)fail('DOG_PG_SEASONAL_ACTION_COLLISION');
    await client.query('COMMIT');open=false;
    return {pending:false,replayed:true,room:before,
     version:Number(row.version)};
   }
   if(before.match.dog.revision!==expectedDogRevision)
    fail('DOG_PG_SEASONAL_STALE_REVISION');
   const candidate=structuredClone(before);
   const outcome=reduce(candidate,{uid,matchId,action,actionId},{
    allowUnsettledRewards:true,eventActive:eventActive()===true
   });
   if(outcome&&typeof outcome.then==='function')
    fail('DOG_PG_SEASONAL_ASYNC_REDUCER');
   if(!settled(outcome))fail('DOG_PG_SEASONAL_INVALID_REDUCER');
   const after=outcome.room;
   if(after!==candidate||after.code!==code||
      after.match?.id!==matchId||
      after.game!==before.game||after.phase!==before.phase||
      after.hostUid!==before.hostUid||after.createdAt!==before.createdAt||
      !same(after.players,before.players)||
      !same(after.match.dogRoster,before.match.dogRoster)||
      !same(after.match.members,before.match.members)||
      !same(after.match.dogResearchSkills,before.match.dogResearchSkills)||
      !same(after.match.christmas?.levels,before.match.christmas?.levels)||
      !Number.isSafeInteger(after.match.dog?.revision)||
      after.match.dog.revision<=before.match.dog.revision||
      before.match.dogCounters?.recorded===true||
      after.match.dogCounters?.recorded===true)
    fail('DOG_PG_SEASONAL_UNSAFE_REDUCER');
   const fields=['earnedTenths','giftCount','bonusGiftCount','scratchCount'];
   const rewardsChanged=fields.some(key=>
    before.match.christmas[key]!==after.match.christmas[key]);
   if((rewardsChanged||outcome.finished)!==outcome.rewardBearing||
      outcome.finished!==(after.match.dog.phase==='finished')||
      outcome.vouchers.length!==outcome.delta.scratchCount)
    fail('DOG_PG_SEASONAL_UNSAFE_REDUCER');
   const now=clock();
   after.revision=Number(row.version)+1;
   after.updatedAt=now;after.expiresAt=now+WINDOW_MS;
   const serialized=JSON.stringify(after);
   if(Buffer.byteLength(serialized,'utf8')>900000)
    fail('DOG_PG_SEASONAL_STATE_TOO_LARGE');
   if(outcome.rewardBearing){
    const record={
     roomCode:code,matchId,actionId,recordedAt:now,
     before,after:structuredClone(after),
     vouchers:structuredClone(outcome.vouchers)
    };
    const fingerprint=proof(record,outcome.finished,code,matchId,actionId);
    const beforeJSON=JSON.stringify(before);
    const vouchersJSON=JSON.stringify(record.vouchers);
    if(Buffer.byteLength(beforeJSON,'utf8')>900000||
       Buffer.byteLength(vouchersJSON,'utf8')>64000)
     fail('DOG_PG_SEASONAL_REWARD_TOO_LARGE');
    await client.query(
     'INSERT INTO dog_room_pending_rewards (room_code,match_id,action_id,actor_uid,request_hash,base_version,before_snapshot,after_snapshot,vouchers,recorded_at_ms,fingerprint,is_final,created_at_ms) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13)',
     [code,matchId,actionId,uid,hash,Number(row.version),
      beforeJSON,serialized,vouchersJSON,now,fingerprint,outcome.finished,now]);
    await client.query('COMMIT');open=false;
    // No room change, no outbox and no success message until the payout!
    return {pending:true,finished:outcome.finished,replayed:false,
     fingerprint};
   }
   const update=await client.query(
    'UPDATE dog_room_states SET snapshot=$2::jsonb,version=$3,expires_at_ms=$4,updated_at_ms=$5 WHERE room_code=$1 AND version=$6',
    [code,serialized,after.revision,after.expiresAt,now,Number(row.version)]);
   if(update.rowCount!==1)fail('DOG_PG_SEASONAL_STALE_ROOM');
   await client.query(
    'INSERT INTO dog_room_actions (room_code,match_id,action_id,actor_uid,request_hash,room_version,created_at_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [code,matchId,actionId,uid,hash,after.revision,now]);
   await client.query(
    'INSERT INTO dog_room_outbox (room_code,match_id,action_id,room_version,topic,created_at_ms) VALUES ($1,$2,$3,$4,$5,$6)',
    [code,matchId,actionId,after.revision,TOPIC,now]);
   await client.query('COMMIT');open=false;
   return {pending:false,replayed:false,room:after,version:after.revision};
  }catch(e){
   if(open)try{await client.query('ROLLBACK')}catch(_e){}
   throw e;
  }finally{client.release();}
 }

 async function pendingJob({roomCode,matchId,actionId,final}){
  if(!CODE.test(String(roomCode||''))||!UUID.test(String(matchId||''))||
     (actionId!==undefined&&!ACTION_ID.test(String(actionId)))||
     typeof final!=='boolean')fail('DOG_PG_SEASONAL_INVALID_ID');
  const result=await pool.query(
   'SELECT before_snapshot,after_snapshot,vouchers,recorded_at_ms,action_id,is_final FROM dog_room_pending_rewards WHERE room_code=$1 AND match_id=$2 AND is_final=$3'+
   (actionId===undefined?'':' AND action_id=$4'),
   actionId===undefined?[roomCode,matchId,final]:[roomCode,matchId,final,actionId]
  );
  const row=result.rows?.[0];
  if(!row)return null;
  return {
   roomCode,matchId,actionId:row.action_id,
   recordedAt:Number(row.recorded_at_ms),
   before:structuredClone(row.before_snapshot),
   after:structuredClone(row.after_snapshot),
   vouchers:structuredClone(row.vouchers)
  };
 }
 async function loadPendingReward({roomCode,matchId,actionId}={}){
  if(actionId===undefined)fail('DOG_PG_SEASONAL_INVALID_ID');
  return pendingJob({roomCode,matchId,actionId,final:false});
 }
 async function loadPendingFinal({roomCode,matchId}={}){
  const record=await pendingJob({roomCode,matchId,final:true});
  return record?{
   before:record.before,room:record.after,
   finishedAt:record.recordedAt,actionId:record.actionId,
   vouchers:record.vouchers
  }:null;
 }

 async function complete({roomCode,matchId,actionId,fingerprint,final}){
  if(!CODE.test(String(roomCode||''))||!UUID.test(String(matchId||''))||
     (actionId!==undefined&&!ACTION_ID.test(String(actionId)))||
     !/^[a-f0-9]{64}$/.test(String(fingerprint||'')))
   fail('DOG_PG_SEASONAL_INVALID_CONFIRMATION');
  const client=await pool.connect();
  let open=false;
  try{
   await client.query('BEGIN');open=true;
   const query=await client.query(
    'SELECT snapshot,version,match_id,expires_at_ms FROM dog_room_states WHERE room_code=$1 FOR UPDATE',
    [roomCode]);
   const prior=query.rows?.[0];
   if(!prior||prior.match_id!==matchId)
    fail('DOG_PG_SEASONAL_WRONG_MATCH');
   const jobs=await client.query(
    'SELECT match_id,action_id,actor_uid,request_hash,base_version,before_snapshot,after_snapshot,vouchers,recorded_at_ms,fingerprint,is_final FROM dog_room_pending_rewards WHERE room_code=$1',
    [roomCode]);
   const waiting=jobs.rows?.[0];
   if(!waiting){
    const historical=await client.query(
     'SELECT action_id,fingerprint,is_final FROM dog_room_reward_completions WHERE room_code=$1 AND match_id=$2'+
     (actionId===undefined?' AND is_final=$3':' AND action_id=$3'),
     [roomCode,matchId,actionId===undefined?final:actionId]
    );
    const match=historical.rows?.[0];
    if(match&&match.fingerprint===fingerprint&&match.is_final===final){
     await client.query('COMMIT');open=false;
     return {confirmed:true,replayed:true,room:structuredClone(prior.snapshot)};
    }
    fail('DOG_PG_SEASONAL_NOT_PENDING');
   }
   if(waiting.match_id!==matchId||
      (actionId!==undefined&&waiting.action_id!==actionId)||
      waiting.is_final!==final||
      waiting.fingerprint!==fingerprint||
      Number(prior.version)!==Number(waiting.base_version))
    fail('DOG_PG_SEASONAL_PROOF_MISMATCH');
   const before=structuredClone(waiting.before_snapshot);
   const after=structuredClone(waiting.after_snapshot);
   if(!same(before,prior.snapshot)||after.match?.id!==matchId)
    fail('DOG_PG_SEASONAL_STALE_ROOM');
   const record={
    roomCode,matchId,actionId:waiting.action_id,
    recordedAt:Number(waiting.recorded_at_ms),
    before,after,vouchers:structuredClone(waiting.vouchers)
   };
   if(proof(record,final,roomCode,matchId,waiting.action_id)!==fingerprint)
    fail('DOG_PG_SEASONAL_PROOF_MISMATCH');
   const now=clock();
   after.revision=Number(prior.version)+1;
   after.updatedAt=now;after.expiresAt=now+WINDOW_MS;
   if(final){
    after.match.dogCounters.recorded=true;
    after.match.pgSettledFingerprint=fingerprint;
   }
   const update=await client.query(
    'UPDATE dog_room_states SET snapshot=$2::jsonb,version=$3,expires_at_ms=$4,updated_at_ms=$5 WHERE room_code=$1 AND version=$6',
    [roomCode,JSON.stringify(after),after.revision,after.expiresAt,now,Number(prior.version)]);
   if(update.rowCount!==1)fail('DOG_PG_SEASONAL_STALE_ROOM');
   await client.query(
    'INSERT INTO dog_room_actions (room_code,match_id,action_id,actor_uid,request_hash,room_version,created_at_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [roomCode,matchId,waiting.action_id,waiting.actor_uid,
     waiting.request_hash,after.revision,now]);
   await client.query(
    'INSERT INTO dog_room_outbox (room_code,match_id,action_id,room_version,topic,created_at_ms) VALUES ($1,$2,$3,$4,$5,$6)',
    [roomCode,matchId,waiting.action_id,after.revision,TOPIC,now]);
   await client.query(
    'INSERT INTO dog_room_reward_completions (room_code,match_id,action_id,fingerprint,is_final,created_at_ms) VALUES ($1,$2,$3,$4,$5,$6)',
    [roomCode,matchId,waiting.action_id,fingerprint,final,now]);
   await client.query(
    'DELETE FROM dog_room_pending_rewards WHERE room_code=$1 AND match_id=$2 AND action_id=$3',
    [roomCode,matchId,waiting.action_id]);
   await client.query('COMMIT');open=false;
   return {confirmed:true,replayed:false,room:after};
  }catch(e){
   if(open)try{await client.query('ROLLBACK')}catch(_e){}
   throw e;
  }finally{client.release();}
 }
 const markRewardComplete=args=>complete({...args,final:false});
 const markFinalComplete=args=>complete({...args,final:true});
 return {commitSeasonalMove,loadPendingReward,loadPendingFinal,
  markRewardComplete,markFinalComplete};
}
