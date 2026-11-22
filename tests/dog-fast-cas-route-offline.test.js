import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installSharedLobby} from '../shared-lobby.js';
import {createDogChristmasMatch} from '../dog/christmas-village.js';

const openWebSockets=new Set();
afterEach(()=>{for(const socket of [...openWebSockets])socket.close();});

// In-memory Firestore version/precondition simulator. It NEVER contacts
// Firebase and records transaction GETs separately from CAS document UPDATEs.
function harness({fastCasEnabled=true,christmasEventActive=false}={}){
 const docs=new Map(),versions=new Map(),listeners=new Map(),routes=new Map(),middles=[];
 const counted={gets:0,casUpdates:0,transactions:0,watches:0};
 let now=100000;
 const stamp=n=>({toMillis:()=>n});
 const snapshot=path=>{
  const value=docs.get(path),version=versions.get(path)||0;
  return {exists:!!value,data:()=>structuredClone(value),
   updateTime:value?stamp(version):null};
 };
 const notify=path=>{
  for(const callback of listeners.get(path)||[])queueMicrotask(()=>callback(snapshot(path)));
 };
 const save=(path,data)=>{
  docs.set(path,structuredClone(data));
  versions.set(path,(versions.get(path)||0)+1);
  notify(path);
 };
 const db={
  collection:collection=>({doc:id=>{
   const path=collection+'/'+id;
   return {path,
    async get(){counted.gets++;return snapshot(path);},
    async update(data,precondition){
     if(precondition?.lastUpdateTime?.toMillis()!==(versions.get(path)||0)){
      const e=Error('FAILED_PRECONDITION');e.code=9;throw e;
     }
     counted.casUpdates++;save(path,data);
     return {writeTime:stamp(versions.get(path))};
    },
    onSnapshot(onValue){
     counted.watches++;
     const set=listeners.get(path)||new Set();set.add(onValue);
     listeners.set(path,set);
     queueMicrotask(()=>{if(set.has(onValue))onValue(snapshot(path));});
     return ()=>set.delete(onValue);
    }
   };
  }}),
  async runTransaction(fn){
   counted.transactions++;
   // Sequential fake transactions are sufficient for this route test;
   // concurrent CAS conflicts are separately verified by the module tests.
   const writes=[];
   const tx={async get(ref){counted.gets++;return snapshot(ref.path);},
    set(ref,value){writes.push(()=>save(ref.path,value));},
    update(ref,value){writes.push(()=>save(ref.path,value));},
    delete(ref){writes.push(()=>{docs.delete(ref.path);versions.set(ref.path,(versions.get(ref.path)||0)+1);notify(ref.path);});}
   };
   const output=await fn(tx);
   writes.forEach(write=>write());
   return output;
  }
 };
 const app={
  get(path,...handlers){routes.set('GET '+path,handlers);},
  post(path,...handlers){routes.set('POST '+path,handlers);},
  use(path,middleware){middles.push({path,middleware});}
 };
 const auth=async token=>token==='alice'?{uid:'alice',name:'Alice'}:
  token==='bob'?{uid:'bob',name:'Bob'}:
  token==='cara'?{uid:'cara',name:'Cara'}:
  token==='dana'?{uid:'dana',name:'Dana'}:null;
 const adapter=installSharedLobby(app,{verifyProfile:auth,getFirestore:()=>db,
  clock:()=>now,codeGenerator:()=> '123',christmasEventActive:()=>christmasEventActive,
  fastCasEnabled});
 async function api(method,path,token='alice',body={}){
  const key=[...routes.keys()].find(pattern=>{
   if(!pattern.startsWith(method+' '))return false;
   const expected=pattern.slice(method.length+1).split('/');
   const actual=path.split('/');
   return expected.length===actual.length&&expected.every((p,i)=>p.startsWith(':')||p===actual[i]);
  });
  assert.ok(key,'route not registered '+method+' '+path);
  const route=key.slice(method.length+1);
  const pairs=route.split('/').map((name,i)=>[name,path.split('/')[i]])
   .filter(([name])=>name.startsWith(':'));
  const params=Object.fromEntries(pairs.map(([name,value])=>[name.slice(1),value]));
  const req={body,params,method,route:{path:route},
   get:name=>name.toLowerCase()==='authorization'?'Bearer '+token:''};
  const res={statusCode:200,status(n){this.statusCode=n;return this},
   json(value){this.body=value;return this}};
  const callbacks=routes.get(key);
  const invokeRoute=async()=>{
   if(callbacks.length===1)await callbacks[0](req,res);
   else{
    let nextCalled=false;
    await callbacks[0](req,res,()=>{nextCalled=true});
    if(nextCalled)await callbacks[1](req,res);
   }
  };
  const guard=middles.find(m=>path===m.path||path.startsWith(m.path+'/'));
  if(guard){
   let allowed=false;
   await guard.middleware(req,res,()=>{allowed=true;});
   if(allowed)await invokeRoute();
  }else await invokeRoute();
  return {status:res.statusCode,...res.body};
 }
 class FakeWs extends EventEmitter{
  readyState=1;
  messages=[];
  constructor(){super();openWebSockets.add(this);}
  send(raw){this.messages.push(JSON.parse(raw));}
  close(){if(this.readyState===3)return;this.readyState=3;openWebSockets.delete(this);this.emit('close');}
 }
 async function subscribe(code,token='alice'){
  const ws=new FakeWs();adapter.attachSocket(ws);
  ws.emit('message',Buffer.from(JSON.stringify({type:'subscribe',code,profileIdToken:token})));
  for(let attempt=0;attempt<10&&!ws.messages.some(msg=>msg.type==='room');attempt++)
   await new Promise(resolve=>setImmediate(resolve));
  assert.ok(ws.messages.some(msg=>msg.type==='room'),'authenticated stream emitted a room');
  return ws;
 }
 const externalChange=(code,edit,{notifySubscribers=true}={})=>{
  const path='spielesammlung_hub_v1/'+code;
  const updated=structuredClone(docs.get(path));edit(updated);
  updated.revision++;
  if(notifySubscribers)save(path,updated);
  else{
   docs.set(path,updated);
   versions.set(path,(versions.get(path)||0)+1);
  }
 };
 return {api,docs,versions,counted,subscribe,externalChange};
}

