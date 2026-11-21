import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
const begin=source.indexOf('  function watchRoom(code,store,subscriber){');
const end=source.indexOf('  function attachSocket(ws){',begin);
assert.ok(begin>=0&&end>begin,'real server watcher function is available');
const impl=source.slice(begin,end);
const mk=(kind='dog')=>{
 const timers=new Map(),watchers=[],counts={watchStarts:0,watchStops:0,
  snapshotEvents:0,dogSnapshotEvents:0,duplicateSnapshots:0,watchErrors:0,
  idleSnapshotEvents:0,watchReuses:0,idleWatchExpirations:0};
 let id=0,now=100000,unsubscribes=0;
 const roomStreams=new Map(),syncRoomReads=new Map();
 const ctx={roomStreams,syncRoomReads,hubStreamReadCounts:counts,clock:()=>now,
   HUB_DOG_WATCH_IDLE_GRACE_MS:6000,
   setTimeout:(fn,ms)=>{
    const key=++id;timers.set(key,{fn,ms});return {key,unref(){}};
   },
   clearTimeout:timer=>{timers.delete(timer?.key);},
   documentFor:(_store,code)=>({onSnapshot(fn,err){
     const watcher={code,fn,err,closed:false};watchers.push(watcher);
     return ()=>{unsubscribes++;watcher.closed=true};
   }})
 };
 vm.runInNewContext(impl,ctx);
 const store={},code='123';
 const room=rev=>({code,revision:rev,game:kind,expiresAt:now+100000,
   players:[{uid:'chris'},{uid:'vanessa'},{uid:'david'}]});
 const next=rev=>{const w=watchers.at(-1);w.fn({exists:true,data:()=>room(rev)})};
 const advance=ms=>{now+=ms;for(const [k,timer] of [...timers]){
   if(timer.ms<=ms){timers.delete(k);timer.fn();}
   else timer.ms-=ms;
 }};
 return {ctx,watchers,counts,timers,store,code,roomStreams,room,next,advance,
   stopCount:()=>unsubscribes};
};

test('three DOG players share exactly one Firestore room listener per server instance',()=>{
 const h=mk(),events=[0,0,0];
 const unsubscribe=events.map((_,i)=>h.ctx.watchRoom('123',h.store,()=>events[i]++));
 assert.equal(h.watchers.length,1,'one watcher, not one per player');
 h.next(1);h.next(2);h.next(3);
 assert.deepEqual(events,[3,3,3]);
 assert.equal(h.counts.snapshotEvents,3);
 assert.equal(h.counts.dogSnapshotEvents,3);
 unsubscribe.forEach(fn=>fn());
 assert.equal(h.stopCount(),0,'DOG watcher survives brief lobby-to-game navigation');
 h.advance(6000);
 assert.equal(h.stopCount(),1);
 assert.equal(h.roomStreams.size,0);
});

test('quick DOG reconnect reuses same authoritative listener and its last room snapshot',()=>{
 const h=mk();const received=[];
 const disconnect=h.ctx.watchRoom('123',h.store,room=>received.push(room.revision));
 h.next(1);disconnect();
 assert.equal(h.timers.size,1);
 h.advance(3000);
 const disconnectedAgain=h.ctx.watchRoom('123',h.store,room=>received.push(room.revision));
 assert.equal(h.watchers.length,1,'reconnect must not create a second billed initial watch read');
 assert.equal(h.counts.watchReuses,1);
 assert.equal(h.timers.size,0,'idle stop is canceled');
 assert.deepEqual(received,[1,1],'immediately replay last authoritative Firestore revision');
 h.next(2);
 assert.deepEqual(received,[1,1,2]);
 disconnectedAgain();
 h.advance(6000);
 assert.equal(h.stopCount(),1,'listener eventually closes when no subscribers return');
});

test('a permanently abandoned DOG room stops watching after six seconds',()=>{
 const h=mk();const stop=h.ctx.watchRoom('123',h.store,()=>{});
 h.next(1);stop();
 h.next(2);
 assert.equal(h.counts.idleSnapshotEvents,1,
  'measure extra events observed during grace to assess real savings');
 h.advance(5999);assert.equal(h.stopCount(),0);
 h.advance(1);assert.equal(h.stopCount(),1);
 assert.equal(h.counts.idleWatchExpirations,1);
 const newWatch=h.ctx.watchRoom('123',h.store,()=>{});
 assert.equal(h.watchers.length,2,'next session uses new watch after expiry');
 newWatch(); // no initial snapshot yet, close immediately
 assert.equal(h.stopCount(),2);
});

test('non-DOG rooms never retain a listener without subscribers',()=>{
 const h=mk('skyjo');const stop=h.ctx.watchRoom('123',h.store,()=>{});
 h.next(1);stop();
 assert.equal(h.timers.size,0);
 assert.equal(h.stopCount(),1);
 assert.equal(h.roomStreams.size,0);
});

test('old snapshots invalidated by authoritative commit are not replayed during reconnect',()=>{
 const h=mk();let delivered=0;
 const stop=h.ctx.watchRoom('123',h.store,()=>delivered++);
 h.next(1);stop();
 h.roomStreams.get('123').snapshotAt=null;
 const stop2=h.ctx.watchRoom('123',h.store,()=>delivered++);
 assert.equal(delivered,1,'invalidated old projection must not be replayed');
 h.next(2);
 assert.equal(delivered,2,'new watch result is delivered to reconnected player');
 stop2();h.advance(6000);
});

test('a watch error evicts abandoned timers and notifies connected subscribers',()=>{
 const h=mk();let errored=false;
 const stop=h.ctx.watchRoom('123',h.store,(_room,err)=>{if(err)errored=true});
 h.next(1);const watcher=h.watchers[0];
 watcher.err(new Error('UNAVAILABLE'));
 assert.equal(errored,true);
 assert.equal(h.roomStreams.size,0);
 stop();
 assert.equal(h.timers.size,0);
});
