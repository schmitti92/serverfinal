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
import {SCRATCH_GIFT_SYMBOLS} from './christmas-scratch-symbols.js';

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
// New tickets retain the 27-cell milestone rules, but monetary icons
// and the gift icon always identify the corresponding real reward.
const P27_MONEY=Object.freeze(['🪙','💵','💼']);
const P27_PRIZES=Object.freeze([...P27_MONEY,...SCRATCH_GIFT_SYMBOLS]);
function evaluatePremium27V2(board){
 const cells=board.cells;
 const permitted=[...PREMIUM_27_SYMBOLS.filter(s=>s!=='🎁'),...P27_MONEY,'🎁',PREMIUM_27_DUD];
 if(cells.some(s=>!permitted.includes(s)))throw Error('PREMIUM27_SYMBOL_INVALID');
 const realIndices=cells.flatMap((s,i)=>s!==PREMIUM_27_DUD?[i]:[]);
 const milestones=board.milestoneSymbols;
 if(!milestones||typeof milestones!=='object')throw Error('PREMIUM27_MILESTONE_INVALID');
 const wins=[];
 if(realIndices.length>=20){
  if(!P27_MONEY.includes(milestones.gold))throw Error('PREMIUM27_GOLD_SYMBOL_INVALID');
  wins.push(match(realIndices.slice(0,20),milestones.gold,'gold-20'));
 }else if(milestones.gold!==null)throw Error('PREMIUM27_GOLD_SYMBOL_INVALID');
 if(realIndices.length>=24){
  if(milestones.premium!=='🎁')throw Error('PREMIUM27_UNLOCK_SYMBOL_INVALID');
  wins.push(match(realIndices.slice(0,24),'🎁','premium-24'));
 }else if(milestones.premium!==null)throw Error('PREMIUM27_UNLOCK_SYMBOL_INVALID');
 for(let r=0;r<9;r++){
  const at=r*3,symbol=cells[at],indices=[at,at+1,at+2];
  if(P27_PRIZES.includes(symbol)&&cells[at+1]===symbol&&cells[at+2]===symbol)
   wins.push(match(indices,symbol,'row-3'));
 }
 return wins;
}

// v3 preserves both premium milestones but requires three IDENTICAL gift
// icons in a horizontal row for the 24-field unlock. A mixture is a miss.
// Older v2 receipts keep their original 24-field-only rule.
function evaluatePremium27V3(board){
 const cells=board.cells;
 const permitted=[...PREMIUM_27_SYMBOLS.filter(s=>s!=='🎁'),...P27_PRIZES,PREMIUM_27_DUD];
 if(cells.some(s=>!permitted.includes(s)))throw Error('PREMIUM27_SYMBOL_INVALID');
 const realIndices=cells.flatMap((symbol,i)=>symbol!==PREMIUM_27_DUD?[i]:[]);
 const milestones=board.milestoneSymbols;
 if(!milestones||typeof milestones!=='object')throw Error('PREMIUM27_MILESTONE_INVALID');
 const wins=[];
 if(realIndices.length>=20){
  if(!P27_MONEY.includes(milestones.gold))throw Error('PREMIUM27_GOLD_SYMBOL_INVALID');
  wins.push(match(realIndices.slice(0,20),milestones.gold,'gold-20'));
 }else if(milestones.gold!==null)throw Error('PREMIUM27_GOLD_SYMBOL_INVALID');
 let matchedPremiumRow=-1;
 if(realIndices.length>=24){
  if(!SCRATCH_GIFT_SYMBOLS.includes(milestones.premium))throw Error('PREMIUM27_UNLOCK_SYMBOL_INVALID');
  for(let r=0;r<9;r++){
   const at=r*3;
   if(cells[at]===milestones.premium&&cells[at+1]===milestones.premium&&
     cells[at+2]===milestones.premium){matchedPremiumRow=r;break}
  }
  if(matchedPremiumRow<0)throw Error('PREMIUM27_UNLOCK_TRIPLE_MISSING');
  const at=matchedPremiumRow*3;
  wins.push(match([at,at+1,at+2],milestones.premium,'premium-24'));
 }else if(milestones.premium!==null)throw Error('PREMIUM27_UNLOCK_SYMBOL_INVALID');
 for(let r=0;r<9;r++){
  const at=r*3,symbol=cells[at],indices=[at,at+1,at+2];
  if(r!==matchedPremiumRow&&P27_PRIZES.includes(symbol)&&
    cells[at+1]===symbol&&cells[at+2]===symbol)
   wins.push(match(indices,symbol,'row-3'));
 }
 return wins;
}
function generatePremium27V3(prizes,{draw,maxAttempts}){
 const money=prizes.filter(p=>p.type==='coins'),unlocks=prizes.filter(p=>p.type==='unlock');
 if(prizes.some(p=>p.type==='coins'?!P27_MONEY.includes(p.symbol):
    !SCRATCH_GIFT_SYMBOLS.includes(p.symbol))||
  money.some((p,i)=>money.some((q,j)=>i!==j&&p.symbol===q.symbol))||
  unlocks.some((p,i)=>unlocks.some((q,j)=>i!==j&&p.symbol===q.symbol))||
  unlocks.length>2||(unlocks.length>0&&money.length===0))
  throw Error('PREMIUM27_PRIZE_SYMBOL_INVALID');
 const baseMoney=money[0]||null,baseUnlock=unlocks[0]||null;
 const extras=prizes.filter(p=>p!==baseMoney&&p!==baseUnlock);
 const fixedRows=[...(baseUnlock?[baseUnlock]:[]),...extras];
 const targetReal=(baseUnlock?24:baseMoney?20:13)+choose(baseUnlock?4:baseMoney?4:7,draw);
 const filler=PREMIUM_27_SYMBOLS.filter(s=>s!=='🎁');
 for(let attempt=0;attempt<maxAttempts;attempt++){
  const cells=Array(27).fill(PREMIUM_27_DUD);
  const rows=randomOrder(Array.from({length:9},(_,r)=>r),draw).slice(0,fixedRows.length);
  fixedRows.forEach((prize,i)=>{
   const at=rows[i]*3;
   for(let c=0;c<3;c++)cells[at+c]=prize.symbol;
  });
  const empty=randomOrder(cells.flatMap((s,i)=>s===PREMIUM_27_DUD?[i]:[]),draw);
  for(let i=0;i<targetReal-fixedRows.length*3;i++)
   cells[empty[i]]=filler[choose(filler.length,draw)];
  const board={variantId:PREMIUM_27_ID,symbolVersion:3,
   milestoneSymbols:{gold:baseMoney?.symbol||null,premium:baseUnlock?.symbol||null},cells};
  const wins=evaluatePremium27V3(board);
  if(wins.length!==prizes.length)continue;
  const used=new Set();
  const bound=wins.map(w=>{
   const index=prizes.findIndex((p,i)=>!used.has(i)&&p.symbol===w.symbol&&
    (w.rule==='gold-20'?p===baseMoney:
     w.rule==='premium-24'?p===baseUnlock:true));
   if(index<0)return null;
   used.add(index);
   return {...w,prize:prizes[index]};
  });
  if(bound.some(w=>!w)||used.size!==prizes.length)continue;
  return {...board,wins:bound};
 }
 throw Error('PREMIUM27_SYMBOL_BOARD_GENERATION_FAILED');
}

