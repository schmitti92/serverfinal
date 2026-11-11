import test from 'node:test';
import assert from 'node:assert/strict';
import {developerGateSetup,developerAddMaterials,installDogDeveloperApi,
 DOG_DEVELOPER_BOSS_GATES} from '../dog-developer.js';
import {DOG_LIVE_BOT_IDS,DOG_LIVE_PILOT_COLLECTION,DOG_LIVE_PILOT_ID} from '../dog-live-bots.js';
import {DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID} from '../dog-boss.js';
import {DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID,dogDeveloperCooldownBypass,dogGateProgress} from '../dog-gates.js';
import {boss10View,boss10Ready} from '../dog-boss10.js';
import {groupBossView,groupBossReady} from '../dog-group-boss.js';
import {DOG_MATERIALS_COLLECTION,DOG_RESOURCES} from '../dog-materials.js';

const uid='user_chris_owner';
const team={members:[{uid,name:'Chris'},
 ...DOG_LIVE_BOT_IDS.map(id=>({uid:id,name:id}))]};
const progress={people:{[uid]:{currentGate:1,highestGate:1,normals:[],minis:[]}},
 sharedBosses:[]};

test('Developer gate presets set server-validated positions for Chris and both bots',()=>{
 for(const [limit,current,bossCount] of [[9,10,0],[19,20,1],[99,100,9]]){
  const next=developerGateSetup(progress,team,uid,limit,1000);
  assert.equal(next.people[uid].currentGate,current);
  assert.equal(next.people[uid].highestGate,current);
  assert.equal(next.sharedBosses.length,bossCount);
  assert.ok(!next.sharedBosses.includes(100),'developer mode never awards final DOG');
  assert.equal(next.people[uid].minis.length,Math.floor((limit+5)/10));
  for(const id of DOG_LIVE_BOT_IDS){
   assert.deepEqual(next.people[id].normals,next.people[uid].normals);
   assert.deepEqual(next.people[id].minis,next.people[uid].minis);
   assert.equal(next.people[id].currentGate,current);
  }
 }
});

test('Every individual boss can be prepared without awarding its victory',()=>{
 for(const gate of DOG_DEVELOPER_BOSS_GATES){
  const next=developerGateSetup(progress,team,uid,gate-1,1000);
  assert.equal(next.people[uid].currentGate,gate);
  assert.equal(next.sharedBosses.length,gate/10-1);
  assert.ok(!next.sharedBosses.includes(gate));
  assert.deepEqual(next.groupBosses,{});
 }
});

test('Developer controls refuse real other players and running boss encounters',()=>{
 assert.throws(()=>developerGateSetup(progress,{members:[{uid,name:'Chris'},
  {uid:'another-player',name:'David'},team.members[1]]},uid,9,1000),/BOTS_REQUIRED/);
 assert.throws(()=>developerGateSetup(progress,team,uid,8,1000),/INVALID_GATE/);
 assert.throws(()=>developerGateSetup({...progress,boss10:{phase:'fighting',startedAt:950,endsAt:1200}},
  team,uid,19,1000),/FIGHT_ACTIVE/);
});

test('Developer resource grants keep inventory bounds and preserve equipment chests',()=>{
 const original={resources:{iron:11},chests:{small:2}};
 const all=developerAddMaterials(original,'all',100,1200);
 assert.equal(all.resources.iron,111);
 assert.ok(DOG_RESOURCES.every(id=>all.resources[id]>=100));
 assert.equal(all.chests.small,2);
 const single=developerAddMaterials(all,'iron',10,1250);
 assert.equal(single.resources.iron,121);
 assert.equal(single.resources.mithril,100);
 assert.throws(()=>developerAddMaterials(original,'not-a-resource',100),/INVALID_MATERIAL/);
 assert.throws(()=>developerAddMaterials(original,'iron',20000),/INVALID_MATERIAL/);
 assert.throws(()=>developerAddMaterials({resources:{iron:999999}},'iron',100),/MATERIALS_LIMIT/);
});

