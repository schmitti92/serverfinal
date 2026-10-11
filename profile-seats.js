/** SPIELEPORTAL V8C – PRIVATE, SERVER-VERIFIED PLAYER/SEAT CLAIMS.
 * NOTE: These claims prove an authenticated Firebase user asked to link a room seat.
 * They are NOT a server verification of gameplay, points, or final results.
 * NEVER award ranked wins using this module while room state is client-owned.
 */
import { createHash } from 'node:crypto';

export function installProfileSeats(app, {verifyProfile, getFirestore, readBusiness, readSkyjo}) {
  const COLLECTION='profile_seat_claims_v8c';
  const roomCode=x=>typeof x==='string' && /^[A-Z0-9_-]{1,20}$/.test(x)?x:null;
  const hash=x=>createHash('sha256').update(String(x)).digest('hex');
  const safeString=(x,n)=>typeof x==='string'?x.trim().slice(0,n):'';
  const allowed=new Set(['business','skyjo']);
  app.post('/api/profile/seat/claim', async(req,res)=>{
    // An explicit token is essential: there is never a fallback to displayed player names.
    const bearer=/^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization||''));
    if(!bearer) return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
    let user;
    try { user=await verifyProfile(bearer[1]); }
    catch { user=null; }
    if(!user?.uid)return res.status(401).json({ok:false,error:'ACCOUNT_NOT_VERIFIED'});
    const game=safeString(req.body?.game,20).toLowerCase();
    const code=roomCode(safeString(req.body?.code,20).toUpperCase());
    const rawSeat=safeString(req.body?.seatToken,128);
    if(!allowed.has(game)||!code||rawSeat.length<8 || rawSeat.length>128)
      return res.status(400).json({ok:false,error:'BAD_SEAT_CLAIM'});
    const tokenHash=hash(`${game}:${rawSeat}`);
    let snapshot,phase,instance,player;
    try {
      snapshot=game==='business'?await readBusiness(code):await readSkyjo(code);
      const room=snapshot?.state;
      if(!room)return res.status(404).json({ok:false,error:'ROOM_NOT_FOUND'});
      if(game==='business') {
        if(room.kind!=='business-room-v2')return res.status(409).json({ok:false,error:'BAD_ROOM_VERSION'});
        player=(Array.isArray(room.players)?room.players:[]).find(p=>p?.token===rawSeat);
        phase=String(room.phase||'lobby');instance=Number(room.createdAt);
      } else {
        if(room.kind!=='skyjo-room-v2'||room.version!==2)return res.status(409).json({ok:false,error:'BAD_ROOM_VERSION'});
        player=(Array.isArray(room.lobby?.players)?room.lobby.players:[]).find(p=>p?.id===rawSeat);
        phase=String(room.lobby?.status||'lobby');instance=Number(room.lobby?.createdAt);
      }
      if(!player)return res.status(403).json({ok:false,error:'SEAT_NOT_IN_ROOM'});
      if(!Number.isSafeInteger(instance)||instance<946684800000||instance>Date.now()+60000)
        return res.status(409).json({ok:false,error:'ROOM_INSTANCE_INVALID'});
    } catch(e){console.warn('[profile/seat/read]',e?.message||e);return res.status(503).json({ok:false,error:'ROOM_UNAVAILABLE'});}
    let db;try{db=getFirestore();}catch{db=null;}
    if(!db)return res.status(503).json({ok:false,error:'DATABASE_UNAVAILABLE'});
    const doc=db.collection(COLLECTION).doc(`${game}_${code}`);
    try {
      const result=await db.runTransaction(async tx=>{
        const old=await tx.get(doc),saved=old.exists?old.data()||{}:{};
        const sameInstance=saved.instance===instance;
        // A reused room code starts a completely separate roster. Old claims never transfer.
        const entries=sameInstance&&Array.isArray(saved.seats)?saved.seats:[];
        const thisSeat=entries.find(p=>p.seatHash===tokenHash);
        const otherSeat=entries.find(p=>p.uid===user.uid&&p.seatHash!==tokenHash);
        if(thisSeat && thisSeat.uid!==user.uid)return {error:'SEAT_ALREADY_BOUND'};
        if(otherSeat)return {error:'ACCOUNT_ALREADY_IN_ROOM'};
        // Once the game starts, no NEW seat claims may be inserted or switched.
        if(!thisSeat && phase!=='lobby')return {error:'MATCH_ALREADY_STARTED'};
        if(thisSeat)return {ok:true,alreadyBound:true};
        const next={game,code,instance,seats:[...entries,{uid:user.uid,seatHash:tokenHash,claimedAt:Date.now()}],updatedAt:Date.now()};
        // Private administrative collection. Do not expose it in the room payload.
        tx.set(doc,next);
        return {ok:true,alreadyBound:false};
      });
      if(result.error)return res.status(409).json({ok:false,error:result.error});
      return res.json({ok:true,bound:true,alreadyBound:result.alreadyBound,
        officialStats:false,info:'IDENTITY_ONLY_RESULTS_UNVERIFIED'});
    }catch(e){console.error('[profile/seat/claim]',e?.message||e);return res.status(503).json({ok:false,error:'CLAIM_TEMPORARILY_UNAVAILABLE'});}
  });
}
