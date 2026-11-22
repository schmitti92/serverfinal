import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createDogPostgresSeasonalRecovery,dogSeasonalSettlementBackoffMs
} from '../dog-postgres-seasonal-recovery.js';

const clone=structuredClone;
function fakeStore(seed=[]){
 const records=new Map(seed.map(row=>[row.room_code,clone({
  attempts:0,next_attempt_at_ms:0,requires_review:false,...row
 })]));
 const queries=[];
 let failUpdate=false;
 return {
  records,queries,
  failUpdate(flag){failUpdate=flag},
  pool:{
   async query(sql,args=[]){
    queries.push({sql,args:clone(args)});
    if(sql.startsWith('SELECT room_code,match_id,action_id,is_final,attempts FROM dog_room_pending_rewards')){
     return {rows:[...records.values()]
      .filter(row=>!row.requires_review&&row.next_attempt_at_ms<=args[0])
      .sort((a,b)=>a.created_at_ms-b.created_at_ms)
      .slice(0,args[1]).map(row=>clone(row))};
    }
    if(sql.startsWith('UPDATE dog_room_pending_rewards SET attempts=')){
     if(failUpdate)throw Error('DATABASE_TEMPORARILY_OFFLINE');
     const [code,matchId,actionId,nextAt,quarantine,errorCode,attempts]=args;
     const row=records.get(code);
     if(!row||row.match_id!==matchId||row.action_id!==actionId||
        row.attempts!==attempts)return {rowCount:0,rows:[]};
     Object.assign(row,{
      attempts:row.attempts+1,next_attempt_at_ms:nextAt,
      requires_review:quarantine,last_error_code:errorCode
     });
     return {rowCount:1,rows:[]};
    }
    throw Error('UNEXPECTED_SQL '+sql);
   }
  }
 };
}
const job=(code,{final=false,at=1,action='unique-seasonal-action-0001'}={})=>({
 room_code:code,match_id:'23bf8e8f-4b16-4f0d-8d7b-637b6dff4a2d',
 action_id:action,is_final:final,created_at_ms:at
});
const error=code=>Object.assign(new Error('Not logged'),{code});
const bridges=(f,handle=()=>{})=>{
 const calls={christmas:[],final:[]};
 return {
  calls,
  christmasBridge:{async settle(input){
   calls.christmas.push(input);
   return handle('christmas',input)??{
    settled:true,replayed:false
   };
  }},
  finalBridge:{async settle(input){
   calls.final.push(input);
   return handle('final',input)??{
    settled:true,replayed:false
   };
  }}
 };
};
const build=(f,b,clock=()=>1000)=>
 createDogPostgresSeasonalRecovery({
  pool:f.pool,christmasBridge:b.christmasBridge,
  finalBridge:b.finalBridge,clock
 });

test('Empty Postgres pending journal performs ZERO Firebase operations',async()=>{
 const f=fakeStore(),b=bridges(f),worker=build(f,b);
 const result=await worker.runOnce();
 assert.equal(result.scanned,0);
 assert.equal(result.settled,0);
 assert.equal(f.queries.length,1,'single indexed PG query, no Firestore');
 assert.equal(b.calls.christmas.length,0);
 assert.equal(b.calls.final.length,0);
 assert.equal(worker.stats().runs,1);
 assert.equal(worker.stats().running,false);
});

test('A single bounded batch routes gifts and terminal 3-player XP to their own verified bridges',async()=>{
 const f=fakeStore([job('ABC234'),job('XYZ234',{final:true,at:2})]);
 const b=bridges(f,(kind,input)=>{
  f.records.delete(input.roomCode); // simulated bridge acknowledged receipt in PG
 });
 const worker=build(f,b);
 const result=await worker.runOnce();
 assert.deepEqual(result,{
  scanned:2,settled:2,replayed:0,alreadyClosed:0,
  retryable:0,quarantined:0,staleUpdates:0,pgErrors:0
 });
 assert.deepEqual(b.calls.christmas,[{
  roomCode:'ABC234',
  matchId:'23bf8e8f-4b16-4f0d-8d7b-637b6dff4a2d',
  actionId:'unique-seasonal-action-0001'
 }]);
 assert.deepEqual(b.calls.final,[{
  roomCode:'XYZ234',matchId:'23bf8e8f-4b16-4f0d-8d7b-637b6dff4a2d'
 }]);
 assert.equal(f.records.size,0);
 assert.equal(worker.stats().settled,2);
});

test('Transient Firebase failure triggers durable exponential backoff, never a retry storm',async()=>{
 let now=1000,unavailable=true;
 const f=fakeStore([job('ABC234')]);
 const b=bridges(f,(kind,input)=>{
  if(unavailable)throw error('DOG_PG_CHRISTMAS_FIRESTORE_UNAVAILABLE');
  f.records.delete(input.roomCode);
 });
 const worker=build(f,b,()=>now);
 const first=await worker.runOnce();
 assert.equal(first.retryable,1);
 assert.equal(f.records.get('ABC234').next_attempt_at_ms,3000);
 assert.equal(f.records.get('ABC234').attempts,1);
 now=2000;
 assert.equal((await worker.runOnce()).scanned,0);
 assert.equal(b.calls.christmas.length,1);
 now=3000;unavailable=false;
 assert.equal((await worker.runOnce()).settled,1);
 assert.equal(b.calls.christmas.length,2);
 assert.equal(f.records.size,0);
});

