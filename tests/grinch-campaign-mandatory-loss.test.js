import test from 'node:test';
import assert from 'node:assert/strict';
import {GRINCH_LOSS_MISSIONS,LOSS_TRIGGER_WINDOW,randomLossThresholds,shouldCaptureAfterLanding,validCampaignSurvivors} from '../dog/grinch-loss-policy.js';
import {newGame as mission1New,legalMoves as mission1Moves,play as mission1Play,publicMissionState as m1Public} from '../dog/grinch-mission1.js';
import {newGame as mission2New,legalMoves as mission2Moves,play as mission2Play,publicMissionState as m2Public} from '../dog/grinch-mission2.js';

test('all three missions share exact 5→4→3→2 survivor contract',()=>{
 assert.deepEqual(Object.keys(GRINCH_LOSS_MISSIONS),['1','2','3']);
 for(let mission=1;mission<=3;mission++){
  const rule=GRINCH_LOSS_MISSIONS[mission];
  assert.equal(rule.lossesThisMission,1);
  assert.equal(rule.starting-1,rule.rescueTarget);
  assert.equal(rule.lostBefore,mission-1);
 }
});

test('per-match secret trigger thresholds are random across matches and different for all 3 colors',()=>{
 const cases=new Set();
 for(let seed=1;seed<=100;seed++){
  for(const mission of [1,2,3]){
   const at=randomLossThresholds(seed,mission);
   assert.equal(at.length,3);
   assert.equal(new Set(at).size,3,'different timing per player');
   assert.ok(at.every(value=>LOSS_TRIGGER_WINDOW.includes(value)));
   assert.deepEqual(randomLossThresholds(seed,mission),at,'deterministic server replay');
   cases.add(at.join(','));
  }
 }
 assert.ok(cases.size>20,'not one rigid or repeating trap schedule');
});

test('a hidden trap does not fire early, fires on its secret eligible landing and cannot fire twice',()=>{
 for(const mission of [1,2,3]){
  const info={lossTriggerAt:5,lossEligibleLandings:0};
  for(let i=0;i<4;i++)assert.equal(
   shouldCaptureAfterLanding(info,{seed:12,mission,seat:0,rescued:0}),false);
  assert.equal(info.lossEligibleLandings,4);
  assert.equal(shouldCaptureAfterLanding(info,{seed:12,mission,seat:0,rescued:0,eligible:false}),false);
  assert.equal(info.lossEligibleLandings,4);
  assert.equal(shouldCaptureAfterLanding(info,{seed:12,mission,seat:0,rescued:0}),true);
  // The engine's per-seat "already lost" guard prevents further calls.
 }
});

test('once only: all three colors can each lose one figure on different scheduled safe moves',()=>{
 for(const [mission,newGame,movesFn,playFn] of [[1,mission1New,mission1Moves,mission1Play],[2,mission2New,mission2Moves,mission2Play]]){
  const game=newGame(73411);
  const afterBySeat=[];
  for(let seat=0;seat<3;seat++){
   const state=structuredClone(game);
   state.current=seat;state.seven=null;
   const info=state.players[seat];
   info.lossEligibleLandings=info.lossTriggerAt-1;
   const pawn=state.pieces.find(p=>p.id==='p'+(seat*5+(mission===1?4:3)));
   pawn.steps=0;pawn.place='track';
   if(mission===2){
    Object.assign(state.m2,{cardCurse:null,frozen:{},hazards:[],skipSeat:null,forcedCard:null,forcedPiece:null,
     lockedCard:null,portalUntil:-1,noSwapUntil:-1,afterMovePush:0,frostLands:0});
   }
   const card=state.hands[seat][0];card.type='5';
   const move=movesFn(state,seat,card).find(m=>m.kind==='move'&&m.pieceId===pawn.id&&m.distance===5);
   assert.ok(move,'a safe landing for mission '+mission+' player '+seat);
   const next=playFn(state,seat,move);
   assert.equal(next.pieces.filter(p=>p.seat===seat&&p.place==='lost').length,mission);
   assert.equal(next.players[seat][mission===1?'lost':'m2Lost'],true);
   assert.equal(next.pieces.find(p=>p.id===pawn.id).place,'lost');
   assert.equal(next.players[seat].lossEligibleLandings,info.lossTriggerAt);
   afterBySeat.push(next);
  }
  assert.equal(afterBySeat.length,3);
 }
});

test('last rescue is blocked until the mission-specific mandatory capture happened',()=>{
 for(const [mission,make,movesFn] of [[1,mission1New,mission1Moves],[2,mission2New,mission2Moves]]){
  const g=make(977);
  g.current=0;g.seven=null;
  if(mission===2)Object.assign(g.m2,{cardCurse:null,frozen:{},hazards:[],
   lockedCard:null,forcedCard:null,forcedPiece:null,portalUntil:-1,noSwapUntil:-1});
  const byId=n=>g.pieces.find(p=>p.id==='p'+n);
  const rescued=mission===1?3:2;
  for(let i=0;i<rescued;i++){byId(i).place='teleported';byId(i).steps=64;}
  const targetId=mission===1?3:2;
  byId(targetId).place='track';byId(targetId).steps=63;
  const victimId=mission===1?4:3;
  byId(victimId).place='home';byId(victimId).steps=-1;
  const card=g.hands[0][0];card.type='1/11';
  assert.equal(movesFn(g,0,card).some(m=>m.pieceId==='p'+targetId&&m.targetSteps===64),false);
  byId(victimId).place='lost';
  g.players[0][mission===1?'lost':'m2Lost']=true;
  assert.equal(movesFn(g,0,card).some(m=>m.pieceId==='p'+targetId&&m.targetSteps===64),true);
 }
});

test('public online views hide secret thresholds and future trap locations',()=>{
 const one=mission1New(1182),two=mission2New(1182);
 for(const state of [m1Public(one,0),m2Public(two,0)]){
  for(const info of state.players){
   assert.equal(info.lossTriggerAt,undefined);
   assert.equal(info.lossEligibleLandings,undefined);
   assert.equal(info.lossType,undefined);
  }
 }
});

test('Mission 3 future win contract requires one new loss and two survivors per player',()=>{
 const pieces=Array.from({length:15},(_,i)=>({
  id:'p'+i,seat:Math.floor(i/5),
  place:i%5<=2?'lost':'teleported'
 }));
 for(let seat=0;seat<3;seat++){
  assert.equal(validCampaignSurvivors(pieces,seat,3),true);
  const altered=structuredClone(pieces);
  altered.find(p=>p.id==='p'+(seat*5+2)).place='teleported';
  assert.equal(validCampaignSurvivors(altered,seat,3),false,'cannot rescue an extra figure');
 }
});
