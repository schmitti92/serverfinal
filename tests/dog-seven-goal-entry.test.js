// Regression: split-7 goal entry must remain possible across distinct partial
// moves, while a freshly deployed pawn on the protected start stays blocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,legalActions,takeAction,cancelSeven,publicState} from '../dog/engine.js';

function setup(seat=0){
  const s=createGame({rng:()=>0.43,bots:[false,false,false,false]});
  s.phase='play';s.current=seat;s.starter=seat;
  s.hands=[[],[],[],[]];s.hands[seat]=[{id:999,type:'7'}];
  s.exchanges=[null,null,null,null];
  const start=seat*16;
  const leading=s.pieces.find(p=>p.id===seat*4);
  const second=s.pieces.find(p=>p.id===seat*4+1);
  leading.place='track';leading.pos=(start+63)%64;
  second.place='track';second.pos=(start+8)%64;
  return s;
}
function required(s,seat,predicate){
  const found=legalActions(s,seat).find(predicate);
  assert.ok(found,'Expected legal move; got '+JSON.stringify(legalActions(s,seat).slice(0,12)));
  return found;
}
for(let seat=0;seat<4;seat++){
  test('DOG split 7 enters '+['red','blue','green','yellow'][seat]+' goal after stopping on own entry square',()=>{
    const start=seat*16,leader=seat*4,second=leader+1;
    let s=setup(seat);
    s=takeAction(s,seat,required(s,seat,m=>m.type==='seven'));
    s=takeAction(s,seat,required(s,seat,m=>
      m.type==='seven-step'&&m.pieceId===leader&&m.steps===1&&m.to==='track:'+start));
    assert.equal(s.pieces.find(p=>p.id===leader).goalReady,true);
    assert.equal(s.seven.spent,1);

    // State crosses a real online JSON serialization boundary here.
    s=JSON.parse(JSON.stringify(s));
    const published=publicState(s,seat);
    assert.equal(published.pieces.find(p=>p.id===leader).goalReady,true);
    s=takeAction(s,seat,required(s,seat,m=>
      m.type==='seven-step'&&m.pieceId===leader&&m.steps===1&&m.viaGoal&&m.to==='goal:0'));
    assert.equal(s.pieces.find(p=>p.id===leader).place,'goal');
    assert.equal(s.pieces.find(p=>p.id===leader).goalReady,undefined);
    assert.equal(s.seven.spent,2);

    s=takeAction(s,seat,required(s,seat,m=>
      m.type==='seven-step'&&m.pieceId===second&&m.steps===5&&m.to==='track:'+((start+13)%64)));
    assert.equal(s.pieces.find(p=>p.id===second).pos,(start+13)%64);
    assert.equal(s.seven,null);
    assert.notEqual(s.phase,'seven');
  });
}
test('DOG split 7: reserve pawn freshly placed on its own start cannot enter goal',()=>{
  let s=setup();
  const pawn=s.pieces.find(p=>p.id===0);
  pawn.place='track';pawn.pos=0;delete pawn.goalReady;
  s=takeAction(s,0,required(s,0,m=>m.type==='seven'));
  assert.equal(legalActions(s,0).some(m=>m.type==='seven-step'&&m.pieceId===0&&m.viaGoal),false);
});
test('DOG split 7: cancel restores the original pawn and removes entry eligibility',()=>{
  let s=setup();
  s=takeAction(s,0,required(s,0,m=>m.type==='seven'));
  s=takeAction(s,0,required(s,0,m=>
    m.type==='seven-step'&&m.pieceId===0&&m.steps===1&&m.to==='track:0'));
  assert.equal(s.pieces.find(p=>p.id===0).goalReady,true);
  s=cancelSeven(s,0);
  assert.equal(s.phase,'play');
  assert.equal(s.pieces.find(p=>p.id===0).pos,63);
  assert.equal(s.pieces.find(p=>p.id===0).goalReady,undefined);
});
