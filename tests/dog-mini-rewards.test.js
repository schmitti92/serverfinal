import test from 'node:test';
import assert from 'node:assert/strict';
import {dogDrawMiniReward,dogMiniRewardDocument,DOG_MINI_REWARD_WEIGHTS,
 DOG_MINI_REWARD_COLLECTIONS} from '../dog-mini-rewards.js';
import {installDogGatesApi,DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID,
 DOG_GATE_RECEIPTS_COLLECTION} from '../dog-gates.js';
import {DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID} from '../dog-boss.js';
import {DOG_HERO_COLLECTION} from '../dog-forge.js';
import {DOG_MATERIALS_COLLECTION} from '../dog-materials.js';
const now=1_800_000_000_000;
const uid='hero-mini-a';
const sample=(roll,gate=5)=>{
 let draws=0;
 return dogDrawMiniReward(gate,gate+1,limit=>{
  draws++;
  return draws===1?roll:0;
 });
};
test('Five prize classes have explicit odds totaling 100 percent',()=>{
 assert.deepEqual(DOG_MINI_REWARD_WEIGHTS,
  {chest:35,coins:30,cards:20,hammer:10,joker:5});
 assert.equal(Object.values(DOG_MINI_REWARD_WEIGHTS).reduce((a,b)=>a+b,0),100);
 assert.equal(sample(0).kind,'chest');
 assert.equal(sample(34).kind,'chest');
 assert.equal(sample(35).kind,'coins');
 assert.equal(sample(64).kind,'coins');
 assert.equal(sample(65).kind,'cards');
 assert.equal(sample(84).kind,'cards');
 assert.equal(sample(85).kind,'hammer');
 assert.equal(sample(94).kind,'hammer');
 assert.equal(sample(95).kind,'joker');
 assert.equal(sample(99).kind,'joker');
 assert.throws(()=>dogDrawMiniReward(10),/DOG_MINI_REWARD_INVALID_GATE/);
});
test('Early rewards are small, later rewards expand without huge early payouts',()=>{
 assert.equal(sample(35,5).amount,50_000);
 assert.equal(sample(35,95).amount,5_000_000);
 assert.equal(sample(65,5).packId,'small');
 assert.equal(sample(85,5).hammer,'single');
 const cards=dogDrawMiniReward(95,96,limit=>limit===100?65:2);
 assert.equal(cards.packId,'premium');
 const hammer=dogDrawMiniReward(95,96,limit=>limit===100?85:2);
 assert.equal(hammer.hammer,'lucky');
});
test('Prize reducers credit their existing real accounts, preserving other fields',()=>{
 const chest=sample(0);
 const credited=dogMiniRewardDocument(chest,{resources:{iron:8},chests:{small:1}},now,()=>0);
 assert.equal(credited.data.unopened,2);
 assert.equal(credited.data.resources.iron,8);
 assert.equal(credited.data.expeditionChests[0].tier,'wood');
 assert.equal(credited.merge,false);
 const coins=dogMiniRewardDocument(sample(35),{balance:1000,games:5},now);
 assert.deepEqual(coins,{data:{balance:51000,updatedAt:now},merge:true});
 const cards=dogMiniRewardDocument(sample(65),{freeChristmasPacks:{small:2,large:1},opened:9},now);
 assert.deepEqual(cards.data.freeChristmasPacks,{small:3,large:1});
 assert.equal(cards.merge,true);
 const ice=dogMiniRewardDocument(sample(85),null,now,()=>0);
 assert.equal(ice.data.freeHammers.single,1);
 assert.equal(ice.data.wheelHammers.single,1);
 assert.equal(ice.merge,false);
 const joker=dogMiniRewardDocument(sample(99),{balance:7},now);
 assert.equal(joker.data.balance,8);
 assert.equal(joker.merge,true);
 assert.throws(()=>dogMiniRewardDocument({kind:'joker',quantity:7},null),/INVALID/);
});
function fixture(firstRewardRoll=0,heroOverrides={}){
 const docs=new Map(),routes=new Map();
 let time=now,chosen=firstRewardRoll;
 const makeRef=key=>({key,get:async()=>snapshot(key)});
 const snapshot=key=>({exists:docs.has(key),data:()=>structuredClone(docs.get(key))});
 const db={
  collection:c=>({doc:id=>makeRef(c+'/'+id)}),
  runTransaction:async fn=>{
   let wrote=false;const operations=[];
   const tx={
    get:async ref=>{assert.equal(wrote,false,'reads must precede all writes');
     return snapshot(ref.key)},
    set:(ref,value,options)=>{wrote=true;operations.push(['set',ref.key,structuredClone(value),options?.merge===true])},
    create:(ref,value)=>{wrote=true;operations.push(['create',ref.key,structuredClone(value),false])}
   };
   const result=await fn(tx);
   for(const [operation,key,value,merge] of operations){
    if(operation==='create'&&docs.has(key))throw Error('ALREADY_EXISTS');
    docs.set(key,merge?{...docs.get(key),...value}:value);
   }
   return result;
  }
 };
 const app={get:(route,...handlers)=>routes.set('GET '+route,handlers),
  post:(route,...handlers)=>routes.set('POST '+route,handlers)};
 const rand=limit=>limit===100?chosen:0;
 const users={a:uid,b:'hero-mini-b'};
 installDogGatesApi(app,{verifyProfile:async token=>users[token]?{
  uid:users[token],name:'Hero '+token}:null,
  getFirestore:()=>db,rand,clock:()=>time});
 docs.set(DOG_BOSS_TEAM_COLLECTION+'/'+DOG_BOSS_TEAM_ID,
  {members:[{uid,name:'Hero A'},{uid:'hero-mini-b',name:'Hero B'}]});
 docs.set(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID,
  {people:{[uid]:{currentGate:5,highestGate:5,normals:[1,2,3,4],minis:[],lastAttemptAt:0}}});
 docs.set(DOG_HERO_COLLECTION+'/'+uid,{levels:{
  weapon:10,armor:10,attack_power:40,destruction:40,critical:40,
  precision:40,blocking:40,vitality:40,...heroOverrides}});
 async function call(method,route,body={},token='a'){
  const fns=routes.get(method+' '+route);assert.ok(fns);
  const req={body,get:h=>h==='authorization'?'Bearer '+token:''};
  const res={statusCode:200,status(x){this.statusCode=x;return this},
   set(){return this},json(x){this.body=x;return x}};
  for(const fn of fns){
   if(res.body)break;
   if(fn.length===3)await new Promise((resolve,reject)=>{
    Promise.resolve(fn(req,res,()=>resolve())).catch(reject);
   });
   else await fn(req,res);
  }
  return res;
 }
 return {docs,call,move:ms=>time+=ms,setRoll:r=>chosen=r};
}
const request={gate:5,requestId:'mini-boss5-reward-000001'};
test('Mini-boss 5 winning reward is credited in one transaction and cannot duplicate',async()=>{
 for(const [roll,kind] of [[0,'chest'],[35,'coins'],[65,'cards'],[85,'hammer'],[95,'joker']]){
  const f=fixture(roll);
  const result=await f.call('POST','/api/dog/gates/fight',request);
  assert.equal(result.statusCode,200,kind);
  assert.equal(result.body.result.win,true,kind);
  assert.equal(result.body.result.type,'mini');
  assert.equal(result.body.result.miniRewardPending,false);
  const reward=result.body.result.miniReward;
  assert.equal(reward.kind,kind);
  assert.equal(reward.granted,true);
  const collection=DOG_MINI_REWARD_COLLECTIONS[kind];
  const firstDoc=structuredClone(f.docs.get(collection+'/'+uid));
  assert.ok(firstDoc,'reward saved in '+collection);
  const originalReceipt=f.docs.get(DOG_GATE_RECEIPTS_COLLECTION+'/'+uid+'_'+request.requestId);
  assert.deepEqual(originalReceipt.result.miniReward,reward);
  const replay=await f.call('POST','/api/dog/gates/fight',request);
  assert.equal(replay.statusCode,200);
  assert.equal(replay.body.replayed,true);
  assert.deepEqual(replay.body.result.miniReward,reward);
  assert.deepEqual(f.docs.get(collection+'/'+uid),firstDoc,'no doubled '+kind);
  const second=await f.call('POST','/api/dog/gates/fight',{
   gate:5,requestId:'different-mini5-request-0002'});
  assert.equal(second.statusCode,409);
  assert.equal(second.body.error,'DOG_GATE_ALREADY_WON');
  assert.deepEqual(f.docs.get(collection+'/'+uid),firstDoc);
  const progress=f.docs.get(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID);
  assert.deepEqual(progress.people[uid].minis,[5]);
 }
});
test('Wallet, album and joker winnings merge with existing balances and histories',async()=>{
 for(const [roll,kind,collection,initial,expected] of [
  [35,'coins','deal_or_no_deal_wallets_v1',{balance:999,games:12},'balance'],
  [65,'cards','deal_or_no_deal_christmas_v1',{opened:4,freeChristmasPacks:{small:2}},'freeChristmasPacks'],
  [95,'joker','deal_peek_inventory_v1',{balance:6,otherValue:3},'balance']
 ]){
  const f=fixture(roll);
  f.docs.set(collection+'/'+uid,structuredClone(initial));
  const outcome=await f.call('POST','/api/dog/gates/fight',request);
  assert.equal(outcome.statusCode,200);
  const value=f.docs.get(collection+'/'+uid);
  if(kind==='coins'){assert.equal(value.balance,50999);assert.equal(value.games,12)}
  if(kind==='cards'){assert.equal(value.freeChristmasPacks.small,3);assert.equal(value.opened,4)}
  if(kind==='joker'){assert.equal(value.balance,7);assert.equal(value.otherValue,3)}
 }
});
test('Failure to grant prize aborts the mini-boss victory and receipt together',async()=>{
 const f=fixture(35);
 f.docs.set('deal_or_no_deal_wallets_v1/'+uid,{balance:1_000_000_000_000_000});
 const outcome=await f.call('POST','/api/dog/gates/fight',request);
 assert.equal(outcome.statusCode,500);
 assert.equal(outcome.body.error,'DOG_GATE_UNAVAILABLE');
 const p=f.docs.get(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID);
 assert.deepEqual(p.people[uid].minis,[]);
 assert.equal(f.docs.has(DOG_GATE_RECEIPTS_COLLECTION+'/'+uid+'_'+request.requestId),false);
});
test('Other accounts cannot collect the first hero mini-boss reward',async()=>{
 const f=fixture(95);
 const outsider=await f.call('POST','/api/dog/gates/fight',request,'b');
 assert.equal(outsider.statusCode,409);
 assert.equal(outsider.body.error,'DOG_GATE_PREVIOUS_REQUIRED');
 assert.equal(f.docs.has('deal_peek_inventory_v1/hero-mini-b'),false);
});
