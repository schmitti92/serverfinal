import test from 'node:test';
import assert from 'node:assert/strict';
import {createDogWriteDiagnostics,DOG_WRITE_DIAGNOSTICS_WINDOW_MS} from '../dog-write-diagnostics.js';
import {installSharedLobby} from '../shared-lobby.js';

test('DOG write diagnostics count committed writes by collection, never player/document IDs',async()=>{
 let now=1_200_000;
 const metrics=createDogWriteDiagnostics({clock:()=>now});
 const touched=[];
 const store={
  async runTransaction(fn){
   // Firestore can rerun its callback on contention. The failed attempt must
   // never contribute to our success metrics.
   await fn({get:async ref=>({exists:true,data:()=>({})}),
    set:(ref,payload)=>touched.push([ref.path,payload]),
    update:ref=>touched.push([ref.path,'update']),
    delete:ref=>touched.push([ref.path,'delete'])});
   return fn({get:async ref=>({exists:true,data:()=>({})}),
    set:(ref,payload)=>touched.push([ref.path,payload]),
    update:ref=>touched.push([ref.path,'update']),
    delete:ref=>touched.push([ref.path,'delete'])});
  }
 };
 const result=await metrics.transaction(store,'dog-scratch-buy',async tx=>{
  tx.set({path:'dog_christmas_scratch_v1/alice'},{coins:200});
  tx.update({path:'dog_christmas_villages_v1/lichtertal'},{lights:1});
  return {ok:true};
 });
 assert.deepEqual(result,{ok:true});
 assert.equal(touched.length,4,'fake transaction callback ran twice');
 const diag=metrics.snapshot();
 assert.equal(diag.windowMinutes,10);
 assert.equal(diag.transactions,1);
 assert.equal(diag.writeCalls,2,'only committed attempt is counted');
 assert.equal(diag.byCollection.dog_christmas_scratch_v1,1);
 assert.equal(diag.byCollection.dog_christmas_villages_v1,1);
 assert.equal(JSON.stringify(diag).includes('alice'),false,'no player ID in health');
 assert.equal(JSON.stringify(diag).includes('lichtertal'),false,'no document ID in health');
 metrics.record('dog-match',{},false);
 assert.equal(metrics.snapshot().noops,1);
 now+=DOG_WRITE_DIAGNOSTICS_WINDOW_MS+60000;
 assert.equal(metrics.snapshot().writeCalls,0,'old counters roll off');
});

function rig(){
 const docs=new Map(),routes=new Map(),counters={reads:0,writes:0};
 const snap=path=>({exists:docs.has(path),data:()=>structuredClone(docs.get(path))});
 let sequence=Promise.resolve();
 const db={
  collection:name=>({doc:id=>({path:name+'/'+id,
   get:async()=>{counters.reads++;return snap(name+'/'+id)}})}),
  runTransaction(fn){
   const promise=sequence.catch(()=>{}).then(async()=>{
    const pending=[];
    const tx={
     get:async ref=>{counters.reads++;return snap(ref.path)},
     set(ref,data){pending.push(()=>{counters.writes++;docs.set(ref.path,structuredClone(data))})},
     update(ref,data){pending.push(()=>{counters.writes++;docs.set(ref.path,{...docs.get(ref.path),...structuredClone(data)})})},
     delete(ref){pending.push(()=>{counters.writes++;docs.delete(ref.path)})}
    };
    const result=await fn(tx);for(const task of pending)task();return result;
   });
   sequence=promise.catch(()=>{});
   return promise;
  }
 };
 const app={
  get(path,...handlers){routes.set('GET '+path,handlers)},
  post(path,...handlers){routes.set('POST '+path,handlers)},
  use(){}
 };
 let now=1_200_000;
 installSharedLobby(app,{getFirestore:()=>db,clock:()=>now,
  codeGenerator:()=> '123',verifyProfile:async()=>({uid:'alice',name:'Alice'}),
  christmasEventActive:()=>false});
 async function request(method,url,body={},uid='alice'){
  const segments=url.split('/');
  const route=[...routes.entries()].find(([key])=>{
   const [verb,pattern]=key.split(' '),parts=pattern.split('/');
   return verb===method&&segments.length===parts.length&&
    parts.every((p,i)=>p.startsWith(':')||p===segments[i]);
  });
  assert.ok(route,'route exists '+method+' '+url);
  const [key,handlers]=route,parts=key.split(' ')[1].split('/');
  const params=Object.fromEntries(parts.flatMap((p,i)=>p.startsWith(':')?[[p.slice(1),segments[i]]]:[]));
  const req={hubIdentity:{uid,name:uid==='alice'?'Alice':'Bob'},body,params,get:()=>''};
  const res={statusCode:200,status(n){this.statusCode=n;return this},json(o){this.body=o;return this}};
  await handlers.at(-1)(req,res);
  return {status:res.statusCode,...res.body};
 }
 const room=method=>request(method,'/api/hub/rooms/123');
 return {counters,docs,request,room};
}

