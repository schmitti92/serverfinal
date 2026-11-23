import test from 'node:test';
import assert from 'node:assert/strict';
import {installDogScratchEditionApi} from '../christmas-scratch-api.js';
import {OTHER_EDITION_COLLECTION,OTHER_EDITION_HISTORY,OTHER_EDITION_DEFAULT}
 from '../dog/christmas-other-editions.js';

const CURRENT=OTHER_EDITION_COLLECTION+'/current_premium_27';
const ARCHIVE=OTHER_EDITION_HISTORY+'/premium_27_premium-latest';

function fixture(){
 const routes={get:new Map(),post:new Map()},documents=new Map();
 const edition={
  id:'premium-latest',variantId:'premium_27',createdBy:'creator',
  createdAt:Date.parse('2026-11-22T09:00:00Z'),revision:6,
  size:500,issued:35,paidCoins:90000,maxTotalCoins:2000000,
  config:OTHER_EDITION_DEFAULT.premium_27,prizePlan:Array(500).fill('v6:01'),
  budgetMode:'fixed'
 };
 documents.set(CURRENT,structuredClone(edition));
 documents.set('dog_christmas_scratch_v1/creator',{coins:1000,paidReceipt:'unchanged'});
 const db={
  collection:name=>({doc:id=>({path:name+'/'+id,
   get:async()=>({exists:documents.has(name+'/'+id),
    data:()=>structuredClone(documents.get(name+'/'+id))})})}),
  runTransaction:async fn=>{
   const writes=[];
   const tx={
    get:async ref=>({exists:documents.has(ref.path),
      data:()=>structuredClone(documents.get(ref.path))}),
    set:(ref,value)=>writes.push({type:'set',path:ref.path,value:structuredClone(value)}),
    delete:ref=>writes.push({type:'delete',path:ref.path})
   };
   const output=await fn(tx);
   for(const w of writes){
    if(w.type==='delete')documents.delete(w.path);
    else documents.set(w.path,w.value);
   }
   return output;
  }
 };
 const app={post:(route,fn)=>routes.post.set(route,fn),
  get:(route,fn)=>routes.get.set(route,fn)};
 const admin={auth:()=>({verifyIdToken:async token=>({uid:token})})};
 installDogScratchEditionApi(app,{getFirestore:()=>db,admin,
  scratchAdminUids:['creator','different-account'],christmasEventActive:()=>true});
 async function call(suffix,uid,body,method='post'){
  const req={body,get:key=>key==='authorization'?'Bearer '+uid:null};
  const res={statusCode:200,status(code){this.statusCode=code;return this},
   set(){return this},json(payload){this.payload=payload;return this}};
  const route=routes[method].get('/api/hub/scratch/editions/premium_27'+suffix);
  assert.equal(typeof route,'function');
  await route(req,res);
  return res;
 }
 const payload={editionId:edition.id,expectedRevision:edition.revision,
  confirmation:'RETIRE_PREMIUM_27'};
 return {call,documents,edition,payload};
}
test('Premium: creator retirement archives full ledger, keeps existing receipts and frees current',async()=>{
 const env=fixture(),beforeWallet=structuredClone(env.documents.get('dog_christmas_scratch_v1/creator'));
 const result=await env.call('/retire','creator',env.payload);
 assert.equal(result.statusCode,200,JSON.stringify(result.payload));
 assert.equal(result.payload.otherEdition,null);
 assert.equal(result.payload.retiredEdition.issued,35);
 assert.equal(result.payload.retiredEdition.unsoldCancelled,465);
 assert.equal(env.documents.has(CURRENT),false);
 const history=env.documents.get(ARCHIVE);
 assert.deepEqual(history.prizePlan,env.edition.prizePlan,'historical payout ledger remains intact');
 assert.equal(history.paidCoins,env.edition.paidCoins,'already paid money must not change');
 assert.equal(history.retiredBy,'creator');
 assert.equal(history.retiredUnsoldCount,465);
 assert.deepEqual(env.documents.get('dog_christmas_scratch_v1/creator'),beforeWallet);
 const newSeries=await env.call('','creator',{
  maxTotalCoins:2000000,config:OTHER_EDITION_DEFAULT.premium_27
 });
 assert.equal(newSeries.statusCode,200,JSON.stringify(newSeries.payload));
 assert.equal(newSeries.payload.otherEdition.remaining,500);
 assert.notEqual(newSeries.payload.otherEdition.id,env.edition.id);
 assert.deepEqual(env.documents.get(ARCHIVE),history,'old run cannot be overwritten');
});
test('Premium: other player cannot retire creator edition',async()=>{
 const env=fixture();
 const result=await env.call('/retire','different-account',env.payload);
 assert.equal(result.statusCode,403);
 assert.equal(result.payload.error,'SCRATCH_EDITION_ONLY_CREATOR');
 assert.equal(env.documents.has(CURRENT),true);
 assert.equal(env.documents.has(ARCHIVE),false);
});
test('Premium: stale revision and missing confirmation reject without writes',async()=>{
 const env=fixture();
 const stale=await env.call('/retire','creator',{...env.payload,expectedRevision:5});
 assert.equal(stale.statusCode,409);
 assert.equal(stale.payload.error,'SCRATCH_EDITION_CHANGED');
 const missing=await env.call('/retire','creator',{...env.payload,confirmation:''});
 assert.equal(missing.statusCode,400);
 assert.equal(missing.payload.error,'SCRATCH_EDITION_CONFIRMATION_REQUIRED');
 assert.equal(env.documents.has(CURRENT),true);
 assert.equal(env.documents.has(ARCHIVE),false);
});
test('Premium: retirement refuses to overwrite an existing historical archive',async()=>{
 const env=fixture();
 env.documents.set(ARCHIVE,{retained:'historic'});
 const result=await env.call('/retire','creator',env.payload);
 assert.equal(result.statusCode,400);
 assert.equal(result.payload.error,'SCRATCH_EDITION_ARCHIVE_CONFLICT');
 assert.equal(env.documents.has(CURRENT),true);
 assert.deepEqual(env.documents.get(ARCHIVE),{retained:'historic'});
});

test('Premium: live one-document status permits finding a run missing from cached shop data',async()=>{
 const env=fixture();
 const creator=await env.call('/status','creator',undefined,'get');
 assert.equal(creator.statusCode,200);
 assert.equal(creator.payload.ok,true);
 assert.equal(creator.payload.otherEdition.id,env.edition.id);
 assert.equal(creator.payload.otherEdition.revision,6);
 assert.equal(creator.payload.otherEdition.remaining,465);
 assert.equal(creator.payload.canRetire,true);
 assert.equal(creator.payload.otherEdition.prizePlan,undefined,
  'the 500 internal ticket outcomes must never be sent to the client');
 assert.equal(creator.payload.otherEdition.createdBy,undefined);
 const other=await env.call('/status','other-member',undefined,'get');
 assert.equal(other.statusCode,200);
 assert.equal(other.payload.canRetire,false);
 const archived=await env.call('/retire','creator',env.payload);
 assert.equal(archived.statusCode,200);
 const after=await env.call('/status','creator',undefined,'get');
 assert.equal(after.statusCode,200);
 assert.equal(after.payload.otherEdition,null);
 assert.equal(after.payload.canRetire,false);
});
