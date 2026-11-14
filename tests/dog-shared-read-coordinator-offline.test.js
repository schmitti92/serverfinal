import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDogSharedReadCoordinator} from '../dog-shared-read-coordinator.js';
import {installDogGatesApi} from '../dog-gates.js';
import {installDogMaterialsApi} from '../dog-materials.js';

function fakeDatabase(){
 const docs=new Map(),reads=new Map(),gates=new Map();
 const snap=(path)=>{const content=structuredClone(docs.get(path));return {exists:docs.has(path),data:()=>structuredClone(content)}};
 const db={collection:collection=>({doc:id=>{
  const path=collection+'/'+id;
  return {path,get:async()=>{
   reads.set(path,(reads.get(path)||0)+1);
   const value=snap(path);
   if(gates.has(path))await gates.get(path);
   return value;
  }};
 }})};
 return {db,docs,reads:path=>reads.get(path)||0,block:path=>{
  let release;gates.set(path,new Promise(r=>{release=r}));
  return ()=>{gates.delete(path);release()};
 }};
}

test('Simultaneous 100-Tore team/progress GETs reuse one Firestore document read',async()=>{
 const f=fakeDatabase(),share=createDogSharedReadCoordinator();
 const team='dog_boss_team_v1/first-three-heroes',progress='dog_gate_progress_v1/first-three-heroes';
 const freeTeam=f.block(team),freeProgress=f.block(progress);
 const a=share.read(f.db,f.db.collection('dog_boss_team_v1').doc('first-three-heroes'));
 const b=share.read(f.db,f.db.collection('dog_boss_team_v1').doc('first-three-heroes'));
 const c=share.read(f.db,f.db.collection('dog_gate_progress_v1').doc('first-three-heroes'));
 const d=share.read(f.db,f.db.collection('dog_gate_progress_v1').doc('first-three-heroes'));
 freeTeam();freeProgress();
 const vals=await Promise.all([a,b,c,d]);
 assert.ok(vals.every(v=>!v.exists));
 assert.equal(f.reads(team),1);
 assert.equal(f.reads(progress),1);
 assert.equal(share.stats().sharedReads,2);
 assert.equal(share.stats().ttlMs,0);
 await share.read(f.db,f.db.collection('dog_boss_team_v1').doc('first-three-heroes'));
 assert.equal(f.reads(team),2,'after previous GET resolves, the next must read fresh');
});

test('Read coordinator isolates Firestore instances and never holds stale values',async()=>{
 const f=fakeDatabase(),g=fakeDatabase(),share=createDogSharedReadCoordinator();
 const path='dog_gate_progress_v1/first-three-heroes';
 f.docs.set(path,{updatedAt:1});g.docs.set(path,{updatedAt:2});
 const [a,b]=await Promise.all([
  share.read(f.db,f.db.collection('dog_gate_progress_v1').doc('first-three-heroes')),
  share.read(g.db,g.db.collection('dog_gate_progress_v1').doc('first-three-heroes'))
 ]);
 assert.equal(a.data().updatedAt,1);assert.equal(b.data().updatedAt,2);
 f.docs.set(path,{updatedAt:3});
 const fresh=await share.read(f.db,f.db.collection('dog_gate_progress_v1').doc('first-three-heroes'));
 assert.equal(fresh.data().updatedAt,3);
 assert.equal(f.reads(path),2);assert.equal(g.reads(path),1);
});

