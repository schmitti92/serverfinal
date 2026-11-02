import test from 'node:test';
import assert from 'node:assert/strict';
import {createEierChaosMatch,acknowledgeEierChaos,advanceEierChaos,submitEierChaos,moveEierChaos,publicEierChaos,eggAt,EGG_COUNT} from '../minigames-v2/eier-chaos.js';
const members=[{uid:'a',seat:1,name:'A'},{uid:'b',seat:2,name:'B'}];
test('same deterministic egg schedule and 200 eggs',()=>{assert.equal(EGG_COUNT,200);assert.deepEqual(eggAt(0),eggAt(0));assert.throws(()=>eggAt(200));});
test('countdown waits for all players and results remain hidden',()=>{const m=createEierChaosMatch(members);acknowledgeEierChaos(m,members,'a',1000);assert.equal(m.phase,'instructions');acknowledgeEierChaos(m,members,'b',1000);assert.equal(m.startAt,4000);assert.equal(publicEierChaos(m,members,'a',5000).results,null);advanceEierChaos(m,64000);assert.equal(publicEierChaos(m,members,'a',64000).phase,'awaiting-results');submitEierChaos(m,members,'a',64000);assert.equal(m.finished,false);submitEierChaos(m,members,'b',64000);assert.equal(publicEierChaos(m,members,'a',64000).phase,'finished');});
test('server scores only basket-mouth landings once',()=>{const m=createEierChaosMatch([members[0]]);acknowledgeEierChaos(m,[members[0]],'a',0);const e=eggAt(0);moveEierChaos(m,[members[0]],'a',{x:e.x},3000+e.landMs);assert.equal(m.players.a.score,e.points);moveEierChaos(m,[members[0]],'a',{x:e.x},3000+e.landMs);assert.equal(m.players.a.score,e.points);});
test('reject invalid positions, unknown players and fabricated score payload',()=>{const m=createEierChaosMatch([members[0]]);acknowledgeEierChaos(m,[members[0]],'a',0);assert.throws(()=>moveEierChaos(m,[members[0]],'other',{x:.5},4000));assert.throws(()=>moveEierChaos(m,[members[0]],'a',{x:2},4000));moveEierChaos(m,[members[0]],'a',{x:0,score:999},4600);assert.equal(m.players.a.score,0);});

test('results wait for authoritative finish and bots are scored',()=>{
 const roster=[{uid:'a',seat:1,name:'A'},{uid:'testbot:123:eier-chaos:1',seat:2,name:'Bot 1'},{uid:'testbot:123:eier-chaos:2',seat:3,name:'Bot 2'}];
 const match=createEierChaosMatch(roster);
 roster.forEach(p=>acknowledgeEierChaos(match,roster,p.uid,1000));
 const premature=publicEierChaos(match,roster,'a',64001);
 assert.equal(premature.phase,'awaiting-results');
 assert.equal(premature.results,null);
 advanceEierChaos(match,64001);
 const finished=publicEierChaos(match,roster,'a',64001);
 assert.equal(finished.phase,'awaiting-results');
 submitEierChaos(match,roster,'a',64001);
 const revealed=publicEierChaos(match,roster,'a',64001);
 assert.equal(revealed.phase,'finished');
 assert.equal(revealed.results.length,3);
 assert.ok(revealed.results[1].score>0);
 assert.ok(revealed.results[2].score>0);
});

test('duplicate submissions never replace missing players',()=>{const m=createEierChaosMatch(members);members.forEach(p=>acknowledgeEierChaos(m,members,p.uid,0));submitEierChaos(m,members,'a',63000);submitEierChaos(m,members,'a',63000);assert.equal(m.finished,false);assert.equal(m.submitted.length,1);assert.equal(publicEierChaos(m,members,'a',63000).results,null);submitEierChaos(m,members,'b',63000);assert.equal(m.finished,true);});
