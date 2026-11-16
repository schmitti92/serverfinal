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
  }else prize={type:'coins',symbol:pattern.symbol,amount:money.get(pattern.symbol)};
  return {...pattern,prize};
 });
 return {
  board:{...board,wins},
  winnings:wins.map(w=>w.prize),
  unlockId:usedUnlock?unlock.unlockId:null
 };
}
export function drawNumberOne20({draw,unlock=null}={}){
 if(typeof draw!=='function')throw Error('SCRATCH_SPECIAL_DRAW_REQUIRED');
 const cells=[];
 for(let i=0;i<NUMBER_ROW_COUNT;i++){
  const symbol=pick(NUMBER_PRIZE_WEIGHTS,draw);
  const roll=draw(10);
  if(!Number.isInteger(roll)||roll<0||roll>=10)throw Error('SCRATCH_SPECIAL_RANDOM_INVALID');
  cells.push(symbol,roll+1);
 }
 return decorate({variantId:'number_one_20',symbolVersion:SPECIAL_SCRATCH_VERSION,cells},unlock);
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
   return prize?.type==='coins'&&prize.symbol===pattern.symbol&&
    prize.amount===money.get(pattern.symbol);
  });
 }catch{return false}
}
