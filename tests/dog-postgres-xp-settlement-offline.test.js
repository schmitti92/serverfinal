import test from 'node:test';
import assert from 'node:assert/strict';
import {createDogPostgresXpSettlementBridge,DOG_PG_MATCH_RECEIPTS_COLLECTION} from '../dog-postgres-xp-settlement.js';
import {DOG_PLAYER_STATS_COLLECTION} from '../dog/player-stats.js';
import {DOG_RESEARCH_COLLECTION} from '../dog/christmas-research.js';

const clone=v=>structuredClone(v);
const MATCH_ID='7d933478-7081-4a6d-893b-17fd93002111';
function finished({seasonal=false,mode='solo3',winner=0}={}){
 const players=['alice','bob','cara','dana'];
 const roster=players.map((uid,seat)=>({
  uid:mode==='solo3'&&seat===3?null:uid,
  name:players[seat].toUpperCase(),seat,bot:false,
  inactive:mode==='solo3'&&seat===3
 }));
 return {finishedAt:1795000000000,room:{
  code:'123',phase:'playing',
  players:roster.filter(p=>!p.inactive).map(p=>({uid:p.uid})),
  match:{id:MATCH_ID,game:'dog',dogChristmasEligibilityChecked:true,
   christmas:seasonal?{enabled:true}:null,
   members:roster.filter(p=>!p.inactive).map(p=>({uid:p.uid})),
   dogRoster:roster,
   dog:{phase:'finished',mode,winner},
   dogCounters:{recorded:false,seats:[
    {knockedOut:3,wasKnockedOut:1},
    {knockedOut:0,wasKnockedOut:2},
    {knockedOut:2,wasKnockedOut:1},
    {knockedOut:1,wasKnockedOut:2}
   ]}
  }
 }};
}
function fakeFirestore(){
 const documents=new Map(),count={reads:0,tx:0,writes:0,rollbacks:0},
  history=[];
 let transactionFail=false;
 const snapshots=data=>({exists:data!==undefined,data:()=>clone(data)});
 const firestore={
  collection:collection=>({doc:uid=>({path:collection+'/'+uid})}),
  async runTransaction(callback){
   count.tx++;
   let wrote=false;
   const writes=[];
   const tx={
    async get(ref){
     if(wrote)throw Error('FIRESTORE_READ_AFTER_WRITE');
     count.reads++;history.push('read:'+ref.path);
     return snapshots(documents.get(ref.path));
    },
    set(ref,value){
     wrote=true;history.push('set:'+ref.path);
     writes.push([ref.path,clone(value)]);
    }
   };
   try{
    const out=await callback(tx);
    if(transactionFail)throw Error('FIRESTORE_COMMIT_UNAVAILABLE');
    for(const [path,value]of writes){documents.set(path,value);count.writes++;}
    return out;
   }catch(e){count.rollbacks++;throw e;}
  }
 };
 return {firestore,documents,count,history,failNext(flag){transactionFail=flag},
  get:(collection,uid)=>documents.get(collection+'/'+uid),
  set:(collection,uid,value)=>documents.set(collection+'/'+uid,clone(value))};
}
function setup({record=finished(),store=fakeFirestore()}={}){
 const pg={record:clone(record),done:false,marks:0,failMark:false,loads:0};
 const bridge=()=>createDogPostgresXpSettlementBridge({
  getFirestore:()=>store.firestore,
  loadPendingMatch:async({roomCode,matchId})=>{
   pg.loads++;
   if(pg.done||roomCode!=='123'||matchId!==MATCH_ID)return null;
   return clone(pg.record);
  },
  markComplete:async({roomCode,matchId,fingerprint})=>{
   assert.equal(roomCode,'123');
   assert.equal(matchId,MATCH_ID);
   assert.match(fingerprint,/^[0-9a-f]{64}$/);
   pg.marks++;
   if(pg.failMark)throw Error('POSTGRES_CONFIRMATION_TIMEOUT');
   pg.done=true;
  },
  clock:()=>1795000000200
 });
 return {pg,store,bridge,settle:()=>bridge().settle({roomCode:'123',matchId:MATCH_ID})};
}
const receipt=store=>store.get(DOG_PG_MATCH_RECEIPTS_COLLECTION,MATCH_ID);

