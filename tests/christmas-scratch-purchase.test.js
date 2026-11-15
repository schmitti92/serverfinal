import test from 'node:test';
import assert from 'node:assert/strict';
import {randomInt} from 'node:crypto';
import {buyScratchTicket,DOG_SCRATCH_TIERS,DOG_SCRATCH_BONUS_ODDS,normalizedScratchWallet,dogScratchStatus} from '../dog/christmas-scratch.js';
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
  assert.deepEqual([...seen].sort(),[...SCRATCH_VARIANT_IDS_BY_TIER[tier]].sort(),
   'each tier must sample exactly its permitted scratch games (two simple, one medium, one premium)');
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

test('27-cell premium purchase always displays both milestone prizes at 24 symbols',()=>{
 for(let i=0;i<300;i++){
  const firstRoll=999;let rolled=false;
  const draw=max=>{
   if(!rolled&&max===1000){rolled=true;return firstRoll}
   return randomInt(max);
  };
  const t=buyScratchTicket(fresh(),null,req('premium','27unlock'+i),{draw});
  const {board,winnings}=t.result;
  assert.equal(board.variantId,'premium_27');
  assert.equal(board.cells.length,27);
  assert.equal(board.cells.filter(v=>v!=='🧊').length>=24,true);
  assert.ok(board.wins.some(w=>w.rule==='gold-20'&&w.prize.type==='coins'));
  assert.ok(board.wins.some(w=>w.rule==='premium-24'&&w.prize.type==='unlock'));
  assert.ok(verifyScratchPrizes(board));
  assert.deepEqual(winnings,board.wins.map(w=>w.prize));
 }
});
test('27-cell premium losing cards never accidentally award threshold or row prizes',()=>{
 for(let i=0;i<200;i++){
  let rolled=false;
  const draw=max=>{
   if(!rolled&&max===1000){rolled=true;return 0}
   return randomInt(max);
  };
  const {result}=buyScratchTicket(fresh(),null,req('premium','27blank'+i),{draw});
  assert.equal(result.board.variantId,'premium_27');
  assert.equal(result.board.cells.length,27);
  assert.ok(result.board.cells.filter(v=>v!=='🧊').length<20);
  assert.equal(result.board.wins.length,0);
  assert.ok(verifyScratchPrizes(result.board));
 }
});

test('personal progress counts every server-issued scratch ticket exactly once',()=>{
 let wallet=fresh();
 const variants=['gifts','snow_collect','elf','premium_27'];
 const rows={gifts:0,snow_collect:0,elf:0,premium_27:0};
 for(let i=0;i<12;i++){
  const tier=i%3===0?'simple':i%3===1?'medium':'premium';
  const result=buyScratchTicket(wallet,null,req(tier,'progress-'+i));
  wallet=result.wallet;
  rows[result.result.board.variantId]++;
  assert.equal(result.status.progress.opened,i+1);
  assert.equal(result.status.progress.tracked,i+1);
  assert.equal(result.status.progress.olderUnclassified,0);
  assert.equal(result.status.progress.winTickets+result.status.progress.duds,i+1);
  assert.equal(result.status.progress.coinsWon,
   wallet.recent.reduce((sum,r)=>sum+r.result.totalCoins,0));
 }
 const status=dogScratchStatus(wallet);
 assert.deepEqual(Object.fromEntries(variants.map(id=>[id,status.progress.byVariant[id].opened])),rows);
 assert.equal(variants.reduce((sum,id)=>sum+status.progress.byVariant[id].opened,0),12);
 const replay=buyScratchTicket(wallet,null,req('simple','progress-0'));
 assert.equal(replay.unchanged,true);
 assert.deepEqual(replay.status.progress,status.progress);
 assert.deepEqual(replay.wallet.progress,wallet.progress);
});
test('historic scratch ticket progress is partially reconstructed without inventing missing categories',()=>{
 let wallet=fresh();
 for(let i=0;i<7;i++){
  wallet=buyScratchTicket(wallet,null,req(i%2?'medium':'simple','past-progress-'+i)).wallet;
 }
 const legacy={...wallet,purchased:58,progress:undefined};
 const loaded=dogScratchStatus(legacy);
 assert.equal(loaded.progress.opened,58);
 assert.equal(loaded.progress.tracked,7);
 assert.equal(loaded.progress.olderUnclassified,51);
 assert.equal(loaded.progress.winTickets+loaded.progress.duds,7);
 const next=buyScratchTicket(legacy,null,req('premium','past-progress-new'));
 assert.equal(next.status.progress.opened,59);
 assert.equal(next.status.progress.tracked,8);
 assert.equal(next.status.progress.olderUnclassified,51);
 assert.equal(normalizedScratchWallet(next.wallet).progress.tracked,8);
 const repeat=buyScratchTicket(next.wallet,null,req('premium','past-progress-new'));
 assert.equal(repeat.status.progress.opened,59,'replay must not change historical totals');
});
test('free tickets and unlocks are included in progress statistics',()=>{
 const freshAccount=fresh();
 const result=buyScratchTicket(freshAccount,null,req('simple','progress-free',true));
 const p=result.status.progress;
 assert.equal(p.opened,1);
 assert.equal(p.free,1);
 assert.equal(p.byVariant[result.result.board.variantId].free,1);
 assert.equal(p.unlocks,result.result.winnings.filter(x=>x.type==='unlock').length);
});
