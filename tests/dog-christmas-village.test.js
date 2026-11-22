import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DOG_TOWER_FIELDS,DOG_GIFT_FIELD_ORDER,DOG_SCRATCH_FIELDS_PER_DEAL,DOG_SCRATCH_FIELDS_PER_INN_LEVEL,dogInnScratchFieldCount,DOG_FIELD_SCRATCH_TIER_ODDS,drawHiddenDogChristmasFields,drawDogScratchTier,refreshDogChristmasDeal,applyDogInnUpgradeToMatch,publicDogChristmasMatch,claimDogChristmasScratch,isDogChristmasEventActive,normalizedDogVillage,dogVillagePublic,
 buyDogVillageUpgrade,createDogChristmasMatch,claimDogChristmasGift,
 finishDogChristmasMatch,creditDogVillage
} from '../dog/christmas-village.js';

const host='user_alice123';
test('Christmas event is globally active by default, never a room or host setting',()=>{
 assert.equal(isDogChristmasEventActive({}),true);
 assert.equal(isDogChristmasEventActive({DOG_CHRISTMAS_EVENT_ENABLED:'true'}),true);
 for(const value of ['false','0','off','ended','FALSE',' Off ']){
  assert.equal(isDogChristmasEventActive({DOG_CHRISTMAS_EVENT_ENABLED:value}),false,value);
 }
});

test('Christmas village starts at level 1, with 10 real gift fields and empty shared balance',()=>{
 const initial=dogVillagePublic(null,host);
 assert.equal(initial.lightsTenths,0);
 assert.deepEqual(initial.levels,{tower:1,workshop:1,bakery:1,inn:1,luckhouse:1,academy:1});
 assert.deepEqual(initial.nextCosts,{tower:15,workshop:15,bakery:15,inn:15,luckhouse:15,academy:15});
 assert.equal(initial.bonus.towerFields,10);
 assert.equal(initial.bonus.workshopExtraChancePercent,5);
 assert.equal(initial.bonus.bakeryExtraPercent,0);
 assert.equal(initial.bonus.innPerFinishedGame,0);
 assert.equal(initial.bonus.luckhouseDiscountPercent,0);
 assert.equal(initial.bonus.academyXpPercent,0);
 assert.deepEqual(DOG_TOWER_FIELDS,[10,12,15,18,20]);
 assert.equal(new Set(DOG_GIFT_FIELD_ORDER).size,20);
 assert.ok(DOG_GIFT_FIELD_ORDER.every(x=>Number.isInteger(x)&&x>=0&&x<64&&x%16!==0));
});
test('workshop and bakery pay from a verified landing, and each field is single-use',()=>{
 const village=normalizedDogVillage({levels:{tower:5,workshop:3,bakery:4,inn:5}},host);
 const match=createDogChristmasMatch(village,true);
 assert.equal(match.giftFields.length,20);
 const field=match.giftFields[0];
 const before={pieces:[{id:0,owner:0,place:'track',pos:(field+63)%64}]};
 const after={pieces:[{id:0,owner:0,place:'track',pos:field}]};
 const move={type:'move',pieceId:0};
 const gained=claimDogChristmasGift(match,before,after,move,0,()=>0);
 assert.equal(gained,26,'2 gifts × 1.3 lights');
 assert.equal(match.bonusGiftCount,1);
 assert.equal(match.giftCount,1);
 assert.deepEqual(match.claimedFields,[field]);
 assert.equal(claimDogChristmasGift(match,before,after,move,0,()=>0),0);
 assert.equal(claimDogChristmasGift(match,before,after,{type:'swap',pieceId:0},0,()=>0),0);
 const earned=creditDogVillage(village,host,match,gained,1,1);
 assert.equal(earned.lightsTenths,26);
 assert.equal(earned.giftsCollected,1);
 assert.equal(earned.bonusGifts,1);
});
test('bakery fractions accumulate exactly and survive a persistent wallet',()=>{
 let v=normalizedDogVillage({levels:{tower:1,workshop:1,bakery:2,inn:1}},host);
 for(let i=0;i<10;i++)v=creditDogVillage(v,host,null,11,1,0);
 assert.equal(v.lightsTenths,110);
 assert.equal(dogVillagePublic(v,host).lights,11);
});
test('the inn rewards a completed match only once, never an unfinished or aborted round',()=>{
 const match=createDogChristmasMatch({levels:{tower:1,workshop:1,bakery:1,inn:5}},true);
 assert.equal(finishDogChristmasMatch(match,{phase:'play'}),0);
 assert.equal(match.innCredited,false);
 assert.equal(finishDogChristmasMatch(match,{phase:'finished'}),40);
 assert.equal(finishDogChristmasMatch(match,{phase:'finished'}),0);
 const v=creditDogVillage(null,host,match,40,0,0,true);
 assert.equal(v.matchesCompleted,1);
 assert.equal(v.lightsTenths,40);
});
test('only sufficient saved lights can pay for levels, and duplicated commands cannot charge twice',()=>{
 let village=normalizedDogVillage({lightsTenths:1600},host);
 let change=buyDogVillageUpgrade(village,host,'tower',1,'christmas-upgrade-001');
 assert.equal(change.price,15);
 assert.equal(change.village.levels.tower,2);
 assert.equal(change.village.lightsTenths,1450);
 let repeated=buyDogVillageUpgrade(change.village,host,'tower',1,'christmas-upgrade-001');
 assert.equal(repeated.unchanged,true);
 assert.equal(repeated.village.lightsTenths,1450);
 assert.throws(()=>buyDogVillageUpgrade(change.village,host,'tower',1,'christmas-upgrade-002'),/STALE_BUILDING_LEVEL/);
 assert.throws(()=>buyDogVillageUpgrade({lightsTenths:0},host,'tower',1,'christmas-upgrade-003'),/NOT_ENOUGH_CHRISTMAS_LIGHTS/);
 assert.throws(()=>buyDogVillageUpgrade(village,host,'tower',5,'christmas-upgrade-004'),/STALE_BUILDING_LEVEL|BUILDING_MAX_LEVEL/);
 for(const key of ['__proto__','not-a-building',null])assert.throws(()=>buyDogVillageUpgrade(village,host,key,1,'christmas-upgrade-005'));
});
test('disabled Christmas mode never awards gifts or inn bonuses',()=>{
 assert.equal(createDogChristmasMatch(null,false),null);
 assert.equal(claimDogChristmasGift(null,{pieces:[]},{pieces:[]},{type:'move',pieceId:0},0),0);
 assert.equal(finishDogChristmasMatch(null,{phase:'finished'}),0);
});

