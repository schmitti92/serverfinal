import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createDogChristmasMatch,publicDogChristmasMatch,refreshDogChristmasDeal,
 claimDogChristmasHumanFields
} from '../dog/christmas-village.js';

const roster=[
 {seat:0,uid:'human-chris',bot:false,inactive:false},
 {seat:1,uid:'human-vanessa',bot:false,inactive:false},
 {seat:2,uid:'dog-bot:room:2',bot:true,inactive:false},
 {seat:3,uid:'human-david',bot:false,inactive:false}
];
function visit(match,field,seat=0,draw=()=>99){
 const id=seat*4;
 const before={players:roster,pieces:[{id,place:'track',pos:(field+63)%64,owner:seat}]};
 const after={players:roster,pieces:[{id,place:'track',pos:field,owner:seat}]};
 return claimDogChristmasHumanFields(match,before,after,{type:'move',pieceId:id},roster,seat,draw);
}
test('read-only event table contains every confirmed current-deal light and scratch finder',()=>{
 const m=createDogChristmasMatch(null,true,()=>0);
 const initial=publicDogChristmasMatch(m);
 assert.equal(initial.roundFinds.length,0);
 assert.equal(initial.goldFinds.length,0);
 assert.ok(!('giftFields' in initial)&&!('scratchFields' in initial)&&!('goldFields' in initial));
 for(const field of m.giftFields)visit(m,field,0,()=>99);
 for(const field of m.scratchFields)visit(m,field,1,()=>20);
 const view=publicDogChristmasMatch(m);
 assert.equal(view.roundGiftCollected,m.giftFields.length);
 assert.equal(view.roundScratchCollected,m.scratchFields.length);
 assert.equal(view.roundFinds.length,m.giftFields.length+m.scratchFields.length);
 assert.ok(view.roundFinds.length>12,'full round history survives bounded recent activity');
 assert.equal(view.activity.length,12,'existing popup/activity budget remains unchanged');
 assert.ok(view.roundFinds.every(f=>f.type==='gift'?f.seat===0:f.seat===1));
 assert.ok(view.roundFinds.every(f=>!('uid' in f)));
 assert.ok(!('giftFields' in view)&&!('scratchFields' in view));
 const prev=structuredClone(view.roundFinds);
 assert.equal(refreshDogChristmasDeal(m,2,()=>0),true);
 const renewed=publicDogChristmasMatch(m);
 assert.deepEqual(renewed.roundFinds,[],'new card deal resets ONLY per-deal discovery list');
 assert.equal(renewed.roundGiftCollected,0);
 assert.equal(renewed.roundScratchCollected,0);
 assert.ok(prev.length>0);
});
test('gold winners persist over card deals and bots do not consume any fields',()=>{
 const m=createDogChristmasMatch(null,true,()=>0);
 const goldEntry=m.goldFields.find(e=>e.amount===2000);
 const untouched=structuredClone(publicDogChristmasMatch(m));
 visit(m,goldEntry.field,2);
 assert.deepEqual(publicDogChristmasMatch(m),untouched,'bot does not reveal a prize or change counters');
 const winner=visit(m,goldEntry.field,3);
 assert.equal(winner.gold,2000);
 const record=publicDogChristmasMatch(m).goldFinds;
 assert.deepEqual(record,[{id:1,type:'gold',field:goldEntry.field,seat:3,amount:2000}]);
 refreshDogChristmasDeal(m,2,()=>0);
 assert.deepEqual(publicDogChristmasMatch(m).goldFinds,record);
 assert.equal(visit(m,goldEntry.field,0).gold,0,'gold can be found only once per match');
 assert.equal(publicDogChristmasMatch(m).goldFieldCount,4);
 assert.equal(publicDogChristmasMatch(m).foundGoldFields.length,1);
});
test('pre-existing rooms without new counters still have safe summary data',()=>{
 const m=createDogChristmasMatch(null,true,()=>0);
 delete m.roundFinds;delete m.goldFinds;
 const s=publicDogChristmasMatch(m);
 assert.deepEqual(s.roundFinds,[]);
 assert.deepEqual(s.goldFinds,[]);
 assert.equal(s.giftFieldCount,m.giftFields.length);
 assert.equal(s.scratchFieldCount,m.scratchFields.length);
});
