import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DOG_GROUP_BOSS_GATES,DOG_GROUP_BOSS_NAMES,DOG_GROUP_BOSS_DUO_CRITICAL_BP,
 DOG_GROUP_BOSS_RECEIPTS_COLLECTION,groupBossState,groupBossView,
 groupBossReady,groupBossStart,groupBossReact,groupBossFinish,
 groupBossDamagePotential,groupBossResolveCombat,installDogGroupBossApi
} from '../dog-group-boss.js';
import {dogGroupBossHp} from '../dog-balance.js';
import {dogMiniReactionPosition} from '../dog-boss-minigames.js';
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
  const solo=groupBossFinish(gate,started,now+99001,()=>0);
  assert.equal(solo.result.win,false);
  assert.equal(solo.progress.groupBosses[gate].cooldownUntil,now+699000);

  p=makeProgress(gate);
  for(const m of team.members)p=groupBossReady(gate,p,team,m.uid,build(gate),now);
  assert.equal(groupBossState(gate,p.groupBosses[gate]).phase,'fighting');
  assert.equal(groupBossState(gate,p.groupBosses[gate]).roster.length,3);
  assert.throws(()=>groupBossFinish(gate,p,now+49999,()=>0),/STILL_FIGHTING/);
  const won=groupBossFinish(gate,p,now+99001,()=>4500);
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
 assert.deepEqual(groupBossReady(gate,joined,team,'a',build(gate),now+1),joined,
  'clicking Ready again must not duplicate a participant');
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
 return {docs,reads,writes,call,advance:ms=>time+=ms,time:()=>time,roll:n=>roll=n};
}
/** Submit all actual v2 sub-actions through the authenticated API at the
 * original server-clock timestamps. Test-only fixture sees secret answers;
 * production clients do not. */