test('DOG repeated readiness toggles that leave game unchanged produce zero Firestore writes',async()=>{
 const h=rig();
 assert.equal((await h.request('POST','/api/hub/rooms')).status,200);
 assert.equal((await h.request('POST','/api/hub/rooms/123/join',{},'bob')).status,200);
 assert.equal((await h.request('POST','/api/hub/rooms/123/select',{game:'dog'})).status,200);
 let before=h.counters.writes;
 const noChange=await h.request('POST','/api/hub/rooms/123/ready',{ready:false});
 assert.equal(noChange.status,200);
 assert.equal(h.counters.writes,before,'repeated false readiness is read-only');
 const first=await h.request('POST','/api/hub/rooms/123/ready',{ready:true});
 assert.equal(first.status,200);
 assert.equal(h.counters.writes,before+1);
 const duplicate=await h.request('POST','/api/hub/rooms/123/ready',{ready:true});
 assert.equal(duplicate.status,200);
 assert.equal(h.counters.writes,before+1,'repeated true readiness cannot save again');
 const diag=await h.request('GET','/api/hub/health');
 assert.equal(diag.dogWrites10m.byKind['dog-lobby'].noops,2);
 assert.equal(diag.dogWrites10m.byKind['dog-lobby'].writeCalls,1);
 assert.equal(diag.dogWrites10m.byCollection.spielesammlung_hub_v1,1);
 assert.equal(JSON.stringify(diag.dogWrites10m).includes('alice'),false);
});

test('Repeated unchanged DOG game selection is no longer an extra Firestore room write',async()=>{
 const h=rig();
 assert.equal((await h.request('POST','/api/hub/rooms')).status,200);
 assert.equal((await h.request('POST','/api/hub/rooms/123/join',{},'bob')).status,200);
 const selected=await h.request('POST','/api/hub/rooms/123/select',{game:'dog'});
 assert.equal(selected.status,200);
 const firstRevision=selected.room.revision,writes=h.counters.writes;
 const duplicate=await h.request('POST','/api/hub/rooms/123/select',{game:'dog'});
 assert.equal(duplicate.status,200);
 assert.equal(duplicate.room.revision,firstRevision);
 assert.equal(h.counters.writes,writes,'identical DOG preparation must not rewrite room');
 const health=await h.request('GET','/api/hub/health');
 // Duplicate selection returns an explicit no-op before the automatic diff guard.
  assert.equal(health.hubMutationCache.dogAutoNoops,0);
 assert.equal(health.dogWrites10m.byKind['dog-lobby'].noops,1);
 assert.equal(health.dogWrites10m.byKind['dog-lobby'].writeCalls,0,
  'the original select was made from an unselected room, not yet counted as a DOG write');
});

test('DOG diagnostic collection totals do not perform Firebase reads of their own',()=>{
 const diagnostics=createDogWriteDiagnostics({clock:()=>1000000});
 const before=diagnostics.snapshot();
 assert.equal(before.writeCalls,0);
 assert.deepEqual(before.byCollection,{});
 assert.deepEqual(before.byKind,{});
});
