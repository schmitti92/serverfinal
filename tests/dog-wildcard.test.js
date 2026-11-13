import test from 'node:test';
import assert from 'node:assert/strict';
import {DOG_S2_CARDS,dogS2MissingWildcardCards,dogS2RedeemWildcard,dogS2AdvanceCycles,installDogAlbumSeason2} from '../dog-album-season2.js';
import {drawMonsterSlot,MONSTER_SLOTS_WEIGHTS,MONSTER_SLOT_WILDCARD_NONCASH_ODDS,monsterSlotRarity} from '../monster-slots.js';
import {ICE_JACKPOTS} from '../christmas-ice-prizes.js';

test('question-mark wildcard is ultra-rare and preserves 2:1 money/item category odds',()=>{
 assert.equal(MONSTER_SLOT_WILDCARD_NONCASH_ODDS,3000);
 const total=Object.values(MONSTER_SLOTS_WEIGHTS).reduce((a,b)=>a+b,0);
 assert.equal(MONSTER_SLOTS_WEIGHTS.cash/total,2/3);
 const special=drawMonsterSlot(1,max=>max===3000?1234:0);
 assert.equal(special.kind,'wildcard');
 assert.equal(special.quantity,1);
 assert.equal(special.rarity,'mythic');
 assert.match(special.label,/Joker-Sammelkarte/);
 assert.equal(drawMonsterSlot(1,()=>0).kind,'chest');
 assert.equal(monsterSlotRarity({kind:'cash',amountCents:500000000}),'mythic');
 assert.equal(monsterSlotRarity({kind:'chest',id:'legendary'}),'legendary');
});
test('wildcard redeems any missing card including the 1:500 legendary and completes a board',()=>{
 const firstBoard=DOG_S2_CARDS.slice(0,16),last=firstBoard.at(-1);
 const before=Object.fromEntries(firstBoard.slice(0,15).map(card=>[card.id,1]));
 const old={wildcardTickets:1,superSlotTickets:0,cycleBase:{},cycleCompletions:[0,0,0,0,0,0]};
 assert.equal(dogS2MissingWildcardCards(before,old).some(card=>card.id===last.id),true);
 const gift=dogS2RedeemWildcard(before,old,last.id);
 assert.equal(gift.cards[last.id],1);assert.equal(gift.wildcardTickets,0);
 const advance=dogS2AdvanceCycles(before,gift.cards,old);
 assert.equal(advance.finished.length,1);
 assert.equal(advance.progress.superSlotTickets,1);
 assert.equal(advance.progress.boards[0].collected,0,'new cycle begins after board completion');
 assert.equal(dogS2MissingWildcardCards(gift.cards,{...old,...advance.updates}).length,96);
 assert.throws(()=>dogS2RedeemWildcard(before,old,firstBoard[0].id),/DOG_CARD_ALREADY_COLLECTED/);
 assert.throws(()=>dogS2RedeemWildcard(before,{...old,wildcardTickets:0},last.id),/DOG_WILDCARD_REQUIRED/);
 assert.throws(()=>dogS2RedeemWildcard(before,old,'not-a-dog-card'),/INVALID_DOG_WILDCARD_CARD/);
});
test('pictures 50 and 60 each grant an additive guaranteed question-mark card',()=>{
 assert.equal(ICE_JACKPOTS[50].wildcards,1);
 assert.equal(ICE_JACKPOTS[60].wildcards,1);
 assert.equal(ICE_JACKPOTS[50].superSlots,3);
 assert.equal(ICE_JACKPOTS[60].superSlots,5);
 assert.equal(ICE_JACKPOTS[70].wildcards,undefined);
});
test('redeeming a question-mark card uses one server receipt and never double credits',async()=>{
 const uid='picker',docs=new Map(),routes=new Map(),writes=[];
 const aRef='deal_dog_album_season2_v1/'+uid;
 docs.set(aRef,{cards:{},wildcardTickets:1,cycleBase:{},cycleCompletions:[0,0,0,0,0,0]});
 const db={
  collection:name=>({doc:id=>({
   key:name+'/'+id,get:async()=>({exists:docs.has(name+'/'+id),data:()=>structuredClone(docs.get(name+'/'+id))})
  })}),
  runTransaction:async callback=>{
   const pending=[];let wrote=false;
   const tx={
    get:ref=>{if(wrote)throw Error('READ_AFTER_WRITE');const v=docs.get(ref.key);return Promise.resolve({exists:v!==undefined,data:()=>structuredClone(v)})},
    set:(ref,value,options)=>{wrote=true;pending.push(()=>{docs.set(ref.key,options?.merge?{...(docs.get(ref.key)||{}),...structuredClone(value)}:structuredClone(value));writes.push(ref.key)})},
    create:(ref,value)=>{wrote=true;pending.push(()=>{if(docs.has(ref.key))throw Error('DUP_RECEIPT');docs.set(ref.key,structuredClone(value));writes.push(ref.key)})}
   };
   const result=await callback(tx);for(const save of pending)save();return result;
  }
 };
 const app={get:(path,...handlers)=>routes.set('GET '+path,handlers),post:(path,...handlers)=>routes.set('POST '+path,handlers)};
 installDogAlbumSeason2(app,{auth:(req,res,next)=>{req.dealIdentity={uid,displayName:'Picker'};next()},getFirestore:()=>db,fail:(res,e)=>res.status(409).json({ok:false,error:e.message})});
 async function send(body){
  const handlers=routes.get('POST /api/deal-or-no-deal/christmas/season2/wildcards/redeem');
  const req={body};const res={statusCode:200,status(n){this.statusCode=n;return this},set(){return this},json(value){this.body=value;return this}};
  await new Promise((resolve,reject)=>{
   handlers[0](req,res,()=>{Promise.resolve(handlers[1](req,res)).then(resolve,reject)}).catch(reject);
  });
  return res;
 }
 const cardId=DOG_S2_CARDS.at(-1).id;
 const request={cardId,requestId:'joker_claim_00000000001'};
 const awarded=await send(request);
 assert.equal(awarded.statusCode,200,JSON.stringify(awarded.body));
 assert.equal(awarded.body.card.id,cardId);
 assert.equal(awarded.body.wildcardTickets,0);
 assert.equal(docs.get(aRef).cards[cardId],1);
 const count=writes.length;
 const replay=await send(request);
 assert.equal(replay.statusCode,200);assert.equal(replay.body.replayed,true);
 assert.equal(writes.length,count);
 const other=await send({...request,cardId:DOG_S2_CARDS[0].id});
 assert.equal(other.statusCode,409);
 assert.equal(other.body.error,'INVALID_REQUEST_ID');
 const insufficient=await send({cardId:DOG_S2_CARDS[0].id,requestId:'joker_claim_00000000002'});
 assert.equal(insufficient.statusCode,409);
 assert.equal(insufficient.body.error,'DOG_WILDCARD_REQUIRED');
});
