import test from 'node:test';
import assert from 'node:assert/strict';
import {installDealOrNoDeal} from '../deal-or-no-deal-api.js';
import {create,payoutFor,cashCreditFor,publicView} from '../deal-or-no-deal.js';

const PRICE=300000000; // 3,000,000 EUR in cents
function harness(){
 const routes=new Map(),docs=new Map();
 const key=(name,id)=>name+'/'+id;
 const snapshots=(name,id)=>({exists:docs.has(key(name,id)),data:()=>docs.get(key(name,id))});
 const db={
  collection:name=>({doc:id=>({
   get:async()=>snapshots(name,id),
   set:async(data,opts={})=>{const k=key(name,id);docs.set(k,opts.merge?{...(docs.get(k)||{}),...data}:data)},
   update:async data=>{const k=key(name,id);docs.set(k,{...(docs.get(k)||{}),...data})}
  })}),
  runTransaction:async callback=>{
   const pending=[];
   const tx={
    get:ref=>ref.get(),
    set:(ref,data,opts)=>pending.push(()=>ref.set(data,opts)),
    update:(ref,data)=>pending.push(()=>ref.update(data)),
    create:(ref,data)=>pending.push(()=>ref.set(data))
   };
   const result=await callback(tx);
   for(const write of pending)await write();
   return result;
  }
 };
 docs.set('spielesammlung_hub_v1/123',{hostUid:'a',revision:1,players:[{uid:'a',name:'Alpha'},{uid:'b',name:'Beta'}]});
 docs.set('deal_or_no_deal_wallets_v1/a',{balance:PRICE+100000000,games:1,wins:0});
 docs.set('deal_or_no_deal_wallets_v1/b',{balance:PRICE+100000000,games:1,wins:0});
 const app={get:(path,...handlers)=>routes.set('GET '+path,handlers),post:(path,...handlers)=>routes.set('POST '+path,handlers)};
 installDealOrNoDeal(app,{getFirestore:()=>db,verifyProfile:async token=>token?{uid:token}:null});
 const invoke=async(method,path,uid='a',body={})=>{
  const handlers=routes.get(method+' '+path);assert.ok(handlers,'route '+method+' '+path);
  const req={params:{code:'123'},body,get:()=> 'Bearer '+uid,query:{}};
  const res={statusCode:200,status(n){this.statusCode=n;return this},json(data){this.body=data;return this},set(){return this}};
  for(const handler of handlers)await new Promise((resolve,reject)=>{
   let completed=false;
   Promise.resolve(handler(req,res,()=>{completed=true;resolve()})).then(()=>{if(!completed)resolve()},reject);
  });
  return res;
 };
 const balance=uid=>docs.get('deal_or_no_deal_wallets_v1/'+uid)?.balance||0;
 const match=()=>docs.get('deal_or_no_deal_matches_v1/123')?.game;
 return {invoke,balance,docs,match};
}

test('x2 upgrade costs three million, belongs only to buyer, and retry never double-charges',async()=>{
 const h=harness();
 const start=await h.invoke('POST','/api/deal-or-no-deal/:code/start');
 assert.equal(start.body.ok,true);
 const buy=await h.invoke('POST','/api/deal-or-no-deal/:code/double-boost','a');
 assert.equal(buy.statusCode,200);
 assert.equal(buy.body.cost,PRICE);
 assert.equal(buy.body.alreadyActive,false);
 assert.equal(h.balance('a'),100000000);
 assert.equal(h.balance('b'),PRICE+100000000);
 assert.equal(h.match().players.find(p=>p.id==='a').doublePayout,true);
 assert.equal(h.match().players.find(p=>p.id==='b').doublePayout,false);
 const retry=await h.invoke('POST','/api/deal-or-no-deal/:code/double-boost','a');
 assert.equal(retry.body.alreadyActive,true);
 assert.equal(h.balance('a'),100000000);
 assert.equal(retry.body.game.revision,buy.body.game.revision);
});

