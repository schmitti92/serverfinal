import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createDogPostgresChristmasRewardBridge,DOG_PG_CHRISTMAS_RECEIPTS_COLLECTION
} from '../dog-postgres-christmas-settlement.js';
import {
 DOG_GLOBAL_VILLAGE_ID,DOG_VILLAGE_COLLECTION
} from '../dog/christmas-village.js';
import {DOG_SCRATCH_COLLECTION} from '../dog/christmas-scratch.js';

const clone=value=>structuredClone(value);
const MATCH_ID='a1470243-a05a-4d2a-829f-4fd2c4dab939';
const ACTION_ID='dog-pg-event-gift-0001';

function room(){
 const roster=['alice','bob','cara'].map((uid,seat)=>({
  uid,seat,bot:false,inactive:false
 }));
 roster.push({uid:null,seat:3,bot:false,inactive:true});
 return {
  code:'123',phase:'playing',
  players:[{uid:'alice'},{uid:'bob'},{uid:'cara'}],
  match:{
   id:MATCH_ID,game:'dog',dogChristmasEligibilityChecked:true,
   dog:{phase:'play',revision:30},
   dogRoster:roster,
   dogCounters:{recorded:false},
   christmas:{
    enabled:true,levels:{tower:1,workshop:1,bakery:1,inn:1,
     luckhouse:1,academy:1},
    earnedTenths:20,giftCount:2,bonusGiftCount:0,scratchCount:1,
    innCredited:false
   }
  }
 };
}
function rewardJob({lights=14,gifts=1,bonus=0,
 vouchers=[{uid:'alice',tier:'simple'},{uid:'cara',tier:'medium'}]}={}){
 const before=room(),after=clone(before);
 after.match.dog.revision=31;
 const event=after.match.christmas;
 event.earnedTenths+=lights;
 event.giftCount+=gifts;
 event.bonusGiftCount+=bonus;
 event.scratchCount+=vouchers.length;
 return {roomCode:'123',matchId:MATCH_ID,actionId:ACTION_ID,
  before,after,recordedAt:1795000000123,vouchers};
}
function fakeFirestore(){
 const docs=new Map(),calls={reads:0,writes:0,transactions:0,rollbacks:0,order:[]};
 let fail=false;
 const db={
  collection:name=>({doc:id=>({path:name+'/'+id})}),
  async runTransaction(fn){
   calls.transactions++;
   let writeStarted=false;
   const ops=[],tx={
    async get(ref){
     if(writeStarted)throw Error('READ_AFTER_FIRST_WRITE');
     calls.reads++;calls.order.push('get');
     const value=docs.get(ref.path);
     return {exists:value!==undefined,data:()=>clone(value)};
    },
    set(ref,value){
     writeStarted=true;calls.order.push('set');
     ops.push([ref.path,clone(value)]);
    }
   };
   try{
    const result=await fn(tx);
    if(fail)throw Error('FIRESTORE_UNAVAILABLE');
    for(const [path,value]of ops){docs.set(path,value);calls.writes++;}
    return result;
   }catch(e){calls.rollbacks++;throw e;}
  }
 };
 return {db,docs,calls,fail(flag){fail=flag},
  get:(collection,id)=>docs.get(collection+'/'+id),
  set:(collection,id,value)=>docs.set(collection+'/'+id,clone(value))};
}
function fixture(job=rewardJob()){
 const firestore=fakeFirestore();
 const pending={job:clone(job),complete:false,marks:0,failMark:false,loads:0};
 const bridge=()=>createDogPostgresChristmasRewardBridge({
  getFirestore:()=>firestore.db,
  loadPendingReward:async({roomCode,matchId,actionId})=>{
   pending.loads++;
   if(pending.complete||roomCode!=='123'||matchId!==MATCH_ID||
      actionId!==ACTION_ID)return null;
   return clone(pending.job);
  },
  markRewardComplete:async({roomCode,matchId,actionId,fingerprint})=>{
   assert.equal(roomCode,'123');
   assert.equal(matchId,MATCH_ID);
   assert.equal(actionId,ACTION_ID);
   assert.match(fingerprint,/^[a-f0-9]{64}$/);
   pending.marks++;
   if(pending.failMark)throw Error('POSTGRES_REWARD_ACK_FAILURE');
   pending.complete=true;
  },
  clock:()=>1795000000999
 });
 return {firestore,pending,bridge,
  settle:()=>bridge().settle({roomCode:'123',matchId:MATCH_ID,actionId:ACTION_ID})};
}
const receiptId=MATCH_ID+'_'+ACTION_ID;

