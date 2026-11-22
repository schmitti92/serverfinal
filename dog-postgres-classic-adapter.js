/**
 * P3 PREPARATION ONLY — the live DOG hub still uses Firestore.
 *
 * Shared, server-side DOG rules for a future fully durable Postgres room.
 * Only normal non-seasonal moves may use this reducer; the Postgres store
 * rejects finished matches. XP and Christmas payments require a separate
 * exactly-once Firestore settlement bridge before going live.
 *
 * This function must remain synchronous and never perform database I/O.
 */
import {
 exchangeCard as dogExchangeCard,
 researchSwapCard as dogResearchSwapCard,
 takeAction as dogTakeAction,
 botAction as dogBotAction,
 publicState as publicDogState
} from './dog/engine.js';
import {newDogMatchCounters,countDogKnockouts} from './dog/player-stats.js';

const fail=code=>{const e=new Error(code);e.code=code;throw e};
const isHuman=p=>p&&p.bot!==true&&p.inactive!==true&&typeof p.uid==='string'&&p.uid.length>0;

export function reduceDogClassicInPostgresRoom(room,{uid,matchId,action,actionId},{
  chooseBot=dogBotAction,rng=Math.random,allowFinished=false
}={}){
 if(room?.phase!=='playing'||room?.match?.game!=='dog'||room.match.id!==matchId)
  fail('DOG_MATCH_MISMATCH');
 const match=room.match;
 if(match.christmas?.enabled||match.dogChristmasEligibilityChecked!==true)
  fail('DOG_REWARD_SETTLEMENT_REQUIRED');
 const entry=match.dogRoster?.find(player=>player.uid===uid);
 if(!isHuman(entry)||!room.players?.some(player=>player.uid===uid))
  fail('DOG_SPECTATOR');
 const seat=entry.seat;
 if(!Number.isInteger(seat)||seat<0||seat>3)fail('DOG_SEAT_INVALID');
 if(typeof action?.type!=='string'||!action.type)fail('DOG_ACTION_INVALID');
 if(action.type==='research-peek')fail('RESEARCH_RETIRED');
 if(action.type==='research-swap'&&
   (!(match.dogResearchSkills?.[uid]?.card_swap>0)||match.dog?.phase!=='exchange'))
  fail('RESEARCH_SWAP_UNAVAILABLE');

 const collect=(before,after,move,actorSeat)=>{
  // Track exact verified knockouts. Stats remain in the room, not in
  // Firestore per turn. Actual XP payment is still deferred to match end.
  countDogKnockouts(match,before,after,actorSeat);
 };
 if(action.type==='research-swap'){
  match.dog=dogResearchSwapCard(match.dog,seat,action.cardId,rng);
 }else if(action.type==='exchange'){
  match.dog=dogExchangeCard(match.dog,seat,action.cardId,rng);
 }else{
  const prior=match.dog;
  match.dog=dogTakeAction(prior,seat,action,rng);
  collect(prior,match.dog,action,seat);
 }
 if(typeof actionId==='string'&&actionId.length>0)
  match.dogCommands=[...(match.dogCommands||[]).slice(-90),actionId];

 // Exactly the same bot move ordering as the current Firestore-backed hub:
 // bot exchanges first, then legal bot turns, until a human can play.
 let state=match.dog,guard=0;
 while(state.phase!=='finished'&&++guard<300){
  if(state.phase==='exchange'){
   const botSeat=state.players.findIndex(player=>player.bot&&state.exchanges[player.seat]===null);
   if(botSeat<0)break;
   const choice=chooseBot(state,botSeat);
   if(!choice||choice.type!=='exchange')fail('DOG_BOT_EXCHANGE_FAILED');
   state=dogExchangeCard(state,botSeat,choice.cardId,rng);
  }else if(['play','seven','rescue'].includes(state.phase)&&state.players[state.current]?.bot){
   const current=state.current,choice=chooseBot(state,current);
   if(!choice)fail('DOG_BOT_MOVE_FAILED');
   const before=state;
   state=dogTakeAction(before,current,choice,rng);
   collect(before,state,choice,current);
  }else break;
 }
 if(guard>=300)fail('DOG_BOT_LOOP');
 match.dog=state;

 // End-of-match counters and the winning settlement must be written
 // atomically with Firebase XP. Do NOT acknowledge a finished PG-only turn.
 if(state.phase==='finished'&&!allowFinished)fail('DOG_REWARD_SETTLEMENT_REQUIRED');
 return {room};
}

/**
 * Private rule-engine projection for a future authenticated PG WebSocket.
 * The existing hub's expose() is still responsible for the full room view.
 * This helper never returns an unfiltered/private room.
 */
export function projectPostgresDogState(room,uid){
 if(!room||!room.players?.some(p=>p.uid===uid)||room.match?.game!=='dog')
  fail('DOG_NOT_A_ROOM_MEMBER');
 const entry=room.match.dogRoster?.find(player=>player.uid===uid);
 const seat=isHuman(entry)?entry.seat:null;
 return {
  code:room.code,
  revision:room.revision,
  matchId:room.match.id,
  dogSeat:seat,
  dog:publicDogState(room.match.dog,seat)
 };
}
