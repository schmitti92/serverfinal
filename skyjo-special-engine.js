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
 {id:'below-minus-ten',name:'Beende die Runde mit −10 oder weniger Punkten',slots:6,tier:'hard',field:'score',at:-10,less:true},
 // New mission variants fill the entire 1–10 reel reward range without new Firestore writes.
 {id:'first-combo',name:'Auftakt-Kombo: Räume deine erste Kombination ab',slots:1,tier:'easy',field:'groups',at:1},
 {id:'finish-ten',name:'Punktesammler: Schließe mit höchstens 10 Punkten ab',slots:1,tier:'easy',field:'score',at:10,less:true},
 {id:'zero-trio',name:'Nullen-Trio: Zeige drei Nullen gleichzeitig',slots:3,tier:'medium',field:'zerosAtOnce',at:3},
 {id:'minus-five',name:'Eiskalt kalkuliert: Beende die Runde mit höchstens −5 Punkten',slots:5,tier:'medium',field:'score',at:-5,less:true},
 {id:'three-columns',name:'Säulenstürmer: Räume drei Spalten ab',slots:7,tier:'hard',field:'columns',at:3},
 {id:'three-jokers',name:'Jokerfestival: Zeige drei Joker gleichzeitig',slots:8,tier:'hard',field:'jokersAtOnce',at:3},
 {id:'six-groups',name:'Kombinationskönig: Räume sechs Kombinationen ab',slots:9,tier:'hard',field:'groups',at:6},
 {id:'double-twelve',name:'Doppelte Zwölf: Räume zwei reine 12er-Reihen ab',slots:9,tier:'hard',field:'twelveRows',at:2},
 {id:'minus-twenty',name:'Eisbrecher: Schließe mit −20 Punkten oder weniger ab',slots:10,tier:'hard',field:'score',at:-20,less:true}
]);
const allowedFields=['rows','columns','streets','twelveRows','groups','zeroSeen','jokerSeen','zerosAtOnce','jokersAtOnce','boardClear'];
export function skyjoSpecialSeed(matchId,round){
 let n=2166136261>>>0;
 for(const ch of String(matchId)+'|'+String(round)){n=Math.imul(n^ch.charCodeAt(0),16777619)>>>0;}
 return n;
}
// Preserve three-mission rounds started before the update; their payouts remain unchanged.
const LEGACY_SKYJO_MISSIONS=SKYJO_SPECIAL_MISSIONS.slice(0,22);
export function skyjoSpecialMissions(matchId,round,{legacy=false}={}){
 let n=skyjoSpecialSeed(matchId,round);
 if(legacy)return ['easy','medium','hard'].map(tier=>{
  const pool=LEGACY_SKYJO_MISSIONS.filter(m=>m.tier===tier);
  n=(Math.imul(n,1664525)+1013904223)>>>0;
  return pool[n%pool.length];
 });
 // Every NEW round has one accessible, two challenging and one elite mission.
 // Different progress fields stop the same action from repeatedly paying out.
 const chosen=[],used=new Set();
 for(const tier of ['hard','easy','medium','medium']){
  const pool=SKYJO_SPECIAL_MISSIONS.filter(m=>m.tier===tier&&!used.has(m.field));
  if(!pool.length)throw Error('SKYJO_MISSION_POOL_EXHAUSTED');
  n=(Math.imul(n,1664525)+1013904223)>>>0;
  const mission=pool[n%pool.length];
  chosen.push(mission);used.add(mission.field);
 }
 return [chosen[1],chosen[2],chosen[3],chosen[0]];
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
// Do not close the shared hub match before the final SKYJO prize ceremony.
// In ordinary games there is no special to finish.
export function skyjoHubMatchFinished(game){
 return game?.phase==='gameOver'&&
  (!game.skyjoSpecial?.enabled||game.skyjoSpecial.finished===true);
}
export function skyjoSpecialAwardRows(game,matchId,round){
 const special=game?.skyjoSpecial;
 if(!special?.enabled||special.matchId!==matchId||special.round!==round||game.round!==round)throw Error('SKYJO_SPECIAL_ROUND_MISMATCH');
 if(!['betweenRounds','gameOver'].includes(game.phase)||!game.lastRoundSummary||game.lastRoundSummary.round!==round)throw Error('SKYJO_ROUND_NOT_SETTLED');
 const legacy=Array.isArray(special.missions)&&special.missions.length===3;
 const expected=skyjoSpecialMissions(matchId,round,{legacy});
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
