/** DOG – earned crafting material chests, independent from Christmas.
 * Never exposes a client endpoint that grants chests. Only verified server match
 * settlement may call addVerifiedChestToInventory() inside its transaction.
 */
import {randomInt} from 'node:crypto';

export const DOG_MATERIALS_COLLECTION='dog_material_inventory_v1';
export const DOG_CHEST_RECEIPTS_COLLECTION='dog_material_chest_open_receipts_v1';
export const DOG_DROP_WEIGHTS=Object.freeze([
 Object.freeze({count:1,weight:35}),
 Object.freeze({count:2,weight:30}),
 Object.freeze({count:3,weight:20}),
 Object.freeze({count:4,weight:10}),
 Object.freeze({count:5,weight:5})
]);
export const DOG_RESOURCES=Object.freeze(['iron','crystal','rune']);
const MAX_INVENTORY=1_000_000;
const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=MAX_INVENTORY?n:0;
const timestamp=n=>Number.isSafeInteger(n)&&n>=0&&n<=10_000_000_000_000?n:0;
const safelyAdd=(a,b)=>{if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a+b>MAX_INVENTORY)throw Error('DOG_MATERIALS_LIMIT');return a+b;};
export function dogInventory(input={}){
 const d=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
 const resources=d.resources&&typeof d.resources==='object'&&!Array.isArray(d.resources)?d.resources:{};
 return {
  version:1,unopened:count(d.unopened),earned:count(d.earned),opened:count(d.opened),
  resources:{iron:count(resources.iron),crystal:count(resources.crystal),rune:count(resources.rune)},
  recent:Array.isArray(d.recent)?d.recent.slice(0,6).filter(x=>x&&Number.isSafeInteger(x.count)&&x.count>=1&&x.count<=5).map(x=>({
   count:x.count,items:{iron:count(x.items?.iron),crystal:count(x.items?.crystal),rune:count(x.items?.rune)},
   openedAt:timestamp(x.openedAt)
  })):[],
  updatedAt:timestamp(d.updatedAt)
 };
}
/** A completed, server-verified match gives exactly ONE unopened chest per authenticated participant. */
export function addVerifiedChestToInventory(input,now=Date.now()){
 const old=dogInventory(input);
 return {...old,unopened:safelyAdd(old.unopened,1),earned:safelyAdd(old.earned,1),updatedAt:now};
}
export function rollDogMaterialChest(rand=randomInt){
 const value=rand(100);
 if(!Number.isInteger(value)||value<0||value>=100)throw Error('DOG_RANDOM_INVALID');
 let remaining=value,qty=5;
 for(const item of DOG_DROP_WEIGHTS){remaining-=item.weight;if(remaining<0){qty=item.count;break;}}
 const items={iron:0,crystal:0,rune:0};
 for(let n=0;n<qty;n++){
  const roll=rand(100);
  if(!Number.isInteger(roll)||roll<0||roll>=100)throw Error('DOG_RANDOM_INVALID');
  const kind=roll<72?'iron':roll<95?'crystal':'rune';
  items[kind]++;
 }
 return {count:qty,items};
}
export function openDogChestInInventory(input,drop,now=Date.now()){
 const old=dogInventory(input);
 if(old.unopened===0)throw Error('NO_DOG_CHESTS');
 if(!drop||!Number.isInteger(drop.count)||drop.count<1||drop.count>5||
  DOG_RESOURCES.some(kind=>!Number.isSafeInteger(drop.items?.[kind])||drop.items[kind]<0)||
  DOG_RESOURCES.reduce((sum,kind)=>sum+drop.items[kind],0)!==drop.count)
  throw Error('INVALID_DOG_CHEST');
 const resources={};
 for(const kind of DOG_RESOURCES)resources[kind]=safelyAdd(old.resources[kind],drop.items[kind]);
 return {
  ...old,unopened:old.unopened-1,opened:safelyAdd(old.opened,1),resources,
  recent:[{count:drop.count,items:{...drop.items},openedAt:now},...old.recent].slice(0,6),
  updatedAt:now
 };
}
const ERROR_STATUS=Object.freeze({LOGIN_REQUIRED:401,INVALID_REQUEST_ID:400,NO_DOG_CHESTS:409,DOG_MATERIALS_LIMIT:409});
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
    rules:{resources:DOG_RESOURCES,chestMin:1,chestMax:5,verifiedGames:['deal-or-no-deal']}});
  }catch(e){return error(res,e)}
 });
 app.post('/api/dog/materials/open',auth,async(req,res)=>{
  try{
   const requestId=req.body?.requestId;
   if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{12,90}$/.test(requestId))throw Error('INVALID_REQUEST_ID');
   const db=firestore(),ref=db.collection(DOG_MATERIALS_COLLECTION).doc(req.dogUid);
   // Key is user-scoped: a reused client ID on another account is independent.
   const receiptRef=db.collection(DOG_CHEST_RECEIPTS_COLLECTION).doc(req.dogUid+'_'+requestId);
   const result=await db.runTransaction(async tx=>{
    const [receipt,inventorySnap]=await Promise.all([tx.get(receiptRef),tx.get(ref)]);
    if(receipt.exists)return {...receipt.data().result,replayed:true};
    const drop=rollDogMaterialChest(rand),updated=openDogChestInInventory(
     inventorySnap.exists?inventorySnap.data():null,drop);
    const response={inventory:updated,drop,replayed:false};
    tx.set(ref,updated);
    tx.create(receiptRef,{uid:req.dogUid,requestId,createdAt:Date.now(),result:response});
    return response;
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...result});
  }catch(e){return error(res,e)}
 });
}
