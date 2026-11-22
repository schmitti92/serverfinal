import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createGame,legalActions} from '../dog/engine.js';
import {newDogMatchCounters} from '../dog/player-stats.js';
import {createDogPostgresRoomStore} from '../dog-postgres-room-store.js';
import {createDogPostgresFinalization} from '../dog-postgres-finalization.js';
import {createDogPostgresXpSettlementBridge,
 DOG_PG_MATCH_RECEIPTS_COLLECTION} from '../dog-postgres-xp-settlement.js';

const clone=v=>structuredClone(v);
const ID='7d933478-7081-4a6d-893b-17fd93002111';
function fakePg(){
 const state={rooms:new Map(),pending:new Map(),actions:new Map(),outbox:[],serial:0};
 const metrics={commits:0,rollbacks:0,connections:0,releases:0,sql:[]};
 let failOn='';
 function query(s,sql,p=[]){
  metrics.sql.push({sql,params:clone(p)});
  if(failOn&&sql.startsWith(failOn))throw Error('SIMULATED_PG_FAILURE');
  if(sql.startsWith('INSERT INTO dog_room_states')){
   if(s.rooms.has(p[0]))return {rows:[],rowCount:0};
   s.rooms.set(p[0],{match_id:p[1],version:p[2],snapshot:JSON.parse(p[3]),
    expires_at_ms:p[4],updated_at_ms:p[5]});
   return {rows:[{match_id:p[1],version:p[2]}],rowCount:1};
  }
  if(sql.startsWith('SELECT snapshot,version,expires_at_ms FROM dog_room_states')){
   const r=s.rooms.get(p[0]);return {rows:r?[clone(r)]:[],rowCount:r?1:0};
  }
  if(sql.startsWith('SELECT match_id,version FROM dog_room_states')){
   const r=s.rooms.get(p[0]);return {rows:r?[clone(r)]:[],rowCount:r?1:0};
  }
  if(sql.startsWith('SELECT snapshot,version,match_id,expires_at_ms FROM dog_room_states')){
   const r=s.rooms.get(p[0]);return {rows:r?[clone(r)]:[],rowCount:r?1:0};
  }
  if(sql.startsWith('SELECT finished_snapshot,finished_at_ms FROM dog_room_pending_finishes')){
   const r=s.pending.get(p[0]);
   const found=r&&r.match_id===p[1]?r:null;
   return {rows:found?[clone(found)]:[],rowCount:found?1:0};
  }
  if(sql.startsWith('SELECT ')&&sql.includes(' FROM dog_room_pending_finishes')){
   const r=s.pending.get(p[0]);
   return {rows:r?[clone(r)]:[],rowCount:r?1:0};
  }
  if(sql.startsWith('INSERT INTO dog_room_pending_finishes')){
   if(s.pending.has(p[0]))throw Error('PG_PENDING_CONFLICT');
   s.pending.set(p[0],{room_code:p[0],match_id:p[1],action_id:p[2],
    actor_uid:p[3],request_hash:p[4],base_version:p[5],
    finished_snapshot:JSON.parse(p[6]),finished_at_ms:p[7],
    fingerprint:p[8],created_at_ms:p[9]});
   return {rows:[],rowCount:1};
  }
  if(sql.startsWith('DELETE FROM dog_room_pending_finishes')){
   const row=s.pending.get(p[0]);
   if(row?.match_id===p[1])s.pending.delete(p[0]);
   return {rows:[],rowCount:row?1:0};
  }
  if(sql.startsWith('SELECT request_hash,room_version FROM dog_room_actions')){
   const r=s.actions.get(p.slice(0,3).join('|'));
   return {rows:r?[clone(r)]:[],rowCount:r?1:0};
  }
  if(sql.startsWith('UPDATE dog_room_states SET')){
   const row=s.rooms.get(p[0]);
   if(!row||row.version!==p[5])return {rows:[],rowCount:0};
   s.rooms.set(p[0],{...row,snapshot:JSON.parse(p[1]),version:p[2],
    expires_at_ms:p[3],updated_at_ms:p[4]});
   return {rows:[],rowCount:1};
  }
  if(sql.startsWith('INSERT INTO dog_room_actions')){
   const key=p.slice(0,3).join('|');
   if(s.actions.has(key))throw Error('PG_DUPLICATE_ACTION');
   s.actions.set(key,{room_code:p[0],match_id:p[1],action_id:p[2],
    actor_uid:p[3],request_hash:p[4],room_version:p[5]});
   return {rows:[],rowCount:1};
  }
  if(sql.startsWith('INSERT INTO dog_room_outbox')){
   s.outbox.push({event_id:++s.serial,room_code:p[0],match_id:p[1],
    action_id:p[2],room_version:p[3],topic:p[4]});
   return {rows:[],rowCount:1};
  }
  if(sql.startsWith('SELECT event_id,room_code,match_id,room_version,topic FROM dog_room_outbox')){
   return {rows:clone(s.outbox.slice(0,p[0])),rowCount:s.outbox.length};
  }
  throw Error('UNKNOWN_PG_SQL '+sql);
 }
 const pool={
  async query(sql,p){return query(state,sql,p)},
  async connect(){
   metrics.connections++;
   const txState=()=>({
    rooms:new Map([...state.rooms].map(([k,v])=>[k,clone(v)])),
    pending:new Map([...state.pending].map(([k,v])=>[k,clone(v)])),
    actions:new Map([...state.actions].map(([k,v])=>[k,clone(v)])),
    outbox:clone(state.outbox),serial:state.serial
   });
   let tx=null;
   return {
    async query(sql,p){
     if(sql==='BEGIN'){tx=txState();return {rows:[],rowCount:0};}
     if(sql==='COMMIT'){
      if(!tx)throw Error('PG_NO_BEGIN');
      Object.assign(state,tx);tx=null;metrics.commits++;
      return {rows:[],rowCount:0};
     }
     if(sql==='ROLLBACK'){tx=null;metrics.rollbacks++;return {rows:[],rowCount:0};}
     if(!tx)throw Error('PG_NO_TRANSACTION');
     return query(tx,sql,p);
    },
    release(){metrics.releases++;}
   };
  }
 };
 return {pool,state,metrics,setFail(prefix=''){failOn=prefix}};
}
function fakeFirestore(){
 const docs=new Map(),metrics={reads:0,writes:0,transactions:0};
 let fail=false;
 const db={
  collection:name=>({doc:id=>({path:name+'/'+id})}),
  async runTransaction(fn){
   metrics.transactions++;
   const writes=[],tx={
    async get(ref){
     metrics.reads++;const value=docs.get(ref.path);
     return {exists:value!==undefined,data:()=>clone(value)};
    },
    set(ref,value){writes.push([ref.path,clone(value)]);}
   };
   const result=await fn(tx);
   if(fail)throw Error('FAKE_FIRESTORE_OFFLINE');
   for(const [path,value]of writes){docs.set(path,value);metrics.writes++;}
   return result;
  }
 };
 return {db,docs,metrics,offline(value){fail=value}};
}
function winningFixture(){
 const roster=['alice','bob','cara'].map((uid,seat)=>({
  uid,name:uid,seat,bot:false,inactive:false
 }));
 roster.push({uid:null,name:'Freier Platz',seat:3,bot:false,inactive:true});
 const dog=createGame({names:roster.map(x=>x.name),bots:[false,false,false,false],
  inactiveSeats:[3],rng:()=>0.5});
 dog.phase='play';dog.current=0;dog.starter=0;dog.revision=42;
 dog.hands=[[{id:7777,type:'2'}],[],[],[]];
 dog.exchanges=[null,null,null,true];
 for(const p of dog.pieces.filter(p=>p.owner===0)){
  if(p.id===3){p.place='track';p.pos=63;}
  else{p.place='goal';p.pos=p.id+1;}
 }
 const move=legalActions(dog,0).find(m=>m.type==='move'&&
  m.cardId===7777&&m.pieceId===3&&m.steps===2&&m.viaGoal===true);
 assert.ok(move,'finishing action must be valid according to actual DOG rules');
 return {move,room:{
  code:'123',revision:10,phase:'playing',game:'dog',createdAt:1,
  updatedAt:1000,expiresAt:10000000,hostUid:'alice',
  players:roster.filter(p=>!p.inactive).map(p=>({uid:p.uid,name:p.name,participating:true})),
  match:{id:ID,game:'dog',dogRoster:roster,
   members:roster.filter(p=>!p.inactive).map(p=>({uid:p.uid})),
   dogChristmasEligibilityChecked:true,christmas:null,
   dogCommands:[],dogCounters:newDogMatchCounters(),dog}
 }};
}
const authorization=async r=>{
 if(!r.players.some(p=>p.uid==='alice'))throw Error('NOT_MEMBER');
};
function fixture(){
 const pg=fakePg(),fire=fakeFirestore();
 const clock=()=>2000000;
 const state=createDogPostgresRoomStore({pool:pg.pool,clock});
 const fin=createDogPostgresFinalization({pool:pg.pool,clock});
 const bridge=createDogPostgresXpSettlementBridge({
  getFirestore:()=>fire.db,loadPendingMatch:fin.loadPendingMatch,
  markComplete:fin.markComplete,clock
 });
 const {room,move}=winningFixture();
 const request={code:'123',matchId:ID,uid:'alice',
  actionId:'pg-final-step-0001',expectedDogRevision:42,
  action:move,authorize:authorization};
 return {pg,fire,state,fin,bridge,room,move,request};
}

