/**
 * Single-season Lichtertal launch reset. Does NOT touch DOG 100 Gates,
 * Deal or No Deal, other games, accounts, or saved lottery configurations.
 *
 * Only run when DOG_CHRISTMAS_RESET_ONCE exactly matches the reset ID below.
 * Each source document is archived in the SAME Firestore transaction as its
 * deletion/replacement. If any read, precondition, or write fails, nothing
 * from the transaction is reset. An immutable marker makes restarts safe.
 */
import {randomInt,randomUUID} from 'node:crypto';
import {DOG_VILLAGE_COLLECTION} from './dog/christmas-village.js';
import {DOG_PLAYER_STATS_COLLECTION} from './dog/player-stats.js';
import {DOG_RESEARCH_COLLECTION} from './dog/christmas-research.js';
import {DOG_SCRATCH_COLLECTION} from './dog/christmas-scratch.js';
import {DOG_TREE_REWARDS_COLLECTION} from './dog/christmas-tree-rewards.js';
import {GIFTS_EDITION_COLLECTION,GIFTS_EDITION_CURRENT} from './dog/christmas-gifts-edition.js';
import {SNOW_EDITION_COLLECTION,SNOW_EDITION_CURRENT} from './dog/christmas-snow-edition.js';
import {TIC_EDITION_COLLECTION,TIC_EDITION_CURRENT} from './dog/christmas-tic-edition.js';
import {OTHER_EDITION_COLLECTION,OTHER_EDITION_VARIANTS} from './dog/christmas-other-editions.js';

export const CHRISTMAS_RESET_ID='2026-11-21-lichtertal-official-restart-v1';
export const CHRISTMAS_RESET_MARKERS='dog_christmas_reset_markers_v1';
export const CHRISTMAS_RESET_ARCHIVES='dog_christmas_reset_archive_v1';
export const CHRISTMAS_PLAYER_COLLECTIONS=Object.freeze([
 DOG_VILLAGE_COLLECTION, // Also deletes the LEGACY per-host villages; no old data re-import.
 DOG_PLAYER_STATS_COLLECTION,
 DOG_RESEARCH_COLLECTION,
 DOG_SCRATCH_COLLECTION,
 DOG_TREE_REWARDS_COLLECTION,
 'dog_grinch_campaign_v1'
]);
export const CHRISTMAS_EDITIONS=Object.freeze([
 [GIFTS_EDITION_COLLECTION,GIFTS_EDITION_CURRENT,'gifts'],
 [SNOW_EDITION_COLLECTION,SNOW_EDITION_CURRENT,'snow_collect'],
 [TIC_EDITION_COLLECTION,TIC_EDITION_CURRENT,'tic_tac_toe'],
 ...OTHER_EDITION_VARIANTS.map(name=>[OTHER_EDITION_COLLECTION,'current_'+name,name])
]);
const HUB_ROOM_COLLECTION='spielesammlung_hub_v1';
const MAX_CHANGED_DOCS=180; // <500 Firestore writes (archive + delete/set).
const archiveId=path=>CHRISTMAS_RESET_ID+'_'+Buffer.from(path).toString('base64url');
const shuffle=list=>{
 const items=[...list];
 for(let i=items.length-1;i>0;i--){
  const j=randomInt(i+1);
  [items[i],items[j]]=[items[j],items[i]];
 }
 return items;
};

export function freshChristmasEdition(raw,variant,now=Date.now()){
 if(!raw||typeof raw!=='object'||raw.variantId!==variant||
    !Number.isInteger(raw.issued)||raw.issued<0||raw.issued>500||
    !Array.isArray(raw.prizePlan)||raw.prizePlan.length!==500)
  throw Error('CHRISTMAS_RESET_UNSUPPORTED_EDITION_'+variant);
 // Reuse the already-validated payout plan without changing the prize
 // budget, price, chance settings, or fixed 500-ticket distribution.
 return {...raw,id:randomUUID(),createdAt:now,createdBy:'christmas-season-reset',
  updatedAt:now,issued:0,paidCoins:0,revision:1,prizePlan:shuffle(raw.prizePlan)};
}

/**
 * Complete reset for all DOG Christmas profiles in the ONE shared event.
 * Transactions are used only for a safe, small preflighted account collection.
 * If too many documents have accumulated, fail CLOSED without touching data.
 */
