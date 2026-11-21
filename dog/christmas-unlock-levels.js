/** Player-level gates for Christmas scratch variants.
 * Verified DOG XP is the ONLY authority; vouchers, free-play and client hints
 * never bypass these gates. Unlisted cards are available from Level 1.
 */
export const DOG_CHRISTMAS_SCRATCH_MIN_LEVEL=Object.freeze({
 snow_collect:3,
 tic_tac_toe:6,
 elf:7,
 dog_jackpot_9:8
});
export const dogChristmasScratchMinLevel=variantId=>
 DOG_CHRISTMAS_SCRATCH_MIN_LEVEL[variantId]||1;
export const dogChristmasScratchUnlocked=(variantId,level)=>
 Number.isInteger(level)&&level>=dogChristmasScratchMinLevel(variantId);
