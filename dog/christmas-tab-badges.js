/** Lightweight personal DOG Christmas menu counters. The caller reads
 * only the three verified per-player documents (stats, research, vouchers).
 * Never expose balances submitted by the browser or issue a reward write.
 */
import {dogPlayerLevelStatus} from './player-levels.js';
import {DOG_LEVEL_REWARDS} from './player-levels.js';
import {dogLevelRewardClaimFlags} from './christmas-scratch.js';
import {dogResearchStatus} from './christmas-research.js';

const safe=value=>Number.isSafeInteger(value)&&value>=0?value:0;
const countValues=value=>value&&typeof value==='object'&&!Array.isArray(value)?
 Object.values(value).reduce((sum,n)=>sum+Math.min(10000,safe(n)),0):0;

export function dogChristmasTabBadges(stats,rawWallet,rawResearch,now=Date.now()){
 const level=dogPlayerLevelStatus(stats);
 const research=dogResearchStatus(rawResearch,stats?.xp,now);
 const claims=dogLevelRewardClaimFlags(rawWallet);
 const scratch=countValues(rawWallet?.vouchers)+countValues(rawWallet?.variantVouchers);
 const levelRewards=DOG_LEVEL_REWARDS.filter(reward=>
  reward?.configured===true&&reward.level<=level.level&&claims[reward.level]!==true).length;
 return {scratch,research:research.available,level:levelRewards,
  playerLevel:level.level};
}
