import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from '../dog/engine.js';
import {createDogPostgresPrivateFanout} from '../dog-postgres-private-fanout.js';

const clone=v=>structuredClone(v);
function startingRoom(){
 const ids=['alice','bob','cara'];
 return {code:'123',revision:7,phase:'playing',game:'dog',expiresAt:9999999999999,
  players:ids.map((uid,seat)=>({uid,seat,participating:true})),
  match:{id:'match-verified-2026',game:'dog',
   dogRoster:[...ids.map((uid,seat)=>({uid,seat,bot:false,inactive:false})),
    {uid:null,seat:3,bot:false,inactive:true}],
   dog:createGame({names:['Alice','Bob','Cara','Free'],
    bots:[false,false,false,false],inactiveSeats:[3],rng:()=>0.27})}};
}
function harness(){
 const state={room:startingRoom(),events:[],acks:[],gets:0};
 let nextId=1;
 const store={
  async getRoom(code){
   state.gets++;
   if(!state.room||code!==state.room.code)return null;
   return {room:clone(state.room),version:state.room.revision};
  },
  async pendingEvents(limit=100){return clone(state.events.slice(0,limit));},
  async acknowledgeEvent(id){
   const i=state.events.findIndex(x=>x.event_id===id);
   if(i<0)throw Error('UNKNOWN_EVENT');
   state.acks.push(id);state.events.splice(i,1);
  }
 };
 const commit=(edit=()=>{})=>{
  const before=state.room;
  state.room=clone(before);
  edit(state.room);
  state.room.revision++;
  state.events.push({event_id:nextId++,room_code:'123',
   match_id:state.room.match.id,room_version:state.room.revision,topic:'room-changed'});
 };
 const subscribe=(fanout,uid,received)=>{
  return fanout.subscribe({code:'123',identity:{uid},send:msg=>received.push(msg)});
 };
 return {state,store,commit,subscribe};
}

test('Three real subscribers receive separate private DOG hands from durable SQL snapshots',async()=>{
 const h=harness(),fanout=createDogPostgresPrivateFanout({store:h.store});
 const output=[[],[],[]],stops=[];
 for(const [seat,uid]of ['alice','bob','cara'].entries()){
  stops.push(await h.subscribe(fanout,uid,output[seat]));
  const initial=output[seat][0];
  assert.equal(initial.type,'room');
  assert.equal(initial.room.dogSeat,seat);
  assert.equal(initial.room.dog.deck,undefined);
  assert.equal(initial.room.dog.discard,undefined);
  assert.ok(Array.isArray(initial.room.dog.hands[seat]));
  for(let other=0;other<4;other++)
   if(other!==seat){
    assert.equal(Array.isArray(initial.room.dog.hands[other]),false);
    assert.equal(typeof initial.room.dog.hands[other].count,'number');
   }
 }
 h.commit(room=>{room.match.dog.revision++;room.match.dog.lastPlayedCard={type:'7',seat:0}});
 const delivered=await fanout.pollOnce();
 assert.deepEqual(delivered,{processed:1,pending:0});
 assert.equal(h.state.events.length,0);
 for(const arr of output)assert.equal(arr.length,2,'one private push after durable outbox commit');
 assert.equal(fanout.stats().activeSockets,3);
 assert.equal(fanout.stats().acknowledged,1);
 for(const stop of stops)stop();
 assert.equal(fanout.stats().activeSockets,0);
});

test('Duplicate outbox pointers and multiple changes per room send only latest version',async()=>{
 const h=harness(),fanout=createDogPostgresPrivateFanout({store:h.store});
 const received=[];const stop=await h.subscribe(fanout,'alice',received);
 h.commit(room=>{room.match.dog.revision++;});
 h.commit(room=>{room.match.dog.revision++;});
 assert.equal(h.state.events.length,2);
 const result=await fanout.pollOnce();
 assert.deepEqual(result,{processed:2,pending:0});
 assert.equal(received.length,2,'initial plus one newest snapshot, not two old payloads');
 assert.equal(received.at(-1).room.revision,9);
 assert.ok(fanout.stats().duplicates>=1);
 assert.equal(h.state.gets,2,'one initial read plus one per-room read for this batch');
 stop();
});