test('DOG exchange uses one durable CAS update and zero transactional room reads with live Render stream',async()=>{
 const h=harness();
 const created=await h.api('POST','/api/hub/rooms');
 assert.equal(created.status,200);
 const code=created.room.code;
 const chosen=await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'});
 assert.equal(chosen.status,200);
 const started=await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 assert.equal(started.status,200,JSON.stringify(started));
 assert.equal(started.room.match?.game,'dog');
 assert.equal(started.room.match.christmas?.enabled??false,false);
 const ws=await h.subscribe(code);
 const initial=ws.messages.filter(msg=>msg.type==='room').at(-1).room;
 const cardId=initial.match.dog.hands[0][0].id;
 const payload={matchId:initial.match.id,
  expectedRevision:initial.match.dog.revision,
  actionId:'dog-fast-cas-exchange-1',action:{type:'exchange',cardId}};
 const reads=h.counted.gets;
 const updates=h.counted.casUpdates;
 const response=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','alice',payload);
 assert.equal(response.status,200,JSON.stringify(response));
 assert.equal(h.counted.gets,reads,'no Firestore tx.get on standard DOG exchange');
 assert.equal(h.counted.casUpdates,updates+1,'CAS still durably saves the complete room');
 assert.equal(response.room.match.dog.deck,undefined,'response never leaks draw deck');
 assert.equal(typeof response.room.match.dog.hands[1].count,'number','other hands remain private');
 const pushed=ws.messages.filter(msg=>msg.type==='room').at(-1).room;
 assert.equal(pushed.match.dog.revision,response.room.match.dog.revision);
 assert.equal(pushed.match.dog.deck,undefined,'WebSocket room stays individually filtered');
 const repeated=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','alice',payload);
 assert.equal(repeated.status,200,'replaying committed action returns already confirmed state');
 assert.equal(h.counted.casUpdates,updates+1,'duplicate action never commits a new CAS write');
 const stale=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','alice',
  {...payload,actionId:'dog-fast-cas-exchange-2'});
 assert.equal(stale.status,409,'invalid old revision remains rejected by Firestore transaction');
 ws.close();
});

