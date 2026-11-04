import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,chooseDoor,revealNext,botAction,publicGame,getResult} from './rules.js';
const setup=(players=['a','b'])=>createGame({players,lockedDoors:[[2],[2],[2,3,4]]});
const resolve=s=>{while(s.phase==='revealing')s=revealNext(s);return s;};
test('three rooms have 3, 3 and 5 doors and no early victory',()=>{
 let s=setup();s=resolve(chooseDoor(chooseDoor(s,'a',0),'b',2));
 assert.equal(s.round,1);assert.deepEqual(s.alive,['a']);
 s=resolve(chooseDoor(s,'a',0));assert.equal(s.round,2);assert.equal(s.finished,false);
 assert.throws(()=>chooseDoor(s,'a',5),/INVALID_DOOR/);
 s=resolve(chooseDoor(s,'a',1));assert.equal(s.finished,true);assert.deepEqual(getResult(s).winnerIds,['a']);
});
test('three locked doors in final room eliminate every visitor together',()=>{
 let s=setup(['a','b']);s=resolve(chooseDoor(chooseDoor(s,'a',0),'b',0));
 s=resolve(chooseDoor(chooseDoor(s,'a',0),'b',0));
 s=resolve(chooseDoor(chooseDoor(s,'a',3),'b',3));
 assert.deepEqual(getResult(s).winnerIds,[]);assert.equal(s.finished,true);
});
test('two players can win together',()=>{
 let s=setup();for(const door of [0,0,1])s=resolve(chooseDoor(chooseDoor(s,'a',door),'b',door));
 assert.deepEqual(getResult(s).winnerIds,['a','b']);
});
test('hidden door choices and locked doors are not exposed',()=>{
 const s=chooseDoor(setup(),'a',1),v=publicGame(s,'b');
 assert.equal(v.myChoice,null);assert.equal(v.chosenCount,1);
 assert.equal('lockedDoors' in v,false);assert.equal('choices' in v,false);
});
test('bots use five doors in third room',()=>{
 let s=setup(['bot:x']);s=resolve(chooseDoor(s,'bot:x',0));s=resolve(chooseDoor(s,'bot:x',0));
 const seen=new Set(Array.from({length:20},(_,i)=>botAction(s,'bot:x',i).door));
 assert.deepEqual([...seen].sort(),[0,1,2,3,4]);
});
test('invalid final locked-door configurations rejected',()=>{
 assert.throws(()=>createGame({players:['a'],lockedDoors:[[1],[1],[1,1,2]]}),/INVALID_DOOR_SEQUENCE/);
 assert.throws(()=>createGame({players:['a'],lockedDoors:[[1],[1],[1,2,5]]}),/INVALID_DOOR_SEQUENCE/);
});
