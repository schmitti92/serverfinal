/** Spieleportal Online-Konten V1: authenticated profile preferences only.
 *  Match results / XP are deliberately NOT writable from this API.
 */
const COLORS = new Set(['#328cff','#ff5268','#20b986','#ffc741','#9261ec','#f281af']);
const GAMES = new Set(['skyjo','kreuz','barikade','business']);
const COLLECTION = 'player_profiles_v1';
function nameOf(value){return String(value??'').replace(/[<>\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim().slice(0,24);}
function validPrefs(body){
  if(!body || typeof body!=='object' || Array.isArray(body))return null;
  const name=nameOf(body.name);
  if(!name || name.length<2 || typeof body.name!=='string')return null;
  if(!COLORS.has(body.color) || !GAMES.has(body.favorite))return null;
  if(!Number.isInteger(body.avatar) || body.avatar<0 || body.avatar>7)return null;
  return {name,color:body.color,favorite:body.favorite,avatar:body.avatar,edited:!!body.edited};
}
function error(res,status,code){return res.status(status).json({ok:false,error:code});}
export function installProfileApi(app,{admin,getFirestore,isReady=()=>true}){
  // In-memory rate limit is a useful supplementary throttle, not a distributed abuse control.
  const limits=new Map();
  app.use('/api/profile',async(req,res,next)=>{
    try{
      // Fail closed when Render and the Firebase web app point to different projects.
      if (!isReady()) return error(res,503,'PROFILE_FIREBASE_PROJECT_MISMATCH');
      const authHeader=String(req.get('authorization')||'');
      if(!/^Bearer [\w.\-]+$/.test(authHeader))return error(res,401,'LOGIN_REQUIRED');
      if(!admin.apps.length)return error(res,503,'FIREBASE_NOT_CONFIGURED');
      const decoded=await admin.auth().verifyIdToken(authHeader.slice(7),true);
      if(!decoded?.uid)return error(res,401,'TOKEN_INVALID');
      req.profileUid=decoded.uid;
      req.profileUser=decoded;
      next();
    }catch(e){return error(res,401,'TOKEN_INVALID');}
  });
  const getDb=(res)=>{
    try{const db=getFirestore();if(db)return db;}catch(e){console.error('[profile/db]',e?.message||e);}
    error(res,503,'DATABASE_UNAVAILABLE');return null;
  };
  const throttle=(req,res,next)=>{
    const uid=req.profileUid,now=Date.now(),old=limits.get(uid)||[];
    const active=old.filter(ts=>now-ts<60_000);
    if(active.length>=15){limits.set(uid,active);return error(res,429,'RATE_LIMIT');}
    active.push(now);limits.set(uid,active);
    if(limits.size>3000)for(const [key,arr] of limits)if(!arr.some(ts=>now-ts<60_000))limits.delete(key);
    next();
  };
  async function ensureProfile(db,req){
    const ref=db.collection(COLLECTION).doc(req.profileUid);
    let snap=await ref.get();
    if(!snap.exists){
      const defaultName=nameOf(req.profileUser.name||req.profileUser.email?.split('@')[0]||'Spieler')||'Spieler';
      const now=Date.now();
      try{await ref.create({uid:req.profileUid,name:defaultName,color:'#328cff',favorite:'skyjo',avatar:0,edited:false,created:now,updated:now,revision:1,importedLocal:false});}
      catch(e){if(e.code!==6 && e.code!=='already-exists' && !/already exists/i.test(e.message||''))throw e;}
      snap=await ref.get();
    }
    return {ref,profile:snap.data()};
  }
  function output(profile){
    const {uid,name,color,favorite,avatar,edited,created,updated,revision,importedLocal}=profile;
    return {uid,name,color,favorite,avatar,edited,created,updated,revision,importedLocal};
  }
  app.get('/api/profile/me',async(req,res)=>{
    const db=getDb(res);if(!db)return;
    try{const {profile}=await ensureProfile(db,req);return res.json({ok:true,profile:output(profile)});}
    catch(e){console.error('[profile/get]',e);return error(res,500,'PROFILE_READ_FAILED');}
  });
  app.put('/api/profile/me',throttle,async(req,res)=>{
    const db=getDb(res);if(!db)return;
    const prefs=validPrefs(req.body);
    const revision=req.body?.expectedRevision;
    if(!prefs||!Number.isInteger(revision)||revision<1)return error(res,400,'INVALID_PROFILE');
    const ref=db.collection(COLLECTION).doc(req.profileUid);
    try{
      const result=await db.runTransaction(async tx=>{
        const snap=await tx.get(ref);
        if(!snap.exists)return {status:404};
        const old=snap.data();
        if(old.revision!==revision)return {status:409,profile:output(old)};
        const next={...prefs,updated:Date.now(),revision:revision+1};
        tx.update(ref,next);
        return {status:200,profile:output({...old,...next})};
      });
      if(result.status===409)return res.status(409).json({ok:false,error:'PROFILE_CONFLICT',profile:result.profile});
      if(result.status===404)return error(res,404,'PROFILE_MISSING');
      return res.json({ok:true,profile:result.profile});
    }catch(e){console.error('[profile/update]',e);return error(res,500,'PROFILE_WRITE_FAILED');}
  });
  app.post('/api/profile/import-local',throttle,async(req,res)=>{
    const db=getDb(res);if(!db)return;
    const prefs=validPrefs(req.body);
    if(!prefs)return error(res,400,'INVALID_PROFILE');
    const ref=db.collection(COLLECTION).doc(req.profileUid);
    try{
      const result=await db.runTransaction(async tx=>{
        const snap=await tx.get(ref);
        if(!snap.exists)return {status:404};
        const old=snap.data();
        // Import is allowed only before the new account is edited, and only once.
        if(old.importedLocal||old.revision!==1)return {status:409,profile:output(old)};
        const next={...prefs,importedLocal:true,revision:old.revision+1,updated:Date.now()};
        tx.update(ref,next);
        return {status:200,profile:output({...old,...next})};
      });
      if(result.status===409)return res.status(409).json({ok:false,error:'IMPORT_NOT_AVAILABLE',profile:result.profile});
      if(result.status===404)return error(res,404,'PROFILE_MISSING');
      return res.json({ok:true,profile:result.profile});
    }catch(e){console.error('[profile/import]',e);return error(res,500,'IMPORT_FAILED');}
  });
}
