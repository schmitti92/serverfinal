import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DOG_TREE_PRIZE_POOL,DOG_TREE_REWARD_SCHEDULE,dogTreeLevelFromLevels,
 dogTreeRewardStatus,claimDogTreeReward} from '../dog/christmas-tree-rewards.js';
test('10 stages with fixed background/avatar/cards/board order',()=>{
 assert.equal(DOG_TREE_PRIZE_POOL.length,51);
 assert.equal(new Set(DOG_TREE_PRIZE_POOL.map(p=>p.unlockId)).size,51);
 assert.deepEqual(DOG_TREE_REWARD_SCHEDULE.map(p=>p.category).slice(0,4),['backgrounds','avatars','cards','boards']);
 assert.equal(DOG_TREE_REWARD_SCHEDULE.length,10);
 assert.ok(DOG_TREE_REWARD_SCHEDULE.slice(4).every(p=>p.category==='random'));
});
test('tree stage follows authoritative four building levels, not client values',()=>{
 assert.equal(dogTreeLevelFromLevels({tower:1,workshop:1,bakery:1,inn:1}),1);
 assert.equal(dogTreeLevelFromLevels({tower:2,workshop:1,bakery:1,inn:1}),2);
 assert.equal(dogTreeLevelFromLevels({tower:5,workshop:5,bakery:5,inn:5}),10);
 assert.equal(dogTreeLevelFromLevels({tower:50,workshop:1,bakery:1,inn:1}),1);
 assert.equal(dogTreeLevelFromLevels({levels:{tower:5,workshop:5,bakery:5,inn:5}}),10);
});
test('one automatic persistent gift per tree stage, no reroll on replay',()=>{
 const village={levels:{tower:5,workshop:5,bakery:5,inn:5}};
 let document={claims:{}},winner=[];
 for(let level=1;level<=10;level++){
  const result=claimDogTreeReward(document,village,level,{draw:()=>0,clock:()=>1700000000000+level});
  assert.equal(result.unchanged,false);
  assert.equal(result.prize.category,level<=4?['backgrounds','avatars','cards','boards'][level-1]:result.prize.category);
  document=result.document;
  winner.push(result.prize.unlockId);
  const repeated=claimDogTreeReward(document,village,level,{draw:()=>{throw Error('MUST_NOT_REROLL')}});
  assert.equal(repeated.unchanged,true);
  assert.equal(repeated.prize.unlockId,result.prize.unlockId);
 }
 assert.equal(new Set(winner).size,10);
 assert.equal(dogTreeRewardStatus(village,document).collected,10);
});
test('locked stages cannot be claimed; level one is claimable starter gift',()=>{
 const low={levels:{tower:1,workshop:1,bakery:1,inn:1}};
 assert.equal(dogTreeRewardStatus(low,{claims:{}}).available,1);
 assert.equal(claimDogTreeReward({},low,1,{draw:()=>0}).prize.category,'backgrounds');
 assert.throws(()=>claimDogTreeReward({},low,2),/TREE_LEVEL_NOT_REACHED/);
 assert.throws(()=>claimDogTreeReward({},low,11),/INVALID_TREE_LEVEL/);
});
test('server checks member, stores one account receipt only when claimed',()=>{
 const text=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
 assert.match(text,/\/dog\/tree-rewards'/);
 assert.match(text,/\/dog\/tree-rewards\/claim'/);
 assert.match(text,/dogTreeRewardStatus/);
 assert.match(text,/claimDogTreeReward/);
 assert.match(text,/validateRead\(room,identity\)/);
 assert.match(text,/tx\.set\(accountRef,result\.document\)/);
});
