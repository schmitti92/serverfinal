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

// Five visually distinct expedition boxes. Quantity is determined by
// the awarded box type, not by the player's later gate when opening it.
export const DOG_CHEST_TYPES=Object.freeze({
 wood:Object.freeze({label:'Holzkiste',min:1,max:3,countWeights:Object.freeze([50,35,15])}),
 iron:Object.freeze({label:'Eisenkiste',min:2,max:5}),
 silver:Object.freeze({label:'Silberkiste',min:4,max:8}),
 gold:Object.freeze({label:'Goldkiste',min:6,max:12}),
 legendary:Object.freeze({label:'Legendäre Truhe',min:10,max:30})
});
export const DOG_CHEST_TYPE_IDS=Object.freeze(Object.keys(DOG_CHEST_TYPES));

// Personal ten-gate chapters determine (a) the chance of each box type and
// (b) the rarity weights of each material. Every row sums to 100.
// Chest types: wood, iron, silver, gold, legendary.
// Material rarity: common, uncommon, rare, epic, legendary.
// More prestigious boxes first appear rarely; late-game size is NOT guaranteed.
const CHEST_STAGE_RULES=[
 {chestWeights:[85,9,4,1,1], weights:[95,5,0,0,0]},
 {chestWeights:[79,12,5,3,1], weights:[82,17,1,0,0]},
 {chestWeights:[65,23,7,4,1], weights:[73,24,3,0,0]},
 {chestWeights:[56,29,9,5,1], weights:[62,32,6,0,0]},
 {chestWeights:[47,31,14,6,2], weights:[55,32,12,1,0]},
 {chestWeights:[35,36,18,9,2], weights:[47,32,18,3,0]},
 {chestWeights:[28,36,22,11,3], weights:[40,30,23,6,1]},
 {chestWeights:[21,32,29,14,4], weights:[32,28,25,13,2]},
 {chestWeights:[16,28,32,19,5], weights:[26,26,27,17,4]},
 {chestWeights:[10,22,34,26,8], weights:[22,23,28,21,6]}
];
export const DOG_CHEST_STAGES=Object.freeze(CHEST_STAGE_RULES.map(rule=>{
 const eligible=DOG_CHEST_TYPE_IDS.filter((id,i)=>rule.chestWeights[i]>0);
 return Object.freeze({
  min:Math.min(...eligible.map(id=>DOG_CHEST_TYPES[id].min)),
  max:Math.max(...eligible.map(id=>DOG_CHEST_TYPES[id].max)),
  chestWeights:Object.freeze(rule.chestWeights),
  weights:Object.freeze(rule.weights)
 });
}));

// Version-3 draft offers can still be opened after updating the experiment.
// The original 3-tier live inventory has entirely separate receipts/storage.
const OLD_CHEST_STAGE_RANGES=Object.freeze([
 [1,3],[1,3],[2,3],[2,4],[3,5],[3,5],[3,5],[4,5],[4,5],[5,5]
]);
const weightedHundred=(weights,rand)=>{
 let value=randomDraw(rand,100);
 for(let i=0;i<weights.length;i++){
  value-=weights[i];
  if(value<0)return i;
 }
 throw Error('DOG_BALANCE_INVALID_WEIGHTS');
};

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
 return Math.min(9,Math.floor(Math.max(0,integer(personalGate,0,99,0))/10));
}
export function dogChestOffer(personalGate=0,rand=randomInt){
 const stage=dogChestStage(personalGate),rule=DOG_CHEST_STAGES[stage];
 const tier=DOG_CHEST_TYPE_IDS[weightedHundred(rule.chestWeights,rand)];
 const def=DOG_CHEST_TYPES[tier];
 const count=def.countWeights?
  def.min+weightedHundred(def.countWeights,rand):
  def.min+randomDraw(rand,def.max-def.min+1);
 // Store the stage, type and amount at AWARD time, not at OPEN time.
 return {version:4,stage,tier,count};
}
export function dogChestContents(offer,rand=randomInt){
 // Only trusted, server-issued/stored offers may be accepted by the real API.
 const stage=offer?.stage,count=offer?.count;
 if(!Number.isSafeInteger(stage)||stage<0||stage>=DOG_CHEST_STAGES.length||
    !Number.isSafeInteger(count))throw Error('DOG_BALANCE_INVALID_CHEST');
 const rule=DOG_CHEST_STAGES[stage];
 const legacy=offer?.version===3;
 const tier=offer?.tier;
 if(legacy){
  const [min,max]=OLD_CHEST_STAGE_RANGES[stage];
  if(count<min||count>max)throw Error('DOG_BALANCE_INVALID_CHEST');
 }else{
  const index=DOG_CHEST_TYPE_IDS.indexOf(tier);
  const def=DOG_CHEST_TYPES[tier];
  if(offer?.version!==4||index<0||rule.chestWeights[index]===0||
     count<def.min||count>def.max)
   throw Error('DOG_BALANCE_INVALID_CHEST');
 }
 const groups=Object.values(DOG_BALANCE_MATERIALS);
 // Existing inventory validator requires all 15 resource keys, even zeros.
 const items=Object.fromEntries(groups.flat().map(id=>[id,0]));
 for(let i=0;i<count;i++){
  const group=groups[randomDraw(rand,groups.length)];
  const rarity=weightedHundred(rule.weights,rand);
  const id=group[rarity];items[id]++;
 }
 return legacy?{count,items,stage}:{count,items,stage,tier};
}

