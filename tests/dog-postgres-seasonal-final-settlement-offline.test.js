import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createDogPostgresSeasonalFinalBridge,
 dogPostgresSeasonalFinalProof
} from '../dog-postgres-seasonal-final-settlement.js';
import {DOG_PG_MATCH_RECEIPTS_COLLECTION} from '../dog-postgres-xp-settlement.js';
import {DOG_PG_CHRISTMAS_RECEIPTS_COLLECTION} from '../dog-postgres-christmas-settlement.js';
import {DOG_PLAYER_STATS_COLLECTION} from '../dog/player-stats.js';
import {DOG_RESEARCH_COLLECTION} from '../dog/christmas-research.js';
import {DOG_SCRATCH_COLLECTION} from '../dog/christmas-scratch.js';
import {DOG_VILLAGE_COLLECTION,DOG_GLOBAL_VILLAGE_ID} from '../dog/christmas-village.js';

const clone=value=>structuredClone(value);
const MATCH_ID='73e4eaa3-24fa-48f2-a14e-a46fd85b2613';
const ACTION_ID='pg-christmas-final-0001';

function matchJob({humans=3,inn=3,academy=3,deltaLights=34,
 gifts=1,bonus=0,
 vouchers=[{uid:'alice',tier:'simple'},{uid:'cara',tier:'premium'}]}={}){
 const uid=['alice','bob','cara','dana'];
 const roster=uid.map((id,seat)=>({
  uid:seat>=humans?null:id,seat,name:id,
  bot:false,inactive:seat>=humans
 }));
 const members=roster.filter(x=>!x.inactive).map(x=>({uid:x.uid}));
 const before={
  code:'123',phase:'playing',
  players:members.map(x=>({uid:x.uid})),
  match:{id:MATCH_ID,game:'dog',dogChristmasEligibilityChecked:true,
   members, dogRoster:roster,
   dog:{phase:'play',revision:41,mode:humans===3?'solo3':'teams4',winner:null},
   dogCounters:{recorded:false,seats:[
    {knockedOut:3,wasKnockedOut:1},
    {knockedOut:0,wasKnockedOut:2},
    {knockedOut:2,wasKnockedOut:1},
    {knockedOut:0,wasKnockedOut:0}
   ]},
   christmas:{enabled:true,levels:{
    inn,academy,tower:1,workshop:1,bakery:1
   },earnedTenths:20,giftCount:2,bonusGiftCount:0,scratchCount:1,
   innCredited:false}
  }
 };
 const after=clone(before);
 after.match.dog={...after.match.dog,phase:'finished',revision:42,winner:0};
 after.match.christmas.earnedTenths+=deltaLights;
 after.match.christmas.giftCount+=gifts;
 after.match.christmas.bonusGiftCount+=bonus;
 after.match.christmas.scratchCount+=vouchers.length;
 after.match.christmas.innCredited=true;
 return {before,room:after,finishedAt:1795000001000,
  actionId:ACTION_ID,vouchers};
}
function fakeFirestore(){
 const docs=new Map(),calls={reads:0,writes:0,tx:0,rollbacks:0,sequence:[]};
 let failCommit=false;
 const firestore={
  collection:collection=>({doc:id=>({path:collection+'/'+id})}),
  async runTransaction(callback){
   calls.tx++;
   let wrote=false;
   const batch=[];
   const tx={
    async get(ref){
     if(wrote)throw Error('FIRESTORE_READ_AFTER_WRITE');
     calls.reads++;calls.sequence.push('get');
     const d=docs.get(ref.path);
     return {exists:d!==undefined,data:()=>clone(d)};
    },
    set(ref,value){
     wrote=true;calls.sequence.push('set');
     batch.push([ref.path,clone(value)]);
    }
   };
   try{
    const value=await callback(tx);
    if(failCommit)throw Error('FIRESTORE_COMMIT_UNAVAILABLE');
    for(const [key,item] of batch){docs.set(key,item);calls.writes++}
    return value;
   }catch(e){calls.rollbacks++;throw e}
  }
 };
 return {firestore,docs,calls,
  fail(flag){failCommit=flag},
  get:(collection,id)=>docs.get(collection+'/'+id),
  set:(collection,id,value)=>docs.set(collection+'/'+id,clone(value))};
}
function setup(record=matchJob()){
 const db=fakeFirestore();
 const pg={record:clone(record),done:false,marks:0,failMark:false,loads:0};
 const bridge=()=>createDogPostgresSeasonalFinalBridge({
  getFirestore:()=>db.firestore,
  loadPendingSeasonalFinal:async({roomCode,matchId})=>{
   pg.loads++;
   return roomCode==='123'&&matchId===MATCH_ID&&!pg.done?clone(pg.record):null;
  },
  markComplete:async({roomCode,matchId,fingerprint})=>{
   pg.marks++;
   assert.equal(roomCode,'123');
   assert.equal(matchId,MATCH_ID);
   assert.match(fingerprint,/^[a-f0-9]{64}$/);
   if(pg.failMark)throw Error('POSTGRES_ACK_UNAVAILABLE');
   pg.done=true;
  },
  clock:()=>1795000002000
 });
 const settle=()=>bridge().settle({roomCode:'123',matchId:MATCH_ID});
 return {db,pg,bridge,settle};
}
const receiptId=()=>MATCH_ID;

