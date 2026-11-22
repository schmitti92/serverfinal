import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createGame,legalActions} from '../dog/engine.js';
import {newDogMatchCounters} from '../dog/player-stats.js';
import {createDogChristmasMatch} from '../dog/christmas-village.js';
import {reduceDogSeasonalInPostgresRoom} from '../dog-postgres-seasonal-adapter.js';

const clone=structuredClone;
const id='34bb02a2-1d6a-458b-b51a-c047b78f72aa';
function seasonalRoom({humans=3,levels={},research={}}={}){
 const roster=Array.from({length:4},(_,seat)=>({
  seat,uid:seat<humans?['alice','bob','cara','dana'][seat]:
   humans===3?null:'dog-bot:'+seat,
  name:['Alice','Bob','Cara','Dana'][seat],
  bot:seat>=humans&&humans!==3,
  inactive:seat>=humans&&humans===3
 }));
 const active=roster.filter(p=>!p.inactive&&!p.bot);
 const game=createGame({
  names:roster.map(p=>p.name),
  bots:roster.map(p=>p.bot),
  inactiveSeats:roster.filter(p=>p.inactive).map(p=>p.seat),
  rng:()=>0.38
 });
 const village={levels:{
  tower:1,workshop:1,bakery:1,inn:1,luckhouse:1,academy:1,
  ...levels
 }};
 return {code:'123',game:'dog',phase:'playing',
  revision:1,hostUid:'alice',createdAt:1000,updatedAt:1000,
  expiresAt:86400000,
  players:active.map(p=>({uid:p.uid,name:p.name,participating:true})),
  match:{id,game:'dog',dogChristmasEligibilityChecked:true,
   members:active.map(p=>({uid:p.uid,seat:p.seat})),
   dogRoster:roster,dogCommands:[],dogCounters:newDogMatchCounters(),
   dogResearchSkills:research,christmas:createDogChristmasMatch(village,true,()=>0,game.round),
   dog:game}
 };
}
const command=(room,action,uid='alice',actionId='pg-seasonal-unique-0001')=>({
 uid,matchId:room.match.id,action,actionId
});
const opts={cardRng:()=>0.4,rewardDraw:n=>n===100?99:0};
function stepRoom({cardType='2',position=3,levels={},research={}}={}){
 const r=seasonalRoom({levels,research}),s=r.match.dog;
 s.phase='play';s.current=0;s.starter=0;s.revision=44;
 s.hands=[[{id:9000,type:cardType}],[{id:9001,type:'3'}],
  [{id:9002,type:'3'}],[]];
 s.exchanges=[null,null,null,true];s.seven=null;
 const pawn=s.pieces.find(p=>p.id===0);pawn.place='track';pawn.pos=position;
 r.match.christmas.giftFields=[];
 r.match.christmas.scratchFields=[];
 r.match.christmas.claimedFields=[];
 r.match.christmas.claimedScratchFields=[];
 return r;
}
function legalMove(r,pawn=0,steps=2){
 const moves=legalActions(r.match.dog,0);
 const result=moves.find(m=>m.type==='move'&&m.pieceId===pawn&&m.steps===steps&&!m.viaGoal);
 assert.ok(result,'the actual DOG rules must accept this test move');
 return result;
}

test('Three human DOG players exchange with zero Firestore rewards and no artificial fourth recipient',()=>{
 const r=seasonalRoom(),before=clone(r);
 const action=legalActions(r.match.dog,0)[0];
 const out=reduceDogSeasonalInPostgresRoom(r,command(r,action),opts);
 assert.equal(out.rewardBearing,false);
 assert.equal(out.finished,false);
 assert.equal(out.pendingRecord,null);
 assert.deepEqual(out.vouchers,[]);
 assert.equal(out.room.match.dog.revision,before.match.dog.revision+1);
 assert.equal(out.room.match.dog.mode,'solo3');
 assert.equal(out.room.match.dogRoster.filter(p=>p.inactive).length,1);
 assert.equal(out.room.match.dogRoster.filter(p=>p.bot).length,0);
 assert.equal(out.room.match.christmas.earnedTenths,0);
 assert.equal(out.room.match.dogCommands.length,1);
});

test('A real gift landing is BLOCKED from the ordinary SQL move path until Firebase settlement is prepared',()=>{
 const r=stepRoom();
 r.match.christmas.giftFields=[5];
 const action=legalMove(r);
 assert.throws(()=>reduceDogSeasonalInPostgresRoom(clone(r),
  command(r,action),opts),/DOG_PG_SEASONAL_REWARD_SETTLEMENT_REQUIRED/);
 assert.equal(r.match.christmas.giftCount,0,
  'caller only passes an isolated SQL transaction candidate, never touches the saved room');
});

