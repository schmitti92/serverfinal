import test from 'node:test';
import assert from 'node:assert/strict';
import {installDogAlbumSeason2,DOG_S2_COLLECTION,DOG_S2_PACKS} from '../dog-album-season2.js';

function mockServer(){
 const uid='bulk-collector',routes=new Map(),writes=[],reads=[];
 const wallet='deal_or_no_deal_wallets_v1/'+uid,old='deal_or_no_deal_christmas_v1/'+uid,album=DOG_S2_COLLECTION+'/'+uid;
 const docs=new Map([[wallet,{balance:6000000000}],[old,{freeChristmasPacks:{small:5}}]]);
 const ref=key=>({key,get:async()=>{reads.push(key);return {exists:docs.has(key),data:()=>structuredClone(docs.get(key))}}});
 const db={collection:name=>({doc:id=>ref(name+'/'+id)}),
  runTransaction:async work=>{
   let writing=false;const pending=[];
   const tx={get:async r=>{if(writing)throw Error('FIRESTORE_READ_AFTER_WRITE');return r.get()},
    set:(r,value,opts)=>{writing=true;pending.push(()=>{docs.set(r.key,structuredClone(opts?.merge?{...(docs.get(r.key)||{}),...value}:value));writes.push(r.key)})},
    create:(r,value)=>{writing=true;pending.push(()=>{if(docs.has(r.key))throw Error('DUPLICATE_RECEIPT');docs.set(r.key,structuredClone(value));writes.push(r.key)})}};
   const out=await work(tx);
   for(const put of pending)put();
   return out;
  }};
 const app={get:(p,...h)=>routes.set('GET '+p,h),post:(p,...h)=>routes.set('POST '+p,h)};
 const auth=(req,res,next)=>{req.dealIdentity={uid,displayName:'Chris'};next()};
 const fail=(res,e)=>res.status(409).json({ok:false,error:String(e.message||e)});
 installDogAlbumSeason2(app,{auth,getFirestore:()=>db,fail});
 const send=async(body)=>{const handlers=routes.get('POST /api/deal-or-no-deal/christmas/season2/open');
  const req={body},res={statusCode:200,status(v){this.statusCode=v;return this},set(){return this},json(v){this.body=v;return v}};
  for(const handler of handlers)await new Promise((resolve,reject)=>{
   let next=false;Promise.resolve(handler(req,res,()=>{next=true;resolve()})).then(()=>{if(!next)resolve()},reject)
  });
  return res;
 };
 return {uid,docs,writes,reads,wallet,old,album,send};
}

test('five DOG vouchers open together in one receipt without wallet debit, and replay never duplicates',async()=>{
 const x=mockServer(),price=DOG_S2_PACKS.find(p=>p.id==='small').price;
 const request={packId:'small',quantity:5,vouchersOnly:true,requestId:'dog2_batch_001',expectedPrice:price};
 const first=await x.send(request);
 assert.equal(first.statusCode,200,JSON.stringify(first.body));
 assert.equal(first.body.quantity,5);
 assert.equal(first.body.revealed.length,15);
 assert.equal(first.body.opened,5);
 assert.equal(first.body.freePacksOpened,5);
 assert.equal(first.body.paidPacksOpened,0);
 assert.equal(first.body.freePacks.small,0);
 assert.equal(first.body.balance,6000000000);
 assert.equal(x.docs.get(x.old).freeChristmasPacks.small,0);
 assert.equal(x.docs.get(x.wallet).balance,6000000000);
 assert.equal(x.writes.filter(k=>k===x.album).length,1,'one album write for 5 packs');
 const writes=x.writes.length;
 const replay=await x.send(request);
 assert.equal(replay.statusCode,200);
 assert.equal(replay.body.replayed,true);
 assert.deepEqual(replay.body.revealed,first.body.revealed);
 assert.equal(x.writes.length,writes,'the same receipt cannot debit or award again');
 const changed=await x.send({...request,quantity:1});
 assert.equal(changed.statusCode,409);
 assert.equal(changed.body.error,'INVALID_REQUEST_ID');
 assert.equal(x.writes.length,writes);
 const noFree=await x.send({...request,requestId:'dog2_batch_002',quantity:1});
 assert.equal(noFree.statusCode,409);
 assert.equal(noFree.body.error,'INSUFFICIENT_PACK_VOUCHERS');
});

test('five packs use remaining vouchers first, charge only the missing paid packs and do not touch other prizes',async()=>{
 const x=mockServer(),price=DOG_S2_PACKS.find(p=>p.id==='small').price;
 x.docs.get(x.old).freeChristmasPacks.small=2;
 const mixed=await x.send({packId:'small',quantity:5,vouchersOnly:false,requestId:'dog2_batch_003',expectedPrice:price});
 assert.equal(mixed.statusCode,200,JSON.stringify(mixed.body));
 assert.equal(mixed.body.freePacksOpened,2);
 assert.equal(mixed.body.paidPacksOpened,3);
 assert.equal(mixed.body.chargedPrice,3*price);
 assert.equal(mixed.body.balance,6000000000-3*price);
 assert.equal(x.docs.get(x.wallet).balance,mixed.body.balance);
 assert.equal(x.docs.get(x.old).freeChristmasPacks.small,0);
 assert.equal(mixed.body.revealed.length,15);
 assert.equal(mixed.body.opened,5);
 const bad=await x.send({packId:'small',quantity:11,requestId:'dog2_batch_004'});
 assert.equal(bad.statusCode,409);
 assert.equal(bad.body.error,'INVALID_PACK_QUANTITY');
});
