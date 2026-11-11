/** Server-authoritative 30-second team bosses, gates 20–100.
 * A single generic engine serves nine later bosses, leaving Boss 10's
 * existing receipts and live-compatible storage untouched.
 *
 * 1 hero: start permitted, victory impossible.
 * 2 heroes: only maxed at that gate + both reactions + 2% rare team strike.
 * 3 heroes: intended route, direct damage versus the boss's real HP.
 */
import {randomInt} from 'node:crypto';
import {DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID,bossTeam} from './dog-boss.js';
import {DOG_HERO_COLLECTION,dogHero} from './dog-forge.js';
import {DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID,dogGateProgress} from './dog-gates.js';
import {dogGroupBossHp,dogWeaponBase,dogArmorBase} from './dog-balance.js';
import {boss10State,DOG_BOSS10_DURATION_MS,DOG_BOSS10_COOLDOWN_MS} from './dog-boss10.js';
import {dogCreateMiniGames,dogPublicMiniGames,dogNormalizeMiniGames,
 dogMiniBonus,dogSubmitMiniAnswer} from './dog-boss-minigames.js';

export const DOG_GROUP_BOSS_GATES=Object.freeze([20,30,40,50,60,70,80,90,100]);
export const DOG_GROUP_BOSS_NAMES=Object.freeze({
 20:'Schattenfürst',30:'Kristallwurm',40:'Dornenkönig',
 50:'Hüter der Tiefe',60:'Flammendrache',70:'Seelenrichter',
 80:'Eisenkoloss',90:'Festungswächter',100:'Der letzte Wächter'
});
export const DOG_GROUP_BOSS_RECEIPTS_COLLECTION='dog_gate_group_boss_receipts_v1';
export const DOG_GROUP_BOSS_ATTACKS_PER_HERO=6;
export const DOG_GROUP_BOSS_DUO_CRITICAL_BP=200;
const validGate=g=>DOG_GROUP_BOSS_GATES.includes(g);
const ensureGate=g=>{if(!validGate(g))throw Error('DOG_GROUP_INVALID_GATE');return g;};
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{12,90}$/.test(x);
const initial=()=>({phase:'waiting',ready:[],reactions:[],startedAt:0,
 endsAt:0,cooldownUntil:0,attempt:1,roster:[],chancePercent:0,miniGames:null,result:null});
const skillCap=gate=>Math.min(50,(gate/10)*5);
const gearCap=gate=>gate/10;
export function groupBossState(gate,raw){
 ensureGate(gate);
 const state=boss10State(raw),hp=dogGroupBossHp(gate);
 return {...state,result:state.result?{...state.result,bossHp:hp,
  hpRemaining:Math.max(0,Math.min(hp,state.result.hpRemaining))}:null};
}
const stateAt=(progress,gate)=>groupBossState(gate,obj(progress.groupBosses)[gate]);
const withState=(progress,gate,state,now)=>({...progress,
 groupBosses:{...obj(progress.groupBosses),[gate]:state},updatedAt:now});
const prerequisites=gate=>Array.from({length:9},(_,i)=>gate-9+i)
 .filter(n=>n%5!==0&&n%10!==0);
