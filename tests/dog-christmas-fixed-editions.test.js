import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixedEditionPlan,editFixedEdition,fixedEditionPlanTotal,
 remainingFixedEditionPlan} from '../dog/christmas-edition-plan.js';
import {updateGiftScratchSettings,updateSnowScratchSettings} from '../dog/christmas-scratch-settings.js';
import {createGiftsEdition,issueGiftsEditionTicket,giftsEditionPublic} from '../dog/christmas-gifts-edition.js';
import {createSnowEdition,issueSnowEditionTicket,snowEditionPublic} from '../dog/christmas-snow-edition.js';
import {readFileSync} from 'node:fs';

function config(variant){
 const input={price:0,nonePer1000:200,unlockPer1000:0,
  coinAmounts:[10,50,100],maxPrizes:3,extraCoinChance:15,
  doubleChancePer1000:500,lightChancePer1000:0,lightMin:1,lightMax:2};
 return variant==='gifts'?updateGiftScratchSettings(null,input):
  updateSnowScratchSettings(null,input);
}
function dice(){
 let seed=42;
 return max=>{
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  return Math.floor(seed/4294967296*max);
 };
}
const configs=['gifts','snow_collect'];

test('exact fixed budget planner assigns only visible winning triples, including real x2',()=>{
 const settings=config('gifts').variants.gifts;
 for(const amount of [0,10,300,190,60000]){
  const plan=createFixedEditionPlan(amount,settings);
  assert.equal(plan.length,500);
  assert.equal(fixedEditionPlanTotal(plan,settings),amount);
  for(const rows of plan){
   assert.ok(rows.length<=3);
   assert.equal(new Set(rows.map(v=>v%3)).size,rows.length);
  }
 }
 assert.throws(()=>createFixedEditionPlan(123,settings),
  /SCRATCH_EDITION_FIXED_BUDGET_UNREACHABLE/,'non-divisible budget must not claim to be guaranteed');
 assert.throws(()=>createFixedEditionPlan(1000000000000,settings),
  /SCRATCH_EDITION_FIXED_BUDGET_UNREACHABLE/,'budget beyond visible card capacity must be rejected');
});

for(const variant of configs)test(variant+' pays the EXACT full fixed budget after all 500 sales',()=>{
 const settings=config(variant),initial=variant==='gifts'?
  createGiftsEdition({id:'edition-gifts',createdAt:1,createdBy:'owner',maxTotalCoins:60000,settings}):
  createSnowEdition({id:'edition-snow',createdAt:1,createdBy:'owner',maxTotalCoins:60000,settings});
 assert.ok(remainingFixedEditionPlan(initial));
 assert.equal(initial.budgetMode,'fixed');
 const issue=variant==='gifts'?issueGiftsEditionTicket:issueSnowEditionTicket;
 const status=variant==='gifts'?giftsEditionPublic:snowEditionPublic;
 const draw=dice();
 let edition=initial,wallet={coins:1000000},total=0;
 for(let i=0;i<500;i++){
  const receipt=issue(wallet,null,{tier:'simple',variantId:variant,
   commandId:variant+'-exact-'+i},edition,settings,{draw});
  const planned=edition.prizePlan[i].reduce((sum,code)=>
   sum+edition.config.coinAmounts[code%3]*(code>=3?2:1),0);
  assert.equal(receipt.purchase.result.totalCoins,planned,'card '+i);
  assert.equal(receipt.edition.paidCoins,edition.paidCoins+planned);
  assert.equal(receipt.edition.issued,i+1);
  assert.ok(receipt.purchase.result.board.wins.every(x=>
   x.prize&&x.indices.length===3),'all prizes have visible winning symbols');
  total+=receipt.purchase.result.totalCoins;
  wallet=receipt.purchase.wallet;edition=receipt.edition;
 }
 assert.equal(total,60000);
 assert.equal(edition.paidCoins,edition.maxTotalCoins);
 assert.equal(status(edition).remainingCoins,0);
 assert.equal(status(edition).status,'sold_out');
});

for(const variant of configs)test(variant+' can revise only unissued rows without altering prior receipts',()=>{
 const settings=config(variant),issue=variant==='gifts'?issueGiftsEditionTicket:issueSnowEditionTicket;
 const create=variant==='gifts'?createGiftsEdition:createSnowEdition;
 let edition=create({id:'edited-'+variant,createdAt:1,createdBy:'owner',maxTotalCoins:1000,settings});
 let wallet={coins:100000},draw=dice(),receipts=[];
 for(let i=0;i<40;i++){
  const result=issue(wallet,null,{tier:'simple',variantId:variant,
   commandId:'before-edit-'+i},edition,settings,{draw});
  edition=result.edition;wallet=result.purchase.wallet;
  receipts.push(result.purchase.result);
 }
 const immutable=edition.prizePlan.slice(0,40).map(row=>[...row]);
 const paid=edition.paidCoins;
 const nextBudget=paid+450;
 const revised=editFixedEdition(edition,{settings,maxTotalCoins:nextBudget,now:12345});
 assert.equal(revised.issued,40);
 assert.equal(revised.paidCoins,paid);
 assert.equal(revised.id,edition.id);
 assert.deepEqual(revised.prizePlan.slice(0,40),immutable);
 assert.equal(revised.revision,edition.revision+1);
 assert.equal(fixedEditionPlanTotal(revised.prizePlan.slice(40),revised.config),450);
 assert.equal(revised.updatedAt,12345);
 for(let i=40;i<500;i++){
  const result=issue(wallet,null,{tier:'simple',variantId:variant,
   commandId:'after-edit-'+i},i===40?revised:edition,settings,{draw});
  wallet=result.purchase.wallet;edition=result.edition;
 }
 assert.equal(edition.issued,500);
 assert.equal(edition.paidCoins,nextBudget);
 assert.equal(receipts.length,40,'previous cards keep their original receipts');
 assert.throws(()=>editFixedEdition(revised,{settings,maxTotalCoins:paid-1}),
  /SCRATCH_EDITION_FIXED_BUDGET_BELOW_PAID/);
});

test('server editing requires same current ID/revision and is protected by Firestore transaction',()=>{
 const source=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
 assert.match(source,/SCRATCH_EDITION_ONLY_CREATOR/);
 assert.match(source,/SCRATCH_EDITION_CHANGED/);
 assert.match(source,/req\.body\?\.expectedRevision!==revision/);
 assert.match(source,/tx\.set\(currentRef,next\)/);
 assert.match(source,/editions\/gifts\/edit/);
 assert.match(source,/editions\/snow_collect\/edit/);
});
