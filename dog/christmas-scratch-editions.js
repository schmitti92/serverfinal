/**
 * DOG Christmas scratch print runs. Exactly 500 immutable, server-verified
 * tickets are generated before activation. Existing receipt formats stay valid.
 * Pack the draw queue into ONE Firestore document rather than 500 ticket writes.
 */
import {gzipSync,gunzipSync} from 'node:zlib';
import {randomInt,randomUUID} from 'node:crypto';
import {
 buyScratchTicket,normalizedScratchWallet,dogScratchStatus,addScratchProgress,
 DOG_SCRATCH_PREMIUM_POOL,DOG_SCRATCH_MEDIUM_POOL,
 DOG_SCRATCH_BASIC_EMOJIS,DOG_SCRATCH_BLOCK_COLORS,DOG_SCRATCH_TIERS
} from './christmas-scratch.js';
import {SCRATCH_VARIANT_IDS_BY_TIER,SCRATCH_GRID_VARIANTS} from './christmas-scratch-grid.js';
import {SCRATCH_GIFT_SYMBOLS,SCRATCH_PAYOUT_ORDER} from './christmas-scratch-symbols.js';
import {normalizeScratchSettings,validateScratchSettings} from './christmas-scratch-settings.js';
import {validateTicDuelEditionSettings} from './christmas-tictactoe-duel.js';
import {validateDogJackpotEditionSettings} from './christmas-special-scratch.js';

export const SCRATCH_EDITION_COLLECTION='dog_christmas_scratch_editions_v1';
export const SCRATCH_EDITION_POINTERS='dog_christmas_scratch_editions_active_v1';
export const SCRATCH_PRINT_SIZE=500;
export const SCRATCH_EDITION_VARIANTS=Object.freeze(Object.values(SCRATCH_VARIANT_IDS_BY_TIER).flat());
const cleanInt=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const ticketTier=id=>Object.keys(SCRATCH_VARIANT_IDS_BY_TIER).find(t=>SCRATCH_VARIANT_IDS_BY_TIER[t].includes(id));
const format=(n)=>Number(n||0).toLocaleString('de-DE');
// These facts mirror the currently shipped, server-verified prize evaluators.
// A visual winning path is not the same as the number of payouts: classic
// tickets can grant additional money bonuses referencing an actual match.
const SCRATCH_EDITION_RULES=Object.freeze({
 gifts:{label:'🎁 Geschenkelinie',fields:9,scratchFields:9,lineCount:8,lineLabel:'8 feste Dreierlinien',
  maxWins:10,minWins:0,baseMatches:'Bis zu 3 sichtbare Basis-Treffer',
  mechanic:'3 gleiche Symbole in einer der 3 Reihen, 3 Spalten oder 2 Diagonalen.',
  extras:'Weitere Münzpreise können an geprüfte Gewinnlinien gekoppelt sein.'},
 snow_collect:{label:'❄️ Schneeflocken-Bingo',fields:16,scratchFields:16,lineCount:null,lineLabel:'Keine festen Linien · beliebige Dreiergruppen',
  maxWins:10,minWins:0,baseMatches:'Bis zu 3 sichtbare Basis-Treffer',
  mechanic:'3 gleiche Symbole irgendwo auf den 16 Feldern; Nieten-Symbole zählen nicht.',
  extras:'Theoretisch 560 Dreierkombinationen an Positionen, aber keine 560 unabhängigen Auszahlungen.'},
 elf:{label:'🧝 Magischer Wichtelpfad',fields:20,scratchFields:20,lineCount:null,lineLabel:'Variable durchgehende Pfade',
  maxWins:10,minWins:0,baseMatches:'Bis zu 3 sichtbare Basis-Treffer',
  mechanic:'Geld: zusammenhängender Pfad gleicher Symbole links nach rechts. Geschenke: drei verbundene Felder.',
  extras:'Pfadanzahl ist dynamisch und hängt von den tatsächlich angezeigten Symbolen ab.'},
 premium_27:{label:'👑 Premium-Weihnachtslos',fields:27,scratchFields:27,lineCount:9,lineLabel:'9 waagerechte Dreierreihen',
  maxWins:10,minWins:4,baseMatches:'4 garantierte Geldreihen',
  mechanic:'Vier echte Geldreihen garantiert. Bei 20 Symbolfeldern +1.000 Münzen. 24+ Felder können eine Freischaltung enthalten.',
  extras:'Bis 10 gesamte Auszahlungen mit geprüften Zusatzpreisen; 10 Auszahlungen sind nicht 10 eigenständige Gewinnlinien. 27/27 volle Felder separat planbar.'},
 tic_tac_toe:{label:'⭕ DOG Tic-Tac-Toe',fields:9,scratchFields:11,lineCount:8,lineLabel:'8 mögliche Dreierreihen',
  maxWins:1,minWins:0,baseMatches:'1 Auszahlung trotz mehrerer Linien',
  mechanic:'11 Rubbelstellen: Multiplikator, Gewinnzeichen und neun Felder. Nur passende Kreis- oder Kreuzlinien zählen.',
  extras:'Eine oder mehrere passende Dreierreihen lösen genau einen Gesamtpreis × Multiplikator aus.'},
 number_one_20:{label:'🔢 Glückszahl 1',fields:40,scratchFields:40,lineCount:20,lineLabel:'20 unabhängige Gewinnreihen',
  maxWins:20,minWins:0,baseMatches:'Bis 20 echte Reihentreffer',
  mechanic:'20 Reihen mit je 2 Rubbelstellen: links Preis, rechts Zahl. Jede 1 gewinnt den linken Preis.',
  extras:'Ein einzelnes Los kann in jeder seiner 20 Reihen gewinnen.'},
 dog_jackpot_9:{label:'🐾 Finde DOG!',fields:9,scratchFields:9,lineCount:0,lineLabel:'1 DOG-Auslöser, keine Gewinnlinien',
  maxWins:8,minWins:0,baseMatches:'0 oder 8 Gewinne',
  mechanic:'Ein DOG-Symbol aktiviert die acht übrigen Symbolpreise. Ohne DOG gewinnt keines der Felder.',
  extras:'Bei Treffer acht echte Einzelauszahlungen – keine klassische Reihenprüfung.'}
});
export function scratchEditionCatalog(settings=null){
 const normalized=normalizeScratchSettings(settings);
 return SCRATCH_EDITION_VARIANTS.map(variantId=>{
  const rule=SCRATCH_EDITION_RULES[variantId],tier=ticketTier(variantId);
  const activeSettings=normalized.variants?.[variantId]||
   (variantId==='number_one_20'?normalized.numberOne20:null);
  return {variantId,tier,...rule,jackpotSymbols:[...SCRATCH_GIFT_SYMBOLS],
   payoutSymbols:[...SCRATCH_PAYOUT_ORDER.slice(0,3),'⭐','✖️2',...SCRATCH_GIFT_SYMBOLS],
   boardRows:SCRATCH_GRID_VARIANTS[variantId]?.rows??null,
   boardCols:SCRATCH_GRID_VARIANTS[variantId]?.cols??null,
   standardPrice:variantId==='number_one_20'?normalized.numberOne20.price:DOG_SCRATCH_TIERS[tier].price,
   configuredMaxPrizes:normalized.variants?.[variantId]?.maxPrizes??rule.maxWins,
   coinAmounts:activeSettings?.coinAmounts??(tier==='simple'?[10,40,100]:
     tier==='premium'?[200,800,2000]:[100,300,800]),
   chances:activeSettings?.weights??null};
 });
}


