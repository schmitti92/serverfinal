'use strict';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
 ONE_CENT_CASE,FIFTY_MILLION_CASE,isCasePackBonusAmount,
 newCasePackBonusEvents,drawCasePackBonus
} from '../deal-case-pack-bonus.js';
import {create,apply,free} from '../deal-or-no-deal.js';

test('1 cent and EUR 50 million are the only special suitcase rewards',()=>{
 assert.equal(ONE_CENT_CASE,1);
 assert.equal(FIFTY_MILLION_CASE,5_000_000_000);
 for(const value of [1,5_000_000_000])assert.equal(isCasePackBonusAmount(value),true);
 for(const value of [0,100,50_000_000,500_000_000,1_000_000_000,undefined])assert.equal(isCasePackBonusAmount(value),false);
});

test('same 40/50/10 pack chances as existing cent rule',()=>{
 const outcomes=Array.from({length:100},(_,i)=>drawCasePackBonus(max=>{
  assert.equal(max,100);
  return i;
 }));
 assert.equal(outcomes.filter(p=>p==='small').length,40);
 assert.equal(outcomes.filter(p=>p==='large').length,50);
 assert.equal(outcomes.filter(p=>p==='premium').length,10);
 assert.throws(()=>drawCasePackBonus(()=>100),/INVALID_CASE_BONUS_ROLL/);
});

test('one revealed 50m suitcase rewards its opener, never another actor or replay',()=>{
 const before={phase:'reveal',pending:{eventId:'e50'},events:[]};
 const opened={type:'opened',eventId:'e50',amount:FIFTY_MILLION_CASE,playerId:'vanessa'};
 const after={events:[opened]};
 assert.deepEqual(newCasePackBonusEvents(before,after,{type:'ack-reveal'}),[opened]);
 assert.deepEqual(newCasePackBonusEvents(before,after,{type:'open'}),[]);
 assert.deepEqual(newCasePackBonusEvents({...before,pending:{eventId:'other'}},after,{type:'ack-reveal'}),[]);
 assert.deepEqual(newCasePackBonusEvents({...before,events:[opened]},after,{type:'ack-reveal'}),[]);
});

test('a 30-case batch can award both special cases to different players',()=>{
 const cent={type:'opened',eventId:'a',amount:ONE_CENT_CASE,playerId:'chris'};
 const fifty={type:'opened',eventId:'b',amount:FIFTY_MILLION_CASE,playerId:'david'};
 const normal={type:'opened',eventId:'c',amount:1000,playerId:'vanessa'};
 const before={phase:'batch-reveal',events:[]};
 const after={events:[cent,normal,fifty]};
 assert.deepEqual(newCasePackBonusEvents(before,after,{type:'ack-batch'}),[cent,fifty]);
 assert.deepEqual(newCasePackBonusEvents({...before,events:[cent]},after,{type:'ack-batch'}),[fifty]);
 assert.deepEqual(newCasePackBonusEvents(before,after,{type:'ack-reveal'}),[]);
});

test('actual 30-case game engine exposes eligible 50m opening with correct player id',()=>{
 const game=create([{id:'chris'},{id:'david'}],()=>0,30);
 assert.equal(game.values.includes(FIFTY_MILLION_CASE),true);
 const jackpotCase=game.values.indexOf(FIFTY_MILLION_CASE);
 const selectable=game.values.map((_,index)=>index).filter(index=>index!==jackpotCase);
 let chosen=game;
 chosen=apply(chosen,chosen.order[0],{type:'select',case:selectable[0],id:'select0',revision:chosen.revision},()=>0);
 chosen=apply(chosen,chosen.order[1],{type:'select',case:selectable[1],id:'select1',revision:chosen.revision},()=>0);
 assert.equal(chosen.phase,'batch-pick');
 // Move a special case into the first batch without changing the actual
 // server-owned case value. The game still handles recipient assignment.

 let actorOrder=[...chosen.order];
 let opener=chosen;
 for(let i=0;i<opener.openingBatch.perPlayer*opener.players.length;i++){
  const actor=actorOrder[Math.floor(i/opener.openingBatch.perPlayer)];
  const caseNumber=i===0?jackpotCase:free(opener).find(n=>n!==jackpotCase);
  opener=apply(opener,actor,{type:'open',case:caseNumber,id:'pick'+i,revision:opener.revision},()=>0);
 }
 assert.equal(opener.phase,'batch-reveal');
 opener.openingBatch.endsAt=Date.now()-1;
 const revealed=apply(opener,'chris',{type:'ack-batch',id:'ack',revision:opener.revision},()=>0);
 const events=newCasePackBonusEvents(opener,revealed,{type:'ack-batch'});
 const reward=events.find(e=>e.amount===FIFTY_MILLION_CASE);
 assert.ok(reward);
 assert.equal(reward.playerId,actorOrder[0]);
 assert.deepEqual(newCasePackBonusEvents(revealed,revealed,{type:'ack-batch'}),[]);
});
