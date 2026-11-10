// The shared winning player's Christmas wheel has two prize tiers only.
// Keep this server-authoritative; the client animation must not reroll prizes.
import {randomInt} from 'node:crypto';

export const FINAL_WINNER_PACK_ODDS=Object.freeze({
 premium:30,
 large:70,
 small:0
});

export function drawFinalWinnerPack(random=randomInt){
 const roll=random(100);
 if(!Number.isInteger(roll)||roll<0||roll>=100)throw Error('INVALID_FINAL_PACK_ROLL');
 return roll<FINAL_WINNER_PACK_ODDS.premium?'premium':'large';
}
