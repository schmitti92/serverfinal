'use strict';
// Standalone Christmas Hats Jackpot for Deal or No Deal.
// Server controls all hat positions, rolls, checkpoint protection and awards.
import {randomInt,randomUUID} from 'node:crypto';
import {newIceState,normalizeIceState} from './christmas-ice-engine.js';
import {CHRISTMAS_CARDS,christmasDraw,markChristmasDiscoveries} from './christmas-card-engine.js';
import {checkMonsterBalance} from './monster-wheel.js';

export const HATS_MAX_ROOM=10;
export const HATS_SUPER_ODDS=Object.freeze([2,2,2,5,5,5,10,10,15,15]);
const SESSION_COLLECTION='deal_christmas_hats_v1';
const WALLET_COLLECTION='deal_or_no_deal_wallets_v1';
const ALBUM_COLLECTION='deal_or_no_deal_christmas_v1';
const ICE_COLLECTION='christmas_ice_progress_v1';
const JOKER_COLLECTION='deal_peek_inventory_v1';
const VALID_ACTION_ID=/^[a-zA-Z0-9_-]{12,90}$/;
const PACK_VALUES={small:200000,large:500000,premium:1000000,platinum:2500000};
const HAMMER_VALUES={single:300000,double:500000,lucky:1000000};
const PACK_LABELS={small:'Normales Weihnachtspaket',large:'Goldpaket',premium:'Premiumpaket',platinum:'Platinpaket'};
const HAMMER_LABELS={single:'Einfacher Hammer',double:'Doppelhammer',lucky:'Goldener Hammer'};
const PLATINUM_PACK=Object.freeze({id:'platinum',name:'Platin-Kartenpaket',count:16,guaranteed:'epic',guaranteedCount:3,
 weights:{common:30,rare:35,epic:25,legendary:10}});
