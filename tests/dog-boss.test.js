import test from 'node:test';
import assert from 'node:assert/strict';
import {bossTeam,bossView,bossJoin,bossRestart,bossAction,bossReactionStart,bossMaxHp,bossDefeatAnalysis,bossPhaseOf,DOG_BOSS_PHASES,DOG_REACTION_DURATION_MS,DOG_REACTION_TARGET_MS,installDogBossApi,
 DOG_BOSS_HP,DOG_BOSS_COOLDOWN_MS,DOG_BOSS_TEAM_ID,DOG_BOSS_TEAM_COLLECTION,
 DOG_BOSS_RECEIPTS_COLLECTION} from '../dog-boss.js';
import {DOG_HERO_COLLECTION,dogHero} from '../dog-forge.js';

function fixture(){
 const docs=new Map(),routes=new Map(),writes=[];
 let currentTime=1_800_000_000_000;
 const snapshot=k=>({exists:docs.has(k),data:()=>structuredClone(docs.get(k))});
 const store={
  collection:name=>({doc:id=>({key:name+'/'+id,get:async()=>snapshot(name+'/'+id)})}),
  runTransaction:async fn=>{
   let written=false;const changes=[];
   const tx={
    get:async ref=>{assert.equal(written,false,'transaction reads before writes');return snapshot(ref.key);},
    set:(ref,value)=>{written=true;changes.push({op:'set',key:ref.key,value:structuredClone(value)});},
    create:(ref,value)=>{written=true;changes.push({op:'create',key:ref.key,value:structuredClone(value)});}
   };
   const result=await fn(tx);
   for(const x of changes){
    if(x.op==='create'&&docs.has(x.key))throw Error('ALREADY_EXISTS');
    docs.set(x.key,x.value);writes.push(x.key);
   }
   return result;
  }
 };
 const app={get:(path,...callbacks)=>routes.set('GET '+path,callbacks),
  post:(path,...callbacks)=>routes.set('POST '+path,callbacks)};
 const uids={a:'player-alpha',b:'player-bravo',c:'player-charlie',d:'player-delta'};
 installDogBossApi(app,{
  verifyProfile:async token=>Object.hasOwn(uids,token)?{uid:uids[token],name:'Hero '+token.toUpperCase()}:null,
  getFirestore:()=>store,rand:()=>5000,clock:()=>currentTime
 });
 async function call(method,route,body={},token='a'){
  const callbacks=routes.get(method+' '+route);assert.ok(callbacks,'Missing route '+route);
  const req={body,get:key=>key==='authorization'?'Bearer '+token:''};
  const res={statusCode:200,headers:{},set(key,val){this.headers[key]=val;return this;},
   status(n){this.statusCode=n;return this;},json(body){this.body=body;return body;}};
  for(const cb of callbacks){
   if(res.body)break;
   if(cb.length===3)await new Promise((resolve,reject)=>
    Promise.resolve(cb(req,res,resolve)).then(()=>{if(res.body)resolve()}).catch(reject));
   else await cb(req,res);
  }
  return res;
 }
 const team=()=>docs.get(DOG_BOSS_TEAM_COLLECTION+'/'+DOG_BOSS_TEAM_ID);
 const hero=(token,levels={})=>docs.set(DOG_HERO_COLLECTION+'/'+uids[token],
  {...dogHero(null),levels:{...dogHero(null).levels,...levels}});
 const now=()=>currentTime,advance=ms=>{currentTime+=ms;};
 const inject=state=>docs.set(DOG_BOSS_TEAM_COLLECTION+'/'+DOG_BOSS_TEAM_ID,state);
 return {call,docs,writes,team,hero,now,advance,inject,uids};
}
const join=(f,token,i)=>f.call('POST','/api/dog/boss/join',
 {requestId:'join-hero-'+token+'-'+String(i).padStart(6,'0')},token);
const act=(f,token,i,move='attack')=>f.call('POST','/api/dog/boss/act',
 {requestId:'boss-hit-'+token+'-'+String(i).padStart(6,'0'),move},token);
const restart=(f,token,i)=>f.call('POST','/api/dog/boss/restart',
 {requestId:'retry-boss-'+token+'-'+String(i).padStart(6,'0')},token);