test('every card deal has 10–20 hidden random gift spaces and eight separate scratch spaces',()=>{
 assert.equal(DOG_SCRATCH_FIELDS_PER_DEAL,8);
 assert.deepEqual(DOG_FIELD_SCRATCH_TIER_ODDS,{simple:88,medium:10,premium:2});
 for(let level=1;level<=5;level++){
  let seed=123*level;
  const draw=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/4294967296*max)};
  const m=createDogChristmasMatch({levels:{tower:level}},true,draw);
  assert.equal(m.giftFields.length,DOG_TOWER_FIELDS[level-1]);
  assert.equal(m.scratchFields.length,8);
  assert.equal(new Set([...m.giftFields,...m.scratchFields]).size,m.giftFields.length+8);
  assert.ok([...m.giftFields,...m.scratchFields].every(i=>i>=0&&i<64&&i%16!==0));
  const publicData=publicDogChristmasMatch(m);
  assert.equal(publicData.visibleGiftFields,undefined,'unclaimed gifts must remain secret for players without research');
  assert.equal(publicData.visibleScratchFields,undefined,'unclaimed scratch spaces must remain secret for players without research');
  assert.ok(!Object.hasOwn(publicData,'giftFields'));
  assert.ok(!Object.hasOwn(publicData,'scratchFields'));
  assert.ok(!Object.hasOwn(publicData,'claimedFields'));
  assert.ok(!Object.hasOwn(publicData,'claimedScratchFields'));
  assert.equal(publicData.giftFieldCount,m.giftFields.length);
  assert.equal(publicData.scratchFieldCount,8);
  const old=JSON.stringify([m.giftFields,m.scratchFields]);
  assert.equal(refreshDogChristmasDeal(m,1,draw),false);
  assert.equal(JSON.stringify([m.giftFields,m.scratchFields]),old);
  assert.equal(refreshDogChristmasDeal(m,2,draw),true);
  assert.notEqual(JSON.stringify([m.giftFields,m.scratchFields]),old);
  assert.equal(m.round,2);
  assert.equal(m.roundGiftCollected,0);
  assert.equal(m.roundScratchCollected,0);
 }
});
test('every Friedensherberge upgrade spawns exactly two more hidden scratch spots per deal',()=>{
 assert.equal(DOG_SCRATCH_FIELDS_PER_INN_LEVEL,2);
 let village=normalizedDogVillage({lightsTenths:3000},host);
 for(let innLevel=1;innLevel<=5;innLevel++){
  const expected=8+2*(innLevel-1);
  assert.equal(dogInnScratchFieldCount(innLevel),expected);
  assert.equal(dogVillagePublic(village,host).bonus.innScratchFields,expected);
  let seed=91+innLevel;
  const draw=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/4294967296*max)};
  const match=createDogChristmasMatch(village,true,draw);
  assert.equal(match.scratchFields.length,expected);
  assert.equal(publicDogChristmasMatch(match).scratchFieldCount,expected);
  assert.equal(match.giftFields.length,10);
  assert.equal(new Set([...match.giftFields,...match.scratchFields]).size,10+expected);
  const oldPositions=JSON.stringify(match.scratchFields);
  assert.equal(refreshDogChristmasDeal(match,1,draw),false,'same deal must not spawn again');
  assert.equal(JSON.stringify(match.scratchFields),oldPositions);
  assert.equal(refreshDogChristmasDeal(match,2,draw),true,'new cards reshuffle all hidden spaces');
  assert.equal(match.scratchFields.length,expected);
  assert.equal(new Set([...match.giftFields,...match.scratchFields]).size,10+expected);
  if(innLevel<5){
   const id='inn-level-'+innLevel+'-upgrade';
   const bought=buyDogVillageUpgrade(village,host,'inn',innLevel,id);
   assert.equal(bought.village.levels.inn,innLevel+1);
   const repeated=buyDogVillageUpgrade(bought.village,host,'inn',innLevel,id);
   assert.equal(repeated.unchanged,true,'retry does not upgrade twice');
   village=bought.village;
  }
 }
 assert.throws(()=>dogInnScratchFieldCount(6),/INVALID_INN_LEVEL/);
});
test('an inn purchase adds hidden scratch spots to the active room without resetting claims',()=>{
 const match=createDogChristmasMatch(null,true,()=>0);
 const gift=match.giftFields[0],scratch=match.scratchFields[0];
 const before={pieces:[{id:0,place:'track',pos:(scratch+63)%64}]};
 const after={pieces:[{id:0,place:'track',pos:scratch}]};
 assert.equal(claimDogChristmasScratch(match,before,after,{type:'move',pieceId:0},0,()=>20),'simple');
 const oldGifts=match.giftFields.slice();
 const oldScratch=match.scratchFields.slice();
 const collected=match.claimedScratchFields.slice();
 assert.equal(applyDogInnUpgradeToMatch(match,2,()=>0),2);
 assert.equal(match.scratchFields.length,10);
 assert.deepEqual(match.giftFields,oldGifts,'gift map remains unchanged');
 assert.deepEqual(match.scratchFields.slice(0,8),oldScratch,'previous scratch spots are preserved');
 assert.deepEqual(match.claimedScratchFields,collected,'already claimed spots remain claimed');
 assert.equal(publicDogChristmasMatch(match).scratchFieldCount,10);
 assert.equal(applyDogInnUpgradeToMatch(match,2,()=>0),0,'replayed level cannot spawn more');
 assert.equal(applyDogInnUpgradeToMatch(match,5,()=>0),6,'missed inn levels are caught up exactly once');
 assert.equal(match.scratchFields.length,16);
 assert.equal(new Set([...match.giftFields,...match.scratchFields]).size,26);
 assert.equal(refreshDogChristmasDeal(match,2,()=>0),true);
 assert.equal(match.scratchFields.length,16);
 assert.equal(match.roundScratchCollected,0);
 assert.ok(!publicDogChristmasMatch(match).scratchFields,'secret placement is never exposed');
 assert.equal(gift>=0,true);
});
test('verified scratch landing is single-use per deal and gives exact 88/10/2 tiers',()=>{
 let seed=9876;
 const draw=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/4294967296*max)};
 const match=createDogChristmasMatch(null,true,draw);
 const field=match.scratchFields[0];
 const before={pieces:[{id:0,owner:0,place:'track',pos:(field+63)%64}]};
 const after={pieces:[{id:0,owner:0,place:'track',pos:field}]};
 const action={type:'move',pieceId:0};
 assert.equal(claimDogChristmasScratch(match,before,after,action,0,()=>0),'premium');
 assert.equal(claimDogChristmasScratch(match,before,after,action,0,()=>99),null);
 assert.equal(match.scratchCount,1);
 assert.equal(match.roundScratchCollected,1);
 assert.equal(claimDogChristmasScratch(match,before,after,{type:'swap',pieceId:0},0,()=>0),null);
 const count={simple:0,medium:0,premium:0};
 for(let roll=0;roll<100;roll++)count[drawDogScratchTier(()=>roll)]++;
 assert.deepEqual(count,{simple:88,medium:10,premium:2});
 refreshDogChristmasDeal(match,2,draw);
 assert.equal(match.roundScratchCollected,0);
 assert.equal(match.scratchCount,1);
 assert.ok(!publicDogChristmasMatch(match).scratchFields);
});
test('claimed gift and scratch cells are reset after the next card deal, not every action',()=>{
 const match=createDogChristmasMatch(null,true,()=>0);
 const gift=match.giftFields[0],scratch=match.scratchFields[0];
 const before=field=>({pieces:[{id:1,place:'track',pos:(field+63)%64}]});
 const after=field=>({pieces:[{id:1,place:'track',pos:field}]});
 assert.ok(claimDogChristmasGift(match,before(gift),after(gift),{type:'move',pieceId:1},0,()=>99)>0);
 assert.equal(claimDogChristmasScratch(match,before(scratch),after(scratch),{type:'move',pieceId:1},0,()=>20),'simple');
 const afterClaim=publicDogChristmasMatch(match);
 assert.equal(afterClaim.visibleGiftFields,undefined,'gift map is not globally exposed');
 assert.equal(afterClaim.visibleScratchFields,undefined,'scratch map is not globally exposed');
 assert.equal(match.claimedFields.length,1,'one light is collected only once');
 assert.equal(match.claimedScratchFields.length,1,'one scratch position is collected only once');
 assert.equal(match.roundGiftCollected,1);assert.equal(match.roundScratchCollected,1);
 assert.equal(refreshDogChristmasDeal(match,1,()=>0),false);
 assert.equal(match.roundGiftCollected,1);assert.equal(match.roundScratchCollected,1);
 assert.equal(refreshDogChristmasDeal(match,2,()=>0),true);
 assert.equal(publicDogChristmasMatch(match).visibleGiftFields,undefined,'re-dealing does not leak hidden gifts');
 assert.equal(publicDogChristmasMatch(match).visibleScratchFields,undefined,'re-dealing does not leak hidden tickets');
 assert.equal(match.roundGiftCollected,0);assert.equal(match.roundScratchCollected,0);
 assert.equal(match.giftCount,1);assert.equal(match.scratchCount,1);
});

