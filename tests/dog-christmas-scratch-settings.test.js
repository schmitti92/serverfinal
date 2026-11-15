import test from 'node:test';
import assert from 'node:assert/strict';
import {DOG_SCRATCH_DEFAULT_SETTINGS,normalizeScratchSettings,validateScratchSettings} from '../dog/christmas-scratch-settings.js';
import {buyScratchTicket} from '../dog/christmas-scratch.js';
const clone=v=>JSON.parse(JSON.stringify(v));
const draw=(roll)=>{let first=true;return max=>{if(first){first=false;return roll}return 0}};
test('four scratch variants have independent defaults and validated percentages',()=>{
 const s=normalizeScratchSettings(null);
 assert.deepEqual(Object.keys(s.variants),['gifts','snow_collect','elf','premium_27']);
 assert.equal(s.freeEnabled,false);
 assert.equal(s.variants.premium_27.maxPrizes,3);
 assert.equal(validateScratchSettings(s).variants.gifts.weights.unlock,111);
 const bad=clone(s);bad.variants.elf.weights.unlock=1001;
 assert.throws(()=>validateScratchSettings(bad),/SCRATCH_SETTINGS_INVALID/);
 const notHundred=clone(s);notHundred.variants.gifts.weights.coins=10;
 assert.throws(()=>validateScratchSettings(notHundred),/SCRATCH_SETTINGS_INVALID/);
 const wrongPremium=clone(s);wrongPremium.variants.premium_27.maxPrizes=1;
 assert.throws(()=>validateScratchSettings(wrongPremium),/SCRATCH_SETTINGS_INVALID/);
 assert.equal(normalizeScratchSettings({freeEnabled:true,variants:{gifts:bad.variants.elf}}).freeEnabled,true);
 assert.deepEqual(normalizeScratchSettings({}).variants.premium_27.weights,DOG_SCRATCH_DEFAULT_SETTINGS.variants.premium_27.weights);
});
test('free mode applies to premium without coins or daily limits, and can be revoked',()=>{
 const config=clone(DOG_SCRATCH_DEFAULT_SETTINGS);config.freeEnabled=true;
 const base={coins:0,daily:'2026-11-15'};
 const receipt=buyScratchTicket(base,null,{tier:'premium',free:true,commandId:'scratch-free-premium-101'},
   {settings:config,draw:draw(0),now:()=>Date.parse('2026-11-15T12:00:00Z')});
 assert.equal(receipt.result.price,0);
 assert.equal(receipt.wallet.daily,'2026-11-15');
 assert.equal(receipt.status.settings.freeEnabled,true);
 assert.throws(()=>buyScratchTicket(base,null,{tier:'premium',free:true,commandId:'scratch-free-premium-102'},
   {draw:draw(0)}),/SCRATCH_FREE_ONLY_SIMPLE/);
});
test('per-variant win caps retain verified payout combinations',()=>{
 const config=clone(DOG_SCRATCH_DEFAULT_SETTINGS);
 for(const id of Object.keys(config.variants)){
  config.variants[id].maxPrizes=id==='premium_27'?2:1;
  config.variants[id].extraCoinChance=100;
  config.variants[id].weights={none:0,coins:1000,unlock:0};
 }
 for(const tier of ['simple','medium','premium']){
  const result=buyScratchTicket({coins:10000},null,
   {tier,commandId:'scratch-cap-'+tier},
   {settings:config,draw:draw(0)});
  assert.ok(result.result.winnings.length<=config.variants[result.result.board.variantId].maxPrizes);
  assert.equal(result.result.board.wins.length,result.result.winnings.length);
 }
});
