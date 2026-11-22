import test from 'node:test';
import assert from 'node:assert/strict';
import {dogFirebaseBudgetSummary} from '../dog-firebase-budget-summary.js';
import {createDogWriteDiagnostics} from '../dog-write-diagnostics.js';
import {createDogFirestoreReadBudget} from '../dog-firestore-read-budget.js';

test('Render DOG budget shows real saved aggregate counts but makes no Firebase billing claims',()=>{
 const writes={writeCalls:21,noops:3,byCollection:{
  spielesammlung_hub_v1:20,dog_christmas_villages_v1:1
 },byKind:{'dog-match':{transactions:20,writeCalls:21}}};
 const reads={transactionGetAttempts:6,httpRoomGetResults:4,watchNotifications:20};
 const report=dogFirebaseBudgetSummary({writes,reads});
 assert.equal(report.windowMinutes,10);
 assert.equal(report.status,'normal');
 assert.equal(report.writeCalls,21);
 assert.equal(report.roomWrites,20);
 assert.equal(report.nonRoomWrites,1);
 assert.equal(report.dogMatchCommittedOperations,20);
 assert.equal(report.sdkTransactionGetsPerCommittedDogMatchOperation,0.3);
 assert.equal(report.roomWritesPerCommittedDogMatchOperation,1);
 assert.equal(report.totalReadSignals,30);
 assert.equal(report.billingVerified,false);
 assert.match(report.measurement,/not/i);
});

test('Missing DOG traffic reports no activity, not a fictitious 100% saving',()=>{
 const report=dogFirebaseBudgetSummary();
 assert.equal(report.status,'no-observed-dog-traffic');
 assert.equal(report.roomWritesPerCommittedDogMatchOperation,null);
 assert.equal(report.sdkTransactionGetsPerCommittedDogMatchOperation,null);
 assert.equal(report.writeCalls,0);
 assert.equal(report.watchNotifications,0);
 assert.equal(report.billingVerified,false);
});

test('500 observed DOG writes in 10m trigger a critical alert, but no action is blocked',()=>{
 const critical=dogFirebaseBudgetSummary({
  writes:{writeCalls:500,byCollection:{spielesammlung_hub_v1:490,dog_player_statistics_v1:10}},
  reads:{watchNotifications:80}
 });
 assert.equal(critical.status,'critical');
 assert.equal(critical.warning.writeLevel,'critical');
 assert.equal(critical.roomWrites,490);
 assert.equal(critical.nonRoomWrites,10);
 assert.equal(critical.warning.triggerWriteCalls10m,500);
 const elevated=dogFirebaseBudgetSummary({writes:{writeCalls:100}});
 assert.equal(elevated.status,'elevated');
 assert.equal(elevated.warning.writeLevel,'elevated');
 assert.equal(dogFirebaseBudgetSummary({writes:{writeCalls:99}}).status,'normal');
});

test('An abnormal watch notification storm is separate from actual Firestore document writes',()=>{
 const report=dogFirebaseBudgetSummary({
  writes:{writeCalls:3,byCollection:{spielesammlung_hub_v1:3}},
  reads:{watchNotifications:2500}
 });
 assert.equal(report.status,'critical');
 assert.equal(report.warning.readLevel,'critical');
 assert.equal(report.warning.writeLevel,'normal');
 assert.equal(report.transactionGetAttempts,0);
 assert.equal(report.httpRoomGetResults,0);
 assert.equal(report.watchNotifications,2500);
 assert.equal(report.billingVerified,false);
});

test('Non-room writes can be distinguished while arbitrary private document paths are never exposed',()=>{
 const report=dogFirebaseBudgetSummary({
  roomCollection:'rooms_v2',
  writes:{writeCalls:4,byCollection:{rooms_v2:2,'dog_wallet/PRIVATE_UID':2}}
 });
 assert.equal(report.roomWrites,2);
 assert.equal(report.nonRoomWrites,2);
 assert.equal(JSON.stringify(report).includes('PRIVATE_UID'),false);
});

test('Real bounded SDK counters can feed health report without generating any Firestore calls',()=>{
 let clock=600000;
 const write=createDogWriteDiagnostics({clock:()=>clock});
 const read=createDogFirestoreReadBudget({clock:()=>clock});
 write.record('dog-match',{spielesammlung_hub_v1:1},true);
 read.record('transaction-document-get','spielesammlung_hub_v1/123');
 read.record('watch-notification','spielesammlung_hub_v1/123');
 let report=dogFirebaseBudgetSummary({writes:write.snapshot(),reads:read.snapshot()});
 assert.equal(report.writeCalls,1);
 assert.equal(report.transactionGetAttempts,1);
 assert.equal(report.watchNotifications,1);
 assert.equal(JSON.stringify(report).includes('123'),false,'no room codes in metrics');
 clock+=11*60*1000;
 report=dogFirebaseBudgetSummary({writes:write.snapshot(),reads:read.snapshot()});
 assert.equal(report.status,'no-observed-dog-traffic');
 assert.equal(report.writeCalls,0);
 assert.equal(report.transactionGetAttempts,0);
});
