/**
 * Explicit, user-authorized global restart of DOG Christmas "Lichtertal".
 * All event progress, including anonymous/extra participant documents and
 * the shared XP academy, is archived and cleared for EVERY player.
 *
 * Other games, login profiles, global scratch prize configuration and
 * unrelated Firebase collections remain untouched.
 *
 * The restart and its marker are committed in one Firestore transaction.
 * Server startup awaits this operation before accepting new HTTP traffic.
 */
import {CHRISTMAS_PLAYER_COLLECTIONS,CHRISTMAS_EDITIONS,freshChristmasEdition} from './dog-christmas-reset-once.js';
import {DOG_VILLAGE_COLLECTION,DOG_GLOBAL_VILLAGE_ID,dogVillagePublic} from './dog/christmas-village.js';

export const ALL_CHRISTMAS_RESTART_ID='2026-11-21-lichtertal-all-players-total-restart-v2';
export const ALL_CHRISTMAS_RESTART_MARKERS='dog_christmas_all_players_restart_markers_v1';
export const ALL_CHRISTMAS_RESTART_ARCHIVES='dog_christmas_all_players_restart_archive_v1';
export const ALL_CHRISTMAS_ACCESS_COLLECTION='dog_christmas_event_access_v1';
export const ALL_CHRISTMAS_INTRO_COLLECTION='dog_christmas_intro_unlock_v1';
export const ALL_CHRISTMAS_CLEAR_COLLECTIONS=Object.freeze([
 ...CHRISTMAS_PLAYER_COLLECTIONS,ALL_CHRISTMAS_INTRO_COLLECTION,
 ALL_CHRISTMAS_ACCESS_COLLECTION
]);
const PROFILE_COLLECTION='player_profiles_v1';
const ROOM_COLLECTION='spielesammlung_hub_v1';
const MAX_TRANSACT_WRITES=450;
const MAX_CHANGE_DOCUMENTS=175;
const MAX_ROOMS_TO_REOPEN=45;
const archiveId=path=>ALL_CHRISTMAS_RESTART_ID+'_'+Buffer.from(path).toString('base64url');
const validUid=uid=>typeof uid==='string'&&/^[A-Za-z0-9_-]{4,200}$/.test(uid);
const isOldDogMatch=room=>{
 if(room?.phase!=='playing')return false;
 const game=room.match?.game||room.game;
 return ['dog','dog-grinch1','dog-grinch2','dog-grinch3'].includes(game);
};
const roomCouldStillBeActive=(room,now)=>
 Number(room?.expiresAt)>now||!Number.isFinite(Number(room?.expiresAt));
const makeGrant=(uid,profile,now)=>({
 uid,displayName:String(profile?.name||'').slice(0,64),access:true,
 firstVisit:true,resetId:ALL_CHRISTMAS_RESTART_ID,issuedAt:now
});

/**
 * Wipes every event-only document, including unknown players ("Spieler 9"),
 * rather than failing when another participant has joined Lichtertal.
 * Does not invent profile IDs or rely on screen names.
 */
