import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CHRISTMAS_CARDS,CHRISTMAS_RARITIES,christmasDraw,hammerBingoProgress,markChristmasDiscoveries} from '../christmas-card-engine.js';

const packs=[
 {id:'small',count:3,guaranteed:'common',guaranteedCount:0,weights:{common:65,rare:29,epic:5,legendary:1}},
 {id:'large',count:7,guaranteed:'rare',guaranteedCount:1,weights:{common:55,rare:32,epic:10,legendary:3}},
 {id:'premium',count:12,guaranteed:'epic',guaranteedCount:2,weights:{common:40,rare:35,epic:17,legendary:8}}
];
test('64 stable ids, original 32 preserved and Hammer-Bingo rarity layout correct',()=>{
 assert.equal(CHRISTMAS_CARDS.length,64);
 assert.equal(new Set(CHRISTMAS_CARDS.map(c=>c.id)).size,64);
 assert.deepEqual(CHRISTMAS_CARDS.slice(0,32).map(c=>c.id),Array.from({length:32},(_,i)=>'christmas-'+String(i+1).padStart(2,'0')));
 assert.deepEqual(CHRISTMAS_CARDS.slice(32,48).map(c=>c.rarity),Array(16).fill('common'));
 assert.deepEqual(CHRISTMAS_CARDS.slice(48).map(c=>c.rarity),Array.from({length:16},(_,i)=>CHRISTMAS_RARITIES[i%4]));
 assert.deepEqual(Object.fromEntries(CHRISTMAS_RARITIES.map(r=>[r,CHRISTMAS_CARDS.filter(c=>c.rarity===r).length])),{common:28,rare:12,epic:12,legendary:12});
});
for(const pack of packs){
 test(pack.id+' pack draws exact count and guaranteed rarity minimum',()=>{
  const drawn=christmasDraw(pack,()=>0);
  assert.equal(drawn.length,pack.count);
  const minimum=CHRISTMAS_RARITIES.indexOf(pack.guaranteed);
  for(let i=0;i<pack.guaranteedCount;i++)assert.ok(CHRISTMAS_RARITIES.indexOf(drawn[i].rarity)>=minimum);
  assert.ok(drawn.every(c=>CHRISTMAS_CARDS.some(ref=>ref.id===c.id)));
 });
}
test('normal draws pick rarity by pack weights, not by unequal number of card definitions',()=>{
 let seed=19;
 const rand=n=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return Math.floor((seed/4294967296)*n)};
 for(const pack of packs){
  const ordinary={...pack,count:1,guaranteedCount:0};
  const found=Object.fromEntries(CHRISTMAS_RARITIES.map(r=>[r,0]));
  for(let n=0;n<15000;n++)found[christmasDraw(ordinary,rand)[0].rarity]++;
  for(const rarity of CHRISTMAS_RARITIES){
   const actual=found[rarity]/15000;
   assert.ok(Math.abs(actual-pack.weights[rarity]/100)<0.02,pack.id+': '+rarity+' odds are incorrect ('+actual+')');
  }
 }
});
test('Hammer-Bingo collection reports independent lines for both new boards',()=>{
 const cards={};
 let progress=hammerBingoProgress(cards);
 assert.equal(progress.collected,0);assert.equal(progress.boards[0].bingos,0);
 for(let num=33;num<=36;num++)cards['christmas-'+num]=1;
 progress=hammerBingoProgress(cards);
 assert.equal(progress.boards[0].collected,4);
 assert.ok(progress.boards[0].bingoLines.includes(0));
 assert.equal(progress.boards[1].bingos,0);
 for(let num=49;num<=64;num++)cards['christmas-'+num]=1;
 progress=hammerBingoProgress(cards);
 assert.equal(progress.boards[1].bingos,10);
 assert.equal(progress.boards[1].complete,true);
 assert.equal(progress.boards[0].complete,false);
});

test('new discovery is identified against pre-pack ownership and only once per pack',()=>{
 const drawn=[CHRISTMAS_CARDS[32],CHRISTMAS_CARDS[32],CHRISTMAS_CARDS[0],CHRISTMAS_CARDS[48]];
 const old={ [CHRISTMAS_CARDS[0].id]:2 };
 const result=markChristmasDiscoveries(drawn,old);
 assert.deepEqual(result.map(c=>c.isNew),[true,false,false,true]);
 assert.equal(result[0].id,CHRISTMAS_CARDS[32].id);
 assert.deepEqual(old,{[CHRISTMAS_CARDS[0].id]:2});
 assert.equal('isNew' in drawn[0],false);
});
test('new discovery is false if card is already owned in profile, including Hammer-Bingo',()=>{
 const drawn=[CHRISTMAS_CARDS[32],CHRISTMAS_CARDS[48]];
 assert.deepEqual(markChristmasDiscoveries(drawn,{[drawn[0].id]:1,[drawn[1].id]:3}).map(c=>c.isNew),[false,false]);
});
