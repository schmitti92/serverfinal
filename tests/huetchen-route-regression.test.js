import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Hütchen answer route is registered exactly once',async()=>{
 const source=await readFile(new URL('../shared-lobby.js',import.meta.url),'utf8');
 const matches=source.match(/app\.post\('\/api\/hub\/rooms\/:code\/challenge-huetchen-answer'/g)||[];
 assert.equal(matches.length,1,'duplicate route may shadow authoritative answer validation');
});

test('Hütchen answer validation requires shuffle completion and one answer per user',async()=>{
 const source=await readFile(new URL('../shared-lobby.js',import.meta.url),'utf8');
 assert.match(source,/HUETCHEN_STILL_SHUFFLING/);
 assert.match(source,/Object\.hasOwn\(h\.answers,identity\.uid\)/);
 assert.match(source,/h\.answers\[identity\.uid\]=\{slot,at:clock\(\)\}/);
});
