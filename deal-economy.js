// All Deal or No Deal economy amounts are stored as integer cents.
export const DEFAULT_DEAL_ECONOMY=Object.freeze({
 prices:Object.freeze({doubleBoost:300000000,dogSmall:200000000,dogLarge:400000000,dogPremium:600000000,dogPlatinum:2000000000,goldRare:25000000,goldLegendary:150000000}),
 doubleBoostEnabled:true,packsEnabled:true
});
export const dealEconomyRef=db=>db.collection('deal_or_no_deal_economy_v1').doc('global');
export function normalizeDealEconomy(raw={}){
 const data=raw&&typeof raw==='object'?raw:{},prices={...DEFAULT_DEAL_ECONOMY.prices};
 for(const key of Object.keys(prices)){const value=data.prices?.[key];if(Number.isSafeInteger(value)&&value>=0&&value<=5000000000)prices[key]=value;}
 return {prices,doubleBoostEnabled:typeof data.doubleBoostEnabled==='boolean'?data.doubleBoostEnabled:true,
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
  doubleBoostEnabled:input.doubleBoostEnabled,packsEnabled:input.packsEnabled};
}
export const dogPackPrice=(settings,id)=>settings.prices[({small:'dogSmall',large:'dogLarge',premium:'dogPremium',platinum:'dogPlatinum'})[id]];
export const goldPackPrice=(settings,id)=>settings.prices[id==='rare'?'goldRare':'goldLegendary'];
