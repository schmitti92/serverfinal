'use strict';
import {randomInt} from 'node:crypto';
import {drawGift,HAMMER_PRICES,ICE_PICTURES,ICE_TILES,iceTileCount,nextIceTileCount} from './christmas-ice-prizes.js';
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
 return {...visible,star:s.finished?s.star:null,
  tilesRequired,tilesRemaining:Math.max(0,tilesRequired-(s.opened?.length||0)),
  requiresFullClear:false};
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
 // All pictures contain a hidden star. Recover older 23+ saves with no
 // star (or a now-invalid position) from unopened tiles on the first strike.
 // This avoids a separate Firestore write just to migrate the game board.
 const validStar=Number.isInteger(s.star)&&s.star>=0&&s.star<tilesRequired&&!s.opened.includes(s.star);
 const star=validStar?s.star:closed[random(closed.length)];
 const found=targets.includes(star)||s.opened.length+targets.length>=tilesRequired;
 const next={...s,tileCount:tilesRequired,star,balance:s.balance-price,opened:[...s.opened,...targets],
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
 return {...s,tileCount,star:random(tileCount),opened:[],finished:false,freeHammers:{...s.freeHammers}};
}

export function resetIceState(s,random=randomInt){
 const fresh=newIceState(random);
 const tileCount=ICE_TILES;
 return {...fresh,tileCount,star:fresh.star,wheelHammers:{...s.wheelHammers},goldenHammerGift2026:!!s.goldenHammerGift2026,picture30MonsterSpinsClaimed:!!s.picture30MonsterSpinsClaimed,maxRewarded:Math.max(s.maxRewarded||0,s.completed||0),peekJokers:s.peekJokers||0,freeHammers:{single:Math.max(0,s.freeHammers?.single||0),double:Math.max(0,s.freeHammers?.double||0),lucky:Math.max(0,s.freeHammers?.lucky||0)}};
}

// Old test builds gave 20 free strikes per picture. Discard those test grants
// while keeping separately recorded winner-wheel prizes and progress.
export function normalizeIceState(s){
 // Upgrade historical 20/25/30/50/100-tile saves to the current 50/100/150
 // board size while preserving opened tiles, receipts, prizes and inventory.
 // Missing or invalid stars are recovered from unopened tiles on the next strike.
 if(!s||typeof s!=='object')throw Error('INVALID_ICE_STATE');
 const tilesRequired=iceTileCount(s);
 // Some early player profiles predate the arrays introduced for the current
 // 70-picture event. Supply missing presentation fields without changing
 // any stored progress, hammer credits, opened tiles or awarded prizes.
 const optionalArray=(value,name)=>{
  if(value==null)return [];
  if(!Array.isArray(value))throw Error('INVALID_ICE_'+name);
  return value;
 };
 const clean={...s,tileCount:tilesRequired,
  opened:optionalArray(s.opened,'OPENED'),
  prizes:optionalArray(s.prizes,'PRIZES'),
  lastActions:optionalArray(s.lastActions,'RECEIPTS')};
 if((clean.version||1)>=2)return clean;
 const wheel=clean.wheelHammers||{};
 return {...clean,version:2,freeHammers:{single:Math.max(0,wheel.single||0),double:Math.max(0,wheel.double||0),lucky:Math.max(0,wheel.lucky||0)},wheelHammers:{single:Math.max(0,wheel.single||0),double:Math.max(0,wheel.double||0),lucky:Math.max(0,wheel.lucky||0)}};
}
