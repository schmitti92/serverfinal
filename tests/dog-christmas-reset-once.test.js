import test from 'node:test';
import assert from 'node:assert/strict';
import {
 resetDogChristmasEventOnce,CHRISTMAS_PLAYER_COLLECTIONS,CHRISTMAS_EDITIONS,
 CHRISTMAS_RESET_MARKERS,CHRISTMAS_RESET_ARCHIVES,CHRISTMAS_RESET_ID
} from '../dog-christmas-reset-once.js';

const copy=x=>structuredClone(x);
function memoryFirestore(initial={}){
 const docs=new Map(Object.entries(copy(initial)));
 const doc=path=>({path,get:async()=>snapshot(path)});
 const snapshot=path=>({id:path.split('/').at(-1),exists:docs.has(path),data:()=>copy(docs.get(path))});
 const store={
  collection:name=>({
   doc:id=>doc(name+'/'+id),
   get:async()=>({docs:[...docs.keys()].filter(path=>path.startsWith(name+'/')&&path.split('/').length===2)
    .map(snapshot)})
  }),
  runTransaction:async fn=>{
   const mutations=[];
   const tx={
    get:async ref=>snapshot(ref.path),
    create:(ref,data)=>mutations.push(()=>{if(docs.has(ref.path))throw Error('ALREADY_EXISTS');docs.set(ref.path,copy(data));}),
    set:(ref,data)=>mutations.push(()=>docs.set(ref.path,copy(data))),
    delete:ref=>mutations.push(()=>docs.delete(ref.path))
   };
   const result=await fn(tx);
   for(const mutate of mutations)mutate();
   return result;
  }
 };
 return {store,docs};
}
const silent={info(){}};
const base=()=>({
 'dog_christmas_villages_v1/lichtertal_2026_shared':{levels:{tower:5,workshop:5,bakery:5,inn:5,luckhouse:5,academy:5},lightsTenths:100},
 'dog_christmas_villages_v1/chris-uid':{levels:{tower:5},lightsTenths:10},
 'dog_player_statistics_v1/chris-uid':{xp:4000,played:24,wins:8},
 'dog_player_statistics_v1/vanessa-uid':{xp:7000,played:12},
 'dog_christmas_research_v1/chris-uid':{levels:{xp:8,card_swap:1}},
 'dog_christmas_scratch_wallet_v1/chris-uid':{coins:50000,owned:['christmas2026:scene:01'],recent:[{commandId:'test'}]},
 'dog_christmas_tree_rewards_v1/chris-uid':{claims:{'1':{unlockId:'christmas2026:scene:01'}}},
 'dog_grinch_campaign_v1/chris-uid':{completedMissions:[1,2]},
 'dog_christmas_scratch_settings_v1/global':{configuration:'keep'},
 'dog_gates_v1/shared':{gate:40},
 'spielesammlung_hub_v1/123':{phase:'lobby',game:'dog',players:[]}
});
const edition=(name)=>({id:'old-'+name,variantId:name,createdAt:1,createdBy:'Chris',
 issued:87,paidCoins:10000,maxTotalCoins:10000,revision:22,config:{price:200},
 budgetMode:'fixed',prizePlan:Array.from({length:500},(_,i)=>i%3===0?'X':'Y')});

test('resets and archives ALL Christmas player state, without touching other games',async()=>{
 const data=base();
 for(const [collection,id,variant] of CHRISTMAS_EDITIONS)data[collection+'/'+id]=edition(variant);
 const {store,docs}=memoryFirestore(data);
 const result=await resetDogChristmasEventOnce(store,silent);
 assert.equal(result.completed,true);
 assert.equal(result.skipped,false);
 assert.equal(result.editionsRestarted,7);
 assert.equal(result.archived,8+7);
 for(const name of CHRISTMAS_PLAYER_COLLECTIONS)
  for(const path of Object.keys(data).filter(p=>p.startsWith(name+'/')))
   assert.equal(docs.has(path),false,'Christmas progress removed: '+path);
 assert.deepEqual(docs.get('dog_gates_v1/shared'),{gate:40});
 assert.deepEqual(docs.get('dog_christmas_scratch_settings_v1/global'),{configuration:'keep'});
 assert.equal(docs.get('spielesammlung_hub_v1/123').phase,'lobby');
 for(const [collection,id,variant] of CHRISTMAS_EDITIONS){
  const revised=docs.get(collection+'/'+id);
  assert.equal(revised.variantId,variant);
  assert.notEqual(revised.id,'old-'+variant);
  assert.equal(revised.issued,0);
  assert.equal(revised.paidCoins,0);
  assert.equal(revised.maxTotalCoins,10000);
  assert.equal(revised.config.price,200);
  assert.deepEqual([...revised.prizePlan].sort(),[...edition(variant).prizePlan].sort());
 }
 const archive=docs.get(CHRISTMAS_RESET_ARCHIVES+'/'+CHRISTMAS_RESET_ID+'_'+
  Buffer.from('dog_player_statistics_v1/chris-uid').toString('base64url'));
 assert.deepEqual(archive.data,{xp:4000,played:24,wins:8});
 assert.equal(docs.get(CHRISTMAS_RESET_MARKERS+'/'+CHRISTMAS_RESET_ID).status,'completed');
 const second=await resetDogChristmasEventOnce(store,silent);
 assert.equal(second.skipped,true,'restarts must not reset the new season again');
});
test('active DOG match aborts with NO writes or archive',async()=>{
 const data=base();
 data['spielesammlung_hub_v1/123']={phase:'playing',game:'dog',match:{id:'active'}};
 const {store,docs}=memoryFirestore(data);
 await assert.rejects(()=>resetDogChristmasEventOnce(store,silent),/CHRISTMAS_RESET_DOG_MATCH_ACTIVE/);
 assert.deepEqual(Object.fromEntries(docs),data);
});
test('unsupported published scratch edition aborts instead of deleting player winnings',async()=>{
 const data=base();
 data['dog_christmas_gifts_editions_v1/current']={id:'old',variantId:'gifts',issued:9};
 const {store,docs}=memoryFirestore(data);
 await assert.rejects(()=>resetDogChristmasEventOnce(store,silent),/CHRISTMAS_RESET_UNSUPPORTED_EDITION/);
 assert.deepEqual(Object.fromEntries(docs),data);
});
test('scope is limited to six named Christmas collections and seven current editions',()=>{
 assert.deepEqual(CHRISTMAS_PLAYER_COLLECTIONS,[
  'dog_christmas_villages_v1','dog_player_statistics_v1',
  'dog_christmas_research_v1','dog_christmas_scratch_wallet_v1',
  'dog_christmas_tree_rewards_v1','dog_grinch_campaign_v1'
 ]);
 assert.equal(CHRISTMAS_EDITIONS.length,7);
});
