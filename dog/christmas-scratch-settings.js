/**
 * Host-controlled DOG Christmas scratch settings.
 * Percentages are per 1000 tickets (one unit = 0.1%).
 * This document is shared across the event; a room host can change it only
 * through the server's room-authorized settings endpoint.
 */
export const DOG_SCRATCH_SETTINGS_COLLECTION='dog_christmas_scratch_settings_v1';
export const DOG_SCRATCH_SETTINGS_ID='global';
export const DOG_SCRATCH_VARIANTS=Object.freeze(['gifts','snow_collect','elf','premium_27']);
// Each symbol has its own payout for each ticket. Existing tickets keep
// historical values; old saved host preferences are upgraded on read.
export const DOG_SCRATCH_COIN_MAX=50000000;
const defaultCoins=Object.freeze({
 gifts:Object.freeze([10,40,100]),
 snow_collect:Object.freeze([10,40,100]),
 elf:Object.freeze([100,300,800]),
 premium_27:Object.freeze([200,800,2000])
});
// Probabilities are conditional on the main ticket category: money or unlock.
// Values use per-mille precision, allowing independent 0.1% increments.
export const DOG_SCRATCH_DEFAULT_MONEY_WEIGHTS=Object.freeze([334,333,333]);
export const DOG_SCRATCH_DEFAULT_GIFT_WEIGHTS=Object.freeze([200,200,200,200,200]);
const defaults=Object.freeze({
 gifts:Object.freeze({weights:Object.freeze({none:200,coins:689,unlock:111}),extraCoinChance:30,maxPrizes:3,coinAmounts:defaultCoins.gifts,moneySymbolWeights:DOG_SCRATCH_DEFAULT_MONEY_WEIGHTS,giftSymbolWeights:DOG_SCRATCH_DEFAULT_GIFT_WEIGHTS}),
 snow_collect:Object.freeze({weights:Object.freeze({none:200,coins:689,unlock:111}),extraCoinChance:30,maxPrizes:3,coinAmounts:defaultCoins.snow_collect,moneySymbolWeights:DOG_SCRATCH_DEFAULT_MONEY_WEIGHTS,giftSymbolWeights:DOG_SCRATCH_DEFAULT_GIFT_WEIGHTS}),
 elf:Object.freeze({weights:Object.freeze({none:200,coins:770,unlock:30}),extraCoinChance:40,maxPrizes:3,coinAmounts:defaultCoins.elf,moneySymbolWeights:DOG_SCRATCH_DEFAULT_MONEY_WEIGHTS,giftSymbolWeights:DOG_SCRATCH_DEFAULT_GIFT_WEIGHTS}),
 premium_27:Object.freeze({weights:Object.freeze({none:200,coins:760,unlock:40}),extraCoinChance:50,maxPrizes:6,coinAmounts:defaultCoins.premium_27,moneySymbolWeights:DOG_SCRATCH_DEFAULT_MONEY_WEIGHTS,giftSymbolWeights:DOG_SCRATCH_DEFAULT_GIFT_WEIGHTS})
});
export const NUMBER_ONE_20_SETTINGS_DEFAULT=Object.freeze({
 price:500,hitPer1000:100,giftFallbackCoins:1500,
 coinAmounts:Object.freeze([100,300,800]),
 symbolWeights:Object.freeze([650,280,60,10])
});
export const DOG_SCRATCH_DEFAULT_SETTINGS=Object.freeze({
 version:1,freeEnabled:false,variants:defaults,numberOne20:NUMBER_ONE_20_SETTINGS_DEFAULT
});
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
export function validScratchCoinAmounts(amounts){
 return Array.isArray(amounts)&&amounts.length===3&&
  amounts.every(amount=>integer(amount,1,DOG_SCRATCH_COIN_MAX))&&
  amounts[0]<amounts[1]&&amounts[1]<amounts[2];
}
export function validScratchSymbolWeights(weights,expectedCount){
 return Array.isArray(weights)&&weights.length===expectedCount&&
  weights.every(weight=>integer(weight,0,1000))&&
  weights.reduce((sum,weight)=>sum+weight,0)===1000;
}
/**
 * Draws one exact weighted icon (0.1% resolution). Excluded icons are not
 * silently reintroduced when all their remaining weights are zero.
 * The caller can then stop creating additional visual matches.
 */
