import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DOG_EXCHANGE_WINDOWS,DOG_CINEMATIC_WINDOWS,DOG_ENDGAME_WINDOWS,DOG_EXTENDED_ENDGAME_WINDOWS,DOG_SHOW_ENDGAME_WINDOWS,DOG_SLOW_DODGE_ENDGAME_WINDOWS,dogCreateMiniGames,dogNormalizeMiniGames,
 dogPublicMiniGames,dogSubmitMiniAnswer,dogMiniTargetIndex,
 dogMiniReactionPosition,dogMiniTeamShield,dogMiniExchangeView,
 dogMiniBonus,dogMiniStrongRoundCount
} from '../dog-boss-minigames.js';
import {DOG_BOSS10_DURATION_MS,boss10DamagePotential} from '../dog-boss10.js';

const now=1_900_000_000_000;
const roster=[{uid:'a'},{uid:'b'},{uid:'c'}];
const make=()=>dogCreateMiniGames(10,()=>0,{exchange:true});
const names=['math','dodge','target','reaction'];
const submit=(games,uid,i,step,answer,offset)=>{
 const result=dogSubmitMiniAnswer(games,roster,uid,i,answer,now+offset,now,step);
 assert.equal(result.replayed,false);
 return result.games;
};
function solveAll(start){
 let games=start;
 for(const uid of ['a','b','c']){
  for(const round of games.rounds){
   if(round.kind==='math'){
    games=submit(games,uid,round.round,0,
     round.puzzles.map(p=>p.correctIndex),round.endMs+100);
   }else if(round.kind==='dodge'){
    for(const attack of round.attacks){
     const safe=Array.from({length:round.lanes},(_,i)=>i).find(i=>
      i!==attack.dangerIndex&&i!==attack.secondDangerIndex);
     games=submit(games,uid,round.round,attack.step,safe,attack.startMs+400);
    }
   }else if(round.kind==='target'){
    for(let step=0;step<3;step++){
     const at=round.startMs+400+step*2000;
     games=submit(games,uid,round.round,step,dogMiniTargetIndex(round,at),at);
    }
   }else{
    for(let step=0;step<3;step++){
     const begin=round.startMs+Math.floor(step*8000/3)+430;
     const end=round.startMs+Math.floor((step+1)*8000/3)-220;
     let at=-1;
     for(let tick=begin;tick<end;tick+=10)
      if(Math.abs(dogMiniReactionPosition(round,tick)-.5)<=round.zoneRadius*.5){
       at=tick;break;
      }
     assert.ok(at>0,'each reaction sub-window has a valid green crossing');
     games=submit(games,uid,round.round,step,1,at);
    }
   }
  }
 }
 return games;
}
test('New encounter has four fixed phases and exactly four 2s exchanges in 40s',()=>{
 const games=make();
 assert.equal(DOG_BOSS10_DURATION_MS,99000);
 assert.equal(games.version,3);
 assert.deepEqual(games.rounds.map(r=>r.kind),names);
 assert.deepEqual(games.rounds.map(r=>[r.startMs,r.endMs]),
  DOG_EXCHANGE_WINDOWS.map(r=>[r.startMs,r.endMs]));
 assert.ok(games.rounds.every(r=>r.endMs-r.startMs===8000));
 for(const r of games.rounds)assert.ok(r.maxSteps>0);
 assert.deepEqual(dogNormalizeMiniGames(games).rounds.map(r=>r.kind),names);
 assert.equal(dogCreateMiniGames(10,()=>0).version,2,
  'In-progress older 3-round fights retain the existing formatter');
});
test('Initial shield is 100; two unanswered defenses can consume 25 each',()=>{
 const plan=make();
 assert.equal(dogMiniExchangeView(plan,roster,1000).shield,100);
 assert.equal(dogMiniExchangeView(plan,roster,18000).shield,75);
 assert.equal(dogMiniExchangeView(plan,roster,38000).shield,50);
 assert.equal(dogMiniExchangeView(plan,roster,39900).shield,50);
 assert.equal(dogMiniTeamShield(plan,roster),50);
 const stages=dogMiniExchangeView(plan,roster,39000).stages;
 assert.equal(stages[0].defensive,false);
 assert.equal(stages[1].defensive,true);
 assert.equal(stages[2].defensive,false);
 assert.equal(stages[3].defensive,true);
 assert.equal(stages[1].shield,75);
 assert.equal(stages[3].shield,50);
});
test('All 3 players can complete all four phases; shield and bonuses remain server verified',()=>{
 const games=solveAll(make());
 const report=dogMiniExchangeView(games,roster,40000);
 assert.equal(report.shield,100);
 assert.deepEqual(report.stages.map(x=>x.completed),[true,true,true,true]);
 assert.deepEqual(report.stages.map(x=>x.correct),[24,9,9,9]);
 assert.deepEqual(report.stages.map(x=>x.max),[24,9,9,9]);
 assert.equal(report.stages[0].bonusPercent,6);
 assert.equal(report.stages[1].shield,100);
 assert.equal(report.stages[2].bonusPercent,3);
 assert.equal(report.stages[3].shield,100);
 for(const uid of ['a','b','c']){
  assert.ok(Math.abs(dogMiniBonus(games,uid)-.09)<1e-9);
  assert.equal(dogMiniStrongRoundCount(games,uid),4);
  const publicView=dogPublicMiniGames(games,uid);
  assert.ok(!JSON.stringify(publicView).includes('correctIndex'));
  assert.equal(Object.keys(publicView.myAnswers).length,4);
 }
 const missing=dogMiniExchangeView(games,roster,9000);
 assert.equal(missing.stages[0].correct,24);
 assert.equal(missing.stages[1].completed,false);
});
test('Shield is meaningful but does not outweigh the party equipment or leak data',()=>{
 const weak=[{uid:'a',weaponLevel:1,armorLevel:1,skillPower:0,skillDestruction:0,skillDefense:0,skillGuard:0}];
 const shielded=make();
 const missed=dogMiniTeamShield(shielded,weak);
 assert.equal(missed,50);
 const prepared=[{uid:'a',weaponLevel:1,armorLevel:1,skillPower:5,skillDestruction:5,skillDefense:5,skillGuard:5}];
 assert.ok(boss10DamagePotential(prepared,[],solveAll(make()))>
  boss10DamagePotential(prepared,[],make()));
 assert.ok(boss10DamagePotential(prepared,[],make())>
  boss10DamagePotential(weak,[],make()));
 assert.equal(dogMiniExchangeView(make(),roster,1000).stages.length,4);
});


