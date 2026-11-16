/**
 * DOG Tic-Tac-Toe - independent 3x3 scratch-ticket rules.
 * Every reward is derived from immutable visible symbols on Render.
 * No Christmas-star symbol, no client-side prize selection.
 */
export const TIC_TAC_TOE_WEIGHTS=Object.freeze([
 Object.freeze({symbol:'🪙',weight:360,coins:200}),
 Object.freeze({symbol:'💵',weight:330,coins:450}),
 Object.freeze({symbol:'💼',weight:270,coins:800}),
 Object.freeze({symbol:'🎁',weight:40,coins:null})
]);
export const TIC_TAC_TOE_LINES=Object.freeze([
 [0,1,2],[3,4,5],[6,7,8],[0,3,6],
 [1,4,7],[2,5,8],[0,4,8],[2,4,6]
].map(line=>Object.freeze(line)));
const SYMBOLS=TIC_TAC_TOE_WEIGHTS.map(x=>x.symbol);
const BONUS_COINS=Object.freeze({double:250,multi:800,center:300,x:1000,corners:400,jackpot:20000});
const safeCells=cells=>Array.isArray(cells)&&cells.length===9&&cells.every(x=>SYMBOLS.includes(x));
export function evaluateTicTacToe(cells){
 if(!safeCells(cells))throw Error('TICTACTOE_BOARD_INVALID');
 return TIC_TAC_TOE_LINES.filter(indices=>indices.every(i=>cells[i]===cells[indices[0]]))
  .map(indices=>({indices:[...indices],symbol:cells[indices[0]],rule:'tic-line'}));
}
export function drawTicTacToe({draw,unlock=null}={}){
 if(typeof draw!=='function')throw Error('TICTACTOE_RANDOM_REQUIRED');
 const cells=Array.from({length:9},()=>{
  let roll=draw(1000);
  if(!Number.isInteger(roll)||roll<0||roll>=1000)throw Error('TICTACTOE_RANDOM_INVALID');
  for(const entry of TIC_TAC_TOE_WEIGHTS){
   if(roll<entry.weight)return entry.symbol;
   roll-=entry.weight;
  }
  throw Error('TICTACTOE_WEIGHTS_INVALID');
 });
 const lines=evaluateTicTacToe(cells),wins=[],winnings=[];
 let hasUnlock=false;
 for(const line of lines){
  const symbol=line.symbol;
  let prize;
  if(symbol==='🎁'&&!hasUnlock&&unlock?.unlockId){
   prize={type:'unlock',symbol,prize:{
    unlockId:unlock.unlockId,name:unlock.name,icon:unlock.icon,category:unlock.category
   }};
   hasUnlock=true;
  }else{
   const amount=symbol==='🎁'?1500:TIC_TAC_TOE_WEIGHTS.find(x=>x.symbol===symbol).coins;
   prize={type:'coins',symbol:symbol==='🎁'?'🪙':symbol,amount};
  }
  wins.push({...line,prize});winnings.push(prize);
 }
 const bonus=(kind,valid)=>{
  if(!valid)return;
  winnings.push({type:'coins',symbol:'🪙',amount:BONUS_COINS[kind],bonus:true,
   milestone:'tic-'+kind});
 };
 bonus('double',lines.length===2);
 bonus('multi',lines.length>=3);
 bonus('center',cells[4]==='💼'&&lines.some(line=>line.symbol==='💼'&&line.indices.includes(4)));
 bonus('x',lines.some(line=>line.indices.join(',')==='0,4,8')&&
           lines.some(line=>line.indices.join(',')==='2,4,6'));
 bonus('corners',[0,2,6,8].every(i=>cells[i]===cells[0]));
 bonus('jackpot',cells.every(symbol=>symbol===cells[0]));
 return {
  board:{variantId:'tic_tac_toe',symbolVersion:6,cells,wins},
  winnings,giftSparks:cells.filter(symbol=>symbol==='🎁').length>=2?1:0,
  unlockId:hasUnlock?unlock.unlockId:null
 };
}
export function verifyTicTacToe(board){
 try{
  if(board?.variantId!=='tic_tac_toe'||board.symbolVersion!==6)return false;
  const expected=evaluateTicTacToe(board.cells);
  if(!Array.isArray(board.wins)||board.wins.length!==expected.length)return false;
  let unlockCount=0;
  for(let i=0;i<expected.length;i++){
   const actual=board.wins[i],reference=expected[i],p=actual?.prize;
   if(actual.rule!==reference.rule||actual.symbol!==reference.symbol||
      JSON.stringify(actual.indices)!==JSON.stringify(reference.indices))return false;
   if(reference.symbol==='🎁'){
    if(p?.type==='unlock'){
     unlockCount++;
     if(!p.prize?.unlockId||typeof p.prize.name!=='string')return false;
    }else if(p?.type!=='coins'||p.amount!==1500)return false;
   }else if(p?.type!=='coins'||p.symbol!==reference.symbol||
    p.amount!==TIC_TAC_TOE_WEIGHTS.find(x=>x.symbol===reference.symbol).coins)return false;
  }
  return unlockCount<=1;
 }catch{return false}
}
