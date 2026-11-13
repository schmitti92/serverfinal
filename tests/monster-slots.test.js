import test from 'node:test';
import assert from 'node:assert/strict';
import {drawMonsterSlot,drawMonsterSlots,monsterSlotChestOdds,monsterSlotPlacements,MONSTER_SLOTS_WEIGHTS,MONSTER_SLOT_CASH_PRIZES,slotCashChance} from '../monster-slots.js';
import {installDealOrNoDeal} from '../deal-or-no-deal-api.js';
import {DOG_S2_CARDS,dogS2OpenGrantedPacks} from '../dog-album-season2.js';
import {create,payoutFor} from '../deal-or-no-deal.js';

test('seven slot weights default to exactly two money shares per one combined item share',()=>{
 const {cash,...items}=MONSTER_SLOTS_WEIGHTS;
 assert.equal(cash,Object.values(items).reduce((a,b)=>a+b,0)*2);
 assert.equal(slotCashChance(MONSTER_SLOTS_WEIGHTS),2/3);
 for(const gate of [1,20,30,50,80,100]){
  const odds=monsterSlotChestOdds(gate);
  assert.equal(odds.reduce((a,b)=>a+b,0),100);
  assert.ok(odds.every(n=>n>0),'every chest tier remains attainable from the start');
 }
 const prizes=drawMonsterSlots(1,()=>0);
 assert.equal(prizes.length,3);
 assert.ok(prizes.every(p=>p.kind==='chest'&&p.id==='wood'&&p.quantity===1));
 const jackpot=drawMonsterSlot(1,max=>max-1);
 assert.equal(jackpot.kind,'cash');
 assert.equal(jackpot.amountCents,500_000_000);
});


test('won packs open immediately; only unowned cards are marked new, across multiple packs',()=>{
 const draw=dogS2OpenGrantedPacks('small',2,{},()=>0);
 assert.equal(draw.openedPacks.length,2);
 assert.ok(draw.openedPacks[0].hasNew,'first pack introduces a new card');
 assert.equal(draw.openedPacks[1].hasNew,false,'second pack has only repeats');
 assert.equal(draw.openedPacks[0].revealed.filter(card=>card.isNew).length,1);
 assert.ok(draw.openedPacks[1].revealed.every(card=>card.isNew===false));
 assert.equal(Object.values(draw.cards).reduce((sum,n)=>sum+n,0),6,'all six cards credited, including duplicates');
 const owned=Object.fromEntries(DOG_S2_CARDS.map(card=>[card.id,1]));
 for(const id of ['small','large','premium','platinum']){
  const result=dogS2OpenGrantedPacks(id,3,owned,()=>0);
  assert.ok(result.openedPacks.every(pack=>pack.hasNew===false),'full album must skip pack reveal for '+id);
  assert.equal(result.openedPacks.length,3);
  assert.equal(Object.values(result.cards).reduce((sum,n)=>sum+n,0),96+result.openedPacks.flatMap(pack=>pack.revealed).length);
 }
 assert.throws(()=>dogS2OpenGrantedPacks('invalid',1,{}),/INVALID_GRANTED_PACK/);
 assert.throws(()=>dogS2OpenGrantedPacks('small',4,{}),/INVALID_GRANTED_PACK/);
});