export async function restartDogChristmasForAllOnce(db,{clock=Date.now,logger=console}={}){
 if(!db?.collection||!db?.runTransaction)
  throw Error('ALL_CHRISTMAS_RESET_FIRESTORE_REQUIRED');
 const markerRef=db.collection(ALL_CHRISTMAS_RESTART_MARKERS).doc(ALL_CHRISTMAS_RESTART_ID);
 const oldMarker=await markerRef.get();
 if(oldMarker.exists){
  if(oldMarker.data()?.status!=='completed')
   throw Error('ALL_CHRISTMAS_RESET_MARKER_INCONSISTENT');
  logger?.info?.('[dog-all-christmas-reset] already completed; no fresh earnings touched');
  return {completed:true,skipped:true,...oldMarker.data()};
 }
 const time=clock();
 const profileQuery=db.collection(PROFILE_COLLECTION);
 const roomQuery=db.collection(ROOM_COLLECTION);
 const eventQueries=ALL_CHRISTMAS_CLEAR_COLLECTIONS.map(name=>db.collection(name));
 const editionDocs=CHRISTMAS_EDITIONS.map(([collection,id])=>db.collection(collection).doc(id));
 const archive=db.collection(ALL_CHRISTMAS_RESTART_ARCHIVES);
 // Transaction query reads include ALL players, including previously unknown
 // account IDs. An entire collection snapshot cannot miss Spieler 9.
 const result=await db.runTransaction(async tx=>{
  const [marker,profiles,rooms,...tail]=await Promise.all([
   tx.get(markerRef),tx.get(profileQuery),tx.get(roomQuery),
   ...eventQueries.map(q=>tx.get(q)),...editionDocs.map(ref=>tx.get(ref))
  ]);
  if(marker.exists){
   if(marker.data()?.status!=='completed')
    throw Error('ALL_CHRISTMAS_RESET_MARKER_INCONSISTENT');
   return {completed:true,skipped:true,...marker.data()};
  }
  const eventSnaps=tail.slice(0,eventQueries.length);
  const editionSnaps=tail.slice(eventQueries.length);
  const profileDocs=profiles.docs||[],knownUsers=new Map();
  for(const profile of profileDocs){
   const uid=profile.id,data=profile.data()||{};
   if(!validUid(uid)||data.uid&&data.uid!==uid)
    throw Error('ALL_CHRISTMAS_RESET_INVALID_PROFILE');
   if(knownUsers.has(uid))throw Error('ALL_CHRISTMAS_RESET_DUPLICATE_UID');
   knownUsers.set(uid,data);
  }
  const existingAccess=new Set();
  let archived=0,cleared=0,editionsRestarted=0,
   unsupportedEditionsCleared=0,roomsReopened=0;
  const documentsToClear=eventSnaps.reduce((sum,s)=>sum+(s.docs||[]).length,0)+
   editionSnaps.filter(s=>s.exists).length;
  if(documentsToClear>MAX_CHANGE_DOCUMENTS)
   throw Error('ALL_CHRISTMAS_RESET_TOO_MANY_DOCUMENTS_'+documentsToClear);
  const obsoleteRooms=(rooms.docs||[]).filter(s=>{
   const room=s.data();
   return isOldDogMatch(room)&&roomCouldStillBeActive(room,time);
  });
  if(obsoleteRooms.length>MAX_ROOMS_TO_REOPEN)
   throw Error('ALL_CHRISTMAS_RESET_TOO_MANY_DOG_ROOMS_'+obsoleteRooms.length);
  // Each existing record gets an archived copy + one delete/replace.
  // Every new access grant is a single additional document write.
  const estimatedWrites=2*(documentsToClear+obsoleteRooms.length)+
   profileDocs.filter(doc=>!(eventSnaps.at(-1).docs||[]).some(g=>g.id===doc.id)).length+1;
  if(estimatedWrites>MAX_TRANSACT_WRITES)
   throw Error('ALL_CHRISTMAS_RESET_TOO_MANY_WRITES_'+estimatedWrites);

  for(let i=0;i<eventQueries.length;i++){
   const collection=ALL_CHRISTMAS_CLEAR_COLLECTIONS[i];
   for(const snap of eventSnaps[i].docs||[]){
    const path=collection+'/'+snap.id;
    tx.create(archive.doc(archiveId(path)),{
     resetId:ALL_CHRISTMAS_RESTART_ID,sourcePath:path,
     savedAt:time,data:snap.data()
    });
    archived++;
    if(collection===ALL_CHRISTMAS_ACCESS_COLLECTION&&knownUsers.has(snap.id)){
     existingAccess.add(snap.id);
     tx.set(snap.ref,makeGrant(snap.id,knownUsers.get(snap.id),time));
    }else{
     tx.delete(snap.ref);cleared++;
    }
   }
  }
  // Every verified registered player gets the fresh first-visit invitation.
  // Zero DOG match history no longer blocks access to the new event.
  for(const [uid,profile] of knownUsers){
   if(existingAccess.has(uid))continue;
   tx.create(db.collection(ALL_CHRISTMAS_ACCESS_COLLECTION).doc(uid),
    makeGrant(uid,profile,time));
  }
  for(let i=0;i<CHRISTMAS_EDITIONS.length;i++){
   const snap=editionSnaps[i];if(!snap.exists)continue;
   const [collection,id,variant]=CHRISTMAS_EDITIONS[i];
   const path=collection+'/'+id;
   tx.create(archive.doc(archiveId(path)),{
    resetId:ALL_CHRISTMAS_RESTART_ID,sourcePath:path,savedAt:time,
    data:snap.data()
   });
   archived++;
   try{
    tx.set(snap.ref,freshChristmasEdition(snap.data(),variant,time));
    editionsRestarted++;
   }catch(e){
    if(!String(e?.message||'').startsWith('CHRISTMAS_RESET_UNSUPPORTED_EDITION_'))throw e;
    // Legacy incomplete print runs are safely archived before being removed.
    // A new issue can then be created with the existing scratch configuration.
    tx.delete(snap.ref);cleared++;unsupportedEditionsCleared++;
   }
  }
  for(const snap of obsoleteRooms){
   const room=snap.data(),path=ROOM_COLLECTION+'/'+snap.id;
   tx.create(archive.doc(archiveId(path)),{
    resetId:ALL_CHRISTMAS_RESTART_ID,sourcePath:path,
    savedAt:time,data:room
   });
   archived++;
   tx.set(snap.ref,{...room,phase:'lobby',game:null,match:null,
    revision:(Number(room.revision)||0)+1,updatedAt:time,
    players:(room.players||[]).map(p=>({...p,ready:false,participating:false}))});
   roomsReopened++;
  }
  const markerData={
   resetId:ALL_CHRISTMAS_RESTART_ID,status:'completed',completedAt:time,
   profilesGrantedAccess:knownUsers.size,collectionsCleared:[...ALL_CHRISTMAS_CLEAR_COLLECTIONS],
   archived,cleared,editionsRestarted,unsupportedEditionsCleared,
   roomsReopened,sharedVillageReset:true,otherGamesUnaffected:true,
   scratchSettingsPreserved:true,
   defaultXpAcademyLevel:dogVillagePublic(null,DOG_GLOBAL_VILLAGE_ID).levels.academy
  };
  tx.create(markerRef,markerData);
  return {completed:true,skipped:false,...markerData};
 });
 // Read authoritative Firestore after commit rather than asserting that a
 // successful GitHub commit / deployment means the event has restarted.
 const [savedMarker,villageSnap]=await Promise.all([
  markerRef.get(),
  db.collection(DOG_VILLAGE_COLLECTION).doc(DOG_GLOBAL_VILLAGE_ID).get()
 ]);
 const verified=savedMarker.exists&&savedMarker.data()?.status==='completed'&&
  !villageSnap.exists&&
  dogVillagePublic(villageSnap.exists?villageSnap.data():null,DOG_GLOBAL_VILLAGE_ID).levels.academy===1;
 logger?.info?.('[dog-all-christmas-reset] '+JSON.stringify({
  completed:result.completed,skipped:result.skipped,verified,
  profilesGrantedAccess:result.profilesGrantedAccess,cleared:result.cleared,
  archived:result.archived,editionsRestarted:result.editionsRestarted,
  roomsReopened:result.roomsReopened,
  actualAcademyLevel:dogVillagePublic(villageSnap.exists?villageSnap.data():null,DOG_GLOBAL_VILLAGE_ID).levels.academy,
  sharedVillageStored:villageSnap.exists
 }));
 if(!verified)throw Error('ALL_CHRISTMAS_RESET_POST_COMMIT_VERIFICATION_FAILED');
 return {...result,verified,actualAcademyLevel:1};
}
