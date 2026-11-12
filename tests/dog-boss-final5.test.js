import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DOG_FINAL5_WINDOWS,DOG_FINAL5_DURATION_MS,DOG_CHAIN20_WINDOWS,DOG_CHAIN20_DURATION_MS,
 dogCreateMiniGames,dogNormalizeMiniGames,dogPublicMiniGames,
 dogMiniBonus,dogMiniExchangeView,dogMiniBossLiveHp,dogMiniConfirmedStrikes,
 dogSubmitMiniAnswer
} from '../dog-boss-minigames.js';
import {dogGroupBossHp} from '../dog-balance.js';
import {boss10ResolveCombat,boss10DamagePotential,boss10Ready} from '../dog-boss10.js';

const now=1_900_000_000_000;
const team=[
 {uid:'a',weaponLevel:1,armorLevel:1,skillPower:5,skillDestruction:5,skillDefense:5,skillGuard:5},
 {uid:'b',weaponLevel:1,armorLevel:1,skillPower:5,skillDestruction:5,skillDefense:5,skillGuard:5},
 {uid:'c',weaponLevel:1,armorLevel:1,skillPower:5,skillDestruction:5,skillDefense:5,skillGuard:5}
];
const full=()=>dogCreateMiniGames(10,()=>0,{exchange:'individual'});
const single=hero=>boss10DamagePotential([hero],[],null);
const base=boss10DamagePotential(team,[],null);
const maxHp=dogGroupBossHp(10);

test('Every new expedition has five correctly clocked challenges and a final 14-second three-hero attack',()=>{
 const game=full();
 assert.equal(game.version,14);
 assert.equal(game.rounds.length,5);
 assert.deepEqual(game.rounds.map(x=>x.kind),['math','dodge','target','reaction','chain']);
 assert.deepEqual(game.rounds.map(r=>[r.startMs,r.endMs]),
  DOG_CHAIN20_WINDOWS.map(r=>[r.startMs,r.endMs]));
 assert.deepEqual([game.rounds[4].startMs,game.rounds[4].endMs,DOG_CHAIN20_DURATION_MS],
  [101000,121000,135000]);
 assert.equal(dogNormalizeMiniGames(game).rounds.length,5);
 assert.equal(dogMiniExchangeView(game,team,125000).durationMs,135000);
 const hits=dogMiniConfirmedStrikes(game,team,121000,maxHp,base,single,m=>145);
 const closing=hits.filter(x=>x.round===4);
 assert.equal(closing.length,3);
 assert.deepEqual(closing.map(x=>x.uid),['a','b','c']);
 assert.ok(closing.every(x=>x.kind==='hero-strike'&&x.atMs>121000&&x.atMs<132000));
});

test('The final strike is a genuine +5% equipment-based bonus; results are private until stage completion',()=>{
 let games=full(),last=games.rounds[4];
 assert.equal(last.puzzles.length,10);
 const p=dogPublicMiniGames(games,'a');
 assert.equal(p.rounds.length,5);
 assert.equal(p.rounds[4].puzzles.length,10);
 assert.ok(!JSON.stringify(p).includes('correctIndex'));
 const choices=last.puzzles.map(q=>q.correctIndex);
 games=dogSubmitMiniAnswer(games,team,'a',4,choices,now+last.endMs+100,now,0).games;
 assert.equal(games.answers.a[4].correctCount,10);
 assert.equal(dogMiniBonus(games,'a'),.05);
 assert.equal(dogMiniBonus(games,'b'),0);
 const before=dogMiniExchangeView(games,team,last.endMs-1,single,()=>145);
 assert.equal(before.stages[4].completed,false);
 assert.equal(before.stages[4].playerResults,null);
 const after=dogMiniExchangeView(games,team,last.endMs,single,()=>145);
 assert.equal(after.stages[4].completed,true);
 assert.deepEqual(after.stages[4].playerResults.map(r=>r.correct),[10,0,0]);
 assert.ok(after.stages[4].playerResults[0].bonusDamage>0);
 assert.equal(after.stages[4].playerResults[1].bonusDamage,0);
 assert.equal(after.stages[4].playerResults[2].bonusDamage,0);
 assert.equal(after.cumulativeExtraDamage,after.stages[4].bonusDamage);
 assert.ok(dogMiniBossLiveHp(games,team,last.endMs,maxHp,base,
  after.cumulativeExtraDamage)<
  dogMiniBossLiveHp(games,team,last.endMs-1,maxHp,base,0));
 const without=boss10ResolveCombat(team,[],()=>5000,full());
 const withBonus=boss10ResolveCombat(team,[],()=>5000,games);
 assert.ok(withBonus.damage>without.damage,'finale boosts the actual server result');
});

