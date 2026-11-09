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


// End-to-end route-level tests with an in-memory Firestore transaction double.
// They count writes while exercising the same authenticated action handler.
function iceActionFixture({star=19,free=0,balance=100000000}={}){
 let progress={...newIceState(()=>star),star,
  freeHammers:{single:free,double:0,lucky:0}};
 let walletBalance=balance;
 const writes=[],reads=[],routes=new Map();
 const app={
  get:(path,...handlers)=>routes.set('GET '+path,handlers),
  post:(path,...handlers)=>routes.set('POST '+path,handlers)
 };
 const db={
  collection:name=>({doc:uid=>({name,uid})}),
  async runTransaction(callback){
   const pending=[];
   const tx={
    async get(ref){
     reads.push(ref.name);
     if(ref.name==='christmas_ice_progress_v1')return {exists:!!progress,data:()=>progress};
     if(ref.name==='deal_or_no_deal_wallets_v1')return {exists:true,data:()=>({balance:walletBalance})};
     if(ref.name==='deal_peek_inventory_v1')return {exists:false,data:()=>({balance:0})};
     throw Error('Unknown collection '+ref.name);
    },
    set:(ref,data,opts)=>pending.push({ref,data,opts}),
    create:(ref,data)=>pending.push({ref,data}),
    update:(ref,data)=>pending.push({ref,data})
   };
   const result=await callback(tx);
   for(const operation of pending){
    writes.push(operation.ref.name);
    if(operation.ref.name==='christmas_ice_progress_v1')progress=operation.data;
    else if(operation.ref.name==='deal_or_no_deal_wallets_v1')walletBalance=operation.data.balance;
   }
   return result;
  }
 };
 installChristmasIceApi(app,{verifyProfile:async()=>({uid:'test-ice-player'}),getFirestore:()=>db});
 const handlers=routes.get('POST /api/christmas-ice/action');
 const invoke=async body=>{
  const req={body,get:()=> 'Bearer test-token'},res={
   statusCode:200,set(){return this},status(code){this.statusCode=code;return this},
   json(data){this.payload=data;return data}
  };
  await new Promise((resolve,reject)=>{
   handlers[0](req,res,()=>resolve(handlers[1](req,res))).catch(reject);
  });
  return res;
 };
 return {invoke,writes,reads,getProgress:()=>progress,getWallet:()=>walletBalance};
}

test('free hammer without a money prize writes ice progress only, never an unchanged wallet',async()=>{
 const f=iceActionFixture({star:19,free:1});
 const result=await f.invoke({type:'strike',index:0,hammer:'single',requestId:'free-hammer-no-win-0001'});
 assert.equal(result.statusCode,200);
 assert.equal(result.payload.result.found,false);
 assert.deepEqual(f.writes,['christmas_ice_progress_v1']);
 assert.equal(f.getWallet(),100000000);
 assert.equal(f.getProgress().freeHammers.single,0);
 assert.equal(f.getProgress().opened.length,1);
});

test('free hammer that wins money still saves the wallet and ice progress atomically',async()=>{
 const f=iceActionFixture({star:0,free:1});
 const result=await f.invoke({type:'strike',index:0,hammer:'single',requestId:'free-hammer-money-win-0001'});
 assert.equal(result.statusCode,200);
 assert.equal(result.payload.result.found,true);
 assert.equal(result.payload.result.gift?.kind,'money');
 assert.deepEqual(f.writes,['deal_or_no_deal_wallets_v1','christmas_ice_progress_v1']);
 assert.equal(f.getWallet(),100000000+result.payload.result.gift.amount);
 assert.equal(f.getProgress().completed,1);
});

test('paid hammer still debits wallet and original receipt is read-only on replay',async()=>{
 const f=iceActionFixture({star:19,free:0});
 const action={type:'strike',index:0,hammer:'single',requestId:'paid-hammer-single-0001'};
 const first=await f.invoke(action);
 assert.equal(first.statusCode,200);
 assert.equal(first.payload.state.balance,70000000);
 assert.deepEqual(f.writes,['deal_or_no_deal_wallets_v1','christmas_ice_progress_v1']);
 const repeat=await f.invoke(action);
 assert.equal(repeat.statusCode,200);
 assert.equal(repeat.payload.result.replayed,true);
 assert.deepEqual(f.writes,['deal_or_no_deal_wallets_v1','christmas_ice_progress_v1']);
 assert.equal(f.getWallet(),70000000,'replay never charges twice');
});
