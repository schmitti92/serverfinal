import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
 CHRISTMAS_CARDS,MONSTER_WHEEL_EXCHANGE_COST,christmasDuplicateStock,
 redeemChristmasDuplicates,christmasHammerDuplicatesSaved,settleHammerBingoCycle
} from '../christmas-card-engine.js';

const id=n=>'christmas-'+String(n).padStart(2,'0');

test('only second and subsequent copies among all 64 cards count as duplicates',()=>{
 assert.equal(CHRISTMAS_CARDS.length,64);
 assert.equal(christmasDuplicateStock({[id(1)]:1,[id(33)]:2,[id(64)]:4}).available,4);
 assert.equal(christmasDuplicateStock({[id(1)]:1,[id(33)]:2,[id(64)]:4}).canExchange,false);
 assert.equal(christmasDuplicateStock({unknown:999}).available,0);
 assert.equal(MONSTER_WHEEL_EXCHANGE_COST,100);
});

test('100 duplicates are removed while first copies are preserved',()=>{
 const before={[id(1)]:31,[id(33)]:31,[id(64)]:41};
 const exchange=redeemChristmasDuplicates(before);
 assert.deepEqual(exchange.cards,{[id(1)]:1,[id(33)]:1,[id(64)]:1});
 assert.equal(christmasDuplicateStock(exchange.cards).available,0);
 assert.equal(christmasDuplicateStock(before).available,100);
 assert.equal(before[id(1)],31);
});

test('reserve is spent before attached duplicates and the rest can be exchanged later',()=>{
 const cards={[id(2)]:50,[id(34)]:20,[id(60)]:1};
 const exchange=redeemChristmasDuplicates(cards,60);
 assert.equal(exchange.reserve,0);
 assert.equal(christmasDuplicateStock(exchange.cards).available,28);
 assert.equal(exchange.cards[id(2)],10);
 assert.equal(exchange.cards[id(34)],20);
 assert.equal(exchange.cards[id(60)],1);
});

test('exactly 99 duplicates are insufficient',()=>{
 assert.throws(()=>redeemChristmasDuplicates({[id(1)]:100}),/INSUFFICIENT_DUPLICATES/);
 assert.throws(()=>redeemChristmasDuplicates({},99),/INSUFFICIENT_DUPLICATES/);
});

test('multiple exchanges cannot spend the same duplicates twice',()=>{
 const cards={[id(18)]:202};
 const first=redeemChristmasDuplicates(cards);
 const second=redeemChristmasDuplicates(first.cards,first.reserve);
 assert.equal(christmasDuplicateStock(second.cards).available,1);
 assert.equal(second.cards[id(18)],2);
 assert.throws(()=>redeemChristmasDuplicates(second.cards,second.reserve),/INSUFFICIENT_DUPLICATES/);
});

test('hammer bingo saves duplicate copies that would be lost in board reset',()=>{
 const before={};
 for(let n=33;n<=48;n++)before[id(n)]=4;
 before[id(2)]=3;
 const delta=settleHammerBingoCycle(before);
 assert.equal(delta.jackpots.length,1);
 const banked=christmasHammerDuplicatesSaved(before,delta.jackpots);
 assert.equal(banked,48);
 assert.equal(christmasDuplicateStock(before).available,50);
 assert.equal(christmasDuplicateStock(delta.cards,banked).available,50);
 assert.equal(delta.cards[id(2)],3);
 assert.equal(delta.cards[id(33)],0);
});

test('only the finished Hammer boards are banked, once each',()=>{
 const cards={[id(33)]:6,[id(49)]:10,[id(64)]:3};
 assert.equal(christmasHammerDuplicatesSaved(cards,[{board:3}]),5);
 assert.equal(christmasHammerDuplicatesSaved(cards,[{board:4}]),11);
 assert.equal(christmasHammerDuplicatesSaved(cards,[{board:3},{board:3},{board:4}]),16);
 assert.equal(christmasHammerDuplicatesSaved(cards,[]),0);
});

test('ticket counts and reserve are displayed without spending and stay separate',()=>{
 const summary=christmasDuplicateStock({[id(1)]:3},99,2);
 assert.deepEqual(summary,{available:101,onCards:2,reserve:99,tickets:2,exchangeCost:100,canExchange:true});
});