test('verified Christmas discoveries stay visible for the entire match, not just one card deal',()=>{
 const draw=()=>0;
 const match=createDogChristmasMatch(null,true,draw,1);
 const gift=match.giftFields[0],scratch=match.scratchFields[0];
 const before=field=>({pieces:[{id:1,place:'track',pos:(field+63)%64}]});
 const after=field=>({pieces:[{id:1,place:'track',pos:field}]});
 const action={type:'move',pieceId:1};
 const fresh=publicDogChristmasMatch(match);
 assert.deepEqual(fresh.foundGiftFields,[]);
 assert.deepEqual(fresh.foundScratchFields,[]);
 assert.equal(fresh.eventSerial,0);
 assert.equal(fresh.visibleGiftFields,undefined,'unclaimed positions remain secret');
 assert.equal(fresh.visibleScratchFields,undefined,'unclaimed tickets remain secret');
 assert.ok(claimDogChristmasGift(match,before(gift),after(gift),action,1,()=>99)>0);
 assert.equal(claimDogChristmasScratch(match,before(scratch),after(scratch),action,1,()=>20),'simple');
 const claimed=publicDogChristmasMatch(match);
 assert.deepEqual(claimed.foundGiftFields,[gift]);
 assert.deepEqual(claimed.foundScratchFields,[scratch]);
 assert.equal(claimed.eventSerial,2);
 assert.deepEqual(claimed.activity.filter(event=>event.id).map(event=>event.id),[1,2]);
 assert.equal(claimed.activity.at(-1).seat,1);
 assert.equal(claimDogChristmasScratch(match,before(scratch),after(scratch),action,1,()=>20),null);
 assert.equal(publicDogChristmasMatch(match).eventSerial,2,'duplicate landing must not trigger new popup');
 refreshDogChristmasDeal(match,2,draw);
 const next=publicDogChristmasMatch(match);
 assert.deepEqual(next.foundGiftFields,[gift],'gift remains marked after redeal');
 assert.deepEqual(next.foundScratchFields,[scratch],'ticket remains marked after redeal');
 assert.deepEqual(match.claimedFields,[],'new secret gifts are still collectable');
 assert.deepEqual(match.claimedScratchFields,[],'new secret tickets are still collectable');
 assert.equal(next.visibleGiftFields,undefined,'revealed history must not expose the new map');
 assert.equal(next.visibleScratchFields,undefined,'revealed history must not expose the new scratch map');
});

