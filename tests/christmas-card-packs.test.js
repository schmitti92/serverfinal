import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CHRISTMAS_CARDS,CHRISTMAS_RARITIES,christmasDraw,hammerBingoProgress,markChristmasDiscoveries,hammerBingoPrize,collectHammerBingoClaims,settleHammerBingoCycle,HAMMER_BINGO_JACKPOTS,classicChristmasProgress,NORTH_POLE_REWARD_IDS} from '../christmas-card-engine.js';

const packs=[
 {id:'small',count:3,guaranteed:'common',guaranteedCount:0,weights:{common:65,rare:29,epic:5,legendary:1}},
 {id:'large',count:7,guaranteed:'rare',guaranteedCount:1,weights:{common:55,rare:32,epic:10,legendary:3}},
 {id:'premium',count:12,guaranteed:'epic',guaranteedCount:2,weights:{common:40,rare:35,epic:17,legendary:8}}
];
test('80 stable ids, original 64 preserved and North Pole rarity layout correct',()=>{
 assert.equal(CHRISTMAS_CARDS.length,80);
 assert.equal(new Set(CHRISTMAS_CARDS.map(c=>c.id)).size,80);
 assert.deepEqual(CHRISTMAS_CARDS.slice(0,32).map(c=>c.id),Array.from({length:32},(_,i)=>'christmas-'+String(i+1).padStart(2,'0')));
 assert.deepEqual(CHRISTMAS_CARDS.slice(32,48).map(c=>c.rarity),Array(16).fill('common'));
 assert.deepEqual(CHRISTMAS_CARDS.slice(48,64).map(c=>c.rarity),Array.from({length:16},(_,i)=>CHRISTMAS_RARITIES[i%4]));
 assert.deepEqual(CHRISTMAS_CARDS.slice(64,80).map(c=>c.rarity),Array.from({length:16},(_,i)=>CHRISTMAS_RARITIES[Math.floor(i/4)]));
 assert.equal(CHRISTMAS_CARDS[64].id,'christmas-65');
 assert.equal(CHRISTMAS_CARDS[79].id,'christmas-80');
 assert.deepEqual(Object.fromEntries(CHRISTMAS_RARITIES.map(r=>[r,CHRISTMAS_CARDS.filter(c=>c.rarity===r).length])),{common:32,rare:16,epic:16,legendary:16});
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

test('each mixed board reward is exactly twice the normal reward on all ten lines',()=>{
 for(let line=0;line<10;line++){
  const normal=hammerBingoPrize(3,line),double=hammerBingoPrize(4,line);
  assert.deepEqual(double,Object.fromEntries(Object.entries(normal).map(([key,value])=>[key,value*2])));
 }
 assert.deepEqual(hammerBingoPrize(3,0),{single:1});
 assert.deepEqual(hammerBingoPrize(4,0),{single:2});
 assert.deepEqual(hammerBingoPrize(3,9),{lucky:1});
 assert.deepEqual(hammerBingoPrize(4,9),{lucky:2});
});
test('one newly completed row pays once, reload and duplicate card do not pay again',()=>{
 const cards={};
 for(let n=33;n<=36;n++)cards['christmas-'+n]=1;
 const first=collectHammerBingoClaims(cards,{});
 assert.deepEqual(first.awarded.map(x=>[x.board,x.line]),[[3,0]]);
 assert.deepEqual(first.totals,{single:1,double:0,lucky:0});
 const repeat=collectHammerBingoClaims(cards,first.claims);
 assert.equal(repeat.awarded.length,0);
 cards['christmas-33']=5;
 assert.equal(collectHammerBingoClaims(cards,first.claims).awarded.length,0);
});
test('a pack completing overlapping lines grants every distinct line once',()=>{
 const cards={};
 for(let n=33;n<=48;n++)cards['christmas-'+n]=1;
 for(let n=49;n<=64;n++)cards['christmas-'+n]=1;
 const all=collectHammerBingoClaims(cards,{});
 assert.equal(all.awarded.length,20);
 const regular=all.awarded.filter(x=>x.board===3),mixed=all.awarded.filter(x=>x.board===4);
 assert.equal(regular.length,10);assert.equal(mixed.length,10);
 assert.deepEqual(all.totals,{single:24,double:9,lucky:3});
 assert.equal(collectHammerBingoClaims(cards,all.claims).awarded.length,0);
 const progress=hammerBingoProgress(cards,all.claims);
 assert.deepEqual(progress.boards.map(b=>b.claimableLines.length),[0,0]);
});
test('pre-existing complete lines are safely claimable once after rollout',()=>{
 const owned={'christmas-33':1,'christmas-34':1,'christmas-35':1,'christmas-36':1};
 assert.deepEqual(hammerBingoProgress(owned,{}).boards[0].claimableLines,[0]);
 assert.deepEqual(hammerBingoProgress(owned,{common:[0]}).boards[0].claimableLines,[]);
});

test('standard Hammer-Bingo jackpot pays ten single hammers and resets only field 3',()=>{
 const cards={'christmas-01':3,'christmas-49':1,'christmas-50':2};
 for(let n=33;n<=48;n++)cards['christmas-'+n]=1;
 const first=settleHammerBingoCycle(cards);
 assert.deepEqual(first.jackpots,[{board:3,cycle:1,hammers:{single:10,double:0,lucky:0}}]);
 assert.equal(first.totals.single,18); // eight singles from 10 lines + 10 jackpot
 assert.equal(first.totals.double,3);
 assert.equal(first.totals.lucky,1);
 assert.equal(first.cards['christmas-01'],3);
 assert.equal(first.cards['christmas-49'],1);
 assert.equal(first.cards['christmas-50'],2);
 for(let n=33;n<=48;n++)assert.equal(first.cards['christmas-'+n],0);
 assert.deepEqual(first.claims.common,[]);
 assert.deepEqual(first.cycles,{common:1,mixed:0});
 assert.equal(first.awarded.length,10);
 const repeat=settleHammerBingoCycle(first.cards,first.claims,first.cycles);
 assert.equal(repeat.changed,false);
 assert.equal(repeat.jackpots.length,0);
 assert.deepEqual(repeat.totals,{single:0,double:0,lucky:0});
});

test('hard Hammer-Bingo jackpot pays ten double and three golden (lucky) hammers',()=>{
 const cards={'christmas-33':4,'christmas-01':1};
 for(let n=49;n<=64;n++)cards['christmas-'+n]=1;
 const result=settleHammerBingoCycle(cards,{common:[1],mixed:[]},{common:2,mixed:0});
 assert.deepEqual(result.jackpots,[{board:4,cycle:1,hammers:{single:0,double:10,lucky:3}}]);
 assert.equal(result.totals.double,16);
 assert.equal(result.totals.lucky,5);
 assert.equal(result.totals.single,16); // doubled row/column rewards from this board
 assert.equal(result.cards['christmas-33'],4);
 assert.equal(result.cards['christmas-01'],1);
 assert.equal(result.claims.common[0],1);
 assert.deepEqual(result.claims.mixed,[]);
 for(let n=49;n<=64;n++)assert.equal(result.cards['christmas-'+n],0);
 assert.deepEqual(HAMMER_BINGO_JACKPOTS.mixed,{single:0,double:10,lucky:3});
});

test('previously paid bingo lines are not paid again when jackpot is awarded',()=>{
 const cards={};
 for(let n=33;n<=48;n++)cards['christmas-'+n]=3;
 const claimed={common:Array.from({length:10},(_,i)=>i),mixed:[]};
 const result=settleHammerBingoCycle(cards,claimed,{common:4,mixed:1});
 assert.equal(result.awarded.length,0);
 assert.deepEqual(result.totals,{single:10,double:0,lucky:0});
 assert.deepEqual(result.jackpots,[{board:3,cycle:5,hammers:{single:10,double:0,lucky:0}}]);
});

test('both 4x4 boards can jackpot in the same pack without affecting original 32',()=>{
 const cards=Object.fromEntries(Array.from({length:64},(_,i)=>['christmas-'+String(i+1).padStart(2,'0'),i<32?2:1]));
 const result=settleHammerBingoCycle(cards);
 assert.equal(result.jackpots.length,2);
 assert.deepEqual(result.cycles,{common:1,mixed:1});
 assert.deepEqual(result.totals,{single:34,double:19,lucky:6});
 for(let n=1;n<=32;n++)assert.equal(result.cards['christmas-'+String(n).padStart(2,'0')],2);
 for(let n=33;n<=64;n++)assert.equal(result.cards['christmas-'+n],0);
});

test('after a complete reset a player can collect cards and win the same bingo and jackpot again',()=>{
 const cards=Object.fromEntries(Array.from({length:16},(_,i)=>['christmas-'+String(i+33),1]));
 const first=settleHammerBingoCycle(cards);
 const secondCards={...first.cards};
 for(let n=33;n<=48;n++)secondCards['christmas-'+n]=1;
 const second=settleHammerBingoCycle(secondCards,first.claims,first.cycles);
 assert.deepEqual(second.jackpots.map(x=>x.cycle),[2]);
 assert.equal(second.awarded.length,10);
 assert.equal(second.totals.single,18);
});

test('field only jackpots when all 16 distinct cards are owned',()=>{
 const cards={};
 for(let n=33;n<=47;n++)cards['christmas-'+n]=99;
 const result=settleHammerBingoCycle(cards);
 assert.equal(result.jackpots.length,0);
 assert.ok(result.cards['christmas-33']>0);
});

test('North Pole 4x4 board adds ten unique classic Bingos without changing old rewards',()=>{
 const base=Object.fromEntries(Array.from({length:32},(_,i)=>['christmas-'+String(i+1).padStart(2,'0'),1]));
 const old=classicChristmasProgress(base);
 assert.equal(old.totalBingos,20);assert.equal(old.total,48);
 assert.equal(old.thirdBingos,0);
 assert.equal(old.rewards.includes('christmas-champion'),true);
 assert.equal(old.rewards.includes(NORTH_POLE_REWARD_IDS[0]),false);
 for(let i=65;i<=68;i++)base['christmas-'+i]=1;
 let next=classicChristmasProgress(base);
 assert.equal(next.thirdBingos,1);
 assert.equal(next.totalBingos,21);
 assert.equal(next.rewards.includes(NORTH_POLE_REWARD_IDS[0]),false);
 for(let i=69;i<=72;i++)base['christmas-'+i]=1;
 next=classicChristmasProgress(base);
 assert.equal(next.totalBingos,22);
 assert.equal(next.nextRewardAt,24);
 assert.equal(next.rewards.includes(NORTH_POLE_REWARD_IDS[0]),true);
 for(let i=73;i<=80;i++)base['christmas-'+i]=1;
 next=classicChristmasProgress(base);
 assert.equal(next.collected,48);assert.equal(next.maxBingos,30);
 assert.equal(next.totalBingos,30);
 assert.deepEqual(next.rewards.slice(-5),NORTH_POLE_REWARD_IDS);
 assert.equal(next.nextReward,null);
});
test('Hammer jackpot never resets the North Pole collection',()=>{
 const cards=Object.fromEntries(Array.from({length:48},(_,i)=>['christmas-'+String(i+33),1]));
 const before=classicChristmasProgress(cards);
 const result=settleHammerBingoCycle(cards);
 assert.equal(result.jackpots.length,2);
 assert.equal(classicChristmasProgress(result.cards).thirdBingos,10);
 assert.equal(classicChristmasProgress(result.cards).totalBingos,before.totalBingos);
 for(let i=65;i<=80;i++)assert.equal(result.cards['christmas-'+i],1);
});


test('uploaded Christmas photos preserve the 16 Nordpol card IDs and rarity',()=>{
 const names=["Funkelnder Weihnachtsbaum","Schlitten im Mondschein","Weihnachtsmann mit Geschenken","Glitzernde Weihnachtskugeln","Kakao am Winterfenster","Kleiner Weihnachtsfreund","Leuchtendes Winterdorf","Süße Nikolausstiefel","Wichtel im Zauberwald","Familie in der Schneekugel","Winterfee","Verzauberter Tannenwald","Goldener Weihnachtsbaum","Weihnachtsmanns Schneekugel","Schneemann im Wohnzimmer","Wichtel auf Zuckerstange"];
 assert.deepEqual(CHRISTMAS_CARDS.slice(64,80).map(c=>c.name),names);
 assert.deepEqual(CHRISTMAS_CARDS.slice(64,80).map(c=>c.id),
  Array.from({length:16},(_,i)=>'christmas-'+String(65+i)));
 assert.ok(CHRISTMAS_CARDS.slice(64,80).every(c=>c.series==='Geheimnisse des Nordpols'));
});
