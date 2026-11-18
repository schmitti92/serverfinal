/**
 * A finite Schneeflocken-Bingo series: 500 real purchases share ONE maximum
 * coin-payout budget. The server issues each ticket at purchase, not in a
 * slow 500-ticket preview. Firestore's transaction makes this budget atomic.
 * No other DOG ticket kind is changed.
 */
import {buyScratchTicket} from './christmas-scratch.js';
import {normalizeScratchSettings} from './christmas-scratch-settings.js';

export const SNOW_EDITION_COLLECTION='dog_christmas_snow_editions_v1';
export const SNOW_EDITION_CURRENT='current';
export const SNOW_EDITION_HISTORY_COLLECTION='dog_christmas_snow_editions_archive_v1';
export const SNOW_EDITION_SIZE=500;
export const SNOW_EDITION_MAX_COINS=1000000000000;

export function createSnowEdition({id,createdAt,createdBy,maxTotalCoins,settings}){
 if(typeof id!=='string'||!id||!Number.isSafeInteger(createdAt)||
    typeof createdBy!=='string'||!createdBy||
    !Number.isSafeInteger(maxTotalCoins)||maxTotalCoins<0||
    maxTotalCoins>SNOW_EDITION_MAX_COINS)
  throw Error('SCRATCH_SNOW_EDITION_INVALID_BUDGET');
 const snow_collect=normalizeScratchSettings(settings).variants.snow_collect;
 return {id,createdAt,createdBy,variantId:'snow_collect',size:SNOW_EDITION_SIZE,
  issued:0,maxTotalCoins,paidCoins:0,config:snow_collect};
}

export function snow_collectEditionPublic(raw){
 if(!raw||raw.variantId!=='snow_collect')return null;
 const issued=Number.isInteger(raw.issued)?Math.max(0,Math.min(500,raw.issued)):0;
 const paidCoins=Number.isSafeInteger(raw.paidCoins)?Math.max(0,raw.paidCoins):0;
 const maxTotalCoins=Number.isSafeInteger(raw.maxTotalCoins)?raw.maxTotalCoins:0;
 return {id:raw.id,size:SNOW_EDITION_SIZE,issued,remaining:SNOW_EDITION_SIZE-issued,
  maxTotalCoins,paidCoins,remainingCoins:Math.max(0,maxTotalCoins-paidCoins),
  status:issued===SNOW_EDITION_SIZE?'sold_out':'active',
  createdAt:raw.createdAt,config:raw.config};
}

/**
 * Generate one server-verified purchase without ever exceeding the remaining
 * shared payout allowance. A zero-money card is guaranteed as a safe fallback
 * if the remaining budget cannot fit a normal win. Light rewards are separate.
 * The ledger advance must be written in the SAME Firestore transaction as the
 * wallet and, when applicable, the shared Lichtertal village.
 */
export function issueSnowEditionTicket(wallet,tree,request,rawEdition,liveSettings,options={}){
 if(!rawEdition||rawEdition.variantId!=='snow_collect')throw Error('SCRATCH_SNOW_EDITION_MISSING');
 if(request?.variantId!=='snow_collect'||request?.tier!=='simple')throw Error('SCRATCH_INVALID_VARIANT');
 const issued=rawEdition.issued,maxCoins=rawEdition.maxTotalCoins,paid=rawEdition.paidCoins;
 if(!Number.isInteger(issued)||issued<0||issued>SNOW_EDITION_SIZE||
    !Number.isSafeInteger(maxCoins)||maxCoins<0||maxCoins>SNOW_EDITION_MAX_COINS||
    !Number.isSafeInteger(paid)||paid<0||paid>maxCoins)
  throw Error('SCRATCH_SNOW_EDITION_CORRUPT');
 // Authenticated wallet idempotency is checked BEFORE sold-out status, so
 // reconnecting an already purchased scratch card can never consume a new slot.
 const saved=wallet?.recent?.find(r=>r.commandId===request.commandId);
 const normalized=normalizeScratchSettings(liveSettings);
 const settings={...normalized,
  variants:{...normalized.variants,snow_collect:rawEdition.config}};
 if(saved){
  const replay=buyScratchTicket(wallet,tree,request,{...options,settings});
  return {purchase:replay,edition:rawEdition};
 }
 if(issued>=SNOW_EDITION_SIZE)throw Error('SCRATCH_SNOW_EDITION_SOLD_OUT');
 const left=maxCoins-paid;
 let purchase=null;
 // When even the smallest money prize cannot fit, make one ordinary draw
 // (to preserve the chance of a free design), then use the safe zero-coin card.
 // Never regenerate 500 cards in a single user request.
 const minCoin=rawEdition.config?.coinAmounts?.[0]??1;
 const maxAttempts=left<minCoin?1:12;
 for(let i=0;i<maxAttempts;i++){
  const attempt=buyScratchTicket(wallet,tree,request,{...options,settings});
  if(attempt.result.totalCoins<=left){purchase=attempt;break}
 }
 if(!purchase){
  // A full-cost payout must not be issued when the communal money pool is
  // empty. The forced zero-money rule still allows genuine Christmas lights.
  const noMoneySnow={...settings.variants.snow_collect,
   weights:{none:1000,coins:0,unlock:0},extraCoinChance:0,doubleChancePer1000:0};
  const safeSettings={...settings,variants:{...settings.variants,snow_collect:noMoneySnow}};
  purchase=buyScratchTicket(wallet,tree,request,{...options,settings:safeSettings});
  if(purchase.result.totalCoins!==0)throw Error('SCRATCH_SNOW_BUDGET_FALLBACK_FAILED');
 }
 const next={...rawEdition,issued:issued+1,
  paidCoins:paid+purchase.result.totalCoins};
 if(next.paidCoins>next.maxTotalCoins)throw Error('SCRATCH_SNOW_EDITION_BUDGET_EXCEEDED');
 // Receipt numbers never influence the authoritative winnings, just display.
 purchase.result.snowEditionId=rawEdition.id;
 purchase.result.snowEditionNumber=next.issued;
 return {purchase,edition:next};
}
