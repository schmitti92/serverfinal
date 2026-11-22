/**
 * P3 PREPARATION ONLY: Postgres-backed private room fan-out with reconnect.
 *
 * The live hub still uses Firestore onSnapshot; this is NOT wired into
 * server.js/shared-lobby.js. Every notification comes from a DURABLY
 * COMMITTED SQL outbox row, never from a speculative in-memory move.
 *
 * A future hub must pass an already verified Firebase Auth identity and use
 * its existing per-player expose() as the project() callback to produce the
 * established browser room protocol. Never send raw Postgres room snapshots.
 */
import {projectPostgresDogState} from './dog-postgres-classic-adapter.js';

const error=code=>Object.assign(new Error(code),{code});
export function createDogPostgresPrivateFanout({
  store,project=projectPostgresDogState,sendPayload=(send,view)=>send({type:'room',room:view})
}={}){
 if(!store||!['getRoom','pendingEvents','acknowledgeEvent'].every(k=>typeof store[k]==='function')||
    typeof project!=='function'||typeof sendPayload!=='function')
  throw new TypeError('Durable DOG store and private projection are required');
 const listeners=new Map();
 const counts={subscriptions:0,snapshots:0,delivered:0,duplicates:0,
  revoked:0,failed:0,acknowledged:0,staleEvents:0};
 let inFlight=null;

 function remove(record){
  record.active=false;
  const group=listeners.get(record.code);
  group?.delete(record);
  if(group?.size===0)listeners.delete(record.code);
 }
 function deliver(record,room){
  const promise=record.queue.catch(()=>{}).then(async()=>{
   if(!record.active)return;
   if(!room?.players?.some(p=>p.uid===record.uid)||
      room?.match?.game!=='dog'){
    counts.revoked++;
    remove(record);
    return;
   }
   const revision=Number(room.revision);
   if(!Number.isSafeInteger(revision)||revision<0)
    throw error('DOG_BAD_DURABLE_VERSION');
   if(revision<=record.lastRevision){counts.duplicates++;return;}
   // The callback is trusted server-side only; the viewer UID never comes
   // from an unauthenticated client message at this stage.
   const privateView=project(room,record.uid);
   await sendPayload(record.send,privateView);
   record.lastRevision=revision;
   counts.delivered++;
  });
  record.queue=promise;
  return promise;
 }
 async function subscribe({code,identity,send}={}){
  if(typeof code!=='string'||!identity||typeof identity.uid!=='string'||
     !identity.uid||typeof send!=='function')
   throw error('DOG_SOCKET_AUTH_REQUIRED');
  const record={code,uid:identity.uid,send,active:true,lastRevision:-1,
   queue:Promise.resolve()};
  let group=listeners.get(code);
  if(!group){group=new Set();listeners.set(code,group)}
  group.add(record);
  try{
   // Subscribe FIRST, then read latest durable state. If a commit races with
   // this read, the subscriber's per-socket queue/monotonic revision prevents
   // an older snapshot from overwriting a newer one.
   const current=await store.getRoom(code);
   if(!current?.room?.players?.some(p=>p.uid===identity.uid)||
      current.room.match?.game!=='dog')throw error('DOG_NOT_A_ROOM_MEMBER');
   await deliver(record,current.room);
   if(!record.active)throw error('DOG_NOT_A_ROOM_MEMBER');
   counts.subscriptions++;
   return ()=>remove(record);
  }catch(e){remove(record);throw e}
 }
 async function drain({limit=100}={}){
  const events=await store.pendingEvents(limit);
  const recent=new Map();
  let seen=0;
  for(const event of events){
   // No room/game cards are included in this event. Get the confirmed
   // private game state from the durable database, once per room per batch.
   const code=event.room_code;
   if(!recent.has(code))recent.set(code,await store.getRoom(code));
   const current=recent.get(code);
   if(!current?.room||
      current.room.match?.id!==event.match_id){
    // An expired/deleted/archived room is no longer deliverable. A newly
    // connected client must get a fresh live match, never an old event.
    counts.staleEvents++;
    await store.acknowledgeEvent(Number(event.event_id));
    counts.acknowledged++;
    seen++;
    continue;
   }
   const version=Number(current.version);
   if(!Number.isSafeInteger(version)||version<Number(event.room_version))
    throw error('DOG_OUTBOX_AHEAD_OF_DURABLE_ROOM');
   counts.snapshots++;
   const deliveries=[...(listeners.get(code)||[])].map(s=>deliver(s,current.room));
   const outcomes=await Promise.allSettled(deliveries);
   if(outcomes.some(o=>o.status==='rejected')){
    counts.failed++;
    // Successful clients suppress the retry using their lastRevision.
    // A disconnected client may unsubscribe and later recover the entire
    // latest state using subscribe(), without a special Firebase read.
    break;
   }
   await store.acknowledgeEvent(Number(event.event_id));
   counts.acknowledged++;
   seen++;
  }
  return {processed:seen,pending:events.length-seen};
 }
 async function pollOnce(options){
  if(inFlight)return inFlight;
  const task=drain(options);
  inFlight=task;
  try{return await task}finally{if(inFlight===task)inFlight=null}
 }
 function stats(){
  let sockets=0;
  for(const members of listeners.values())sockets+=members.size;
  // Only anonymous totals, never room code, UID or concealed card data.
  return {...counts,activeRooms:listeners.size,activeSockets:sockets};
 }
 return {subscribe,pollOnce,stats};
}
