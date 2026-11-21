import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DOG_TREE_FIXED_PRIZE_IDS} from '../dog/christmas-tree-rewards.js';
import {DOG_SCRATCH_DEFAULT_SETTINGS} from '../dog/christmas-scratch-settings.js';
import {verifyScratchPrizes} from '../dog/christmas-scratch-grid.js';
import {DOG_SCRATCH_TIERS,DOG_SCRATCH_PREMIUM_POOL,DOG_SCRATCH_MEDIUM_POOL,
 DOG_SCRATCH_BASIC_EMOJIS,DOG_SCRATCH_BLOCK_COLORS,DOG_SCRATCH_START_COINS,
 normalizedScratchWallet,dogScratchStatus,dogScratchToday,buyScratchTicket,claimDogLevelOneScratchVouchers} from '../dog/christmas-scratch.js';
const NOW=Date.parse('2026-11-15T12:00:00Z');
const args={now:()=>NOW};
const receipt=(tier,n,roll,extra={})=>{
 let first=true;
 return buyScratchTicket(null,null,
  {tier,commandId:'scratch-command-'+n,...extra},
  {...args,draw:max=>{if(first){first=false;return roll}return 0}});
};
test('three ticket costs and exact non-overlapping holiday collections',()=>{
 assert.deepEqual(Object.keys(DOG_SCRATCH_TIERS),['simple','medium','premium']);
 assert.deepEqual(Object.values(DOG_SCRATCH_TIERS).map(x=>x.price),[200,500,1000]);
 const defaults=DOG_SCRATCH_DEFAULT_SETTINGS.variants;
 assert.deepEqual([defaults.gifts.weights,defaults.elf.weights,defaults.premium_27.weights],
  [{none:200,coins:689,unlock:111},{none:200,coins:770,unlock:30},{none:200,coins:760,unlock:40}]);
 assert.ok(Object.values(defaults).every(v=>Object.values(v.weights).reduce((a,b)=>a+b,0)===1000));
 assert.equal(DOG_SCRATCH_PREMIUM_POOL.length,21);
 assert.equal(DOG_SCRATCH_MEDIUM_POOL.length,12);
 assert.equal(DOG_SCRATCH_BASIC_EMOJIS.length,47);
 assert.equal(DOG_SCRATCH_BLOCK_COLORS.length,16);
 const p=DOG_SCRATCH_PREMIUM_POOL,m=DOG_SCRATCH_MEDIUM_POOL;
 const ids=[...p,...m].map(x=>x.unlockId);
 assert.equal(new Set(ids).size,33);
 assert.ok(ids.every(x=>!DOG_TREE_FIXED_PRIZE_IDS.includes(x)));
 const count=(arr,key)=>arr.filter(x=>x.category===key).length;
 assert.deepEqual([count(p,'emblems'),count(p,'emojis'),count(p,'frames'),count(p,'avatars'),count(p,'backgrounds'),count(p,'boards')],[2,4,2,10,2,1]);
 assert.deepEqual([count(m,'boards'),count(m,'avatars'),count(m,'frames'),count(m,'emblems'),count(m,'emojis')],[1,5,1,1,4]);
});
test('each of the 1,000 weighted draw positions has the correct ticket category',()=>{
 for(const [tier,id] of [['simple','gifts'],['medium','elf'],['premium','premium_27']]){
  const weights=DOG_SCRATCH_DEFAULT_SETTINGS.variants[id].weights;
  const expected=tier==='premium'?{none:0,coins:weights.none+weights.coins,unlock:weights.unlock}:
   {none:weights.none,coins:weights.coins,unlock:weights.unlock};
  const count={none:0,coins:0,unlock:0};
  for(let roll=0;roll<1000;roll++){
   const x=receipt(tier,tier+'-'+roll,roll);
   count[x.result.type]++;
   assert.equal(x.result.price,DOG_SCRATCH_TIERS[tier].price);
   assert.equal(x.wallet.coins,DOG_SCRATCH_START_COINS-x.result.price+x.result.totalCoins);
   assert.ok(verifyScratchPrizes(x.result.board),'all granted symbols must match the visible board');
   assert.equal(x.result.totalCoins,x.result.winnings.filter(w=>w.type==='coins').reduce((sum,w)=>sum+w.amount,0));
   if(roll<weights.none){
    if(tier==='premium'){
     assert.equal(x.result.type,'coins');
     assert.equal(x.result.board.wins.filter(w=>w.rule==='row-3'&&w.prize.type==='coins').length,4);
    }else{
     assert.equal(x.result.type,'none');
     assert.equal(x.result.totalCoins,0);
     assert.equal(x.result.winnings.length,0);
    }
   }else if(roll<weights.none+weights.coins){
    assert.equal(x.result.type,'coins');
    assert.ok(x.result.amount>0);
   }else{
    assert.equal(x.result.type,'unlock');
    assert.ok(x.result.prize?.unlockId);
   }
  }
  assert.deepEqual(count,expected,tier+' exact per-mille category weights');
 }
});
test('paid ticket is atomic and duplicate command never double-charges, rerolls or repeats a reward',()=>{
 // Premium's unlock range is 960–999 of the 1,000 draws.
 const first=receipt('premium','premium-replay',960);
 assert.equal(first.result.type,'unlock');
 assert.ok(first.result.prize?.unlockId);
 assert.equal(first.wallet.coins,first.result.totalCoins);
 const repeated=buyScratchTicket(first.wallet,null,{tier:'premium',commandId:'scratch-command-premium-replay'},
  {...args,draw:()=>{throw Error('NO_SECOND_DRAW')}});
 assert.equal(repeated.unchanged,true);
 assert.deepEqual(repeated.result,first.result);
 assert.equal(repeated.wallet.coins,first.wallet.coins);
 assert.equal(Object.keys(repeated.wallet.owned).length,
  first.result.winnings.filter(w=>w.type==='unlock').length);
 assert.throws(()=>buyScratchTicket({...first.wallet,coins:0},null,
  {tier:'medium',commandId:'scratch-command-other'},args),/SCRATCH_NOT_ENOUGH_COINS/);
});
test('daily and unlimited complimentary scratch purchases are disabled while starter coins remain',()=>{
 for(const tier of ['simple','medium','premium']){
  assert.throws(()=>buyScratchTicket(null,null,
   {tier,free:true,commandId:'scratch-free-blocked-'+tier},
   {...args,draw:()=>{throw Error('FREE_MUST_NOT_DRAW')}}),
   /SCRATCH_FREE_DISABLED/);
 }
 assert.equal(dogScratchStatus(null,null,NOW).dailyFreeAvailable,false);
 assert.equal(dogScratchStatus(null,null,NOW+86400000).dailyFreeAvailable,false);
 assert.equal(dogScratchStatus(null,null,NOW).coins,DOG_SCRATCH_START_COINS);
 assert.notEqual(dogScratchToday(Date.parse('2026-11-15T22:30:00Z')),
  dogScratchToday(Date.parse('2026-11-15T23:30:00Z')));
});
test('scratch cosmetics never duplicate existing tree prizes or paid prizes',()=>{
 const tree={claims:{'1':{unlockId:'christmas2026:scene:01',claimedAt:NOW}}};
 const unlockDraw=()=>{let first=true;return max=>{
  if(first){first=false;return 900;}return 0;
 }};
 const first=buyScratchTicket(null,tree,{tier:'simple',commandId:'scratch-earn-1'},
  {...args,draw:unlockDraw()});
 assert.equal(first.result.type,'unlock');
 const second=buyScratchTicket(first.wallet,tree,{tier:'simple',commandId:'scratch-earn-2'},
  {...args,draw:unlockDraw()});
 assert.equal(second.result.type,'unlock');
 const prizes=[...first.result.winnings,...second.result.winnings]
  .filter(w=>w.type==='unlock').map(w=>w.prize);
 assert.ok(prizes.length>=2);
 assert.ok(prizes.every(p=>p.category==='emoji'));
 assert.equal(new Set(prizes.map(p=>p.unlockId)).size,prizes.length);
 assert.ok(prizes.every(p=>!DOG_TREE_FIXED_PRIZE_IDS.includes(p.unlockId)));
 assert.ok(dogScratchStatus(second.wallet,tree,NOW).ownedUnlockIds.includes('christmas2026:scene:01'));
});
test('an exhausted cosmetic pool falls back to verified, paid money symbols',()=>{
 const owned=Object.fromEntries([...DOG_SCRATCH_BASIC_EMOJIS,...DOG_SCRATCH_BLOCK_COLORS]
  .map(x=>[x.unlockId,NOW]));
 const raw={coins:1000,owned};
 const x=buyScratchTicket(raw,null,{tier:'simple',commandId:'scratch-fallback-1'},
  {...args,draw:(()=>{let first=true;return max=>{
   if(first){first=false;return 900;}return 0;
  };})()});
 assert.equal(x.result.type,'coins');
 assert.ok(x.result.winnings.length>0);
 assert.ok(x.result.winnings.every(w=>w.type==='coins'));
 assert.ok(x.result.winnings.every(w=>w.amount>=10&&w.amount<=200));
 assert.ok(verifyScratchPrizes(x.result.board));
 assert.equal(x.wallet.coins,1000-200+x.result.totalCoins);
 assert.equal(x.wallet.owned['christmas2026:standard-emoji:emoji_04'],NOW);
});
test('invalid or player-supplied prizes, balances and command IDs are rejected',()=>{
 assert.equal(normalizedScratchWallet(null).coins,1000);
 assert.equal(normalizedScratchWallet({coins:-100}).coins,0);
 for(const tier of ['other','__proto__',null]){
  assert.throws(()=>buyScratchTicket(null,null,{tier,commandId:'scratch-invalid-01'},args));
 }
 assert.throws(()=>buyScratchTicket(null,null,{tier:'simple',commandId:'x'},args),/SCRATCH_INVALID_COMMAND/);
 assert.equal(buyScratchTicket(null,null,{tier:'simple',commandId:'scratch-mystery-01',free:'yes'},
  {...args,draw:n=>0}).result.free,false,'invalid free flag must never grant a free ticket');
});
test('only one authoritative scratch API is installed (no legacy shadow routes)',()=>{
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 const hub=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
 assert.doesNotMatch(server,/installChristmasScratchApi\s*\(/,
  'the old handler would intercept /api/hub/scratch before the verified hub route');
 assert.match(server,/installSharedLobby\(app,/);
 for(const route of [
  "app.get('/api/hub/scratch',authentication",
  "app.post('/api/hub/scratch/settings',authentication",
  "app.post('/api/hub/scratch/buy',authentication"
 ])assert.ok(hub.includes(route),route);
 const purchase=hub.slice(hub.indexOf("app.post('/api/hub/scratch/buy'"));
 assert.match(purchase,/const treeRef=store\.collection\(DOG_TREE_REWARDS_COLLECTION\)/);
 assert.match(purchase,/treeSnap\.exists\?treeSnap\.data\(\):null/);
 assert.match(purchase,/if\(!christmasActive\(\)\)throw error\(409,'DOG_CHRISTMAS_EVENT_ENDED'\)/);
});
test('server scratch actions require auth and credit the personal wallet plus optional shared lights atomically',()=>{
 const main=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
 assert.match(main,/app\.get\('\/api\/hub\/scratch',authentication/);
 assert.match(main,/app\.post\('\/api\/hub\/scratch\/buy',authentication/);
 assert.match(main,/if\(!christmasActive\(\)\)/);
 assert.match(main,/store\.runTransaction\(async tx=>/);
 assert.match(main,/if\(!result\.unchanged\)\{\s*tx\.set\(accountRef,result\.wallet\)/);
 assert.match(main,/creditDogVillage\(villageSnap\.exists\?villageSnap\.data\(\):null/);
 const start=main.indexOf("app.get('/api/hub/scratch',authentication");
 const end=main.indexOf("app.post('/api/hub/scratch/settings',authentication",start);
 assert.doesNotMatch(main.slice(start,end),/tx\.set\(|runTransaction\(/);
});

test('level 1 starter reward is atomic, specific to all four variants, and idempotent',()=>{
 const first=claimDogLevelOneScratchVouchers(null,{now:NOW});
 assert.equal(first.unchanged,false);
 assert.equal(first.wallet.coins,1000);
 assert.deepEqual(first.wallet.variantVouchers,{gifts:1,snow_collect:1,elf:1,premium_27:1,tic_tac_toe:0,number_one_20:0,dog_jackpot_9:0});
 assert.deepEqual(first.wallet.vouchers,{simple:0,medium:0,premium:0});
 const replay=claimDogLevelOneScratchVouchers(first.wallet,{now:NOW+100});
 assert.equal(replay.unchanged,true);
 assert.deepEqual(replay.wallet.variantVouchers,first.wallet.variantVouchers);
 assert.equal(dogScratchStatus(replay.wallet).levelOneStarterClaimed,true);
});
test('four free starter variants redeem separately without using generic tier vouchers',()=>{
 let wallet=claimDogLevelOneScratchVouchers(null,{now:NOW}).wallet;
 for(const [i,[tier,variantId]] of [['simple','gifts'],['simple','snow_collect'],
   ['medium','elf'],['premium','premium_27']].entries()){
   const opened=buyScratchTicket(wallet,null,
     {tier,variantId,voucher:true,commandId:'starter-voucher-'+i},
     {...args,draw:max=>0});
   assert.equal(opened.result.price,0);
   assert.equal(opened.result.board.variantId,variantId);
   assert.equal(opened.wallet.variantVouchers[variantId],0);
   assert.deepEqual(opened.wallet.vouchers,{simple:0,medium:0,premium:0});
   wallet=opened.wallet;
 }
 assert.deepEqual(wallet.variantVouchers,{gifts:0,snow_collect:0,elf:0,premium_27:0,tic_tac_toe:0,number_one_20:0,dog_jackpot_9:0});
 assert.throws(()=>buyScratchTicket(wallet,null,
  {tier:'simple',variantId:'gifts',voucher:true,commandId:'starter-no-more'},
  {...args,draw:max=>0}),/SCRATCH_NO_VOUCHER/);
});
