import test from 'node:test';
import assert from 'node:assert/strict';
import {randomInt} from 'node:crypto';
import {buyScratchTicket,DOG_SCRATCH_TIERS,DOG_SCRATCH_BONUS_ODDS} from '../dog/christmas-scratch.js';
import {SCRATCH_VARIANT_IDS,SCRATCH_VARIANT_IDS_BY_TIER,verifyScratchPrizes,evaluateScratchGrid} from '../dog/christmas-scratch-grid.js';

const fresh=()=>({coins:100000000,owned:{},recent:[],daily:'',purchased:0});
const req=(tier,id,free=false)=>({tier,commandId:'scratch-test-'+id,free});
test('confirmed 20% blank, 80% winner category weights sum to 100%',()=>{
 const expected={
  simple:{none:200,coins:689,unlock:111,extraCoinChance:30,coinMax:100},
  medium:{none:200,coins:770,unlock:30,extraCoinChance:40,coinMax:800},
  premium:{none:200,coins:760,unlock:40,extraCoinChance:50,coinMax:2000}
 };
 for(const [id,e] of Object.entries(expected)){
  const t=DOG_SCRATCH_TIERS[id];
  assert.deepEqual(t.weights,{none:e.none,coins:e.coins,unlock:e.unlock});
  assert.equal(Object.values(t.weights).reduce((a,b)=>a+b,0),1000);
  assert.equal(t.extraCoinChance,e.extraCoinChance);
  assert.equal(t.coinMax,e.coinMax);
 }
 assert.deepEqual(DOG_SCRATCH_BONUS_ODDS,{
  doubleMainPer1000:1,mainMultiplierPer1000:1,multiplierPer1000:110
 });
});
test('all tiers produce exactly one visible board for a ticket',()=>{
 for(const tier of Object.keys(DOG_SCRATCH_TIERS)){
  const seen=new Set();
  for(let n=0;n<600;n++){
   const t=buyScratchTicket(fresh(),null,req(tier,tier+n));
   const {result}=t;
   const {board,winnings}=result;
   assert.ok(SCRATCH_VARIANT_IDS.includes(board.variantId));
   assert.ok(SCRATCH_VARIANT_IDS_BY_TIER[tier].includes(board.variantId));
   seen.add(board.variantId);
   assert.ok(verifyScratchPrizes(board));
   assert.equal(evaluateScratchGrid(board).length,winnings.length);
   assert.ok(winnings.length<=3);
   assert.ok(result.totalCoins>=0);
   assert.equal(result.totalCoins,winnings.filter(p=>p.type==='coins').reduce((sum,p)=>sum+p.amount,0));
   if(result.type==='none'){
    assert.equal(winnings.length,0);
    assert.equal(result.multiplier,1);
   }
   const unlocked=winnings.filter(p=>p.type==='unlock');
   assert.equal(new Set(unlocked.map(x=>x.prize.unlockId)).size,unlocked.length);
   assert.equal(t.status.lastResult.commandId,result.commandId);
  }
  assert.equal(seen.size,2,'both tier-specific game variants sampled');
 }
});
test('no wins and x2 obey the server-defined baseline roll',()=>{
 for(const tier of Object.keys(DOG_SCRATCH_TIERS)){
  for(const [first,kind] of [[0,'none'],[200,'coins'],[999,'unlock']]){
   let initial=true;
   const draw=max=>{
    if(initial&&max===1000){initial=false;return first}
    return randomInt(max);
   };
   const {result}=buyScratchTicket(fresh(),null,req(tier,tier+first),{draw});
   assert.equal(result.type,kind);
   assert.ok(verifyScratchPrizes(result.board));
  }
 }
});
test('purchase replay preserves board and never charges twice',()=>{
 const one=buyScratchTicket(fresh(),null,req('simple','replay'));
 const two=buyScratchTicket(one.wallet,null,req('simple','replay'));
 assert.equal(two.unchanged,true);
 assert.deepEqual(two.result,one.result);
 assert.equal(two.wallet.coins,one.wallet.coins);
 assert.deepEqual(two.result.board,one.result.board);
});
test('no purchase with insufficient coins, duplicate free daily tickets forbidden',()=>{
 assert.throws(()=>buyScratchTicket({coins:0},null,req('medium','poor')),/SCRATCH_NOT_ENOUGH_COINS/);
 const one=buyScratchTicket({coins:0},null,req('simple','gift',true));
 assert.equal(one.result.price,0);
 assert.equal(one.status.dailyFreeAvailable,false);
 assert.throws(()=>buyScratchTicket(one.wallet,null,req('simple','gift-again',true)),/SCRATCH_DAILY_ALREADY_USED/);
});
