/** Repeated host-initiated 100-Tore wooden chest gifts.
 * Every explicit click is a new five-chest award to each human room member,
 * including the host. Exactly-once receipts protect retries/tabs.
 * No read/write loops outside the one atomic Firestore transaction.
 */
import {addExpeditionChestToInventory,DOG_MATERIALS_COLLECTION} from './dog-materials.js';

export const DOG_HOST_GIFT_QUANTITY=5;
export const DOG_HOST_GIFT_RECEIPTS='dog_host_wood_chest_gift_v1';
const HUB_ROOMS='spielesammlung_hub_v1';
const ROOM_CODE=/^(?:\d{3}|[A-HJ-NP-Z2-9]{6})$/;
const REQUEST_ID=/^[A-Za-z0-9_-]{12,90}$/;
const OFFER=Object.freeze({version:4,stage:0,tier:'wood',count:2});
const isReal=p=>p&&typeof p.uid==='string'&&p.uid.length>0&&p.uid.length<=200&&!p.bot&&!p.testBot&&!p.uid.startsWith('testbot:');
const uniqueHumanUids=room=>[...new Set((Array.isArray(room?.players)?room.players:[])
 .filter(isReal).map(p=>p.uid))];

export function installDogHostGiftApi(app,{verifyProfile,getFirestore,clock=Date.now}){
 const auth=async(req,res,next)=>{
  try{
   const token=/^Bearer\s+(.+)$/i.exec(String(req.get('authorization')||''))?.[1];
   if(!token)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   const profile=await verifyProfile(token);
   if(!profile?.uid)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   req.dogGiftUid=String(profile.uid);
   next();
  }catch{return res.status(401).json({ok:false,error:'AUTH_FAILED'});}
 };
 app.post('/api/dog/host-gift/:code/wood5',auth,async(req,res)=>{
  const code=String(req.params.code||'').toUpperCase();
  const requestId=req.body?.requestId;
  if(!ROOM_CODE.test(code)||!REQUEST_ID.test(String(requestId||'')))
   return res.status(400).json({ok:false,error:'INVALID_REQUEST'});
  try{
   const db=getFirestore();
   if(!db)throw Error('STORAGE_UNAVAILABLE');
   const hostUid=req.dogGiftUid,roomRef=db.collection(HUB_ROOMS).doc(code);
   const receiptRef=db.collection(DOG_HOST_GIFT_RECEIPTS).doc(code+'_'+requestId);
   const result=await db.runTransaction(async tx=>{
    const [roomSnap,receiptSnap]=await Promise.all([tx.get(roomRef),tx.get(receiptRef)]);
    if(!roomSnap.exists||Number(roomSnap.data()?.expiresAt||0)<=clock())throw Error('ROOM_NOT_FOUND');
    const room=roomSnap.data();
    if(room.hostUid!==hostUid||!uniqueHumanUids(room).includes(hostUid))throw Error('HOST_ONLY');
    if(receiptSnap.exists){
     const previous=receiptSnap.data();
     if(previous.hostUid!==hostUid||previous.code!==code)throw Error('REQUEST_ID_REUSED');
     return {...previous.result,replayed:true};
    }
    // Room may contain spectators; gift all real members, not only active players.
    const uids=uniqueHumanUids(room);
    if(uids.length<1||uids.length>6)throw Error('INVALID_ROOM_MEMBERS');
    const inventoryRefs=uids.map(uid=>db.collection(DOG_MATERIALS_COLLECTION).doc(uid));
    const inventories=await Promise.all(inventoryRefs.map(ref=>tx.get(ref)));
    const now=clock();
    for(let i=0;i<uids.length;i++){
     // One in-memory update per player; the 5 offers collapse into one
     // stored expedition tier, hence one inventory write per member.
     let next=inventories[i].exists?inventories[i].data():null;
     for(let n=0;n<DOG_HOST_GIFT_QUANTITY;n++)
      next=addExpeditionChestToInventory(next,OFFER,now);
     tx.set(inventoryRefs[i],next,{merge:true});
    }
    const result={ok:true,code,quantity:DOG_HOST_GIFT_QUANTITY,players:uids.length,
     totalChests:uids.length*DOG_HOST_GIFT_QUANTITY,
     recipientUids:uids,grantedAt:now,requestId};
    tx.create(receiptRef,{code,requestId,hostUid,result,createdAt:now});
    return {...result,replayed:false};
   });
   res.set('Cache-Control','no-store');return res.json(result);
  }catch(error){
   const message=String(error?.message||'GIFT_FAILED');
   const status=message==='HOST_ONLY'?403:message==='ROOM_NOT_FOUND'?404:
    message==='STORAGE_UNAVAILABLE'?503:409;
   if(status>=500)console.error('[dog-host-gift]',message);
   return res.status(status).json({ok:false,error:message});
  }
 });
}
