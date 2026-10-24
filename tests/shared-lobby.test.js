import test from 'node:test';
import assert from 'node:assert/strict';
import { installSharedLobby } from '../shared-lobby.js';

function harness(options={}){
 let finished=false,skyjoBootstraps=0;
 let adapter;
 const docs=new Map(),routes=[],middles=[],listeners=new Map();
 const store={
  collection:name=>({doc:code=>({path:name+'/'+code,get:async()=>snapshot(docs.get(name+'/'+code)),
    onSnapshot(cb,_onError){
     const key=name+'/'+code;const set=listeners.get(key)||new Set();set.add(cb);listeners.set(key,set);
     queueMicrotask(()=>{if(set.has(cb))cb(snapshot(docs.get(key)));});
     return ()=>{set.delete(cb);};
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
 const app={get(path,fn){routes.push({method:'GET',path,fn});},post(path,fn){routes.push({method:'POST',path,fn});},use(path,fn){middles.push({path,fn});}};
 const identities={alice:{uid:'user_alice123',name:'Alice'},bob:{uid:'user_bobby123',name:'Bob'},cara:{uid:'user_carol123',name:'Cara'}};
 let id=0,now=1000;
 adapter=installSharedLobby(app,{verifyProfile:options.verifyProfile|| (async token=>identities[token]||null),getFirestore:()=>store,clock:()=>now,codeGenerator:()=>`ABC23${['D','E','F'][id++%3]}`,isMatchFinished:async()=>finished,challengeRandomInt:options.challengeRandomInt,bootstrapSkyjo:async seat=>{skyjoBootstraps++;return {ok:true,rev:1,state:{kind:'skyjo-room-v2',version:2,lobby:{players:seat.members.map(p=>({id:'hub_'+p.uid,name:p.name})),hostId:'hub_'+seat.hostUid,settings:seat.settings,status:'lobby'},game:null}};}});
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
 return {api,store,docs,identities,advance:ms=>now+=ms,adapter,setFinished(value){finished=value;},bootstraps:()=>skyjoBootstraps};
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
 assert.deepEqual(alice.settings,{...settings,layoutMode:'classic'});assert.equal(alice.members.length,2);
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


test('Party Challenge rejects unavailable lengths and starts the three-game format',async()=>{
 for(const count of [5,9]){
  const h=harness(),code=(await h.api('POST','/api/hub/rooms')).room.code;
  await h.api('POST','/api/hub/rooms/'+code+'/join','bob');
  await h.api('POST','/api/hub/rooms/'+code+'/join','cara');
  const selected=await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
  assert.equal(selected.room.game,'partychallenge');
  assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/challenge-settings','bob',{count})).status,400);
  assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/challenge-settings','alice',{count:7})).status,400);
  const blocked=await h.api('POST','/api/hub/rooms/'+code+'/challenge-settings','alice',{count});
  assert.equal(blocked.status,400);
  assert.equal(blocked.error,'CHALLENGE_GAMES_NOT_READY');
  assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/challenge-settings','alice',{count:3})).status,200);
  for(const uid of ['alice','bob','cara'])await h.api('POST','/api/hub/rooms/'+code+'/ready',uid,{ready:true});
  assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/start','bob')).status,403);
  const started=await h.api('POST','/api/hub/rooms/'+code+'/start','alice');
  assert.equal(started.status,200);
  assert.equal(started.room.phase,'playing');
  assert.equal(started.room.match.challenge.order.length,3);
  assert.equal(new Set(started.room.match.challenge.order).size,3);
  assert.equal(started.room.match.challenge.phase,'countdown');
  assert.equal(started.room.match.challenge.startAt,4000);
  assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/start','alice')).status,409);
  const peer=(await h.api('GET','/api/hub/rooms/'+code,'bob')).room;
  assert.deepEqual(peer.match.challenge,started.room.match.challenge);
 }
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
 const h=harness({challengeRandomInt:max=>max-1});
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
 const h=harness({challengeRandomInt:max=>max-1});
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
 const h=harness({challengeRandomInt:max=>max===2?0:max-1});
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
 const answer=ch.math.operator==='×'?ch.math.a*ch.math.b:ch.math.a+ch.math.b;
 const result=await h.api('POST',path,'alice',{challengeId:ch.id,answer});
 assert.equal(result.status,200);
 assert.equal(result.room.match.challenge.phase,'results');
 assert.equal(result.room.match.challenge.results[0].answer,answer);
 assert.equal(result.room.match.challenge.results[0].standings.length,3);
 assert.equal((await h.api('POST',path,'alice',{challengeId:ch.id,answer:999})).status,409);
});


test('Complete three-game Challenge with three participants and final podium',async()=>{
 const h=harness({challengeRandomInt:max=>max-1});
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 await h.api('POST','/api/hub/rooms/'+code+'/challenge-test-players','alice',{enabled:true});
 await h.api('POST','/api/hub/rooms/'+code+'/challenge-settings','alice',{count:3});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const started=await h.api('POST','/api/hub/rooms/'+code+'/start','alice');
 assert.equal(started.status,200);
 const ch=started.room.match.challenge;
 assert.deepEqual(ch.order,['zeitgefuehl','recheninsel','huetchen-challenge']);
 h.advance(3000+ch.targetSeconds*1000);
 const first=await h.api('POST','/api/hub/rooms/'+code+'/challenge-time-stop','alice',{challengeId:ch.id});
 assert.equal(first.status,200);
 assert.equal(first.room.match.challenge.phase,'results');
 assert.equal(first.room.match.challenge.results.length,1);
 const next=await h.api('POST','/api/hub/rooms/'+code+'/challenge-next','alice',{challengeId:ch.id});
 assert.equal(next.status,200);
 assert.equal(next.room.match.challenge.index,1);
 assert.equal(next.room.match.challenge.math.answer,undefined);
 h.advance(3000);
 const q=next.room.match.challenge.math;
 const answer=q.operator==='×'?q.a*q.b:q.a+q.b;
 const last=await h.api('POST','/api/hub/rooms/'+code+'/challenge-math-answer','alice',{challengeId:ch.id,answer});
 assert.equal(last.status,200);
 assert.equal(last.room.match.challenge.phase,'results');
 const toH=await h.api('POST','/api/hub/rooms/'+code+'/challenge-next','alice',{challengeId:ch.id});
 assert.equal(toH.status,200);
 assert.equal(toH.room.match.challenge.index,2);
 let roundState=toH;
 for(const [i,shuffle] of [7160,7390,7140].entries()){
  h.advance(3000+shuffle+12000);
  roundState=await h.api('POST','/api/hub/rooms/'+code+'/challenge-huetchen-timeout','alice',{challengeId:ch.id,round:i+1});
  assert.equal(roundState.status,200);
 }
 const final=roundState.room.match.challenge;
 assert.equal(final.phase,'finished');
 assert.equal(final.results.length,3);
 assert.equal(final.totals.length,3);
 assert.equal(final.totals.reduce((sum,p)=>sum+p.points,0),final.points.reduce((a,b)=>a+b,0));
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/challenge-next','alice',{challengeId:ch.id})).status,409);
});


test('New Party Challenge defaults to supported three-game setup and starts with bots without saving settings',async()=>{
 const h=harness({challengeRandomInt:max=>max-1});
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 const selected=await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'partychallenge'});
 assert.equal(selected.status,200);
 assert.equal(selected.room.settings.count,3);
 await h.api('POST','/api/hub/rooms/'+code+'/challenge-test-players','alice',{enabled:true});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const started=await h.api('POST','/api/hub/rooms/'+code+'/start','alice');
 assert.equal(started.status,200);
 assert.equal(started.room.match.challenge.order.length,3);
 assert.equal(started.room.match.playerCount,3);
});

test('Hütchen rejects answers before shuffle and after deadline',async()=>{
 const h=harness({challengeRandomInt:max=>max===3?1:0});
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
