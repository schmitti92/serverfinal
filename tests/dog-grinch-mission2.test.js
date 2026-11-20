import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame,legalMoves,play,publicMissionState,TRACK} from '../dog/grinch-mission2.js';
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
   const next=play(s,s.current,action);
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
