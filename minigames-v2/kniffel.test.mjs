import test from 'node:test';
import assert from 'node:assert/strict';
import {MODES,createKniffel,applyKniffel,allowed,standings} from './kniffel.js';
const members=n=>Array.from({length:n},(_,i)=>({uid:'u'+i,name:'P'+i}));
test('all six modes finish with one to four players',()=>{for(const mode of Object.keys(MODES))for(let n=1;n<=4;n++){const g=createKniffel(members(n),mode);let actions=0;while(!g.finished){const uid=g.players[g.turn].uid;applyKniffel(g,uid,{type:'roll'},()=>1);const col=g.players[g.turn].sheet.findIndex((_,j)=>allowed(g,j).length);assert.ok(col>=0);applyKniffel(g,uid,{type:'score',category:allowed(g,col)[0],column:col});actions++;assert.ok(actions<=n*MODES[mode].length*13);}assert.equal(actions,n*MODES[mode].length*13);assert.equal(standings(g).length,n);}});
test('out of turn and invalid actions leave state untouched',()=>{const g=createKniffel(members(2));const before=JSON.stringify(g);assert.throws(()=>applyKniffel(g,'u1',{type:'roll'}));assert.throws(()=>applyKniffel(g,'u0',{type:'hold',index:0}));assert.throws(()=>applyKniffel(g,'u0',{type:'score',category:0}));assert.equal(JSON.stringify(g),before);});
test('hold and roll limit',()=>{const g=createKniffel(members(1));applyKniffel(g,'u0',{type:'roll'},()=>2);applyKniffel(g,'u0',{type:'hold',index:0});applyKniffel(g,'u0',{type:'roll'},()=>5);assert.equal(g.dice[0],2);assert.equal(g.dice[1],5);applyKniffel(g,'u0',{type:'roll'},()=>6);const before=JSON.stringify(g);assert.throws(()=>applyKniffel(g,'u0',{type:'roll'}));assert.equal(JSON.stringify(g),before);});
test('joker awards bonus and forces matching upper category',()=>{const g=createKniffel(members(1),'joker');applyKniffel(g,'u0',{type:'roll'},()=>6);applyKniffel(g,'u0',{type:'score',category:11});applyKniffel(g,'u0',{type:'roll'},()=>6);assert.deepEqual(allowed(g),[5]);assert.throws(()=>applyKniffel(g,'u0',{type:'score',category:8}));applyKniffel(g,'u0',{type:'score',category:5});assert.equal(g.players[0].jokerBonus,100);});

test('free-entry joker opens only empty cells after a roll and is consumed by scoring',()=>{const g=createKniffel(members(1),'top-down',true);applyKniffel(g,'u0',{type:'roll'},()=>4);applyKniffel(g,'u0',{type:'roll'},()=>4);assert.deepEqual(allowed(g),[0]);applyKniffel(g,'u0',{type:'free-entry'});assert.equal(allowed(g).length,13);applyKniffel(g,'u0',{type:'score',category:7});assert.equal(g.players[0].sheet[0][7],20);assert.equal(g.players[0].freeEntryUsed,true);assert.equal(g.freeEntryActive,false);applyKniffel(g,'u0',{type:'roll'},()=>4);assert.throws(()=>applyKniffel(g,'u0',{type:'free-entry'}));});
test('free-entry joker cannot be used before rolling or in a disabled match',()=>{const g=createKniffel(members(1),'top-down',true);assert.throws(()=>applyKniffel(g,'u0',{type:'free-entry'}));const disabled=createKniffel(members(1),'top-down',false);applyKniffel(disabled,'u0',{type:'roll'},()=>2);assert.throws(()=>applyKniffel(disabled,'u0',{type:'free-entry'}));});
test('free-entry joker does not overwrite occupied fields',()=>{const g=createKniffel(members(1),'top-down',true);applyKniffel(g,'u0',{type:'roll'},()=>2);applyKniffel(g,'u0',{type:'score',category:0});applyKniffel(g,'u0',{type:'roll'},()=>3);applyKniffel(g,'u0',{type:'roll'},()=>3);applyKniffel(g,'u0',{type:'free-entry'});assert.ok(!allowed(g).includes(0));assert.throws(()=>applyKniffel(g,'u0',{type:'score',category:0}));});

