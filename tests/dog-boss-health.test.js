import test from 'node:test';
import assert from 'node:assert/strict';
import {dogHeroHp,dogGroupBossHp} from '../dog-balance.js';
import {dogCreateMiniGames,dogMiniGroupHealth,dogMiniBossLiveHp} from '../dog-boss-minigames.js';
import {boss10View,boss10DamagePotential} from '../dog-boss10.js';
import {groupBossView,groupBossDamagePotential} from '../dog-group-boss.js';

const now=1_900_000_000_000;
const team={members:[{uid:'a',name:'A'},{uid:'b',name:'B'},{uid:'c',name:'C'}]};
const roster=[{uid:'a',weaponLevel:1,armorLevel:1,skillDefense:0,skillGuard:0,
 skillPower:4,skillDestruction:4},
 {uid:'b',weaponLevel:1,armorLevel:1,skillDefense:5,skillGuard:2,
 skillPower:5,skillDestruction:5},
 {uid:'c',weaponLevel:1,armorLevel:1,skillDefense:3,skillGuard:5,
 skillPower:5,skillDestruction:5}];
const plan=()=>dogCreateMiniGames(10,()=>0,{exchange:'cinematic'});
const hp=m=>dogHeroHp({vitality:m.skillDefense},m.armorLevel);
const total=roster.reduce((sum,m)=>sum+hp(m),0);
test('group maximum HP is the sum of frozen individual equipment HP',()=>{
 for(const size of [1,2,3]){
  const models=dogMiniGroupHealth(plan(),roster.slice(0,size),0,hp);
  const expected=roster.slice(0,size).reduce((sum,m)=>sum+hp(m),0);
  assert.equal(models.maxHp,expected);
  assert.equal(models.hp,expected);
  assert.equal(models.heroes.length,size);
  for(const m of models.heroes)assert.equal(m.hp,m.maxHp);
 }
});
test('verified dodges prevent team HP loss; failed defense costs real team LP',()=>{
 const games=plan();
 const before=dogMiniGroupHealth(games,roster,20499,hp);
 assert.equal(before.hp,total,'before the first defense resolves, HP is untouched');
 const first=dogMiniGroupHealth(games,roster,21000,hp);
 assert.equal(first.remainingPercent,75);
 assert.equal(first.hp,first.heroes.reduce((n,h)=>n+h.hp,0));
 assert.ok(first.hp<total);
 const final=dogMiniGroupHealth(games,roster,49000,hp);
 assert.equal(final.remainingPercent,50);
 assert.ok(final.hp<first.hp);
 assert.equal(final.lost,final.maxHp-final.hp);
});
test('server-sourced boss HP steps down after confirmed offensive phases, never regenerates',()=>{
 const games=plan(),max=dogGroupBossHp(10);
 const base=boss10DamagePotential(roster,[],null);
 const atStart=dogMiniBossLiveHp(games,roster,7999,max,base);
 const afterOne=dogMiniBossLiveHp(games,roster,8000,max,base);
 const afterTwo=dogMiniBossLiveHp(games,roster,33000,max,base);
 assert.equal(atStart,max);
 assert.ok(afterOne<max,'first team attack reduces shown HP');
 assert.ok(afterTwo<afterOne,'second attack reduces shown HP again');
 assert.ok(afterTwo>=1,'only final server settlement can show zero');
 assert.equal(dogMiniBossLiveHp(games,roster,49500,max,base),afterTwo);
 assert.equal(dogMiniBossLiveHp(null,roster,50000,max,base),max);
});
test('10 and 20 boss views expose synchronized HP without extra state writes',()=>{
 const fight10={phase:'fighting',roster,ready:roster.map(m=>m.uid),
  startedAt:now,endsAt:now+50000,miniGames:plan()};
 const state10={boss10:fight10,people:{},sharedBosses:[]};
 const a=boss10View(team,state10,'a',now+23000);
 const b=boss10View(team,state10,'b',now+23000);
 assert.deepEqual(a.teamHealth,b.teamHealth);
 assert.equal(a.teamHealth.maxHp,total);
 assert.ok(a.teamHealth.hp<total);
 assert.ok(a.bossLiveHp<a.bossHp);
 assert.equal(a.serverNow,b.serverNow);
 const max20=dogGroupBossHp(20);
 const roster20=roster.map(m=>({...m,weaponLevel:2,armorLevel:2,skillDefense:10}));
 const state20={sharedBosses:[10],people:{},groupBosses:{
  20:{...fight10,roster:roster20,miniGames:dogCreateMiniGames(20,()=>0,{exchange:'cinematic'})}
 }};
 const c=groupBossView(20,team,state20,'c',now+34000);
 assert.equal(c.bossHp,max20);
 assert.ok(c.teamHealth.maxHp>total);
 assert.ok(c.bossLiveHp<c.bossHp);
 assert.ok(groupBossDamagePotential(20,roster20,[],null)>0);
});
