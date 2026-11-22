import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 DOG_HIDDEN_GOLD_AMOUNTS,createDogChristmasMatch,ensureDogChristmasGoldFields,
 claimDogChristmasGold,refreshDogChristmasDeal,applyDogInnUpgradeToMatch,publicDogChristmasMatch
} from '../dog/christmas-village.js';
import {grantDogScratchGold,normalizedScratchWallet,DOG_SCRATCH_START_COINS} from '../dog/christmas-scratch.js';

const draw=()=>0;
const onField=field=>({
 before:{pieces:[{id:1,owner:0,place:'track',pos:(field+63)%64}]},
 after:{pieces:[{id:1,owner:0,place:'track',pos:field}]},
 action:{type:'move',pieceId:1}
});
test('exactly four secret, unique gold positions with fixed 1/500/1000/2000 values',()=>{
 const match=createDogChristmasMatch(null,true,draw);
 const fields=match.goldFields.map(entry=>entry.field);
 assert.deepEqual(match.goldFields.map(x=>x.amount),DOG_HIDDEN_GOLD_AMOUNTS);
 assert.equal(fields.length,4);
 assert.equal(new Set(fields).size,4);
 assert.ok(fields.every(field=>Number.isInteger(field)&&field>=0&&field<64&&field%16!==0));
 assert.ok(fields.every(field=>!match.giftFields.includes(field)&&!match.scratchFields.includes(field)));
 const publicView=publicDogChristmasMatch(match);
 assert.equal(publicView.goldFieldCount,4);
 assert.deepEqual(publicView.foundGoldFields,[]);
 assert.equal('goldFields' in publicView,false,'unclaimed amounts and positions never leak');
 assert.equal('claimedGoldFields' in publicView,false);
 assert.equal('giftFields' in publicView,false);
 assert.equal('scratchFields' in publicView,false);
});
test('verified landing pays one fixed amount once, remains marked after next cards',()=>{
 const match=createDogChristmasMatch(null,true,draw);
 const entry=match.goldFields.find(x=>x.amount===1000),{before,after,action}=onField(entry.field);
 assert.equal(claimDogChristmasGold(match,before,after,{type:'swap',pieceId:1},0),0);
 assert.equal(claimDogChristmasGold(match,before,after,action,0),1000);
 assert.equal(claimDogChristmasGold(match,before,after,action,0),0);
 assert.equal(publicDogChristmasMatch(match).eventSerial,1);
 assert.deepEqual(publicDogChristmasMatch(match).foundGoldFields,[entry]);
 assert.deepEqual(match.activity.at(-1),{id:1,type:'gold',field:entry.field,seat:0,amount:1000});
 const original=structuredClone(match.goldFields);
 assert.equal(refreshDogChristmasDeal(match,2,draw),true);
 assert.deepEqual(match.goldFields,original,'four prizes never relocate to later card rounds');
 assert.deepEqual(publicDogChristmasMatch(match).foundGoldFields,[entry]);
 assert.equal(claimDogChristmasGold(match,before,after,action,0),0,'still paid only once in entire match');
 assert.ok(match.goldFields.every(x=>!match.giftFields.includes(x.field)&&!match.scratchFields.includes(x.field)));
});
test('all four prizes can be collected once, by legal 7-step landings as well',()=>{
 const match=createDogChristmasMatch(null,true,draw);
 for(const [i,entry] of match.goldFields.entries()){
  const {before,after,action}=onField(entry.field);
  assert.equal(claimDogChristmasGold(match,before,after,
   {...action,type:i%2?'seven-step':'move'},i%4),entry.amount);
 }
 assert.equal(match.claimedGoldFields.length,4);
 assert.equal(new Set(match.claimedGoldFields).size,4);
 assert.equal(match.activity.filter(x=>x.type==='gold').length,4);
 assert.deepEqual(new Set(publicDogChristmasMatch(match).foundGoldFields.map(x=>x.amount)),
  new Set(DOG_HIDDEN_GOLD_AMOUNTS));
 assert.equal(DOG_HIDDEN_GOLD_AMOUNTS.reduce((a,b)=>a+b,0),3501);
});
test('older ongoing rooms get the four fields exactly once without an extra game state fetch',()=>{
 const match=createDogChristmasMatch(null,true,draw,4);
 delete match.goldFields;delete match.claimedGoldFields;delete match.foundGoldFields;
 assert.deepEqual(publicDogChristmasMatch(match).foundGoldFields,[]);
 assert.equal(ensureDogChristmasGoldFields(match,draw),true);
 const original=structuredClone(match.goldFields);
 assert.equal(ensureDogChristmasGoldFields(match,draw),false);
 assert.deepEqual(match.goldFields,original);
 assert.equal(applyDogInnUpgradeToMatch(match,2,draw),2);
 assert.ok(match.goldFields.every(entry=>!match.scratchFields.includes(entry.field)));
 assert.equal(refreshDogChristmasDeal(match,5,draw),true);
 assert.deepEqual(match.goldFields,original);
});
test('credits go into the existing scratch coin balance with a safe upper bound',()=>{
 assert.equal(normalizedScratchWallet(null).coins,DOG_SCRATCH_START_COINS);
 for(const amount of DOG_HIDDEN_GOLD_AMOUNTS){
  assert.equal(grantDogScratchGold(null,amount).coins,DOG_SCRATCH_START_COINS+amount);
  assert.equal(grantDogScratchGold({coins:999999999},amount).coins,1000000000);
 }
 assert.throws(()=>grantDogScratchGold(null,0),/DOG_GOLD_INVALID_AMOUNT/);
 assert.throws(()=>grantDogScratchGold(null,99999),/DOG_GOLD_INVALID_AMOUNT/);
});
test('room action verifies discoveries on Render and combines wallet writes',()=>{
 const server=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
 assert.match(server,/const gold=claimDogChristmasGold\(event,before,after,move,playerSeat\)/);
 assert.match(server,/if\(gold>0\)goldEarned\.push\(\{uid:recipient\.uid,amount:gold\}\)/);
 assert.match(server,/const affectedUids=\[\.\.\.new Set\(\[\.\.\.vouchersEarned,\.\.\.goldEarned\]/);
 assert.match(server,/wallet=grantDogScratchGold\(wallet,amount\)/);
 assert.match(server,/for\(const item of voucherUpdates\)tx\.set\(item\.ref,item\.wallet\)/);
});
