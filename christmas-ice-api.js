'use strict';
import {newIceState,publicIceState,strikeIce,nextIcePicture,resetIceState,normalizeIceState} from './christmas-ice-engine.js';
import {drawHammerFromTwelve} from './deal-or-no-deal.js';
import {checkMonsterBalance} from './monster-wheel.js';
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
    // Only a server-confirmed complete picture 30 earns three Monster-Wheel spins.
    // Read the album only on this single winning strike, not on every ice click.
    const picture30Completed=strike.result.found&&next.completed===30;
    const albumRef=db.collection(albumCollection).doc(req.iceUid);
    const albumSnap=picture30Completed?await tx.get(albumRef):null;
    const album=albumSnap?.exists?albumSnap.data():{};
    const grantPicture30=picture30Completed&&!album.icePicture30MonsterSpinsGranted&&!state.picture30MonsterSpinsClaimed;
    let newMonsterTickets=0;
    if(grantPicture30)
     newMonsterTickets=checkMonsterBalance(Number(album.monsterWheelTickets||0),picture30Spins);
    if(picture30Completed){
     const resultWithBonus={...strike.result,monsterSpinsGranted:grantPicture30?picture30Spins:0};
     next={...next,picture30MonsterSpinsClaimed:true,
      lastActions:(next.lastActions||[]).map(a=>a.id===requestId?{...a,result:resultWithBonus}:a)};
    }
    if(strike.result.gift?.kind==='joker'){
     // Every freshly earned joker picture also grants one genuine hats run.
     // Both inventory updates are inside the SAME Firestore transaction as
     // the paid hammer, picture progress and eventual monster-wheel bonus.
     // In particular, no voucher is issued for replayed/reset old pictures.
     const hatsRef=db.collection(hatsCollection).doc(req.iceUid);
     const [invSnap,hatsSnap]=await Promise.all([tx.get(inventory),tx.get(hatsRef)]);
     const old=Number(invSnap.data()?.balance)||0;
     if(!Number.isSafeInteger(old)||old<0||old>=1000000)throw Error('INVALID_JOKER_BALANCE');
     const hats=hatsSnap.exists?hatsSnap.data():{};
     const bonusTickets=checkMonsterBalance(Number(hats.bonusTickets||0),1,1000000);
     const voucherGift={...strike.result.gift,hatsVoucher:1};
     next={...next,
      prizes:(next.prizes||[]).map(g=>g.number===voucherGift.number?voucherGift:g),
      lastActions:(next.lastActions||[]).map(a=>a.id===requestId
       ?{...a,result:{...a.result,gift:voucherGift,hatsVoucherGranted:1}}:a)};
     const now=Date.now();
     tx.set(inventory,{balance:old+1,updatedAt:now},{merge:true});
     tx.set(hatsRef,{...(hatsSnap.exists?{}:{voucherOnly:true}),
      bonusTickets,updatedAt:now},{merge:true});
    }
    // A free hammer usually changes only ice progress. Avoid a redundant
    // wallet write unless a paid hit or a money prize changed the balance.
    // The entire strike (and any money prize) stays atomic in this transaction.
    if(grantPicture30)
     tx.set(albumRef,{monsterWheelTickets:newMonsterTickets,icePicture30MonsterSpinsGranted:true,updatedAt:Date.now()},{merge:true});
    if(next.balance!==walletBalance)
     tx.set(walletRef,{balance:next.balance,updatedAt:Date.now()},{merge:true});
    tx.set(ref,next);
    const finalReceipt=next.lastActions?.find(a=>a.id===requestId)?.result||strike.result;
    return {state:{...publicIceState(next),balance:next.balance},result:finalReceipt,changed:true};
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...result});
  }catch(e){return fail(res,e)}
 });
}
