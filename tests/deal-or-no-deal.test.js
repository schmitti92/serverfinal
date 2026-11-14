'use strict';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {create,apply,publicView,free,VALUES,STEPS,STEPS_29,STEPS_30,BANKER_30_OPENINGS,pick30BankerSchedule,publicRemaining,nextTurn,drawHammerFromTwelve,drawBankerSpecial,BANKER_SPECIAL_ODDS,BANKER_REWARD_ODDS,drawBankerPack,drawBankerHammer,pickBankerStyle,bankerOfferFor,MAX_MATCH_CREDIT_CENTS} from '../deal-or-no-deal.js';
const rand=n=>0;
function send(g,actor,type,extra={}){return apply(g,actor,{id:'cmd-'+g.revision,revision:g.revision,type,...extra},rand)}
function simulate(count,allDeal=false){
 let g=create(Array.from({length:count},(_,i)=>({id:'p'+i,name:'Spieler '+i})),rand);
 for(let i=0;i<count;i++)g=send(g,g.order[i],'select',{case:i});
 let loops=0;
 while(g.phase!=='final'&&loops++<200){
  if(g.phase==='open'){const actor=g.order.find((_,i)=>false)||null;const turn=nextTurn(g);g=send(g,turn,'open',{case:free(g)[0]})}
  else if(g.phase==='reveal')g=send(g,g.pending.actor,'ack-reveal');
  else if(g.phase==='decision'){const round=g.history.at(-1);const id=round.participants.find(id=>!round.decisions.some(d=>d.id===id));g=send(g,id,'decide',{deal:allDeal})}
  else throw Error('Unexpected phase '+g.phase);
 }
 assert.equal(g.phase,'final');return g;
}
test('30 distinct monetary values including 3, 5, 10 and 50 million euros',()=>{
 assert.equal(VALUES.length,30);
 assert.equal(new Set(VALUES).size,30);
 assert.equal(VALUES[26],300000000); // 3 Mio. EUR (cents)
 assert.equal(VALUES[27],500000000); // 5 Mio. EUR (cents)
 assert.equal(VALUES[28],1000000000); // 10 Mio. EUR (cents)
 assert.equal(VALUES[29],5000000000); // 50 Mio. EUR (cents)
});
for(const count of [26,27,28,29,30]){
 test(count+' cases contain the correct prizes and reach a final',()=>{
  let game=create([{id:'a',name:'Spieler A'}],rand,count);
  assert.equal(game.values.length,count);
  assert.equal(publicView(game).caseCount,count);
  assert.equal(game.values.includes(500000000),count>=28);
  assert.equal(game.values.includes(1000000000),count>=29);
   assert.equal(game.values.includes(5000000000),count===30);
  assert.equal(game.values.includes(300000000),count>=27);
  game=send(game,'a','select',{case:0});
  let guard=0;
  while(game.phase!=='final'&&guard++<200){
   if(game.phase==='batch-pick')game=send(game,'a','open',{case:free(game)[0]});
    else if(game.phase==='batch-reveal'){game.openingBatch.endsAt=Date.now()-1;game=send(game,'a','ack-batch');}
    else if(game.phase==='open')game=send(game,'a','open',{case:free(game)[0]});
   else if(game.phase==='reveal')game=send(game,'a','ack-reveal');
   else if(game.phase==='decision')game=send(game,'a','decide',{deal:false});
   else throw Error('Unexpected phase '+game.phase);
  }
  assert.equal(game.phase,'final');
  assert.equal(game.opened.length,count-1);
 });
}
test('invalid case counts are rejected',()=>{for(const n of [25,31,0,26.5])assert.throws(()=>create([{id:'a'}],rand,n),/INVALID_CASE_COUNT/)});

for(let count=1;count<=4;count++){
 test(count+' players finish full game with correct opening count',()=>{let g=simulate(count);assert.equal(g.opened.length,27-count);assert.equal(g.history.length,7);assert.equal(new Set(g.opened).size,g.opened.length);assert.equal(g.players.every(p=>!g.opened.includes(p.case)),true)});
 test(count+' players accepting first deal end immediately',()=>{let g=simulate(count,true);assert.equal(g.opened.length,Math.round(9*(27-count)/27));assert.equal(g.history.length,1);assert.equal(g.players.every(p=>p.deal!==null),true)});
}
test('private assignments never leaked before finale',()=>{let g=create([{id:'a'},{id:'b'}],rand);g=send(g,g.order[0],'select',{case:0});g=send(g,g.order[1],'select',{case:1});const v=publicView(g);assert.equal('values' in v,false);assert.equal('commands' in v,false);assert.equal(v.finalValues,null);assert.equal(JSON.stringify(v).includes('100000000'),false)});
test('repeated command is idempotent',()=>{let g=create([{id:'a'}],rand);const cmd={id:'same',revision:0,type:'select',case:0};const a=apply(g,'a',cmd,rand);assert.deepEqual(apply(a,'a',cmd,rand),a)});
test('wrong player cannot open',()=>{let g=create([{id:'a'},{id:'b'}],rand);for(let i=0;i<2;i++)g=send(g,g.order[i],'select',{case:i});const wrong=g.order.find(id=>id!==nextTurn(g));assert.throws(()=>send(g,wrong,'open',{case:2}),/INVALID_OPEN/)});


