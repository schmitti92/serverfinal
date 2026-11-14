import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {drawMonsterSlot,MONSTER_SLOTS_WEIGHTS,MONSTER_SLOT_CASH_PRIZES,MONSTER_SLOT_SKYJO_CASH_PRIZES,
 skyjoMonsterSlotWeights,slotCashChance} from '../monster-slots.js';

// 50% is the category chance PER reel; money amounts keep their own jackpot odds.
test('SKYJO 100 Tore uses exactly 50% cash and 50% non-cash prizes',()=>{
 const weights=skyjoMonsterSlotWeights();
 assert.deepEqual(weights,{chest:35,pack:30,hammer:20,joker:4,minigame:3,monster:3,cash:95});
 assert.equal(slotCashChance(weights),0.5);
 assert.equal(slotCashChance(MONSTER_SLOTS_WEIGHTS),2/3,'Other Deal or No Deal modes unchanged');
 const total=Object.values(weights).reduce((sum,n)=>sum+n,0);
 let money=0,nonCash=0;
 for(let categoryRoll=0;categoryRoll<total;categoryRoll++){
  let first=true;
  const rand=max=>{
   if(first){first=false;assert.equal(max,total);return categoryRoll;}
   return 0;
  };
  const prize=drawMonsterSlot(1,rand,weights);
  if(prize.kind==='cash'){money++;assert.ok(prize.amountCents>=1&&prize.amountCents<=500_000_000);}
  else nonCash++;
 }
 assert.equal(money,95);
 assert.equal(nonCash,95);
});
test('Every SKYJO cash prize is between 1 cent and 5 million euros',()=>{
 assert.equal(MONSTER_SLOT_CASH_PRIZES[0][0],1);
 assert.equal(MONSTER_SLOT_CASH_PRIZES.at(-1)[0],500_000_000);
 assert.ok(MONSTER_SLOT_CASH_PRIZES.every(([cents,points])=>Number.isSafeInteger(cents)&&cents>=1&&cents<=500_000_000&&points>0));
 const moneyOnly={chest:0,pack:0,hammer:0,joker:0,minigame:0,monster:0,cash:1};
 assert.equal(drawMonsterSlot(1,()=>0,moneyOnly).amountCents,1);
 assert.equal(drawMonsterSlot(1,max=>max-1,moneyOnly).amountCents,500_000_000);
});
test('Host item ratios remain customizable but SKYJO always gets 50/50',()=>{
 const hostCustom={chest:1,pack:7,hammer:2,joker:0,minigame:0,monster:0,cash:0};
 const result=skyjoMonsterSlotWeights(hostCustom);
 assert.deepEqual(result,{chest:1,pack:7,hammer:2,joker:0,minigame:0,monster:0,cash:10});
 assert.equal(slotCashChance(result),0.5);
 const globalMoneyOnly={chest:0,pack:0,hammer:0,joker:0,minigame:0,monster:0,cash:100};
 const moneyOnlyFallback=skyjoMonsterSlotWeights(globalMoneyOnly);
 assert.equal(slotCashChance(moneyOnlyFallback),0.5);
 assert.deepEqual(moneyOnlyFallback,skyjoMonsterSlotWeights());
 assert.equal(globalMoneyOnly.cash,100,'Host configuration is not mutated');
});
test('SKYJO payout path uses special 50/50 weights, not global weights',()=>{
 const api=readFileSync(new URL('../deal-or-no-deal-api.js',import.meta.url),'utf8');
 assert.match(api,/mode==='skyjo'\?skyjoMonsterSlotWeights\(slotWeights\):slotWeights/);
 assert.match(api,/drawMonsterSlot\(gate,randomInt,effectiveSlotWeights,effectiveCashPrizes\)/);
 assert.match(api,/drawMonsterSlots\(gate,randomInt,effectiveSlotWeights,effectiveCashPrizes\)/);
});


test('SKYJO high cash amounts are rarer while every amount remains obtainable and 50% cash stays intact',()=>{
 const rangeWeight=(table,min)=>table.filter(([amount])=>amount>=min).reduce((n,[,weight])=>n+weight,0);
 const total=table=>table.reduce((n,[,weight])=>n+weight,0);
 const percent=(table,min)=>rangeWeight(table,min)/total(table);
 const defaultEpic=percent(MONSTER_SLOT_CASH_PRIZES,25_000_000);
 const newEpic=percent(MONSTER_SLOT_SKYJO_CASH_PRIZES,25_000_000);
 const defaultLegend=percent(MONSTER_SLOT_CASH_PRIZES,100_000_000);
 const newLegend=percent(MONSTER_SLOT_SKYJO_CASH_PRIZES,100_000_000);
 assert.ok(newEpic<defaultEpic,'250k+ is less likely within a cash reel');
 assert.ok(newLegend<defaultLegend,'1m+ is less likely within a cash reel');
 assert.ok(newEpic>0&&newLegend>0);
 assert.equal(MONSTER_SLOT_SKYJO_CASH_PRIZES.length,MONSTER_SLOT_CASH_PRIZES.length);
 for(let i=0;i<MONSTER_SLOT_CASH_PRIZES.length;i++){
  const [amount,oldPoints]=MONSTER_SLOT_CASH_PRIZES[i];
  const [newAmount,newPoints]=MONSTER_SLOT_SKYJO_CASH_PRIZES[i];
  assert.equal(newAmount,amount);
  assert.ok(newPoints>0);
  if(amount<25_000_000)assert.equal(newPoints,oldPoints);
  else if(amount<100_000_000)assert.equal(newPoints,Math.max(1,Math.round(oldPoints*0.8)));
  else assert.equal(newPoints,Math.max(1,Math.round(oldPoints*0.65)));
 }
 const half=skyjoMonsterSlotWeights();
 assert.equal(slotCashChance(half),0.5);
 // Entire RNG endpoints still produce 1 cent and 5 million with the special table.
 const moneyOnly={chest:0,pack:0,hammer:0,joker:0,minigame:0,monster:0,cash:1};
 assert.equal(drawMonsterSlot(1,()=>0,moneyOnly,MONSTER_SLOT_SKYJO_CASH_PRIZES).amountCents,1);
 assert.equal(drawMonsterSlot(1,max=>max-1,moneyOnly,MONSTER_SLOT_SKYJO_CASH_PRIZES).amountCents,500_000_000);
});
test('Only SKYJO mode passes reduced jackpot weights to the final award draw',()=>{
 const api=readFileSync(new URL('../deal-or-no-deal-api.js',import.meta.url),'utf8');
 assert.match(api,/mode==='skyjo'\?MONSTER_SLOT_SKYJO_CASH_PRIZES:MONSTER_SLOT_CASH_PRIZES/);
 assert.match(api,/drawMonsterSlots\(gate,randomInt,effectiveSlotWeights,effectiveCashPrizes\)/);
 assert.match(api,/drawMonsterSlot\(gate,randomInt,effectiveSlotWeights,effectiveCashPrizes\)/);
});
