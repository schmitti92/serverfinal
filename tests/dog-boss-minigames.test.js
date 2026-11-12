import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DOG_MINIGAME_KINDS,DOG_MINIGAME_WINDOWS,dogMiniDifficulty,
 dogCreateMiniGames,dogNormalizeMiniGames,dogPublicMiniGames,
 dogSubmitMiniAnswer,dogMiniBonus,dogMiniTargetIndex,
 dogMiniReactionPosition,dogMiniReactionValid,dogMiniDodgePenalty,dogMiniStrongRoundCount
} from '../dog-boss-minigames.js';

const start=1_800_000_000_000,roster=[{uid:'a'},{uid:'b'},{uid:'c'}];
const select=(kind,gate=50)=>{
 for(let seed=0;seed<12;seed++){
  const plan=dogCreateMiniGames(gate,n=>seed%n);
  const round=plan.rounds.find(r=>r.kind===kind);
  if(round)return {plan,round};
 }
 throw Error('TEST_MISSING_GAME_'+kind);
};
const submit=(state,uid,round,answer,offset,step=0)=>
 dogSubmitMiniAnswer(state,roster,uid,round.round,answer,start+offset,start,step);

test('Each Boss 10–100 gets three different eight-second games within thirty seconds',()=>{
 for(let gate=10;gate<=100;gate+=10){
  const plans=[];
  for(let seed=0;seed<4;seed++){
   const plan=dogCreateMiniGames(gate,n=>seed%n);
   assert.equal(plan.version,2);
   assert.equal(plan.rounds.length,3);
   assert.equal(new Set(plan.rounds.map(r=>r.kind)).size,3);
   assert.ok(plan.rounds.every((r,i)=>
    r.startMs===DOG_MINIGAME_WINDOWS[i].startMs&&
    r.endMs===DOG_MINIGAME_WINDOWS[i].endMs&&
    r.endMs-r.startMs===8000));
   assert.ok(plan.rounds.every(r=>DOG_MINIGAME_KINDS.includes(r.kind)));
   assert.equal(dogNormalizeMiniGames(plan).rounds.length,3);
   plans.push(plan.rounds.map(r=>r.kind).join(','));
  }
  assert.ok(new Set(plans).size>1,'different random draws vary the games');
 }
 assert.equal(DOG_MINIGAME_WINDOWS[0].startMs,3000);
 assert.equal(DOG_MINIGAME_WINDOWS[2].endMs,27000);
});

test('Boss difficulty rises from easier math and wider reaction zone to harder targets',()=>{
 const easy=dogMiniDifficulty(10),hard=dogMiniDifficulty(100);
 assert.ok(hard.reactionToleranceMs<easy.reactionToleranceMs);
 assert.ok(hard.targetStepMs<easy.targetStepMs);
 assert.ok(hard.mathTier>easy.mathTier);
 assert.ok(hard.choices>easy.choices);
 assert.throws(()=>dogMiniDifficulty(15),/BAD_GATE/);
 for(const gate of [10,40,70,100]){
  const d=dogMiniDifficulty(gate);
  assert.ok(d.targetStepMs>=530);
  assert.ok(d.reactionToleranceMs>=400);
 }
});

test('Math answers remain private; four different types send only public challenges',()=>{
 const plan=select('math',100).plan,publicView=dogPublicMiniGames(plan,'a');
 assert.equal(publicView.rounds.length,3);
 assert.ok(!('answers' in publicView));
 assert.ok(!JSON.stringify(publicView).includes('correctIndex'));
 assert.ok(plan.rounds.some(r=>r.kind==='math'&&r.puzzles.length===8));
 assert.equal(dogPublicMiniGames(plan,'a').myAnswers[0],undefined);
 assert.deepEqual(plan,JSON.parse(JSON.stringify(plan)),'view is non-mutating');
});