test('slot credits require a verified completed-game payout and cannot be replayed for extra prizes',async()=>{
 const gameId='11111111-2222-4333-8444-555555555555',uid='player-a';
 const docs=new Map([
  ['deal_or_no_deal_payouts_v1/'+gameId+'_'+uid,{gameId,uid,amount:1000000,slotReels:3,slotEligible:true,slotRank:1,slotVersion:2}],
  ['deal_or_no_deal_wallets_v1/'+uid,{balance:2000000,games:1,wins:0}]
 ]);
 const routes=new Map(),writes=[];
 const db={
  collection:name=>({doc:id=>{
   const key=name+'/'+id;
   return {
    key,get:async()=>({exists:docs.has(key),data:()=>structuredClone(docs.get(key))}),
    set:async(data,opts={})=>{const next=opts.merge?{...(docs.get(key)||{}),...data}:data;docs.set(key,structuredClone(next));writes.push(key)},
    update:async(data)=>{docs.set(key,{...(docs.get(key)||{}),...structuredClone(data)});writes.push(key)}
   };
  }}),
  runTransaction:async fn=>{
   const changes=[],tx={
    get:ref=>ref.get(),
    set:(ref,data,opts)=>changes.push(()=>ref.set(data,opts)),
    create:(ref,data)=>changes.push(async()=>{if(docs.has(ref.key))throw Error('ALREADY_EXISTS');await ref.set(data)}),
    update:(ref,data)=>changes.push(()=>ref.update(data))
   };
   const value=await fn(tx);
   for(const change of changes)await change();
   return value;
  }
 };
 const app={get:(p,...f)=>routes.set('GET '+p,f),post:(p,...f)=>routes.set('POST '+p,f)};
 installDealOrNoDeal(app,{verifyProfile:async token=>token?{uid:token}:null,getFirestore:()=>db});
 const send=async(method,path,token,body={})=>{
  const handlers=routes.get(method+' '+path);assert.ok(handlers,path);
  const req={body,params:{},get:()=> 'Bearer '+token,query:{}};
  const res={statusCode:200,status(n){this.statusCode=n;return this},
   set(){return this},json(obj){this.body=obj;return obj}};
  for(const h of handlers)await new Promise((resolve,reject)=>{
   let next=false;Promise.resolve(h(req,res,()=>{next=true;resolve()})).then(()=>{if(!next)resolve()},reject);
  });
  return res;
 };
 const path='/api/deal-or-no-deal/monster-slots/claim';
 const denied=await send('POST',path,'stranger',{gameId});
 assert.equal(denied.statusCode,409);
 assert.equal(denied.body.error,'GAME_REWARD_NOT_SETTLED');
 const first=await send('POST',path,uid,{gameId});
 assert.equal(first.statusCode,200,JSON.stringify(first.body));
 assert.equal(first.body.prizes.length,3);
 assert.ok(first.body.prizes.every(p=>p&&p.label));
 assert.equal(docs.get('deal_monster_slots_receipts_v1/'+gameId+'_'+uid).result.prizes.length,3);
 const afterFirst=writes.length;
 const again=await send('POST',path,uid,{gameId});
 assert.equal(again.statusCode,200);
 assert.equal(again.body.replayed,true);
 assert.deepEqual(again.body.prizes,first.body.prizes);
 assert.equal(writes.length,afterFirst,'receipt replay cannot mint extra rewards');
});


