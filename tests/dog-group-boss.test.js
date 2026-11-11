import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DOG_GROUP_BOSS_GATES,DOG_GROUP_BOSS_NAMES,DOG_GROUP_BOSS_DUO_CRITICAL_BP,
 DOG_GROUP_BOSS_RECEIPTS_COLLECTION,groupBossState,groupBossView,
 groupBossReady,groupBossStart,groupBossReact,groupBossFinish,
 groupBossDamagePotential,groupBossResolveCombat,installDogGroupBossApi
} from '../dog-group-boss.js';
import {dogGroupBossHp} from '../dog-balance.js';
import {DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID,dogGateProgress} from '../dog-gates.js';
import {DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID} from '../dog-boss.js';
import {DOG_HERO_COLLECTION} from '../dog-forge.js';
const now=1_800_000_000_000;
const team={members:[{uid:'a',name:'Hero A'},{uid:'b',name:'Hero B'},{uid:'c',name:'Hero C'}]};
const priorWins=gate=>Array.from({length:gate/10-1},(_,i)=>(i+1)*10);
const required=gate=>Array.from({length:9},(_,i)=>gate-9+i).filter(n=>n%5!==0&&n%10!==0);
const makeProgress=gate=>({
 people:Object.fromEntries(team.members.map(m=>[m.uid,{currentGate:gate,
  highestGate:gate,normals:required(gate),minis:[],lastAttemptAt:0}])),
 sharedBosses:priorWins(gate),groupBosses:{},updatedAt:now});
const build=(gate,rate=1)=>Object.fromEntries(team.members.map(m=>[m.uid,
 {levels:{weapon:gate/10,armor:gate/10,
  attack_power:Math.round(gate/2*rate),destruction:Math.round(gate/2*rate),
  vitality:Math.round(gate/2*rate),blocking:Math.round(gate/2*rate)}}]));
const roster=(gate,rate=1)=>team.members.map(m=>({
 uid:m.uid,weaponLevel:gate/10,armorLevel:gate/10,
 skillPower:Math.round(gate/2*rate),skillDestruction:Math.round(gate/2*rate),
 skillDefense:Math.round(gate/2*rate),skillGuard:Math.round(gate/2*rate)
}));
const sequence=(arr)=>{let i=0;return n=>{const v=arr[i++]??0;assert.ok(v>=0&&v<n);return v}};

test('Exactly nine later group bosses have separate server identities and positive HP',()=>{
 assert.deepEqual(DOG_GROUP_BOSS_GATES,[20,30,40,50,60,70,80,90,100]);
 for(const gate of DOG_GROUP_BOSS_GATES){
  assert.ok(DOG_GROUP_BOSS_NAMES[gate]);
  assert.ok(dogGroupBossHp(gate)>0);
 }
 assert.equal(DOG_GROUP_BOSS_DUO_CRITICAL_BP,200);
 assert.throws(()=>groupBossView(15,team,null,'a'),/DOG_GROUP_INVALID_GATE/);
 assert.throws(()=>groupBossView(10,team,null,'a'),/DOG_GROUP_INVALID_GATE/);
});

test('All nine bosses: solo always loses, two max heroes need rare strike, three prepared heroes can win',()=>{
 for(const gate of DOG_GROUP_BOSS_GATES){
  const max=roster(gate,1),duo=max.slice(0,2);
  for(const roll of [0,5000,9999]){
   assert.equal(groupBossResolveCombat(gate,max.slice(0,1),['a'],()=>roll).win,false,
    'solo must lose at '+gate);
   const duoLoss=groupBossResolveCombat(gate,duo,['a','b'],sequence([roll,9999]));
   assert.equal(duoLoss.win,false,'duo ordinary luck must lose at '+gate);
   assert.equal(duoLoss.rareCritical,false);
  }
  const special=groupBossResolveCombat(gate,duo,['a','b'],sequence([9999,0]));
  assert.equal(special.win,true,'rare maxed duo can win at '+gate);
  assert.equal(special.rareCritical,true);
  assert.ok(special.damage>=special.bossHp);
  const unmaxed=roster(gate,.7).slice(0,2);
  assert.equal(groupBossResolveCombat(gate,unmaxed,['a','b'],()=>0).win,false,
   'two not-maxed heroes must not win at '+gate);
  const trio=groupBossResolveCombat(gate,roster(gate,.75),[],()=>4500);
  assert.equal(trio.win,true,'three well-equipped heroes should win at '+gate);
  assert.ok(trio.damage>=trio.bossHp);
  const weak=roster(gate,0).map(m=>({...m,weaponLevel:1,armorLevel:1}));
  assert.equal(groupBossResolveCombat(gate,weak,[],()=>0).win,false,
   'poor gear should not beat boss '+gate);
  assert.ok(groupBossDamagePotential(gate,max,[])>
   groupBossDamagePotential(gate,weak,[]));
 }
});