function harness({bots=true}={}){
 const map=new Map(),routes=new Map();
 const write=(path,data)=>map.set(path,structuredClone(data));
 const snap=path=>({exists:map.has(path),data:()=>map.has(path)?structuredClone(map.get(path)):undefined});
 const db={collection:name=>({doc:id=>({path:name+'/'+id,get:async()=>snap(name+'/'+id)})}),
  runTransaction:async task=>{
   const writes=[],tx={get:async ref=>snap(ref.path),
    set:(ref,value)=>writes.push(()=>write(ref.path,value)),
    create:(ref,value)=>writes.push(()=>{if(map.has(ref.path))throw Error('ALREADY_EXISTS');write(ref.path,value);})};
   const result=await task(tx);writes.forEach(fn=>fn());return result;
  }};
 const app={get:(path,...handlers)=>routes.set('GET '+path,handlers),
  post:(path,...handlers)=>routes.set('POST '+path,handlers)};
 installDogDeveloperApi(app,{verifyProfile:async token=>({uid:token,name:token}),getFirestore:()=>db,clock:()=>1000});
 write(DOG_LIVE_PILOT_COLLECTION+'/'+DOG_LIVE_PILOT_ID,{uid,mode:'real-account-two-bots'});
 write(DOG_BOSS_TEAM_COLLECTION+'/'+DOG_BOSS_TEAM_ID,bots?team:{members:[{uid,name:'Chris'}]});
 write(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID,progress);
 const call=async(method,path,actor=uid,body={})=>{
  const handlers=routes.get(method+' '+path);
  if(!handlers)throw Error('NO_ROUTE');
  const req={get:key=>key==='authorization'?'Bearer '+actor:'',body};
  const res={statusCode:200,status(code){this.statusCode=code;return this;},
   set(){return this;},json(body){this.result=body;return this;}};
  let promise;
  await handlers[0](req,res,()=>{promise=handlers[1](req,res);});
  if(promise)await promise;
  return {status:res.statusCode,...res.result};
 };
 return {call,map};
}

test('Developer HTTP routes are invisible to a non-owner even with a Chris-like name',async()=>{
 const h=harness(),status=await h.call('GET','/api/dog/developer/status','different-chris-uid');
 assert.equal(status.status,404);
 const denied=await h.call('POST','/api/dog/developer/apply','different-chris-uid',
  {action:'materials',resource:'all',amount:100,requestId:'dev-request-00001'});
 assert.equal(denied.status,404);
 assert.equal(h.map.has(DOG_MATERIALS_COLLECTION+'/different-chris-uid'),false);
});

test('Developer HTTP changes real pilot progress and never sets DOG unlocked',async()=>{
 const h=harness(),status=await h.call('GET','/api/dog/developer/status');
 assert.equal(status.status,200);assert.equal(status.botsReady,true);
 let a=await h.call('POST','/api/dog/developer/apply',uid,
  {action:'boss',gate:100,requestId:'dev-request-00002'});
 assert.equal(a.status,200);assert.equal(a.preparedTo,100);assert.equal(a.dogUnlocked,false);
 let p=h.map.get(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID);
 assert.equal(p.sharedBosses.length,9);
 assert.equal(p.sharedBosses.includes(100),false);
 a=await h.call('POST','/api/dog/developer/apply',uid,
  {action:'preset',gate:9,requestId:'dev-request-00003'});
 assert.equal(a.status,200);assert.equal(a.preparedTo,10);
});

test('Developer grants are atomic, idempotent and reject reused receipts with new inputs',async()=>{
 const h=harness(),params={action:'materials',resource:'iron',amount:100,requestId:'dev-request-00004'};
 const first=await h.call('POST','/api/dog/developer/apply',uid,params);
 const replay=await h.call('POST','/api/dog/developer/apply',uid,params);
 assert.equal(first.status,200);assert.equal(replay.status,200);
 assert.equal(replay.replayed,true);
 assert.equal(h.map.get(DOG_MATERIALS_COLLECTION+'/'+uid).resources.iron,100);
 const conflict=await h.call('POST','/api/dog/developer/apply',uid,{...params,amount:1000});
 assert.equal(conflict.status,409);
 assert.equal(h.map.get(DOG_MATERIALS_COLLECTION+'/'+uid).resources.iron,100);
});

test('Developer HTTP refuses to overwrite a human team and never credits materials',async()=>{
 const h=harness({bots:false});
 const status=await h.call('GET','/api/dog/developer/status');
 assert.equal(status.botsReady,false);
 const denied=await h.call('POST','/api/dog/developer/apply',uid,
  {action:'materials',resource:'all',amount:1000,requestId:'dev-request-00005'});
 assert.equal(denied.status,409);
 assert.equal(h.map.has(DOG_MATERIALS_COLLECTION+'/'+uid),false);
});

test('Boss cooldown setting survives gate presets and keeps Boss 10 state reset',()=>{
 const initial=developerGateSetup({...progress,
  developerBossCooldownDisabledFor:uid,
  boss10:{phase:'cooldown',cooldownUntil:700000}},team,uid,9,2000);
 assert.equal(initial.developerBossCooldownDisabledFor,uid);
 assert.equal(initial.boss10,undefined,'Developer boss preparation resets prior Tor-10 result');
 const rewritten=dogGateProgress(initial);
 assert.equal(rewritten.developerBossCooldownDisabledFor,uid,
  'All later progress transactions preserve the developer preference');
});

