import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DOG_RESEARCH_SKILLS,dogResearchEarned,dogResearchStatus,dogResearchUpgrade,
 dogResearchCost,dogResearchSkill,dogResearchPityThreshold,dogResearchTicketMs
} from '../dog/christmas-research.js';
import {creditDogMatchXp,DOG_LEVEL_THRESHOLDS} from '../dog/player-levels.js';
import {createGame,researchSwapCard} from '../dog/engine.js';

const xpForLevel=n=>DOG_LEVEL_THRESHOLDS[n-1];
test('research points are retrospective, excluding the initial level',()=>{
 assert.equal(dogResearchEarned(1),0);
 assert.equal(dogResearchEarned(2),1);
 assert.equal(dogResearchEarned(5),5);
 assert.equal(dogResearchEarned(10),12);
 assert.equal(dogResearchEarned(50),64);
 assert.equal(dogResearchStatus(null,xpForLevel(50)).available,64);
});
test('specified one-off costs and caps',()=>{
 assert.equal(dogResearchCost(dogResearchSkill('card_swap'),1),5);
 assert.equal(dogResearchCost(dogResearchSkill('spot_ticket'),1),3);
 assert.equal(dogResearchCost(dogResearchSkill('spot_light'),1),3);
 assert.equal(dogResearchSkill('xp').maxLevel,10);
 assert.equal(dogResearchSkill('win_xp').maxLevel,10);
 assert.equal(dogResearchSkill('discount').maxLevel,10);
 assert.equal(dogResearchSkill('coin_bonus').maxLevel,10);
 assert.equal(dogResearchSkill('builder').maxLevel,3);
 assert.equal(dogResearchSkill('thaw').maxLevel,2);
 assert.ok(DOG_RESEARCH_SKILLS.length>=20);
});
test('purchases are server-checked and can never spend more than earned',()=>{
 const lvl5=xpForLevel(5);
 let progress={};
 progress=dogResearchUpgrade(progress,lvl5,'xp',1200);
 assert.equal(dogResearchStatus(progress,lvl5).available,4);
 assert.equal(dogResearchStatus(progress,lvl5).levels.xp,1);
 assert.throws(()=>dogResearchUpgrade(progress,lvl5,'card_swap'),/RESEARCH_NOT_READY/);
 assert.throws(()=>dogResearchUpgrade(progress,xpForLevel(1),'win_xp'),/RESEARCH_NOT_ENOUGH_POINTS/);
 let max={};
 for(let n=0;n<10;n++)max=dogResearchUpgrade(max,xpForLevel(50),'xp',1300+n);
 assert.equal(dogResearchStatus(max,xpForLevel(50)).levels.xp,10);
 assert.throws(()=>dogResearchUpgrade(max,xpForLevel(50),'xp'),/RESEARCH_MAX_LEVEL/);
});
test('Wichtelwissen and Siegerakademie modify only verified match XP',()=>{
 assert.equal(creditDogMatchXp({}, {won:false,matchId:'a',researchPercent:100}).xp,100);
 assert.equal(creditDogMatchXp({}, {won:true,matchId:'b',winBonusPercent:300}).xp,250);
 assert.equal(creditDogMatchXp({}, {won:true,matchId:'c',bonusPercent:40,researchPercent:100,winBonusPercent:300}).xp,390);
 const first=creditDogMatchXp({}, {won:true,matchId:'X',researchPercent:100});
 assert.equal(creditDogMatchXp(first,{won:true,matchId:'X',researchPercent:100}).credited,false);
});
test('daily tickets and active collection timers are bounded',()=>{
 assert.equal(dogResearchTicketMs(1),24*60*60*1000);
 assert.equal(dogResearchTicketMs(10),6*60*60*1000);
 assert.equal(dogResearchPityThreshold(1),9);
 assert.equal(dogResearchPityThreshold(5),5);
 const day=dogResearchUpgrade({},xpForLevel(10),'free_ticket',10_000);
 assert.equal(day.freeTicketAt,10_000+24*60*60*1000);
 const builder=dogResearchUpgrade({},xpForLevel(10),'builder',10_000);
 assert.equal(builder.builderAt,10_000+2*60*60*1000);
});

test('one-time magic redraw changes only the owner's hand and preserves all 110 cards',()=>{
 const game=createGame({names:['A','B','C','D'],rng:()=>0.48});
 const originalHands=game.hands.map(h=>h.map(c=>c.id));
 const cardId=game.hands[0][0].id;
 const next=researchSwapCard(game,0,cardId,()=>0.42);
 assert.equal(next.hands[0].length,originalHands[0].length);
 assert.equal(next.deck.length,game.deck.length-1);
 assert.equal(next.discard.length,game.discard.length+1);
 assert.equal(next.researchSwapped[0],true);
 assert.equal(next.revision,game.revision+1);
 assert.notEqual(next.hands[0][0].id,cardId);
 for(let seat=1;seat<4;seat++)assert.deepEqual(next.hands[seat].map(c=>c.id),originalHands[seat]);
 const all=[...next.deck,...next.discard,...next.hands.flat()];
 assert.equal(all.length,110);
 assert.equal(new Set(all.map(x=>x.id)).size,110);
 assert.throws(()=>researchSwapCard(next,0,next.hands[0][0].id),/RESEARCH_SWAP_ALREADY_USED/);
 assert.equal(game.researchSwapped,undefined,'pure reducer must not mutate prior state');
});
