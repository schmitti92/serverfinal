import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dogGateProgress} from '../dog-gates.js';
import {boss10State} from '../dog-boss10.js';
import {groupBossState} from '../dog-group-boss.js';
import {
 DOG_LIVE_BOT_IDS,DOG_LIVE_PILOT_COLLECTION,addLiveBots,isLiveBotTeam,
 mirrorLiveBotVictory,readyWithLiveBots,advanceLiveBotFight,
 advanceAllLiveBotFights,liveBotHero
} from '../dog-live-bots.js';

const now=1800000000000,rand=()=>0;
function progressAtBoss(gate){
 const data=addLiveBots(null,null,'real-owner','Echter Spieler',now);
 const normals=Array.from({length:gate-1},(_,i)=>i+1)
  .filter(x=>x%10!==0&&x%10!==5);
 const people={};
 for(const uid of ['real-owner',...DOG_LIVE_BOT_IDS])
  people[uid]={currentGate:gate,highestGate:gate,
   normals:[...normals],minis:[],miniRewards:[],lastAttemptAt:0,lastResult:null};
 return {...data,progress:{...data.progress,people,
  sharedBosses:Array.from({length:gate/10-1},(_,i)=>(i+1)*10)}};
}
test('Two fake slots join the REAL shared team without a separate team document',()=>{
 assert.equal(DOG_LIVE_PILOT_COLLECTION,'dog_live_pilot_owner_v1');
 const {team,progress}=addLiveBots(null,null,'real-owner','Echter Spieler',now);
 assert.deepEqual(team.members.map(x=>x.uid),['real-owner',...DOG_LIVE_BOT_IDS]);
 assert.equal(isLiveBotTeam(team,'real-owner'),true);
 assert.equal(isLiveBotTeam(team,'other-human'),false);
 assert.equal(progress.people['real-owner'].highestGate,1);
 assert.equal(Object.keys(progress.people).length,3);
});
test('Existing real teammates cannot silently be removed or replaced',()=>{
 const existing={members:[
  {uid:'real-owner',name:'Echt'},{uid:'friend',name:'Vanessa'}]};
 assert.throws(()=>addLiveBots(existing,null,'real-owner','Echt',now),
  /DOG_BOTS_OTHER_PLAYERS_IN_TEAM/);
});
test('Idempotent reactivation keeps the existing real map progress',()=>{
 const initial=addLiveBots(null,null,'real-owner','Echter Spieler',now);
 const progressed={...initial.progress,people:{...initial.progress.people,
  'real-owner':{...initial.progress.people['real-owner'],
   normals:[1,2,3],currentGate:4,highestGate:4}}};
 const first=addLiveBots(initial.team,progressed,'real-owner','Echter Spieler',now+1000);
 const again=addLiveBots(first.team,first.progress,'real-owner','Echter Spieler',now+2000);
 assert.equal(again.team.members.length,3);
 assert.deepEqual(again.progress.people['real-owner'].normals,[1,2,3]);
 assert.deepEqual(again.progress.people[DOG_LIVE_BOT_IDS[0]].normals,[1,2,3]);
});
test('A real normal-gate win updates both bots; losing or mini-boss does not',()=>{
 const start=addLiveBots(null,null,'real-owner','Spieler',now);
 const next=mirrorLiveBotVictory(start.progress,start.team,'real-owner',1,now+1);
 assert.deepEqual(next.people[DOG_LIVE_BOT_IDS[0]].normals,[1]);
 assert.deepEqual(next.people[DOG_LIVE_BOT_IDS[1]].normals,[1]);
 assert.equal(next.people['real-owner'].normals.length,0);
 const ignored=mirrorLiveBotVictory(next,start.team,'real-owner',5,now+10);
 assert.deepEqual(ignored,next);
});
test('The real Boss-10 endpoint can automatically ready two bots and the human',()=>{
 const {team,progress}=progressAtBoss(10);
 const hero={levels:{weapon:1,armor:1,attack_power:5,
  destruction:5,vitality:5,blocking:5}};
 const ready=readyWithLiveBots(10,progress,team,'real-owner',hero,now+1000,rand);
 const state=boss10State(ready.boss10);
 assert.equal(state.phase,'fighting');
 assert.deepEqual(state.roster.map(x=>x.uid),[...DOG_LIVE_BOT_IDS,'real-owner']);
 assert.equal(state.endsAt-state.startedAt,125000);
 const result=advanceLiveBotFight(10,ready,team,'real-owner',now+127000,rand);
 assert.equal(result.changed,true);
 const finished=boss10State(result.progress.boss10);
 assert.equal(finished.result.participants,3);
 assert.equal(Object.keys(finished.miniGames.answers).length,2);
 const again=advanceLiveBotFight(10,result.progress,team,'real-owner',now+128000,rand);
 assert.equal(again.changed,false);
});
test('Boss 20–100 uses the exact ordinary group-boss engine with real hero equipment',()=>{
 for(const gate of [20,50,100]){
  const {team,progress}=progressAtBoss(gate);
  const hero=liveBotHero(gate,0);
  const ready=readyWithLiveBots(gate,progress,team,'real-owner',hero,now+1000,rand);
  const b=groupBossState(gate,ready.groupBosses[gate]);
  assert.equal(b.phase,'fighting');
  assert.equal(b.roster.length,3);
  const settled=advanceAllLiveBotFights(ready,team,'real-owner',now+127000,rand);
  const result=groupBossState(gate,settled.progress.groupBosses[gate]);
  assert.equal(settled.changed,true);
  assert.ok(['victory','cooldown'].includes(result.phase));
  assert.equal(result.result.participants,3);
 }
});
test('Live access is owner-gated before any expedition API is registered',()=>{
 const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 const lock=source.indexOf('installDogLivePilotApi(app');
 const gates=source.indexOf('installDogGatesApi(app');
 const boss=source.indexOf('installDogBoss10Api(app');
 assert.ok(lock>0&&lock<gates&&gates<boss);
 assert.match(source,/botLogic:liveBotLogic/);
 assert.doesNotMatch(source,/DOG_EVENT_PRIVATE_TEST/);
});
