import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeScratchSettings} from '../dog/christmas-scratch-settings.js';
import {verifyScratchPrizes} from '../dog/christmas-scratch-grid.js';
import {
 SCRATCH_PRINT_SIZE,validateEditionConfig,planScratchEdition,
 newEditionDocument,unpackEditionTickets,editionPublic,issueEditionTicket
} from '../dog/christmas-scratch-editions.js';

const settings=normalizeScratchSettings(null);
const simple=()=>({
 variantId:'gifts',title:'Schneewunder – Serie 001',maxTotalCoins:5000000,
 maxPerTicketCoins:1000000,maxPrizesPerTicket:10,maxUnlocks:0,
 quotas:{0:100}
});
test('print plan creates exactly 500 independently verified tickets and exact dud quotas',()=>{
 const plan=planScratchEdition(simple(),settings);
 assert.equal(plan.summary.tickets,SCRATCH_PRINT_SIZE);
 assert.equal(plan.summary.duds,100);
 assert.equal(plan.summary.byWins[0],100);
 assert.equal(plan.summary.winners,400);
 assert.equal(plan.summary.unlocks,0);
 assert.ok(plan.summary.totalCoins<=simple().maxTotalCoins);
 const tickets=unpackEditionTickets(plan.packed);
 assert.equal(tickets.length,500);
 let printedCoins=0;
 for(const ticket of tickets){
  assert.equal(ticket.board.variantId,'gifts');
  assert.equal(verifyScratchPrizes(ticket.board),true);
  assert.ok(ticket.winnings.length<=10);
  assert.ok(ticket.totalCoins<=simple().maxPerTicketCoins);
  printedCoins+=ticket.totalCoins;
 }
 assert.equal(printedCoins,plan.summary.totalCoins);
});
test('a printed purchase is charged once and its immutable winning board is preserved',()=>{
 const plan=planScratchEdition({
  ...simple(),quotas:{0:500}
 },settings);
 const doc=newEditionDocument(plan,'host-user',1763430000000);
 const request={tier:'simple',variantId:'gifts',commandId:'edition_unit_00001'};
 const original={coins:5000,owned:{}};
 const sold=issueEditionTicket(doc,original,null,request,{settings,now:()=>1763430100000});
 assert.equal(sold.unchanged,false);
 assert.equal(sold.doc.issued,1);
 assert.equal(sold.result.editionSerial,1);
 assert.equal(sold.result.totalCoins,0);
 assert.equal(sold.wallet.coins,4800);
 assert.equal(sold.wallet.purchased,1);
 assert.equal(verifyScratchPrizes(sold.result.board),true);
 const replay=issueEditionTicket(sold.doc,sold.wallet,null,request,{settings,now:()=>1763430102000});
 assert.equal(replay.unchanged,true);
 assert.equal(replay.doc.issued,1);
 assert.equal(replay.wallet.coins,4800);
 assert.equal(replay.result.commandId,request.commandId);
 assert.equal(editionPublic(doc).remaining,500);
 assert.equal(editionPublic(sold.doc).remaining,499);
});
test('invalid configurations never create a partially printed batch',()=>{
 assert.throws(()=>validateEditionConfig({...simple(),quotas:{0:400,1:101}}),/EDITION_QUOTAS_OVER_500/);
 assert.throws(()=>validateEditionConfig({...simple(),maxTotalCoins:-1}),/EDITION_INVALID_LIMITS/);
 assert.throws(()=>validateEditionConfig({...simple(),quotas:{10:1},maxPrizesPerTicket:5}),/EDITION_QUOTA_ABOVE_MAX_10/);
});

