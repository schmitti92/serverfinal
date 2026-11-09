import test from 'node:test';
import assert from 'node:assert/strict';
import {installChristmasIceApi} from '../christmas-ice-api.js';
import {newIceState} from '../christmas-ice-engine.js';

const receiptId = 'original-strike-00000001';
const build = (withReceipt=true) => {
 const state = newIceState(()=>5);
 if(withReceipt) state.lastActions.push({id:receiptId,result:{targets:[2],found:false,completed:0}});
 const progress = {exists:true,data:()=>state};
 const wallet = {exists:true,data:()=>({balance:100000000})};
 const routes = new Map();
 const app = {
  get:(path,...handlers)=>routes.set('GET '+path,handlers),
  post:(path,...handlers)=>routes.set('POST '+path,handlers),
 };
 const db = {collection:name=>({doc:uid=>({
  get:async()=>name==='christmas_ice_progress_v1'?progress:wallet
 })})};
 installChristmasIceApi(app,{verifyProfile:async()=>({uid:'user-david'}),getFirestore:()=>db});
 const handlers=routes.get('GET /api/christmas-ice/me');
 const unlockHandlers=routes.get('GET /api/christmas-ice/unlocks');
 const invoke=async(pendingId)=>{
  const req={query:pendingId?{pendingId}:{},get:()=> 'Bearer test-token'};
  const res={statusCode:200,header:{},set(k,v){this.header[k]=v;return this},
   status(n){this.statusCode=n;return this},json(x){this.payload=x;return x}};
  await new Promise((resolve,reject)=>{
   handlers[0](req,res,()=>resolve(handlers[1](req,res))).catch(reject);
  });
  return res;
 };
 const invokeUnlocks=async()=>{
  const req={get:()=> 'Bearer test-token'};
  const res={statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this},
   status(n){this.statusCode=n;return this},json(x){this.payload=x;return x}};
  await new Promise((resolve,reject)=>{
   unlockHandlers[0](req,res,()=>resolve(unlockHandlers[1](req,res))).catch(reject);
  });
  return res;
 };
 return {invoke,invokeUnlocks,state};
};

test('GET with original receipt ID confirms the existing strike without another debit',async()=>{
 const {invoke}=build();
 const r=await invoke(receiptId);
 assert.equal(r.statusCode,200);
 assert.equal(r.payload.pendingAction.applied,true);
 assert.deepEqual(r.payload.pendingAction.result.targets,[2]);
 assert.equal(r.payload.state.balance,100000000);
 assert.equal(r.payload.state.lastActions,undefined);
 assert.equal(r.header['Cache-Control'],'no-store');
});

test('GET missing receipt reports unconfirmed instead of inventing one',async()=>{
 const {invoke}=build(false);
 const r=await invoke(receiptId);
 assert.equal(r.statusCode,200);
 assert.deepEqual(r.payload.pendingAction,{applied:false,result:null});
});

test('GET missing query preserves the old response contract',async()=>{
 const {invoke}=build();
 const r=await invoke();
 assert.equal(r.statusCode,200);
 assert.equal(r.payload.pendingAction,undefined);
});

test('invalid receipt ID is rejected before database access',async()=>{
 const {invoke}=build();
 const r=await invoke('bad!');
 assert.equal(r.statusCode,400);
 assert.equal(r.payload.error,'INVALID_REQUEST_ID');
});

test('20 finished Christmas pictures unlock Kniffel dice permanently, without granting free inventory',async()=>{
 const {invokeUnlocks,state}=build(false);
 state.completed=19;state.maxRewarded=19;
 let response=await invokeUnlocks();
 assert.equal(response.payload.ok,true);
 assert.equal(response.payload.kniffelChristmasDice,false);
 assert.equal(response.payload.janSchlappen,true);
 assert.equal(response.headers['Cache-Control'],'no-store');
 state.completed=20;state.maxRewarded=20;
 response=await invokeUnlocks();
 assert.equal(response.payload.kniffelChristmasDice,true);
 // The permanent best-progress counter survives a reset of the current board.
 state.completed=0;state.maxRewarded=20;
 response=await invokeUnlocks();
 assert.equal(response.payload.kniffelChristmasDice,true);
 assert.equal(response.payload.janSchlappen,true);
 assert.equal(state.freeHammers.lucky,0,'unlock only changes presentation, no hammer payout');
});