test('stale commands are rejected without changing the game',()=>{
 const g=create([{id:'a'}],rand);
 assert.throws(()=>apply(g,'a',{id:'late',revision:-1,type:'select',case:0},rand),/STALE_REVISION/);
 assert.equal(g.phase,'select');
 assert.equal(g.players[0].case,null);
});
test('a second player cannot steal the first player\'s case',()=>{
 let g=create([{id:'a'},{id:'b'}],rand);
 g=send(g,g.order[0],'select',{case:0});
 assert.throws(()=>send(g,g.order[1],'select',{case:0}),/INVALID_SELECTION/);
});
test('personal cases stay protected and only the actor confirms reveal',()=>{
 let g=create([{id:'a'},{id:'b'}],rand);
 for(let i=0;i<2;i++)g=send(g,g.order[i],'select',{case:i});
 const actor=nextTurn(g),other=g.order.find(id=>id!==actor);
 assert.throws(()=>send(g,actor,'open',{case:0}),/INVALID_OPEN/);
 g=send(g,actor,'open',{case:2});
 assert.equal(g.phase,'reveal');
 assert.throws(()=>send(g,other,'ack-reveal'),/INVALID_REVEAL_ACK/);
 g=send(g,actor,'ack-reveal');
 assert.equal(g.phase,'open');
});
test('every briefcase reveal has one server-defined start clock for all spectators',()=>{
 let game=create([{id:'a'},{id:'b'},{id:'c'}],rand,29);
 for(let i=0;i<3;i++)game=send(game,game.order[i],'select',{case:i});
 const actor=nextTurn(game),before=Date.now();
 game=send(game,actor,'open',{case:free(game)[0]});
 const after=Date.now(),publicGame=publicView(game);
 assert.equal(game.phase,'reveal');
 assert.equal(publicGame.pending.eventId,game.pending.eventId);
 assert.equal(publicGame.pending.startedAt,game.pending.startedAt);
 assert.ok(publicGame.pending.startedAt>=before+350&&publicGame.pending.startedAt<=after+350);
 assert.equal(publicGame.openedAmounts.length,0,'no secret amount before acknowledgement');
 const snapshot=structuredClone(publicGame.pending);
 const wrong=game.players.find(p=>p.id!==actor);
 assert.throws(()=>send(game,wrong.id,'ack-reveal'),/INVALID_REVEAL_ACK/);
 assert.deepEqual(publicView(game).pending,snapshot);
 game=send(game,actor,'ack-reveal');
 assert.equal(game.opened.length,1);
 assert.equal(game.pending,null);
 assert.equal(game.events.filter(e=>e.type==='opened').length,1,'exactly one reveal event');
});

test('legacy reveals without start time remain playable',()=>{
 let game=create([{id:'a'}],rand);
 game=send(game,'a','select',{case:0});
 game=send(game,'a','open',{case:1});
 delete game.pending.startedAt;
 assert.equal(publicView(game).pending.startedAt,undefined);
 game=send(game,'a','ack-reveal');
 assert.equal(game.opened.length,1);
});

test('banker votes remain hidden until all participants have responded',()=>{
 let g=create([{id:'a'},{id:'b'}],rand);
 for(let i=0;i<2;i++)g=send(g,g.order[i],'select',{case:i});
 while(g.phase!=='decision'){
  if(g.phase==='open')g=send(g,nextTurn(g),'open',{case:free(g)[0]});
  else if(g.phase==='reveal')g=send(g,g.pending.actor,'ack-reveal');
 }
 const first=g.history.at(-1).participants[0];
 const second=g.history.at(-1).participants[1];
 g=send(g,first,'decide',{deal:true});
 const publicGame=publicView(g);
 assert.deepEqual(publicGame.history.at(-1).decisions,[{id:first}]);
 assert.equal(publicGame.players.find(p=>p.id===first).deal,null);
 g=send(g,second,'decide',{deal:false});
 assert.deepEqual(publicView(g).history.at(-1).decisions,[{id:first,deal:true},{id:second,deal:false}]);
});

test('opening event permanently identifies the acting player and exposes it to every viewer',()=>{
 let g=create([{id:'p1',name:'One',avatar:11},{id:'p2',name:'Two',avatar:12},{id:'p3',name:'Three',avatar:13}],rand);
 assert.deepEqual(g.players.map(p=>p.avatar),[11,12,13]);
 for(let i=0;i<3;i++)g=send(g,g.order[i],'select',{case:i});
 for(let i=0;i<3;i++){
  const actor=nextTurn(g),chosen=free(g)[0];
  g=send(g,actor,'open',{case:chosen});
  assert.equal(g.pending.actor,actor);
  g=send(g,actor,'ack-reveal');
  const event=g.events.at(-1);
  assert.equal(event.playerId,actor);
  assert.equal(event.case,chosen);
  const publicOpening=publicView(g).openedAmounts.at(-1);
  assert.equal(publicOpening.playerId,actor);
  assert.equal(publicOpening.amount,event.amount);
 }
});

test('banker offer is positive, capped at 125% of fair expected value, and records valuation',()=>{
 for(let count=1;count<=4;count++){
  let g=create(Array.from({length:count},(_,i)=>({id:'p'+i})),rand);
  for(let i=0;i<count;i++)g=send(g,g.order[i],'select',{case:i});
  let checks=0;
  while(g.phase!=='final'&&checks<20){
   if(g.phase==='open'){g=send(g,nextTurn(g),'open',{case:free(g)[0]});}
   else if(g.phase==='reveal'){g=send(g,g.pending.actor,'ack-reveal');}
   else if(g.phase==='decision'){
    const remaining=publicRemaining(g);
    const expected=remaining.reduce((sum,v)=>sum+v,0)/remaining.length;
    assert.equal(g.history.at(-1).expectedValue,expected);
    assert.ok(g.offer>=1&&g.offer<=Math.max(1,Math.round(expected*1.25)),
     'Banker offers are intentionally permitted up to 125% of expected value');
    checks++;
    const ballot=g.history.at(-1);
    for(const id of ballot.participants)g=send(g,id,'decide',{deal:false});
   }else break;
  }
  assert.ok(checks>0);
 }
});

test('new matches independently reshuffle every case with no preferred jackpot region',()=>{
 const rounds=2600,positions=Array(27).fill(0);
 let previous=null,identical=0;
 for(let i=0;i<rounds;i++){
  const game=create([{id:'p1',name:'Spieler'}]);
  assert.equal(game.values.length,27);
  assert.deepEqual([...game.values].sort((a,b)=>a-b),[...VALUES.slice(0,27)].sort((a,b)=>a-b));
  const jackpot=game.values.indexOf(100000000);
  positions[jackpot]++;
  if(previous&&previous.every((value,index)=>value===game.values[index]))identical++;
  previous=game.values;
 }
 // 27 equally likely positions: expected about 96 hits each. Loose statistical
 // tolerance avoids flaky tests while detecting persistent lower-number bias.
 for(const hits of positions)assert.ok(hits>=55&&hits<=145,'Biased jackpot distribution: '+positions.join(','));
 assert.equal(identical,0);
});

