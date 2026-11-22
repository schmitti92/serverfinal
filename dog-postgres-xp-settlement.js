/**
 * P4 PREPARATION ONLY — idempotent settlement of a trusted finished DOG match.
 *
 * The currently deployed hub still awards XP in its existing Firestore room
 * transaction. This adapter MUST NOT be used on those legacy matches. It is
 * intentionally not imported by server.js or shared-lobby.js.
 *
 * A future PG-finishing-move transaction must FIRST persist a complete,
 * immutable finished-match settlement as PENDING. loadPendingMatch() must read
 * that server-generated record, never a browser-supplied game state.
 *
 * A single Firestore transaction grants ALL human players' XP and stores
 * an immutable match receipt. If PG confirmation fails, retrying sees the
 * receipt and never awards the same match twice.
 *
 * Christmas gifts, scratch vouchers, village credits and final lobby
 * archival are NOT yet integrated. Active seasonal events are rejected.
 */
import {createHash} from 'node:crypto';
import {DOG_PLAYER_STATS_COLLECTION,dogCompletedPlayerStats} from './dog/player-stats.js';
import {DOG_RESEARCH_COLLECTION,dogResearchLevel} from './dog/christmas-research.js';

export const DOG_PG_MATCH_RECEIPTS_COLLECTION='dog_pg_match_settlements_v1';
const ROOM_CODE=/^(?:[0-9]{3}|[A-HJ-NP-Z2-9]{6})$/;
const MATCH_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=code=>{const error=new Error(code);error.code=code;throw error};

export function dogPostgresSettlementProof(record,roomCode,matchId){
 const room=record?.room;
 const match=room?.match;
 if(!room||room.code!==roomCode||room.phase!=='playing'||
    match?.id!==matchId||match.game!=='dog'||
    match.dog?.phase!=='finished'||match.dogChristmasEligibilityChecked!==true||
    match.christmas?.enabled===true||match.dogCounters?.recorded===true)
  fail('DOG_PG_SETTLEMENT_NOT_FINISHED');
 const finishedAt=record?.finishedAt;
 if(!Number.isSafeInteger(finishedAt)||finishedAt<1)
  fail('DOG_PG_SETTLEMENT_INVALID_TIME');
 if(!Array.isArray(match.dogRoster)||match.dogRoster.length!==4||
    !Array.isArray(match.dogCounters?.seats)||
    match.dogCounters.seats.length!==4)
  fail('DOG_PG_SETTLEMENT_INVALID_ROSTER');
 const mode=match.dog.mode;
 if(!['teams4','solo3'].includes(mode))fail('DOG_PG_SETTLEMENT_BAD_MODE');
 const roster=match.dogRoster;
 const humans=roster.filter(p=>p&&!p.bot&&!p.inactive);
 if(humans.length<1||humans.length>4||
    (mode==='solo3'&&(humans.length!==3||
      roster.filter(p=>p.inactive).length!==1)))
  fail('DOG_PG_SETTLEMENT_INVALID_ROSTER');
 const seen=new Set(),seats=new Set();
 for(const player of humans){
  if(typeof player.uid!=='string'||!player.uid||
     !Number.isInteger(player.seat)||player.seat<0||player.seat>3||
     seats.has(player.seat)||seen.has(player.uid)||
     !room.players?.some(p=>p.uid===player.uid)||
     !match.members?.some(p=>p.uid===player.uid))
    fail('DOG_PG_SETTLEMENT_INVALID_ROSTER');
  seen.add(player.uid);seats.add(player.seat);
 }
 const winner=match.dog.winner;
 if((mode==='solo3'&&!seats.has(winner))||
    (mode==='teams4'&&![0,1].includes(winner)))
  fail('DOG_PG_SETTLEMENT_INVALID_WINNER');
 for(const counter of match.dogCounters.seats){
  if(!counter||!Number.isSafeInteger(counter.knockedOut)||counter.knockedOut<0||
     !Number.isSafeInteger(counter.wasKnockedOut)||counter.wasKnockedOut<0)
    fail('DOG_PG_SETTLEMENT_INVALID_COUNTER');
 }
 const payload={
  roomCode,matchId,finishedAt,mode,winner,
  players:humans.map(p=>({
   uid:p.uid,seat:p.seat,name:String(p.name||'Spieler').slice(0,48),
   knockedOut:match.dogCounters.seats[p.seat].knockedOut,
   wasKnockedOut:match.dogCounters.seats[p.seat].wasKnockedOut
  })).sort((a,b)=>a.seat-b.seat),
  counters:{seats:match.dogCounters.seats.map(p=>({
   knockedOut:p.knockedOut,wasKnockedOut:p.wasKnockedOut
  })),recorded:false}
 };
 const fingerprint=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 return {payload,fingerprint};
}

