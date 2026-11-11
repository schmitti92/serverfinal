import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DOG_EXCHANGE_WINDOWS,dogCreateMiniGames,dogNormalizeMiniGames,
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
 assert.equal(DOG_BOSS10_DURATION_MS,50000);
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
