import test from 'node:test';
import assert from 'node:assert/strict';
import {installPeekJoker} from '../deal-peek-joker.js';

function setup({balance=2,member=true,active=true,opened=[],phase='open',caseCount=26,pending=null}={}){
 const handlers=new Map(),docs=new Map(),writes=[];
 const uid='alice',code='123',id='game-1';
 docs.set('deal_or_no_deal_matches_v1/123',{game:{id,phase,values:Array.from({length:caseCount},(_,i)=>i+1),players:[{id:uid,deal:active?null:100}],opened,pending}});
 docs.set('spielesammlung_hub_v1/123',{players:member?[{uid}]:[]});
 docs.set('deal_peek_inventory_v1/alice',{balance});
 const db={collection(name){return {doc(id){const key=name+'/'+id;return ref(key)}}}};
 function ref(key){return {key,collection(sub){return {doc(id){return ref(key+'/'+sub+'/'+id)}}},async get(){return snap(key)}}}
 function snap(key){return {exists:docs.has(key),data:()=>docs.get(key)}}
 db.runTransaction=async fn=>{
  const mutations=[];const tx={get:async r=>snap(r.key),set:(r,data,opt)=>mutations.push(()=>{docs.set(r.key,opt?.merge?{...docs.get(r.key),...data}:data);writes.push(r.key)}),create:(r,data)=>mutations.push(()=>{if(docs.has(r.key))throw Error('ALREADY_EXISTS');docs.set(r.key,data);writes.push(r.key)})};
  const result=await fn(tx);for(const mutation of mutations)mutation();return result;
 };
 const app={get:(path,...args)=>handlers.set('GET '+path,args),post:(path,...args)=>handlers.set('POST '+path,args)};
 installPeekJoker(app,{verifyProfile:async()=>({uid}),getFirestore:()=>db});
 async function request(path,body){
  const route=handlers.get(path);assert.ok(route,'route exists');
  const req={params:{code},body,peekUid:uid,get:()=> 'Bearer valid'};
  const res={statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this},status(n){this.statusCode=n;return this},json(value){this.value=value;return this}};
  await route[0](req,res,()=>{});
  if(route[1])await route[1](req,res);
  return res;
 }
 return {request,docs,writes};
}
const path='POST /api/deal-or-no-deal/:code/peek';
const payload={case:4,requestId:'test-request-12345'};
test('peek debits exactly once and retries return same private result',async()=>{
 const t=setup();
 const first=await t.request(path,payload);assert.equal(first.value.ok,true);assert.equal(first.value.amount,5);assert.equal(first.value.balance,1);
 const second=await t.request(path,payload);assert.equal(second.value.ok,true);assert.equal(second.value.replayed,true);assert.equal(second.value.balance,1);
 assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,1);
});
test('own selected case is eligible while closed',async()=>{
 const t=setup();t.docs.get('deal_or_no_deal_matches_v1/123').game.players[0].case=4;
 assert.equal((await t.request(path,payload)).value.amount,5);
});
test('former room member is denied without debit',async()=>{
 const t=setup({member:false});const r=await t.request(path,payload);
 assert.equal(r.statusCode,403);assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,2);
});
test('player with accepted deal cannot spend joker',async()=>{
 const t=setup({active:false});assert.equal((await t.request(path,payload)).value.error,'NOT_ACTIVE_PLAYER');
});
test('opened case cannot be inspected',async()=>{
 const t=setup({opened:[4]});assert.equal((await t.request(path,payload)).value.error,'CASE_NOT_CLOSED');
});
test('request ID cannot be reused for another case',async()=>{
 const t=setup();await t.request(path,payload);
 assert.equal((await t.request(path,{...payload,case:5})).value.error,'REQUEST_REUSED');
});
test('not enough jokers does not create a receipt',async()=>{
 const t=setup({balance:0});assert.equal((await t.request(path,payload)).value.error,'NO_JOKERS');
 assert.equal(t.docs.has('deal_peek_inventory_v1/alice/receipts/'+payload.requestId),false);
});

test('Joker sees the final closed case in 26, 27 and 28-case matches, with one debit',async()=>{
 for(const caseCount of [26,27,28]){
  const t=setup({caseCount,balance:2});
  const picked=caseCount-1;
  const result=await t.request(path,{case:picked,requestId:'peek-last-case-'+caseCount+'-12345'});
  assert.equal(result.statusCode,200);
  assert.equal(result.value.ok,true,'game length '+caseCount+' should be accepted');
  assert.equal(result.value.case,picked);
  assert.equal(result.value.amount,caseCount);
  assert.equal(result.value.balance,1);
  assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,1);
  assert.deepEqual(t.docs.get('deal_or_no_deal_matches_v1/123').game.opened,[]);
  assert.deepEqual(t.docs.get('spielesammlung_hub_v1/123').players,[{uid:'alice'}]);
  assert.equal(t.writes.length,2,'only inventory and private receipt may change');
  assert.ok(t.writes.every(k=>k.startsWith('deal_peek_inventory_v1/alice')));
 }
});
test('game-specific index validation prevents outside-case revealing or charging',async()=>{
 for(const [caseCount,index] of [[26,26],[27,27],[28,28],[27,28]]){
  const t=setup({caseCount});
  const result=await t.request(path,{case:index,requestId:'peek-invalid-index-12345'});
  assert.equal(result.value.ok,false);
  assert.equal(result.value.error,index>27?'INVALID_REQUEST':'INVALID_CASE');
  assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,2);
  assert.equal(t.writes.length,0);
 }
});
test('retry of last 28-case Joker is private, idempotent even after balance becomes zero',async()=>{
 const t=setup({caseCount:28,balance:1});
 const req={case:27,requestId:'peek-28-retry-123456'};
 const first=await t.request(path,req);
 assert.equal(first.value.amount,28);
 const again=await t.request(path,req);
 assert.deepEqual(again.value,{ok:true,case:27,amount:28,balance:0,replayed:true});
 assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,0);
 assert.equal(t.writes.length,2);
});
test('pending or already opened 27th/28th case cannot be peeked',async()=>{
 for(const variant of ['opened','pending']){
  const t=setup({caseCount:28,...(variant==='opened'?{opened:[27]}:{pending:{case:27,actor:'alice'}})});
  const result=await t.request(path,{case:27,requestId:'peek-blocked-case-12345'});
  assert.equal(result.value.error,'CASE_NOT_CLOSED');
  assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,2);
  assert.equal(t.writes.length,0);
 }
});
test('accepted banker deal, finished game and stranger are denied without debit',async()=>{
 for(const opts of [{caseCount:28,active:false},{caseCount:28,phase:'final'},{caseCount:28,member:false}]){
  const t=setup(opts);
  const result=await t.request(path,{case:26,requestId:'peek-unauthorized-12345'});
  assert.equal(result.value.ok,false);
  assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,2);
  assert.equal(t.writes.length,0);
 }
});
