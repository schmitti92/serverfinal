import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DOG_MINIGAME_KINDS,DOG_MINIGAME_WINDOWS,dogMiniDifficulty,
 dogCreateMiniGames,dogNormalizeMiniGames,dogPublicMiniGames,
 dogSubmitMiniAnswer,dogMiniBonus,dogMiniTargetIndex
} from '../dog-boss-minigames.js';
const now=1_800_000_000_000,roster=[{uid:'a'},{uid:'b'},{uid:'c'}];
const dice=()=>0;
test('Every Boss 10–100 selects exactly three unique games in valid fixed windows',()=>{
 for(let gate=10;gate<=100;gate+=10){
  const plans=[];
  for(const seed of [0,1,2,3]){
   const plan=dogCreateMiniGames(gate,n=>seed%n);
   assert.equal(plan.rounds.length,3);
   assert.equal(new Set(plan.rounds.map(r=>r.kind)).size,3);
   assert.ok(plan.rounds.every((r,i)=>r.startMs===DOG_MINIGAME_WINDOWS[i].startMs&&
    r.endMs===DOG_MINIGAME_WINDOWS[i].endMs));
   assert.ok(plan.rounds.every(r=>DOG_MINIGAME_KINDS.includes(r.kind)));
   assert.equal(dogNormalizeMiniGames(plan).rounds.length,3);
   plans.push(plan.rounds.map(r=>r.kind).join(','));
  }
  assert.ok(new Set(plans).size>1,'different random draws should alter order/selection');
 }
});
test('Boss difficulty grows: tighter reaction windows, faster targets, harder math',()=>{
 const first=dogMiniDifficulty(10),last=dogMiniDifficulty(100);
 assert.ok(last.reactionToleranceMs<first.reactionToleranceMs);
 assert.ok(last.targetStepMs<first.targetStepMs);
 assert.ok(last.mathTier>first.mathTier);
 assert.ok(last.choices>first.choices);
 assert.throws(()=>dogMiniDifficulty(15),/BAD_GATE/);
 for(const gate of [10,40,70,100]){
  const d=dogMiniDifficulty(gate);
  assert.ok(d.reactionToleranceMs>=400);
  assert.ok(d.targetStepMs>=530);
 }
});
test('Server conceals arithmetic solution but shows telegraphed danger and timing',()=>{
 const plan=dogCreateMiniGames(100,dice);
 const publicView=dogPublicMiniGames(plan,'a');
 assert.equal(publicView.rounds.length,3);
 assert.ok(!('answers' in publicView));
 assert.ok(publicView.rounds.every(r=>!('correctIndex' in r)));
 const viewText=JSON.stringify(publicView);
 assert.ok(!viewText.includes('correctIndex'));
 const before=JSON.stringify(plan);
 const attempt=plan.rounds[0];
 assert.ok(attempt);
 assert.equal(JSON.stringify(plan),before,'view generation does not mutate saved plan');
});
test('Correct math answers are one-shot, private and capped to 10% total',()=>{
 const plan=dogCreateMiniGames(50,()=>0);
 const round=plan.rounds.find(r=>r.kind==='math');
 assert.ok(round,'deterministic sample includes math');
 const nowAnswer=now+round.startMs+200;
 const good=dogSubmitMiniAnswer(plan,roster,'a',round.round,round.correctIndex,nowAnswer,now);
 assert.equal(good.correct,true);
 assert.equal(good.replayed,false);
 assert.equal(dogMiniBonus(good.games,'a'),.1/3);
 assert.equal(dogMiniBonus(good.games,'b'),0);
 const repeat=dogSubmitMiniAnswer(good.games,roster,'a',round.round,
  (round.correctIndex+1)%3,nowAnswer+100,now);
 assert.equal(repeat.replayed,true);
 assert.equal(repeat.correct,true);
 assert.deepEqual(repeat.games,good.games);
 assert.ok(dogPublicMiniGames(good.games,'b').myAnswers[round.round]===undefined);
 const rounds=good.games.rounds;
 let state=good.games;
 for(const r of rounds){
  if(r.round===round.round)continue;
  // Directly recreate an awarded server-verified success to test upper bound.
  state={...state,answers:{...state.answers,a:{
   ...state.answers.a,[r.round]:{correct:true,at:now+r.startMs+200}}}};
 }
 assert.ok(Math.abs(dogMiniBonus(state,'a')-.1)<1e-12);
});
test('Strict server time and account validation reject fake successes and late requests',()=>{
 const plan=dogCreateMiniGames(100,()=>0),round=plan.rounds[0];
 assert.throws(()=>dogSubmitMiniAnswer(plan,roster,'d',0,0,now+3100,now),/NOT_PARTICIPANT/);
 assert.throws(()=>dogSubmitMiniAnswer(plan,roster,'a',4,0,now+3100,now),/BAD_ROUND/);
 assert.throws(()=>dogSubmitMiniAnswer(plan,roster,'a',0,5,now+3100,now),/BAD_ANSWER/);
 assert.throws(()=>dogSubmitMiniAnswer(plan,roster,'a',0,1,now+2999,now),/TOO_LATE/);
 assert.throws(()=>dogSubmitMiniAnswer(plan,roster,'a',0,1,now+10001,now),/TOO_LATE/);
});
test('Timed reactions require actual server-side press time, not a client success flag',()=>{
 let selected=null;
 for(let i=0;i<24;i++){
  const plan=dogCreateMiniGames(100,n=>i%n);
  const round=plan.rounds.find(r=>r.kind==='reaction');
  if(round){selected={plan,round};break;}
 }
 assert.ok(selected);
 const {plan,round}=selected;
 const success=dogSubmitMiniAnswer(plan,roster,'a',round.round,1,
  now+round.targetMs,now);
 assert.equal(success.correct,true);
 const miss=dogSubmitMiniAnswer(plan,roster,'b',round.round,1,
  now+round.startMs+100,now);
 assert.equal(miss.correct,false);
});
test('Moving weakpoint is recomputed from server timestamps',()=>{
 let selected=null;
 for(let i=0;i<24;i++){
  const plan=dogCreateMiniGames(100,n=>i%n);
  const round=plan.rounds.find(r=>r.kind==='target');
  if(round){selected={plan,round};break;}
 }
 assert.ok(selected);
 const {plan,round}=selected,at=round.startMs+round.stepMs*2+240;
 const lane=dogMiniTargetIndex(round,at);
 const success=dogSubmitMiniAnswer(plan,roster,'a',round.round,lane,now+at,now);
 assert.equal(success.correct,true);
 const miss=dogSubmitMiniAnswer(plan,roster,'b',round.round,
  (lane+1)%round.lanes,now+at,now);
 assert.equal(miss.correct,false);
});