test('full restart resets six dice, extra roll, holds and three-roll allowance',()=>{const g=createKniffel(members(1),'classic',true);applyKniffel(g,'u0',{type:'extra-die'});applyKniffel(g,'u0',{type:'extra-roll'});applyKniffel(g,'u0',{type:'roll'},()=>6);applyKniffel(g,'u0',{type:'hold',index:0});applyKniffel(g,'u0',{type:'full-restart'});assert.equal(g.rolls,0);assert.equal(g.dice.length,5);assert.deepEqual(g.held,[false,false,false,false,false]);assert.equal(g.extraDieActive,false);assert.equal(g.extraRollActive,false);assert.equal(g.players[0].extraDieUsed,true);assert.equal(g.players[0].extraRollUsed,true);for(let i=0;i<3;i++)applyKniffel(g,'u0',{type:'roll'},()=>i+1);assert.throws(()=>applyKniffel(g,'u0',{type:'roll'}));assert.throws(()=>applyKniffel(g,'u0',{type:'full-restart'}));});
test('full restart cancels free entry without refunding already consumed joker',()=>{const g=createKniffel(members(1),'top-down',true);applyKniffel(g,'u0',{type:'roll'},()=>3);applyKniffel(g,'u0',{type:'free-entry'});applyKniffel(g,'u0',{type:'full-restart'});assert.equal(g.freeEntryActive,false);assert.equal(g.players[0].freeEntryUsed,false);applyKniffel(g,'u0',{type:'roll'},()=>3);applyKniffel(g,'u0',{type:'free-entry'});assert.equal(g.freeEntryActive,true);});
test('full restart cannot be used before roll, twice, disabled or by other player',()=>{const g=createKniffel(members(2),'classic',true);assert.throws(()=>applyKniffel(g,'u0',{type:'full-restart'}));applyKniffel(g,'u0',{type:'roll'},()=>2);assert.throws(()=>applyKniffel(g,'u1',{type:'full-restart'}));applyKniffel(g,'u0',{type:'full-restart'});assert.throws(()=>applyKniffel(g,'u0',{type:'full-restart'}));const h=createKniffel(members(1));applyKniffel(h,'u0',{type:'roll'},()=>2);assert.throws(()=>applyKniffel(h,'u0',{type:'full-restart'}));});

test('six identical dice score 100 Kniffel points, five identical score 50',()=>{const six=createKniffel(members(1),'classic',true);applyKniffel(six,'u0',{type:'extra-die'});applyKniffel(six,'u0',{type:'roll'},()=>6);applyKniffel(six,'u0',{type:'score',category:11});assert.equal(six.players[0].sheet[0][11],100);const five=createKniffel(members(1),'classic',true);applyKniffel(five,'u0',{type:'extra-die'});let n=0;applyKniffel(five,'u0',{type:'roll'},()=>++n===6?5:6);applyKniffel(five,'u0',{type:'score',category:11});assert.equal(five.players[0].sheet[0][11],50);});

test('three joker uses of each kind are tracked and fourth is blocked',()=>{
 const g=createKniffel(members(1),'triple-free',true,3),uid='u0',p=g.players[0];
 for(let i=0;i<3;i++){
  applyKniffel(g,uid,{type:'extra-roll'});
  applyKniffel(g,uid,{type:'extra-die'});
  applyKniffel(g,uid,{type:'roll'},()=>i+1);
  applyKniffel(g,uid,{type:'reroll'},()=>i+2);
  applyKniffel(g,uid,{type:'free-entry'});
  applyKniffel(g,uid,{type:'score',category:i,column:0});
 }
 assert.equal(p.jokerUses.extraRoll,3);
 assert.equal(p.jokerUses.extraDie,3);
 assert.equal(p.jokerUses.reroll,3);
 assert.equal(p.jokerUses.freeEntry,3);
 assert.throws(()=>applyKniffel(g,uid,{type:'extra-roll'}),/JOKER_UNAVAILABLE/);
 assert.throws(()=>applyKniffel(g,uid,{type:'extra-die'}),/JOKER_UNAVAILABLE/);
 applyKniffel(g,uid,{type:'roll'},()=>4);
 assert.throws(()=>applyKniffel(g,uid,{type:'reroll'}),/JOKER_UNAVAILABLE/);
 assert.throws(()=>applyKniffel(g,uid,{type:'free-entry'}),/JOKER_UNAVAILABLE/);
});
test('three moves and three complete restarts are possible, fourth is blocked',()=>{
 const g=createKniffel(members(1),'triple-free',true,3),uid='u0',p=g.players[0];
 applyKniffel(g,uid,{type:'roll'},()=>2);
 applyKniffel(g,uid,{type:'score',category:0,column:0});
 for(let i=0;i<3;i++){
  applyKniffel(g,uid,{type:'move-score',category:0,fromColumn:i%2,toColumn:1-i%2});
  applyKniffel(g,uid,{type:'roll'},()=>2);
  applyKniffel(g,uid,{type:'full-restart'});
 }
 assert.equal(p.jokerUses.move,3);
 assert.equal(p.jokerUses.fullRestart,3);
 assert.throws(()=>applyKniffel(g,uid,{type:'move-score',category:0,fromColumn:1,toColumn:0}),/JOKER_UNAVAILABLE/);
 applyKniffel(g,uid,{type:'roll'},()=>3);
 assert.throws(()=>applyKniffel(g,uid,{type:'full-restart'}),/JOKER_UNAVAILABLE/);
});
test('old games still default to one joker and bad counts are rejected',()=>{
 const g=createKniffel(members(1),'classic',true);
 applyKniffel(g,'u0',{type:'extra-die'});
 assert.throws(()=>applyKniffel(g,'u0',{type:'extra-die'}),/JOKER_UNAVAILABLE/);
 for(const n of [0,4,1.5,'3',null])assert.throws(()=>createKniffel(members(1),'classic',true,n),/INVALID_JOKER_COUNT/);
});

