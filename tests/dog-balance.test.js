import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DOG_MAX_EQUIPMENT_LEVEL,DOG_MAX_SKILL_LEVEL,DOG_SKILLS_PER_BOSS,DOG_SOLO_ATTACKS,DOG_CHEST_STAGES,DOG_CHEST_TYPES,DOG_CHEST_TYPE_IDS,DOG_BALANCE_MATERIALS,
 dogUnlockedLevels,dogChestStage,dogChestOffer,dogChestContents,dogEquipmentCost,dogEquipmentSuccessChance,
 dogWeaponBase,dogArmorBase,dogAttackChances,dogStrike,dogExpectedSoloDamage,dogMaxSoloDamage,
 dogMiniBossHp,dogMiniBossAttack,dogAdaptiveMiniBoss,dogNormalGateChance,dogResolveNormalGate,dogGroupBossHp,dogIncomingDamage,dogHeroHp,dogDefenseChances,dogSimulateMiniBoss,dogMiniBossFeedback
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
 assert.deepEqual(sampleCosts['weapon-10'],{iron:5,forge_coal:3});
});

test('Forge success odds decline gradually, without changing equipment on failure',()=>{
 assert.deepEqual(Array.from({length:9},(_,i)=>dogEquipmentSuccessChance(i+2)),
  [100,95,90,85,75,65,55,45,35]);
 assert.throws(()=>dogEquipmentSuccessChance(11));
});

test('Chest amount and rarity are frozen at award time, before opening',()=>{
 const first=dogChestOffer(7,()=>0);
 const second=dogChestOffer(87,()=>0);
 assert.deepEqual(first,{version:4,stage:0,tier:'wood',count:1});
 const woodRoll=roll=>{let call=0;return dogChestOffer(7,()=>call++===0?0:roll)};
 assert.deepEqual(woodRoll(49),{version:4,stage:0,tier:'wood',count:1});
 assert.deepEqual(woodRoll(50),{version:4,stage:0,tier:'wood',count:2});
 assert.deepEqual(woodRoll(84),{version:4,stage:0,tier:'wood',count:2});
 assert.deepEqual(woodRoll(85),{version:4,stage:0,tier:'wood',count:3});
 assert.deepEqual(woodRoll(99),{version:4,stage:0,tier:'wood',count:3});
 assert.deepEqual(second,{version:4,stage:8,tier:'wood',count:1});
 assert.equal(DOG_CHEST_STAGES[0].min,1);
 assert.equal(DOG_CHEST_STAGES[0].max,30);
 assert.deepEqual(DOG_CHEST_TYPES.wood.countWeights,[50,35,15]);
 assert.equal(dogChestStage(14),1);
 assert.equal(dogChestStage(99),9);
 assert.deepEqual(dogChestOffer(99,()=>0),{version:4,stage:9,tier:'wood',count:1});
 const opened=dogChestContents(first,()=>0);
 assert.equal(opened.count,1);
 assert.equal(opened.stage,0);
 assert.equal(opened.tier,'wood');
 assert.equal(opened.items.focus_dust,1);
 assert.equal(Object.keys(opened.items).length,15);
 assert.equal(Object.values(opened.items).reduce((sum,count)=>sum+count,0),1);
 assert.ok(Object.values(opened.items).every(count=>Number.isSafeInteger(count)&&count>=0));
 assert.throws(()=>dogChestContents({...first,count:100},()=>0),/DOG_BALANCE_INVALID_CHEST/);
});

