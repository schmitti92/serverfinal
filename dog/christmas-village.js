/** DOG Christmas village: deterministic rewards and a persistent, shared wallet.
 * The server alone records upgrades and applies gifts from verified DOG moves.
 * No browser-provided balances, field claims or winning teams are trusted.
 */
import {randomInt} from 'node:crypto';
import {CHRISTMAS_BUILDING_IDS,CHRISTMAS_BUILDING_MAX_LEVEL,christmasUpgradeCost} from './christmas-building-costs.js';
/** Event lifecycle belongs to the server, never to a player or a room.
 * Active by default while the Christmas event is available. Operators can
 * end it centrally via DOG_CHRISTMAS_EVENT_ENABLED=false on Render.
 * No user action, local storage or room setting can change this state.
 */
export function isDogChristmasEventActive(env=process.env){
 const setting=String(env?.DOG_CHRISTMAS_EVENT_ENABLED??'true').trim().toLowerCase();
 return !['0','false','off','ended'].includes(setting);
}

export const DOG_VILLAGE_COLLECTION='dog_christmas_villages_v1';
// The one shared seasonal village across all signed-in DOG players, independent of rooms.
export const DOG_GLOBAL_VILLAGE_ID='lichtertal_2026_shared';
export const DOG_GIFT_FIELD_ORDER=Object.freeze([3,9,15,21,27,33,39,45,51,57,6,12,19,25,31,38,44,50,56,62]);
export const DOG_TOWER_FIELDS=Object.freeze([10,12,15,18,20]);
export const DOG_SCRATCH_FIELDS_PER_DEAL=8;
export const DOG_SCRATCH_FIELDS_PER_INN_LEVEL=2;
/** The inn grants two more hidden scratch spaces for each completed upgrade. */
export function dogInnScratchFieldCount(level=1){
 if(!Number.isInteger(level)||level<1||level>CHRISTMAS_BUILDING_MAX_LEVEL)throw Error('INVALID_INN_LEVEL');
 return DOG_SCRATCH_FIELDS_PER_DEAL+(level-1)*DOG_SCRATCH_FIELDS_PER_INN_LEVEL;
}
export const DOG_FIELD_SCRATCH_TIER_ODDS=Object.freeze({simple:88,medium:10,premium:2});
const eligibleDogTrackFields=Object.freeze(Array.from({length:64},(_,i)=>i).filter(i=>i%16!==0));
/** Random, disjoint, unmarked spaces. The server never publishes the placement. */
export function drawHiddenDogChristmasFields(giftCount,draw=randomInt,scratchCount=DOG_SCRATCH_FIELDS_PER_DEAL){
 if(!Number.isInteger(giftCount)||giftCount<0||giftCount>20)throw Error('INVALID_GIFT_FIELD_COUNT');
 if(!Number.isInteger(scratchCount)||scratchCount<0||scratchCount>eligibleDogTrackFields.length-giftCount)throw Error('INVALID_SCRATCH_FIELD_COUNT');
 const fields=[...eligibleDogTrackFields];
 for(let i=fields.length-1;i>0;i--){const j=draw(i+1);[fields[i],fields[j]]=[fields[j],fields[i]];}
 return {giftFields:fields.slice(0,giftCount),
  scratchFields:fields.slice(giftCount,giftCount+scratchCount)};
}
export function drawDogScratchTier(draw=randomInt){
 const roll=draw(100);
 if(!Number.isInteger(roll)||roll<0||roll>=100)throw Error('DOG_SCRATCH_RANDOM_INVALID');
 return roll<2?'premium':roll<12?'medium':'simple';
}
export const DOG_VILLAGE_DEFAULT_LEVELS=Object.freeze(Object.fromEntries(CHRISTMAS_BUILDING_IDS.map(id=>[id,1])));
const validLevel=n=>Number.isInteger(n)&&n>=1&&n<=CHRISTMAS_BUILDING_MAX_LEVEL;
const cleanInt=n=>Number.isSafeInteger(n)&&n>=0?n:0;
const pastBuildingSpendTenths=levels=>CHRISTMAS_BUILDING_IDS.reduce(
 (sum,id)=>sum+15*(2**(levels[id]-1)-1)*10,0);

