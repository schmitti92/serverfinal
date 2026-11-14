// Shared authoritative scoring rules for the optional SKYJO Action 100-Tore Special.
// The client displays progress; the server recomputes awards from the saved round.
export const SKYJO_SPECIAL_MISSIONS=Object.freeze([
 {id:'one-row',name:'Räume eine Reihe ab',slots:2,tier:'easy',field:'rows',at:1},
 {id:'one-column',name:'Räume eine Spalte ab',slots:2,tier:'easy',field:'columns',at:1},
 {id:'open-zero',name:'Lege eine offene Null auf dein Feld',slots:2,tier:'easy',field:'zeroSeen',at:1},
 {id:'open-joker',name:'Platziere einen offenen Joker',slots:2,tier:'easy',field:'jokerSeen',at:1},
 {id:'two-groups',name:'Räume zwei Kombinationen ab',slots:2,tier:'easy',field:'groups',at:2},
 {id:'two-zero',name:'Habe zwei offene Nullen gleichzeitig',slots:2,tier:'easy',field:'zerosAtOnce',at:2},
 {id:'low-five',name:'Beende die Runde mit höchstens 5 Punkten',slots:2,tier:'easy',field:'score',at:5,less:true},
 {id:'one-street',name:'Räume eine Straße ab',slots:4,tier:'medium',field:'streets',at:1},
 {id:'two-rows',name:'Räume zwei Reihen ab',slots:4,tier:'medium',field:'rows',at:2},
 {id:'two-columns',name:'Räume zwei Spalten ab',slots:4,tier:'medium',field:'columns',at:2},
 {id:'twelve-row',name:'Räume eine reine 12er-Reihe ab',slots:6,tier:'medium',field:'twelveRows',at:1},
 {id:'two-streets',name:'Räume zwei Straßen ab',slots:6,tier:'medium',field:'streets',at:2},
 {id:'below-zero',name:'Beende die Runde mit 0 oder weniger Punkten',slots:4,tier:'medium',field:'score',at:0,less:true},
 {id:'two-jokers',name:'Habe zwei offene Joker gleichzeitig',slots:4,tier:'medium',field:'jokersAtOnce',at:2},
 {id:'three-groups',name:'Räume drei Kombinationen ab',slots:4,tier:'medium',field:'groups',at:3},
 {id:'three-rows',name:'Räume drei Reihen ab',slots:6,tier:'hard',field:'rows',at:3},
 {id:'three-streets',name:'Räume drei Straßen ab',slots:10,tier:'hard',field:'streets',at:3},
 {id:'four-groups',name:'Räume vier Kombinationen ab',slots:8,tier:'hard',field:'groups',at:4},
 {id:'five-groups',name:'Räume fünf Kombinationen ab',slots:10,tier:'hard',field:'groups',at:5},
 {id:'clear-board',name:'Räume dein ganzes Spielfeld ab',slots:10,tier:'hard',field:'boardClear',at:1},
 {id:'four-columns',name:'Räume vier Spalten ab',slots:10,tier:'hard',field:'columns',at:4},
 {id:'below-minus-ten',name:'Beende die Runde mit −10 oder weniger Punkten',slots:6,tier:'hard',field:'score',at:-10,less:true}
]);
const allowedFields=['rows','columns','streets','twelveRows','groups','zeroSeen','jokerSeen','zerosAtOnce','jokersAtOnce','boardClear'];
export function skyjoSpecialSeed(matchId,round){
 let n=2166136261>>>0;
 for(const ch of String(matchId)+'|'+String(round)){n=Math.imul(n^ch.charCodeAt(0),16777619)>>>0;}
 return n;
}
export function skyjoSpecialMissions(matchId,round){
 let n=skyjoSpecialSeed(matchId,round);
 return ['easy','medium','hard'].map(tier=>{
  const pool=SKYJO_SPECIAL_MISSIONS.filter(m=>m.tier===tier);
  n=(Math.imul(n,1664525)+1013904223)>>>0;
  return pool[n%pool.length];
 });
}
// Stable pseudo-random bonus field per player and round. It is derived from
// the match identifier, so each device and the server use the same index.
export function skyjoSpecialBonusIndex(matchId,round,playerIndex,cardCount=12){
 if(!Number.isSafeInteger(playerIndex)||playerIndex<0||playerIndex>9||
   !Number.isSafeInteger(cardCount)||![12,15].includes(cardCount))
  throw Error('SKYJO_BONUS_FIELD_INVALID');
 let n=(skyjoSpecialSeed(matchId,round)^Math.imul(playerIndex+1,0x9e3779b9))>>>0;
 n^=n>>>16;n=Math.imul(n,0x7feb352d)>>>0;
 n^=n>>>15;n=Math.imul(n,0x846ca68b)>>>0;
 n^=n>>>16;
 return (n>>>0)%cardCount;
}
export function skyjoSpecialAwardRows(game,matchId,round){
 const special=game?.skyjoSpecial;
 if(!special?.enabled||special.matchId!==matchId||special.round!==round||game.round!==round)throw Error('SKYJO_SPECIAL_ROUND_MISMATCH');
 if(!['betweenRounds','gameOver'].includes(game.phase)||!game.lastRoundSummary||game.lastRoundSummary.round!==round)throw Error('SKYJO_ROUND_NOT_SETTLED');
 const expected=skyjoSpecialMissions(matchId,round);
 if(JSON.stringify(special.missions)!==JSON.stringify(expected.map(m=>m.id)))throw Error('SKYJO_MISSIONS_INVALID');
 const summary=game.lastRoundSummary;
 if(!Array.isArray(summary.players)||summary.players.length!==game.players?.length||!summary.players.length)throw Error('SKYJO_SCORE_INVALID');
 const min=Math.min(...summary.players.map(p=>Number(p.round)));
 if(!Number.isFinite(min)||summary.players.some(p=>!Number.isFinite(Number(p.round))))throw Error('SKYJO_SCORE_INVALID');
 const hasBonusFields=special.bonusCells!=null;
 if(hasBonusFields&&(!special.bonusCells||typeof special.bonusCells!=='object'||
   Array.isArray(special.bonusCells)))throw Error('SKYJO_BONUS_FIELDS_INVALID');
 const results=summary.players.map((p,index)=>{
  if(p.index!==index||!game.players[index]||p.name!==game.players[index].name)throw Error('SKYJO_PLAYER_INVALID');
  const raw=special.progress?.[index]||{};
  const metrics={score:Number(p.round)};
  for(const field of allowedFields){
   const value=Number(raw[field]||0);
   if(!Number.isSafeInteger(value)||value<0||value>100)throw Error('SKYJO_PROGRESS_INVALID');
   metrics[field]=value;
  }
  const won=expected.filter(m=>m.less?metrics.score<=m.at:metrics[m.field]>=m.at);
  const winner=Number(p.round)===min;
  const missionSlots=won.reduce((total,m)=>total+m.slots,0);
  const winnerSlots=winner?2:0;
  let bonusIndex=null,bonusAchieved=false;
  if(hasBonusFields){
   const board=p.gridSnapshot;
   if(!Array.isArray(board)||![12,15].includes(board.length)||
      !Array.isArray(game.players[index].grid)||game.players[index].grid.length!==board.length)
    throw Error('SKYJO_BONUS_SCORE_INVALID');
   const expectedIndex=skyjoSpecialBonusIndex(matchId,round,index,board.length);
   if(!Object.hasOwn(special.bonusCells,index)||
      !Number.isSafeInteger(special.bonusCells[index])||
      special.bonusCells[index]!==expectedIndex)
    throw Error('SKYJO_BONUS_FIELDS_INVALID');
   bonusIndex=expectedIndex;
   // gridSnapshot is captured at the actual final score, AFTER optional and
   // automatic row removals. A removed Joker becomes null and is not eligible.
   const card=board[bonusIndex];
   bonusAchieved=!!card&&card.type==='star'&&card.faceUp===true;
  }
  const bonusSlots=bonusAchieved?2:0;
  return {index,name:p.name,slots:missionSlots+winnerSlots+bonusSlots,
   missionSlots,winnerSlots,bonusSlots,bonusIndex,bonusAchieved,
   missionIds:won.map(m=>m.id),winner,score:Number(p.round)};
 });
 return {missions:expected,players:results,round};
}
