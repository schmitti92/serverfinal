import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDeck,createGame,exchangeCard,legalActions,takeAction,cancelSeven,publicState,botAction} from '../dog/engine.js';

function ready(){
 let s=createGame({rng:()=>0.1234,bots:[false,false,false,false]});
 for(let i=0;i<4;i++)s=exchangeCard(s,i,s.hands[i][0].id);
 return s;
}
function card(s,seat,type){
 s.phase='play';s.current=seat;s.hands=[[],[],[],[]];
 s.hands[seat]=[{id:999,type}];
 return s;
}
test('110-card deck matches Schmidt classic distribution',()=>{
 const all=makeDeck(),counts={};
 for(const c of all)counts[c.type]=(counts[c.type]||0)+1;
 assert.equal(all.length,110);assert.equal(counts.joker,6);
 for(const [type,count] of Object.entries(counts))if(type!=='joker')assert.equal(count,8);
});
test('exchange is simultaneous and a secret hand cannot be read by opponents',()=>{
 let s=createGame({rng:()=>0.5});
 assert.deepEqual(s.hands.map(h=>h.length),[6,6,6,6]);
 const cardIds=s.hands.map(h=>h[0].id);
 s=exchangeCard(s,0,cardIds[0]);
 assert.equal(s.phase,'exchange');
 assert.equal(s.hands[2].some(c=>c.id===cardIds[0]),false);
 for(let i=1;i<4;i++)s=exchangeCard(s,i,cardIds[i]);
 assert.equal(s.phase,'play');
 assert.equal(s.hands[2].some(c=>c.id===cardIds[0]),true);
 assert.equal(publicState(s,0).hands[2].count,6);
 assert.equal(publicState(s,0).deck,undefined);
});
test('start card spawns figure, but cannot start onto occupied protected start',()=>{
 const s=card(ready(),0,'1/11');
 s.pieces[1].place='track';s.pieces[1].pos=0;
 assert.equal(legalActions(s,0).some(a=>a.type==='start'),false);
});
test('protected start is not passable',()=>{
 const s=card(ready(),0,'4');
 s.pieces[0].place='track';s.pieces[0].pos=63;
 s.pieces[1].place='track';s.pieces[1].pos=0;
 assert.equal(legalActions(s,0).some(a=>a.pieceId===0&&a.steps===4),false);
});
test('4 can move backwards from own start',()=>{
 let s=card(ready(),0,'4');
 s.pieces[0].place='track';s.pieces[0].pos=0;
 const action=legalActions(s,0).find(a=>a.type==='move'&&a.steps===-4&&a.pieceId===0);
 assert.ok(action);
 s=takeAction(s,0,action);
 assert.equal(s.pieces[0].pos,60);
});
test('7 takes out every figure it crosses, including partner pieces',()=>{
 let s=card(ready(),0,'7');
 s.pieces[0].place='track';s.pieces[0].pos=3;
 s.pieces[4].place='track';s.pieces[4].pos=5;
 s.pieces[8].place='track';s.pieces[8].pos=7;
 const action=legalActions(s,0).find(a=>a.type==='seven');
 assert.ok(action);
 s=takeAction(s,0,action);
 const portion=legalActions(s,0).find(a=>a.pieceId===0&&a.steps===4);
 assert.ok(portion);
 s=takeAction(s,0,portion);
 assert.equal(s.pieces[4].place,'home');
 assert.equal(s.pieces[8].place,'home');
 assert.equal(s.seven.spent,4);
 s=cancelSeven(s,0);
 assert.equal(s.pieces[4].place,'track');
 assert.equal(s.pieces[8].place,'track');
});
test('finished owner may use cards for teammate',()=>{
 const s=card(ready(),0,'2');
 for(let i=0;i<4;i++){s.pieces[i].place='goal';s.pieces[i].pos=i;}
 s.pieces[8].place='track';s.pieces[8].pos=34;
 assert.equal(legalActions(s,0).some(a=>a.pieceId===8),true);
});
test('illegal actions are rejected rather than accepted',()=>{
 const s=card(ready(),0,'5');
 assert.throws(()=>takeAction(s,0,{type:'move',cardId:999,as:'5',pieceId:0,steps:90}),/ILLEGAL_ACTION/);
});
test('computer-vs-computer matches terminate with a team winner',()=>{
 for(let gameNo=0;gameNo<8;gameNo++){
  let s=createGame({bots:[true,true,true,true]});
  for(let step=0;step<1500&&s.phase!=='finished';step++){
   if(s.phase==='exchange'){
    for(let seat=0;seat<4;seat++)if(!s.exchanges[seat])s=exchangeCard(s,seat,botAction(s,seat).cardId);
   }else {
    const move=botAction(s,s.current);
    assert.ok(move,'bot must have legal action');
    s=takeAction(s,s.current,move);
   }
  }
  assert.equal(s.phase,'finished');
  assert.ok(s.winner===0||s.winner===1);
 }
});
