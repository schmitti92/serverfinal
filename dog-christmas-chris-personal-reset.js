/**
 * One-time, per-account restart of DOG's Lichtertal Christmas event.
 * This is NOT the shared season reset: it never edits the shared village,
 * print runs, shared scratch settings, other accounts or other games.
 *
 * Only a Firebase-authenticated profile whose VERIFIED name is Chris can
 * request the reset, and the target is always that token's own UID.
 */
import {DOG_VILLAGE_COLLECTION,DOG_GLOBAL_VILLAGE_ID} from './dog/christmas-village.js';
import {DOG_PLAYER_STATS_COLLECTION} from './dog/player-stats.js';
import {DOG_RESEARCH_COLLECTION} from './dog/christmas-research.js';
import {DOG_SCRATCH_COLLECTION} from './dog/christmas-scratch.js';
import {DOG_TREE_REWARDS_COLLECTION} from './dog/christmas-tree-rewards.js';

export const CHRIS_CHRISTMAS_RESET_ID='2026-11-21-chris-personal-lichtertal-restart-v1';
export const CHRIS_CHRISTMAS_RESET_MARKERS='dog_christmas_personal_reset_markers_v1';
export const CHRIS_CHRISTMAS_RESET_ARCHIVES='dog_christmas_personal_reset_archives_v1';
export const CHRIS_CHRISTMAS_PLAYER_COLLECTIONS=Object.freeze([
 DOG_PLAYER_STATS_COLLECTION,  // DOG matches, XP / player level
 DOG_RESEARCH_COLLECTION,      // personal research and ability points
 DOG_SCRATCH_COLLECTION,       // coins, vouchers, issues, ticket receipts and prizes
 DOG_TREE_REWARDS_COLLECTION,  // personal tree claims and appearance unlocks
 'dog_grinch_campaign_v1',     // personal Grinch mission progress
 'dog_christmas_intro_unlock_v1', // seen/claimed cinematic
 DOG_VILLAGE_COLLECTION       // ONLY legacy /<uid>; never the shared document
]);
const ROOM_COLLECTION='spielesammlung_hub_v1';
const validUid=uid=>typeof uid==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(uid);
const archiveId=(path)=>CHRIS_CHRISTMAS_RESET_ID+'_'+Buffer.from(path).toString('base64url');
const markerFor=(db,uid)=>db.collection(CHRIS_CHRISTMAS_RESET_MARKERS).doc(uid);
const entryRefs=(db,uid)=>CHRIS_CHRISTMAS_PLAYER_COLLECTIONS.map(collection=>({
 path:collection+'/'+uid,
 ref:db.collection(collection).doc(uid)
}));
// A completed DOG match may remain in its "playing" HUB ROOM until the
// winning ceremony is acknowledged and the lobby archives that match.
// Inspect the server-owned game state, not just the outer room phase.
export function isChrisActiveChristmasMatch(room,uid,now){
 if(room?.phase!=='playing')return false;
 const game=room.match?.game||room.game;
 if(!['dog','dog-grinch1','dog-grinch2','dog-grinch3'].includes(game))return false;
 if(!(Number(room.expiresAt)>now||!Number.isFinite(Number(room.expiresAt))))return false;
 if(!(room.players||[]).some(player=>player?.uid===uid))return false;
 // The same completion semantics are used by shared-lobby's hubMatchPhase.
 if(game==='dog'&&room.match?.dog?.phase==='finished')return false;
 if(game.startsWith('dog-grinch')&&room.match?.grinch?.complete===true)return false;
 // Unknown or still-running match states stay protected.
 return true;
}
const liveDogRoom=isChrisActiveChristmasMatch;

export async function getChrisChristmasResetStatus(db,uid){
 if(!validUid(uid))throw Error('INVALID_CHRIS_PROFILE');
 if(!db?.collection)throw Error('CHRIS_RESET_STORAGE_UNAVAILABLE');
 const [marker,...snaps]=await Promise.all([
  markerFor(db,uid).get(),...entryRefs(db,uid).map(({ref})=>ref.get())
 ]);
 const alreadyReset=marker.exists&&marker.data()?.status==='completed';
 return {alreadyReset,personalDocumentsPresent:snaps.filter(s=>s.exists).length,
   collections:CHRIS_CHRISTMAS_PLAYER_COLLECTIONS.length,
   sharedVillagePreserved:true,otherPlayersPreserved:true};
}

/**
 * Preflight checks active live matches; transaction does a second check and
 * creates the audit copy in the same commit as the deletion.
 */
