/**
 * DOG Christmas scratch print runs. Exactly 500 immutable, server-verified
 * tickets are generated before activation. Existing receipt formats stay valid.
 * Pack the draw queue into ONE Firestore document rather than 500 ticket writes.
 */
import {gzipSync,gunzipSync} from 'node:zlib';
import {randomInt,randomUUID} from 'node:crypto';
import {
 buyScratchTicket,normalizedScratchWallet,dogScratchStatus,addScratchProgress,
 DOG_SCRATCH_PREMIUM_POOL,DOG_SCRATCH_MEDIUM_POOL,
 DOG_SCRATCH_BASIC_EMOJIS,DOG_SCRATCH_BLOCK_COLORS
} from './christmas-scratch.js';
import {SCRATCH_VARIANT_IDS_BY_TIER} from './christmas-scratch-grid.js';

export const SCRATCH_EDITION_COLLECTION='dog_christmas_scratch_editions_v1';
export const SCRATCH_EDITION_POINTERS='dog_christmas_scratch_editions_active_v1';
export const SCRATCH_PRINT_SIZE=500;
export const SCRATCH_EDITION_VARIANTS=Object.freeze(Object.values(SCRATCH_VARIANT_IDS_BY_TIER).flat());
const cleanInt=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const ticketTier=id=>Object.keys(SCRATCH_VARIANT_IDS_BY_TIER).find(t=>SCRATCH_VARIANT_IDS_BY_TIER[t].includes(id));
const format=(n)=>Number(n||0).toLocaleString('de-DE');

export function validateEditionConfig(input){
 const variantId=input?.variantId;
 if(!SCRATCH_EDITION_VARIANTS.includes(variantId))throw Error('EDITION_INVALID_VARIANT');
 const maxTotalCoins=Number(input.maxTotalCoins);
 const maxPerTicketCoins=Number(input.maxPerTicketCoins);
 const maxPrizesPerTicket=Number(input.maxPrizesPerTicket);
 const maxUnlocks=Number(input.maxUnlocks);
 if(!cleanInt(maxTotalCoins,0,1000000000000)||
  !cleanInt(maxPerTicketCoins,0,1000000000)||
  !cleanInt(maxPrizesPerTicket,1,20)||
  !cleanInt(maxUnlocks,0,500))throw Error('EDITION_INVALID_LIMITS');
 const title=String(input.title||'').trim();
 if(!title||title.length>70)throw Error('EDITION_INVALID_TITLE');
 const quotas={};
 for(let count=0;count<=20;count++){
  const value=input?.quotas?.[String(count)];
  if(value===null||value===undefined||value==='')continue;
  if(!cleanInt(value,0,500))throw Error('EDITION_INVALID_QUOTA_'+count);
  if(count>maxPrizesPerTicket&&value>0)throw Error('EDITION_QUOTA_ABOVE_MAX_'+count);
  quotas[count]=value;
 }
 if(Object.values(quotas).reduce((a,b)=>a+b,0)>SCRATCH_PRINT_SIZE)
  throw Error('EDITION_QUOTAS_OVER_500');
 return {variantId,tier:ticketTier(variantId),title,printSize:SCRATCH_PRINT_SIZE,
  maxTotalCoins,maxPerTicketCoins,maxPrizesPerTicket,maxUnlocks,quotas};
}
const prizeCount=result=>Array.isArray(result.winnings)?result.winnings.length:0;
const unlockCount=result=>Array.isArray(result.winnings)?
 result.winnings.filter(x=>x.type==='unlock').length:0;
