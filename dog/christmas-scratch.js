/**
 * Lichtertal Rubbellose: one durable personal wallet, 3 fair ticket classes.
 * Drawing and payouts happen atomically on Render. Scratch-off visuals are
 * purely cosmetic (no Firebase action per pointer movement).
 * Tier pools are disjoint and exclude all 10 fixed Christmas-tree prizes.
 * Daily: one free simple ticket. New players start with 1000 event coins.
 */
import {randomInt} from 'node:crypto';
import {DOG_TREE_PRIZE_POOL} from './christmas-tree-rewards.js';
export const DOG_SCRATCH_COLLECTION='dog_christmas_scratch_wallet_v1';
export const DOG_SCRATCH_START_COINS=1000;
export const DOG_SCRATCH_TIERS=Object.freeze({
 "simple": {
  "label": "Einfach",
  "price": 200,
  "icon": "🟤",
  "coinMax": 100,
  "weights": {
   "none": 35,
   "coins": 50,
   "emoji": 9,
   "tone": 6
  }
 },
 "medium": {
  "label": "Mittel",
  "price": 500,
  "icon": "🔵",
  "coinMax": 800,
  "weights": {
   "none": 25,
   "coins": 45,
   "avatars": 14,
   "emojis": 9,
   "frames": 3,
   "emblems": 3,
   "boards": 1
  }
 },
 "premium": {
  "label": "Premium",
  "price": 1000,
  "icon": "🟡",
  "coinMax": 2000,
  "weights": {
   "none": 15,
   "coins": 45,
   "avatars": 14,
   "emojis": 8,
   "backgrounds": 6,
   "frames": 5,
   "emblems": 4,
   "boards": 3
  }
 }
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
// Exact per-ticket bonus odds: 1% two unique main prizes; 8% x2;
// of those, 0.1 percentage points are the ultra-rare main-prize x2.
// Normal x2 affects coin wins only. Bonuses do not multiply prices.
export const DOG_SCRATCH_BONUS_ODDS=Object.freeze({
 doubleMainPer10000:100, multiplierPer10000:800, mainMultiplierPer10000:10
});
export function buyScratchTicket(raw,tree,request,{draw=randomInt,now=Date.now}={}){
 const tier=request?.tier;
 if(!Object.hasOwn(DOG_SCRATCH_TIERS,tier))throw Error('SCRATCH_INVALID_TIER');
 const commandId=request?.commandId;
 if(typeof commandId!=='string'||!/^[-a-zA-Z0-9_:]{8,90}$/.test(commandId))throw Error('SCRATCH_INVALID_COMMAND');
 const w=normalizedScratchWallet(raw);
 const repeated=w.recent.find(r=>r.commandId===commandId);
 if(repeated)return {unchanged:true,wallet:w,result:repeated.result,status:dogScratchStatus(w,tree,now())};
 const free=request?.free===true;
 if(free&&tier!=='simple')throw Error('SCRATCH_FREE_ONLY_SIMPLE');
 const day=dogScratchToday(now());
 if(free&&w.daily===day)throw Error('SCRATCH_DAILY_ALREADY_USED');
 const price=free?0:DOG_SCRATCH_TIERS[tier].price;
 if(w.coins<price)throw Error('SCRATCH_NOT_ENOUGH_COINS');
 const random=max=>{
  const value=draw(max);
  if(!Number.isInteger(value)||value<0||value>=max)throw Error('SCRATCH_INVALID_RANDOM');
  return value;
 };
 const pool=tierPool(tier);
 const owned=new Set([...Object.keys(w.owned),...treeOwned(tree)]);
 const winnings=[];
 const addMain=category=>{
  const options=pool.filter(p=>!owned.has(p.unlockId)&&(!category||p.category===category));
  if(!options.length)return false;
  const prize=options[random(options.length)];
  owned.add(prize.unlockId);
  w.owned[prize.unlockId]=now();
  winnings.push({type:'unlock',prize:{unlockId:prize.unlockId,category:prize.category,name:prize.name,icon:prize.icon}});
  return true;
 };
 const addCoins=()=>{
  const amount=1+random(DOG_SCRATCH_TIERS[tier].coinMax);
  winnings.push({type:'coins',amount});
 };
 const weights=DOG_SCRATCH_TIERS[tier].weights;
 const roll=random(100);
 let slot='none',position=0;
 for(const [category,weight] of Object.entries(weights)){
  position+=weight;if(roll<position){slot=category;break}
 }
 if(slot==='coins')addCoins();
 else if(slot!=='none'&&!addMain(slot))addCoins();
 // Independent 1% chance of a two-main-prize ticket, if two unique
 // rewards remain. This replaces a lone cosmetic prize where necessary.
 const doubleMain=random(10000)<DOG_SCRATCH_BONUS_ODDS.doubleMainPer10000;
 if(doubleMain){
  const existing=winnings.filter(p=>p.type==='unlock').length;
  const needed=2-existing;
  if(pool.filter(p=>!owned.has(p.unlockId)).length>=needed){
   for(let i=0;i<needed;i++)addMain();
  }
 }
 // 8% total x2, including exactly 0.1% ultra-rare main-prize x2.
 const bonusRoll=random(10000);
 const ultraRare=bonusRoll<DOG_SCRATCH_BONUS_ODDS.mainMultiplierPer10000;
 const multiplier=bonusRoll<DOG_SCRATCH_BONUS_ODDS.multiplierPer10000;
 if(multiplier){
  if(ultraRare&&winnings.some(p=>p.type==='unlock')){
   const main=winnings.find(p=>p.type==='unlock');
   // One additional DIFFERENT cosmetic in the same category if available.
   if(!addMain(main.prize.category)&&!winnings.some(p=>p.type==='coins'))addCoins();
  }else if(winnings.some(p=>p.type==='coins')){
   for(const entry of winnings)if(entry.type==='coins')entry.amount*=2;
  }else if(winnings.some(p=>p.type==='unlock')){
   // Normal x2 is only a monetary multiplier. Add a coin bonus to a
   // cosmetic-only card rather than silently dropping the advertised x2.
   addCoins();
   winnings[winnings.length-1].amount*=2;
  }
 }
 // Additional independent money lines: more common than extra cosmetics.
 // They do not change the main-category odds or special bonus percentages.
 if(winnings.length&&random(100)<(tier==='premium'?35:tier==='medium'?25:15))addCoins();
 if(winnings.length&&random(100)<(tier==='premium'?12:tier==='medium'?8:4))addCoins();
 let totalCoins=winnings.filter(p=>p.type==='coins').reduce((sum,p)=>sum+p.amount,0);
 w.coins=Math.min(1000000000,w.coins+totalCoins)-price;
 w.purchased++;
 if(free)w.daily=day;
 const first=winnings[0];
 const result={
  type:!first?'none':first.type,
  tier,
  ...(first?.type==='unlock'?{prize:first.prize}:{}),
  ...(first?.type==='coins'?{amount:first.amount}:{}),
  winnings,
  totalCoins,
  doubleMain:doubleMain&&winnings.filter(p=>p.type==='unlock').length>=2,
  multiplier:multiplier&&winnings.length>0?2:1,
  rareMainMultiplier:ultraRare&&winnings.filter(p=>p.type==='unlock').length>=2,
  commandId,price,free,at:now(),balance:w.coins
 };
 w.lastResult=result;
 w.recent=[...w.recent,{commandId,result}].slice(-40);
 return {unchanged:false,wallet:w,result,status:dogScratchStatus(w,tree,now())};
}