test('public game reveals 27-case count without exposing hidden amounts',()=>{
 const game=create([{id:'p1',name:'Spieler'}],rand);
 const view=publicView(game);
 assert.equal(view.caseCount,27);
 assert.equal(view.values,undefined);
 assert.equal(free(game).length,27);
});

test('the 12 equal hammer-wheel slots are exactly 5 single, 5 double, 2 lucky',()=>{
 const outcomes=Array.from({length:12},(_,sector)=>drawHammerFromTwelve(n=>{assert.equal(n,12);return sector}));
 assert.equal(outcomes.filter(x=>x==='single').length,5);
 assert.equal(outcomes.filter(x=>x==='double').length,5);
 assert.equal(outcomes.filter(x=>x==='lucky').length,2);
});
test('Banker special bonus has exact 3% Hütchen, 3% Monster spin and 94% none',()=>{
 assert.deepEqual(BANKER_SPECIAL_ODDS,{minigame:3,monster:3});
 const outcome=Array.from({length:100},(_,roll)=>drawBankerSpecial(n=>{assert.equal(n,100);return roll}));
 assert.equal(outcome.filter(x=>x==='minigame').length,3);
 assert.equal(outcome.filter(x=>x==='monster').length,3);
 assert.equal(outcome.filter(x=>x===null).length,94);
 for(const roll of [-1,100,1.5,NaN])assert.throws(()=>drawBankerSpecial(()=>roll),/INVALID_BANKER_SPECIAL_ROLL/);
});


test('every new match has a saved banker personality, with meaningful variety between matches',()=>{
 const counts={stingy:0,balanced:0,generous:0,volatile:0};
 for(let n=0;n<100;n++)counts[pickBankerStyle(max=>{assert.equal(max,100);return n})]++;
 assert.deepEqual(counts,{stingy:25,balanced:35,generous:25,volatile:15});
 const game=create([{id:'a'}],n=>0);
 assert.equal(game.bankerStyle,'stingy');
 assert.equal(publicView(game).bankerStyle,undefined,'private personality cannot spoil the surprise');
 for(const invalid of [-1,100,NaN,1.5])assert.throws(()=>pickBankerStyle(()=>invalid),/INVALID_BANKER_STYLE_ROLL/);
});

test('same case values yield cheaper or more generous offers depending on the banker style',()=>{
 const baseline=create([{id:'a',name:'A'}],()=>0);
 baseline.players[0].case=0;
 baseline.phase='reveal';
 baseline.pending={case:1,actor:'a',eventId:'one'};
 baseline.roundOpened=baseline.bankerSchedule[0]-1;
 const stableRandom=max=>max===10001?5000:Math.floor(max/2);
 const actual={};
 for(const style of ['stingy','balanced','generous','volatile']){
  const g=structuredClone(baseline);g.bankerStyle=style;
  const result=apply(g,'a',{id:'call-'+style,revision:0,type:'ack-reveal'},stableRandom);
  assert.equal(result.phase,'decision');
  actual[style]=result.offer;
  assert.equal(result.history[0].expectedValue,publicRemaining(result).reduce((a,b)=>a+b,0)/publicRemaining(result).length);
 }
 assert.ok(actual.stingy<actual.balanced,'stingy match must be visibly lower');
 assert.ok(actual.generous>actual.balanced,'generous match must be visibly higher');
 assert.ok(actual.generous/actual.stingy>1.5,'offers should differ noticeably between matches');
 const volatileOffers=[0,10000].map(value=>{
  const g=structuredClone(baseline);g.bankerStyle='volatile';
  const rng=max=>max===10001?value:Math.floor(max/2);
  return apply(g,'a',{id:'variable-'+value,revision:0,type:'ack-reveal'},rng).offer;
 });
 assert.ok(volatileOffers[1]>volatileOffers[0],'unpredictable Banker varies strongly from call to call');
});

test('Banker bonus items are moderately rarer without changing prize-wheel proportions',()=>{
 assert.deepEqual(BANKER_REWARD_ODDS,{pack:7,hammer:7});
 const packs=Array.from({length:1000},(_,roll)=>drawBankerPack(max=>{assert.equal(max,1000);return roll}));
 assert.equal(packs.filter(x=>x==='premium').length,7);
 assert.equal(packs.filter(x=>x==='large').length,28);
 assert.equal(packs.filter(x=>x==='small').length,35);
 assert.equal(packs.filter(x=>x===null).length,930);
 const hammerCount=Array.from({length:100},(_,roll)=>drawBankerHammer(max=>max===100?roll:0)).filter(Boolean);
 assert.equal(hammerCount.length,7);
 for(const invalid of [-1,1000,NaN,1.3])assert.throws(()=>drawBankerPack(()=>invalid),/INVALID_BANKER_PACK_ROLL/);
 for(const invalid of [-1,100,NaN,1.3])assert.throws(()=>drawBankerHammer(()=>invalid),/INVALID_BANKER_HAMMER_ROLL/);
});

