import {randomInt} from 'node:crypto';
/** Die 100 Tore — isolated balance model (not wired into live endpoints yet).
 * All probabilities, upgrade costs and damage calculations are server-side rules.
 * A chest freezes its size and material table when awarded, not when opened.
 */
export const DOG_MAX_EQUIPMENT_LEVEL=10;
export const DOG_MAX_SKILL_LEVEL=50;
export const DOG_SKILLS_PER_BOSS=5;
export const DOG_SOLO_ATTACKS=4;
export const DOG_BASE_WEAPON_DAMAGE=100;
export const DOG_BASE_ARMOR=100;

// Mirrors the three category-bound five-tier material groups in dog-materials.js.
export const DOG_BALANCE_MATERIALS=Object.freeze({
 attack:Object.freeze(['focus_dust','power_crystal','battle_essence','war_rune','soul_shard']),
 defense:Object.freeze(['life_dust','guard_crystal','life_essence','guardian_rune','phoenix_feather']),
 equipment:Object.freeze(['iron','forge_coal','steel_core','mithril','dragonsteel'])
});

// Each stage begins when the player reaches its own ten-gate chapter. These
// preview drops arrive BEFORE the corresponding shared boss is beaten.
// Weight indices: common, uncommon, rare, epic, legendary. Sum = 100.
export const DOG_CHEST_STAGES=Object.freeze([
 {min:1,max:2,weights:[95,5,0,0,0]},
 {min:1,max:3,weights:[82,17,1,0,0]},
 {min:2,max:3,weights:[73,24,3,0,0]},
 {min:2,max:4,weights:[62,32,6,0,0]},
 {min:3,max:5,weights:[55,32,12,1,0]},
 {min:3,max:6,weights:[47,32,18,3,0]},
 {min:4,max:7,weights:[40,30,23,6,1]},
 {min:5,max:8,weights:[32,28,25,13,2]},
 {min:6,max:9,weights:[26,26,27,17,4]},
 {min:7,max:10,weights:[22,23,28,21,6]}
].map(x=>Object.freeze({...x,weights:Object.freeze(x.weights)})));

const integer=(value,min,max,fallback=min)=>Number.isSafeInteger(value)?Math.max(min,Math.min(max,value)):fallback;
const level=(value,max)=>integer(value,0,max,0);
const gearLevel=value=>integer(value,1,DOG_MAX_EQUIPMENT_LEVEL,1);
const randomDraw=(rand,n)=>{const x=rand(n);if(!Number.isSafeInteger(x)||x<0||x>=n)throw Error('DOG_BALANCE_INVALID_RANDOM');return x;};
const skill=(skills,id)=>level(skills?.[id],DOG_MAX_SKILL_LEVEL);

export function dogUnlockedLevels(sharedBossesWon=0){
 const wins=integer(sharedBossesWon,0,9,0);
 return {equipment:1+wins,skills:Math.min(DOG_MAX_SKILL_LEVEL,(wins+1)*DOG_SKILLS_PER_BOSS)};
}
export function dogChestStage(personalGate=0){
 // The personal path can continue beyond an unbeaten shared boss.
 return Math.min(9,Math.floor(Math.max(0,integer(personalGate,0,99,0)-1)/10));
}
export function dogChestOffer(personalGate=0,rand=randomInt){
 const stage=dogChestStage(personalGate),rule=DOG_CHEST_STAGES[stage];
 return {version:3,stage,count:rule.min+randomDraw(rand,rule.max-rule.min+1)};
}
export function dogChestContents(offer,rand=randomInt){
 // Only server-issued/stored offers must be accepted by the real API.
 const stage=offer?.stage,count=offer?.count;
 if(!Number.isSafeInteger(stage)||stage<0||stage>=DOG_CHEST_STAGES.length||
    !Number.isSafeInteger(count)||count<DOG_CHEST_STAGES[stage].min||
    count>DOG_CHEST_STAGES[stage].max||offer?.version!==3)
  throw Error('DOG_BALANCE_INVALID_CHEST');
 const rule=DOG_CHEST_STAGES[stage];
 const groups=Object.values(DOG_BALANCE_MATERIALS);
 const items={};
 for(let i=0;i<count;i++){
  const group=groups[randomDraw(rand,groups.length)];
  let r=randomDraw(rand,100),rarity=0;
  for(;rarity<rule.weights.length-1;rarity++){
   r-=rule.weights[rarity];if(r<0)break;
  }
  const id=group[rarity];items[id]=(items[id]||0)+1;
 }
 return {count,items,stage};
}