export function validateEditionConfig(input){
 const variantId=input?.variantId;
 const printSize=Number(input?.printSize??SCRATCH_PRINT_SIZE);
 if(!cleanInt(printSize,1,SCRATCH_PRINT_SIZE))throw Error('EDITION_PRINT_SIZE_INVALID');
 if(!SCRATCH_EDITION_VARIANTS.includes(variantId))throw Error('EDITION_INVALID_VARIANT');
 const maxTotalCoins=Number(input.maxTotalCoins);
 const maxPerTicketCoins=Number(input.maxPerTicketCoins);
 const maxPrizesPerTicket=Number(input.maxPrizesPerTicket);
 const maxUnlocks=Number(input.maxUnlocks);
 // Print-only ×2 bonus: exact ticket count cap, optional minimum and chance.
 // Existing print runs without this field retain their historical payouts.
 const requestedDouble=input.doubleWin??{};
 const doubleWin={
  chancePer1000:Number(requestedDouble.chancePer1000??0),
  minTickets:Number(requestedDouble.minTickets??0),
  maxTickets:Number(requestedDouble.maxTickets??0)
 };
 if(!cleanInt(doubleWin.chancePer1000,0,1000)||
  !cleanInt(doubleWin.minTickets,0,printSize)||
  !cleanInt(doubleWin.maxTickets,0,printSize)||
  doubleWin.minTickets>doubleWin.maxTickets)
  throw Error('EDITION_DOUBLE_INVALID');
 const symbolBudgets={};
 if(input.symbolBudgets!==undefined&&input.symbolBudgets!==null){
  if(!input.symbolBudgets||typeof input.symbolBudgets!=='object'||
    Array.isArray(input.symbolBudgets)||
    Object.keys(input.symbolBudgets).some(id=>!['coin','note','case','lights','gift'].includes(id)))
   throw Error('EDITION_SYMBOL_BUDGET_INVALID');
  for(const [id,row] of Object.entries(input.symbolBudgets)){
   const min=Number(row?.min),max=Number(row?.max),maxTotal=Number(row?.maxTotal);
   const minTotal=Number(row?.minTotal??0);
   const chancePer1000=id==='lights'?Number(row?.chancePer1000??0):null;
   const ticketCount=id==='lights'&&row?.ticketCount!==null&&row?.ticketCount!==undefined&&
    row?.ticketCount!==''?Number(row.ticketCount):null;
   const smallest=id==='gift'?0:1;
   const largest=id==='gift'?20:50000000;
   if(!Number.isSafeInteger(min)||min<smallest||min>largest||
    !Number.isSafeInteger(max)||max<min||max>largest||
    !Number.isSafeInteger(minTotal)||minTotal<0||minTotal>maxTotal||
    !Number.isSafeInteger(maxTotal)||maxTotal<0||maxTotal>(id==='gift'?500:1000000000000)||
    (id==='lights'&&(!cleanInt(chancePer1000,0,1000)||
      (ticketCount!==null&&!cleanInt(ticketCount,0,printSize)))))
    throw Error('EDITION_SYMBOL_BUDGET_INVALID_'+id);
   symbolBudgets[id]={min,max,minTotal,maxTotal,...(id==='lights'?{chancePer1000,ticketCount}:{})};
  }
 }
 if(symbolBudgets.lights?.ticketCount!==null&&symbolBudgets.lights?.ticketCount!==undefined){
  const lights=symbolBudgets.lights;
  if(lights.ticketCount*lights.min>lights.maxTotal||
    (lights.ticketCount===0&&lights.minTotal>0))throw Error('EDITION_LIGHT_QUOTA_BUDGET');
 }
 const ticketPrice=input.ticketPrice===undefined?
  (variantId==='number_one_20'?500:DOG_SCRATCH_TIERS[ticketTier(variantId)].price):
  Number(input.ticketPrice);
 if(!cleanInt(ticketPrice,0,1000000))throw Error('EDITION_TICKET_PRICE_INVALID');
 const targetTotalCoins=input.targetTotalCoins===null||input.targetTotalCoins===undefined||input.targetTotalCoins===''?
  null:Number(input.targetTotalCoins);
 const targetTolerancePercent=input.targetTolerancePercent===undefined?5:Number(input.targetTolerancePercent);
 const premiumFull27Tickets=input.premiumFull27Tickets===undefined?0:Number(input.premiumFull27Tickets);
 const volatility=input.volatility===undefined?70:Number(input.volatility);
 if(!cleanInt(volatility,0,100))throw Error('EDITION_VOLATILITY_INVALID');
 if(targetTotalCoins!==null&&(!cleanInt(targetTotalCoins,0,1000000000000)||
   targetTotalCoins>maxTotalCoins||
   targetTotalCoins>maxPerTicketCoins*printSize))
  throw Error('EDITION_TARGET_INVALID');
 if(!cleanInt(targetTolerancePercent,0,30))
  throw Error('EDITION_TARGET_TOLERANCE_INVALID');
 if(!cleanInt(premiumFull27Tickets,0,printSize)||
   (premiumFull27Tickets&&variantId!=='premium_27'))
  throw Error('EDITION_FULL27_INVALID');
 if(!cleanInt(maxTotalCoins,0,1000000000000)||
  !cleanInt(maxPerTicketCoins,0,1000000000)||
  !cleanInt(maxPrizesPerTicket,1,20)||
  !cleanInt(maxUnlocks,0,printSize))throw Error('EDITION_INVALID_LIMITS');
 const gameSettings=input?.gameSettings??null;
 if(gameSettings!==null&&(!gameSettings||typeof gameSettings!=='object'||
  Array.isArray(gameSettings)||JSON.stringify(gameSettings).length>6000))
  throw Error('EDITION_INVALID_GAME_SETTINGS');
 const title=String(input.title||'').trim();
 if(!title||title.length>70)throw Error('EDITION_INVALID_TITLE');
 const quotas={};
 for(let count=0;count<=20;count++){
  const value=input?.quotas?.[String(count)];
  if(value===null||value===undefined||value==='')continue;
  if(!cleanInt(value,0,printSize))throw Error('EDITION_INVALID_QUOTA_'+count);
  if(count>maxPrizesPerTicket&&value>0&&!(variantId==='premium_27'&&premiumFull27Tickets>0&&count===10))
   throw Error('EDITION_QUOTA_ABOVE_MAX_'+count);
  if(value>0)quotas[count]=value;
 }
 if(variantId==='premium_27'&&quotas[0]>0)throw Error('EDITION_PREMIUM_HAS_NO_DUDS');
 if(premiumFull27Tickets&&(maxPrizesPerTicket<10||maxUnlocks<premiumFull27Tickets||
   (quotas[10]!==undefined&&quotas[10]<premiumFull27Tickets)||
   (quotas[10]===0)))
  throw Error('EDITION_FULL27_NEEDS_TEN_WINS_AND_UNLOCKS');
 if(variantId==='tic_tac_toe'&&Object.entries(quotas).some(([count,n])=>Number(count)>1&&n>0))
  throw Error('EDITION_DUEL_ONE_WIN_MAX');
 if(variantId==='dog_jackpot_9'&&Object.entries(quotas).some(([count,n])=>
  Number(count)>0&&Number(count)!==8&&n>0))throw Error('EDITION_DOG_ONLY_EIGHT_OR_ZERO');
 const validCounts=variantId==='tic_tac_toe'?[0,1]:variantId==='dog_jackpot_9'?[0,8]:
  variantId==='premium_27'?[4,5,6,7,8,9,10]:
  Array.from({length:variantId==='number_one_20'?21:11},(_,i)=>i);
 for(const count of Object.keys(quotas))if(!validCounts.includes(Number(count)))
  throw Error('EDITION_UNSUPPORTED_WIN_COUNT_'+count);
 if(variantId==='premium_27'&&maxPrizesPerTicket<4)
  throw Error('EDITION_MINIMUM_FOUR_PREMIUM_WINS');
 if(Object.values(quotas).reduce((a,b)=>a+b,0)>printSize)
  throw Error(printSize===SCRATCH_PRINT_SIZE?'EDITION_QUOTAS_OVER_500':
   'EDITION_QUOTAS_OVER_PRINT_SIZE');
 return {variantId,tier:ticketTier(variantId),title,printSize,
  maxTotalCoins,maxPerTicketCoins,maxPrizesPerTicket,maxUnlocks,quotas,
  targetTotalCoins,targetTolerancePercent,premiumFull27Tickets,volatility,ticketPrice,symbolBudgets,doubleWin,
  gameSettings:gameSettings===null?null:structuredClone(gameSettings)};
}
/** Conservative mathematical lower bound: stochastic exhaustion is not proof. */
export function editionMinimumBudget(input,settings=null){
 const config=validateEditionConfig(input);
 const normalized=normalizeScratchSettings(settings);
 const amounts=['gifts','snow_collect','elf','premium_27'].includes(config.variantId)?
  (config.gameSettings?.coinAmounts??normalized.variants[config.variantId].coinAmounts):
  config.variantId==='number_one_20'?(config.gameSettings?.coinAmounts??normalized.numberOne20.coinAmounts):
  (config.gameSettings?.coinAmounts??(config.variantId==='tic_tac_toe'?[200,450,800]:[100,300,800]));
 const coinFloor=Math.min(...['coin','note','case'].map((id,i)=>
  config.symbolBudgets[id]?.min??amounts[i]));
 const baseWins=config.variantId==='premium_27'?4:0;
 const star=config.symbolBudgets.lights;
 const canHaveStar=Boolean(star&&star.chancePer1000>0&&star.maxTotal>=star.min);
 let mandatoryCoinWins=config.printSize*baseWins,optionalCoinWins=0;
 let singleTicketMinimum=baseWins*coinFloor;
 for(const [key,count] of Object.entries(config.quotas)){
  const wins=Number(key),freeStar=canHaveStar&&wins>baseWins?1:0;
  const unavoidable=Math.max(baseWins,wins-freeStar);
  optionalCoinWins+=Math.max(0,unavoidable-baseWins)*count;
  singleTicketMinimum=Math.max(singleTicketMinimum,
   Math.max(baseWins,unavoidable-config.maxUnlocks)*coinFloor);
 }
 mandatoryCoinWins+=Math.max(0,optionalCoinWins-config.maxUnlocks);
 const minimumCoins=mandatoryCoinWins*coinFloor;
 return {minimumCoins,minimumPerTicketCoins:singleTicketMinimum,coinFloor,
  availableCoins:config.maxTotalCoins,availablePerTicketCoins:config.maxPerTicketCoins,
  fixedTickets:Object.values(config.quotas).reduce((sum,n)=>sum+n,0)};
}
const prizeCount=result=>Array.isArray(result.winnings)?result.winnings.length:0;
const unlockCount=result=>Array.isArray(result.winnings)?
 result.winnings.filter(x=>x.type==='unlock').length:0;
