import test from 'node:test';
import assert from 'node:assert/strict';
import {newIceState,strikeIce,nextIcePicture,publicIceState,resetIceState,normalizeIceState} from '../christmas-ice-engine.js';
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
 // All 20 strikes are paid. The original zero-balance fixture could never reach the star.
 let s={...newIceState(()=>19),balance:600000000};
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

test('picture 10 retains 20 tiles, picture 11 upgrades to 25 with a star',()=>{
 const s={...newIceState(()=>19),completed:9,maxRewarded:9,balance:30000000};
 assert.equal(iceTileCount(s),ICE_TILES);
 const won=strikeIce(s,{index:19,hammer:'single',requestId:'picture-ten-star-001'},()=>0);
 assert.equal(won.state.completed,10);
 assert.equal(won.state.finished,true);
 assert.equal(won.state.tileCount,20);
 assert.equal(publicIceState(won.state).requiresFullClear,false);
 const next=nextIcePicture(won.state,()=>24);
 assert.equal(next.tileCount,25);
 assert.equal(next.star,24);
 assert.equal(publicIceState(next).star,null);
 assert.equal(publicIceState(next).tilesRemaining,25);
 assert.equal(publicIceState(next).requiresFullClear,false);
 assert.equal(nextIceTileCount(won.state),ICE_TILES_AFTER_TEN);
});

test('pictures 11, 12, 15 and 16 finish early upon finding the hidden star',()=>{
 for(const picture of [11,12,15,16]){
  const s={...newIceState(()=>0),completed:picture-1,maxRewarded:picture-1,
   tileCount:25,star:24,balance:30000000};
  const result=strikeIce(s,{index:24,hammer:'single',requestId:'early-star-picture-'+picture},()=>0);
  assert.equal(result.result.found,true,'picture '+picture);
  assert.equal(result.state.finished,true);
  assert.equal(result.state.completed,picture);
  assert.deepEqual(result.result.targets,[24]);
  assert.equal(result.state.opened.length,1,'star reveals before all 25 tiles are cleared');
  assert.equal(publicIceState(result.state).requiresFullClear,false);
  assert.equal(publicIceState(result.state).star,24);
  assert.equal(result.result.gift?.number,picture);
  const replay=strikeIce(result.state,{index:24,hammer:'single',requestId:'early-star-picture-'+picture},()=>{throw Error('idempotent strike should not draw')});
  assert.equal(replay.changed,false);
  assert.equal(replay.result.replayed,true);
 }
});

test('old in-progress picture 15 or 16 with null star gets a stable new star on next paid strike',()=>{
 for(const picture of [15,16]){
  const legacy={...newIceState(()=>0),completed:picture-1,maxRewarded:picture-1,
   finished:false,tileCount:25,star:null,opened:[0,1],
   freeHammers:{single:1,double:0,lucky:0}};
  const normalized=normalizeIceState(legacy);
  assert.equal(normalized.star,null,'normalization does not invent unpersisted star positions');
  const hit=strikeIce(normalized,{index:2,hammer:'single',requestId:'legacy-star-'+picture},()=>0);
  assert.equal(hit.state.star,2,'star re-created in an unopened tile');
  assert.equal(hit.result.found,true);
  assert.equal(hit.state.completed,picture);
  assert.equal(hit.state.freeHammers.single,0);
  assert.equal(hit.state.opened.length,3,'existing ice progress is preserved');
  const replay=strikeIce(hit.state,{index:2,hammer:'single',requestId:'legacy-star-'+picture});
  assert.equal(replay.changed,false);
  assert.equal(replay.state.freeHammers.single,0);
 }
});

test('from picture 17 onwards all 25 blocks are needed and stars are absent',()=>{
 const completed16={...newIceState(()=>0),completed:16,maxRewarded:16,
  finished:true,tileCount:25,star:12};
 let s=nextIcePicture(completed16,()=>0);
 assert.equal(s.star,null);
 assert.equal(publicIceState(s).requiresFullClear,true);
 assert.equal(iceTileCount(s),25);
 s={...s,freeHammers:{single:25,double:0,lucky:0}};
 for(let i=0;i<25;i++){
  const hit=strikeIce(s,{index:i,hammer:'single',requestId:'picture17-strike-'+String(i).padStart(3,'0')},()=>0);
  s=hit.state;
  assert.equal(hit.result.found,i===24,'17th picture only finishes after all ice is removed');
  assert.equal(s.star,null);
  assert.equal(s.completed,i===24?17:16);
  assert.equal(hit.result.gift===null,i!==24);
 }
 assert.equal(s.finished,true);
 assert.equal(publicIceState(s).requiresFullClear,true);
 assert.equal(publicIceState(s).tilesRemaining,0);
 assert.equal(publicIceState(s).star,null);
 assert.equal(nextIcePicture(s,()=>0).star,null);
});

test('25-tile milestone is independent of the later no-star threshold',()=>{
 const finished10={...newIceState(()=>0),completed:10,maxRewarded:10,
  finished:true,tileCount:20};
 assert.equal(iceTileCount(finished10),20);
 const picture11={...finished10,finished:false};
 assert.equal(iceTileCount(picture11),25);
 const oldPicture15={...newIceState(()=>0),completed:14,maxRewarded:14,
  finished:false,tileCount:20,star:0};
 assert.equal(iceTileCount(oldPicture15),25);
 const hit=strikeIce({...oldPicture15,balance:30000000},
  {index:0,hammer:'single',requestId:'picture15-legacy-tile'},()=>0);
 assert.equal(hit.result.found,true,'existing valid star remains usable');
 assert.equal(hit.state.tileCount,25);
 assert.equal(hit.state.completed,15);
 assert.equal(hit.state.opened.length,1);
 assert.equal(publicIceState(hit.state).tilesRemaining,24);
 const at17=normalizeIceState({...oldPicture15,completed:16,star:0});
 assert.equal(at17.star,null);
 assert.equal(at17.tileCount,25);
});

test('milestone reset preserves earned inventory and 25-tile upgrade',()=>{
 const s={...newIceState(()=>0),completed:12,maxRewarded:12,
  finished:true,tileCount:25,peekJokers:3};
 const reset=resetIceState(s,()=>24);
 assert.equal(reset.completed,0);
 assert.equal(reset.maxRewarded,12);
 assert.equal(reset.tileCount,25);
 assert.equal(reset.star,24);
 assert.equal(reset.peekJokers,3);
 assert.equal(publicIceState(reset).requiresFullClear,false);
});