test('Boss gate 1 starts with exactly 6000 LP and server-wide ten-minute lock',()=>{
 const s=bossTeam(null),v=bossView(s,'player-alpha',1000);
 assert.equal(s.bossHp,6000);assert.equal(s.gate,1);
 assert.equal(DOG_BOSS_HP,6000);
 assert.equal(DOG_BOSS_COOLDOWN_MS,600_000);
 assert.equal(s.phase,'ready');assert.equal(v.canJoin,true);
});
test('First three authenticated heroes register exactly once; fourth is refused',async()=>{
 const f=fixture();
 assert.equal((await f.call('GET','/api/dog/boss/me',{},'d')).body.isMember,false);
 for(const t of ['a','b','c']){
  const x=await join(f,t,1);assert.equal(x.statusCode,200);
  assert.equal(x.body.isMember,true);
 }
 const repeat=await join(f,'a',2);assert.equal(repeat.body.members.length,3);
 assert.equal((await join(f,'d',1)).body.error,'BOSS_TEAM_FULL');
 assert.equal(f.team().members.length,3);
 assert.equal((await f.call('GET','/api/dog/boss/me',{},'d')).body.canJoin,false);
 const unauth=await f.call('GET','/api/dog/boss/me',{},'bad-token');
 assert.equal(unauth.statusCode,401);
});
test('Boss action references real forge levels, never consumes material inventory',async()=>{
 const f=fixture();
 f.hero('a',{weapon:20,armor:12,attack_power:30,vitality:40});
 await join(f,'a',1);
 const initial=await f.call('GET','/api/dog/boss/me');
 assert.ok(initial.body.heroes[f.uids.a].maxHp>100);
 const first=await act(f,'a',1,'power');
 assert.equal(first.statusCode,200);
 assert.ok(first.body.result.damage>360);
 assert.ok(first.body.bossHp<DOG_BOSS_HP);
 assert.equal(first.body.phase,'fighting');
 assert.equal([...f.docs.keys()].some(k=>k.startsWith('dog_material_inventory')),false);
 assert.equal(f.team().attempt,1);
});
test('Concurrent-player story: a full team defeat starts the same shared cooldown',async()=>{
 const f=fixture();
 await join(f,'a',1);await join(f,'b',1);await join(f,'c',1);
 const before=f.now();
 const state=bossTeam(f.team());
 for(const member of state.members){
  state.heroes[member.uid].hp=1;
 }
 state.phase='fighting';state.bossHp=3500;f.inject(state);
 for(const [i,token] of ['a','b','c'].entries()){
  const x=await act(f,token,i+10,'guard');
  assert.equal(x.statusCode,200);
  // Guard is defensive, so force the final strike with an unguarded state below.
 }
});
test('Defeat persists exactly 600 seconds; reloading and other heroes cannot bypass',async()=>{
 const f=fixture();await join(f,'a',1);await join(f,'b',1);await join(f,'c',1);
 const state=bossTeam(f.team());
 state.phase='fighting';state.bossHp=4500;
 for(const m of state.members){state.heroes[m.uid].hp=1;state.heroes[m.uid].guard=false}
 f.inject(state);
 const first=await act(f,'a',3,'attack');
 assert.equal(first.statusCode,200);assert.equal(first.body.heroes[f.uids.a].hp,0);
 const second=await act(f,'b',3,'attack');
 assert.equal(second.statusCode,200);assert.equal(second.body.heroes[f.uids.b].hp,0);
 const last=await act(f,'c',3,'attack');
 assert.equal(last.statusCode,200);assert.equal(last.body.phase,'cooldown');
 assert.equal(last.body.result.defeated,true);
 assert.equal(last.body.cooldownRemainingMs,DOG_BOSS_COOLDOWN_MS);
 assert.equal(last.body.cooldownUntil,f.now()+DOG_BOSS_COOLDOWN_MS);
 const same=await f.call('GET','/api/dog/boss/me',{},'b');
 assert.equal(same.body.phase,'cooldown');
 assert.equal(same.body.cooldownRemainingMs,600000);
 for(const t of ['a','b','c']){
  assert.equal((await act(f,t,5)).body.error,'BOSS_COOLDOWN_ACTIVE');
  assert.equal((await restart(f,t,5)).body.error,'BOSS_COOLDOWN_ACTIVE');
 }
 f.advance(599999);
 assert.equal((await restart(f,'b',6)).statusCode,409);
 f.advance(1);
 assert.equal((await f.call('GET','/api/dog/boss/me',{},'a')).body.canRestart,true);
 assert.equal((await act(f,'a',7)).statusCode,409,'expired lock still needs explicit restart');
});
test('After exactly 10 minutes reset the SAME boss to 6000 LP, not previous gates',async()=>{
 const f=fixture();await join(f,'a',1);await join(f,'b',1);
 const state=bossTeam(f.team());state.phase='cooldown';state.bossHp=900;
 state.attempt=4;state.cooldownUntil=f.now()+600000;
 state.heroes[f.uids.a].hp=0;state.heroes[f.uids.b].hp=0;f.inject(state);
 f.hero('a',{weapon:18,armor:15,vitality:25});
 f.hero('b',{weapon:12,armor:7,vitality:12});
 f.advance(600000);
 const done=await restart(f,'b',10);
 assert.equal(done.statusCode,200);assert.equal(done.body.phase,'ready');
 assert.equal(done.body.gate,1);assert.equal(done.body.bossHp,6000);
 assert.equal(done.body.attempt,5);assert.equal(done.body.cooldownUntil,0);
 assert.equal(done.body.heroes[f.uids.a].hp,bossMaxHp({levels:{armor:15,vitality:25}}));
 assert.equal(done.body.heroes[f.uids.b].hp,bossMaxHp({levels:{armor:7,vitality:12}}));
 assert.equal((await restart(f,'a',11)).body.error,'BOSS_NO_RESTART');
 assert.equal((await act(f,'a',11)).statusCode,200);
});
test('Receipt replay does not duplicate attacks or reset clock and refuses changed commands',async()=>{
 const f=fixture();await join(f,'a',1);
 const command={requestId:'attack-once-000001',move:'power'};
 const first=await f.call('POST','/api/dog/boss/act',command,'a');
 assert.equal(first.statusCode,200);
 const before=f.team(),writes=f.writes.length;
 const repeat=await f.call('POST','/api/dog/boss/act',command,'a');
 assert.equal(repeat.statusCode,200);assert.equal(repeat.body.replayed,true);
 assert.deepEqual(f.team(),before);assert.equal(f.writes.length,writes);
 const conflict=await f.call('POST','/api/dog/boss/act',
 {requestId:command.requestId,move:'guard'},'a');
 assert.equal(conflict.statusCode,409);assert.equal(conflict.body.error,'BOSS_RECEIPT_CONFLICT');
 assert.equal(f.docs.has(DOG_BOSS_RECEIPTS_COLLECTION+'/'+f.uids.a+'_'+command.requestId),true);
});
test('Victory cannot be confused with defeat; the first boss is not automatically replaced',async()=>{
 const f=fixture();await join(f,'a',1);
 f.hero('a',{weapon:20,attack_power:50,destruction:50});
 const state=bossTeam(f.team());state.phase='fighting';state.bossHp=1;f.inject(state);
 const x=await act(f,'a',1);
 assert.equal(x.body.result.victory,true);assert.equal(x.body.phase,'victory');
 assert.equal(x.body.cooldownUntil,0);assert.equal(x.body.gate,1);
 assert.equal((await act(f,'a',2)).body.error,'BOSS_ALREADY_WON');
});