test('Banker offers publish the special voucher or Monster prize for all players',()=>{
 for(const [slot,kind] of [[0,'minigame'],[5,'monster'],[10,null]]){
  const rng=n=>n===100?slot:0;
  let g=create([{id:'a',name:'Spieler A'},{id:'b',name:'Spieler B'}],rng);
  for(const actor of g.order)g=apply(g,actor,{id:'choose-'+g.revision,revision:g.revision,type:'select',case:g.players.findIndex(p=>p.id===actor)},rng);
  let guard=0;
  while(g.phase!=='decision'&&guard++<40){
   const type=g.phase==='open'?'open':'ack-reveal';
   const actor=type==='open'?nextTurn(g):g.pending.actor;
   g=apply(g,actor,{id:'move-'+g.revision,revision:g.revision,type,...(type==='open'?{case:free(g)[0]}:{})},rng);
  }
  assert.equal(g.phase,'decision');
  assert.equal(g.history.at(-1).bonusSpecial,kind);
  assert.equal(publicView(g).history.at(-1).bonusSpecial,kind);
  assert.equal(g.history.at(-1).participants.length,2);
 }
});
test('Banker hammer bonus is rolled once for a new offer and shown without secrets',()=>{
 let g=create([{id:'p1',name:'Player'}],rand);
 g=send(g,g.order[0],'select',{case:0});
 while(g.phase!=='decision'){
  if(g.phase==='open')g=send(g,nextTurn(g),'open',{case:free(g)[0]});
  else if(g.phase==='reveal')g=send(g,g.pending.actor,'ack-reveal');
 }
 assert.equal(g.history.at(-1).bonusHammer,'single');
 assert.equal(publicView(g).history.at(-1).bonusHammer,'single');
 const before=g.history.at(-1).bonusHammer;
 g=send(g,'p1','decide',{deal:true});
 assert.equal(g.history.at(-1).bonusHammer,before);
 assert.equal(g.history.at(-1).decisions[0].deal,true);
});
test('Banker bonus can be absent with a roll outside the 1-in-10 outcome',()=>{
 const neverBonus=n=>n-1;
 let g=create([{id:'p1'}],neverBonus);
 const command=(actor,type,extra={})=>apply(g,actor,{id:'no-bonus-'+g.revision,revision:g.revision,type,...extra},neverBonus);
 g=command(g.order[0],'select',{case:0});
 while(g.phase!=='decision'){
  if(g.phase==='open')g=command(nextTurn(g),'open',{case:free(g)[0]});
  else if(g.phase==='reveal')g=command(g.pending.actor,'ack-reveal');
 }
 assert.equal(g.history.at(-1).bonusHammer,null);
});

test('29-case new 10-million jackpot is shuffled, private and pays correctly in the finale',()=>{
 const players=[{id:'alice',name:'A'},{id:'bob',name:'B'},{id:'claire',name:'C'}];
 const positions=new Set();
 for(let round=0;round<90;round++){
  const game=create(players,undefined,29);
  assert.equal(game.values.length,29);
  assert.equal(game.values.filter(amount=>amount===1000000000).length,1);
  assert.equal(game.values.filter(amount=>amount===500000000).length,1);
  positions.add(game.values.indexOf(1000000000));
  const view=publicView(game);
  assert.equal(view.caseCount,29);
  assert.equal(view.values,undefined);
  assert.ok(!JSON.stringify(view).includes('1000000000'));
 }
 assert.ok(positions.size>=15,'10-million prize must move among all cases, not be fixed to 29: '+positions.size);
 let game=create([{id:'a',name:'A'}], n=>0,29);
 const jackpotIndex=game.values.indexOf(1000000000);
 game=send(game,'a','select',{case:jackpotIndex});
 while(game.phase!=='final'){
  if(game.phase==='open')game=send(game,'a','open',{case:free(game)[0]});
  else if(game.phase==='reveal')game=send(game,'a','ack-reveal');
  else if(game.phase==='decision')game=send(game,'a','decide',{deal:false});
  else throw Error('Unexpected 29-case phase '+game.phase);
 }
 assert.equal(game.opened.length,28);
 assert.equal(publicView(game).finalValues[0].amount,1000000000);
 assert.equal(publicView(game).finalValues[0].payout,1000000000);
});

function bankerOpenings(caseCount,playerCount,{legacy=false,legacy29=false,legacy30=false,variant=0}={}){
 let game=create(Array.from({length:playerCount},(_,i)=>({id:'p'+i,name:'Player '+i})),n=>n===2?variant:0,caseCount);
 if(legacy){delete game.bankerSchedule;delete game.bankerScheduleVariant;}
 if(legacy29){game.bankerSchedule=[...STEPS_29];delete game.bankerScheduleVariant;}
 if(legacy30){game.bankerSchedule=[...STEPS_30];delete game.bankerScheduleVariant;delete game.openingBatch;}
 const offers=[];
 for(let i=0;i<playerCount;i++)game=send(game,game.order[i],'select',{case:i});
 let guard=0;
 while(game.phase!=='final'&&guard++<200){
  if(game.phase==='batch-pick')game=send(game,game.order[Math.floor(game.openingBatch.picks.length/3)],'open',{case:free(game)[0]});
   else if(game.phase==='batch-reveal'){game.openingBatch.endsAt=Date.now()-1;game=send(game,game.order[0],'ack-batch');}
   else if(game.phase==='open')game=send(game,nextTurn(game),'open',{case:free(game)[0]});
  else if(game.phase==='reveal')game=send(game,game.pending.actor,'ack-reveal');
  else if(game.phase==='decision'){
   offers.push(game.opened.length);
   const ballot=game.history.at(-1);
   for(const actor of ballot.participants){
    game=send(game,actor,'decide',{deal:false});
   }
  }else throw Error('Unexpected phase '+game.phase);
 }
 assert.equal(game.phase,'final','all cases must finish');
 return {game,offers};
}

