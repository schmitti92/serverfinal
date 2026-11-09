'use strict';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {create,apply,publicView,free,VALUES,STEPS,STEPS_29,publicRemaining,nextTurn,drawHammerFromTwelve} from '../deal-or-no-deal.js';
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
test('29 distinct monetary values including 3, 5 and 10 million euros',()=>{
 assert.equal(VALUES.length,29);
 assert.equal(new Set(VALUES).size,29);
 assert.equal(VALUES[26],300000000); // 3 Mio. EUR (cents)
 assert.equal(VALUES[27],500000000); // 5 Mio. EUR (cents)
 assert.equal(VALUES[28],1000000000); // 10 Mio. EUR (cents)
});
for(const count of [26,27,28,29]){
 test(count+' cases contain the correct prizes and reach a final',()=>{
  let game=create([{id:'a',name:'Spieler A'}],rand,count);
  assert.equal(game.values.length,count);
  assert.equal(publicView(game).caseCount,count);
  assert.equal(game.values.includes(500000000),count>=28);
  assert.equal(game.values.includes(1000000000),count===29);
  assert.equal(game.values.includes(300000000),count>=27);
  game=send(game,'a','select',{case:0});
  let guard=0;
  while(game.phase!=='final'&&guard++<200){
   if(game.phase==='open')game=send(game,'a','open',{case:free(game)[0]});
   else if(game.phase==='reveal')game=send(game,'a','ack-reveal');
   else if(game.phase==='decision')game=send(game,'a','decide',{deal:false});
   else throw Error('Unexpected phase '+game.phase);
  }
  assert.equal(game.phase,'final');
  assert.equal(game.opened.length,count-1);
 });
}
test('invalid case counts are rejected',()=>{for(const n of [25,30,0,26.5])assert.throws(()=>create([{id:'a'}],rand,n),/INVALID_CASE_COUNT/)});

for(let count=1;count<=4;count++){
 test(count+' players finish full game with correct opening count',()=>{let g=simulate(count);assert.equal(g.opened.length,27-count);assert.equal(g.history.length,13-count);assert.equal(new Set(g.opened).size,g.opened.length);assert.equal(g.players.every(p=>!g.opened.includes(p.case)),true)});
 test(count+' players accepting first deal end immediately',()=>{let g=simulate(count,true);assert.equal(g.opened.length,5);assert.equal(g.history.length,1);assert.equal(g.players.every(p=>p.deal!==null),true)});
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

test('banker offer is positive, capped at 115% of fair expected value, and records valuation',()=>{
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
    assert.ok(g.offer>=1&&g.offer<=Math.max(1,Math.round(expected*1.15)),
     'Banker offers are intentionally permitted up to 115% of expected value');
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

function bankerOpenings(caseCount,playerCount,{legacy=false}={}){
 let game=create(Array.from({length:playerCount},(_,i)=>({id:'p'+i,name:'Player '+i})),n=>0,caseCount);
 if(legacy)delete game.bankerSchedule;
 const offers=[];
 for(let i=0;i<playerCount;i++)game=send(game,game.order[i],'select',{case:i});
 let guard=0;
 while(game.phase!=='final'&&guard++<200){
  if(game.phase==='open')game=send(game,nextTurn(game),'open',{case:free(game)[0]});
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

test('29-briefcase banker schedule spreads eight offers across 28 opened cases',()=>{
 assert.deepEqual(STEPS_29,[6,5,5,4,3,2,2,1]);
 assert.equal(STEPS_29.reduce((a,b)=>a+b,0),28);
 const {game,offers}=bankerOpenings(29,1);
 assert.deepEqual(offers,[6,11,16,20,23,25,27,28]);
 assert.equal(game.history.length,8);
 assert.equal(game.opened.length,28);
 assert.deepEqual(publicView(game).bankerSchedule,STEPS_29);
});

test('29-briefcase multiplayer banker calls are spaced and stop at protected personal cases',()=>{
 for(const [players,expected] of [
  [2,[6,11,16,20,23,25,27]],
  [3,[6,11,16,20,23,25,26]],
  [4,[6,11,16,20,23,25]],
 ]){
  const {game,offers}=bankerOpenings(29,players);
  assert.deepEqual(offers,expected,players+' players');
  assert.equal(game.opened.length,29-players);
  assert.equal(new Set(game.opened).size,game.opened.length);
  assert.equal(game.players.every(p=>!game.opened.includes(p.case)),true);
  assert.equal(game.history.length,expected.length);
 }
});

test('26, 27 and 28 briefcase matches retain their existing banker thresholds',()=>{
 assert.deepEqual(STEPS,[5,4,4,3,2,2,1,1]);
 const base=[5,9,13,16,18,20,21,22];
 for(const count of [26,27,28]){
  const {game,offers}=bankerOpenings(count,1);
  const expected=[...base,...Array.from({length:count-23},(_,i)=>23+i)];
  assert.deepEqual(offers,expected,count+' cases');
  assert.equal(game.bankerSchedule,null);
 }
});

test('in-progress legacy 29-case games keep their old offer cadence without a reset',()=>{
 const {game,offers}=bankerOpenings(29,1,{legacy:true});
 const expected=[5,9,13,16,18,20,21,22,23,24,25,26,27,28];
 assert.deepEqual(offers,expected);
 assert.equal(game.bankerSchedule,undefined);
 assert.equal(game.opened.length,28);
});

test('29-case matches accepting the first banker deal show the banker only after six opens',()=>{
 const game=create([{id:'a'},{id:'b'}],n=>0,29);
 assert.deepEqual(game.bankerSchedule,[6,5,5,4,3,2,2,1]);
 let next=send(game,game.order[0],'select',{case:0});
 next=send(next,game.order[1],'select',{case:1});
 for(let i=0;i<5;i++){
  next=send(next,nextTurn(next),'open',{case:free(next)[0]});
  next=send(next,next.pending.actor,'ack-reveal');
  assert.equal(next.phase,'open');
  assert.equal(next.history.length,0,'not yet banker at '+(i+1));
 }
 next=send(next,nextTurn(next),'open',{case:free(next)[0]});
 next=send(next,next.pending.actor,'ack-reveal');
 assert.equal(next.phase,'decision');
 assert.equal(next.history.length,1);
 for(const actor of next.history[0].participants)next=send(next,actor,'decide',{deal:true});
 assert.equal(next.phase,'final');
 assert.equal(next.opened.length,6);
 assert.equal(next.history.length,1);
});
