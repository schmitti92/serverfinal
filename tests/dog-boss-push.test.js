import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createDogBossPushHub} from '../dog-boss-push.js';

function fixture(){
 let reads=0,writes=0,verifications=0;
 const sockets=[];
 const team={members:[{uid:'hero-a'},{uid:'hero-b'},{uid:'hero-c'}]};
 const hub=createDogBossPushHub({
  verifyProfile:async token=>{verifications++;return token==='alpha'?{uid:'hero-a'}:
   token==='beta'?{uid:'hero-b'}:token==='outsider'?{uid:'other'}:null},
  getFirestore:()=>({collection:()=>({doc:()=>({get:async()=>{
   reads++;return {exists:true,data:()=>team};
  }})})}),
  setTimer:()=>({unref(){}}),clearTimer:()=>{}
 });
 const make=()=>{
  const ws=new EventEmitter();ws.readyState=1;ws.bufferedAmount=0;ws.sent=[];
  ws.send=text=>ws.sent.push(JSON.parse(text));
  ws.close=(code,reason)=>{ws.readyState=3;ws.closed={code,reason};ws.emit('close')};
  sockets.push(ws);hub.attach(ws);
  return ws;
 };
 const subscribe=async(ws,gate,token)=>{
  ws.emit('message',JSON.stringify({type:'subscribe',idToken:token,gate}));
  for(let i=0;i<20;i++)await Promise.resolve();
 };
 return {hub,make,subscribe,metrics:()=>({reads,writes,verifications})};
}

test('S-04 authenticated team-only hints cost one initial read and zero reads per publish',async()=>{
 const f=fixture();
 const alice=f.make(),bob=f.make();
 await f.subscribe(alice,10,'alpha');
 await f.subscribe(bob,10,'beta');
 assert.equal(f.hub.subscribers(),2);
 assert.deepEqual(alice.sent,[{type:'subscribed',gate:10}]);
 assert.equal(f.metrics().reads,2);
 assert.equal(f.hub.notify(10,'hero-a'),1);
 assert.equal(bob.sent[1].type,'changed');
 assert.equal(bob.sent[1].seq,1);
 assert.equal(alice.sent.length,1,'actor already received authoritative POST view');
 assert.equal(f.hub.notify(20),0,'notifications are gate scoped');
 assert.deepEqual(f.metrics(),{reads:2,writes:0,verifications:2});
 alice.close();bob.close();
 assert.equal(f.hub.subscribers(),0);
});
test('S-04 unauthorized members, invalid tokens and bad gates are denied without state leak',async()=>{
 const f=fixture();
 for(const [gate,token] of [[10,'outsider'],[20,'invalid'],[5,'alpha'],[11,'beta']]){
  const ws=f.make();await f.subscribe(ws,gate,token);
  assert.equal(ws.closed.code,1008);
  assert.equal(ws.sent.some(m=>m.type==='subscribed'||m.type==='changed'),false);
 }
 assert.equal(f.hub.subscribers(),0);
 assert.equal(f.metrics().writes,0);
});
test('S-04 independent groups have isolated event sequence and no private payload',async()=>{
 const f=fixture(),x=f.make(),y=f.make();
 await f.subscribe(x,20,'alpha');
 await f.subscribe(y,10,'beta');
 f.hub.notify(20);
 assert.equal(x.sent[1].seq,1);
 assert.equal(y.sent.length,1);
 f.hub.notify(10);
 assert.equal(y.sent[1].seq,1);
 for(const ws of [x,y])for(const m of ws.sent){
  for(const key of ['uid','idToken','room','damage','bossHp','token','result'])
   assert.equal(Object.hasOwn(m,key),false);
 }
});

