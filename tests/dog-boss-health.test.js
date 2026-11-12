import test from 'node:test';
import assert from 'node:assert/strict';
import {dogHeroHp,dogGroupBossHp} from '../dog-balance.js';
import {dogCreateMiniGames,dogMiniGroupHealth,dogMiniBossLiveHp,dogMiniExchangeView,dogMiniConfirmedStrikes,dogMiniCinematicVitals,dogSubmitMiniAnswer} from '../dog-boss-minigames.js';
import {boss10View,boss10DamagePotential} from '../dog-boss10.js';
import {groupBossView,groupBossDamagePotential} from '../dog-group-boss.js';

const now=1_900_000_000_000;
const team={members:[{uid:'a',name:'A'},{uid:'b',name:'B'},{uid:'c',name:'C'}]};
const roster=[{uid:'a',weaponLevel:1,armorLevel:1,skillDefense:0,skillGuard:0,
 skillPower:4,skillDestruction:4},
 {uid:'b',weaponLevel:1,armorLevel:1,skillDefense:5,skillGuard:2,
 skillPower:5,skillDestruction:5},
 {uid:'c',weaponLevel:1,armorLevel:1,skillDefense:3,skillGuard:5,
 skillPower:5,skillDestruction:5}];
const plan=()=>dogCreateMiniGames(10,()=>0,{exchange:'cinematic'});
const hp=m=>dogHeroHp({vitality:m.skillDefense},m.armorLevel);
const total=roster.reduce((sum,m)=>sum+hp(m),0);
test('group maximum HP is the sum of frozen individual equipment HP',()=>{
 for(const size of [1,2,3]){
  const models=dogMiniGroupHealth(plan(),roster.slice(0,size),0,hp);
  const expected=roster.slice(0,size).reduce((sum,m)=>sum+hp(m),0);
  assert.equal(models.maxHp,expected);
  assert.equal(models.hp,expected);
  assert.equal(models.heroes.length,size);
  for(const m of models.heroes)assert.equal(m.hp,m.maxHp);
 }
});
test('verified dodges prevent team HP loss; failed defense costs real team LP',()=>{
 const games=plan();
 const before=dogMiniGroupHealth(games,roster,20499,hp);
 assert.equal(before.hp,total,'before the first defense resolves, HP is untouched');
 const first=dogMiniGroupHealth(games,roster,21000,hp);
 assert.equal(first.remainingPercent,75);
 assert.equal(first.hp,first.heroes.reduce((n,h)=>n+h.hp,0));
 assert.ok(first.hp<total);
 const final=dogMiniGroupHealth(games,roster,49000,hp);
 assert.equal(final.remainingPercent,50);
 assert.ok(final.hp<first.hp);
 assert.equal(final.lost,final.maxHp-final.hp);
});
test('server-sourced boss HP steps down after confirmed offensive phases, never regenerates',()=>{
 const games=plan(),max=dogGroupBossHp(10);
 const base=boss10DamagePotential(roster,[],null);
 const atStart=dogMiniBossLiveHp(games,roster,7999,max,base);
 const afterOne=dogMiniBossLiveHp(games,roster,8000,max,base);
 const afterTwo=dogMiniBossLiveHp(games,roster,33000,max,base);
 assert.equal(atStart,max);
 assert.ok(afterOne<max,'first team attack reduces shown HP');
 assert.ok(afterTwo<afterOne,'second attack reduces shown HP again');
 assert.ok(afterTwo>=1,'only final server settlement can show zero');
 assert.equal(dogMiniBossLiveHp(games,roster,49500,max,base),afterTwo);
 assert.equal(dogMiniBossLiveHp(null,roster,50000,max,base),max);
});
test('10 and 20 boss views expose synchronized HP without extra state writes',()=>{
 const fight10={phase:'fighting',roster,ready:roster.map(m=>m.uid),
  startedAt:now,endsAt:now+50000,miniGames:plan()};
 const state10={boss10:fight10,people:{},sharedBosses:[]};
 const a=boss10View(team,state10,'a',now+23000);
 const b=boss10View(team,state10,'b',now+23000);
 assert.deepEqual(a.teamHealth,b.teamHealth);
 assert.equal(a.teamHealth.maxHp,total);
 assert.ok(a.teamHealth.hp<total);
 assert.ok(a.bossLiveHp<a.bossHp);
 assert.equal(a.serverNow,b.serverNow);
 const max20=dogGroupBossHp(20);
 const roster20=roster.map(m=>({...m,weaponLevel:2,armorLevel:2,skillDefense:10}));
 const state20={sharedBosses:[10],people:{},groupBosses:{
  20:{...fight10,roster:roster20,miniGames:dogCreateMiniGames(20,()=>0,{exchange:'cinematic'})}
 }};
 const c=groupBossView(20,team,state20,'c',now+34000);
 assert.equal(c.bossHp,max20);
 assert.ok(c.teamHealth.maxHp>total);
 assert.ok(c.bossLiveHp<c.bossHp);
 assert.ok(groupBossDamagePotential(20,roster20,[],null)>0);
});

