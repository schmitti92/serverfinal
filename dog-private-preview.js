/** PRIVATE 100-Tore playtest: ONE real Firebase profile + TWO server-side bots.
 * An unguessable Render secret and the first claimant's verified UID protect
 * this sandbox. No real hero, currency, DOG access or expedition record is
 * ever touched by this module.
 */
import {randomInt,timingSafeEqual} from 'node:crypto';
import {bossJoin,bossTeam} from './dog-boss.js';
import {dogGateProgress,dogGateMapView,dogGateFight} from './dog-gates.js';
import {dogHero,forgeView,forgeUpgrade} from './dog-forge.js';
import {dogInventory,addExpeditionChestToInventory,
 openExpeditionChestInInventory} from './dog-materials.js';
import {dogChestOffer} from './dog-balance.js';
import {boss10Ready,boss10MiniAnswer,boss10Finish,boss10View,boss10State}
 from './dog-boss10.js';
import {groupBossReady,groupBossMiniAnswer,groupBossFinish,groupBossView,groupBossState}
 from './dog-group-boss.js';
import {dogMiniTargetIndex} from './dog-boss-minigames.js';

export const DOG_PREVIEW_COLLECTION='dog_private_100_gates_v1';
export const DOG_PREVIEW_DOC='single_owner_sandbox';
export const DOG_PREVIEW_BOTS=Object.freeze(['preview-bot-alpha','preview-bot-beta']);
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{12,90}$/.test(x);
const clean=x=>String(x||'Spieler').replace(/[<>\r\n\t]/g,'').trim().slice(0,32)||'Spieler';
const normal=g=>g>=1&&g<=99&&g%5!==0;
const validBoss=g=>Number.isSafeInteger(g)&&g>=10&&g<=100&&g%10===0;
const active=(raw,g)=>g===10?boss10State(dogGateProgress(raw).boss10):
 groupBossState(g, dogGateProgress(raw).groupBosses[g]);
const basePerson=()=>({currentGate:1,highestGate:1,normals:[],minis:[],
 miniRewards:[],lastAttemptAt:0,lastResult:null});
