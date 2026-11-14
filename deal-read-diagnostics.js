/** Passive per-route Read diagnostics for the Deal/Monster Slots backend.
 * Counts application-level Firestore get() attempts, NOT billed Firebase reads.
 * Fixed source categories only; no room codes, account IDs or player data.
 */
const SOURCES=Object.freeze(['httpGame','websocketSubscribe','websocketReconcile','scoreboard','rewardStatus','other']);
const KINDS=Object.freeze(['game','room']);
const EVENTS=Object.freeze(['request','firestoreGet','cacheHit']);
const createCounters=()=>Object.fromEntries(KINDS.map(k=>[k,Object.fromEntries(SOURCES.map(s=>[s,{request:0,firestoreGet:0,cacheHit:0}]))]));
export function createDealReadDiagnostics({clock=Date.now,windowMinutes=5}={}){
 const totals=createCounters(),buckets=new Map();
 const windowSize=Math.max(1,Math.min(60,Number.isSafeInteger(windowMinutes)?windowMinutes:5));
 const clone=()=>createCounters();
 const prune=current=>{
  for(const minute of buckets.keys())if(minute<=current-windowSize||minute>current)buckets.delete(minute);
 };
 function record(kind,source,event){
  if(!KINDS.includes(kind)||!EVENTS.includes(event))return;
  if(!SOURCES.includes(source))source='other';
  const current=Math.floor(clock()/60000);
  prune(current);
  let bucket=buckets.get(current);
  if(!bucket){bucket=clone();buckets.set(current,bucket);}
  totals[kind][source][event]++;
  bucket[kind][source][event]++;
 }
 function snapshot(){
  const now=Math.floor(clock()/60000);prune(now);
  const lastMinutes=clone();
  for(const data of buckets.values())
   for(const kind of KINDS)for(const source of SOURCES)for(const event of EVENTS)
    lastMinutes[kind][source][event]+=data[kind][source][event];
  // Only display-level read metrics, not transactional writes or final payouts.
  return {windowMinutes:windowSize,totals:structuredClone(totals),lastMinutes,
   caveat:'Counts server get() attempts; not Firebase billing or transactions'};
 }
 return {record,snapshot};
}
