import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDogCombatStream} from '../dog-combat-events.js';
import {boss10View} from '../dog-boss10.js';
import {groupBossView} from '../dog-group-boss.js';

const heroes=[{uid:'alpha'},{uid:'beta'}];
const args={
 gate:10,attempt:3,startedAt:100000,bossHp:100,roster:heroes,
 heroMaximum:()=>50,
 strikes:[
  {round:0,slot:1,uid:'beta',kind:'hero-strike',amount:35,atMs:1200},
  {round:0,slot:0,uid:'alpha',kind:'hero-strike',amount:30,atMs:500},
  {round:1,slot:1,uid:'beta',kind:'boss-strike',amount:10,atMs:2300},
  {round:1,slot:0,uid:'alpha',kind:'boss-strike',amount:0,atMs:1800}
 ]
};
test('S-01 stable ordered events, exact HP progression and immutable retry projection',()=>{
 const events=buildDogCombatStream(args);
 assert.equal(events.fightId,'g10-t100000-a3');
 assert.equal(events.latestSequence,4);
 assert.deepEqual(events.events.map(e=>e.sequence),[1,2,3,4]);
 assert.deepEqual(events.events.map(e=>e.impactAt),[100500,101200,101800,102300]);
 assert.deepEqual(events.events.map(e=>[e.actorId,e.targetId,e.damage,e.hpBefore,e.hpAfter]),[
  ['alpha','boss',30,100,70],
  ['beta','boss',35,70,35],
  ['boss','alpha',0,50,50],
  ['boss','beta',10,50,40]
 ]);
 assert.equal(events.events[2].blocked,true);
 assert.deepEqual(buildDogCombatStream(args),events,'repeated GET has stable IDs and sequence');
 assert.equal(args.strikes[0].amount,35,'source strikes were not modified');
});
test('S-01 only uses confirmed stage strikes, never fabricates result damage',()=>{
 const empty=buildDogCombatStream({...args,strikes:[]});
 assert.equal(empty.latestSequence,0);
 assert.deepEqual(empty.events,[]);
 const waiting=buildDogCombatStream({...args,startedAt:0});
 assert.equal(waiting.fightId,null);
 assert.deepEqual(waiting.events,[]);
 const once=buildDogCombatStream({...args,strikes:args.strikes.slice(0,2)});
 assert.equal(once.latestSequence,2);
 assert.equal(once.events[1].hpAfter,35);
});
test('S-01 current boss views expose the same server protocol, without gameplay writes',()=>{
 const team={members:[{uid:'alpha',name:'A'}],heroLocks:{alpha:true}};
 const progress={people:{alpha:{currentGate:10,highestGate:10,normals:[1,2,3,4,6,7,8,9]}},
  sharedBosses:[],boss10:{phase:'waiting',attempt:1}};
 const ten=boss10View(team,progress,'alpha',100000);
 assert.equal(ten.combat.version,1);
 assert.equal(ten.combat.fightId,null);
 assert.deepEqual(ten.combat.events,[]);
 const group=groupBossView(20,team,{...progress,groupBosses:{}},'alpha',100000);
 assert.equal(group.combat.version,1);
 assert.deepEqual(group.combat.events,[]);
});

test('S-02 loss: final cinematic adjustment produces exactly remaining HP loss',()=>{
 const base={...args,endsAt:135000,result:{
  win:false,damage:85,hpRemaining:15,roll:5000,rareCritical:false
 }};
 const projection=buildDogCombatStream(base);
 const finisher=projection.events.at(-1);
 assert.equal(finisher.kind,'team-finisher');
 assert.equal(finisher.sequence,5);
 assert.equal(finisher.uid,null);
 assert.equal(finisher.actorId,'team');
 assert.equal(finisher.hpBefore,35);
 assert.equal(finisher.hpAfter,15);
 assert.equal(finisher.amount,20);
 assert.equal(finisher.rawDamage,20);
 assert.equal(finisher.overkillDamage,0);
 assert.equal(finisher.atMs,35000);
 assert.equal(finisher.impactAt,135000);
 assert.equal(projection.reconciliation.reconciled,true);
 assert.equal(projection.reconciliation.appliedDamage,85);
 assert.equal(projection.events.filter(e=>e.targetId==='boss')
  .reduce((n,e)=>n+e.damage,0),85);
 assert.equal(projection.events.filter(e=>e.targetId==='boss')
  .reduce((n,e)=>n+e.rawDamage,0),85);
 assert.deepEqual(buildDogCombatStream(base),projection,
  'reconnected clients receive the same finisher and sequence');
});

test('S-02 victory with overkill: HP subtraction and rolled total are both exact',()=>{
 const r=buildDogCombatStream({...args,endsAt:135000,result:{
  win:true,damage:125,hpRemaining:0,roll:0,rareCritical:true
 }});
 const finisher=r.events.at(-1);
 assert.equal(finisher.hpBefore,35);
 assert.equal(finisher.hpAfter,0);
 assert.equal(finisher.damage,35);
 assert.equal(finisher.rawDamage,60);
 assert.equal(finisher.overkillDamage,25);
 assert.equal(finisher.rareCritical,true);
 assert.equal(r.reconciliation.overkillDamage,25);
 assert.equal(r.events.filter(e=>e.targetId==='boss')
  .reduce((n,e)=>n+e.damage,0),100);
 assert.equal(r.events.filter(e=>e.targetId==='boss')
  .reduce((n,e)=>n+e.rawDamage,0),125);
});

