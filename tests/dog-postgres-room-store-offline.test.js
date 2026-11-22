import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDogPostgresRoomStore} from '../dog-postgres-room-store.js';

const clone=value=>structuredClone(value);
function fakePool(){
 const state={rooms:new Map(),actions:new Map(),outbox:[],serial:0};
 const metrics={sql:[],commits:0,rollbacks:0,connections:0,releases:0};
 let failOn='';
 const record=(sql,params)=>metrics.sql.push({sql,params:clone(params||[])});
 const doQuery=(data,sql,args=[])=>{
  record(sql,args);
  if(failOn&&sql.startsWith(failOn))throw Error('SIMULATED_PG_FAILURE');
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[],rowCount:0};
  if(sql.startsWith('INSERT INTO dog_room_states')){
   if(data.rooms.has(args[0]))return {rows:[],rowCount:0};
   data.rooms.set(args[0],{match_id:args[1],version:args[2],
    snapshot:JSON.parse(args[3]),expires_at_ms:args[4],updated_at_ms:args[5]});
   return {rows:[{match_id:args[1],version:args[2]}],rowCount:1};
  }
  if(sql.startsWith('SELECT snapshot,version,expires_at_ms FROM dog_room_states')){
   const r=data.rooms.get(args[0]);
   return {rows:r?[clone(r)]:[],rowCount:r?1:0};
  }
  if(sql.startsWith('SELECT match_id,version FROM dog_room_states')){
   const r=data.rooms.get(args[0]);
   return {rows:r?[clone(r)]:[],rowCount:r?1:0};
  }
  if(sql.startsWith('SELECT snapshot,version,match_id,expires_at_ms FROM dog_room_states')){
   const r=data.rooms.get(args[0]);
   return {rows:r?[clone(r)]:[],rowCount:r?1:0};
  }
  if(sql.startsWith('SELECT request_hash,room_version FROM dog_room_actions')){
   const r=data.actions.get(args.slice(0,3).join('|'));
   return {rows:r?[clone(r)]:[],rowCount:r?1:0};
  }
  if(sql.startsWith('UPDATE dog_room_states SET')){
   const row=data.rooms.get(args[0]);
   if(!row||row.version!==args[5])return {rows:[],rowCount:0};
   data.rooms.set(args[0],{...row,snapshot:JSON.parse(args[1]),
    version:args[2],expires_at_ms:args[3],updated_at_ms:args[4]});
   return {rows:[],rowCount:1};
  }
  if(sql.startsWith('INSERT INTO dog_room_actions')){
   const key=args.slice(0,3).join('|');
   if(data.actions.has(key))throw Error('PG_UNIQUE_COLLISION');
   data.actions.set(key,{room_code:args[0],match_id:args[1],action_id:args[2],
    actor_uid:args[3],request_hash:args[4],room_version:args[5]});
   return {rows:[],rowCount:1};
  }
  if(sql.startsWith('INSERT INTO dog_room_outbox')){
   data.outbox.push({event_id:++data.serial,room_code:args[0],match_id:args[1],
    action_id:args[2],room_version:args[3],topic:args[4],created_at_ms:args[5],
    delivered_at_ms:null});
   return {rows:[],rowCount:1};
  }
  if(sql.startsWith('SELECT event_id,room_code,match_id,room_version,topic FROM dog_room_outbox')){
   const rows=data.outbox.filter(x=>x.delivered_at_ms===null).slice(0,args[0])
    .map(({event_id,room_code,match_id,room_version,topic})=>({
     event_id,room_code,match_id,room_version,topic}));
   return {rows,rowCount:rows.length};
  }
  if(sql.startsWith('UPDATE dog_room_outbox SET')){
   const row=data.outbox.find(x=>x.event_id===args[0]&&x.delivered_at_ms===null);
   if(row)row.delivered_at_ms=args[1];
   return {rows:[],rowCount:row?1:0};
  }
  throw Error('Unexpected SQL: '+sql);
 };
 const pool={
  async query(sql,args){return doQuery(state,sql,args)},
  async connect(){
   metrics.connections++;
   const stage=()=>({
    rooms:new Map([...state.rooms].map(([key,val])=>[key,clone(val)])),
    actions:new Map([...state.actions].map(([key,val])=>[key,clone(val)])),
    outbox:clone(state.outbox),serial:state.serial
   });
   let pending=null,started=false;
   return {
    async query(sql,args){
     if(sql==='BEGIN'){pending=stage();started=true;return {rows:[],rowCount:0};}
     if(sql==='COMMIT'){
      if(!started)throw Error('PG_COMMIT_WITHOUT_BEGIN');
      state.rooms=pending.rooms;state.actions=pending.actions;
      state.outbox=pending.outbox;state.serial=pending.serial;
      metrics.commits++;started=false;pending=null;
      return {rows:[],rowCount:0};
     }
     if(sql==='ROLLBACK'){
      metrics.rollbacks++;started=false;pending=null;
      return {rows:[],rowCount:0};
     }
     if(!started)throw Error('PG_QUERY_WITHOUT_TRANSACTION');
     return doQuery(pending,sql,args);
    },
    release(){metrics.releases++;}
   };
  }
 };
 return {pool,state,metrics,failOn(sql){failOn=sql}};
}
function room(){
 return {
  code:'123',revision:1,phase:'playing',expiresAt:1000000,updatedAt:1000,
  players:[{uid:'alice',participating:true},{uid:'bob',participating:true}],
  match:{id:'match-123456789',game:'dog',dogChristmasEligibilityChecked:true,
   christmas:null,dogRoster:[{uid:'alice',seat:0,bot:false,inactive:false},
    {uid:'bob',seat:1,bot:false,inactive:false}],
   dog:{revision:7,phase:'play',current:0,deck:[{id:1,type:'5'}],
    hands:[[{id:2,type:'5'}],[{id:3,type:'7'}],[],[]]}}
 };
}
const authorize=async(r,{uid})=>{
 if(!r.players.some(p=>p.uid===uid))throw Error('NOT_A_MEMBER');
};
const reduce=(r,{action})=>{r.match.dog.revision++;
 r.match.dog.current=1-r.match.dog.current;
 r.match.dog.lastMove=action.type;
 return {room:r};
};
const move=(actionId='dog-command-test-001',action={type:'move',cardId:2})=>({
 code:'123',matchId:'match-123456789',actionId,uid:'alice',
 expectedDogRevision:7,action,authorize,reduce
});

