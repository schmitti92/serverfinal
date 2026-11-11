import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 DOG_PREVIEW_BOTS,DOG_PREVIEW_COLLECTION,createPrivateExpedition,
 preparePrivateChapter,actPrivateExpedition,advancePrivateBoss
} from '../dog-private-preview.js';
import {dogGateProgress} from '../dog-gates.js';
import {boss10State} from '../dog-boss10.js';
import {groupBossState} from '../dog-group-boss.js';

const start=1800000000000;
const zero=()=>0;
test('Only one human and exactly two bot slots in a separate preview collection',()=>{
 assert.equal(DOG_PREVIEW_COLLECTION,'dog_private_100_gates_v1');
 const s=createPrivateExpedition('human-account','Testerin',start);
 assert.deepEqual(s.team.members.map(x=>x.uid),['human-account',...DOG_PREVIEW_BOTS]);
 assert.equal(s.team.members.length,3);
 assert.ok(s.team.members[1].name.includes('Bot'));
 assert.ok(s.team.members[2].name.includes('Bot'));
 assert.equal(s.progress.sharedBosses.length,0);
 assert.equal(s.progress.people['human-account'].currentGate,1);
});
test('One authenticated human action advances both simulated teammates only in preview',()=>{
 const initial=createPrivateExpedition('owner','Spieler',start);
 const fight=actPrivateExpedition(initial,'fight',{gate:1},start+3000,zero);
 assert.equal(fight.result.win,true);
 const p=dogGateProgress(fight.data.progress);
 for(const id of ['owner',...DOG_PREVIEW_BOTS]){
  assert.deepEqual(p.people[id].normals,[1]);
  assert.equal(p.people[id].currentGate,2);
 }
 assert.equal(initial.progress.people.owner.currentGate,1,'original record not modified');
});
test('A solo phone starts a full three-hero 92-second boss encounter at each chapter',()=>{
 for(const gate of [10,20,50,100]){
  let state=preparePrivateChapter(createPrivateExpedition('owner','Spieler',start),gate,start+1);
  const ready=actPrivateExpedition(state,'ready',{gate},start+1000,zero);
  state=ready.data;
  assert.equal(ready.result.started,true);
  assert.equal(ready.result.botsReady,2);
  const boss=gate===10?boss10State(state.progress.boss10):
   groupBossState(gate,state.progress.groupBosses[gate]);
  assert.equal(boss.phase,'fighting');
  assert.deepEqual(boss.roster.map(x=>x.uid),[...DOG_PREVIEW_BOTS,'owner']);
  assert.equal(boss.endsAt-boss.startedAt,92000);
  const tick=advancePrivateBoss(state,start+94000,zero);
  assert.equal(tick.changed,true);
  const after=gate===10?boss10State(tick.data.progress.boss10):
   groupBossState(gate,tick.data.progress.groupBosses[gate]);
  assert.ok(['victory','cooldown'].includes(after.phase));
  assert.equal(after.result.participants,3);
  assert.equal(Object.keys(after.miniGames.answers).length,2);
 }
});
test('Bot answers stay within server rules and are idempotent after fight settlement',()=>{
 const p=preparePrivateChapter(createPrivateExpedition('me','Name',start),10,start);
 const ready=actPrivateExpedition(p,'ready',{gate:10},start+1000,zero);
 const first=advancePrivateBoss(ready.data,start+15000,zero);
 const b=boss10State(first.data.progress.boss10);
 for(const id of DOG_PREVIEW_BOTS)
  assert.ok(Object.keys(b.miniGames.answers[id]||{}).length>=1);
 const second=advancePrivateBoss(first.data,start+15000,zero);
 assert.equal(second.changed,false,'no second writes when bots have already answered');
 const settled=advancePrivateBoss(first.data,start+95000,zero);
 const replay=advancePrivateBoss(settled.data,start+96000,zero);
 assert.equal(replay.changed,false,'one fight outcome only');
});
test('Test-only jump and reset never create real DOG rewards or grant other users access',()=>{
 const initial=createPrivateExpedition('mine','Test',start);
 const prepared=actPrivateExpedition(initial,'prepare',{gate:80},start+1,zero);
 assert.deepEqual(prepared.data.progress.sharedBosses,[10,20,30,40,50,60,70]);
 assert.equal(prepared.data.hero.levels.weapon,8);
 assert.equal(prepared.data.progress.people.mine.normals.length,64);
 const reset=actPrivateExpedition(prepared.data,'reset',{},start+2,zero);
 assert.equal(reset.data.progress.sharedBosses.length,0);
 assert.equal(reset.data.hero.levels.weapon,1);
 assert.equal(reset.data.ownerUid,'mine');
 assert.equal(reset.data.inventory.unopened,0);
});
test('Private preview does not make original gates publicly callable before registration',()=>{
 const code=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 assert.ok(code.indexOf("app.use('/api/dog/gates'")<code.indexOf('installDogGatesApi(app,{'));
 assert.match(code,/X-DOG-Preview-Key/);
 assert.match(code,/installDogPrivatePreviewApi\(app/);
});

test('Preview can inspect another boss without unlocking it or modifying team progress',()=>{
 const initial=createPrivateExpedition('owner','Spieler',start);
 const selected=actPrivateExpedition(initial,'select',{gate:60},start+1,zero);
 assert.equal(selected.data.bossGate,60);
 assert.equal(selected.result.type,'select');
 assert.deepEqual(selected.data.progress.sharedBosses,[]);
 assert.deepEqual(initial.progress.sharedBosses,[]);
 assert.throws(()=>actPrivateExpedition(initial,'select',{gate:13},start+1,zero),
  /PREVIEW_INVALID_GATE/);
 assert.throws(()=>actPrivateExpedition(selected.data,'ready',{gate:60},start+2,zero),
  /DOG_GROUP_PREREQUISITES/);
});
