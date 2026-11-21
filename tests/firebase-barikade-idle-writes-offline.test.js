import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {barikadeWriteFingerprint} from '../barikade-write-fingerprint.js';

const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');

test('Barikade fingerprint ignores monotonically increasing revision and presence timestamps',()=>{
 const state={phase:'roll',turnColor:'red',paused:true,rev:4,
  scores:{red:5,yellow:2},dice:[1,5]};
 const seat={sessionToken:'s1',profileUid:'alice',name:'Alice',color:'red',
  diceStyle:'classic',isHost:true,lastSeen:1000};
 const original=barikadeWriteFingerprint(state,[seat],'s1');
 assert.match(original,/^[a-f0-9]{64}$/);
 assert.equal(original,barikadeWriteFingerprint({...state,rev:500},
  [{...seat,lastSeen:900000}],'s1'),
 'a revision or reconnect heartbeat must not cause any Firestore save');
 assert.notEqual(original,barikadeWriteFingerprint({...state,turnColor:'yellow'},[seat],'s1'),
 'a real turn change must be persisted');
 assert.notEqual(original,barikadeWriteFingerprint({...state,paused:false},[seat],'s1'),
 'resume/pause transitions must be persisted');
 assert.notEqual(original,barikadeWriteFingerprint(state,
  [{...seat,profileUid:'bob'}],'s1'),'ownership must not leak across players');
 assert.notEqual(original,barikadeWriteFingerprint(state,[seat],'new-host'),
 'host transfer must be durable');
 assert.notEqual(original,barikadeWriteFingerprint(state,
  [{...seat,color:'blue'}],'s1'),'player color selection must be durable');
});
test('Stable seat ordering does not create spurious writes, new seats do',()=>{
 const game={phase:'roll',rev:1};
 const alice={sessionToken:'alice',color:'red',isHost:true,profileUid:'alice'};
 const bob={sessionToken:'bob',color:'yellow',isHost:false,profileUid:'bob'};
 const before=barikadeWriteFingerprint(game,[alice,bob],'alice');
 assert.equal(before,barikadeWriteFingerprint({...game,rev:9},[bob,alice],'alice'));
 assert.notEqual(before,barikadeWriteFingerprint(game,[alice],'alice'));
});

test('Authoritative persistence skips only identical state after successful save',()=>{
 const block=server.slice(server.indexOf('async function persistRoomState(room){'),
  server.indexOf('async function restoreRoomState(room){'));
 assert.ok(block.length>1200,'actual persistence method found');
 assert.match(block,/const signature=barikadeWriteFingerprint\(room\.state,seats,room\.hostToken\)/);
 assert.match(block,/if\(signature&&barikadePersistDigests\.get\(room\)===signature\)/);
 assert.match(block,/barikadePersistCounters\.noopsSkipped\+\+/);
 assert.match(block,/room\.state\.rev\+=1/);
 assert.match(block,/await firestore\.collection\(FIREBASE_COLLECTION\)\.doc\(docId\)\.set\(/);
 assert.match(block,/barikadePersistCounters\.firestoreWrites\+\+/);
 assert.match(block,/if\(signature\)barikadePersistDigests\.set\(room,signature\)/);
 assert.match(block,/barikadePersistCounters\.firestoreFailures\+\+/);
 assert.match(server,/barikadeFirestoreWrites:\{\.\.\.barikadePersistCounters\}/,
 'live Render /health exposes actual and skipped write counters');
});

test('Pause/resume and theme handlers do not persist an already applied setting',()=>{
 const resume=server.slice(server.indexOf('if (msg.type === "resume")'),
  server.indexOf('if (msg.type === "wheel_visual_finished")'));
 assert.match(resume,/if \(room\.state\.paused !== true\)/);
 assert.match(resume,/if \(room\.state\.paused === false\)/);
 assert.match(resume,/await persistRoomState\(room\)/);
 assert.match(resume,/type: "snapshot"/);
 const theme=server.slice(server.indexOf('app.post("/room/:code/board-theme"'),
  server.indexOf('app.post(',server.indexOf('app.post("/room/:code/board-theme"')+12));
 assert.match(theme,/room\.state&&room\.state\.boardTheme!==boardTheme/);
 assert.match(server,/if\(room\.state&&room\.state\.jokerAwardMode!==mode\)/);
});
