/** Private, server-authoritative developer controls for the REAL 100 Gates pilot.
 * Only the UID bound by the preview-code activation in dog_live_pilot_owner_v1
 * can change the three-player bot team. Never credit DOG completion here.
 */
import {bossTeam,DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID} from './dog-boss.js';
import {dogGateProgress,dogGateMapView,DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID} from './dog-gates.js';
import {DOG_MATERIALS_COLLECTION,DOG_RESOURCES,dogInventory} from './dog-materials.js';
import {DOG_LIVE_PILOT_COLLECTION,DOG_LIVE_PILOT_ID,DOG_LIVE_BOT_IDS,isLiveBotTeam} from './dog-live-bots.js';

export const DOG_DEVELOPER_RECEIPTS_COLLECTION='dog_developer_action_receipts_v1';
export const DOG_DEVELOPER_BOSS_GATES=Object.freeze(Array.from({length:10},(_,i)=>(i+1)*10));
export const DOG_DEVELOPER_RESOURCE_AMOUNTS=Object.freeze([10,100,1000]);
export const DOG_DEVELOPER_GATE_PRESETS=Object.freeze([9,19,99]);
const maxInventory=1_000_000;
const safeId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{12,90}$/.test(x);

export function developerGateSetup(progressRaw,teamRaw,ownerUid,limit,now=Date.now()){
 if(!DOG_DEVELOPER_GATE_PRESETS.includes(limit)&&
   !(Number.isInteger(limit)&&DOG_DEVELOPER_BOSS_GATES.includes(limit+1)))
  throw Error('DOG_DEVELOPER_INVALID_GATE');
 const team=bossTeam(teamRaw);
 if(!isLiveBotTeam(team,ownerUid))throw Error('DOG_DEVELOPER_BOTS_REQUIRED');
 const prior=dogGateProgress(progressRaw);
 const active=[prior.boss10,...Object.values(prior.groupBosses||{})].some(
  fight=>fight?.phase==='fighting'&&fight.endsAt>now);
 if(active)throw Error('DOG_DEVELOPER_FIGHT_ACTIVE');
 const normals=Array.from({length:limit},(_,i)=>i+1)
  .filter(gate=>gate%10!==0&&gate%10!==5);
 const minis=Array.from({length:limit},(_,i)=>i+1).filter(gate=>gate%10===5);
 const sharedBosses=DOG_DEVELOPER_BOSS_GATES.filter(gate=>gate<=limit&&gate!==100);
 const members=[ownerUid,...DOG_LIVE_BOT_IDS];
 const people={};
 for(const uid of members){
  const old=prior.people[uid]||{};
  people[uid]={...old,currentGate:Math.min(100,limit+1),
   highestGate:Math.min(100,limit+1),normals:[...normals],minis:[...minis],
   lastAttemptAt:0,lastResult:null,miniRewards:old.miniRewards||[]};
 }
 // Intentionally discard previous fight state and wins from the selected boss onward.
 // The final DOG unlock is NEVER generated as part of developer preparation.
 return dogGateProgress({version:1,people,sharedBosses,groupBosses:{},updatedAt:now});
}

export function developerAddMaterials(inventoryRaw,resource,amount,now=Date.now()){
 if(!DOG_DEVELOPER_RESOURCE_AMOUNTS.includes(amount)||
   !(resource==='all'||DOG_RESOURCES.includes(resource)))
  throw Error('DOG_DEVELOPER_INVALID_MATERIAL');
 const inventory=dogInventory(inventoryRaw);
 const resources={...inventory.resources};
 for(const id of resource==='all'?DOG_RESOURCES:[resource]){
  if(resources[id]+amount>maxInventory)throw Error('DOG_MATERIALS_LIMIT');
  resources[id]+=amount;
 }
 return {...inventory,resources,updatedAt:now};
}

