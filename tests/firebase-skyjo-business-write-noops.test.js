import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');

test('SKYJO identical states never create a new revision while Firestore write is pending',()=>{
 const block=source.slice(source.indexOf('const SKYJO_MAX_STATE_BYTES'),source.indexOf('// ---------- DAS GROSSE BUSINESS:'));
 assert.ok(block.length>5000);
 assert.match(block,/const skyjoFirebaseConfirmedRev = new Map\(\)/);
 assert.match(block,/skyjoFirebaseConfirmedRev\.set\(rc,p\.rev\)/);
 assert.match(block,/if\(cur&&JSON\.stringify\(cur\.state\)===raw\)/);
 assert.match(block,/const confirmed=skyjoFirebaseConfirmedRev\.has\(rc\)/);
 assert.match(block,/skyjoFirebaseLatestOp\.has\(rc\)/);
 assert.match(block,/skyjoFirebaseWorkers\.has\(rc\)/);
 assert.match(block,/queueSkyjoFirebaseOp\(rc,\{type:"set",payload:\{/);
 assert.match(block,/source:confirmed\?"firestore-synced":"memory-pending"/);
 assert.ok(block.indexOf('await ref.set(')<block.indexOf('skyjoFirebaseConfirmedRev.set(rc,p.rev)'),
  'a revision is only Firebase-confirmed once saved');
 assert.ok(block.indexOf('if(cur&&JSON.stringify(cur.state)===raw)')<
  block.indexOf('const rev=curRev+1'),
  'deduplication must happen BEFORE incrementing the revision');
 assert.match(block,/if\(baseRev!=null && Number\(baseRev\)!==curRev\)/,
  'stale revisions must still be rejected');
});

test('Business identical states never duplicate Firestore writes during slow acknowledgement',()=>{
 const block=source.slice(source.indexOf('const BUSINESS_MAX_STATE_BYTES'),source.indexOf('function normalizeBusinessName'));
 assert.ok(block.length>5000);
 assert.match(block,/const businessFirebaseConfirmedRev = new Map\(\)/);
 assert.match(block,/businessFirebaseConfirmedRev\.set\(rc,p\.rev\)/);
 assert.match(block,/if\(cur&&JSON\.stringify\(cur\.state\)===raw\)/);
 assert.match(block,/businessFirebaseLatestOp\.has\(rc\)/);
 assert.match(block,/businessFirebaseWorkers\.has\(rc\)/);
 assert.match(block,/queueBusinessFirebaseOp\(rc,\{type:"set",payload:\{/);
 assert.match(block,/source:confirmed\?"firestore-synced":"memory-pending"/);
 assert.ok(block.indexOf('await ref.set(')<block.indexOf('businessFirebaseConfirmedRev.set(rc,p.rev)'));
 assert.ok(block.indexOf('if(cur&&JSON.stringify(cur.state)===raw)')<
  block.indexOf('const rev=curRev+1'));
 assert.match(block,/if\(baseRev!=null && Number\(baseRev\)!==curRev\)/);
});