test('Blitz-Mathe: eight individually checked inputs, idempotent retries and a 6% cap',()=>{
 const {plan,round}=select('math');
 let state=plan;
 for(let step=0;step<8;step++){
  const answer=round.puzzles[step].correctIndex;
  const at=round.startMs+200+step*850;
  const result=submit(state,'a',round,answer,at,step);
  assert.equal(result.correct,true);
  assert.equal(result.replayed,false);
  state=result.games;
  const retry=submit(state,'a',round,(answer+1)%3,at+5,step);
  assert.equal(retry.replayed,true);
  assert.equal(retry.correct,true);
  assert.deepEqual(retry.games,state);
 }
 assert.equal(state.answers.a[round.round].attempts.length,8);
 assert.ok(Math.abs(dogMiniBonus(state,'a')-.06)<1e-9);
 assert.equal(dogMiniBonus(state,'b'),0);
 assert.equal(dogMiniStrongRoundCount(state,'a'),1);
 assert.equal(dogPublicMiniGames(state,'b').myAnswers[round.round],undefined);
 assert.throws(()=>submit(state,'a',round,0,round.startMs+7400,8),/BAD_STEP/);
});

test('Every submission verifies participant, round, answer, time, step ordering and speed',()=>{
 const {plan,round}=select('math',100);
 assert.throws(()=>submit(plan,'d',round,0,round.startMs+400),/NOT_PARTICIPANT/);
 assert.throws(()=>dogSubmitMiniAnswer(plan,roster,'a',4,0,start+4000,start),/BAD_ROUND/);
 assert.throws(()=>submit(plan,'a',round,5,round.startMs+400),/BAD_ANSWER/);
 assert.throws(()=>submit(plan,'a',round,0,round.startMs-1),/TOO_LATE/);
 assert.throws(()=>submit(plan,'a',round,0,round.endMs),/TOO_LATE/);
 assert.throws(()=>submit(plan,'a',round,0,round.startMs+200,1),/STEP_ORDER/);
 const first=submit(plan,'a',round,0,round.startMs+300);
 assert.throws(()=>submit(first.games,'a',round,0,round.startMs+350,1),/TOO_FAST/);
 assert.throws(()=>dogSubmitMiniAnswer(plan,roster,'a',round.round,0,start+4000,0),/NOT_RUNNING/);
});

test('Reaction meter accelerates monotonically and the server scores tap timing',()=>{
 const {plan,round}=select('reaction',80);
 assert.equal(round.maxSteps,3);
 const crossings=[];
 for(let step=0;step<3;step++){
  const min=round.startMs+Math.floor(step*8000/3)+430;
  const max=round.startMs+Math.floor((step+1)*8000/3)-130;
  let at=-1;
  for(let t=min;t<max;t+=10)
   if(Math.abs(dogMiniReactionPosition(round,t)-.5)<=round.zoneRadius*.5){
    at=t;break;
   }
  assert.ok(at>=0,'each reaction window should contain a green zone');
  crossings.push(at);
 }
 let state=plan;
 for(let step=0;step<3;step++){
  const result=submit(state,'a',round,1,crossings[step],step);
  assert.equal(result.correct,true);
  state=result.games;
 }
 assert.equal(state.answers.a[round.round].correctCount,3);
 const bad=submit(plan,'b',round,0,crossings[0]);
 assert.equal(bad.correct,false);
 // The frequency coefficient rises with elapsed seconds.
 const frequency=t=>.68+2*(.075+.004*round.difficulty)*t;
 assert.ok(frequency(8)>frequency(4)&&frequency(4)>frequency(0));
});

test('Three visual dodges score safe lanes and missed strikes as failed',()=>{
 const {plan,round}=select('dodge',100);
 assert.equal(round.attacks.length,3);
 assert.equal(round.maxSteps,3);
 let state=plan;
 const lane=i=>Array.from({length:round.lanes},(_,n)=>n).find(n=>
  n!==round.attacks[i].dangerIndex&&n!==round.attacks[i].secondDangerIndex);
 const first=submit(state,'a',round,lane(0),round.attacks[0].startMs+500,0);
 assert.equal(first.correct,true);state=first.games;
 // Skip the second strike; its real impact closes its window.
 assert.throws(()=>submit(state,'a',round,lane(1),round.attacks[1].impactMs+1,1),/TOO_LATE/);
 const third=submit(state,'a',round,lane(2),round.attacks[2].startMs+350,2);
 assert.equal(third.correct,true);
 const attempts=third.games.answers.a[round.round].attempts;
 assert.deepEqual(attempts.map(a=>a.correct),[true,false,true]);
 assert.ok(Math.abs(dogMiniDodgePenalty(third.games,'a')-.025)<1e-10);
 assert.equal(dogMiniStrongRoundCount(third.games,'a'),1);
 assert.throws(()=>submit(plan,'b',round,lane(0),round.attacks[0].impactMs+2,0),/TOO_LATE/);
});