// One weapon/armor tier per won boss. Materials are already available in small
// amounts in the ten-gate chapter immediately preceding the shared boss.
const UPGRADE_RECIPE=Object.freeze({
 2:[3,0,0,0,0],3:[2,1,0,0,0],4:[0,2,0,0,0],
 // First two boss chapters must be playable with wooden and iron chests.
 // Higher rarities are introduced later, not required as an early hard wall.
 5:[0,3,0,0,0],6:[3,1,0,0,0],7:[4,1,0,0,0],
 8:[4,2,0,0,0],9:[5,2,0,0,0],10:[5,3,0,0,0]
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
 // Near the upper bound of the previous tier: an extraordinarily lucky
 // veteran can still win early. New weapon + armor greatly improve the odds.
 return Math.ceil(dogMaxSoloDamage(priorGear,peakSkills)*(.95+.003*priorGear));
}
export function dogGroupBossHp(gate){
 if(!Number.isSafeInteger(gate)||gate<10||gate>100||gate%10!==0)throw Error('DOG_BALANCE_INVALID_GROUPBOSS');
 const gear=gate/10,cap=gear*DOG_SKILLS_PER_BOSS;
 const skills={attack_power:Math.floor(cap*.4),destruction:Math.floor(cap*.4),
  critical:Math.floor(cap*.4),double_strike:Math.floor(cap*.4),precision:Math.floor(cap*.4)};
 // Three players, six attacks each in a 30-second encounter. A modest
 // +0.6% HP per further group-boss chapter offsets the stronger endgame
 // skills without invalidating the intended well-geared 3-hero route.
 // Gate 10 remains unchanged; Gate 100 is only 5.4% above the old HP.
 const chapterPressure=1+.006*(gear-1);
 return Math.ceil(3*6*(dogExpectedSoloDamage(gear,skills)/DOG_SOLO_ATTACKS)*
  .85*chapterPressure);
}
/** Fixed, deterministic enemy difficulty for every non-boss Tor (1–99).
 * No per-fight random roll, no adapting an enemy to the player's stats.
 * Five actual weapon/armor upgrades matter inside each ten-gate chapter.
 * Gate 1 recommends level 1; gate 9 recommends level 5; gate 11 level 6;
 * and gate 99 level 50 (forge gates still lock later chapters normally).
 */
export const DOG_NORMAL_ATTACK_STYLES=Object.freeze([
 Object.freeze({id:'quick',hero:'Schneller Hieb',enemy:'Schneller Konter',icon:'⚡'}),
 Object.freeze({id:'power',hero:'Kraftschlag',enemy:'Schwerer Schlag',icon:'💥'}),
 Object.freeze({id:'precise',hero:'Präzisionsstoß',enemy:'Gezielter Angriff',icon:'🎯'})
]);
const dogNormalEquipmentLevel=value=>Number.isSafeInteger(value)?
 Math.max(1,Math.min(50,value)):1;
const dogNormalEquipmentPower=value=>{
 const level=dogNormalEquipmentLevel(value);
 return DOG_BASE_WEAPON_DAMAGE*2**Math.floor((level-1)/5)*
  (1+.16*((level-1)%5));
};
export function dogNormalGateDifficulty(gate){
 if(!Number.isSafeInteger(gate)||gate<1||gate>99||gate%5===0)
  throw Error('DOG_BALANCE_INVALID_NORMAL_GATE');
 const chapter=Math.floor((gate-1)/10)+1,step=(gate-1)%10+1;
 const recommendedLevel=(chapter-1)*5+1+Math.floor((step-1)/2);
 const base=dogNormalEquipmentPower(recommendedLevel);
 return Object.freeze({gate,chapter,step,
  recommendedWeaponLevel:recommendedLevel,recommendedArmorLevel:recommendedLevel,
  enemyMaxHp:Math.ceil(base*(3.1+.075*step)),
  enemyAttack:Math.ceil(base*(.62+.012*step)),
  enemyGuard:.04+.007*step});
}

/** Server-authoritative automatic fight: player attacks, surviving enemy
 * counters, and so on until one side actually reaches 0 LP. Three distinct
 * alternating attack patterns for both fighters. Every skill modifies a
 * tangible numeric value; there are NO hit, evade, critical or victory dice.
 * Rounds beyond ten have deterministic escalating enemy pressure to avoid
 * overlong stalemates (at most around 35 rounds even with lopsided equipment).
 */
export function dogSimulateNormalGate({gate,weaponLevel=1,armorLevel=1,skills={}}={}){
 const enemy=dogNormalGateDifficulty(gate);
 const weapon=dogNormalEquipmentLevel(weaponLevel);
 const armorLevelActual=dogNormalEquipmentLevel(armorLevel);
 const weaponPower=dogNormalEquipmentPower(weapon);
 const armorPower=dogNormalEquipmentPower(armorLevelActual);
 const level=id=>skill(skills,id);
 const heroMaxHp=Math.ceil(1.45*armorPower*
  (1+.01*level('vitality')+.004*level('last_stand')));
 let heroHp=heroMaxHp,enemyHp=enemy.enemyMaxHp;
 let damageDealt=0,damageTaken=0,healing=0,rounds=0;
 const timeline=[],attacks=DOG_NORMAL_ATTACK_STYLES.map(style=>({
  id:style.id,name:style.hero,enemyName:style.enemy,icon:style.icon,
  hits:0,damage:0,enemyHits:0,enemyDamage:0
 }));
 const heroFactors=[
  .92+.006*level('double_strike')+.003*level('precision'),
  1.32+.010*level('destruction')+.005*level('critical'),
  1.08+.009*level('precision')+.004*level('critical')
 ];
 const enemyFactors=[.93,1.25,1.04];
 while(heroHp>0&&enemyHp>0){
  const index=rounds%3,attack=attacks[index];
  const strike=Math.max(1,Math.floor(weaponPower*
   (1+.012*level('attack_power'))*heroFactors[index]*(1-enemy.enemyGuard)));
  const hit=Math.min(enemyHp,strike);
  enemyHp-=hit;damageDealt+=hit;attack.hits++;attack.damage+=hit;
  rounds++;
  timeline.push({round:rounds,actor:'hero',style:attack.id,name:attack.name,
   damage:hit,enemyHp,heroHp});
  if(enemyHp===0)break;
  // Every surviving enemy counterattacks. No missed turns or pure luck.
  const fatigue=1.2**Math.max(0,rounds-10);
  const rawStrike=Math.max(1,Math.ceil(enemy.enemyAttack*enemyFactors[index]*fatigue));
  const effectiveArmor=armorPower*(1+.01*level('resilience'));
  const mitigation=Math.min(.65,effectiveArmor/(effectiveArmor+1.5*rawStrike));
  const skillBlock=index===1?.006*level('blocking'):
   index===0?.004*level('evasion'):.004*level('last_stand');
  const damage=Math.max(1,Math.ceil(rawStrike*(1-mitigation)*
   (1-Math.min(.35,skillBlock))));
  const suffered=Math.min(heroHp,damage);
  heroHp-=suffered;damageTaken+=suffered;
  attack.enemyHits++;attack.enemyDamage+=suffered;
  const healed=heroHp>0?Math.min(heroMaxHp-heroHp,
   Math.round(heroMaxHp*.0015*level('regeneration'))):0;
  heroHp+=healed;healing+=healed;
  timeline.push({round:rounds,actor:'enemy',style:attack.id,name:attack.enemyName,
   damage:suffered,healed,enemyHp,heroHp});
 }
 const victory=enemyHp===0&&heroHp>0;
 const missingWeapon=weapon<enemy.recommendedWeaponLevel,
  missingArmor=armorLevelActual<enemy.recommendedArmorLevel;
 const feedback=victory?'Stärke und Rüstung haben den Gegner besiegt.':
  missingWeapon&&missingArmor?'Waffe und Rüstung verbessern.':
  missingWeapon?'Mehr Angriffskraft durch eine stärkere Waffe aufbauen.':
  missingArmor?'Rüstung und Lebensenergie verbessern.':
  'Erhöhe deinen Schaden, Lebenspunkte oder deine Verteidigungsfähigkeiten.';
 return {model:'alternating-three-attacks-v1',gate,win:victory,
  enemyMaxHp:enemy.enemyMaxHp,enemyRemainingHp:enemyHp,
  enemyDamageTaken:damageDealt,enemyAttack:enemy.enemyAttack,
  heroMaxHp,heroRemainingHp:heroHp,heroDamageTaken:damageTaken,
  healing,weaponLevel:weapon,armorLevel:armorLevelActual,
  recommendedWeaponLevel:enemy.recommendedWeaponLevel,
  recommendedArmorLevel:enemy.recommendedArmorLevel,
  rounds,attacks,timeline,feedback,
  chapter:enemy.chapter,step:enemy.step};
}

const topTwoMastery=(skills,ids,cap)=>{
 const sum=ids.map(id=>skill(skills,id)).sort((a,b)=>b-a).slice(0,2)
  .reduce((acc,n)=>acc+n,0);
 return Math.min(1,sum/(2*cap));
};

/** Mini-bosses have a fixed gate baseline, with only up to +10% adaptation
 * for over-geared heroes. NEVER scale down against weak heroes or match
 * their power 1:1; grinding equipment must remain rewarding. */
export function dogAdaptiveMiniBoss({gate,weaponLevel=1,armorLevel=1,skills={}}={}){
 const baseHp=dogMiniBossHp(gate),baseAttack=dogMiniBossAttack(gate);
 const recommended=(gate+5)/10,skillCap=Math.min(50,recommended*5);
 const attackMastery=topTwoMastery(skills,
  ['attack_power','destruction','precision','critical','double_strike'],skillCap);
 const defenseMastery=topTwoMastery(skills,
  ['vitality','resilience','regeneration','blocking','evasion','last_stand'],skillCap);
 const weaponExcess=Math.max(0,gearLevel(weaponLevel)-recommended);
 const armorExcess=Math.max(0,gearLevel(armorLevel)-recommended);
 const hpBonus=Math.min(.10,weaponExcess*.05+Math.max(0,attackMastery-.7)*.10);
 const attackBonus=Math.min(.10,armorExcess*.05+Math.max(0,defenseMastery-.7)*.10);
 return {gate,bossHp:Math.round(baseHp*(1+hpBonus)),
  bossAttack:Math.round(baseAttack*(1+attackBonus)),hpBonus,attackBonus};
}

export function dogMiniBossAttack(gate){
 if(!Number.isSafeInteger(gate)||gate<5||gate>95||gate%10!==5)
  throw Error('DOG_BALANCE_INVALID_MINIBOSS');
 const tier=(gate-5)/10; // 0 at gate 5, 9 at gate 95
 return Math.round(dogWeaponBase(tier+1)*(.72+.035*tier)*(tier===0?1.2:1.23));
}
export const DOG_MINI_BOSS_RETALIATION_CHANCE=.90;
export const DOG_MINI_BOSS_HEAVY_CHANCE=.20;
export const DOG_MINI_BOSS_HEAVY_MULTIPLIER=1.75;

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
 * Enemy responds to each nonlethal player strike; no pre-emptive instant KO.
 * Death/success are determined entirely on the server, never by the client.
 */
/** One concise, server-derived recommendation after an attempt. The client
 * never gets to choose whether it lost by damage or by survival. */
export function dogMiniBossFeedback(fight){
 if(!fight||typeof fight!=='object'||!Number.isSafeInteger(fight.gate))
  throw Error('DOG_BALANCE_INVALID_FIGHT_REPORT');
 if(fight.victory)return {reason:'victory',
  title:'Mini-Boss besiegt!',message:'Deine Ausrüstung hat sich bewährt.'};
 if(fight.heroHp<=0)return {reason:'defense',
  title:'Deine Rüstung reicht noch nicht aus',
  message:'Verbessere Rüstung, Lebensenergie, Blocken oder Widerstandskraft.'};
 return {reason:'attack',title:'Dir fehlt noch Angriffskraft',
  message:'Verbessere deine Waffe, Angriffskraft oder Vernichtungsschlag.'};
}

export function dogSimulateMiniBoss({gate,weaponLevel=1,armorLevel=1,skills={},
 reaction=false,rand=randomInt}={}){
 const opponent=dogAdaptiveMiniBoss({gate,weaponLevel,armorLevel,skills});
 const bossMaxHp=opponent.bossHp;
 const maxHeroHp=dogHeroHp(skills,armorLevel);
 const enemyAttack=opponent.bossAttack;
 const offense=dogAttackChances(skills),defense=dogDefenseChances(skills);
 let bossHp=bossMaxHp,heroHp=maxHeroHp,damageDealt=0;
 let lastStandUsed=false,turns=0,attacksReceived=0;
 const timeline=[];
 const roll=chance=>randomDraw(rand,1_000_000)<Math.round(chance*1_000_000);
 const retaliate=()=>{
  if(heroHp<=0||bossHp<=0||!roll(DOG_MINI_BOSS_RETALIATION_CHANCE))return;
  const blocked=roll(defense.block),dodged=roll(defense.evasion);
  // Mini-bosses sometimes land a clearly telegraphed heavy strike. This
  // makes armor upgrades matter even when a strong weapon kills in 3 hits.
  // Late bosses already deal larger attacks relative to hero protection.
  // Reduce heavy-hit frequency there, instead of forcing endless armor grinds.
  const heavyChance=gate===5?.08:DOG_MINI_BOSS_HEAVY_CHANCE;
  const heavy=roll(heavyChance);
  const strikeAttack=heavy?
   Math.round(enemyAttack*DOG_MINI_BOSS_HEAVY_MULTIPLIER):enemyAttack;
  const suffered=dogIncomingDamage({armorLevel,enemyAttack:strikeAttack,skills,blocked,dodged});
  heroHp=Math.max(0,heroHp-suffered);
  attacksReceived++;
  if(heroHp===0&&!lastStandUsed&&roll(defense.lastStand)){
   heroHp=1;lastStandUsed=true;
   timeline.push({type:'last-stand',heroHp});
  }
  timeline.push({type:'counterattack',damage:suffered,blocked,dodged,heavy,heroHp});
 };
 // Telegraph first, then let the player actually make the opening strike.
 // An instant KO before the first hit makes an otherwise fair fight frustrating.
 for(let i=0;i<DOG_SOLO_ATTACKS&&heroHp>0&&bossHp>0;i++){
  turns++;
  const cleanHit=roll(offense.cleanHit);
  const critical=roll(offense.critical),doubleStrike=roll(offense.doubleStrike);
  const damage=dogStrike({weaponLevel,skills,special:i===0,
   reaction:i===0&&reaction,cleanHit,critical,doubleStrike});
  const applied=Math.min(bossHp,damage);
  damageDealt+=applied;bossHp-=applied;
  timeline.push({type:'hero-attack',damage:applied,bossHp,cleanHit,
   critical,doubleStrike,special:i===0});
  if(bossHp===0)break;
  const healed= Math.min(maxHeroHp-heroHp,dogRegenerationPerAction(skills,armorLevel));
  heroHp+=healed;
  if(healed)timeline.push({type:'regeneration',amount:healed,heroHp});
  retaliate();
 }
 const result={gate,victory:bossHp===0&&heroHp>0,bossHp,bossMaxHp,heroHp,maxHeroHp,
  enemyAttack,turns,damageDealt,attacksReceived,timeline};
 return {...result,feedback:dogMiniBossFeedback(result)};
}