test('A winning DOG move is safely staged, but no result is published or XP paid yet',async()=>{
 const h=fixture();
 await h.state.seedRoom(h.room);
 const staged=await h.fin.stageFinalMove(h.request);
 assert.equal(staged.pending,true);assert.equal(staged.replayed,false);
 assert.match(staged.fingerprint,/^[a-f0-9]{64}$/);
 assert.equal(h.pg.state.pending.size,1);
 assert.equal(h.pg.state.outbox.length,0,'no winner fanout before XP settlement');
 assert.equal(h.pg.state.actions.size,0);
 assert.equal(h.fire.metrics.reads,0,'no Firestore reads before staging');
 const seen=await h.state.getRoom('123');
 assert.equal(seen.room.match.dog.phase,'play','live room remains pre-final');
 const pending=await h.fin.loadPendingMatch({roomCode:'123',matchId:ID});
 assert.equal(pending.room.match.dog.phase,'finished');
 assert.equal(pending.room.match.dog.winner,0);
 assert.equal(pending.room.match.dogCounters.recorded,false);
 const duplicate=await h.fin.stageFinalMove(h.request);
 assert.equal(duplicate.pending,true);
 assert.equal(duplicate.replayed,true);
 assert.equal(h.pg.state.pending.size,1);
});

test('A staged winner freezes all other SQL moves until the Firebase receipt confirms XP',async()=>{
 const h=fixture();
 await h.state.seedRoom(h.room);
 await h.fin.stageFinalMove(h.request);
 await assert.rejects(()=>h.state.commitMove({
  code:'123',matchId:ID,uid:'bob',actionId:'pg-second-move-after-final',
  expectedDogRevision:42,action:{type:'exchange',cardId:1},
  authorize:authorization,reduce:r=>r
 }),/DOG_STORAGE_SETTLEMENT_PENDING/);
 await assert.rejects(()=>h.fin.stageFinalMove({
  ...h.request,actionId:'pg-different-winner-0001'
 }),/DOG_PG_FINAL_ALREADY_PENDING/);
 assert.equal(h.pg.state.actions.size,0);
 assert.equal(h.pg.state.outbox.length,0);
});

