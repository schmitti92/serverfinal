import test from 'node:test';
import assert from 'node:assert/strict';
import {
 drawNumberOne20,drawDogJackpot9,verifySpecialScratch,evaluateSpecialScratch,
 NUMBER_ROW_COUNT,DOG_JACKPOT_CHANCE_PER_1000
} from '../dog/christmas-special-scratch.js';
import {buyScratchTicket,DOG_SCRATCH_START_COINS} from '../dog/christmas-scratch.js';
import {verifyScratchPrizes} from '../dog/christmas-scratch-grid.js';

const NOW=Date.parse('2026-11-16T16:30:00Z');
const drawAllOne=max=>0;
test('twenty lines contain two columns, only right-hand number 1 wins',()=>{
 const drawn=drawNumberOne20({draw:drawAllOne});
 assert.equal(drawn.board.cells.length,40);
 assert.equal(drawn.board.wins.length,NUMBER_ROW_COUNT);
 assert.ok(drawn.board.cells.every((v,i)=>i%2===0?v==='🪙':v===1));
 assert.ok(drawn.board.wins.every((w,i)=>w.rule==='number-one'&&
  w.indices[0]===i*2&&w.indices[1]===i*2+1));
 assert.equal(drawn.winnings.reduce((n,p)=>n+p.amount,0),2000);
 assert.equal(verifyScratchPrizes(drawn.board),true);
 const empty=drawNumberOne20({draw:max=>max===10?5:0});
 assert.equal(empty.board.wins.length,0);
 assert.equal(empty.winnings.length,0);
 assert.equal(verifySpecialScratch(empty.board),true);
 assert.equal(evaluateSpecialScratch(empty.board).length,0);
});

test('DOG triggers ALL other eight prizes; no DOG pays nothing',()=>{
 assert.equal(DOG_JACKPOT_CHANCE_PER_1000,350);
 const win=drawDogJackpot9({draw:drawAllOne});
 assert.equal(win.board.cells.length,9);
 assert.equal(win.board.cells.filter(x=>x==='DOG').length,1);
 assert.equal(win.board.wins.length,8);
 assert.equal(win.board.cells[0],'DOG');
 assert.equal(win.winnings.reduce((n,p)=>n+p.amount,0),800);
 assert.equal(verifySpecialScratch(win.board),true);
 const loss=drawDogJackpot9({draw:max=>500});
 assert.equal(loss.board.cells.filter(x=>x==='DOG').length,0);
 assert.equal(loss.board.wins.length,0);
 assert.equal(loss.winnings.length,0);
 assert.equal(verifyScratchPrizes(loss.board),true);
});

test('DOG gift jackpot grants at most one unlock and verified fallback coins',()=>{
 const unlock={unlockId:'christmas2026:avatar:test-gift',name:'Test-Geschenk',icon:'🎁',category:'avatars'};
 const win=drawDogJackpot9({draw:max=>max===9?4:999===max?0:(max===1000?999:0),unlock});
 // The ticket-wide DOG roll is 999 with this stub, so no DOG is awarded.
 assert.equal(win.board.wins.length,0);
 let count=0;
 const jackpot=drawDogJackpot9({draw:max=>max===9?4:max===1000?(count++===0?0:999):0,unlock});
 assert.equal(jackpot.board.cells[4],'DOG');
 assert.equal(jackpot.winnings.length,8);
 assert.equal(jackpot.winnings.filter(p=>p.type==='unlock').length,1);
 assert.equal(jackpot.winnings.filter(p=>p.type==='coins'&&p.amount===1500).length,7);
 assert.equal(verifySpecialScratch(jackpot.board),true);
 const forged={...jackpot.board,wins:jackpot.board.wins.map(x=>({...x}))};
 forged.wins[0]={...forged.wins[0],indices:[999]};
 assert.equal(verifySpecialScratch(forged),false);
});

test('wallet receipts are paid once, and wrong price tier is rejected',()=>{
 for(const [tier,variantId,amount] of [
  ['medium','number_one_20',2000],
  ['premium','dog_jackpot_9',800]
 ]){
  const request={tier,variantId,commandId:'scratch-special-'+variantId};
  const first=buyScratchTicket(null,null,request,{draw:drawAllOne,now:()=>NOW});
  assert.equal(first.result.price,tier==='medium'?500:1000);
  assert.equal(first.result.totalCoins,amount);
  assert.equal(first.wallet.coins,DOG_SCRATCH_START_COINS-first.result.price+amount);
  assert.equal(first.status.progress.byVariant[variantId].opened,1);
  assert.ok(verifyScratchPrizes(first.result.board));
  const again=buyScratchTicket(first.wallet,null,request,{draw:()=>{throw Error('REROLL');},now:()=>NOW});
  assert.equal(again.unchanged,true);
  assert.deepEqual(again.result,first.result);
  assert.equal(again.wallet.coins,first.wallet.coins);
  assert.throws(()=>buyScratchTicket(null,null,{...request,tier:tier==='medium'?'premium':'medium',commandId:'wrong-'+variantId},{draw:drawAllOne,now:()=>NOW}),/SCRATCH_INVALID_VARIANT/);
 }
});