test('Untrusted or tampered Firestore payout fingerprint is QUARANTINED, not repeatedly charged',async()=>{
 const f=fakeStore([job('ABC234')]);
 const b=bridges(f,()=>{throw error('DOG_PG_CHRISTMAS_RECEIPT_CONFLICT')});
 const worker=build(f,b);
 const result=await worker.runOnce();
 assert.equal(result.quarantined,1);
 const pending=f.records.get('ABC234');
 assert.equal(pending.requires_review,true);
 assert.equal(pending.attempts,1);
 assert.equal(pending.last_error_code,'DOG_PG_CHRISTMAS_RECEIPT_CONFLICT');
 assert.equal((await worker.runOnce()).scanned,0);
 assert.equal(b.calls.christmas.length,1);
});

test('A terminal XP/lights voucher proof conflict is quarantined without corrupting the match',async()=>{
 const f=fakeStore([job('ABC234',{final:true})]);
 const b=bridges(f,()=>{throw error('DOG_PG_SEASONAL_FINAL_PARTIAL_PAYOUT')});
 const w=build(f,b);
 const result=await w.runOnce();
 assert.equal(result.quarantined,1);
 assert.equal(f.records.get('ABC234').requires_review,true);
 assert.equal(b.calls.final.length,1);
});

test('A job already ACKed by a racing PG worker is not treated as an error',async()=>{
 const f=fakeStore([job('ABC234')]);
 const b=bridges(f,(kind,input)=>{
  f.records.delete(input.roomCode);
  throw error('DOG_PG_CHRISTMAS_NOT_PENDING');
 });
 const w=build(f,b);
 const r=await w.runOnce();
 assert.equal(r.alreadyClosed,1);
 assert.equal(r.quarantined,0);
 assert.equal(r.retryable,0);
 assert.equal(f.records.size,0);
});

test('Slow failed worker cannot overwrite a NEW pending action from the same room',async()=>{
 const f=fakeStore([job('ABC234')]);
 const b=bridges(f,(kind,input)=>{
  // An independent worker acknowledged the old operation, and the
  // next verified user move has already been durably staged.
  f.records.set(input.roomCode,job(input.roomCode,{
   action:'completely-new-action-id-0002'
  }));
  throw error('DOG_PG_CHRISTMAS_FIRESTORE_UNAVAILABLE');
 });
 const w=build(f,b);
 const out=await w.runOnce();
 assert.equal(out.staleUpdates,1);
 assert.equal(out.retryable,0);
 const current=f.records.get('ABC234');
 assert.equal(current.action_id,'completely-new-action-id-0002');
 assert.equal(current.attempts,undefined,
  'do not mutate the replacement operation with an old retry count');
});

test('Failure to persist retry details leaves original PG pending operation untouched',async()=>{
 const f=fakeStore([job('ABC234')]);f.failUpdate(true);
 const b=bridges(f,()=>{throw Error('network secret: user=alice')});
 const w=build(f,b);
 const result=await w.runOnce();
 assert.equal(result.pgErrors,1);
 assert.equal(f.records.get('ABC234').attempts,0);
 assert.equal(JSON.stringify(w.stats()).includes('alice'),false);
 assert.equal(JSON.stringify(w.stats()).includes('ABC234'),false);
});

test('In-process duplicate calls share one outstanding recovery scan',async()=>{
 const f=fakeStore([job('ABC234')]);
 let release;
 const pending=new Promise(resolve=>{release=resolve});
 const b=bridges(f,async(kind,input)=>{
  await pending;f.records.delete(input.roomCode);
  return {settled:true,replayed:true};
 });
 const w=build(f,b);
 const first=w.runOnce(),second=w.runOnce();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(b.calls.christmas.length,1);
 release();
 const [a,c]=await Promise.all([first,second]);
 assert.deepEqual(a,c);
 assert.equal(w.stats().runs,1);
 assert.equal(w.stats().replayed,1);
 assert.equal(w.stats().running,false);
});

test('Bounded retry budgets and input validation enforce safe polling',async()=>{
 assert.deepEqual([0,1,2,3,8,12].map(dogSeasonalSettlementBackoffMs),
  [2000,4000,8000,16000,512000,600000]);
 const f=fakeStore(),b=bridges(f),w=build(f,b);
 for(const bad of [0,-1,1.5,17,Infinity]){
  await assert.rejects(()=>w.runOnce({limit:bad}),
   /DOG_PG_SEASONAL_INVALID_BATCH/);
 }
 assert.equal(f.queries.length,0);
});
