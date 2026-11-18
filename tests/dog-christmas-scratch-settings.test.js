import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DOG_SCRATCH_DEFAULT_SETTINGS,normalizeScratchSettings,validateScratchSettings,pickWeightedScratchSymbol,updateGiftScratchSettings,updateSnowScratchSettings} from '../dog/christmas-scratch-settings.js';
import {buyScratchTicket,grantDogScratchVoucher,normalizedScratchWallet,dogScratchStatus} from '../dog/christmas-scratch.js';
import {evaluateScratchGrid} from '../dog/christmas-scratch-grid.js';
const clone=v=>JSON.parse(JSON.stringify(v));
const draw=(roll)=>{let first=true;return max=>{if(first){first=false;return roll}return 0}};
test('four scratch variants have independent defaults and validated percentages',()=>{
 const s=normalizeScratchSettings(null);
 assert.deepEqual(Object.keys(s.variants),['gifts','snow_collect','elf','premium_27']);
 assert.equal(s.freeEnabled,false);
 assert.equal(s.variants.premium_27.maxPrizes,6);
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
 assert.equal(validateScratchSettings(premiumOne).variants.premium_27.maxPrizes,6);
 const full=clone(s);for(const id of Object.keys(full.variants))full.variants[id].maxPrizes=10;
 assert.deepEqual(Object.keys(validateScratchSettings(full).variants).map(id=>validateScratchSettings(full).variants[id].maxPrizes),[3,3,10,10]);
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
  assert.ok(result.result.winnings.length<=result.status.settings.variants[result.result.board.variantId].maxPrizes);
  assert.ok(result.result.board.wins.length<=result.result.winnings.length);
 }
});

test('Both simple cards require real visible wins; medium and premium retain linked bonuses',()=>{
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
  if(['gifts','snow_collect'].includes(variant))assert.equal(result.result.winnings.length,result.result.board.wins.length,
   'Geschenkelinie prizes all require their own visible triple');
  else assert.equal(result.result.winnings.length,10,variant+' should pay ten rewards');
  const wins=result.result.board.wins,bonuses=result.result.winnings.filter(p=>p.bonus);
  assert.ok(wins.length>=1&&wins.length<=(variant==='premium_27'?7:3),variant+' has real visible matches');
  assert.equal(bonuses.length,['gifts','snow_collect'].includes(variant)?0:10-wins.length,variant+' bonus count');
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
 assert.equal(result.result.winnings.length,6);
 assert.equal(result.result.winnings[0].type,'coins');
 assert.equal(result.result.board.wins.length,6);
 assert.equal(result.result.board.wins.filter(w=>w.rule==='row-3'&&w.prize.type==='coins').length,4);
 assert.ok(result.result.board.wins.some(w=>w.rule==='gold-20'));
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
   if(prize.milestone==='gold-20'){
    assert.equal(id,'premium_27');
    assert.equal(prize.amount,1000,'20-symbol prize stays fixed even if money rows are customized');
    assert.ok(!prize.x2);
    continue;
   }
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

test('money icons and five gift icons each form their own validated 100% distribution',()=>{
 const config=clone(DOG_SCRATCH_DEFAULT_SETTINGS);
 for(const variant of Object.values(config.variants)){
  variant.moneySymbolWeights=[10,90,900];
  variant.giftSymbolWeights=[20,80,200,700];
 }
 assert.deepEqual(validateScratchSettings(config).variants.elf.moneySymbolWeights,[10,90,900]);
 assert.deepEqual(validateScratchSettings(config).variants.elf.giftSymbolWeights,[18,72,180,630,100]);
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
 assert.deepEqual(migrated.variants.elf.giftSymbolWeights,[200,200,200,200,200]);
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
   v.moneySymbolWeights=[0,0,1000];v.giftSymbolWeights=[0,0,0,1000,0];
   v.maxPrizes=10;v.extraCoinChance=100;
   const purchase=buyScratchTicket({coins:100000},null,
    {tier,commandId:'scratch-symbol-odds-'+group+'-'+id},
    {settings:config,draw:seeded(index)});
   const prizes=purchase.result.winnings;
   assert.equal(purchase.result.board.variantId,id);
   assert.equal(prizes.length,['gifts','snow_collect'].includes(id)?purchase.result.board.wins.length:10,id+' reward count');
   assert.ok(id==='premium_27'?['🪙','💵','💼'].every(icon=>prizes.some(x=>x.type==='coins'&&x.symbol===icon)):
   prizes.filter(x=>x.type==='coins').every(x=>x.symbol==='💼'),id+' money weights');
   if(group==='gifts'){
    assert.ok(prizes.some(x=>x.type==='unlock'),id+' must show at least one unlock');
    assert.ok(prizes.filter(x=>x.type==='unlock').every(x=>x.symbol==='🧧'),id+' red envelope only');
   }else assert.ok(prizes.every(x=>x.type==='coins'),id+' money only');
   assert.deepEqual(purchase.result.moneySymbolWeights,[0,0,1000]);
   assert.deepEqual(purchase.result.giftSymbolWeights,[0,0,0,1000,0]);
   const changed=clone(config);changed.variants[id].moneySymbolWeights=[1000,0,0];
   const replay=buyScratchTicket(purchase.wallet,null,
    {tier,commandId:'scratch-symbol-odds-'+group+'-'+id},
    {settings:changed});
   assert.equal(replay.unchanged,true);
   assert.deepEqual(replay.result.moneySymbolWeights,[0,0,1000],'already purchased odds unchanged');
  }
 }
});