test('XP is paid once and ONLY THEN the finished DOG state is published',async()=>{
 const h=fixture();
 await h.state.seedRoom(h.room);
 await h.fin.stageFinalMove(h.request);
 const result=await h.bridge.settle({roomCode:'123',matchId:ID});
 assert.equal(result.replayed,false);
 assert.equal(result.players,3);
 assert.equal(h.fire.metrics.writes,4,'3 human accounts + 1 receipt');
 assert.equal(h.pg.state.pending.size,0);
 assert.equal(h.pg.state.actions.size,1);
 assert.equal(h.pg.state.outbox.length,1);
 const recovered=(await h.state.getRoom('123')).room;
 assert.equal(recovered.match.dog.phase,'finished');
 assert.equal(recovered.match.dogCounters.recorded,true);
 assert.match(recovered.match.pgSettledFingerprint,/^[a-f0-9]{64}$/);
 assert.equal(h.fire.docs.get('dog_player_statistics_v1/alice').wins,1);
 assert.equal(h.fire.docs.get('dog_player_statistics_v1/dana'),undefined);
 assert.equal(h.pg.metrics.connections,h.pg.metrics.releases);
});

test('Firestore crash leaves final action staged and blocks moves; retry finalizes once',async()=>{
 const h=fixture();
 await h.state.seedRoom(h.room);
 await h.fin.stageFinalMove(h.request);
 h.fire.offline(true);
 await assert.rejects(()=>h.bridge.settle({roomCode:'123',matchId:ID}),
  /FAKE_FIRESTORE_OFFLINE/);
 assert.equal(h.fire.metrics.writes,0);
 assert.equal(h.pg.state.pending.size,1);
 assert.equal(h.pg.state.outbox.length,0);
 h.fire.offline(false);
 const result=await h.bridge.settle({roomCode:'123',matchId:ID});
 assert.equal(result.replayed,false);
 assert.equal(h.fire.metrics.writes,4);
 assert.equal(h.pg.state.pending.size,0);
 assert.equal(h.pg.state.outbox.length,1);
});

