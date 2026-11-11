// Regression tests derived from the official Schmidt DOG (49201) instructions.
// Classic four-seat TEAM DOG; the manufacturer's separate 2/3/5-player
// variants are not enabled here (missing human seats are filled by bots).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RULESET,makeDeck,createGame,exchangeCard,legalActions,takeAction,publicState,botAction
} from '../dog/engine.js';

function position(s,id,place,pos=-1){
  const p=s.pieces[id];p.place=place;p.pos=pos;return p;
}
function fixture(type,seat=0){
 const s=createGame({rng:()=>0.42,bots:[false,false,false,false]});
 s.phase='play';s.current=seat;s.starter=seat;
 s.hands=[[],[],[],[]];s.hands[seat]=[{id:999,type}];
 s.exchanges=[null,null,null,null];
 return s;
}
function action(s,match,seat=s.current){
 const result=legalActions(s,seat).find(match);
 assert.ok(result,'Expected an official DOG move, found '+JSON.stringify(legalActions(s,seat).slice(0,16)));
 return result;
}

test('DOG official: 110 cards, exact 6 joker and 13 other eight-card types',()=>{
 const deck=makeDeck();assert.equal(deck.length,110);
 const frequency=new Map();
 for(const card of deck)frequency.set(card.type,(frequency.get(card.type)||0)+1);
 assert.equal(frequency.get('joker'),6);
 assert.equal(frequency.size,14);
 for(const [type,n] of frequency)if(type!=='joker')assert.equal(n,8);
});

test('DOG official: partner exchange stays sealed until everybody has given a card',()=>{
 let s=createGame({rng:()=>0.21,bots:[false,false,false,false]});
 const outgoing=s.hands[0][0].id;
 s=exchangeCard(s,0,outgoing);
 assert.equal(s.phase,'exchange');
 assert.equal(s.exchanges[0].id,outgoing);
 const other=publicState(s,2);
 assert.equal(other.exchanges[0],true);
 assert.equal('deck' in other,false);
 assert.ok(Array.isArray(other.hands[2]));
 for(const p of [0,1,3])assert.deepEqual(Object.keys(other.hands[p]),['count']);
 assert.equal(other.hands[2].some(c=>c.id===outgoing),false);
 for(const seat of [1,2,3])s=exchangeCard(s,seat,s.hands[seat][0].id);
 assert.equal(s.phase,'play');
 assert.equal(s.hands[2].some(c=>c.id===outgoing),true);
});

test('DOG official: foreign unprotected figure on my start square gets captured when I enter',()=>{
 const s=fixture('13',0);
 position(s,4,'track',0); // blue pawn on the red starting square: not protected
 const m=action(s,a=>a.type==='start'&&a.pieceId===0);
 const next=takeAction(s,0,m);
 assert.equal(next.pieces[0].place,'track');
 assert.equal(next.pieces[0].pos,0);
 assert.equal(next.pieces[4].place,'home');
 assert.equal(next.pieces[4].pos,-1);
});

test('DOG official: any OWN pawn on its coloured starting square is protected and blocks entering',()=>{
 const s=fixture('1/11',0);
 position(s,1,'track',0);
 assert.equal(legalActions(s,0).some(a=>a.type==='start'),false);
});

test('DOG official: protected figures cannot be passed or struck, even from another colour',()=>{
 const s=fixture('3',0);
 position(s,0,'track',15);
 position(s,4,'track',16); // blue figure on its own protected start
 assert.equal(legalActions(s,0).some(a=>a.type==='move'&&a.pieceId===0),false);
});

test('DOG official: ordinary movement jumps a pawn on an intermediate square',()=>{
 const s=fixture('3',0);
 position(s,0,'track',2);
 position(s,1,'track',4);
 const next=takeAction(s,0,action(s,a=>a.type==='move'&&a.pieceId===0));
 assert.equal(next.pieces[0].pos,5);
 assert.equal(next.pieces[1].pos,4);
});

test('DOG official: ordinary landing must also capture own colour',()=>{
 const s=fixture('3',0);
 position(s,0,'track',2);
 position(s,1,'track',5);
 const next=takeAction(s,0,action(s,a=>a.type==='move'&&a.pieceId===0));
 assert.equal(next.pieces[0].pos,5);
 assert.equal(next.pieces[1].place,'home');
});

test('DOG official: 4 is the ONLY backwards card; backwards cannot enter the goal',()=>{
 const s=fixture('4',0);
 position(s,0,'track',0);
 const m=action(s,a=>a.type==='move'&&a.steps===-4);
 assert.equal(takeAction(s,0,m).pieces[0].pos,60);
 const backwards=fixture('3',0);
 position(backwards,0,'track',0);
 assert.equal(legalActions(backwards,0).some(a=>a.steps<0),false);
 const goal=fixture('4',0);
 position(goal,0,'goal',1);
 assert.equal(legalActions(goal,0).some(a=>a.steps<0),false);
});

test('DOG official: entering goal MUST pass across own start field, never from it',()=>{
 const before=fixture('2',0);
 position(before,0,'track',63);
 const intoGoal=action(before,a=>a.type==='move'&&a.pieceId===0&&a.viaGoal&&a.to==='goal:0');
 const after=takeAction(before,0,intoGoal);
 assert.equal(after.pieces[0].place,'goal');assert.equal(after.pieces[0].pos,0);
 const onStart=fixture('1/11',0);
 position(onStart,0,'track',0);
 assert.equal(legalActions(onStart,0).some(a=>a.viaGoal),false);
 const beforeBlue=fixture('2',1);
 position(beforeBlue,4,'track',15);
 assert.ok(legalActions(beforeBlue,1).some(a=>a.viaGoal&&a.to==='goal:0'));
});

