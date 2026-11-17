import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeScratchSettings} from '../dog/christmas-scratch-settings.js';
import {verifyScratchPrizes} from '../dog/christmas-scratch-grid.js';
import {
 SCRATCH_PRINT_SIZE,validateEditionConfig,planScratchEdition,
 newEditionDocument,unpackEditionTickets,editionPublic,issueEditionTicket,scratchEditionCatalog,editionMinimumBudget
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
test('33 reserved two-win cards keep their exact quantity in a 500-card print',()=>{
 const plan=planScratchEdition({
  ...simple(),maxTotalCoins:5000000,maxPerTicketCoins:1000000,
  quotas:{2:33}
 },settings);
 assert.equal(plan.summary.tickets,500);
 assert.equal(plan.summary.byWins[2],33);
 assert.equal(unpackEditionTickets(plan.packed).filter(ticket=>
  ticket.winnings.length===2).length,33);
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


test('each of the seven lots exposes real geometry, lines and prize ceilings',()=>{
 const entries=scratchEditionCatalog(settings);
 assert.equal(entries.length,7);
 const byId=Object.fromEntries(entries.map(row=>[row.variantId,row]));
 assert.equal(byId.gifts.lineCount,8);
 assert.equal(byId.snow_collect.lineCount,null);
 assert.equal(byId.elf.lineCount,null);
 assert.equal(byId.premium_27.lineCount,9);
 assert.equal(byId.premium_27.minWins,4);
 assert.equal(byId.premium_27.maxWins,10);
 assert.equal(byId.tic_tac_toe.lineCount,8);
 assert.equal(byId.tic_tac_toe.scratchFields,11);
 assert.equal(byId.tic_tac_toe.maxWins,1);
 assert.equal(byId.number_one_20.lineCount,20);
 assert.equal(byId.number_one_20.maxWins,20);
 assert.equal(byId.dog_jackpot_9.lineCount,0);
 assert.equal(byId.dog_jackpot_9.maxWins,8);
 assert.equal(byId.gifts.standardPrice,200);
 assert.equal(byId.premium_27.standardPrice,1000);
});
test('ticket price is printed with 500-ticket theoretical revenue and charged exactly once',()=>{
 const config={...simple(),ticketPrice:777,quotas:{0:500}};
 const plan=planScratchEdition(config,settings);
 assert.equal(plan.config.ticketPrice,777);
 assert.equal(plan.summary.ticketPrice,777);
 assert.equal(plan.summary.projectedGrossRevenue,388500);
 assert.equal(plan.summary.projectedNetCoins,388500);
 assert.equal(plan.summary.payoutRatioPercent,0);
 const doc=newEditionDocument(plan,'host',1763430000000);
 const request={tier:'simple',variantId:'gifts',commandId:'price_777_tested'};
 const purchase=issueEditionTicket(doc,{coins:2000,owned:{}},null,request,{
  settings,now:()=>1763430100000});
 assert.equal(purchase.result.price,777);
 assert.equal(purchase.wallet.coins,1223);
 assert.equal(purchase.doc.issued,1);
 const replay=issueEditionTicket(purchase.doc,purchase.wallet,null,request,{
  settings,now:()=>1763430101000});
 assert.equal(replay.unchanged,true);
 assert.equal(replay.wallet.coins,1223);
 assert.throws(()=>validateEditionConfig({...config,ticketPrice:1000001}),
  /EDITION_TICKET_PRICE_INVALID/);
});


test('every light prize is bound to a visible star badge and limited across the 500-ticket print run',()=>{
 const limits={
  lights:{min:2,max:5,maxTotal:630,chancePer1000:1000},
  coin:{min:1,max:1000,maxTotal:2000000},
  note:{min:5,max:2000,maxTotal:2000000},
  case:{min:20,max:5000,maxTotal:2000000}
 };
 const config={...simple(),maxTotalCoins:5000000,maxPerTicketCoins:30000,
  quotas:{},symbolBudgets:limits};
 const plan=planScratchEdition(config,settings);
 assert.equal(plan.summary.tickets,500);
 assert.ok(plan.summary.totalLights>0);
 assert.ok(plan.summary.totalLights<=630);
 let awarded=0,seen=0;const categoryTotals={coin:0,note:0,case:0,lights:0,gift:0};
 for(const ticket of unpackEditionTickets(plan.packed)){
  assert.equal(verifyScratchPrizes(ticket.board),true);
  const lights=ticket.winnings.filter(x=>x.type==='lights');
  if(lights.length){
   seen++;
   assert.equal(lights.length,1);
   assert.equal(lights[0].symbol,'⭐');
   assert.ok(lights[0].amount>=2&&lights[0].amount<=5);
   assert.ok(Number.isInteger(ticket.lightBadgeIndex));
   assert.ok(ticket.lightBadgeIndex>=0&&ticket.lightBadgeIndex<ticket.board.cells.length);
   awarded+=lights[0].amount;
  }
  for(const p of ticket.winnings){
   const id=p.type==='lights'?'lights':p.type==='coins'?
    ({'🪙':'coin','💵':'note','💼':'case'}[p.symbol]):null;
   if(!id)continue;
   assert.ok(p.amount>=limits[id].min);
   assert.ok(p.amount<=limits[id].max);
   categoryTotals[id]+=p.amount;
  }
 }
 assert.ok(seen>20);
 assert.equal(awarded,plan.summary.totalLights);
 assert.deepEqual(categoryTotals,plan.summary.symbolTotals);
 for(const [id,limit] of Object.entries(limits))assert.ok(categoryTotals[id]<=limit.maxTotal);
 const doc=newEditionDocument(plan,'host',1763430000000);
 let wallet={coins:100000,owned:{}},edition=doc;
 for(let i=0;i<Math.min(20,seen);i++){
  const result=issueEditionTicket(edition,wallet,null,{
   tier:'simple',variantId:'gifts',commandId:'light_print_test_'+i
  },{settings,now:()=>1763430100000+i});
  edition=result.doc;wallet=result.wallet;
 }
 assert.equal(edition.issued,20);
 assert.ok(edition.issuedLights<=doc.summary.totalLights);
});
test('invalid per-symbol ranges and light frequency are rejected before publishing',()=>{
 assert.throws(()=>validateEditionConfig({...simple(),
  symbolBudgets:{lights:{min:1,max:5,maxTotal:10,chancePer1000:1200}}}),
  /EDITION_SYMBOL_BUDGET_INVALID_lights/);
 assert.throws(()=>validateEditionConfig({...simple(),
  symbolBudgets:{case:{min:100,max:50,maxTotal:1000}}}),
  /EDITION_SYMBOL_BUDGET_INVALID_case/);
});


test('gift symbol has an independent 500-ticket quantity cap and lights can demand a minimum total',()=>{
 const cfg={...simple(),maxPrizesPerTicket:10,
  symbolBudgets:{
   gift:{min:0,max:0,minTotal:0,maxTotal:0},
   lights:{min:2,max:2,minTotal:1,maxTotal:1000,chancePer1000:1000}
  },quotas:{}};
 const plan=planScratchEdition(cfg,settings);
 assert.equal(plan.summary.symbolTotals.gift,0);
 assert.ok(plan.summary.symbolTotals.lights>=1);
 assert.ok(plan.summary.symbolTotals.lights<=1000);
 for(const ticket of unpackEditionTickets(plan.packed))
  assert.ok(ticket.winnings.every(prize=>prize.type!=='unlock'));
 const impossible={...cfg,symbolBudgets:{
  ...cfg.symbolBudgets,
  lights:{min:1,max:1,minTotal:1,maxTotal:500,chancePer1000:0}
 }};
 assert.throws(()=>planScratchEdition(impossible,settings),
  /EDITION_SYMBOL_MIN_TOTAL_UNREACHABLE_lights/);
});


test('Christmas light badges can be printed in each of the seven scratch-game formats',()=>{
 const variants=[
  ['gifts','simple'],['snow_collect','simple'],['elf','medium'],
  ['premium_27','premium'],['tic_tac_toe','medium'],
  ['number_one_20','medium'],['dog_jackpot_9','premium']
 ];
 for(const [variantId,tier] of variants){
  const config={variantId,title:'Lichter-Edition '+variantId,
   ticketPrice:100,maxTotalCoins:100000000,maxPerTicketCoins:1000000,
   maxPrizesPerTicket:20,maxUnlocks:500,
   symbolBudgets:{lights:{min:1,max:4,minTotal:1,maxTotal:2000,chancePer1000:1000}},
   quotas:{}};
  const plan=planScratchEdition(config,settings);
  assert.equal(plan.config.tier,tier);
  assert.ok(plan.summary.totalLights>0,variantId+' must contain star rewards');
  assert.ok(plan.summary.totalLights<=2000);
  assert.equal(plan.summary.tickets,500);
  const cards=unpackEditionTickets(plan.packed);
  const winner=cards.find(ticket=>ticket.totalLights>0);
  assert.ok(winner,variantId+' must have at least one payable light ticket');
  assert.ok(winner.winnings.some(win=>win.type==='lights'&&win.symbol==='⭐'));
  assert.ok(winner.lightBadgeIndex>=0);
  assert.ok(winner.lightBadgeIndex<winner.board.cells.length);
  assert.equal(verifyScratchPrizes(winner.board),true);
 }
});


test('every DOG scratch variant prints payable ×2 symbols with immutable verified boards',()=>{
 const cases=[
  ['gifts','simple'],['snow_collect','simple'],['elf','medium'],
  ['premium_27','premium'],['tic_tac_toe','medium'],
  ['number_one_20','medium'],['dog_jackpot_9','premium']
 ];
 for(const [variantId,tier] of cases){
  const config={variantId,title:'×2 Bonus für '+variantId,ticketPrice:100,
   maxTotalCoins:100000000,maxPerTicketCoins:1500000,
   maxPrizesPerTicket:variantId==='number_one_20'?20:10,
   maxUnlocks:300,quotas:{},doubleWin:{
    chancePer1000:1000,minTickets:1,maxTickets:12
   }};
  const plan=planScratchEdition(config,settings);
  assert.equal(plan.config.tier,tier);
  assert.ok(plan.summary.doubleWinTickets>=1,variantId+' should include ×2');
  assert.ok(plan.summary.doubleWinTickets<=12,variantId+' must obey ×2 cap');
  let verifiedDoubles=0,extraCoins=0,extraLights=0,total=0;
  for(const ticket of unpackEditionTickets(plan.packed)){
   assert.equal(verifyScratchPrizes(ticket.board),true,variantId);
   assert.equal(ticket.totalCoins,ticket.winnings.filter(x=>x.type==='coins')
    .reduce((a,p)=>a+p.amount,0));
   total+=ticket.totalCoins;
   if(!ticket.doubleWin)continue;
   verifiedDoubles++;
   assert.ok(Number.isSafeInteger(ticket.doubleBadgeIndex));
   assert.ok(ticket.doubleBadgeIndex>=0&&ticket.doubleBadgeIndex<ticket.board.cells.length);
   assert.equal(ticket.doubleWin.symbol,'✖️2');
   const doubled=ticket.winnings.filter(p=>p.x2);
   assert.ok(doubled.length>0);
   for(const prize of doubled)assert.equal(prize.amount,prize.baseAmount*2);
   assert.equal(ticket.doubleWin.extraCoins,ticket.doubleWin.baseCoins);
   assert.equal(ticket.doubleWin.extraLights,ticket.doubleWin.baseLights);
   extraCoins+=ticket.doubleWin.extraCoins;
   extraLights+=ticket.doubleWin.extraLights;
  }
  assert.equal(plan.summary.totalCoins,total);
  assert.equal(plan.summary.doubleWinTickets,verifiedDoubles);
  assert.equal(plan.summary.doubleExtraCoins,extraCoins);
  assert.equal(plan.summary.doubleExtraLights,extraLights);
 }
});
test('×2 never changes unlock count and never ignores edition symbol budgets',()=>{
 const plan=planScratchEdition({...simple(),
  maxTotalCoins:1000000,maxPerTicketCoins:5000,maxUnlocks:15,
  symbolBudgets:{
   coin:{min:1,max:1000,minTotal:0,maxTotal:450000},
   note:{min:2,max:1500,minTotal:0,maxTotal:450000},
   case:{min:4,max:3000,minTotal:0,maxTotal:450000},
   gift:{min:0,max:2,minTotal:0,maxTotal:15},
   lights:{min:1,max:6,minTotal:0,maxTotal:400,chancePer1000:300}
  },
  doubleWin:{chancePer1000:250,minTickets:0,maxTickets:50}
 },settings);
 assert.equal(plan.summary.tickets,500);
 assert.ok(plan.summary.doubleWinTickets<=50);
 for(const [key,range] of Object.entries(plan.config.symbolBudgets)){
  assert.ok(plan.summary.symbolTotals[key]<=range.maxTotal,key+' ×2 budget');
 }
 for(const ticket of unpackEditionTickets(plan.packed)){
  assert.equal(verifyScratchPrizes(ticket.board),true);
  assert.ok(ticket.totalCoins<=5000);
  assert.equal(ticket.winnings.filter(p=>p.type==='unlock').length,
   ticket.board.wins.filter(w=>w.prize?.type==='unlock').length);
 }
 assert.throws(()=>validateEditionConfig({...simple(),
  doubleWin:{chancePer1000:1001,minTickets:0,maxTickets:50}}),
  /EDITION_DOUBLE_INVALID/);
 assert.throws(()=>validateEditionConfig({...simple(),
  doubleWin:{chancePer1000:200,minTickets:100,maxTickets:40}}),
  /EDITION_DOUBLE_INVALID/);
});


test('a ×2 star ticket doubles the lights credited to the shared village and keeps the payout within print limits',()=>{
 const cfg={...simple(),maxTotalCoins:10000000,maxPerTicketCoins:150000,
  maxPrizesPerTicket:10,maxUnlocks:100,quotas:{},
  symbolBudgets:{lights:{min:1,max:10,minTotal:1,maxTotal:5000,chancePer1000:1000}},
  doubleWin:{chancePer1000:1000,minTickets:5,maxTickets:60}};
 const plan=planScratchEdition(cfg,settings);
 const results=unpackEditionTickets(plan.packed);
 const winners=results.filter(t=>t.doubleWin&&t.doubleWin.extraLights>0);
 assert.ok(winners.length>0,'at least one ×2 card must award double Christmas lights');
 for(const card of winners){
  const light=card.winnings.find(p=>p.type==='lights');
  assert.ok(light);
  assert.equal(light.amount,light.baseAmount*2);
  assert.equal(card.totalLights,light.amount);
  assert.equal(card.doubleWin.extraLights,light.baseAmount);
  assert.equal(verifyScratchPrizes(card.board),true);
 }
 assert.equal(plan.summary.totalLights,
  results.reduce((sum,card)=>sum+(card.totalLights||0),0));
 assert.ok(plan.summary.totalLights<=5000);
});

test('five specifically reserved eight-win Lucky Number cards are guaranteed in a 500-card print run',()=>{
 const plan=planScratchEdition({
  variantId:'number_one_20',title:'Genau fünf Lose mit acht Gewinnen',
  maxTotalCoins:100000000,maxPerTicketCoins:1000000,
  maxPrizesPerTicket:20,maxUnlocks:0,quotas:{8:5},
  gameSettings:{...settings.numberOne20,hitPer1000:100,
   coinAmounts:[10,20,30],symbolWeights:[1000,0,0,0]}
 },settings);
 const tickets=unpackEditionTickets(plan.packed);
 assert.equal(tickets.length,500);
 assert.equal(plan.summary.byWins[8],5,'exactly 5 printed cards have 8 individual payouts');
 assert.equal(tickets.filter(card=>card.winnings.length===8).length,5);
 for(const card of tickets){
  assert.equal(verifyScratchPrizes(card.board),true);
  if(card.winnings.length===8)assert.equal(card.board.hitPer1000,400);
 }
});

test('budget preflight proves a lower bound without changing the exact 33 two-win quota',()=>{
 const input={...simple(),maxTotalCoins:600,maxPerTicketCoins:1000,maxUnlocks:0,
  quotas:{2:33},targetTotalCoins:null};
 const estimate=editionMinimumBudget(input,settings);
 assert.equal(estimate.minimumCoins,660);
 assert.equal(estimate.fixedTickets,33);
 assert.throws(()=>planScratchEdition(input,settings),
  /EDITION_BUDGET_MIN_REQUIRED_660_AVAILABLE_600/);
 assert.equal(editionMinimumBudget({...input,maxTotalCoins:1000},settings).minimumCoins,660);
});
test('premium four real cash rows set a safe minimum budget for every print',()=>{
 const input={variantId:'premium_27',title:'Minimum',maxTotalCoins:399999,
  maxPerTicketCoins:10000,maxPrizesPerTicket:10,maxUnlocks:0,quotas:{}};
 const floor=editionMinimumBudget(input,settings);
 assert.equal(floor.minimumCoins,500*4*200);
 assert.throws(()=>planScratchEdition(input,settings),
  /EDITION_BUDGET_MIN_REQUIRED_400000_AVAILABLE_399999/);
});
test('unsupported exact counts fail immediately and zero-sized quotas do not reserve a count',()=>{
 assert.throws(()=>validateEditionConfig({...simple(),maxPrizesPerTicket:20,
  quotas:{15:1}}),/EDITION_UNSUPPORTED_WIN_COUNT_15/);
 const accepted=validateEditionConfig({...simple(),quotas:{0:0,2:33}});
 assert.deepEqual(accepted.quotas,{2:33});
});
test('all 500 Lucky Number eight-hit boards can be printed even when regular odds are zero',()=>{
 const input={variantId:'number_one_20',title:'20 Reihen exakt',
  maxTotalCoins:2000000,maxPerTicketCoins:100000,maxPrizesPerTicket:20,
  maxUnlocks:0,quotas:{8:500},
  gameSettings:{...settings.numberOne20,coinAmounts:[10,20,30],
   symbolWeights:[1000,0,0,0],hitPer1000:0}};
 const plan=planScratchEdition(input,settings);
 assert.equal(plan.summary.byWins[8],500);
 for(const card of unpackEditionTickets(plan.packed)){
  assert.equal(card.winnings.length,8);
  assert.equal(card.board.cells.filter((n,i)=>i%2===1&&n===1).length,8);
  assert.equal(verifyScratchPrizes(card.board),true);
 }
});
test('Finde DOG exact eight-hit quotas use actual DOG boards even at zero random chance',()=>{
 const input={variantId:'dog_jackpot_9',title:'DOG Garantie',
  maxTotalCoins:1000000,maxPerTicketCoins:10000,maxPrizesPerTicket:8,
  maxUnlocks:0,quotas:{8:500},
  gameSettings:{coinAmounts:[10,20,30],symbolWeights:[1000,0,0,0],
   dogChancePer1000:0,giftFallbackCoins:1500}};
 const plan=planScratchEdition(input,settings);
 assert.equal(plan.summary.byWins[8],500);
 for(const card of unpackEditionTickets(plan.packed)){
  assert.equal(card.board.cells.includes('DOG'),true);
  assert.equal(card.winnings.length,8);
  assert.equal(verifyScratchPrizes(card.board),true);
 }
});
