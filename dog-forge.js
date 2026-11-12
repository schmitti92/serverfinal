/**
 * The 100 Gates · forge V1.
 * Tunable crafting rules live here; no boss-combat values are locked in.
 * All spending and hero upgrades are authenticated, atomic and idempotent.
 */
import {randomInt} from 'node:crypto';
import {DOG_MATERIALS_COLLECTION,DOG_RESOURCE_GROUPS,DOG_RESOURCES,dogInventory} from './dog-materials.js';
import {dogEquipmentCost,dogEquipmentSuccessChance} from './dog-balance.js';
import {DOG_EQUIPMENT_MAX_LEVEL,dogForgeProgress,dogForgeLevelUp} from './dog-forge-progression.js';
import {qualityKey,refineQuality,qualityUnlockedFromBosses,reconcileQualityInventory} from './dog-f01-quality-prototype.mjs';

export const DOG_HERO_COLLECTION='dog_hero_v1';
export const DOG_FORGE_RECEIPTS_COLLECTION='dog_forge_receipts_v1';

const object=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const bounded=(v,min,max,fallback)=>Number.isSafeInteger(v)&&v>=min&&v<=max?v:fallback;
const item=(id,group,name,icon,summary,maxLevel,baseLevel=0)=>
 Object.freeze({id,group,name,icon,summary,maxLevel,baseLevel});
