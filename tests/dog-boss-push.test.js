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
