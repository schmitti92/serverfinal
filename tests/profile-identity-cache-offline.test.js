import test from 'node:test';
import assert from 'node:assert/strict';
import {installProfileStats} from '../profile-stats.js';
import {installProfileApi} from '../profile-api.js';

const uid='example_profile_123';
const token='x'.repeat(120);
const snapshot=data=>({exists:!!data,data:()=>structuredClone(data)});

function fixture(){
 let now=10_000,reads=0,verifications=0,revoked=false;
 let profile={uid,name:'Original',setupComplete:true,revision:1,
   color:'#328cff',favorite:'skyjo',avatar:0,edited:false,created:now,updated:now};
 let delay=null;
 const store={
   collection(name){
     assert.equal(name,'player_profiles_v1');
     return {doc(id){
       assert.equal(id,uid);
       return {get:async()=>{
         reads++;
         const value=snapshot(profile);
         if(delay)await delay;
         return value;
       }};
     }};
   },
   async runTransaction(fn){
     const tx={
       get:async()=>snapshot(profile),
       update:(_ref,next)=>{profile={...profile,...next};}
     };
     return fn(tx);
   }
 };
 const admin={
   apps:[{}],
   auth:()=>({verifyIdToken:async(_token,checkRevoked)=>{
     assert.equal(checkRevoked,true,'every call must check Firebase Auth revocation');
     verifications++;
     if(revoked)throw Error('TOKEN_REVOKED');
     return {uid,name:'Original'};
   }})
 };
 const statsRoutes={};
 const stats=installProfileStats({get:(path,fn)=>{statsRoutes[path]=fn}},
   {admin,getFirestore:()=>store,clock:()=>now});
 return {
   admin,stats,store,
   reads:()=>reads,verifications:()=>verifications,
   advance:ms=>{now+=ms},setProfile:name=>{profile.name=name;profile.revision++},
   revoke:()=>{revoked=true},
   delayReads:()=>{let resume;delay=new Promise(r=>{resume=r});return ()=>{delay=null;resume()}},
   updateProfile:(next)=>{profile={...profile,...next}},
   current:()=>structuredClone(profile)
 };
}

test('Concurrent profile authentication shares a single Firestore document read',async()=>{
 const f=fixture(),release=f.delayReads();
 const requests=Array.from({length:12},()=>f.stats.identity(token));
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 release();
 const results=await Promise.all(requests);
 assert.equal(f.reads(),1,'singleflight should collapse same-uid document reads');
 assert.equal(f.stats.identityCacheStats().documentReads,1);
 assert.equal(f.stats.identityCacheStats().sharedReads,11);
 assert.equal(f.verifications(),12,'tokens still verified independently including revocation');
 assert.ok(results.every(x=>x?.uid===uid&&x.name==='Original'));
 const again=await f.stats.identity(token);
 assert.equal(again.name,'Original');
 assert.equal(f.reads(),1,'60-second cache avoids another read');
 assert.equal(f.verifications(),13);
 f.advance(59_999);
 await f.stats.identity(token);
 assert.equal(f.reads(),1);
 f.advance(2);
 await f.stats.identity(token);
 assert.equal(f.reads(),2,'expired cache refreshes from Firestore');
});

test('Revoked sessions are rejected even if player name is already cached',async()=>{
 const f=fixture();
 assert.equal((await f.stats.identity(token)).name,'Original');
 f.revoke();
 assert.equal(await f.stats.identity(token),null);
 assert.equal(f.reads(),1,'revoked requests cannot reuse the cached name');
 assert.equal(f.verifications(),2);
});

test('Completed profile writes invalidate the identity cache immediately',async()=>{
 const f=fixture(),routes={};
 const app={
   use:(path,fn)=>{routes['MIDDLEWARE '+path]=fn},
   get:(path,fn)=>{routes['GET '+path]=fn},
   put:(path,...fns)=>{routes['PUT '+path]=fns},
   post:(path,...fns)=>{routes['POST '+path]=fns}
 };
 installProfileApi(app,{admin:f.admin,getFirestore:()=>f.store,
   onProfileSaved:f.stats.invalidateIdentity});
 assert.equal((await f.stats.identity(token)).name,'Original');
 const req={profileUid:uid,profileUser:{uid},body:{
   name:'Aktualisiert',color:'#328cff',favorite:'skyjo',avatar:0,edited:true,expectedRevision:1
 }};
 const res={
   statusCode:200,status(value){this.statusCode=value;return this},
   json(value){this.payload=value;return this}
 };
 const [,handler]=routes['PUT /api/profile/me'];
 await handler(req,res);
 assert.equal(res.payload.ok,true);
 assert.equal(res.payload.profile.name,'Aktualisiert');
 const refreshed=await f.stats.identity(token);
 assert.equal(refreshed.name,'Aktualisiert','cache must not retain old profile name');
 assert.equal(f.reads(),2,'the next read fetches one fresh profile document');
 assert.equal(f.stats.identityCacheStats().invalidations,1);
});

test('Invalidating an in-flight profile read cannot repopulate stale cache',async()=>{
 const f=fixture(),release=f.delayReads();
 const old=f.stats.identity(token);
 await Promise.resolve();await Promise.resolve();
 f.stats.invalidateIdentity(uid);
 f.updateProfile({name:'Neu'});
 release();
 const prior=await old;
 assert.equal(prior.name,'Original','in-flight reader can complete with original snapshot');
 assert.equal((await f.stats.identity(token)).name,'Neu');
 assert.equal(f.reads(),2,'invalidation prevents old pending result being cached');
});