test('One or two may start manually, three auto-start, and only participants may react',()=>{
 for(const gate of [20,60,100]){
  let p=makeProgress(gate);
  p=groupBossReady(gate,p,team,'a',build(gate),now);
  assert.equal(groupBossState(gate,p.groupBosses[gate]).phase,'waiting');
  assert.equal(groupBossView(gate,team,p,'a',now).canStart,true);
  assert.throws(()=>groupBossStart(gate,p,team,'b',build(gate),now),/NOT_READY/);
  const started=groupBossStart(gate,p,team,'a',build(gate),now);
  assert.equal(groupBossState(gate,started.groupBosses[gate]).roster.length,1);
  assert.throws(()=>groupBossReact(gate,started,'b',now+100),/NOT_PARTICIPANT/);
  const solo=groupBossFinish(gate,started,now+30001,()=>0);
  assert.equal(solo.result.win,false);
  assert.equal(solo.progress.groupBosses[gate].cooldownUntil,now+630000);

  p=makeProgress(gate);
  for(const m of team.members)p=groupBossReady(gate,p,team,m.uid,build(gate),now);
  assert.equal(groupBossState(gate,p.groupBosses[gate]).phase,'fighting');
  assert.equal(groupBossState(gate,p.groupBosses[gate]).roster.length,3);
  assert.throws(()=>groupBossFinish(gate,p,now+29999,()=>0),/STILL_FIGHTING/);
  const won=groupBossFinish(gate,p,now+30001,()=>4500);
  assert.equal(won.result.win,true);
  assert.ok(won.progress.sharedBosses.includes(gate));
  assert.equal(won.progress.people.a.currentGate,Math.min(100,gate+1));
  assert.equal(groupBossView(gate,team,won.progress,'b').phase,'victory');
  if(gate===100){
   assert.equal(groupBossView(gate,team,won.progress,'c').dogUnlocked,true);
  }
 }
});

test('Preceding boss and eight normal gates are required for participating heroes',()=>{
 const gate=30,p=makeProgress(gate);
 p.sharedBosses=[10];
 assert.throws(()=>groupBossReady(gate,p,team,'a',build(gate),now),
  /DOG_GROUP_PREREQUISITES/);
 p.sharedBosses=[10,20];
 p.people.a.normals=p.people.a.normals.filter(n=>n!==29);
 assert.throws(()=>groupBossReady(gate,p,team,'a',build(gate),now),
  /DOG_GROUP_PREREQUISITES/);
 p.people.a.normals=required(gate);
 let joined=groupBossReady(gate,p,team,'a',build(gate),now);
 joined=groupBossReady(gate,joined,team,'b',build(gate),now);
 assert.equal(joined.groupBosses[gate].ready.length,2);
 assert.equal(joined.groupBosses[gate].phase,'waiting');
 assert.throws(()=>groupBossReady(gate,joined,team,'a',build(gate),now+1)
   .then?.(()=>null),/DOES_NOT_HAPPEN/);
});

test('Boss 20 and Boss 30 store independent fight state, surviving gate normalization',()=>{
 const gate=20;
 let p=groupBossReady(gate,makeProgress(gate),team,'a',build(gate),now);
 p=dogGateProgress(p);
 assert.deepEqual(p.groupBosses[20].ready,['a']);
 assert.ok(!Object.hasOwn(p.groupBosses,'30'));
 const other={...p,groupBosses:{...p.groupBosses,30:{
  phase:'cooldown',cooldownUntil:now+700000}}};
 const normalized=dogGateProgress(other);
 assert.deepEqual(normalized.groupBosses[20].ready,['a']);
 assert.equal(normalized.groupBosses[30].phase,'cooldown');
});

