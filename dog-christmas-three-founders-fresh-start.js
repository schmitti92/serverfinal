/**
 * One-shot fresh start for the three founding Lichtertal participants:
 * Chris, Vanessa and David. User-authorized, server-side, archived and
 * completely separate from the old Chris-only and season-wide migrations.
 *
 * DO NOT reset account identities, other games or unrelated users.
 * Firestore transactional preconditions guarantee all-or-none changes.
 */
import {DOG_VILLAGE_COLLECTION,DOG_GLOBAL_VILLAGE_ID} from './dog/christmas-village.js';
import {DOG_PLAYER_STATS_COLLECTION} from './dog/player-stats.js';
import {DOG_RESEARCH_COLLECTION} from './dog/christmas-research.js';
import {DOG_SCRATCH_COLLECTION} from './dog/christmas-scratch.js';
import {DOG_TREE_REWARDS_COLLECTION} from './dog/christmas-tree-rewards.js';
import {CHRISTMAS_EDITIONS,freshChristmasEdition} from './dog-christmas-reset-once.js';

export const FRESH_START_ID='2026-11-21-lichtertal-chris-vanessa-david-fresh-start-v1';
export const FRESH_START_MARKERS='dog_christmas_founders_restart_markers_v1';
export const FRESH_START_ARCHIVES='dog_christmas_founders_restart_archives_v1';
export const FRESH_START_ACCESS='dog_christmas_event_access_v1';
export const FRESH_START_NAMES=Object.freeze(['chris','vanessa','david']);
export const FRESH_START_PLAYER_COLLECTIONS=Object.freeze([
 DOG_PLAYER_STATS_COLLECTION,DOG_RESEARCH_COLLECTION,DOG_SCRATCH_COLLECTION,
 DOG_TREE_REWARDS_COLLECTION,'dog_grinch_campaign_v1',
 'dog_christmas_intro_unlock_v1',DOG_VILLAGE_COLLECTION
]);
const HUB_ROOMS='spielesammlung_hub_v1';
const freshId=path=>FRESH_START_ID+'_'+Buffer.from(path).toString('base64url');
const accountName=x=>String(x||'').trim().toLowerCase();
const validUid=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(x);
const ref=(db,path)=>{const slash=path.indexOf('/');return db.collection(path.slice(0,slash)).doc(path.slice(slash+1));};
const isDogRoom=room=>room?.phase==='playing'&&
 ['dog','dog-grinch1','dog-grinch2','dog-grinch3'].includes(room?.match?.game||room?.game);
const unfinishedDogMatch=room=>room?.match?.game==='dog'?
 room.match?.dog?.phase!=='finished':
 room?.match?.grinch?.complete!==true;

export async function freshStartStatus(db){
 const doc=await db.collection(FRESH_START_MARKERS).doc(FRESH_START_ID).get();
 return {completed:doc.exists&&doc.data()?.status==='completed',
  ...(doc.exists?{cleared:doc.data()?.cleared||0}: {})};
}

