/** Two server-controlled participants in the REAL 100-Tore team.
 * All human inventory, hero stats, map progression and rewards remain the
 * real account's Firestore records. No fake accounts, no fake prize credits.
 * The single pilot owner must first authenticate using a Render-held secret.
 */
import {randomInt,timingSafeEqual} from 'node:crypto';
import {bossJoin,bossTeam,DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID} from './dog-boss.js';
import {dogGateProgress,dogGateMapView,DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID} from './dog-gates.js';
import {boss10Ready,boss10State,boss10MiniAnswer,boss10Finish} from './dog-boss10.js';
import {groupBossReady,groupBossState,groupBossMiniAnswer,groupBossFinish} from './dog-group-boss.js';
import {dogMiniTargetIndex,dogMiniReactionPosition} from './dog-boss-minigames.js';

export const DOG_LIVE_BOT_IDS=Object.freeze(['dog-live-bot-nova','dog-live-bot-titan']);
export const DOG_LIVE_PILOT_COLLECTION='dog_live_pilot_owner_v1';
export const DOG_LIVE_PILOT_ID='100-gates-owner';
const botNames=Object.freeze(['🤖 Nova (Testspieler)','🤖 Titan (Testspieler)']);
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const own=Object.hasOwn;
const cleanName=x=>String(x||'Held').replace(/[<>\r\n\t]/g,'').trim().slice(0,32)||'Held';
const safeUid=x=>typeof x==='string'&&x.length>0&&x.length<=200;
const normal=g=>Number.isSafeInteger(g)&&g>=1&&g<=99&&g%10!==0&&g%10!==5;
const empty=()=>({currentGate:1,highestGate:1,normals:[],minis:[],
 miniRewards:[],lastAttemptAt:0,lastResult:null});

export function isLiveBotTeam(teamRaw,ownerUid){
 const team=bossTeam(teamRaw),set=new Set(team.members.map(m=>m.uid));
 return safeUid(ownerUid)&&team.members.length===3&&
  set.has(ownerUid)&&DOG_LIVE_BOT_IDS.every(id=>set.has(id));
}
export function addLiveBots(teamRaw,progressRaw,uid,name,now=Date.now()){
 if(!safeUid(uid)||DOG_LIVE_BOT_IDS.includes(uid))throw Error('DOG_BOTS_LOGIN_REQUIRED');
 const previous=bossTeam(teamRaw),progress=dogGateProgress(progressRaw);
 const realMembers=previous.members.filter(m=>!DOG_LIVE_BOT_IDS.includes(m.uid));
 if(realMembers.some(m=>m.uid!==uid))throw Error('DOG_BOTS_OTHER_PLAYERS_IN_TEAM');
 let team=previous;
 if(!team.members.some(m=>m.uid===uid))team=bossJoin(team,uid,name,null,now);
 for(const [i,id] of DOG_LIVE_BOT_IDS.entries()){
  if(!team.members.some(m=>m.uid===id))team=bossJoin(team,id,botNames[i],null,now);
 }
 if(!isLiveBotTeam(team,uid))throw Error('DOG_BOTS_TEAM_INVALID');
 // Always retain the REAL owner as the first of three people. Normalization
 // intentionally caps personal progress at three entries; omitting the owner
 // would silently discard their gate wins after the next round-trip.
 if(Object.keys(progress.people).some(id=>id!==uid&&!DOG_LIVE_BOT_IDS.includes(id)))
  throw Error('DOG_BOTS_OTHER_PLAYERS_IN_PROGRESS');
 const prior=progress.people[uid]||empty();
 const people={[uid]:prior};
 for(const id of DOG_LIVE_BOT_IDS){
  const old=progress.people[id]||empty();
  people[id]={...old,currentGate:Math.max(old.currentGate,prior.currentGate),
   highestGate:Math.max(old.highestGate,prior.highestGate),
   normals:[...new Set([...old.normals,...prior.normals])].sort((a,b)=>a-b),
   minis:[...new Set([...old.minis,...prior.minis])].sort((a,b)=>a-b)};
 }
 return {team,progress:{...progress,people,updatedAt:now}};
}
export function mirrorLiveBotVictory(progressRaw,teamRaw,uid,gate,now=Date.now()){
 const progress=dogGateProgress(progressRaw);
 if(!isLiveBotTeam(teamRaw,uid)||!normal(gate))return progress;
 const people={...progress.people};
 for(const id of DOG_LIVE_BOT_IDS){
  const old=people[id]||empty();
  const normals=old.normals.includes(gate)?old.normals:
   [...old.normals,gate].sort((a,b)=>a-b);
  people[id]={...old,normals,currentGate:Math.max(old.currentGate,gate+1),
   highestGate:Math.max(old.highestGate,gate+1),lastAttemptAt:now,lastResult:'win'};
 }
 return {...progress,people,updatedAt:now};
}
export function liveBotHero(gate,index){
 if(!Number.isSafeInteger(gate)||gate<10||gate>100||gate%10!==0)
  throw Error('DOG_BOTS_INVALID_GATE');
 const equipment=gate/10,cap=Math.min(50,equipment*5);
 const factor=index===0?.88:.76;
 const skill=Math.floor(cap*factor);
 return {levels:{weapon:equipment,armor:equipment,attack_power:skill,
  destruction:skill,vitality:skill,blocking:skill}};
}
const bossAt=(progress,gate)=>gate===10?boss10State(progress.boss10):
 groupBossState(gate,progress.groupBosses[gate]);
