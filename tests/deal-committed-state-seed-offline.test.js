import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDealCommittedStateSeed} from '../deal-committed-state-seed.js';
import {installDealOrNoDeal} from '../deal-or-no-deal-api.js';
import {create} from '../deal-or-no-deal.js';

test('Only committed public states seed a 2.5s bounded read snapshot',()=>{
 let now=100000;
 const cache=createDealCommittedStateSeed({clock:()=>now,ttlMs:2500});
 const game={id:'match_one',revision:2,phase:'select'};
 const view={...game,caseCount:26};
 const entry=cache.seed('ABC234',game,view);
 assert.ok(entry?.committed);
 assert.equal(entry.expires,102500);
 assert.equal(cache.stats().seeds,1);
 now+=2501;
 assert.ok(entry.expires<now,'a following HTTP request must fetch Firestore when TTL ends');
 assert.equal(cache.seed('ABC234',game,{...view,revision:100}),null,'never seed an unrelated snapshot');
 assert.equal(cache.stats().seeds,1);
});

test('Delayed broadcasts never replace a newer locally committed revision',async()=>{
 const seed=createDealCommittedStateSeed();
 const g={id:'match_one',revision:7,phase:'open'};
 const newer=seed.seed('ABC234',g,{...g});
 assert.ok(newer);
 const old=seed.seed('ABC234',{...g,revision:6},{...g,revision:6});
 assert.equal(old,null);
 assert.equal((await newer.promise).revision,7);
 assert.equal(seed.stats().staleSkipped,1);
 const final={...g,phase:'final',revision:9};
 assert.ok(seed.seed('ABC234',final,{...final}));
 const nextGame={id:'match_two',revision:0,phase:'select'};
 assert.ok(seed.seed('ABC234',nextGame,{...nextGame}),
  'new matches legitimately restart revision after the previous final');
 assert.equal(seed.seed('ABC234',{...final,revision:10},{...final,revision:10}),null,
  'delayed old finale must not overwrite the next match');
});

test('HTTP GET reuses the locally committed public state without losing auth or fresh membership checks',async()=>{
 const routes=new Map();
 const app={
  get:(path,...handlers)=>routes.set('GET '+path,handlers),
  post:(path,...handlers)=>routes.set('POST '+path,handlers)
 };
 const code='ABC234',uid='alice';
 let databaseGets=0,membershipGets=0;
 let saved=create([{id:uid,name:'Alice'}],undefined,26);
 const db={collection:name=>({doc:id=>({get:async()=>{
  if(name==='deal_or_no_deal_matches_v1'){
   assert.equal(id,code);
   databaseGets++;
   return {exists:true,data:()=>({game:structuredClone(saved)})};
  }
  if(name==='spielesammlung_hub_v1'){
   assert.equal(id,code);
   membershipGets++;
   return {exists:true,data:()=>({players:[{uid}],hostUid:uid})};
  }
  throw Error('UNEXPECTED_COLLECTION_'+name);
 }})})};
 const api=installDealOrNoDeal(app,{
  getFirestore:()=>db,
  verifyProfile:async token=>['alice','bob'].includes(token)?{uid:token,name:token}:null
 });
 async function get(token){
  const handlers=routes.get('GET /api/deal-or-no-deal/:code');
  assert.ok(handlers,'original authenticated GET route must remain registered');
  const req={params:{code},query:{syncReason:'slot'},get:key=>key==='authorization'?'Bearer '+token:''};
  const res={
   statusCode:200,status(value){this.statusCode=value;return this},
   json(body){this.body=body;return body}
  };
  for(const handler of handlers){
   if(res.body)break;
   if(handler.length===3){
    await new Promise((resolve,reject)=>{
     Promise.resolve(handler(req,res,resolve)).catch(reject);
    });
   }else await handler(req,res);
  }
  return res;
 }
 // Represents the very same state an authoritative transaction has just
 // returned, after the new game document was persisted.
 api.notifyGameChanged(code,saved);
 const first=await get('alice');
 assert.equal(first.statusCode,200);
 assert.equal(first.body.game.id,saved.id);
 assert.equal(first.body.game.revision,0);
 assert.equal(first.body.game.values,undefined,'secret suitcase amounts never enter public read cache');
 assert.equal(databaseGets,0,'no redundant game document GET after a confirmed update');
 assert.equal(membershipGets,1,'auth and room membership still checked independently');
 assert.equal(api.commitSeedStats().readHits,1);
 const denied=await get('bob');
 assert.equal(denied.statusCode,403);
 assert.equal(denied.body.error,'NOT_IN_ROOM');
 assert.equal(databaseGets,0,'outsiders cannot retrieve the public room game');
 saved={...saved,revision:1};
 api.notifyGameChanged(code,saved);
 const next=await get('alice');
 assert.equal(next.statusCode,200);
 assert.equal(next.body.game.revision,1);
 assert.equal(databaseGets,0,'the next confirmed revision also arrives without an extra Firestore GET');
 assert.equal(api.commitSeedStats().readHits,2);
});

test('No payment, receipt or game mutation uses a seeded public projection',()=>{
 const api=readFileSync(new URL('../deal-or-no-deal-api.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 assert.match(api,/rewardReadCoordinator\.invalidateAll\(\);\s*const view=publicView\(game\);\s*seedCommittedGameView\(code,game,view\)/);
 assert.match(api,/const entry=committedStateSeed\.seed\(code,game,view\)/);
 assert.match(api,/const game=await readGame\(db,code,readSource\)/);
 assert.match(api,/await check\(db,code,req\.dealIdentity\.uid,true,readSource\)/);
 assert.match(api,/app\.post\('\/api\/deal-or-no-deal\/:code\/action'[\s\S]*?db\.runTransaction/);
 assert.match(api,/tx\.create\(e\.receipt/);
 assert.match(api,/tx\.get\(gameRef\)/);
 assert.match(server,/dealGameCommitSeeds:dealOrNoDealOnline\.commitSeedStats\(\)/);
});