// One weapon/armor tier per won boss. Materials are already available in small
// amounts in the ten-gate chapter immediately preceding the shared boss.
const UPGRADE_RECIPE=Object.freeze({
 2:[3,0,0,0,0],3:[2,1,0,0,0],4:[0,2,0,0,0],
 5:[0,2,1,0,0],6:[0,0,3,0,0],7:[0,0,2,1,0],
 8:[0,0,0,2,0],9:[0,0,0,3,0],10:[0,0,0,2,1]
});
export function dogEquipmentSuccessChance(nextLevel){
 if(!Number.isSafeInteger(nextLevel)||nextLevel<2||nextLevel>10)throw Error('DOG_BALANCE_INVALID_LEVEL');
 return [0,0,100,95,90,85,75,65,55,45,35][nextLevel];
}
export function dogEquipmentCost(type,nextLevel){
 if(type!=='weapon'&&type!=='armor')throw Error('DOG_BALANCE_INVALID_EQUIPMENT');
 if(!Number.isSafeInteger(nextLevel)||nextLevel<2||nextLevel>10)throw Error('DOG_BALANCE_INVALID_LEVEL');
 const group=DOG_BALANCE_MATERIALS[type==='weapon'?'equipment':'defense'];
 return Object.fromEntries(UPGRADE_RECIPE[nextLevel].flatMap((count,i)=>count?[[group[i],count]]:[]));
}

export function dogWeaponBase(weaponLevel=1){return DOG_BASE_WEAPON_DAMAGE*2**(gearLevel(weaponLevel)-1);}
export function dogArmorBase(armorLevel=1){return DOG_BASE_ARMOR*2**(gearLevel(armorLevel)-1);}
export function dogAttackChances(skills={}){
 return {
  cleanHit:Math.min(.95,.85+.002*skill(skills,'precision')),
  critical:Math.min(.20,.05+.003*skill(skills,'critical')),
  doubleStrike:Math.min(.25,.005*skill(skills,'double_strike'))
 };
}
export function dogStrike({weaponLevel=1,skills={},special=false,cleanHit=true,critical=false,doubleStrike=false,reaction=false}={}){
 const power=skill(skills,'attack_power'),destruction=skill(skills,'destruction');
 const base=dogWeaponBase(weaponLevel);
 // Every ability adds a percentage OF THE UNMODIFIED WEAPON BASE.
 // No multiplicative stacking of skill, critical, double strike or reaction.
 const bonus=.005*power+(special?.004*destruction:0)+
  (critical?.25:0)+(doubleStrike?.20:0)+(reaction?.10:0)-(cleanHit?0:.35);
 const raw=base*(1+bonus);
 return Math.max(1,Math.floor(raw));
}
export function dogExpectedSoloDamage(weaponLevel=1,skills={}){
 const {cleanHit,critical,doubleStrike}=dogAttackChances(skills);
 const base=dogWeaponBase(weaponLevel);
 // Four actions; the single special adds its bonus on the same weapon base.
 // The displayed estimate assumes a successful single reaction (10% once).
 return base*(4*(1+.005*skill(skills,'attack_power')-
  .35*(1-cleanHit)+.25*critical+.20*doubleStrike)+
  .004*skill(skills,'destruction')+.10);
}
export function dogMaxSoloDamage(weaponLevel=1,skills={}){
 // Strict bound: four full critical/double hits and one perfect reaction.
 const normal=dogStrike({weaponLevel,skills,critical:true,doubleStrike:true});
 const special=dogStrike({weaponLevel,skills,special:true,critical:true,doubleStrike:true,reaction:true});
 return normal*3+special;
}
export function dogMiniBossHp(gate){
 if(!Number.isSafeInteger(gate)||gate<5||gate>95||gate%10!==5)throw Error('DOG_BALANCE_INVALID_MINIBOSS');
 if(gate===5)return 370; // teaching mini-boss: challenging even on gear 1
 const priorGear=(gate-5)/10;
 const priorSkillCap=priorGear*DOG_SKILLS_PER_BOSS;
 const peakSkills={attack_power:priorSkillCap,destruction:priorSkillCap};
 // A boss is a meaningful milestone; weapon upgrades alone are NOT sufficient.
 // No explicit level lock. Earlier gear can still enter and fight.
 const factor=priorGear<=4?1.10:1.04;
 return Math.ceil(dogMaxSoloDamage(priorGear,peakSkills)*factor);
}
export function dogGroupBossHp(gate){
 if(!Number.isSafeInteger(gate)||gate<10||gate>100||gate%10!==0)throw Error('DOG_BALANCE_INVALID_GROUPBOSS');
 const gear=gate/10,cap=gear*DOG_SKILLS_PER_BOSS;
 const skills={attack_power:Math.floor(cap*.4),destruction:Math.floor(cap*.4),
  critical:Math.floor(cap*.4),double_strike:Math.floor(cap*.4),precision:Math.floor(cap*.4)};
 // 3 players, each 6 attacks in 30s. 85% of expected team output.
 return Math.ceil(3*6*(dogExpectedSoloDamage(gear,skills)/DOG_SOLO_ATTACKS)*.85);
}
/** A mini-boss scales its attacks with the armor level newly unlocked by the
 * prior shared boss. 80% telegraphed retaliation probability, not certainty. */
