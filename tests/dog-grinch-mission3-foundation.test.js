import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createMission3,mission3LegalMoves,mission3Play,mission3AutoGrinch,
 mission3SetPreviewStage,mission3NextPreviewDeal,mission3Validate,
 mission3CardTotal,mission3Projection,MISSION3_GRINCH,MISSION3_TYPES
} from '../dog/grinch-mission3.js';
const p=(s,id)=>s.pieces.find(p=>p.id===id);
function cleanBoard(s){
 // Ensure test setup positions are unique and not on special fields by default.
 s.pieces.forEach((piece,i)=>{piece.place='track';piece.pos=20+i;piece.frozenTurns=0;});
 s.current=0;s.grinchActionsLeft=0;s.grinchUsed=[];s.seven=null;
 return s;
}
const apply=(s,match)=>{const m=mission3LegalMoves(s).find(match);assert.ok(m,'expected a legal card action');return mission3Play(s,s.current,m);};
test('exact 14 unique, random positions, red/blue/yellow have three pawns, green has five',()=>{
 for(const seed of [2,3,19,399,2026]){
  const s=createMission3(seed,['Alice','Bob','Carla']);
  assert.equal(s.pieces.length,14);
  assert.equal(new Set(s.pieces.map(p=>p.pos)).size,14);
  assert.deepEqual([0,1,2,3].map(owner=>s.pieces.filter(p=>p.owner===owner).length),[3,3,3,5]);
  assert.ok(s.pieces.every(p=>p.place==='track'));
  assert.equal(s.mission,3);
  assert.equal(s.prototype,true);
  assert.equal(mission3CardTotal(s),110);
  assert.deepEqual(s.hands.map(h=>h.length),[6,6,6,6]);
  assert.ok(mission3Validate(s));
 }
});
test('110 cards are 13 groups of eight plus six jokers',()=>{
 const s=createMission3(43);
 const all=[...s.draw,...s.discard,...s.hands.flat()];
 const counts=Object.fromEntries(MISSION3_TYPES.map(t=>[t,all.filter(c=>c.type===t).length]));
 assert.equal(all.length,110);
 assert.equal(new Set(all.map(c=>c.id)).size,110);
 for(const [type,count] of Object.entries(counts))
  assert.equal(count,type==='joker'?6:8,type);
});
test('after next deal Grinch receives 6, 12, 18; humans always six',()=>{
 let s=createMission3(48);
 assert.deepEqual(s.hands.map(h=>h.length),[6,6,6,6]);
 s=mission3SetPreviewStage(s,1);
 assert.deepEqual(s.hands.map(h=>h.length),[6,6,6,6],'stage does not alter an active deal');
 s=mission3NextPreviewDeal(s);
 assert.deepEqual(s.hands.map(h=>h.length),[6,6,6,12]);
 assert.equal(s.stageAtDeal,1);
 assert.equal(mission3CardTotal(s),110);
 s=mission3SetPreviewStage(s,2);
 assert.deepEqual(s.hands.map(h=>h.length),[6,6,6,12]);
 s=mission3NextPreviewDeal(s);
 assert.deepEqual(s.hands.map(h=>h.length),[6,6,6,18]);
 assert.equal(s.stageAtDeal,2);
 assert.equal(mission3CardTotal(s),110);
});
test('each human may play only their own pieces and cannot control green figures',()=>{
 const s=cleanBoard(createMission3(53));
 s.hands[0][0].type='joker';
 for(const m of mission3LegalMoves(s,0)){
  if(m.pieceId)assert.equal(p(s,m.pieceId).owner,0);
  if(m.kind==='swap')assert.notEqual(p(s,m.targetId).owner,3);
 }
 assert.equal(mission3LegalMoves(s,1).length,0,'only the active seat can act');
});
test('a Grinch landing on an unprotected human sends the victim to a free personal start',()=>{
 const s=cleanBoard(createMission3(73));s.current=3;s.grinchActionsLeft=1;
 s.hands[3][0].type='4';p(s,'g0').pos=9;p(s,'r0').pos=13;
 const next=apply(s,m=>m.kind==='move'&&m.pieceId==='g0'&&m.distance===4);
 assert.equal(p(next,'r0').place,'track');
 assert.equal(p(next,'r0').pos,0,'free red gate is reused');
 assert.equal(p(next,'g0').pos,13);
 assert.equal(mission3CardTotal(next),110);
});
test('if the personal start is already occupied, the struck pawn goes home',()=>{
 const s=cleanBoard(createMission3(74));s.current=3;s.grinchActionsLeft=1;
 s.hands[3][0].type='4';p(s,'g0').pos=9;p(s,'r0').pos=13;p(s,'r1').pos=0;
 const next=apply(s,m=>m.kind==='move'&&m.pieceId==='g0'&&m.distance===4);
 assert.equal(p(next,'r0').place,'home');
 assert.equal(p(next,'r0').pos,-1);
 assert.equal(p(next,'r1').place,'track');
 assert.equal(p(next,'r1').pos,0);
});
test('the protected human start cannot be hit by the Grinch',()=>{
 const s=cleanBoard(createMission3(75));s.current=3;s.grinchActionsLeft=1;
 s.hands[3][0].type='4';p(s,'g0').pos=60;p(s,'r0').pos=0;
 assert.equal(mission3LegalMoves(s).some(m=>m.kind==='move'&&m.pieceId==='g0'&&m.distance===4),false);
});
test('human players can hit each other, but cannot hit the invincible green Grinch',()=>{
 const s=cleanBoard(createMission3(76));s.hands[0][0].type='5';
 p(s,'r0').pos=5;p(s,'b0').pos=10;
 const after=apply(s,m=>m.kind==='move'&&m.pieceId==='r0'&&m.distance===5);
 assert.equal(p(after,'b0').place,'home');
 const v=cleanBoard(createMission3(77));v.hands[0][0].type='5';
 p(v,'r0').pos=5;p(v,'g0').pos=10;
 assert.equal(mission3LegalMoves(v).some(m=>m.kind==='move'&&m.pieceId==='r0'&&m.distance===5),false);
});
test('Grinch moves one, two or three DISTINCT pieces in its turn depending on stage',()=>{
 for(let stage=0;stage<3;stage++){
  let s=createMission3(440+stage);
  if(stage){s=mission3SetPreviewStage(s,stage);s=mission3NextPreviewDeal(s);}
  s.current=3;s.grinchActionsLeft=stage+1;s.grinchUsed=[];
  // Guarantee legal movement via numeric cards.
  s.hands[3].forEach((card,i)=>{card.type=String(i%7+2);});
  let n=0;const used=[];
  while(s.current===3&&n<10){
   const moves=mission3LegalMoves(s);
   assert.ok(moves.length,'grinch has a playable hand at action '+n);
   const m=moves.find(x=>x.kind==='move')||moves[0];
   if(m.pieceId)used.push(m.pieceId);
   s=mission3Play(s,3,m);n++;
  }
  assert.equal(n,stage+1);
  assert.equal(new Set(used).size,used.length,'the Grinch does not reuse the same figure within the turn');
  assert.equal(s.current,0);
  assert.equal(mission3CardTotal(s),110);
 }
});
test('the server projection hides other hands, green hand, draw order and RNG seed',()=>{
 const s=createMission3(61);
 const data=mission3Projection(s,1);
 assert.equal(data.hands[0].length,0);
 assert.equal(data.hands[1].length,6);
 assert.equal(data.hands[2].length,0);
 assert.equal(data.hands[3].length,0);
 assert.deepEqual(data.handCounts,[6,6,6,6]);
 assert.equal(data.draw.length,0);
 assert.equal(data.seed,null);
 assert.equal(data.drawCount,86);
});
test('a long seeded simulation preserves all 110 cards and 14 pawns at all three stages',()=>{
 for(let stage=0;stage<3;stage++){
  for(const seed of [10,11,12]){
   let s=createMission3(seed*929+stage);
   if(stage){s=mission3SetPreviewStage(s,stage);s=mission3NextPreviewDeal(s);}
   for(let turn=0;turn<130;turn++){
    const moves=mission3LegalMoves(s);assert.ok(moves.length);
    const m=moves[(turn*19+seed)%moves.length];
    s=mission3Play(s,s.current,m);
    assert.equal(mission3CardTotal(s),110);
    assert.equal(s.pieces.length,14);
    assert.ok(mission3Validate(s));
   }
  }
 }
});
test('autoplay chooses only legal Grinch cards and returns control to a human',()=>{
 const s=createMission3(335);s.current=3;s.grinchActionsLeft=1;
 const after=mission3AutoGrinch(s);
 assert.equal(after.current,0);
 assert.ok(mission3Validate(after));
});