test('Server-only gift calculation matches lights, workshop/bakery bonus and the research carry',()=>{
 const r=stepRoom({levels:{workshop:2,bakery:2},
  research:{alice:{lights_bonus:1}}});
 r.match.christmas.giftFields=[5];
 const before=clone(r);
 const move=legalMove(r);
 const out=reduceDogSeasonalInPostgresRoom(r,command(r,move),{
  ...opts,rewardDraw:n=>0,allowUnsettledRewards:true
 });
 assert.equal(out.rewardBearing,true);
 assert.equal(out.finished,false);
 assert.deepEqual(out.delta,{
  earnedTenths:23,giftCount:1,bonusGiftCount:1,scratchCount:0
 });
 assert.equal(out.room.match.dogLightCarry.alice,10);
 assert.deepEqual(out.vouchers,[]);
 assert.equal(out.pendingRecord.roomCode,'123');
 assert.equal(out.pendingRecord.matchId,id);
 assert.equal(out.pendingRecord.actionId,'pg-seasonal-unique-0001');
 assert.deepEqual(out.pendingRecord.before,before);
 assert.equal(out.pendingRecord.after.match.christmas.giftCount,1);
 assert.equal(out.pendingRecord.after.match.dog.revision,45);
 assert.ok(Array.isArray(out.pendingRecord.after.match.dog.deck),
  'only the private SQL pending record may contain the draw deck');
});

test('A scratch landing produces exactly one server-generated voucher for its real human recipient',()=>{
 const r=stepRoom();
 r.match.christmas.scratchFields=[5];
 const move=legalMove(r);
 const out=reduceDogSeasonalInPostgresRoom(r,command(r,move),{
  ...opts,allowUnsettledRewards:true
 });
 assert.deepEqual(out.delta,{earnedTenths:0,giftCount:0,
  bonusGiftCount:0,scratchCount:1});
 assert.deepEqual(out.vouchers,[{uid:'alice',tier:'simple'}]);
 assert.equal(out.room.match.christmas.claimedScratchFields.includes(5),true);
 assert.equal(out.pendingRecord.vouchers[0].uid,'alice');
 assert.equal(out.room.match.christmas.activity.at(-1).type,'scratch');
});

test('An ordinary non-reward move remains SQL-only even when a Christmas match is active',()=>{
 const r=stepRoom();
 r.match.christmas.giftFields=[40];
 r.match.christmas.scratchFields=[50];
 const before=clone(r.match.christmas);
 const out=reduceDogSeasonalInPostgresRoom(r,command(r,legalMove(r)),opts);
 assert.equal(out.rewardBearing,false);
 assert.equal(out.pendingRecord,null);
 assert.deepEqual(out.delta,{
  earnedTenths:0,giftCount:0,bonusGiftCount:0,scratchCount:0
 });
 assert.deepEqual(r.match.christmas,before);
});

test('Seven can be split 3+4 inside the verified PG seasonal reducer without an accidental payout',()=>{
 const r=stepRoom({cardType:'7',position:3});
 const begin=reduceDogSeasonalInPostgresRoom(r,command(r,{
  type:'seven',cardId:9000,as:'7'
 },'alice','seasonal-seven-start-01'),opts);
 assert.equal(begin.room.match.dog.phase,'seven');
 assert.equal(begin.pendingRecord,null);
 const first=reduceDogSeasonalInPostgresRoom(begin.room,command(begin.room,{
  type:'seven-step',pieceId:0,steps:3,viaGoal:false,to:'track:6'
 },'alice','seasonal-seven-first-02'),opts);
 assert.equal(first.room.match.dog.seven.spent,3);
 assert.equal(first.room.match.dog.pieces.find(p=>p.id===0).pos,6);
 assert.equal(first.pendingRecord,null);
 const last=reduceDogSeasonalInPostgresRoom(first.room,command(first.room,{
  type:'seven-step',pieceId:0,steps:4,viaGoal:false,to:'track:10'
 },'alice','seasonal-seven-last-03'),opts);
 assert.equal(last.room.match.dog.seven,null);
 assert.equal(last.room.match.dog.pieces.find(p=>p.id===0).pos,10);
 assert.equal(last.pendingRecord,null);
 assert.equal(last.room.match.dogCommands.length,3);
});

