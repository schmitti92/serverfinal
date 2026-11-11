/** Boss-gated forge progression for the new 100-Tore expedition.
 * Uses existing hero/material docs, but never mutates legacy 20-level heroes
 * without an explicit valid upgrade and authenticated server receipt.
 */
import {randomInt} from 'node:crypto';
import {DOG_HERO_COLLECTION,dogHero} from './dog-forge.js';
import {DOG_MATERIALS_COLLECTION,dogInventory} from './dog-materials.js';
import {DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID,dogGateProgress} from './dog-gates.js';
import {dogEquipmentCost,dogEquipmentSuccessChance,dogUnlockedLevels} from './dog-balance.js';

export const DOG_ASCENSION_RECEIPTS_COLLECTION='dog_gate_ascension_receipts_v1';
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{12,90}$/.test(id);
const bossWins=x=>dogGateProgress(x).sharedBosses
  .filter(b=>b>=10&&b<=90&&b%10===0).length;
export const ascensionCap=raw=>dogUnlockedLevels(bossWins(raw));
export function ascensionView(heroRaw,inventoryRaw,progressRaw){
 const hero=dogHero(heroRaw),inventory=dogInventory(inventoryRaw);
 const cap=ascensionCap(progressRaw);
 const levels=hero.levels;
 const quotes={};
 for(const type of ['weapon','armor']){
  const current=levels[type],next=current+1;
  const legacy=current>10;
  const maxed=current>=10;
  const locked=next>cap.equipment;
  const cost=!maxed?dogEquipmentCost(type,next):{};
  quotes[type]={type,level:current,nextLevel:maxed?null:next,
   maxLevel:10,unlockedMaxLevel:cap.equipment,locked,
   legacy,maxed,
   cost,successChance:!maxed?dogEquipmentSuccessChance(next):null,
   affordable:!maxed&&!locked&&Object.entries(cost)
    .every(([id,count])=>(inventory.resources[id]||0)>=count)};
 }
 return {hero:{levels},resources:inventory.resources,
  forgeLevel:cap.equipment,skillsCap:cap.skills,
  quotes};
}
export function ascensionUpgrade(heroRaw,inventoryRaw,progressRaw,type,expectedLevel,roll,now=Date.now()){
 if(!['weapon','armor'].includes(type))throw Error('DOG_ASCENSION_INVALID_TYPE');
 const hero=dogHero(heroRaw),inventory=dogInventory(inventoryRaw);
 if(!Number.isSafeInteger(expectedLevel)||expectedLevel!==hero.levels[type])
  throw Error('DOG_ASCENSION_LEVEL_STALE');
 if(expectedLevel>=10)throw Error('DOG_ASCENSION_LEGACY_LEVEL');
 const quote=ascensionView(hero,inventory,progressRaw).quotes[type];
 if(quote.locked)throw Error('DOG_ASCENSION_BOSS_REQUIRED');
 if(!quote.affordable)throw Error('DOG_ASCENSION_MATERIALS_MISSING');
 if(!Number.isSafeInteger(roll)||roll<0||roll>=10000)throw Error('DOG_ASCENSION_BAD_RANDOM');
 const success=roll<quote.successChance*100;
 const spent={...inventory.resources};
 for(const [id,count] of Object.entries(quote.cost))spent[id]-=count;
 const nextLevel=success?expectedLevel+1:expectedLevel;
 const updatedHero={...hero,
  levels:{...hero.levels,[type]:nextLevel},
  crafts:hero.crafts+1,successes:hero.successes+(success?1:0),
  failures:hero.failures+(success?0:1),
  recent:[{type:'upgrade',itemId:type,success,level:nextLevel,at:now},...hero.recent].slice(0,10),
  updatedAt:now};
 const updatedInventory={...inventory,resources:spent,updatedAt:now};
 return {hero:updatedHero,inventory:updatedInventory,
  result:{type,oldLevel:expectedLevel,newLevel:nextLevel,
   success,successChance:quote.successChance,cost:quote.cost}};
}
const ERRORS={LOGIN_REQUIRED:401,INVALID_REQUEST_ID:400,DOG_ASCENSION_INVALID_TYPE:400,
 DOG_ASCENSION_LEVEL_STALE:409,DOG_ASCENSION_LEGACY_LEVEL:409,
 DOG_ASCENSION_BOSS_REQUIRED:409,DOG_ASCENSION_MATERIALS_MISSING:409,
 DOG_ASCENSION_BAD_RANDOM:500,DOG_ASCENSION_RECEIPT_CONFLICT:409,
 NOT_DOG_TEAM_MEMBER:403};
