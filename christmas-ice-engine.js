'use strict';
import {randomInt} from 'node:crypto';
import {drawGift,HAMMER_PRICES,ICE_PICTURES,ICE_TILES} from './christmas-ice-prizes.js';
// Pure reducer. One state document per player; no reads during animation.
// The star position never goes to a public response until it has been found.
export function newIceState(random=randomInt){
 return {version:1,completed:0,balance:12450000,star:random(ICE_TILES),
  opened:[],freeHammers:{single:0,double:0,lucky:0},peekJokers:0,
  finished:false,prizes:[],lastActions:[]};
}
export function publicIceState(s){
 const {star,lastActions,...visible}=s;
 return {...visible,star:s.finished?s.star:null};
}
export function strikeIce(s,{index,hammer,requestId},random=randomInt){
 if(!/^[A-Za-z0-9_-]{12,90}$/.test(String(requestId||'')))throw Error('INVALID_REQUEST_ID');
 const prior=s.lastActions?.find(a=>a.id===requestId);
 if(prior)return {state:s,result:{...prior.result,replayed:true},changed:false};
 if(s.completed>=ICE_PICTURES||s.finished)throw Error('PICTURE_FINISHED');
 if(!Number.isInteger(index)||index<0||index>=ICE_TILES||s.opened.includes(index))throw Error('INVALID_TILE');
 if(!Object.hasOwn(HAMMER_PRICES,hammer))throw Error('INVALID_HAMMER');
 const free=(s.freeHammers?.[hammer]||0)>0;
 const price=free?0:HAMMER_PRICES[hammer];
 if(s.balance<price)throw Error('INSUFFICIENT_BALANCE');
 const closed=Array.from({length:ICE_TILES},(_,i)=>i).filter(i=>!s.opened.includes(i));
 const count=Math.min(closed.length,hammer==='single'?1:hammer==='double'?2:3+random(4));
 const targets=[index],remaining=closed.filter(i=>i!==index);
 while(targets.length<count){const j=random(remaining.length);targets.push(remaining.splice(j,1)[0])}
 const found=targets.includes(s.star);
 const next={...s,balance:s.balance-price,opened:[...s.opened,...targets],
  freeHammers:{...s.freeHammers},prizes:[...s.prizes],lastActions:[...(s.lastActions||[])]};
 if(free)next.freeHammers[hammer]--;
 let gift=null;
 if(found){
  const number=s.completed+1;
  gift=drawGift(number,random);
  next.completed=number;
  next.finished=true;
  next.prizes.push(gift);
  if(gift.kind==='money')next.balance+=gift.amount;
  if(gift.kind==='hammer')next.freeHammers[gift.hammer]++;
  if(gift.kind==='joker')next.peekJokers++;
 }
 const result={targets,found,gift,completed:next.completed,balance:next.balance};
 next.lastActions.push({id:requestId,result});
 next.lastActions=next.lastActions.slice(-32);
 return {state:next,result,changed:true};
}
export function nextIcePicture(s,random=randomInt){
 if(!s.finished||s.completed>=ICE_PICTURES)throw Error('PICTURE_NOT_READY');
 return {...s,star:random(ICE_TILES),opened:[],finished:false};
}