const eligible=(gate,progress,uid)=>{
 const current=progress.people[uid];
 return progress.sharedBosses.includes(gate-10)&&
  prerequisites(gate).every(n=>current?.normals?.includes(n));
};
export function groupBossView(gate,teamRaw,raw,uid,now=Date.now()){
 ensureGate(gate);
 const team=bossTeam(teamRaw),progress=dogGateProgress(raw);
 const boss=stateAt(progress,gate);
 const members=team.members.map(m=>({uid:m.uid,name:m.name,isMe:m.uid===uid,
  ready:boss.ready.includes(m.uid),reacted:boss.reactions.includes(m.uid),
  eligible:eligible(gate,progress,m.uid)}));
 const won=progress.sharedBosses.includes(gate);
 return {gate,name:DOG_GROUP_BOSS_NAMES[gate],bossHp:dogGroupBossHp(gate),
  isMember:members.some(m=>m.uid===uid),teamReady:members.length===3,
  eligible:eligible(gate,progress,uid),members,
  participantCount:['fighting','cooldown','victory'].includes(boss.phase)?
   boss.roster.length:boss.ready.length,
  canStart:boss.phase==='waiting'&&boss.ready.includes(uid)&&!won,
  ...boss,miniGames:dogPublicMiniGames(boss.miniGames,uid),phase:won?'victory':boss.phase,won,
  forgeLevel:Math.min(10,gate/10+1),
  finalBoss:gate===100,dogUnlocked:progress.sharedBosses.includes(100),
  serverNow:now,remainingMs:boss.phase==='fighting'?Math.max(0,boss.endsAt-now):0,
  cooldownRemainingMs:boss.phase==='cooldown'?Math.max(0,boss.cooldownUntil-now):0};
}
const prepareRoster=(gate,ready,team,heroes)=>{
 const allowed=new Set(bossTeam(team).members.map(m=>m.uid));
 const cap=skillCap(gate),equipmentCap=gearCap(gate);
 if(!ready.length||ready.length>3||ready.some(uid=>!allowed.has(uid)))
  throw Error('DOG_GROUP_NOT_READY');
 return ready.map(uid=>{
  const lv=dogHero(heroes[uid]).levels;
  return {uid,weaponLevel:Math.min(equipmentCap,lv.weapon),
   armorLevel:Math.min(equipmentCap,lv.armor),
   skillPower:Math.min(cap,lv.attack_power),
   skillDestruction:Math.min(cap,lv.destruction),
   skillDefense:Math.min(cap,lv.vitality),
   skillGuard:Math.min(cap,lv.blocking)};
 });
};
export function groupBossDamagePotential(gate,roster=[],reactions=[],miniGames=null){
 ensureGate(gate);
 if(!Array.isArray(roster)||roster.length<1||roster.length>3)return 0;
 const seen=new Set(reactions),cap=skillCap(gate),armorReference=dogArmorBase(gearCap(gate));
 return roster.reduce((sum,m)=>{
  const attack=(Math.min(cap,m.skillPower)+Math.min(cap,m.skillDestruction))/(cap*2);
  const defense=(Math.min(cap,m.skillDefense)+Math.min(cap,m.skillGuard))/(cap*2);
  const armor=Math.min(1,dogArmorBase(m.armorLevel)/armorReference);
  const survival=(.74+.26*defense)*(.80+.20*armor);
  const multiplier=miniGames?1+dogMiniBonus(miniGames,m.uid):seen.has(m.uid)?1.10:1;
  return sum+DOG_GROUP_BOSS_ATTACKS_PER_HERO*dogWeaponBase(m.weaponLevel)*
   (.91+.30*attack)*survival*multiplier;
 },0);
}
const maxed=(gate,m)=>m.weaponLevel>=gearCap(gate)&&m.armorLevel>=gearCap(gate)&&
 ['skillPower','skillDestruction','skillDefense','skillGuard']
  .every(k=>m[k]>=skillCap(gate));
