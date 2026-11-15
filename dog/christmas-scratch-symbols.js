/**
 * Rubbellose v2: the icon printed on a winning combination IS the prize.
 * Old receipts without symbolVersion remain evaluated by the legacy rules.
 *
 * 🪙 = small coins, 💵 = banknotes, 💼 = money case,
 * 🎁 = one collectible unlock (two separate gift matches can pay twice).
 */
export const SCRATCH_PAYOUT_SYMBOLS=Object.freeze({
 coin:'🪙',banknote:'💵',case:'💼',unlock:'🎁'
});
export const SCRATCH_PAYOUT_ORDER=Object.freeze(Object.values(SCRATCH_PAYOUT_SYMBOLS));
export const SCRATCH_PAYOUT_VERSION=2;
const DECOR=Object.freeze(['❄️','🔔','⭐','🍪','🦌','🎄','🍬','🌙','🧤','🕯️']);
const ICE='🧊';
const TYPES=Object.freeze({gifts:9,snow_collect:16,elf:20,tree:15});

const randint=(max,draw)=>{
 const value=draw(max);
 if(!Number.isInteger(value)||value<0||value>=max)throw Error('SCRATCH_RANDOM_INVALID');
 return value;
};
const sample=(array,draw)=>array[randint(array.length,draw)];
const shuffle=(items,draw)=>{
 const a=[...items];
 for(let i=a.length-1;i>0;i--){
  const j=randint(i+1,draw);
  [a[i],a[j]]=[a[j],a[i]];
 }
 return a;
};
const match=(indices,symbol,rule)=>({indices,symbol,rule});
const lines3=[
 [0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],
 [2,5,8],[0,4,8],[2,4,6]
];

function elfNeighbors(i){
 const row=Math.floor(i/5),col=i%5;
 return [[row,col+1],[row+1,col],[row-1,col],[row,col-1]]
  .filter(([r,c])=>r>=0&&r<4&&c>=0&&c<5)
  .map(([r,c])=>r*5+c);
}
function elfPayoutPaths(cells){
 const wins=[];
 for(const symbol of SCRATCH_PAYOUT_ORDER){
  const seen=new Set();
  for(let index=0;index<20;index++){
   if(seen.has(index)||cells[index]!==symbol)continue;
   const component=[index];seen.add(index);
   for(let k=0;k<component.length;k++){
    for(const next of elfNeighbors(component[k])){
     if(!seen.has(next)&&cells[next]===symbol){
      seen.add(next);component.push(next);
     }
    }
   }
   const starts=component.filter(i=>i%5===0);
   if(!starts.length||!component.some(i=>i%5===4))continue;
   // The displayed path follows an actual orthogonal chain.
   const queue=starts.map(i=>({index:i,path:[i]}));
   const visited=new Set(starts);
   for(let k=0;k<queue.length;k++){
    const {index:at,path}=queue[k];
    if(at%5===4){wins.push(match(path,symbol,'path'));break}
    for(const next of elfNeighbors(at)){
     if(cells[next]===symbol&&!visited.has(next)){
      visited.add(next);queue.push({index:next,path:[...path,next]});
     }
    }
   }
  }
 }
 return wins;
}
export function evaluatePayoutGrid(board){
 const variantId=board?.variantId,cells=board?.cells;
 if(!Object.hasOwn(TYPES,variantId)||!Array.isArray(cells)||cells.length!==TYPES[variantId])
  throw Error('SCRATCH_PAYOUT_BOARD_INVALID');
 const permitted=variantId==='snow_collect'?[...SCRATCH_PAYOUT_ORDER,...DECOR,ICE]:
  [...SCRATCH_PAYOUT_ORDER,...DECOR];
 if(cells.some(s=>typeof s!=='string'||!permitted.includes(s)))
  throw Error('SCRATCH_PAYOUT_SYMBOL_INVALID');
 switch(variantId){
  case 'gifts':
   return lines3.filter(line=>line.every(i=>cells[i]===cells[line[0]])&&
    SCRATCH_PAYOUT_ORDER.includes(cells[line[0]]))
    .map(line=>match(line,cells[line[0]],'line'));
  case 'snow_collect':
   return SCRATCH_PAYOUT_ORDER.flatMap(symbol=>{
    const locations=cells.flatMap((s,i)=>s===symbol?[i]:[]);
    // Each visible triple is its own reward. A rare second gift trio
    // grants a second distinct unlock; non-gift icons cannot repeat.
    const count=symbol==='🎁'?Math.floor(locations.length/3):locations.length>=3?1:0;
    return Array.from({length:count},(_,i)=>match(
     locations.slice(i*3,i*3+3),symbol,'three-anywhere'));
   });
  case 'elf':return elfPayoutPaths(cells);
  case 'tree':
   return [0,3,6,9,12].filter(i=>
    cells[i]==='⭐'&&cells[i+1]==='🎄'&&SCRATCH_PAYOUT_ORDER.includes(cells[i+2]))
    .map(i=>match([i,i+1,i+2],cells[i+2],'star-tree-prize'));
  default:throw Error('SCRATCH_PAYOUT_VARIANT_INVALID');
 }
}
const identicalBag=(a,b)=>a.length===b.length&&
 [...a].sort().every((symbol,i)=>symbol===[...b].sort()[i]);
