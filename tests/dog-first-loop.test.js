import test from 'node:test';
import assert from 'node:assert/strict';
import {
 boss10State,boss10View,boss10Ready,boss10Start,boss10React,boss10Finish,
 boss10ResolveCombat,boss10DamagePotential,boss10MiniAnswer,
 installDogBoss10Api,DOG_BOSS10_RECEIPTS_COLLECTION,
 DOG_BOSS10_DURATION_MS,DOG_BOSS10_COOLDOWN_MS
} from '../dog-boss10.js';
import {ascensionView,ascensionUpgrade,installDogAscensionApi} from '../dog-ascension.js';
import {DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID,dogGateProgress} from '../dog-gates.js';
import {DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID} from '../dog-boss.js';
import {DOG_MATERIALS_COLLECTION} from '../dog-materials.js';
import {DOG_HERO_COLLECTION,forgeQuote,forgeUpgrade,forgeView,installDogForgeApi} from '../dog-forge.js';

const now=1_800_000_000_000;
const normals=[1,2,3,4,6,7,8,9];
const team={members:[
 {uid:'hero-a',name:'Christoph'}, {uid:'hero-b',name:'David'},
 {uid:'hero-c',name:'Vanessa'}]};
const progress=()=>({people:Object.fromEntries(team.members.map(m=>
 [m.uid,{currentGate:10,normals,minis:[],lastAttemptAt:0}])),
 sharedBosses:[],updatedAt:0});
const heroes=()=>Object.fromEntries(team.members.map(m=>[m.uid,{levels:{
 weapon:1,armor:1,attack_power:5,destruction:5,vitality:5,blocking:5}}]));
const bag=()=>({resources:{
 iron:40,forge_coal:10,steel_core:5,mithril:2,dragonsteel:1,
 life_dust:40,guard_crystal:10,life_essence:5,guardian_rune:2,phoenix_feather:1
 }});
function solveFirstTwo(state,uid){
 for(const round of state.boss10.miniGames.rounds.slice(0,2)){
  const at=round.kind==='reaction'?round.targetMs:round.startMs+300;
  const answer=round.kind==='reaction'?1:
   round.kind==='math'?round.correctIndex:
   round.kind==='target'?(round.initialIndex+
    Math.floor((at-round.startMs)/round.stepMs))%round.lanes:
   Array.from({length:round.lanes},(_,i)=>i).find(i=>
    i!==round.dangerIndex&&i!==round.secondDangerIndex);
  const result=boss10MiniAnswer(state,uid,round.round,answer,now+at);
  assert.equal(result.result.correct,true);
  state=result.progress;
 }
 return state;
}


test('Only participating heroes must clear Tor 9; others may prepare later',()=>{
 let p=progress();p.people['hero-b'].normals=p.people['hero-b'].normals.filter(x=>x!==9);
 const first=boss10Ready(p,team,'hero-a',heroes(),now);
 assert.deepEqual(first.boss10.ready,['hero-a']);
 assert.throws(()=>boss10Ready(first,team,'hero-b',heroes(),now),/DOG_BOSS10_PREREQUISITES/);
 const solo=boss10Start(first,team,'hero-a',heroes(),now);
 assert.equal(solo.boss10.roster.length,1);
 assert.equal(boss10State(null).phase,'waiting');
 assert.equal(boss10View(team,progress(),'hero-a').teamReady,true);
 assert.equal(boss10View(team,progress(),'hero-a').eligible,true);
 assert.equal(boss10View(team,progress(),'hero-z').isMember,false);
});

test('Solo starts immediately on explicit Start but cannot win under any luck roll',()=>{
 const p=boss10Ready(progress(),team,'hero-a',heroes(),now);
 assert.equal(p.boss10.phase,'waiting');
 assert.throws(()=>boss10Start(p,team,'hero-c',heroes(),now),/NOT_READY/);
 const started=boss10Start(p,team,'hero-a',heroes(),now);
 assert.equal(started.boss10.phase,'fighting');
 assert.deepEqual(started.boss10.ready,['hero-a']);
 assert.deepEqual(started.boss10.roster.map(m=>m.uid),['hero-a']);
 const attempted=solveFirstTwo(started,'hero-a');
 for(const roll of [0,50,5000,9999]){
  const out=boss10Finish(attempted,now+30001,()=>roll);
  assert.equal(out.result.win,false);
  assert.equal(out.result.participants,1);
  assert.ok(out.result.damage<out.result.bossHp);
  assert.deepEqual(out.progress.sharedBosses,[]);
 }
 assert.throws(()=>boss10MiniAnswer(started,'hero-c',0,1,now+4000),
  /NOT_PARTICIPANT/);
});