export function groupBossResolveCombat(gate,roster,reactions=[],rand=randomInt,miniGames=null){
 ensureGate(gate);
 if(!Array.isArray(roster)||!roster.length||roster.length>3)
  throw Error('DOG_GROUP_INVALID_ROSTER');
 const hp=dogGroupBossHp(gate),roll=rand(10000);
 if(!Number.isSafeInteger(roll)||roll<0||roll>=10000)
  throw Error('DOG_GROUP_INVALID_RANDOM');
 const luck=.82+.34*(1-roll/9999);
 const reacted=roster.filter(m=>reactions.includes(m.uid)).map(m=>m.uid);
 let damage=groupBossDamagePotential(gate,roster,reacted,miniGames)*luck,rareCritical=false;
 if(roster.length===1)damage=Math.min(damage,hp-1);
 if(roster.length===2){
  const miniReady=miniGames?
   roster.every(m=>Object.values(dogNormalizeMiniGames(miniGames)?.answers[m.uid]||{})
    .filter(answer=>answer.correct).length>=2):reacted.length===2;
  const possible=roster.every(m=>maxed(gate,m))&&miniReady;
  if(possible){
   const special=rand(10000);
   if(!Number.isSafeInteger(special)||special<0||special>=10000)
    throw Error('DOG_GROUP_INVALID_RANDOM');
   rareCritical=special<DOG_GROUP_BOSS_DUO_CRITICAL_BP;
  }
  // Without BOTH maxed heroes, two reactions and the rare event, the
  // total is strictly below the HP threshold. Never a lucky bypass.
  damage=rareCritical?Math.max(hp,damage*1.35):Math.min(damage,hp-1);
 }
 const dealt=Math.max(0,Math.round(damage));
 const win=roster.length>=2&&dealt>=hp;
 return {win,bossHp:hp,damage:dealt,hpRemaining:Math.max(0,hp-dealt),
  participants:roster.length,rareCritical,roll,reactionCount:reacted.length};
}
const startFight=(gate,progress,team,ready,heroes,now,rand=randomInt)=>{
 const roster=prepareRoster(gate,ready,team,heroes);
 const hp=dogGroupBossHp(gate);
 const forecast=groupBossDamagePotential(gate,roster,[]);
 const chancePercent=roster.length===1?0:roster.length===2?
  (roster.every(m=>maxed(gate,m))?2:0):
  Math.max(0,Math.min(95,Math.round(50+90*(forecast/hp-1))));
 const previous=stateAt(progress,gate);
 return withState(progress,gate,{...previous,ready:[...ready],roster,
  phase:'fighting',startedAt:now,endsAt:now+DOG_BOSS10_DURATION_MS,
  chancePercent,reactions:[],miniGames:dogCreateMiniGames(gate,rand)},now);
};
export function groupBossReady(gate,progressRaw,teamRaw,uid,heroes={},now=Date.now(),rand=randomInt){
 ensureGate(gate);
 const team=bossTeam(teamRaw),p=dogGateProgress(progressRaw);
 if(!team.members.some(m=>m.uid===uid))throw Error('NOT_DOG_TEAM_MEMBER');
 if(p.sharedBosses.includes(gate))throw Error('DOG_GROUP_ALREADY_WON');
 if(!eligible(gate,p,uid))throw Error('DOG_GROUP_PREREQUISITES');
 let state=stateAt(p,gate);
 if(state.phase==='fighting')throw Error('DOG_GROUP_RUNNING');
 if(state.phase==='victory')throw Error('DOG_GROUP_ALREADY_WON');
 if(state.phase==='cooldown'){
  if(now<state.cooldownUntil)throw Error('DOG_GROUP_COOLDOWN');
  state={...initial(),attempt:state.attempt+1};
 }
 if(state.ready.includes(uid))return p;
 const ready=[...state.ready,uid],next=withState(p,gate,{...state,ready},now);
 return team.members.length===3&&ready.length===3?
  startFight(gate,next,team,ready,heroes,now,rand):next;
}
export function groupBossStart(gate,raw,teamRaw,uid,heroes={},now=Date.now(),rand=randomInt){
 ensureGate(gate);
 const p=dogGateProgress(raw),team=bossTeam(teamRaw),state=stateAt(p,gate);
 if(!team.members.some(m=>m.uid===uid))throw Error('NOT_DOG_TEAM_MEMBER');
 if(p.sharedBosses.includes(gate)||state.phase==='victory')throw Error('DOG_GROUP_ALREADY_WON');
 if(state.phase==='fighting')throw Error('DOG_GROUP_RUNNING');
 if(state.phase==='cooldown')throw Error('DOG_GROUP_COOLDOWN');
 if(!state.ready.includes(uid)||!state.ready.length)throw Error('DOG_GROUP_NOT_READY');
 if(!state.ready.every(id=>eligible(gate,p,id)))throw Error('DOG_GROUP_PREREQUISITES');
 return startFight(gate,p,team,state.ready,heroes,now,rand);
}
export function groupBossReact(gate,raw,uid,now=Date.now()){
 ensureGate(gate);
 const p=dogGateProgress(raw),state=stateAt(p,gate);
 if(state.phase!=='fighting'||now<state.startedAt||now>=state.endsAt)
  throw Error('DOG_GROUP_NOT_RUNNING');
 if(!state.roster.some(m=>m.uid===uid))throw Error('DOG_GROUP_NOT_PARTICIPANT');
 if(state.miniGames)throw Error('DOG_GROUP_USE_MINIGAMES');
 if(state.reactions.includes(uid))return p;
 return withState(p,gate,{...state,reactions:[...state.reactions,uid]},now);
}
export function groupBossMiniAnswer(gate,raw,uid,round,answer,now=Date.now()){
 ensureGate(gate);
 const progress=dogGateProgress(raw),state=stateAt(progress,gate);
 if(state.phase!=='fighting'||now>=state.endsAt||now<state.startedAt)
  throw Error('DOG_MINIGAME_NOT_RUNNING');
 const answered=dogSubmitMiniAnswer(state.miniGames,state.roster,uid,round,answer,now,state.startedAt);
 return {progress:answered.replayed?progress:withState(progress,gate,{...state,miniGames:answered.games},now),
  result:{type:'minigame',round,correct:answered.correct,
   replayed:answered.replayed,
   bonusPercent:Math.round(dogMiniBonus(answered.games,uid)*1000)/10}};
}
export function groupBossFinish(gate,raw,now=Date.now(),rand=randomInt){
 ensureGate(gate);
 const p=dogGateProgress(raw),state=stateAt(p,gate);
 if(state.phase!=='fighting')throw Error('DOG_GROUP_NOT_RUNNING');
 if(now<state.endsAt)throw Error('DOG_GROUP_STILL_FIGHTING');
 const combat=groupBossResolveCombat(gate,state.roster,state.reactions,rand,state.miniGames);
 const finished={...state,phase:combat.win?'victory':'cooldown',
  result:{...combat,chancePercent:state.chancePercent},
  cooldownUntil:combat.win?0:state.endsAt+DOG_BOSS10_COOLDOWN_MS};
 const sharedBosses=combat.win?[...new Set([...p.sharedBosses,gate])].sort((a,b)=>a-b):
  p.sharedBosses;
 const people={...p.people};
 if(combat.win)for(const member of state.roster){
  const current=people[member.uid],nextGate=Math.min(100,gate+1);
  if(current)people[member.uid]={...current,
   currentGate:Math.max(nextGate,current.currentGate),
   highestGate:Math.max(nextGate,current.highestGate??1,current.currentGate)};
 }
 const next=withState({...p,people,sharedBosses},gate,finished,now);
 return {progress:next,result:finished.result};
}
const HTTP_ERRORS={
 DOG_GROUP_INVALID_GATE:400,LOGIN_REQUIRED:401,INVALID_REQUEST_ID:400,
 DOG_GROUP_ALREADY_WON:409,DOG_GROUP_PREREQUISITES:409,
 DOG_GROUP_NOT_READY:409,DOG_GROUP_RUNNING:409,DOG_GROUP_COOLDOWN:409,
 DOG_GROUP_NOT_RUNNING:409,DOG_GROUP_STILL_FIGHTING:409,
 DOG_GROUP_NOT_PARTICIPANT:403,NOT_DOG_TEAM_MEMBER:403,
 DOG_GROUP_INVALID_ROSTER:409,DOG_GROUP_INVALID_RANDOM:500,
 DOG_GROUP_RECEIPT_CONFLICT:409,DOG_GROUP_USE_MINIGAMES:409,
 DOG_MINIGAME_MISSING:409,DOG_MINIGAME_NOT_RUNNING:409,
 DOG_MINIGAME_NOT_PARTICIPANT:403,DOG_MINIGAME_BAD_ROUND:400,
 DOG_MINIGAME_BAD_ANSWER:400,DOG_MINIGAME_TOO_LATE:409
};
/** Authenticated and idempotent API. Only a signed-in team member can
 * read or write the group's boss state, reactions, or reward. */
