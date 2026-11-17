import test from 'node:test';
import assert from 'node:assert/strict';
import {DOG_GLOBAL_VILLAGE_ID,buyDogVillageUpgrade,dogVillagePublic,
 dogLuckhouseDiscountPercent,dogAcademyXpPercent} from '../dog/christmas-village.js';
import {dogTreeLevelFromLevels} from '../dog/christmas-tree-rewards.js';
import {buyScratchTicket} from '../dog/christmas-scratch.js';
import {creditDogMatchXp} from '../dog/player-levels.js';

test('two new shared buildings retain the existing Christmas tree progression',()=>{
 const initial=dogVillagePublic(null,DOG_GLOBAL_VILLAGE_ID);
 assert.equal(initial.levels.luckhouse,1);
 assert.equal(initial.levels.academy,1);
 assert.equal(dogTreeLevelFromLevels(initial),1);
 let upgraded=buyDogVillageUpgrade({lightsTenths:5000},DOG_GLOBAL_VILLAGE_ID,
  'luckhouse',1,'luckhouse-upgrade-001');
 assert.equal(upgraded.price,15);
 assert.equal(upgraded.village.lightsTenths,4850);
 assert.equal(dogVillagePublic(upgraded.village,DOG_GLOBAL_VILLAGE_ID).bonus.luckhouseDiscountPercent,5);
 upgraded=buyDogVillageUpgrade(upgraded.village,DOG_GLOBAL_VILLAGE_ID,
  'academy',1,'academy-upgrade-001');
 assert.equal(upgraded.village.lightsTenths,4700);
 const publicVillage=dogVillagePublic(upgraded.village,DOG_GLOBAL_VILLAGE_ID);
 assert.equal(publicVillage.bonus.academyXpPercent,10);
 assert.equal(dogTreeLevelFromLevels(publicVillage),1);
 assert.equal(buyDogVillageUpgrade(upgraded.village,DOG_GLOBAL_VILLAGE_ID,'academy',1,'academy-upgrade-001').unchanged,true);
});

test('shared new bonuses scale to their five-level maximum',()=>{
 assert.deepEqual([1,2,3,4,5].map(dogLuckhouseDiscountPercent),[0,5,10,15,20]);
 assert.deepEqual([1,2,3,4,5].map(dogAcademyXpPercent),[0,10,20,30,40]);
});

test('XP bonus only applies once when a verified match is credited',()=>{
 const first=creditDogMatchXp(null,{matchId:'academy-check-001',won:true,knockedOut:2,bonusPercent:40,now:10});
 assert.equal(first.xp,168); // 120 base + 48 academy bonus
 assert.equal(first.lastEarnedXp,168);
 assert.equal(first.lastXpBonusPercent,40);
 const replay=creditDogMatchXp(first,{matchId:'academy-check-001',won:true,bonusPercent:40});
 assert.equal(replay.credited,false);
 assert.equal(replay.xp,168);
});

test('purchase discounts paid scratch tickets but preserve free starter tickets',()=>{
 const request={tier:'simple',variantId:'gifts',commandId:'new-building-scratch-001'};
 const bought=buyScratchTicket(null,null,request,{discountPercent:20,draw:()=>0});
 assert.equal(bought.result.price,160);
 assert.equal(bought.wallet.coins,1000-160+(bought.result.totalCoins||0));
 const replay=buyScratchTicket(bought.wallet,null,request,{discountPercent:0,draw:()=>0});
 assert.equal(replay.unchanged,true);
 assert.equal(replay.result.price,160);
 const free=buyScratchTicket(null,null,{...request,commandId:'new-building-free-001',free:true},
  {discountPercent:20,draw:()=>0});
 assert.equal(free.result.price,0);
});
