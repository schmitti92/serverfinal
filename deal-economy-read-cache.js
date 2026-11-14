/* Read-only Render RAM cache for the shared Deal/Monster Slots display economy.
 * Mutations, pack purchases, and prize settlement NEVER use this cache.
 */
import {dealEconomyRef,normalizeDealEconomy} from './deal-economy.js';

export function createDealEconomyReadCache({clock=()=>Date.now(),ttlMs=15000}={}){
 let entry=null,generation=0;
 const counters={firestoreReads:0,cacheHits:0,coalesced:0,invalidations:0};
 function invalidate(){
  generation++;
  entry=null;
  counters.invalidations++;
 }
 function stats(){return {...counters,ttlMs,cached:!!entry};}
 async function read(db){
  const now=clock(),current=entry;
  if(current&&(current.pending||current.expires>now)){
   if(current.pending)counters.coalesced++;
   else counters.cacheHits++;
   const economy=await current.promise;
   // An administrator may have changed prices while the request was pending.
   if(current.generation!==generation)return read(db);
   return economy;
  }
  const version=generation;
  counters.firestoreReads++;
  const promise=dealEconomyRef(db).get().then(snapshot=>
   normalizeDealEconomy(snapshot.exists?snapshot.data():null));
  const created={generation:version,promise,pending:true,expires:now+ttlMs};
  entry=created;
  try{
   const economy=await promise;
   if(entry===created){
    created.pending=false;
    created.expires=clock()+ttlMs;
   }
   if(version!==generation)return read(db);
   return economy;
  }catch(error){
   if(entry===created)entry=null;
   throw error;
  }
 }
 return {read,invalidate,stats};
}
