import test from 'node:test';
import assert from 'node:assert/strict';
import {DOG_S2_CARDS,DOG_S2_BOARDS,DOG_S2_PACKS,DOG_S2_SPECIAL_CARD_SLOTS,DOG_S2_CARD_WEIGHT_BASE,DOG_S2_JACKPOT_SLOT,DOG_S2_JACKPOT_ODDS,dogS2CardDrawWeight,dogS2Progress,dogS2Draw,dogS2Discoveries,dogS2Duplicates,dogS2Redeem,dogS2OpenGrantedPacks,dogS2OpenBatch,DOG_S2_PACK_BATCH_MAX,installDogAlbumSeason2,DOG_S2_COLLECTION} from '../dog-album-season2.js';

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

test('each DOG board has exactly one 1:500 legendary in the bottom-right field',()=>{
 assert.equal(DOG_S2_SPECIAL_CARD_SLOTS.length,DOG_S2_BOARDS.length);
 assert.equal(DOG_S2_CARD_WEIGHT_BASE,120);
 assert.equal(DOG_S2_JACKPOT_SLOT,16);
 assert.equal(DOG_S2_JACKPOT_ODDS,500);
 const distribution={120:4,40:3,15:4,8:2,4:2,0:1};
 for(let index=0;index<DOG_S2_BOARDS.length;index++){
  const board=DOG_S2_CARDS.filter(c=>c.board===index+1);
  const weights=board.map(dogS2CardDrawWeight);
  assert.equal(board.length,16);
  for(const [weight,count] of Object.entries(distribution))
   assert.equal(weights.filter(w=>w===Number(weight)).length,count,DOG_S2_BOARDS[index]+' weight '+weight);
  const groups=DOG_S2_SPECIAL_CARD_SLOTS[index];
  assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([group,values])=>[group,values.length])),
   {normal:4,triple:3,octuple:4,fifteen:2,thirty:2,jackpot:1});
  assert.deepEqual(groups.jackpot,[16]);
  const slots=Object.values(groups).flat();
  assert.equal(slots.length,16);
  assert.deepEqual([...slots].sort((a,b)=>a-b),Array.from({length:16},(_,i)=>i+1));
  for(const rarity of ['common','rare','epic','legendary']){
   const cards=board.filter(card=>card.rarity===rarity);
   assert.equal(cards.length,4);
   const normal=cards.filter(c=>dogS2CardDrawWeight(c)===120);
   assert.equal(normal.length,1,'each rarity has one normal card in '+DOG_S2_BOARDS[index]);
   for(const card of cards.filter(card=>card.slot!==16))
    assert.ok([1,3,8,15,30].includes(120/dogS2CardDrawWeight(card)));
  }
  for(const slot of groups.thirty){
   const rare=board.find(c=>c.slot===slot);
   assert.equal(120/dogS2CardDrawWeight(rare),30);
  }
  const jackpot=board.find(c=>c.slot===16);
  assert.equal(jackpot.rarity,'legendary');
  assert.equal(dogS2CardDrawWeight(jackpot),0,
   'the 1-in-500 jackpot is never picked through ordinary tier weighting');
 }
 assert.equal(DOG_S2_CARDS.filter(card=>dogS2CardDrawWeight(card)===0).length,6);
 assert.equal(DOG_S2_CARDS.filter(card=>dogS2CardDrawWeight(card)===4).length,12);
 assert.throws(()=>dogS2CardDrawWeight({board:1,slot:17}),/INVALID_DOG_CARD/);
});

test('every regular DOG card remains reachable at the precise weighted ticket bounds',()=>{
 for(const card of DOG_S2_CARDS.filter(card=>card.slot!==16)){
  const pack={count:1,guaranteedCount:0,weights:{common:0,rare:0,epic:0,legendary:0}};
  pack.weights[card.rarity]=100;
  const pool=DOG_S2_CARDS.filter(c=>c.board===card.board&&c.rarity===card.rarity&&c.slot!==16);
  const start=pool.slice(0,pool.indexOf(card)).reduce((sum,c)=>sum+dogS2CardDrawWeight(c),0);
  const size=dogS2CardDrawWeight(card);
  for(const roll of [start,start+size-1]){
   const randoms=card.rarity==='legendary'
    ?[0,card.board-1,100,roll] // fail the 1:500 jackpot roll on purpose
    :[0,card.board-1,roll];
   let calls=0;
   const drawn=dogS2Draw(pack,max=>{
    assert.ok(randoms[calls]>=0&&randoms[calls]<max);
    return randoms[calls++];
   });
   assert.equal(drawn[0].id,card.id,'weighted ticket '+roll+' should draw '+card.id);
   assert.equal(calls,randoms.length);
  }
 }
});

