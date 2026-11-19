import {randomUUID} from 'node:crypto';
import {DOG_SCRATCH_COLLECTION,dogScratchStatus,buyScratchTicket} from './dog/christmas-scratch.js';
import {DOG_SCRATCH_SETTINGS_COLLECTION,DOG_SCRATCH_SETTINGS_ID,
 normalizeScratchSettings,validateScratchSettings,
 updateGiftScratchSettings,updateSnowScratchSettings} from './dog/christmas-scratch-settings.js';
import {GIFTS_EDITION_COLLECTION,GIFTS_EDITION_CURRENT,GIFTS_EDITION_HISTORY_COLLECTION,
 createGiftsEdition,giftsEditionPublic,issueGiftsEditionTicket} from './dog/christmas-gifts-edition.js';
import {SNOW_EDITION_COLLECTION,SNOW_EDITION_CURRENT,SNOW_EDITION_HISTORY_COLLECTION,
 createSnowEdition,snowEditionPublic,issueSnowEditionTicket} from './dog/christmas-snow-edition.js';
import {editFixedEdition} from './dog/christmas-edition-plan.js';
import {TIC_EDITION_COLLECTION,TIC_EDITION_CURRENT,TIC_EDITION_HISTORY_COLLECTION,
 createTicEdition,ticEditionPublic,editTicEdition,issueTicEditionTicket} from './dog/christmas-tic-edition.js';
import {OTHER_EDITION_VARIANTS,OTHER_EDITION_COLLECTION,OTHER_EDITION_HISTORY,
 createOtherEdition,otherEditionPublic,editOtherEdition,issueOtherEditionTicket}
 from './dog/christmas-other-editions.js';

/**
 * Authenticated shared Christmas scratch service. Edition and wallet writes
 * MUST share the same Firestore transaction: no double selling, no rerolls,
 * no extra background writes. All previously issued receipts remain valid.
 */
