import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installDogPostgresPilotHttp} from '../dog-postgres-pilot-http.js';

const BASE='/api/hub/dog/pg-pilot';
function appHarness(){
 const registered={get:new Map(),post:new Map()};
 const app={
  get(path,fn){registered.get.set(path,fn)},
  post(path,fn){registered.post.set(path,fn)}
 };
 async function request(method,path,{
  token,code='PAA234',body={}
 }={}){
  const fn=registered[method].get(path);
  if(!fn)throw Error('NO_ROUTE '+method+' '+path);
  const req={body,params:{code},
   get:key=>key==='authorization'?token===undefined?'':token:null};
  const res={
   statusCode:200,headers:{},result:null,
   status(n){this.statusCode=n;return this},
   set(key,value){this.headers[key]=value;return this},
   json(value){this.result=value;return this}
  };
  await fn(req,res);
  return {status:res.statusCode,body:res.result,headers:res.headers};
 }
 return {app,registered,request};
}
function fakeBindings({schema=true}={}){
 const counts={pools:0,sql:[],closes:0,reads:[],moves:[],firestore:0};
 const bindings={
  getPool:async()=>{
   counts.pools++;
   return {
    async query(sql){
     counts.sql.push(sql);
     return {rows:[{
      room:'dog_room_states',
      rewards:schema?'dog_room_pending_rewards':null,
      completions:'dog_room_reward_completions'
     }]};
    },
    async connect(){throw Error('UNEXPECTED_SQL_CONNECTION')},
    async end(){counts.closes++}
   };
  },
  verifyProfile:async token=>{
   if(token!=='alice-id-token')throw Error('INVALID_FIREBASE_TOKEN');
   return {uid:'alice'};
  },
  getFirestore:()=>{counts.firestore++;throw Error('NO_REAL_FIREBASE')},
  coordinatorFactory:({verifyProfile,getFirestore})=>({
   async read({token,code}){
    counts.reads.push({token,code});
    const user=await verifyProfile(token);
    return {room:{code,me:user.uid,match:{dog:{private:true}}}};
   },
   async move(data){
    counts.moves.push(data);
    await verifyProfile(data.token);
    if(data.action?.type==='reward')throw Object.assign(new Error('Secret payout failed'),{code:'DOG_PG_PAYOUT_PENDING'});
    if(data.action?.type==='stale')throw Object.assign(new Error('stale action'),{code:'DOG_PG_SEASONAL_STALE_REVISION'});
    return {room:{code:data.code,me:'alice'},replayed:false,settled:false};
   }
  })
 };
 return {bindings,counts};
}
test('Feature flag defaults off; live Firebase DOG routes are not shadowed, and no PG pool is opened',async()=>{
 const h=appHarness(),b=fakeBindings();
 const state=installDogPostgresPilotHttp(h.app,{
  enabled:false,...b.bindings
 });
 assert.deepEqual(state,{enabled:false});
 assert.deepEqual([...h.registered.get.keys()],[BASE+'/status']);
 assert.equal(h.registered.post.size,0);
 assert.equal(b.counts.pools,0);
 assert.equal(b.counts.firestore,0);
 assert.deepEqual((await h.request('get',BASE+'/status')).body,{
  ok:true,enabled:false,scope:'isolated-test-only-pg-dog-rooms',
  publicLobby:'firestore-unchanged'
 });
});
test('Pilot endpoints reject missing login and public 3-digit room before any SQL/Firebase access',async()=>{
 const h=appHarness(),b=fakeBindings();
 installDogPostgresPilotHttp(h.app,{enabled:true,...b.bindings});
 const path=BASE+'/rooms/:code/action';
 const noLogin=await h.request('post',path,{code:'PAA234'});
 assert.equal(noLogin.status,401);
 assert.equal(noLogin.body.error,'DOG_PG_LOGIN_REQUIRED');
 const ordinary=await h.request('post',path,{
  token:'Bearer alice-id-token',code:'123'
 });
 assert.equal(ordinary.status,400);
 assert.equal(ordinary.body.error,'DOG_PG_PILOT_ONLY');
 assert.equal(b.counts.pools,0);
 assert.equal(b.counts.firestore,0);
 assert.equal(b.counts.moves.length,0);
});
test('Enabled pilot verifies all required SQL tables and keeps action identity server-owned',async()=>{
 const h=appHarness(),b=fakeBindings();
 installDogPostgresPilotHttp(h.app,{enabled:true,...b.bindings});
 const path=BASE+'/rooms/:code/action';
 const body={
  uid:'mallory',code:'123',matchId:'real-match',
  expectedDogRevision:42,actionId:'unique-pg-action-0001',
  action:{type:'move',cardId:9}
 };
 const action=await h.request('post',path,{
  token:'Bearer alice-id-token',code:'PAA234',body
 });
 assert.equal(action.status,200);
 assert.equal(action.body.room.me,'alice');
 assert.equal(b.counts.moves.length,1);
 assert.deepEqual(Object.keys(b.counts.moves[0]).sort(),[
  'action','actionId','code','expectedDogRevision','matchId','token'
 ]);
 assert.equal(b.counts.moves[0].code,'PAA234');
 assert.equal(b.counts.moves[0].token,'alice-id-token');
 assert.equal(b.counts.pools,1);
 assert.equal(b.counts.sql.length,1,'one schema validation, NO SQL bootstrap for each move');
 const read=await h.request('get',BASE+'/rooms/:code',{
  token:'Bearer alice-id-token',code:'PAA234'
 });
 assert.equal(read.status,200);
 assert.equal(read.body.room.me,'alice');
 assert.equal(b.counts.pools,1);
 assert.equal(b.counts.firestore,0);
});
test('A lost Firebase payout returns explicit retryable pending status with no leaked private error',async()=>{
 const h=appHarness(),b=fakeBindings();
 installDogPostgresPilotHttp(h.app,{enabled:true,...b.bindings});
 const resp=await h.request('post',BASE+'/rooms/:code/action',{
  token:'Bearer alice-id-token',code:'PAA234',
  body:{action:{type:'reward'}}
 });
 assert.equal(resp.status,503);
 assert.deepEqual(resp.body,{ok:false,error:'DOG_PG_PAYOUT_PENDING'});
 assert.equal(resp.headers['Retry-After'],'2');
 assert.doesNotMatch(JSON.stringify(resp),/Secret payout failed/);
 const stale=await h.request('post',BASE+'/rooms/:code/action',{
  token:'Bearer alice-id-token',code:'PAA234',
  body:{action:{type:'stale'}}
 });
 assert.equal(stale.status,409);
 assert.equal(stale.body.error,'DOG_PG_SEASONAL_STALE_REVISION');
});
test('Missing SQL migration fails closed without Firestore fallback and closes orphaned PG pools',async()=>{
 const h=appHarness(),b=fakeBindings({schema:false});
 installDogPostgresPilotHttp(h.app,{enabled:true,...b.bindings});
 for(let i=0;i<2;i++){
  const resp=await h.request('get',BASE+'/rooms/:code',{
   token:'Bearer alice-id-token',code:'PAA234'
  });
  assert.equal(resp.status,503);
  assert.equal(resp.body.error,'DOG_PG_PILOT_SCHEMA_MISSING');
 }
 assert.equal(b.counts.pools,2,'each failing probe may retry with a clean PG pool');
 assert.equal(b.counts.closes,2,'failed schema check does not leak PG connections');
 assert.equal(b.counts.reads.length,0,'never returns an unverified SQL room');
 assert.equal(b.counts.firestore,0,'never downgrades to Firebase or RAM');
});
test('Concurrent pilot requests initialize exactly one lazy PG connection and no polling',async()=>{
 const h=appHarness(),b=fakeBindings();
 let release;
 const gate=new Promise(resolve=>{release=resolve});
 const getPool=b.bindings.getPool;
 b.bindings.getPool=async()=>{await gate;return getPool()};
 installDogPostgresPilotHttp(h.app,{enabled:true,...b.bindings});
 const inputs={token:'Bearer alice-id-token',code:'PAA234'};
 const a=h.request('get',BASE+'/rooms/:code',inputs);
 const c=h.request('get',BASE+'/rooms/:code',inputs);
 release();
 const results=await Promise.all([a,c]);
 assert.deepEqual(results.map(r=>r.status),[200,200]);
 assert.equal(b.counts.pools,1);
 assert.equal(b.counts.sql.length,1);
});
test('Production server registers the pilot exclusively via an opt-in flag and lazy pg import',()=>{
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 const packageJson=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.match(server,/installDogPostgresPilotHttp\(app,\{/);
 assert.match(server,/enabled:process\.env\.DOG_PG_PILOT_ENABLED==='1'/);
 assert.match(server,/await import\('pg'\)/);
 assert.match(server,/DOG_PG_DATABASE_URL/);
 assert.equal(typeof packageJson.dependencies.pg,'string');
 assert.doesNotMatch(server,/createDogPostgresPilotCoordinator\(\{/,
  'server must never implicitly instantiate pilot when the flag is disabled');
});
