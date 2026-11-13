import test from 'node:test';
import assert from 'node:assert/strict';
import {installDogMaterialsApi, DOG_MATERIALS_COLLECTION, DOG_CHEST_RECEIPTS_COLLECTION,
 dogInventory,addVerifiedChestToInventory,addExpeditionChestToInventory,
 openExpeditionChestInInventory,openDogChestInInventory,rollDogMaterialChest,
 rollDogChestTier,DOG_CHEST_SIZES,DOG_RESOURCE_GROUPS,DOG_RESOURCES} from '../dog-materials.js';
import {installProfileStats} from '../profile-stats.js';
import {dogChestOffer,DOG_CHEST_TYPES} from '../dog-balance.js';

const uid='material_test_player_0001';
function fixture(random=()=>0){
 const docs=new Map(),routes=new Map(),writes=[];
 const snap=key=>({exists:docs.has(key),data:()=>structuredClone(docs.get(key))});
 const makeRef=key=>({key,
  get:async()=>snap(key),
  collection:name=>({doc:id=>makeRef(key+'/'+name+'/'+id)})
 });
 const store={
  collection:name=>({doc:id=>makeRef(name+'/'+id)}),
  runTransaction:async fn=>{
   const changes=[];let hasWritten=false;
   const tx={
    get:async ref=>{assert.equal(hasWritten,false,'transaction read must precede writes');return snap(ref.key)},
    set:(ref,value,options)=>{hasWritten=true;changes.push([ref.key,value,options?.merge===true,false])},
    create:(ref,value)=>{hasWritten=true;changes.push([ref.key,value,false,true])}
   };
   const result=await fn(tx);
   for(const [key,value,merge,create] of changes){
    if(create&&docs.has(key))throw Error('ALREADY_EXISTS');
    const old=docs.get(key)||{};
    docs.set(key,structuredClone(merge?{...old,...value}:value));writes.push(key);
   }
   return result;
  }
 };
 const app={get:(path,...fns)=>routes.set('GET '+path,fns),post:(path,...fns)=>routes.set('POST '+path,fns)};
 installDogMaterialsApi(app,{verifyProfile:async token=>token==='valid-token'?{uid}:null,getFirestore:()=>store,rand:random});
 const stats=installProfileStats(app,{admin:{apps:[]},getFirestore:()=>store});
 async function request(method,path,body={},token='valid-token'){
  const handlers=routes.get(method+' '+path);assert.ok(handlers,'missing '+path);
  const req={body,get:name=>name==='authorization'?'Bearer '+token:''};
  const res={statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this},status(n){this.statusCode=n;return this},json(value){this.body=value;return value}};
  for(const fn of handlers){
   if(fn.length===3)await new Promise((resolve,reject)=>{
    Promise.resolve(fn(req,res,resolve)).then(()=>{if(res.body)resolve()}).catch(reject);
   });
   else if(!res.body)await fn(req,res);
  }
  return res;
 }
 return {store,docs,writes,request,stats,inventory:()=>docs.get(DOG_MATERIALS_COLLECTION+'/'+uid)};
}
const validPlayers=[
 {uid:'material_test_player_0001',seat:'red',name:'A'},
 {uid:'material_test_player_0002',seat:'blue',name:'B'},
 {uid:'material_test_player_0003',seat:'green',name:'C'}
];
test('Chest tiers: 60% small, 30% medium, 10% large at exact edges',()=>{
 const values=[0,59,60,89,90,99],want=['small','small','medium','medium','large','large'];
 values.forEach((v,i)=>assert.equal(rollDogChestTier(()=>v),want[i]));
 assert.deepEqual(Object.values(DOG_CHEST_SIZES).map(t=>[t.min,t.max]),[[5,10],[10,20],[20,40]]);
 assert.equal(DOG_RESOURCES.length,15);
 assert.equal(new Set(DOG_RESOURCES).size,15);
 assert.equal(Object.keys(DOG_RESOURCE_GROUPS).length,3);
 for(const tier of Object.values(DOG_CHEST_SIZES))assert.equal(tier.rarityWeights.reduce((a,b)=>a+b),1000);
});
test('Each size gives 5-10, 10-20 or 20-40 items and a 15-key breakdown',()=>{
 for(const [tier,low,high] of [['small',5,10],['medium',10,20],['large',20,40]]){
  const min=rollDogMaterialChest(tier,()=>0);
  assert.equal(min.count,low);
  assert.equal(min.items.focus_dust,low);
  assert.equal(Object.keys(min.items).length,15);
  const max=rollDogMaterialChest(tier,limit=>limit-1);
  assert.equal(max.count,high);
  assert.equal(max.items.dragonsteel,high);
  assert.equal(Object.values(max.items).reduce((a,b)=>a+b,0),high);
 }
});
test('Different chests use different rarity odds (one roll per category and material)',()=>{
 for(const [tier,rarities] of Object.entries({
  small:[600,280,100,18,2],medium:[450,320,170,50,10],large:[300,350,230,90,30]
 })){
  const cuts=rarities.reduce((acc,n)=>{acc.push((acc.at(-1)||0)+n);return acc},[]);
  for(let rarity=0;rarity<5;rarity++){
   const roll=rarity===0?0:cuts[rarity-1];
   let calls=0;
   const exact=rollDogMaterialChest(tier,limit=>{
    if(calls++===0)return 0;
    return limit===3?0:roll;
   });
   assert.equal(exact.items[DOG_RESOURCE_GROUPS.attack[rarity]],DOG_CHEST_SIZES[tier].min);
   assert.equal(Object.values(exact.items).reduce((a,b)=>a+b,0),exact.count);
  }
 }
});
test('Barikade records its result once but never grants DOG material chests',async()=>{
 const f=fixture();
 const match={game:'barikade',matchId:'dog-materials-match-0001',players:validPlayers,
  winnerUids:[validPlayers[1].uid],startedAt:Date.now()-360000,finishedAt:Date.now(),reason:'goal'};
 const initial=await f.stats.book(match);
 assert.equal(initial.duplicate,false);
 for(const p of validPlayers){
  const saved=f.docs.get(DOG_MATERIALS_COLLECTION+'/'+p.uid);
  assert.equal(saved,undefined);
  assert.equal(f.docs.get('player_stats_v8/'+p.uid)?.games,1);
 }
 const writesBefore=f.writes.length;
 const repeat=await f.stats.book(match);
 assert.equal(repeat.duplicate,true);
 assert.equal(f.writes.length,writesBefore,'match replay does not duplicate chest credit');
});
test('KreuzKunter records statistics without awarding chests; other games are rejected',async()=>{
 const f=fixture();
 const run=async id=>f.stats.book({game:'kreuz',matchId:id,players:validPlayers,
  winnerUids:[validPlayers[0].uid],startedAt:Date.now()-300000,finishedAt:Date.now(),reason:'completed'});
 await run('dog-materials-kreuz-01');
 await run('dog-materials-kreuz-02');
 assert.equal(f.inventory(),undefined);
 assert.equal(f.docs.get('player_stats_v8/'+uid)?.games,2);
 await assert.rejects(()=>f.stats.book({game:'skyjo',matchId:'dog-materials-unverified-01',
  players:validPlayers,winnerUids:[validPlayers[0].uid],startedAt:Date.now()-300000,finishedAt:Date.now()}),
  /GAME_NOT_VERIFIED/);
 assert.equal(f.inventory(),undefined);
});
test('Opening a LARGE earned chest gives 20-40 real resources once and cannot be faked',async()=>{
 let calls=0;
 const f=fixture(max=>{calls++;return max-1;});
 f.docs.set(DOG_MATERIALS_COLLECTION+'/'+uid,addVerifiedChestToInventory(null,Date.now(),'large'));
 const first=await f.request('POST','/api/dog/materials/open',
  {requestId:'open-chest-valid-0001',tier:'large',count:999,dragonsteel:999});
 assert.equal(first.statusCode,200);
 assert.equal(first.body.drop.count,40);
 assert.equal(first.body.drop.tier,'large');
 assert.equal(first.body.drop.items.dragonsteel,40);
 assert.equal(f.inventory().unopened,0);
 assert.equal(f.inventory().chests.large,0);
 assert.equal(f.inventory().opened,1);
 assert.equal(f.inventory().resources.dragonsteel,40);
 assert.ok(f.inventory().recent[0].openedAt>1700000000000);
 const writesBefore=f.writes.length,randomBefore=calls;
 const replay=await f.request('POST','/api/dog/materials/open',
  {requestId:'open-chest-valid-0001',tier:'small'});
 assert.equal(replay.body.replayed,true);
 assert.deepEqual(replay.body.drop,first.body.drop);
 assert.equal(f.writes.length,writesBefore);
 assert.equal(calls,randomBefore);
 const refused=await f.request('POST','/api/dog/materials/open',{requestId:'open-chest-valid-0002',tier:'small'});
 assert.equal(refused.statusCode,409);
 assert.equal(refused.body.error,'NO_DOG_CHESTS');
});
test('Cannot open a tier that was not earned',async()=>{
 const f=fixture();
 f.docs.set(DOG_MATERIALS_COLLECTION+'/'+uid,addVerifiedChestToInventory(null,Date.now(),'small'));
 const invalid=await f.request('POST','/api/dog/materials/open',{requestId:'wrong-size-request1',tier:'large'});
 assert.equal(invalid.statusCode,409);
 assert.equal(invalid.body.error,'NO_DOG_CHEST_TYPE');
 assert.equal(f.inventory().unopened,1);
 const fake=await f.request('POST','/api/dog/materials/open',{requestId:'wrong-size-request2',tier:'giant'});
 assert.equal(fake.statusCode,400);
 assert.equal(f.inventory().unopened,1);
});
test('No public endpoint accepts fabricated match completion or chest earnings',async()=>{
 const f=fixture();
 const status=await f.request('GET','/api/dog/materials/me');
 assert.equal(status.statusCode,200);
 assert.equal(status.body.inventory.unopened,0);
 assert.equal(Object.keys(status.body.inventory.resources).length,15);
 assert.equal(Object.values(status.body.inventory.resources).reduce((a,b)=>a+b),0);
 assert.equal(status.body.rules.chestMin,5);
 assert.equal(status.body.rules.chestMax,40);
 assert.deepEqual(status.body.rules.verifiedGames,['deal-or-no-deal']);
 for(const token of ['fake-token','']){
  const denied=await f.request('POST','/api/dog/materials/open',{requestId:'open-chest-denied-0001'},token);
  assert.equal(denied.statusCode,401);
 }
 const invalid=await f.request('POST','/api/dog/materials/open',{requestId:'short'});
 assert.equal(invalid.statusCode,400);
 assert.equal(f.inventory(),undefined);
});
test('Receipt persists separately, making repeated requests idempotent beyond history length',async()=>{
 const f=fixture();
 f.docs.set(DOG_MATERIALS_COLLECTION+'/'+uid,addVerifiedChestToInventory(null));
 const first=await f.request('POST','/api/dog/materials/open',{requestId:'old-chest-id-0001'});
 assert.equal(first.statusCode,200);
 assert.ok(f.docs.has(DOG_CHEST_RECEIPTS_COLLECTION+'/'+uid+'_old-chest-id-0001'));
 const replay=await f.request('POST','/api/dog/materials/open',{requestId:'old-chest-id-0001'});
 assert.equal(replay.statusCode,200);
 assert.equal(replay.body.replayed,true);
});
test('Existing inventories retain old chests, resources and history',()=>{
 const before={version:1,unopened:2,earned:2,opened:0,resources:{iron:44,crystal:10,rune:1},
  recent:[{count:3,items:{iron:1,crystal:1,rune:1},openedAt:1710000000000}]};
 const normalized=dogInventory(before);
 assert.equal(normalized.version,3);
 assert.equal(normalized.chests.legacy,2);
 assert.equal(normalized.resources.iron,44);
 assert.equal(normalized.resources.power_crystal,10);
 assert.equal(normalized.resources.war_rune,1);
 assert.equal(normalized.recent[0].items.power_crystal,1);
 const drop=rollDogMaterialChest('small',()=>0);
 const after=openDogChestInInventory(before,drop,Date.now(),'legacy');
 assert.equal(after.unopened,1);
 assert.equal(after.chests.legacy,1);
 assert.equal(after.resources.iron,44);
 assert.equal(after.resources.power_crystal,10);
 assert.equal(after.resources.war_rune,1);
 assert.equal(after.resources.focus_dust,5);
 assert.equal(dogInventory(after).resources.power_crystal,10);
});
test('Existing earned boxes open as a newly selected tier without being lost',async()=>{
 const f=fixture(()=>0);
 f.docs.set(DOG_MATERIALS_COLLECTION+'/'+uid,{version:1,unopened:1,earned:1,opened:0,
  resources:{iron:8,crystal:2,rune:1}});
 const result=await f.request('POST','/api/dog/materials/open',
  {requestId:'legacy-open-request-001',tier:'legacy'});
 assert.equal(result.statusCode,200);
 assert.equal(result.body.drop.tier,'small');
 assert.equal(result.body.drop.count,5);
 assert.equal(result.body.inventory.resources.iron,8);
 assert.equal(result.body.inventory.resources.power_crystal,2);
 assert.equal(result.body.inventory.resources.war_rune,1);
 assert.equal(result.body.inventory.unopened,0);
});

