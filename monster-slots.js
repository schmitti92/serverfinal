import {randomInt} from 'node:crypto';

// Three independent guaranteed prizes. Category weights are relative points.
 // 190 cash points against 95 combined item points = exactly 2:1 money/items.
// The Christmas Monster Wheel remains a separate ticket-redeemable attraction.
export const MONSTER_SLOTS_WEIGHTS=Object.freeze({
 chest:35,pack:30,hammer:20,joker:4,minigame:3,monster:3,cash:190
});
// SKYJO 100 Tore Special has its own deliberately album-focused economy.
// 55% money, 23% album packs, 13% hammers, 5% material chests, 4% other.
// Its mix is independent of DOND's host-configurable global Monster Slot odds;
// those settings and all other DOND/100-Tore reward modes are untouched.
export const MONSTER_SLOT_SKYJO_WEIGHTS=Object.freeze({
 chest:50,pack:230,hammer:130,joker:18,minigame:12,monster:10,cash:550
});
export function skyjoMonsterSlotWeights(){
 return MONSTER_SLOT_SKYJO_WEIGHTS;
}
// Within each SKYJO category: common DOG packs and the single hammer dominate.
// Premium, platinum, lucky hammers and gold/legendary material chests are rarer.
export const MONSTER_SLOT_SKYJO_LOOT=Object.freeze({
 pack:Object.freeze({small:120,large:86,premium:20,platinum:4}),
 hammer:Object.freeze({single:110,double:17,lucky:3})
});
export function skyjoMonsterSlotChestOdds(gate=1){
 const base=monsterSlotChestOdds(gate);
 return [base[0],base[1],base[2],Math.max(1,Math.round(base[3]*0.35)),
  Math.max(1,Math.round(base[4]*0.15))];
}
export const MONSTER_SLOTS_COUNT=3;
// Exactly one wildcard in 3,000 non-cash prize rolls.
// With the standard 2:1 cash/item weighting: 1 in 9,000 reels.
export const MONSTER_SLOT_WILDCARD_NONCASH_ODDS=3000;
export function monsterSlotRarity(prize){
 if(prize?.kind==='wildcard'||prize?.kind==='cash'&&prize.amountCents>=500000000)return 'mythic';
 if(prize?.kind==='chest'&&prize.id==='legendary'||
    prize?.kind==='pack'&&prize.id==='platinum'||
    prize?.kind==='cash'&&prize.amountCents>=100000000)return 'legendary';
 if(prize?.kind==='chest'&&prize.id==='gold'||
    prize?.kind==='pack'&&prize.id==='premium'||
    prize?.kind==='hammer'&&prize.id==='lucky'||
    prize?.kind==='cash'&&prize.amountCents>=25000000)return 'epic';
 if(prize?.kind==='chest'&&prize.id==='silver'||
    prize?.kind==='pack'&&prize.id==='large'||
    prize?.kind==='cash'&&prize.amountCents>=1000000)return 'rare';
 return 'common';
}
// Deal or No Deal: one unique champion earns 6 reels and the unique runner-up
// earns 2 reels in games with >=3 participants. Legacy payouts can retain 3/1.
// Tied champions earn no slots; ×2 wallet bonuses never affect ranking.
export function monsterSlotPlacements(payouts=[],{legacy=false}={}){
 if(!Array.isArray(payouts)||payouts.length<1||payouts.length>4||
  payouts.some(p=>typeof p?.uid!=='string'||!p.uid||
   !Number.isSafeInteger(p.amount)||p.amount<0)||
  new Set(payouts.map(p=>p.uid)).size!==payouts.length)
  throw Error('INVALID_SLOT_RANKINGS');
 const amounts=[...new Set(payouts.map(p=>p.amount))].sort((a,b)=>b-a);
 const top=payouts.filter(p=>p.amount===amounts[0]);
 const uniqueChampion=top.length===1;
 const secondAmount=amounts[1];
 const second=uniqueChampion&&payouts.length>=3&&secondAmount!==undefined?
  payouts.filter(p=>p.amount===secondAmount):[];
 return new Map(payouts.map(p=>[p.uid,{
  rank:amounts.indexOf(p.amount)+1,
  reels:uniqueChampion&&p.amount===amounts[0]?(legacy?3:6):
   second.length===1&&p.uid===second[0].uid?(legacy?1:2):0,
  tiedTop:!uniqueChampion
 }]));
}
const tiers=['wood','iron','silver','gold','legendary'];
const types=['small','large','premium','platinum'];
const hammers=['single','double','lucky'];
const weighted=(rows,rand)=>{
 const total=rows.reduce((s,v)=>s+v[1],0);
 let roll=rand(total);
 for(const [key,weight] of rows){roll-=weight;if(roll<0)return key}
 throw Error('INVALID_SLOT_WEIGHTS');
};
const quantity=(weights,rand)=>weighted(weights.map((n,i)=>[i+1,n]),rand);
export function monsterSlotChestOdds(gate=1){
 if(gate>=80)return [10,20,30,28,12];
 if(gate>=50)return [25,30,25,15,5];
 if(gate>=30)return [45,28,17,7,3];
 if(gate>=20)return [60,24,10,4,2];
 return [70,18,8,3,1];
}
// Exact cash denominations from 0.01 € to 5,000,000 € (integer cents).
// More common midrange prizes, very rare multimillion jackpots.
export const MONSTER_SLOT_CASH_PRIZES=Object.freeze([
 [1,8],[2,12],[5,18],[10,25],[20,35],[50,60],
 [100,95],[200,135],[500,180],[1000,230],[2000,270],[5000,320],
 [10000,400],[20000,460],[50000,520],[100000,590],
 [250000,630],[500000,670],[1000000,650],[2500000,620],
 [5000000,590],[10000000,500],[25000000,450],[50000000,340],
 [75000000,270],[100000000,220],[150000000,150],[200000000,110],
 [250000000,75],[300000000,45],[400000000,25],[500000000,10]
].map(entry=>Object.freeze(entry)));
// SKYJO special only: epic and legendary money jackpots are particularly rare.
// Relative cash weight: 250,000–999,999.99 EUR reduced by 50%;
// 1,000,000–5,000,000 EUR reduced by 65%.
// Overall cash chance is 55%, but all prize amounts remain obtainable.
export const MONSTER_SLOT_SKYJO_CASH_PRIZES=Object.freeze(
 MONSTER_SLOT_CASH_PRIZES.map(([amount,weight])=>Object.freeze([
  amount,amount>=100000000?Math.max(1,Math.round(weight*0.35)):
   amount>=25000000?Math.max(1,Math.round(weight*0.5)):weight
 ]))
);
export const slotCashChance=weights=>{
 const total=Object.values(weights||MONSTER_SLOTS_WEIGHTS).reduce((sum,n)=>sum+n,0);
 return total>0?(weights||MONSTER_SLOTS_WEIGHTS).cash/total:0;
};
const packs=Object.freeze({
 small:[280,120,50],large:[180,100,50],premium:[90,50,30],platinum:[30,15,5]
});
const hammerOdds=Object.freeze({
 single:[240,100,60],double:[200,100,50],lucky:[150,70,30]
});
const labelFor=(kind,id,count)=>{
 if(kind==='chest')return ({wood:'Holzkiste',iron:'Eisenkiste',silver:'Silberkiste',gold:'Goldkiste',legendary:'Legendäre Kiste'})[id];
 if(kind==='pack')return count+'× '+({small:'Normalpaket',large:'Goldpaket',premium:'Premiumpaket',platinum:'Platinpaket'})[id];
 if(kind==='hammer')return count+'× '+({single:'Einfachhammer',double:'Doppelhammer',lucky:'Goldhammer'})[id];
 if(kind==='joker')return count+'× Kofferblick-Joker';
 if(kind==='minigame')return count+'× Minispiel-Gutschein';
 if(kind==='monster')return count+'× Monster-Drehgutschein';
 if(kind==='wildcard')return '❓ Joker-Sammelkarte · Wunschkarte wählen';
 return 'Zufallsgeld';
};
export function drawMonsterSlot(gate=1,rand=randomInt,categoryWeights=MONSTER_SLOTS_WEIGHTS,
 cashPrizes=MONSTER_SLOT_CASH_PRIZES,lootMix=null){
 let kind=weighted(Object.entries(categoryWeights),rand);
 // Wildcard is an ultra-rare *item* subtype, so changing cash vs items
 // preserves the requested 2:1 category ratio without a new category weight.
 if(kind!=='cash'&&rand(MONSTER_SLOT_WILDCARD_NONCASH_ODDS)===1234)kind='wildcard';
 let id=null,count=1,amountCents=null;
 if(kind==='chest'){
  const chestWeights=lootMix===MONSTER_SLOT_SKYJO_LOOT?
   skyjoMonsterSlotChestOdds(gate):monsterSlotChestOdds(gate);
  id=weighted(tiers.map((tier,i)=>[tier,chestWeights[i]]),rand);
 }
 if(kind==='pack'){
  id=weighted(lootMix?.pack?Object.entries(lootMix.pack):
   Object.entries(packs).map(([name,weights])=>[name,weights.reduce((a,b)=>a+b,0)]),rand);
  count=quantity(packs[id],rand);
 }
 if(kind==='hammer'){
  id=weighted(lootMix?.hammer?Object.entries(lootMix.hammer):
   Object.entries(hammerOdds).map(([name,weights])=>[name,weights.reduce((a,b)=>a+b,0)]),rand);
  count=quantity(hammerOdds[id],rand);
 }
 if(kind==='joker')count=quantity([75,25],rand);
 if(kind==='minigame')count=quantity([60,30,10],rand);
 if(kind==='monster')count=quantity([70,25,5],rand);
 if(kind==='cash'){
  amountCents=weighted(cashPrizes.map(([amount,weight])=>[amount,weight]),rand);
 }
 const prize={kind,id,quantity:count,...(amountCents!==null?{amountCents}:{}),
  label:kind==='cash'?(amountCents/100).toLocaleString('de-DE',{style:'currency',currency:'EUR'}):labelFor(kind,id,count)};
 return Object.freeze({...prize,rarity:monsterSlotRarity(prize)});
}
export function drawMonsterSlots(gate=1,rand=randomInt,categoryWeights=MONSTER_SLOTS_WEIGHTS,
 cashPrizes=MONSTER_SLOT_CASH_PRIZES,lootMix=null){
 return Array.from({length:MONSTER_SLOTS_COUNT},()=>drawMonsterSlot(gate,rand,categoryWeights,cashPrizes,lootMix));
}
