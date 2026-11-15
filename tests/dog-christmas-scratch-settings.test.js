import test from 'node:test';
import assert from 'node:assert/strict';
import {DOG_SCRATCH_DEFAULT_SETTINGS,normalizeScratchSettings,validateScratchSettings,pickWeightedScratchSymbol} from '../dog/christmas-scratch-settings.js';
import {buyScratchTicket} from '../dog/christmas-scratch.js';
const clone=v=>JSON.parse(JSON.stringify(v));
const draw=(roll)=>{let first=true;return max=>{if(first){first=false;return roll}return 0}};
test('four scratch variants have independent defaults and validated percentages',()=>{
 const s=normalizeScratchSettings(null);
 assert.deepEqual(Object.keys(s.variants),['gifts','snow_collect','elf','premium_27']);
 assert.equal(s.freeEnabled,false);
 assert.equal(s.variants.premium_27.maxPrizes,3);
 assert.equal(validateScratchSettings(s).variants.gifts.weights.unlock,111);
 const bad=clone(s);bad.variants.elf.weights.unlock=1001;
 assert.throws(()=>validateScratchSettings(bad),/SCRATCH_SETTINGS_INVALID/);
 const notHundred=clone(s);notHundred.variants.gifts.weights.coins=10;
 assert.throws(()=>validateScratchSettings(notHundred),/SCRATCH_SETTINGS_INVALID/);
 const low=clone(s);low.variants.premium_27.maxPrizes=0;
 assert.throws(()=>validateScratchSettings(low),/SCRATCH_SETTINGS_INVALID/);
 const high=clone(s);high.variants.elf.maxPrizes=11;
 assert.throws(()=>validateScratchSettings(high),/SCRATCH_SETTINGS_INVALID/);
 const premiumOne=clone(s);premiumOne.variants.premium_27.maxPrizes=1;
 assert.equal(validateScratchSettings(premiumOne).variants.premium_27.maxPrizes,1);
 const full=clone(s);for(const id of Object.keys(full.variants))full.variants[id].maxPrizes=10;
 assert.ok(Object.values(validateScratchSettings(full).variants).every(v=>v.maxPrizes===10));
 assert.equal(normalizeScratchSettings({freeEnabled:true,variants:{gifts:bad.variants.elf}}).freeEnabled,true);
 assert.deepEqual(normalizeScratchSettings({}).variants.premium_27.weights,DOG_SCRATCH_DEFAULT_SETTINGS.variants.premium_27.weights);
});
test('free mode applies to premium without coins or daily limits, and can be revoked',()=>{
 const config=clone(DOG_SCRATCH_DEFAULT_SETTINGS);config.freeEnabled=true;
 const base={coins:0,daily:'2026-11-15'};
 const receipt=buyScratchTicket(base,null,{tier:'premium',free:true,commandId:'scratch-free-premium-101'},
   {settings:config,draw:draw(0),now:()=>Date.parse('2026-11-15T12:00:00Z')});
 assert.equal(receipt.result.price,0);
 assert.equal(receipt.wallet.daily,'2026-11-15');
 assert.equal(receipt.status.settings.freeEnabled,true);
 assert.throws(()=>buyScratchTicket(base,null,{tier:'premium',free:true,commandId:'scratch-free-premium-102'},
   {draw:draw(0)}),/SCRATCH_FREE_ONLY_SIMPLE/);
});
test('per-variant win caps retain verified payout combinations',()=>{
 const config=clone(DOG_SCRATCH_DEFAULT_SETTINGS);
 for(const id of Object.keys(config.variants)){
  config.variants[id].maxPrizes=id==='premium_27'?2:1;
  config.variants[id].extraCoinChance=100;
  config.variants[id].weights={none:0,coins:1000,unlock:0};
 }
 for(const tier of ['simple','medium','premium']){
  const result=buyScratchTicket({coins:10000},null,
   {tier,commandId:'scratch-cap-'+tier},
   {settings:config,draw:draw(0)});
  assert.ok(result.result.winnings.length<=config.variants[result.result.board.variantId].maxPrizes);
  assert.equal(result.result.board.wins.length,result.result.winnings.length);
 }
});