const validSecret=value=>{
 const expected=String(process.env.DOG_100_GATES_PREVIEW_CODE||'');
 const supplied=String(value||'');
 if(expected.length<20||expected.length!==supplied.length)return false;
 return timingSafeEqual(Buffer.from(expected),Buffer.from(supplied));
};
const botHero=(gate,index)=>{
 const level=gate/10,skills=Math.min(50,level*5);
 const value=index===0?.88:.76;
 return {levels:{weapon:level,armor:level,
  attack_power:Math.floor(skills*value),
  destruction:Math.floor(skills*value),
  vitality:Math.floor(skills*value),
  blocking:Math.floor(skills*value)}};
};
export function createPrivateExpedition(uid,name,now=Date.now()){
 let team=bossJoin(null,uid,clean(name),null,now);
 for(const [i,id] of DOG_PREVIEW_BOTS.entries())
  team=bossJoin(team,id,i===0?'🤖 Nova (Bot)':'🤖 Titan (Bot)',
   botHero(10,i),now);
 const people=Object.fromEntries([uid,...DOG_PREVIEW_BOTS].map(id=>[id,basePerson()]));
 return {version:1,ownerUid:uid,team,progress:{...dogGateProgress(null),people},
  hero:dogHero(null),inventory:dogInventory(null),bossGate:10,
  receipts:{},updatedAt:now};
}
export function preparePrivateChapter(raw,gate,now=Date.now()){
 if(!validBoss(gate))throw Error('PREVIEW_INVALID_GATE');
 const data=obj(raw),uid=data.ownerUid;
 const normals=Array.from({length:gate-1},(_,i)=>i+1).filter(normal);
 const won=Array.from({length:gate/10-1},(_,i)=>(i+1)*10);
 const people=Object.fromEntries([uid,...DOG_PREVIEW_BOTS].map(id=>[id,{
  ...basePerson(),normals:[...normals],currentGate:gate,highestGate:gate
 }]));
 const progress={...dogGateProgress(null),people,sharedBosses:won,updatedAt:now};
 const cap=gate/10,skills=Math.min(50,cap*5);
 const hero=dogHero({levels:{weapon:cap,armor:cap,attack_power:skills,
  destruction:skills,vitality:skills,blocking:skills,
  critical:Math.floor(skills*.7),precision:Math.floor(skills*.7)}});
 const inventory=dogInventory({resources:Object.fromEntries(
  Object.keys(dogInventory(null).resources).map(key=>[key,12]))});
 return {...data,progress,hero,inventory,bossGate:gate,receipts:{},updatedAt:now};
}
const copyBotWins=(raw,gate,now)=>{
 const progress=dogGateProgress(raw);
 const people={...progress.people};
 for(const id of DOG_PREVIEW_BOTS){
  const p=people[id]||basePerson(),normals=Array.from(new Set([...p.normals,gate])).sort((a,b)=>a-b);
  people[id]={...p,normals,currentGate:Math.max(p.currentGate,gate+1),
   highestGate:Math.max(p.highestGate,gate+1),lastResult:'win',lastAttemptAt:now};
 }
 return {...progress,people,updatedAt:now};
};
const reply=(data,uid,now)=>{
 const progress=dogGateProgress(data.progress);
 const gate=data.bossGate||10;
 return {preview:true,isolated:true,botCount:2,serverNow:now,
  map:dogGateMapView(data.team,progress,uid),hero:dogHero(data.hero),
  inventory:dogInventory(data.inventory),forge:forgeView(data.hero,data.inventory,progress),
  bossGate:gate,
  boss:validBoss(gate)?gate===10?boss10View(data.team,progress,uid,now):
   groupBossView(gate,data.team,progress,uid,now):null};
};
const botAnswer=(round,correct,time)=>{
 if(round.kind==='reaction')return correct?1:0;
 if(round.kind==='math')return correct?round.correctIndex:(round.correctIndex+1)%3;
 if(round.kind==='dodge'){
  const safe=Array.from({length:round.lanes},(_,i)=>i)
   .find(i=>i!==round.dangerIndex&&i!==round.secondDangerIndex);
  return correct?safe:round.dangerIndex;
 }
 const index=dogMiniTargetIndex(round,time);
 return correct?index:(index+1)%round.lanes;
};
export function advancePrivateBoss(raw,now=Date.now(),rand=randomInt){
 let data=obj(raw),progress=dogGateProgress(data.progress),changed=false;
 const gate=data.bossGate||10;
 if(!validBoss(gate))return {data,changed};
 let boss=active(progress,gate);
 if(boss.phase!=='fighting')return {data,changed};
 for(const [i,id] of DOG_PREVIEW_BOTS.entries()){
  for(const round of boss.miniGames?.rounds||[]){
   if(boss.miniGames?.answers?.[id]?.[round.round])continue;
   const time=round.kind==='reaction'?round.targetMs:round.startMs+1800;
   if(now<boss.startedAt+time)continue;
   // Stable bot personalities. One or two misses are possible each fight.
   const roll=(boss.attempt*17+gate+i*31+round.round*23)%100;
   const correct=roll<(i===0?82:68);
   const answer=botAnswer(round,correct,time);
   const at=boss.startedAt+time;
   const result=gate===10?boss10MiniAnswer(progress,id,round.round,answer,at):
    groupBossMiniAnswer(gate,progress,id,round.round,answer,at);
   progress=result.progress;
   changed=true;
   boss=active(progress,gate);
  }
 }
 if(now>=boss.endsAt){
  progress=(gate===10?boss10Finish(progress,now,rand):
   groupBossFinish(gate,progress,now,rand)).progress;
  changed=true;
 }
 return {data:changed?{...data,progress,updatedAt:now}:data,changed};
}
export function actPrivateExpedition(raw,command,params={},now=Date.now(),rand=randomInt){
 let data=obj(raw),progress=dogGateProgress(data.progress);
 const uid=data.ownerUid,gate=Number(params.gate);
 let result={type:command};
 if(command==='fight'){
  const battle=dogGateFight(progress,uid,gate,data.hero,rand,now);
  progress=battle.progress;
  result=battle.result;
  if(result.win&&normal(gate))progress=copyBotWins(progress,gate,now);
  if(result.win&&gate%10===5){
   const offer=dogChestOffer(Math.min(99,gate+1),rand);
   data={...data,inventory:addExpeditionChestToInventory(data.inventory,offer,now)};
   result={...result,previewReward:{kind:'chest',tier:offer.tier,count:offer.count}};
  }
  data={...data,progress};
 }else if(command==='select'){
  // Viewing another arena is allowed without advancing any real gate or
  // unlocking victory. The boss readiness check still guards attempts.
  if(!validBoss(gate))throw Error('PREVIEW_INVALID_GATE');
  data={...data,bossGate:gate};
  result={type:'select',gate};
 }else if(command==='ready'){
  if(!validBoss(gate))throw Error('PREVIEW_INVALID_GATE');
  const heroes={[uid]:data.hero,
   [DOG_PREVIEW_BOTS[0]]:botHero(gate,0),
   [DOG_PREVIEW_BOTS[1]]:botHero(gate,1)};
  for(const bot of DOG_PREVIEW_BOTS)progress=gate===10?
   boss10Ready(progress,data.team,bot,heroes,now,rand):
   groupBossReady(gate,progress,data.team,bot,heroes,now,rand);
  progress=gate===10?boss10Ready(progress,data.team,uid,heroes,now,rand):
   groupBossReady(gate,progress,data.team,uid,heroes,now,rand);
  data={...data,progress,bossGate:gate};
  result={type:'ready',started:active(progress,gate).phase==='fighting',botsReady:2};
 }else if(command==='minigame'){
  if(!validBoss(gate))throw Error('PREVIEW_INVALID_GATE');
  const completed=gate===10?
   boss10MiniAnswer(progress,uid,params.round,params.answer,now):
   groupBossMiniAnswer(gate,progress,uid,params.round,params.answer,now);
  data={...data,progress:completed.progress};
  result=completed.result;
 }else if(command==='chest'){
  const highest=progress.people[uid]?.highestGate||1;
  const offer=dogChestOffer(Math.min(99,highest),rand);
  data={...data,inventory:addExpeditionChestToInventory(data.inventory,offer,now)};
  result={type:'chest',tier:offer.tier,count:offer.count};
 }else if(command==='open'){
  const opened=openExpeditionChestInInventory(data.inventory,
   String(params.tier||''),rand,now);
  data={...data,inventory:opened.inventory};
  result={type:'open',drop:opened.drop};
 }else if(command==='forge'){
  const up=forgeUpgrade(data.hero,data.inventory,
   String(params.itemId||''),params.expectedLevel,rand(10000),now,progress);
  data={...data,hero:up.hero,inventory:up.inventory};
  result=up.result;
 }else if(command==='prepare'){
  data=preparePrivateChapter(data,gate,now);
  result={type:'prepare',gate,notice:'Nur der Teststand wurde geändert'};
 }else if(command==='reset'){
  data=createPrivateExpedition(uid,data.team?.members?.[0]?.name||'Spieler',now);
  result={type:'reset'};
 }else throw Error('PREVIEW_INVALID_ACTION');
 return {data:{...data,updatedAt:now},result};
}
export function installDogPrivatePreviewApi(app,{verifyProfile,getFirestore,clock=Date.now,rand=randomInt}){
 const path='/api/dog/preview';
 const auth=async(req,res,next)=>{
  if(!validSecret(req.get('x-dog-preview-key')))
   return res.status(404).json({ok:false,error:'PREVIEW_NOT_AVAILABLE'});
  const match=/^Bearer\s+([\w.\-]+)$/.exec(String(req.get('authorization')||''));
  if(!match)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
  try{
   const profile=await verifyProfile(match[1]);
   if(!profile?.uid)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   req.previewUser={uid:profile.uid,name:clean(profile.name||profile.displayName)};
   next();
  }catch{return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});}
 };
 const error=(res,e)=>{
  const code=String(e?.message||'');
  const status=code==='PREVIEW_RESERVED'?403:
   code.startsWith('PREVIEW_')?400:
   /ALREADY|REQUIRED|INVALID|LATE|LOCKED|COOLDOWN|MAX_LEVEL|MATERIALS_MISSING|PREREQUISITES|NOT_RUNNING|STILL_FIGHTING|RUNNING|TOO_LATE/.test(code)?409:500;
  if(status===500)console.error('[dog-preview] unexpected',e);
  return res.status(status).json({ok:false,error:status===500?'PREVIEW_UNAVAILABLE':code});
 };
 const store=()=>{const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
  return {db,ref:db.collection(DOG_PREVIEW_COLLECTION).doc(DOG_PREVIEW_DOC)};};
 const sameOwner=(raw,uid)=>{if(!raw||raw.ownerUid!==uid)throw Error('PREVIEW_RESERVED');return raw;};
 const tick=(data,now)=>advancePrivateBoss(data,now,rand);
 app.post(path+'/access',auth,async(req,res)=>{
  try{
   const {db,ref}=store(),uid=req.previewUser.uid;
   const granted=await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(snap.exists){sameOwner(snap.data(),uid);return true;}
    tx.create(ref,createPrivateExpedition(uid,req.previewUser.name,clock()));
    return true;
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,granted});
  }catch(e){return error(res,e);}
 });
 app.get(path+'/state',auth,async(req,res)=>{
  try{
   const {db,ref}=store(),uid=req.previewUser.uid;
   const snap=await ref.get(),existing=sameOwner(snap.exists?snap.data():null,uid);
   let current=tick(existing,clock());
   if(current.changed){
    current=await db.runTransaction(async tx=>{
     const fresh=await tx.get(ref);
     const data=sameOwner(fresh.exists?fresh.data():null,uid);
     const step=tick(data,clock());
     if(step.changed)tx.set(ref,step.data);
     return step;
    });
   }
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...reply(current.data,uid,clock())});
  }catch(e){return error(res,e);}
 });
 app.post(path+'/action',auth,async(req,res)=>{
  try{
   const {requestId,command,...params}=obj(req.body);
   if(!validId(requestId))throw Error('PREVIEW_INVALID_REQUEST_ID');
   const {db,ref}=store(),uid=req.previewUser.uid;
   const response=await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    const initial=sameOwner(snap.exists?snap.data():null,uid);
    let data=tick(initial,clock()).data;
    const existing=obj(data.receipts)[requestId];
    if(existing){
     if(existing.command!==command||JSON.stringify(existing.params)!==JSON.stringify(params))
      throw Error('PREVIEW_REQUEST_CONFLICT');
     return {result:existing.result,view:reply(data,uid,clock()),replayed:true};
    }
    const changed=actPrivateExpedition(data,command,params,clock(),rand);
    data=changed.data;
    const receipts={...obj(data.receipts),[requestId]:{
     command,params,result:changed.result}};
    const last=Object.entries(receipts).slice(-55);
    data={...data,receipts:Object.fromEntries(last)};
    tx.set(ref,data);
    return {result:changed.result,view:reply(data,uid,clock()),replayed:false};
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...response});
  }catch(e){return error(res,e);}
 });
}
