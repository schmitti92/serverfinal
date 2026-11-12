import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate,sample,TARGET_ITEMS} from '../dog-f01-simulation.mjs';
test('F-01 simulation is deterministic and uses the four documented target upgrades',()=>{
 assert.deepEqual(TARGET_ITEMS,['weapon','armor','attack_power','vitality']);
 const first=simulate(42,100);
 assert.deepEqual(first,simulate(42,100));
 assert.ok(first.matches<=100);
 assert.ok(first.chapters.every(x=>x.totalMatches>=0&&x.failures>=0));
});
test('F-01 bounded sample reports percentiles without database access',()=>{
 const rows=sample(2);
 assert.equal(rows.length,10);
 assert.equal(rows[0].boss,10);
 assert.equal(rows[9].boss,100);
 assert.ok(rows.every(x=>x.p10===null||x.p10<=x.median&&x.median<=x.p90));
});
