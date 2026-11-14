import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDealReadDiagnostics} from '../deal-read-diagnostics.js';

test('Read diagnostics separate slot safety reads from HTTP, websocket and scoreboard',()=>{
 let time=7*60000;
 const metrics=createDealReadDiagnostics({clock:()=>time,windowMinutes:5});
 metrics.record('game','httpGame','request');
 metrics.record('game','httpGame','firestoreGet');
 metrics.record('game','slotRecovery','request');
 metrics.record('game','slotRecovery','firestoreGet');
 metrics.record('game','slotRecovery','request');
 metrics.record('game','slotRecovery','cacheHit');
 metrics.record('game','websocketSubscribe','request');
 metrics.record('game','websocketSubscribe','cacheHit');
 metrics.record('room','scoreboard','request');
 metrics.record('room','scoreboard','firestoreGet');
 const state=metrics.snapshot();
 assert.equal(state.lastMinutes.game.slotRecovery.firestoreGet,1);
 assert.equal(state.lastMinutes.game.slotRecovery.cacheHit,1);
 assert.equal(state.lastMinutes.game.httpGame.firestoreGet,1);
 assert.equal(state.lastMinutes.game.websocketSubscribe.cacheHit,1);
 assert.equal(state.lastMinutes.room.scoreboard.firestoreGet,1);
 assert.equal(state.windowMinutes,5);
 assert.ok(Object.keys(state.lastMinutes.game).every(x=>!x.includes('user')));
 assert.match(state.caveat,/not Firebase billing/);
 time+=6*60000;
 assert.equal(metrics.snapshot().lastMinutes.game.slotRecovery.firestoreGet,0,'5-min window expires without polling Firebase');
 assert.equal(metrics.snapshot().totals.game.slotRecovery.firestoreGet,1,'cumulative read count survives local rolling window');
});

test('Read diagnostics safely normalize unknown sources without user IDs',()=>{
 const metrics=createDealReadDiagnostics();
 metrics.record('game','player_secret_uid','firestoreGet');
 metrics.record('room','room_803','request');
 metrics.record('invalid','slotRecovery','firestoreGet');
 const stats=metrics.snapshot();
 assert.equal(stats.lastMinutes.game.other.firestoreGet,1);
 assert.equal(stats.lastMinutes.room.other.request,1);
 assert.equal(stats.lastMinutes.game.slotRecovery.firestoreGet,0);
 assert.equal(JSON.stringify(stats).includes('player_secret_uid'),false);
 assert.equal(JSON.stringify(stats).includes('room_803'),false);
});

test('Deal source attribution and /health remain read-only and separate from payouts',()=>{
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 const api=readFileSync(new URL('../deal-or-no-deal-api.js',import.meta.url),'utf8');
 assert.match(api,/createDealReadDiagnostics\(\)/);
 assert.match(api,/readDiagnostics:\(\)=>dealReadDiagnostics\.snapshot\(\)/);
 assert.match(api,/readGame\(db,code,'websocketSubscribe'\)/);
 assert.match(api,/readGame\(db,joined,'websocketReconcile'\)/);
 assert.match(api,/readGame\(db,code,'scoreboard'\)/);
 assert.match(api,/readGame\(db,code,'rewardStatus'\)/);
 assert.match(api,/req\.query\?\.syncReason==='slot'\?'slotRecovery':'httpGame'/);
 assert.match(api,/dealReadDiagnostics\.record\('game',source,'firestoreGet'\)/);
 assert.match(api,/dealReadDiagnostics\.record\('room',source,'firestoreGet'\)/);
 assert.match(server,/dealReadDiagnostics:dealOrNoDealOnline\.readDiagnostics\(\)/);
 assert.match(api,/tx\.create\(p\.receiptRef/);
 assert.match(api,/db\.runTransaction/);
});