test('next round settles all three participants, including a silent client, without duplicate payouts',async()=>{
 const names=['host','guest','quiet'],docs=new Map(),routes=new Map(),writes=[];
 const room='123';
 const members=names.map(uid=>({uid,name:uid}));
 docs.set('spielesammlung_hub_v1/'+room,{hostUid:'host',revision:1,players:members});
 const oldGame=create(names.map(id=>({id,name:id})),()=>0);
 oldGame.phase='final';oldGame.monsterSlotsVersion=1;
 oldGame.players.forEach((p,i)=>{p.case=i;p.deal=3500000-(i*1000000)});
 docs.set('deal_or_no_deal_matches_v1/'+room,{game:oldGame,hubRevision:1});
 const oldPayouts=names.map(uid=>({uid,amount:payoutFor(oldGame,oldGame.players.find(p=>p.id===uid))}));
 const placement=monsterSlotPlacements(oldPayouts);
 for(const uid of names){
  const rank=placement.get(uid);
  docs.set('deal_or_no_deal_payouts_v1/'+oldGame.id+'_'+uid,{
   gameId:oldGame.id,uid,amount:oldPayouts.find(p=>p.uid===uid).amount,
   slotReels:rank.reels,slotEligible:rank.reels>0,slotRank:rank.rank,slotVersion:2
  });
  docs.set('deal_or_no_deal_wallets_v1/'+uid,{balance:50000000,games:1,wins:0});
 }
 const db={
  collection:name=>({doc:id=>{
   const key=name+'/'+id;
   return {key,get:async()=>({exists:docs.has(key),data:()=>structuredClone(docs.get(key))}),
    set:async(data,opts={})=>{docs.set(key,structuredClone(opts.merge?{...(docs.get(key)||{}),...data}:data));writes.push(key)},
    update:async(data)=>{docs.set(key,{...(docs.get(key)||{}),...structuredClone(data)});writes.push(key)}
   };
  }}),
  runTransaction:async fn=>{
   const writesPending=[];let wrote=false;
   const tx={
    get:ref=>{if(wrote)throw Error('FIRESTORE_READ_AFTER_WRITE');return ref.get()},
    set:(ref,data,opts)=>{wrote=true;writesPending.push(()=>ref.set(data,opts))},
    create:(ref,data)=>{wrote=true;writesPending.push(async()=>{if(docs.has(ref.key))throw Error('ALREADY_EXISTS');await ref.set(data)})},
    update:(ref,data)=>{wrote=true;writesPending.push(()=>ref.update(data))}
   };
   const result=await fn(tx);
   for(const write of writesPending)await write();
   return result;
  }
 };
 const app={get:(p,...fns)=>routes.set('GET '+p,fns),post:(p,...fns)=>routes.set('POST '+p,fns)};
 installDealOrNoDeal(app,{verifyProfile:async token=>token?{uid:token}:null,getFirestore:()=>db});
 const call=async(method,path,uid,body={})=>{
  const handlers=routes.get(method+' '+path);assert.ok(handlers,path);
  const req={body,params:{code:room},get:()=> 'Bearer '+uid,query:{}};
  const res={statusCode:200,status(n){this.statusCode=n;return this},set(){return this},json(body){this.body=body;return body}};
  for(const h of handlers)await new Promise((resolve,reject)=>{
   let nextCalled=false;
   Promise.resolve(h(req,res,()=>{nextCalled=true;resolve()})).then(()=>{if(!nextCalled)resolve()},reject);
  });
  return res;
 };
 // The host already viewed their own slots, but the other two did not.
 const first=await call('POST','/api/deal-or-no-deal/monster-slots/claim','host',{gameId:oldGame.id});
 assert.equal(first.statusCode,200,JSON.stringify(first.body));
 assert.equal(first.body.prizes.length,3);
 const next=await call('POST','/api/deal-or-no-deal/:code/start','host',{caseCount:27});
 assert.equal(next.statusCode,200,JSON.stringify(next.body));
 assert.equal(next.body.game.phase,'select');
 assert.notEqual(next.body.game.id,oldGame.id);
 for(const uid of names){
  const ref='deal_monster_slots_receipts_v1/'+oldGame.id+'_'+uid;
  const reels=placement.get(uid).reels;
  assert.equal(docs.has(ref),reels>0,'only qualified players get slot awards for '+uid);
  const prizes=docs.get(ref)?.result.prizes||[];
  assert.equal(prizes.length,reels);
  const total=(kind,key)=>prizes.filter(p=>p.kind===kind&&(!key||p.id===key))
   .reduce((sum,p)=>sum+(kind==='cash'?p.amountCents:p.quantity),0);
  const wallet=docs.get('deal_or_no_deal_wallets_v1/'+uid);
  assert.equal(wallet.balance,50000000+total('cash'),'cash must be credited exactly once');
  const chests=docs.get('dog_material_inventory_v1/'+uid)?.expeditionChests||[];
  if(total('chest'))assert.equal(chests.length,total('chest'));
  const album=docs.get('deal_or_no_deal_christmas_v1/'+uid)||{};
  const dogAlbum=docs.get('deal_dog_album_season2_v1/'+uid)||{};
  const opened=prizes.filter(p=>p.kind==='pack').flatMap(p=>p.openedPacks||[]);
  assert.equal(opened.length,total('pack'),'each won pack should open automatically');
  assert.equal(Number(dogAlbum.opened||0),total('pack'),'opened pack count must be persisted');
  assert.equal(Object.values(dogAlbum.cards||{}).reduce((sum,n)=>sum+Number(n||0),0),
   opened.reduce((sum,p)=>sum+p.revealed.length,0),'all cards must be credited without duplicates disappearing');
  for(const pack of opened){
   assert.equal(pack.hasNew,pack.revealed.some(c=>c.isNew===true));
   assert.ok(pack.revealed.every(c=>typeof c.id==='string'&&typeof c.image==='string'),'each revealed card should have art');
  }
  assert.equal(Number(album.monsterWheelTickets||0),total('monster'),'monster wheel tickets must be stored');
  const ice=docs.get('christmas_ice_progress_v1/'+uid)||{};
  for(const hammer of ['single','double','lucky'])
   assert.equal(Number(ice.freeHammers?.[hammer]||0),total('hammer',hammer),'hammer vouchers must be stored');
  const jokers=docs.get('deal_peek_inventory_v1/'+uid)||{};
  assert.equal(Number(jokers.balance||0),total('joker'),'joker inventory must be credited');
  const mini=docs.get('deal_christmas_hats_v1/'+uid)||{};
  assert.equal(Number(mini.bonusTickets||0),total('minigame'),'minigame tickets must be credited');
 }
 const countBefore=writes.length;
 for(const uid of names){
  const repeat=await call('POST','/api/deal-or-no-deal/monster-slots/claim',uid,{gameId:oldGame.id});
  if(placement.get(uid).reels===0){
   assert.equal(repeat.statusCode,409);
   assert.equal(repeat.body.error,'SLOT_NOT_ELIGIBLE');
   continue;
  }
  assert.equal(repeat.statusCode,200,JSON.stringify(repeat.body));
  assert.equal(repeat.body.replayed,true);
  assert.deepEqual(repeat.body.prizes,docs.get('deal_monster_slots_receipts_v1/'+oldGame.id+'_'+uid).result.prizes);
 }
 assert.equal(writes.length,countBefore,'receiving the results again must not debit or credit any inventory');
});

