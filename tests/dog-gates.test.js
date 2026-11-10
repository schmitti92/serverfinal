import test from 'node:test';
import assert from 'node:assert/strict';
import {dogGateProgress,dogGateMapView,dogGateFight,installDogGatesApi,
 DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID,DOG_GATE_RECEIPTS_COLLECTION} from '../dog-gates.js';
import {DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID} from '../dog-boss.js';
import {DOG_HERO_COLLECTION} from '../dog-forge.js';

function fixture(){
 const docs=new Map(),routes=new Map();
 let time=1_800_000_000_000;
 const snapshot=key=>({exists:docs.has(key),data:()=>structuredClone(docs.get(key))});
 const db={
  collection:c=>({doc:id=>({key:c+'/'+id,get:async()=>snapshot(c+'/'+id)})}),
  runTransaction:async fn=>{
   const updates=[];let writing=false;
   const tx={
    get:async ref=>{assert.equal(writing,false,'all Firestore reads before writes');return snapshot(ref.key);},
    set:(ref,value)=>{writing=true;updates.push(['set',ref.key,structuredClone(value)])},
    create:(ref,value)=>{writing=true;updates.push(['create',ref.key,structuredClone(value)])}
   };
   const result=await fn(tx);
   for(const [op,key,value] of updates){
    if(op==='create'&&docs.has(key))throw Error('ALREADY_EXISTS');
    docs.set(key,value);
   }
   return result;
  }
 };
 const app={get:(path,...fn)=>routes.set('GET '+path,fn),
  post:(path,...fn)=>routes.set('POST '+path,fn)};
 const users={a:'hero-a',b:'hero-b',c:'hero-c',d:'hero-d'};
 installDogGatesApi(app,{getFirestore:()=>db,
  verifyProfile:async token=>users[token]?{uid:users[token],name:'Held '+token.toUpperCase()}:null,
  rand:()=>0,clock:()=>time});
 async function call(method,route,body={},token='a'){
  const handlers=routes.get(method+' '+route);
  assert.ok(handlers,'missing '+method+' '+route);
  const req={body,get:header=>header==='authorization'?'Bearer '+token:''};
  const res={statusCode:200,headers:{},status(code){this.statusCode=code;return this},
   set(k,v){this.headers[k]=v;return this},json(x){this.body=x;return x}};
  for(const fn of handlers){
   if(res.body)break;
   if(fn.length===3)await new Promise((resolve,reject)=>{
    let advanced=false;try{Promise.resolve(fn(req,res,()=>{advanced=true;resolve()})).then(()=>{
     if(!advanced&&res.body)resolve();else if(!advanced)resolve();
    },reject)}catch(e){reject(e)}
   });
   else await fn(req,res);
  }
  return res;
 }
 return {docs,routes,db,call,advance:ms=>time+=ms,now:()=>time};
}

test('Personal map defaults are not fabricated and contain no DOG unlock',()=>{
 const view=dogGateMapView(null,null,'hero-a');
 assert.equal(view.memberCount,0);assert.equal(view.dogUnlocked,false);
 assert.equal(view.progress.currentGate,1);
 assert.equal(view.availableBossGate,10);
 assert.equal(view.bossArenaIsTest,false);
 assert.deepEqual(view.sharedBosses,[]);
 const sanitized=dogGateProgress({people:{'hero-a':{currentGate:100,
  normals:[1,1,4,5,10,99],minis:[15,15,20]}},sharedBosses:[10,10,11]});
 assert.deepEqual(sanitized.people['hero-a'].normals,[1,4,99]);
 assert.deepEqual(sanitized.people['hero-a'].minis,[15]);
 assert.deepEqual(sanitized.sharedBosses,[10]);
});

test('Unaffiliated signed-in players see team capacity, never private gate locations',()=>{
 const team={members:[
  {uid:'hero-a',name:'Christoph'},{uid:'hero-b',name:'David'}
 ]};
 const progress={people:{
  'hero-a':{currentGate:32,highestGate:40,normals:[1,2,3],minis:[]},
  'hero-b':{currentGate:29,highestGate:30,normals:[1,2,3],minis:[]}
 },sharedBosses:[10,20,30]};
 const stranger=dogGateMapView(team,progress,'outside-account');
 assert.equal(stranger.isMember,false);
 assert.equal(stranger.memberCount,2);
 assert.equal(stranger.canJoin,true);
 assert.deepEqual(stranger.members,[]);
 assert.deepEqual(stranger.sharedBosses,[]);
 assert.equal(stranger.dogUnlocked,false);
 const joined=dogGateMapView(team,progress,'hero-b');
 assert.equal(joined.isMember,true);
 assert.equal(joined.members.length,2);
 assert.equal(joined.members[0].highestGate,40);
 assert.equal(joined.members[1].currentGate,29);
 assert.equal(joined.canJoin,false);
});

test('All three hero positions show on a shared map; fourth cannot enroll',async()=>{
 const f=fixture();
 for(const token of ['a','b','c']){
  const joined=await f.call('POST','/api/dog/gates/join',{},token);
  assert.equal(joined.statusCode,200);
  assert.equal(joined.body.ok,true);
 }
 const map=await f.call('GET','/api/dog/gates/map',{},'a');
 assert.equal(map.body.members.length,3);
 assert.equal(map.body.teamReady,true);
 assert.equal(map.body.members.filter(x=>x.isMe).length,1);
 assert.deepEqual(map.body.members.map(x=>x.name),['Held A','Held B','Held C']);
 const unauthorized=await f.call('POST','/api/dog/gates/join',{},'d');
 assert.equal(unauthorized.statusCode,409);
 assert.equal(unauthorized.body.error,'DOG_GATE_TEAM_FULL');
 const repeated=await f.call('POST','/api/dog/gates/join',{},'a');
 assert.equal(repeated.body.memberCount,3);
 const team=f.docs.get(DOG_BOSS_TEAM_COLLECTION+'/'+DOG_BOSS_TEAM_ID);
 assert.equal(team.members.length,3,'same team as the existing Bossarena');
});

