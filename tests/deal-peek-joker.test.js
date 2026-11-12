import test from 'node:test';
import assert from 'node:assert/strict';
import {installPeekJoker} from '../deal-peek-joker.js';

function setup({balance=2,member=true,active=true,opened=[],phase='open',caseCount=26,pending=null,playerCount=4}={}){
 const handlers=new Map(),docs=new Map(),writes=[];
 const uid='alice',code='123',gameId='game-1';
 const fixture=[
  {id:'alice',name:'Alice',case:0,deal:active?null:100},
  {id:'bob',name:'Bob',case:4,deal:null},
  {id:'carol',name:'Carol',case:5,deal:null},
  {id:'dave',name:'David',case:caseCount-1,deal:null}
 ].slice(0,playerCount);
 docs.set('deal_or_no_deal_matches_v1/123',{game:{id:gameId,phase,values:Array.from({length:caseCount},(_,i)=>i+1),players:fixture,opened,pending}});
 docs.set('spielesammlung_hub_v1/123',{players:member?[{uid}]:[]});
 docs.set('deal_peek_inventory_v1/alice',{balance});
 const db={collection(name){return {doc(id){return ref(name+'/'+id)}}}};
 function ref(key){return {key,collection(sub){return {doc(id){return ref(key+'/'+sub+'/'+id)}}},async get(){return snap(key)}}}
 function snap(key){return {exists:docs.has(key),data:()=>docs.get(key)}}
 db.runTransaction=async fn=>{
  const mutations=[];
  const tx={get:async r=>snap(r.key),
   set:(r,data,opt)=>mutations.push(()=>{docs.set(r.key,opt?.merge?{...docs.get(r.key),...data}:data);writes.push(r.key)}),
   create:(r,data)=>mutations.push(()=>{if(docs.has(r.key))throw Error('ALREADY_EXISTS');docs.set(r.key,data);writes.push(r.key)})};
  const result=await fn(tx);for(const mutation of mutations)mutation();return result;
 };
 const app={get:(route,...args)=>handlers.set('GET '+route,args),post:(route,...args)=>handlers.set('POST '+route,args)};
 installPeekJoker(app,{verifyProfile:async()=>({uid}),getFirestore:()=>db});
 async function request(route,body){
  const endpoint=handlers.get(route);assert.ok(endpoint,'route exists');
  const req={params:{code},body,peekUid:uid,get:()=> 'Bearer valid'};
  const res={statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this},status(n){this.statusCode=n;return this},json(value){this.value=value;return this}};
  await endpoint[0](req,res,()=>{});
  if(endpoint[1])await endpoint[1](req,res);
  return res;
 }
 return {request,docs,writes};
}
const path='POST /api/deal-or-no-deal/:code/peek';
const payload={case:4,requestId:'test-request-12345'};

test('one Joker reveals every opponent personal case, excludes own, uses two private writes',async()=>{
 const t=setup();
 const first=await t.request(path,payload);
 assert.equal(first.statusCode,200);
 assert.equal(first.value.ok,true);
 assert.equal(first.value.balance,1);
 assert.equal(first.value.replayed,false);
 assert.equal(first.value.case,4);
 assert.equal('amount' in first.value,false,'single amount must not reveal the wrong case');
 assert.deepEqual(first.value.cases,[
  {id:'bob',name:'Bob',case:4,amount:5},
  {id:'carol',name:'Carol',case:5,amount:6},
  {id:'dave',name:'David',case:25,amount:26}
 ]);
 assert.ok(first.value.cases.every(p=>p.id!=='alice'&&p.case!==0));
 assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,1);
 assert.equal(t.writes.length,2);
 assert.ok(t.writes.every(k=>k.startsWith('deal_peek_inventory_v1/alice')));
 assert.deepEqual(t.docs.get('deal_or_no_deal_matches_v1/123').game.opened,[]);
});

