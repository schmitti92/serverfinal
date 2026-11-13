import test from 'node:test';
import assert from 'node:assert/strict';
import {installDealOrNoDeal} from '../deal-or-no-deal-api.js';

const gameId='33333333-4444-4555-8666-777777777777';
function build(payouts,{legacy=true}={}){
 const docs=new Map(),routes=new Map(),writes=[];
 const standings=payouts.map(([uid,baseAmount])=>({uid,baseAmount}));
 const highest=Math.max(...standings.map(p=>p.baseAmount));
 const unique=standings.filter(p=>p.baseAmount===highest).length===1;
 for(const {uid,baseAmount} of standings){
  docs.set('deal_or_no_deal_payouts_v1/'+gameId+'_'+uid,{
   gameId,uid,baseAmount,amount:baseAmount,slotEligible:legacy?unique:false,createdAt:10
  });
  docs.set('deal_or_no_deal_wallets_v1/'+uid,{balance:1000000,games:1,wins:uid===payouts[0][0]?1:0});
 }
 const clone=value=>value===undefined?undefined:structuredClone(value);
 const db={
  collection:name=>({
   doc:id=>{
    const key=name+'/'+id;
    return {key,get:async()=>({exists:docs.has(key),data:()=>clone(docs.get(key))}),
     set:async(data,opts={})=>{docs.set(key,clone(opts.merge?{...(docs.get(key)||{}),...data}:data));writes.push(key)},
     update:async(data)=>{docs.set(key,{...(docs.get(key)||{}),...clone(data)});writes.push(key)}};
   },
   where:(field,op,value)=>({
    get:async()=>({docs:[...docs].filter(([key,data])=>key.startsWith(name+'/')&&
     op==='=='&&data?.[field]===value).map(([key,data])=>({
      id:key.slice(name.length+1),exists:true,data:()=>clone(data)
     }))})
   })
  }),
  runTransaction:async fn=>{
   const pending=[];let wrote=false;
   const tx={
    get:ref=>{if(wrote)throw Error('FIRESTORE_READ_AFTER_WRITE');return ref.get()},
    set:(ref,data,opts)=>{wrote=true;pending.push(()=>ref.set(data,opts))},
    create:(ref,data)=>{wrote=true;pending.push(async()=>{if(docs.has(ref.key))throw Error('ALREADY_EXISTS');await ref.set(data)})},
    update:(ref,data)=>{wrote=true;pending.push(()=>ref.update(data))}
   };
   const result=await fn(tx);
   for(const op of pending)await op();
   return result;
  }
 };
 const app={get:(path,...functions)=>routes.set('GET '+path,functions),
  post:(path,...functions)=>routes.set('POST '+path,functions)};
 installDealOrNoDeal(app,{verifyProfile:async token=>token?{uid:token}:null,getFirestore:()=>db});
 async function claim(uid){
  const handlers=routes.get('POST /api/deal-or-no-deal/monster-slots/claim');
  const req={body:{gameId},params:{},get:()=> 'Bearer '+uid,query:{}};
  const res={statusCode:200,status(code){this.statusCode=code;return this},
   set(){return this},json(value){this.body=value;return value}};
  for(const handler of handlers)await new Promise((resolve,reject)=>{
   let nextCalled=false;
   Promise.resolve(handler(req,res,()=>{nextCalled=true;resolve()})).then(()=>{
    if(!nextCalled)resolve();
   },reject);
  });
  return res;
 }
 return {docs,writes,claim};
}

test('legacy finalized match: champion David receives 3, runner-up 1, loser none',async()=>{
 const {docs,writes,claim}=build([['david',90000],['chris',60000],['vanessa',10000]]);
 const david=await claim('david');
 assert.equal(david.statusCode,200,JSON.stringify(david.body));
 assert.equal(david.body.guaranteed,3);
 assert.equal(david.body.rank,1);
 assert.equal(david.body.prizes.length,3);
 const davidPayout=docs.get('deal_or_no_deal_payouts_v1/'+gameId+'_david');
 assert.equal(davidPayout.slotReels,3);
 assert.equal(davidPayout.slotVersion,2);
 const chris=await claim('chris');
 assert.equal(chris.statusCode,200,JSON.stringify(chris.body));
 assert.equal(chris.body.guaranteed,1);
 assert.equal(chris.body.rank,2);
 assert.equal(docs.get('deal_or_no_deal_payouts_v1/'+gameId+'_chris').slotReels,1);
 const rejected=await claim('vanessa');
 assert.equal(rejected.statusCode,409);
 assert.equal(rejected.body.error,'SLOT_NOT_ELIGIBLE');
 assert.equal(docs.has('deal_monster_slots_receipts_v1/'+gameId+'_vanessa'),false);
 const count=writes.length;
 const replay=await claim('david');
 assert.equal(replay.statusCode,200);
 assert.equal(replay.body.replayed,true);
 assert.deepEqual(replay.body.prizes,david.body.prizes);
 assert.equal(writes.length,count,'retries must not pay another prize');
});

test('legacy runner-up tie never credits second place, while sole champion may claim',async()=>{
 const {docs,claim}=build([['david',3000],['chris',2000],['vanessa',2000],['other',900]]);
 const winner=await claim('david');
 assert.equal(winner.statusCode,200,JSON.stringify(winner.body));
 assert.equal(winner.body.guaranteed,3);
 for(const uid of ['chris','vanessa','other']){
  const result=await claim(uid);
  assert.equal(result.statusCode,409,uid);
  assert.equal(result.body.error,'SLOT_NOT_ELIGIBLE',uid);
  assert.equal(docs.has('deal_monster_slots_receipts_v1/'+gameId+'_'+uid),false);
 }
});

test('tied winners never receive slots even from an old entitlement marker',async()=>{
 const {docs,claim}=build([['david',3000],['chris',3000],['vanessa',1000]]);
 const result=await claim('david');
 assert.equal(result.statusCode,409);
 assert.equal(result.body.error,'TIED_GAME_NO_SLOTS');
 assert.equal(docs.has('deal_monster_slots_receipts_v1/'+gameId+'_david'),false);
});
