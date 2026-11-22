import test from 'node:test';
import assert from 'node:assert/strict';
import {dogChristmasTabBadges} from '../dog/christmas-tab-badges.js';
import {dogLevelFromXp,DOG_LEVEL_THRESHOLDS} from '../dog/player-levels.js';
import {dogResearchStatus} from '../dog/christmas-research.js';

test('Christmas menu badge includes tier and variant vouchers once each',()=>{
 const stats={xp:0},wallet={
  vouchers:{simple:2,medium:1,premium:4},
  variantVouchers:{gifts:3,snow_collect:2,premium_27:1},
  levelOneStarterClaimedAt:100
 };
 const result=dogChristmasTabBadges(stats,wallet,null,200);
 assert.equal(result.scratch,13);
 assert.equal(result.playerLevel,1);
 assert.equal(result.level,0,'starter reward was already collected');
 assert.equal(result.research,0);
});
test('fresh profile shows first free level reward until it has actually been claimed',()=>{
 const base=dogChristmasTabBadges({},null,null);
 assert.equal(base.level,1);
 assert.equal(base.scratch,0);
 assert.equal(dogChristmasTabBadges({}, {levelOneStarterClaimedAt:100},null).level,0);
});
test('research badge reflects available points after XP levels and paid upgrades',()=>{
 const xp=DOG_LEVEL_THRESHOLDS[9];
 const stats={xp};
 const before=dogChristmasTabBadges(stats,null,null,1000);
 assert.equal(before.playerLevel,dogLevelFromXp(xp).level);
 assert.equal(before.research,dogResearchStatus(null,xp,1000).available);
 assert.ok(before.research>0);
 const research={levels:{card_swap:1,xp:2}};
 const after=dogChristmasTabBadges(stats,null,research,1000);
 assert.equal(after.research,dogResearchStatus(research,xp,1000).available);
 assert.ok(after.research<=before.research);
});
test('eligible unclaimed level rewards are counted, not unearned levels',()=>{
 const xp=DOG_LEVEL_THRESHOLDS[4],stats={xp};
 const got=dogChristmasTabBadges(stats,{levelRewardClaims:{1:111,2:222}},null);
 assert.equal(got.playerLevel,5);
 assert.equal(got.level,3);
});
test('malformed negative and unknown voucher entries cannot inflate counters',()=>{
 const badges=dogChristmasTabBadges({xp:-2},{
  vouchers:{simple:-4,medium:'10000',premium:2},
  variantVouchers:{gifts:3,untrusted:1e8,another:NaN}
 },null);
 assert.equal(badges.scratch,10005,'limits any extraordinary voucher input');
 assert.equal(badges.research,0);
});
