/**
 * Four extra DOG Christmas scratch editions. A finite 500-ticket ledger is
 * coupled to the buyer's wallet in the same Firestore transaction.
 * The plan stores compact, verifiable winning symbol patterns, not balances
 * that the browser can alter. Existing historical receipts remain immutable.
 */
import {randomInt} from 'node:crypto';
import {buyScratchTicket,normalizedScratchWallet} from './christmas-scratch.js';
import {createFixedEditionPlan,encodeFixedEditionPlan,decodeFixedEditionRows,
 fixedEditionPlanTotal} from './christmas-edition-plan.js';
export const OTHER_EDITION_VARIANTS=Object.freeze(['elf','premium_27','number_one_20','dog_jackpot_9']);
export const OTHER_EDITION_COLLECTION='dog_christmas_other_editions_v1';
export const OTHER_EDITION_HISTORY='dog_christmas_other_editions_archive_v1';
export const OTHER_EDITION_SIZE=500;
export const OTHER_EDITION_MAX_COINS=1000000000000;
/**
 * One-time price correction for the Premium edition that was already live
 * when the user requested a 1,200-coin price on 22 Nov 2026, 12:11 CET.
 * It is deliberately NOT a new default for future Premium editions.
 * The current document is migrated with its next normal purchase/edit.
 */
const PREMIUM_CURRENT_PRICE_CUTOFF=Date.parse('2026-11-22T11:11:00Z');
const PREMIUM_CURRENT_PRICE=1200;
const MEDIUM_CURRENT_PRICE_CUTOFF=Date.parse('2026-11-22T11:15:42Z');
const LUCKY_CURRENT_PRICE_CUTOFF=Date.parse('2026-11-22T11:21:26Z');
const LUCKY_CURRENT_PRICE=600;
const needsCurrentPremiumReprice=raw=>
 raw?.variantId==='premium_27'&&raw.premiumPrice1200Applied!==true&&
 whole(raw.createdAt,1,PREMIUM_CURRENT_PRICE_CUTOFF-1)&&
 whole(raw.issued,0,OTHER_EDITION_SIZE-1);
// Correct variant: Glückszahl 1 is number_one_20, NOT the elf Wichtelpfad.
// Restrict to the edition running before the request, never future editions.
const needsCurrentLuckyReprice=raw=>
 raw?.variantId==='number_one_20'&&raw.luckyPrice600Applied!==true&&
 raw.config?.price===500&&
 whole(raw.createdAt,1,LUCKY_CURRENT_PRICE_CUTOFF-1)&&
 whole(raw.issued,0,OTHER_EDITION_SIZE-1);
// Undo the earlier mistaken 600-coin Wichtelpfad update, including an edition
// where the erroneous value was already saved during a normal purchase.
// Previously sold tickets always keep their original receipts.
const needsUndoMistakenElfReprice=raw=>
 raw?.variantId==='elf'&&raw.mediumPrice600Applied===true&&
 raw.mistakenMediumRepriceReverted!==true&&raw.config?.price===600&&
 whole(raw.createdAt,1,MEDIUM_CURRENT_PRICE_CUTOFF-1)&&
 whole(raw.issued,0,OTHER_EDITION_SIZE-1);
const effectiveCurrentEditionConfig=raw=>needsCurrentPremiumReprice(raw)?
 {...raw.config,price:PREMIUM_CURRENT_PRICE}:
 needsCurrentLuckyReprice(raw)?{...raw.config,price:LUCKY_CURRENT_PRICE}:
 needsUndoMistakenElfReprice(raw)?{...raw.config,price:500}:raw.config;

