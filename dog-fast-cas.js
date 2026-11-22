/**
 * Optional DOG standard-match write fast path.
 *
 * Uses an already-authenticated server-side room snapshot plus Firestore's
 * lastUpdateTime precondition. Still awaits a DURABLE Firestore write before
 * acknowledging a move. A failed precondition goes through the normal
 * Firestore transaction, never an unverified overwrite.
 *
 * No extra get(), listener, wallet access or Firestore database is created.
 */
const NEED_TRANSACTION=Symbol('dog-fast-needs-transaction');
const fallback=reason=>({used:false,reason});
export function isDogCasConflict(error){
 return error?.code===9||error?.code==='9'||error?.code==='FAILED_PRECONDITION'||
  error?.code==='failed-precondition';
}
export async function tryDogFastCas({room,updateTime,ref,store,change,clock,ttlMs}){
 if(room?.phase!=='playing'||room?.match?.game!=='dog'||
    room.match.dogChristmasEligibilityChecked!==true||
    room.match.christmas?.enabled!==false||
    typeof updateTime?.toMillis!=='function'||
    typeof ref?.update!=='function')return fallback('not-eligible');
 // Cloned state is speculative until the Firestore compare-and-swap commits.
 // No single in-memory state is ever authoritative over a newer Firestore doc.
 let candidate;
 try{candidate=structuredClone(room);}catch{return fallback('not-cloneable');}
 const mustUseTransaction=()=>{throw NEED_TRANSACTION;};
 const forbiddenTx=Object.freeze({get:mustUseTransaction,set:mustUseTransaction,
  update:mustUseTransaction,delete:mustUseTransaction,create:mustUseTransaction});
 let changeResult;
 try{changeResult=await change(candidate,forbiddenTx,store);}
 catch{return fallback('must-validate-in-transaction');}
 if(changeResult?.remove||changeResult?.unchanged||
    candidate.match?.game!=='dog'||candidate.match.christmas?.enabled!==false||
    candidate.match.dogChristmasEligibilityChecked!==true||
    candidate.match.dog?.phase==='finished')return fallback('transaction-required');
 // update(data) merges fields at the root. If a key disappeared, only a
 // transaction/set could remove it without silently retaining stale data.
 if(Object.keys(room).some(key=>!Object.hasOwn(candidate,key)))
  return fallback('root-key-removal');
 if(JSON.stringify(candidate)===JSON.stringify(room))
  return fallback('no-change');
 candidate.revision=(Number(candidate.revision)||0)+1;
 candidate.updatedAt=clock();candidate.expiresAt=clock()+ttlMs;
 try{
  const result=await ref.update(candidate,{lastUpdateTime:updateTime});
  return {used:true,room:candidate,writeTime:result?.writeTime||null};
 }catch(e){
  if(isDogCasConflict(e))return fallback('conflict');
  // Unknown network errors must NOT retry a possibly committed write
  // with another random deck draw. The caller's stable actionId lets the
  // existing transaction endpoint handle an explicit client retry safely.
  throw e;
 }
}
