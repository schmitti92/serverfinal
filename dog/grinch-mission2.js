/**
 * Standalone, deterministic Grinch mission 1 trial engine.
 * Three independent human seats, five reserve pieces each, ORIGINAL 64 track fields.
 * Never reads/writes official DOG rooms, village currency or mission progress.
 */
// Immutable snapshot of the campaign parameters, supplied by the trusted server.
export const MISSION_2=Object.freeze({"id":2,"slug":"verfluchter-aufstieg","title":"Der verfluchte Aufstieg","subtitle":"Grinchs Chaos-Slots","playersMax":3,"piecesPerPlayer":4,"forcedLossesPerPlayer":1,"goal":"Pro Spieler eine weitere Figur verlieren und die übrigen drei durch das eigene Portal nach Welt 3 retten.","goalType":"single-portal-per-player","teleportAtTrackSteps":64,"teleportCountToComplete":3,"theme":"mountain-road","trailHints":[],"effects":{"quakeEvery":12,"fogEvery":7,"clueEvery":9},"enabled":true});
import {rememberMission2Event,initializeMission2,slotForNewPhase,effectiveCardTypes,mission2Values,moveAllowedByCurse,afterMission2Card,mission2TurnAdvance,mission2TurnDirection,projectedMission2} from './grinch-mission2-effects.js';
import {initLossMarkers,shouldCaptureAfterLanding,validCampaignSurvivors} from './grinch-loss-policy.js';
export const SEATS=3,TRACK=64,GOAL=1;
export const COLORS=['#e65f58','#4c9bfa','#e8b84e'];
export const LABELS=['Rot','Blau','Gelb'];
export const START_CARDS=new Set(['1/11','13']);
// Exactly the 14 card types used by the canonical DOG deck (110 cards).
export const TYPES=['1/11','2','3','4','5','6','7','8','9','10','12','13','swap','joker'];
export const LOSS_TYPES=['collapse','abduction','freeze'];
const clone=x=>JSON.parse(JSON.stringify(x));
const pos=(n)=>((n%TRACK)+TRACK)%TRACK;
// The original DOG track uses four 16-step quadrants.
// Mission seats deliberately occupy its red, blue and yellow start indices.
const MISSION_STARTS=[0,16,48];
const homeIndex=s=>MISSION_STARTS[s];
function seeded(seed){let x=(seed>>>0)||1;return ()=>((x=(Math.imul(x,1664525)+1013904223)>>>0)/4294967296);}
function shuffle(xs,rng){const list=[...xs];for(let i=list.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[list[i],list[j]]=[list[j],list[i]];}return list;}
function deck(rng){let id=0;return shuffle(TYPES.flatMap(type=>Array.from({length:type==='joker'?6:8},()=>({id:++id,type}))),rng);}
const rescuedCount=(s,seat)=>s.pieces.filter(p=>p.seat===seat&&p.place==='teleported').length;
const permanentLossCount=(s,seat)=>s.pieces.filter(p=>p.seat===seat&&p.place==='lost').length;
const rescueCountFor=(s,seat)=>s.pieces.filter(p=>p.seat===seat&&p.place==='teleported').length;
export const canAssistAllies=(s,seat)=>s.players[seat]?.m2Lost===true&&rescuedCount(s,seat)===3;
function controllablePieces(s,seat){
 const owners=canAssistAllies(s,seat)
  ?s.players.filter(p=>p.seat!==seat&&rescuedCount(s,p.seat)<3).map(p=>p.seat)
  :[seat];
 return s.pieces.filter(p=>owners.includes(p.seat));
}
function pieceAtTrack(s,absolute,except){return s.pieces.find(p=>p.id!==except&&p.place==='track'&&pos(homeIndex(p.seat)+p.steps)===absolute);}
function isProtectedStart(p){
 return p?.place==='track'&&pos(homeIndex(p.seat)+p.steps)===homeIndex(p.seat);
}
function moveQuake(s){
 // Simultaneous earthquake: take a fixed snapshot before resolving any move.
 // An occupied destination stays blocked, even if its occupant could move.
 const track=s.pieces.filter(p=>p.place==='track');
 const occupied=new Set(track.map(pieceCoord));
 let moved=0,blocked=0,protectedCount=0;
 const movements=[];
 for(const pawn of track){
  const from=pieceCoord(pawn);
  if(from%16===0){protectedCount++;continue;} // every colored start square is safe
  if(pawn.steps<=0){protectedCount++;continue;} // never reverse out of the start gate
  const to=pos(from-1);
  if(occupied.has(to)){blocked++;continue;}
  pawn.steps--;moved++;
  movements.push({pieceId:pawn.id,from,to});
 }
 return {moved,blocked,protectedCount,movements};
}

