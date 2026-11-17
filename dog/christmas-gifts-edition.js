/**
 * A finite Geschenkelinie series: 500 real purchases share ONE maximum
 * coin-payout budget. The server issues each ticket at purchase, not in a
 * slow 500-ticket preview. Firestore's transaction makes this budget atomic.
 * No other DOG ticket kind is changed.
 */
import {buyScratchTicket} from './christmas-scratch.js';
import {normalizeScratchSettings} from './christmas-scratch-settings.js';

export const GIFTS_EDITION_COLLECTION='dog_christmas_gifts_editions_v1';
export const GIFTS_EDITION_CURRENT='current';
export const GIFTS_EDITION_HISTORY_COLLECTION='dog_christmas_gifts_editions_archive_v1';
export const GIFTS_EDITION_SIZE=500;
export const GIFTS_EDITION_MAX_COINS=1000000000000;

export function createGiftsEdition({id,createdAt,createdBy,maxTotalCoins,settings}){
 if(typeof id!=='string'||!id||!Number.isSafeInteger(createdAt)||
    typeof createdBy!=='string'||!createdBy||
    !Number.isSafeInteger(maxTotalCoins)||maxTotalCoins<0||
    maxTotalCoins>GIFTS_EDITION_MAX_COINS)
  throw Error('SCRATCH_GIFTS_EDITION_INVALID_BUDGET');
 const gifts=normalizeScratchSettings(settings).variants.gifts;
 return {id,createdAt,createdBy,variantId:'gifts',size:GIFTS_EDITION_SIZE,
  issued:0,maxTotalCoins,paidCoins:0,config:gifts};
}

export function giftsEditionPublic(raw){
 if(!raw||raw.variantId!=='gifts')return null;
 const issued=Number.isInteger(raw.issued)?Math.max(0,Math.min(500,raw.issued)):0;
 const paidCoins=Number.isSafeInteger(raw.paidCoins)?Math.max(0,raw.paidCoins):0;
 const maxTotalCoins=Number.isSafeInteger(raw.maxTotalCoins)?raw.maxTotalCoins:0;
 return {id:raw.id,size:GIFTS_EDITION_SIZE,issued,remaining:GIFTS_EDITION_SIZE-issued,
  maxTotalCoins,paidCoins,remainingCoins:Math.max(0,maxTotalCoins-paidCoins),
  status:issued===GIFTS_EDITION_SIZE?'sold_out':'active',
  createdAt:raw.createdAt,config:raw.config};
}

/**
 * Generate one server-verified purchase without ever exceeding the remaining
 * shared payout allowance. A zero-money card is guaranteed as a safe fallback
 * if the remaining budget cannot fit a normal win. Light rewards are separate.
 * The ledger advance must be written in the SAME Firestore transaction as the
 * wallet and, when applicable, the shared Lichtertal village.
 */
export function issueGiftsEditionTicket(wallet,tree,request,rawEdition,liveSettings,options={}){
 if(!rawEdition||rawEdition.variantId!=='gifts')throw Error('SCRATCH_GIFTS_EDITION_MISSING');
 if(request?.variantId!=='gifts'||request?.tier!=='simple')throw Error('SCRATCH_INVALID_VARIANT');
 const issued=rawEdition.issued,maxCoins=rawEdition.maxTotalCoins,paid=rawEdition.paidCoins;
 if(!Number.isInteger(issued)||issued<0||issued>GIFTS_EDITION_SIZE||
    !Number.isSafeInteger(maxCoins)||maxCoins<0||maxCoins>GIFTS_EDITION_MAX_COINS||
    !Number.isSafeInteger(paid)||paid<0||paid>maxCoins)
  throw Error('SCRATCH_GIFTS_EDITION_CORRUPT');
 // Authenticated wallet idempotency is checked BEFORE sold-out status, so
 // reconnecting an already purchased scratch card can never consume a new slot.
 const saved=wallet?.recent?.find(r=>r.commandId===request.commandId);
 const normalized=normalizeScratchSettings(liveSettings);
 const settings={...normalized,
  variants:{...normalized.variants,gifts:rawEdition.config}};
 if(saved){
  const replay=buyScratchTicket(wallet,tree,request,{...options,settings});
  return {purchase:replay,edition:rawEdition};
 }
 if(issued>=GIFTS_EDITION_SIZE)throw Error('SCRATCH_GIFTS_EDITION_SOLD_OUT');
 const left=maxCoins-paid;
 let purchase=null;
 const maxAttempts=24;
 for(let i=0;i<maxAttempts;i++){
  const attempt=buyScratchTicket(wallet,tree,request,{...options,settings});
  if(attempt.result.totalCoins<=left){purchase=attempt;break}
 }
 if(!purchase){
  // A full-cost payout must not be issued when the communal money pool is
  // empty. The forced zero-money rule still allows genuine Christmas lights.
  const noMoneyGifts={...settings.variants.gifts,
   weights:{none:1000,coins:0,unlock:0},extraCoinChance:0,doubleChancePer1000:0};
  const safeSettings={...settings,variants:{...settings.variants,gifts:noMoneyGifts}};
  purchase=buyScratchTicket(wallet,tree,request,{...options,settings:safeSettings});
  if(purchase.result.totalCoins!==0)throw Error('SCRATCH_GIFTS_BUDGET_FALLBACK_FAILED');
 }
 const next={...rawEdition,issued:issued+1,
  paidCoins:paid+purchase.result.totalCoins};
 if(next.paidCoins>next.maxTotalCoins)throw Error('SCRATCH_GIFTS_EDITION_BUDGET_EXCEEDED');
 // Receipt numbers never influence the authoritative winnings, just display.
 purchase.result.giftsEditionId=rawEdition.id;
 purchase.result.giftsEditionNumber=next.issued;
 return {purchase,edition:next};
}
