import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 createDogPostgresSettlementRecovery,dogSettlementBackoffMs
} from '../dog-postgres-settlement-recovery.js';

const MATCH_A='7d933478-7081-4a6d-893b-17fd93002111';
const MATCH_B='8db5a196-90f3-4ea1-97de-c5b3d3151314';
function fixture(){
 let now=100000,pgFailure=false;
 const jobs=new Map();
 const counts={selects:0,updates:0,paid:0,calls:0};
 const events=[];
 const pool={
  async query(sql,args){
   if(sql.startsWith('SELECT room_code,match_id,attempts FROM dog_room_pending_finishes')){
    counts.selects++;
    return {rows:[...jobs.values()].filter(j=>!j.requires_review&&
     j.next_attempt_at_ms<=args[0])
      .sort((a,b)=>a.created_at_ms-b.created_at_ms)
      .slice(0,args[1]).map(({room_code,match_id,attempts})=>({
       room_code,match_id,attempts
      }))};
   }
   if(sql.startsWith('UPDATE dog_room_pending_finishes SET')){
    counts.updates++;
    if(pgFailure)throw Error('PG_OFFLINE');
    const row=jobs.get(args[0]+'/'+args[1]);
    if(row){
     row.attempts++;
     row.next_attempt_at_ms=args[2];
     row.requires_review=args[3];
     row.last_error_code=args[4];
    }
    return {rowCount:row?1:0};
   }
   throw Error('UNKNOWN_QUERY '+sql);
  }
 };
 const server={behaviour:async()=>({settled:true,replayed:false})};
 const xpBridge={
  async settle({roomCode,matchId}){
   counts.calls++;
   events.push({roomCode,matchId});
   const result=await server.behaviour({roomCode,matchId});
   if(result?.settled===true)jobs.delete(roomCode+'/'+matchId);
   if(result?.settled===true)counts.paid++;
   return result;
  }
 };
 function enqueue(matchId=MATCH_A,roomCode='123',created_at_ms=5000){
  const row={room_code:roomCode,match_id:matchId,created_at_ms,
   attempts:0,next_attempt_at_ms:0,requires_review:false,last_error_code:null};
  jobs.set(roomCode+'/'+matchId,row);return row;
 }
 const recovery=()=>createDogPostgresSettlementRecovery({
  pool,xpBridge,clock:()=>now
 });
 return {jobs,counts,events,enqueue,server,pool,xpBridge,recovery,
  clock:()=>now,advance:ms=>{now+=ms},failPg:x=>{pgFailure=x}};
}
const coded=code=>Object.assign(new Error('filtered private reason'),{code});

test('No pending final matches means one PG query and zero Firestore settlement calls',async()=>{
 const f=fixture(),worker=f.recovery();
 assert.deepEqual(await worker.runOnce(),{
  scanned:0,settled:0,replayed:0,retryable:0,quarantined:0,
  alreadyClosed:0,pgErrors:0
 });
 assert.equal(f.counts.calls,0);
 assert.equal(f.counts.selects,1);
 assert.equal(worker.stats().activeRooms,undefined);
 assert.equal(worker.stats().running,false);
});

test('Two outstanding match receipts recover in bounded order, with no duplicate credits',async()=>{
 const f=fixture();
 f.enqueue(MATCH_B,'ABC234',6000);
 f.enqueue(MATCH_A,'123',5000);
 let recovered=0;
 f.server.behaviour=async()=>{recovered++;return {settled:true,replayed:recovered===2}};
 const worker=f.recovery();
 const result=await worker.runOnce({limit:2});
 assert.equal(result.scanned,2);
 assert.equal(result.settled,2);
 assert.equal(result.replayed,1);
 assert.equal(f.jobs.size,0);
 assert.deepEqual(f.events.map(x=>x.matchId),[MATCH_A,MATCH_B]);
 assert.equal(f.counts.updates,0);
 assert.equal(worker.stats().settled,2);
});

test('Temporary Firebase outage records exponential retry in SQL across Render restarts',async()=>{
 const f=fixture(),job=f.enqueue();
 f.server.behaviour=async()=>{throw coded('DOG_PG_SETTLEMENT_FIRESTORE_UNAVAILABLE')};
 const first=await f.recovery().runOnce();
 assert.equal(first.retryable,1);
 assert.equal(job.attempts,1);
 assert.equal(job.next_attempt_at_ms,102000);
 assert.equal(job.last_error_code,'DOG_PG_SETTLEMENT_FIRESTORE_UNAVAILABLE');
 assert.equal((await f.recovery().runOnce()).scanned,0,'no hot-loop Firestore GET');
 f.advance(2000);
 const second=await f.recovery().runOnce();
 assert.equal(second.retryable,1);
 assert.equal(job.attempts,2);
 assert.equal(job.next_attempt_at_ms,106000);
 f.advance(4000);
 f.server.behaviour=async()=>({settled:true,replayed:true});
 const recovered=await f.recovery().runOnce();
 assert.equal(recovered.settled,1);
 assert.equal(recovered.replayed,1,'existing receipt protects payouts after crash');
 assert.equal(f.jobs.size,0);
});

