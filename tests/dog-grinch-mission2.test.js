import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame as createGame,acknowledgeMission2Slot,legalMoves,play,publicMissionState,TRACK} from '../dog/grinch-mission2.js';
const newGame=(...args)=>{const s=createGame(...args);return acknowledgeMission2Slot(s,s.current,s.round);};
import {EFFECT_IDS,EFFECT_NAMES,NEVER_WINNABLE,BONUS_PROBABILITY} from '../dog/grinch-mission2-effects.js';

const fields=s=>s.pieces.filter(p=>p.place==='track').map(p=>((([0,16,48][p.seat]+p.steps)%64)+64)%64);
const cardCount=s=>s.draw.length+s.discard.length+s.hands.reduce((n,h)=>n+h.length,0);

test('Mission 2 uses original 110 cards but 4 active pieces per player',()=>{
 const s=newGame(8008,['A','B','C']);
 assert.equal(s.mission,2);
 assert.equal(s.version,6);
 assert.equal(s.players.length,3);
 assert.equal(s.pieces.length,15);
 assert.equal(s.pieces.filter(p=>p.place==='lost').length,3);
 assert.equal(s.pieces.filter(p=>p.place==='track').length,3);
 assert.deepEqual(s.pieces.filter(p=>p.place==='track').map(p=>p.id),['p3','p8','p13']);
 assert.equal(cardCount(s),110);
 assert.equal(s.m2.spins.length>=1,true);
});
test('Forty real slot effects and exactly three NEVER-winning fake ticket fields',()=>{
 assert.equal(EFFECT_IDS.length,40);
 assert.equal(EFFECT_NAMES.length,40);
 assert.deepEqual(NEVER_WINNABLE,[10,50,100]);
 assert.equal(BONUS_PROBABILITY,.10);
 assert.equal(new Set(EFFECT_IDS).size,40);
 const s=newGame(123);
 for(const spin of s.m2.spins){
  assert.ok(spin.effects.length===1||spin.effects.length===2);
  spin.effects.forEach(e=>assert.ok(EFFECT_IDS.includes(e.id)));
  assert.equal(spin.double,spin.effects.length===2);
  if(spin.double)assert.notEqual(Math.floor((spin.effects[0].id-1)/10),Math.floor((spin.effects[1].id-1)/10));
 }
});
test('Mission 2 does not expose opponents hands or seed',()=>{
 const s=newGame(212);
 const exposed=publicMissionState(s,0);
 assert.ok(exposed.hands[0].length>0);
 assert.equal(exposed.hands[1].length,0);
 assert.equal(exposed.hands[2].length,0);
 assert.equal(exposed.draw.length,0);
 assert.equal(exposed.seed,null);
 assert.equal(exposed.m2?.counter,undefined);
});
test('Slot effects preserve 110 cards, board positions, piece count and revision',()=>{
 for(let seed=1;seed<=8;seed++){
  let s=newGame(seed*4343);
  for(let n=0;n<180&&!s.complete;n++){
   const options=s.hands[s.current].flatMap(c=>legalMoves(s,s.current,c));
   assert.ok(options.length>0,'Seed '+seed+' turn '+n+' needs a legal move');
   const action=options[Math.floor(n*17%options.length)];
   const moved=play(s,s.current,action);
   const next=moved.m2.pendingSlotRound?acknowledgeMission2Slot(moved,moved.current,moved.round):moved;
   assert.equal(next.revision,s.revision+1);
   assert.equal(next.pieces.length,15);
   assert.equal(cardCount(next),110,'Cannot invent or destroy DOG cards');
   const positions=fields(next);
   assert.equal(new Set(positions).size,positions.length,'No overlapping figures');
   for(let seat=0;seat<3;seat++){
    const own=next.pieces.filter(p=>p.seat===seat);
    assert.equal(own.length,5);
    assert.ok(own.filter(p=>p.place==='lost').length>=1);
    assert.ok(own.filter(p=>p.place==='lost').length<=2);
    assert.ok(own.filter(p=>p.place==='teleported').length<=3);
   }
   s=next;
  }
 }
});


