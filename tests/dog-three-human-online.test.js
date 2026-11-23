import test from 'node:test';
import assert from 'node:assert/strict';
import {installSharedLobby} from '../shared-lobby.js';
import {legalActions as dogLegalActions} from '../dog/engine.js';

function harness(options={}){
 let finished=false,skyjoBootstraps=0,watchStarts=0,watchStops=0;
 let adapter;
 const docs=new Map(),routes=[],middles=[],listeners=new Map();
 const store={
  collection:name=>({doc:code=>({path:name+'/'+code,get:async()=>snapshot(docs.get(name+'/'+code)),
     set:async value=>{docs.set(name+'/'+code,structuredClone(value));},
    onSnapshot(cb,_onError){
     watchStarts++;
     const key=name+'/'+code;const set=listeners.get(key)||new Set();set.add(cb);listeners.set(key,set);
     queueMicrotask(()=>{if(set.has(cb))cb(snapshot(docs.get(key)));});
     return ()=>{watchStops++;set.delete(cb);};
    }
   })}),
  pending:Promise.resolve(),
  runTransaction(fn){
   const task=this.pending.catch(()=>{}).then(async()=>{
    const ops=[];
    const tx={get:async ref=>snapshot(docs.get(ref.path)),set:(ref,value)=>ops.push(()=>docs.set(ref.path,structuredClone(value))),delete:ref=>ops.push(()=>docs.delete(ref.path))};
    const result=await fn(tx);ops.forEach(o=>o());
   for(const [key,set] of listeners)for(const cb of set)queueMicrotask(()=>cb(snapshot(docs.get(key))));
   return result;
   });this.pending=task.catch(()=>{});return task;
  },
 };
 function snapshot(value){return {exists:!!value,data:()=>structuredClone(value)};}
 // Real Express routes may use multiple handlers (authentication, response).
 // Run the complete chain for scratch endpoints rather than invoking auth
 // alone and mistakenly treating next() as missing.
 const chain=handlers=>async(req,res)=>{
  const call=async i=>{
   if(i>=handlers.length)return;
   let downstream;
   await handlers[i](req,res,()=>{downstream=call(i+1)});
   if(downstream)await downstream;
  };
  return call(0);
 };
 const routeFn=(path,handlers)=>path.startsWith('/api/hub/scratch')?
  chain(handlers):handlers[0];
 const app={
  get(path,...handlers){routes.push({method:'GET',path,fn:routeFn(path,handlers)});},
  post(path,...handlers){routes.push({method:'POST',path,fn:routeFn(path,handlers)});},
  use(path,fn){middles.push({path,fn});}
 };
 const identities={alice:{uid:'user_alice123',name:'Alice'},bob:{uid:'user_bobby123',name:'Bob'},cara:{uid:'user_carol123',name:'Cara'},dana:{uid:'user_dana123',name:'Dana'}};
 let id=0,now=1000;
 adapter=installSharedLobby(app,{verifyProfile:options.verifyProfile|| (async token=>identities[token]||null),getFirestore:()=>store,clock:()=>now,codeGenerator:()=>`ABC23${['D','E','F'][id++%3]}`,isMatchFinished:async()=>finished,challengeRandomInt:options.challengeRandomInt,christmasEventActive:options.christmasEventActive,scratchAdminUids:options.scratchAdminUids||'',bootstrapSkyjo:async seat=>{skyjoBootstraps++;return {ok:true,rev:1,state:{kind:'skyjo-room-v2',version:2,lobby:{players:seat.members.map(p=>({id:'hub_'+p.uid,name:p.name})),hostId:'hub_'+seat.hostUid,settings:seat.settings,status:'lobby'},game:null}};}});
 async function api(method,path,user='alice',body){
  const route=routes.find(r=>r.method===method&&matches(r.path,path));if(!route)throw Error('NO_ROUTE '+method+' '+path);
  const params=Object.fromEntries(route.path.split('/').filter(x=>x.startsWith(':')).map((x,i)=>[x.slice(1),path.split('/')[route.path.split('/').indexOf(x)]]));
  const req={body:body||{},params,get:header=>header==='authorization'?`Bearer ${user}`:''};
  const res={statusCode:200,status(n){this.statusCode=n;return this;},json(data){this.jsonBody=data;return this;}};
  const auth=middles.find(x=>path===x.path||path.startsWith(x.path+'/'));
  if(auth){let downstream;await auth.fn(req,res,()=>{downstream=route.fn(req,res);});if(downstream)await downstream;}else await route.fn(req,res);
  return {status:res.statusCode,...res.jsonBody};
 }
 const matches=(pattern,path)=>pattern.split('/').length===path.split('/').length && pattern.split('/').every((p,i)=>p.startsWith(':')||p===path.split('/')[i]);
 return {api,store,docs,identities,advance:ms=>now+=ms,adapter,watchStats:()=>({starts:watchStarts,stops:watchStops}),setFinished(value){finished=value;},bootstraps:()=>skyjoBootstraps};
}

