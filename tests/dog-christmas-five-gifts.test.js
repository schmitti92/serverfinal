import test from 'node:test';
import assert from 'node:assert/strict';
import {SCRATCH_GIFT_SYMBOLS,generatePayoutGrid} from '../dog/christmas-scratch-symbols.js';
import {normalizeScratchSettings} from '../dog/christmas-scratch-settings.js';
import {buyScratchTicket} from '../dog/christmas-scratch.js';
import {verifyScratchPrizes} from '../dog/christmas-scratch-grid.js';
import {drawTicTacToeDuel} from '../dog/christmas-tictactoe-duel.js';
import {drawNumberOne20,drawDogJackpot9} from '../dog/christmas-special-scratch.js';

const award={unlockId:'test:gift-prize',name:'Hauptgewinn',icon:'🎁',category:'avatars'};
const icons=['🎁','💝','🎀','🧧','🛍️'];

test('five distinct gift symbols are in the verified classic payout alphabet',()=>{
 assert.deepEqual([...SCRATCH_GIFT_SYMBOLS],icons);
 for(const icon of icons){
  for(const variant of ['gifts','snow_collect','elf']){
   const board=generatePayoutGrid(variant,[icon],undefined);
   assert.equal(board.wins.length,1,variant+' '+icon);
   assert.equal(board.wins[0].symbol,icon);
   assert.ok(board.wins[0].indices.every(index=>board.cells[index]===icon));
  }
 }
});
test('all five gift symbols can trigger real main-prize unlocks on all four classic cards',()=>{
 for(const icon of icons){
  const index=icons.indexOf(icon);
  for(const [tier,variantId] of [['simple','gifts'],['simple','snow_collect'],
   ['medium','elf'],['premium','premium_27']]){
   const settings=normalizeScratchSettings(null);
   settings.variants[variantId].weights={none:0,coins:0,unlock:1000};
   settings.variants[variantId].giftSymbolWeights=icons.map((_,i)=>i===index?1000:0);
   const result=buyScratchTicket({coins:500000},null,{
    tier,variantId,commandId:'five_gifts_'+variantId+'_'+index
   },{settings}).result;
   assert.ok(verifyScratchPrizes(result.board),variantId+' '+icon);
   assert.ok(result.winnings.some(p=>p.type==='unlock'&&p.symbol===icon),
    variantId+' should pay '+icon+' main prize');
  }
 }
});
test('all five main-prize symbols work in Tic-Tac-Toe, Glückszahl 1 and Finde DOG!',()=>{
 for(const [index,icon] of icons.entries()){
  const draw=max=>max===5?index: max===1000?0:0;
  // For Tic-Tac-Toe the fourth probability bucket must be forced to 100%.
  const tic=drawTicTacToeDuel({draw,unlock:award,settings:{
   coinAmounts:[200,450,800],symbolWeights:[0,0,0,1000],
   maxMultiplier:5,giftFallbackCoins:1500
  }});
  assert.equal(tic.board.prizeSymbol,icon);
  assert.ok(tic.winnings.some(win=>win.type==='unlock'&&win.symbol===icon));
  assert.equal(verifyScratchPrizes(tic.board),true);

  const number=drawNumberOne20({draw,unlock:award,settings:{
   price:500,hitPer1000:1000,coinAmounts:[100,300,800],
   giftFallbackCoins:1500,symbolWeights:[0,0,0,1000]
  }});
  assert.ok(number.winnings.some(win=>win.type==='unlock'&&win.symbol===icon));
  assert.equal(verifyScratchPrizes(number.board),true);

  const dog=drawDogJackpot9({draw,unlock:award,settings:{
   coinAmounts:[100,300,800],symbolWeights:[0,0,0,1000],
   dogChancePer1000:1000,giftFallbackCoins:1500
  }});
  assert.ok(dog.winnings.some(win=>win.type==='unlock'&&win.symbol===icon));
  assert.equal(verifyScratchPrizes(dog.board),true);
 }
});