test('Five-type expedition awards are frozen and aggregate without losing old chests',()=>{
 const original=addVerifiedChestToInventory({
  chests:{small:2,medium:1,large:0,legacy:0},resources:{iron:8},earned:3,opened:0
 },Date.now(),'small');
 const earned=dogChestOffer(91,limit=>limit===100?99:limit-1);
 assert.deepEqual(earned,{version:4,stage:9,tier:'legendary',count:30});
 const first=addExpeditionChestToInventory(original,earned);
 const twice=addExpeditionChestToInventory(first,earned);
 assert.equal(twice.expeditionChests.length,1,'same award snapshot aggregates safely');
 assert.equal(twice.expeditionChests[0].quantity,2);
 assert.equal(twice.unopened,6,'legacy three small/medium plus two new');
 assert.equal(twice.chests.small,3);
 assert.equal(twice.chests.medium,1);
 assert.equal(twice.resources.iron,8);
 const opened=openExpeditionChestInInventory(twice,'legendary',()=>0);
 assert.equal(opened.drop.count,30);
 assert.equal(opened.drop.tier,'legendary');
 assert.equal(opened.inventory.unopened,5);
 assert.equal(opened.inventory.expeditionChests[0].quantity,1);
 assert.equal(opened.inventory.chests.small,3);
 assert.equal(opened.inventory.resources.iron,8);
 const last=openExpeditionChestInInventory(opened.inventory,'legendary',()=>0);
 assert.equal(last.inventory.expeditionChests.length,0);
 assert.equal(last.inventory.chests.small,3);
 assert.throws(()=>openExpeditionChestInInventory(last.inventory,'legendary',()=>0),/NO_DOG_CHEST_TYPE/);
});

