/** Gemeinsame Spielesammlung-Lobby (Phase 1).
 * Single Firestore room across games; no client-side authority or local profile state.
 * Deliberately DOES NOT launch legacy games until they have safe room adapters.
 */
import { randomInt, randomUUID } from 'node:crypto';

export const HUB_GAMES = Object.freeze({
  barikade: { title:'Barikade', min:2, max:6 },
  skyjo: { title:'SKYJO Action', min:2, max:3 },
  kreuz: { title:'KreuzKunter', min:2, max:6 },
  business: { title:'Das große Business', min:2, max:5 },
});
const CHARSET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN=/^[A-HJ-NP-Z2-9]{6}$/;
const COLLECTION='spielesammlung_hub_v1';
const TTL_MS=24*60*60*1000;
const cleanName=n=>String(n||'Spieler').replace(/[<>\u0000-\u001f\u007f]/g,'').trim().slice(0,24)||'Spieler';
const codeNew=()=>Array.from({length:6},()=>CHARSET[randomInt(CHARSET.length)]).join('');

export function installSharedLobby(app,{verifyProfile,getFirestore,clock=()=>Date.now(),codeGenerator=codeNew,gameAdapters={}}){
  const db=()=>{try{return getFirestore()||null;}catch{return null;}};
  const error=(status,message)=>Object.assign(new Error(message),{status});
  const documentFor=(store,code)=>store.collection(COLLECTION).doc(code);
  const validCode=s=>typeof s==='string'&&CODE_PATTERN.test(s.toUpperCase())?s.toUpperCase():null;
  async function authentication(req,res,next){
    if(!db())return res.status(503).json({ok:false,error:'DATABASE_UNAVAILABLE'});
    const authorization=String(req.get('authorization')||'');
    const token=/^Bearer (\S+)$/i.exec(authorization)?.[1];
    if(!token)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
    const profile=await verifyProfile(token);
    if(!profile?.uid)return res.status(401).json({ok:false,error:'PROFILE_REQUIRED'});
    req.hubIdentity={uid:profile.uid,name:cleanName(profile.name)};
    next();
  }
  function expose(room,identity){
    const game=HUB_GAMES[room.game]||null;
    const seats=room.players.filter(p=>p.participating);
    return {
      code:room.code,revision:room.revision,phase:room.phase,game:room.game,
      gameTitle:game?.title||null,minPlayers:game?.min||null,maxPlayers:game?.max||null,
      // Start button stays disabled until a game-specific adapter is implemented.
      canLaunch:!!(room.game&&gameAdapters[room.game]?.start),
      host:room.hostUid===identity.uid,
      players:room.players.map(p=>({seat:p.seat,name:p.name,ready:p.ready,participating:!!p.participating,host:p.uid===room.hostUid,me:p.uid===identity.uid})),
      allReady:!!game&&seats.length>=game.min&&seats.length<=game.max&&seats.every(p=>p.ready),
      createdAt:room.createdAt,updatedAt:room.updatedAt,
    };
  }
  function validateRead(room,identity){
    if(!room||room.expiresAt<=clock())throw error(404,'ROOM_NOT_FOUND');
    if(!room.players.some(p=>p.uid===identity.uid))throw error(403,'NOT_A_MEMBER');
  }
  async function mutate(code,identity,change){
    const store=db();if(!store)throw error(503,'DATABASE_UNAVAILABLE');
    const ref=documentFor(store,code);
    const outcome=await store.runTransaction(async tx=>{
      const snap=await tx.get(ref);const room=snap.exists?snap.data():null;
      validateRead(room,identity);
      const result=await change(room);
      if(result?.remove){tx.delete(ref);return result.value;}
      if(result?.unchanged)return expose(room,identity);
      room.revision=(Number(room.revision)||0)+1;
      room.updatedAt=clock();room.expiresAt=clock()+TTL_MS;
      tx.set(ref,room);
      return expose(room,identity);
    });
    return outcome;
  }
  const handler=fn=>async(req,res)=>{
    try{const result=await fn(req);return res.json({ok:true,...result});}
    catch(e){const status=e?.status||500;if(status>=500)console.error('[shared-lobby]',e?.message||e);
      return res.status(status).json({ok:false,error:status===500?'LOBBY_ERROR':e.message});}
  };
  app.get('/api/hub/health',(_req,res)=>res.json({ok:true,phase:'foundation',storage:'firestore',databaseReady:!!db(),games:Object.keys(HUB_GAMES),integratedGames:Object.keys(gameAdapters).filter(g=>!!gameAdapters[g]?.start)}));
  app.use('/api/hub/rooms',authentication);
  app.post('/api/hub/rooms',handler(async req=>{
    const identity=req.hubIdentity,store=db();
    for(let attempts=0;attempts<8;attempts++){
      const code=validCode(codeGenerator());if(!code)throw error(500,'ROOM_CODE_ERROR');
      const ref=documentFor(store,code),now=clock();
      const room={code,hostUid:identity.uid,players:[{uid:identity.uid,seat:randomUUID(),name:identity.name,ready:false,participating:false,joinedAt:now}],
        game:null,phase:'lobby',revision:1,createdAt:now,updatedAt:now,expiresAt:now+TTL_MS};
      try{
        await store.runTransaction(async tx=>{const old=await tx.get(ref);if(old.exists&&old.data()?.expiresAt>now)throw error(409,'CODE_OCCUPIED');tx.set(ref,room);});
        return {room:expose(room,identity)};
      }catch(e){if(e?.message==='CODE_OCCUPIED'||e?.code===6)continue;throw e;}
    }
    throw error(503,'ROOM_CODE_UNAVAILABLE');
  }));
  app.post('/api/hub/rooms/:code/join',handler(async req=>{
    const identity=req.hubIdentity,code=validCode(req.params.code);
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    const store=db(),ref=documentFor(store,code);
    const room=await store.runTransaction(async tx=>{
      const snap=await tx.get(ref),r=snap.exists?snap.data():null;
      if(!r||r.expiresAt<=clock())throw error(404,'ROOM_NOT_FOUND');
      if(r.phase==='playing')throw error(409,'ROOM_ALREADY_PLAYING');
      let p=r.players.find(x=>x.uid===identity.uid);
      if(!p){if(r.players.length>=6)throw error(409,'ROOM_FULL');
        // A full game may still have spectators in the central room.
        const seatAvailable=!!r.game&&r.players.filter(x=>x.participating).length<HUB_GAMES[r.game].max;
        p={uid:identity.uid,seat:randomUUID(),name:identity.name,ready:false,participating:seatAvailable,joinedAt:clock()};r.players.push(p);
        r.players.forEach(x=>x.ready=false);
      }
      p.name=identity.name;
      r.revision++;r.updatedAt=clock();r.expiresAt=clock()+TTL_MS;
      tx.set(ref,r);return r;
    });
    return {room:expose(room,identity)};
  }));
  app.get('/api/hub/rooms/:code',handler(async req=>{
    const code=validCode(req.params.code);if(!code)throw error(400,'INVALID_ROOM_CODE');
    const store=db();const snap=await documentFor(store,code).get();const room=snap.exists?snap.data():null;
    validateRead(room,req.hubIdentity);return {room:expose(room,req.hubIdentity)};
  }));
  app.post('/api/hub/rooms/:code/select',handler(async req=>{
    const code=validCode(req.params.code),game=req.body?.game,identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    if(!Object.hasOwn(HUB_GAMES,game))throw error(400,'INVALID_GAME');
    return {room:await mutate(code,identity,room=>{
      if(room.hostUid!==identity.uid)throw error(403,'HOST_ONLY');
      if(room.phase==='playing')throw error(409,'MATCH_IN_PROGRESS');
      room.game=game;room.phase='preparing';
      room.players.forEach((p,i)=>{p.ready=false;p.participating=i<HUB_GAMES[game].max;});
    })};
  }));
  // Only the host may change seats. Spectators remain room members.
  app.post('/api/hub/rooms/:code/seats',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    const seat=req.body?.seat,participating=req.body?.participating;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    if(typeof seat!=='string'||seat.length>80||typeof participating!=='boolean')throw error(400,'INVALID_SEAT');
    return {room:await mutate(code,identity,room=>{
      if(room.hostUid!==identity.uid)throw error(403,'HOST_ONLY');
      if(room.phase!=='preparing'||!room.game)throw error(409,'NO_GAME_SELECTED');
      const player=room.players.find(p=>p.seat===seat);
      if(!player)throw error(404,'PLAYER_NOT_FOUND');
      if(player.participating===participating)return {unchanged:true};
      if(participating&&room.players.filter(p=>p.participating).length>=HUB_GAMES[room.game].max)
        throw error(409,'GAME_SEATS_FULL');
      player.participating=participating;
      room.players.forEach(p=>p.ready=false);
    })};
  }));
  app.post('/api/hub/rooms/:code/ready',handler(async req=>{
    const code=validCode(req.params.code),ready=req.body?.ready,identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    if(typeof ready!=='boolean')throw error(400,'INVALID_READY');
    return {room:await mutate(code,identity,room=>{
      if(room.phase!=='preparing'||!room.game)throw error(409,'NO_GAME_SELECTED');
      const player=room.players.find(p=>p.uid===identity.uid);
      if(!player.participating)throw error(403,'SPECTATOR_CANNOT_READY');
      player.ready=ready;
    })};
  }));
  // No fake game launch: the game adapters must be implemented and tested first.
  app.post('/api/hub/rooms/:code/start',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    return {room:await mutate(code,identity,async room=>{
      if(room.hostUid!==identity.uid)throw error(403,'HOST_ONLY');
      if(room.phase!=='preparing'||!room.game)throw error(409,'NO_GAME_SELECTED');
      const rule=HUB_GAMES[room.game];
      const active=room.players.filter(p=>p.participating);
      if(active.length<rule.min||active.length>rule.max||!active.every(p=>p.ready))throw error(409,'PLAYERS_NOT_READY');
      // The adapter must attach an actual shared-room game session, not merely redirect.
      if(!gameAdapters[room.game]?.start)throw error(409,'GAME_NOT_CONNECTED');
      throw error(501,'ADAPTER_TRANSACTION_NOT_IMPLEMENTED');
    })};
  }));
  app.post('/api/hub/rooms/:code/leave',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    const result=await mutate(code,identity,room=>{
      if(room.phase==='playing')throw error(409,'MATCH_IN_PROGRESS');
      room.players=room.players.filter(p=>p.uid!==identity.uid);
      if(!room.players.length)return {remove:true,value:{left:true,roomDeleted:true}};
      if(room.hostUid===identity.uid)room.hostUid=room.players[0].uid;
      room.players.forEach(p=>p.ready=false);
    });
    return result?.left?result:{left:true,roomDeleted:false};
  }));
  return {collection:COLLECTION,games:HUB_GAMES};
}