test('Chest weights add to 100, grow gradually and never grant unconfigured rarities',()=>{
 const seen=new Set();
 for(const [stage,rule] of DOG_CHEST_STAGES.entries()){
  assert.equal(rule.weights.reduce((a,b)=>a+b,0),100);
  assert.equal(rule.chestWeights.reduce((a,b)=>a+b,0),100);
  assert.ok(rule.min>=1&&rule.max<=30&&rule.min<=rule.max);
  for(let i=0;i<300;i++){
   const offered=dogChestOffer(stage*10+1,seeded(i*10000+stage));
   assert.ok(offered.count>=DOG_CHEST_TYPES[offered.tier].min&&
    offered.count<=DOG_CHEST_TYPES[offered.tier].max);
   assert.ok(rule.chestWeights[DOG_CHEST_TYPE_IDS.indexOf(offered.tier)]>0);
   const opened=dogChestContents(offered,seeded(i*10000+stage+3));
   assert.equal(Object.values(opened.items).reduce((a,b)=>a+b,0),offered.count);
   for(const [id,quantity] of Object.entries(opened.items)){
    if(quantity===0)continue;
    seen.add(id);
    const group=Object.values(DOG_BALANCE_MATERIALS).find(g=>g.includes(id));
    assert.ok(group&&rule.weights[group.indexOf(id)]>0,id+' appeared at stage '+stage);
   }
  }
 }
 assert.equal(seen.has('iron'),true);
});

test('Five distinct chest types retain their defined material ranges',()=>{
 assert.deepEqual(DOG_CHEST_TYPE_IDS,['wood','iron','silver','gold','legendary']);
 assert.deepEqual(DOG_CHEST_TYPE_IDS.map(id=>{
  const {min,max}=DOG_CHEST_TYPES[id];return [min,max];
 }),[[1,3],[2,5],[4,8],[6,12],[10,30]]);
 assert.equal(DOG_CHEST_TYPES.wood.countWeights.reduce((a,b)=>a+b,0),100);
 const scenario=(gate,rolls)=>{
  let i=0;
  return dogChestOffer(gate,limit=>{
   const value=rolls[i++];
   assert.ok(value<limit,'invalid scripted draw '+value+' limit '+limit);
   return value;
  });
 };
 // Small chest stays 1–3 at the start, independent of later unlocks.
 assert.deepEqual(scenario(1,[0,85]),{version:4,stage:0,tier:'wood',count:3});
 // Iron begins at Tor 20 (20%); Silver at Tor 30 (5%).
 assert.equal(scenario(20,[70,0]).tier,'iron');
 assert.equal(scenario(30,[90,0]).tier,'silver');
 // Gold at Tor 50 (2%); Legendary at Tor 80 (3%).
 assert.equal(scenario(50,[92,0]).tier,'gold');
 assert.equal(scenario(80,[98,0]).tier,'legendary');
 assert.deepEqual(scenario(91,[93,0]),{version:4,stage:9,tier:'legendary',count:10});
 assert.deepEqual(scenario(91,[99,20]),{version:4,stage:9,tier:'legendary',count:30});
 assert.equal(DOG_CHEST_STAGES[0].chestWeights[4],1,
  'all five types are available from the start, even if very rare');
 const last=dogChestContents(scenario(91,[99,20]),()=>0);
 assert.equal(last.count,30);
 assert.equal(last.tier,'legendary');
 assert.equal(Object.values(last.items).reduce((a,b)=>a+b,0),30);
});

test('A chest is frozen on award and cannot be promoted by a forged client tier',()=>{
 const early=dogChestOffer(1,()=>0);
 assert.throws(()=>dogChestContents({...early,tier:'legendary'},()=>0),
  /DOG_BALANCE_INVALID_CHEST/);
 assert.throws(()=>dogChestContents({...early,count:4},()=>0),
  /DOG_BALANCE_INVALID_CHEST/);
 assert.throws(()=>dogChestContents({...early,tier:'iron',count:1},()=>0),
  /DOG_BALANCE_INVALID_CHEST/);
 // Prior experimental v3 snapshots remain readable after adding five types.
 const old=dogChestContents({version:3,stage:0,count:3},()=>0);
 assert.equal(old.count,3);
 assert.equal(old.stage,0);
 assert.equal(Object.values(old.items).reduce((a,b)=>a+b,0),3);
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
  assert.ok(hp<dogMaxSoloDamage(tier,oldMax),'extremely lucky old gear may win at '+gate);
  assert.ok(ratio(tier,oldMax,hp,12000)<.05,'old gear is winning too frequently at '+gate);
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
  console.log('Mini-Boss-Balance',gate,'voll',rate.toFixed(3),'nur Waffe',weakRate.toFixed(3));
  assert.ok(rate>.20&&rate<.85,'boss '+gate+' should be challenging, got '+rate);
  assert.ok(rate>weakRate+.12,'boss '+gate+' must reward improved armor: '+rate+' vs '+weakRate);
  assert.ok(dogMiniBossAttack(gate)>0);
 }
 assert.equal(dogMiniBossHp(5),370);
 assert.throws(()=>dogMiniBossHp(13));
});

