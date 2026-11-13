/** Personal expedition map: secure team positions and solo gate attempts.
 * Each shared boss team's roster is the only allowed 3-player roster.
 * First mini-boss wins award loot atomically; DOG unlock and legacy boss stay separate.
 */
import {randomInt} from 'node:crypto';
import {DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID,bossJoin,bossTeam,bossSelectHero,dogHeroClass} from './dog-boss.js';
import {DOG_HERO_COLLECTION,dogHero} from './dog-forge.js';
import {dogNormalGateChance,dogResolveNormalGate,dogSimulateMiniBoss} from './dog-balance.js';
import {dogDrawMiniReward,dogMiniRewardDocument,DOG_MINI_REWARD_COLLECTIONS} from './dog-mini-rewards.js';
import {dogForgeCombatTier} from './dog-forge-progression.js';

export const DOG_GATE_PROGRESS_COLLECTION='dog_gate_progress_v1';
export const DOG_GATE_PROGRESS_ID='first-three-heroes';
export const DOG_GATE_RECEIPTS_COLLECTION='dog_gate_fight_receipts_v1';
export const DOG_GATE_COOLDOWN_MS=3000;

const obj=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const cleanName=value=>String(value||'Held').replace(/[<>\r\n\t]/g,'').trim().slice(0,32)||'Held';
const clamp=(n,min,max,fallback=min)=>Number.isSafeInteger(n)?Math.max(min,Math.min(max,n)):fallback;
const validUid=uid=>typeof uid==='string'&&uid.length>=1&&uid.length<=200;
const validGate=gate=>Number.isSafeInteger(gate)&&gate>=1&&gate<=99&&gate%10!==0;
const normal=gate=>validGate(gate)&&gate%10!==5;
const mini=gate=>validGate(gate)&&gate%10===5;
const positiveUnique=(numbers,pred)=>Array.isArray(numbers)?
 Array.from(new Set(numbers.filter(pred))).sort((a,b)=>a-b):[];
const previousNormal=gate=>{
 for(let previous=gate-1;previous>0;previous--)
  if(normal(previous))return previous;
 return null;
};

/** Saved only after server-authoritative fights. A selected gate never advances
 * another player's progress. Unknown/legacy data cannot fabricate wins. */
export function dogGateProgress(raw){
 const x=obj(raw),people=obj(x.people),result={};
 for(const [uid,value] of Object.entries(people).slice(0,3)){
  if(!validUid(uid))continue;
  const p=obj(value);
  const normals=positiveUnique(p.normals,normal);
  const minis=positiveUnique(p.minis,mini);
  const currentGate=clamp(p.currentGate,1,100,1);
  // A previous attempt at an older mini-boss can move the current marker
  // backwards, but can never erase the furthest earned gate.
  const furthestWin=Math.max(1,...normals.map(n=>n+1),...minis.map(n=>n+1));
  // Only signed-in owners receive their reward history via dogGateMapView.
  // Old progress documents without a history still normalize to an empty list.
  const miniRewards=Array.isArray(p.miniRewards)?p.miniRewards
   .filter(item=>mini(item?.gate)&&item?.reward?.granted===true&&
    ['chest','coins','cards','hammer','joker'].includes(item.reward.kind))
   .slice(-10).map(item=>{
    const prize=item.reward,kind=prize.kind;
    const reward={kind,granted:true};
    if(kind==='chest'){
     reward.tier=String(prize.tier||'wood').slice(0,20);
     reward.count=clamp(prize.count,1,20);
    }else if(kind==='coins')reward.amount=clamp(prize.amount,1,10_000_000);
    else if(kind==='cards')reward.packId=String(prize.packId||'small').slice(0,12);
    else if(kind==='hammer')reward.hammer=String(prize.hammer||'single').slice(0,12);
    else reward.quantity=1;
    return {gate:item.gate,reward,awardedAt:clamp(item.awardedAt,0,10_000_000_000_000,0)};
   }):[];
  result[uid]={
   currentGate,
   highestGate:Math.max(currentGate,clamp(p.highestGate,1,100,1),furthestWin),
   normals,minis,miniRewards,
   lastAttemptAt:clamp(p.lastAttemptAt,0,10_000_000_000_000,0),
   lastResult:p.lastResult==='win'?'win':p.lastResult==='loss'?'loss':null
  };
 }
 return {version:1,people:result,forgeLevel:clamp(x.forgeLevel,1,10,1),
  // Authenticated developer setting; kept in the single progress document.
  developerBossCooldownDisabledFor:validUid(x.developerBossCooldownDisabledFor)?
   x.developerBossCooldownDisabledFor:null,
  sharedBosses:positiveUnique(x.sharedBosses,
  gate=>Number.isSafeInteger(gate)&&gate>=10&&gate<=100&&gate%10===0),
  // Preserve the Tor-10 state and all later group-boss encounters across
  // personal fights, mini-boss rewards and shared boss transactions.
  ...(x.boss10?{boss10:obj(x.boss10)}:{}),
  groupBosses:Object.fromEntries(Array.from({length:9},(_,i)=>(i+2)*10)
   .filter(gate=>Object.hasOwn(obj(x.groupBosses),String(gate)))
   .map(gate=>[String(gate),obj(x.groupBosses[String(gate)])])),
  updatedAt:clamp(x.updatedAt,0,10_000_000_000_000,0)};
}
/** Bypass the 10-minute boss lock only for the privately authorized
 * three-seat pilot, never for a normal party of human players. */
