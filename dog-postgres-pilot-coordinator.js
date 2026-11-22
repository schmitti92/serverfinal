/**
 * P6 PILOT PREPARATION — a single authenticated DOG/PG move + fanout flow.
 *
 * NEVER register this instance on the public /api/hub/rooms or /hub WebSocket
 * route. It requires an EXPLICIT durable PG Pool and a separately provisioned
 * Firebase provider. The current live game remains 100% Firestore-backed.
 *
 * No implicit timers, background work, DB connections or Firebase SDK reads
 * during module import/construction. Every external entry verifies a genuine
 * Firebase profile; user IDs sent in browser JSON are never trusted.
 *
 * This is an internal server coordinator, NOT a full replacement for the
 * current lobby's expose() and room creation/upgrade endpoints.
 */
import {createDogPostgresRoomStore} from './dog-postgres-room-store.js';
import {
 reduceDogClassicInPostgresRoom,projectPostgresDogState
} from './dog-postgres-classic-adapter.js';
import {createDogPostgresFinalization} from './dog-postgres-finalization.js';
import {createDogPostgresXpSettlementBridge} from './dog-postgres-xp-settlement.js';
import {createDogPostgresChristmasRewardBridge} from './dog-postgres-christmas-settlement.js';
import {createDogPostgresSeasonalFinalBridge} from './dog-postgres-seasonal-final-settlement.js';
import {createDogPostgresSeasonalJournal} from './dog-postgres-seasonal-journal.js';
import {createDogPostgresPrivateFanout} from './dog-postgres-private-fanout.js';
import {createDogPostgresSettlementRecovery} from './dog-postgres-settlement-recovery.js';
import {createDogPostgresSeasonalRecovery} from './dog-postgres-seasonal-recovery.js';

const CODE=/^P[A-HJ-NP-Z2-9]{5}$/;
const MATCH=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION=/^[-a-zA-Z0-9_:]{8,90}$/;
const fail=code=>{const e=new Error(code);e.code=code;throw e};
const human=(p,uid)=>p?.uid===uid&&p.bot!==true&&p.inactive!==true;
const authorized=(room,uid)=>room?.phase==='playing'&&room.match?.game==='dog'&&
 room.players?.some(p=>p.uid===uid)&&
 room.match?.dogRoster?.some(p=>human(p,uid))&&
 room.match?.members?.some(p=>p.uid===uid);

