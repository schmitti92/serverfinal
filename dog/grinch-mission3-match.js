/**
 * Mission 3 authoritative match adapter. Pure state transitions: no Firebase,
 * timers, HTTP routes or official unlocks. The host transport must persist
 * each accepted transition atomically and use authenticated identities.
 */
import {createMission3,mission3LegalMoves,mission3Play,mission3ChooseGrinchMove,
 mission3Projection,mission3Validate} from './grinch-mission3.js';

const fail=code=>{throw Error(code);};
const copy=value=>JSON.parse(JSON.stringify(value));
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=128;
const commandId=value=>validId(value)&&/^[a-zA-Z0-9_-]{8,128}$/.test(value);
function seatFor(match,uid){
 const seat=match.roster.findIndex(p=>p.uid===uid);
 if(seat<0)fail('GRINCH_SPECTATOR');
 return seat;
}
function checkState(state){
 if(!mission3Validate(state))fail('GRINCH_INVALID_STATE');
}
export function createMission3Match({matchId,roster,seed}){
 if(!validId(matchId)||!Number.isInteger(seed)||!Array.isArray(roster)||roster.length!==3||
   roster.some(p=>!p||!validId(p.uid)||typeof p.name!=='string'||p.bot||p.testBot)||
   new Set(roster.map(p=>p.uid)).size!==3)fail('GRINCH_ROSTER_INVALID');
 const members=roster.map((p,seat)=>({uid:p.uid,name:p.name,seat}));
 const state=createMission3(seed,members.map(p=>p.name));
 state.prototype=false;
 checkState(state);
 return {id:matchId,game:'dog-grinch3',roster:members,state,commands:[],frames:[]};
}
export function viewMission3Match(match,uid){
 const seat=seatFor(match,uid);
 const state=mission3Projection(match.state,seat);
 // A split 7 exposes progress but not the unplayed card ID to other seats.
 if(state.seven&&state.seven.seat!==seat)delete state.seven.cardId;
 state.online=true;
 return {id:match.id,game:match.game,seat,roster:copy(match.roster),state,
  frames:copy(match.frames||[])};
}
function publicFrame(state,actor){
 return copy({revision:state.revision,actor,pieces:state.pieces,
  current:state.current,lastPlayedCard:state.lastPlayedCard,
  lastEvent:state.lastEvent,lastCurse:state.lastCurse,lastCapture:state.lastCapture,
  taskEvent:state.tasks.lastTaskEvent,progress:state.tasks.progress,complete:state.complete});
}
/** Only authenticated human actions are accepted. The Grinch is server-run.
 * Return an unchanged reference on replay so the caller can skip all writes.
 * Frames are safe for every player and can be animated from the same response.
 */
export function applyMission3Command(match,uid,command){
 const seat=seatFor(match,uid);
 if(!command||command.matchId!==match.id)fail('GRINCH_MATCH_MISMATCH');
 if(!commandId(command.actionId)||!Number.isSafeInteger(command.expectedRevision)||
   !command.action||typeof command.action!=='object'||Array.isArray(command.action))
  fail('INVALID_GRINCH_ACTION');
 const seen=match.commands.find(c=>c.id===command.actionId);
 if(seen){
  if(seen.uid!==uid)fail('GRINCH_COMMAND_OWNER_MISMATCH');
  return {match,unchanged:true};
 }
 if(match.state.complete)fail('GRINCH_ALREADY_COMPLETED');
 if(command.expectedRevision!==match.state.revision)fail('GRINCH_STALE_REVISION');
 if(match.state.current!==seat)fail('GRINCH_NOT_YOUR_TURN');
 const a=command.action;
 // Whitelist the action shape by comparing it to a server-generated legal move.
 const move=mission3LegalMoves(match.state,seat).find(m=>
  ['kind','cardId','as','pieceId','targetId','distance'].every(k=>m[k]===a[k]));
 if(!move)fail('GRINCH_ILLEGAL_ACTION');
 let state=mission3Play(match.state,seat,move);
 checkState(state);
 const frames=[publicFrame(state,seat)];
 // Include every resolved Grinch movement in order; no separate write per move.
 for(let guard=0;state.current===3&&!state.complete;guard++){
  if(guard>=25)fail('GRINCH_AI_LIMIT');
  const chosen=mission3ChooseGrinchMove(state);
  if(!chosen)fail('GRINCH_AI_NO_MOVE');
  state=mission3Play(state,3,chosen);
  checkState(state);
  frames.push(publicFrame(state,3));
 }
 return {unchanged:false,match:{...match,state,frames,
  commands:[...match.commands.slice(-69),{id:command.actionId,uid}]}};
}