test('Tic-Tac-Toe edition freezes its own reward amounts, odds and multiplier ceiling',()=>{
 const config={variantId:'tic_tac_toe',title:'Duell mit eigenem Münzplan',
  maxTotalCoins:100000000,maxPerTicketCoins:1000000,
  maxPrizesPerTicket:1,maxUnlocks:0,
  gameSettings:{coinAmounts:[111,444,999],symbolWeights:[1000,0,0,0],
   maxMultiplier:2,giftFallbackCoins:1000},
  quotas:{0:200}};
 const plan=planScratchEdition(config,settings);
 assert.equal(plan.summary.tickets,500);
 assert.equal(plan.summary.duds,200);
 for(const ticket of unpackEditionTickets(plan.packed)){
  assert.equal(ticket.board.variantId,'tic_tac_toe');
  assert.deepEqual(ticket.board.coinAmounts,[111,444,999]);
  assert.ok(ticket.board.multiplier>=1&&ticket.board.multiplier<=2);
  assert.equal(verifyScratchPrizes(ticket.board),true);
  if(ticket.winnings.length)assert.equal(ticket.winnings[0].amount,111*ticket.board.multiplier);
 }
});
test('DOG Jackpot edition accepts custom DOG frequency and exact 8-win quotas',()=>{
 const config={variantId:'dog_jackpot_9',title:'DOG-Jackpot acht Treffer',
  maxTotalCoins:200000000,maxPerTicketCoins:3000000,
  maxPrizesPerTicket:8,maxUnlocks:0,
  gameSettings:{coinAmounts:[10,20,30],symbolWeights:[1000,0,0,0],
   dogChancePer1000:1000,giftFallbackCoins:1500},
  quotas:{8:500}};
 const plan=planScratchEdition(config,settings);
 assert.equal(plan.summary.winners,500);
 assert.equal(plan.summary.byWins[8],500);
 assert.equal(plan.summary.totalCoins,500*8*10);
 for(const ticket of unpackEditionTickets(plan.packed)){
  assert.equal(ticket.winnings.length,8);
  assert.equal(ticket.totalCoins,80);
  assert.equal(verifyScratchPrizes(ticket.board),true);
 }
});


test('budget target guides 500 different scratch payouts within tolerance',()=>{
 const config={...simple(),quotas:{0:100},maxTotalCoins:60000,
  maxPerTicketCoins:1000,targetTotalCoins:45000,targetTolerancePercent:10};
 const plan=planScratchEdition(config,settings);
 assert.equal(plan.summary.byWins[0],100);
 assert.equal(plan.summary.tickets,500);
 assert.equal(plan.summary.targetTotalCoins,45000);
 assert.ok(Math.abs(plan.summary.deltaToTarget)<=4500);
 assert.ok(plan.summary.totalCoins<=60000);
 const distribution=plan.summary.byWins.filter(n=>n>0);
 assert.ok(distribution.length>=2,'different levels of winning tickets');
});
test('premium print reserves exact ten-win tickets with all 27 symbols, no accidental full boards',()=>{
 const config={variantId:'premium_27',title:'Lichtertal Gold 27/27',
  maxTotalCoins:30000000,maxPerTicketCoins:80000,
  maxPrizesPerTicket:10,maxUnlocks:15,premiumFull27Tickets:3,
  quotas:{10:3,4:497}};
 const plan=planScratchEdition(config,settings);
 assert.equal(plan.summary.premiumFull27Tickets,3);
 assert.equal(plan.summary.byWins[10],3);
 assert.equal(plan.summary.byWins[4],497);
 let full=0;
 for(const ticket of unpackEditionTickets(plan.packed)){
  assert.equal(verifyScratchPrizes(ticket.board),true);
  if(ticket.board.cells.every(s=>s!=='🧊')){
   full++;
   assert.equal(ticket.winnings.length,10);
   assert.ok(ticket.winnings.some(w=>w.milestone==='premium-24'));
   assert.ok(ticket.winnings.some(w=>w.milestone==='gold-20'));
  }
 }
 assert.equal(full,3);
});
test('premium full27 printing rejects impossible prize/quantity constraints',()=>{
 assert.throws(()=>validateEditionConfig({
  variantId:'premium_27',title:'bad',maxTotalCoins:1000000,
  maxPerTicketCoins:100000,maxPrizesPerTicket:6,maxUnlocks:0,
  premiumFull27Tickets:1,quotas:{10:1}
 }),/EDITION_FULL27_NEEDS_TEN_WINS_AND_UNLOCKS/);
});
