import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dogMetadataWasWritten,dogWrittenMetadataPaths} from '../dog-meta-write-policy.js';
import {createDogWriteDiagnostics} from '../dog-write-diagnostics.js';
import {createDogSharedReadCoordinator} from '../dog-shared-read-coordinator.js';

const ROOM='spielesammlung_hub_v1';

test('ordinary DOG action touching only the room keeps its 30-second metadata read cache',()=>{
 assert.equal(dogMetadataWasWritten('dog-match',{[ROOM]:1},ROOM),false);
 assert.equal(dogMetadataWasWritten('dog-match',{[ROOM]:3},ROOM),false);
 assert.equal(dogMetadataWasWritten('dog-match',{},ROOM),false);
 assert.equal(dogMetadataWasWritten('dog-match',undefined,ROOM),false);
});

test('actual committed village, scratch and player-stat writes invalidate immediately',()=>{
 for(const collection of [
  'dog_christmas_villages_v1',
  'dog_christmas_scratch_v1',
  'dog_player_stats_v1',
  'dog_christmas_research_v1'
 ]){
  assert.equal(dogMetadataWasWritten('dog-match',{[ROOM]:1,[collection]:1},ROOM),true,collection);
 }
 assert.equal(dogMetadataWasWritten('dog-match',{[ROOM]:1,'dog_player_stats_v1':0},ROOM),false);
});

test('only DOG match writes are covered; no uncommitted/invalid diagnostics can evict',()=>{
 assert.equal(dogMetadataWasWritten('dog-lobby',{'dog_player_stats_v1':1},ROOM),false);
 assert.equal(dogMetadataWasWritten('skyjo',{'dog_player_stats_v1':1},ROOM),false);
 assert.equal(dogMetadataWasWritten('dog-match',{'dog_player_stats_v1':-1},ROOM),false);
 assert.equal(dogMetadataWasWritten('dog-match',{'dog_player_stats_v1':1.5},ROOM),false);
});

test('hub uses committed collection counts, never invalidates all metadata on every DOG action',()=>{
 const source=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
 assert.match(source,/dogMetadataWasWritten\(dogWriteKind,writeCounts,COLLECTION\)/);
 assert.match(source,/route!=='\/api\/hub\/rooms\/:code\/dog\/action'/);
 assert.match(source,/if\(dogMetadataWasWritten\(dogWriteKind,writeCounts,COLLECTION\)\)/);
 assert.match(source,/dogWrittenMetadataPaths\(dogWriteKind,writePaths,COLLECTION\)/);
 assert.match(source,/if\(paths===null\)dogMetaReadCoordinator\.invalidate\(\)/);
 assert.match(source,/else for\(const path of paths\)dogMetaReadCoordinator\.invalidate\(path\)/);
});

test('only written private DOG accounts and the global village are invalidated',()=>{
 const touched=[
  ROOM+'/123','dog_christmas_scratch_v1/alice',
  'dog_christmas_scratch_v1/alice',
  'dog_christmas_villages_v1/lichtertal'
 ];
 assert.deepEqual(dogWrittenMetadataPaths('dog-match',touched,ROOM),[
  'dog_christmas_scratch_v1/alice','dog_christmas_villages_v1/lichtertal'
 ]);
 assert.equal(dogWrittenMetadataPaths('dog-lobby',touched,ROOM),null);
 assert.equal(dogWrittenMetadataPaths('dog-match',null,ROOM),null);
 assert.equal(dogWrittenMetadataPaths('dog-match',[null],ROOM),null);
});

test('tracked Firestore transaction records paths after successful commit, without logging UID',async()=>{
 const diagnostic=createDogWriteDiagnostics();
 const made=[],tx={set:(ref,data)=>made.push([ref.path,data]),get:async()=>null};
 const tracked=diagnostic.counter(tx);
 tracked.tx.set({path:ROOM+'/123'},{revision:4});
 tracked.tx.set({path:'dog_player_stats_v1/alice'},{wins:2});
 tracked.tx.set({path:'dog_player_stats_v1/bob'},{wins:1});
 assert.deepEqual(tracked.paths(),[
  ROOM+'/123','dog_player_stats_v1/alice','dog_player_stats_v1/bob'
 ]);
 assert.equal(made.length,3);
 diagnostic.record('dog-match',tracked.counts(),true);
 assert.equal(JSON.stringify(diagnostic.snapshot()).includes('alice'),false);
 assert.equal(JSON.stringify(diagnostic.snapshot()).includes('bob'),false);
 const incomplete=diagnostic.counter(tx);
 incomplete.tx.set({id:'missing-reference-path'},{}); 
 assert.equal(incomplete.paths(),null,'missing paths force conservative invalidation');
});

test('a DOG reward for Alice does not re-fetch Bob or unrelated shared metadata',async()=>{
 const db={},counts=new Map(),values=new Map([
  ['dog_christmas_scratch_v1/alice',1],
  ['dog_christmas_scratch_v1/bob',10],
  ['dog_player_stats_v1/charlie',20]
 ]);
 const cache=createDogSharedReadCoordinator({ttlMs:30000});
 const ref=path=>({path,async get(){
  counts.set(path,(counts.get(path)||0)+1);
  const value=values.get(path);
  return {exists:true,data:()=>({coins:value})};
 }});
 const alice='dog_christmas_scratch_v1/alice';
 const bob='dog_christmas_scratch_v1/bob';
 const charlie='dog_player_stats_v1/charlie';
 for(const path of [alice,bob,charlie])await cache.read(db,ref(path));
 values.set(alice,2);
 for(const path of dogWrittenMetadataPaths('dog-match',[ROOM+'/123',alice],ROOM))
  cache.invalidate(path);
 assert.equal((await cache.read(db,ref(alice))).data().coins,2);
 assert.equal((await cache.read(db,ref(bob))).data().coins,10);
 assert.equal((await cache.read(db,ref(charlie))).data().coins,20);
 assert.deepEqual(Object.fromEntries(counts),{[alice]:2,[bob]:1,[charlie]:1});
});
