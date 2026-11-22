import test from 'node:test';
import assert from 'node:assert/strict';
import {
 OTHER_EDITION_VARIANTS,OTHER_EDITION_DEFAULT,validateOtherEditionConfig,
 createOtherEdition,createOtherEditionPlan,otherPlanTotal,otherTicketAmount,
 otherEditionPublic,editOtherEdition,issueOtherEditionTicket
} from '../dog/christmas-other-editions.js';
import {verifyScratchPrizes} from '../dog/christmas-scratch-grid.js';
const zero=()=>0;
const fixtureBudgets={
 elf:100000,
 premium_27:2000000,
 number_one_20:100000,
 dog_jackpot_9:400000
};
for(const variant of OTHER_EDITION_VARIANTS){
 test('500 '+variant+' tickets preallocate the EXACT fixed budget',()=>{
  const c=validateOtherEditionConfig(variant,OTHER_EDITION_DEFAULT[variant]);
  const budget=fixtureBudgets[variant];
  const plan=createOtherEditionPlan(variant,budget,c,500,zero);
  assert.equal(plan.length,500);
  assert.equal(otherPlanTotal(variant,plan,c),budget);
  assert.ok(plan.every(code=>Number.isSafeInteger(otherTicketAmount(variant,code,c))));
  const e=createOtherEdition({id:variant,createdAt:Date.parse('2026-11-23T00:00:00Z'),createdBy:'admin',
   variant,maxTotalCoins:budget,config:c,draw:zero});
  assert.equal(e.prizePlan.length,500);
  assert.equal(otherEditionPublic(e).remaining,500);
  assert.equal(otherEditionPublic(e).maxTotalCoins,budget);
  const actual=issueOtherEditionTicket(null,null,{
   tier:['premium_27','dog_jackpot_9'].includes(variant)?'premium':'medium',
   variantId:variant,commandId:'other-edition-test-'+variant
  },e,null,{draw:zero,now:()=>12345});
  assert.equal(actual.edition.issued,1);
  assert.equal(actual.purchase.result.totalCoins,otherTicketAmount(variant,e.prizePlan[0],c));
  assert.equal(verifyScratchPrizes(actual.purchase.result.board),true);
  const replay=issueOtherEditionTicket(actual.purchase.wallet,null,{
   tier:['premium_27','dog_jackpot_9'].includes(variant)?'premium':'medium',
   variantId:variant,commandId:'other-edition-test-'+variant
  },actual.edition,null,{draw:()=>{throw Error('REPLAY_WAS_REDRAWN')},now:()=>12345});
  assert.equal(replay.purchase.unchanged,true);
  assert.equal(replay.edition.issued,1);
  const changed=editOtherEdition(actual.edition,{
   config:{...c,prizeCategory:c.prizeCategory===3?2:3},
   maxTotalCoins:budget,draw:zero,now:12346
  });
  assert.equal(changed.issued,1);
  assert.equal(changed.prizePlan[0],actual.edition.prizePlan[0]);
  assert.equal(otherPlanTotal(variant,changed.prizePlan.slice(1),changed.config),
   budget-actual.edition.paidCoins);
  assert.equal(changed.config.prizeCategory,c.prizeCategory===3?2:3);
 });
}
test('Premium 27 current edition prints exactly two visible paid money rows',()=>{
 const variant='premium_27';
 const c=OTHER_EDITION_DEFAULT[variant];
 const e=createOtherEdition({id:'premium-two',createdAt:Date.parse('2026-11-23T00:00:00Z'),createdBy:'admin',
  variant,maxTotalCoins:2000000,config:c,draw:zero});
 const a=issueOtherEditionTicket(null,null,{
  tier:'premium',variantId:variant,commandId:'p27-check-123456'
 },e,null,{draw:zero,now:()=>12345});
 assert.equal(a.purchase.result.board.symbolVersion,6);
 assert.equal(a.purchase.result.board.wins.filter(w=>w.rule==='row-3'&&w.prize?.type==='coins').length,2);
 assert.equal(a.purchase.result.winnings.filter(w=>w.type==='coins'&&w.milestone!=='gold-20').length,2);
});
test('current legacy Premium edition automatically converts unsold cards on purchase',()=>{
 const c=OTHER_EDITION_DEFAULT.premium_27;
 const oldCard='0'; // legacy v5: three denominations plus a fourth small win
 const oldAmount=otherTicketAmount('premium_27',oldCard,c);
 const raw={
  id:'live-old-premium',createdAt:Date.parse('2026-11-20T00:00:00Z'),createdBy:'admin',
  variantId:'premium_27',size:500,issued:1,paidCoins:oldAmount,
  maxTotalCoins:500*oldAmount,revision:3,budgetMode:'fixed',config:c,
  prizePlan:Array(500).fill(oldCard)
 };
 const publicBefore=otherEditionPublic(raw);
 assert.equal(publicBefore.config.price,1200,'active edition must show corrected price before any write');
 assert.equal(raw.config.price,1000,'historical source document remains untouched on a read');
 const issued=issueOtherEditionTicket({coins:10000},null,{
  tier:'premium',variantId:'premium_27',commandId:'premium-migrate-live'
 },raw,null,{draw:zero,now:()=>12345});
 assert.equal(issued.purchase.result.price,1200);
 assert.equal(issued.edition.config.price,1200);
 assert.equal(issued.edition.premiumPrice1200Applied,true);
 assert.equal(issued.edition.prizePlan[0],oldCard,'historical sold code must not change');
 assert.ok(issued.edition.prizePlan.slice(1).every(code=>code.startsWith('v6:')),
  'every remaining card must be converted to the two-row edition format');
 assert.equal(issued.edition.issued,2);
 assert.equal(issued.edition.paidCoins,oldAmount+issued.purchase.result.totalCoins);
 assert.equal(issued.purchase.result.board.symbolVersion,6);
 assert.equal(issued.purchase.result.board.wins.filter(win=>win.rule==='row-3'&&
  win.prize?.type==='coins').length,2);
 assert.equal(otherPlanTotal('premium_27',issued.edition.prizePlan.slice(2),c),
  raw.maxTotalCoins-issued.edition.paidCoins);
 assert.equal(verifyScratchPrizes(issued.purchase.result.board),true);
});
test('Premium edition pricing correction applies once to the live edition only',()=>{
 const c=OTHER_EDITION_DEFAULT.premium_27;
 const recent=createOtherEdition({id:'new-premium',variant:'premium_27',
  createdAt:Date.parse('2026-11-23T00:00:00Z'),createdBy:'admin',
  maxTotalCoins:2000000,config:c,draw:zero});
 assert.equal(otherEditionPublic(recent).config.price,1000,
  'future editions retain their own configurable price');
 const futureBuy=issueOtherEditionTicket({coins:2000},null,{
  tier:'premium',variantId:'premium_27',commandId:'future-premium-price'
 },recent,null,{draw:zero,now:()=>12345});
 assert.equal(futureBuy.purchase.result.price,1000);
 const current={...recent,id:'current-premium',
  createdAt:Date.parse('2026-11-20T00:00:00Z'),issued:0,revision:7};
 assert.equal(otherEditionPublic(current).config.price,1200);
 const bought=issueOtherEditionTicket({coins:10000},null,{
  tier:'premium',variantId:'premium_27',commandId:'active-premium-price'
 },current,null,{draw:zero,now:()=>12345});
 assert.equal(bought.purchase.result.price,1200);
 assert.equal(bought.edition.config.price,1200);
 assert.equal(bought.edition.premiumPrice1200Applied,true);
 const replay=issueOtherEditionTicket(bought.purchase.wallet,null,{
  tier:'premium',variantId:'premium_27',commandId:'active-premium-price'
 },bought.edition,null,{draw:()=>{throw Error('REPLAY_MUST_NOT_DRAW')},now:()=>12345});
 assert.equal(replay.purchase.unchanged,true);
 assert.equal(replay.purchase.result.price,1200);
 assert.equal(replay.edition.issued,1);
 const edited=editOtherEdition(bought.edition,{
  config:{...c,price:1300},maxTotalCoins:2000000,draw:zero});
 assert.equal(edited.config.price,1300,
  'after the one-time correction host edits can change price normally');
 const stillNew=createOtherEdition({id:'new-new-premium',variant:'premium_27',
  createdAt:Date.parse('2026-11-24T00:00:00Z'),createdBy:'admin',
  maxTotalCoins:2000000,config:c,draw:zero});
 assert.equal(otherEditionPublic(stillNew).config.price,1000);
});
test('Glückszahl 1 existing 500-coin edition is shown and sold for 600 coins',()=>{
 const variant='number_one_20',c=OTHER_EDITION_DEFAULT.number_one_20;
 const original=createOtherEdition({
  id:'running-lucky',variant,createdAt:Date.parse('2026-11-21T00:00:00Z'),
  createdBy:'admin',maxTotalCoins:100000,config:c,draw:zero
 });
 const alreadyPaid=otherTicketAmount(variant,original.prizePlan[0],c);
 const active={...original,issued:1,paidCoins:alreadyPaid,revision:7};
 const beforePlan=[...active.prizePlan];
 assert.equal(active.config.price,500);
 assert.equal(otherEditionPublic(active).config.price,600,
  'published active edition must show 600 BEFORE a purchase changes storage');
 const issued=issueOtherEditionTicket({coins:10000},null,{
  tier:'medium',variantId:variant,commandId:'active-lucky-price'
 },active,null,{draw:zero,now:()=>12345});
 assert.equal(issued.purchase.result.price,600);
 assert.equal(issued.edition.config.price,600);
 assert.equal(issued.edition.luckyPrice600Applied,true);
 assert.equal(issued.edition.issued,2);
 assert.equal(issued.edition.prizePlan[0],beforePlan[0],
  'the already issued prize must remain exactly as stored');
 assert.deepEqual(issued.edition.prizePlan,beforePlan,
  'changing the price alone must not redraw any prizes');
 assert.equal(issued.edition.paidCoins,alreadyPaid+issued.purchase.result.totalCoins);
 assert.ok(verifyScratchPrizes(issued.purchase.result.board));
 const replay=issueOtherEditionTicket(issued.purchase.wallet,null,{
  tier:'medium',variantId:variant,commandId:'active-lucky-price'
 },issued.edition,null,{draw:()=>{throw Error('DUPLICATE_RECEIPT_REPLAY_DREW')},now:()=>12345});
 assert.equal(replay.purchase.unchanged,true);
 assert.equal(replay.purchase.result.price,600);
 assert.equal(replay.edition.issued,2);
 const changed=editOtherEdition(issued.edition,{
  config:{...c,price:700},maxTotalCoins:100000,draw:zero});
 assert.equal(changed.config.price,700,'host may adjust price normally after correction');
});
test('editing currently running Glückszahl edition persists 600 and keeps issued ticket',()=>{
 const variant='number_one_20',c=OTHER_EDITION_DEFAULT.number_one_20;
 const original=createOtherEdition({id:'edit-lucky',variant,
  createdAt:Date.parse('2026-11-21T00:00:00Z'),createdBy:'admin',
  maxTotalCoins:100000,config:c,draw:zero});
 const active={...original,issued:1,
  paidCoins:otherTicketAmount(variant,original.prizePlan[0],c)};
 const edited=editOtherEdition(active,{config:c,maxTotalCoins:100000,draw:zero});
 assert.equal(edited.config.price,600);
 assert.equal(edited.luckyPrice600Applied,true);
 assert.equal(edited.prizePlan[0],active.prizePlan[0]);
 assert.equal(otherPlanTotal(variant,edited.prizePlan.slice(1),edited.config),
  edited.maxTotalCoins-edited.paidCoins);
});
test('new Glückszahl editions keep 500-coin default unless host changes them',()=>{
 const variant='number_one_20',c=OTHER_EDITION_DEFAULT.number_one_20;
 const future=createOtherEdition({id:'future-lucky',variant,
  createdAt:Date.parse('2026-11-23T00:00:00Z'),createdBy:'admin',
  maxTotalCoins:100000,config:c,draw:zero});
 assert.equal(otherEditionPublic(future).config.price,500);
 const bought=issueOtherEditionTicket({coins:10000},null,{
  tier:'medium',variantId:variant,commandId:'future-lucky-price'
 },future,null,{draw:zero,now:()=>12345});
 assert.equal(bought.purchase.result.price,500);
 assert.equal(bought.edition.luckyPrice600Applied,undefined);
 assert.equal(bought.edition.config.price,500);
});
test('Wichtelpfad stays 500 and wrong 600-coin adjustment gets reversed',()=>{
 const variant='elf',c=OTHER_EDITION_DEFAULT.elf;
 const original=createOtherEdition({id:'active-elf',variant,
  createdAt:Date.parse('2026-11-21T00:00:00Z'),createdBy:'admin',
  maxTotalCoins:100000,config:c,draw:zero});
 assert.equal(otherEditionPublic(original).config.price,500,
  'the price must not increase for the wrong variant');
 const adjusted={...original,config:{...c,price:600},
  mediumPrice600Applied:true,issued:1,
  paidCoins:otherTicketAmount(variant,original.prizePlan[0],c)};
 assert.equal(otherEditionPublic(adjusted).config.price,500,
  'already incorrectly repriced active editions show the restored price');
 const bought=issueOtherEditionTicket({coins:10000},null,{
  tier:'medium',variantId:variant,commandId:'undo-wrong-elf-price'
 },adjusted,null,{draw:zero,now:()=>12345});
 assert.equal(bought.purchase.result.price,500);
 assert.equal(bought.edition.config.price,500);
 assert.equal(bought.edition.mistakenMediumRepriceReverted,true);
 assert.equal(bought.edition.prizePlan[0],original.prizePlan[0]);
 assert.ok(verifyScratchPrizes(bought.purchase.result.board));
});
test('DOG 9 jackpot has either zero or eight actual paid fields',()=>{
 const variant='dog_jackpot_9',c=OTHER_EDITION_DEFAULT[variant];
 const e=createOtherEdition({id:'dog-eight',createdAt:Date.parse('2026-11-23T00:00:00Z'),createdBy:'admin',
  variant,maxTotalCoins:400000,config:c,draw:zero});
 const first=e.prizePlan.findIndex(code=>code.length===8);
 assert.ok(first>=0);
 // Purchase all preceding tickets in order (single wallet, independent command ids).
 let wallet=null,ledger=e;
 for(let i=0;i<=first;i++){
  const a=issueOtherEditionTicket(wallet,null,{
   tier:'premium',variantId:variant,commandId:'dog-jackpot-fixed-'+i
  },ledger,null,{draw:zero,now:()=>12345});
  wallet=a.purchase.wallet;ledger=a.edition;
  assert.equal(a.purchase.result.board.wins.length,e.prizePlan[i].length===8?8:0);
  assert.equal(verifyScratchPrizes(a.purchase.result.board),true);
 }
});
test('reject mathematically impossible budgets, invalid categories and malformed price',()=>{
 assert.throws(()=>createOtherEditionPlan('premium_27',0,OTHER_EDITION_DEFAULT.premium_27),
  /SCRATCH_OTHER_EDITION_BUDGET_UNREACHABLE/);
 assert.throws(()=>createOtherEditionPlan('elf',123,OTHER_EDITION_DEFAULT.elf),
  /SCRATCH_OTHER_EDITION_BUDGET_UNREACHABLE/);
 assert.throws(()=>validateOtherEditionConfig('elf',{...OTHER_EDITION_DEFAULT.elf,prizeCategory:4}),
  /SCRATCH_OTHER_EDITION_SETTINGS_INVALID/);
 assert.throws(()=>validateOtherEditionConfig('elf',{...OTHER_EDITION_DEFAULT.elf,
  nonePer1000:1000,giftPer1000:300}),/SCRATCH_OTHER_EDITION_SETTINGS_INVALID/);
});