test('old active DOG room backfills its recorded discoveries without guessing secret positions',()=>{
 const match=createDogChristmasMatch(null,true,()=>0,5);
 const oldGift=match.giftFields[0],oldScratch=match.scratchFields[0];
 // Simulate the room format used before the permanent-found-fields feature.
 delete match.foundGiftFields;delete match.foundScratchFields;delete match.eventSerial;
 match.activity=[{type:'gift',field:oldGift,seat:0},{type:'scratch',field:oldScratch,seat:1},
  {type:'inn',earnedTenths:10},{type:'gift',field:0,seat:0}];
 match.claimedFields=[match.giftFields[1]];
 match.claimedScratchFields=[match.scratchFields[1]];
 const view=publicDogChristmasMatch(match);
 assert.deepEqual(new Set(view.foundGiftFields),new Set([oldGift,match.giftFields[1]]));
 assert.deepEqual(new Set(view.foundScratchFields),new Set([oldScratch,match.scratchFields[1]]));
 assert.equal(view.visibleGiftFields,undefined);
 assert.equal(view.visibleScratchFields,undefined);
 const saved=refreshDogChristmasDeal(match,6,()=>0);
 assert.equal(saved,true);
 assert.deepEqual(new Set(match.foundGiftFields),new Set([oldGift,view.foundGiftFields[1]]));
 assert.deepEqual(new Set(match.foundScratchFields),new Set([oldScratch,view.foundScratchFields[1]]));
 assert.equal(match.roundGiftCollected,0);
 assert.equal(match.roundScratchCollected,0);
 assert.deepEqual(publicDogChristmasMatch(match).foundGiftFields,match.foundGiftFields);
 assert.deepEqual(publicDogChristmasMatch(match).foundScratchFields,match.foundScratchFields);
});
test('new claims retain old event history when old room migrates on a move',()=>{
 const match=createDogChristmasMatch(null,true,()=>0,3);
 const oldField=match.giftFields[0],newField=match.giftFields[1];
 delete match.foundGiftFields;delete match.foundScratchFields;
 match.activity=[{type:'gift',field:oldField,seat:1}];
 const before={pieces:[{id:1,owner:0,place:'track',pos:(newField+63)%64}]};
 const after={pieces:[{id:1,owner:0,place:'track',pos:newField}]};
 assert.ok(claimDogChristmasGift(match,before,after,{type:'move',pieceId:1},0,()=>99)>0);
 assert.deepEqual(new Set(match.foundGiftFields),new Set([oldField,newField]));
 assert.ok(!publicDogChristmasMatch(match).giftFields,'secret fields stay protected');
});
