import test from 'node:test';
import assert from 'node:assert/strict';
import {
 TIC_DUEL_VERSION,TIC_DUEL_SIGNS,TIC_DUEL_REWARD_WEIGHTS,
 evaluateTicTacToeDuel,drawTicTacToeDuel,verifyTicTacToeDuel
} from '../dog/christmas-tictactoe-duel.js';
import {verifyScratchPrizes,evaluateScratchGrid} from '../dog/christmas-scratch-grid.js';
import {buyScratchTicket,DOG_SCRATCH_START_COINS} from '../dog/christmas-scratch.js';

const zero=()=>0;
test('new Tic-Tac-Toe ticket reveals 1×, circle, and nine symbols in order',()=>{
 const drawn=drawTicTacToeDuel({draw:zero});
 const b=drawn.board;
 assert.equal(b.variantId,'tic_tac_toe');
 assert.equal(b.symbolVersion,TIC_DUEL_VERSION);
 assert.equal(b.multiplier,1);
 assert.equal(b.winningSymbol,'◯');
 assert.deepEqual(b.cells,Array.from({length:9},()=> '◯'));
 assert.equal(b.wins.length,8);
 assert.equal(evaluateTicTacToeDuel(b).length,8);
 assert.equal(evaluateScratchGrid(b).length,8);
 assert.equal(drawn.winnings.length,1,'Eight matching lines pay ONE prize');
 assert.equal(drawn.winnings[0].amount,200);
 assert.equal(verifyTicTacToeDuel(b),true);
 assert.equal(verifyScratchPrizes(b),true);
});

test('duel can choose Kreuz and 5×, with no duplicate payout for eight lines',()=>{
 const draw=max=>max===5?4:max===2?1:0;
 const b=drawTicTacToeDuel({draw});
 assert.equal(b.board.winningSymbol,'✕');
 assert.equal(b.board.multiplier,5);
 assert.equal(b.board.wins.length,8);
 assert.deepEqual(b.winnings.map(p=>p.amount),[1000]);
});

test('a complete grid without a winning-symbol line yields an actual Niete',()=>{
 let count=0;
 const draw=max=>max===2?(count++===0?0:1):0;
 const b=drawTicTacToeDuel({draw});
 assert.equal(b.board.winningSymbol,'◯');
 assert.deepEqual(b.board.cells,Array.from({length:9},()=> '✕'));
 assert.equal(b.board.wins.length,0);
 assert.deepEqual(b.winnings,[]);
 assert.equal(verifyTicTacToeDuel(b.board),true);
});

test('gift activates one unlock regardless of multiplier or winning-line count',()=>{
 const unlock={unlockId:'christmas2026:avatar:test',name:'Winter-Profil',icon:'🎁',category:'avatars'};
 const draw=max=>max===5?4:max===1000?995:0;
 const drawn=drawTicTacToeDuel({draw,unlock});
 assert.equal(drawn.board.multiplier,5);
 assert.ok(['🎁','💝','🎀','🧧','🛍️'].includes(drawn.board.prizeSymbol));
 assert.equal(drawn.winnings[0].symbol,drawn.board.prizeSymbol);
 assert.equal(drawn.board.wins.length,8);
 assert.equal(drawn.winnings.length,1);
 assert.equal(drawn.winnings[0].type,'unlock');
 assert.equal(drawn.unlockId,unlock.unlockId);
 assert.equal(verifyScratchPrizes(drawn.board),true);
 const noUnlock=drawTicTacToeDuel({draw});
 assert.deepEqual(noUnlock.winnings.map(p=>p.amount),[7500]);
 assert.equal(noUnlock.unlockId,null);
 assert.equal(verifyTicTacToeDuel(noUnlock.board),true);
});

test('server rejects altered multiplier, winner, line or prize amount',()=>{
 const board=drawTicTacToeDuel({draw:zero}).board;
 for(const forged of [
  {...board,multiplier:6},
  {...board,winningSymbol:'⭐'},
  {...board,cells:board.cells.map(()=> '⭕')},
  {...board,wins:[...board.wins].reverse()},
  {...board,wins:board.wins.map((w,i)=>i? w:{...w,prize:{type:'coins',symbol:'🪙',amount:999999}})}
 ])assert.equal(verifyTicTacToeDuel(forged),false);
 assert.deepEqual(TIC_DUEL_SIGNS,['◯','✕']);
 assert.equal(TIC_DUEL_REWARD_WEIGHTS.reduce((sum,row)=>sum+row.weight,0),1000);
});

test('new purchase commits one receipt and refresh cannot buy it twice',()=>{
 const request={tier:'medium',variantId:'tic_tac_toe',commandId:'duel-11-cells'};
 const options={draw:zero,now:()=>Date.parse('2026-11-16T21:30:00Z')};
 const first=buyScratchTicket(null,null,request,options);
 assert.equal(first.result.board.symbolVersion,8);
 assert.equal(first.result.totalCoins,200);
 assert.equal(first.wallet.coins,DOG_SCRATCH_START_COINS-500+200);
 assert.equal(first.status.progress.byVariant.tic_tac_toe.opened,1);
 const replay=buyScratchTicket(first.wallet,null,request,
  {...options,draw:()=>{throw Error('REROLL_BLOCKED')}});
 assert.equal(replay.unchanged,true);
 assert.equal(replay.result.commandId,request.commandId);
 assert.deepEqual(replay.result,first.result);
 assert.equal(replay.wallet.coins,first.wallet.coins);
});