test('Existing stored v11 four-round encounters remain readable and terminate after 101 seconds',()=>{
 const v12=full();
 const old={...v12,version:11,rounds:v12.rounds.slice(0,4),answers:{}};
 assert.equal(dogNormalizeMiniGames(old).rounds.length,4);
 assert.equal(dogMiniExchangeView(old,team,101000).durationMs,101000);
 assert.deepEqual(dogMiniConfirmedStrikes(old,team,87000,maxHp,base,single,()=>145)
  .filter(x=>x.round===4),[]);
 assert.ok(dogPublicMiniGames(old,'a'));
});

test('v12 stored rune ending stays valid even after the new chain-breaker rollout',()=>{
 const old=dogCreateMiniGames(10,()=>0,{exchange:'individual-runes'});
 assert.equal(old.version,12);
 assert.equal(old.rounds[4].kind,'target');
 assert.equal(dogNormalizeMiniGames(old).rounds[4].kind,'target');
 assert.equal(dogPublicMiniGames(old,'a').rounds[4].puzzles.length,10);
 const current=full();
 assert.equal(current.version,14);
 assert.equal(current.rounds[4].kind,'chain');
 assert.ok(!JSON.stringify(dogPublicMiniGames(current,'a')).includes('correctIndex'));
 const published=dogPublicMiniGames(current,'a').rounds[4];
 assert.equal(published.puzzles[0].target,current.rounds[4].puzzles[0].target);
});
test('Forged chain targets are rejected and cannot mint extra damage',()=>{
 const game=full();
 const invalid={...game,rounds:game.rounds.map((r,i)=>i===4?{
  ...r,puzzles:r.puzzles.map((p,n)=>n===0?{...p,target:99}:p)
 }:r)};
 assert.equal(dogNormalizeMiniGames(invalid),null);
 const bogus={...game,rounds:game.rounds.map((r,i)=>i===4?{
  ...r,lanes:0
 }:r)};
 assert.equal(dogNormalizeMiniGames(bogus),null);
 assert.throws(()=>dogSubmitMiniAnswer(game,team,'a',4,[99],now+111100,now,0),
  /BAD_ANSWER/);
});
test('v13 chains keep 10-second windows after v14 extends new encounters',()=>{
 const previous=dogCreateMiniGames(10,()=>0,{exchange:'individual-chain10'});
 assert.equal(previous.version,13);
 assert.equal(previous.rounds[4].endMs,111000);
 assert.equal(dogNormalizeMiniGames(previous).rounds[4].endMs,111000);
 assert.equal(dogMiniExchangeView(previous,team,115000).durationMs,125000);
 assert.equal(DOG_FINAL5_DURATION_MS,125000);
 assert.deepEqual(previous.rounds.map(r=>[r.startMs,r.endMs]),
  DOG_FINAL5_WINDOWS.map(r=>[r.startMs,r.endMs]));
});
test('Fifth stage is only answerable in its own server-clock window',()=>{
 const games=full(),final=games.rounds[4],answers=final.puzzles.map(x=>x.correctIndex);
 assert.throws(()=>dogSubmitMiniAnswer(games,team,'a',4,answers,
  now+final.startMs-1,now,0),/TOO_LATE/);
 assert.throws(()=>dogSubmitMiniAnswer(games,team,'a',4,answers,
  now+final.endMs+2000,now,0),/TOO_LATE/);
});


