/**
 * An authoritative game snapshot is durable only when its gameplay state,
 * seat ownership or host rights have changed. Firestore server timestamps,
 * packet times and monotonically increasing save revisions are not gameplay.
 *
 * This deliberately does NOT cache rewards, money, or changes across servers.
 * A caller must only remember a fingerprint after its write succeeded.
 */
import {createHash} from 'node:crypto';

export function barikadeWriteFingerprint(state, seats=[], hostToken=null){
 if(!state||typeof state!=='object'||Array.isArray(state))return null;
 const {rev,...game}=state;
 // "lastSeen" is presence/transport data, not seat ownership. It may change
 // on reconnect every few seconds without changing anyone's playable seat.
 const players=(Array.isArray(seats)?seats:[]).map(seat=>({
  sessionToken:String(seat?.sessionToken||''),
  profileUid:seat?.profileUid||null,
  name:seat?.name||'',
  color:seat?.color||'',
  diceStyle:seat?.diceStyle||'',
  isHost:seat?.isHost===true
 })).sort((a,b)=>a.sessionToken.localeCompare(b.sessionToken)||
  a.color.localeCompare(b.color));
 return createHash('sha256').update(JSON.stringify([game,players,hostToken||null])).digest('hex');
}
