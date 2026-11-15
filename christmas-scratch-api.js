import {DOG_SCRATCH_COLLECTION,dogScratchStatus,buyScratchTicket} from './dog/christmas-scratch.js';
import {DOG_SCRATCH_SETTINGS_COLLECTION,DOG_SCRATCH_SETTINGS_ID,normalizeScratchSettings,validateScratchSettings} from './dog/christmas-scratch-settings.js';

// Shared, authenticated Christmas scratch shop. One settings document for every player.
export function installChristmasScratchApi(app,{getFirestore,admin}){
 const base='/api/hub/scratch';
 async function user(req,res){
  const header=String(req.get('authorization')||'');
  if(!header.startsWith('Bearer ')) {res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});return null;}
  try{
   const claims=await admin.auth().verifyIdToken(header.slice(7));
   if(!claims.uid)throw Error('INVALID_UID');
   return claims.uid;
  }catch{res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});return null;}
 }
 const store=res=>{
  const db=getFirestore();
  if(!db){res.status(503).json({ok:false,error:'SCRATCH_STORAGE_UNAVAILABLE'});return null;}
  return db;
 };
 const fail=(res,e)=>{
  const code=String(e?.message||'SCRATCH_SERVER_ERROR');
  const bad=/^(SCRATCH_|LOGIN_REQUIRED)/.test(code);
  res.status(bad?400:500).json({ok:false,error:bad?code:'SCRATCH_SERVER_ERROR'});
 };
 app.get(base,async(req,res)=>{
  const uid=await user(req,res);if(!uid)return;
  const db=store(res);if(!db)return;
  try{
   const [wallet,settings]=await Promise.all([
    db.collection(DOG_SCRATCH_COLLECTION).doc(uid).get(),
    db.collection(DOG_SCRATCH_SETTINGS_COLLECTION).doc(DOG_SCRATCH_SETTINGS_ID).get()
   ]);
   res.set('Cache-Control','no-store').json({ok:true,canManageScratch:true,
    scratch:dogScratchStatus(wallet.exists?wallet.data():null,null,Date.now(),settings.data())});
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
 app.post(base+'/buy',async(req,res)=>{
  const uid=await user(req,res);if(!uid)return;
  const db=store(res);if(!db)return;
  try{
   const walletRef=db.collection(DOG_SCRATCH_COLLECTION).doc(uid);
   const settingsRef=db.collection(DOG_SCRATCH_SETTINGS_COLLECTION).doc(DOG_SCRATCH_SETTINGS_ID);
   const output=await db.runTransaction(async tx=>{
    const [walletSnap,settingsSnap]=await Promise.all([tx.get(walletRef),tx.get(settingsRef)]);
    const settings=normalizeScratchSettings(settingsSnap.data());
    const bought=buyScratchTicket(walletSnap.data(),null,req.body,{settings});
    if(!bought.unchanged)tx.set(walletRef,bought.wallet);
    return {result:bought.result,scratch:bought.status};
   });
   res.set('Cache-Control','no-store').json({ok:true,...output});
  }catch(e){fail(res,e)}
 });
}
