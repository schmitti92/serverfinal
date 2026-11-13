import test from 'node:test';
import assert from 'node:assert/strict';
import {DOG_S2_CARDS,DOG_S2_BOARDS,DOG_S2_PACKS,dogS2Progress,dogS2Draw,dogS2Discoveries,dogS2Duplicates,dogS2Redeem} from '../dog-album-season2.js';

test('DOG season 2 has six distinct 4x4 themes and 96 distinct uploaded image paths',()=>{
 assert.equal(DOG_S2_BOARDS.length,6);
 assert.equal(DOG_S2_CARDS.length,96);
 assert.equal(new Set(DOG_S2_CARDS.map(c=>c.id)).size,96);
 assert.equal(new Set(DOG_S2_CARDS.map(c=>c.image)).size,96);
 DOG_S2_BOARDS.forEach((name,i)=>{
  const board=DOG_S2_CARDS.slice(i*16,i*16+16);
  assert.equal(board.length,16);
  assert.ok(board.every(c=>c.series===name&&c.board===i+1&&c.image.endsWith('.png')));
 });
});
test('new players start with empty progress and complete six boards with 60 lines',()=>{
 assert.deepEqual(dogS2Progress({}).boards.map(b=>b.bingos),[0,0,0,0,0,0]);
 assert.equal(dogS2Progress({}).collected,0);
 const full=Object.fromEntries(DOG_S2_CARDS.map(c=>[c.id,1]));
 const progress=dogS2Progress(full);
 assert.equal(progress.total,96);
 assert.equal(progress.collected,96);
 assert.equal(progress.bingos,60);
 assert.equal(progress.maxBingos,60);
 assert.equal(progress.rewardsEnabled,false);
});
test('card packs draw from DOG season 2 and mark new discoveries correctly',()=>{
 for(const pack of DOG_S2_PACKS){
  const drawn=dogS2Draw(pack);
  assert.equal(drawn.length,pack.count);
  assert.ok(drawn.every(c=>c.id.startsWith('dog2-')));
 }
 const first=DOG_S2_CARDS[0];
 const drawn=dogS2Discoveries([first,first],{});
 assert.deepEqual(drawn.map(c=>c.isNew),[true,false]);
 assert.equal(dogS2Discoveries([first],{[first.id]:1})[0].isNew,false);
});
test('duplicate exchange never removes a first copy',()=>{
 const cards=Object.fromEntries(DOG_S2_CARDS.map(c=>[c.id,3]));
 assert.equal(dogS2Duplicates(cards).available,192);
 const exchanged=dogS2Redeem(cards);
 assert.equal(dogS2Duplicates(exchanged).available,92);
 assert.ok(DOG_S2_CARDS.every(c=>exchanged[c.id]>=1));
 assert.equal(cards[DOG_S2_CARDS[0].id],3,'input must not be mutated');
 assert.throws(()=>dogS2Redeem({}),/INSUFFICIENT_DUPLICATES/);
});
