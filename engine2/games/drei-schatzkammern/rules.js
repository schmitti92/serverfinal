/** Three Treasure Chambers: pure, deterministic rules for MiniGame Engine 2.0. */
export const GAME_ID='drei-schatzkammern';
export const CHARACTER_COLORS=Object.freeze(['#e9a23b','#5ac8c8','#b18af4','#e77e93']);
const fail=code=>{throw Error(code)};
const validDoor=d=>Number.isInteger(d)&&d>=0&&d<3;
const unique=a=>new Set(a).size===a.length;
export function createGame({players,lockedDoors}){
 if(!Array.isArray(players)||players.length<1||players.length>4||players.some(p=>typeof p!=='string'||!p)||!unique(players))fail('INVALID_PLAYERS');
 if(!Array.isArray(lockedDoors)||!lockedDoors.length||lockedDoors.some(d=>!validDoor(d)))fail('INVALID_DOOR_SEQUENCE');
 return {gameId:GAME_ID,phase:'choosing',round:0,players:[...players],alive:[...players],choices:{},lockedDoors:[...lockedDoors],revealIndex:0,reveals:[],winnerIds:[],finished:false};
}
export function chooseDoor(state,playerId,door){
 const s=structuredClone(state);
 if(s.phase!=='choosing')fail('NOT_CHOOSING');
 if(!s.alive.includes(playerId))fail('PLAYER_ELIMINATED');
 if(!validDoor(door))fail('INVALID_DOOR');
 if(Object.hasOwn(s.choices,playerId))fail('ALREADY_CHOSEN');
 s.choices[playerId]=door;
 if(s.alive.every(id=>Object.hasOwn(s.choices,id)))s.phase='revealing';
 return s;
}
/** Reveal doors 0,1,2 in order; all participants at the locked door are eliminated together. */
export function revealNext(state){
 const s=structuredClone(state);
 if(s.phase!=='revealing')fail('NOT_REVEALING');
 const door=s.revealIndex,locked=door===s.lockedDoors[s.round];
 const visitors=s.alive.filter(id=>s.choices[id]===door);
 s.reveals.push({door,locked,visitors:[...visitors]});
 if(locked)s.alive=s.alive.filter(id=>!visitors.includes(id));
 s.revealIndex++;
 if(s.revealIndex===3){
  if(s.alive.length===0||(s.players.length>1&&s.alive.length===1)||s.round+1>=s.lockedDoors.length){
   s.phase='finished';s.finished=true;s.winnerIds=[...s.alive];
  }else{
   s.round++;s.phase='choosing';s.choices={};s.revealIndex=0;s.reveals=[];
  }
 }
 return s;
}
export function getResult(state){
 if(!state.finished) return null;
 return {winnerIds:[...state.winnerIds],survivors:[...state.alive],
  eliminated:state.players.filter(id=>!state.alive.includes(id)),roundsPlayed:state.round+1,
  draw:state.winnerIds.length!==1};
}
/** Deterministic bot selection; caller supplies the round and participant seed. */
export function botAction(state,playerId,seed=0){
 if(!state.alive.includes(playerId)||Object.hasOwn(state.choices,playerId))fail('BOT_NOT_ELIGIBLE');
 if(!Number.isSafeInteger(seed))fail('INVALID_SEED');
 const number=Array.from(playerId).reduce((n,c)=>n+c.charCodeAt(0),seed+state.round*17);
 return {type:'choose-door',playerId,door:((number%3)+3)%3};
}
/** Never reveal the locked door or other players' choices during the selection phase. */
export function publicGame(state,viewerId){
 return {gameId:state.gameId,phase:state.phase,round:state.round+1,alive:[...state.alive],
  chosenCount:Object.keys(state.choices).length,hasChosen:Object.hasOwn(state.choices,viewerId),
  myChoice:state.choices[viewerId]??null,reveals:structuredClone(state.reveals),
  result:getResult(state)};
}
