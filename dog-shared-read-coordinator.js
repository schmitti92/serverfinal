/**
 * Share authenticated DOG read-only document GETs across simultaneous requests
 * and very short revisits. All authorization happens BEFORE read(); cache keys
 * are Firestore document paths (UID for private documents), not client claims.
 *
 * Transactions, actions, purchase validation and grants NEVER use this cache.
 * Invalidate on successful DOG metadata mutations. All state is in Render RAM:
 * zero extra Firestore traffic, bounded entries, finite TTL.
 */
export function createDogSharedReadCoordinator({
  maxPendingPerDatabase=128,maxCachedPerDatabase=256,ttlMs=0,
  clock=Date.now
}={}){
 const byDatabase=new WeakMap();
 const counters={documentReads:0,sharedReads:0,cacheHits:0,errors:0,invalidations:0};
 const liveDatabases=new Set();
 let epoch=0;
 function storeFor(db){
  let value=byDatabase.get(db);
  if(!value){
   value={pending:new Map(),cached:new Map()};
   byDatabase.set(db,value);
   liveDatabases.add(value);
  }
  return value;
 }
 function invalidate(path=null){
  epoch++;
  counters.invalidations++;
  for(const db of liveDatabases){
   if(path==null){db.pending.clear();db.cached.clear();}
   else{db.pending.delete(path);db.cached.delete(path);}
  }
 }
 async function read(db,ref){
  const path=ref?.path||ref?.key;
  if(!db||typeof db!=='object'||typeof path!=='string'||!path||typeof ref.get!=='function'){
   counters.documentReads++;
   return ref.get();
  }
  const record=storeFor(db);
  const now=clock();
  if(ttlMs>0){
   const cached=record.cached.get(path);
   if(cached&&cached.expiresAt>now){
    counters.cacheHits++;
    // Refresh bounded FIFO order; does not prolong the TTL.
    record.cached.delete(path);
    record.cached.set(path,cached);
    return cached.snapshot;
   }
   if(cached)record.cached.delete(path);
  }
  const existing=record.pending.get(path);
  if(existing){counters.sharedReads++;return existing;}
  counters.documentReads++;
  const readEpoch=epoch;
  const task=Promise.resolve().then(()=>ref.get());
  const tracked=record.pending.size<maxPendingPerDatabase;
  if(tracked)record.pending.set(path,task);
  try{
   const value=await task;
   if(ttlMs>0&&readEpoch===epoch){
    record.cached.delete(path);
    record.cached.set(path,{snapshot:value,expiresAt:clock()+ttlMs});
    while(record.cached.size>maxCachedPerDatabase)
     record.cached.delete(record.cached.keys().next().value);
   }
   return value;
  }catch(error){counters.errors++;throw error;}
  finally{if(tracked&&record.pending.get(path)===task)record.pending.delete(path);}
 }
 const stats=()=>({...counters,ttlMs,maxCachedPerDatabase,
  cached:[...liveDatabases].reduce((n,db)=>n+db.cached.size,0),
  pending:[...liveDatabases].reduce((n,db)=>n+db.pending.size,0)});
 return {read,invalidate,stats};
}