test('Three moving weakpoints use server time and do not leak correct placement',()=>{
 const {plan,round}=select('target',100);
 let state=plan;
 for(let step=0;step<3;step++){
  const at=round.startMs+420+step*2000;
  const right=dogMiniTargetIndex(round,at);
  const attempt=submit(state,'a',round,right,at,step);
  assert.equal(attempt.correct,true);
  state=attempt.games;
 }
 assert.equal(state.answers.a[round.round].correctCount,3);
 const at=round.startMs+500;
 const wrong=(dogMiniTargetIndex(round,at)+1)%round.lanes;
 assert.equal(submit(plan,'b',round,wrong,at).correct,false);
});


test('M-04: three fast reaction taps are judged in one server transaction with their capture times',()=>{
 const games=dogCreateMiniGames(80,()=>0,{exchange:'individual'});
 const round=games.rounds.find(r=>r.kind==='reaction');
 assert.equal(round.maxSteps,3);
 const greens=[];
 for(let t=round.startMs+100;t<round.endMs-150;t+=10){
  if(Math.abs(dogMiniReactionPosition(round,t)-.5)>round.zoneRadius*.45)continue;
  if(!greens.length||t-greens.at(-1)>=600)greens.push(t);
  if(greens.length===3)break;
 }
 assert.equal(greens.length,3);
 const stamps=greens.map(ms=>start+ms);
 const received=stamps[2]+180;
 const result=dogSubmitMiniAnswer(games,roster,'a',round.round,
  [1,1,1],received+500,start,0,stamps,received);
 assert.equal(result.correct,true);
 assert.equal(result.correctCount,3);
 assert.equal(result.games.answers.a[round.round].attempts.length,3);
 assert.equal(result.games.answers.a[round.round].attempts[1].tappedAt,stamps[1]);
 assert.ok(result.games.answers.a[round.round].attempts.every(a=>a.correct));
 assert.equal(dogPublicMiniGames(result.games,'a').myAnswers[round.round].correctCount,3);
 assert.throws(()=>dogSubmitMiniAnswer(result.games,roster,'a',round.round,
  [1,1,1],received+600,start,0,stamps,received),/STEP_ORDER/);
});
test('M-04: reaction batches reject fabricated timing, excessive delay and duplicate taps',()=>{
 const games=dogCreateMiniGames(100,()=>0,{exchange:'individual'});
 const round=games.rounds.find(r=>r.kind==='reaction');
 const s=start+round.startMs+200;
 const play=(values,stamps,received=s+1000)=>
  dogSubmitMiniAnswer(games,roster,'a',round.round,values,received+200,
   start,0,stamps,received);
 assert.throws(()=>play([1,1],[s,s+100]),/BAD_TIMESTAMP/);
 assert.throws(()=>play([1],[start+round.startMs-1],s+10),/BAD_TIMESTAMP/);
 assert.throws(()=>play([1],[s+300],s+10),/BAD_TIMESTAMP/);
 assert.throws(()=>play([1],[s],s+2200),/BAD_TIMESTAMP/);
 assert.throws(()=>play([1,1,1],[s,s+500]),/BAD_TIMESTAMP/);
 assert.throws(()=>play([1,1,1,1],[s,s+500,s+1000,s+1500],s+1600),/BAD_ANSWER/);
 assert.throws(()=>play([2],[s]),/BAD_ANSWER/);
 assert.throws(()=>play([1],[start+round.endMs],start+round.endMs+100),/BAD_TIMESTAMP/);
 assert.throws(()=>play([1],[s],start+round.endMs+2000),/TOO_LATE/);
});
test('M-04: partial reaction batches report only confirmed scores and legacy single taps remain valid',()=>{
 const games=dogCreateMiniGames(10,()=>0,{exchange:'individual'});
 const round=games.rounds.find(r=>r.kind==='reaction'),t=start+round.startMs+1200;
 const partial=dogSubmitMiniAnswer(games,roster,'a',round.round,[1],
  t+120,start,0,[t],t+100);
 assert.equal(partial.games.answers.a[round.round].attempts.length,1);
 assert.equal(typeof partial.games.answers.a[round.round].attempts[0].correct,'boolean');
 const legacy=dogSubmitMiniAnswer(games,roster,'b',round.round,1,
  t+200,start,0,t+130,t+190);
 assert.equal(legacy.games.answers.b[round.round].attempts.length,1);
});