test('Last seasonal DOG move pays XP, 2 vouchers, shared lights and match count in ONE atomic transaction',async()=>{
 const s=setup();
 const result=await s.settle();
 assert.deepEqual(result,{
  settled:true,replayed:false,players:3,vouchers:2,creditedTenths:34
 });
 assert.equal(s.db.calls.tx,1);
 assert.equal(s.db.calls.reads,11,'two guards + six stats/research + village + two wallets');
 assert.equal(s.db.calls.writes,7,'3 players, 2 wallets, village and single match receipt');
 assert.equal(s.db.get(DOG_PLAYER_STATS_COLLECTION,'dana'),undefined);
 const alice=s.db.get(DOG_PLAYER_STATS_COLLECTION,'alice');
 assert.equal(alice.played,1);
 assert.equal(alice.wins,1);
 assert.equal(alice.xp,156,'130 base XP plus 20 percent academy');
 const bob=s.db.get(DOG_PLAYER_STATS_COLLECTION,'bob');
 assert.equal(bob.wins,0);
 assert.equal(bob.xp,60,'academy bonus for non-winning player');
 const village=s.db.get(DOG_VILLAGE_COLLECTION,DOG_GLOBAL_VILLAGE_ID);
 assert.equal(village.lightsTenths,34);
 assert.equal(village.totalEarnedTenths,34);
 assert.equal(village.giftsCollected,1);
 assert.equal(village.matchesCompleted,1);
 assert.equal(s.db.get(DOG_SCRATCH_COLLECTION,'alice').vouchers.simple,1);
 assert.equal(s.db.get(DOG_SCRATCH_COLLECTION,'cara').vouchers.premium,1);
 const receipt=s.db.get(DOG_PG_MATCH_RECEIPTS_COLLECTION,receiptId());
 assert.equal(receipt.kind,'seasonal-final');
 assert.equal(receipt.playerCount,3);
 assert.equal(receipt.vouchers,2);
 assert.equal(receipt.earnedTenths,34);
 assert.ok(!JSON.stringify(receipt).includes('alice'));
 assert.equal(s.db.get(DOG_PG_CHRISTMAS_RECEIPTS_COLLECTION,MATCH_ID+'_'+ACTION_ID),undefined);
 assert.equal(s.db.calls.sequence.indexOf('set'),11,'all reads precede every write');
 assert.equal(s.pg.done,true);
});

test('Research skills and academy XP both use verified Firestore research snapshots',async()=>{
 const s=setup();
 s.db.set(DOG_RESEARCH_COLLECTION,'alice',{levels:{xp:1,win_xp:1}});
 await s.settle();
 // Base: 50 complete + 50 win + 30 knockouts = 130
 // Academy level 3: 20%, XP research: +10%, winner research +30% of 50.
 assert.equal(s.db.get(DOG_PLAYER_STATS_COLLECTION,'alice').xp,184);
 assert.equal(s.db.get(DOG_PLAYER_STATS_COLLECTION,'alice').xpMatches,1);
});

test('A finishing event with zero gifts, coins or vouchers STILL counts one finished village match',async()=>{
 const s=setup(matchJob({inn:1,academy:1,deltaLights:0,gifts:0,vouchers:[]}));
 const result=await s.settle();
 assert.equal(result.vouchers,0);
 assert.equal(result.creditedTenths,0);
 assert.equal(s.db.calls.reads,9,'two guards + six stats/research + village');
 assert.equal(s.db.calls.writes,5,'3 players + village completion + receipt');
 const village=s.db.get(DOG_VILLAGE_COLLECTION,DOG_GLOBAL_VILLAGE_ID);
 assert.equal(village.matchesCompleted,1);
 assert.equal(village.lightsTenths,0);
});

