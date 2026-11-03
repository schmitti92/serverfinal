import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,dispatch,project} from './MiniGameEngine2.js';
import {createGame,chooseDoor,revealNext,publicGame,getResult} from './games/drei-schatzkammern/rules.js';
test('Engine2 supports four participants and a sealed secret door',()=>{
 let room=createRoom({roomId:'ABCDEF',hostId:'p1',botPreset:2});
 room=dispatch(room,{type:'join',actorId:'p2',commandId:'join',expectedRevision:room.revision,now:1}).state;
 room=dispatch(room,{type:'prepare',actorId:'p1',matchId:'m1',gameId:'drei-schatzkammern',commandId:'prepare',expectedRevision:room.revision,now:2}).state;
 assert.equal(room.match.roster.length,4);
 const game=createGame({players:room.match.roster,lockedDoors:[2,1,0]});
 assert.equal('lockedDoors' in publicGame(game,'p1'),false);
 assert.equal('choices' in publicGame(game,'p1'),false);
 assert.equal('lockedDoors' in project(room,'p1'),false);
});
test('server-side door resolution eliminates every visitor of the locked door',()=>{
 let g=createGame({players:['a','b','c'],lockedDoors:[1,0,2]});
 g=chooseDoor(g,'a',1);g=chooseDoor(g,'b',1);g=chooseDoor(g,'c',0);
 for(let i=0;i<3;i++)g=revealNext(g);
 assert.equal(g.finished,true);
 assert.deepEqual(getResult(g).winnerIds,['c']);
});
