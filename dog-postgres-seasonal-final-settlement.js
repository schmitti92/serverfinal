/**
 * P4 PREPARATION ONLY: combined Firestore settlement for a trusted
 * Postgres-persisted, FINAL Christmas DOG move.
 *
 * DO NOT call from the live hub. There is currently no production
 * Postgres Christmas game reducer, pending-job producer, migration, or
 * connected scheduler. Legacy DOG action transactions remain authoritative.
 *
 * The *single* match receipt is an atomic gate for:
 *  - every eligible human player's XP and match statistics
 *  - all earned village lights and gifts, plus matchesCompleted exactly once
 *  - all earned scratch vouchers, grouped by personal wallet
 *
 * No winner is revealed from a PG room until its Firebase receipt is
 * committed. The later PG acknowledgement is idempotent.
 */
import {createHash} from 'node:crypto';
import {
 DOG_PLAYER_STATS_COLLECTION,dogCompletedPlayerStats
} from './dog/player-stats.js';
import {DOG_RESEARCH_COLLECTION,dogResearchLevel} from './dog/christmas-research.js';
import {
 DOG_VILLAGE_COLLECTION,DOG_GLOBAL_VILLAGE_ID,
 dogAcademyXpPercent,creditDogVillage
} from './dog/christmas-village.js';
import {
 DOG_SCRATCH_COLLECTION,DOG_SCRATCH_TIERS,grantDogScratchVoucher
} from './dog/christmas-scratch.js';
import {DOG_PG_MATCH_RECEIPTS_COLLECTION} from './dog-postgres-xp-settlement.js';
import {DOG_PG_CHRISTMAS_RECEIPTS_COLLECTION} from './dog-postgres-christmas-settlement.js';

const ROOM=/^(?:[0-9]{3}|[A-HJ-NP-Z2-9]{6})$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMAND=/^[-a-zA-Z0-9_:]{8,90}$/;
const isNatural=n=>Number.isSafeInteger(n)&&n>=0;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=code=>{const error=new Error(code);error.code=code;throw error};