test('26–29 cases scale exactly two Banker variants to 7 and 8 offers with the last three guaranteed',()=>{
 assert.deepEqual(STEPS_29,[6,5,5,4,3,2,2,1],'legacy 29 schedule remains available');
 assert.deepEqual(STEPS,[5,4,4,3,2,2,1,1],'legacy 26–28 schedule remains available');
 assert.equal(BANKER_30_OPENINGS.length,2);
 for(const caseCount of [26,27,28,29]){
  for(const playerCount of [1,2,3,4]){
   for(let variant=0;variant<2;variant++){
    const max=caseCount-playerCount;
    const template=BANKER_30_OPENINGS[variant].slice(0,-3);
    const finaleStart=max-2;
    const expected=[...template.map(n=>Math.round(n*finaleStart/25)),max-2,max-1,max];
    const {game,offers}=bankerOpenings(caseCount,playerCount,{variant});
    assert.deepEqual(offers,expected,caseCount+' cases '+playerCount+' players variant '+(variant+1));
    assert.equal(game.bankerScheduleVariant,variant+1);
    assert.deepEqual(game.bankerSchedule,expected.map((n,i)=>n-(expected[i-1]||0)));
    assert.equal(game.history.length,variant===0?7:8);
    assert.equal(new Set(offers).size,offers.length);
    assert.equal(game.opened.length,max);
    assert.equal(game.players.every(p=>!game.opened.includes(p.case)),true);
    assert.equal(game.history.at(-1).participants.length,playerCount);
    assert.equal(game.history.at(-1).decisions.length,playerCount);
   }
  }
 }
});
test('new Banker milestones increase strictly with exactly 7/8 calls for every case count and party size',()=>{
 for(const caseCount of [26,27,28,29,30])for(const playerCount of [1,2,3,4]){
  for(const variant of [0,1]){
   const game=create(Array.from({length:playerCount},(_,i)=>({id:'p'+i})),n=>n===2?variant:0,caseCount);
   const targets=game.bankerSchedule.reduce((list,step)=>[...list,(list.at(-1)||0)+step],[]);
   assert.equal(game.bankerScheduleVariant,variant+1);
   assert.equal(targets.length,variant===0?7:8);
   assert.ok(targets.every((number,i)=>Number.isInteger(number)&&number>=1&&
    number<=caseCount-playerCount&&(i===0||number>targets[i-1])));
   assert.deepEqual(targets.slice(-3),
    [caseCount-playerCount-2,caseCount-playerCount-1,caseCount-playerCount],
    'the final three calls always precede the personal case reveal');
   if(caseCount===30)assert.equal(targets[0],playerCount*3,
    'batch reveal always leads straight into the first offer');
  }
 }
});
test('existing matches with a stored six-call Banker cadence keep their milestones',()=>{
 let old=create([{id:'a'},{id:'b'},{id:'c'}],n=>0,30);
 old.bankerSchedule=[9,8,6,2,1,1];
 old.bankerScheduleVariant=1;
 const copied=structuredClone(old);
 assert.deepEqual(publicView(copied).bankerSchedule,[9,8,6,2,1,1],
  'previously persisted game schedules remain authoritative');
});
test('in-progress 29-case game retains previous eight-offer schedule',()=>{
 const {game,offers}=bankerOpenings(29,1,{legacy29:true});
 assert.deepEqual(offers,[6,11,16,20,23,25,27,28]);
 assert.equal(game.history.length,8);
 assert.equal(game.opened.length,28);
 assert.deepEqual(game.bankerSchedule,STEPS_29);
 assert.equal(game.bankerScheduleVariant,undefined);
});
test('in-progress 26–28 games with no saved schedule retain previous cadence',()=>{
 const base=[5,9,13,16,18,20,21,22];
 for(const caseCount of [26,27,28]){
  const {game,offers}=bankerOpenings(caseCount,1,{legacy:true});
  const expected=[...base,...Array.from({length:caseCount-23},(_,i)=>23+i)];
  assert.deepEqual(offers,expected);
  assert.equal(game.bankerSchedule,undefined);
  assert.equal(game.bankerScheduleVariant,undefined);
 }
});
test('in-progress legacy 29-case matches with no stored schedule remain recoverable',()=>{
 const {game,offers}=bankerOpenings(29,1,{legacy:true});
 assert.deepEqual(offers,[5,9,13,16,18,20,21,22,23,24,25,26,27,28]);
 assert.equal(game.bankerSchedule,undefined);
 assert.equal(game.opened.length,28);
});
test('new 29-case matches offer first deal at scheduled time and still end early if all accept',()=>{
 const game=create([{id:'a'},{id:'b'}],n=>0,29);
 assert.equal(game.bankerScheduleVariant,1);
 assert.equal(game.bankerSchedule[0],9);
 let next=send(game,game.order[0],'select',{case:0});
 next=send(next,game.order[1],'select',{case:1});
 for(let i=0;i<8;i++){
  next=send(next,nextTurn(next),'open',{case:free(next)[0]});
  next=send(next,next.pending.actor,'ack-reveal');
  assert.equal(next.phase,'open');
  assert.equal(next.history.length,0);
 }
 next=send(next,nextTurn(next),'open',{case:free(next)[0]});
 next=send(next,next.pending.actor,'ack-reveal');
 assert.equal(next.phase,'decision');
 assert.equal(next.history.length,1);
 for(const actor of next.history[0].participants)next=send(next,actor,'decide',{deal:true});
 assert.equal(next.phase,'final');
 assert.equal(next.opened.length,9);
 assert.equal(next.history.length,1);
});

test('30-case new 50-million jackpot is randomly hidden and pays exactly 50 million euros',()=>{
 const jackpot=5000000000,players=[{id:'a',name:'A'},{id:'b',name:'B'}],positions=new Set();
 for(let i=0;i<85;i++){
  const g=create(players,undefined,30);
  assert.equal(g.values.length,30);
  assert.equal(g.values.filter(v=>v===jackpot).length,1);
  positions.add(g.values.indexOf(jackpot));
  const view=publicView(g);
  assert.equal(view.caseCount,30);
  assert.equal(view.values,undefined);
  assert.ok(!JSON.stringify(view).includes('5000000000'),'jackpot remains private until finale');
 }
 assert.ok(positions.size>=15,'50m prize must shuffle among all 30 cases');
 let game=create([{id:'a',name:'A'}],n=>0,30);
 const selectedCase=game.values.indexOf(jackpot);
 game=send(game,'a','select',{case:selectedCase});
 let guard=0;
 while(game.phase!=='final'&&guard++<180){
  if(game.phase==='batch-pick')game=send(game,game.order[Math.floor(game.openingBatch.picks.length/3)],'open',{case:free(game)[0]});
   else if(game.phase==='batch-reveal'){game.openingBatch.endsAt=Date.now()-1;game=send(game,'a','ack-batch');}
   else if(game.phase==='open')game=send(game,'a','open',{case:free(game)[0]});
  else if(game.phase==='reveal')game=send(game,'a','ack-reveal');
  else if(game.phase==='decision')game=send(game,'a','decide',{deal:false});
  else throw Error('Unexpected 30-case phase '+game.phase);
 }
 assert.equal(game.phase,'final');
 assert.equal(game.opened.length,29);
 assert.equal(publicView(game).finalValues[0].amount,jackpot);
 assert.equal(publicView(game).finalValues[0].payout,jackpot);
});