function values(s,type){return mission2Values(s,type);}
function isTurnDone(s){return s.players.every(p=>s.hands[p.seat].length===0);}
function refill(s){
 s.round++;
 const dealCount=[6,5,4,3,2][(s.round-1)%5]; // canonical DOG card-phase sizes
 s.hands=[[],[],[]];
 for(let card=0;card<dealCount;card++)for(let seat=0;seat<SEATS;seat++){
  if(s.draw.length===0){
   if(!s.discard.length)throw Error('Keine Karten mehr im Ablagestapel.');
   s.draw=shuffle(s.discard.splice(0),seeded(s.seed+s.round*7919));
  }
  s.hands[seat].push(s.draw.pop());
 }
 s.current=(s.round-1)%SEATS;
 log(s,'Neue Kartenphase '+s.round+': '+dealCount+' Karten pro Spieler');
 const effects=slotForNewPhase(s,(seat,card)=>{
  const previous=s.current;
  s.current=seat;
  try{return legalMoves(s,seat,card);}finally{s.current=previous;}
 });
 // A phase can open with an immediate skip. Consume it before this player acts.
 if(mission2TurnAdvance(s,s.current)){
  s.current=(s.current+mission2TurnDirection(s)+SEATS)%SEATS;s.turn++;
 }
 s.m2.pendingSlotRound=s.round;
 s.lastEvent={type:'slot',round:s.round,effects,message:'🎰 Der Grinch löst '+effects.length+' Gemeinheit(en) aus!',turn:s.turn};
 rememberMission2Event(s,s.lastEvent);
}
function log(s,message){s.history.unshift(message);s.history=s.history.slice(0,10);}
function nextTurn(s){
 s.current=(s.current+mission2TurnDirection(s)+SEATS)%SEATS;s.turn++;
 if(isTurnDone(s))refill(s);
 if(s.m2?.pendingSlotRound)return; // wait before skipping into another phase
 // Discard impossible hands, rather than soft-locking an active player.
 let guard=0;
 // A whole deal can contain no playable starting or movement cards.
 // Cycle through complete card phases until somebody has a legal move.
 while(guard++<500&&!s.complete){
  if(mission2TurnAdvance(s,s.current)){
   s.current=(s.current+mission2TurnDirection(s)+SEATS)%SEATS;s.turn++;
   if(isTurnDone(s)){refill(s);return;}
   continue;
  }
  const hand=s.hands[s.current];
  const can=hand.some(c=>legalMoves(s,s.current,c).length>0);
  if(can)break;
  if(hand.length){log(s,LABELS[s.current]+' kann nicht ziehen – Karten abgelegt');s.discard.push(...hand.splice(0));}
  s.current=(s.current+mission2TurnDirection(s)+SEATS)%SEATS;s.turn++;
  if(isTurnDone(s)){refill(s);return;}
 }
 if(guard>=500)throw Error('Keine legalen Kartenaktionen gefunden.');
}
function assignLosses(seed){return shuffle(LOSS_TYPES,seeded(seed+77));}
export function newGame(seed=Math.floor(Math.random()*2147483647),names=LABELS){
 const rng=seeded(seed);
 const lossMarkers=initLossMarkers(seed,2,SEATS);
 const s={
  version:6,mission:MISSION_2.id,seed,players:LABELS.map((name,seat)=>({seat,name:String(names[seat]||name).slice(0,25),lossType:assignLosses(seed)[seat],lost:true,m2Lost:false,moves:0,lossTriggerAt:lossMarkers[seat].triggerAt,lossEligibleLandings:0})),
  // Mission 1 already took figure 5 from each player. Four remain:
  // figure 4 starts protected, figures 1-3 start at home. Exactly one more
  // player-owned figure must disappear in Mission 2, leaving three for Mission 3.
  pieces:Array.from({length:15},(_,i)=>({
   id:'p'+i,seat:Math.floor(i/5),
   place:i%5===4?'lost':i%5===3?'track':'home',
   steps:i%5===3?0:-1
  })),
  current:0,turn:0,round:0,draw:deck(rng),discard:[],hands:[[],[],[]],seven:null,history:[],complete:false,revision:0,lastEvent:null,effects:[],
 };
 initializeMission2(s);
 refill(s);
 // Never run an automatic turn before the initial slot has been acknowledged.
 return s;
}
export function pieceCoord(p){return p.place==='track'?pos(homeIndex(p.seat)+p.steps):-1;}