export async function resetChrisChristmasOnce(db,uid,{clock=Date.now}={}){
 if(!validUid(uid))throw Error('INVALID_CHRIS_PROFILE');
 if(!db?.collection||!db?.runTransaction)throw Error('CHRIS_RESET_STORAGE_UNAVAILABLE');
 const markerRef=markerFor(db,uid);
 const old=await markerRef.get();
 if(old.exists){
  if(old.data()?.status!=='completed')throw Error('CHRIS_RESET_MARKER_INCONSISTENT');
  return {alreadyReset:true,cleared:old.data().cleared||0,archived:old.data().archived||0};
 }
 const now=clock();
 const existingRooms=await db.collection(ROOM_COLLECTION).get();
 // Keep the live matching rooms in the same transaction: if Chris starts a
 // match in an already joined lobby during the preflight, abort the reset.
 const related=(existingRooms.docs||[]).filter(s=>{
  const room=s.data();
  return (room?.players||[]).some(player=>player?.uid===uid)&&
   (Number(room?.expiresAt)>now||!Number.isFinite(Number(room?.expiresAt)));
 });
 if(related.length>40)throw Error('CHRIS_RESET_TOO_MANY_RELATED_ROOMS');
 if(related.some(s=>liveDogRoom(s.data(),uid,now)))throw Error('CHRIS_RESET_ACTIVE_DOG_MATCH');
 const roomRefs=related.map(s=>s.ref);
 const entries=entryRefs(db,uid),archive=db.collection(CHRIS_CHRISTMAS_RESET_ARCHIVES);
 return db.runTransaction(async tx=>{
  const [marked,...snapshots]=await Promise.all([
   tx.get(markerRef),
   ...entries.map(x=>tx.get(x.ref)),
   ...roomRefs.map(ref=>tx.get(ref))
  ]);
  if(marked.exists){
   if(marked.data()?.status!=='completed')throw Error('CHRIS_RESET_MARKER_INCONSISTENT');
   return {alreadyReset:true,cleared:marked.data().cleared||0,archived:marked.data().archived||0};
  }
  const freshRooms=snapshots.slice(entries.length);
  if(freshRooms.some(s=>s.exists&&liveDogRoom(s.data(),uid,clock())))
   throw Error('CHRIS_RESET_ACTIVE_DOG_MATCH');
  let cleared=0;
  for(let i=0;i<entries.length;i++){
   const entry=entries[i],snap=snapshots[i];
   if(!snap.exists)continue;
   if(entry.path===DOG_VILLAGE_COLLECTION+'/'+DOG_GLOBAL_VILLAGE_ID)
    throw Error('CHRIS_RESET_SHARED_VILLAGE_FORBIDDEN');
   tx.create(archive.doc(archiveId(entry.path)),{
    resetId:CHRIS_CHRISTMAS_RESET_ID,uid,sourcePath:entry.path,
    savedAt:now,data:snap.data()
   });
   tx.delete(entry.ref);
   cleared++;
  }
  tx.create(markerRef,{uid,resetId:CHRIS_CHRISTMAS_RESET_ID,status:'completed',
   completedAt:now,cleared,archived:cleared,
   sharedVillagePreserved:true,otherPlayersPreserved:true,
   personalCollections:CHRIS_CHRISTMAS_PLAYER_COLLECTIONS});
  return {alreadyReset:false,cleared,archived:cleared};
 });
}

export function installChrisChristmasResetApi(app,{verifyProfile,getFirestore,clock=Date.now}){
 const authentication=async(req,res,next)=>{
  try{
   const token=/^Bearer\s+(\S+)$/i.exec(String(req.get('authorization')||''))?.[1];
   const identity=token&&await verifyProfile(token);
   // Verified Firebase UID and verified server-side profile NAME; no client
   // provided target UID, no PIN, no arbitrary administrator reset.
   if(!validUid(identity?.uid))return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   if(String(identity.name||'').trim().toLowerCase()!=='chris')
    return res.status(403).json({ok:false,error:'CHRIS_PROFILE_ONLY'});
   req.resetChrisUid=identity.uid;next();
  }catch(_){return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});}
 };
 const respondError=(res,e)=>{
  const reason=String(e?.message||'');
  const code=reason==='CHRIS_RESET_ACTIVE_DOG_MATCH'?409:
   reason==='INVALID_CHRIS_PROFILE'?400:503;
  return res.status(code).json({ok:false,error:code===503?'CHRIS_RESET_UNAVAILABLE':reason});
 };
 const store=()=>getFirestore?.();
 app.get('/api/hub/dog/chris-christmas-reset/status',authentication,async(req,res)=>{
  try{
   const result=await getChrisChristmasResetStatus(store(),req.resetChrisUid);
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...result});
  }catch(e){return respondError(res,e);}
 });
 app.post('/api/hub/dog/chris-christmas-reset',authentication,async(req,res)=>{
  if(req.body?.confirmation!=='CHRIS_WEIHNACHT_NEUSTART')
   return res.status(400).json({ok:false,error:'RESET_CONFIRMATION_REQUIRED'});
  try{
   const result=await resetChrisChristmasOnce(store(),req.resetChrisUid,{clock});
   res.set('Cache-Control','no-store');
   return res.json({ok:true,resetCompleted:true,...result});
  }catch(e){return respondError(res,e);}
 });
}
