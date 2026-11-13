import test from 'node:test';
import assert from 'node:assert/strict';
import {DOG_CHEST_TYPES,DOG_CHEST_STAGES} from '../dog-balance.js';
import {DOG_S2_BINGO_MILESTONES,dogS2RewardStatus,dogS2DrawMilestone,dogS2PlanBingoClaims} from '../dog-album-bingo-rewards.js';

test('30 real two-Bingo milestones, with chest quality rising from wood to legendary',()=>{
 assert.deepEqual(DOG_S2_BINGO_MILESTONES.map(x=>x.at),Array.from({length:30},(_,i)=>(i+1)*2));
 for(const [start,end,tier] of [[2,12,'wood'],[14,24,'iron'],[26,36,'silver'],[38,48,'gold'],[50,60,'legendary']]){
  assert.ok(DOG_S2_BINGO_MILESTONES.filter(m=>m.at>=start&&m.at<=end).every(m=>m.tier===tier));
 }
 assert.ok(DOG_S2_BINGO_MILESTONES.filter(m=>m.at>=38).every(m=>m.extraCount>=2));
 assert.ok(DOG_S2_BINGO_MILESTONES.filter(m=>m.at>=50).every(m=>m.extraCount>=3));
 assert.equal(DOG_S2_BINGO_MILESTONES.at(-1).extraCount,4);
 assert.equal(DOG_S2_BINGO_MILESTONES.at(-1).chests,2);
});

test('real valid frozen DOG chest offers, all expected random bonus categories, no adjacent repetition',()=>{
 const awards=dogS2PlanBingoClaims({bingos:60},{},'',()=>0).awards;
 assert.equal(awards.length,30);
 const seen=new Set();let last='';
 for(const award of awards){
  assert.equal(award.chests.length,award.at===60?2:1);
  for(const offer of award.chests){
   assert.equal(offer.version,4);
   assert.equal(offer.tier,award.chestTier);
   assert.ok(Number.isInteger(offer.count));
   assert.ok(offer.count>=DOG_CHEST_TYPES[offer.tier].min&&offer.count<=DOG_CHEST_TYPES[offer.tier].max);
   assert.ok(DOG_CHEST_STAGES[offer.stage].chestWeights[Object.keys(DOG_CHEST_TYPES).indexOf(offer.tier)]>0);
  }
  for(const bonus of award.bonuses){
   assert.ok(['cash','hammer','joker','minigame','monster'].includes(bonus.kind));
   assert.notEqual(bonus.kind,last,'bonus categories alternate across milestone boundaries');
   assert.ok(typeof bonus.label==='string'&&bonus.label.length>3);
   if(bonus.kind==='cash')assert.ok(bonus.amountCents>0&&Number.isSafeInteger(bonus.amountCents));
   else assert.ok(Number.isSafeInteger(bonus.quantity)&&bonus.quantity>0);
   last=bonus.kind;seen.add(bonus.kind);
  }
 }
 assert.ok(seen.size>=4);
});

test('claims are based on actual total Bingo count, and completed milestones cannot pay twice',()=>{
 assert.equal(dogS2RewardStatus(1).pending.length,0);
 assert.deepEqual(dogS2RewardStatus(4).pending,[2,4]);
 const first=dogS2PlanBingoClaims({bingos:4},{},'',()=>0);
 assert.deepEqual(first.awards.map(x=>x.at),[2,4]);
 const claims={2:1700000000000,4:1700000000001};
 assert.deepEqual(dogS2PlanBingoClaims({bingos:4},claims,'monster',()=>0).awards,[]);
 const status=dogS2RewardStatus(4,claims);
 assert.equal(status.claimed,2);
 assert.equal(status.pending.length,0);
 assert.equal(status.milestones[0].state,'claimed');
 assert.equal(status.milestones[2].state,'locked');
 assert.deepEqual(dogS2PlanBingoClaims({bingos:6},claims,'monster',()=>0).awards.map(x=>x.at),[6]);
});
