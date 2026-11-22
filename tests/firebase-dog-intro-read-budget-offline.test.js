import test from 'node:test';
import assert from 'node:assert/strict';
import {installSharedLobby} from '../shared-lobby.js';
import {DOG_PLAYER_STATS_COLLECTION} from '../dog/player-stats.js';

const GRANTS='dog_christmas_event_access_v1';
const INTRO='dog_christmas_intro_unlock_v1';
function harness(){
 const documents=new Map(),reads=[],routes=new Map();
 let now=Date.parse('2026-11-22T03:00:00Z');
 const store={collection:name=>({doc:uid=>({path:name+'/'+uid,async get(){
  const path=name+'/'+uid;reads.push(path);
  const value=documents.get(path);
  return {exists:value!==undefined,data:()=>structuredClone(value)};
 }})})};
 const app={get:(path,...handlers)=>routes.set(path,handlers),post(){},use(){}};
 installSharedLobby(app,{
  getFirestore:()=>store,clock:()=>now,
  verifyProfile:async token=>token==='chris-token'?{uid:'chris',name:'Chris'}:
   token==='vanessa-token'?{uid:'vanessa',name:'Vanessa'}:null,
  christmasEventActive:()=>true
 });
 async function check(token){
  const req={method:'GET',route:{path:'/api/hub/dog/christmas-intro'},
   get:name=>name.toLowerCase()==='authorization'?'Bearer '+token:''};
  const res={statusCode:200,status(n){this.statusCode=n;return this},
   json(body){this.body=body;return this}};
  const [auth,handler]=routes.get('/api/hub/dog/christmas-intro');
  let authorized=false;
  await auth(req,res,()=>{authorized=true});
  if(authorized)await handler(req,res);
  return {status:res.statusCode,...res.body};
 }
 return {check,reads,documents,advance:ms=>{now+=ms}};
}

test('first-time DOG player requires two reads, not a third intro receipt GET',async()=>{
 const h=harness();
 const state=await h.check('vanessa-token');
 assert.equal(state.status,200);
 assert.equal(state.eligible,false);
 assert.equal(state.introReady,false);
 assert.equal(state.completed,false);
 assert.deepEqual(h.reads.sort(),[
  DOG_PLAYER_STATS_COLLECTION+'/vanessa',GRANTS+'/vanessa'
 ].sort());
 await h.check('vanessa-token');
 assert.equal(h.reads.length,2,'brief repeat uses existing server read cache');
});

test('a finished DOG match immediately checks authenticated intro entitlement',async()=>{
 const h=harness();
 await h.check('vanessa-token');
 h.documents.set(DOG_PLAYER_STATS_COLLECTION+'/vanessa',{
  played:1,updatedAt:Date.parse('2026-11-22T02:00:00Z')
 });
 h.advance(31_000); // Expire the unchanged 30-second metadata read cache.
 const unlocked=await h.check('vanessa-token');
 assert.equal(unlocked.eligible,true);
 assert.equal(unlocked.introReady,true);
 assert.equal(unlocked.completed,false);
 assert.ok(h.reads.includes(INTRO+'/vanessa'),
  'eligible DOG player must read server-verified receipt');
});

test('explicit founder preview and finished intro keep authoritative access checks',async()=>{
 const h=harness();
 h.documents.set(GRANTS+'/chris',{access:true,resetId:'restart-1'});
 h.documents.set(INTRO+'/chris',{completedAt:123456});
 const state=await h.check('chris-token');
 assert.equal(state.eligible,true);
 assert.equal(state.previewGranted,true);
 assert.equal(state.completed,true);
 assert.equal(state.resetId,'restart-1');
 assert.deepEqual(h.reads.sort(),[
  DOG_PLAYER_STATS_COLLECTION+'/chris',GRANTS+'/chris',INTRO+'/chris'
 ].sort());
});
