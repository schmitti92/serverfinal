/**
 * P4 PREPARATION ONLY: exactly-once Firestore Christmas move payouts after
 * a FUTURE trusted PostgreSQL event-reward command has been persisted.
 *
 * DO NOT connect this module to a live route yet. No durable PG seasonal
 * reducer, pending-reward row, winner settlement or worker exists. The
 * existing Firestore hub remains authoritative for Christmas gameplay.
 *
 * For non-final DOG turns, Firestore holds only real reward changes:
 *  - shared village money/gift counters
 *  - one personal voucher wallet per winning human
 *  - one immutable action receipt for atomic idempotency
 *
 * A combined XP+seasonal final-match payout is NOT implemented here; this
 * adapter refuses all finishing moves to prevent partial rewards.
 */
import {createHash} from 'node:crypto';
import {
 DOG_GLOBAL_VILLAGE_ID,DOG_VILLAGE_COLLECTION,creditDogVillage
} from './dog/christmas-village.js';
import {
 DOG_SCRATCH_COLLECTION,DOG_SCRATCH_TIERS,grantDogScratchVoucher
} from './dog/christmas-scratch.js';

export const DOG_PG_CHRISTMAS_RECEIPTS_COLLECTION='dog_pg_christmas_move_receipts_v1';

const CODE=/^(?:[0-9]{3}|[A-HJ-NP-Z2-9]{6})$/;
const MATCH_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION=/^[-a-zA-Z0-9_:]{8,90}$/;
const MAX_PER_ACTION=64;
const MAX_LIGHT_TENTHS_PER_ACTION=10000;
const fail=code=>{const error=new Error(code);error.code=code;throw error};
const isInt=n=>Number.isSafeInteger(n)&&n>=0;
const isSame=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

function verifyEvent(record,{roomCode,matchId,actionId}){
 if(!record||typeof record!=='object'||Array.isArray(record)||
    !isInt(record.recordedAt)||record.recordedAt===0||
    record.roomCode!==roomCode||record.matchId!==matchId||
    record.actionId!==actionId)
  fail('DOG_PG_CHRISTMAS_INVALID_RECORD');
 const before=record.before,after=record.after;
 const prev=before?.match,now=after?.match;
 const old=prev?.christmas,updated=now?.christmas;
 if(before?.code!==roomCode||after?.code!==roomCode||
    before?.phase!=='playing'||after?.phase!=='playing'||
    prev?.game!=='dog'||now?.game!=='dog'||
    prev?.id!==matchId||now?.id!==matchId||
    prev?.dogChristmasEligibilityChecked!==true||
    now?.dogChristmasEligibilityChecked!==true||
    old?.enabled!==true||updated?.enabled!==true||
    prev?.dog?.phase==='finished'||now?.dog?.phase==='finished'||
    prev?.dogCounters?.recorded===true||now?.dogCounters?.recorded===true||
    !isSame(prev?.dogRoster,now?.dogRoster)||
    !isSame(before.players,after.players)||
    !isSame(old.levels,updated.levels)||
    !isInt(prev?.dog?.revision)||!isInt(now?.dog?.revision)||
    now.dog.revision<=prev.dog.revision||
    old.innCredited===true||updated.innCredited===true)
  fail('DOG_PG_CHRISTMAS_UNSAFE_TURN');
 const metrics=['earnedTenths','giftCount','bonusGiftCount','scratchCount'];
 const delta={};
 for(const key of metrics){
  if(!isInt(old[key])||!isInt(updated[key])||updated[key]<old[key])
   fail('DOG_PG_CHRISTMAS_INVALID_DELTA');
  delta[key]=updated[key]-old[key];
 }
 if(delta.earnedTenths>MAX_LIGHT_TENTHS_PER_ACTION||
    delta.giftCount>MAX_PER_ACTION||delta.bonusGiftCount>MAX_PER_ACTION||
    delta.scratchCount>MAX_PER_ACTION||
    delta.bonusGiftCount>delta.giftCount||
    (delta.earnedTenths>0&&delta.giftCount===0))
  fail('DOG_PG_CHRISTMAS_INVALID_DELTA');

 const roster=now.dogRoster;
 if(!Array.isArray(roster)||roster.length!==4||
    !Array.isArray(after.players)||!Array.isArray(before.players))
  fail('DOG_PG_CHRISTMAS_INVALID_ROSTER');
 const realUsers=new Set();
 for(const player of roster){
  if(!player||!Number.isInteger(player.seat)||player.seat<0||player.seat>3)
   fail('DOG_PG_CHRISTMAS_INVALID_ROSTER');
  if(player.bot===true||player.inactive===true)continue;
  if(typeof player.uid!=='string'||!player.uid||
     realUsers.has(player.uid)||!after.players.some(p=>p.uid===player.uid))
   fail('DOG_PG_CHRISTMAS_INVALID_ROSTER');
  realUsers.add(player.uid);
 }
 const awards=record.vouchers;
 if(!Array.isArray(awards)||awards.length!==delta.scratchCount)
  fail('DOG_PG_CHRISTMAS_INVALID_VOUCHERS');
 const safeAwards=awards.map(entry=>{
  if(!entry||!realUsers.has(entry.uid)||
     typeof entry.tier!=='string'||!Object.hasOwn(DOG_SCRATCH_TIERS,entry.tier))
   fail('DOG_PG_CHRISTMAS_INVALID_VOUCHERS');
  return {uid:entry.uid,tier:entry.tier};
 }).sort((a,b)=>a.uid.localeCompare(b.uid)||a.tier.localeCompare(b.tier));

 // Never create a receipt for a zero-reward move. Those ordinary actions
 // belong entirely to Render's durable PG move stream.
 if(!delta.earnedTenths&&!delta.giftCount&&!delta.bonusGiftCount&&!safeAwards.length)
  fail('DOG_PG_CHRISTMAS_NO_PAYOUT');

 // Changes in the persistent match counters are authoritative; the client
 // never chooses the payout amount. The origin MUST be a stored server-side
 // PG action/reward outbox entry. This module cannot replace that producer.
 const summary={
  roomCode,matchId,actionId,recordedAt:record.recordedAt,
  fromDogRevision:prev.dog.revision,toDogRevision:now.dog.revision,
  giftCount:delta.giftCount,bonusGiftCount:delta.bonusGiftCount,
  earnedTenths:delta.earnedTenths,
  vouchers:safeAwards
 };
 const fingerprint=createHash('sha256')
  .update(JSON.stringify(summary)).digest('hex');
 return {summary,fingerprint,event:updated};
}

