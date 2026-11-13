import test from 'node:test';
import assert from 'node:assert/strict';
import {installChristmasIceApi} from '../christmas-ice-api.js';
import {installChristmasHatsApi,drawHatsRoom} from '../christmas-hats-api.js';
import {newIceState} from '../christmas-ice-engine.js';

const iceColl='christmas_ice_progress_v1';
const hatsColl='deal_christmas_hats_v1';
const inventoryColl='deal_peek_inventory_v1';
const dogInventoryColl='dog_material_inventory_v1';
const walletColl='deal_or_no_deal_wallets_v1';
const uid='joker-voucher-test-player';

function setup({completed=2,maxRewarded=completed,hats=null}={}){
 const s={...newIceState(()=>0),completed,maxRewarded,star:0,
  freeHammers:{single:1,double:0,lucky:0},balance:0};
 const docs=new Map([
  [iceColl+'/'+uid,s],
  [walletColl+'/'+uid,{balance:0}],
  [inventoryColl+'/'+uid,{balance:0}],
  ...(hats?[ [hatsColl+'/'+uid,hats] ]:[])
 ]);
 const writes=[],reads=[],routes=new Map();
 const app={
  get:(url,...handlers)=>routes.set('GET '+url,handlers),
  post:(url,...handlers)=>routes.set('POST '+url,handlers)
 };
 const db={
  collection:name=>({doc:key=>{
   const path=name+'/'+key;
   return {path,async get(){
    const value=docs.get(path);
    return {exists:value!==undefined,data:()=>structuredClone(value)};
   }};
  }}),
  async runTransaction(fn){
   const queued=[];
   let wrote=false;
   const tx={
    async get(ref){
     assert.equal(wrote,false,'Firestore transaction may not read after write');
     reads.push(ref.path);
     const value=docs.get(ref.path);
     return {exists:value!==undefined,data:()=>structuredClone(value)};
    },
    set:(ref,value,opt)=>{wrote=true;queued.push({path:ref.path,value:structuredClone(value),merge:!!opt?.merge})},
    create:(ref,value)=>{wrote=true;queued.push({path:ref.path,value:structuredClone(value),merge:false})},
    update:(ref,value)=>{wrote=true;queued.push({path:ref.path,value:structuredClone(value),merge:true})}
   };
   const result=await fn(tx);
   for(const q of queued){
    writes.push(q.path);
    docs.set(q.path,q.merge?{...(docs.get(q.path)||{}),...q.value}:q.value);
   }
   return result;
  }
 };
 const verifyProfile=async()=>({uid});
 installChristmasIceApi(app,{verifyProfile,getFirestore:()=>db});
 installChristmasHatsApi(app,{verifyProfile,getFirestore:()=>db});
 const call=async(method,url,body={})=>{
  const handlers=routes.get(method+' '+url);
  assert.ok(handlers,'missing route '+method+' '+url);
  const req={body,query:{},get:()=> 'Bearer verified-token'};
  const res={statusCode:200,body:null,headers:{},
   set(key,value){this.headers[key]=value;return this},
   status(code){this.statusCode=code;return this},
   json(obj){this.body=obj;return obj}};
  await new Promise((resolve,reject)=>{
   handlers[0](req,res,()=>resolve(handlers[1](req,res))).catch(reject);
  });
  return res;
 };
 const strike=(requestId='joker-gift-hit-00000001')=>call('POST','/api/christmas-ice/action',
  {type:'strike',index:0,hammer:'single',requestId,expectedPicture:completed+1});
 const getHats=()=>call('GET','/api/christmas-hats/me');
 return {docs,reads,writes,strike,getHats,call,
  ice:()=>docs.get(iceColl+'/'+uid),
  hats:()=>docs.get(hatsColl+'/'+uid),
  inventory:()=>docs.get(inventoryColl+'/'+uid),
  dogInventory:()=>docs.get(dogInventoryColl+'/'+uid)};
}

