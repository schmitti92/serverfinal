import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createMission3,mission3LegalMoves,mission3Play,mission3SetPreviewStage,
 mission3NextPreviewDeal,mission3GuaranteeStageCapture,
 mission3Validate,mission3CardTotal,mission3Projection
} from '../dog/grinch-mission3.js';
const pawn=(s,id)=>s.pieces.find(p=>p.id===id);
function spacedBoard(seed){
 const s=createMission3(seed);
 s.pieces.forEach((p,i)=>{p.place='track';p.pos=i*4;p.frozenTurns=0;p.captured=false;});
 s.current=0;s.grinchActionsLeft=0;s.grinchUsed=[];s.seven=null;
 assert.ok(mission3Validate(s));
 return s;
}
const move=(s,pred)=>{
 const m=mission3LegalMoves(s).find(pred);
 assert.ok(m,'expected valid action');
 return mission3Play(s,s.current,m);
};
test('a phase curse triggers AFTER the final card phase and never on initial deal',()=>{
 const s=createMission3(1435);
 assert.equal(s.lastCurse,null);
 const next=mission3NextPreviewDeal(s);
 assert.equal(next.phase,2);
 assert.equal(next.lastCurse.phase,1);
 assert.ok(['freeze','knockback','none'].includes(next.lastCurse.type));
 assert.equal(mission3CardTotal(next),110);
 assert.ok(mission3Validate(next));
});
test('phase curse is reproducible per seed but varies between knockback and freeze',()=>{
 let frozen=0,back=0;
 for(let seed=1;seed<=100;seed++){
  const a=mission3NextPreviewDeal(createMission3(seed));
  const b=mission3NextPreviewDeal(createMission3(seed));
  assert.deepEqual(a.lastCurse,b.lastCurse);
  if(a.lastCurse.type==='freeze')frozen++;
  if(a.lastCurse.type==='knockback')back++;
  assert.ok(mission3Validate(a));
 }
 assert.ok(frozen>=30&&back>=30,'both random effects need meaningful coverage');
});
test('ice prevents moving a specific piece for exactly TWO of its owner card turns',()=>{
 let s=spacedBoard(666);
 pawn(s,'r0').frozenTurns=2;
 s.hands[0].forEach(c=>{c.type='5';});
 assert.equal(mission3LegalMoves(s).some(m=>m.pieceId==='r0'),false);
 s=move(s,m=>m.kind==='move'&&m.pieceId==='r1'&&m.distance===5);
 assert.equal(pawn(s,'r0').frozenTurns,1);
 s.current=0;
 assert.equal(mission3LegalMoves(s).some(m=>m.pieceId==='r0'),false);
 s=move(s,m=>m.kind==='move'&&m.pieceId==='r1'&&m.distance===5);
 assert.equal(pawn(s,'r0').frozenTurns,0);
 s.current=0;
 assert.ok(mission3LegalMoves(s).some(m=>m.pieceId==='r0'),
  'previously frozen pawn is playable on the third own card turn');
});
test('a fully frozen human gets ONE card passed, not their whole hand discarded',()=>{
 let s=spacedBoard(421);
 for(const p of s.pieces.filter(p=>p.owner===0))p.frozenTurns=2;
 s.current=3;s.grinchActionsLeft=1;s.grinchUsed=[];
 s.hands[3].forEach(c=>{c.type='3';});
 s=move(s,m=>m.kind==='move'&&m.pieceId==='g0'&&m.distance===3);
 assert.equal(s.hands[0].length,5);
 assert.ok(s.pieces.filter(p=>p.owner===0).every(p=>p.frozenTurns===1));
 assert.equal(mission3CardTotal(s),110);
});
test('frozen humans are not unfrozen just because empty hands are skipped',()=>{
 let s=spacedBoard(929);
 // Empty hand must preserve all card IDs in the shared discard.
 s.discard.push(...s.hands[0].splice(0));
 pawn(s,'r0').frozenTurns=2;
 s.current=3;s.grinchActionsLeft=1;s.grinchUsed=[];
 s.hands[3].forEach(c=>{c.type='3';});
 s=move(s,m=>m.kind==='move'&&m.pieceId==='g0'&&m.distance===3);
 assert.equal(pawn(s,'r0').frozenTurns,2);
});
test('enemy human on the victim start gets displaced: only OWN start blockers send victim home',()=>{
 let s=spacedBoard(7402);s.current=3;s.grinchActionsLeft=1;
 pawn(s,'r0').pos=13;pawn(s,'b0').pos=0;pawn(s,'g0').pos=9;
 s.hands[3][0].type='4';
 const after=move(s,m=>m.kind==='move'&&m.pieceId==='g0'&&m.distance===4);
 assert.equal(pawn(after,'r0').place,'track');
 assert.equal(pawn(after,'r0').pos,0);
 assert.equal(pawn(after,'b0').place,'home');
 assert.equal(pawn(after,'g0').pos,13);
 assert.ok(mission3Validate(after));
});
test('every task has exactly one unique human prisoner and captures cannot repeat',()=>{
 let s=createMission3(438);
 for(let stage=0;stage<3;stage++){
  s=mission3SetPreviewStage(s,stage);
  s=mission3GuaranteeStageCapture(s,stage);
  s=mission3GuaranteeStageCapture(s,stage);
  assert.equal(s.pieces.filter(p=>p.place==='captured').length,stage+1);
  assert.ok(mission3Validate(s));
 }
 assert.deepEqual(s.capturedPerHuman,[1,1,1]);
 assert.equal(s.pieces.filter(p=>p.place==='captured').length,3);
 assert.deepEqual([0,1,2].map(owner=>s.pieces.filter(p=>p.owner===owner&&p.place!=='captured').length),[2,2,2]);
 assert.equal(s.pieces.filter(p=>p.owner===3&&p.place==='track').length,5);
 assert.ok(s.pieces.filter(p=>p.place==='captured').every(p=>p.frozenTurns===0&&p.captured));
 assert.equal(mission3CardTotal(s),110);
});
test('unearned/future task stage abduction is rejected',()=>{
 const s=createMission3(674);
 assert.throws(()=>mission3GuaranteeStageCapture(s,2),/aktuell abgeschlossenen/);
 assert.throws(()=>mission3GuaranteeStageCapture(s,-1),/aktuell abgeschlossenen/);
});
test('the current stage cannot randomly capture a second human victim',()=>{
 for(let seed=70;seed<90;seed++){
  let s=createMission3(seed);
  for(let round=0;round<8;round++){
   s=mission3NextPreviewDeal(s);
   assert.ok(s.capturedPerHuman.reduce((a,b)=>a+b,0)<=1);
   assert.ok(mission3Validate(s));
  }
 }
});
test('hidden capture order and other players’ card hands are not exposed',()=>{
 const s=createMission3(654);
 const view=mission3Projection(s,1);
 assert.equal(view.captureOrder,null);
 assert.equal(view.seed,null);
 assert.equal(view.hands[0].length,0);
 assert.equal(view.hands[2].length,0);
 assert.equal(view.hands[3].length,0);
 assert.equal(view.hands[1].length,6);
});