test('Public team READY invitations are delivered only to authenticated non-actor teammates without Firestore writes',async()=>{
 const f=fixture();
 const alice=f.make(),bob=f.make(),intruder=f.make(),oldGate=f.make();
 alice.emit('message',JSON.stringify({type:'subscribe',idToken:'alpha',gate:0,scope:'team'}));
 bob.emit('message',JSON.stringify({type:'subscribe',idToken:'beta',gate:0,scope:'team'}));
 intruder.emit('message',JSON.stringify({type:'subscribe',idToken:'outsider',gate:0,scope:'team'}));
 oldGate.emit('message',JSON.stringify({type:'subscribe',idToken:'alpha',gate:10}));
 for(let i=0;i<30;i++)await Promise.resolve();
 assert.deepEqual(alice.sent[0],{type:'subscribed',gate:0});
 assert.deepEqual(bob.sent[0],{type:'subscribed',gate:0});
 assert.equal(intruder.closed.code,1008);
 assert.deepEqual(bob.sent[1],{type:'invite',gate:10,reason:'entered'},'entering the arena immediately invites other online members');
 assert.equal(f.hub.notify(10,'hero-a','ready'),1);
 assert.deepEqual(bob.sent[2],{type:'invite',gate:10,reason:'ready'});
 assert.equal(alice.sent.length,1,'actor is not invited to own arena');
 assert.equal(oldGate.sent.length,1,'actor boss subscriber receives its POST state instead');
 const count=f.hub.notify(10,'hero-a','minigame');
 assert.equal(count,0,'no invitation on other combat actions');
 const invalid=f.make();
 invalid.emit('message',JSON.stringify({type:'subscribe',idToken:'alpha',gate:0}));
 for(let i=0;i<20;i++)await Promise.resolve();
 assert.equal(invalid.closed.code,1008,'gate zero requires team scope');
 assert.equal(f.metrics().writes,0);
});
test('S-04 unauthenticated WS upgrade expires without Firestore reads or leaked subscription',async()=>{
 const timers=new Map();let id=0,reads=0,auths=0;
 const hub=createDogBossPushHub({
  verifyProfile:async()=>{auths++;return {uid:'hero-a'}},
  getFirestore:()=>({collection:()=>({doc:()=>({get:async()=>{reads++;
   return {exists:true,data:()=>({members:[{uid:'hero-a'}]})}
  }})})}),
  setTimer:(fn,ms)=>{const key=++id;timers.set(key,{fn,ms});return key},
  clearTimer:key=>timers.delete(key)
 });
 const ws=new EventEmitter();ws.readyState=1;ws.bufferedAmount=0;ws.sent=[];
 ws.send=value=>ws.sent.push(JSON.parse(value));
 ws.close=(code,reason)=>{ws.readyState=3;ws.closed={code,reason};ws.emit('close')};
 hub.attach(ws);
 assert.equal(timers.size,1);
 assert.equal([...timers.values()][0].ms,10000);
 const entry=[...timers.values()][0];entry.fn();
 assert.equal(ws.closed.code,1008);
 assert.equal(hub.subscribers(),0);
 assert.equal(timers.size,0);
 assert.equal(reads,0);
 assert.equal(auths,0);
});

test('S-04 successful team subscription cancels unauthenticated handshake timeout',async()=>{
 const timers=new Map();let id=0;
 const hub=createDogBossPushHub({
  verifyProfile:async()=>({uid:'hero-a'}),
  getFirestore:()=>({collection:()=>({doc:()=>({get:async()=>({
   exists:true,data:()=>({members:[{uid:'hero-a'}]})
  })})})}),
  setTimer:(fn,ms)=>{const key=++id;timers.set(key,{fn,ms});return key},
  clearTimer:key=>timers.delete(key)
 });
 const ws=new EventEmitter();ws.readyState=1;ws.bufferedAmount=0;ws.sent=[];
 ws.send=value=>ws.sent.push(JSON.parse(value));
 ws.close=(code,reason)=>{ws.readyState=3;ws.closed={code,reason};ws.emit('close')};
 hub.attach(ws);
 ws.emit('message',JSON.stringify({type:'subscribe',idToken:'test',gate:10}));
 for(let i=0;i<20;i++)await Promise.resolve();
 assert.equal(hub.subscribers(),1);
 assert.equal(timers.size,1,'only the 5-minute authorized lifetime timer remains');
 assert.equal([...timers.values()][0].ms,5*60*1000);
 ws.close(1000,'client closes');
 assert.equal(timers.size,0,'authorized connection cleanup');
});
