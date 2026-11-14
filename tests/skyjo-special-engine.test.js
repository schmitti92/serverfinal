import test from 'node:test';
import assert from 'node:assert/strict';
import {SKYJO_SPECIAL_MISSIONS,skyjoSpecialMissions,skyjoSpecialAwardRows} from '../skyjo-special-engine.js';

const MATCH='01234567-89ab-4cde-a123-456789abcdef';
const fullProgress=()=>({rows:3,columns:5,streets:4,twelveRows:1,groups:6,
 zeroSeen:1,jokerSeen:1,zerosAtOnce:3,jokersAtOnce:3,boardClear:1});
function roundGame({round=1,phase='betweenRounds',progress={0:fullProgress(),1:fullProgress(),2:fullProgress()},missionIds=null}={}){
 return {round,phase,players:[{name:'Chris'},{name:'Vanessa'},{name:'David'}],
  skyjoSpecial:{enabled:true,matchId:MATCH,round,missions:missionIds||skyjoSpecialMissions(MATCH,round).map(m=>m.id),progress},
  lastRoundSummary:{round,players:[
   {index:0,name:'Chris',round:-11},{index:1,name:'Vanessa',round:15},{index:2,name:'David',round:2}
  ]}
 };
}
test('Each special round has exactly one easy, medium and hard mission',()=>{
 assert.equal(SKYJO_SPECIAL_MISSIONS.length,22);
 for(let round=1;round<=100;round++){
  const chosen=skyjoSpecialMissions(MATCH,round);
  assert.deepEqual(chosen.map(m=>m.tier),['easy','medium','hard']);
  assert.deepEqual(skyjoSpecialMissions(MATCH,round),chosen);
 }
});
test('Server awards missions plus a two-reel round-winner bonus',()=>{
 const game=roundGame(),out=skyjoSpecialAwardRows(game,MATCH,1);
 assert.equal(out.players.length,3);
 assert.deepEqual(out.missions.map(m=>m.id),game.skyjoSpecial.missions);
 assert.equal(out.players[0].winner,true);
 assert.equal(out.players[0].slots,out.missions.reduce((n,m)=>n+m.slots,0)+2);
 assert.equal(out.players[1].slots,out.missions.filter(m=>m.field!=='score').reduce((n,m)=>n+m.slots,0));
 assert.ok(out.players[0].slots>12);
});
test('Even without mission progress, round winner receives two reels',()=>{
 const game=roundGame({progress:{}});
 const out=skyjoSpecialAwardRows(game,MATCH,1);
 assert.equal(out.players[0].slots,2);
 assert.equal(out.players[1].slots,0);
 assert.equal(out.players[2].slots,0);
});
test('Forged mission combinations and incomplete rounds cannot pay out',()=>{
 const game=roundGame({missionIds:['one-row','one-column','three-streets']});
 assert.throws(()=>skyjoSpecialAwardRows(game,MATCH,1),/SKYJO_MISSIONS_INVALID/);
 game.skyjoSpecial.missions=skyjoSpecialMissions(MATCH,1).map(m=>m.id);
 game.phase='play';
 assert.throws(()=>skyjoSpecialAwardRows(game,MATCH,1),/SKYJO_ROUND_NOT_SETTLED/);
});
test('Wrong player and impossible progress are rejected',()=>{
 const game=roundGame();
 game.skyjoSpecial.progress[0].groups=200;
 assert.throws(()=>skyjoSpecialAwardRows(game,MATCH,1),/SKYJO_PROGRESS_INVALID/);
 game.skyjoSpecial.progress[0]=fullProgress();
 game.lastRoundSummary.players[1].name='Other';
 assert.throws(()=>skyjoSpecialAwardRows(game,MATCH,1),/SKYJO_PLAYER_INVALID/);
});