export function normalizedDogVillage(raw,hostUid){
 const source=raw&&typeof raw==='object'?raw:{};
 const levels=Object.fromEntries(CHRISTMAS_BUILDING_IDS.map(id=>[id,validLevel(source.levels?.[id])?source.levels[id]:1]));
 const lightsTenths=cleanInt(source.lightsTenths);
 const baselineSpentTenths=pastBuildingSpendTenths(levels);
 const totalSpentTenths=cleanInt(source.totalSpentTenths??baselineSpentTenths);
 const totalEarnedTenths=cleanInt(source.totalEarnedTenths??(lightsTenths+totalSpentTenths));
 return {
  hostUid,levels,lightsTenths,totalEarnedTenths,totalSpentTenths,
  giftsCollected:cleanInt(source.giftsCollected),
  bonusGifts:cleanInt(source.bonusGifts),
  matchesCompleted:cleanInt(source.matchesCompleted),
  revision:cleanInt(source.revision),
  recentUpgradeIds:Array.isArray(source.recentUpgradeIds)?source.recentUpgradeIds.filter(x=>typeof x==='string').slice(-48):[]
 };
}
export function dogVillagePublic(raw,hostUid){
 const v=normalizedDogVillage(raw,hostUid);
 return {
  owner:hostUid,scope:hostUid===DOG_GLOBAL_VILLAGE_ID?'all-dog-players':'legacy-host',
  levels:v.levels,
  lights:Math.floor(v.lightsTenths/10),lightsTenths:v.lightsTenths,
  totalEarnedTenths:v.totalEarnedTenths,totalSpentTenths:v.totalSpentTenths,
  giftsCollected:v.giftsCollected,bonusGifts:v.bonusGifts,
  matchesCompleted:v.matchesCompleted,revision:v.revision,
  nextCosts:Object.fromEntries(CHRISTMAS_BUILDING_IDS.map(id=>[id,christmasUpgradeCost(v.levels[id])])),
  bonus:{
   towerFields:DOG_TOWER_FIELDS[v.levels.tower-1],
   workshopExtraChancePercent:5*v.levels.workshop,
   bakeryExtraPercent:10*(v.levels.bakery-1),
   innPerFinishedGame:v.levels.inn-1,
   innScratchFields:dogInnScratchFieldCount(v.levels.inn)
  }
 };
}
export function buyDogVillageUpgrade(raw,hostUid,building,expectedLevel,commandId){
 if(!CHRISTMAS_BUILDING_IDS.includes(building)||!validLevel(expectedLevel))throw Error('INVALID_BUILDING');
 if(typeof commandId!=='string'||!/^[-a-zA-Z0-9_:]{8,90}$/.test(commandId))throw Error('INVALID_COMMAND_ID');
 const village=normalizedDogVillage(raw,hostUid);
 if(village.recentUpgradeIds.includes(commandId))return {village,unchanged:true};
 if(village.levels[building]!==expectedLevel)throw Error('STALE_BUILDING_LEVEL');
 const price=christmasUpgradeCost(expectedLevel);
 if(price===null)throw Error('BUILDING_MAX_LEVEL');
 if(village.lightsTenths<price*10)throw Error('NOT_ENOUGH_CHRISTMAS_LIGHTS');
 village.lightsTenths-=price*10;
 village.totalSpentTenths+=price*10;
 village.levels[building]++;
 village.revision++;
 village.recentUpgradeIds.push(commandId);
 village.recentUpgradeIds=village.recentUpgradeIds.slice(-48);
 return {village,unchanged:false,price};
}
export function createDogChristmasMatch(village,enabled,draw=randomInt,round=1){
 if(!enabled)return null;
 const levels={...normalizedDogVillage(village,village?.hostUid||'').levels};
 const positions=drawHiddenDogChristmasFields(DOG_TOWER_FIELDS[levels.tower-1],draw,dogInnScratchFieldCount(levels.inn));
 return {enabled:true,levels,round,...positions,
  claimedFields:[],claimedScratchFields:[],roundGiftCollected:0,roundScratchCollected:0,
  giftCount:0,scratchCount:0,bonusGiftCount:0,earnedTenths:0,innCredited:false,activity:[]};
}
/** Add an inn upgrade to an active match without reshuffling existing
 * hidden fields or allowing players to collect any space twice.
 * Called only after an authoritative village purchase, not by clients.
 */
