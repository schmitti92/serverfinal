import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDogSharedReadCoordinator} from '../dog-shared-read-coordinator.js';

// Fake Firestore: never connects to Firebase, charges no real document reads.
function fakeStore(){
 const documents=new Map(),readCounts=new Map(),waiters=new Map();
 const db={collection:name=>({doc:id=>{
  const path=name+'/'+id;
  return {path,get:async()=>{
   readCounts.set(path,(readCounts.get(path)||0)+1);
   const value=structuredClone(documents.get(path));
   if(waiters.has(path))await waiters.get(path);
   return {exists:value!==undefined,data:()=>structuredClone(value)};
  }};
 }})};
 const hold=path=>{
  let done;waiters.set(path,new Promise(resolve=>{done=resolve}));
  return ()=>{waiters.delete(path);done()};
 };
 return {db,documents,readCounts,hold,reads:path=>readCounts.get(path)||0};
}

test('Three concurrent Christmas-village reads share one actual Firestore get, with no TTL',async()=>{
 const f=fakeStore(),cache=createDogSharedReadCoordinator();
 const collection='dog_christmas_village_v1',doc='global';
 const path=collection+'/'+doc;
 f.documents.set(path,{lightsTenths:200,revision:1});
 const release=f.hold(path);
 const values=Array.from({length:3},()=>cache.read(f.db,f.db.collection(collection).doc(doc)));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.reads(path),1,'one database GET rather than three');
 release();
 const results=await Promise.all(values);
 assert.deepEqual(results.map(x=>x.data().lightsTenths),[200,200,200]);
 assert.equal(cache.stats().documentReads,1);
 assert.equal(cache.stats().sharedReads,2);
 assert.equal(cache.stats().ttlMs,0);
 f.documents.set(path,{lightsTenths:500,revision:2});
 assert.equal((await cache.read(f.db,f.db.collection(collection).doc(doc))).data().revision,2,
  'next call after completion is fresh, no stale wallet/credits');
 assert.equal(f.reads(path),2);
});

test('Private DOG research/level documents never cross user IDs',async()=>{
 const f=fakeStore(),cache=createDogSharedReadCoordinator();
 const alice='dog_christmas_research_v1/alice',bob='dog_christmas_research_v1/bob';
 f.documents.set(alice,{owner:'alice',level:2});
 f.documents.set(bob,{owner:'bob',level:7});
 const freeA=f.hold(alice),freeB=f.hold(bob);
 const [a1,a2,b1]=[
  cache.read(f.db,f.db.collection('dog_christmas_research_v1').doc('alice')),
  cache.read(f.db,f.db.collection('dog_christmas_research_v1').doc('alice')),
  cache.read(f.db,f.db.collection('dog_christmas_research_v1').doc('bob'))
 ];
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.reads(alice),1);
 assert.equal(f.reads(bob),1);
 freeA();freeB();
 const resolved=await Promise.all([a1,a2,b1]);
 assert.deepEqual(resolved.map(x=>x.data().owner),['alice','alice','bob']);
 assert.equal(cache.stats().sharedReads,1);
});

test('Shared read failures are released; retry performs a new Firestore read',async()=>{
 let calls=0;const db={},coordinator=createDogSharedReadCoordinator();
 const ref={path:'dog_christmas_village_v1/global',get:async()=>{
  calls++;
  if(calls===1)throw Error('FIRESTORE_TEMPORARILY_UNAVAILABLE');
  return {exists:true,data:()=>({revision:2})};
 }};
 await assert.rejects(coordinator.read(db,ref),/FIRESTORE_TEMPORARILY_UNAVAILABLE/);
 assert.equal((await coordinator.read(db,ref)).data().revision,2);
 assert.equal(calls,2);
 assert.equal(coordinator.stats().errors,1);
});

test('All targeted read-only meta routes are wired; purchases and claims remain transactions',()=>{
 const source=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
 assert.match(source,/const dogMetaReadCoordinator=createDogSharedReadCoordinator\(\)/);
 assert.match(source,/dogMetaInFlightReads:dogMetaReadCoordinator\.stats\(\)/);
 const routes=[
  ['/api/hub/scratch',10],
  ['/api/hub/dog/stats',1],
  ['/api/hub/dog/christmas-intro',2],
  ['/api/hub/dog/research',2],
  ['/api/hub/dog/level',4],
  ['/api/hub/christmas-village',1],
  ['/api/hub/christmas-tree-rewards',2]
 ];
 for(const [route,expected] of routes){
  const begin="app.get('"+route+"',authentication,handler(async req=>{";
  const start=source.indexOf(begin);
  assert.ok(start>=0,'route exists: '+route);
  const next=source.indexOf("app.post('",start+begin.length);
  const nextGet=source.indexOf("app.get('",start+begin.length);
  const end=Math.min(...[next,nextGet].filter(x=>x>=0));
  const block=source.slice(start,end);
  const count=(block.match(/readDogMeta\(store,/g)||[]).length;
  assert.equal(count,expected,'only and all GET reads coalesced on '+route);
  assert.doesNotMatch(block,/\.get\(\)/,'no redundant direct document GET in '+route);
 }
 for(const mutation of [
  "/api/hub/scratch/buy",
  "/api/hub/dog/research/upgrade",
  "/api/hub/dog/research/claim",
  "/api/hub/dog/level/rewards/claim",
  "/api/hub/christmas-village/upgrade",
  "/api/hub/christmas-tree-rewards/claim"
 ]){
  const start=source.indexOf("app.post('"+mutation+"'");
  assert.ok(start>=0,'server retains mutation route '+mutation);
  const next=source.indexOf("app.",start+8);
  const block=source.slice(start,next<0?source.length:next);
  assert.match(block,/runTransaction/,'write remains transactional: '+mutation);
 }
});
