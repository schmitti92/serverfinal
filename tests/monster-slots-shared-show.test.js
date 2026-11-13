import test from 'node:test';
import assert from 'node:assert/strict';
import {create} from '../deal-or-no-deal.js';
import {installDealOrNoDeal} from '../deal-or-no-deal-api.js';

function harness(){
 const ids=['chris','david','vanessa'],room='123',routes=new Map(),docs=new Map(),writes=[];
 const game=create(ids.map(id=>({id,name:id})),()=>0);
 game.phase='final';game.monsterSlotsVersion=1;game.revision=15;
 // publicView recomputes the final values from the actual server game,
 // so test fixtures need real selected cases/deals, not only finalValues.
 game.players.forEach((p,i)=>{p.case=i;p.deal=p.id==='david'?900000:p.id==='chris'?400000:200000;});

 game.finalValues=[
  {id:'chris',payout:400000,amount:400000,case:0},
  {id:'david',payout:900000,amount:900000,case:1},
  {id:'vanessa',payout:200000,amount:200000,case:2}
 ];
 game.monsterSlotShow={
  phase:'ready',turn:'runner',uid:'chris',reels:1,
  runnerUid:'chris',championUid:'david',activatedAt:Date.now(),
  startedAt:null,prizes:[]
 };
 docs.set('spielesammlung_hub_v1/'+room,{
  players:ids.map(uid=>({uid,name:uid})),hostUid:'chris',revision:1
 });
 docs.set('deal_or_no_deal_matches_v1/'+room,{game,hubRevision:1});
 for(const [uid,reels,rank] of [['chris',1,2],['david',3,1],['vanessa',0,3]]){
  docs.set('deal_or_no_deal_payouts_v1/'+game.id+'_'+uid,{
   uid,gameId:game.id,baseAmount:uid==='david'?900000:uid==='chris'?400000:200000,
   slotEligible:reels>0,slotReels:reels,slotRank:rank,slotVersion:2
  });
  docs.set('deal_or_no_deal_wallets_v1/'+uid,{balance:0,games:1});
 }
 const clone=value=>value===undefined?undefined:structuredClone(value);
 const db={
  collection:name=>({doc:id=>{
   const key=name+'/'+id;
   return {key,get:async()=>({exists:docs.has(key),data:()=>clone(docs.get(key))}),
    set:async(data,opts={})=>{docs.set(key,clone(opts.merge?{...(docs.get(key)||{}),...data}:data));writes.push(key)},
    update:async(data)=>{docs.set(key,{...(docs.get(key)||{}),...clone(data)});writes.push(key)}};
  }}),
  runTransaction:async fn=>{
   const pending=[];let wrote=false;
   const tx={
    get:ref=>{if(wrote)throw Error('FIRESTORE_READ_AFTER_WRITE');return ref.get()},
    set:(ref,data,opts={})=>{wrote=true;pending.push(()=>ref.set(data,opts))},
    create:(ref,data)=>{wrote=true;pending.push(async()=>{if(docs.has(ref.key))throw Error('ALREADY_EXISTS');await ref.set(data)})},
    update:(ref,data)=>{wrote=true;pending.push(()=>ref.update(data))}
   };
   const result=await fn(tx);
   for(const op of pending)await op();
   return result;
  }
 };
 const app={get:(path,...handlers)=>routes.set('GET '+path,handlers),
  post:(path,...handlers)=>routes.set('POST '+path,handlers)};
 installDealOrNoDeal(app,{verifyProfile:async token=>token?{uid:token}:null,getFirestore:()=>db});
 async function call(path,uid,body){
  const handlers=routes.get('POST '+path);
  assert.ok(handlers,path);
  const req={params:{code:room},body,get:()=> 'Bearer '+uid,query:{}};
  const res={statusCode:200,status(status){this.statusCode=status;return this},
   set(){return this},json(body){this.body=body;return body}};
  for(const h of handlers)await new Promise((resolve,reject)=>{
   let nextCalled=false;
   Promise.resolve(h(req,res,()=>{nextCalled=true;resolve()}))
    .then(()=>{if(!nextCalled)resolve()},reject);
  });
  return res;
 }
 const show=(uid,operation)=>call('/api/deal-or-no-deal/:code/monster-slots/show',uid,{gameId:game.id,operation});
 return {ids,game,docs,writes,show,call,
  current:()=>docs.get('deal_or_no_deal_matches_v1/'+room).game,
  advance(ms=10000){
   const match=docs.get('deal_or_no_deal_matches_v1/'+room);
   match.game.monsterSlotShow.startedAt=Date.now()-ms;
  }};
}

test('room-wide finale: runner-up spins one reel, champion spins three, then ceremony',async()=>{
 const h=harness();
 let denied=await h.show('david','spin');
 assert.equal(denied.statusCode,409);
 assert.equal(denied.body.error,'SLOT_SHOW_NOT_YOUR_TURN');

 let first=await h.show('chris','spin');
 assert.equal(first.statusCode,200,JSON.stringify(first.body));
 assert.equal(first.body.game.monsterSlotShow.phase,'rolling');
 assert.equal(first.body.game.monsterSlotShow.uid,'chris');
 assert.equal(first.body.game.monsterSlotShow.prizes.length,1,
  'one real prize is published to every spectator through publicView');
 assert.equal(h.docs.get('deal_monster_slots_receipts_v1/'+h.game.id+'_chris').result.prizes.length,1);

 denied=await h.show('chris','confirm');
 assert.equal(denied.statusCode,409);
 assert.equal(denied.body.error,'SLOT_SHOW_STILL_ROLLING');
 h.advance();
 const second=await h.show('chris','confirm');
 assert.equal(second.statusCode,200,JSON.stringify(second.body));
 assert.equal(second.body.game.monsterSlotShow.phase,'ready');
 assert.equal(second.body.game.monsterSlotShow.uid,'david');
 assert.equal(second.body.game.monsterSlotShow.reels,3);

 const champion=await h.show('david','spin');
 assert.equal(champion.statusCode,200,JSON.stringify(champion.body));
 assert.equal(champion.body.game.monsterSlotShow.prizes.length,3);
 assert.equal(h.docs.get('deal_monster_slots_receipts_v1/'+h.game.id+'_david').result.prizes.length,3);
 assert.equal(h.docs.has('deal_monster_slots_receipts_v1/'+h.game.id+'_vanessa'),false);
 h.advance();
 const last=await h.show('david','confirm');
 assert.equal(last.statusCode,200,JSON.stringify(last.body));
 assert.equal(last.body.game.monsterSlotShow.phase,'ceremony');
 assert.ok(last.body.game.monsterSlotShow.finishedAt>0);
 const count=h.writes.length;
 const repeat=await h.show('david','confirm');
 assert.equal(repeat.statusCode,200);
 assert.equal(repeat.body.game.monsterSlotShow.phase,'ceremony');
 assert.equal(h.writes.length,count,'repeat confirms never credit prizes twice');
});

test('any remaining participant can resume an abandoned turn after 30 seconds',async()=>{
 const h=harness();
 let denied=await h.show('vanessa','spin');
 assert.equal(denied.statusCode,409);
 h.current().monsterSlotShow.activatedAt=Date.now()-31000;
 const rescued=await h.show('vanessa','spin');
 assert.equal(rescued.statusCode,200,JSON.stringify(rescued.body));
 assert.equal(rescued.body.game.monsterSlotShow.uid,'chris');
 assert.equal(rescued.body.game.monsterSlotShow.prizes.length,1);
 assert.equal(h.docs.get('deal_monster_slots_receipts_v1/'+h.game.id+'_chris').result.prizes.length,1);
});
