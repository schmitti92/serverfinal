/**
 * Lichtertal Rubbellose: one durable personal wallet, 3 fair ticket classes.
 * Drawing and payouts happen atomically on Render. Scratch-off visuals are
 * purely cosmetic (no Firebase action per pointer movement).
 * Tier pools are disjoint and exclude all 10 fixed Christmas-tree prizes.
 * Daily: one free simple ticket. New players start with 1000 event coins.
 */
import {randomInt} from 'node:crypto';
import {DOG_TREE_PRIZE_POOL} from './christmas-tree-rewards.js';
import {SCRATCH_VARIANT_IDS,generateScratchGrid,attachScratchPrizes,verifyScratchPrizes} from './christmas-scratch-grid.js';
export const DOG_SCRATCH_COLLECTION='dog_christmas_scratch_wallet_v1';
export const DOG_SCRATCH_START_COINS=1000;
export const DOG_SCRATCH_TIERS=Object.freeze({
 simple:Object.freeze({label:'Einfach',price:200,icon:'🟤',coinMax:100,weights:Object.freeze({none:200,coins:689,unlock:111}),extraCoinChance:30}),
 medium:Object.freeze({label:'Mittel',price:500,icon:'🔵',coinMax:800,weights:Object.freeze({none:200,coins:770,unlock:30}),extraCoinChance:40}),
 premium:Object.freeze({label:'Premium',price:1000,icon:'🟡',coinMax:2000,weights:Object.freeze({none:200,coins:760,unlock:40}),extraCoinChance:50})
});
export const DOG_SCRATCH_PREMIUM_IDS=Object.freeze([
 "christmas2026:activeicon:01",
 "christmas2026:activeicon:05",
 "christmas2026:emoji:03",
 "christmas2026:emoji:07",
 "christmas2026:emoji:08",
 "christmas2026:emoji:10",
 "christmas2026:nameframe:02",
 "christmas2026:nameframe:05",
 "christmas2026:avatar:03",
 "christmas2026:avatar:05",
 "christmas2026:avatar:07",
 "christmas2026:avatar:08",
 "christmas2026:avatar:09",
 "christmas2026:avatar:10",
 "christmas2026:avatar:11",
 "christmas2026:avatar:13",
 "christmas2026:avatar:15",
 "christmas2026:avatar:20",
 "christmas2026:scene:02",
 "christmas2026:scene:04",
 "christmas2026:board:lebkuchenwerkstatt"
]);
export const DOG_SCRATCH_MEDIUM_IDS=Object.freeze([
 "christmas2026:board:winterlandschaft",
 "christmas2026:avatar:02",
 "christmas2026:avatar:04",
 "christmas2026:avatar:06",
 "christmas2026:avatar:12",
 "christmas2026:avatar:14",
 "christmas2026:nameframe:04",
 "christmas2026:activeicon:03",
 "christmas2026:emoji:01",
 "christmas2026:emoji:02",
 "christmas2026:emoji:04",
 "christmas2026:emoji:06"
]);
export const DOG_SCRATCH_BASIC_EMOJIS=Object.freeze([
 {
  "unlockId": "christmas2026:standard-emoji:emoji_04",
  "id": "emoji_04",
  "name": "Herz",
  "icon": "❤️",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_05",
  "id": "emoji_05",
  "name": "Feiern",
  "icon": "🎉",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_06",
  "id": "emoji_06",
  "name": "Cool",
  "icon": "😎",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_07",
  "id": "emoji_07",
  "name": "Nachdenken",
  "icon": "🤔",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_08",
  "id": "emoji_08",
  "name": "Glück",
  "icon": "🍀",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_09",
  "id": "emoji_09",
  "name": "Krone",
  "icon": "👑",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_10",
  "id": "emoji_10",
  "name": "Winken",
  "icon": "👋",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_11",
  "id": "emoji_11",
  "name": "Wütend",
  "icon": "😡",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_12",
  "id": "emoji_12",
  "name": "Party",
  "icon": "🥳",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_13",
  "id": "emoji_13",
  "name": "Lachflash",
  "icon": "🤣",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_14",
  "id": "emoji_14",
  "name": "Gerührt",
  "icon": "🥹",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_15",
  "id": "emoji_15",
  "name": "Weinen",
  "icon": "😭",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_16",
  "id": "emoji_16",
  "name": "Oh nein",
  "icon": "🙈",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_17",
  "id": "emoji_17",
  "name": "Begeistert",
  "icon": "🤩",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_18",
  "id": "emoji_18",
  "name": "Schlafen",
  "icon": "😴",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_19",
  "id": "emoji_19",
  "name": "Unglaublich",
  "icon": "🤯",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_20",
  "id": "emoji_20",
  "name": "Liebe",
  "icon": "🫶",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_21",
  "id": "emoji_21",
  "name": "Stark",
  "icon": "💪",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_22",
  "id": "emoji_22",
  "name": "Feuer",
  "icon": "🔥",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_23",
  "id": "emoji_23",
  "name": "Magie",
  "icon": "✨",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_24",
  "id": "emoji_24",
  "name": "Stern",
  "icon": "🌟",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_25",
  "id": "emoji_25",
  "name": "Sieg",
  "icon": "🏆",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_26",
  "id": "emoji_26",
  "name": "Diamant",
  "icon": "💎",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_27",
  "id": "emoji_27",
  "name": "Pfote",
  "icon": "🐾",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_28",
  "id": "emoji_28",
  "name": "Wolf",
  "icon": "🐺",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_29",
  "id": "emoji_29",
  "name": "Löwe",
  "icon": "🦁",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_30",
  "id": "emoji_30",
  "name": "Drache",
  "icon": "🐉",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_31",
  "id": "emoji_31",
  "name": "Einhorn",
  "icon": "🦄",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_32",
  "id": "emoji_32",
  "name": "Flügel",
  "icon": "🪽",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_33",
  "id": "emoji_33",
  "name": "Schnee",
  "icon": "❄️",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_34",
  "id": "emoji_34",
  "name": "Schneemann",
  "icon": "☃️",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_35",
  "id": "emoji_35",
  "name": "Weihnachten",
  "icon": "🎄",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_36",
  "id": "emoji_36",
  "name": "Geschenk",
  "icon": "🎁",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_37",
  "id": "emoji_37",
  "name": "Pizza",
  "icon": "🍕",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_38",
  "id": "emoji_38",
  "name": "Popcorn",
  "icon": "🍿",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_39",
  "id": "emoji_39",
  "name": "Kaffee",
  "icon": "☕",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_40",
  "id": "emoji_40",
  "name": "Müde",
  "icon": "💤",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_41",
  "id": "emoji_41",
  "name": "Teamwork",
  "icon": "🤝",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_42",
  "id": "emoji_42",
  "name": "Daumen hoch",
  "icon": "👍",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_43",
  "id": "emoji_43",
  "name": "Ich sehe",
  "icon": "👀",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_44",
  "id": "emoji_44",
  "name": "Boom",
  "icon": "💥",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_45",
  "id": "emoji_45",
  "name": "Rakete",
  "icon": "🚀",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_46",
  "id": "emoji_46",
  "name": "Genie",
  "icon": "🧠",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_47",
  "id": "emoji_47",
  "name": "Regenbogen",
  "icon": "🌈",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_48",
  "id": "emoji_48",
  "name": "Geist",
  "icon": "👻",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_49",
  "id": "emoji_49",
  "name": "Frech",
  "icon": "😈",
  "category": "emoji"
 },
 {
  "unlockId": "christmas2026:standard-emoji:emoji_50",
  "id": "emoji_50",
  "name": "Volltreffer",
  "icon": "🎯",
  "category": "emoji"
 }
].map(Object.freeze));
export const DOG_SCRATCH_BLOCK_COLORS=Object.freeze([
 {
  "unlockId": "christmas2026:hud-tone:midnight",
  "id": "midnight",
  "name": "Mitternachtsblau",
  "icon": "🎨",
  "category": "tone"
 },
 {
  "unlockId": "christmas2026:hud-tone:forest",
  "id": "forest",
  "name": "Waldgrün",
  "icon": "🎨",
  "category": "tone"
 },
 {
  "unlockId": "christmas2026:hud-tone:burgundy",
  "id": "burgundy",
  "name": "Bordeaux",
  "icon": "🎨",
  "category": "tone"
 },
 {
  "unlockId": "christmas2026:hud-tone:violet",
  "id": "violet",
  "name": "Violett",
  "icon": "🎨",
  "category": "tone"
 },
 {
  "unlockId": "christmas2026:hud-tone:graphite",
  "id": "graphite",
  "name": "Graphit",
  "icon": "🎨",
  "category": "tone"
 },
 {
  "unlockId": "christmas2026:hud-tone:bronze",
  "id": "bronze",
  "name": "Bronze & Sand",
  "icon": "🎨",
  "category": "tone"
 },
 {
  "unlockId": "christmas2026:hud-tone:ruby",
  "id": "ruby",
  "name": "Rubinrot",
  "icon": "🎨",
  "category": "tone"
 },
 {
  "unlockId": "christmas2026:hud-tone:coral",
  "id": "coral",
  "name": "Koralle",
  "icon": "🎨",
  "category": "tone"
 },
 {
  "unlockId": "christmas2026:hud-tone:mandarin",
  "id": "mandarin",
  "name": "Mandarin",
  "icon": "🎨",
  "category": "tone"
 },
 {
  "unlockId": "christmas2026:hud-tone:sunGold",
  "id": "sunGold",
  "name": "Sonnengold",
  "icon": "🎨",
  "category": "tone"
 },
 {
  "unlockId": "christmas2026:hud-tone:olive",
  "id": "olive",
  "name": "Olivgrün",
  "icon": "🎨",
  "category": "tone"
 },
 {
  "unlockId": "christmas2026:hud-tone:emerald",
  "id": "emerald",
  "name": "Smaragd",
  "icon": "🎨",
  "category": "tone"
 },
 {
  "unlockId": "christmas2026:hud-tone:turquoise",
  "id": "turquoise",
  "name": "Türkis",
  "icon": "🎨",
  "category": "tone"
 },
 {
  "unlockId": "christmas2026:hud-tone:iceBlue",
  "id": "iceBlue",
  "name": "Eisblau",
  "icon": "🎨",
  "category": "tone"
 },
 {
  "unlockId": "christmas2026:hud-tone:magenta",
  "id": "magenta",
  "name": "Magenta",
  "icon": "🎨",
  "category": "tone"
 },
 {
  "unlockId": "christmas2026:hud-tone:roseGold",
  "id": "roseGold",
  "name": "Roségold",
  "icon": "🎨",
  "category": "tone"
 }
].map(Object.freeze));
export const DOG_SCRATCH_PREMIUM_POOL=Object.freeze(DOG_SCRATCH_PREMIUM_IDS.map(id=>DOG_TREE_PRIZE_POOL.find(p=>p.unlockId===id)));
export const DOG_SCRATCH_MEDIUM_POOL=Object.freeze(DOG_SCRATCH_MEDIUM_IDS.map(id=>DOG_TREE_PRIZE_POOL.find(p=>p.unlockId===id)));
if([...DOG_SCRATCH_PREMIUM_POOL,...DOG_SCRATCH_MEDIUM_POOL].some(p=>!p)||
 new Set([...DOG_SCRATCH_PREMIUM_IDS,...DOG_SCRATCH_MEDIUM_IDS]).size!==33)throw Error('SCRATCH_POOL_INVALID');
