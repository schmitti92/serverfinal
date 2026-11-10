import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DOG_MAX_EQUIPMENT_LEVEL,DOG_MAX_SKILL_LEVEL,DOG_CHEST_STAGES,DOG_BALANCE_MATERIALS,
 dogUnlockedLevels,dogChestStage,dogChestOffer,dogChestContents,dogEquipmentCost,dogEquipmentSuccessChance,
 dogWeaponBase,dogArmorBase,dogAttackChances,dogStrike,dogExpectedSoloDamage,dogMaxSoloDamage,
 dogMiniBossHp,dogMiniBossAttack,dogGroupBossHp,dogIncomingDamage,dogHeroHp,dogDefenseChances,dogSimulateMiniBoss
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
 assert.equal(dogHeroHp({vitality:50}),218);
 assert.equal(dogHeroHp({vitality:50},2),435);
 assert.deepEqual(dogDefenseChances({blocking:50,evasion:50,last_stand:50}),{
  block:.2,evasion:.1,lastStand:.2
 });
});

test('All eleven skill bonuses are additive on weapon/armor base',()=>{
 // Stacking two bonuses changes the result by the sum, not their product.
 const base=dogWeaponBase(4);
 const one=dogStrike({weaponLevel:4,skills:{attack_power:50}});
 const both=dogStrike({weaponLevel:4,skills:{attack_power:50,destruction:50},
  special:true,critical:true,doubleStrike:true,reaction:true});
 assert.equal(one,base*1.25);
 assert.equal(both,Math.floor(base*(1+.25+.20+.25+.20+.10)));
 const attack=dogMiniBossAttack(35);
 const armor=dogArmorBase(4);
 const raw=(bonus=0)=>Math.ceil(attack*(1-Math.min(.65,
  armor*(1+bonus)/(armor*(1+bonus)+1.5*attack))));
 assert.equal(dogIncomingDamage({armorLevel:4,enemyAttack:attack,
  skills:{resilience:50},blocked:true}),raw(.15+.6));
});

test('First mini-boss is a real challenge, not an automatic first-attempt win',()=>{
 const trials=6000,rand=seeded(84010);let wins=0;
 for(let i=0;i<trials;i++){
  const result=dogSimulateMiniBoss({gate:5,weaponLevel:1,armorLevel:1,
   skills:{attack_power:2,critical:1,precision:1,vitality:2},rand});
  assert.ok(result.turns<=4);assert.ok(result.damageDealt>=0);
  if(result.victory)wins++;
 }
 assert.ok(wins/trials>.2 && wins/trials<.75,'tor 5 chance '+(wins/trials));
});

test('Mini-boss wins reward better weapon AND armor, with no artificial level lock',()=>{
 const trials=4500;
 for(let tier=1;tier<=9;tier++){
  const gate=tier*10+5,cap=(tier+1)*5,prevCap=tier*5;
  const oldMax={attack_power:prevCap,destruction:prevCap,
   precision:prevCap,critical:prevCap,double_strike:prevCap};
  const hp=dogMiniBossHp(gate);
  assert.ok(hp>dogMaxSoloDamage(tier,oldMax),'old gear cannot cheese boss '+gate);
  const skills={
   attack_power:Math.floor(cap*.65),destruction:Math.floor(cap*.5),
   precision:Math.floor(cap*.5),critical:Math.floor(cap*.6),
   double_strike:Math.floor(cap*.5),vitality:Math.floor(cap*.5),
   resilience:Math.floor(cap*.5),regeneration:Math.floor(cap*.4),
   blocking:Math.floor(cap*.4),evasion:Math.floor(cap*.3),last_stand:Math.floor(cap*.3)
  };
  const randFull=seeded(gate*2020),randWeak=seeded(gate*2020);
  let full=0,onlyWeapon=0;
  for(let i=0;i<trials;i++){
   full+=Number(dogSimulateMiniBoss({gate,weaponLevel:tier+1,
    armorLevel:tier+1,skills,rand:randFull}).victory);
   onlyWeapon+=Number(dogSimulateMiniBoss({gate,weaponLevel:tier+1,
    armorLevel:tier,skills,rand:randWeak}).victory);
  }
  const rate=full/trials,weakRate=onlyWeapon/trials;
  assert.ok(rate>.16&&rate<.9,'boss '+gate+' should be challenging, got '+rate);
  assert.ok(rate>weakRate+.12,'boss '+gate+' must reward improved armor: '+rate+' vs '+weakRate);
  assert.ok(dogMiniBossAttack(gate)>0);
 }
 assert.equal(dogMiniBossHp(5),370);
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
