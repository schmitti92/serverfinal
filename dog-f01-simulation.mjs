/** F-01: seeded offline projection, no network or persistence. */
import {pathToFileURL} from 'node:url';
import {dogChestOffer,dogChestContents} from './dog-balance.js';
import {DOG_RESOURCES,dogInventory} from './dog-materials.js';
import {dogHero,forgeQuote,forgeUpgrade} from './dog-forge.js';
export const TARGET_ITEMS=['weapon','armor','attack_power','vitality'];
export function simulate(seed=1,maxMatches=200000){
 let state=seed>>>0;const rand=n=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state%n;};
 let resources={...dogInventory().resources},levels={...dogHero().levels};
 let matches=0,failures=0;const chapters=[];
 for(let chapter=1;chapter<=10;chapter++){
  const target=chapter*5,before=matches,oldFailures=failures;
  const progress={forgeLevel:chapter,sharedBosses:Array.from({length:chapter-1},(_,i)=>(i+1)*10)};
  while(matches<maxMatches&&!TARGET_ITEMS.every(id=>levels[id]>=target)){
   for(const id of TARGET_ITEMS){
    if(levels[id]>=target)continue;
    const quote=forgeQuote(id,levels[id],resources,progress);
    if(quote.locked)throw Error('LOCKED:'+id+':'+chapter);
    if(!quote.affordable)continue;
    const attempt=forgeUpgrade({levels},{resources},id,levels[id],rand(10000),0,progress);
    levels=attempt.hero.levels;resources=attempt.inventory.resources;
    failures+=Number(!attempt.result.success);
   }
   if(TARGET_ITEMS.every(id=>levels[id]>=target))break;
   const drop=dogChestContents(dogChestOffer((chapter-1)*10+1,rand),rand);
   for(const id of DOG_RESOURCES)resources[id]+=drop.items[id];
   matches++;
  }
  const completed=TARGET_ITEMS.every(id=>levels[id]>=target);
  chapters.push({boss:chapter*10,matches:matches-before,totalMatches:matches,
   failures:failures-oldFailures,completed});
  if(!completed)break;
 }
 return {seed,matches,failures,chapters,completed:chapters.length===10&&chapters[9].completed};
}
/** Independent personal inventories; group gate unlock is shared, not a material pool. */
export function trioSample(trials=50,minutesPerDeal=15){
 if(!Number.isFinite(minutesPerDeal)||minutesPerDeal<=0)throw Error('INVALID_DEAL_DURATION');
 const heroes=Array.from({length:3},(_,hero)=>Array.from({length:trials},(_,i)=>
  simulate(1+hero*100000+i)));
 return Array.from({length:10},(_,chapter)=>{
  const rows=Array.from({length:trials},(_,i)=>{
   const counts=heroes.map(runs=>runs[i].chapters[chapter]?.totalMatches);
   return counts.every(Number.isFinite)?Math.max(...counts):null;
  }).filter(Number.isFinite).sort((a,b)=>a-b);
  const q=p=>rows[Math.floor((rows.length-1)*p)]??null;
  const median=q(.5);
  return {boss:(chapter+1)*10,samples:rows.length,
   trioTotalDealsMedian:median===null?null:heroes.reduce((sum,runs)=>
    sum+runs[Math.floor(trials/2)].chapters[chapter]?.totalMatches,0),
   slowestHeroDealsP10:q(.1),slowestHeroDealsMedian:median,slowestHeroDealsP90:q(.9),
   sequentialHoursMedian:median===null?null:Math.round(median*3*minutesPerDeal/60),
   parallelHoursMedian:median===null?null:Math.round(median*minutesPerDeal/60)};
 });
}
export function sample(trials=50){
 const runs=Array.from({length:trials},(_,i)=>simulate(i+1));
 return Array.from({length:10},(_,i)=>{
  const values=runs.map(r=>r.chapters[i]?.totalMatches).filter(Number.isFinite).sort((a,b)=>a-b);
  const q=p=>values[Math.floor((values.length-1)*p)]??null;
  return {boss:(i+1)*10,samples:values.length,p10:q(.1),median:q(.5),p90:q(.9)};
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 console.log(JSON.stringify({assumptions:'One player, one stage-dependent chest per Deal match, weapon/armor/attack_power/vitality to forge chapter cap, boss wins assumed, no exchange or playtime',chapters:sample(Number(process.argv[2]||50)),trio:trioSample(Number(process.argv[2]||50))},null,2));
