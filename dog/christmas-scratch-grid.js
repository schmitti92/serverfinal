/**
 * DOG Christmas scratch: pure, server-safe grid rules.
 * No payout is inferred from a UI label; the board is the source of truth.
 * Phase 2: Geschenk-Linie 3x3 and Schneeflocken-Bingo 4x4.
 */
export const SCRATCH_GRID_VARIANTS=Object.freeze({
 gifts:Object.freeze({id:'gifts',name:'Geschenkelinie',size:3,winLength:3,cellCount:9}),
 snow:Object.freeze({id:'snow',name:'Schneeflocken-Bingo',size:4,winLength:4,cellCount:16})
});
const SYMBOLS=Object.freeze(['🎁','❄️','🔔','⭐','🍪','🦌','🎄','🍬']);
export function scratchLines(size){
 const lines=[];
 for(let r=0;r<size;r++)lines.push(Array.from({length:size},(_,c)=>r*size+c));
 for(let c=0;c<size;c++)lines.push(Array.from({length:size},(_,r)=>r*size+c));
 lines.push(Array.from({length:size},(_,i)=>i*size+i));
 lines.push(Array.from({length:size},(_,i)=>i*size+(size-1-i)));
 return lines;
}
export function evaluateScratchGrid(board){
 const spec=SCRATCH_GRID_VARIANTS[board?.variantId];
 if(!spec||!Array.isArray(board.cells)||board.cells.length!==spec.cellCount)throw Error('SCRATCH_GRID_INVALID');
 if(board.cells.some(c=>!SYMBOLS.includes(c)))throw Error('SCRATCH_GRID_SYMBOL_INVALID');
 return scratchLines(spec.size).filter(indices=>indices.every(i=>board.cells[i]===board.cells[indices[0]]))
  .map(indices=>({indices,symbol:board.cells[indices[0]]}));
}
const shuffle=(values,draw)=>{
 const a=[...values];
 for(let i=a.length-1;i>0;i--){const j=draw(i+1);if(!Number.isInteger(j)||j<0||j>i)throw Error('SCRATCH_RANDOM_INVALID');[a[i],a[j]]=[a[j],a[i]]}
 return a;
};
/**
 * desiredLines: 0 or 1. Returns a validated board with exactly that many
 * complete lines. Each winning line can be paired with a separate payout.
 * draw(max) must be a cryptographically secure integer in [0,max).
 */
export function generateScratchGrid(variantId,desiredLines,{draw,maxAttempts=12000}={}){
 const spec=SCRATCH_GRID_VARIANTS[variantId];
 if(!spec||![0,1].includes(desiredLines)||typeof draw!=='function')throw Error('SCRATCH_GRID_REQUEST_INVALID');
 const lines=scratchLines(spec.size);
 for(let attempt=0;attempt<maxAttempts;attempt++){
  const cells=Array.from({length:spec.cellCount},()=>SYMBOLS[draw(SYMBOLS.length)]);
  if(desiredLines===1){
   const target=lines[draw(lines.length)],symbol=SYMBOLS[draw(SYMBOLS.length)];
   for(const i of target)cells[i]=symbol;
  }
  const board={variantId,cells};
  const wins=evaluateScratchGrid(board);
  if(wins.length===desiredLines)return {...board,wins};
 }
 throw Error('SCRATCH_GRID_GENERATION_FAILED');
}
export function validateScratchGrid(board,expectedWinCount){
 const wins=evaluateScratchGrid(board);
 return wins.length===expectedWinCount&&
  (!board.wins||JSON.stringify(board.wins)===JSON.stringify(wins));
}
