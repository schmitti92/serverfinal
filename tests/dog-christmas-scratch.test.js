import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DOG_TREE_FIXED_PRIZE_IDS} from '../dog/christmas-tree-rewards.js';
import {DOG_SCRATCH_TIERS,DOG_SCRATCH_PREMIUM_POOL,DOG_SCRATCH_MEDIUM_POOL,
 DOG_SCRATCH_BASIC_EMOJIS,DOG_SCRATCH_BLOCK_COLORS,DOG_SCRATCH_START_COINS,
 normalizedScratchWallet,dogScratchStatus,dogScratchToday,buyScratchTicket} from '../dog/christmas-scratch.js';
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
 assert.deepEqual(Object.values(DOG_SCRATCH_TIERS).map(x=>100-x.weights.coins),[10,40,65]);
 assert.deepEqual(Object.values(DOG_SCRATCH_TIERS).map(x=>Object.values(x.weights).reduce((a,b)=>a+b,0)),[100,100,100]);
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
test('each of the 100 lottery outcomes respects tier-specific unlock odds',()=>{
 for(const [tier,expectedWins] of [['simple',10],['medium',40],['premium',65]]){
  let unlocks=0,coins=0;
  for(let roll=0;roll<100;roll++){
   const x=receipt(tier,tier+'-'+roll,roll);
   if(x.result.type==='unlock'){unlocks++;assert.ok(x.result.prize.unlockId)}
   else{coins++;assert.ok(x.result.amount>=1&&x.result.amount<=100)}
   assert.equal(x.result.price,DOG_SCRATCH_TIERS[tier].price);
   assert.equal(x.wallet.coins,DOG_SCRATCH_START_COINS-x.result.price+(x.result.amount||0));
  }
  assert.equal(unlocks,expectedWins,tier);
  assert.equal(coins,100-expectedWins,tier);
 }
});
test('paid ticket is atomic and duplicate command never double-charges, rerolls or repeats a reward',()=>{
 const first=receipt('premium','premium-replay',35);
 assert.equal(first.result.type,'unlock');
 assert.equal(first.wallet.coins,0);
 const repeated=buyScratchTicket(first.wallet,null,{tier:'premium',commandId:'scratch-command-premium-replay'},
  {...args,draw:()=>{throw Error('NO_SECOND_DRAW')}});
 assert.equal(repeated.unchanged,true);
 assert.deepEqual(repeated.result,first.result);
 assert.equal(repeated.wallet.coins,0);
 assert.equal(Object.keys(repeated.wallet.owned).length,1);
 assert.throws(()=>buyScratchTicket(first.wallet,null,{tier:'medium',commandId:'scratch-command-other'},{...args,draw:()=>0}),/SCRATCH_NOT_ENOUGH_COINS/);
});
test('one free simple ticket per calendar day with no hidden coin charge',()=>{
 const one=buyScratchTicket(null,null,{tier:'simple',free:true,commandId:'scratch-free-001'},
  {...args,draw:n=>0});
 assert.equal(one.result.price,0);
 assert.equal(one.wallet.coins,DOG_SCRATCH_START_COINS+1);
 assert.equal(dogScratchStatus(one.wallet,null,NOW).dailyFreeAvailable,false);
 assert.throws(()=>buyScratchTicket(one.wallet,null,
  {tier:'simple',free:true,commandId:'scratch-free-002'},{...args,draw:n=>0}),
  /SCRATCH_DAILY_ALREADY_USED/);
 assert.throws(()=>buyScratchTicket(null,null,
  {tier:'premium',free:true,commandId:'scratch-free-003'},{...args,draw:n=>0}),
  /SCRATCH_FREE_ONLY_SIMPLE/);
 const tomorrow=NOW+86400000;
 assert.equal(dogScratchStatus(one.wallet,null,tomorrow).dailyFreeAvailable,true);
 assert.notEqual(dogScratchToday(Date.parse('2026-11-15T22:30:00Z')),
  dogScratchToday(Date.parse('2026-11-15T23:30:00Z')));
});
test('scratch cosmetics never duplicate existing tree prizes or paid prizes',()=>{
 const tree={claims:{'1':{unlockId:'christmas2026:scene:01',claimedAt:NOW}}};
 const first=buyScratchTicket(null,tree,{tier:'simple',commandId:'scratch-earn-1'},
  {...args,draw:max=>max===100?90:0});
 assert.equal(first.result.type,'unlock');
 assert.equal(first.result.prize.category,'emoji');
 const second=buyScratchTicket(first.wallet,tree,{tier:'simple',commandId:'scratch-earn-2'},
  {...args,draw:max=>max===100?90:0});
 assert.equal(second.result.type,'unlock');
 assert.notEqual(second.result.prize.unlockId,first.result.prize.unlockId);
 assert.ok(dogScratchStatus(second.wallet,tree,NOW).ownedUnlockIds.includes('christmas2026:scene:01'));
});
test('after the item category is exhausted, the prize safely falls back to 1–100 coins',()=>{
 const owned=Object.fromEntries(DOG_SCRATCH_BASIC_EMOJIS.map(x=>[x.unlockId,NOW]));
 const raw={coins:1000,owned};
 const x=buyScratchTicket(raw,null,{tier:'simple',commandId:'scratch-fallback-1'},
  {...args,draw:(()=>{let first=true;return max=>{if(first){first=false;return 90}return 0};})()});
 assert.equal(x.result.type,'coins');
 assert.equal(x.result.amount,1);
 assert.equal(x.wallet.coins,801);
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
test('server scratch actions require auth and commit exactly one account document',()=>{
 const main=readFileSync(new URL('../shared-lobby.js',import.meta.url),'utf8');
 assert.match(main,/app\.get\('\/api\/hub\/scratch',authentication/);
 assert.match(main,/app\.post\('\/api\/hub\/scratch\/buy',authentication/);
 assert.match(main,/if\(!christmasActive\(\)\)/);
 assert.match(main,/store\.runTransaction\(async tx=>/);
 assert.match(main,/if\(!result\.unchanged\)tx\.set\(accountRef,result\.wallet\)/);
 const start=main.indexOf("app.get('/api/hub/scratch',authentication");
 const end=main.indexOf("app.post('/api/hub/scratch/buy',authentication",start);
 assert.doesNotMatch(main.slice(start,end),/tx\.set\(|runTransaction\(/);
});