test('Final DOG move is NEVER exposed before a combined XP, lights and village receipt is ready',()=>{
 const r=seasonalRoom({levels:{inn:3}}),s=r.match.dog;
 s.phase='play';s.current=0;s.starter=0;s.revision=42;
 s.hands=[[{id:7777,type:'2'}],[],[],[]];
 s.exchanges=[null,null,null,true];
 for(const pawn of s.pieces.filter(p=>p.owner===0)){
  if(pawn.id===3){pawn.place='track';pawn.pos=63}
  else {pawn.place='goal';pawn.pos=pawn.id+1}
 }
 const move=legalActions(s,0).find(m=>m.type==='move'&&
  m.cardId===7777&&m.pieceId===3&&m.steps===2&&m.viaGoal===true);
 assert.ok(move);
 assert.throws(()=>reduceDogSeasonalInPostgresRoom(clone(r),
  command(r,move),opts),/DOG_PG_SEASONAL_REWARD_SETTLEMENT_REQUIRED/);
 const staged=reduceDogSeasonalInPostgresRoom(r,command(r,move),{
  ...opts,allowUnsettledRewards:true
 });
 assert.equal(staged.finished,true);
 assert.equal(staged.rewardBearing,true);
 assert.equal(staged.delta.earnedTenths,20,'inn level 3 pays 2 lights');
 assert.equal(staged.room.match.christmas.innCredited,true);
 assert.equal(staged.room.match.dogCounters.recorded,false,
  'XP cannot be marked paid before immutable Firestore receipt');
 assert.equal(staged.pendingRecord.before.match.dog.phase,'play');
 assert.equal(staged.pendingRecord.after.match.dog.phase,'finished');
});

test('Disabled event and unverified Christmas activation never enter the PG-only game path',()=>{
 for(const mutation of [
  r=>{r.match.dogChristmasEligibilityChecked=false},
  r=>{r.match.christmas.enabled=false},
  r=>{r.match.dog.phase='finished'}
 ]){
  const r=seasonalRoom();mutation(r);
  assert.throws(()=>reduceDogSeasonalInPostgresRoom(r,command(r,{
   type:'exchange',cardId:r.match.dog.hands[0][0].id
  }),opts),/DOG_PG_SEASONAL_NOT_ELIGIBLE/);
 }
 const r=seasonalRoom();
 assert.throws(()=>reduceDogSeasonalInPostgresRoom(r,command(r,{
  type:'exchange',cardId:r.match.dog.hands[0][0].id
 }),{...opts,eventActive:false}),/DOG_PG_SEASONAL_NOT_ELIGIBLE/);
});

test('A spectator or another user cannot submit a seasonal DOG action',()=>{
 const r=seasonalRoom(),action=legalActions(r.match.dog,0)[0];
 for(const uid of ['mallory','',null]){
  assert.throws(()=>reduceDogSeasonalInPostgresRoom(clone(r),
   command(r,action,uid),opts),/DOG_PG_SEASONAL_NOT_PARTICIPANT/);
 }
 const missing=clone(r);missing.match.members=[];
 assert.throws(()=>reduceDogSeasonalInPostgresRoom(missing,
  command(missing,action),opts),/DOG_PG_SEASONAL_NOT_PARTICIPANT/);
});

test('Retired research-peek and disabled card-swap cannot mint a turn or a reward',()=>{
 const r=seasonalRoom(),action=legalActions(r.match.dog,0)[0];
 assert.throws(()=>reduceDogSeasonalInPostgresRoom(clone(r),
  command(r,{type:'research-peek'}),opts),/RESEARCH_RETIRED/);
 assert.throws(()=>reduceDogSeasonalInPostgresRoom(clone(r),
  command(r,{type:'research-swap',cardId:action.cardId}),opts),
  /RESEARCH_SWAP_UNAVAILABLE/);
});

test('The same immutable server move/PRNG produces the same proposed SQL reward record',()=>{
 const r=stepRoom({levels:{workshop:2,bakery:2}});
 r.match.christmas.giftFields=[5];
 const action=legalMove(r);
 const a=reduceDogSeasonalInPostgresRoom(clone(r),command(r,action),{
  ...opts,rewardDraw:n=>0,allowUnsettledRewards:true
 });
 const b=reduceDogSeasonalInPostgresRoom(clone(r),command(r,action),{
  ...opts,rewardDraw:n=>0,allowUnsettledRewards:true
 });
 assert.deepEqual(a.delta,b.delta);
 assert.deepEqual(a.pendingRecord,b.pendingRecord);
});
