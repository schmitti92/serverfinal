/**
 * Read-only, RAM-only counters of successful HTTP mutation requests.
 *
 * These are NOT Firestore billing/write counts. They identify routes worth
 * investigating when Firebase console writes differ from the DOG-specific
 * committed-document counters.
 *
 * Never store URL parameters, tokens, UIDs, room codes or request bodies.
 */
export function createFirebaseMutationRequestDiagnostics({clock=Date.now,windowMs=600000}={}){
 const buckets=new Map();
 let overflow=0;
 function observe(req,res,next){
  if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return next();
  res.once('finish',()=>{
   if(res.statusCode<200||res.statusCode>=300)return;
   const raw=req.route?.path;
   if(typeof raw!=='string'||!raw.startsWith('/'))return;
   // Only the registered Express route template is safe to retain. Never
   // append req.baseUrl: mounted routers can contain resolved room codes.
   const name=(req.method+' '+raw).slice(0,150);
   const minute=Math.floor(clock()/60000);
   let bucket=buckets.get(minute);
   if(!bucket){bucket=new Map();buckets.set(minute,bucket);}
   if(!bucket.has(name)&&bucket.size>=100){overflow++;return;}
   bucket.set(name,(bucket.get(name)||0)+1);
   prune();
  });
  next();
 }
 function prune(){
  const earliest=Math.floor((clock()-windowMs)/60000)-1;
  for(const key of buckets.keys())if(key<earliest)buckets.delete(key);
 }
 function snapshot(){
  prune();
  const minimum=Math.ceil((clock()-windowMs)/60000);
  const totals=new Map();
  for(const [minute,bucket] of buckets)if(minute>=minimum){
   for(const [route,count] of bucket)totals.set(route,(totals.get(route)||0)+count);
  }
  const rows=[...totals].map(([route,count])=>({route,count}))
   .sort((a,b)=>b.count-a.count||a.route.localeCompare(b.route));
  return {windowMinutes:windowMs/60000,successfulRequests:rows.reduce((n,x)=>n+x.count,0),
   byRoute:rows.slice(0,35),truncatedRoutes:Math.max(0,rows.length-35),overflow};
 }
 return {observe,snapshot};
}
