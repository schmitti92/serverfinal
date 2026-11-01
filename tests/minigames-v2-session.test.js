import test from 'node:test';
import assert from 'node:assert/strict';
import {createMiniGameSession,matchPhase,isMatchFinished,setMatchPhase,assertFreshMatch} from '../minigames-v2/engine/session.js';
for(let count=1;count<=4;count++)test('shared session contract for '+count+' players',()=>{
 const members=Array.from({length:count},(_,i)=>({uid:'p'+i,name:'Player '+i}));
 const old=createMiniGameSession({id:'old',game:'farbenblitz',members,createdAt:1});
 assert.equal(matchPhase(old),'instructions');
 setMatchPhase(old,'countdown');setMatchPhase(old,'playing');setMatchPhase(old,'finished');
 assert.equal(isMatchFinished(old),true);
 assert.throws(()=>setMatchPhase(old,'playing'),/INVALID_MATCH_TRANSITION/);
 const fresh=createMiniGameSession({id:'new',game:'farbenblitz',members,createdAt:2});
 assert.equal(assertFreshMatch(old,fresh),fresh);
 assert.equal(matchPhase(fresh),'instructions');
 assert.throws(()=>assertFreshMatch(old,{...fresh,id:'old'}),/MATCH_ID_REUSED/);
});
test('reject duplicate identities and more than four players',()=>{
 assert.throws(()=>createMiniGameSession({id:'x',game:'x',members:[{uid:'a'},{uid:'a'}]}),/INVALID_MEMBERS/);
 assert.throws(()=>createMiniGameSession({id:'x',game:'x',members:Array.from({length:5},(_,i)=>({uid:String(i)}))}),/PLAYER_COUNT_1_TO_4/);
});
