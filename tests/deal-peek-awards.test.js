import test from 'node:test';
import assert from 'node:assert/strict';
import {awardPeekJoker} from '../deal-peek-awards.js';

function fakeDB(){
 const docs=new Map(),counts={reads:0,writes:0};
 const ref=key=>({key,collection:sub=>({doc:id=>ref(key+'/'+sub+'/'+id)})});
 const db={
  collection:name=>({doc:id=>ref(name+'/'+id)}),
  async runTransaction(fn){
   const pending=[];
   const tx={
    get:async r=>{counts.reads++;return {exists:docs.has(r.key),data:()=>docs.get(r.key)}},
    create:(r,data)=>pending.push(()=>{if(docs.has(r.key))throw Error('ALREADY_EXISTS');docs.set(r.key,data);counts.writes++}),
    set:(r,data,opts)=>pending.push(()=>{docs.set(r.key,opts?.merge?{...docs.get(r.key),...data}:data);counts.writes++})
   };
   const result=await fn(tx);pending.forEach(f=>f());return result;
  }
 };
 return {db,docs,counts};
}
const args={uid:'user-1',eventId:'reward-event-00001',source:'christmas-ice-v2'};
test('trusted award grants once; repeat does not write',async()=>{
 const t=fakeDB();
 const first=await awardPeekJoker({db:t.db,...args});
 assert.deepEqual(first,{awarded:true,balance:1});
 assert.equal(t.counts.reads,2);assert.equal(t.counts.writes,2);
 const second=await awardPeekJoker({db:t.db,...args});
 assert.deepEqual(second,{awarded:false,balance:1});
 assert.equal(t.counts.reads,4);assert.equal(t.counts.writes,2);
});
test('distinct events each credit once',async()=>{
 const t=fakeDB();
 await awardPeekJoker({db:t.db,...args});
 const result=await awardPeekJoker({db:t.db,...args,eventId:'reward-event-00002'});
 assert.equal(result.balance,2);
});
test('reject untrusted source and malformed event IDs without reads',async()=>{
 const t=fakeDB();
 await assert.rejects(()=>awardPeekJoker({db:t.db,...args,source:'offline-localStorage'}),/INVALID_SOURCE/);
 await assert.rejects(()=>awardPeekJoker({db:t.db,...args,eventId:'x'}),/INVALID_EVENT_ID/);
 assert.equal(t.counts.reads,0);
});
