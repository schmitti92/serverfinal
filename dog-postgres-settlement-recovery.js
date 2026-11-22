/**
 * P4 PREPARATION ONLY. Does not start a scheduler or connect to Firebase.
 *
 * When a future durable PG store is provisioned and explicitly wired to
 * DOG, this bounded recovery driver can retry UNFINISHED match settlements
 * across Render restarts. It never trusts a browser-provided payment result.
 *
 * Each PG finish remains frozen until the existing exactly-once Firestore XP
 * bridge confirms the immutable match receipt. The DB rows, retry time and
 * human-review state survive process crashes. No personal identifiers are
 * included in metrics or error logs.
 *
 * Seasonal move rewards and the combined Christmas+XP ending are NOT
 * supported by this worker. Future worker scheduling must be separately
 * audited before production activation.
 */
const MAX_BATCH=32;
const RETRY_BASE_MS=2000;
const RETRY_MAX_MS=10*60*1000;
const FATAL_CODES=new Set([
 'DOG_PG_SETTLEMENT_RECEIPT_CONFLICT',
 'DOG_PG_SETTLEMENT_LEGACY_OVERLAP',
 'DOG_PG_SETTLEMENT_INVALID_ROSTER',
 'DOG_PG_SETTLEMENT_INVALID_WINNER',
 'DOG_PG_SETTLEMENT_INVALID_COUNTER',
 'DOG_PG_SETTLEMENT_BAD_MODE',
 'DOG_PG_SETTLEMENT_NOT_FINISHED',
 'DOG_PG_SETTLEMENT_INVALID_TIME',
 'DOG_PG_FINAL_PROOF_MISMATCH',
 'DOG_PG_FINAL_STALE_ROOM'
]);
const VALID_ERROR=/^DOG_[A-Z0-9_]{5,100}$/;
const cleanCode=error=>VALID_ERROR.test(error?.code)?error.code:'DOG_SETTLEMENT_RETRY_ERROR';
export const dogSettlementBackoffMs=attempts=>
 Math.min(RETRY_MAX_MS,RETRY_BASE_MS*(2**Math.min(9,
  Number.isInteger(attempts)?Math.max(0,attempts):0)));

export function createDogPostgresSettlementRecovery({pool,xpBridge,clock=Date.now}={}){
 if(!pool||typeof pool.query!=='function'||!xpBridge||
   typeof xpBridge.settle!=='function'||typeof clock!=='function')
  throw new TypeError('Explicit PostgreSQL pool and XP settlement bridge required');
 const counts={runs:0,checked:0,settled:0,replayed:0,retryable:0,
  quarantined:0,alreadyClosed:0,pgErrors:0};
 let running=null;

 async function perform(limit){
  const now=clock();
  const query=await pool.query(
   'SELECT room_code,match_id,attempts FROM dog_room_pending_finishes WHERE requires_review=FALSE AND next_attempt_at_ms<=$1 ORDER BY created_at_ms ASC LIMIT $2',
   [now,limit]);
  counts.runs++;
  const jobs=query.rows||[];
  const outcome={scanned:jobs.length,settled:0,replayed:0,retryable:0,
   quarantined:0,alreadyClosed:0,pgErrors:0};
  for(const row of jobs){
   if(typeof row.room_code!=='string'||typeof row.match_id!=='string')
    throw Error('DOG_PENDING_JOB_UNSAFE');
   counts.checked++;
   try{
    // The receipt, money and stats changes are protected by an atomic
    // Firestore transaction. Two workers may race, but cannot double award.
    const result=await xpBridge.settle({
     roomCode:row.room_code,matchId:row.match_id
    });
    if(result?.settled!==true)throw Error('DOG_SETTLEMENT_ACK_MISSING');
    counts.settled++;outcome.settled++;
    if(result.replayed){counts.replayed++;outcome.replayed++;}
   }catch(err){
    const code=cleanCode(err);
    // Another worker already finalized this row. The next scan sees
    // nothing. A duplicate response is not a failed payout.
    if(code==='DOG_PG_SETTLEMENT_NOT_PENDING'){
     counts.alreadyClosed++;outcome.alreadyClosed++;
     continue;
    }
    const quarantine=FATAL_CODES.has(code);
    const attempts=Number.isSafeInteger(row.attempts)&&row.attempts>=0?
     row.attempts:0;
    const nextAt=quarantine?now:now+dogSettlementBackoffMs(attempts);
    // If PG logging of a failed job also fails, never claim the failed
    // settlement was handled; report a PG error and leave the job pending.
    try{
     await pool.query(
      'UPDATE dog_room_pending_finishes SET attempts=attempts+1,next_attempt_at_ms=$3,requires_review=$4,last_error_code=$5 WHERE room_code=$1 AND match_id=$2',
      [row.room_code,row.match_id,nextAt,quarantine,code]);
    }catch(_pgErr){
     counts.pgErrors++;outcome.pgErrors++;
     // The failing transaction remains PENDING. Retry next time; the
     // original Firestore receipt will still prevent double payouts.
     continue;
    }
    if(quarantine){
     counts.quarantined++;outcome.quarantined++;
    }else{
     counts.retryable++;outcome.retryable++;
    }
   }
  }
  return outcome;
 }
 async function runOnce({limit=10}={}){
  if(running)return running;
  if(!Number.isInteger(limit)||limit<1||limit>MAX_BATCH)
   throw new RangeError('DOG_SETTLEMENT_RECOVERY_BAD_BATCH');
  const task=perform(limit);
  running=task;
  try{return await task}finally{if(running===task)running=null;}
 }
 function stats(){
  // No UID, room code, match ID, reward amounts or hidden cards.
  return {...counts,running:running!==null,maxBatch:MAX_BATCH};
 }
 return {runOnce,stats};
}
