import test from 'node:test';
import assert from 'node:assert/strict';
import {
 CHRIS_CHRISTMAS_RESET_ID,CHRIS_CHRISTMAS_RESET_ARCHIVES,
 CHRIS_CHRISTMAS_RESET_MARKERS,CHRIS_CHRISTMAS_PLAYER_COLLECTIONS,
 getChrisChristmasResetStatus,resetChrisChristmasOnce,installChrisChristmasResetApi
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
    path.split('/').length===2).map(snap)})
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