test('v12: every player earns their own defense and HP from server-checked answers',()=>{
 const startedAt=now;
 let games=dogCreateMiniGames(10,()=>0,{exchange:'individual'});
 assert.equal(games.version,12);
 const dodge=games.rounds[1];
 for(const strike of dodge.attacks){
  const correct=Array.from({length:dodge.lanes},(_,i)=>i).find(i=>
   i!==strike.dangerIndex&&i!==strike.secondDangerIndex);
  const at=startedAt+strike.startMs+500;
  const reply=dogSubmitMiniAnswer(games,roster,'a',dodge.round,
   correct,at,startedAt,strike.step);
  assert.equal(reply.correct,true);
  games=reply.games;
 }
 const bStrike=dodge.attacks[0];
 const bSafe=Array.from({length:dodge.lanes},(_,i)=>i).find(i=>
  i!==bStrike.dangerIndex&&i!==bStrike.secondDangerIndex);
 games=dogSubmitMiniAnswer(games,roster,'b',dodge.round,bSafe,
  startedAt+bStrike.startMs+500,startedAt,0).games;
 const result=dogMiniGroupHealth(games,roster,dodge.endMs+1,hp);
 const [a,b,c]=result.heroes;
 assert.equal(a.hp,a.maxHp,'perfect dodge: this hero keeps all their LP');
 assert.ok(b.hp<a.hp&&b.hp>c.hp,'partial dodge only reduces their own protection');
 assert.equal(c.hp,Math.round(c.maxHp*.75),'missed dodge costs this hero 25%');
 assert.equal(result.hp,a.hp+b.hp+c.hp,'team HP sums individual LP');
 const afterReaction=dogMiniGroupHealth(games,roster,101000,hp);
 assert.ok(afterReaction.heroes[0].hp>afterReaction.heroes[2].hp,
  'second missed defense does not remove the earlier personal advantage');
});
test('old v10 battles keep their shared-shield rules after the personal-defense update',()=>{
 const historical=dogCreateMiniGames(10,()=>0,{exchange:'endgame'});
 assert.equal(historical.version,10);
 const report=dogMiniGroupHealth(historical,roster,101000,()=>100);
 assert.deepEqual(report.heroes.map(h=>h.hp),[50,50,50]);
 const upgraded=dogCreateMiniGames(10,()=>0,{exchange:'individual'});
 assert.equal(upgraded.rounds[1].startMs,historical.rounds[1].startMs);
 assert.equal(upgraded.rounds[3].endMs,historical.rounds[3].endMs);
});

