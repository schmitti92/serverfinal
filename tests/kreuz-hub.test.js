import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {runInNewContext} from 'node:vm';
// This regression test isolates the KreuzKunter engine already embedded in server.js.
const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const begin=source.indexOf('const createKreuzKunter = (() => {');
const end=source.indexOf('\n})();',begin);
assert(begin>=0&&end>begin,'KreuzKunter engine must remain detectable in server.js');
const createKreuz=runInNewContext(source.slice(begin,end+6)+'\ncreateKreuzKunter;',{
 kkRandomBytes:randomBytes,Buffer,Date,process,console,setTimeout,clearTimeout
});

function makeStore(){
 const docs=new Map();let pending=Promise.resolve();
 const snapshot=v=>({exists:!!v,data:()=>structuredClone(v)});
 return {docs,collection(name){return {doc(code){const path=name+'/'+code;return {path,get:async()=>snapshot(docs.get(path)),set:async value=>{docs.set(path,structuredClone(value));}};}};},
 async runTransaction(fn){
  const job=pending.catch(()=>{}).then(async()=>{
   const ops=[];
   const tx={get:async ref=>snapshot(docs.get(ref.path)),set:(ref,value)=>ops.push(()=>docs.set(ref.path,structuredClone(value)))};
   const value=await fn(tx);ops.forEach(f=>f());return value;
  });pending=job.catch(()=>{});return job;
 }};
}
function socket(){
 const callbacks=new Map(),responses=[];
 const ws={readyState:1,responses,on:(name,fn)=>callbacks.set(name,fn),send:s=>responses.push(JSON.parse(s)),close(){ws.readyState=3;callbacks.get('close')?.();},receive(m){callbacks.get('message')?.(Buffer.from(JSON.stringify(m)));}};
 return ws;
}
const pause=()=>new Promise(r=>setTimeout(r,28));
const alice={uid:'alice-uid',name:'Alice'};
const bob={uid:'bob-uid',name:'Bob'};
const outsider={uid:'outsider',name:'Cara'};
function rig(){
 const store=makeStore();
 const match={game:'kreuz',gameCode:'KABC23DAAA',id:'87b978de-1234-4000-9a33-aabbccdd0012'};
 const seat={hubCode:'ABC23D',gameCode:match.gameCode,matchId:match.id,hostUid:alice.uid,
  members:[{uid:alice.uid,name:alice.name},{uid:bob.uid,name:bob.name}]};
 const create=()=>createKreuz({getFirestore:()=>store,verifyProfile:async token=>({alice,bob,cara:outsider}[token]||null),
  recordStats:async()=>{},hubSeat:async(code,profile)=>code===match.gameCode&&[alice.uid,bob.uid].includes(profile.uid)?seat:{error:'NOT_A_PARTICIPANT'}});
 return {store,match,seat,create};
}
test('Two simultaneous hub joins create exactly one authenticated, ready game',async()=>{
 const h=rig(),server=h.create(),a=socket(),b=socket();
 server.handle(a);server.handle(b);
 b.receive({action:'hubJoin',gameCode:h.match.gameCode,matchId:h.match.id,profileIdToken:'bob'});
 a.receive({action:'hubJoin',gameCode:h.match.gameCode,matchId:h.match.id,profileIdToken:'alice'});
 await pause();
 const room=server.rooms.get(h.match.gameCode);
 assert(room,'Kreuz room exists after hub handshake');
 assert.equal(room.players.length,2);
 assert.equal(room.hubMatchId,h.match.id);
 assert.equal(room.phase,'ready','ready votes in hub replace in-game start button');
 assert.equal(room.players.find(p=>p.id===room.host).profileUid,alice.uid);
 assert(a.responses.some(r=>r.type==='welcome'));
 assert(b.responses.some(r=>r.type==='welcome'));
 assert.equal(a.responses.find(r=>r.type==='state')?.game.phase,'ready');
 assert.equal(b.responses.find(r=>r.type==='state')?.game.phase,'ready');
 assert.equal(h.store.docs.size,1,'single Firestore document');
 a.receive({action:'start'});await pause();
 assert(a.responses.some(r=>r.type==='error'&&/gemeinsamen Raum/.test(r.message)));
 assert.equal(room.phase,'ready');
});
test('Outsiders, wrong match IDs and old join tokens cannot enter hub game',async()=>{
 const h=rig(),server=h.create(),a=socket();server.handle(a);
 a.receive({action:'hubJoin',gameCode:h.match.gameCode,matchId:h.match.id,profileIdToken:'alice'});await pause();
 const fake=socket();server.handle(fake);
 fake.receive({action:'hubJoin',gameCode:h.match.gameCode,matchId:h.match.id,profileIdToken:'cara'});await pause();
 assert(fake.responses.some(r=>r.type==='error'&&r.message==='NOT_A_PARTICIPANT'));
 const bad=socket();server.handle(bad);
 bad.receive({action:'hubJoin',gameCode:h.match.gameCode,matchId:'00000000-0000-4000-9000-000000000001',profileIdToken:'bob'});await pause();
 assert(bad.responses.some(r=>r.type==='error'&&r.message==='MATCH_NOT_FOUND'));
 const token=a.responses.find(r=>r.type==='welcome').token;
 const legacy=socket();server.handle(legacy);
 legacy.receive({action:'join',code:h.match.gameCode,token,boardId:'KK-2026-V6-STAR-EQUAL',profileIdToken:'cara'});await pause();
 assert(!legacy.responses.some(r=>r.type==='welcome'));
});
test('Hub players reconnect by Firebase identity after engine restarts',async()=>{
 const h=rig(),server=h.create(),bobSock=socket();server.handle(bobSock);
 bobSock.receive({action:'hubJoin',gameCode:h.match.gameCode,matchId:h.match.id,profileIdToken:'bob'});await pause();
 const first=bobSock.responses.find(r=>r.type==='welcome');assert(first);
 bobSock.close();await pause();
 const restarted=h.create(),again=socket();restarted.handle(again);
 again.receive({action:'hubJoin',gameCode:h.match.gameCode,matchId:h.match.id,profileIdToken:'bob'});await pause();
 assert.equal(again.responses.find(r=>r.type==='welcome')?.token,first.token);
 const room=restarted.rooms.get(h.match.gameCode);
 assert.equal(room.players.length,2);
 assert.equal(room.players.find(p=>p.id===room.host).profileUid,alice.uid);
 assert.equal(await restarted.isHubMatchFinished(h.match),false);
 room.phase='over';room.finished=true;
 assert.equal(await restarted.isHubMatchFinished(h.match),true);
 assert.equal(await restarted.isHubMatchFinished({...h.match,id:'wrong'}),false);
});
