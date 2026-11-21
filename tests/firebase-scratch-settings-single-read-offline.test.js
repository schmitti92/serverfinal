import test from 'node:test';
import assert from 'node:assert/strict';
import {installSharedLobby} from '../shared-lobby.js';
import {normalizeScratchSettings,DOG_SCRATCH_SETTINGS_COLLECTION,DOG_SCRATCH_SETTINGS_ID} from '../dog/christmas-scratch-settings.js';

// Execute the actual authenticated Render endpoint against a fake store.
// Count every document read and write; do not touch production Firestore.
function harness(initial=normalizeScratchSettings(null)){
 const key=DOG_SCRATCH_SETTINGS_COLLECTION+'/'+DOG_SCRATCH_SETTINGS_ID;
 const documents=new Map([[key,structuredClone(initial)]]);
 const counts={reads:0,writes:0},routes=new Map();
 const db={
  collection:name=>({doc:id=>({
   path:name+'/'+id,
   get:async()=>{counts.reads++;const value=documents.get(name+'/'+id);
    return {exists:value!==undefined,data:()=>structuredClone(value)}},
   set:async value=>{counts.writes++;documents.set(name+'/'+id,structuredClone(value))}
  })}),
  runTransaction:async()=>{throw Error('unexpected transaction')}
 };
 const app={
  get(path,...fn){routes.set('GET '+path,fn)},
  post(path,...fn){routes.set('POST '+path,fn)},
  use(){}
 };
 installSharedLobby(app,{getFirestore:()=>db,
  verifyProfile:async token=>token==='alice'?{uid:'alice',name:'Alice'}:null,
  clock:()=>1234567});
 async function save(settings,token='alice'){
  const handlers=routes.get('POST /api/hub/scratch/settings');
  assert.equal(handlers.length,2);
  const req={body:{settings},get:header=>header==='authorization'?'Bearer '+token:''};
  const res={statusCode:200,status(n){this.statusCode=n;return this},
   json(value){this.body=value;return this}};
  let downstream;
  await handlers[0](req,res,()=>{downstream=handlers[1](req,res)});
  if(downstream)await downstream;
  return {status:res.statusCode,...res.body};
 }
 return {save,counts,stored:()=>documents.get(key)};
}
function legacySettings(){
 const settings=normalizeScratchSettings(null);
 delete settings.numberOne20;
 for(const variant of Object.values(settings.variants)){
  delete variant.coinAmounts;
  delete variant.moneySymbolWeights;
  delete variant.giftSymbolWeights;
 }
 for(const id of ['gifts','snow_collect']){
  const variant=settings.variants[id];
  for(const field of ['price','doubleChancePer1000','lightChancePer1000','lightMin','lightMax'])
   delete variant[field];
 }
 settings.freeEnabled=true;
 return settings;
}

test('Legacy form retains all four saved sections using one GET and one validated write',async()=>{
 const initial=normalizeScratchSettings(null);
 initial.variants.gifts.coinAmounts=[8,18,38];
 initial.variants.elf.moneySymbolWeights=[100,200,700];
 initial.variants.premium_27.giftSymbolWeights=[100,100,100,100,600];
 initial.variants.gifts.price=333;
 initial.variants.gifts.doubleChancePer1000=44;
 initial.variants.snow_collect.price=444;
 initial.variants.snow_collect.lightMax=16;
 initial.numberOne20.price=777;
 const h=harness(initial),result=await h.save(legacySettings());
 assert.equal(result.status,200);
 assert.equal(result.ok,true);
 assert.equal(h.counts.reads,1,'one Firestore document read rather than four');
 assert.equal(h.counts.writes,1,'the existing settings write remains durable');
 const after=h.stored();
 assert.equal(after.freeEnabled,true,'legacy client's new change is saved');
 assert.deepEqual(after.variants.gifts.coinAmounts,[8,18,38]);
 assert.deepEqual(after.variants.elf.moneySymbolWeights,[100,200,700]);
 assert.deepEqual(after.variants.premium_27.giftSymbolWeights,[100,100,100,100,600]);
 assert.equal(after.variants.gifts.price,333);
 assert.equal(after.variants.gifts.doubleChancePer1000,44);
 assert.equal(after.variants.snow_collect.price,444);
 assert.equal(after.variants.snow_collect.lightMax,16);
 assert.equal(after.numberOne20.price,777);
 assert.equal(after.updatedBy,'alice');
});

test('Fully specified settings need zero Firestore reads before one write',async()=>{
 const h=harness(),payload=normalizeScratchSettings(null);
 payload.freeEnabled=true;
 payload.variants.gifts.price=280;
 const result=await h.save(payload);
 assert.equal(result.status,200);
 assert.equal(h.counts.reads,0,'complete settings do not require preserved fields');
 assert.equal(h.counts.writes,1);
 assert.equal(h.stored().variants.gifts.price,280);
});

test('One omitted field group still produces exactly one read, not additional fallback GETs',async()=>{
 const h=harness(),payload=normalizeScratchSettings(null);
 delete payload.numberOne20;
 const result=await h.save(payload);
 assert.equal(result.status,200);
 assert.equal(h.counts.reads,1);
 assert.equal(h.counts.writes,1);
});

test('Unauthenticated and invalid settings never read or write the shared document',async()=>{
 const h=harness(),payload=normalizeScratchSettings(null);
 assert.equal((await h.save(payload,'invalid')).status,401);
 const broken=structuredClone(payload);
 broken.variants.elf.weights.coins=1;
 assert.equal((await h.save(broken)).status,400);
 assert.deepEqual(h.counts,{reads:0,writes:0});
});
