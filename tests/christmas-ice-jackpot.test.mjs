import test from 'node:test';
import assert from 'node:assert/strict';
import {newIceState,strikeIce,nextIcePicture,publicIceState,normalizeIceState} from '../christmas-ice-engine.js';
import {ICE_JACKPOTS,drawGift,giftKind,icePictureJackpot} from '../christmas-ice-prizes.js';
const rand=()=>0;
const setup=(completed,star=0)=>({...newIceState(rand),completed,star,balance:1000000000,opened:[],cracked:[],finished:false,maxRewarded:completed});
test('one hit before picture 50, two hits from picture 50, replay never charges again',()=>{
 const single=strikeIce(setup(48),{index:0,hammer:'single',requestId:'pre_49_example_0001'},rand);
 assert.equal(single.result.found,true);
 const s=setup(49),first=strikeIce(s,{index:0,hammer:'single',requestId:'picture50_hit_01'},rand);
 assert.equal(first.result.found,false);assert.deepEqual(first.state.opened,[]);assert.deepEqual(first.state.cracked,[0]);
 assert.equal(publicIceState(first.state).hitsPerTile,2);
 const replay=strikeIce(first.state,{index:0,hammer:'single',requestId:'picture50_hit_01'},rand);
 assert.equal(replay.changed,false);assert.equal(replay.result.replayed,true);
 const second=strikeIce(first.state,{index:0,hammer:'single',requestId:'picture50_hit_02'},rand);
 assert.equal(second.result.found,true);assert.deepEqual(second.state.opened,[0]);assert.deepEqual(second.state.cracked,[]);
 assert.equal(second.state.completed,50);
});
test('double hammer damages two tiles but opens only already cracked tiles',()=>{
 const s=setup(50,2);s.cracked=[0];
 const hit=strikeIce(s,{index:0,hammer:'double',requestId:'multi_hit_example_01'},rand);
 assert.deepEqual(hit.result.brokenTargets,[0]);assert.deepEqual(hit.result.crackedTargets,[1]);
 assert.deepEqual(hit.state.opened,[0]);assert.deepEqual(normalizeIceState(hit.state).cracked,[1]);
 const next=nextIcePicture({...hit.state,finished:true,completed:51},rand);
 assert.deepEqual(next.cracked,[]);
});
test('higher regular rewards, predictable special milestones',()=>{
 assert.equal(giftKind(50),'hammer');assert.equal(giftKind(51),'joker');assert.equal(giftKind(52),'money');
 assert.equal(drawGift(60,rand).kind,'joker');
 assert.equal(icePictureJackpot(50).superSlots,3);
 assert.equal(icePictureJackpot(60).cash,2500000000);
 assert.equal(ICE_JACKPOTS[70].legendaryChests,3);
});