// Pure, mission-only adaptation of the classic DOG movement rules.
// Special cards (split 7, independent SWAP, joker), protection and the
// exact-hit portal are deliberately separate from the normal 4-seat engine.
function route(s,p,distance,hitEvery=false,intoPortal=false){
 if(!p||p.place!=='track'||!Number.isInteger(distance)||distance===0)return null;
 const target=p.steps+distance;
 if(target>TRACK||target < -TRACK*4)return null;
 // Classic DOG: after walking backwards behind own start, crossing forward
 // opens the first portal as an OPTIONAL alternative to the circular track.
 const shortPortal=intoPortal&&p.steps<0&&distance>0&&target===1;
 if(intoPortal&&!shortPortal)return null;
 const entersPortal=target===TRACK||shortPortal;
 // Exactly 3 survivors can cross into Mission 3. The fourth remaining
 // figure MUST be lost through the same concealed, once-only trap as Mission 1.
 // Block the third rescue until the second permanent loss has occurred.
 if(entersPortal&&((!s.players[p.seat].m2Lost&&rescuedCount(s,p.seat)>=2)||
   rescuedCount(s,p.seat)>=3))return null;
 if(s.m2&&entersPortal&&s.turn<s.m2.portalUntil)return null;
 const captures=[];
 for(let n=1;n<=Math.abs(distance);n++){
  const relative=p.steps+n*Math.sign(distance);
  if(relative>=TRACK){
   // The mission portal accepts ONLY the exact final step.
   if(relative===TRACK&&n===Math.abs(distance)&&distance>0)break;
   return null;
  }
  if(shortPortal&&relative===1&&n===Math.abs(distance))break;
  const coordinate=pos(homeIndex(p.seat)+relative);
  if(s.m2?.hazards?.some(h=>h.type==='wall'&&h.until>s.turn&&h.field===coordinate))return null;
  if(n===Math.abs(distance)&&s.m2?.hazards?.some(h=>h.type==='endblock'&&h.until>s.turn&&h.field===coordinate))return null;
  const at=pieceAtTrack(s,coordinate,p.id);
  if(at&&isProtectedStart(at))return null;
  if(at&&(hitEvery||n===Math.abs(distance)))captures.push(at.id);
 }
 return {targetSteps:target,viaPortal:entersPortal,captureIds:[...new Set(captures)]};
}
function applyRoute(s,m){
 const pawn=s.pieces.find(p=>p.id===m.pieceId);
 if(!pawn||pawn.place!=='track')throw Error('Spielfigur kann nicht laufen.');
 const routeMove=route(s,pawn,m.distance,m.kind==='seven',Boolean(m.viaPortal&&m.targetSteps!==TRACK));
 if(!routeMove)throw Error('Ungültige Kartenbewegung.');
 for(const id of routeMove.captureIds){
  const victim=s.pieces.find(p=>p.id===id);
  if(isProtectedStart(victim))throw Error('Geschütztes Startfeld.');
  victim.place='home';victim.steps=-1;
 }
 pawn.steps=routeMove.targetSteps;
 pawn.place=routeMove.viaPortal?'teleported':'track';
}
function sevenCandidates(s,seat,left,cardId,as){
 const moves=[];
 for(const p of controllablePieces(s,seat).filter(p=>p.place==='track')){
  for(let n=1;n<=left;n++)for(const portal of [false,true]){
   if(portal&&!(p.steps<0&&p.steps+n===1))continue;
   const r=route(s,p,n,true,portal);
   const card=s.hands[seat]?.find(c=>c.id===cardId);
   if(r&&(!card||moveAllowedByCurse(s,seat,card,p.id,as,p.steps,r.targetSteps,n,r.viaPortal)))
    moves.push({kind:'seven',pieceId:p.id,cardId,as,distance:n,targetSteps:r.targetSteps,viaPortal:r.viaPortal,captureIds:r.captureIds});
  }
 }
 return moves;
}
function canFinishSeven(s,seat,left,cardId,memo=new Set()){
 if(left===0)return true;
 if(left<0)return false;
 const stateKey=left+'|'+s.pieces.map(p=>p.place==='track'?p.id+':'+p.steps:p.id+':'+p.place).join(',');
 if(memo.has(stateKey))return false;
 memo.add(stateKey);
 const all=sevenCandidates(s,seat,left,cardId,'7').sort((a,b)=>b.distance-a.distance);
 for(const move of all){
  const next=clone(s);applyRoute(next,move);
  if(canFinishSeven(next,seat,left-move.distance,cardId,memo))return true;
 }
 return false;
}
export function legalMoves(s,seat,card){
 if(s.complete||seat!==s.current||!card||!s.hands[seat].some(c=>c.id===card.id))return [];
 const pending=s.seven;
 if(pending&&pending.cardId!==card.id)return [];
 const types=pending?[pending.as]:effectiveCardTypes(s,card,card.type==='joker'?TYPES.filter(type=>type!=='joker'):[card.type]);
 const moves=[];
 for(const type of types){
  if(type==='7'){
   const left=pending?7-pending.spent:7;
   for(const action of sevenCandidates(s,seat,left,card.id,type)){
    const next=clone(s);applyRoute(next,action);
    if(canFinishSeven(next,seat,left-action.distance,card.id))moves.push(action);
   }
   continue;
  }
  if(pending)continue;
  if(START_CARDS.has(type)){
   for(const p of controllablePieces(s,seat).filter(p=>p.place==='home')){
    const at=pieceAtTrack(s,homeIndex(p.seat),p.id);
    // Classic DOG: own protected starter blocks launch; an unprotected
    // foreign visitor on this colored start can be sent home.
    if(!at||!isProtectedStart(at))
     moves.push({kind:'start',pieceId:p.id,cardId:card.id,as:type});
   }
  }
  if(type==='swap'){
   let found=false;
   for(const a of controllablePieces(s,seat).filter(p=>p.place==='track'&&!isProtectedStart(p)))
    for(const b of s.pieces.filter(p=>p.seat!==a.seat&&p.place==='track'&&!isProtectedStart(p))){
      moves.push({kind:'swap',pieceId:a.id,targetId:b.id,cardId:card.id,as:type});
      found=true;
    }
   if(!found)moves.push({kind:'emptySwap',pieceId:null,cardId:card.id,as:type});
   continue;
  }
  for(const distance of values(s,type))
   for(const p of controllablePieces(s,seat).filter(p=>p.place==='track'))
    for(const portal of [false,true]){
     if(portal&&!(p.steps<0&&distance>0&&p.steps+distance===1))continue;
     const r=route(s,p,distance,false,portal);
     if(r)moves.push({kind:'move',pieceId:p.id,cardId:card.id,as:type,distance,targetSteps:r.targetSteps,viaPortal:r.viaPortal,captureIds:r.captureIds});
    }
 }
 return moves.filter(m=>{
  const p=s.pieces.find(p=>p.id===m.pieceId);
  return moveAllowedByCurse(s,seat,card,m.pieceId,m.as,p?.place==='track'?p.steps:null,m.targetSteps??null,m.distance??null,Boolean(m.viaPortal));
 });
}
function ensureSingleLoss(s,seat,movedId){
 // Invisible story traps: there are NO visible markers or announced danger tiles.
 // Only the pawn that actually FINISHED a card move can reveal a trap.
 // Start squares and public story-hint squares remain safe.
 const info=s.players[seat];
 if(info.m2Lost)return;
 const p=s.pieces.find(p=>p.id===movedId&&p.seat===seat);
 if(!p||p.place!=='track')return;
 const trackPosition=pieceCoord(p);
 // All four colored start squares stay safe, even if a visiting pawn lands there.
 if(trackPosition%16===0||(MISSION_2.trailHints||[]).some(h=>h.field===trackPosition))return;
 if(!shouldCaptureAfterLanding(info,{seed:s.seed,mission:2,seat,rescued:rescueCountFor(s,seat)}))return;
 p.place='lost';p.steps=-1;info.m2Lost=true;info.m2LostPieceId=p.id;
 const names={collapse:'Der Boden bricht ein!',abduction:'Eine Figur wird entführt!',freeze:'Ein Eisfluch schlägt zu!'};
 const msg=names[info.lossType]+' '+info.name+' verliert die vierte verbleibende Figur. Drei Figuren bleiben für Mission 3.';
 // The position becomes public ONLY in the activation event, never in the
 // pre-trigger board markup, cards or player status.
 s.lastEvent={type:'loss',seat,pieceId:p.id,lossType:info.lossType,position:trackPosition,concealedUntilTriggered:true,message:msg,turn:s.turn};
 log(s,msg);
 rememberMission2Event(s,s.lastEvent);
}
function maybeEffects(s){ /* Only the slot machine triggers Mission 2 effects. */ }
function checkComplete(s){
 // Mission 1: 1 lost/4 rescued. Mission 2: one ADDITIONAL permanent loss;
 // exactly 3 rescued/5 original figures in total, no extra figures on board.
 s.complete=s.players.every(info=>info.m2Lost&&validCampaignSurvivors(s.pieces,info.seat,2));
 if(s.complete){s.lastEvent={type:'win',message:'Genau eine weitere Figur je Spieler ist verschwunden. Die übrigen neun Figuren (3 pro Spieler) sind nach Welt 3 gerettet!',turn:s.turn};log(s,s.lastEvent.message);}
}
export function acknowledgeMission2Slot(original,seat,round){
  if(!original||original.complete||seat!==original.current)throw Error('GRINCH_SLOT_NOT_YOUR_TURN');
  if(!Number.isInteger(round)||original.m2?.pendingSlotRound!==round||round!==original.round)
    throw Error('GRINCH_SLOT_NOT_PENDING');
  const s=clone(original);s.m2.pendingSlotRound=null;
  if(!s.hands[s.current].some(c=>legalMoves(s,s.current,c).length))nextTurn(s);
  s.revision++;
  return s;
}
export function play(original,seat,action){
 if(original.m2?.pendingSlotRound)throw Error('GRINCH_SLOT_PENDING');
 if(original.complete||seat!==original.current)throw Error('Nicht dein Zug.');
 const valid=original.hands[seat].flatMap(card=>legalMoves(original,seat,card));
 const chosen=valid.find(m=>m.kind===action.kind&&m.cardId===action.cardId&&m.as===action.as&&m.pieceId===action.pieceId&&m.targetId===action.targetId&&m.distance===action.distance&&Boolean(m.viaPortal)===Boolean(action.viaPortal));
 if(!chosen)throw Error('Ungültiger Zug');
 const s=clone(original),p=s.pieces.find(p=>p.id===chosen.pieceId);
 const originalPiece=p?{...p}:null;
 if(chosen.kind==='start'){
  const previous=pieceAtTrack(s,homeIndex(p.seat),p.id);
  if(previous){
   if(isProtectedStart(previous))throw Error('Ein eigenes geschütztes Startfeld ist belegt.');
   previous.place='home';previous.steps=-1;
   log(s,s.players[seat].name+' schlägt eine ungeschützte Figur auf dem Startfeld von '+s.players[p.seat].name+'.');
  }
  p.place='track';p.steps=0;
 }else if(chosen.kind==='move'||chosen.kind==='seven'){
  applyRoute(s,chosen);
 }else if(chosen.kind==='swap'){
  const other=s.pieces.find(p=>p.id===chosen.targetId);
  const firstAbs=pieceCoord(p),otherAbs=pieceCoord(other);
  if(isProtectedStart(p)||isProtectedStart(other))throw Error('Startfeld ist vor Tausch geschützt.');
  p.steps=pos(otherAbs-homeIndex(p.seat));
  other.steps=pos(firstAbs-homeIndex(other.seat));
 }
 // A split 7 is ONE card action. Never trigger a mandatory loss halfway
 // through its seven steps: that could eliminate the only movable figure
 // and strand the rest of the card.
 const completesSeven=chosen.kind==='seven'&&((s.seven?.spent||0)+chosen.distance===7);
 const completesCard=chosen.kind!=='seven'||completesSeven;
 if(completesCard)s.players[seat].moves++;
 s.lastEvent=null;
 if(completesCard)afterMission2Card(s,seat,chosen,originalPiece);
 if(completesCard&&chosen.kind!=='emptySwap'&&p)ensureSingleLoss(s,p.seat,p.id);
 if(p?.place==='teleported'){
  log(s,s.players[p.seat].name+' teleportiert eine Figur nach Welt 3'+(p.seat!==seat?' (Hilfe durch '+s.players[seat].name+')':''));
  if(!s.lastEvent)s.lastEvent={type:'teleport',seat:p.seat,pieceId:p.id,message:'✨ '+s.players[p.seat].name+' teleportiert eine Figur nach Welt 3!',turn:s.turn};
 }
 if(!s.lastEvent&&p?.place==='track'){
  const clue=(MISSION_2.trailHints||[]).find(h=>h.field===pieceCoord(p));
  if(clue){s.lastEvent={type:'hint',field:clue.field,message:clue.message,turn:s.turn};log(s,'Pfadfinder-Hinweis: '+clue.title);}
 }
 if(chosen.kind==='seven'){
  if(!s.seven)s.seven={cardId:chosen.cardId,as:chosen.as,spent:0};
  s.seven.spent+=chosen.distance;
  log(s,s.players[seat].name+' teilt die 7: '+chosen.distance+' Schritte ('+s.seven.spent+'/7)');
  if(s.seven.spent<7){
   s.revision++;return s;
  }
  s.seven=null;
 }
 const index=s.hands[seat].findIndex(c=>c.id===chosen.cardId);
 if(index<0)throw Error('Karte nicht vorhanden.');
 s.discard.push(s.hands[seat].splice(index,1)[0]);
 log(s,s.players[seat].name+' spielt '+chosen.as);
 checkComplete(s);
 if(!s.complete){
  nextTurn(s);maybeEffects(s);
  if(!s.hands[s.current].some(card=>legalMoves(s,s.current,card).length))nextTurn(s);
 }
 s.revision++;
 return s;
}
export function status(s){return s.players.map(info=>({
 seat:info.seat,name:info.name,lost:info.lost,home:s.pieces.filter(p=>p.seat===info.seat&&p.place==='home').length,
 track:s.pieces.filter(p=>p.seat===info.seat&&p.place==='track').length,
 teleported:s.pieces.filter(p=>p.seat===info.seat&&p.place==='teleported').length
}));}
export function validateSaved(x){return !!x&&x.version===6&&x.mission===2&&Array.isArray(x.players)&&x.players.length===3&&Array.isArray(x.pieces)&&x.pieces.length===15&&Array.isArray(x.hands)&&x.hands.length===3&&Number.isInteger(x.current)&&x.current>=0&&x.current<3&&x.pieces.every(p=>['home','track','teleported','lost'].includes(p.place));}

/**
 * Per-viewer projection of an authoritative online match.
 * Never transmit hidden draw pile, RNG seed, future loss types or other hands.
 * Private cards remain visible to the authenticated owner ONLY.
 */
export function publicMissionState(raw,viewerSeat=null){
 if(!raw||typeof raw!=='object')return null;
 const projected=JSON.parse(JSON.stringify(raw));
 const seat=Number.isInteger(viewerSeat)&&viewerSeat>=0&&viewerSeat<3?viewerSeat:null;
 projected.hands=projected.hands.map((hand,i)=>i===seat?hand:[]);
 projected.handCounts=raw.hands.map(hand=>hand.length);
 projected.drawCount=raw.draw.length;
 projected.discardCount=raw.discard.length;
 projected.lastPlayedCard=raw.discard.length?raw.discard[raw.discard.length-1].type:null;
 projected.draw=[];
 projected.discard=[];
 projected.seed=null;
 projected.players=projected.players.map(({lossType,lossTriggerAt,lossEligibleLandings,...rest})=>rest);
 projected.viewerSeat=seat;
 projected.online=true;
 projectedMission2(projected,seat);
 return projected;
}
