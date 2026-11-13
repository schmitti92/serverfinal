import test from 'node:test';
import assert from 'node:assert/strict';
import {installDogAlbumSeason2,DOG_S2_CARDS,DOG_S2_COLLECTION} from '../dog-album-season2.js';

test('already completed DOG board claims one Super Slot ticket, resets only its run and enters monthly tournament',async()=>{
 const uid='collector',docs=new Map(),routes=new Map(),writes=[];
 const cards=Object.fromEntries(DOG_S2_CARDS.slice(0,16).map(card=>[card.id,3]));
 docs.set(DOG_S2_COLLECTION+'/'+uid,{season:2,cards,opened:30});
 docs.set('christmas_hammer_bingo_v1/'+uid,{finished:99});
 const ref=key=>({
  key,get:async()=>({exists:docs.has(key),data:()=>structuredClone(docs.get(key))}),
  set:async(data,opts={})=>{
   docs.set(key,structuredClone(opts.merge?{...(docs.get(key)||{}),...data}:data));
   writes.push(key);
  }
 });
 const db={
  collection:name=>({
   doc:id=>ref(name+'/'+id),
   orderBy:(field,sort)=>({limit:limit=>({get:async()=>({
    docs:[...docs.entries()].filter(([key])=>key.startsWith(name+'/'))
     .map(([key,data])=>({id:key.slice(name.length+1),data:()=>structuredClone(data)}))
     .sort((a,b)=>(b.data()[field]||0)-(a.data()[field]||0)).slice(0,limit)
   })})})
  }),
  runTransaction:async handler=>{
   let wrote=false;const pending=[];
   const tx={
    get:ref=>{if(wrote)throw Error('FIRESTORE_READ_AFTER_WRITE');return ref.get()},
    set:(ref,data,opts)=>{wrote=true;pending.push(()=>ref.set(data,opts))}
   };
   const result=await handler(tx);
   for(const work of pending)await work();
   return result;
  }
 };
 const auth=(req,res,next)=>{req.dealIdentity={uid,displayName:'Chris'};next()};
 const fail=(res,error)=>res.status(409).json({ok:false,error:String(error.message||error)});
 const app={get:(path,...handlers)=>routes.set('GET '+path,handlers),post:(path,...handlers)=>routes.set('POST '+path,handlers)};
 installDogAlbumSeason2(app,{auth,getFirestore:()=>db,fail});
 const call=async(method,path)=>{
  const handlers=routes.get(method+'/api/deal-or-no-deal/christmas/season2'+path);assert.ok(handlers,path);
  const req={body:{},params:{},get:()=> 'Bearer token'};
  const res={statusCode:200,status(n){this.statusCode=n;return this},set(){return this},json(data){this.body=data;return data}};
  for(const fn of handlers)await new Promise((resolve,reject)=>{
   let next=false;Promise.resolve(fn(req,res,()=>{next=true;resolve()})).then(()=>{if(!next)resolve()},reject)
  });
  return res;
 };
 const before=await call('GET','/me');
 assert.equal(before.statusCode,200);
 assert.equal(before.body.progress.boards[0].collected,16);
 assert.equal(before.body.progress.boards[0].readyToComplete,true);
 assert.equal(before.body.rewards.pending.length,5,'old Bingo milestones remain available');
 const first=await call('POST','/cycles/claim');
 assert.equal(first.statusCode,200,JSON.stringify(first.body));
 assert.equal(first.body.completedBoards.length,1);
 assert.equal(first.body.progress.superSlotTickets,1);
 assert.equal(first.body.progress.boards[0].collected,0);
 assert.equal(first.body.progress.completedTotal,1);
 const stored=docs.get(DOG_S2_COLLECTION+'/'+uid);
 assert.deepEqual(stored.cards,cards,'lifetime DOG card inventory is not deleted');
 assert.equal(stored.superSlotTickets,1);
 assert.deepEqual(stored.cycleCompletions,[1,0,0,0,0,0]);
 const count=writes.length;
 const retry=await call('POST','/cycles/claim');
 assert.equal(retry.statusCode,200);
 assert.equal(retry.body.replayed,true);
 assert.equal(retry.body.completedBoards.length,0);
 assert.equal(writes.length,count,'no duplicate reward or Firebase writes');
 const after=await call('GET','/me');
 assert.equal(after.body.progress.collected,0);
 assert.equal(after.body.lifetimeProgress.collected,16);
 assert.equal(after.body.rewards.pending.length,5,'once-only Bingo milestones remain claimable');
 const rank=await call('GET','/tournament');
 assert.equal(rank.statusCode,200,JSON.stringify(rank.body));
 assert.equal(rank.body.leaderboard.length,1);
 assert.equal(rank.body.leaderboard[0].name,'Chris');
 assert.equal(rank.body.leaderboard[0].completed,1);
 assert.equal(rank.body.leaderboard[0].points,200);
 assert.deepEqual(docs.get('christmas_hammer_bingo_v1/'+uid),{finished:99});
 assert.ok(!writes.some(key=>key.includes('christmas_hammer_bingo')),'Hammer Bingo must remain untouched');
});
