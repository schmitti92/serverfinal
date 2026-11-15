/**
 * Premium Christmas scratch card: 9 horizontal rows of 3 = 27 cells.
 * Visibility contract:
 *  - 20+ real symbols => one gold (coin) prize
 *  - 24+ real symbols => one premium unlock prize (and gold prize)
 *  - any row of three identical real symbols => one independently paid prize
 *  - 🧊 is a dud; it never matches
 * This pure module does not allocate any wallet credits.
 */
import {randomInt} from 'node:crypto';

export const PREMIUM_27_ID='premium_27';
export const PREMIUM_27_DUD='🧊';
export const PREMIUM_27_SYMBOLS=Object.freeze(['🎁','⭐','🔔','🎄','❄️','🍪','🦌','🍬','🧤','🕯️']);
export const PREMIUM_27_SPEC=Object.freeze({
 id:PREMIUM_27_ID,name:'Premium-Weihnachts-Rubbellos',
 rows:9,cols:3,cellCount:27,
 rule:'Drei gleiche Symbole waagerecht gewinnen; 20 Symbolfelder ergeben Gold, 24 eine Premium-Belohnung'
});
const choose=(max,draw)=>{
 const n=draw(max);
 if(!Number.isInteger(n)||n<0||n>=max)throw Error('PREMIUM27_RANDOM_INVALID');
 return n;
};
const randomSymbol=draw=>PREMIUM_27_SYMBOLS[choose(PREMIUM_27_SYMBOLS.length,draw)];
const randomOrder=(values,draw)=>{
 const a=[...values];
 for(let i=a.length-1;i>0;i--){const j=choose(i+1,draw);[a[i],a[j]]=[a[j],a[i]]}
 return a;
};
const isReal=s=>PREMIUM_27_SYMBOLS.includes(s);
const match=(indices,symbol,rule)=>({indices,symbol,rule});
export function evaluatePremium27(board){
 if(board?.variantId!==PREMIUM_27_ID||!Array.isArray(board.cells)||board.cells.length!==27)
  throw Error('PREMIUM27_GRID_INVALID');
 const cells=board.cells;
 if(cells.some(s=>s!==PREMIUM_27_DUD&&!isReal(s)))throw Error('PREMIUM27_SYMBOL_INVALID');
 const realIndices=cells.flatMap((s,i)=>isReal(s)?[i]:[]);
 const wins=[];
 if(realIndices.length>=20)wins.push(match(realIndices.slice(0,20),'🪙','gold-20'));
 if(realIndices.length>=24)wins.push(match(realIndices.slice(0,24),'💎','premium-24'));
 for(let r=0;r<9;r++){
  const start=r*3,indices=[start,start+1,start+2],symbol=cells[start];
  if(isReal(symbol)&&cells[start+1]===symbol&&cells[start+2]===symbol)
   wins.push(match(indices,symbol,'row-3'));
 }
 return wins;
}
export function generatePremium27(prizes,{draw=randomInt,maxAttempts=16000}={}){
 if(!Array.isArray(prizes)||prizes.length>3||
  prizes.some(p=>!p||!['coins','unlock'].includes(p.type))||
  !Number.isInteger(maxAttempts)||maxAttempts<1||typeof draw!=='function')
  throw Error('PREMIUM27_PRIZES_INVALID');
 const coins=prizes.filter(p=>p.type==='coins');
 const unlocks=prizes.filter(p=>p.type==='unlock');
 if(unlocks.length>0&&coins.length===0)throw Error('PREMIUM27_GOLD_MISSING');
 const desiredRows=prizes.length-(coins.length>0?1:0)-(unlocks.length>0?1:0);
 const targetNonblank=unlocks.length>0?24+choose(4,draw):coins.length>0?20+choose(4,draw):13+choose(7,draw);
 const targetSymbols=randomOrder(PREMIUM_27_SYMBOLS,draw);
 for(let attempt=0;attempt<maxAttempts;attempt++){
  const cells=Array(27).fill(PREMIUM_27_DUD);
  const winningRows=randomOrder(Array.from({length:9},(_,r)=>r),draw).slice(0,desiredRows);
  for(let w=0;w<winningRows.length;w++){
   for(let c=0;c<3;c++)cells[winningRows[w]*3+c]=targetSymbols[w];
  }
  const empty= randomOrder(cells.flatMap((v,i)=>v===PREMIUM_27_DUD?[i]:[]),draw);
  const additional=targetNonblank-desiredRows*3;
  for(let i=0;i<additional;i++)cells[empty[i]]=randomSymbol(draw);
  const board={variantId:PREMIUM_27_ID,cells};
  const wins=evaluatePremium27(board);
  if(wins.length!==prizes.length||wins.filter(w=>w.rule==='row-3').length!==desiredRows)continue;
  if((wins.some(w=>w.rule==='premium-24'))!==(unlocks.length>0))continue;
  if((wins.some(w=>w.rule==='gold-20'))!==(coins.length>0))continue;
  const remainingCoins=[...coins],remainingUnlocks=[...unlocks];
  const bound=wins.map(w=>{
   const pool=w.rule==='gold-20'?remainingCoins:
    w.rule==='premium-24'?remainingUnlocks:
    remainingCoins.length>0?remainingCoins:remainingUnlocks;
   const prize=pool.shift();
   if(!prize)throw Error('PREMIUM27_UNMATCHED_REWARD');
   return {...w,prize};
  });
  if(remainingCoins.length||remainingUnlocks.length)throw Error('PREMIUM27_REMAINDER');
  return {...board,wins:bound};
 }
 throw Error('PREMIUM27_GENERATION_FAILED');
}
export function verifyPremium27(board){
 try{
  const exact=evaluatePremium27(board);
  if(!Array.isArray(board?.wins)||board.wins.length!==exact.length)return false;
  let unlocks=new Set();
  return board.wins.every((w,i)=>{
   if(JSON.stringify(w.indices)!==JSON.stringify(exact[i].indices)||
     w.symbol!==exact[i].symbol||w.rule!==exact[i].rule)return false;
   const p=w.prize;
   if(w.rule==='gold-20'&&p?.type!=='coins')return false;
   if(w.rule==='premium-24'&&p?.type!=='unlock')return false;
   if(p?.type==='coins')return Number.isSafeInteger(p.amount)&&p.amount>0;
   if(p?.type!=='unlock'||!p.prize||typeof p.prize.unlockId!=='string'||
    !p.prize.unlockId||typeof p.prize.name!=='string'||!p.prize.name||
    unlocks.has(p.prize.unlockId))return false;
   unlocks.add(p.prize.unlockId);return true;
  });
 }catch{return false}
}
