/**
 * Finite, shared 500-ticket Tic-Tac-Toe edition. Every payout is reserved
 * before publication. The original 3x3 rules, prize symbols and multipliers
 * are verified by the server; the browser never supplies a winning ticket.
 * One Firestore transaction must commit both the wallet and edition ledger.
 */
import {randomInt} from 'node:crypto';
import {buyScratchTicket,normalizedScratchWallet} from './christmas-scratch.js';
import {validateTicDuelEditionSettings} from './christmas-tictactoe-duel.js';

export const TIC_EDITION_COLLECTION='dog_christmas_tic_editions_v1';
export const TIC_EDITION_CURRENT='current';
export const TIC_EDITION_HISTORY_COLLECTION='dog_christmas_tic_editions_archive_v1';
export const TIC_EDITION_SIZE=500;
export const TIC_EDITION_MAX_COINS=1000000000000;
export const TIC_EDITION_DEFAULT=Object.freeze({
 price:500,coinAmounts:Object.freeze([200,450,800]),
 symbolWeights:Object.freeze([700,250,40,10]),
 maxMultiplier:5,giftFallbackCoins:0,targetNonePer1000:200,prizeCategory:2
});
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const rand=(fn,max)=>{
 const n=fn(max);
 if(!Number.isInteger(n)||n<0||n>=max)throw Error('SCRATCH_TIC_RANDOM_INVALID');
 return n;
};
const gcd=(a,b)=>b?gcd(b,a%b):a;
export function validateTicEditionConfig(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
  !integer(raw.price,0,1000000)||!integer(raw.targetNonePer1000,0,1000))
  throw Error('SCRATCH_TIC_EDITION_SETTINGS_INVALID');
 // Older editions created before the category selector keep their
 // intended medium-tier unlock pool. New edits must choose 1, 2, or 3.
 const prizeCategory=raw.prizeCategory??2;
 if(!Number.isInteger(prizeCategory)||prizeCategory<1||prizeCategory>3)
  throw Error('SCRATCH_TIC_EDITION_PRIZE_CATEGORY_INVALID');
 let setting;
 try{setting=validateTicDuelEditionSettings({
  coinAmounts:raw.coinAmounts,symbolWeights:raw.symbolWeights,
  maxMultiplier:raw.maxMultiplier,giftFallbackCoins:0
 })}catch{throw Error('SCRATCH_TIC_EDITION_SETTINGS_INVALID')}
 return {...setting,price:raw.price,targetNonePer1000:raw.targetNonePer1000,prizeCategory};
}
/**
 * Solve the exact sum of up to 500 single-symbol wins with 1x..5x factors.
 * Each planned character A..O means one of three coin symbols and its factor.
 * G1..G5 = a genuine gift prize, N1..N5 = no matching line.
 * The solver searches nearby money-ticket counts and rejects mathematically
 * unattainable budgets, rather than silently paying less than published.
 */
