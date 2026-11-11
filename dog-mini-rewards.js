/** One-time solo mini-boss prizes in the 100-Tore expedition.
 * All choices are server-only; this module does not accept client reward data.
 * Only the authenticated gate-fight transaction may invoke the award.
 */
import {randomInt} from 'node:crypto';
import {dogChestOffer} from './dog-balance.js';
import {addExpeditionChestToInventory,DOG_MATERIALS_COLLECTION} from './dog-materials.js';
import {newIceState,normalizeIceState} from './christmas-ice-engine.js';

export const DOG_MINI_REWARD_COLLECTIONS=Object.freeze({
 chest:DOG_MATERIALS_COLLECTION,
 coins:'deal_or_no_deal_wallets_v1',
 cards:'deal_or_no_deal_christmas_v1',
 hammer:'christmas_ice_progress_v1',
 joker:'deal_peek_inventory_v1'
});
export const DOG_MINI_REWARD_WEIGHTS=Object.freeze({
 chest:35,coins:30,cards:20,hammer:10,joker:5
});
const REWARD_TYPES=Object.freeze(Object.keys(DOG_MINI_REWARD_WEIGHTS));
const MAX_BALANCE=1_000_000_000_000_000;
const draw=(rand,n)=>{
 const value=rand(n);
 if(!Number.isSafeInteger(value)||value<0||value>=n)throw Error('DOG_MINI_REWARD_RANDOM_INVALID');
 return value;
};
const safeBalance=(n,max=MAX_BALANCE)=>{
 if(n===undefined||n===null)return 0;
 if(!Number.isSafeInteger(n)||n<0||n>max)throw Error('DOG_MINI_REWARD_INVALID_BALANCE');
 return n;
};
const addBalance=(n,amount,max=MAX_BALANCE)=>{
 const sum=safeBalance(n,max)+amount;
 if(!Number.isSafeInteger(sum)||sum>max)throw Error('DOG_MINI_REWARD_LIMIT');
 return sum;
};
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const gateTier=gate=>{
 if(!Number.isSafeInteger(gate)||gate<5||gate>95||gate%10!==5)
  throw Error('DOG_MINI_REWARD_INVALID_GATE');
 return (gate-5)/10;
};
export function dogDrawMiniReward(gate,highestGate=gate+1,rand=randomInt){
 const tier=gateTier(gate);
 let p=draw(rand,100),kind=REWARD_TYPES.at(-1);
 for(const type of REWARD_TYPES){
  p-=DOG_MINI_REWARD_WEIGHTS[type];
  if(p<0){kind=type;break}
 }
 if(kind==='chest'){
  const offer=dogChestOffer(highestGate,rand);
  return {kind,label:offer.tier==='legendary'?'Legendäre Rohstofftruhe':'Rohstoffkiste',
   tier:offer.tier,count:offer.count,offer};
 }
 if(kind==='coins'){
  // Noticeable early on, modest at high levels. No huge sums at gate 5.
  const amount=50_000*(tier+1)*(tier+1);
  return {kind,label:'Geldprämie',amount};
 }
 if(kind==='cards'){
  // Gift a REDEEMABLE Christmas pack voucher, not phantom/instant cards.
  const options=tier>=7?['small','large','premium']:tier>=3?['small','large']:['small'];
  const packId=options[draw(rand,options.length)];
  return {kind,label:'Weihnachts-Kartenpaket-Gutschein',packId,quantity:1};
 }
 if(kind==='hammer'){
  const options=tier>=7?['single','double','lucky']:tier>=3?['single','double']:['single'];
  const hammer=options[draw(rand,options.length)];
  return {kind,label:'Eisblock-Hammer',hammer,quantity:1};
 }
 return {kind,label:'Koffer-Joker',quantity:1};
}
export function dogMiniRewardDocument(reward,stored,now=Date.now(),rand=randomInt){
 const previous=obj(stored);
 if(!reward||!Object.hasOwn(DOG_MINI_REWARD_COLLECTIONS,reward.kind))
  throw Error('DOG_MINI_REWARD_INVALID');
 if(reward.kind==='chest'){
  return {data:addExpeditionChestToInventory(stored,reward.offer,now),merge:false};
 }
 if(reward.kind==='coins'){
  if(!Number.isSafeInteger(reward.amount)||reward.amount<=0)
   throw Error('DOG_MINI_REWARD_INVALID');
  return {data:{balance:addBalance(previous.balance,reward.amount),updatedAt:now},merge:true};
 }
 if(reward.kind==='cards'){
  if(!['small','large','premium'].includes(reward.packId)||reward.quantity!==1)
   throw Error('DOG_MINI_REWARD_INVALID');
  const previousPacks=obj(previous.freeChristmasPacks);
  const next={...previousPacks,[reward.packId]:addBalance(previousPacks[reward.packId],1,1_000_000)};
  return {data:{freeChristmasPacks:next,updatedAt:now},merge:true};
 }
 if(reward.kind==='hammer'){
  if(!['single','double','lucky'].includes(reward.hammer)||reward.quantity!==1)
   throw Error('DOG_MINI_REWARD_INVALID');
  // The ice game tracks both hammer availability and wheel-earned lifetime
  // quantities in its established schema.
  const ice=stored?normalizeIceState(stored):newIceState(rand);
  const freeHammers={...obj(ice.freeHammers)};
  const wheelHammers={...obj(ice.wheelHammers)};
  freeHammers[reward.hammer]=addBalance(freeHammers[reward.hammer],1,1_000_000);
  wheelHammers[reward.hammer]=addBalance(wheelHammers[reward.hammer],1,1_000_000);
  return {data:{...ice,freeHammers,wheelHammers,updatedAt:now},merge:false};
 }
 if(reward.kind==='joker'){
  if(reward.quantity!==1)throw Error('DOG_MINI_REWARD_INVALID');
  return {data:{balance:addBalance(previous.balance,1,1_000_000),updatedAt:now},merge:true};
 }
 throw Error('DOG_MINI_REWARD_INVALID');
}