/** Complete each of the four 8s challenge types through real API receipts. */
async function completeRound(f,gate,index,players,wrongUser=null){
 const key=DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID;
 const round=f.docs.get(key).groupBosses[gate].miniGames.rounds[index];
 for(let step=0;step<round.maxSteps;step++){
  let at,right,wrong;
  if(round.kind==='math'){
   at=round.startMs+300+step*850;
   right=round.puzzles[step].correctIndex;wrong=(right+1)%3;
  }else if(round.kind==='dodge'){
   const attack=round.attacks[step];
   at=attack.startMs+400;
   right=Array.from({length:round.lanes},(_,i)=>i).find(i=>
    i!==attack.dangerIndex&&i!==attack.secondDangerIndex);
   wrong=attack.dangerIndex;
  }else if(round.kind==='target'){
   at=round.startMs+400+step*2000;
   right=dogMiniTargetIndex(round,at);wrong=(right+1)%round.lanes;
  }else{
   const min=round.startMs+Math.floor(step*8000/3)+450;
   const max=round.startMs+Math.floor((step+1)*8000/3)-220;
   at=NaN;
   for(let t=min;t<max;t+=10)
    if(Math.abs(dogMiniReactionPosition(round,t)-.5)<=round.zoneRadius*.5){at=t;break;}
   assert.ok(Number.isFinite(at),'reaction window exists');
   right=1;wrong=0;
  }
  assert.ok(now+at>=f.time(),'input must arrive chronologically');
  f.advance(now+at-f.time());
  for(const uid of players){
   const response=await f.call('POST','/minigame',{
    requestId:'four-'+gate+'-'+index+'-'+uid+'-'+step+'-receipt',
    round:index,step,answer:uid===wrongUser?wrong:right
   },uid);
   assert.equal(response.statusCode,200,round.kind+' '+uid+' '+step);
   assert.equal(response.body.result.correct,uid!==wrongUser);
  }
 }
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
 f.advance(99001);
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
 await completeRound(f,20,0,['a','b']);
 await completeRound(f,20,1,['a','b']);
 f.advance(now+99001-f.time());
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
 f.advance(99001);
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


test('Three authenticated profiles share one boss 100 timeline and independent minigame scores',async()=>{
 const f=fixture(100,0),players=['a','b','c'];
 for(const player of players){
  const ready=await f.call('POST','/ready',{
   requestId:'trio-100-ready-'+player+'-001'},player);
  assert.equal(ready.statusCode,200);
 }
 const views=[];
 for(const player of players){
  const loaded=await f.call('GET','',{},player);
  assert.equal(loaded.statusCode,200);
  assert.equal(loaded.body.phase,'fighting');
  assert.equal(loaded.body.roster.length,3);
  assert.deepEqual(loaded.body.miniGames.myAnswers,{});
  assert.equal(loaded.body.miniGames.rounds.length,4);
  assert.equal(loaded.body.startedAt,now);
  views.push(loaded.body);
 }
 assert.deepEqual(views[0].miniGames.rounds,views[1].miniGames.rounds);
 assert.deepEqual(views[1].miniGames.rounds,views[2].miniGames.rounds);
 assert.equal(new Set(views[0].miniGames.rounds.map(round=>round.kind)).size,4);
 assert.ok(!JSON.stringify(views[0].miniGames).includes('correctIndex'),
  'the server never leaks the math answer');
 await completeRound(f,100,0,players);
 const reconnect=await f.call('GET','',{},'b');
 assert.equal(reconnect.body.phase,'fighting');
 assert.equal(reconnect.body.miniGames.myAnswers[0].correct,true);
 assert.equal(reconnect.body.miniGames.myAnswers[0].attempts.length,8);
 assert.equal(Object.keys(reconnect.body.miniGames.myAnswers).length,1);
 assert.equal(reconnect.body.miniGames.completedBy.a,1);
 assert.equal(reconnect.body.miniGames.completedBy.b,1);
 assert.equal(reconnect.body.miniGames.completedBy.c,1);
 await completeRound(f,100,1,['a','b'],'b');
 const a=await f.call('GET','',{},'a');
 const b=await f.call('GET','',{},'b');
 const c=await f.call('GET','',{},'c');
 assert.equal(a.body.miniGames.myAnswers[1].correct,true);
 assert.equal(a.body.miniGames.myAnswers[1].attempts.length,3);
 assert.equal(b.body.miniGames.myAnswers[1].correct,false);
 assert.equal(c.body.miniGames.myAnswers[1],undefined);
 f.advance(now+99001-f.time());
 const late=await f.call('POST','/minigame',{
  requestId:'trio-100-late-c-001',round:1,answer:0},'c');
 assert.equal(late.statusCode,409);
 assert.equal(late.body.error,'DOG_MINIGAME_NOT_RUNNING');
 // The first disconnected client's GET closes the fight once. Every
 // later client must observe the exact same persisted result.
 const recovered=await f.call('GET','',{},'c');
 assert.equal(recovered.body.phase,'victory');
 assert.equal(recovered.body.dogUnlocked,true);
 assert.equal(recovered.body.result.participants,3);
 const once=structuredClone(recovered.body.result);
 for(const player of players){
  const after=await f.call('GET','',{},player);
  assert.deepEqual(after.body.result,once);
  assert.equal(after.body.won,true);
  assert.equal(after.body.dogUnlocked,true);
 }
 assert.deepEqual(f.docs.get(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID)
  .sharedBosses,priorWins(100).concat(100));
 assert.equal(f.writes.filter(key=>key===
  DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID).length,34,
  'three Ready, 24 math answers, six dodges and one settlement');
});

test('Group boss receipts are bound to the exact minigame round and answer',async()=>{
 const f=fixture(20);
 for(const uid of ['a','b','c']){
  const ready=await f.call('POST','/ready',{
   requestId:'receipt-ready-'+uid+'-00001'},uid);
  assert.equal(ready.statusCode,200);
 }
 f.advance(6000);
 const requestId='receipt-mini-same-id-0001';
 const first=await f.call('POST','/minigame',{requestId,round:0,answer:1});
 assert.equal(first.statusCode,200);
 const retry=await f.call('POST','/minigame',{requestId,round:0,answer:1});
 assert.equal(retry.statusCode,200);
 assert.equal(retry.body.replayed,true);
 const wrongAnswer=await f.call('POST','/minigame',{requestId,round:0,answer:0});
 assert.equal(wrongAnswer.statusCode,409);
 assert.equal(wrongAnswer.body.error,'DOG_GROUP_RECEIPT_CONFLICT');
 const wrongRound=await f.call('POST','/minigame',{requestId,round:1,answer:1});
 assert.equal(wrongRound.statusCode,409);
 assert.equal(wrongRound.body.error,'DOG_GROUP_RECEIPT_CONFLICT');
 const view=await f.call('GET');
 assert.equal(Object.keys(view.body.miniGames.myAnswers).length,1);
});

test('Group boss ready avoids unnecessary gear reads through the 100 gates',async()=>{
 for(const gate of [20,50,100]){
  const f=fixture(gate);
  const gear=()=>f.reads.filter(key=>key.startsWith(DOG_HERO_COLLECTION+'/'));
  for(const [i,uid] of ['a','b','c'].entries()){
   const result=await f.call('POST','/ready',
    {requestId:'gear-ready-'+gate+'-'+uid+'-001'},uid);
   assert.equal(result.statusCode,200);
   assert.equal(result.body.view.phase,i===2?'fighting':'waiting');
   assert.equal(gear().length,i===2?3:0);
  }
  const stable=await f.call('GET','',{},'b');
  assert.equal(stable.body.phase,'fighting');
  assert.equal(stable.body.roster.length,3);
  assert.equal(stable.body.endsAt-stable.body.startedAt,99000);
 }
});

test('Group boss manual duo start loads only the participating heroes',async()=>{
 const f=fixture(30);
 for(const uid of ['a','b']){
  const ready=await f.call('POST','/ready',
   {requestId:'duo-gear-ready-'+uid+'-0001'},uid);
  assert.equal(ready.statusCode,200);
 }
 assert.equal(f.reads.filter(key=>key.startsWith(DOG_HERO_COLLECTION+'/')).length,0);
 const started=await f.call('POST','/start',{requestId:'duo-gear-start-000001'},'a');
 assert.equal(started.statusCode,200);
 assert.deepEqual(f.reads.filter(key=>key.startsWith(DOG_HERO_COLLECTION+'/')),
  [DOG_HERO_COLLECTION+'/a',DOG_HERO_COLLECTION+'/b']);
 assert.deepEqual(started.body.view.roster.map(x=>x.uid),['a','b']);
});

test('Group boss repeated Ready returns receipt without rewriting expedition progress',async()=>{
 const f=fixture(40),route='/ready';
 const key=DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID;
 const first=await f.call('POST',route,{requestId:'repeat-ready-first-001'},'a');
 assert.equal(first.statusCode,200);
 assert.equal(f.writes.filter(x=>x===key).length,1);
 const repeated=await f.call('POST',route,{requestId:'repeat-ready-newid-001'},'a');
 assert.equal(repeated.statusCode,200);
 assert.equal(repeated.body.replayed,false);
 assert.equal(f.writes.filter(x=>x===key).length,1);
 const again=await f.call('POST',route,{requestId:'repeat-ready-newid-001'},'a');
 assert.equal(again.body.replayed,true);
 for(const uid of ['b','c']){
  const res=await f.call('POST',route,{requestId:'launch-ready-'+uid+'-001'},uid);
  assert.equal(res.statusCode,200);
 }
 assert.equal((await f.call('GET','',{},'b')).body.phase,'fighting');
});


test('HTTP arithmetic batch submits eight answers in one write and receipt replays by value',async()=>{
 const f=fixture(20);
 const key=DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID;
 for(const uid of ['a','b','c']){
  const ready=await f.call('POST','/ready',{
   requestId:'batch-ready-'+uid+'-0000001'},uid);
  assert.equal(ready.statusCode,200);
 }
 // Four-stage boss always opens with Blitz-Mathe.
 f.advance(8400);
 const privateRound=f.docs.get(key).groupBosses[20].miniGames.rounds[0];
 assert.equal(privateRound.kind,'math');
 const answers=privateRound.puzzles.map(p=>p.correctIndex);
 const requestId='group-math-batch-same-request-0001';
 const priorWrites=f.writes.filter(x=>x===key).length;
 const first=await f.call('POST','/minigame',{
  requestId,round:0,step:0,answer:answers},'a');
 assert.equal(first.statusCode,200);
 assert.equal(first.body.result.correct,true);
 assert.equal(first.body.result.bonusPercent,6);
 assert.equal(first.body.view.miniGames.myAnswers[0].attempts.length,8);
 assert.equal(f.writes.filter(x=>x===key).length,priorWrites+1,
  'eight rapid math answers must require one progress write');
 const replay=await f.call('POST','/minigame',{
  requestId,round:0,step:0,answer:[...answers]},'a');
 assert.equal(replay.statusCode,200);
 assert.equal(replay.body.replayed,true);
 assert.equal(f.writes.filter(x=>x===key).length,priorWrites+1);
 const changed=await f.call('POST','/minigame',{
  requestId,round:0,step:0,answer:answers.map((n,i)=>i===0?(n+1)%3:n)},'a');
 assert.equal(changed.statusCode,409);
 assert.equal(changed.body.error,'DOG_GROUP_RECEIPT_CONFLICT');
 const notMine=await f.call('GET','',{},'b');
 assert.equal(notMine.body.miniGames.myAnswers[0],undefined);
});