export function dogPostgresSeasonalFinalProof(record,roomCode,matchId){
 const before=record?.before,after=record?.room;
 const prior=before?.match,now=after?.match;
 const old=prior?.christmas,newEvent=now?.christmas;
 if(!before||!after||before.code!==roomCode||after.code!==roomCode||
    before.phase!=='playing'||after.phase!=='playing'||
    prior?.id!==matchId||now?.id!==matchId||
    prior?.game!=='dog'||now?.game!=='dog'||
    prior?.dogChristmasEligibilityChecked!==true||
    now?.dogChristmasEligibilityChecked!==true||
    old?.enabled!==true||newEvent?.enabled!==true||
    prior?.dog?.phase==='finished'||now?.dog?.phase!=='finished'||
    prior?.dogCounters?.recorded===true||now?.dogCounters?.recorded===true||
    !isNatural(prior?.dog?.revision)||!isNatural(now?.dog?.revision)||
    now.dog.revision<=prior.dog.revision||
    !same(prior.dogRoster,now.dogRoster)||
    !same(prior.members,now.members)||
    !same(before.players,after.players)||
    !same(prior.dogResearchSkills,now.dogResearchSkills)||
    !same(old.levels,newEvent.levels)||
    old.innCredited===true||newEvent.innCredited!==true)
  fail('DOG_PG_SEASONAL_FINAL_UNSAFE_MATCH');

 if(!isNatural(record?.finishedAt)||record.finishedAt<1||
    !COMMAND.test(String(record?.actionId||'')))
  fail('DOG_PG_SEASONAL_FINAL_INVALID_RECORD');

 const roster=now.dogRoster;
 const seats=now.dogCounters?.seats;
 if(!Array.isArray(roster)||roster.length!==4||
    !Array.isArray(seats)||seats.length!==4)
  fail('DOG_PG_SEASONAL_FINAL_BAD_ROSTER');
 const active=roster.filter(p=>p&&!p.bot&&!p.inactive);
 const seenUid=new Set(),seenSeat=new Set();
 if(active.length<1||active.length>4)
  fail('DOG_PG_SEASONAL_FINAL_BAD_ROSTER');
 for(const p of roster){
  if(!p||!Number.isInteger(p.seat)||p.seat<0||p.seat>3||
     seenSeat.has(p.seat))
   fail('DOG_PG_SEASONAL_FINAL_BAD_ROSTER');
  seenSeat.add(p.seat);
  if(p.bot||p.inactive)continue;
  if(typeof p.uid!=='string'||!p.uid||seenUid.has(p.uid)||
     !after.players?.some(x=>x.uid===p.uid)||
     !now.members?.some(x=>x.uid===p.uid))
   fail('DOG_PG_SEASONAL_FINAL_BAD_ROSTER');
  seenUid.add(p.uid);
 }
 for(const counter of seats){
  if(!isNatural(counter?.knockedOut)||!isNatural(counter?.wasKnockedOut))
   fail('DOG_PG_SEASONAL_FINAL_BAD_COUNTER');
 }
 if(!same(prior.dogCounters?.seats,seats) &&
    // The last move can legitimately knock out opponents, but the
    // recorded totals may never decrease.
    seats.some((counter,i)=>
     counter.knockedOut<(prior.dogCounters?.seats?.[i]?.knockedOut??0)||
     counter.wasKnockedOut<(prior.dogCounters?.seats?.[i]?.wasKnockedOut??0)))
  fail('DOG_PG_SEASONAL_FINAL_BAD_COUNTER');
 const mode=now.dog.mode;
 const winner=now.dog.winner;
 if(!['solo3','teams4'].includes(mode)||
    mode!==prior.dog.mode||
    (mode==='solo3'&&(active.length!==3||
      roster.filter(p=>p.inactive).length!==1||
      !active.some(p=>p.seat===winner)))||
    (mode==='teams4'&&![0,1].includes(winner)))
  fail('DOG_PG_SEASONAL_FINAL_BAD_WINNER');

 const keys=['earnedTenths','giftCount','bonusGiftCount','scratchCount'];
 const delta={};
 for(const key of keys){
  if(!isNatural(old[key])||!isNatural(newEvent[key])||
     newEvent[key]<old[key])
   fail('DOG_PG_SEASONAL_FINAL_BAD_REWARD');
  delta[key]=newEvent[key]-old[key];
 }
 const minimumInn=Math.max(0,
  Math.min(4,Number.isInteger(newEvent.levels?.inn)?newEvent.levels.inn-1:0))*10;
 if(delta.earnedTenths<minimumInn||
    delta.earnedTenths>10000||
    delta.giftCount>64||delta.bonusGiftCount>64||
    delta.scratchCount>64||
    delta.bonusGiftCount>delta.giftCount||
    (delta.earnedTenths>minimumInn&&delta.giftCount===0))
  fail('DOG_PG_SEASONAL_FINAL_BAD_REWARD');

 const awards=record.vouchers;
 if(!Array.isArray(awards)||awards.length!==delta.scratchCount)
  fail('DOG_PG_SEASONAL_FINAL_BAD_VOUCHERS');
 const vouchers=awards.map(entry=>{
  if(!entry||typeof entry.uid!=='string'||!seenUid.has(entry.uid)||
     typeof entry.tier!=='string'||
     !Object.hasOwn(DOG_SCRATCH_TIERS,entry.tier))
   fail('DOG_PG_SEASONAL_FINAL_BAD_VOUCHERS');
  return {uid:entry.uid,tier:entry.tier};
 }).sort((a,b)=>a.uid.localeCompare(b.uid)||a.tier.localeCompare(b.tier));

 const players=active.map(p=>({
  uid:p.uid,seat:p.seat,name:String(p.name||'Spieler').slice(0,48),
  knockedOut:seats[p.seat].knockedOut,
  wasKnockedOut:seats[p.seat].wasKnockedOut
 })).sort((a,b)=>a.seat-b.seat);
 const payload={
  roomCode,matchId,actionId:record.actionId,
  finishedAt:record.finishedAt,mode,winner,
  academyLevel:newEvent.levels?.academy,
  players,
  counters:{seats:seats.map(x=>({
   knockedOut:x.knockedOut,wasKnockedOut:x.wasKnockedOut
  }))},
  rewards:{
   earnedTenths:delta.earnedTenths,giftCount:delta.giftCount,
   bonusGiftCount:delta.bonusGiftCount,vouchers
  }
 };
 const fingerprint=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 return {payload,fingerprint};
}

/**
 * loadPendingSeasonalFinal({roomCode,matchId}) returns a trusted, previously
 * SQL-committed {before,room,finishedAt,actionId,vouchers}.
 * markComplete must verify the identical digest in the PG row and publish
 * the already-paid terminal snapshot with one outbox commit.
 */