test('30-case opening collects three cases per player before rapid nine-case reveal',()=>{
 let g=create([{id:'a'},{id:'b'},{id:'c'}],rand,30);
 for(let i=0;i<3;i++)g=send(g,g.order[i],'select',{case:i});
 assert.equal(g.phase,'batch-pick');
 assert.equal(g.bankerSchedule[0],9);
 assert.throws(()=>send(g,g.order[1],'open',{case:3}),/INVALID_BATCH_PICK/);
 for(let i=0;i<9;i++){
  const actor=g.order[Math.floor(i/3)],chosen=3+i;
  g=send(g,actor,'open',{case:chosen});
  assert.equal(g.opened.length,0);
  assert.equal(g.history.length,0);
  assert.equal(g.openingBatch.picks.length,i+1);
  assert.ok(!free(g).includes(chosen));
  if(i<8)assert.equal(g.phase,'batch-pick');
 }
 assert.equal(g.phase,'batch-reveal');
 const view=publicView(g);
 assert.deepEqual(view.openingBatch.reveals.map(p=>p.case),[3,4,5,6,7,8,9,10,11]);
 assert.ok(view.openingBatch.endsAt>view.openingBatch.startedAt);
 assert.throws(()=>send(g,g.order[0],'ack-batch'),/INVALID_BATCH_ACK/);
 g.openingBatch.endsAt=Date.now()-1;
 g=send(g,g.order[1],'ack-batch');
 assert.equal(g.phase,'decision');
 assert.equal(g.opened.length,9);
 assert.equal(g.events.filter(e=>e.type==='opened').length,9);
 assert.equal(g.history.length,1);
});
test('30-case batch respects player counts and already-running legacy matches',()=>{
 for(const count of [1,2,4]){
  let g=create(Array.from({length:count},(_,i)=>({id:'p'+i})),rand,30);
  for(let i=0;i<count;i++)g=send(g,g.order[i],'select',{case:i});
  for(let i=0;i<count*3;i++)g=send(g,g.order[Math.floor(i/3)],'open',{case:free(g)[0]});
  assert.equal(g.phase,'batch-reveal');
  g.openingBatch.endsAt=Date.now()-1;
  g=send(g,g.order[0],'ack-batch');
  assert.equal(g.history[0].round,1);
  assert.equal(g.opened.length,count*3);
 }
 let legacy=create([{id:'a'}],rand,30);
 delete legacy.openingBatch;
 legacy=send(legacy,'a','select',{case:0});
 assert.equal(legacy.phase,'open');
 legacy=send(legacy,'a','open',{case:1});
 assert.equal(legacy.phase,'reveal');
});

test('30-case Banker offers have exactly two variants and mandatory 25, 26, 27 calls',()=>{
 const expected=[
  [9,18,20,23,25,26,27],
  [9,12,15,21,23,25,26,27]
 ];
 assert.deepEqual(BANKER_30_OPENINGS,expected);
 assert.equal(BANKER_30_OPENINGS.length,2,'two fixed variants only');
 for(let variant=0;variant<2;variant++){
  const picked=pick30BankerSchedule(n=>{assert.equal(n,2);return variant});
  assert.equal(picked.variant,variant+1);
  assert.deepEqual(picked.steps,expected[variant].map((n,i)=>n-(expected[variant][i-1]||0)));
  const {game,offers}=bankerOpenings(30,3,{variant});
  assert.equal(game.bankerScheduleVariant,variant+1);
  assert.deepEqual(offers,expected[variant],'three-player variant '+(variant+1));
  assert.deepEqual(offers.slice(-3),[25,26,27]);
  assert.equal(game.opened.length,27);
  assert.equal(game.history.length,variant===0?7:8);
  assert.deepEqual(publicView(game).bankerSchedule,game.bankerSchedule);
  assert.equal(publicView(game).bankerScheduleVariant,variant+1);
  const lastOffer=game.history.at(-1);
  assert.equal(lastOffer.round,variant===0?7:8);
 }
});

test('with 1–4 players the final three openable cases ALWAYS trigger a Banker offer',()=>{
 for(let variant=0;variant<2;variant++){
  for(const playerCount of [1,2,3,4]){
   const {game,offers}=bankerOpenings(30,playerCount,{variant});
   const finalCount=30-playerCount;
   assert.deepEqual(offers.slice(-3),[finalCount-2,finalCount-1,finalCount],
    'variant '+(variant+1)+' / '+playerCount+' players');
   assert.equal(offers.length,variant===0?7:8,'variant 1 has seven calls, variant 2 has eight');
   assert.equal(new Set(offers).size,offers.length);
   assert.equal(game.opened.length,finalCount);
   assert.equal(game.history.length,offers.length);
   assert.ok(game.players.every(p=>!game.opened.includes(p.case)));
   assert.equal(game.history.at(-1).decisions.length,playerCount);
  }
 }
});

test('Banker must offer at suitcase 27 before personal suitcases can be revealed',()=>{
 let game=create([{id:'a'},{id:'b'},{id:'c'}],n=>n===2?1:0,30);
 for(let i=0;i<3;i++)game=send(game,game.order[i],'select',{case:i});
 let guard=0;
 while(game.opened.length<27&&guard++<90){
  if(game.phase==='batch-pick')
   game=send(game,game.order[Math.floor(game.openingBatch.picks.length/3)],'open',{case:free(game)[0]});
  else if(game.phase==='batch-reveal'){
   game.openingBatch.endsAt=Date.now()-1;
   game=send(game,game.order[0],'ack-batch');
  }
  else if(game.phase==='open')game=send(game,nextTurn(game),'open',{case:free(game)[0]});
  else if(game.phase==='reveal')game=send(game,game.pending.actor,'ack-reveal');
  else if(game.phase==='decision'){
   const ballot=game.history.at(-1);
   for(const actor of ballot.participants)game=send(game,actor,'decide',{deal:false});
  }else throw Error('Unexpected phase '+game.phase);
 }
 assert.equal(game.opened.length,27);
 assert.equal(game.phase,'decision','final Banker offer must appear BEFORE final');
 assert.equal(publicView(game).finalValues,null,'personal suitcases still secret');
 assert.equal(game.history.length,8);
 for(const actor of game.history.at(-1).participants)game=send(game,actor,'decide',{deal:false});
 assert.equal(game.phase,'final');
 assert.equal(publicView(game).finalValues.length,3);
});