const MAX_SAFE=Number.MAX_SAFE_INTEGER;
const pick=a=>a[randomInt(a.length)];
const bounded=(n,min,max)=>Math.max(min,Math.min(max,n));
function cash(amountEuro){return {kind:'cash',quantity:1,amountCents:amountEuro*100,label:amountEuro.toLocaleString('de-DE')+' € Spielgeld'};}
function reward(id,quantity){
 if(id==='cash')throw Error('CASH_REQUIRES_AMOUNT');
 if(id==='joker')return {kind:'joker',quantity,label:quantity+' Kofferblick-Joker'};
 if(id.startsWith('pack:')){const packId=id.slice(5);if(!PACK_VALUES[packId])throw Error('INVALID_PACK');return {kind:'pack',packId,quantity,label:quantity+'× '+PACK_LABELS[packId]};}
 if(id.startsWith('hammer:')){const hammer=id.slice(7);if(!HAMMER_VALUES[hammer])throw Error('INVALID_HAMMER');return {kind:'hammer',hammer,quantity,label:quantity+'× '+HAMMER_LABELS[hammer]};}
 throw Error('INVALID_REWARD_TYPE');
}
export function scoreHatsPrize(prize){
 return prize.items.reduce((sum,item)=>sum+(item.kind==='cash'?item.amountCents/100
  :item.kind==='joker'?1000000*item.quantity
  :item.kind==='pack'?PACK_VALUES[item.packId]*item.quantity
  :HAMMER_VALUES[item.hammer]*item.quantity),0);
}
function drawCash(tier){
 const amounts=tier==='medium'?[250000,400000,500000,750000,1000000,1500000]
  :[1000000,1500000,2000000,2500000,3000000,4000000,5000000];
 return cash(pick(amounts));
}
function drawTier(room){
 if(room<=3)return 'easy';
 if(room<=6)return randomInt(100)<10?'high':'medium';
 return randomInt(100)<(room>=9?10:20)?'medium':'high';
}
function makeSingle(room,tier){
 const pool=tier==='easy'?['pack:small','pack:small','hammer:single']
  :tier==='medium'?['pack:large','pack:large','hammer:double','joker','cash','pack:premium']
  :['pack:premium','pack:platinum','hammer:lucky','joker','cash','pack:platinum'];
 const id=pick(pool);
 if(id==='cash')return drawCash(tier);
 const max=room<=3?2:3;
 return reward(id,1+randomInt(max));
}
function drawRegular(room){
 const tier=drawTier(room);
 const count=room<=3?1+randomInt(2):room<=6?1+randomInt(3):1+randomInt(4);
 const items=[];
 for(let i=0;i<count;i++){
  const item=makeSingle(room,tier);
  const found=items.find(x=>x.kind===item.kind&&x.packId===item.packId&&x.hammer===item.hammer);
  if(found){
   if(found.kind==='cash')continue;
   found.quantity=bounded(found.quantity+item.quantity,1,3);
   found.label=reward(found.kind==='pack'?'pack:'+found.packId:found.kind==='hammer'?'hammer:'+found.hammer:'joker',found.quantity).label;
  }else items.push(item);
 }
 return {superLuck:false,items};
}
function drawSuper(){
 // A rare Superglück overrides the usual room tier, including in room one.
 const pool=['pack:small','pack:large','pack:premium','pack:platinum','hammer:double','hammer:lucky','joker','cash'];
 const count=3+randomInt(3),items=[];
 for(let i=0;i<count;i++){
  const chosen=pool.splice(randomInt(pool.length),1)[0];
  items.push(chosen==='cash'?drawCash('high'):reward(chosen,1+randomInt(3)));
 }
 return {superLuck:true,items};
}
function drawGift(room){return randomInt(100)<HATS_SUPER_ODDS[room-1]?drawSuper():drawRegular(room);}
export function drawHatsRoom(room){
 if(!Number.isInteger(room)||room<1||room>HATS_MAX_ROOM)throw Error('INVALID_ROOM');
 let a=drawGift(room),b=drawGift(room);
 // A rare exceptional gift should not make the other winning hat falsely
 // advertise itself as "better". Compare actual item values, not animations.
 for(let i=0;scoreHatsPrize(a)===scoreHatsPrize(b)&&i<12;i++)b=drawGift(room);
 if(scoreHatsPrize(a)===scoreHatsPrize(b)){
  b={...b,items:[...b.items,reward('pack:premium',1)]};
 }
 const normal=scoreHatsPrize(a)<scoreHatsPrize(b)?a:b;
 const better=normal===a?b:a;
 const layout=[{type:'bomb',items:[]},{type:'gift',...normal},{type:'super',...better}];
 for(let i=layout.length-1;i>0;i--){const j=randomInt(i+1);[layout[i],layout[j]]=[layout[j],layout[i]];}
 return layout;
}
function fresh(requestId){
 return {version:1,id:randomUUID(),status:'playing',room:1,layout:drawHatsRoom(1),secured:[],pending:[],lastReveal:null,
  lastActionId:requestId,lastActionResult:null,updatedAt:Date.now(),createdAt:Date.now(),checkpoint:0,summary:null};
}
function safeView(state){
 if(!state)return null;
 return {id:state.id,status:state.status,room:state.room,checkpoint:state.checkpoint,
  secured:state.secured||[],pending:state.pending||[],lastReveal:state.lastReveal||null,
  summary:state.summary||null,updatedAt:state.updatedAt};
}
function totalItems(rewards){return rewards.flatMap(g=>g.items||[]);}
function amountOf(items,kind,subkey=null){return items.filter(item=>item.kind===kind&&(!subkey||item.packId===subkey||item.hammer===subkey)).reduce((sum,item)=>sum+(kind==='cash'?item.amountCents:item.quantity),0);}
function payoutTotals(rewards){
 const items=totalItems(rewards),packs={},hammers={};
 for(const item of items){
  if(item.kind==='pack')packs[item.packId]=(packs[item.packId]||0)+item.quantity;
  else if(item.kind==='hammer')hammers[item.hammer]=(hammers[item.hammer]||0)+item.quantity;
 }
 return {amountCents:amountOf(items,'cash'),jokers:amountOf(items,'joker'),packs,hammers};
}
function validStored(state){
 if(!state||state.version!==1||!['playing','finished'].includes(state.status)||!Number.isInteger(state.room)
  ||state.room<1||state.room>10||!Array.isArray(state.secured)||!Array.isArray(state.pending))throw Error('INVALID_SESSION');
 if(state.status==='playing'&&(!Array.isArray(state.layout)||state.layout.length!==3))throw Error('INVALID_SESSION');
}
function applyPick(state,index){
 if(!Number.isInteger(index)||index<0||index>2)throw Error('INVALID_HAT');
 const room=state.room,selection=state.layout[index];
 const result={room,index,type:selection.type,superLuck:!!selection.superLuck,items:selection.items||[],
  hats:state.layout.map(h=>({type:h.type,superLuck:!!h.superLuck,items:h.items||[]}))};
 const next={...state,lastReveal:result,updatedAt:Date.now()};
 if(selection.type==='bomb'){
  next.status='finished';next.layout=null;
  next.summary={reason:'bomb',room,lost:state.pending,awarded:state.secured,totals:payoutTotals(state.secured)};
  next.pending=[];
 }else{
  const bag={room,items:selection.items,superLuck:!!selection.superLuck,hatType:selection.type};
  next.pending=[...state.pending,bag];
  if(room===3||room===7){next.secured=[...state.secured,...next.pending];next.pending=[];next.checkpoint=room;}
  if(room===10){
   next.status='finished';next.layout=null;
   const awarded=[...next.secured,...next.pending];
   next.summary={reason:'completed',room,lost:[],awarded,totals:payoutTotals(awarded)};
   next.secured=awarded;next.pending=[];
  }else{next.room=room+1;next.layout=drawHatsRoom(next.room);}
 }
 return next;
}
function applyCash(state){
 const awarded=[...state.secured,...state.pending];
 return {...state,status:'finished',layout:null,updatedAt:Date.now(),
  secured:awarded,pending:[],summary:{reason:'cash',room:state.room,lost:[],awarded,totals:payoutTotals(awarded)}};
}
function addSafe(balance,amount){return checkMonsterBalance(Number(balance||0),Number(amount||0),MAX_SAFE);}

