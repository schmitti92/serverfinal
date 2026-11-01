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
  if(round===0)assert.throws(()=>answerFarbenblitz(match,members,'p0',{round,color:'rot',elapsedMs:120},3999),/NOT_PLAYING/);
  for(const m of members){
   answerFarbenblitz(match,members,m.uid,{round,color:'rot',elapsedMs:120},4000);
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
 answerFarbenblitz(match,members,'a',{round:0,color:'rot',elapsedMs:120},3000);
 const mid=publicFarbenblitz(match,members,'a');
 assert.equal(mid.results,null);
 assert.equal(Object.hasOwn(mid.challenge,'correct'),false);
 assert.equal(Object.hasOwn(mid,'scores'),false);
});

test('first word is visible immediately after countdown without clicking an answer',()=>{
 const members=[{uid:'a',seat:'one',name:'A'}],match=createFarbenblitzMatch(members);
 acknowledgeFarbenblitz(match,members,'a',1000);
 const before=publicFarbenblitz(match,members,'a',3999);
 assert.equal(before.phase,'countdown');
 assert.equal(before.challenge,null);
 const after=publicFarbenblitz(match,members,'a',4000);
 assert.equal(after.phase,'playing');
 assert.ok(after.challenge?.word);
 assert.ok(after.challenge?.ink);
 assert.equal(after.results,null);
 assert.equal(match.round,0);
});

test('response time is summed per player and only revealed with final result',()=>{
 const members=[{uid:'a',seat:'one',name:'A'}],match=createFarbenblitzMatch(members,{rounds:2});
 acknowledgeFarbenblitz(match,members,'a',0);
 answerFarbenblitz(match,members,'a',{round:0,color:'rot',elapsedMs:512},3000);
 assert.equal(publicFarbenblitz(match,members,'a',3000).results,null);
 answerFarbenblitz(match,members,'a',{round:1,color:'rot',elapsedMs:839},4000);
 assert.equal(publicFarbenblitz(match,members,'a',4000).results[0].timeMs,1351);
});

test('finished match remains readable and a fresh match starts from instructions',()=>{
 const members=[{uid:'a',seat:'one',name:'A'},{uid:'b',seat:'two',name:'B'}];
 const old=createFarbenblitzMatch(members,{rounds:1});
 acknowledgeFarbenblitz(old,members,'a',1000);
 acknowledgeFarbenblitz(old,members,'b',1000);
 answerFarbenblitz(old,members,'a',{round:0,color:'rot',elapsedMs:300},4000);
 answerFarbenblitz(old,members,'b',{round:0,color:'blau',elapsedMs:450},4000);
 assert.equal(old.phase,'finished');
 assert.equal(publicFarbenblitz(old,members,'a',5000).results.length,2);
 assert.equal(publicFarbenblitz(old,members,'b',5000).results.length,2);
 const next=createFarbenblitzMatch(members,{rounds:1});
 assert.equal(next.phase,'instructions');
 assert.equal(next.round,0);
 assert.deepEqual(next.ready,[]);
 assert.deepEqual(next.answers,{});
 assert.deepEqual(next.scores,{a:0,b:0});
 assert.equal(publicFarbenblitz(next,members,'a',5000).results,null);
});
