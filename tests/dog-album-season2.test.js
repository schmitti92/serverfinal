import test from 'node:test';
import assert from 'node:assert/strict';
import {DOG_S2_CARDS,DOG_S2_BOARDS,DOG_S2_PACKS,DOG_S2_SPECIAL_CARD_SLOTS,DOG_S2_CARD_WEIGHT_BASE,dogS2CardDrawWeight,dogS2Progress,dogS2Draw,dogS2Discoveries,dogS2Duplicates,dogS2Redeem,dogS2OpenGrantedPacks} from '../dog-album-season2.js';

test('DOG album package prices use the November 2026 server-authoritative values',()=>{
 const expected={small:100000000,large:200000000,premium:300000000,platinum:1000000000};
 assert.deepEqual(Object.fromEntries(DOG_S2_PACKS.map(pack=>[pack.id,pack.price])),expected);
 assert.deepEqual(DOG_S2_PACKS.map(pack=>pack.count),[3,7,12,16]);
 assert.deepEqual(DOG_S2_PACKS.map(pack=>pack.price/100),[1000000,2000000,3000000,10000000],'shop displays prices in euros while server stores cents');
});

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
 assert.equal(progress.rewardsEnabled,true);
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

test('each 16-card DOG board has exactly three cards at 1/3 and two at 1/5 of normal drawing weight',()=>{
 assert.equal(DOG_S2_SPECIAL_CARD_SLOTS.length,DOG_S2_BOARDS.length);
 assert.equal(DOG_S2_CARD_WEIGHT_BASE,15);
 for(let index=0;index<DOG_S2_BOARDS.length;index++){
  const board=DOG_S2_CARDS.filter(c=>c.board===index+1);
  const weights=board.map(dogS2CardDrawWeight);
  assert.equal(board.length,16);
  assert.equal(weights.filter(w=>w===15).length,11,'11 ordinary cards in '+DOG_S2_BOARDS[index]);
  assert.equal(weights.filter(w=>w===5).length,3,'3 cards with 3x fewer tickets');
  assert.equal(weights.filter(w=>w===3).length,2,'2 cards with 5x fewer tickets');
  const special=DOG_S2_SPECIAL_CARD_SLOTS[index];
  assert.equal(new Set([...special.triple,...special.quintuple]).size,5);
  assert.ok([...special.triple,...special.quintuple].every(slot=>slot>=1&&slot<=16));
  for(const weight of [5,3]){
   const marked=board.filter(card=>dogS2CardDrawWeight(card)===weight);
   for(const card of marked){
    const ordinary=board.find(other=>other.rarity===card.rarity&&dogS2CardDrawWeight(other)===15);
    assert.ok(ordinary,'same-rarity normal card required to compare relative chances');
    assert.equal(dogS2CardDrawWeight(ordinary)/weight,weight===5?3:5);
   }
  }
 }
});

test('weighted DOG draw reaches all 96 cards and uses the exact integer ticket intervals',()=>{
 for(const card of DOG_S2_CARDS){
  const pack={count:1,guaranteedCount:0,weights:{common:0,rare:0,epic:0,legendary:0}};
  pack.weights[card.rarity]=100;
  const pool=DOG_S2_CARDS.filter(c=>c.rarity===card.rarity);
  const start=pool.slice(0,pool.indexOf(card)).reduce((sum,c)=>sum+dogS2CardDrawWeight(c),0);
  const size=dogS2CardDrawWeight(card);
  for(const roll of [start,start+size-1]){
   let calls=0;
   const drawn=dogS2Draw(pack,max=>calls++===0?0:roll);
   assert.equal(drawn[0].id,card.id,'weighted ticket '+roll+' should draw '+card.id);
   assert.equal(calls,2,'exactly one rarity draw and one weighted card draw');
  }
 }
});

test('DOG card weights also affect packages granted by the Monster Slots without extra draw API',()=>{
 const original=DOG_S2_CARDS[0],pack=DOG_S2_PACKS[0];
 const result=dogS2OpenGrantedPacks('small',2,{},()=>0);
 assert.equal(result.openedPacks.length,2);
 assert.equal(result.openedPacks[0].revealed.length,pack.count);
 assert.ok(result.openedPacks[0].revealed.every(card=>card.id===original.id));
 assert.equal(result.openedPacks[0].hasNew,true);
 assert.equal(result.openedPacks[1].hasNew,false);
});
