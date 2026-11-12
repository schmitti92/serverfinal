/** Shared boss at gate 10.
 * Start with 1–3 heroes: solo is unwinnable, two maxed heroes have a tiny
 * critical chance, three prepared heroes are the intended route.
 * Legacy dog-boss.js test arena is intentionally left untouched.
 */
import {randomInt} from 'node:crypto';
import {DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID,bossTeam} from './dog-boss.js';
import {DOG_HERO_COLLECTION,dogHero} from './dog-forge.js';
import {DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID,dogGateProgress,dogDeveloperCooldownBypass} from './dog-gates.js';
import {dogGroupBossHp,dogWeaponBase,dogArmorBase,dogHeroHp} from './dog-balance.js';
import {dogCreateMiniGames,dogNormalizeMiniGames,dogPublicMiniGames,
 dogMiniBonus,dogMiniDodgePenalty,dogMiniStrongRoundCount,dogMiniTeamShield,dogMiniExchangeView,dogMiniGroupHealth,dogMiniBossLiveHp,dogMiniConfirmedStrikes,dogMiniCinematicVitals,DOG_FINAL5_DURATION_MS,dogSubmitMiniAnswer} from './dog-boss-minigames.js';

// Legacy duration is retained for existing v10/v11 fights and compatibility.
export const DOG_BOSS10_DURATION_MS=101_000;
export const DOG_BOSS10_COOLDOWN_MS=10*60_000;
export const DOG_BOSS10_RECEIPTS_COLLECTION='dog_gate_boss10_receipts_v1';
const REQUIRED_NORMALS=Object.freeze([1,2,3,4,6,7,8,9]);
export const DOG_BOSS10_ATTACKS_PER_HERO=6;
export const DOG_BOSS10_RARE_TWO_HERO_CRITICAL_BP=200; // 2 %
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{12,90}$/.test(id);
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const bounded=(x,min,max,otherwise=min)=>Number.isSafeInteger(x)?Math.max(min,Math.min(max,x)):otherwise;
const safeUid=uid=>typeof uid==='string'&&uid.length>0&&uid.length<=200;
const starter=()=>({phase:'waiting',ready:[],reactions:[],startedAt:0,endsAt:0,cooldownUntil:0,attempt:1,roster:[],chancePercent:0,miniGames:null,result:null});
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
   skillDefense:bounded(m.skillDefense,0,50,0),
   skillDestruction:bounded(m.skillDestruction,0,50,0),
   skillGuard:bounded(m.skillGuard,0,50,0)}]:[]):[],
  chancePercent:bounded(x.chancePercent,0,95,0),
  miniGames:dogNormalizeMiniGames(x.miniGames),
  result:x.result?.win===true||x.result?.win===false?
   {win:x.result.win,chancePercent:bounded(x.result.chancePercent,0,95,0),
    roll:bounded(x.result.roll,0,9999,0),
    bossHp:dogGroupBossHp(10),
    damage:bounded(x.result.damage,0,100_000_000,0),
    hpRemaining:bounded(x.result.hpRemaining,0,100_000_000,dogGroupBossHp(10)),
    participants:bounded(x.result.participants,1,3,3),
    reactionCount:bounded(x.result.reactionCount,0,3,0),
    rareCritical:x.result.rareCritical===true}:null};
 return out;
}
const eligible=p=>REQUIRED_NORMALS.every(g=>p?.normals?.includes(g));
export function boss10View(teamRaw,progressRaw,uid,now=Date.now()){
 const team=bossTeam(teamRaw),progress=dogGateProgress(progressRaw),boss=boss10State(progress.boss10);
 const skipCooldown=boss.phase==='cooldown'&&dogDeveloperCooldownBypass(progress,team,uid);
 const members=team.members.map((m,index)=>({uid:m.uid,name:m.name,isMe:m.uid===uid,
  heroClass:team.heroClasses?.[m.uid]||['krieger','magierin','waechter'][index],
  heroLocked:team.heroLocks?.[m.uid]===true,
  ready:!skipCooldown&&boss.ready.includes(m.uid),reacted:!skipCooldown&&boss.reactions.includes(m.uid),
  eligible:eligible(progress.people[m.uid])}));
 const elapsed=Math.max(0,now-boss.startedAt);
 const exchange=dogMiniExchangeView(boss.miniGames,boss.roster,elapsed,
  hero=>boss10DamagePotential([hero],[],null),
  hero=>dogHeroHp({vitality:hero.skillDefense},hero.armorLevel));
 const groupHealth=dogMiniGroupHealth(boss.miniGames,boss.roster,elapsed,
  hero=>dogHeroHp({vitality:hero.skillDefense},hero.armorLevel));
 const bossMaxHp=dogGroupBossHp(10);
 const confirmedStrikes=dogMiniConfirmedStrikes(boss.miniGames,boss.roster,
  elapsed,bossMaxHp,boss10DamagePotential(boss.roster,[],null),
  hero=>boss10DamagePotential([hero],[],null),
  hero=>dogHeroHp({vitality:hero.skillDefense},hero.armorLevel));
 const bossLiveHp=boss.result&&['victory','cooldown'].includes(boss.phase)?
  boss.result.hpRemaining:
  dogMiniBossLiveHp(boss.miniGames,boss.roster,elapsed,bossMaxHp,
   boss10DamagePotential(boss.roster,[],null),Number(exchange?.cumulativeExtraDamage)||0);
 const cinematicVitals=dogMiniCinematicVitals(bossLiveHp,groupHealth,
  confirmedStrikes,elapsed,bossMaxHp);
 return {gate:10,name:'Der Aschewächter',bossHp:bossMaxHp,bossLiveHp,teamHealth:groupHealth,
  teamReady:team.members.length===3,isMember:team.members.some(m=>m.uid===uid),
  participantCount:boss.phase==='fighting'||boss.phase==='victory'||boss.phase==='cooldown'?boss.roster.length:boss.ready.length,
  canStart:boss.phase==='waiting'&&boss.ready.includes(uid)&&boss.ready.length>=1,
  eligible:eligible(progress.people[uid]),members,
  ...boss,...(skipCooldown?{phase:'waiting',ready:[],cooldownUntil:0}:{}),
  miniGames:{...dogPublicMiniGames(boss.miniGames,uid),
    ...(exchange?{exchange:{...exchange,strikes:confirmedStrikes,
      ...cinematicVitals}}:{})},won:progress.sharedBosses.includes(10),
  developerBossCooldownDisabled:dogDeveloperCooldownBypass(progress,team,uid),
  serverNow:now,remainingMs:boss.phase==='fighting'?Math.max(0,boss.endsAt-now):0,
  cooldownRemainingMs:boss.phase==='cooldown'&&!skipCooldown?Math.max(0,boss.cooldownUntil-now):0};
}
/** Freeze the participating team at the exact moment the fight starts.
 * Three ready heroes auto-start; one or two require an explicit start request. */
