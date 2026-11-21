import test from 'node:test';
import assert from 'node:assert/strict';
import {installSharedLobby} from '../shared-lobby.js';
function setup(){
 const routes=[],middlewares=[],docs=new Map(),clone=x=>structuredClone(x);
 const ref=path=>({path});
 const snapshot=path=>({exists:docs.has(path),data:()=>clone(docs.get(path))});
 const store={
  collection:name=>({doc:id=>ref(name+'/'+id)}),
  runTransaction:async fn=>{
   const writes=[];
   const tx={
    get:async r=>snapshot(r.path),
    set:(r,x)=>writes.push(()=>docs.set(r.path,clone(x))),
    delete:r=>writes.push(()=>docs.delete(r.path))
   };
   const result=await fn(tx);writes.forEach(f=>f());return result;
  }
 };
 // get() on doc references is needed by GET routes.
 store.collection=name=>({doc:id=>({
  path:name+'/'+id,
  get:async()=>snapshot(name+'/'+id)
 })});
 const app={
  get:(path,...handlers)=>routes.push({verb:'GET',path,handlers}),
  post:(path,...handlers)=>routes.push({verb:'POST',path,handlers}),
  use:(path,handler)=>middlewares.push({path,handler})
 };
 installSharedLobby(app,{verifyProfile:async token=>
  ({chris:{uid:'c',name:'chris'},vanessa:{uid:'v',name:'Vanessa'},david:{uid:'d',name:'David'}}[token]||null),
  getFirestore:()=>store,clock:()=>1700000000000});
 const call=async(verb,path,who='chris',body={})=>{
  const route=routes.find(r=>r.verb===verb&&r.path===path);
  assert.ok(route,'route '+verb+' '+path);
  const req={params:{},body,get:key=>key==='authorization'?'Bearer '+who:''};
  const res={statusCode:200,status(n){this.statusCode=n;return this;},
   json(x){this.body=x;return this;}};
  const middleware=middlewares.filter(m=>path===m.path||path.startsWith(m.path+'/')).map(m=>m.handler);
  const handlers=[...middleware,...route.handlers];
  async function next(i=0){
   const h=handlers[i];if(!h)return;
   let promise;
   await h(req,res,()=>{promise=next(i+1);});
   if(promise)await promise;
  }
  await next();return {status:res.statusCode,...res.body};
 };
 return {docs,call};
}
test('Vanessa remains locked until verified DOG match completion',async()=>{
 const h=setup();
 let r=await h.call('GET','/api/hub/dog/christmas-intro','vanessa');
 assert.equal(r.status,200);assert.equal(r.eligible,false);assert.equal(r.completed,false);
 r=await h.call('POST','/api/hub/dog/christmas-intro/complete','vanessa');
 assert.equal(r.status,403);assert.equal(r.error,'DOG_CHRISTMAS_INTRO_LOCKED');
 assert.equal(h.docs.has('dog_christmas_intro_unlock_v1/v'),false);
 h.docs.set('dog_player_statistics_v1/v',{played:1,wins:0,xp:10,updatedAt:Date.parse('2026-11-21T13:05:00Z')});
 r=await h.call('GET','/api/hub/dog/christmas-intro','vanessa');
 assert.equal(r.eligible,true);assert.equal(r.completed,false);
 r=await h.call('POST','/api/hub/dog/christmas-intro/complete','vanessa');
 assert.equal(r.status,200);assert.equal(r.completed,true);assert.equal(r.unchanged,false);
 const stamp=h.docs.get('dog_christmas_intro_unlock_v1/v').completedAt;
 r=await h.call('POST','/api/hub/dog/christmas-intro/complete','vanessa');
 assert.equal(r.status,200);assert.equal(r.unchanged,true);
 assert.equal(h.docs.get('dog_christmas_intro_unlock_v1/v').completedAt,stamp);
 r=await h.call('GET','/api/hub/dog/christmas-intro','david');
 assert.equal(r.eligible,false);assert.equal(r.completed,false);
});
test('Unauthenticated users cannot see unlock status',async()=>{
 const h=setup();
 const r=await h.call('GET','/api/hub/dog/christmas-intro','invalid');
 assert.equal(r.status,401);
});

test('lowercase chris receives immediate preview access without fabricating a DOG match',async()=>{
 const h=setup();
 const status=await h.call('GET','/api/hub/dog/christmas-intro','chris');
 assert.equal(status.status,200);
 assert.equal(status.eligible,true);
 assert.equal(status.completed,true);
 assert.equal(status.previewGranted,true);
 assert.equal(status.played,0);
 assert.equal(h.docs.has('dog_player_statistics_v1/c'),false);
 assert.equal(h.docs.has('dog_christmas_intro_unlock_v1/c'),false);
 const finish=await h.call('POST','/api/hub/dog/christmas-intro/complete','chris');
 assert.equal(finish.completed,true);
 assert.equal(h.docs.has('dog_player_statistics_v1/c'),false);
 const david=await h.call('GET','/api/hub/dog/christmas-intro','david');
 assert.equal(david.eligible,false);
 assert.equal(david.completed,false);
});
