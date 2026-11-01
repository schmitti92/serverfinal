import test from 'node:test';
import assert from 'node:assert/strict';
import {createMiniGameReadiness,acknowledgeMiniGameInstructions,advanceMiniGameReadiness,miniGameCountdown} from '../minigame-readiness.js';
test('all players must acknowledge before the shared countdown',()=>{
 let s=createMiniGameReadiness(['a','b','c'],100);
 s=acknowledgeMiniGameInstructions(s,'a',200);
 assert.equal(s.phase,'instructions');
 assert.equal(acknowledgeMiniGameInstructions(s,'a',300),s);
 s=acknowledgeMiniGameInstructions(s,'b',400);
 assert.equal(s.phase,'instructions');
 s=acknowledgeMiniGameInstructions(s,'c',500);
 assert.equal(s.phase,'countdown');
 assert.equal(s.startAt,3500);
 assert.equal(miniGameCountdown(s,500),3);
 assert.equal(miniGameCountdown(s,2500),1);
 assert.equal(advanceMiniGameReadiness(s,3499).phase,'countdown');
 assert.equal(advanceMiniGameReadiness(s,3500).phase,'playing');
});
test('unknown player and invalid duplicate roster are rejected',()=>{
 assert.throws(()=>createMiniGameReadiness(['a','a']),/INVALID_PLAYERS/);
 assert.throws(()=>createMiniGameReadiness([]),/INVALID_PLAYERS/);
 const s=createMiniGameReadiness(['a']);
 assert.throws(()=>acknowledgeMiniGameInstructions(s,'x',100),/UNKNOWN_PLAYER/);
 assert.equal(acknowledgeMiniGameInstructions(s,'a',100).startAt,3100);
});
