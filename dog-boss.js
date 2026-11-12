/** The 100 Gates — first shared boss battle.
 * One persistent three-player team (not tied to ephemeral lobby rooms).
 * Server-authoritative battles, 10-minute team defeat lock and idempotent actions.
 * Later gates remain intentionally locked until their boss balance is implemented.
 */
import {randomInt} from 'node:crypto';
import {DOG_HERO_COLLECTION,dogHero} from './dog-forge.js';

export const DOG_BOSS_TEAM_COLLECTION='dog_boss_team_v1';
export const DOG_BOSS_RECEIPTS_COLLECTION='dog_boss_action_receipts_v1';
export const DOG_BOSS_TEAM_ID='first-three-heroes';
export const DOG_BOSS_COOLDOWN_MS=10*60*1000;
export const DOG_BOSS_MAX_MEMBERS=3;
export const DOG_BOSS_GATE=1;
export const DOG_BOSS_HP=6000;
export const DOG_REACTION_DURATION_MS=3000;
export const DOG_REACTION_TARGET_MS=1700;
export const DOG_REACTION_MAX_BONUS_PCT=10;
export const DOG_BOSS_PHASES=Object.freeze([
 {number:1,name:'Der erwachte Wächter',threshold:1,attack:'Steinhieb'},
 {number:2,name:'Die Glut erwacht',threshold:.5,attack:'Gluthieb'},
 {number:3,name:'Das letzte Inferno',threshold:.25,attack:'Infernoschlag'}
]);
export const bossPhaseOf=hp=>hp<=DOG_BOSS_HP*.25?3:hp<=DOG_BOSS_HP*.5?2:1;
const MAX_TIME=10_000_000_000_000;
const num=(v,lo,hi,defaultValue)=>Number.isSafeInteger(v)?Math.max(lo,Math.min(hi,v)):defaultValue;
const object=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const cleanName=x=>String(x||'Held').replace(/[<>\r\n\t]/g,'').trim().slice(0,32)||'Held';
const validUid=x=>typeof x==='string'&&x.length>=1&&x.length<=200;
const challengeData=(data,turn,attempt)=>{
 const out={};
 for(const [uid,v] of Object.entries(object(data))){
  if(!validUid(uid)||!Number.isSafeInteger(v?.startAt)||v.startAt<0||
    v.startAt>MAX_TIME||v?.turn!==turn||v?.attempt!==attempt)continue;
  out[uid]={turn,attempt,startAt:v.startAt,
   targetAt:v.startAt+DOG_REACTION_TARGET_MS,
   expiresAt:v.startAt+DOG_REACTION_DURATION_MS};
 }
 return out;
};
const bossStats=raw=>{
 const x=object(raw);
 return {actions:num(x.actions,0,1000000,0),
  damageDealt:num(x.damageDealt,0,1000000000,0),
  damageTaken:num(x.damageTaken,0,1000000000,0),
  defendedActions:num(x.defendedActions,0,1000000,0),
  flameHits:num(x.flameHits,0,1000000,0)};
};
const german=n=>Math.max(0,Number(n)||0).toLocaleString('de-DE');

/** Based on actual team damage and survivability, not guessed equipment levels.
 * Estimates assume an unchanged average damage per team action; no random
 * reward or prediction of the outcome is implied.
 */
export function bossDefeatAnalysis(raw){
 const state=object(raw);
 if(state.phase!=='cooldown')return null;
 const stats=bossStats(state.combatStats);
 const hp=Math.max(0,Math.min(DOG_BOSS_HP,Number(state.bossHp)||0));
 const dealt=DOG_BOSS_HP-hp;
 const percent=Math.round(dealt*100/DOG_BOSS_HP);
 const actions=Math.max(stats.actions,num(state.bossTurn,0,1000000,0));
 const average=actions?Math.round(dealt/actions):0;
 const more=average>0?Math.ceil(hp/average):null;
 const category=percent<60?'attack':percent>=85?'defense':'balanced';
 const title=category==='attack'?'⚔️ Eure Angriffskraft reicht noch nicht':
  category==='defense'?'🛡️ Eure Abwehr muss länger durchhalten':
  '⚒️ Mehr Angriffskraft und Widerstandskraft nötig';
 const summary='Ihr habt '+german(dealt)+' von '+german(DOG_BOSS_HP)+
  ' Boss-LP abgezogen ('+percent+' %). '+german(hp)+' LP blieben übrig.';
 const recommendation=category==='attack'?
  'Verbessert vor allem Waffen, Angriffskraft und Zerstörung in der Schmiede.':
  category==='defense'?
  'Ihr wart nahe am Sieg! Verbessert Rüstung, Vitalität und Widerstandskraft, damit ihr länger durchhaltet.':
  'Verbessert Waffen und Rüstung gemeinsam. Mehr Schaden und bessere Verteidigung bringen euch zum nächsten Tor.';
 return {category,title,summary,recommendation,
  bossDamage:dealt,bossRemaining:hp,bossProgressPct:percent,
  teamActions:actions,averageDamage:average,estimatedMoreActions:more,
  receivedDamage:stats.damageTaken,guardedActions:stats.defendedActions,
  flameHits:stats.flameHits};
}