test('boost requires sufficient money, participant membership and unselected own case',async()=>{
 const h=harness();await h.invoke('POST','/api/deal-or-no-deal/:code/start');
 h.docs.set('deal_or_no_deal_wallets_v1/a',{balance:PRICE-1});
 const poor=await h.invoke('POST','/api/deal-or-no-deal/:code/double-boost','a');
 assert.equal(poor.statusCode,409);
 assert.equal(poor.body.error,'BOOST_INSUFFICIENT_FUNDS');
 const outsider=await h.invoke('POST','/api/deal-or-no-deal/:code/double-boost','c');
 assert.equal(outsider.statusCode,403);
 assert.equal(outsider.body.error,'NOT_IN_ROOM');
 const game=h.match(),id=game.order[0];
 const selected=await h.invoke('POST','/api/deal-or-no-deal/:code/action',id,{type:'select',case:0,id:'case-before-boost',revision:game.revision});
 assert.equal(selected.body.ok,true);
 const late=await h.invoke('POST','/api/deal-or-no-deal/:code/double-boost',id);
 assert.equal(late.body.error,'BOOST_WINDOW_CLOSED');
 // Another participant who has not selected their case may still buy.
 const other=game.order[1];
 h.docs.set('deal_or_no_deal_wallets_v1/'+other,{balance:PRICE+100000000});
 const allowed=await h.invoke('POST','/api/deal-or-no-deal/:code/double-boost',other);
 assert.equal(allowed.body.ok,true);
 assert.equal(allowed.body.game.players.find(p=>p.id===other).doublePayout,true);
});


test('accepted Banker deals and kept cases remain original results, x2 applies only to final cash credits',()=>{
 const g=create([{id:'a'},{id:'b'}],()=>0);
 g.players[0].case=0;
 g.players[0].deal=150000000;
 g.players[0].doublePayout=true;
 g.players[1].case=1;
 g.players[1].deal=null;
 g.phase='final';
 assert.equal(payoutFor(g,g.players[0]),150000000);
 assert.equal(cashCreditFor(g,g.players[0]),300000000);
 assert.equal(payoutFor(g,g.players[1]),g.values[1]);
 assert.equal(cashCreditFor(g,g.players[1]),g.values[1]);
 const finals=publicView(g).finalValues;
 assert.equal(finals.find(p=>p.id==='a').payout,150000000,'official results are not doubled');
 assert.equal(finals.find(p=>p.id==='b').payout,g.values[1]);
 assert.equal(finals.find(p=>p.id==='a').amount,g.values[0],'case contents stay unchanged');
 g.players[1].doublePayout=true;
 assert.equal(payoutFor(g,g.players[1]),g.values[1],'retained suitcase keeps original value');
 assert.equal(cashCreditFor(g,g.players[1]),g.values[1]*2,'wallet receives doubled amount only');
 assert.equal(publicView(g).finalValues[1].payout,g.values[1],'no boost in public winner ranking');
});

