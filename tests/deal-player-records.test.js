import test from 'node:test';
import assert from 'node:assert/strict';
import {DEAL_JACKPOT_CENTS,SLOT_JACKPOT_CENTS,addDealRecord,addSlotMoneyRecords,viewPrizeRecord} from '../deal-player-records.js';

test('first verified Deal payout seeds the records and never uses total wallet balance',()=>{
 const wallet={balance:1_000_000_000,games:99,wins:22};
 const record=addDealRecord(wallet,1);
 assert.deepEqual(record,{count:1,minCents:1,maxCents:1,jackpots:0});
 assert.equal(wallet.balance,1_000_000_000);
 const next=addDealRecord({dealPrizeStats:record},30_000_000);
 assert.deepEqual(next,{count:2,minCents:1,maxCents:30_000_000,jackpots:0});
 assert.equal(addDealRecord({dealPrizeStats:next},10_000).minCents,1);
});
test('50 million original Deal win counts as jackpot, x2 wallet bonus does not',()=>{
 const record=addDealRecord({},DEAL_JACKPOT_CENTS);
 assert.equal(DEAL_JACKPOT_CENTS,5_000_000_000);
 assert.deepEqual(record,{count:1,minCents:DEAL_JACKPOT_CENTS,maxCents:DEAL_JACKPOT_CENTS,jackpots:1});
 const again=addDealRecord({dealPrizeStats:record},1_000_000_000);
 assert.equal(again.jackpots,1);
 assert.equal(again.maxCents,DEAL_JACKPOT_CENTS);
 assert.throws(()=>addDealRecord({},10_000_000_000),/INVALID_DEAL_RECORD/);
});
test('Slot cash records each paid reel, excluding other items and retaining exact cents',()=>{
 const first=addSlotMoneyRecords({},[1,500_000_000,4_000_000]);
 assert.deepEqual(first,{count:3,minCents:1,maxCents:SLOT_JACKPOT_CENTS,jackpots:1});
 const second=addSlotMoneyRecords({slotCashPrizeStats:first},[SLOT_JACKPOT_CENTS,5]);
 assert.deepEqual(second,{count:5,minCents:1,maxCents:SLOT_JACKPOT_CENTS,jackpots:2});
 assert.throws(()=>addSlotMoneyRecords({},[SLOT_JACKPOT_CENTS+1]),/INVALID_SLOT_RECORD/);
});
test('legacy wallets show no false minima/maxima; no reads or writes are required',()=>{
 assert.deepEqual(viewPrizeRecord(undefined),{count:0,minCents:null,maxCents:null,jackpots:0});
 assert.deepEqual(viewPrizeRecord({count:4,minCents:0,maxCents:500,jackpots:1}),
  {count:4,minCents:0,maxCents:500,jackpots:1});
 assert.deepEqual(addSlotMoneyRecords({},[]),{count:0,minCents:null,maxCents:null,jackpots:0});
});
