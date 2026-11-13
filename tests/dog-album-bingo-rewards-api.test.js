import test from 'node:test';
import assert from 'node:assert/strict';
import {installDogAlbumSeason2,DOG_S2_CARDS,DOG_S2_COLLECTION} from '../dog-album-season2.js';
import {DOG_MATERIALS_COLLECTION,dogInventory} from '../dog-materials.js';

function setup(cards={}){
 const uid='bingo-player',docs=new Map([
  [DOG_S2_COLLECTION+'/'+uid,{season:2,cards,opened:0}],
  ['deal_or_no_deal_wallets_v1/'+uid,{balance:525000000,games:6}],
  [DOG_MATERIALS_COLLECTION+'/'+uid,{chests:{small:1,medium:0,large:0,legacy:0},earned:1,opened:0}],
  ['deal_peek_inventory_v1/'+uid,{balance:3}],
  ['deal_christmas_hats_v1/'+uid,{bonusTickets:2,voucherOnly:true}],
  ['deal_or_no_deal_christmas_v1/'+uid,{monsterWheelTickets:4}],
  ['christmas_ice_progress_v1/'+uid,{freeHammers:{single:2,double:1,lucky:0},wheelHammers:{single:2,double:1,lucky:0}}]
 ]);
 const writes=[],reads=[];const routes=new Map();
 const snapshot=ref=>({exists:docs.has(ref.key),data:()=>structuredClone(docs.get(ref.key))});
 const db={
  collection:name=>({doc:id=>({
   key:name+'/'+id,
   get:async function(){reads.push(this.key);return snapshot(this)},
   set:async function(data,{merge}={}){docs.set(this.key,structuredClone(merge?{...(docs.get(this.key)||{}),...data}:data));writes.push(this.key)}
  })}),
  runTransaction:async fn=>{
   const pending=[],tx={
    get:ref=>ref.get(),
    set:(ref,data,options)=>pending.push(()=>ref.set(data,options)),
    create:(ref,data)=>pending.push(async()=>{if(docs.has(ref.key))throw Error('DUPLICATE');await ref.set(data)})
   };
   const result=await fn(tx);
   for(const change of pending)await change();
   return result;
  }
 };
 const app={get:(path,...handlers)=>routes.set('GET '+path,handlers),post:(path,...handlers)=>routes.set('POST '+path,handlers)};
 const auth=(req,res,next)=>{req.dealIdentity={uid:req.headers.uid};next()};
 const fail=(res,e)=>res.status(409).json({ok:false,error:String(e?.message||e)});
 installDogAlbumSeason2(app,{auth,getFirestore:()=>db,fail});
 const send=async(method,path)=>{
  const handlers=routes.get(method+' /api/deal-or-no-deal/christmas/season2/'+path);
  assert.ok(handlers,'route missing '+path);
  const req={headers:{uid},body:{}},res={code:200,status(n){this.code=n;return this},set(){return this},json(v){this.body=v;return v}};
  for(const handler of handlers){
   await new Promise((resolve,reject)=>{
    let next=false;Promise.resolve(handler(req,res,()=>{next=true;resolve()})).then(()=>{if(!next)resolve()},reject);
   });
  }
  return res;
 };
 return {send,docs,writes,reads,uid};
}

test('server credits two real lines once and keeps all inventory balances',async()=>{
 const cards=Object.fromEntries(DOG_S2_CARDS.slice(0,8).map(c=>[c.id,1]));
 const {send,docs,writes,uid}=setup(cards);
 const before=await send('GET','me');
 assert.equal(before.body.progress.bingos,2);
 assert.deepEqual(before.body.rewards.pending,[2]);
 const first=await send('POST','rewards/claim');
 assert.equal(first.code,200,JSON.stringify(first.body));
 assert.equal(first.body.awarded.length,1);
 assert.equal(first.body.awarded[0].at,2);
 assert.equal(first.body.awarded[0].chestTier,'wood');
 assert.equal(first.body.awarded[0].bonuses.length,1);
 const newInventory=dogInventory(docs.get(DOG_MATERIALS_COLLECTION+'/'+uid));
 assert.equal(newInventory.chests.small,1,'existing legacy chests must stay');
 assert.equal(newInventory.expeditionChests.reduce((s,c)=>s+c.quantity,0),1,'one new wood expedition chest');
 assert.equal(newInventory.earned,2);
 assert.equal(docs.get(DOG_S2_COLLECTION+'/'+uid).bingoRewardsHistory.length,1);
 assert.equal(docs.get(DOG_S2_COLLECTION+'/'+uid).cards[DOG_S2_CARDS[0].id],1,'first card remains collected');
 const prize=first.body.awarded[0].bonuses[0];
 if(prize.kind==='cash')assert.ok(docs.get('deal_or_no_deal_wallets_v1/'+uid).balance>525000000);
 if(prize.kind==='joker')assert.equal(docs.get('deal_peek_inventory_v1/'+uid).balance,3+prize.quantity);
 if(prize.kind==='minigame')assert.equal(docs.get('deal_christmas_hats_v1/'+uid).bonusTickets,2+prize.quantity);
 if(prize.kind==='monster')assert.equal(docs.get('deal_or_no_deal_christmas_v1/'+uid).monsterWheelTickets,4+prize.quantity);
 if(prize.kind==='hammer')assert.equal(docs.get('christmas_ice_progress_v1/'+uid).freeHammers[prize.hammer],(prize.hammer==='single'?2:prize.hammer==='double'?1:0)+prize.quantity);
 const writeCount=writes.length;
 const again=await send('POST','rewards/claim');
 assert.equal(again.code,200);
 assert.equal(again.body.replayed,true);
 assert.deepEqual(again.body.awarded,[]);
 assert.equal(writes.length,writeCount,'repeated claim cannot write again');
 const final=await send('GET','me');
 assert.equal(final.body.rewards.claimed,1);
 assert.deepEqual(final.body.rewards.pending,[]);
});

test('claim with no finished bingo needs one read and performs zero Firestore writes',async()=>{
 const {send,writes,reads}=setup({});
 const result=await send('POST','rewards/claim');
 assert.equal(result.code,200);
 assert.deepEqual(result.body.awarded,[]);
 assert.deepEqual(result.body.rewards.pending,[]);
 assert.equal(writes.length,0);
 assert.equal(reads.length,1);
});

test('all 60 lines pay 30 checkpoints once, including 2 legendary chests and 4 extra prizes at 60',async()=>{
 const cards=Object.fromEntries(DOG_S2_CARDS.map(c=>[c.id,1]));
 const {send,docs,uid}=setup(cards);
 const result=await send('POST','rewards/claim');
 assert.equal(result.code,200,JSON.stringify(result.body));
 assert.equal(result.body.awarded.length,30);
 assert.equal(result.body.rewards.claimed,30);
 assert.deepEqual(result.body.rewards.pending,[]);
 assert.equal(result.body.awarded.at(-1).at,60);
 assert.equal(result.body.awarded.at(-1).chests.length,2);
 assert.equal(result.body.awarded.at(-1).bonuses.length,4);
 const stored=dogInventory(docs.get(DOG_MATERIALS_COLLECTION+'/'+uid));
 assert.equal(stored.unopened,32,'one old chest + 31 new milestone chests');
 assert.equal(stored.expeditionChests.reduce((s,c)=>s+c.quantity,0),31);
 assert.equal(docs.get(DOG_S2_COLLECTION+'/'+uid).bingoRewardsHistory.length,30);
});