export const OTHER_EDITION_DEFAULT=Object.freeze({
 elf:Object.freeze({price:500,coinAmounts:[100,300,800],prizeCategory:2,
  maxPrizes:3,nonePer1000:200,giftPer1000:30,doubleChancePer1000:110,
  dogChancePer1000:350,goldChancePer1000:300}),
 premium_27:Object.freeze({price:1000,coinAmounts:[200,800,2000],prizeCategory:3,
  maxPrizes:3,nonePer1000:0,giftPer1000:40,doubleChancePer1000:0,
  dogChancePer1000:350,goldChancePer1000:300}),
 number_one_20:Object.freeze({price:500,coinAmounts:[100,300,800],prizeCategory:2,
  maxPrizes:3,nonePer1000:200,giftPer1000:30,doubleChancePer1000:0,
  dogChancePer1000:350,goldChancePer1000:300}),
 dog_jackpot_9:Object.freeze({price:1000,coinAmounts:[100,300,800],prizeCategory:3,
  maxPrizes:3,nonePer1000:650,giftPer1000:40,doubleChancePer1000:0,
  dogChancePer1000:350,goldChancePer1000:300})
});
const whole=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const randint=(draw,max)=>{const n=draw(max);if(!Number.isInteger(n)||n<0||n>=max)throw Error('SCRATCH_OTHER_EDITION_RANDOM_INVALID');return n};
const shuffle=(items,draw)=>{const a=[...items];for(let i=a.length-1;i>0;i--){const j=randint(draw,i+1);[a[i],a[j]]=[a[j],a[i]]}return a};
export function validateOtherEditionConfig(variant,raw){
 if(!OTHER_EDITION_VARIANTS.includes(variant)||!raw||typeof raw!=='object'||Array.isArray(raw))
  throw Error('SCRATCH_OTHER_EDITION_SETTINGS_INVALID');
 const amount=raw.coinAmounts;
 if(!Array.isArray(amount)||amount.length!==3||
   amount.some(x=>!whole(x,1,50000000))||
   !(amount[0]<amount[1]&&amount[1]<amount[2])||
   !whole(raw.price,0,1000000)||
   (raw.nonePer1000??0)+(raw.giftPer1000??0)>1000||
   !whole(raw.prizeCategory,1,3)||
   !whole(raw.maxPrizes,1,3)||
   !['nonePer1000','giftPer1000','doubleChancePer1000',
      'dogChancePer1000','goldChancePer1000'].every(k=>whole(raw[k],0,1000)))
  throw Error('SCRATCH_OTHER_EDITION_SETTINGS_INVALID');
 return {price:raw.price,coinAmounts:[...amount],prizeCategory:raw.prizeCategory,
  maxPrizes:raw.maxPrizes,nonePer1000:raw.nonePer1000,giftPer1000:raw.giftPer1000,
  doubleChancePer1000:raw.doubleChancePer1000,
  dogChancePer1000:raw.dogChancePer1000,goldChancePer1000:raw.goldChancePer1000};
}
const asClassicSettings=c=>({
 coinAmounts:[...c.coinAmounts],maxPrizes:c.maxPrizes,
 weights:{none:c.nonePer1000,coins:1000-c.nonePer1000,unlock:0},
 doubleChancePer1000:c.doubleChancePer1000,
 extraCoinChance:0,moneySymbolWeights:[334,333,333],giftSymbolWeights:[200,200,200,200,200],
 price:c.price
});
function solveThree(amounts,slots,budget){
 const [a,b,c]=amounts;
 const delta=budget-slots*a;
 if(delta<0||budget>slots*c)return null;
 for(let z=Math.min(slots,Math.floor(delta/(c-a)));z>=0;z--){
  const rem=delta-z*(c-a);
  if(rem%(b-a))continue;
  const y=rem/(b-a),x=slots-z-y;
  if(x>=0&&y>=0)return [x,y,z];
 }
 return null;
}
/** The legacy solver took the FIRST exact solution (maximum number of
 * suitcases). For premium guarantees use the most varied mathematically
 * possible composition instead. An already promised edition budget is
 * never changed: at very high budgets many high prizes remain inevitable.
 */
export function solvePremiumMoneyMix(amounts,slots,budget){
 if(!whole(slots,0,1000)||!whole(budget,0,OTHER_EDITION_MAX_COINS)||
  !Array.isArray(amounts)||amounts.length!==3)return null;
 const [a,b,c]=amounts;
 if(!whole(a,1,50000000)||!whole(b,a+1,50000000)||
  !whole(c,b+1,50000000))return null;
 const delta=budget-slots*a;
 if(delta<0||budget>slots*c)return null;
 let best=null,bestScore=-Infinity;
 for(let high=0;high<=slots;high++){
  const rem=delta-high*(c-a);
  if(rem<0||rem%(b-a))continue;
  const middle=rem/(b-a),low=slots-high-middle;
  if(low<0||middle<0)continue;
  const distribution=[low,middle,high];
  // Shannon entropy rewards the presence of ALL three symbols, rather
  // than choosing almost exclusively the highest denomination.
  const score=-distribution.reduce((sum,count)=>
   count?sum+(count/slots)*Math.log(count/slots):sum,0);
  if(score>bestScore+1e-12){bestScore=score;best=distribution}
 }
 return best;
}
/** Two guaranteed win rows per card, drawn from the planned exact totals.
 * Whenever another denomination remains, pair distinct symbols first;
 * shuffle the finished cards, not just groups of identical suitcases.
 */
