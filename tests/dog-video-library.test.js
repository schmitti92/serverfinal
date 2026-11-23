import test from 'node:test';
import assert from 'node:assert/strict';
import {dogVideoLibraryAccess,recordDogVideoSeen,DOG_VIDEO_IDS} from '../dog/video-library.js';

test('movie catalogue unlocks only from verified intro and shared village progress',()=>{
 const village={levels:{tower:5,workshop:5,bakery:5,inn:5,luckhouse:5,academy:1},
  giftsCollected:2};
 const closed=dogVideoLibraryAccess(null,village,{watched:['tree-3','building-bakery','welcome']});
 assert.deepEqual(closed.available,['welcome']);
 assert.deepEqual(closed.watched,['welcome']);
 assert.equal(closed.treeLevel,0);
 const unlocked=dogVideoLibraryAccess({completedAt:100},village,{watched:['welcome','tree-3','building-bakery','unknown']});
 assert.deepEqual(unlocked.available,DOG_VIDEO_IDS);
 assert.deepEqual(unlocked.watched,['welcome','tree-3','building-bakery']);
 assert.equal(unlocked.treeLevel,10);
 assert.equal(unlocked.unlockedCount,11);
 assert.equal(unlocked.totalCount,11);
});

test('early village stages do not reveal future tree and building movies',()=>{
 const village={levels:{tower:1,workshop:1,bakery:1,inn:1,luckhouse:4,academy:1},giftsCollected:0};
 const got=dogVideoLibraryAccess({completedAt:200},village);
 assert.deepEqual(got.available,['welcome','intro']);
 assert.equal(got.treeLevel,1);
 assert.ok(!got.available.includes('first-light'));
 assert.ok(!got.available.some(id=>id.startsWith('tree-')||id.startsWith('building-')));
});

test('first light only unlocks after real server-recorded shared Christmas gifts',()=>{
 const base={levels:{tower:1,workshop:1,bakery:1,inn:1,luckhouse:1,academy:1},giftsCollected:0};
 assert.equal(dogVideoLibraryAccess({completedAt:100},base).available.includes('first-light'),false);
 assert.equal(dogVideoLibraryAccess({completedAt:100},{...base,giftsCollected:1}).available.includes('first-light'),true);
});

test('seen receipts are idempotent, whitelisted and never grant unavailable films',()=>{
 const unlocked=['welcome','intro','tree-2'];
 const first=recordDogVideoSeen(null,'tree-2',unlocked,1000);
 assert.deepEqual(first.record.watched,['tree-2']);assert.equal(first.changed,true);
 const replay=recordDogVideoSeen(first.record,'tree-2',unlocked,2000);
 assert.equal(replay.changed,false);assert.equal(replay.record.updatedAt,1000);
 assert.throws(()=>recordDogVideoSeen(null,'tree-3',unlocked,1000),/VIDEO_LOCKED/);
 assert.throws(()=>recordDogVideoSeen(null,'tree-4',unlocked,1000),/VIDEO_LOCKED/);
 assert.throws(()=>recordDogVideoSeen(null,'evil',unlocked,1000),/VIDEO_UNKNOWN/);
 const next=recordDogVideoSeen(first.record,'welcome',unlocked,3000);
 assert.deepEqual(next.record.watched,['tree-2','welcome']);
 assert.equal(next.changed,true);
});

test('malformed historical watched records cannot gain access',()=>{
 const raw={watched:['intro','intro','tree-3','../../secret',5,{},'welcome']};
 const v=dogVideoLibraryAccess(null,{levels:{tower:5,workshop:5,bakery:5,inn:5}},raw);
 assert.deepEqual(v.watched,['welcome']);
 const whitelist=new Set(DOG_VIDEO_IDS);
 assert.equal(whitelist.size,DOG_VIDEO_IDS.length);
});
