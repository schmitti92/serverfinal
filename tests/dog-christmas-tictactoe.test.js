import test from 'node:test';
import assert from 'node:assert/strict';
import {drawTicTacToe,verifyTicTacToe,evaluateTicTacToe,TIC_TAC_TOE_WEIGHTS} from '../dog/christmas-tictactoe.js';
import {buyScratchTicket,DOG_SCRATCH_START_COINS} from '../dog/christmas-scratch.js';

const fixed=(roll)=>max=>max===1000?roll:0;
const commandId='tic-test-ticket-001';

test('Tic-Tac-Toe has only four symbols and eight possible matching lines',()=>{
 assert.deepEqual(TIC_TAC_TOE_WEIGHTS.map(v=>v.symbol),['🪙','💵','💼','🎁']);
 assert.equal(TIC_TAC_TOE_WEIGHTS.reduce((n,v)=>n+v.weight,0),1000);
 const drawn=drawTicTacToe({draw:fixed(0)});
 assert.equal(drawn.board.cells.length,9);
 assert.equal(drawn.board.wins.length,8);
 assert.equal(evaluateTicTacToe(drawn.board.cells).length,8);
 assert.equal(drawn.winnings.filter(w=>w.bonus&&w.milestone==='tic-jackpot').length,1);
 assert.equal(drawn.winnings.filter(w=>w.bonus&&w.milestone==='tic-multi').length,1);
 assert.equal(drawn.winnings.filter(w=>w.bonus&&w.milestone==='tic-x').length,1);
 assert.equal(drawn.winnings.filter(w=>w.bonus&&w.milestone==='tic-corners').length,1);
 assert.equal(drawn.winnings.reduce((s,w)=>s+(w.type==='coins'?w.amount:0),0),23800);
 assert.equal(verifyTicTacToe(drawn.board),true);
 assert.equal(verifyTicTacToe({...drawn.board,cells:drawn.board.cells.map(()=> '⭐')}),false);
});

test('server settles nine-symbol ticket and replays the same receipt without charging twice',()=>{
 const request={tier:'medium',variantId:'tic_tac_toe',commandId};
 const options={draw:fixed(0),now:()=>Date.parse('2026-11-16T16:00:00Z')};
 const first=buyScratchTicket(null,null,request,options);
 assert.equal(first.result.price,500);
 assert.equal(first.result.board.symbolVersion,8);
 assert.equal(first.result.board.multiplier,1);
 assert.equal(first.result.board.winningSymbol,'◯');
 assert.equal(first.result.board.wins.length,8);
 assert.equal(first.result.winnings.length,1);
 assert.equal(first.result.totalCoins,200);
 assert.equal(first.wallet.coins,DOG_SCRATCH_START_COINS-500+200);
 assert.equal(first.status.progress.byVariant.tic_tac_toe.opened,1);
 const again=buyScratchTicket(first.wallet,null,request,{...options,draw:()=>{throw Error('rerolled')}});
 assert.equal(again.unchanged,true);
 assert.deepEqual(again.result,first.result);
 assert.equal(again.wallet.coins,first.wallet.coins);
});

test('gift row grants at most one premium entitlement; two gifts create one spark',()=>{
 const unlock={unlockId:'christmas2026:avatar:test',name:'Testgeschenk',category:'avatars',icon:'🎁'};
 const board=drawTicTacToe({draw:fixed(999),unlock});
 assert.equal(board.board.wins.length,8);
 assert.equal(board.winnings.filter(w=>w.type==='unlock').length,1);
 assert.equal(board.winnings.filter(w=>w.type==='coins'&&w.amount===1500).length,7);
 assert.equal(board.giftSparks,1);
 assert.equal(board.unlockId,unlock.unlockId);
 assert.equal(verifyTicTacToe(board.board),true);
});

test('no prize when all three-in-a-row lines are broken',()=>{
 const cells=['🪙','💼','💼','💼','💵','🪙','🪙','🪙','💼'];
 assert.equal(evaluateTicTacToe(cells).length,0);
});
