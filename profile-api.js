/** Spieleportal Online-Konten V2: authenticated profile preferences and guided onboarding.
 *  Match results / XP are deliberately NOT writable from this API.
 */
const COLORS = new Set(['#328cff','#ff5268','#20b986','#ffc741','#9261ec','#f281af']);
const GAMES = new Set(['skyjo','kreuz','barikade','business']);
const COLLECTION = 'player_profiles_v1';
const BANNERS = new Set(['classic','ocean','sunset','forest','cosmos']);
const BIO_MAX = 180;
function nameOf(value){return String(value??'').replace(/[<>\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim().slice(0,24);}
function validPrefs(body){
  if(!body || typeof body!=='object' || Array.isArray(body))return null;
  const name=nameOf(body.name);
  if(!name || name.length<2 || typeof body.name!=='string')return null;
  if(!COLORS.has(body.color) || !GAMES.has(body.favorite))return null;
  if(!Number.isInteger(body.avatar) || body.avatar<0 || body.avatar>7)return null;
  return {name,color:body.color,favorite:body.favorite,avatar:body.avatar,edited:!!body.edited};
}
// Tiny profile pictures are JPEG/PNG/WebP data URLs (not HTML/SVG).
// The client reduces them to <= 96 KiB; never trust the client to enforce this.
function validAvatarImage(value,maxBytes=98304){
  if(value===null)return true;
  if(typeof value!=='string'||value.length>Math.ceil(maxBytes*4/3)+64)return false;
  const m=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!m)return false;
  const raw=m[2];
  if(raw.length%4!==0)return false;
  const b=Buffer.from(raw,'base64');
  if(b.length<32||b.length>maxBytes||b.toString('base64')!==raw)return false;
  const hex=b.subarray(0,12).toString('hex');
  if(m[1]==='jpeg')return hex.startsWith('ffd8ff');
  if(m[1]==='png')return hex.startsWith('89504e470d0a1a0a');
  return b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';
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
      try{await ref.create({uid:req.profileUid,name:defaultName,color:'#328cff',favorite:'skyjo',avatar:0,avatarImage:null,setupComplete:false,edited:false,created:now,updated:now,revision:1,importedLocal:false,bio:'',banner:'classic',bannerImage:null,publicStats:false});}
      catch(e){if(e.code!==6 && e.code!=='already-exists' && !/already exists/i.test(e.message||''))throw e;}
      snap=await ref.get();
    }
    return {ref,profile:snap.data()};
  }
  function output(profile){
    const {uid,name,color,favorite,avatar,edited,created,updated,revision,importedLocal}=profile;
    // Accounts created by V1.1 predate the guided onboarding: preserve them as completed.
    const setupComplete=profile.setupComplete!==false;
    return {uid,name,color,favorite,avatar,avatarImage:profile.avatarImage||null,
      bio:typeof profile.bio==='string'?profile.bio:'',
      banner:BANNERS.has(profile.banner)?profile.banner:'classic',
      bannerImage:profile.bannerImage||null,publicStats:profile.publicStats===true,
      setupComplete,edited,created,updated,revision,importedLocal};
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
    if(!prefs||!Number.isInteger(revision)||revision<1||
      (Object.hasOwn(req.body,'avatarImage')&&!validAvatarImage(req.body.avatarImage)))
      return error(res,400,'INVALID_PROFILE');
    // Optional V7 fields are tightly validated. Older clients may omit them;
    // omitted fields are never reset during a regular profile update.
    const has=k=>Object.prototype.hasOwnProperty.call(req.body,k);
    const extra={};
    if(has('bio')){
      if(typeof req.body.bio!=='string'||req.body.bio.length>BIO_MAX || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(req.body.bio))return error(res,400,'INVALID_BIO');
      extra.bio=req.body.bio.trim();
    }
    if(has('banner')){
      if(!BANNERS.has(req.body.banner))return error(res,400,'INVALID_BANNER');
      extra.banner=req.body.banner;
    }
    if(has('bannerImage')){
      if(!validAvatarImage(req.body.bannerImage,153600))return error(res,400,'INVALID_BANNER_IMAGE');
      extra.bannerImage=req.body.bannerImage;
    }
    if(has('publicStats')){
      if(typeof req.body.publicStats!=='boolean')return error(res,400,'INVALID_PRIVACY_CHOICE');
      extra.publicStats=req.body.publicStats;
    }
    const ref=db.collection(COLLECTION).doc(req.profileUid);
    try{
      const result=await db.runTransaction(async tx=>{
        const snap=await tx.get(ref);
        if(!snap.exists)return {status:404};
        const old=snap.data();
        if(old.setupComplete===false)return {status:403};
        if(old.revision!==revision)return {status:409,profile:output(old)};
        const next={...prefs,...extra,updated:Date.now(),revision:revision+1};
        if(Object.hasOwn(req.body,'avatarImage'))next.avatarImage=req.body.avatarImage;
        tx.update(ref,next);
        return {status:200,profile:output({...old,...next})};
      });
      if(result.status===409)return res.status(409).json({ok:false,error:'PROFILE_CONFLICT',profile:result.profile});
      if(result.status===404)return error(res,404,'PROFILE_MISSING');
      if(result.status===403)return error(res,403,'SETUP_REQUIRED');
      return res.json({ok:true,profile:result.profile});
    }catch(e){console.error('[profile/update]',e);return error(res,500,'PROFILE_WRITE_FAILED');}
  });
  // Atomic one-time onboarding completion: no intermediate profile is published as finished.
  app.post('/api/profile/complete',throttle,async(req,res)=>{
    const db=getDb(res);if(!db)return;
    const prefs=validPrefs(req.body);
    if(!prefs||!validAvatarImage(req.body?.avatarImage??null))return error(res,400,'INVALID_PROFILE');
    const img=req.body.avatarImage??null;
    const ref=db.collection(COLLECTION).doc(req.profileUid);
    try{
      const result=await db.runTransaction(async tx=>{
        const snap=await tx.get(ref);
        if(!snap.exists)return {status:404};
        const old=snap.data();
        if(old.setupComplete!==false)return {status:409,profile:output(old)};
        const next={...prefs,avatarImage:img,setupComplete:true,updated:Date.now(),revision:old.revision+1};
        tx.update(ref,next);
        return {status:200,profile:output({...old,...next})};
      });
      if(result.status===404)return error(res,404,'PROFILE_MISSING');
      if(result.status===409)return res.status(409).json({ok:false,error:'ALREADY_COMPLETE',profile:result.profile});
      return res.json({ok:true,profile:result.profile});
    }catch(e){console.error('[profile/complete]',e);return error(res,500,'PROFILE_SETUP_FAILED');}
  });
}