test('copy-roll captures opponent third roll, replaces next own turn and consumes one joker',()=>{
 const g=createKniffel(members(2),'classic',true,2);
 for(let i=0;i<3;i++)applyKniffel(g,'u0',{type:'roll'},()=>i+2);
 assert.deepEqual(g.dice,[4,4,4,4,4]);
 assert.throws(()=>applyKniffel(g,'u0',{type:'copy-roll'}),/JOKER_UNAVAILABLE/);
 applyKniffel(g,'u1',{type:'copy-roll'});
 assert.deepEqual(g.players[1].pendingCopy.dice,[4,4,4,4,4]);
 assert.equal(g.players[1].jokerUses.copyRoll,1);
 assert.throws(()=>applyKniffel(g,'u1',{type:'copy-roll'}),/JOKER_UNAVAILABLE/);
 applyKniffel(g,'u0',{type:'score',category:0});
 assert.equal(g.turn,1);assert.equal(g.rolls,3);assert.deepEqual(g.dice,[4,4,4,4,4]);
 for(const type of ['roll','hold','reroll','extra-die','extra-roll','full-restart','free-entry'])
  assert.throws(()=>applyKniffel(g,'u1',{type,index:0}),/COPIED_TURN_SCORE_ONLY/);
 applyKniffel(g,'u1',{type:'score',category:3});
 assert.equal(g.players[1].sheet[0][3],20);
 assert.equal(g.players[1].pendingCopy,null);
 assert.equal(g.turn,0);assert.equal(g.rolls,0);
});
test('copy-roll requires third roll, another player, enabled joker and valid remaining count',()=>{
 const g=createKniffel(members(2),'classic',true,1);
 assert.throws(()=>applyKniffel(g,'u1',{type:'copy-roll'}),/JOKER_UNAVAILABLE/);
 applyKniffel(g,'u0',{type:'roll'},()=>1);
 assert.throws(()=>applyKniffel(g,'u1',{type:'copy-roll'}),/JOKER_UNAVAILABLE/);
 applyKniffel(g,'u0',{type:'roll'},()=>2);
 applyKniffel(g,'u0',{type:'roll'},()=>3);
 applyKniffel(g,'u1',{type:'copy-roll'});
 applyKniffel(g,'u0',{type:'score',category:0});
 applyKniffel(g,'u1',{type:'score',category:2});
 for(let i=0;i<3;i++)applyKniffel(g,'u0',{type:'roll'},()=>4);
 assert.throws(()=>applyKniffel(g,'u1',{type:'copy-roll'}),/JOKER_UNAVAILABLE/);
 const disabled=createKniffel(members(2),'classic',false);
 for(let i=0;i<3;i++)applyKniffel(disabled,'u0',{type:'roll'},()=>5);
 assert.throws(()=>applyKniffel(disabled,'u1',{type:'copy-roll'}),/JOKER_UNAVAILABLE/);
});
test('copy-roll supports six dice and 100-point kniffel',()=>{
 const g=createKniffel(members(2),'classic',true,1);
 applyKniffel(g,'u0',{type:'extra-die'});
 for(let i=0;i<3;i++)applyKniffel(g,'u0',{type:'roll'},()=>6);
 applyKniffel(g,'u1',{type:'copy-roll'});
 applyKniffel(g,'u0',{type:'score',category:11});
 assert.equal(g.dice.length,6);
 applyKniffel(g,'u1',{type:'score',category:11});
 assert.equal(g.players[1].sheet[0][11],100);
});

test('copy-roll is limited to one per player even when lobby gives three jokers',()=>{
 const g=createKniffel(members(2),'classic',true,3);
 for(let i=0;i<3;i++)applyKniffel(g,'u0',{type:'roll'},()=>3);
 applyKniffel(g,'u1',{type:'copy-roll'});
 applyKniffel(g,'u0',{type:'score',category:0});
 applyKniffel(g,'u1',{type:'score',category:2});
 for(let i=0;i<3;i++)applyKniffel(g,'u0',{type:'roll'},()=>4);
 assert.throws(()=>applyKniffel(g,'u1',{type:'copy-roll'}),/JOKER_UNAVAILABLE/);
});
