'use strict';
// Standalone Christmas Hats Jackpot for Deal or No Deal.
// Server controls all hat positions, rolls, checkpoint protection and awards.
import {randomInt,randomUUID} from 'node:crypto';
import {newIceState,normalizeIceState} from './christmas-ice-engine.js';
import {CHRISTMAS_CARDS,christmasDraw,markChristmasDiscoveries} from './christmas-card-engine.js';
import {checkMonsterBalance} from './monster-wheel.js';

export const HATS_MAX_ROOM=20;
// Frozen original high-payout Superglück chances for v1–v5 runs.
export const HATS_SUPER_ODDS=Object.freeze([2,2,2,5,5,5,10,10,15,15,16,16,17,17,18,18,19,19,20,22]);
// New v6: Superglück is rare and the early rooms pay modest prizes.
export const HATS_BALANCED_SUPER_ODDS=Object.freeze([0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,9,10,12]);
// Odds are for THE HAT THE PLAYER PICKS (not for the room).
// Each v3 room has either one bomb or none, so all 3 hats can be safe.
// The last chance cannot exceed 33.33% with three hats and at most one bomb.
// Active legacy v1 and v2 sessions retain their original 10-room length.
// v5: every third room (3, 6, 9, 12, 15, 18) is completely bomb-free.
// The chance below is for one chosen hat, not the chance that the room has a bomb.
// Room 1 starts at 10%; risks climb gently elsewhere. Room 20 is a paid finale.
export const HATS_BOMB_ODDS=Object.freeze([10,12,0,14,16,0,18,20,0,22,24,0,26,28,0,30,31,0,32,33]);
export const HATS_CHECKPOINTS=Object.freeze([5,10,15,20]);
// Frozen, historical v4 20-room rules; never alter previously started games.
const LEGACY_V4_BOMB_ODDS=[0,0,0,10,12,14,16,18,20,22,24,25,26,27,28,29,30,31,32,33];
const LEGACY_V4_CHECKPOINTS=[5,10,15];
// v3 remains fixed for any already started 20-room session.
const LEGACY_V3_BOMB_ODDS=[10,11,12,13,14,15,17,19,21,23,25,26,27,28,29,30,31,32,33,33];
const LEGACY_V3_CHECKPOINTS=[3,5,7,9,12,15,18];
const LEGACY_V2_BOMB_ODDS=[10,12,14,16,18,20,23,26,29,32];
const LEGACY_V2_CHECKPOINTS=[3,5,7,9];
const LEGACY_V1_CHECKPOINTS=[3,7];
const rulesVersion=state=>state?.rulesVersion===6?6:state?.rulesVersion===5?5:state?.rulesVersion===4?4:state?.rulesVersion===3?3:state?.rulesVersion===2?2:1;
const maxRoom=state=>rulesVersion(state)>=3?HATS_MAX_ROOM:10;
const checkpoints=state=>rulesVersion(state)>=5?HATS_CHECKPOINTS:rulesVersion(state)===4?LEGACY_V4_CHECKPOINTS:rulesVersion(state)===3?LEGACY_V3_CHECKPOINTS:rulesVersion(state)===2?LEGACY_V2_CHECKPOINTS:LEGACY_V1_CHECKPOINTS;
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
 const count=room<=3?1+randomInt(2):room<=6?1+randomInt(3):room<=10?1+randomInt(4):2+randomInt(4);
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
const BALANCED_POOLS=Object.freeze([
 Object.freeze(['pack:small','pack:small','pack:small','hammer:single']),
 Object.freeze(['pack:large','pack:large','pack:large','hammer:double','hammer:double','cash']),
 Object.freeze(['pack:large','pack:large','hammer:double','hammer:double','pack:premium','cash','cash','joker']),
 Object.freeze(['pack:large','pack:premium','pack:premium','hammer:double','hammer:double','hammer:lucky','cash','cash','joker']),
 Object.freeze(['pack:premium','pack:premium','pack:premium','pack:platinum','hammer:double','hammer:lucky','cash','cash','cash','joker'])
]);
const BALANCED_CASH=Object.freeze([
 Object.freeze([]),
 Object.freeze([10000,20000,30000,50000]),
 Object.freeze([30000,50000,75000,100000,150000]),
 Object.freeze([60000,100000,150000,200000,300000]),
 Object.freeze([150000,200000,300000,400000,600000,800000,1000000])
]);
const balancedStage=room=>room<=3?0:room<=6?1:room<=10?2:room<=15?3:4;
function balancedSingle(room){
 const stage=balancedStage(room),id=pick(BALANCED_POOLS[stage]);
 return id==='cash'?cash(pick(BALANCED_CASH[stage])):reward(id,1);
}
function balancedRegular(room){
 const count=room<=6?1:randomInt(100)<(room<=10?18:room<=15?28:38)?2:1;
 const items=[],used=new Set();
 for(let t=0;items.length<count&&t<25;t++){
  const item=balancedSingle(room),key=item.kind+':'+(item.packId||item.hammer||'cash');
  if(used.has(key))continue;
  used.add(key);items.push(item);
 }
 return {superLuck:false,items};
}
function balancedSuper(room){
 // Most Superglück wins have only two different items; late ones rarely three.
 const count=room>=16&&randomInt(100)<20?3:2,items=[],used=new Set();
 for(let t=0;items.length<count&&t<30;t++){
  const item=balancedSingle(room),key=item.kind+':'+(item.packId||item.hammer||'cash');
  if(used.has(key))continue;
  used.add(key);items.push(item);
 }
 if(room===20&&randomInt(1000)===0){
  // Grand headline jackpot: only 0.1% of final-room Superglück draws.
  const fiveMillion=cash(5000000),index=items.findIndex(item=>item.kind==='cash');
  if(index>=0)items[index]=fiveMillion;
  else items[0]=fiveMillion;
 }
 return {superLuck:true,items};
}
function drawGift(room,version=5){
 if(version===6)return randomInt(100)<HATS_BALANCED_SUPER_ODDS[room-1]?balancedSuper(room):balancedRegular(room);
 return randomInt(100)<HATS_SUPER_ODDS[room-1]?drawSuper():drawRegular(room);
}
export function drawHatsRoom(room,version=6){
 if(!Number.isInteger(room)||room<1||room>(version>=3?HATS_MAX_ROOM:10)||![1,2,3,4,5,6].includes(version))throw Error('INVALID_ROOM');
 let a=drawGift(room,version),b=drawGift(room,version);
 // A rare exceptional gift should not make the other winning hat falsely
 // advertise itself as "better". Compare actual item values, not animations.
 for(let i=0;scoreHatsPrize(a)===scoreHatsPrize(b)&&i<12;i++)b=drawGift(room,version);
 if(scoreHatsPrize(a)===scoreHatsPrize(b)){
  // A fixed same-tier fallback avoids a sixth prize, duplicate category,
  // or a premium reward appearing in rooms 1–3.
  if(version===6){
   // A tie must NEVER cause the old oversized six-item fallback.
   a={superLuck:false,items:[reward(room<=3?'pack:small':room<=6?'pack:large':'pack:premium',1)]};
   b={superLuck:false,items:[reward(room<=3?'hammer:single':room<=10?'hammer:double':'hammer:lucky',1)]};
   if(scoreHatsPrize(a)===scoreHatsPrize(b))
    b={superLuck:false,items:[cash(room<=6?20000:room<=10?50000:room<=15?150000:400000)]};
  }else{
   a={superLuck:false,items:[reward(room<=3?'pack:small':room<=6?'pack:large':'pack:premium',1)]};
   b=room<=3
    ?{superLuck:false,items:[reward('pack:small',3),reward('hammer:single',3)]}
    :room<=6
     ?{superLuck:false,items:[reward('pack:premium',3),reward('hammer:double',3),reward('joker',3)]}
     :{superLuck:false,items:[cash(5000000),reward('pack:platinum',3),reward('hammer:lucky',3),reward('joker',3),reward('pack:premium',3)]};
  }
 }
 const normal=scoreHatsPrize(a)<scoreHatsPrize(b)?a:b;
 const better=normal===a?b:a;
 // 10–32% odds per hat are mathematically incompatible with an obligatory
 // one-bomb/three-hat board. Make the bomb optional and tell players clearly.
 const chance=version===2?LEGACY_V2_BOMB_ODDS[room-1]
  :version===3?LEGACY_V3_BOMB_ODDS[room-1]
  :version===4?LEGACY_V4_BOMB_ODDS[room-1]:HATS_BOMB_ODDS[room-1];
 const hasBomb=version===1||randomInt(100)<3*chance;
 let extra=null;
 if(!hasBomb){
  extra=version===6?balancedRegular(room):drawRegular(room);
  // The labelled super hat must always be the highest-valued gift.
  if(scoreHatsPrize(extra)>=scoreHatsPrize(better))extra=normal;
 }
 const layout=[hasBomb?{type:'bomb',items:[]}:{type:'gift',...extra},{type:'gift',...normal},{type:'super',...better}];
 for(let i=layout.length-1;i>0;i--){const j=randomInt(i+1);[layout[i],layout[j]]=[layout[j],layout[i]];}
 return layout;
}
function fresh(requestId){
 return {version:1,id:randomUUID(),status:'playing',room:1,layout:drawHatsRoom(1,6),secured:[],pending:[],lastReveal:null,
  lastActionId:requestId,lastActionType:'start',lastActionIndex:null,lastActionResult:{started:true},
  lastActions:[{id:requestId,type:'start',runId:null,index:null,result:{started:true}}],
  updatedAt:Date.now(),createdAt:Date.now(),checkpoint:0,summary:null,rulesVersion:6};
}
// Each authenticated profile receives exactly one free starter voucher.
 // Additional vouchers can be granted by a future trusted reward flow.