test('Only owner-plus-Nova-Titan can bypass Boss 10 cooldown immediately',()=>{
 const now=100000;
 const checkpoint=developerGateSetup(progress,team,uid,9,now);
 const cooling={...checkpoint,boss10:{phase:'cooldown',cooldownUntil:now+600000,attempt:2}};
 const active={...cooling,developerBossCooldownDisabledFor:uid};
 assert.equal(boss10View(team,cooling,uid,now).phase,'cooldown');
 assert.throws(()=>boss10Ready(cooling,team,uid,{},now),/DOG_BOSS10_COOLDOWN/);
 assert.equal(dogDeveloperCooldownBypass(active,team,uid),true);
 assert.equal(dogDeveloperCooldownBypass(active,team,DOG_LIVE_BOT_IDS[0]),true);
 assert.equal(boss10View(team,active,uid,now).phase,'waiting');
 assert.equal(boss10View(team,active,uid,now).cooldownRemainingMs,0);
 const resumed=boss10Ready(active,team,DOG_LIVE_BOT_IDS[0],{},now);
 assert.equal(resumed.boss10.phase,'waiting');
 assert.equal(resumed.boss10.attempt,3);
 const ordinary={members:[{uid,name:'Chris'},{uid:'other-human',name:'David'},
  {uid:'another-human',name:'Vanessa'}]};
 assert.equal(dogDeveloperCooldownBypass(active,ordinary,uid),false);
 assert.throws(()=>boss10Ready(active,ordinary,uid,{},now),/DOG_BOSS10_COOLDOWN/);
});

test('Bosses 20 to 100 honor the developer flag without bypassing prerequisites',()=>{
 const now=100000;
 for(const gate of [20,40,70,100]){
  const checkpoint=developerGateSetup(progress,team,uid,gate-1,now);
  const cooling={...checkpoint,groupBosses:{[gate]:{
   phase:'cooldown',cooldownUntil:now+600000,attempt:2}}};
  assert.throws(()=>groupBossReady(gate,cooling,team,uid,{},now),/DOG_GROUP_COOLDOWN/);
  const active={...cooling,developerBossCooldownDisabledFor:uid};
  const view=groupBossView(gate,team,active,uid,now);
  assert.equal(view.phase,'waiting','Boss '+gate+' is immediately available');
  assert.equal(view.cooldownRemainingMs,0);
  const resumed=groupBossReady(gate,active,team,DOG_LIVE_BOT_IDS[0],{},now);
  assert.equal(resumed.groupBosses[gate].phase,'waiting');
  assert.equal(resumed.groupBosses[gate].attempt,3);
 }
});

test('Authenticated cooldown toggle is persistent, reversible and idempotent',async()=>{
 const h=harness();
 const get=()=>h.call('GET','/api/dog/developer/status');
 assert.equal((await get()).bossCooldownDisabled,false);
 const command={action:'cooldown',disabled:true,requestId:'dev-cooldown-00001'};
 const switched=await h.call('POST','/api/dog/developer/apply',uid,command);
 assert.equal(switched.status,200);
 assert.equal(switched.bossCooldownDisabled,true);
 assert.equal((await get()).bossCooldownDisabled,true);
 const receipt=await h.call('POST','/api/dog/developer/apply',uid,command);
 assert.equal(receipt.status,200);
 assert.equal(receipt.replayed,true);
 const invalid=await h.call('POST','/api/dog/developer/apply',uid,
  {...command,disabled:false});
 assert.equal(invalid.status,409,'Old receipt cannot toggle a different setting');
 const checkpoint=await h.call('POST','/api/dog/developer/apply',uid,
  {action:'preset',gate:19,requestId:'dev-cooldown-preset'});
 assert.equal(checkpoint.status,200);
 assert.equal((await get()).bossCooldownDisabled,true);
 const off=await h.call('POST','/api/dog/developer/apply',uid,
  {action:'cooldown',disabled:false,requestId:'dev-cooldown-00002'});
 assert.equal(off.status,200);
 assert.equal((await get()).bossCooldownDisabled,false);
 const document=h.map.get(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID);
 assert.equal(document.developerBossCooldownDisabledFor,null);
 const rejected=await h.call('POST','/api/dog/developer/apply','other-user',
  {action:'cooldown',disabled:true,requestId:'dev-cooldown-00003'});
 assert.equal(rejected.status,404);
 const malformed=await h.call('POST','/api/dog/developer/apply',uid,
  {action:'cooldown',disabled:'yes',requestId:'dev-cooldown-00004'});
 assert.equal(malformed.status,400);
});