function fixture(gate=20,initialRoll=0){
 const docs=new Map(),routes=new Map(),reads=[],writes=[];
 let time=now,roll=initialRoll;
 const clone=x=>structuredClone(x);
 const snap=key=>({exists:docs.has(key),data:()=>clone(docs.get(key))});
 const db={
  collection:col=>({doc:id=>({key:col+'/'+id,get:async()=>snap(col+'/'+id)})}),
  runTransaction:async callback=>{
   const pending=[];let written=false;
   const tx={
    get:async ref=>{assert.equal(written,false,'all reads must precede writes');reads.push(ref.key);
     return snap(ref.key)},
    set:(ref,value)=>{written=true;pending.push(['set',ref.key,clone(value)])},
    create:(ref,value)=>{written=true;pending.push(['create',ref.key,clone(value)])}
   };
   const result=await callback(tx);
   for(const [type,key,value] of pending){
    if(type==='create'&&docs.has(key))throw Error('ALREADY_EXISTS');
    docs.set(key,value);writes.push(key);
   }
   return result;
  }
 };
 const app={
  get:(path,...handlers)=>routes.set('GET '+path,handlers),
  post:(path,...handlers)=>routes.set('POST '+path,handlers)
 };
 installDogGroupBossApi(app,{
  verifyProfile:async token=>['a','b','c','outsider'].includes(token)?
   {uid:token,name:token}:null,
  getFirestore:()=>db,clock:()=>time,
  rand:upper=>{const n=roll;return n>=upper?0:n}
 });
 docs.set(DOG_BOSS_TEAM_COLLECTION+'/'+DOG_BOSS_TEAM_ID,team);
 docs.set(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID,makeProgress(gate));
 for(const member of team.members)docs.set(DOG_HERO_COLLECTION+'/'+member.uid,build(gate)[member.uid]);
 async function call(method,suffix='',body={},user='a',requestedGate=gate){
  const route='/api/dog/gates/boss/:gate'+suffix,handlers=routes.get(method+' '+route);
  assert.ok(handlers,'missing '+route);
  const req={params:{gate:String(requestedGate)},body,
   get:header=>header==='authorization'?'Bearer '+user:''};
  const res={statusCode:200,status(n){this.statusCode=n;return this},
   set(){return this},json(d){this.body=d;return d}};
  for(const fn of handlers){
   if(res.body)break;
   if(fn.length===3)await new Promise((resolve,reject)=>{
    Promise.resolve(fn(req,res,resolve)).catch(reject);
   });else await fn(req,res);
  }
  return res;
 }
 return {docs,reads,writes,call,advance:ms=>time+=ms,roll:n=>roll=n};
}
test('Authenticated API: solo start loses, cooldown survives refresh and outsider cannot join',async()=>{
 const f=fixture(20);
 const stranger=await f.call('GET','',{},'outsider');
 assert.equal(stranger.statusCode,403);
 const ready=await f.call('POST','/ready',{requestId:'solo-ready-00000001'});
 assert.equal(ready.statusCode,200);
 assert.equal(ready.body.view.canStart,true);
 const start=await f.call('POST','/start',{requestId:'solo-start-00000001'});
 assert.equal(start.statusCode,200);
 assert.equal(start.body.view.roster.length,1);
 f.advance(30001);
 const seen=await f.call('GET');
 assert.equal(seen.statusCode,200);
 assert.equal(seen.body.phase,'cooldown');
 assert.equal(seen.body.result.win,false);
 const again=await f.call('GET');
 assert.deepEqual(again.body.result,seen.body.result);
 assert.equal(f.docs.get(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID)
  .sharedBosses.includes(20),false);
 const repeat=await f.call('POST','/ready',{requestId:'solo-ready-00000001'});
 assert.equal(repeat.body.replayed,true);
});

test('Authenticated API: rare duo win persists and unlocks following forge tier once',async()=>{
 const f=fixture(20);
 for(const user of ['a','b']){
  const ready=await f.call('POST','/ready',{
   requestId:'duo-ready-'+user+'-00000001'},user);
  assert.equal(ready.statusCode,200);
 }
 const start=await f.call('POST','/start',{requestId:'duo-start-00000001'});
 assert.equal(start.statusCode,200);
 for(const user of ['a','b']){
  const reacted=await f.call('POST','/react',{
   requestId:'duo-react-'+user+'-00000001'},user);
  assert.equal(reacted.statusCode,200);
 }
 f.advance(30000);
 const result=await f.call('POST','/finish',{requestId:'duo-finish-00000001'});
 assert.equal(result.statusCode,200);
 assert.equal(result.body.result.win,true);
 assert.equal(result.body.result.rareCritical,true);
 assert.equal(result.body.view.forgeLevel,3);
 assert.equal(result.body.view.result.participants,2);
 const replay=await f.call('POST','/finish',{requestId:'duo-finish-00000001'});
 assert.equal(replay.body.replayed,true);
 assert.deepEqual(replay.body.result,result.body.result);
 assert.deepEqual(f.docs.get(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID)
  .sharedBosses,[10,20]);
 assert.ok(f.docs.has(DOG_GROUP_BOSS_RECEIPTS_COLLECTION+'/a_20_duo-finish-00000001'));
 const retry=await f.call('POST','/finish',{requestId:'second-finish-new-00001'});
 assert.equal(retry.statusCode,409);
 assert.equal(retry.body.error,'DOG_GROUP_NOT_RUNNING');
});

test('Boss 100 victory survives reconnect and makes DOG unlock flag true for all',async()=>{
 const f=fixture(100);
 for(const user of ['a','b','c']){
  const r=await f.call('POST','/ready',{
   requestId:'final-ready-'+user+'-0001'},user);
  assert.equal(r.statusCode,200);
 }
 f.advance(30001);
 const recovered=await f.call('GET','',{},'b');
 assert.equal(recovered.statusCode,200);
 assert.equal(recovered.body.won,true);
 assert.equal(recovered.body.dogUnlocked,true);
 assert.equal(recovered.body.result.participants,3);
 const other=await f.call('GET','',{},'c');
 assert.deepEqual(other.body.result,recovered.body.result);
 assert.equal(other.body.dogUnlocked,true);
 assert.equal(other.body.phase,'victory');
 assert.deepEqual(f.docs.get(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID)
  .sharedBosses,priorWins(100).concat(100));
});
