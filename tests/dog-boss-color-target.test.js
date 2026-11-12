import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DOG_COLOR_TARGET_ENDGAME_WINDOWS,DOG_SLOW_DODGE_ENDGAME_WINDOWS,
 dogCreateMiniGames,dogNormalizeMiniGames,dogPublicMiniGames,
 dogSubmitMiniAnswer,dogMiniBonus,dogMiniExchangeView
} from '../dog-boss-minigames.js';
import {DOG_BOSS10_DURATION_MS} from '../dog-boss10.js';

const start=1_900_000_000_000;
const roster=[{uid:'hero-a'},{uid:'hero-b'},{uid:'hero-c'}];
const create=(gate=10,rand=()=>0)=>dogCreateMiniGames(gate,rand,{exchange:'endgame'});

test('v10: ten deterministic, unambiguous color-symbol questions in 10 seconds per boss tier',()=>{
 assert.equal(DOG_BOSS10_DURATION_MS,101000);
 for(const gate of [10,20,30,40,60,70,90,100]){
  const game=create(gate),round=game.rounds[2],tier=gate/10;
  assert.equal(game.version,10);
  assert.deepEqual(game.rounds.map(r=>[r.startMs,r.endMs]),
   DOG_COLOR_TARGET_ENDGAME_WINDOWS.map(r=>[r.startMs,r.endMs]));
  assert.deepEqual(game.rounds.map(r=>r.endMs-r.startMs),[12000,15000,10000,8000]);
  assert.equal(round.endMs-round.startMs,10000);
  assert.equal(round.maxSteps,10);
  assert.equal(round.puzzles.length,10);
  const count=tier<=3?4:tier<=6?6:8;
  for(const [step,p] of round.puzzles.entries()){
   assert.equal(p.options.length,count);
   assert.equal(p.mode,tier<=3?(step%2?'symbol':'color'):'both');
   const matches=p.options.map(o=>p.mode==='color'?o.color===p.targetColor:
    p.mode==='symbol'?o.symbol===p.targetSymbol:
     o.color===p.targetColor&&o.symbol===p.targetSymbol);
   assert.equal(matches.filter(Boolean).length,1,'every puzzle has one right answer');
   assert.equal(matches[p.correctIndex],true);
   assert.equal(new Set(p.options.map(o=>o.color+'|'+o.symbol)).size,count);
  }
  const normalized=dogNormalizeMiniGames(game);
  assert.ok(normalized,'saved game can be reloaded');
  assert.equal(normalized.rounds[2].puzzles.length,10);
  const publicView=dogPublicMiniGames(game,'hero-a');
  assert.equal(publicView.rounds[2].puzzles.length,10);
  assert.ok(!JSON.stringify(publicView).includes('correctIndex'),
   'server-only answer indices are not exposed');
  assert.equal(dogMiniExchangeView(game,roster,100000).durationMs,101000);
 }
});

test('ten correct taps yield exactly +3% personal damage with one receipt',()=>{
 const game=create(70),round=game.rounds[2];
 const right=round.puzzles.map(p=>p.correctIndex);
 const result=dogSubmitMiniAnswer(game,roster,'hero-a',round.round,right,
  start+round.endMs-50,start,0);
 assert.equal(result.correct,true);
 assert.equal(result.correctCount,10);
 assert.equal(result.games.answers['hero-a'][round.round].attempts.length,10);
 assert.equal(dogMiniBonus(result.games,'hero-a'),.03);
 const exchange=dogMiniExchangeView(result.games,roster,round.endMs+1,
  ()=>1000);
 assert.equal(exchange.stages[2].correct,10);
 assert.equal(exchange.stages[2].max,30);
 assert.equal(exchange.stages[2].bonusDamage,30);
 assert.throws(()=>dogSubmitMiniAnswer(result.games,roster,'hero-a',
  round.round,right,start+round.endMs,start,0),/STEP_ORDER/);
});

test('partial answers and mistakes are server-scored without per-tap network receipts',()=>{
 const game=create(40),round=game.rounds[2];
 const picked=round.puzzles.slice(0,4).map((p,i)=>i===2?
  (p.correctIndex+1)%p.options.length:p.correctIndex);
 const result=dogSubmitMiniAnswer(game,roster,'hero-b',round.round,picked,
  start+round.endMs+450,start,0);
 assert.equal(result.correctCount,3);
 assert.equal(result.games.answers['hero-b'][round.round].attempts.length,4);
 assert.ok(Math.abs(dogMiniBonus(result.games,'hero-b')-.009)<.00001);
 assert.throws(()=>dogSubmitMiniAnswer(game,roster,'hero-a',round.round,
  [...picked,...picked,...picked],start+round.endMs,start,0),/BAD_ANSWER/);
 assert.throws(()=>dogSubmitMiniAnswer(game,roster,'hero-a',round.round,
  [99],start+round.endMs,start,0),/BAD_ANSWER/);
 assert.throws(()=>dogSubmitMiniAnswer(game,roster,'hero-a',round.round,
  0,start+round.startMs+500,start,0),/BAD_ANSWER/,
  'v10 targets cannot exploit old one-tap scoring');
 assert.throws(()=>dogSubmitMiniAnswer(game,roster,'hero-a',round.round,
  picked,start+round.endMs+2000,start,0),/TOO_LATE/);
});

test('old version 9 keeps 99 second schedule, old moving-target behavior and precision Konter',()=>{
 const current=create(10);
 const old={...current,version:9,rounds:current.rounds.map((r,i)=>({
  ...r,startMs:DOG_SLOW_DODGE_ENDGAME_WINDOWS[i].startMs,
  endMs:DOG_SLOW_DODGE_ENDGAME_WINDOWS[i].endMs
 }))};
 const norm=dogNormalizeMiniGames(old);
 assert.ok(norm);
 assert.equal(norm.version,9);
 assert.equal(norm.rounds[2].maxSteps,3);
 assert.equal(norm.rounds[2].endMs-norm.rounds[2].startMs,8000);
 assert.equal(dogMiniExchangeView(old,roster,98000).durationMs,99000);
});
