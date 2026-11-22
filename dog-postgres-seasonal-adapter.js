/**
 * P5 PREPARATION ONLY — pure Christmas DOG move calculation for a future
 * durable Postgres producer. DO NOT import into live server.js/shared-lobby.js.
 *
 * This reducer is deliberately NOT a payout mechanism. Normal moves with
 * NO earned rewards may eventually be stored directly in PG. A move earning
 * village lights/vouchers, or finishing the match, MUST first become an
 * immutable SQL pending operation. It may only be revealed after its
 * exactly-once Firestore settlement has been confirmed.
 *
 * All decisions originate from the trusted private SQL room and actual DOG
 * engine transitions. The client cannot supply a prize, card deck, village
 * level, counter or scratch outcome.
 */
import {randomInt} from 'node:crypto';
import {
  exchangeCard as dogExchangeCard,
  researchSwapCard as dogResearchSwapCard,
  takeAction as dogTakeAction,
  botAction as dogBotAction
} from './dog/engine.js';
import {newDogMatchCounters,countDogKnockouts} from './dog/player-stats.js';
import {
  claimDogChristmasGift,claimDogChristmasScratch,finishDogChristmasMatch,
  refreshDogChristmasDeal
} from './dog/christmas-village.js';

const fail=code=>{const error=new Error(code);error.code=code;throw error};
const human=p=>p&&p.bot!==true&&p.inactive!==true&&typeof p.uid==='string'&&p.uid.length>0;
const safeNumber=n=>Number.isSafeInteger(n)&&n>=0?n:0;

