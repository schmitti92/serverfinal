/**
 * Lichtertal scratch cards — board generator and independent rule evaluator.
 *
 * Every emitted board is checked against what a player can actually see.
 * The winner count is derived ONLY from the revealed cells, never from
 * board.wins, requested count, or a payout flag.
 *
 * This is a pure rules module. Buying a ticket / granting prizes is separate.
 */
import {randomInt} from 'node:crypto';
import {SCRATCH_PAYOUT_ORDER,SCRATCH_PAYOUT_VERSION,evaluatePayoutGrid,generatePayoutGrid} from './christmas-scratch-symbols.js';
import {PREMIUM_27_SPEC,evaluatePremium27,generatePremium27,verifyPremium27} from './christmas-premium27.js';

const MAIN_SYMBOLS=Object.freeze(['🎁','❄️','🔔','⭐','🍪','🦌','🎄','🍬','🌙','🎅','🧤','🕯️']);
const STARS=Object.freeze(['⭐','🌟','✨','💫']);
const DEER=Object.freeze(['🦌','🦌🔴','🦌🔵','🦌🟡']);
const FILLERS=Object.freeze(['🍪','🎄','🧤','🍬','🔔','❄️','🎁','🕯️']);
const TREE_SEQUENCE=Object.freeze(['⭐','🎄','🎁']);
// This second normal ticket is NOT line bingo: 3 identical prizes anywhere.
// 🧊 is a non-winning blank even when it appears 3+ times.
const SNOW_COLLECT_SYMBOLS=Object.freeze(['❄️','🎁','⭐','🔔','🍬','🎄']);
const SNOW_DUD='🧊';
const BELL_DIAMOND=Object.freeze([2,6,8,11,13]);
const MODE_NAMES=Object.freeze({
 gifts:'Geschenkelinie',snow:'Schneeflocken-Bingo (alt)',snow_collect:'Schneeflocken-Bingo',stars:'Sternensammler',
 elf:'Wichtelpfad',reindeer:'Rentierglück',candy:'Zuckerstangen-Duell',
 tree:'Weihnachtsbaum-Los',cookie:'Lebkuchen-Memory',
 diamond:'Diamantenjagd',bells:'Glocken-Jackpot'
});
export const SCRATCH_GRID_VARIANTS=Object.freeze({
 premium_27:PREMIUM_27_SPEC,
 gifts:Object.freeze({id:'gifts',name:MODE_NAMES.gifts,rows:3,cols:3,size:3,winLength:3,cellCount:9,rule:'Drei gleiche Symbole in einer Reihe, Spalte oder Diagonale'}),
 snow:Object.freeze({id:'snow',name:MODE_NAMES.snow,rows:4,cols:4,size:4,winLength:4,cellCount:16,rule:'Vier gleiche Symbole in einer Reihe, Spalte oder Diagonale (altes Los)'}),
 snow_collect:Object.freeze({id:'snow_collect',name:MODE_NAMES.snow_collect,rows:4,cols:4,cellCount:16,winLength:3,rule:'Drei gleiche Gewinnsymbole irgendwo auf der Karte; pro Symbolart maximal ein Gewinn; Eiswürfel sind Nietenfelder'}),
 stars:Object.freeze({id:'stars',name:MODE_NAMES.stars,rows:3,cols:4,cellCount:12,rule:'Vier Sterne derselben Art sammeln; jede Vierergruppe zählt einmal'}),
 elf:Object.freeze({id:'elf',name:MODE_NAMES.elf,rows:4,cols:5,cellCount:20,rule:'Ein zusammenhängender Weg gleicher Symbole von links bis rechts'}),
 reindeer:Object.freeze({id:'reindeer',name:MODE_NAMES.reindeer,rows:3,cols:4,cellCount:12,rule:'Drei gleiche Rentiere beliebig auf dem Los; jede Dreiergruppe zählt einmal'}),
 candy:Object.freeze({id:'candy',name:MODE_NAMES.candy,rows:3,cols:2,cellCount:6,rule:'Jedes gleiche Paar in einer der drei Zweierreihen gewinnt'}),
 tree:Object.freeze({id:'tree',name:MODE_NAMES.tree,rows:5,cols:3,cellCount:15,rule:'Die Folge ⭐ 🎄 🎁 von links nach rechts in einer Dreierreihe'}),
 cookie:Object.freeze({id:'cookie',name:MODE_NAMES.cookie,rows:4,cols:4,cellCount:16,rule:'In einem 2×2-Feld müssen beide waagerechten Symbolpaare passen'}),
 diamond:Object.freeze({id:'diamond',name:MODE_NAMES.diamond,rows:3,cols:3,cellCount:9,rule:'Drei Diamanten beliebig auf dem Feld; jede Dreiergruppe gewinnt'}),
 bells:Object.freeze({id:'bells',name:MODE_NAMES.bells,rows:4,cols:5,cellCount:20,rule:'Fünf gleiche Symbole waagerecht oder fünf Glocken im Diamantmuster'})
});
// Four new-sale cards: two simple (200), one medium (500), one 27-cell premium (1000).
// Old IDs remain readable for previously purchased tickets.
export const SCRATCH_VARIANT_IDS=Object.freeze(['gifts','snow_collect','elf','premium_27']);
export const SCRATCH_VARIANT_IDS_BY_TIER=Object.freeze({
 simple:Object.freeze(['gifts','snow_collect']),
 medium:Object.freeze(['elf']),
 premium:Object.freeze(['premium_27'])
});
export const SCRATCH_ARCHIVED_VARIANT_IDS=Object.freeze(
 Object.keys(SCRATCH_GRID_VARIANTS).filter(id=>!SCRATCH_VARIANT_IDS.includes(id))
);
const random=(max,draw)=>{
 if(!Number.isSafeInteger(max)||max<1)throw Error('SCRATCH_RANDOM_RANGE');
 const value=draw(max);
 if(!Number.isInteger(value)||value<0||value>=max)throw Error('SCRATCH_RANDOM_INVALID');
 return value;
};
const sample=(pool,draw)=>pool[random(pool.length,draw)];
const arrayEq=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((v,i)=>v===b[i]);
const match=(indices,symbol,rule)=>({indices,symbol,rule});