export function applyDogInnUpgradeToMatch(match,newInnLevel,draw=randomInt){
 if(!match?.enabled)return 0;
 const current=Number.isInteger(match.levels?.inn)?match.levels.inn:1;
 const target=dogInnScratchFieldCount(newInnLevel);
 if(target<=dogInnScratchFieldCount(current))return 0;
 if(!Array.isArray(match.giftFields)||!Array.isArray(match.scratchFields))throw Error('INVALID_CHRISTMAS_MATCH');
 const occupied=new Set([...match.giftFields,...match.scratchFields]);
 const available=eligibleDogTrackFields.filter(field=>!occupied.has(field));
 for(let i=available.length-1;i>0;i--){
  const j=draw(i+1);[available[i],available[j]]=[available[j],available[i]];
 }
 const needed=Math.max(0,target-match.scratchFields.length);
 if(needed>available.length)throw Error('NOT_ENOUGH_HIDDEN_FIELDS');
 match.scratchFields.push(...available.slice(0,needed));
 match.levels.inn=newInnLevel;
 return needed;
}
/** Replaces both secret maps once, exactly when fresh cards are dealt. */
export function refreshDogChristmasDeal(match,round,draw=randomInt){
 if(!match?.enabled||!Number.isInteger(round)||round<1||round===match.round)return false;
 if(round<match.round)return false;
 const newFields=drawHiddenDogChristmasFields(DOG_TOWER_FIELDS[match.levels.tower-1],draw,dogInnScratchFieldCount(match.levels.inn||1));
 Object.assign(match,newFields,{round,claimedFields:[],claimedScratchFields:[],
  roundGiftCollected:0,roundScratchCollected:0});
 return true;
}
/** Deliberately omit every hidden field and any claimed field index. */
export function publicDogChristmasMatch(match){
 if(!match?.enabled)return null;
 const {enabled,levels,round,giftCount,scratchCount,roundGiftCollected,
  roundScratchCollected,bonusGiftCount,earnedTenths,innCredited,activity}=match;
 return {enabled,levels,round,giftFieldCount:DOG_TOWER_FIELDS[levels.tower-1],
  scratchFieldCount:Array.isArray(match.scratchFields)?match.scratchFields.length:DOG_SCRATCH_FIELDS_PER_DEAL,giftCount,scratchCount,
  roundGiftCollected,roundScratchCollected,bonusGiftCount,earnedTenths,innCredited,
  activity:(activity||[]).slice(-12)};
}
function landedDogTrackField(before,after,action){
 if(!['move','seven-step'].includes(action?.type))return null;
 const prior=before?.pieces?.find(p=>p.id===action.pieceId);
 const next=after?.pieces?.find(p=>p.id===action.pieceId);
 if(!prior||!next||next.place!=='track'||
  (prior.place===next.place&&prior.pos===next.pos))return null;
 return next.pos;
}
/** Returns incremental gift earnings in tenths; mutation applies only to the
 * authoritative match snapshot, which is committed atomically with the wallet.
 */