test('DOG map and materials share concurrently requested team/progress documents',async()=>{
 const f=fakeDatabase(),share=createDogSharedReadCoordinator(),routes=new Map();
 const app={get:(route,...handlers)=>routes.set('GET '+route,handlers),post:()=>{}};
 const verify=async token=>['alice','bob'].includes(token)?{uid:'dog-'+token,name:token}:null;
 const options={verifyProfile:verify,getFirestore:()=>f.db,readSharedDoc:share.read};
 installDogGatesApi(app,options);
 installDogMaterialsApi(app,options);
 const call=async(route,token)=>{
  const handlers=routes.get('GET '+route);assert.ok(handlers);
  const req={get:name=>name==='authorization'?'Bearer '+token:''},res={
   statusCode:200,status(n){this.statusCode=n;return this},set(){return this},
   json(payload){this.body=payload;return payload}
  };
  for(const fn of handlers){
   if(res.body)break;
   if(fn.length===3){
    await new Promise((resolve,reject)=>{
     let done=false;
     Promise.resolve(fn(req,res,()=>{done=true;resolve()})).then(()=>{
      if(!done&&res.body)resolve();
     },reject);
    });
   }else await fn(req,res);
  }
  return res;
 };
 const team='dog_boss_team_v1/first-three-heroes',progress='dog_gate_progress_v1/first-three-heroes';
 const freeTeam=f.block(team),freeProgress=f.block(progress);
 const map1=call('/api/dog/gates/map','alice');
 const map2=call('/api/dog/gates/map','bob');
 const inventory=call('/api/dog/materials/me','alice');
 await new Promise(resolve=>setImmediate(resolve));
 freeTeam();freeProgress();
 const [a,b,c]=await Promise.all([map1,map2,inventory]);
 assert.equal(a.statusCode,200);assert.equal(b.statusCode,200);assert.equal(c.statusCode,200);
 assert.equal(a.body.ok,true);assert.equal(b.body.ok,true);assert.equal(c.body.ok,true);
 assert.equal(f.reads(team),1,'one team GET shared between three authenticated page loads');
 assert.equal(f.reads(progress),1,'one progress GET shared between three authenticated page loads');
 assert.equal(f.reads('dog_materials_v3/dog-alice')+f.reads('dog_materials_v2/dog-alice'),0,
  'inventory collection name is not inferred here');
 assert.equal(share.stats().sharedReads,4);
 assert.equal(share.stats().documentReads,2);
 // Subsequent page visits have no stale TTL, even if the same player is still active.
 await call('/api/dog/gates/map','alice');
 assert.equal(f.reads(team),2);
 assert.equal(f.reads(progress),2);
});

test('Read errors are not cached and in-flight requests are released',async()=>{
 const share=createDogSharedReadCoordinator();
 let reads=0,shouldFail=true;
 const db={},ref={path:'dog_gate_progress_v1/first-three-heroes',get:async()=>{
  reads++;
  if(shouldFail){shouldFail=false;throw Error('MOCK_UNAVAILABLE')}
  return {exists:true,data:()=>({revision:2})};
 }};
 await assert.rejects(()=>share.read(db,ref),/MOCK_UNAVAILABLE/);
 assert.equal((await share.read(db,ref)).data().revision,2);
 assert.equal(reads,2);assert.equal(share.stats().errors,1);
});

test('100-Tore GET optimization does not alter fight, join or chest payout transactions',()=>{
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 const gates=readFileSync(new URL('../dog-gates.js',import.meta.url),'utf8');
 const materials=readFileSync(new URL('../dog-materials.js',import.meta.url),'utf8');
 assert.match(server,/const dogSharedReadCoordinator=createDogSharedReadCoordinator\(\)/);
 assert.match(server,/readSharedDoc:dogSharedReadCoordinator\.read/g);
 assert.match(server,/dogSharedReadCache:dogSharedReadCoordinator\.stats\(\)/);
 assert.match(gates,/readSharedDoc\(db,teamRef\),readSharedDoc\(db,progressRef\)/);
 assert.match(gates,/app\.post\('\/api\/dog\/gates\/fight'[\s\S]*?db\.runTransaction/);
 assert.match(materials,/app\.post\('\/api\/dog\/materials\/open'[\s\S]*?db\.runTransaction/);
 assert.match(materials,/tx\.create\(receiptRef/);
});
