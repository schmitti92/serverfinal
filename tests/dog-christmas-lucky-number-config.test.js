import test from 'node:test';
import assert from 'node:assert/strict';
import {DOG_SCRATCH_DEFAULT_SETTINGS,normalizeScratchSettings,validateScratchSettings} from '../dog/christmas-scratch-settings.js';
import {buyScratchTicket} from '../dog/christmas-scratch.js';
import {verifyScratchPrizes} from '../dog/christmas-scratch-grid.js';
const copy=v=>JSON.parse(JSON.stringify(v));

test('Glückszahl 1 host values are validated and persist when old settings are loaded',()=>{
 const cfg=copy(DOG_SCRATCH_DEFAULT_SETTINGS);
 cfg.numberOne20={price:1234,hitPer1000:225,giftFallbackCoins:777,coinAmounts:[11,222,3333],symbolWeights:[0,100,900,0]};
 assert.deepEqual(validateScratchSettings(cfg).numberOne20,cfg.numberOne20);
 const legacy=copy(cfg);delete legacy.numberOne20;
 assert.deepEqual(normalizeScratchSettings(legacy).numberOne20,{
  price:500,hitPer1000:100,giftFallbackCoins:1500,coinAmounts:[100,300,800],symbolWeights:[650,280,60,10]
 });
 for(const [key,value] of [
  ['price',0],['hitPer1000',1001],['coinAmounts',[3,3,4]],
  ['symbolWeights',[650,280,60,5]]
 ]){
  const invalid=copy(cfg);invalid.numberOne20[key]=value;
  assert.throws(()=>validateScratchSettings(invalid),/SCRATCH_SETTINGS_INVALID/,key);
 }
});

test('custom 20-row lottery pays new money amounts at newly configured ticket price',()=>{
 const settings=copy(DOG_SCRATCH_DEFAULT_SETTINGS);
 settings.numberOne20={price:1234,hitPer1000:1000,
  coinAmounts:[11,222,3333],symbolWeights:[0,0,1000,0]};
 const request={tier:'medium',variantId:'number_one_20',commandId:'lucky-custom-ticket-01'};
 const first=buyScratchTicket({coins:200000},null,request,{settings,draw:max=>0});
 assert.equal(first.result.price,1234);
 assert.equal(first.result.board.cells.length,40);
 assert.ok(first.result.board.cells.every((x,i)=>i%2===0?x==='💼':x===1));
 assert.equal(first.result.winnings.length,20);
 assert.equal(first.result.totalCoins,20*3333);
 assert.equal(first.result.balance,200000-1234+20*3333);
 assert.deepEqual(first.result.board.coinAmounts,[11,222,3333]);
 assert.deepEqual(first.result.board.symbolWeights,[0,0,1000,0]);
 assert.equal(first.result.board.hitPer1000,1000);
 assert.ok(verifyScratchPrizes(first.result.board));
 const changed=copy(settings);changed.numberOne20.coinAmounts=[1,2,3];
 assert.ok(verifyScratchPrizes(first.result.board),'previous receipt keeps its original prizes');
 const duplicate=buyScratchTicket(first.wallet,null,request,{settings:changed,draw:()=>{throw Error('reroll')}});
 assert.equal(duplicate.unchanged,true);
 assert.equal(duplicate.result.totalCoins,20*3333);
 assert.equal(duplicate.wallet.coins,first.wallet.coins);
});

test('zero configured number-one chance yields no wins even when every field has a case',()=>{
 const settings=copy(DOG_SCRATCH_DEFAULT_SETTINGS);
 settings.numberOne20={price:100,hitPer1000:0,coinAmounts:[2,4,6],symbolWeights:[0,0,1000,0]};
 const first=buyScratchTicket({coins:10000},null,
  {tier:'medium',variantId:'number_one_20',commandId:'lucky-zero-ticket-01'},
  {settings,draw:max=>0});
 assert.equal(first.result.board.wins.length,0);
 assert.ok(first.result.board.cells.every((x,i)=>i%2===0?x==='💼':x===2));
 assert.equal(first.result.totalCoins,0);
 assert.equal(first.result.balance,9900);
 assert.ok(verifyScratchPrizes(first.result.board));
});
