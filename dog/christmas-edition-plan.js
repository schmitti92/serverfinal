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
 // One real winning triple per coin symbol per ticket. x2 is a visual
 // seal on that SAME triple, so it permits two units of the symbol's prize.
 const [a,b,c]=amounts;
 const p=Math.min(1000,Math.max(0,config.doubleChancePer1000??0));
 const allowDouble=p>0;
 const maxUnits=count*(allowDouble?2:1);
 const perTicketMax=[...amounts].reverse().slice(0,cap)
  .reduce((sum,value)=>sum+value,0)*(allowDouble?2:1);
 if(budget>perTicketMax*count)
  throw Error('SCRATCH_EDITION_FIXED_BUDGET_UNREACHABLE');
 const desired=Math.round(count*(config?.weights?.coins??689)/1000);
 let best=null;
 // Solve exact integer denominations (max 1 million candidates, bounded by
 // the 500-ticket run), including denominations that MUST be x2 to fit.
 for(let z=Math.min(maxUnits,Math.floor(budget/c));z>=0;z--){
  const rest=budget-z*c;
  for(let y=Math.min(maxUnits,Math.floor(rest/b));y>=0;y--){
   const rem=rest-y*b;
   if(rem%a)continue;
   const x=rem/a;
   if(x>maxUnits)continue;
   const units=[x,y,z];
   const doubleLimits=units.map(u=>allowDouble?Math.floor(u/2):0);
   const doubles=units.map((u,i)=>Math.max(allowDouble?Math.max(0,u-count):0,
    Math.min(doubleLimits[i],Math.round(u*p/(1000+p)))));
   const codeCount=()=>units.map((u,i)=>u-doubles[i]);
   let codes=codeCount(),slotsNeeded=codes.reduce((sum,n)=>sum+n,0);
   // If required, add genuine visible x2 seals until all coin symbols fit
   // into no more than 500 cards with the user's prize-cap.
   while(slotsNeeded>count*cap){
    const candidates=[0,1,2].filter(i=>doubles[i]<doubleLimits[i]);
    if(!candidates.length)break;
    const chosen=candidates.sort((i,j)=>codes[j]-codes[i])[0];
    doubles[chosen]++;
    codes[chosen]--;
    slotsNeeded--;
   }
   const required=Math.max(...codes,Math.ceil(slotsNeeded/cap));
   if(required>count||slotsNeeded>count*cap)continue;
   const seats=Math.max(required,Math.min(count,desired,slotsNeeded));
   const deviation=doubles.reduce((sum,d,i)=>
    sum+Math.abs(d*(1000+p)-units[i]*p),0);
   const score=Math.abs(seats-desired)*1000000+
    deviation*10+Math.abs(x-y)+Math.abs(y-z);
   if(!best||score<best.score)best={counts:units,doubles,seats,score};
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
 for(let symbol=0;symbol<3;symbol++){
  const units=best.counts[symbol];
  const doubles=best.doubles[symbol];
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
// Firestore prohibits nested arrays. Store each card's plan as a 0–3 character
// string of valid money codes; the array itself is a flat array of 500 strings.
export function encodeFixedEditionPlan(plan){
 if(!Array.isArray(plan))throw Error('SCRATCH_EDITION_FIXED_PLAN_MISSING');
 return plan.map(rows=>{
  if(!Array.isArray(rows)||rows.length>3||
     rows.some(code=>!Number.isInteger(code)||code<0||code>5)||
     new Set(rows.map(code=>code%3)).size!==rows.length)
   throw Error('SCRATCH_EDITION_FIXED_PLAN_MISSING');
  return rows.join('');
 });
}
export function decodeFixedEditionRows(value){
 if(typeof value!=='string'||! /^[0-5]{0,3}$/.test(value))
  throw Error('SCRATCH_EDITION_FIXED_PLAN_MISSING');
 const codes=value.split('').map(Number);
 if(new Set(codes.map(v=>v%3)).size!==codes.length)
  throw Error('SCRATCH_EDITION_FIXED_PLAN_MISSING');
 return codes;
}
export function remainingFixedEditionPlan(raw){
 return Array.isArray(raw?.prizePlan)&&raw.prizePlan.length===500&&
   raw.prizePlan.every(value=>{
    try{decodeFixedEditionRows(value);return true}catch{return false}
   });
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
  Array.from({length:issued},()=>'');
 return {...raw,config,maxTotalCoins,
  prizePlan:[...prefix,...encodeFixedEditionPlan(plan)],
  budgetMode:'fixed',revision:(Number.isInteger(raw.revision)?raw.revision:0)+1,
  updatedAt:now};
}
