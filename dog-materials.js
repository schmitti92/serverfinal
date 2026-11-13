/** DOG expedition: three server-awarded chest sizes and 15 category-bound materials.
 * The client can open earned chests, never grant them. Final Deal payout receipts
 * are the exactly-once source of new chest awards. Legacy materials/chests survive.
 */
import {randomInt} from 'node:crypto';
import {DOG_CHEST_TYPES,DOG_CHEST_TYPE_IDS,DOG_CHEST_STAGES,dogChestContents} from './dog-balance.js';
import {qualityChestDrop,qualityUnlockedForChest,reconcileQualityInventory} from './dog-f01-quality-prototype.mjs';

export const DOG_MATERIALS_COLLECTION='dog_material_inventory_v1';
export const DOG_CHEST_RECEIPTS_COLLECTION='dog_material_chest_open_receipts_v1';

export const DOG_CHEST_SIZES=Object.freeze({
 small:Object.freeze({label:'Kleine Rohstoffkiste',min:5,max:10,weight:60,rarityWeights:[600,280,100,18,2]}),
 medium:Object.freeze({label:'Mittlere Rohstoffkiste',min:10,max:20,weight:30,rarityWeights:[450,320,170,50,10]}),
 large:Object.freeze({label:'Große Rohstoffkiste',min:20,max:40,weight:10,rarityWeights:[300,350,230,90,30]})
});
export const DOG_CHEST_TIERS=Object.freeze(Object.keys(DOG_CHEST_SIZES));
export const DOG_EXPEDITION_CHEST_TIERS=DOG_CHEST_TYPE_IDS;
export const DOG_RARITIES=Object.freeze(['common','uncommon','rare','epic','legendary']);
export const DOG_RESOURCE_GROUPS=Object.freeze({
 attack:Object.freeze(['focus_dust','power_crystal','battle_essence','war_rune','soul_shard']),
 defense:Object.freeze(['life_dust','guard_crystal','life_essence','guardian_rune','phoenix_feather']),
 equipment:Object.freeze(['iron','forge_coal','steel_core','mithril','dragonsteel'])
});
export const DOG_RESOURCES=Object.freeze(Object.values(DOG_RESOURCE_GROUPS).flat());
const LEGACY_RESOURCES=Object.freeze({crystal:'power_crystal',rune:'war_rune'});
const MAX_INVENTORY=1_000_000;
const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=MAX_INVENTORY?n:0;
const timestamp=n=>Number.isSafeInteger(n)&&n>=0&&n<=10_000_000_000_000?n:0;
const safelyAdd=(a,b)=>{if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a+b>MAX_INVENTORY)throw Error('DOG_MATERIALS_LIMIT');return a+b;};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const draw=(rand,limit)=>{const value=rand(limit);if(!Number.isInteger(value)||value<0||value>=limit)throw Error('DOG_RANDOM_INVALID');return value;};
const emptyItems=()=>Object.fromEntries(DOG_RESOURCES.map(k=>[k,0]));
function normalizeItems(value){
 const raw=object(value),items=emptyItems();
 for(const key of DOG_RESOURCES)items[key]=count(raw[key]);
 for(const [oldKey,newKey] of Object.entries(LEGACY_RESOURCES)){
  if(oldKey in raw && !(newKey in raw))items[newKey]=count(raw[oldKey]);
 }
 return items;
}
const emptyChests=()=>({small:0,medium:0,large:0,legacy:0});

const validExpeditionOffer=offer=>{
 const stage=offer?.stage,tier=offer?.tier,qty=offer?.count;
 return offer?.version===4&&Number.isSafeInteger(stage)&&stage>=0&&
  stage<DOG_CHEST_STAGES.length&&DOG_EXPEDITION_CHEST_TIERS.includes(tier)&&
  DOG_CHEST_STAGES[stage].chestWeights[DOG_EXPEDITION_CHEST_TIERS.indexOf(tier)]>0&&
  Number.isSafeInteger(qty)&&qty>=DOG_CHEST_TYPES[tier].min&&qty<=DOG_CHEST_TYPES[tier].max;
};
function storedExpeditionOffers(raw){
 if(!Array.isArray(raw))return [];
 // Merge identical immutable offers to avoid an ever-growing list of
 // single chests in a Firestore document; contents remain rolled on opening.
 const offers=[];
 for(const value of raw){
  if(!validExpeditionOffer(value))throw Error('DOG_CHEST_STORAGE_INVALID');
  const quantity=count(value.quantity??1);
  if(!quantity)throw Error('DOG_CHEST_STORAGE_INVALID');
  const found=offers.find(x=>x.tier===value.tier&&x.stage===value.stage&&x.count===value.count);
  if(found)found.quantity=safelyAdd(found.quantity,quantity);
  else offers.push({version:4,stage:value.stage,tier:value.tier,count:value.count,quantity});
 }
 return offers;
}

