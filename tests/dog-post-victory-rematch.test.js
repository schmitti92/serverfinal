import test from 'node:test';
import assert from 'node:assert/strict';
import { installSharedLobby } from '../shared-lobby.js';

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


test('DOG victory leaves a finished result until host prepares the next round',async()=>{
 const h=harness({christmasEventActive:()=>false});
 const first=await h.api('POST','/api/hub/rooms'),code=first.room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const started=await h.api('POST','/api/hub/rooms/'+code+'/ready','bob',{ready:true});
 assert.equal(started.status,200);
 assert.equal(started.room.phase,'playing');
 assert.equal(started.room.match.game,'dog');
 const matchId=started.room.match.id;
 const route='/api/hub/rooms/'+code+'/dog/rematch';
 assert.equal((await h.api('POST',route,'alice',{matchId})).status,409,
  'cannot restart before four figures finished');
 const key='spielesammlung_hub_v1/'+code;
 const saved=h.docs.get(key);
 saved.players[0].colorPref='blue';
 saved.players[1].colorPref='red';
 saved.match.dog.phase='finished';
 saved.match.dog.winnerSeat=0;
 saved.match.dog.winner=0;
 h.docs.set(key,structuredClone(saved));
 assert.equal((await h.api('POST',route,'bob',{matchId})).status,403,
  'only host prepares new match');
 assert.equal((await h.api('POST',route,'alice',{matchId:'11111111-1111-4111-8111-111111111111'})).status,409,
  'different match id cannot archive the match');
 const rematch=await h.api('POST',route,'alice',{matchId});
 assert.equal(rematch.status,200);
 assert.equal(rematch.room.phase,'preparing');
 assert.equal(rematch.room.game,'dog');
 assert.equal(rematch.room.match,null,'old match can no longer be moved');
 assert.deepEqual(rematch.room.players.map(p=>p.ready),[false,false]);
 assert.deepEqual(rematch.room.players.map(p=>p.participating),[true,true]);
 assert.deepEqual(rematch.room.players.map(p=>p.colorPref),['blue','red']);
 assert.equal(rematch.room.lastCompleted.id,matchId);
 assert.equal(rematch.room.lastCompleted.game,'dog');
 const revision=rematch.room.revision;
 const retried=await h.api('POST',route,'alice',{matchId});
 assert.equal(retried.status,200);
 assert.equal(retried.room.revision,revision,'lost ack retry must not write another room');
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const next=await h.api('POST','/api/hub/rooms/'+code+'/ready','bob',{ready:true});
 assert.equal(next.status,200);
 assert.equal(next.room.phase,'playing');
 assert.equal(next.room.match.game,'dog');
 assert.notEqual(next.room.match.id,matchId,'new round gets a fresh id');
 assert.equal(next.room.code,code,'same shared lobby code');
});

test('DOG next-round endpoint rejects malformed IDs and inactive rooms without writes',async()=>{
 const h=harness({christmasEventActive:()=>false});
 const room=(await h.api('POST','/api/hub/rooms')).room;
 const endpoint='/api/hub/rooms/'+room.code+'/dog/rematch';
 assert.equal((await h.api('POST',endpoint,'alice',{matchId:'invalid'})).status,400);
 assert.equal((await h.api('POST',endpoint,'alice',{matchId:'11111111-1111-4111-8111-111111111111'})).status,409);
 const latest=await h.api('GET','/api/hub/rooms/'+room.code,'alice');
 assert.equal(latest.room.phase,'lobby');
 assert.equal(latest.room.lastCompleted,null);
});
