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
