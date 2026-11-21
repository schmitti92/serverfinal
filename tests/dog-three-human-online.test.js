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
 adapter=installSharedLobby(app,{verifyProfile:options.verifyProfile|| (async token=>identities[token]||null),getFirestore:()=>store,clock:()=>now,codeGenerator:()=>`ABC23${['D','E','F'][id++%3]}`,isMatchFinished:async()=>finished,challengeRandomInt:options.challengeRandomInt,christmasEventActive:options.christmasEventActive,bootstrapSkyjo:async seat=>{skyjoBootstraps++;return {ok:true,rev:1,state:{kind:'skyjo-room-v2',version:2,lobby:{players:seat.members.map(p=>({id:'hub_'+p.uid,name:p.name})),hostId:'hub_'+seat.hostUid,settings:seat.settings,status:'lobby'},game:null}};}});
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
 assert.equal(room.match.christmas?.enabled,false,'the first completed game is the prerequisite for the event');
 assert.equal([...h.docs.keys()].some(key=>key.startsWith('dog_christmas_villages_v1/')),false);
 const first=room.match.dog.hands[0][0];
 const exchange=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','alice',{
  matchId:room.match.id,expectedRevision:room.match.dog.revision,
  actionId:'first-standard-dog-exchange-001',action:{type:'exchange',cardId:first.id}
 });
 assert.equal(exchange.status,200,exchange.error);
 assert.equal(h.docs.get(key).match.christmas.enabled,false);
 assert.equal([...h.docs.keys()].some(key=>
   key.startsWith('dog_christmas_villages_v1/')||key.startsWith('dog_christmas_scratch_v1/')),false,
  'normal first-match exchange never credits seasonal balances');
 // An ongoing room created before this fix must stop seasonal credits
 // on its next verified move, with a single persisted eligibility decision.
 room=h.docs.get(key);
 delete room.match.dogChristmasEligibilityChecked;
 room.match.christmas.enabled=true;
 h.docs.set(key,room);
 const bob=h.docs.get(key).match.dog.hands[1][0];
 const recovered=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','bob',{
  matchId:room.match.id,expectedRevision:room.match.dog.revision,
  actionId:'first-standard-dog-old-room-002',action:{type:'exchange',cardId:bob.id}
 });
 assert.equal(recovered.status,200,recovered.error);
 assert.equal(h.docs.get(key).match.christmas.enabled,false);
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