test('all four cards can pay up to ten real, individually listed win-linked prizes',()=>{
 const config=clone(DOG_SCRATCH_DEFAULT_SETTINGS);
 for(const item of Object.values(config.variants)){
  item.weights={none:0,coins:1000,unlock:0};
  item.maxPrizes=10;
  item.extraCoinChance=100;
 }
 const seeded=(seed,secondDraw=0)=>{
  let state=seed>>>0,calls=0;
  return max=>{
   calls++;
   if(calls===2&&max===2)return secondDraw; // simple: gifts or snow_collect
   state=(Math.imul(state,1664525)+1013904223)>>>0;
   return Math.floor(state/4294967296*max);
  };
 };
 for(const [tier,variant,variantIndex] of [
  ['simple','gifts',0],['simple','snow_collect',1],
  ['medium','elf',0],['premium','premium_27',0]
 ]){
  const result=buyScratchTicket({coins:20000},null,
   {tier,commandId:'scratch-ten-'+variant},
   {settings:config,draw:seeded(67439,variantIndex)});
  assert.equal(result.result.board.variantId,variant);
  assert.equal(result.result.winnings.length,10,variant+' should pay ten rewards');
  const wins=result.result.board.wins,bonuses=result.result.winnings.filter(p=>p.bonus);
  assert.ok(wins.length>=1&&wins.length<=3,variant+' has real visible matches');
  assert.equal(bonuses.length,10-wins.length,variant+' bonus count');
  assert.ok(bonuses.every(p=>p.type==='coins'&&p.amount>0&&
   Number.isInteger(p.sourceWin)&&p.sourceWin>=0&&p.sourceWin<wins.length),variant+' linked bonuses');
  assert.equal(result.result.totalCoins,result.result.winnings.filter(p=>p.type==='coins').reduce((n,p)=>n+p.amount,0));
  assert.equal(result.result.balance,20000-(tier==='premium'?1000:tier==='medium'?500:200)+result.result.totalCoins);
 }
});
test('premium 1-win cap still generates a verifiable coin-only ticket',()=>{
 const config=clone(DOG_SCRATCH_DEFAULT_SETTINGS);
 config.variants.premium_27.maxPrizes=1;
 config.variants.premium_27.weights={none:0,coins:0,unlock:1000};
 config.variants.premium_27.extraCoinChance=100;
 const result=buyScratchTicket({coins:10000},null,
  {tier:'premium',commandId:'scratch-premium-one'},
  {settings:config,draw:max=>0});
 assert.equal(result.result.winnings.length,1);
 assert.equal(result.result.winnings[0].type,'coins');
 assert.equal(result.result.board.wins.length,1);
 assert.equal(result.result.board.wins[0].rule,'gold-20');
});
test('zero bonus chance does not invent a 4th through 10th visible hit',()=>{
 const config=clone(DOG_SCRATCH_DEFAULT_SETTINGS);
 config.variants.elf.weights={none:0,coins:1000,unlock:0};
 config.variants.elf.maxPrizes=10;
 config.variants.elf.extraCoinChance=0;
 const result=buyScratchTicket({coins:10000},null,
  {tier:'medium',commandId:'scratch-ten-no-bonus'},
  {settings:config,draw:max=>0});
 assert.equal(result.result.winnings.length,result.result.board.wins.length);
 assert.ok(result.result.winnings.length<=3);
});


