import test from 'node:test';
import assert from 'node:assert/strict';
import {dogForgeProgress,dogForgeLevelUp,dogForgeCombatTier} from '../dog-forge-progression.js';
import {forgeQuote,forgeView,installDogForgeApi} from '../dog-forge.js';

test('Boss-Siegel are earned once per first group boss, including past victories',()=>{
 const start=dogForgeProgress({sharedBosses:[]});
 assert.equal(start.forgeLevel,1);
 assert.equal(start.equipmentCap,5);
 assert.equal(start.skillsCap,5);
 const won={sharedBosses:[10,20,10,100]};
 assert.equal(dogForgeProgress(won).bossSeals,2);
 const one=dogForgeLevelUp(won,1,1234);
 assert.equal(one.progress.forgeLevel,2);
 assert.equal(dogForgeProgress(one.progress).bossSeals,1);
 const two=dogForgeLevelUp(one.progress,2,1235);
 assert.equal(dogForgeProgress(two.progress).forgeLevel,3);
 assert.equal(dogForgeProgress(two.progress).bossSeals,0);
 assert.throws(()=>dogForgeLevelUp(two.progress,3),/DOG_FORGE_BOSS_SEAL_REQUIRED/);
 assert.throws(()=>dogForgeLevelUp(one.progress,1),/DOG_FORGE_LEVEL_STALE/);
 assert.throws(()=>dogForgeLevelUp({...won,forgeLevel:10},10),/DOG_FORGE_LEVEL_MAX/);
});
test('Each shared forge level grants exactly five equipment and skill levels',()=>{
 for(let n=1;n<=10;n++){
  const p={forgeLevel:n,sharedBosses:Array.from({length:9},(_,i)=>(i+1)*10)};
  const v=forgeView(null,null,p);
  assert.equal(v.forgeLevel,n);
  assert.equal(v.equipmentCap,5*n);
  assert.equal(v.skillsCap,5*n);
  assert.equal(v.items.find(i=>i.id==='weapon').maxLevel,50);
  assert.equal(v.items.find(i=>i.id==='armor').maxLevel,50);
  assert.equal(v.items.find(i=>i.id==='attack_power').maxLevel,50);
  const q=forgeQuote('weapon',n*5,{},p);
  if(n<10){assert.equal(q.locked,true);assert.equal(q.maxed,false)}
  else assert.equal(q.maxed,true);
 }
 assert.deepEqual([1,5,6,10,11,50].map(dogForgeCombatTier),[1,1,2,2,3,10]);
});
test('Expedition pacing: first skills cost more without altering legacy forge',()=>{
 const expedition={forgeLevel:1,sharedBosses:[]};
 for(let level=0;level<5;level++){
  const q=forgeQuote('attack_power',level,{},expedition);
  assert.deepEqual(q.cost,{focus_dust:[2,3,3,4,5][level]});
 }
 assert.deepEqual(forgeQuote('attack_power',0).cost,{focus_dust:1});
 const afterBoss20={forgeLevel:3,sharedBosses:[10,20]};
 assert.deepEqual(forgeQuote('weapon',10,{},afterBoss20).cost,{iron:2,forge_coal:3});
 assert.deepEqual(forgeQuote('weapon',14,{},afterBoss20).cost,{forge_coal:4,steel_core:1});
});

test('Forge level-up receipt is idempotent, team-scoped and atomic',async()=>{
 const docs=new Map([
  ['dog_boss_team_v1/first-three-heroes',{members:[{uid:'a',name:'A'},{uid:'b',name:'B'}]}],
  ['dog_gate_progress_v1/first-three-heroes',{sharedBosses:[10,20]}]
 ]);
 const writes=[],routes=new Map();
 const snap=key=>({exists:docs.has(key),data:()=>structuredClone(docs.get(key))});
 const db={collection:c=>({doc:id=>({key:c+'/'+id,get:async()=>snap(c+'/'+id)})}),
  runTransaction:async fn=>{
   const ops=[];let started=false;
   const tx={get:async ref=>{assert.equal(started,false);return snap(ref.key)},
    set:(ref,v)=>{started=true;ops.push(['set',ref.key,structuredClone(v)])},
    create:(ref,v)=>{started=true;ops.push(['create',ref.key,structuredClone(v)])}};
   const result=await fn(tx);
   for(const [type,key,value] of ops){
    if(type==='create'&&docs.has(key))throw Error('ALREADY_EXISTS');
    docs.set(key,value);writes.push(key);
   }
   return result;
  }};
 const app={get:(path,...handlers)=>routes.set('GET '+path,handlers),
  post:(path,...handlers)=>routes.set('POST '+path,handlers)};
 installDogForgeApi(app,{verifyProfile:async token=>({uid:token}),
  getFirestore:()=>db,rand:()=>0});
 const call=async(id,level,token='a')=>{
  const req={body:{requestId:id,expectedLevel:level},
   get:name=>name==='authorization'?'Bearer '+token:''};
  const res={statusCode:200,status(code){this.statusCode=code;return this},
   set(){return this},json(body){this.body=body;return body}};
  for(const handler of routes.get('POST /api/dog/forge/level-up')){
   if(res.body)break;
   if(handler.length===3)await new Promise(resolve=>handler(req,res,resolve));
   else await handler(req,res);
  }
  return res;
 };
 const a=await call('forge-team-level-0001',1);
 assert.equal(a.statusCode,200);
 assert.equal(a.body.progress.forgeLevel,2);
 assert.equal(a.body.progress.bossSeals,1);
 assert.equal(writes.length,2,'one progress + one receipt write');
 const replay=await call('forge-team-level-0001',1);
 assert.equal(replay.body.replayed,true);
 assert.equal(writes.length,2,'no duplicate writes');
 const stale=await call('forge-team-level-0002',1);
 assert.equal(stale.statusCode,409);
 const b=await call('forge-team-level-0003',2,'b');
 assert.equal(b.body.progress.forgeLevel,3);
 assert.equal(b.body.progress.bossSeals,0);
 const noSeal=await call('forge-team-level-0004',3);
 assert.equal(noSeal.statusCode,409);
 assert.equal(noSeal.body.error,'DOG_FORGE_BOSS_SEAL_REQUIRED');
 assert.equal(writes.length,4);
});
