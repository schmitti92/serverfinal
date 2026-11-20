import test from 'node:test';
import assert from 'node:assert/strict';
import {
 newGame,acknowledgeMission2Slot,legalMoves,play,publicMissionState,canAssistAllies
} from '../dog/grinch-mission2.js';

function ready(seed=81622){
 let s=newGame(seed);
 if(s.m2.pendingSlotRound)s=acknowledgeMission2Slot(s,s.current,s.round);
 s.current=0;
 Object.assign(s.m2,{cardCurse:null,skipSeats:[],frozen:{},hazards:[],
  forcedCard:null,forcedPiece:null,lockedCard:null,portalUntil:-1,noSwapUntil:-1});
 return s;
}
const pawn=(s,id)=>s.pieces.find(p=>p.id===id);
const total=s=>s.draw.length+s.discard.length+s.hands.reduce((n,h)=>n+h.length,0);
function ownRescued(s){
 for(const p of s.pieces.filter(p=>p.seat===0)){
  const n=Number(p.id.slice(1))%5;
  p.place=n<3?'teleported':'lost';p.steps=n<3?64:-1;
 }
 s.players[0].m2Lost=true;
}
test('canonical 110 cards and initial six-card hands survive Mission-2-only rules',()=>{
 const s=ready();
 assert.equal(total(s),110);
 assert.deepEqual(s.hands.map(h=>h.length),[6,6,6]);
 assert.equal(canAssistAllies(s,0),false);
});
test('protected own start square blocks a second launch, not forcibly displaces its pawn',()=>{
 const s=ready(),card=s.hands[0][0];card.type='13';
 const protectedPawn=pawn(s,'p3');
 assert.equal(protectedPawn.place,'track');
 assert.equal(protectedPawn.steps,0);
 assert.equal(legalMoves(s,0,card).filter(m=>m.kind==='start').length,0);
 assert.equal(pawn(s,'p0').place,'home');
 assert.equal(total(s),110);
});
test('unprotected foreign visitor on a color start can be struck by a start card',()=>{
 const s=ready(),card=s.hands[0][0];card.type='1/11';
 pawn(s,'p3').steps=5; // vacate the protected red gate
 const blue=pawn(s,'p8');blue.steps=48; // blue starts at 16: 16+48 -> red gate 0
 const start=legalMoves(s,0,card).find(m=>m.kind==='start'&&m.pieceId==='p0');
 assert.ok(start,'red is allowed to start on red gate occupied by visiting blue');
 const next=play(s,0,start);
 assert.equal(pawn(next,'p0').place,'track');
 assert.equal(pawn(next,'p0').steps,0);
 assert.equal(pawn(next,'p8').place,'home');
 assert.equal(next.hands[0].length,s.hands[0].length-1);
 assert.equal(total(next),110);
});
test('after 4 backwards, advancing 5 offers EXACT circular and first-portal alternatives',()=>{
 const s=ready();pawn(s,'p3').steps=-4;
 const card=s.hands[0][0];card.type='5';
 const variants=legalMoves(s,0,card).filter(m=>m.kind==='move'&&m.pieceId==='p3'&&m.distance===5);
 assert.equal(variants.length,2);
 assert.deepEqual(variants.map(x=>x.viaPortal).sort(),[false,true]);
 assert.ok(variants.every(x=>x.targetSteps===1));
 const circular=play(s,0,variants.find(x=>!x.viaPortal));
 assert.equal(pawn(circular,'p3').place,'track');
 assert.equal(pawn(circular,'p3').steps,1);
 const portal=play(s,0,variants.find(x=>x.viaPortal));
 assert.equal(pawn(portal,'p3').place,'teleported');
 assert.equal(portal.pieces.filter(p=>p.seat===0&&p.place==='teleported').length,1);
 assert.equal(total(portal),110);
});
test('a portal entered backwards is still blocked by the mandatory one-loss rule',()=>{
 const s=ready();
 // Two red pawns escaped, the remaining candidate cannot become the third
 // until the fourth surviving figure has been captured for this mission.
 pawn(s,'p0').place='teleported';pawn(s,'p0').steps=64;
 pawn(s,'p1').place='teleported';pawn(s,'p1').steps=64;
 pawn(s,'p3').steps=-4;
 pawn(s,'p2').place='home';
 const card=s.hands[0][0];card.type='5';
 assert.equal(s.players[0].m2Lost,false);
 let moves=legalMoves(s,0,card).filter(m=>m.pieceId==='p3');
 assert.equal(moves.some(m=>m.viaPortal),false);
 pawn(s,'p2').place='lost';pawn(s,'p2').steps=-1;
 s.players[0].m2Lost=true;
 moves=legalMoves(s,0,card).filter(m=>m.pieceId==='p3');
 assert.equal(moves.some(m=>m.viaPortal),true);
});
test('once red has rescued all three, red cards may move blue and yellow pawns',()=>{
 const s=ready();ownRescued(s);
 const card=s.hands[0][0];card.type='2';
 pawn(s,'p8').steps=5;pawn(s,'p13').steps=6;
 assert.equal(canAssistAllies(s,0),true);
 const moves=legalMoves(s,0,card);
 assert.ok(moves.some(m=>m.pieceId==='p8'&&m.distance===2));
 assert.ok(moves.some(m=>m.pieceId==='p13'&&m.distance===2));
 assert.ok(!moves.some(m=>m.pieceId==='p3'));
 const blueBefore=s.hands[1].map(c=>c.id);
 const m=moves.find(m=>m.pieceId==='p8'&&m.distance===2);
 const after=play(s,0,m);
 assert.equal(pawn(after,'p8').steps,7);
 assert.deepEqual(after.hands[1].map(c=>c.id),blueBefore);
 assert.equal(after.hands[0].length,s.hands[0].length-1);
 assert.equal(total(after),110);
});
test('helping a teammate may trigger only THAT pawn owner’s guaranteed hidden loss',()=>{
 const s=ready();ownRescued(s);
 const card=s.hands[0][0];card.type='2';
 pawn(s,'p8').steps=5;
 s.players[1].lossEligibleLandings=s.players[1].lossTriggerAt-1;
 const m=legalMoves(s,0,card).find(m=>m.pieceId==='p8'&&m.kind==='move'&&m.distance===2);
 assert.ok(m);
 const after=play(s,0,m);
 assert.equal(after.players[0].m2Lost,true);
 assert.equal(after.players[1].m2Lost,true,'blue figure lost on blue trap schedule');
 assert.equal(pawn(after,'p8').place,'lost');
 assert.equal(after.pieces.filter(p=>p.seat===1&&p.place==='lost').length,2);
});
test('after completing own rescue, a start card may launch an allied pawn at its own gate',()=>{
 const s=ready();ownRescued(s);
 // Vacate the blue protected start square to allow launching.
 pawn(s,'p8').steps=4;
 const card=s.hands[0][0];card.type='13';
 const m=legalMoves(s,0,card).find(x=>x.kind==='start'&&x.pieceId==='p5');
 assert.ok(m,'red can start a blue figure for blue');
 const after=play(s,0,m);
 assert.equal(pawn(after,'p5').place,'track');
 assert.equal(pawn(after,'p5').steps,0);
});
test('online projection shows own cards even outside your turn, but hides others',()=>{
 const s=ready();s.current=1;
 const red=publicMissionState(s,0);
 assert.equal(red.current,1);
 assert.equal(red.viewerSeat,0);
 assert.equal(red.hands[0].length,s.hands[0].length);
 assert.equal(red.hands[1].length,0);
 assert.equal(red.hands[2].length,0);
 assert.equal(red.drawCount,s.draw.length);
 assert.equal(red.discardCount,s.discard.length);
 assert.equal(red.draw.length,0,'never leak the draw pile order');
 assert.equal(red.seed,null);
});
test('Joker remains optional and cannot launch with a 12 while classic 1/11 or 13 can',()=>{
 const s=ready();pawn(s,'p3').steps=5;
 const card=s.hands[0][0];card.type='12';
 assert.equal(legalMoves(s,0,card).filter(m=>m.kind==='start').length,0);
 card.type='joker';
 const variants=legalMoves(s,0,card).filter(m=>m.kind==='start');
 assert.ok(variants.some(m=>m.as==='13'));
 assert.ok(variants.some(m=>m.as==='1/11'));
 assert.ok(!variants.some(m=>m.as==='12'));
});