test('DOG fast CAS remains opt-in: standard action takes classic transaction without flag',async()=>{
 const h=harness({fastCasEnabled:false});
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'});
 const ready=await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 assert.equal(ready.status,200);
 const ws=await h.subscribe(code);
 const state=ws.messages.filter(msg=>msg.type==='room').at(-1).room;
 const reads=h.counted.gets;
 const r=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','alice',{
  matchId:state.match.id,expectedRevision:state.match.dog.revision,
  actionId:'dog-cas-feature-off-1',action:{type:'exchange',cardId:state.match.dog.hands[0][0].id}});
 assert.equal(r.status,200);
 assert.equal(h.counted.gets>reads,true,'original Firestore transaction is retained');
 assert.equal(h.counted.casUpdates,0);
 ws.close();
});

test('Removed room member cannot use cached DOG match roster to commit a move',async()=>{
 const h=harness();
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'});
 const ready=await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 assert.equal(ready.status,200);
 const ws=await h.subscribe(code);
 const state=ws.messages.filter(msg=>msg.type==='room').at(-1).room;
 h.externalChange(code,room=>{room.players=room.players.filter(p=>p.uid!=='alice');});
 await new Promise(resolve=>setImmediate(resolve));
 const baseline=h.counted.casUpdates;
 const response=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','alice',{
  matchId:state.match.id,expectedRevision:state.match.dog.revision,
  actionId:'dog-cas-removed-member-1',
  action:{type:'exchange',cardId:state.match.dog.hands[0][0].id}});
 assert.equal(response.status,403,'membership must be checked by authoritative transaction');
 assert.equal(h.counted.casUpdates,baseline,'no CAS writes after membership was revoked');
 ws.close();
});

test('Three humans exchange using CAS with no computer, no extra Firestore GET and private cards',async()=>{
 const h=harness();
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 for(const name of ['bob','cara'])
  assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/join',name)).status,200);
 assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'})).status,200);
 for(const name of ['alice','bob'])
  assert.equal((await h.api('POST','/api/hub/rooms/'+code+'/ready',name,{ready:true})).status,200);
 const ready=await h.api('POST','/api/hub/rooms/'+code+'/ready','cara',{ready:true});
 assert.equal(ready.status,200);
 assert.equal(ready.room.match.dog.mode,'solo3');
 assert.equal(ready.room.match.dog.players.filter(p=>p.bot).length,0);
 assert.equal(ready.room.match.dog.players.filter(p=>p.inactive).length,1);
 const sockets=await Promise.all(['alice','bob','cara'].map(name=>h.subscribe(code,name)));
 const last=(ws)=>ws.messages.filter(x=>x.type==='room').at(-1).room;
 let successful=0;
 for(let seat=0;seat<3;seat++){
  const ws=sockets[seat],name=['alice','bob','cara'][seat],view=last(ws);
  assert.equal(view.match.dogSeat,seat,'authenticated player projection uses correct seat');
  assert.equal(Array.isArray(view.match.dog.hands[seat]),true);
  for(let other=0;other<3;other++)if(other!==seat)
   assert.equal(Array.isArray(view.match.dog.hands[other]),false,'opponent hand is hidden');
  const cardId=view.match.dog.hands[seat][0].id;
  const before=h.counted.gets;
  const updateCount=h.counted.casUpdates;
  const response=await h.api('POST','/api/hub/rooms/'+code+'/dog/action',name,{
   matchId:view.match.id,expectedRevision:view.match.dog.revision,
   actionId:'dog-cas-three-exchange-'+seat,action:{type:'exchange',cardId}});
  assert.equal(response.status,200,JSON.stringify(response));
  assert.equal(h.counted.gets,before,'an accepted normal DOG exchange is read-free');
  assert.equal(h.counted.casUpdates,updateCount+1,'each move persists before acknowledgement');
  assert.equal(response.room.match.dog.deck,undefined);
  assert.equal(typeof response.room.match.dog.hands[(seat+1)%3].count,'number');
  successful++;
 }
 assert.equal(successful,3);
 assert.equal(last(sockets[0]).match.dog.phase,'play');
 const saved=h.docs.get('spielesammlung_hub_v1/'+code);
 assert.equal(saved.match.dog.revision,ready.room.match.dog.revision+3);
 // Reconnected clients restore from durable server room, not transient UI.
 for(const ws of sockets)ws.close();
 const restored=await h.subscribe(code,'bob');
 assert.equal(last(restored).match.dog.revision,saved.match.dog.revision);
 assert.equal(last(restored).match.dog.deck,undefined);
 restored.close();
});

