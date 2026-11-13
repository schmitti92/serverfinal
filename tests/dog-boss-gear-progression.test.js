import test from 'node:test';
import assert from 'node:assert/strict';
import {dogBossGearReadiness,dogNormalEquipmentPower,dogGroupBossHp,
 dogSimulateMiniBoss,dogNormalGateDifficulty,dogSimulateNormalGate}
 from '../dog-balance.js';
import {DOG_BOSS_GEAR_REQUIREMENTS,DOG_NORMAL_GATE_REQUIREMENTS}
 from '../dog-gates.js';
import {boss10DamagePotential,boss10State,boss10ResolveCombat}
 from '../dog-boss10.js';
import {groupBossDamagePotential,groupBossResolveCombat}
 from '../dog-group-boss.js';

const fixed=()=>0;
const fullSkills=cap=>({
 attack_power:cap,destruction:cap,precision:cap,critical:cap,
 double_strike:cap,vitality:cap,resilience:cap,regeneration:cap,
 blocking:cap,evasion:cap,last_stand:cap
});
const bossRoster=(gate,real,skillRate=1)=>Array.from({length:3},(_,i)=>{
 const tier=gate/10,skillCap=tier*5,k=Math.floor(skillCap*skillRate);
 return {uid:'hero'+i,weaponLevel:tier,armorLevel:tier,
  weaponRealLevel:real,armorRealLevel:real,
  skillPower:k,skillDestruction:k,skillDefense:k,skillGuard:k};
});

test('80 normal gates expose real level requirements without RNG and within forge chapter',()=>{
 assert.equal(DOG_NORMAL_GATE_REQUIREMENTS.length,80);
 for(const gate of DOG_NORMAL_GATE_REQUIREMENTS){
  const recommended=gate.recommendedWeaponLevel;
  const cap=(Math.floor((gate.gate-1)/10)+1)*5;
  assert.ok(recommended>=cap-4&&recommended<=cap,'gate '+gate.gate);
  const fight=dogSimulateNormalGate({gate:gate.gate,
   weaponLevel:recommended,armorLevel:gate.recommendedArmorLevel});
  assert.equal(fight.win,true,'recommended 1–50 levels clear gate '+gate.gate);
 }
});
test('all 20 mini and group bosses advertise the reachable previous-chapter forge target',()=>{
 assert.equal(DOG_BOSS_GEAR_REQUIREMENTS.length,20);
 assert.deepEqual(DOG_BOSS_GEAR_REQUIREMENTS.map(v=>v.gate),
  Array.from({length:20},(_,i)=>(i+1)*5));
 for(const entry of DOG_BOSS_GEAR_REQUIREMENTS){
  const cap=Math.ceil(entry.gate/10)*5;
  assert.equal(entry.recommendedWeaponLevel,cap);
  assert.equal(entry.recommendedArmorLevel,cap);
  assert.equal(entry.recommendedPlayers,entry.type==='group'?3:1);
  assert.ok(entry.recommendedSkillLevel>0&&entry.recommendedSkillLevel<=cap);
  assert.ok(entry.enemyMaxHp>0);
  assert.ok(Object.isFrozen(entry));
 }
});
test('each forged level from 1 to 50 monotonically improves real boss weapon and armor readiness',()=>{
 for(let tier=1;tier<=10;tier++){
  let previous=0;
  for(let real=(tier-1)*5+1;real<=tier*5;real++){
   const factor=dogBossGearReadiness(real,tier);
   assert.ok(factor>previous,'tier '+tier+' level '+real+' did not improve');
   assert.ok(factor<=1);
   previous=factor;
  }
  assert.equal(dogBossGearReadiness(tier*5,tier),1);
 }
 assert.equal(dogBossGearReadiness(undefined,1),1,'ongoing fights remain compatible');
 assert.ok(dogNormalEquipmentPower(10)>dogNormalEquipmentPower(9));
});
test('all ten mini-bosses receive independently higher attack and defense from each actual level',()=>{
 for(let gate=5;gate<=95;gate+=10){
  const tier=Math.ceil(gate/10),cap=tier*5,lower=cap-4;
  const skills=fullSkills(cap);
  let prevStrike=0,prevHeroHp=0;
  for(let actual=lower;actual<=cap;actual++){
   const fight=dogSimulateMiniBoss({gate,weaponLevel:tier,armorLevel:tier,
    weaponRealLevel:actual,armorRealLevel:actual,skills,rand:fixed});
   const strike=fight.timeline.find(entry=>entry.type==='hero-attack')?.damage;
   assert.ok(strike>prevStrike,'mini boss '+gate+' weapon '+actual);
   assert.ok(fight.maxHeroHp>prevHeroHp,'mini boss '+gate+' armor '+actual);
   prevStrike=strike;prevHeroHp=fight.maxHeroHp;
  }
 }
});
test('first group boss uses each 1–5 level, while saved pre-update fights keep their old roster strength',()=>{
 const heroes=real=>Array.from({length:3},(_,i)=>({uid:'a'+i,
  weaponLevel:1,armorLevel:1,weaponRealLevel:real,armorRealLevel:real,
  skillPower:5,skillDestruction:5,skillDefense:5,skillGuard:5}));
 let previous=0;
 for(let real=1;real<=5;real++){
  const current=boss10DamagePotential(heroes(real));
  assert.ok(current>previous,'Boss 10 weapon/armor upgrade '+real);
  previous=current;
 }
 assert.equal(boss10DamagePotential(heroes(5)),
  boss10DamagePotential(heroes(5).map(({weaponRealLevel,armorRealLevel,...rest})=>rest)));
 const saved=boss10State({phase:'fighting',roster:heroes(3)});
 assert.equal(saved.roster[0].weaponRealLevel,3);
 assert.equal(saved.roster[0].armorRealLevel,3);
 const old=boss10State({phase:'fighting',roster:[{uid:'a',weaponLevel:1,armorLevel:1}]});
 assert.equal(old.roster[0].weaponRealLevel,undefined);
 const weakened=heroes(4).slice(0,2);
 const duo=boss10ResolveCombat(weakened,weakened.map(p=>p.uid),fixed);
 assert.equal(duo.rareCritical,false,'unmaxed equipment cannot earn the duo jackpot');
});
test('all nine later shared bosses scale throughout their exact 5 levels; weak gear cannot win by luck',()=>{
 for(let gate=20;gate<=100;gate+=10){
  const cap=gate/2;
  let prior=0;
  for(let actual=cap-4;actual<=cap;actual++){
   const team=bossRoster(gate,actual,.75);
   const power=groupBossDamagePotential(gate,team);
   assert.ok(power>prior,'Boss '+gate+' lv '+actual+' did not improve');
   prior=power;
  }
  const fullyPrepared=bossRoster(gate,cap,1);
  const unready=bossRoster(gate,cap-4,0);
  assert.equal(groupBossResolveCombat(gate,unready,[],()=>0).win,false,
   'Boss '+gate+' needs forged equipment, not lucky rolls');
  assert.equal(groupBossResolveCombat(gate,fullyPrepared,[],()=>5000).win,true,
   'Boss '+gate+' is reachable with prepared trio');
  assert.ok(dogGroupBossHp(gate)>0);
 }
});