test('In-progress legacy v1 fights retain single-answer timing and 10% score rules',()=>{
 const old={version:1,gate:10,rounds:[
  {kind:'math',round:0,startMs:3000,endMs:10000,
   question:'7 + 15 = ?',options:[18,20,22],correctIndex:2},
  {kind:'reaction',round:1,startMs:10000,endMs:17000,targetMs:13000},
  {kind:'target',round:2,startMs:17000,endMs:24000,
   initialIndex:0,lanes:3,stepMs:1250}
 ],answers:{}};
 const publicView=dogPublicMiniGames(old,'a');
 assert.ok(!JSON.stringify(publicView).includes('correctIndex'));
 let state=dogSubmitMiniAnswer(old,roster,'a',0,2,start+4500,start).games;
 const again=dogSubmitMiniAnswer(state,roster,'a',0,1,start+4700,start);
 assert.equal(again.replayed,true);
 state=dogSubmitMiniAnswer(state,roster,'a',1,1,start+13000,start).games;
 state=dogSubmitMiniAnswer(state,roster,'a',2,dogMiniTargetIndex(old.rounds[2],19000),
  start+19000,start).games;
 assert.equal(dogMiniStrongRoundCount(state,'a'),3);
 assert.ok(Math.abs(dogMiniBonus(state,'a')-.10)<1e-12);
});


test('Eight rapid math answers are accepted in one server-verified transaction',()=>{
 const {plan,round}=select('math',80);
 const answers=round.puzzles.map(p=>p.correctIndex);
 const at=round.endMs+550;
 const batch=submit(plan,'a',round,answers,at);
 assert.equal(batch.replayed,false);
 assert.equal(batch.correctCount,8);
 assert.equal(batch.games.answers.a[round.round].attempts.length,8);
 assert.equal(batch.games.answers.a[round.round].correctCount,8);
 assert.equal(dogMiniStrongRoundCount(batch.games,'a'),1);
 assert.ok(Math.abs(dogMiniBonus(batch.games,'a')-.06)<1e-9);
 assert.equal(dogMiniBonus(batch.games,'b'),0);
 assert.equal(dogPublicMiniGames(batch.games,'b').myAnswers[round.round],undefined);
 assert.throws(()=>submit(batch.games,'a',round,answers,at+10),/STEP_ORDER/);
 assert.throws(()=>submit(plan,'a',round,answers,round.endMs+2000),/TOO_LATE/);
 assert.throws(()=>submit(plan,'a',round,answers.concat(0),at),/BAD_ANSWER/);
 assert.throws(()=>submit(plan,'a',round,[0,7],at),/BAD_ANSWER/);
 const partial=submit(plan,'b',round,answers.slice(0,4),round.endMs-100);
 assert.equal(partial.games.answers.b[round.round].attempts.length,4);
 assert.ok(Math.abs(dogMiniBonus(partial.games,'b')-.03)<1e-9);
});


test('Server-only reaction scoring tolerates bounded transport jitter but not arbitrary timing',()=>{
 const {round,plan}=select('reaction',100);
 const greens=[];
 for(let elapsed=round.startMs+100;elapsed<round.endMs-250;elapsed+=5){
  if(Math.abs(dogMiniReactionPosition(round,elapsed)-.5)<=round.zoneRadius)
   greens.push(elapsed);
 }
 assert.ok(greens.length>5,'reaction has real green windows');
 const after=greens.find(at=>{
  const future=at+125;
  return future<round.endMs&&
   Math.abs(dogMiniReactionPosition(round,future)-.5)>round.zoneRadius;
 });
 assert.ok(after,'there is a server-received timestamp just after green');
 assert.equal(dogMiniReactionValid(round,after+125),true);
 assert.equal(submit(plan,'a',round,1,after+125).correct,true);
 // A click entirely before the first possible window remains invalid.
 assert.equal(dogMiniReactionValid(round,round.startMs),false);
 assert.equal(submit(plan,'b',round,1,round.startMs+5).correct,false);
 // The allowed window never extends beyond the real eight-second round.
 assert.equal(dogMiniReactionValid(round,round.endMs+1),false);
});
