/** Official Lichtertal Christmas tree: ten fixed prizes, one each per player.
 * Rewards depend only on the server-verified village stage and signed-in user.
 * Successful claims are persisted transactionally; opening this page performs
 * no write and never changes an already-collected prize.
 */
import {DOG_VILLAGE_DEFAULT_LEVELS} from './christmas-village.js';
export const DOG_TREE_REWARDS_COLLECTION='dog_christmas_tree_rewards_v1';
export const DOG_TREE_THRESHOLDS=Object.freeze([4,5,7,9,11,13,15,17,19,20]);
export const DOG_TREE_PRIZE_POOL=Object.freeze([
 {
  "unlockId": "christmas2026:scene:01",
  "category": "backgrounds",
  "name": "Märchenhafter Weihnachtswald",
  "label": "Vollbild-Hintergrund",
  "icon": "🏞️"
 },
 {
  "unlockId": "christmas2026:scene:02",
  "category": "backgrounds",
  "name": "Realistische Mondnacht",
  "label": "Vollbild-Hintergrund",
  "icon": "🏞️"
 },
 {
  "unlockId": "christmas2026:scene:03",
  "category": "backgrounds",
  "name": "Aquarell-Weihnachtskarte",
  "label": "Vollbild-Hintergrund",
  "icon": "🏞️"
 },
 {
  "unlockId": "christmas2026:scene:04",
  "category": "backgrounds",
  "name": "Winterwelt in Low-Poly-3D",
  "label": "Vollbild-Hintergrund",
  "icon": "🏞️"
 },
 {
  "unlockId": "christmas2026:scene:05",
  "category": "backgrounds",
  "name": "Magischer Polarlicht-Fjord",
  "label": "Vollbild-Hintergrund",
  "icon": "🏞️"
 },
 {
  "unlockId": "christmas2026:avatar:01",
  "category": "avatars",
  "name": "Weihnachtsmann",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:02",
  "category": "avatars",
  "name": "Frau Weihnachtsmann",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:03",
  "category": "avatars",
  "name": "Rentier Rudolf",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:04",
  "category": "avatars",
  "name": "Schneemann",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:05",
  "category": "avatars",
  "name": "Weihnachtswichtel",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:06",
  "category": "avatars",
  "name": "Weihnachtswichtelin",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:07",
  "category": "avatars",
  "name": "Weihnachts-Eisbär",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:08",
  "category": "avatars",
  "name": "Weihnachtspinguin",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:09",
  "category": "avatars",
  "name": "Lebkuchenmann",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:10",
  "category": "avatars",
  "name": "Nussknacker",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:11",
  "category": "avatars",
  "name": "Weihnachtskatze",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:12",
  "category": "avatars",
  "name": "Weihnachtshund",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:13",
  "category": "avatars",
  "name": "Schneeeule",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:14",
  "category": "avatars",
  "name": "Weihnachtskrippe",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:15",
  "category": "avatars",
  "name": "Schneekugel",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:16",
  "category": "avatars",
  "name": "Adventskranz",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:17",
  "category": "avatars",
  "name": "Weihnachtsbaum",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:18",
  "category": "avatars",
  "name": "Weihnachtskamin",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:19",
  "category": "avatars",
  "name": "Geschenkesack",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:avatar:20",
  "category": "avatars",
  "name": "Weihnachtsschlitten",
  "label": "Weihnachtsprofilbild",
  "icon": "👤"
 },
 {
  "unlockId": "christmas2026:cards:kartendesign-02",
  "category": "cards",
  "name": "Winterzauber · Blau",
  "label": "Kartendesign",
  "icon": "🃏"
 },
 {
  "unlockId": "christmas2026:cards:kartendesign-03",
  "category": "cards",
  "name": "Weihnachtsglanz · Rot-Grün-Gold",
  "label": "Kartendesign",
  "icon": "🃏"
 },
 {
  "unlockId": "christmas2026:board:weihnachtsdorf",
  "category": "boards",
  "name": "Weihnachtsdorf",
  "label": "Spielbrett",
  "icon": "🎲"
 },
 {
  "unlockId": "christmas2026:board:lebkuchenwerkstatt",
  "category": "boards",
  "name": "Lebkuchenwerkstatt",
  "label": "Spielbrett",
  "icon": "🎲"
 },
 {
  "unlockId": "christmas2026:board:polarlichtpalast",
  "category": "boards",
  "name": "Polarlichtpalast",
  "label": "Spielbrett",
  "icon": "🎲"
 },
 {
  "unlockId": "christmas2026:board:winterlandschaft",
  "category": "boards",
  "name": "Winterlandschaft",
  "label": "Spielbrett",
  "icon": "🎲"
 },
 {
  "unlockId": "christmas2026:nameframe:01",
  "category": "frames",
  "name": "Sternengold",
  "label": "Namensrahmen",
  "icon": "🛡️"
 },
 {
  "unlockId": "christmas2026:nameframe:02",
  "category": "frames",
  "name": "Frostkristall",
  "label": "Namensrahmen",
  "icon": "🛡️"
 },
 {
  "unlockId": "christmas2026:nameframe:03",
  "category": "frames",
  "name": "Tannenzauber",
  "label": "Namensrahmen",
  "icon": "🛡️"
 },
 {
  "unlockId": "christmas2026:nameframe:04",
  "category": "frames",
  "name": "Lebkuchenfest",
  "label": "Namensrahmen",
  "icon": "🛡️"
 },
 {
  "unlockId": "christmas2026:nameframe:05",
  "category": "frames",
  "name": "Polarlicht-Magie",
  "label": "Namensrahmen",
  "icon": "🛡️"
 },
 {
  "unlockId": "christmas2026:activeicon:01",
  "category": "emblems",
  "name": "Weihnachtsstern",
  "label": "Aktivsymbol",
  "icon": "👑"
 },
 {
  "unlockId": "christmas2026:activeicon:02",
  "category": "emblems",
  "name": "Eiskrone",
  "label": "Aktivsymbol",
  "icon": "👑"
 },
 {
  "unlockId": "christmas2026:activeicon:03",
  "category": "emblems",
  "name": "Tannenzauber",
  "label": "Aktivsymbol",
  "icon": "👑"
 },
 {
  "unlockId": "christmas2026:activeicon:04",
  "category": "emblems",
  "name": "Glockenzauber",
  "label": "Aktivsymbol",
  "icon": "👑"
 },
 {
  "unlockId": "christmas2026:activeicon:05",
  "category": "emblems",
  "name": "Polarlicht-Stern",
  "label": "Aktivsymbol",
  "icon": "👑"
 },
 {
  "unlockId": "christmas2026:emoji:01",
  "category": "emojis",
  "name": "Weihnachtsmann",
  "label": "Weihnachts-Emoji",
  "icon": "😄"
 },
 {
  "unlockId": "christmas2026:emoji:02",
  "category": "emojis",
  "name": "Frau Weihnachtsmann",
  "label": "Weihnachts-Emoji",
  "icon": "😄"
 },
 {
  "unlockId": "christmas2026:emoji:03",
  "category": "emojis",
  "name": "Rentier Rudolf",
  "label": "Weihnachts-Emoji",
  "icon": "😄"
 },
 {
  "unlockId": "christmas2026:emoji:04",
  "category": "emojis",
  "name": "Weihnachtswichtel",
  "label": "Weihnachts-Emoji",
  "icon": "😄"
 },
 {
  "unlockId": "christmas2026:emoji:05",
  "category": "emojis",
  "name": "Weihnachtsplätzchen",
  "label": "Weihnachts-Emoji",
  "icon": "😄"
 },
 {
  "unlockId": "christmas2026:emoji:06",
  "category": "emojis",
  "name": "Weihnachtsschlitten",
  "label": "Weihnachts-Emoji",
  "icon": "😄"
 },
 {
  "unlockId": "christmas2026:emoji:07",
  "category": "emojis",
  "name": "Weihnachtsglocke",
  "label": "Weihnachts-Emoji",
  "icon": "😄"
 },
 {
  "unlockId": "christmas2026:emoji:08",
  "category": "emojis",
  "name": "Nikolausstiefel",
  "label": "Weihnachts-Emoji",
  "icon": "😄"
 },
 {
  "unlockId": "christmas2026:emoji:09",
  "category": "emojis",
  "name": "Geschenkeschleife",
  "label": "Weihnachts-Emoji",
  "icon": "😄"
 },
 {
  "unlockId": "christmas2026:emoji:10",
  "category": "emojis",
  "name": "Weihnachtsstern",
  "label": "Weihnachts-Emoji",
  "icon": "😄"
 }
]
 .map(p=>Object.freeze(p)));