// Shared, pure proof for the future SQL staging transaction and the
// existing Firestore reward bridge. Both sides must fingerprint identical
// server-derived gifts, lights, vouchers and DOG revisions.
export function dogPostgresChristmasRewardProof(record,identity){
 return verifyEvent(record,identity);
}

/**
 * loadPendingReward only accepts {roomCode,matchId,actionId} and must read an
 * immutable, previously committed server-verified PG reward entry.
 *
 * markRewardComplete must atomically acknowledge the SAME fingerprint in
 * Postgres after the Firebase transaction. If the PG ACK fails, retry reads
 * the same Firestore receipt and does NOT pay again.
 */
export function createDogPostgresChristmasRewardBridge({
 getFirestore,loadPendingReward,markRewardComplete,clock=Date.now
}={}){
 if(typeof getFirestore!=='function'||
    typeof loadPendingReward!=='function'||
    typeof markRewardComplete!=='function'||
    typeof clock!=='function')
  throw new TypeError('Explicit Firestore and trusted PG reward callbacks required');

 async function settle({roomCode,matchId,actionId}={}){
  if(!CODE.test(String(roomCode||''))||
     !MATCH_UUID.test(String(matchId||''))||
     !ACTION.test(String(actionId||'')))
   fail('DOG_PG_CHRISTMAS_INVALID_ID');
  const job=await loadPendingReward({roomCode,matchId,actionId});
  if(!job)fail('DOG_PG_CHRISTMAS_NOT_PENDING');
  const {summary,fingerprint,event}=verifyEvent(job,{roomCode,matchId,actionId});
  const store=getFirestore();
  if(!store||typeof store.runTransaction!=='function'||typeof store.collection!=='function')
   fail('DOG_PG_CHRISTMAS_FIRESTORE_UNAVAILABLE');

  const receiptId=matchId+'_'+actionId;
  const receiptRef=store.collection(DOG_PG_CHRISTMAS_RECEIPTS_COLLECTION).doc(receiptId);
  const needVillage=summary.earnedTenths>0||summary.giftCount>0||summary.bonusGiftCount>0;
  const villageRef=needVillage?
   store.collection(DOG_VILLAGE_COLLECTION).doc(DOG_GLOBAL_VILLAGE_ID):null;
  const users=[...new Set(summary.vouchers.map(p=>p.uid))];
  const walletRefs=users.map(uid=>store.collection(DOG_SCRATCH_COLLECTION).doc(uid));

  const result=await store.runTransaction(async tx=>{
   // Single immutable receipt is the global serialization and replay gate.
   const receipt=await tx.get(receiptRef);
   if(receipt.exists){
    const stored=receipt.data();
    if(stored?.fingerprint!==fingerprint||
       stored?.roomCode!==roomCode||stored?.matchId!==matchId||
       stored?.actionId!==actionId)
      fail('DOG_PG_CHRISTMAS_RECEIPT_CONFLICT');
    return {replayed:true,wallets:users.length};
   }
   // Firestore requires all reads BEFORE the first write.
   const [villageSnap,walletSnaps]=await Promise.all([
    villageRef?tx.get(villageRef):Promise.resolve(null),
    Promise.all(walletRefs.map(ref=>tx.get(ref)))
   ]);
   const wallets=walletRefs.map((ref,i)=>{
    let raw=walletSnaps[i].exists?walletSnaps[i].data():null;
    for(const award of summary.vouchers.filter(p=>p.uid===users[i]))
     raw=grantDogScratchVoucher(raw,award.tier);
    return {ref,raw};
   });
   if(villageRef){
    const updatedVillage=creditDogVillage(
     villageSnap?.exists?villageSnap.data():null,
     DOG_GLOBAL_VILLAGE_ID,event,
     summary.earnedTenths,summary.giftCount,summary.bonusGiftCount,false
    );
    tx.set(villageRef,updatedVillage);
   }
   for(const wallet of wallets)tx.set(wallet.ref,wallet.raw);
   tx.set(receiptRef,{
    schemaVersion:1,roomCode,matchId,actionId,fingerprint,
    recordedAt:summary.recordedAt,settledAt:clock(),
    gifts:summary.giftCount,bonusGifts:summary.bonusGiftCount,
    earnedTenths:summary.earnedTenths,voucherCount:summary.vouchers.length
   });
   return {replayed:false,wallets:users.length};
  });
  await markRewardComplete({roomCode,matchId,actionId,fingerprint});
  return {settled:true,replayed:result.replayed,
   vouchers:summary.vouchers.length,creditedTenths:summary.earnedTenths};
 }
 return {settle};
}
