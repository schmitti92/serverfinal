import test from 'node:test';
import assert from 'node:assert/strict';
import { installSharedLobby } from '../shared-lobby.js';
import {packEditionTickets,unpackEditionTickets} from '../dog/christmas-scratch-editions.js';

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

test('Room create, verified membership, host powers and ready reset',async()=>{
 const h=harness(),created=await h.api('POST','/api/hub/rooms');
 assert.equal(created.status,200);const code=created.room.code;assert.equal(code,'ABC23D');assert.equal(created.room.host,true);
 assert.equal((await h.api('GET',`/api/hub/rooms/${code}`,'bob')).status,403);
 const joined=await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');assert.equal(joined.room.players.length,2);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/select`,'bob',{game:'business'})).status,403);
 const selected=await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'business'});assert.equal(selected.room.game,'business');
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 const ready=await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true});
 assert.equal(ready.room.canLaunch,true);
 assert.equal(ready.room.phase,'playing');
 assert.equal(ready.room.match.game,'business');
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/start`,'alice')).status,409);
 h.setFinished(true);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/finish`,'alice')).status,200);
 const reselection=await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'barikade'});
 assert.deepEqual(reselection.room.players.map(p=>p.ready),[false,false]);
 const leave=await h.api('POST',`/api/hub/rooms/${code}/leave`,'alice');assert.equal(leave.left,true);
 const host=await h.api('GET',`/api/hub/rooms/${code}`,'bob');assert.equal(host.room.host,true);
 const final=await h.api('POST',`/api/hub/rooms/${code}/leave`,'bob');assert.equal(final.roomDeleted,true);
 assert.equal((await h.api('GET',`/api/hub/rooms/${code}`,'bob')).status,404);
});
test('Strict authentication and no accounts can modify other rooms',async()=>{
 const h=harness();assert.equal((await h.api('POST','/api/hub/rooms','stranger')).status,401);
 const {room}=await h.api('POST','/api/hub/rooms');
 assert.equal((await h.api('POST',`/api/hub/rooms/${room.code}/ready`,'bob',{ready:true})).status,403);
 assert.equal((await h.api('POST',`/api/hub/rooms/${room.code}/select`,'alice',{game:'nope'})).status,400);
});
test('Concurrent joins do not duplicate a seat or overbook game capacity',async()=>{
 const h=harness();const {room}=await h.api('POST','/api/hub/rooms');
 const code=room.code;
 await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'skyjo'});
 const [a,b,c]=await Promise.all([
  h.api('POST',`/api/hub/rooms/${code}/join`,'bob'),
  h.api('POST',`/api/hub/rooms/${code}/join`,'bob'),
  h.api('POST',`/api/hub/rooms/${code}/join`,'cara')
 ]);
 assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(c.status,200);
 assert.equal((await h.api('GET',`/api/hub/rooms/${code}`)).room.players.length,3);
 h.identities.eric={uid:'user_eric123',name:'Eric'};
 h.identities.fred={uid:'user_fred123',name:'Fred'};
 h.identities.dave={uid:'user_david123',name:'Dave'};
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/join`,'eric')).status,200);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/join`,'fred')).status,200);
 const spectator=await h.api('POST',`/api/hub/rooms/${code}/join`,'dave');
 assert.equal(spectator.status,200);assert.equal(spectator.room.players.length,6);
 assert.equal(spectator.room.players.find(p=>p.me).participating,false);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/ready`,'dave',{ready:true})).status,403);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/seats`,'bob',{seat:spectator.room.players[5].seat,participating:true})).status,403);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/seats`,'alice',{seat:spectator.room.players[5].seat,participating:true})).status,409);
 const changed=await h.api('POST',`/api/hub/rooms/${code}/seats`,'alice',{seat:spectator.room.players[2].seat,participating:false});
 assert.equal(changed.room.players[2].participating,false);
 const promoted=await h.api('POST',`/api/hub/rooms/${code}/seats`,'alice',{seat:spectator.room.players[5].seat,participating:true});
 assert.equal(promoted.room.players[5].participating,true);
 h.identities.gina={uid:'user_gina123',name:'Gina'};
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/join`,'gina')).status,409);
});
test('Room expires and duplicate creation codes are retried',async()=>{
 const h=harness();const one=await h.api('POST','/api/hub/rooms');const two=await h.api('POST','/api/hub/rooms');
 assert.notEqual(one.room.code,two.room.code);
 h.advance(25*3600*1000);
 assert.equal((await h.api('GET',`/api/hub/rooms/${one.room.code}`)).status,404);
});


test('Barikade starts once automatically after all selected players become ready',async()=>{
 const h=harness(),{room}=await h.api('POST','/api/hub/rooms'),code=room.code;
 await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');
 const selected=await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'barikade'});
 assert.equal(selected.room.maxPlayers,4);
 assert.equal(selected.room.canLaunch,true);
 const one=await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 assert.equal(one.room.phase,'preparing');
 const last=await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true});
 assert.equal(last.room.phase,'playing');
 assert.match(last.room.match.gameCode,/^B[A-HJ-NP-Z2-9]{9}$/);
 assert.equal(last.room.match.playerCount,2);
 assert.equal(last.room.match.myColor,'blue');
 const alice=await h.api('GET',`/api/hub/rooms/${code}`,'alice');
 assert.equal(alice.room.match.myColor,'red');
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true})).status,409);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'skyjo'})).status,409);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/join`,'bob')).status,200); // authenticated reconnect
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/join`,'cara')).status,409); // outsider
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/leave`,'alice')).status,409);
 assert.equal((await h.api('GET',`/api/hub/rooms/${code}`)).room.match.id,alice.room.match.id);
});

test('Hub Barikade seat verification rejects outsiders and fixes host/color',async()=>{
 const h=harness(),{room}=await h.api('POST','/api/hub/rooms'),code=room.code;
 await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');
 await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'barikade'});
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 const {room:running}=await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true});
 const match=running.match.gameCode;
 assert.equal((await h.adapter.barikadeSeat(match,h.identities.alice)).host,true);
 assert.equal((await h.adapter.barikadeSeat(match,h.identities.alice)).color,'red');
 assert.equal((await h.adapter.barikadeSeat(match,h.identities.bob)).color,'blue');
 assert.equal((await h.adapter.barikadeSeat(match,h.identities.bob)).expectedPlayers,2);
 assert.equal((await h.adapter.barikadeSeat(match,h.identities.cara)).error,'NOT_A_PARTICIPANT');
 assert.equal((await h.adapter.barikadeSeat(match,null)).error,'LOGIN_REQUIRED');
 assert.equal((await h.adapter.barikadeSeat('OTHER123',null)).legacy,true);
 assert.equal((await h.adapter.barikadeSeat('B'+code+'ZZZ',h.identities.alice)).error,'MATCH_NOT_FOUND');
});

test('After verified finish, next Barikade match uses a new internal code but same hub',async()=>{
 const h=harness(),{room}=await h.api('POST','/api/hub/rooms'),code=room.code;
 await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');
 await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'barikade'});
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 const first=(await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true})).room.match;
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/finish`,'bob')).status,403);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/finish`,'alice')).status,409);
 h.setFinished(true);
 const done=await h.api('POST',`/api/hub/rooms/${code}/finish`,'alice');
 assert.equal(done.status,200);assert.equal(done.room.phase,'lobby');assert.equal(done.room.match,null);
 assert.equal((await h.adapter.barikadeSeat(first.gameCode,h.identities.alice)).error,'MATCH_NOT_FOUND');
 h.setFinished(false);
 await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'barikade'});
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 const second=(await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true})).room.match;
 assert.notEqual(second.id,first.id);assert.notEqual(second.gameCode,first.gameCode);
 assert.equal(second.gameCode.slice(1,7),code);
});

test('Up to six members can stay in hub while only four play Barikade',async()=>{
 const h=harness(),{room}=await h.api('POST','/api/hub/rooms'),code=room.code;
 for(const name of ['bob','cara','dave','eric','fred']){
  if(!h.identities[name])h.identities[name]={uid:'user_'+name,name};
  assert.equal((await h.api('POST',`/api/hub/rooms/${code}/join`,name)).status,200);
 }
 const selection=await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'barikade'});
 assert.equal(selection.room.players.length,6);
 assert.equal(selection.room.players.filter(p=>p.participating).length,4);
 assert.equal(selection.room.players.filter(p=>!p.participating).length,2);
 const host=selection.room.players.find(p=>p.host);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/seats`,'alice',{seat:host.seat,participating:false})).status,409);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/ready`,'eric',{ready:true})).status,403);
});


test('Realtime websocket sends only authorized Firestore room updates',async()=>{
 const h=harness(),created=await h.api('POST','/api/hub/rooms'),code=created.room.code;
 await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');
 const sockets=[];
 function fakeSocket(){
  const handlers=new Map(),received=[];
  const socket={readyState:1,received,on(type,cb){handlers.set(type,cb);},
   send(data){received.push(JSON.parse(data));},close(){this.readyState=3;handlers.get('close')?.();},
   sendMessage(msg){return handlers.get('message')(Buffer.from(JSON.stringify(msg)));}};
  h.adapter.attachSocket(socket);sockets.push(socket);return socket;
 }
 const alice=fakeSocket(),bob=fakeSocket(),outsider=fakeSocket();
 await Promise.all([
  alice.sendMessage({type:'subscribe',code,profileIdToken:'alice'}),
  bob.sendMessage({type:'subscribe',code,profileIdToken:'bob'}),
  outsider.sendMessage({type:'subscribe',code,profileIdToken:'cara'})
 ]);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(alice.received.find(x=>x.type==='room').room.host,true);
 assert.equal(bob.received.find(x=>x.type==='room').room.host,false);
 assert.equal(outsider.received.some(x=>x.type==='room'),false);
 assert.equal(outsider.readyState,3);
 await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'barikade'});
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(alice.received.filter(x=>x.type==='room').at(-1).room.phase,'playing');
 assert.equal(bob.received.filter(x=>x.type==='room').at(-1).room.match.myColor,'blue');
 assert.equal(alice.received.filter(x=>x.type==='room').at(-1).room.match.myColor,'red');
 alice.close();bob.close();
});

test('Only host can choose Action/Boss modes and rules are snapshotted at launch',async()=>{
 const h=harness(),{room}=await h.api('POST','/api/hub/rooms'),code=room.code;
 await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');
 await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'barikade'});
 const settings={mode:'action',bossMode:true,boardTheme:'stone',jokerStartCount:5,eventFieldCount:15,bossEventTrigger:7,colorMode:'manual'};
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/settings`,'bob',{settings})).status,403);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/settings`,'alice',{settings:{...settings, jokerStartCount:12}})).status,400);
 const selected=await h.api('POST',`/api/hub/rooms/${code}/settings`,'alice',{settings});
 assert.deepEqual(selected.room.settings,settings);
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 const game=await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true});
 assert.equal(game.room.phase,'playing');
 assert.deepEqual(game.room.match.settings,settings);
 assert.equal((await h.adapter.barikadeSeat(game.room.match.gameCode,h.identities.alice)).settings.bossMode,true);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/settings`,'alice',{settings})).status,409);
});

