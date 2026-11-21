import test from 'node:test';
import assert from 'node:assert/strict';
import {christmasLeaderboard} from '../dog/christmas-player-leaderboard.js';

test('authenticated room projection ranks verified DOG wins and omits user identifiers',()=>{
 const members=[{uid:'player-alpha',name:'Lena'},{uid:'player-beta',name:'Tom'}];
 const receipts=[{commandId:'ticket_001',result:{
  type:'coins',winnings:[{type:'coins',amount:250}],totalCoins:250,
  board:{variantId:'simple_a'},free:false
 }}];
 const data=[
  {stats:{played:5,wins:3,knockedOut:7},
   scratch:{purchased:3,recent:receipts},
   tree:{claims:{1:{unlockId:'tree01',claimedAt:1730000000000}}}},
  {stats:{played:7,wins:4},scratch:{purchased:0},tree:{}}
 ];
 const result=christmasLeaderboard(members,data,'player-alpha');
 assert.equal(result.scope,'room-participants');
 assert.equal(result.players.length,2);
 assert.equal(result.players[0].rank,2);
 assert.equal(result.players[1].rank,1);
 assert.equal(result.players[0].you,true);
 assert.equal(result.players[1].you,false);
 assert.equal(result.players[0].scratch.winTickets,1);
 assert.equal(result.players[0].scratch.opened,3);
 assert.equal(result.players[0].scratch.olderUnclassified,2);
 assert.equal(result.players[0].scratch.incomplete,true);
 assert.equal(result.players[0].rewards.treeClaims,1);
 assert.equal(result.players[0].rewards.total,1);
 assert.equal(result.players[0].dog.knockedOut,7);
 assert.doesNotMatch(JSON.stringify(result),/player-alpha|player-beta/);
 assert.equal(result.totals.wins,7);
});
test('missing wallets do not invent victories or prizes',()=>{
 const data=christmasLeaderboard([{uid:'new-player',name:'Test'}],[{}],'someone');
 assert.equal(data.players[0].dog.played,0);
 assert.equal(data.players[0].scratch.winTickets,0);
 assert.equal(data.players[0].scratch.incomplete,false);
 assert.equal(data.players[0].rewards.total,0);
 assert.equal(data.players[0].rank,1);
});