export function installChristmasHatsApi(app,{verifyProfile,getFirestore}){
 const auth=async(req,res,next)=>{
  try{const token=/^Bearer (.+)$/i.exec(req.get('authorization')||'')?.[1];
   const user=await verifyProfile(token);if(!user?.uid)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   req.hatsUid=String(user.uid);next();
  }catch{return res.status(401).json({ok:false,error:'AUTH_FAILED'});}
 };
 const fail=(res,error)=>res.status(409).json({ok:false,error:String(error?.message||'HATS_ERROR')});
 app.get('/api/deal-or-no-deal/hats/me',auth,async(req,res)=>{
  try{const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const snap=await db.collection(SESSION_COLLECTION).doc(req.hatsUid).get();
   res.set('Cache-Control','no-store');
   return res.json({ok:true,state:snap.exists?safeView(snap.data()):null,odds:HATS_SUPER_ODDS});
  }catch(e){return fail(res,e);}
 });
 app.post('/api/deal-or-no-deal/hats/action',auth,async(req,res)=>{
  const type=req.body?.type,requestId=String(req.body?.requestId||'');
  if(!['start','pick','cash'].includes(type)||!VALID_ACTION_ID.test(requestId))
   return res.status(400).json({ok:false,error:'INVALID_ACTION'});
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const uid=req.hatsUid,ref=db.collection(SESSION_COLLECTION).doc(uid);
   const outcome=await db.runTransaction(async tx=>{
    const snap=await tx.get(ref),before=snap.exists?snap.data():null;
    if(before)validStored(before);
    if(before?.lastActionId===requestId)return {state:safeView(before),result:before.lastActionResult,replayed:true};
    if(type==='start'){
     if(before?.status==='playing')return {state:safeView(before),result:{resumed:true},replayed:true};
     const next=fresh(requestId),result={started:true};
     next.lastActionResult=result;
     tx.set(ref,next);
     return {state:safeView(next),result,replayed:false};
    }
    if(!before||before.status!=='playing')throw Error('START_REQUIRED');
    if(typeof req.body?.runId!=='string'||req.body.runId!==before.id)throw Error('SESSION_CHANGED');
    const next=type==='pick'?applyPick(before,req.body.index):applyCash(before);
    const result=type==='pick'?next.lastReveal:{cashed:true};
    next.lastActionId=requestId;next.lastActionResult=result;
    if(next.status!=='finished'){tx.set(ref,next);return {state:safeView(next),result,replayed:false};}
    // Every finished run settles atomically with its state. No prize is
    // credited at revelation time: secured prizes survive an eventual bomb.
    const totals=next.summary.totals,now=Date.now();
    const walletRef=db.collection(WALLET_COLLECTION).doc(uid);
    const jokerRef=db.collection(JOKER_COLLECTION).doc(uid);
    const iceRef=db.collection(ICE_COLLECTION).doc(uid);
    const albumRef=db.collection(ALBUM_COLLECTION).doc(uid);
    const needsWallet=totals.amountCents>0,needsJoker=totals.jokers>0;
    const needsIce=Object.values(totals.hammers).some(v=>v>0);
    const needsAlbum=Object.values(totals.packs).some(v=>v>0);
    const [walletSnap,jokerSnap,iceSnap,albumSnap]=await Promise.all([
     needsWallet?tx.get(walletRef):null,needsJoker?tx.get(jokerRef):null,
     needsIce?tx.get(iceRef):null,needsAlbum?tx.get(albumRef):null
    ]);
    if(needsWallet)tx.set(walletRef,{balance:addSafe(walletSnap?.data()?.balance,totals.amountCents),updatedAt:now},{merge:true});
    if(needsJoker)tx.set(jokerRef,{balance:checkMonsterBalance(Number(jokerSnap?.data()?.balance)||0,totals.jokers,1000000),updatedAt:now},{merge:true});
    if(needsIce){
     const ice=iceSnap?.exists?normalizeIceState(iceSnap.data()):newIceState();
     const freeHammers={...ice.freeHammers},wheelHammers={...ice.wheelHammers};
     for(const [hammer,n] of Object.entries(totals.hammers)){
      freeHammers[hammer]=addSafe(freeHammers[hammer],n);
      wheelHammers[hammer]=addSafe(wheelHammers[hammer],n);
     }
     tx.set(iceRef,{...ice,freeHammers,wheelHammers,updatedAt:now});
    }
    if(needsAlbum){
     const previous=albumSnap?.exists?albumSnap.data():{};
     const vouchers={...(previous.freeChristmasPacks||{})};
     const update={updatedAt:now};
     for(const [pack,n] of Object.entries(totals.packs)){
      if(pack!=='platinum')vouchers[pack]=addSafe(vouchers[pack],n);
     }
     update.freeChristmasPacks=vouchers;
     // Existing platinum bingo reward opens its cards immediately. Use the same
     // Christmas album format; platinum has no normal shop/open endpoint.
     if(totals.packs.platinum){
      const drawn=Array.from({length:totals.packs.platinum},()=>{
       const first=christmasDraw({...PLATINUM_PACK,count:1,guaranteed:'legendary',guaranteedCount:1});
       return [...first,...christmasDraw({...PLATINUM_PACK,count:15})];
      }).flat();
      const cards={...(previous.cards||{})};
      for(const card of markChristmasDiscoveries(drawn,cards)){
       cards[card.id]=addSafe(cards[card.id],1);
      }
      update.cards=cards;
      update.opened=addSafe(previous.opened,totals.packs.platinum);
      next.summary.platinumOpenedImmediately=true;
     }
     tx.set(albumRef,update,{merge:true});
    }
    next.summary.settledAt=now;
    // The state itself is the exact-once settlement receipt.
    tx.set(ref,next);
    return {state:safeView(next),result,replayed:false};
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...outcome});
  }catch(e){return fail(res,e);}
 });
}