export function scratchLines(size){
 if(!Number.isInteger(size)||size<2||size>8)throw Error('SCRATCH_GRID_SIZE_INVALID');
 const lines=[];
 for(let r=0;r<size;r++)lines.push(Array.from({length:size},(_,c)=>r*size+c));
 for(let c=0;c<size;c++)lines.push(Array.from({length:size},(_,r)=>r*size+c));
 lines.push(Array.from({length:size},(_,i)=>i*size+i));
 lines.push(Array.from({length:size},(_,i)=>i*size+(size-1-i)));
 return lines;
}
function groups(cells,symbols,count,rule){
 const wins=[];
 for(const symbol of symbols){
  const found=cells.flatMap((s,i)=>s===symbol?[i]:[]);
  for(let i=0;i+count<=found.length;i+=count)wins.push(match(found.slice(i,i+count),symbol,rule));
 }
 return wins;
}
function elfPaths(cells){
 // One winning path per symbol, from the left to the right border.
 // Breadth-first search guarantees a deterministically selected path.
 const rows=4,cols=5,wins=[];
 for(const symbol of MAIN_SYMBOLS){
  const queue=[],seen=new Set();
  for(let r=0;r<rows;r++){
   const i=r*cols;
   if(cells[i]===symbol){queue.push([i,[i]]);seen.add(i)}
  }
  while(queue.length){
   const [index,path]=queue.shift();
   if(index%cols===cols-1){wins.push(match(path,symbol,'path'));break}
   const r=Math.floor(index/cols),c=index%cols;
   const neighbors=[[r,c+1],[r+1,c],[r-1,c],[r,c-1]];
   for(const [y,x] of neighbors){
    if(y<0||y>=rows||x<0||x>=cols)continue;
    const n=y*cols+x;
    if(!seen.has(n)&&cells[n]===symbol){seen.add(n);queue.push([n,[...path,n]])}
   }
  }
 }
 return wins;
}
export function evaluateScratchGrid(board){
 const spec=SCRATCH_GRID_VARIANTS[board?.variantId];
 if(!spec||!Array.isArray(board.cells)||board.cells.length!==spec.cellCount)
  throw Error('SCRATCH_GRID_INVALID');
 if(board.variantId==='premium_27')return evaluatePremium27(board);
 if(board.symbolVersion===SCRATCH_PAYOUT_VERSION)return evaluatePayoutGrid(board);
 if(board.symbolVersion!==undefined)throw Error('SCRATCH_GRID_VERSION_INVALID');
 const cells=board.cells;
 const permitted=board.variantId==='snow_collect'?[...SNOW_COLLECT_SYMBOLS,SNOW_DUD]:
  board.variantId==='stars'?[...MAIN_SYMBOLS,...STARS]:
  board.variantId==='reindeer'?[...MAIN_SYMBOLS,...DEER]:
  board.variantId==='diamond'?[...MAIN_SYMBOLS,'💎']:
  MAIN_SYMBOLS;
 if(cells.some(s=>typeof s!=='string'||!permitted.includes(s)))
  throw Error('SCRATCH_GRID_SYMBOL_INVALID');
 switch(board.variantId){
  case 'gifts':case 'snow':
   return scratchLines(spec.size).filter(line=>line.every(i=>cells[i]===cells[line[0]]))
    .map(line=>match(line,cells[line[0]],'line'));
  case 'snow_collect':
   // One winning group per *symbol type*, never one group per extra trio.
   return SNOW_COLLECT_SYMBOLS.flatMap(symbol=>{
    const found=cells.flatMap((s,i)=>s===symbol?[i]:[]);
    return found.length>=3?[match(found.slice(0,3),symbol,'three-anywhere')]:[];
   });
  case 'stars':return groups(cells,STARS,4,'four-stars');
  case 'elf':return elfPaths(cells);
  case 'reindeer':return groups(cells,DEER,3,'three-reindeer');
  case 'candy':
   return [0,2,4].filter(i=>cells[i]===cells[i+1])
    .map(i=>match([i,i+1],cells[i],'pair'));
  case 'tree':
   return [0,3,6,9,12].filter(i=>TREE_SEQUENCE.every((symbol,j)=>cells[i+j]===symbol))
    .map(i=>match([i,i+1,i+2],'⭐🎄🎁','sequence'));
  case 'cookie':{
   const wins=[];
   for(const r of [0,2])for(const c of [0,2]){
    const a=r*4+c,b=a+1,d=a+4,e=d+1;
    if(cells[a]===cells[b]&&cells[d]===cells[e])
     wins.push(match([a,b,d,e],cells[a]+'+'+cells[d],'double-pair'));
   }
   return wins;
  }
  case 'diamond':return groups(cells,['💎'],3,'three-diamonds');
  case 'bells':{
   const wins=[];
   for(let r=0;r<4;r++){
    const line=Array.from({length:5},(_,c)=>r*5+c);
    if(line.every(i=>cells[i]===cells[line[0]]))
     wins.push(match(line,cells[line[0]],'five-line'));
   }
   if(BELL_DIAMOND.every(i=>cells[i]==='🔔'))
    wins.push(match([...BELL_DIAMOND],'🔔','bell-diamond'));
   return wins;
  }
  default:throw Error('SCRATCH_GRID_VARIANT_INVALID');
 }
}
function shuffle(values,draw){
 const cells=[...values];
 for(let i=cells.length-1;i>0;i--){
  const j=random(i+1,draw);
  [cells[i],cells[j]]=[cells[j],cells[i]];
 }
 return cells;
}
function linesBoard(spec,desired,draw){
 const cells=Array.from({length:spec.cellCount},()=>sample(MAIN_SYMBOLS,draw));
 const lines=scratchLines(spec.size);
 const chosen=shuffle(lines,draw).slice(0,desired);
 // All forced lines get the same symbol so intersecting lines stay valid.
 const symbol=sample(MAIN_SYMBOLS,draw);
 for(const line of chosen)for(const i of line)cells[i]=symbol;
 return cells;
}
function snowCollectBoard(desired,draw){
 // Exactly desired distinct triples; other symbols occur at most twice.
 // Four to six dud cells can occur on winning cards AND on actual blanks.
 const chosen=shuffle(SNOW_COLLECT_SYMBOLS,draw).slice(0,desired);
 const cells=chosen.flatMap(symbol=>[symbol,symbol,symbol]);
 const dudCount=4+random(3,draw);
 for(let i=0;i<dudCount;i++)cells.push(SNOW_DUD);
 const fillSymbols=shuffle(SNOW_COLLECT_SYMBOLS.filter(s=>!chosen.includes(s)),draw);
 let remain=16-cells.length;
 for(const symbol of fillSymbols){
  const count=Math.min(remain,2);
  for(let i=0;i<count;i++)cells.push(symbol);
  remain-=count;
  if(remain===0)break;
 }
 if(cells.length!==16)throw Error('SCRATCH_SNOW_COLLECT_FILL_ERROR');
 return shuffle(cells,draw);
}
function starBoard(desired,draw){
 const cells=[];
 for(const symbol of shuffle(STARS,draw).slice(0,desired))
  cells.push(symbol,symbol,symbol,symbol);
 const remaining=12-cells.length;
 const safe=STARS.filter(s=>!cells.includes(s));
 const extra=Math.min(remaining,random(4,draw));
 for(let i=0;i<extra;i++)cells.push(safe[i%safe.length]);
 while(cells.length<12)cells.push(sample(FILLERS,draw));
 return shuffle(cells,draw);
}
function reindeerBoard(desired,draw){
 const cells=[];
 for(const symbol of shuffle(DEER,draw).slice(0,desired))
  cells.push(symbol,symbol,symbol);
 const safe=DEER.filter(s=>!cells.includes(s));
 const extra=Math.min(12-cells.length,random(3,draw));
 for(let i=0;i<extra;i++)cells.push(safe[i%safe.length]);
 while(cells.length<12)cells.push(sample(FILLERS,draw));
 return shuffle(cells,draw);
}
function elfBoard(desired,draw){
 const rows=[0,1,2,3];
 const chosen=shuffle(rows,draw).slice(0,desired);
 const symbols=shuffle(MAIN_SYMBOLS,draw).slice(0,desired);
 // Never let filler fields extend a prize path or create a secret extra prize.
 const fillers=MAIN_SYMBOLS.filter(s=>!symbols.includes(s));
 const cells=Array.from({length:20},()=>sample(fillers,draw));
 const spareRows=new Set(rows.filter(r=>!chosen.includes(r)));
 for(let p=0;p<chosen.length;p++){
  const row=chosen[p],symbol=symbols[p];
  const neighbors=[row-1,row+1].filter(r=>spareRows.has(r));
  // The medium elf path should sometimes bend between rows rather than
  // always being a normal line bingo. Each detour consumes a spare lane.
  if(neighbors.length&&random(100,draw)<80){
   const nextRow=sample(neighbors,draw);
   spareRows.delete(nextRow);
   if(random(2,draw)===0){
    // Start on the adjacent row; turn into the selected row at column 3.
    for(let col=0;col<3;col++)cells[nextRow*5+col]=symbol;
    for(let col=2;col<5;col++)cells[row*5+col]=symbol;
   }else{
    // Start on the selected row; turn into the adjacent row at column 3.
    for(let col=0;col<3;col++)cells[row*5+col]=symbol;
    for(let col=2;col<5;col++)cells[nextRow*5+col]=symbol;
   }
  }else{
   for(let col=0;col<5;col++)cells[row*5+col]=symbol;
  }
 }
 return cells;
}
function candyBoard(desired,draw){
 const cells=Array.from({length:6},()=>sample(MAIN_SYMBOLS,draw));
 const chosen=shuffle([0,1,2],draw).slice(0,desired);
 for(let p=0;p<3;p++){
  const idx=p*2,symbol=sample(MAIN_SYMBOLS,draw);
  cells[idx]=symbol;
  cells[idx+1]=chosen.includes(p)?symbol:sample(MAIN_SYMBOLS.filter(s=>s!==symbol),draw);
 }
 return cells;
}
function treeBoard(desired,draw){
 const cells=Array.from({length:15},()=>sample(MAIN_SYMBOLS,draw));
 const chosen=shuffle([0,1,2,3,4],draw).slice(0,desired);
 for(let r=0;r<5;r++){
  const at=r*3;
  if(chosen.includes(r)){
   for(let c=0;c<3;c++)cells[at+c]=TREE_SEQUENCE[c];
  }else{
   // Deliberately break at least one position of the required sequence.
   const broken=random(3,draw);
   cells[at+broken]=sample(MAIN_SYMBOLS.filter(s=>s!==TREE_SEQUENCE[broken]),draw);
  }
 }
 return cells;
}
function cookieBoard(desired,draw){
 const cells=Array.from({length:16},()=>sample(MAIN_SYMBOLS,draw));
 const chosen=shuffle([0,1,2,3],draw).slice(0,desired);
 for(let b=0;b<4;b++){
  const row=Math.floor(b/2)*2,col=(b%2)*2;
  const a=row*4+col,d=a+4;
  const top=sample(MAIN_SYMBOLS,draw),bottom=sample(MAIN_SYMBOLS,draw);
  cells[a]=top;cells[a+1]=chosen.includes(b)?top:sample(MAIN_SYMBOLS.filter(s=>s!==top),draw);
  cells[d]=bottom;cells[d+1]=bottom;
 }
 return cells;
}
function diamondBoard(desired,draw){
 const cells=Array.from({length:desired*3},()=> '💎');
 while(cells.length<9)cells.push(sample(FILLERS,draw));
 return shuffle(cells,draw);
}
function bellsBoard(desired,draw){
 const cells=Array.from({length:20},()=>sample(MAIN_SYMBOLS,draw));
 const chosen=shuffle([0,1,2,3],draw).slice(0,desired);
 for(const r of chosen){
  const symbol=sample(MAIN_SYMBOLS,draw);
  for(let c=0;c<5;c++)cells[r*5+c]=symbol;
 }
 return cells;
}
const builders=Object.freeze({
 gifts:linesBoard,snow:linesBoard,snow_collect:snowCollectBoard,stars:starBoard,elf:elfBoard,
 reindeer:reindeerBoard,candy:candyBoard,tree:treeBoard,
 cookie:cookieBoard,diamond:diamondBoard,bells:bellsBoard
});
/**
 * Generate exactly 0–3 independently verifiable visible winning combinations.
 * draw(max) must return an unbiased integer in [0,max); crypto.randomInt is
 * used in production by default. All candidates are evaluated before return.
 */
