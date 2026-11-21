import test from 'node:test';
import assert from 'node:assert/strict';
import {
 CHRIS_CHRISTMAS_RESET_ID,CHRIS_CHRISTMAS_RESET_ARCHIVES,
 CHRIS_CHRISTMAS_RESET_MARKERS,CHRIS_CHRISTMAS_PLAYER_COLLECTIONS,
 getChrisChristmasResetStatus,resetChrisChristmasOnce,installChrisChristmasResetApi,
 isChrisActiveChristmasMatch,runChrisChristmasLaunchResetOnce,
 CHRIS_CHRISTMAS_LAUNCH_JOB,CHRIS_CHRISTMAS_LAUNCH_JOBS
} from '../dog-christmas-chris-personal-reset.js';

const copy=data=>structuredClone(data);
function firestore(initial={},onTransaction=()=>{}){
 const docs=new Map(Object.entries(copy(initial)));
 const snap=path=>({id:path.split('/').at(-1),exists:docs.has(path),
  data:()=>copy(docs.get(path)),ref:ref(path)});
 const ref=path=>({path,get:async()=>snap(path)});
 const db={
  collection:name=>({
   doc:id=>ref(name+'/'+id),
   get:async()=>({docs:[...docs.keys()].filter(path=>path.startsWith(name+'/')&&
    path.split('/').length===2).map(snap)}),
   where:(field,operator,values)=>{
    assert.equal(operator,'in');
    return {limit:count=>({get:async()=>({docs:[...docs.keys()]
     .filter(path=>path.startsWith(name+'/')&&path.split('/').length===2)
     .map(snap).filter(s=>values.includes(s.data()?.[field])).slice(0,count)})})};
   }
  }),
  runTransaction:async fn=>{
   onTransaction(docs);
   const mutations=[];
   const tx={
    get:async r=>snap(r.path),
    create:(r,data)=>mutations.push(['create',r.path,copy(data)]),
    delete:r=>mutations.push(['delete',r.path])
   };
   const result=await fn(tx);
   const updated=new Map(docs);
   for(const [operation,path,value] of mutations){
    if(operation==='create'&&updated.has(path))throw Error('ALREADY_EXISTS');
    if(operation==='delete')updated.delete(path);else updated.set(path,value);
   }
   docs.clear();
   for(const [key,value] of updated)docs.set(key,value);
   return result;
  }
 };
 return {docs,db};
}
const chris='chris-uid',vanessa='vanessa-uid',david='david-uid';
const initial=()=>({
 ['player_profiles_v1/'+chris]:{uid:chris,name:'Chris',setupComplete:true},
 ['player_profiles_v1/'+vanessa]:{uid:vanessa,name:'Vanessa',setupComplete:true},
 ['player_profiles_v1/'+david]:{uid:david,name:'David',setupComplete:true},
 ['dog_player_statistics_v1/'+chris]:{name:'Chris',played:42,wins:22,xp:12000},
 ['dog_player_statistics_v1/'+vanessa]:{name:'Vanessa',played:4,xp:100},
 ['dog_player_statistics_v1/'+david]:{name:'David',played:1,xp:50},
 ['dog_christmas_research_v1/'+chris]:{levels:{xp:7,win_xp:4}},
 ['dog_christmas_scratch_wallet_v1/'+chris]:{coins:25000,
  vouchers:{simple:3,medium:2,premium:1},owned:{prize:{at:100}},recent:[{commandId:'old'}],
  levelRewardClaims:{1:1,2:2}},
 ['dog_christmas_scratch_wallet_v1/'+vanessa]:{coins:1000,vouchers:{}},
 ['dog_christmas_tree_rewards_v1/'+chris]:{claims:{1:{unlockId:'christmas2026:scene:01'}}},
 ['dog_grinch_campaign_v1/'+chris]:{completedMissions:[1,2,3]},
 ['dog_christmas_intro_unlock_v1/'+chris]:{completedAt:12345},
 ['dog_christmas_villages_v1/'+chris]:{lightsTenths:500,levels:{tower:5}},
 'dog_christmas_villages_v1/lichtertal_2026_shared':{
  lightsTenths:1000,levels:{tower:4,inn:2},giftsCollected:19},
 'dog_christmas_scratch_settings_v1/global':{settings:'keep'},
 'dog_christmas_gifts_editions_v1/current':{issued:42,prizePlan:['a','b']},
 ['deal_or_no_deal_wallets_v1/'+chris]:{balance:1200000},
 'spielesammlung_hub_v1/123':{phase:'lobby',game:'dog',expiresAt:20000,
  players:[{uid:chris},{uid:vanessa},{uid:david}]}
});
test('Chris-only reset archives and deletes all seven personal records; leaves teammates, shared village and other games',async()=>{
 const seed=initial(),{db,docs}=firestore(seed);
 const before=await getChrisChristmasResetStatus(db,chris);
 assert.equal(before.alreadyReset,false);
 assert.equal(before.personalDocumentsPresent,7);
 const done=await resetChrisChristmasOnce(db,chris,{clock:()=>10000});
 assert.deepEqual(done,{alreadyReset:false,cleared:7,archived:7});
 for(const collection of CHRIS_CHRISTMAS_PLAYER_COLLECTIONS){
  const path=collection+'/'+chris;
  assert.equal(docs.has(path),false,path+' must be reset');
  const archive=CHRIS_CHRISTMAS_RESET_ARCHIVES+'/'+CHRIS_CHRISTMAS_RESET_ID+'_'+Buffer.from(path).toString('base64url');
  assert.deepEqual(docs.get(archive).data,seed[path]);
 }
 for(const [path,data] of Object.entries(seed).filter(([path])=>!path.endsWith('/'+chris)))
  assert.deepEqual(docs.get(path),data,path+' must remain untouched');
 assert.equal(docs.get(CHRIS_CHRISTMAS_RESET_MARKERS+'/'+chris).status,'completed');
 assert.equal((await getChrisChristmasResetStatus(db,chris)).personalDocumentsPresent,0);
 assert.equal((await getChrisChristmasResetStatus(db,chris)).alreadyReset,true);
 // Never erase future winnings if an old browser retries the one-time request.
 docs.set('dog_christmas_scratch_wallet_v1/'+chris,{coins:777});
 assert.equal((await resetChrisChristmasOnce(db,chris)).alreadyReset,true);
 assert.deepEqual(docs.get('dog_christmas_scratch_wallet_v1/'+chris),{coins:777});
});
test('active Chris DOG match aborts without deleting or archiving anything',async()=>{
 const seed=initial();
 seed['spielesammlung_hub_v1/123']={phase:'playing',game:'dog',
  match:{game:'dog'},expiresAt:20000,players:[{uid:chris}]};
 const {db,docs}=firestore(seed);
 await assert.rejects(()=>resetChrisChristmasOnce(db,chris,{clock:()=>10000}),
  /CHRIS_RESET_ACTIVE_DOG_MATCH/);
 assert.deepEqual(Object.fromEntries(docs),seed);
});
test('DOG finished game inside still-playing lobby is NOT an active match',async()=>{
 const seed=initial();
 seed['spielesammlung_hub_v1/123']={
  phase:'playing',game:'dog',
  match:{game:'dog',id:'finished-game',dog:{phase:'finished',winner:0}},
  expiresAt:20000,players:[{uid:chris},{uid:vanessa},{uid:david}]};
 assert.equal(isChrisActiveChristmasMatch(seed['spielesammlung_hub_v1/123'],chris,10000),false);
 const {db,docs}=firestore(seed);
 const result=await resetChrisChristmasOnce(db,chris,{clock:()=>10000});
 assert.equal(result.alreadyReset,false);
 assert.equal(result.cleared,7);
 assert.equal(docs.has('dog_player_statistics_v1/'+chris),false);
 assert.equal(docs.has('dog_player_statistics_v1/'+vanessa),true);
 assert.equal(docs.has('dog_player_statistics_v1/'+david),true);
 assert.deepEqual(docs.get('spielesammlung_hub_v1/123'),seed['spielesammlung_hub_v1/123'],
  'the completed room itself is not modified');
});
test('DOG with a real unfinished game inside playing room still blocks Chris reset',async()=>{
 for(const phase of ['exchange','play','seven','rescue']){
  const seed=initial();
  seed['spielesammlung_hub_v1/123']={
   phase:'playing',game:'dog',match:{game:'dog',dog:{phase}},
   expiresAt:20000,players:[{uid:chris}]};
  const {db,docs}=firestore(seed);
  assert.equal(isChrisActiveChristmasMatch(seed['spielesammlung_hub_v1/123'],chris,10000),true);
  await assert.rejects(()=>resetChrisChristmasOnce(db,chris,{clock:()=>10000}),
   /CHRIS_RESET_ACTIVE_DOG_MATCH/);
  assert.equal(docs.has(CHRIS_CHRISTMAS_RESET_MARKERS+'/'+chris),false);
 }
});
test('Grinch missions: genuinely completed games do not block, unfinished ones do',async()=>{
 for(const name of ['dog-grinch1','dog-grinch2']){
  const finished={phase:'playing',game:name,
   match:{game:name,grinch:{complete:true}},
   expiresAt:20000,players:[{uid:chris}]};
  assert.equal(isChrisActiveChristmasMatch(finished,chris,10000),false);
  const {db,docs}=firestore({...initial(),['spielesammlung_hub_v1/123']:finished});
  assert.equal((await resetChrisChristmasOnce(db,chris,{clock:()=>10000})).alreadyReset,false);
  assert.equal(docs.has('dog_christmas_research_v1/'+chris),false);
  const ongoing={...finished,match:{game:name,grinch:{complete:false}}};
  assert.equal(isChrisActiveChristmasMatch(ongoing,chris,10000),true);
 }
});
test('transaction sees a concurrently completed match and allows the safe reset',async()=>{
 const seed=initial();
 seed['spielesammlung_hub_v1/123']={
  phase:'playing',game:'dog',match:{game:'dog',dog:{phase:'finished'}},
  expiresAt:20000,players:[{uid:chris}]};
 const {db,docs}=firestore(seed,store=>{
  // Room remains in the outer playing state even after its ceremony.
  const current=store.get('spielesammlung_hub_v1/123');
  store.set('spielesammlung_hub_v1/123',{...current,match:{game:'dog',dog:{phase:'finished'}}});
 });
 const result=await resetChrisChristmasOnce(db,chris,{clock:()=>10000});
 assert.equal(result.alreadyReset,false);
 assert.equal(docs.has(CHRIS_CHRISTMAS_RESET_MARKERS+'/'+chris),true);
});
test('concurrent match start in Chris existing lobby aborts inside transaction',async()=>{
 const seed=initial();
 const {db,docs}=firestore(seed,store=>{
  const room=store.get('spielesammlung_hub_v1/123');
  store.set('spielesammlung_hub_v1/123',{...room,phase:'playing',match:{game:'dog'}});
 });
 await assert.rejects(()=>resetChrisChristmasOnce(db,chris,{clock:()=>10000}),
  /CHRIS_RESET_ACTIVE_DOG_MATCH/);
 assert.equal(docs.has('dog_player_statistics_v1/'+chris),true);
 assert.equal(docs.has(CHRIS_CHRISTMAS_RESET_MARKERS+'/'+chris),false);
});
test('only verified Chris identity is allowed by API: name spoofing in request body has no effect',async()=>{
 const handlers={get:{},post:{}};
 const app={
  get:(path,auth,action)=>{handlers.get[path]=[auth,action];},
  post:(path,auth,action)=>{handlers.post[path]=[auth,action];}
 };
 const {db,docs}=firestore(initial());
 const nameForToken={vanessa:{uid:vanessa,name:'Vanessa'},
  chris:{uid:chris,name:'Chris'}};
 installChrisChristmasResetApi(app,{getFirestore:()=>db,
  verifyProfile:async token=>nameForToken[token]||null,clock:()=>10000});
 const path='/api/hub/dog/chris-christmas-reset';
 const invoke=async(route,token,body={})=>{
  const [auth,action]=handlers.post[route];
  const req={get:()=>token?'Bearer '+token:'',body};
  const res={statusCode:200,headers:{},status(n){this.statusCode=n;return this;},
   set(k,v){this.headers[k]=v;return this;},json(x){this.body=x;return x;}};
  let continuation=null;
  await auth(req,res,()=>{continuation=action(req,res)});
  if(continuation)await continuation;
  return res;
 };
 const wrong=await invoke(path,'vanessa',{confirmation:'CHRIS_WEIHNACHT_NEUSTART',uid:chris,name:'Chris'});
 assert.equal(wrong.statusCode,403);
 assert.equal(docs.has('dog_player_statistics_v1/'+chris),true);
 const wrongConfirm=await invoke(path,'chris',{confirmation:'other'});
 assert.equal(wrongConfirm.statusCode,400);
 assert.equal(docs.has('dog_player_statistics_v1/'+chris),true);
 const valid=await invoke(path,'chris',{confirmation:'CHRIS_WEIHNACHT_NEUSTART',uid:vanessa});
 assert.equal(valid.statusCode,200);
 assert.equal(valid.body.resetCompleted,true);
 assert.equal(docs.has('dog_player_statistics_v1/'+chris),false);
 assert.equal(docs.has('dog_player_statistics_v1/'+vanessa),true);
});

