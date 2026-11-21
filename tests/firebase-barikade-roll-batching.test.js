import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const take=(start,end)=>{
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'expected actual Barikade code block');
 return source.slice(a,b);
};
function harness(){
 const docs=new Map(),writes=[];
 const firestore={
  collection(name){return {doc(id){return {path:name+'/'+id}}}},
  async runTransaction(fn){
   const edits=[];
   const tx={
    get:async ref=>{const value=docs.get(ref.path);return {exists:!!value,data:()=>structuredClone(value)}},
    set:(ref,value)=>edits.push({key:ref.path,value:structuredClone(value)})
   };
   const value=await fn(tx);
   for(const e of edits){docs.set(e.key,e.value);writes.push(e.key);}
   return value;
  }
 };
 const code=take('async function bookBarikadeLifetimeStats(', 'async function finalizeMatchStats(');
 const book=new Function('initFirebaseIfConfigured','firestore','normName','isGuestName',
  'statsDocId','STATS_COLLECTION',code+';return bookBarikadeLifetimeStats;')(
  ()=>{},firestore,x=>String(x||''),x=>!x||x==='Gast',x=>x.toUpperCase(),'legacy_stats');
 return {book,docs,writes,firestore};
}
test('New Barikade matches store dice totals in the room instead of per-roll Firestore writes',async()=>{
 assert.match(source,/deferLegacyRollStats:true/);
 assert.match(source,/if\(room\?\.state\?\.matchTrack\?\.deferLegacyRollStats===true\)return;/);
 const text=take('async function recordRollStat(', '// ---------------- Match tracking');
 let writes=0;
 const record=new Function('getPlayerNameByColor','isGuestName','statsUpsert',
  text+';return recordRollStat;')(
  ()=> 'Alice',()=>false,async()=>{writes++;}
 );
 await record({state:{matchTrack:{deferLegacyRollStats:true}}},'red',6);
 assert.equal(writes,0);
 await record({state:{matchTrack:{perColor:{}}}},'red',4);
 assert.equal(writes,1,'existing running games retain legacy roll accounting');
});
test('Completed match books all player lifetime counters once, retries commit no duplicates',async()=>{
 const h=harness(),room={code:'123',state:{matchId:'match-one',startedAt:1000}};
 const patches=[
  {name:'Alice',patch:{games:1,wins:1,rollCount:25,rollSum:98,playMs:900000,forfeits:0}},
  {name:'Bob',patch:{games:1,wins:0,rollCount:28,rollSum:104,playMs:900000,forfeits:1}}
 ];
 assert.equal(await h.book(room,patches),true);
 assert.equal(h.writes.length,2);
 assert.equal(h.docs.get('legacy_stats/ALICE').rollCount,25);
 assert.equal(h.docs.get('legacy_stats/BOB').forfeits,1);
 assert.equal(await h.book(room,patches),true,'replayed match is already booked');
 assert.equal(h.writes.length,2,'replay must not write even one Firebase document');
 room.state.matchId='match-two';
 assert.equal(await h.book(room,[{name:'Alice',patch:{games:1,rollCount:7,rollSum:27,playMs:1000,wins:0,forfeits:0}}]),true);
 assert.equal(h.writes.length,3);
 assert.equal(h.docs.get('legacy_stats/ALICE').games,2);
 assert.equal(h.docs.get('legacy_stats/ALICE').rollCount,32);
});
test('Existing already running matches cannot double-credit lifetime dice totals',()=>{
 assert.match(source,/const deferred=room\.state\.matchTrack\?\.deferLegacyRollStats===true/);
 assert.match(source,/\.\.\.\(deferred\?\{rollCount:/);
 assert.match(source,/if\(await bookBarikadeLifetimeStats\(room,patches\)\)room\.state\.statsFinalized=true/);
 assert.match(source,/!room\.state\.profileStatsFinalizedV8\|\|!room\.state\.statsFinalized/);
});