const capCoins=n=>Number.isSafeInteger(n)&&n>=0?Math.min(n,1000000000):0;
const safeClaims=raw=>{
 const data=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
 return Object.fromEntries(Object.entries(data).filter(([id,when])=>
  typeof id==='string'&&id.startsWith('christmas2026:')&&
  Number.isSafeInteger(when)&&when>0));
};
const safeReceipts=raw=>Array.isArray(raw)?raw.filter(x=>
 x&&typeof x.commandId==='string'&&/^[-\w:]{8,90}$/.test(x.commandId)&&
 x.result&&typeof x.result.type==='string').slice(-40):[];
export function normalizedScratchWallet(raw){
 const absent=!raw||typeof raw!=='object'||Array.isArray(raw);
 return {
  coins:absent?DOG_SCRATCH_START_COINS:capCoins(raw.coins),
  owned:safeClaims(raw?.owned),
  recent:safeReceipts(raw?.recent),
  daily:typeof raw?.daily==='string'?raw.daily:'',
  purchased:Number.isSafeInteger(raw?.purchased)&&raw.purchased>=0?raw.purchased:0,
  lastResult:raw?.lastResult&&typeof raw.lastResult==='object'?raw.lastResult:null,
  version:1
 };
}
export function dogScratchToday(now=Date.now()){
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
}
const treeOwned=tree=>new Set(Object.values(tree?.claims||{}).map(c=>c?.unlockId).filter(x=>typeof x==='string'));
const tierPool=tier=>tier==='premium'?DOG_SCRATCH_PREMIUM_POOL:
 tier==='medium'?DOG_SCRATCH_MEDIUM_POOL:
 [...DOG_SCRATCH_BASIC_EMOJIS,...DOG_SCRATCH_BLOCK_COLORS];