test('trusted server launch: reset only the uniquely verified Chris profile once, preserve access and team',async()=>{
 const seed=initial(),{db,docs}=firestore(seed);
 const logger={info:()=>{}};
 const first=await runChrisChristmasLaunchResetOnce(db,{clock:()=>10000,logger});
 assert.equal(first.jobCompleted,true);
 assert.equal(first.alreadyReset,false);
 assert.equal(first.cleared,7);
 assert.equal(docs.get(CHRIS_CHRISTMAS_LAUNCH_JOBS+'/'+CHRIS_CHRISTMAS_LAUNCH_JOB).status,'completed');
 assert.deepEqual(docs.get('player_profiles_v1/'+chris),seed['player_profiles_v1/'+chris],
  'Chris remains signed in and can still open Lichtertal');
 assert.equal(docs.has('dog_player_statistics_v1/'+chris),false);
 assert.equal(docs.has('dog_christmas_scratch_wallet_v1/'+chris),false);
 assert.deepEqual(docs.get('dog_player_statistics_v1/'+vanessa),seed['dog_player_statistics_v1/'+vanessa]);
 assert.deepEqual(docs.get('dog_player_statistics_v1/'+david),seed['dog_player_statistics_v1/'+david]);
 assert.deepEqual(docs.get('dog_christmas_villages_v1/lichtertal_2026_shared'),
  seed['dog_christmas_villages_v1/lichtertal_2026_shared']);
 assert.deepEqual(docs.get('spielesammlung_hub_v1/123'),seed['spielesammlung_hub_v1/123']);
 // A later server restart must never reset new winnings.
 docs.set('dog_christmas_scratch_wallet_v1/'+chris,{coins:12345});
 const rerun=await runChrisChristmasLaunchResetOnce(db,{clock:()=>20000,logger});
 assert.equal(rerun.alreadyReset,true);
 assert.deepEqual(docs.get('dog_christmas_scratch_wallet_v1/'+chris),{coins:12345});
});
test('trusted launch ignores old orphaned DOG lobby rooms without altering them',async()=>{
 const seed=initial();
 seed['spielesammlung_hub_v1/123']={phase:'playing',game:'dog',
  match:{game:'dog',dog:{phase:'play'}},expiresAt:20000,
  players:[{uid:chris},{uid:vanessa},{uid:david}]};
 const {db,docs}=firestore(seed);
 const result=await runChrisChristmasLaunchResetOnce(db,{clock:()=>10000,logger:{info(){}}});
 assert.equal(result.jobCompleted,true);
 assert.deepEqual(docs.get('spielesammlung_hub_v1/123'),seed['spielesammlung_hub_v1/123']);
 assert.equal(docs.has('dog_christmas_research_v1/'+chris),false);
 assert.equal(docs.has('dog_christmas_research_v1/'+vanessa),false);
});
test('trusted launch aborts safely if more than one stored profile is named Chris',async()=>{
 const seed=initial();
 seed['player_profiles_v1/another-chris']={uid:'another-chris',name:'Chris'};
 const {db,docs}=firestore(seed);
 await assert.rejects(()=>runChrisChristmasLaunchResetOnce(db,{clock:()=>10000}),
  /CHRIS_LAUNCH_RESET_PROFILE_NOT_UNIQUE/);
 assert.deepEqual(Object.fromEntries(docs),seed);
});
test('trusted launch aborts safely if no verified Chris profile exists',async()=>{
 const seed=initial();
 delete seed['player_profiles_v1/'+chris];
 const {db,docs}=firestore(seed);
 await assert.rejects(()=>runChrisChristmasLaunchResetOnce(db,{clock:()=>10000}),
  /CHRIS_LAUNCH_RESET_PROFILE_NOT_UNIQUE/);
 assert.deepEqual(Object.fromEntries(docs),seed);
});
test('trusted launch rechecks verified Chris identity in the same archive/deletion transaction',async()=>{
 const seed=initial();
 const {db,docs}=firestore(seed,store=>{
  const entry=store.get('player_profiles_v1/'+chris);
  store.set('player_profiles_v1/'+chris,{...entry,name:'Renamed'});
 });
 await assert.rejects(()=>runChrisChristmasLaunchResetOnce(db,{clock:()=>10000}),
  /CHRIS_RESET_IDENTITY_CHANGED/);
 assert.equal(docs.has('dog_christmas_scratch_wallet_v1/'+chris),true);
 assert.equal(docs.has(CHRIS_CHRISTMAS_RESET_MARKERS+'/'+chris),false);
 assert.equal(docs.has(CHRIS_CHRISTMAS_LAUNCH_JOBS+'/'+CHRIS_CHRISTMAS_LAUNCH_JOB),false);
});