test('Postgres migration contains durable room, idempotent actions, and private-safe outbox',()=>{
 const schema=readFileSync(new URL('../migrations/20261122_dog_durable_rooms.sql',import.meta.url),'utf8');
 for(const table of ['dog_room_states','dog_room_actions','dog_room_outbox'])
  assert.match(schema,new RegExp('CREATE TABLE IF NOT EXISTS '+table));
 assert.match(schema,/PRIMARY KEY \(room_code,match_id,action_id\)/);
 assert.match(schema,/REFERENCES dog_room_states\(room_code\) ON DELETE CASCADE/);
 assert.match(schema,/WHERE delivered_at_ms IS NULL/);
});

test('One confirmed standard move stores full private snapshot, receipt and outbox atomically',async()=>{
 const f=fakePool(),store=createDogPostgresRoomStore({pool:f.pool,clock:()=>2000});
 assert.deepEqual(await store.seedRoom(room()),{created:true,version:1});
 const before=await store.getRoom('123');
 assert.equal(before.room.match.dog.deck[0].id,1,'server can recover complete private state');
 const result=await store.commitMove(move());
 assert.equal(result.replayed,false);
 assert.equal(result.version,2);
 assert.equal(result.room.match.dog.revision,8);
 assert.equal(result.room.expiresAt,2000+86400000);
 assert.equal(f.state.actions.size,1);
 assert.equal(f.state.outbox.length,1);
 assert.deepEqual(await store.pendingEvents(),[{
  event_id:1,room_code:'123',match_id:'match-123456789',room_version:2,topic:'room-changed'
 }]);
 assert.doesNotMatch(JSON.stringify(await store.pendingEvents()),/deck|hands|cardId|alice|bob/);
 assert.equal(f.metrics.commits,1);
 assert.equal(f.metrics.rollbacks,0);
 assert.equal(f.metrics.connections,f.metrics.releases);
});