export function reduceDogSeasonalInPostgresRoom(room,{
  uid,matchId,action,actionId
}={},{
  cardRng=Math.random,rewardDraw=randomInt,chooseBot=dogBotAction,
  eventActive=true,allowUnsettledRewards=false
}={}){
 if(room?.phase!=='playing'||room.match?.game!=='dog'||room.match.id!==matchId)
  fail('DOG_PG_SEASONAL_WRONG_MATCH');
 const match=room.match;
 if(eventActive!==true||
    match.dogChristmasEligibilityChecked!==true||
    match.christmas?.enabled!==true||
    match.dog?.phase==='finished')
  fail('DOG_PG_SEASONAL_NOT_ELIGIBLE');
 const roster=match.dogRoster;
 if(!Array.isArray(roster)||roster.length!==4||
    !Array.isArray(room.players)||
    !Array.isArray(match.members))
  fail('DOG_PG_SEASONAL_INVALID_ROSTER');
 const player=roster.find(p=>p.uid===uid);
 if(!human(player)||!room.players.some(p=>p.uid===uid)||
    !match.members.some(p=>p.uid===uid))
  fail('DOG_PG_SEASONAL_NOT_PARTICIPANT');
 const seat=player.seat;
 if(!Number.isInteger(seat)||seat<0||seat>3||
    typeof action?.type!=='string'||!action.type)
  fail('DOG_PG_SEASONAL_BAD_ACTION');
 if(typeof actionId!=='string'||!/^[-a-zA-Z0-9_:]{8,90}$/.test(actionId))
  fail('DOG_PG_SEASONAL_BAD_ACTION');
 if(action.type==='research-peek')fail('RESEARCH_RETIRED');
 if(action.type==='research-swap'&&
    (!(match.dogResearchSkills?.[uid]?.card_swap>0)||match.dog.phase!=='exchange'))
  fail('RESEARCH_SWAP_UNAVAILABLE');
 if(typeof cardRng!=='function'||typeof rewardDraw!=='function'||
    typeof chooseBot!=='function')
  fail('DOG_PG_SEASONAL_INVALID_RNG');

 // Snapshot the unmodified, privately held room for later immutable
 // PG reward settlement proof. This is NEVER sent to a browser or outbox.
 const before=structuredClone(room);
 const event=match.christmas;
 const initial={
  earnedTenths:safeNumber(event.earnedTenths),
  giftCount:safeNumber(event.giftCount),
  bonusGiftCount:safeNumber(event.bonusGiftCount),
  scratchCount:safeNumber(event.scratchCount)
 };
 const vouchers=[];
 if(!match.dogCounters)match.dogCounters=newDogMatchCounters();
 const newDeal=round=>refreshDogChristmasDeal(event,round,rewardDraw);
 const verifiedMove=(prior,next,move,actorSeat)=>{
  countDogKnockouts(match,prior,next,actorSeat);
  const lights=claimDogChristmasGift(event,prior,next,move,actorSeat,rewardDraw);
  const recipient=roster.find(p=>p.seat===actorSeat);
  if(lights>0&&human(recipient)){
   const ranks=match.dogResearchSkills?.[recipient.uid]||{};
   const carry=safeNumber(match.dogLightCarry?.[recipient.uid]);
   const numerator=lights*Math.min(10,safeNumber(ranks.lights_bonus))*5+carry;
   const bonusTenths=Math.floor(numerator/100);
   match.dogLightCarry={...(match.dogLightCarry||{}),
    [recipient.uid]:numerator%100};
   event.earnedTenths+=bonusTenths;
  }
  // Bots can earn shared village lights, but never personal vouchers.
  if(human(recipient)){
   const tier=claimDogChristmasScratch(event,prior,next,move,actorSeat,rewardDraw);
   if(tier)vouchers.push({uid:recipient.uid,tier});
  }
  finishDogChristmasMatch(event,next);
 };
 try{
  if(action.type==='research-swap'){
   match.dog=dogResearchSwapCard(match.dog,seat,action.cardId,cardRng);
  }else if(action.type==='exchange'){
   const prior=match.dog;
   match.dog=dogExchangeCard(prior,seat,action.cardId,cardRng);
   if(prior.round!==match.dog.round)newDeal(match.dog.round);
  }else{
   const prior=match.dog;
   match.dog=dogTakeAction(prior,seat,action,cardRng);
   verifiedMove(prior,match.dog,action,seat);
   if(prior.round!==match.dog.round)newDeal(match.dog.round);
  }
  match.dogCommands=[...(match.dogCommands||[]).slice(-90),actionId];
  let next=match.dog,guard=0;
  while(next.phase!=='finished'&&++guard<300){
   if(next.phase==='exchange'){
    const botSeat=next.players.findIndex(
     p=>p.bot&&next.exchanges[p.seat]===null);
    if(botSeat<0)break;
    const choice=chooseBot(next,botSeat);
    if(!choice||choice.type!=='exchange')fail('DOG_BOT_EXCHANGE_FAILED');
    const prior=next;
    next=dogExchangeCard(prior,botSeat,choice.cardId,cardRng);
    if(prior.round!==next.round)newDeal(next.round);
   }else if(['play','seven','rescue'].includes(next.phase)&&
            next.players[next.current]?.bot){
    const actorSeat=next.current,choice=chooseBot(next,actorSeat);
    if(!choice)fail('DOG_BOT_MOVE_FAILED');
    const prior=next;
    next=dogTakeAction(prior,actorSeat,choice,cardRng);
    verifiedMove(prior,next,choice,actorSeat);
    if(prior.round!==next.round)newDeal(next.round);
   }else break;
  }
  if(guard>=300)fail('DOG_BOT_LOOP');
  match.dog=next;
  finishDogChristmasMatch(event,next);
 }catch(e){
  // Only a PG transaction may publish a successful result. Throwing this
  // exception leaves the caller's candidate uncommitted; no Firebase I/O.
  throw e;
 }
 const delta=Object.fromEntries(Object.keys(initial).map(key=>
  [key,event[key]-initial[key]]));
 if(Object.values(delta).some(x=>!Number.isSafeInteger(x)||x<0)||
    delta.scratchCount!==vouchers.length)
  fail('DOG_PG_SEASONAL_REWARD_MISMATCH');
 const finished=match.dog.phase==='finished';
 const rewardBearing=finished||delta.earnedTenths>0||
  delta.giftCount>0||delta.bonusGiftCount>0||vouchers.length>0;
 // Crucial migration gate: this module MUST NOT accidentally return a
 // payable move to the ordinary room commit path before its SQL pending
 // receipt and Firestore bridge have been installed.
 if(rewardBearing&&!allowUnsettledRewards)
  fail('DOG_PG_SEASONAL_REWARD_SETTLEMENT_REQUIRED');
 return {
  room,finished,rewardBearing,delta,
  vouchers,
  // Private durable SQL staging input: NEVER publish as a websocket payload.
  pendingRecord:rewardBearing?{
   roomCode:room.code,matchId,actionId,
   before,after:structuredClone(room),
   vouchers:structuredClone(vouchers)
  }:null
 };
}
