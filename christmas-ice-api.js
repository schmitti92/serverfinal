'use strict';
import {newIceState,publicIceState,strikeIce,nextIcePicture,resetIceState} from './christmas-ice-engine.js';
// Server-authoritative progress; one Firestore state document per authenticated player.
// A hammer strike reads/writes only the state document; joker awards also update inventory.
// Do not migrate unverified localStorage data.
export function installChristmasIceApi(app,{verifyProfile,getFirestore}){
 const collection='christmas_ice_progress_v1',inventoryCollection='deal_peek_inventory_v1';
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
   const snap=await db.collection(collection).doc(req.iceUid).get();
   res.set('Cache-Control','no-store');
   return res.json({ok:true,started:snap.exists,state:snap.exists?publicIceState(snap.data()):null});
  }catch(e){return fail(res,e)}
 });
 // A final-round winner gets exactly one hammer wheel spin, only after the
 // existing Christmas card-pack wheel has started. The award is persisted once.
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
    const payouts=(game.finalValues||[]).map(x=>({id:x.id,payout:x.payout}));
    if(!payouts.length)throw Error('RESULT_NOT_READY');
    const max=Math.max(...payouts.map(x=>x.payout));
    const winners=payouts.filter(x=>x.payout===max);
    if(winners.length!==1||String(winners[0].id)!==req.iceUid)throw Error('WINNER_ONLY');
    if(!game.christmasWheelSpins?.['final:'+game.id])throw Error('PACK_WHEEL_FIRST');
    if(receiptSnap.exists){
     if(receiptSnap.data()?.uid!==req.iceUid)throw Error('ALREADY_AWARDED');
     return {hammer:receiptSnap.data().hammer,replayed:true};
    }
    // Identical 50/35/15 distribution as the existing event hammer draw.
    const roll=Math.floor(Math.random()*100);
    const hammer=roll<50?'single':roll<85?'double':'lucky';
    const state=progressSnap.exists?progressSnap.data():newIceState();
    const next={...state,freeHammers:{...state.freeHammers,[hammer]:(state.freeHammers?.[hammer]||0)+1}};
    tx.set(progressRef,next);
    tx.create(receiptRef,{uid:req.iceUid,gameId,hammer,createdAt:Date.now()});
    return {hammer,replayed:false};
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...result});
  }catch(e){return fail(res,e)}
 });

 app.post('/api/christmas-ice/action',auth,async(req,res)=>{
  const {type,index,hammer,requestId}=req.body||{};
  if(!['start','strike','next','reset'].includes(type))return res.status(400).json({ok:false,error:'INVALID_ACTION'});
  if(!/^[A-Za-z0-9_-]{12,90}$/.test(String(requestId||'')))return res.status(400).json({ok:false,error:'INVALID_REQUEST_ID'});
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const ref=db.collection(collection).doc(req.iceUid);
   const inventory=db.collection(inventoryCollection).doc(req.iceUid);
   const result=await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(type==='start'){
     if(snap.exists)return {state:publicIceState(snap.data()),changed:false};
     const state=newIceState();tx.create(ref,state);
     return {state:publicIceState(state),changed:true};
    }
    if(!snap.exists)throw Error('START_REQUIRED');
    const state=snap.data();
    const previous=state.lastActions?.find(x=>x.id===requestId);
    if(previous)return {state:publicIceState(state),result:{...previous.result,replayed:true},changed:false};
    if(type==='reset'){
     const next=resetIceState(state);
     const result={reset:true};
     next.lastActions=[{id:requestId,result}];
     tx.set(ref,next);
     return {state:publicIceState(next),result,changed:true};
    }
    if(type==='next'){
     const next=nextIcePicture(state);
     const result={advanced:true,completed:next.completed};
     next.lastActions=[...(next.lastActions||[]),{id:requestId,result}].slice(-32);
     tx.set(ref,next);
     return {state:publicIceState(next),result,changed:true};
    }
    const strike=strikeIce(state,{index,hammer,requestId});
    if(!strike.changed)return {state:publicIceState(state),result:strike.result,changed:false};
    const next=strike.state;
    if(strike.result.gift?.kind==='joker'){
     const invSnap=await tx.get(inventory);
     const old=Number(invSnap.data()?.balance)||0;
     if(!Number.isSafeInteger(old)||old<0||old>=1000000)throw Error('INVALID_JOKER_BALANCE');
     tx.set(inventory,{balance:old+1,updatedAt:Date.now()},{merge:true});
    }
    tx.set(ref,next);
    return {state:publicIceState(next),result:strike.result,changed:true};
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...result});
  }catch(e){return fail(res,e)}
 });
}
