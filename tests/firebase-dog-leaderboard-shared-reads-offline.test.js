import test from 'node:test';
import assert from 'node:assert/strict';
import {installSharedLobby} from '../shared-lobby.js';
import {DOG_PLAYER_STATS_COLLECTION} from '../dog/player-stats.js';
import {DOG_SCRATCH_COLLECTION} from '../dog/christmas-scratch.js';
import {DOG_TREE_REWARDS_COLLECTION} from '../dog/christmas-tree-rewards.js';

function harness(){
 const docs=new Map(),routes=new Map(),reads=new Map(),holds=new Map();
 let transaction=Promise.resolve(),now=1000000;
 const snapshot=key=>{const exists=docs.has(key),value=structuredClone(docs.get(key));return {exists,data:()=>structuredClone(value)};};
 const store={
  collection:name=>({doc:id=>{
   const path=name+'/'+id;
   return {path,get:async()=>{
    reads.set(path,(reads.get(path)||0)+1);
    const copy=snapshot(path);
    if(holds.has(path))await holds.get(path);
    return copy;
   }};
  }}),
  runTransaction(action){
   const task=transaction.catch(()=>{}).then(async()=>{
    const changes=[];
    const tx={
     get:async ref=>snapshot(ref.path),
     set:(ref,data)=>changes.push(()=>docs.set(ref.path,structuredClone(data))),
     delete:ref=>changes.push(()=>docs.delete(ref.path))
    };
    const result=await action(tx);
    changes.forEach(f=>f());
    return result;
   });
   transaction=task.catch(()=>{});
   return task;
  }
 };
 const app={
  get:(path,...handlers)=>routes.set('GET '+path,handlers),
  post:(path,...handlers)=>routes.set('POST '+path,handlers),
  use(){}
 };
 installSharedLobby(app,{getFirestore:()=>store,verifyProfile:async()=>({uid:'alice',name:'Alice'}),
  codeGenerator:()=> '123',clock:()=>now,christmasEventActive:()=>true});
 async function call(method,url,user='alice',body={}){
  const parts=url.split('/');
  const found=[...routes.entries()].find(([key])=>{
   const [verb,pattern]=key.split(' '),segments=pattern.split('/');
   return verb===method&&segments.length===parts.length&&segments.every((s,i)=>s.startsWith(':')||s===parts[i]);
  });
  assert.ok(found,'HTTP route exists: '+method+' '+url);
  const [registered,handlers]=found,patterns=registered.split(' ')[1].split('/');
  const params=Object.fromEntries(patterns.flatMap((s,i)=>s.startsWith(':')?[[s.slice(1),parts[i]]]:[]));
  const req={method,route:{path:registered.split(' ')[1]},
   hubIdentity:{uid:user,name:user[0].toUpperCase()+user.slice(1)},params,body,get:()=>''};
  const res={statusCode:200,status(status){this.statusCode=status;return this},
   json(payload){this.body=payload;return this}};
  await handlers.at(-1)(req,res);
  return {status:res.statusCode,...res.body};
 }
 function hold(path){
  let release;const promise=new Promise(resolve=>{release=resolve});
  holds.set(path,promise);
  return ()=>{holds.delete(path);release()};
 }
 const count=path=>reads.get(path)||0;
 const leaderboard=(uid='alice')=>call('GET','/api/hub/rooms/123/dog/player-statistics',uid);
 async function setup(){
  assert.equal((await call('POST','/api/hub/rooms','alice')).status,200);
  assert.equal((await call('POST','/api/hub/rooms/123/join','bob')).status,200);
 }
 return {setup,docs,hold,count,reads,leaderboard,store,call,
  advance:ms=>{now+=ms}};
}
const roomPath='spielesammlung_hub_v1/123';
const statsA=DOG_PLAYER_STATS_COLLECTION+'/alice';
const statsB=DOG_PLAYER_STATS_COLLECTION+'/bob';
const scratchA=DOG_SCRATCH_COLLECTION+'/alice';
const treeA=DOG_TREE_REWARDS_COLLECTION+'/alice';
const wait=()=>new Promise(resolve=>setImmediate(resolve));

