import test from 'node:test';
import assert from 'node:assert/strict';
import {installDealOrNoDeal} from '../deal-or-no-deal-api.js';
import {classicChristmasProgress} from '../christmas-card-engine.js';

const uid='bingo-voucher-test-player';
const albumKey='deal_or_no_deal_christmas_v1/'+uid;
const walletKey='deal_or_no_deal_wallets_v1/'+uid;
const iceKey='christmas_ice_progress_v1/'+uid;
const jokerKey='deal_peek_inventory_v1/'+uid;
const bingoCards=(extra=8)=>{
 const ids=[...Array.from({length:32},(_,i)=>i+1),
  ...Array.from({length:extra},(_,i)=>65+i)];
 return Object.fromEntries(ids.map(n=>['christmas-'+String(n).padStart(2,'0'),1]));
};
function fixture({album={cards:bingoCards(),opened:0},balance=0}={}){
 const routes=new Map(),documents=new Map([[walletKey,{balance}],[albumKey,structuredClone(album)]]);
 const writes=[];
 const db={
  collection:collection=>({doc:id=>({key:collection+'/'+id})}),
  runTransaction:async execute=>{
   const queued=[];
   const tx={
    get:async ref=>({exists:documents.has(ref.key),data:()=>structuredClone(documents.get(ref.key))}),
    set:(ref,data,opts)=>queued.push({key:ref.key,data,merge:opts?.merge===true,create:false}),
    create:(ref,data)=>queued.push({key:ref.key,data,merge:false,create:true}),
    update:(ref,data)=>queued.push({key:ref.key,data,merge:true,create:false})
   };
   const result=await execute(tx);
   for(const op of queued){
    if(op.create&&documents.has(op.key))throw Error('ALREADY_EXISTS');
    const before=documents.get(op.key)||{};
    documents.set(op.key,structuredClone(op.merge?{...before,...op.data}:op.data));
    writes.push(op.key);
   }
   return result;
  }
 };
 const app={
  get:(path,...handlers)=>routes.set('GET '+path,handlers),
  post:(path,...handlers)=>routes.set('POST '+path,handlers)
 };
 installDealOrNoDeal(app,{verifyProfile:async()=>({uid,name:'Bingo Test'}),getFirestore:()=>db});
 const request=async(method,endpoint,body={})=>{
  const handlers=routes.get(method+' /api/deal-or-no-deal/'+endpoint);
  assert.ok(handlers,'Endpoint missing: '+endpoint);
  const req={body,get:()=> 'Bearer test-token'};
  const res={statusCode:200,status(n){this.statusCode=n;return this},json(data){this.payload=data;return data}};
  for(const handler of handlers){
   if(handler.length>=3)await new Promise((resolve,reject)=>{
    Promise.resolve(handler(req,res,resolve)).catch(reject);
   });
   else await handler(req,res);
  }
  return {code:res.statusCode,...res.payload};
 };
 return {request,documents,writes,album:()=>documents.get(albumKey),wallet:()=>documents.get(walletKey)};
}
const open=(f,id)=>f.request('POST','christmas/open',{packId:'premium',requestId:id});

test('Bingo 22 grants two saved Premium vouchers, not 24 automatically opened cards',async()=>{
 const original=bingoCards();
 assert.equal(classicChristmasProgress(original).totalBingos,22);
 const f=fixture({album:{cards:original,opened:0}});
 const before=await f.request('GET','christmas/me');
 assert.deepEqual(before.northPolePending,['north-premium-2']);
 assert.equal(before.freePacks.premium,0);
 const claim=await f.request('POST','christmas/north-pole/claim');
 assert.equal(claim.code,200);
 assert.equal(claim.freePacks.premium,2);
 assert.deepEqual(claim.claimed.map(c=>c.id),['north-premium-2']);
 assert.deepEqual(claim.packs,[],'card draw must wait for shop redemption');
 assert.equal(f.album().opened,0);
 assert.deepEqual(f.album().cards,original);
 assert.equal(f.album().northPolePremiumVouchersIssued,true);
 const again=await f.request('POST','christmas/north-pole/claim');
 assert.equal(again.replayed,true);
 assert.equal(f.album().freeChristmasPacks.premium,2);
 const after=await f.request('GET','christmas/me');
 assert.equal(after.freePacks.premium,2);
 assert.deepEqual(after.northPolePending,[]);
});