test('DOG three distinct online profiles share one authoritative match without a fourth bot',async()=>{
 const h=harness(),code=(await h.api('POST','/api/hub/rooms','alice')).room.code;
 for(const who of ['bob','cara']){
  const joined=await h.api('POST','/api/hub/rooms/'+code+'/join',who);
  assert.equal(joined.status,200);
  assert.equal(joined.room.players.filter(p=>p.participating).length,0,'pre-game lobby is preserved');
 }
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'})).status,200);
 for(const who of ['alice','bob']){
  const pending=await h.api('POST','/api/hub/rooms/'+code+'/ready',who,{ready:true});
  assert.equal(pending.status,200);
  assert.equal(pending.room.phase,'preparing','start only after the third real profile is ready');
 }
 const launched=await h.api('POST','/api/hub/rooms/'+code+'/ready','cara',{ready:true});
 assert.equal(launched.status,200);
 assert.equal(launched.room.phase,'playing');
 const matchId=launched.room.match.id;
 assert.equal(launched.room.match.dog.players.length,4);
 assert.deepEqual(launched.room.match.dog.players.map(p=>p.bot),[false,false,false,false]);
 assert.deepEqual(launched.room.match.dog.players.map(p=>!!p.inactive),[false,false,false,true]);
 assert.equal(launched.room.match.dog.mode,'solo3');
 assert.equal(launched.room.match.dog.pieces.length,12);
 assert.equal(launched.room.match.dog.phase,'exchange');
 assert.equal(launched.room.match.dog.exchanges[3],true,'the empty seat must never wait for or select a card');

 for(const [seat,who] of ['alice','bob','cara'].entries()){
  const state=(await h.api('GET','/api/hub/rooms/'+code,who)).room;
  assert.equal(state.code,code);
  assert.equal(state.match.id,matchId,'all players share the same actual match');
  assert.equal(state.match.dogSeat,seat);
  assert.equal(state.match.dog.hands[seat].length,6,'own hand belongs to verified profile');
  assert.equal(state.match.dog.deck,undefined);
  assert.equal(state.match.dog.discard,undefined);
  for(let other=0;other<4;other++){
   if(other!==seat){
    assert.equal(Array.isArray(state.match.dog.hands[other]),false,'opponent hands are never exposed');
    assert.equal(state.match.dog.hands[other].count,other===3?0:6,'the empty fourth seat has no hand');
   }
  }
 }
 const path='/api/hub/rooms/'+code+'/dog/action';
 assert.equal((await h.api('POST',path,'dana',{
  matchId,expectedRevision:launched.room.match.dog.revision,
  actionId:'dog-three-outsider-001',action:{type:'exchange',cardId:1}
 })).status,403,'another account cannot take over a player seat');
 for(const [i,who] of ['alice','bob','cara'].entries()){
  const state=(await h.api('GET','/api/hub/rooms/'+code,who)).room;
  const seat=state.match.dogSeat;
  const cardId=state.match.dog.hands[seat][0].id;
  const sent=await h.api('POST',path,who,{
   matchId,expectedRevision:state.match.dog.revision,
   actionId:'dog-three-exchange-'+i+'-001',action:{type:'exchange',cardId}
  });
  assert.equal(sent.status,200,who+' exchange is accepted by Render');
  assert.equal(sent.room.match.id,matchId);
 }
 const final=(await h.api('GET','/api/hub/rooms/'+code,'cara')).room;
 assert.equal(final.match.dog.phase,'play','only three verified human exchanges complete the phase');
 assert.equal(final.match.dog.players.filter(p=>p.bot).length,0);
 assert.equal(final.match.dog.players.filter(p=>!p.inactive).length,3);
 assert.ok([0,1,2].includes(final.match.dog.current),'the server must skip the empty color; it may auto-discard unplayable hands');
 assert.equal(final.match.id,matchId);
});

