/**
 * Invalidate DOG status read caches only after a committed metadata write.
 * A routine board move writes the hub room, not the player's wallets, stats,
 * research or village. Those reads remain safe to reuse for their brief TTL.
 *
 * Call this only with counts from a successfully committed transaction.
 * Never use it to decide whether a transaction should run or write.
 */
export function dogMetadataWasWritten(kind,writeCounts,roomCollection){
 if(kind!=='dog-match'||!writeCounts||typeof writeCounts!=='object')return false;
 return Object.entries(writeCounts).some(([collection,count])=>
  collection!==roomCollection&&Number.isSafeInteger(count)&&count>0);
}
