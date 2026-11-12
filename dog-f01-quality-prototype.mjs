/** F-01 quality prototype: pure offline rules, NOT connected to live inventory or rewards. */
import {DOG_BALANCE_MATERIALS} from './dog-balance.js';
const DOG_RESOURCES=Object.values(DOG_BALANCE_MATERIALS).flat();
export const QUALITY_LEVELS=Object.freeze([1,2,3]);
export const QUALITY_CONVERSION_RATE=5;
export const qualityUnlockedFromBosses=progress=>{
 const bosses=Array.isArray(progress?.sharedBosses)?progress.sharedBosses:[];
 return bosses.includes(60)?3:bosses.includes(30)?2:1;
};
export const qualityUnlockedForChest=(progress,offer)=>{
 const bossCap=qualityUnlockedFromBosses(progress);
 if(!Number.isSafeInteger(offer?.stage))return bossCap;
 return Math.min(bossCap,offer.stage>=6?3:offer.stage>=3?2:1);
};
export const QUALITY_CHEST_WEIGHTS=Object.freeze({
 wood:Object.freeze([100,0,0]),iron:Object.freeze([95,5,0]),
 silver:Object.freeze([85,14,1]),gold:Object.freeze([70,26,4]),
 legendary:Object.freeze([55,35,10])
});
const validResource=id=>DOG_RESOURCES.includes(id);
const validQuality=q=>QUALITY_LEVELS.includes(q);
export const qualityKey=(id,q)=>{if(!validResource(id)||!validQuality(q))throw Error('INVALID_QUALITY_RESOURCE');return id+':'+q;};
export const emptyQualityInventory=()=>Object.fromEntries(DOG_RESOURCES.flatMap(id=>QUALITY_LEVELS.map(q=>[qualityKey(id,q),0])));
export function migrateQualityInventory(legacy){
 const next=emptyQualityInventory();
 for(const id of DOG_RESOURCES){
  const value=legacy?.[id]??0;
  if(!Number.isSafeInteger(value)||value<0)throw Error('INVALID_LEGACY_QUANTITY');
  next[qualityKey(id,1)]=value;
 }
 return next;
}
export function refineQuality(inventory,id,fromQuality,amount){
 if(!validResource(id)||!validQuality(fromQuality)||fromQuality===3||
  !Number.isSafeInteger(amount)||amount<1)throw Error('INVALID_REFINEMENT');
 const source=qualityKey(id,fromQuality),target=qualityKey(id,fromQuality+1);
 const input=inventory?.[source]??0,output=inventory?.[target]??0;
 if(!Number.isSafeInteger(input)||input<amount*QUALITY_CONVERSION_RATE||
  !Number.isSafeInteger(output)||output<0||output+amount>Number.MAX_SAFE_INTEGER)
  throw Error('INSUFFICIENT_QUALITY_RESOURCES');
 return {...inventory,[source]:input-amount*QUALITY_CONVERSION_RATE,[target]:output+amount};
}
export function drawQuality(tier,rand){
 const weights=QUALITY_CHEST_WEIGHTS[tier];
 if(!weights)throw Error('INVALID_QUALITY_CHEST');
 const roll=rand(100);
 if(!Number.isInteger(roll)||roll<0||roll>=100)throw Error('INVALID_QUALITY_RANDOM');
 return roll<weights[0]?1:roll<weights[0]+weights[1]?2:3;
}
/** Stage-aware rarity and quantity remain owned by dogChestContents. This
 * adds only an independent quality roll to each already-awarded material. */
export function qualityChestDrop(drop,rand,maxQuality=1){
 if(!validQuality(maxQuality))throw Error('INVALID_QUALITY_UNLOCK');
 const inventory=emptyQualityInventory();
 const tier={small:'wood',medium:'silver',large:'gold',legacy:'wood'}[drop?.tier]||drop?.tier;
 if(!QUALITY_CHEST_WEIGHTS[tier])throw Error('INVALID_QUALITY_CHEST');
 for(const id of DOG_RESOURCES){
  const count=drop.items?.[id]??0;
  if(!Number.isSafeInteger(count)||count<0||count>100)throw Error('INVALID_QUALITY_DROP');
  for(let i=0;i<count;i++)inventory[qualityKey(id,Math.min(maxQuality,drawQuality(tier,rand)))]++;
 }
 return inventory;
}

/** Reconciles old aggregate-only writes without duplicating existing quality.
 * resources stays the aggregate field for every legacy server consumer. */
export function reconcileQualityInventory(resources,rawQuality){
 const output=emptyQualityInventory(),provided=rawQuality&&typeof rawQuality==='object'?rawQuality:{};
 for(const id of DOG_RESOURCES){
  const total=resources?.[id]??0;
  if(!Number.isSafeInteger(total)||total<0||total>1_000_000)throw Error('INVALID_QUALITY_INVENTORY');
  let allocated=0;
  for(const level of QUALITY_LEVELS){
   const value=provided[qualityKey(id,level)]??0;
   if(!Number.isSafeInteger(value)||value<0||value>1_000_000)throw Error('INVALID_QUALITY_INVENTORY');
   output[qualityKey(id,level)]=value;allocated+=value;
  }
  if(allocated<total)output[qualityKey(id,1)]+=total-allocated;
  if(allocated>total){
   let excess=allocated-total;
   for(const level of QUALITY_LEVELS){
    const key=qualityKey(id,level),take=Math.min(excess,output[key]);
    output[key]-=take;excess-=take;
   }
  }
 }
 return output;
}