function availableHatsVouchers(state){
 const free=state?.freeVoucherUsed?0:1;
 const extras=Number.isSafeInteger(state?.bonusTickets)&&state.bonusTickets>0?state.bonusTickets:0;
 return {free,bonus:extras,total:free+extras,used:!!state?.freeVoucherUsed,active:state?.status==='playing'};
}
function safeView(state){
 // Ice-joker gifts can grant a voucher before a player's first hats run.
 // The voucher-only document has no active/finished game to display.
 if(!state?.status)return null;
 return {id:state.id,status:state.status,room:state.room,checkpoint:state.checkpoint,
  secured:state.secured||[],pending:state.pending||[],lastReveal:state.lastReveal||null,
  summary:state.summary||null,updatedAt:state.updatedAt,
  bombOdds:state.status==='playing'?(rulesVersion(state)>=5?HATS_BOMB_ODDS[state.room-1]:rulesVersion(state)===4?LEGACY_V4_BOMB_ODDS[state.room-1]:rulesVersion(state)===3?LEGACY_V3_BOMB_ODDS[state.room-1]:rulesVersion(state)===2?LEGACY_V2_BOMB_ODDS[state.room-1]:Math.round(100/3)):null,
  maxRoom:maxRoom(state),checkpoints:checkpoints(state),rulesVersion:rulesVersion(state)};
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
 // A genuine server-created voucher-only stub is permitted before the first run.
 // This document must never be interpreted as a finished game.
 if(state?.voucherOnly===true&&!state.status&&Number.isSafeInteger(state.bonusTickets)
  &&state.bonusTickets>=0&&state.bonusTickets<=1000000
  &&(state.freeVoucherUsed===undefined||typeof state.freeVoucherUsed==='boolean'))return;
 if(!state||state.version!==1||!['playing','finished'].includes(state.status)||!Number.isInteger(state.room)
  ||state.room<1||state.room>maxRoom(state)||!Array.isArray(state.secured)||!Array.isArray(state.pending))throw Error('INVALID_SESSION');
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
  if(checkpoints(state).includes(room)){next.secured=[...state.secured,...next.pending];next.pending=[];next.checkpoint=room;}
  if(room===maxRoom(state)){
   next.status='finished';next.layout=null;
   const awarded=[...next.secured,...next.pending];
   next.summary={reason:'completed',room,lost:[],awarded,totals:payoutTotals(awarded)};
   next.secured=awarded;next.pending=[];
  }else{next.room=room+1;next.layout=drawHatsRoom(next.room,rulesVersion(state));}
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
 // Public event chapter; authentication still verifies the actual Firebase UID.
 // Availability and voucher consumption are always checked on the server.
 const fail=(res,error)=>res.status(409).json({ok:false,error:String(error?.message||'HATS_ERROR')});
 app.get('/api/christmas-hats/access',auth,(req,res)=>{
  res.set('Cache-Control','no-store');
  return res.json({ok:true,allowed:true});
 });
 app.get('/api/christmas-hats/me',auth,async(req,res)=>{
  try{const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const pendingId=String(req.query?.pendingId||'');
   if(pendingId&&!VALID_ACTION_ID.test(pendingId))return res.status(400).json({ok:false,error:'INVALID_REQUEST_ID'});
   const snap=await db.collection(SESSION_COLLECTION).doc(req.hatsUid).get();
   const saved=snap.exists?snap.data():null;
   const action=saved?.lastActions?.find(a=>a.id===pendingId)
    ||(saved?.lastActionId===pendingId?{result:saved.lastActionResult}:null);
   res.set('Cache-Control','no-store');
   return res.json({ok:true,state:saved?safeView(saved):null,vouchers:availableHatsVouchers(saved),odds:rulesVersion(saved)===6||!saved?.status?HATS_BALANCED_SUPER_ODDS:HATS_SUPER_ODDS,bombOdds:HATS_BOMB_ODDS,checkpoints:HATS_CHECKPOINTS,maxRoom:HATS_MAX_ROOM,
    ...(pendingId?{pendingAction:{applied:!!action,result:action?.result||null}}:{})});
  }catch(e){return fail(res,e);}
 });
 app.post('/api/christmas-hats/action',auth,async(req,res)=>{
  const type=req.body?.type,requestId=String(req.body?.requestId||'');
  if(!['start','pick','cash'].includes(type)||!VALID_ACTION_ID.test(requestId))
   return res.status(400).json({ok:false,error:'INVALID_ACTION'});
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const uid=req.hatsUid,ref=db.collection(SESSION_COLLECTION).doc(uid);
   const outcome=await db.runTransaction(async tx=>{
    const snap=await tx.get(ref),before=snap.exists?snap.data():null;
    if(before)validStored(before);
    const previous=before?.lastActions?.find(a=>a.id===requestId)
     ||(before?.lastActionId===requestId?{id:requestId,type:before.lastActionType,
       index:before.lastActionIndex,runId:before.id,result:before.lastActionResult}:null);
    if(previous){
     if(previous.type!==type||(type==='pick'&&previous.index!==req.body.index)
      ||(type!=='start'&&previous.runId!==req.body.runId))
      throw Error('REQUEST_ID_CONFLICT');
     return {state:safeView(before),vouchers:availableHatsVouchers(before),result:previous.result,replayed:true,
      outdated:before.lastActionId!==requestId};
    }
    if(type==='start'){
     if(before?.status==='playing')return {state:safeView(before),vouchers:availableHatsVouchers(before),result:{resumed:true},replayed:true};
     const coupons=availableHatsVouchers(before);
     if(!coupons.total)throw Error('NO_HATS_VOUCHERS');
     const next=fresh(requestId),result={started:true,voucherConsumed:coupons.free>0?'free':'bonus'};
     next.freeVoucherUsed=true;
     next.bonusTickets=coupons.bonus-(coupons.free?0:1);
     next.runsStarted=(Number.isSafeInteger(before?.runsStarted)&&before.runsStarted>0?before.runsStarted:0)+1;
     next.lastActionResult=result;
     next.lastActions=[{id:requestId,type:'start',runId:null,index:null,result}];
     tx.set(ref,next);
     return {state:safeView(next),vouchers:availableHatsVouchers(next),result,replayed:false};
    }
    if(!before||before.status!=='playing')throw Error('START_REQUIRED');
    if(typeof req.body?.runId!=='string'||req.body.runId!==before.id)throw Error('SESSION_CHANGED');
    const next=type==='pick'?applyPick(before,req.body.index):applyCash(before);
    const result=type==='pick'?next.lastReveal:{cashed:true};
    next.lastActionId=requestId;next.lastActionType=type;next.lastActionIndex=type==='pick'?req.body.index:null;next.lastActionResult=result;
    next.lastActions=[...(before.lastActions||[]),
     {id:requestId,type,runId:before.id,index:type==='pick'?req.body.index:null,result}].slice(-16);
    if(next.status!=='finished'){tx.set(ref,next);return {state:safeView(next),vouchers:availableHatsVouchers(next),result,replayed:false};}
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
    return {state:safeView(next),vouchers:availableHatsVouchers(next),result,replayed:false};
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...outcome});
  }catch(e){return fail(res,e);}
 });
}
