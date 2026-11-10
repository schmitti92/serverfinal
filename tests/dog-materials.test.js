import test from 'node:test';
import assert from 'node:assert/strict';
import {installDogMaterialsApi, DOG_MATERIALS_COLLECTION, DOG_CHEST_RECEIPTS_COLLECTION,
 dogInventory,addVerifiedChestToInventory,openDogChestInInventory,rollDogMaterialChest} from '../dog-materials.js';
import {installProfileStats} from '../profile-stats.js';

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
test('Drops are strictly 1–5 units, with published deterministic 35/30/20/10/5 odds',()=>{
 const qs=[0,34,35,64,65,84,85,94,95,99];
 const want=[1,1,2,2,3,3,4,4,5,5];
 for(let n=0;n<qs.length;n++){
  let first=true;
  const drop=rollDogMaterialChest(()=>{if(first){first=false;return qs[n]}return 0});
  assert.equal(drop.count,want[n]);
  assert.equal(Object.values(drop.items).reduce((a,b)=>a+b,0),drop.count);
 }
 const seq=[99,1,75,99,94,40];let i=0;
 assert.deepEqual(rollDogMaterialChest(()=>seq[i++]),{count:5,items:{iron:2,crystal:2,rune:1}});
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
test('Open chest uses server-authoritative count and grants random materials once',async()=>{
 const rolls=[99,1,75,99,94,40];let i=0;
 const f=fixture(()=>rolls[i++]??0);
 f.docs.set(DOG_MATERIALS_COLLECTION+'/'+uid,addVerifiedChestToInventory(null));
 const first=await f.request('POST','/api/dog/materials/open',{requestId:'open-chest-valid-0001',count:999,iron:999});
 assert.equal(first.statusCode,200);
 assert.equal(first.body.drop.count,5);
 assert.deepEqual(first.body.drop.items,{iron:2,crystal:2,rune:1});
 assert.equal(f.inventory().unopened,0);
 assert.equal(f.inventory().opened,1);
 assert.deepEqual(f.inventory().resources,{iron:2,crystal:2,rune:1});
 assert.ok(f.inventory().recent[0].openedAt>1700000000000,'keep real timestamps');
 const writesBefore=f.writes.length,randomBefore=i;
 const replay=await f.request('POST','/api/dog/materials/open',{requestId:'open-chest-valid-0001'});
 assert.equal(replay.body.replayed,true);
 assert.deepEqual(replay.body.drop,first.body.drop);
 assert.equal(f.writes.length,writesBefore);
 assert.equal(i,randomBefore);
 const refused=await f.request('POST','/api/dog/materials/open',{requestId:'open-chest-valid-0002'});
 assert.equal(refused.statusCode,409);
 assert.equal(refused.body.error,'NO_DOG_CHESTS');
});
test('No public endpoint accepts fabricated match completion or chest earnings',async()=>{
 const f=fixture();
 const status=await f.request('GET','/api/dog/materials/me');
 assert.equal(status.statusCode,200);
 assert.equal(status.body.inventory.unopened,0);
 assert.deepEqual(status.body.inventory.resources,{iron:0,crystal:0,rune:0});
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
test('Opening and merging materials never destroys earlier inventory',()=>{
 const before={unopened:2,earned:2,opened:0,resources:{iron:44,crystal:10,rune:1}};
 const drop={count:3,items:{iron:1,crystal:1,rune:1}};
 const after=openDogChestInInventory(before,drop,Date.now());
 assert.equal(after.unopened,1);
 assert.equal(after.resources.iron,45);
 assert.equal(after.resources.crystal,11);
 assert.equal(after.resources.rune,2);
 assert.equal(after.recent[0].count,3);
 assert.equal(dogInventory(after).recent[0].items.rune,1);
});
