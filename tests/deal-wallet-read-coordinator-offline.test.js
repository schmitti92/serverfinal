import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDealWalletReadCoordinator} from '../deal-wallet-read-coordinator.js';
import {installDogAlbumSeason2} from '../dog-album-season2.js';
import {normalizeDealEconomy,DEFAULT_DEAL_ECONOMY} from '../deal-economy.js';

function fixture(){
 const wallets=new Map([['player_A',{balance:300000,games:8}],['player_B',{balance:900000,games:2}]]);
 const pending=new Map();
 const reads=new Map();
 let shouldFail=false;
 const db={
  collection(name){
   assert.equal(name,'deal_or_no_deal_wallets_v1');
   return {doc(uid){
    return {get:async()=>{
     reads.set(uid,(reads.get(uid)||0)+1);
     const old=structuredClone(wallets.get(uid));
     if(shouldFail){shouldFail=false;throw Error('SIMULATED_FIRESTORE_FAILURE')}
     if(pending.has(uid))await pending.get(uid);
     return {exists:!!old,data:()=>structuredClone(old)};
    }};
   }};
  }
 };
 const coordinator=createDealWalletReadCoordinator();
 function block(uid){let resume;const p=new Promise(r=>{resume=r});pending.set(uid,p);return ()=>{pending.delete(uid);resume()};}
 return {db,coordinator,reads:uid=>reads.get(uid)||0,set:(uid,balance)=>wallets.set(uid,{...wallets.get(uid),balance}),block,fail:()=>{shouldFail=true}};
}

test('Concurrent GETs for one player make only one Firestore document read',async()=>{
 const h=fixture(),release=h.block('player_A');
 const a=h.coordinator.read(h.db,'player_A');
 const b=h.coordinator.read(h.db,'player_A');
 const c=h.coordinator.read(h.db,'player_A');
 release();
 const values=await Promise.all([a,b,c]);
 assert.ok(values.every(x=>x.exists&&x.data().balance===300000));
 assert.equal(h.reads('player_A'),1);
 assert.equal(h.coordinator.stats().sharedReads,2);
 assert.equal(h.coordinator.stats().pending,0);
 assert.equal(h.coordinator.stats().ttlMs,0);
});

test('Different players never share private wallet snapshots',async()=>{
 const h=fixture(),release=h.block('player_A');
 const alice=h.coordinator.read(h.db,'player_A');
 const bob=h.coordinator.read(h.db,'player_B');
 release();
 const [a,b]=await Promise.all([alice,bob]);
 assert.equal(a.data().balance,300000);
 assert.equal(b.data().balance,900000);
 assert.equal(h.reads('player_A'),1);
 assert.equal(h.reads('player_B'),1);
});

test('Fresh balance is read immediately after the previous GET completes',async()=>{
 const h=fixture();
 assert.equal((await h.coordinator.read(h.db,'player_A')).data().balance,300000);
 h.set('player_A',770000);
 assert.equal((await h.coordinator.read(h.db,'player_A')).data().balance,770000);
 assert.equal(h.reads('player_A'),2,'no stale time-based wallet cache');
});

test('Firestore failures do not poison future wallet reads',async()=>{
 const h=fixture();h.fail();
 await assert.rejects(()=>h.coordinator.read(h.db,'player_A'),/SIMULATED_FIRESTORE_FAILURE/);
 assert.equal((await h.coordinator.read(h.db,'player_A')).data().balance,300000);
 assert.equal(h.coordinator.stats().errors,1);
 assert.equal(h.reads('player_A'),2);
 assert.equal(h.coordinator.stats().pending,0);
});

test('DOG Season-2 GET takes shared wallet reader but paid opens remain transactional',async()=>{
 const h=fixture(),routes=new Map();
 const app={get:(path,_auth,handler)=>routes.set(path,handler),post:()=>{}};
 const db={collection:name=>{
  if(name==='deal_or_no_deal_wallets_v1')return h.db.collection(name);
  return {doc:()=>({get:async()=>({exists:false,data:()=>({})})})};
 }};
 installDogAlbumSeason2(app,{
  auth:()=>{},getFirestore:()=>db,fail:(_res,e)=>{throw e},
  readDisplayEconomy:async()=>normalizeDealEconomy(DEFAULT_DEAL_ECONOMY),
  readDisplayWallet:(store,uid)=>h.coordinator.read(store,uid)
 });
 const get=routes.get('/api/deal-or-no-deal/christmas/season2/me');
 assert.equal(typeof get,'function');
 const respond=async user=>{
  const res={set(){return this},json(x){this.payload=x;return x}};
  await get({dealIdentity:{uid:user}},res);
  assert.equal(res.payload.ok,true);
  return res.payload;
 };
 const release=h.block('player_A');
 const views=Promise.all([respond('player_A'),respond('player_A')]);
 release();
 const [one,two]=await views;
 assert.equal(one.balance,300000);
 assert.equal(two.balance,300000);
 assert.equal(h.reads('player_A'),1);
 h.set('player_A',440000);
 assert.equal((await respond('player_A')).balance,440000);
 assert.equal(h.reads('player_A'),2);
});

test('All display readers are wired; no wallet coordinator is used in payment transactions',()=>{
 const source=readFileSync(new URL('../deal-or-no-deal-api.js',import.meta.url),'utf8');
 const album=readFileSync(new URL('../dog-album-season2.js',import.meta.url),'utf8');
 assert.match(source,/const walletReadCoordinator=createDealWalletReadCoordinator\(\)/);
 assert.match(source,/walletReadCoordinator:walletReadCoordinator\.stats\(\)/);
 assert.match(source,/app\.get\('\/api\/deal-or-no-deal\/shop\/me'[\s\S]*?readDisplayWallet\(db,uid\)/);
 assert.match(source,/app\.get\('\/api\/deal-or-no-deal\/cards\/me'[\s\S]*?readDisplayWallet\(db,uid\)/);
 assert.match(source,/app\.get\('\/api\/deal-or-no-deal\/christmas\/me'[\s\S]*?readDisplayWallet\(db,uid\)/);
 assert.match(source,/const readBalances=async[\s\S]*?players\.map\(p=>readDisplayWallet\(db,p\.uid\)\)/);
 assert.match(source,/installDogAlbumSeason2\(app,[\s\S]*?readDisplayWallet\}\)/);
 assert.match(album,/readDisplayWallet\(db,uid\)/);
 assert.match(source,/app\.post\('\/api\/deal-or-no-deal\/shop\/buy'[\s\S]*?db\.runTransaction/);
 assert.match(source,/app\.post\('\/api\/deal-or-no-deal\/cards\/open'[\s\S]*?db\.runTransaction/);
 assert.match(album,/app\.post\(base\+'\/open'[\s\S]*?db\.runTransaction/);
});
