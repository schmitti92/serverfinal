import test from 'node:test';
import assert from 'node:assert/strict';
import { installSharedLobby } from '../shared-lobby.js';

function harness(){
 let finished=false;
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
 adapter=installSharedLobby(app,{verifyProfile:async token=>identities[token]||null,getFirestore:()=>store,clock:()=>now,codeGenerator:()=>`ABC23${['D','E','F'][id++%3]}`,isMatchFinished:async()=>finished});
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
 return {api,store,docs,identities,advance:ms=>now+=ms,adapter,setFinished(value){finished=value;}};
}

test('Room create, verified membership, host powers and ready reset',async()=>{
 const h=harness(),created=await h.api('POST','/api/hub/rooms');
 assert.equal(created.status,200);const code=created.room.code;assert.equal(code,'ABC23D');assert.equal(created.room.host,true);
 assert.equal((await h.api('GET',`/api/hub/rooms/${code}`,'bob')).status,403);
 const joined=await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');assert.equal(joined.room.players.length,2);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/select`,'bob',{game:'skyjo'})).status,403);
 const selected=await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'skyjo'});assert.equal(selected.room.game,'skyjo');
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 const ready=await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true});
 assert.equal(ready.room.allReady,true);assert.equal(ready.room.canLaunch,false);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/start`,'alice')).status,409);
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
 h.identities.dave={uid:'user_david123',name:'Dave'};
 const spectator=await h.api('POST',`/api/hub/rooms/${code}/join`,'dave');
 assert.equal(spectator.status,200);assert.equal(spectator.room.players.length,4);
 assert.equal(spectator.room.players.find(p=>p.me).participating,false);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/ready`,'dave',{ready:true})).status,403);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/seats`,'bob',{seat:spectator.room.players[3].seat,participating:true})).status,403);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/seats`,'alice',{seat:spectator.room.players[3].seat,participating:true})).status,409);
 const changed=await h.api('POST',`/api/hub/rooms/${code}/seats`,'alice',{seat:spectator.room.players[2].seat,participating:false});
 assert.equal(changed.room.players[2].participating,false);
 const promoted=await h.api('POST',`/api/hub/rooms/${code}/seats`,'alice',{seat:spectator.room.players[3].seat,participating:true});
 assert.equal(promoted.room.players[3].participating,true);
 h.identities.eric={uid:'user_eric123',name:'Eric'};
 h.identities.fred={uid:'user_fred123',name:'Fred'};
 h.identities.gina={uid:'user_gina123',name:'Gina'};
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/join`,'eric')).status,200);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/join`,'fred')).status,200);
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