export function installChristmasScratchApi(app,{getFirestore,admin}){
 const base='/api/hub/scratch';
 const variants={
  gifts:{collection:GIFTS_EDITION_COLLECTION,history:GIFTS_EDITION_HISTORY_COLLECTION,
   public:giftsEditionPublic,response:'giftsEdition'},
  snow_collect:{collection:SNOW_EDITION_COLLECTION,history:SNOW_EDITION_HISTORY_COLLECTION,
   public:snowEditionPublic,response:'snowEdition'},
  tic_tac_toe:{collection:TIC_EDITION_COLLECTION,history:TIC_EDITION_HISTORY_COLLECTION,
   public:ticEditionPublic,response:'ticEdition'},
  ...Object.fromEntries(OTHER_EDITION_VARIANTS.map(variant=>[variant,{
   collection:OTHER_EDITION_COLLECTION,history:OTHER_EDITION_HISTORY,
   public:otherEditionPublic,response:'otherEdition'
  }]))
 };
 async function user(req,res){
  const header=String(req.get('authorization')||'');
  if(!header.startsWith('Bearer ')){res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});return null}
  try{
   const decoded=await admin.auth().verifyIdToken(header.slice(7));
   if(!decoded?.uid)throw Error('LOGIN_REQUIRED');
   return decoded.uid;
  }catch{res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});return null}
 }
 const store=res=>{
  const db=getFirestore();
  if(!db){res.status(503).json({ok:false,error:'SCRATCH_STORAGE_UNAVAILABLE'});return null}
  return db;
 };
 const fail=(res,error)=>{
  const code=String(error?.message||'SCRATCH_SERVER_ERROR');
  const safe=/^(SCRATCH_|EDITION_)/.test(code);
  res.status(safe?(code.endsWith('_CHANGED')?409:400):500)
   .set('Cache-Control','no-store')
   .json({ok:false,error:safe?code:'SCRATCH_SERVER_ERROR'});
 };
 const refs=db=>({
  gifts:db.collection(GIFTS_EDITION_COLLECTION).doc(GIFTS_EDITION_CURRENT),
  snow_collect:db.collection(SNOW_EDITION_COLLECTION).doc(SNOW_EDITION_CURRENT),
  tic_tac_toe:db.collection(TIC_EDITION_COLLECTION).doc(TIC_EDITION_CURRENT),
  ...Object.fromEntries(OTHER_EDITION_VARIANTS.map(variant=>
   [variant,db.collection(OTHER_EDITION_COLLECTION).doc('current_'+variant)]))
 });
 const normalizedEdition=(variant,snap)=>variants[variant].public(snap?.data());
 const editionResponse=(gifts,snow,tic)=>({
  giftsEdition:giftsEditionPublic(gifts),snowEdition:snowEditionPublic(snow),
  ticEdition:ticEditionPublic(tic)
 });
 app.get(base,async(req,res)=>{
  const uid=await user(req,res);if(!uid)return;
  const db=store(res);if(!db)return;
  try{
   const list=refs(db);
   const [wallet,settings,gifts,snow,tic,...other]=await Promise.all([
    db.collection(DOG_SCRATCH_COLLECTION).doc(uid).get(),
    db.collection(DOG_SCRATCH_SETTINGS_COLLECTION).doc(DOG_SCRATCH_SETTINGS_ID).get(),
    list.gifts.get(),list.snow_collect.get(),list.tic_tac_toe.get(),
    ...OTHER_EDITION_VARIANTS.map(variant=>list[variant].get())
   ]);
   res.set('Cache-Control','no-store').json({ok:true,canManageScratch:true,
    scratch:dogScratchStatus(wallet.exists?wallet.data():null,null,Date.now(),settings.data()),
    ...editionResponse(gifts.data(),snow.data(),tic.data()),
    otherEditions:Object.fromEntries(OTHER_EDITION_VARIANTS.map((variant,i)=>
     [variant,otherEditionPublic(other[i]?.data())]))});
  }catch(e){fail(res,e)}
 });
 app.post(base+'/settings',async(req,res)=>{
  const uid=await user(req,res);if(!uid)return;
  const db=store(res);if(!db)return;
  try{
   const settings=validateScratchSettings(req.body?.settings);
   await db.collection(DOG_SCRATCH_SETTINGS_COLLECTION).doc(DOG_SCRATCH_SETTINGS_ID)
    .set({...settings,updatedBy:uid,updatedAt:Date.now()});
   res.set('Cache-Control','no-store').json({ok:true,settings:normalizeScratchSettings(settings)});
  }catch(e){fail(res,e)}
 });
 for(const variant of ['gifts','snow_collect']){
  app.post(base+'/settings/'+variant,async(req,res)=>{
   const uid=await user(req,res);if(!uid)return;
   const db=store(res);if(!db)return;
   try{
    const key=variant==='gifts'?'gifts':'snow';
    const doc=db.collection(DOG_SCRATCH_SETTINGS_COLLECTION).doc(DOG_SCRATCH_SETTINGS_ID);
    const next=await db.runTransaction(async tx=>{
     const snap=await tx.get(doc);
     const settings=variant==='gifts'?
      updateGiftScratchSettings(snap.data(),req.body?.gifts):
      updateSnowScratchSettings(snap.data(),req.body?.snow);
     tx.set(doc,{...settings,updatedBy:uid,updatedAt:Date.now()});
     return settings;
    });
    res.set('Cache-Control','no-store').json({ok:true,settings:normalizeScratchSettings(next)});
   }catch(e){fail(res,e)}
  });
 }
 for(const variant of Object.keys(variants)){
  const meta=variants[variant];
  const editionRef=db=>db.collection(meta.collection).doc(
   OTHER_EDITION_VARIANTS.includes(variant)?'current_'+variant:'current');
  app.post(base+'/editions/'+variant,async(req,res)=>{
   const uid=await user(req,res);if(!uid)return;
   const db=store(res);if(!db)return;
   try{
    const id=randomUUID(),now=Date.now(),rawBudget=req.body?.maxTotalCoins;
    const editionDoc=editionRef(db),settingsDoc=db.collection(DOG_SCRATCH_SETTINGS_COLLECTION).doc(DOG_SCRATCH_SETTINGS_ID);
    const created=await db.runTransaction(async tx=>{
     const [oldSnap,settingsSnap]=await Promise.all([tx.get(editionDoc),tx.get(settingsDoc)]);
     const previous=oldSnap.data();
     if(previous&&previous.issued<500)throw Error('SCRATCH_'+
      (variant==='gifts'?'GIFTS':variant==='snow_collect'?'SNOW':variant==='tic_tac_toe'?'TIC':'OTHER')+'_EDITION_ACTIVE');
     const settings=variant==='gifts'?updateGiftScratchSettings(settingsSnap.data(),req.body?.gifts):
      variant==='snow_collect'?updateSnowScratchSettings(settingsSnap.data(),req.body?.snow):
      normalizeScratchSettings(settingsSnap.data());
     const selectedCategory=['gifts','snow_collect'].includes(variant)?
      req.body?.prizeCategory??1:null;
     if(selectedCategory!==null&&(!Number.isInteger(selectedCategory)||
      selectedCategory<1||selectedCategory>3))throw Error('SCRATCH_EDITION_PRIZE_CATEGORY_INVALID');
     const edition=variant==='gifts'?createGiftsEdition({
      id,createdAt:now,createdBy:uid,maxTotalCoins:rawBudget,settings}):
      variant==='snow_collect'?createSnowEdition({
       id,createdAt:now,createdBy:uid,maxTotalCoins:rawBudget,settings}):
      variant==='tic_tac_toe'?
       createTicEdition({id,createdAt:now,createdBy:uid,maxTotalCoins:rawBudget,config:req.body?.tic}):
       createOtherEdition({id,variant,createdAt:now,createdBy:uid,
        maxTotalCoins:rawBudget,config:req.body?.config});
     if(selectedCategory!==null)edition.prizeCategory=selectedCategory;
     if(previous)tx.set(db.collection(meta.history).doc(
      OTHER_EDITION_VARIANTS.includes(variant)?variant+'_'+previous.id:previous.id),previous);
     tx.set(editionDoc,edition);
     if(['gifts','snow_collect'].includes(variant))
      tx.set(settingsDoc,{...settings,updatedBy:uid,updatedAt:now});
     return {edition,settings};
    });
    res.set('Cache-Control','no-store').json({ok:true,
     [meta.response]:meta.public(created.edition),settings:created.settings});
   }catch(e){fail(res,e)}
  });
  app.post(base+'/editions/'+variant+'/edit',async(req,res)=>{
   const uid=await user(req,res);if(!uid)return;
   const db=store(res);if(!db)return;
   try{
    const editionDoc=editionRef(db),settingsDoc=db.collection(DOG_SCRATCH_SETTINGS_COLLECTION).doc(DOG_SCRATCH_SETTINGS_ID);
    const updated=await db.runTransaction(async tx=>{
     const [oldSnap,settingsSnap]=await Promise.all([tx.get(editionDoc),tx.get(settingsDoc)]);
     const current=oldSnap.data();
     if(!current||current.id!==req.body?.editionId||
      !Number.isInteger(req.body?.expectedRevision)||
      current.revision!==req.body.expectedRevision)
      throw Error('SCRATCH_EDITION_CHANGED');
     if(current.createdBy!==uid)throw Error('SCRATCH_EDITION_ONLY_CREATOR');
     if(current.issued>=500)throw Error('SCRATCH_EDITION_ALREADY_COMPLETE');
     const settings=variant==='gifts'?updateGiftScratchSettings(settingsSnap.data(),req.body?.gifts):
      variant==='snow_collect'?updateSnowScratchSettings(settingsSnap.data(),req.body?.snow):
      normalizeScratchSettings(settingsSnap.data());
     const selectedCategory=['gifts','snow_collect'].includes(variant)?
      req.body?.prizeCategory??current.prizeCategory??1:null;
     if(selectedCategory!==null&&(!Number.isInteger(selectedCategory)||
      selectedCategory<1||selectedCategory>3))throw Error('SCRATCH_EDITION_PRIZE_CATEGORY_INVALID');
     const next=variant==='tic_tac_toe'?
      editTicEdition(current,{config:req.body?.tic,maxTotalCoins:req.body?.maxTotalCoins}):
      OTHER_EDITION_VARIANTS.includes(variant)?
      editOtherEdition(current,{config:req.body?.config,maxTotalCoins:req.body?.maxTotalCoins}):
      editFixedEdition(current,{settings,maxTotalCoins:req.body?.maxTotalCoins});
     if(selectedCategory!==null)next.prizeCategory=selectedCategory;
     tx.set(editionDoc,next);
     if(['gifts','snow_collect'].includes(variant))
      tx.set(settingsDoc,{...settings,updatedBy:uid,updatedAt:Date.now()});
     return {edition:next,settings};
    });
    res.set('Cache-Control','no-store').json({ok:true,
     [meta.response]:meta.public(updated.edition),settings:updated.settings});
   }catch(e){fail(res,e)}
  });
 }
 app.post(base+'/buy',async(req,res)=>{
  const uid=await user(req,res);if(!uid)return;
  const db=store(res);if(!db)return;
  try{
   const walletRef=db.collection(DOG_SCRATCH_COLLECTION).doc(uid);
   const settingsRef=db.collection(DOG_SCRATCH_SETTINGS_COLLECTION).doc(DOG_SCRATCH_SETTINGS_ID);
   const editionRefs=refs(db);
   const variant=req.body?.variantId;
   const ref=editionRefs[variant]||null;
   const output=await db.runTransaction(async tx=>{
    const [walletSnap,settingsSnap,editionSnap]=await Promise.all([
     tx.get(walletRef),tx.get(settingsRef),ref?tx.get(ref):Promise.resolve(null)
    ]);
    const settings=normalizeScratchSettings(settingsSnap.data());
    const raw=editionSnap?.data();
    let bought,next=null;
    if(raw&&variant==='gifts'){
     const outcome=issueGiftsEditionTicket(walletSnap.data(),null,req.body,raw,settings);
     bought=outcome.purchase;next=outcome.edition;
    }else if(raw&&variant==='snow_collect'){
     const outcome=issueSnowEditionTicket(walletSnap.data(),null,req.body,raw,settings);
     bought=outcome.purchase;next=outcome.edition;
    }else if(raw&&variant==='tic_tac_toe'){
     const outcome=issueTicEditionTicket(walletSnap.data(),null,req.body,raw,settings);
     bought=outcome.purchase;next=outcome.edition;
    }else if(raw&&OTHER_EDITION_VARIANTS.includes(variant)){
     const outcome=issueOtherEditionTicket(walletSnap.data(),null,req.body,raw,settings);
     bought=outcome.purchase;next=outcome.edition;
    }else bought=buyScratchTicket(walletSnap.data(),null,req.body,{settings});
    if(!bought.unchanged){
     tx.set(walletRef,bought.wallet);
     if(next)tx.set(ref,next);
    }
    return {result:bought.result,scratch:bought.status,
     ...(raw?{[variants[variant].response]:variants[variant].public(next??raw)}:{})};
   });
   res.set('Cache-Control','no-store').json({ok:true,...output});
  }catch(e){fail(res,e)}
 });
}
