import test from 'node:test';
import assert from 'node:assert/strict';
import {newIceState,strikeIce,nextIcePicture,publicIceState,resetIceState} from '../christmas-ice-engine.js';
const id='ice-strike-request-0001';
test('no star leaked to player before completion',()=>{
 const s=newIceState(()=>7);
 assert.equal(publicIceState(s).star,null);
});
test('one strike debits one price and retry is read-only',()=>{
 const s=newIceState(()=>7);
 const a=strikeIce(s,{index:0,hammer:'single',requestId:id},()=>0);
 assert.equal(a.state.balance,0);
 assert.deepEqual(a.result.targets,[0]);assert.equal(a.result.found,false);
 const b=strikeIce(a.state,{index:0,hammer:'single',requestId:id},()=>{throw Error('random on replay')});
 assert.equal(b.changed,false);assert.equal(b.result.replayed,true);
 assert.equal(b.state.balance,0);
});
test('star grants exactly one joker for picture 3',()=>{
 let s=newIceState(()=>7);s.completed=2;s.balance=1000000;
 const a=strikeIce(s,{index:7,hammer:'single',requestId:id},()=>0);
 assert.equal(a.state.peekJokers,1);
 assert.equal(a.result.gift.kind,'joker');
 assert.equal(a.state.finished,true);
 assert.equal(a.state.completed,3);
 assert.equal(strikeIce(a.state,{index:7,hammer:'single',requestId:id}).changed,false);
});
test('next picture requires previous star and preserves gifts',()=>{
 const s=newIceState(()=>7);
 assert.throws(()=>nextIcePicture(s),/PICTURE_NOT_READY/);
 const a=strikeIce(s,{index:7,hammer:'single',requestId:id},()=>0);
 const n=nextIcePicture(a.state,()=>4);
 assert.equal(n.star,4);assert.equal(n.opened.length,0);assert.equal(n.completed,1);
});
test('reject invalid actions without mutation',()=>{
 const s=newIceState(()=>7);
 assert.throws(()=>strikeIce(s,{index:20,hammer:'single',requestId:id}),/INVALID_TILE/);
 assert.throws(()=>strikeIce(s,{index:0,hammer:'invalid',requestId:id}),/INVALID_HAMMER/);
 assert.equal(s.balance,0);
});

test('reset starts at zero, preserves earned jokers and blocks duplicate picture reward',()=>{
 let s=newIceState(()=>7);s.completed=2;s.maxRewarded=3;s.peekJokers=1;
 const reset=resetIceState(s,()=>4);
 assert.equal(reset.balance,0);assert.equal(reset.completed,0);assert.equal(reset.peekJokers,1);assert.equal(reset.maxRewarded,3);
 const hit=strikeIce(reset,{index:4,hammer:'single',requestId:'fresh-strike-00001'},()=>0);
 assert.equal(hit.result.gift,null);assert.equal(hit.state.completed,1);
});

test('all twenty tiles can be opened without starter credit',()=>{
 let s=newIceState(()=>19);
 for(let i=0;i<20&&!s.finished;i++){
  const a=strikeIce(s,{index:i,hammer:'single',requestId:'ice-free-hit-'+String(i).padStart(4,'0')},()=>0);
  s=a.state;
 }
 assert.equal(s.completed,1);
 assert.equal(s.balance>=0,true);
});
test('reset does not grant previously earned money again',()=>{
 let s=newIceState(()=>0);
 const a=strikeIce(s,{index:0,hammer:'single',requestId:'ice-money-first-001'},()=>0);
 assert.equal(a.result.gift.kind,'money');
 const replay=resetIceState(a.state,()=>0);
 const b=strikeIce(replay,{index:0,hammer:'single',requestId:'ice-money-repeat-01'},()=>0);
 assert.equal(b.result.gift,null);
 assert.equal(b.state.balance,0);
});

test('free hammers refill after each picture without negative balance',()=>{
 let s=newIceState(()=>19);
 for(let i=0;i<20;i++){
  s=strikeIce(s,{index:i,hammer:'single',requestId:'full-picture-'+String(i).padStart(4,'0')},()=>0).state;
  if(s.finished)break;
 }
 assert.equal(s.completed,1);
 const next=nextIcePicture(s,()=>19);
 assert.equal(next.finished,false);
 assert.ok(next.freeHammers.single>=20);
 assert.equal(next.balance>=0,true);
});
test('reset cannot duplicate already granted joker on third picture',()=>{
 let s=newIceState(()=>4);s.completed=2;s.maxRewarded=2;
 const won=strikeIce(s,{index:4,hammer:'single',requestId:'joker-claim-000001'},()=>0);
 assert.equal(won.state.peekJokers,1);
 const restarted=resetIceState(won.state,()=>4);
 assert.equal(restarted.maxRewarded,3);
 assert.equal(restarted.peekJokers,1);
 const replay={...restarted,completed:2};
 const again=strikeIce(replay,{index:4,hammer:'single',requestId:'joker-repeat-00001'},()=>0);
 assert.equal(again.result.gift,null);
 assert.equal(again.state.peekJokers,1);
});

test('winner wheel hammer survives progress reset and can be spent',()=>{
 let state=newIceState(()=>7);
 state.freeHammers.double=1;
 state.freeHammers.lucky=1;
 const reset=resetIceState(state,()=>7);
 assert.equal(reset.freeHammers.double,1);
 assert.equal(reset.freeHammers.lucky,1);
 const hit=strikeIce(reset,{index:0,hammer:'double',requestId:'wheel-double-use-001'},()=>0);
 assert.equal(hit.state.freeHammers.double,0);
 assert.equal(hit.state.balance,0);
 assert.equal(hit.result.targets.length,2);
});
