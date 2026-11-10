import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DOG_HERO_COLLECTION,DOG_FORGE_RECEIPTS_COLLECTION,DOG_FORGE_ITEMS,
 DOG_FORGE_TUNING,dogHero,forgeQuote,forgeUpgrade,forgeExchange,installDogForgeApi
} from '../dog-forge.js';
import {DOG_MATERIALS_COLLECTION,DOG_RESOURCE_GROUPS,DOG_RESOURCES,
 dogInventory,addVerifiedChestToInventory} from '../dog-materials.js';

const uid='hero-test-player';
function fixture(roll=()=>0){
 const docs=new Map(),routes=new Map(),writes=[];
 const snapshot=k=>({exists:docs.has(k),data:()=>structuredClone(docs.get(k))});
 const store={
  collection:name=>({doc:id=>({key:name+'/'+id})}),
  runTransaction:async fn=>{
   const changes=[];let writing=false;
   const tx={
    get:async ref=>{assert.equal(writing,false,'all reads before first write');return snapshot(ref.key);},
    set:(ref,value)=>{writing=true;changes.push({type:'set',key:ref.key,value:structuredClone(value)});},
    create:(ref,value)=>{writing=true;changes.push({type:'create',key:ref.key,value:structuredClone(value)});}
   };
   const output=await fn(tx);
   for(const change of changes){
    if(change.type==='create'&&docs.has(change.key))throw Error('ALREADY_EXISTS');
    docs.set(change.key,change.value);writes.push(change.key);
   }
   return output;
  }
 };
 const app={get:(route,...h)=>routes.set('GET '+route,h),post:(route,...h)=>routes.set('POST '+route,h)};
 // GET requires .get on refs, patch the collection method transparently.
 store.collection=name=>({doc:id=>({key:name+'/'+id,get:async()=>snapshot(name+'/'+id)})});
 installDogForgeApi(app,{
  verifyProfile:async token=>token==='valid-token'?{uid}:null,getFirestore:()=>store,rand:roll
 });
 async function request(method,route,body={},token='valid-token'){
  const handlers=routes.get(method+' '+route);
  assert.ok(handlers,'missing route '+route);
  const req={body,get:name=>name==='authorization'?'Bearer '+token:''};
  const res={statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this;},
   status(n){this.statusCode=n;return this;},json(data){this.body=data;return data;}};
  for(const fn of handlers){
   if(fn.length===3)await new Promise((resolve,reject)=>
    Promise.resolve(fn(req,res,resolve)).then(()=>{if(res.body)resolve();}).catch(reject));
   else if(!res.body)await fn(req,res);
  }
  return res;
 }
 const bag=()=>docs.get(DOG_MATERIALS_COLLECTION+'/'+uid);
 const hero=()=>docs.get(DOG_HERO_COLLECTION+'/'+uid);
 const seed=(resources,levels={})=>{
  const inventory=dogInventory(null);
  Object.assign(inventory.resources,resources);
  docs.set(DOG_MATERIALS_COLLECTION+'/'+uid,inventory);
  docs.set(DOG_HERO_COLLECTION+'/'+uid,{...dogHero(null),levels:{...dogHero(null).levels,...levels}});
 };
 return {request,docs,writes,seed,bag,hero};
}