/** Ten announced, permanent prizes – no client/server random draw at claim.
 * The catalogue is the source of truth for categories, names and icons.
 * If a user claimed a conflicting item under the old random system, preserve
 * that receipt and choose a deterministic, not-yet-owned alternative.
 */
export const DOG_TREE_FIXED_PRIZE_IDS=Object.freeze([
 "christmas2026:scene:01",
 "christmas2026:avatar:01",
 "christmas2026:cards:kartendesign-02",
 "christmas2026:board:weihnachtsdorf",
 "christmas2026:emoji:05",
 "christmas2026:nameframe:01",
 "christmas2026:activeicon:02",
 "christmas2026:cards:kartendesign-03",
 "christmas2026:scene:05",
 "christmas2026:board:polarlichtpalast"
]);
export const DOG_TREE_FIXED_CATEGORIES=Object.freeze(
 DOG_TREE_FIXED_PRIZE_IDS.map(id=>DOG_TREE_PRIZE_POOL.find(p=>p.unlockId===id)?.category)
);
export const DOG_TREE_REWARD_SCHEDULE=Object.freeze(
 DOG_TREE_FIXED_PRIZE_IDS.map((unlockId,index)=>{
  const prize=DOG_TREE_PRIZE_POOL.find(p=>p.unlockId===unlockId);
  if(!prize)throw Error('TREE_PRIZE_MISSING_FROM_CATALOG');
  return Object.freeze({level:index+1,unlockId,category:prize.category,title:prize.name,icon:prize.icon});
 })
);
if(new Set(DOG_TREE_FIXED_PRIZE_IDS).size!==10)throw Error('TREE_FIXED_PRIZE_DUPLICATE');
export function dogTreeLevelFromLevels(input){
 const levels=input&&typeof input==='object'&&input.levels?input.levels:input;
 const safe=levels&&typeof levels==='object'?levels:DOG_VILLAGE_DEFAULT_LEVELS;
 const amount=['tower','workshop','bakery','inn'].reduce((sum,id)=>{
  const n=safe[id];return sum+(Number.isInteger(n)&&n>=1&&n<=5?n:1);
 },0);
 return DOG_TREE_THRESHOLDS.filter(n=>amount>=n).length;
}
const cleanClaims=raw=>{
 const input=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
 return Object.fromEntries(Object.entries(input).filter(([key,p])=>
  /^([1-9]|10)$/.test(key)&&p&&typeof p==='object'&&typeof p.unlockId==='string'&&
  DOG_TREE_PRIZE_POOL.some(entry=>entry.unlockId===p.unlockId)));
};
export function dogTreeRewardStatus(village,profileDoc){
 const treeLevel=dogTreeLevelFromLevels(village);
 const claims=cleanClaims(profileDoc?.claims);
 const ownedUnlockIds=[...new Set(Object.values(claims).map(c=>c.unlockId))];
 const rewards=DOG_TREE_REWARD_SCHEDULE.map(entry=>{
  const claimed=claims[String(entry.level)]||null;
  return {...entry,state:claimed?'collected':treeLevel>=entry.level?'ready':'locked',
   prize:claimed?DOG_TREE_PRIZE_POOL.find(p=>p.unlockId===claimed.unlockId)||null:null,
   claimedAt:claimed?.claimedAt||null};
 });
 return {treeLevel,maxLevel:10,collected:rewards.filter(x=>x.state==='collected').length,
  available:rewards.filter(x=>x.state==='ready').length,ownedUnlockIds,rewards};
}
/** One claimed level = one immutable account entitlement.
 * No random choices are made after the rewards are announced.
 * Previously collected prizes remain exactly as they were recorded.
 */
