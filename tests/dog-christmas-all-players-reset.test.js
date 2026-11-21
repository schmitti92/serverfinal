import test from 'node:test';
import assert from 'node:assert/strict';
import {
 ALL_CHRISTMAS_RESTART_ID,ALL_CHRISTMAS_RESTART_MARKERS,
 ALL_CHRISTMAS_RESTART_ARCHIVES,ALL_CHRISTMAS_CLEAR_COLLECTIONS,
 ALL_CHRISTMAS_ACCESS_COLLECTION,restartDogChristmasForAllOnce
} from '../dog-christmas-all-players-reset.js';
import {CHRISTMAS_EDITIONS} from '../dog-christmas-reset-once.js';
import {DOG_GLOBAL_VILLAGE_ID,DOG_VILLAGE_COLLECTION,dogVillagePublic} from '../dog/christmas-village.js';

const copy=value=>structuredClone(value);
const sampleProfiles=[
 ['chris-test-uid','Chris'],['vanessa-test-uid','Vanessa'],
 ['david-test-uid','David'],['player-nine-uid','Spieler 9'],
 ['guest-test-uid','Weitere Person']
];
function initial(){
 const initial={
  [DOG_VILLAGE_COLLECTION+'/'+DOG_GLOBAL_VILLAGE_ID]:{
   levels:{tower:3,workshop:4,bakery:3,inn:2,luckhouse:2,academy:2},
   lightsTenths:2000,revision:15
  },
  ['deal_wallets_v1/chris-test-uid']:{coins:10000000},
  ['skyjo_stats_v1/player-nine-uid']:{wins:19},
  ['dog_christmas_scratch_settings_v1/global']:{freeEnabled:false,weights:{paid:true}},
  ['spielesammlung_hub_v1/445']:{
   phase:'playing',game:'dog',match:{game:'dog',dog:{phase:'finished'}},
   players:sampleProfiles.slice(0,4).map(([uid])=>({uid,ready:true,participating:true})),
   expiresAt:999999,revision:2,updatedAt:100
  },
  ['spielesammlung_hub_v1/889']:{phase:'playing',game:'skyjo',
   players:[{uid:'guest-test-uid'}],expiresAt:999999,revision:5}
 };
 for(const [uid,name] of sampleProfiles){
  initial['player_profiles_v1/'+uid]={uid,name,setupComplete:true};
  initial['dog_player_statistics_v1/'+uid]={uid,played:5,xp:1700,wins:3};
  initial['dog_christmas_research_v1/'+uid]={uid,levels:{xp:6,win_xp:2}};
  initial['dog_christmas_scratch_wallet_v1/'+uid]={coins:17000,owned:{'prize':true},purchased:13};
  initial['dog_christmas_tree_rewards_v1/'+uid]={claims:{1:'first'}};
  initial['dog_grinch_campaign_v1/'+uid]={completedMissions:[1,2]};
  initial['dog_christmas_intro_unlock_v1/'+uid]={completedAt:10};
  initial['dog_christmas_event_access_v1/'+uid]={uid,access:true,resetId:'old-invite'};
  initial[DOG_VILLAGE_COLLECTION+'/'+uid]={levels:{academy:2},lightsTenths:1000};
 }
 const [collection,id,variant]=CHRISTMAS_EDITIONS[0];
 initial[collection+'/'+id]={id:'old-'+variant,variantId:variant,issued:18,
  paidCoins:2200,maxTotalCoins:15000,createdAt:1,
  prizePlan:Array.from({length:500},(_,i)=>i%5)};
 return initial;
}
function fakeFirestore(source){
 const docs=new Map(Object.entries(copy(source)));
 const ref=path=>({path,get:async()=>snapshot(path)});
 const snapshot=path=>({id:path.split('/').at(-1),ref:ref(path),
  exists:docs.has(path),data:()=>copy(docs.get(path))});
 const collection=name=>({
  __collection:name,
  doc:id=>ref(name+'/'+id),
  get:async()=>({docs:[...docs.keys()].filter(path=>path.startsWith(name+'/')&&
    !path.slice(name.length+1).includes('/')).map(snapshot)})
 });
 const db={collection,runTransaction:async callback=>{
  const operations=[];
  const tx={
   get:async target=>target.__collection?
    collection(target.__collection).get():snapshot(target.path),
   create:(r,data)=>operations.push(['create',r.path,copy(data)]),
   set:(r,data)=>operations.push(['set',r.path,copy(data)]),
   delete:r=>operations.push(['delete',r.path])
  };
  const result=await callback(tx);
  const next=new Map(docs);
  for(const [type,path,data] of operations){
   if(type==='create'&&next.has(path))throw Error('DOCUMENT_ALREADY_EXISTS');
   if(type==='delete')next.delete(path);
   else next.set(path,data);
  }
  docs.clear();for(const [k,v] of next)docs.set(k,v);
  return result;
 }};
 return {db,docs};
}
const archivePath=path=>ALL_CHRISTMAS_RESTART_ARCHIVES+'/'+ALL_CHRISTMAS_RESTART_ID+
 '_'+Buffer.from(path).toString('base64url');
