'use strict';
// Private Kofferblick endpoint. Inventory can only be granted by trusted server operations.
// Offline localStorage balances are deliberately never accepted.
export function installPeekJoker(app,{verifyProfile,getFirestore}) {
 const CODE=/^(?:\d{3}|[A-HJ-NP-Z2-9]{6})$/;
 const auth=async(req,res,next)=>{
  try {const token=/^Bearer (.+)$/i.exec(req.get('authorization')||'')?.[1];
   const identity=await verifyProfile(token);
   if(!identity?.uid)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
   req.peekUid=String(identity.uid);next();
  }catch{return res.status(401).json({ok:false,error:'AUTH_FAILED'})}
 };
 app.get('/api/deal-or-no-deal/peek/me',auth,async(req,res)=>{
  try {const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const doc=await db.collection('deal_peek_inventory_v1').doc(req.peekUid).get();
   res.set('Cache-Control','no-store');
   return res.json({ok:true,balance:Math.max(0,Number(doc.data()?.balance)||0)});
  }catch{return res.status(503).json({ok:false,error:'STORAGE_UNAVAILABLE'})}
 });
 app.post('/api/deal-or-no-deal/:code/peek',auth,async(req,res)=>{
  const code=String(req.params.code||'').toUpperCase();
  const caseIndex=req.body?.case;
  const requestId=String(req.body?.requestId||'');
  if(!CODE.test(code)||!Number.isInteger(caseIndex)||caseIndex<0||caseIndex>28||
    !/^[a-zA-Z0-9_-]{12,90}$/.test(requestId))return res.status(400).json({ok:false,error:'INVALID_REQUEST'});
  try {
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const gameRef=db.collection('deal_or_no_deal_matches_v1').doc(code);
   const roomRef=db.collection('spielesammlung_hub_v1').doc(code);
   const invRef=db.collection('deal_peek_inventory_v1').doc(req.peekUid);
   const receiptRef=invRef.collection('receipts').doc(requestId);
   const result=await db.runTransaction(async tx=>{
    const [receiptSnap,gameSnap,invSnap,roomSnap]=await Promise.all([tx.get(receiptRef),tx.get(gameRef),tx.get(invRef),tx.get(roomRef)]);
    if(!roomSnap.exists||!roomSnap.data()?.players?.some(p=>String(p.uid)===req.peekUid&&!p.testBot&&!p.bot))throw Error('NOT_IN_ROOM');
    if(!gameSnap.exists)throw Error('GAME_NOT_FOUND');
    const game=gameSnap.data()?.game;
    if(!game||!Array.isArray(game.values)||![26,27,28,29].includes(game.values.length))throw Error('GAME_INVALID');
    // Validate against the CURRENT match, not the historic 26-case cap.
    if(caseIndex>=game.values.length)throw Error('INVALID_CASE');
    if(!game.players?.some(p=>String(p.id)===req.peekUid))throw Error('NOT_PARTICIPANT');
    // Only selected personal cases belonging to OTHER players qualify.
    // The requester's case value is never returned, even during replay.
    const opponents=game.players.filter(p=>String(p.id)!==req.peekUid);
    const otherCases=opponents.filter(p=>Number.isInteger(p.case)&&p.case>=0&&p.case<game.values.length)
     .map(p=>({id:String(p.id),name:String(p.name||'Mitspieler').slice(0,30),case:p.case,amount:game.values[p.case]}));
    if(!otherCases.length)throw Error('NO_OTHER_PLAYER_CASES');
    const own=game.players.find(p=>String(p.id)===req.peekUid);
    if(caseIndex===own?.case)throw Error('OWN_CASE_FORBIDDEN');
    if(!otherCases.some(p=>p.case===caseIndex))throw Error('NOT_OPPONENT_CASE');
    if(!otherCases.every(p=>Number.isSafeInteger(p.amount)&&p.amount>=0))throw Error('GAME_INVALID');
    if(game.opened?.includes(caseIndex)||game.pending?.case===caseIndex||
       otherCases.some(p=>game.opened?.includes(p.case)||game.pending?.case===p.case))throw Error('CASE_NOT_CLOSED');
    if(receiptSnap.exists){
     const receipt=receiptSnap.data();
     if(receipt.code!==code||receipt.case!==caseIndex||receipt.gameId!==game.id)throw Error('REQUEST_REUSED');
     // Old single-case receipts are safe to replay using current opponents.
     const privateCases=Array.isArray(receipt.cases)?receipt.cases:otherCases;
     return {case:caseIndex,cases:privateCases.filter(p=>p.id!==req.peekUid),balance:receipt.balance,replayed:true};
    }
    if(!game.players.some(p=>String(p.id)===req.peekUid&&p.deal===null))throw Error('NOT_ACTIVE_PLAYER');
    if(!['open','decision','reveal'].includes(game.phase))throw Error('JOKER_NOT_AVAILABLE');
    const balance=Number(invSnap.data()?.balance)||0;
    if(!Number.isSafeInteger(balance)||balance<1)throw Error('NO_JOKERS');
    const nextBalance=balance-1;
    tx.set(invRef,{balance:nextBalance,updatedAt:Date.now()},{merge:true});
    // One private receipt, one charge, all other participants' case amounts.
    tx.create(receiptRef,{gameId:game.id,code,case:caseIndex,cases:otherCases,balance:nextBalance,createdAt:Date.now()});
    return {case:caseIndex,cases:otherCases,balance:nextBalance,replayed:false};
   });
   res.set('Cache-Control','no-store');
   return res.json({ok:true,...result});
  }catch(e){
   const error=String(e?.message||'JOKER_ERROR');
   const status=['NOT_ACTIVE_PLAYER','NOT_PARTICIPANT','NOT_IN_ROOM'].includes(error)?403:error==='GAME_NOT_FOUND'?404:
    error==='STORAGE_UNAVAILABLE'?503:409;
   return res.status(status).json({ok:false,error});
  }
 });
}