test('once drawn, one of two Banker variants remains fixed across batch and votes',()=>{
 let game=create([{id:'a'},{id:'b'},{id:'c'}],n=>n===2?1:0,30);
 const schedule=[...game.bankerSchedule];
 assert.equal(game.bankerScheduleVariant,2);
 for(let i=0;i<3;i++)game=send(game,game.order[i],'select',{case:i});
 for(let i=0;i<9;i++)game=send(game,game.order[Math.floor(i/3)],'open',{case:free(game)[0]});
 assert.equal(game.phase,'batch-reveal');
 game.openingBatch.endsAt=Date.now()-1;
 game=send(game,game.order[0],'ack-batch');
 assert.equal(game.phase,'decision');
 for(const id of game.history.at(-1).participants)game=send(game,id,'decide',{deal:false});
 assert.deepEqual(game.bankerSchedule,schedule);
 assert.equal(game.bankerScheduleVariant,2);
});

test('already started 30-case games keep the preexisting eight-offer rhythm',()=>{
 assert.deepEqual(STEPS_30,[6,5,5,4,3,3,2,1]);
 const {game,offers}=bankerOpenings(30,1,{legacy30:true});
 assert.deepEqual(offers,[6,11,16,20,23,26,28,29]);
 assert.equal(game.opened.length,29);
 assert.equal(game.history.length,8);
 assert.deepEqual(publicView(game).bankerSchedule,STEPS_30);
 assert.equal(game.bankerScheduleVariant,undefined);
});


test('personal Banker mode keeps three binding offers and honors each separate decision',()=>{
 const players=['a','b','c'].map(id=>({id,name:id}));
 let game=create(players,rand,27,{individualBankerOffers:true});
 assert.equal(game.individualBankerOffers,true);
 for(const id of game.order)game=send(game,id,'select',{case:game.order.indexOf(id)});
 let safety=50;
 while(game.phase!=='decision'&&safety-->0){
  if(game.phase==='open')game=send(game,nextTurn(game),'open',{case:free(game)[0]});
  else if(game.phase==='reveal')game=send(game,game.pending.actor,'ack-reveal');
  else throw Error('Unexpected phase '+game.phase);
 }
 assert.equal(game.phase,'decision');
 const first=game.history.at(-1),ids=first.participants;
 assert.equal(ids.length,3);
 assert.deepEqual(Object.keys(first.offersByPlayer).sort(),[...ids].sort());
 const prices=ids.map(uid=>first.offersByPlayer[uid]);
 assert.equal(new Set(prices).size,3,'a live Banker call cannot send identical personal amounts');
 assert.ok(prices.every(price=>Number.isSafeInteger(price)&&price>=1&&price<=MAX_MATCH_CREDIT_CENTS));
 assert.equal(first.megaOfferUids.length,3,'deterministic RNG triggers rare mega path');
 for(const id of ids)assert.equal(bankerOfferFor(game,id),first.offersByPlayer[id]);
 assert.deepEqual(publicView(game).history.at(-1).offersByPlayer,first.offersByPlayer);
 const accepted=ids[0],declined=ids[1],alsoAccepted=ids[2];
 game=send(game,accepted,'decide',{deal:true});
 assert.equal(game.players.find(p=>p.id===accepted).deal,first.offersByPlayer[accepted]);
 assert.equal(publicView(game).players.find(p=>p.id===accepted).deal,null,'interim vote is hidden');
 game=send(game,declined,'decide',{deal:false});
 assert.equal(game.players.find(p=>p.id===declined).deal,null);
 game=send(game,alsoAccepted,'decide',{deal:true});
 assert.equal(game.players.find(p=>p.id===alsoAccepted).deal,first.offersByPlayer[alsoAccepted]);
 assert.equal(game.players.find(p=>p.id===declined).deal,null);
 assert.equal(game.phase,'open','declining player continues opening their case');
});

test('Banker chaos uses independent random tiers including a rare mega call',()=>{
 let game=create(['a','b','c'].map(id=>({id})),rand,27,{individualBankerOffers:true});
 for(const id of game.order)game=send(game,id,'select',{case:game.order.indexOf(id)});
 // The first 1000-sided draw is for the normal pack bonus; the next three
 // are personal pricing tiers, one of which is the rare mega tier.
 let rolls=0;
 const chooser=max=>max===1000?[500,0,200,950][rolls++]:max===10001?5000:0;
 let safety=50;
 while(game.phase!=='decision'&&safety-->0){
  if(game.phase==='open')game=apply(game,nextTurn(game),{id:'roll-'+game.revision,revision:game.revision,type:'open',case:free(game)[0]},chooser);
  else if(game.phase==='reveal')game=apply(game,game.pending.actor,{id:'roll-'+game.revision,revision:game.revision,type:'ack-reveal'},chooser);
  else throw Error('Unexpected phase '+game.phase);
 }
 assert.equal(game.phase,'decision');
 const h=game.history.at(-1);
 assert.equal(rolls,4);
 assert.deepEqual(h.megaOfferUids,[h.participants[0]]);
 assert.ok(h.offersByPlayer[h.participants[0]]>=h.offersByPlayer[h.participants[2]],'mega exceeds ordinary tier');
 assert.equal(new Set(Object.values(h.offersByPlayer)).size,3);
});