test('Two maxed heroes can win a very rare special attack; ordinary luck is insufficient',()=>{
 let p=progress();
 p=boss10Ready(p,team,'hero-a',heroes(),now);
 p=boss10Ready(p,team,'hero-b',heroes(),now);
 const started=boss10Start(p,team,'hero-a',heroes(),now);
 assert.equal(started.boss10.roster.length,2);
 assert.equal(started.boss10.phase,'fighting');
 p=solveFirstTwo(started,'hero-a');
 p=solveFirstTwo(p,'hero-b');
 const ordinary=boss10Finish(p,now+30001,()=>9999);
 assert.equal(ordinary.result.win,false);
 const extremelyLucky=boss10Finish(p,now+30001,()=>0);
 assert.equal(extremelyLucky.result.win,true);
 assert.equal(extremelyLucky.result.rareCritical,true);
 assert.equal(extremelyLucky.result.participants,2);
 assert.ok(extremelyLucky.result.damage>=extremelyLucky.result.bossHp);
 const noRare=boss10Finish(p,now+30001,((n)=>{let count=0;
  return ()=>++count===1?0:9999;
 })());
 assert.equal(noRare.result.win,false);
 assert.equal(noRare.result.rareCritical,false);
 assert.equal(noRare.result.participants,2);
});

test('Three well prepared heroes deal enough damage to win without rare duo luck',()=>{
 let p=progress();
 for(const member of team.members)p=boss10Ready(p,team,member.uid,heroes(),now);
 assert.equal(p.boss10.phase,'fighting');
 const result=boss10Finish(p,now+30001,()=>0);
 assert.equal(result.result.win,true);
 assert.equal(result.result.participants,3);
 assert.equal(result.result.rareCritical,false);
 assert.ok(result.result.damage>=result.result.bossHp);
 const bad=boss10Finish(p,now+30001,()=>9999);
 assert.equal(bad.result.win,false,'very poor luck can still defeat a strong trio');
 const weak=team.members.map(m=>({uid:m.uid,weaponLevel:1,armorLevel:1,
  skillPower:0,skillDestruction:0,skillDefense:0,skillGuard:0}));
 assert.ok(boss10DamagePotential(weak,[])<boss10DamagePotential(p.boss10.roster,[]));
 assert.equal(boss10ResolveCombat(weak,[],()=>0).win,false);
});

test('Three ready commands start exactly one 30-second encounter',()=>{
 let state=progress();
 state=boss10Ready(state,team,'hero-a',heroes(),now);
 assert.equal(state.boss10.phase,'waiting');
 assert.equal(state.boss10.ready.length,1);
 assert.deepEqual(boss10Ready(state,team,'hero-a',heroes(),now),state);
 state=boss10Ready(state,team,'hero-b',heroes(),now);
 assert.equal(state.boss10.phase,'waiting');
 state=boss10Ready(state,team,'hero-c',heroes(),now);
 assert.equal(state.boss10.phase,'fighting');
 assert.equal(state.boss10.endsAt-state.boss10.startedAt,DOG_BOSS10_DURATION_MS);
 assert.equal(state.boss10.roster.length,3);
 assert.throws(()=>boss10Finish(state,now+29999,()=>0),/STILL_FIGHTING/);
 assert.throws(()=>boss10Ready(state,team,'hero-a',heroes(),now+200),/RUNNING/);
});