test('v11 exchange publishes exact personal bonus and HP saved only after each round closes',()=>{
 let games=dogCreateMiniGames(10,()=>0,{exchange:'individual'});
 const math=games.rounds[0];
 const partlyCorrect=math.puzzles.map((p,i)=>i<6?p.correctIndex:
  p.correctIndex===0?1:0);
 games=dogSubmitMiniAnswer(games,roster,'a',0,partlyCorrect,
  now+math.endMs+100,now,0).games;
 games=dogSubmitMiniAnswer(games,roster,'b',0,
  math.puzzles.map(p=>p.correctIndex),
  now+math.endMs+120,now,0).games;
 const attackBase=hero=>hero.uid==='a'?1100:hero.uid==='b'?1500:1900;
 const early=dogMiniExchangeView(games,roster,math.endMs-1,attackBase,hp);
 assert.equal(early.stages[0].playerResults,null,
  'individual scores must not be exposed mid-minigame');
 const score=dogMiniExchangeView(games,roster,math.endMs+1,attackBase,hp);
 const [a,b,c]=score.stages[0].playerResults;
 assert.deepEqual([a.correct,b.correct,c.correct],[6,8,0]);
 assert.deepEqual([a.max,b.max,c.max],[8,8,8]);
 assert.ok(a.bonusDamage>0&&b.bonusDamage>a.bonusDamage);
 assert.equal(c.bonusDamage,0);
 assert.equal(a.bonusDamage+b.bonusDamage+c.bonusDamage,
  score.stages[0].bonusDamage,'personal bonus allocations sum to exact team bonus');
 const dodge=games.rounds[1];
 for(const strike of dodge.attacks){
  const safe=Array.from({length:dodge.lanes},(_,i)=>i).find(i=>
   i!==strike.dangerIndex&&i!==strike.secondDangerIndex);
  games=dogSubmitMiniAnswer(games,roster,'a',1,safe,
   now+strike.startMs+500,now,strike.step).games;
 }
 const before=dogMiniExchangeView(games,roster,dodge.endMs-1,attackBase,hp);
 assert.equal(before.stages[1].playerResults,null);
 const after=dogMiniExchangeView(games,roster,dodge.endMs+1,attackBase,hp);
 const [saveA,saveB,saveC]=after.stages[1].playerResults;
 assert.equal(saveA.correct,3);
 assert.equal(saveA.protectionPoints,25);
 assert.equal(saveA.savedHp,Math.round(hp(roster[0]))-
  Math.round(hp(roster[0])*.75));
 assert.equal(saveB.savedHp,0);
 assert.equal(saveC.savedHp,0);
 assert.equal(saveB.protectionPoints,0);
 assert.equal(after.stages[0].bonusDamage,score.stages[0].bonusDamage);
});

