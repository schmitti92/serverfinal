/** One shared Boss-Siegel per first group victory at gates 10..90.
 * Balance = earned victories - completed forge ascensions; no reward write
 * is required when a fight finishes, so historical victories also count. */
export const DOG_FORGE_MAX_LEVEL=10;
export const DOG_EQUIPMENT_MAX_LEVEL=50;
// Personal material types are unlocked for the expedition by SHARED forge
// progression, not by lucky chest tier or inventory history. The common
// material starts available; bosses 10,20,30,50 make tiers 2..5 accessible
// after the corresponding shared forge-level promotion.
export const DOG_MATERIAL_RARITY_UNLOCKS=Object.freeze([
 Object.freeze({rarity:'common',forgeLevel:1,boss:0}),
 Object.freeze({rarity:'uncommon',forgeLevel:2,boss:10}),
 Object.freeze({rarity:'rare',forgeLevel:3,boss:20}),
 Object.freeze({rarity:'epic',forgeLevel:4,boss:30}),
 Object.freeze({rarity:'legendary',forgeLevel:6,boss:50})
]);
export const dogMaterialRarityCap=progressRaw=>{
 const {forgeLevel}=levels(progressRaw);
 return DOG_MATERIAL_RARITY_UNLOCKS.reduce((cap,entry,i)=>
  forgeLevel>=entry.forgeLevel?i:cap,0);
};

const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const levels=progressRaw=>{
 const raw=object(progressRaw);
 const bosses=Array.isArray(raw.sharedBosses)?raw.sharedBosses:[];
 const wins=Array.from(new Set(bosses.filter(x=>
  Number.isSafeInteger(x)&&x>=10&&x<=90&&x%10===0))).length;
 // Existing progress has no forgeLevel: start at 1 with all earned sigils.
 const forgeLevel=Number.isSafeInteger(raw.forgeLevel)?
  Math.max(1,Math.min(DOG_FORGE_MAX_LEVEL,raw.forgeLevel)):1;
 return {forgeLevel,wins,bossSeals:Math.max(0,wins-(forgeLevel-1)),
  equipmentCap:forgeLevel*5,skillsCap:forgeLevel*5};
};
export const dogForgeProgress=levels;
export const dogForgeCombatTier=level=>Math.max(1,Math.min(10,Math.ceil(
 (Number.isSafeInteger(level)?level:1)/5)));
export function dogForgeLevelUp(progressRaw,expectedLevel,now=Date.now()){
 const current=levels(progressRaw);
 if(!Number.isSafeInteger(expectedLevel)||current.forgeLevel!==expectedLevel)
  throw Error('DOG_FORGE_LEVEL_STALE');
 if(current.forgeLevel>=DOG_FORGE_MAX_LEVEL)throw Error('DOG_FORGE_LEVEL_MAX');
 if(current.bossSeals<1)throw Error('DOG_FORGE_BOSS_SEAL_REQUIRED');
 const next={...object(progressRaw),forgeLevel:current.forgeLevel+1,updatedAt:now};
 return {progress:next,result:{type:'forge-level-up',oldLevel:current.forgeLevel,
  newLevel:current.forgeLevel+1,spentBossSeals:1,remainingBossSeals:levels(next).bossSeals}};
}