export const DOG_FORGE_ITEMS=Object.freeze([
 item('weapon','equipment','Waffe','⚔️','Mehr Grundschaden',DOG_EQUIPMENT_MAX_LEVEL,1),
 item('armor','equipment','Rüstung','🛡️','Mehr Grundschutz',DOG_EQUIPMENT_MAX_LEVEL,1),
 item('destruction','attack','Vernichtungsschlag','💀','Mächtiger Spezialschlag',50),
 item('precision','attack','Präzision','🎯','Treffsicherer angreifen',50),
 item('double_strike','attack','Doppelschlag','⚡','Chance auf Zusatzschlag',50),
 item('attack_power','attack','Angriffskraft','⚔️','Mehr Angriffsstärke',50),
 item('critical','attack','Kritische Treffer','💥','Chance auf kritischen Treffer',50),
 item('regeneration','defense','Regeneration','💚','LP im Kampf regenerieren',50),
 item('blocking','defense','Blocken','🛡️','Treffer stärker abwehren',50),
 item('evasion','defense','Ausweichen','💨','Angriffen entkommen',50),
 item('resilience','defense','Widerstandskraft','🪨','Weniger Schaden erhalten',50),
 item('vitality','defense','Lebensenergie','❤️','Mehr maximale LP',50),
 item('last_stand','defense','Letzter Widerstand','🔥','Tödlichen Treffer überstehen',50)
]);
export const DOG_FORGE_ITEM_BY_ID=Object.freeze(Object.fromEntries(DOG_FORGE_ITEMS.map(i=>[i.id,i])));
export const DOG_FORGE_GROUPS=Object.freeze({
 equipment:Object.freeze({title:'Waffen & Rüstung',icon:'🔨'}),
 attack:Object.freeze({title:'Angriffsfähigkeiten',icon:'⚔️'}),
 defense:Object.freeze({title:'Verteidigungsfähigkeiten',icon:'🛡️'})
});
// Draft values only. Future boss balancing adjusts this table, not stored levels.
export const DOG_FORGE_TUNING=Object.freeze({
 exchangeRate:10,
 exchangeMaxBatch:100,
 equipmentSuccess:[
  {max:2,chance:100},{max:5,chance:95},{max:10,chance:80},
  {max:15,chance:65},{max:19,chance:45},{max:20,chance:25}
 ],
 skillBonusPercentPerLevel:1
});
// Bounded journal lives in the existing hero document; no extra Firestore reads.
const FORGE_JOURNAL_LIMIT=10;
function normalizeJournal(value){
 if(!Array.isArray(value))return [];
 return value.slice(0,FORGE_JOURNAL_LIMIT).flatMap(entry=>{
  const e=object(entry),at=bounded(e.at,0,10_000_000_000_000,0);
  if(e.type==='upgrade'&&DOG_FORGE_ITEM_BY_ID[e.itemId]){
   const item=DOG_FORGE_ITEM_BY_ID[e.itemId];
   return [{type:'upgrade',itemId:e.itemId,success:e.success===true,
    level:bounded(e.level,item.baseLevel,item.maxLevel,item.baseLevel),at}];
  }
  if(e.type==='refine'&&DOG_RESOURCES.includes(e.resourceId))
   return [{type:'refine',resourceId:e.resourceId,fromQuality:bounded(e.fromQuality,1,2,1),
    count:bounded(e.count,1,DOG_FORGE_TUNING.exchangeMaxBatch,1),success:e.success===true,at}];
  if(e.type==='exchange'&&DOG_RESOURCES.includes(e.from)&&DOG_RESOURCES.includes(e.to))
   return [{type:'exchange',from:e.from,to:e.to,
     count:bounded(e.count,1,DOG_FORGE_TUNING.exchangeMaxBatch,1),at}];
  return [];
 });
}
export function dogHero(raw){
 const d=object(raw),levels=object(d.levels),result={};
 for(const i of DOG_FORGE_ITEMS)result[i.id]=bounded(levels[i.id],i.baseLevel,i.maxLevel,i.baseLevel);
 return {version:1,levels:result,crafts:bounded(d.crafts,0,1_000_000,0),
  successes:bounded(d.successes,0,1_000_000,0),
  failures:bounded(d.failures,0,1_000_000,0),
  exchanges:bounded(d.exchanges,0,1_000_000,0),
  recent:normalizeJournal(d.recent),
  updatedAt:bounded(d.updatedAt,0,10_000_000_000_000,0)};
}
const costFor=(group,next,itemId=null)=>{
 // Armor keeps using defense materials even beyond equipment level ten.
 const r=DOG_RESOURCE_GROUPS[itemId==='armor'?'defense':group];
 if(!r)throw Error('INVALID_FORGE_ITEM');
 const out={};
 const add=(index,amount)=>{out[r[index]]=amount;};
 if(group==='equipment'){
  if(next<=5)add(0,1+next);
  else if(next<=10){add(0,3);add(1,2+Math.floor((next-6)/2));}
  else if(next<=15){add(1,3);add(2,1+Math.floor((next-11)/2));}
  else if(next<=18){add(2,3);add(3,1+Math.floor((next-16)/2));}
  else if(next<=20){add(3,next===20?4:3);add(4,1);}
  else if(next<=30){add(2,3+Math.floor((next-21)/5));add(3,2+Math.floor((next-21)/5));}
  else if(next<=40){add(3,4+Math.floor((next-31)/4));add(4,1+Math.floor((next-31)/5));}
  else {add(3,6+Math.floor((next-41)/3));add(4,3+Math.floor((next-41)/3));}
 }else{
  if(next<=10)add(0,1+Math.floor((next-1)/4));
  else if(next<=20){add(0,3);add(1,1+Math.floor((next-11)/5));}
  else if(next<=30){add(1,2);add(2,1+Math.floor((next-21)/5));}
  else if(next<=40){add(2,2);add(3,1+Math.floor((next-31)/5));}
  else if(next<50){add(2,2);add(3,3+Math.floor((next-41)/5));}
  else{add(3,4);add(4,1);}
 }
 return out;
};
// Gate team and progress collection IDs are kept as constants here to avoid
// an import cycle (dog-gates.js -> dog-forge.js).
const EXPEDITION_TEAM_COLLECTION='dog_boss_team_v1';
const EXPEDITION_TEAM_ID='first-three-heroes';
const EXPEDITION_PROGRESS_COLLECTION='dog_gate_progress_v1';
const EXPEDITION_PROGRESS_ID='first-three-heroes';
export function forgeGateCap(progressRaw){
 const p=dogForgeProgress(progressRaw);
 return {equipment:p.equipmentCap,skills:p.skillsCap,forgeLevel:p.forgeLevel,
  bossSeals:p.bossSeals,earnedBossSeals:p.wins};
}
export function forgeQuote(itemId,currentLevel,resources={},progressRaw=undefined,qualityResources=undefined){
 const definition=DOG_FORGE_ITEM_BY_ID[itemId];
 if(!definition)throw Error('INVALID_FORGE_ITEM');
 const gateMode=progressRaw!==undefined;
 const equipment=definition.group==='equipment';
 const maxLevel=definition.maxLevel;
 const cap=gateMode?forgeGateCap(progressRaw):null;
 const unlockedMaxLevel=cap?(equipment?cap.equipment:cap.skills):maxLevel;
 const level=bounded(currentLevel,definition.baseLevel,definition.maxLevel,definition.baseLevel);
 // A prior level 11–20 remains intact in the database, never clipped.
 const maxed=level>=maxLevel;
 const nextLevel=maxed?null:level+1;
 const cost=maxed?{}:
  gateMode&&equipment&&nextLevel<=10?dogEquipmentCost(itemId,nextLevel):costFor(definition.group,nextLevel,itemId);
 const successChance=equipment&&!maxed?
  gateMode&&nextLevel<=10?dogEquipmentSuccessChance(nextLevel):
  nextLevel>10?Math.max(45,88-Math.floor((nextLevel-11)/5)*5):
  DOG_FORGE_TUNING.equipmentSuccess.find(x=>nextLevel<=x.max)?.chance??25:100;
 const locked=!maxed&&nextLevel>unlockedMaxLevel;
 // Quality 2 is unlocked after Boss 30 (forge level 16+);
 // Quality 3 after Boss 60 (forge level 31+). No higher-tier bypass.
 const qualityLevel=gateMode&&nextLevel>30?3:gateMode&&nextLevel>15?2:1;
 const quality=qualityResources||reconcileQualityInventory(resources);
 return {itemId,level,nextLevel,maxLevel,maxed,cost,successChance,qualityLevel,
  ...(gateMode?{locked,unlockedMaxLevel,legacy:false}:{}),
  affordable:!maxed&&!locked&&Object.entries(cost).every(([k,n])=>
   Number(quality[qualityKey(k,qualityLevel)]||0)>=n)};
}
export function forgeView(heroRaw,inventoryRaw,progressRaw=undefined){
 const hero=dogHero(heroRaw),inventory=dogInventory(inventoryRaw);
 const gateMode=progressRaw!==undefined;
 const cap=gateMode?forgeGateCap(progressRaw):null;
 return {hero,inventory,
  items:DOG_FORGE_ITEMS,
  groups:DOG_FORGE_GROUPS,
  quotes:DOG_FORGE_ITEMS.map(i=>forgeQuote(i.id,hero.levels[i.id],
   inventory.resources,progressRaw,inventory.qualityResources)),
  tuning:DOG_FORGE_TUNING,resourceGroups:DOG_RESOURCE_GROUPS,
  ...(gateMode?{forgeLevel:cap.forgeLevel,skillsCap:cap.skills,
   equipmentCap:cap.equipment,bossSeals:cap.bossSeals,
   earnedBossSeals:cap.earnedBossSeals,
   qualityUnlocked:qualityUnlockedFromBosses(progressRaw),
   qualityRefinementChances:DOG_QUALITY_REFINEMENT_CHANCE,
   forgeLevelMax:10}:{}),
 };
}
function spend(resources,cost){
 const next={...resources};
 for(const [key,n] of Object.entries(cost)){
  if(!DOG_RESOURCES.includes(key)||!Number.isSafeInteger(n)||n<=0)throw Error('INVALID_FORGE_RECIPE');
  if(next[key]<n)throw Error('DOG_MATERIALS_MISSING');
  next[key]-=n;
 }
 return next;
}
/** Pure application of a single attempt, with a server-supplied roll from 0 to 9999. */
export function forgeUpgrade(heroRaw,inventoryRaw,itemId,expectedLevel,roll=0,now=Date.now(),progressRaw=undefined){
 const hero=dogHero(heroRaw),inventory=dogInventory(inventoryRaw);
 const def=DOG_FORGE_ITEM_BY_ID[itemId];
 if(!def)throw Error('INVALID_FORGE_ITEM');
 if(!Number.isSafeInteger(expectedLevel)||expectedLevel!==hero.levels[itemId])throw Error('STALE_FORGE_LEVEL');
 const quote=forgeQuote(itemId,expectedLevel,inventory.resources,progressRaw,inventory.qualityResources);
 if(quote.maxed)throw Error('FORGE_MAX_LEVEL');
 if(quote.locked)throw Error('DOG_FORGE_BOSS_REQUIRED');
 if(!quote.affordable)throw Error('DOG_MATERIALS_MISSING');
 if(!Number.isSafeInteger(roll)||roll<0||roll>=10000)throw Error('DOG_RANDOM_INVALID');
 const success=roll<quote.successChance*100;
 const nextHero={...hero,levels:{...hero.levels,[itemId]:success?quote.nextLevel:hero.levels[itemId]},
  crafts:hero.crafts+1,successes:hero.successes+(success?1:0),
  failures:hero.failures+(success?0:1),
  recent:[{type:'upgrade',itemId,success,
   level:success?quote.nextLevel:hero.levels[itemId],at:now},...hero.recent]
   .slice(0,FORGE_JOURNAL_LIMIT),updatedAt:now};
 const qualityResources={...inventory.qualityResources};
 for(const [id,count] of Object.entries(quote.cost))
  qualityResources[qualityKey(id,quote.qualityLevel)]-=count;
 const nextInventory={...inventory,resources:spend(inventory.resources,quote.cost),
  qualityResources,updatedAt:now};
 return {hero:nextHero,inventory:nextInventory,
  result:{type:'upgrade',itemId,success,oldLevel:quote.level,newLevel:nextHero.levels[itemId],
   cost:quote.cost,qualityLevel:quote.qualityLevel,chance:quote.successChance}};
}
/** Exchange up to 100 units in ONE inventory transaction, with legacy count=1. */
export function forgeExchange(heroRaw,inventoryRaw,resourceId,now=Date.now(),count=1,quality=1,progressRaw=undefined){
 const group=Object.values(DOG_RESOURCE_GROUPS).find(x=>x.includes(resourceId));
 if(!group||group.indexOf(resourceId)===group.length-1)throw Error('INVALID_EXCHANGE_RESOURCE');
 if(!Number.isSafeInteger(count)||count<1||count>DOG_FORGE_TUNING.exchangeMaxBatch)
  throw Error('INVALID_EXCHANGE_COUNT');
 const inventory=dogInventory(inventoryRaw),hero=dogHero(heroRaw);
 const nextResource=group[group.indexOf(resourceId)+1];
 if(![1,2,3].includes(quality))throw Error('INVALID_QUALITY_LEVEL');
 if(quality>qualityUnlockedFromBosses(progressRaw))throw Error('DOG_QUALITY_LOCKED');
 const spent=count*DOG_FORGE_TUNING.exchangeRate;
 const source=qualityKey(resourceId,quality),target=qualityKey(nextResource,quality);
 if(inventory.qualityResources[source]<spent)throw Error('DOG_MATERIALS_MISSING');
 if(inventory.qualityResources[target]+count>1_000_000)throw Error('DOG_MATERIALS_LIMIT');
 if(inventory.resources[nextResource]+count>1_000_000||hero.exchanges+count>1_000_000)
  throw Error('DOG_MATERIALS_LIMIT');
 const resources={...inventory.resources,
  [resourceId]:inventory.resources[resourceId]-spent,
  [nextResource]:inventory.resources[nextResource]+count};
 const qualityResources={...inventory.qualityResources,
  [source]:inventory.qualityResources[source]-spent,
  [target]:inventory.qualityResources[target]+count};
 return {inventory:{...inventory,resources,qualityResources,updatedAt:now},
  hero:{...hero,exchanges:hero.exchanges+count,
   recent:[{type:'exchange',from:resourceId,to:nextResource,count,at:now},...hero.recent]
    .slice(0,FORGE_JOURNAL_LIMIT),updatedAt:now},
  result:{type:'exchange',from:resourceId,to:nextResource,
   spent,received:count,...(count===1?{}:{count}),...(quality===1?{}:{quality})}};
}
/** Atomic 5:1 quality refinement. Never possible before the corresponding group boss seal. */
export const DOG_QUALITY_REFINEMENT_CHANCE=Object.freeze({2:90,3:75});
export function forgeRefine(heroRaw,inventoryRaw,resourceId,fromQuality,count=1,
 now=Date.now(),progressRaw=undefined,roll=0){
 if(!DOG_RESOURCES.includes(resourceId)||![1,2].includes(fromQuality))
  throw Error('INVALID_REFINEMENT');
 if(!Number.isSafeInteger(count)||count<1||count>DOG_FORGE_TUNING.exchangeMaxBatch)
  throw Error('INVALID_EXCHANGE_COUNT');
 if(qualityUnlockedFromBosses(progressRaw)<fromQuality+1)throw Error('DOG_QUALITY_LOCKED');
 if(!Number.isSafeInteger(roll)||roll<0||roll>=10000)throw Error('DOG_RANDOM_INVALID');
 const successChance=DOG_QUALITY_REFINEMENT_CHANCE[fromQuality+1];
 const success=roll<successChance*100;
 const hero=dogHero(heroRaw),inventory=dogInventory(inventoryRaw);
 const spent=count*5,target=qualityKey(resourceId,fromQuality+1);
 if(inventory.qualityResources[target]+count>1_000_000||hero.exchanges+count>1_000_000)
  throw Error('DOG_MATERIALS_LIMIT');
 // Validate affordability even when this particular attempt will fail.
 const source=qualityKey(resourceId,fromQuality);
 if(inventory.qualityResources[source]<spent)throw Error('DOG_MATERIALS_MISSING');
 const qualityResources=success?
  refineQuality(inventory.qualityResources,resourceId,fromQuality,count):
  {...inventory.qualityResources,[source]:inventory.qualityResources[source]-spent};
 const resources={...inventory.resources,
  [resourceId]:inventory.resources[resourceId]-spent+(success?count:0)};
 return {inventory:{...inventory,resources,qualityResources,updatedAt:now},
  hero:{...hero,exchanges:hero.exchanges+count,
   recent:[{type:'refine',resourceId,fromQuality,count,success,at:now},...hero.recent]
    .slice(0,FORGE_JOURNAL_LIMIT),updatedAt:now},
  result:{type:'refine',resourceId,fromQuality,toQuality:fromQuality+1,
   spent,received:success?count:0,success,chance:successChance}};
}
const HTTP_STATUS=Object.freeze({
 LOGIN_REQUIRED:401,INVALID_FORGE_REQUEST:400,INVALID_FORGE_ITEM:400,INVALID_EXCHANGE_RESOURCE:400,
 INVALID_EXCHANGE_COUNT:400,INVALID_REFINEMENT:400,INVALID_QUALITY_LEVEL:400,
 STALE_FORGE_LEVEL:409,FORGE_MAX_LEVEL:409,DOG_FORGE_BOSS_REQUIRED:409,DOG_MATERIALS_MISSING:409,
 DOG_MATERIALS_LIMIT:409,DOG_QUALITY_LOCKED:409,INSUFFICIENT_QUALITY_RESOURCES:409,
 DOG_FORGE_LEVEL_STALE:409,DOG_FORGE_LEVEL_MAX:409,
 DOG_FORGE_BOSS_SEAL_REQUIRED:409,DOG_FORGE_LEVEL_RECEIPT_CONFLICT:409,
 NOT_DOG_TEAM_MEMBER:403
});
/* Cosmetic equipment class comes from the already-read, permanently locked
 * three-hero selection, never from untrusted request bodies. No extra Firestore reads. */
