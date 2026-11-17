/**
 * DOG Tic-Tac-Toe Duell v8.
 * New sales use Circle/Cross + a ticket-wide 1×–5× multiplier.
 * The three revealed phases are independent server-chosen facts:
 * multiplier, winning sign and 3×3 board. Prize symbol is selected once
 * per ticket. Any of eight matching lines awards ONE base prize × multiplier.
 * Existing version 6 scratch tickets remain supported by legacy code.
 */
export const TIC_DUEL_VERSION=8;
export const TIC_DUEL_SIGNS=Object.freeze(['◯','✕']);
export const TIC_DUEL_REWARD_WEIGHTS=Object.freeze([
 Object.freeze({symbol:'🪙',weight:700,coins:200}),
 Object.freeze({symbol:'💵',weight:250,coins:450}),
 Object.freeze({symbol:'💼',weight:40,coins:800}),
 Object.freeze({symbol:'🎁',weight:10,coins:null})
]);
export const TIC_DUEL_LINES=Object.freeze([
 [0,1,2],[3,4,5],[6,7,8],
 [0,3,6],[1,4,7],[2,5,8],
 [0,4,8],[2,4,6]
].map(line=>Object.freeze(line)));
export const TIC_DUEL_GIFT_FALLBACK=1500;
const validDraw=(draw,max)=>{
 const value=draw(max);
 if(!Number.isInteger(value)||value<0||value>=max)throw Error('TIC_DUEL_RANDOM_INVALID');
 return value;
};
const rewardBySymbol=(s)=>TIC_DUEL_REWARD_WEIGHTS.find(row=>row.symbol===s);
export function validateTicDuelEditionSettings(s){
 if(!s||typeof s!=='object'||Array.isArray(s))throw Error('EDITION_TIC_SETTINGS_INVALID');
 const amounts=s.coinAmounts,weights=s.symbolWeights;
 if(!Array.isArray(amounts)||amounts.length!==3||
  amounts.some(n=>!Number.isSafeInteger(n)||n<1||n>50000000)||
  !(amounts[0]<amounts[1]&&amounts[1]<amounts[2])||
  !Array.isArray(weights)||weights.length!==4||
  weights.some(n=>!Number.isInteger(n)||n<0||n>1000)||
  weights.reduce((a,b)=>a+b,0)!==1000||
  !Number.isInteger(s.maxMultiplier)||s.maxMultiplier<1||s.maxMultiplier>5||
  !Number.isInteger(s.giftFallbackCoins)||s.giftFallbackCoins<0||
  s.giftFallbackCoins>50000000)throw Error('EDITION_TIC_SETTINGS_INVALID');
 return {coinAmounts:[...amounts],symbolWeights:[...weights],
  maxMultiplier:s.maxMultiplier,giftFallbackCoins:s.giftFallbackCoins};
}