const removeReceiptFields=result=>{
 const copy=structuredClone(result);
 for(const key of ['commandId','balance','at','price','free','voucher'])delete copy[key];
 return copy;
};
export const packEditionTickets=tickets=>gzipSync(Buffer.from(JSON.stringify(tickets),'utf8'),{level:9}).toString('base64');
export function unpackEditionTickets(packed,expectedSize=SCRATCH_PRINT_SIZE){
 const tickets=JSON.parse(gunzipSync(Buffer.from(packed,'base64')).toString('utf8'));
 if(!cleanInt(expectedSize,1,SCRATCH_PRINT_SIZE)||
  !Array.isArray(tickets)||tickets.length!==expectedSize)
  throw Error('EDITION_STORED_TICKETS_INVALID');
 return tickets;
}
export function planScratchEdition(input,settings,{draw=randomInt}={}){
 const config=validateEditionConfig(input);
 const snapshot=normalizeScratchSettings(settings);
 const floor=editionMinimumBudget(config,snapshot);
 if(floor.minimumCoins>config.maxTotalCoins)
  throw Error('EDITION_BUDGET_MIN_REQUIRED_'+floor.minimumCoins+'_AVAILABLE_'+config.maxTotalCoins);
 if(floor.minimumPerTicketCoins>config.maxPerTicketCoins)
  throw Error('EDITION_TICKET_MIN_REQUIRED_'+floor.minimumPerTicketCoins+'_AVAILABLE_'+config.maxPerTicketCoins);
 let editionSpecial=null;
 if(config.gameSettings){
  if(['gifts','snow_collect','elf','premium_27'].includes(config.variantId))
   snapshot.variants[config.variantId]=config.gameSettings;
  else if(config.variantId==='number_one_20')
   snapshot.numberOne20=config.gameSettings;
  else if(config.variantId==='tic_tac_toe')
   editionSpecial={ticTacToe:validateTicDuelEditionSettings(config.gameSettings)};
  else if(config.variantId==='dog_jackpot_9')
   editionSpecial={dogJackpot:validateDogJackpotEditionSettings(config.gameSettings)};
 }
 // Use the print-run prize cap for EVERY classical card. Up to three
 // base matches (four premium money rows) stay visible; additional awards
 // each reference an already verified match on the original grid.
 if(['gifts','snow_collect','elf','premium_27'].includes(config.variantId))
  snapshot.variants[config.variantId].maxPrizes=Math.max(
   snapshot.variants[config.variantId].maxPrizes,Math.min(10,config.maxPrizesPerTicket));
 const runSettings=validateScratchSettings(snapshot);
 const requested=[],reserved=new Set();
 let fullLeft=config.premiumFull27Tickets;
 for(const [count,value] of Object.entries(config.quotas)){
  for(let i=0;i<value;i++){
   const full=config.variantId==='premium_27'&&Number(count)===10&&fullLeft>0;
   if(full)fullLeft--;
   requested.push({wins:Number(count),full27:full});
  }
  reserved.add(Number(count));
 }
 while(fullLeft>0){requested.push({wins:10,full27:true});fullLeft--;reserved.add(10)}
 while(requested.length<config.printSize)requested.push({wins:'any',full27:false});
 // Reserve all expensive, explicit jackpot guarantees BEFORE the flexible
 // tickets; shuffle only at the end so the order cannot influence odds.
 requested.sort((a,b)=>Number(b.full27)-Number(a.full27)||
  (b.wins==='any'?-1:b.wins)-(a.wins==='any'?-1:a.wins));
 // Each free ticket receives a stable budget weight. The weights jointly
 // sum to the payout target; very small weights create legitimate duds,
 // high weights create rare ten-prize jackpots. Each follows the same
 // immutable original ticket rules and every real payout is checked.
 const variation=config.volatility/100;
 const payoutWeights=requested.map(rule=>{
  if(rule.wins!=='any')return 1;
  const dice=draw(1000);
  const band=dice<80?0.02:dice>=940?2.8+draw(2200)/1000:
   0.35+draw(1550)/1000;
  return (1-variation)+variation*band;
 });
 const suffixWeights=Array(requested.length+1).fill(0);
 for(let i=requested.length-1;i>=0;i--)
  suffixWeights[i]=suffixWeights[i+1]+payoutWeights[i];
 const tickets=[],byWins=Array(21).fill(0);
 const symbolTotals={coin:0,note:0,case:0,lights:0,gift:0};
 const symbolHitCounts={coin:0,note:0,case:0,lights:0,gift:0};
 let totalCoins=0,totalLights=0,unlocks=0,biggest=0,winners=0,full27Count=0;
 let doubleWinTickets=0,doubleExtraCoins=0,doubleExtraLights=0;
 const target=config.targetTotalCoins;
 const isClassic=['gifts','snow_collect','elf','premium_27'].includes(config.variantId);
 const amounts=isClassic?runSettings.variants[config.variantId].coinAmounts:
  config.variantId==='number_one_20'?runSettings.numberOne20.coinAmounts:
  config.variantId==='tic_tac_toe'?(editionSpecial?.ticTacToe?.coinAmounts??[200,450,800]):
  (editionSpecial?.dogJackpot?.coinAmounts??[100,300,800]);
 const meanWin=Math.max(1,Math.round((amounts[0]+amounts[1]+amounts[2])/3));
 const minWins=config.variantId==='premium_27'?4:0;
 const maxWins=Math.min(config.maxPrizesPerTicket,
  config.variantId==='tic_tac_toe'?1:config.variantId==='dog_jackpot_9'?8:
  config.variantId==='number_one_20'?20:10);
 const categoryFor=prize=>prize.type==='lights'?'lights':
  prize.type==='unlock'?'gift':
  prize.type==='coins'?({'🪙':'coin','💵':'note','💼':'case'}[prize.symbol]||'coin'):null;
 const categoryAmount=prize=>prize.type==='unlock'?1:(prize.amount||0);
 const amountsForCandidate=()=>{
  const cats=['coin','note','case'];
  for(let trial=0;trial<24;trial++){
   const picked=cats.map((id,i)=>{
    const range=config.symbolBudgets[id];
    return range?range.min+draw(range.max-range.min+1):amounts[i];
   });
   if(picked[0]<picked[1]&&picked[1]<picked[2])return picked;
  }
  // Deterministic fallback for narrow but legal winning ranges.
  const values=cats.map((id,i)=>config.symbolBudgets[id]?.min??amounts[i]);
  const upper=cats.map((id,i)=>config.symbolBudgets[id]?.max??amounts[i]);
  for(let i=1;i<values.length;i++)values[i]=Math.max(values[i],values[i-1]+1);
  if(values.every((n,i)=>n<=upper[i]))return values;
  throw Error('EDITION_SYMBOL_RANGES_OVERLAP');
 };
 const sampleTicket=(slot,attempt,forced,full27,applyDouble)=>{
  let useSettings=runSettings,useSpecial=editionSpecial;
  if(['coin','note','case'].some(id=>config.symbolBudgets[id])){
   const chosenAmounts=amountsForCandidate();
   useSettings=structuredClone(runSettings);
   if(isClassic)useSettings.variants[config.variantId].coinAmounts=chosenAmounts;
   else if(config.variantId==='number_one_20')useSettings.numberOne20.coinAmounts=chosenAmounts;
   else {
    useSpecial=structuredClone(editionSpecial??{});
    const id=config.variantId==='tic_tac_toe'?'ticTacToe':'dogJackpot';
    const fallback=useSpecial[id]??(id==='ticTacToe'?
     {coinAmounts:[200,450,800],symbolWeights:[700,250,40,10],
      maxMultiplier:5,giftFallbackCoins:1500}:
     {coinAmounts:[100,300,800],symbolWeights:[550,300,148,2],
      dogChancePer1000:350,giftFallbackCoins:1500});
    useSpecial[id]={...fallback,coinAmounts:chosenAmounts};
   }
  }
  // Exact win quotas on the 20-number ticket need a matching trial rate.
  // With its ordinary 10% row hit chance, eight wins at once would almost
  // never occur, even though the user may explicitly reserve such tickets.
  // Only preprinted quota candidates receive this per-board probability;
  // unreserved cards retain the host's chosen ordinary probability.
  if(config.variantId==='number_one_20'&&Number.isInteger(forced)&&forced>=0&&forced<=20){
   useSettings=structuredClone(useSettings);
   useSettings.numberOne20.hitPer1000=Math.round(forced*1000/20);
  }
  const printControl=isClassic?{
   disableRandomDouble:true,
   ...(forced===null?{}:{forcedWins:forced}),
   ...(config.variantId==='premium_27'?{
    forceFull27:full27,excludeFull27:!full27,
    forcePremiumUnlock:full27,
    forceNoPremiumMilestone:forced===4&&!full27
   }:{})
  }:(['number_one_20','dog_jackpot_9'].includes(config.variantId)&&Number.isInteger(forced)?
   {forcedWins:forced}:null);
  const sample=buyScratchTicket({coins:1000000000},null,{
   tier:config.tier,variantId:config.variantId,
   commandId:'ed_sample_'+slot+'_'+attempt
  },{settings:useSettings,editionSpecial:useSpecial,printControl,
   editionPrice:config.ticketPrice,draw,now:()=>1700000000000}).result;
  const lightRange=config.symbolBudgets.lights;
  if(lightRange&&sample.winnings.length<config.maxPrizesPerTicket&&
    draw(1000)<lightRange.chancePer1000){
   const maxAllowed=Math.min(lightRange.max,lightRange.maxTotal-symbolTotals.lights);
   if(maxAllowed>=lightRange.min){
    const amount=lightRange.min+draw(maxAllowed-lightRange.min+1);
    sample.winnings.push({type:'lights',symbol:'⭐',amount,bonus:true,lightField:true});
    sample.totalLights=amount;
    sample.lightBadgeIndex=draw(sample.board.cells.length);
    if(sample.type==='none')sample.type='lights';
   }
  }
  // A ×2 is an independent visible bonus, not a fake winning line.
  // Keep the original verified board untouched; only the printed receipt
  // and its payout are multiplied. This cannot create two unlocks.
  if(applyDouble){
   // The original board.wins[].prize objects are shared by some legacy
   // generators. Clone receipt prizes before the bonus, otherwise applying
   // ×2 would alter the independently verified original winning grid.
   sample.winnings=(sample.winnings||[]).map(prize=>({...prize}));
   const cash=sample.winnings.filter(p=>p.type==='coins');
   const stars=(sample.winnings||[]).filter(p=>p.type==='lights');
   if(cash.length||stars.length){
    const beforeCoins=sample.totalCoins||0,beforeLights=sample.totalLights||0;
    for(const prize of [...cash,...stars]){
     prize.baseAmount=prize.amount;
     prize.amount*=2;
     prize.x2=true;
    }
    sample.totalCoins=beforeCoins*2;
    sample.totalLights=beforeLights*2;
    sample.doubleWin={symbol:'✖️2',baseCoins:beforeCoins,extraCoins:beforeCoins,
     baseLights:beforeLights,extraLights:beforeLights};
    const matchingCells=[...new Set((sample.board?.wins||[]).flatMap(win=>
      Array.isArray(win.indices)?win.indices:[]))]
      .filter(index=>Number.isInteger(index)&&index>=0&&index<sample.board.cells.length);
    // For Tic-Tac-Toe the ✖️2 stamp sits on the actual winning Circle/Cross,
    // never an unrelated square; its original winning sign remains visible.
    sample.doubleBadgeIndex=matchingCells.length?
     matchingCells[draw(matchingCells.length)]:draw(sample.board.cells.length);
   }
  }
  return sample;
 };
 for(const [slot,rule] of requested.entries()){
  const remaining=config.printSize-slot;
  const requiredDouble=Math.max(0,config.doubleWin.minTickets-doubleWinTickets);
  const canDouble=doubleWinTickets<config.doubleWin.maxTickets;
  const forceDouble=requiredDouble>=remaining&&canDouble;
  const tryDouble=canDouble&&(forceDouble||draw(1000)<config.doubleWin.chancePer1000);
  const unspent=target===null?null:target-totalCoins;
  const pace=target===null?null:Math.max(0,unspent*payoutWeights[slot]/Math.max(0.00001,suffixWeights[slot]));
  let best=null,score=Infinity;
  // A fixed quota is EXACT. Flexible slots sample multiple legal tickets and
  // choose one that keeps the remaining 500-ticket budget on course.
  const tries=target===null?(!isClassic&&rule.wins!=='any'?550:160):
   rule.wins==='any'?13:10;
  // Fixed winner-count quotas are strict, but a failed random candidate is
  // not evidence that the requested card is impossible. Search further only
  // when the ordinary attempts cannot find an eligible ticket.
  const rescueTries=rule.wins!=='any'?(isClassic?360:120):0;
  for(let attempt=0;attempt<tries+rescueTries;attempt++){
   if(attempt===tries&&best)break;
   let forced=rule.wins==='any'?null:rule.wins;
   // In unconstrained remaining slots, prevent random early payouts from
   // exhausting the budget before all 500 genuine boards can be printed.
   // Reserve the legal zero-win board only when the user has not fixed that
   // count. Exact quotas are never changed by this safety fallback.
   if(forced===null&&target===null&&isClassic&&minWins===0&&
      !reserved.has(0)&&config.maxTotalCoins-totalCoins<
       remaining*meanWin*Math.min(maxWins,4))forced=0;
   if(forced===null&&target!==null&&isClassic){
    const variety=0.6+draw(101)/125; // roughly 0.60–1.40
    const desired=Math.round(pace*variety/meanWin);
    forced=Math.max(minWins,Math.min(maxWins,
      desired+(attempt%3===0?draw(3)-1:0)));
    if(reserved.has(forced)){
     const alternatives=Array.from({length:maxWins-minWins+1},(_,i)=>i+minWins)
      .filter(count=>!reserved.has(count));
     if(!alternatives.length)continue;
     forced=alternatives.reduce((a,b)=>Math.abs(a-desired)<=Math.abs(b-desired)?a:b);
    }
   }
   let sample;
   // Optional ×2 can push an otherwise legal ticket above an exact budget.
   // During rescue attempts, also test the normal payout; do not relax any
   // mandatory ×2 minimum or exact quota on the number of wins.
   const useDouble=tryDouble&&(forceDouble||attempt<tries||attempt%2===0);
   try{sample=sampleTicket(slot,attempt,forced,rule.full27,useDouble)}
   catch(e){if(/^SCRATCH_|^PREMIUM27_/.test(e.message))continue;throw e}
   if(forceDouble&&!sample.doubleWin)continue;
   const wins=prizeCount(sample),coins=sample.totalCoins||0,cosmetics=unlockCount(sample);
   const candidateTotals={coin:0,note:0,case:0,lights:0,gift:0};
   let outsideLimits=false;
   for(const prize of sample.winnings||[]){
    const id=categoryFor(prize);
    if(!id)continue;
    const range=config.symbolBudgets[id];
    if(range&&id!=='gift'&&
      (prize.amount<range.min||prize.amount>range.max)){outsideLimits=true;break;}
    candidateTotals[id]+=categoryAmount(prize);
   }
   const giftRange=config.symbolBudgets.gift;
   if(giftRange&&(candidateTotals.gift<giftRange.min||
     candidateTotals.gift>giftRange.max))outsideLimits=true;
   if(outsideLimits||Object.entries(config.symbolBudgets).some(([id,range])=>
     candidateTotals[id]+symbolTotals[id]>range.maxTotal))continue;
   const full=sample.board?.variantId==='premium_27'&&
    sample.board.cells.every(symbol=>symbol!=='🧊');
   if(wins>config.maxPrizesPerTicket||wins>20||coins>config.maxPerTicketCoins||
     totalCoins+coins>config.maxTotalCoins||unlocks+cosmetics>config.maxUnlocks)continue;
   if(full!==rule.full27&&config.variantId==='premium_27')continue;
   if(rule.wins==='any'&&reserved.has(wins))continue;
   if(rule.wins!=='any'&&wins!==rule.wins)continue;
   if(target===null){best=sample;break;}
   const after=unspent-coins;
   const feasibleNext=after<-(target*config.targetTolerancePercent/100)||
    after>(remaining-1)*config.maxPerTicketCoins+target*config.targetTolerancePercent/100;
   if(feasibleNext)continue;
   const jitter=(draw(101)-50)/100;
   const variantPenalty=attempt%4===0?0:Math.abs(coins-pace)*0.015;
   const objective=Math.abs(coins-pace)+variantPenalty+
    Math.abs(jitter)*Math.max(1,pace)*0.17;
   if(objective<score){score=objective;best=sample}
   if(score<Math.max(1,pace)*0.05)break;
  }
  if(!best)throw Error('EDITION_GENERATION_EXHAUSTED_SLOT_'+(slot+1)+
   '_WINS_'+rule.wins+'_BUDGET_'+(config.maxTotalCoins-totalCoins));
  const accepted=removeReceiptFields(best),count=prizeCount(accepted);
  byWins[count]++;totalCoins+=accepted.totalCoins||0;
  if(accepted.doubleWin){
   doubleWinTickets++;
   doubleExtraCoins+=accepted.doubleWin.extraCoins;
   doubleExtraLights+=accepted.doubleWin.extraLights;
  }
  for(const prize of accepted.winnings||[]){
   const id=categoryFor(prize);
   if(id){symbolTotals[id]+=categoryAmount(prize);symbolHitCounts[id]++}
  }
  totalLights=symbolTotals.lights;
  unlocks+=unlockCount(accepted);
  biggest=Math.max(biggest,accepted.totalCoins||0);
  if(count)winners++;
  if(config.variantId==='premium_27'&&accepted.board.cells.every(s=>s!=='🧊'))full27Count++;
  tickets.push(accepted);
 }
 if(doubleWinTickets<config.doubleWin.minTickets)
  throw Error('EDITION_DOUBLE_MIN_UNREACHABLE');
 if(target!==null&&Math.abs(totalCoins-target)>Math.max(1,target*config.targetTolerancePercent/100))
  throw Error('EDITION_TARGET_NOT_REACHED_'+totalCoins+'_OF_'+target);
 for(const [id,range] of Object.entries(config.symbolBudgets)){
  if(symbolTotals[id]<range.minTotal)
   throw Error('EDITION_SYMBOL_MIN_TOTAL_UNREACHABLE_'+id);
 }
 for(let i=tickets.length-1;i>0;i--){
  const j=draw(i+1);[tickets[i],tickets[j]]=[tickets[j],tickets[i]];
 }
 const grossRevenue=config.ticketPrice*config.printSize;
 const summary={tickets:config.printSize,winners,duds:config.printSize-winners,
  totalCoins,totalLights,symbolTotals,symbolHitCounts,unlocks,
  doubleWinTickets,doubleExtraCoins,doubleExtraLights,
  biggestTicketCoins:biggest,byWins,premiumFull27Tickets:full27Count,
  ticketPrice:config.ticketPrice,projectedGrossRevenue:grossRevenue,
  projectedNetCoins:grossRevenue-totalCoins,
  payoutRatioPercent:grossRevenue>0?Math.round(totalCoins/grossRevenue*10000)/100:null,
  targetTotalCoins:target,deltaToTarget:target===null?null:totalCoins-target,
  targetDifferencePercent:target>0?Math.round(Math.abs(totalCoins-target)/target*10000)/100:0,
  expectedAverageCoins:Math.round(totalCoins/config.printSize),
  remainingBudget:config.maxTotalCoins-totalCoins};
 const packed=packEditionTickets(tickets);
 if(Buffer.byteLength(packed,'utf8')>750000)throw Error('EDITION_DOCUMENT_TOO_LARGE');
 return {config,summary,packed,packedBytes:packed.length,
  settingsSnapshot:runSettings,specialSnapshot:editionSpecial};
}