test('New expedition chest API opens exactly one earned snapshot and replays safely',async()=>{
 const f=fixture(()=>0);
 const old=addVerifiedChestToInventory(null,Date.now(),'large');
 const award=dogChestOffer(1,()=>0);
 const inventory=addExpeditionChestToInventory(old,award);
 f.docs.set(DOG_MATERIALS_COLLECTION+'/'+uid,inventory);
 const first=await f.request('POST','/api/dog/materials/open',
  {tier:'wood',requestId:'expedition-wood-first-0001',count:20,stage:9});
 assert.equal(first.statusCode,200);
 assert.equal(first.body.drop.tier,'wood');
 assert.equal(first.body.drop.count,1);
 assert.equal(first.body.drop.items.focus_dust,1);
 assert.equal(first.body.inventory.chests.large,1,'old large chest retained');
 assert.equal(first.body.inventory.expeditionChests.length,0);
 const writes=f.writes.length;
 const repeated=await f.request('POST','/api/dog/materials/open',
  {tier:'legendary',requestId:'expedition-wood-first-0001'});
 assert.equal(repeated.body.replayed,true);
 assert.equal(repeated.body.drop.count,1);
 assert.equal(f.writes.length,writes);
 const unearned=await f.request('POST','/api/dog/materials/open',
  {tier:'legendary',requestId:'expedition-legendary-fake-0001'});
 assert.equal(unearned.statusCode,409);
 assert.equal(unearned.body.error,'NO_DOG_CHEST_TYPE');
 assert.equal(f.inventory().chests.large,1);
});

