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
export const CHRIS_CHRISTMAS_LAUNCH_JOB='chris-2026-11-21-lichtertal-personal-restart-once';
export const CHRIS_CHRISTMAS_LAUNCH_JOBS='dog_christmas_personal_reset_jobs_v1';
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
export async function resetChrisChristmasOnce(db,uid,{
 clock=Date.now,ignoreActiveRooms=false,verifyChrisProfileInTransaction=false
}={}){
 if(!validUid(uid))throw Error('INVALID_CHRIS_PROFILE');
 if(!db?.collection||!db?.runTransaction)throw Error('CHRIS_RESET_STORAGE_UNAVAILABLE');
 const markerRef=markerFor(db,uid);
 const old=await markerRef.get();
 if(old.exists){
  if(old.data()?.status!=='completed')throw Error('CHRIS_RESET_MARKER_INCONSISTENT');
  return {alreadyReset:true,cleared:old.data().cleared||0,archived:old.data().archived||0};
 }
 const now=clock();
 // The trusted one-off server startup job can ignore orphaned DOG rooms:
 // it never edits a room, another account, or the common Christmas village.
 // The authenticated interactive endpoint still enforces its normal guard.
 let roomRefs=[];
 if(!ignoreActiveRooms){
  const existingRooms=await db.collection(ROOM_COLLECTION).get();
  // Keep active, joined rooms in the transaction against concurrent starts.
  const related=(existingRooms.docs||[]).filter(s=>{
   const room=s.data();
   return (room?.players||[]).some(player=>player?.uid===uid)&&
    (Number(room?.expiresAt)>now||!Number.isFinite(Number(room?.expiresAt)));
  });
  if(related.length>40)throw Error('CHRIS_RESET_TOO_MANY_RELATED_ROOMS');
  if(related.some(s=>liveDogRoom(s.data(),uid,now)))throw Error('CHRIS_RESET_ACTIVE_DOG_MATCH');
  roomRefs=related.map(s=>s.ref);
 }
 const entries=entryRefs(db,uid),archive=db.collection(CHRIS_CHRISTMAS_RESET_ARCHIVES);
 const profileRef=verifyChrisProfileInTransaction?db.collection('player_profiles_v1').doc(uid):null;
 return db.runTransaction(async tx=>{
  const [marked,...snapshots]=await Promise.all([
   tx.get(markerRef),
   ...entries.map(x=>tx.get(x.ref)),
   ...roomRefs.map(ref=>tx.get(ref)),
   ...(profileRef?[tx.get(profileRef)]:[])
  ]);
  if(marked.exists){
   if(marked.data()?.status!=='completed')throw Error('CHRIS_RESET_MARKER_INCONSISTENT');
   return {alreadyReset:true,cleared:marked.data().cleared||0,archived:marked.data().archived||0};
  }
  const freshRooms=snapshots.slice(entries.length,entries.length+roomRefs.length);
  if(!ignoreActiveRooms&&freshRooms.some(s=>s.exists&&liveDogRoom(s.data(),uid,clock())))
   throw Error('CHRIS_RESET_ACTIVE_DOG_MATCH');
  if(profileRef){
   const profileSnap=snapshots[entries.length+roomRefs.length];
   if(!profileSnap?.exists||String(profileSnap.data()?.name||'').trim().toLowerCase()!=='chris'||
      (profileSnap.data()?.uid&&profileSnap.data().uid!==uid))
    throw Error('CHRIS_RESET_IDENTITY_CHANGED');
  }
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

/**
 * User-authorized single-account reset, applied automatically on next Render
 * start. No public admin endpoint or client-supplied UID is involved. Resolve
 * the authoritative profile by its stored name, and fail closed if ambiguous.
 * A global job receipt ensures no future profile named Chris can be affected
 * by an old deployment of this one-time launch operation.
 */
export async function runChrisChristmasLaunchResetOnce(db,{clock=Date.now,logger=console}={}){
 if(!db?.collection||!db?.runTransaction)throw Error('CHRIS_LAUNCH_RESET_STORAGE_UNAVAILABLE');
 const jobRef=db.collection(CHRIS_CHRISTMAS_LAUNCH_JOBS).doc(CHRIS_CHRISTMAS_LAUNCH_JOB);
 const completed=await jobRef.get();
 if(completed.exists){
  if(completed.data()?.status!=='completed')throw Error('CHRIS_LAUNCH_RESET_JOB_INCONSISTENT');
  return {alreadyReset:true,jobCompleted:true};
 }
 // Bound to the exact profile record, not an unverified nickname in a room.
 // The limit intentionally catches duplicate names instead of guessing a UID.
 const query=await db.collection('player_profiles_v1')
  .where('name','in',['Chris','chris','CHRIS']).limit(3).get();
 const candidates=query.docs||[];
 if(candidates.length!==1)throw Error('CHRIS_LAUNCH_RESET_PROFILE_NOT_UNIQUE');
 const account=candidates[0],uid=account.id,data=account.data();
 if(!validUid(uid)||String(data?.name||'').trim().toLowerCase()!=='chris'||
    (data.uid&&data.uid!==uid))
  throw Error('CHRIS_LAUNCH_RESET_PROFILE_UNVERIFIED');
 // Explicit one-time maintenance instruction: orphaned stale DOG room states
 // must not prevent clearing Chris's personal season. We do not alter rooms.
 const result=await resetChrisChristmasOnce(db,uid,{
  clock,ignoreActiveRooms:true,verifyChrisProfileInTransaction:true
 });
 await db.runTransaction(async tx=>{
  const [job,personalMarker]=await Promise.all([
   tx.get(jobRef),tx.get(markerFor(db,uid))
  ]);
  if(job.exists){
   if(job.data()?.status!=='completed')throw Error('CHRIS_LAUNCH_RESET_JOB_INCONSISTENT');
   return;
  }
  if(!personalMarker.exists||personalMarker.data()?.status!=='completed')
   throw Error('CHRIS_LAUNCH_RESET_PERSONAL_MARKER_MISSING');
  tx.create(jobRef,{
   status:'completed',uid,resetId:CHRIS_CHRISTMAS_RESET_ID,
   completedAt:clock(),cleared:personalMarker.data()?.cleared||0,
   otherPlayersPreserved:true,sharedVillagePreserved:true
  });
 });
 logger?.info?.('[dog-chris-launch-reset] one-time personal restart confirmed; shared village unchanged; cleared documents:',result.cleared);
 return {...result,jobCompleted:true};
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
   // A signed-in Chris can explicitly confirm that his old DOG matches
   // have ended. This bypasses only stale room guards, never identity checks
   // or the one-time marker/archiving rules.
   const completedMatchesConfirmed=req.body?.completedMatchesConfirmed===true;
   const result=await resetChrisChristmasOnce(store(),req.resetChrisUid,{
    clock,...(completedMatchesConfirmed?
     {ignoreActiveRooms:true,verifyChrisProfileInTransaction:true}:{})
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,resetCompleted:true,...result});
  }catch(e){return respondError(res,e);}
 });
}