const scoreGame=(version='individual',actorCounts={})=>{
 const game=dogCreateMiniGames(10,()=>0,{exchange:version});
 const answers=Object.fromEntries(Object.entries(actorCounts).map(([uid,counts])=>
  [uid,Object.fromEntries(game.rounds.map((round,index)=>{
   const allowed=round.maxSteps;
   const count=Math.max(0,Math.min(allowed,counts[index]??0));
   return [index,{attempts:Array.from({length:allowed},(_,step)=>({
    step,correct:step<count,at:now+round.endMs-80
   }))}];
  }))]));
 return {...game,answers};
};
test('M-06: five uneven-length games are equally weighted AFTER individual 0–100 normalization',()=>{
 // Math: 4/8; dodge: 3/3; colors: 5/10; reaction: 2/3; chains: 7/10.
 const game=scoreGame('individual',{a:[4,3,5,2,7],b:[8,3,10,3,10],c:[0,0,0,0,0]});
 const result=dogMiniExchangeView(game,team,game.rounds.at(-1).endMs).evaluation;
 assert.ok(result);
 assert.equal(result.weighting,'equal');
 assert.equal(result.weightPercentPerGame,20);
 assert.equal(result.completedRounds,5);
 assert.deepEqual(result.rounds.map(x=>x.max),[24,9,30,9,30]);
 assert.deepEqual(result.rounds.map(x=>x.players[0].percent),
  [50,100,50,66.7,70]);
 assert.equal(result.players.find(p=>p.uid==='a').percent,67.3);
 assert.equal(result.players.find(p=>p.uid==='b').percent,100);
 assert.equal(result.players.find(p=>p.uid==='c').percent,0);
 assert.equal(result.teamPercent,55.8);
 assert.equal(result.perfect,false);
});
test('M-06: 100 percent requires every single answer of every game by every player',()=>{
 const all={a:[8,3,10,3,10],b:[8,3,10,3,10],c:[8,3,10,3,10]};
 const perfect=scoreGame('individual',all);
 const last=perfect.rounds.at(-1);
 const complete=dogMiniExchangeView(perfect,team,last.endMs).evaluation;
 assert.equal(complete.teamPercent,100);
 assert.equal(complete.perfect,true);
 assert.ok(complete.players.every(p=>p.percent===100&&p.perfect));
 assert.ok(complete.rounds.every(r=>r.percent===100));
 // One missing chain cut is not concealed by rounded totals or 3 other perfect heroes.
 const imperfect=scoreGame('individual',{...all,a:[8,3,10,3,9]});
 const reduced=dogMiniExchangeView(imperfect,team,last.endMs).evaluation;
 assert.equal(reduced.players[0].percent,98);
 assert.equal(reduced.players[0].perfect,false);
 assert.equal(reduced.players[1].percent,100);
 assert.equal(reduced.teamPercent,99.3);
 assert.equal(reduced.perfect,false);
});
test('M-06: only closed stages reveal normalized scores; no provisional final grade',()=>{
 const game=scoreGame('individual',{a:[8,3,10,3,10]});
 const first=dogMiniExchangeView(game,team,game.rounds[0].endMs-1).evaluation;
 assert.equal(first.completedRounds,0);
 assert.equal(first.teamPercent,null);
 assert.equal(first.players,null);
 assert.ok(first.rounds.every(r=>r.percent===null&&r.players===null));
 const second=dogMiniExchangeView(game,team,game.rounds[0].endMs).evaluation;
 assert.equal(second.completedRounds,1);
 assert.equal(second.rounds[0].players[0].percent,100);
 assert.equal(second.rounds[1].percent,null);
 assert.equal(second.teamPercent,null);
 assert.equal(second.perfect,null);
 const empty=dogMiniExchangeView(scoreGame('individual'),team,game.rounds.at(-1).endMs).evaluation;
 assert.equal(empty.teamPercent,0);
 assert.equal(empty.perfect,false);
});
test('M-06: existing combat rewards, armor and damage remain unchanged',()=>{
 const game=scoreGame('individual',{a:[8,3,10,3,10],b:[8,3,10,3,10],c:[8,3,10,3,10]});
 const round=game.rounds.at(-1);
 const exchange=dogMiniExchangeView(game,team,round.endMs,single,()=>145);
 assert.equal(exchange.evaluation.teamPercent,100);
 assert.equal(exchange.shield,100);
 assert.equal(exchange.stages[0].bonusPercent,6);
 assert.equal(exchange.stages[2].bonusPercent,3);
 assert.equal(exchange.stages[4].bonusPercent,5);
 assert.equal(dogMiniBonus(game,'a'),.14);
 assert.equal(exchange.cumulativeExtraDamage,
  exchange.stages.filter(s=>!s.defensive).reduce((sum,s)=>sum+(s.bonusDamage||0),0));
 const old=scoreGame('individual-runes',{a:[8,3,10,3,10]});
 assert.ok(dogMiniExchangeView(old,team,old.rounds.at(-1).endMs).evaluation,
  'stored five-game rune battles still get equal-weight accuracy');
 const v11={...game,version:11,rounds:game.rounds.slice(0,4),answers:{}};
 assert.equal(dogMiniExchangeView(v11,team,101000).evaluation,undefined,
  'historical four-round battles keep their old presentation');
});
test('M-06: a fallen v15 hero cannot earn a fictitious perfect fifth-game grade',()=>{
 const game=scoreGame('individual-lethal',{
  a:[8,0,10,0,10],b:[8,3,10,3,10],c:[8,3,10,3,10]});
 const evaluation=dogMiniExchangeView(game,team,game.rounds.at(-1).endMs).evaluation;
 assert.equal(evaluation.rounds[4].players[0].fallen,true);
 assert.equal(evaluation.rounds[4].players[0].percent,0);
 assert.ok(evaluation.players[0].percent<100);
 assert.equal(evaluation.perfect,false);
});