test('tied top payouts block all Slot claims and permit a new round without slot credits',async()=>{
 const names=['host','guest'],room='123',docs=new Map(),routes=new Map(),writes=[];
 docs.set('spielesammlung_hub_v1/'+room,{hostUid:'host',revision:1,players:names.map(uid=>({uid,name:uid}))});
 const previous=create(names.map(id=>({id,name:id})),()=>0);
 previous.phase='final';previous.monsterSlotsVersion=1;
 previous.players.forEach((p,i)=>{p.case=i;p.deal=1500000});
 docs.set('deal_or_no_deal_matches_v1/'+room,{game:previous,hubRevision:1});
 for(const uid of names)docs.set('deal_or_no_deal_payouts_v1/'+previous.id+'_'+uid,{
  gameId:previous.id,uid,amount:1500000,baseAmount:1500000,slotEligible:false
 });
 const db={
  collection:name=>({doc:id=>{
   const key=name+'/'+id;
   return {key,get:async()=>({exists:docs.has(key),data:()=>structuredClone(docs.get(key))}),
    set:async(data,opts={})=>{docs.set(key,structuredClone(opts.merge?{...(docs.get(key)||{}),...data}:data));writes.push(key)},
    update:async(data)=>{docs.set(key,{...(docs.get(key)||{}),...structuredClone(data)});writes.push(key)}
   };
  }}),
  runTransaction:async fn=>{
   const pending=[];let writing=false;
   const tx={
    get:ref=>{if(writing)throw Error('FIRESTORE_READ_AFTER_WRITE');return ref.get()},
    set:(ref,data,opts)=>{writing=true;pending.push(()=>ref.set(data,opts))},
    create:(ref,data)=>{writing=true;pending.push(async()=>{if(docs.has(ref.key))throw Error('ALREADY_EXISTS');await ref.set(data)})},
    update:(ref,data)=>{writing=true;pending.push(()=>ref.update(data))}
   };
   const result=await fn(tx);for(const write of pending)await write();return result;
  }
 };
 const app={get:(p,...fns)=>routes.set('GET '+p,fns),post:(p,...fns)=>routes.set('POST '+p,fns)};
 installDealOrNoDeal(app,{verifyProfile:async token=>token?{uid:token}:null,getFirestore:()=>db});
 const call=async(method,path,uid,body={})=>{
  const handlers=routes.get(method+' '+path);assert.ok(handlers,path);
  const req={body,params:{code:room},get:()=> 'Bearer '+uid,query:{}};
  const res={statusCode:200,status(n){this.statusCode=n;return this},set(){return this},json(value){this.body=value;return value}};
  for(const handler of handlers)await new Promise((resolve,reject)=>{
   let next=false;
   Promise.resolve(handler(req,res,()=>{next=true;resolve()})).then(()=>{if(!next)resolve()},reject);
  });
  return res;
 };
 for(const uid of names){
  const denied=await call('POST','/api/deal-or-no-deal/monster-slots/claim',uid,{gameId:previous.id});
  assert.equal(denied.statusCode,409);
  assert.equal(denied.body.error,'TIED_GAME_NO_SLOTS');
 }
 const started=await call('POST','/api/deal-or-no-deal/:code/start','host',{caseCount:27});
 assert.equal(started.statusCode,200,JSON.stringify(started.body));
 assert.notEqual(started.body.game.id,previous.id);
 assert.ok(!writes.some(key=>key.startsWith('deal_monster_slots_receipts_v1/')));
 for(const uid of names)assert.ok(!docs.has('deal_monster_slots_receipts_v1/'+previous.id+'_'+uid));
});


