// Personal DOG Classic lifetime statistics. All counters are server-owned.
// Moves are collected in the existing room document and committed to personal
// profiles once per finished match; no additional Firestore writes per move.
export const DOG_PLAYER_STATS_COLLECTION='dog_player_statistics_v1';

const nonnegative=n=>Number.isSafeInteger(n)&&n>=0?n:0;
export function newDogMatchCounters(){
 return {seats:Array.from({length:4},()=>({knockedOut:0,wasKnockedOut:0})),recorded:false};
}
export function countDogKnockouts(match,before,after,actorSeat){
 if(!match.dogCounters)match.dogCounters=newDogMatchCounters();
 if(!before?.pieces||!after?.pieces||!Number.isInteger(actorSeat)||actorSeat<0||actorSeat>3)return;
 const next=new Map(after.pieces.map(p=>[p.id,p]));
 for(const p of before.pieces){
  const current=next.get(p.id);
  // Only actual removals from the track to home. Swapping positions, goal
  // entry, seven-card starts and ordinary home pieces never count.
  if(p.place!=='track'||current?.place!=='home'||!Number.isInteger(p.owner))continue;
  const victim=match.dogCounters.seats[p.owner];
  if(!victim)continue;
  victim.wasKnockedOut++;
  // An acting player receives a knockout only when another player's pawn
  // was removed, not when a card accidentally removed their own pawn.
  if(p.owner!==actorSeat)match.dogCounters.seats[actorSeat].knockedOut++;
 }
}
export function dogPlayerStats(raw,uid){
 const d=raw&&typeof raw==='object'?raw:{};
 return {uid,played:nonnegative(d.played),wins:nonnegative(d.wins),
  knockedOut:nonnegative(d.knockedOut),wasKnockedOut:nonnegative(d.wasKnockedOut)};
}
export function dogCompletedPlayerStats(raw,uid,displayName,seat,counters,winner,matchId,now){
 const old=dogPlayerStats(raw,uid);
 const v=counters?.seats?.[seat]||{};
 const win=winner===seat%2?1:0;
 return {...old,name:String(displayName||'Spieler').slice(0,48),
  played:old.played+1,wins:old.wins+win,
  knockedOut:old.knockedOut+nonnegative(v.knockedOut),
  wasKnockedOut:old.wasKnockedOut+nonnegative(v.wasKnockedOut),
  lastMatchId:matchId,updatedAt:now};
}