test('Two scratch tickets for one person require only one wallet read/write',async()=>{
 const s=setup(matchJob({vouchers:[
  {uid:'alice',tier:'simple'},{uid:'alice',tier:'medium'}
 ]}));
 await s.settle();
 assert.equal(s.db.calls.reads,10);
 assert.equal(s.db.calls.writes,6);
 assert.equal(s.db.get(DOG_SCRATCH_COLLECTION,'alice').vouchers.simple,1);
 assert.equal(s.db.get(DOG_SCRATCH_COLLECTION,'alice').vouchers.medium,1);
});

test('Four human players settle exactly four XP records in team mode',async()=>{
 const s=setup(matchJob({humans:4}));
 await s.settle();
 assert.equal(s.db.get(DOG_PLAYER_STATS_COLLECTION,'dana').played,1);
 assert.equal(s.db.get(DOG_PLAYER_STATS_COLLECTION,'alice').wins,1);
 assert.equal(s.db.get(DOG_PLAYER_STATS_COLLECTION,'cara').wins,1);
 assert.equal(s.db.get(DOG_PLAYER_STATS_COLLECTION,'bob').wins,0);
 assert.equal(s.db.calls.writes,8);
});

test('PG ACK crash after all Firestore payouts never pays village, ticket or XP twice',async()=>{
 const s=setup();
 s.pg.failMark=true;
 await assert.rejects(()=>s.settle(),/POSTGRES_ACK_UNAVAILABLE/);
 assert.equal(s.db.calls.writes,7);
 assert.equal(s.pg.done,false);
 const previous={
  xp:clone(s.db.get(DOG_PLAYER_STATS_COLLECTION,'alice')),
  wallet:clone(s.db.get(DOG_SCRATCH_COLLECTION,'alice')),
  village:clone(s.db.get(DOG_VILLAGE_COLLECTION,DOG_GLOBAL_VILLAGE_ID))
 };
 s.pg.failMark=false;
 const replay=await s.bridge().settle({roomCode:'123',matchId:MATCH_ID});
 assert.equal(replay.replayed,true);
 assert.equal(s.db.calls.writes,7,'the match receipt skips every repeat write');
 assert.equal(s.db.calls.reads,13,'retry reads only the 2 receipt guards');
 assert.deepEqual(s.db.get(DOG_PLAYER_STATS_COLLECTION,'alice'),previous.xp);
 assert.deepEqual(s.db.get(DOG_SCRATCH_COLLECTION,'alice'),previous.wallet);
 assert.deepEqual(s.db.get(DOG_VILLAGE_COLLECTION,DOG_GLOBAL_VILLAGE_ID),previous.village);
 assert.equal(s.pg.done,true);
 await assert.rejects(()=>s.settle(),/DOG_PG_SEASONAL_FINAL_NOT_PENDING/);
 assert.equal(s.db.calls.tx,2);
});

test('Firestore transaction failure rolls back ALL winnings, not just XP',async()=>{
 const s=setup();
 s.db.fail(true);
 await assert.rejects(()=>s.settle(),/FIRESTORE_COMMIT_UNAVAILABLE/);
 assert.equal(s.db.calls.writes,0);
 assert.equal(s.db.docs.size,0);
 assert.equal(s.pg.done,false);
 s.db.fail(false);
 await s.settle();
 assert.equal(s.db.calls.writes,7);
 assert.equal(s.db.get(DOG_VILLAGE_COLLECTION,DOG_GLOBAL_VILLAGE_ID).matchesCompleted,1);
});

test('A partially-paid terminal move cannot be paid again through a second bridge',async()=>{
 const s=setup();
 s.db.set(DOG_PG_CHRISTMAS_RECEIPTS_COLLECTION,MATCH_ID+'_'+ACTION_ID,{
  fingerprint:'a'.repeat(64),actionId:ACTION_ID
 });
 await assert.rejects(()=>s.settle(),/DOG_PG_SEASONAL_FINAL_PARTIAL_PAYOUT/);
 assert.equal(s.db.calls.writes,0);
 assert.equal(s.pg.done,false);
});

test('Ordinary XP receipt cannot be re-used for a seasonal final payout',async()=>{
 const s=setup();
 s.db.set(DOG_PG_MATCH_RECEIPTS_COLLECTION,MATCH_ID,{
  roomCode:'123',matchId:MATCH_ID,
  kind:'classic',fingerprint:'a'.repeat(64)
 });
 await assert.rejects(()=>s.settle(),/DOG_PG_SEASONAL_FINAL_RECEIPT_CONFLICT/);
 assert.equal(s.db.calls.writes,0);
});

