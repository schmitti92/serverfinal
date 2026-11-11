import test from 'node:test';
import assert from 'node:assert/strict';
import {installDealOrNoDeal} from '../deal-or-no-deal-api.js';
import {create,payoutFor,publicView} from '../deal-or-no-deal.js';

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

test('x2 upgrade costs five million, belongs only to buyer, and retry never double-charges',async()=>{
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

test('both accepted deals and kept cases are x2 only for upgraded players',()=>{
 const g=create([{id:'a'},{id:'b'}],()=>0);
 g.players[0].case=0;
 g.players[0].deal=150000000;
 g.players[0].doublePayout=true;
 g.players[1].case=1;
 g.players[1].deal=null;
 g.phase='final';
 assert.equal(payoutFor(g,g.players[0]),300000000);
 assert.equal(payoutFor(g,g.players[1]),g.values[1]);
 const finals=publicView(g).finalValues;
 assert.equal(finals.find(p=>p.id==='a').payout,300000000);
 assert.equal(finals.find(p=>p.id==='b').payout,g.values[1]);
 g.players[1].doublePayout=true;
 assert.equal(payoutFor(g,g.players[1]),g.values[1]*2);
});

test('final settlement awards boosted payout exactly once and uses it for winner',async()=>{
 const h=harness();await h.invoke('POST','/api/deal-or-no-deal/:code/start');
 const purchased=await h.invoke('POST','/api/deal-or-no-deal/:code/double-boost','a');
 assert.equal(purchased.body.ok,true);
 const g=h.match();g.phase='final';g.players[0].case=0;g.players[0].deal=250000000;
 g.players[1].case=1;g.players[1].deal=250000000;
 const finished=await h.invoke('GET','/api/deal-or-no-deal/:code/balances','a');
 assert.equal(finished.body.ok,true);
 assert.equal(h.balance('a'),600000000);
 assert.equal(h.balance('b'),850000000);
 assert.equal(h.docs.get('deal_or_no_deal_payouts_v1/'+g.id+'_a').amount,500000000);
 assert.equal(h.docs.get('deal_or_no_deal_payouts_v1/'+g.id+'_b').amount,250000000);
 assert.equal(h.docs.get('deal_or_no_deal_wallets_v1/a').wins,1);
 assert.equal(h.docs.get('deal_or_no_deal_wallets_v1/b').wins,0);
 await h.invoke('GET','/api/deal-or-no-deal/:code/balances','b');
 assert.equal(h.balance('a'),600000000,'recovery must not repeat payout');
 assert.equal(h.balance('b'),850000000);
});