const removeReceiptFields=result=>{
 const copy=structuredClone(result);
 for(const key of ['commandId','balance','at','price','free','voucher'])delete copy[key];
 return copy;
};
export const packEditionTickets=tickets=>gzipSync(Buffer.from(JSON.stringify(tickets),'utf8'),{level:9}).toString('base64');
export function unpackEditionTickets(packed){
 const tickets=JSON.parse(gunzipSync(Buffer.from(packed,'base64')).toString('utf8'));
 if(!Array.isArray(tickets)||tickets.length!==SCRATCH_PRINT_SIZE)
  throw Error('EDITION_STORED_TICKETS_INVALID');
 return tickets;
}
export function planScratchEdition(input,settings,{draw=randomInt}={}){
 const config=validateEditionConfig(input);
 const requested=[];
 const reserved=new Set();
 for(const [count,value] of Object.entries(config.quotas)){
  for(let i=0;i<value;i++)requested.push(Number(count));
  reserved.add(Number(count));
 }
 while(requested.length<SCRATCH_PRINT_SIZE)requested.push('any');
 // Shuffle all quota slots first, so budget constraints are not systematically
 // assigned to whichever category the host put at the top.
 for(let i=requested.length-1;i>0;i--){
  const j=draw(i+1);[requested[i],requested[j]]=[requested[j],requested[i]];
 }
 const tickets=[];
 const byWins=Array(21).fill(0);
 let totalCoins=0,unlocks=0,biggest=0,winners=0;
 for(const [slot,required] of requested.entries()){
  let accepted=null;
  // Reject a candidate rather than altering a visible winning board or
  // silently paying an amount unrelated to its shown combination.
  for(let attempt=0;attempt<Math.max(90,required===10?1200:required==='any'?90:400);attempt++){
   const sample=buyScratchTicket({coins:1000000000},null,{
    tier:config.tier,variantId:config.variantId,
    commandId:'ed_sample_'+slot+'_'+attempt
   },{settings,draw,now:()=>1700000000000}).result;
   const wins=prizeCount(sample),coins=sample.totalCoins||0,cosmetics=unlockCount(sample);
   if(wins>config.maxPrizesPerTicket||coins>config.maxPerTicketCoins||
     totalCoins+coins>config.maxTotalCoins||unlocks+cosmetics>config.maxUnlocks)continue;
   if(required==='any'&&reserved.has(wins))continue;
   if(required!=='any'&&wins!==required)continue;
   accepted=removeReceiptFields(sample);break;
  }
  if(!accepted)throw Error('EDITION_DISTRIBUTION_IMPOSSIBLE_SLOT_'+(slot+1)+
   '_WINS_'+required+'_BUDGET_'+(config.maxTotalCoins-totalCoins));
  const count=prizeCount(accepted);
  byWins[count]++;
  totalCoins+=accepted.totalCoins||0;
  unlocks+=unlockCount(accepted);
  biggest=Math.max(biggest,accepted.totalCoins||0);
  if(count)winners++;
  tickets.push(accepted);
 }
 // Cryptographically shuffle the completed 500-card print run. A player never
 // gets to choose the serial number or learn the next ticket in the queue.
 for(let i=tickets.length-1;i>0;i--){
  const j=draw(i+1);[tickets[i],tickets[j]]=[tickets[j],tickets[i]];
 }
 const summary={tickets:SCRATCH_PRINT_SIZE,winners,duds:SCRATCH_PRINT_SIZE-winners,
  totalCoins,unlocks,biggestTicketCoins:biggest,byWins,
  expectedAverageCoins:Math.round(totalCoins/SCRATCH_PRINT_SIZE),
  remainingBudget:config.maxTotalCoins-totalCoins};
 const packed=packEditionTickets(tickets);
 // Firestore has a 1 MiB document limit: leave margin for metadata.
 if(Buffer.byteLength(packed,'utf8')>750000)throw Error('EDITION_DOCUMENT_TOO_LARGE');
 return {config,summary,packed,packedBytes:packed.length};
}
export function newEditionDocument(plan,creator,now=Date.now()){
 return {version:1,id:plan.config.variantId+'_'+now+'_'+randomUUID().slice(0,8),
  variantId:plan.config.variantId,tier:plan.config.tier,title:plan.config.title,
  config:plan.config,summary:plan.summary,packed:plan.packed,
  issued:0,issuedCoins:0,issuedUnlocks:0,createdAt:now,createdBy:creator,
  status:'active',updatedAt:now};
}
export function editionPublic(doc){
 if(!doc)return null;
 return {id:doc.id,variantId:doc.variantId,title:doc.title,
  config:doc.config,summary:doc.summary,
  issued:doc.issued||0,remaining:SCRATCH_PRINT_SIZE-(doc.issued||0),
  issuedCoins:doc.issuedCoins||0,issuedUnlocks:doc.issuedUnlocks||0,
  createdAt:doc.createdAt,status:doc.status};
}
const availableUnlocks=(tier,owned)=>
 (tier==='premium'?DOG_SCRATCH_PREMIUM_POOL:tier==='medium'?DOG_SCRATCH_MEDIUM_POOL:
 [...DOG_SCRATCH_BASIC_EMOJIS,...DOG_SCRATCH_BLOCK_COLORS])
 .filter(p=>!owned.has(p.unlockId));