test('3-player DOG victory grants exactly 3 genuine human accounts + 1 match receipt atomically',async()=>{
 const x=setup();
 const result=await x.settle();
 assert.deepEqual(result,{settled:true,replayed:false,players:3});
 assert.equal(x.pg.done,true);
 assert.equal(x.pg.marks,1);
 assert.equal(x.store.count.tx,1);
 assert.equal(x.store.count.reads,7,'one receipt + 3 stats + 3 research');
 assert.equal(x.store.count.writes,4,'one receipt + each of 3 humans');
 assert.equal(x.store.get(DOG_PLAYER_STATS_COLLECTION,'alice').wins,1);
 assert.equal(x.store.get(DOG_PLAYER_STATS_COLLECTION,'bob').wins,0);
 assert.equal(x.store.get(DOG_PLAYER_STATS_COLLECTION,'cara').wins,0);
 assert.equal(x.store.get(DOG_PLAYER_STATS_COLLECTION,'dana'),undefined);
 assert.equal(x.store.get(DOG_PLAYER_STATS_COLLECTION,'alice').xp,130);
 assert.equal(x.store.get(DOG_PLAYER_STATS_COLLECTION,'bob').xp,50);
 assert.equal(x.store.get(DOG_PLAYER_STATS_COLLECTION,'cara').xp,70);
 assert.equal(receipt(x.store).playerCount,3);
 assert.equal(receipt(x.store).mode,'solo3');
 assert.equal(receipt(x.store).roomCode,'123');
 assert.equal(receipt(x.store).settledAt,1795000000200);
 assert.ok(!JSON.stringify(receipt(x.store)).includes('alice'),
   'receipt contains only fingerprints and aggregate metadata, not personal IDs');
 assert.equal(x.store.history.findIndex(x=>x.startsWith('set:'))>6,true,
   'all reads come before the first write');
});

test('XP research bonus is calculated from authenticated Firestore research snapshot',async()=>{
 const x=setup();
 x.store.set(DOG_RESEARCH_COLLECTION,'alice',{levels:{xp:1,win_xp:1}});
 const r=await x.settle();
 assert.equal(r.players,3);
 // base win + 3 knockouts = 130; research +10% of base, winner +30% of 50.
 assert.equal(x.store.get(DOG_PLAYER_STATS_COLLECTION,'alice').xp,158);
 assert.equal(x.store.get(DOG_PLAYER_STATS_COLLECTION,'alice').xpMatches,1);
});

test('If PG ACK crashes after Firestore commit, retry credits nobody twice',async()=>{
 const x=setup();
 x.pg.failMark=true;
 await assert.rejects(()=>x.settle(),/POSTGRES_CONFIRMATION_TIMEOUT/);
 assert.equal(x.store.count.writes,4);
 assert.equal(x.pg.done,false);
 const first=clone(x.store.get(DOG_PLAYER_STATS_COLLECTION,'alice'));
 x.pg.failMark=false;
 const retry=await x.settle();
 assert.deepEqual(retry,{settled:true,replayed:true,players:3});
 assert.deepEqual(x.store.get(DOG_PLAYER_STATS_COLLECTION,'alice'),first);
 assert.equal(x.store.count.writes,4,'receipt path performs no new writes on retry');
 assert.equal(x.store.count.reads,8,'retry needs only the receipt GET');
 assert.equal(x.pg.done,true);
 await assert.rejects(()=>x.settle(),/DOG_PG_SETTLEMENT_NOT_PENDING/);
 assert.equal(x.store.count.tx,2,'already confirmed PG job does not query Firestore');
});

test('Firestore transaction failure writes no account or receipt; later retry is safe',async()=>{
 const x=setup();
 x.store.failNext(true);
 await assert.rejects(()=>x.settle(),/FIRESTORE_COMMIT_UNAVAILABLE/);
 assert.equal(x.store.count.writes,0);
 assert.equal(receipt(x.store),undefined);
 assert.equal(x.pg.done,false);
 x.store.failNext(false);
 const ok=await x.settle();
 assert.equal(ok.replayed,false);
 assert.equal(x.store.count.writes,4);
});

test('Changed immutable PG match snapshot cannot reuse an existing payment receipt',async()=>{
 const x=setup();
 x.pg.failMark=true;
 await assert.rejects(()=>x.settle(),/POSTGRES_CONFIRMATION_TIMEOUT/);
 x.pg.record.room.match.dogCounters.seats[0].knockedOut=4;
 x.pg.failMark=false;
 await assert.rejects(()=>x.settle(),/DOG_PG_SETTLEMENT_RECEIPT_CONFLICT/);
 assert.equal(x.store.count.writes,4);
 assert.equal(x.pg.done,false);
});

