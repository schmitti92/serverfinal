/**
 * Shared rule contract for the three sequential Grinch campaign missions.
 * Included only from mission-specific modules, NEVER from classic DOG.
 *
 * At each mission's creation a distinct, hidden eligible-landing threshold
 * is selected for every human seat (2–7). A completed card landing on
 * an unprotected track field is eligible; start fields and story-safe
 * tiles are never traps. A rescue deadline prevents postponing the
 * required loss forever: the final survivor cannot enter the portal
 * before the missing figure has been captured.
 *
 * All choices come from the authoritative per-match seed. Do not
 * reveal a seat's threshold or eligible-landing progress online.
 */
export const GRINCH_LOSS_MISSIONS=Object.freeze({
  1:Object.freeze({starting:5,lostBefore:0,lossesThisMission:1,rescueTarget:4,missionAfter:2}),
  2:Object.freeze({starting:4,lostBefore:1,lossesThisMission:1,rescueTarget:3,missionAfter:3}),
  3:Object.freeze({starting:3,lostBefore:2,lossesThisMission:1,rescueTarget:2,missionAfter:4})
});
export const LOSS_TRIGGER_WINDOW=Object.freeze([2,3,4,5,6,7]);
export function randomLossThresholds(seed,mission,seatCount=3){
 if(!GRINCH_LOSS_MISSIONS[mission])throw Error('UNKNOWN_GRINCH_MISSION');
 if(!Number.isInteger(seatCount)||seatCount<1||seatCount>LOSS_TRIGGER_WINDOW.length)throw Error('INVALID_SEAT_COUNT');
 // Separate random stream: DOES NOT change the normal 110-card deck.
 let x=(((Number(seed)||1)>>>0)^Math.imul(mission,0x9e3779b1)^0x4a1d85f3)>>>0;
 const rng=()=>((x=(Math.imul(x,1664525)+1013904223)>>>0)/4294967296);
 const values=[...LOSS_TRIGGER_WINDOW];
 for(let i=values.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[values[i],values[j]]=[values[j],values[i]];}
 return values.slice(0,seatCount);
}
export function initLossMarkers(seed,mission,seatCount=3){
 return randomLossThresholds(seed,mission,seatCount).map(triggerAt=>({triggerAt,eligibleLandings:0}));
}
/**
 * Exactly one scripted loss per seat per mission. The rescue backstop can
 * trigger earlier than the randomized threshold, but never on protected land.
 * No fallback rolls artificial losses in unrelated card phases.
 * Legacy matches without markers remain playable and gain a pending capture.
 */
export function shouldCaptureAfterLanding(info,{seed,mission,seat,rescued,eligible=true}){
 if(!eligible)return false;
 const target=GRINCH_LOSS_MISSIONS[mission]?.rescueTarget;
 if(!target)throw Error('UNKNOWN_GRINCH_MISSION');
 const legacyThreshold=randomLossThresholds(seed,mission)[seat];
 if(!Number.isInteger(info.lossTriggerAt))info.lossTriggerAt=legacyThreshold;
 if(!Number.isInteger(info.lossEligibleLandings)){
  // Old live matches could already have completed moves without these markers.
  // Their next eligible landing should qualify for the scheduled loss.
  info.lossEligibleLandings=Math.max(0,info.lossTriggerAt-1);
 }
 info.lossEligibleLandings++;
 return info.lossEligibleLandings>=info.lossTriggerAt||rescued>=target-1;
}
export function validCampaignSurvivors(pieces,seat,mission){
 const spec=GRINCH_LOSS_MISSIONS[mission];
 if(!spec)throw Error('UNKNOWN_GRINCH_MISSION');
 const owned=pieces.filter(p=>p.seat===seat);
 const lost=owned.filter(p=>p.place==='lost').length;
 const rescued=owned.filter(p=>p.place==='teleported').length;
 const waiting=owned.filter(p=>p.place==='home'||p.place==='track').length;
 return owned.length===5&&lost===spec.lostBefore+spec.lossesThisMission&&
   rescued===spec.rescueTarget&&waiting===0;
}
