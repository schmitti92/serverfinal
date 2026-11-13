import test from 'node:test';
import assert from 'node:assert/strict';
import {drawMonsterSlot,drawMonsterSlots,monsterSlotChestOdds,MONSTER_SLOTS_WEIGHTS} from '../monster-slots.js';
import {installDealOrNoDeal} from '../deal-or-no-deal-api.js';

test('all seven slot categories total 100% and every reel always awards a prize',()=>{
 assert.equal(Object.values(MONSTER_SLOTS_WEIGHTS).reduce((a,b)=>a+b,0),100000);
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
 assert.equal(jackpot.amountCents,10_000_000_000);
});

test('slot credits require a verified completed-game payout and cannot be replayed for extra prizes',async()=>{
 const gameId='11111111-2222-4333-8444-555555555555',uid='player-a';
 const docs=new Map([
  ['deal_or_no_deal_payouts_v1/'+gameId+'_'+uid,{gameId,uid,amount:1000000}],
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
