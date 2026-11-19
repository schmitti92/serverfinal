import test from 'node:test';
import assert from 'node:assert/strict';
import {TIC_EDITION_DEFAULT,createTicFixedPlan,ticPlanTotal,ticTicketAmount,
 createTicEdition,ticEditionPublic,editTicEdition,issueTicEditionTicket}
 from '../dog/christmas-tic-edition.js';
import {drawTicTacToeDuel,verifyTicTacToeDuel} from '../dog/christmas-tictactoe-duel.js';
import {DOG_SCRATCH_START_COINS} from '../dog/christmas-scratch.js';

const zero=()=>0;
const config={...TIC_EDITION_DEFAULT,coinAmounts:[200,450,800],
 symbolWeights:[700,250,40,10],targetNonePer1000:200,maxMultiplier:5,price:500};
test('Tic series plans a fixed and exactly payable sum for all 500 cards',()=>{
 for(const budget of [0,60000,100000,150000,200000]){
  const p=createTicFixedPlan(budget,config,500,zero);
  assert.equal(p.length,500);
  assert.equal(ticPlanTotal(p,config),budget);
  assert.ok(p.every(code=>/^[A-O]$|^[GN][1-5]$/.test(code)));
 }
 assert.throws(()=>createTicFixedPlan(60001,config,500,zero),
  /SCRATCH_TIC_EDITION_BUDGET_UNREACHABLE/);
});
test('published series freezes an issued plan and edits only the remaining 499 tickets',()=>{
 const e=createTicEdition({id:'test-tic-01',createdAt:12345,
  createdBy:'tester',maxTotalCoins:150000,config,draw:zero});
 assert.equal(e.issued,0);
 assert.equal(e.prizePlan.length,500);
 assert.equal(ticPlanTotal(e.prizePlan,e.config),150000);
 const bought=issueTicEditionTicket(null,null,{tier:'medium',variantId:'tic_tac_toe',
  commandId:'tic-edition-test-0000001'},e,null,{draw:zero,now:()=>12345});
 assert.equal(bought.edition.issued,1);
 assert.equal(bought.purchase.result.totalCoins,ticTicketAmount(e.prizePlan[0],e.config));
 assert.equal(bought.purchase.result.ticEditionId,e.id);
 assert.equal(bought.purchase.wallet.coins,
  DOG_SCRATCH_START_COINS-bought.purchase.result.price+bought.purchase.result.totalCoins);
 const replay=issueTicEditionTicket(bought.purchase.wallet,null,
  {tier:'medium',variantId:'tic_tac_toe',commandId:'tic-edition-test-0000001'},
  bought.edition,null,{draw:()=>{throw Error('REROLL_BLOCKED')},now:()=>12345});
 assert.equal(replay.purchase.unchanged,true);
 assert.equal(replay.edition.issued,1);
 const remaining=150000-bought.edition.paidCoins;
 const edited=editTicEdition(bought.edition,{config,maxTotalCoins:150000,draw:zero,now:12346});
 assert.deepEqual(edited.prizePlan.slice(0,1),bought.edition.prizePlan.slice(0,1));
 assert.equal(edited.prizePlan.length,500);
 assert.equal(ticPlanTotal(edited.prizePlan.slice(1),config),remaining);
 assert.equal(ticEditionPublic(edited).remaining,499);
});
test('fixed money wins match the scratched bottom symbol and multiplier',()=>{
 for(const [code,multiplier,symbol,amount] of [
  ['A',1,'🪙',200],['E',5,'🪙',1000],['F',1,'💵',450],
  ['J',5,'💵',2250],['O',5,'💼',4000]
 ]){
  const result=drawTicTacToeDuel({draw:zero,settings:config,fixedCode:code});
  assert.equal(result.board.multiplier,multiplier);
  assert.equal(result.board.prizeSymbol,symbol);
  assert.equal(result.winnings.length,1);
  assert.equal(result.winnings[0].amount,amount);
  assert.ok(result.board.wins.length>=1);
  assert.equal(verifyTicTacToeDuel(result.board),true);
 }
 const none=drawTicTacToeDuel({draw:zero,settings:config,fixedCode:'N5'});
 assert.equal(none.board.wins.length,0);
 assert.equal(none.winnings.length,0);
 assert.equal(none.board.multiplier,5);
 assert.equal(verifyTicTacToeDuel(none.board),true);
 const gift=drawTicTacToeDuel({draw:zero,settings:config,fixedCode:'G3'});
 assert.equal(gift.board.multiplier,3);
 assert.ok(gift.board.prizeSymbol==='🎁'||gift.board.prizeSymbol==='💝');
 assert.equal(gift.winnings[0]?.amount,0);
 assert.equal(verifyTicTacToeDuel(gift.board),true);
});
