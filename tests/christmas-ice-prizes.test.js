import test from 'node:test';
import assert from 'node:assert/strict';
import {giftKind,drawHammer,drawMoney,drawGift,MONEY_PRIZES} from '../christmas-ice-prizes.js';

test('ice picture gifts never award free hammers',()=>{
 const counts={money:0,hammer:0,joker:0};
 for(let i=1;i<=70;i++)counts[giftKind(i)]++;
 assert.deepEqual(counts,{money:47,hammer:0,joker:23});
});
test('hammer wheel boundary weights match 50/35/15',()=>{
 for(let i=0;i<100;i++)assert.equal(drawHammer(()=>i),i<50?'single':i<85?'double':'lucky');
});
test('money prize index matches source prize table',()=>{
 for(let i=0;i<MONEY_PRIZES.length;i++)assert.equal(drawMoney(()=>i),MONEY_PRIZES[i]*100);
});
test('joker gift is fixed and does not require random reads',()=>{
 assert.deepEqual(drawGift(3,()=>{throw Error('should not call')}),{kind:'joker',number:3,peekJokers:1});
});
test('reject invalid picture and random inputs',()=>{
 assert.throws(()=>giftKind(71),/INVALID_PICTURE/);
 assert.throws(()=>drawHammer(()=>100),/INVALID_RANDOM/);
 assert.throws(()=>drawMoney(()=>-1),/INVALID_RANDOM/);
});