test('DOG official: goal occupants block movement and cannot be jumped or struck',()=>{
 const s=fixture('3',0);
 position(s,0,'goal',0);
 position(s,1,'goal',2);
 assert.equal(legalActions(s,0).some(a=>a.type==='move'&&a.pieceId===0),false);
 const other=fixture('2',0);
 position(other,0,'track',63);
 position(other,1,'goal',0);
 assert.equal(legalActions(other,0).some(a=>a.viaGoal&&a.pieceId===0),false);
});

test('DOG official: moving card values are mandatory; unused points cannot simply be discarded',()=>{
 const s=fixture('13',0);
 position(s,0,'goal',3);
 const moves=legalActions(s,0);
 assert.ok(moves.some(a=>a.type==='start'));
 assert.equal(moves.some(a=>a.type==='move'&&a.pieceId===0),false);
 const f=fixture('7',0);
 position(f,0,'goal',3);
 assert.equal(legalActions(f,0).some(a=>a.type==='seven'),false);
});

test('DOG official: 7 burns ALL jumped figures including teammates',()=>{
 let s=fixture('7',0);
 position(s,0,'track',2);
 position(s,1,'track',20);
 position(s,4,'track',4);
 position(s,8,'track',6);
 s=takeAction(s,0,action(s,a=>a.type==='seven'));
 const first=action(s,a=>a.type==='seven-step'&&a.pieceId===0&&a.steps===5);
 s=takeAction(s,0,first);
 assert.equal(s.pieces[4].place,'home');
 assert.equal(s.pieces[8].place,'home');
 assert.equal(s.seven.spent,5);
 s=takeAction(s,0,action(s,a=>a.type==='seven-step'&&a.steps===2));
 assert.notEqual(s.phase,'seven');
});

test('DOG official: a split 7 may use remaining points for partner once own last pawn reaches goal',()=>{
 let s=fixture('7',0);
 position(s,0,'track',63); // 63 -> 0 -> red goal0
 for(let j=1;j<4;j++)position(s,j,'goal',j);
 position(s,8,'track',34);
 s=takeAction(s,0,action(s,a=>a.type==='seven'));
 s=takeAction(s,0,action(s,a=>a.type==='seven-step'&&a.pieceId===0&&a.steps===2&&a.viaGoal));
 assert.equal(s.pieces[0].place,'goal');
 assert.ok(legalActions(s,0).some(a=>a.pieceId===8&&a.steps===5));
 s=takeAction(s,0,action(s,a=>a.pieceId===8&&a.steps===5));
 assert.notEqual(s.phase,'seven');
 assert.equal(s.pieces[8].pos,39);
});

test('DOG official: protected and goal figures must never be swap candidates',()=>{
 const s=fixture('swap',0);
 position(s,0,'track',10);
 position(s,4,'track',16); // protected blue
 position(s,8,'goal',0);   // green partner already safe
 assert.equal(legalActions(s,0).some(a=>a.type==='swap'),false);
 assert.equal(legalActions(s,0).some(a=>a.type==='emptySwap'),true);
 position(s,4,'track',21);
 assert.ok(legalActions(s,0).some(a=>a.type==='swap'&&a.targetId===4));
});

test('DOG official: a joker can become start, backward 4, or split 7',()=>{
 const s=fixture('joker',0);
 const start=legalActions(s,0).filter(a=>a.type==='start');
 assert.ok(start.some(a=>a.as==='13'));
 assert.ok(start.some(a=>a.as==='1/11'));
 position(s,0,'track',3);
 const moves=legalActions(s,0);
 assert.ok(moves.some(a=>a.as==='4'&&a.steps===-4));
 assert.ok(moves.some(a=>a.as==='7'&&a.type==='seven'));
});

test('DOG official: teammate may use my finished pieces only after all own pieces are home',()=>{
 const s=fixture('2',0);
 position(s,8,'track',34);
 assert.equal(legalActions(s,0).some(a=>a.pieceId===8),false);
 for(let i=0;i<4;i++)position(s,i,'goal',i);
 assert.equal(legalActions(s,0).some(a=>a.pieceId===8),true);
});

test('DOG official: winning requires all EIGHT pieces of the team in the finish',()=>{
 const s=fixture('2',0);
 position(s,0,'track',63);
 for(let j=1;j<4;j++)position(s,j,'goal',j);
 for(let j=8;j<12;j++)position(s,j,'goal',j-8);
 const m=action(s,a=>a.type==='move'&&a.pieceId===0&&a.viaGoal);
 const next=takeAction(s,0,m);
 assert.equal(next.phase,'finished');
 assert.equal(next.winner,0);
});

test('DOG official: forged move with wrong distance or wrong card identity is denied',()=>{
 const s=fixture('5',0);
 position(s,0,'track',3);
 const m=action(s,a=>a.type==='move');
 assert.throws(()=>takeAction(s,0,{...m,steps:6}),/ILLEGAL_ACTION/);
 assert.throws(()=>takeAction(s,0,{...m,cardId:123456}),/ILLEGAL_ACTION/);
 assert.equal(s.pieces[0].pos,3);
});