test('Split-seven steps use CAS and keep correct remaining fields, even on reconnect',async()=>{
 const h=harness();
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 for(const name of ['bob','cara','dana'])
  await h.api('POST','/api/hub/rooms/'+code+'/join',name);
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'});
 for(const name of ['alice','bob','cara','dana'])
  await h.api('POST','/api/hub/rooms/'+code+'/ready',name,{ready:true});
 const ws=await h.subscribe(code,'alice');
 h.externalChange(code,room=>{
  const state=room.match.dog;
  state.phase='play';state.current=0;state.starter=0;
  state.hands=[[{id:9999,type:'7'}],[],[],[]];
  state.exchanges=[null,null,null,null];
  state.seven=null;state.revision=44;
  state.pieces[0].place='track';state.pieces[0].pos=3;
  room.match.dogCommands=[];
 });
 await new Promise(resolve=>setImmediate(resolve));
 const last=()=>ws.messages.filter(msg=>msg.type==='room').at(-1).room;
 const path='/api/hub/rooms/'+code+'/dog/action';
 const execute=async(action,id)=>{
  const view=last(),before=h.counted.gets,updates=h.counted.casUpdates;
  const r=await h.api('POST',path,'alice',{
   matchId:view.match.id,expectedRevision:view.match.dog.revision,
   actionId:id,action});
  assert.equal(r.status,200,JSON.stringify(r));
  assert.equal(h.counted.gets,before,'split-seven move must not GET the room');
  assert.equal(h.counted.casUpdates,updates+1,'split-seven move must be durably saved');
  return r;
 };
 const started=await execute({type:'seven',cardId:9999,as:'7'},'dog-cas-seven-start-01');
 assert.equal(started.room.match.dog.phase,'seven');
 const stepped=await execute({type:'seven-step',pieceId:0,steps:3,viaGoal:false,to:'track:6'},'dog-cas-seven-step-03');
 assert.equal(stepped.room.match.dog.seven.spent,3);
 assert.equal(stepped.room.match.dog.pieces[0].pos,6);
 assert.equal(stepped.room.match.dog.seven.snapshot,undefined);
 const latest=last();
 ws.close();
 const connected=await h.subscribe(code,'alice');
 const restored=connected.messages.filter(msg=>msg.type==='room').at(-1).room;
 assert.equal(restored.match.dog.revision,latest.match.dog.revision);
 assert.equal(restored.match.dog.seven.spent,3);
 const view=restored;
 const lastMove=await h.api('POST',path,'alice',{
  matchId:view.match.id,expectedRevision:view.match.dog.revision,
  actionId:'dog-cas-seven-last-04',
  action:{type:'seven-step',pieceId:0,steps:4,viaGoal:false,to:'track:10'}});
 assert.equal(lastMove.status,200,JSON.stringify(lastMove));
 assert.equal(lastMove.room.match.dog.pieces[0].pos,10);
 assert.equal(lastMove.room.match.dog.seven,null);
 connected.close();
});

test('A revoked player is blocked even when the active WebSocket missed the revocation event',async()=>{
 const h=harness(),code=(await h.api('POST','/api/hub/rooms')).room.code;
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'});
 await h.api('POST','/api/hub/rooms/'+code+'/ready','alice',{ready:true});
 const ws=await h.subscribe(code,'alice');
 const view=ws.messages.filter(x=>x.type==='room').at(-1).room;
 const prior=h.counted.casUpdates;
 h.externalChange(code,room=>{room.players=[];},{notifySubscribers:false});
 const result=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','alice',{
  matchId:view.match.id,expectedRevision:view.match.dog.revision,
  actionId:'dog-cas-revoked-silent-01',
  action:{type:'exchange',cardId:view.match.dog.hands[0][0].id}});
 assert.equal(result.status,403,'Firestore precondition rejects stale cached membership');
 assert.equal(h.counted.casUpdates,prior,'revocation must not allow a write');
 ws.close();
});