export function dogScratchStatus(raw,tree=null,now=Date.now()){
 const w=normalizedScratchWallet(raw);
 const owned=[...new Set([...Object.keys(w.owned),...treeOwned(tree)])];
 const pools=Object.fromEntries(Object.keys(DOG_SCRATCH_TIERS).map(id=>
  [id,{total:tierPool(id).length,remaining:tierPool(id).filter(p=>!owned.includes(p.unlockId)).length}]));
 return {coins:w.coins,starterCoins:DOG_SCRATCH_START_COINS,
  dailyFreeAvailable:w.daily!==dogScratchToday(now),today:dogScratchToday(now),
  tiers:DOG_SCRATCH_TIERS,pools,ownedUnlockIds:owned,
  purchased:w.purchased,lastResult:w.lastResult};
}
// Exact probabilities per 1,000 full tickets, provided at least two unowned
// cosmetic prizes remain for the exclusive rare unlock events.
// The 0.1% rare unlock x2 is INCLUDED in the 11% total x2 chance.
export const DOG_SCRATCH_BONUS_ODDS=Object.freeze({
 doubleMainPer1000:1,mainMultiplierPer1000:1,multiplierPer1000:110
});
export function buyScratchTicket(raw,tree,request,{draw=randomInt,now=Date.now}={}){
 const tier=request?.tier;
 if(!Object.hasOwn(DOG_SCRATCH_TIERS,tier))throw Error('SCRATCH_INVALID_TIER');
 const commandId=request?.commandId;
 if(typeof commandId!=='string'||!/^[-a-zA-Z0-9_:]{8,90}$/.test(commandId))throw Error('SCRATCH_INVALID_COMMAND');
 const w=normalizedScratchWallet(raw);
 const replay=w.recent.find(r=>r.commandId===commandId);
 if(replay)return {unchanged:true,wallet:w,result:replay.result,status:dogScratchStatus(w,tree,now())};
 const free=request?.free===true;
 if(free&&tier!=='simple')throw Error('SCRATCH_FREE_ONLY_SIMPLE');
 const today=dogScratchToday(now());
 if(free&&w.daily===today)throw Error('SCRATCH_DAILY_ALREADY_USED');
 const config=DOG_SCRATCH_TIERS[tier],price=free?0:config.price;
 if(w.coins<price)throw Error('SCRATCH_NOT_ENOUGH_COINS');
 const random=max=>{
  const value=draw(max);
  if(!Number.isInteger(value)||value<0||value>=max)throw Error('SCRATCH_INVALID_RANDOM');
  return value;
 };
 const categoryRoll=random(1000);
 const baseCategory=categoryRoll<200?'none':categoryRoll<200+config.weights.coins?'coins':'unlock';
 const owned=new Set([...Object.keys(w.owned),...treeOwned(tree)]);
 const remaining=tierPool(tier).filter(p=>!owned.has(p.unlockId));
 const winnings=[],newUnlocks=[];
 const awardMain=category=>{
  const choices=remaining.filter(p=>!owned.has(p.unlockId)&&(!category||p.category===category));
  if(!choices.length)return false;
  const prize=choices[random(choices.length)];
  owned.add(prize.unlockId);
  newUnlocks.push(prize.unlockId);
  winnings.push({type:'unlock',prize:{unlockId:prize.unlockId,category:prize.category,name:prize.name,icon:prize.icon}});
  return true;
 };
 const awardCoin=()=>winnings.push({type:'coins',amount:1+random(config.coinMax)});
 if(baseCategory==='coins')awardCoin();
 if(baseCategory==='unlock'&&!awardMain())awardCoin(); // sold-out pool: preserve the 80% win probability

 // Each of the two rare events is 1/1000 of all tickets, conditional
 // on the BASE UNLOCK bucket: P(unlock)=unlockWeight/1000, P(rare|unlock)=1/unlockWeight.
 // Their two distinct roll values ensure they never overlap.
 const rareEligible=baseCategory==='unlock'&&remaining.length>=2&&winnings[0]?.type==='unlock';
 const rareRoll=rareEligible?random(config.weights.unlock):-1;
 const doubleMain=rareRoll===0&&awardMain();
 const rareMainMultiplier=rareRoll===1&&awardMain();

 // Normal x2: 109/799 of all *other* winning tickets.
 // Since 1/1000 of tickets is reserved for rare cosmetic x2, total
 // is exactly 1/1000+(799/1000)*(109/799)=110/1000 = 11%.
 // When cosmetics are exhausted, use 110/800 to retain 11% overall.
 const rarePossible=remaining.length>=2;
 const ordinaryMultiplier=baseCategory!=='none'&&!rareMainMultiplier&&
  (rarePossible?random(799)<109:random(800)<110);
 const multiplier=(rareMainMultiplier||ordinaryMultiplier)?2:1;
 if(ordinaryMultiplier){
  // Every visible x2 must apply to a visible money prize. If this ticket
  // only contains cosmetics, add a monetary prize before doubling it.
  if(!winnings.some(x=>x.type==='coins')&&winnings.length<3)awardCoin();
  for(const item of winnings)if(item.type==='coins'){
   item.baseAmount=item.amount;item.amount*=2;item.x2=true;
  }
 }

 // A bonus money hit can occur on either a coin or cosmetic ticket.
 // On 20% of successful bonus rolls, add a third visible money hit where
 // capacity permits. Never create more than three symbol combinations.
 if(baseCategory!=='none'&&random(100)<config.extraCoinChance){
  if(winnings.length<3)awardCoin();
  if(winnings.length<3&&random(100)<20)awardCoin();
 }

 const variantId=SCRATCH_VARIANT_IDS[random(SCRATCH_VARIANT_IDS.length)];
 const board=attachScratchPrizes(
  generateScratchGrid(variantId,winnings.length,{draw:random}),winnings);
 if(!verifyScratchPrizes(board))throw Error('SCRATCH_BOARD_PRIZE_MISMATCH');

 // Only after generating and verifying the exact visible card, grant awards.
 const stamped=now();
 for(const unlockId of newUnlocks)w.owned[unlockId]=stamped;
 const totalCoins=winnings.filter(x=>x.type==='coins').reduce((sum,x)=>sum+x.amount,0);
 w.coins=Math.max(0,Math.min(1000000000,w.coins+totalCoins-price));
 w.purchased++;
 if(free)w.daily=today;
 const first=winnings[0];
 const result={
  type:first?.type||'none',tier,
  ...(first?.type==='coins'?{amount:first.amount}:{}),
  ...(first?.type==='unlock'?{prize:first.prize}:{}),
  winnings,totalCoins,board,
  doubleMain:Boolean(doubleMain),rareMainMultiplier:Boolean(rareMainMultiplier),
  multiplier,commandId,price,free,at:stamped,balance:w.coins
 };
 w.lastResult=result;
 w.recent=[...w.recent,{commandId,result}].slice(-40);
 return {unchanged:false,wallet:w,result,status:dogScratchStatus(w,tree,now())};
}
