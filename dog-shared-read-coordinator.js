/** Share only in-flight Firestore document GETs between DOG 100-Tore read-only pages.
 * No TTL, persisted snapshots or auth decisions. Boss fights, purchases and
 * reward payouts must continue to use fresh Firestore transactions.
 */
export function createDogSharedReadCoordinator({maxPendingPerDatabase=128}={}){
 const byDatabase=new WeakMap();
 const counters={documentReads:0,sharedReads:0,errors:0};
 async function read(db,ref){
  const path=ref?.path||ref?.key;
  if(!db||typeof db!=='object'||typeof path!=='string'||!path||typeof ref.get!=='function'){
   counters.documentReads++;
   return ref.get();
  }
  let pending=byDatabase.get(db);
  if(!pending){pending=new Map();byDatabase.set(db,pending);}
  const existing=pending.get(path);
  if(existing){counters.sharedReads++;return existing;}
  counters.documentReads++;
  // Defer the underlying call one microtask so simultaneous HTTP handlers can
  // join the same request. Drop the promise immediately when it settles.
  const task=Promise.resolve().then(()=>ref.get());
  const tracked=pending.size<maxPendingPerDatabase;
  if(tracked)pending.set(path,task);
  try{return await task;}
  catch(error){counters.errors++;throw error;}
  finally{if(tracked&&pending.get(path)===task)pending.delete(path);}
 }
 const stats=()=>({...counters,ttlMs:0});
 return {read,stats};
}
