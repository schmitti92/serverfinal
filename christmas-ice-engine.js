'use strict';
import {randomInt} from 'node:crypto';
import {drawGift,HAMMER_PRICES,ICE_PICTURES,ICE_TILES,ICE_TILES_AFTER_TEN,ICE_NO_STAR_FROM_PICTURE,iceTileCount,nextIceTileCount} from './christmas-ice-prizes.js';
// Pure reducer. One state document per player; no reads during animation.
// The star position never goes to a public response until it has been found.
export function newIceState(random=randomInt){
 return {version:2,completed:0,balance:0,tileCount:ICE_TILES,star:random(ICE_TILES),
  opened:[],freeHammers:{single:0,double:0,lucky:0},wheelHammers:{single:0,double:0,lucky:0},peekJokers:0,
  finished:false,prizes:[],maxRewarded:0,lastActions:[]};
}
export function publicIceState(s){
 const {star,lastActions,...visible}=s;
 const tilesRequired=iceTileCount(s);
 return {...visible,star:s.finished&&Number(s.completed)<ICE_NO_STAR_FROM_PICTURE?s.star:null,
  tilesRequired,tilesRemaining:Math.max(0,tilesRequired-(s.opened?.length||0)),
  requiresFullClear:tilesRequired===ICE_TILES_AFTER_TEN};
}
export function strikeIce(s,{index,hammer,requestId},random=randomInt){
 if(!/^[A-Za-z0-9_-]{12,90}$/.test(String(requestId||'')))throw Error('INVALID_REQUEST_ID');
 const prior=s.lastActions?.find(a=>a.id===requestId);
 if(prior)return {state:s,result:{...prior.result,replayed:true},changed:false};
 if(s.completed>=ICE_PICTURES||s.finished)throw Error('PICTURE_FINISHED');
 const tilesRequired=iceTileCount(s);
 if(!Number.isInteger(index)||index<0||index>=tilesRequired||s.opened.includes(index))throw Error('INVALID_TILE');
 if(!Object.hasOwn(HAMMER_PRICES,hammer))throw Error('INVALID_HAMMER');
 const free=(s.freeHammers?.[hammer]||0)>0;
 const price=free?0:HAMMER_PRICES[hammer];
 if(s.balance<price)throw Error('INSUFFICIENT_BALANCE');
 const closed=Array.from({length:tilesRequired},(_,i)=>i).filter(i=>!s.opened.includes(i));
 const count=Math.min(closed.length,hammer==='single'?1:hammer==='double'?2:3+random(4));
 const targets=[index],remaining=closed.filter(i=>i!==index);
 while(targets.length<count){const j=random(remaining.length);targets.push(remaining.splice(j,1)[0])}
 // Pictures 1–10: a star can finish early. Pictures 11–14: full-clear,
 // and from picture 15 onwards the star is entirely absent.
 // The server, never the browser, determines when all ice has been removed.
 const noStar=Number(s.completed)+1>=ICE_NO_STAR_FROM_PICTURE;
 const found=noStar||tilesRequired===ICE_TILES_AFTER_TEN
  ?s.opened.length+targets.length>=tilesRequired
  :targets.includes(s.star);
 const next={...s,tileCount:tilesRequired,star:noStar?null:s.star,balance:s.balance-price,opened:[...s.opened,...targets],
  freeHammers:{...s.freeHammers},wheelHammers:{...s.wheelHammers},prizes:[...s.prizes],lastActions:[...(s.lastActions||[])]};
 if(free){next.freeHammers[hammer]--;if((next.wheelHammers?.[hammer]||0)>0)next.wheelHammers={...next.wheelHammers,[hammer]:next.wheelHammers[hammer]-1};}
 let gift=null;
 if(found){
  const number=s.completed+1;
  gift=number>(s.maxRewarded||0)?drawGift(number,random):null;
  next.maxRewarded=Math.max(s.maxRewarded||0,number);
  next.completed=number;
  next.finished=true;
  if(gift)next.prizes.push(gift);
  if(gift?.kind==='money')next.balance+=gift.amount;
  if(gift?.kind==='hammer')next.freeHammers[gift.hammer]++;
  if(gift?.kind==='joker')next.peekJokers++;
 }
 const result={targets,found,gift,completed:next.completed,balance:next.balance};
 next.lastActions.push({id:requestId,result});
 next.lastActions=next.lastActions.slice(-32);
 return {state:next,result,changed:true};
}
export function nextIcePicture(s,random=randomInt){
 if(!s.finished||s.completed>=ICE_PICTURES)throw Error('PICTURE_NOT_READY');
 const tileCount=nextIceTileCount(s);
 return {...s,tileCount,star:Number(s.completed)+1>=ICE_NO_STAR_FROM_PICTURE?null:random(tileCount),opened:[],finished:false,freeHammers:{...s.freeHammers}};
}

export function resetIceState(s,random=randomInt){
 const fresh=newIceState(random);
 const tileCount=nextIceTileCount(s);
 return {...fresh,tileCount,star:tileCount===ICE_TILES?fresh.star:random(tileCount),wheelHammers:{...s.wheelHammers},goldenHammerGift2026:!!s.goldenHammerGift2026,maxRewarded:Math.max(s.maxRewarded||0,s.completed||0),peekJokers:s.peekJokers||0,freeHammers:{single:Math.max(0,s.freeHammers?.single||0),double:Math.max(0,s.freeHammers?.double||0),lucky:Math.max(0,s.freeHammers?.lucky||0)}};
}

// Old test builds gave 20 free strikes per picture. Discard those test grants
// while keeping separately recorded winner-wheel prizes and progress.
export function normalizeIceState(s){
 // Sanitize old persisted sessions at and after picture 15 without
 // resetting progress, replay receipts, inventory, or already-paid rewards.
 const noStar=Number(s.completed)>=ICE_NO_STAR_FROM_PICTURE
  ||(Number(s.completed)+1>=ICE_NO_STAR_FROM_PICTURE&&!s.finished);
 const clean=noStar?{...s,star:null,tileCount:ICE_TILES_AFTER_TEN}:s;
 if((clean.version||1)>=2)return clean;
 const wheel=clean.wheelHammers||{};
 return {...clean,version:2,freeHammers:{single:Math.max(0,wheel.single||0),double:Math.max(0,wheel.double||0),lucky:Math.max(0,wheel.lucky||0)},wheelHammers:{single:Math.max(0,wheel.single||0),double:Math.max(0,wheel.double||0),lucky:Math.max(0,wheel.lucky||0)}};
}