export function pickWeightedScratchSymbol(weights,draw,allowedIndices=null){
 const eligible=(allowedIndices??weights.map((_,index)=>index))
  .filter(index=>Number.isInteger(index)&&index>=0&&index<weights.length&&weights[index]>0);
 const total=eligible.reduce((sum,index)=>sum+weights[index],0);
 if(!total)return -1;
 const roll=draw(total);
 if(!Number.isInteger(roll)||roll<0||roll>=total)throw Error('SCRATCH_INVALID_RANDOM');
 let remaining=roll;
 for(const index of eligible){
  if(remaining<weights[index])return index;
  remaining-=weights[index];
 }
 throw Error('SCRATCH_SYMBOL_WEIGHT_ERROR');
}
function validVariant(config,id){
 const w=config?.weights;
 return config&&typeof config==='object'&&!Array.isArray(config)&&w&&typeof w==='object'&&
  ['none','coins','unlock'].every(key=>integer(w[key],0,1000))&&
  w.none+w.coins+w.unlock===1000&&
  integer(config.extraCoinChance,0,100)&&
  integer(config.maxPrizes,1,10)&&
  // Allow older stored settings and cached host clients to migrate safely.
  (config.coinAmounts===undefined||validScratchCoinAmounts(config.coinAmounts))&&
  (config.moneySymbolWeights===undefined||validScratchSymbolWeights(config.moneySymbolWeights,3))&&
  (config.giftSymbolWeights===undefined||validScratchSymbolWeights(config.giftSymbolWeights,5)||
    validScratchSymbolWeights(config.giftSymbolWeights,4));
}
function validNumberOne20(value){
 return value&&typeof value==='object'&&!Array.isArray(value)&&
  integer(value.price,1,1000000)&&integer(value.hitPer1000,0,1000)&&
  (value.giftFallbackCoins===undefined||integer(value.giftFallbackCoins,0,DOG_SCRATCH_COIN_MAX))&&
  validScratchCoinAmounts(value.coinAmounts)&&
  validScratchSymbolWeights(value.symbolWeights,4);
}
function normalizeNumberOne20(value){
 const source=validNumberOne20(value)?value:NUMBER_ONE_20_SETTINGS_DEFAULT;
 return {price:source.price,hitPer1000:source.hitPer1000,
  giftFallbackCoins:source.giftFallbackCoins??1500,
  coinAmounts:[...source.coinAmounts],symbolWeights:[...source.symbolWeights]};
}
// Safely migrate old four-symbol chances. Existing relative weights keep their
// proportion, with the fifth jackpot symbol getting a 10% entry chance.
export function normalizeFiveGiftWeights(old){
 if(!Array.isArray(old))return [...DOG_SCRATCH_DEFAULT_GIFT_WEIGHTS];
 if(validScratchSymbolWeights(old,5))return [...old];
 if(!validScratchSymbolWeights(old,4))return [...DOG_SCRATCH_DEFAULT_GIFT_WEIGHTS];
 const scaled=old.map(n=>Math.floor(n*.9));
 return [...scaled,1000-scaled.reduce((a,b)=>a+b,0)];
}
/** Read stored settings defensively, retaining defaults for older documents. */
export function normalizeScratchSettings(raw){
 const variants={};
 for(const id of DOG_SCRATCH_VARIANTS){
  const candidate=raw?.variants?.[id];
  const v=validVariant(candidate,id)?candidate:defaults[id];
  variants[id]={weights:{none:v.weights.none,coins:v.weights.coins,unlock:v.weights.unlock},
   extraCoinChance:v.extraCoinChance,maxPrizes:id==='premium_27'?Math.max(6,v.maxPrizes):v.maxPrizes,
   coinAmounts:[...(v.coinAmounts??defaultCoins[id])],
   moneySymbolWeights:[...(v.moneySymbolWeights??DOG_SCRATCH_DEFAULT_MONEY_WEIGHTS)],
   giftSymbolWeights:normalizeFiveGiftWeights(v.giftSymbolWeights)};
 }
 return {version:1,freeEnabled:raw?.freeEnabled===true,variants,
  numberOne20:normalizeNumberOne20(raw?.numberOne20)};
}
/** Reject malformed or partial host edits before any Firestore write. */
export function validateScratchSettings(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||typeof raw.freeEnabled!=='boolean'||
   !raw.variants||typeof raw.variants!=='object'||Array.isArray(raw.variants)||
   Object.keys(raw.variants).length!==DOG_SCRATCH_VARIANTS.length||
   DOG_SCRATCH_VARIANTS.some(id=>!validVariant(raw.variants[id],id))||
   (raw.numberOne20!==undefined&&!validNumberOne20(raw.numberOne20)))
  throw Error('SCRATCH_SETTINGS_INVALID');
 return normalizeScratchSettings(raw);
}
