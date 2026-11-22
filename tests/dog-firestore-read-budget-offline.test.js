import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDogFirestoreReadBudget} from '../dog-firestore-read-budget.js';

test('DOG read counter tracks transaction read attempts without triggering extra reads',async()=>{
 let now=650_000,gets=0,writes=0;
 const budget=createDogFirestoreReadBudget({clock:()=>now});
 const reference={path:'spielesammlung_hub_v1/CONFIDENTIAL_ROOM'};
 const tx={async get(ref){assert.equal(ref,reference);gets++;return {exists:true,data:()=>({secret:42})}},
  set(ref,value){assert.equal(ref,reference);assert.deepEqual(value,{revision:2});writes++}};
 const observed=budget.trackTransaction(tx);
 assert.equal((await observed.get(reference)).data().secret,42);
 observed.set(reference,{revision:2});
 budget.record('http-room-get',reference);
 budget.record('watch-notification',reference);
 const result=budget.snapshot();
 assert.equal(gets,1);
 assert.equal(writes,1);
 assert.equal(result.transactionGetAttempts,1);
 assert.equal(result.httpRoomGetResults,1);
 assert.equal(result.watchNotifications,1);
 assert.equal(result.byCollection.spielesammlung_hub_v1,3);
 assert.doesNotMatch(JSON.stringify(result),/CONFIDENTIAL_ROOM|secret|42/);
 now+=11*60*1000;
 assert.equal(budget.snapshot().transactionGetAttempts,0,'old per-minute data expires');
});

test('failed/retried document attempts are visible but reported as SDK calls, not billed reads',async()=>{
 const budget=createDogFirestoreReadBudget();
 let tries=0;
 const tx={async get(){tries++;if(tries===1)throw Error('network');return {exists:true}}};
 const observed=budget.trackTransaction(tx);
 await assert.rejects(observed.get({path:'dog_player_statistics_v1/PRIVATE_UID'}),/network/);
 await observed.get({path:'dog_player_statistics_v1/PRIVATE_UID'});
 assert.equal(tries,2);
 assert.equal(budget.snapshot().transactionGetAttempts,2);
 assert.match(budget.snapshot().scope,/not Firebase billable/);
 assert.doesNotMatch(JSON.stringify(budget.snapshot()),/PRIVATE_UID/);
});

test('DOG route integration counts reads/stream messages without changing authoritative writes',()=>{
 const source=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
 assert.match(source,/const dogReadBudget=createDogFirestoreReadBudget\(\{clock\}\)/);
 assert.match(source,/const observedTx=source==='dog-action'\?dogReadBudget\.trackTransaction\(tx\):tx/);
 assert.match(source,/const snap=await observedTx\.get\(ref\)/);
 assert.match(source,/dogCoreReadAttempts10m:dogReadBudget\.snapshot\(\)/);
 assert.match(source,/dogReadBudget\.record\('watch-notification',COLLECTION\)/);
 assert.match(source,/dogReadBudget\.record\('http-room-get',COLLECTION\)/);
 assert.match(source,/writeTx\.set\(ref,room\)/);
 assert.match(source,/documentFor\(store,code\)\.onSnapshot/);
});
