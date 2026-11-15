import test from 'node:test';
import assert from 'node:assert/strict';
import {CHRISTMAS_BUILDING_IDS,christmasUpgradeCost,christmasBuildingTotalCost,
 christmasVillageTotalCost,christmasUpgradeQuote} from '../dog/christmas-building-costs.js';

test('server contract: Christmas building upgrades double from 15 lights',()=>{
 assert.equal(CHRISTMAS_BUILDING_IDS.length,4);
 assert.deepEqual([1,2,3,4,5].map(christmasUpgradeCost),[15,30,60,120,null]);
 assert.deepEqual([1,2,3,4,5].map(christmasBuildingTotalCost),[0,15,45,105,225]);
 assert.equal(christmasVillageTotalCost({tower:5,workshop:5,bakery:5,inn:5}),900);
});
test('server contract: quote affordability without mutating balance',()=>{
 const lights=120;
 assert.deepEqual(christmasUpgradeQuote(4,lights),{
  fromLevel:4,toLevel:5,cost:120,affordable:true,remainingLights:0
 });
 assert.equal(lights,120);
 assert.equal(christmasUpgradeQuote(1,NaN),null);
 assert.equal(christmasUpgradeCost(5),null);
 assert.equal(christmasVillageTotalCost({tower:1,workshop:2,bakery:3,inn:4}),165);
});
