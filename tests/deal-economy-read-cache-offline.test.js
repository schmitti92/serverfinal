import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDealEconomyReadCache} from '../deal-economy-read-cache.js';
import {installDogAlbumSeason2} from '../dog-album-season2.js';

function fixture(){
 let now=1000,reads=0,failNext=false,gate=null;
 let current={revision:1,prices:{goldRare:25000000,goldLegendary:150000000},slotWeights:{cash:700,chest:100,pack:100,hammer:50,joker:30,minigame:10,monster:10}};
 const db={collection:name=>{
  assert.equal(name,'deal_or_no_deal_economy_v1');
  return {doc:id=>{
   assert.equal(id,'global');
   return {get:async()=>{
    reads++;
    if(failNext){failNext=false;throw Error('SIMULATED_FIRESTORE_OUTAGE')}
    const captured=structuredClone(current);
    if(gate)await gate;
    return {exists:true,data:()=>captured};
   }};
  }};
 }};
 const cache=createDealEconomyReadCache({clock:()=>now,ttlMs:15000});
 return {db,cache,reads:()=>reads,advance:ms=>{now+=ms},setPrices:next=>{current={...current,revision:current.revision+1,prices:{...current.prices,...next}}},fail:()=>{failNext=true},delay:()=>{let resolve;gate=new Promise(r=>resolve=r);return ()=>{gate=null;resolve()}}};
}

test('Global slot catalogue and card views share one Firestore economy read',async()=>{
 const h=fixture(),resume=h.delay();
 const first=h.cache.read(h.db),second=h.cache.read(h.db),third=h.cache.read(h.db);
 resume();
 const results=await Promise.all([first,second,third]);
 assert.ok(results.every(x=>x.revision===1));
 assert.equal(h.reads(),1,'simultaneous global reads are coalesced');
 assert.equal(h.cache.stats().coalesced,2);
 for(let i=0;i<20;i++)assert.equal((await h.cache.read(h.db)).revision,1);
 assert.equal(h.cache.stats().cacheHits,20);
 assert.equal(h.reads(),1,'cached display state saves billable Firestore reads');
 h.advance(15001);
 assert.equal((await h.cache.read(h.db)).revision,1);
 assert.equal(h.reads(),2,'TTL expiry restores a fresh Firestore snapshot');
});

test('Confirmed host economy change invalidates Render display cache immediately',async()=>{
 const h=fixture();
 assert.equal((await h.cache.read(h.db)).prices.goldRare,25000000);
 h.setPrices({goldRare:40000000});
 h.cache.invalidate();
 assert.equal((await h.cache.read(h.db)).prices.goldRare,40000000);
 assert.equal(h.reads(),2);
 assert.equal(h.cache.stats().invalidations,1);
});

test('In-flight stale read cannot repopulate the price cache after host update',async()=>{
 const h=fixture(),resume=h.delay();
 const stale=h.cache.read(h.db);
 h.setPrices({goldRare:80000000});
 h.cache.invalidate();
 resume();
 const result=await stale;
 assert.equal(result.prices.goldRare,80000000,'the request must retry after invalidation');
 assert.equal(h.reads(),2);
 assert.equal((await h.cache.read(h.db)).prices.goldRare,80000000);
 assert.equal(h.reads(),2);
});

test('Firestore read failures are never cached',async()=>{
 const h=fixture();
 h.fail();
 await assert.rejects(()=>h.cache.read(h.db),/SIMULATED_FIRESTORE_OUTAGE/);
 const ok=await h.cache.read(h.db);
 assert.equal(ok.revision,1);
 assert.equal(h.reads(),2);
});

test('Only GET display routes use the cache; slot settlement and purchases still transact',()=>{
 const source=readFileSync(new URL('../deal-or-no-deal-api.js',import.meta.url),'utf8');
 assert.match(source,/createDealEconomyReadCache\(\)/);
 assert.match(source,/app\.get\('\/api\/deal-or-no-deal\/monster-slots\/catalog'[\s\S]*?economyReadCache\.read\(db\)/);
 assert.match(source,/app\.get\('\/api\/deal-or-no-deal\/:code\/economy'[\s\S]*?economyReadCache\.read\(db\)/);
 assert.match(source,/const \[wallet,snap,economy\]=await Promise\.all\(\[readDisplayWallet\(db,uid\),db\.collection\(CARD_COLLECTION\).*?economyReadCache\.read\(db\)\]\)/);
 assert.match(source,/tx\.get\(dealEconomyRef\(db\)\)/);
 assert.match(source,/tx\.get\(economyRef\)/);
 assert.match(source,/economyReadCache\.invalidate\(\)/);
});


test('DOG album inventory displays share the slot catalogue economy cache',async()=>{
 const h=fixture(),routes=new Map();
 const app={get:(route,_auth,fn)=>routes.set(route,fn),post:()=>{}};
 const db={collection:name=>{
  if(name==='deal_or_no_deal_economy_v1')return h.db.collection(name);
  return {doc:()=>({get:async()=>({exists:false,data:()=>({})})})};
 }};
 installDogAlbumSeason2(app,{
  auth:()=>{},getFirestore:()=>db,
  fail:(_res,e)=>{throw e},
  readDisplayEconomy:db=>h.cache.read(db)
 });
 const handler=routes.get('/api/deal-or-no-deal/christmas/season2/me');
 assert.equal(typeof handler,'function');
 const call=async uid=>{
  const res={set(){return this},json(payload){this.payload=payload;return payload}};
  await handler({dealIdentity:{uid}},res);
  assert.equal(res.payload.ok,true);
  return res.payload;
 };
 const a=await call('user_one_111'),b=await call('user_two_222');
 assert.equal(h.reads(),1,'all players and slot displays share a single economy document read');
 assert.ok(a.packs.length>0);
 assert.deepEqual(b.packs,a.packs);
 h.setPrices({dogSmall:54321000});
 h.cache.invalidate();
 const updated=await call('user_one_111');
 assert.equal(updated.packs.find(p=>p.id==='small').price,54321000);
 assert.equal(h.reads(),2);
});

test('DOG album display cache is injected only into its GET handler, not purchase settlement',()=>{
 const source=readFileSync(new URL('../deal-or-no-deal-api.js',import.meta.url),'utf8');
 const album=readFileSync(new URL('../dog-album-season2.js',import.meta.url),'utf8');
 assert.match(source,/readDisplayEconomy:db=>economyReadCache\.read\(db\)/);
 assert.match(album,/readDisplayEconomy\(db\)/);
 assert.match(album,/app\.post\(base\+'\/open'[\s\S]*?db\.runTransaction/);
});
