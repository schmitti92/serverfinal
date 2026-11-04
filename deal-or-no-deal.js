'use strict';
import * as crypto from 'node:crypto';
const VALUES=[1,100,500,1000,2500,5000,7500,10000,20000,30000,40000,50000,75000,100000,500000,1000000,2500000,5000000,7500000,10000000,20000000,30000000,40000000,50000000,75000000,100000000];
const STEPS=[5,4,4,3,2,2,1,1],MULT=[.3,.4,.5,.6,.7,.8,.9,1];
const shuffle=(a,rand=crypto.randomInt)=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=rand(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};
const active=g=>g.players.filter(p=>p.deal===null);
const locked=g=>new Set(g.players.map(p=>p.case).filter(Number.isInteger));
const free=g=>Array.from({length:26},(_,i)=>i).filter(i=>!locked(g).has(i)&&!g.opened.includes(i));
const publicRemaining=g=>Array.from({length:26},(_,i)=>i).filter(i=>!g.opened.includes(i)).map(i=>g.values[i]);
function create(players,random=crypto.randomInt){
 if(!Array.isArray(players)||players.length<1||players.length>4)throw Error('PLAYER_COUNT');
 const ids=players.map(p=>String(p.id));if(new Set(ids).size!==ids.length)throw Error('DUPLICATE_PLAYER');
 return {id:crypto.randomUUID(),revision:0,phase:'select',players:players.map(p=>({id:String(p.id),name:String(p.name||'Spieler').slice(0,30),case:null,deal:null})),values:shuffle(VALUES,random),order:shuffle(ids,random),selectionIndex:0,turnIndex:0,opened:[],round:0,roundOpened:0,offer:null,history:[],decisionIndex:0,pending:null,finalIndex:0,events:[],commands:[]};
}
function nextTurn(g){for(let i=0;i<g.order.length;i++){const id=g.order[(g.turnIndex+i)%g.order.length];if(g.players.some(p=>p.id===id&&p.deal===null))return id}return null}
function apply(g,actor,command,random=crypto.randomInt){
 if(!g||!command||typeof command.id!=='string'||command.id.length>100)throw Error('COMMAND_ID_REQUIRED');
 if(g.commands.includes(command.id))return g;
 if(command.revision!==g.revision)throw Error('STALE_REVISION');
 const next=structuredClone(g),p=next.players.find(p=>p.id===String(actor));if(!p)throw Error('NOT_PARTICIPANT');
 if(next.phase==='select'){
  if(command.type!=='select'||next.order[next.selectionIndex]!==p.id||!Number.isInteger(command.case)||command.case<0||command.case>=26||locked(next).has(command.case))throw Error('INVALID_SELECTION');
  p.case=command.case;next.selectionIndex++;if(next.selectionIndex===next.players.length)next.phase='open';
 }else if(next.phase==='open'){
  if(command.type!=='open'||nextTurn(next)!==p.id||!free(next).includes(command.case))throw Error('INVALID_OPEN');
  next.pending={case:command.case,actor:p.id,eventId:crypto.randomUUID()};next.phase='reveal';
 }else if(next.phase==='reveal'){
  if(command.type!=='ack-reveal'||next.pending?.actor!==p.id)throw Error('INVALID_REVEAL_ACK');
  next.opened.push(next.pending.case);next.roundOpened++;
  next.events.push({type:'opened',case:next.pending.case,amount:next.values[next.pending.case],eventId:next.pending.eventId});
  next.turnIndex=(next.order.indexOf(p.id)+1)%next.order.length;next.pending=null;
  if(next.roundOpened>=(STEPS[next.round]||1)||free(next).length===0)offer(next,random);else next.phase='open';
 }else if(next.phase==='decision'){
  const current=active(next).filter(p=>!next.history[next.history.length-1].decisions.some(d=>d.id===p.id))[0];
  if(!current||current.id!==p.id||command.type!=='decide'||typeof command.deal!=='boolean')throw Error('INVALID_DECISION');
  next.history[next.history.length-1].decisions.push({id:p.id,deal:command.deal});
  if(command.deal)p.deal=next.offer;
  if(next.history[next.history.length-1].decisions.length===next.history[next.history.length-1].participants.length){
   if(!active(next).length||!free(next).length)next.phase='final';else{next.round++;next.roundOpened=0;next.phase='open';}
  }
 }else throw Error('INVALID_PHASE');
 next.revision++;next.commands.push(command.id);if(next.commands.length>300)next.commands.shift();return next;
}
function offer(g,random){
 const remaining=publicRemaining(g),avg=remaining.reduce((a,b)=>a+b,0)/remaining.length;
 const multiplier=MULT[Math.min(g.round,7)];
 const variance=(random(10001)/10000-.5)*.1;
 g.offer=Math.max(0,Math.round(avg*multiplier*(1+variance)));
 g.history.push({round:g.round+1,offer:g.offer,participants:active(g).map(p=>p.id),decisions:[]});
 g.phase='decision';
}
function publicView(g){const {values,commands,...pub}=g;return {...pub,events:g.events.map(e=>({...e})),players:g.players.map(p=>({...p})),openedAmounts:g.opened.map(i=>({case:i,amount:g.values[i]})),pending:g.pending?{case:g.pending.case,actor:g.pending.actor,eventId:g.pending.eventId}:null,finalValues:g.phase==='final'||g.phase==='done'?g.players.map(p=>({id:p.id,case:p.case,amount:g.values[p.case],payout:p.deal??g.values[p.case]})):null};}
export {VALUES,STEPS,MULT,create,apply,publicView,free,active,publicRemaining,nextTurn};
