/** Pure server-authoritative Farbenblitz match reducer.
 * Shared hub supplies player identities, room membership, persistence and broadcasts.
 * This module never creates rooms, connections or online identities.
 */
const COLORS=Object.freeze(['rot','blau','gruen','gelb']);
const LEVELS=Object.freeze(['leicht','mittel','schwer']);
function challenge(round,level){
 const cycle=Math.floor(round/4),index=round%4;
 const wordIndex=(index+cycle)%4,inkIndex=(index+cycle+1+cycle%2)%4;
 return {word:COLORS[wordIndex],ink:COLORS[inkIndex],correct:COLORS[level==='leicht'?wordIndex:inkIndex]};
}
export function createFarbenblitzMatch(members,{rounds=10,level='mittel'}={}){
 if(!Array.isArray(members)||members.length<1||members.length>4||members.some(m=>typeof m?.uid!=='string'||!m.uid)||new Set(members.map(m=>m.uid)).size!==members.length)throw Error('INVALID_MEMBERS');
 if(!Number.isSafeInteger(rounds)||rounds<1||rounds>30||!LEVELS.includes(level))throw Error('INVALID_SETTINGS');
 return {phase:'instructions',ready:[],startAt:null,round:0,rounds,level,answers:{},scores:Object.fromEntries(members.map(m=>[m.uid,0])),finished:false};
}
export function acknowledgeFarbenblitz(match,members,uid,now){
 if(!members.some(m=>m.uid===uid))throw Error('NOT_A_PARTICIPANT');
 if(match.phase!=='instructions')return match;
 if(!match.ready.includes(uid))match.ready.push(uid);
 if(match.ready.length===members.length){match.phase='countdown';match.startAt=now+3000;}
 return match;
}
export function answerFarbenblitz(match,members,uid,{round,color},now){
 if(!members.some(m=>m.uid===uid))throw Error('NOT_A_PARTICIPANT');
 if(match.phase==='countdown'&&now>=match.startAt)match.phase='playing';
 if(match.phase!=='playing')throw Error('NOT_PLAYING');
 if(match.finished||round!==match.round||!COLORS.includes(color))throw Error('INVALID_ANSWER');
 if(Object.hasOwn(match.answers,uid))throw Error('ALREADY_ANSWERED');
 match.answers[uid]=color;
 if(color===challenge(match.round,match.level).correct)match.scores[uid]++;
 if(Object.keys(match.answers).length===members.length){
  match.round++;match.answers={};
  if(match.round>=match.rounds){match.finished=true;match.phase='finished';}
 }
 return match;
}
export function publicFarbenblitz(match,members,uid,now){
 const phase=match.phase==='countdown'&&Number.isFinite(now)&&now>=match.startAt?'playing':match.phase;
 const visible=phase==='playing'||phase==='finished';
 return {phase,round:match.round,rounds:match.rounds,level:match.level,startAt:match.startAt,
  readyCount:match.ready.length,playerCount:members.length,answered:Object.keys(match.answers).length,
  myAnswered:Object.hasOwn(match.answers,uid),challenge:visible&&!match.finished?((({correct,...publicQuestion})=>publicQuestion)(challenge(match.round,match.level))):null,
  results:match.finished?members.map(m=>({seat:m.seat,name:m.name,score:match.scores[m.uid]})):null};
}