test('Fingerprint conflicts and legacy overlap enter durable manual review instead of retry flood',async()=>{
 for(const code of [
  'DOG_PG_SETTLEMENT_RECEIPT_CONFLICT',
  'DOG_PG_SETTLEMENT_LEGACY_OVERLAP'
 ]){
  const f=fixture(),job=f.enqueue();
  f.server.behaviour=async()=>{throw coded(code)};
  const w=f.recovery();
  assert.equal((await w.runOnce()).quarantined,1);
  assert.equal(job.requires_review,true);
  assert.equal(job.last_error_code,code);
  f.advance(5000000);
  assert.equal((await f.recovery().runOnce()).scanned,0);
  assert.equal(f.counts.calls,1);
  assert.equal(w.stats().quarantined,1);
 }
});

test('A missing job may have been committed by another worker; no second payout attempt',async()=>{
 const f=fixture();f.enqueue();
 f.server.behaviour=async()=>{f.jobs.clear();
  throw coded('DOG_PG_SETTLEMENT_NOT_PENDING')};
 const r=await f.recovery().runOnce();
 assert.equal(r.alreadyClosed,1);
 assert.equal(r.retryable,0);
 assert.equal(r.quarantined,0);
 assert.equal(f.jobs.size,0);
});

test('PG outage during retry bookkeeping leaves the reward pending and never confirms it',async()=>{
 const f=fixture(),job=f.enqueue();
 f.server.behaviour=async()=>{throw Error('NETWORK_OR_AUTH_SECRET_MUST_NOT_BE_LOGGED')};
 f.failPg(true);
 const w=f.recovery();
 const r=await w.runOnce();
 assert.equal(r.pgErrors,1);
 assert.equal(job.attempts,0);
 assert.equal(job.next_attempt_at_ms,0);
 assert.equal(job.requires_review,false);
 assert.equal(JSON.stringify(w.stats()).includes('SECRET'),false);
 assert.equal(JSON.stringify(w.stats()).includes('123'),false);
 assert.equal(f.counts.paid,0);
});

test('Parallel runOnce calls share one in-flight batch, preventing local duplicate work',async()=>{
 const f=fixture();f.enqueue();
 let enter=null,release=null;
 f.server.behaviour=async()=>new Promise(resolve=>{
  enter?.();release=()=>resolve({settled:true,replayed:false});
 });
 const began=new Promise(resolve=>{enter=resolve});
 const w=f.recovery();
 const a=w.runOnce(),b=w.runOnce();
 await began;
 assert.equal(w.stats().running,true);
 release();
 const [x,y]=await Promise.all([a,b]);
 assert.deepEqual(x,y);
 assert.equal(f.counts.calls,1);
 assert.equal(w.stats().running,false);
});

test('Work is bounded to at most 32 pending jobs and rejects invalid batches',async()=>{
 const f=fixture();
 const worker=f.recovery();
 for(const limit of [-1,0,1.3,33,'20',null])
  await assert.rejects(()=>worker.runOnce({limit}),
   /DOG_SETTLEMENT_RECOVERY_BAD_BATCH/);
 for(let i=0;i<34;i++)f.enqueue(MATCH_A,'room'+i,1000+i);
 assert.equal((await worker.runOnce({limit:32})).scanned,32);
 assert.equal(f.jobs.size,2);
 assert.equal((await worker.runOnce({limit:32})).scanned,2);
 assert.equal(f.jobs.size,0);
});

test('Backoff is bounded and avoids excessive attempts if Firebase remains unavailable',()=>{
 assert.equal(dogSettlementBackoffMs(0),2000);
 assert.equal(dogSettlementBackoffMs(1),4000);
 assert.equal(dogSettlementBackoffMs(2),8000);
 assert.equal(dogSettlementBackoffMs(20),600000);
 assert.equal(dogSettlementBackoffMs(-1),2000);
});

test('SQL migration retains failed XP jobs and supports due-only queries without leaking card data',()=>{
 const sql=readFileSync(new URL('../migrations/20261122_dog_durable_rooms.sql',import.meta.url),'utf8');
 for(const column of ['attempts INTEGER NOT NULL DEFAULT 0',
  'next_attempt_at_ms BIGINT NOT NULL DEFAULT 0',
  'requires_review BOOLEAN NOT NULL DEFAULT FALSE','last_error_code TEXT'])
  assert.ok(sql.includes(column));
 assert.ok(sql.includes('dog_room_pending_finishes_due_idx'));
 assert.ok(sql.includes('WHERE requires_review=FALSE'));
 assert.ok(!sql.includes('player_token'));
});
