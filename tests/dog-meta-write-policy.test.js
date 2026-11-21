import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dogMetadataWasWritten} from '../dog-meta-write-policy.js';

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
 assert.match(source,/if\(dogMetadataWasWritten\(dogWriteKind,writeCounts,COLLECTION\)\)\s*dogMetaReadCoordinator\.invalidate\(\)/);
});
