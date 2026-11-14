/** Coalesce simultaneous display-only wallet GETs on the Render server.
 * No TTL and no retained wallet snapshots: purchases, payouts and claims must
 * always use fresh Firestore transaction reads, never this helper.
 */
export function createDealWalletReadCoordinator({collection='deal_or_no_deal_wallets_v1',maxPending=512}={}){
 const pending=new Map();
 const counters={reads:0,sharedReads:0,errors:0};
 async function read(db,uid){
  if(typeof uid!=='string'||!uid)throw Error('INVALID_WALLET_UID');
  const existing=pending.get(uid);
  if(existing){counters.sharedReads++;return existing;}
  counters.reads++;
  // A new Firestore GET for every non-overlapping request. Only *in flight*
  // promises can be reused; there is no stale personal-balance time window.
  const task=Promise.resolve().then(()=>db.collection(collection).doc(uid).get());
  const tracked=pending.size<maxPending;
  if(tracked)pending.set(uid,task);
  try{return await task;}
  catch(e){counters.errors++;throw e;}
  finally{if(tracked&&pending.get(uid)===task)pending.delete(uid);}
 }
 function stats(){return {...counters,pending:pending.size,ttlMs:0};}
 return {read,stats};
}