export function installDogGroupBossApi(app,{verifyProfile,getFirestore,rand=randomInt,clock=Date.now,botLogic=null}){
 const auth=async(req,res,next)=>{
  try{
   const match=/^Bearer\s+([\w.\-]+)$/.exec(String(req.get('authorization')||''));
   if(!match)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   const profile=await verifyProfile(match[1]);
   if(!profile?.uid)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   req.dogGroupUid=profile.uid;return next();
  }catch{return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});}
 };
 const error=(res,e)=>{
  const reason=String(e?.message||'');
  return res.status(HTTP_ERRORS[reason]||500).json({ok:false,
   error:HTTP_ERRORS[reason]?reason:'DOG_GROUP_UNAVAILABLE'});
 };
 const refs=()=>{
  const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
  return {db,teamRef:db.collection(DOG_BOSS_TEAM_COLLECTION).doc(DOG_BOSS_TEAM_ID),
   progressRef:db.collection(DOG_GATE_PROGRESS_COLLECTION).doc(DOG_GATE_PROGRESS_ID)};
 };
 const gateOf=req=>ensureGate(Number(req.params?.gate));
 app.get('/api/dog/gates/boss/:gate',auth,async(req,res)=>{
  try{
   const gate=gateOf(req),{db,teamRef,progressRef}=refs(),uid=req.dogGroupUid;
   const [teamSnap,progressSnap]=await Promise.all([teamRef.get(),progressRef.get()]);
   const team=teamSnap.exists?teamSnap.data():null;
   if(!bossTeam(team).members.some(m=>m.uid===uid))throw Error('NOT_DOG_TEAM_MEMBER');
   let progress=progressSnap.exists?progressSnap.data():null;
   const tick=botLogic?.advanceLiveBotFight(gate,progress,team,uid,clock(),rand);
   if(tick?.changed){
    progress=await db.runTransaction(async tx=>{
     const snapshot=await tx.get(progressRef);
     const latest=botLogic.advanceLiveBotFight(gate,
      snapshot.exists?snapshot.data():null,team,uid,clock(),rand);
     if(latest.changed)tx.set(progressRef,latest.progress);
     return latest.progress;
    });
   }
   const active=stateAt(dogGateProgress(progress),gate);
   if(active.phase==='fighting'&&active.endsAt&&clock()>=active.endsAt){
    // Reconnect settlement is one Firestore transaction, never one roll
    // per reconnecting browser. The first successful commit persists it.
    progress=await db.runTransaction(async tx=>{
     const fresh=await tx.get(progressRef);
     const current=fresh.exists?fresh.data():null;
     const state=stateAt(dogGateProgress(current),gate);
     if(state.phase!=='fighting'||clock()<state.endsAt)return current;
     const updated=groupBossFinish(gate,current,clock(),rand).progress;
     tx.set(progressRef,updated);
     return updated;
    });
   }
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...groupBossView(gate,team,progress,uid,clock())});
  }catch(e){return error(res,e);}
 });
 for(const command of ['ready','start','react','minigame','finish']){
  app.post('/api/dog/gates/boss/:gate/'+command,auth,async(req,res)=>{
   try{
    const gate=gateOf(req),{requestId,round,answer}=obj(req.body);
    if(!validId(requestId))throw Error('INVALID_REQUEST_ID');
    const {db,teamRef,progressRef}=refs(),uid=req.dogGroupUid;
    const receiptRef=db.collection(DOG_GROUP_BOSS_RECEIPTS_COLLECTION)
     .doc(uid+'_'+gate+'_'+requestId);
    const response=await db.runTransaction(async tx=>{
     const [receipt,teamSnap,progressSnap]=await Promise.all([
      tx.get(receiptRef),tx.get(teamRef),tx.get(progressRef)]);
     const team=teamSnap.exists?teamSnap.data():null;
     const progress=progressSnap.exists?progressSnap.data():null;
     if(!bossTeam(team).members.some(m=>m.uid===uid))
      throw Error('NOT_DOG_TEAM_MEMBER');
     if(receipt.exists){
      const prior=receipt.data();
      if(prior.command!==command||prior.gate!==gate||
         (command==='minigame'&&(prior.round!==round||prior.answer!==answer)))
       throw Error('DOG_GROUP_RECEIPT_CONFLICT');
      return {view:groupBossView(gate,team,progress,uid,clock()),
       result:receipt.data().result,replayed:true};
     }
     const now=clock();let next,result,unchanged=false;
     if(command==='ready'&&botLogic?.isLiveBotTeam(team,uid)){
      const snap=await tx.get(db.collection(DOG_HERO_COLLECTION).doc(uid));
      next=botLogic.readyWithLiveBots(gate,progress,team,uid,
       snap.exists?snap.data():null,now,rand);
      result={type:'ready',started:stateAt(next,gate).phase==='fighting',
       botsReady:2};
     }else if(command==='ready'||command==='start'){
      const roster=bossTeam(team).members,heroes={};
      const state=stateAt(dogGateProgress(progress),gate);
      // Read gear only if this click launches the team battle. Manual
      // battles read only the 1–3 heroes who actually participate.
      const autoStart=command==='ready'&&roster.length===3&&
       state.phase==='waiting'&&state.ready.length===2&&!state.ready.includes(uid);
      if(command==='start'||autoStart){
       const needed=command==='start'?
        roster.filter(member=>state.ready.includes(member.uid)):roster;
       const snaps=await Promise.all(needed.map(m=>tx.get(
        db.collection(DOG_HERO_COLLECTION).doc(m.uid))));
       needed.forEach((m,i)=>{heroes[m.uid]=snaps[i].exists?snaps[i].data():null;});
      }
      next=command==='ready'?
       groupBossReady(gate,progress,team,uid,heroes,now,rand):
       groupBossStart(gate,progress,team,uid,heroes,now,rand);
      unchanged=command==='ready'&&state.phase==='waiting'&&state.ready.includes(uid);
      result={type:command,started:stateAt(next,gate).phase==='fighting'};
     }else if(command==='react'){
      next=groupBossReact(gate,progress,uid,now);
      result={type:'reaction',accepted:true};
     }else if(command==='minigame'){
      const completed=groupBossMiniAnswer(gate,progress,uid,round,answer,now);
      next=completed.progress;result=completed.result;
      unchanged=completed.result.replayed===true;
     }else{
      next=groupBossFinish(gate,progress,now,rand).progress;
      result={type:'finish',...stateAt(next,gate).result};
     }
     // Preserve a receipt for idempotency without rewriting progress when
     // a participant is already ready or a minigame was already scored.
     if(!unchanged)tx.set(progressRef,next);
     tx.create(receiptRef,{uid,gate,command,requestId,
      ...(command==='minigame'?{round,answer}:{}),
      result,createdAt:now});
     return {view:groupBossView(gate,team,next,uid,now),result,replayed:false};
    });
    res.set('Cache-Control','no-store');return res.json({ok:true,...response});
   }catch(e){return error(res,e);}
  });
 }
}