test('Mini-boss produces a bounded animation timeline and useful defeat feedback',()=>{
 const zero=()=>0;
 const perfect=dogSimulateMiniBoss({gate:15,weaponLevel:2,armorLevel:2,
  skills:{attack_power:10,destruction:10,critical:10,double_strike:10},reaction:true,rand:zero});
 assert.ok(perfect.timeline.length>0 && perfect.timeline.length<=16);
 assert.equal(perfect.timeline[0].type,'hero-attack');
 assert.equal(perfect.feedback.reason,'victory');
 assert.ok(perfect.timeline.every(e=>!('playerUid' in e)));
 const weak=dogSimulateMiniBoss({gate:95,weaponLevel:1,armorLevel:1,rand:zero});
 assert.equal(weak.victory,false);
 assert.equal(weak.timeline[0].type,'hero-attack');
 assert.equal(weak.feedback.reason,'defense');
 const noDamage=dogMiniBossFeedback({gate:15,victory:false,heroHp:25});
 assert.equal(noDamage.reason,'attack');
 assert.throws(()=>dogMiniBossFeedback(null),/DOG_BALANCE_INVALID_FIGHT_REPORT/);
});

test('Normal gate chance is a smooth 30% to 80% readiness calculation',()=>{
 const g=13;
 const weak=dogNormalGateChance({gate:g,weaponLevel:1,armorLevel:1});
 assert.equal(weak.chancePercent,30);
 const good=dogNormalGateChance({gate:g,weaponLevel:2,armorLevel:2});
 assert.equal(good.chancePercent,60);
 const skills={attack_power:10,critical:10,vitality:10,resilience:10};
 const best=dogNormalGateChance({gate:g,weaponLevel:2,armorLevel:2,skills});
 assert.equal(best.chancePercent,80);
 const medium=dogNormalGateChance({gate:g,weaponLevel:2,armorLevel:2,
   skills:{attack_power:5,critical:5,vitality:5,resilience:5}});
 assert.equal(medium.chancePercent,70);
 assert.equal(dogNormalGateChance({gate:13,weaponLevel:1,armorLevel:1,
  skills:{attack_power:5,critical:5,vitality:5,resilience:5}}).chancePercent,40);
 assert.ok(dogNormalGateChance({gate:4}).chancePercent>=30);
 assert.throws(()=>dogNormalGateChance({gate:5}),/INVALID_NORMAL_GATE/);
 assert.throws(()=>dogNormalGateChance({gate:10}),/INVALID_NORMAL_GATE/);
 assert.throws(()=>dogNormalGateChance({gate:100}),/INVALID_NORMAL_GATE/);
});

test('Equipment is more influential than full mastery on every normal chapter',()=>{
 for(const gate of [13,33,63,93]){
  const recommended=Math.floor((gate-1)/10)+1;
  const masterySkills={attack_power:recommended*5,critical:recommended*5,
   vitality:recommended*5,resilience:recommended*5};
  const base={gate,weaponLevel:recommended-1,armorLevel:recommended-1};
  const weak=dogNormalGateChance(base);
  const skillOnly=dogNormalGateChance({...base,skills:masterySkills});
  const gearOnly=dogNormalGateChance({...base,weaponLevel:recommended,
   armorLevel:recommended});
  assert.equal(weak.chancePercent,30);
  assert.equal(skillOnly.chancePercent,50);
  assert.equal(gearOnly.chancePercent,60);
  assert.equal(dogNormalGateChance({...base,weaponLevel:recommended,
   armorLevel:recommended,skills:masterySkills}).chancePercent,80);
 }
});