test('All five new types can be opened by the old authenticated materials endpoint',async()=>{
 const f=fixture(()=>0);
 let inv=dogInventory(null);
 const levels={wood:1,iron:20,silver:30,gold:50,legendary:80};
 for(const [tier,gate] of Object.entries(levels)){
  const weights={wood:0,iron:70,silver:90,gold:92,legendary:98};
  let calls=0;
  const offer=dogChestOffer(gate,limit=>{
   const roll=calls++===0?weights[tier]:0;
   return roll<limit?roll:0;
  });
  assert.equal(offer.tier,tier,'expected '+tier);
  inv=addExpeditionChestToInventory(inv,offer);
 }
 f.docs.set(DOG_MATERIALS_COLLECTION+'/'+uid,inv);
 const initial=await f.request('GET','/api/dog/materials/me');
 assert.equal(initial.body.inventory.expeditionChests.length,5);
 assert.equal(initial.body.inventory.unopened,5);
 assert.deepEqual(Object.keys(initial.body.rules.expeditionTiers),Object.keys(DOG_CHEST_TYPES));
 for(const tier of Object.keys(levels)){
  const result=await f.request('POST','/api/dog/materials/open',
   {tier,requestId:'expedition-'+tier+'-material-test-0001'});
  assert.equal(result.statusCode,200,tier);
  assert.equal(result.body.drop.tier,tier);
  assert.equal(result.body.inventory.unopened,5-Object.keys(levels).indexOf(tier)-1);
 }
 assert.equal(f.inventory().expeditionChests.length,0);
});

