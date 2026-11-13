'use strict';
import {newIceState,publicIceState,strikeIce,nextIcePicture,resetIceState,normalizeIceState} from './christmas-ice-engine.js';
import {icePictureJackpot} from './christmas-ice-prizes.js';
import {drawHammerFromTwelve} from './deal-or-no-deal.js';
import {checkMonsterBalance} from './monster-wheel.js';
import {DOG_MATERIALS_COLLECTION,addExpeditionChestToInventory} from './dog-materials.js';
import {dogChestOffer,DOG_CHEST_TYPES} from './dog-balance.js';
import {DOG_S2_COLLECTION} from './dog-album-season2.js';
// Server-authoritative progress; one Firestore state document per authenticated player.
// A hammer strike reads/writes only the state document; joker awards also update inventory.
// Do not migrate unverified localStorage data.
export function installChristmasIceApi(app,{verifyProfile,getFirestore,notifyDealGameChanged}){
 const collection='christmas_ice_progress_v1',inventoryCollection='deal_peek_inventory_v1',walletCollection='deal_or_no_deal_wallets_v1';
 const albumCollection='deal_or_no_deal_christmas_v1',picture30Spins=3;
 const hatsCollection='deal_christmas_hats_v1';
 const auth=async(req,res,next)=>{
  try{const token=/^Bearer (.+)$/i.exec(req.get('authorization')||'')?.[1];
   const identity=await verifyProfile(token);
   if(!identity?.uid)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   req.iceUid=String(identity.uid);next();
  }catch{return res.status(401).json({ok:false,error:'AUTH_FAILED'})}
 };
 const fail=(res,e)=>res.status(409).json({ok:false,error:String(e?.message||'ICE_ERROR')});
 app.get('/api/christmas-ice/me',auth,async(req,res)=>{
  try{const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const pendingId=String(req.query?.pendingId||'');
   if(pendingId&&!/^[A-Za-z0-9_-]{12,90}$/.test(pendingId))
    return res.status(400).json({ok:false,error:'INVALID_REQUEST_ID'});
   const [snap,wallet]=await Promise.all([db.collection(collection).doc(req.iceUid).get(),db.collection(walletCollection).doc(req.iceUid).get()]);
   const saved=snap.exists?normalizeIceState(snap.data()):null;
   // A timed-out POST may have committed. Report its existing receipt without
   // applying another strike or exposing the private action history.
   const receipt=pendingId?saved?.lastActions?.find(action=>action.id===pendingId):null;
   res.set('Cache-Control','no-store');
   return res.json({ok:true,started:snap.exists,state:saved?{...publicIceState(saved),balance:Number(wallet.data()?.balance)||0}:null,
    ...(pendingId?{pendingAction:{applied:!!receipt,result:receipt?.result||null}}:{})});
  }catch(e){return fail(res,e)}
 });
 // Lightweight avatar unlock check: one progress read, no wallet access.
 app.get('/api/christmas-ice/unlocks',auth,async(req,res)=>{
  try{const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const snap=await db.collection(collection).doc(req.iceUid).get();
   const state=snap.exists?normalizeIceState(snap.data()):null;
   res.set('Cache-Control','no-store');
   const best=state?Math.max(Number(state.maxRewarded||0),Number(state.completed||0)):0;
   return res.json({ok:true,janSchlappen:best>=10,kniffelChristmasDice:best>=20,dealAutoplay:best>=40});
  }catch(e){return fail(res,e)}
 });
 // Backfill for profiles that finished picture 30 before the milestone existed.
 // Atomic marker in the album prevents a second credit even after resets/retries.
 app.post('/api/christmas-ice/claim-picture30',auth,async(req,res)=>{
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const progressRef=db.collection(collection).doc(req.iceUid);
   const albumRef=db.collection(albumCollection).doc(req.iceUid);
   const result=await db.runTransaction(async tx=>{
    const [progressSnap,albumSnap]=await Promise.all([tx.get(progressRef),tx.get(albumRef)]);
    if(!progressSnap.exists)throw Error('START_REQUIRED');
    const progress=normalizeIceState(progressSnap.data());
    const reached=Math.max(Number(progress.completed)||0,Number(progress.maxRewarded)||0)>=30;
    if(!reached)throw Error('PICTURE_30_NOT_REACHED');
    const album=albumSnap.exists?albumSnap.data():{};
    const already=!!(album.icePicture30MonsterSpinsGranted||progress.picture30MonsterSpinsClaimed);
    if(already){
     // Restore the visible progress flag if an older client wrote a partial state.
     if(!progress.picture30MonsterSpinsClaimed)
      tx.set(progressRef,{picture30MonsterSpinsClaimed:true},{merge:true});
     return {granted:false,amount:0,tickets:Number(album.monsterWheelTickets)||0,claimed:true};
    }
    const tickets=checkMonsterBalance(Number(album.monsterWheelTickets||0),picture30Spins);
    const now=Date.now();
    tx.set(albumRef,{monsterWheelTickets:tickets,icePicture30MonsterSpinsGranted:true,updatedAt:now},{merge:true});
    tx.set(progressRef,{picture30MonsterSpinsClaimed:true},{merge:true});
    return {granted:true,amount:picture30Spins,tickets,claimed:true};
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...result});
  }catch(e){return fail(res,e)}
 });

 // Exactly-once backfill for players who cleared pictures 50/60
 // before the question-mark Joker-Sammelkarte was introduced.
 app.post('/api/christmas-ice/claim-wildcards',auth,async(req,res)=>{
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const progressRef=db.collection(collection).doc(req.iceUid);
   const dogRef=db.collection(DOG_S2_COLLECTION).doc(req.iceUid);
   const result=await db.runTransaction(async tx=>{
    const [progressSnap,dogSnap]=await Promise.all([tx.get(progressRef),tx.get(dogRef)]);
    if(!progressSnap.exists)throw Error('START_REQUIRED');
    const progress=normalizeIceState(progressSnap.data()),dog=dogSnap.exists?dogSnap.data():{};
    const best=Math.max(Number(progress.completed)||0,Number(progress.maxRewarded)||0);
    const milestones=[50,60].filter(n=>best>=n);
    const credited=milestones.filter(n=>!dog['iceWildcard'+n+'Granted']&&!progress['iceWildcard'+n+'Claimed']);
    const count=credited.length,prior=Number(dog.wildcardTickets||0);
    const tickets=checkMonsterBalance(prior,count,1000000);
    const dogFlags=Object.fromEntries(milestones.map(n=>['iceWildcard'+n+'Granted',true]));
    const stateFlags=Object.fromEntries(milestones.map(n=>['iceWildcard'+n+'Claimed',true]));
    if(count||milestones.some(n=>!dog['iceWildcard'+n+'Granted']))
     tx.set(dogRef,{...dogFlags,wildcardTickets:tickets,updatedAt:Date.now()},{merge:true});
    if(milestones.some(n=>!progress['iceWildcard'+n+'Claimed']))
     tx.set(progressRef,stateFlags,{merge:true});
    return {granted:count,wildcardTickets:tickets,...stateFlags};
   });
   res.set('Cache-Control','no-store');return res.json({ok:true,...result});
  }catch(e){return fail(res,e)}
 });

 // A single winner click starts the pack wheel and later the hammer wheel.
 // The hammer award is stored exactly once and broadcast to the room.
 app.post('/api/christmas-ice/final-hammer',auth,async(req,res)=>{
  const code=String(req.body?.code||'').toUpperCase();
  const gameId=String(req.body?.gameId||'');
  if(!/^(?:\d{3}|[A-HJ-NP-Z2-9]{6})$/.test(code)||!gameId||gameId.length>180)
   return res.status(400).json({ok:false,error:'INVALID_MATCH'});
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const gameRef=db.collection('deal_or_no_deal_matches_v1').doc(code);
   const progressRef=db.collection(collection).doc(req.iceUid);
   const receiptRef=db.collection('christmas_ice_final_hammer_v1').doc(gameId);
   const result=await db.runTransaction(async tx=>{
    const [gameSnap,receiptSnap,progressSnap]=await Promise.all([tx.get(gameRef),tx.get(receiptRef),tx.get(progressRef)]);
    if(!gameSnap.exists)throw Error('MATCH_NOT_FOUND');
    const game=gameSnap.data()?.game;
    if(!game||game.id!==gameId||game.phase!=='final')throw Error('MATCH_NOT_FINAL');
    const payouts=(game.players||[]).map(p=>({id:p.id,payout:p.deal??game.values?.[p.case]}));
    if(!payouts.length)throw Error('RESULT_NOT_READY');
    const max=Math.max(...payouts.map(x=>x.payout));
    const winners=payouts.filter(x=>x.payout===max);
    if(winners.length!==1||String(winners[0].id)!==req.iceUid)throw Error('WINNER_ONLY');
    const packWheelAt=Number(game.christmasWheelSpins?.['final:'+game.id]||0);
    if(!packWheelAt)throw Error('PACK_WHEEL_FIRST');
     // The shared card reveal happens AFTER the hammer wheel. Requiring it here
     // would prevent an uninterrupted two-wheel ceremony.
     if(Date.now()-packWheelAt<6800)throw Error('PACK_WHEEL_IN_PROGRESS');
    if(receiptSnap.exists){
     if(receiptSnap.data()?.uid!==req.iceUid)throw Error('ALREADY_AWARDED');
     return {hammer:receiptSnap.data().hammer,startedAt:receiptSnap.data().createdAt,replayed:true};
    }
    // Reuse the same twelve-sector distribution as the Banker bonus.
    const hammer=drawHammerFromTwelve();
    const state=progressSnap.exists?normalizeIceState(progressSnap.data()):newIceState();
    const next={...state,freeHammers:{...state.freeHammers,[hammer]:(state.freeHammers?.[hammer]||0)+1},wheelHammers:{...state.wheelHammers,[hammer]:(state.wheelHammers?.[hammer]||0)+1}};
    const wheelStartedAt=Date.now();
    // Publish the outcome on the existing shared game document. Other players
    // receive it through their normal game-state updates, with no new listener.
    const nextGame={...game,christmasHammerWheel:{gameId,uid:req.iceUid,hammer,startedAt:wheelStartedAt},revision:(game.revision||0)+1};
    tx.update(gameRef,{game:nextGame,updatedAt:wheelStartedAt});
    tx.set(progressRef,next);
    tx.create(receiptRef,{uid:req.iceUid,gameId,hammer,createdAt:wheelStartedAt});
    return {hammer,startedAt:wheelStartedAt,replayed:false,game:nextGame};
   });
   if(result.game&&typeof notifyDealGameChanged==='function'){
    try{notifyDealGameChanged(code,result.game)}catch(error){console.error('Hammer wheel broadcast failed after successful award',error)}
   }
   res.set('Cache-Control','no-store');
   return res.json({ok:true,gameId,hammer:result.hammer,startedAt:result.startedAt,replayed:result.replayed});
  }catch(e){return fail(res,e)}
 });

 app.post('/api/christmas-ice/action',auth,async(req,res)=>{
  const {type,index,hammer,requestId,expectedPicture}=req.body||{};
  if(!['start','strike','next','reset','welcome'].includes(type))return res.status(400).json({ok:false,error:'INVALID_ACTION'});
  if(!/^[A-Za-z0-9_-]{12,90}$/.test(String(requestId||'')))return res.status(400).json({ok:false,error:'INVALID_REQUEST_ID'});
  if(expectedPicture!==undefined&&(!Number.isInteger(expectedPicture)||expectedPicture<1||expectedPicture>70))
   return res.status(400).json({ok:false,error:'INVALID_PICTURE'});
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const ref=db.collection(collection).doc(req.iceUid);
   const inventory=db.collection(inventoryCollection).doc(req.iceUid);
   const walletRef=db.collection(walletCollection).doc(req.iceUid);
   const result=await db.runTransaction(async tx=>{
    const [snap,walletSnap]=await Promise.all([tx.get(ref),tx.get(walletRef)]);
    const walletBalance=Number(walletSnap.data()?.balance)||0;
    if(!Number.isSafeInteger(walletBalance)||walletBalance<0)throw Error('INVALID_WALLET_BALANCE');
    if(type==='start'){
     if(snap.exists)return {state:{...publicIceState(normalizeIceState(snap.data())),balance:walletBalance},changed:false};
     const state=newIceState();tx.create(ref,state);
     return {state:{...publicIceState(state),balance:walletBalance},changed:true};
    }
    if(!snap.exists)throw Error('START_REQUIRED');
    const state=normalizeIceState(snap.data());
    const previous=state.lastActions?.find(x=>x.id===requestId);
    if(previous)return {state:{...publicIceState(state),balance:walletBalance},result:{...previous.result,replayed:true},changed:false};
    if(type==='welcome'){
     if(state.goldenHammerGift2026)return {state:{...publicIceState(state),balance:walletBalance},result:{granted:false,alreadyClaimed:true},changed:false};
     const next={...state,goldenHammerGift2026:true,freeHammers:{...state.freeHammers,lucky:(state.freeHammers?.lucky||0)+3},wheelHammers:{...state.wheelHammers,lucky:(state.wheelHammers?.lucky||0)+3}};
     tx.set(ref,next);
     return {state:{...publicIceState(next),balance:walletBalance},result:{granted:true,hammer:'lucky',amount:3},changed:true};
    }
    if(type==='reset'){
     const next=resetIceState(state);
     const result={reset:true};
     next.lastActions=[{id:requestId,result}];
     tx.set(ref,next);
     return {state:{...publicIceState(next),balance:walletBalance},result,changed:true};
    }
    if(type==='next'){
     const next=nextIcePicture(state);
     const result={advanced:true,completed:next.completed};
     next.lastActions=[...(next.lastActions||[]),{id:requestId,result}].slice(-32);
     tx.set(ref,next);
     return {state:{...publicIceState(next),balance:walletBalance},result,changed:true};
    }
    // Old clients omit expectedPicture for backward compatibility. New clients
    // bind each paid/free strike to the original picture, preventing a very old
    // lost receipt from charging an unrelated later picture.
    if(expectedPicture!==undefined&&expectedPicture!==state.completed+1)
     throw Error('PICTURE_CHANGED');
    const strike=strikeIce({...state,balance:walletBalance},{index,hammer,requestId});
    if(!strike.changed)return {state:{...publicIceState(state),balance:walletBalance},result:strike.result,changed:false};
    let next=strike.state;
    // All permanent prizes settle atomically with the picture-winning strike.
    // Ordinary ice hits cost only their existing state and wallet reads.
    const firstPictureClear=strike.result.found&&next.completed>Math.max(0,Number(state.maxRewarded)||0);
    const picture30Completed=strike.result.found&&next.completed===30;
    const jackpot=firstPictureClear?icePictureJackpot(next.completed):null;
    const jokerGift=strike.result.gift?.kind==='joker';
    const extraJokers=jackpot?.jokers||0,extraVouchers=jackpot?.hatsVouchers||0;
    const jokerCount=(jokerGift?1:0)+extraJokers,voucherCount=(jokerGift?1:0)+extraVouchers;
    const albumRef=db.collection(albumCollection).doc(req.iceUid);
    const dogBagRef=db.collection(DOG_MATERIALS_COLLECTION).doc(req.iceUid);
    const dogAlbumRef=db.collection(DOG_S2_COLLECTION).doc(req.iceUid);
    const hatsRef=db.collection(hatsCollection).doc(req.iceUid);
    // Firestore requires all document reads before any write in a transaction.
    const [albumSnap,dogBagSnap,dogAlbumSnap,invSnap,hatsSnap]=await Promise.all([
     picture30Completed?tx.get(albumRef):null,
     firstPictureClear?tx.get(dogBagRef):null,
     jackpot?.superSlots?tx.get(dogAlbumRef):null,
     jokerCount?tx.get(inventory):null,
     voucherCount?tx.get(hatsRef):null
    ]);
    const album=albumSnap?.exists?albumSnap.data():{};
    const grantPicture30=picture30Completed&&!album.icePicture30MonsterSpinsGranted&&!state.picture30MonsterSpinsClaimed;
    const patchReceipt=patch=>{
     next={...next,lastActions:(next.lastActions||[]).map(a=>a.id===requestId?
      {...a,result:{...a.result,...patch}}:a)};
    };
    if(picture30Completed){
     next={...next,picture30MonsterSpinsClaimed:true};
     patchReceipt({monsterSpinsGranted:grantPicture30?picture30Spins:0});
    }
    if(jokerCount){
     const old=Number(invSnap?.data()?.balance)||0;
     if(!Number.isSafeInteger(old)||old<0||old+jokerCount>1000000)throw Error('INVALID_JOKER_BALANCE');
     tx.set(inventory,{balance:old+jokerCount,updatedAt:Date.now()},{merge:true});
     next={...next,peekJokers:next.peekJokers+extraJokers};
    }
    if(voucherCount){
     const hats=hatsSnap?.exists?hatsSnap.data():{};
     const bonusTickets=checkMonsterBalance(Number(hats.bonusTickets||0),voucherCount,1000000);
     tx.set(hatsRef,{...(hatsSnap?.exists?{}:{voucherOnly:true}),bonusTickets,updatedAt:Date.now()},{merge:true});
    }
    if(jokerGift){
     const voucherGift={...strike.result.gift,hatsVoucher:1};
     next={...next,prizes:(next.prizes||[]).map(g=>g.number===voucherGift.number?voucherGift:g)};
     patchReceipt({gift:voucherGift,hatsVoucherGranted:1});
    }
    if(firstPictureClear){
     // One regular stage-0 chest, plus guaranteed late-game jackpot chests.
     const chest=dogChestOffer(0),dogChest={tier:chest.tier,label:DOG_CHEST_TYPES[chest.tier].label,count:chest.count};
     let newBag=addExpeditionChestToInventory(dogBagSnap?.exists?dogBagSnap.data():null,chest,Date.now());
     const extraChests=[];
     for(let i=0;i<(jackpot?.legendaryChests||0);i++){
      const bonusChest={version:4,stage:9,tier:'legendary',count:20+i*5};
      newBag=addExpeditionChestToInventory(newBag,bonusChest,Date.now());
      extraChests.push({tier:'legendary',label:DOG_CHEST_TYPES.legendary.label,count:bonusChest.count});
     }
     const savedJackpot=jackpot?{...jackpot,extraChests}:null;
     next={...next,prizes:(next.prizes||[]).map(g=>g.number===next.completed?
      {...g,dogChest,...(savedJackpot?{jackpot:savedJackpot}:{})}:g)};
     patchReceipt({dogChest,...(savedJackpot?{jackpot:savedJackpot}:{}),
      ...(strike.result.gift?{gift:{...strike.result.gift,dogChest,
       ...(jokerGift?{hatsVoucher:1}:{}),...(savedJackpot?{jackpot:savedJackpot}:{})}}:{})});
     tx.set(dogBagRef,newBag);
    }
    if(jackpot){
     if(jackpot.cash){
      const cash=next.balance+jackpot.cash;
      if(!Number.isSafeInteger(cash)||cash<0)throw Error('INVALID_JACKPOT_BALANCE');
      next={...next,balance:cash};
     }
     if(jackpot.goldHammers){
      const amount=jackpot.goldHammers;
      next={...next,freeHammers:{...next.freeHammers,lucky:(next.freeHammers?.lucky||0)+amount},
       wheelHammers:{...next.wheelHammers,lucky:(next.wheelHammers?.lucky||0)+amount}};
     }
     if(jackpot.superSlots||jackpot.wildcards){
      const previous=Number(dogAlbumSnap?.data()?.superSlotTickets||0);
      const oldWildcards=Number(dogAlbumSnap?.data()?.wildcardTickets||0);
      const spins=jackpot.superSlots||0,cards=jackpot.wildcards||0;
      if(!Number.isSafeInteger(previous)||previous<0||previous+spins>1000000)throw Error('INVALID_SUPER_SLOT_TICKETS');
      if(!Number.isSafeInteger(oldWildcards)||oldWildcards<0||oldWildcards+cards>1000000)throw Error('INVALID_WILDCARD_TICKETS');
      tx.set(dogAlbumRef,{superSlotTickets:previous+spins,wildcardTickets:oldWildcards+cards,
       ...(cards?{['iceWildcard'+next.completed+'Granted']:true}:{}),
       updatedAt:Date.now()},{merge:true});
      if(cards)next={...next,...{['iceWildcard'+next.completed+'Claimed']:true}};
     }
    }
    if(grantPicture30){
     const tickets=checkMonsterBalance(Number(album.monsterWheelTickets||0),picture30Spins);
     tx.set(albumRef,{monsterWheelTickets:tickets,icePicture30MonsterSpinsGranted:true,updatedAt:Date.now()},{merge:true});
    }
    if(next.balance!==walletBalance)
     tx.set(walletRef,{balance:next.balance,updatedAt:Date.now()},{merge:true});
    patchReceipt({balance:next.balance});
    tx.set(ref,next);
    const finalReceipt=next.lastActions?.find(a=>a.id===requestId)?.result||strike.result;
    return {state:{...publicIceState(next),balance:next.balance},result:finalReceipt,changed:true};
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...result});
  }catch(e){return fail(res,e)}
 });
}