export function createTicFixedPlan(budget,config,count=TIC_EDITION_SIZE,draw=randomInt){
 const c=validateTicEditionConfig(config);
 if(!integer(count,0,TIC_EDITION_SIZE)||!integer(budget,0,TIC_EDITION_MAX_COINS))
  throw Error('SCRATCH_TIC_EDITION_INVALID_BUDGET');
 if(count===0){
  if(budget)throw Error('SCRATCH_TIC_EDITION_BUDGET_UNREACHABLE');
  return [];
 }
 const denoms=[];
 for(let sym=0;sym<3;sym++)for(let m=1;m<=c.maxMultiplier;m++)
  denoms.push({value:c.coinAmounts[sym]*m,code:String.fromCharCode(65+sym*5+m-1),symbol:sym});
 denoms.sort((a,b)=>b.value-a.value||a.symbol-b.symbol);
 const min=denoms.at(-1).value,max=denoms[0].value;
 if(budget>count*max)throw Error('SCRATCH_TIC_EDITION_BUDGET_UNREACHABLE');
 const g=denoms.reduce((a,v)=>gcd(a,v.value),0);
 if(budget%g)throw Error('SCRATCH_TIC_EDITION_BUDGET_UNREACHABLE');
 const winMin=budget===0?0:Math.ceil(budget/max);
 const winMax=Math.min(count,Math.floor(budget/min));
 const preferred=Math.min(winMax,Math.max(winMin,
  Math.round(count*(1000-c.targetNonePer1000-c.symbolWeights[3])/1000)));
 const suffixGcd=denoms.map((_,i)=>denoms.slice(i).reduce((g,d)=>gcd(g,d.value),0));
 const memo=new Set();
 let visited=0;
 const solve=(idx,remaining,slots)=>{
  if(remaining===0&&slots===0)return [];
  if(idx===denoms.length||slots<=0||remaining<0||++visited>120000)return null;
  const value=denoms[idx].value,lowest=min,highest=value;
  if(remaining<slots*lowest||remaining>slots*highest||
    remaining%suffixGcd[idx])return null;
  if(idx===denoms.length-1)
   return remaining===slots*value?Array(slots).fill(denoms[idx].code):null;
  const key=idx+'|'+remaining+'|'+slots;
  if(memo.has(key))return null;
  const nextHigh=denoms[idx+1].value;
  const low=Math.max(0,nextHigh===value?0:
   Math.ceil((remaining-slots*nextHigh)/(value-nextHigh)));
  const high=Math.min(slots,Math.floor(remaining/value),
   value===lowest?slots:Math.floor((remaining-slots*lowest)/(value-lowest)));
  if(high<low){memo.add(key);return null}
  const weightSum=Math.max(1,c.symbolWeights[0]+c.symbolWeights[1]+c.symbolWeights[2]);
  const desired=Math.max(low,Math.min(high,
   Math.round(slots*c.symbolWeights[denoms[idx].symbol]/weightSum/
     denoms.filter(d=>d.symbol===denoms[idx].symbol).length)));
  const trial=[];
  for(let k=low;k<=high;k++)trial.push(k);
  trial.sort((a,b)=>Math.abs(a-desired)-Math.abs(b-desired)||b-a);
  for(const n of trial){
   const tail=solve(idx+1,remaining-n*value,slots-n);
   if(tail)return [...Array(n).fill(denoms[idx].code),...tail];
   if(visited>120000)break;
  }
  memo.add(key);return null;
 };
 let prizeCodes=null;
 // Favor the requested none-rate, but always preserve the exact coin budget.
 for(let delta=0;delta<=winMax-winMin;delta++){
  for(const target of delta===0?[preferred]:[preferred-delta,preferred+delta]){
   if(target<winMin||target>winMax)continue;
   memo.clear();visited=0;
   const found=solve(0,budget,target);
   if(found){prizeCodes=found;break}
  }
  if(prizeCodes)break;
 }
 if(!prizeCodes)throw Error('SCRATCH_TIC_EDITION_BUDGET_UNREACHABLE');
 const slots=count-prizeCodes.length;
 const gifts=Math.min(slots,Math.round(count*c.symbolWeights[3]/1000));
 const plan=[...prizeCodes,
  ...Array.from({length:gifts},()=> 'G'+(rand(draw,c.maxMultiplier)+1)),
  ...Array.from({length:slots-gifts},()=> 'N'+(rand(draw,c.maxMultiplier)+1))];
 for(let i=plan.length-1;i>0;i--){
  const j=rand(draw,i+1);[plan[i],plan[j]]=[plan[j],plan[i]];
 }
 if(plan.length!==count||ticPlanTotal(plan,c)!==budget)
  throw Error('SCRATCH_TIC_EDITION_BUDGET_UNREACHABLE');
 return plan;
}
export function ticTicketAmount(code,config){
 if(typeof code!=='string')throw Error('SCRATCH_TIC_EDITION_PLAN_INVALID');
 if(/^[A-O]$/.test(code)){
  const ix=code.charCodeAt(0)-65,category=Math.floor(ix/5),multiplier=ix%5+1;
  if(multiplier>config.maxMultiplier)throw Error('SCRATCH_TIC_EDITION_PLAN_INVALID');
  return config.coinAmounts[category]*multiplier;
 }
 if(/^[GN][1-5]$/.test(code)&&Number(code[1])<=config.maxMultiplier)return 0;
 throw Error('SCRATCH_TIC_EDITION_PLAN_INVALID');
}
export const ticPlanTotal=(plan,config)=>
 plan.reduce((total,code)=>total+ticTicketAmount(code,config),0);
