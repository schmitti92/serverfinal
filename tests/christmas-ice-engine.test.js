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

test('pictures 11–22, including the 30-tile boards 21 and 22, finish early on the hidden star',()=>{
 for(const picture of [11,12,15,16,17,20,21,22]){
  const tileCount=picture>=21?30:25;
  const star=tileCount-1;
  const s={...newIceState(()=>0),completed:picture-1,maxRewarded:picture-1,
   tileCount,star,balance:30000000};
  const requestId='early-star-picture-'+picture;
  const result=strikeIce(s,{index:star,hammer:'single',requestId},()=>0);
  assert.equal(result.result.found,true,'picture '+picture);
  assert.equal(result.state.finished,true);
  assert.equal(result.state.completed,picture);
  assert.deepEqual(result.result.targets,[star]);
  assert.equal(result.state.opened.length,1,'star reveals before all '+tileCount+' tiles are cleared');
  assert.equal(publicIceState(result.state).requiresFullClear,false);
  assert.equal(publicIceState(result.state).star,star);
  assert.equal(publicIceState(result.state).tilesRequired,tileCount);
  assert.equal(result.result.gift?.number,picture);
  const replay=strikeIce(result.state,{index:star,hammer:'single',requestId},()=>{throw Error('idempotent strike should not draw')});
  assert.equal(replay.changed,false);
  assert.equal(replay.result.replayed,true);
 }
});

test('old in-progress pictures 17–22 without stars recover without resetting progress or inventory',()=>{
 for(const picture of [17,20,21,22]){
  const tileCount=picture>=21?30:25;
  const legacy={...newIceState(()=>0),completed:picture-1,maxRewarded:picture-1,
   finished:false,tileCount,star:null,opened:[0,1],
   freeHammers:{single:1,double:0,lucky:0}};
  const normalized=normalizeIceState(legacy);
  assert.equal(normalized.star,null,'normalization must not invent an unpersisted star');
  assert.deepEqual(normalized.opened,[0,1]);
  const requestId='legacy-star-picture-'+picture;
  const hit=strikeIce(normalized,{index:2,hammer:'single',requestId},()=>0);
  assert.equal(hit.state.star,2,'star re-created in one of the unopened tiles');
  assert.equal(hit.result.found,true);
  assert.equal(hit.state.completed,picture);
  assert.equal(hit.state.freeHammers.single,0);
  assert.equal(hit.state.opened.length,3,'existing ice progress is preserved');
  assert.equal(hit.state.tileCount,tileCount);
  const replay=strikeIce(hit.state,{index:2,hammer:'single',requestId});
  assert.equal(replay.changed,false);
  assert.equal(replay.state.freeHammers.single,0);
 }
});