test('DOG three-player winner credits exactly three genuine profiles, never the vacant seat',async()=>{
 const h=harness(),code=(await h.api('POST','/api/hub/rooms','alice')).room.code;
 for(const who of ['bob','cara'])assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/join',who)).status,200);
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'})).status,200);
 for(const who of ['alice','bob','cara'])assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/ready',who,{ready:true})).status,200);
 // Put a trusted server-side fixture one legal goal-entry away from victory;
 // the last move still goes through the normal authenticated action route.
 const key='spielesammlung_hub_v1/'+code,room=h.docs.get(key);
 assert.ok(room);
 const s=room.match.dog;
 assert.equal(s.mode,'solo3');
 s.phase='play';s.current=0;s.starter=0;s.revision=42;
 s.hands=[[{id:7777,type:'2'}],[],[],[]];
 for(const p of s.pieces.filter(p=>p.owner===0)){
  if(p.id===3){p.place='track';p.pos=63;}
  else{p.place='goal';p.pos=p.id+1;}
 }
 h.docs.set(key,room);
 const action=dogLegalActions(s,0).find(a=>a.type==='move'&&a.pieceId===3&&a.steps===2&&a.viaGoal===true);
 assert.ok(action,'the finishing move must be valid under the server DOG rules');
 const reply=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','alice',{
  matchId:room.match.id,expectedRevision:42,
  actionId:'dog-solo3-win-confirm-000001',action
 });
 assert.equal(reply.status,200,reply.error);
 assert.equal(reply.room.match.dog.phase,'finished');
 assert.equal(reply.room.match.dog.winner,0);
 for(const [uid,wins] of [['user_alice123',1],['user_bobby123',0],['user_carol123',0]]){
  const record=h.docs.get('dog_player_statistics_v1/'+uid);
  assert.equal(record?.played,1,'each actual human earns precisely one completed match');
  assert.equal(record?.wins,wins,'the individual winner is recorded without old team parity');
 }
 assert.equal(h.docs.has('dog_player_statistics_v1/null'),false,'vacant fourth seat is not an account');
 assert.equal(h.docs.has('dog_player_statistics_v1/undefined'),false);
 const repeated=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','alice',{
  matchId:room.match.id,expectedRevision:42,actionId:'dog-solo3-win-confirm-000001',action
 });
 assert.equal(repeated.status,200,'idempotent retry must not re-award match statistics');
 assert.equal(h.docs.get('dog_player_statistics_v1/user_alice123').played,1);
});


test('first regular DOG match has no Christmas wallet writes even while season is globally active',async()=>{
 const h=harness({christmasEventActive:()=>true});
 h.advance(Date.parse('2026-11-21T14:30:00Z'));
 const code=(await h.api('POST','/api/hub/rooms','alice')).room.code;
 for(const who of ['bob','cara'])
  assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/join',who)).status,200);
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'})).status,200);
 for(const who of ['alice','bob','cara'])
  assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/ready',who,{ready:true})).status,200);
 const key='spielesammlung_hub_v1/'+code;
 let room=h.docs.get(key);
 assert.equal(room.match.dogChristmasEligibilityChecked,true);
 assert.equal(room.match.christmas?.enabled===true,false,'the first completed game is the prerequisite for the event');
 assert.equal([...h.docs.keys()].some(key=>key.startsWith('dog_christmas_villages_v1/')),false);
 const first=room.match.dog.hands[0][0];
 const exchange=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','alice',{
  matchId:room.match.id,expectedRevision:room.match.dog.revision,
  actionId:'first-standard-dog-exchange-001',action:{type:'exchange',cardId:first.id}
 });
 assert.equal(exchange.status,200,exchange.error);
 assert.equal(h.docs.get(key).match.christmas?.enabled===true,false);
 assert.equal([...h.docs.keys()].some(key=>
   key.startsWith('dog_christmas_villages_v1/')||key.startsWith('dog_christmas_scratch_v1/')),false,
  'normal first-match exchange never credits seasonal balances');
 // An ongoing room created before this fix must stop seasonal credits
 // on its next verified move, with a single persisted eligibility decision.
 room=h.docs.get(key);
 delete room.match.dogChristmasEligibilityChecked;
 room.match.christmas={enabled:true};
 h.docs.set(key,room);
 const bob=h.docs.get(key).match.dog.hands[1][0];
 const recovered=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','bob',{
  matchId:room.match.id,expectedRevision:room.match.dog.revision,
  actionId:'first-standard-dog-old-room-002',action:{type:'exchange',cardId:bob.id}
 });
 assert.equal(recovered.status,200,recovered.error);
 assert.equal(h.docs.get(key).match.christmas?.enabled===true,false);
 assert.equal(h.docs.get(key).match.dogChristmasEligibilityChecked,true);
 assert.equal([...h.docs.keys()].some(key=>
   key.startsWith('dog_christmas_villages_v1/')||key.startsWith('dog_christmas_scratch_v1/')),false);
});