const qualifiedRoster=(ready,team,heroByUid)=>{
 const members=bossTeam(team).members;
 const uids=new Set(members.map(m=>m.uid));
 return ready.filter(uid=>uids.has(uid)).map(uid=>{
  const levels=dogHero(heroByUid[uid]).levels;
  // Old over-leveled equipment must not bypass the first boss.
  return {uid,weaponLevel:Math.min(1,levels.weapon),armorLevel:Math.min(1,levels.armor),
   skillPower:Math.min(5,levels.attack_power),skillDestruction:Math.min(5,levels.destruction),
   skillDefense:Math.min(5,levels.vitality),skillGuard:Math.min(5,levels.blocking)};
 });
};
const startEncounter=(progress,team,ready,heroByUid,now,rand=randomInt)=>{
 if(!ready.length||ready.length>3)throw Error('DOG_BOSS10_NOT_READY');
 const roster=qualifiedRoster(ready,team,heroByUid);
 if(roster.length!==ready.length)throw Error('DOG_BOSS10_NOT_READY');
 const forecast=boss10DamagePotential(roster,[]);
 const miniGames=dogCreateMiniGames(10,rand,{exchange:'individual'});
 const hp=dogGroupBossHp(10);
 const chancePercent=roster.length===1?0:roster.length===2?
  (roster.every(fullyPrepared)?2:0):
  Math.max(5,Math.min(95,Math.round(40+75*(forecast/hp-0.85))));
 return {...progress,boss10:{...boss10State(progress.boss10),
  ready:[...ready],phase:'fighting',roster,startedAt:now,
  endsAt:now+(miniGames.version>=12?DOG_FINAL5_DURATION_MS:DOG_BOSS10_DURATION_MS),
  chancePercent,reactions:[],miniGames},updatedAt:now};
};
export function boss10Ready(progressRaw,teamRaw,uid,heroByUid={},now=Date.now(),rand=randomInt){
 const team=bossTeam(teamRaw),progress=dogGateProgress(progressRaw);
 if(!team.members.some(m=>m.uid===uid))throw Error('NOT_DOG_TEAM_MEMBER');
 if(progress.sharedBosses.includes(10))throw Error('DOG_BOSS10_ALREADY_WON');
 if(!eligible(progress.people[uid]))throw Error('DOG_BOSS10_PREREQUISITES');
 let boss=boss10State(progress.boss10);
 if(boss.phase==='fighting')throw Error('DOG_BOSS10_RUNNING');
 if(boss.phase==='victory')throw Error('DOG_BOSS10_ALREADY_WON');
 if(boss.phase==='cooldown'){
  if(now<boss.cooldownUntil&&!dogDeveloperCooldownBypass(progress,team,uid))throw Error('DOG_BOSS10_COOLDOWN');
  boss={...starter(),attempt:boss.attempt+1};
 }
 if(boss.ready.includes(uid))return progress;
 const ready=[...boss.ready,uid];
 const next={...progress,boss10:{...boss,ready},updatedAt:now};
 // Preserve the original "all three clicked ready" shortcut.
 if(team.members.length===3&&ready.length===3)
  return startEncounter(next,team,ready,heroByUid,now,rand);
 return next;
}
export function boss10Start(progressRaw,teamRaw,uid,heroByUid={},now=Date.now(),rand=randomInt){
 const team=bossTeam(teamRaw),progress=dogGateProgress(progressRaw);
 const boss=boss10State(progress.boss10);
 if(!team.members.some(m=>m.uid===uid))throw Error('NOT_DOG_TEAM_MEMBER');
 if(progress.sharedBosses.includes(10)||boss.phase==='victory')
  throw Error('DOG_BOSS10_ALREADY_WON');
 if(boss.phase==='fighting')throw Error('DOG_BOSS10_RUNNING');
 if(boss.phase==='cooldown')throw Error('DOG_BOSS10_COOLDOWN');
 if(!boss.ready.includes(uid)||!boss.ready.length)
  throw Error('DOG_BOSS10_NOT_READY');
 if(!boss.ready.every(id=>eligible(progress.people[id])))
  throw Error('DOG_BOSS10_PREREQUISITES');
 return startEncounter(progress,team,boss.ready,heroByUid,now,rand);
}
/** Base damage is driven by weapon strength and the two offensive skills;
 * armor/defensive skills determine how much damage the hero survives to deal.
 * One reaction per participating hero adds at most 10% to team damage. */