export function bossMaxHp(heroRaw){
 const l=dogHero(heroRaw).levels;
 return Math.max(100,100+4*l.armor+3*l.vitality);
}
export const DOG_HERO_CLASSES=Object.freeze(['krieger','magierin','waechter']);
export const dogHeroClass=(value,fallback='krieger')=>DOG_HERO_CLASSES.includes(value)?value:fallback;
export function bossTeam(raw){
 const d=object(raw),members=Array.isArray(d.members)?
  d.members.slice(0,DOG_BOSS_MAX_MEMBERS).filter(x=>validUid(x?.uid))
   .map(x=>({uid:x.uid,name:cleanName(x.name)})):[];
 const heroClasses={},heroLocks={};
 for(const member of members){
  const value=d.heroClasses?.[member.uid];
  if(DOG_HERO_CLASSES.includes(value))heroClasses[member.uid]=value;
  // Older test choices were not final; require an explicit final confirmation.
  if(d.heroLocks?.[member.uid]===true&&DOG_HERO_CLASSES.includes(value))
   heroLocks[member.uid]=true;
 }
 const heroes={};
 for(const member of members){
  const h=object(d.heroes?.[member.uid]);
  const maxHp=num(h.maxHp,100,1500,100);
  heroes[member.uid]={hp:num(h.hp,0,maxHp,maxHp),maxHp,guard:h.guard===true};
 }
 const phase=['ready','fighting','cooldown','victory'].includes(d.phase)?d.phase:'ready';
 return {version:1,gate:DOG_BOSS_GATE,boss:'Der Aschewächter',
  phase,bossHp:num(d.bossHp,0,DOG_BOSS_HP,DOG_BOSS_HP),bossMaxHp:DOG_BOSS_HP,
  attempt:num(d.attempt,1,1_000_000,1),
  bossTurn:num(d.bossTurn,0,1_000_000,0),
  bossCharged:d.bossCharged===true&&phase==='fighting',
  reactionChallenges:challengeData(d.reactionChallenges,
   num(d.bossTurn,0,1_000_000,0),num(d.attempt,1,1_000_000,1)),
  combatStats:bossStats(d.combatStats),
  cooldownUntil:phase==='cooldown'?num(d.cooldownUntil,0,MAX_TIME,0):0,
  members,heroClasses,heroLocks,heroes,log:Array.isArray(d.log)?d.log.slice(0,10).filter(x=>typeof x==='string')
   .map(x=>x.slice(0,140)):[],updatedAt:num(d.updatedAt,0,MAX_TIME,0)};
}
export function bossView(raw,uid,now=Date.now()){
 const state=bossTeam(raw);
 const {reactionChallenges,...safeState}=state;
 const phaseNumber=bossPhaseOf(state.bossHp);
 const bossPhase=DOG_BOSS_PHASES[phaseNumber-1];
 return {...safeState,serverNow:now,cooldownMs:DOG_BOSS_COOLDOWN_MS,
  reactionChallenge:reactionChallenges[uid]||null,
  reactionRules:{durationMs:DOG_REACTION_DURATION_MS,targetMs:DOG_REACTION_TARGET_MS,
   maxBonusPct:DOG_REACTION_MAX_BONUS_PCT},
  defeatAnalysis:bossDefeatAnalysis(state),
  bossPhase:phaseNumber,bossPhaseName:bossPhase.name,
  bossAttackName:state.bossCharged?'🔥 Flammenexplosion':bossPhase.attack,
  bossTelegraph:state.bossCharged&&state.phase==='fighting'?
   '⚠️ Achtung: Eine Flammenexplosion trifft den nächsten handelnden Helden! Verteidigen reduziert den Schaden.':
   phaseNumber===3?'🔥 Das Inferno tobt! Der nächste Angriff könnte eine neue Explosion vorbereiten.':
   phaseNumber===2?'🔥 Der Wächter ist erwacht. Achte auf sein nächstes Flammenzeichen.':
   '⚔️ Der Wächter sammelt Glut. Bringe seinen Lebensbalken unter 50 %.' ,
  cooldownRemainingMs:state.phase==='cooldown'?Math.max(0,state.cooldownUntil-now):0,
  isMember:state.members.some(x=>x.uid===uid),
  canJoin:state.members.length<DOG_BOSS_MAX_MEMBERS,
  canFight:state.phase!=='cooldown'&&state.phase!=='victory'&&
   state.members.some(x=>x.uid===uid)&&state.heroes[uid]?.hp>0,
  canRestart:state.phase==='cooldown'&&now>=state.cooldownUntil&&
   state.members.some(x=>x.uid===uid)};
}
export function bossJoin(raw,uid,name,heroRaw,now=Date.now()){
 if(!validUid(uid))throw Error('LOGIN_REQUIRED');
 const state=bossTeam(raw);
 if(state.members.some(m=>m.uid===uid))return state;
 if(state.members.length>=DOG_BOSS_MAX_MEMBERS)throw Error('BOSS_TEAM_FULL');
 const maxHp=bossMaxHp(heroRaw);
 return {...state,members:[...state.members,{uid,name:cleanName(name)}],
  heroes:{...state.heroes,[uid]:{hp:maxHp,maxHp,guard:false}},
  log:[cleanName(name)+' ist der Heldengruppe beigetreten.',...state.log].slice(0,10),
  updatedAt:now};
}
/** Final cosmetic choice: each participant confirms once, independently.
 * The class never modifies weapons, skills, defense or boss hit points.
 * Repeated identical confirmations are idempotent, even across reconnects. */