test('Joker-gift on picture 3 awards one real hats ticket in the same transaction',async()=>{
 const f=setup();
 const r=await f.strike();
 assert.equal(r.statusCode,200,JSON.stringify(r.body));
 assert.equal(r.body.result.found,true);
 assert.equal(r.body.result.gift?.kind,'joker');
 assert.equal(r.body.result.gift.hatsVoucher,1);
 assert.equal(r.body.result.hatsVoucherGranted,1);
 assert.equal(f.ice().completed,3);
 assert.equal(f.ice().peekJokers,1);
 assert.equal(f.inventory().balance,1);
 assert.equal(f.hats().bonusTickets,1);
 assert.equal(f.hats().voucherOnly,true);
 assert.equal(f.ice().prizes.at(-1).hatsVoucher,1,'reloading the gift retains voucher display');
 assert.equal(f.writes.filter(path=>path===hatsColl+'/'+uid).length,1);
 const hats=await f.getHats();
 assert.equal(hats.statusCode,200);
 assert.equal(hats.body.state,null,'ticket-only state is not a fake finished game');
 assert.deepEqual(hats.body.vouchers,{free:1,bonus:1,total:2,used:false,active:false});
});

test('a newly earned voucher is spendable after the first free hats game, never silently consumed',async()=>{
 const f=setup();
 await f.strike();
 const start1=await f.call('POST','/api/christmas-hats/action',{type:'start',requestId:'hats-start-free-00000001'});
 assert.equal(start1.statusCode,200,JSON.stringify(start1.body));
 assert.equal(start1.body.result.voucherConsumed,'free');
 assert.deepEqual(start1.body.vouchers,{free:0,bonus:1,total:1,used:true,active:true});
 const before=f.hats().bonusTickets;
 const repeat=await f.strike();
 assert.equal(repeat.body.result.replayed,true);
 assert.equal(f.hats().bonusTickets,before);
});

test('gift voucher does not close or overwrite an already active hats run',async()=>{
 const active={
  version:1,status:'playing',id:'active-hats-party',room:4,
  layout:drawHatsRoom(4),secured:[],pending:[],freeVoucherUsed:true,bonusTickets:2,
  checkpoint:3
 };
 const f=setup({completed:5,hats:active});
 const r=await f.strike();
 assert.equal(r.statusCode,200);
 assert.equal(r.body.result.gift?.number,6);
 assert.equal(f.hats().bonusTickets,3);
 assert.equal(f.hats().status,'playing');
 assert.equal(f.hats().id,'active-hats-party');
 assert.equal(f.hats().room,4);
 assert.deepEqual(f.hats().layout,active.layout);
 const hats=await f.getHats();
 assert.equal(hats.body.state?.id,'active-hats-party');
 assert.equal(hats.body.vouchers.bonus,3);
 assert.equal(hats.body.vouchers.free,0);
});

test('replayed or formerly rewarded Joker pictures do not create extra vouchers',async()=>{
 const f=setup({completed:2,maxRewarded:3});
 const r=await f.strike();
 assert.equal(r.statusCode,200);
 assert.equal(r.body.result.found,true);
 assert.equal(r.body.result.gift,null);
 assert.equal(r.body.result.hatsVoucherGranted,undefined);
 assert.equal(f.hats(),undefined);
 const repeat=await f.strike();
 assert.equal(repeat.body.result.replayed,true);
 assert.equal(f.hats(),undefined);
});

test('ordinary money gifts and non-winning strikes never read or write hats voucher inventory',async()=>{
 const money=setup({completed:0});
 const r=await money.strike();
 assert.equal(r.statusCode,200);
 assert.equal(r.body.result.gift.kind,'money');
 assert.equal(money.hats(),undefined);
 assert.equal(money.reads.some(path=>path.startsWith(hatsColl)),false);
 const noWin=setup();
 noWin.ice().star=19;
 const miss=await noWin.strike();
 assert.equal(miss.body.result.found,false);
 assert.equal(noWin.hats(),undefined);
 assert.equal(noWin.reads.some(path=>path.startsWith(hatsColl)),false);
});

