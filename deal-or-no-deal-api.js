import {create,apply,publicView,payoutFor} from './deal-or-no-deal.js';
import {newIceState,normalizeIceState} from './christmas-ice-engine.js';
import {CHRISTMAS_CARDS,christmasDraw,hammerBingoProgress,markChristmasDiscoveries,settleHammerBingoCycle,christmasDuplicateStock,redeemChristmasDuplicates,christmasHammerDuplicatesSaved,NORTH_POLE_MILESTONES,classicChristmasProgress as christmasProgress} from './christmas-card-engine.js';
import {FieldValue} from 'firebase-admin/firestore';
import {DOG_MATERIALS_COLLECTION,addVerifiedChestToInventory,addExpeditionChestToInventory} from './dog-materials.js';
import {dogChestOffer} from './dog-balance.js';
import {dogGateProgress,DOG_GATE_PROGRESS_COLLECTION,DOG_GATE_PROGRESS_ID} from './dog-gates.js';
import {DOG_BOSS_TEAM_COLLECTION,DOG_BOSS_TEAM_ID} from './dog-boss.js';
import {MONSTER_WHEEL_DURATION_MS,MONSTER_WHEEL_SLOTS,drawMonsterWheel,checkMonsterBalance} from './monster-wheel.js';
const SHOP_ITEMS=Object.freeze([{"id":"brille","name":"Goldene Sonnenbrille","price":100000000,"category":"Accessoires","emoji":"🕶️"},{"id":"pirat","name":"Piratenhut","price":150000000,"category":"Accessoires","emoji":"🏴‍☠️"},{"id":"mikro","name":"Show-Mikrofon","price":200000000,"category":"Extras","emoji":"🎙️"},{"id":"silberrahmen","name":"Silberner Profilrahmen","price":300000000,"category":"Rahmen","emoji":"🪞"},{"id":"silberkoffer","name":"Silberkoffer","price":500000000,"category":"Koffer","emoji":"💼"},{"id":"krone","name":"Königskrone","price":750000000,"category":"Accessoires","emoji":"👑"},{"id":"goldrahmen","name":"Goldener Profilrahmen","price":1000000000,"category":"Rahmen","emoji":"🖼️"},{"id":"goldkoffer","name":"Goldkoffer","price":1500000000,"category":"Koffer","emoji":"🧳"},{"id":"vip","name":"VIP-Abzeichen","price":2500000000,"category":"Extras","emoji":"🌟"},{"id":"studio","name":"Exklusives Studio","price":4000000000,"category":"Hintergründe","emoji":"🎬"},{"id":"diamant","name":"Diamantkoffer","price":7500000000,"category":"Koffer","emoji":"💎"},{"id":"trophaee","name":"Legendäre Show-Trophäe","price":10000000000,"category":"Extras","emoji":"🏆"}]);
import {randomInt} from 'node:crypto';
import {drawFinalWinnerPack} from './christmas-final-wheel.js';
const CARD_COLLECTION='deal_or_no_deal_cards_v1';
const CARD_DEFINITIONS=Object.freeze([
{id:'studio-lights',name:'Die große Bühne',rarity:'common',emoji:'🎬',series:'Goldstudio'},
{id:'lucky-seven',name:'Glückszahl Sieben',rarity:'common',emoji:'7️⃣',series:'Goldstudio'},
{id:'silver-case',name:'Der Silberkoffer',rarity:'common',emoji:'💼',series:'Koffer'},
{id:'spotlight',name:'Im Rampenlicht',rarity:'common',emoji:'🎤',series:'Goldstudio'},
{id:'applause',name:'Standing Ovations',rarity:'common',emoji:'👏',series:'Goldstudio'},
{id:'golden-ticket',name:'Goldenes Ticket',rarity:'common',emoji:'🎟️',series:'Goldstudio'},
{id:'banker-call',name:'Der Anruf',rarity:'rare',emoji:'☎️',series:'Banker'},
{id:'diamond-case',name:'Diamantkoffer',rarity:'rare',emoji:'💎',series:'Koffer'},
{id:'final-offer',name:'Das letzte Angebot',rarity:'rare',emoji:'📞',series:'Banker'},
{id:'vip',name:'Die VIP-Loge',rarity:'rare',emoji:'🌟',series:'Goldstudio'},
{id:'golden-stage',name:'Goldene Bühne',rarity:'epic',emoji:'🏟️',series:'Goldstudio'},
{id:'bankers-secret',name:'Geheimnis des Bankers',rarity:'epic',emoji:'🕴️',series:'Banker'},
{id:'million-case',name:'Millionenkoffer',rarity:'epic',emoji:'🧳',series:'Koffer'},
{id:'diamond-crown',name:'Diamantenkrone',rarity:'legendary',emoji:'👑',series:'Goldstudio'},
{id:'golden-million',name:'Goldene Million',rarity:'legendary',emoji:'🏆',series:'Koffer'},
{id:'banker-legend',name:'Die Legende des Bankers',rarity:'legendary',emoji:'🃏',series:'Banker'}
]);
const CARD_PACKS=Object.freeze([
{id:'rare',name:'Seltenes Kartenpaket',emoji:'💠',price:25000000,count:3,guaranteed:'rare',weights:{common:65,rare:29,epic:5,legendary:1}},
{id:'legendary',name:'Legendäres Kartenpaket',emoji:'👑',price:150000000,count:5,guaranteed:'epic',weights:{common:25,rare:45,epic:24,legendary:6}}
]);
const rarities=['common','rare','epic','legendary'];
function drawCard(minRarity='common',rand=randomInt){const choices=CARD_DEFINITIONS.filter(c=>rarities.indexOf(c.rarity)>=rarities.indexOf(minRarity));const weights=choices.map(c=>({card:c,weight:(pack.id==='premium'?{common:50,rare:25,epic:5,legendary:20}:{common:65,rare:29,epic:5,legendary:1})[c.rarity]}));const total=weights.reduce((a,b)=>a+b.weight,0);let n=rand(total);for(const entry of weights){n-=entry.weight;if(n<0)return entry.card}return weights.at(-1).card}
function openPack(pack,rand=randomInt){const cards=[];for(let i=0;i<pack.count;i++){if(i===0)cards.push(drawCard(pack.guaranteed,rand));else{let n=rand(100),rarity='common';for(const level of rarities){n-=pack.weights[level];if(n<0){rarity=level;break}}const options=CARD_DEFINITIONS.filter(c=>c.rarity===rarity);cards.push(options[rand(options.length)])}}return cards}

// Christmas album is isolated from the permanent Goldstudio collection.
const CHRISTMAS_COLLECTION='deal_or_no_deal_christmas_v1';
const CHRISTMAS_PACKS=Object.freeze([
{id:'small',name:'Kleines Weihnachtspaket',price:20000000,count:3,guaranteed:'common',guaranteedCount:0,weights:{common:65,rare:29,epic:5,legendary:1}},
{id:'large',name:'Großes Weihnachtspaket',price:50000000,count:7,guaranteed:'rare',guaranteedCount:1,weights:{common:55,rare:32,epic:10,legendary:3}},
{id:'premium',name:'Premium-Weihnachtspaket',price:100000000,count:12,guaranteed:'epic',guaranteedCount:2,weights:{common:40,rare:35,epic:17,legendary:8}}
]);
// Exclusive Bingo 28 pack: 16 cards, including one guaranteed legendary and
// three further epic-or-better. Not for sale in the regular card shop.
const BINGO_PLATINUM_PACK=Object.freeze({id:'platinum',name:'Platin-Kartenpaket',count:16,
 guaranteed:'epic',guaranteedCount:3,weights:{common:30,rare:35,epic:25,legendary:10}});