test('Color reservations are exclusive, and spectators cannot pick a color',async()=>{
 const h=harness(),{room}=await h.api('POST','/api/hub/rooms'),code=room.code;
 await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');
 await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'barikade'});
 const red=await h.api('POST',`/api/hub/rooms/${code}/color`,'alice',{color:'red'});
 assert.equal(red.room.players.find(p=>p.me).colorPref,'red');
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/color`,'bob',{color:'red'})).status,409);
 const blue=await h.api('POST',`/api/hub/rooms/${code}/color`,'bob',{color:'blue'});
 assert.equal(blue.room.players.find(p=>p.me).colorPref,'blue');
 const selected=(await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true})).room;
 const running=(await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true})).room;
 assert.equal((await h.adapter.barikadeSeat(running.match.gameCode,h.identities.alice)).color,'red');
 assert.equal((await h.adapter.barikadeSeat(running.match.gameCode,h.identities.bob)).color,'blue');
 assert.equal(selected.allReady,false);
});

test('Wheel color mode creates distinct server-assigned colors and disables manual choices',async()=>{
 const h=harness(),{room}=await h.api('POST','/api/hub/rooms'),code=room.code;
 await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');
 await h.api('POST',`/api/hub/rooms/${code}/join`,'cara');
 let selected=(await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'barikade'})).room;
 const settings={...selected.settings,colorMode:'wheel'};
 await h.api('POST',`/api/hub/rooms/${code}/settings`,'alice',{settings});
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/color`,'bob',{color:'blue'})).status,409);
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true});
 const running=(await h.api('POST',`/api/hub/rooms/${code}/ready`,'cara',{ready:true})).room;
 assert.equal(running.match.playerCount,3);
 const colors=await Promise.all(['alice','bob','cara'].map(u=>h.adapter.barikadeSeat(running.match.gameCode,h.identities[u])));
 assert.equal(new Set(colors.map(x=>x.color)).size,3);
});

test('Changing host settings invalidates previously accepted ready votes',async()=>{
 const h=harness(),{room}=await h.api('POST','/api/hub/rooms'),code=room.code;
 await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');
 const selected=(await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'barikade'})).room;
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 const settings={...selected.settings,mode:'action',jokerStartCount:4,unknownIgnored:'anything'};
 const changed=(await h.api('POST',`/api/hub/rooms/${code}/settings`,'alice',{settings})).room;
 assert.deepEqual(changed.players.map(p=>p.ready),[false,false]);
 assert.equal(Object.hasOwn(changed.settings,'unknownIgnored'),false);
 const bob=(await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true})).room;
 assert.equal(bob.phase,'preparing');
 assert.equal(bob.allReady,false);
 const last=(await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true})).room;
 assert.equal(last.phase,'playing');
 assert.equal(last.match.settings.mode,'action');
 assert.equal(last.match.settings.jokerStartCount,4);
});

test('Concurrent identical color requests and ready votes cannot double-book/start',async()=>{
 const h=harness(),{room}=await h.api('POST','/api/hub/rooms'),code=room.code;
 await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');
 await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'barikade'});
 const colors=await Promise.all([
  h.api('POST',`/api/hub/rooms/${code}/color`,'alice',{color:'red'}),
  h.api('POST',`/api/hub/rooms/${code}/color`,'bob',{color:'red'})
 ]);
 assert.deepEqual(colors.map(x=>x.status).sort((a,b)=>a-b),[200,409]);
 const res=await Promise.all([
  h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true}),
  h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true})
 ]);
 assert.equal(res.filter(x=>x.room.phase==='playing').length,1);
 assert.equal((await h.api('GET',`/api/hub/rooms/${code}`)).room.phase,'playing');
});

test('KreuzKunter starts automatically under the same hub and cannot be joined by outsiders',async()=>{
 const h=harness(),{room}=await h.api('POST','/api/hub/rooms'),code=room.code;
 await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');
 const selected=await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'kreuz'});
 assert.equal(selected.room.canLaunch,true);
 assert.equal(selected.room.maxPlayers,6);
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 const started=await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true});
 assert.equal(started.room.phase,'playing');
 assert.match(started.room.match.gameCode,/^K[A-HJ-NP-Z2-9]{9}$/);
 assert.equal(started.room.match.gameCode.slice(1,7),code);
 assert.equal(started.room.match.playerCount,2);
 const alice=await h.adapter.kreuzSeat(started.room.match.gameCode,h.identities.alice);
 assert.equal(alice.hubCode,code);
 assert.equal(alice.hostUid,h.identities.alice.uid);
 assert.equal(alice.matchId,started.room.match.id);
 assert.equal(alice.members.length,2);
 assert.equal((await h.adapter.kreuzSeat(started.room.match.gameCode,h.identities.cara)).error,'NOT_A_MEMBER');
 assert.equal((await h.adapter.kreuzSeat(started.room.match.gameCode,null)).error,'LOGIN_REQUIRED');
 assert.equal((await h.adapter.kreuzSeat('K'+code+'ZZZ',h.identities.alice)).error,'MATCH_NOT_FOUND');
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/start`,'alice')).status,409);
 h.setFinished(true);
 const done=await h.api('POST',`/api/hub/rooms/${code}/finish`,'alice');
 assert.equal(done.room.phase,'lobby');
 assert.equal((await h.adapter.kreuzSeat(started.room.match.gameCode,h.identities.alice)).error,'MATCH_NOT_FOUND');
 await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'kreuz'});
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 const again=await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true});
 assert.notEqual(again.room.match.id,started.room.match.id);
 assert.notEqual(again.room.match.gameCode,started.room.match.gameCode);
 assert.equal(again.room.code,code);
});

test('SKYJO creates one hub match with settings, seat authentication, and no second room code',async()=>{
 const h=harness(),{room}=await h.api('POST','/api/hub/rooms'),code=room.code;
 await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');
 await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'skyjo'});
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/skyjo-settings`,'bob',{settings:{target:150}})).status,403);
 const settings={target:150,beginner:false,jokerCount:12,jokerEnabled:true,streetModeEnabled:true,boardTheme:'classic'};
 const updated=await h.api('POST',`/api/hub/rooms/${code}/skyjo-settings`,'alice',{settings});
 assert.equal(updated.room.settings.target,150);
 const pending=await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 assert.equal(pending.room.phase,'preparing');
 const {room:active}=await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true});
 assert.equal(active.phase,'playing');assert.equal(active.canLaunch,true);
 assert.match(active.match.gameCode,/^S[A-HJ-NP-Z2-9]{9}$/);
 assert.equal(active.match.gameCode.slice(1,7),code);
 const alice=await h.adapter.skyjoSeat(active.match.gameCode,h.identities.alice);
 assert.equal(alice.host,true);assert.equal(alice.hostUid,h.identities.alice.uid);
 assert.deepEqual(alice.settings,{...settings,layoutMode:'classic',toreSpecialEnabled:false});assert.equal(alice.members.length,2);
 assert.equal((await h.adapter.skyjoSeat(active.match.gameCode,h.identities.cara)).error,'NOT_A_PARTICIPANT');
 assert.equal((await h.adapter.skyjoSeat(active.match.gameCode,null)).error,'LOGIN_REQUIRED');
 const boot=await h.api('POST',`/api/hub/rooms/${code}/skyjo-bootstrap`,'bob',{matchId:active.match.id});
 assert.equal(boot.status,200);assert.equal(boot.seatId,'hub_'+h.identities.bob.uid);
 assert.equal(boot.roomState.lobby.hostId,'hub_'+h.identities.alice.uid);
 assert.equal(h.bootstraps(),1);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/skyjo-bootstrap`,'cara',{matchId:active.match.id})).status,403);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/skyjo-bootstrap`,'bob',{matchId:'old'})).status,409);
 h.setFinished(true);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/finish`,'alice')).room.phase,'lobby');
 await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'skyjo'});
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 const again=await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true});
 assert.notEqual(again.room.match.gameCode,active.match.gameCode);
 assert.equal(again.room.code,code);
});

test('SKYJO spectator cannot open or bootstrap a hub match',async()=>{
 const h=harness(),{room}=await h.api('POST','/api/hub/rooms'),code=room.code;
 await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');
 await h.api('POST',`/api/hub/rooms/${code}/join`,'cara');
 await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'skyjo'});
 const seat=(await h.api('GET',`/api/hub/rooms/${code}`)).room.players[2].seat;
 await h.api('POST',`/api/hub/rooms/${code}/seats`,'alice',{seat,participating:false});
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 const start=await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true});
 assert.equal((await h.adapter.skyjoSeat(start.room.match.gameCode,h.identities.cara)).error,'NOT_A_PARTICIPANT');
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/skyjo-bootstrap`,'cara',{matchId:start.room.match.id})).status,403);
});


