'use strict';
import {randomInt,randomUUID} from 'node:crypto';

// Server-authoritative online event. One progress document read per strike.
// No polling, no animation writes, no trust in browser localStorage.
export function installChristmasIceOnline(app,{verifyProfile,getFirestore}){
 const collection='christmas_ice_online_v1';
 const inventoryCollection='deal_peek_inventory_v1';
 const PRICES={single:300000,double:500000,lucky:1000000};
 const INITIAL_BALANCE=12450000;
 const auth=async(req,res,next)=>{
  try{const token=/^Bearer (.+)$/i.exec(req.get('authorization')||'')?.[1];
   const identity=await verifyProfile(token);
   if(!identity?.uid)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   req.iceUid=String(identity.uid);next();
  }catch{return res.status(401).json({ok:false,error:'AUTH_FAILED'})}
 };
 const initial=()=>({balance:INITIAL_BALANCE,completed:0,opened:[],star:randomInt(20),freeHammers:{single:0,double:0,lucky:0},peekJokersEarned:0,revision:0,updatedAt:Date.now()});
 const publicState=s=>({balance:s.balance,completed:s.completed,opened:s.opened,freeHammers:s.freeHammers,peekJokersEarned:s.peekJokersEarned,revision:s.revision,finished:s.completed>=70});
 const fail=(res,e)=>res.status(409).json({ok:false,error:String(e?.message||'EVENT_ERROR')});
 app.get('/api/christmas-ice/me',auth,async(req,res)=>{
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const ref=db.collection(collection).doc(req.iceUid);
   const snap=await ref.get();
   res.set('Cache-Control','no-store');
   return res.json({ok:true,started:snap.exists,state:snap.exists?publicState(snap.data()):null});
  }catch(e){return fail(res,e)}
 });
 app.post('/api/christmas-ice/start',auth,async(req,res)=>{
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const ref=db.collection(collection).doc(req.iceUid);
   const state=await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(snap.exists)return snap.data();
    const state=initial();tx.create(ref,state);return state;
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,state:publicState(state)});
  }catch(e){return fail(res,e)}
 });
 // Each strike is idempotent via a monotonically increasing expected revision.
 // A successful star reveals a picture; every third picture grants one online peek joker.
 app.post('/api/christmas-ice/strike',auth,async(req,res)=>{
  const kind=String(req.body?.kind||''),tile=req.body?.tile,revision=req.body?.revision;
  if(!Object.hasOwn(PRICES,kind)||!Number.isInteger(tile)||tile<0||tile>=20||
    !Number.isSafeInteger(revision)||revision<0)return res.status(400).json({ok:false,error:'INVALID_ACTION'});
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const ref=db.collection(collection).doc(req.iceUid),invRef=db.collection(inventoryCollection).doc(req.iceUid);
   const result=await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(!snap.exists)throw Error('START_REQUIRED');
    const state=snap.data();
    if(state.revision!==revision)throw Error('STALE_REVISION');
    if(state.completed>=70)throw Error('EVENT_FINISHED');
    if(state.opened.includes(tile))throw Error('TILE_ALREADY_OPEN');
    const free=Number(state.freeHammers?.[kind]||0);
    if(free<1&&state.balance<PRICES[kind])throw Error('NOT_ENOUGH_MONEY');
    // Read the inventory only if this action will grant a joker.
    const hits=kind==='single'?1:kind==='double'?2:randomInt(3,7);
    const available=Array.from({length:20},(_,i)=>i).filter(i=>!state.opened.includes(i));
    const chosen=[tile,...available.filter(i=>i!==tile).sort(()=>randomInt(3)-1).slice(0,Math.min(hits-1,available.length-1))];
    const starFound=chosen.includes(state.star);
    const nextCompleted=state.completed+(starFound?1:0);
    const grantsJoker=starFound&&nextCompleted%3===0;
    const inv=grantsJoker?await tx.get(invRef):null;
    const next={...state,balance:state.balance-(free>0?0:PRICES[kind]),
      freeHammers:{...state.freeHammers,[kind]:Math.max(0,free-1)},
      opened:starFound?[]:[...state.opened,...chosen],
      completed:nextCompleted,star:starFound?randomInt(20):state.star,
      peekJokersEarned:(state.peekJokersEarned||0)+(grantsJoker?1:0),
      revision:state.revision+1,updatedAt:Date.now()};
    tx.set(ref,next);
    if(grantsJoker){const balance=Number(inv.data()?.balance||0);if(!Number.isSafeInteger(balance)||balance<0)throw Error('INVALID_JOKER_BALANCE');tx.set(invRef,{balance:balance+1,updatedAt:Date.now()},{merge:true})}
    return {state:publicState(next),openedTiles:chosen,starFound,jokerGranted:grantsJoker};
   });
   res.set('Cache-Control','no-store');return res.json({ok:true,...result});
  }catch(e){return fail(res,e)}
 });
}
