import test from 'node:test';
import assert from 'node:assert/strict';
import {createFarbenblitzMatch,acknowledgeFarbenblitz,answerFarbenblitz,publicFarbenblitz} from '../minigames-v2/farbenblitz.js';
for(let n=1;n<=4;n++)test('Farbenblitz authoritative match for '+n+' players',()=>{
 const members=Array.from({length:n},(_,i)=>({uid:'p'+i,seat:'s'+i,name:'Spieler '+i}));
 const match=createFarbenblitzMatch(members,{rounds:4});
 for(let i=0;i<n;i++)acknowledgeFarbenblitz(match,members,members[i].uid,1000);
 assert.equal(match.startAt,4000);
 assert.equal(publicFarbenblitz(match,members,'p0').results,null);
 for(let round=0;round<4;round++){
  assert.throws(()=>answerFarbenblitz(match,members,'p0',{round,color:'rot'},3999),/NOT_PLAYING/);
  for(const m of members){
   answerFarbenblitz(match,members,m.uid,{round,color:'rot'},4000);
   if(m===members[0]&&n>1)assert.throws(()=>answerFarbenblitz(match,members,m.uid,{round,color:'rot'},4000),/ALREADY_ANSWERED/);
  }
 }
 assert.equal(match.finished,true);
 assert.equal(publicFarbenblitz(match,members,'p0').results.length,n);
});
test('do not reveal answer or score before finish',()=>{
 const members=[{uid:'a',seat:'s',name:'A'}],match=createFarbenblitzMatch(members,{rounds:2});
 acknowledgeFarbenblitz(match,members,'a',0);
 const pre=publicFarbenblitz(match,members,'a');
 assert.equal(pre.challenge,null);
 assert.equal(pre.results,null);
 answerFarbenblitz(match,members,'a',{round:0,color:'rot'},3000);
 const mid=publicFarbenblitz(match,members,'a');
 assert.equal(mid.results,null);
 assert.equal(Object.hasOwn(mid.challenge,'correct'),false);
 assert.equal(Object.hasOwn(mid,'scores'),false);
});