test('Timed minigames are one-shot per player and group success unlocks forge level 2',()=>{
 let state=progress();
 for(const member of team.members)state=boss10Ready(state,team,member.uid,heroes(),now);
 state=solveFirstTwo(state,'hero-a');
 const first=state.boss10.miniGames.rounds[0];
 const once=boss10MiniAnswer(state,'hero-a',first.round,0,
  now+first.startMs+400);
 assert.equal(once.result.replayed,true);
 assert.deepEqual(once.progress,state);
 state=solveFirstTwo(state,'hero-b');
 assert.equal(Object.keys(state.boss10.miniGames.answers['hero-b']).length,2);
 assert.throws(()=>boss10MiniAnswer(state,'hero-c',0,1,now+30000),/NOT_RUNNING/);
 const won=boss10Finish(state,now+30001,()=>0);
 assert.equal(won.result.win,true);
 assert.deepEqual(won.progress.sharedBosses,[10]);
 for(const member of team.members){
  assert.equal(won.progress.people[member.uid].currentGate,11,
   'all three positions move to at least Tor 11 after victory');
  assert.equal(won.progress.people[member.uid].highestGate,11,
   'highest gate is also advanced by the shared win');
 }
 assert.equal(won.progress.boss10.phase,'victory');
 assert.ok(won.progress.boss10.result.damage>=won.progress.boss10.result.bossHp);
 assert.equal(boss10View(team,won.progress,'hero-a').result.participants,3);
 assert.equal(ascensionView(null,bag(),won.progress).forgeLevel,2);
 assert.equal(ascensionView(null,bag(),won.progress).skillsCap,10);
 assert.throws(()=>boss10Ready(won.progress,team,'hero-a',heroes(),now+30002),/ALREADY_WON/);
});

test('Shared victory does not move a hero backwards from Tor 14',()=>{
 let state=progress();
 state.people['hero-a'].currentGate=14;
 for(const member of team.members)state=boss10Ready(state,team,member.uid,heroes(),now);
 const won=boss10Finish(state,now+30001,()=>0);
 assert.equal(won.progress.people['hero-a'].currentGate,14);
 assert.equal(won.progress.people['hero-b'].currentGate,11);
 assert.equal(won.progress.people['hero-a'].highestGate,14);
 assert.equal(won.progress.people['hero-b'].highestGate,11);
});

test('Defeat triggers a group-wide cooldown and resets only after expiry',()=>{
 let state=progress();
 for(const member of team.members)state=boss10Ready(state,team,member.uid,heroes(),now);
 const loss=boss10Finish(state,now+30001,()=>9999);
 assert.equal(loss.result.win,false);
 assert.equal(loss.progress.sharedBosses.length,0);
 assert.equal(loss.progress.boss10.phase,'cooldown');
 assert.equal(loss.progress.boss10.cooldownUntil,now+DOG_BOSS10_DURATION_MS+DOG_BOSS10_COOLDOWN_MS);
 assert.throws(()=>boss10Ready(loss.progress,team,'hero-a',heroes(),now+50000),/COOLDOWN/);
 const retry=boss10Ready(loss.progress,team,'hero-a',heroes(),
  now+30001+DOG_BOSS10_COOLDOWN_MS+1);
 assert.equal(retry.boss10.phase,'waiting');
 assert.deepEqual(retry.boss10.ready,['hero-a']);
 assert.equal(retry.boss10.attempt,2);
});

test('Late reconnect does not restart an already elapsed ten-minute defeat cooldown',()=>{
 let p=progress();
 for(const member of team.members)p=boss10Ready(p,team,member.uid,heroes(),now);
 const recovered=boss10Finish(p,now+DOG_BOSS10_DURATION_MS+DOG_BOSS10_COOLDOWN_MS+50000,()=>9999);
 assert.equal(recovered.result.win,false);
 assert.equal(recovered.progress.boss10.cooldownUntil,
  now+DOG_BOSS10_DURATION_MS+DOG_BOSS10_COOLDOWN_MS);
 const retry=boss10Ready(recovered.progress,team,'hero-a',heroes(),
  now+DOG_BOSS10_DURATION_MS+DOG_BOSS10_COOLDOWN_MS+50001);
 assert.equal(retry.boss10.phase,'waiting');
});

test('Normal gate saves never delete an ongoing shared boss state',()=>{
 let state=progress();
 state=boss10Ready(state,team,'hero-a',heroes(),now);
 const after=dogGateProgress(state);
 assert.equal(after.boss10.phase,'waiting');
 assert.deepEqual(after.boss10.ready,['hero-a']);
});