export async function resetThreeFoundersChristmasOnce(db,{
 clock=Date.now,logger=console
}={}){
 if(!db?.collection||!db?.runTransaction)throw Error('FOUNDERS_RESET_FIRESTORE_UNAVAILABLE');
 const marker=db.collection(FRESH_START_MARKERS).doc(FRESH_START_ID);
 const previously=await marker.get();
 if(previously.exists){
  if(previously.data()?.status!=='completed')throw Error('FOUNDERS_RESET_MARKER_INCONSISTENT');
  return {completed:true,skipped:true,cleared:previously.data().cleared||0};
 }
 // Read stored identities, NEVER display aliases or unverified browser names.
 const allProfiles=await db.collection('player_profiles_v1').get();
 const profiles=new Map(FRESH_START_NAMES.map(name=>[name,[]]));
 for(const doc of allProfiles.docs||[]){
  const value=doc.data()||{},name=accountName(value.name);
  if(profiles.has(name))profiles.get(name).push({doc,uid:doc.id,data:value});
 }
 const accounts=FRESH_START_NAMES.map(name=>{
  const matches=profiles.get(name);
  if(matches.length!==1)throw Error('FOUNDERS_RESET_NAME_NOT_UNIQUE_'+name);
  const {doc,uid,data}=matches[0];
  if(!validUid(uid)||data.uid&&data.uid!==uid||data.setupComplete===false)
   throw Error('FOUNDERS_RESET_PROFILE_INVALID_'+name);
  return {name,uid,profileRef:doc.ref};
 });
 if(new Set(accounts.map(x=>x.uid)).size!==3)throw Error('FOUNDERS_RESET_DUPLICATE_UID');
 const byUid=new Set(accounts.map(x=>x.uid));
 // Do not reset the globally shared village if another account has already
 // begun the event. DOG-only statistics and other games are not event proof.
 const eventCollections=FRESH_START_PLAYER_COLLECTIONS.filter(x=>x!==DOG_PLAYER_STATS_COLLECTION);
 const [existingEvent,roomsSnap]=await Promise.all([
  Promise.all(eventCollections.map(collection=>db.collection(collection).get())),
  db.collection(HUB_ROOMS).get()
 ]);
 for(let i=0;i<existingEvent.length;i++){
  const collection=eventCollections[i];
  for(const doc of existingEvent[i].docs||[]){
   if(collection===DOG_VILLAGE_COLLECTION&&doc.id===DOG_GLOBAL_VILLAGE_ID)continue;
   if(!byUid.has(doc.id))throw Error('FOUNDERS_RESET_OTHER_EVENT_PARTICIPANT');
  }
 }
 const now=clock(),relatedRooms=[];
 for(const doc of roomsSnap.docs||[]){
  const room=doc.data();
  if(!isDogRoom(room))continue;
  const playerUids=(room.players||[]).map(p=>p.uid).filter(Boolean);
  if(!playerUids.some(uid=>byUid.has(uid)))continue;
  if(playerUids.some(uid=>!byUid.has(uid)&&!String(uid).startsWith('testbot:')))
   throw Error('FOUNDERS_RESET_OTHER_PLAYER_IN_DOG_ROOM');
  // Reopen old rooms in the lobby; stale matches must not credit late rewards.
  // A genuinely active game edited in the last 3 minutes blocks the reset.
  if(unfinishedDogMatch(room)&&Number.isFinite(Number(room.updatedAt))&&
     Number(room.updatedAt)>0&&now-Number(room.updatedAt)<180_000)
   throw Error('FOUNDERS_RESET_LIVE_DOG_MATCH');
  if(Number(room.expiresAt)>now)relatedRooms.push({ref:doc.ref,code:doc.id});
 }
 if(relatedRooms.length>40)throw Error('FOUNDERS_RESET_TOO_MANY_ROOMS');
 const entries=accounts.flatMap(x=>FRESH_START_PLAYER_COLLECTIONS.map(collection=>({
  path:collection+'/'+x.uid,variant:null
 })));
 entries.push({path:DOG_VILLAGE_COLLECTION+'/'+DOG_GLOBAL_VILLAGE_ID,variant:null});
 for(const [collection,id,variant] of CHRISTMAS_EDITIONS)
  entries.push({path:collection+'/'+id,variant});
 const refs=entries.map(e=>ref(db,e.path));
 const grants=accounts.map(x=>db.collection(FRESH_START_ACCESS).doc(x.uid));
 const archive=db.collection(FRESH_START_ARCHIVES);
 return db.runTransaction(async tx=>{
  // Every read precedes every write, required by Firestore transaction rules.
  const [markerNow,...snapshots]=await Promise.all([
   tx.get(marker),
   ...accounts.map(x=>tx.get(x.profileRef)),
   ...refs.map(r=>tx.get(r)),
   ...grants.map(r=>tx.get(r)),
   ...relatedRooms.map(x=>tx.get(x.ref))
  ]);
  if(markerNow.exists){
   if(markerNow.data()?.status!=='completed')throw Error('FOUNDERS_RESET_MARKER_INCONSISTENT');
   return {completed:true,skipped:true,cleared:markerNow.data().cleared||0};
  }
  const profileSnaps=snapshots.slice(0,accounts.length);
  for(let i=0;i<accounts.length;i++){
   const snap=profileSnaps[i],account=accounts[i],value=snap.data();
   if(!snap.exists||accountName(value.name)!==account.name||
      value.uid&&value.uid!==account.uid||value.setupComplete===false)
    throw Error('FOUNDERS_RESET_PROFILE_CHANGED_'+account.name);
  }
  const dataStart=accounts.length,grantStart=dataStart+entries.length;
  const entrySnaps=snapshots.slice(dataStart,grantStart);
  const grantSnaps=snapshots.slice(grantStart,grantStart+grants.length);
  const roomSnaps=snapshots.slice(grantStart+grants.length);
  for(const snap of roomSnaps){
   if(!snap.exists)continue;
   const room=snap.data(),playerUids=(room?.players||[]).map(p=>p.uid).filter(Boolean);
   if(playerUids.some(uid=>!byUid.has(uid)&&!String(uid).startsWith('testbot:')))
    throw Error('FOUNDERS_RESET_OTHER_PLAYER_IN_DOG_ROOM');
   if(isDogRoom(room)&&unfinishedDogMatch(room)&&Number(room.updatedAt)>0&&
      clock()-Number(room.updatedAt)<180_000)
    throw Error('FOUNDERS_RESET_LIVE_DOG_MATCH');
  }
  let cleared=0,archived=0,editionsRestarted=0,roomsReopened=0;
  for(let i=0;i<entries.length;i++){
   const entry=entries[i],snap=entrySnaps[i];
   if(!snap.exists)continue;
   tx.create(archive.doc(freshId(entry.path)),{
    resetId:FRESH_START_ID,sourcePath:entry.path,savedAt:now,data:snap.data()
   });
   archived++;
   if(entry.variant){
    tx.set(refs[i],freshChristmasEdition(snap.data(),entry.variant,now));
    editionsRestarted++;
   }else{
    tx.delete(refs[i]);cleared++;
   }
  }
  for(let i=0;i<grants.length;i++){
   if(grantSnaps[i].exists){
    const path=FRESH_START_ACCESS+'/'+accounts[i].uid;
    tx.create(archive.doc(freshId(path)),{
     resetId:FRESH_START_ID,sourcePath:path,savedAt:now,data:grantSnaps[i].data()
    });archived++;
   }
   tx.set(grants[i],{uid:accounts[i].uid,displayName:accounts[i].data.name,
    access:true,firstVisit:true,resetId:FRESH_START_ID,issuedAt:now});
  }
  for(let i=0;i<roomSnaps.length;i++){
   const snap=roomSnaps[i];if(!snap.exists||!isDogRoom(snap.data()))continue;
   const room=snap.data();
   const path=HUB_ROOMS+'/'+relatedRooms[i].code;
   tx.create(archive.doc(freshId(path)),{
    resetId:FRESH_START_ID,sourcePath:path,savedAt:now,data:room
   });archived++;
   // Keep the room and its members, but prevent an old match from paying any
   // Christmas prizes after the new season baseline is established.
   tx.set(relatedRooms[i].ref,{...room,phase:'lobby',game:null,match:null,
    revision:(Number(room.revision)||0)+1,updatedAt:now,
    players:(room.players||[]).map(p=>({...p,ready:false,participating:false}))});
   roomsReopened++;
  }
  tx.create(marker,{status:'completed',resetId:FRESH_START_ID,
   completedAt:now,profileNames:[...FRESH_START_NAMES],
   uids:accounts.map(x=>x.uid),cleared,archived,
   editionsRestarted,roomsReopened,accessGranted:accounts.length,
   sharedVillageReset:true,otherGamesPreserved:true});
  return {completed:true,skipped:false,cleared,archived,
   editionsRestarted,roomsReopened,accessGranted:accounts.length,sharedVillageReset:true};
 }).then(result=>{
  logger?.info?.('[dog-founders-fresh-start] '+JSON.stringify({
   completed:result.completed,skipped:result.skipped,cleared:result.cleared,
   archived:result.archived,editionsRestarted:result.editionsRestarted,
   roomsReopened:result.roomsReopened,accessGranted:result.accessGranted
  }));
  return result;
 });
}
