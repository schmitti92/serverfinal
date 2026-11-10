import test from 'node:test';
import assert from 'node:assert/strict';
import {newIceState,strikeIce,nextIcePicture,publicIceState,resetIceState,normalizeIceState} from '../christmas-ice-engine.js';
import {ICE_TILES,ICE_TILES_FROM_PICTURE_30,ICE_TILES_FROM_PICTURE_40,iceTileCount,nextIceTileCount} from '../christmas-ice-prizes.js';
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
 assert.throws(()=>strikeIce(s,{index:50,hammer:'single',requestId:id}),/INVALID_TILE/);
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


test('every picture starts with a concealed star, including after picture 22',()=>{
 for(const n of [1,10,11,20,21,22,23,29,30,31,39,40,41,50,70]){
  const tiles=n>=40?150:n>=30?100:50;
  const s={...newIceState(()=>0),completed:n-1,maxRewarded:n-1,
   tileCount:30,star:tiles-1,balance:30000000,finished:false};
  assert.equal(iceTileCount(s),tiles,'picture '+n);
  const shown=publicIceState(s);
  assert.equal(shown.star,null);
  assert.equal(shown.tilesRequired,tiles);
  assert.equal(shown.requiresFullClear,false);
  const hit=strikeIce(s,{index:tiles-1,hammer:'single',requestId:'star-hit-picture-'+n},()=>0);
  assert.equal(hit.state.completed,n);
  assert.equal(hit.state.finished,true);
  assert.equal(hit.state.opened.length,1,'one tile should reveal '+n);
  assert.equal(publicIceState(hit.state).star,tiles-1);
  assert.equal(hit.result.found,true);
  assert.equal(hit.result.gift?.number,n);
  const replay=strikeIce(hit.state,{index:tiles-1,hammer:'single',requestId:'star-hit-picture-'+n});
  assert.equal(replay.changed,false);
  assert.equal(replay.result.replayed,true);
 }
});

test('picture 29 has 50 fields; picture 30 and later have 100 fields',()=>{
 const on29={...newIceState(()=>49),completed:28,maxRewarded:28,
   finished:false,tileCount:30,star:49,balance:30000000};
 assert.equal(iceTileCount(on29),ICE_TILES);
 const finished29=strikeIce(on29,{index:49,hammer:'single',requestId:'finish-picture-29-001'},()=>0).state;
 assert.equal(publicIceState(finished29).tilesRequired,50);
 assert.equal(nextIceTileCount(finished29),ICE_TILES_FROM_PICTURE_30);
 const picture30=nextIcePicture(finished29,()=>99);
 assert.equal(picture30.tileCount,100);
 assert.equal(picture30.star,99);
 assert.equal(publicIceState(picture30).tilesRemaining,100);
 assert.throws(()=>strikeIce(picture30,{index:100,hammer:'single',requestId:'invalid-100-index'},()=>0),/INVALID_TILE/);
 const finished30=strikeIce({...picture30,balance:30000000},{index:99,hammer:'single',requestId:'finish-picture-30-001'},()=>0).state;
 assert.equal(publicIceState(finished30).tilesRequired,100);
 assert.equal(nextIcePicture(finished30,()=>95).tileCount,100);
});


test('picture 39 keeps 100 tiles and picture 40 starts with 150, including server-side bounds',()=>{
 const on39={...newIceState(()=>0),completed:38,maxRewarded:38,finished:false,
  tileCount:100,star:99,balance:30000000};
 assert.equal(iceTileCount(on39),ICE_TILES_FROM_PICTURE_30);
 const finished39=strikeIce(on39,{index:99,hammer:'single',requestId:'finish-picture-39-001'},()=>0).state;
 assert.equal(publicIceState(finished39).tilesRequired,100);
 assert.equal(nextIceTileCount(finished39),ICE_TILES_FROM_PICTURE_40);
 const picture40=nextIcePicture(finished39,()=>149);
 assert.equal(picture40.tileCount,150);
 assert.equal(picture40.star,149);
 assert.equal(publicIceState(picture40).tilesRemaining,150);
 assert.throws(()=>strikeIce(picture40,{index:150,hammer:'single',requestId:'invalid-150-index'},()=>0),/INVALID_TILE/);
 const finished40=strikeIce({...picture40,balance:30000000},{index:149,hammer:'single',requestId:'finish-picture-40-001'},()=>0).state;
 assert.equal(publicIceState(finished40).tilesRequired,150);
 assert.equal(nextIcePicture(finished40,()=>120).tileCount,150);
});

test('existing partially revealed picture 40 migrates to 150 without losing blocks, star or rewards',()=>{
 const old={...newIceState(()=>0),completed:39,maxRewarded:39,finished:false,
  tileCount:100,star:87,opened:[0,1,25],freeHammers:{single:1,double:1,lucky:0},
  prizes:[{kind:'money',number:39,amount:5000}],peekJokers:3,
  lastActions:[{id:'prior-strike-0001',result:{targets:[25],found:false}}]};
 const normalized=normalizeIceState(old);
 assert.equal(normalized.tileCount,150);
 assert.deepEqual(normalized.opened,[0,1,25]);
 assert.equal(normalized.star,87);
 assert.deepEqual(normalized.freeHammers,old.freeHammers);
 assert.equal(normalized.peekJokers,3);
 assert.deepEqual(normalized.prizes,old.prizes);
 assert.equal(normalized.lastActions.length,1);
 assert.equal(publicIceState(normalized).tilesRequired,150);
 const hit=strikeIce(normalized,{index:149,hammer:'single',requestId:'picture40-strike-149'},()=>0);
 assert.equal(hit.state.opened.includes(149),true);
 assert.equal(hit.state.opened.length,4);
 assert.equal(hit.state.freeHammers.single,0);
 assert.equal(hit.result.found,false);
 assert.throws(()=>strikeIce(hit.state,{index:150,hammer:'single',requestId:'picture40-strike-150'},()=>0),/INVALID_TILE/);
});

