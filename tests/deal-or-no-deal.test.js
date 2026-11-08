'use strict';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {create,apply,publicView,free,VALUES,publicRemaining,nextTurn} from '../deal-or-no-deal.js';
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
test('27 distinct monetary values including 3 million euros',()=>{assert.equal(new Set(VALUES).size,27);assert.ok(VALUES.includes(300000000));});
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

test('banker offer is positive, no higher than fair expected value, and records the valuation',()=>{
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
    assert.ok(g.offer>=1&&g.offer<=Math.round(expected));
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
  assert.deepEqual([...game.values].sort((a,b)=>a-b),[...VALUES].sort((a,b)=>a-b));
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