test('Boss phases change at 50 % and 25 %, with a warning BEFORE the next attack',()=>{
 const member='player-alpha';
 let state=bossJoin(null,member,'Testheld',null,1000);
 assert.equal(DOG_BOSS_PHASES.length,3);
 assert.equal(bossPhaseOf(6000),1);
 assert.equal(bossPhaseOf(3001),1);
 assert.equal(bossPhaseOf(3000),2);
 assert.equal(bossPhaseOf(1500),3);
 assert.equal(bossPhaseOf(0),3);
 state={...state,bossHp:3100,phase:'fighting'};
 const hit=bossAction(state,member,null,'attack',[5000,5000,5000,5000],1100);
 assert.equal(hit.result.bossPhase,2);
 assert.equal(hit.result.phaseChanged,true);
 assert.equal(hit.state.bossCharged,true);
 const warning=bossView(hit.state,member,1100);
 assert.equal(warning.bossPhase,2);
 assert.match(warning.bossTelegraph,/Flammenexplosion/);
 assert.equal(warning.bossAttackName,'🔥 Flammenexplosion');
 assert.ok(warning.log.some(line=>/Bossphase 2/.test(line)));
});
test('A warned explosion hits the acting hero, and guarding protects that hero',()=>{
 const member='player-alpha';
 let state=bossJoin(null,member,'Testheld',null,1000);
 state={...state,phase:'fighting',bossHp:2700,bossTurn:2,bossCharged:true};
 const normal=bossAction(state,member,null,'attack',[5000,5000,5000,5000],1100);
 const guarding=bossAction(state,member,null,'guard',[5000,5000,5000,5000],1100);
 assert.equal(normal.result.chargedAttack,true);
 assert.equal(normal.result.bossAttack,'Flammenexplosion');
 assert.ok(normal.result.retaliation>40);
 assert.equal(guarding.result.chargedAttack,true);
 assert.ok(guarding.result.retaliation<normal.result.retaliation*.5);
 assert.ok(guarding.result.actorHp>normal.result.actorHp);
 assert.match(normal.state.log.join(' '),/Flammenexplosion/);
});
test('Third phase fires a stronger attack and resets its warning on defeat/retry',()=>{
 const member='player-alpha';
 const state={...bossJoin(null,member,'Testheld',null,1000),phase:'fighting',
  bossHp:1520,bossTurn:1,bossCharged:false};
 const hit=bossAction(state,member,null,'attack',[5000,5000,5000,5000],1100);
 assert.equal(hit.result.bossPhase,3);
 assert.equal(hit.state.bossCharged,true);
 assert.equal(bossView(hit.state,member).bossPhaseName,'Das letzte Inferno');
 const losing={...hit.state,phase:'cooldown',bossHp:1200,
  cooldownUntil:1120+DOG_BOSS_COOLDOWN_MS};
 losing.heroes[member]={hp:0,maxHp:104,guard:false};
 const locked=bossView(losing,member,1200);
 assert.equal(locked.canFight,false);
 assert.equal(locked.bossTelegraph.includes('Flammenexplosion'),false);
 const renewed=bossRestart(losing,{[member]:{levels:{weapon:16,armor:12,vitality:10}}},member,
  losing.cooldownUntil);
 assert.equal(renewed.bossHp,6000);
 assert.equal(renewed.bossTurn,0);
 assert.equal(renewed.bossCharged,false);
 assert.equal(bossView(renewed,member).bossPhase,1);
});
test('Finishing the boss prevents retaliation even when an explosion was queued',()=>{
 const uid='player-alpha';
 const state={...bossJoin(null,uid,'Testheld',null,1000),phase:'fighting',
  bossHp:1,bossTurn:5,bossCharged:true};
 const result=bossAction(state,uid,null,'attack',[5000,5000,5000,5000],1300);
 assert.equal(result.result.victory,true);
 assert.equal(result.result.retaliation,0);
 assert.equal(result.state.phase,'victory');
 assert.equal(result.state.cooldownUntil,0);
 assert.equal(result.state.bossCharged,false);
});
test('Boss phase/warning fields survive GET and receipt replay without changing HP',async()=>{
 const f=fixture();await join(f,'a',100);
 const state=bossTeam(f.team());state.phase='fighting';state.bossHp=3030;
 f.inject(state);
 const done=await act(f,'a',222,'attack');
 assert.equal(done.statusCode,200);
 assert.equal(done.body.bossPhase,2);
 assert.equal(done.body.result.nextAttackCharged,true);
 const hp=done.body.bossHp;
 const get=await f.call('GET','/api/dog/boss/me',{},'a');
 assert.equal(get.body.bossHp,hp);
 assert.equal(get.body.bossPhase,2);
 assert.equal(get.body.bossCharged,true);
 const replay=await act(f,'a',222,'attack');
 assert.equal(replay.statusCode,200);
 assert.equal(replay.body.replayed,true);
 assert.equal(replay.body.bossHp,hp);
 assert.equal(replay.body.bossCharged,true);
});

