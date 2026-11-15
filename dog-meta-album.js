/** DOG Lichtertal meta-album rewards, authenticated read-only status.
 * IMPORTANT: the Lichtertal event is still a visual preview. Its local sliders
 * are never evidence of ownership and must NOT be sent to this endpoint.
 * A future trusted event upgrade transaction must maintain monotonically
 * increasing highestBuildingLevels and highestTreeLevel on the server.
 */
export const DOG_META_ALBUM_MILESTONES=Object.freeze([
 Object.freeze({id:'meta-christmas1-01',unlockId:'meta:christmas1:picture:01',name:'Weihnachtsbaum',kind:'tree',requiredLevel:10}),
 Object.freeze({id:'meta-christmas1-02',unlockId:'meta:christmas1:picture:02',name:'Weihnachtsbäckerei',kind:'building',buildingId:'bakery',requiredLevel:5}),
 Object.freeze({id:'meta-christmas1-03',unlockId:'meta:christmas1:picture:03',name:'Wichtelwerkstatt',kind:'building',buildingId:'workshop',requiredLevel:5}),
 Object.freeze({id:'meta-christmas1-04',unlockId:'meta:christmas1:picture:04',name:'Weihnachtslichter-Turm',kind:'building',buildingId:'tower',requiredLevel:5}),
 Object.freeze({id:'meta-christmas1-05',unlockId:'meta:christmas1:picture:05',name:'Friedensherberge',kind:'building',buildingId:'inn',requiredLevel:5}),
 Object.freeze({id:'meta-christmas1-06',unlockId:'meta:christmas1:picture:06',name:'Geschenkefabrik',kind:'planned',requiredLevel:null}),
 Object.freeze({id:'meta-christmas1-07',unlockId:'meta:christmas1:picture:07',name:'Weihnachtsmarkt',kind:'planned',requiredLevel:null}),
 Object.freeze({id:'meta-christmas1-08',unlockId:'meta:christmas1:picture:08',name:'Lebkuchenhaus',kind:'planned',requiredLevel:null}),
 Object.freeze({id:'meta-christmas1-09',unlockId:'meta:christmas1:picture:09',name:'Rentierstall',kind:'planned',requiredLevel:null}),
 Object.freeze({id:'meta-christmas1-10',unlockId:'meta:christmas1:picture:10',name:'Schneemannplatz',kind:'planned',requiredLevel:null}),
 Object.freeze({id:'meta-christmas1-11',unlockId:'meta:christmas1:picture:11',name:'Schlittenwerkstatt',kind:'planned',requiredLevel:null}),
 Object.freeze({id:'meta-christmas1-12',unlockId:'meta:christmas1:picture:12',name:'Weihnachtspostamt',kind:'planned',requiredLevel:null})
]);
const positiveLevel=n=>Number.isSafeInteger(n)&&n>=0?Math.min(n,10):0;
export function dogMetaAlbumStatus(officialProgress={}){
 const levels=officialProgress&&typeof officialProgress==='object'&&!Array.isArray(officialProgress)?officialProgress:{};
 const buildings=levels.highestBuildingLevels&&typeof levels.highestBuildingLevels==='object'&&!Array.isArray(levels.highestBuildingLevels)?levels.highestBuildingLevels:{};
 const tree=positiveLevel(levels.highestTreeLevel);
 const milestones=DOG_META_ALBUM_MILESTONES.map(m=>{
  const level=m.kind==='tree'?tree:m.kind==='building'?positiveLevel(buildings[m.buildingId]):0;
  const unlocked=m.requiredLevel!==null&&level>=m.requiredLevel;
  return {...m,level,state:unlocked?'unlocked':'locked'};
 });
 const unlocked=milestones.filter(m=>m.state==='unlocked');
 return {
  version:2,eventId:'weihnachtsevent-1',source:'dog-lichtertal-event',
  total:milestones.length,unlockedCount:unlocked.length,
  unlockedIds:unlocked.map(m=>m.unlockId),
  milestones
 };
}
