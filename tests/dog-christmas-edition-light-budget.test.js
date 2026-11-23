import test from 'node:test';
import assert from 'node:assert/strict';
import {createGiftsEdition,issueGiftsEditionTicket} from '../dog/christmas-gifts-edition.js';
import {createSnowEdition,issueSnowEditionTicket} from '../dog/christmas-snow-edition.js';
import {remainingScratchEditionLights,SCRATCH_EDITION_LIGHT_REDUCTION} from '../dog/christmas-scratch.js';

const random=()=>{
 let seed=271828182;
 return max=>{
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  return Math.floor(seed/4294967296*max);
 };
};
const specs=[
 ['gifts',createGiftsEdition,issueGiftsEditionTicket],
 ['snow_collect',createSnowEdition,issueSnowEditionTicket]
];
test('each 500-ticket edition has 100 fewer base-odds Christmas lights',()=>{
 assert.equal(SCRATCH_EDITION_LIGHT_REDUCTION,100);
 for(const [,create] of specs){
  const edition=create({id:'lights-1',createdAt:1,createdBy:'owner',maxTotalCoins:0,settings:null});
  // Legacy base odds: 500 x 10% x 5.5 = 275 lights.
  assert.equal(edition.lightBudgetRemaining,175);
  assert.equal(remainingScratchEditionLights(edition),175);
 }
});
test('every full edition pays its reduced light budget exactly with no duplicate credits',()=>{
 for(const [variant,create,issue] of specs){
  let edition=create({id:'lights-2',createdAt:1,createdBy:'owner',maxTotalCoins:0,settings:null});
  let wallet={coins:500000};
  let sum=0;
  const draw=random();
  for(let i=0;i<500;i++){
   const request={tier:'simple',variantId:variant,commandId:'light-test-'+variant+'-'+i};
   const step=issue(wallet,null,request,edition,null,{draw});
   const lights=step.purchase.result.totalLights;
   assert.ok(Number.isInteger(lights)&&lights>=0);
   assert.ok(lights<=edition.lightBudgetRemaining);
   assert.equal(step.edition.lightBudgetRemaining,edition.lightBudgetRemaining-lights);
   wallet=step.purchase.wallet;
   edition=step.edition;
   sum+=lights;
  }
  assert.equal(sum,175,variant+' 500 printed tickets');
  assert.equal(edition.lightBudgetRemaining,0);
  assert.equal(edition.issued,500);
 }
});
test('an already running legacy edition loses 100 only from its future expected lights',()=>{
 for(const [,create] of specs){
  const raw=create({id:'legacy',createdAt:1,createdBy:'owner',maxTotalCoins:0,settings:null});
  delete raw.lightBudgetRemaining;
  raw.issued=100;
  // 400 x 10% x 5.5 = 220 less 100.
  assert.equal(remainingScratchEditionLights(raw),120);
 }
});