test('Verified hub sync automatically completes one match, preserving room and users',async()=>{
 const h=harness(),created=await h.api('POST','/api/hub/rooms'),code=created.room.code;
 await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');
 await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'business'});
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 const started=(await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true})).room;
 const matchId=started.match.id;
 const path=`/api/hub/rooms/${code}/sync`;
 assert.equal((await h.api('POST',path,'cara',{matchId})).status,403);
 assert.equal((await h.api('POST',path,'alice',{matchId:'forged'})).status,400);
 const noProof=await h.api('POST',path,'alice',{matchId,gameEnded:true});
 assert.equal(noProof.status,200);
 assert.equal(noProof.room.phase,'playing');
 assert.equal(noProof.room.revision,started.revision);
 h.setFinished(true);
 const [first,second]=await Promise.all([h.api('POST',path,'alice',{matchId}),h.api('POST',path,'bob',{matchId})]);
 assert.equal(first.status,200);
 assert.equal(second.status,200);
 const completed=await h.api('GET',`/api/hub/rooms/${code}`,'bob');
 assert.equal(completed.room.phase,'lobby');
 assert.equal(completed.room.code,code);
 assert.equal(completed.room.lastCompleted.id,matchId);
 assert.equal(completed.room.lastCompleted.game,'business');
 assert.deepEqual(completed.room.players.map(p=>p.ready),[false,false]);
 assert.deepEqual(completed.room.players.map(p=>p.participating),[false,false]);
 assert.equal(completed.room.revision,started.revision+1);
 assert.equal((await h.api('POST',path,'bob',{matchId})).room.revision,completed.room.revision);
});
test('Late completion calls from previous game cannot end a new match in same room',async()=>{
 const h=harness(),{room}=await h.api('POST','/api/hub/rooms'),code=room.code;
 await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');
 await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'barikade'});
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 const first=(await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true})).room.match;
 h.setFinished(true);
 await h.api('POST',`/api/hub/rooms/${code}/sync`,'alice',{matchId:first.id});
 await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'skyjo'});
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 const next=(await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true})).room;
 assert.equal(next.phase,'playing');
 assert.notEqual(next.match.id,first.id);
 const oldTab=await h.api('POST',`/api/hub/rooms/${code}/sync`,'bob',{matchId:first.id});
 assert.equal(oldTab.room.phase,'playing');
 assert.equal(oldTab.room.match.id,next.match.id);
 assert.equal(oldTab.room.revision,next.revision);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/sync`,'alice',{matchId:next.match.id})).room.phase,'lobby');
});

test('Rejected Firebase token is a controlled 401, not an unhandled middleware error',async()=>{
 const h=harness({verifyProfile:async()=>{throw Error('TOKEN_EXPIRED');}});
 const response=await h.api('POST','/api/hub/rooms','alice');
 assert.equal(response.status,401);
 assert.equal(response.error,'LOGIN_REQUIRED');
});


test('Room chat persists across verified players and rejects outsiders/invalid content',async()=>{
 const h=harness(),created=await h.api('POST','/api/hub/rooms'),code=created.room.code;
 const addr='/api/hub/rooms/'+code+'/chat';
 assert.equal((await h.api('POST',addr,'bob',{text:'Hallo'})).status,403);
 assert.equal((await h.api('POST',addr,'alice',{text:''})).status,400);
 assert.equal((await h.api('POST',addr,'alice',{text:'a'.repeat(301)})).status,400);
 const first=await h.api('POST',addr,'alice',{text:'  Hallo 👋  '});
 assert.equal(first.status,200);
 assert.equal(first.room.chatEnabled,true);
 assert.equal(first.room.chat.length,1);
 assert.equal(first.room.chat[0].text,'Hallo 👋');
 assert.equal(first.room.chat[0].name,'Alice');
 assert.equal((await h.api('POST',addr,'alice',{text:'Zu schnell'})).status,429);
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 const seen=await h.api('GET','/api/hub/rooms/'+code,'bob');
 assert.equal(seen.room.chat[0].text,'Hallo 👋');
 h.advance(1000);
 const second=await h.api('POST',addr,'bob',{text:'Hey\nBob'});
 assert.equal(second.room.chat[1].name,'Bob');
 assert.equal(second.room.chat[1].text,'Hey Bob');
});
test('Room chat retains 40 recent messages without exposing internal player state',async()=>{
 const h=harness(),created=await h.api('POST','/api/hub/rooms'),code=created.room.code;
 for(let i=0;i<45;i++){
  const posted=await h.api('POST','/api/hub/rooms/'+code+'/chat','alice',{text:'Nachricht '+i});
  assert.equal(posted.status,200);
  h.advance(900);
 }
 const read=(await h.api('GET','/api/hub/rooms/'+code)).room;
 assert.equal(read.chat.length,40);
 assert.equal(read.chat[0].text,'Nachricht 5');
 assert.equal(read.chat[39].text,'Nachricht 44');
 assert.equal(Object.hasOwn(read.players[0],'lastChatAt'),false);
 assert.equal(Object.hasOwn(read.chat[0],'uid'),false);
});

test('Host cancellation is reflected for every player and old match cannot be revived',async()=>{
 const h=harness();
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'skyjo'});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const active=(await h.api('POST','/api/hub/rooms/'+code+'/ready','bob',{ready:true})).room;
 assert.equal(active.phase,'playing');
 const matchId=active.match.id;
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/cancel','bob')).status,403);
 const stopped=await h.api('POST','/api/hub/rooms/'+code+'/cancel','alice');
 assert.equal(stopped.status,200);
 assert.equal(stopped.room.phase,'lobby');
 assert.equal(stopped.room.match,null);
 assert.equal(stopped.room.lastCompleted.id,matchId);
 assert.equal(stopped.room.lastCompleted.status,'aborted');
 assert.equal(stopped.room.lastCompleted.statsEligible,false);
 const other=(await h.api('GET','/api/hub/rooms/'+code,'bob')).room;
 assert.equal(other.lastCompleted.status,'aborted');
 assert.equal(other.lastCompleted.statsEligible,false);
 h.setFinished(true);
 const stale=await h.api('POST','/api/hub/rooms/'+code+'/sync','bob',{matchId});
 assert.equal(stale.room.phase,'lobby');
 assert.equal(stale.room.lastCompleted.status,'aborted');
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/finish','alice')).status,409);
});


test('Party Challenge rejects unsupported lengths and starts the current eleven-game format',async()=>{
 const h=harness(),code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 await h.api('POST','/api/hub/rooms/'+code+'/join','cara');
 const selected=await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 assert.equal(selected.room.game,'partychallenge');
 for(const count of [4,5,7,9]){
  assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/challenge-settings','alice',{count})).status,400);
 }
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/challenge-settings','bob',{count:11})).status,403);
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/challenge-settings','alice',{count:11})).status,200);
 for(const uid of ['alice','bob','cara'])await h.api('POST','/api/hub/rooms/'+code+'/ready',uid,{ready:true});
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/start','bob')).status,403);
 const started=await h.api('POST','/api/hub/rooms/'+code+'/start','alice');
 assert.equal(started.status,200);
 assert.equal(started.room.phase,'playing');
 assert.equal(started.room.match.challenge.order.length,11);
 assert.equal(new Set(started.room.match.challenge.order).size,11);
 assert.equal(started.room.match.challenge.phase,'countdown');
 assert.equal(started.room.match.challenge.startAt,4000);
 const peer=(await h.api('GET','/api/hub/rooms/'+code,'bob')).room;
 assert.deepEqual(peer.match.challenge,started.room.match.challenge);
});

test('Challenge progression rejects invalid room codes',async()=>{
 const h=harness();
 const response=await h.api('POST','/api/hub/rooms/BAD/challenge-next','alice',{challengeId:'00000000-0000-0000-0000-000000000000'});
 assert.equal(response.status,400);
});


test('Challenge result endpoint never trusts client scores',async()=>{
 const h=harness();
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','bob',{ready:true});
 const started=(await h.api('POST','/api/hub/rooms/'+code+'/start','alice')).room;
 const ch=started.match.challenge;
 const attempt=await h.api('POST','/api/hub/rooms/'+code+'/challenge-result','alice',{challengeId:ch.id,gameId:ch.order[0],scores:[999999,0]});
 assert.equal(attempt.status,409);
 assert.equal(attempt.error,'GAME_RESULT_ADAPTER_REQUIRED');
 const read=(await h.api('GET','/api/hub/rooms/'+code,'bob')).room;
 assert.deepEqual(read.match.challenge.points,[0,0]);
 assert.equal(read.match.challenge.results.length,0);
});


test('Host can add and remove two Challenge test players without real accounts',async()=>{
 const h=harness();
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/challenge-test-players','bob',{enabled:true})).status,403);
 const added=await h.api('POST','/api/hub/rooms/'+code+'/challenge-test-players','alice',{enabled:true});
 assert.equal(added.status,200);
 assert.equal(added.room.players.filter(p=>p.testBot).length,2);
 assert.equal(added.room.players.filter(p=>p.testBot&&p.ready).length,2);
 const removed=await h.api('POST','/api/hub/rooms/'+code+'/challenge-test-players','alice',{enabled:false});
 assert.equal(removed.status,200);
 assert.equal(removed.room.players.some(p=>p.testBot),false);
});


test('Zeitgefuehl server stop rejects early actions and records bot scores',async()=>{
 const h=harness({challengeRandomInt:max=>max===3?0:max-1});
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 await h.api('POST','/api/hub/rooms/'+code+'/challenge-test-players','alice',{enabled:true});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const started=(await h.api('POST','/api/hub/rooms/'+code+'/start','alice')).room;
 const ch=started.match.challenge;
 assert.equal(started.match.playerCount,3);
 assert.equal(ch.order[0],'zeitgefuehl');
 const path='/api/hub/rooms/'+code+'/challenge-time-stop';
 assert.equal((await h.api('POST',path,'alice',{challengeId:ch.id})).status,409);
 h.advance(3000+ch.targetSeconds*1000);
 const stopped=await h.api('POST',path,'alice',{challengeId:ch.id,elapsedMs:0,score:999});
 assert.equal(stopped.status,200);
 assert.equal(stopped.room.match.challenge.phase,'results');
 assert.equal(stopped.room.match.challenge.results[0].standings.length,3);
 assert.equal(stopped.room.match.challenge.points.length,3);
 assert.equal((await h.api('POST',path,'alice',{challengeId:ch.id})).status,409);
});


test('Zeitgefuehl waits for all real players, ignores duplicate stops, and lets host advance',async()=>{
 const h=harness({challengeRandomInt:max=>max===3?0:max-1});
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','bob',{ready:true});
 const started=(await h.api('POST','/api/hub/rooms/'+code+'/start','alice')).room;
 const ch=started.match.challenge;
 assert.equal(ch.order[0],'zeitgefuehl');
 const stop='/api/hub/rooms/'+code+'/challenge-time-stop';
 const next='/api/hub/rooms/'+code+'/challenge-next';
 h.advance(3000+11000);
 const first=await h.api('POST',stop,'alice',{challengeId:ch.id});
 assert.equal(first.status,200);
 assert.equal(first.room.match.challenge.phase,'countdown');
 assert.equal(first.room.match.challenge.stopped.length,1);
 assert.equal((await h.api('POST',next,'alice',{challengeId:ch.id})).status,409);
 const repeat=await h.api('POST',stop,'alice',{challengeId:ch.id});
 assert.equal(repeat.status,200);
 assert.equal(repeat.room.match.challenge.stopped.length,1);
 h.advance(1200);
 const second=await h.api('POST',stop,'bob',{challengeId:ch.id});
 assert.equal(second.status,200);
 assert.equal(second.room.match.challenge.phase,'results');
 assert.equal(second.room.match.challenge.results.length,1);
 assert.equal(second.room.match.challenge.results[0].standings.length,2);
 assert.equal((await h.api('POST',next,'bob',{challengeId:ch.id})).status,403);
 const advanced=await h.api('POST',next,'alice',{challengeId:ch.id});
 assert.equal(advanced.status,200);
 assert.equal(advanced.room.match.challenge.index,1);
 assert.equal(advanced.room.match.challenge.phase,'countdown');
 assert.equal(advanced.room.match.challenge.results.length,1);
 assert.equal((await h.api('POST',next,'alice',{challengeId:ch.id})).status,409);
});


test('Recheninsel online validates answers and awards points with two test players',async()=>{
 const h=harness({challengeRandomInt:max=>max===4?0:max-1});
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 await h.api('POST','/api/hub/rooms/'+code+'/challenge-test-players','alice',{enabled:true});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const started=(await h.api('POST','/api/hub/rooms/'+code+'/start','alice')).room;
 const ch=started.match.challenge;
 assert.equal(ch.order[0],'recheninsel');
 assert.equal(ch.math.answer,undefined);
 const path='/api/hub/rooms/'+code+'/challenge-math-answer';
 assert.equal((await h.api('POST',path,'alice',{challengeId:ch.id,answer:4})).status,409);
 h.advance(3000);
 let result;
 for(let round=1;round<=3;round++){
  const q=round===1?ch.math:result.room.match.challenge.math;
  const answer=q.operator==='×'?q.a*q.b:q.operator==='−'?q.a-q.b:q.operator==='÷'?q.a/q.b:q.a+q.b;
  result=await h.api('POST',path,'alice',{challengeId:ch.id,answer});
  assert.equal(result.status,200);
  if(round<3){assert.equal(result.room.match.challenge.math.round,round+1);h.advance(3000);}
 }
 assert.equal(result.room.match.challenge.phase,'results');
 assert.equal(result.room.match.challenge.results[0].rounds.length,3);
 assert.equal(result.room.match.challenge.results[0].standings.length,3);
 assert.equal((await h.api('POST',path,'alice',{challengeId:ch.id,answer:999})).status,409);
});


test('Current eleven-game Challenge starts with bots and a unique order',async()=>{
 const h=harness({challengeRandomInt:max=>max-1});
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 await h.api('POST','/api/hub/rooms/'+code+'/challenge-test-players','alice',{enabled:true});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const started=await h.api('POST','/api/hub/rooms/'+code+'/start','alice');
 assert.equal(started.status,200);
 const ch=started.room.match.challenge;
 assert.equal(ch.order.length,11);
 assert.equal(new Set(ch.order).size,11);
 assert.equal(started.room.match.playerCount,3);
 assert.equal(ch.phase,'countdown');
});

test('New Party Challenge defaults to supported eleven-game setup and starts with bots without saving settings',async()=>{
 const h=harness({challengeRandomInt:max=>max-1});
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 const selected=await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 assert.equal(selected.status,200);
 assert.equal(selected.room.settings.count,11);
 await h.api('POST','/api/hub/rooms/'+code+'/challenge-test-players','alice',{enabled:true});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const started=await h.api('POST','/api/hub/rooms/'+code+'/start','alice');
 assert.equal(started.status,200);
 assert.equal(started.room.match.challenge.order.length,11);
 assert.equal(started.room.match.playerCount,3);
});

test('Hütchen rejects answers before shuffle and after deadline',async()=>{
 const h=harness({challengeRandomInt:max=>max===5?0:max-1});
 const {room}=await h.api('POST','/api/hub/rooms');
 const code=room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','bob',{ready:true});
 const started=await h.api('POST','/api/hub/rooms/'+code+'/start','alice');
 assert.equal(started.status,200);
 const ch=started.room.match.challenge;
 assert.equal(ch.order[0],'huetchen-challenge');
 const body={challengeId:ch.id,round:1,slot:0};
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/challenge-huetchen-answer','alice',body)).status,409);
 h.advance(3000+7160);
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/challenge-huetchen-answer','alice',body)).status,200);
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/challenge-huetchen-answer','alice',body)).status,200);
 h.advance(12000);
 const expired=await h.api('POST','/api/hub/rooms/'+code+'/challenge-huetchen-answer','bob',body);
 assert.equal(expired.status,409);
 assert.equal(expired.error,'HUETCHEN_ROUND_TIME_EXPIRED');
});

test('Recheninsel has exactly three progressively harder timed rounds',async()=>{
 const h=harness({challengeRandomInt:max=>max===4?0:max-1});
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 await h.api('POST','/api/hub/rooms/'+code+'/challenge-test-players','alice',{enabled:true});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const started=await h.api('POST','/api/hub/rooms/'+code+'/start','alice');
 const id=started.room.match.challenge.id;
 assert.equal(started.room.match.challenge.order[0],'recheninsel');
 const endpoint='/api/hub/rooms/'+code+'/challenge-math-answer';
 let state=started.room.match.challenge;
 for(let round=1;round<=3;round++){
  assert.equal(state.math.round,round);
  assert.equal(state.math.totalRounds,3);
  if(round===1){assert.ok(['+','−','×'].includes(state.math.operator));assert.ok(state.math.a<=120);}
  if(round===2){assert.ok(['+','−','×','÷'].includes(state.math.operator));}
  if(round===3){assert.ok(['+','−','×','÷'].includes(state.math.operator));}
  h.advance(3000);
  const q=state.math;
  const answer=q.operator==='×'?q.a*q.b:q.operator==='−'?q.a-q.b:q.operator==='÷'?q.a/q.b:q.a+q.b;
  const response=await h.api('POST',endpoint,'alice',{challengeId:id,answer});
  assert.equal(response.status,200);
  state=response.room.match.challenge;
  if(round<3)assert.equal(state.math.round,round+1);
 }
 assert.equal(state.phase,'results');
 assert.equal(state.results[0].rounds.length,3);
});

test('Maulwurf endpoints reject calls without an active challenge',async()=>{
 const h=harness(),code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 const selected=await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 assert.equal(selected.status,200);
 assert.deepEqual(selected.room.settings.availableGames.sort(),['bomber-strand-arena','eisstock','fallende-gegenstaende','flusssprung','huetchen-challenge','lava-arena','maulwurf-arena','preisjaeger','recheninsel','snake-arena','zeitgefuehl'].sort());
 const hit=await h.api('POST','/api/hub/rooms/'+code+'/challenge-maulwurf-hit','alice',{challengeId:'invalid',tick:0,hole:0});
 assert.equal(hit.status,409);
 const timeout=await h.api('POST','/api/hub/rooms/'+code+'/challenge-maulwurf-timeout','alice',{challengeId:'invalid'});
 assert.equal(timeout.status,409);
});

test('Maulwurf validates server clock, hole, duplicate hits and computes standings',async()=>{
 const h=harness({challengeRandomInt:()=>0});
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 for(const uid of ['alice','bob'])await h.api('POST','/api/hub/rooms/'+code+'/ready',uid,{ready:true});
 const started=(await h.api('POST','/api/hub/rooms/'+code+'/start','alice')).room;
 const key='spielesammlung_hub_v1/'+code,doc=h.docs.get(key);
 const ch=doc.match.challenge;
 ch.order=['maulwurf-arena'];ch.index=0;ch.points=[0,0];ch.results=[];
 ch.maulwurf={index:0,events:Array.from({length:30},(_,tick)=>({tick,hole:2,kind:tick===0?'gold':'normal'})),hits:{}};
 h.docs.set(key,doc);
 const path='/api/hub/rooms/'+code+'/challenge-maulwurf-hit',payload={challengeId:ch.id,tick:0,hole:2};
 assert.equal((await h.api('POST',path,'alice',payload)).status,409);
 h.advance(3000);
 assert.equal((await h.api('POST',path,'alice',{...payload,hole:1})).status,409);
 assert.equal((await h.api('POST',path,'alice',{...payload,tick:30})).status,400);
 assert.equal((await h.api('POST',path,'alice',{...payload,hole:9})).status,400);
 assert.equal((await h.api('POST',path,'alice',payload)).status,200);
 assert.equal((await h.api('POST',path,'alice',payload)).status,200);
 const own=(await h.api('GET','/api/hub/rooms/'+code,'alice')).room.match.challenge.maulwurf;
 const other=(await h.api('GET','/api/hub/rooms/'+code,'bob')).room.match.challenge.maulwurf;
 assert.equal(own.score,3);
 assert.equal(own.hitCount,1);
 assert.equal(other.score,0);
 assert.equal(other.hitCount,0);
 assert.equal((await h.api('POST',path,'bob',{...payload,tick:1})).status,409);
 // The round starts after a 3000ms countdown; at startAt+4100ms tick 3 is 100ms late.
 h.advance(4100);
 const delayed={...payload,tick:3};
 assert.equal((await h.api('POST',path,'bob',delayed)).status,200);
 assert.equal((await h.api('GET','/api/hub/rooms/'+code,'bob')).room.match.challenge.maulwurf.score,1);
 // After the grace window, the same hit cannot score again.
 h.advance(300);
 assert.equal((await h.api('POST',path,'bob',delayed)).status,409);
 h.advance(25600);
 const timeout=await h.api('POST','/api/hub/rooms/'+code+'/challenge-maulwurf-timeout','bob',{challengeId:ch.id});
 assert.equal(timeout.status,200);
 assert.equal(timeout.room.match.challenge.phase,'finished');
 assert.equal(timeout.room.match.challenge.results[0].standings[0].score,3);
 assert.equal(timeout.room.match.challenge.results[0].standings[1].score,1);
 const again=await h.api('POST','/api/hub/rooms/'+code+'/challenge-maulwurf-timeout','alice',{challengeId:ch.id});
 assert.equal(again.status,200);
 assert.equal(again.room.match.challenge.results.length,1);
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/challenge-maulwurf-timeout','cara',{challengeId:ch.id})).status,403);
});

test('Maulwurf scores three players independently and resolves one shared winner',async()=>{
 const h=harness({challengeRandomInt:()=>0});
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 for(const uid of ['bob','cara'])assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/join',uid)).status,200);
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 for(const uid of ['alice','bob','cara'])await h.api('POST','/api/hub/rooms/'+code+'/ready',uid,{ready:true});
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/start','alice')).status,200);
 const key='spielesammlung_hub_v1/'+code,doc=h.docs.get(key),ch=doc.match.challenge;
 ch.order=['maulwurf-arena'];ch.index=0;ch.points=[0,0,0];ch.results=[];
 ch.maulwurf={index:0,events:Array.from({length:30},(_,tick)=>({tick,hole:4,kind:tick===0?'gold':tick===1?'bad':'normal'})),hits:{}};
 h.docs.set(key,doc);
 h.advance(3000);
 const path='/api/hub/rooms/'+code+'/challenge-maulwurf-hit';
 const hit=(uid,tick)=>h.api('POST',path,uid,{challengeId:ch.id,tick,hole:4});
 assert.equal((await hit('alice',0)).status,200);
 assert.equal((await hit('bob',0)).status,200);
 assert.equal((await hit('cara',0)).status,200);
 h.advance(1000);
 assert.equal((await hit('bob',1)).status,200);
 assert.equal((await hit('cara',1)).status,200);
 const scores=[];
 for(const uid of ['alice','bob','cara']){
  const result=await h.api('GET','/api/hub/rooms/'+code,uid);
  assert.equal(result.status,200);
  scores.push(result.room.match.challenge.maulwurf.score);
  assert.equal(result.room.match.challenge.maulwurf.opponents.length,3);
 }
 assert.deepEqual(scores,[3,1,1]);
 h.advance(29000);
 const finished=await h.api('POST','/api/hub/rooms/'+code+'/challenge-maulwurf-timeout','cara',{challengeId:ch.id});
 assert.equal(finished.status,200);
 assert.equal(finished.room.match.challenge.phase,'finished');
 assert.deepEqual(finished.room.match.challenge.results[0].standings.map(p=>p.score),[3,1,1]);
 assert.deepEqual(finished.room.match.challenge.points,[30,10,10]);
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/challenge-maulwurf-timeout','bob',{challengeId:ch.id})).room.match.challenge.results.length,1);
});

test('Maulwurf supports four human players without leaking personal hit ticks',async()=>{
 const h=harness({challengeRandomInt:()=>0});
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 for(const uid of ['bob','cara','dana'])assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/join',uid)).status,200);
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 for(const uid of ['alice','bob','cara','dana'])await h.api('POST','/api/hub/rooms/'+code+'/ready',uid,{ready:true});
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/start','alice')).status,200);
 const key='spielesammlung_hub_v1/'+code,doc=h.docs.get(key),ch=doc.match.challenge;
 ch.order=['maulwurf-arena'];ch.index=0;ch.points=[0,0,0,0];ch.results=[];
 ch.maulwurf={index:0,events:Array.from({length:30},(_,tick)=>({tick,hole:5,kind:'normal'})),hits:{}};
 h.docs.set(key,doc);
 h.advance(3000);
 const path='/api/hub/rooms/'+code+'/challenge-maulwurf-hit';
 assert.equal((await h.api('POST',path,'dana',{challengeId:ch.id,tick:0,hole:5})).status,200);
 for(const uid of ['alice','bob','cara','dana']){
  const r=await h.api('GET','/api/hub/rooms/'+code,uid);
  assert.equal(r.status,200);
  const view=r.room.match.challenge.maulwurf;
  assert.equal(view.opponents.length,4);
  assert.equal(view.score,uid==='dana'?1:0);
  assert.deepEqual(view.hitTicks,uid==='dana'?[0]:[]);
 }
 h.advance(30000);
 const finished=await h.api('POST','/api/hub/rooms/'+code+'/challenge-maulwurf-timeout','alice',{challengeId:ch.id});
 assert.equal(finished.status,200);
 assert.deepEqual(finished.room.match.challenge.points,[0,0,0,10]);
 assert.deepEqual(finished.room.match.challenge.results[0].standings.map(x=>x.score),[0,0,0,1]);
});

test('Maulwurf tied scores and late hits',async()=>{
 const h=harness({challengeRandomInt:()=>0});
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 for(const uid of ['alice','bob'])await h.api('POST','/api/hub/rooms/'+code+'/ready',uid,{ready:true});
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/start','alice')).status,200);
 const key='spielesammlung_hub_v1/'+code,doc=h.docs.get(key),ch=doc.match.challenge;
 ch.order=['maulwurf-arena'];ch.index=0;ch.points=[0,0];ch.results=[];
 ch.maulwurf={index:0,events:Array.from({length:30},(_,tick)=>({tick,hole:1,kind:'normal'})),hits:{}};
 h.docs.set(key,doc);h.advance(3000);
 const path='/api/hub/rooms/'+code+'/challenge-maulwurf-hit',payload={challengeId:ch.id,tick:0,hole:1};
 for(const uid of ['alice','bob'])assert.equal((await h.api('POST',path,uid,payload)).status,200);
 h.advance(30000);
 const done=await h.api('POST','/api/hub/rooms/'+code+'/challenge-maulwurf-timeout','alice',{challengeId:ch.id});
 assert.equal(done.status,200);
 assert.deepEqual(done.room.match.challenge.points,[10,10]);
 assert.deepEqual(done.room.match.challenge.results[0].standings.map(p=>p.score),[1,1]);
 assert.equal((await h.api('POST',path,'bob',payload)).status,409);
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/challenge-maulwurf-timeout','bob',{challengeId:ch.id})).room.match.challenge.results.length,1);
});

test('Maulwurf penalty never subtracts challenge points below zero',async()=>{
 const h=harness({challengeRandomInt:()=>0});
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 for(const uid of ['alice','bob'])await h.api('POST','/api/hub/rooms/'+code+'/ready',uid,{ready:true});
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/start','alice')).status,200);
 const key='spielesammlung_hub_v1/'+code,doc=h.docs.get(key),ch=doc.match.challenge;
 ch.order=['maulwurf-arena'];ch.index=0;ch.points=[0,0];ch.results=[];
 ch.maulwurf={index:0,events:Array.from({length:30},(_,tick)=>({tick,hole:2,kind:tick===0?'bad':'normal'})),hits:{}};
 h.docs.set(key,doc);h.advance(3000);
 const path='/api/hub/rooms/'+code+'/challenge-maulwurf-hit';
 assert.equal((await h.api('POST',path,'alice',{challengeId:ch.id,tick:0,hole:2})).status,200);
 const live=(await h.api('GET','/api/hub/rooms/'+code,'alice')).room.match.challenge.maulwurf;
 assert.equal(live.score,-2);
 assert.equal(live.hitCount,1);
 h.advance(30000);
 const done=await h.api('POST','/api/hub/rooms/'+code+'/challenge-maulwurf-timeout','bob',{challengeId:ch.id});
 assert.equal(done.status,200);
 assert.deepEqual(done.room.match.challenge.results[0].standings.map(p=>p.score),[-2,0]);
 assert.deepEqual(done.room.match.challenge.points,[0,0]);
});

test('Maulwurf records different hits for players at the same tick',async()=>{
 const h=harness({challengeRandomInt:()=>0});
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 for(const uid of ['alice','bob'])await h.api('POST','/api/hub/rooms/'+code+'/ready',uid,{ready:true});
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/start','alice')).status,200);
 const key='spielesammlung_hub_v1/'+code,doc=h.docs.get(key),ch=doc.match.challenge;
 ch.order=['maulwurf-arena'];ch.index=0;ch.points=[0,0];ch.results=[];
 ch.maulwurf={index:0,events:Array.from({length:30},(_,tick)=>({tick,hole:2,kind:'normal'})),hits:{}};
 h.docs.set(key,doc);h.advance(3000);
 const path='/api/hub/rooms/'+code+'/challenge-maulwurf-hit',payload={challengeId:ch.id,tick:0,hole:2};
 const results=await Promise.all(['alice','bob'].map(uid=>h.api('POST',path,uid,payload)));
 assert.deepEqual(results.map(x=>x.status),[200,200]);
 for(const uid of ['alice','bob']){
  const view=(await h.api('GET','/api/hub/rooms/'+code,uid)).room.match.challenge.maulwurf;
  assert.equal(view.score,1);
  assert.equal(view.hitCount,1);
 }
});


test('Recheninsel uses progressive, bounded and exact arithmetic',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
 const start=source.indexOf('  function setupRecheninsel(ch,round=1){');
 const end=source.indexOf('  function setupHuetchen(ch,round=1){',start);
 assert.ok(start>=0&&end>start);
 const body=source.slice(start,end);
 const build=new Function('challengeRandomInt','return '+body.trim().replace(/^function setupRecheninsel/,'function setupRecheninsel')+';')(max=>Math.floor(Math.random()*max));
 for(let round=1;round<=3;round++){
  const operators=new Set();
  for(let i=0;i<1000;i++){
   const ch={index:0};
   build(ch,round);
   const m=ch.math;
   const expected=m.operator==='+'?m.a+m.b:m.operator==='−'?m.a-m.b:m.operator==='×'?m.a*m.b:m.a/m.b;
   assert.equal(m.answer,expected);
   assert.ok(Number.isInteger(m.answer)&&m.answer>=0&&m.answer<=1000);
   assert.equal(m.round,round);
   operators.add(m.operator);
  }
  assert.ok(operators.size>=3);
 }
});

test('Lava Arena test players receive authoritative movement and elimination',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
 assert.match(source,/function tickLavaBots\(ch,members,now\)/);
 assert.match(source,/member\.uid\.startsWith\('testbot:'\)/);
 assert.match(source,/tickLavaBots\(ch,room\.match\.members,now\)/);
 assert.match(source,/tile\?\.state===2\)\{p\.alive=false;p\.deathAt=now/);
});

test('Hub shares one Firestore watch between sockets and releases it after last disconnect',async()=>{
 const {EventEmitter}=await import('node:events');
 const h=harness();
 const created=await h.api('POST','/api/hub/rooms');
 const code=created.room.code;
 await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');
 function socket(){
  const ws=new EventEmitter();ws.readyState=1;ws.sent=[];
  ws.send=value=>ws.sent.push(JSON.parse(value));
  ws.close=(status)=>{ws.readyState=3;ws.emit('close',status);};
  h.adapter.attachSocket(ws);
  return ws;
 }
 const a=socket(),b=socket();
 a.emit('message',JSON.stringify({type:'subscribe',code,profileIdToken:'alice'}));
 b.emit('message',JSON.stringify({type:'subscribe',code,profileIdToken:'bob'}));
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(h.watchStats().starts,1,'two sockets should share a single Firestore watch');
 assert.ok(a.sent.some(x=>x.type==='room'));
 assert.ok(b.sent.some(x=>x.type==='room'));
 await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'skyjo'});
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(a.sent.at(-1)?.room?.game,'skyjo');
 assert.equal(b.sent.at(-1)?.room?.game,'skyjo');
 a.close();
 assert.equal(h.watchStats().stops,0,'first disconnect must keep shared watch alive');
 b.close();
 assert.equal(h.watchStats().stops,1,'last disconnect must unsubscribe');
 const c=socket();
 c.emit('message',JSON.stringify({type:'subscribe',code,profileIdToken:'alice'}));
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(h.watchStats().starts,2,'reconnect creates a fresh watch');
 c.close();
 assert.equal(h.watchStats().stops,2);
});


test('DOG online: same shared room, four seats with bots, private card projections and guarded moves',async()=>{
 const h=harness(),code=(await h.api('POST','/api/hub/rooms')).room.code;
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'})).status,200);
 const start=await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 assert.equal(start.status,200);
 assert.equal(start.room.phase,'playing');
 assert.equal(start.room.match.game,'dog');
 const match=start.room.match;
 assert.equal(match.dog.players.length,4);
 assert.equal(match.dog.players.filter(p=>p.bot).length,3);
 assert.equal(match.dogSeat,0);
 assert.equal(match.dog.ruleset,'classic-dog');
 assert.equal(match.dog.hands[0].length,6);
 for(let i=1;i<4;i++)assert.equal(typeof match.dog.hands[i].count,'number');
 assert.equal(match.dog.deck,undefined);
 assert.equal(match.dog.discard,undefined);
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/dog/action','bob',{matchId:match.id,action:{type:'exchange',cardId:1},actionId:'test-unauth-001',expectedRevision:match.dog.revision})).status,403);
 const initialRevision=match.dog.revision;
 const cardId=match.dog.hands[0][0].id;
 const payload={matchId:match.id,action:{type:'exchange',cardId},expectedRevision:initialRevision,actionId:'dog-action-00000001'};
 const accepted=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','alice',payload);
 assert.equal(accepted.status,200);
 assert.equal(accepted.room.match.dog.hands[0].length,6);
 assert.ok(accepted.room.match.dog.revision>initialRevision);
 const repeated=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','alice',payload);
 assert.equal(repeated.status,200);
 assert.equal(repeated.room.match.dog.revision,accepted.room.match.dog.revision);
 const stale=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','alice',{...payload,actionId:'dog-action-00000002'});
 assert.equal(stale.status,409);
 assert.equal((await h.api('GET','/api/hub/rooms/'+code,'alice')).room.match.dog.hands[1].count>=0,true);
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/finish','alice')).status,409);
});
test('DOG four-human lobby hides each opponent hand',async()=>{
 const h=harness(),code=(await h.api('POST','/api/hub/rooms')).room.code;
 for(const p of ['bob','cara','dana'])await h.api('POST','/api/hub/rooms/'+code+'/join',p);
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'});
 for(const p of ['alice','bob','cara'])await h.api('POST','/api/hub/rooms/'+code+'/ready',p,{ready:true});
 const last=(await h.api('POST','/api/hub/rooms/'+code+'/ready','dana',{ready:true})).room;
 assert.equal(last.match.dog.players.filter(p=>p.bot).length,0);
 assert.equal(last.match.dog.phase,'exchange');
 for(let i=0;i<4;i++){
  const p=['alice','bob','cara','dana'][i],view=(await h.api('GET','/api/hub/rooms/'+code,p)).room;
  assert.equal(view.match.dogSeat,i);
  assert.equal(view.match.dog.hands[i].length,6);
  for(let j=0;j<4;j++)if(j!==i)assert.equal(view.match.dog.hands[j].count,6);
 }
});


async function fourHumanDog(h){
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 for(const player of ['bob','cara','dana']){
  const joined=await h.api('POST','/api/hub/rooms/'+code+'/join',player);
  assert.equal(joined.status,200);
 }
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'})).status,200);
 for(const name of ['alice','bob','cara']){
  const ready=await h.api('POST','/api/hub/rooms/'+code+'/ready',name,{ready:true});
  assert.equal(ready.status,200);
 }
 const last=await h.api('POST','/api/hub/rooms/'+code+'/ready','dana',{ready:true});
 assert.equal(last.status,200);
 assert.equal(last.room.match.game,'dog');
 assert.equal(last.room.match.dog.players.filter(p=>p.bot).length,0);
 return {code,matchId:last.room.match.id};
}
function dogCommand(matchId,view,action,id){
 return {matchId,action,expectedRevision:view.match.dog.revision,actionId:id};
}

test('DOG online phase 1: concurrent four-player exchanges cannot overwrite each other',async()=>{
 const h=harness(),{code,matchId}=await fourHumanDog(h),path='/api/hub/rooms/'+code+'/dog/action';
 const al=(await h.api('GET','/api/hub/rooms/'+code,'alice')).room;
 const bo=(await h.api('GET','/api/hub/rooms/'+code,'bob')).room;
 assert.equal(al.match.dog.revision,bo.match.dog.revision);
 const [a,b]=await Promise.all([
  h.api('POST',path,'alice',dogCommand(matchId,al,{type:'exchange',cardId:al.match.dog.hands[0][0].id},'dog-exchange-alice-1')),
  h.api('POST',path,'bob',dogCommand(matchId,bo,{type:'exchange',cardId:bo.match.dog.hands[1][0].id},'dog-exchange-bob-1'))
 ]);
 assert.deepEqual([a.status,b.status].sort(),[200,409]);
 const state=(await h.api('GET','/api/hub/rooms/'+code,'alice')).room;
 assert.equal(state.match.dog.revision,al.match.dog.revision+1);
 assert.equal(state.match.dog.exchanges.filter(Boolean).length,1);
 const loser=a.status===409?['alice',al]:['bob',bo];
 const refreshed=(await h.api('GET','/api/hub/rooms/'+code,loser[0])).room;
 const seat=refreshed.match.dogSeat;
 const retried=await h.api('POST',path,loser[0],dogCommand(matchId,refreshed,{type:'exchange',cardId:loser[1].match.dog.hands[seat][0].id},'dog-exchange-retry-1'));
 assert.equal(retried.status,200);
 assert.equal(retried.room.match.dog.exchanges.filter(Boolean).length,2);
 const replay=await h.api('POST',path,loser[0],dogCommand(matchId,refreshed,{type:'exchange',cardId:loser[1].match.dog.hands[seat][0].id},'dog-exchange-retry-1'));
 assert.equal(replay.status,200);
 assert.equal(replay.room.match.dog.revision,retried.room.match.dog.revision);
});

test('DOG online phase 1: all four players exchange privately; reconnection preserves the match',async()=>{
 const h=harness(),{code,matchId}=await fourHumanDog(h),path='/api/hub/rooms/'+code+'/dog/action';
 const users=['alice','bob','cara','dana'];
 for(let i=0;i<4;i++){
  const view=(await h.api('GET','/api/hub/rooms/'+code,users[i])).room;
  assert.equal(view.match.id,matchId);
  const card=view.match.dog.hands[i][0];
  const result=await h.api('POST',path,users[i],dogCommand(matchId,view,{type:'exchange',cardId:card.id},'dog-phase1-exchange-'+i));
  assert.equal(result.status,200);
  if(i<3)assert.equal(result.room.match.dog.phase,'exchange');
 }
 for(let i=0;i<4;i++){
  const snapshot=(await h.api('GET','/api/hub/rooms/'+code,users[i])).room;
  const reconnected=(await h.api('GET','/api/hub/rooms/'+code,users[i])).room;
  assert.equal(reconnected.match.id,matchId);
  assert.equal(snapshot.match.dog.revision,reconnected.match.dog.revision);
  assert.deepEqual(snapshot.match.dog.pieces,reconnected.match.dog.pieces);
  assert.equal(snapshot.match.dog.deck,undefined);
  assert.equal(snapshot.match.dog.discard,undefined);
  assert.equal(Array.isArray(snapshot.match.dog.hands[i]),true);
  for(let other=0;other<4;other++)if(other!==i){
   assert.equal(Array.isArray(snapshot.match.dog.hands[other]),false);
   assert.equal(typeof snapshot.match.dog.hands[other].count,'number');
  }
 }
});

test('DOG online phase 1: split seven survives reload and duplicate/replayed commands',async()=>{
 const h=harness(),{code,matchId}=await fourHumanDog(h),path='/api/hub/rooms/'+code+'/dog/action';
 const key='spielesammlung_hub_v1/'+code,raw=h.docs.get(key);
 assert.ok(raw?.match?.dog,'Mock room must include authoritative DOG state');
 const state=raw.match.dog;
 state.phase='play';state.current=0;state.starter=0;
 state.hands=[[{id:9999,type:'7'}],[],[],[]];
 state.exchanges=[null,null,null,null];state.seven=null;
 state.revision=44;
 state.pieces[0].place='track';state.pieces[0].pos=3;
 raw.match.dogCommands=[];raw.revision++;
 h.docs.set(key,raw);
 const first=(await h.api('GET','/api/hub/rooms/'+code,'alice')).room;
 assert.equal(first.match.dog.revision,44);
 const begin=await h.api('POST',path,'alice',dogCommand(matchId,first,{type:'seven',cardId:9999,as:'7'},'dog-phase1-seven-start'));
 assert.equal(begin.status,200);
 assert.equal(begin.room.match.dog.phase,'seven');
 const loaded=(await h.api('GET','/api/hub/rooms/'+code,'alice')).room;
 assert.equal(loaded.match.dog.phase,'seven');
 assert.equal(loaded.match.dog.seven.snapshot,undefined,'Private rollback snapshot is never transmitted');
 const move={type:'seven-step',pieceId:0,steps:3,viaGoal:false,to:'track:6'};
 const next=await h.api('POST',path,'alice',dogCommand(matchId,loaded,move,'dog-phase1-seven-step-3'));
 assert.equal(next.status,200);
 assert.equal(next.room.match.dog.seven.spent,3);
 assert.equal(next.room.match.dog.pieces[0].pos,6);
 const afterReload=(await h.api('GET','/api/hub/rooms/'+code,'alice')).room;
 assert.equal(afterReload.match.dog.seven.spent,3);
 const duplicate=await h.api('POST',path,'alice',dogCommand(matchId,loaded,move,'dog-phase1-seven-step-3'));
 assert.equal(duplicate.status,200);
 assert.equal(duplicate.room.match.dog.seven.spent,3);
 assert.equal(duplicate.room.match.dog.revision,next.room.match.dog.revision);
 const stale=await h.api('POST',path,'alice',dogCommand(matchId,loaded,move,'dog-phase1-seven-step-4'));
 assert.equal(stale.status,409);
 const finalMove={type:'seven-step',pieceId:0,steps:4,viaGoal:false,to:'track:10'};
 const final=await h.api('POST',path,'alice',dogCommand(matchId,afterReload,finalMove,'dog-phase1-seven-finish'));
 assert.equal(final.status,200);
 assert.equal(final.room.match.dog.pieces[0].pos,10);
 assert.notEqual(final.room.match.dog.phase,'seven');
 assert.equal(final.room.match.dog.seven,null);
});

test('DOG online phase 1: invalid actor, stale match and malformed command never change the game',async()=>{
 const h=harness(),{code,matchId}=await fourHumanDog(h),path='/api/hub/rooms/'+code+'/dog/action';
 const view=(await h.api('GET','/api/hub/rooms/'+code,'alice')).room;
 const original=view.match.dog.revision;
 const payload=dogCommand(matchId,view,{type:'exchange',cardId:view.match.dog.hands[0][0].id},'dog-phase1-reconnect-a');
 const unauthorized=await h.api('POST',path,'stranger',payload);
 assert.equal(unauthorized.status,401);
 const wrongMatch=await h.api('POST',path,'alice',{...payload,matchId:'outdated-match-id'});
 assert.equal(wrongMatch.status,409);
 const invalidCommand=await h.api('POST',path,'alice',{...payload,actionId:'x'});
 assert.equal(invalidCommand.status,400);
 const spectator=await h.api('POST',path,'bob',{...payload,actionId:'dog-phase1-bob-spoof'});
 assert.equal(spectator.status,409,'Player cannot send another player private card ID');
 const after=(await h.api('GET','/api/hub/rooms/'+code,'alice')).room;
 assert.equal(after.match.dog.revision,original);
});


test('DOG online phase 1: a fifth hub member can spectate without private cards or move privileges',async()=>{
 const h=harness(),code=(await h.api('POST','/api/hub/rooms')).room.code;
 for(const user of ['bob','cara','dana'])await h.api('POST','/api/hub/rooms/'+code+'/join',user);
 h.identities.eric={uid:'user_eric123',name:'Eric'};
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/join','eric')).status,200);
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'})).status,200);
 for(const user of ['alice','bob','cara','dana']){
  const result=await h.api('POST','/api/hub/rooms/'+code+'/ready',user,{ready:true});
  assert.equal(result.status,200);
 }
 const guest=(await h.api('GET','/api/hub/rooms/'+code,'eric')).room;
 assert.equal(guest.match.game,'dog');
 assert.equal(guest.match.participating,false);
 assert.equal(guest.match.dogSeat,null);
 assert.equal(guest.match.dog.hands.every(hand=>typeof hand.count==='number'&&!Array.isArray(hand)),true);
 assert.equal(guest.match.dog.deck,undefined);
 const unauthorized=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','eric',{
  matchId:guest.match.id,expectedRevision:guest.match.dog.revision,
  actionId:'dog-spectator-00001',action:{type:'exchange',cardId:1}
 });
 assert.equal(unauthorized.status,403);
 const after=(await h.api('GET','/api/hub/rooms/'+code,'alice')).room;
 assert.equal(after.match.dog.revision,guest.match.dog.revision);
});

test('SKYJO read-only seat cache saves Firestore reads but never caches mutations',async()=>{
 const h=harness(),created=await h.api('POST','/api/hub/rooms'),code=created.room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'skyjo'});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const {room:running}=await h.api('POST','/api/hub/rooms/'+code+'/ready','bob',{ready:true});
 assert.equal(running.phase,'playing');
 const gameCode=running.match.gameCode;
 // Instrument the in-memory fake store, not a live Firebase database.
 let documentReads=0;
 const originalCollection=h.store.collection;
 h.store.collection=name=>{
  const coll=originalCollection(name);
  return {doc:id=>{
   const ref=coll.doc(id);
   return {...ref,get:async()=>{documentReads++;return ref.get()}};
  }};
 };
 const [alice,bob]=await Promise.all([
  h.adapter.skyjoSeat(gameCode,h.identities.alice,{readOnly:true}),
  h.adapter.skyjoSeat(gameCode,h.identities.bob,{readOnly:true})
 ]);
 assert.equal(alice.uid,h.identities.alice.uid);
 assert.equal(bob.uid,h.identities.bob.uid);
 assert.equal(documentReads,1,'concurrent read-only checks share one Firestore lookup');
 assert.equal((await h.adapter.skyjoSeat(gameCode,h.identities.cara,{readOnly:true})).error,'NOT_A_PARTICIPANT');
 assert.equal(documentReads,1,'outsiders never gain access from the shared cache');
 await h.adapter.skyjoSeat(gameCode,h.identities.alice,{readOnly:true});
 assert.equal(documentReads,1,'repeat GET checks within the TTL use RAM');
 const fresh=await h.adapter.skyjoSeat(gameCode,h.identities.alice);
 assert.equal(fresh.uid,h.identities.alice.uid);
 assert.equal(documentReads,2,'state-changing requests still perform fresh Firestore authorization');
 h.advance(3001);
 await h.adapter.skyjoSeat(gameCode,h.identities.bob,{readOnly:true});
 assert.equal(documentReads,3,'read-only cache expires after three seconds');
 const canceled=await h.api('POST','/api/hub/rooms/'+code+'/cancel','alice');
 assert.equal(canceled.room.phase,'lobby');
 const rejected=await h.adapter.skyjoSeat(gameCode,h.identities.alice);
 assert.equal(rejected.error,'MATCH_NOT_FOUND','mutating requests immediately reject ended matches');
 h.advance(3001);
 assert.equal((await h.adapter.skyjoSeat(gameCode,h.identities.alice,{readOnly:true})).error,'MATCH_NOT_FOUND');
});


test('Render-first hub sync combines ongoing polls without Firestore transactions',async()=>{
 const h=harness(),created=await h.api('POST','/api/hub/rooms'),code=created.room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'business'});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const started=(await h.api('POST','/api/hub/rooms/'+code+'/ready','bob',{ready:true})).room;
 const matchId=started.match.id,route='/api/hub/rooms/'+code+'/sync';
 let reads=0,transactions=0;
 const originalCollection=h.store.collection;
 h.store.collection=name=>{
  const col=originalCollection(name);
  return {doc:code=>{
   const doc=col.doc(code);
   return {...doc,get:async()=>{reads++;return doc.get()}};
  }};
 };
 const originalTransaction=h.store.runTransaction.bind(h.store);
 h.store.runTransaction=fn=>{transactions++;return originalTransaction(fn)};
 const [first,second]=await Promise.all([
  h.api('POST',route,'alice',{matchId}),
  h.api('POST',route,'bob',{matchId})
 ]);
 assert.equal(first.status,200);
 assert.equal(second.status,200);
 assert.equal(first.room.phase,'playing');
 assert.equal(second.room.phase,'playing');
 assert.equal(reads,1,'both clients share one read-only Firestore lookup');
 assert.equal(transactions,0,'ongoing games never start Firestore transactions on each poll');
 assert.equal((await h.api('POST',route,'cara',{matchId})).status,403,'nonmember cannot access cached room');
 await h.api('POST',route,'alice',{matchId});
 assert.equal(reads,1,'same-room polling remains in Render RAM for 2.5 seconds');
 h.advance(2501);
 const after=await h.api('POST',route,'bob',{matchId});
 assert.equal(after.room.revision,started.revision);
 assert.equal(reads,2,'expired cache reloads Firestore');
 assert.equal(transactions,0);
 h.setFinished(true);
 const [endedOne,endedTwo]=await Promise.all([
  h.api('POST',route,'alice',{matchId}),
  h.api('POST',route,'bob',{matchId})
 ]);
 assert.equal(endedOne.status,200);
 assert.equal(endedTwo.status,200);
 const room=(await h.api('GET','/api/hub/rooms/'+code,'alice')).room;
 assert.equal(room.phase,'lobby');
 assert.equal(room.lastCompleted.id,matchId);
 assert.equal(room.revision,started.revision+1,'duplicate completion never writes twice');
 assert.ok(transactions>=1,'real completion uses authoritative Firestore transaction');
 const post=await h.api('POST',route,'alice',{matchId});
 assert.equal(post.room.phase,'lobby');
 assert.equal(post.room.revision,room.revision);
});

test('DOG avatars stay per player, reach both match projections and skip unchanged room writes',async()=>{
 const h=harness();
 const created=await h.api('POST','/api/hub/rooms','alice',{dogAvatar:5});
 const code=created.room.code;
 assert.equal(created.room.players[0].dogAvatar,5);
 const early=await h.api('POST','/api/hub/rooms/'+code+'/dog/avatar','alice',{avatar:4});
 assert.equal(early.status,200,'avatar can be chosen in the room before DOG is selected');
 assert.equal(early.room.players[0].dogAvatar,4);
 const joined=await h.api('POST','/api/hub/rooms/'+code+'/join','bob',{dogAvatar:11});
 assert.equal(joined.room.players[1].dogAvatar,11);
 const chosen=await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog',dogAvatar:5});
 const before=chosen.room.revision;
 const same=await h.api('POST','/api/hub/rooms/'+code+'/dog/avatar','bob',{avatar:11});
 assert.equal(same.status,200);
 assert.equal(same.room.revision,before,'identical avatar causes no room write');
 const changed=await h.api('POST','/api/hub/rooms/'+code+'/dog/avatar','bob',{avatar:12});
 assert.equal(changed.status,200);
 assert.equal(changed.room.revision,before+1);
 assert.equal(changed.room.players.find(p=>p.name==='Bob').dogAvatar,12);
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/dog/avatar','cara',{avatar:3})).status,403);
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/dog/avatar','bob',{avatar:18})).status,400);
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const started=(await h.api('POST','/api/hub/rooms/'+code+'/ready','bob',{ready:true})).room;
 assert.equal(started.match.game,'dog');
 assert.deepEqual(started.match.dogAvatars,[5,12,null,null]);
 const alice=(await h.api('GET','/api/hub/rooms/'+code,'alice')).room;
 assert.deepEqual(alice.match.dogAvatars,[5,12,null,null]);
 const bob=(await h.api('GET','/api/hub/rooms/'+code,'bob')).room;
 assert.deepEqual(bob.match.dogAvatars,[5,12,null,null]);
 assert.notEqual(bob.match.dogSeat,alice.match.dogSeat);
});


test('Unchanged hub rejoins do not rewrite Firestore room documents',async()=>{
 const h=harness(),initial=await h.api('POST','/api/hub/rooms'),code=initial.room.code;
 const bobFirst=await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 assert.equal(bobFirst.status,200);
 let writes=0;
 const runTransaction=h.store.runTransaction.bind(h.store);
 h.store.runTransaction=fn=>runTransaction(tx=>fn({
   ...tx,
   set(ref,value){writes++;tx.set(ref,value);}
 }));
 const same=await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 assert.equal(same.status,200);
 assert.equal(writes,0,'same player in same room must not trigger a Firestore write');
 assert.equal(same.room.revision,bobFirst.room.revision);
 assert.equal(same.room.players.length,2);
 const sameHost=await h.api('POST','/api/hub/rooms/'+code+'/join','alice',{dogAvatar:0});
 assert.equal(sameHost.status,200);
 assert.equal(writes,0,'rejoining host does not rewrite the room either');

 h.identities.bob.name='Robert';
 const renamed=await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 assert.equal(renamed.status,200);
 assert.equal(writes,1,'a changed display name is persisted');
 assert.equal(renamed.room.revision,bobFirst.room.revision+1);
 assert.equal(renamed.room.players.find(p=>p.me).name,'Robert');

 const newAvatar=await h.api('POST','/api/hub/rooms/'+code+'/join','bob',{dogAvatar:4});
 assert.equal(newAvatar.status,200);
 assert.equal(writes,2,'an explicit new avatar is persisted');
 assert.equal(newAvatar.room.players.find(p=>p.me).dogAvatar,4);
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob',{dogAvatar:4});
 assert.equal(writes,2,'reselecting the same avatar must not rewrite the document');

 h.advance(19*3600*1000);
 const ttl=await h.api('POST','/api/hub/rooms/'+code+'/join','bob',{dogAvatar:4});
 assert.equal(ttl.status,200);
 assert.equal(writes,3,'room expiry is renewed when under six hours remain');
 assert.equal(ttl.room.revision,newAvatar.room.revision+1);
 const final=await h.api('GET','/api/hub/rooms/'+code,'alice');
 assert.equal(final.room.players.length,2);
});


test('Fresh Render WebSocket snapshot serves authenticated HTTP room reads without extra Firestore get',async()=>{
 const {EventEmitter}=await import('node:events');
 const h=harness(),code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 let firestoreDocumentGets=0;
 const originalCollection=h.store.collection;
 h.store.collection=name=>{
   const collection=originalCollection(name);
   return {doc:docId=>{
     const ref=collection.doc(docId);
     return {...ref,get:async()=>{
       if(name==='spielesammlung_hub_v1')firestoreDocumentGets++;
       return ref.get();
     }};
   }};
 };
 function socket(user){
   const ws=new EventEmitter();
   ws.readyState=1;ws.sent=[];
   ws.send=payload=>ws.sent.push(JSON.parse(payload));
   ws.close=()=>{ws.readyState=3;ws.emit('close')};
   h.adapter.attachSocket(ws);
   ws.emit('message',JSON.stringify({type:'subscribe',code,profileIdToken:user}));
   return ws;
 }
 const alice=socket('alice'),bob=socket('bob');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.watchStats().starts,1,'existing subscribers share a single live Firestore watch');
 assert.ok(alice.sent.some(x=>x.type==='room'));
 assert.ok(bob.sent.some(x=>x.type==='room'));
 const [a,b]=await Promise.all([
   h.api('GET','/api/hub/rooms/'+code,'alice'),
   h.api('GET','/api/hub/rooms/'+code,'bob')
 ]);
 assert.equal(a.status,200);assert.equal(b.status,200);
 assert.equal(a.room.host,true);
 assert.equal(b.room.host,false,'each cached read retains caller-specific projection');
 assert.equal(firestoreDocumentGets,0,'fresh WS state eliminates duplicate Firestore get');
 assert.equal((await h.api('GET','/api/hub/rooms/'+code,'cara')).status,403);
 assert.equal((await h.api('GET','/api/hub/rooms/'+code,'stranger')).status,401);
 assert.equal(firestoreDocumentGets,0,'outsiders are rejected without leaking room state');
 const health=await h.api('GET','/api/hub/health');
 assert.equal(health.hubStreamReadCache.hits,3);
 assert.equal(health.hubStreamReadCache.ttlMs,2500);
 assert.equal(firestoreDocumentGets,0,'reading Render-only diagnostics does not query Firebase');
 const preflight=await h.api('POST','/api/hub/rooms/'+code+'/sync','alice',{
   matchId:'123e4567-e89b-12d3-a456-426614174000'
 });
 assert.equal(preflight.status,200);
 assert.equal(preflight.room.phase,'lobby','inactive match remains unchanged');
 assert.equal(firestoreDocumentGets,0,'read-only completion preflight also reuses fresh WebSocket room');

 h.advance(2501);
 const stale=await h.api('GET','/api/hub/rooms/'+code,'alice');
 assert.equal(stale.status,200);
 assert.equal(firestoreDocumentGets,1,'stale snapshot falls back to authoritative Firestore get');
 alice.close();bob.close();
 assert.equal(h.watchStats().stops,1);
 const disconnected=await h.api('GET','/api/hub/rooms/'+code,'bob');
 assert.equal(disconnected.status,200);
 assert.equal(firestoreDocumentGets,2,'closed WebSocket watch cannot serve stale HTTP state');
});

test('Hub mutation cannot authorize stale WebSocket room data',async()=>{
 const {EventEmitter}=await import('node:events');
 const h=harness(),code=(await h.api('POST','/api/hub/rooms')).room.code;
 const ws=new EventEmitter();ws.readyState=1;ws.sent=[];
 ws.send=payload=>ws.sent.push(JSON.parse(payload));
 ws.close=()=>{ws.readyState=3;ws.emit('close')};
 h.adapter.attachSocket(ws);
 ws.emit('message',JSON.stringify({type:'subscribe',code,profileIdToken:'alice'}));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await h.api('GET','/api/hub/rooms/'+code)).room.phase,'lobby');
 const changed=await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'});
 assert.equal(changed.status,200);
 assert.equal(changed.room.phase,'preparing');
 const reread=await h.api('GET','/api/hub/rooms/'+code,'alice');
 assert.equal(reread.status,200);
 assert.equal(reread.room.game,'dog','authoritative mutation must never be hidden by an old WS snapshot');
 assert.equal(reread.room.phase,'preparing');
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/select','bob',{game:'skyjo'})).status,403);
 ws.close();
});

test('DOG emojis use one authenticated hub stream, reject locked or spammed IDs, and never write Firestore',async()=>{
 const {EventEmitter}=await import('node:events');
 const h=harness();
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const started=(await h.api('POST','/api/hub/rooms/'+code+'/ready','bob',{ready:true})).room;
 assert.equal(started.phase,'playing');
 const matchId=started.match.id,revision=started.revision;
 function connect(user){
  const ws=new EventEmitter();ws.readyState=1;ws.sent=[];
  ws.send=payload=>ws.sent.push(JSON.parse(payload));
  ws.close=()=>{ws.readyState=3;ws.emit('close');};
  h.adapter.attachSocket(ws);
  ws.emit('message',JSON.stringify({type:'subscribe',code,profileIdToken:user}));
  return ws;
 }
 const alice=connect('alice'),bob=connect('bob');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.watchStats().starts,1,'only the existing hub listener is used');
 alice.emit('message',JSON.stringify({type:'dog_emoji',matchId,emojiId:'emoji_01'}));
 assert.equal(alice.sent.filter(v=>v.type==='dog_emoji').length,1);
 assert.equal(bob.sent.filter(v=>v.type==='dog_emoji').length,1);
 assert.equal(bob.sent.find(v=>v.type==='dog_emoji')?.emojiId,'emoji_01');
 assert.equal(bob.sent.find(v=>v.type==='dog_emoji')?.senderName,'Alice');
 alice.emit('message',JSON.stringify({type:'dog_emoji',matchId,emojiId:'emoji_02'}));
 assert.equal(alice.sent.at(-1).reason,'COOLDOWN');
 h.advance(5001);
 alice.emit('message',JSON.stringify({type:'dog_emoji',matchId,emojiId:'emoji_04'}));
 assert.equal(alice.sent.at(-1).reason,'EMOJI_LOCKED');
 alice.emit('message',JSON.stringify({type:'dog_emoji',matchId:'wrong-match',emojiId:'emoji_03'}));
 assert.equal(alice.sent.at(-1).reason,'NO_DOG_MATCH');
 alice.emit('message',JSON.stringify({type:'dog_emoji',matchId,emojiId:'emoji_03'}));
 assert.equal(bob.sent.filter(v=>v.type==='dog_emoji').length,2);
 assert.equal(h.watchStats().starts,1);
 const check=await h.api('GET','/api/hub/rooms/'+code,'alice');
 assert.equal(check.room.revision,revision,'emoji events do not modify Firestore room revisions');
 alice.close();bob.close();
 assert.equal(h.watchStats().stops,1);
});


test('DOG Christmas event is automatically active; upgrades deduct shared lights once and survive new rooms',async()=>{
 const h=harness(),code=(await h.api('POST','/api/hub/rooms')).room.code;
 const path='/api/hub/rooms/'+code+'/dog';
 assert.equal((await h.api('GET',path+'/village','bob')).status,403,'outsiders cannot view another village');
 let view=await h.api('GET',path+'/village','alice');
 assert.equal(view.status,200);
 assert.equal(view.village.lightsTenths,0);
 assert.equal(view.village.levels.tower,1);
 assert.equal((await h.api('POST',path+'/village/upgrade','alice',{building:'tower',expectedLevel:1,commandId:'christmas-buy-denied-01'})).status,409);
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'});
 await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
 // No client, including the host, may turn the event on or off.
 await assert.rejects(h.api('POST',path+'/christmas-mode','alice',{enabled:false}),/NO_ROUTE/);
 await assert.rejects(h.api('POST',path+'/christmas-mode','bob',{enabled:true}),/NO_ROUTE/);
 view=await h.api('GET',path+'/village','alice');
 assert.equal(view.enabled,true);
 h.docs.set('dog_christmas_villages_v1/user_alice123',{hostUid:'user_alice123',lightsTenths:1700,levels:{tower:1,workshop:1,bakery:1,inn:1}});
 const buy={building:'tower',expectedLevel:1,commandId:'christmas-buy-safe-001'};
 const first=await h.api('POST',path+'/village/upgrade','alice',buy);
 assert.equal(first.status,200);
 assert.equal(first.village.levels.tower,2);
 assert.equal(first.village.lightsTenths,1550);
 const replay=await h.api('POST',path+'/village/upgrade','alice',buy);
 assert.equal(replay.status,200);
 assert.equal(replay.village.lightsTenths,1550);
 assert.equal((await h.api('POST',path+'/village/upgrade','bob',{...buy,commandId:'christmas-buy-fake-001'})).status,403);
 assert.equal((await h.api('POST',path+'/village/upgrade','alice',{...buy,commandId:'christmas-buy-other-01'})).status,400);
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const started=await h.api('POST','/api/hub/rooms/'+code+'/ready','bob',{ready:true});
 assert.equal(started.status,200);
 assert.equal(started.room.match.christmas.enabled,true);
 assert.equal(started.room.match.christmas.giftFields.length,12);
 assert.equal((await h.api('POST',path+'/village/upgrade','alice',{building:'tower',expectedLevel:2,commandId:'christmas-buy-live-001'})).status,409);
 const nextCode=(await h.api('POST','/api/hub/rooms','alice')).room.code;
 const other=await h.api('GET','/api/hub/rooms/'+nextCode+'/dog/village','alice');
 assert.equal(other.village.levels.tower,2);
 assert.equal(other.village.lightsTenths,1550);
});

test('DOG Christmas event ends centrally without deleting levels or allowing new bonus payouts',async()=>{
 const h=harness({christmasEventActive:()=>false}),code=(await h.api('POST','/api/hub/rooms')).room.code,base='/api/hub/rooms/'+code;
 h.docs.set('dog_christmas_villages_v1/user_alice123',{hostUid:'user_alice123',lightsTenths:1230,levels:{tower:3,workshop:2,bakery:1,inn:4}});
 await h.api('POST',base+'/select','alice',{game:'dog'});
 const status=await h.api('GET',base+'/dog/village','alice');
 assert.equal(status.enabled,false);
 assert.equal(status.canUpgrade,false);
 assert.equal(status.village.levels.tower,3);
 assert.equal(status.village.lightsTenths,1230);
 const buy=await h.api('POST',base+'/dog/village/upgrade','alice',{building:'tower',expectedLevel:3,commandId:'event-ended-buy-00001'});
 assert.equal(buy.status,409);
 assert.equal(buy.error,'DOG_CHRISTMAS_EVENT_ENDED');
 const started=await h.api('POST',base+'/ready','alice',{ready:true});
 assert.equal(started.status,200);
 assert.equal(started.room.match.christmas,null);
 assert.equal(started.room.settings.christmasActive,false);
 assert.equal((await h.api('GET',base+'/dog/village','alice')).village.lightsTenths,1230);
});

test('DOG previously unactivated live rooms automatically join the event on their next legal move',async()=>{
 const h=harness(),code=(await h.api('POST','/api/hub/rooms')).room.code,base='/api/hub/rooms/'+code;
 await h.api('POST',base+'/select','alice',{game:'dog'});
 const started=await h.api('POST',base+'/ready','alice',{ready:true});
 assert.equal(started.status,200);
 const room=h.docs.get('spielesammlung_hub_v1/'+code);
 room.match.christmas=null; // Existing game from the older opt-in implementation.
 room.match.dog.phase='play';
 room.match.dog.current=0;
 room.match.dog.hands=[[{id:999,type:'4'}],[],[],[]];
 room.match.dog.exchanges=[null,null,null,null];
 room.match.dog.pieces[0].place='track';room.match.dog.pieces[0].pos=63;
 h.docs.set('spielesammlung_hub_v1/'+code,room);
 const result=await h.api('POST',base+'/dog/action','alice',{matchId:room.match.id,
   expectedRevision:room.match.dog.revision,actionId:'event-retroactive-001',
   action:{type:'move',cardId:999,as:'4',pieceId:0,steps:4,viaGoal:false}});
 assert.equal(result.status,200,JSON.stringify(result));
 assert.equal(result.room.match.christmas.enabled,true);
 assert.ok(result.room.match.christmas.claimedFields.includes(3));
 assert.equal((await h.api('GET',base+'/dog/village','alice')).village.giftsCollected,1);
});

test('DOG Christmas event: a verified landing credits lights, replay cannot duplicate reward',async()=>{
 const h=harness(),code=(await h.api('POST','/api/hub/rooms')).room.code,base='/api/hub/rooms/'+code;
 await h.api('POST',base+'/select','alice',{game:'dog'});
 const start=await h.api('POST',base+'/ready','alice',{ready:true});
 assert.equal(start.status,200);
 assert.equal(start.room.match.christmas.giftFields.length,10);
 const room=h.docs.get('spielesammlung_hub_v1/'+code);
 room.match.dog.phase='play';
 room.match.dog.current=0;
 room.match.dog.hands=[[{id:999,type:'4'}],[],[],[]];
 room.match.dog.exchanges=[null,null,null,null];
 room.match.dog.pieces[0].place='track';room.match.dog.pieces[0].pos=63;
 h.docs.set('spielesammlung_hub_v1/'+code,room);
 const request={matchId:room.match.id,expectedRevision:room.match.dog.revision,actionId:'christmas-move-001',
  action:{type:'move',cardId:999,as:'4',pieceId:0,steps:4,viaGoal:false,earnedTenths:999999,giftField:62}};
 const result=await h.api('POST',base+'/dog/action','alice',request);
 assert.equal(result.status,200,JSON.stringify(result));
 assert.ok(result.room.match.christmas.claimedFields.includes(3));
 assert.equal(result.room.match.christmas.giftCount,1);
 const balance=(await h.api('GET',base+'/dog/village','alice')).village;
 assert.ok(balance.lightsTenths>=10&&balance.lightsTenths<=20);
 assert.equal(balance.giftsCollected,1);
 const retry=await h.api('POST',base+'/dog/action','alice',request);
 assert.equal(retry.status,200);
 assert.equal((await h.api('GET',base+'/dog/village','alice')).village.lightsTenths,balance.lightsTenths);
 const stale=await h.api('POST',base+'/dog/action','alice',{...request,actionId:'christmas-move-002'});
 assert.equal(stale.status,409);
 assert.equal((await h.api('GET',base+'/dog/village','alice')).village.lightsTenths,balance.lightsTenths);
});

test('authenticated hub scratch route locks all registered variants until a 500-ticket edition is printed',async()=>{
 for(const [tier,variantId] of [
  ['medium','tic_tac_toe'],
  ['medium','number_one_20'],
  ['premium','dog_jackpot_9']
 ]){
  const h=harness({christmasEventActive:()=>true});
  const commandId='scratch-buy-'+variantId;
  const input={tier,variantId,commandId,free:false,voucher:false};
  const bought=await h.api('POST','/api/hub/scratch/buy','alice',input);
  assert.equal(bought.status,409,variantId+': '+bought.error);
  assert.equal(bought.error,'EDITION_NO_ACTIVE_PRINT_RUN');
  const repeated=await h.api('POST','/api/hub/scratch/buy','alice',input);
  assert.equal(repeated.status,409);
  assert.equal(repeated.error,'EDITION_NO_ACTIVE_PRINT_RUN');
  const status=await h.api('GET','/api/hub/scratch','alice');
  assert.equal(status.scratch?.purchased,0);
  const mismatchedTier=await h.api('POST','/api/hub/scratch/buy','alice',{
   ...input,tier:tier==='premium'?'medium':'premium',commandId:'mismatch-'+variantId
  });
  assert.equal(mismatchedTier.status,400);
  assert.equal(mismatchedTier.error,'SCRATCH_INVALID_REQUEST');
 }
});
test('Christmas scratch hub still requires printed editions even when shared free mode is enabled',async()=>{
 const h=harness({christmasEventActive:()=>true});
 const status=await h.api('GET','/api/hub/scratch');
 assert.equal(status.status,200);
 const settings={...status.scratch.settings,freeEnabled:true};
 const saved=await h.api('POST','/api/hub/scratch/settings','alice',{settings});
 assert.equal(saved.status,200,saved.error);
 for(const [tier,variantId] of [
  ['medium','tic_tac_toe'],
  ['medium','number_one_20'],
  ['premium','dog_jackpot_9']
 ]){
  const receipt=await h.api('POST','/api/hub/scratch/buy','alice',{
   tier,variantId,commandId:'free-special-'+variantId,free:true,voucher:false
  });
  assert.equal(receipt.status,409,variantId+': '+receipt.error);
  assert.equal(receipt.error,'EDITION_NO_ACTIVE_PRINT_RUN');
 }
});


test('published edition lights are credited to the shared village exactly once and sold-out runs lock',async()=>{
 const h=harness({christmasEventActive:()=>true});
 const config={variantId:'gifts',title:'Gemeinsame Lichtertal-Lichtlose',
  ticketPrice:100,maxTotalCoins:1000000,maxPerTicketCoins:50000,
  maxPrizesPerTicket:10,maxUnlocks:0,volatility:40,quotas:{},
  symbolBudgets:{lights:{min:2,max:2,minTotal:2,maxTotal:1000,chancePer1000:1000}}};
 const published=await h.api('POST','/api/hub/scratch/editions/publish','alice',{config});
 assert.equal(published.status,200,published.error);
 const editionId=published.edition.id;
 const key='dog_christmas_scratch_editions_v1/'+editionId;
 const doc=h.docs.get(key);assert.ok(doc?.packed);
 const tickets=unpackEditionTickets(doc.packed);
 const lightIndex=tickets.findIndex(ticket=>ticket.totalLights===2);
 assert.ok(lightIndex>=0,'at least one printed ticket grants Christmas lights');
 [tickets[0],tickets[lightIndex]]=[tickets[lightIndex],tickets[0]];
 doc.packed=packEditionTickets(tickets);
 h.docs.set(key,doc);
 const cmd='test-shared-lights-0001';
 const first=await h.api('POST','/api/hub/scratch/buy','alice',{
  tier:'simple',variantId:'gifts',commandId:cmd});
 assert.equal(first.status,200,first.error);
 assert.equal(first.result.totalLights,2);
 assert.equal(first.result.winnings.find(x=>x.type==='lights')?.symbol,'⭐');
 const village=await h.api('GET','/api/hub/christmas-village','alice');
 assert.equal(village.village.lightsTenths,20);
 const replay=await h.api('POST','/api/hub/scratch/buy','alice',{
  tier:'simple',variantId:'gifts',commandId:cmd});
 assert.equal(replay.status,200,replay.error);
 assert.equal(replay.replayed,true);
 const afterward=await h.api('GET','/api/hub/christmas-village','alice');
 assert.equal(afterward.village.lightsTenths,20);
 const full=h.docs.get(key);full.issued=500;h.docs.set(key,full);
 const empty=await h.api('POST','/api/hub/scratch/buy','alice',{
  tier:'simple',variantId:'gifts',commandId:'test-shared-lights-0002'});
 assert.equal(empty.status,409);
 assert.equal(empty.error,'EDITION_NO_ACTIVE_PRINT_RUN');
 const check=await h.api('GET','/api/hub/scratch/editions','alice');
 assert.equal(check.editions.find(x=>x.variantId==='gifts').active.remaining,0);
});
