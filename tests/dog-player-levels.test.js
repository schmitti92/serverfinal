import test from 'node:test';
import assert from 'node:assert/strict';
import {dogLevelFromXp,dogPlayerLevelStatus,dogMatchXp,creditDogMatchXp,
 DOG_LEVEL_REWARDS,DOG_LEVEL_THRESHOLDS} from '../dog/player-levels.js';
import {dogCompletedPlayerStats} from '../dog/player-stats.js';
test('all ten levels are monotonic, with accurate XP progression',()=>{
 assert.equal(DOG_LEVEL_THRESHOLDS.length,10);
 for(let i=0;i<10;i++){
  const p=dogLevelFromXp(DOG_LEVEL_THRESHOLDS[i]);
  assert.equal(p.level,i+1);
  assert.equal(p.progressPercent,i===9?100:0);
  if(i<9)assert.equal(dogLevelFromXp(DOG_LEVEL_THRESHOLDS[i+1]-1).level,i+1);
 }
 assert.equal(dogLevelFromXp(999999999).level,10);
 assert.equal(DOG_LEVEL_REWARDS.length,10);
 assert.equal(DOG_LEVEL_REWARDS[1].configured,true);
 assert.deepEqual(DOG_LEVEL_REWARDS[1].reward,{type:'feature',id:'dog-design-studio',title:'Brettdesigner'});
 assert.equal(DOG_LEVEL_REWARDS[2].configured,true);
 assert.deepEqual(DOG_LEVEL_REWARDS[2].reward,{
  type:'cardEdition',id:'kartendesign-05',title:'🎅 Nikolaus-Kartendeck · Deluxe'
 });
 assert.equal(DOG_LEVEL_THRESHOLDS[2],250);
 assert.ok(DOG_LEVEL_REWARDS.filter(x=>![2,3].includes(x.level)).every(x=>!x.configured&&x.reward===null));
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