export function dogInventory(input={}){
 const raw=object(input),savedChests=object(raw.chests);
 const chests=emptyChests();
 if(Object.prototype.hasOwnProperty.call(raw,'chests')){
  for(const tier of Object.keys(chests))chests[tier]=count(savedChests[tier]);
 }else chests.legacy=count(raw.unopened);
 const expeditionChests=storedExpeditionOffers(raw.expeditionChests);
 const oldUnopened=Object.values(chests).reduce(safelyAdd,0);
 const unopened=expeditionChests.reduce((sum,offer)=>safelyAdd(sum,offer.quantity),oldUnopened);
 const recent=Array.isArray(raw.recent)?raw.recent.slice(0,6)
  .filter(x=>x&&Number.isSafeInteger(x.count)&&x.count>=1&&x.count<=40)
  .map(x=>({tier:DOG_CHEST_TIERS.includes(x.tier)||
    DOG_EXPEDITION_CHEST_TIERS.includes(x.tier)?x.tier:'legacy',
   count:x.count,items:normalizeItems(x.items),
   qualityItems:Object.fromEntries(Object.entries(object(x.qualityItems))
    .filter(([key,n])=>DOG_RESOURCES.some(id=>[1,2,3].some(q=>key===id+':'+q))&&count(n)>0)
    .map(([key,n])=>[key,count(n)])),
   openedAt:timestamp(x.openedAt)})):[];
 return {
  version:3,unopened,earned:count(raw.earned),opened:count(raw.opened),
  chests,expeditionChests,resources:normalizeItems(raw.resources),
  qualityResources:reconcileQualityInventory(normalizeItems(raw.resources),raw.qualityResources),
  recent,updatedAt:timestamp(raw.updatedAt)
 };
}
export function rollDogChestTier(rand=randomInt){
 const roll=draw(rand,100);
 return roll<60?'small':roll<90?'medium':'large';
}
/** One randomly chosen, identifiable chest on a verified finished Deal match. */
export function addVerifiedChestToInventory(input,now=Date.now(),tier=rollDogChestTier()){
 if(!DOG_CHEST_TIERS.includes(tier))throw Error('INVALID_DOG_CHEST_TIER');
 const old=dogInventory(input);
 return {...old,unopened:safelyAdd(old.unopened,1),earned:safelyAdd(old.earned,1),
  chests:{...old.chests,[tier]:safelyAdd(old.chests[tier],1)},updatedAt:now};
}
/** Called ONLY in a server-verified, receipt-protected completed match.
 * The offer is a frozen award snapshot, not client-supplied data. */
export function addExpeditionChestToInventory(input,offer,now=Date.now()){
 if(!validExpeditionOffer(offer))throw Error('DOG_BALANCE_INVALID_CHEST');
 const old=dogInventory(input),expeditionChests=old.expeditionChests.map(x=>({...x}));
 const stored=expeditionChests.find(x=>x.tier===offer.tier&&x.stage===offer.stage&&x.count===offer.count);
 if(stored)stored.quantity=safelyAdd(stored.quantity,1);
 else expeditionChests.push({version:4,tier:offer.tier,stage:offer.stage,count:offer.count,quantity:1});
 if(expeditionChests.length>1100)throw Error('DOG_CHEST_STORAGE_LIMIT');
 return {...old,version:3,unopened:safelyAdd(old.unopened,1),
  earned:safelyAdd(old.earned,1),expeditionChests,updatedAt:now};
}

/** Consumes the first matching SERVER-AWARDED offer, and never uses the
 * player's current gate to change its quantity or rarity retroactively. */
export function openExpeditionChestInInventory(input,tier,rand=randomInt,now=Date.now(),maxQuality=1){
 const old=dogInventory(input);
 if(!DOG_EXPEDITION_CHEST_TIERS.includes(tier))throw Error('INVALID_DOG_CHEST_TIER');
 const pos=old.expeditionChests.findIndex(x=>x.tier===tier&&x.quantity>0);
 if(pos<0)throw Error('NO_DOG_CHEST_TYPE');
 const offer=old.expeditionChests[pos];
 const drop=dogChestContents(offer,rand);
 const qualityItems=qualityChestDrop(drop,rand,Math.min(maxQuality,offer.stage>=6?3:offer.stage>=3?2:1));
 const updated=old.expeditionChests.map(x=>({...x}));
 updated[pos].quantity--;
 if(updated[pos].quantity===0)updated.splice(pos,1);
 const resources={};
 for(const key of DOG_RESOURCES)resources[key]=safelyAdd(old.resources[key],drop.items[key]);
 const qualityResources={...old.qualityResources};
 for(const [key,value] of Object.entries(qualityItems))
  qualityResources[key]=safelyAdd(qualityResources[key],value);
 return {inventory:{...old,version:3,unopened:old.unopened-1,
  opened:safelyAdd(old.opened,1),expeditionChests:updated,resources,qualityResources,
  recent:[{tier:drop.tier,count:drop.count,items:{...drop.items},
   qualityItems:Object.fromEntries(Object.entries(qualityItems).filter(([,n])=>n>0)),
   openedAt:now},...old.recent].slice(0,6),
  updatedAt:now},drop:{...drop,qualityItems}};
}

