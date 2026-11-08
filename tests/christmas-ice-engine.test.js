import test from 'node:test';
import assert from 'node:assert/strict';
import {newIceState,strikeIce,nextIcePicture,publicIceState} from '../christmas-ice-engine.js';
const id='ice-strike-request-0001';
test('no star leaked to player before completion',()=>{
 const s=newIceState(()=>7);
 assert.equal(publicIceState(s).star,null);
});
test('one strike debits one price and retry is read-only',()=>{
 const s=newIceState(()=>7);
 const a=strikeIce(s,{index:0,hammer:'single',requestId:id},()=>0);
 assert.equal(a.state.balance,12150000);
 assert.deepEqual(a.result.targets,[0]);assert.equal(a.result.found,false);
 const b=strikeIce(a.state,{index:0,hammer:'single',requestId:id},()=>{throw Error('random on replay')});
 assert.equal(b.changed,false);assert.equal(b.result.replayed,true);
 assert.equal(b.state.balance,12150000);
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
 assert.equal(s.balance,12450000);
});
