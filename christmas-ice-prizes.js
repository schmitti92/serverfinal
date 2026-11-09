'use strict';
import {randomInt} from 'node:crypto';
// Pure authoritative prize rules for Weihnachtsevent 2.
// This module NEVER accepts a client-supplied prize or issues credits.
// It is not yet wired to HTTP until server-validated progress is implemented.
export const ICE_PICTURES=70;
export const ICE_TILES=20;
export const ICE_TILES_AFTER_TEN=25;
export const ICE_TILES_AFTER_TWENTY=30;
export const ICE_FULL_CLEAR_MILESTONE=10;
export const ICE_THIRTY_TILE_MILESTONE=20;
// Pictures 1–22 have a hidden star; from picture 23 every ice tile must be cleared.
export const ICE_NO_STAR_FROM_PICTURE=23;

// A new difficulty level applies to the NEXT picture after each milestone:
// 1–10: 20 tiles; 11–20: 25; 21–70: 30. The completed milestone image
// retains its own grid for its reveal, and resets keep the hardest earned grid.
export function iceTileCount(state){
 const completed=Number(state?.completed)||0;
 const rewarded=Number(state?.maxRewarded)||0;
 const stored=Number(state?.tileCount);
 const persisted=[ICE_TILES,ICE_TILES_AFTER_TEN,ICE_TILES_AFTER_TWENTY].includes(stored)?stored:0;
 const reachedThirty=completed>ICE_THIRTY_TILE_MILESTONE
  ||(completed===ICE_THIRTY_TILE_MILESTONE&&!state?.finished);
 const reachedTwentyFive=completed>ICE_FULL_CLEAR_MILESTONE
  ||(completed===ICE_FULL_CLEAR_MILESTONE&&!state?.finished);
 const minimum=reachedThirty?ICE_TILES_AFTER_TWENTY
  :reachedTwentyFive?ICE_TILES_AFTER_TEN:ICE_TILES;
 // Do not change the just-finished 10th/20th picture while it is on screen.
 if(state?.finished&&[ICE_FULL_CLEAR_MILESTONE,ICE_THIRTY_TILE_MILESTONE].includes(completed)){
  return Math.max(persisted,completed===ICE_THIRTY_TILE_MILESTONE?ICE_TILES_AFTER_TEN:ICE_TILES);
 }
 const earned=rewarded>=ICE_THIRTY_TILE_MILESTONE?ICE_TILES_AFTER_TWENTY
  :rewarded>=ICE_FULL_CLEAR_MILESTONE?ICE_TILES_AFTER_TEN:ICE_TILES;
 return Math.max(minimum,persisted,earned);
}
export function nextIceTileCount(state){
 const reached=Math.max(Number(state?.completed)||0,Number(state?.maxRewarded)||0);
 return reached>=ICE_THIRTY_TILE_MILESTONE?ICE_TILES_AFTER_TWENTY
  :reached>=ICE_FULL_CLEAR_MILESTONE?ICE_TILES_AFTER_TEN:ICE_TILES;
}
export const HAMMER_PRICES=Object.freeze({single:30000000,double:50000000,lucky:100000000});
export const MONEY_PRIZES=Object.freeze([100,500,1000,2500,5000,10000,25000,50000,100000,200000,350000,500000,750000,1000000,1500000,2000000]);
export function giftKind(number){
 if(!Number.isInteger(number)||number<1||number>ICE_PICTURES)throw Error('INVALID_PICTURE');
 return number%3===0?'joker':'money';
}
export function drawHammer(random=randomInt){
 const roll=random(100);
 if(!Number.isInteger(roll)||roll<0||roll>=100)throw Error('INVALID_RANDOM');
 return roll<50?'single':roll<85?'double':'lucky';
}
export function drawMoney(random=randomInt){
 const index=random(MONEY_PRIZES.length);
 if(!Number.isInteger(index)||index<0||index>=MONEY_PRIZES.length)throw Error('INVALID_RANDOM');
 return MONEY_PRIZES[index]*100;
}
export function drawGift(number,random=randomInt){
 const kind=giftKind(number);
 if(kind==='money')return {kind,number,amount:drawMoney(random)};
 if(kind==='hammer')return {kind,number,hammer:drawHammer(random)};
 return {kind,number,peekJokers:1};
}
