import test from 'node:test';
import assert from 'node:assert/strict';
import {bossTeam,bossSelectHero} from '../dog-boss.js';
import {dogGateMapView} from '../dog-gates.js';

const roster=[
 {uid:'player-a',name:'Chris'},
 {uid:'player-b',name:'Vanessa'},
 {uid:'player-c',name:'David'}
];
const start={members:roster,heroClasses:{'player-a':'krieger'},
 heroes:{'player-a':{hp:89,maxHp:115,guard:false}},
 phase:'fighting',bossHp:4200};
test('An old provisional appearance remains unconfirmed until first final choice',()=>{
 const state=bossTeam(start);
 assert.deepEqual(state.heroLocks,{});
 assert.equal(dogGateMapView(state,null,'player-a').members[0].heroLocked,false);
 const chosen=bossSelectHero(state,'player-a','magierin',100);
 assert.equal(chosen.heroLocks['player-a'],true);
 assert.equal(chosen.heroClasses['player-a'],'magierin');
 assert.equal(chosen.heroes['player-a'].hp,89);
 assert.equal(chosen.bossHp,4200);
});
test('All three players may independently choose the same mage; one cannot overwrite another',()=>{
 let state=bossTeam(start);
 for(let i=0;i<roster.length;i++)state=bossSelectHero(state,roster[i].uid,'magierin',200+i);
 const view=dogGateMapView(state,null,'player-b');
 assert.deepEqual(view.members.map(m=>m.heroClass),['magierin','magierin','magierin']);
 assert.deepEqual(view.members.map(m=>m.heroLocked),[true,true,true]);
 assert.equal(bossSelectHero(state,'player-b','magierin',888).updatedAt,202,
  'repeated confirmation does not update timestamp or require a write');
 assert.throws(()=>bossSelectHero(state,'player-b','krieger'),/DOG_HERO_ALREADY_LOCKED/);
 assert.deepEqual(state.members,roster);
 assert.equal(state.heroes['player-a'].hp,89);
});
test('Choice validates membership and class without allowing a second write',()=>{
 let state=bossTeam({members:[roster[0]]});
 assert.throws(()=>bossSelectHero(state,'stranger','krieger'),/NOT_DOG_TEAM_MEMBER/);
 assert.throws(()=>bossSelectHero(state,'player-a','dragon'),/DOG_HERO_CLASS_INVALID/);
 state=bossSelectHero(state,'player-a','waechter',333);
 assert.equal(state.heroClasses['player-a'],'waechter');
 assert.equal(state.heroLocks['player-a'],true);
 assert.throws(()=>bossSelectHero(state,'player-a','magierin',999),/DOG_HERO_ALREADY_LOCKED/);
 assert.equal(bossTeam(state).heroClasses['player-a'],'waechter');
});