test('Replay after restart returns durable state; conflicting action body is rejected',async()=>{
 const f=fakePool(),store=createDogPostgresRoomStore({pool:f.pool,clock:()=>2000});
 await store.seedRoom(room());
 await store.commitMove(move());
 const restarted=createDogPostgresRoomStore({pool:f.pool,clock:()=>2001});
 const replay=await restarted.commitMove(move());
 assert.equal(replay.replayed,true);
 assert.equal(replay.room.match.dog.revision,8);
 assert.equal(f.state.actions.size,1);
 assert.equal(f.state.outbox.length,1,'replay cannot create an extra event');
 await assert.rejects(()=>restarted.commitMove(move('dog-command-test-001',{type:'other'})),
  /DOG_STORAGE_ACTION_ID_COLLISION/);
 assert.equal(f.state.actions.size,1);
});

test('Stale revision, revoked participant and different match cannot write the room',async()=>{
 const f=fakePool(),store=createDogPostgresRoomStore({pool:f.pool,clock:()=>2000});
 await store.seedRoom(room());
 await store.commitMove(move());
 await assert.rejects(()=>store.commitMove(move('dog-command-test-002')),
  /DOG_STORAGE_STALE_REVISION/);
 await assert.rejects(()=>store.commitMove({...move('dog-command-test-003'),uid:'mallory'}),
  /DOG_STORAGE_NOT_PARTICIPANT/);
 await assert.rejects(()=>store.commitMove({...move('dog-command-test-004'),matchId:'different-match-id'}),
  /DOG_STORAGE_WRONG_MATCH/);
 assert.equal(f.state.actions.size,1);
 assert.equal(f.state.outbox.length,1);
 assert.ok(f.metrics.rollbacks>=3);
});

test('No event rewards or final move can bypass the Firestore reward settlement',async()=>{
 const f=fakePool(),store=createDogPostgresRoomStore({pool:f.pool,clock:()=>2000});
 const seasonal=room();seasonal.match.christmas={enabled:true,earnedTenths:0};
 await store.seedRoom(seasonal);
 await assert.rejects(()=>store.commitMove(move()),/DOG_STORAGE_TRANSACTION_REQUIRED/);
 assert.equal(f.state.actions.size,0);
 assert.equal(f.state.outbox.length,0);
 // Separate room, final move also blocked before any persistent update.
 const g=fakePool(),clean=createDogPostgresRoomStore({pool:g.pool,clock:()=>2000});
 await clean.seedRoom(room());
 await assert.rejects(()=>clean.commitMove({
  ...move(),reduce:r=>{r.match.dog.revision++;r.match.dog.phase='finished';return r}
 }),/DOG_STORAGE_TRANSACTION_REQUIRED/);
 assert.equal(g.state.actions.size,0);
 assert.equal(g.state.outbox.length,0);
});

test('Postgres exception rolls back all room, receipt and outbox changes',async()=>{
 const f=fakePool(),store=createDogPostgresRoomStore({pool:f.pool,clock:()=>2000});
 await store.seedRoom(room());
 f.failOn('INSERT INTO dog_room_outbox');
 await assert.rejects(()=>store.commitMove(move()),/SIMULATED_PG_FAILURE/);
 assert.equal((await store.getRoom('123')).room.match.dog.revision,7);
 assert.equal(f.state.actions.size,0);
 assert.equal(f.state.outbox.length,0);
 assert.equal(f.metrics.rollbacks,1);
 assert.equal(f.metrics.connections,f.metrics.releases);
});

