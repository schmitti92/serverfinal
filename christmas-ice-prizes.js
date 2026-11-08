'use strict';
import {randomInt} from 'node:crypto';
// Pure authoritative prize rules for Weihnachtsevent 2.
// This module NEVER accepts a client-supplied prize or issues credits.
// It is not yet wired to HTTP until server-validated progress is implemented.
export const ICE_PICTURES=70;
export const ICE_TILES=20;
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
