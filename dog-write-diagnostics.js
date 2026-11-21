/**
 * Counts server-side Firestore write operations for DOG, without recording
 * player IDs, room codes, payloads or private balances.
 *
 * Counters are RAM-only and are updated ONLY after a transaction commits.
 * Transaction retries do not inflate the totals. No extra Firestore traffic.
 */
export const DOG_WRITE_DIAGNOSTICS_WINDOW_MS=10*60*1000;
const collectionName=ref=>{
 const path=String(ref?.path||'');
 return path.includes('/')?path.slice(0,path.lastIndexOf('/')):'other';
};
export function createDogWriteDiagnostics({clock=Date.now,windowMs=DOG_WRITE_DIAGNOSTICS_WINDOW_MS}={}){
 const windows=new Map();
 function counter(tx){
  const writes={};
  const tracked=new Proxy(tx,{get(target,property){
   const value=Reflect.get(target,property,target);
   if(typeof value!=='function')return value;
   if(['set','update','delete','create'].includes(property))
    return (...args)=>{
     const collection=collectionName(args[0]);
     writes[collection]=(writes[collection]||0)+1;
     return value.apply(target,args);
    };
   return value.bind(target);
  }});
  return {tx:tracked,counts:()=>({...writes})};
 }
 function record(kind,counts={},changed=true){
  const minute=Math.floor(clock()/60000),key=String(kind||'dog-other');
  const bucketId=minute+'|'+key;
  let bucket=windows.get(bucketId);
  if(!bucket){bucket={minute,kind:key,committed:0,noops:0,writeCalls:0,byCollection:{}};windows.set(bucketId,bucket);}
  if(changed)bucket.committed++;else bucket.noops++;
  for(const [collection,n] of Object.entries(counts)){
   if(!Number.isSafeInteger(n)||n<=0)continue;
   bucket.writeCalls+=n;
   bucket.byCollection[collection]=(bucket.byCollection[collection]||0)+n;
  }
  const minAllowed=Math.floor((clock()-windowMs)/60000)-1;
  for(const [id,entry] of windows)if(entry.minute<minAllowed)windows.delete(id);
 }
 function snapshot(){
  const since=Math.ceil((clock()-windowMs)/60000);
  const selected=[...windows.values()].filter(entry=>entry.minute>=since);
  const result={windowMinutes:windowMs/60000,transactions:0,noops:0,writeCalls:0,byKind:{},byCollection:{}};
  for(const row of selected){
   result.transactions+=row.committed;
   result.noops+=row.noops;
   result.writeCalls+=row.writeCalls;
   const type=result.byKind[row.kind]||{transactions:0,noops:0,writeCalls:0};
   type.transactions+=row.committed;type.noops+=row.noops;type.writeCalls+=row.writeCalls;
   result.byKind[row.kind]=type;
   for(const [collection,n] of Object.entries(row.byCollection))
    result.byCollection[collection]=(result.byCollection[collection]||0)+n;
  }
  return result;
 }
 async function transaction(store,kind,work){
  const result=await store.runTransaction(async tx=>{
   const tracked=counter(tx),value=await work(tracked.tx);
   return {value,writes:tracked.counts()};
  });
  record(kind,result.writes,true);
  return result.value;
 }
 return {counter,record,snapshot,transaction};
}