test('Wins and losses update only own current position; retries replay exactly once',async()=>{
 const f=fixture();
 for(const token of ['a','b','c'])
  assert.equal((await f.call('POST','/api/dog/gates/join',{},token)).body.ok,true);
 const initial=await f.call('POST','/api/dog/gates/fight',{
  gate:2,requestId:'go-before-clear-00001'},'a');
 assert.equal(initial.statusCode,409);
 assert.equal(initial.body.error,'DOG_GATE_PREVIOUS_REQUIRED');
 const first={gate:1,requestId:'fight-gate1-unique-0001'};
 const won=await f.call('POST','/api/dog/gates/fight',first,'a');
 assert.equal(won.body.result.win,true);
 assert.equal(won.body.map.progress.currentGate,2);
 assert.equal(won.body.map.members.find(x=>x.isMe).currentGate,2);
 const r=await f.call('POST','/api/dog/gates/fight',first,'a');
 assert.equal(r.body.replayed,true);
 assert.deepEqual(r.body.result,won.body.result);
 assert.equal(f.docs.get(DOG_GATE_RECEIPTS_COLLECTION+'/hero-a_'+first.requestId).gate,1);
 const conflict=await f.call('POST','/api/dog/gates/fight',{gate:2,requestId:first.requestId},'a');
 assert.equal(conflict.statusCode,409);
 assert.equal(conflict.body.error,'DOG_GATE_RECEIPT_CONFLICT');
 const own=await f.call('GET','/api/dog/gates/map',{},'b');
 assert.equal(own.body.members.find(x=>x.uid==='hero-a').currentGate,2);
 assert.equal(own.body.members.find(x=>x.uid==='hero-b').currentGate,1);
 assert.equal(own.body.members.find(x=>x.uid==='hero-c').currentGate,1);
 const cooldown=await f.call('POST','/api/dog/gates/fight',{
  gate:2,requestId:'fight-gate2-unique-0002'},'a');
 assert.equal(cooldown.statusCode,429);
 f.advance(3100);
 const second=await f.call('POST','/api/dog/gates/fight',{
  gate:2,requestId:'fight-gate2-unique-0002'},'a');
 assert.equal(second.body.result.win,true);
 assert.equal(second.body.map.progress.currentGate,3);
 const p=f.docs.get(DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID);
 assert.deepEqual(p.people['hero-a'].normals,[1,2]);
});

test('Miniboss five remains optional but gate eleven and miniboss fifteen require boss ten',()=>{
 const now=1_800_000_000_000;
 const p={people:{a:{currentGate:5,normals:[1,2,3,4],minis:[],lastAttemptAt:0}}};
 const result=dogGateFight(p,'a',5,null,()=>0,now);
 assert.equal(result.result.type,'mini');
 assert.equal(result.result.gate,5);
 assert.equal(typeof result.result.win,'boolean');
 assert.equal(result.progress.sharedBosses.length,0);
 const skip={people:{a:{currentGate:15,normals:[
  1,2,3,4,6,7,8,9,11,12,13,14],minis:[],lastAttemptAt:0}}};
 assert.throws(()=>dogGateFight(skip,'a',15,null,()=>0,now),/DOG_GATE_BOSS_REQUIRED/);
 assert.throws(()=>dogGateFight(skip,'a',11,null,()=>0,now),/DOG_GATE_BOSS_REQUIRED/);
 const bossWon={...skip,sharedBosses:[10]};
 const next=dogGateFight(bossWon,'a',15,null,()=>0,now);
 assert.equal(next.result.gate,15,'Mini-boss five is never required before mini-boss fifteen');
 const world21={people:{a:{currentGate:21,normals:[19],minis:[],lastAttemptAt:0}},
  sharedBosses:[10]};
 assert.throws(()=>dogGateFight(world21,'a',21,null,()=>0,now),
  /DOG_GATE_BOSS_REQUIRED/);
 assert.throws(()=>dogGateFight({people:{}},'a',100),/DOG_GATE_INVALID/);
});

test('Revisiting a previously skipped mini-boss never erases the highest gate',()=>{
 const p={people:{a:{currentGate:14,highestGate:14,
  normals:[1,2,3,4,6,7,8,9,11,12,13],
  minis:[],lastAttemptAt:0}}};
 const fight=dogGateFight(p,'a',5,null,()=>9999,1_800_000_000_000);
 assert.equal(fight.progress.people.a.currentGate,fight.result.win?6:5);
 assert.equal(fight.progress.people.a.highestGate,14);
 const shown=dogGateMapView({members:[{uid:'a',name:'A'}]},fight.progress,'a');
 assert.equal(shown.members[0].highestGate,14);
 assert.equal(shown.members[0].currentGate,fight.result.win?6:5);
 // Legacy documents without highestGate can reconstruct it from cleared
 // ordinary gates, even after the current marker moved backwards.
 const old={people:{a:{currentGate:5,normals:[1,2,3,4,6,7,8,9,11,12,13],minis:[]}}};
 assert.equal(dogGateProgress(old).people.a.highestGate,14);
});

test('An unauthenticated visitor cannot read team positions or fight',async()=>{
 const f=fixture();
 const notSigned=await f.call('GET','/api/dog/gates/map',{},'unknown');
 assert.equal(notSigned.statusCode,401);
 const notMember=await f.call('POST','/api/dog/gates/fight',{
  gate:1,requestId:'not-member-unique-00001'},'a');
 assert.equal(notMember.statusCode,403);
});
