/**
 * Two independent DOG scratch tickets:
 *  - number_one_20: 20 visible prizes, twenty concealed numbers 1..10.
 *    A number 1 wins the prize in its row.
 *  - dog_jackpot_9: nine concealed cells. One DOG trigger unlocks every
 *    other prize on that same ticket. No DOG means no payout.
 *
 * Immutable 7th-generation visual receipts are created on Render.
 * This module never reads browser state or grants money by itself.
 */
export const SPECIAL_SCRATCH_VERSION=7;
export const NUMBER_ROW_COUNT=20;
export const DOG_JACKPOT_FIELD_COUNT=9;
export const DOG_JACKPOT_CHANCE_PER_1000=350;
export const NUMBER_PRIZE_WEIGHTS=Object.freeze([
 Object.freeze({symbol:'🪙',weight:650,amount:100}),
 Object.freeze({symbol:'💵',weight:280,amount:300}),
 Object.freeze({symbol:'💼',weight:60,amount:800}),
 Object.freeze({symbol:'🎁',weight:10,amount:null})
]);
export const DOG_PRIZE_WEIGHTS=Object.freeze([
 Object.freeze({symbol:'🪙',weight:550,amount:100}),
 Object.freeze({symbol:'💵',weight:300,amount:300}),
 Object.freeze({symbol:'💼',weight:148,amount:800}),
 Object.freeze({symbol:'🎁',weight:2,amount:null})
]);
const money=new Map([...NUMBER_PRIZE_WEIGHTS,...DOG_PRIZE_WEIGHTS]
 .filter(entry=>entry.amount!==null).map(entry=>[entry.symbol,entry.amount]));
const icons=Object.freeze([...NUMBER_PRIZE_WEIGHTS.map(entry=>entry.symbol)]);
const pick=(pool,draw)=>{
 const value=draw(1000);
 if(!Number.isInteger(value)||value<0||value>=1000)throw Error('SCRATCH_SPECIAL_RANDOM_INVALID');
 let n=value;
 for(const entry of pool){
  if(n<entry.weight)return entry.symbol;
  n-=entry.weight;
 }
 throw Error('SCRATCH_SPECIAL_WEIGHTS_INVALID');
};
const validNumberCells=cells=>Array.isArray(cells)&&cells.length===NUMBER_ROW_COUNT*2&&
 cells.every((value,index)=>index%2===0?icons.includes(value):Number.isInteger(value)&&value>=1&&value<=10);
const validDogCells=cells=>Array.isArray(cells)&&cells.length===DOG_JACKPOT_FIELD_COUNT&&
 cells.every(value=>icons.includes(value)||value==='DOG')&&
 cells.filter(value=>value==='DOG').length<=1;