export function boss10DamagePotential(roster=[],reacted=[],miniGames=null){
 if(!roster.length||roster.length>3)return 0;
 const reacting=new Set(reacted);
 return roster.reduce((sum,m)=>{
  const attack=Math.min(1,(m.skillPower+m.skillDestruction)/10);
  const defense=Math.min(1,(m.skillDefense+m.skillGuard)/10);
  const armorBase=dogArmorBase(m.armorLevel)/dogArmorBase(1);
  const armorReadiness=Math.min(1,armorBase);
  const survival=(.8+.2*defense)*(.75+.25*armorReadiness);
  const reaction=miniGames?(1+dogMiniBonus(miniGames,m.uid))*(1-dogMiniDodgePenalty(miniGames,m.uid)):reacting.has(m.uid)?1.1:1;
  return sum+DOG_BOSS10_ATTACKS_PER_HERO*dogWeaponBase(m.weaponLevel)*
   (.67+.21*attack)*survival*reaction;
 },0)*(dogNormalizeMiniGames(miniGames)?.version>=3?
  (.94+.06*dogMiniTeamShield(miniGames,roster)/100):1);
}
const fullyPrepared=m=>m.weaponLevel>=1&&m.armorLevel>=1&&
 m.skillPower>=5&&m.skillDestruction>=5&&m.skillDefense>=5&&m.skillGuard>=5;