function buildGiftLines(symbols,draw){
 const cells=Array.from({length:9},()=>sample(DECOR,draw));
 const rows=shuffle([0,1,2],draw).slice(0,symbols.length);
 symbols.forEach((symbol,k)=>{for(let c=0;c<3;c++)cells[rows[k]*3+c]=symbol});
 return cells;
}
function buildSnowCollect(symbols,draw){
 const cells=symbols.flatMap(symbol=>[symbol,symbol,symbol]);
 const duds=4+randint(3,draw);
 for(let i=0;i<duds;i++)cells.push(ICE);
 while(cells.length<16)cells.push(sample(DECOR,draw));
 return shuffle(cells,draw);
}
function buildElf(symbols,draw){
 const cells=Array.from({length:20},()=>sample(DECOR,draw));
 const gifts=symbols.filter(s=>s==='🎁').length;
 let rows;
 if(gifts>=2){
  // Duplicate gifts must occupy independent, non-touching paths.
  const spaced=sample([[0,2],[0,3],[1,3]],draw);
  rows=[];
  let g=0;
  const other=shuffle([0,1,2,3].filter(r=>!spaced.includes(r)),draw);
  for(const symbol of symbols)rows.push(symbol==='🎁'?spaced[g++]:other.shift());
 }else rows=shuffle([0,1,2,3],draw).slice(0,symbols.length);
 const spare=new Set([0,1,2,3].filter(r=>!rows.includes(r)));
 symbols.forEach((symbol,k)=>{
  const row=rows[k];
  const adjacent=[row-1,row+1].filter(r=>spare.has(r));
  if(gifts<2&&adjacent.length&&randint(100,draw)<70){
   const second=sample(adjacent,draw);spare.delete(second);
   const start=randint(2,draw)===0?row:second;
   const end=start===row?second:row;
   for(let col=0;col<3;col++)cells[start*5+col]=symbol;
   for(let col=2;col<5;col++)cells[end*5+col]=symbol;
  }else for(let col=0;col<5;col++)cells[row*5+col]=symbol;
 });
 return cells;
}
function buildTree(symbols,draw){
 const cells=Array.from({length:15},()=>sample(DECOR,draw));
 const rows=shuffle([0,1,2,3,4],draw).slice(0,symbols.length);
 for(let r=0;r<5;r++){
  const i=r*3;
  // A tree ticket combines a star, a tree and one meaningful prize icon.
  // A gift cannot appear as the third icon unless it grants an unlock.
  cells[i]='⭐';cells[i+1]='🎄';cells[i+2]=sample(DECOR,draw);
 }
 symbols.forEach((symbol,k)=>{cells[rows[k]*3+2]=symbol});
 return cells;
}
const BUILDERS=Object.freeze({
 gifts:buildGiftLines,snow_collect:buildSnowCollect,elf:buildElf,tree:buildTree
});
export function generatePayoutGrid(variantId,prizeSymbols,draw,{maxAttempts=12000}={}){
 if(!Object.hasOwn(BUILDERS,variantId)||!Array.isArray(prizeSymbols)||
  prizeSymbols.length>3||!Number.isInteger(maxAttempts)||maxAttempts<1||
  prizeSymbols.some(s=>!SCRATCH_PAYOUT_ORDER.includes(s))||
  prizeSymbols.filter(s=>s==='🎁').length>2||
  ['🪙','💵','💼'].some(s=>prizeSymbols.filter(v=>v===s).length>1))
  throw Error('SCRATCH_PAYOUT_REQUEST_INVALID');
 for(let attempt=0;attempt<maxAttempts;attempt++){
  const cells=BUILDERS[variantId](prizeSymbols,draw);
  const board={variantId,symbolVersion:SCRATCH_PAYOUT_VERSION,cells};
  const wins=evaluatePayoutGrid(board);
  if(identicalBag(wins.map(w=>w.symbol),prizeSymbols))
   return {...board,wins};
 }
 throw Error('SCRATCH_PAYOUT_GENERATION_FAILED');
}