test('existing partial picture 23–70 without star is safely upgraded and restored',()=>{
 for(const picture of [23,29,30,45,70]){
  const tiles=picture>=40?150:picture>=30?100:50;
  const old={...newIceState(()=>0),completed:picture-1,maxRewarded:picture-1,
   finished:false,tileCount:30,star:null,opened:[0,1,2],
   freeHammers:{single:1,double:0,lucky:0}};
  const normalized=normalizeIceState(old);
  assert.equal(normalized.tileCount,tiles);
  assert.deepEqual(normalized.opened,[0,1,2]);
  assert.equal(normalized.star,null,'no extra database write is needed just to migrate');
  const hit=strikeIce(normalized,{index:3,hammer:'single',requestId:'recover-star-picture-'+picture},()=>0);
  assert.equal(hit.state.star,3,'first strike draws from unopened positions');
  assert.equal(hit.state.completed,picture);
  assert.equal(hit.state.opened.length,4);
  assert.equal(hit.state.freeHammers.single,0);
  assert.equal(publicIceState(hit.state).star,3);
  assert.equal(publicIceState(hit.state).tilesRequired,tiles);
 }
});

test('an old 30-tile board extends to 100 without losing strikes or rewards',()=>{
 const old={...newIceState(()=>0),completed:29,maxRewarded:29,
  tileCount:30,opened:[0,7,29],star:5,
  freeHammers:{single:1,double:0,lucky:0},peekJokers:4,
  lastActions:[{id:'past-receipt-0001',result:{targets:[29],found:false}}]};
 const migrated=normalizeIceState(old);
 assert.equal(migrated.tileCount,100);
 assert.deepEqual(migrated.opened,[0,7,29]);
 assert.equal(migrated.peekJokers,4);
 assert.equal(migrated.lastActions.length,1);
 assert.equal(migrated.star,5);
 const hit=strikeIce(migrated,{index:40,hammer:'single',requestId:'picture30-field40-001'},()=>0);
 assert.equal(hit.result.found,false);
 assert.equal(hit.state.opened.length,4);
 assert.equal(hit.state.freeHammers.single,0);
});

test('all remaining fields can be cleared; only one reward is issued',()=>{
 let s={...newIceState(()=>99),completed:29,maxRewarded:29,star:99,
  tileCount:100,freeHammers:{single:100,double:0,lucky:0}};
 for(let i=0;i<100;i++){
  const hit=strikeIce(s,{index:i,hammer:'single',requestId:'picture-30-hit-'+String(i).padStart(3,'0')},()=>0);
  assert.equal(hit.result.found,i===99);
  s=hit.state;
 }
 assert.equal(s.finished,true);
 assert.equal(s.completed,30);
 assert.equal(s.opened.length,100);
 assert.equal(publicIceState(s).tilesRemaining,0);
 assert.equal(s.prizes.filter(x=>x.number===30).length,1);
});

test('restarting progress resets to 50 tiles without duplicating earned items',()=>{
 const saved={...newIceState(()=>0),completed:32,maxRewarded:32,
  tileCount:100,finished:true,star:99,peekJokers:5,freeHammers:{single:1,double:0,lucky:2}};
 const reset=resetIceState(saved,()=>49);
 assert.equal(reset.completed,0);
 assert.equal(reset.maxRewarded,32);
 assert.equal(reset.tileCount,50);
 assert.equal(reset.star,49);
 assert.equal(reset.peekJokers,5);
 assert.equal(reset.freeHammers.lucky,2);
 const won=strikeIce({...reset,balance:30000000},
  {index:49,hammer:'single',requestId:'replay-first-picture-001'},()=>0);
 assert.equal(won.result.gift,null);
 assert.equal(won.state.completed,1);
});


test('old player ice profiles with missing optional arrays still load without losing earned milestones',()=>{
 const old={...newIceState(()=>9),version:2,completed:24,maxRewarded:27,
  star:21,freeHammers:{single:2,double:3,lucky:1},peekJokers:7,
  goldenHammerGift2026:true};
 delete old.opened;delete old.prizes;delete old.lastActions;
 const before=structuredClone(old);
 const restored=normalizeIceState(old);
 assert.deepEqual(restored.opened,[]);
 assert.deepEqual(restored.prizes,[]);
 assert.deepEqual(restored.lastActions,[]);
 assert.equal(restored.completed,24);
 assert.equal(restored.maxRewarded,27);
 assert.equal(restored.peekJokers,7);
 assert.deepEqual(restored.freeHammers,{single:2,double:3,lucky:1});
 assert.equal(restored.goldenHammerGift2026,true);
 assert.equal(publicIceState(restored).tilesRequired,50);
 assert.deepEqual(old,before,'read-time repair must never change the original Firestore document');
 const hit=strikeIce(restored,{index:0,hammer:'single',requestId:'legacy-david-open-0001'},()=>0);
 assert.equal(hit.state.freeHammers.single,1);
 assert.equal(hit.state.completed,24);
 assert.deepEqual(hit.state.opened,[0]);
});
test('a structurally invalid saved field is not silently discarded',()=>{
 const s={...newIceState(()=>1),opened:{'0':true}};
 assert.throws(()=>normalizeIceState(s),/INVALID_ICE_OPENED/);
});
