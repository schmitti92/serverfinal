/** Authenticated DOG film archive entitlements.
 * Films are public static assets; this governs the in-game archive, never
 * grants a village reward or accepts client-provided progress.
 */
import {dogTreeLevelFromLevels} from './christmas-tree-rewards.js';

export const DOG_VIDEO_LIBRARY_COLLECTION='dog_video_library_seen_v1';
export const DOG_VIDEO_IDS=Object.freeze([
 'welcome','intro','first-light','tree-2','tree-3','tree-4',
 'building-bakery','building-workshop','building-inn',
 'building-tower','building-luckhouse'
]);
const BUILDING_IDS=Object.freeze(['bakery','workshop','inn','tower','luckhouse']);
const watched=(raw)=>Array.isArray(raw?.watched)?[...new Set(
 raw.watched.filter(id=>typeof id==='string'&&DOG_VIDEO_IDS.includes(id))
 )].slice(0,DOG_VIDEO_IDS.length):[];

export function dogVideoLibraryAccess(intro,village,rawWatched){
 // The introductory acknowledgement is profile-specific and verified by
 // Render. A local test/dev slider or a client-supplied tree level is ignored.
 const completed=Number.isSafeInteger(intro?.completedAt)&&intro.completedAt>0;
 const level=completed?dogTreeLevelFromLevels(village):0;
 const available=['welcome'];
 if(completed){
  available.push('intro');
  if((Number(village?.giftsCollected)||0)>0)available.push('first-light');
  for(const stage of [2,3,4])if(level>=stage)available.push('tree-'+stage);
  for(const building of BUILDING_IDS){
   if(Number(village?.levels?.[building])===5)available.push('building-'+building);
  }
 }
 const allowed=new Set(available);
 return {
  available,
  watched:watched(rawWatched).filter(id=>allowed.has(id)),
  treeLevel:level,unlockedCount:available.length,totalCount:DOG_VIDEO_IDS.length
 };
}
export function recordDogVideoSeen(raw,id,available,now){
 if(!DOG_VIDEO_IDS.includes(id))throw Error('VIDEO_UNKNOWN');
 if(!Array.isArray(available)||!available.includes(id))throw Error('VIDEO_LOCKED');
 const prior=watched(raw);
 if(prior.includes(id))return {record:{watched:prior,updatedAt:raw?.updatedAt||0},changed:false};
 return {record:{watched:[...prior,id],updatedAt:now},changed:true};
}
