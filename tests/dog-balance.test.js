import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DOG_MAX_EQUIPMENT_LEVEL,DOG_MAX_SKILL_LEVEL,DOG_CHEST_STAGES,DOG_BALANCE_MATERIALS,
 dogUnlockedLevels,dogChestStage,dogChestOffer,dogChestContents,dogEquipmentCost,dogEquipmentSuccessChance,
 dogWeaponBase,dogArmorBase,dogAttackChances,dogStrike,dogExpectedSoloDamage,dogMaxSoloDamage,
 dogMiniBossHp,dogGroupBossHp,dogIncomingDamage,dogHeroHp,dogDefenseChances
} from '../dog-balance.js';

const seeded=(initial=987321)=>{let seed=initial>>>0;return max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor((seed/2**32)*max)};};
const ratio=(weapon,skills,bossHp,tries=8000)=>{
 const rand=seeded(),ch=dogAttackChances(skills);
 let wins=0;
 for(let i=0;i<tries;i++){
  let damage=0;
  for(let a=0;a<4;a++)damage+=dogStrike({weaponLevel:weapon,skills,
   special:a===0,reaction:a===0,cleanHit:rand(100000)<ch.cleanHit*100000,
   critical:rand(100000)<ch.critical*100000,doubleStrike:rand(100000)<ch.doubleStrike*100000});
  if(damage>=bossHp)wins++;
 }
 return wins/tries;
};

test('Boss victories raise forge ceilings to gear 10 / skills 50',()=>{
 assert.deepEqual(dogUnlockedLevels(0),{equipment:1,skills:5});
 assert.deepEqual(dogUnlockedLevels(6),{equipment:7,skills:35});
 assert.deepEqual(dogUnlockedLevels(9),{equipment:10,skills:50});
 assert.equal(DOG_MAX_EQUIPMENT_LEVEL,10);
 assert.equal(DOG_MAX_SKILL_LEVEL,50);
});

test('Every new material is obtainable BEFORE its first relevant tier upgrade',()=>{
 const sampleCosts={};
 for(let level=2;level<=10;level++){
  const stage=level-2; // stage 0 before boss 10 unlocks weapon 2
  const weights=DOG_CHEST_STAGES[stage].weights;
  for(const type of ['weapon','armor']){
   const group=DOG_BALANCE_MATERIALS[type==='weapon'?'equipment':'defense'];
   const recipe=dogEquipmentCost(type,level);
   assert.ok(Object.keys(recipe).length>0);
   for(const [id,amount] of Object.entries(recipe)){
    assert.ok(amount>0);
    assert.ok(weights[group.indexOf(id)]>0,id+' unavailable prior to level '+level);
   }
   sampleCosts[type+'-'+level]=recipe;
  }
 }
 assert.deepEqual(sampleCosts['weapon-2'],{iron:3});
 assert.deepEqual(sampleCosts['weapon-10'],{mithril:2,dragonsteel:1});
});

test('Forge success odds decline gradually, without changing equipment on failure',()=>{
 assert.deepEqual(Array.from({length:9},(_,i)=>dogEquipmentSuccessChance(i+2)),
  [100,95,90,85,75,65,55,45,35]);
 assert.throws(()=>dogEquipmentSuccessChance(11));
});

test('Chest amount and rarity are frozen at award time, before opening',()=>{
 const first=dogChestOffer(7,()=>0);
 const second=dogChestOffer(87,()=>0);
 assert.deepEqual(first,{version:3,stage:0,count:1});
 assert.deepEqual(second,{version:3,stage:8,count:6});
 assert.equal(dogChestStage(14),1);
 assert.equal(dogChestStage(99),9);
 const opened=dogChestContents(first,()=>0);
 assert.deepEqual(opened,{count:1,stage:0,items:{focus_dust:1}});
 assert.throws(()=>dogChestContents({...first,count:100},()=>0),/DOG_BALANCE_INVALID_CHEST/);
});