export function readyWithLiveBots(gate,progressRaw,teamRaw,uid,humanHero,now=Date.now(),rand=randomInt){
 const team=bossTeam(teamRaw),progress=dogGateProgress(progressRaw);
 if(!isLiveBotTeam(team,uid))throw Error('DOG_BOTS_NOT_OWNER');
 const heroes={[uid]:humanHero};
 for(const [i,id] of DOG_LIVE_BOT_IDS.entries())heroes[id]=liveBotHero(gate,i);
 let next=progress;
 for(const id of DOG_LIVE_BOT_IDS){
  next=gate===10?boss10Ready(next,team,id,heroes,now,rand):
   groupBossReady(gate,next,team,id,heroes,now,rand);
 }
 next=gate===10?boss10Ready(next,team,uid,heroes,now,rand):
  groupBossReady(gate,next,team,uid,heroes,now,rand);
 return next;
}
function botAnswer(round,shouldSucceed,elapsed,step=0){
 if(round.kind==='math'){
  const correct=round.puzzles?.[step]?.correctIndex??round.correctIndex;
  return shouldSucceed?correct:(correct+1)%3;
 }
 if(round.kind==='dodge'){
  const attack=round.attacks?.[step]||round;
  const safe=Array.from({length:round.lanes},(_,i)=>i)
   .find(i=>i!==attack.dangerIndex&&i!==attack.secondDangerIndex);
  return shouldSucceed?safe:attack.dangerIndex;
 }
 if(round.kind==='reaction')return shouldSucceed?1:0;
 const target=dogMiniTargetIndex(round,elapsed);
 return shouldSucceed?target:(target+1)%round.lanes;
}
function botTimeForStep(round,step){
 if(!round.maxSteps)return round.kind==='reaction'?round.targetMs:round.startMs+1800;
 if(round.kind==='dodge')return round.attacks[step].startMs+900;
 if(round.kind==='math')return round.startMs+620+step*880;
 if(round.kind==='target')return round.startMs+550+step*2000;
 // Three changing-speed reaction strikes: scan each ~2.66s interval for
 // a genuine server-verifiable green crossing, no secret timing bypass.
 const min=round.startMs+Math.floor(step*8000/3)+450;
 const max=round.startMs+Math.floor((step+1)*8000/3)-220;
 for(let at=min;at<max;at+=20)
  if(Math.abs(dogMiniReactionPosition(round,at)-.5)<=round.zoneRadius*.5)
   return at;
 return min;
}
/** Play bot input in one aggregate GET transaction rather than one Firestore
 * document write per simulated tap. Missed windows are reconstructed from
 * the original immutable server clock; each step is individually scored. */
export function advanceLiveBotFight(gate,progressRaw,teamRaw,uid,now=Date.now(),rand=randomInt){
 const progress=dogGateProgress(progressRaw);
 if(!isLiveBotTeam(teamRaw,uid))return {progress,changed:false};
 let next=progress,state=bossAt(progress,gate),changed=false;
 if(state.phase!=='fighting')return {progress,changed};
 for(const [index,id] of DOG_LIVE_BOT_IDS.entries()){
  for(const round of state.miniGames?.rounds||[]){
   // One server receipt per 10-target sprint, same rule as real players.
   if(round.kind==='target'&&Array.isArray(round.puzzles)){
    if(state.miniGames?.answers?.[id]?.[round.round]?.attempts?.length)continue;
    const at=round.endMs-80;
    if(now<state.startedAt+at)continue;
    const answers=round.puzzles.map((p,step)=>{
     const pass=(state.attempt*17+gate+index*31+round.round*23+step*13)%100<
      (index===0?82:68);
     return pass?p.correctIndex:(p.correctIndex+1)%p.options.length;
    });
    const result=gate===10?boss10MiniAnswer(next,id,round.round,answers,
      state.startedAt+at,0):
     groupBossMiniAnswer(gate,next,id,round.round,answers,state.startedAt+at,0);
    next=result.progress;changed=true;state=bossAt(next,gate);
    continue;
   }
   const limit=round.maxSteps||1;
   for(let step=0;step<limit;step++){
    const previous=state.miniGames?.answers?.[id]?.[round.round];
    if(round.maxSteps?previous?.attempts?.[step]:previous)continue;
    const elapsed=botTimeForStep(round,step);
    if(now<state.startedAt+elapsed)break;
    const pass=(state.attempt*17+gate+index*31+round.round*23+step*13)%100<
     (index===0?82:68);
    const answer=botAnswer(round,pass,elapsed,step);
    const at=state.startedAt+elapsed;
    const result=gate===10?boss10MiniAnswer(next,id,round.round,answer,at,step):
     groupBossMiniAnswer(gate,next,id,round.round,answer,at,step);
    next=result.progress;changed=true;state=bossAt(next,gate);
   }
  }
 }
 if(now>=state.endsAt){
  next=(gate===10?boss10Finish(next,now,rand):
   groupBossFinish(gate,next,now,rand)).progress;
  changed=true;
 }
 return {progress:next,changed};
}
export function advanceAllLiveBotFights(progressRaw,teamRaw,uid,now=Date.now(),rand=randomInt){
 let current=dogGateProgress(progressRaw),changed=false;
 if(!isLiveBotTeam(teamRaw,uid))return {progress:current,changed};
 for(let gate=10;gate<=100;gate+=10){
  const encounter=bossAt(current,gate);
  if(encounter.phase!=='fighting')continue;
  const next=advanceLiveBotFight(gate,current,teamRaw,uid,now,rand);
  current=next.progress;changed=changed||next.changed;
 }
 return {progress:current,changed};
}
const secretAllowed=value=>{
 const secret=String(process.env.DOG_100_GATES_PREVIEW_CODE||'');
 const given=String(value||'');
 return secret.length>=20&&secret.length===given.length&&
  timingSafeEqual(Buffer.from(secret),Buffer.from(given));
};
/** Auth gate + first-owner activation for the real expedition.
 * Keeps bots inaccessible to all other signed-in accounts while testing.
 */
