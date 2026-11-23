/**
 * A finite Schneeflocken-Bingo series: 500 real purchases share ONE maximum
 * coin-payout budget. The server issues each ticket at purchase, not in a
 * slow 500-ticket preview. Firestore's transaction makes this budget atomic.
 * No other DOG ticket kind is changed.
 */
import {buyScratchTicket,normalizedScratchWallet,remainingScratchEditionLights} from './christmas-scratch.js';
import {normalizeScratchSettings} from './christmas-scratch-settings.js';
import {createFixedEditionPlan,encodeFixedEditionPlan,decodeFixedEditionRows,
 remainingFixedEditionPlan} from './christmas-edition-plan.js';

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
  issued:0,maxTotalCoins,paidCoins:0,config:snow_collect,
  lightBudgetRemaining:remainingScratchEditionLights({issued:0,config:snow_collect}),
  budgetMode:'fixed',revision:1,
  prizePlan:encodeFixedEditionPlan(
    createFixedEditionPlan(maxTotalCoins,snow_collect,SNOW_EDITION_SIZE))};
}

export function snowEditionPublic(raw){
 if(!raw||raw.variantId!=='snow_collect')return null;
 const issued=Number.isInteger(raw.issued)?Math.max(0,Math.min(500,raw.issued)):0;
 const paidCoins=Number.isSafeInteger(raw.paidCoins)?Math.max(0,raw.paidCoins):0;
 const maxTotalCoins=Number.isSafeInteger(raw.maxTotalCoins)?raw.maxTotalCoins:0;
 const amounts=raw.config?.coinAmounts;
 const future=raw.budgetMode==='fixed'&&Array.isArray(raw.prizePlan)&&raw.prizePlan.length===500?
  raw.prizePlan.slice(issued):null;
 const payingTicketsRemaining=future?future.reduce((total,code)=>
  total+(decodeFixedEditionRows(code).length>0?1:0),0):null;
 const nonPayingTicketsRemaining=payingTicketsRemaining===null?null:
  SNOW_EDITION_SIZE-issued-payingTicketsRemaining;
 const remainingMaximum=raw.budgetMode==='fixed'&&Array.isArray(raw.prizePlan)&&Array.isArray(amounts)?
  raw.prizePlan.slice(issued).reduce((maximum,code)=>{
   const sum=decodeFixedEditionRows(code).reduce((total,row)=>
    total+amounts[row%3]*(row>=3?2:1),0);
   return Math.max(maximum,sum);
  },0):null;
 return {id:raw.id,size:SNOW_EDITION_SIZE,issued,remaining:SNOW_EDITION_SIZE-issued,
  maxTotalCoins,paidCoins,remainingCoins:Math.max(0,maxTotalCoins-paidCoins),
  maxTicketCoinsRemaining:remainingMaximum,
  payingTicketsRemaining,nonPayingTicketsRemaining,
  status:issued===SNOW_EDITION_SIZE?'sold_out':'active',
  budgetMode:raw.budgetMode==='fixed'?'fixed':'maximum',
  revision:Number.isInteger(raw.revision)?raw.revision:0,
  createdAt:raw.createdAt,updatedAt:raw.updatedAt??null,
  prizeCategory:raw.prizeCategory??1,config:raw.config};
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
 const lightBudgetRemaining=remainingScratchEditionLights(rawEdition);
 const ticketOptions={...options,settings,
  editionSpecial:{...options.editionSpecial,prizeCategory:rawEdition.prizeCategory??1},
  printControl:{...options.printControl,editionLights:{
   remainingBudget:lightBudgetRemaining,remainingTickets:500-issued
  }}};
 if(saved){
  const replay=buyScratchTicket(wallet,tree,request,{...ticketOptions});
  return {purchase:replay,edition:rawEdition};
 }
 if(issued>=SNOW_EDITION_SIZE)throw Error('SCRATCH_SNOW_EDITION_SOLD_OUT');
 const left=maxCoins-paid;
 // Fixed-budget editions reserve each visible money match at publication.
 // Already issued receipts keep their earlier immutable payouts.
 if(rawEdition.budgetMode==='fixed'){
  if(!remainingFixedEditionPlan(rawEdition))
   throw Error('SCRATCH_EDITION_FIXED_PLAN_MISSING');
  const plannedRows=decodeFixedEditionRows(rawEdition.prizePlan[issued]);
  const result=buyScratchTicket(wallet,tree,request,{...ticketOptions,
   printControl:{...ticketOptions.printControl,fixedEditionRows:plannedRows}});
  const actual=plannedRows.reduce((sum,code)=>sum+
    rawEdition.config.coinAmounts[code%3]*(code>=3?2:1),0);
  if(result.result.totalCoins!==actual)
   throw Error('SCRATCH_EDITION_FIXED_PLAN_MISMATCH');
  // A wallet is capped at 1 billion coins. Do not silently record a promised
  // fixed-edition payout if the player cannot actually receive all its money.
  const expectedBalance=normalizedScratchWallet(wallet).coins-result.result.price+actual;
  if(expectedBalance>1000000000||result.wallet.coins!==expectedBalance)
   throw Error('SCRATCH_EDITION_WALLET_LIMIT');
  const next={...rawEdition,issued:issued+1,paidCoins:paid+actual,
   lightBudgetRemaining:lightBudgetRemaining-result.result.totalLights,
   revision:(Number.isInteger(rawEdition.revision)?rawEdition.revision:0)+1};
  if(next.paidCoins>next.maxTotalCoins||
      (next.issued===SNOW_EDITION_SIZE&&next.paidCoins!==next.maxTotalCoins))
   throw Error('SCRATCH_EDITION_FIXED_BUDGET_MISMATCH');
  result.result.snowEditionId=rawEdition.id;
  result.result.snowEditionNumber=next.issued;
  return {purchase:result,edition:next};
 }
 let purchase=null;
 // When even the smallest money prize cannot fit, make one ordinary draw
 // (to preserve the chance of a free design), then use the safe zero-coin card.
 // Never regenerate 500 cards in a single user request.
 const minCoin=rawEdition.config?.coinAmounts?.[0]??1;
 const maxAttempts=left<minCoin?1:12;
 for(let i=0;i<maxAttempts;i++){
  const attempt=buyScratchTicket(wallet,tree,request,{...ticketOptions});
  if(attempt.result.totalCoins<=left){purchase=attempt;break}
 }
 if(!purchase){
  // A full-cost payout must not be issued when the communal money pool is
  // empty. The forced zero-money rule still allows genuine Christmas lights.
  const noMoneySnow={...settings.variants.snow_collect,
   weights:{none:1000,coins:0,unlock:0},extraCoinChance:0,doubleChancePer1000:0};
  const safeSettings={...settings,variants:{...settings.variants,snow_collect:noMoneySnow}};
  purchase=buyScratchTicket(wallet,tree,request,{...ticketOptions,settings:safeSettings});
  if(purchase.result.totalCoins!==0)throw Error('SCRATCH_SNOW_BUDGET_FALLBACK_FAILED');
 }
 const next={...rawEdition,issued:issued+1,
  paidCoins:paid+purchase.result.totalCoins,
  lightBudgetRemaining:lightBudgetRemaining-purchase.result.totalLights,
  revision:(Number.isInteger(rawEdition.revision)?rawEdition.revision:0)+1};
 if(next.paidCoins>next.maxTotalCoins)throw Error('SCRATCH_SNOW_EDITION_BUDGET_EXCEEDED');
 // Receipt numbers never influence the authoritative winnings, just display.
 purchase.result.snowEditionId=rawEdition.id;
 purchase.result.snowEditionNumber=next.issued;
 return {purchase,edition:next};
}