test('DOG Christmas rewards become available on a later match only after every player finished their initial game',async()=>{
 const h=harness({christmasEventActive:()=>true});
 const verifiedTime=Date.parse('2026-11-21T15:00:00Z');
 h.advance(verifiedTime);
 for(const uid of ['user_alice123','user_bobby123','user_carol123'])
  h.docs.set('dog_player_statistics_v1/'+uid,{uid,played:1,updatedAt:verifiedTime});
 const code=(await h.api('POST','/api/hub/rooms','alice')).room.code;
 for(const who of ['bob','cara'])await h.api('POST','/api/hub/rooms/'+code+'/join',who);
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'});
 for(const who of ['alice','bob','cara']){
  const ready=await h.api('POST','/api/hub/rooms/'+code+'/ready',who,{ready:true});
  assert.equal(ready.status,200,ready.error);
 }
 const room=h.docs.get('spielesammlung_hub_v1/'+code);
 assert.equal(room.match.dogChristmasEligibilityChecked,true);
 assert.equal(room.match.christmas.enabled,true,
  'subsequent verified matches keep all existing Christmas rewards');
});


test('DOG host can choose 0, 1, or 2 computer opponents for two real online players',async()=>{
 for(const botCount of [0,1,2]){
  const h=harness(),code=(await h.api('POST','/api/hub/rooms','alice')).room.code;
  await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
  await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'});
  const set=await h.api('POST','/api/hub/rooms/'+code+'/dog/bots','alice',{botCount});
  assert.equal(set.status,200);
  assert.equal(set.room.settings.botCount,botCount);
  assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true})).room.phase,'preparing');
  const launched=await h.api('POST','/api/hub/rooms/'+code+'/ready','bob',{ready:true});
  assert.equal(launched.status,200);
  assert.equal(launched.room.phase,'playing');
  const state=launched.room.match.dog;
  assert.equal(launched.room.match.settings.botCount,botCount);
  assert.equal(state.players.filter(p=>p.bot).length,botCount);
  assert.equal(state.players.filter(p=>p.inactive).length,2-botCount);
  assert.equal(state.pieces.length,4*(2+botCount));
  assert.equal(state.mode,botCount===2?'teams4':botCount===1?'solo3':'solo2');
  for(const p of state.players.filter(p=>p.inactive)){
   assert.equal(state.hands[p.seat].count,0);
   assert.equal(state.exchanges[p.seat],true);
  }
  assert.deepEqual(state.players.filter(p=>!p.bot&&!p.inactive).map(p=>p.name),['Alice','Bob']);
  const bob=(await h.api('GET','/api/hub/rooms/'+code,'bob')).room;
  assert.equal(bob.match.dogSeat,1,'second real player has a verified private seat');
 }
});
test('DOG bot choice is host-only, validated, idempotent and resets all readiness',async()=>{
 const h=harness(),code=(await h.api('POST','/api/hub/rooms','alice')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'});
 const endpoint='/api/hub/rooms/'+code+'/dog/bots';
 assert.equal((await h.api('POST',endpoint,'bob',{botCount:0})).status,403);
 for(const botCount of [-1,3,0.5,'1',null])assert.equal((await h.api('POST',endpoint,'alice',{botCount})).status,400);
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const updated=await h.api('POST',endpoint,'alice',{botCount:0});
 assert.equal(updated.room.players.find(p=>p.me).ready,false,'host readiness reset');
 assert.equal(updated.room.players.find(p=>!p.me).ready,false,'peer readiness reset');
 const repeated=await h.api('POST',endpoint,'alice',{botCount:0});
 assert.equal(repeated.room.revision,updated.room.revision,'repeat bot choice is a Firestore no-op');
});

test('DOG scratch administration is restricted to authenticated allowlisted UIDs',async()=>{
 const h=harness({scratchAdminUids:'user_alice123',christmasEventActive:()=>true});
 const regular=await h.api('GET','/api/hub/scratch','bob');
 const owner=await h.api('GET','/api/hub/scratch','alice');
 assert.equal(regular.status,200,regular.error);
 assert.equal(regular.canManageScratch,false);
 assert.equal(owner.status,200,owner.error);
 assert.equal(owner.canManageScratch,true);
 const routes=[
  '/api/hub/scratch/settings',
  '/api/hub/scratch/settings/gifts',
  '/api/hub/scratch/editions/gifts',
  '/api/hub/scratch/settings/snow_collect',
  '/api/hub/scratch/editions/snow_collect',
  '/api/hub/scratch/editions/gifts/edit',
  '/api/hub/scratch/editions/snow_collect/edit'
 ];
 const before=h.docs.size;
 for(const route of routes){
  const forbidden=await h.api('POST',route,'bob',{});
  assert.equal(forbidden.status,403,route+': '+forbidden.error);
  assert.equal(forbidden.error,'SCRATCH_ADMIN_ONLY');
 }
 assert.equal(h.docs.size,before,'unauthorized writes must never create Firestore documents');
 const invalidAdmin=await h.api('POST','/api/hub/scratch/settings','alice',{settings:null});
 assert.equal(invalidAdmin.status,400,'a real admin passes authorization and reaches request validation');
});
test('DOG scratch administration fails closed when no verified UID list is configured',async()=>{
 const h=harness({christmasEventActive:()=>true});
 assert.equal((await h.api('GET','/api/hub/scratch','alice')).canManageScratch,false);
 assert.equal((await h.api('POST','/api/hub/scratch/settings','alice',{settings:{}})).status,403);
});


test('earned DOG portraits, nameframes and turn icons require server-owned rewards',async()=>{
 const h=harness(),code=(await h.api('POST','/api/hub/rooms','alice')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'});
 const owner='dog_christmas_scratch_wallet_v1/user_alice123';
 h.docs.set(owner,{coins:1000,owned:{
  'christmas2026:avatar:01':1100,
  'christmas2026:nameframe:01':1100,
  'christmas2026:activeicon:02':1100
 }});
 const avatar='/api/hub/rooms/'+code+'/dog/avatar';
 const cosmetic='/api/hub/rooms/'+code+'/dog/cosmetic';
 assert.equal((await h.api('POST',avatar,'bob',{avatar:16})).status,403,'another player cannot take the event portrait');
 assert.equal((await h.api('POST',avatar,'alice',{avatar:17})).status,403,'another unowned avatar is rejected');
 const changedAvatar=await h.api('POST',avatar,'alice',{avatar:16});
 assert.equal(changedAvatar.status,200,changedAvatar.error);
 assert.equal(changedAvatar.room.players.find(p=>p.me).dogAvatar,16);
 assert.equal((await h.api('POST',cosmetic,'bob',{kind:'nameFrame',unlockId:'christmas2026:nameframe:01'})).status,403);
 assert.equal((await h.api('POST',cosmetic,'alice',{kind:'nameFrame',unlockId:'christmas2026:nameframe:04'})).status,403);
 const frame=await h.api('POST',cosmetic,'alice',{kind:'nameFrame',unlockId:'christmas2026:nameframe:01'});
 assert.equal(frame.status,200,frame.error);
 assert.equal(frame.room.players.find(p=>p.me).dogNameFrame,'christmas2026:nameframe:01');
 const emblem=await h.api('POST',cosmetic,'alice',{kind:'activeIcon',unlockId:'christmas2026:activeicon:02'});
 assert.equal(emblem.status,200,emblem.error);
 const copy=await h.api('POST',cosmetic,'alice',{kind:'activeIcon',unlockId:'christmas2026:activeicon:02'});
 assert.equal(copy.room.revision,emblem.room.revision,'repeated equipment is an atomic no-op');
 assert.equal((await h.api('POST',cosmetic,'alice',{kind:'activeIcon',unlockId:'evil'})).status,400);
 const other=(await h.api('GET','/api/hub/rooms/'+code,'bob')).room;
 const alice=other.players.find(p=>p.name==='Alice');
 assert.equal(alice.dogAvatar,16,'another real player sees the earned picture');
 assert.equal(alice.dogNameFrame,'christmas2026:nameframe:01');
 assert.equal(alice.dogActiveIcon,'christmas2026:activeicon:02');
 const reset=await h.api('POST',cosmetic,'alice',{kind:'nameFrame',unlockId:null});
 assert.equal(reset.status,200,'a user can return to the default frame');
 assert.equal(reset.room.players.find(p=>p.me).dogNameFrame,null);
 const freshAvatar=await h.api('POST',avatar,'bob',{avatar:2});
 assert.equal(freshAvatar.status,200,'all classic portraits remain free');
});
test('earned DOG cosmetics appear in the authorized match snapshot without exposing private wallets',async()=>{
 const h=harness(),code=(await h.api('POST','/api/hub/rooms','alice')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'});
 h.docs.set('dog_christmas_scratch_wallet_v1/user_alice123',{owned:{
  'christmas2026:activeicon:01':1000,
  'christmas2026:nameframe:02':1000
 }});
 const endpoint='/api/hub/rooms/'+code+'/dog/cosmetic';
 await h.api('POST',endpoint,'alice',{kind:'nameFrame',unlockId:'christmas2026:nameframe:02'});
 await h.api('POST',endpoint,'alice',{kind:'activeIcon',unlockId:'christmas2026:activeicon:01'});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const started=await h.api('POST','/api/hub/rooms/'+code+'/ready','bob',{ready:true});
 assert.equal(started.status,200,started.error);
 assert.equal(started.room.phase,'playing');
 assert.equal(started.room.match.dogCosmetics[0].nameFrame,'christmas2026:nameframe:02');
 assert.equal(started.room.match.dogCosmetics[0].activeIcon,'christmas2026:activeicon:01');
 assert.equal(started.room.match.dogCosmetics[1].nameFrame,null);
 assert.equal(started.room.match.dogCosmetics[2],null,'bot never gets human-owned cosmetics');
 assert.equal(started.room.match.dog.ownedUnlockIds,undefined,'wallets are never embedded in game state');
});


test('Christmas economy mutations require the same verified game-history or explicit grant',async()=>{
 const h=harness({christmasEventActive:()=>true});
 const uid='user_alice123';
 const purchase='/api/hub/scratch/buy';
 const body={tier:'simple',variantId:'gifts',commandId:'verified-scratch-00001'};
 const denied=await h.api('POST',purchase,'alice',body);
 assert.equal(denied.status,403,denied.error);
 assert.equal(denied.error,'DOG_CHRISTMAS_EVENT_LOCKED');
 assert.equal(h.docs.has('dog_christmas_scratch_wallet_v1/'+uid),false,
  'failed access must not create a wallet or mint prizes');
 const village=await h.api('POST','/api/hub/christmas-village/upgrade','alice',{
  building:'academy',expectedLevel:1,commandId:'verified-upgrade-00001'});
 assert.equal(village.status,403,village.error);
 assert.equal(village.error,'DOG_CHRISTMAS_EVENT_LOCKED');
 const tree=await h.api('POST','/api/hub/christmas-tree-rewards/claim','alice',{level:1});
 assert.equal(tree.status,403,tree.error);
 assert.equal(tree.error,'DOG_CHRISTMAS_EVENT_LOCKED');
 const research=await h.api('POST','/api/hub/dog/research/upgrade','alice',{id:'discount'});
 assert.equal(research.status,403,research.error);
 assert.equal(research.error,'DOG_CHRISTMAS_EVENT_LOCKED');
 // A server-created explicit grant from the founder-reset is authoritative,
 // not a nickname submitted in the request.
 h.docs.set('dog_christmas_event_access_v1/'+uid,{access:true,resetId:'verified-test'});
 const admitted=await h.api('POST',purchase,'alice',body);
 assert.equal(admitted.status,200,admitted.error);
 assert.equal(h.docs.has('dog_christmas_scratch_wallet_v1/'+uid),true);
 const replay=await h.api('POST',purchase,'alice',body);
 assert.equal(replay.status,200,replay.error);
 assert.equal(replay.replayed,true,'retry must not mint another ticket');
});
test('a signed-in player can qualify by a verified post-season DOG match, without a founder grant',async()=>{
 const h=harness({christmasEventActive:()=>true});
 const time=Date.parse('2026-11-22T12:00:00Z');
 h.docs.set('dog_player_statistics_v1/user_alice123',{played:1,updatedAt:time});
 const purchase=await h.api('POST','/api/hub/scratch/buy','alice',{
  tier:'simple',variantId:'gifts',commandId:'after-first-match-0001'});
 assert.equal(purchase.status,200,purchase.error);
});
