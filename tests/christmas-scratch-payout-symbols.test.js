import test from 'node:test';
import assert from 'node:assert/strict';
import {buyScratchTicket,DOG_SCRATCH_COIN_AMOUNTS} from '../dog/christmas-scratch.js';
import {generateScratchGrid,attachScratchPrizes,verifyScratchPrizes,evaluateScratchGrid}
 from '../dog/christmas-scratch-grid.js';
import {generatePremium27} from '../dog/christmas-premium27.js';

const icons=['🪙','💵','💼'];
const coins=icons.map((symbol,i)=>({type:'coins',symbol,amount:[10,40,100][i]}));
const gift=n=>({type:'unlock',symbol:'🎁',prize:{unlockId:'unlock-'+n,name:'Unique '+n}});
const fresh=()=>({coins:100000000,owned:{},recent:[],daily:'',purchased:0});

test('three money denominations per class and gift means unlock',()=>{
 assert.deepEqual(DOG_SCRATCH_COIN_AMOUNTS,{
  simple:[10,40,100],medium:[100,300,800],premium:[200,800,2000]
 });
});
test('every visible win on the first three cards matches its actual prize icon',()=>{
 for(const variantId of ['gifts','snow_collect','elf']){
  const groups=[
   [],[coins[0]],[coins[1],gift(1)],
   [...coins],[coins[0],gift(2),gift(3)]
  ];
  for(const prizes of groups)for(let turn=0;turn<30;turn++){
   const board=generateScratchGrid(variantId,prizes.length,{
    prizeSymbols:prizes.map(p=>p.symbol)
   });
   assert.equal(board.symbolVersion,2);
   const paid=attachScratchPrizes(board,prizes);
   assert.ok(verifyScratchPrizes(paid),variantId+' '+prizes.map(p=>p.symbol));
   assert.deepEqual(paid.wins.map(w=>w.symbol).sort(),prizes.map(p=>p.symbol).sort());
   assert.equal(evaluateScratchGrid(paid).length,prizes.length);
   for(const w of paid.wins){
    assert.equal(w.symbol,w.prize.symbol);
    assert.equal(w.symbol==='🎁',w.prize.type==='unlock');
   }
   if(variantId==='snow_collect')
    assert.ok(paid.cells.filter(s=>s==='🧊').length>=4);
  }
 }
});
test('27-field premium still pays correct 20/24 thresholds with payout symbols',()=>{
 const groups=[[],[coins[0]],[coins[1],coins[2]],
  [coins[0],gift(1)],[coins[0],gift(2),gift(3)]];
 for(const prizes of groups)for(let turn=0;turn<40;turn++){
  const board=generatePremium27(prizes);
  assert.equal(board.symbolVersion,2);
  assert.equal(board.cells.length,27);
  assert.ok(verifyScratchPrizes(board));
  assert.equal(board.wins.length,prizes.length);
  for(const w of board.wins){
   assert.equal(w.prize.symbol,w.symbol);
   assert.equal(w.symbol==='🎁',w.prize.type==='unlock');
   assert.ok(w.rule!=='gold-20'||w.prize.type==='coins');
   assert.ok(w.rule!=='premium-24'||w.prize.type==='unlock');
  }
 }
});
test('new symbol mapping rejects a coin matched to a gift icon',()=>{
 const original=generateScratchGrid('gifts',1,{prizeSymbols:['🎁']});
 assert.throws(()=>attachScratchPrizes(original,[coins[0]]),/SCRATCH_PAYOUT_SYMBOL_MISMATCH/);
 const valid=attachScratchPrizes(original,[gift(8)]);
 assert.ok(verifyScratchPrizes(valid));
 assert.equal(verifyScratchPrizes({...valid,wins:[{
  ...valid.wins[0],prize:{...coins[0],symbol:'🎁'}
 }]}),false);
});
test('purchases of all classes pay only the three published amounts per icon',()=>{
 for(const tier of ['simple','medium','premium']){
  for(let i=0;i<500;i++){
   const {result}=buyScratchTicket(fresh(),null,{
    tier,commandId:'coin-symbol-'+tier+'-'+i,free:false
   });
   assert.ok(verifyScratchPrizes(result.board));
   assert.equal(result.board.symbolVersion,2);
   for(const prize of result.winnings){
    if(prize.type==='unlock')assert.equal(prize.symbol,'🎁');
    else{
     const position=icons.indexOf(prize.symbol);
     assert.notEqual(position,-1);
     const expected=DOG_SCRATCH_COIN_AMOUNTS[tier][position];
     assert.equal(prize.x2?prize.baseAmount:prize.amount,expected);
     assert.equal(prize.amount,prize.x2?expected*2:expected);
    }
   }
  }
 }
});
