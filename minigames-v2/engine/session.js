/** Shared MiniGame Engine session lifecycle. No rooms, network or persistence. */
export const MINIGAME_PHASES=Object.freeze(['instructions','countdown','playing','finished']);
export function createMiniGameSession({id,game,members,createdAt}){
 if(typeof id!=='string'||!id||typeof game!=='string'||!game)throw Error('INVALID_MATCH_ID');
 if(!Array.isArray(members)||members.length<1||members.length>4)throw Error('PLAYER_COUNT_1_TO_4');
 if(new Set(members.map(m=>m.uid)).size!==members.length||members.some(m=>typeof m.uid!=='string'||!m.uid))throw Error('INVALID_MEMBERS');
 return {id,game,createdAt,status:{phase:'instructions'},members:members.map(m=>({...m}))};
}
export function matchPhase(match){
 if(!match)return null;
 const phase=match.status?.phase??match.lifecycle?.phase??match[match.game]?.phase??match.phase??null;
 return MINIGAME_PHASES.includes(phase)?phase:null;
}
export function isMatchFinished(match){return matchPhase(match)==='finished';}
export function setMatchPhase(match,phase){
 if(!MINIGAME_PHASES.includes(phase))throw Error('INVALID_MATCH_PHASE');
 const current=matchPhase(match);
 const allowed={instructions:['countdown'],countdown:['playing'],playing:['finished'],finished:[]};
 if(current!==phase&&!allowed[current]?.includes(phase))throw Error('INVALID_MATCH_TRANSITION');
 match.status={phase};return match;
}
export function assertFreshMatch(previous,next){
 if(!next?.id||previous?.id===next.id)throw Error('MATCH_ID_REUSED');
 if(matchPhase(next)!=='instructions')throw Error('NEW_MATCH_MUST_START_WITH_INSTRUCTIONS');
 return next;
}
