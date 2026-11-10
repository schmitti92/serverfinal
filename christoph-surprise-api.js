/* Christoph's one-time Christmas surprise.
 * Profile-authenticated, transactionally settled, safe against retries and
 * parallel tabs. No game state, card probabilities or wallet changes. */
import {checkMonsterBalance} from './monster-wheel.js';

export const CHRISTOPH_SURPRISE_ID='christoph-gruss-2026-11';
export const CHRISTOPH_SURPRISE_MONSTER=2;
export const CHRISTOPH_SURPRISE_HATS=2;

const RECEIPTS='deal_christoph_surprise_v1';
const ALBUMS='deal_or_no_deal_christmas_v1';
const HATS='deal_christmas_hats_v1';
const MAX_HATS_TICKETS=1000000;

export function installChristophSurpriseApi(app,{verifyProfile,getFirestore}){
 const auth=async(req,res,next)=>{
  try{
   const token=/^Bearer (.+)$/i.exec(req.get('authorization')||'')?.[1];
   if(!token)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   const identity=await verifyProfile(token);
   if(!identity?.uid)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   req.surpriseUid=String(identity.uid);
   next();
  }catch{return res.status(401).json({ok:false,error:'AUTH_FAILED'});}
 };
 const fail=(res,error)=>{
  console.error('[christoph-surprise]',String(error?.message||'UNKNOWN'));
  return res.status(409).json({ok:false,error:String(error?.message||'GIFT_UNAVAILABLE')});
 };
 const receipt=db=>db.collection(RECEIPTS);
 const response=(record)=>({ok:true,id:CHRISTOPH_SURPRISE_ID,
  claimed:!!record,acknowledged:!!record?.acknowledgedAt,
  monsterTickets:CHRISTOPH_SURPRISE_MONSTER,hatsVouchers:CHRISTOPH_SURPRISE_HATS});

 app.get('/api/christoph-surprise/status',auth,async(req,res)=>{
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const doc=await receipt(db).doc(req.surpriseUid).get();
   res.set('Cache-Control','no-store');
   return res.json(response(doc.exists?doc.data():null));
  }catch(e){return fail(res,e);}
 });

 app.post('/api/christoph-surprise/claim',auth,async(req,res)=>{
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const uid=req.surpriseUid,receiptRef=receipt(db).doc(uid);
   const albumRef=db.collection(ALBUMS).doc(uid),hatsRef=db.collection(HATS).doc(uid);
   const result=await db.runTransaction(async tx=>{
    const existing=await tx.get(receiptRef);
    if(existing.exists)return {...response(existing.data()),alreadyClaimed:true};
    // Read every document before the first write (Firestore transaction rule).
    const [albumSnap,hatsSnap]=await Promise.all([tx.get(albumRef),tx.get(hatsRef)]);
    const album=albumSnap.exists?albumSnap.data():{};
    const hats=hatsSnap.exists?hatsSnap.data():{};
    const monsterWheelTickets=checkMonsterBalance(Number(album.monsterWheelTickets||0),CHRISTOPH_SURPRISE_MONSTER);
    const bonusTickets=checkMonsterBalance(Number(hats.bonusTickets||0),CHRISTOPH_SURPRISE_HATS,MAX_HATS_TICKETS);
    const now=Date.now();
    // Retain all existing cards, hats game status, vouchers and other balances.
    tx.set(albumRef,{monsterWheelTickets,updatedAt:now},{merge:true});
    tx.set(hatsRef,{bonusTickets,...(hatsSnap.exists?{}:{voucherOnly:true}),updatedAt:now},{merge:true});
    tx.create(receiptRef,{id:CHRISTOPH_SURPRISE_ID,uid,monsterTickets:CHRISTOPH_SURPRISE_MONSTER,
      hatsVouchers:CHRISTOPH_SURPRISE_HATS,claimedAt:now,acknowledgedAt:null});
    return {...response({claimedAt:now}),alreadyClaimed:false};
   });
   res.set('Cache-Control','no-store');
   return res.json(result);
  }catch(e){return fail(res,e);}
 });

 app.post('/api/christoph-surprise/ack',auth,async(req,res)=>{
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const ref=receipt(db).doc(req.surpriseUid);
   const result=await db.runTransaction(async tx=>{
    const snapshot=await tx.get(ref);
    if(!snapshot.exists)throw Error('GIFT_NOT_CLAIMED');
    const existing=snapshot.data();
    if(!existing.acknowledgedAt)tx.update(ref,{acknowledgedAt:Date.now()});
    return response({...existing,acknowledgedAt:existing.acknowledgedAt||Date.now()});
   });
   res.set('Cache-Control','no-store');
   return res.json(result);
  }catch(e){return fail(res,e);}
 });
}
