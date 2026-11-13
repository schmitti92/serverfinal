// All Deal or No Deal economy amounts are stored as integer cents.
import {MONSTER_SLOTS_WEIGHTS} from './monster-slots.js';
export const SLOT_WEIGHT_KEYS=Object.freeze(Object.keys(MONSTER_SLOTS_WEIGHTS));
export const SLOT_MAX_WEIGHT=10000;
function validateSlotWeights(weights){
 if(!weights||typeof weights!=='object'||Array.isArray(weights)||
   Object.keys(weights).length!==SLOT_WEIGHT_KEYS.length||
   SLOT_WEIGHT_KEYS.some(k=>!Number.isSafeInteger(weights[k])||weights[k]<0||weights[k]>SLOT_MAX_WEIGHT)||
   !SLOT_WEIGHT_KEYS.some(k=>weights[k]>0))throw Error('INVALID_SLOT_WEIGHTS');
 return Object.fromEntries(SLOT_WEIGHT_KEYS.map(k=>[k,weights[k]]));
}
export const DEFAULT_DEAL_ECONOMY=Object.freeze({
 prices:Object.freeze({doubleBoost:300000000,dogSmall:200000000,dogLarge:400000000,dogPremium:600000000,dogPlatinum:2000000000,goldRare:25000000,goldLegendary:150000000}),
 doubleBoostEnabled:true,packsEnabled:true,slotWeights:Object.freeze({...MONSTER_SLOTS_WEIGHTS})
});
export const dealEconomyRef=db=>db.collection('deal_or_no_deal_economy_v1').doc('global');
export function normalizeDealEconomy(raw={}){
 const data=raw&&typeof raw==='object'?raw:{},prices={...DEFAULT_DEAL_ECONOMY.prices};
 for(const key of Object.keys(prices)){const value=data.prices?.[key];if(Number.isSafeInteger(value)&&value>=0&&value<=5000000000)prices[key]=value;}
 let slotWeights=DEFAULT_DEAL_ECONOMY.slotWeights;
 try{slotWeights=validateSlotWeights(data.slotWeights)}catch{}
 return {prices,slotWeights,doubleBoostEnabled:typeof data.doubleBoostEnabled==='boolean'?data.doubleBoostEnabled:true,
  packsEnabled:typeof data.packsEnabled==='boolean'?data.packsEnabled:true,
  revision:Number.isSafeInteger(data.revision)&&data.revision>=0?data.revision:0,
  updatedAt:Number.isSafeInteger(data.updatedAt)?data.updatedAt:null};
}
export function validateDealEconomy(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!input.prices||typeof input.prices!=='object'||Array.isArray(input.prices)||
 typeof input.doubleBoostEnabled!=='boolean'||typeof input.packsEnabled!=='boolean')throw Error('INVALID_ECONOMY_SETTINGS');
 const keys=Object.keys(DEFAULT_DEAL_ECONOMY.prices);
 if(Object.keys(input.prices).length!==keys.length||
  keys.some(key=>!Number.isSafeInteger(input.prices[key])||input.prices[key]<0||input.prices[key]>5000000000))
  throw Error('INVALID_ECONOMY_PRICE');
 return {prices:Object.fromEntries(keys.map(key=>[key,input.prices[key]])),
  // Legacy clients may omit slot weights; the host API preserves the existing ones.
  slotWeights:input.slotWeights===undefined?null:validateSlotWeights(input.slotWeights),
  doubleBoostEnabled:input.doubleBoostEnabled,packsEnabled:input.packsEnabled};
}
export const dogPackPrice=(settings,id)=>settings.prices[({small:'dogSmall',large:'dogLarge',premium:'dogPremium',platinum:'dogPlatinum'})[id]];
export const goldPackPrice=(settings,id)=>settings.prices[id==='rare'?'goldRare':'goldLegendary'];