export function newEditionDocument(plan,creator,now=Date.now()){
 return {version:1,id:plan.config.variantId+'_'+now+'_'+randomUUID().slice(0,8),
  variantId:plan.config.variantId,tier:plan.config.tier,title:plan.config.title,
  config:plan.config,summary:plan.summary,packed:plan.packed,
  settingsSnapshot:plan.settingsSnapshot,specialSnapshot:plan.specialSnapshot,
  issued:0,issuedCoins:0,issuedLights:0,issuedUnlocks:0,createdAt:now,createdBy:creator,
  status:'active',updatedAt:now};
}
export function editionPublic(doc){
 if(!doc)return null;
 return {id:doc.id,variantId:doc.variantId,title:doc.title,
  config:doc.config,summary:doc.summary,
  issued:doc.issued||0,remaining:(doc.config?.printSize??SCRATCH_PRINT_SIZE)-(doc.issued||0),
  issuedCoins:doc.issuedCoins||0,issuedLights:doc.issuedLights||0,
  issuedUnlocks:doc.issuedUnlocks||0,
  createdAt:doc.createdAt,status:doc.status};
}
const availableUnlocks=(tier,owned)=>
 (tier==='premium'?DOG_SCRATCH_PREMIUM_POOL:tier==='medium'?DOG_SCRATCH_MEDIUM_POOL:
 [...DOG_SCRATCH_BASIC_EMOJIS,...DOG_SCRATCH_BLOCK_COLORS])
 .filter(p=>!owned.has(p.unlockId));