test('Malformed stored expedition snapshots cannot silently erase earned chests',()=>{
 const b=dogInventory(null);
 assert.throws(()=>dogInventory({...b,expeditionChests:[
  {version:4,stage:0,tier:'legendary',count:31,quantity:1}
 ]}),/DOG_CHEST_STORAGE_INVALID/);
 assert.throws(()=>addExpeditionChestToInventory(null,
  {version:4,stage:0,tier:'legendary',count:31}),/DOG_BALANCE_INVALID_CHEST/);
 assert.throws(()=>dogInventory({...b,expeditionChests:[
  {version:4,stage:0,tier:'wood',count:2,quantity:0}
 ]}),/DOG_CHEST_STORAGE_INVALID/);
});

test('100-Tore expedition chest API locks raw materials by shared forge level without a single extra write',async()=>{
 const f=fixture(limit=>limit-1);
 const team='dog_boss_team_v1/first-three-heroes';
 const progress='dog_gate_progress_v1/first-three-heroes';
 f.docs.set(team,{members:[{uid,name:'A'}]});
 f.docs.set(progress,{forgeLevel:1,sharedBosses:[]});
 let bag=dogInventory({resources:{dragonsteel:7}});
 const offer={version:4,tier:'legendary',stage:9,count:30};
 for(let i=0;i<3;i++)bag=addExpeditionChestToInventory(bag,offer);
 bag=addVerifiedChestToInventory(bag,Date.now(),'large');
 f.docs.set(DOG_MATERIALS_COLLECTION+'/'+uid,bag);
 const initial=await f.request('GET','/api/dog/materials/me');
 assert.equal(initial.body.unlockedRarity,0);
 assert.equal(initial.body.forgeLevel,1);
 assert.equal(initial.body.rules.rarityUnlocks.length,5);
 const old=await f.request('POST','/api/dog/materials/open',
  {requestId:'locked-large-chest-0001',tier:'large'});
 assert.equal(old.statusCode,200);
 assert.equal(old.body.drop.items.iron,40);
 assert.equal(old.body.drop.items.dragonsteel,0);
 const first=await f.request('POST','/api/dog/materials/open',
  {requestId:'locked-legendary-0001',tier:'legendary'});
 assert.equal(first.statusCode,200);
 assert.equal(first.body.drop.items.iron,30);
 assert.equal(first.body.drop.items.dragonsteel,0);
 assert.equal(f.inventory().resources.dragonsteel,7,'existing rare inventory is never deleted');
 const count=f.writes.length;
 f.docs.set(progress,{forgeLevel:4,sharedBosses:[10,20,30]});
 const replay=await f.request('POST','/api/dog/materials/open',
  {requestId:'locked-legendary-0001',tier:'legendary'});
 assert.equal(replay.body.replayed,true);
 assert.deepEqual(replay.body.drop,first.body.drop);
 assert.equal(f.writes.length,count);
 const epic=await f.request('POST','/api/dog/materials/open',
  {requestId:'epic-legendary-0002',tier:'legendary'});
 assert.equal(epic.body.unlockedRarity,3);
 assert.equal(epic.body.drop.items.mithril,30);
 assert.equal(epic.body.drop.items.dragonsteel,0);
 f.docs.set(progress,{forgeLevel:6,sharedBosses:[10,20,30,40,50]});
 const legendary=await f.request('POST','/api/dog/materials/open',
  {requestId:'late-legendary-0003',tier:'legendary'});
 assert.equal(legendary.body.unlockedRarity,4);
 assert.equal(legendary.body.drop.items.dragonsteel,30);
 assert.equal(f.inventory().unopened,0);
});
