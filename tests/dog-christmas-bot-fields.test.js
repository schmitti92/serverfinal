import test from 'node:test';
import assert from 'node:assert/strict';
import {createDogChristmasMatch,claimDogChristmasHumanFields} from '../dog/christmas-village.js';

const roster=[
 {seat:0,uid:'real-player-001',bot:false,inactive:false},
 {seat:1,uid:'dog-bot:test:1',bot:true,inactive:false},
 {seat:2,uid:'real-player-002',bot:false,inactive:false},
 {seat:3,uid:'dog-bot:test:3',bot:true,inactive:false}
];
function landing(field,seat,bot,type='move'){
 const id=seat*4;
 const players=roster.map(p=>({seat:p.seat,bot:p.bot,inactive:p.inactive}));
 players[seat]={...players[seat],bot};
 return {
  before:{players,pieces:[{id,owner:seat,place:'track',pos:(field+63)%64}]},
  after:{players,pieces:[{id,owner:seat,place:'track',pos:field}]},
  action:{type,pieceId:id}
 };
}
const result=(match,field,seat,bot,draw=()=>0,type='move')=>{
 const {before,after,action}=landing(field,seat,bot,type);
 return claimDogChristmasHumanFields(match,before,after,action,roster,seat,draw);
};

test('bots may step on hidden light and scratch fields without consuming or revealing either',()=>{
 const match=createDogChristmasMatch(null,true,()=>0);
 const light=match.giftFields[0],ticket=match.scratchFields[0];
 for(const [field,type] of [[light,'gift'],[ticket,'scratch']]){
  const baseline=JSON.stringify(match);
  let draws=0;
  const claimed=result(match,field,1,true,()=>{draws++;return 0});
  assert.deepEqual(claimed,{recipient:null,baseLights:0,tier:null,gold:0},type);
  assert.equal(JSON.stringify(match),baseline,'bot cannot mutate event field state: '+type);
  assert.equal(draws,0,'bot cannot roll chance or tier: '+type);
 }
 assert.equal(match.giftCount,0);
 assert.equal(match.scratchCount,0);
 assert.deepEqual(match.foundGiftFields,[]);
 assert.deepEqual(match.foundScratchFields,[]);
 assert.deepEqual(match.activity,[]);
});

test('a real player can later reveal the same hidden fields crossed by a bot',()=>{
 const match=createDogChristmasMatch(null,true,()=>0);
 const giftField=match.giftFields[0],scratchField=match.scratchFields[0];
 result(match,giftField,1,true);
 result(match,scratchField,3,true);
 const gift=result(match,giftField,0,false,()=>99);
 assert.equal(gift.recipient.uid,'real-player-001');
 assert.ok(gift.baseLights>0);
 assert.equal(gift.tier,null);
 assert.deepEqual(match.claimedFields,[giftField]);
 const scratch=result(match,scratchField,2,false,()=>20);
 assert.equal(scratch.recipient.uid,'real-player-002');
 assert.equal(scratch.tier,'simple');
 assert.equal(scratch.baseLights,0);
 assert.deepEqual(match.claimedScratchFields,[scratchField]);
 assert.equal(match.eventSerial,2);
 assert.equal(match.giftCount,1);
 assert.equal(match.scratchCount,1);
});

test('bots cannot consume hidden personal gold fields either',()=>{
 const match=createDogChristmasMatch(null,true,()=>0);
 const {field,amount}=match.goldFields[0];
 const previous=JSON.stringify(match);
 assert.equal(result(match,field,1,true).gold,0);
 assert.equal(JSON.stringify(match),previous);
 const human=result(match,field,0,false);
 assert.equal(human.gold,amount);
 assert.deepEqual(match.claimedGoldFields,[field]);
});

test('fake human roster entries or bot engine seats never grant field rewards',()=>{
 const match=createDogChristmasMatch(null,true,()=>0);
 const field=match.giftFields[0],original=JSON.stringify(match);
 const alteredRoster=roster.map(p=>({...p}));
 alteredRoster[1]={seat:1,uid:'dog-bot:legacy:1',bot:false,inactive:false};
 let {before,after,action}=landing(field,1,true);
 assert.equal(claimDogChristmasHumanFields(match,before,after,action,alteredRoster,1).baseLights,0);
 // Even a non-bot-looking UID cannot override the authoritative engine's bot flag.
 alteredRoster[1].uid='looks-human';
 assert.equal(claimDogChristmasHumanFields(match,before,after,action,alteredRoster,1).baseLights,0);
 // No authenticated owner for a real seat: deny rather than trusting a name.
 alteredRoster[0]={seat:0,uid:null,bot:false,inactive:false};
 ({before,after,action}=landing(field,0,false));
 assert.equal(claimDogChristmasHumanFields(match,before,after,action,alteredRoster,0).baseLights,0);
 assert.equal(JSON.stringify(match),original);
});

test('field rewards are still bound to legal landing types',()=>{
 const match=createDogChristmasMatch(null,true,()=>0),field=match.giftFields[0];
 const human=result(match,field,0,false,()=>0,'swap');
 assert.equal(human.baseLights,0);
 assert.equal(human.tier,null);
 assert.deepEqual(match.claimedFields,[]);
});
