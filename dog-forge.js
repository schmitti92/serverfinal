/**
 * The 100 Gates · forge V1.
 * Tunable crafting rules live here; no boss-combat values are locked in.
 * All spending and hero upgrades are authenticated, atomic and idempotent.
 */
import {randomInt} from 'node:crypto';
import {DOG_MATERIALS_COLLECTION,DOG_RESOURCE_GROUPS,DOG_RESOURCES,dogInventory} from './dog-materials.js';

export const DOG_HERO_COLLECTION='dog_hero_v1';
export const DOG_FORGE_RECEIPTS_COLLECTION='dog_forge_receipts_v1';

const object=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const bounded=(v,min,max,fallback)=>Number.isSafeInteger(v)&&v>=min&&v<=max?v:fallback;
const item=(id,group,name,icon,summary,maxLevel,baseLevel=0)=>
 Object.freeze({id,group,name,icon,summary,maxLevel,baseLevel});
export const DOG_FORGE_ITEMS=Object.freeze([
 item('weapon','equipment','Waffe','⚔️','Mehr Grundschaden',20,1),
 item('armor','equipment','Rüstung','🛡️','Mehr Grundschutz',20,1),
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
const costFor=(group,next)=>{
 const r=DOG_RESOURCE_GROUPS[group];
 if(!r)throw Error('INVALID_FORGE_ITEM');
 const out={};
 const add=(index,amount)=>{out[r[index]]=amount;};
 if(group==='equipment'){
  if(next<=5)add(0,1+next);
  else if(next<=10){add(0,3);add(1,2+Math.floor((next-6)/2));}
  else if(next<=15){add(1,3);add(2,1+Math.floor((next-11)/2));}
  else if(next<=18){add(2,3);add(3,1+Math.floor((next-16)/2));}
  else {add(3,next===20?4:3);add(4,1);}
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
export function forgeQuote(itemId,currentLevel,resources={}){
 const definition=DOG_FORGE_ITEM_BY_ID[itemId];
 if(!definition)throw Error('INVALID_FORGE_ITEM');
 const level=bounded(currentLevel,definition.baseLevel,definition.maxLevel,definition.baseLevel);
 const maxed=level>=definition.maxLevel;
 const nextLevel=maxed?null:level+1;
 const cost=maxed?{}:costFor(definition.group,nextLevel);
 const successChance=definition.group==='equipment'&&!maxed?
  DOG_FORGE_TUNING.equipmentSuccess.find(x=>nextLevel<=x.max)?.chance??25:100;
 return {itemId,level,nextLevel,maxLevel:definition.maxLevel,maxed,cost,successChance,
  affordable:!maxed&&Object.entries(cost).every(([k,n])=>Number(resources[k]||0)>=n)};
}
export function forgeView(heroRaw,inventoryRaw){
 const hero=dogHero(heroRaw),inventory=dogInventory(inventoryRaw);
 return {hero,inventory,items:DOG_FORGE_ITEMS,groups:DOG_FORGE_GROUPS,
  quotes:DOG_FORGE_ITEMS.map(i=>forgeQuote(i.id,hero.levels[i.id],inventory.resources)),
  tuning:DOG_FORGE_TUNING,resourceGroups:DOG_RESOURCE_GROUPS};
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
export function forgeUpgrade(heroRaw,inventoryRaw,itemId,expectedLevel,roll=0,now=Date.now()){
 const hero=dogHero(heroRaw),inventory=dogInventory(inventoryRaw);
 const def=DOG_FORGE_ITEM_BY_ID[itemId];
 if(!def)throw Error('INVALID_FORGE_ITEM');
 if(!Number.isSafeInteger(expectedLevel)||expectedLevel!==hero.levels[itemId])throw Error('STALE_FORGE_LEVEL');
 const quote=forgeQuote(itemId,expectedLevel,inventory.resources);
 if(quote.maxed)throw Error('FORGE_MAX_LEVEL');
 if(!quote.affordable)throw Error('DOG_MATERIALS_MISSING');
 if(!Number.isSafeInteger(roll)||roll<0||roll>=10000)throw Error('DOG_RANDOM_INVALID');
 const success=roll<quote.successChance*100;
 const nextHero={...hero,levels:{...hero.levels,[itemId]:success?quote.nextLevel:hero.levels[itemId]},
  crafts:hero.crafts+1,successes:hero.successes+(success?1:0),
  failures:hero.failures+(success?0:1),
  recent:[{type:'upgrade',itemId,success,
   level:success?quote.nextLevel:hero.levels[itemId],at:now},...hero.recent]
   .slice(0,FORGE_JOURNAL_LIMIT),updatedAt:now};
 const nextInventory={...inventory,resources:spend(inventory.resources,quote.cost),updatedAt:now};
 return {hero:nextHero,inventory:nextInventory,
  result:{type:'upgrade',itemId,success,oldLevel:quote.level,newLevel:nextHero.levels[itemId],
   cost:quote.cost,chance:quote.successChance}};
}
/** Exchange up to 100 units in ONE inventory transaction, with legacy count=1. */
export function forgeExchange(heroRaw,inventoryRaw,resourceId,now=Date.now(),count=1){
 const group=Object.values(DOG_RESOURCE_GROUPS).find(x=>x.includes(resourceId));
 if(!group||group.indexOf(resourceId)===group.length-1)throw Error('INVALID_EXCHANGE_RESOURCE');
 if(!Number.isSafeInteger(count)||count<1||count>DOG_FORGE_TUNING.exchangeMaxBatch)
  throw Error('INVALID_EXCHANGE_COUNT');
 const inventory=dogInventory(inventoryRaw),hero=dogHero(heroRaw);
 const nextResource=group[group.indexOf(resourceId)+1];
 const spent=count*DOG_FORGE_TUNING.exchangeRate;
 if(inventory.resources[resourceId]<spent)throw Error('DOG_MATERIALS_MISSING');
 if(inventory.resources[nextResource]+count>1_000_000||hero.exchanges+count>1_000_000)
  throw Error('DOG_MATERIALS_LIMIT');
 const resources={...inventory.resources,
  [resourceId]:inventory.resources[resourceId]-spent,
  [nextResource]:inventory.resources[nextResource]+count};
 return {inventory:{...inventory,resources,updatedAt:now},
  hero:{...hero,exchanges:hero.exchanges+count,
   recent:[{type:'exchange',from:resourceId,to:nextResource,count,at:now},...hero.recent]
    .slice(0,FORGE_JOURNAL_LIMIT),updatedAt:now},
  result:{type:'exchange',from:resourceId,to:nextResource,
   spent,received:count,...(count===1?{}:{count})}};
}
const HTTP_STATUS=Object.freeze({
 LOGIN_REQUIRED:401,INVALID_FORGE_REQUEST:400,INVALID_FORGE_ITEM:400,INVALID_EXCHANGE_RESOURCE:400,
 INVALID_EXCHANGE_COUNT:400,
 STALE_FORGE_LEVEL:409,FORGE_MAX_LEVEL:409,DOG_MATERIALS_MISSING:409,
 DOG_MATERIALS_LIMIT:409
});
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
   const [heroSnap,bagSnap]=await Promise.all([
    database.collection(DOG_HERO_COLLECTION).doc(uid).get(),
    database.collection(DOG_MATERIALS_COLLECTION).doc(uid).get()
   ]);
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...forgeView(heroSnap.exists?heroSnap.data():null,bagSnap.exists?bagSnap.data():null)});
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
    const [receipt,heroSnap,bagSnap]=await Promise.all([tx.get(receiptRef),tx.get(heroRef),tx.get(bagRef)]);
    if(receipt.exists)return {...forgeView(heroSnap.exists?heroSnap.data():null,bagSnap.exists?bagSnap.data():null),
     result:receipt.data().result,replayed:true};
    const hero=heroSnap.exists?heroSnap.data():null,bag=bagSnap.exists?bagSnap.data():null;
    const now=Date.now();
    let next;
    if(type==='upgrade'){
     const {itemId,expectedLevel}=object(req.body);
     next=forgeUpgrade(hero,bag,itemId,expectedLevel,rand(10000),now);
    }else next=forgeExchange(hero,bag,req.body?.resourceId,now,
     req.body?.count===undefined?1:req.body.count);
    const view=forgeView(next.hero,next.inventory);
    const payload={...view,result:next.result,replayed:false};
    tx.set(heroRef,next.hero);tx.set(bagRef,next.inventory);
    // Keep receipts compact: current snapshots are read on retries.
    tx.create(receiptRef,{uid,requestId,createdAt:now,result:next.result});
    return payload;
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...response});
  }catch(e){return err(res,e);}
 };
 app.post('/api/dog/forge/upgrade',auth,action('upgrade'));
 app.post('/api/dog/forge/exchange',auth,action('exchange'));
}