test('Shared village and two human voucher wallets are paid in ONE Firestore transaction',async()=>{
 const f=fixture();
 const r=await f.settle();
 assert.deepEqual(r,{settled:true,replayed:false,vouchers:2,creditedTenths:14});
 assert.equal(f.firestore.calls.transactions,1);
 assert.equal(f.firestore.calls.reads,4,'receipt + village + two winning wallets');
 assert.equal(f.firestore.calls.writes,4,'village + two wallets + receipt');
 const village=f.firestore.get(DOG_VILLAGE_COLLECTION,DOG_GLOBAL_VILLAGE_ID);
 assert.equal(village.lightsTenths,14);
 assert.equal(village.totalEarnedTenths,14);
 assert.equal(village.giftsCollected,1);
 assert.equal(village.bonusGifts,0);
 assert.equal(village.matchesCompleted,0);
 assert.equal(f.firestore.get(DOG_SCRATCH_COLLECTION,'alice').vouchers.simple,1);
 assert.equal(f.firestore.get(DOG_SCRATCH_COLLECTION,'cara').vouchers.medium,1);
 assert.equal(f.firestore.get(DOG_SCRATCH_COLLECTION,'bob'),undefined);
 assert.ok(f.pending.complete);
 assert.ok(f.firestore.calls.order.slice(0,4).every(x=>x==='get'));
 assert.ok(f.firestore.calls.order.slice(4).every(x=>x==='set'));
 const receipt=f.firestore.get(DOG_PG_CHRISTMAS_RECEIPTS_COLLECTION,receiptId);
 assert.equal(receipt.voucherCount,2);
 assert.equal(receipt.gifts,1);
 assert.equal(receipt.earnedTenths,14);
 assert.equal(JSON.stringify(receipt).includes('alice'),false);
 assert.equal(JSON.stringify(receipt).includes('cara'),false);
});

test('Same account receives two voucher tiers using one wallet GET and one wallet write',async()=>{
 const f=fixture(rewardJob({vouchers:[
  {uid:'alice',tier:'simple'},{uid:'alice',tier:'premium'}
 ]}));
 const r=await f.settle();
 assert.equal(r.vouchers,2);
 assert.equal(f.firestore.calls.reads,3,'receipt + village + Alice wallet only');
 assert.equal(f.firestore.calls.writes,3);
 const wallet=f.firestore.get(DOG_SCRATCH_COLLECTION,'alice');
 assert.equal(wallet.vouchers.simple,1);
 assert.equal(wallet.vouchers.premium,1);
});

test('Scratch voucher without gift avoids reading or writing the shared village',async()=>{
 const f=fixture(rewardJob({lights:0,gifts:0,vouchers:[{uid:'bob',tier:'medium'}]}));
 const r=await f.settle();
 assert.equal(r.creditedTenths,0);
 assert.equal(f.firestore.calls.reads,2,'receipt plus the winning wallet');
 assert.equal(f.firestore.calls.writes,2,'wallet plus receipt');
 assert.equal(f.firestore.get(DOG_VILLAGE_COLLECTION,DOG_GLOBAL_VILLAGE_ID),undefined);
});

test('PG ACK timeout after Firestore commit is safe to retry across restart',async()=>{
 const f=fixture();
 f.pending.failMark=true;
 await assert.rejects(()=>f.settle(),/POSTGRES_REWARD_ACK_FAILURE/);
 assert.equal(f.firestore.calls.writes,4);
 assert.equal(f.pending.complete,false);
 const saved=clone(f.firestore.get(DOG_VILLAGE_COLLECTION,DOG_GLOBAL_VILLAGE_ID));
 f.pending.failMark=false;
 const result=await f.bridge().settle({roomCode:'123',matchId:MATCH_ID,actionId:ACTION_ID});
 assert.equal(result.replayed,true);
 assert.equal(f.firestore.calls.reads,5,'retry reads only existing receipt');
 assert.equal(f.firestore.calls.writes,4);
 assert.deepEqual(f.firestore.get(DOG_VILLAGE_COLLECTION,DOG_GLOBAL_VILLAGE_ID),saved);
 assert.equal(f.firestore.get(DOG_SCRATCH_COLLECTION,'alice').vouchers.simple,1);
 assert.equal(f.pending.complete,true);
 await assert.rejects(()=>f.settle(),/DOG_PG_CHRISTMAS_NOT_PENDING/);
 assert.equal(f.firestore.calls.transactions,2,'closed PG job needs zero Firestore reads');
});

