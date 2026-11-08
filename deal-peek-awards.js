'use strict';
// Trusted internal API for awarding a Kofferblick Joker from an authoritative game event.
// DO NOT expose this as a public HTTP endpoint and do not accept localStorage snapshots.
// Each unique event ID can credit a given player at most once.
const EVENT_ID=/^[A-Za-z0-9_-]{12,90}$/;
const MAX_JOKERS=1000000;
export async function awardPeekJoker({db,uid,eventId,source='christmas-ice-v2'}) {
 if(!db||typeof db.runTransaction!=='function')throw Error('STORAGE_UNAVAILABLE');
 if(typeof uid!=='string'||!uid||uid.includes('/'))throw Error('INVALID_USER');
 if(typeof eventId!=='string'||!EVENT_ID.test(eventId))throw Error('INVALID_EVENT_ID');
 if(source!=='christmas-ice-v2')throw Error('INVALID_SOURCE');
 const inventory=db.collection('deal_peek_inventory_v1').doc(uid);
 const receipt=inventory.collection('awards').doc(eventId);
 return db.runTransaction(async tx=>{
  const [existing,inv]=await Promise.all([tx.get(receipt),tx.get(inventory)]);
  if(existing.exists){
   const previous=existing.data();
   if(previous.source!==source||previous.uid!==uid)throw Error('AWARD_CONFLICT');
   return {awarded:false,balance:Number(inv.data()?.balance)||0};
  }
  const balance=Number(inv.data()?.balance)||0;
  if(!Number.isSafeInteger(balance)||balance<0||balance>=MAX_JOKERS)throw Error('INVALID_BALANCE');
  tx.create(receipt,{uid,source,createdAt:Date.now()});
  tx.set(inventory,{balance:balance+1,updatedAt:Date.now()},{merge:true});
  return {awarded:true,balance:balance+1};
 });
}
