'use strict';
import * as crypto from 'node:crypto';
const VALUES=[1,100,500,1000,2500,5000,7500,10000,20000,30000,40000,50000,75000,100000,500000,1000000,2500000,5000000,7500000,10000000,20000000,30000000,40000000,50000000,75000000,100000000,300000000,500000000,1000000000,5000000000];
// Legacy schedules are frozen to preserve already running games.
const STEPS=[5,4,4,3,2,2,1,1],STEPS_29=[6,5,5,4,3,2,2,1],
 STEPS_30=[6,5,5,4,3,3,2,1],MULT=[.3,.4,.5,.6,.7,.8,.9,1];
// Five equally likely 30-case cadences, expressed as TOTAL opened cases when
// the Banker calls. These milestones are exact for a three-player match,
// which has 27 openable cases. No unscheduled calls after the final milestone.
const BANKER_30_OPENINGS=Object.freeze([
 Object.freeze([7,15,21,24,27]),
 Object.freeze([7,13,16,19,25,26]),
 Object.freeze([10,15,20,25,27]),
 Object.freeze([7,16,19,25,27]),
 Object.freeze([8,14,19,22,24,26])
]);
const openingToSteps=targets=>targets.map((count,i)=>count-(i?targets[i-1]:0));
function pick30BankerSchedule(random=crypto.randomInt){
 const index=random(BANKER_30_OPENINGS.length);
 if(!Number.isInteger(index)||index<0||index>=BANKER_30_OPENINGS.length)throw Error('INVALID_BANKER_VARIANT_ROLL');
 return {variant:index+1,steps:openingToSteps(BANKER_30_OPENINGS[index])};
}
// Every new game has its own banker personality; old games default to balanced.
const BANKER_STYLES=Object.freeze({stingy:{offset:-.12,spread:.06},balanced:{offset:0,spread:.06},generous:{offset:.15,spread:.08},volatile:{offset:0,spread:.17}});
function pickBankerStyle(random=crypto.randomInt){
 const roll=random(100);
 if(!Number.isInteger(roll)||roll<0||roll>=100)throw Error('INVALID_BANKER_STYLE_ROLL');
 return roll<25?'stingy':roll<60?'balanced':roll<85?'generous':'volatile';
}
const shuffle=(a,rand=crypto.randomInt)=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=rand(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};
const active=g=>g.players.filter(p=>p.deal===null);
const locked=g=>new Set(g.players.map(p=>p.case).filter(Number.isInteger));
const free=g=>Array.from({length:g.values.length},(_,i)=>i).filter(i=>!locked(g).has(i)&&!g.opened.includes(i));
const publicRemaining=g=>Array.from({length:g.values.length},(_,i)=>i).filter(i=>!g.opened.includes(i)).map(i=>g.values[i]);
function create(players,random=crypto.randomInt,caseCount=27){
 if(![26,27,28,29,30].includes(caseCount))throw Error('INVALID_CASE_COUNT');
 if(!Array.isArray(players)||players.length<1||players.length>4)throw Error('PLAYER_COUNT');
 const ids=players.map(p=>String(p.id));if(new Set(ids).size!==ids.length)throw Error('DUPLICATE_PLAYER');
 const values=shuffle(VALUES.slice(0,caseCount),random),order=shuffle(ids,random);
 // Draw ONCE when creating the game, then persist the chosen cadence.
 // Existing games keep their saved schedule and are never rerolled.
 const thirty=caseCount===30?pick30BankerSchedule(random):null;
 const bankerStyle=pickBankerStyle(random);
 return {id:crypto.randomUUID(),revision:0,phase:'select',players:players.map(p=>({id:String(p.id),name:String(p.name||'Spieler').slice(0,30),avatar:Number.isInteger(p.avatar)&&p.avatar>=1&&p.avatar<=15?p.avatar:null,case:null,deal:null,doublePayout:false})),values,order,selectionIndex:0,turnIndex:0,opened:[],round:0,roundOpened:0,bankerStyle,bankerSchedule:thirty?thirty.steps:caseCount===29?[...STEPS_29]:null,...(thirty?{bankerScheduleVariant:thirty.variant}:{}),offer:null,history:[],decisionIndex:0,pending:null,finalIndex:0,events:[],commands:[]};
}
function nextTurn(g){for(let i=0;i<g.order.length;i++){const id=g.order[(g.turnIndex+i)%g.order.length];if(g.players.some(p=>p.id===id&&p.deal===null))return id}return null}
function apply(g,actor,command,random=crypto.randomInt){
 if(!g||!command||typeof command.id!=='string'||command.id.length>100)throw Error('COMMAND_ID_REQUIRED');
 if(g.commands.includes(command.id))return g;
 // Independent banker votes may arrive against the same revision; Firestore transaction serializes them.
 if(command.revision!==g.revision&&!(g.phase==='decision'&&command.type==='decide'))throw Error('STALE_REVISION');
 const next=structuredClone(g),p=next.players.find(p=>p.id===String(actor));if(!p)throw Error('NOT_PARTICIPANT');
 if(next.phase==='select'){
  if(command.type!=='select'||next.order[next.selectionIndex]!==p.id||!Number.isInteger(command.case)||command.case<0||command.case>=next.values.length||locked(next).has(command.case))throw Error('INVALID_SELECTION');
  p.case=command.case;next.selectionIndex++;if(next.selectionIndex===next.players.length)next.phase='open';
 }else if(next.phase==='open'){
  if(command.type!=='open'||nextTurn(next)!==p.id||!free(next).includes(command.case))throw Error('INVALID_OPEN');
  // One authoritative reveal clock for ALL players; the future start gives
  // spectators a short network buffer before the briefcase animation begins.
  // Existing games remain compatible because startedAt is optional.
  next.pending={case:command.case,actor:p.id,eventId:crypto.randomUUID(),startedAt:Date.now()+350};next.phase='reveal';
 }else if(next.phase==='reveal'){
  if(command.type!=='ack-reveal'||next.pending?.actor!==p.id)throw Error('INVALID_REVEAL_ACK');
  next.opened.push(next.pending.case);next.roundOpened++;
  next.events.push({type:'opened',case:next.pending.case,amount:next.values[next.pending.case],playerId:p.id,eventId:next.pending.eventId});
  next.turnIndex=(next.order.indexOf(p.id)+1)%next.order.length;next.pending=null;
  // Server-saved schedules are authoritative. Only NEW 30-case variants
  // have a fixed final offer: after it, remaining cases open without another
  // phone call. Old running matches retain their original fallback cadence.
  const steps=Array.isArray(next.bankerSchedule)?next.bankerSchedule:STEPS;
  if(next.bankerScheduleVariant){
   const scheduled=steps[next.round];
   if(Number.isInteger(scheduled)&&next.roundOpened>=scheduled)offer(next,random);
   else next.phase=free(next).length===0?'final':'open';
  }else if(next.roundOpened>=(steps[next.round]||1)||free(next).length===0)offer(next,random);
  else next.phase='open';
 }else if(next.phase==='decision'){
  const ballot=next.history[next.history.length-1];
  if(command.type!=='decide'||typeof command.deal!=='boolean'||!ballot.participants.includes(p.id)||ballot.decisions.some(d=>d.id===p.id))throw Error('INVALID_DECISION');
  next.history[next.history.length-1].decisions.push({id:p.id,deal:command.deal});
  if(command.deal)p.deal=next.offer;
  if(next.history[next.history.length-1].decisions.length===next.history[next.history.length-1].participants.length){
   if(!active(next).length||!free(next).length)next.phase='final';else{next.round++;next.roundOpened=0;next.phase='open';}
  }
 }else throw Error('INVALID_PHASE');
 if(g.phase!=='final'&&next.phase==='final')next.finalStartedAt=Date.now();
 next.revision++;next.commands.push(command.id);if(next.commands.length>300)next.commands.shift();return next;
}
function drawHammerFromTwelve(random=crypto.randomInt){
 const sector=random(12); // 5 single, 5 double, 2 lucky; each sector has probability 1/12.
 return sector<5?'single':sector<10?'double':'lucky';
}
// This single 0–99 roll makes the rare special mutually exclusive.
export const BANKER_SPECIAL_ODDS=Object.freeze({minigame:3,monster:3});
export const BANKER_REWARD_ODDS=Object.freeze({pack:7,hammer:7});
function drawBankerPack(random=crypto.randomInt){
 const roll=random(1000);
 if(!Number.isInteger(roll)||roll<0||roll>=1000)throw Error('INVALID_BANKER_PACK_ROLL');
 return roll<7?'premium':roll<35?'large':roll<70?'small':null;
}
function drawBankerHammer(random=crypto.randomInt){
 const roll=random(100);
 if(!Number.isInteger(roll)||roll<0||roll>=100)throw Error('INVALID_BANKER_HAMMER_ROLL');
 return roll<BANKER_REWARD_ODDS.hammer?drawHammerFromTwelve(random):null;
}
export function drawBankerSpecial(random=crypto.randomInt){
 const roll=random(100);
 if(!Number.isInteger(roll)||roll<0||roll>=100)throw Error('INVALID_BANKER_SPECIAL_ROLL');
 return roll<3?'minigame':roll<6?'monster':null;
}
function offer(g,random){
 const remaining=publicRemaining(g);
 const avg=remaining.reduce((a,b)=>a+b,0)/remaining.length;
 const sorted=[...remaining].sort((a,b)=>a-b);
 const median=sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
 const concentration=avg>0?Math.max(0,Math.min(1,(avg-median)/avg)):0;
 // Progressively more tempting offers, based on the actual remaining expected value.
 const ranges=[[.35,.48],[.43,.57],[.52,.67],[.61,.76],[.70,.84],[.78,.92],[.85,.98],[.90,1.05]];
 const index=Math.min(g.round,ranges.length-1);
 const [low,high]=ranges[index];
 const progress=Math.min(1,g.round/7);
 const roll=()=>random(10001)/10000;
 let factor=low+(high-low)*roll();
 // When the board is dominated by one jackpot, the banker prices its volatility.
 // The discount fades as the final offers approach.
 factor-=concentration*.035*(1-progress);
 const previousAvg=g.history.at(-1)?.expectedValue;
 const trend=previousAvg>0?Math.max(-1,Math.min(1,avg/previousAvg-1)):0;
 factor+=Math.max(-.02,Math.min(.02,trend*.04));
 // Losing the one-cent case is a good moment for a small, not unrealistic, boost.
 const lastOpened=g.events?.filter(e=>e.type==='opened').at(-1);
 if(lastOpened?.amount===1)factor+=.025;
 // Persist a personality for the match while varying offers from call to call.
 // Different matches can be stingy, balanced, generous or highly unpredictable.
 const style=BANKER_STYLES[g.bankerStyle]||BANKER_STYLES.balanced;
 factor+=style.offset+(roll()*2-1)*style.spread;
 // Rare unexpected good or poor offers keep even a familiar banker unpredictable.
 if(random(100)<12)factor+=(roll()*2-1)*.125;
 // Fair expected value remains the anchor: cap extreme luck and large jackpots.
 factor=Math.max(.18,Math.min(1.25,factor));
 g.offer=Math.max(1,Math.round(avg*factor));
 const bonusPack=drawBankerPack(random);
 // Independent 7% hammer chance; the type still comes from the 12-field wheel.
 const bonusHammer=drawBankerHammer(random);
 // The exclusive bonuses are each 3%: Hats voucher or Monster Wheel spin.
 // Rewards are separately drawn and remain server-authoritative.
 const bonusSpecial=drawBankerSpecial(random);
 g.history.push({round:g.round+1,offer:g.offer,expectedValue:avg,bonusPack,bonusHammer,bonusSpecial,participants:active(g).map(p=>p.id),decisions:[]});
 g.phase='decision';
}
function payoutFor(g,p){const amount=p.deal??g.values[p.case];const payout=amount*(p.doublePayout===true?2:1);if(!Number.isSafeInteger(payout)||payout<0)throw Error('INVALID_PAYOUT');return payout}
function publicView(g){const {values,commands,bankerStyle,...pub}=g;const pending=g.phase==='decision'?g.history.at(-1):null;const hidden=new Set((pending?.decisions||[]).filter(d=>d.deal).map(d=>d.id));return {...pub,caseCount:g.values.length,history:g.history.map((h,i)=>pending&&i===g.history.length-1?{...h,decisions:h.decisions.map(d=>({id:d.id}))}:h),events:g.events.map(e=>({...e})),players:g.players.map(p=>({...p,deal:hidden.has(p.id)?null:p.deal})),openedAmounts:g.opened.map(i=>({case:i,amount:g.values[i],playerId:g.events.find(e=>e.type==='opened'&&e.case===i)?.playerId??null})),pending:g.pending?{case:g.pending.case,actor:g.pending.actor,eventId:g.pending.eventId,...(Number.isFinite(g.pending.startedAt)?{startedAt:g.pending.startedAt}:{})}:null,finalValues:g.phase==='final'||g.phase==='done'?g.players.map(p=>({id:p.id,case:p.case,amount:g.values[p.case],payout:payoutFor(g,p)})):null};}
export {drawHammerFromTwelve,drawBankerPack,drawBankerHammer,pickBankerStyle,VALUES,STEPS,STEPS_29,STEPS_30,BANKER_30_OPENINGS,pick30BankerSchedule,MULT,create,apply,publicView,payoutFor,free,active,publicRemaining,nextTurn};
