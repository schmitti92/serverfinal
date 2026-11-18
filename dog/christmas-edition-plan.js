/**
 * Exact payout planning for finite DOG scratch editions.
 *
 * A plan reserves 500 immutable, server-generated combinations of visible
 * money triples.  Each code 0–2 means one matching coin symbol; codes 3–5
 * mean that same matching symbol with an authentic x2 overlay.
 * This is a list of WIN TYPES, not a pre-generated scratch card or receipt.
 *
 * Every valid fixed edition is payable for exactly its budget IF all its
 * tickets are issued. Cosmetics and light bonuses are independent.
 */
import {randomInt} from 'node:crypto';

export const FIXED_EDITION_MAX_BUDGET=1000000000000;
export const fixedEditionPlanTotal=(plan,config)=>
 (Array.isArray(plan)?plan:[]).reduce((sum,rows)=>
  sum+(Array.isArray(rows)?rows:[]).reduce((v,code)=>
    v+config.coinAmounts[code%3]*(code>=3?2:1),0),0);

export function createFixedEditionPlan(budget,config,count=500,draw=randomInt){
 if(!Number.isSafeInteger(budget)||budget<0||budget>FIXED_EDITION_MAX_BUDGET||
    !Number.isInteger(count)||count<0||count>500)
  throw Error('SCRATCH_EDITION_FIXED_BUDGET_INVALID');
 const amounts=config?.coinAmounts,cap=Math.min(3,config?.maxPrizes??3);
 if(!Array.isArray(amounts)||amounts.length!==3||
    amounts.some((v,i)=>!Number.isSafeInteger(v)||v<1||(i>0&&v<=amounts[i-1]))||
    !Number.isInteger(cap)||cap<1)
  throw Error('SCRATCH_EDITION_FIXED_SETTINGS_INVALID');
 if(count===0){
  if(budget!==0)throw Error('SCRATCH_EDITION_FIXED_BUDGET_UNREACHABLE');
  return [];
 }
 if(budget===0)return Array.from({length:count},()=>[]);
 if(config?.weights?.coins===0)
  throw Error('SCRATCH_EDITION_FIXED_BUDGET_UNREACHABLE');
 // Each ticket can contain only one visible triple per coin symbol. A coin
 // symbol's x2 seal doubles the corresponding true visible money prize.
 const perTicketMax=[...amounts].reverse().slice(0,cap).reduce((x,y)=>x+y,0)*2;
 if(budget>perTicketMax*count)
  throw Error('SCRATCH_EDITION_FIXED_BUDGET_UNREACHABLE');
 const [a,b,c]=amounts;
 let best=null;
 const desired=Math.round(count*(config?.weights?.coins??689)/1000);
 // Solve an exact three-denomination combination. Start with basic triples;
 // converting pairs of identical wins into x2 changes no total payout.
 for(let z=Math.min(count,Math.floor(budget/c));z>=0;z--){
  const left=budget-z*c;
  for(let y=Math.min(count,Math.floor(left/b));y>=0;y--){
   const remainder=left-y*b;
   if(remainder%a)continue;
   const x=remainder/a;
   if(x>count)continue;
   const units=x+y+z;
   if(units>count*cap)continue;
   // Each ticket may show one triple for each symbol, and no more than cap.
   const required=Math.max(x,y,z,Math.ceil(units/cap));
   if(required>count)continue;
   const seats=Math.max(required,Math.min(count,desired));
   const score=(seats-desired)*100000+Math.abs(units-seats*1.7)*10+
    Math.abs(x-y)+Math.abs(y-z);
   if(!best||score<best.score)best={counts:[x,y,z],seats,score};
  }
 }
 if(!best)throw Error('SCRATCH_EDITION_FIXED_BUDGET_UNREACHABLE');
 const plan=Array.from({length:count},()=>[]);
 const slots=Array.from({length:count},(_,i)=>i);
 // Fisher-Yates with server CSPRNG; no browser-side influence on prize plan.
 for(let i=slots.length-1;i>0;i--){
  const j=draw(i+1);
  [slots[i],slots[j]]=[slots[j],slots[i]];
 }
 const candidates=slots.slice(0,best.seats);
 const doublePermille=Math.min(1000,Math.max(0,config.doubleChancePer1000??0));
 for(let symbol=0;symbol<3;symbol++){
  const units=best.counts[symbol];
  const doubles=Math.min(Math.floor(units/2),
   Math.round(units*doublePermille/(1000+doublePermille)));
  const codes=[...Array(units-2*doubles).fill(symbol),
   ...Array(doubles).fill(symbol+3)];
  // A randomized tie break spreads wins while respecting card capacities.
  const ordered=candidates.map(id=>({id,rank:draw(1000000)}))
   .sort((p,q)=>plan[p.id].length-plan[q.id].length||p.rank-q.rank);
  const available=ordered.filter(p=>plan[p.id].length<cap);
  if(available.length<codes.length)throw Error('SCRATCH_EDITION_FIXED_BUDGET_UNREACHABLE');
  for(let i=0;i<codes.length;i++)plan[available[i].id].push(codes[i]);
 }
 if(fixedEditionPlanTotal(plan,config)!==budget)
  throw Error('SCRATCH_EDITION_FIXED_BUDGET_UNREACHABLE');
 return plan;
}
export function remainingFixedEditionPlan(raw){
 return Array.isArray(raw?.prizePlan)&&raw.prizePlan.length===500&&
   raw.prizePlan.every(rows=>Array.isArray(rows)&&rows.every(code=>Number.isInteger(code)&&code>=0&&code<=5));
}
export function editFixedEdition(raw,{settings,maxTotalCoins,now=Date.now()}){
 if(!raw||raw.variantId!=='gifts'&&raw.variantId!=='snow_collect')
  throw Error('SCRATCH_EDITION_MISSING');
 if(!Number.isSafeInteger(maxTotalCoins)||maxTotalCoins<0||
    maxTotalCoins>FIXED_EDITION_MAX_BUDGET)
  throw Error('SCRATCH_EDITION_FIXED_BUDGET_INVALID');
 const paid=raw.paidCoins,issued=raw.issued;
 if(!Number.isInteger(issued)||issued<0||issued>500||
    !Number.isSafeInteger(paid)||paid<0||paid>maxTotalCoins)
  throw Error('SCRATCH_EDITION_FIXED_BUDGET_BELOW_PAID');
 const remaining=500-issued;
 const config=settings.variants[raw.variantId];
 const plan=createFixedEditionPlan(maxTotalCoins-paid,config,remaining);
 const prefix=remainingFixedEditionPlan(raw)?raw.prizePlan.slice(0,issued):
  Array.from({length:issued},()=>[]);
 return {...raw,config,maxTotalCoins,prizePlan:[...prefix,...plan],
  budgetMode:'fixed',revision:(Number.isInteger(raw.revision)?raw.revision:0)+1,
  updatedAt:now};
}
