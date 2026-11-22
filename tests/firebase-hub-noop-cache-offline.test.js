import test from 'node:test';
import assert from 'node:assert/strict';
import {installSharedLobby} from '../shared-lobby.js';

// Exercise actual Render HTTP handlers and Firestore transaction decisions.
// This fake store only counts calls; it never contacts or changes Firebase.
function harness(){
 const docs=new Map(),routes=new Map();
 const stats={gets:0,transactionReads:0,sets:0,deletes:0};
 let now=1_000_000,previous=Promise.resolve();
 const snapshot=key=>({
  exists:docs.has(key),
  data:()=>structuredClone(docs.get(key))
 });
 const store={
  collection:name=>({doc:id=>{
   const path=name+'/'+id;
   return {path,get:async()=>{stats.gets++;return snapshot(path)}};
  }}),
  runTransaction(callback){
   const result=previous.catch(()=>{}).then(async()=>{
    const changes=[];
    const tx={
     get:async ref=>{stats.transactionReads++;return snapshot(ref.path)},
     set:(ref,value)=>changes.push(()=>{
      stats.sets++;docs.set(ref.path,structuredClone(value));
     }),
     delete:ref=>changes.push(()=>{
      stats.deletes++;docs.delete(ref.path);
     }),
     update:(ref,value)=>changes.push(()=>{
      stats.sets++;docs.set(ref.path,{...docs.get(ref.path),...structuredClone(value)});
     })
    };
    const value=await callback(tx);
    changes.forEach(change=>change());
    return value;
   });
   previous=result.catch(()=>{});
   return result;
  }
 };
 const app={
  get(path,...handlers){routes.set('GET '+path,handlers)},
  post(path,...handlers){routes.set('POST '+path,handlers)},
  use(){}
 };
 installSharedLobby(app,{
  getFirestore:()=>store,
  verifyProfile:async()=>({uid:'alice',name:'Alice'}),
  clock:()=>now,
  codeGenerator:()=> '123',
  isMatchFinished:async()=>false,
  christmasEventActive:()=>true
 });
 const matchId='12345678-1234-4321-8123-123456789abc';
 async function call(method,path,body={},user='alice'){
  const requested=path.split('/');
  const found=[...routes.entries()].find(([key])=>{
   const [verb,pattern]=key.split(' '),segments=pattern.split('/');
   return verb===method&&segments.length===requested.length&&segments.every((s,i)=>s.startsWith(':')||s===requested[i]);
  });
  assert.ok(found,'Registered route: '+method+' '+path);
  const [registration,handlers]=found,parts=registration.split(' ')[1].split('/');
  const params=Object.fromEntries(parts.flatMap((p,i)=>p.startsWith(':')?[[p.slice(1),requested[i]]]:[]));
  const req={params,body,method,route:{path:registration.split(' ')[1]},
   hubIdentity:{uid:user,name:user==='alice'?'Alice':'Bob'},get:()=>''};
  const res={statusCode:200,status(code){this.statusCode=code;return this},
   json(data){this.body=data;return this}};
  await handlers.at(-1)(req,res);
  return {status:res.statusCode,...res.body};
 }
 async function created(){const result=await call('POST','/api/hub/rooms');
  assert.equal(result.status,200);return result.room.code;}
 const sync=(code,user='alice')=>call('POST','/api/hub/rooms/'+code+'/sync',{matchId},user);
 const avatar=(code,value,user='alice')=>call('POST','/api/hub/rooms/'+code+'/dog/avatar',{avatar:value},user);
 const join=(code,user='alice',body={})=>call('POST','/api/hub/rooms/'+code+'/join',body,user);
 const health=()=>call('GET','/api/hub/health');
 return {docs,stats,created,sync,avatar,join,health,call,advance:ms=>{now+=ms},matchId};
}

test('Unchanged DOG avatar no longer breaks the 12-second read-only completion preflight',async()=>{
 const h=harness(),code=await h.created();
 assert.equal((await h.sync(code)).status,200);
 assert.equal(h.stats.gets,1);
 const noChange=await h.avatar(code,0);
 assert.equal(noChange.status,200);
 assert.equal(noChange.room.revision,1);
 assert.equal(h.stats.sets,1,'no-op avatar must never write room');
 assert.equal((await h.sync(code)).status,200);
 assert.equal(h.stats.gets,1,'no-op leaves the previous sync GET usable');
 const metrics=(await h.health()).hubMutationCache;
 assert.equal(metrics.noops,1);
 assert.equal(metrics.avoidedInvalidations,1);

 const genuine=await h.avatar(code,1);
 assert.equal(genuine.status,200);
 assert.equal(genuine.room.revision,2);
 assert.equal(h.stats.sets,2,'real avatar change persists the room');
 assert.equal((await h.sync(code)).room.revision,2);
 assert.equal(h.stats.gets,2,'real write invalidates the sync cache');
 assert.equal((await h.health()).hubMutationCache.committed,1);
});