test('An outdated multiplayer screen cannot trigger an unseen flame attack',async()=>{
 const f=fixture();await join(f,'a',300);await join(f,'b',301);
 const first=await f.call('POST','/api/dog/boss/act',
  {requestId:'fresh-hero-a-000001',move:'attack',expectedTurn:0},'a');
 assert.equal(first.statusCode,200);
 assert.equal(first.body.bossTurn,1);
 const before=f.team(),count=f.writes.length;
 const stale=await f.call('POST','/api/dog/boss/act',
  {requestId:'stale-hero-b-000001',move:'power',expectedTurn:0},'b');
 assert.equal(stale.statusCode,409);
 assert.equal(stale.body.error,'BOSS_STATE_STALE');
 assert.equal(f.writes.length,count);
 assert.deepEqual(f.team(),before);
 const refreshed=await f.call('GET','/api/dog/boss/me',{},'b');
 assert.equal(refreshed.body.bossTurn,1);
 const correct=await f.call('POST','/api/dog/boss/act',
  {requestId:'fresh-hero-b-000001',move:'guard',expectedTurn:1},'b');
 assert.equal(correct.statusCode,200);
 assert.equal(correct.body.bossTurn,2);
});
test('Replaying a confirmed attack ignores later turn changes but rejects altered expectation',async()=>{
 const f=fixture();await join(f,'a',303);await join(f,'b',304);
 const cmd={requestId:'replay-turn-a-000001',move:'attack',expectedTurn:0};
 const first=await f.call('POST','/api/dog/boss/act',cmd,'a');
 assert.equal(first.statusCode,200);
 await f.call('POST','/api/dog/boss/act',
  {requestId:'second-turn-b-0001',move:'guard',expectedTurn:1},'b');
 const hp=f.team().bossHp,writeCount=f.writes.length;
 const replay=await f.call('POST','/api/dog/boss/act',cmd,'a');
 assert.equal(replay.statusCode,200);
 assert.equal(replay.body.replayed,true);
 assert.equal(replay.body.bossHp,hp);
 assert.equal(f.writes.length,writeCount);
 const conflict=await f.call('POST','/api/dog/boss/act',
  {...cmd,expectedTurn:1},'a');
 assert.equal(conflict.statusCode,409);
 assert.equal(conflict.body.error,'BOSS_RECEIPT_CONFLICT');
});