test('same request ID recovers all opponents without spending a second Joker',async()=>{
 const t=setup({balance:1});
 const first=await t.request(path,payload);
 const again=await t.request(path,payload);
 assert.equal(first.value.balance,0);
 assert.equal(again.value.replayed,true);
 assert.deepEqual(again.value.cases,first.value.cases);
 assert.equal(again.value.balance,0);
 assert.equal(t.writes.length,2);
 assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,0);
});
test('historical single-case receipts reconstitute only opponent results at no extra charge',async()=>{
 const t=setup({balance:0});
 t.docs.set('deal_peek_inventory_v1/alice/receipts/'+payload.requestId,
  {code:'123',gameId:'game-1',case:4,amount:5,balance:0,createdAt:1});
 const res=await t.request(path,payload);
 assert.equal(res.value.ok,true);
 assert.equal(res.value.replayed,true);
 assert.deepEqual(res.value.cases.map(p=>p.id),['bob','carol','dave']);
 assert.ok(!('amount' in res.value));
 assert.equal(t.writes.length,0);
});
test('one Joker can privately reveal only your own personal case, hiding every opponent',async()=>{
 const t=setup();
 const action={case:0,requestId:'peek-own-case-123456789'};
 const res=await t.request(path,action);
 assert.equal(res.statusCode,200);
 assert.equal(res.value.mode,'own');
 assert.deepEqual(res.value.cases,[{id:'alice',name:'Alice',case:0,amount:1}]);
 assert.equal(res.value.balance,1);
 assert.equal(t.writes.length,2);
 assert.equal(t.docs.get('deal_or_no_deal_matches_v1/123').game.opened.length,0);
 const replay=await t.request(path,action);
 assert.equal(replay.value.replayed,true);
 assert.deepEqual(replay.value.cases,res.value.cases);
 assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,1);
 assert.equal(t.writes.length,2,'retry never consumes another Joker');
});
test('arbitrary non-personal case is denied without a Joker debit',async()=>{
 const t=setup();
 const res=await t.request(path,{case:6,requestId:'peek-not-owned-12345'});
 assert.equal(res.value.error,'NOT_OPPONENT_CASE');
 assert.equal(t.writes.length,0);
});
test('single-player matches can inspect their own case for one Joker but not arbitrary cases',async()=>{
 const t=setup({playerCount:1,balance:1});
 const invalid=await t.request(path,payload);
 assert.equal(invalid.value.error,'NOT_OPPONENT_CASE');
 assert.equal(t.writes.length,0);
 const own=await t.request(path,{case:0,requestId:'peek-solo-own-123456789'});
 assert.equal(own.statusCode,200);
 assert.equal(own.value.mode,'own');
 assert.deepEqual(own.value.cases.map(p=>p.id),['alice']);
 assert.equal(own.value.balance,0);
 assert.equal(t.writes.length,2);
});
test('two-, three- and four-player matches include exactly the other players',async()=>{
 for(const playerCount of [2,3,4]){
  const t=setup({playerCount});
  const res=await t.request(path,payload);
  assert.equal(res.value.ok,true);
  assert.equal(res.value.cases.length,playerCount-1);
  assert.ok(res.value.cases.every(p=>p.id!=='alice'));
  assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,1);
 }
});
test('the last selected opponent case works with 26–30 cases',async()=>{
 for(const caseCount of [26,27,28,29,30]){
  const t=setup({caseCount});
  const last=caseCount-1;
  const res=await t.request(path,{case:last,requestId:'peek-last-case-'+caseCount+'-12345'});
  assert.equal(res.statusCode,200);
  assert.equal(res.value.cases.at(-1).case,last);
  assert.equal(res.value.cases.at(-1).amount,caseCount);
  assert.equal(res.value.balance,1);
  assert.equal(t.writes.length,2);
 }
});
test('30-case first batch allows own and opponent Joker, but selecting personal case does not',async()=>{
 for(const phase of ['batch-pick','batch-reveal']){
  for(const selectedCase of [0,29]){
   const t=setup({caseCount:30,phase,balance:1});
   const res=await t.request(path,{case:selectedCase,requestId:'peek-batch-'+phase+'-'+selectedCase+'-123'});
   assert.equal(res.statusCode,200,phase+' case '+selectedCase);
   assert.equal(res.value.mode,selectedCase===0?'own':'opponents');
   assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,0);
   assert.equal(t.writes.length,2);
  }
 }
 const notReady=setup({caseCount:30,phase:'select'});
 const denied=await notReady.request(path,{case:0,requestId:'peek-before-selection-12345'});
 assert.equal(denied.value.error,'JOKER_NOT_AVAILABLE');
 assert.equal(notReady.writes.length,0);
});
test('30-case Joker reveals last personal case privately, with one debit and safe retry',async()=>{
 const t=setup({caseCount:30,balance:1});
 const game=t.docs.get('deal_or_no_deal_matches_v1/123').game;
 game.values[29]=5000000000;
 const request={case:29,requestId:'peek-thirtieth-50000000-123'};
 const first=await t.request(path,request);
 assert.equal(first.statusCode,200);
 assert.equal(first.value.ok,true);
 assert.equal(first.value.mode,'opponents');
 assert.equal(first.value.cases.find(p=>p.id==='dave').amount,5000000000);
 assert.equal(first.value.cases.some(p=>p.id==='alice'),false);
 assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,0);
 assert.deepEqual(game.opened,[]);
 const replay=await t.request(path,request);
 assert.equal(replay.value.replayed,true);
 assert.deepEqual(replay.value.cases,first.value.cases);
 assert.equal(t.writes.length,2,'recovery never charges a second Joker');
});
test('29th opponent case may hold ten million, and remains private',async()=>{
 const t=setup({caseCount:29,balance:1});
 t.docs.get('deal_or_no_deal_matches_v1/123').game.values[28]=1000000000;
 const req={case:28,requestId:'peek-tenth-million-29-123'};
 const res=await t.request(path,req);
 assert.equal(res.value.cases.find(p=>p.id==='dave').amount,1000000000);
 assert.equal(res.value.balance,0);
 assert.equal(t.docs.get('deal_or_no_deal_matches_v1/123').game.opened.length,0);
 assert.equal(t.writes.length,2);
 assert.equal((await t.request(path,req)).value.replayed,true);
 assert.equal(t.writes.length,2);
});
test('wrong or reused request IDs cannot be repurposed for another opponent',async()=>{
 const t=setup();
 await t.request(path,payload);
 const res=await t.request(path,{...payload,case:5});
 assert.equal(res.value.error,'REQUEST_REUSED');
 assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,1);
 assert.equal(t.writes.length,2);
});
test('all opened or pending personal cases are never inspected',async()=>{
 for(const opts of [{opened:[4]},{pending:{case:5,actor:'bob'}},{opened:[5]},{opened:[25]}]){
  const t=setup(opts);
  const res=await t.request(path,{case:4,requestId:'peek-protected-personal-123'});
  assert.equal(res.value.error,'CASE_NOT_CLOSED');
  assert.equal(t.writes.length,0);
 }
});
test('accepted banker offer, final state, and departed room member never spend Joker',async()=>{
 for(const opts of [{active:false},{phase:'final'},{member:false}]){
  const t=setup(opts);
  const r=await t.request(path,payload);
  assert.equal(r.value.ok,false);
  assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,2);
  assert.equal(t.writes.length,0);
 }
});
test('without balance, the private receipt is not created',async()=>{
 const t=setup({balance:0});
 const r=await t.request(path,payload);
 assert.equal(r.value.error,'NO_JOKERS');
 assert.equal(t.docs.has('deal_peek_inventory_v1/alice/receipts/'+payload.requestId),false);
});
test('out-of-range case indexes are never accepted or charged',async()=>{
 for(const [caseCount,index] of [[26,26],[27,27],[28,28],[29,29],[30,30],[28,29],[27,28],[29,30]]){
  const t=setup({caseCount});
  const res=await t.request(path,{case:index,requestId:'peek-invalid-index-12345'});
  assert.equal(res.value.error,index>29?'INVALID_REQUEST':'INVALID_CASE');
  assert.equal(t.writes.length,0);
 }
});
test('inventory remains a user-only read, never a shared room mutation',async()=>{
 const t=setup();
 const r=await t.request('GET /api/deal-or-no-deal/peek/me');
 assert.equal(r.value.balance,2);
 assert.equal(r.headers['Cache-Control'],'no-store');
 assert.equal(t.writes.length,0);
});

