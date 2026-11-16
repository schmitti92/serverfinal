import test from 'node:test';
import assert from 'node:assert/strict';
import {DOG_LOBBY_COLORS,dogLobbySeats} from '../dog/lobby-colors.js';

test('DOG colors follow the official seat order red, blue, green, yellow',()=>{
 assert.deepEqual(DOG_LOBBY_COLORS,['red','blue','green','yellow']);
 const players=[{uid:'a',colorPref:'yellow'},{uid:'b',colorPref:'red'},{uid:'c',colorPref:'green'}];
 assert.deepEqual(dogLobbySeats(players).map(p=>p?.uid||null),['b',null,'c','a']);
});
test('DOG auto players occupy free colors without moving reserved seats',()=>{
 const players=[{uid:'a'},{uid:'b',colorPref:'blue'},{uid:'c'}];
 assert.deepEqual(dogLobbySeats(players).map(p=>p?.uid||null),['a','b','c',null]);
});
test('DOG lobby ignores invalid or duplicated reservations defensively',()=>{
 const players=[{uid:'a',colorPref:'red'},{uid:'b',colorPref:'red'},{uid:'c',colorPref:'unknown'}];
 assert.deepEqual(dogLobbySeats(players).map(p=>p?.uid||null),['a','b','c',null]);
});
test('DOG supports an entirely empty room seat plan and rejects too many humans',()=>{
 assert.deepEqual(dogLobbySeats([]),[null,null,null,null]);
 assert.throws(()=>dogLobbySeats(Array.from({length:5},(_,i)=>({uid:String(i)}))),/TOO_MANY_PLAYERS/);
});
