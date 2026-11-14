import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 drawMonsterSlot,MONSTER_SLOTS_WEIGHTS,MONSTER_SLOT_SKYJO_WEIGHTS,MONSTER_SLOT_SKYJO_LOOT,
 MONSTER_SLOT_CASH_PRIZES,MONSTER_SLOT_SKYJO_CASH_PRIZES,
 monsterSlotChestOdds,skyjoMonsterSlotChestOdds,skyjoMonsterSlotWeights,slotCashChance
} from '../monster-slots.js';

// The production SKYJO mix is independent of DOND's host setting and has
// exact category probabilities per reel rather than a UI-only approximation.
test('SKYJO money 55%, DOG album packs 23%, hammers 13%, material chests 5%, other 4%',()=>{
 const weights=skyjoMonsterSlotWeights();
 assert.deepEqual(weights,{
  chest:50,pack:230,hammer:130,joker:18,minigame:12,monster:10,cash:550
 });
 assert.equal(weights,MONSTER_SLOT_SKYJO_WEIGHTS);
 assert.equal(slotCashChance(weights),0.55);
 assert.equal(slotCashChance(MONSTER_SLOTS_WEIGHTS),2/3,'Deal or No Deal original slots unchanged');
 const total=Object.values(weights).reduce((sum,n)=>sum+n,0);
 assert.equal(total,1000);
 const counts={};
 for(let roll=0;roll<1000;roll++){
  let first=true;
  const rand=max=>{
   if(first){first=false;assert.equal(max,total);return roll;}
   return 0;
  };
  const prize=drawMonsterSlot(1,rand,weights,MONSTER_SLOT_SKYJO_CASH_PRIZES,MONSTER_SLOT_SKYJO_LOOT);
  counts[prize.kind]=(counts[prize.kind]||0)+1;
  if(prize.kind==='cash')assert.ok(prize.amountCents>=1&&prize.amountCents<=500_000_000);
 }
 assert.deepEqual(counts,{chest:50,pack:230,hammer:130,joker:18,minigame:12,monster:10,cash:550});
});
test('Original Deal or No Deal odds and host settings remain separate',()=>{
 const hostMoneyOnly={...MONSTER_SLOTS_WEIGHTS,chest:0,pack:0,hammer:0,joker:0,minigame:0,monster:0,cash:100};
 assert.equal(skyjoMonsterSlotWeights(hostMoneyOnly),MONSTER_SLOT_SKYJO_WEIGHTS);
 assert.equal(skyjoMonsterSlotWeights({chest:1000,cash:0}),MONSTER_SLOT_SKYJO_WEIGHTS);
 assert.equal(hostMoneyOnly.cash,100);
 assert.equal(MONSTER_SLOTS_WEIGHTS.chest,35);
 assert.ok(Object.isFrozen(MONSTER_SLOT_SKYJO_WEIGHTS));
 const moneyOnly={chest:0,pack:0,hammer:0,joker:0,minigame:0,monster:0,cash:1};
 const dealDraw=drawMonsterSlot(1,()=>0,moneyOnly);
 assert.equal(dealDraw.amountCents,1);
});
test('SKYJO packs favor the DOG collection, with rarer Premium and Platinum vouchers',()=>{
 assert.deepEqual(MONSTER_SLOT_SKYJO_LOOT.pack,{small:120,large:86,premium:20,platinum:4});
 const expected={small:120,large:86,premium:20,platinum:4};
 const observed={small:0,large:0,premium:0,platinum:0};
 // 50 is the first pack category point; third random call chooses pack subtype.
 for(let roll=0;roll<230;roll++){
  let call=0;
  const prize=drawMonsterSlot(1,max=>{
   call++;if(call===1){assert.equal(max,1000);return 50;}
   if(call===2){assert.equal(max,3000);return 0;}
   if(call===3){assert.equal(max,230);return roll;}
   return 0;
  },MONSTER_SLOT_SKYJO_WEIGHTS,MONSTER_SLOT_SKYJO_CASH_PRIZES,MONSTER_SLOT_SKYJO_LOOT);
  assert.equal(prize.kind,'pack');
  observed[prize.id]++;
 }
 assert.deepEqual(observed,expected);
 assert.equal(observed.premium+observed.platinum,24);
});
test('SKYJO hammers overwhelmingly yield simple hammers, rare lucky hammer jackpots',()=>{
 assert.deepEqual(MONSTER_SLOT_SKYJO_LOOT.hammer,{single:110,double:17,lucky:3});
 const counts={single:0,double:0,lucky:0};
 for(let roll=0;roll<130;roll++){
  let call=0;
  const prize=drawMonsterSlot(1,max=>{
   call++;if(call===1){assert.equal(max,1000);return 280;}
   if(call===2){assert.equal(max,3000);return 0;}
   if(call===3){assert.equal(max,130);return roll;}
   return 0;
  },MONSTER_SLOT_SKYJO_WEIGHTS,MONSTER_SLOT_SKYJO_CASH_PRIZES,MONSTER_SLOT_SKYJO_LOOT);
  assert.equal(prize.kind,'hammer');
  counts[prize.id]++;
 }
 assert.deepEqual(counts,{single:110,double:17,lucky:3});
});
test('Legendary and epic expedition chests remain attainable but are less likely at all gates',()=>{
 for(const gate of [1,20,30,50,80,100]){
  const old=monsterSlotChestOdds(gate),now=skyjoMonsterSlotChestOdds(gate);
  assert.equal(now.length,5);
  assert.ok(now.every(v=>v>0));
  const p=(arr,i)=>arr[i]/arr.reduce((n,x)=>n+x,0);
  assert.ok(p(now,3)<p(old,3),'gold chest is rarer at gate '+gate);
  assert.ok(p(now,4)<p(old,4),'legendary chest is rarer at gate '+gate);
  assert.equal(now[0],old[0]*3);
 }
});
test('All SKYJO cash denominations remain from one cent through five million EUR',()=>{
 assert.equal(MONSTER_SLOT_CASH_PRIZES[0][0],1);
 assert.equal(MONSTER_SLOT_CASH_PRIZES.at(-1)[0],500_000_000);
 assert.equal(MONSTER_SLOT_SKYJO_CASH_PRIZES.length,MONSTER_SLOT_CASH_PRIZES.length);
 assert.ok(MONSTER_SLOT_SKYJO_CASH_PRIZES.every(([cents,points])=>
  Number.isSafeInteger(cents)&&cents>=1&&cents<=500_000_000&&points>0));
 const onlyCash={chest:0,pack:0,hammer:0,joker:0,minigame:0,monster:0,cash:1};
 assert.equal(drawMonsterSlot(1,()=>0,onlyCash,MONSTER_SLOT_SKYJO_CASH_PRIZES).amountCents,1);
 assert.equal(drawMonsterSlot(1,max=>max-1,onlyCash,MONSTER_SLOT_SKYJO_CASH_PRIZES).amountCents,500_000_000);
});
test('Epic and legendary SKYJO cash jackpots are rarer even with increased overall cash chance',()=>{
 const percent=(table,min)=>table.filter(([amount])=>amount>=min).reduce((n,[,weight])=>n+weight,0)/
  table.reduce((n,[,weight])=>n+weight,0);
 const epicOld=percent(MONSTER_SLOT_CASH_PRIZES,25_000_000),
  epicNew=percent(MONSTER_SLOT_SKYJO_CASH_PRIZES,25_000_000),
  legendOld=percent(MONSTER_SLOT_CASH_PRIZES,100_000_000),
  legendNew=percent(MONSTER_SLOT_SKYJO_CASH_PRIZES,100_000_000);
 assert.ok(epicNew<epicOld);
 assert.ok(legendNew<legendOld);
 assert.ok(.55*epicNew<.50*epicOld,'Epic cash chance fell even though money chance increased');
 assert.ok(.55*legendNew<.50*legendOld,'Legendary cash chance fell even though money chance increased');
 for(let i=0;i<MONSTER_SLOT_CASH_PRIZES.length;i++){
  const [amount,oldPoints]=MONSTER_SLOT_CASH_PRIZES[i];
  const [newAmount,newPoints]=MONSTER_SLOT_SKYJO_CASH_PRIZES[i];
  assert.equal(newAmount,amount);
  if(amount<25_000_000)assert.equal(newPoints,oldPoints);
  else if(amount<100_000_000)assert.equal(newPoints,Math.max(1,Math.round(oldPoints*.5)));
  else assert.equal(newPoints,Math.max(1,Math.round(oldPoints*.35)));
 }
});
test('Production SKYJO payouts use all special tables; other modes retain original tables',()=>{
 const api=readFileSync(new URL('../deal-or-no-deal-api.js',import.meta.url),'utf8');
 assert.match(api,/mode==='skyjo'\?skyjoMonsterSlotWeights\(\):slotWeights/);
 assert.match(api,/mode==='skyjo'\?MONSTER_SLOT_SKYJO_CASH_PRIZES:MONSTER_SLOT_CASH_PRIZES/);
 assert.match(api,/mode==='skyjo'\?MONSTER_SLOT_SKYJO_LOOT:null/);
 assert.match(api,/drawMonsterSlot\(gate,randomInt,effectiveSlotWeights,effectiveCashPrizes,effectiveLootMix\)/);
 assert.match(api,/drawMonsterSlots\(gate,randomInt,effectiveSlotWeights,effectiveCashPrizes,effectiveLootMix\)/);
});