test('Mission 2 removes exactly one ADDITIONAL figure with a hidden trap, like Mission 1',()=>{
 const s=newGame(94161,['Rot','Blau','Gelb']);
 const seat=0;
 const starting=s.pieces.filter(p=>p.seat===seat);
 assert.equal(starting.filter(p=>p.place==='lost').length,1,'one previously lost in Mission 1');
 assert.equal(starting.filter(p=>p.place==='track'||p.place==='home').length,4);
 assert.equal(s.players[seat].m2Lost,false);
 assert.equal(s.players[seat].m2LostPieceId,undefined,'trap victim remains secret');
 // Arrange a fully legal, non-protected landing for the next ordinary card.
 s.current=seat;s.players[seat].moves=1;s.seven=null;
 s.players[seat].lossEligibleLandings=s.players[seat].lossTriggerAt-1;
 const firstActive=s.pieces.find(p=>p.id==='p3');firstActive.place='track';firstActive.steps=0;
 Object.assign(s.m2,{cardCurse:null,frozen:{},hazards:[],forcedCard:null,forcedPiece:null,
  lockedCard:null,portalUntil:-1,noSwapUntil:-1,afterMovePush:0,frostLands:0});
 const card=s.hands[seat][0];card.type='5';
 const legal=legalMoves(s,seat,card);
 const step=legal.find(m=>m.kind==='move'&&m.pieceId==='p3'&&m.distance===5);
 assert.ok(step,'a normal five-step move from the protected start is available');
 const after=play(s,seat,step);
 assert.equal(after.players[seat].m2Lost,true);
 assert.equal(after.players[seat].m2LostPieceId,'p3');
 assert.equal(after.pieces.find(p=>p.id==='p3').place,'lost');
 assert.equal(after.pieces.filter(p=>p.seat===seat&&p.place==='lost').length,2);
 assert.equal(after.pieces.filter(p=>p.seat===seat&&['home','track','teleported'].includes(p.place)).length,3);
 assert.match(after.lastEvent?.message||after.history.join(' '),/verliert die vierte verbleibende Figur/);
 assert.equal(s.players[seat].m2Lost,false,'immutable authoritative transition');
});
test('Mission 2 blocks the third portal rescue until the fourth figure has vanished',()=>{
 const s=newGame(2007,['Rot','Blau','Gelb']);
 s.current=0;s.seven=null;
 Object.assign(s.m2,{cardCurse:null,frozen:{},hazards:[],forcedCard:null,forcedPiece:null,
  lockedCard:null,portalUntil:-1,noSwapUntil:-1,afterMovePush:0,frostLands:0});
 const p=id=>s.pieces.find(x=>x.id===id);
 for(const id of ['p0','p1']){p(id).place='teleported';p(id).steps=64;}
 p('p2').place='track';p('p2').steps=63;
 p('p3').place='track';p('p3').steps=6;
 const c=s.hands[0][0];c.type='1/11';
 const moves=legalMoves(s,0,c);
 assert.equal(moves.some(m=>m.pieceId==='p2'&&m.targetSteps===64),false,
  'the last rescue is barred while four pieces still belong to the mission');
 p('p3').place='lost';p('p3').steps=-1;s.players[0].m2Lost=true;s.players[0].m2LostPieceId='p3';
 const allowed=legalMoves(s,0,c);
 assert.equal(allowed.some(m=>m.pieceId==='p2'&&m.targetSteps===64),true,
  'the last survivor can reach Mission 3 after exactly two permanent losses');
 const third=allowed.find(m=>m.pieceId==='p2'&&m.targetSteps===64);
 const finishedSeat=play(s,0,third);
 assert.equal(finishedSeat.pieces.filter(x=>x.seat===0&&x.place==='teleported').length,3);
 assert.equal(finishedSeat.pieces.filter(x=>x.seat===0&&x.place==='lost').length,2);
});
