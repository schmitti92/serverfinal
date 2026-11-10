import test from 'node:test';
import assert from 'node:assert/strict';
import {HATS_MAX_ROOM,HATS_SUPER_ODDS,drawHatsRoom,scoreHatsPrize} from '../christmas-hats-api.js';

test('ten rooms and escalating Superglück chances',()=>{
 assert.equal(HATS_MAX_ROOM,10);
 assert.deepEqual(HATS_SUPER_ODDS,[2,2,2,5,5,5,10,10,15,15]);
});

test('one bomb, normal and strictly better gift in every room',()=>{
 for(let room=1;room<=10;room++)for(let i=0;i<500;i++){
  const hats=drawHatsRoom(room);
  assert.equal(hats.length,3);
  assert.deepEqual(hats.map(h=>h.type).sort(),['bomb','gift','super']);
  const ordinary=hats.find(h=>h.type==='gift'),better=hats.find(h=>h.type==='super');
  assert.ok(scoreHatsPrize(better)>scoreHatsPrize(ordinary),'better must be worth more');
  for(const h of [ordinary,better]){
   assert.ok(h.items.length>=1&&h.items.length<=5);
   const distinct=new Set();
   for(const item of h.items){
    assert.ok(Number.isInteger(item.quantity)&&item.quantity>=1&&item.quantity<=3);
    if(item.kind==='cash'){
     assert.ok(Number.isSafeInteger(item.amountCents));
     assert.ok(item.amountCents>=1&&item.amountCents<=500000000,'max five million euros');
    }
    const key=[item.kind,item.packId,item.hammer].join(':');
    assert.ok(!distinct.has(key),'one reward category only once per hat');
    distinct.add(key);
   }
   if(room<=3&&!h.superLuck){
    assert.ok(h.items.every(item=>item.kind==='hammer'&&item.hammer==='single'||item.kind==='pack'&&item.packId==='small'),
     'rooms 1–3 are limited to ordinary packs and simple hammers');
   }
  }
 }
});

test('rejects invalid rooms',()=>{
 for(const number of [0,11,-5,1.5,'7'])assert.throws(()=>drawHatsRoom(number),/INVALID_ROOM/);
});

test('Superglück is reachable even in the first room',()=>{
 let found=false;
 for(let i=0;i<4000&&!found;i++)found=drawHatsRoom(1).some(h=>h.superLuck);
 assert.equal(found,true);
});
