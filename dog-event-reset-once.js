/** One-time, narrowly scoped 100-Tore launch reset, requested 2026-11-13.
 * Firestore remains authoritative. No DoND payouts, wallet balances, Christmas
 * events, DOG cards or player accounts are modified.
 *
 * Only the current DOG expedition state is cleared. The original data is
 * archived once so an operator can recover it; immutable receipt ledgers stay
 * intact to prevent old payout/action IDs from being credited twice.
 */
import {dogGateProgress,DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID} from './dog-gates.js';
import {bossTeam,DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID} from './dog-boss.js';
import {DOG_MATERIALS_COLLECTION} from './dog-materials.js';
import {DOG_HERO_COLLECTION} from './dog-forge.js';
import {DOG_PREVIEW_COLLECTION} from './dog-private-preview.js';

export const DOG_EVENT_RESET_ID='2026-11-13-first-public-start-v1';
export const DOG_EVENT_RESET_MARKER_COLLECTION='dog_event_maintenance_v1';
export const DOG_EVENT_RESET_BACKUP_COLLECTION='dog_event_reset_archive_v1';
export const DOG_EVENT_RESET_PLAYER_COLLECTIONS=Object.freeze([
 DOG_MATERIALS_COLLECTION,DOG_HERO_COLLECTION,DOG_PREVIEW_COLLECTION
]);

const backupId=path=>DOG_EVENT_RESET_ID+'_'+Buffer.from(path).toString('base64url');
const MAX_DOCUMENTS=3000;
const BATCH_ENTRIES=175; // 2 writes per source, comfortably under Firestore's 500-write limit
function freshTeamFrom(raw){
 // Membership is a roster, not an earned achievement. Keep the three seats;
 // discard character locks, wins, cooldowns and any ongoing boss action.
 const members=bossTeam(raw).members;
 return bossTeam({members});
}
function freshProgress(){
 // Tor 1 / forge level 1 / zero wins, no boss seals or developer bypass.
 return dogGateProgress({people:{},sharedBosses:[],forgeLevel:1,groupBosses:{}});
}
export async function resetDog100ToreOnce(db,log=console){
 if(!db)throw Error('DOG_EVENT_RESET_FIRESTORE_NOT_CONFIGURED');
 const markerRef=db.collection(DOG_EVENT_RESET_MARKER_COLLECTION).doc(DOG_EVENT_RESET_ID);
 const existing=await markerRef.get();
 if(existing.exists&&existing.data()?.status==='completed'){
  log.info?.('[dog-event-reset] already completed; not resetting on this restart');
  return {skipped:true,done:true};
 }
 const now=Date.now();
 const [team,progress,...sets]=await Promise.all([
  db.collection(DOG_BOSS_TEAM_COLLECTION).doc(DOG_BOSS_TEAM_ID).get(),
  db.collection(DOG_GATE_PROGRESS_COLLECTION).doc(DOG_GATE_PROGRESS_ID).get(),
  ...DOG_EVENT_RESET_PLAYER_COLLECTIONS.map(name=>db.collection(name).get())
 ]);
 const entries=[];
 for(const [index,query] of sets.entries()){
  const name=DOG_EVENT_RESET_PLAYER_COLLECTIONS[index];
  for(const doc of query.docs){
   entries.push({path:name+'/'+doc.id,docRef:doc.ref,data:doc.data()});
  }
 }
 const total=entries.length;
 if(total>MAX_DOCUMENTS)throw Error('DOG_EVENT_RESET_LIMIT_EXCEEDED_'+total);
 const archive=db.collection(DOG_EVENT_RESET_BACKUP_COLLECTION);
 let archived=0;
 for(let offset=0;offset<entries.length;offset+=BATCH_ENTRIES){
  const batch=db.batch();
  for(const entry of entries.slice(offset,offset+BATCH_ENTRIES)){
   batch.create(archive.doc(backupId(entry.path)),{
    resetId:DOG_EVENT_RESET_ID,sourcePath:entry.path,
    savedAt:now,data:entry.data
   });
   batch.delete(entry.docRef);
   archived++;
  }
  await batch.commit();
 }
 // One final atomic batch for the shared gate and boss state + completion marker.
 // Repeated start-ups cannot wipe freshly earned progress once the marker exists.
 const batch=db.batch();
 const teamRef=db.collection(DOG_BOSS_TEAM_COLLECTION).doc(DOG_BOSS_TEAM_ID);
 const progressRef=db.collection(DOG_GATE_PROGRESS_COLLECTION).doc(DOG_GATE_PROGRESS_ID);
 if(team.exists){
  batch.create(archive.doc(backupId(DOG_BOSS_TEAM_COLLECTION+'/'+DOG_BOSS_TEAM_ID)),{
   resetId:DOG_EVENT_RESET_ID,sourcePath:DOG_BOSS_TEAM_COLLECTION+'/'+DOG_BOSS_TEAM_ID,
   savedAt:now,data:team.data()
  });
 }
 if(progress.exists){
  batch.create(archive.doc(backupId(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID)),{
   resetId:DOG_EVENT_RESET_ID,sourcePath:DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID,
   savedAt:now,data:progress.data()
  });
 }
 batch.set(teamRef,freshTeamFrom(team.exists?team.data():null));
 batch.set(progressRef,freshProgress());
 batch.set(markerRef,{
  status:'completed',resetId:DOG_EVENT_RESET_ID,
  completedAt:Date.now(),
  playerDocumentsCleared:total,
  teamWasPresent:team.exists,progressWasPresent:progress.exists,
  scopes:[...DOG_EVENT_RESET_PLAYER_COLLECTIONS,DOG_BOSS_TEAM_COLLECTION,DOG_GATE_PROGRESS_COLLECTION]
 });
 await batch.commit();
 log.info?.('[dog-event-reset] completed',{
  playerDocumentsCleared:total,playerDocumentsArchived:archived,
  sharedTeamReset:true,sharedGatesReset:true,otherEventsUnchanged:true
 });
 return {done:true,skipped:false,playerDocumentsCleared:total};
}