export function dogDeveloperCooldownBypass(progressRaw,teamRaw,uid){
 const owner=dogGateProgress(progressRaw).developerBossCooldownDisabledFor;
 const members=bossTeam(teamRaw).members.map(m=>m.uid);
 const bots=['dog-live-bot-nova','dog-live-bot-titan'];
 return !!owner&&members.length===3&&members.includes(owner)&&
  bots.every(id=>members.includes(id))&&(uid===owner||bots.includes(uid));
}
// Only a real expired encounter requires settlement. Normal map polling
// has no additional Firestore reads or writes.
function expiredSharedBossGates(raw,now){
 const state=dogGateProgress(raw);
 const candidates=[[10,state.boss10],...Array.from({length:9},(_,i)=>{
  const gate=(i+2)*10;return [gate,state.groupBosses[gate]];
 })];
 return candidates.filter(([,fight])=>fight?.phase==='fighting'&&
  Number.isSafeInteger(fight.startedAt)&&fight.startedAt>0&&
  Number.isSafeInteger(fight.endsAt)&&fight.endsAt>fight.startedAt&&
  fight.endsAt<=now&&Array.isArray(fight.roster)&&
  fight.roster.length>=1&&fight.roster.length<=3).map(([gate])=>gate);
}
export function dogGateMapView(teamRaw,progressRaw,viewerUid){
 const team=bossTeam(teamRaw),progress=dogGateProgress(progressRaw);
 const isMember=team.members.some(m=>m.uid===viewerUid);
 // Only the participating heroes may read each other's names and gate
 // positions. Visitors can see free capacity, not private player data.
 const members=(isMember?team.members:[]).map((m,index)=>{
  const p=progress.people[m.uid];
  return {uid:m.uid,name:cleanName(m.name),heroClass:dogHeroClass(team.heroClasses?.[m.uid],['krieger','magierin','waechter'][index]),heroLocked:team.heroLocks?.[m.uid]===true,currentGate:p?.currentGate??1,
   highestGate:p?.highestGate??1,
   wonNormals:p?.normals.length??0,wonMinis:p?.minis.length??0,
   lastAttemptAt:p?.lastAttemptAt??0,lastResult:p?.lastResult??null,
   isMe:m.uid===viewerUid};
 });
 return {members,memberCount:team.members.length,teamReady:team.members.length===3,
  isMember,canJoin:!isMember&&team.members.length<3,
  sharedBosses:isMember?progress.sharedBosses:[],
  dogUnlocked:isMember&&progress.sharedBosses.includes(100), // trusted server wins only
  progress:isMember?(progress.people[viewerUid]||{currentGate:1,highestGate:1,normals:[],minis:[],
   lastAttemptAt:0,lastResult:null,miniRewards:[]}):{currentGate:1,highestGate:1,normals:[],minis:[],
   lastAttemptAt:0,lastResult:null,miniRewards:[]},
  availableBossGate:100, // real group-boss arenas now span every ten-gate milestone
  bossArenaIsTest:false,
  cacheSeconds:30};
}
export function dogGateFight(progressRaw,uid,gate,heroRaw,rand=randomInt,now=Date.now()){
 if(!validUid(uid))throw Error('LOGIN_REQUIRED');
 if(!validGate(gate))throw Error('DOG_GATE_INVALID');
 const state=dogGateProgress(progressRaw);
 const player=state.people[uid]||{currentGate:1,normals:[],minis:[],
  lastAttemptAt:0,lastResult:null,miniRewards:[]};
 const wins=mini(gate)?player.minis:player.normals;
 if(wins.includes(gate))throw Error('DOG_GATE_ALREADY_WON');
 // Each defeated group boss opens exactly the NEXT ten-gate chapter.
 // No gate 11–19 (including optional mini-boss 15) before Boss 10;
 // no gate 21–29 before Boss 20, and so on. Previously earned wins remain.
 const requiredBoss=gate>=11?Math.floor((gate-1)/10)*10:0;
 if(requiredBoss>=10&&!state.sharedBosses.includes(requiredBoss))
  throw Error('DOG_GATE_BOSS_REQUIRED');
 const needed=previousNormal(gate);
 if(needed!==null&&!player.normals.includes(needed))throw Error('DOG_GATE_PREVIOUS_REQUIRED');
 if(player.lastAttemptAt&&now-player.lastAttemptAt<DOG_GATE_COOLDOWN_MS)
  throw Error('DOG_GATE_COOLDOWN');
 const levels=dogHero(heroRaw).levels;
 const gear={weaponLevel:dogForgeCombatTier(levels.weapon),armorLevel:dogForgeCombatTier(levels.armor),
  skills:levels};
 const fight=mini(gate)?
  dogSimulateMiniBoss({gate,...gear,rand}):
  dogResolveNormalGate({gate,...gear},rand);
 const success=mini(gate)?fight.victory:fight.win;
 const nextGate=success?Math.min(100,gate+1):gate;
 const nextPlayer={currentGate:nextGate,
  highestGate:Math.max(player.highestGate??player.currentGate,success?nextGate:1),
  normals:normal(gate)&&success?[...player.normals,gate].sort((a,b)=>a-b):player.normals,
  minis:mini(gate)&&success?[...player.minis,gate].sort((a,b)=>a-b):player.minis,
  miniRewards:player.miniRewards||[],
  lastAttemptAt:now,lastResult:success?'win':'loss'};
 const next={...state,people:{...state.people,[uid]:nextPlayer},updatedAt:now};
 const result={gate,type:mini(gate)?'mini':'normal',win:success,
  ...(mini(gate)?{combat:fight,miniRewardPending:success}:{
   chancePercent:fight.chancePercent,roll:fight.roll,
   combatStats:(()=>{
    // Normal gates use a single server roll; HP/damage are an explanatory
    // deterministic combat summary, not a second win condition or RNG draw.
    const enemyMaxHp=100+gate*15;
    const heroMaxHp=100+Math.round((gear.armorLevel||1)*20);
    const heroDamage=success?enemyMaxHp:
     Math.min(enemyMaxHp-1,Math.max(1,Math.round(enemyMaxHp*
      (.20+.65*(fight.chancePercent/100)))));
    const enemyDamage=success?
     Math.round(heroMaxHp*(.12+.40*(fight.roll/10000))):
     heroMaxHp;
    return {enemyMaxHp,enemyRemainingHp:enemyMaxHp-heroDamage,
     enemyDamageTaken:heroDamage,heroMaxHp,
     heroRemainingHp:Math.max(0,heroMaxHp-enemyDamage),
     heroDamageTaken:enemyDamage,
     chancePercent:fight.chancePercent,
     weaponLevel:gear.weaponLevel,armorLevel:gear.armorLevel,
     model:'single-roll-summary-v1'};
   })()}),
  currentGate:nextPlayer.currentGate};
 return {progress:next,result};
}
const ERRORS={LOGIN_REQUIRED:401,DOG_GATE_INVALID:400,INVALID_REQUEST_ID:400,
 DOG_GATE_RECEIPT_CONFLICT:409,DOG_GATE_PREVIOUS_REQUIRED:409,
 DOG_GATE_ALREADY_WON:409,DOG_GATE_BOSS_REQUIRED:409,DOG_GATE_COOLDOWN:429,
 DOG_GATE_TEAM_FULL:409,NOT_DOG_TEAM_MEMBER:403,DOG_HERO_CLASS_INVALID:400,
 DOG_HERO_ALREADY_LOCKED:409,DOG_HERO_SELECTION_REQUIRED:409};
