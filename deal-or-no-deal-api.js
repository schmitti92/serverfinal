import {create,apply,publicView} from './deal-or-no-deal.js';
const SHOP_ITEMS=Object.freeze([{"id":"brille","name":"Goldene Sonnenbrille","price":100000000,"category":"Accessoires","emoji":"🕶️"},{"id":"pirat","name":"Piratenhut","price":150000000,"category":"Accessoires","emoji":"🏴‍☠️"},{"id":"mikro","name":"Show-Mikrofon","price":200000000,"category":"Extras","emoji":"🎙️"},{"id":"silberrahmen","name":"Silberner Profilrahmen","price":300000000,"category":"Rahmen","emoji":"🪞"},{"id":"silberkoffer","name":"Silberkoffer","price":500000000,"category":"Koffer","emoji":"💼"},{"id":"krone","name":"Königskrone","price":750000000,"category":"Accessoires","emoji":"👑"},{"id":"goldrahmen","name":"Goldener Profilrahmen","price":1000000000,"category":"Rahmen","emoji":"🖼️"},{"id":"goldkoffer","name":"Goldkoffer","price":1500000000,"category":"Koffer","emoji":"🧳"},{"id":"vip","name":"VIP-Abzeichen","price":2500000000,"category":"Extras","emoji":"🌟"},{"id":"studio","name":"Exklusives Studio","price":4000000000,"category":"Hintergründe","emoji":"🎬"},{"id":"diamant","name":"Diamantkoffer","price":7500000000,"category":"Koffer","emoji":"💎"},{"id":"trophaee","name":"Legendäre Show-Trophäe","price":10000000000,"category":"Extras","emoji":"🏆"}]);
import {randomInt} from 'node:crypto';
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
const CHRISTMAS_NAMES=['Winterdorf','Lebkuchenhaus','Weihnachtsmann','Rentier','Weihnachtsbaum','Weihnachtszug','Schneekugel','Wichtelwerkstatt','Polarlichter','Eisschloss','Rentierschlitten','Weihnachtslaterne','Weihnachtsengel','Adventskerzen','Schneemannfamilie','Weihnachtskrippe'];
const CHRISTMAS_EXTRA_NAMES=["Schneemann","Weihnachtsengel","Rentier im Schnee","Weihnachtsbaum im Glanz","Lebkuchenmann","Weihnachtskranz","Schlittenfahrt","Stern von Bethlehem","Elfenhilfe","Weihnachtspinguin","Polarbär","Weihnachtsglocken","Kerzenschein","Winterdorf im Schnee","Geschenkstapel","Schneeflocke"];
const CHRISTMAS_CARDS=Object.freeze([...CHRISTMAS_NAMES,...CHRISTMAS_EXTRA_NAMES].map((name,i)=>({id:'christmas-'+String(i+1).padStart(2,'0'),name,rarity:i%16<4?'common':i%16<8?'rare':i%16<12?'epic':'legendary'})));
const CHRISTMAS_PACKS=Object.freeze([
{id:'small',name:'Kleines Weihnachtspaket',price:20000000,count:3,guaranteed:'common',guaranteedCount:0,weights:{common:65,rare:29,epic:5,legendary:1}},
{id:'large',name:'Großes Weihnachtspaket',price:50000000,count:7,guaranteed:'rare',guaranteedCount:1,weights:{common:55,rare:32,epic:10,legendary:3}},
{id:'premium',name:'Premium-Weihnachtspaket',price:100000000,count:12,guaranteed:'epic',guaranteedCount:2,weights:{common:40,rare:35,epic:17,legendary:8}}
]);
const CHRISTMAS_LINES=Object.freeze([...Array.from({length:4},(_,r)=>[0,1,2,3].map(c=>r*4+c)),...Array.from({length:4},(_,c)=>[0,1,2,3].map(r=>r*4+c)),[0,5,10,15],[3,6,9,12]]);
const CHRISTMAS_REWARDS=Object.freeze(['rudolph','winter-lobby','christmas-studio','gift-cases','snowman-profile-avatar']);
const CHRISTMAS_COLLECTOR_FRAME='collector-frame';
function christmasProgress(cards){
 const owned=CHRISTMAS_CARDS.map(c=>(cards[c.id]||0)>0);
 const bingoLines=CHRISTMAS_LINES.map((line,i)=>line.every(index=>owned[index])?i:null).filter(i=>i!==null);
 const bingos=bingoLines.length;
 const secondBingoLines=CHRISTMAS_LINES.map((line,i)=>line.every(index=>owned[index+16])?i:null).filter(i=>i!==null);
 const totalBingos=bingos+secondBingoLines.length;
 const unlockedCount=Math.min(CHRISTMAS_REWARDS.length,Math.floor(totalBingos/2));
 const rewards=CHRISTMAS_REWARDS.slice(0,unlockedCount);
 if(unlockedCount===CHRISTMAS_REWARDS.length)rewards.push(CHRISTMAS_COLLECTOR_FRAME);
 const bonusIds=['santa-profile-avatar','lobby-snowfall','christmas-profile-banner','santa','christmas-champion'];
 const bonusRewards=bonusIds.filter((_,i)=>totalBingos>=12+i*2);
 rewards.push(...bonusRewards);
 const nextBonusIndex=bonusRewards.length;
 return {collected:owned.filter(Boolean).length,total:32,bingoLines,bingos,secondBingoLines,secondBingos:secondBingoLines.length,totalBingos,maxBingos:20,rewards,rewardOrder:'every-two-bingos',nextReward:CHRISTMAS_REWARDS[unlockedCount]||bonusIds[nextBonusIndex]||null,nextRewardAt:unlockedCount<5?(unlockedCount+1)*2:nextBonusIndex<5?12+nextBonusIndex*2:null,collectorFrameUnlocked:unlockedCount===5};
}
function christmasDraw(pack){const drawn=[];const guaranteed=pack.guaranteedCount||0;for(let i=0;i<pack.count;i++){const min=i<guaranteed?pack.guaranteed:'common';const pool=CHRISTMAS_CARDS.filter(c=>rarities.indexOf(c.rarity)>=rarities.indexOf(min));const weights=pool.map(c=>({card:c,weight:pack.weights[c.rarity]}));const total=weights.reduce((a,w)=>a+w.weight,0);let n=randomInt(total);for(const w of weights){n-=w.weight;if(n<0){drawn.push(w.card);break}}}return drawn}

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
  let joined=null,authenticated=false;
  // Force periodic re-authentication and fresh room membership checks.
  // Do not retain a subscription indefinitely after a player leaves the room.
  const expiry=setTimeout(()=>{if(ws.readyState===1)ws.close(1000,'REAUTH_REQUIRED')},120000);
  expiry.unref?.();
  ws.on('message',async raw=>{
   let msg;try{msg=JSON.parse(String(raw))}catch{return};
   if(msg?.type==='ping'){if(joined){sendSocket(ws,{type:'pong'});if(Number.isSafeInteger(msg.revision)){try{const db=getFirestore();if(db){const latest=await readGame(db,joined);if(ws.readyState===1&&latest&&Number(latest.revision)!==msg.revision)sendSocket(ws,{type:'deal-state',game:latest})}}catch(error){console.warn('[deal-sync-ping]',String(error?.message||error))}}}return}
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
    joined=code;
    if(!dealSockets.has(code))dealSockets.set(code,new Set());
    dealSockets.get(code).add(ws);
    sendSocket(ws,{type:'deal-subscribed',code});
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
 const check=async(db,code,uid,allowCache=false)=>{
  const now=Date.now();
  let entry=allowCache?roomReadCache.get(code):null;
  if(!entry||entry.expires<=now){
   firestoreUsage.roomReads++;
   const promise=db.collection(hubCollection).doc(code).get();
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
 const settleFinal=async(db,code)=>{const matchRef=db.collection(collection).doc(code);return db.runTransaction(async tx=>{const match=await tx.get(matchRef);if(!match.exists)return false;const game=match.data().game;if(!game||!['final','done'].includes(game.phase)||!Array.isArray(game.values))return false;
 const payouts=game.players.map(p=>({uid:p.id,amount:p.deal??game.values[p.case]}));if(payouts.some(p=>!Number.isSafeInteger(p.amount)||p.amount<0))throw Error('INVALID_PAYOUT');const maximum=Math.max(...payouts.map(p=>p.amount));
 const refs=payouts.map(p=>({...p,wallet:db.collection(walletCollection).doc(p.uid),receipt:db.collection(payoutCollection).doc(game.id+'_'+p.uid)}));
 const reads=await Promise.all(refs.map(async p=>({wallet:await tx.get(p.wallet),receipt:await tx.get(p.receipt)})));let changed=false;
 for(let i=0;i<refs.length;i++){const p=refs[i],old=reads[i];if(old.receipt.exists)continue;const previous=old.wallet.exists?old.wallet.data():{};tx.set(p.wallet,{balance:(previous.balance||0)+p.amount,games:(previous.games||0)+1,wins:(previous.wins||0)+(p.amount===maximum?1:0),updatedAt:Date.now()},{merge:true});tx.create(p.receipt,{gameId:game.id,uid:p.uid,amount:p.amount,createdAt:Date.now()});changed=true}return game.id})};
 app.get('/api/deal-or-no-deal/shop/catalog',auth,(req,res)=>res.json({ok:true,items:SHOP_ITEMS,minPrice:100000000}));
 app.get('/api/deal-or-no-deal/shop/me',auth,async(req,res)=>{try{const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');const uid=req.dealIdentity.uid;const [wallet,inventory]=await Promise.all([db.collection(walletCollection).doc(uid).get(),db.collection(inventoryCollection).doc(uid).get()]);return res.json({ok:true,balance:wallet.exists?wallet.data().balance||0:0,games:wallet.exists?wallet.data().games||0:0,owned:inventory.exists?inventory.data().owned||[]:[],items:SHOP_ITEMS})}catch(e){return fail(res,e)}});
 app.post('/api/deal-or-no-deal/shop/buy',auth,async(req,res)=>{try{const item=SHOP_ITEMS.find(x=>x.id===req.body?.itemId);if(!item)throw Error('INVALID_ITEM');const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');const uid=req.dealIdentity.uid;const walletRef=db.collection(walletCollection).doc(uid),inventoryRef=db.collection(inventoryCollection).doc(uid);
 const result=await db.runTransaction(async tx=>{const [wallet,inventory]=await Promise.all([tx.get(walletRef),tx.get(inventoryRef)]);const balance=wallet.exists?wallet.data().balance||0:0;const owned=inventory.exists?inventory.data().owned||[]:[];if(owned.includes(item.id))throw Error('ALREADY_OWNED');if(balance<item.price)throw Error('INSUFFICIENT_FUNDS');const remaining=balance-item.price;tx.set(walletRef,{balance:remaining,updatedAt:Date.now()},{merge:true});tx.set(inventoryRef,{owned:[...owned,item.id],updatedAt:Date.now()},{merge:true});return {balance:remaining,owned:[...owned,item.id]}});return res.json({ok:true,...result,itemId:item.id})}catch(e){return fail(res,e)}});
 app.get('/api/deal-or-no-deal/cards/me',auth,async(req,res)=>{try{const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');const uid=req.dealIdentity.uid;const [wallet,snap]=await Promise.all([db.collection(walletCollection).doc(uid).get(),db.collection(CARD_COLLECTION).doc(uid).get()]);const inventory=snap.exists?snap.data():{};return res.json({ok:true,balance:wallet.exists?wallet.data().balance||0:0,cards:inventory.cards||{},opened:inventory.opened||0,definitions:CARD_DEFINITIONS,packs:CARD_PACKS.map(({weights,...p})=>({...p,probabilities:Object.fromEntries(rarities.map(r=>[r,Math.round(10000*CARD_DEFINITIONS.filter(c=>c.rarity===r).length*weights[r]/CARD_DEFINITIONS.reduce((sum,c)=>sum+weights[c.rarity],0))/100]))}))})}catch(e){return fail(res,e)}});
 app.post('/api/deal-or-no-deal/cards/open',auth,async(req,res)=>{try{const pack=CARD_PACKS.find(p=>p.id===req.body?.packId);if(!pack)throw Error('INVALID_PACK');const requestId=String(req.body?.requestId||'');if(!/^[a-zA-Z0-9_-]{12,90}$/.test(requestId))throw Error('INVALID_REQUEST_ID');const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');const uid=req.dealIdentity.uid;const walletRef=db.collection(walletCollection).doc(uid),cardsRef=db.collection(CARD_COLLECTION).doc(uid);
 const result=await db.runTransaction(async tx=>{const [wallet,snap]=await Promise.all([tx.get(walletRef),tx.get(cardsRef)]);const previous=snap.exists?snap.data():{};if(previous.lastPurchase?.requestId===requestId){if(previous.lastPurchase.packId!==pack.id)throw Error('INVALID_REQUEST_ID');return {...previous.lastPurchase.result,replayed:true}}const balance=wallet.exists?wallet.data().balance||0:0;if(!Number.isSafeInteger(balance)||balance<pack.price)throw Error('INSUFFICIENT_FUNDS');const owned={...(previous.cards||{})};const cards=openPack(pack);for(const card of cards)owned[card.id]=(owned[card.id]||0)+1;const remaining=balance-pack.price;tx.set(walletRef,{balance:remaining,updatedAt:Date.now()},{merge:true});const purchaseResult={balance:remaining,cards:owned,opened:(previous.opened||0)+1,revealed:cards.map(({id,name,rarity,emoji,series})=>({id,name,rarity,emoji,series}))};tx.set(cardsRef,{cards:owned,opened:purchaseResult.opened,lastPurchase:{requestId,packId:pack.id,result:purchaseResult},updatedAt:Date.now()},{merge:true});return purchaseResult});return res.json({ok:true,...result})}catch(e){return fail(res,e)}});

 app.get('/api/deal-or-no-deal/christmas/me',auth,async(req,res)=>{try{const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');const uid=req.dealIdentity.uid;const [wallet,snap]=await Promise.all([db.collection(walletCollection).doc(uid).get(),db.collection(CHRISTMAS_COLLECTION).doc(uid).get()]);const data=snap.exists?snap.data():{};const cards=data.cards||{};return res.json({ok:true,balance:wallet.exists?wallet.data().balance||0:0,cards,opened:data.opened||0,definitions:CHRISTMAS_CARDS,packs:CHRISTMAS_PACKS,progress:christmasProgress(cards)})}catch(e){return fail(res,e)}});
 app.post('/api/deal-or-no-deal/christmas/open',auth,async(req,res)=>{try{const pack=CHRISTMAS_PACKS.find(p=>p.id===req.body?.packId);if(!pack)throw Error('INVALID_PACK');const requestId=String(req.body?.requestId||'');if(!/^[a-zA-Z0-9_-]{12,90}$/.test(requestId))throw Error('INVALID_REQUEST_ID');const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');const uid=req.dealIdentity.uid;const walletRef=db.collection(walletCollection).doc(uid),cardsRef=db.collection(CHRISTMAS_COLLECTION).doc(uid),receiptRef=db.collection('deal_or_no_deal_christmas_receipts_v1').doc(uid+'_'+requestId);
 const result=await db.runTransaction(async tx=>{const [wallet,snap,receipt]=await Promise.all([tx.get(walletRef),tx.get(cardsRef),tx.get(receiptRef)]);if(receipt.exists){if(receipt.data().packId!==pack.id)throw Error('INVALID_REQUEST_ID');return {...receipt.data().result,replayed:true}}const balance=wallet.exists?wallet.data().balance||0:0;if(!Number.isSafeInteger(balance)||balance<pack.price)throw Error('INSUFFICIENT_FUNDS');const previous=snap.exists?snap.data():{};const cards={...(previous.cards||{})};const drawn=christmasDraw(pack);for(const card of drawn)cards[card.id]=(cards[card.id]||0)+1;const remaining=balance-pack.price;const result={balance:remaining,cards,opened:(previous.opened||0)+1,revealed:drawn,progress:christmasProgress(cards)};tx.set(walletRef,{balance:remaining,updatedAt:Date.now()},{merge:true});tx.set(cardsRef,{cards,opened:result.opened,updatedAt:Date.now()},{merge:true});tx.create(receiptRef,{packId:pack.id,result,createdAt:Date.now()});return result});return res.json({ok:true,...result})}catch(e){return fail(res,e)}});
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
 app.post('/api/deal-or-no-deal/:code/avatar',auth,async(req,res)=>{try{const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');const avatar=Number(req.body?.avatar);if(!Number.isInteger(avatar)||avatar<1||avatar>13)throw Error('INVALID_AVATAR');const db=getFirestore();await check(db,code,req.dealIdentity.uid);if(avatar===11||avatar===12||avatar===13){const christmas=await db.collection(CHRISTMAS_COLLECTION).doc(req.dealIdentity.uid).get();const reward=avatar===11?'rudolph':avatar===12?'santa':'snowman-profile-avatar';if(!christmasProgress(christmas.exists?christmas.data().cards||{}:{}).rewards.includes(reward))throw Error('CHRISTMAS_REWARD_LOCKED')}const ref=db.collection(avatarCollection).doc(code);const avatars=await db.runTransaction(async tx=>{const snap=await tx.get(ref);const choices={...(snap.exists?snap.data().avatars||{}:{})};if(Object.entries(choices).some(([uid,value])=>uid!==req.dealIdentity.uid&&Number(value)===avatar))throw Error('AVATAR_TAKEN');choices[req.dealIdentity.uid]=avatar;tx.set(ref,{avatars:choices,updatedAt:Date.now()});return choices});invalidateAvatars(code);return res.json({ok:true,avatar,avatars})}catch(e){return fail(res,e)}});
 app.get('/api/deal-or-no-deal/:code/balances',auth,async(req,res)=>{try{const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');const room=await check(db,code,req.dealIdentity.uid,true);const view=await readGame(db,code);if(view&&['final','done'].includes(view.phase))await settleFinalOnce(db,code,view.id);const players=room.players.filter(p=>!p.testBot&&!p.bot).slice(0,4);const snaps=await Promise.all(players.map(p=>db.collection(walletCollection).doc(p.uid).get()));return res.json({ok:true,players:players.map((p,i)=>({id:p.uid,name:p.name,balance:snaps[i].exists?snaps[i].data().balance||0:0,games:snaps[i].exists?snaps[i].data().games||0:0,wins:snaps[i].exists?snaps[i].data().wins||0:0}))})}catch(e){return fail(res,e)}});
 app.get('/api/deal-or-no-deal/:code',auth,async(req,res)=>{try{const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');await check(db,code,req.dealIdentity.uid,true);const game=await readGame(db,code);return res.json({ok:true,game})}catch(e){return fail(res,e)}});
 app.post('/api/deal-or-no-deal/:code/start',auth,async(req,res)=>{try{const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');const room=await check(db,code,req.dealIdentity.uid);if(room.hostUid!==req.dealIdentity.uid)throw Error('HOST_ONLY');const players=room.players.filter(p=>!p.testBot&&!p.bot).slice(0,4).map(p=>({id:p.uid,name:p.name}));if(players.length<1||room.players.filter(p=>!p.testBot&&!p.bot).length>4)throw Error('PLAYER_COUNT');const avatarMap=await readAvatars(db,code);for(const p of players){p.avatar=Number.isInteger(avatarMap[p.id])&&avatarMap[p.id]>=1&&avatarMap[p.id]<=13?avatarMap[p.id]:null}const ref=db.collection(collection).doc(code);const game=await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(snap.exists&&!['final','done'].includes(snap.data().game.phase))throw Error('MATCH_ALREADY_RUNNING');const game=create(players);tx.set(ref,{game,hubRevision:room.revision,updatedAt:Date.now()});return game});invalidateGame(code);broadcastGame(code,game);return res.json({ok:true,game:publicView(game)})}catch(e){return fail(res,e)}});
 app.post('/api/deal-or-no-deal/:code/action',auth,async(req,res)=>{try{firestoreUsage.gameActions++;const code=String(req.params.code||'').toUpperCase();if(!CODE.test(code))throw Error('INVALID_CODE');const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');await check(db,code,req.dealIdentity.uid);const ref=db.collection(collection).doc(code);const game=await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(!snap.exists)throw Error('MATCH_NOT_FOUND');const before=snap.data().game;const after=apply(before,req.dealIdentity.uid,req.body||{});if(after!==before){
  // Server-authoritative, exactly-once Christmas reward for the actor who revealed 0.01 EUR.
  let awardWrite=null;
  const openedOneCent=after.events?.find(e=>e.type==='opened'&&e.amount===1&&!before.events?.some(old=>old.eventId===e.eventId));
  if(openedOneCent&&req.body?.type==='ack-reveal'&&before.pending?.eventId===openedOneCent.eventId){
   const uid=before.pending.actor;
   const rewardRef=db.collection('deal_christmas_cent_rewards_v1').doc(after.id+'_'+openedOneCent.eventId);
   const christmasRef=db.collection(CHRISTMAS_COLLECTION).doc(uid);
   const [rewardSnap,christmasSnap]=await Promise.all([tx.get(rewardRef),tx.get(christmasRef)]);
   if(!rewardSnap.exists){
    const roll=randomInt(100);
    const pack=CHRISTMAS_PACKS.find(x=>x.id===(roll<10?'premium':roll<60?'large':'small'));
    const drawn=christmasDraw(pack);
    const previous=christmasSnap.exists?christmasSnap.data():{};
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
    const drawn=christmasDraw(pack),previous=christmasSnap.exists?christmasSnap.data():{};
    const cards={...(previous.cards||{})};
    for(const card of drawn)cards[card.id]=(cards[card.id]||0)+1;
    const priorWrite=awardWrite;
    awardWrite=()=>{priorWrite?.();tx.set(christmasRef,{cards,opened:(previous.opened||0)+1,updatedAt:Date.now()},{merge:true});
      tx.create(rewardRef,{uid,gameId:after.id,round:lastBefore.round,packId:pack.id,packName:pack.name,revealed:drawn,createdAt:Date.now()})};
   }
  }
  if(before.phase!=='final'&&after.phase==='final'){
   const payouts=after.players.map(p=>({id:p.id,payout:p.deal??after.values[p.case]}));
   const max=Math.max(...payouts.map(p=>p.payout));
   const entries=payouts.map(p=>({p,...p,account:db.collection(walletCollection).doc(p.id),receipt:db.collection(payoutCollection).doc(after.id+'_'+p.id)}));
   const snapshots=await Promise.all(entries.map(async e=>({wallet:await tx.get(e.account),receipt:await tx.get(e.receipt)})));
   for(let i=0;i<entries.length;i++){const e=entries[i],snap=snapshots[i];if(snap.receipt.exists)continue;
    const previous=snap.wallet.exists?snap.wallet.data():{};
    tx.set(e.account,{balance:(previous.balance||0)+e.payout,games:(previous.games||0)+1,wins:(previous.wins||0)+(e.payout===max?1:0),updatedAt:Date.now()},{merge:true});
    tx.create(e.receipt,{gameId:after.id,uid:e.id,amount:e.payout,createdAt:Date.now()});
   }
  }
  awardWrite?.();tx.update(ref,{game:after,updatedAt:Date.now()})}return after});invalidateGame(code);broadcastGame(code,game);return res.json({ok:true,game:publicView(game)})}catch(e){return fail(res,e)}});
 return {collection,attachSocket};
}