test('50s cinematic encounters preserve all 4x8s tasks and add four 4.5s pauses',()=>{
 const cinema=dogCreateMiniGames(10,()=>0,{exchange:'cinematic'});
 const old=dogCreateMiniGames(10,()=>0,{exchange:true});
 assert.equal(DOG_BOSS10_DURATION_MS,99000);
 assert.equal(cinema.version,4);
 assert.equal(old.version,3);
 assert.deepEqual(cinema.rounds.map(x=>[x.startMs,x.endMs]),
  [[0,8000],[12500,20500],[25000,33000],[37500,45500]]);
 assert.deepEqual(cinema.rounds.map(x=>[x.startMs,x.endMs]),
  DOG_CINEMATIC_WINDOWS.map(x=>[x.startMs,x.endMs]));
 for(const round of cinema.rounds)assert.equal(round.endMs-round.startMs,8000);
 assert.deepEqual(cinema.rounds.map((r,i)=>{
  const next=cinema.rounds[i+1];
  return (next?.startMs??50000)-r.endMs;
 }),[4500,4500,4500,4500]);
 assert.equal(dogNormalizeMiniGames(cinema).version,4);
 assert.deepEqual(dogNormalizeMiniGames(old).rounds.map(r=>r.startMs),
  DOG_EXCHANGE_WINDOWS.map(r=>r.startMs));
 assert.equal(dogMiniExchangeView(cinema,roster,22000).durationMs,50000);
 assert.equal(dogMiniExchangeView(old,roster,22000).durationMs,40000);
});

test('Equipment-derived extra attack potential is per phase, cumulative and private until completion',()=>{
 const cinematic=solveAll(dogCreateMiniGames(10,()=>0,{exchange:'cinematic'}));
 const potentialPerHero=hero=>hero.uid==='a'?1100:hero.uid==='b'?1500:1900;
 const before=dogMiniExchangeView(cinematic,roster,6000,potentialPerHero);
 assert.equal(before.stages[0].completed,false);
 assert.equal(before.stages[0].correct,null);
 assert.equal(before.stages[0].bonusDamage,null);
 assert.equal(before.cumulativeExtraDamage,0);
 const hit1=dogMiniExchangeView(cinematic,roster,9000,potentialPerHero);
 assert.equal(hit1.stages[0].correct,24);
 assert.equal(hit1.stages[0].max,24);
 assert.equal(hit1.stages[0].bonusPercent,6);
 assert.equal(hit1.stages[0].bonusDamage,270);
 assert.equal(hit1.cumulativeExtraDamage,270);
 assert.equal(hit1.stages[2].bonusDamage,null);
 const block=dogMiniExchangeView(cinematic,roster,22000,potentialPerHero);
 assert.equal(block.stages[1].shield,100);
 assert.equal(block.cumulativeExtraDamage,270);
 const hit2=dogMiniExchangeView(cinematic,roster,34500,potentialPerHero);
 assert.equal(hit2.stages[2].bonusPercent,3);
 assert.equal(hit2.stages[2].bonusDamage,135);
 assert.equal(hit2.cumulativeExtraDamage,405);
 const final=dogMiniExchangeView(cinematic,roster,50000,potentialPerHero);
 assert.equal(final.shield,100);
 assert.equal(final.cumulativeExtraDamage,405);
 assert.ok(!JSON.stringify(dogPublicMiniGames(cinematic,'a')).includes('correctIndex'));
 assert.equal(dogMiniBonus(cinematic,'a'),.09);
});