export function evaluateSpecialScratch(board){
 const cells=board?.cells;
 if(board?.variantId==='number_one_20'){
  if(!validNumberCells(cells))throw Error('SCRATCH_NUMBER_BOARD_INVALID');
  return Array.from({length:NUMBER_ROW_COUNT},(_,row)=>row)
   .filter(row=>cells[row*2+1]===1)
   .map(row=>({indices:[row*2,row*2+1],symbol:cells[row*2],rule:'number-one'}));
 }
 if(board?.variantId==='dog_jackpot_9'){
  if(!validDogCells(cells))throw Error('SCRATCH_DOG_BOARD_INVALID');
  return cells.includes('DOG')?
   cells.flatMap((symbol,index)=>symbol==='DOG'?[]:[{indices:[index],symbol,rule:'dog-all'}]):[];
 }
 throw Error('SCRATCH_SPECIAL_VARIANT_INVALID');
}
function decorate(board,unlock){
 const payouts=board.variantId==='number_one_20'&&Array.isArray(board.coinAmounts)?
  new Map([['🪙',board.coinAmounts[0]],['💵',board.coinAmounts[1]],['💼',board.coinAmounts[2]]]):money;
 const patterns=evaluateSpecialScratch(board);
 let usedUnlock=false;
 const wins=patterns.map(pattern=>{
  let prize;
  if(pattern.symbol==='🎁'){
   if(!usedUnlock&&unlock?.unlockId){
    usedUnlock=true;
    prize={type:'unlock',symbol:'🎁',prize:{
     unlockId:unlock.unlockId,name:unlock.name,icon:unlock.icon,category:unlock.category
    }};
   }else prize={type:'coins',symbol:'🎁',amount:1500};
  }else prize={type:'coins',symbol:pattern.symbol,amount:payouts.get(pattern.symbol)};
  return {...pattern,prize};
 });
 return {
  board:{...board,wins},
  winnings:wins.map(w=>w.prize),
  unlockId:usedUnlock?unlock.unlockId:null
 };
}
export function drawNumberOne20({draw,unlock=null,settings=null}={}){
 if(typeof draw!=='function')throw Error('SCRATCH_SPECIAL_DRAW_REQUIRED');
 const defaults=[650,280,60,10];
 const weights=Array.isArray(settings?.symbolWeights)?settings.symbolWeights:defaults;
 const amounts=Array.isArray(settings?.coinAmounts)?settings.coinAmounts:[100,300,800];
 const hitPer1000=Number.isInteger(settings?.hitPer1000)?settings.hitPer1000:100;
 if(weights.length!==4||weights.some(x=>!Number.isInteger(x)||x<0||x>1000)||
    weights.reduce((a,b)=>a+b,0)!==1000||!Array.isArray(amounts)||amounts.length!==3||
    amounts.some(x=>!Number.isInteger(x)||x<1||x>50000000)||
    !(amounts[0]<amounts[1]&&amounts[1]<amounts[2])||
    hitPer1000<0||hitPer1000>1000)throw Error('SCRATCH_NUMBER_SETTINGS_INVALID');
 const prizePool=NUMBER_PRIZE_WEIGHTS.map((row,i)=>({...row,weight:weights[i],amount:i<3?amounts[i]:null}));
 const cells=[];
 for(let i=0;i<NUMBER_ROW_COUNT;i++){
  const symbol=pick(prizePool,draw);
  // Preserve the default 1..10 uniform roll for older tests and receipts.
  // Custom odds are sampled in thousandths; other numbers remain 2..10.
  let number;
  if(hitPer1000===100){
   const roll=draw(10);
   if(!Number.isInteger(roll)||roll<0||roll>=10)throw Error('SCRATCH_SPECIAL_RANDOM_INVALID');
   number=roll+1;
  }else{
   const roll=draw(1000);
   if(!Number.isInteger(roll)||roll<0||roll>=1000)throw Error('SCRATCH_SPECIAL_RANDOM_INVALID');
   if(roll<hitPer1000)number=1;
   else{
    const other=draw(9);
    if(!Number.isInteger(other)||other<0||other>=9)throw Error('SCRATCH_SPECIAL_RANDOM_INVALID');
    number=other+2;
   }
  }
  cells.push(symbol,number);
 }
 return decorate({variantId:'number_one_20',symbolVersion:SPECIAL_SCRATCH_VERSION,cells,
  coinAmounts:[...amounts],symbolWeights:[...weights],hitPer1000},unlock);
}
export function drawDogJackpot9({draw,unlock=null}={}){
 if(typeof draw!=='function')throw Error('SCRATCH_SPECIAL_DRAW_REQUIRED');
 const roll=draw(1000);
 if(!Number.isInteger(roll)||roll<0||roll>=1000)throw Error('SCRATCH_SPECIAL_RANDOM_INVALID');
 const dogIndex=roll<DOG_JACKPOT_CHANCE_PER_1000?draw(DOG_JACKPOT_FIELD_COUNT):-1;
 if(dogIndex!==-1&&(!Number.isInteger(dogIndex)||dogIndex<0||dogIndex>=DOG_JACKPOT_FIELD_COUNT))
  throw Error('SCRATCH_SPECIAL_RANDOM_INVALID');
 const cells=Array.from({length:DOG_JACKPOT_FIELD_COUNT},(_,index)=>
  index===dogIndex?'DOG':pick(DOG_PRIZE_WEIGHTS,draw));
 return decorate({variantId:'dog_jackpot_9',symbolVersion:SPECIAL_SCRATCH_VERSION,cells},unlock);
}
export function verifySpecialScratch(board){
 try{
  if(board?.symbolVersion!==SPECIAL_SCRATCH_VERSION)return false;
  if(board.variantId==='number_one_20'&&board.coinAmounts!==undefined){
   const a=board.coinAmounts,w=board.symbolWeights,h=board.hitPer1000;
   if(!Array.isArray(a)||a.length!==3||a.some(n=>!Number.isInteger(n)||n<1||n>50000000)||
     !(a[0]<a[1]&&a[1]<a[2])||!Array.isArray(w)||w.length!==4||
     w.some(n=>!Number.isInteger(n)||n<0||n>1000)||w.reduce((x,y)=>x+y,0)!==1000||
     !Number.isInteger(h)||h<0||h>1000)return false;
  }
  const calculated=evaluateSpecialScratch(board);
  if(!Array.isArray(board.wins)||board.wins.length!==calculated.length)return false;
  let usedUnlock=false;
  const unlockIds=new Set();
  return board.wins.every((win,i)=>{
   const pattern=calculated[i],prize=win?.prize;
   if(win.rule!==pattern.rule||win.symbol!==pattern.symbol||
    JSON.stringify(win.indices)!==JSON.stringify(pattern.indices))return false;
   if(pattern.symbol==='🎁'){
    if(prize?.type==='unlock'){
     if(usedUnlock||typeof prize.prize?.unlockId!=='string'||
      !prize.prize.unlockId||typeof prize.prize.name!=='string'||
      !prize.prize.name||unlockIds.has(prize.prize.unlockId))return false;
     usedUnlock=true;unlockIds.add(prize.prize.unlockId);return prize.symbol==='🎁';
    }
    return prize?.type==='coins'&&prize.amount===1500&&prize.symbol==='🎁';
   }
   const payout=board.variantId==='number_one_20'&&Array.isArray(board.coinAmounts)?
    board.coinAmounts[icons.indexOf(pattern.symbol)]:money.get(pattern.symbol);
   return prize?.type==='coins'&&prize.symbol===pattern.symbol&&prize.amount===payout;
  });
 }catch{return false}
}
