import test from 'node:test';
import assert from 'node:assert/strict';
import {DOG_LEVEL_REWARDS,DOG_LEVEL_THRESHOLDS} from '../dog/player-levels.js';
import {normalizedScratchWallet,dogScratchStatus,dogLevelRewardClaimFlags,
 claimDogLevelScratchVouchers,claimDogLevelOneScratchVouchers} from '../dog/christmas-scratch.js';
test('Existing Level 1 starter still grants the same four vouchers',()=>{
 const r=claimDogLevelOneScratchVouchers(null,{now:12});
 assert.equal(r.unchanged,false);
 assert.deepEqual(r.wallet.variantVouchers,{gifts:1,snow_collect:1,elf:1,premium_27:1,
  tic_tac_toe:0,number_one_20:0,dog_jackpot_9:0});
 assert.equal(dogLevelRewardClaimFlags(r.wallet)[1],true);
 assert.equal(claimDogLevelScratchVouchers(r.wallet,1,{now:13}).unchanged,true);
});
test('Each level 2–50 credits its configured voucher bundle exactly once',()=>{
 let wallet=null;
 for(let level=2;level<=50;level++){
  const before=normalizedScratchWallet(wallet),reward=DOG_LEVEL_REWARDS[level-1].reward;
  const first=claimDogLevelScratchVouchers(wallet,level,{now:1000+level});
  assert.equal(first.unchanged,false);
  for(const v of reward.vouchers)
   assert.equal(first.wallet.variantVouchers[v.id],before.variantVouchers[v.id]+v.count);
  const retry=claimDogLevelScratchVouchers(first.wallet,level,{now:2000+level});
  assert.equal(retry.unchanged,true);
  assert.deepEqual(retry.wallet.variantVouchers,first.wallet.variantVouchers);
  assert.equal(dogLevelRewardClaimFlags(first.wallet)[level],true);
  wallet=first.wallet;
 }
 assert.equal(Object.values(dogScratchStatus(wallet).levelRewardClaims).filter(Boolean).length,49);
 assert.equal(DOG_LEVEL_THRESHOLDS[49],63700);
});
test('Historic starter claim remains valid; invalid claims and overflow are blocked',()=>{
 const old={levelOneStarterClaimedAt:123};
 const result=claimDogLevelScratchVouchers(old,1,{now:200});
 assert.equal(result.unchanged,true);
 assert.equal(dogLevelRewardClaimFlags(old)[1],true);
 for(const level of [0,51,-1,1.2,'2',null])
  assert.throws(()=>claimDogLevelScratchVouchers(null,level),/DOG_LEVEL_REWARD_INVALID/);
 assert.throws(()=>claimDogLevelScratchVouchers({variantVouchers:{snow_collect:10000}},2),
  /SCRATCH_VOUCHER_LIMIT/);
});
