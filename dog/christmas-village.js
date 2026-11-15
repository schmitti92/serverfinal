/** DOG Christmas village: deterministic rewards and a persistent, shared wallet.
 * The server alone records upgrades and applies gifts from verified DOG moves.
 * No browser-provided balances, field claims or winning teams are trusted.
 */
import {randomInt} from 'node:crypto';
import {CHRISTMAS_BUILDING_IDS,CHRISTMAS_BUILDING_MAX_LEVEL,christmasUpgradeCost} from './christmas-building-costs.js';
export const DOG_VILLAGE_COLLECTION='dog_christmas_villages_v1';
export const DOG_GIFT_FIELD_ORDER=Object.freeze([3,9,15,21,27,33,39,45,51,57,6,12,19,25,31,38,44,50,56,62]);
export const DOG_TOWER_FIELDS=Object.freeze([10,12,15,18,20]);
export const DOG_VILLAGE_DEFAULT_LEVELS=Object.freeze(Object.fromEntries(CHRISTMAS_BUILDING_IDS.map(id=>[id,1])));
const validLevel=n=>Number.isInteger(n)&&n>=1&&n<=CHRISTMAS_BUILDING_MAX_LEVEL;
const cleanInt=n=>Number.isSafeInteger(n)&&n>=0?n:0;
export function normalizedDogVillage(raw,hostUid){
 const source=raw&&typeof raw==='object'?raw:{};
 const levels=Object.fromEntries(CHRISTMAS_BUILDING_IDS.map(id=>[id,validLevel(source.levels?.[id])?source.levels[id]:1]));
 return {
  hostUid,levels,lightsTenths:cleanInt(source.lightsTenths),
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
  owner:hostUid,levels:v.levels,
  lights:Math.floor(v.lightsTenths/10),lightsTenths:v.lightsTenths,
  giftsCollected:v.giftsCollected,bonusGifts:v.bonusGifts,
  matchesCompleted:v.matchesCompleted,revision:v.revision,
  nextCosts:Object.fromEntries(CHRISTMAS_BUILDING_IDS.map(id=>[id,christmasUpgradeCost(v.levels[id])])),
  bonus:{
   towerFields:DOG_TOWER_FIELDS[v.levels.tower-1],
   workshopExtraChancePercent:5*v.levels.workshop,
   bakeryExtraPercent:10*(v.levels.bakery-1),
   innPerFinishedGame:v.levels.inn-1
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
 village.levels[building]++;
 village.revision++;
 village.recentUpgradeIds.push(commandId);
 village.recentUpgradeIds=village.recentUpgradeIds.slice(-48);
 return {village,unchanged:false,price};
}
export function createDogChristmasMatch(village,enabled){
 if(!enabled)return null;
 const levels={...normalizedDogVillage(village,village?.hostUid||'').levels};
 return {enabled:true,levels,giftFields:DOG_GIFT_FIELD_ORDER.slice(0,DOG_TOWER_FIELDS[levels.tower-1]),
  claimedFields:[],giftCount:0,bonusGiftCount:0,earnedTenths:0,innCredited:false,activity:[]};
}
/** Returns incremental gift earnings in tenths; mutation applies only to the
 * authoritative match snapshot, which is committed atomically with the wallet.
 */
export function claimDogChristmasGift(match,before,after,action,seat,draw=randomInt){
 if(!match?.enabled||!['move','seven-step'].includes(action?.type))return 0;
 const prior=before?.pieces?.find(p=>p.id===action.pieceId);
 const next=after?.pieces?.find(p=>p.id===action.pieceId);
 if(!prior||!next||next.place!=='track'||(prior.place===next.place&&prior.pos===next.pos))return 0;
 const field=next.pos;
 if(!match.giftFields.includes(field)||match.claimedFields.includes(field))return 0;
 match.claimedFields.push(field);
 const chance=match.levels.workshop*5;
 const bonus=draw(100)<chance?1:0;
 const gifts=1+bonus;
 const tenths=gifts*(10+match.levels.bakery-1);
 match.giftCount++;
 match.bonusGiftCount+=bonus;
 match.earnedTenths+=tenths;
 match.activity=[...match.activity.slice(-11),{type:'gift',field,seat,gifts,bonus,earnedTenths:tenths}];
 return tenths;
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
 village.giftsCollected+=deltaGifts;
 village.bonusGifts+=deltaBonus;
 if(finished)village.matchesCompleted++;
 village.revision++;
 return village;
}
