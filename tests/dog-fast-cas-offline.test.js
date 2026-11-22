import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tryDogFastCas} from '../dog-fast-cas.js';

function fixture(){
 let version=1,updates=0;
 const current={
  code:'123',createdAt:100,expiresAt:10000,updatedAt:100,revision:9,
  phase:'playing',game:'dog',players:[{uid:'alice'}],
  match:{game:'dog',id:'match-1',dogChristmasEligibilityChecked:true,
   christmas:{enabled:false},dog:{phase:'exchange',revision:4},dogCommands:[]}
 };
 const time=v=>({toMillis:()=>v});
 const ref={async update(value,precondition){
  if(precondition.lastUpdateTime.toMillis()!==version){
   const e=Error('document changed');e.code=9;throw e;
  }
  updates++;version++;Object.assign(current,structuredClone(value));
  return {writeTime:time(version)};
 }};
 return {current,ref,time,version:()=>version,updates:()=>updates,
  change:async room=>{room.match.dog.revision++;room.match.dogCommands.push('secure-id');}};
}

test('DOG standard move updates Firestore with a version precondition and zero get()s',async()=>{
 const f=fixture();let clock=200;
 const output=await tryDogFastCas({room:f.current,updateTime:f.time(1),ref:f.ref,store:{},
  change:f.change,clock:()=>clock,ttlMs:36000});
 assert.equal(output.used,true);
 assert.equal(f.updates(),1);
 assert.equal(f.version(),2);
 assert.equal(f.current.revision,10);
 assert.equal(f.current.match.dog.revision,5);
 assert.equal(f.current.updatedAt,200);
 assert.equal(f.current.expiresAt,36200);
 assert.equal(output.writeTime.toMillis(),2);
});

test('Stale concurrent DOG actions cannot overwrite each other; CAS must fall back',async()=>{
 const f=fixture(),first=structuredClone(f.current),second=structuredClone(f.current);
 const args={updateTime:f.time(1),ref:f.ref,store:{},change:f.change,
  clock:()=>500,ttlMs:36000};
 const a=await tryDogFastCas({...args,room:first});
 const b=await tryDogFastCas({...args,room:second});
 assert.equal(a.used,true);
 assert.deepEqual(b,{used:false,reason:'conflict'});
 assert.equal(f.updates(),1);
 assert.equal(f.current.match.dogCommands.length,1);
});

test('Seasonal gifts, completed matches, unfinished eligibility and transaction side effects use old path',async()=>{
 const f=fixture();
 const cases=[
  room=>{room.match.christmas.enabled=true;},
  room=>{room.match.dogChristmasEligibilityChecked=false;},
  room=>{room.phase='lobby';}
 ];
 for(const edit of cases){
  const room=structuredClone(f.current);edit(room);
  const out=await tryDogFastCas({room,updateTime:f.time(1),ref:f.ref,
   change:f.change,clock:()=>1000,ttlMs:36000});
  assert.equal(out.used,false);
 }
 const noWallet=await tryDogFastCas({room:f.current,updateTime:f.time(1),ref:f.ref,
  change:async(room,tx)=>{room.match.dog.revision++;await tx.get({path:'dog_wallet/alice'});},
  clock:()=>1000,ttlMs:36000});
 assert.equal(noWallet.used,false);
 const finished=await tryDogFastCas({room:f.current,updateTime:f.time(1),ref:f.ref,
  change:async room=>{room.match.dog.phase='finished';},clock:()=>1000,ttlMs:36000});
 assert.equal(finished.used,false);
 assert.equal(f.updates(),0);
});

test('Duplicate/unchanged action and validation errors never create an untracked write',async()=>{
 const f=fixture();
 for(const change of [
  ()=>({unchanged:true}),
  ()=>{throw new Error('ILLEGAL_ACTION');},
  ()=>{}
 ]){
  const out=await tryDogFastCas({room:f.current,updateTime:f.time(1),ref:f.ref,
   change,clock:()=>1000,ttlMs:36000});
  assert.equal(out.used,false);
 }
 assert.equal(f.updates(),0);
});

test('Integration is opt-in and keeps transaction fallback, private views and live room watcher',()=>{
 const source=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
 assert.match(source,/fastCasEnabled=process\.env\.DOG_FAST_CAS_ENABLED==='1'/);
 assert.match(source,/if\(source==='dog-action'&&fastCasEnabled\)/);
 assert.match(source,/await tryDogFastCas\(/);
 assert.match(source,/if\(fast\.used\)\{/);
 assert.match(source,/return expose\(fast\.room,identity\)/);
 assert.match(source,/const \{value,changed,revision,dogWriteKind,writeCounts,writePaths,dogAutoNoop\}=await store\.runTransaction/);
 assert.match(source,/stream\.updateTime=snapshot\.updateTime\|\|null/);
 assert.match(source,/documentFor\(store,code\)\.onSnapshot/);
});
