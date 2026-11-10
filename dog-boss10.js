/** Shared boss at gate 10.
 * Durable three-hero readiness, 30-second encounter and atomic forge unlock.
 * Legacy dog-boss.js test arena is intentionally left untouched.
 */
import {randomInt} from 'node:crypto';
import {DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID,bossTeam} from './dog-boss.js';
import {DOG_HERO_COLLECTION,dogHero} from './dog-forge.js';
import {DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID,dogGateProgress} from './dog-gates.js';
import {dogGroupBossHp,dogWeaponBase,dogArmorBase} from './dog-balance.js';

export const DOG_BOSS10_DURATION_MS=30_000;
export const DOG_BOSS10_COOLDOWN_MS=10*60_000;
export const DOG_BOSS10_RECEIPTS_COLLECTION='dog_gate_boss10_receipts_v1';
const REQUIRED_NORMALS=Object.freeze([1,2,3,4,6,7,8,9]);
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{12,90}$/.test(id);
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const bounded=(x,min,max,otherwise=min)=>Number.isSafeInteger(x)?Math.max(min,Math.min(max,x)):otherwise;
const safeUid=uid=>typeof uid==='string'&&uid.length>0&&uid.length<=200;
const starter=()=>({phase:'waiting',ready:[],reactions:[],startedAt:0,endsAt:0,cooldownUntil:0,attempt:1,roster:[],chancePercent:0,result:null});
export function boss10State(raw){
 const x=obj(raw),p=['waiting','fighting','victory','cooldown'].includes(x.phase)?x.phase:'waiting';
 const out={phase:p,ready:Array.isArray(x.ready)?[...new Set(x.ready.filter(safeUid))].slice(0,3):[],
  reactions:Array.isArray(x.reactions)?[...new Set(x.reactions.filter(safeUid))].slice(0,3):[],
  startedAt:bounded(x.startedAt,0,10_000_000_000_000,0),
  endsAt:bounded(x.endsAt,0,10_000_000_000_000,0),
  cooldownUntil:bounded(x.cooldownUntil,0,10_000_000_000_000,0),
  attempt:bounded(x.attempt,1,1_000_000,1),
  roster:Array.isArray(x.roster)?x.roster.slice(0,3).flatMap(m=>
   safeUid(m?.uid)?[{uid:m.uid,weaponLevel:bounded(m.weaponLevel,1,10,1),
   armorLevel:bounded(m.armorLevel,1,10,1),
   skillPower:bounded(m.skillPower,0,50,0),
   skillDefense:bounded(m.skillDefense,0,50,0)}]:[]):[],
  chancePercent:bounded(x.chancePercent,0,95,0),
  result:x.result?.win===true||x.result?.win===false?
   {win:x.result.win,chancePercent:bounded(x.result.chancePercent,0,95,0),
    roll:bounded(x.result.roll,0,9999,0),
    bossHp:dogGroupBossHp(10)}:null};
 return out;
}
const eligible=p=>REQUIRED_NORMALS.every(g=>p?.normals?.includes(g));
export function boss10View(teamRaw,progressRaw,uid,now=Date.now()){
 const team=bossTeam(teamRaw),progress=dogGateProgress(progressRaw),boss=boss10State(progress.boss10);
 const members=team.members.map(m=>({uid:m.uid,name:m.name,isMe:m.uid===uid,
  ready:boss.ready.includes(m.uid),reacted:boss.reactions.includes(m.uid),
  eligible:eligible(progress.people[m.uid])}));
 return {gate:10,name:'Der Aschewächter',bossHp:dogGroupBossHp(10),
  teamReady:team.members.length===3,isMember:team.members.some(m=>m.uid===uid),
  eligible:eligible(progress.people[uid]),members,
  ...boss,won:progress.sharedBosses.includes(10),
  serverNow:now,remainingMs:boss.phase==='fighting'?Math.max(0,boss.endsAt-now):0,
  cooldownRemainingMs:boss.phase==='cooldown'?Math.max(0,boss.cooldownUntil-now):0};
}
export function boss10Ready(progressRaw,teamRaw,uid,heroByUid={},now=Date.now()){
 const team=bossTeam(teamRaw),progress=dogGateProgress(progressRaw);
 if(team.members.length!==3||!team.members.some(m=>m.uid===uid))throw Error('DOG_BOSS10_NEEDS_THREE');
 if(progress.sharedBosses.includes(10))throw Error('DOG_BOSS10_ALREADY_WON');
 if(!team.members.every(m=>eligible(progress.people[m.uid])))
  throw Error('DOG_BOSS10_PREREQUISITES');
 let boss=boss10State(progress.boss10);
 if(boss.phase==='fighting')throw Error('DOG_BOSS10_RUNNING');
 if(boss.phase==='cooldown'){
  if(now<boss.cooldownUntil)throw Error('DOG_BOSS10_COOLDOWN');
  boss={...starter(),attempt:boss.attempt+1};
 }
 if(boss.ready.includes(uid))return progress;
 const ready=[...boss.ready,uid];
 boss={...boss,ready};
 if(ready.length===3){
  const roster=team.members.map(m=>{
   const levels=dogHero(heroByUid[m.uid]).levels;
   return {uid:m.uid,weaponLevel:Math.min(10,levels.weapon),
    armorLevel:Math.min(10,levels.armor),
    skillPower:Math.min(50,levels.attack_power),
    skillDefense:Math.min(50,levels.vitality)};
  });
  // Equipment drives the chance. Skills and reaction timing add only
  // small bounded percentages; no client-supplied combat numbers.
  const attack=roster.reduce((s,m)=>s+Math.min(10,Math.max(0,
   (dogWeaponBase(m.weaponLevel)/dogWeaponBase(1)-1)*8)),0)/3;
  const defense=roster.reduce((s,m)=>s+Math.min(10,Math.max(0,
   (dogArmorBase(m.armorLevel)/dogArmorBase(1)-1)*8)),0)/3;
  const skills=roster.reduce((s,m)=>s+(m.skillPower+m.skillDefense)/2,0)/3;
  const chancePercent=Math.min(75,Math.round(40+attack+defense+skills*1.2));
  boss={...boss,phase:'fighting',roster,startedAt:now,
   endsAt:now+DOG_BOSS10_DURATION_MS,chancePercent,reactions:[]};
 }
 return {...progress,boss10:boss,updatedAt:now};
}
export function boss10React(progressRaw,uid,now=Date.now()){
 const progress=dogGateProgress(progressRaw),boss=boss10State(progress.boss10);
 if(boss.phase!=='fighting'||now>=boss.endsAt||now<boss.startedAt)throw Error('DOG_BOSS10_NOT_RUNNING');
 if(!boss.ready.includes(uid))throw Error('NOT_DOG_TEAM_MEMBER');
 if(boss.reactions.includes(uid))return progress;
 return {...progress,boss10:{...boss,reactions:[...boss.reactions,uid]},updatedAt:now};
}
export function boss10Finish(progressRaw,now=Date.now(),rand=randomInt){
 const progress=dogGateProgress(progressRaw),boss=boss10State(progress.boss10);
 if(boss.phase!=='fighting')throw Error('DOG_BOSS10_NOT_RUNNING');
 if(now<boss.endsAt)throw Error('DOG_BOSS10_STILL_FIGHTING');
 if(boss.roster.length!==3||boss.ready.length!==3)throw Error('DOG_BOSS10_NEEDS_THREE');
 const percent=Math.min(85,boss.chancePercent+boss.reactions.length*3);
 const roll=rand(10000);
 if(!Number.isSafeInteger(roll)||roll<0||roll>=10000)throw Error('DOG_BOSS10_RANDOM_INVALID');
 const win=roll<percent*100;
 const nextBoss={...boss,phase:win?'victory':'cooldown',
  cooldownUntil:win?0:now+DOG_BOSS10_COOLDOWN_MS,
  result:{win,roll,chancePercent:percent,bossHp:dogGroupBossHp(10)}};
 const sharedBosses=win?[...new Set([...progress.sharedBosses,10])].sort((a,b)=>a-b):progress.sharedBosses;
 return {progress:{...progress,boss10:nextBoss,sharedBosses,updatedAt:now},
  result:nextBoss.result};
}
const ERRORS={LOGIN_REQUIRED:401,INVALID_REQUEST_ID:400,DOG_BOSS10_NEEDS_THREE:409,
 DOG_BOSS10_PREREQUISITES:409,DOG_BOSS10_ALREADY_WON:409,
 DOG_BOSS10_RUNNING:409,DOG_BOSS10_COOLDOWN:409,
 DOG_BOSS10_NOT_RUNNING:409,DOG_BOSS10_STILL_FIGHTING:409,
 NOT_DOG_TEAM_MEMBER:403,DOG_BOSS10_RECEIPT_CONFLICT:409,DOG_BOSS10_RANDOM_INVALID:500};
