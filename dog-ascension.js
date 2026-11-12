/** Boss-gated forge progression for the new 100-Tore expedition.
 * Uses existing hero/material docs, but never mutates legacy 20-level heroes
 * without an explicit valid upgrade and authenticated server receipt.
 */
import {randomInt} from 'node:crypto';
import {DOG_HERO_COLLECTION,dogHero,forgeQuote,forgeUpgrade,forgeGateCap} from './dog-forge.js';
import {DOG_MATERIALS_COLLECTION,dogInventory} from './dog-materials.js';
import {DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID} from './dog-gates.js';


export const DOG_ASCENSION_RECEIPTS_COLLECTION='dog_gate_ascension_receipts_v1';
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{12,90}$/.test(id);
export const ascensionCap=raw=>forgeGateCap(raw);
export function ascensionView(heroRaw,inventoryRaw,progressRaw){
 const hero=dogHero(heroRaw),inventory=dogInventory(inventoryRaw);
 const cap=ascensionCap(progressRaw);
 const quotes={};
 for(const type of ['weapon','armor']){
  quotes[type]={...forgeQuote(type,hero.levels[type],inventory.resources,progressRaw),type};
 }
 return {hero:{levels:hero.levels},resources:inventory.resources,
  forgeLevel:cap.forgeLevel,skillsCap:cap.skills,bossSeals:cap.bossSeals,
  equipmentCap:cap.equipment,quotes};
}
export function ascensionUpgrade(heroRaw,inventoryRaw,progressRaw,type,expectedLevel,roll,now=Date.now()){
 if(!['weapon','armor'].includes(type))throw Error('DOG_ASCENSION_INVALID_TYPE');
 const hero=dogHero(heroRaw);
 if(!Number.isSafeInteger(expectedLevel)||expectedLevel!==hero.levels[type])
  throw Error('DOG_ASCENSION_LEVEL_STALE');
 const upgraded=forgeUpgrade(heroRaw,inventoryRaw,type,expectedLevel,roll,now,progressRaw);
 return {...upgraded,
  result:{type,oldLevel:upgraded.result.oldLevel,newLevel:upgraded.result.newLevel,
   success:upgraded.result.success,successChance:upgraded.result.chance,
   cost:upgraded.result.cost}};
}
const ERRORS={LOGIN_REQUIRED:401,INVALID_REQUEST_ID:400,DOG_ASCENSION_INVALID_TYPE:400,
 DOG_ASCENSION_LEVEL_STALE:409,DOG_ASCENSION_LEGACY_LEVEL:409,
 DOG_ASCENSION_BOSS_REQUIRED:409,DOG_ASCENSION_MATERIALS_MISSING:409,
 DOG_ASCENSION_BAD_RANDOM:500,DOG_ASCENSION_RECEIPT_CONFLICT:409,
 DOG_FORGE_BOSS_REQUIRED:409,DOG_MATERIALS_MISSING:409,FORGE_MAX_LEVEL:409,STALE_FORGE_LEVEL:409,
 NOT_DOG_TEAM_MEMBER:403};
/* Cosmetic equipment class comes from the already-read, permanently locked
 * three-hero selection, never from untrusted request bodies. No extra Firestore reads. */
const equipmentHeroClass=(snap,uid)=>{
 const team=snap?.exists?snap.data():null;
 const hero=team?.heroClasses?.[uid];
 return team?.heroLocks?.[uid]===true&&
  ['krieger','magierin','waechter'].includes(hero)?hero:null;
};
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
    inventory.exists?inventory.data():null,progress.exists?progress.data():null),
    heroClass:equipmentHeroClass(team,req.dogAscensionUid)});
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
     return {view:{...ascensionView(hero,inventory,progress),
      heroClass:equipmentHeroClass(teamSnap,uid)},result:prior.result,replayed:true};
    }
    const upgrade=ascensionUpgrade(hero,inventory,progress,type,expectedLevel,rand(10000),clock());
    tx.set(heroRef,upgrade.hero);
    tx.set(inventoryRef,upgrade.inventory);
    tx.create(receiptRef,{uid,requestId,type,expectedLevel,result:upgrade.result,createdAt:clock()});
    return {view:{...ascensionView(upgrade.hero,upgrade.inventory,progress),
      heroClass:equipmentHeroClass(teamSnap,uid)},
     result:upgrade.result,replayed:false};
   });
   res.set('Cache-Control','no-store');return res.json({ok:true,...response});
  }catch(e){return fail(res,e);}
 });
}
