import test from 'node:test';
import assert from 'node:assert/strict';
import {createDogSharedReadCoordinator} from '../dog-shared-read-coordinator.js';

test('read-only Firestore docs are reused within 30s, then refreshed automatically',async()=>{
 let now=1_000_000,calls=0,level=1;
 const db={},ref={path:'dog_christmas_villages_v1/lichtertal_2026_shared',
  async get(){calls++;const snapshot=level;return {exists:true,data:()=>({academy:snapshot})}}};
 const coordinator=createDogSharedReadCoordinator({ttlMs:30_000,clock:()=>now});
 assert.equal((await coordinator.read(db,ref)).data().academy,1);
 level=2;
 assert.equal((await coordinator.read(db,ref)).data().academy,1);
 assert.equal(calls,1,'repeated view must not issue another Firebase document GET');
 now+=30_001;
 assert.equal((await coordinator.read(db,ref)).data().academy,2);
 assert.equal(calls,2);
 assert.equal(coordinator.stats().ttlMs,30000);
 assert.equal(coordinator.stats().cacheHits,1);
});

test('server-side confirmed mutation invalidates cached view immediately',async()=>{
 let calls=0,coins=100;
 const db={},ref={path:'dog_christmas_scratch_wallet_v1/chrisUid',
  async get(){calls++;return {exists:true,data:()=>({coins})}}};
 const coordinator=createDogSharedReadCoordinator({ttlMs:30_000});
 assert.equal((await coordinator.read(db,ref)).data().coins,100);
 coins=500;
 coordinator.invalidate();
 assert.equal((await coordinator.read(db,ref)).data().coins,500);
 assert.equal(calls,2);
 assert.equal(coordinator.stats().invalidations,1);
});

test('different users never share private wallet documents',async()=>{
 const coordinator=createDogSharedReadCoordinator({ttlMs:60_000});
 const db={};let calls=0;
 const alice={path:'dog_christmas_scratch_wallet_v1/alice',async get(){calls++;return {data:()=>({coins:300})}}};
 const bob={path:'dog_christmas_scratch_wallet_v1/bob',async get(){calls++;return {data:()=>({coins:900})}}};
 assert.equal((await coordinator.read(db,alice)).data().coins,300);
 assert.equal((await coordinator.read(db,bob)).data().coins,900);
 assert.equal((await coordinator.read(db,alice)).data().coins,300);
 assert.equal(calls,2);
});

test('cache is bounded and cannot accumulate unlimited player records',async()=>{
 const db={},coordinator=createDogSharedReadCoordinator({
  ttlMs:30_000,maxCachedPerDatabase:2
 });
 let calls=0;
 const ref=id=>({path:'dog_player_statistics_v1/'+id,
  async get(){calls++;return {id}}});
 await coordinator.read(db,ref('a'));
 await coordinator.read(db,ref('b'));
 await coordinator.read(db,ref('c'));
 assert.equal(coordinator.stats().cached,2);
 await coordinator.read(db,ref('b'));
 assert.equal(calls,3,'recent b stays cached');
 await coordinator.read(db,ref('a'));
 assert.equal(calls,4,'oldest a must be evicted');
});

test('read in flight before invalidation cannot contaminate newer cached results',async()=>{
 const db={},coordinator=createDogSharedReadCoordinator({ttlMs:30_000});
 let resolveOld,reads=0,value=1;
 const ref={path:'dog_christmas_research_v1/chris',get(){
  reads++;
  if(reads===1)return new Promise(resolve=>{resolveOld=resolve});
  return Promise.resolve({data:()=>({value})});
 }};
 const pending=coordinator.read(db,ref);
 await Promise.resolve(); // Start the first backend read.
 coordinator.invalidate();
 value=2;
 assert.equal((await coordinator.read(db,ref)).data().value,2);
 resolveOld({data:()=>({value:1})});
 assert.equal((await pending).data().value,1);
 assert.equal((await coordinator.read(db,ref)).data().value,2);
 assert.equal(reads,2);
});

test('one players DOG reward cannot discard another players in-flight read',async()=>{
 const db={},cache=createDogSharedReadCoordinator({ttlMs:30000});
 const bob='dog_christmas_scratch_wallet_v1/bob',alice='dog_christmas_scratch_wallet_v1/alice';
 let releaseBob,readsBob=0,readsAlice=0;
 const bobRef={path:bob,get(){
  readsBob++;
  return new Promise(resolve=>{releaseBob=()=>resolve({data:()=>({coins:700})})});
 }};
 const aliceRef={path:alice,async get(){
  readsAlice++;
  return {data:()=>({coins:300})};
 }};
 const pendingBob=cache.read(db,bobRef);
 await Promise.resolve();
 await cache.read(db,aliceRef);
 cache.invalidate(alice);
 releaseBob();
 assert.equal((await pendingBob).data().coins,700);
 assert.equal((await cache.read(db,bobRef)).data().coins,700);
 assert.equal(readsBob,1,'unrelated in-flight GET must populate Bob cache');
 assert.equal(readsAlice,1);
});

test('targeted DOG cache invalidation blocks an earlier stale in-flight snapshot',async()=>{
 const db={},cache=createDogSharedReadCoordinator({ttlMs:30000});
 const path='dog_christmas_scratch_wallet_v1/alice';
 let oldDone,reads=0,coins=1;
 const ref={path,get(){
  reads++;
  const captured=coins;
  if(reads===1)return new Promise(resolve=>{
   oldDone=()=>resolve({data:()=>({coins:captured})});
  });
  return Promise.resolve({data:()=>({coins:captured})});
 }};
 const stale=cache.read(db,ref);
 await Promise.resolve();
 coins=2;
 cache.invalidate(path);
 assert.equal((await cache.read(db,ref)).data().coins,2);
 oldDone();
 assert.equal((await stale).data().coins,1,'original requester can see its historical response');
 assert.equal((await cache.read(db,ref)).data().coins,2,
  'historical response must never poison newer cache');
 assert.equal(reads,2);
});