export function installDogDeveloperApi(app,{verifyProfile,getFirestore,clock=Date.now}){
 const check=async(req,res,next)=>{
  try{
   const token=/^Bearer\s+([\w.\-]+)$/.exec(String(req.get('authorization')||''))?.[1];
   const identity=token&&await verifyProfile(token);
   if(!identity?.uid)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   req.developerUid=identity.uid;
   next();
  }catch{return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});}
 };
 const refs=()=>{
  const db=getFirestore();
  if(!db)throw Error('STORAGE_UNAVAILABLE');
  return {db,
   owner:db.collection(DOG_LIVE_PILOT_COLLECTION).doc(DOG_LIVE_PILOT_ID),
   team:db.collection(DOG_BOSS_TEAM_COLLECTION).doc(DOG_BOSS_TEAM_ID),
   progress:db.collection(DOG_GATE_PROGRESS_COLLECTION).doc(DOG_GATE_PROGRESS_ID),
   inventory:uid=>db.collection(DOG_MATERIALS_COLLECTION).doc(uid),
   receipt:(uid,id)=>db.collection(DOG_DEVELOPER_RECEIPTS_COLLECTION).doc(uid+'_'+id)};
 };
 const fail=(res,e)=>{
  const message=String(e?.message||'');
  const code=['DOG_DEVELOPER_INVALID_GATE','DOG_DEVELOPER_INVALID_MATERIAL','INVALID_REQUEST_ID'].includes(message)?400:
   ['DOG_DEVELOPER_FIGHT_ACTIVE','DOG_DEVELOPER_BOTS_REQUIRED','DOG_MATERIALS_LIMIT',
    'DOG_DEVELOPER_RECEIPT_CONFLICT'].includes(message)?409:500;
  return res.status(code).json({ok:false,error:code===500?'DOG_DEVELOPER_UNAVAILABLE':message});
 };
 app.get('/api/dog/developer/status',check,async(req,res)=>{
  try{
   const {owner,team,progress}=refs();
   const ownerSnap=await owner.get();
   if(ownerSnap.data()?.uid!==req.developerUid)
    return res.status(404).json({ok:false,error:'DOG_DEVELOPER_NOT_AVAILABLE'});
   const [teamSnap,progressSnap]=await Promise.all([team.get(),progress.get()]);
   res.set('Cache-Control','no-store');
   return res.json({ok:true,developer:true,
    botsReady:isLiveBotTeam(teamSnap.exists?teamSnap.data():null,req.developerUid),
    presets:DOG_DEVELOPER_GATE_PRESETS,bosses:DOG_DEVELOPER_BOSS_GATES,
    resources:DOG_RESOURCES,amounts:DOG_DEVELOPER_RESOURCE_AMOUNTS,
    ...dogGateMapView(teamSnap.exists?teamSnap.data():null,
      progressSnap.exists?progressSnap.data():null,req.developerUid)});
  }catch(e){return fail(res,e);}
 });
 app.post('/api/dog/developer/apply',check,async(req,res)=>{
  try{
   const uid=req.developerUid,{action,requestId,gate,resource,amount}=req.body||{};
   if(!safeId(requestId))throw Error('INVALID_REQUEST_ID');
   const preset=action==='preset'&&DOG_DEVELOPER_GATE_PRESETS.includes(gate);
   const boss=action==='boss'&&DOG_DEVELOPER_BOSS_GATES.includes(gate);
   const materials=action==='materials'&&
    (resource==='all'||DOG_RESOURCES.includes(resource))&&
    DOG_DEVELOPER_RESOURCE_AMOUNTS.includes(amount);
   if(!(preset||boss||materials))
    throw Error(action==='materials'?'DOG_DEVELOPER_INVALID_MATERIAL':'DOG_DEVELOPER_INVALID_GATE');
   const {db,owner,team,progress,inventory,receipt}=refs(),bag=inventory(uid),receiptRef=receipt(uid,requestId);
   const response=await db.runTransaction(async tx=>{
    // Firestore transaction reads must come before any writes.
    const [ownerSnap,receiptSnap,teamSnap,progressSnap,bagSnap]=await Promise.all([
     tx.get(owner),tx.get(receiptRef),tx.get(team),tx.get(progress),tx.get(bag)]);
    if(ownerSnap.data()?.uid!==uid)throw Error('DOG_DEVELOPER_NOT_AVAILABLE');
    const inputs={action,gate:gate??null,resource:resource??null,amount:amount??null};
    if(receiptSnap.exists){
     const last=receiptSnap.data();
     if(JSON.stringify(last.inputs)!==JSON.stringify(inputs))
      throw Error('DOG_DEVELOPER_RECEIPT_CONFLICT');
     return {...last.result,replayed:true};
    }
    const oldTeam=teamSnap.exists?teamSnap.data():null;
    if(!isLiveBotTeam(oldTeam,uid))throw Error('DOG_DEVELOPER_BOTS_REQUIRED');
    const now=clock();
    let result;
    if(materials){
     const next=developerAddMaterials(bagSnap.exists?bagSnap.data():null,resource,amount,now);
     tx.set(bag,next);
     result={action,resource,amount,resources:next.resources};
    }else{
     const limit=preset?gate:gate-1;
     const next=developerGateSetup(progressSnap.exists?progressSnap.data():null,oldTeam,uid,limit,now);
     tx.set(progress,next);
     result={action,gate,preparedTo:limit+1,
      // A developer setup never grants the final DOG game.
      dogUnlocked:false,sharedBosses:next.sharedBosses};
    }
    tx.create(receiptRef,{uid,inputs,result,createdAt:now});
    return result;
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...response});
  }catch(e){
   if(e?.message==='DOG_DEVELOPER_NOT_AVAILABLE')
    return res.status(404).json({ok:false,error:'DOG_DEVELOPER_NOT_AVAILABLE'});
   return fail(res,e);
  }
 });
}