export function createDogPostgresPilotCoordinator({
 pool,verifyProfile,getFirestore,clock=Date.now,
 eventActive=()=>true,project=projectPostgresDogState
}={}){
 if(!pool||typeof pool.query!=='function'||typeof pool.connect!=='function'||
    typeof verifyProfile!=='function'||typeof getFirestore!=='function'||
    typeof clock!=='function'||typeof project!=='function'||
    typeof eventActive!=='function')
  throw new TypeError('Explicit durable PG, Firebase authentication and payout provider required');

 const store=createDogPostgresRoomStore({pool,clock});
 const finals=createDogPostgresFinalization({pool,clock});
 const seasonal=createDogPostgresSeasonalJournal({pool,clock,eventActive});
 const xpBridge=createDogPostgresXpSettlementBridge({
  getFirestore,loadPendingMatch:finals.loadPendingMatch,
  markComplete:finals.markComplete,clock
 });
 const christmasBridge=createDogPostgresChristmasRewardBridge({
  getFirestore,loadPendingReward:seasonal.loadPendingReward,
  markRewardComplete:seasonal.markRewardComplete,clock
 });
 const finalBridge=createDogPostgresSeasonalFinalBridge({
  getFirestore,loadPendingSeasonalFinal:seasonal.loadPendingFinal,
  markComplete:seasonal.markFinalComplete,clock
 });
 const classicRecovery=createDogPostgresSettlementRecovery({
  pool,xpBridge,clock
 });
 const christmasRecovery=createDogPostgresSeasonalRecovery({
  pool,christmasBridge,finalBridge,clock
 });
 const fanout=createDogPostgresPrivateFanout({store,project});

 async function identity(token){
  if(typeof token!=='string'||token.length<1||token.length>12000)
   fail('DOG_PG_LOGIN_REQUIRED');
  let profile;
  try{profile=await verifyProfile(token);}
  catch(_e){fail('DOG_PG_LOGIN_REQUIRED');}
  if(typeof profile?.uid!=='string'||!profile.uid)
   fail('DOG_PG_LOGIN_REQUIRED');
  return {uid:profile.uid,name:String(profile.name||'').slice(0,48)};
 }
 function validCode(code){
  if(typeof code!=='string'||!CODE.test(code))
   fail('DOG_PG_PILOT_ONLY');
  return code;
 }
 async function currentRoom(code,uid){
  const result=await store.getRoom(validCode(code));
  if(!result?.room||!authorized(result.room,uid))
   fail('DOG_PG_ROOM_NOT_AVAILABLE');
  return result.room;
 }

 async function read({token,code}={}){
  const actor=await identity(token);
  const room=await currentRoom(code,actor.uid);
  return {room:project(room,actor.uid)};
 }

 async function move({
  token,code,matchId,actionId,expectedDogRevision,action
 }={}){
  const actor=await identity(token);
  const target=validCode(code);
  if(!MATCH.test(String(matchId||''))||
     !ACTION.test(String(actionId||''))||
     !Number.isSafeInteger(expectedDogRevision)||expectedDogRevision<0||
     !action||typeof action!=='object'||Array.isArray(action))
   fail('DOG_PG_PILOT_BAD_ACTION');

  // The FIRST read selects the correct PG reducer. It never reads Firebase.
  // Every actual move revalidates membership/revision inside the SQL row lock.
  const room=await currentRoom(target,actor.uid);
  if(room.match.id!==matchId)fail('DOG_PG_WRONG_MATCH');
  const request={
   code:target,matchId,uid:actor.uid,actionId,expectedDogRevision,
   action,
   authorize:async(current,{uid})=>{
    if(!authorized(current,uid))fail('DOG_PG_ROOM_NOT_AVAILABLE');
   }
  };
  let operation;
  let pendingKind=null;
  if(room.match.christmas?.enabled===true){
   operation=await seasonal.commitSeasonalMove(request);
   if(operation.pending)pendingKind=operation.finished?'seasonal-final':'seasonal-reward';
  }else{
   try{
    operation=await store.commitMove({
     ...request,reduce:reduceDogClassicInPostgresRoom
    });
   }catch(e){
    // A finishing classic DOG move has to pay XP BEFORE publishing the
    // terminal result. The first reducer may have computed the final move
    // and rolled back; stageFinalMove reruns rules under a NEW SQL row lock.
    // Revision checks prevent two separate finishing moves racing.
    if(e?.code!=='DOG_REWARD_SETTLEMENT_REQUIRED'&&
       e?.message!=='DOG_REWARD_SETTLEMENT_REQUIRED')throw e;
    operation=await finals.stageFinalMove(request);
    pendingKind='classic-final';
   }
  }
  if(pendingKind){
   // A payout bridge uses the IMMUTABLE stored PG job, never browser JSON.
   // On Firebase failure the SQL pending row freezes all further moves.
   // Do not report a successful move or emit a WebSocket event until paid.
   try{
    if(pendingKind==='seasonal-reward')
     await christmasBridge.settle({roomCode:target,matchId,actionId});
    else if(pendingKind==='seasonal-final')
     await finalBridge.settle({roomCode:target,matchId});
    else await xpBridge.settle({roomCode:target,matchId});
   }catch(_e){
    // A missing Firebase ACK and a corrupt payout are different recovery
    // cases, but neither can release an unconfirmed game to the browser.
    // The durable SQL job and quarantining recovery driver decide next.
    fail('DOG_PG_PAYOUT_PENDING');
   }
  }
  const confirmed=pendingKind?(await currentRoom(target,actor.uid)):
   operation.room;
  if(!confirmed||!authorized(confirmed,actor.uid))
   fail('DOG_PG_ROOM_NOT_AVAILABLE');
  return {
   room:project(confirmed,actor.uid),
   replayed:operation.replayed===true,
   // This boolean exposes NO reward amount or secret: only whether this
   // command was withheld until the durable payout receipt committed.
   settled:!!pendingKind
  };
 }

 async function subscribe({token,code,send}={}){
  const actor=await identity(token);
  if(typeof send!=='function')fail('DOG_PG_SOCKET_SEND_REQUIRED');
  // fanout.subscribe fetches a NEW authoritative Postgres room snapshot
  // and verifies membership again. It always projects separately per UID.
  return fanout.subscribe({
   code:validCode(code),identity:actor,send
  });
 }

 async function recoverOnce({classicLimit=8,seasonalLimit=8}={}){
  // No background loop. A reviewed service boot/scheduler must opt in.
  const [classic,christmas]=await Promise.all([
   classicRecovery.runOnce({limit:classicLimit}),
   christmasRecovery.runOnce({limit:seasonalLimit})
  ]);
  return {classic,christmas};
 }
 async function fanoutOnce({limit=64}={}){
  return fanout.pollOnce({limit});
 }
 function stats(){
  return {
   mode:'isolated-pg-pilot-not-connected-to-shared-hub',
   classic:classicRecovery.stats(),seasonal:christmasRecovery.stats(),
   streams:fanout.stats()
  };
 }
 return {read,move,subscribe,recoverOnce,fanoutOnce,stats};
}
