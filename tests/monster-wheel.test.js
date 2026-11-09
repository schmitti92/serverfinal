import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MONSTER_WHEEL_DURATION_MS,MONSTER_WHEEL_SLOTS,drawMonsterWheel,monsterWheelPrizeSummary,checkMonsterBalance} from '../monster-wheel.js';

const slots=MONSTER_WHEEL_SLOTS;
const byId=id=>slots.find(s=>s.id===id);
test('21 equal-weight Monster stops preserve repeated single prizes',()=>{
 assert.equal(MONSTER_WHEEL_DURATION_MS,8000);
 assert.equal(slots.length,21);
 assert.equal(new Set(slots.map(s=>s.id)).size,21);
 assert.equal(slots.filter(s=>s.id.startsWith('single-1-')).length,3);
 assert.equal(slots.filter(s=>s.id.startsWith('lucky-1-')).length,3);
 assert.equal(slots.filter(s=>s.id.startsWith('joker-1-')).length,3);
 assert.equal(byId('cash-10m').quantity,1000000000);
 assert.equal(byId('cash-2m').quantity,200000000);
 assert.equal(byId('gold-4').quantity,4);
 assert.equal(byId('gold-5').quantity,5);
 assert.equal(byId('premium-3').quantity,3);
 assert.equal(byId('lucky-10').quantity,10);
 assert.equal(byId('lucky-5').quantity,5);
 assert.equal(byId('lucky-3').quantity,3);
 assert.equal(byId('double-5').quantity,5);
 assert.equal(byId('joker-5').quantity,5);
});
test('each slot is actually drawable and consistent with its physical index',()=>{
 for(let i=0;i<slots.length;i++){
  const prize=drawMonsterWheel({},()=>i);
  assert.equal(prize.index,i);
  assert.equal(prize.id,slots[i].id);
 }
});
test('repeat Giftzwerg prize is excluded when character was already unlocked',()=>{
 const available=slots.filter(s=>s.kind!=='avatar');
 for(let i=0;i<available.length;i++){
  const prize=drawMonsterWheel({giftzwergUnlocked:true},()=>i);
  assert.notEqual(prize.kind,'avatar');
  assert.equal(prize.id,available[i].id);
  assert.equal(prize.index,slots.findIndex(s=>s.id===prize.id));
 }
});
test('random cash never leaves 100 to 2 million Euro bounds',()=>{
 let calls=0;
 let prize=drawMonsterWheel({},(...args)=>{
  calls++;return args.length===1?3:args[0];
 });
 assert.equal(calls,2);
 assert.equal(prize.amountCents,10000);
 assert.equal(monsterWheelPrizeSummary(prize),'100 € Spielgeld');
 prize=drawMonsterWheel({},(...args)=>args.length===1?3:args[1]-1);
 assert.equal(prize.amountCents,200000000);
});
test('amount calculations use safe integer cent accounting',()=>{
 assert.equal(checkMonsterBalance(20000000,1000000000),1020000000);
 assert.throws(()=>checkMonsterBalance(Number.MAX_SAFE_INTEGER,1),/OVERFLOW/);
 assert.throws(()=>checkMonsterBalance(-1,1),/OVERFLOW/);
 assert.throws(()=>checkMonsterBalance(999998,5,1000000),/OVERFLOW/);
 assert.equal(monsterWheelPrizeSummary(drawMonsterWheel({},()=>0)),'10.000.000 € Spielgeld');
});