test('50s cinematic shield penalties still affect combat without inventing final HP',()=>{
 const plan=dogCreateMiniGames(10,()=>0,{exchange:'cinematic'});
 assert.equal(dogMiniTeamShield(plan,roster),50);
 assert.equal(dogMiniExchangeView(plan,roster,39000).shield,75);
 assert.equal(dogMiniExchangeView(plan,roster,50000).shield,50);
 const equipped=[{uid:'a',weaponLevel:1,armorLevel:1,
  skillPower:5,skillDestruction:5,skillDefense:5,skillGuard:5}];
 assert.ok(boss10DamagePotential(equipped,[],solveAll(dogCreateMiniGames(10,()=>0,{exchange:'cinematic'})))>
  boss10DamagePotential(equipped,[],plan));
});

test('99s endgame: 12s maths, 15s dodge, two 8s games and four 14s cinematics',()=>{
 const game=dogCreateMiniGames(10,()=>0,{exchange:'endgame'});
 assert.equal(DOG_BOSS10_DURATION_MS,99_000);
 assert.equal(game.version,8);
 assert.deepEqual(game.rounds.map(r=>[r.startMs,r.endMs]),
  DOG_SLOW_DODGE_ENDGAME_WINDOWS.map(r=>[r.startMs,r.endMs]));
 assert.deepEqual(game.rounds.map(r=>r.kind),['math','dodge','target','reaction']);
 assert.deepEqual(game.rounds.map(r=>r.endMs-r.startMs),[12000,15000,8000,8000]);
 assert.deepEqual(game.rounds.map((r,i)=>
  (game.rounds[i+1]?.startMs??99_000)-r.endMs),[14000,14000,14000,14000]);
 assert.equal(dogNormalizeMiniGames(game).version,8);
 assert.equal(dogMiniExchangeView(game,roster,98_000).durationMs,99_000);
 const dodge=game.rounds[1];
 for(const [index,attack] of dodge.attacks.entries()){
  assert.equal(attack.startMs,dodge.startMs+index*5000);
  assert.equal(attack.impactMs-attack.startMs,3300,
   'choice remains open 3.3s before the server decides');
  assert.equal((index<2?dodge.attacks[index+1].startMs:dodge.endMs)-attack.impactMs,1700,
   '1.7s remains to play the full impact/recovery before the next hit');
 }
 // An existing v5, v6 or v7 fight must retain its original schedule.
 for(const [version,windows,total] of [
  [5,DOG_ENDGAME_WINDOWS,60_000],
  [6,DOG_EXTENDED_ENDGAME_WINDOWS,64_000],
  [7,DOG_SHOW_ENDGAME_WINDOWS,92_000]]){
  const rounds=game.rounds.map((r,i)=>{
   const fixed=windows[i];
   return {...r,startMs:fixed.startMs,endMs:fixed.endMs,
    ...(r.kind==='dodge'?{attacks:r.attacks.map(a=>({
     ...a,startMs:fixed.startMs+Math.floor(a.step*8000/3),
     impactMs:fixed.startMs+Math.floor((a.step+.66)*8000/3)
    }))}:{})};
  });
  const older={...game,version,rounds};
  assert.equal(dogNormalizeMiniGames(older).version,version);
  assert.equal(dogMiniExchangeView(older,roster,total-1000).durationMs,total);
 }
 assert.equal(dogMiniExchangeView(dogCreateMiniGames(10,()=>0,{exchange:true}),roster,39_000).durationMs,40_000);
 assert.equal(dogMiniExchangeView(dogCreateMiniGames(10,()=>0,{exchange:'cinematic'}),roster,49_000).durationMs,50_000);
});
test('three dodge directions and verified success are safely synchronized to all players',()=>{
 let game=dogCreateMiniGames(70,()=>0,{exchange:'endgame'});
 const dodge=game.rounds.find(r=>r.kind==='dodge');
 assert.equal(dodge.lanes,3);
 const first=dodge.attacks[0];
 const correct=[0,1,2].find(i=>i!==first.dangerIndex&&i!==first.secondDangerIndex);
 const wrong=first.dangerIndex;
 const a=dogSubmitMiniAnswer(game,roster,'a',dodge.round,correct,
  now+first.startMs+250,now,0);
 assert.equal(a.correct,true);
 game=a.games;
 const b=dogSubmitMiniAnswer(game,roster,'b',dodge.round,wrong,
  now+first.startMs+350,now,0);
 assert.equal(b.correct,false);game=b.games;
 const other=dogPublicMiniGames(game,'c');
 const one=other.dodgeActions.find(a=>a.uid==='a'&&a.step===0);
 const two=other.dodgeActions.find(a=>a.uid==='b'&&a.step===0);
 assert.deepEqual([one.choice,one.correct,two.choice,two.correct],
  [correct,true,wrong,false]);
 assert.equal(other.myAnswers[dodge.round],undefined,
  'another player must not see my private answer history');
 const late=()=>dogSubmitMiniAnswer(game,roster,'c',dodge.round,correct,
  now+first.impactMs+1,now,0);
 assert.throws(late,/DOG_MINIGAME_TOO_LATE/,
  'no answer may be accepted after the actual strike');
});