export function installDogGatesApi(app,{verifyProfile,getFirestore,rand=randomInt,clock=Date.now,botLogic=null}){
 const auth=async(req,res,next)=>{
  try{
   const match=/^Bearer\s+([\w.\-]+)$/.exec(String(req.get('authorization')||''));
   if(!match)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   const p=await verifyProfile(match[1]);
   if(!p?.uid)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   req.dogGateProfile={uid:p.uid,name:cleanName(p.name||p.displayName)};
   next();
  }catch{return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});}
 };
 const error=(res,e)=>{
  const reason=String(e?.message||'');
  return res.status(ERRORS[reason]||500).json({
   ok:false,error:ERRORS[reason]?reason:'DOG_GATE_UNAVAILABLE'});
 };
 const refs=()=>{
  const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
  return {db,teamRef:db.collection(DOG_BOSS_TEAM_COLLECTION).doc(DOG_BOSS_TEAM_ID),
   progressRef:db.collection(DOG_GATE_PROGRESS_COLLECTION).doc(DOG_GATE_PROGRESS_ID)};
 };
 app.get('/api/dog/gates/map',auth,async(req,res)=>{
  try{
   const {db,teamRef,progressRef}=refs();
   const [teamSnap,progressSnap]=await Promise.all([teamRef.get(),progressRef.get()]);
   const team=teamSnap.exists?teamSnap.data():null,uid=req.dogGateProfile.uid;
   let progress=progressSnap.exists?progressSnap.data():null;
   // The test teammates solve their challenges on the real shared fight,
   // including missed rounds after a reconnect or an inactive browser.
   const simulation=botLogic?.advanceAllLiveBotFights(progress,team,uid,clock(),rand);
   if(simulation?.changed){
    progress=await db.runTransaction(async tx=>{
     const fresh=await tx.get(progressRef);
     const step=botLogic.advanceAllLiveBotFights(fresh.exists?fresh.data():null,
      team,uid,clock(),rand);
     if(step.changed)tx.set(progressRef,step.progress);
     return step.progress;
    });
   }
   if(bossTeam(team).members.some(m=>m.uid===uid)&&
      expiredSharedBossGates(progress,clock()).length){
    // If every browser closed during the fight, returning to the map
    // must settle the server-owned outcome. Re-read under one Firestore
    // transaction so simultaneous reconnects cannot award or roll twice.
    const [{boss10Finish},{groupBossFinish}]=await Promise.all([
     import('./dog-boss10.js'),import('./dog-group-boss.js')]);
    progress=await db.runTransaction(async tx=>{
     const latest=await tx.get(progressRef);
     let current=latest.exists?latest.data():null;
     const due=expiredSharedBossGates(current,clock());
     if(!due.length)return current;
     for(const gate of due){
      current=gate===10?
       boss10Finish(current,clock(),rand).progress:
       groupBossFinish(gate,current,clock(),rand).progress;
     }
     tx.set(progressRef,current);
     return current;
    });
   }
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...dogGateMapView(team,progress,uid)});
  }catch(e){return error(res,e);}
 });
 app.post('/api/dog/gates/join',auth,async(req,res)=>{
  try{
   const {db,teamRef,progressRef}=refs(),{uid,name}=req.dogGateProfile;
   const value=await db.runTransaction(async tx=>{
    const [teamSnap,progressSnap]=await Promise.all([tx.get(teamRef),tx.get(progressRef)]);
    const team=bossTeam(teamSnap.exists?teamSnap.data():null);
    if(team.members.some(m=>m.uid===uid))
     return dogGateMapView(team,progressSnap.exists?progressSnap.data():null,uid);
    if(team.members.length>=3)throw Error('DOG_GATE_TEAM_FULL');
    const next=bossJoin(team,uid,name,null,clock());
    tx.set(teamRef,next);
    return dogGateMapView(next,progressSnap.exists?progressSnap.data():null,uid);
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...value});
  }catch(e){return error(res,e);}
 });
 // The shared team stores the visual hero class; battles still use server gear.
 app.post('/api/dog/gates/hero',auth,async(req,res)=>{
  try{
   const {teamRef,progressRef,db}=refs(),{uid,name}=req.dogGateProfile;
   const heroClass=req.body?.heroClass;
   const value=await db.runTransaction(async tx=>{
    const [teamSnap,progressSnap]=await Promise.all([tx.get(teamRef),tx.get(progressRef)]);
    const team=bossTeam(teamSnap.exists?teamSnap.data():null);
    // First selection enrolls an unjoined player, if the three-seat team has space.
    // Keep existing progress, bots, and inventory intact.
    const member=team.members.some(m=>m.uid===uid);
    if(!member&&team.members.length>=3)throw Error('DOG_GATE_TEAM_FULL');
    const joined=member?team:bossJoin(team,uid,name,null,clock());
    const updated=bossSelectHero(joined,uid,heroClass,clock());
    if(!member||team.heroLocks?.[uid]!==true)tx.set(teamRef,updated);
    return dogGateMapView(updated,progressSnap.exists?progressSnap.data():null,uid);
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...value});
  }catch(e){return error(res,e);}
 });
 app.post('/api/dog/gates/fight',auth,async(req,res)=>{
  try{
   const requestId=req.body?.requestId,gate=req.body?.gate;
   if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{12,90}$/.test(requestId))
    throw Error('INVALID_REQUEST_ID');
   if(!validGate(gate))throw Error('DOG_GATE_INVALID');
   const {db,teamRef,progressRef}=refs(),uid=req.dogGateProfile.uid;
   const heroRef=db.collection(DOG_HERO_COLLECTION).doc(uid);
   const receiptRef=db.collection(DOG_GATE_RECEIPTS_COLLECTION).doc(uid+'_'+requestId);
   const response=await db.runTransaction(async tx=>{
    const [receipt,team,progress,hero]=await Promise.all([
     tx.get(receiptRef),tx.get(teamRef),tx.get(progressRef),tx.get(heroRef)
    ]);
    const teamData=bossTeam(team.exists?team.data():null);
    if(!teamData.members.some(m=>m.uid===uid))throw Error('NOT_DOG_TEAM_MEMBER');
    const saved=dogGateProgress(progress.exists?progress.data():null);
    if(receipt.exists){
     const before=receipt.data();
     if(before.gate!==gate)throw Error('DOG_GATE_RECEIPT_CONFLICT');
     return {result:before.result,map:dogGateMapView(teamData,saved,uid),replayed:true};
    }
    if(teamData.heroLocks?.[uid]!==true)throw Error('DOG_HERO_SELECTION_REQUIRED');
    const now=clock();
    const outcome=dogGateFight(saved,uid,gate,hero.exists?hero.data():null,rand,now);
    let result=outcome.result;
    let nextProgress=outcome.progress;
    if(result.win&&result.type==='normal'&&botLogic?.isLiveBotTeam(teamData,uid))
     nextProgress=botLogic.mirrorLiveBotVictory(nextProgress,teamData,uid,gate,now);
    // A first mini-boss victory fixes ONE reward in this exact transaction.
    // All prize data is server-generated; the browser cannot request its type,
    // amount, or recipient. A lost response replays the same receipt.
    let prizeWrite=null;
    if(result.type==='mini'&&result.win){
     const highestGate=outcome.progress.people[uid].highestGate;
     const prize=dogDrawMiniReward(gate,highestGate,rand);
     const prizeRef=db.collection(DOG_MINI_REWARD_COLLECTIONS[prize.kind]).doc(uid);
     // Read before any writes, including the victory/receipt.
     const prizeSnap=await tx.get(prizeRef);
     const credit=dogMiniRewardDocument(prize,prizeSnap.exists?prizeSnap.data():null,now,rand);
     prizeWrite={ref:prizeRef,credit};
     result={...result,miniRewardPending:false,miniReward:{
      ...prize,granted:true}};
     const winner=nextProgress.people[uid];
     nextProgress={...nextProgress,people:{...nextProgress.people,
      [uid]:{...winner,miniRewards:[...(winner.miniRewards||[]),
       {gate,reward:result.miniReward,awardedAt:now}].slice(-10)}}};
    }
    const map=dogGateMapView(teamData,nextProgress,uid);
    // The victory, mini prize, private history and receipt share one commit.
    tx.set(progressRef,nextProgress);
    if(prizeWrite)tx.set(prizeWrite.ref,prizeWrite.credit.data,
     ...(prizeWrite.credit.merge?[{merge:true}]:[]));
    tx.create(receiptRef,{uid,gate,requestId,createdAt:now,result});
    return {result,map,replayed:false};
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...response});
  }catch(e){return error(res,e);}
 });
}