export function claimDogChristmasGift(match,before,after,action,seat,draw=randomInt){
 if(!match?.enabled)return 0;
 const field=landedDogTrackField(before,after,action);
 if(field===null)return 0;
 if(!match.giftFields.includes(field)||match.claimedFields.includes(field))return 0;
 match.claimedFields.push(field);
 const chance=match.levels.workshop*5;
 const bonus=draw(100)<chance?1:0;
 const gifts=1+bonus;
 const tenths=gifts*(10+match.levels.bakery-1);
 match.giftCount++;
 match.roundGiftCollected=(match.roundGiftCollected||0)+1;
 match.bonusGiftCount+=bonus;
 match.earnedTenths+=tenths;
 match.activity=[...match.activity.slice(-11),{type:'gift',field,seat,gifts,bonus,earnedTenths:tenths}];
 return tenths;
}
/** Server-verified, one-use landing on a hidden scratch field. */
export function claimDogChristmasScratch(match,before,after,action,seat,draw=randomInt){
 if(!match?.enabled)return null;
 const field=landedDogTrackField(before,after,action);
 if(field===null||!match.scratchFields?.includes(field)||
  match.claimedScratchFields?.includes(field))return null;
 const tier=drawDogScratchTier(draw);
 match.claimedScratchFields.push(field);
 match.scratchCount=(match.scratchCount||0)+1;
 match.roundScratchCollected=(match.roundScratchCollected||0)+1;
 match.activity=[...match.activity.slice(-11),{type:'scratch',field,seat,tier}];
 return tier;
}
export function finishDogChristmasMatch(match,after){
 if(!match?.enabled||after?.phase!=='finished'||match.innCredited)return 0;
 match.innCredited=true;
 const tenths=(match.levels.inn-1)*10;
 if(tenths)match.activity=[...match.activity.slice(-11),{type:'inn',earnedTenths:tenths}];
 match.earnedTenths+=tenths;
 return tenths;
}
export function creditDogVillage(raw,hostUid,match,deltaTenths,deltaGifts=0,deltaBonus=0,finished=false){
 const village=normalizedDogVillage(raw,hostUid);
 if(!Number.isSafeInteger(deltaTenths)||deltaTenths<0||!Number.isSafeInteger(deltaGifts)||deltaGifts<0||
    !Number.isSafeInteger(deltaBonus)||deltaBonus<0)throw Error('INVALID_REWARD_DELTA');
 if(deltaTenths===0&&deltaGifts===0&&deltaBonus===0&&!finished)return village;
 village.lightsTenths+=deltaTenths;
 village.totalEarnedTenths+=deltaTenths;
 village.giftsCollected+=deltaGifts;
 village.bonusGifts+=deltaBonus;
 if(finished)village.matchesCompleted++;
 village.revision++;
 return village;
}

/** One-time, idempotent migration of a former host-owned village.
 * Called inside a Firestore transaction that also marks the legacy document.
 * Distinct old hosts contributed to separate villages; balances and history
 * are summed, while shared building levels take the highest previously earned
 * level per building. This never charges or awards currency from the browser.
 */
export function mergeLegacyDogVillage(sharedRaw,legacyRaw,legacyUid){
 const shared=normalizedDogVillage(sharedRaw,DOG_GLOBAL_VILLAGE_ID);
 const legacy=normalizedDogVillage(legacyRaw,legacyUid);
 const hasHistory=legacy.lightsTenths>0||legacy.giftsCollected>0||
   legacy.matchesCompleted>0||CHRISTMAS_BUILDING_IDS.some(id=>legacy.levels[id]>1);
 if(!hasHistory)return {village:shared,changed:false};
 for(const id of CHRISTMAS_BUILDING_IDS)
  shared.levels[id]=Math.max(shared.levels[id],legacy.levels[id]);
 shared.lightsTenths+=legacy.lightsTenths;
 shared.totalEarnedTenths+=legacy.totalEarnedTenths;
 shared.totalSpentTenths+=legacy.totalSpentTenths;
 shared.giftsCollected+=legacy.giftsCollected;
 shared.bonusGifts+=legacy.bonusGifts;
 shared.matchesCompleted+=legacy.matchesCompleted;
 shared.revision++;
 return {village:shared,changed:true};
}