const equipmentHeroClass=(snap,uid)=>{
 const team=snap?.exists?snap.data():null;
 const hero=team?.heroClasses?.[uid];
 return team?.heroLocks?.[uid]===true&&
  ['krieger','magierin','waechter'].includes(hero)?hero:null;
};
export function installDogForgeApi(app,{verifyProfile,getFirestore,rand=randomInt}){
 const auth=async(req,res,next)=>{
  try{
   const match=/^Bearer\s+([\w.\-]+)$/.exec(String(req.get('authorization')||''));
   if(!match)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   const profile=await verifyProfile(match[1]);
   if(!profile?.uid)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   req.dogForgeUid=profile.uid;next();
  }catch{return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});}
 };
 const err=(res,e)=>{
  const reason=String(e?.message||'');
  return res.status(HTTP_STATUS[reason]||500).json({ok:false,error:HTTP_STATUS[reason]?reason:'DOG_FORGE_UNAVAILABLE'});
 };
 const db=()=>{const store=getFirestore();if(!store)throw Error('STORAGE_UNAVAILABLE');return store;};
 app.get('/api/dog/forge/me',auth,async(req,res)=>{
  try{
   const database=db(),uid=req.dogForgeUid;
   const [heroSnap,bagSnap,teamSnap]=await Promise.all([
    database.collection(DOG_HERO_COLLECTION).doc(uid).get(),
    database.collection(DOG_MATERIALS_COLLECTION).doc(uid).get(),
    database.collection(EXPEDITION_TEAM_COLLECTION).doc(EXPEDITION_TEAM_ID).get()
   ]);
   // Only registered members receive boss-gated forging rules. Other
   // players retain their legacy forge until an explicit migration.
   const isExpeditionMember=teamSnap.exists&&
    Array.isArray(teamSnap.data()?.members)&&
    teamSnap.data().members.some(m=>m?.uid===uid);
   let progressRaw=undefined;
   if(isExpeditionMember){
    const progressSnap=await database.collection(EXPEDITION_PROGRESS_COLLECTION)
     .doc(EXPEDITION_PROGRESS_ID).get();
    progressRaw=progressSnap.exists?progressSnap.data():{sharedBosses:[]};
   }
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...forgeView(heroSnap.exists?heroSnap.data():null,
    bagSnap.exists?bagSnap.data():null,progressRaw),
    heroClass:equipmentHeroClass(teamSnap,uid)});
  }catch(e){return err(res,e);}
 });
 const action=(type)=>async(req,res)=>{
  try{
   const {requestId}=object(req.body);
   if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{12,90}$/.test(requestId))
    throw Error('INVALID_FORGE_REQUEST');
   const uid=req.dogForgeUid,database=db();
   const heroRef=database.collection(DOG_HERO_COLLECTION).doc(uid);
   const bagRef=database.collection(DOG_MATERIALS_COLLECTION).doc(uid);
   const receiptRef=database.collection(DOG_FORGE_RECEIPTS_COLLECTION).doc(uid+'_'+requestId);
   const response=await database.runTransaction(async tx=>{
    const teamRef=database.collection(EXPEDITION_TEAM_COLLECTION).doc(EXPEDITION_TEAM_ID);
    const [receipt,heroSnap,bagSnap,teamSnap]=await Promise.all([
     tx.get(receiptRef),tx.get(heroRef),tx.get(bagRef),tx.get(teamRef)]);
    const isExpeditionMember=teamSnap.exists&&
     Array.isArray(teamSnap.data()?.members)&&
     teamSnap.data().members.some(m=>m?.uid===uid);
    let progressRaw=undefined;
    if(isExpeditionMember){
     const progressRef=database.collection(EXPEDITION_PROGRESS_COLLECTION).doc(EXPEDITION_PROGRESS_ID);
     const progressSnap=await tx.get(progressRef);
     progressRaw=progressSnap.exists?progressSnap.data():{sharedBosses:[]};
    }
    if(receipt.exists)return {...forgeView(heroSnap.exists?heroSnap.data():null,
     bagSnap.exists?bagSnap.data():null,progressRaw),
     heroClass:equipmentHeroClass(teamSnap,uid),
     result:receipt.data().result,replayed:true};
    const hero=heroSnap.exists?heroSnap.data():null,bag=bagSnap.exists?bagSnap.data():null;
    const now=Date.now();
    let next;
    if(type==='upgrade'){
     const {itemId,expectedLevel}=object(req.body);
     next=forgeUpgrade(hero,bag,itemId,expectedLevel,rand(10000),now,progressRaw);
    }else if(type==='refine'){
     next=forgeRefine(hero,bag,req.body?.resourceId,req.body?.fromQuality,
      req.body?.count===undefined?1:req.body.count,now,progressRaw,rand(10000));
    }else next=forgeExchange(hero,bag,req.body?.resourceId,now,
     req.body?.count===undefined?1:req.body.count,req.body?.quality??1,progressRaw);
    const view=forgeView(next.hero,next.inventory,progressRaw);
    const payload={...view,heroClass:equipmentHeroClass(teamSnap,uid),
     result:next.result,replayed:false};
    tx.set(heroRef,next.hero);tx.set(bagRef,next.inventory);
    // Keep receipts compact: current snapshots are read on retries.
    tx.create(receiptRef,{uid,requestId,createdAt:now,result:next.result});
    return payload;
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...response});
  }catch(e){return err(res,e);}
 };

 // Shared forge-level upgrade: the *same* boss progress document contains the
 // source victories and spent forge level. One transaction, one receipt,
 // no independent reward inventory write on defeating a boss.
 app.post('/api/dog/forge/level-up',auth,async(req,res)=>{
  try{
   const {requestId,expectedLevel}=object(req.body);
   if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{12,90}$/.test(requestId))
    throw Error('INVALID_FORGE_REQUEST');
   const database=db(),uid=req.dogForgeUid;
   const teamRef=database.collection(EXPEDITION_TEAM_COLLECTION).doc(EXPEDITION_TEAM_ID);
   const progressRef=database.collection(EXPEDITION_PROGRESS_COLLECTION).doc(EXPEDITION_PROGRESS_ID);
   const receiptRef=database.collection(DOG_FORGE_RECEIPTS_COLLECTION).doc(uid+'_'+requestId);
   const result=await database.runTransaction(async tx=>{
    const [receipt,teamSnap,progressSnap]=await Promise.all([
     tx.get(receiptRef),tx.get(teamRef),tx.get(progressRef)]);
    if(!teamSnap.exists||!Array.isArray(teamSnap.data()?.members)||
      !teamSnap.data().members.some(m=>m?.uid===uid))throw Error('NOT_DOG_TEAM_MEMBER');
    if(receipt.exists){
     if(receipt.data()?.type!=='forge-level-up'||receipt.data()?.expectedLevel!==expectedLevel)
      throw Error('DOG_FORGE_LEVEL_RECEIPT_CONFLICT');
     return {result:receipt.data().result,
      progress:dogForgeProgress(progressSnap.exists?progressSnap.data():null),replayed:true};
    }
    const upgraded=dogForgeLevelUp(progressSnap.exists?progressSnap.data():null,
     expectedLevel,Date.now());
    tx.set(progressRef,upgraded.progress);
    tx.create(receiptRef,{uid,requestId,type:'forge-level-up',
     expectedLevel,result:upgraded.result,createdAt:Date.now()});
    return {result:upgraded.result,
     progress:dogForgeProgress(upgraded.progress),replayed:false};
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...result});
  }catch(e){return err(res,e);}
 });
 app.post('/api/dog/forge/upgrade',auth,action('upgrade'));
 app.post('/api/dog/forge/exchange',auth,action('exchange'));
 app.post('/api/dog/forge/refine',auth,action('refine'));
}
