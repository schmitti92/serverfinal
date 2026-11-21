import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
const routeSource=(route)=>{
 const start=source.indexOf("app.post('/api/hub/rooms/:code/"+route+"'");
 assert.ok(start>=0,'route exists: '+route);
 const next=source.indexOf("app.post('",start+10);
 return source.slice(start,next<0?source.length:next);
};
function actualMutatorCallback(route){
 const section=routeSource(route);
 const startText='return {room:await mutate(code,identity,room=>{';
 const start=section.indexOf(startText),end=section.lastIndexOf('})};');
 assert.ok(start>=0&&end>start,'expected Firestore room mutator: '+route);
 const body=section.slice(start+startText.length,end);
 return new Function('room','identity','error','clock','advanceSnake',
  'advanceLavaTiles','tickLavaBots','finishLava',
  'challengeId','seq','score','survived','finished',body);
}
function context(game='snake-arena'){
 const ch={id:'c1',phase:'countdown',index:0,order:[game],startAt:0};
 const member={uid:'alice',seat:1};
 return {phase:'playing',match:{game:'partychallenge',members:[member],challenge:ch}};
}
const evaluate=(fn,room,options={})=>{
 const identity={uid:'alice'},clock=()=>10000,error=(code,message)=>new Error(message);
 const advanceSnake=options.advanceSnake||(()=>{});
 const advanceLavaTiles=options.advanceLavaTiles||(()=>{});
 const tickLavaBots=options.tickLavaBots||(()=>{});
 const finishLava=options.finishLava||(()=>{});
 const {seq=2,score=0,survived=0,finished=false}=options;
 return fn(room,identity,error,clock,advanceSnake,advanceLavaTiles,tickLavaBots,
  finishLava,'c1',seq,score,survived,finished);
};

test('Snake clock probe skips Firestore write when round remains unchanged',()=>{
 const room=context(),callback=actualMutatorCallback('challenge-snake-timeout');
 const outcome=evaluate(callback,room);
 assert.deepEqual(outcome,{unchanged:true});
 assert.equal(room.match.challenge.phase,'countdown');
 assert.match(source,/if\(result\?\.unchanged\)return \{value:expose\(room,identity\),changed:false,revision:room\.revision\}/);
 assert.match(source,/tx\.set\(ref,room\)/);
});

test('Snake clock probe does save a real finish',()=>{
 const room=context(),callback=actualMutatorCallback('challenge-snake-timeout');
 const outcome=evaluate(callback,room,{advanceSnake:ch=>{ch.phase='results'}});
 assert.equal(outcome,undefined);
 assert.equal(room.match.challenge.phase,'results');
});

test('Duplicate Snake score/survival heartbeats create no room write',()=>{
 const room=context();room.match.challenge.snake={players:{alice:{
  seat:1,alive:true,seq:1,score:0,survived:0,finished:false,updatedAt:0
 }}};
 const callback=actualMutatorCallback('challenge-snake-state');
 const outcome=evaluate(callback,room,{seq:2,score:0,survived:0,finished:false});
 assert.deepEqual(outcome,{unchanged:true});
 assert.equal(room.match.challenge.snake.players.alice.seq,1,
  'unchanged state must not rewrite the persistent sequence');
});

test('Snake score changes and final reports remain durable mutations',()=>{
 const callback=actualMutatorCallback('challenge-snake-state'),room=context();
 room.match.challenge.snake={players:{alice:{
  seat:1,alive:true,seq:1,score:0,survived:0,finished:false,updatedAt:0
 }}};
 let advanced=0;
 const outcome=evaluate(callback,room,{seq:2,score:10,survived:20,
  advanceSnake:()=>{advanced++}});
 assert.equal(outcome,undefined);
 assert.equal(advanced,1);
 assert.equal(room.match.challenge.snake.players.alice.score,10);
 const result=evaluate(callback,room,{seq:3,score:10,survived:20,finished:true});
 assert.equal(result,undefined);
 assert.equal(room.match.challenge.snake.players.alice.alive,false);
 assert.equal(room.match.challenge.snake.players.alice.finished,true);
});

test('Lava watchdog without active hazards or bots does not write anything',()=>{
 const room=context('lava-arena'),ch=room.match.challenge;
 ch.lava={index:0,lastTickAt:0,tiles:Array.from({length:100},()=>({state:0})),
  players:{alice:{x:100,y:100,alive:true,jump:0,lastAt:0}}};
 const before=structuredClone(ch);
 const callback=actualMutatorCallback('challenge-lava-tick');
 const outcome=evaluate(callback,room);
 assert.deepEqual(outcome,{unchanged:true});
 assert.deepEqual(ch,before,'idle watchdog must not mutate the room in RAM either');
});

test('Lava still persists tiles, bot state and end-of-round watchdog events',()=>{
 const room=context('lava-arena'),ch=room.match.challenge;
 ch.lava={index:0,lastTickAt:0,tiles:Array.from({length:100},()=>({state:0})),
  players:{alice:{x:100,y:100,alive:true,jump:0,lastAt:0}}};
 ch.lava.tiles[0].state=1;
 let tiles=0,bots=0;
 const callback=actualMutatorCallback('challenge-lava-tick');
 const outcome=evaluate(callback,room,{advanceLavaTiles:()=>{tiles++},
  tickLavaBots:()=>{bots++}});
 assert.equal(outcome,undefined);
 assert.equal(tiles,1);assert.equal(bots,1);
 assert.equal(ch.lava.lastTickAt,10000);
});
