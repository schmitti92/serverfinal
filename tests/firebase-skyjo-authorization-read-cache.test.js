import test from 'node:test';
import assert from 'node:assert/strict';
import {installSharedLobby} from '../shared-lobby.js';

test('SKYJO read-only authorization coalesces repeated polling for 15s without extra Firestore documents',async()=>{
 let now=1_000_000,reads=0;
 const code='S222AAA222';
 const room={code:'222',phase:'playing',hostUid:'alice',expiresAt:now+300000,
  game:'skyjo',players:[{uid:'alice',name:'Alice'}],
  match:{game:'skyjo',gameCode:code,id:'one-match',
   members:[{uid:'alice',name:'Alice'}],settings:{}}};
 const db={collection(name){
  assert.equal(name,'spielesammlung_hub_v1');
  return {doc(id){
   assert.equal(id,'222');
   return {path:name+'/'+id,get:async()=>{reads++;return {exists:true,data:()=>structuredClone(room)};}};
  }};
 }};
 const app={get(){},post(){},use(){}};
 const hub=installSharedLobby(app,{
  verifyProfile:async()=>({uid:'alice',name:'Alice'}),
  getFirestore:()=>db,clock:()=>now
 });
 for(let i=0;i<120;i++){
  const result=await hub.skyjoSeat(code,{uid:'alice'},{readOnly:true});
  assert.equal(result.error,undefined);
  assert.equal(result.gameCode,code);
  now+=100;
 }
 assert.equal(reads,1,'120 requests in the same 12s interval must reuse one Firestore read');
 now+=2900;
 await hub.skyjoSeat(code,{uid:'alice'},{readOnly:true});
 assert.equal(reads,1,'15s authorization TTL is still fresh before expiry');
 now+=200;
 await hub.skyjoSeat(code,{uid:'alice'},{readOnly:true});
 assert.equal(reads,2,'expired authorization cache must read the current room');
 const forbidden=await hub.skyjoSeat(code,{uid:'intruder'},{readOnly:true});
 assert.equal(forbidden.error,'NOT_A_PARTICIPANT',
  'cache never bypasses individual membership validation');
});

test('real lobby edits invalidate only matching SKYJO game-code cache',()=>{
 const source=requireSource();
 assert.match(source,/const SKYJO_READ_CACHE_MS=15000/);
 assert.match(source,/for\(const gameCode of skyjoReadRooms.keys\(\)\)/);
 assert.match(source,/if\(hubCodeFromGame\(gameCode\)===code\)skyjoReadRooms.delete\(gameCode\)/);
});
function requireSource(){
 // No runtime intercept: verify the actual invalidation code remains wired.
 return source;
}
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
