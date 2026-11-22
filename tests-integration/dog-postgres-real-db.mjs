/**
 * Real PostgreSQL integration: use ONLY in GitHub Actions with a disposable
 * postgres:16 service. This is deliberately outside tests/*.test.js so the
 * live Render app and the ordinary npm test suite need no new dependency.
 *
 * No production credentials or external Firebase connections are used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {createGame,legalActions} from '../dog/engine.js';
import {newDogMatchCounters} from '../dog/player-stats.js';
import {createDogPostgresRoomStore} from '../dog-postgres-room-store.js';
import {
 reduceDogClassicInPostgresRoom
} from '../dog-postgres-classic-adapter.js';
import {createDogPostgresPrivateFanout} from '../dog-postgres-private-fanout.js';
import {createDogPostgresFinalization} from '../dog-postgres-finalization.js';
import {createDogPostgresXpSettlementBridge} from '../dog-postgres-xp-settlement.js';

const {Pool}=pg;
const db=new Pool({
 host:process.env.PGHOST||'127.0.0.1',
 port:Number(process.env.PGPORT||5432),
 user:process.env.PGUSER||'dog_test',
 password:process.env.PGPASSWORD||'local-ci-only',
 database:process.env.PGDATABASE||'dog_test',
 max:6,connectionTimeoutMillis:5000
});
function dogRoom(code,matchId=randomUUID()){
 const members=['alice','bob','cara'].map((uid,seat)=>({
  uid,seat,name:uid,bot:false,inactive:false
 }));
 members.push({uid:null,seat:3,name:'Free',bot:false,inactive:true});
 const dog=createGame({
  names:members.map(p=>p.name),
  bots:members.map(p=>p.bot),
  inactiveSeats:[3],rng:()=>0.35
 });
 return {
  code,revision:1,phase:'playing',createdAt:Date.now(),
  expiresAt:Date.now()+86400000,updatedAt:Date.now(),
  hostUid:'alice',game:'dog',
  players:members.filter(x=>!x.inactive).map(x=>({
   uid:x.uid,name:x.name,participating:true
  })),
  match:{id:matchId,game:'dog',
   dogChristmasEligibilityChecked:true,christmas:null,
   dogRoster:members,
   members:members.filter(x=>!x.inactive).map(x=>({uid:x.uid})),
   dogCounters:newDogMatchCounters(),
   dogCommands:[],dog
  }
 };
}
const authorize=async(room,{uid})=>{
 if(!room.players.some(p=>p.uid===uid))throw Error('NOT_A_MEMBER');
};
const move=(room,uid,action,actionId)=>({
 code:room.code,matchId:room.match.id,uid,
 action,actionId,
 expectedDogRevision:room.match.dog.revision,
 authorize,reduce:reduceDogClassicInPostgresRoom
});
function finishingRoom(){
 const room=dogRoom('ABC234');
 const s=room.match.dog;
 s.phase='play';s.current=0;s.starter=0;s.revision=42;
 s.hands=[[{id:7777,type:'2'}],[],[],[]];
 s.exchanges=[null,null,null,true];
 for(const pawn of s.pieces.filter(p=>p.owner===0)){
  if(pawn.id===3){pawn.place='track';pawn.pos=63}
  else {pawn.place='goal';pawn.pos=pawn.id+1}
 }
 const last=legalActions(s,0).find(a=>a.type==='move'&&
  a.cardId===7777&&a.pieceId===3&&a.steps===2&&a.viaGoal===true);
 assert.ok(last,'the real DOG rules must provide the legal winning step');
 return {room,last};
}
function fakeFirebase(){
 const docs=new Map();let writes=0,reads=0;
 return {
  db:{
   collection:name=>({doc:id=>({path:name+'/'+id})}),
   async runTransaction(callback){
    const changes=[];
    let writeStarted=false;
    const tx={
     async get(ref){
      assert.equal(writeStarted,false,'Firestore must read before any writes');
      reads++;
      const value=docs.get(ref.path);
      return {exists:value!==undefined,data:()=>structuredClone(value)};
     },
     set(ref,value){writeStarted=true;changes.push([ref.path,structuredClone(value)])}
    };
    const result=await callback(tx);
    for(const [path,item]of changes){docs.set(path,item);writes++;}
    return result;
   }
  },
  docs,metrics:()=>({writes,reads})
 };
}

test('DOG durable room, idempotency, privacy and winner settlement on REAL PostgreSQL',async t=>{
 t.after(async()=>{await db.end()});
 const sql=readFileSync(new URL('../migrations/20261122_dog_durable_rooms.sql',import.meta.url),'utf8');
 await db.query(sql);
 const clear=()=>db.query('TRUNCATE dog_room_states CASCADE');
 await clear();
 const store=createDogPostgresRoomStore({pool:db,clock:Date.now});

 await t.test('Real SQL row lock enforces one move even with two simultaneous requests',async()=>{
  const original=dogRoom('123');
  assert.deepEqual(await store.seedRoom(original),{created:true,version:1});
  const exchange={type:'exchange',cardId:original.match.dog.hands[0][0].id};
  const request=move(original,'alice',exchange,'pg-real-concurrent-0001');
  const [one,two]=await Promise.all([
   store.commitMove(request),store.commitMove(request)
  ]);
  assert.equal([one,two].filter(x=>x.replayed).length,1);
  assert.equal([one,two].filter(x=>!x.replayed).length,1);
  const saved=(await store.getRoom('123')).room;
  assert.equal(saved.match.dog.revision,original.match.dog.revision+1);
  assert.equal(saved.revision,2);
  assert.equal((await db.query(
   'SELECT COUNT(*)::integer AS n FROM dog_room_actions WHERE room_code=$1',['123']
  )).rows[0].n,1);
  assert.equal((await db.query(
   'SELECT COUNT(*)::integer AS n FROM dog_room_outbox WHERE room_code=$1',['123']
  )).rows[0].n,1);
  await assert.rejects(()=>store.commitMove({
   ...move(original,'alice',exchange,'pg-real-conflict-0001')
  }),/DOG_STORAGE_STALE_REVISION/);
  await assert.rejects(()=>store.commitMove({
   ...move(saved,'mallory',exchange,'pg-real-outsider-0001')
  }),/DOG_STORAGE_NOT_PARTICIPANT/);
 });

 await t.test('Real PG outbox broadcasts separately filtered cards and confirms once',async()=>{
  const fanout=createDogPostgresPrivateFanout({store});
  const received=[[],[],[]],unsubscribe=[];
  for(const [i,uid]of ['alice','bob','cara'].entries()){
   unsubscribe.push(await fanout.subscribe({
    code:'123',identity:{uid},send:p=>received[i].push(p)
   }));
   assert.equal(received[i].length,1);
   assert.equal(received[i][0].room.dogSeat,i);
   assert.equal(received[i][0].room.dog.deck,undefined);
   assert.equal(received[i][0].room.dog.discard,undefined);
   assert.ok(Array.isArray(received[i][0].room.dog.hands[i]));
   for(let seat=0;seat<4;seat++){
    if(seat!==i)assert.equal(
     Array.isArray(received[i][0].room.dog.hands[seat]),false);
   }
  }
  const first=await fanout.pollOnce();
  assert.equal(first.processed,1);
  assert.equal((await store.pendingEvents()).length,0);
  assert.equal(received[0].length,1,'an already current revision is not resent');
  unsubscribe.forEach(fn=>fn());
 });

 await t.test('PG-frozen winning move publishes no result until Firestore receipt is paid',async()=>{
  const {room,last}=finishingRoom();
  await store.seedRoom(room);
  const finalization=createDogPostgresFinalization({pool:db,clock:Date.now});
  const actionId='pg-real-finishing-0001';
  const staged=await finalization.stageFinalMove({
   code:room.code,matchId:room.match.id,uid:'alice',
   actionId,action:last,expectedDogRevision:42,authorize
  });
  assert.equal(staged.pending,true);
  assert.equal((await store.getRoom(room.code)).room.match.dog.phase,'play');
  assert.equal((await db.query(
   'SELECT COUNT(*)::integer AS n FROM dog_room_pending_finishes'
  )).rows[0].n,1);
  assert.equal((await db.query(
   'SELECT COUNT(*)::integer AS n FROM dog_room_outbox WHERE room_code=$1',[room.code]
  )).rows[0].n,0);
  await assert.rejects(()=>store.commitMove({
   ...move(room,'alice',last,'pg-move-after-final-0001')
  }),/DOG_STORAGE_SETTLEMENT_PENDING/);
  const fb=fakeFirebase();
  const bridge=createDogPostgresXpSettlementBridge({
   getFirestore:()=>fb.db,
   loadPendingMatch:finalization.loadPendingMatch,
   markComplete:finalization.markComplete,
   clock:Date.now
  });
  const credited=await bridge.settle({
   roomCode:room.code,matchId:room.match.id
  });
  assert.equal(credited.players,3);
  assert.equal(credited.replayed,false);
  assert.equal(fb.metrics().writes,4,'three human XP accounts plus one immutable receipt');
  assert.equal((await store.getRoom(room.code)).room.match.dog.phase,'finished');
  assert.equal((await db.query(
   'SELECT COUNT(*)::integer AS n FROM dog_room_pending_finishes'
  )).rows[0].n,0);
  assert.equal((await db.query(
   'SELECT COUNT(*)::integer AS n FROM dog_room_actions WHERE room_code=$1',
   [room.code]
  )).rows[0].n,1);
  assert.equal((await db.query(
   'SELECT COUNT(*)::integer AS n FROM dog_room_outbox WHERE room_code=$1',
   [room.code]
  )).rows[0].n,1);
  const confirmation=await finalization.markComplete({
   roomCode:room.code,matchId:room.match.id,
   fingerprint:staged.fingerprint
  });
  assert.equal(confirmation.replayed,true);
  assert.equal((await db.query(
   'SELECT COUNT(*)::integer AS n FROM dog_room_outbox WHERE room_code=$1',
   [room.code]
  )).rows[0].n,1);
 });
});
