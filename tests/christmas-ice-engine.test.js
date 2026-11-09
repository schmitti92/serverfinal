import test from 'node:test';
import assert from 'node:assert/strict';
import {newIceState,strikeIce,nextIcePicture,publicIceState,resetIceState} from '../christmas-ice-engine.js';
import {ICE_TILES,ICE_TILES_AFTER_TEN,iceTileCount,nextIceTileCount} from '../christmas-ice-prizes.js';
const id='ice-strike-request-0001';
test('no star leaked to player before completion',()=>{
 const s=newIceState(()=>7);
 assert.equal(publicIceState(s).star,null);
});
test('one strike debits one price and retry is read-only',()=>{
 const s={...newIceState(()=>7),balance:30000000};
 const a=strikeIce(s,{index:0,hammer:'single',requestId:id},()=>0);
 assert.equal(a.state.balance,0);
 assert.deepEqual(a.result.targets,[0]);assert.equal(a.result.found,false);
 const b=strikeIce(a.state,{index:0,hammer:'single',requestId:id},()=>{throw Error('random on replay')});
 assert.equal(b.changed,false);assert.equal(b.result.replayed,true);
 assert.equal(b.state.balance,0);
});
test('star grants exactly one joker for picture 3',()=>{
 let s=newIceState(()=>7);s.completed=2;s.balance=30000000;
 const a=strikeIce(s,{index:7,hammer:'single',requestId:id},()=>0);
 assert.equal(a.state.peekJokers,1);
 assert.equal(a.result.gift.kind,'joker');
 assert.equal(a.state.finished,true);
 assert.equal(a.state.completed,3);
 assert.equal(strikeIce(a.state,{index:7,hammer:'single',requestId:id}).changed,false);
});
test('next picture requires previous star and preserves gifts',()=>{
 const s={...newIceState(()=>7),balance:30000000};
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
 const hit=strikeIce({...reset,balance:30000000},{index:4,hammer:'single',requestId:'fresh-strike-00001'},()=>0);
 assert.equal(hit.result.gift,null);assert.equal(hit.state.completed,1);
});

test('all twenty tiles can be opened using paid strikes',()=>{
 let s={...newIceState(()=>19),balance:600000000};
 for(let i=0;i<20&&!s.finished;i++){
  const a=strikeIce(s,{index:i,hammer:'single',requestId:'ice-free-hit-'+String(i).padStart(4,'0')},()=>0);
  s=a.state;
 }
 assert.equal(s.completed,1);
 assert.equal(s.balance>=0,true);
});
test('reset does not grant previously earned money again',()=>{
 let s={...newIceState(()=>0),balance:30000000};
 const a=strikeIce(s,{index:0,hammer:'single',requestId:'ice-money-first-001'},()=>0);
 assert.equal(a.result.gift.kind,'money');
 const replay=resetIceState(a.state,()=>0);
 const b=strikeIce({...replay,balance:30000000},{index:0,hammer:'single',requestId:'ice-money-repeat-01'},()=>0);
 assert.equal(b.result.gift,null);
 assert.equal(b.state.balance,0);
});