export function createTicEdition({id,createdAt,createdBy,maxTotalCoins,config,draw=randomInt}){
 if(typeof id!=='string'||!id||!integer(createdAt,1,Number.MAX_SAFE_INTEGER)||
  typeof createdBy!=='string'||!createdBy||!integer(maxTotalCoins,0,TIC_EDITION_MAX_COINS))
  throw Error('SCRATCH_TIC_EDITION_INVALID_BUDGET');
 const normalized=validateTicEditionConfig(config);
 return {id,createdAt,createdBy,variantId:'tic_tac_toe',
  size:TIC_EDITION_SIZE,issued:0,paidCoins:0,maxTotalCoins,
  config:normalized,revision:1,budgetMode:'fixed',
  prizePlan:createTicFixedPlan(maxTotalCoins,normalized,TIC_EDITION_SIZE,draw)};
}
export function ticEditionPublic(raw){
 if(!raw||raw.variantId!=='tic_tac_toe')return null;
 const size=TIC_EDITION_SIZE;
 const issued=integer(raw.issued,0,size)?raw.issued:0;
 const paidCoins=integer(raw.paidCoins,0,TIC_EDITION_MAX_COINS)?raw.paidCoins:0;
 const maxTotalCoins=integer(raw.maxTotalCoins,0,TIC_EDITION_MAX_COINS)?raw.maxTotalCoins:0;
 const future=Array.isArray(raw.prizePlan)?raw.prizePlan.slice(issued):[];
 const remainingMoney=future.filter(code=>/^[A-O]$/.test(code)).length;
 return {id:raw.id,size,issued,remaining:size-issued,paidCoins,maxTotalCoins,
  remainingCoins:Math.max(0,maxTotalCoins-paidCoins),
  status:issued>=size?'sold_out':'active',revision:raw.revision??0,
  budgetMode:'fixed',createdAt:raw.createdAt,updatedAt:raw.updatedAt??null,
  config:raw.config,moneyTicketsRemaining:remainingMoney,
  giftTicketsRemaining:future.filter(code=>/^G[1-5]$/.test(code)).length,
  losingTicketsRemaining:future.filter(code=>/^N[1-5]$/.test(code)).length};
}
export function editTicEdition(raw,{config,maxTotalCoins,now=Date.now(),draw=randomInt}){
 if(!raw||raw.variantId!=='tic_tac_toe'||!integer(raw.issued,0,500)||
  raw.issued>=500)throw Error('SCRATCH_TIC_EDITION_ALREADY_COMPLETE');
 if(!integer(maxTotalCoins,0,TIC_EDITION_MAX_COINS)||maxTotalCoins<raw.paidCoins)
  throw Error('SCRATCH_EDITION_FIXED_BUDGET_BELOW_PAID');
 const c=validateTicEditionConfig(config),prefix=raw.prizePlan?.slice(0,raw.issued);
 if(!Array.isArray(prefix)||prefix.length!==raw.issued)
  throw Error('SCRATCH_TIC_EDITION_PLAN_INVALID');
 const rest=createTicFixedPlan(maxTotalCoins-raw.paidCoins,c,500-raw.issued,draw);
 return {...raw,config:c,maxTotalCoins,prizePlan:[...prefix,...rest],
  revision:(raw.revision||0)+1,updatedAt:now};
}
export function issueTicEditionTicket(wallet,tree,request,raw,liveSettings,options={}){
 if(!raw||raw.variantId!=='tic_tac_toe')throw Error('SCRATCH_TIC_EDITION_MISSING');
 if(request?.variantId!=='tic_tac_toe'||request.tier!=='medium')
  throw Error('SCRATCH_INVALID_VARIANT');
 const issued=raw.issued,paid=raw.paidCoins,max=raw.maxTotalCoins;
 if(!integer(issued,0,500)||!integer(paid,0,max)||!integer(max,0,TIC_EDITION_MAX_COINS)||
  !Array.isArray(raw.prizePlan)||raw.prizePlan.length!==500)
  throw Error('SCRATCH_TIC_EDITION_PLAN_INVALID');
 const saved=wallet?.recent?.find(row=>row.commandId===request.commandId);
 const buyOptions={...options,settings:liveSettings,editionPrice:raw.config.price};
 if(saved){
  return {purchase:buyScratchTicket(wallet,tree,request,buyOptions),edition:raw};
 }
 if(issued>=500)throw Error('SCRATCH_TIC_EDITION_SOLD_OUT');
 const planned=raw.prizePlan[issued],expected=ticTicketAmount(planned,raw.config);
 const purchase=buyScratchTicket(wallet,tree,request,{...buyOptions,
  editionSpecial:{...options.editionSpecial,ticTacToe:raw.config},
  printControl:{...options.printControl,ticFixedCode:planned}});
 if(purchase.result.totalCoins!==expected)
  throw Error('SCRATCH_TIC_EDITION_PAYOUT_MISMATCH');
 const expectedBalance=normalizedScratchWallet(wallet).coins-purchase.result.price+expected;
 if(expectedBalance>1000000000||purchase.wallet.coins!==expectedBalance)
  throw Error('SCRATCH_EDITION_WALLET_LIMIT');
 const next={...raw,issued:issued+1,paidCoins:paid+expected,revision:(raw.revision||0)+1};
 if(next.paidCoins>max||(next.issued===500&&next.paidCoins!==max))
  throw Error('SCRATCH_TIC_EDITION_BUDGET_MISMATCH');
 purchase.result.ticEditionId=raw.id;
 purchase.result.ticEditionNumber=next.issued;
 return {purchase,edition:next};
}