test('Forge is independently expandable: 2 equipment + 5 attack + 6 defense items',()=>{
 assert.equal(DOG_FORGE_ITEMS.length,13);
 assert.equal(DOG_FORGE_ITEMS.filter(i=>i.group==='equipment').length,2);
 assert.equal(DOG_FORGE_ITEMS.filter(i=>i.group==='attack').length,5);
 assert.equal(DOG_FORGE_ITEMS.filter(i=>i.group==='defense').length,6);
 assert.equal(DOG_FORGE_ITEMS.find(i=>i.id==='weapon').maxLevel,20);
 assert.equal(DOG_FORGE_ITEMS.find(i=>i.id==='armor').maxLevel,20);
 assert.equal(DOG_FORGE_ITEMS.filter(i=>i.group!=='equipment').every(i=>i.maxLevel===50),true);
 assert.equal(dogHero(null).levels.weapon,1);
 assert.equal(dogHero(null).levels.armor,1);
 assert.equal(dogHero(null).levels.regeneration,0);
 assert.equal(DOG_FORGE_TUNING.exchangeRate,10);
});
test('All upgrade recipes match item resource categories at every level',()=>{
 for(const item of DOG_FORGE_ITEMS){
  for(let level=item.baseLevel;level<item.maxLevel;level++){
   const quote=forgeQuote(item.id,level);
   assert.equal(quote.nextLevel,level+1);
   assert.equal(quote.maxed,false);
   assert.ok(Object.keys(quote.cost).length>0);
   for(const [resource,qty] of Object.entries(quote.cost)){
    assert.ok(DOG_RESOURCE_GROUPS[item.group].includes(resource),item.id+' used '+resource);
    assert.ok(Number.isInteger(qty)&&qty>0);
   }
   assert.ok(quote.successChance>=1&&quote.successChance<=100);
  }
  const maxQuote=forgeQuote(item.id,item.maxLevel);
  assert.equal(maxQuote.maxed,true);assert.deepEqual(maxQuote.cost,{});
 }
 assert.equal(DOG_RESOURCES.length,15);
});
test('Weapon crafting consumes exact materials, raises hero and keeps chest balance',async()=>{
 const f=fixture();
 f.seed({iron:16});
 const old=f.bag();old.chests.small=2;old.unopened=2;old.earned=2;f.docs.set(DOG_MATERIALS_COLLECTION+'/'+uid,old);
 const first=await f.request('POST','/api/dog/forge/upgrade',
  {requestId:'forge-weapon-upgrade-001',itemId:'weapon',expectedLevel:1});
 assert.equal(first.statusCode,200);
 assert.equal(first.body.result.success,true);
 assert.equal(first.body.result.newLevel,2);
 assert.equal(first.body.hero.levels.weapon,2);
 assert.equal(first.body.inventory.resources.iron,13);
 assert.equal(first.body.inventory.unopened,2);
 assert.equal(first.body.inventory.chests.small,2);
 assert.equal(f.hero().levels.weapon,2);
 const previousWrites=f.writes.length;
 const replay=await f.request('POST','/api/dog/forge/upgrade',
  {requestId:'forge-weapon-upgrade-001',itemId:'weapon',expectedLevel:1});
 assert.equal(replay.statusCode,200);
 assert.equal(replay.body.replayed,true);
 assert.equal(replay.body.hero.levels.weapon,2);
 assert.equal(replay.body.inventory.resources.iron,13);
 assert.equal(f.writes.length,previousWrites);
 const stale=await f.request('POST','/api/dog/forge/upgrade',
  {requestId:'forge-weapon-upgrade-002',itemId:'weapon',expectedLevel:1});
 assert.equal(stale.statusCode,409);
 assert.equal(stale.body.error,'STALE_FORGE_LEVEL');
});
test('Failed forging consumes materials but never reduces current level',async()=>{
 const f=fixture(()=>9999);
 f.seed({mithril:9,dragonsteel:2},{weapon:19});
 const attempt=await f.request('POST','/api/dog/forge/upgrade',
  {requestId:'forge-failure-test-001',itemId:'weapon',expectedLevel:19});
 assert.equal(attempt.statusCode,200);
 assert.equal(attempt.body.result.success,false);
 assert.equal(attempt.body.result.newLevel,19);
 assert.equal(attempt.body.result.chance,25);
 assert.equal(f.hero().levels.weapon,19);
 assert.equal(f.hero().failures,1);
 assert.equal(f.bag().resources.mithril,5);
 assert.equal(f.bag().resources.dragonsteel,1);
});
test('Skill upgrades always succeed despite maximal random roll',()=>{
 const inv=dogInventory(null);inv.resources.life_dust=2;
 const built=forgeUpgrade(null,inv,'regeneration',0,9999);
 assert.equal(built.result.success,true);
 assert.equal(built.hero.levels.regeneration,1);
 assert.equal(built.inventory.resources.life_dust,1);
});
test('10:1 exchange cannot cross groups, duplicate or mint free resources',async()=>{
 const f=fixture();
 f.seed({focus_dust:22,power_crystal:2});
 const first=await f.request('POST','/api/dog/forge/exchange',
  {requestId:'forge-exchange-test-001',resourceId:'focus_dust'});
 assert.equal(first.statusCode,200);
 assert.deepEqual(first.body.result,{type:'exchange',from:'focus_dust',
  to:'power_crystal',spent:10,received:1});
 assert.equal(f.bag().resources.focus_dust,12);
 assert.equal(f.bag().resources.power_crystal,3);
 const writes=f.writes.length;
 const replay=await f.request('POST','/api/dog/forge/exchange',
  {requestId:'forge-exchange-test-001',resourceId:'focus_dust'});
 assert.equal(replay.body.replayed,true);
 assert.equal(f.writes.length,writes);
 const invalid=await f.request('POST','/api/dog/forge/exchange',
  {requestId:'forge-exchange-test-002',resourceId:'dragonsteel'});
 assert.equal(invalid.statusCode,400);
 assert.equal(invalid.body.error,'INVALID_EXCHANGE_RESOURCE');
 const second=await f.request('POST','/api/dog/forge/exchange',
  {requestId:'forge-exchange-test-003',resourceId:'focus_dust'});
 assert.equal(second.statusCode,200);
 const insufficient=await f.request('POST','/api/dog/forge/exchange',
  {requestId:'forge-exchange-test-004',resourceId:'focus_dust'});
 assert.equal(insufficient.statusCode,409);
 assert.equal(insufficient.body.error,'DOG_MATERIALS_MISSING');
 assert.equal(f.bag().resources.focus_dust,2);
});
test('Forge is authenticated; server rejects fabricated free upgrades',async()=>{
 const f=fixture();
 const unauth=await f.request('POST','/api/dog/forge/upgrade',
  {requestId:'forge-auth-test-00001',itemId:'weapon',expectedLevel:1},'fake');
 assert.equal(unauth.statusCode,401);
 const invalid=await f.request('POST','/api/dog/forge/upgrade',
  {requestId:'forge-no-cheat-00001',itemId:'weapon',expectedLevel:1,
   cost:0,success:true,resources:{iron:999999}});
 assert.equal(invalid.statusCode,409);
 assert.equal(invalid.body.error,'DOG_MATERIALS_MISSING');
 assert.equal(f.hero(),undefined);
 assert.equal(f.bag(),undefined);
 const state=await f.request('GET','/api/dog/forge/me');
 assert.equal(state.statusCode,200);
 assert.equal(state.body.hero.levels.weapon,1);
 assert.equal(state.body.quotes.length,13);
 assert.equal(state.body.inventory.unopened,0);
});
test('A chest award keeps forge stock while adding a chest',()=>{
 const inventory=dogInventory(null);inventory.resources.iron=16;
 const upgraded=forgeUpgrade(null,inventory,'weapon',1,0);
 const next=addVerifiedChestToInventory(upgraded.inventory,Date.now(),'medium');
 assert.equal(next.resources.iron,13);
 assert.equal(next.chests.medium,1);
 assert.equal(next.unopened,1);
});

