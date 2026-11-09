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
 const invoke=async(pendingId)=>{
  const req={query:pendingId?{pendingId}:{},get:()=> 'Bearer test-token'};
  const res={statusCode:200,header:{},set(k,v){this.header[k]=v;return this},
   status(n){this.statusCode=n;return this},json(x){this.payload=x;return x}};
  await new Promise((resolve,reject)=>{
   handlers[0](req,res,()=>resolve(handlers[1](req,res))).catch(reject);
  });
  return res;
 };
 return {invoke};
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