/** One category (uniform), then one rarity (tier-dependent), per resource. */
export function rollDogMaterialChest(tier='small',rand=randomInt){
 const definition=DOG_CHEST_SIZES[tier];
 if(!definition)throw Error('INVALID_DOG_CHEST_TIER');
 const qty=definition.min+draw(rand,definition.max-definition.min+1);
 const items=emptyItems();
 const categories=Object.values(DOG_RESOURCE_GROUPS);
 for(let n=0;n<qty;n++){
  const group=categories[draw(rand,categories.length)];
  const rarityRoll=draw(rand,1000);
  let cutoff=0,rarityIndex=definition.rarityWeights.length-1;
  for(let j=0;j<definition.rarityWeights.length;j++){
   cutoff+=definition.rarityWeights[j];
   if(rarityRoll<cutoff){rarityIndex=j;break;}
  }
  items[group[rarityIndex]]++;
 }
 return {tier,count:qty,items};
}
/** sourceTier is 'legacy' only for unopened pre-upgrade chests. */
export function openDogChestInInventory(input,drop,now=Date.now(),sourceTier=drop?.tier,qualityItems=null){
 const old=dogInventory(input);
 if(old.unopened===0)throw Error('NO_DOG_CHESTS');
 if(!Object.hasOwn(old.chests,sourceTier)||old.chests[sourceTier]===0)throw Error('NO_DOG_CHEST_TYPE');
 const size=DOG_CHEST_SIZES[drop?.tier];
 if(!size||!Number.isInteger(drop.count)||drop.count<size.min||drop.count>size.max||
  DOG_RESOURCES.some(k=>!Number.isSafeInteger(drop.items?.[k])||drop.items[k]<0)||
  DOG_RESOURCES.reduce((sum,k)=>sum+drop.items[k],0)!==drop.count)throw Error('INVALID_DOG_CHEST');
 const resources={};
 for(const key of DOG_RESOURCES)resources[key]=safelyAdd(old.resources[key],drop.items[key]);
 const added=qualityItems||qualityChestDrop(drop,()=>0,1);
 const qualityResources={...old.qualityResources};
 for(const [key,value] of Object.entries(added))
  qualityResources[key]=safelyAdd(qualityResources[key],value);
 return {...old,qualityResources,unopened:old.unopened-1,opened:safelyAdd(old.opened,1),
  chests:{...old.chests,[sourceTier]:old.chests[sourceTier]-1},resources,
  recent:[{tier:drop.tier,count:drop.count,items:{...drop.items},
   qualityItems:Object.fromEntries(Object.entries(added).filter(([,n])=>n>0)),
   openedAt:now},...old.recent].slice(0,6),
  updatedAt:now};
}
const ERROR_STATUS=Object.freeze({LOGIN_REQUIRED:401,INVALID_REQUEST_ID:400,INVALID_DOG_CHEST_TIER:400,INVALID_DOG_CHEST_QUANTITY:400,DOG_CHEST_BATCH_TOO_LARGE:409,
 NO_DOG_CHESTS:409,NO_DOG_CHEST_TYPE:409,DOG_MATERIALS_LIMIT:409,
 DOG_CHEST_STORAGE_INVALID:409,DOG_CHEST_STORAGE_LIMIT:409});
