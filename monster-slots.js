import {randomInt} from 'node:crypto';

// Three independent guaranteed prizes. Category odds sum to exactly 100000.
// The Christmas Monster Wheel remains a separate ticket-redeemable attraction.
export const MONSTER_SLOTS_WEIGHTS=Object.freeze({
 chest:35000,pack:30000,hammer:20000,joker:4000,minigame:3000,monster:3000,cash:5000
});
export const MONSTER_SLOTS_COUNT=3;
// Deal or No Deal: one unique champion earns 3 reels, one unique runner-up
// earns 1 reel in games with >=3 participants, everyone else earns none.
// Tied champions earn no slots; ×2 wallet bonuses never affect ranking.
export function monsterSlotPlacements(payouts=[]){
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
  reels:uniqueChampion&&p.amount===amounts[0]?3:
   second.length===1&&p.uid===second[0].uid?1:0,
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
const moneyBands=[
 [1,10000,5700],             // 1 Cent–100 Euro
 [10001,1000000,2600],        // over 100–10k Euro
 [1000001,100000000,1300],    // over 10k–1m Euro
 [100000001,10000000000,400] // over 1m–100m Euro
];
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
 return 'Zufallsgeld';
};
export function drawMonsterSlot(gate=1,rand=randomInt){
 const kind=weighted(Object.entries(MONSTER_SLOTS_WEIGHTS),rand);
 let id=null,count=1,amountCents=null;
 if(kind==='chest')id=weighted(tiers.map((tier,i)=>[tier,monsterSlotChestOdds(gate)[i]]),rand);
 if(kind==='pack'){
  id=weighted(Object.entries(packs).map(([name,weights])=>[name,weights.reduce((a,b)=>a+b,0)]),rand);
  count=quantity(packs[id],rand);
 }
 if(kind==='hammer'){
  id=weighted(Object.entries(hammerOdds).map(([name,weights])=>[name,weights.reduce((a,b)=>a+b,0)]),rand);
  count=quantity(hammerOdds[id],rand);
 }
 if(kind==='joker')count=quantity([75,25],rand);
 if(kind==='minigame')count=quantity([60,30,10],rand);
 if(kind==='monster')count=quantity([70,25,5],rand);
 if(kind==='cash'){
  const i=weighted(moneyBands.map((b,i)=>[i,b[2]]),rand);
  const [min,max]=moneyBands[i];
  amountCents=min+rand(max-min+1);
 }
 return Object.freeze({kind,id,quantity:count,...(amountCents!==null?{amountCents}:{}),
  label:kind==='cash'?(amountCents/100).toLocaleString('de-DE',{style:'currency',currency:'EUR'}):labelFor(kind,id,count)});
}
export function drawMonsterSlots(gate=1,rand=randomInt){
 return Array.from({length:MONSTER_SLOTS_COUNT},()=>drawMonsterSlot(gate,rand));
}