test('Repeated room join does not force a new Firestore GET; a new member still does',async()=>{
 const h=harness(),code=await h.created();
 await h.sync(code);assert.equal(h.stats.gets,1);
 const again=await h.join(code,'alice');
 assert.equal(again.status,200);
 assert.equal(again.room.revision,1);
 await h.sync(code);
 assert.equal(h.stats.gets,1,'unchanged join does not flush the read cache');
 assert.equal(h.stats.sets,1);

 const guest=await h.join(code,'bob');
 assert.equal(guest.status,200);
 assert.equal(guest.room.players.length,2);
 assert.equal(h.stats.sets,2);
 const current=await h.sync(code,'bob');
 assert.equal(current.room.players.length,2);
 assert.equal(h.stats.gets,2,'new member must invalidate cached reader');
 assert.equal((await h.join(code,'bob')).room.revision,2);
 await h.sync(code,'alice');
 assert.equal(h.stats.gets,2,'Bob reconnecting must not trigger extra GETs');
 const metrics=(await h.health()).hubMutationCache;
 assert.equal(metrics.joinNoops,2);
 assert.equal(metrics.joinCommitted,1);
});

test('External Render revision is noticed by a no-op and never hidden by stale cache',async()=>{
 const h=harness(),code=await h.created();
 await h.sync(code);
 const docPath='spielesammlung_hub_v1/'+code,latest=h.docs.get(docPath);
 const moved=structuredClone(latest);
 moved.revision=latest.revision+1;
 moved.players[0].dogAvatar=4;
 h.docs.set(docPath,moved); // Simulated already committed update from another Render instance
 const noChange=await h.avatar(code,4);
 assert.equal(noChange.status,200);
 assert.equal(noChange.room.revision,2);
 assert.equal(h.stats.sets,1,'unchanged action does not overwrite remote change');
 const fresh=await h.sync(code);
 assert.equal(fresh.status,200);
 assert.equal(fresh.room.revision,2);
 assert.equal(fresh.room.players[0].dogAvatar,4);
 assert.equal(h.stats.gets,2,'revision mismatch invalidates outdated sync snapshot');
 assert.equal((await h.health()).hubMutationCache.avoidedInvalidations,0);
});

test('Room deletion still invalidates read-only caches and preserves delete response',async()=>{
 const h=harness(),code=await h.created();
 await h.sync(code);assert.equal(h.stats.gets,1);
 const left=await h.call('POST','/api/hub/rooms/'+code+'/leave');
 assert.equal(left.status,200);
 assert.equal(left.left,true);
 assert.equal(left.roomDeleted,true);
 assert.equal(h.stats.deletes,1);
 const missing=await h.sync(code);
 assert.equal(missing.status,404);
 assert.equal(h.stats.gets,2,'deleted room cannot be returned from a cached sync');
});

test('Unauthorized avatar update cannot touch Firestore state or invalidate cached revisions',async()=>{
 const h=harness(),code=await h.created();
 await h.sync(code);
 const denied=await h.avatar(code,5,'bob');
 assert.equal(denied.status,403);
 assert.equal(h.stats.sets,1);
 await h.sync(code);
 assert.equal(h.stats.gets,1);
});

test('DOG avatar-only updates do not flush unrelated Firestore level/XP/read-only statistics caches',async()=>{
 const h=harness(),code=await h.created();
 const first=await h.call('GET','/api/hub/dog/stats');
 assert.equal(first.status,200);
 const metadataGets=h.stats.gets;
 assert.ok(metadataGets>=1,'one verified DOG statistics document read');

 const avatar=await h.avatar(code,4);
 assert.equal(avatar.status,200);
 assert.equal(avatar.room.players[0].dogAvatar,4);
 const second=await h.call('GET','/api/hub/dog/stats');
 assert.equal(second.status,200);
 assert.equal(h.stats.gets,metadataGets,
  'a cosmetic room avatar change must not discard the 30s player metadata cache');
 const report=(await h.health()).dogMetaInFlightReads;
 assert.ok(report.cacheHits>=1,'second status call reused the same Firebase document');
 // The hub room was still durably updated; the optimization only skips
 // invalidation of unrelated per-account XP and wallet read snapshots.
 assert.equal(h.stats.sets,2);
});