test('legacy host settings gain original per-tier payout values on read',()=>{
 const legacy=clone(DOG_SCRATCH_DEFAULT_SETTINGS);
 for(const variant of Object.values(legacy.variants))delete variant.coinAmounts;
 legacy.freeEnabled=true;legacy.variants.elf.maxPrizes=8;
 const migrated=normalizeScratchSettings(legacy);
 assert.deepEqual(migrated.variants.gifts.coinAmounts,[10,40,100]);
 assert.deepEqual(migrated.variants.snow_collect.coinAmounts,[10,40,100]);
 assert.deepEqual(migrated.variants.elf.coinAmounts,[100,300,800]);
 assert.deepEqual(migrated.variants.premium_27.coinAmounts,[200,800,2000]);
 assert.equal(migrated.freeEnabled,true);
 assert.equal(migrated.variants.elf.maxPrizes,8);
 assert.deepEqual(validateScratchSettings(legacy),migrated);
});
test('host can set different three rising money amounts for every ticket variant',()=>{
 const config=clone(DOG_SCRATCH_DEFAULT_SETTINGS);
 const sets={
  gifts:[2,25,140],
  snow_collect:[3,60,900],
  elf:[100,1000,4000],
  premium_27:[500,5000,50000000]
 };
 for(const [id,amounts] of Object.entries(sets)){
  config.variants[id].coinAmounts=amounts;
 }
 const saved=validateScratchSettings(config);
 for(const [id,amounts] of Object.entries(sets)){
  assert.deepEqual(saved.variants[id].coinAmounts,amounts);
 }
 const invalid=[
  [0,20,30],[1,1,30],[1,30,29],[10,100,50000001],
  [1,2.5,3],[1,2],[1,'10',20],[-3,10,25]
 ];
 for(const amounts of invalid){
  const altered=clone(config);altered.variants.gifts.coinAmounts=amounts;
  assert.throws(()=>validateScratchSettings(altered),/SCRATCH_SETTINGS_INVALID/,String(amounts));
 }
});
test('each coin, banknote and briefcase pays configured amounts including bonus payouts',()=>{
 const config=clone(DOG_SCRATCH_DEFAULT_SETTINGS);
 const perVariant={
  gifts:[13,33,333],
  snow_collect:[17,77,777],
  elf:[109,1099,10999],
  premium_27:[119,1199,11999]
 };
 for(const [id,cfg] of Object.entries(config.variants)){
  cfg.coinAmounts=perVariant[id];
  cfg.weights={none:0,coins:1000,unlock:0};
  cfg.extraCoinChance=100;cfg.maxPrizes=10;
 }
 const seedDraw=(variantIndex=0)=>{
  let count=0,seed=67439;
  return max=>{
   if(++count===2&&max===2)return variantIndex;
   seed=(Math.imul(seed,1664525)+1013904223)>>>0;
   return Math.floor(seed/4294967296*max);
  };
 };
 const moneySymbols=['🪙','💵','💼'];
 for(const [tier,id,index] of [
  ['simple','gifts',0],['simple','snow_collect',1],
  ['medium','elf',0],['premium','premium_27',0]
 ]){
  const purchase=buyScratchTicket({coins:100000},null,
   {tier,commandId:'scratch-config-money-'+id},
   {settings:config,draw:seedDraw(index)});
  const ticket=purchase.result;
  assert.equal(ticket.board.variantId,id);
  assert.deepEqual(ticket.coinAmounts,perVariant[id]);
  assert.equal(ticket.winnings.length,10);
  for(const prize of ticket.winnings.filter(x=>x.type==='coins')){
   const expected=perVariant[id][moneySymbols.indexOf(prize.symbol)];
   assert.equal(prize.amount,expected*(prize.x2?2:1),id+' '+prize.symbol);
  }
  assert.equal(ticket.totalCoins,ticket.winnings.filter(x=>x.type==='coins').reduce((a,b)=>a+b.amount,0));
  const changed=clone(config);changed.variants[id].coinAmounts=[1,2,3];
  const replay=buyScratchTicket(purchase.wallet,null,
   {tier,commandId:'scratch-config-money-'+id},{settings:changed});
  assert.equal(replay.unchanged,true);
  assert.deepEqual(replay.result.coinAmounts,perVariant[id],'old ticket must keep original payout legend');
  assert.equal(replay.result.totalCoins,ticket.totalCoins,'old ticket payout must not change');
 }
});

