/* Einmaliges 100-Tore-Willkommensgeschenk. Vergabe nur serverseitig und
 * atomar pro authentifiziertem Profil; Seiten-Reloads duplizieren nichts. */
import {addExpeditionChestToInventory,DOG_MATERIALS_COLLECTION} from './dog-materials.js';
import {checkMonsterBalance} from './monster-wheel.js';

export const DOG_WELCOME_ID='dog-100-welcome-2026-11';
export const DOG_WELCOME_REWARDS=Object.freeze({woodChests:5,premiumPacks:2,monsterSpins:3,peekJokers:2});
const RECEIPTS='dog_100_welcome_gift_v1';
const CHRISTMAS='deal_or_no_deal_christmas_v1';
const PEEK='deal_peek_inventory_v1';
const MAX_BONUS=1000000;
const safeAdd=(value,amount)=>checkMonsterBalance(value,amount,MAX_BONUS);
const val=n=>n===undefined||n===null?0:n;
const response=receipt=>({ok:true,id:DOG_WELCOME_ID,
 claimed:!!receipt,acknowledged:!!receipt?.acknowledgedAt,rewards:DOG_WELCOME_REWARDS});

export function installDogWelcomeGiftApi(app,{verifyProfile,getFirestore}){
 const auth=async(req,res,next)=>{
  try{
   const token=/^Bearer\s+(.+)$/i.exec(String(req.get('authorization')||''))?.[1];
   if(!token)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   const p=await verifyProfile(token);
   if(!p?.uid)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   req.dogWelcomeUid=String(p.uid);next();
  }catch{return res.status(401).json({ok:false,error:'AUTH_FAILED'})}
 };
 const fail=(res,e)=>{
  const error=String(e?.message||'GIFT_UNAVAILABLE');
  console.error('[dog-welcome-gift]',error);
  return res.status(error==='STORAGE_UNAVAILABLE'?503:409).json({ok:false,error});
 };
 const dbRequired=()=>{const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');return db;};
 app.get('/api/dog/welcome/status',auth,async(req,res)=>{
  try{
   const s=await dbRequired().collection(RECEIPTS).doc(req.dogWelcomeUid).get();
   res.set('Cache-Control','no-store');return res.json(response(s.exists?s.data():null));
  }catch(e){return fail(res,e)}
 });
 app.post('/api/dog/welcome/claim',auth,async(req,res)=>{
  try{
   const db=dbRequired(),uid=req.dogWelcomeUid,receiptRef=db.collection(RECEIPTS).doc(uid);
   const chestRef=db.collection(DOG_MATERIALS_COLLECTION).doc(uid);
   const albumRef=db.collection(CHRISTMAS).doc(uid);
   const peekRef=db.collection(PEEK).doc(uid);
   const result=await db.runTransaction(async tx=>{
    const receipt=await tx.get(receiptRef);
    if(receipt.exists)return {...response(receipt.data()),alreadyClaimed:true};
    // Zuerst alle Reads, dann alle Writes: Firestore-Transaktionsregel.
    const [chest,album,peek]=await Promise.all([tx.get(chestRef),tx.get(albumRef),tx.get(peekRef)]);
    const now=Date.now();
    let inventory=chest.exists?chest.data():null;
    for(let i=0;i<DOG_WELCOME_REWARDS.woodChests;i++)
     inventory=addExpeditionChestToInventory(inventory,{version:4,stage:0,tier:'wood',count:2},now);
    const albumData=album.exists?album.data():{};
    const packs=albumData.freeChristmasPacks&&typeof albumData.freeChristmasPacks==='object'&&!Array.isArray(albumData.freeChristmasPacks)
      ?albumData.freeChristmasPacks:{};
    const freeChristmasPacks={...packs,premium:safeAdd(val(packs.premium),DOG_WELCOME_REWARDS.premiumPacks)};
    const monsterWheelTickets=safeAdd(val(albumData.monsterWheelTickets),DOG_WELCOME_REWARDS.monsterSpins);
    const jokerBalance=safeAdd(val(peek.data()?.balance),DOG_WELCOME_REWARDS.peekJokers);
    tx.set(chestRef,inventory,{merge:true});
    tx.set(albumRef,{freeChristmasPacks,monsterWheelTickets,updatedAt:now},{merge:true});
    tx.set(peekRef,{balance:jokerBalance,updatedAt:now},{merge:true});
    tx.create(receiptRef,{id:DOG_WELCOME_ID,uid,claimedAt:now,acknowledgedAt:null,rewards:DOG_WELCOME_REWARDS});
    return {...response({claimedAt:now}),alreadyClaimed:false};
   });
   res.set('Cache-Control','no-store');return res.json(result);
  }catch(e){return fail(res,e)}
 });
 app.post('/api/dog/welcome/ack',auth,async(req,res)=>{
  try{
   const db=dbRequired(),receiptRef=db.collection(RECEIPTS).doc(req.dogWelcomeUid);
   const result=await db.runTransaction(async tx=>{
    const doc=await tx.get(receiptRef);
    if(!doc.exists)throw Error('GIFT_NOT_CLAIMED');
    const item=doc.data();
    if(!item.acknowledgedAt)tx.update(receiptRef,{acknowledgedAt:Date.now()});
    return response({...item,acknowledgedAt:item.acknowledgedAt||Date.now()});
   });
   res.set('Cache-Control','no-store');return res.json(result);
  }catch(e){return fail(res,e)}
 });
}
