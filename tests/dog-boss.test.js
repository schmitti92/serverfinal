import test from 'node:test';
import assert from 'node:assert/strict';
import {bossTeam,bossView,bossJoin,bossRestart,bossAction,bossMaxHp,bossPhaseOf,DOG_BOSS_PHASES,installDogBossApi,
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
