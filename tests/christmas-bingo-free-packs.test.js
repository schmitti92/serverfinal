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
  collection:collection=>({doc:id=>{
   const key=collection+'/'+id;
   return {key,get:async()=>({exists:documents.has(key),data:()=>structuredClone(documents.get(key))})};
  }}),
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
  const res={statusCode:200,set(){return this},status(n){this.statusCode=n;return this},json(data){this.payload=data;return data}};
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
 assert.equal(result.code,200,JSON.stringify(result));
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


const OLD_NORTH_MILESTONE_IDS=['north-premium-2','north-gold-hammers-2','north-jokers-2','north-platinum-combo','north-monster-spin-1'];
const FOURTH_TIER_CARDS={
 32:[0,1,2,3,4,8,12],
 34:[0,1,2,3,4,5,6,7,8,9,12],
 36:[0,1,2,3,4,5,6,7,8,9,10,11,12,13],
 38:[0,1,2,3,4,5,6,7,8,9,10,11,12,13,15],
 40:[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]
};
function bingoFourthCards(at){
 return {...bingoCards(16),...Object.fromEntries(FOURTH_TIER_CARDS[at].map(i=>['christmas-'+(81+i),1]))};
}
function existing30(){
 return {
  cards:bingoCards(16),opened:0,northPolePremiumVouchersIssued:true,
  northPoleMilestonesClaimed:Object.fromEntries(OLD_NORTH_MILESTONE_IDS.map(id=>[id,1000]))
 };
}
test('Bingo 32, 34, 36, 38, 40 pay their requested exact prizes, once at each boundary',async()=>{
 const f=fixture({album:existing30()});
 const tiers=[
  {at:32,id:'fourth-monster-spin-1',monster:1,jokers:0,hammers:0,hats:0},
  {at:34,id:'fourth-jokers-2',monster:1,jokers:2,hammers:0,hats:0},
  {at:36,id:'fourth-hats-voucher-1',monster:1,jokers:2,hammers:0,hats:1},
  {at:38,id:'fourth-gold-hammers-3',monster:1,jokers:2,hammers:3,hats:1},
  {at:40,id:'fourth-grand-combo',monster:1,jokers:5,hammers:6,hats:3}
 ];
 const hatsKey='deal_christmas_hats_v1/'+uid;
 for(const tier of tiers){
  f.album().cards=bingoFourthCards(tier.at);
  const preview=await f.request('GET','christmas/me');
  assert.equal(preview.progress.totalBingos,tier.at);
  assert.deepEqual(preview.northPolePending,[tier.id]);
  const claimed=await f.request('POST','christmas/north-pole/claim');
  assert.equal(claimed.code,200,JSON.stringify(claimed));
  assert.deepEqual(claimed.claimed.map(m=>m.id),[tier.id]);
  assert.equal(f.album().monsterWheelTickets,tier.monster);
  assert.equal(f.documents.get(jokerKey)?.balance||0,tier.jokers);
  assert.equal(f.documents.get(iceKey)?.freeHammers?.lucky||0,tier.hammers);
  assert.equal(f.documents.get(iceKey)?.wheelHammers?.lucky||0,tier.hammers);
  assert.equal(f.documents.get(hatsKey)?.bonusTickets||0,tier.hats);
  if(tier.hats)assert.equal(f.documents.get(hatsKey).voucherOnly,true);
  const writes=f.writes.length;
  const repeat=await f.request('POST','christmas/north-pole/claim');
  assert.equal(repeat.replayed,true,'no repeated credit at Bingo '+tier.at);
  assert.equal(f.writes.length,writes);
 }
 const completed=await f.request('GET','christmas/me');
 assert.equal(completed.progress.nextReward,null);
 assert.equal(completed.northPolePending.length,0);
 assert.equal(completed.progress.rewards.includes('fourth-grand-combo'),true);
});

test('Players already at 40 Bingos receive all five new rewards retroactively exactly once',async()=>{
 const f=fixture({album:{...existing30(),cards:bingoFourthCards(40)}});
 const first=await f.request('POST','christmas/north-pole/claim');
 assert.equal(first.code,200,JSON.stringify(first));
 assert.deepEqual(first.claimed.map(m=>m.at),[32,34,36,38,40]);
 assert.equal(first.monsterTickets,1);
 assert.equal(first.jokers,5);
 assert.equal(first.goldHammers,6);
 assert.equal(first.hatsVouchers,3);
 assert.equal(f.album().monsterWheelTickets,1);
 assert.equal(f.documents.get(jokerKey).balance,5);
 assert.equal(f.documents.get(iceKey).wheelHammers.lucky,6);
 assert.equal(f.documents.get('deal_christmas_hats_v1/'+uid).bonusTickets,3);
 const before=f.writes.length;
 const replay=await f.request('POST','christmas/north-pole/claim');
 assert.equal(replay.replayed,true);
 assert.equal(f.writes.length,before);
});

test('Bingo 36 and 40 vouchers preserve a player’s existing Hats run',async()=>{
 const hatsKey='deal_christmas_hats_v1/'+uid;
 const claimed=Object.fromEntries([...OLD_NORTH_MILESTONE_IDS,
  'fourth-monster-spin-1','fourth-jokers-2'].map(id=>[id,1000]));
 const f=fixture({album:{cards:bingoFourthCards(40),opened:0,
  northPolePremiumVouchersIssued:true,northPoleMilestonesClaimed:claimed}});
 const game={version:1,id:'hats-party-existing',status:'playing',room:7,
  freeVoucherUsed:true,bonusTickets:2,checkpoint:3};
 f.documents.set(hatsKey,structuredClone(game));
 const settled=await f.request('POST','christmas/north-pole/claim');
 assert.equal(settled.code,200,JSON.stringify(settled));
 assert.deepEqual(settled.claimed.map(m=>m.at),[36,38,40]);
 const saved=f.documents.get(hatsKey);
 assert.equal(saved.id,game.id);
 assert.equal(saved.room,game.room);
 assert.equal(saved.status,'playing');
 assert.equal(saved.freeVoucherUsed,true);
 assert.equal(saved.bonusTickets,5,'1 from Bingo 36 and 2 from Bingo 40');
});