test('Boss-gated forge will not spend materials before group victory',()=>{
 const p=progress();
 const h={levels:{weapon:1,armor:1}};
 const inv=bag();
 const locked=ascensionView(h,inv,p);
 assert.equal(locked.forgeLevel,1);
 assert.equal(locked.quotes.weapon.locked,true);
 assert.throws(()=>ascensionUpgrade(h,inv,p,'weapon',1,0,now),/BOSS_REQUIRED/);
 assert.equal(inv.resources.iron,40);
 p.sharedBosses.push(10);
 const after=ascensionView(h,inv,p);
 assert.equal(after.quotes.weapon.locked,false);
 assert.deepEqual(after.quotes.weapon.cost,{iron:3});
 assert.deepEqual(after.quotes.armor.cost,{life_dust:3});
 assert.equal(after.quotes.weapon.successChance,100);
 const first=ascensionUpgrade(h,inv,p,'weapon',1,0,now);
 assert.equal(first.hero.levels.weapon,2);
 assert.equal(first.hero.levels.armor,1);
 assert.equal(first.inventory.resources.iron,37);
 assert.throws(()=>ascensionUpgrade(first.hero,first.inventory,p,'weapon',2,0,now),/BOSS_REQUIRED/);
});

test('The existing forge is also boss-gated for expedition members',()=>{
 const inv=bag(),hero={levels:{weapon:1,armor:1,attack_power:5}};
 const locked={sharedBosses:[]};
 const q=forgeQuote('weapon',1,inv.resources,locked);
 assert.equal(q.unlockedMaxLevel,1);
 assert.equal(q.maxLevel,10);
 assert.equal(q.locked,true);
 assert.deepEqual(q.cost,{iron:3});
 assert.throws(()=>forgeUpgrade(hero,inv,'weapon',1,0,now,locked),
  /DOG_FORGE_BOSS_REQUIRED/);
 assert.equal(forgeQuote('attack_power',5,inv.resources,locked).locked,true);
 const unlocked={sharedBosses:[10]};
 assert.equal(forgeQuote('weapon',1,inv.resources,unlocked).locked,false);
 assert.equal(forgeQuote('attack_power',5,inv.resources,unlocked).locked,false);
 const upgrade=forgeUpgrade(hero,inv,'weapon',1,0,now,unlocked);
 assert.equal(upgrade.hero.levels.weapon,2);
 assert.equal(upgrade.inventory.resources.iron,37);
 assert.throws(()=>forgeUpgrade(upgrade.hero,upgrade.inventory,'weapon',2,0,now,unlocked),
  /DOG_FORGE_BOSS_REQUIRED/);
 assert.equal(forgeQuote('weapon',13,inv.resources,unlocked).maxed,true);
 assert.equal(forgeView({levels:{weapon:13}},inv,unlocked).hero.levels.weapon,13);
});

test('Existing weapon levels beyond 10 remain saved but cannot be forged higher',()=>{
 const p=progress();p.sharedBosses=[10];
 const h={levels:{weapon:13,armor:1}};
 const v=ascensionView(h,bag(),p);
 assert.equal(v.hero.levels.weapon,13);
 assert.equal(v.quotes.weapon.legacy,true);
 assert.equal(v.quotes.weapon.maxed,true);
 assert.throws(()=>ascensionUpgrade(h,bag(),p,'weapon',13,0,now),/LEGACY_LEVEL/);
});