test('Failure of one Firestore transaction leaves village, wallets and receipt all unchanged',async()=>{
 const f=fixture();
 f.firestore.fail(true);
 await assert.rejects(()=>f.settle(),/FIRESTORE_UNAVAILABLE/);
 assert.equal(f.firestore.calls.writes,0);
 assert.equal(f.pending.complete,false);
 assert.equal(f.firestore.docs.size,0);
 f.firestore.fail(false);
 assert.equal((await f.settle()).replayed,false);
 assert.equal(f.firestore.calls.writes,4);
 assert.equal(f.pending.complete,true);
});

test('Changing reward amounts after an ambiguous payment is a hard conflict, never another gift',async()=>{
 const f=fixture();
 f.pending.failMark=true;
 await assert.rejects(()=>f.settle(),/POSTGRES_REWARD_ACK_FAILURE/);
 f.pending.job.after.match.christmas.earnedTenths+=10;
 f.pending.failMark=false;
 await assert.rejects(()=>f.settle(),/DOG_PG_CHRISTMAS_RECEIPT_CONFLICT/);
 assert.equal(f.firestore.calls.writes,4);
 assert.equal(f.pending.complete,false);
});

test('Receipt for another room or mismatching hash cannot authorize a reward',async()=>{
 const f=fixture();
 f.firestore.set(DOG_PG_CHRISTMAS_RECEIPTS_COLLECTION,receiptId,{
  matchId:MATCH_ID,roomCode:'999',actionId:ACTION_ID,fingerprint:'a'.repeat(64)});
 await assert.rejects(()=>f.settle(),/DOG_PG_CHRISTMAS_RECEIPT_CONFLICT/);
 assert.equal(f.firestore.calls.writes,0);
 assert.equal(f.pending.marks,0);
});

test('No-op seasonal moves are rejected without Firestore traffic',async()=>{
 const job=rewardJob({lights:0,gifts:0,vouchers:[]});
 const f=fixture(job);
 await assert.rejects(()=>f.settle(),/DOG_PG_CHRISTMAS_NO_PAYOUT/);
 assert.equal(f.firestore.calls.reads,0);
 assert.equal(f.firestore.calls.transactions,0);
});

test('Game finish and Christmas inn payout are NOT partially booked by the move bridge',async()=>{
 for(const mutate of [
  j=>{j.after.match.dog.phase='finished';},
  j=>{j.after.match.christmas.innCredited=true;},
  j=>{j.before.match.dogCounters.recorded=true;},
  j=>{j.after.match.christmas.enabled=false;}
 ]){
  const job=rewardJob();mutate(job);
  const f=fixture(job);
  await assert.rejects(()=>f.settle(),/DOG_PG_CHRISTMAS_UNSAFE_TURN/);
  assert.equal(f.firestore.calls.transactions,0);
 }
});

test('Forged recipient, scratch tier and counter deltas are rejected BEFORE DB reads',async()=>{
 for(const mutate of [
  j=>{j.vouchers[0].uid='mallory';},
  j=>{j.vouchers[0].tier='secret_prize';},
  j=>{j.vouchers.pop();},
  j=>{j.after.match.christmas.earnedTenths=1;},
  j=>{j.after.match.christmas.giftCount+=100;},
  j=>{j.after.match.christmas.bonusGiftCount+=3;},
  j=>{j.after.match.dogRoster[0].uid='intruder';},
  j=>{j.after.match.dog.revision=30;}
 ]){
  const job=rewardJob();mutate(job);
  const f=fixture(job);
  await assert.rejects(()=>f.settle(),/DOG_PG_CHRISTMAS_/);
  assert.equal(f.firestore.calls.transactions,0);
  assert.equal(f.pending.marks,0);
 }
});

test('Only server-shaped match UUIDs, stable action IDs and room codes are accepted',async()=>{
 const f=fixture();
 for(const args of [
  {roomCode:'123',matchId:'from-browser',actionId:ACTION_ID},
  {roomCode:'../',matchId:MATCH_ID,actionId:ACTION_ID},
  {roomCode:'123',matchId:MATCH_ID,actionId:'hi'}
 ]){
  await assert.rejects(()=>f.bridge().settle(args),/DOG_PG_CHRISTMAS_INVALID_ID/);
 }
 assert.equal(f.pending.loads,0);
});

test('Unrelated UI changes cannot rewrite an already committed financial reward fingerprint',async()=>{
 const f=fixture();
 f.pending.failMark=true;
 await assert.rejects(()=>f.settle(),/POSTGRES_REWARD_ACK_FAILURE/);
 f.pending.job.after.match.dog.history=['updated local animation'];
 f.pending.failMark=false;
 assert.equal((await f.settle()).replayed,true);
 assert.equal(f.firestore.calls.writes,4);
});