test('Seasonal DOG exchanges with zero prizes skip a Firestore GET and still persist all event fields',async()=>{
 const h=harness({christmasEventActive:true});
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 for(const user of ['bob','cara'])await h.api('POST','/api/hub/rooms/'+code+'/join',user);
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'});
 for(const user of ['alice','bob','cara'])await h.api('POST','/api/hub/rooms/'+code+'/ready',user,{ready:true});
 // Existing eligible player with a complete verified seasonal event snapshot.
 h.externalChange(code,room=>{
  room.match.dogChristmasEligibilityChecked=true;
  room.match.christmas=createDogChristmasMatch(null,true,()=>0,room.match.dog.round);
 });
 const ws=await h.subscribe(code,'alice');
 const view=ws.messages.filter(msg=>msg.type==='room').at(-1).room;
 assert.equal(view.match.christmas.enabled,true);
 const beforeReads=h.counted.gets,beforeWrites=h.counted.casUpdates;
 const res=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','alice',{
  matchId:view.match.id,expectedRevision:view.match.dog.revision,
  actionId:'seasonal-exchange-no-prize-1',
  action:{type:'exchange',cardId:view.match.dog.hands[0][0].id}});
 assert.equal(res.status,200,JSON.stringify(res));
 assert.equal(h.counted.gets,beforeReads,'no village/wallet read if no gift was triggered');
 assert.equal(h.counted.casUpdates,beforeWrites+1);
 assert.equal(h.docs.get('spielesammlung_hub_v1/'+code).match.christmas.enabled,true);
 assert.equal(res.room.match.dog.deck,undefined);
 ws.close();
});

test('Seasonal DOG gift remains an atomic Firestore village update, not a fast room-only CAS',async()=>{
 const h=harness({christmasEventActive:true});
 const code=(await h.api('POST','/api/hub/rooms')).room.code;
 for(const user of ['bob','cara','dana'])await h.api('POST','/api/hub/rooms/'+code+'/join',user);
 await h.api('POST','/api/hub/rooms/'+code+'/select','alice',{game:'dog'});
 for(const user of ['alice','bob','cara','dana'])
  await h.api('POST','/api/hub/rooms/'+code+'/ready',user,{ready:true});
 h.externalChange(code,room=>{
  const state=room.match.dog;
  state.phase='play';state.current=0;state.starter=0;
  state.hands=[[{id:9999,type:'4'}],[],[],[]];
  state.exchanges=[null,null,null,null];state.seven=null;
  state.pieces[0].place='track';state.pieces[0].pos=63;
  state.revision=44;
  room.match.dogCommands=[];
  room.match.dogChristmasEligibilityChecked=true;
  const event=createDogChristmasMatch(null,true,()=>0,state.round);
  event.giftFields=[3];event.scratchFields=[];
  room.match.christmas=event;
 });
 const ws=await h.subscribe(code,'alice');
 const view=ws.messages.filter(msg=>msg.type==='room').at(-1).room;
 const beforeReads=h.counted.gets,beforeCas=h.counted.casUpdates;
 const input={
  matchId:view.match.id,expectedRevision:view.match.dog.revision,
  actionId:'seasonal-gift-safe-tx-01',
  action:{type:'move',cardId:9999,as:'4',pieceId:0,steps:4,viaGoal:false}};
 const r=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','alice',input);
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(h.counted.casUpdates,beforeCas,'gift must not take CAS route');
 assert.ok(h.counted.gets>beforeReads,'gift must read village from the old transaction');
 assert.equal(h.docs.get('spielesammlung_hub_v1/'+code).match.christmas.giftCount,1);
 const village=h.docs.get('dog_christmas_village_v1/global');
 assert.ok(village&&village.lightsTenths>0,'village credited exactly once');
 const repeated=await h.api('POST','/api/hub/rooms/'+code+'/dog/action','alice',input);
 assert.equal(repeated.status,200);
 assert.equal(h.docs.get('dog_christmas_village_v1/global').lightsTenths,village.lightsTenths);
 ws.close();
});