export function claimDogTreeReward(profileDoc,village,requestedLevel,{clock=Date.now}={}){
 if(!Number.isInteger(requestedLevel)||requestedLevel<1||requestedLevel>10)throw Error('INVALID_TREE_LEVEL');
 const claims=cleanClaims(profileDoc?.claims);
 if(claims[String(requestedLevel)]){
  return {unchanged:true,document:{claims},
   prize:DOG_TREE_PRIZE_POOL.find(p=>p.unlockId===claims[String(requestedLevel)].unlockId),
   status:dogTreeRewardStatus(village,{claims})};
 }
 if(requestedLevel>dogTreeLevelFromLevels(village))throw Error('TREE_LEVEL_NOT_REACHED');
 const owned=new Set(Object.values(claims).map(p=>p.unlockId));
 const planned=DOG_TREE_REWARD_SCHEDULE[requestedLevel-1];
 let prize=DOG_TREE_PRIZE_POOL.find(p=>p.unlockId===planned.unlockId);
 if(owned.has(prize.unlockId)){
  // Backward-compatible collision rule for pre-existing randomly won items.
  // Prefer the same category; only use another category if all are owned.
  prize=DOG_TREE_PRIZE_POOL.find(p=>p.category===planned.category&&!owned.has(p.unlockId))
   || DOG_TREE_PRIZE_POOL.find(p=>!owned.has(p.unlockId));
 }
 if(!prize)throw Error('TREE_PRIZE_POOL_EXHAUSTED');
 const now=clock();
 const receipt={unlockId:prize.unlockId,category:prize.category,claimedAt:now};
 const next={claims:{...claims,[String(requestedLevel)]:receipt},version:2,updatedAt:now};
 return {unchanged:false,document:next,prize,status:dogTreeRewardStatus(village,next)};
}
