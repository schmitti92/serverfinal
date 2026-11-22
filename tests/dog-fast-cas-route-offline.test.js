import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installSharedLobby} from '../shared-lobby.js';

// In-memory Firestore version/precondition simulator. It NEVER contacts
// Firebase and records transaction GETs separately from CAS document UPDATEs.
function harness({fastCasEnabled=true}={}){
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
  token==='bob'?{uid:'bob',name:'Bob'}:null;
 const adapter=installSharedLobby(app,{verifyProfile:auth,getFirestore:()=>db,
  clock:()=>now,codeGenerator:()=> '123',christmasEventActive:()=>false,
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
  send(raw){this.messages.push(JSON.parse(raw));}
  close(){this.readyState=3;this.emit('close');}
 }
 async function subscribe(code,token='alice'){
  const ws=new FakeWs();adapter.attachSocket(ws);
  ws.emit('message',Buffer.from(JSON.stringify({type:'subscribe',code,profileIdToken:token})));
  for(let attempt=0;attempt<10&&!ws.messages.some(msg=>msg.type==='room');attempt++)
   await new Promise(resolve=>setImmediate(resolve));
  assert.ok(ws.messages.some(msg=>msg.type==='room'),'authenticated stream emitted a room');
  return ws;
 }
 const externalChange=(code,edit)=>{
  const path='spielesammlung_hub_v1/'+code;
  const updated=structuredClone(docs.get(path));edit(updated);
  updated.revision++;
  save(path,updated);
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