export function installDogBoss10Api(app,{verifyProfile,getFirestore,rand=randomInt,clock=Date.now}){
 const auth=async(req,res,next)=>{
  try{
   const match=/^Bearer\s+([\w.\-]+)$/.exec(String(req.get('authorization')||''));
   if(!match)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   const p=await verifyProfile(match[1]);
   if(!p?.uid)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   req.dogBoss10Uid=p.uid;next();
  }catch{return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});}
 };
 const fail=(res,e)=>{const code=String(e?.message||'');
  return res.status(ERRORS[code]||500).json({ok:false,error:ERRORS[code]?code:'DOG_BOSS10_UNAVAILABLE'});};
 const refs=()=>{const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
  return {db,teamRef:db.collection(DOG_BOSS_TEAM_COLLECTION).doc(DOG_BOSS_TEAM_ID),
   progressRef:db.collection(DOG_GATE_PROGRESS_COLLECTION).doc(DOG_GATE_PROGRESS_ID)};};
 app.get('/api/dog/gates/boss10',auth,async(req,res)=>{
  try{
   const {teamRef,progressRef}=refs();
   const [team,progress]=await Promise.all([teamRef.get(),progressRef.get()]);
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...boss10View(team.exists?team.data():null,
    progress.exists?progress.data():null,req.dogBoss10Uid,clock())});
  }catch(e){return fail(res,e);}
 });
 for(const command of ['ready','react','finish']){
  app.post('/api/dog/gates/boss10/'+command,auth,async(req,res)=>{
   try{
    const {requestId}=obj(req.body);
    if(!validId(requestId))throw Error('INVALID_REQUEST_ID');
    const {db,teamRef,progressRef}=refs(),uid=req.dogBoss10Uid;
    const receiptRef=db.collection(DOG_BOSS10_RECEIPTS_COLLECTION).doc(uid+'_'+requestId);
    const answer=await db.runTransaction(async tx=>{
     const [receipt,teamSnap,progressSnap]=await Promise.all([
      tx.get(receiptRef),tx.get(teamRef),tx.get(progressRef)
     ]);
     const team=teamSnap.exists?teamSnap.data():null;
     const progress=progressSnap.exists?progressSnap.data():null;
     if(!bossTeam(team).members.some(m=>m.uid===uid))throw Error('NOT_DOG_TEAM_MEMBER');
     if(receipt.exists){
      if(receipt.data().command!==command)throw Error('DOG_BOSS10_RECEIPT_CONFLICT');
      return {view:boss10View(team,progress,uid,clock()),result:receipt.data().result,replayed:true};
     }
     const now=clock();
     let next,result;
     if(command==='ready'){
      const heroes={};
      // To avoid a read after transaction writes, take all three snapshots
      // whenever the ready command is issued. Read-only if not starting yet.
      const roster=bossTeam(team).members;
      const snapshots=await Promise.all(roster.map(m=>tx.get(
       db.collection(DOG_HERO_COLLECTION).doc(m.uid))));
      roster.forEach((m,i)=>{heroes[m.uid]=snapshots[i].exists?snapshots[i].data():null;});
      next=boss10Ready(progress,team,uid,heroes,now);
      result={type:'ready',started:boss10State(next.boss10).phase==='fighting'};
     }else if(command==='react'){
      next=boss10React(progress,uid,now);
      result={type:'reaction',accepted:true};
     }else{
      next=boss10Finish(progress,now,rand).progress;
      result={type:'finish',...boss10State(next.boss10).result};
     }
     tx.set(progressRef,next);
     tx.create(receiptRef,{uid,command,requestId,createdAt:now,result});
     return {view:boss10View(team,next,uid,now),result,replayed:false};
    });
    res.set('Cache-Control','no-store');return res.json({ok:true,...answer});
   }catch(e){return fail(res,e);}
  });
 }
}
