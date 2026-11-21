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

/**
 * Return precisely which non-room documents were durably written, or null
 * when path evidence is incomplete and a full cache flush is safer.
 * Never accept client-supplied paths: writePaths must come from the tracked
 * server-side Firestore transaction AFTER a successful commit.
 */
export function dogWrittenMetadataPaths(kind,writePaths,roomCollection){
 if(kind!=='dog-match'||!Array.isArray(writePaths))return null;
 if(writePaths.some(path=>typeof path!=='string'||!path.includes('/')))return null;
 return [...new Set(writePaths)].filter(path=>path.split('/')[0]!==roomCollection);
}
