/**
 * Memory-only route counts for successful GET requests served by Render.
 * NO Firebase reads/writes, usernames, auth tokens, room codes or payloads.
 * These are requests, NOT Firestore billable document-read counts.
 */
export function createFirebaseReadRequestDiagnostics({clock=Date.now,windowMs=600_000}={}){
 const buckets=new Map();
 function snapshot(){
  const minimum=Math.ceil((clock()-windowMs)/60000);
  for(const minute of buckets.keys())if(minute<minimum)buckets.delete(minute);
  const rows=new Map();
  for(const [minute,byRoute] of buckets){
   if(minute<minimum)continue;
   for(const [route,n] of byRoute)rows.set(route,(rows.get(route)||0)+n);
  }
  const byRoute=[...rows].map(([route,count])=>({route,count}))
   .sort((a,b)=>b.count-a.count||a.route.localeCompare(b.route));
  return {windowMinutes:windowMs/60000,
   successfulRequests:byRoute.reduce((n,x)=>n+x.count,0),
   byRoute:byRoute.slice(0,50)};
 }
 function observe(req,res,next){
  if(req.method!=='GET')return next();
  res.once('finish',()=>{
   if(res.statusCode<200||res.statusCode>=300)return;
   const path=req.route?.path;
   // Route templates, never real URL params or sensitive profile data.
   if(typeof path!=='string'||!path.startsWith('/'))return;
   if(!/^\/(?:api\/|skyjo\/|business\/|room\/)/.test(path))return;
   if(path.startsWith('/api/firebase/'))return;
   const minute=Math.floor(clock()/60000);
   let bucket=buckets.get(minute);
   if(!bucket){bucket=new Map();buckets.set(minute,bucket);}
   if(!bucket.has(path)&&bucket.size>=100)return;
   bucket.set(path,(bucket.get(path)||0)+1);
   if(buckets.size>20)snapshot();
  });
  next();
 }
 return {observe,snapshot};
}
