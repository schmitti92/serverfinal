/**
 * Edition-only extension of the authenticated DOG scratch service.
 * DO NOT register /api/hub/scratch, /settings or /buy here. Those existing
 * routes in shared-lobby.js own the personal wallet, shared village lights,
 * current tree entitlements and Christmas-event gating.
 */
import {randomUUID} from 'node:crypto';
import {TIC_EDITION_COLLECTION,TIC_EDITION_CURRENT,TIC_EDITION_HISTORY_COLLECTION,
 createTicEdition,ticEditionPublic,editTicEdition} from './dog/christmas-tic-edition.js';
import {OTHER_EDITION_VARIANTS,OTHER_EDITION_COLLECTION,OTHER_EDITION_HISTORY,
 createOtherEdition,otherEditionPublic,editOtherEdition} from './dog/christmas-other-editions.js';

export function installDogScratchEditionApi(app,{getFirestore,admin}){
 const root='/api/hub/scratch/editions/';
 const specs={
  tic_tac_toe:{collection:TIC_EDITION_COLLECTION,history:TIC_EDITION_HISTORY_COLLECTION,
   document:TIC_EDITION_CURRENT,public:ticEditionPublic,response:'ticEdition'},
  ...Object.fromEntries(OTHER_EDITION_VARIANTS.map(variant=>[variant,{
   collection:OTHER_EDITION_COLLECTION,history:OTHER_EDITION_HISTORY,
   document:'current_'+variant,public:otherEditionPublic,response:'otherEdition'
  }]))
 };
 const fail=(res,e)=>{
  const message=String(e?.message||'SCRATCH_SERVER_ERROR');
  const code=/^(SCRATCH_|EDITION_)/.test(message)?message:'SCRATCH_SERVER_ERROR';
  const status=code==='SCRATCH_EDITION_ONLY_CREATOR'?403:
   /(_CHANGED|_ACTIVE|_SOLD_OUT|_ALREADY_COMPLETE)$/.test(code)?409:
   code==='SCRATCH_SERVER_ERROR'?500:400;
  return res.status(status).set('Cache-Control','no-store').json({ok:false,error:code});
 };
 async function identify(req,res){
  const bearer=/^Bearer (\S+)$/i.exec(String(req.get('authorization')||''))?.[1];
  if(!bearer){res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});return null}
  try{
   const decoded=await admin.auth().verifyIdToken(bearer);
   if(!decoded?.uid)throw Error('LOGIN_REQUIRED');
   return decoded.uid;
  }catch{
   res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});return null;
  }
 }
 function storage(res){
  const db=getFirestore();
  if(!db)res.status(503).json({ok:false,error:'SCRATCH_STORAGE_UNAVAILABLE'});
  return db;
 }
 for(const [variant,meta] of Object.entries(specs)){
  app.post(root+variant,async(req,res)=>{
   const uid=await identify(req,res);if(!uid)return;
   const db=storage(res);if(!db)return;
   try{
    const doc=db.collection(meta.collection).doc(meta.document);
    const id=randomUUID(),createdAt=Date.now();
    const edition=await db.runTransaction(async tx=>{
     const prev=await tx.get(doc),old=prev.exists?prev.data():null;
     if(old&&old.issued<500)throw Error('SCRATCH_EDITION_ACTIVE');
     const next=variant==='tic_tac_toe'?
      createTicEdition({id,createdAt,createdBy:uid,
       maxTotalCoins:req.body?.maxTotalCoins,config:req.body?.tic}):
      createOtherEdition({id,variant,createdAt,createdBy:uid,
       maxTotalCoins:req.body?.maxTotalCoins,config:req.body?.config});
     if(old)tx.set(db.collection(meta.history).doc(
      variant==='tic_tac_toe'?old.id:variant+'_'+old.id),old);
     tx.set(doc,next);
     return next;
    });
    return res.set('Cache-Control','no-store').json({ok:true,[meta.response]:meta.public(edition)});
   }catch(e){return fail(res,e)}
  });
  // Creator-only retirement of the current Premium edition. Only the
  // unsold tickets stop being offered; paid receipts and all previous prizes
  // remain untouched. Archive the complete ledger before releasing "current".
  if(variant==='premium_27')app.post(root+variant+'/retire',async(req,res)=>{
   const uid=await identify(req,res);if(!uid)return;
   const db=storage(res);if(!db)return;
   try{
    if(req.body?.confirmation!=='RETIRE_PREMIUM_27')
     throw Error('SCRATCH_EDITION_CONFIRMATION_REQUIRED');
    const result=await db.runTransaction(async tx=>{
     const ref=db.collection(meta.collection).doc(meta.document);
     const snap=await tx.get(ref),current=snap.exists?snap.data():null;
     if(!current||current.variantId!==variant||
      current.id!==req.body?.editionId||
      !Number.isSafeInteger(req.body?.expectedRevision)||
      current.revision!==req.body.expectedRevision)
      throw Error('SCRATCH_EDITION_CHANGED');
     if(current.createdBy!==uid)throw Error('SCRATCH_EDITION_ONLY_CREATOR');
     if(!Number.isInteger(current.issued)||current.issued<0||current.issued>500)
      throw Error('SCRATCH_EDITION_INVALID_LEDGER');
     if(current.issued===500)throw Error('SCRATCH_EDITION_ALREADY_COMPLETE');
     const archive=db.collection(meta.history).doc(variant+'_'+current.id);
     const oldArchive=await tx.get(archive);
     if(oldArchive.exists)throw Error('SCRATCH_EDITION_ARCHIVE_CONFLICT');
     const closedAt=Date.now();
     tx.set(archive,{...current,retiredAt:closedAt,retiredBy:uid,
      retiredUnsoldCount:500-current.issued,retirementReason:'creator_requested'});
     tx.delete(ref);
     return {id:current.id,variantId:variant,issued:current.issued,
      unsoldCancelled:500-current.issued};
    });
    return res.set('Cache-Control','no-store').json({
     ok:true,otherEdition:null,retiredEdition:result
    });
   }catch(e){return fail(res,e)}
  });
  app.post(root+variant+'/edit',async(req,res)=>{
   const uid=await identify(req,res);if(!uid)return;
   const db=storage(res);if(!db)return;
   try{
    const doc=db.collection(meta.collection).doc(meta.document);
    const next=await db.runTransaction(async tx=>{
     const snap=await tx.get(doc),current=snap.exists?snap.data():null;
     if(!current||current.id!==req.body?.editionId||
      !Number.isInteger(req.body?.expectedRevision)||
      current.revision!==req.body.expectedRevision)throw Error('SCRATCH_EDITION_CHANGED');
     if(current.createdBy!==uid)throw Error('SCRATCH_EDITION_ONLY_CREATOR');
     if(current.issued>=500)throw Error('SCRATCH_EDITION_ALREADY_COMPLETE');
     const revised=variant==='tic_tac_toe'?
      editTicEdition(current,{config:req.body?.tic,maxTotalCoins:req.body?.maxTotalCoins}):
      editOtherEdition(current,{config:req.body?.config,maxTotalCoins:req.body?.maxTotalCoins});
     tx.set(doc,revised);
     return revised;
    });
    return res.set('Cache-Control','no-store').json({ok:true,[meta.response]:meta.public(next)});
   }catch(e){return fail(res,e)}
  });
 }
}
