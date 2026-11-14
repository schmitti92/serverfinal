import test from 'node:test';
import assert from 'node:assert/strict';
import {SKYJO_SPECIAL_MISSIONS,skyjoSpecialMissions,skyjoSpecialBonusIndex,skyjoSpecialAwardRows} from '../skyjo-special-engine.js';

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
test('Without board missions, the winner receives two reels plus any score-based mission',()=>{
 const game=roundGame({progress:{}});
 const out=skyjoSpecialAwardRows(game,MATCH,1);
 for(let i=0;i<3;i++){
  const score=game.lastRoundSummary.players[i].round;
  const scoreSlots=out.missions.filter(m=>m.less&&score<=m.at).reduce((n,m)=>n+m.slots,0);
  assert.equal(out.players[i].slots,scoreSlots+(i===0?2:0));
 }
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


function bonusRoundGame(){
 const game=roundGame();
 game.players.forEach((p,i)=>{p.grid=Array.from({length:12},()=>({type:'number',value:7,faceUp:true}));});
 game.lastRoundSummary.players.forEach((p,i)=>{p.gridSnapshot=structuredClone(game.players[i].grid);});
 game.skyjoSpecial.bonusCells=Object.fromEntries(game.players.map((_,i)=>[i,skyjoSpecialBonusIndex(MATCH,1,i,12)]));
 return game;
}
test('Marked Joker bonus cells are deterministic, vary by round and stay within classic/XL bounds',()=>{
 let changed=0;
 for(let round=1;round<=100;round++){
  for(let player=0;player<5;player++){
   for(const size of [12,15]){
    const idx=skyjoSpecialBonusIndex(MATCH,round,player,size);
    assert.ok(idx>=0&&idx<size);
    assert.equal(idx,skyjoSpecialBonusIndex(MATCH,round,player,size));
    if(round>1&&idx!==skyjoSpecialBonusIndex(MATCH,round-1,player,size))changed++;
   }
  }
 }
 assert.ok(changed>500);
 assert.equal(skyjoSpecialBonusIndex('abcdef12-3456-4abc-bcde-123456789abc',1,0,12),5);
 assert.equal(skyjoSpecialBonusIndex('abcdef12-3456-4abc-bcde-123456789abc',1,1,12),11);
 assert.equal(skyjoSpecialBonusIndex('abcdef12-3456-4abc-bcde-123456789abc',1,2,12),2);
});
test('All missions, winner and final-scoring Joker bonus are added exactly once',()=>{
 const game=bonusRoundGame();
 const idx=game.skyjoSpecial.bonusCells[0];
 game.lastRoundSummary.players[0].gridSnapshot[idx]={type:'star',faceUp:true};
 const result=skyjoSpecialAwardRows(game,MATCH,1);
 assert.equal(result.players[0].bonusAchieved,true);
 assert.equal(result.players[0].bonusIndex,idx);
 assert.equal(result.players[0].bonusSlots,2);
 assert.equal(result.players[0].winnerSlots,2);
 assert.equal(result.players[0].slots,result.players[0].missionSlots+4);
 assert.equal(result.players[1].bonusSlots,0);
 assert.equal(result.players[2].bonusSlots,0);
 for(const row of result.players)assert.equal(row.slots,row.missionSlots+row.winnerSlots+row.bonusSlots);
 assert.deepEqual(skyjoSpecialAwardRows(game,MATCH,1),result);
});
test('Joker removed before final scoring or left face down does not win bonus',()=>{
 const game=bonusRoundGame(),idx=game.skyjoSpecial.bonusCells[1];
 game.lastRoundSummary.players[1].gridSnapshot[idx]=null;
 assert.equal(skyjoSpecialAwardRows(game,MATCH,1).players[1].bonusSlots,0);
 game.lastRoundSummary.players[1].gridSnapshot[idx]={type:'star',faceUp:false};
 assert.equal(skyjoSpecialAwardRows(game,MATCH,1).players[1].bonusSlots,0);
 game.lastRoundSummary.players[1].gridSnapshot[idx]={type:'star',faceUp:true};
 assert.equal(skyjoSpecialAwardRows(game,MATCH,1).players[1].bonusSlots,2);
});
test('Bonus fields cannot be relocated and final scoring snapshots are required',()=>{
 const game=bonusRoundGame(),idx=game.skyjoSpecial.bonusCells[0];
 game.skyjoSpecial.bonusCells[0]=(idx+1)%12;
 assert.throws(()=>skyjoSpecialAwardRows(game,MATCH,1),/SKYJO_BONUS_FIELDS_INVALID/);
 game.skyjoSpecial.bonusCells[0]=idx;
 delete game.lastRoundSummary.players[0].gridSnapshot;
 assert.throws(()=>skyjoSpecialAwardRows(game,MATCH,1),/SKYJO_BONUS_SCORE_INVALID/);
});
test('Existing started special rounds without bonus fields still pay original mission/winner slots',()=>{
 const legacy=roundGame(),result=skyjoSpecialAwardRows(legacy,MATCH,1);
 assert.equal(result.players[0].bonusSlots,0);
 assert.equal(result.players[0].bonusIndex,null);
 assert.equal(result.players[0].slots,result.players[0].missionSlots+result.players[0].winnerSlots);
});
test('XL board can award a Joker bonus only on its own marked 15-card position',()=>{
 const game=bonusRoundGame();
 game.players.forEach((p,i)=>{p.grid=Array.from({length:15},()=>({type:'number',value:7,faceUp:true}));});
 game.lastRoundSummary.players.forEach((p,i)=>{p.gridSnapshot=structuredClone(game.players[i].grid);});
 game.skyjoSpecial.bonusCells=Object.fromEntries(game.players.map((_,i)=>[i,skyjoSpecialBonusIndex(MATCH,1,i,15)]));
 const idx=game.skyjoSpecial.bonusCells[2];
 game.lastRoundSummary.players[2].gridSnapshot[idx]={type:'star',faceUp:true};
 const rows=skyjoSpecialAwardRows(game,MATCH,1).players;
 assert.equal(rows[2].bonusSlots,2);
 assert.equal(rows[2].bonusIndex,idx);
 assert.equal(rows[0].bonusSlots,0);
});
