import test from 'node:test';
import assert from 'node:assert/strict';
import {create} from '../deal-or-no-deal.js';
import {installDealOrNoDeal} from '../deal-or-no-deal-api.js';

function harness({modern=false}={}){
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
  phase:'ready',turn:'runner',uid:'chris',reels:modern?2:1,
  runnerUid:'chris',championUid:'david',activatedAt:Date.now(),
  startedAt:null,prizes:[]
 };
 docs.set('spielesammlung_hub_v1/'+room,{
  players:ids.map(uid=>({uid,name:uid})),hostUid:'chris',revision:1
 });
 docs.set('deal_or_no_deal_matches_v1/'+room,{game,hubRevision:1});
 for(const [uid,reels,rank] of [['chris',modern?2:1,2],['david',modern?6:3,1],['vanessa',0,3]]){
  docs.set('deal_or_no_deal_payouts_v1/'+game.id+'_'+uid,{
   uid,gameId:game.id,baseAmount:uid==='david'?900000:uid==='chris'?400000:200000,
   slotEligible:reels>0,slotReels:reels,slotRank:rank,slotVersion:modern?3:2
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
 const show=(uid,operation,expected={})=>call('/api/deal-or-no-deal/:code/monster-slots/show',uid,{gameId:game.id,operation,...expected});
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
 h.advance(3600);
 denied=await h.show('chris','confirm');
 assert.equal(denied.statusCode,409,'reel stop alone must not unlock champion');
 assert.equal(denied.body.error,'SLOT_SHOW_STILL_ROLLING');
 h.advance(4300);
 const second=await h.show('chris','confirm');
 assert.equal(second.statusCode,200,JSON.stringify(second.body));
 assert.equal(second.body.game.monsterSlotShow.phase,'ready');
 assert.equal(second.body.game.monsterSlotShow.uid,'david');
 assert.equal(second.body.game.monsterSlotShow.reels,3);
 assert.ok(second.body.game.monsterSlotShow.runnerConfirmedAt>0);
 assert.equal(second.body.game.monsterSlotShow.turn,'champion');
 const delayed=await h.show('chris','confirm',{expectedTurn:'runner',expectedUid:'chris'});
 assert.equal(delayed.statusCode,409,'stale runner taps cannot advance champion stage');
 assert.equal(delayed.body.error,'SLOT_SHOW_STALE_STAGE');
 denied=await h.show('david','spin');
 assert.equal(denied.statusCode,409,'champion cabinet waits for synchronized opening');
 assert.equal(denied.body.error,'SLOT_SHOW_PREPARING');
 h.current().monsterSlotShow.showAt=Date.now()-1;
 const champion=await h.show('david','spin',{expectedTurn:'champion',expectedUid:'david'});
 assert.equal(champion.statusCode,200,JSON.stringify(champion.body));
 assert.equal(champion.body.game.monsterSlotShow.prizes.length,3);
 assert.equal(h.docs.get('deal_monster_slots_receipts_v1/'+h.game.id+'_david').result.prizes.length,3);
 assert.equal(h.docs.has('deal_monster_slots_receipts_v1/'+h.game.id+'_vanessa'),false);
 h.advance(6200);
 denied=await h.show('david','confirm');
 assert.equal(denied.statusCode,409,'the three-reel summary must finish before ceremony');
 assert.equal(denied.body.error,'SLOT_SHOW_STILL_ROLLING');
 h.advance(8200);
 const last=await h.show('david','confirm',{expectedTurn:'champion',expectedUid:'david',
  expectedStartedAt:h.current().monsterSlotShow.startedAt});
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


test('new finale: runner-up gets two prizes then champion six, with server-stamped completion',async()=>{
 const h=harness({modern:true});
 const blocked=await h.show('david','spin');
 assert.equal(blocked.body.error,'SLOT_SHOW_NOT_YOUR_TURN');
 const first=await h.show('chris','spin');
 assert.equal(first.statusCode,200,JSON.stringify(first.body));
 assert.equal(first.body.game.monsterSlotShow.prizes.length,2);
 assert.equal(h.docs.get('deal_monster_slots_receipts_v1/'+h.game.id+'_chris').result.prizes.length,2);
 h.advance(6000);
 const tooSoon=await h.show('chris','confirm');
 assert.equal(tooSoon.body.error,'SLOT_SHOW_STILL_ROLLING','two prizes require a complete summary');
 h.advance(6700);
 const runnerConfirmed=await h.show('chris','confirm',{expectedTurn:'runner'});
 assert.equal(runnerConfirmed.statusCode,200,JSON.stringify(runnerConfirmed.body));
 assert.equal(runnerConfirmed.body.game.monsterSlotShow.reels,6);
 assert.equal(runnerConfirmed.body.game.monsterSlotShow.turn,'champion');
 assert.ok(runnerConfirmed.body.game.monsterSlotShow.runnerConfirmedAt);
 assert.equal((await h.show('david','spin')).body.error,'SLOT_SHOW_PREPARING');
 h.current().monsterSlotShow.showAt=Date.now()-1;
 const winner=await h.show('david','spin',{expectedTurn:'champion'});
 assert.equal(winner.statusCode,200,JSON.stringify(winner.body));
 assert.equal(winner.body.game.monsterSlotShow.prizes.length,6);
 assert.equal(h.docs.get('deal_monster_slots_receipts_v1/'+h.game.id+'_david').result.prizes.length,6);
 h.advance(9000);
 assert.equal((await h.show('david','confirm')).body.error,'SLOT_SHOW_STILL_ROLLING');
 h.advance(10300);
 const done=await h.show('david','confirm',{expectedTurn:'champion'});
 assert.equal(done.statusCode,200,JSON.stringify(done.body));
 assert.equal(done.body.game.monsterSlotShow.phase,'ceremony');
 const writes=h.writes.length;
 assert.equal((await h.show('david','confirm')).statusCode,200);
 assert.equal(h.writes.length,writes,'no prize can be credited twice');
 assert.equal(h.docs.has('deal_monster_slots_receipts_v1/'+h.game.id+'_vanessa'),false);
});


test('1-cent case opens exactly one shared three-reel slot; spectator cannot start it',async()=>{
 const h=harness({modern:true});
 const current=h.current(),now=Date.now(),eventId='cent-reveal-1';
 current.phase='open';
 current.caseSlotRewardVersion=1;
 current.events.push({type:'opened',case:2,amount:1,playerId:'chris',eventId});
 current.caseSlotShow={
  phase:'ready',turn:'case',uid:'chris',eventId,amount:1,reels:3,
  activatedAt:now,showAt:now-100,startedAt:null,prizes:[]
 };
 const path='/api/deal-or-no-deal/:code/monster-slots/case-show';
 const params={gameId:h.game.id,expectedUid:'chris',expectedEventId:eventId};
 const spectator=await h.call(path,'david',{...params,operation:'spin'});
 assert.equal(spectator.body.error,'SLOT_SHOW_NOT_YOUR_TURN');
 const first=await h.call(path,'chris',{...params,operation:'spin'});
 assert.equal(first.statusCode,200,JSON.stringify(first.body));
 assert.equal(first.body.game.caseSlotShow.phase,'rolling');
 assert.equal(first.body.game.caseSlotShow.prizes.length,3);
 const receipt='deal_case_slots_receipts_v1/'+h.game.id+'_'+eventId+'_chris';
 assert.equal(h.docs.get(receipt)?.result?.prizes?.length,3);
 assert.equal(h.docs.has('deal_case_slots_receipts_v1/'+h.game.id+'_'+eventId+'_david'),false);
 const replay=await h.call(path,'chris',{...params,operation:'spin'});
 assert.equal(replay.body.error,'SLOT_SHOW_ALREADY_STARTED');
 assert.equal(h.docs.get(receipt)?.result?.prizes?.length,3);
 const tooSoon=await h.call(path,'chris',{...params,operation:'confirm',expectedStartedAt:h.current().caseSlotShow.startedAt});
 assert.equal(tooSoon.body.error,'SLOT_SHOW_STILL_ROLLING');
 h.current().caseSlotShow.startedAt=Date.now()-8000;
 const finished=await h.call(path,'chris',{...params,operation:'confirm',expectedStartedAt:h.current().caseSlotShow.startedAt});
 assert.equal(finished.statusCode,200,JSON.stringify(finished.body));
 assert.equal(finished.body.game.caseSlotShow,null);
 assert.deepEqual(finished.body.game.caseSlotQueue,[]);
});

test('1-cent and 50-million batch bonuses are shown one after another, to their own players',async()=>{
 const h=harness({modern:true});
 const now=Date.now(),game=h.current();
 const a='batch-1cent',b='batch-50m';
 game.phase='decision';
 game.caseSlotRewardVersion=1;
 game.events.push(
  {type:'opened',case:3,amount:1,playerId:'chris',eventId:a},
  {type:'opened',case:4,amount:5_000_000_000,playerId:'david',eventId:b}
 );
 game.caseSlotShow={turn:'case',phase:'ready',uid:'chris',eventId:a,amount:1,reels:3,
  activatedAt:now,showAt:now-100,startedAt:null,prizes:[]};
 game.caseSlotQueue=[{uid:'david',eventId:b,amount:5_000_000_000}];
 const path='/api/deal-or-no-deal/:code/monster-slots/case-show';
 const send=(uid,operation,eventId,startedAt)=>h.call(path,uid,{
  gameId:h.game.id,expectedEventId:eventId,expectedUid:uid,operation,
  ...(startedAt===undefined?{}:{expectedStartedAt:startedAt})
 });
 const first=await send('chris','spin',a);
 assert.equal(first.statusCode,200,JSON.stringify(first.body));
 assert.equal(first.body.game.caseSlotShow.prizes.length,3);
 game.caseSlotShow.startedAt=Date.now()-8000;
 const next=await send('chris','confirm',a,game.caseSlotShow.startedAt);
 assert.equal(next.statusCode,200,JSON.stringify(next.body));
 assert.equal(next.body.game.caseSlotShow.uid,'david');
 assert.equal(next.body.game.caseSlotShow.amount,5_000_000_000);
 assert.equal(next.body.game.caseSlotQueue.length,0);
 assert.equal((await send('chris','spin',a)).body.error,'SLOT_SHOW_STALE_STAGE');
 assert.equal((await send('david','spin',b)).body.error,'SLOT_SHOW_PREPARING');
 game.caseSlotShow.showAt=Date.now()-1;
 const second=await send('david','spin',b);
 assert.equal(second.statusCode,200,JSON.stringify(second.body));
 assert.equal(second.body.game.caseSlotShow.prizes.length,3);
 const receipt='deal_case_slots_receipts_v1/'+h.game.id+'_'+b+'_david';
 assert.equal(h.docs.get(receipt)?.result?.prizes.length,3);
 assert.equal(h.docs.has('deal_case_slots_receipts_v1/'+h.game.id+'_'+b+'_chris'),false);
 game.caseSlotShow.startedAt=Date.now()-8000;
 const finished=await send('david','confirm',b,game.caseSlotShow.startedAt);
 assert.equal(finished.statusCode,200,JSON.stringify(finished.body));
 assert.equal(finished.body.game.caseSlotShow,null);
});
