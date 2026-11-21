/**
 * Render RAM-only diagnostics for successful GET endpoints.
 *
 * Deliberately does NOT contact Firestore and does not assert that one HTTP
 * request equals one billable document read. It helps find which public
 * flows are repeatedly fetching server data during idle game/event sessions.
 *
 * Only Express route templates are recorded: never URL params, user ids,
 * room codes, authorization tokens, bodies, query strings or addresses.
 */
export function createFirebaseHttpReadDiagnostics({
 clock=Date.now,windowMs=600000,maxRoutes=80
}={}){
 const minutes=new Map(),totals={requests:0,failures:0,overflow:0};
 const minute=()=>Math.floor(clock()/60000);
 function trim(){
  const lower=Math.floor((clock()-windowMs)/60000)-1;
  for(const key of minutes.keys())if(key<lower)minutes.delete(key);
 }
 function observe(req,res,next){
  if(req.method!=='GET'&&req.method!=='HEAD')return next();
  res.once('finish',()=>{
   // The matched Express route pattern is an approved, parameter-free label.
   const route=typeof req.route?.path==='string'?req.route.path:'';
   if(!route.startsWith('/'))return;
   const code=Number(res.statusCode)||0;
   const m=minute(),label=(req.method+' '+route).slice(0,150);
   trim();
   let bucket=minutes.get(m);
   if(!bucket){bucket=new Map();minutes.set(m,bucket);}
   if(!bucket.has(label)&&bucket.size>=maxRoutes){totals.overflow++;return;}
   let entry=bucket.get(label);
   if(!entry){entry={success:0,error:0};bucket.set(label,entry);}
   if(code>=200&&code<400){entry.success++;totals.requests++;}
   else{entry.error++;totals.failures++;}
  });
  next();
 }
 function snapshot(){
  trim();const start=Math.ceil((clock()-windowMs)/60000);
  const agg=new Map();
  for(const [timestamp,bucket] of minutes)if(timestamp>=start){
   for(const [route,entry] of bucket){
    const current=agg.get(route)||{route,requests:0,errors:0};
    current.requests+=entry.success;current.errors+=entry.error;
    agg.set(route,current);
   }
  }
  const rows=[...agg.values()].sort((a,b)=>b.requests-a.requests||a.route.localeCompare(b.route));
  return {windowMinutes:windowMs/60000,successfulHttpReads:rows.reduce((n,x)=>n+x.requests,0),
   httpErrors:rows.reduce((n,x)=>n+x.errors,0),byRoute:rows.slice(0,35),
   truncatedRoutes:Math.max(0,rows.length-35),overflow:totals.overflow,
   measurementScope:'http_get_requests_not_firestore_document_reads'};
 }
 return {observe,snapshot};
}
