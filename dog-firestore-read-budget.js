/**
 * Passive, process-local DOG Firestore SDK read-attempt counters.
 * Counts SDK get() calls and snapshot notifications, NOT Firebase billed reads.
 * Never performs I/O or retains document paths, room codes or player data.
 */
const WINDOW_MS=10*60*1000;
const KINDS=new Set(['transaction-document-get','http-room-get','watch-notification']);

export function createDogFirestoreReadBudget({clock=Date.now,windowMs=WINDOW_MS}={}){
 const byMinute=new Map();
 const collectionOf=ref=>{
  const path=typeof ref==='string'?ref:String(ref?.path||'');
  const collection=path.split('/')[0];
  return /^[a-z0-9_]{3,75}$/.test(collection)?collection:'other';
 };
 const record=(kind,ref)=>{
  const safeKind=KINDS.has(kind)?kind:'other';
  const collection=collectionOf(ref);
  const minute=Math.floor(clock()/60000);
  let bucket=byMinute.get(minute);
  if(!bucket){bucket={byKind:{},byCollection:{}};byMinute.set(minute,bucket);}
  bucket.byKind[safeKind]=(bucket.byKind[safeKind]||0)+1;
  bucket.byCollection[collection]=(bucket.byCollection[collection]||0)+1;
  const earliest=Math.floor((clock()-windowMs)/60000)-1;
  for(const timestamp of byMinute.keys())if(timestamp<earliest)byMinute.delete(timestamp);
 };
 const trackTransaction=tx=>new Proxy(tx,{
  get(target,property){
   const value=Reflect.get(target,property,target);
   if(property==='get'&&typeof value==='function')return (ref,...rest)=>{
    record('transaction-document-get',ref);
    return value.apply(target,[ref,...rest]);
   };
   return typeof value==='function'?value.bind(target):value;
  }
 });
 const snapshot=()=>{
  const since=Math.ceil((clock()-windowMs)/60000);
  const byKind={},byCollection={};
  for(const [minute,bucket] of byMinute){
   if(minute<since)continue;
   for(const [kind,n] of Object.entries(bucket.byKind))byKind[kind]=(byKind[kind]||0)+n;
   for(const [collection,n] of Object.entries(bucket.byCollection))byCollection[collection]=(byCollection[collection]||0)+n;
  }
  return {windowMinutes:windowMs/60000,
   transactionGetAttempts:byKind['transaction-document-get']||0,
   httpRoomGetResults:byKind['http-room-get']||0,
   watchNotifications:byKind['watch-notification']||0,
   byKind,byCollection,
   scope:'Render SDK attempts/notifications; not Firebase billable document reads'};
 };
 return {record,trackTransaction,snapshot};
}