function mixPremiumMoneyPairs(distribution,count,draw){
 const remaining=[...distribution];
 const pick=(exclude=-1)=>{
  const eligible=remaining.map((n,i)=>i).filter(i=>remaining[i]>0&&i!==exclude);
  const choices=eligible.length?eligible:remaining.map((n,i)=>i).filter(i=>n>0);
  const total=choices.reduce((sum,i)=>sum+remaining[i],0);
  if(total===0)throw Error('SCRATCH_OTHER_EDITION_MONEY_PLAN_INVALID');
  let roll=randint(draw,total);
  for(const i of choices){roll-=remaining[i];if(roll<0){remaining[i]--;return String(i)}}
  throw Error('SCRATCH_OTHER_EDITION_MONEY_PLAN_INVALID');
 };
 const pairs=[];
 for(let i=0;i<count;i++){
  const first=pick(),second=pick(Number(first));
  pairs.push(shuffle([first,second],draw).join(''));
 }
 if(remaining.some(Boolean))throw Error('SCRATCH_OTHER_EDITION_MONEY_PLAN_INVALID');
 return shuffle(pairs,draw);
}
function nearTarget(n,target,max){
 return Array.from({length:max+1},(_,i)=>i).sort((a,b)=>
  Math.abs(a-target)-Math.abs(b-target)||a-b);
}
function premiumPlan(budget,c,count,draw){
 if(count===0){if(budget)throw Error('SCRATCH_OTHER_EDITION_BUDGET_UNREACHABLE');return []}
 // New editions reserve exactly TWO real paid money rows per premium card.
 // Legacy one-character codes represent four rows and remain readable.
 const wanted=Math.round(count*c.goldChancePer1000/1000);
 let selected=null;
 for(const gold of nearTarget(count,wanted,count)){
  const distribution=solvePremiumMoneyMix(c.coinAmounts,2*count,budget-gold*1000);
  if(distribution){selected={gold,distribution};break}
 }
 if(!selected)throw Error('SCRATCH_OTHER_EDITION_BUDGET_UNREACHABLE');
 const pairs=mixPremiumMoneyPairs(selected.distribution,count,draw);
 const goldCount=selected.gold;
 const giftCount=Math.min(goldCount,Math.round(count*c.giftPer1000/1000));
 const indexes=shuffle(Array.from({length:count},(_,i)=>i),draw);
 const cards=pairs.map(pair=>'v6:'+pair);
 for(let i=0;i<goldCount;i++)cards[indexes[i]]+=i<giftCount?'g':'m';
 return shuffle(cards,draw);
}
function jackpotPlan(budget,c,count,draw){
 if(count===0){if(budget)throw Error('SCRATCH_OTHER_EDITION_BUDGET_UNREACHABLE');return []}
 const wanted=Math.round(count*c.dogChancePer1000/1000);
 let selected=null;
 for(const n of nearTarget(count,wanted,count)){
  if(n===0){if(budget===0){selected={n,gifts:0,distribution:[0,0,0]};break}continue}
  const gWanted=Math.round(n*c.giftPer1000/1000);
  // A jackpot always pays all eight visible slots; at most one gift unlock
  // is present. Its fallback is zero and never consumes the coin budget.
  for(const gifts of [...new Set([gWanted,0,n])]){
   const distribution=solveThree(c.coinAmounts,8*n-gifts,budget);
   if(distribution){selected={n,gifts,distribution};break}
  }
  if(selected)break;
 }
 if(!selected)throw Error('SCRATCH_OTHER_EDITION_BUDGET_UNREACHABLE');
 const {n,gifts,distribution}=selected;
 const symbols=shuffle(distribution.flatMap((k,i)=>Array(k).fill(String(i))),draw);
 let cursor=0;
 const cards=[];
 for(let i=0;i<n;i++){
  const glyphs=i<gifts?['g']:[];
  while(glyphs.length<8)glyphs.push(symbols[cursor++]);
  cards.push(shuffle(glyphs,draw).join(''));
 }
 while(cards.length<count)cards.push('');
 return shuffle(cards,draw);
}
export function createOtherEditionPlan(variant,budget,config,count=OTHER_EDITION_SIZE,draw=randomInt){
 const c=validateOtherEditionConfig(variant,config);
 if(!whole(count,0,500)||!whole(budget,0,OTHER_EDITION_MAX_COINS))
  throw Error('SCRATCH_OTHER_EDITION_INVALID_BUDGET');
 let plan;
 if(variant==='elf'||variant==='number_one_20'){
  const planner=asClassicSettings({...c,doubleChancePer1000:variant==='elf'?c.doubleChancePer1000:0});
  try{plan=encodeFixedEditionPlan(createFixedEditionPlan(budget,planner,count,draw))}
  catch(e){if(e.message.startsWith('SCRATCH_EDITION_'))throw Error('SCRATCH_OTHER_EDITION_BUDGET_UNREACHABLE');throw e}
 }else if(variant==='premium_27')plan=premiumPlan(budget,c,count,draw);
 else plan=jackpotPlan(budget,c,count,draw);
 if(plan.length!==count||otherPlanTotal(variant,plan,c)!==budget)
  throw Error('SCRATCH_OTHER_EDITION_BUDGET_UNREACHABLE');
 return plan;
}
export function otherTicketAmount(variant,code,c){
 if(typeof code!=='string')throw Error('SCRATCH_OTHER_EDITION_PLAN_INVALID');
 if(variant==='elf'||variant==='number_one_20'){
  const rows=decodeFixedEditionRows(code);
  if(variant==='number_one_20'&&rows.some(x=>x>=3))throw Error('SCRATCH_OTHER_EDITION_PLAN_INVALID');
  return rows.reduce((sum,row)=>sum+c.coinAmounts[row%3]*(row>=3?2:1),0);
 }
 if(variant==='premium_27'){
  if(/^v6:[012]{2}(?:[mg])?$/.test(code))
   return c.coinAmounts[Number(code[3])]+c.coinAmounts[Number(code[4])]+
    (code.length===6?1000:0);
  if(!/^[012](?:[mg])?$/.test(code))throw Error('SCRATCH_OTHER_EDITION_PLAN_INVALID');
  // Old, already published edition plans retain their four-row accounting.
  return c.coinAmounts[0]+c.coinAmounts[1]+c.coinAmounts[2]+
   c.coinAmounts[Number(code[0])]+(code.length===2?1000:0);
 }
 if(variant==='dog_jackpot_9'){
  if(code==='')return 0;
  if(!/^[012g]{8}$/.test(code)||[...code].filter(x=>x==='g').length>1)
   throw Error('SCRATCH_OTHER_EDITION_PLAN_INVALID');
  return [...code].reduce((sum,x)=>sum+(x==='g'?0:c.coinAmounts[Number(x)]),0);
 }
 throw Error('SCRATCH_OTHER_EDITION_PLAN_INVALID');
}
export const otherPlanTotal=(variant,plan,c)=>plan.reduce((sum,code)=>sum+otherTicketAmount(variant,code,c),0);
export function createOtherEdition({id,variant,createdAt,createdBy,maxTotalCoins,config,draw=randomInt}){
 if(!OTHER_EDITION_VARIANTS.includes(variant)||typeof id!=='string'||!id||
  typeof createdBy!=='string'||!createdBy||!whole(createdAt,1,Number.MAX_SAFE_INTEGER)||
  !whole(maxTotalCoins,0,OTHER_EDITION_MAX_COINS))
  throw Error('SCRATCH_OTHER_EDITION_INVALID_BUDGET');
 const c=validateOtherEditionConfig(variant,config);
 return {id,createdAt,createdBy,variantId:variant,size:OTHER_EDITION_SIZE,
  issued:0,paidCoins:0,maxTotalCoins,revision:1,budgetMode:'fixed',
  config:c,prizePlan:createOtherEditionPlan(variant,maxTotalCoins,c,500,draw),
  ...(variant==='premium_27'?{premiumPrizeMixApplied:true}:{})};
}
export function otherEditionPublic(raw){
 if(!raw||!OTHER_EDITION_VARIANTS.includes(raw.variantId))return null;
 const issued=whole(raw.issued,0,500)?raw.issued:0;
 const paid=whole(raw.paidCoins,0,OTHER_EDITION_MAX_COINS)?raw.paidCoins:0;
 const budget=whole(raw.maxTotalCoins,0,OTHER_EDITION_MAX_COINS)?raw.maxTotalCoins:0;
 const future=Array.isArray(raw.prizePlan)?raw.prizePlan.slice(issued):[];
 const remainingMaximum=future.reduce((max,code)=>Math.max(max,otherTicketAmount(raw.variantId,code,raw.config)),0);
 return {id:raw.id,variantId:raw.variantId,size:500,issued,remaining:500-issued,
  paidCoins:paid,maxTotalCoins:budget,remainingCoins:Math.max(0,budget-paid),
  maxTicketCoinsRemaining:Array.isArray(raw.prizePlan)?remainingMaximum:null,
  status:issued>=500?'sold_out':'active',revision:raw.revision??0,
  budgetMode:'fixed',createdAt:raw.createdAt,updatedAt:raw.updatedAt??null,
  config:effectiveCurrentEditionConfig(raw),
  payingTicketsRemaining:future.filter(code=>otherTicketAmount(raw.variantId,code,raw.config)>0).length,
  giftTicketsRemaining:future.filter(code=>raw.variantId==='premium_27'?code.endsWith('g'):
   raw.variantId==='dog_jackpot_9'?code.includes('g'):false).length};
}
export function editOtherEdition(raw,{config,maxTotalCoins,now=Date.now(),draw=randomInt}){
 if(!raw||!OTHER_EDITION_VARIANTS.includes(raw.variantId)||
  !whole(raw.issued,0,499)||!Array.isArray(raw.prizePlan)||raw.prizePlan.length!==500)
  throw Error('SCRATCH_OTHER_EDITION_MISSING');
 if(!whole(maxTotalCoins,0,OTHER_EDITION_MAX_COINS)||maxTotalCoins<raw.paidCoins)
  throw Error('SCRATCH_EDITION_FIXED_BUDGET_BELOW_PAID');
 const premiumReprice=needsCurrentPremiumReprice(raw);
 const luckyReprice=needsCurrentLuckyReprice(raw);
 const undoElfReprice=needsUndoMistakenElfReprice(raw);
 const c=validateOtherEditionConfig(raw.variantId,
  premiumReprice?{...config,price:PREMIUM_CURRENT_PRICE}:
  luckyReprice?{...config,price:LUCKY_CURRENT_PRICE}:
  undoElfReprice?{...config,price:500}:config);
 const future=createOtherEditionPlan(raw.variantId,maxTotalCoins-raw.paidCoins,c,500-raw.issued,draw);
 return {...raw,config:c,
  ...(premiumReprice?{premiumPrice1200Applied:true}:{}),
  ...(luckyReprice?{luckyPrice600Applied:true}:{}),
  ...(undoElfReprice?{mistakenMediumRepriceReverted:true}:{}),
  ...(raw.variantId==='premium_27'?{premiumPrizeMixApplied:true}:{}),maxTotalCoins,
  prizePlan:[...raw.prizePlan.slice(0,raw.issued),...future],
  revision:(raw.revision||0)+1,updatedAt:now};
}
export function issueOtherEditionTicket(wallet,tree,request,raw,settings,options={}){
 const variant=raw?.variantId;
 if(!OTHER_EDITION_VARIANTS.includes(variant)||request?.variantId!==variant||
  request?.tier!==(variant==='premium_27'||variant==='dog_jackpot_9'?'premium':'medium'))
  throw Error('SCRATCH_INVALID_VARIANT');
 if(!Array.isArray(raw.prizePlan)||raw.prizePlan.length!==500||
  !whole(raw.issued,0,500)||!whole(raw.paidCoins,0,raw.maxTotalCoins))
  throw Error('SCRATCH_OTHER_EDITION_PLAN_INVALID');
 const existing=wallet?.recent?.find(row=>row.commandId===request.commandId);
 if(existing)return {purchase:buyScratchTicket(wallet,tree,request,
  {...options,settings,editionPrice:raw.config.price}),edition:raw};
 if(raw.issued>=500)throw Error('SCRATCH_OTHER_EDITION_SOLD_OUT');
 // The Render purchase already reads and writes this edition atomically;
 // migrate the live price in that SAME transaction (no extra Firebase IO).
 const premiumReprice=needsCurrentPremiumReprice(raw);
 const luckyReprice=needsCurrentLuckyReprice(raw);
 const undoElfReprice=needsUndoMistakenElfReprice(raw);
 const base=premiumReprice?{...raw,config:{...raw.config,price:PREMIUM_CURRENT_PRICE},
  premiumPrice1200Applied:true,revision:(raw.revision||0)+1}:
  luckyReprice?{...raw,config:{...raw.config,price:LUCKY_CURRENT_PRICE},
   luckyPrice600Applied:true,revision:(raw.revision||0)+1}:
  undoElfReprice?{...raw,config:{...raw.config,price:500},
   mistakenMediumRepriceReverted:true,revision:(raw.revision||0)+1}:raw;
 // Existing active Premium editions may already have v6 two-row codes,
 // but the old planner clustered the same suitcase prizes together. Replan
 // ONLY their unsold cards once, atomically with the next purchase, retaining
 // the edition's exact remaining budget, price and all issued receipts.
 // No extra Firebase read, standalone migration write or background polling.
 let active=base;
 if(variant==='premium_27'&&
    (base.premiumPrizeMixApplied!==true||
     !String(base.prizePlan[base.issued]||'').startsWith('v6:'))){
  const future=createOtherEditionPlan(variant,
   base.maxTotalCoins-base.paidCoins,base.config,500-base.issued,
   options.draw||randomInt);
  active={...base,premiumPrizeMixApplied:true,
   prizePlan:[...base.prizePlan.slice(0,base.issued),...future],
   revision:(base.revision||0)+1};
 }
 const code=active.prizePlan[active.issued];
 const expected=otherTicketAmount(variant,code,active.config);
 const printControl=variant==='elf'?{fixedEditionRows:decodeFixedEditionRows(code)}:
  variant==='number_one_20'?{fixedNumberSymbols:decodeFixedEditionRows(code)}:
  variant==='premium_27'?{fixedPremiumCode:code}: {fixedDogSymbols:code};
 const purchase=buyScratchTicket(wallet,tree,request,{
  ...options,settings,editionPrice:active.config.price,
  editionSpecial:{prizeCategory:active.config.prizeCategory,
   other:{variantId:variant,config:active.config},
   numberOne20:{price:active.config.price,coinAmounts:[...active.config.coinAmounts],
    symbolWeights:[334,333,333,0],hitPer1000:100,giftFallbackCoins:0},
   dogJackpot:{coinAmounts:[...raw.config.coinAmounts],
    symbolWeights:[334,333,333,0],dogChancePer1000:raw.config.dogChancePer1000,
    giftFallbackCoins:0}},
  printControl});
 if(purchase.result.totalCoins!==expected)throw Error('SCRATCH_OTHER_EDITION_PAYOUT_MISMATCH');
 const expectedBalance=normalizedScratchWallet(wallet).coins-purchase.result.price+expected;
 if(expectedBalance>1000000000||purchase.wallet.coins!==expectedBalance)
  throw Error('SCRATCH_EDITION_WALLET_LIMIT');
 const next={...active,issued:active.issued+1,paidCoins:active.paidCoins+expected,
  revision:(active.revision||0)+1};
 if(next.paidCoins>raw.maxTotalCoins||(next.issued===500&&next.paidCoins!==raw.maxTotalCoins))
  throw Error('SCRATCH_OTHER_EDITION_BUDGET_MISMATCH');
 purchase.result.otherEditionId=raw.id;
 purchase.result.otherEditionNumber=next.issued;
 purchase.result.prizeCategory=raw.config.prizeCategory;
 return {purchase,edition:next};
}
