/** A-01 / offline Firestore-operation baseline for the ACTUAL Boss-10 API.
 * Uses an in-memory Firestore-shaped counter: NO production DB connections,
 * NO live game writes, NO Firebase billing/quota measurements. This test
 * measures code-path operations, not billable production document counts.
 * Profile Auth and live-pilot middleware are intentionally excluded here;
 * account for those separately in the roadmap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {installDogBoss10Api} from '../dog-boss10.js';
import {DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID} from '../dog-gates.js';
import {DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID} from '../dog-boss.js';
import {DOG_HERO_COLLECTION} from '../dog-forge.js';
import {dogMiniReactionPosition} from '../dog-boss-minigames.js';
import {addLiveBots,isLiveBotTeam,readyWithLiveBots,advanceLiveBotFight} from '../dog-live-bots.js';

const BASE=1_800_000_000_000;
const normalGates=[1,2,3,4,6,7,8,9];
const players=['hero-a','hero-b','hero-c'];
const idToken=uid=>uid.slice(-1);

function fixture(count=3,botMode=false){
 const members=players.slice(0,count).map((uid,i)=>({uid,name:'Test '+(i+1)}));
 const team={members,heroClasses:Object.fromEntries(members.map((m,i)=>
  [m.uid,['krieger','magierin','waechter'][i]])),
  heroLocks:Object.fromEntries(members.map(m=>[m.uid,true]))};
 const progress={people:Object.fromEntries(members.map(m=>[m.uid,{
  currentGate:10,highestGate:10,normals:normalGates,
  minis:[],lastAttemptAt:0}])),sharedBosses:[],updatedAt:0};
 const docs=new Map(),routes=new Map();
 let time=BASE,reads=0,writes=0,transactions=0;
 const history=[];
 const key=(collection,id)=>collection+'/'+id;
 docs.set(key(DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID),team);
 docs.set(key(DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID),progress);
 for(const member of members)docs.set(key(DOG_HERO_COLLECTION,member.uid),
  {levels:{weapon:1,armor:1,attack_power:5,destruction:5,vitality:5,blocking:5}});
 if(botMode){
  const live=addLiveBots(null,null,'hero-a','Test Hero',BASE);
  const botTeam={...live.team,
   heroClasses:Object.fromEntries(live.team.members.map((m,i)=>
    [m.uid,['krieger','magierin','waechter'][i]])),
   heroLocks:Object.fromEntries(live.team.members.map(m=>[m.uid,true]))};
  const people=Object.fromEntries(Object.entries(live.progress.people).map(
   ([id,v])=>[id,{...v,currentGate:10,highestGate:10,normals:normalGates}]));
  docs.set(key(DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID),botTeam);
  docs.set(key(DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID),
   {...live.progress,people});
 }
 const snapshot=k=>({exists:docs.has(k),data:()=>structuredClone(docs.get(k))});
 const db={
  collection:collection=>({doc:id=>({key:key(collection,id),get:async()=>{
   reads++;return snapshot(key(collection,id));
  }})}),
  runTransaction:async fn=>{
   transactions++;let wrote=false;const pending=[];
   const tx={
    get:async ref=>{assert.equal(wrote,false);reads++;return snapshot(ref.key)},
    set:(ref,value)=>{wrote=true;pending.push(['set',ref.key,structuredClone(value)])},
    create:(ref,value)=>{wrote=true;pending.push(['create',ref.key,structuredClone(value)])}
   };
   const data=await fn(tx);
   for(const [op,k,val] of pending){
    if(op==='create'&&docs.has(k))throw Error('duplicate receipt');
    docs.set(k,val);writes++;
   }
   return data;
  }
 };
 const app={get:(p,...handlers)=>routes.set('GET '+p,handlers),
  post:(p,...handlers)=>routes.set('POST '+p,handlers)};
 installDogBoss10Api(app,{getFirestore:()=>db,
  verifyProfile:async token=>players.includes('hero-'+token)?
   {uid:'hero-'+token,name:'Test '+token}:null,
  clock:()=>time,rand:()=>0,
  botLogic:botMode?{isLiveBotTeam,readyWithLiveBots,advanceLiveBotFight}:null});
 async function call(method,route,body={},user='hero-a'){
  const before={reads,writes,transactions};
  const handler=routes.get(method+' '+route);
  assert.ok(handler,'API route must exist '+method+' '+route);
  const req={body,get:h=>h==='authorization'?'Bearer '+idToken(user):''};
  const res={statusCode:200,status(v){this.statusCode=v;return this},
   set(){return this},json(value){this.body=value;return value}};
  for(const cb of handler){
   if(res.body)break;
   if(cb.length===3)await new Promise((resolve,reject)=>{
    try{Promise.resolve(cb(req,res,resolve)).then(()=>resolve(),reject)}
    catch(e){reject(e)}
   });
   else await cb(req,res);
  }
  history.push({method,route,reads:reads-before.reads,
   writes:writes-before.writes,transactions:transactions-before.transactions,
   status:res.statusCode});
  return res;
 }
 const stats=()=>({reads,writes,transactions,requests:history.length});
 return {docs,history,call,stats,setTime:ms=>{time=ms},time:()=>time,
  members,progressKey:key(DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID)};
}

function reactionMs(round,step){
 const min=round.startMs+Math.floor(step*8000/3)+450;
 const max=round.startMs+Math.floor((step+1)*8000/3)-220;
 for(let t=min;t<max;t+=10)
  if(Math.abs(dogMiniReactionPosition(round,t)-.5)<=round.zoneRadius*.5)return t;
 throw Error('no valid reaction time for step '+step);
}
async function fullFight(count,{pollMs=0}={}){
 const f=fixture(count),base='/api/dog/gates/boss10';
 // A clean status read has exactly two Firestore document gets.
 const first=await f.call('GET',base);
 assert.equal(first.statusCode,200);
 for(let i=0;i<count;i++){
  const r=await f.call('POST',base+'/ready',
   {requestId:'baseline-ready-'+i+'-long-00001'},f.members[i].uid);
  assert.equal(r.statusCode,200,'ready '+i+' '+JSON.stringify(r.body));
 }
 if(count<3){
  const x=await f.call('POST',base+'/start',
   {requestId:'baseline-start-unique-001'},f.members[0].uid);
  assert.equal(x.statusCode,200,'start '+JSON.stringify(x.body));
 }
 const state=f.docs.get(f.progressKey).boss10;
 assert.equal(state.phase,'fighting');
 assert.equal(state.miniGames.version,14);
 let actionNo=0;
 // Optional deliberately simplified HTTP polling model: one status GET per
 // signed-in browser every pollMs milliseconds. This is NOT measured client
 // traffic, does not reproduce interlude bursts/auth caches/SDK retries, and
 // must not be labelled as billed Firestore consumption.
 let nextPollMs=pollMs;
 async function pollsThrough(ms){
  if(!pollMs)return;
  while(nextPollMs<=Math.min(ms,134999)){
   f.setTime(BASE+nextPollMs);
   for(const member of f.members){
    const status=await f.call('GET',base,{},member.uid);
    assert.equal(status.statusCode,200,'poll '+nextPollMs+' '+member.uid);
   }
   nextPollMs+=pollMs;
  }
 }
 for(const round of state.miniGames.rounds){
  const posts=[];
  if(['math','target','chain'].includes(round.kind)){
   posts.push({time:round.endMs-100,step:0,
    answer:round.puzzles.map(p=>p.correctIndex)});
  }else if(round.kind==='dodge'){
   for(let step=0;step<3;step++){
    const attack=round.attacks[step];
    const safe=Array.from({length:round.lanes},(_,i)=>i)
     .find(i=>i!==attack.dangerIndex&&i!==attack.secondDangerIndex);
    posts.push({time:attack.startMs+400,step,answer:safe});
   }
  }else if(round.kind==='reaction'){
   for(let step=0;step<3;step++)
    posts.push({time:reactionMs(round,step),step,answer:1});
  }
  for(const item of posts){
   await pollsThrough(item.time);
   f.setTime(BASE+item.time);
   for(const member of f.members){
    const x=await f.call('POST',base+'/minigame',{
     requestId:'baseline-answer-'+String(actionNo++).padStart(6,'0'),
     round:round.round,step:item.step,answer:item.answer},member.uid);
    assert.equal(x.statusCode,200,round.kind+' '+item.step+' '+JSON.stringify(x.body));
   }
  }
 }
 await pollsThrough(134999);
 f.setTime(BASE+135001);
 const fin=await f.call('POST',base+'/finish',
  {requestId:'baseline-finish-unique-0001'},f.members[0].uid);
 assert.equal(fin.statusCode,200,'finish '+JSON.stringify(fin.body));
 const last=await f.call('GET',base);
 assert.equal(last.statusCode,200);
 const grouped=Object.fromEntries(['GET','ready','start','minigame','finish'].map(t=>{
  const entries=f.history.filter(x=>t==='GET'?x.method==='GET':
   x.route.endsWith('/'+t));
  return [t,{requests:entries.length,reads:entries.reduce((n,x)=>n+x.reads,0),
   writes:entries.reduce((n,x)=>n+x.writes,0)}];
 }));
 return {count,stats:f.stats(),grouped,history:f.history};
}
test('A-01 count actual API-code mock operations for one, two and three heroes',async t=>{
 const expected=[
  {heroes:1,reads:41,writes:24,posts:12,miniPosts:9},
  {heroes:2,reads:72,writes:44,posts:22,miniPosts:18},
  {heroes:3,reads:100,writes:62,posts:31,miniPosts:27}
 ];
 for(const item of expected){
  await t.test(item.heroes+' hero(es)',async()=>{
   const r=await fullFight(item.heroes);
   assert.equal(r.grouped.GET.requests,2);
   assert.equal(r.grouped.GET.reads,4);
   assert.equal(r.grouped.minigame.requests,item.miniPosts);
   assert.equal(r.grouped.ready.requests,item.heroes);
   assert.equal(r.stats.reads,item.reads);
   assert.equal(r.stats.writes,item.writes);
   assert.equal(r.stats.requests,item.posts+2);
   assert.ok(r.history.every(x=>x.status===200));
   console.log('[A-01 controlled API baseline]',JSON.stringify({
    heroes:item.heroes,...r.stats,byRequest:r.grouped,
    excludes:['Firebase Auth','profile cache reads','live bot owner cache',
     'periodic GET polls','Firestore transaction retries']
   }));
  });
 }
});
test('A-01 deterministic 3-second per-browser HTTP polling model: GET overhead only',async t=>{
 // 3s is a fixed illustrative rate, not the measured real UI refresh pattern.
 // Polls at 3s, 6s, ..., 132s: 44 extra GETs per browser (2 reads/GET).
 const originals=[{reads:41,writes:24},{reads:72,writes:44},{reads:100,writes:62}];
 for(let heroes=1;heroes<=3;heroes++){
  await t.test(heroes+' human browser(s)',async()=>{
   const r=await fullFight(heroes,{pollMs:3000});
   const expectedGets=2+44*heroes;
   assert.equal(r.grouped.GET.requests,expectedGets);
   assert.equal(r.grouped.GET.reads,expectedGets*2);
   assert.equal(r.grouped.GET.writes,0);
   assert.equal(r.stats.reads,originals[heroes-1].reads+44*heroes*2);
   assert.equal(r.stats.writes,originals[heroes-1].writes);
   assert.ok(r.history.every(x=>x.status===200));
   console.log('[A-01 synthetic per-browser HTTP polling model]',JSON.stringify({
    humans:heroes,intervalMs:3000,extraGETs:44*heroes,...r.stats,
    caveat:'not observed browser traffic or billable Firestore Usage',
   }));
  });
 }
});

test('A-01 idle read baseline: 20 unmodified waiting-page GETs, no writes',async()=>{
 const f=fixture(1),base='/api/dog/gates/boss10';
 for(let i=0;i<20;i++){
  f.setTime(BASE+i*15000);
  const res=await f.call('GET',base);
  assert.equal(res.statusCode,200);
 }
 assert.deepEqual(f.stats(),{reads:40,writes:0,transactions:0,requests:20});
 console.log('[A-01 idle controlled baseline]',JSON.stringify(f.stats()));
});
test('A-01 polling read baseline: a GET never writes without bot/expiry changes',async()=>{
 const f=fixture(3),base='/api/dog/gates/boss10';
 for(let i=0;i<90;i++){
  f.setTime(BASE+i*1000);
  const result=await f.call('GET',base);
  assert.equal(result.statusCode,200);
 }
 assert.deepEqual(f.stats(),{reads:180,writes:0,transactions:0,requests:90});
});

test('A-01 synthetic owner + Nova/Titan: measure GET-driven bot writes every five seconds',async()=>{
 const f=fixture(1,true),base='/api/dog/gates/boss10';
 const initial=await f.call('GET',base);
 assert.equal(initial.statusCode,200);
 const ready=await f.call('POST',base+'/ready',{
  requestId:'baseline-bots-ready-long-001'},'hero-a');
 assert.equal(ready.statusCode,200,'bot ready: '+JSON.stringify(ready.body));
 const game=f.docs.get(f.progressKey).boss10;
 assert.equal(game.phase,'fighting');
 assert.equal(game.roster.length,3);
 const actions=[];
 for(const round of game.miniGames.rounds){
  if(['math','target','chain'].includes(round.kind)){
   actions.push({at:round.endMs-100,round:round.round,step:0,
    answer:round.puzzles.map(p=>p.correctIndex)});
  }else if(round.kind==='dodge'){
   for(let step=0;step<3;step++){
    const attack=round.attacks[step];
    const safe=Array.from({length:round.lanes},(_,i)=>i)
     .find(i=>i!==attack.dangerIndex&&i!==attack.secondDangerIndex);
    actions.push({at:attack.startMs+400,round:round.round,step,answer:safe});
   }
  }else if(round.kind==='reaction'){
   for(let step=0;step<3;step++)
    actions.push({at:reactionMs(round,step),round:round.round,step,answer:1});
  }
 }
 const timeline=[
  ...actions.map((a,i)=>({...a,kind:'POST',n:i})),
  ...Array.from({length:28},(_,i)=>({at:i*5000,kind:'GET'}))
 ].sort((a,b)=>a.at-b.at||(a.kind==='POST'?-1:1));
 for(const event of timeline){
  f.setTime(BASE+event.at);
  const result=event.kind==='GET'?
   await f.call('GET',base):
   await f.call('POST',base+'/minigame',{
    requestId:'baseline-bots-answer-'+event.n+'-0001',
    round:event.round,step:event.step,answer:event.answer
   },'hero-a');
  assert.equal(result.statusCode,200,event.kind+' at '+event.at+
   ' '+JSON.stringify(result.body).slice(0,420));
 }
 const finished=f.docs.get(f.progressKey).boss10;
 assert.ok(['victory','cooldown'].includes(finished.phase),
  'final scheduled GET must settle the completed boss');
 const botWrites=f.history.filter(x=>x.method==='GET'&&x.writes>0);
 const botReads=botWrites.reduce((sum,x)=>sum+x.reads,0);
 assert.ok(botWrites.length>1,'bots must generate changes during real-clock battle');
 assert.ok(botWrites.length<=7,
  'S-06: five completed phases plus final settlement should need at most 6–7 bot update GET writes');
 assert.ok(botWrites.every(x=>x.reads>=3&&x.writes===1));
 assert.equal(f.history.filter(x=>x.route.endsWith('/minigame')).length,9);
 console.log('[A-01 synthetic bot fight]',JSON.stringify({
  humans:1,bots:2,...f.stats(),GETs:f.history.filter(x=>x.method==='GET').length,
  botUpdateGETs:botWrites.length,
  getWithWriteReads:botReads,
  getWrites:botWrites.reduce((sum,x)=>sum+x.writes,0),
  excludes:['auth profile reads','pilot owner 30s reads','Firestore retry charges',
   'real network duration','other site activity']
 }));
});