test('the 16th legendary has exact 1:500 odds per board draw for all four pack types',()=>{
 for(const pack of DOG_S2_PACKS){
  for(let i=0;i<pack.count;i++){
   const min=i<(pack.guaranteedCount||0)?['common','rare','epic','legendary'].indexOf(pack.guaranteed):0;
   const available=['common','rare','epic','legendary'].slice(min);
   const total=available.reduce((sum,rarity)=>sum+(pack.weights[rarity]||0),0);
   const legendaryTickets=pack.weights.legendary;
   const jackpotDenominator=DOG_S2_JACKPOT_ODDS*legendaryTickets;
   assert.ok(total<=jackpotDenominator,'jackpot probability must be feasible');
   // P(jackpot | board) = (legendaryTickets/total)
   //                       * (total/jackpotDenominator) = exactly 1/500.
   assert.equal(legendaryTickets*total*DOG_S2_JACKPOT_ODDS,total*jackpotDenominator);
  }
 }
 for(let board=1;board<=6;board++){
  const pack={count:1,guaranteedCount:0,weights:{common:0,rare:0,epic:0,legendary:100}};
  const target=DOG_S2_CARDS[(board-1)*16+15];
  for(const jackpotRoll of [0,99]){
   let n=0;
   const card=dogS2Draw(pack,max=>{
    const values=[0,board-1,jackpotRoll];
    assert.ok(values[n]<max);
    return values[n++];
   })[0];
   assert.equal(card.id,target.id,'the last card must be attainable from board '+board);
   assert.equal(n,3,'jackpot completes without additional roulette rolls');
  }
  let n=0;
  const miss=dogS2Draw(pack,max=>{
   const values=[0,board-1,100,0];
   assert.ok(values[n]<max);
   return values[n++];
  })[0];
  assert.notEqual(miss.id,target.id,'the roll immediately after 1-in-500 threshold must miss');
  assert.equal(miss.rarity,'legendary','jackpot failure must not downgrade rarity');
  assert.equal(miss.board,board);
  assert.equal(n,4);
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

test('DOG bulk draw applies collection resets and tournament points after every pack',()=>{
 const now=Date.UTC(2026,10,14),pack=DOG_S2_PACKS.find(p=>p.id==='premium');
 const initial=Object.fromEntries(DOG_S2_CARDS.map(c=>[c.id,1]));
 const random=()=>{let i=0;return max=>(i++*37+17)%max};
 const five=dogS2OpenBatch(pack,5,initial,{},now,random());
 let cards=initial,state={},pointsAdded=0,finished=[],revealed=[],lastProgress=null;
 const rng=random();
 for(let n=0;n<5;n++){
  const next=dogS2OpenBatch(pack,1,cards,state,now,rng);
  cards=next.cards;state={...state,...next.updates};lastProgress=next.progress;
  pointsAdded+=next.pointsAdded;finished.push(...next.completedBoards);revealed.push(...next.revealed);
 }
 assert.deepEqual(five.cards,cards);
 assert.deepEqual(five.progress,lastProgress);
 assert.deepEqual(five.updates,Object.fromEntries(Object.keys(five.updates).map(k=>[k,state[k]])));
 assert.deepEqual(five.completedBoards,finished);
 assert.equal(five.completedBoards.length,6,'full boards count exactly once and reset');
 assert.equal(five.pointsAdded,pointsAdded);
 assert.deepEqual(five.revealed,revealed);
 assert.equal(five.revealed.length,5*pack.count);
 assert.equal(DOG_S2_PACK_BATCH_MAX,10);
 assert.throws(()=>dogS2OpenBatch(pack,11),/INVALID_PACK_QUANTITY/);
 assert.throws(()=>dogS2OpenBatch(pack,0),/INVALID_PACK_QUANTITY/);
});