test('A failing socket does not ACK the event; retry never resends to successful viewers',async()=>{
 const h=harness(),fanout=createDogPostgresPrivateFanout({store:h.store});
 const alice=[],bob=[];
 const stopA=await h.subscribe(fanout,'alice',alice);
 let broken=false;
 const stopB=await fanout.subscribe({code:'123',identity:{uid:'bob'},
  send:msg=>{if(broken)throw Error('SOCKET_TRANSPORT_FAIL');bob.push(msg)}});
 broken=true;
 h.commit(room=>{room.match.dog.revision++});
 assert.deepEqual(await fanout.pollOnce(),{processed:0,pending:1});
 assert.equal(h.state.acks.length,0,'never ACK before successful delivery');
 assert.equal(alice.length,2);
 assert.equal(bob.length,1);
 broken=false;
 assert.deepEqual(await fanout.pollOnce(),{processed:1,pending:0});
 assert.equal(alice.length,2,'already delivered revision cannot be sent twice');
 assert.equal(bob.length,2);
 assert.equal(h.state.acks.length,1);
 stopA();stopB();
});

test('Unsubscribed client is never sent further state; reconnect receives latest room',async()=>{
 const h=harness(),fanout=createDogPostgresPrivateFanout({store:h.store});
 const messages=[];const stop=await h.subscribe(fanout,'alice',messages);
 stop();
 h.commit(room=>{room.match.dog.revision++});
 await fanout.pollOnce();
 assert.equal(messages.length,1);
 const reconnect=[];
 const release=await h.subscribe(fanout,'alice',reconnect);
 assert.equal(reconnect.length,1);
 assert.equal(reconnect[0].room.revision,8);
 assert.equal(reconnect[0].room.dog.deck,undefined);
 release();
});

test('Removed room member gets no payload, including when old outbox entry arrives late',async()=>{
 const h=harness(),fanout=createDogPostgresPrivateFanout({store:h.store});
 const bob=[];const stop=await h.subscribe(fanout,'bob',bob);
 h.commit(room=>{room.players=room.players.filter(p=>p.uid!=='bob')});
 await fanout.pollOnce();
 assert.equal(bob.length,1);
 assert.equal(fanout.stats().revoked,1);
 assert.equal(fanout.stats().activeSockets,0);
 await assert.rejects(()=>h.subscribe(fanout,'bob',[]),/DOG_NOT_A_ROOM_MEMBER/);
 stop();
});

test('Old-match outbox is ACKed as stale; future match state is not leaked',async()=>{
 const h=harness(),fanout=createDogPostgresPrivateFanout({store:h.store});
 const views=[];const stop=await h.subscribe(fanout,'cara',views);
 h.state.events.push({event_id:99,room_code:'123',match_id:'old-match',
  room_version:6,topic:'room-changed'});
 assert.deepEqual(await fanout.pollOnce(),{processed:1,pending:0});
 assert.equal(views.length,1);
 assert.equal(fanout.stats().staleEvents,1);
 stop();
});

test('Outbox ahead of room is not acknowledged; prevents fabricated future state',async()=>{
 const h=harness(),fanout=createDogPostgresPrivateFanout({store:h.store});
 h.state.events.push({event_id:100,room_code:'123',
  match_id:h.state.room.match.id,room_version:80,topic:'room-changed'});
 await assert.rejects(()=>fanout.pollOnce(),/DOG_OUTBOX_AHEAD_OF_DURABLE_ROOM/);
 assert.equal(h.state.acks.length,0);
 assert.equal(h.state.events.length,1);
});

test('Joining during a concurrent push never rewinds to an older room revision',async()=>{
 const h=harness();
 const early=clone(h.state.room);
 let releaseInitial=null,first=true;
 const guarded={
  ...h.store,
  getRoom:async code=>{
   if(first){
    first=false;
    return new Promise(resolve=>{releaseInitial=()=>resolve({room:clone(early),version:7})});
   }
   return h.store.getRoom(code);
  }
 };
 const fanout=createDogPostgresPrivateFanout({store:guarded});
 const received=[];
 const pending=fanout.subscribe({code:'123',identity:{uid:'alice'},
  send:msg=>received.push(msg)});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(typeof releaseInitial,'function');
 h.commit(room=>{room.match.dog.revision++});
 await fanout.pollOnce();
 assert.equal(received.at(-1).room.revision,8);
 releaseInitial();
 const stop=await pending;
 assert.equal(received.at(-1).room.revision,8,'late initial read is ignored');
 assert.equal(received.length,1);
 stop();
});

test('Socket authentication is mandatory; counts never contain private identifiers',async()=>{
 const h=harness(),fanout=createDogPostgresPrivateFanout({store:h.store});
 await assert.rejects(()=>fanout.subscribe({code:'123',send:()=>{}}),
  /DOG_SOCKET_AUTH_REQUIRED/);
 const seen=[],release=await h.subscribe(fanout,'alice',seen);
 assert.equal(JSON.stringify(fanout.stats()).includes('alice'),false);
 assert.equal(JSON.stringify(fanout.stats()).includes('123'),false);
 assert.equal(JSON.stringify(fanout.stats()).includes('deck'),false);
 release();
});