function fixture(){
 const docs=new Map(),routes=new Map();
 let time=now;let dice=0;
 const snapshot=k=>({exists:docs.has(k),data:()=>structuredClone(docs.get(k))});
 const db={collection:c=>({doc:id=>({key:c+'/'+id,get:async()=>snapshot(c+'/'+id)})}),
  runTransaction:async fn=>{
   const changes=[];let writes=false;
   const tx={get:async ref=>{assert.equal(writes,false,'read before writes');return snapshot(ref.key)},
    set:(ref,val)=>{writes=true;changes.push(['set',ref.key,structuredClone(val)])},
    create:(ref,val)=>{writes=true;changes.push(['create',ref.key,structuredClone(val)])}};
   const result=await fn(tx);
   for(const [op,k,v] of changes){if(op==='create'&&docs.has(k))throw Error('DUPLICATE');
    docs.set(k,v)}
   return result;
  }};
 const app={get:(route,...fn)=>routes.set('GET '+route,fn),
  post:(route,...fn)=>routes.set('POST '+route,fn)};
 const identity=async token=>['a','b','c'].includes(token)?{uid:'hero-'+token,name:token}:null;
 for(const m of team.members){
  docs.set(DOG_HERO_COLLECTION+'/'+m.uid,heroes()[m.uid]);
  docs.set(DOG_MATERIALS_COLLECTION+'/'+m.uid,bag());
 }
 docs.set(DOG_BOSS_TEAM_COLLECTION+'/'+DOG_BOSS_TEAM_ID,team);
 docs.set(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID,progress());
 installDogBoss10Api(app,{verifyProfile:identity,getFirestore:()=>db,clock:()=>time,
  rand:max=>Math.min(dice,max-1)});
 installDogAscensionApi(app,{verifyProfile:identity,getFirestore:()=>db,clock:()=>time,
  rand:max=>Math.min(dice,max-1)});
 installDogForgeApi(app,{verifyProfile:identity,getFirestore:()=>db,rand:max=>Math.min(dice,max-1)});
 async function call(method,route,body={},token='a'){
  const handlers=routes.get(method+' '+route);assert.ok(handlers,'missing '+method+' '+route);
  const req={body,get:header=>header==='authorization'?'Bearer '+token:''};
  const res={statusCode:200,status(n){this.statusCode=n;return this},set(){return this},
   json(v){this.body=v;return v}};
  for(const fn of handlers){
   if(res.body)break;
   if(fn.length===3)await new Promise((resolve,reject)=>{
    let settled=false;
    Promise.resolve(fn(req,res,()=>{settled=true;resolve()}))
     .then(()=>{if(!settled)resolve()},reject);
   });
   else await fn(req,res);
  }
  return res;
 }
 return {docs,call,advance:ms=>time+=ms,roll:n=>dice=n};
}

test('After everyone disconnects, a later boss view settles the fight exactly once',async()=>{
 const f=fixture();
 for(const [i,t] of ['a','b','c'].entries()){
  const r=await f.call('POST','/api/dog/gates/boss10/ready',
   {requestId:'resume-ready-'+i+'-00001'},t);
  assert.equal(r.statusCode,200);
 }
 f.advance(DOG_BOSS10_DURATION_MS+5000);
 const recovered=await f.call('GET','/api/dog/gates/boss10',{},'b');
 assert.equal(recovered.body.phase,'victory');
 assert.equal(recovered.body.won,true);
 assert.deepEqual(f.docs.get(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID)
  .sharedBosses,[10]);
 const other=await f.call('GET','/api/dog/gates/boss10',{},'c');
 assert.equal(other.body.phase,'victory');
 assert.equal(other.body.result.roll,recovered.body.result.roll);
 assert.deepEqual(f.docs.get(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID)
  .sharedBosses,[10]);
 const laterAttempt=await f.call('POST','/api/dog/gates/boss10/finish',
  {requestId:'after-recovery-finish-0001'});
 assert.equal(laterAttempt.statusCode,409);
 assert.equal(laterAttempt.body.error,'DOG_BOSS10_NOT_RUNNING');
});

test('Expired fight reconciles to loss with cooldown measured from original deadline',async()=>{
 const f=fixture();f.roll(9999);
 for(const [i,t] of ['a','b','c'].entries()){
  const r=await f.call('POST','/api/dog/gates/boss10/ready',
   {requestId:'late-loss-ready-'+i+'-00001'},t);
  assert.equal(r.statusCode,200);
 }
 f.advance(DOG_BOSS10_DURATION_MS+DOG_BOSS10_COOLDOWN_MS+20000);
 const view=await f.call('GET','/api/dog/gates/boss10',{},'a');
 assert.equal(view.body.phase,'cooldown');
 assert.equal(view.body.cooldownRemainingMs,0);
 assert.equal(view.body.won,false);
 const retry=await f.call('POST','/api/dog/gates/boss10/ready',
  {requestId:'retry-after-late-loss-00001'},'a');
 assert.equal(retry.body.phase??retry.body.view?.phase,'waiting');
});