test('Two free Premium packs work at zero balance, consume one voucher each and never debit wallet',async()=>{
 const f=fixture();
 await f.request('POST','christmas/north-pole/claim');
 const beforeWrites=f.writes.filter(k=>k===walletKey).length;
 const first=await open(f,'bingo22-free-premium-pack-0001');
 assert.equal(first.code,200);
 assert.equal(first.usedFreePack,true);
 assert.equal(first.revealed.length,12);
 assert.equal(first.balance,0);
 assert.equal(first.freePacks.premium,1);
 assert.equal(f.album().freeChristmasPacks.premium,1);
 assert.equal(f.wallet().balance,0);
 const replay=await open(f,'bingo22-free-premium-pack-0001');
 assert.equal(replay.replayed,true);
 assert.equal(f.album().opened,1);
 const second=await open(f,'bingo22-free-premium-pack-0002');
 assert.equal(second.usedFreePack,true);
 assert.equal(second.freePacks.premium,0);
 assert.equal(f.album().opened,2);
 assert.equal(f.wallet().balance,0);
 assert.equal(f.writes.filter(k=>k===walletKey).length,beforeWrites,'free pack must never write the wallet');
 const third=await open(f,'bingo22-free-premium-pack-0003');
 assert.equal(third.code,409);
 assert.equal(third.error,'INSUFFICIENT_FUNDS');
 assert.equal(f.album().opened,2);
});

test('After vouchers are spent, the normal paid Premium price and receipt idempotency remain intact',async()=>{
 const f=fixture({balance:300000000});
 await f.request('POST','christmas/north-pole/claim');
 await open(f,'bingo22-premium-free-one-0001');
 await open(f,'bingo22-premium-free-two-0002');
 assert.equal(f.wallet().balance,300000000);
 const paid=await open(f,'bingo22-premium-paid-0003');
 assert.equal(paid.code,200);
 assert.equal(paid.usedFreePack,false);
 assert.equal(paid.balance,200000000);
 assert.equal(f.album().opened,3);
 const replay=await open(f,'bingo22-premium-paid-0003');
 assert.equal(replay.replayed,true);
 assert.equal(f.wallet().balance,200000000);
 assert.equal(f.album().opened,3);
});

test('Players who already reached Bingo 22 receive exactly one voucher backfill without removing existing cards',async()=>{
 const original=bingoCards();
 const f=fixture({album:{cards:original,opened:2,northPoleMilestonesClaimed:{'north-premium-2':12345}}});
 const pending=await f.request('GET','christmas/me');
 assert.deepEqual(pending.northPolePending,['north-premium-2']);
 const first=await f.request('POST','christmas/north-pole/claim');
 assert.equal(first.code,200);
 assert.equal(first.freePacks.premium,2);
 assert.equal(first.claimed[0].id,'north-premium-2');
 assert.deepEqual(f.album().cards,original,'previously awarded cards must remain');
 assert.equal(f.album().opened,2,'existing pack openings are not rolled back');
 assert.equal(f.album().northPoleMilestonesClaimed['north-premium-2'],12345);
 const again=await f.request('POST','christmas/north-pole/claim');
 assert.equal(again.replayed,true);
 assert.equal(f.album().freeChristmasPacks.premium,2);
 assert.deepEqual((await f.request('GET','christmas/me')).northPolePending,[]);
});

test('Other North Pole rewards still settle atomically alongside Premium vouchers',async()=>{
 const f=fixture({album:{cards:bingoCards(16),opened:0}});
 assert.equal(classicChristmasProgress(f.album().cards).totalBingos,30);
 const result=await f.request('POST','christmas/north-pole/claim');
 assert.equal(result.code,200);
 assert.equal(result.claimed.length,5);
 assert.equal(result.freePacks.premium,2);
 assert.equal(result.goldHammers,3);
 assert.equal(result.jokers,3);
 assert.equal(result.monsterTickets,1);
 assert.equal(result.packs.length,1,'exclusive platinum combo still includes its immediate pack');
 assert.equal(result.packs[0].packId,'platinum');
 assert.equal(f.documents.get(iceKey).freeHammers.lucky,3);
 assert.equal(f.documents.get(jokerKey).balance,3);
 assert.equal(f.album().monsterWheelTickets,1);
 assert.equal((await f.request('POST','christmas/north-pole/claim')).replayed,true);
});
