/**
 * Optional 10-pack for NON-EDITION paid DOG scratch cards.
 *
 * All ten purchases, prizes, village lights and research grants are committed
 * by the caller in one Firestore transaction BEFORE any ticket is presented.
 * Render RAM only caches these already-owned receipts for cheap reveal reads.
 * There must NEVER be a payout triggered by revealing a cached ticket.
 */
import {buyScratchTicket,grantDogScratchVoucher} from './christmas-scratch.js';
import {dogResearchLevel,dogResearchPityThreshold} from './christmas-research.js';

export const DOG_SCRATCH_BATCH_COUNT=10;
export const DOG_SCRATCH_BATCH_COLLECTION='dog_christmas_scratch_batches_v1';
export const DOG_SCRATCH_BATCH_VARIANTS=Object.freeze({
 elf:'medium',
 premium_27:'premium'
});

export function scratchBatchPublic(raw){
 if(!raw||typeof raw!=='object'||!Array.isArray(raw.tickets)||raw.tickets.length!==DOG_SCRATCH_BATCH_COUNT)return null;
 return {id:raw.id,variantId:raw.variantId,tier:raw.tier,count:DOG_SCRATCH_BATCH_COUNT,
  purchasedAt:raw.purchasedAt,totalSpent:raw.totalSpent,totalWon:raw.totalWon,
  totalLights:raw.totalLights,credited:true};
}

export function preparePaidScratchBatch({wallet,tree,settings,rawResearch,discountPercent=0,
 coinBonusPercent=0,now=Date.now,variantId,batchId}){
 const tier=DOG_SCRATCH_BATCH_VARIANTS[variantId];
 if(!tier||typeof batchId!=='string'||!/^scratch-batch-[0-9a-f-]{36}$/.test(batchId))
  throw Error('SCRATCH_BATCH_INVALID_REQUEST');
 if(settings?.freeEnabled===true)throw Error('SCRATCH_BATCH_FREE_MODE_ACTIVE');
 let updatedWallet=wallet,updatedResearch=null;
 let pityNiets=Number.isSafeInteger(rawResearch?.pityNiets)?rawResearch.pityNiets:0;
 const pityLevel=dogResearchLevel(rawResearch,'pity');
 const threshold=pityLevel>0?dogResearchPityThreshold(pityLevel):Infinity;
 const tickets=[];
 let totalSpent=0,totalWon=0,totalLights=0;
 for(let i=0;i<DOG_SCRATCH_BATCH_COUNT;i++){
  const commandId=batchId+'-'+(i+1);
  // Each ticket uses the same verified rules as the ordinary /scratch/buy API.
  const purchase=buyScratchTicket(updatedWallet,tree,
   {tier,variantId,commandId,free:false,voucher:false},
   {settings,discountPercent,now});
  if(purchase.unchanged)throw Error('SCRATCH_BATCH_RECEIPT_COLLISION');
  updatedWallet=purchase.wallet;
  const result={...purchase.result};
  const mainCoins=Math.max(0,Number(result.totalCoins)||0);
  const extra=coinBonusPercent?Math.floor(mainCoins*coinBonusPercent/100):0;
  if(extra>0){
   updatedWallet.coins=Math.min(1000000000,updatedWallet.coins+extra);
   result.researchBonusCoins=extra;
   result.balance=updatedWallet.coins;
  }
  if(pityLevel>0&&result.price>0&&result.type==='none'&&mainCoins===0&&
     !(Number(result.totalLights)>0)){
   pityNiets++;
   if(pityNiets>=threshold){
    pityNiets-=threshold;
    updatedWallet=grantDogScratchVoucher(updatedWallet,'simple');
    result.pityVoucherEarned=true;
   }
  }
  // Persist the identical replay receipt with research-bonus adjustments.
  const ix=updatedWallet.recent.findIndex(receipt=>receipt.commandId===commandId);
  if(ix<0)throw Error('SCRATCH_BATCH_RECEIPT_MISSING');
  updatedWallet.recent[ix]={commandId,result};
  updatedWallet.lastResult=result;
  tickets.push(result);
  totalSpent+=result.price;
  totalWon+=mainCoins+extra;
  totalLights+=Number.isSafeInteger(result.totalLights)?result.totalLights:0;
 }
 if(pityLevel>0&&pityNiets!==Number(rawResearch?.pityNiets||0)){
  updatedResearch={...(rawResearch||{}),pityNiets,updatedAt:now()};
 }
 const purchasedAt=now();
 return {wallet:updatedWallet,research:updatedResearch,
  batch:{id:batchId,variantId,tier,count:DOG_SCRATCH_BATCH_COUNT,
   purchasedAt,totalSpent,totalWon,totalLights,
   tickets}};
}
