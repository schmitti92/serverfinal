import test from 'node:test';
import assert from 'node:assert/strict';
import {createMission3Match,viewMission3Match,applyMission3Command} from '../dog/grinch-mission3-match.js';
import {mission3LegalMoves,mission3Validate} from '../dog/grinch-mission3.js';
const roster=['alice','bob','cara'].map(uid=>({uid,name:uid}));
const fresh=()=>createMission3Match({matchId:'match-one',roster,seed:23});
function payload(m,id='command-001'){
 const choices=mission3LegalMoves(m.state,m.state.current);
 return {matchId:m.id,actionId:id,expectedRevision:m.state.revision,
  action:choices.find(x=>x.kind!=='seven')||choices[0]};
}
test('three distinct humans; isolated online match',()=>{
 const m=fresh();assert.equal(m.state.prototype,false);assert.ok(mission3Validate(m.state));
 for(const bad of [[roster[0],roster[0],roster[2]],[...roster.slice(0,2),{...roster[2],bot:true}],roster.slice(0,2)])
  assert.throws(()=>createMission3Match({matchId:'x',roster:bad,seed:1}),/GRINCH_ROSTER_INVALID/);
});
test('only owner sees cards; no seed, deck, future capture order or command log',()=>{
 const m=fresh();
 for(const [seat,p] of roster.entries()){
  const v=viewMission3Match(m,p.uid);assert.equal(v.seat,seat);
  assert.deepEqual(v.state.hands[seat],m.state.hands[seat]);
  assert.ok(v.state.hands.every((h,i)=>i===seat||h.length===0));
  assert.equal(v.state.seed,null);assert.equal(v.state.captureOrder,null);
  assert.deepEqual(v.state.draw,[]);assert.deepEqual(v.state.discard,[]);
  assert.equal(v.commands,undefined);
 }
 assert.throws(()=>viewMission3Match(m,'outsider'),/GRINCH_SPECTATOR/);
 m.state.seven={seat:0,cardId:42,as:'7',spent:2};
 assert.equal(viewMission3Match(m,'bob').state.seven.cardId,undefined);
 assert.equal(viewMission3Match(m,'alice').state.seven.cardId,42);
});
test('reject strangers, wrong turn, stale or wrong match, invented actions; no state mutation',()=>{
 const m=fresh(),p=payload(m),who=roster[m.state.current].uid;
 const original=JSON.stringify(m);
 assert.throws(()=>applyMission3Command(m,'outsider',p),/GRINCH_SPECTATOR/);
 assert.throws(()=>applyMission3Command(m,roster[(m.state.current+1)%3].uid,p),/GRINCH_NOT_YOUR_TURN/);
 assert.throws(()=>applyMission3Command(m,who,{...p,matchId:'other'}),/GRINCH_MATCH_MISMATCH/);
 assert.throws(()=>applyMission3Command(m,who,{...p,expectedRevision:999}),/GRINCH_STALE_REVISION/);
 for(const kind of ['win','preview-deal','set-stage','capture','ai'])
  assert.throws(()=>applyMission3Command(m,who,{...p,action:{kind}}),/GRINCH_ILLEGAL_ACTION/);
 assert.equal(JSON.stringify(m),original);
});
test('replayed command never reapplies a move and another account cannot reuse its ID',()=>{
 const m=fresh(),p=payload(m),who=roster[m.state.current].uid;
 const next=applyMission3Command(m,who,p);
 assert.equal(next.unchanged,false);assert.ok(next.match.state.revision>m.state.revision);
 const replay=applyMission3Command(next.match,who,p);
 assert.equal(replay.unchanged,true);assert.equal(replay.match,next.match);
 assert.throws(()=>applyMission3Command(next.match,roster[(m.state.current+1)%3].uid,p),/GRINCH_COMMAND_OWNER_MISMATCH/);
});
test('server executes Grinch in order, sends only safe animation frames, preserves all cards',()=>{
 let m=fresh(),sawAI=false;
 for(let i=0;i<30&&!m.state.complete;i++){
  const p=payload(m,'command-'+String(i).padStart(3,'0'));
  const who=roster[m.state.current].uid;
  const before=m.state.revision;
  m=applyMission3Command(m,who,p).match;
  assert.ok(mission3Validate(m.state));
  assert.ok(m.state.complete||m.state.current<3);
  const frames=viewMission3Match(m,'alice').frames;
  frames.forEach((frame,j)=>{
   assert.ok(frame.revision>(j?frames[j-1].revision:before));
   for(const k of ['hands','draw','discard','seed','captureOrder','cardId','seven'])assert.equal(frame[k],undefined);
  });
  if(frames.some(f=>f.actor===3)){sawAI=true;break;}
 }
 assert.equal(sawAI,true);
});
