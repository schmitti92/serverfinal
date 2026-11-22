/**
 * P5 PREPARATION ONLY — bounded recovery for Postgres Christmas DOG payouts.
 *
 * No scheduler, Firestore connection or paid DB is created by this module.
 * It MUST NOT run against the old live Firestore rooms.
 *
 * A reward-bearing DOG move is frozen in dog_room_pending_rewards until one
 * of two existing Firestore bridges confirms its immutable payout receipt.
 * A crashed/slow worker can safely retry with the same pending action ID.
 * Fatal proof conflicts are quarantined; transient failures get exponential
 * SQL-persisted backoff. Zero pending jobs = zero Firebase operations.
 */
const MAX_BATCH=16;
const RETRY_BASE_MS=2000;
const RETRY_MAX_MS=10*60*1000;
const VALID_ERROR=/^DOG_[A-Z0-9_]{5,100}$/;
const RETIRED=new Set([
 'DOG_PG_CHRISTMAS_NOT_PENDING',
 'DOG_PG_SEASONAL_FINAL_NOT_PENDING'
]);
const FATAL=new Set([
 'DOG_PG_CHRISTMAS_INVALID_RECORD',
 'DOG_PG_CHRISTMAS_UNSAFE_TURN',
 'DOG_PG_CHRISTMAS_INVALID_DELTA',
 'DOG_PG_CHRISTMAS_INVALID_ROSTER',
 'DOG_PG_CHRISTMAS_INVALID_VOUCHERS',
 'DOG_PG_CHRISTMAS_NO_PAYOUT',
 'DOG_PG_CHRISTMAS_RECEIPT_CONFLICT',
 'DOG_PG_SEASONAL_FINAL_UNSAFE_MATCH',
 'DOG_PG_SEASONAL_FINAL_INVALID_RECORD',
 'DOG_PG_SEASONAL_FINAL_BAD_ROSTER',
 'DOG_PG_SEASONAL_FINAL_BAD_COUNTER',
 'DOG_PG_SEASONAL_FINAL_BAD_WINNER',
 'DOG_PG_SEASONAL_FINAL_BAD_REWARD',
 'DOG_PG_SEASONAL_FINAL_BAD_VOUCHERS',
 'DOG_PG_SEASONAL_FINAL_RECEIPT_CONFLICT',
 'DOG_PG_SEASONAL_FINAL_PARTIAL_PAYOUT',
 'DOG_PG_SEASONAL_FINAL_LEGACY_OVERLAP',
 'DOG_PG_SEASONAL_PROOF_MISMATCH',
 'DOG_PG_SEASONAL_STALE_ROOM',
 'DOG_PG_SEASONAL_WRONG_MATCH'
]);
const cleanCode=error=>VALID_ERROR.test(error?.code)?
 error.code:'DOG_PG_SEASONAL_RETRY_ERROR';
export function dogSeasonalSettlementBackoffMs(attempts){
 const n=Number.isSafeInteger(attempts)&&attempts>=0?attempts:0;
 return Math.min(RETRY_MAX_MS,RETRY_BASE_MS*(2**Math.min(n,9)));
}

export function createDogPostgresSeasonalRecovery({
 pool,christmasBridge,finalBridge,clock=Date.now
}={}){
 if(!pool||typeof pool.query!=='function'||
    typeof christmasBridge?.settle!=='function'||
    typeof finalBridge?.settle!=='function'||
    typeof clock!=='function')
  throw new TypeError('Durable PG pool and both idempotent Firebase bridges required');
 const totals={runs:0,checked:0,settled:0,replayed:0,alreadyClosed:0,
  retryable:0,quarantined:0,staleUpdates:0,pgErrors:0};
 let running=null;

 async function perform(limit){
  const now=clock();
  const rows=await pool.query(
   'SELECT room_code,match_id,action_id,is_final,attempts FROM dog_room_pending_rewards WHERE requires_review=FALSE AND next_attempt_at_ms<=$1 ORDER BY created_at_ms ASC LIMIT $2',
   [now,limit]);
  totals.runs++;
  const jobs=rows.rows||[];
  const outcome={scanned:jobs.length,settled:0,replayed:0,alreadyClosed:0,
   retryable:0,quarantined:0,staleUpdates:0,pgErrors:0};
  for(const job of jobs){
   if(typeof job.room_code!=='string'||
      typeof job.match_id!=='string'||
      typeof job.action_id!=='string'||
      typeof job.is_final!=='boolean')
    throw Error('DOG_PG_SEASONAL_UNSAFE_JOB');
   totals.checked++;
   try{
    const reply=job.is_final?
     await finalBridge.settle({
      roomCode:job.room_code,matchId:job.match_id
     }):
     await christmasBridge.settle({
      roomCode:job.room_code,matchId:job.match_id,
      actionId:job.action_id
     });
    if(reply?.settled!==true)throw Error('DOG_PG_SEASONAL_ACK_MISSING');
    totals.settled++;outcome.settled++;
    if(reply.replayed){totals.replayed++;outcome.replayed++;}
   }catch(e){
    const code=cleanCode(e);
    if(RETIRED.has(code)){
     totals.alreadyClosed++;outcome.alreadyClosed++;
     continue;
    }
    const quarantine=FATAL.has(code);
    const attempts=Number.isSafeInteger(job.attempts)&&job.attempts>=0?
     job.attempts:0;
    const retryAt=quarantine?now:now+dogSeasonalSettlementBackoffMs(attempts);
    // Including both the immutable action ID and the observed attempts
    // prevents a slow worker from marking a DIFFERENT new pending operation
    // as failed after another worker has already completed its own job.
    try{
     const updated=await pool.query(
      'UPDATE dog_room_pending_rewards SET attempts=attempts+1,next_attempt_at_ms=$4,requires_review=$5,last_error_code=$6 WHERE room_code=$1 AND match_id=$2 AND action_id=$3 AND attempts=$7',
      [job.room_code,job.match_id,job.action_id,retryAt,
       quarantine,code,attempts]);
     if(updated.rowCount!==1){
      totals.staleUpdates++;outcome.staleUpdates++;
      continue;
     }
    }catch(_sqlError){
     // If Postgres fails here, no Firebase payout can be marked as
     // acknowledged. The pending row stays available for later recovery.
     totals.pgErrors++;outcome.pgErrors++;
     continue;
    }
    if(quarantine){
     totals.quarantined++;outcome.quarantined++;
    }else{
     totals.retryable++;outcome.retryable++;
    }
   }
  }
  return outcome;
 }
 async function runOnce({limit=8}={}){
  if(!Number.isInteger(limit)||limit<1||limit>MAX_BATCH)
   throw new RangeError('DOG_PG_SEASONAL_INVALID_BATCH');
  if(running)return running;
  const task=perform(limit);
  running=task;
  try{return await task}finally{if(running===task)running=null;}
 }
 function stats(){
  // Only aggregate counts — never room codes, UIDs, match IDs or prizes.
  return {...totals,running:running!==null,maxBatch:MAX_BATCH};
 }
 return {runOnce,stats};
}