export function bossSelectHero(raw,uid,heroClass,now=Date.now()){
 const team=bossTeam(raw);
 if(!team.members.some(m=>m.uid===uid))throw Error('NOT_DOG_TEAM_MEMBER');
 if(!DOG_HERO_CLASSES.includes(heroClass))throw Error('DOG_HERO_CLASS_INVALID');
 if(team.heroLocks[uid]===true){
  if(team.heroClasses[uid]===heroClass)return team;
  throw Error('DOG_HERO_ALREADY_LOCKED');
 }
 return {...team,
  heroClasses:{...team.heroClasses,[uid]:heroClass},
  heroLocks:{...team.heroLocks,[uid]:true},updatedAt:now};
}
export function bossRestart(raw,heroByUid,uid,now=Date.now()){
 const state=bossTeam(raw);
 if(!state.members.some(x=>x.uid===uid))throw Error('NOT_BOSS_MEMBER');
 if(state.phase!=='cooldown')throw Error('BOSS_NO_RESTART');
 if(now<state.cooldownUntil)throw Error('BOSS_COOLDOWN_ACTIVE');
 const heroes={};
 for(const member of state.members){
  const maxHp=bossMaxHp(heroByUid?.[member.uid]);
  heroes[member.uid]={hp:maxHp,maxHp,guard:false};
 }
 return {...state,heroes,phase:'ready',bossHp:DOG_BOSS_HP,bossTurn:0,bossCharged:false,
  combatStats:bossStats(null),reactionChallenges:{},
  attempt:state.attempt+1,cooldownUntil:0,
  log:['Versuch '+(state.attempt+1)+': Der Aschewächter ist zurück – volle Lebenspunkte.',
   ...state.log].slice(0,10),updatedAt:now};
}
/** Server-issued, one challenge per hero and boss turn. A repeated start
 * never extends the timing window. The next boss turn invalidates old tickets. */