test('DOG Super Slot pays exactly five prizes for one completed board, spends one ticket and replays safely',async()=>{
 const uid='collector',requestId='dog_super_slot_test_112233',docs=new Map(),routes=new Map(),writes=[];
 const album='deal_dog_album_season2_v1/'+uid;
 docs.set(album,{season:2,cards:{},superSlotTickets:1,cycleBase:{},cycleCompletions:[1,0,0,0,0,0]});
 // Host-configured 100% cash must apply to all five server-settled DOG reels.
 docs.set('deal_or_no_deal_economy_v1/global',{slotWeights:{
  chest:0,pack:0,hammer:0,joker:0,minigame:0,monster:0,cash:100
 }});
 const db={
  collection:name=>({doc:id=>{
   const key=name+'/'+id;
   return {key,get:async()=>({exists:docs.has(key),data:()=>structuredClone(docs.get(key))}),
    set:async(data,opts={})=>{docs.set(key,structuredClone(opts?.merge?{...(docs.get(key)||{}),...data}:data));writes.push(key)}
   };
  }}),
  runTransaction:async fn=>{
   const pending=[];let writing=false;
   const tx={
    get:ref=>{if(writing)throw Error('FIRESTORE_READ_AFTER_WRITE');return ref.get()},
    set:(ref,data,opts)=>{writing=true;pending.push(()=>ref.set(data,opts))},
    create:(ref,data)=>{writing=true;pending.push(async()=>{if(docs.has(ref.key))throw Error('ALREADY_EXISTS');await ref.set(data)})}
   };
   const result=await fn(tx);for(const write of pending)await write();return result;
  }
 };
 const app={get:(p,...f)=>routes.set('GET '+p,f),post:(p,...f)=>routes.set('POST '+p,f)};
 installDealOrNoDeal(app,{verifyProfile:async token=>token?{uid:token}:null,getFirestore:()=>db});
 const send=async(uid2,requestId2)=>{
  const handlers=routes.get('POST /api/deal-or-no-deal/christmas/season2/super-slot/play');
  assert.ok(handlers);
  const req={body:{requestId:requestId2},params:{},get:()=> 'Bearer '+uid2};
  const res={statusCode:200,status(n){this.statusCode=n;return this},set(){return this},json(o){this.body=o;return o}};
  for(const h of handlers)await new Promise((resolve,reject)=>{
   let next=false;Promise.resolve(h(req,res,()=>{next=true;resolve()})).then(()=>{if(!next)resolve()},reject)
  });
  return res;
 };
 const stranger=await send('other','other_request_112233');
 assert.equal(stranger.statusCode,409);
 assert.equal(stranger.body.error,'SUPER_SLOT_TICKET_REQUIRED');
 const first=await send(uid,requestId);
 assert.equal(first.statusCode,200,JSON.stringify(first.body));
 assert.equal(first.body.prizes.length,5,'five guaranteed reels, not three');
 assert.equal(first.body.guaranteed,5);
 assert.ok(first.body.prizes.every(p=>p.kind==='cash'&&p.amountCents>=1&&p.amountCents<=500000000),
  'five-reel slot settles with the live host money-only distribution');
 assert.equal(docs.get('deal_or_no_deal_wallets_v1/'+uid).balance,
  first.body.prizes.reduce((sum,p)=>sum+p.amountCents,0),'all five cash prizes credit the wallet');
 const cashAmounts=first.body.prizes.map(p=>p.amountCents);
 const walletStats=docs.get('deal_or_no_deal_wallets_v1/'+uid).slotCashPrizeStats;
 assert.equal(walletStats.count,5,'each paid reel is tracked once in the lobby records');
 assert.equal(walletStats.minCents,Math.min(...cashAmounts));
 assert.equal(walletStats.maxCents,Math.max(...cashAmounts));
 assert.equal(walletStats.jackpots,cashAmounts.filter(n=>n===500000000).length);
 assert.equal(docs.get(album).superSlotTickets,0,'ticket must be consumed');
 assert.ok(!writes.some(key=>key.includes('christmas_ice')&&key.includes('bingo')),'Hammer-Bingo must never be modified');
 const count=writes.length;
 const replay=await send(uid,requestId);
 assert.equal(replay.statusCode,200);
 assert.equal(replay.body.replayed,true);
 assert.deepEqual(replay.body.prizes,first.body.prizes);
 assert.equal(writes.length,count,'same receipt cannot pay again');
 assert.equal(docs.get('deal_or_no_deal_wallets_v1/'+uid).slotCashPrizeStats.count,5,'replay cannot count extra Slot wins');
 const second=await send(uid,'another_super_slot_223344');
 assert.equal(second.statusCode,409);
 assert.equal(second.body.error,'SUPER_SLOT_TICKET_REQUIRED');
});


