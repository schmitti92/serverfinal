/**
 * Meta-Sammelalbum · Weihnachtskapitel 1 (aktive DOG-Sammelsaison 2).
 *
 * The nine pictures are non-consumable cosmetics automatically owned when
 * the EXISTING server-authoritative 2,4,...,18-Bingo rewards have been CLAIMED.
 * Uses the durable bingoRewardsClaimed map in the DOG season-2 profile.
 * Reading this catalogue never modifies Firestore and cannot issue a reward.
 */
export const DOG_META_ALBUM_MILESTONES=Object.freeze(Array.from({length:9},(_,index)=>{
 const number=index+1;
 return Object.freeze({
  id:'meta-christmas1-'+String(number).padStart(2,'0'),
  unlockId:'meta:christmas1:picture:'+String(number).padStart(2,'0'),
  at:number*2
 });
}));
const validClaimedAt=value=>Number.isSafeInteger(value)&&value>0?value:0;
export function dogMetaAlbumStatus(bingos=0,claimed={}){
 const count=Number.isSafeInteger(bingos)&&bingos>=0?Math.min(60,bingos):0;
 const receipts=claimed&&typeof claimed==='object'&&!Array.isArray(claimed)?claimed:{};
 const milestones=DOG_META_ALBUM_MILESTONES.map(m=>{
  const claimedAt=validClaimedAt(receipts[String(m.at)]);
  const state=claimedAt?'unlocked':count>=m.at?'ready':'locked';
  return {...m,state,claimedAt};
 });
 const unlocked=milestones.filter(m=>m.state==='unlocked');
 const next=milestones.find(m=>m.state!=='unlocked');
 return {version:1,eventId:'weihnachtsevent-1',source:'dog-season-2-bingo-rewards',
  total:milestones.length,unlockedCount:unlocked.length,
  unlockedIds:unlocked.map(m=>m.unlockId),
  bingos:count,nextAt:next?.at??null,milestones};
}