test('Changing earned lights, ticket, winner or XP counters after ambiguous commit is rejected',async()=>{
 for(const mutate of [
  j=>{j.room.match.christmas.earnedTenths++;},
  j=>{j.vouchers[0].tier='premium';},
  j=>{j.room.match.dog.winner=1;},
  j=>{j.room.match.dogCounters.seats[0].knockedOut++;}
 ]){
  const s=setup();s.pg.failMark=true;
  await assert.rejects(()=>s.settle(),/POSTGRES_ACK_UNAVAILABLE/);
  mutate(s.pg.record);s.pg.failMark=false;
  await assert.rejects(()=>s.settle(),/DOG_PG_SEASONAL_FINAL_RECEIPT_CONFLICT/);
  assert.equal(s.db.calls.writes,7);
 }
});

test('Unrelated UI history updates cannot alter the immutable payout proof',async()=>{
 const s=setup();s.pg.failMark=true;
 await assert.rejects(()=>s.settle(),/POSTGRES_ACK_UNAVAILABLE/);
 s.pg.record.room.match.dog.history=['cosmetic animation changed'];
 s.pg.failMark=false;
 assert.equal((await s.settle()).replayed,true);
 assert.equal(s.db.calls.writes,7);
});

test('Forged roster, invalid winner, false Christmas, missing Inn credit and false counters are rejected before Firestore',async()=>{
 const mutations=[
  j=>{j.room.match.dogRoster[1].uid='intruder';},
  j=>{j.room.match.dogRoster[1].uid='alice';j.before.match.dogRoster[1].uid='alice';},
  j=>{j.room.match.dog.winner=3;},
  j=>{j.room.match.christmas.enabled=false;},
  j=>{j.room.match.christmas.innCredited=false;},
  j=>{j.before.match.christmas.innCredited=true;},
  j=>{j.room.match.dogCounters.recorded=true;},
  j=>{j.room.match.dogCounters.seats[0].knockedOut=-1;},
  j=>{j.room.match.dogCounters.seats[0].knockedOut=2;},
  j=>{j.room.match.dog.phase='play';},
  j=>{j.room.match.dog.revision=41;},
  j=>{j.room.match.christmas.levels.inn=4;},
  j=>{j.vouchers[0].uid='outsider';},
  j=>{j.vouchers[0].tier='mythic';},
  j=>{j.vouchers.pop();},
  j=>{j.room.match.christmas.earnedTenths=19;},
  j=>{j.room.match.christmas.giftCount+=100;},
  j=>{j.room.match.christmas.bonusGiftCount+=3;}
 ];
 for(const mutate of mutations){
  const record=matchJob();mutate(record);
  const s=setup(record);
  await assert.rejects(()=>s.settle(),/DOG_PG_SEASONAL_FINAL_/);
  assert.equal(s.db.calls.tx,0,'invalid record must not query Firebase');
  assert.equal(s.pg.marks,0);
 }
});

test('A previous legacy DOG completion cannot be paid again via Postgres',async()=>{
 const s=setup();
 s.db.set(DOG_PLAYER_STATS_COLLECTION,'alice',{
  played:1,wins:1,xp:130,
  lastMatchId:MATCH_ID,xpLastMatchId:MATCH_ID
 });
 await assert.rejects(()=>s.settle(),/DOG_PG_SEASONAL_FINAL_LEGACY_OVERLAP/);
 assert.equal(s.db.calls.writes,0);
 assert.equal(s.pg.done,false);
});

test('Only UUIDv4 matches and exact authenticated room identity are accepted',async()=>{
 const s=setup();
 for(const args of [
  {roomCode:'../',matchId:MATCH_ID},
  {roomCode:'123',matchId:'chosen-by-user'},
  {roomCode:'123',matchId:'73e4eaa3-24fa-28f2-a14e-a46fd85b2613'}
 ]){
  await assert.rejects(()=>s.bridge().settle(args),/DOG_PG_SEASONAL_FINAL_INVALID_ID/);
 }
 assert.equal(s.pg.loads,0);
});

test('Pure seasonal proof produces a stable digest and hides full private game state',()=>{
 const job=matchJob();
 const first=dogPostgresSeasonalFinalProof(job,'123',MATCH_ID);
 const second=dogPostgresSeasonalFinalProof(clone(job),'123',MATCH_ID);
 assert.equal(first.fingerprint,second.fingerprint);
 assert.equal(first.payload.players.length,3);
 assert.equal(first.payload.rewards.vouchers.length,2);
 assert.equal(first.payload.counters.seats.length,4);
 assert.equal(JSON.stringify(first.payload).includes('deck'),false);
});