/** 30s damage, not a fixed party-count coin toss.
 * Rare last-chance blow is possible ONLY for two max-prepared heroes, both
 * reacting during the fight, and only in 2% of battles. Solo can never win. */
export function boss10ResolveCombat(roster,reactions=[],rand=randomInt,miniGames=null){
 if(!Array.isArray(roster)||roster.length<1||roster.length>3)
  throw Error('DOG_BOSS10_INVALID_ROSTER');
 const bossHp=dogGroupBossHp(10);
 const roll=rand(10000);
 if(!Number.isSafeInteger(roll)||roll<0||roll>=10000)
  throw Error('DOG_BOSS10_RANDOM_INVALID');
 const luckFactor=1.15-.25*(roll/10000);
 const reactionUids=roster.filter(m=>reactions.includes(m.uid)).map(m=>m.uid);
 let damage=boss10DamagePotential(roster,reactionUids,miniGames)*luckFactor;
 let rareCritical=false;
 const duoReady=miniGames?
  roster.every(m=>dogMiniStrongRoundCount(miniGames,m.uid)>=2):reactionUids.length===2;
 if(roster.length===2&&roster.every(fullyPrepared)&&duoReady){
  const bonusRoll=rand(10000);
  if(!Number.isSafeInteger(bonusRoll)||bonusRoll<0||bonusRoll>=10000)
   throw Error('DOG_BOSS10_RANDOM_INVALID');
  rareCritical=bonusRoll<DOG_BOSS10_RARE_TWO_HERO_CRITICAL_BP;
  if(rareCritical)damage*=1.5;
 }
 const dealt=Math.max(0,Math.round(damage));
 const win=roster.length>=2&&dealt>=bossHp;
 return {win,bossHp,damage:dealt,hpRemaining:Math.max(0,bossHp-dealt),
  participants:roster.length,rareCritical,roll,
  reactionCount:reactionUids.length};
}
export function boss10React(progressRaw,uid,now=Date.now()){
 const progress=dogGateProgress(progressRaw),boss=boss10State(progress.boss10);
 if(boss.phase!=='fighting'||now>=boss.endsAt||now<boss.startedAt)throw Error('DOG_BOSS10_NOT_RUNNING');
 if(!boss.roster.some(m=>m.uid===uid))throw Error('DOG_BOSS10_NOT_PARTICIPANT');
 if(boss.miniGames)throw Error('DOG_BOSS10_USE_MINIGAMES');
 if(boss.reactions.includes(uid))return progress;
 return {...progress,boss10:{...boss,reactions:[...boss.reactions,uid]},updatedAt:now};
}
/** Server validates each timed minigame action, including batched math.
 * Individual bonuses are private to each participating player. */
