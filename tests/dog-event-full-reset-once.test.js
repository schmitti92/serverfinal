import test from 'node:test';
import assert from 'node:assert/strict';
import {
 resetFullDogEventOnce,DOG_FULL_RESET_ID,DOG_FULL_RESET_PLAYER_COLLECTIONS,
 DOG_FULL_RESET_MARKER_COLLECTION,DOG_FULL_RESET_ARCHIVE_COLLECTION
} from '../dog-event-full-reset-once.js';

function fakeFirestore(seed={}){
 const store=new Map(Object.entries(seed));
 const ref=path=>({
  path,id:path.slice(path.lastIndexOf('/')+1),
  get:async()=>({exists:store.has(path),data:()=>store.get(path)}),
 });
 const collection=name=>({
  id:name,
  doc:id=>ref(name+'/'+id),
  get:async()=>({docs:[...store.entries()].filter(([path])=>
   path.startsWith(name+'/')&&path.slice(name.length+1).indexOf('/')<0)
   .map(([path,data])=>({...ref(path),data:()=>data}))})
 });
 const getCollections=()=>new Set([...store.keys()].map(path=>path.split('/')[0]));
 return {store,collection,doc:ref,listCollections:async()=>
  [...getCollections()].map(id=>({id})),
  batch:()=>{const mutations=[];return {
   create:(target,data)=>mutations.push(['create',target.path,data]),
   delete:target=>mutations.push(['delete',target.path]),
   set:(target,data)=>mutations.push(['set',target.path,data]),
   commit:async()=>{
    // Simulate an atomic batch. Create cannot overwrite old audit data.
    const updates=new Map(store);
    for(const [op,path,value] of mutations){
     if(op==='create'&&updates.has(path))throw Error('ALREADY_EXISTS '+path);
     if(op==='delete')updates.delete(path);
     else updates.set(path,value);
    }
    store.clear();for(const [key,value] of updates)store.set(key,value);
   }
  }}
 };
}

test('complete DOG reset archives all resources, forge, map, boss, S2 cards and EVERY monthly leaderboard',async()=>{
 const fake=fakeFirestore({
  'dog_material_inventory_v1/alice':{resources:{holz:100},unopened:5},
  'dog_material_inventory_v1/bob':{resources:{eisen:40}},
  'dog_heroes_v1/alice':{levels:{weapon:23,armor:19}},
  'dog_private_100_gates_v1/owner':{progress:{people:{alice:{currentGate:92}}}},
  'deal_dog_album_season2_v1/alice':{cards:{'dog2-001':3},completedBoards:[2,5],tournamentPoints:250},
  'deal_dog_album_season2_v1/bob':{cards:{'dog2-016':1},wildcardTickets:12},
  'dog_s2_monthly_tournaments_v1_2026-09/alice':{points:45},
  'dog_s2_monthly_tournaments_v1_2026-10/alice':{points:135},
  'dog_s2_monthly_tournaments_v1_2026-11/alice':{points:250},
  'dog_s2_monthly_tournaments_v1_2026-11/bob':{points:90},
  'dog_gate_progress_v1/first-three-heroes':{people:{alice:{currentGate:85}},sharedBosses:[10,20,30]},
  'dog_boss_team_v1/first-three-heroes':{members:[{uid:'alice',name:'A'}, {uid:'bob',name:'B'}],phase:'fighting'},
  'dog_live_pilot_owner_v1/100-gates-owner':{uid:'alice',enabled:true},
  'deal_or_no_deal_wallets_v1/alice':{balance:500000000},
  'deal_or_no_deal_christmas_v1/alice':{cards:{'christmas-1':2},hammerBingoClaimed:5},
  'dog_gate_fight_receipts_v1/alice_old-id':{result:{win:true}},
  'dog_event_maintenance_v1/2026-11-13-first-public-start-v1':{status:'completed'}
 });
 const messages=[];
 const out=await resetFullDogEventOnce(fake,{info:(...args)=>messages.push(args)});
 assert.equal(out.done,true);
 assert.equal(out.skipped,false);
 assert.equal(out.playerDocsCleared,10);
 assert.equal(out.leaderboardsCleared,3);
 assert.deepEqual(DOG_FULL_RESET_PLAYER_COLLECTIONS,[
  'dog_material_inventory_v1','dog_hero_inventory_v1',
  'dog_private_100_gates_v1','deal_dog_album_season2_v1'
 ]);
 const key=path=>DOG_FULL_RESET_ID+'_'+Buffer.from(path).toString('base64url');
 for(const [path,data] of Object.entries({
  'dog_material_inventory_v1/alice':{resources:{holz:100},unopened:5},
  'deal_dog_album_season2_v1/alice':{cards:{'dog2-001':3},completedBoards:[2,5],tournamentPoints:250},
  'dog_s2_monthly_tournaments_v1_2026-10/alice':{points:135},
  'dog_gate_progress_v1/first-three-heroes':{people:{alice:{currentGate:85}},sharedBosses:[10,20,30]}
 })){
  assert.equal(fake.store.has(path),path==='dog_gate_progress_v1/first-three-heroes');
  assert.deepEqual(fake.store.get(DOG_FULL_RESET_ARCHIVE_COLLECTION+'/'+key(path)).data,data);
 }
 for(const path of [
  'dog_material_inventory_v1/alice','dog_material_inventory_v1/bob',
  'deal_dog_album_season2_v1/alice','deal_dog_album_season2_v1/bob',
  'dog_s2_monthly_tournaments_v1_2026-09/alice',
  'dog_s2_monthly_tournaments_v1_2026-10/alice',
  'dog_s2_monthly_tournaments_v1_2026-11/alice',
  'dog_s2_monthly_tournaments_v1_2026-11/bob',
  'dog_live_pilot_owner_v1/100-gates-owner'
 ])assert.equal(fake.store.has(path),false,path+' must be cleared');
 assert.deepEqual(fake.store.get('dog_boss_team_v1/first-three-heroes').members,[]);
 assert.deepEqual(fake.store.get('dog_gate_progress_v1/first-three-heroes').people,{});
 assert.deepEqual(fake.store.get('dog_gate_progress_v1/first-three-heroes').sharedBosses,[]);
 assert.deepEqual(fake.store.get('deal_or_no_deal_wallets_v1/alice'),{balance:500000000});
 assert.deepEqual(fake.store.get('deal_or_no_deal_christmas_v1/alice'),
  {cards:{'christmas-1':2},hammerBingoClaimed:5});
 assert.ok(fake.store.has('dog_gate_fight_receipts_v1/alice_old-id'));
 assert.ok(fake.store.has('dog_event_maintenance_v1/2026-11-13-first-public-start-v1'));
 assert.equal(fake.store.get(DOG_FULL_RESET_MARKER_COLLECTION+'/'+DOG_FULL_RESET_ID).status,'completed');
 assert.equal(messages.length,1);
 const archived=fake.store.get(DOG_FULL_RESET_ARCHIVE_COLLECTION+'/'+key('dog_boss_team_v1/first-three-heroes'));
 assert.equal(archived.data.members.length,2);
 const second=await resetFullDogEventOnce(fake);
 assert.equal(second.skipped,true);
 fake.store.set('deal_dog_album_season2_v1/alice',{cards:{'dog2-001':1}});
 assert.equal((await resetFullDogEventOnce(fake)).skipped,true);
 assert.ok(fake.store.has('deal_dog_album_season2_v1/alice'),
  'the one-shot reset must NEVER wipe newly earned cards on a later startup');
});