test('podium slot policy is 3/1/0: loser never spins, runner-up only in matches with 3+ people',()=>{
 const cases=[
  {payouts:[['solo',800]],expected:{solo:3}},
  {payouts:[['winner',900],['loser',100]],expected:{winner:3,loser:0}},
  {payouts:[['winner',900],['second',500],['loser',100]],expected:{winner:3,second:1,loser:0}},
  {payouts:[['a',100],['b',800],['c',300],['d',900]],expected:{a:0,b:1,c:0,d:3}},
  {payouts:[['winner',900],['secondA',500],['secondB',500],['last',100]],expected:{winner:3,secondA:0,secondB:0,last:0}},
  {payouts:[['firstA',900],['firstB',900],['third',100]],expected:{firstA:0,firstB:0,third:0}},
  {payouts:[['a',100],['b',100],['c',100]],expected:{a:0,b:0,c:0}}
 ];
 for(const scenario of cases){
  const winners=monsterSlotPlacements(scenario.payouts.map(([uid,amount])=>({uid,amount})));
  assert.deepEqual(Object.fromEntries([...winners].map(([uid,score])=>[uid,score.reels])),
   scenario.expected);
 }
 assert.throws(()=>monsterSlotPlacements([{uid:'x',amount:1},{uid:'x',amount:2}]),/INVALID_SLOT_RANKINGS/);
 assert.throws(()=>monsterSlotPlacements([{uid:'x',amount:NaN}]),/INVALID_SLOT_RANKINGS/);
});

test('a runner-up reel draws exactly one award, while DOG five-reel Super Slots remain unchanged',()=>{
 const podium=monsterSlotPlacements([
  {uid:'winner',amount:2500000},
  {uid:'runner',amount:1500000},
  {uid:'last',amount:500000}
 ]);
 assert.equal(podium.get('winner').reels,3);
 assert.equal(podium.get('runner').reels,1);
 assert.equal(podium.get('last').reels,0);
 const one=[drawMonsterSlot(1,()=>0)];
 assert.equal(one.length,1);
 assert.equal(drawMonsterSlots(1,()=>0).length,3);
});

test('slot prize table has varied exact amounts including one cent and five million euros',()=>{
 assert.ok(MONSTER_SLOT_CASH_PRIZES.length>=30);
 assert.equal(MONSTER_SLOT_CASH_PRIZES[0][0],1);
 assert.equal(MONSTER_SLOT_CASH_PRIZES.at(-1)[0],500_000_000);
 assert.ok(MONSTER_SLOT_CASH_PRIZES.every(([amount,weight],index)=>Number.isSafeInteger(amount)&&
  amount>=1&&amount<=500_000_000&&Number.isSafeInteger(weight)&&weight>0&&
  (!index||amount>MONSTER_SLOT_CASH_PRIZES[index-1][0])));
 const onlyMoney=Object.fromEntries(Object.keys(MONSTER_SLOTS_WEIGHTS).map(k=>[k,k==='cash'?1:0]));
 assert.equal(drawMonsterSlot(1,()=>0,onlyMoney).amountCents,1,'minimum cash amount');
 assert.equal(drawMonsterSlot(1,max=>max-1,onlyMoney).amountCents,500_000_000,'maximum cash amount');
 assert.equal(drawMonsterSlots(1,max=>max-1,onlyMoney).every(p=>p.kind==='cash'),true);
});
test('host can change category weights including disabling item or money prizes',()=>{
 const moneyOnly={...MONSTER_SLOTS_WEIGHTS,chest:0,pack:0,hammer:0,joker:0,minigame:0,monster:0,cash:250};
 const itemOnly={...MONSTER_SLOTS_WEIGHTS,cash:0};
 assert.equal(slotCashChance(moneyOnly),1);
 assert.equal(slotCashChance(itemOnly),0);
 assert.equal(drawMonsterSlot(40,()=>0,moneyOnly).kind,'cash');
 assert.notEqual(drawMonsterSlot(40,max=>max-1,itemOnly).kind,'cash');
 assert.equal(drawMonsterSlots(80,()=>0,moneyOnly).length,3);
});