test('picture 22 still has a star, but from picture 23 all 30 ice blocks are required',()=>{
 const completed21={...newIceState(()=>0),completed:21,maxRewarded:21,
  finished:true,tileCount:30,star:12};
 let picture22=nextIcePicture(completed21,()=>29);
 assert.equal(picture22.star,29);
 assert.equal(publicIceState(picture22).requiresFullClear,false);
 const won22=strikeIce({...picture22,freeHammers:{single:1,double:0,lucky:0}},
  {index:29,hammer:'single',requestId:'picture22-star-hit-001'},()=>0);
 assert.equal(won22.state.completed,22);
 assert.equal(won22.result.found,true);
 assert.equal(won22.state.opened.length,1);
 assert.equal(publicIceState(won22.state).requiresFullClear,false);
 let s=nextIcePicture(won22.state,()=>0);
 assert.equal(s.star,null);
 assert.equal(publicIceState(s).requiresFullClear,true);
 assert.equal(iceTileCount(s),30);
 s={...s,freeHammers:{single:30,double:0,lucky:0}};
 for(let i=0;i<30;i++){
  const requestId='picture23-strike-'+String(i).padStart(3,'0');
  const hit=strikeIce(s,{index:i,hammer:'single',requestId},()=>0);
  s=hit.state;
  assert.equal(hit.result.found,i===29,'picture 23 should finish only after all 30 tiles');
  assert.equal(s.star,null);
  assert.equal(s.completed,i===29?23:22);
  assert.equal(hit.result.gift===null,i!==29);
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
 const at23=normalizeIceState({...oldPicture15,completed:22,maxRewarded:22,tileCount:30,star:0});
 assert.equal(at23.star,null);
 assert.equal(at23.tileCount,30);
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

test('picture 20 remains 25 tiles and picture 21 starts with exactly 30 ice tiles',()=>{
 const on20={...newIceState(()=>0),completed:19,maxRewarded:19,finished:false,
  tileCount:25,star:null,opened:Array.from({length:24},(_,i)=>i),
  freeHammers:{single:1,double:0,lucky:0}};
 assert.equal(iceTileCount(on20),25);
 const last=strikeIce(on20,{index:24,hammer:'single',requestId:'pic20-last-block-001'},()=>0);
 assert.equal(last.result.found,true);
 assert.equal(last.state.completed,20);
 assert.equal(last.state.tileCount,25);
 assert.equal(publicIceState(last.state).tilesRequired,25,'finished picture 20 keeps its display');
 const next=nextIcePicture(last.state,()=>0);
 assert.equal(next.completed,20);
 assert.equal(next.finished,false);
 assert.equal(next.star,0,'picture 21 contains a hidden star even on the 30-tile board');
 assert.equal(next.tileCount,30);
 assert.equal(next.opened.length,0);
 assert.equal(publicIceState(next).tilesRequired,30);
 assert.equal(publicIceState(next).tilesRemaining,30);
 assert.equal(publicIceState(next).requiresFullClear,false);
 assert.throws(()=>strikeIce(next,{index:30,hammer:'single',requestId:'invalid-30-index-01'}),/INVALID_TILE/);
});

test('picture 21 can reveal on its 30th ice field, charging hammers once',()=>{
 let s={...newIceState(()=>0),completed:20,maxRewarded:20,tileCount:30,star:29,
  freeHammers:{single:30,double:0,lucky:0}};
 for(let i=0;i<30;i++){
  const requestId='pic21-hammer-hit-'+String(i).padStart(4,'0');
  const hit=strikeIce(s,{index:i,hammer:'single',requestId},()=>0);
  assert.equal(hit.result.targets.length,1);
  assert.equal(hit.result.found,i===29,'picture 21 finished early at '+i);
  assert.equal(hit.state.opened.length,i+1);
  assert.equal(hit.state.completed,i===29?21:20);
  assert.equal(hit.state.freeHammers.single,29-i);
  if(i===29){
   const replay=strikeIce(hit.state,{index:i,hammer:'single',requestId},()=>{throw Error('must not reroll')});
   assert.equal(replay.changed,false);
   assert.equal(replay.result.replayed,true);
   assert.equal(replay.state.freeHammers.single,0);
   assert.equal(publicIceState(hit.state).tilesRemaining,0);
  }
  s=hit.state;
 }
 assert.equal(s.finished,true);
 assert.equal(nextIcePicture(s,()=>0).tileCount,30);
 assert.equal(nextIcePicture(s,()=>29).star,29,'picture 22 also has a star');
});

test('existing picture 21 with 25 saved fields migrates safely to 30',()=>{
 const old={...newIceState(()=>0),completed:20,maxRewarded:20,tileCount:25,
  star:null,finished:false,opened:[0,1,24],peekJokers:3,
  freeHammers:{single:1,double:0,lucky:0},
  lastActions:[{id:'old-ice-strike-0001',result:{targets:[24],found:false}}]};
 const normalized=normalizeIceState(old);
 assert.equal(normalized.tileCount,30);
 assert.deepEqual(normalized.opened,[0,1,24]);
 assert.equal(normalized.peekJokers,3);
 assert.equal(normalized.freeHammers.single,1);
 assert.equal(normalized.lastActions.length,1);
 const hit=strikeIce(normalized,{index:29,hammer:'single',requestId:'pic21-new-last-tile'},()=>0);
 assert.deepEqual(hit.result.targets,[29]);
 assert.equal(hit.result.found,false);
 assert.deepEqual(hit.state.opened,[0,1,24,29]);
 assert.equal(hit.state.freeHammers.single,0);
 assert.equal(publicIceState(hit.state).tilesRemaining,26);
});

test('30-field milestone persists after restarting progress and is independent of star cutoff',()=>{
 const finished20={...newIceState(()=>0),completed:20,maxRewarded:20,
  tileCount:25,finished:true,peekJokers:6};
 assert.equal(iceTileCount(finished20),25);
 assert.equal(nextIceTileCount(finished20),30);
 const reset=resetIceState(finished20,()=>29);
 assert.equal(reset.completed,0);
 assert.equal(reset.maxRewarded,20);
 assert.equal(reset.peekJokers,6);
 assert.equal(reset.tileCount,30);
 assert.equal(reset.star,29,'stars are still usable in replayed pictures 1–22');
 assert.equal(publicIceState(reset).tilesRequired,30);
 assert.equal(publicIceState(reset).requiresFullClear,false);
 const win=strikeIce({...reset,balance:30000000},
  {index:29,hammer:'single',requestId:'reset30-star-hit-001'},()=>0);
 assert.equal(win.result.found,true);
 assert.equal(win.result.gift,null,'old rewards must not be granted twice');
 assert.equal(win.state.completed,1);
});