test('Normal fight uses one server random draw and is retry-safe at the API level',()=>{
 const options={gate:13,weaponLevel:2,armorLevel:2};
 assert.equal(dogResolveNormalGate(options,()=>5999).win,true);
 assert.equal(dogResolveNormalGate(options,()=>6000).win,false);
 assert.equal(dogResolveNormalGate({...options,skills:{attack_power:10,critical:10,
  vitality:10,resilience:10}},()=>7999).win,true);
 assert.throws(()=>dogResolveNormalGate(options,()=>10000),/INVALID_RANDOM/);
 // The pure helper must be stored once in a server receipt; it is NOT a
 // replacement for an authenticated, idempotent API endpoint.
});

test('Mini-boss adjustment is bounded and never punishes weak builds',()=>{
 const baseline=dogAdaptiveMiniBoss({gate:25,weaponLevel:1,armorLevel:1});
 const suggested=dogAdaptiveMiniBoss({gate:25,weaponLevel:3,armorLevel:3});
 assert.equal(baseline.bossHp,dogMiniBossHp(25));
 assert.equal(baseline.bossAttack,dogMiniBossAttack(25));
 assert.equal(suggested.bossHp,baseline.bossHp);
 assert.equal(suggested.bossAttack,baseline.bossAttack);
 const intense=dogAdaptiveMiniBoss({gate:25,weaponLevel:8,armorLevel:8,
  skills:{attack_power:50,critical:50,vitality:50,resilience:50}});
 assert.ok(intense.bossHp<=Math.round(baseline.bossHp*1.10));
 assert.ok(intense.bossAttack<=Math.round(baseline.bossAttack*1.10));
 assert.ok(intense.hpBonus>0 && intense.hpBonus<=.10);
 assert.ok(intense.attackBonus>0 && intense.attackBonus<=.10);
 assert.throws(()=>dogAdaptiveMiniBoss({gate:20}),/INVALID_MINIBOSS/);
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

test('Group bosses gain small late-chapter HP pressure while keeping the 30-second setup',()=>{
 let prior=0;
 for(let gate=10;gate<=100;gate+=10){
  const gear=gate/10;
  const cap=gear*DOG_SKILLS_PER_BOSS;
  const skills={attack_power:Math.floor(cap*.4),destruction:Math.floor(cap*.4),
   critical:Math.floor(cap*.4),double_strike:Math.floor(cap*.4),
   precision:Math.floor(cap*.4)};
  const oldHp=3*6*(dogExpectedSoloDamage(gear,skills)/DOG_SOLO_ATTACKS)*.85;
  const actual=dogGroupBossHp(gate);
  assert.ok(actual>prior);
  assert.equal(actual,Math.ceil(oldHp*(1+.006*(gear-1))));
  assert.ok(actual<=Math.ceil(oldHp*1.054),'long-term boss HP scaling must stay controlled');
  prior=actual;
 }
});

test('Late-stage chests grow moderately while top forge materials stay rare',()=>{
 const chestAverage={wood:1.65,iron:3.5,silver:6,gold:9,legendary:20};
 const average=chapter=>DOG_CHEST_STAGES[chapter].chestWeights
  .reduce((sum,w,i)=>sum+w/100*chestAverage[DOG_CHEST_TYPE_IDS[i]],0);
 assert.ok(Math.abs(average(0)-2.2475)<1e-12);
 assert.ok(Math.abs(average(9)-6.915)<1e-12);
 for(let chapter=1;chapter<10;chapter++)
  assert.ok(average(chapter)>=average(chapter-1),
   'the material expectation must not decrease as players progress');
 assert.ok(average(9)<5*average(0));
 const firstIron=average(0)*DOG_CHEST_STAGES[0].weights[0]/100/3;
 const lastDragonsteel=average(9)*DOG_CHEST_STAGES[9].weights[4]/100/3;
 assert.ok(firstIron<0.8,'starting upgrades still require multiple chests');
 assert.ok(lastDragonsteel<0.15,'legendary upgrades remain a long-term project');
 assert.deepEqual(dogEquipmentCost('weapon',10),{iron:5,forge_coal:3});
});