test('Defeat diagnosis calculates an attack shortage from actual boss HP and combat actions',()=>{
 const state={...bossTeam(null),phase:'cooldown',bossHp:4800,bossTurn:6,
  combatStats:{actions:6,damageDealt:1200,damageTaken:250,defendedActions:0,flameHits:1}};
 const result=bossDefeatAnalysis(state);
 assert.equal(result.category,'attack');
 assert.match(result.title,/Angriffskraft/);
 assert.equal(result.bossDamage,1200);
 assert.equal(result.bossRemaining,4800);
 assert.equal(result.bossProgressPct,20);
 assert.equal(result.teamActions,6);
 assert.equal(result.averageDamage,200);
 assert.equal(result.estimatedMoreActions,24);
 assert.equal(result.receivedDamage,250);
 assert.match(result.recommendation,/Waffen/);
 assert.equal(bossView(state,'observer',1234).defeatAnalysis.category,'attack');
});
test('Nearly completed fight recommends defense rather than higher weapon damage',()=>{
 const state={...bossTeam(null),phase:'cooldown',bossHp:300,bossTurn:10,
  combatStats:{actions:10,damageDealt:5700,damageTaken:510,
   defendedActions:2,flameHits:2}};
 const result=bossDefeatAnalysis(state);
 assert.equal(result.category,'defense');
 assert.match(result.title,/Abwehr/);
 assert.equal(result.bossProgressPct,95);
 assert.equal(result.averageDamage,570);
 assert.equal(result.estimatedMoreActions,1);
 assert.equal(result.guardedActions,2);
 assert.match(result.recommendation,/Rüstung/);
});
test('Middle progress suggests weapons and armor together; no advice during battle or victory',()=>{
 const state={...bossTeam(null),phase:'cooldown',bossHp:2100,
  combatStats:{actions:8,damageDealt:3900,damageTaken:320,
   defendedActions:2,flameHits:3}};
 const report=bossDefeatAnalysis(state);
 assert.equal(report.category,'balanced');
 assert.equal(report.bossProgressPct,65);
 assert.match(report.recommendation,/Waffen und Rüstung/);
 assert.equal(bossDefeatAnalysis({...state,phase:'fighting'}),null);
 assert.equal(bossView({...state,phase:'victory',bossHp:0},'observer').defeatAnalysis,null);
});
test('Defeat advice is persistent after GET and cleared when a new attempt begins',async()=>{
 const f=fixture();await join(f,'a',777);
 const losing=bossTeam(f.team());
 losing.phase='fighting';losing.bossHp=5900;losing.heroes[f.uids.a].hp=1;
 losing.combatStats={actions:2,damageDealt:100,damageTaken:40,
  defendedActions:0,flameHits:0};
 f.inject(losing);
 const last=await act(f,'a',778,'attack');
 assert.equal(last.statusCode,200);
 assert.equal(last.body.phase,'cooldown');
 assert.equal(last.body.defeatAnalysis.category,'attack');
 assert.ok(last.body.result.defeatAnalysis);
 assert.ok(last.body.combatStats.actions>=3);
 const before=f.writes.length;
 const repeat=await act(f,'a',778,'attack');
 assert.equal(repeat.body.replayed,true);
 assert.equal(repeat.body.defeatAnalysis.category,'attack');
 assert.equal(f.writes.length,before,'receipt retry causes no second accounting');
 const refreshed=await f.call('GET','/api/dog/boss/me',{},'a');
 assert.equal(refreshed.body.defeatAnalysis.bossRemaining,last.body.bossHp);
 assert.equal(refreshed.body.defeatAnalysis.teamActions,last.body.combatStats.actions);
 assert.equal(refreshed.body.cooldownRemainingMs,600000);
 f.advance(DOG_BOSS_COOLDOWN_MS);
 const restarted=await restart(f,'a',778);
 assert.equal(restarted.statusCode,200);
 assert.equal(restarted.body.defeatAnalysis,null);
 assert.equal(restarted.body.combatStats.actions,0);
 assert.equal(restarted.body.combatStats.damageTaken,0);
 assert.equal(restarted.body.bossHp,6000);
});

