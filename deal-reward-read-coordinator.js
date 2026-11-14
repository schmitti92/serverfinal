/** Render-only concurrent reads for already-earned *public room* card rewards.
 * Only authenticated spectators' GET routes may call read(); all claims,
 * settlement and receipts remain authoritative Firestore transactions.
 *
 * No time-based cache: an in-flight request is shared only until completion.
 * invalidateAll() fences a locally committed game mutation so newer readers
 * never join a request started before that mutation.
 */
const REWARD_COLLECTIONS=Object.freeze([
 'deal_christmas_final_rewards_v1',
 'deal_christmas_banker_rewards_v1',
 'deal_christmas_cent_rewards_v1'
]);
const ALLOWED=new Set(REWARD_COLLECTIONS);
export function createDealRewardReadCoordinator({maxPending=256}={}){
 let inFlightByDatabase=new WeakMap();
 const stats={firestoreGets:0,sharedReads:0,errors:0,invalidations:0};
 const byCollection=Object.fromEntries(REWARD_COLLECTIONS.map(k=>[k,{firestoreGets:0,sharedReads:0}]));
 async function read(db,ref){
  const path=ref?.path||ref?.key||'';
  const collection=typeof path==='string'?path.split('/')[0]:'';
  if(!db||typeof db!=='object'||!ALLOWED.has(collection)||typeof ref?.get!=='function')
   throw Error('INVALID_REWARD_READ');
  let pending=inFlightByDatabase.get(db);
  if(!pending){pending=new Map();inFlightByDatabase.set(db,pending);}
  const existing=pending.get(path);
  if(existing){stats.sharedReads++;byCollection[collection].sharedReads++;return existing;}
  stats.firestoreGets++;byCollection[collection].firestoreGets++;
  const request=Promise.resolve().then(()=>ref.get());
  const tracked=pending.size<maxPending;
  if(tracked)pending.set(path,request);
  try{return await request;}
  catch(error){stats.errors++;throw error;}
  finally{if(tracked&&pending.get(path)===request)pending.delete(path);}
 }
 function invalidateAll(){
  // Any local deal game commit can introduce a reward receipt. New GETs
  // must never join a pre-commit Firestore read awaiting completion.
  inFlightByDatabase=new WeakMap();
  stats.invalidations++;
 }
 const snapshot=()=>({...stats,ttlMs:0,byCollection:structuredClone(byCollection)});
 return {read,invalidateAll,snapshot};
}
