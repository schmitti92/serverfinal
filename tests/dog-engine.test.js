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
test('first player at 4/4 ends classic DOG instead of playing partner pawns',()=>{
 const s=card(ready(),0,'2');
 for(let i=0;i<4;i++){s.pieces[i].place='goal';s.pieces[i].pos=i;}
 s.pieces[8].place='track';s.pieces[8].pos=34;
 assert.deepEqual(legalActions(s,0),[],'victorious player cannot act again');
 assert.throws(()=>takeAction(s,0,{type:'move',cardId:999}),/GAME_ALREADY_FINISHED/);
});
test('illegal actions are rejected rather than accepted',()=>{
 const s=card(ready(),0,'5');
 assert.throws(()=>takeAction(s,0,{type:'move',cardId:999,as:'5',pieceId:0,steps:90}),/ILLEGAL_ACTION/);
});
test('the online discard pile exposes the last played card without exposing hidden cards',()=>{
 let s=card(ready(),0,'4');
 s.pieces[0].place='track';s.pieces[0].pos=0;
 const move=legalActions(s,0).find(a=>a.type==='move'&&a.pieceId===0&&a.steps===-4);
 assert.ok(move);
 s=takeAction(s,0,move);
 assert.deepEqual(s.lastPlayedCard,{type:'4',seat:0});
 const member=publicState(s,0);
 const spectator=publicState(s,null);
 assert.deepEqual(member.lastPlayedCard,{type:'4',seat:0});
 assert.deepEqual(spectator.lastPlayedCard,{type:'4',seat:0});
 assert.equal(member.discardCount>=1,true);
 assert.equal(spectator.deck,undefined);
 assert.equal(spectator.discard,undefined);
 assert.ok(spectator.hands.every(hand=>!Array.isArray(hand)));
});

test('computer-vs-computer matches terminate with a team winner',()=>{
 for(let gameNo=0;gameNo<8;gameNo++){
  let s=createGame({bots:[true,true,true,true]});
  for(let step=0;step<5000&&s.phase!=='finished';step++){
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

test('three human DOG players have no bot, no fourth cards and clockwise exchange',()=>{
 let s=createGame({rng:()=>0.143,inactiveSeats:[3],bots:[false,false,false,false],
  names:['Chris','Vanessa','David','Freier Platz']});
 assert.equal(s.mode,'solo3');
 assert.deepEqual(s.players.map(p=>p.bot),[false,false,false,false]);
 assert.deepEqual(s.players.map(p=>p.inactive),[false,false,false,true]);
 assert.deepEqual(s.hands.map(h=>h.length),[6,6,6,0]);
 assert.equal(s.pieces.length,12);
 assert.deepEqual(s.exchanges,[null,null,null,true]);
 const ids=[0,1,2].map(seat=>s.hands[seat][0].id);
 for(let seat=0;seat<3;seat++)s=exchangeCard(s,seat,ids[seat]);
 assert.equal(s.phase,'play');
 assert.equal(s.hands[1].some(c=>c.id===ids[0]),true,'Chris passes to Vanessa');
 assert.equal(s.hands[2].some(c=>c.id===ids[1]),true,'Vanessa passes to David');
 assert.equal(s.hands[0].some(c=>c.id===ids[2]),true,'David passes to Chris');
 assert.equal(s.hands[3].length,0);
 assert.deepEqual(legalActions(s,3),[],'inactive seat can never move');
 assert.equal(s.players[s.current].inactive,false);
});
test('three-player win requires four own pieces, not a phantom partner',()=>{
 for(let winner=0;winner<3;winner++){
  let s=createGame({rng:()=>0.456,inactiveSeats:[3],bots:[false,false,false,false]});
  for(let seat=0;seat<2;seat++)s=exchangeCard(s,seat,s.hands[seat][0].id);
  for(let piece=0;piece<4;piece++){
   const pawn=s.pieces.find(p=>p.id===winner*4+piece);
   pawn.place='goal';pawn.pos=piece;
  }
  s=exchangeCard(s,2,s.hands[2][0].id);
  assert.equal(s.phase,'finished','winning player '+winner);
  assert.equal(s.winner,winner,'winner is player seat, not team parity');
 }
});
test('three-player turn rotation skips the empty fourth color',()=>{
 let s=createGame({rng:()=>0.627,inactiveSeats:[3],bots:[false,false,false,false]});
 for(let seat=0;seat<3;seat++)s=exchangeCard(s,seat,s.hands[seat][0].id);
 assert.equal(s.current,s.starter,'the random starter must be active');
 // Arrange legal start cards for each active player. The fourth seat never acts.
 s.hands=[ [{id:501,type:'13'}],[{id:502,type:'13'}],[{id:503,type:'13'}],[] ];
 s.phase='play';s.current=0;
 for(let seat=0;seat<3;seat++){
  assert.equal(s.current,seat);
  const move=legalActions(s,seat).find(x=>x.type==='start');
  assert.ok(move,'each of the three real players can play');
  s=takeAction(s,seat,move);
 }
 assert.notEqual(s.current,3);
 assert.ok(['play','exchange'].includes(s.phase));
 if(s.phase==='exchange')assert.ok([0,1,2].includes(s.current));
});

test('three-human DOG skips every possible vacant color and preserves original pawn IDs',()=>{
 for(let vacant=0;vacant<4;vacant++){
  const s=createGame({rng:()=>0.376,inactiveSeats:[vacant],bots:[false,false,false,false]});
  const seats=[0,1,2,3].filter(i=>i!==vacant);
  assert.equal(s.mode,'solo3');
  assert.equal(s.pieces.length,12);
  assert.deepEqual(s.hands.map(h=>h.length),Array.from({length:4},(_,i)=>i===vacant?0:6));
  assert.equal(s.pieces.some(p=>p.owner===vacant),false);
  assert.deepEqual(s.pieces.filter(p=>p.owner===seats[0]).map(p=>p.id),
   Array.from({length:4},(_,i)=>seats[0]*4+i),'original board IDs must not be renumbered');
  s.phase='play';
  s.hands=Array.from({length:4},(_,seat)=>seat===vacant?[]:[{id:501+seat,type:'13'}]);
  const before=(vacant+3)%4;
  const after=(vacant+1)%4;
  s.current=before;
  const move=legalActions(s,before).find(a=>a.type==='start');
  assert.ok(move,'a real player immediately preceding the empty color has a legal move');
  const result=takeAction(s,before,move);
  assert.equal(result.current,after,'the vacant color must never receive a turn');
  assert.equal(result.players[result.current].inactive,false);
  assert.equal(result.pieces.length,12);
 }
});

test('bot can never get trapped in a playable seven cancel-and-retry loop',()=>{
 let s=createGame({bots:[true,true,true,true],rng:()=>.25});
 s.phase='play';s.current=0;
 s.hands=[[{id:991,type:'7'}],[],[],[]];
 const pawn=s.pieces.find(piece=>piece.id===0);pawn.place='track';pawn.pos=4;
 const selected=legalActions(s,0).find(a=>a.type==='seven');
 assert.ok(selected,'the seven must be playable');
 s=takeAction(s,0,selected);
 assert.equal(s.phase,'seven');
 assert.ok(legalActions(s,0).some(a=>a.type==='seven-cancel'));
 assert.ok(legalActions(s,0).some(a=>a.type==='seven-step'));
 const next=botAction(s,0);
 assert.notEqual(next?.type,'seven-cancel','AI must progress with a playable seven');
 assert.ok(['seven-step','seven-finish'].includes(next?.type));
});
