import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DOG_FINAL5_WINDOWS,DOG_FINAL5_DURATION_MS,
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
 assert.equal(game.version,12);
 assert.equal(game.rounds.length,5);
 assert.deepEqual(game.rounds.map(x=>x.kind),['math','dodge','target','reaction','target']);
 assert.deepEqual(game.rounds.map(r=>[r.startMs,r.endMs]),
  DOG_FINAL5_WINDOWS.map(r=>[r.startMs,r.endMs]));
 assert.deepEqual([game.rounds[4].startMs,game.rounds[4].endMs,DOG_FINAL5_DURATION_MS],
  [101000,111000,125000]);
 assert.equal(dogNormalizeMiniGames(game).rounds.length,5);
 assert.equal(dogMiniExchangeView(game,team,115000).durationMs,125000);
 const hits=dogMiniConfirmedStrikes(game,team,111000,maxHp,base,single,m=>145);
 const closing=hits.filter(x=>x.round===4);
 assert.equal(closing.length,3);
 assert.deepEqual(closing.map(x=>x.uid),['a','b','c']);
 assert.ok(closing.every(x=>x.kind==='hero-strike'&&x.atMs>111000&&x.atMs<122000));
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

test('Fifth stage is only answerable in its own server-clock window',()=>{
 const games=full(),final=games.rounds[4],answers=final.puzzles.map(x=>x.correctIndex);
 assert.throws(()=>dogSubmitMiniAnswer(games,team,'a',4,answers,
  now+final.startMs-1,now,0),/TOO_LATE/);
 assert.throws(()=>dogSubmitMiniAnswer(games,team,'a',4,answers,
  now+final.endMs+2000,now,0),/TOO_LATE/);
});