test('global host scratch settings are available to any authenticated player without a room',()=>{
 const server=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
 const getStart=server.indexOf("app.get('/api/hub/scratch',authentication");
 const writeStart=server.indexOf("app.post('/api/hub/scratch/settings',authentication");
 const buyStart=server.indexOf("app.post('/api/hub/scratch/buy',authentication");
 assert.ok(getStart>=0&&writeStart>getStart&&buyStart>writeStart);
 const readRoute=server.slice(getStart,writeStart);
 const writeRoute=server.slice(writeStart,buyStart);
 assert.match(readRoute,/canManageScratch:true/,'signed-in users can open the controls');
 assert.doesNotMatch(readRoute,/documentFor\(store,roomCode\)/,'reading status must not fetch a lobby room');
 assert.doesNotMatch(writeRoute,/HOST_ONLY|room\.hostUid|validCode\(req\.body\?\.room\)/,
  'global settings must never depend on lobby host or room membership');
 assert.match(writeRoute,/validateScratchSettings\(req\.body\?\.settings\)/,
  'every update must be validated server-side');
 assert.match(writeRoute,/updatedBy:identity\.uid/,
  'record the authenticated editor for accountability');
 assert.match(writeRoute,/await ref\.set\(/,
  'accepted global settings must be persisted');
});

test('earned DOG field tickets enter the personal voucher wallet, not the daily-free limit',()=>{
 const seeded=grantDogScratchVoucher(null,'simple');
 const gift=grantDogScratchVoucher(seeded,'premium');
 assert.deepEqual(gift.vouchers,{simple:1,medium:0,premium:1});
 assert.equal(gift.coins,1000);
 assert.deepEqual(dogScratchStatus(gift).vouchers,gift.vouchers);
 const purchase=buyScratchTicket(gift,null,
  {tier:'premium',voucher:true,variantId:'premium_27',commandId:'dog-hidden-voucher-01'},
  {draw:()=>0});
 assert.equal(purchase.result.price,0);
 assert.equal(purchase.result.voucher,true);
 assert.equal(purchase.wallet.vouchers.premium,0);
 assert.equal(purchase.wallet.vouchers.simple,1);
 assert.equal(purchase.wallet.coins,1000+purchase.result.totalCoins);
 assert.equal(purchase.wallet.daily,'');
 const repeat=buyScratchTicket(purchase.wallet,null,
  {tier:'premium',voucher:true,variantId:'premium_27',commandId:'dog-hidden-voucher-01'},
  {draw:()=>{throw Error('VOUCHER_REPLAY_MUST_NOT_DRAW')}});
 assert.equal(repeat.unchanged,true);
 assert.deepEqual(repeat.wallet.vouchers,purchase.wallet.vouchers);
 assert.throws(()=>buyScratchTicket(purchase.wallet,null,
  {tier:'premium',voucher:true,variantId:'premium_27',commandId:'dog-hidden-voucher-02'}),/SCRATCH_NO_VOUCHER/);
 assert.throws(()=>grantDogScratchVoucher(null,'unexpected'),/SCRATCH_INVALID_TIER/);
 assert.deepEqual(normalizedScratchWallet({coins:5}).vouchers,{simple:0,medium:0,premium:0});
});

test('Geschenkelinie settings update only this variant and never changes other tickets',()=>{
 const before=normalizeScratchSettings(null);
 const input={price:250,nonePer1000:200,unlockPer1000:150,
  coinAmounts:[17,77,777],maxPrizes:3,extraCoinChance:45,
  doubleChancePer1000:230,lightChancePer1000:300,lightMin:2,lightMax:8};
 const next=updateGiftScratchSettings(before,input);
 assert.equal(next.variants.gifts.price,250);
 assert.deepEqual(next.variants.gifts.weights,{none:200,coins:650,unlock:150});
 assert.deepEqual(next.variants.gifts.coinAmounts,[17,77,777]);
 assert.equal(next.variants.gifts.maxPrizes,3);
 assert.equal(next.variants.gifts.doubleChancePer1000,230);
 assert.equal(next.variants.gifts.lightChancePer1000,300);
 assert.equal(next.variants.gifts.lightMax,8);
 assert.deepEqual(next.variants.snow_collect,before.variants.snow_collect);
 assert.deepEqual(next.variants.elf,before.variants.elf);
 assert.deepEqual(next.variants.premium_27,before.variants.premium_27);
 assert.equal(next.freeEnabled,before.freeEnabled);
 assert.deepEqual(next.variants.gifts.moneySymbolWeights,[334,333,333]);
 assert.deepEqual(next.variants.gifts.giftSymbolWeights,[200,200,200,200,200]);
 assert.throws(()=>updateGiftScratchSettings(before,{...input,nonePer1000:900,unlockPer1000:200}),
  /SCRATCH_GIFTS_SETTINGS_INVALID/);
 assert.throws(()=>updateGiftScratchSettings(before,{...input,coinAmounts:[100,50,200]}),
  /SCRATCH_GIFTS_SETTINGS_INVALID/);
 assert.throws(()=>updateGiftScratchSettings(before,{...input,lightMin:9,lightMax:5}),
  /SCRATCH_GIFTS_SETTINGS_INVALID/);
});
test('Geschenkelinie price, x2 and independent light credit are frozen per purchased ticket',()=>{
 const cfg=updateGiftScratchSettings(null,{price:250,nonePer1000:0,unlockPer1000:0,
  coinAmounts:[17,77,777],maxPrizes:3,extraCoinChance:0,
  doubleChancePer1000:1000,lightChancePer1000:1000,lightMin:3,lightMax:3});
 let seed=12345;
 const seeded=max=>{
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  return Math.floor(seed/4294967296*max);
 };
 const request={tier:'simple',variantId:'gifts',commandId:'gifts-custom-settings-01'};
 const paid=buyScratchTicket({coins:1000},null,request,{settings:cfg,draw:seeded});
 assert.equal(paid.result.price,250);
 assert.deepEqual(paid.result.coinAmounts,[17,77,777]);
 assert.ok(paid.result.winnings.some(w=>w.type==='coins'));
 assert.equal(paid.result.multiplier,2);
 assert.equal(paid.result.totalLights,6);
 assert.equal(paid.status.progress.lightsWon,6);
 assert.equal(paid.wallet.coins,1000-250+paid.result.totalCoins);
 const replay=buyScratchTicket(paid.wallet,null,request,{
  settings:cfg,draw:()=>{throw Error('SAME_RECEIPT_MUST_NOT_REDRAW')}});
 assert.equal(replay.unchanged,true);
 assert.deepEqual(replay.result,paid.result);
 assert.equal(replay.wallet.coins,paid.wallet.coins);
});

test('Geschenkelinie uses only exact identical money or jackpot triples; no unseen bonuses',()=>{
 // Even when 3 GIFT icons occur, they must be the SAME gift emoji.
 const cells=['🎁','💝','🎀','🧧','🛍️','🍪','❄️','🔔','⭐'];
 assert.equal(evaluateScratchGrid({variantId:'gifts',symbolVersion:3,cells}).length,0);
 const match=[...cells];match[0]='🎁';match[1]='🎁';match[2]='🎁';
 const jackpot=evaluateScratchGrid({variantId:'gifts',symbolVersion:3,cells:match});
 assert.equal(jackpot.length,1);
 assert.deepEqual(jackpot[0].indices,[0,1,2]);
 assert.equal(jackpot[0].symbol,'🎁');
 const settings=clone(DOG_SCRATCH_DEFAULT_SETTINGS);
 settings.variants.gifts.weights={none:0,coins:0,unlock:1000};
 settings.variants.gifts.maxPrizes=10; // old saved settings migrate to visible cap
 settings.variants.gifts.extraCoinChance=100;
 let state=67439;
 const draw=max=>{
  state=(Math.imul(state,1664525)+1013904223)>>>0;
  return Math.floor(state/4294967296*max);
 };
 const receipt=buyScratchTicket({coins:10000},null,
  {tier:'simple',variantId:'gifts',commandId:'gifts-real-identical-jackpot'},
  {settings,draw});
 const {board,winnings}=receipt.result;
 assert.equal(board.symbolVersion,3);
 assert.equal(winnings.length,board.wins.length,'one payout for each visible combination');
 assert.ok(winnings.length<=3);
 assert.ok(winnings.every(p=>!p.bonus),'no invisible money bonus');
 assert.ok(board.wins.every(w=>w.indices.length===3&&w.indices.every(i=>board.cells[i]===w.symbol)));
 assert.ok(board.wins.filter(w=>w.prize.type==='unlock').every(w=>
  ['🎁','💝','🎀','🧧','🛍️'].includes(w.symbol)&&w.prize.symbol===w.symbol));
 assert.equal(receipt.result.totalCoins,winnings.filter(p=>p.type==='coins')
  .reduce((sum,p)=>sum+p.amount,0));
 assert.equal(normalizeScratchSettings(settings).variants.gifts.maxPrizes,3);
 assert.throws(()=>updateGiftScratchSettings(null,{
  price:200,nonePer1000:0,unlockPer1000:0,coinAmounts:[10,40,100],
  maxPrizes:4,extraCoinChance:30,doubleChancePer1000:110,
  lightChancePer1000:100,lightMin:1,lightMax:10
 }),/SCRATCH_GIFTS_SETTINGS_INVALID/);
});


test('Geschenkelinie ×2 sticker belongs to the middle visible matching money symbol',()=>{
 const settings=clone(DOG_SCRATCH_DEFAULT_SETTINGS);
 const cfg=settings.variants.gifts;
 cfg.weights={none:0,coins:1000,unlock:0};
 cfg.doubleChancePer1000=1000;
 cfg.lightChancePer1000=1000;
 cfg.extraCoinChance=0;
 cfg.maxPrizes=1;
 let state=719321;
 const random=max=>{
  state=(Math.imul(state,1664525)+1013904223)>>>0;
  return Math.floor(state/4294967296*max);
 };
 const purchase=buyScratchTicket({coins:20000},null,
  {tier:'simple',variantId:'gifts',commandId:'gifts-double-sticker-visible'},
  {settings,draw:random});
 const receipt=purchase.result,board=receipt.board;
 const moneyWin=board.wins.find(win=>win.prize?.type==='coins'&&win.prize.x2);
 assert.ok(moneyWin,'a real money win must have been doubled');
 assert.equal(moneyWin.indices.length,3);
 assert.ok(moneyWin.indices.every(i=>board.cells[i]===moneyWin.symbol),
  '×2 never changes any of the original three matching symbols');
 assert.equal(receipt.doubleBadgeIndex,moneyWin.indices[1],
  '×2 sticker is placed on the middle symbol of the verified winning line');
 assert.ok(receipt.doubleWin.extraCoins>0);
 assert.equal(receipt.totalCoins,moneyWin.prize.amount,
  'the original payout is doubled exactly once, not given twice');
});

test('Schneeflocken-Bingo settings are isolated and match three identical symbols anywhere',()=>{
 const before=normalizeScratchSettings(null);
 const updated=updateSnowScratchSettings(before,{
  price:175,nonePer1000:250,unlockPer1000:75,coinAmounts:[15,60,220],
  maxPrizes:3,extraCoinChance:38,doubleChancePer1000:280,
  lightChancePer1000:150,lightMin:3,lightMax:9
 });
 assert.equal(updated.variants.snow_collect.price,175);
 assert.deepEqual(updated.variants.snow_collect.coinAmounts,[15,60,220]);
 assert.deepEqual(updated.variants.snow_collect.weights,{none:250,coins:675,unlock:75});
 assert.equal(updated.variants.snow_collect.maxPrizes,3);
 assert.equal(updated.variants.snow_collect.doubleChancePer1000,280);
 assert.equal(updated.variants.snow_collect.lightMax,9);
 assert.deepEqual(updated.variants.gifts,before.variants.gifts,'Geschenkelinie stays unchanged');
 assert.deepEqual(updated.variants.elf,before.variants.elf);
 const exact=['🪙','💵','🎁','⭐','🎄','🪙','🔔','🎁','💼','💝','🪙','🍪','❄️','🛍️','🧊','🧤'];
 const groups=evaluateScratchGrid({variantId:'snow_collect',symbolVersion:3,cells:exact});
 assert.ok(groups.some(group=>group.symbol==='🪙'&&group.indices.length===3));
 assert.ok(!groups.some(group=>group.symbol==='🎁'),'two gifts never win');
 assert.throws(()=>updateSnowScratchSettings(null,{price:200,nonePer1000:0,unlockPer1000:0,
  coinAmounts:[10,40,100],maxPrizes:4,extraCoinChance:30,doubleChancePer1000:110,
  lightChancePer1000:100,lightMin:1,lightMax:10}),/SCRATCH_SNOW_SETTINGS_INVALID/);
});
