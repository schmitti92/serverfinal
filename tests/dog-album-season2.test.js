import test from 'node:test';
import assert from 'node:assert/strict';
import {DOG_S2_CARDS,DOG_S2_BOARDS,DOG_S2_PACKS,DOG_S2_SPECIAL_CARD_SLOTS,DOG_S2_CARD_WEIGHT_BASE,dogS2CardDrawWeight,dogS2Progress,dogS2Draw,dogS2Discoveries,dogS2Duplicates,dogS2Redeem,dogS2OpenGrantedPacks} from '../dog-album-season2.js';

test('DOG album package prices use the November 2026 server-authoritative values',()=>{
 const expected={small:200000000,large:400000000,premium:600000000,platinum:2000000000};
 assert.deepEqual(Object.fromEntries(DOG_S2_PACKS.map(pack=>[pack.id,pack.price])),expected);
 assert.deepEqual(DOG_S2_PACKS.map(pack=>pack.count),[3,7,12,16]);
 assert.deepEqual(DOG_S2_PACKS.map(pack=>pack.price/100),[2000000,4000000,6000000,20000000],'shop displays prices in euros while server stores cents');
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

test('every 16-card DOG board has four normal and twelve special cards, including two 30x rarer',()=>{
 assert.equal(DOG_S2_SPECIAL_CARD_SLOTS.length,DOG_S2_BOARDS.length);
 assert.equal(DOG_S2_CARD_WEIGHT_BASE,120);
 const expected={120:4,40:4,15:4,8:2,4:2};
 for(let index=0;index<DOG_S2_BOARDS.length;index++){
  const board=DOG_S2_CARDS.filter(c=>c.board===index+1);
  const weights=board.map(dogS2CardDrawWeight);
  assert.equal(board.length,16);
  for(const [weight,count] of Object.entries(expected))
   assert.equal(weights.filter(w=>w===Number(weight)).length,count,
    DOG_S2_BOARDS[index]+' needs exactly '+count+' cards with '+weight+' tickets');
  const special=DOG_S2_SPECIAL_CARD_SLOTS[index];
  assert.deepEqual(Object.fromEntries(Object.entries(special).map(([k,v])=>[k,v.length])),
   {normal:4,triple:4,octuple:4,fifteen:2,thirty:2});
  const slots=Object.values(special).flat();
  assert.equal(slots.length,16);
  assert.equal(new Set(slots).size,16,'all 16 positions should appear exactly once');
  assert.deepEqual([...slots].sort((a,b)=>a-b),Array.from({length:16},(_,i)=>i+1));
  for(const rarity of ['common','rare','epic','legendary']){
   const rarityCards=board.filter(card=>card.rarity===rarity);
   assert.equal(rarityCards.length,4);
   const ordinary=rarityCards.filter(c=>dogS2CardDrawWeight(c)===120);
   assert.equal(ordinary.length,1,'each rarity retains one normal card for fair comparison');
   const base=dogS2CardDrawWeight(ordinary[0]);
   for(const card of rarityCards){
    const weight=dogS2CardDrawWeight(card);
    assert.ok([1,3,8,15,30].includes(base/weight),'special rarity multiplier must be exact');
   }
  }
  for(const slot of special.thirty){
   const ultra=board.find(card=>card.slot===slot);
   const normal=board.find(card=>card.rarity===ultra.rarity&&dogS2CardDrawWeight(card)===120);
   assert.ok(normal,'30x card must share a rarity tier with a normal card');
   assert.equal(dogS2CardDrawWeight(normal)/dogS2CardDrawWeight(ultra),30);
  }
 }
 assert.equal(DOG_S2_CARDS.filter(card=>dogS2CardDrawWeight(card)===120).length,24);
 assert.equal(DOG_S2_CARDS.filter(card=>dogS2CardDrawWeight(card)<120).length,72);
 assert.equal(DOG_S2_CARDS.filter(card=>dogS2CardDrawWeight(card)===4).length,12);
 assert.throws(()=>dogS2CardDrawWeight({board:1,slot:17}),/INVALID_DOG_CARD/);
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