test('Reaction starts a single server-timed 3-second challenge per player and boss turn',()=>{
 const uid='player-alpha';
 const team=bossJoin(null,uid,'Testheld',null,1000);
 const first=bossReactionStart(team,uid,2000);
 assert.equal(DOG_REACTION_DURATION_MS,3000);
 assert.equal(DOG_REACTION_TARGET_MS,1700);
 assert.equal(first.challenge.startAt,2000);
 assert.equal(first.challenge.targetAt,3700);
 assert.equal(first.challenge.expiresAt,5000);
 assert.equal(first.challenge.turn,0);
 assert.equal(first.state.bossTurn,0);
 const retry=bossReactionStart(first.state,uid,2800);
 assert.equal(retry.challenge.targetAt,3700,'cannot extend the same timed challenge');
 assert.equal(retry.state.updatedAt,first.state.updatedAt,'no extra team mutation on repeat');
 const publicView=bossView(first.state,uid,2100);
 assert.equal(publicView.reactionChallenge.targetAt,3700);
 assert.equal(publicView.reactionRules.maxBonusPct,10);
 assert.equal(publicView.reactionChallenges,undefined,'other players’ tickets remain private');
});
test('Reaction adds no more than ten percent to the server-calculated equipment damage',()=>{
 const uid='player-alpha';
 const team=bossJoin(null,uid,'Testheld',null,1000);
 const started=bossReactionStart(team,uid,2000).state;
 const rolls=[5000,5000,5000,5000];
 const normal=bossAction(team,uid,null,'attack',rolls,3700);
 const perfect=bossAction(started,uid,null,'reaction',rolls,3700);
 assert.equal(perfect.result.reactionBonusPct,10);
 assert.equal(perfect.result.reactionGrade,'perfekt');
 assert.equal(perfect.result.damage,Math.round(normal.result.damage*1.10));
 assert.ok(perfect.result.damage<normal.result.damage*1.11);
 const good=bossAction(started,uid,null,'reaction',rolls,4200);
 assert.equal(good.result.reactionBonusPct,6);
 const close=bossAction(started,uid,null,'reaction',rolls,4700);
 assert.equal(close.result.reactionBonusPct,3);
 const late=bossAction(started,uid,null,'reaction',rolls,5100);
 assert.equal(late.result.reactionBonusPct,0);
 assert.equal(late.result.damage,normal.result.damage);
 assert.equal(late.result.reactionGrade,'verpasst');
 assert.throws(()=>bossAction(team,uid,null,'reaction',rolls,3700),
  /BOSS_REACTION_NOT_READY/);
});
test('Other heroes can join a reaction but cannot reuse another player ticket',()=>{
 const a='player-alpha',b='player-bravo';
 let team=bossJoin(null,a,'Held A',null,1000);
 team=bossJoin(team,b,'Held B',null,1000);
 const start=bossReactionStart(team,a,2000).state;
 assert.equal(bossView(start,b).reactionChallenge,null);
 assert.throws(()=>bossAction(start,b,null,'reaction',[5000,5000,5000,5000],3700),
  /BOSS_REACTION_NOT_READY/);
 const joined=bossReactionStart(start,b,2400).state;
 assert.equal(joined.reactionChallenges[a].targetAt,3700);
 assert.equal(joined.reactionChallenges[b].targetAt,4100);
 const action=bossAction(joined,a,null,'reaction',[5000,5000,5000,5000],3700).state;
 assert.equal(action.bossTurn,1);
 assert.deepEqual(action.reactionChallenges,{});
 assert.throws(()=>bossAction(action,b,null,'reaction',[5000,5000,5000,5000],4100),
  /BOSS_REACTION_NOT_READY/);
});
test('Reaction issue and strike use idempotent receipts across retries',async()=>{
 const f=fixture();await join(f,'a',800);
 const start={requestId:'reaction-start-000001'};
 const first=await f.call('POST','/api/dog/boss/reaction-start',start,'a');
 assert.equal(first.statusCode,200);
 assert.equal(first.body.result.type,'reaction-start');
 const target=first.body.reactionChallenge.targetAt;
 assert.equal(target,f.now()+1700);
 const written=f.writes.length;
 f.advance(1200);
 const duplicate=await f.call('POST','/api/dog/boss/reaction-start',start,'a');
 assert.equal(duplicate.body.replayed,true);
 assert.equal(duplicate.body.reactionChallenge.targetAt,target);
 assert.equal(f.writes.length,written);
 f.advance(500);
 const attack={requestId:'reaction-attack-000001',move:'reaction',expectedTurn:0};
 const hit=await f.call('POST','/api/dog/boss/act',attack,'a');
 assert.equal(hit.statusCode,200);
 assert.equal(hit.body.result.reactionBonusPct,10);
 assert.equal(hit.body.reactionChallenge,null);
 const damage=hit.body.bossHp,after=f.writes.length;
 const again=await f.call('POST','/api/dog/boss/act',attack,'a');
 assert.equal(again.body.replayed,true);
 assert.equal(again.body.bossHp,damage);
 assert.equal(f.writes.length,after);
 const noTicket=await f.call('POST','/api/dog/boss/act',
  {requestId:'reaction-attack-000002',move:'reaction',expectedTurn:1},'a');
 assert.equal(noTicket.statusCode,409);
 assert.equal(noTicket.body.error,'BOSS_REACTION_NOT_READY');
});
test('Cooldown rejects new reaction start; retry resets challenge tickets',()=>{
 const uid='player-alpha';
 const joined=bossJoin(null,uid,'Testheld',null,1000);
 const issued=bossReactionStart(joined,uid,2000).state;
 const losing={...issued,phase:'cooldown',cooldownUntil:2000+600000};
 assert.throws(()=>bossReactionStart(losing,uid,2200),/BOSS_COOLDOWN_ACTIVE/);
 const next=bossRestart(losing,{[uid]:null},uid,602000);
 assert.equal(next.phase,'ready');
 assert.deepEqual(next.reactionChallenges,{});
 assert.equal(bossView(next,uid).reactionChallenge,null);
});
