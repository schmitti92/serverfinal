import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DOG_TOWER_FIELDS,DOG_GIFT_FIELD_ORDER,normalizedDogVillage,dogVillagePublic,
 buyDogVillageUpgrade,createDogChristmasMatch,claimDogChristmasGift,
 finishDogChristmasMatch,creditDogVillage
} from '../dog/christmas-village.js';

const host='user_alice123';
test('Christmas village starts at level 1, with 10 real gift fields and empty shared balance',()=>{
 const initial=dogVillagePublic(null,host);
 assert.equal(initial.lightsTenths,0);
 assert.deepEqual(initial.levels,{tower:1,workshop:1,bakery:1,inn:1});
 assert.deepEqual(initial.nextCosts,{tower:15,workshop:15,bakery:15,inn:15});
 assert.equal(initial.bonus.towerFields,10);
 assert.equal(initial.bonus.workshopExtraChancePercent,5);
 assert.equal(initial.bonus.bakeryExtraPercent,0);
 assert.equal(initial.bonus.innPerFinishedGame,0);
 assert.deepEqual(DOG_TOWER_FIELDS,[10,12,15,18,20]);
 assert.equal(new Set(DOG_GIFT_FIELD_ORDER).size,20);
 assert.ok(DOG_GIFT_FIELD_ORDER.every(x=>Number.isInteger(x)&&x>=0&&x<64&&x%16!==0));
});
test('workshop and bakery pay from a verified landing, and each field is single-use',()=>{
 const village=normalizedDogVillage({levels:{tower:5,workshop:3,bakery:4,inn:5}},host);
 const match=createDogChristmasMatch(village,true);
 assert.equal(match.giftFields.length,20);
 const before={pieces:[{id:0,owner:0,place:'track',pos:63}]};
 const after={pieces:[{id:0,owner:0,place:'track',pos:3}]};
 const move={type:'move',pieceId:0};
 const gained=claimDogChristmasGift(match,before,after,move,0,()=>0);
 assert.equal(gained,26,'2 gifts × 1.3 lights');
 assert.equal(match.bonusGiftCount,1);
 assert.equal(match.giftCount,1);
 assert.deepEqual(match.claimedFields,[3]);
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