test('Concurrent player statistics for two authorized viewers share 1 physical read per document',async()=>{
 const h=harness();await h.setup();
 h.docs.set(statsA,{played:3,wins:2});
 h.docs.set(statsB,{played:2,wins:1});
 const releaseRoom=h.hold(roomPath),releaseStats=h.hold(statsA);
 const a=h.leaderboard('alice'),b=h.leaderboard('bob');
 await wait();
 assert.equal(h.count(roomPath),1,'same room read must be coalesced');
 releaseRoom();await wait();await wait();
 assert.equal(h.count(statsA),1,'Alice stats read only once');
 assert.equal(h.count(statsB),1,'Bob stats read only once');
 assert.equal(h.count(scratchA),1,'private scratch document read only once');
 assert.equal(h.count(treeA),1,'tree rewards document read only once');
 releaseStats();
 const [left,right]=await Promise.all([a,b]);
 assert.equal(left.status,200);
 assert.equal(right.status,200);
 assert.equal(left.players.length,2);
 assert.equal(right.players.length,2);
 assert.equal(left.players.find(x=>x.name==='Alice').you,true);
 assert.equal(right.players.find(x=>x.name==='Bob').you,true);
 assert.equal(right.players.find(x=>x.name==='Alice').you,false);
 assert.equal(left.players.find(x=>x.name==='Alice').dog.wins,2);
 assert.equal(right.players.find(x=>x.name==='Alice').dog.wins,2);
 assert.equal('uid' in left.players[0],false,'no UID in public comparison');
});

test('DOG read-only stats reuse a brief cache and refresh after 30 seconds',async()=>{
 const h=harness();await h.setup();
 h.docs.set(statsA,{played:3,wins:1});
 assert.equal((await h.leaderboard()).players.find(x=>x.name==='Alice').dog.wins,1);
 h.docs.set(statsA,{played:4,wins:2});
 const cached=await h.leaderboard();
 assert.equal(cached.players.find(x=>x.name==='Alice').dog.wins,1);
 assert.equal(h.count(statsA),1,'repeated browsing should not bill a new Firestore read');
 h.advance(30001);
 const latest=await h.leaderboard();
 assert.equal(latest.players.find(x=>x.name==='Alice').dog.wins,2);
 assert.equal(h.count(statsA),2,'bounded cache expires after 30 seconds');
 assert.equal(h.count(roomPath),2,'member validation remains authoritative');
});

test('Nonmembers never reach a private player statistic, wallet, or reward document',async()=>{
 const h=harness();await h.setup();
 const outsider=await h.leaderboard('mallory');
 assert.equal(outsider.status,403);
 assert.equal(h.count(roomPath),1);
 for(const collection of [DOG_PLAYER_STATS_COLLECTION,DOG_SCRATCH_COLLECTION,DOG_TREE_REWARDS_COLLECTION]){
  assert.equal(h.count(collection+'/alice'),0,'no private reads for unauthenticated room member');
  assert.equal(h.count(collection+'/bob'),0);
 }
});

