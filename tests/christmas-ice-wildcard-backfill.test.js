import test from 'node:test';
import assert from 'node:assert/strict';
import {newIceState} from '../christmas-ice-engine.js';
import {installChristmasIceApi} from '../christmas-ice-api.js';
function fixture(best=60,progressFlags={},dogFlags={}){
 const uid='wildcard-backfill-player',routes=new Map(),docs=new Map(),writes=[];
 docs.set('christmas_ice_progress_v1/'+uid,{
  ...newIceState(()=>0),completed:best,maxRewarded:best,finished:true,...progressFlags
 });
 docs.set('deal_dog_album_season2_v1/'+uid,{wildcardTickets:4,...dogFlags});
 const db={
  collection:name=>({doc:id=>({key:name+'/'+id})}),
  runTransaction:async fn=>{
   const jobs=[];let wrote=false;
   const tx={
    get:ref=>{if(wrote)throw Error('FIRESTORE_READ_AFTER_WRITE');const value=docs.get(ref.key);
     return Promise.resolve({exists:value!==undefined,data:()=>structuredClone(value)})},
    set:(ref,value,opts)=>{wrote=true;jobs.push(()=>{
     docs.set(ref.key,opts?.merge?{...(docs.get(ref.key)||{}),...structuredClone(value)}:structuredClone(value));
     writes.push(ref.key);
    })}
   };
   const response=await fn(tx);for(const job of jobs)job();return response;
  }
 };
 const app={get:(p,...handlers)=>routes.set('GET '+p,handlers),post:(p,...handlers)=>routes.set('POST '+p,handlers)};
 installChristmasIceApi(app,{verifyProfile:async()=>({uid}),getFirestore:()=>db});
 async function invoke(){
  const h=routes.get('POST /api/christmas-ice/claim-wildcards');
  const req={body:{},get:()=> 'Bearer test'};
  const res={statusCode:200,status(n){this.statusCode=n;return this},set(){return this},json(body){this.body=body;return body}};
  await new Promise((resolve,reject)=>{
   Promise.resolve(h[0](req,res,()=>Promise.resolve(h[1](req,res)).then(resolve,reject))).catch(reject);
  });
  return res;
 }
 return {uid,docs,writes,invoke};
}
test('players who already cleared 50 and 60 get exactly two additional DOG joker cards',async()=>{
 const x=fixture(60),first=await x.invoke();
 assert.equal(first.statusCode,200,JSON.stringify(first.body));
 assert.equal(first.body.granted,2);
 assert.equal(first.body.wildcardTickets,6);
 assert.equal(x.docs.get('deal_dog_album_season2_v1/'+x.uid).iceWildcard50Granted,true);
 assert.equal(x.docs.get('deal_dog_album_season2_v1/'+x.uid).iceWildcard60Granted,true);
 assert.equal(x.docs.get('christmas_ice_progress_v1/'+x.uid).iceWildcard60Claimed,true);
 const count=x.writes.length;
 const replay=await x.invoke();
 assert.equal(replay.statusCode,200);
 assert.equal(replay.body.granted,0);
 assert.equal(x.writes.length,count);
});
test('picture 50 gives one card, a previous award cannot double pay',async()=>{
 const x=fixture(50),r=await x.invoke();
 assert.equal(r.statusCode,200);
 assert.equal(r.body.granted,1);
 assert.equal(x.docs.get('deal_dog_album_season2_v1/'+x.uid).wildcardTickets,5);
 const previous=fixture(60,{iceWildcard50Claimed:true},{iceWildcard50Granted:true});
 const other=await previous.invoke();
 assert.equal(other.body.granted,1);
 assert.equal(previous.docs.get('deal_dog_album_season2_v1/'+previous.uid).wildcardTickets,5);
});
test('unreached milestones never mint a wildcard',async()=>{
 const x=fixture(49),result=await x.invoke();
 assert.equal(result.statusCode,200);
 assert.equal(result.body.granted,0);
 assert.equal(x.writes.length,0);
});
