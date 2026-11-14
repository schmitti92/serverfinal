import test from 'node:test';
import assert from 'node:assert/strict';
import {creditSkyjoPackVouchers,skyjoPackVoucherBalances,SKYJO_PACK_IDS} from '../skyjo-pack-vouchers.js';
import {DOG_S2_PACKS,dogS2OpenGrantedPacks} from '../dog-album-season2.js';

test('SKYJO vouchers use the exact DOG season-2 package identifiers',()=>{
 assert.deepEqual(SKYJO_PACK_IDS,DOG_S2_PACKS.map(p=>p.id));
 assert.deepEqual(skyjoPackVoucherBalances(),{small:0,large:0,premium:0,platinum:0});
});

test('A SKYJO slot pack of quantity 3 credits three unopened free DOG vouchers',()=>{
 const old={small:2,large:1,premium:0,platinum:0};
 const prizes=[{kind:'pack',id:'large',quantity:3},{kind:'pack',id:'premium',quantity:1},
  {kind:'chest',id:'gold',quantity:2},{kind:'cash',amountCents:10000}];
 const result=creditSkyjoPackVouchers(old,prizes);
 assert.deepEqual(result,{small:2,large:4,premium:1,platinum:0});
 assert.equal(old.large,1,'Do not mutate the previous account balance');
 assert.deepEqual(skyjoPackVoucherBalances(old),old);
});

test('Multiple rounds add vouchers instead of replacing previous prizes',()=>{
 const round1=creditSkyjoPackVouchers({},[{kind:'pack',id:'small',quantity:3}]);
 const round2=creditSkyjoPackVouchers(round1,[{kind:'pack',id:'small',quantity:1},{kind:'pack',id:'platinum',quantity:2}]);
 assert.deepEqual(round2,{small:4,large:0,premium:0,platinum:2});
});

test('Invalid, fractional, forged, or excessive vouchers are rejected before credit',()=>{
 for(const bad of [
  [{kind:'pack',id:'mega',quantity:1}],
  [{kind:'pack',id:'large',quantity:0}],
  [{kind:'pack',id:'large',quantity:4}],
  [{kind:'pack',id:'large',quantity:1.5}],
  [{kind:'pack',id:'large',quantity:'2'}],
 ])assert.throws(()=>creditSkyjoPackVouchers({},bad),/SKYJO_PACK_INVALID/);
 assert.throws(()=>skyjoPackVoucherBalances({small:-1}),/SKYJO_PACK_BALANCE_INVALID/);
 assert.throws(()=>creditSkyjoPackVouchers({small:1000000},[{kind:'pack',id:'small',quantity:1}]),/SKYJO_PACK_BALANCE_LIMIT/);
});

test('Redeemable voucher is compatible with existing season-2 DOG opening function',()=>{
 const pack=DOG_S2_PACKS.find(p=>p.id==='large');
 const opened=dogS2OpenGrantedPacks(pack.id,1,{},()=>0);
 assert.equal(opened.openedPacks.length,1);
 assert.equal(opened.openedPacks[0].revealed.length,pack.count);
 assert.ok(opened.openedPacks[0].revealed.every(c=>typeof c.image==='string'&&typeof c.isNew==='boolean'));
 assert.equal(Object.values(opened.cards).reduce((a,b)=>a+b,0),pack.count);
});
