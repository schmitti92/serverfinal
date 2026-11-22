import test from 'node:test';
import assert from 'node:assert/strict';
import {
 OTHER_EDITION_DEFAULT,createOtherEdition,createOtherEditionPlan,
 issueOtherEditionTicket,otherPlanTotal,otherTicketAmount,solvePremiumMoneyMix
} from '../dog/christmas-other-editions.js';
import {verifyPremium27} from '../dog/christmas-premium27.js';

const variant='premium_27',config=OTHER_EDITION_DEFAULT.premium_27;
function seeded(seed=821){
 return max=>{
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  return Math.floor(seed/4294967296*max);
 };
}
const ids=plan=>plan.map(code=>code.slice(3,5)).flatMap(v=>[...v]);
const count=(arr,id)=>arr.filter(x=>x===id).length;

test('fixed-budget Premium keeps exactly two actual money wins per ticket, including small and medium values',()=>{
 const budget=2000000,plan=createOtherEditionPlan(variant,budget,config,500,seeded(12345));
 assert.equal(plan.length,500);
 assert.equal(otherPlanTotal(variant,plan,config),budget);
 assert.ok(plan.every(code=>/^v6:[012]{2}(?:[mg])?$/.test(code)));
 const symbols=ids(plan);
 assert.equal(symbols.length,1000);
 assert.ok(count(symbols,'0')>0,'200-coin payouts must be reachable in a fixed budget');
 assert.ok(count(symbols,'1')>0,'800-coin payouts must be reachable in a fixed budget');
 assert.ok(count(symbols,'2')>0,'2,000-coin payouts must stay reachable');
 const mixed=plan.filter(code=>code[3]!==code[4]).length;
 assert.ok(mixed>=count(symbols,'0')+count(symbols,'1')-1,
  'spread scarce small and medium prizes across different tickets');
 assert.ok(plan.some(code=>code.includes('0'))&&plan.some(code=>code.includes('1')));
 assert.ok(plan.some(code=>code[3]==='2'&&code[4]==='2'));
 assert.ok(plan.some(code=>code[3]!=='2'||code[4]!=='2'));
 const firstSmall=plan.findIndex(code=>code[3]==='0'||code[4]==='0');
 const laterSmall=plan.findLastIndex(code=>code[3]==='0'||code[4]==='0');
 assert.ok(laterSmall>firstSmall,'small amounts are shuffled through the print run');
});

test('premium mix explores exact solutions rather than always maximizing suitcase count',()=>{
 const slots=1000,budget=1850000;
 const result=solvePremiumMoneyMix(config.coinAmounts,slots,budget);
 assert.equal(result.reduce((sum,n)=>sum+n,0),slots);
 assert.equal(result.reduce((sum,n,i)=>sum+n*config.coinAmounts[i],0),budget);
 assert.ok(result[0]>0,'small coins are represented');
 assert.ok(result[1]>0,'medium bills are represented');
 assert.ok(result[2]>0,'suitcases still pay their high amounts');
 const highestOnly=solvePremiumMoneyMix(config.coinAmounts,1000,2000000);
 assert.deepEqual(highestOnly,[0,0,1000],
  'an impossible low-denomination outcome must not break the budget promise');
});

test('already running v6 Premium series is remixed ON NEXT PURCHASE, preserving issued receipts',()=>{
 const budget=2000000;
 const published=createOtherEdition({
  id:'published-active-premium',createdAt:Date.parse('2026-11-20T00:00:00Z'),
  createdBy:'admin',variant,maxTotalCoins:budget,config,
  draw:seeded(98765)
 });
 const historicalCode=published.prizePlan[0],paidCoins=otherTicketAmount(variant,historicalCode,config);
 const legacyV6={
  ...published,issued:1,paidCoins,revision:5,
  premiumPrizeMixApplied:undefined,
  prizePlan:[
   historicalCode,
   ...Array.from({length:499},()=> 'v6:22') // outdated plan, only the unsold slice must be regenerated
  ]
 };
 // A test fixture needs a valid exact remaining budget for re-planning,
 // but the old plan itself may be badly clustered (this is the actual bug).
 const bought=issueOtherEditionTicket({coins:10000},null,
  {tier:'premium',variantId:variant,commandId:'premium-mixed-existing-run'},
  legacyV6,null,{draw:seeded(4567),now:()=>80000});
 assert.equal(bought.edition.premiumPrizeMixApplied,true);
 assert.equal(bought.edition.prizePlan[0],historicalCode,
  'the already paid ticket never changes');
 assert.equal(bought.edition.config.price,1200,'live current price remains 1,200');
 assert.equal(bought.edition.issued,2);
 assert.ok(verifyPremium27(bought.purchase.result.board));
 const paidRows=bought.purchase.result.board.wins.filter(x=>x.rule==='row-3'&&x.prize?.type==='coins');
 assert.equal(paidRows.length,2);
 assert.ok(paidRows.every(x=>['🪙','💵','💼'].includes(x.symbol)));
 assert.equal(otherPlanTotal(variant,bought.edition.prizePlan.slice(2),config),
  budget-bought.edition.paidCoins);
 const observed=ids(bought.edition.prizePlan.slice(1));
 assert.ok(observed.includes('0')&&observed.includes('1')&&observed.includes('2'),
  'unsold current-edition tickets now include all three denominations');
 const retry=issueOtherEditionTicket(bought.purchase.wallet,null,
  {tier:'premium',variantId:variant,commandId:'premium-mixed-existing-run'},
  bought.edition,null,{draw:()=>{throw Error('REPLAY_MUST_NOT_REDRAW_PREMIUM')},now:()=>80001});
 assert.equal(retry.purchase.unchanged,true);
 assert.equal(retry.edition.issued,2);
});

test('the premium edition retains the full 500-ticket settlement budget',()=>{
 const plan=createOtherEditionPlan(variant,2000000,config,500,seeded(9011));
 assert.equal(plan.length,500);
 assert.ok(plan.every(code=>otherTicketAmount(variant,code,config)>=400),
  'each card has at least two minimum 200-coin rows');
 assert.equal(otherPlanTotal(variant,plan,config),2000000);
});