test('Postgres ACK crash after Firebase commit cannot double award the match',async()=>{
 const h=fixture();
 await h.state.seedRoom(h.room);
 const staged=await h.fin.stageFinalMove(h.request);
 h.pg.setFail('UPDATE dog_room_states SET');
 await assert.rejects(()=>h.bridge.settle({roomCode:'123',matchId:ID}),
  /SIMULATED_PG_FAILURE/);
 assert.equal(h.fire.metrics.writes,4);
 assert.equal(h.pg.state.pending.size,1);
 assert.equal(h.pg.state.outbox.length,0);
 h.pg.setFail();
 const replay=await h.bridge.settle({roomCode:'123',matchId:ID});
 assert.equal(replay.replayed,true);
 assert.equal(h.fire.metrics.writes,4);
 assert.equal(h.pg.state.outbox.length,1);
 const marked=await h.fin.markComplete({
  roomCode:'123',matchId:ID,fingerprint:staged.fingerprint
 });
 assert.equal(marked.replayed,true,'missing PG response is safe to retry');
 assert.equal(h.pg.state.outbox.length,1);
});

test('Corrupt fingerprint and later forged winner cannot finalize a staged match',async()=>{
 const h=fixture();
 await h.state.seedRoom(h.room);
 const staged=await h.fin.stageFinalMove(h.request);
 await assert.rejects(()=>h.fin.markComplete({
  roomCode:'123',matchId:ID,fingerprint:'a'.repeat(64)
 }),/DOG_PG_FINAL_PROOF_MISMATCH/);
 assert.equal(h.pg.state.pending.size,1);
 assert.equal(h.pg.state.outbox.length,0);
 const pending=h.pg.state.pending.get('123');
 pending.finished_snapshot.match.dog.winner=1;
 await assert.rejects(()=>h.fin.markComplete({
  roomCode:'123',matchId:ID,fingerprint:staged.fingerprint
 }),/DOG_PG_FINAL_PROOF_MISMATCH/);
 assert.equal(h.pg.state.actions.size,0);
});

test('Illegal or non-winning candidate cannot be silently staged as a winner',async()=>{
 const h=fixture();
 await h.state.seedRoom(h.room);
 await assert.rejects(()=>h.fin.stageFinalMove({
  ...h.request,action:{type:'exchange',cardId:7777}
 }),/EXCHANGE_NOT_ALLOWED|DOG_/);
 assert.equal(h.pg.state.pending.size,0);
 assert.equal(h.pg.state.outbox.length,0);
 assert.equal(h.pg.metrics.rollbacks,1);
});

test('No global Christmas room may enter this partially migrated settlement',async()=>{
 const h=fixture();
 h.room.match.christmas={enabled:true};
 await h.state.seedRoom(h.room);
 await assert.rejects(()=>h.fin.stageFinalMove(h.request),
  /DOG_PG_FINAL_TRANSACTION_REQUIRED/);
 assert.equal(h.pg.state.pending.size,0);
 assert.equal(h.fire.metrics.writes,0);
});

test('Terminal SQL migration locks one winning action per room and remains private',()=>{
 const sql=readFileSync(new URL('../migrations/20261122_dog_durable_rooms.sql',import.meta.url),'utf8');
 assert.match(sql,/CREATE TABLE IF NOT EXISTS dog_room_pending_finishes/);
 assert.match(sql,/room_code VARCHAR\(6\) PRIMARY KEY REFERENCES dog_room_states\(room_code\)/);
 assert.match(sql,/finished_snapshot JSONB NOT NULL/);
 assert.match(sql,/fingerprint CHAR\(64\) NOT NULL/);
 assert.match(sql,/UNIQUE \(room_code,match_id,action_id\)/);
});
