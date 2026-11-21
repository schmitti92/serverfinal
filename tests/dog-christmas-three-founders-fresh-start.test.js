import test from 'node:test';
import assert from 'node:assert/strict';
import {resetThreeFoundersChristmasOnce,FRESH_START_ID,FRESH_START_MARKERS,
 FRESH_START_ACCESS,FRESH_START_PLAYER_COLLECTIONS} from '../dog-christmas-three-founders-fresh-start.js';
import {DOG_VILLAGE_COLLECTION,DOG_GLOBAL_VILLAGE_ID} from '../dog/christmas-village.js';
const U=['chris2345','vanessa2345','david2345'];
const original=()=>Object.fromEntries([
 ...['Chris','Vanessa','David'].map((name,i)=>['player_profiles_v1/'+U[i],{name,uid:U[i]}]),
 ...U.flatMap(uid=>FRESH_START_PLAYER_COLLECTIONS.map(c=>[c+'/'+uid,{uid,coins:777,xp:300}])),
 [DOG_VILLAGE_COLLECTION+'/'+DOG_GLOBAL_VILLAGE_ID,{lightsTenths:1500,levels:{tower:4}}],
 ['other-game/'+U[0],{balance:9999}],
 ['spielesammlung_hub_v1/123',{phase:'lobby',players:[]}]
]);
function fake(data){
 const docs=new Map(Object.entries(structuredClone(data)));
 const ref=path=>({path,get:async()=>snap(path)});
 const snap=path=>({id:path.split('/').at(-1),ref:ref(path),exists:docs.has(path),
  data:()=>structuredClone(docs.get(path))});
 const db={
  collection:name=>({doc:id=>ref(name+'/'+id),get:async()=>({docs:
   [...docs.keys()].filter(x=>x.startsWith(name+'/')&&!x.slice(name.length+1).includes('/')).map(snap)})}),
  runTransaction:async fn=>{
   const changes=[];const tx={get:async r=>snap(r.path),
    delete:r=>changes.push(['delete',r.path]),
    set:(r,v)=>changes.push(['set',r.path,structuredClone(v)]),
    create:(r,v)=>changes.push(['create',r.path,structuredClone(v)])};
   const result=await fn(tx);
   for(const [kind,key,value] of changes){
    if(kind==='create'&&docs.has(key))throw Error('ALREADY_EXISTS');
    if(kind==='delete')docs.delete(key);else docs.set(key,value);
   }
   return result;
  }
 };
 return {db,docs};
}
test('Chris Vanessa David and shared village start fresh, no other game touched',async()=>{
 const seed=original(),{db,docs}=fake(seed);
 const result=await resetThreeFoundersChristmasOnce(db,{clock:()=>10000,logger:{info(){}}});
 assert.equal(result.completed,true);
 assert.equal(result.accessGranted,3);
 assert.equal(result.cleared,22);
 for(const uid of U){
  for(const c of FRESH_START_PLAYER_COLLECTIONS)
   assert.equal(docs.has(c+'/'+uid),false);
  assert.equal(docs.get(FRESH_START_ACCESS+'/'+uid).access,true);
  assert.equal(docs.get(FRESH_START_ACCESS+'/'+uid).firstVisit,true);
  assert.deepEqual(docs.get('player_profiles_v1/'+uid),seed['player_profiles_v1/'+uid]);
 }
 assert.equal(docs.has(DOG_VILLAGE_COLLECTION+'/'+DOG_GLOBAL_VILLAGE_ID),false);
 assert.deepEqual(docs.get('other-game/'+U[0]),seed['other-game/'+U[0]]);
 assert.equal(docs.get(FRESH_START_MARKERS+'/'+FRESH_START_ID).status,'completed');
 docs.set('dog_christmas_scratch_wallet_v1/'+U[0],{coins:999});
 assert.equal((await resetThreeFoundersChristmasOnce(db,{clock:()=>11000})).skipped,true);
 assert.equal(docs.get('dog_christmas_scratch_wallet_v1/'+U[0]).coins,999);
});
test('duplicate Chris profile: fail safely without changing event state',async()=>{
 const before=original();before['player_profiles_v1/anotherchris']={name:'Chris'};
 const {db,docs}=fake(before);
 await assert.rejects(()=>resetThreeFoundersChristmasOnce(db),/FOUNDERS_RESET_NAME_NOT_UNIQUE/);
 assert.deepEqual(Object.fromEntries(docs),before);
});
test('a fourth event participant protects globally shared village',async()=>{
 const before=original();before['dog_christmas_research_v1/fourthuser']={level:5};
 const {db,docs}=fake(before);
 await assert.rejects(()=>resetThreeFoundersChristmasOnce(db),/FOUNDERS_RESET_OTHER_EVENT_PARTICIPANT/);
 assert.deepEqual(Object.fromEntries(docs),before);
});
test('recent ongoing DOG match rejects reset before deleting any rewards',async()=>{
 const before=original();before['spielesammlung_hub_v1/123']={
  phase:'playing',game:'dog',match:{game:'dog',dog:{phase:'play'}},
  players:U.map(uid=>({uid})),expiresAt:30000,updatedAt:9999};
 const {db,docs}=fake(before);
 await assert.rejects(()=>resetThreeFoundersChristmasOnce(db,{clock:()=>10000}),
  /FOUNDERS_RESET_LIVE_DOG_MATCH/);
 assert.deepEqual(Object.fromEntries(docs),before);
});