export function generateScratchGrid(variantId,desiredLines,{draw=randomInt,maxAttempts=12000,prizeSymbols}={}){
 const spec=SCRATCH_GRID_VARIANTS[variantId];
 if(!spec||!Number.isInteger(desiredLines)||desiredLines<0||desiredLines>3||
  typeof draw!=='function'||!Number.isInteger(maxAttempts)||maxAttempts<1)
  throw Error('SCRATCH_GRID_REQUEST_INVALID');
 if(prizeSymbols!==undefined){
  if(!['gifts','snow_collect','elf'].includes(variantId)||
   !Array.isArray(prizeSymbols)||prizeSymbols.length!==desiredLines)
   throw Error('SCRATCH_PAYOUT_REQUEST_INVALID');
  return generatePayoutGrid(variantId,prizeSymbols,draw,{maxAttempts});
 }
 if(variantId==='premium_27'){
  const dummy=Array.from({length:desiredLines},(_,i)=>({type:'coins',amount:i+1}));
  const paid=generatePremium27(dummy,{draw,maxAttempts});
  return {...paid,wins:paid.wins.map(({prize,...win})=>win)};
 }
 for(let attempt=0;attempt<maxAttempts;attempt++){
  const candidate=builders[variantId](
   variantId==='gifts'||variantId==='snow'?spec:desiredLines,
   variantId==='gifts'||variantId==='snow'?desiredLines:draw,
   variantId==='gifts'||variantId==='snow'?draw:undefined
  );
  const board={variantId,cells:candidate};
  const wins=evaluateScratchGrid(board);
  if(wins.length===desiredLines)return {...board,wins};
 }
 throw Error('SCRATCH_GRID_GENERATION_FAILED');
}
export function validateScratchGrid(board,expectedWinCount){
 try{
  const wins=evaluateScratchGrid(board);
  return Number.isInteger(expectedWinCount)&&wins.length===expectedWinCount&&
   (!Object.hasOwn(board,'wins')||JSON.stringify(board.wins)===JSON.stringify(wins));
 }catch{return false}
}
/**
 * Bind each displayable prize to a verified match in the canonical order.
 * A money amount or unlock name must be rendered next to that match.
 */
