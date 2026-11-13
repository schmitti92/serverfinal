import test from 'node:test';
import assert from 'node:assert/strict';
import {dogGateProgress,dogGateMapView,dogGateFight,dogPublicEnroll,installDogGatesApi,
 DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID,DOG_GATE_RECEIPTS_COLLECTION} from '../dog-gates.js';
import {DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID} from '../dog-boss.js';
import {DOG_HERO_COLLECTION} from '../dog-forge.js';
import {boss10View} from '../dog-boss10.js';
import {groupBossView} from '../dog-group-boss.js';

function fixture(){
 const docs=new Map(),routes=new Map(),writes=[];
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
    docs.set(key,value);writes.push(key);
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
 return {docs,routes,db,writes,call,advance:ms=>time+=ms,now:()=>time};
}

test('Personal map defaults are not fabricated and contain no DOG unlock',()=>{
 const view=dogGateMapView(null,null,'hero-a');
 assert.equal(view.memberCount,0);assert.equal(view.dogUnlocked,false);
 assert.equal(view.progress.currentGate,1);
 assert.equal(view.availableBossGate,100);
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
 for(const token of ['a','b','c']){
  assert.equal((await f.call('POST','/api/dog/gates/join',{},token)).body.ok,true);
  assert.equal((await f.call('POST','/api/dog/gates/hero',{heroClass:'krieger'},token)).statusCode,200);
 }
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

test('Group boss 10 must be defeated before entering chapter 11–19',()=>{
 const now=1_800_000_000_000;
 const p={people:{a:{currentGate:5,normals:[1,2,3,4],minis:[],lastAttemptAt:0}}};
 const first=dogGateFight(p,'a',5,null,()=>0,now);
 assert.equal(first.result.type,'mini');
 assert.equal(first.progress.sharedBosses.length,0);
 const throughNine={people:{a:{currentGate:11,normals:[
  1,2,3,4,6,7,8,9],minis:[],lastAttemptAt:0}}};
 assert.throws(()=>dogGateFight(throughNine,'a',11,null,()=>0,now),
  /DOG_GATE_BOSS_REQUIRED/);
 const after10={...throughNine,sharedBosses:[10]};
 assert.equal(dogGateFight(after10,'a',11,null,()=>0,now).result.gate,11);
 const throughFourteen={people:{a:{currentGate:15,normals:[
  1,2,3,4,6,7,8,9,11,12,13,14],minis:[],lastAttemptAt:0}}};
 assert.throws(()=>dogGateFight(throughFourteen,'a',15,null,()=>0,now),
  /DOG_GATE_BOSS_REQUIRED/,'optional mini-boss 15 also stays in chapter 2');
 assert.throws(()=>dogGateFight(throughFourteen,'a',16,null,()=>0,now),
  /DOG_GATE_BOSS_REQUIRED/);
 const eligible={...throughFourteen,sharedBosses:[10]};
 assert.equal(dogGateFight(eligible,'a',15,null,()=>0,now).result.gate,15);
 assert.equal(dogGateFight(eligible,'a',16,null,()=>0,now).result.gate,16);
 assert.throws(()=>dogGateFight({people:{}},'a',100),/DOG_GATE_INVALID/);
});

test('Every later group boss locks the full following chapter',()=>{
 const now=1_800_000_000_000;
 const before20={people:{a:{currentGate:25,normals:[24],minis:[],lastAttemptAt:0}},
  sharedBosses:[10]};
 for(const gate of [21,25,26])
  assert.throws(()=>dogGateFight(before20,'a',gate,null,()=>0,now),
   /DOG_GATE_BOSS_REQUIRED/);
 const after20={...before20,sharedBosses:[10,20]};
 assert.equal(dogGateFight(after20,'a',25,null,()=>0,now).result.gate,25);
 assert.equal(dogGateFight(after20,'a',26,null,()=>0,now).result.gate,26);
 const before90={...before20,sharedBosses:[10,20,30,40,50,60,70,80]};
 assert.throws(()=>dogGateFight(before90,'a',91,null,()=>0,now),
  /DOG_GATE_BOSS_REQUIRED/);
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

test('Map settles expired Boss 10 for returning heroes, never for an outsider',async()=>{
 const f=fixture();
 for(const person of ['a','b','c'])await f.call('POST','/api/dog/gates/join',{},person);
 const key=DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID;
 const t=f.now(),uids=['hero-a','hero-b','hero-c'];
 const roster=uids.map(uid=>({uid,weaponLevel:1,armorLevel:1,skillPower:5,
  skillDestruction:5,skillDefense:5,skillGuard:5}));
 f.docs.set(key,{people:Object.fromEntries(uids.map(uid=>[uid,{
  currentGate:10,highestGate:10,normals:[1,2,3,4,6,7,8,9],minis:[]
 }])),sharedBosses:[],boss10:{phase:'fighting',ready:uids,roster,
  startedAt:t-32000,endsAt:t-2000,reactions:[],miniGames:null}});
 const foreign=await f.call('GET','/api/dog/gates/map',{},'d');
 assert.equal(foreign.statusCode,200);
 assert.deepEqual(f.docs.get(key).sharedBosses,[],'outsider must not settle');
 const first=await f.call('GET','/api/dog/gates/map',{},'a');
 assert.equal(first.statusCode,200);
 assert.deepEqual(first.body.sharedBosses,[10]);
 assert.equal(first.body.progress.currentGate,11);
 const count=f.writes.filter(k=>k===key).length;
 assert.equal(count,1,'settlement writes once');
 for(const token of ['a','b','c']){
  const again=await f.call('GET','/api/dog/gates/map',{},token);
  assert.deepEqual(again.body.sharedBosses,[10]);
  assert.equal(f.writes.filter(k=>k===key).length,count);
 }
});

test('Map settles expired final Boss 100 and awards the shared victory once',async()=>{
 const f=fixture();
 for(const person of ['a','b','c'])await f.call('POST','/api/dog/gates/join',{},person);
 const key=DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID;
 const t=f.now(),uids=['hero-a','hero-b','hero-c'];
 const roster=uids.map(uid=>({uid,weaponLevel:10,armorLevel:10,skillPower:50,
  skillDestruction:50,skillDefense:50,skillGuard:50}));
 f.docs.set(key,{people:Object.fromEntries(uids.map(uid=>[uid,{
  currentGate:100,highestGate:100,normals:[91,92,93,94,96,97,98,99],minis:[]
 }])),sharedBosses:[10,20,30,40,50,60,70,80,90],groupBosses:{
  100:{phase:'fighting',ready:uids,roster,
   startedAt:t-33000,endsAt:t-3000,reactions:[],miniGames:null}
 }});
 const first=await f.call('GET','/api/dog/gates/map',{},'c');
 assert.equal(first.statusCode,200);
 assert.equal(first.body.dogUnlocked,true);
 assert.ok(first.body.sharedBosses.includes(100));
 assert.equal(f.docs.get(key).groupBosses[100].phase,'victory');
 const count=f.writes.filter(k=>k===key).length;
 assert.equal(count,1);
 const other=await f.call('GET','/api/dog/gates/map',{},'a');
 assert.equal(other.body.dogUnlocked,true);
 assert.equal(f.writes.filter(k=>k===key).length,count);
});

test('Map with no expired shared boss has no additional Firestore writes',async()=>{
 const f=fixture();
 for(const person of ['a','b','c'])await f.call('POST','/api/dog/gates/join',{},person);
 const before=f.writes.length;
 const res=await f.call('GET','/api/dog/gates/map',{},'a');
 assert.equal(res.statusCode,200);
 assert.equal(f.writes.length,before);
});


test('Three expedition hero appearances are saved per player without changing combat balance',async()=>{
 const f=fixture();
 for(const token of ['a','b','c'])
  assert.equal((await f.call('POST','/api/dog/gates/join',{},token)).statusCode,200);
 const initialWrites=f.writes.length;
 const choice=await f.call('POST','/api/dog/gates/hero',{heroClass:'waechter'},'a');
 assert.equal(choice.statusCode,200);
 assert.equal(choice.body.members[0].heroClass,'waechter');
 assert.equal(choice.body.members[1].heroClass,'magierin');
 assert.equal(choice.body.members[2].heroClass,'waechter');
 assert.equal(f.writes.length,initialWrites+1,'only one new write for a selection');
 const repeated=await f.call('POST','/api/dog/gates/hero',{heroClass:'waechter'},'a');
 assert.equal(repeated.statusCode,200);
 assert.equal(f.writes.length,initialWrites+1,'repeating the same selection makes no write');
 const fromB=await f.call('POST','/api/dog/gates/hero',{heroClass:'krieger'},'b');
 assert.equal(fromB.statusCode,200);
 assert.deepEqual(fromB.body.members.map(x=>x.heroClass),['waechter','krieger','waechter']);
 const outsider=await f.call('POST','/api/dog/gates/hero',{heroClass:'magierin'},'d');
 assert.equal(outsider.statusCode,409,'all three expedition seats are occupied');
 const changed=await f.call('POST','/api/dog/gates/hero',{heroClass:'magierin'},'a');
 assert.equal(changed.statusCode,409);
 assert.equal(changed.body.error,'DOG_HERO_ALREADY_LOCKED');
 const invalid=await f.call('POST','/api/dog/gates/hero',{heroClass:'dragon'},'a');
 assert.equal(invalid.statusCode,400);
 const team=f.docs.get(DOG_BOSS_TEAM_COLLECTION+'/'+DOG_BOSS_TEAM_ID);
 assert.deepEqual(team.heroClasses,{'hero-a':'waechter','hero-b':'krieger'});
 assert.deepEqual(team.heroLocks,{'hero-a':true,'hero-b':true});
 const at=f.now();
 assert.deepEqual(boss10View(team,null,'hero-a',at).members.map(x=>x.heroClass),
  ['waechter','krieger','waechter']);
 assert.deepEqual(groupBossView(20,team,null,'hero-a',at).members.map(x=>x.heroClass),
  ['waechter','krieger','waechter']);
});

test('public launch replaces live preview bots with real players and preserves the first human progress',async()=>{
 const f=fixture();
 const bots=['dog-live-bot-nova','dog-live-bot-titan'];
 const teamKey=DOG_BOSS_TEAM_COLLECTION+'/'+DOG_BOSS_TEAM_ID;
 const progressKey=DOG_GATE_PROGRESS_COLLECTION+'/'+DOG_GATE_PROGRESS_ID;
 f.docs.set(teamKey,{members:[
  {uid:'hero-a',name:'Chris'}, {uid:bots[0],name:'Nova'}, {uid:bots[1],name:'Titan'}
 ],heroClasses:{'hero-a':'krieger',[bots[0]]:'magierin',[bots[1]]:'waechter'},
 heroLocks:{'hero-a':true,[bots[0]]:true,[bots[1]]:true}});
 f.docs.set(progressKey,{people:{
  'hero-a':{currentGate:19,highestGate:20,normals:[1,2,3],minis:[5]},
  [bots[0]]:{currentGate:19,highestGate:19,normals:[1,2],minis:[5]},
  [bots[1]]:{currentGate:19,highestGate:19,normals:[1,2],minis:[5]}
 },sharedBosses:[10],forgeLevel:2});
 const before=await f.call('GET','/api/dog/gates/map',{},'b');
 assert.equal(before.body.canJoin,true,'bot seats count as open public seats');
 assert.deepEqual(before.body.members,[],'outsiders do not see pilot names');
 const guest=await f.call('POST','/api/dog/gates/hero',{heroClass:'magierin'},'b');
 assert.equal(guest.statusCode,200,JSON.stringify(guest.body));
 assert.equal(guest.body.isMember,true);
 assert.equal(guest.body.members.length,3);
 assert.equal(guest.body.members.some(p=>p.uid==='hero-b'&&p.heroLocked),true);
 assert.equal(guest.body.members.some(p=>p.uid===bots[0]),false);
 const second=await f.call('POST','/api/dog/gates/hero',{heroClass:'waechter'},'c');
 assert.equal(second.statusCode,200,JSON.stringify(second.body));
 assert.deepEqual(second.body.members.map(p=>p.uid),['hero-a','hero-b','hero-c']);
 assert.equal(second.body.members.find(p=>p.uid==='hero-c').heroLocked,true);
 const stored=f.docs.get(progressKey);
 assert.equal(stored.people['hero-a'].highestGate,20);
 assert.equal(stored.forgeLevel,2);
 assert.deepEqual(stored.sharedBosses,[10]);
 assert.ok(!bots.some(id=>id in stored.people),'old test-bot progress removed from active three positions');
 assert.equal(f.docs.get(teamKey).members.length,3);
 const unavailable=await f.call('POST','/api/dog/gates/hero',{heroClass:'krieger'},'d');
 assert.equal(unavailable.statusCode,409);
 assert.equal(unavailable.body.error,'DOG_GATE_TEAM_FULL');
 const again=await f.call('POST','/api/dog/gates/hero',{heroClass:'magierin'},'b');
 assert.equal(again.statusCode,200,'existing hero retains their final choice');
});

test('pilot bot slot replacement is blocked during active group combat and succeeds afterward',()=>{
 const bots=['dog-live-bot-nova','dog-live-bot-titan'];
 const team={members:[{uid:'owner',name:'Chris'},{uid:bots[0],name:'Nova'},{uid:bots[1],name:'Titan'}]};
 const raw={people:{owner:{currentGate:10},[bots[0]]:{currentGate:10},[bots[1]]:{currentGate:10}},boss10:{phase:'fighting'}};
 assert.equal(dogGateMapView(team,raw,'new-user').canJoin,false);
 assert.throws(()=>dogPublicEnroll(team,raw,'new-user','David'),/DOG_GATE_BOSS_ACTIVE/);
 const done=dogPublicEnroll(team,{...raw,boss10:{phase:'victory'}},'new-user','David');
 assert.equal(done.retiredBot,bots[0]);
 assert.deepEqual(done.team.members.map(m=>m.uid),['owner',bots[1],'new-user']);
 assert.equal(done.progress.people.owner.currentGate,10);
});