test('boosted player with a lower original win does not become the match winner; wallet credit is exactly once',async()=>{
 const h=harness();await h.invoke('POST','/api/deal-or-no-deal/:code/start');
 const purchased=await h.invoke('POST','/api/deal-or-no-deal/:code/double-boost','a');
 assert.equal(purchased.body.ok,true);
 const g=h.match();g.phase='final';
 g.players[0].case=0;g.players[0].deal=150000000;
 g.players[1].case=1;g.players[1].deal=250000000;
 assert.equal(publicView(g).finalValues[0].payout,150000000);
 assert.equal(publicView(g).finalValues[1].payout,250000000);
 const finished=await h.invoke('GET','/api/deal-or-no-deal/:code/balances','a');
 assert.equal(finished.body.ok,true);
 assert.equal(h.balance('a'),400000000,'100m cents left after purchase + 300m credited');
 assert.equal(h.balance('b'),PRICE+100000000+250000000);
 const paidA=h.docs.get('deal_or_no_deal_payouts_v1/'+g.id+'_a');
 const paidB=h.docs.get('deal_or_no_deal_payouts_v1/'+g.id+'_b');
 assert.equal(paidA.amount,300000000);
 assert.equal(paidA.baseAmount,150000000);
 assert.equal(paidA.bonusAmount,150000000);
 assert.equal(paidB.amount,250000000);
 assert.equal(paidB.baseAmount,250000000);
 assert.equal(paidB.bonusAmount,0);
 assert.equal(h.docs.get('deal_or_no_deal_wallets_v1/a').wins,0,'boosted player is NOT the winner');
 assert.equal(h.docs.get('deal_or_no_deal_wallets_v1/b').wins,1,'unboosted player with larger base result wins');
 await h.invoke('GET','/api/deal-or-no-deal/:code/balances','b');
 assert.equal(h.balance('a'),400000000,'recovery must not repeat bonus credit');
 assert.equal(h.balance('b'),PRICE+100000000+250000000);
});

test('a base-result tie stays tied even when only one player purchased x2',async()=>{
 const h=harness();await h.invoke('POST','/api/deal-or-no-deal/:code/start');
 await h.invoke('POST','/api/deal-or-no-deal/:code/double-boost','a');
 const g=h.match();g.phase='final';
 g.players[0].case=0;g.players[0].deal=250000000;
 g.players[1].case=1;g.players[1].deal=250000000;
 const result=publicView(g).finalValues;
 assert.equal(result[0].payout,result[1].payout,'draw is not broken by purchased multiplier');
 const done=await h.invoke('GET','/api/deal-or-no-deal/:code/balances','a');
 assert.equal(done.body.ok,true);
 assert.equal(h.balance('a'),600000000,'×2 buyer receives extra cash');
 assert.equal(h.balance('b'),PRICE+100000000+250000000);
 assert.equal(h.docs.get('deal_or_no_deal_wallets_v1/a').wins,1);
 assert.equal(h.docs.get('deal_or_no_deal_wallets_v1/b').wins,1);
});


test('live last-decision settlement chooses and rewards original winner, not a higher x2 wallet credit',async()=>{
 const h=harness();await h.invoke('POST','/api/deal-or-no-deal/:code/start');
 const buy=await h.invoke('POST','/api/deal-or-no-deal/:code/double-boost','a');
 assert.equal(buy.body.ok,true);
 const g=h.match();
 g.players[0].case=0;g.players[0].deal=150000000;
 g.players[1].case=1;g.players[1].deal=null;
 g.phase='decision';g.offer=250000000;
 g.history=[{round:1,offer:250000000,expectedValue:250000000,participants:['b'],decisions:[],bonusPack:null,bonusHammer:null,bonusSpecial:null}];
 const finish=await h.invoke('POST','/api/deal-or-no-deal/:code/action','b',{type:'decide',deal:true,id:'settle-final-vote',revision:g.revision});
 assert.equal(finish.body.ok,true,JSON.stringify(finish.body));
 assert.equal(finish.body.game.phase,'final');
 assert.equal(finish.body.game.finalValues.find(p=>p.id==='a').payout,150000000);
 assert.equal(finish.body.game.finalValues.find(p=>p.id==='b').payout,250000000);
 assert.equal(h.docs.get('deal_christmas_final_rewards_v1/'+g.id)?.uid,'b','winner wheel must go to genuine match winner');
 assert.equal(h.docs.get('deal_or_no_deal_wallets_v1/a')?.wins,0,'x2 cash does not count as a win');
 assert.equal(h.docs.get('deal_or_no_deal_wallets_v1/b')?.wins,1);
 assert.equal(h.balance('a'),400000000);
 assert.equal(h.balance('b'),PRICE+100000000+250000000);
 assert.equal(h.docs.get('deal_or_no_deal_payouts_v1/'+g.id+'_a').amount,300000000);
});