test('no free hammers are granted on advancing to the next picture',()=>{
 let s=newIceState(()=>19);
 for(let i=0;i<20;i++){
  s=strikeIce(s,{index:i,hammer:'single',requestId:'full-picture-'+String(i).padStart(4,'0')},()=>0).state;
  if(s.finished)break;
 }
 assert.equal(s.completed,1);
 const next=nextIcePicture(s,()=>19);
 assert.equal(next.finished,false);
 assert.equal(next.freeHammers.single,0);
 assert.equal(next.balance>=0,true);
});
test('reset cannot duplicate already granted joker on third picture',()=>{
 let s=newIceState(()=>4);s.balance=60000000;s.completed=2;s.maxRewarded=2;
 const won=strikeIce(s,{index:4,hammer:'single',requestId:'joker-claim-000001'},()=>0);
 assert.equal(won.state.peekJokers,1);
 const restarted=resetIceState(won.state,()=>4);
 assert.equal(restarted.maxRewarded,3);
 assert.equal(restarted.peekJokers,1);
 const replay={...restarted,completed:2};
 const again=strikeIce({...replay,balance:30000000},{index:4,hammer:'single',requestId:'joker-repeat-00001'},()=>0);
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

test('first ten pictures keep their original 20 ice tiles and early star reveal',()=>{
 const s={...newIceState(()=>19),completed:9,maxRewarded:9,balance:30000000};
 assert.equal(iceTileCount(s),ICE_TILES);
 assert.equal(publicIceState(s).tilesRequired,20);
 const win=strikeIce(s,{index:19,hammer:'single',requestId:'picture-ten-star-001'},()=>0);
 assert.equal(win.result.found,true);
 assert.equal(win.state.completed,10);
 assert.equal(win.state.finished,true);
 assert.equal(win.state.tileCount,20,'tenth picture stays on its original board');
 assert.equal(publicIceState(win.state).requiresFullClear,false);
 const next=nextIcePicture(win.state,()=>24);
 assert.equal(next.completed,10);
 assert.equal(next.tileCount,25);
 assert.equal(next.star,24,'new full-clear board can use all 25 star positions');
 assert.equal(publicIceState(next).star,null);
 assert.equal(publicIceState(next).tilesRequired,25);
 assert.equal(publicIceState(next).tilesRemaining,25);
 assert.equal(publicIceState(next).requiresFullClear,true);
});
test('after 10 pictures all 25 blocks must be removed, even when star was opened first',()=>{
 let s={...newIceState(()=>0),completed:10,maxRewarded:10,
  tileCount:25,star:0,freeHammers:{single:25,double:0,lucky:0}};
 assert.equal(iceTileCount(s),25);
 assert.equal(nextIceTileCount(s),25);
 assert.throws(()=>strikeIce(s,{index:25,hammer:'single',requestId:'invalid-ice-25tile'},()=>0),/INVALID_TILE/);
 for(let index=0;index<25;index++){
  const strike=strikeIce(s,{index,hammer:'single',requestId:'picture-eleven-hit-'+String(index).padStart(3,'0')},()=>0);
  s=strike.state;
  assert.equal(s.opened.length,index+1);
  assert.equal(s.freeHammers.single,24-index);
  if(index<24){
   assert.equal(strike.result.found,false,'cannot finish 25-tile board with only '+(index+1)+' removed');
   assert.equal(strike.result.gift,null);
   assert.equal(s.completed,10);
   assert.equal(s.finished,false);
   assert.throws(()=>nextIcePicture(s),/PICTURE_NOT_READY/);
  }else{
   assert.equal(strike.result.found,true);
   assert.equal(s.finished,true);
   assert.equal(s.completed,11);
   assert.equal(strike.result.gift.kind,'money');
   assert.equal(publicIceState(s).tilesRemaining,0);
   const replay=strikeIce(s,{index,hammer:'single',requestId:'picture-eleven-hit-024'});
   assert.equal(replay.changed,false);
   assert.equal(replay.result.replayed,true);
  }
 }
 const next=nextIcePicture(s,()=>24);
 assert.equal(next.tileCount,25);
 assert.equal(next.opened.length,0);
 assert.equal(next.star,24);
});
test('earned tenth-picture milestone persists with 25 tiles even after progress reset',()=>{
 const s={...newIceState(()=>0),completed:12,maxRewarded:12,finished:true,tileCount:25};
 const reset=resetIceState(s,()=>24);
 assert.equal(reset.completed,0);
 assert.equal(reset.maxRewarded,12);
 assert.equal(reset.tileCount,25);
 assert.equal(reset.star,24);
 assert.equal(publicIceState(reset).requiresFullClear,true);
 assert.equal(iceTileCount({...s,tileCount:undefined}),25,'legacy state without tileCount upgrades safely');
 assert.equal(iceTileCount({...newIceState(()=>7),completed:10,tileCount:undefined}),25);
});
test('multi-hit hammer clears up to remaining tiles on the 25 block board without extra credits',()=>{
 let s={...newIceState(()=>0),completed:10,maxRewarded:10,tileCount:25,
  freeHammers:{single:0,double:0,lucky:1}};
 // The 3–6 tile lucky hammer can hit the early star but must not finish.
 const first=strikeIce(s,{index:0,hammer:'lucky',requestId:'post-ten-lucky-001'},()=>0);
 assert.equal(first.result.found,false);
 assert.equal(first.state.opened.length,3);
 assert.equal(first.state.completed,10);
 assert.equal(first.result.gift,null);
 assert.equal(first.state.freeHammers.lucky,0);
 const nearEnd={...first.state,opened:Array.from({length:24},(_,i)=>i),
  freeHammers:{single:0,double:1,lucky:0}};
 const last=strikeIce(nearEnd,{index:24,hammer:'double',requestId:'post-ten-double-001'},()=>0);
 assert.deepEqual(last.result.targets,[24]);
 assert.equal(last.state.opened.length,25);
 assert.equal(last.state.completed,11);
});
