import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DOG_TREE_PRIZE_POOL,DOG_TREE_REWARD_SCHEDULE,DOG_TREE_FIXED_PRIZE_IDS,dogTreeLevelFromLevels,
 dogTreeRewardStatus,claimDogTreeReward} from '../dog/christmas-tree-rewards.js';
test('ten fixed prizes use the actual available catalogue and exact announced order',()=>{
 assert.equal(DOG_TREE_PRIZE_POOL.length,51);
 assert.equal(new Set(DOG_TREE_PRIZE_POOL.map(p=>p.unlockId)).size,51);
 assert.deepEqual(DOG_TREE_FIXED_PRIZE_IDS,["christmas2026:scene:01","christmas2026:avatar:01","christmas2026:cards:kartendesign-02","christmas2026:board:weihnachtsdorf","christmas2026:emoji:05","christmas2026:nameframe:01","christmas2026:activeicon:02","christmas2026:cards:kartendesign-03","christmas2026:scene:05","christmas2026:board:polarlichtpalast"]);
 assert.deepEqual(DOG_TREE_REWARD_SCHEDULE.map(p=>p.unlockId),DOG_TREE_FIXED_PRIZE_IDS);
 assert.deepEqual(DOG_TREE_REWARD_SCHEDULE.map(p=>p.category),
  ['backgrounds','avatars','cards','boards','emojis','frames','emblems','cards','backgrounds','boards']);
 assert.deepEqual(DOG_TREE_REWARD_SCHEDULE.map(p=>p.level),[1,2,3,4,5,6,7,8,9,10]);
 assert.ok(DOG_TREE_REWARD_SCHEDULE.every(p=>DOG_TREE_PRIZE_POOL.some(item=>
   item.unlockId===p.unlockId&&item.name===p.title&&item.icon===p.icon)));
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
  const result=claimDogTreeReward(document,village,level,{draw:()=>{throw Error('NO_RNG_ALLOWED')},clock:()=>1700000000000+level});
  assert.equal(result.unchanged,false);
  assert.equal(result.prize.unlockId,DOG_TREE_FIXED_PRIZE_IDS[level-1]);
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
 assert.equal(claimDogTreeReward({},low,1).prize.unlockId,DOG_TREE_FIXED_PRIZE_IDS[0]);
 assert.throws(()=>claimDogTreeReward({},low,2),/TREE_LEVEL_NOT_REACHED/);
 assert.throws(()=>claimDogTreeReward({},low,11),/INVALID_TREE_LEVEL/);
});
test('legacy random winnings are never replaced and cannot cause new duplicates',()=>{
 const village={levels:{tower:5,workshop:5,bakery:5,inn:5}};
 // Before fixed rewards, player happened to win the now-announced Level-10
 // board on Level 5. Keep that receipt; Level 10 gets another board.
 const previous={claims:{
  '5':{unlockId:'christmas2026:board:polarlichtpalast',category:'boards',claimedAt:123456},
  '6':{unlockId:'christmas2026:emoji:05',category:'emojis',claimedAt:234567}
 }};
 const status=dogTreeRewardStatus(village,previous);
 assert.equal(status.rewards[4].prize.name,'Polarlichtpalast');
 assert.equal(status.rewards[5].prize.name,'Weihnachtsplätzchen');
 const at5=claimDogTreeReward(previous,village,5);
 assert.equal(at5.unchanged,true);
 assert.equal(at5.prize.unlockId,'christmas2026:board:polarlichtpalast');
 const next=claimDogTreeReward(previous,village,10);
 assert.equal(next.unchanged,false);
 assert.equal(next.prize.category,'boards');
 assert.notEqual(next.prize.unlockId,'christmas2026:board:polarlichtpalast');
 assert.equal(next.document.claims['5'].unlockId,'christmas2026:board:polarlichtpalast');
 assert.equal(next.document.claims['6'].unlockId,'christmas2026:emoji:05');
});
test('fixed prizes never call the old random-number function or allow early claimed stages',()=>{
 const village={levels:{tower:1,workshop:1,bakery:1,inn:1}};
 const one=claimDogTreeReward({},village,1,{draw:()=>{throw Error('RANDOM_CALLED')}});
 assert.equal(one.prize.unlockId,'christmas2026:scene:01');
 assert.throws(()=>claimDogTreeReward({},village,10),/TREE_LEVEL_NOT_REACHED/);
});

test('server checks member, stores one account receipt only when claimed',()=>{
 const text=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
 assert.match(text,/\/dog\/tree-rewards'/);
 assert.match(text,/\/dog\/tree-rewards\/claim'/);
 assert.match(text,/dogTreeRewardStatus/);
 assert.match(text,/claimDogTreeReward/);
 assert.match(text,/validateRead\(room,identity\)/);
 assert.match(text,/tx\.set\(accountRef,granted\.document\)/);
});
