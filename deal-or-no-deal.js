'use strict';
import * as crypto from 'node:crypto';
const VALUES=[1,100,500,1000,2500,5000,7500,10000,20000,30000,40000,50000,75000,100000,500000,1000000,2500000,5000000,7500000,10000000,20000000,30000000,40000000,50000000,75000000,100000000,300000000];
const STEPS=[5,4,4,3,2,2,1,1],MULT=[.3,.4,.5,.6,.7,.8,.9,1];
const shuffle=(a,rand=crypto.randomInt)=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=rand(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};
const active=g=>g.players.filter(p=>p.deal===null);
const locked=g=>new Set(g.players.map(p=>p.case).filter(Number.isInteger));
const free=g=>Array.from({length:g.values.length},(_,i)=>i).filter(i=>!locked(g).has(i)&&!g.opened.includes(i));
const publicRemaining=g=>Array.from({length:g.values.length},(_,i)=>i).filter(i=>!g.opened.includes(i)).map(i=>g.values[i]);
function create(players,random=crypto.randomInt){
 if(!Array.isArray(players)||players.length<1||players.length>4)throw Error('PLAYER_COUNT');
 const ids=players.map(p=>String(p.id));if(new Set(ids).size!==ids.length)throw Error('DUPLICATE_PLAYER');
 return {id:crypto.randomUUID(),revision:0,phase:'select',players:players.map(p=>({id:String(p.id),name:String(p.name||'Spieler').slice(0,30),avatar:Number.isInteger(p.avatar)&&p.avatar>=1&&p.avatar<=14?p.avatar:null,case:null,deal:null})),values:shuffle(VALUES,random),order:shuffle(ids,random),selectionIndex:0,turnIndex:0,opened:[],round:0,roundOpened:0,offer:null,history:[],decisionIndex:0,pending:null,finalIndex:0,events:[],commands:[]};
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
  next.pending={case:command.case,actor:p.id,eventId:crypto.randomUUID()};next.phase='reveal';
 }else if(next.phase==='reveal'){
  if(command.type!=='ack-reveal'||next.pending?.actor!==p.id)throw Error('INVALID_REVEAL_ACK');
  next.opened.push(next.pending.case);next.roundOpened++;
  next.events.push({type:'opened',case:next.pending.case,amount:next.values[next.pending.case],playerId:p.id,eventId:next.pending.eventId});
  next.turnIndex=(next.order.indexOf(p.id)+1)%next.order.length;next.pending=null;
  if(next.roundOpened>=(STEPS[next.round]||1)||free(next).length===0)offer(next,random);else next.phase='open';
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
 // 8% of rounds: a surprising, especially tempting banker offer.
 const generous=random(1000)<80;
 if(generous)factor+=.06+.04*roll();
 // Late offers can exceed expected value slightly; the bonus is bounded.
 factor=Math.max(.15,Math.min(1.15,factor));
 g.offer=Math.max(1,Math.round(avg*factor));
 const bonusRoll=random(1000);
 const bonusPack=bonusRoll<100?(bonusRoll<10?'premium':bonusRoll<60?'large':'small'):null;
 // Independent 10% chance for an extra hammer; draw the type from the actual 12-field wheel.
 const bonusHammer=random(10)===0?drawHammerFromTwelve(random):null;
 g.history.push({round:g.round+1,offer:g.offer,expectedValue:avg,bonusPack,bonusHammer,participants:active(g).map(p=>p.id),decisions:[]});
 g.phase='decision';
}
function publicView(g){const {values,commands,...pub}=g;const pending=g.phase==='decision'?g.history.at(-1):null;const hidden=new Set((pending?.decisions||[]).filter(d=>d.deal).map(d=>d.id));return {...pub,caseCount:g.values.length,history:g.history.map((h,i)=>pending&&i===g.history.length-1?{...h,decisions:h.decisions.map(d=>({id:d.id}))}:h),events:g.events.map(e=>({...e})),players:g.players.map(p=>({...p,deal:hidden.has(p.id)?null:p.deal})),openedAmounts:g.opened.map(i=>({case:i,amount:g.values[i],playerId:g.events.find(e=>e.type==='opened'&&e.case===i)?.playerId??null})),pending:g.pending?{case:g.pending.case,actor:g.pending.actor,eventId:g.pending.eventId}:null,finalValues:g.phase==='final'||g.phase==='done'?g.players.map(p=>({id:p.id,case:p.case,amount:g.values[p.case],payout:p.deal??g.values[p.case]})):null};}
export {drawHammerFromTwelve,VALUES,STEPS,MULT,create,apply,publicView,free,active,publicRemaining,nextTurn};
