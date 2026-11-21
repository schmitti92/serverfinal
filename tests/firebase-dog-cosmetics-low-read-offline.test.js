import test from 'node:test';
import assert from 'node:assert/strict';
import {installSharedLobby} from '../shared-lobby.js';
import {DOG_LEVEL_THRESHOLDS} from '../dog/player-levels.js';
import {DOG_SCRATCH_COLLECTION} from '../dog/christmas-scratch.js';
import {DOG_TREE_REWARDS_COLLECTION} from '../dog/christmas-tree-rewards.js';
import {DOG_PLAYER_STATS_COLLECTION} from '../dog/player-stats.js';

function harness(){
 const docs=new Map(),reads=[],routes=new Map();
 const store={collection:name=>({doc:id=>({path:name+'/'+id,async get(){
  const path=name+'/'+id;reads.push(path);
  const value=docs.get(path);
  return {exists:value!==undefined,data:()=>structuredClone(value)};
 }})})};
 const app={get:(path,...handlers)=>routes.set(path,handlers),post(){},use(){}};
 let clock=1_000_000;
 installSharedLobby(app,{getFirestore:()=>store,
  verifyProfile:async token=>token==='alice-token'?{uid:'alice',name:'Alice'}:
   token==='bob-token'?{uid:'bob',name:'Bob'}:null,clock:()=>clock,
  christmasEventActive:()=>false});
 async function call(token){
  const headers={authorization:token?'Bearer '+token:''};
  const req={get:header=>headers[header.toLowerCase()]||'',method:'GET',
   route:{path:'/api/hub/dog/cosmetics'}};
  const response={statusCode:200,status(n){this.statusCode=n;return this},
   json(data){this.body=data;return this}};
  const handlers=routes.get('/api/hub/dog/cosmetics');
  assert.ok(handlers,'compact authenticated cosmetics endpoint registered');
  let next=false;
  await handlers[0](req,response,()=>{next=true});
  if(next)await handlers.at(-1)(req,response);
  return {status:response.statusCode,...response.body};
 }
 return {docs,reads,call,advance:ms=>{clock+=ms}};
}

test('DOG cosmetics authentication reads exactly three personal documents',async()=>{
 const t=harness();
 const rewardId='christmas2026:cards:kartendesign-02';
 t.docs.set(DOG_SCRATCH_COLLECTION+'/alice',{owned:{}});
 t.docs.set(DOG_TREE_REWARDS_COLLECTION+'/alice',{claims:{level3:{unlockId:rewardId}}});
 t.docs.set(DOG_PLAYER_STATS_COLLECTION+'/alice',{xp:DOG_LEVEL_THRESHOLDS[19]+3});
 const first=await t.call('alice-token');
 assert.equal(first.status,200);
 assert.equal(first.ok,true);
 assert.equal(first.level,20);
 assert.equal(first.nikolausCardRewardConfigured,true);
 assert.ok(first.ownedUnlockIds.includes(rewardId));
 assert.deepEqual(t.reads.sort(),[
  DOG_PLAYER_STATS_COLLECTION+'/alice',
  DOG_SCRATCH_COLLECTION+'/alice',
  DOG_TREE_REWARDS_COLLECTION+'/alice'
 ].sort());
 assert.equal(t.reads.some(path=>/settings|edition|village|research/.test(path)),false,
  'cosmetics must never open scratch editions, settings or village');
 await t.call('alice-token');
 assert.equal(t.reads.length,3,'repeated verification uses the 30s server cache');
});

test('DOG cosmetics cannot leak another account and unauthenticated requests read zero documents',async()=>{
 const t=harness();
 assert.equal((await t.call(null)).status,401);
 assert.equal((await t.call('fake')).status,401);
 assert.equal(t.reads.length,0);
 const alice=await t.call('alice-token');
 assert.equal(alice.level,1);
 const bob=await t.call('bob-token');
 assert.equal(bob.level,1);
 assert.deepEqual(alice.ownedUnlockIds,[]);
 assert.deepEqual(bob.ownedUnlockIds,[]);
 assert.equal(t.reads.length,6,'each account has separate private cache keys');
});