export function createDogPostgresSeasonalFinalBridge({
 getFirestore,loadPendingSeasonalFinal,markComplete,clock=Date.now
}={}){
 if(typeof getFirestore!=='function'||
    typeof loadPendingSeasonalFinal!=='function'||
    typeof markComplete!=='function'||typeof clock!=='function')
  throw new TypeError('A trusted PG seasonal final provider and Firestore are required');
 async function settle({roomCode,matchId}={}){
  if(!ROOM.test(String(roomCode||''))||!UUID.test(String(matchId||'')))
   fail('DOG_PG_SEASONAL_FINAL_INVALID_ID');
  const record=await loadPendingSeasonalFinal({roomCode,matchId});
  if(!record)fail('DOG_PG_SEASONAL_FINAL_NOT_PENDING');
  const {payload,fingerprint}=dogPostgresSeasonalFinalProof(record,roomCode,matchId);
  const store=getFirestore();
  if(!store||typeof store.collection!=='function'||
     typeof store.runTransaction!=='function')
   fail('DOG_PG_SEASONAL_FINAL_FIRESTORE_UNAVAILABLE');

  const receiptRef=store.collection(DOG_PG_MATCH_RECEIPTS_COLLECTION).doc(matchId);
  const moveReceiptRef=store.collection(DOG_PG_CHRISTMAS_RECEIPTS_COLLECTION)
   .doc(matchId+'_'+payload.actionId);
  const villageRef=store.collection(DOG_VILLAGE_COLLECTION).doc(DOG_GLOBAL_VILLAGE_ID);
  const statRefs=payload.players.map(p=>
   store.collection(DOG_PLAYER_STATS_COLLECTION).doc(p.uid));
  const researchRefs=payload.players.map(p=>
   store.collection(DOG_RESEARCH_COLLECTION).doc(p.uid));
  const walletUids=[...new Set(payload.rewards.vouchers.map(v=>v.uid))];
  const walletRefs=walletUids.map(uid=>
   store.collection(DOG_SCRATCH_COLLECTION).doc(uid));

  const result=await store.runTransaction(async tx=>{
   // Check receipts FIRST. Neither this route nor a normal Christmas
   // reward route may pay the same terminal action separately.
   const [receipt,moveReceipt]=await Promise.all([
    tx.get(receiptRef),tx.get(moveReceiptRef)
   ]);
   if(receipt.exists){
    const stored=receipt.data();
    if(stored?.fingerprint!==fingerprint||
       stored?.roomCode!==roomCode||stored?.matchId!==matchId||
       stored?.kind!=='seasonal-final')
     fail('DOG_PG_SEASONAL_FINAL_RECEIPT_CONFLICT');
    return {replayed:true,players:payload.players.length};
   }
   if(moveReceipt.exists)fail('DOG_PG_SEASONAL_FINAL_PARTIAL_PAYOUT');

   // Firestore requires all reads before ANY write. One transaction
   // protects the whole village and all real-player payouts.
   const [priorStats,research,villageSnap,walletSnaps]=await Promise.all([
    Promise.all(statRefs.map(ref=>tx.get(ref))),
    Promise.all(researchRefs.map(ref=>tx.get(ref))),
    tx.get(villageRef),
    Promise.all(walletRefs.map(ref=>tx.get(ref)))
   ]);
   const xp=payload.players.map((player,i)=>{
    const previous=priorStats[i].exists?priorStats[i].data():null;
    if(previous?.lastMatchId===matchId||previous?.xpLastMatchId===matchId)
     fail('DOG_PG_SEASONAL_FINAL_LEGACY_OVERLAP');
    const learned=research[i].exists?research[i].data():null;
    return dogCompletedPlayerStats(previous,player.uid,player.name,
      player.seat,payload.counters,payload.winner,matchId,payload.finishedAt,
      dogAcademyXpPercent(payload.academyLevel),
      {xpPercent:10*dogResearchLevel(learned,'xp'),
       winPercent:30*dogResearchLevel(learned,'win_xp')},payload.mode);
   });
   const village=creditDogVillage(
    villageSnap.exists?villageSnap.data():null,DOG_GLOBAL_VILLAGE_ID,
    null,payload.rewards.earnedTenths,payload.rewards.giftCount,
    payload.rewards.bonusGiftCount,true
   );
   const wallets=walletUids.map((uid,i)=>{
    let wallet=walletSnaps[i].exists?walletSnaps[i].data():null;
    for(const ticket of payload.rewards.vouchers.filter(v=>v.uid===uid))
     wallet=grantDogScratchVoucher(wallet,ticket.tier);
    return wallet;
   });
   for(let i=0;i<statRefs.length;i++)tx.set(statRefs[i],xp[i]);
   for(let i=0;i<walletRefs.length;i++)tx.set(walletRefs[i],wallets[i]);
   tx.set(villageRef,village);
   tx.set(receiptRef,{
    schemaVersion:2,kind:'seasonal-final',
    roomCode,matchId,fingerprint,finishedAt:payload.finishedAt,
    settledAt:clock(),playerCount:payload.players.length,
    earnedTenths:payload.rewards.earnedTenths,
    gifts:payload.rewards.giftCount,
    bonusGifts:payload.rewards.bonusGiftCount,
    vouchers:payload.rewards.vouchers.length
   });
   return {replayed:false,players:payload.players.length};
  });
  // Failure after this point leaves the immutable PG job pending.
  // Repeating the job reuses the receipt, never a second XP/light grant.
  await markComplete({roomCode,matchId,fingerprint});
  return {settled:true,replayed:result.replayed,
   players:result.players,
   vouchers:payload.rewards.vouchers.length,
   creditedTenths:payload.rewards.earnedTenths};
 }
 return {settle};
}