const silent={info(){}};
test('all Christmas event data, including Spieler 9, is archived and reset; academy truly level 1',async()=>{
 const before=initial(),{db,docs}=fakeFirestore(before);
 const result=await restartDogChristmasForAllOnce(db,{clock:()=>10000,logger:silent});
 assert.equal(result.completed,true);
 assert.equal(result.verified,true);
 assert.equal(result.skipped,false);
 assert.equal(result.actualAcademyLevel,1);
 assert.equal(result.profilesGrantedAccess,5);
 assert.equal(result.roomsReopened,1);
 assert.equal(result.sharedVillageReset,true);
 assert.equal(docs.has(DOG_VILLAGE_COLLECTION+'/'+DOG_GLOBAL_VILLAGE_ID),false);
 assert.equal(dogVillagePublic(null,DOG_GLOBAL_VILLAGE_ID).levels.academy,1);
 for(const [uid] of sampleProfiles){
  for(const collection of ALL_CHRISTMAS_CLEAR_COLLECTIONS){
   const path=collection+'/'+uid;
   if(collection===ALL_CHRISTMAS_ACCESS_COLLECTION){
    const grant=docs.get(path);
    assert.equal(grant.firstVisit,true);
    assert.equal(grant.access,true);
    assert.equal(grant.resetId,ALL_CHRISTMAS_RESTART_ID);
    assert.deepEqual(docs.get(archivePath(path)).data,before[path]);
   }else{
    assert.equal(docs.has(path),false,'cleared: '+path);
    if(before[path])assert.deepEqual(docs.get(archivePath(path)).data,before[path]);
   }
  }
  assert.deepEqual(docs.get('player_profiles_v1/'+uid),before['player_profiles_v1/'+uid]);
 }
 assert.deepEqual(docs.get('deal_wallets_v1/chris-test-uid'),before['deal_wallets_v1/chris-test-uid']);
 assert.deepEqual(docs.get('skyjo_stats_v1/player-nine-uid'),before['skyjo_stats_v1/player-nine-uid']);
 assert.deepEqual(docs.get('dog_christmas_scratch_settings_v1/global'),
  before['dog_christmas_scratch_settings_v1/global']);
 assert.equal(docs.get('spielesammlung_hub_v1/445').phase,'lobby');
 assert.equal(docs.get('spielesammlung_hub_v1/445').match,null);
 assert.deepEqual(docs.get('spielesammlung_hub_v1/889'),before['spielesammlung_hub_v1/889']);
 assert.equal(docs.get(ALL_CHRISTMAS_RESTART_MARKERS+'/'+ALL_CHRISTMAS_RESTART_ID).status,'completed');
});
test('all print run counters restart while payout settings and prize distribution survive',async()=>{
 const before=initial(),{db,docs}=fakeFirestore(before);
 const result=await restartDogChristmasForAllOnce(db,{clock:()=>10000,logger:silent});
 assert.equal(result.editionsRestarted,1);
 const [collection,id]=CHRISTMAS_EDITIONS[0];
 const prior=before[collection+'/'+id],next=docs.get(collection+'/'+id);
 assert.equal(next.issued,0);assert.equal(next.paidCoins,0);
 assert.deepEqual([...next.prizePlan].sort(),[...prior.prizePlan].sort());
 assert.equal(next.maxTotalCoins,prior.maxTotalCoins);
 assert.deepEqual(docs.get(archivePath(collection+'/'+id)).data,prior);
});
test('second Render start cannot wipe newly earned Christmas money or new academy upgrades',async()=>{
 const {db,docs}=fakeFirestore(initial());
 await restartDogChristmasForAllOnce(db,{clock:()=>10000,logger:silent});
 docs.set('dog_christmas_scratch_wallet_v1/player-nine-uid',{coins:12000});
 docs.set(DOG_VILLAGE_COLLECTION+'/'+DOG_GLOBAL_VILLAGE_ID,{levels:{academy:2}});
 // Verification of the FIRST reset occurs at the moment it runs. A later
 // legitimate upgrade must not allow the stale reset to replay.
 // The marker short-circuits before ANY writes on subsequent deploys.
 const next=await restartDogChristmasForAllOnce(db,{clock:()=>20000,logger:silent});
 assert.equal(next.skipped,true);
 assert.equal(docs.get('dog_christmas_scratch_wallet_v1/player-nine-uid').coins,12000);
 assert.equal(docs.get(DOG_VILLAGE_COLLECTION+'/'+DOG_GLOBAL_VILLAGE_ID).levels.academy,2);
});
test('new account without prior Christmas data still receives event access for first visit',async()=>{
 const before=initial();
 before['player_profiles_v1/new-user-uid']={uid:'new-user-uid',name:'Neuer Spieler'};
 const {db,docs}=fakeFirestore(before);
 const result=await restartDogChristmasForAllOnce(db,{clock:()=>10000,logger:silent});
 assert.equal(result.profilesGrantedAccess,6);
 assert.equal(docs.get(ALL_CHRISTMAS_ACCESS_COLLECTION+'/new-user-uid').firstVisit,true);
});
test('other-game statistics or invalid profile identity block only unsafe operations',async()=>{
 const before=initial();
 before['player_profiles_v1/player-nine-uid'].uid='wrong-id';
 const {db,docs}=fakeFirestore(before);
 await assert.rejects(()=>restartDogChristmasForAllOnce(db,{clock:()=>10000,logger:silent}),
  /ALL_CHRISTMAS_RESET_INVALID_PROFILE/);
 assert.deepEqual(Object.fromEntries(docs),before);
});
test('legacy unsupported prize print is archived then removed without blocking event reset',async()=>{
 const before=initial(),[collection,id]=CHRISTMAS_EDITIONS[0];
 before[collection+'/'+id]={variantId:'gifts',issued:18};
 const {db,docs}=fakeFirestore(before);
 const result=await restartDogChristmasForAllOnce(db,{clock:()=>10000,logger:silent});
 assert.equal(result.unsupportedEditionsCleared,1);
 assert.equal(docs.has(collection+'/'+id),false);
 assert.deepEqual(docs.get(archivePath(collection+'/'+id)).data,before[collection+'/'+id]);
});