export function attachScratchPrizes(board,prizes){
 if(!Array.isArray(prizes)||!validateScratchGrid(board,prizes.length))
  throw Error('SCRATCH_PRIZE_MATCH_MISMATCH');
 const wins=evaluateScratchGrid(board);
 const used=new Set();
 const lines=wins.map((win,index)=>{
  // New tickets must match the actual revealed icon, never a randomly
  // assigned prize index. Old receipts keep their original mapping.
  const prizeIndex=board.symbolVersion===SCRATCH_PAYOUT_VERSION?
   prizes.findIndex((p,i)=>!used.has(i)&&p?.symbol===win.symbol):index;
  if(prizeIndex<0)throw Error('SCRATCH_PAYOUT_SYMBOL_MISMATCH');
  used.add(prizeIndex);
  const prize=prizes[prizeIndex];
  if(board.variantId==='premium_27' && ((win.rule==='gold-20'&&prize?.type!=='coins')||(win.rule==='premium-24'&&prize?.type!=='unlock')))
   throw Error('PREMIUM27_PRIZE_RULE_MISMATCH');
  if(!prize||typeof prize!=='object'||!['coins','unlock'].includes(prize.type))
   throw Error('SCRATCH_PRIZE_INVALID');
  if(prize.type==='coins'&&(!Number.isSafeInteger(prize.amount)||prize.amount<1))
   throw Error('SCRATCH_PRIZE_COINS_INVALID');
  if(prize.type==='unlock'&&
   (typeof prize.prize?.unlockId!=='string'||typeof prize.prize?.name!=='string'))
   throw Error('SCRATCH_PRIZE_UNLOCK_INVALID');
  if(board.symbolVersion===SCRATCH_PAYOUT_VERSION&&
   (prize.symbol!==win.symbol||
    (prize.type==='coins'&&!SCRATCH_PAYOUT_ORDER.slice(0,3).includes(prize.symbol))||
    (prize.type==='unlock'&&prize.symbol!=='🎁')))
   throw Error('SCRATCH_PRIZE_SYMBOL_INVALID');
  return {...win,prize};
 });
 return {...board,wins:lines};
}
export function verifyScratchPrizes(board){
 if(board?.variantId==='premium_27')return verifyPremium27(board);
 try{
  const verified=evaluateScratchGrid(board);
  const unlockIds=new Set();
  return Array.isArray(board.wins)&&board.wins.length===verified.length&&
   board.wins.every((listed,i)=>{
    if(!arrayEq(listed.indices,verified[i].indices)||
      listed.symbol!==verified[i].symbol||listed.rule!==verified[i].rule)return false;
    const reward=listed.prize;
    if(board.symbolVersion===SCRATCH_PAYOUT_VERSION&&
     (reward?.symbol!==listed.symbol||
      (reward?.type==='coins'&&!SCRATCH_PAYOUT_ORDER.slice(0,3).includes(reward.symbol))||
      (reward?.type==='unlock'&&reward.symbol!=='🎁')))return false;
    if(reward?.type==='coins')return Number.isSafeInteger(reward.amount)&&reward.amount>0;
    if(reward?.type!=='unlock'||typeof reward.prize?.unlockId!=='string'||
      !reward.prize.unlockId||typeof reward.prize?.name!=='string'||
      !reward.prize.name||unlockIds.has(reward.prize.unlockId))return false;
    unlockIds.add(reward.prize.unlockId);
    return true;
   });
 }catch{return false}
}