export function bossReactionStart(raw,uid,now=Date.now()){
 const state=bossTeam(raw);
 if(!state.members.some(x=>x.uid===uid))throw Error('NOT_BOSS_MEMBER');
 if(state.phase==='cooldown')throw Error('BOSS_COOLDOWN_ACTIVE');
 if(state.phase==='victory')throw Error('BOSS_ALREADY_WON');
 if(!state.heroes[uid]||state.heroes[uid].hp<=0)throw Error('BOSS_HERO_DOWN');
 const existing=state.reactionChallenges[uid];
 if(existing)return {state,challenge:existing};
 const challenge={turn:state.bossTurn,attempt:state.attempt,startAt:now,
  targetAt:now+DOG_REACTION_TARGET_MS,
  expiresAt:now+DOG_REACTION_DURATION_MS};
 return {state:{...state,reactionChallenges:{...state.reactionChallenges,[uid]:challenge},
  updatedAt:now},challenge};
}
const MOVES=Object.freeze(['attack','power','guard','special','reaction']);
export function bossAction(raw,uid,heroRaw,move,randoms=[5000,5000,5000,5000],now=Date.now()){
 if(!MOVES.includes(move))throw Error('INVALID_BOSS_MOVE');
 const state=bossTeam(raw),member=state.members.find(x=>x.uid===uid);
 if(!member)throw Error('NOT_BOSS_MEMBER');
 if(state.phase==='cooldown')throw Error('BOSS_COOLDOWN_ACTIVE');
 if(state.phase==='victory')throw Error('BOSS_ALREADY_WON');
 const actor=state.heroes[uid];
 if(!actor||actor.hp<=0)throw Error('BOSS_HERO_DOWN');
 const challenge=move==='reaction'?state.reactionChallenges[uid]:null;
 if(move==='reaction'&&(!challenge||challenge.turn!==state.bossTurn||
   challenge.attempt!==state.attempt))throw Error('BOSS_REACTION_NOT_READY');
 // Timing is measured entirely by the server clock; the client sends no score.
 const timingDiff=challenge?Math.abs(now-challenge.targetAt):Infinity;
 const reactionBonusPct=move!=='reaction'?0:
  timingDiff<=300?10:timingDiff<=700?6:timingDiff<=1100?3:0;
 const reactionGrade=move!=='reaction'?null:
  reactionBonusPct===10?'perfekt':reactionBonusPct===6?'gut':
  reactionBonusPct===3?'knapp':'verpasst';
 const levels=dogHero(heroRaw).levels;
 const maxHp=bossMaxHp(heroRaw);
 const currentHp=Math.min(maxHp,actor.hp+(maxHp>actor.maxHp?maxHp-actor.maxHp:0));
 const roll=i=>num(randoms[i],0,9999,5000);
 const base=360+42*levels.weapon+9*levels.attack_power+5*levels.destruction;
 const hit=roll(0)<Math.min(4000,500+levels.precision*20);
 const critical=roll(1)<Math.min(4000,500+levels.critical*38);
 const doubleStrike=roll(2)<Math.min(3900,levels.double_strike*35);
 let damage=move==='guard'?Math.round(base*.28):
  move==='power'?Math.round(base*1.4):
  move==='special'?Math.round(base*(1.06+levels.attack_power*.005)):
  base;
 if(!hit&&move!=='guard')damage=Math.round(damage*.65);
 if(critical&&move!=='guard')damage=Math.round(damage*1.4);
 if(doubleStrike&&move!=='guard')damage=Math.round(damage*1.55);
 if(reactionBonusPct)damage=Math.round(damage*(100+reactionBonusPct)/100);
 damage=Math.max(1,Math.floor(damage));
 const bossHp=Math.max(0,state.bossHp-damage);
 const victory=bossHp===0;
 const beforePhase=bossPhaseOf(state.bossHp);
 const afterPhase=bossPhaseOf(bossHp);
 const bossTurn=state.bossTurn+1;
 const chargedAttack=state.bossCharged&&!victory;
 // Special attacks are advertised before the next action and only resolved by
 // the server. A defending player can cut most incoming explosion damage.
 // No extra network action or Firestore read is needed for the warning.
 let retaliation=victory?0:([0,24,35,46][beforePhase]+
  (chargedAttack?45:0)+Math.floor(roll(3)/1000)*2);
 retaliation=victory?0:Math.max(1,retaliation-2*levels.armor-Math.floor(levels.resilience*.5));
 if(actor.guard)retaliation=Math.max(1,Math.ceil(retaliation*.45));
 if(move==='guard')retaliation=Math.max(0,Math.ceil(retaliation*.22));
 const healing=Math.ceil(levels.regeneration*.4)+(move==='special'?Math.min(18,4+levels.vitality):0);
 const blocked=roll(1)<Math.min(3500,levels.blocking*32);
 const dodged=roll(2)<Math.min(3500,levels.evasion*30);
 if(blocked)retaliation=Math.ceil(retaliation*.6);
 if(dodged)retaliation=0;
 let hp=Math.max(0,Math.min(maxHp,currentHp+healing-retaliation));
 const survived=hp===0&&levels.last_stand>0&&roll(3)<Math.min(4500,levels.last_stand*40);
 if(survived)hp=1;
 const heroes={...state.heroes,
  [uid]:{hp,maxHp,guard:move==='guard'}};
 const allDown=state.members.length>0&&state.members.every(m=>heroes[m.uid]?.hp<=0);
 const phase=victory?'victory':allDown?'cooldown':'fighting';
 const cooldownUntil=phase==='cooldown'?now+DOG_BOSS_COOLDOWN_MS:0;
 // Thresholds announce phase changes immediately. Every third team action
 // while in phase 2/3 prepares another blast for the following player's move.
 const bossCharged=phase==='fighting'&&
  (afterPhase>beforePhase&&afterPhase>=2||
   afterPhase>=2&&bossTurn%3===0);
 const bossAttack=chargedAttack?'Flammenexplosion':
  DOG_BOSS_PHASES[beforePhase-1].attack;
 const combatStats={actions:state.combatStats.actions+1,
  damageDealt:state.combatStats.damageDealt+Math.min(state.bossHp,damage),
  damageTaken:state.combatStats.damageTaken+retaliation,
  defendedActions:state.combatStats.defendedActions+(move==='guard'?1:0),
  flameHits:state.combatStats.flameHits+(chargedAttack?1:0)};
 const lossReport=phase==='cooldown'?bossDefeatAnalysis({
  phase,bossHp,combatStats,bossTurn}):null;
 const log=[
  member.name+': '+(move==='guard'?'🛡️ Verteidigung':move==='power'?'🔥 Kraftschlag':
   move==='special'?'✨ Spezialangriff':move==='reaction'?'⚡ Reaktion':'⚔️ Angriff')+
   (move==='reaction'?' ('+reactionGrade+' · +'+reactionBonusPct+' %)':'')+
   ' – '+damage+' Schaden'+
   (retaliation?' · '+retaliation+' Gegenschaden':'')+'.',
  ...(chargedAttack?['🔥 Flammenexplosion! '+member.name+' erhält '+retaliation+' Gegenschaden.']:[]),
  ...(afterPhase>beforePhase&&!victory?
   ['🔥 Bossphase '+afterPhase+': '+DOG_BOSS_PHASES[afterPhase-1].name+'!']:[]),
  ...(bossCharged?['⚠️ Der Aschewächter lädt eine Flammenexplosion auf – Verteidigung empfohlen!']:[]),
  ...(victory?['🏆 Der Aschewächter wurde besiegt – Tor 1 geschafft!']:
    phase==='cooldown'?['💀 Alle Helden sind gefallen. 10 Minuten Pause – Tor 1 bleibt erhalten.',
     lossReport.title+' · '+lossReport.bossProgressPct+' % Boss-Schaden.']:[]),
  ...state.log].slice(0,10);
 return {state:{...state,heroes,bossHp,phase,cooldownUntil,log,updatedAt:now,
   bossTurn,bossCharged,combatStats,reactionChallenges:{}},
  result:{type:'combat',move,damage,retaliation,critical,doubleStrike,dodged,
   defeatAnalysis:lossReport,
   defeated:phase==='cooldown',victory,actorHp:hp,bossHp,bossAttack,chargedAttack,
   bossPhase:afterPhase,phaseChanged:afterPhase>beforePhase,
   reactionBonusPct,reactionGrade,
   nextAttackCharged:bossCharged}};
}
const ERRORS=Object.freeze({LOGIN_REQUIRED:401,INVALID_REQUEST_ID:400,
 INVALID_BOSS_MOVE:400,INVALID_BOSS_COMMAND:400,BOSS_TEAM_FULL:409,
 BOSS_STATE_STALE:409,BOSS_REACTION_NOT_READY:409,
 NOT_BOSS_MEMBER:403,BOSS_NO_RESTART:409,BOSS_COOLDOWN_ACTIVE:409,
 BOSS_ALREADY_WON:409,BOSS_HERO_DOWN:409,BOSS_RECEIPT_CONFLICT:409});
