'use strict';
import {newIceState,publicIceState,strikeIce,nextIcePicture,resetIceState,normalizeIceState} from './christmas-ice-engine.js';
import {drawHammerFromTwelve} from './deal-or-no-deal.js';
// Server-authoritative progress; one Firestore state document per authenticated player.
// A hammer strike reads/writes only the state document; joker awards also update inventory.
// Do not migrate unverified localStorage data.
export function installChristmasIceApi(app,{verifyProfile,getFirestore,notifyDealGameChanged}){
 const collection='christmas_ice_progress_v1',inventoryCollection='deal_peek_inventory_v1',walletCollection='deal_or_no_deal_wallets_v1';
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
   const [snap,wallet]=await Promise.all([db.collection(collection).doc(req.iceUid).get(),db.collection(walletCollection).doc(req.iceUid).get()]);
   res.set('Cache-Control','no-store');
   return res.json({ok:true,started:snap.exists,state:snap.exists?{...publicIceState(normalizeIceState(snap.data())),balance:Number(wallet.data()?.balance)||0}:null});
  }catch(e){return fail(res,e)}
 });
 // Lightweight avatar unlock check: one progress read, no wallet access.
 app.get('/api/christmas-ice/unlocks',auth,async(req,res)=>{
  try{const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const snap=await db.collection(collection).doc(req.iceUid).get();
   const state=snap.exists?normalizeIceState(snap.data()):null;
   res.set('Cache-Control','no-store');
   return res.json({ok:true,janSchlappen:!!state&&Math.max(Number(state.maxRewarded||0),Number(state.completed||0))>=10});
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
  const {type,index,hammer,requestId}=req.body||{};
  if(!['start','strike','next','reset','welcome'].includes(type))return res.status(400).json({ok:false,error:'INVALID_ACTION'});
  if(!/^[A-Za-z0-9_-]{12,90}$/.test(String(requestId||'')))return res.status(400).json({ok:false,error:'INVALID_REQUEST_ID'});
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
    const strike=strikeIce({...state,balance:walletBalance},{index,hammer,requestId});
    if(!strike.changed)return {state:{...publicIceState(state),balance:walletBalance},result:strike.result,changed:false};
    const next=strike.state;
    if(strike.result.gift?.kind==='joker'){
     const invSnap=await tx.get(inventory);
     const old=Number(invSnap.data()?.balance)||0;
     if(!Number.isSafeInteger(old)||old<0||old>=1000000)throw Error('INVALID_JOKER_BALANCE');
     tx.set(inventory,{balance:old+1,updatedAt:Date.now()},{merge:true});
    }
    tx.set(walletRef,{balance:next.balance,updatedAt:Date.now()},{merge:true});
    tx.set(ref,next);
    return {state:{...publicIceState(next),balance:next.balance},result:strike.result,changed:true};
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...result});
  }catch(e){return fail(res,e)}
 });
}