function generatePremium27V2(prizes,{draw,maxAttempts}){
 const money=prizes.filter(p=>p.type==='coins'),unlocks=prizes.filter(p=>p.type==='unlock');
 if(prizes.some(p=>p.type==='coins'?!P27_MONEY.includes(p.symbol):p.symbol!=='🎁')||
  money.some((p,i)=>money.some((q,j)=>i!==j&&p.symbol===q.symbol))||
  unlocks.length>2||unlocks.length>0&&money.length===0)
  throw Error('PREMIUM27_PRIZE_SYMBOL_INVALID');
 const baseMoney=money[0]||null,baseUnlock=unlocks[0]||null;
 const extra=prizes.filter(p=>p!==baseMoney&&p!==baseUnlock);
 const minReal=baseUnlock?24:baseMoney?20:13;
 const targetReal=minReal+choose(baseUnlock?4:baseMoney?4:7,draw);
 for(let attempt=0;attempt<maxAttempts;attempt++){
  const cells=Array(27).fill(PREMIUM_27_DUD);
  const rows=randomOrder(Array.from({length:9},(_,i)=>i),draw).slice(0,extra.length);
  extra.forEach((prize,i)=>{for(let col=0;col<3;col++)cells[rows[i]*3+col]=prize.symbol});
  const available=randomOrder(cells.flatMap((s,i)=>s===PREMIUM_27_DUD?[i]:[]),draw);
  const fillers=PREMIUM_27_SYMBOLS.filter(s=>s!=='🎁');
  const additional=targetReal-extra.length*3;
  for(let i=0;i<additional;i++)cells[available[i]]=fillers[choose(fillers.length,draw)];
  const board={variantId:PREMIUM_27_ID,symbolVersion:2,
   milestoneSymbols:{gold:baseMoney?.symbol||null,premium:baseUnlock?'🎁':null},cells};
  const wins=evaluatePremium27V2(board);
  if(wins.length!==prizes.length)continue;
  const consumed=new Set();
  const bound=wins.map(w=>{
   const i=prizes.findIndex((p,j)=>!consumed.has(j)&&p.symbol===w.symbol&&
    (w.rule==='gold-20'?p===baseMoney:w.rule==='premium-24'?p===baseUnlock:true));
   if(i<0)return null;
   consumed.add(i);return {...w,prize:prizes[i]};
  });
  if(bound.some(w=>!w)||consumed.size!==prizes.length)continue;
  return {...board,wins:bound};
 }
 throw Error('PREMIUM27_SYMBOL_BOARD_GENERATION_FAILED');
}

export function evaluatePremium27(board){
 if(board?.variantId!==PREMIUM_27_ID||!Array.isArray(board.cells)||board.cells.length!==27)
  throw Error('PREMIUM27_GRID_INVALID');
 if(board.symbolVersion===3)return evaluatePremium27V3(board);
 if(board.symbolVersion===2)return evaluatePremium27V2(board);
 if(board.symbolVersion!==undefined)throw Error('PREMIUM27_VERSION_INVALID');
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
 if(prizes.every(p=>typeof p.symbol==='string'))
  return generatePremium27V3(prizes,{draw,maxAttempts});
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
   if([2,3].includes(board.symbolVersion)&&
    (p?.symbol!==w.symbol||
     (p?.type==='coins'&&!P27_MONEY.includes(p.symbol))||
     (p?.type==='unlock'&&!(board.symbolVersion===2?p.symbol==='🎁':SCRATCH_GIFT_SYMBOLS.includes(p.symbol)))))return false;
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
