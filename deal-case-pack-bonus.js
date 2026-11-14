'use strict';

// Deal values are stored in CENTS, not euros.
// Keep the established 1-cent award and add the 50,000,000 EUR suitcase.
// Both are normal suitcase-opening rewards (never a banker offer or final payout).
export const ONE_CENT_CASE=1;
export const FIFTY_MILLION_CASE=5_000_000_000;

export const isCasePackBonusAmount=amount=>
 amount===ONE_CENT_CASE||amount===FIFTY_MILLION_CASE;

// The server's game engine emits one immutable eventId per opened suitcase.
// Only newly confirmed events from the current reveal acknowledgement qualify.
export function newCasePackBonusEvents(before,after,command){
 const type=command?.type;
 if(type!=='ack-reveal'&&type!=='ack-batch')return [];
 if(type==='ack-reveal'&&before?.phase!=='reveal')return [];
 if(type==='ack-batch'&&before?.phase!=='batch-reveal')return [];
 const prior=new Set((before?.events||[]).map(e=>e.eventId));
 return (after?.events||[]).filter(event=>
  event?.type==='opened'&&isCasePackBonusAmount(event.amount)&&
  !!event.eventId&&!prior.has(event.eventId)&&
  (type==='ack-batch'||before.pending?.eventId===event.eventId));
}

// Use the SAME 40% normal / 50% gold / 10% premium odds as the
// existing 1-cent rule. Random draw happens exactly once in the game
// transaction; receiving clients do not draw or credit anything.
export function drawCasePackBonus(randomInt){
 const roll=randomInt(100);
 if(!Number.isInteger(roll)||roll<0||roll>=100)throw Error('INVALID_CASE_BONUS_ROLL');
 return roll<10?'premium':roll<60?'large':'small';
}
