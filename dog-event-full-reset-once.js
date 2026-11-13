/**
 * One-off, auditable reset of the entire DOG 100-Tore and DOG Season-2 event
 * for EVERY profile. Explicitly requested 2026-11-13.
 *
 * Deletes earned gate/boss history, team/roster, forge and materials, chests,
 * DOG S2 album cards/bingo/cycles/tournament data and every monthly DOG S2
 * leaderboard. Resets the two DOG shared documents to fresh game defaults.
 *
 * Does NOT change wallets, purchased items, player accounts, Deal or No Deal
 * matches/payouts, separate Christmas Event/Hammer Bingo/cards or other games.
 * Historical immutable receipt ledgers are intentionally retained to prevent
 * previously claimed prizes from being minted twice on replays.
 *
 * Every changed document is archived WITH its full original data before it is
 * deleted/overwritten. An idempotent marker prevents repeating on redeploy.
 * Completed batches are atomic. A failed partial run can resume safely.
 */
import {dogGateProgress,DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID} from './dog-gates.js';
import {bossTeam,DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID} from './dog-boss.js';
import {DOG_MATERIALS_COLLECTION} from './dog-materials.js';
import {DOG_HERO_COLLECTION} from './dog-forge.js';
import {DOG_PREVIEW_COLLECTION} from './dog-private-preview.js';
import {DOG_S2_COLLECTION,DOG_S2_TOURNAMENT_COLLECTION} from './dog-album-season2.js';
import {DOG_LIVE_PILOT_COLLECTION,DOG_LIVE_PILOT_ID} from './dog-live-bots.js';

export const DOG_FULL_RESET_ID='2026-11-13-full-dog-event-reset-v2';
export const DOG_FULL_RESET_MARKER_COLLECTION='dog_event_maintenance_v1';
export const DOG_FULL_RESET_ARCHIVE_COLLECTION='dog_event_reset_archive_v1';
export const DOG_FULL_RESET_PLAYER_COLLECTIONS=Object.freeze([
 DOG_MATERIALS_COLLECTION,DOG_HERO_COLLECTION,DOG_PREVIEW_COLLECTION,
 DOG_S2_COLLECTION
]);
export const DOG_FULL_RESET_GLOBAL_PATHS=Object.freeze([
 DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID,
 DOG_BOSS_TEAM_COLLECTION+'/'+DOG_BOSS_TEAM_ID,
 DOG_LIVE_PILOT_COLLECTION+'/'+DOG_LIVE_PILOT_ID
]);
const archiveKey=path=>DOG_FULL_RESET_ID+'_'+Buffer.from(path).toString('base64url');
const MAX_DOCS=10000;
const BATCH_SOURCE_DOCS=175; // two writes per document, below 500 Firestore writes
const tournamentCollection=name=>name.startsWith(DOG_S2_TOURNAMENT_COLLECTION+'_')&&
 /^\d{4}-\d{2}$/.test(name.slice(DOG_S2_TOURNAMENT_COLLECTION.length+1));

export async function resetFullDogEventOnce(db,log=console){
 if(!db||typeof db.listCollections!=='function')
  throw Error('DOG_FULL_RESET_FIRESTORE_UNAVAILABLE');
 const marker=db.collection(DOG_FULL_RESET_MARKER_COLLECTION).doc(DOG_FULL_RESET_ID);
 const oldMarker=await marker.get();
 if(oldMarker.exists&&oldMarker.data()?.status==='completed'){
  log.info?.('[dog-full-reset] already completed; no repeat on restart');
  return {done:true,skipped:true,resetId:DOG_FULL_RESET_ID};
 }
 // Enumerate historical month-specific leaderboards; not just this month.
 const roots=await db.listCollections();
 const rankingCollections=roots.map(collection=>collection.id)
  .filter(tournamentCollection).sort();
 const collections=[...new Set([...DOG_FULL_RESET_PLAYER_COLLECTIONS,...rankingCollections])];
 const sharedRefs=DOG_FULL_RESET_GLOBAL_PATHS.map(path=>db.doc(path));
 const [shared,...snapshots]=await Promise.all([
  Promise.all(sharedRefs.map(ref=>ref.get())),
  ...collections.map(name=>db.collection(name).get())
 ]);
 const entries=[];
 for(let i=0;i<collections.length;i++){
  for(const doc of snapshots[i].docs){
   entries.push({sourcePath:collections[i]+'/'+doc.id,ref:doc.ref,data:doc.data()});
  }
 }
 if(entries.length>MAX_DOCS)throw Error('DOG_FULL_RESET_LIMIT_EXCEEDED_'+entries.length);
 const archive=db.collection(DOG_FULL_RESET_ARCHIVE_COLLECTION);
 const now=Date.now();
 let archived=0;
 for(let offset=0;offset<entries.length;offset+=BATCH_SOURCE_DOCS){
  const batch=db.batch();
  for(const entry of entries.slice(offset,offset+BATCH_SOURCE_DOCS)){
   batch.create(archive.doc(archiveKey(entry.sourcePath)),{
    resetId:DOG_FULL_RESET_ID,sourcePath:entry.sourcePath,
    savedAt:now,data:entry.data
   });
   batch.delete(entry.ref);
   archived++;
  }
  await batch.commit();
 }
 // Commit the shared reset and completion marker ATOMICALLY, after every
 // per-player DOG inventory/card/tournament entry has been archived.
 const batch=db.batch();
 for(let i=0;i<sharedRefs.length;i++){
  if(shared[i].exists){
   const path=DOG_FULL_RESET_GLOBAL_PATHS[i];
   batch.create(archive.doc(archiveKey(path)),{
    resetId:DOG_FULL_RESET_ID,sourcePath:path,
    savedAt:now,data:shared[i].data()
   });
  }
 }
 batch.set(sharedRefs[0],dogGateProgress({
  people:{},sharedBosses:[],forgeLevel:1,groupBosses:{}
 }));
 batch.set(sharedRefs[1],bossTeam(null)); // Fresh roster; no test bots or locks.
 batch.delete(sharedRefs[2]); // Release historical pilot/test-bot ownership.
 batch.set(marker,{
  status:'completed',resetId:DOG_FULL_RESET_ID,completedAt:Date.now(),
  playerDocsCleared:entries.length,playerDocsArchived:archived,
  leaderboardCollections:rankingCollections,
  collectionsCleared:collections,
  sharedDocsReset:DOG_FULL_RESET_GLOBAL_PATHS,
  otherGamesUnaffected:true
 });
 await batch.commit();
 log.info?.('[dog-full-reset] completed '+JSON.stringify({
  resetId:DOG_FULL_RESET_ID,playerDocsCleared:entries.length,
  playerDocsArchived:archived,leaderboardsCleared:rankingCollections.length,
  newSharedProgress:'Tor 1',teamRoster:'empty',dogCards:'cleared',
  resources:'cleared',otherGamesUnaffected:true
 }));
 return {done:true,skipped:false,resetId:DOG_FULL_RESET_ID,
  playerDocsCleared:entries.length,leaderboardsCleared:rankingCollections.length};
}
