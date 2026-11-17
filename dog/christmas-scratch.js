/**
 * Lichtertal Rubbellose: one durable personal wallet, 3 fair ticket classes.
 * Drawing and payouts happen atomically on Render. Scratch-off visuals are
 * purely cosmetic (no Firebase action per pointer movement).
 * Tier pools are disjoint and exclude all 10 fixed Christmas-tree prizes.
 * Daily: one free simple ticket. New players start with 1000 event coins.
 */
import {randomInt} from 'node:crypto';
import {drawTicTacToe} from './christmas-tictactoe.js';
import {drawNumberOne20,drawDogJackpot9} from './christmas-special-scratch.js';
import {SCRATCH_PAYOUT_ORDER,SCRATCH_GIFT_SYMBOLS} from './christmas-scratch-symbols.js';
import {DOG_TREE_PRIZE_POOL} from './christmas-tree-rewards.js';
import {SCRATCH_VARIANT_IDS_BY_TIER,generateScratchGrid,attachScratchPrizes,verifyScratchPrizes} from './christmas-scratch-grid.js';
import {generatePremium27} from './christmas-premium27.js';
import {normalizeScratchSettings,pickWeightedScratchSymbol} from './christmas-scratch-settings.js';
export const DOG_SCRATCH_COLLECTION='dog_christmas_scratch_wallet_v1';
export const DOG_SCRATCH_START_COINS=1000;
// Share of newly issued premium tickets which reach the 20-symbol milestone
// at the default configured category odds (includes 24-symbol unlocks).
export const PREMIUM_20_MILESTONE_PER_1000=300;
export const PREMIUM_20_MILESTONE_COINS=1000;
export const DOG_SCRATCH_TIERS=Object.freeze({
 simple:Object.freeze({label:'Einfach',price:200,icon:'🟤',coinMax:100,weights:Object.freeze({none:200,coins:689,unlock:111}),extraCoinChance:30}),
 medium:Object.freeze({label:'Mittel',price:500,icon:'🔵',coinMax:800,weights:Object.freeze({none:200,coins:770,unlock:30}),extraCoinChance:40}),
 premium:Object.freeze({label:'Premium',price:1000,icon:'🟡',coinMax:2000,weights:Object.freeze({none:200,coins:760,unlock:40}),extraCoinChance:50})
});
export const DOG_SCRATCH_COIN_AMOUNTS=Object.freeze({
 simple:Object.freeze([10,40,100]),
 medium:Object.freeze([100,300,800]),
 premium:Object.freeze([200,800,2000])
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
const cleanScratchVouchers=raw=>Object.fromEntries(
 ['simple','medium','premium'].map(tier=>[tier,
  Number.isSafeInteger(raw?.[tier])&&raw[tier]>=0?Math.min(raw[tier],10000):0]));
const STARTER_SCRATCH_VARIANTS=Object.freeze(['gifts','snow_collect','elf','premium_27']);
const cleanVariantVouchers=raw=>Object.fromEntries(
 [...STARTER_SCRATCH_VARIANTS,'tic_tac_toe','number_one_20','dog_jackpot_9'].map(id=>[id,Number.isSafeInteger(raw?.[id])&&raw[id]>=0?Math.min(raw[id],10000):0]));
/**
 * One-time Level 1 starter prize for an authenticated player. This pure function
 * is called INSIDE the existing scratch-wallet Firestore transaction.
 * The marker and four vouchers are committed together, never separately.
 */
export function claimDogLevelOneScratchVouchers(raw,{now=Date.now()}={}){
 const wallet=normalizedScratchWallet(raw);
 if(wallet.levelOneStarterClaimedAt)return {unchanged:true,wallet};
 for(const id of STARTER_SCRATCH_VARIANTS){
  if(wallet.variantVouchers[id]>=10000)throw Error('SCRATCH_VOUCHER_LIMIT');
  wallet.variantVouchers[id]++;
 }
 wallet.levelOneStarterClaimedAt=now;
 return {unchanged:false,wallet};
}
/** Call only after a server-verified hidden-field hit, within the move's transaction. */
export function grantDogScratchVoucher(raw,tier){
 if(!Object.hasOwn(DOG_SCRATCH_TIERS,tier))throw Error('SCRATCH_INVALID_TIER');
 const wallet=normalizedScratchWallet(raw);
 if(wallet.vouchers[tier]>=10000)throw Error('SCRATCH_VOUCHER_LIMIT');
 wallet.vouchers[tier]++;
 return wallet;
}
const safeClaims=raw=>{
 const data=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
 return Object.fromEntries(Object.entries(data).filter(([id,when])=>
  typeof id==='string'&&id.startsWith('christmas2026:')&&
  Number.isSafeInteger(when)&&when>0));
};
const safeReceipts=raw=>Array.isArray(raw)?raw.filter(x=>
 x&&typeof x.commandId==='string'&&/^[-\w:]{8,90}$/.test(x.commandId)&&
 x.result&&typeof x.result.type==='string').slice(-40):[];
// A single per-player counter, stored in the existing wallet document.
// No additional Firebase write is required while scratching or viewing stats.
// Historic receipts are kept only for the latest 40 tickets; older category
// splits are honestly reported as unknown rather than fabricated.
const SCRATCH_PROGRESS_VARIANTS=Object.freeze(Object.values(SCRATCH_VARIANT_IDS_BY_TIER).flat());
const progressCount=value=>Number.isSafeInteger(value)&&value>=0?value:0;
const emptyScratchProgressRow=()=>({opened:0,winTickets:0,duds:0,free:0,coinsWon:0,lightsWon:0,unlocks:0});
const emptyScratchProgress=()=>({
 tracked:0,winTickets:0,duds:0,free:0,coinsWon:0,lightsWon:0,unlocks:0,
 byVariant:Object.fromEntries(SCRATCH_PROGRESS_VARIANTS.map(id=>[id,emptyScratchProgressRow()])),
 other:emptyScratchProgressRow()
});
const SCRATCH_PROGRESS_COUNTS=['tracked','winTickets','duds','free','coinsWon','unlocks'];
const SCRATCH_PROGRESS_ROW_COUNTS=['opened','winTickets','duds','free','coinsWon','unlocks'];
function validScratchProgress(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!value.byVariant||
   SCRATCH_PROGRESS_COUNTS.some(key=>!Number.isSafeInteger(value[key])||value[key]<0)||
   SCRATCH_PROGRESS_ROW_COUNTS.some(key=>!Number.isSafeInteger(value.other?.[key])||value.other[key]<0)||
   SCRATCH_PROGRESS_VARIANTS.some(id=>SCRATCH_PROGRESS_ROW_COUNTS.some(key=>
    !Number.isSafeInteger(value.byVariant[id]?.[key])||value.byVariant[id][key]<0)))return false;
 const rows=[...SCRATCH_PROGRESS_VARIANTS.map(id=>value.byVariant[id]),value.other];
 return rows.reduce((n,row)=>n+row.opened,0)===value.tracked&&
  rows.reduce((n,row)=>n+row.winTickets,0)===value.winTickets&&
  rows.reduce((n,row)=>n+row.duds,0)===value.duds&&
  value.winTickets+value.duds===value.tracked;
}
export function addScratchProgress(progress,result){
 if(!result||typeof result!=='object')return;
 const variant=result.board?.variantId;
 const row=SCRATCH_PROGRESS_VARIANTS.includes(variant)?progress.byVariant[variant]:progress.other;
 const prizes=Array.isArray(result.winnings)?result.winnings:
  result.type==='none'?[]:[{type:result.type,amount:result.amount,prize:result.prize}];
 const won=prizes.length>0||(Number.isSafeInteger(result.totalLights)&&result.totalLights>0);
 const freebies=result.free===true?1:0;
 const unlocks=prizes.filter(prize=>prize?.type==='unlock').length;
 const lights=Number.isSafeInteger(result.totalLights)&&result.totalLights>=0?
  result.totalLights:prizes.filter(prize=>prize?.type==='lights').reduce((sum,prize)=>
   sum+progressCount(prize?.amount),0);
 const amount=Number.isSafeInteger(result.totalCoins)&&result.totalCoins>=0?
  result.totalCoins:prizes.filter(prize=>prize?.type==='coins').reduce((sum,prize)=>
   sum+progressCount(prize?.amount),0);
 for(const target of [progress,row]){
  if(target===progress)target.tracked++;
  else target.opened++;
  target.winTickets+=Number(won);
  target.duds+=Number(!won);
  target.free+=freebies;
  target.coinsWon+=amount;
  target.lightsWon=progressCount(target.lightsWon)+lights;
  target.unlocks+=unlocks;
 }
}
function normalizeScratchProgress(raw,recent){
 // Migrate pre-Tic-Tac-Toe counters without losing historical statistics.
 if(raw?.byVariant){
  const missing=SCRATCH_PROGRESS_VARIANTS.filter(id=>!raw.byVariant[id]);
  if(missing.length)raw={...raw,byVariant:{...raw.byVariant,
   ...Object.fromEntries(missing.map(id=>[id,emptyScratchProgressRow()]))}};
 }
 if(validScratchProgress(raw))return raw;
 const progress=emptyScratchProgress();
 for(const receipt of recent)addScratchProgress(progress,receipt.result);
 return progress;
}
export function normalizedScratchWallet(raw){
 const absent=!raw||typeof raw!=='object'||Array.isArray(raw);
 const recent=safeReceipts(raw?.recent);
 return {
  coins:absent?DOG_SCRATCH_START_COINS:capCoins(raw.coins),
  owned:safeClaims(raw?.owned),
  recent,
  daily:typeof raw?.daily==='string'?raw.daily:'',
  purchased:Number.isSafeInteger(raw?.purchased)&&raw.purchased>=0?raw.purchased:0,
  giftSparks:Number.isSafeInteger(raw?.giftSparks)&&raw.giftSparks>=0?Math.min(raw.giftSparks,4):0,
  vouchers:cleanScratchVouchers(raw?.vouchers),
  variantVouchers:cleanVariantVouchers(raw?.variantVouchers),
  levelOneStarterClaimedAt:Number.isSafeInteger(raw?.levelOneStarterClaimedAt)&&raw.levelOneStarterClaimedAt>0?raw.levelOneStarterClaimedAt:0,
  progress:normalizeScratchProgress(raw?.progress,recent),
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
export function dogScratchStatus(raw,tree=null,now=Date.now(),settings=null){
 const w=normalizedScratchWallet(raw);
 const owned=[...new Set([...Object.keys(w.owned),...treeOwned(tree)])];
 const pools=Object.fromEntries(Object.keys(DOG_SCRATCH_TIERS).map(id=>
  [id,{total:tierPool(id).length,remaining:tierPool(id).filter(p=>!owned.includes(p.unlockId)).length}]));
 return {coins:w.coins,giftSparks:w.giftSparks,vouchers:{...w.vouchers},variantVouchers:{...w.variantVouchers},
  levelOneStarterClaimed:Boolean(w.levelOneStarterClaimedAt),starterCoins:DOG_SCRATCH_START_COINS,
  dailyFreeAvailable:w.daily!==dogScratchToday(now),today:dogScratchToday(now),
  tiers:DOG_SCRATCH_TIERS,pools,ownedUnlockIds:owned,
  settings:normalizeScratchSettings(settings),
  purchased:w.purchased,
  progress:{...w.progress,opened:w.purchased,
   olderUnclassified:Math.max(0,w.purchased-w.progress.tracked)},
  lastResult:w.lastResult};
}
// Exact probabilities per 1,000 full tickets, provided at least two unowned
// cosmetic prizes remain for the exclusive rare unlock events.
// The 0.1% rare unlock x2 is INCLUDED in the 11% total x2 chance.
export const DOG_SCRATCH_BONUS_ODDS=Object.freeze({
 doubleMainPer1000:1,mainMultiplierPer1000:1,multiplierPer1000:110
});
export function buyScratchTicket(raw,tree,request,{draw=randomInt,now=Date.now,settings=null,editionSpecial=null,printControl=null,editionPrice=null,discountPercent=0}={}){
 const liveSettings=normalizeScratchSettings(settings);
 const tier=request?.tier;
 if(!Object.hasOwn(DOG_SCRATCH_TIERS,tier))throw Error('SCRATCH_INVALID_TIER');
 const commandId=request?.commandId;
 if(typeof commandId!=='string'||!/^[-a-zA-Z0-9_:]{8,90}$/.test(commandId))throw Error('SCRATCH_INVALID_COMMAND');
 const w=normalizedScratchWallet(raw);
 const replay=w.recent.find(r=>r.commandId===commandId);
 if(replay)return {unchanged:true,wallet:w,result:replay.result,status:dogScratchStatus(w,tree,now(),liveSettings)};
 const voucher=request?.voucher===true;
 const free=request?.free===true;
 if(voucher&&free)throw Error('SCRATCH_INVALID_PAYMENT');
 const hostFree=free&&liveSettings.freeEnabled;
 const variantRequested=request?.variantId;
 const variantVoucherAvailable=variantRequested!==undefined&&w.variantVouchers[variantRequested]>0;
 if(voucher&&!variantVoucherAvailable&&w.vouchers[tier]<=0)throw Error('SCRATCH_NO_VOUCHER');
 if(free&&!hostFree&&tier!=='simple')throw Error('SCRATCH_FREE_ONLY_SIMPLE');
 const today=dogScratchToday(now());
 if(free&&!hostFree&&w.daily===today)throw Error('SCRATCH_DAILY_ALREADY_USED');
 const ticketPrice=request?.variantId==='number_one_20'?liveSettings.numberOne20.price:
  request?.variantId==='gifts'?liveSettings.variants.gifts.price:DOG_SCRATCH_TIERS[tier].price;
 // Edition price is trusted only as a server-side argument. Client-supplied
 // request fields never override the public shop price.
 if(editionPrice!==null&&(!Number.isSafeInteger(editionPrice)||editionPrice<0||editionPrice>1000000))
  throw Error('SCRATCH_EDITION_PRICE_INVALID');
 const safeDiscount=Number.isInteger(discountPercent)?Math.max(0,Math.min(20,discountPercent)):0;
 const facePrice=editionPrice===null?ticketPrice:editionPrice;
 const price=free||voucher?0:Math.max(0,Math.ceil(facePrice*(100-safeDiscount)/100));
 if(w.coins<price)throw Error('SCRATCH_NOT_ENOUGH_COINS');
 const random=max=>{
  const value=draw(max);
  if(!Number.isInteger(value)||value<0||value>=max)throw Error('SCRATCH_INVALID_RANDOM');
  return value;
 };
 // All special tickets use the existing idempotent purchase receipt and the
 // same atomic wallet transaction as the four classic ticket variants.
 // No money can be awarded by a browser-only scratch action.
 if(['tic_tac_toe','number_one_20','dog_jackpot_9'].includes(request?.variantId)){
  const specialId=request.variantId;
  if(tier!==(specialId==='dog_jackpot_9'?'premium':'medium'))throw Error('SCRATCH_INVALID_VARIANT');
  const owned=new Set([...Object.keys(w.owned),...treeOwned(tree)]);
  const pool=specialId==='number_one_20'?DOG_SCRATCH_MEDIUM_POOL:DOG_SCRATCH_PREMIUM_POOL;
  const remaining=pool.filter(prize=>!owned.has(prize.unlockId));
  const unlock=remaining.length?remaining[random(remaining.length)]:null;
  const drawn=specialId==='tic_tac_toe'?drawTicTacToe({draw:random,unlock,mode:'duel',settings:editionSpecial?.ticTacToe??null}):
   specialId==='number_one_20'?drawNumberOne20({draw:random,unlock,settings:liveSettings.numberOne20,
    forcedHits:Number.isInteger(printControl?.forcedWins)?printControl.forcedWins:null}):
   drawDogJackpot9({draw:random,unlock,settings:editionSpecial?.dogJackpot??null,
    forcedHit:printControl?.forcedWins===8?true:printControl?.forcedWins===0?false:null});
  if(!verifyScratchPrizes(drawn.board))throw Error('SCRATCH_BOARD_PRIZE_MISMATCH');
  const stamped=now();
  if(drawn.unlockId)w.owned[drawn.unlockId]=stamped;
  const totalCoins=drawn.winnings.filter(prize=>prize.type==='coins').reduce((sum,prize)=>sum+prize.amount,0);
  w.coins=Math.max(0,Math.min(1000000000,w.coins+totalCoins-price));
  w.purchased++;
  if(voucher){
   if(variantVoucherAvailable)w.variantVouchers[specialId]--;
   else w.vouchers[tier]--;
  }
  if(free&&!hostFree)w.daily=today;
  const sparks=w.giftSparks+(drawn.giftSparks||0);
  const earnedVoucher=Math.floor(sparks/5);
  w.giftSparks=sparks%5;
  if(earnedVoucher)w.variantVouchers.tic_tac_toe=Math.min(10000,w.variantVouchers.tic_tac_toe+earnedVoucher);
  const first=drawn.winnings.find(prize=>prize.type==='unlock')||drawn.winnings[0];
  const result={type:first?.type||'none',tier,commandId,price,free:free||voucher,voucher,
   ...(first?.type==='coins'?{amount:first.amount}:{}),
   ...(first?.type==='unlock'?{prize:first.prize}:{}),
   coinAmounts:specialId==='tic_tac_toe'?[...(drawn.board.coinAmounts??[200,450,800])]:
    specialId==='number_one_20'?[...drawn.board.coinAmounts]:[...(drawn.board.coinAmounts??[100,300,800])],
   ...(specialId==='tic_tac_toe'?{symbolWeights:[360,330,270,40]}:{}),
   giftSparksEarned:drawn.giftSparks||0,giftVoucherEarned:earnedVoucher,
   board:drawn.board,winnings:drawn.winnings,totalCoins,at:stamped,balance:w.coins};
  addScratchProgress(w.progress,result);
  w.lastResult=result;
  w.recent=[...w.recent,{commandId,result}].slice(-40);
  return {unchanged:false,wallet:w,result,status:dogScratchStatus(w,tree,now(),liveSettings)};
 }
 const categoryRoll=random(1000);
 // Pick the displayed card before applying its separately configured odds.
 const availableVariants=SCRATCH_VARIANT_IDS_BY_TIER[tier];
 // The four shop cards may request a specific verified visual variant.
 // Legacy buyers without variantId keep the previous random simple-card draw.
 const requestedVariant=request?.variantId;
 if(requestedVariant!==undefined&&!availableVariants.includes(requestedVariant))
  throw Error('SCRATCH_INVALID_VARIANT');
 const variantId=requestedVariant??(tier==='medium'?'elf':tier==='premium'?'premium_27':availableVariants.length===1?
  availableVariants[0]:availableVariants[random(availableVariants.length)]);
 const config={...DOG_SCRATCH_TIERS[tier],...liveSettings.variants[variantId]};
 // The visual card supports three canonical matches. Host caps above three
 // permit extra coin payouts tied to genuine matching symbols, not fake rows.
 const visiblePrizeLimit=variantId==='premium_27'?config.maxPrizes:Math.min(config.maxPrizes,3);
 const baseCategory=printControl?.forcePremiumUnlock&&variantId==='premium_27'?'unlock':
  printControl?.forceNoPremiumMilestone&&variantId==='premium_27'?'none':
  Number.isInteger(printControl?.forcedWins)&&variantId!=='premium_27'?
    (printControl.forcedWins===0?'none':'coins'):
  categoryRoll<config.weights.none?'none':
  categoryRoll<config.weights.none+config.weights.coins?'coins':'unlock';
 // Premium money rows are independent of the 20-symbol threshold.
 // At default odds: 4% premium unlocks (all 24+), plus 26% from the
 // 76% coin category = exactly 30% of ALL premium tickets at 20+.
 // If host overrides category odds, never silently change their none or
 // unlock percentages: the achievable milestone share may be bounded.
 const premiumMilestone=variantId==='premium_27'&&(
  baseCategory==='unlock'||(baseCategory==='coins'&&
   random(config.weights.coins)<Math.min(config.weights.coins,
    Math.max(0,PREMIUM_20_MILESTONE_PER_1000-config.weights.unlock))));
 const owned=new Set([...Object.keys(w.owned),...treeOwned(tree)]);
 const remaining=tierPool(tier).filter(p=>!owned.has(p.unlockId));
 const winnings=[],newUnlocks=[];
 let doubleMain=false,rareMainMultiplier=false,multiplier=1;
 if(premiumMilestone)winnings.push({
  type:'coins',symbol:'🪙',amount:PREMIUM_20_MILESTONE_COINS,milestone:'gold-20'
 });
 const awardMain=category=>{
  if(winnings.length>=visiblePrizeLimit)return false;
  const choices=remaining.filter(p=>!owned.has(p.unlockId)&&(!category||p.category===category));
  if(!choices.length)return false;
  // Each gift has an independent host-set chance, normalized across
  // gift symbols not already used on the visible board.
  const availableGiftIndices=SCRATCH_GIFT_SYMBOLS.map((icon,i)=>i)
   .filter(i=>!winnings.some(w=>w.type==='unlock'&&w.symbol===SCRATCH_GIFT_SYMBOLS[i]));
  const giftIndex=pickWeightedScratchSymbol(config.giftSymbolWeights,random,availableGiftIndices);
  if(giftIndex<0)return false;
  const prize=choices[random(choices.length)];
  const symbol=SCRATCH_GIFT_SYMBOLS[giftIndex];
  owned.add(prize.unlockId);
  newUnlocks.push(prize.unlockId);
  winnings.push({type:'unlock',symbol,prize:{unlockId:prize.unlockId,category:prize.category,name:prize.name,icon:prize.icon}});
  return true;
 };
 const awardCoin=()=>{
  if(winnings.length>=visiblePrizeLimit)return false;
  const remainingMoneyIndices=config.coinAmounts.map((amount,i)=>i)
   // The 1,000-coin milestone is not a row and does not consume 🪙.
   .filter(i=>!winnings.some(w=>w.type==='coins'&&w.milestone!=='gold-20'&&
    w.symbol===SCRATCH_PAYOUT_ORDER[i]));
  const index=pickWeightedScratchSymbol(config.moneySymbolWeights,random,remainingMoneyIndices);
  if(index<0)return false;
  winnings.push({type:'coins',amount:config.coinAmounts[index],symbol:SCRATCH_PAYOUT_ORDER[index]});
  return true;
 };
 if(variantId==='premium_27'){
  // Every NEW Premiumlos pays FOUR real horizontal money triples.
  // All three denominations occur at least once; a weighted fourth
  // can repeat any money icon. Three matching glyphs on DIFFERENT rows
  // remain separate prizes, credited exactly once each.
  const fourth=pickWeightedScratchSymbol(config.moneySymbolWeights,random);
  if(fourth<0)throw Error('SCRATCH_PREMIUM_MONEY_ODDS_INVALID');
  const moneyRows=[0,1,2,fourth];
  for(let i=moneyRows.length-1;i>0;i--){
   const j=random(i+1);[moneyRows[i],moneyRows[j]]=[moneyRows[j],moneyRows[i]];
  }
  for(const i of moneyRows)winnings.push({
   type:'coins',symbol:SCRATCH_PAYOUT_ORDER[i],amount:config.coinAmounts[i]
  });
  // The 20-field milestone remains an independent 30% lottery
  // worth exactly 1,000 coins, not an extra money row.
  if(baseCategory==='unlock'&&awardMain()){
   const gift=winnings.find(w=>w.type==='unlock');
   if(gift)gift.milestone='premium-24';
  }
  const mainGift=winnings.find(w=>w.type==='unlock');
  if(mainGift&&remaining.length>=2&&config.maxPrizes>=7&&config.weights.unlock>=2){
   const rareRoll=random(config.weights.unlock);
   if(rareRoll===0)doubleMain=awardMain();
   else if(rareRoll===1)
    rareMainMultiplier=Boolean(awardMain(mainGift.prize?.category)||awardMain());
  }
  // No dummy matching rows are created. The normal ×2 only applies to
  // the actual money-row amounts; the 1,000-coin milestone stays fixed.
  const rarePossible=remaining.length>=2;
  const ordinaryRoll=printControl?.disableRandomDouble!==true&&
   baseCategory!=='none'&&!rareMainMultiplier&&
   (rarePossible?random(799)<109:random(800)<110);
  if(ordinaryRoll)for(const row of winnings){
   if(row.type==='coins'&&!row.milestone){
    row.baseAmount=row.amount;row.amount*=2;row.x2=true;
   }
  }
  multiplier=(rareMainMultiplier||ordinaryRoll)?2:1;
 }else{
 if(baseCategory==='coins')awardCoin();
 if(baseCategory==='unlock'){
  // The 24-symbol premium gift remains rare and always includes the 1,000
  // milestone. At a one-prize cap the milestone itself is the only award.
  if(tier==='premium'&&visiblePrizeLimit===1){
   if(!premiumMilestone)awardCoin();
  }else if(!awardMain())awardCoin();
 }
 if(variantId==='premium_27'){
  const mainUnlock=winnings.find(p=>p.type==='unlock');
  if(mainUnlock)mainUnlock.milestone='premium-24';
 }

 // Each of the two rare events is 1/1000 of all tickets, conditional
 // on the BASE UNLOCK bucket: P(unlock)=unlockWeight/1000, P(rare|unlock)=1/unlockWeight.
 // Their two distinct roll values ensure they never overlap.
 const mainUnlock=winnings.find(p=>p.type==='unlock');
 const rareEligible=baseCategory==='unlock'&&remaining.length>=2&&
  visiblePrizeLimit>=3&&config.weights.unlock>=2&&Boolean(mainUnlock);
 const rareRoll=rareEligible?random(config.weights.unlock):-1;
 doubleMain=rareRoll===0&&awardMain();
 rareMainMultiplier=rareRoll===1&&
  (awardMain(mainUnlock?.prize?.category)||awardMain());

 // The independent premium milestone was already assigned above, before
 // adding row prizes. Do not substitute a money-row hit for the 1,000 bonus.

 // Normal x2: 109/799 of all *other* winning tickets.
 // Since 1/1000 of tickets is reserved for rare cosmetic x2, total
 // is exactly 1/1000+(799/1000)*(109/799)=110/1000 = 11%.
 // When cosmetics are exhausted, use 110/800 to retain 11% overall.
 const rarePossible=remaining.length>=2;
 const ordinaryRoll=baseCategory!=='none'&&!rareMainMultiplier&&
  (variantId==='gifts'?random(1000)<(config.doubleChancePer1000??110):
   (rarePossible?random(799)<109:random(800)<110));
 // Never show a misleading ×2 if a one-prize cosmetic-only card has no
 // room for the required visible coin prize.
 const canMultiplyMoney=()=>winnings.some(x=>x.type==='coins'&&x.milestone!=='gold-20');
 if(ordinaryRoll&&!canMultiplyMoney())awardCoin();
 const ordinaryMultiplier=ordinaryRoll&&canMultiplyMoney();
 multiplier=(rareMainMultiplier||ordinaryMultiplier)?2:1;
 if(ordinaryMultiplier){
  for(const item of winnings)if(item.type==='coins'&&item.milestone!=='gold-20'){
   item.baseAmount=item.amount;item.amount*=2;item.x2=true;
  }
 }

 // A bonus money hit can occur on either a coin or cosmetic ticket.
 // On 20% of successful bonus rolls, add a third visible money hit where
 // capacity permits. Never create more than three symbol combinations.
 if(baseCategory!=='none'&&random(100)<config.extraCoinChance){
  if(winnings.length<visiblePrizeLimit)awardCoin();
  if(winnings.length<visiblePrizeLimit&&random(100)<20)awardCoin();
 }

 }
 // The two normal ticket types share one pool; premium gets its own pair.
 // Older medium-priced tickets still use normal game types until shop migration.
 const board=variantId==='premium_27'?
  generatePremium27(winnings,{draw:random,version:5,
   forceFull27:printControl?.forceFull27===true,
   excludeFull27:printControl?.excludeFull27===true}):
  attachScratchPrizes(generateScratchGrid(variantId,winnings.length,{draw:random,
   prizeSymbols:winnings.map(w=>w.symbol)}),winnings);
 if(!verifyScratchPrizes(board))throw Error('SCRATCH_BOARD_PRIZE_MISMATCH');
 // Every ticket's receipt must follow the server-verified visible winning
 // combinations. Non-premium variants can reorder symbols when a board is
 // generated (rows, paths or arbitrary three-of-a-kind groups). Preserve
 // each prize exactly once, but show it beside its actual matching cells.
 winnings.splice(0,winnings.length,...board.wins.map(w=>w.prize));

 // Each Geschenkelinie payout, including its main prize, must be backed
 // by a visible, independently verifiable exact triple. Invisible bonus
 // money is not a separate winning combination on this 3×3 ticket.
 // Other scratch variants keep their own established bonus rules.
 const bonusWinnings=[];
 if(variantId!=='gifts'&&config.maxPrizes>3&&board.wins.length>0&&
    (variantId!=='premium_27'||baseCategory!=='none')){
  for(let slot=winnings.length;slot<config.maxPrizes;slot++){
   if(random(100)>=config.extraCoinChance)continue;
   const sourceWin=random(board.wins.length);
   const coinIndex=pickWeightedScratchSymbol(config.moneySymbolWeights,random);
   bonusWinnings.push({type:'coins',symbol:SCRATCH_PAYOUT_ORDER[coinIndex],
    amount:config.coinAmounts[coinIndex],bonus:true,sourceWin});
  }
 }
 if(variantId==='gifts'){
  // Older print-control paths cannot create extra invisible money wins.
  if(Number.isInteger(printControl?.forcedWins)&&printControl.forcedWins!==board.wins.length)
   throw Error('SCRATCH_GIFTS_VISIBLE_MATCH_REQUIRED');
  if(board.symbolVersion!==3||winnings.length!==board.wins.length||
    board.wins.some(win=>!Array.isArray(win.indices)||win.indices.length!==3||
     !win.indices.every(i=>board.cells[i]===win.symbol)||
     !['🪙','💵','💼','🎁','💝','🎀','🧧','🛍️'].includes(win.symbol)))
   throw Error('SCRATCH_GIFTS_VISIBLE_MATCH_REQUIRED');
 }else if(Number.isInteger(printControl?.forcedWins)&&
   !['tic_tac_toe','number_one_20','dog_jackpot_9'].includes(variantId)){
  const expected=printControl.forcedWins;
  bonusWinnings.length=Math.min(bonusWinnings.length,Math.max(0,expected-winnings.length));
  if(expected<winnings.length||expected>config.maxPrizes||expected>10)
   throw Error('SCRATCH_EDITION_PRIZE_COUNT_UNREACHABLE');
  while(winnings.length+bonusWinnings.length<expected){
   if(!board.wins.length)throw Error('SCRATCH_EDITION_NO_BONUS_SOURCE');
   const sourceWin=random(board.wins.length);
   const coinIndex=pickWeightedScratchSymbol(config.moneySymbolWeights,random);
   bonusWinnings.push({type:'coins',symbol:SCRATCH_PAYOUT_ORDER[coinIndex],
    amount:config.coinAmounts[coinIndex],bonus:true,sourceWin});
  }
 }
 const allWinnings=[...winnings,...bonusWinnings];
 // 🎄 Independent light bonus: verified and booked with the immutable server
 // receipt. It is separate from the visible three-in-a-row prize limit.
 const lightMin=config.lightMin??1,lightMax=config.lightMax??10;
 const baseLights=variantId==='gifts'&&random(1000)<(config.lightChancePer1000??100)?
  lightMin+random(lightMax-lightMin+1):0;
 const totalLights=baseLights*(multiplier===2?2:1);
 // Show the real server-booked light and x2 bonuses on the scratched ticket.
 // Extra coin payouts have already been included in allWinnings amounts.
 const extraCoins=allWinnings.filter(prize=>prize?.x2&&Number.isSafeInteger(prize.baseAmount))
  .reduce((sum,prize)=>sum+prize.amount-prize.baseAmount,0);
 const extraLights=multiplier===2?baseLights:0;
 const doubleWin=variantId==='gifts'&&(extraCoins>0||extraLights>0)?
  {extraCoins,extraLights}:null;
 const lightBadgeIndex=variantId==='gifts'&&totalLights>0?random(board.cells.length):null;
 const sourceWin=board.wins.find(win=>win.prize?.type==='coins'&&win.prize?.x2);
 const doubleBadgeIndex=doubleWin?
  (Number.isInteger(sourceWin?.indices?.[0])?sourceWin.indices[0]:random(board.cells.length)):null;
 // Only after generating and verifying the exact visible card, grant awards.
 const stamped=now();
 for(const unlockId of newUnlocks)w.owned[unlockId]=stamped;
 const totalCoins=allWinnings.filter(x=>x.type==='coins').reduce((sum,x)=>sum+x.amount,0);
 w.coins=Math.max(0,Math.min(1000000000,w.coins+totalCoins-price));
 w.purchased++;
 if(voucher){
  if(variantVoucherAvailable)w.variantVouchers[variantId]--;
  else w.vouchers[tier]--;
 }
 if(free&&!hostFree)w.daily=today;
 const first=baseCategory==='unlock'?
   winnings.find(w=>w.type==='unlock')||winnings[0]:winnings[0];
 const result={
  type:first?.type||'none',tier,
  ...(first?.type==='coins'?{amount:first.amount}:{}),
  ...(first?.type==='unlock'?{prize:first.prize}:{}),
  // Fix the advertised payouts on this exact receipt. A later host edit
  // must never change the legend of an already purchased scratch ticket.
  coinAmounts:[...config.coinAmounts],
  moneySymbolWeights:[...config.moneySymbolWeights],
  giftSymbolWeights:[...config.giftSymbolWeights],
  winnings:allWinnings,totalCoins,totalLights,board,
  ...(variantId==='gifts'?{doubleWin,lightBadgeIndex,doubleBadgeIndex}:{}),
  doubleMain:Boolean(doubleMain),rareMainMultiplier:Boolean(rareMainMultiplier),
  multiplier,commandId,price,free:free||voucher,voucher,at:stamped,balance:w.coins
 };
 // Count the server-issued ticket exactly once, in the same wallet transaction.
 // Replayed command IDs returned earlier and never reach this update.
 addScratchProgress(w.progress,result);
 w.lastResult=result;
 w.recent=[...w.recent,{commandId,result}].slice(-40);
 return {unchanged:false,wallet:w,result,status:dogScratchStatus(w,tree,now(),liveSettings)};
}