export async function resetDogChristmasEventOnce(db,log=console){
 if(!db||typeof db.collection!=='function'||typeof db.runTransaction!=='function')
  throw Error('CHRISTMAS_RESET_FIRESTORE_REQUIRED');
 const markerRef=db.collection(CHRISTMAS_RESET_MARKERS).doc(CHRISTMAS_RESET_ID);
 const old=await markerRef.get();
 if(old.exists){
  if(old.data()?.status!=='completed')throw Error('CHRISTMAS_RESET_MARKER_INCONSISTENT');
  log.info?.('[christmas-reset] already completed; skip');
  return {completed:true,skipped:true,...old.data()};
 }
 // Read only the Christmas domain. DO NOT use old 100 Gates reset scripts.
 const [snapshots,roomSnapshot]=await Promise.all([
  Promise.all(CHRISTMAS_PLAYER_COLLECTIONS.map(collection=>db.collection(collection).get())),
  db.collection(HUB_ROOM_COLLECTION).get()
 ]);
 const entries=[];
 for(let i=0;i<CHRISTMAS_PLAYER_COLLECTIONS.length;i++)
  for(const doc of snapshots[i].docs)
   entries.push({ref:db.collection(CHRISTMAS_PLAYER_COLLECTIONS[i]).doc(doc.id),
     path:CHRISTMAS_PLAYER_COLLECTIONS[i]+'/'+doc.id,variant:null});
 for(const [collection,id,variant] of CHRISTMAS_EDITIONS)
  entries.push({ref:db.collection(collection).doc(id),path:collection+'/'+id,variant});
 if(entries.length>MAX_CHANGED_DOCS)
  throw Error('CHRISTMAS_RESET_TOO_MANY_DOCUMENTS_'+entries.length);
 // No event progress is reset while a live DOG or Grinch match may still pay
 // late rewards. All non-DOG rooms stay untouched.
 // Old/expired hub rooms may remain in Firestore for a long time.
 // Only VALID LIVE DOG matches can credit Christmas rewards after this reset.
 const now=Date.now();
 const rooms=(roomSnapshot.docs||[]).filter(doc=>{
  const room=doc.data();
  return room?.phase==='playing'&&
   ['dog','dog-grinch1','dog-grinch2'].includes(room.game)&&
   Number(room.expiresAt)>now;
 }).map(doc=>({id:doc.id,ref:db.collection(HUB_ROOM_COLLECTION).doc(doc.id)}));
 if(rooms.length>200)throw Error('CHRISTMAS_RESET_TOO_MANY_LIVE_DOG_ROOMS');
 const archive=db.collection(CHRISTMAS_RESET_ARCHIVES);
 return db.runTransaction(async tx=>{
  // Firestore requires all reads before ANY write.
  const [marker,...snapshotsNow]=await Promise.all([
   tx.get(markerRef),...entries.map(x=>tx.get(x.ref)),...rooms.map(x=>tx.get(x.ref))
  ]);
  if(marker.exists){
   if(marker.data()?.status!=='completed')throw Error('CHRISTMAS_RESET_MARKER_INCONSISTENT');
   return {completed:true,skipped:true,...marker.data()};
  }
  const entriesNow=snapshotsNow.slice(0,entries.length);
  const roomsNow=snapshotsNow.slice(entries.length);
  for(const snap of roomsNow){
   const room=snap.exists?snap.data():null;
   if(room?.phase==='playing'&&['dog','dog-grinch1','dog-grinch2'].includes(room.game))
    throw Error('CHRISTMAS_RESET_DOG_MATCH_ACTIVE');
  }
  let archived=0,cleared=0,editionsRestarted=0;
  for(let i=0;i<entries.length;i++){
   const snap=entriesNow[i],entry=entries[i];
   if(!snap.exists)continue;
   const data=snap.data();
   tx.create(archive.doc(archiveId(entry.path)),{
    resetId:CHRISTMAS_RESET_ID,sourcePath:entry.path,savedAt:now,data
   });
   archived++;
   if(entry.variant){
    tx.set(entry.ref,freshChristmasEdition(data,entry.variant,now));
    editionsRestarted++;
   }else{
    tx.delete(entry.ref);
    cleared++;
   }
  }
  const markerData={
   resetId:CHRISTMAS_RESET_ID,status:'completed',completedAt:now,
   archived,cleared,editionsRestarted,
   collectionsCleared:[...CHRISTMAS_PLAYER_COLLECTIONS],
   otherGamesUnaffected:true,printSettingsPreserved:true
  };
  tx.create(markerRef,markerData);
  return {completed:true,skipped:false,...markerData};
 }).then(result=>{
  log.info?.('[christmas-reset] '+JSON.stringify({
   resetId:CHRISTMAS_RESET_ID,status:result.status,
   archived:result.archived,cleared:result.cleared,
   editionsRestarted:result.editionsRestarted,skipped:result.skipped
  }));
  return result;
 });
}
