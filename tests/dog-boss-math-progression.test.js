import test from 'node:test';
import assert from 'node:assert/strict';
import {dogCreateMiniGames,dogPublicMiniGames,dogSubmitMiniAnswer,
 dogNormalizeMiniGames} from '../dog-boss-minigames.js';

const rng=seed=>n=>{
 seed=(Math.imul(seed,1664525)+1013904223)>>>0;
 return seed%n;
};
const roster=[{uid:'a'},{uid:'b'}];
const now=1_900_000_000_000;
const getMath=(gate,seed)=>dogCreateMiniGames(gate,rng(seed),{exchange:'endgame'});
function computed(question){
 const q=question.trim();
 let m;
 if(m=q.match(/^(\d+) \+ (\d+) = \?$/))return +m[1]+ +m[2];
 if(m=q.match(/^(\d+) − (\d+) = \?$/))return +m[1]- +m[2];
 if(m=q.match(/^(\d+) × (\d+) = \?$/))return +m[1]* +m[2];
 if(m=q.match(/^(\d+) ÷ (\d+) = \?$/))return +m[1]/ +m[2];
 if(m=q.match(/^(\d+) × (\d+) \+ (\d+) = \?$/))
  return +m[1]* +m[2]+ +m[3];
 if(m=q.match(/^\((\d+) \+ (\d+)\) × (\d+) = \?$/))
  return (+m[1]+ +m[2])* +m[3];
 if(m=q.match(/^\((\d+) × (\d+) \+ (\d+)\) ÷ (\d+) = \?$/))
  return (+m[1]* +m[2]+ +m[3])/ +m[4];
 throw Error('Unrecognized math puzzle '+q);
}
test('every new encounter has a strictly progressive eight-stage operation ladder',()=>{
 const ladder=[
  /^\d+ \+ \d+ = \?$/,
  /^\d+ \+ \d+ = \?$/,
  /^\d+ − \d+ = \?$/,
  /^\d+ × \d+ = \?$/,
  /^\d+ ÷ \d+ = \?$/,
  /^\d+ × \d+ \+ \d+ = \?$/,
  /^\(\d+ \+ \d+\) × \d+ = \?$/,
  /^\(\d+ × \d+ \+ \d+\) ÷ \d+ = \?$/
 ];
 for(const gate of [10,20,40,70,100])for(let seed=0;seed<30;seed++){
  const plan=getMath(gate,seed),round=plan.rounds.find(r=>r.kind==='math');
  assert.equal(round.maxSteps,8);
  assert.equal(round.puzzles.length,8);
  assert.equal(new Set(round.puzzles.map(p=>p.question)).size,8);
  round.puzzles.forEach((p,step)=>{
   assert.match(p.question,ladder[step],gate+' step '+step);
   assert.ok(Number.isInteger(computed(p.question)),'exact integer result');
   assert.equal(p.options[p.correctIndex],computed(p.question));
   assert.equal(new Set(p.options).size,3,'no duplicated or ambiguous choices');
   assert.ok(p.options.every(v=>Number.isInteger(v)&&v>=0&&v<=2000));
  });
  const safe=dogPublicMiniGames(plan,'a');
  assert.equal(safe.rounds[0].puzzles.length,8);
  assert.ok(safe.rounds[0].puzzles.every(p=>!('correctIndex'in p)),
   'no correct answer leaks to clients');
  const normalized=dogNormalizeMiniGames(plan);
  assert.deepEqual(normalized.rounds[0].puzzles,round.puzzles);
 }
});
test('later boss tiers use larger arithmetic operands while retaining same eight stages',()=>{
 for(const gate of [10,50,100]){
  const p=getMath(gate,111).rounds[0].puzzles;
  assert.equal(p.length,8);
 }
 const small=getMath(10,0).rounds[0].puzzles[1].question;
 const hard=getMath(100,0).rounds[0].puzzles[1].question;
 assert.ok(parseInt(hard,10)>parseInt(small,10),'later bosses scale operand size');
});
test('eight answers still use a single server-scored receipt and old battles normalize',()=>{
 let plan=getMath(10,17);
 const right=plan.rounds[0].puzzles.map(p=>p.correctIndex);
 const result=dogSubmitMiniAnswer(plan,roster,'a',0,right,now+7990,now,0);
 assert.equal(result.correctCount,8);
 assert.equal(result.games.answers.a[0].attempts.length,8);
 const partial=dogSubmitMiniAnswer(plan,roster,'b',0,right.slice(0,3),now+8001,now,0);
 assert.equal(partial.correctCount,3);
 const retry=()=>dogSubmitMiniAnswer(result.games,roster,'a',0,right,now+8010,now,0);
 assert.throws(retry,/STEP_ORDER/);
 const old=dogCreateMiniGames(10,rng(9),{exchange:'cinematic'});
 assert.equal(dogNormalizeMiniGames(old).version,4);
 assert.equal(dogPublicMiniGames(old,'a').rounds[0].puzzles.length,8);
});