test('Live boss API accepts a solo start and records a permanent failed fight',async()=>{
 const f=fixture();
 const ready=await f.call('POST','/api/dog/gates/boss10/ready',{
  requestId:'solo-readiness-00000001'},'a');
 assert.equal(ready.statusCode,200);
 assert.equal(ready.body.view.phase,'waiting');
 assert.equal(ready.body.view.canStart,true);
 const started=await f.call('POST','/api/dog/gates/boss10/start',{
  requestId:'solo-start-000000001'},'a');
 assert.equal(started.statusCode,200);
 assert.equal(started.body.view.phase,'fighting');
 assert.equal(started.body.view.roster.length,1);
 const outsiderReaction=await f.call('POST','/api/dog/gates/boss10/react',{
  requestId:'outsider-reaction-000001'},'b');
 assert.equal(outsiderReaction.statusCode,403);
 assert.equal(outsiderReaction.body.error,'DOG_BOSS10_NOT_PARTICIPANT');
 f.advance(DOG_BOSS10_DURATION_MS);
 const finished=await f.call('POST','/api/dog/gates/boss10/finish',{
  requestId:'solo-finish-00000001'},'a');
 assert.equal(finished.statusCode,200);
 assert.equal(finished.body.result.win,false);
 assert.equal(finished.body.result.participants,1);
 assert.equal(finished.body.view.won,false);
 assert.deepEqual(f.docs.get(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID)
  .sharedBosses,[]);
});

test('Live boss API allows a two-player rare victory and unlocks the shared forge',async()=>{
 const f=fixture();
 for(const t of ['a','b']){
  const r=await f.call('POST','/api/dog/gates/boss10/ready',{
   requestId:'duo-ready-'+t+'-00000001'},t);
  assert.equal(r.statusCode,200);
 }
 const started=await f.call('POST','/api/dog/gates/boss10/start',{
  requestId:'duo-start-0000000001'},'a');
 assert.equal(started.statusCode,200);
 assert.equal(started.body.view.roster.length,2);
 assert.equal(started.body.view.phase,'fighting');
 // Same 3-of-4 challenges for both users; server validates their
 // individual reaction timing and math choices without a client success flag.
 f.advance(6000);
 for(const t of ['a','b']){
  const r=await f.call('POST','/api/dog/gates/boss10/minigame',{
   requestId:'duo-reaction-'+t+'-001',round:0,answer:1},t);
  assert.equal(r.statusCode,200);
  assert.equal(r.body.result.correct,true);
 }
 f.advance(4500);
 for(const t of ['a','b']){
  const r=await f.call('POST','/api/dog/gates/boss10/minigame',{
   requestId:'duo-math-'+t+'-00001',round:1,answer:0},t);
  assert.equal(r.statusCode,200);
  assert.equal(r.body.result.correct,true);
 }
 f.advance(DOG_BOSS10_DURATION_MS-10500);
 const finished=await f.call('POST','/api/dog/gates/boss10/finish',{
  requestId:'duo-finish-000000001'},'b');
 assert.equal(finished.statusCode,200);
 assert.equal(finished.body.result.win,true);
 assert.equal(finished.body.result.rareCritical,true);
 assert.equal(finished.body.view.result.participants,2);
 assert.equal(finished.body.view.won,true);
 const forged=await f.call('GET','/api/dog/gates/ascension',{},'c');
 assert.equal(forged.body.forgeLevel,2,'the rare joint success unlocks the whole team');
 const replay=await f.call('POST','/api/dog/gates/boss10/finish',{
  requestId:'duo-finish-000000001'},'b');
 assert.equal(replay.body.replayed,true);
 assert.equal(replay.body.result.damage,finished.body.result.damage);
});

test('Legacy forge endpoint cannot bypass the boss-10 limit',async()=>{
 const f=fixture();
 const blocked=await f.call('GET','/api/dog/forge/me');
 assert.equal(blocked.body.ok,true);
 assert.equal(blocked.body.forgeLevel,1);
 assert.equal(blocked.body.quotes.find(q=>q.itemId==='weapon').locked,true);
 const upgradeBefore=await f.call('POST','/api/dog/forge/upgrade',{
  requestId:'legacy-bypass-try-0001',itemId:'weapon',expectedLevel:1});
 assert.equal(upgradeBefore.statusCode,409);
 assert.equal(upgradeBefore.body.error,'DOG_FORGE_BOSS_REQUIRED');
 const p=f.docs.get(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID);
 p.sharedBosses=[10];f.docs.set(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID,p);
 const allowed=await f.call('POST','/api/dog/forge/upgrade',{
  requestId:'legacy-forge-after-win-0001',itemId:'weapon',expectedLevel:1});
 assert.equal(allowed.body.ok,true);
 assert.equal(allowed.body.result.success,true);
 assert.equal(allowed.body.hero.levels.weapon,2);
 assert.equal(allowed.body.inventory.resources.iron,37);
 const repeat=await f.call('POST','/api/dog/forge/upgrade',{
  requestId:'legacy-forge-after-win-0001',itemId:'weapon',expectedLevel:1});
 assert.equal(repeat.body.replayed,true);
 assert.equal(repeat.body.inventory.resources.iron,37);
});