test('overflow of hats-ticket inventory aborts the whole gift transaction',async()=>{
 const f=setup({hats:{voucherOnly:true,bonusTickets:1000000}});
 const before=structuredClone(f.ice());
 const r=await f.strike();
 assert.equal(r.statusCode,409);
 assert.equal(r.body.error,'MONSTER_BALANCE_OVERFLOW');
 assert.deepEqual(f.ice(),before);
 assert.equal(f.inventory().balance,0);
 assert.equal(f.hats().bonusTickets,1000000);
 assert.deepEqual(f.writes,[],'no partial joker or ticket credit');
});


test('new Christmas picture awards one DOG box alongside existing money prize; retry never duplicates it',async()=>{
 const f=setup({completed:0});
 const first=await f.strike('dog-ice-picture-one-00001');
 assert.equal(first.statusCode,200,JSON.stringify(first.body));
 assert.equal(first.body.result.found,true);
 assert.equal(first.body.result.gift.kind,'money');
 assert.ok(['wood','iron','silver','gold','legendary'].includes(first.body.result.dogChest?.tier));
 assert.equal(f.dogInventory().unopened,1);
 assert.equal(f.dogInventory().earned,1);
 assert.equal(f.dogInventory().expeditionChests[0].quantity,1);
 assert.equal(f.ice().prizes.at(-1).dogChest.tier,first.body.result.dogChest.tier);
 assert.equal(f.ice().lastActions.at(-1).result.dogChest.tier,first.body.result.dogChest.tier);
 const writes=f.writes.length;
 const repeated=await f.strike('dog-ice-picture-one-00001');
 assert.equal(repeated.body.result.replayed,true);
 assert.equal(f.writes.length,writes);
 assert.equal(f.dogInventory().unopened,1);
});
test('missed Christmas star never reads DOG inventory and gives no DOG chest',async()=>{
 const f=setup({completed:0});
 f.ice().star=19;
 const miss=await f.strike('dog-ice-missed-000001');
 assert.equal(miss.statusCode,200);
 assert.equal(miss.body.result.found,false);
 assert.equal(miss.body.result.dogChest,undefined);
 assert.equal(f.dogInventory(),undefined);
 assert.equal(f.reads.some(path=>path.startsWith(dogInventoryColl)),false);
 assert.equal(f.writes.some(path=>path.startsWith(dogInventoryColl)),false);
});
test('previously finished Christmas picture cannot mint a second DOG chest after reset',async()=>{
 const f=setup({completed:0,maxRewarded:1});
 const old=await f.strike('dog-ice-repeat-000001');
 assert.equal(old.statusCode,200);
 assert.equal(old.body.result.found,true);
 assert.equal(old.body.result.gift,null);
 assert.equal(old.body.result.dogChest,undefined);
 assert.equal(f.dogInventory(),undefined);
});
test('picture 30 retains three spins and joker hats voucher plus extra DOG chest',async()=>{
 const f=setup({completed:29,maxRewarded:29});
 const won=await f.strike('dog-ice-picture30-0001');
 assert.equal(won.statusCode,200,JSON.stringify(won.body));
 assert.equal(won.body.result.monsterSpinsGranted,3);
 assert.equal(won.body.result.hatsVoucherGranted,1);
 assert.equal(won.body.result.gift.kind,'joker');
 assert.equal(f.dogInventory().unopened,1);
 assert.equal(f.hats().bonusTickets,1);
 assert.equal(f.docs.get('deal_or_no_deal_christmas_v1/'+uid).monsterWheelTickets,3);
 assert.equal(f.ice().prizes.at(-1).dogChest.tier,won.body.result.dogChest.tier);
});
