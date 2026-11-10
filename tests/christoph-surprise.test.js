import test from 'node:test';
import assert from 'node:assert/strict';
import {installChristophSurpriseApi,CHRISTOPH_SURPRISE_ID} from '../christoph-surprise-api.js';

function makeServer(){
 const routes=new Map(),documents=new Map(),writes=[];
 let currentUid='player-david',serial=Promise.resolve();
 function snap(key){
  const value=documents.get(key);
  return {exists:value!==undefined,data:()=>value===undefined?undefined:structuredClone(value)};
 }
 const db={
  collection(name){return {doc(uid){return {key:name+'/'+uid,get:async()=>snap(name+'/'+uid)}}}},
  runTransaction(fn){
   const task=serial.then(async()=>{
    const pending=[];
    const tx={
     get:async ref=>snap(ref.key),
     set:(ref,patch,options)=>pending.push({kind:'set',key:ref.key,patch:structuredClone(patch),merge:!!options?.merge}),
     create:(ref,patch)=>pending.push({kind:'create',key:ref.key,patch:structuredClone(patch)}),
     update:(ref,patch)=>pending.push({kind:'update',key:ref.key,patch:structuredClone(patch)})
    };
    const result=await fn(tx);
    for(const op of pending){
     if(op.kind==='create'&&documents.has(op.key))throw Error('ALREADY_CREATED');
     if(op.kind==='update'&&!documents.has(op.key))throw Error('NOT_FOUND');
     documents.set(op.key,op.merge||op.kind==='update'
      ?{...documents.get(op.key),...op.patch}:op.patch);
     writes.push(op);
    }
    return result;
   });
   serial=task.catch(()=>{});
   return task;
  }
 };
 const app={get:(name,...handlers)=>routes.set('GET '+name,handlers),
  post:(name,...handlers)=>routes.set('POST '+name,handlers)};
 installChristophSurpriseApi(app,{
  verifyProfile:async token=>token==='player-'+currentUid?{uid:currentUid}:null,
  getFirestore:()=>db
 });
 async function call(method,path,{token}={}){
  const handlers=routes.get(method+' /api/christoph-surprise/'+path);
  assert.ok(handlers);
  const req={get:()=> 'Bearer '+(token||'player-'+currentUid)};
  const res={headers:{},statusCode:200,set(key,value){this.headers[key]=value;return this},
   status(code){this.statusCode=code;return this},json(data){this.payload=data;return data}};
  await new Promise((resolve,reject)=>{
   handlers[0](req,res,()=>{
    Promise.resolve().then(()=>handlers[1](req,res)).then(resolve,reject);
   });
  });
  return res;
 }
 return {db,call,documents,writes,setUid:x=>{currentUid=x}};
}

test('unclaimed status does not modify player inventory',async()=>{
 const h=makeServer();
 const result=await h.call('GET','status');
 assert.equal(result.statusCode,200);
 assert.equal(result.payload.id,CHRISTOPH_SURPRISE_ID);
 assert.equal(result.payload.claimed,false);
 assert.equal(result.payload.acknowledged,false);
 assert.equal(h.writes.length,0);
});

test('claim adds precisely 2 monster spins and 2 Mützen Jackpot vouchers without overwriting existing data',async()=>{
 const h=makeServer();
 h.documents.set('deal_or_no_deal_christmas_v1/player-david',{monsterWheelTickets:3,cards:{'christmas-01':2},opened:18});
 h.documents.set('deal_christmas_hats_v1/player-david',{version:1,status:'finished',freeVoucherUsed:true,bonusTickets:7,runsStarted:12});
 const first=await h.call('POST','claim');
 assert.equal(first.statusCode,200);
 assert.equal(first.payload.claimed,true);
 assert.equal(first.payload.alreadyClaimed,false);
 assert.equal(first.payload.monsterTickets,2);
 assert.equal(first.payload.hatsVouchers,2);
 assert.equal(h.documents.get('deal_or_no_deal_christmas_v1/player-david').monsterWheelTickets,5);
 assert.deepEqual(h.documents.get('deal_or_no_deal_christmas_v1/player-david').cards,{'christmas-01':2});
 const hats=h.documents.get('deal_christmas_hats_v1/player-david');
 assert.equal(hats.bonusTickets,9);
 assert.equal(hats.runsStarted,12);
 assert.equal(hats.freeVoucherUsed,true);
 assert.equal(h.writes.length,3);
 const again=await h.call('POST','claim');
 assert.equal(again.payload.alreadyClaimed,true);
 assert.equal(h.writes.length,3,'idempotent retry causes zero writes');
 assert.equal(h.documents.get('deal_or_no_deal_christmas_v1/player-david').monsterWheelTickets,5);
});

test('two simultaneous tabs do not duplicate awards and acknowledgement survives re-entry',async()=>{
 const h=makeServer();
 const [a,b]=await Promise.all([h.call('POST','claim'),h.call('POST','claim')]);
 assert.equal(a.payload.claimed,true);
 assert.equal(b.payload.alreadyClaimed,true);
 assert.equal(h.documents.get('deal_or_no_deal_christmas_v1/player-david').monsterWheelTickets,2);
 const hats=h.documents.get('deal_christmas_hats_v1/player-david');
 assert.equal(hats.bonusTickets,2);
 assert.equal(hats.voucherOnly,true,'first-ever Hats profile becomes a voucher-only stub');
 assert.equal((await h.call('GET','status')).payload.acknowledged,false);
 const ack=await h.call('POST','ack');
 assert.equal(ack.statusCode,200);
 assert.equal(ack.payload.acknowledged,true);
 assert.equal((await h.call('GET','status')).payload.acknowledged,true);
 assert.equal((await h.call('POST','claim')).payload.acknowledged,true);
 assert.equal(h.writes.length,4,'one extra write only for the acknowledgement');
 await h.call('POST','ack');
 assert.equal(h.writes.length,4,'ack retry must not write again');
});

test('each player gets one independent award; authentication prevents claiming another user balance',async()=>{
 const h=makeServer();
 const stranger=await h.call('POST','claim',{token:'other-token'});
 assert.equal(stranger.statusCode,401);
 assert.equal(h.writes.length,0);
 await h.call('POST','claim');
 h.setUid('player-vanessa');
 await h.call('POST','claim');
 assert.equal(h.documents.get('deal_or_no_deal_christmas_v1/player-david').monsterWheelTickets,2);
 assert.equal(h.documents.get('deal_or_no_deal_christmas_v1/player-vanessa').monsterWheelTickets,2);
 assert.equal(h.documents.get('deal_christmas_hats_v1/player-vanessa').bonusTickets,2);
 assert.equal(h.documents.get('deal_christmas_hats_v1/player-david').bonusTickets,2);
 assert.equal(h.writes.length,6);
});
