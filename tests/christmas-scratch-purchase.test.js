import test from 'node:test';
import assert from 'node:assert/strict';
import {randomInt} from 'node:crypto';
import {buyScratchTicket,DOG_SCRATCH_TIERS,DOG_SCRATCH_BONUS_ODDS,normalizedScratchWallet,dogScratchStatus,PREMIUM_20_MILESTONE_PER_1000,PREMIUM_20_MILESTONE_COINS} from '../dog/christmas-scratch.js';
import {generatePremium27,verifyPremium27} from '../dog/christmas-premium27.js';
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
   assert.ok(winnings.length>=board.wins.length);
   assert.deepEqual(winnings.slice(0,board.wins.length),board.wins.map(w=>w.prize));
   assert.ok(winnings.length<=(tier==='premium'?10:3));
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
   assert.equal(result.type,tier==='premium'&&kind==='none'?'coins':kind);
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
  assert.deepEqual(winnings.slice(0,board.wins.length),board.wins.map(w=>w.prize));
 }
});
test('premium base-category none pays two money rows but no 20-symbol bonus',()=>{
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
  const cash=result.board.wins.filter(w=>w.rule==='row-3'&&w.prize.type==='coins');
  assert.equal(cash.length,2);
  assert.equal(new Set(cash.map(w=>w.symbol)).size,2);
  assert.ok(!result.board.wins.some(w=>w.rule==='gold-20'));
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

test('explicit card selection yields exactly that scratch variant, without altering tier prices',()=>{
 const variants={simple:['gifts','snow_collect'],medium:['elf'],premium:['premium_27']};
 for(const [tier,ids] of Object.entries(variants)){
  for(const variantId of ids){
   for(let i=0;i<12;i++){
    const id='choose-'+variantId+'-'+i;
    const request={tier,variantId,commandId:id,free:false};
    const {result,wallet}=buyScratchTicket(fresh(),null,request);
    assert.equal(result.board.variantId,variantId);
    assert.equal(result.tier,tier);
    assert.equal(result.price,DOG_SCRATCH_TIERS[tier].price);
    assert.ok(verifyScratchPrizes(result.board));
    const repeat=buyScratchTicket(wallet,null,request);
    assert.equal(repeat.unchanged,true);
    assert.deepEqual(repeat.result,result);
   }
  }
 }
});
test('variants from other price classes and unknown variants are rejected before payout',()=>{
 for(const [tier,variantId] of [
  ['simple','elf'],['simple','premium_27'],
  ['medium','gifts'],['premium','snow_collect'],
  ['simple','__proto__'],['simple',''],['simple',null],['medium',100]
 ]){
  assert.throws(()=>buyScratchTicket(fresh(),null,{
   tier,variantId,commandId:'bad-variant-'+tier+'-1234'
  }),/SCRATCH_INVALID_VARIANT/);
 }
});

test('premium v4 money symbols form actual paid horizontal rows independently of 20 threshold',()=>{
 const prizes=[
  {type:'coins',symbol:'🪙',amount:200},
  {type:'coins',symbol:'💵',amount:800},
  {type:'coins',symbol:'💼',amount:2000}
 ];
 for(const symbol of ['🪙','💵','💼']){
  for(let k=0;k<8;k++){
   const board=generatePremium27([prizes.find(p=>p.symbol===symbol)],{version:4});
   assert.equal(board.symbolVersion,4);
   assert.equal(board.cells.filter(x=>x!=='🧊').length<20,true);
   assert.equal(board.wins.length,1);
   assert.equal(board.wins[0].rule,'row-3');
   assert.equal(board.wins[0].symbol,symbol);
   assert.ok(board.wins[0].indices.every(i=>board.cells[i]===symbol));
   assert.equal(board.wins[0].prize.amount,prizes.find(p=>p.symbol===symbol).amount);
   assert.ok(verifyPremium27(board));
  }
 }
 // Even if the milestone and a row both use 🪙, they are two DIFFERENT
 // payouts: fixed 1,000 vs configurable 200.
 const withMilestone=generatePremium27([
  {type:'coins',symbol:'🪙',amount:1000,milestone:'gold-20'},
  {type:'coins',symbol:'🪙',amount:200}
 ],{version:4});
 assert.ok(verifyPremium27(withMilestone));
 assert.equal(withMilestone.wins.length,2);
 assert.deepEqual(withMilestone.wins.map(w=>w.rule),['gold-20','row-3']);
 assert.deepEqual(withMilestone.wins.map(w=>w.prize.amount),[1000,200]);
});
test('premium 20-symbol bonus awards exactly 1000 coins and stays at 30 percent base odds',()=>{
 assert.equal(PREMIUM_20_MILESTONE_PER_1000,300);
 assert.equal(PREMIUM_20_MILESTONE_COINS,1000);
 // Reproducible pseudorandom sample, no flaky dependence on crypto randomness.
 let seed=818710;const draw=max=>{
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  return Math.floor(seed/4294967296*max);
 };
 let threshold=0,unlock=0,coinRowTickets=0;
 for(let i=0;i<800;i++){
  const {result}=buyScratchTicket(fresh(),null,req('premium','v4-distribution-'+i),{draw});
  const real=result.board.cells.filter(x=>x!=='🧊').length;
  const milestones=result.board.wins.filter(w=>w.rule==='gold-20');
  const coins=result.board.wins.filter(w=>w.rule==='row-3'&&w.prize.type==='coins');
  const gifts=result.board.wins.filter(w=>w.rule==='premium-24');
  assert.equal(result.board.symbolVersion,6);
  assert.equal(real>=20,milestones.length===1);
  assert.ok(verifyPremium27(result.board));
  assert.equal(milestones.length,gifts.length>0?1:milestones.length);
  if(milestones.length){
   threshold++;
   const prize=milestones[0].prize;
   assert.equal(prize.amount,1000);
   assert.equal(prize.symbol,'🪙');
   assert.equal(prize.milestone,'gold-20');
   assert.ok(!prize.x2);
   assert.ok(result.totalCoins>=1000);
  }
  if(gifts.length){unlock++;assert.ok(real>=24)}
  if(coins.length===2)coinRowTickets++;
  assert.ok(result.board.wins.length<=5);
  assert.equal(coins.length,2);
 }
 assert.ok(threshold>=205&&threshold<=285,'milestone share should be near 30%: '+threshold+'/800');
 assert.ok(unlock>=15&&unlock<=55,'unlock share should remain near 4%: '+unlock+'/800');
 assert.ok(coinRowTickets>=350,'money rows should remain a normal premium outcome');
});


test('all three money symbols appear on every newly generated premium scratch field',()=>{
 let seed=291873;const draw=max=>{
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  return Math.floor(seed/4294967296*max);
 };
 const cases=[
  [],
  [{type:'coins',symbol:'🪙',amount:200}],
  [{type:'coins',symbol:'💵',amount:800}],
  [{type:'coins',symbol:'💼',amount:2000}],
  [{type:'coins',symbol:'🪙',amount:1000,milestone:'gold-20'}],
  [{type:'coins',symbol:'🪙',amount:1000,milestone:'gold-20'},
   {type:'unlock',symbol:'🎁',milestone:'premium-24',
    prize:{unlockId:'a',name:'A'}}]
 ];
 for(const prizes of cases)for(let i=0;i<45;i++){
  const board=generatePremium27(prizes,{draw,version:4,maxAttempts:12000});
  assert.equal(board.symbolVersion,4);
  assert.ok(verifyPremium27(board));
  for(const icon of ['🪙','💵','💼']){
   assert.ok(board.cells.includes(icon),'premium must visibly contain '+icon);
  }
  assert.equal(board.wins.length,prizes.length,'incidental money icons cannot give fake wins');
  for(const row of board.wins.filter(w=>w.rule==='row-3')){
   assert.ok(['🪙','💵','💼','🎁','💝','🎀','🧧'].includes(row.symbol));
   assert.ok(row.indices.every(index=>board.cells[index]===row.symbol));
  }
 }
});

test('each newly issued premium ticket has exactly two PAID money rows',()=>{
 let seed=1732870;
 const draw=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  return Math.floor(seed/4294967296*max)};
 for(let i=0;i<250;i++){
  const {result}=buyScratchTicket(fresh(),null,
   req('premium','guaranteed-two-money-rows-'+i),{draw});
  const board=result.board;
  assert.equal(board.symbolVersion,6);
  assert.ok(verifyPremium27(board));
  const rows=board.wins.filter(w=>w.rule==='row-3'&&w.prize.type==='coins');
  assert.equal(rows.length,2);
  assert.equal(new Set(rows.map(w=>w.symbol)).size,2);
  assert.ok(rows.every(w=>w.indices.length===3&&w.indices.every(
   index=>board.cells[index]===w.symbol)));
  assert.ok(rows.every(w=>w.prize.amount>0),'both money rows must actually pay');
  assert.ok(result.winnings.length>=2);
  assert.equal(result.totalCoins,result.winnings.filter(w=>w.type==='coins')
   .reduce((total,w)=>total+w.amount,0));
 }
});
test('premium v5 safely pays repeated money symbols, bonus and gift on one board',()=>{
 const prizes=[
  {type:'coins',symbol:'🪙',amount:200},
  {type:'coins',symbol:'💵',amount:800},
  {type:'coins',symbol:'💼',amount:2000},
  {type:'coins',symbol:'💵',amount:800},
  {type:'coins',symbol:'🪙',amount:1000,milestone:'gold-20'},
  {type:'unlock',symbol:'🎀',milestone:'premium-24',prize:{unlockId:'test-gift',name:'Geschenk'}}
 ];
 const board=generatePremium27(prizes,{version:5});
 assert.ok(verifyPremium27(board));
 assert.equal(board.symbolVersion,5);
 assert.deepEqual(board.wins.map(w=>w.rule),[
  'gold-20','premium-24','row-3','row-3','row-3','row-3'
 ]);
 assert.equal(board.wins.filter(w=>w.symbol==='💵'&&w.rule==='row-3').length,2);
 assert.equal(board.wins.filter(w=>w.rule==='row-3'&&w.prize.type==='coins')
  .reduce((sum,w)=>sum+w.prize.amount,0),3800);
});