function personalizeTemplate(template,rawWallet,tree,tier){
 const result=structuredClone(template);
 const wallet=normalizedScratchWallet(rawWallet);
 const owned=new Set([...Object.keys(wallet.owned),
  ...Object.values(tree?.claims||{}).map(p=>p?.unlockId).filter(Boolean)]);
 const substitutions=new Map();
 for(const entry of result.winnings||[]){
  if(entry.type!=='unlock')continue;
  const old=entry.prize?.unlockId;
  if(!old)throw Error('EDITION_UNLOCK_INVALID');
  if(substitutions.has(old))continue;
  const candidates=availableUnlocks(tier,owned);
  const chosen=candidates.find(p=>p.unlockId===old)||candidates[0];
  if(!chosen)return null; // this printed ticket cannot be redeemed by this user
  owned.add(chosen.unlockId);
  substitutions.set(old,{unlockId:chosen.unlockId,name:chosen.name,
   category:chosen.category,icon:chosen.icon});
 }
 const remap=entry=>{
  if(entry?.type==='unlock'&&substitutions.has(entry.prize?.unlockId))
   entry.prize={...substitutions.get(entry.prize.unlockId)};
 };
 for(const win of result.winnings||[])remap(win);
 for(const win of result.board?.wins||[])remap(win.prize);
 if(result.type==='unlock'&&result.prize?.unlockId)
  result.prize={...substitutions.get(result.prize.unlockId)};
 return result;
}
export function issueEditionTicket(doc,rawWallet,tree,request,{settings,now=Date.now}={}){
 if(doc?.status!=='active'||!cleanInt(doc.issued,0,SCRATCH_PRINT_SIZE))
  throw Error('EDITION_INVALID_STATE');
 if(doc.issued===SCRATCH_PRINT_SIZE)throw Error('EDITION_SOLD_OUT');
 if(doc.variantId!==request.variantId||doc.tier!==request.tier)
  throw Error('EDITION_WRONG_VARIANT');
 const original=normalizedScratchWallet(rawWallet);
 const replay=original.recent.find(r=>r.commandId===request.commandId);
 if(replay)return {unchanged:true,doc,wallet:original,result:replay.result,
  status:dogScratchStatus(original,tree,now(),settings)};
 const tickets=unpackEditionTickets(doc.packed);
 let chosenIndex=-1,template=null;
 for(let i=doc.issued;i<SCRATCH_PRINT_SIZE;i++){
  const candidate=personalizeTemplate(tickets[i],rawWallet,tree,doc.tier);
  if(candidate){template=candidate;chosenIndex=i;break;}
 }
 if(!template)throw Error('EDITION_NO_AVAILABLE_UNLOCK');
 // This calls the existing wallet engine to enforce exact payment, the free
 // daily limit, voucher redemption, and receipt idempotency.
 const purchase=buyScratchTicket(rawWallet,tree,request,{settings,now});
 if(purchase.unchanged)return {unchanged:true,doc,wallet:purchase.wallet,
  result:purchase.result,status:purchase.status};
 const wallet=purchase.wallet,result=template;
 const price=purchase.result.price;
 Object.assign(result,{commandId:request.commandId,at:now(),price,
  free:purchase.result.free,voucher:purchase.result.voucher,
  balance:Math.min(1000000000,original.coins-price+(result.totalCoins||0))});
 wallet.coins=result.balance;
 wallet.owned={...original.owned};
 for(const win of result.winnings||[])if(win.type==='unlock')
  wallet.owned[win.prize.unlockId]=result.at;
 wallet.progress=structuredClone(original.progress);
 addScratchProgress(wallet.progress,result);
 const oldVoucher=purchase.result.giftVoucherEarned||0;
 const sparks=original.giftSparks+(result.giftSparksEarned||0);
 const newVoucher=Math.floor(sparks/5);
 wallet.giftSparks=sparks%5;
 wallet.variantVouchers.tic_tac_toe=Math.min(10000,Math.max(0,
  wallet.variantVouchers.tic_tac_toe-oldVoucher+newVoucher));
 result.giftVoucherEarned=newVoucher;
 wallet.lastResult=result;
 wallet.recent=[...original.recent,{commandId:request.commandId,result}].slice(-40);
 if(chosenIndex!==doc.issued)[tickets[doc.issued],tickets[chosenIndex]]=
  [tickets[chosenIndex],tickets[doc.issued]];
 const updated={...doc,issued:doc.issued+1,
  issuedCoins:(doc.issuedCoins||0)+(result.totalCoins||0),
  issuedUnlocks:(doc.issuedUnlocks||0)+unlockCount(result),
  packed:chosenIndex===doc.issued?doc.packed:packEditionTickets(tickets),
  updatedAt:now()};
 const printable={...result,editionId:doc.id,editionSerial:updated.issued};
 wallet.lastResult=printable;
 wallet.recent[wallet.recent.length-1].result=printable;
 return {unchanged:false,doc:updated,wallet,result:printable,
  status:dogScratchStatus(wallet,tree,now(),settings)};
}
