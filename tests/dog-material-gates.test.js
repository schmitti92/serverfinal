import test from 'node:test';
import assert from 'node:assert/strict';
import {DOG_MATERIAL_RARITY_UNLOCKS,dogMaterialRarityCap} from '../dog-forge-progression.js';
import {DOG_BALANCE_MATERIALS,DOG_CHEST_STAGES,dogChestContents,dogEquipmentCost} from '../dog-balance.js';
import {dogInventory,addExpeditionChestToInventory,openExpeditionChestInInventory,rollDogMaterialChest} from '../dog-materials.js';
import {forgeExchange,forgeQuote,forgeRefine,forgeView} from '../dog-forge.js';

const late={version:4,tier:'legendary',stage:9,count:30};
const alwaysLast=limit=>limit-1;
const materialIndex=id=>Object.values(DOG_BALANCE_MATERIALS).find(group=>group.includes(id))?.indexOf(id);
const materialKinds=items=>Object.entries(items).filter(([,quantity])=>quantity>0).map(([id])=>materialIndex(id));

test('five material tiers require official shared forge promotions',()=>{
 assert.deepEqual(DOG_MATERIAL_RARITY_UNLOCKS.map(x=>[x.forgeLevel,x.boss]),
  [[1,0],[2,10],[3,20],[4,30],[6,50]]);
 assert.deepEqual(Array.from({length:10},(_,i)=>dogMaterialRarityCap({forgeLevel:i+1})),
  [0,1,2,3,3,4,4,4,4,4]);
 assert.equal(dogMaterialRarityCap({forgeLevel:1,sharedBosses:[10,20,30,40,50,60]}),0,
  'unused boss seals must not unlock materials before the shared forge level-up');
});
test('an early legendary chest still contains only normal materials',()=>{
 const early={version:4,tier:'legendary',stage:0,count:30};
 const dropped=dogChestContents(early,alwaysLast,0);
 assert.equal(dropped.count,30);
 assert.deepEqual(materialKinds(dropped.items),[0]);
 assert.equal(Object.values(dropped.items).reduce((a,b)=>a+b,0),30);
 // Even opening an old late-stage chest before a promotion cannot farm rare resources.
 const stored=addExpeditionChestToInventory(null,late);
 const opened=openExpeditionChestInInventory(stored,'legendary',alwaysLast,100,1,0);
 assert.equal(opened.drop.count,30);
 assert.ok(materialKinds(opened.drop.items).every(i=>i===0));
 assert.equal(opened.inventory.unopened,0);
});
test('late snapshots cannot be promoted above their earned chapter when forged later',()=>{
 const stage0={version:4,tier:'legendary',stage:0,count:30};
 const opened=dogChestContents(stage0,alwaysLast,4);
 assert.ok(materialKinds(opened.items).every(i=>i===0));
 for(let stage=0;stage<10;stage++){
  const weights=DOG_CHEST_STAGES[stage].weights;
  assert.equal(weights.reduce((a,b)=>a+b,0),100);
  for(let cap=0;cap<=4;cap++){
   const offer={version:4,tier:'wood',stage,count:2};
   const roll=dogChestContents(offer,alwaysLast,cap);
   assert.equal(Object.values(roll.items).reduce((a,b)=>a+b,0),2);
   assert.ok(materialKinds(roll.items).every(i=>i<=cap&&weights[i]>0));
  }
 }
});
test('legacy large boxes are high-volume, not a bypass for locked legendary resources',()=>{
 const low=rollDogMaterialChest('large',alwaysLast,0);
 assert.equal(low.count,40);
 assert.deepEqual(materialKinds(low.items),[0]);
 const high=rollDogMaterialChest('large',alwaysLast,4);
 assert.deepEqual(materialKinds(high.items),[4]);
 assert.equal(high.items.dragonsteel,40);
 const oldInventory=dogInventory({resources:{dragonsteel:12}});
 assert.equal(oldInventory.resources.dragonsteel,12,'historical resources remain untouched');
});
test('gear recipes remain craftable in every boss chapter; first legendary cost occurs late',()=>{
 for(let level=2;level<=5;level++)assert.deepEqual(Object.keys(dogEquipmentCost('weapon',level)),['iron']);
 assert.deepEqual(dogEquipmentCost('weapon',10),{iron:5,forge_coal:3});
 const beforeEpic=forgeQuote('weapon',14,{}, {forgeLevel:3,sharedBosses:[10,20]});
 assert.equal(beforeEpic.qualityLevel,1);
 assert.deepEqual(beforeEpic.cost,{forge_coal:4,steel_core:1});
 const firstEpic=forgeQuote('weapon',15,{}, {forgeLevel:4,sharedBosses:[10,20,30]});
 assert.equal(firstEpic.qualityLevel,1);
 assert.equal(firstEpic.cost.mithril,1);
 const twenty=forgeQuote('weapon',19,{}, {forgeLevel:4,sharedBosses:[10,20,30]});
 assert.equal(twenty.cost.dragonsteel,undefined);
 assert.equal(twenty.qualityLevel,1);
 const q2=forgeQuote('weapon',25,{}, {forgeLevel:6,sharedBosses:[10,20,30,40,50]});
 assert.equal(q2.qualityLevel,2);
 const q3=forgeQuote('weapon',40,{}, {forgeLevel:9,sharedBosses:[10,20,30,40,50,60,70,80]});
 assert.equal(q3.qualityLevel,3);
});
test('10:1 exchange and refinement cannot mint locked tiers before the official forge seal',()=>{
 const bag=dogInventory({resources:{iron:100,forge_coal:100,steel_core:100,mithril:100,dragonsteel:100}});
 assert.throws(()=>forgeExchange(null,bag,'iron',100,1,1,{forgeLevel:1}),/DOG_MATERIAL_LOCKED/);
 const coal=forgeExchange(null,bag,'iron',100,1,1,{forgeLevel:2,sharedBosses:[10]});
 assert.equal(coal.result.to,'forge_coal');
 assert.throws(()=>forgeExchange(null,bag,'forge_coal',100,1,1,{forgeLevel:2,sharedBosses:[10]}),/DOG_MATERIAL_LOCKED/);
 assert.throws(()=>forgeExchange(null,bag,'mithril',100,1,1,{forgeLevel:4,sharedBosses:[10,20,30]}),/DOG_MATERIAL_LOCKED/);
 const dragon=forgeExchange(null,bag,'mithril',100,1,1,{forgeLevel:6,sharedBosses:[10,20,30,40,50]});
 assert.equal(dragon.result.to,'dragonsteel');
 assert.throws(()=>forgeRefine(null,bag,'mithril',1,1,100,{forgeLevel:1,sharedBosses:[10,20,30]},0),/DOG_MATERIAL_LOCKED/);
 const view=forgeView(null,bag,{forgeLevel:3,sharedBosses:[10,20]});
 assert.equal(view.materialRarityCap,2);
 assert.equal(view.materialRarityUnlocks.length,5);
});