test('Forge book journal records success, failure and exchange with no new reads',async()=>{
 const f=fixture(()=>9999);
 f.seed({iron:15,mithril:9,dragonsteel:2,focus_dust:11},{weapon:19});
 const failed=await f.request('POST','/api/dog/forge/upgrade',
  {requestId:'journal-failure-0001',itemId:'weapon',expectedLevel:19});
 assert.equal(failed.statusCode,200);
 assert.equal(failed.body.hero.recent.length,1);
 assert.deepEqual(failed.body.hero.recent[0].type,'upgrade');
 assert.equal(failed.body.hero.recent[0].success,false);
 assert.equal(failed.body.hero.recent[0].level,19);
 const exchanged=await f.request('POST','/api/dog/forge/exchange',
  {requestId:'journal-exchange-001',resourceId:'focus_dust'});
 assert.equal(exchanged.statusCode,200);
 assert.equal(exchanged.body.hero.recent[0].type,'exchange');
 assert.equal(exchanged.body.hero.recent[0].from,'focus_dust');
 assert.equal(exchanged.body.hero.recent[1].itemId,'weapon');
 const writes=f.writes.length;
 const repeated=await f.request('POST','/api/dog/forge/exchange',
  {requestId:'journal-exchange-001',resourceId:'focus_dust'});
 assert.equal(repeated.statusCode,200);
 assert.equal(repeated.body.replayed,true);
 assert.deepEqual(repeated.body.hero.recent,exchanged.body.hero.recent);
 assert.equal(f.writes.length,writes);
 const fetched=await f.request('GET','/api/dog/forge/me');
 assert.deepEqual(fetched.body.hero.recent,exchanged.body.hero.recent);
});
test('Forge journal remains bounded to ten events and safely handles legacy data',()=>{
 let h=null,bag=dogInventory(null);
 for(const key of DOG_RESOURCES)bag.resources[key]=100;
 for(let i=0;i<12;i++){
  const result=forgeUpgrade(h,bag,'regeneration',i,0,1000+i);
  h=result.hero;bag=result.inventory;
 }
 assert.equal(h.recent.length,10);
 assert.equal(h.recent[0].level,12);
 assert.equal(h.recent[9].level,3);
 assert.equal(h.successes,12);
 const restored=dogHero({...h,recent:[null,{type:'unknown'},...h.recent]});
 assert.equal(restored.recent.length,8);
 assert.equal(restored.levels.regeneration,12);
 assert.deepEqual(dogHero({levels:{weapon:10}}).recent,[]);
});