export function installDogAscensionApi(app,{verifyProfile,getFirestore,rand=randomInt,clock=Date.now}){
 const auth=async(req,res,next)=>{
  try{const match=/^Bearer\s+([\w.\-]+)$/.exec(String(req.get('authorization')||''));
   if(!match)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   const user=await verifyProfile(match[1]);
   if(!user?.uid)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   req.dogAscensionUid=user.uid;next();
  }catch{return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});}
 };
 const fail=(res,e)=>{
  const err=String(e?.message||'');
  return res.status(ERRORS[err]||500).json({ok:false,error:ERRORS[err]?err:'DOG_ASCENSION_UNAVAILABLE'});
 };
 const refs=uid=>{const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
  return {db,heroRef:db.collection(DOG_HERO_COLLECTION).doc(uid),
   inventoryRef:db.collection(DOG_MATERIALS_COLLECTION).doc(uid),
   progressRef:db.collection(DOG_GATE_PROGRESS_COLLECTION).doc(DOG_GATE_PROGRESS_ID),
   teamRef:db.collection('dog_boss_team_v1').doc('first-three-heroes')};
 };
 app.get('/api/dog/gates/ascension',auth,async(req,res)=>{
  try{
   const {heroRef,inventoryRef,progressRef,teamRef}=refs(req.dogAscensionUid);
   const [hero,inventory,progress,team]=await Promise.all([
    heroRef.get(),inventoryRef.get(),progressRef.get(),teamRef.get()]);
   if(!team.exists||!Array.isArray(team.data()?.members)||
    !team.data().members.some(m=>m?.uid===req.dogAscensionUid))
    throw Error('NOT_DOG_TEAM_MEMBER');
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...ascensionView(hero.exists?hero.data():null,
    inventory.exists?inventory.data():null,progress.exists?progress.data():null)});
  }catch(e){return fail(res,e);}
 });
 app.post('/api/dog/gates/ascension/upgrade',auth,async(req,res)=>{
  try{
   const {requestId,type,expectedLevel}=obj(req.body);
   if(!validId(requestId))throw Error('INVALID_REQUEST_ID');
   const uid=req.dogAscensionUid,{db,heroRef,inventoryRef,progressRef,teamRef}=refs(uid);
   const receiptRef=db.collection(DOG_ASCENSION_RECEIPTS_COLLECTION).doc(uid+'_'+requestId);
   const response=await db.runTransaction(async tx=>{
    const [receipt,heroSnap,inventorySnap,progressSnap,teamSnap]=await Promise.all([
     tx.get(receiptRef),tx.get(heroRef),tx.get(inventoryRef),
     tx.get(progressRef),tx.get(teamRef)
    ]);
    if(!teamSnap.exists||!Array.isArray(teamSnap.data()?.members)||
     !teamSnap.data().members.some(m=>m?.uid===uid))
     throw Error('NOT_DOG_TEAM_MEMBER');
    const hero=heroSnap.exists?heroSnap.data():null,
     inventory=inventorySnap.exists?inventorySnap.data():null,
     progress=progressSnap.exists?progressSnap.data():null;
    if(receipt.exists){
     const prior=receipt.data();
     if(prior.type!==type||prior.expectedLevel!==expectedLevel)
      throw Error('DOG_ASCENSION_RECEIPT_CONFLICT');
     return {view:ascensionView(hero,inventory,progress),result:prior.result,replayed:true};
    }
    const upgrade=ascensionUpgrade(hero,inventory,progress,type,expectedLevel,rand(10000),clock());
    tx.set(heroRef,upgrade.hero);
    tx.set(inventoryRef,upgrade.inventory);
    tx.create(receiptRef,{uid,requestId,type,expectedLevel,result:upgrade.result,createdAt:clock()});
    return {view:ascensionView(upgrade.hero,upgrade.inventory,progress),
     result:upgrade.result,replayed:false};
   });
   res.set('Cache-Control','no-store');return res.json({ok:true,...response});
  }catch(e){return fail(res,e);}
 });
}