test('Chest weights add to 100, grow gradually and never grant unconfigured rarities',()=>{
 const seen=new Set();
 for(const [stage,rule] of DOG_CHEST_STAGES.entries()){
  assert.equal(rule.weights.reduce((a,b)=>a+b,0),100);
  assert.ok(rule.min>=1&&rule.max<=10&&rule.min<=rule.max);
  for(let i=0;i<300;i++){
   const offered=dogChestOffer(stage*10+1,seeded(i*10000+stage));
   assert.ok(offered.count>=rule.min&&offered.count<=rule.max);
   const opened=dogChestContents(offered,seeded(i*10000+stage+3));
   assert.equal(Object.values(opened.items).reduce((a,b)=>a+b,0),offered.count);
   for(const id of Object.keys(opened.items)){
    seen.add(id);
    const group=Object.values(DOG_BALANCE_MATERIALS).find(g=>g.includes(id));
    assert.ok(group&&rule.weights[group.indexOf(id)]>0,id+' appeared at stage '+stage);
   }
  }
 }
 assert.equal(seen.has('iron'),true);
});

test('Weapon and armor base values double exactly through level 10',()=>{
 for(let l=2;l<=10;l++){
  assert.equal(dogWeaponBase(l),dogWeaponBase(l-1)*2);
  assert.equal(dogArmorBase(l),dogArmorBase(l-1)*2);
 }
 assert.equal(dogWeaponBase(10),51200);
 assert.equal(dogArmorBase(10),51200);
});

test('Abilities add percentage effects rather than flat 50-level overpowering',()=>{
 const basic=dogStrike({weaponLevel:2});
 const power=dogStrike({weaponLevel:2,skills:{attack_power:50}});
 assert.equal(basic,200);
 assert.equal(power,250); // +25%
 assert.equal(dogStrike({weaponLevel:10,skills:{attack_power:50}}),64000);
 assert.equal(dogStrike({weaponLevel:2,skills:{destruction:50},special:true}),240);
 assert.deepEqual(dogAttackChances({precision:50,critical:50,double_strike:50}),{
  cleanHit:.95,critical:.20,doubleStrike:.25
 });
 const incoming=dogIncomingDamage({armorLevel:3,enemyAttack:900});
 assert.ok(dogIncomingDamage({armorLevel:4,enemyAttack:900})<incoming);
 assert.ok(dogIncomingDamage({armorLevel:10,enemyAttack:900})>0);
 assert.ok(dogIncomingDamage({armorLevel:4,enemyAttack:900,skills:{resilience:50}})<
  dogIncomingDamage({armorLevel:4,enemyAttack:900}));
 assert.equal(dogHeroHp({vitality:50}),225);
 assert.deepEqual(dogDefenseChances({blocking:50,evasion:50,last_stand:50}),{
  block:.2,evasion:.1,lastStand:.2
 });
});

test('Every mini-boss is strong against previous gear, but feasible after upgrade',()=>{
 for(let level=1;level<=9;level++){
  const gate=level*10+5,oldCap=level*5,newCap=(level+1)*5,hp=dogMiniBossHp(gate);
  const prevMax={attack_power:oldCap,destruction:oldCap,
   precision:oldCap,critical:oldCap,double_strike:oldCap};
  assert.ok(hp>dogMaxSoloDamage(level,prevMax),'gate '+gate+' bypassed by old gear');
  const newSkills={attack_power:Math.floor(newCap*.65),destruction:Math.floor(newCap*.5),
   precision:Math.floor(newCap*.5),critical:Math.floor(newCap*.6),
   double_strike:Math.floor(newCap*.5)};
  const odds=ratio(level+1,newSkills,hp);
  assert.ok(odds>.8&&odds<1,'gate '+gate+' new-gear win chance '+odds);
  assert.ok(dogExpectedSoloDamage(level+1,newSkills)>hp);
 }
 assert.equal(dogMiniBossHp(5),280);
 assert.throws(()=>dogMiniBossHp(13));
});

test('Ten group bosses scale with old gear, not the newly unlocked next tier',()=>{
 let prior=0;
 for(let n=10;n<=100;n+=10){
  const hp=dogGroupBossHp(n);
  assert.ok(hp>prior,n+' did not scale');
  prior=hp;
 }
 assert.throws(()=>dogGroupBossHp(15));
});