export function installDogLivePilotApi(app,{verifyProfile,getFirestore,clock=Date.now}){
 let ownerCache=null,cachedAt=0;
 const refs=()=>{const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
  return {db,ownerRef:db.collection(DOG_LIVE_PILOT_COLLECTION).doc(DOG_LIVE_PILOT_ID),
   teamRef:db.collection(DOG_BOSS_TEAM_COLLECTION).doc(DOG_BOSS_TEAM_ID),
   progressRef:db.collection(DOG_GATE_PROGRESS_COLLECTION).doc(DOG_GATE_PROGRESS_ID)};
 };
 const identity=async req=>{
  const token=/^Bearer\s+([\w.\-]+)$/.exec(String(req.get('authorization')||''))?.[1];
  if(!token)throw Error('LOGIN_REQUIRED');
  const user=await verifyProfile(token);
  if(!safeUid(user?.uid))throw Error('LOGIN_REQUIRED');
  return {uid:user.uid,name:cleanName(user.name||user.displayName)};
 };
 const fail=(res,error)=>{
  const code=String(error?.message||'');
  return res.status(code==='LOGIN_REQUIRED'?401:
   code==='DOG_BOTS_TEAM_FULL'||code==='DOG_BOTS_OTHER_PLAYERS_IN_TEAM'||
   code==='DOG_BOTS_OTHER_PLAYERS_IN_PROGRESS'?409:
   code==='DOG_BOTS_RESERVED'?403:404)
   .json({ok:false,error:['DOG_BOTS_OTHER_PLAYERS_IN_TEAM','DOG_BOTS_OTHER_PLAYERS_IN_PROGRESS','DOG_BOTS_RESERVED',
    'LOGIN_REQUIRED'].includes(code)?code:'DOG_PILOT_UNAVAILABLE'});
 };
 app.post('/api/dog/live-bots/enable',async(req,res)=>{
  try{
   if(!secretAllowed(req.get('x-dog-preview-key')))
    return res.status(404).json({ok:false,error:'DOG_PILOT_UNAVAILABLE'});
   const {uid,name}=await identity(req),{db,ownerRef,teamRef,progressRef}=refs();
   const response=await db.runTransaction(async tx=>{
    const [owner,team,progress]=await Promise.all([
     tx.get(ownerRef),tx.get(teamRef),tx.get(progressRef)]);
    const registered=owner.exists?owner.data()?.uid:null;
    if(registered&&registered!==uid)throw Error('DOG_BOTS_RESERVED');
    const oldTeam=team.exists?team.data():null;
    const oldProgress=progress.exists?progress.data():null;
    const joined=addLiveBots(oldTeam,oldProgress,uid,name,clock());
    if(!registered)tx.create(ownerRef,{uid,createdAt:clock(),mode:'real-account-two-bots'});
    tx.set(teamRef,joined.team);tx.set(progressRef,joined.progress);
    return dogGateMapView(joined.team,joined.progress,uid);
   });
   ownerCache=uid;cachedAt=clock();
   res.set('Cache-Control','no-store');
   return res.json({ok:true,live:true,bots:2,...response});
  }catch(e){return fail(res,e);}
 });
 app.use('/api/dog/gates',async(req,res,next)=>{
  try{
   const {uid}=await identity(req);
   let owner=ownerCache;
   if(clock()-cachedAt>30_000||!owner){
    const {ownerRef}=refs(),doc=await ownerRef.get();
    owner=doc.exists?doc.data()?.uid:null;
    ownerCache=owner||null;cachedAt=clock();
   }
   if(!owner||owner!==uid)return res.status(404)
    .json({ok:false,error:'DOG_EVENT_NOT_PUBLIC'});
   next();
  }catch(e){return fail(res,e);}
 });
}