export function evaluateTicTacToeDuel(board){
 if(board?.symbolVersion!==TIC_DUEL_VERSION||
  !TIC_DUEL_SIGNS.includes(board.winningSymbol)||
  !Number.isInteger(board.multiplier)||board.multiplier<1||board.multiplier>5||
  !rewardBySymbol(board.prizeSymbol)||!Array.isArray(board.cells)||board.cells.length!==9||
  board.cells.some(sign=>!TIC_DUEL_SIGNS.includes(sign)))
  throw Error('TIC_DUEL_BOARD_INVALID');
 return TIC_DUEL_LINES
  .filter(indices=>indices.every(index=>board.cells[index]===board.winningSymbol))
  .map(indices=>({indices:[...indices],symbol:board.winningSymbol,rule:'tic-duel-line'}));
}
export function drawTicTacToeDuel({draw,unlock=null,settings=null}={}){
 if(typeof draw!=='function')throw Error('TIC_DUEL_DRAW_REQUIRED');
 const custom=settings===null?null:validateTicDuelEditionSettings(settings);
 const weights=custom?.symbolWeights??TIC_DUEL_REWARD_WEIGHTS.map(row=>row.weight);
 const amounts=custom?.coinAmounts??TIC_DUEL_REWARD_WEIGHTS.slice(0,3).map(row=>row.coins);
 const fallback=custom?.giftFallbackCoins??TIC_DUEL_GIFT_FALLBACK;
 const multiplier=1+validDraw(draw,custom?.maxMultiplier??5);
 const winningSymbol=TIC_DUEL_SIGNS[validDraw(draw,2)];
 const prizeRoll=validDraw(draw,1000);
 let cursor=prizeRoll,prizeSymbol=null;
 for(const [i,reward] of TIC_DUEL_REWARD_WEIGHTS.entries()){
  if(cursor<weights[i]){prizeSymbol=reward.symbol;break}
  cursor-=weights[i];
 }
 if(!prizeSymbol)throw Error('TIC_DUEL_WEIGHTS_INVALID');
 const cells=Array.from({length:9},()=>TIC_DUEL_SIGNS[validDraw(draw,2)]);
 const board={variantId:'tic_tac_toe',symbolVersion:TIC_DUEL_VERSION,
  cells,multiplier,winningSymbol,prizeSymbol,wins:[],
  ...(custom?{coinAmounts:[...amounts],symbolWeights:[...weights],
   giftFallbackCoins:fallback,maxMultiplier:custom.maxMultiplier}:{})};
 const paths=evaluateTicTacToeDuel(board);
 const winnings=[];
 if(paths.length){
  const reward=rewardBySymbol(prizeSymbol);
  if(prizeSymbol==='🎁'&&unlock?.unlockId){
   winnings.push({type:'unlock',symbol:'🎁',prize:{
    unlockId:unlock.unlockId,name:unlock.name,icon:unlock.icon,category:unlock.category
   }});
  }else{
   winnings.push({type:'coins',symbol:prizeSymbol==='🎁'?'🪙':prizeSymbol,
    amount:(prizeSymbol==='🎁'?fallback:amounts[TIC_DUEL_REWARD_WEIGHTS.findIndex(row=>row.symbol===prizeSymbol)])*multiplier});
  }
 }
 board.wins=paths.map(path=>({...path,prize:winnings[0]?{...winnings[0]}:undefined}));
 return {board,winnings,unlockId:winnings[0]?.type==='unlock'?unlock.unlockId:null,giftSparks:0};
}
export function verifyTicTacToeDuel(board){
 try{
  if(board?.variantId!=='tic_tac_toe'||board?.symbolVersion!==TIC_DUEL_VERSION)return false;
  const expected=evaluateTicTacToeDuel(board);
  if(!Array.isArray(board.wins)||board.wins.length!==expected.length)return false;
  const custom=board.coinAmounts!==undefined?
   validateTicDuelEditionSettings({coinAmounts:board.coinAmounts,
    symbolWeights:board.symbolWeights,maxMultiplier:board.maxMultiplier,
    giftFallbackCoins:board.giftFallbackCoins}):null;
  const amounts=custom?.coinAmounts??TIC_DUEL_REWARD_WEIGHTS.slice(0,3).map(row=>row.coins);
  const amount=(board.prizeSymbol==='🎁'?(custom?.giftFallbackCoins??TIC_DUEL_GIFT_FALLBACK):
   amounts[TIC_DUEL_REWARD_WEIGHTS.findIndex(row=>row.symbol===board.prizeSymbol)])*board.multiplier;
  for(let i=0;i<expected.length;i++){
   const actual=board.wins[i],match=expected[i],prize=actual?.prize;
   if(actual.rule!=='tic-duel-line'||actual.symbol!==match.symbol||
    JSON.stringify(actual.indices)!==JSON.stringify(match.indices))return false;
   if(board.prizeSymbol==='🎁'&&prize?.type==='unlock'){
    if(!prize.prize?.unlockId||typeof prize.prize.name!=='string'||!prize.prize.name||
     prize.symbol!=='🎁')return false;
   }else if(prize?.type!=='coins'||prize.amount!==amount||
    prize.symbol!==(board.prizeSymbol==='🎁'?'🪙':board.prizeSymbol))return false;
   if(i>0&&JSON.stringify(board.wins[i].prize)!==JSON.stringify(board.wins[0].prize))
    return false;
  }
  return true;
 }catch{return false}
}