test('Authenticated API completes ready/fight/forge cycle without double claims',async()=>{
 const f=fixture();
 assert.equal((await f.call('GET','/api/dog/gates/boss10')).body.phase,'waiting');
 for(const [i,t] of ['a','b','c'].entries()){
  const r=await f.call('POST','/api/dog/gates/boss10/ready',
   {requestId:'ready-hero-'+i+'-long-0001'},t);
  assert.equal(r.body.ok,true);
 }
 const start=await f.call('GET','/api/dog/gates/boss10');
 assert.equal(start.body.phase,'fighting');
 const premature=await f.call('POST','/api/dog/gates/boss10/finish',
  {requestId:'finish-shared-000001'});
 assert.equal(premature.statusCode,409);
 f.advance(30000);
 const won=await f.call('POST','/api/dog/gates/boss10/finish',
  {requestId:'finish-shared-000001'});
 assert.equal(won.body.result.win,true);
 assert.equal(won.body.view.won,true);
 const repeat=await f.call('POST','/api/dog/gates/boss10/finish',
  {requestId:'finish-shared-000001'});
 assert.equal(repeat.body.replayed,true);
 const other=await f.call('POST','/api/dog/gates/boss10/finish',
  {requestId:'finish-shared-new-002'});
 assert.equal(other.statusCode,409,'cannot reroll a finished boss');
 const before=await f.call('GET','/api/dog/gates/ascension');
 assert.equal(before.body.forgeLevel,2);
 const upgrade=await f.call('POST','/api/dog/gates/ascension/upgrade',
  {requestId:'first-upgrade-unique-0001',type:'weapon',expectedLevel:1});
 assert.equal(upgrade.body.result.success,true);
 assert.equal(upgrade.body.view.hero.levels.weapon,2);
 const replay=await f.call('POST','/api/dog/gates/ascension/upgrade',
  {requestId:'first-upgrade-unique-0001',type:'weapon',expectedLevel:1});
 assert.equal(replay.body.replayed,true);
 assert.equal(replay.body.view.resources.iron,37);
 const otherHero=await f.call('GET','/api/dog/gates/ascension',{},'b');
 assert.equal(otherHero.body.hero.levels.weapon,1);
 assert.equal(otherHero.body.forgeLevel,2);
 assert.equal(f.docs.get(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID).sharedBosses.length,1);
 assert.ok(f.docs.has(DOG_BOSS10_RECEIPTS_COLLECTION+'/hero-a_finish-shared-000001'));
});

test('Boss 10 receipt retry checks the original minigame round and answer',async()=>{
 const f=fixture();
 for(const uid of ['a','b','c']){
  const ready=await f.call('POST','/api/dog/gates/boss10/ready',{
   requestId:'boss10-receipt-ready-'+uid+'-01'},uid);
  assert.equal(ready.statusCode,200);
 }
 f.advance(6000);
 const route='/api/dog/gates/boss10/minigame';
 const requestId='boss10-mini-receipt-00001';
 const first=await f.call('POST',route,{requestId,round:0,answer:1},'a');
 assert.equal(first.statusCode,200);
 const retry=await f.call('POST',route,{requestId,round:0,answer:1},'a');
 assert.equal(retry.statusCode,200);
 assert.equal(retry.body.replayed,true);
 for(const payload of [{round:0,answer:0},{round:1,answer:1}]){
  const conflict=await f.call('POST',route,{requestId,...payload},'a');
  assert.equal(conflict.statusCode,409);
  assert.equal(conflict.body.error,'DOG_BOSS10_RECEIPT_CONFLICT');
 }
 const state=await f.call('GET','/api/dog/gates/boss10',{},'a');
 assert.equal(Object.keys(state.body.miniGames.myAnswers).length,1);
});