export function boss10MiniAnswer(progressRaw,uid,round,answer,now=Date.now(),step=0,tapAt=null,receivedAt=now){
 const progress=dogGateProgress(progressRaw),boss=boss10State(progress.boss10);
 if(boss.phase!=='fighting'||now>=boss.endsAt||now<boss.startedAt)
  throw Error('DOG_MINIGAME_NOT_RUNNING');
 const result=dogSubmitMiniAnswer(boss.miniGames,boss.roster,uid,round,answer,now,boss.startedAt,step,tapAt,receivedAt);
 return {progress:result.replayed?progress:{...progress,boss10:{...boss,miniGames:result.games},updatedAt:now},
  result:{type:'minigame',round,step,correct:result.correct,replayed:result.replayed,
   ...(Number.isInteger(result.correctCount)?{correctCount:result.correctCount}:{}),
   bonusPercent:Math.round(dogMiniBonus(result.games,uid)*1000)/10}};
}
export function boss10Finish(progressRaw,now=Date.now(),rand=randomInt){
 const progress=dogGateProgress(progressRaw),boss=boss10State(progress.boss10);
 if(boss.phase!=='fighting')throw Error('DOG_BOSS10_NOT_RUNNING');
 if(now<boss.endsAt)throw Error('DOG_BOSS10_STILL_FIGHTING');
 if(boss.roster.length<1||boss.roster.length>3)throw Error('DOG_BOSS10_INVALID_ROSTER');
 const combat=boss10ResolveCombat(boss.roster,boss.reactions,rand,boss.miniGames);
 const {win}=combat;
 const nextBoss={...boss,phase:win?'victory':'cooldown',
  cooldownUntil:win?0:boss.endsAt+DOG_BOSS10_COOLDOWN_MS,
  result:{...combat,chancePercent:boss.chancePercent}};
 const sharedBosses=win?[...new Set([...progress.sharedBosses,10])].sort((a,b)=>a-b):progress.sharedBosses;
 // Shared victory opens forge level 2 for the team. Advance only actual
 // participants' map markers without moving anyone backwards.
 const people={...progress.people};
 if(win)for(const member of boss.roster){
  const current=people[member.uid];
  if(current)people[member.uid]={...current,
   currentGate:Math.max(11,current.currentGate),
   highestGate:Math.max(11,current.highestGate??1,current.currentGate)};
 }
 return {progress:{...progress,people,boss10:nextBoss,sharedBosses,updatedAt:now},
  result:nextBoss.result};
}
const ERRORS={LOGIN_REQUIRED:401,INVALID_REQUEST_ID:400,
 DOG_BOSS10_NOT_READY:409,DOG_BOSS10_NOT_PARTICIPANT:403,DOG_BOSS10_INVALID_ROSTER:409,
 DOG_BOSS10_PREREQUISITES:409,DOG_BOSS10_ALREADY_WON:409,
 DOG_BOSS10_RUNNING:409,DOG_BOSS10_COOLDOWN:409,DOG_HERO_SELECTION_REQUIRED:409,
 DOG_BOSS10_NOT_RUNNING:409,DOG_BOSS10_STILL_FIGHTING:409,
 DOG_MINIGAME_MISSING:409,DOG_MINIGAME_NOT_RUNNING:409,
 DOG_MINIGAME_NOT_PARTICIPANT:403,DOG_MINIGAME_BAD_ROUND:400,
 DOG_MINIGAME_BAD_ANSWER:400,DOG_MINIGAME_BAD_STEP:400,
 DOG_MINIGAME_STEP_ORDER:409,DOG_MINIGAME_TOO_FAST:429,DOG_MINIGAME_TOO_LATE:409,
 DOG_BOSS10_USE_MINIGAMES:409,
 NOT_DOG_TEAM_MEMBER:403,DOG_BOSS10_RECEIPT_CONFLICT:409,DOG_BOSS10_RANDOM_INVALID:500};
