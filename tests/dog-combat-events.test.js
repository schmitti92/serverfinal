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
