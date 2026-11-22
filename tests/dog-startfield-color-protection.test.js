// DOG start-square regression: protection follows the pawn's own colour.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,legalActions,takeAction} from '../dog/engine.js';

function fixture(type,seat){
  const state=createGame({rng:()=>0.42,bots:[false,false,false,false]});
  state.phase='play';
  state.current=seat;
  state.starter=seat;
  state.hands=[[],[],[],[]];
  state.hands[seat]=[{id:999,type}];
  state.exchanges=[null,null,null,null];
  return state;
}
function place(state,seat,index,pos){
  const pawn=state.pieces[seat*4+index];
  pawn.place='track';
  pawn.pos=pos;
  return pawn;
}
function move(state,seat,predicate){
  const found=legalActions(state,seat).find(predicate);
  assert.ok(found,'Expected a legal move for colour '+seat);
  return takeAction(state,seat,found);
}

test('each colour can spawn and capture a foreign-colour pawn on its start, with both start cards',()=>{
  for(const type of ['13','1/11'])for(let seat=0;seat<4;seat++){
    const s=fixture(type,seat);
    const foreign=(seat+1)%4;
    const target=seat*16;
    place(s,foreign,0,target);
    const after=move(s,seat,a=>a.type==='start'&&a.pieceId===seat*4);
    assert.equal(after.pieces[seat*4].place,'track');
    assert.equal(after.pieces[seat*4].pos,target);
    assert.equal(after.pieces[foreign*4].place,'home');
    assert.equal(after.pieces[foreign*4].pos,-1);
  }
});

test('each colour remains protected on its OWN start and blocks another spawn',()=>{
  for(let seat=0;seat<4;seat++){
    const s=fixture('13',seat);
    place(s,seat,1,seat*16);
    assert.equal(legalActions(s,seat).some(a=>a.type==='start'),false);
  }
});

test('an ordinary move captures foreign-colour pawns on ANY coloured start field',()=>{
  for(let fieldOwner=0;fieldOwner<4;fieldOwner++){
    const mover=(fieldOwner+1)%4;
    const occupant=(fieldOwner+2)%4;
    const target=fieldOwner*16;
    const s=fixture('2',mover);
    place(s,mover,0,(target+62)%64);
    place(s,occupant,0,target);
    const after=move(s,mover,a=>a.type==='move'&&a.pieceId===mover*4&&a.to==='track:'+target);
    assert.equal(after.pieces[mover*4].pos,target);
    assert.equal(after.pieces[occupant*4].place,'home');
    assert.equal(after.pieces[occupant*4].pos,-1);
  }
});

test('an ordinary move cannot strike the matching colour on its OWN start field',()=>{
  for(let fieldOwner=0;fieldOwner<4;fieldOwner++){
    const mover=(fieldOwner+1)%4;
    const target=fieldOwner*16;
    const s=fixture('2',mover);
    place(s,mover,0,(target+62)%64);
    place(s,fieldOwner,0,target);
    assert.equal(legalActions(s,mover).some(a=>a.type==='move'&&a.pieceId===mover*4&&a.to==='track:'+target),false);
  }
});