export function installDogBossApi(app,{verifyProfile,getFirestore,rand=randomInt,clock=Date.now}){
 const auth=async(req,res,next)=>{
  try{
   const match=/^Bearer\s+([\w.\-]+)$/.exec(String(req.get('authorization')||''));
   if(!match)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   const p=await verifyProfile(match[1]);
   if(!p?.uid)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   req.bossProfile={uid:p.uid,name:cleanName(p.name||p.displayName)};next();
  }catch{return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});}
 };
 const fail=(res,e)=>{
  const error=String(e?.message||'UNKNOWN');
  return res.status(ERRORS[error]||500).json({ok:false,error:ERRORS[error]?error:'BOSS_UNAVAILABLE'});
 };
 const refs=()=>{
  const db=getFirestore();
  if(!db)throw Error('STORAGE_UNAVAILABLE');
  return {db,teamRef:db.collection(DOG_BOSS_TEAM_COLLECTION).doc(DOG_BOSS_TEAM_ID)};
 };
 app.get('/api/dog/boss/me',auth,async(req,res)=>{
  try{
   const {teamRef}=refs();
   const snap=await teamRef.get();
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...bossView(snap.exists?snap.data():null,req.bossProfile.uid,clock())});
  }catch(e){return fail(res,e);}
 });
 const act=command=>[auth,async(req,res)=>{
  try{
   const id=req.body?.requestId;
   if(typeof id!=='string'||!/^[A-Za-z0-9_-]{12,90}$/.test(id))throw Error('INVALID_REQUEST_ID');
   if(command==='act'&&!MOVES.includes(req.body?.move))throw Error('INVALID_BOSS_MOVE');
   const uid=req.bossProfile.uid,{db,teamRef}=refs();
   const receiptRef=db.collection(DOG_BOSS_RECEIPTS_COLLECTION).doc(uid+'_'+id);
   const heroRef=db.collection(DOG_HERO_COLLECTION).doc(uid);
   const data=await db.runTransaction(async tx=>{
    const [receiptSnap,stateSnap]=await Promise.all([tx.get(receiptRef),tx.get(teamRef)]);
    const state=bossTeam(stateSnap.exists?stateSnap.data():null);
    if(receiptSnap.exists){
     const prior=receiptSnap.data();
     if(prior.command!==command||(command==='act'&&prior.move!==req.body.move)||
       (command==='act'&&prior.expectedTurn!==req.body.expectedTurn))
      throw Error('BOSS_RECEIPT_CONFLICT');
     return {team:state,result:prior.result,replayed:true};
    }
    let next,result;
    const now=clock();
    if(command==='reaction-start'){
     const created=bossReactionStart(state,uid,now);
     next=created.state;
     result={type:'reaction-start',...created.challenge};
    }else if(command==='join'){
     const h=await tx.get(heroRef);
     next=bossJoin(state,uid,req.bossProfile.name,h.exists?h.data():null,now);
     result={type:'join'};
    }else if(command==='restart'){
     if(!state.members.some(m=>m.uid===uid))throw Error('NOT_BOSS_MEMBER');
     if(state.phase!=='cooldown')throw Error('BOSS_NO_RESTART');
     if(now<state.cooldownUntil)throw Error('BOSS_COOLDOWN_ACTIVE');
     const profiles=await Promise.all(state.members.map(async m=>{
      const snap=await tx.get(db.collection(DOG_HERO_COLLECTION).doc(m.uid));
      return [m.uid,snap.exists?snap.data():null];
     }));
     next=bossRestart(state,Object.fromEntries(profiles),uid,now);
     result={type:'restart',attempt:next.attempt};
    }else{
     // A hero must see the current warning before triggering a boss retaliation.
     // Legacy clients lacking expectedTurn are accepted until all pages deploy.
     // A receipt replay bypasses this check above, never repeating a hit.
     if(req.body?.expectedTurn!==undefined&&
       (!Number.isSafeInteger(req.body.expectedTurn)||
        req.body.expectedTurn!==state.bossTurn))throw Error('BOSS_STATE_STALE');
     const h=await tx.get(heroRef);
     const rolls=[rand(10000),rand(10000),rand(10000),rand(10000)];
     const combat=bossAction(state,uid,h.exists?h.data():null,req.body.move,rolls,now);
     next=combat.state;result=combat.result;
    }
    tx.set(teamRef,next);
    tx.create(receiptRef,{uid,requestId:id,command,
     ...(command==='act'?{move:req.body.move,
       ...(req.body.expectedTurn===undefined?{}:{expectedTurn:req.body.expectedTurn})}:{}),
     result,createdAt:now});
    return {team:next,result,replayed:false};
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...bossView(data.team,uid,clock()),
    result:data.result,replayed:data.replayed});
  }catch(e){return fail(res,e);}
 }];
 app.post('/api/dog/boss/join',...act('join'));
 app.post('/api/dog/boss/reaction-start',...act('reaction-start'));
 app.post('/api/dog/boss/act',...act('act'));
 app.post('/api/dog/boss/restart',...act('restart'));
}
