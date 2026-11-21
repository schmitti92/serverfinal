import test from 'node:test';
import assert from 'node:assert/strict';
import {installSharedLobby} from '../shared-lobby.js';

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

test('DOG three distinct online profiles share one authoritative match with a fourth server bot',async()=>{
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
 assert.deepEqual(launched.room.match.dog.players.map(p=>p.bot),[false,false,false,true]);
 assert.equal(launched.room.match.dog.phase,'exchange');
 assert.equal(launched.room.match.dog.exchanges[3],true,'only the missing seat has a server-selected exchange');

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
    assert.equal(Array.isArray(state.match.dog.hands[other]),false,'opponent and bot hands are never exposed');
    assert.equal(state.match.dog.hands[other].count,other===3?5:6,'server bot has already set aside its private exchange card');
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
 assert.equal(final.match.dog.phase,'play','three real exchanges and one server bot complete the phase');
 assert.equal(final.match.dog.players.filter(p=>p.bot).length,1);
 assert.equal(final.match.id,matchId);
});