function personalizeTemplate(template,rawWallet,tree,tier){
 const result=structuredClone(template);
 const wallet=normalizedScratchWallet(rawWallet);
 const owned=new Set([...Object.keys(wallet.owned),
  ...Object.values(tree?.claims||{}).map(p=>p?.unlockId).filter(Boolean)]);
 const substitutions=new Map();
 for(const entry of result.winnings||[]){
  if(entry.type!=='unlock')continue;
  const old=entry.prize?.unlockId;
  if(!old)throw Error('EDITION_UNLOCK_INVALID');
  if(substitutions.has(old))continue;
  const candidates=availableUnlocks(tier,owned);
  const chosen=candidates.find(p=>p.unlockId===old)||candidates[0];
  if(!chosen)return null; // this printed ticket cannot be redeemed by this user
  owned.add(chosen.unlockId);
  substitutions.set(old,{unlockId:chosen.unlockId,name:chosen.name,
   category:chosen.category,icon:chosen.icon});
 }
 const remap=entry=>{
  if(entry?.type==='unlock'&&substitutions.has(entry.prize?.unlockId))
   entry.prize={...substitutions.get(entry.prize.unlockId)};
 };
 for(const win of result.winnings||[])remap(win);
 for(const win of result.board?.wins||[])remap(win.prize);
 if(result.type==='unlock'&&result.prize?.unlockId)
  result.prize={...substitutions.get(result.prize.unlockId)};
 return result;
}
export function issueEditionTicket(doc,rawWallet,tree,request,{settings,now=Date.now,discountPercent=0}={}){
 const size=doc?.config?.printSize??SCRATCH_PRINT_SIZE;
 if(!cleanInt(size,1,SCRATCH_PRINT_SIZE)||doc?.status!=='active'||!cleanInt(doc.issued,0,size))
  throw Error('EDITION_INVALID_STATE');
 if(doc.variantId!==request.variantId||doc.tier!==request.tier)
  throw Error('EDITION_WRONG_VARIANT');
 const original=normalizedScratchWallet(rawWallet);
 const replay=original.recent.find(r=>r.commandId===request.commandId);
 if(replay)return {unchanged:true,doc,wallet:original,result:replay.result,
  status:dogScratchStatus(original,tree,now(),settings)};
 if(doc.issued===size)throw Error('EDITION_SOLD_OUT');
 const tickets=unpackEditionTickets(doc.packed,size);
 let chosenIndex=-1,template=null;
 for(let i=doc.issued;i<size;i++){
  const candidate=personalizeTemplate(tickets[i],rawWallet,tree,doc.tier);
  if(candidate){template=candidate;chosenIndex=i;break;}
 }
 if(!template)throw Error('EDITION_NO_AVAILABLE_UNLOCK');
 // This calls the existing wallet engine to enforce exact payment, the free
 // daily limit, voucher redemption, and receipt idempotency.
 const purchase=buyScratchTicket(rawWallet,tree,request,
  {settings:doc.settingsSnapshot??settings,editionSpecial:doc.specialSnapshot??null,
   editionPrice:doc.config?.ticketPrice??null,discountPercent,now});
 if(purchase.unchanged)return {unchanged:true,doc,wallet:purchase.wallet,
  result:purchase.result,status:purchase.status};
 const wallet=purchase.wallet,result=template;
 const price=purchase.result.price;
 Object.assign(result,{commandId:request.commandId,at:now(),price,
  free:purchase.result.free,voucher:purchase.result.voucher,
  balance:Math.min(1000000000,original.coins-price+(result.totalCoins||0))});
 wallet.coins=result.balance;
 wallet.owned={...original.owned};
 for(const win of result.winnings||[])if(win.type==='unlock')
  wallet.owned[win.prize.unlockId]=result.at;
 wallet.progress=structuredClone(original.progress);
 addScratchProgress(wallet.progress,result);
 const oldVoucher=purchase.result.giftVoucherEarned||0;
 const sparks=original.giftSparks+(result.giftSparksEarned||0);
 const newVoucher=Math.floor(sparks/5);
 wallet.giftSparks=sparks%5;
 wallet.variantVouchers.tic_tac_toe=Math.min(10000,Math.max(0,
  wallet.variantVouchers.tic_tac_toe-oldVoucher+newVoucher));
 result.giftVoucherEarned=newVoucher;
 wallet.lastResult=result;
 wallet.recent=[...original.recent,{commandId:request.commandId,result}].slice(-40);
 if(chosenIndex!==doc.issued)[tickets[doc.issued],tickets[chosenIndex]]=
  [tickets[chosenIndex],tickets[doc.issued]];
 const updated={...doc,issued:doc.issued+1,
  issuedCoins:(doc.issuedCoins||0)+(result.totalCoins||0),
  issuedLights:(doc.issuedLights||0)+(result.totalLights||0),
  issuedUnlocks:(doc.issuedUnlocks||0)+unlockCount(result),
  packed:chosenIndex===doc.issued?doc.packed:packEditionTickets(tickets),
  updatedAt:now()};
 const printable={...result,editionId:doc.id,editionSerial:updated.issued};
 wallet.lastResult=printable;
 wallet.recent[wallet.recent.length-1].result=printable;
 return {unchanged:false,doc:updated,wallet,result:printable,
  status:dogScratchStatus(wallet,tree,now(),settings)};
}