test('cinematic hit numbers come exclusively from already-verified stage HP changes',()=>{
 const games=dogCreateMiniGames(10,()=>0,{exchange:'individual'});
 const max=dogGroupBossHp(10),base=boss10DamagePotential(roster,[],null);
 const single=hero=>boss10DamagePotential([hero],[],null);
 const math=games.rounds[0],dodge=games.rounds[1],target=games.rounds[2];
 assert.deepEqual(dogMiniConfirmedStrikes(games,roster,math.endMs-1,max,
  base,single,hp),[],'no per-player damage shown before stage settles');
 const first=dogMiniConfirmedStrikes(games,roster,math.endMs,max,
  base,single,hp);
 assert.equal(first.length,3);
 assert.deepEqual(first.map(x=>x.uid),['a','b','c']);
 assert.ok(first.every(x=>x.kind==='hero-strike'&&x.amount>=0));
 assert.ok(first.every(x=>x.atMs>=math.endMs&&x.atMs<
  dodge.startMs-3000),'damage popups occur in three staggered attack slots');
 const stageOne=dogMiniBossLiveHp(games,roster,math.endMs,max,base,0);
 assert.equal(first.reduce((n,x)=>n+x.amount,0),max-stageOne,
  'all attacks together equal the stage-confirmed boss HP loss exactly');
 const ready=dogMiniConfirmedStrikes(games,roster,dodge.endMs,max,
  base,single,hp),guard=ready.filter(x=>x.round===1);
 assert.equal(guard.length,3);
 assert.ok(guard.every(x=>x.kind==='boss-strike'));
 const before=dogMiniGroupHealth(games,roster,dodge.endMs-1,hp);
 const after=dogMiniGroupHealth(games,roster,dodge.endMs,hp);
 for(let i=0;i<3;i++)
  assert.equal(guard[i].amount,before.heroes[i].hp-after.heroes[i].hp);
 const throughTarget=dogMiniConfirmedStrikes(games,roster,target.endMs,max,
  base,single,hp).filter(x=>x.round===2);
 const stageTwo=dogMiniBossLiveHp(games,roster,target.endMs,max,base,0);
 assert.equal(throughTarget.reduce((n,x)=>n+x.amount,0),stageOne-stageTwo,
  'the second offensive phase contains only its new confirmed HP delta');
});
test('a personally perfect dodge yields a block popup only for that player',()=>{
 let games=dogCreateMiniGames(10,()=>0,{exchange:'individual'});
 const dodge=games.rounds[1],base=boss10DamagePotential(roster,[],null);
 for(const strike of dodge.attacks){
  const correct=Array.from({length:dodge.lanes},(_,i)=>i).find(i=>
   i!==strike.dangerIndex&&i!==strike.secondDangerIndex);
  games=dogSubmitMiniAnswer(games,roster,'a',1,correct,
   now+strike.startMs+500,now,strike.step).games;
 }
 const events=dogMiniConfirmedStrikes(games,roster,dodge.endMs,
  dogGroupBossHp(10),base,m=>boss10DamagePotential([m],[],null),hp)
  .filter(x=>x.round===1);
 assert.equal(events[0].amount,0);
 assert.equal(events[0].blocked,true);
 assert.ok(events[1].amount>0);
 assert.ok(events[2].amount>0);
 assert.equal(events[1].blocked,false);
});

test('cinematic visible HP stays full until each impact and drops by that exact amount',()=>{
 const games=dogCreateMiniGames(10,()=>0,{exchange:'individual'});
 const max=dogGroupBossHp(10),base=boss10DamagePotential(roster,[],null);
 const perHero=m=>boss10DamagePotential([m],[],null);
 const firstEnd=games.rounds[0].endMs;
 const hits=dogMiniConfirmedStrikes(games,roster,firstEnd,max,base,perHero,hp);
 const after=dogMiniBossLiveHp(games,roster,firstEnd,max,base,0);
 const health=dogMiniGroupHealth(games,roster,firstEnd,hp);
 assert.equal(dogMiniCinematicVitals(after,health,hits,firstEnd,max).displayBossHp,max);
 const firstHit=hits[0];
 const visible=dogMiniCinematicVitals(after,health,hits,firstHit.atMs,max);
 assert.equal(visible.displayBossHp,max-firstHit.amount);
 assert.equal(dogMiniCinematicVitals(after,health,hits,hits.at(-1).atMs,max).displayBossHp,after);
 assert.equal(visible.displayTeamHealth.hp,health.hp,'offensive hits do not alter hero LP');
 const dodge=games.rounds[1];
 const defenseHits=dogMiniConfirmedStrikes(games,roster,dodge.endMs,max,base,perHero,hp)
  .filter(x=>x.round===1);
 const afterDefense=dogMiniGroupHealth(games,roster,dodge.endMs,hp);
 const displayBefore=dogMiniCinematicVitals(after,afterDefense,defenseHits,dodge.endMs,max);
 assert.equal(displayBefore.displayTeamHealth.hp,health.hp,
  'defense HP is only subtracted at each targeted boss strike');
 const last=dogMiniCinematicVitals(after,afterDefense,defenseHits,defenseHits.at(-1).atMs,max);
 assert.equal(last.displayTeamHealth.hp,afterDefense.hp);
 assert.deepEqual(last.displayTeamHealth.heroes.map(x=>x.hp),afterDefense.heroes.map(x=>x.hp));
});