function drawBingoPlatinumPack(){
 const legendary=christmasDraw({...BINGO_PLATINUM_PACK,count:1,guaranteed:'legendary',guaranteedCount:1});
 const rest=christmasDraw({...BINGO_PLATINUM_PACK,count:15});
 return [...legendary,...rest];
}
const CODE=/^(?:\d{3}|[A-HJ-NP-Z2-9]{6})$/;
export function installDealOrNoDeal(app,{verifyProfile,getFirestore}){
 const collection='deal_or_no_deal_matches_v1';
 const dealSockets=new Map();
 const sendSocket=(ws,message)=>{if(ws.readyState===1)try{ws.send(JSON.stringify(message))}catch{}};
 const broadcastGame=(code,game)=>{
  const listeners=dealSockets.get(code);if(!listeners?.size)return;
  const view=publicView(game);
  for(const ws of listeners)sendSocket(ws,{type:'deal-state',game:view});
 };
 const attachSocket=(ws)=>{
  let joined=null,joinedUid=null,authenticated=false,reauthenticating=false,expiry=null;
  // Verify the SAME signed-in player and live room membership periodically
  // without dropping every active game socket after two minutes.
  // The hard expiry still closes abandoned or failed-to-refresh sessions.
  const resetExpiry=()=>{
   clearTimeout(expiry);
   expiry=setTimeout(()=>{if(ws.readyState===1)ws.close(1000,'REAUTH_REQUIRED')},120000);
   expiry.unref?.();
  };
  resetExpiry();
  ws.on('message',async raw=>{
   let msg;try{msg=JSON.parse(String(raw))}catch{return};
   if(msg?.type==='ping'){if(joined){sendSocket(ws,{type:'pong',serverNow:Date.now(),clientSentAt:Number.isSafeInteger(msg.clientSentAt)?msg.clientSentAt:null});if(Number.isSafeInteger(msg.revision)){try{const db=getFirestore();if(db){const latest=await readGame(db,joined);if(ws.readyState===1&&latest&&Number(latest.revision)!==msg.revision)sendSocket(ws,{type:'deal-state',game:latest})}}catch(error){console.warn('[deal-sync-ping]',String(error?.message||error))}}}return}
   if(msg?.type==='reauth'){
    if(!joined||!joinedUid||!authenticated||reauthenticating||ws.readyState!==1)return;
    const token=String(msg.token||'');
    if(!token||token.length>8192){sendSocket(ws,{type:'deal-error',error:'INVALID_REAUTH'});ws.close(1008,'INVALID_REAUTH');return}
    reauthenticating=true;
    try{
     const identity=await verifyProfile(token);
     if(!identity||identity.uid!==joinedUid)throw Error('LOGIN_REQUIRED');
     const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
     await check(db,joined,identity.uid); // Fresh membership check: never use stale room cache.
     if(ws.readyState!==1)return;
     resetExpiry();
     sendSocket(ws,{type:'deal-reauthenticated',serverNow:Date.now()});
    }catch(error){
     sendSocket(ws,{type:'deal-error',error:String(error?.message||'REAUTH_FAILED')});
     if(ws.readyState===1)ws.close(1008,'REAUTH_FAILED');
    }finally{reauthenticating=false}
    return;
   }
   if(msg?.type!=='subscribe'||authenticated)return;
   authenticated=true;
   const code=String(msg.code||'').toUpperCase(),token=String(msg.token||'');
   if(!CODE.test(code)||!token||token.length>8192){sendSocket(ws,{type:'deal-error',error:'INVALID_SUBSCRIPTION'});ws.close(1008);return}
   try{
    const identity=await verifyProfile(token);
    if(!identity)throw Error('LOGIN_REQUIRED');
    const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
    await check(db,code,identity.uid);
    if(ws.readyState!==1)return;
    joined=code;joinedUid=identity.uid;
    if(!dealSockets.has(code))dealSockets.set(code,new Set());
    dealSockets.get(code).add(ws);
    sendSocket(ws,{type:'deal-subscribed',code,serverNow:Date.now(),clientSentAt:Number.isSafeInteger(msg.clientSentAt)?msg.clientSentAt:null});
    // Subscribe before snapshot: any concurrent mutation is reconciled by revision.
    const game=await readGame(db,code);
    if(ws.readyState===1)sendSocket(ws,{type:'deal-state',game});
   }catch(error){sendSocket(ws,{type:'deal-error',error:String(error?.message||'SUBSCRIPTION_FAILED')});ws.close(1008)}
  });
  ws.on('close',()=>{clearTimeout(expiry);if(joined){const peers=dealSockets.get(joined);peers?.delete(ws);if(peers?.size===0)dealSockets.delete(joined)}});
 };

 const auth=async(req,res,next)=>{try{const token=/^Bearer (.+)$/i.exec(req.get('authorization')||'')?.[1];const identity=await verifyProfile(token);if(!identity)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});req.dealIdentity=identity;next()}catch{return res.status(401).json({ok:false,error:'AUTH_FAILED'})}};
 const fail=(res,e)=>{const message=String(e?.message||'ERROR');return res.status(message==='NOT_IN_ROOM'?403:message==='ROOM_NOT_FOUND'?404:409).json({ok:false,error:message})};
 // This collection name must match the hub room storage configuration.
 // Share simultaneous game-state reads across players. Authorization remains per request.
 // Mutations invalidate immediately; generation prevents an in-flight stale read
 // from overwriting a newly committed state.
 // In-process diagnostic counters: no Firestore writes, no personal identifiers.
 // These count application read attempts, not Firebase's billed document reads.
 const firestoreUsage={startedAt:Date.now(),gameReads:0,gameCacheHits:0,roomReads:0,roomCacheHits:0,gameActions:0,avatarReads:0,avatarCacheHits:0,settlementRuns:0,settlementCacheHits:0,walletReads:0,christmasReads:0,rewardReads:0};
 const usageTimer=setInterval(()=>{
  const elapsedMinutes=Math.max(1,(Date.now()-firestoreUsage.startedAt)/60000);
  console.info('[deal-firestore-usage]',JSON.stringify({
   minutes:Number(elapsedMinutes.toFixed(1)),
   gameReads:firestoreUsage.gameReads,gameCacheHits:firestoreUsage.gameCacheHits,
   roomReads:firestoreUsage.roomReads,roomCacheHits:firestoreUsage.roomCacheHits,
   gameActions:firestoreUsage.gameActions,avatarReads:firestoreUsage.avatarReads,avatarCacheHits:firestoreUsage.avatarCacheHits,settlementRuns:firestoreUsage.settlementRuns,settlementCacheHits:firestoreUsage.settlementCacheHits,walletReads:firestoreUsage.walletReads,christmasReads:firestoreUsage.christmasReads,rewardReads:firestoreUsage.rewardReads
  }));
 },60000);
 usageTimer.unref?.();
 const gameCache=new Map();
 const gameGenerations=new Map();
 const invalidateGame=code=>{gameGenerations.set(code,(gameGenerations.get(code)||0)+1);gameCache.delete(code)};
 const readGame=async(db,code)=>{
  const now=Date.now(),existing=gameCache.get(code);
  if(existing&&existing.expires>now){firestoreUsage.gameCacheHits++;return existing.promise;}
  const generation=gameGenerations.get(code)||0;
  firestoreUsage.gameReads++;
  const promise=db.collection(collection).doc(code).get().then(snap=>snap.exists?publicView(snap.data().game):null);
  gameCache.set(code,{promise,expires:now+2500});
  if(gameCache.size>300){for(const [key,item] of gameCache){if(item.expires<=now)gameCache.delete(key)}if(gameCache.size>300)gameCache.delete(gameCache.keys().next().value)}
  try{const result=await promise;if((gameGenerations.get(code)||0)!==generation)return readGame(db,code);return result}catch(error){if((gameGenerations.get(code)||0)===generation&&gameCache.get(code)?.promise===promise)gameCache.delete(code);throw error}
 };
 const hubCollection='spielesammlung_hub_v1';
 const avatarCollection='deal_or_no_deal_avatars_v1';
 const walletCollection='deal_or_no_deal_wallets_v1';
 const payoutCollection='deal_or_no_deal_payouts_v1';
  // One in-game purchase per player and match; all stored amounts are cents.
  const DOUBLE_BOOST_COST_CENTS=300000000;
 const inventoryCollection='deal_or_no_deal_inventory_v1';
 // Cache only GET membership checks for 2 seconds; all mutations use a fresh room read.
 // Never cache membership failures. A removed user can retain read access for at most 2s.
 // Avatar reads are shared across all players in the same room.
 // Successful avatar changes invalidate immediately; expired entries are discarded.
 const avatarReadCache=new Map();
 const avatarCacheGenerations=new Map();
 const invalidateAvatars=code=>{avatarCacheGenerations.set(code,(avatarCacheGenerations.get(code)||0)+1);avatarReadCache.delete(code)};
 const readAvatars=async(db,code)=>{
  const now=Date.now(),cached=avatarReadCache.get(code);
  if(cached&&cached.expires>now){firestoreUsage.avatarCacheHits++;return cached.promise;}
  firestoreUsage.avatarReads++;
  const generation=avatarCacheGenerations.get(code)||0;
  const promise=db.collection(avatarCollection).doc(code).get().then(snap=>snap.exists?snap.data().avatars||{}:{});
  avatarReadCache.set(code,{promise,expires:now+30000});
  if(avatarReadCache.size>300){for(const [key,item] of avatarReadCache){if(item.expires<=now)avatarReadCache.delete(key)}if(avatarReadCache.size>300)avatarReadCache.delete(avatarReadCache.keys().next().value)}
  try{const result=await promise;if((avatarCacheGenerations.get(code)||0)!==generation)return readAvatars(db,code);return result}catch(error){if(avatarReadCache.get(code)?.promise===promise)avatarReadCache.delete(code);throw error}
 };
 const roomReadCache=new Map();
 // In-flight requests for the same hub room are one Firestore read even when
 // three players act at nearly the same moment. The promise is discarded as
 // soon as it settles: write operations still check fresh room membership.
 const roomReadsInFlight=new Map();
 const freshRoomSnapshot=(db,code)=>{
  const running=roomReadsInFlight.get(code);
  if(running){firestoreUsage.roomCacheHits++;return running}
  firestoreUsage.roomReads++;
  const promise=db.collection(hubCollection).doc(code).get();
  roomReadsInFlight.set(code,promise);
  const clear=()=>{if(roomReadsInFlight.get(code)===promise)roomReadsInFlight.delete(code)};
  promise.then(clear,clear);
  return promise;
 };
 const check=async(db,code,uid,allowCache=false)=>{
  const now=Date.now();
  let entry=allowCache?roomReadCache.get(code):null;
  if(!entry||entry.expires<=now){
   const promise=freshRoomSnapshot(db,code);
   entry={promise,expires:now+2000};
   if(allowCache){
    roomReadCache.set(code,entry);
    if(roomReadCache.size>300){for(const [key,item] of roomReadCache){if(item.expires<=now)roomReadCache.delete(key)}if(roomReadCache.size>300)roomReadCache.delete(roomReadCache.keys().next().value)}
   }
  }else if(allowCache){firestoreUsage.roomCacheHits++;}
  let snap;
  try{snap=await entry.promise}catch(e){if(roomReadCache.get(code)===entry)roomReadCache.delete(code);throw e}
  if(!snap.exists)throw Error('ROOM_NOT_FOUND');
  const room=snap.data();
  if(!room.players?.some(p=>p.uid===uid&&!p.testBot&&!p.bot))throw Error('NOT_IN_ROOM');
  return room
 };
 // Idempotent reconciliation also repairs a final match whose payout was not credited.
 // Only reconcile a finished game once per running server. A restart safely
 // rechecks Firestore receipts; rejected transactions are never cached.
 const settledGames=new Map();
 const settleFinalOnce=async(db,code,gameId)=>{
  const key=code+':'+gameId;
  const previous=settledGames.get(key);
  if(previous){firestoreUsage.settlementCacheHits++;return previous;}
  firestoreUsage.settlementRuns++;
  const promise=settleFinal(db,code).then(result=>{
   if(result!==gameId){settledGames.delete(key);return result;}
   return result;
  }).catch(error=>{settledGames.delete(key);throw error});
  settledGames.set(key,promise);
  if(settledGames.size>300)settledGames.delete(settledGames.keys().next().value);
  return promise;
 };
 // Event chest credits remain inside the existing exactly-once Deal
 // payout transaction. Only expedition members receive 100-Tore chests;
 // all other players keep their previous chest type and inventory.
 const chestAwardContext=async(db,tx)=>{
  const teamRef=db.collection(DOG_BOSS_TEAM_COLLECTION).doc(DOG_BOSS_TEAM_ID);
  const teamSnap=await tx.get(teamRef);
  const members=new Set(Array.isArray(teamSnap.exists?teamSnap.data()?.members:null)?
   teamSnap.data().members.map(m=>m.uid):[]);
  if(!members.size)return {members,progress:dogGateProgress(null)};
  const progressSnap=await tx.get(db.collection(DOG_GATE_PROGRESS_COLLECTION).doc(DOG_GATE_PROGRESS_ID));
  return {members,progress:dogGateProgress(progressSnap.exists?progressSnap.data():null)};
 };
 const chestForSettledDeal=(uid,raw,ctx)=>{
  if(!ctx.members.has(uid))return addVerifiedChestToInventory(raw);
  const progress=ctx.progress.people[uid],gate=progress?.highestGate??1;
  return addExpeditionChestToInventory(raw,dogChestOffer(gate));
 };
 const settleFinal=async(db,code)=>{const matchRef=db.collection(collection).doc(code);return db.runTransaction(async tx=>{const match=await tx.get(matchRef);if(!match.exists)return false;const game=match.data().game;if(!game||!['final','done'].includes(game.phase)||!Array.isArray(game.values))return false;
 const chestContext=await chestAwardContext(db,tx);
 const payouts=game.players.map(p=>({uid:p.id,amount:payoutFor(game,p)}));if(payouts.some(p=>!Number.isSafeInteger(p.amount)||p.amount<0))throw Error('INVALID_PAYOUT');const maximum=Math.max(...payouts.map(p=>p.amount));
 const refs=payouts.map(p=>({...p,wallet:db.collection(walletCollection).doc(p.uid),receipt:db.collection(payoutCollection).doc(game.id+'_'+p.uid),materials:db.collection(DOG_MATERIALS_COLLECTION).doc(p.uid)}));
 const reads=await Promise.all(refs.map(async p=>({wallet:await tx.get(p.wallet),receipt:await tx.get(p.receipt),materials:await tx.get(p.materials)})));let changed=false;
 for(let i=0;i<refs.length;i++){const p=refs[i],old=reads[i];if(old.receipt.exists)continue;const previous=old.wallet.exists?old.wallet.data():{};tx.set(p.wallet,{balance:(previous.balance||0)+p.amount,games:(previous.games||0)+1,wins:(previous.wins||0)+(p.amount===maximum?1:0),updatedAt:Date.now()},{merge:true});tx.set(p.materials,chestForSettledDeal(p.uid,old.materials.exists?old.materials.data():null,chestContext));tx.create(p.receipt,{gameId:game.id,uid:p.uid,amount:p.amount,createdAt:Date.now()});changed=true}return game.id})};
 app.get('/api/deal-or-no-deal/shop/catalog',auth,(req,res)=>res.json({ok:true,items:SHOP_ITEMS,minPrice:100000000}));
 app.get('/api/deal-or-no-deal/shop/me',auth,async(req,res)=>{try{const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');const uid=req.dealIdentity.uid;const [wallet,inventory]=await Promise.all([db.collection(walletCollection).doc(uid).get(),db.collection(inventoryCollection).doc(uid).get()]);return res.json({ok:true,balance:wallet.exists?wallet.data().balance||0:0,games:wallet.exists?wallet.data().games||0:0,owned:inventory.exists?inventory.data().owned||[]:[],items:SHOP_ITEMS})}catch(e){return fail(res,e)}});
 app.post('/api/deal-or-no-deal/shop/buy',auth,async(req,res)=>{try{const item=SHOP_ITEMS.find(x=>x.id===req.body?.itemId);if(!item)throw Error('INVALID_ITEM');const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');const uid=req.dealIdentity.uid;const walletRef=db.collection(walletCollection).doc(uid),inventoryRef=db.collection(inventoryCollection).doc(uid);
 const result=await db.runTransaction(async tx=>{const [wallet,inventory]=await Promise.all([tx.get(walletRef),tx.get(inventoryRef)]);const balance=wallet.exists?wallet.data().balance||0:0;const owned=inventory.exists?inventory.data().owned||[]:[];if(owned.includes(item.id))throw Error('ALREADY_OWNED');if(balance<item.price)throw Error('INSUFFICIENT_FUNDS');const remaining=balance-item.price;tx.set(walletRef,{balance:remaining,updatedAt:Date.now()},{merge:true});tx.set(inventoryRef,{owned:[...owned,item.id],updatedAt:Date.now()},{merge:true});return {balance:remaining,owned:[...owned,item.id]}});return res.json({ok:true,...result,itemId:item.id})}catch(e){return fail(res,e)}});
 app.get('/api/deal-or-no-deal/cards/me',auth,async(req,res)=>{try{const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');const uid=req.dealIdentity.uid;const [wallet,snap]=await Promise.all([db.collection(walletCollection).doc(uid).get(),db.collection(CARD_COLLECTION).doc(uid).get()]);const inventory=snap.exists?snap.data():{};return res.json({ok:true,balance:wallet.exists?wallet.data().balance||0:0,cards:inventory.cards||{},opened:inventory.opened||0,definitions:CARD_DEFINITIONS,packs:CARD_PACKS.map(({weights,...p})=>({...p,probabilities:Object.fromEntries(rarities.map(r=>[r,Math.round(10000*CARD_DEFINITIONS.filter(c=>c.rarity===r).length*weights[r]/CARD_DEFINITIONS.reduce((sum,c)=>sum+weights[c.rarity],0))/100]))}))})}catch(e){return fail(res,e)}});
 app.post('/api/deal-or-no-deal/cards/open',auth,async(req,res)=>{try{const pack=CARD_PACKS.find(p=>p.id===req.body?.packId);if(!pack)throw Error('INVALID_PACK');const requestId=String(req.body?.requestId||'');if(!/^[a-zA-Z0-9_-]{12,90}$/.test(requestId))throw Error('INVALID_REQUEST_ID');const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');const uid=req.dealIdentity.uid;const walletRef=db.collection(walletCollection).doc(uid),cardsRef=db.collection(CARD_COLLECTION).doc(uid);
 const result=await db.runTransaction(async tx=>{const [wallet,snap]=await Promise.all([tx.get(walletRef),tx.get(cardsRef)]);const previous=snap.exists?snap.data():{};if(previous.lastPurchase?.requestId===requestId){if(previous.lastPurchase.packId!==pack.id)throw Error('INVALID_REQUEST_ID');return {...previous.lastPurchase.result,replayed:true}}const balance=wallet.exists?wallet.data().balance||0:0;if(!Number.isSafeInteger(balance)||balance<pack.price)throw Error('INSUFFICIENT_FUNDS');const owned={...(previous.cards||{})};const cards=openPack(pack);for(const card of cards)owned[card.id]=(owned[card.id]||0)+1;const remaining=balance-pack.price;tx.set(walletRef,{balance:remaining,updatedAt:Date.now()},{merge:true});const purchaseResult={balance:remaining,cards:owned,opened:(previous.opened||0)+1,revealed:cards.map(({id,name,rarity,emoji,series})=>({id,name,rarity,emoji,series}))};tx.set(cardsRef,{cards:owned,opened:purchaseResult.opened,lastPurchase:{requestId,packId:pack.id,result:purchaseResult},updatedAt:Date.now()},{merge:true});return purchaseResult});return res.json({ok:true,...result})}catch(e){return fail(res,e)}});

 app.get('/api/deal-or-no-deal/christmas/me',auth,async(req,res)=>{try{const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');const uid=req.dealIdentity.uid;const [wallet,snap]=await Promise.all([db.collection(walletCollection).doc(uid).get(),db.collection(CHRISTMAS_COLLECTION).doc(uid).get()]);const data=snap.exists?snap.data():{};const cards=data.cards||{};return res.json({ok:true,balance:wallet.exists?wallet.data().balance||0:0,cards,opened:data.opened||0,definitions:CHRISTMAS_CARDS,packs:CHRISTMAS_PACKS,progress:christmasProgress(cards),northPoleClaimed:Object.keys(data.northPoleMilestonesClaimed||{}),northPolePending:[...NORTH_POLE_MILESTONES.filter(m=>christmasProgress(cards).totalBingos>=m.at&&!data.northPoleMilestonesClaimed?.[m.id]).map(m=>m.id),...(data.northPoleMilestonesClaimed?.['north-premium-2']&&!data.northPolePremiumVouchersIssued?['north-premium-2']:[])],freePacks:Object.fromEntries(CHRISTMAS_PACKS.map(p=>[p.id,Math.max(0,Number(data.freeChristmasPacks?.[p.id])||0)])),hammerProgress:hammerBingoProgress(cards,data.hammerBingoClaimed,data.hammerBingoCycles),duplicates:christmasDuplicateStock(cards,data.duplicateReserve,data.monsterWheelTickets),monsterWheel:{durationMs:MONSTER_WHEEL_DURATION_MS,slots:MONSTER_WHEEL_SLOTS,tickets:data.monsterWheelTickets||0,lastSpin:data.monsterWheelLastSpin||null,giftzwergUnlocked:data.monsterGiftzwergUnlocked===true}})}catch(e){return fail(res,e)}});

 // Claim all reached Nordpol milestones once. This POST never trusts the
 // client to supply a Bingo total, prize type, quantity, or selected cards.
 // Pack milestones grant persistent vouchers; only the exclusive platinum combo
 // still reveals its included cards immediately. Legacy 22-Bingo winners receive
 // a one-time voucher backfill, without removing any previously opened cards.
 app.post('/api/deal-or-no-deal/christmas/north-pole/claim',auth,async(req,res)=>{
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const uid=req.dealIdentity.uid,now=Date.now();
   const albumRef=db.collection(CHRISTMAS_COLLECTION).doc(uid);
   const iceRef=db.collection('christmas_ice_progress_v1').doc(uid);
   const jokerRef=db.collection('deal_peek_inventory_v1').doc(uid);
   const hatsRef=db.collection('deal_christmas_hats_v1').doc(uid);
   const result=await db.runTransaction(async tx=>{
    const albumSnap=await tx.get(albumRef),album=albumSnap.exists?albumSnap.data():{};
    const claimed={...(album.northPoleMilestonesClaimed||{})};
    const progress=christmasProgress(album.cards||{});
    const pending=NORTH_POLE_MILESTONES.filter(m=>progress.totalBingos>=m.at&&!claimed[m.id]);
    // Older versions immediately opened the Bingo-22 Premium packs. Give those
    // players their two advertised shop vouchers once as a compatibility award.
    const legacyPremium=Boolean(claimed['north-premium-2'])&&!album.northPolePremiumVouchersIssued;
    if(!pending.length&&!legacyPremium)return {claimed:[],packs:[],progress,replayed:true};
    // Read all affected inventory documents before the first write.
    const needsHammer=pending.some(m=>['hammer','combo','grand'].includes(m.kind));
    const needsJoker=pending.some(m=>['joker','combo','grand'].includes(m.kind));
    const needsHats=pending.some(m=>['hats','grand'].includes(m.kind));
    const [iceSnap,jokerSnap,hatsSnap]=await Promise.all([
     needsHammer?tx.get(iceRef):Promise.resolve(null),
     needsJoker?tx.get(jokerRef):Promise.resolve(null),
     needsHats?tx.get(hatsRef):Promise.resolve(null)
    ]);
    const cards={...(album.cards||{})},packs=[];
    const freePacks={...(album.freeChristmasPacks||{})};
    if(legacyPremium)freePacks.premium=checkMonsterBalance(Number(freePacks.premium||0),2);
    let premiumVouchersIssued=Boolean(album.northPolePremiumVouchersIssued)||legacyPremium;
    let goldHammers=0,jokers=0,monsterTickets=0,hatsVouchers=0;
    const grantPack=(pack,drawn)=>{
     const revealed=markChristmasDiscoveries(drawn,cards);
     for(const card of revealed)cards[card.id]=checkMonsterBalance(Number(cards[card.id]||0),1);
     packs.push({packId:pack.id,packName:pack.name,revealed});
    };
    for(const m of pending){
     if(m.kind==='pack'){
      const pack=CHRISTMAS_PACKS.find(p=>p.id===m.packId);
      if(!pack)throw Error('INVALID_BINGO_PACK');
      freePacks[pack.id]=checkMonsterBalance(Number(freePacks[pack.id]||0),m.quantity);
      if(m.id==='north-premium-2')premiumVouchersIssued=true;
     }else if(m.kind==='hammer')goldHammers+=m.quantity;
     else if(m.kind==='joker')jokers+=m.quantity;
     else if(m.kind==='combo'){
      goldHammers+=1;jokers+=1;
      grantPack(BINGO_PLATINUM_PACK,drawBingoPlatinumPack());
     }else if(m.kind==='monster')monsterTickets+=m.quantity;
     else if(m.kind==='hats')hatsVouchers+=m.quantity;
     else if(m.kind==='grand'){
      goldHammers+=m.hammers;jokers+=m.jokers;hatsVouchers+=m.hatsVouchers;
     }else throw Error('INVALID_BINGO_REWARD');
     claimed[m.id]=now;
    }
    if(needsHammer){
     const ice=iceSnap?.exists?normalizeIceState(iceSnap.data()):newIceState();
     tx.set(iceRef,{...ice,
      freeHammers:{...ice.freeHammers,lucky:checkMonsterBalance(Number(ice.freeHammers?.lucky||0),goldHammers)},
      wheelHammers:{...ice.wheelHammers,lucky:checkMonsterBalance(Number(ice.wheelHammers?.lucky||0),goldHammers)},
      updatedAt:now
     });
    }
    if(needsJoker){
     const balance=Number(jokerSnap?.data()?.balance)||0;
     tx.set(jokerRef,{balance:checkMonsterBalance(balance,jokers,1000000),updatedAt:now},{merge:true});
    }
    if(needsHats){
     const previous=hatsSnap?.exists?hatsSnap.data():{};
     const bonusTickets=checkMonsterBalance(Number(previous.bonusTickets||0),hatsVouchers,1000000);
     // Grant into the player's existing Hats account without starting a game.
     // First-time players keep their free starter voucher too.
     tx.set(hatsRef,{
      ...(hatsSnap?.exists?{}:{voucherOnly:true}),
      bonusTickets,updatedAt:now
     },{merge:true});
    }
    tx.set(albumRef,{
     cards,opened:checkMonsterBalance(Number(album.opened||0),packs.length),
     monsterWheelTickets:checkMonsterBalance(Number(album.monsterWheelTickets||0),monsterTickets),
     freeChristmasPacks:freePacks,northPolePremiumVouchersIssued:premiumVouchersIssued,
     northPoleMilestonesClaimed:claimed,updatedAt:now
    },{merge:true});
    return {claimed:[...pending.map(({at,id,name})=>({at,id,name})),
      ...(legacyPremium?[{at:22,id:'north-premium-2',name:'2 Premium-Kartenpakete nachgebucht'}]:[])],
     packs,freePacks,goldHammers,jokers,monsterTickets,hatsVouchers,
     progress:christmasProgress(cards),replayed:false};
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...result});
  }catch(e){return fail(res,e)}
 });
 app.post('/api/deal-or-no-deal/christmas/open',auth,async(req,res)=>{
  try{
   const pack=CHRISTMAS_PACKS.find(p=>p.id===req.body?.packId);
   if(!pack)throw Error('INVALID_PACK');
   const requestId=String(req.body?.requestId||'');
   if(!/^[a-zA-Z0-9_-]{12,90}$/.test(requestId))throw Error('INVALID_REQUEST_ID');
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const uid=req.dealIdentity.uid,now=Date.now();
   const walletRef=db.collection(walletCollection).doc(uid);
   const cardsRef=db.collection(CHRISTMAS_COLLECTION).doc(uid);
   const receiptRef=db.collection('deal_or_no_deal_christmas_receipts_v1').doc(uid+'_'+requestId);
   const result=await db.runTransaction(async tx=>{
    const [wallet,snap,receipt]=await Promise.all([tx.get(walletRef),tx.get(cardsRef),tx.get(receiptRef)]);
    if(receipt.exists){
     if(receipt.data().packId!==pack.id)throw Error('INVALID_REQUEST_ID');
     return {...receipt.data().result,replayed:true};
    }
    const balance=Number(wallet.data()?.balance)||0;
    if(!Number.isSafeInteger(balance)||balance<0)throw Error('INVALID_WALLET_BALANCE');
    const previous=snap.exists?snap.data():{};
    const freePacks={...(previous.freeChristmasPacks||{})};
    const vouchers=Number(freePacks[pack.id]||0);
    if(!Number.isSafeInteger(vouchers)||vouchers<0)throw Error('INVALID_FREE_PACKS');
    const usedFreePack=vouchers>0;
    if(!usedFreePack&&balance<pack.price)throw Error('INSUFFICIENT_FUNDS');
    if(usedFreePack)freePacks[pack.id]=vouchers-1;
    const cards={...(previous.cards||{})};
    const drawn=markChristmasDiscoveries(christmasDraw(pack),previous.cards||{});
    for(const card of drawn)cards[card.id]=checkMonsterBalance(Number(cards[card.id]||0),1);
    const remaining=usedFreePack?balance:balance-pack.price;
    const result={balance:remaining,cards,opened:(previous.opened||0)+1,
     revealed:drawn,usedFreePack,freePacks,progress:christmasProgress(cards),
     hammerProgress:hammerBingoProgress(cards,previous.hammerBingoClaimed,previous.hammerBingoCycles),
     duplicates:christmasDuplicateStock(cards,previous.duplicateReserve,previous.monsterWheelTickets)};
    // Free packages consume only their saved voucher; the wallet is untouched.
    // Paid purchases still debit the wallet atomically together with the album.
    if(!usedFreePack)tx.set(walletRef,{balance:remaining,updatedAt:now},{merge:true});
    tx.set(cardsRef,{cards,opened:result.opened,freeChristmasPacks:freePacks,updatedAt:now},{merge:true});
    tx.create(receiptRef,{packId:pack.id,result,createdAt:now});
    return result;
   });
   return res.json({ok:true,...result});
  }catch(e){return fail(res,e)}
 });
 // Exchange is server-authoritative. This grants a saved Monster-Wheel
 // ticket, NOT a speculative prize; the wheel/reward catalog comes later.
 // An idempotency receipt makes network retries and competing tabs safe.
 app.post('/api/deal-or-no-deal/christmas/duplicates/exchange',auth,async(req,res)=>{
  try{
   const requestId=String(req.body?.requestId||'');
   if(!/^[a-zA-Z0-9_-]{12,90}$/.test(requestId))throw Error('INVALID_REQUEST_ID');
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const uid=req.dealIdentity.uid;
   const albumRef=db.collection(CHRISTMAS_COLLECTION).doc(uid);
   const receiptRef=db.collection('deal_christmas_monster_exchanges_v1').doc(uid+'_'+requestId);
   const result=await db.runTransaction(async tx=>{
    const [snap,receipt]=await Promise.all([tx.get(albumRef),tx.get(receiptRef)]);
    if(receipt.exists)return {...receipt.data().result,replayed:true};
    const old=snap.exists?snap.data():{};
    const exchanged=redeemChristmasDuplicates(old.cards||{},old.duplicateReserve);
    const priorTickets=old.monsterWheelTickets||0,priorTrades=old.monsterWheelTradeCount||0;
    if(!Number.isSafeInteger(priorTickets)||priorTickets<0||priorTickets>=Number.MAX_SAFE_INTEGER
      ||!Number.isSafeInteger(priorTrades)||priorTrades<0||priorTrades>=Number.MAX_SAFE_INTEGER)
     throw Error('MONSTER_TICKET_OVERFLOW');
    const tickets=priorTickets+1;
    const duplicates=christmasDuplicateStock(exchanged.cards,exchanged.reserve,tickets);
    const result={cards:exchanged.cards,duplicates,monsterWheelTickets:tickets,
     progress:christmasProgress(exchanged.cards),
     hammerProgress:hammerBingoProgress(exchanged.cards,old.hammerBingoClaimed,old.hammerBingoCycles),
     replayed:false};
    const updatedAt=Date.now();
    tx.set(albumRef,{cards:exchanged.cards,duplicateReserve:exchanged.reserve,
     monsterWheelTickets:tickets,monsterWheelTradeCount:priorTrades+1,updatedAt},{merge:true});
    tx.create(receiptRef,{uid,requestId,result,createdAt:updatedAt});
    return result;
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...result});
  }catch(e){return fail(res,e)}
 });

 // The entire Monster Wheel is paid out server-side BEFORE the 8-second
 // animation. A receipt makes POST retries idempotent; the client never chooses
 // its own index or prize. Exactly one ticket is consumed per committed spin.
 app.post('/api/deal-or-no-deal/christmas/monster/spin',auth,async(req,res)=>{
  try{
   const requestId=String(req.body?.requestId||'');
   if(!/^[A-Za-z0-9_-]{12,90}$/.test(requestId))throw Error('INVALID_REQUEST_ID');
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const uid=req.dealIdentity.uid;
   const albumRef=db.collection(CHRISTMAS_COLLECTION).doc(uid);
   const receiptRef=db.collection('deal_christmas_monster_spins_v1').doc(uid+'_'+requestId);
   const walletRef=db.collection(walletCollection).doc(uid);
   const iceRef=db.collection('christmas_ice_progress_v1').doc(uid);
   const jokerRef=db.collection('deal_peek_inventory_v1').doc(uid);
   const result=await db.runTransaction(async tx=>{
    const [albumSnap,receiptSnap]=await Promise.all([tx.get(albumRef),tx.get(receiptRef)]);
    if(receiptSnap.exists)return {...receiptSnap.data().result,replayed:true};
    const album=albumSnap.exists?albumSnap.data():{};
    const tickets=album.monsterWheelTickets||0;
    if(!Number.isSafeInteger(tickets)||tickets<1)throw Error('NO_MONSTER_TICKETS');
    const prize=drawMonsterWheel({giftzwergUnlocked:album.monsterGiftzwergUnlocked===true});
    // All Firestore reads precede all writes, as required for transactions.
    const prizeSnapshot=prize.kind==='cash'||prize.kind==='randomCash'
     ?await tx.get(walletRef)
     :prize.kind==='hammer'?await tx.get(iceRef)
     :prize.kind==='joker'?await tx.get(jokerRef):null;
    const now=Date.now();
    const patch={monsterWheelTickets:tickets-1,monsterWheelSpinCount:checkMonsterBalance(album.monsterWheelSpinCount||0,1),
     updatedAt:now};
    const spin={id:requestId,prize,createdAt:now};
    if(prize.kind==='cash'||prize.kind==='randomCash'){
     const balance=Number(prizeSnapshot?.data()?.balance)||0;
     const nextBalance=checkMonsterBalance(balance,prize.amountCents);
     tx.set(walletRef,{balance:nextBalance,updatedAt:now},{merge:true});
     spin.balance=nextBalance;
    }else if(prize.kind==='pack'){
     const pack=CHRISTMAS_PACKS.find(p=>p.id===prize.packId);
     if(!pack)throw Error('INVALID_MONSTER_PACK');
     const drawn=markChristmasDiscoveries(Array.from({length:prize.quantity},()=>christmasDraw(pack)).flat(),album.cards||{});
     const cards={...(album.cards||{})};
     for(const card of drawn)cards[card.id]=checkMonsterBalance(cards[card.id]||0,1);
     patch.cards=cards;
     patch.opened=checkMonsterBalance(album.opened||0,prize.quantity);
     spin.revealed=drawn;
     spin.packId=pack.id;
     spin.packCount=prize.quantity;
    }else if(prize.kind==='hammer'){
     const ice=prizeSnapshot?.exists?normalizeIceState(prizeSnapshot.data()):newIceState();
     const freeHammers={...ice.freeHammers},wheelHammers={...ice.wheelHammers};
     freeHammers[prize.hammer]=checkMonsterBalance(Number(freeHammers[prize.hammer]||0),prize.quantity);
     wheelHammers[prize.hammer]=checkMonsterBalance(Number(wheelHammers[prize.hammer]||0),prize.quantity);
     tx.set(iceRef,{...ice,freeHammers,wheelHammers,updatedAt:now});
    }else if(prize.kind==='joker'){
     const balance=Number(prizeSnapshot?.data()?.balance)||0;
     tx.set(jokerRef,{balance:checkMonsterBalance(balance,prize.quantity,1000000),updatedAt:now},{merge:true});
    }else if(prize.kind==='avatar'){
     patch.monsterGiftzwergUnlocked=true;
    }else throw Error('INVALID_MONSTER_PRIZE');
    patch.monsterWheelLastSpin=spin;
    tx.set(albumRef,patch,{merge:true});
    const settled={spin,monsterWheelTickets:tickets-1,
     giftzwergUnlocked:patch.monsterGiftzwergUnlocked===true||album.monsterGiftzwergUnlocked===true,
     durationMs:MONSTER_WHEEL_DURATION_MS,replayed:false};
    tx.create(receiptRef,{uid,requestId,result:settled,createdAt:now});
    return settled;
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...result});
  }catch(e){return fail(res,e)}
 });

 // Exactly-once Hammer-Bingo payout: claims and hammer inventory are committed
 // in the SAME Firestore transaction, even if the browser retries the request.
 // Other Christmas pack sources also persist cards into CHRISTMAS_COLLECTION,
 // so one claim route covers paid packs, banker, 1-cent and final-wheel rewards.
 app.post('/api/deal-or-no-deal/christmas/hammer/claim',auth,async(req,res)=>{
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const uid=req.dealIdentity.uid;
   const albumRef=db.collection(CHRISTMAS_COLLECTION).doc(uid);
   const iceRef=db.collection('christmas_ice_progress_v1').doc(uid);
   // Reading and writing these two documents within one transaction guarantees
   // that a retry / second tab / competing pack does not double the award.
   const result=await db.runTransaction(async tx=>{
    const [albumSnap,iceSnap]=await Promise.all([tx.get(albumRef),tx.get(iceRef)]);
    const album=albumSnap.exists?albumSnap.data():{};
    const delta=settleHammerBingoCycle(album.cards||{},album.hammerBingoClaimed,album.hammerBingoCycles);
    const progress=hammerBingoProgress(delta.cards,delta.claims,delta.cycles);
    const classicProgress=christmasProgress(delta.cards);
    const priorReserve=Number.isSafeInteger(album.duplicateReserve)&&album.duplicateReserve>=0?album.duplicateReserve:0;
    const nextReserve=priorReserve+christmasHammerDuplicatesSaved(album.cards||{},delta.jackpots);
    const duplicates=christmasDuplicateStock(delta.cards,nextReserve,album.monsterWheelTickets);
    if(!delta.changed)return {
     awarded:[],jackpots:[],totals:delta.totals,hammerProgress:progress,progress:classicProgress,duplicates,replayed:true
    };
    const oldIce=iceSnap.exists?normalizeIceState(iceSnap.data()):newIceState();
    const freeHammers={...oldIce.freeHammers},wheelHammers={...oldIce.wheelHammers};
    for(const kind of ['single','double','lucky']){
     const amount=delta.totals[kind];
     freeHammers[kind]=(Number(freeHammers[kind])||0)+amount;
     // v2's separately tracked grants must be persisted in both ledgers.
     wheelHammers[kind]=(Number(wheelHammers[kind])||0)+amount;
    }
    tx.set(iceRef,{...oldIce,freeHammers,wheelHammers});
    // Explicit zero-valued card keys clear only the completed 16-card board.
    // All old 32 cards and the other 16-card board are preserved.
    tx.set(albumRef,{
     cards:delta.cards,
     duplicateReserve:nextReserve,
     hammerBingoClaimed:delta.claims,
     hammerBingoCycles:delta.cycles,
     hammerBingoAwardedAt:Date.now()
    },{merge:true});
    return {
     awarded:delta.awarded,jackpots:delta.jackpots,totals:delta.totals,
     hammerProgress:progress,progress:classicProgress,cards:delta.cards,duplicates,replayed:false
    };
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...result});
  }catch(e){return fail(res,e)}
 });
 app.get('/api/deal-or-no-deal/:code/christmas-wheel-status',auth,async(req,res)=>{try{
  const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');
  const db=getFirestore();await check(db,code,req.dealIdentity.uid,true);
  const kind=String(req.query.kind||''),rewardId=String(req.query.rewardId||'');
  if(!['cent','banker','final'].includes(kind)||!rewardId||rewardId.length>180)throw Error('INVALID_REWARD');
  const game=await readGame(db,code);if(!game)return res.json({ok:true,startedAt:null});
  const prefix=game.id+(kind==='final'?'':'_');
  if(!rewardId.startsWith(prefix))throw Error('INVALID_REWARD');
  return res.json({ok:true,startedAt:game.christmasWheelSpins?.[kind+':'+rewardId]||null,serverNow:Date.now(),gameId:game.id});
 }catch(e){return fail(res,e)}});
 app.post('/api/deal-or-no-deal/:code/christmas-wheel-spin',auth,async(req,res)=>{try{
  const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');
  const db=getFirestore();await check(db,code,req.dealIdentity.uid);
  const kind=String(req.body?.kind||''),rewardId=String(req.body?.rewardId||'');
  if(!['cent','banker','final'].includes(kind)||!rewardId||rewardId.length>180)throw Error('INVALID_REWARD');
  const collections={cent:'deal_christmas_cent_rewards_v1',banker:'deal_christmas_banker_rewards_v1',final:'deal_christmas_final_rewards_v1'};
  const ref=db.collection(collection).doc(code),rewardRef=db.collection(collections[kind]).doc(rewardId);
  const game=await db.runTransaction(async tx=>{
   const [gameSnap,rewardSnap]=await Promise.all([tx.get(ref),tx.get(rewardRef)]);
   if(!gameSnap.exists||!rewardSnap.exists)throw Error('REWARD_NOT_FOUND');
   const current=gameSnap.data().game,reward=rewardSnap.data();
   if(reward.gameId!==current.id||reward.uid!==req.dealIdentity.uid)throw Error('WINNER_ONLY');
   if(kind==='final'&&current.phase!=='final')throw Error('MATCH_NOT_FINAL');
   if(kind==='final'){const payouts=current.players.map(p=>payoutFor(current,p));if(payouts.filter(v=>v===Math.max(...payouts)).length!==1)throw Error('TIED_GAME_NO_WINNER_WHEEL')}
   if(kind==='cent'&&!current.events?.some(e=>e.type==='opened'&&e.eventId===reward.eventId&&e.amount===1))throw Error('INVALID_REWARD');
   if(kind==='banker'&&!current.history?.some(h=>h.round===reward.round&&h.decisions?.some(d=>d.id===reward.uid&&d.deal)))throw Error('INVALID_REWARD');
   const key=kind+':'+rewardId;
   if(current.christmasWheelSpins?.[key])return current;
   const updated={...current,christmasWheelSpins:{...(current.christmasWheelSpins||{}),[key]:Date.now()},revision:(current.revision||0)+1};
   tx.update(ref,{game:updated,updatedAt:Date.now()});return updated;
  });
  invalidateGame(code);broadcastGame(code,game);
  return res.json({ok:true,startedAt:game.christmasWheelSpins[kind+':'+rewardId],serverNow:Date.now(),gameId:game.id});
 }catch(e){return fail(res,e)}});
 // Only the recipient may release the shared card-reveal overlay for everyone.
 app.post('/api/deal-or-no-deal/:code/christmas-wheel-continue',auth,async(req,res)=>{try{
  const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');
  const db=getFirestore();await check(db,code,req.dealIdentity.uid);
  const kind=String(req.body?.kind||''),rewardId=String(req.body?.rewardId||'');
  if(!['cent','banker','final'].includes(kind)||!rewardId||rewardId.length>180)throw Error('INVALID_REWARD');
  const collections={cent:'deal_christmas_cent_rewards_v1',banker:'deal_christmas_banker_rewards_v1',final:'deal_christmas_final_rewards_v1'};
  const ref=db.collection(collection).doc(code),rewardRef=db.collection(collections[kind]).doc(rewardId);
  const game=await db.runTransaction(async tx=>{
   const [gameSnap,rewardSnap]=await Promise.all([tx.get(ref),tx.get(rewardRef)]);
   if(!gameSnap.exists||!rewardSnap.exists)throw Error('REWARD_NOT_FOUND');
   const current=gameSnap.data().game,reward=rewardSnap.data();
   if(reward.gameId!==current.id||String(reward.uid)!==String(req.dealIdentity.uid))throw Error('WINNER_ONLY');
   const key=kind+':'+rewardId;
   // Banker packs are determined and credited when the deal is accepted.
   // Only their shared card reveal needs acknowledgement; no wheel spin is required.
   if(kind==='banker'&&!current.history?.some(h=>
    h.round===reward.round&&h.bonusPack===reward.packId&&
    h.decisions?.length===h.participants?.length&&
    h.decisions.some(d=>d.id===reward.uid&&d.deal===true)
   ))throw Error('INVALID_REWARD');
   if(kind!=='banker'&&!current.christmasWheelSpins?.[key])throw Error('WHEEL_NOT_STARTED');
   if(current.christmasWheelClosed?.[key])return current;
   const updated={...current,christmasWheelClosed:{...(current.christmasWheelClosed||{}),[key]:Date.now()},revision:(current.revision||0)+1};
   tx.update(ref,{game:updated,updatedAt:Date.now()});return updated;
  });
  invalidateGame(code);broadcastGame(code,game);
  return res.json({ok:true,closedAt:game.christmasWheelClosed[kind+':'+rewardId]});
 }catch(e){return fail(res,e)}});
 app.get('/api/deal-or-no-deal/:code/christmas-final-reward',auth,async(req,res)=>{try{
  const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');
  const db=getFirestore();await check(db,code,req.dealIdentity.uid,true);
  const game=await readGame(db,code);if(!game||game.phase!=='final')return res.json({ok:true,reward:null});
  const snap=await db.collection('deal_christmas_final_rewards_v1').doc(game.id).get();
  if(!snap.exists)return res.json({ok:true,reward:null});
  const data=snap.data();
  const payouts=(game.finalValues||[]).map(p=>p.payout);
  if(!payouts.length)return res.json({ok:true,reward:null,error:'FINAL_VALUES_NOT_READY'});
  if(payouts.filter(v=>v===Math.max(...payouts)).length!==1)return res.json({ok:true,reward:null,tie:true});
  return res.json({ok:true,reward:{id:snap.id,gameId:game.id,uid:data.uid,playerName:game.players.find(p=>p.id===data.uid)?.name||'Gewinner',packId:data.packId,packName:data.packName,revealed:data.revealed,spun:!!game.christmasWheelSpins?.['final:'+snap.id],createdAt:data.createdAt}});
 }catch(e){return fail(res,e)}});
 app.post('/api/deal-or-no-deal/:code/christmas-final-spin',auth,async(req,res)=>{try{
  const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');
  const db=getFirestore();await check(db,code,req.dealIdentity.uid);
  const ref=db.collection(collection).doc(code);
  const game=await db.runTransaction(async tx=>{
   const snap=await tx.get(ref);if(!snap.exists)throw Error('MATCH_NOT_FOUND');
   const game=snap.data().game;if(game.phase!=='final')throw Error('MATCH_NOT_FINAL');
   const payouts=game.players.map(p=>({id:p.id,payout:payoutFor(game,p)}));
   const max=Math.max(...payouts.map(p=>p.payout));
   const winner=payouts.find(p=>p.payout===max);
   if(payouts.filter(p=>p.payout===max).length!==1)throw Error('TIED_GAME_NO_WINNER_WHEEL');
   if(winner.id!==req.dealIdentity.uid)throw Error('WINNER_ONLY');
   if(game.finalWheelSpun)return game;
   const updated={...game,finalWheelSpun:true,revision:(game.revision||0)+1};
   tx.update(ref,{game:updated,updatedAt:Date.now()});return updated;
  });
  invalidateGame(code);broadcastGame(code,game);return res.json({ok:true,spun:true});
 }catch(e){return fail(res,e)}});
 app.get('/api/deal-or-no-deal/:code/christmas-banker-rewards',auth,async(req,res)=>{try{
 const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');
 const db=getFirestore();await check(db,code,req.dealIdentity.uid,true);
 const game=await readGame(db,code);if(!game)throw Error('MATCH_NOT_FOUND');
 // The accepted bonus and its cards are public to everyone in this room.
 // Read only rewards for accepted deals, never unrevealed/declined offers.
 const accepted=(game.history||[]).flatMap(h=>h.bonusPack&&h.decisions?.length===h.participants?.length?(h.decisions||[]).filter(d=>d.deal===true).map(d=>({round:h.round,uid:d.id})):[]);
 const rewards=await Promise.all(accepted.map(async item=>{
  const doc=await db.collection('deal_christmas_banker_rewards_v1').doc(game.id+'_'+item.round+'_'+item.uid).get();
  if(!doc.exists)return null;
  const data=doc.data();
  return {id:doc.id,gameId:data.gameId,round:data.round,uid:data.uid,playerName:game.players.find(p=>p.id===data.uid)?.name||'Spieler',packId:data.packId,packName:data.packName,revealed:data.revealed,createdAt:data.createdAt};
 }));
 return res.json({ok:true,rewards:rewards.filter(Boolean).sort((a,b)=>a.createdAt-b.createdAt)});
 }catch(e){return fail(res,e)}});
 app.get('/api/deal-or-no-deal/:code/christmas-cent-reward',auth,async(req,res)=>{try{const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');const db=getFirestore();await check(db,code,req.dealIdentity.uid,true);const game=await readGame(db,code);if(!game)return res.json({ok:true,reward:null});const event=(game.events||[]).find(e=>e.type==='opened'&&e.amount===1);if(!event)return res.json({ok:true,reward:null});const reward=await db.collection('deal_christmas_cent_rewards_v1').doc(game.id+'_'+event.eventId).get();if(!reward.exists)return res.json({ok:true,reward:null});const data=reward.data();return res.json({ok:true,reward:{id:reward.id,gameId:data.gameId,uid:data.uid,playerName:game.players.find(p=>p.id===data.uid)?.name||'Spieler',packId:data.packId,packName:data.packName,revealed:data.revealed,createdAt:data.createdAt}})}catch(e){return fail(res,e)}});
 app.get('/api/deal-or-no-deal/:code/avatars',auth,async(req,res)=>{try{const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');const db=getFirestore();await check(db,code,req.dealIdentity.uid,true);const avatars=await readAvatars(db,code);return res.json({ok:true,avatars})}catch(e){return fail(res,e)}});
 app.post('/api/deal-or-no-deal/:code/avatar',auth,async(req,res)=>{try{const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');const avatar=Number(req.body?.avatar);if(!Number.isInteger(avatar)||avatar<1||avatar>15)throw Error('INVALID_AVATAR');const db=getFirestore();await check(db,code,req.dealIdentity.uid);if(avatar===11||avatar===12||avatar===13){const christmas=await db.collection(CHRISTMAS_COLLECTION).doc(req.dealIdentity.uid).get();const reward=avatar===11?'rudolph':avatar===12?'santa':'snowman-profile-avatar';if(!christmasProgress(christmas.exists?christmas.data().cards||{}:{}).rewards.includes(reward))throw Error('CHRISTMAS_REWARD_LOCKED')}if(avatar===15){const christmas=await db.collection(CHRISTMAS_COLLECTION).doc(req.dealIdentity.uid).get();if(christmas.data()?.monsterGiftzwergUnlocked!==true)throw Error('CHRISTMAS_REWARD_LOCKED')}if(avatar===14){const iceSnap=await db.collection('christmas_ice_progress_v1').doc(req.dealIdentity.uid).get();const ice=iceSnap.exists?normalizeIceState(iceSnap.data()):null;if(!ice||Math.max(Number(ice.maxRewarded||0),Number(ice.completed||0))<10)throw Error('CHRISTMAS_REWARD_LOCKED')}const ref=db.collection(avatarCollection).doc(code);const avatars=await db.runTransaction(async tx=>{const snap=await tx.get(ref);const choices={...(snap.exists?snap.data().avatars||{}:{})};if(Object.entries(choices).some(([uid,value])=>uid!==req.dealIdentity.uid&&Number(value)===avatar))throw Error('AVATAR_TAKEN');choices[req.dealIdentity.uid]=avatar;tx.set(ref,{avatars:choices,updatedAt:Date.now()});return choices});invalidateAvatars(code);return res.json({ok:true,avatar,avatars})}catch(e){return fail(res,e)}});
 // Deduplicate concurrent scoreboard reads across players, while retaining a
 // short TTL so purchases and payouts become visible without manual refresh.
 const balanceReadCache=new Map();
 const readBalances=async(db,code,players)=>{
  const key=code+':'+players.map(p=>p.uid).join(',');
  const now=Date.now(),cached=balanceReadCache.get(key);
  if(cached&&cached.expires>now)return cached.promise;
  const promise=Promise.all(players.map(p=>db.collection(walletCollection).doc(p.uid).get()));
  balanceReadCache.set(key,{promise,expires:now+2000});
  if(balanceReadCache.size>200)balanceReadCache.delete(balanceReadCache.keys().next().value);
  try{return await promise}catch(error){if(balanceReadCache.get(key)?.promise===promise)balanceReadCache.delete(key);throw error}
 };
 // One-time owner-only promotional credit. Configure the verified Firebase UID on Render.
 // A matching display name is never sufficient authorization.
 const CHRIS_BONUS_CENTS=10000000000;
 const CHRIS_BONUS_ID='chris-100m-once-v1';
 const bonusAllowed=identity=>Boolean(process.env.DEAL_CHRIS_BONUS_UID&&identity?.uid===process.env.DEAL_CHRIS_BONUS_UID);
 app.get('/api/deal-or-no-deal/bonus/chris/status',auth,async(req,res)=>{
  try{
   if(!bonusAllowed(req.dealIdentity))return res.json({ok:true,eligible:false});
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const receipt=await db.collection('deal_or_no_deal_bonus_claims_v1').doc(CHRIS_BONUS_ID).get();
   return res.json({ok:true,eligible:!receipt.exists,claimed:receipt.exists,amount:CHRIS_BONUS_CENTS});
  }catch(e){return fail(res,e)}
 });
 app.post('/api/deal-or-no-deal/bonus/chris/claim',auth,async(req,res)=>{
  try{
   if(!bonusAllowed(req.dealIdentity))return res.status(403).json({ok:false,error:'NOT_ELIGIBLE'});
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const receiptRef=db.collection('deal_or_no_deal_bonus_claims_v1').doc(CHRIS_BONUS_ID);
   const walletRef=db.collection(walletCollection).doc(req.dealIdentity.uid);
   const result=await db.runTransaction(async tx=>{
    const [receipt,wallet]=await Promise.all([tx.get(receiptRef),tx.get(walletRef)]);
    if(receipt.exists)return {claimed:false,alreadyClaimed:true,balance:wallet.exists?wallet.data().balance||0:0};
    const oldBalance=wallet.exists?Number(wallet.data().balance||0):0;
    if(!Number.isSafeInteger(oldBalance)||oldBalance<0)throw Error('INVALID_BALANCE');
    const balance=oldBalance+CHRIS_BONUS_CENTS;
    if(!Number.isSafeInteger(balance))throw Error('BALANCE_OVERFLOW');
    tx.set(walletRef,{balance,updatedAt:Date.now()},{merge:true});
    tx.create(receiptRef,{uid:req.dealIdentity.uid,amount:CHRIS_BONUS_CENTS,createdAt:Date.now()});
    return {claimed:true,balance};
   });
   if(result.claimed)balanceReadCache.clear();
   return res.json({ok:true,...result});
  }catch(e){return fail(res,e)}
 });
 app.get('/api/deal-or-no-deal/:code/balances',auth,async(req,res)=>{try{const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');const room=await check(db,code,req.dealIdentity.uid,true);const view=await readGame(db,code);if(view&&['final','done'].includes(view.phase))await settleFinalOnce(db,code,view.id);const players=room.players.filter(p=>!p.testBot&&!p.bot).slice(0,4);const snaps=await readBalances(db,code,players);return res.json({ok:true,players:players.map((p,i)=>({id:p.uid,name:p.name,balance:snaps[i].exists?snaps[i].data().balance||0:0,games:snaps[i].exists?snaps[i].data().games||0:0,wins:snaps[i].exists?snaps[i].data().wins||0:0}))})}catch(e){return fail(res,e)}});
 app.get('/api/deal-or-no-deal/:code',auth,async(req,res)=>{try{const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');await check(db,code,req.dealIdentity.uid,true);const game=await readGame(db,code);return res.json({ok:true,game})}catch(e){return fail(res,e)}});
 // The player buys the boost while their personal case is still unselected.
 // The game flag and wallet debit are one Firestore transaction: replays,
 // two tabs and concurrent requests cannot charge twice or grant a free boost.
 app.post('/api/deal-or-no-deal/:code/double-boost',auth,async(req,res)=>{
  try{
   const code=String(req.params.code||'').toUpperCase();
   if(!CODE.test(code))throw Error('INVALID_CODE');
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const uid=req.dealIdentity.uid;
   await check(db,code,uid);
   const gameRef=db.collection(collection).doc(code),walletRef=db.collection(walletCollection).doc(uid);
   const result=await db.runTransaction(async tx=>{
    const [gameSnap,walletSnap]=await Promise.all([tx.get(gameRef),tx.get(walletRef)]);
    if(!gameSnap.exists)throw Error('MATCH_NOT_FOUND');
    const game=gameSnap.data().game;
    const player=game?.players?.find(p=>p.id===uid);
    if(!game||game.phase!=='select'||!player||player.case!==null)throw Error('BOOST_WINDOW_CLOSED');
    const balance=walletSnap.exists?Number(walletSnap.data().balance??0):0;
    if(!Number.isSafeInteger(balance)||balance<0)throw Error('INVALID_WALLET_BALANCE');
    if(player.doublePayout===true)return {game,balance,alreadyActive:true};
    if(balance<DOUBLE_BOOST_COST_CENTS)throw Error('BOOST_INSUFFICIENT_FUNDS');
    const next=structuredClone(game);
    next.players.find(p=>p.id===uid).doublePayout=true;
    next.revision++;
    const remaining=balance-DOUBLE_BOOST_COST_CENTS;
    tx.update(gameRef,{game:next,updatedAt:Date.now()});
    tx.set(walletRef,{balance:remaining,updatedAt:Date.now()},{merge:true});
    return {game:next,balance:remaining,alreadyActive:false};
   });
   invalidateGame(code);
   balanceReadCache.clear();
   broadcastGame(code,result.game);
   return res.json({ok:true,game:publicView(result.game),balance:result.balance,alreadyActive:result.alreadyActive,cost:DOUBLE_BOOST_COST_CENTS});
  }catch(e){return fail(res,e)}
 });
 app.post('/api/deal-or-no-deal/:code/start',auth,async(req,res)=>{try{const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');const room=await check(db,code,req.dealIdentity.uid);if(room.hostUid!==req.dealIdentity.uid)throw Error('HOST_ONLY');const players=room.players.filter(p=>!p.testBot&&!p.bot).slice(0,4).map(p=>({id:p.uid,name:p.name}));if(players.length<1||room.players.filter(p=>!p.testBot&&!p.bot).length>4)throw Error('PLAYER_COUNT');const avatarMap=await readAvatars(db,code);for(const p of players){p.avatar=Number.isInteger(avatarMap[p.id])&&avatarMap[p.id]>=1&&avatarMap[p.id]<=14?avatarMap[p.id]:null}const ref=db.collection(collection).doc(code);const game=await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(snap.exists&&!['final','done'].includes(snap.data().game.phase))throw Error('MATCH_ALREADY_RUNNING');if(snap.exists){const previous=snap.data().game;if(previous.phase==='final'){const payouts=(previous.players||[]).map(p=>payoutFor(previous,p));const tiedFinal=payouts.length>1&&payouts.filter(v=>v===Math.max(...payouts)).length>1;const key='final:'+previous.id;const spinAt=Number(previous.christmasWheelSpins?.[key]||0);const packClosed=!!previous.christmasWheelClosed?.[key];const hammer=previous.christmasHammerWheel;const hammerFinished=hammer?.gameId===previous.id&&Number.isFinite(hammer.startedAt)&&Date.now()-hammer.startedAt>=4300;const ceremonyComplete=!!spinAt&&packClosed&&hammerFinished;if(!tiedFinal&&!ceremonyComplete&&req.body?.skipFinalWheel!==true)throw Error('FINAL_WHEEL_PENDING')}}const requestedCaseCount=req.body?.caseCount===undefined?(snap.exists?snap.data().game?.values?.length||27:27):Number(req.body.caseCount);if(![26,27,28,29,30].includes(requestedCaseCount))throw Error('INVALID_CASE_COUNT');const game=create(players,undefined,requestedCaseCount);tx.set(ref,{game,hubRevision:room.revision,updatedAt:Date.now()});return game});invalidateGame(code);broadcastGame(code,game);return res.json({ok:true,game:publicView(game)})}catch(e){return fail(res,e)}});
 app.post('/api/deal-or-no-deal/:code/action',auth,async(req,res)=>{const actionStarted=Date.now();try{firestoreUsage.gameActions++;const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
// Run the fresh room-membership check and the first game-state transaction read
// concurrently. A valid membership is STILL required before any game mutation,
// but each move no longer waits for two consecutive Firestore round-trips.
const membership=check(db,code,req.dealIdentity.uid);
const ref=db.collection(collection).doc(code);const game=await db.runTransaction(async tx=>{const [,snap]=await Promise.all([membership,tx.get(ref)]);if(!snap.exists)throw Error('MATCH_NOT_FOUND');const before=snap.data().game;const after=apply(before,req.dealIdentity.uid,req.body||{});if(after!==before){
  // Server-authoritative, exactly-once Christmas reward for the actor who revealed 0.01 EUR.
  let awardWrite=null;
  const openedOneCent=after.events?.find(e=>e.type==='opened'&&e.amount===1&&!before.events?.some(old=>old.eventId===e.eventId));
  if(openedOneCent&&((req.body?.type==='ack-reveal'&&before.pending?.eventId===openedOneCent.eventId)||(req.body?.type==='ack-batch'&&before.phase==='batch-reveal'))){
   const uid=openedOneCent.playerId;
   const rewardRef=db.collection('deal_christmas_cent_rewards_v1').doc(after.id+'_'+openedOneCent.eventId);
   const christmasRef=db.collection(CHRISTMAS_COLLECTION).doc(uid);
   const [rewardSnap,christmasSnap]=await Promise.all([tx.get(rewardRef),tx.get(christmasRef)]);
   if(!rewardSnap.exists){
    const roll=randomInt(100);
    const pack=CHRISTMAS_PACKS.find(x=>x.id===(roll<10?'premium':roll<60?'large':'small'));
    const previous=christmasSnap.exists?christmasSnap.data():{};
    const drawn=markChristmasDiscoveries(christmasDraw(pack),previous.cards||{});
    const cards={...(previous.cards||{})};
    for(const card of drawn)cards[card.id]=(cards[card.id]||0)+1;
    awardWrite=()=>{tx.set(christmasRef,{cards,opened:(previous.opened||0)+1,updatedAt:Date.now()},{merge:true});tx.create(rewardRef,{uid,gameId:after.id,eventId:openedOneCent.eventId,packId:pack.id,packName:pack.name,revealed:drawn,createdAt:Date.now()})};
   }
  }
// A Christmas pack is included in a banker offer only when the player accepts the deal.
  const lastBefore=before.history?.at(-1);
  const newlyAccepted=before.phase==='decision'&&req.body?.type==='decide'&&req.body?.deal===true
    &&lastBefore?.bonusPack&&!lastBefore.decisions?.some(d=>d.id===req.dealIdentity.uid);
  if(newlyAccepted){
   const uid=req.dealIdentity.uid;
   const rewardRef=db.collection('deal_christmas_banker_rewards_v1').doc(after.id+'_'+lastBefore.round+'_'+uid);
   const christmasRef=db.collection(CHRISTMAS_COLLECTION).doc(uid);
   const [rewardSnap,christmasSnap]=await Promise.all([tx.get(rewardRef),tx.get(christmasRef)]);
   if(!rewardSnap.exists){
    const pack=CHRISTMAS_PACKS.find(p=>p.id===lastBefore.bonusPack);
    if(!pack)throw Error('INVALID_PACK');
    const previous=christmasSnap.exists?christmasSnap.data():{},drawn=markChristmasDiscoveries(christmasDraw(pack),previous.cards||{});
    const cards={...(previous.cards||{})};
    for(const card of drawn)cards[card.id]=(cards[card.id]||0)+1;
    const priorWrite=awardWrite;
    awardWrite=()=>{priorWrite?.();tx.set(christmasRef,{cards,opened:(previous.opened||0)+1,updatedAt:Date.now()},{merge:true});
      tx.create(rewardRef,{uid,gameId:after.id,round:lastBefore.round,packId:pack.id,packName:pack.name,revealed:drawn,createdAt:Date.now()})};
   }
  }
  // The Banker hammer is an extra prize for each player who ACCEPTS this offer.
  // Record it inside the existing game-action transaction; no polling or extra
  // database reads when there is no hammer in the offer.
  const newlyAcceptedHammer=before.phase==='decision'&&req.body?.type==='decide'
    &&req.body?.deal===true&&lastBefore?.bonusHammer
    &&!lastBefore.decisions?.some(d=>d.id===req.dealIdentity.uid);
  if(newlyAcceptedHammer){
   const hammer=lastBefore.bonusHammer;
   if(!['single','double','lucky'].includes(hammer))throw Error('INVALID_BONUS_HAMMER');
   const uid=req.dealIdentity.uid;
   const hammerReceipt=db.collection('christmas_ice_banker_hammer_v1').doc(after.id+'_'+lastBefore.round+'_'+uid);
   const progressRef=db.collection('christmas_ice_progress_v1').doc(uid);
   const [receiptSnap,progressSnap]=await Promise.all([tx.get(hammerReceipt),tx.get(progressRef)]);
   if(!receiptSnap.exists){
    const previous=progressSnap.exists?normalizeIceState(progressSnap.data()):newIceState();
    const next={...previous,
     freeHammers:{...previous.freeHammers,[hammer]:(previous.freeHammers?.[hammer]||0)+1},
     wheelHammers:{...previous.wheelHammers,[hammer]:(previous.wheelHammers?.[hammer]||0)+1}};
    const priorWrite=awardWrite;
    awardWrite=()=>{priorWrite?.();tx.set(progressRef,next);
     tx.create(hammerReceipt,{gameId:after.id,round:lastBefore.round,uid,hammer,source:'banker-deal',createdAt:Date.now()})};
   }
  }
  // Rare Banker specials are credited only after an authenticated DEAL.
  // Replays never pay twice: both the receipt and the permanent entitlement
  // are settled in this same game action transaction.
  const newlyAcceptedSpecial=before.phase==='decision'&&req.body?.type==='decide'
    &&req.body?.deal===true&&lastBefore?.bonusSpecial
    &&!lastBefore.decisions?.some(d=>d.id===req.dealIdentity.uid);
  if(newlyAcceptedSpecial){
   const kind=lastBefore.bonusSpecial;
   if(!['minigame','monster'].includes(kind))throw Error('INVALID_BONUS_SPECIAL');
   const uid=req.dealIdentity.uid;
   const specialReceipt=db.collection('deal_banker_special_receipts_v1').doc(after.id+'_'+lastBefore.round+'_'+uid);
   const inventoryRef=kind==='minigame'
    ?db.collection('deal_christmas_hats_v1').doc(uid)
    :db.collection(CHRISTMAS_COLLECTION).doc(uid);
   const [receiptSnap,inventorySnap]=await Promise.all([tx.get(specialReceipt),tx.get(inventoryRef)]);
   if(!receiptSnap.exists){
    const previous=inventorySnap.exists?inventorySnap.data():{};
    const now=Date.now();
    const update=kind==='minigame'
     ?{bonusTickets:checkMonsterBalance(Number(previous.bonusTickets||0),1,1000000),
       ...(inventorySnap.exists?{}:{voucherOnly:true}),updatedAt:now}
     :{monsterWheelTickets:checkMonsterBalance(Number(previous.monsterWheelTickets||0),1,1000000),
       updatedAt:now};
    const priorWrite=awardWrite;
    awardWrite=()=>{priorWrite?.();tx.set(inventoryRef,update,{merge:true});
     tx.create(specialReceipt,{gameId:after.id,round:lastBefore.round,uid,kind,createdAt:now})};
   }
  }
  if(before.phase!=='final'&&after.phase==='final'){
   const payouts=after.players.map(p=>({id:p.id,payout:payoutFor(after,p)}));
   const max=Math.max(...payouts.map(p=>p.payout));
   // One free Christmas wheel prize for the highest payout (first player wins a tie).
   // The pack and cards are fixed and credited exactly once when the match ends.
   const winner=payouts.find(p=>p.payout===max);
   const uniqueWinner=payouts.filter(p=>p.payout===max).length===1;
   if(uniqueWinner){
   const finalRewardRef=db.collection('deal_christmas_final_rewards_v1').doc(after.id);
   const finalAlbumRef=db.collection(CHRISTMAS_COLLECTION).doc(winner.id);
   const [finalRewardSnap,finalAlbumSnap]=await Promise.all([tx.get(finalRewardRef),tx.get(finalAlbumRef)]);
   if(!finalRewardSnap.exists){
    const finalPackId=drawFinalWinnerPack(),pack=CHRISTMAS_PACKS.find(p=>p.id===finalPackId);
    const previous=finalAlbumSnap.exists?finalAlbumSnap.data():{},drawn=markChristmasDiscoveries(christmasDraw(pack),previous.cards||{});
    const increments={};
    const counts={};for(const card of drawn)counts[card.id]=(counts[card.id]||0)+1;
    for(const [id,count] of Object.entries(counts))increments[id]=FieldValue.increment(count);
    const previousAward=awardWrite;
    awardWrite=()=>{previousAward?.();tx.set(finalAlbumRef,{cards:increments,opened:FieldValue.increment(1),updatedAt:Date.now()},{merge:true});
     tx.create(finalRewardRef,{uid:winner.id,gameId:after.id,packId:pack.id,packName:pack.id==='large'?'Gold-Kartenpaket':pack.name,revealed:drawn,createdAt:Date.now()})};
   }
   }
   const chestContext=await chestAwardContext(db,tx);
   const entries=payouts.map(p=>({p,...p,account:db.collection(walletCollection).doc(p.id),receipt:db.collection(payoutCollection).doc(after.id+'_'+p.id),materials:db.collection(DOG_MATERIALS_COLLECTION).doc(p.id)}));
   const snapshots=await Promise.all(entries.map(async e=>({wallet:await tx.get(e.account),receipt:await tx.get(e.receipt),materials:await tx.get(e.materials)})));
   for(let i=0;i<entries.length;i++){const e=entries[i],snap=snapshots[i];if(snap.receipt.exists)continue;
    const previous=snap.wallet.exists?snap.wallet.data():{};
    tx.set(e.account,{balance:(previous.balance||0)+e.payout,games:(previous.games||0)+1,wins:(previous.wins||0)+(e.payout===max?1:0),updatedAt:Date.now()},{merge:true});
    // A payout receipt is also the exactly-once DOG chest receipt for this game/player.
    // Only new, server-settled Deal matches grant materials; a replay never does.
    tx.set(e.materials,chestForSettledDeal(e.id,snap.materials.exists?snap.materials.data():null,chestContext));
    tx.create(e.receipt,{gameId:after.id,uid:e.id,amount:e.payout,createdAt:Date.now()});
   }
  }
  awardWrite?.();tx.update(ref,{game:after,updatedAt:Date.now()})}return after});invalidateGame(code);broadcastGame(code,game);
 // Server-side timing is intentionally anonymous and creates no Firestore writes.
 // Slow turn logs distinguish database latency from stalled browser animations.
 const elapsed=Date.now()-actionStarted;
 if(elapsed>=2500)console.warn('[deal-slow-action]',JSON.stringify({type:String(req.body?.type||'').slice(0,24),ms:elapsed,ok:true}));
 return res.json({ok:true,game:publicView(game)})}catch(e){
 const elapsed=Date.now()-actionStarted;
 if(elapsed>=2500)console.warn('[deal-slow-action]',JSON.stringify({type:String(req.body?.type||'').slice(0,24),ms:elapsed,ok:false,error:String(e?.message||'ERROR').slice(0,64)}));
 return fail(res,e)}});
 return {collection,attachSocket,notifyGameChanged:(code,game)=>{invalidateGame(code);broadcastGame(code,game)}};
}