test('Receipt collision with a different match fingerprint is rejected without account changes',async()=>{
 const x=setup();
 x.store.set(DOG_PG_MATCH_RECEIPTS_COLLECTION,MATCH_ID,{
  matchId:MATCH_ID,roomCode:'another-room',fingerprint:'f'.repeat(64)});
 await assert.rejects(()=>x.settle(),/DOG_PG_SETTLEMENT_RECEIPT_CONFLICT/);
 assert.equal(x.store.count.writes,0);
 assert.equal(x.pg.marks,0);
});

test('Legacy match already paid in old hub must never be paid again by PG',async()=>{
 const x=setup();
 x.store.set(DOG_PLAYER_STATS_COLLECTION,'alice',{
  played:1,wins:1,xp:130,lastMatchId:MATCH_ID,xpLastMatchId:MATCH_ID});
 await assert.rejects(()=>x.settle(),/DOG_PG_SETTLEMENT_LEGACY_OVERLAP/);
 assert.equal(receipt(x.store),undefined);
 assert.equal(x.store.get(DOG_PLAYER_STATS_COLLECTION,'alice').played,1);
 assert.equal(x.pg.done,false);
});

test('Four human profiles receive all four credits while bot and vacant profiles are ignored',async()=>{
 const x=setup({record:finished({mode:'teams4',winner:1})});
 const result=await x.settle();
 assert.equal(result.players,4);
 assert.equal(x.store.get(DOG_PLAYER_STATS_COLLECTION,'dana').played,1);
 assert.equal(x.store.get(DOG_PLAYER_STATS_COLLECTION,'bob').wins,1);
 assert.equal(x.store.get(DOG_PLAYER_STATS_COLLECTION,'dana').wins,1);
 assert.equal(x.store.get(DOG_PLAYER_STATS_COLLECTION,'alice').wins,0);
 assert.equal(x.store.count.reads,9);
 assert.equal(x.store.count.writes,5);
});

test('Seasonal reward, unfinished match and already recorded counters never enter this bridge',async()=>{
 const cases=[
  record=>{record.room.match.christmas={enabled:true};},
  record=>{record.room.match.dog.phase='play';},
  record=>{record.room.match.dogCounters.recorded=true;},
  record=>{record.room.match.id='a-different-match';},
  record=>{record.finishedAt=0;}
 ];
 for(const mutate of cases){
  const record=finished();mutate(record);
  const x=setup({record});
  await assert.rejects(()=>x.settle(),/DOG_PG_SETTLEMENT_/);
  assert.equal(x.store.count.tx,0,'invalid PG job causes no Firebase reads');
  assert.equal(x.pg.marks,0);
 }
});

test('Forged roster, duplicated UID and invalid winner are rejected before touching Firebase',async()=>{
 const cases=[
  record=>{record.room.match.dogRoster[1].uid='alice';},
  record=>{record.room.match.dogRoster[1].uid='unauthorized';},
  record=>{record.room.match.dogRoster[2].seat=0;},
  record=>{record.room.match.dog.winner=3;},
  record=>{record.room.match.dogCounters.seats[0].knockedOut=-1;}
 ];
 for(const mutate of cases){
  const record=finished();mutate(record);
  const x=setup({record});
  await assert.rejects(()=>x.settle(),/DOG_PG_SETTLEMENT_/);
  assert.equal(x.store.count.tx,0);
 }
});

test('Only real UUID match IDs and valid room codes are accepted, no client-defined settlement payload',async()=>{
 const x=setup();
 for(const args of [
  {roomCode:'123',matchId:'match-from-browser'},
  {roomCode:'123',matchId:'7d933478-7081-2a6d-893b-17fd93002111'},
  {roomCode:'../../',matchId:MATCH_ID}
 ]){
  await assert.rejects(()=>x.bridge().settle(args),/DOG_PG_SETTLEMENT_INVALID_ID/);
 }
 assert.equal(x.pg.loads,0);
 assert.equal(x.store.count.tx,0);
});

test('Snapshot digest is insensitive to Firestore transport retries but sensitive to settlement fields',async()=>{
 const x=setup();
 x.pg.failMark=true;
 await assert.rejects(()=>x.settle(),/POSTGRES_CONFIRMATION_TIMEOUT/);
 // An irrelevant redrawable UI field does not change payout semantics.
 x.pg.record.room.match.dog.history=['UI updated'];
 x.pg.failMark=false;
 const result=await x.settle();
 assert.equal(result.replayed,true);
 assert.equal(x.store.count.writes,4);
});