export function installDogBoss10Api(app,{verifyProfile,getFirestore,rand=randomInt,clock=Date.now,botLogic=null}){
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
  if(!ERRORS[code])console.error('[dog-boss10] Unexpected error:',e);
  return res.status(ERRORS[code]||500).json({ok:false,error:ERRORS[code]?code:'DOG_BOSS10_UNAVAILABLE'});};
 const refs=()=>{const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
  return {db,teamRef:db.collection(DOG_BOSS_TEAM_COLLECTION).doc(DOG_BOSS_TEAM_ID),
   progressRef:db.collection(DOG_GATE_PROGRESS_COLLECTION).doc(DOG_GATE_PROGRESS_ID)};};
 app.get('/api/dog/gates/boss10',auth,async(req,res)=>{
  try{
   const {db,teamRef,progressRef}=refs(),uid=req.dogBoss10Uid;
   const [teamSnap,progressSnap]=await Promise.all([teamRef.get(),progressRef.get()]);
   const team=teamSnap.exists?teamSnap.data():null;
   let progress=progressSnap.exists?progressSnap.data():null;
   if(!bossTeam(team).members.some(m=>m.uid===uid))
    throw Error('NOT_DOG_TEAM_MEMBER');
   const tick=botLogic?.advanceLiveBotFight(10,progress,team,uid,clock(),rand);
   if(tick?.changed){
    progress=await db.runTransaction(async tx=>{
     const snapshot=await tx.get(progressRef);
     const latest=botLogic.advanceLiveBotFight(10,snapshot.exists?snapshot.data():null,
      team,uid,clock(),rand);
     if(latest.changed)tx.set(progressRef,latest.progress);
     return latest.progress;
    });
   }
   const existing=boss10State(dogGateProgress(progress).boss10);
   // Reconcile only after the 30-second deadline. If all three browsers
   // disconnected, opening this view settles the missed result atomically.
   // A transaction re-reads the authoritative state before any write, so
   // concurrent reconnects can never roll or award the shared victory twice.
   if(existing.phase==='fighting'&&existing.endsAt>0&&clock()>=existing.endsAt){
    progress=await db.runTransaction(async tx=>{
     const currentSnap=await tx.get(progressRef);
     const current=currentSnap.exists?currentSnap.data():null;
     const battle=boss10State(dogGateProgress(current).boss10);
     if(battle.phase!=='fighting'||battle.endsAt===0||clock()<battle.endsAt)
      return current;
     const updated=boss10Finish(current,clock(),rand).progress;
     tx.set(progressRef,updated);
     return updated;
    });
   }
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...boss10View(team,progress,uid,clock())});
  }catch(e){return fail(res,e);}
 });
 for(const command of ['ready','start','react','minigame','finish']){
  app.post('/api/dog/gates/boss10/'+command,auth,async(req,res)=>{
   try{
    const {requestId,round,answer:choice,step=0,tapAt=null}=obj(req.body);
     const receivedAt=clock();
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
      const prior=receipt.data();
      if(prior.command!==command||
         (command==='minigame'&&(prior.round!==round||JSON.stringify(prior.answer)!==JSON.stringify(choice)||
       (prior.step??0)!==step||
        (prior.tapAt??null)!==tapAt)))
       throw Error('DOG_BOSS10_RECEIPT_CONFLICT');
      return {view:boss10View(team,progress,uid,clock()),result:receipt.data().result,replayed:true};
     }
     const now=clock();
     let next,result,unchanged=false;
     if((command==='ready'||command==='start')&&bossTeam(team).heroLocks?.[uid]!==true)
      throw Error('DOG_HERO_SELECTION_REQUIRED');
     if(command==='ready'&&botLogic?.isLiveBotTeam(team,uid)){
      const snap=await tx.get(db.collection(DOG_HERO_COLLECTION).doc(uid));
      next=botLogic.readyWithLiveBots(10,progress,team,uid,
       snap.exists?snap.data():null,now,rand);
      result={type:'ready',started:boss10State(next.boss10).phase==='fighting',
       botsReady:2};
     }else if(command==='ready'||command==='start'){
      const heroes={},roster=bossTeam(team).members;
      const state=boss10State(dogGateProgress(progress).boss10);
      // The first two Ready clicks merely register readiness. Freeze gear
      // at the actual start instead of reading all three profiles for
      // every click. This saves six reads per full three-player attempt.
      const autoStart=command==='ready'&&roster.length===3&&
       state.phase==='waiting'&&state.ready.length===2&&!state.ready.includes(uid);
      if(command==='start'||autoStart){
       const needed=command==='start'?
        roster.filter(member=>state.ready.includes(member.uid)):roster;
       const snapshots=await Promise.all(needed.map(m=>tx.get(
        db.collection(DOG_HERO_COLLECTION).doc(m.uid))));
       needed.forEach((m,i)=>{heroes[m.uid]=snapshots[i].exists?snapshots[i].data():null;});
      }
      next=command==='ready'?
       boss10Ready(progress,team,uid,heroes,now,rand):
       boss10Start(progress,team,uid,heroes,now,rand);
      unchanged=command==='ready'&&state.phase==='waiting'&&state.ready.includes(uid);
      result={type:command,started:boss10State(next.boss10).phase==='fighting'};
     }else if(command==='react'){
      next=boss10React(progress,uid,now);
      result={type:'reaction',accepted:true};
     }else if(command==='minigame'){
      const solved=boss10MiniAnswer(progress,uid,round,choice,now,step,tapAt,receivedAt);
      next=solved.progress;result=solved.result;
      unchanged=solved.result.replayed===true;
     }else{
      next=boss10Finish(progress,now,rand).progress;
      result={type:'finish',...boss10State(next.boss10).result};
     }
     // A second Ready or already-scored answer still gets an exact replay
     // receipt, but does not rewrite the shared progress document.
     if(!unchanged)tx.set(progressRef,next);
     tx.create(receiptRef,{uid,command,requestId,
      ...(command==='minigame'?{round,answer:choice,step,tapAt}:{}),
      createdAt:now,result});
     return {view:boss10View(team,next,uid,now),result,replayed:false};
    });
    res.set('Cache-Control','no-store');return res.json({ok:true,...answer});
   }catch(e){return fail(res,e);}
  });
 }
}
