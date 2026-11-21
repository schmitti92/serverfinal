import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 DOG_CHRISTMAS_SCRATCH_MIN_LEVEL,
 dogChristmasScratchMinLevel,
 dogChristmasScratchUnlocked
} from '../dog/christmas-unlock-levels.js';
import {DOG_LEVEL_REWARDS} from '../dog/player-levels.js';

test('four Christmas scratch locks use the requested exact thresholds',()=>{
 assert.deepEqual(DOG_CHRISTMAS_SCRATCH_MIN_LEVEL,{
  snow_collect:3,tic_tac_toe:6,elf:7,dog_jackpot_9:8
 });
 for(const [id,level] of Object.entries(DOG_CHRISTMAS_SCRATCH_MIN_LEVEL)){
  assert.equal(dogChristmasScratchMinLevel(id),level);
  for(let current=1;current<=50;current++)
   assert.equal(dogChristmasScratchUnlocked(id,current),current>=level,id+' at '+current);
 }
 assert.equal(dogChristmasScratchUnlocked('gifts',1),true);
 assert.equal(dogChristmasScratchUnlocked('premium_27',1),true);
 assert.equal(dogChristmasScratchUnlocked('number_one_20',1),true);
 assert.equal(dogChristmasScratchUnlocked('snow_collect',2),false);
});

test('Nikolaus deck is a level-20 milestone and never a level-3 gift',()=>{
 assert.equal(DOG_LEVEL_REWARDS[19].reward.id,'kartendesign-05');
 assert.notEqual(DOG_LEVEL_REWARDS[2].reward.id,'kartendesign-05');
 assert.ok(DOG_LEVEL_REWARDS.every((reward,index)=>
  reward.reward.vouchers.every(v=>dogChristmasScratchUnlocked(v.id,index+1))));
 assert.deepEqual(DOG_LEVEL_REWARDS[0].reward.vouchers,
  [{id:'gifts',tier:'simple',count:4}]);
});

test('all scratch buy paths check verified level inside Firestore transaction',()=>{
 const source=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
 const start=source.indexOf("app.post('/api/hub/scratch/buy'");
 const end=source.indexOf("// Payout research is a separate",start);
 assert.ok(start>0&&end>start);
 const route=source.slice(start,end);
 assert.match(route,/tx\.get\(playerStatsRef\)/);
 assert.match(route,/dogPlayerLevelStatus\(playerStatsSnap\.exists\?playerStatsSnap\.data\(\):null\)/);
 assert.match(route,/dogChristmasScratchUnlocked\(body\.variantId,verifiedPlayerLevel\)/);
 assert.match(route,/SCRATCH_PLAYER_LEVEL_LOCKED/);
 assert.ok(route.indexOf('SCRATCH_PLAYER_LEVEL_LOCKED')<route.indexOf('issueGiftsEditionTicket'));
 assert.ok(route.indexOf('SCRATCH_PLAYER_LEVEL_LOCKED')<route.indexOf('buyScratchTicket'));
});