test('S-02 legacy low-luck result exposes verified boss guard instead of fake damage',()=>{
 const r=buildDogCombatStream({...args,endsAt:135000,result:{
  win:false,damage:50,hpRemaining:50,roll:9999,rareCritical:false
 }});
 assert.equal(r.reconciliation.reconciled,true);
 assert.equal(r.reconciliation.guardRecovered,15);
 assert.equal(r.events.length,5);
 assert.equal(r.events.at(-1).kind,'boss-guard');
 assert.equal(r.events.at(-1).amount,-15);
 assert.equal(r.events.at(-1).hpBefore,35);
 assert.equal(r.events.at(-1).hpAfter,50);
 assert.equal(r.events.filter(e=>e.targetId==='boss')
  .reduce((n,e)=>n+e.damage,0),50);
 assert.equal(r.events.filter(e=>e.targetId==='boss')
  .reduce((n,e)=>n+e.rawDamage,0),50);
});

test('S-02 no result or equal final damage never manufactures another hit',()=>{
 assert.equal(buildDogCombatStream({...args,endsAt:135000}).events.length,4);
 const equal=buildDogCombatStream({...args,endsAt:135000,result:{
  win:false,damage:65,hpRemaining:35,roll:5000,rareCritical:false
 }});
 assert.equal(equal.reconciliation.reconciled,true);
 assert.equal(equal.events.length,4);
});

test('S-02 contradictory final result is flagged, not silently balanced',()=>{
 const r=buildDogCombatStream({...args,endsAt:135000,result:{
  win:true,damage:50,hpRemaining:0,roll:4000,rareCritical:false
 }});
 assert.equal(r.reconciliation.reconciled,false);
 assert.equal(r.events.length,4);
});

test('K-05 three living heroes get three uniquely attributed, ordered finale hits',()=>{
 const trio=[{uid:'alpha'},{uid:'beta'},{uid:'gamma'}];
 const strikes=[
  {round:4,slot:0,uid:'alpha',kind:'hero-strike',amount:10,atMs:125000},
  {round:4,slot:1,uid:'beta',kind:'hero-strike',amount:20,atMs:128000},
  {round:4,slot:2,uid:'gamma',kind:'hero-strike',amount:30,atMs:131000}
 ];
 const input={gate:10,attempt:2,startedAt:100000,endsAt:235000,
  bossHp:200,roster:trio,strikes,miniGameVersion:15,
  finalAliveUids:trio.map(h=>h.uid),
  result:{win:false,damage:150,hpRemaining:50,roll:1234},
  heroMaximum:()=>100};
 const out=buildDogCombatStream(input);
 const finish=out.finale.strikes;
 assert.equal(finish.length,3);
 assert.deepEqual(finish.map(e=>e.uid),['alpha','beta','gamma']);
 assert.deepEqual(finish.map(e=>e.sequence),[4,5,6]);
 assert.deepEqual(finish.map(e=>e.rawDamage),[15,30,45]);
 assert.deepEqual(finish.map(e=>e.damage),[15,30,45]);
 assert.deepEqual(finish.map(e=>e.impactAt),[235001,236501,238001]);
 assert.equal(out.reconciliation.reconciled,true);
 assert.equal(out.finale.outcome,'defeat');
 assert.equal(out.finale.sceneDurationMs,4500);
 assert.equal(out.events.filter(e=>e.targetId==='boss')
  .reduce((n,e)=>n+e.damage,0),150);
 assert.equal(out.events.filter(e=>e.targetId==='boss')
  .reduce((n,e)=>n+e.rawDamage,0),150);
 assert.equal(out.events.some(e=>e.kind==='team-finisher'),false);
 assert.deepEqual(buildDogCombatStream(input),out,'reconnect yields stable IDs & hit totals');
});

test('K-05 fallen players never make a final blow, surviving teammates continue',()=>{
 const trio=[{uid:'alpha'},{uid:'beta'},{uid:'gamma'}];
 const out=buildDogCombatStream({gate:20,attempt:1,startedAt:200000,
  endsAt:335000,bossHp:100,roster:trio,miniGameVersion:15,
  finalAliveUids:['alpha','gamma'],heroMaximum:()=>100,
  strikes:[{round:4,slot:0,uid:'alpha',kind:'hero-strike',amount:25,atMs:330000}],
  result:{win:true,damage:160,hpRemaining:0,rareCritical:true,roll:0}});
 assert.equal(out.finale.strikes.length,2);
 assert.deepEqual(out.finale.strikes.map(x=>x.uid),['alpha','gamma']);
 assert.equal(out.finale.strikes.some(x=>x.uid==='beta'),false);
 assert.equal(out.finale.outcome,'victory');
 assert.equal(out.finale.strikes.reduce((n,e)=>n+e.rawDamage,0),135);
 assert.equal(out.finale.strikes.reduce((n,e)=>n+e.damage,0),75);
 assert.equal(out.finale.strikes.reduce((n,e)=>n+e.overkillDamage,0),60);
 assert.equal(out.reconciliation.overkillDamage,60);
});

test('K-05 old v14 combat keeps historical S-02 team-finisher',()=>{
 const input={...args,miniGameVersion:14,finalAliveUids:['alpha','beta'],
  endsAt:135000,result:{win:false,damage:85,hpRemaining:15,roll:5}};
 const out=buildDogCombatStream(input);
 assert.equal(out.events.at(-1).kind,'team-finisher');
 assert.equal(out.finale,null);
});