export function installDogMaterialsApi(app,{verifyProfile,getFirestore,rand=randomInt}){
 const auth=async(req,res,next)=>{
  try{
   const match=/^Bearer\s+([\w.\-]+)$/.exec(String(req.get('authorization')||''));
   if(!match)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   const user=await verifyProfile(match[1]);
   if(!user?.uid)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   req.dogUid=user.uid;next();
  }catch{return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});}
 };
 const error=(res,e)=>{
  const code=String(e?.message||'SERVER_ERROR');
  return res.status(ERROR_STATUS[code]||500).json({ok:false,error:ERROR_STATUS[code]?code:'DOG_MATERIALS_UNAVAILABLE'});
 };
 const firestore=()=>{
  const db=getFirestore();
  if(!db)throw Error('STORAGE_UNAVAILABLE');
  return db;
 };
 app.get('/api/dog/materials/me',auth,async(req,res)=>{
  try{
   const snap=await firestore().collection(DOG_MATERIALS_COLLECTION).doc(req.dogUid).get();
   res.set('Cache-Control','no-store');
   return res.json({ok:true,inventory:dogInventory(snap.exists?snap.data():null),
    rules:{resources:DOG_RESOURCE_GROUPS,tiers:DOG_CHEST_SIZES,
     expeditionTiers:DOG_CHEST_TYPES,expeditionStages:DOG_CHEST_STAGES,
     rarities:DOG_RARITIES,qualityUnlockBosses:[30,60],qualityConversionRate:5,chestMin:5,chestMax:40,
     verifiedGames:['deal-or-no-deal']}});
  }catch(e){return error(res,e)}
 });
 app.post('/api/dog/materials/open',auth,async(req,res)=>{
  try{
   const requestId=req.body?.requestId,tier=req.body?.tier,quantity=req.body?.quantity??1;
   if(quantity!=='all'&&(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000))
    throw Error('INVALID_DOG_CHEST_QUANTITY');
   if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{12,90}$/.test(requestId))throw Error('INVALID_REQUEST_ID');
   if(tier!==undefined&&tier!==null&&![...DOG_CHEST_TIERS,'legacy',...DOG_EXPEDITION_CHEST_TIERS].includes(tier))throw Error('INVALID_DOG_CHEST_TIER');
   const db=firestore(),ref=db.collection(DOG_MATERIALS_COLLECTION).doc(req.dogUid);
   const receiptRef=db.collection(DOG_CHEST_RECEIPTS_COLLECTION).doc(req.dogUid+'_'+requestId);
   const result=await db.runTransaction(async tx=>{
    const progressRef=db.collection('dog_gate_progress_v1').doc('first-three-heroes');
   const teamRef=db.collection('dog_boss_team_v1').doc('first-three-heroes');
   const [receipt,inventorySnap,progressSnap,teamSnap]=await Promise.all([
    tx.get(receiptRef),tx.get(ref),tx.get(progressRef),tx.get(teamRef)]);
   const member=teamSnap.exists&&Array.isArray(teamSnap.data()?.members)&&
    teamSnap.data().members.some(m=>m?.uid===req.dogUid);
   const progress=member&&progressSnap.exists?progressSnap.data():null;
   const maxQuality=qualityUnlockedForChest(progress);
    if(receipt.exists)return {...receipt.data().result,replayed:true};
    const prior=dogInventory(inventorySnap.exists?inventorySnap.data():null);
    if(!prior.unopened)throw Error('NO_DOG_CHESTS');
    const sourceTier=tier??[
     ...DOG_EXPEDITION_CHEST_TIERS.filter(id=>prior.expeditionChests.some(x=>x.tier===id)),
     ...DOG_CHEST_TIERS.filter(id=>prior.chests[id]>0),
     ...(prior.chests.legacy>0?['legacy']:[])
    ][0];
    const available=DOG_EXPEDITION_CHEST_TIERS.includes(sourceTier)?
     prior.expeditionChests.filter(x=>x.tier===sourceTier).reduce((n,x)=>n+x.quantity,0):
     prior.chests[sourceTier]||0;
    const total=quantity==='all'?available:Math.min(quantity,available);
    if(!total)throw Error('NO_DOG_CHEST_TYPE');
    if(total>1000)throw Error('DOG_CHEST_BATCH_TOO_LARGE');
    let updated=prior;
    const items=Object.fromEntries(DOG_RESOURCES.map(id=>[id,0]));
    const qualityItems={};
    let totalMaterials=0,lastDrop=null;
    const openedAt=Date.now();
    for(let i=0;i<total;i++){
     let drop;
     if(DOG_EXPEDITION_CHEST_TIERS.includes(sourceTier)){
      ({drop,inventory:updated}=openExpeditionChestInInventory(updated,sourceTier,rand,openedAt,maxQuality));
     }else{
      const awardedTier=sourceTier==='legacy'?rollDogChestTier(rand):sourceTier;
      drop=rollDogMaterialChest(awardedTier,rand);
      const quality=qualityChestDrop(drop,rand,maxQuality);
      updated=openDogChestInInventory(updated,drop,openedAt,sourceTier,quality);
      drop={...drop,qualityItems:quality};
     }
     lastDrop=drop;
     totalMaterials+=drop.count;
     for(const id of DOG_RESOURCES)items[id]+=drop.items[id]||0;
     for(const [id,n] of Object.entries(drop.qualityItems||{}))
      qualityItems[id]=(qualityItems[id]||0)+n;
    }
    const drop=total===1?lastDrop:{tier:sourceTier,count:totalMaterials,items,qualityItems,openedChests:total};
    const response={inventory:updated,drop,openedChests:total,replayed:false};
    tx.set(ref,updated);
    tx.create(receiptRef,{uid:req.dogUid,requestId,createdAt:Date.now(),result:response});
    return response;
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...result});
  }catch(e){return error(res,e)}
 });
}
