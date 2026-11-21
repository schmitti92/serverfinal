import test from 'node:test';
import assert from 'node:assert/strict';
import {installSharedLobby} from '../shared-lobby.js';
import {DOG_VILLAGE_COLLECTION,DOG_GLOBAL_VILLAGE_ID} from '../dog/christmas-village.js';

// Execute the actual authenticated Express route and Firestore transactions
// with a fully offline in-memory store, never against production documents.
function rig(){
 const docs=new Map(),routes=new Map(),reads=[],writes=[];
 const snap=path=>({exists:docs.has(path),data:()=>structuredClone(docs.get(path))});
 const store={
  collection:name=>({doc:id=>{
   const path=name+'/'+id;
   return {path,get:async()=>{reads.push(path);return snap(path)}};
  }}),
  runTransaction:async callback=>{
   const changes=[];
   const result=await callback({
    get:async ref=>{reads.push(ref.path);return snap(ref.path)},
    set:(ref,value)=>changes.push(()=>{writes.push('set:'+ref.path);docs.set(ref.path,structuredClone(value))}),
    update:(ref,value)=>changes.push(()=>{writes.push('update:'+ref.path);docs.set(ref.path,{...docs.get(ref.path),...structuredClone(value)})})
   });
   changes.forEach(fn=>fn());
   return result;
  }
 };
 const app={
  get(path,...handlers){routes.set('GET '+path,handlers)},
  post(path,...handlers){routes.set('POST '+path,handlers)},
  use(){}
 };
 installSharedLobby(app,{getFirestore:()=>store,
  verifyProfile:async token=>token==='alice'?{uid:'alice',name:'Alice'}:null,
  clock:()=>500000,christmasEventActive:()=>true});
 async function call(method,path,body={},token='alice'){
  const handlers=routes.get(method+' '+path);
  assert.ok(handlers,'API route exists: '+path);
  const req={body,get:key=>key==='authorization'?'Bearer '+token:'',params:{}};
  const res={statusCode:200,status(code){this.statusCode=code;return this},json(value){this.body=value;return this}};
  async function run(i){
   if(i>=handlers.length)return;
   let next=null;await handlers[i](req,res,()=>{next=run(i+1)});
   if(next)await next;
  }
  await run(0);
  return {status:res.statusCode,...res.body};
 }
 const path=id=>DOG_VILLAGE_COLLECTION+'/'+id;
 return {docs,reads,writes,call,path};
}

test('Metadata-only check for absent legacy village reads just one document and writes nothing',async()=>{
 const h=rig(),shared=h.path(DOG_GLOBAL_VILLAGE_ID);
 h.docs.set(shared,{lightsTenths:340,revision:3});
 const result=await h.call('POST','/api/hub/christmas-village/import',{metadataOnly:true});
 assert.equal(result.status,200);assert.equal(result.ok,true);
 assert.equal(result.imported,false);assert.equal(result.checked,true);
 assert.equal('village' in result,false,'caller follows with a separate authoritative village GET');
 assert.deepEqual(h.reads,[h.path('alice')]);
 assert.deepEqual(h.writes,[]);
 const village=await h.call('GET','/api/hub/christmas-village');
 assert.equal(village.village.lightsTenths,340);
 assert.equal(h.reads.at(-1),shared,'GET still reads live global balance');
});

test('Old API without metadataOnly retains complete village response',async()=>{
 const h=rig();
 h.docs.set(h.path(DOG_GLOBAL_VILLAGE_ID),{lightsTenths:120,revision:2});
 const result=await h.call('POST','/api/hub/christmas-village/import',{});
 assert.equal(result.ok,true);assert.equal(result.imported,false);
 assert.equal(result.village.lightsTenths,120);
 assert.deepEqual(h.reads,[h.path('alice'),h.path(DOG_GLOBAL_VILLAGE_ID)]);
 assert.deepEqual(h.writes,[]);
});

test('Actual legacy balance is merged once and never lost on repeated checks',async()=>{
 const h=rig(),shared=h.path(DOG_GLOBAL_VILLAGE_ID),old=h.path('alice');
 h.docs.set(shared,{lightsTenths:120,totalEarnedTenths:120,revision:2});
 h.docs.set(old,{lightsTenths:350,totalEarnedTenths:350,revision:1,giftsCollected:2});
 const first=await h.call('POST','/api/hub/christmas-village/import',{metadataOnly:true});
 assert.equal(first.ok,true);assert.equal(first.imported,true);assert.equal(first.checked,true);
 assert.deepEqual(h.reads,[old,shared]);
 assert.deepEqual(h.writes,['set:'+shared,'update:'+old]);
 assert.equal(h.docs.get(shared).lightsTenths,470);
 assert.equal(h.docs.get(old).mergedToGlobal,DOG_GLOBAL_VILLAGE_ID);
 h.reads.length=0;h.writes.length=0;
 const second=await h.call('POST','/api/hub/christmas-village/import',{metadataOnly:true});
 assert.equal(second.imported,false);
 assert.deepEqual(h.reads,[old],'already-merged check does not load global document');
 assert.deepEqual(h.writes,[],'never reaward legacy currency');
 assert.equal(h.docs.get(shared).lightsTenths,470);
});

test('Import remains authenticated and a failed auth never probes the wallet',async()=>{
 const h=rig();
 const r=await h.call('POST','/api/hub/christmas-village/import',{metadataOnly:true},'invalid');
 assert.equal(r.status,401);
 assert.deepEqual(h.reads,[]);
 assert.deepEqual(h.writes,[]);
});