test('all 26–30 modes let players choose own case or opponents without mixing results',async()=>{
 for(const count of [26,27,28,29,30]){
  const t=setup({caseCount:count,balance:2});
  const own=await t.request(path,{case:0,requestId:'peek-own-'+count+'-test-0001'});
  assert.equal(own.statusCode,200);
  assert.equal(own.value.mode,'own');
  assert.equal(own.value.cases.length,1);
  assert.equal(own.value.cases[0].id,'alice');
  const others=await t.request(path,{case:count-1,requestId:'peek-other-'+count+'-test-0002'});
  assert.equal(others.statusCode,200);
  assert.equal(others.value.mode,'opponents');
  assert.deepEqual(others.value.cases.map(p=>p.id),['bob','carol','dave']);
  assert.equal(others.value.cases.some(p=>p.id==='alice'),false);
  assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,0);
  assert.equal(t.writes.length,4,'exactly two transactions; each only 2 writes');
 }
});

test('a personal case already pending reveal cannot be inspected or consume a Joker',async()=>{
 const t=setup({pending:{case:0,actor:'bob'}});
 const res=await t.request(path,{case:0,requestId:'peek-pending-own-000123'});
 assert.equal(res.value.error,'CASE_NOT_CLOSED');
 assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,2);
 assert.equal(t.writes.length,0);
});

test('a previously used Joker receipt cannot be replayed with a different mode or case',async()=>{
 const t=setup({balance:2});
 const own={case:0,requestId:'peek-mode-lock-000123'};
 await t.request(path,own);
 const hijack=await t.request(path,{...own,case:4});
 assert.equal(hijack.value.error,'REQUEST_REUSED');
 assert.equal(t.docs.get('deal_peek_inventory_v1/alice').balance,1);
 assert.equal(t.writes.length,2);
});
