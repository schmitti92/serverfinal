import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,legalActions,takeAction} from '../dog/engine.js';

function setup({solo3=false}={}){
 const s=createGame({rng:()=>0.42,bots:[false,false,false,false],
   inactiveSeats:solo3?[3]:[]});
 s.phase='play';s.current=0;s.starter=0;
 s.hands=[[{id:999,type:'7'}],[],[],[]];
 s.exchanges=[null,null,null,null];
 return s;
}
function pawn(s,id,place,pos){
 const p=s.pieces.find(x=>x.id===id);
 assert.ok(p,'missing test pawn '+id);
 p.place=place;p.pos=pos;delete p.goalReady;
}
function needed(s,filter){
 const move=legalActions(s,0).find(filter);
 assert.ok(move,'expected move. Legal: '+JSON.stringify(legalActions(s,0).slice(0,30)));
 return move;
}
function startSeven(s){
 return takeAction(s,0,needed(s,m=>m.type==='seven'));
}
function lastRedPawn(s){
 pawn(s,0,'track',63);
 pawn(s,1,'goal',1);pawn(s,2,'goal',2);pawn(s,3,'goal',3);
 return s;
}
test('DOG 7 cannot burn 5 remaining steps midgame when a goal pawn may move only 2',()=>{
 let s=setup();
 pawn(s,0,'goal',1); // two steps to last goal square
 assert.equal(legalActions(s,0).some(m=>m.type==='seven'),false);
 assert.equal(legalActions(s,0).some(m=>m.type==='seven-finish'),false);
 assert.throws(()=>takeAction(s,0,{type:'seven',cardId:999,as:'7'}),/ILLEGAL_ACTION/);
 // Even a forged mid-seven state never offers partial waste.
 s.phase='seven';s.seven={cardId:999,spent:0,canForfeit:false,snapshot:structuredClone(s.pieces)};
 assert.equal(legalActions(s,0).some(m=>m.type==='seven-step'),false);
 assert.equal(legalActions(s,0).some(m=>m.type==='seven-finish'),false);
 assert.throws(()=>takeAction(s,0,{type:'seven-finish',remaining:5}),/ILLEGAL_ACTION/);
});
test('DOG 7 last red pawn entering goal may use only 2 steps and forfeit 5',()=>{
 let s=startSeven(lastRedPawn(setup()));
 assert.equal(s.phase,'seven');
 s=takeAction(s,0,needed(s,m=>m.type==='seven-step'&&m.pieceId===0&&
   m.steps===2&&m.viaGoal&&m.to==='goal:0'));
 assert.equal(s.pieces[0].place,'goal');
 assert.equal(s.seven.spent,2);
 assert.equal(s.seven.canForfeit,true);
 assert.ok(legalActions(s,0).some(m=>m.type==='seven-finish'&&m.remaining===5));
 s=JSON.parse(JSON.stringify(s)); // online serialization round-trip
 s=takeAction(s,0,needed(s,m=>m.type==='seven-finish'&&m.remaining===5));
 assert.equal(s.seven,null);
 assert.notEqual(s.phase,'seven');
 assert.equal(s.hands[0].length,0);
 assert.equal(s.discard.at(-1).id,999);
 assert.ok(s.history.some(t=>t.includes('5 Schritte')));
});
test('DOG 7 offers partner moves instead of forcing forfeit when own last pawn finishes',()=>{
 let before=lastRedPawn(setup());
 pawn(before,8,'track',34); // green teammate
 let s=startSeven(before);
 s=takeAction(s,0,needed(s,m=>m.type==='seven-step'&&m.pieceId===0&&m.steps===2&&m.viaGoal));
 assert.ok(legalActions(s,0).some(m=>m.type==='seven-finish'&&m.remaining===5));
 assert.ok(legalActions(s,0).some(m=>m.type==='seven-step'&&m.pieceId===8&&m.steps===5));
 s=takeAction(s,0,needed(s,m=>m.type==='seven-step'&&m.pieceId===8&&m.steps===5));
 assert.equal(s.pieces.find(p=>p.id===8).pos,39);
 assert.equal(s.seven,null);
 assert.equal(s.discard.at(-1).id,999);
});
test('DOG 7 may forfeit after split 1 step onto entry then 1 step into goal on last pawn',()=>{
 let s=startSeven(lastRedPawn(setup()));
 s=takeAction(s,0,needed(s,m=>m.type==='seven-step'&&m.pieceId===0&&
  m.steps===1&&m.to==='track:0'));
 assert.equal(s.seven.canForfeit,false);
 assert.equal(legalActions(s,0).some(m=>m.type==='seven-finish'),false);
 s=takeAction(s,0,needed(s,m=>m.type==='seven-step'&&m.pieceId===0&&
  m.steps===1&&m.viaGoal&&m.to==='goal:0'));
 assert.equal(s.seven.spent,2);
 assert.ok(legalActions(s,0).some(m=>m.type==='seven-finish'&&m.remaining===5));
});
test('DOG 7 goal pawn midgame 1 + other pawn 6 still spends all 7',()=>{
 let s=setup();
 pawn(s,0,'goal',0);
 pawn(s,1,'track',8);
 s=startSeven(s);
 s=takeAction(s,0,needed(s,m=>m.type==='seven-step'&&m.pieceId===0&&m.steps===1&&m.to==='goal:1'));
 assert.equal(s.seven.canForfeit,false);
 assert.equal(legalActions(s,0).some(m=>m.type==='seven-finish'),false);
 s=takeAction(s,0,needed(s,m=>m.type==='seven-step'&&m.pieceId===1&&m.steps===6));
 assert.equal(s.seven,null);
 assert.equal(s.pieces[1].pos,14);
});
test('DOG solo3 automatically discards last 7 card when final pawn reaches goal with unused steps',()=>{
 let s=startSeven(lastRedPawn(setup({solo3:true})));
 s=takeAction(s,0,needed(s,m=>m.type==='seven-step'&&m.pieceId===0&&m.steps===2&&m.viaGoal));
 assert.equal(s.phase,'finished');
 assert.equal(s.winner,0);
 assert.equal(s.seven,null);
 assert.equal(s.hands[0].length,0);
 assert.equal(s.discard.at(-1).id,999);
});
test('DOG last team pawn finishing the whole match also disposes of unused 7 steps',()=>{
 let s=lastRedPawn(setup());
 for(let i=8;i<12;i++)pawn(s,i,'goal',i-8);
 s=startSeven(s);
 s=takeAction(s,0,needed(s,m=>m.type==='seven-step'&&m.pieceId===0&&m.steps===2&&m.viaGoal));
 assert.equal(s.phase,'finished');
 assert.equal(s.winner,0);
 assert.equal(s.seven,null);
 assert.equal(s.hands[0].length,0);
 assert.equal(s.discard.at(-1).id,999);
});