/**
 * loadPendingMatch({roomCode,matchId}):
 *    reads immutable trusted PG pending settlement, returning
 *    {room,finishedAt}; never a client body.
 * markComplete({roomCode,matchId,fingerprint}):
 *    Postgres CAS: mark ONLY the identical pending settlement as paid.
 */
export function createDogPostgresXpSettlementBridge({
  getFirestore,loadPendingMatch,markComplete,clock=Date.now
}={}){
 if(typeof getFirestore!=='function'||typeof loadPendingMatch!=='function'||
    typeof markComplete!=='function'||typeof clock!=='function')
  throw new TypeError('A Firestore provider and trusted PG settlement callbacks are required');

 async function settle({roomCode,matchId}={}){
  if(!ROOM_CODE.test(String(roomCode||''))||
     !MATCH_UUID.test(String(matchId||'')))
    fail('DOG_PG_SETTLEMENT_INVALID_ID');
  // No Firebase GET if the job is already closed in Postgres; upstream
  // decides when to enqueue/retry still-PENDING jobs.
  const record=await loadPendingMatch({roomCode,matchId});
  if(!record)fail('DOG_PG_SETTLEMENT_NOT_PENDING');
  const {payload,fingerprint}=dogPostgresSettlementProof(record,roomCode,matchId);
  const store=getFirestore();
  if(!store||typeof store.runTransaction!=='function'||
     typeof store.collection!=='function')
    fail('DOG_PG_SETTLEMENT_FIRESTORE_UNAVAILABLE');
  const receiptRef=store.collection(DOG_PG_MATCH_RECEIPTS_COLLECTION).doc(matchId);
  const statRefs=payload.players.map(p=>store.collection(DOG_PLAYER_STATS_COLLECTION).doc(p.uid));
  const researchRefs=payload.players.map(p=>store.collection(DOG_RESEARCH_COLLECTION).doc(p.uid));

  // The unique match receipt is the serialization gate. Firestore retries
  // this complete transaction if any earlier read changes concurrently.
  const result=await store.runTransaction(async tx=>{
   const receipt=await tx.get(receiptRef);
   if(receipt.exists){
    const stored=receipt.data();
    if(stored?.fingerprint!==fingerprint||
       stored?.roomCode!==roomCode||stored?.matchId!==matchId)
      fail('DOG_PG_SETTLEMENT_RECEIPT_CONFLICT');
    return {replayed:true,players:payload.players.length};
   }
   // Firestore transactions require ALL reads before ANY write.
   const [priorStats,research]=await Promise.all([
    Promise.all(statRefs.map(ref=>tx.get(ref))),
    Promise.all(researchRefs.map(ref=>tx.get(ref)))
   ]);
   const awards=payload.players.map((player,i)=>{
    const prior=priorStats[i].exists?priorStats[i].data():null;
    // A match already settled by the legacy hub may not be migrated
    // again with a different receipt.
    if(prior?.lastMatchId===matchId||prior?.xpLastMatchId===matchId)
      fail('DOG_PG_SETTLEMENT_LEGACY_OVERLAP');
    const learned=research[i].exists?research[i].data():null;
    const computed=dogCompletedPlayerStats(prior,player.uid,player.name,
      player.seat,payload.counters,payload.winner,matchId,payload.finishedAt,
      0,{xpPercent:10*dogResearchLevel(learned,'xp'),
         winPercent:30*dogResearchLevel(learned,'win_xp')},payload.mode);
    return {ref:statRefs[i],stats:computed};
   });
   // One atomic commit: every human's DOG XP plus one immutable receipt.
   for(const item of awards)tx.set(item.ref,item.stats);
   tx.set(receiptRef,{
    matchId,roomCode,fingerprint,mode:payload.mode,
    playerCount:payload.players.length,finishedAt:payload.finishedAt,
    settledAt:clock(),schemaVersion:1
   });
   return {replayed:false,players:payload.players.length};
  });
  // This is NOT part of Firestore's transaction. If this PG acknowledgement
  // fails, the durable job stays pending; repeating settle() recognizes the
  // Firestore receipt and confirms PG without any duplicate credits.
  await markComplete({roomCode,matchId,fingerprint});
  return {settled:true,replayed:result.replayed,players:result.players};
 }
 return {settle};
}