test('DOG village and tree reward views coalesce only simultaneous GLOBAL reads across rooms',async()=>{
 const h=harness();await h.setup();
 const globalVillage='dog_christmas_villages_v1/lichtertal_2026_shared';
 // The actual collection/global id are server-defined, not supplied by clients.
 h.docs.set(globalVillage,{lightsTenths:250,levels:{tower:1,workshop:1,bakery:1,inn:1,luckhouse:1,academy:1}});
 const roomRelease=h.hold(roomPath),villageRelease=h.hold(globalVillage);
 const village=h.call('GET','/api/hub/rooms/123/dog/village','alice');
 const reward=h.call('GET','/api/hub/rooms/123/dog/tree-rewards','alice');
 await wait();
 assert.equal(h.count(roomPath),1,'authenticated room GET is shared');
 roomRelease();await wait();await wait();
 assert.equal(h.count(globalVillage),1,'same global document is read only once across endpoints');
 villageRelease();
 const [a,b]=await Promise.all([village,reward]);
 assert.equal(a.status,200);assert.equal(b.status,200);
 assert.equal(a.village.lightsTenths,250);
 assert.ok(b.treeRewards,'personal tree rewards still projected by server');
 h.docs.set(globalVillage,{lightsTenths:700});
 const next=await h.call('GET','/api/hub/rooms/123/dog/village','alice');
 assert.equal(next.village.lightsTenths,250,'brief read-only projection cache prevents repeated Firestore GETs');
 assert.equal(h.count(globalVillage),1);
 h.advance(30001);
 const refreshed=await h.call('GET','/api/hub/rooms/123/dog/village','alice');
 assert.equal(refreshed.village.lightsTenths,700,'eventual cross-instance updates are visible after TTL');
 assert.equal(h.count(globalVillage),2);
});

test('Kniffel statistics coalesce concurrent per-player GETs after membership validation',async()=>{
 const h=harness();await h.setup();
 const statsCollection='kniffel_player_stats_v1';
 const statsAlice=statsCollection+'/alice',statsBob=statsCollection+'/bob';
 h.docs.set(statsAlice,{wins:2,played:3,highestScore:64});
 h.docs.set(statsBob,{wins:1,played:4,highestScore:45});
 const roomRelease=h.hold(roomPath),statsRelease=h.hold(statsAlice);
 const a=h.call('GET','/api/hub/rooms/123/kniffel/stats','alice');
 const b=h.call('GET','/api/hub/rooms/123/kniffel/stats','bob');
 await wait();assert.equal(h.count(roomPath),1,'room validation still coalesced');
 roomRelease();await wait();await wait();
 assert.equal(h.count(statsAlice),1);
 assert.equal(h.count(statsBob),1);
 statsRelease();
 const result=await Promise.all([a,b]);
 assert.equal(result[0].stats[0].wins,2);
 assert.equal(result[1].stats[1].wins,1);
 const denied=await h.call('GET','/api/hub/rooms/123/kniffel/stats','mallory');
 assert.equal(denied.status,403);
 assert.equal(h.count(statsAlice),1,'outsider does not reach financial or stats docs');
 h.docs.set(statsAlice,{wins:4,played:5});
 const cached=await h.call('GET','/api/hub/rooms/123/kniffel/stats','alice');
 assert.equal(cached.stats[0].wins,2);
 assert.equal(h.count(statsAlice),1);
 h.advance(30001);
 const fresh=await h.call('GET','/api/hub/rooms/123/kniffel/stats','alice');
 assert.equal(fresh.stats[0].wins,4);
 assert.equal(h.count(statsAlice),2,'stale read-only comparison expires after 30 seconds');
});

test('successful Christmas intro write invalidates the in-memory read cache immediately',async()=>{
 const h=harness();await h.setup();
 h.docs.set('dog_christmas_event_access_v1/alice',{uid:'alice',access:true});
 const intro='dog_christmas_intro_unlock_v1/alice';
 const before=await h.call('GET','/api/hub/dog/christmas-intro','alice');
 assert.equal(before.completed,false);
 const again=await h.call('GET','/api/hub/dog/christmas-intro','alice');
 assert.equal(again.completed,false);
 assert.equal(h.count(intro),1,'duplicate status view uses the cached read');
 const acknowledged=await h.call('POST','/api/hub/dog/christmas-intro/complete','alice');
 assert.equal(acknowledged.status,200);
 assert.equal(acknowledged.completed,true);
 const after=await h.call('GET','/api/hub/dog/christmas-intro','alice');
 assert.equal(after.completed,true,'successful mutation must clear stale read-only views');
 assert.equal(h.count(intro),2);
});
