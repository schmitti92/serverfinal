import test from 'node:test';
import assert from 'node:assert/strict';
import {dogLevelFromXp,dogPlayerLevelStatus,dogMatchXp,creditDogMatchXp,
 DOG_LEVEL_REWARDS,DOG_LEVEL_THRESHOLDS,DOG_LEVEL_MAX} from '../dog/player-levels.js';
import {dogCompletedPlayerStats} from '../dog/player-stats.js';
test('50 levels preserve all previous ten XP thresholds and feature unlocks',()=>{
 assert.equal(DOG_LEVEL_MAX,50);
 assert.equal(DOG_LEVEL_THRESHOLDS.length,50);
 assert.deepEqual(DOG_LEVEL_THRESHOLDS.slice(0,10),[0,100,250,450,700,1000,1350,1750,2200,2700]);
 for(let i=0;i<50;i++){
  const p=dogLevelFromXp(DOG_LEVEL_THRESHOLDS[i]);
  assert.equal(p.level,i+1);
  assert.equal(p.progressPercent,i===49?100:0);
  if(i<49)assert.equal(dogLevelFromXp(DOG_LEVEL_THRESHOLDS[i+1]-1).level,i+1);
 }
 assert.equal(dogLevelFromXp(999999999).level,50);
 assert.equal(DOG_LEVEL_REWARDS.length,50);
 assert.ok(DOG_LEVEL_REWARDS.every(x=>x.configured&&x.reward?.vouchers?.length));
 assert.deepEqual(DOG_LEVEL_REWARDS[0].reward.vouchers,
  [{tier:'simple',id:'gifts',count:4}]);
 for(const [i,id] of [[1,'dog-design-studio'],[3,'dog-pawn-3d'],[19,'kartendesign-05']])
  assert.equal(DOG_LEVEL_REWARDS[i].reward.id,id);
 assert.equal(DOG_LEVEL_REWARDS[49].level,50);
 assert.notEqual(DOG_LEVEL_REWARDS[2].reward.id,'kartendesign-05');
 for(const entry of DOG_LEVEL_REWARDS){
  for(const v of entry.reward.vouchers){
   const min={snow_collect:3,tic_tac_toe:6,elf:7,dog_jackpot_9:8}[v.id]||1;
   assert.ok(entry.level>=min,`Level ${entry.level} grants prematurely locked ${v.id}`);
  }
 }
 const packs=DOG_LEVEL_REWARDS.flatMap(x=>x.reward.vouchers);
 assert.ok(packs.filter(x=>x.tier==='simple').length>packs.filter(x=>x.tier!=='simple').length);
 assert.equal(DOG_LEVEL_THRESHOLDS[49],63700);
});
test('one completed DOG match gives 50 XP, victory bonus and capped knockouts',()=>{
 assert.equal(dogMatchXp(),50);
 assert.equal(dogMatchXp({won:true}),100);
 assert.equal(dogMatchXp({won:true,knockedOut:3}),130);
 assert.equal(dogMatchXp({won:true,knockedOut:999}),150);
 assert.equal(dogMatchXp({won:false,knockedOut:-10}),50);
 const first=creditDogMatchXp(null,{won:true,knockedOut:4,matchId:'match-001',now:123});
 assert.equal(first.xp,140);
 const second=creditDogMatchXp(first,{won:true,knockedOut:4,matchId:'match-001',now:125});
 assert.equal(second.xp,140);
 assert.equal(second.credited,false);
 assert.equal(creditDogMatchXp(first,{won:false,matchId:'match-002'}).xp,190);
 assert.equal(dogPlayerLevelStatus(first).level,2);
});
test('existing DOG statistics award XP with the same once-per-match write',()=>{
 const base=dogCompletedPlayerStats(null,'user-one','Spieler',0,
  {seats:[{knockedOut:3,wasKnockedOut:1}]},0,'match-001',123);
 assert.equal(base.wins,1);
 assert.equal(base.played,1);
 assert.equal(base.xp,130);
 assert.equal(base.lastEarnedXp,130);
 const next=dogCompletedPlayerStats(base,'user-one','Spieler',0,
  {seats:[{knockedOut:0,wasKnockedOut:1}]},1,'match-002',124);
 assert.equal(next.played,2);
 assert.equal(next.xp,180);
 assert.equal(next.xpMatches,2);
});