test('ordinary Banker games retain the exact original shared offer contract',()=>{
 let game=create([{id:'a'},{id:'b'}],rand);
 assert.equal(game.individualBankerOffers,undefined);
 for(const id of game.order)game=send(game,id,'select',{case:game.order.indexOf(id)});
 let safety=50;
 while(game.phase!=='decision'&&safety-->0){
  if(game.phase==='open')game=send(game,nextTurn(game),'open',{case:free(game)[0]});
  else if(game.phase==='reveal')game=send(game,game.pending.actor,'ack-reveal');
  else throw Error('Unexpected phase '+game.phase);
 }
 assert.equal(game.phase,'decision');
 const h=game.history.at(-1);
 assert.equal('offersByPlayer' in h,false);
 assert.equal('megaOfferUids' in h,false);
 assert.equal(bankerOfferFor(game,'a'),game.offer);
 assert.equal(bankerOfferFor(game,'b'),game.offer);
 game=send(game,'a','decide',{deal:true});
 game=send(game,'b','decide',{deal:true});
 assert.equal(game.players.find(p=>p.id==='a').deal,h.offer);
 assert.equal(game.players.find(p=>p.id==='b').deal,h.offer);
});


// Real game transition test: only the server's existing game transition creates
// offers. No UI-only amount increases or additional database writes are needed.
function advanceBankerUntilDecision(game,rng){
 let safety=80;
 while(game.phase!=='decision'&&safety-->0){
  if(game.phase==='open'){
   const cheapest=free(game).sort((a,b)=>game.values[a]-game.values[b])[0];
   game=apply(game,nextTurn(game),{id:'smart-open-'+game.revision,revision:game.revision,type:'open',case:cheapest},rng);
  }else if(game.phase==='reveal'){
   game=apply(game,game.pending.actor,{id:'smart-ack-'+game.revision,revision:game.revision,type:'ack-reveal'},rng);
  }else throw Error('Unexpected Banker setup phase: '+game.phase);
 }
 assert.equal(game.phase,'decision');
 return game;
}
function allRefuseBanker(game,rng){
 const ids=[...game.history.at(-1).participants];
 for(const id of ids){
  game=apply(game,id,{id:'smart-no-'+game.revision,revision:game.revision,type:'decide',deal:false},rng);
 }
 return game;
}
test('Banker progressively raises shared bids as low cases leave the board',()=>{
 const rng=max=>max===100?60:max===10001?0:max===1000?850:0;
 let g=create([{id:'a'},{id:'b'}],rng,27);
 for(const id of g.order)g=apply(g,id,{id:'smart-select-'+g.revision,revision:g.revision,type:'select',case:free(g)[0]},rng);
 g=advanceBankerUntilDecision(g,rng);
 const old=g.history.at(-1);
 const oldOffer=old.offer,oldAverage=old.expectedValue;
 g=allRefuseBanker(g,rng);
 g=advanceBankerUntilDecision(g,rng);
 const next=g.history.at(-1);
 assert.ok(next.expectedValue>=oldAverage*.985,'cheap case removals preserve/improve the remaining board');
 const cap=Math.min(MAX_MATCH_CREDIT_CENTS,Math.round(next.expectedValue*1.25));
 assert.ok(next.offer>oldOffer,'the next shared Banker bid must visibly increase');
 assert.ok(next.offer>=Math.min(cap,Math.round(oldOffer*1.065)),'follow-up increase at least 6.5% unless fair ceiling binds');
 assert.ok(next.offer<=cap,'the original 125% fair-value limit still applies');
});
test('personal Banker bids progress independently after low cases leave',()=>{
 let later=false;
 const rng=max=>max===100?60:max===10001?0:max===1000?(later?300:800):0;
 let g=create([{id:'a'},{id:'b'},{id:'c'}],rng,27,{individualBankerOffers:true});
 for(const id of g.order)g=apply(g,id,{id:'smart-select-'+g.revision,revision:g.revision,type:'select',case:free(g)[0]},rng);
 g=advanceBankerUntilDecision(g,rng);
 const before=g.history.at(-1);
 assert.deepEqual(before.megaOfferUids,[]);
 const prior=structuredClone(before.offersByPlayer);
 g=allRefuseBanker(g,rng);
 later=true; // Deliberately force a worse random tier on the next call.
 g=advanceBankerUntilDecision(g,rng);
 const after=g.history.at(-1);
 assert.ok(after.expectedValue>=before.expectedValue*.985);
 for(const uid of after.participants){
  assert.ok(after.offersByPlayer[uid]>prior[uid],uid+' still receives a rising bid');
  assert.ok(after.offersByPlayer[uid]>=Math.round(prior[uid]*1.065),
   uid+' has the minimum 6.5% follow-up despite a low pricing roll');
  assert.ok(after.offersByPlayer[uid]<=MAX_MATCH_CREDIT_CENTS);
 }
 assert.equal(new Set(Object.values(after.offersByPlayer)).size,3);
});
test('Banker can reduce its bid when a major remaining jackpot disappears',()=>{
 const rng=max=>max===100?60:max===10001?0:max===1000?850:0;
 let g=create([{id:'a'},{id:'b'}],rng,27);
 for(const id of g.order)g=apply(g,id,{id:'smart-select-'+g.revision,revision:g.revision,type:'select',case:free(g)[0]},rng);
 g=advanceBankerUntilDecision(g,rng);
 const before=g.history.at(-1);
 g=allRefuseBanker(g,rng);
 // Make the largest remaining *openable* case the next casualty.
 const expensive=free(g).sort((a,b)=>g.values[b]-g.values[a])[0];
 const actor=nextTurn(g);
 g=apply(g,actor,{id:'smart-expensive-'+g.revision,revision:g.revision,type:'open',case:expensive},rng);
 g=apply(g,actor,{id:'smart-expensive-ack-'+g.revision,revision:g.revision,type:'ack-reveal'},rng);
 g=advanceBankerUntilDecision(g,rng);
 const after=g.history.at(-1);
 assert.ok(after.expectedValue<before.expectedValue*.985,'the lost high value changes risk materially');
 assert.ok(after.offer<=Math.min(MAX_MATCH_CREDIT_CENTS,Math.round(after.expectedValue*1.25)));
 assert.ok(after.offer>=1);
});
