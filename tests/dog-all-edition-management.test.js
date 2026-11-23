import test from 'node:test';
import assert from 'node:assert/strict';
import {installDogScratchEditionApi} from '../christmas-scratch-api.js';
import {GIFTS_EDITION_COLLECTION,GIFTS_EDITION_HISTORY_COLLECTION} from '../dog/christmas-gifts-edition.js';
import {SNOW_EDITION_COLLECTION,SNOW_EDITION_HISTORY_COLLECTION} from '../dog/christmas-snow-edition.js';
import {TIC_EDITION_COLLECTION,TIC_EDITION_HISTORY_COLLECTION,TIC_EDITION_DEFAULT}
 from '../dog/christmas-tic-edition.js';
import {OTHER_EDITION_COLLECTION,OTHER_EDITION_HISTORY,OTHER_EDITION_DEFAULT}
 from '../dog/christmas-other-editions.js';

const variants={
 gifts:{collection:GIFTS_EDITION_COLLECTION,history:GIFTS_EDITION_HISTORY_COLLECTION,doc:'current',config:{coinAmounts:[10,40,100]}},
 snow_collect:{collection:SNOW_EDITION_COLLECTION,history:SNOW_EDITION_HISTORY_COLLECTION,doc:'current',config:{coinAmounts:[10,40,100]}},
 tic_tac_toe:{collection:TIC_EDITION_COLLECTION,history:TIC_EDITION_HISTORY_COLLECTION,doc:'current',config:TIC_EDITION_DEFAULT},
 ...Object.fromEntries(Object.entries(OTHER_EDITION_DEFAULT).map(([variant,config])=>
  [variant,{collection:OTHER_EDITION_COLLECTION,history:OTHER_EDITION_HISTORY,doc:'current_'+variant,config}]))
};
const archiveId=(variant,id)=>['gifts','snow_collect','tic_tac_toe'].includes(variant)?id:variant+'_'+id;
const responseName=variant=>variant==='gifts'?'giftsEdition':
 variant==='snow_collect'?'snowEdition':variant==='tic_tac_toe'?'ticEdition':'otherEdition';

function setup(){
 const routes={get:new Map(),post:new Map()},storage=new Map();
 const app={get:(route,fn)=>routes.get.set(route,fn),
  post:(route,fn)=>routes.post.set(route,fn)};
 const admin={auth:()=>({verifyIdToken:async token=>({uid:token})})};
 const db={collection:name=>({doc:id=>{
  const path=name+'/'+id;
  return {path,get:async()=>({exists:storage.has(path),
   data:()=>structuredClone(storage.get(path))})}
 }}),runTransaction:async fn=>{
  const staged=[];
  const tx={get:async ref=>({exists:storage.has(ref.path),
    data:()=>structuredClone(storage.get(ref.path))}),
   set:(ref,value)=>staged.push(['set',ref.path,structuredClone(value)]),
   delete:ref=>staged.push(['delete',ref.path])};
  const result=await fn(tx);
  for(const [kind,path,value] of staged){
   if(kind==='delete')storage.delete(path);
   else storage.set(path,value);
  }
  return result;
 }};
 installDogScratchEditionApi(app,{admin,getFirestore:()=>db});
 async function call(method,variant,path,uid,body){
  const req={body,get:name=>name==='authorization'?'Bearer '+uid:null};
  const res={statusCode:200,status(n){this.statusCode=n;return this},
   set(){return this},json(value){this.result=value;return this}};
  const route=routes[method].get('/api/hub/scratch/editions/'+variant+path);
  assert.equal(typeof route,'function','missing '+method+' '+variant+path);
  await route(req,res);
  return res;
 }
 return {storage,call,routes};
}
for(const [variant,spec] of Object.entries(variants)){
 test('DOG: '+variant+' manages only its own latest series and preserves historical payouts',async()=>{
  const env=setup(),id='current-edition-'+variant;
  const path=spec.collection+'/'+spec.doc;
  const previous={id,variantId:variant,createdBy:'creator',
   createdAt:Date.now(),issued:41,paidCoins:16000,maxTotalCoins:200000,
   revision:9,prizePlan:[],config:spec.config,budgetMode:'fixed'};
  env.storage.set(path,previous);
  const other=variants[variant==='gifts'?'snow_collect':'gifts'];
  const otherPath=other.collection+'/'+other.doc;
  env.storage.set(otherPath,{sentinel:'untouched'});
  const status=await env.call('get',variant,'/status','creator');
  assert.equal(status.statusCode,200,JSON.stringify(status.result));
  assert.equal(status.result[responseName(variant)].id,id);
  assert.equal(status.result.canRetire,true);
  assert.equal(status.result[responseName(variant)].prizePlan,undefined,
   'unissued prize plans must not leave the server');
  const stranger=await env.call('get',variant,'/status','different-person');
  assert.equal(stranger.result.canRetire,false);
  const request={editionId:id,expectedRevision:9,
   confirmation:'RETIRE_'+variant.toUpperCase()};
  const forbidden=await env.call('post',variant,'/retire','different-person',request);
  assert.equal(forbidden.statusCode,403);
  assert.equal(env.storage.has(path),true);
  const success=await env.call('post',variant,'/retire','creator',request);
  assert.equal(success.statusCode,200,JSON.stringify(success.result));
  assert.equal(success.result[responseName(variant)],null);
  assert.equal(success.result.retiredEdition.issued,41);
  assert.equal(success.result.retiredEdition.unsoldCancelled,459);
  assert.equal(env.storage.has(path),false);
  assert.deepEqual(env.storage.get(otherPath),{sentinel:'untouched'});
  const archive=env.storage.get(spec.history+'/'+archiveId(variant,id));
  assert.equal(archive.id,id);
  assert.equal(archive.paidCoins,16000);
  assert.equal(archive.issued,41);
  assert.equal(archive.retiredBy,'creator');
  const empty=await env.call('get',variant,'/status','creator');
  assert.equal(empty.result[responseName(variant)],null);
  assert.equal(empty.result.canRetire,false);
  const duplicate=await env.call('post',variant,'/retire','creator',request);
  assert.notEqual(duplicate.statusCode,200,'retirement is not repeated');
 });
}
