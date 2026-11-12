/* S-04 pilot · Per-process, authenticated WebSocket change hints for
 * 100-Tore. Reuses the existing WebSocket server; no game data, tokens,
 * player identifiers or rewards are sent over a notification.
 * Each subscription costs ONE Firestore read to verify current team
 * membership. Actual game state stays behind the protected HTTP API.
 * No polling/Firestore listeners or writes from this module.
 */
import {DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID,bossTeam} from './dog-boss.js';

const validGate=n=>Number.isInteger(n)&&n>=10&&n<=100&&n%10===0;
const MAX_LIFETIME_MS=5*60*1000;
const MAX_SOCKETS_PER_UID=3;
const SUBSCRIBE_TIMEOUT_MS=10000; // unauthenticated sockets must never linger indefinitely

export function createDogBossPushHub({verifyProfile,getFirestore,
 setTimer=setTimeout,clearTimer=clearTimeout}={}){
 const members=new Map();
 const handshakes=new WeakMap();
 const revisions=new Map();
 const json=(ws,value)=>{
  if(ws.readyState!==1||Number(ws.bufferedAmount||0)>131072)return;
  try{ws.send(JSON.stringify(value))}catch{}
 };
 const detach=ws=>{
  const waiting=handshakes.get(ws);
  if(waiting!==undefined){clearTimer(waiting);handshakes.delete(ws)}
  const sub=members.get(ws);
  if(sub?.timer)clearTimer(sub.timer);
  members.delete(ws);
 };
 const denied=ws=>{
  detach(ws);
  json(ws,{type:'error',code:'DENIED'});
  try{ws.close(1008,'DENIED')}catch{}
 };
 function attach(ws){
  // Server-level WS upgrades happen before application authentication.
  // Close idle/slow unauthenticated clients without a DB read or a write.
  const handshakeTimer=setTimer(()=>{if(!members.has(ws))denied(ws)},SUBSCRIBE_TIMEOUT_MS);
  handshakeTimer?.unref?.();
  handshakes.set(ws,handshakeTimer);
  let inflight=false;
  ws.on('message',async data=>{
   if(inflight||members.has(ws))return denied(ws);
   const raw=String(data||'');
   if(raw.length>4096)return denied(ws);
   let m;
   try{m=JSON.parse(raw)}catch{return denied(ws)}
   if(m?.type!=='subscribe'||!validGate(m.gate)||
    typeof m.idToken!=='string'||m.idToken.length>4096)return denied(ws);
   inflight=true;
   try{
    const user=await verifyProfile(m.idToken);
    if(!user?.uid||typeof user.uid!=='string')return denied(ws);
    const db=getFirestore();
    if(!db)return denied(ws);
    const snap=await db.collection(DOG_BOSS_TEAM_COLLECTION).doc(DOG_BOSS_TEAM_ID).get();
    if(!bossTeam(snap.exists?snap.data():null).members.some(p=>p.uid===user.uid))
     return denied(ws);
    const count=[...members.values()].filter(x=>x.uid===user.uid).length;
    if(count>=MAX_SOCKETS_PER_UID)return denied(ws);
    if(ws.readyState!==1)return;
    const handshake=handshakes.get(ws);
    if(handshake!==undefined){clearTimer(handshake);handshakes.delete(ws)}
    const timer=setTimer(()=>{detach(ws);try{ws.close(1000,'REAUTH')}catch{}},
     MAX_LIFETIME_MS);
    timer?.unref?.();
    members.set(ws,{uid:user.uid,gate:m.gate,timer});
    json(ws,{type:'subscribed',gate:m.gate});
   }catch{denied(ws)}
   finally{inflight=false}
  });
  ws.on('close',()=>detach(ws));
  ws.on('error',()=>detach(ws));
 }
 function notify(gate,actorUid=null){
  if(!validGate(gate))return 0;
  const rev=(revisions.get(gate)||0)+1;
  revisions.set(gate,rev);
  let count=0;
  for(const [ws,sub] of members){
   if(sub.gate!==gate||sub.uid===actorUid||ws.readyState!==1)continue;
   // Deliberately no battle, room or user information in the hint.
   json(ws,{type:'changed',seq:rev});
   count++;
  }
  return count;
 }
 return {attach,notify,subscribers:()=>members.size};
}