export function dogMiniBossAttack(gate){
 if(!Number.isSafeInteger(gate)||gate<5||gate>95||gate%10!==5)
  throw Error('DOG_BALANCE_INVALID_MINIBOSS');
 const tier=(gate-5)/10; // 0 at gate 5, 9 at gate 95
 return Math.round(dogWeaponBase(tier+1)*(.72+.045*tier));
}
export const DOG_MINI_BOSS_RETALIATION_CHANCE=.80;

export function dogIncomingDamage({armorLevel=1,enemyAttack=100,skills={},blocked=false,dodged=false}={}){
 if(dodged)return 0;
 const strike=Math.max(0,Number(enemyAttack)||0);
 // Resilience and a successful block ADD protection to the original armor base.
 const armor=dogArmorBase(armorLevel);
 const rating=armor*(1+.003*skill(skills,'resilience')+(blocked?.60:0));
 const mitigation=Math.min(.65,rating/(rating+1.5*strike));
 return Math.max(0,Math.ceil(strike*(1-mitigation)));
}
export function dogHeroHp(skills={},armorLevel=1){
 return Math.round(1.45*dogArmorBase(armorLevel)*(1+.01*skill(skills,'vitality')));
}
export function dogRegenerationPerAction(skills={},armorLevel=1){
 return Math.round(dogHeroHp(skills,armorLevel)*.001*skill(skills,'regeneration'));
}
export function dogDefenseChances(skills={}){
 return {block:.004*skill(skills,'blocking'),evasion:.002*skill(skills,'evasion'),
  lastStand:.004*skill(skills,'last_stand')};
}

/** Pure full fight. The server must authorize any player reaction before passing
 * reaction=true, and must settle one receipt per completed personal gate.
 * Enemy opens with a counterattack, then responds after each nonlethal strike.
 * Death/success are determined entirely on the server, never by the client.
 */
export function dogSimulateMiniBoss({gate,weaponLevel=1,armorLevel=1,skills={},
 reaction=false,rand=randomInt}={}){
 const bossMaxHp=dogMiniBossHp(gate);
 const maxHeroHp=dogHeroHp(skills,armorLevel);
 const enemyAttack=dogMiniBossAttack(gate);
 const offense=dogAttackChances(skills),defense=dogDefenseChances(skills);
 let bossHp=bossMaxHp,heroHp=maxHeroHp,damageDealt=0;
 let lastStandUsed=false,turns=0,attacksReceived=0;
 const roll=chance=>randomDraw(rand,1_000_000)<Math.round(chance*1_000_000);
 const retaliate=()=>{
  if(heroHp<=0||bossHp<=0||!roll(DOG_MINI_BOSS_RETALIATION_CHANCE))return;
  const blocked=roll(defense.block),dodged=roll(defense.evasion);
  heroHp=Math.max(0,heroHp-dogIncomingDamage({armorLevel,enemyAttack,skills,blocked,dodged}));
  attacksReceived++;
  if(heroHp===0&&!lastStandUsed&&roll(defense.lastStand)){
   heroHp=1;lastStandUsed=true;
  }
 };
 retaliate(); // the boss opens
 for(let i=0;i<DOG_SOLO_ATTACKS&&heroHp>0&&bossHp>0;i++){
  turns++;
  const damage=dogStrike({weaponLevel,skills,special:i===0,
   reaction:i===0&&reaction,cleanHit:roll(offense.cleanHit),
   critical:roll(offense.critical),doubleStrike:roll(offense.doubleStrike)});
  const applied=Math.min(bossHp,damage);
  damageDealt+=applied;bossHp-=applied;
  if(bossHp===0)break;
  heroHp=Math.min(maxHeroHp,heroHp+dogRegenerationPerAction(skills,armorLevel));
  retaliate();
 }
 return {gate,victory:bossHp===0&&heroHp>0,bossHp,bossMaxHp,heroHp,maxHeroHp,
  enemyAttack,turns,damageDealt,attacksReceived};
}
