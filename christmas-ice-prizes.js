'use strict';
import {randomInt} from 'node:crypto';
// Pure authoritative prize rules for Weihnachtsevent 2.
// This module NEVER accepts a client-supplied prize or issues credits.
// It is not yet wired to HTTP until server-validated progress is implemented.
export const ICE_PICTURES=70;
export const ICE_TILES=50;
export const ICE_TILES_FROM_PICTURE_30=100;
export const ICE_HUNDRED_TILE_FROM_PICTURE=30;
export const ICE_TILES_FROM_PICTURE_40=150;
export const ICE_HUNDRED_FIFTY_TILE_FROM_PICTURE=40;

// 1–29: 50 tiles (10×5), 30–39: 100 tiles (10×10), 40–70: 150 tiles (15×10).
// Every picture has one secret star; finding it reveals the entire picture.
// The currently finished picture keeps its own grid until "next" is pressed.
export function iceTileCount(state){
 const completed=Number(state?.completed)||0;
 const currentPicture=state?.finished&&completed>0?completed:completed+1;
 return currentPicture>=ICE_HUNDRED_FIFTY_TILE_FROM_PICTURE?ICE_TILES_FROM_PICTURE_40:
  currentPicture>=ICE_HUNDRED_TILE_FROM_PICTURE?ICE_TILES_FROM_PICTURE_30:ICE_TILES;
}
export function nextIceTileCount(state){
 const nextPicture=Number(state?.completed||0)+1;
 return nextPicture>=ICE_HUNDRED_FIFTY_TILE_FROM_PICTURE?ICE_TILES_FROM_PICTURE_40:
  nextPicture>=ICE_HUNDRED_TILE_FROM_PICTURE?ICE_TILES_FROM_PICTURE_30:ICE_TILES;
}
// Additive, guaranteed jackpots. Cash is in integer cents.
export const ICE_JACKPOTS=Object.freeze({
 45:Object.freeze({superSlots:1}),
 50:Object.freeze({cash:1000000000,superSlots:3,goldHammers:3,legendaryChests:1,wildcards:1}),
 55:Object.freeze({superSlots:2}),
 60:Object.freeze({cash:2500000000,superSlots:5,goldHammers:5,jokers:3,hatsVouchers:3,legendaryChests:2,wildcards:1}),
 65:Object.freeze({superSlots:3}),
 70:Object.freeze({cash:5000000000,superSlots:10,goldHammers:10,jokers:5,hatsVouchers:5,legendaryChests:3})
});
export const icePictureJackpot=number=>ICE_JACKPOTS[number]||null;
export const HAMMER_PRICES=Object.freeze({single:30000000,double:50000000,lucky:100000000});
export const MONEY_PRIZES=Object.freeze([100,500,1000,2500,5000,10000,25000,50000,100000,200000,350000,500000,750000,1000000,1500000,2000000]);
export function giftKind(number){
 if(!Number.isInteger(number)||number<1||number>ICE_PICTURES)throw Error('INVALID_PICTURE');
 return number%3===0?'joker':number%3===2?'hammer':'money';
}
export function drawHammer(random=randomInt){
 const roll=random(100);
 if(!Number.isInteger(roll)||roll<0||roll>=100)throw Error('INVALID_RANDOM');
 return roll<50?'single':roll<85?'double':'lucky';
}
export function drawMoney(random=randomInt,number=1){
 const floor=number>=60?500000:number>=50?200000:number>=40?50000:100;
 const pool=MONEY_PRIZES.filter(value=>value>=floor);
 const index=random(pool.length);
 if(!Number.isInteger(index)||index<0||index>=pool.length)throw Error('INVALID_RANDOM');
 return pool[index]*100;
}
export function drawGift(number,random=randomInt){
 const kind=giftKind(number);
 if(kind==='money')return {kind,number,amount:drawMoney(random,number)};
 if(kind==='hammer')return {kind,number,hammer:drawHammer(random)};
 return {kind,number,peekJokers:1};
}
