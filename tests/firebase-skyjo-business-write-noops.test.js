import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');

test('SKYJO only skips an identical state after successful Firestore acknowledgement',()=>{
 const block=source.slice(source.indexOf('const SKYJO_MAX_STATE_BYTES'),source.indexOf('// ---------- DAS GROSSE BUSINESS:'));
 assert.ok(block.length>5000);
 assert.match(block,/const skyjoFirebaseConfirmedRev = new Map\(\)/);
 assert.match(block,/skyjoFirebaseConfirmedRev\.set\(rc,p\.rev\)/);
 assert.match(block,/skyjoFirebaseConfirmedRev\.has\(rc\)/);
 assert.match(block,/skyjoFirebaseConfirmedRev\.get\(rc\)>=curRev/);
 assert.match(block,/JSON\.stringify\(cur\.state\)===raw/);
 assert.match(block,/source:"firestore-synced",firebaseQueued:false,unchanged:true/);
 assert.ok(block.indexOf('await ref.set(')<block.indexOf('skyjoFirebaseConfirmedRev.set(rc,p.rev)'),
  'do not acknowledge a write before Firestore actually completes it');
 assert.match(block,/if\(baseRev!=null && Number\(baseRev\)!==curRev\)/,
  'concurrency validation must still reject stale revisions');
});

test('Business skips only Firebase-confirmed identical state and retains failed-write retries',()=>{
 const block=source.slice(source.indexOf('const BUSINESS_MAX_STATE_BYTES'),source.indexOf('function normalizeBusinessName'));
 assert.ok(block.length>5000);
 assert.match(block,/const businessFirebaseConfirmedRev = new Map\(\)/);
 assert.match(block,/businessFirebaseConfirmedRev\.set\(rc,p\.rev\)/);
 assert.match(block,/businessFirebaseConfirmedRev\.has\(rc\)/);
 assert.match(block,/businessFirebaseConfirmedRev\.get\(rc\)>=curRev/);
 assert.match(block,/JSON\.stringify\(cur\.state\)===raw/);
 assert.match(block,/source:"firestore-synced",firebaseQueued:false,unchanged:true/);
 assert.ok(block.indexOf('await ref.set(')<block.indexOf('businessFirebaseConfirmedRev.set(rc,p.rev)'));
 assert.match(block,/if\(baseRev!=null && Number\(baseRev\)!==curRev\)/);
});