test('money icons and four gift icons each form their own validated 100% distribution',()=>{
 const config=clone(DOG_SCRATCH_DEFAULT_SETTINGS);
 for(const variant of Object.values(config.variants)){
  variant.moneySymbolWeights=[10,90,900];
  variant.giftSymbolWeights=[20,80,200,700];
 }
 assert.deepEqual(validateScratchSettings(config).variants.elf.moneySymbolWeights,[10,90,900]);
 assert.deepEqual(validateScratchSettings(config).variants.elf.giftSymbolWeights,[20,80,200,700]);
 const invalidMoney=[[100,100,100],[0,0,0],[1.2,100,899],[0,1001,-1],[1,999]];
 for(const values of invalidMoney){
  const altered=clone(config);altered.variants.elf.moneySymbolWeights=values;
  assert.throws(()=>validateScratchSettings(altered),/SCRATCH_SETTINGS_INVALID/);
 }
 const invalidGifts=[[250,250,250,251],[1000,0,0],[1001,0,0,-1]];
 for(const values of invalidGifts){
  const altered=clone(config);altered.variants.gifts.giftSymbolWeights=values;
  assert.throws(()=>validateScratchSettings(altered),/SCRATCH_SETTINGS_INVALID/);
 }
 const old=clone(config);
 for(const variant of Object.values(old.variants)){
  delete variant.moneySymbolWeights;delete variant.giftSymbolWeights;
 }
 const migrated=normalizeScratchSettings(old);
 assert.deepEqual(migrated.variants.elf.moneySymbolWeights,[334,333,333]);
 assert.deepEqual(migrated.variants.elf.giftSymbolWeights,[250,250,250,250]);
 assert.deepEqual(migrated.variants.elf.coinAmounts,config.variants.elf.coinAmounts);
});
test('weighted money and gift selection honours zero and 100% exactly',()=>{
 assert.equal(pickWeightedScratchSymbol([0,0,1000],max=>0),2);
 assert.equal(pickWeightedScratchSymbol([100,600,300],max=>99),0);
 assert.equal(pickWeightedScratchSymbol([100,600,300],max=>100),1);
 assert.equal(pickWeightedScratchSymbol([100,600,300],max=>699),1);
 assert.equal(pickWeightedScratchSymbol([100,600,300],max=>700),2);
 assert.equal(pickWeightedScratchSymbol([0,0,1000],max=>0,[0,1]),-1);
 assert.equal(pickWeightedScratchSymbol([500,500,0],max=>0,[1,2]),1);
 assert.throws(()=>pickWeightedScratchSymbol([1000,0,0],max=>max),/SCRATCH_INVALID_RANDOM/);
});
test('all four cards apply individual symbol weights to real money, gifts and bonuses',()=>{
 const variants=[['simple','gifts',0],['simple','snow_collect',1],
  ['medium','elf',0],['premium','premium_27',0]];
 function seeded(index){
  let calls=0,seed=67439;
  return max=>{
   if(++calls===2&&max===2)return index;
   seed=(Math.imul(seed,1664525)+1013904223)>>>0;
   return Math.floor(seed/4294967296*max);
  };
 }
 for(const group of ['money','gifts']){
  for(const [tier,id,index] of variants){
   const config=clone(DOG_SCRATCH_DEFAULT_SETTINGS);
   const v=config.variants[id];
   v.weights=group==='money'?{none:0,coins:1000,unlock:0}:{none:0,coins:0,unlock:1000};
   v.moneySymbolWeights=[0,0,1000];v.giftSymbolWeights=[0,0,0,1000];
   v.maxPrizes=10;v.extraCoinChance=100;
   const purchase=buyScratchTicket({coins:100000},null,
    {tier,commandId:'scratch-symbol-odds-'+group+'-'+id},
    {settings:config,draw:seeded(index)});
   const prizes=purchase.result.winnings;
   assert.equal(purchase.result.board.variantId,id);
   assert.equal(prizes.length,10,id+' reward count');
   assert.ok(prizes.filter(x=>x.type==='coins').every(x=>x.symbol==='💼'),id+' briefcases only');
   if(group==='gifts'){
    assert.ok(prizes.some(x=>x.type==='unlock'),id+' must show at least one unlock');
    assert.ok(prizes.filter(x=>x.type==='unlock').every(x=>x.symbol==='🧧'),id+' red envelope only');
   }else assert.ok(prizes.every(x=>x.type==='coins'),id+' money only');
   assert.deepEqual(purchase.result.moneySymbolWeights,[0,0,1000]);
   assert.deepEqual(purchase.result.giftSymbolWeights,[0,0,0,1000]);
   const changed=clone(config);changed.variants[id].moneySymbolWeights=[1000,0,0];
   const replay=buyScratchTicket(purchase.wallet,null,
    {tier,commandId:'scratch-symbol-odds-'+group+'-'+id},
    {settings:changed});
   assert.equal(replay.unchanged,true);
   assert.deepEqual(replay.result.moneySymbolWeights,[0,0,1000],'already purchased odds unchanged');
  }
 }
});
