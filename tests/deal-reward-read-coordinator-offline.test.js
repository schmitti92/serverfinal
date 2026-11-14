import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDealRewardReadCoordinator} from '../deal-reward-read-coordinator.js';

const COLLECTIONS=[
 'deal_christmas_final_rewards_v1',
 'deal_christmas_banker_rewards_v1',
 'deal_christmas_cent_rewards_v1'
];
function makeDb(){
 const documents=new Map();
 const gets=new Map();
 const waits=new Map();
 const db={
  collection:name=>({doc:id=>{
   const path=name+'/'+id;
   return {path,get:async()=>{
    gets.set(path,(gets.get(path)||0)+1);
    const value=structuredClone(documents.get(path));
    if(waits.has(path))await waits.get(path);
    return {exists:value!==undefined,data:()=>structuredClone(value)};
   }};
  }})
 };
 return {db,documents,gets:path=>gets.get(path)||0,
  hold:path=>{let release;waits.set(path,new Promise(r=>release=r));return ()=>{waits.delete(path);release()}}
 };
}

test('Concurrent spectators share one reward receipt Firestore GET per document',async()=>{
 const f=makeDb(),cache=createDealRewardReadCoordinator();
 const path=COLLECTIONS[0]+'/match_123';
 f.documents.set(path,{gameId:'match_123',packId:'premium'});
 const resume=f.hold(path);
 const ref=()=>f.db.collection(COLLECTIONS[0]).doc('match_123');
 const seen=Promise.all([cache.read(f.db,ref()),cache.read(f.db,ref()),cache.read(f.db,ref())]);
 resume();
 const result=await seen;
 assert.ok(result.every(x=>x.exists&&x.data().packId==='premium'));
 assert.equal(f.gets(path),1,'three same-receipt GETs cause one Firestore read');
 assert.equal(cache.snapshot().sharedReads,2);
 assert.equal(cache.snapshot().firestoreGets,1);
 assert.equal(cache.snapshot().ttlMs,0);
 // A later nonoverlapping request MUST see a fresh committed receipt.
 f.documents.set(path,{gameId:'match_123',packId:'legendary'});
 assert.equal((await cache.read(f.db,ref())).data().packId,'legendary');
 assert.equal(f.gets(path),2);
});

test('Each receipt, reward collection and Firestore instance remain independent',async()=>{
 const f=makeDb(),g=makeDb(),cache=createDealRewardReadCoordinator();
 const refs=COLLECTIONS.map((name,i)=>f.db.collection(name).doc('r_'+i));
 refs.forEach((ref,i)=>f.documents.set(ref.path,{part:i}));
 const values=await Promise.all(refs.map(ref=>cache.read(f.db,ref)));
 assert.deepEqual(values.map(x=>x.data().part),[0,1,2]);
 assert.deepEqual(refs.map(ref=>f.gets(ref.path)),[1,1,1]);
 const samePath=COLLECTIONS[0]+'/r_0';
 g.documents.set(samePath,{part:9});
 assert.equal((await cache.read(g.db,g.db.collection(COLLECTIONS[0]).doc('r_0'))).data().part,9);
 assert.equal(f.gets(samePath),1);
 assert.equal(g.gets(samePath),1);
});

test('Locally committed game action invalidates in-flight precommit reward GET',async()=>{
 const f=makeDb(),cache=createDealRewardReadCoordinator();
 const path=COLLECTIONS[2]+'/old_event';
 const resume=f.hold(path),ref=()=>f.db.collection(COLLECTIONS[2]).doc('old_event');
 const old=cache.read(f.db,ref());
 await Promise.resolve();await Promise.resolve();
 // A committed reward has appeared in Firestore while the earlier GET waits.
 f.documents.set(path,{gameId:'match',packId:'gold'});
 cache.invalidateAll();
 const fresh=cache.read(f.db,ref());
 resume();
 const [before,after]=await Promise.all([old,fresh]);
 assert.equal(before.exists,false,'older request may complete with precommit snapshot');
 assert.equal(after.exists,true,'new request must never join precommit GET');
 assert.equal(after.data().packId,'gold');
 assert.equal(f.gets(path),2);
 assert.equal(cache.snapshot().invalidations,1);
});

test('Failed reward reads are retried and invalid paths are rejected',async()=>{
 const cache=createDealRewardReadCoordinator();
 let reads=0;
 const db={},ref={path:COLLECTIONS[1]+'/receipt',get:async()=>{
  reads++;
  if(reads===1)throw Error('SIMULATED_FIRESTORE_ERROR');
  return {exists:true,data:()=>({name:'winner'})};
 }};
 await assert.rejects(()=>cache.read(db,ref),/SIMULATED_FIRESTORE_ERROR/);
 assert.equal((await cache.read(db,ref)).data().name,'winner');
 assert.equal(reads,2);
 assert.equal(cache.snapshot().errors,1);
 await assert.rejects(()=>cache.read(db,{path:'deal_or_no_deal_wallets_v1/user',get:async()=>({})}),/INVALID_REWARD_READ/);
});

test('Only authorized GET reward views share receipts; settlement still uses transactions',()=>{
 const api=readFileSync(new URL('../deal-or-no-deal-api.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 assert.match(api,/createDealRewardReadCoordinator\(\)/);
 assert.match(api,/rewardReadCoordinator\.invalidateAll\(\);\s*const listeners=dealSockets\.get\(code\)/);
 for(const coll of COLLECTIONS)assert.match(api,new RegExp('rewardReadCoordinator\\.read\\(db,db\\.collection\\(\\\''+coll+'\\\'\\)'));
 assert.match(api,/rewardReadStats:\(\)=>rewardReadCoordinator\.snapshot\(\)/);
 assert.match(server,/dealRewardReadCache:dealOrNoDealOnline\.rewardReadStats\(\)/);
 assert.match(api,/app\.post\('\/api\/deal-or-no-deal\/christmas\/season2\/super-slot\/play'[\s\S]*?db\.runTransaction/);
 assert.match(api,/tx\.create\(e\.receipt/);
 assert.match(api,/tx\.get\(rewardRef\)/);
});
