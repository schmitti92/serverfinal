import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 createGame,legalActions,takeAction,completedDogSeat,finalizeCompletedDogGame
} from '../dog/engine.js';

function setup(seat=0,{solo3=false}={}){
 const state=createGame({rng:()=>0.37,bots:[false,false,false,false],inactiveSeats:solo3?[3]:[]});
 state.phase='play';state.current=seat;state.starter=seat;
 state.hands=[[],[],[],[]];
 state.hands[seat]=[{id:999,type:'1/11'}];
 for(let i=0;i<4;i++){
  const pawn=state.pieces.find(p=>p.id===seat*4+i);
  if(i===0){pawn.place='track';pawn.pos=seat*16;pawn.goalReady=true;}
  else {pawn.place='goal';pawn.pos=i;}
 }
 return state;
}
test('first 4/4 wins immediately from an actual validated move, without teammates completing',()=>{
 for(const seat of [0,1,2,3]){
  const state=setup(seat);
  const move=legalActions(state,seat).find(m=>
   m.type==='move'&&m.pieceId===seat*4&&m.steps===1&&m.viaGoal&&m.to==='goal:0');
  assert.ok(move,'legal goal entry for seat '+seat);
  const result=takeAction(state,seat,move);
  assert.equal(result.phase,'finished');
  assert.equal(result.winnerSeat,seat);
  assert.equal(result.winner,seat%2);
  assert.equal(result.current,(seat+1)%4,'winning move is final, no new playable turn');
  assert.equal(result.pieces.filter(p=>p.owner===seat&&p.place==='goal').length,4);
  assert.equal(result.pieces.filter(p=>p.owner===(seat+2)%4&&p.place==='goal').length,0);
  assert.deepEqual(legalActions(result,seat),[]);
  assert.deepEqual(legalActions(result,(seat+1)%4),[]);
  assert.throws(()=>takeAction(result,seat,move),/GAME_ALREADY_FINISHED/);
 }
});
test('legacy 4/4 room auto-finish is immutable and idempotent',()=>{
 const stuck=setup(0);
 stuck.pieces[0].place='goal';stuck.pieces[0].pos=0;
 stuck.players[0].name='Chris';
 const original=structuredClone(stuck);
 assert.equal(completedDogSeat(stuck),0);
 const restored=finalizeCompletedDogGame(stuck);
 assert.equal(restored.phase,'finished');
 assert.equal(restored.winner,0);
 assert.equal(restored.winnerSeat,0);
 assert.equal(restored.revision,stuck.revision+1);
 assert.equal(restored.history[0].includes('Chris'),true);
 assert.deepEqual(stuck,original,'original Firestore state is never mutated');
 assert.equal(finalizeCompletedDogGame(restored),null,'no duplicate finish');
 assert.deepEqual(legalActions(stuck,0),[],'old stuck snapshot may not act again');
});
test('only 3/4 must never prematurely win; solo3 keeps individual winner',()=>{
 const state=setup(1);
 assert.equal(completedDogSeat(state),null);
 assert.equal(finalizeCompletedDogGame(state),null);
 const solo=setup(2,{solo3:true});
 const move=legalActions(solo,2).find(m=>m.type==='move'&&m.viaGoal&&m.to==='goal:0');
 const finished=takeAction(solo,2,move);
 assert.equal(finished.phase,'finished');
 assert.equal(finished.winnerSeat,2);
 assert.equal(finished.winner,2);
});
test('the old 4/4 recovery is scoped to DOG classic, not Grinch modules',()=>{
 const lobby=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
 assert.match(lobby,/match\?\.game!=='dog'/);
 assert.match(lobby,/const legacyCompleted=match\.dog\.phase!=='finished'&&completedDogSeat/);
 assert.match(lobby,/if\(legacyCompleted\)\{\s*match\.dog=finalizeCompletedDogGame/);
 assert.match(lobby,/if\(match\.dog\.phase==='finished'&&!match\.dogCounters\?\.recorded\)/);
});