test('Outbox acknowledgements survive process restart and never repeat a notified event',async()=>{
 const f=fakePool(),store=createDogPostgresRoomStore({pool:f.pool,clock:()=>2000});
 await store.seedRoom(room());await store.commitMove(move());
 await store.acknowledgeEvent(1);
 const restarted=createDogPostgresRoomStore({pool:f.pool,clock:()=>3000});
 assert.deepEqual(await restarted.pendingEvents(),[]);
 await assert.rejects(()=>store.acknowledgeEvent(0),/DOG_STORAGE_BAD_EVENT/);
});

test('A room must be seeded once; matching startup can resume but never overwrite another match',async()=>{
 const f=fakePool(),store=createDogPostgresRoomStore({pool:f.pool,clock:()=>2000});
 await store.seedRoom(room());
 assert.deepEqual(await store.seedRoom(room()),{created:false,version:1});
 const other=room();other.match.id='match-another-123';
 await assert.rejects(()=>store.seedRoom(other),/DOG_STORAGE_SEED_CONFLICT/);
 assert.equal((await store.getRoom('123')).room.match.id,'match-123456789');
});

test('Reducer must be synchronous and must not invent a reward or shorten a signed-in session',async()=>{
 const f=fakePool(),store=createDogPostgresRoomStore({pool:f.pool,clock:()=>2000});
 await store.seedRoom(room());
 await assert.rejects(()=>store.commitMove({...move(),reduce:async r=>r}),
  /DOG_STORAGE_ASYNC_REDUCER_FORBIDDEN/);
 await assert.rejects(()=>store.commitMove({...move(),reduce:r=>{
  r.match.dog.revision++;r.match.christmas={enabled:true};return r;
 }}),/DOG_STORAGE_TRANSACTION_REQUIRED/);
 assert.equal(f.state.actions.size,0);
});

test('Neither a reducer nor a verifier may modify participants or cosmetics indirectly',async()=>{
 const f=fakePool(),store=createDogPostgresRoomStore({pool:f.pool,clock:()=>2000});
 await store.seedRoom(room());
 for(const reduce of [
  (r)=>{r.match.dog.revision++;r.players=[];return r;},
  (r)=>{r.match.dog.revision++;r.match.dogRoster=[];return r;},
  (r)=>{r.match.dog.revision++;r.match.dogResearchSkills={alice:{lights_bonus:10}};return r;},
  (r)=>{r.match.dog.revision++;r.match.christmas={enabled:false};return r;}
 ]){
  await assert.rejects(()=>store.commitMove({...move(),reduce}),/DOG_STORAGE_TRANSACTION_REQUIRED/);
 }
 assert.equal(f.state.actions.size,0);
 assert.equal(f.metrics.rollbacks,4);
 // An authorization helper sees an isolated copy; it cannot accidentally
 // forge a committed participant while checking the caller's access.
 const result=await store.commitMove({...move(),
  authorize:async r=>{r.players.push({uid:'mallory'})}});
 assert.equal(result.replayed,false);
 assert.equal(result.room.players.length,2);
 assert.equal(f.state.actions.size,1);
});

test('Oversized DOG document rejects before SQL UPDATE, with no fake or partial success',async()=>{
 const f=fakePool(),store=createDogPostgresRoomStore({pool:f.pool,clock:()=>2000});
 await store.seedRoom(room());
 await assert.rejects(()=>store.commitMove({...move(),reduce:r=>{
  r.match.dog.revision++;
  r.match.dog.history=['x'.repeat(1_000_000)];
  return r;
 }}),/DOG_STORAGE_STATE_TOO_LARGE/);
 assert.equal(f.state.actions.size,0);
 assert.equal(f.state.outbox.length,0);
 assert.equal((await store.getRoom('123')).room.match.dog.revision,7);
 assert.equal(f.metrics.rollbacks,1);
});
