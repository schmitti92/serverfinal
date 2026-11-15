/**
 * Host-controlled DOG Christmas scratch settings.
 * Percentages are per 1000 tickets (one unit = 0.1%).
 * This document is shared across the event; a room host can change it only
 * through the server's room-authorized settings endpoint.
 */
export const DOG_SCRATCH_SETTINGS_COLLECTION='dog_christmas_scratch_settings_v1';
export const DOG_SCRATCH_SETTINGS_ID='global';
export const DOG_SCRATCH_VARIANTS=Object.freeze(['gifts','snow_collect','elf','premium_27']);
const defaults=Object.freeze({
 gifts:Object.freeze({weights:Object.freeze({none:200,coins:689,unlock:111}),extraCoinChance:30,maxPrizes:3}),
 snow_collect:Object.freeze({weights:Object.freeze({none:200,coins:689,unlock:111}),extraCoinChance:30,maxPrizes:3}),
 elf:Object.freeze({weights:Object.freeze({none:200,coins:770,unlock:30}),extraCoinChance:40,maxPrizes:3}),
 premium_27:Object.freeze({weights:Object.freeze({none:200,coins:760,unlock:40}),extraCoinChance:50,maxPrizes:3})
});
export const DOG_SCRATCH_DEFAULT_SETTINGS=Object.freeze({
 version:1,freeEnabled:false,variants:defaults
});
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
function validVariant(config,id){
 const w=config?.weights;
 return config&&typeof config==='object'&&!Array.isArray(config)&&w&&typeof w==='object'&&
  ['none','coins','unlock'].every(key=>integer(w[key],0,1000))&&
  w.none+w.coins+w.unlock===1000&&
  integer(config.extraCoinChance,0,100)&&
  integer(config.maxPrizes,id==='premium_27'?2:1,3);
}
/** Read stored settings defensively, retaining defaults for older documents. */
export function normalizeScratchSettings(raw){
 const variants={};
 for(const id of DOG_SCRATCH_VARIANTS){
  const candidate=raw?.variants?.[id];
  const v=validVariant(candidate,id)?candidate:defaults[id];
  variants[id]={weights:{none:v.weights.none,coins:v.weights.coins,unlock:v.weights.unlock},
   extraCoinChance:v.extraCoinChance,maxPrizes:v.maxPrizes};
 }
 return {version:1,freeEnabled:raw?.freeEnabled===true,variants};
}
/** Reject malformed or partial host edits before any Firestore write. */
export function validateScratchSettings(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||typeof raw.freeEnabled!=='boolean'||
   !raw.variants||typeof raw.variants!=='object'||Array.isArray(raw.variants)||
   Object.keys(raw.variants).length!==DOG_SCRATCH_VARIANTS.length||
   DOG_SCRATCH_VARIANTS.some(id=>!validVariant(raw.variants[id],id)))
  throw Error('SCRATCH_SETTINGS_INVALID');
 return normalizeScratchSettings(raw);
}
