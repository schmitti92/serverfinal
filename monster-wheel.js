import {randomInt} from 'node:crypto';

// One physical stop per entry. The deliberately repeated 1x prizes are
// independent stops, not a display-only multiplication of their odds.
// All stops have equal weight. Amounts are in Euro CENTS.
export const MONSTER_WHEEL_DURATION_MS=8000;
const slot=(id,label,short,icon,kind,quantity=0,extra={})=>Object.freeze({id,label,short,icon,kind,quantity,...extra});
export const MONSTER_WHEEL_SLOTS=Object.freeze([
 slot('cash-10m','10 Millionen €','10 Mio.','💰','cash',1000000000),
 slot('cash-2m','2 Millionen €','2 Mio.','💶','cash',200000000),
 slot('gold-4','4 Goldpakete','4× Gold','🎁','pack',4,{packId:'large'}),
 slot('cash-random','Zufallsgewinn: 100 € bis 2 Mio. €','Mystery','🎲','randomCash'),
 slot('giftzwerg','Muffiger Giftzwerg – exklusiver Charakter','Giftzwerg','🧌','avatar',1,{avatarId:15}),
 slot('lucky-10','10 goldene Hammer','10× Gold','🔨','hammer',10,{hammer:'lucky'}),
 slot('lucky-5','5 goldene Hammer','5× Gold','🔨','hammer',5,{hammer:'lucky'}),
 slot('lucky-3','3 goldene Hammer','3× Gold','🔨','hammer',3,{hammer:'lucky'}),
 slot('double-5','5 Doppel-Hammer','5× Doppel','⚒️','hammer',5,{hammer:'double'}),
 ...Array.from({length:3},(_,i)=>slot('single-1-'+(i+1),'1 einfacher Hammer','1× Einfach','🔨','hammer',1,{hammer:'single'})),
 ...Array.from({length:3},(_,i)=>slot('lucky-1-'+(i+1),'1 goldener Hammer','1× Gold','✨','hammer',1,{hammer:'lucky'})),
 slot('gold-5','5 Goldpakete','5× Gold','🎁','pack',5,{packId:'large'}),
 slot('premium-3','3 Premiumpakete','3× Premium','👑','pack',3,{packId:'premium'}),
 slot('joker-5','5 Kofferblick-Joker','5× Joker','🃏','joker',5),
 ...Array.from({length:3},(_,i)=>slot('joker-1-'+(i+1),'1 Kofferblick-Joker','1× Joker','🃏','joker',1))
]);
export function drawMonsterWheel({giftzwergUnlocked=false}={},rand=randomInt){
 const available=giftzwergUnlocked?MONSTER_WHEEL_SLOTS.filter(s=>s.kind!=='avatar'):MONSTER_WHEEL_SLOTS;
 const entry=available[rand(available.length)];
 if(!entry)throw Error('INVALID_MONSTER_SLOT');
 const index=MONSTER_WHEEL_SLOTS.findIndex(s=>s.id===entry.id);
 return {...entry,index,amountCents:entry.kind==='randomCash'?rand(100,2_000_001)*100:entry.kind==='cash'?entry.quantity:0};
}
export function monsterWheelPrizeSummary(prize){
 if(!prize||!MONSTER_WHEEL_SLOTS.some(s=>s.id===prize.id))throw Error('INVALID_MONSTER_PRIZE');
 if(prize.kind==='cash'||prize.kind==='randomCash'){
  if(!Number.isSafeInteger(prize.amountCents)||prize.amountCents<10000)throw Error('INVALID_MONSTER_CASH');
  return (prize.amountCents/100).toLocaleString('de-DE')+' € Spielgeld';
 }
 return prize.label;
}
export function checkMonsterBalance(balance,amount,max=Number.MAX_SAFE_INTEGER){
 if(!Number.isSafeInteger(balance)||balance<0||!Number.isSafeInteger(amount)||amount<0||
  balance>max-amount)throw Error('MONSTER_BALANCE_OVERFLOW');
 return balance+amount;
}
