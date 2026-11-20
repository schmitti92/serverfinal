import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame as createGame,acknowledgeMission2Slot,legalMoves,play,publicMissionState} from '../dog/grinch-mission2.js';
const newGame=(...args)=>{const s=createGame(...args);return acknowledgeMission2Slot(s,s.current,s.round);};
import {slotForNewPhase,mission2TurnAdvance} from '../dog/grinch-mission2-effects.js';

const legalFor=(s,seat,card)=>{
 const previous=s.current;
 s.current=seat;
 try{return legalMoves(s,seat,card);}
 finally{s.current=previous;}
};
const cardCount=s=>s.draw.length+s.discard.length+s.hands.reduce((total,h)=>total+h.length,0);
const safe=s=>Object.assign(s.m2,{
 cardCurse:null,skipSeats:[],frozen:{},hazards:[],portalUntil:-1,noSwapUntil:-1,
 forcedCard:null,forcedPiece:null,lockedCard:null,afterMovePush:0,frostLands:0
});

test('slot has a recorded result, 110 cards and no effect-based exception at start',()=>{
 for(let seed=1;seed<=120;seed++){
  const s=newGame(seed*18593);
  assert.equal(cardCount(s),110);
  assert.ok(s.m2.spins.length>0);
  for(const spin of s.m2.spins){
   assert.ok([1,2].includes(spin.effects.length));
   assert.equal(spin.double,spin.effects.length===2);
   assert.ok(spin.effects.every(effect=>effect.id>=1&&effect.id<=40));
   if(spin.double){
    assert.notEqual(Math.floor((spin.effects[0].id-1)/10),Math.floor((spin.effects[1].id-1)/10));
   }
  }
 }
});

test('split seven cannot begin a frozen-pawn dead end',()=>{
 const s=newGame(6714);safe(s);s.current=0;s.seven=null;
 const main=s.pieces.find(p=>p.id==='p3');
 const other=s.pieces.find(p=>p.id==='p0');
 main.place='track';main.steps=63;
 other.place='track';other.steps=5;
 s.m2.frozen[other.id]=true;
 const card=s.hands[0][0];card.type='7';
 const options=legalMoves(s,0,card);
 assert.equal(options.some(o=>o.kind==='seven'&&o.pieceId===main.id&&o.distance===1),false);
});

test('hazards and longer bans survive a card-phase switch',()=>{
 const s=newGame(6132);safe(s);s.current=0;s.turn=10;s.round=2;
 const hazard={field:7,type:'slip',until:1009,used:false};
 s.m2.hazards.push(hazard);
 s.m2.portalUntil=26;s.m2.noSwapUntil=25;
 slotForNewPhase(s,(seat,card)=>legalFor(s,seat,card));
 assert.ok(s.m2.hazards.some(h=>h.field===7&&h.until===1009));
 assert.ok(s.m2.portalUntil>=26);
 assert.ok(s.m2.noSwapUntil>=25);
});

test("two skip effects queue without losing either player's skipped action",()=>{
 const s=newGame(1713);safe(s);
 s.m2.skipSeats=[0,2];
 const before=cardCount(s);
 assert.equal(mission2TurnAdvance(s,0),true);
 assert.equal(mission2TurnAdvance(s,1),false);
 assert.equal(mission2TurnAdvance(s,2),true);
 assert.deepEqual(s.m2.skipSeats,[]);
 assert.equal(cardCount(s),before);
});

test('secret opponent card IDs are removed from online projection',()=>{
 const s=newGame(153);safe(s);
 s.m2.lockedCard={seat:1,id:s.hands[1][0].id};
 s.m2.forcedCard={seat:2,id:s.hands[2][0].id};
 const a=publicMissionState(s,0);
 assert.deepEqual(a.m2.lockedCard,{seat:1,active:true});
 assert.deepEqual(a.m2.forcedCard,{seat:2,active:true});
 assert.equal(a.hands[1].length,0);
 const b=publicMissionState(s,1);
 assert.equal(b.m2.lockedCard.id,s.hands[1][0].id);
 assert.deepEqual(b.m2.forcedCard,{seat:2,active:true});
});

test('scripted mandatory capture stays in event log if a slot starts immediately afterward',()=>{
 const s=newGame(7721);safe(s);s.current=0;s.seven=null;
 const active=s.pieces.find(p=>p.id==='p3');active.place='track';active.steps=0;
 s.players[0].lossEligibleLandings=s.players[0].lossTriggerAt-1;
 const card=s.hands[0][0];card.type='5';
 for(let seat=0;seat<3;seat++){
  const discarded=seat===0?s.hands[0].slice(1):s.hands[seat];
  s.discard.push(...discarded);
  s.hands[seat]=seat===0?[card]:[];
 }
 const move=legalMoves(s,0,card).find(x=>x.kind==='move'&&x.pieceId==='p3'&&x.distance===5);
 assert.ok(move,'there is a legal normal move to trigger the concealed capture');
 const after=play(s,0,move);
 assert.equal(after.pieces.find(p=>p.id==='p3').place,'lost');
 assert.ok(after.m2.eventLog.some(x=>x.type==='loss'&&x.pieceId==='p3'));
 assert.ok(after.m2.eventLog.some(x=>x.type==='slot'&&x.round>1));
 const loss=after.m2.eventLog.find(x=>x.type==='loss'&&x.pieceId==='p3');
 const newSlot=after.m2.eventLog.find(x=>x.type==='slot'&&x.round>1);
 assert.ok(loss.eventId<newSlot.eventId);
 assert.equal(cardCount(after),110);
});

test('repeatable game simulation: every action preserves cards and split-seven progress',()=>{
 for(let seed=1;seed<=18;seed++){
  let s=newGame(seed*71933);
  for(let n=0;n<100&&!s.complete;n++){
   const options=s.hands[s.current].flatMap(c=>legalMoves(s,s.current,c));
   assert.ok(options.length>0,'game '+seed+' action '+n+' must be legal');
   const action=options[(n*19+seed)%options.length];
   s=play(s,s.current,action);
   if(s.m2.pendingSlotRound)s=acknowledgeMission2Slot(s,s.current,s.round);
   assert.equal(cardCount(s),110);
   if(s.seven)
    assert.ok(s.hands[s.current].some(c=>legalMoves(s,s.current,c).length>0),
      'a partially played seven cannot strand the remaining steps');
  }
 }
});

test('server slot barrier rejects moves until exactly one active-seat acknowledgement',()=>{
 const s=createGame(13557),seat=s.current;
 const possible=s.hands[seat].flatMap(c=>legalMoves(s,seat,c));
 assert.ok(possible.length>0);
 assert.equal(s.m2.pendingSlotRound,s.round);
 assert.throws(()=>play(s,seat,possible[0]),/GRINCH_SLOT_PENDING/);
 assert.throws(()=>acknowledgeMission2Slot(s,(seat+1)%3,s.round),/GRINCH_SLOT_NOT_YOUR_TURN/);
 assert.throws(()=>acknowledgeMission2Slot(s,seat,s.round+1),/GRINCH_SLOT_NOT_PENDING/);
 const ready=acknowledgeMission2Slot(s,seat,s.round);
 assert.equal(ready.revision,s.revision+1);
 assert.equal(ready.m2.pendingSlotRound,null);
 assert.throws(()=>acknowledgeMission2Slot(ready,seat,s.round),/GRINCH_SLOT_NOT_PENDING/);
 assert.equal(s.m2.pendingSlotRound,s.round,'original match state is immutable');
});
