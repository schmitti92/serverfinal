/** Shared minigame match readiness lifecycle.
 * Pure state transitions; no sockets, rooms, persistence, or game-specific rules.
 * Host lobby/server supplies authenticated player IDs and persists returned state.
 */
export function createMiniGameReadiness(playerIds, now=0) {
 if(!Array.isArray(playerIds)||playerIds.length<1||playerIds.length>4||
    playerIds.some(id=>typeof id!=='string'||!id.trim())||
    new Set(playerIds).size!==playerIds.length)throw Error('INVALID_PLAYERS');
 return {phase:'instructions',players:[...playerIds],ready:[],startAt:null,createdAt:now};
}
export function acknowledgeMiniGameInstructions(state,playerId,now) {
 if(!state||state.phase!=='instructions')throw Error('NOT_ACCEPTING_READY');
 if(!state.players.includes(playerId))throw Error('UNKNOWN_PLAYER');
 if(!Number.isFinite(now))throw Error('INVALID_TIME');
 if(state.ready.includes(playerId))return state;
 const ready=[...state.ready,playerId];
 if(ready.length===state.players.length)return {...state,ready,phase:'countdown',startAt:now+3000};
 return {...state,ready};
}
export function advanceMiniGameReadiness(state,now) {
 if(!state||!Number.isFinite(now))throw Error('INVALID_STATE');
 if(state.phase==='countdown'&&now>=state.startAt)return {...state,phase:'playing'};
 return state;
}
export function miniGameCountdown(state,now) {
 if(state?.phase!=='countdown')return null;
 return Math.max(0,Math.ceil((state.startAt-now)/1000));
}
