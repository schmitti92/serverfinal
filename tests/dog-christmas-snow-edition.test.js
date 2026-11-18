import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buyScratchTicket} from '../dog/christmas-scratch.js';
import {normalizeScratchSettings,updateSnowScratchSettings} from '../dog/christmas-scratch-settings.js';
import {createSnowEdition,snowEditionPublic,issueSnowEditionTicket,SNOW_EDITION_SIZE} from '../dog/christmas-snow-edition.js';

const base=()=>updateSnowScratchSettings(null,{
 price:200,nonePer1000:0,unlockPer1000:0,
 coinAmounts:[10,50,100],maxPrizes:3,extraCoinChance:20,
 doubleChancePer1000:1000,lightChancePer1000:1000,lightMin:2,lightMax:2
});
const dice=()=>{
 let seed=34567123;
 return max=>{
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  return Math.floor(seed/4294967296*max);
 };
};
const create=(budget=300)=>createSnowEdition({
 id:'snow-test-series',createdAt:Date.parse('2026-11-17T20:00:00Z'),
 createdBy:'test-user',maxTotalCoins:budget,settings:base()
});
const request=id=>({tier:'simple',variantId:'snow_collect',commandId:'snow-series-'+id});

test('a 500-ticket Schneeflocken-Bingo series stores immutable prize rules and validates its maximum',()=>{
 const settings=base(),series=create();
 assert.equal(series.size,500);
 assert.equal(series.maxTotalCoins,300);
 assert.equal(series.issued,0);
 assert.deepEqual(series.config.coinAmounts,[10,50,100]);
 assert.equal(snowEditionPublic(series).remainingCoins,300);
 assert.throws(()=>createSnowEdition({id:'x',createdAt:1,createdBy:'u',maxTotalCoins:-1,settings}),
  /SCRATCH_SNOW_EDITION_INVALID_BUDGET/);
 assert.throws(()=>createSnowEdition({id:'x',createdAt:1,createdBy:'u',maxTotalCoins:1.1,settings}),
  /SCRATCH_SNOW_EDITION_INVALID_BUDGET/);
});

test('combined 500-series payouts cannot exceed the configured maximum, including doubled prizes',()=>{
 const settings=base(),draw=dice();
 let edition=create(190),wallet={coins:1000000};
 for(let i=0;i<18;i++){
  const issued=issueSnowEditionTicket(wallet,null,request(i),edition,settings,{draw});
  assert.equal(issued.edition.issued,i+1);
  assert.ok(issued.purchase.result.totalCoins>=0);
  assert.ok(issued.edition.paidCoins<=190,'entire series coin budget never exceeded');
  assert.equal(issued.edition.paidCoins,
   edition.paidCoins+issued.purchase.result.totalCoins);
  wallet=issued.purchase.wallet;edition=issued.edition;
 }
 assert.equal(snowEditionPublic(edition).remaining,500-18);
 assert.equal(snowEditionPublic(edition).remainingCoins,190-edition.paidCoins);
});

test('zero-budget fallback still issues a valid scratch ticket without spending coins',()=>{
 const settings=base();
 const run=create(0);
 const issued=issueSnowEditionTicket({coins:10000},null,request('zero'),run,settings,
  {draw:dice()});
 assert.equal(issued.purchase.result.totalCoins,0);
 assert.equal(issued.edition.paidCoins,0);
 assert.equal(issued.edition.issued,1);
 assert.equal(issued.purchase.result.board.variantId,'snow_collect');
 assert.ok(issued.purchase.result.totalLights>0,'lights are a separate reward');
});

test('the 500th purchase closes the edition, and replay does not consume a second slot',()=>{
 const settings=base();
 const edition={...create(0),issued:499};
 const purchase=issueSnowEditionTicket({coins:10000},null,request('final'),edition,settings,
  {draw:dice()});
 assert.equal(purchase.edition.issued,SNOW_EDITION_SIZE);
 assert.equal(snowEditionPublic(purchase.edition).status,'sold_out');
 const replay=issueSnowEditionTicket(purchase.purchase.wallet,null,request('final'),purchase.edition,settings,
  {draw:()=>{throw Error('must not draw again')}});
 assert.equal(replay.purchase.unchanged,true);
 assert.equal(replay.edition.issued,500);
 assert.throws(()=>issueSnowEditionTicket(purchase.purchase.wallet,null,request('next'),purchase.edition,settings,
  {draw:dice()}),/SCRATCH_SNOW_EDITION_SOLD_OUT/);
});

test('the server updates the wallet and edition ledger in the same transaction',()=>{
 const source=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
 assert.match(source,/issueSnowEditionTicket\(wallet,tree,request,snowSnap\.data\(\),settings,options\)/);
 assert.match(source,/if\(nextSnowEdition\)tx\.set\(snowEditionRef,nextSnowEdition\)/);
 assert.match(source,/SCRATCH_SNOW_EDITION_ACTIVE/);
});
