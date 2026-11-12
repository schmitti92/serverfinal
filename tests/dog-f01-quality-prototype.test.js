import test from 'node:test';
import assert from 'node:assert/strict';
import {DOG_RESOURCES} from '../dog-materials.js';
import {QUALITY_CHEST_WEIGHTS,emptyQualityInventory,migrateQualityInventory,refineQuality,qualityChestDrop,qualityKey,drawQuality} from '../dog-f01-quality-prototype.mjs';
test('F-01 quality: exactly 45 independent material slots and legacy migration',()=>{
 const inventory=migrateQualityInventory({iron:26,dragonsteel:3});
 assert.equal(Object.keys(inventory).length,45);
 assert.equal(inventory['iron:1'],26);
 assert.equal(inventory['iron:2'],0);
 assert.equal(inventory['dragonsteel:1'],3);
 assert.equal(DOG_RESOURCES.length,15);
});
test('F-01 quality: refinement 5:1 twice and no accidental mutation',()=>{
 const old=migrateQualityInventory({iron:25});
 const second=refineQuality(old,'iron',1,5);
 const third=refineQuality(second,'iron',2,1);
 assert.equal(third['iron:1'],0);
 assert.equal(third['iron:2'],0);
 assert.equal(third['iron:3'],1);
 assert.equal(old['iron:1'],25);
 assert.throws(()=>refineQuality(old,'iron',2,1),/INSUFFICIENT/);
 assert.throws(()=>refineQuality(old,'iron',3,1),/INVALID_REFINEMENT/);
});
test('F-01 quality: chest probabilities sum to 100 and preserve material count',()=>{
 for(const weights of Object.values(QUALITY_CHEST_WEIGHTS))assert.equal(weights.reduce((a,b)=>a+b,0),100);
 assert.equal(drawQuality('legendary',()=>99),3);
 assert.equal(drawQuality('wood',()=>99),1);
 const drop={tier:'silver',items:{iron:4,power_crystal:2}};
 let roll=0;
 const inventory=qualityChestDrop(drop,n=>(roll++*17)%n);
 assert.equal(Object.values(inventory).reduce((a,b)=>a+b,0),6);
 assert.deepEqual(emptyQualityInventory(),migrateQualityInventory({}));
 assert.throws(()=>qualityKey('invalid',1),/INVALID_QUALITY_RESOURCE/);
});
