/** Server-authoritative tactical boss challenges.
 * New v2: three different eight-second minigames in a 30-second fight.
 * Every sub-action uses a separate idempotent transaction receipt.
 * v1 encounters remain loadable and finishable without changing their rules.
 */
import {randomInt} from 'node:crypto';
export const DOG_MINIGAME_KINDS=Object.freeze(['dodge','reaction','math','target']);
export const DOG_MINIGAME_WINDOWS=Object.freeze([
 Object.freeze({startMs:3000,endMs:11000}),
 Object.freeze({startMs:11000,endMs:19000}),
 Object.freeze({startMs:19000,endMs:27000})
]);
export const DOG_EXCHANGE_WINDOWS=Object.freeze([
 Object.freeze({startMs:0,endMs:8000}),
 Object.freeze({startMs:10000,endMs:18000}),
 Object.freeze({startMs:20000,endMs:28000}),
 Object.freeze({startMs:30000,endMs:38000})
]);
export const DOG_CINEMATIC_WINDOWS=Object.freeze([
 Object.freeze({startMs:0,endMs:8000}),
 Object.freeze({startMs:12500,endMs:20500}),
 Object.freeze({startMs:25000,endMs:33000}),
 Object.freeze({startMs:37500,endMs:45500})
]);
/* v5: 60s, v6: 64s, v7: 92s, v8: 99s, v9: precise narrow Konter, v10: color/symbol sprint 101s.
 * All persisted earlier versions retain their original windows.
 */
export const DOG_ENDGAME_WINDOWS=Object.freeze([
 Object.freeze({startMs:0,endMs:8000}),
 Object.freeze({startMs:15000,endMs:23000}),
 Object.freeze({startMs:30000,endMs:38000}),
 Object.freeze({startMs:45000,endMs:53000})
]);
// +4 seconds apply only to mathematics; every other activity and cinematic
// keeps its exact length. Stored v5 encounters still use DOG_ENDGAME_WINDOWS.
export const DOG_EXTENDED_ENDGAME_WINDOWS=Object.freeze([
 Object.freeze({startMs:0,endMs:12000}),
 Object.freeze({startMs:19000,endMs:27000}),
 Object.freeze({startMs:34000,endMs:42000}),
 Object.freeze({startMs:49000,endMs:57000})
]);
// New synchronized show: 12 seconds maths + 3×8s games + 4×14s scenes.
// v6 retains the old 7s scenes when loading a preexisting encounter.
export const DOG_SHOW_ENDGAME_WINDOWS=Object.freeze([
 Object.freeze({startMs:0,endMs:12000}),
 Object.freeze({startMs:26000,endMs:34000}),
 Object.freeze({startMs:48000,endMs:56000}),
 Object.freeze({startMs:70000,endMs:78000})
]);
// v8: each of the three dodge strikes now has 5s (instead of 2.67s).
// Each strike telegraphs for 3.3s, followed by ~1.7s impact/recovery.
// Four cinematic intervals remain exactly 14s each.
export const DOG_SLOW_DODGE_ENDGAME_WINDOWS=Object.freeze([
 Object.freeze({startMs:0,endMs:12000}),
 Object.freeze({startMs:26000,endMs:41000}),
 Object.freeze({startMs:55000,endMs:63000}),
 Object.freeze({startMs:77000,endMs:85000})
]);
export const DOG_COLOR_TARGET_ENDGAME_WINDOWS=Object.freeze([
 Object.freeze({startMs:0,endMs:12000}),
 Object.freeze({startMs:26000,endMs:41000}),
 Object.freeze({startMs:55000,endMs:65000}),
 Object.freeze({startMs:79000,endMs:87000})
]);
const DOG_EXCHANGE_ORDER=Object.freeze(['math','dodge','target','reaction']);
export const DOG_TARGET_COLORS=Object.freeze(['red','blue','green','yellow','purple','orange','cyan','pink']);
export const DOG_TARGET_SYMBOLS=Object.freeze(['star','shield','flame','diamond','snowflake','moon','crown','bolt']);
const DOG_TARGET_LABELS=Object.freeze({
 colors:Object.freeze({red:'Rot',blue:'Blau',green:'Grün',yellow:'Gelb',
  purple:'Lila',orange:'Orange',cyan:'Türkis',pink:'Pink'}),
 symbols:Object.freeze({star:'Stern',shield:'Schild',flame:'Flamme',
  diamond:'Diamant',snowflake:'Schneeflocke',moon:'Mond',crown:'Krone',bolt:'Blitz'})
});
const shuffle=(values,rand)=>{
 const arr=[...values];for(let i=arr.length-1;i>0;i--){
  const j=draw(rand,i+1);[arr[i],arr[j]]=[arr[j],arr[i]];
 }return arr;
};
const colorPuzzle=(tier,rand,step)=>{
 const mode=tier<=3?(step%2?'symbol':'color'):'both';
 const count=tier<=3?4:tier<=6?6:8;
 const targetColor=DOG_TARGET_COLORS[draw(rand,DOG_TARGET_COLORS.length)];
 const targetSymbol=DOG_TARGET_SYMBOLS[draw(rand,DOG_TARGET_SYMBOLS.length)];
 let options;
 if(mode==='color'){
  options=shuffle([targetColor,...shuffle(DOG_TARGET_COLORS.filter(c=>c!==targetColor),rand).slice(0,count-1)],rand)
   .map(color=>({color,symbol:DOG_TARGET_SYMBOLS[draw(rand,DOG_TARGET_SYMBOLS.length)]}));
 }else if(mode==='symbol'){
  options=shuffle([targetSymbol,...shuffle(DOG_TARGET_SYMBOLS.filter(c=>c!==targetSymbol),rand).slice(0,count-1)],rand)
   .map(symbol=>({color:DOG_TARGET_COLORS[draw(rand,DOG_TARGET_COLORS.length)],symbol}));
 }else{
  const sameColor=shuffle(DOG_TARGET_SYMBOLS.filter(x=>x!==targetSymbol),rand)[0];
  const sameSymbol=shuffle(DOG_TARGET_COLORS.filter(x=>x!==targetColor),rand)[0];
  const all=DOG_TARGET_COLORS.flatMap(color=>DOG_TARGET_SYMBOLS.map(symbol=>({color,symbol})));
  const used=new Set([targetColor+'-'+targetSymbol,targetColor+'-'+sameColor,sameSymbol+'-'+targetSymbol]);
  const wrong=shuffle(all.filter(o=>!used.has(o.color+'-'+o.symbol)),rand);
  options=shuffle([{color:targetColor,symbol:targetSymbol},
   {color:targetColor,symbol:sameColor},{color:sameSymbol,symbol:targetSymbol},
   ...wrong.slice(0,count-3)],rand);
 }
 const correctIndex=options.findIndex(o=>mode==='color'?o.color===targetColor:
  mode==='symbol'?o.symbol===targetSymbol:o.color===targetColor&&o.symbol===targetSymbol);
 return {mode,targetColor,targetSymbol,options,correctIndex,
  prompt:mode==='color'?'TRIFF '+DOG_TARGET_LABELS.colors[targetColor].toUpperCase()+'!':
   mode==='symbol'?'TRIFF '+DOG_TARGET_LABELS.symbols[targetSymbol].toUpperCase()+'!':
    'TRIFF '+DOG_TARGET_LABELS.colors[targetColor].toUpperCase()+' + '+
     DOG_TARGET_LABELS.symbols[targetSymbol].toUpperCase()+'!'};
};
const LEGACY_WINDOWS=[{startMs:3000,endMs:10000},
 {startMs:10000,endMs:17000},{startMs:17000,endMs:24000}];
const TYPES={math:8,dodge:3,reaction:3,target:3};
const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const uidOkay=x=>typeof x==='string'&&x.length>0&&x.length<=200;
const int=(n,lo,hi,def=lo)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi?n:def;
const draw=(rand,max)=>{
 const n=rand(max);
 if(!Number.isSafeInteger(n)||n<0||n>=max)throw Error('DOG_MINIGAME_BAD_RANDOM');
 return n;
};
export const dogMiniDifficulty=gate=>{
 if(!Number.isSafeInteger(gate)||gate<10||gate>100||gate%10!==0)
  throw Error('DOG_MINIGAME_BAD_GATE');
 const tier=gate/10;
 return Object.freeze({tier,choices:tier>=6?3:2,
  reactionToleranceMs:Math.max(400,790-tier*39),
  targetStepMs:Math.max(530,1300-tier*75),
  mathTier:tier>=9?4:tier>=7?3:tier>=4?2:1});
};
/** Eight deliberately progressive challenges.
 * The step is part of the server-stored puzzle (never inferred from client
 * choices); higher gates scale operands, but every new item has a stronger
 * arithmetic demand than the previous one.
 * Results are nonnegative, integral and within the 0–2000 answer contract.
 */
const mathPuzzle=(difficulty,rand,step=0)=>{
 const {tier}=difficulty;
 let answer,question;
 if(step===0){
  const a=3+draw(rand,5+tier),b=2+draw(rand,6+tier);
  answer=a+b;question=a+' + '+b+' = ?';
 }else if(step===1){
  const a=14+tier*2+draw(rand,17),b=9+draw(rand,14+tier);
  answer=a+b;question=a+' + '+b+' = ?';
 }else if(step===2){
  const a=31+tier*3+draw(rand,24),b=8+draw(rand,13+tier);
  answer=a-b;question=a+' − '+b+' = ?';
 }else if(step===3){
  const a=3+Math.floor(tier/3)+draw(rand,5),b=4+draw(rand,5+Math.floor(tier/3));
  answer=a*b;question=a+' × '+b+' = ?';
 }else if(step===4){
  const divisor=3+draw(rand,6),quotient=6+Math.floor(tier/2)+draw(rand,8);
  answer=quotient;question=(divisor*quotient)+' ÷ '+divisor+' = ?';
 }else if(step===5){
  const a=5+Math.floor(tier/2)+draw(rand,6),b=4+draw(rand,6);
  const c=6+draw(rand,12+tier);
  answer=a*b+c;question=a+' × '+b+' + '+c+' = ?';
 }else if(step===6){
  const a=7+Math.floor(tier/2)+draw(rand,9),b=4+draw(rand,9);
  const c=3+draw(rand,5);
  answer=(a+b)*c;question='('+a+' + '+b+') × '+c+' = ?';
 }else{
  const a=9+Math.floor(tier/2)+draw(rand,10),b=6+draw(rand,7);
  const divisor=2+draw(rand,5);
  // Construct the offset so the final division is always exact.
  const c=(divisor-(a*b)%divisor)%divisor+divisor*(2+draw(rand,4));
  answer=(a*b+c)/divisor;
  question='('+a+' × '+b+' + '+c+') ÷ '+divisor+' = ?';
 }
 const delta=2+step+draw(rand,4+Math.floor(tier/3));
 const lower=answer-delta>=0?answer-delta:answer+delta*2;
 const wrong=[lower,answer+delta].sort((x,y)=>x-y);
 const correctIndex=draw(rand,3);
 const options=Array.from({length:3},(_,i)=>{
  if(i===correctIndex)return answer;
  return wrong[i<correctIndex?i:i-1];
 });
 return {question,options,correctIndex};
};
function createRound(kind,round,gate,rand,windows=DOG_MINIGAME_WINDOWS,{colorTarget=false}={}){
 const {startMs,endMs}=windows[round],d=dogMiniDifficulty(gate);
 const base={kind,round,startMs,endMs,difficulty:d.tier,
  maxSteps:TYPES[kind]};
 if(kind==='math'){
  return {...base,puzzles:Array.from({length:8},(_,step)=>mathPuzzle(d,rand,step)),
   hint:(endMs-startMs===12000?'Zwölf':'Acht')+' Sekunden: Löse so viele Aufgaben wie möglich!'};
 }
 if(kind==='dodge'){
  const attacks=Array.from({length:3},(_,step)=>{
   const dangerIndex=draw(rand,d.choices);
   const phaseMs=endMs-startMs;
   return {step,startMs:startMs+Math.floor(step*phaseMs/3),
    impactMs:startMs+Math.floor((step+0.66)*phaseMs/3),
    dangerIndex,secondDangerIndex:d.choices===3?
     (dangerIndex+1+draw(rand,2))%3:null};
  });
  return {...base,lanes:d.choices,attacks,
   hint:'Drei Einschläge! Weiche vor jedem Schlag in ein sicheres Feld aus.'};
 }
 if(kind==='target'&&colorTarget)return {...base,maxSteps:10,
  puzzles:Array.from({length:10},(_,step)=>colorPuzzle(d.tier,rand,step)),
  hint:'10 Sekunden · Bis zu zehn Farb-/Symbol-Treffer · Tippe so schnell du kannst!'};
 if(kind==='reaction')return {...base,
  zoneRadius:Math.round((.12-d.tier*.005)*1000)/1000,
  hint:'Triff dreimal die grüne Zone. Der Zeiger wird ständig schneller!'};
 return {...base,lanes:d.tier>=8?5:d.tier>=4?4:3,
  initialIndex:draw(rand,d.tier>=8?5:d.tier>=4?4:3),
  stepMs:d.targetStepMs,hint:'Treffe drei wandernde Schwachpunkte!'};
}
export function dogCreateMiniGames(gate,rand=randomInt,{exchange=false}={}){
 if(exchange){
  // v11: same synchronized 101s game, new personal defensive LP calculation.
  const individual=exchange==='individual';
  const endgame=exchange==='endgame'||individual,cinematic=exchange==='cinematic';
  return {version:individual?11:endgame?10:cinematic?4:3,gate,rounds:DOG_EXCHANGE_ORDER.map((kind,i)=>{
   const item=createRound(kind,i,gate,rand,endgame?DOG_COLOR_TARGET_ENDGAME_WINDOWS:
    cinematic?DOG_CINEMATIC_WINDOWS:DOG_EXCHANGE_WINDOWS,{colorTarget:endgame&&kind==='target'});
   if(endgame&&kind==='reaction'){
    const tier=dogMiniDifficulty(gate).tier;
    return {...item,zoneRadius:Math.round((.061-tier*.0027)*1000)/1000,
     hint:'Konter: Triff die schmale grüne Zone dreimal ganz genau!'};
   }
   return item;
  }),answers:{}};
 }
 const available=[...DOG_MINIGAME_KINDS];
 for(let i=available.length-1;i>0;i--){
  const j=draw(rand,i+1);[available[i],available[j]]=[available[j],available[i]];
 }
 return {version:2,gate,rounds:available.slice(0,3)
  .map((kind,i)=>createRound(kind,i,gate,rand)),answers:{}};
}
function normalizeV1Round(round,i,gate){
 const fixed=LEGACY_WINDOWS[i],d=dogMiniDifficulty(gate);
 const base={kind:round.kind,round:i,startMs:fixed.startMs,endMs:fixed.endMs,
  difficulty:d.tier,hint:String(round.hint||'').slice(0,120)};
 if(round.kind==='dodge'){
  const lanes=int(round.lanes,2,3,2),dangerIndex=int(round.dangerIndex,0,lanes-1,0);
  const other=int(round.secondDangerIndex,0,lanes-1,-1);
  return {...base,lanes,dangerIndex,
   secondDangerIndex:lanes===3&&other!==dangerIndex?other:null};
 }
 if(round.kind==='reaction')return {...base,targetMs:int(round.targetMs,
  fixed.startMs+2500,fixed.startMs+4500,fixed.startMs+3000),
  toleranceMs:d.reactionToleranceMs};
 if(round.kind==='target'){
  const lanes=int(round.lanes,3,5,3);
  return {...base,lanes,
   initialIndex:int(round.initialIndex,0,lanes-1,0),stepMs:d.targetStepMs};
 }
 const options=Array.isArray(round.options)&&round.options.length===3?
  round.options.map(n=>int(n,0,2000,0)):[0,1,2];
 return {...base,question:String(round.question||'').slice(0,60),
  options,correctIndex:int(round.correctIndex,0,2,0)};
}
function normalizeV2Round(round,i,gate,windows=DOG_MINIGAME_WINDOWS,rawVersion=2){
 const fixed=windows[i],d=dogMiniDifficulty(gate);
 const base={kind:round.kind,round:i,startMs:fixed.startMs,endMs:fixed.endMs,
  difficulty:d.tier,maxSteps:TYPES[round.kind],hint:String(round.hint||'').slice(0,120)};
 if(round.kind==='math'){
  if(!Array.isArray(round.puzzles)||round.puzzles.length!==8)return null;
  const puzzles=round.puzzles.map(p=>{
   if(!Array.isArray(p?.options)||p.options.length!==3)return null;
   return {question:String(p.question||'').slice(0,60),
    options:p.options.map(v=>int(v,0,2000,0)),
    correctIndex:int(p.correctIndex,0,2,0)};
  });
  return puzzles.some(p=>!p)?null:{...base,puzzles};
 }
 if(round.kind==='dodge'){
  const lanes=d.choices;
  if(!Array.isArray(round.attacks)||round.attacks.length!==3)return null;
  const attacks=round.attacks.map((attack,step)=>{
   const phaseMs=fixed.endMs-fixed.startMs;
   const startMs=fixed.startMs+Math.floor(step*phaseMs/3);
   const impactMs=fixed.startMs+Math.floor((step+.66)*phaseMs/3);
   const dangerIndex=int(attack?.dangerIndex,0,lanes-1,0);
   const second=int(attack?.secondDangerIndex,0,lanes-1,-1);
   return {step,startMs,impactMs,dangerIndex,secondDangerIndex:
    lanes===3&&second!==dangerIndex?second:null};
  });
  return {...base,lanes,attacks};
 }
 if(round.kind==='reaction')return {...base,
  zoneRadius:rawVersion>=9?Math.round((.061-d.tier*.0027)*1000)/1000:
   Math.round((.12-d.tier*.005)*1000)/1000};
 if(round.kind==='target'&&rawVersion>=10){
  if(!Array.isArray(round.puzzles)||round.puzzles.length!==10)return null;
  const size=d.tier<=3?4:d.tier<=6?6:8;
  const puzzles=round.puzzles.map((p,step)=>{
   const mode=p?.mode;
   if(!['color','symbol','both'].includes(mode)||
     !DOG_TARGET_COLORS.includes(p.targetColor)||
     !DOG_TARGET_SYMBOLS.includes(p.targetSymbol)||
     !Array.isArray(p.options)||p.options.length!==size)return null;
   if((d.tier>=4&&mode!=='both')||
     (d.tier<=3&&mode!==(step%2?'symbol':'color')))return null;
   const options=p.options.map(o=>({color:o?.color,symbol:o?.symbol}));
   if(options.some(o=>!DOG_TARGET_COLORS.includes(o.color)||
      !DOG_TARGET_SYMBOLS.includes(o.symbol)))return null;
   const matches=options.map(o=>mode==='color'?o.color===p.targetColor:
    mode==='symbol'?o.symbol===p.targetSymbol:
     o.color===p.targetColor&&o.symbol===p.targetSymbol);
   if(matches.filter(Boolean).length!==1||
     new Set(options.map(o=>o.color+'|'+o.symbol)).size!==size)return null;
   return {mode,targetColor:p.targetColor,targetSymbol:p.targetSymbol,
    options,correctIndex:matches.indexOf(true),
    prompt:mode==='color'?'TRIFF '+DOG_TARGET_LABELS.colors[p.targetColor].toUpperCase()+'!':
     mode==='symbol'?'TRIFF '+DOG_TARGET_LABELS.symbols[p.targetSymbol].toUpperCase()+'!':
      'TRIFF '+DOG_TARGET_LABELS.colors[p.targetColor].toUpperCase()+' + '+
       DOG_TARGET_LABELS.symbols[p.targetSymbol].toUpperCase()+'!'};
  });
  return puzzles.some(p=>!p)?null:{...base,maxSteps:10,puzzles};
 }
 return {...base,lanes:int(round.lanes,3,5,3),
  initialIndex:int(round.initialIndex,0,4,0),stepMs:d.targetStepMs};
}
export function dogNormalizeMiniGames(raw){
 if(!isObj(raw)||![1,2,3,4,5,6,7,8,9,10,11].includes(raw.version)||
  !Array.isArray(raw.rounds)||raw.rounds.length!==(raw.version>=3?4:3)||
  !Number.isSafeInteger(raw.gate))return null;
 if(raw.gate<10||raw.gate>100||raw.gate%10!==0)return null;
 const windows=raw.version===1?LEGACY_WINDOWS:
  raw.version===3?DOG_EXCHANGE_WINDOWS:
  raw.version===4?DOG_CINEMATIC_WINDOWS:
   raw.version===5?DOG_ENDGAME_WINDOWS:
   raw.version===6?DOG_EXTENDED_ENDGAME_WINDOWS:
    raw.version===7?DOG_SHOW_ENDGAME_WINDOWS:
     raw.version>=10?DOG_COLOR_TARGET_ENDGAME_WINDOWS:
      raw.version>=8?DOG_SLOW_DODGE_ENDGAME_WINDOWS:DOG_MINIGAME_WINDOWS;
 const rounds=raw.rounds.map((round,i)=>{
  if(!DOG_MINIGAME_KINDS.includes(round?.kind)||round.round!==i||
   (raw.version>=3&&round.kind!==DOG_EXCHANGE_ORDER[i])||
   round.startMs!==windows[i].startMs||
   round.endMs!==windows[i].endMs)return null;
  return raw.version===1?normalizeV1Round(round,i,raw.gate):
   normalizeV2Round(round,i,raw.gate,windows,raw.version);
 });
 if(rounds.some(x=>!x)||new Set(rounds.map(x=>x.kind)).size!==rounds.length)return null;
 const answers={};
 if(isObj(raw.answers))for(const [uid,records] of Object.entries(raw.answers).slice(0,3)){
  if(!uidOkay(uid)||!isObj(records))continue;
  answers[uid]={};
  for(let i=0;i<rounds.length;i++){
   const answer=records[i];
   if(raw.version===1){
    if(answer?.correct===true||answer?.correct===false)
     answers[uid][i]={correct:answer.correct,at:int(answer.at,0,10_000_000_000_000,0)};
    continue;
   }
   if(!isObj(answer)||!Array.isArray(answer.attempts))continue;
   const allowed=rounds[i].maxSteps,attempts=[];
   for(const item of answer.attempts.slice(0,allowed)){
    if(!Number.isInteger(item?.step)||item.step!==attempts.length||
     typeof item.correct!=='boolean')break;
    attempts.push({step:item.step,correct:item.correct,
     at:int(item.at,0,10_000_000_000_000,0),
     ...(rounds[i].kind==='dodge'&&Number.isInteger(item.choice)&&
      item.choice>=0&&item.choice<rounds[i].lanes?{choice:item.choice}:{})});
   }
   if(attempts.length)answers[uid][i]={
    attempts,correct:attempts.some(a=>a.correct),
    at:attempts[attempts.length-1].at,
    correctCount:attempts.filter(a=>a.correct).length};
  }
 }
 return {version:raw.version,gate:raw.gate,rounds,answers};
}
export function dogMiniTargetIndex(round,relativeMs){
 const ticks=Math.max(0,Math.floor((relativeMs-round.startMs)/round.stepMs));
 return (round.initialIndex+ticks)%round.lanes;
}
/** Triangular cursor, with frequency continuously increasing (derivative
 * rises throughout the eight seconds), no client randomness or trust. */
export function dogMiniReactionPosition(round,relativeMs){
 const t=Math.max(0,Math.min(8,(relativeMs-round.startMs)/1000));
 const cycles=.68*t+(.075+.004*(round.difficulty||1))*t*t;
 return 1-Math.abs(1-(cycles%2));
}
/** Bounded network-jitter allowance: judge the last 180 ms of a
 * synchronized SERVER timeline, never a client-provided success flag or
 * timestamp. The reaction pointer still accelerates continuously. */
export function dogMiniReactionValid(round,elapsed){
 if(elapsed<round.startMs||elapsed>=round.endMs)return false;
 for(let transferMs=0;transferMs<=180;transferMs+=15){
  const evaluatedAt=elapsed-transferMs;
  if(evaluatedAt<round.startMs)break;
  if(Math.abs(dogMiniReactionPosition(round,evaluatedAt)-.5)<=round.zoneRadius)
   return true;
 }
 return false;
}
export function dogPublicMiniGames(raw,uid){
 const games=dogNormalizeMiniGames(raw);
 if(!games)return null;
 return {version:games.version,gate:games.gate,
  rounds:games.rounds.map(round=>{
   if(games.version===1){const {correctIndex,...publicFields}=round;return publicFields;}
   if(round.kind==='math'||(games.version>=10&&round.kind==='target'))return {...round,
    puzzles:round.puzzles.map(({correctIndex,...p})=>p)};
   return {...round};
  }),
  dodgeActions:games.rounds.filter(round=>round.kind==='dodge').flatMap(round=>
   Object.entries(games.answers).flatMap(([actor,records])=>
    (records[round.round]?.attempts||[]).filter(a=>
     Number.isInteger(a.choice)&&a.choice>=0&&a.choice<round.lanes).map(a=>({
      uid:actor,round:round.round,step:a.step,choice:a.choice,
      correct:a.correct,at:a.at
     })))),
  myAnswers:games.answers[uid]||{},
  completedBy:Object.fromEntries(Object.entries(games.answers).map(([id,answers])=>
   [id,Object.keys(answers).length]))};
}
export function dogMiniStrongRoundCount(raw,uid){
 const games=dogNormalizeMiniGames(raw);if(!games)return 0;
 if(games.version===1)return Object.values(games.answers[uid]||{})
  .filter(a=>a.correct).length;
 return games.rounds.filter(r=>{
  const attempts=games.answers[uid]?.[r.round]?.attempts||[];
  return attempts.filter(a=>a.correct).length>=Math.ceil(r.maxSteps*2/3);
 }).length;
}
export function dogMiniBonus(raw,uid){
 const games=dogNormalizeMiniGames(raw);if(!games)return 0;
 if(games.version===1)return Math.min(.10,
  Object.values(games.answers[uid]||{}).filter(a=>a.correct).length/3*.10);
 const weights=games.version>=3?{math:.06,dodge:0,reaction:0,target:.03}:
  {math:.06,dodge:.02,reaction:.04,target:.03};
 return Math.min(.15,games.rounds.reduce((score,round)=>{
  const count=(games.answers[uid]?.[round.round]?.attempts||[]).filter(a=>a.correct).length;
  return score+weights[round.kind]*Math.min(1,count/round.maxSteps);
 },0));
}
/** Missing or failed dodges have an actual defensive penalty (max 7.5 %).
 * A perfect triple dodge avoids this entirely. */
/** Shared team shield, visible only in the four-round boss exchange.
 * Each defensive scene can cost up to 25 points, based on verified dodges
 * or reaction counters. Initial value 100, absolute floor 50. */
export function dogMiniTeamShield(raw,roster=[],throughRound=3){
 const games=dogNormalizeMiniGames(raw);
 if(!games||games.version<3)return 100;
 const participants=Array.isArray(roster)?roster.filter(m=>m?.uid):[];
 if(!participants.length)return 100;
 let shield=100;
 for(const round of games.rounds){
  if(round.round>throughRound||
     !['dodge','reaction'].includes(round.kind))continue;
  const max=round.maxSteps*participants.length;
  const correct=participants.reduce((sum,m)=>sum+
   (games.answers[m.uid]?.[round.round]?.attempts||[])
    .filter(a=>a.correct).length,0);
  shield-=Math.round(25*(1-Math.min(max,correct)/max));
 }
 return Math.max(50,Math.min(100,shield));
}
/** Read-only synchronized stage summary derived entirely from persisted
 * server-verified team answers, never from client-submitted hit values. */
/** Der gemeinsame Lebenspool besteht aus den echten Lebenspunkten aller
 * angetretenen Helden. Das Verhältnis früherer Schildpunkte beschreibt nur
 * den bereits bestätigten Anteil der überstandenen Bossangriffe.
 * Reiner View-Selector: weder neue Writes noch neue Firestore-Reads.
 */
export function dogMiniGroupHealth(raw,roster=[],elapsed=0,heroMaximum=()=>145){
 const players=Array.isArray(roster)?roster.filter(p=>p?.uid).slice(0,3):[];
 const games=dogNormalizeMiniGames(raw);
 const exchange=games?.version>=3?dogMiniExchangeView(games,players,elapsed):null;
 const defensiveRounds=exchange?.stages?.filter(stage=>stage.completed&&stage.defensive)||[];
 const remainingPercent=defensiveRounds.length?
  Math.max(50,Math.min(100,Number(defensiveRounds.at(-1).shield)||100)):100;
 const personalDefense=games?.version>=11;
 const heroes=players.map(p=>{
  const maxHp=Math.max(1,Math.min(1000000,Math.round(Number(heroMaximum(p))||145)));
  // In new encounters each hero earns their own protection; teammates can
  // no longer lose LP because another player missed an avoidance/reaction.
  // The server validates every action. Old persisted v3-v10 fights keep their
  // original shared-defense health calculation.
  let personalPercent=remainingPercent;
  if(personalDefense){
   let loss=0;
   for(const round of games.rounds){
    if(!['dodge','reaction'].includes(round.kind)||elapsed<round.endMs)continue;
    const correct=(games.answers[p.uid]?.[round.round]?.attempts||[])
     .filter(a=>a.correct).length;
    loss+=Math.round(25*(1-Math.min(round.maxSteps,correct)/round.maxSteps));
   }
   personalPercent=Math.max(50,Math.min(100,100-loss));
  }
  const hp=Math.round(maxHp*personalPercent/100);
  return {uid:p.uid,hp,maxHp};
 });
 const maxHp=heroes.reduce((v,m)=>v+m.maxHp,0);
 const hp=heroes.reduce((v,m)=>v+m.hp,0);
 return {hp,maxHp,lost:Math.max(0,maxHp-hp),heroes,
  remainingPercent,confirmedDefenses:defensiveRounds.length};
}

/** Die inszenierten, serverseitig garantierten Basistreffer reduzieren die
 * sichtbaren Boss-LP nach den beiden offensiven Phasen. Nur ein konservativer
 * Teil des Ausrüstungs-Schadens wird vor dem zufallsabhängigen Finale verbucht:
 * .85 < .90 minimaler Glücksfaktor × .97 minimaler Teamschutz.
 * Damit können LP beim Finale nur gleich bleiben oder weiter fallen.
 */
export function dogMiniBossLiveHp(raw,roster=[],elapsed=0,bossMaxHp=1,baseDamage=0,earnedExtraDamage=0){
 const maxHp=Math.max(1,Math.round(Number(bossMaxHp)||1));
 const games=dogNormalizeMiniGames(raw);
 if(!games||games.version<3||!Array.isArray(roster)||!roster.length)return maxHp;
 const resolved=games.rounds.filter(r=>
  !['dodge','reaction'].includes(r.kind)&&elapsed>=r.endMs).length;
 if(!resolved)return maxHp;
 const fraction=resolved===1?.43:.83;
 // Verified minigame success contributes only when its offensive phase
 // has settled on the server. 0.85 is below the minimum final 0.90×0.97.
 const guaranteed=Math.floor((Math.max(0,Number(baseDamage)||0)*fraction+
  Math.max(0,Number(earnedExtraDamage)||0))*.85);
 return Math.max(1,maxHp-Math.min(maxHp-1,guaranteed));
}

export function dogMiniExchangeView(raw,roster=[],elapsed=0,heroBaseDamage=null){
 const games=dogNormalizeMiniGames(raw);
 if(!games||games.version<3)return null;
 const participants=Array.isArray(roster)?roster.filter(m=>m?.uid):[];
 const stages=games.rounds.map((round,index)=>{
  const attempts=participants.flatMap(m=>
   games.answers[m.uid]?.[index]?.attempts||[]);
  const correct=attempts.filter(a=>a.correct).length;
  const max=round.maxSteps*participants.length;
  const resolved=elapsed>=round.endMs;
  const defensive=round.kind==='dodge'||round.kind==='reaction';
  const shield=resolved&&defensive?dogMiniTeamShield(games,participants,index):null;
  const bonusWeight=round.kind==='math'?.06:round.kind==='target'?.03:0;
  // Equipment-based potential; not an invented final damage/HP result.
  const bonusDamage=resolved&&!defensive&&typeof heroBaseDamage==='function'?
   Math.max(0,Math.round(participants.reduce((sum,hero)=>{
    const count=(games.answers[hero.uid]?.[index]?.attempts||[])
     .filter(a=>a.correct).length;
    return sum+Math.max(0,heroBaseDamage(hero))*bonusWeight*
     (round.maxSteps?count/round.maxSteps:0);
   },0))):null;
  return {round:index,kind:round.kind,defensive,
   completed:resolved,correct:resolved?correct:null,max,
   bonusPercent:resolved&&!defensive&&max?
    Math.round(100*bonusWeight*correct/max*10)/10:0,
   bonusDamage,shield};
 });
 const shieldStages=stages.filter(stage=>stage.completed&&stage.defensive);
 const earned=stages.filter(stage=>stage.completed&&!stage.defensive);
 return {version:games.version,durationMs:games.version>=10?101000:games.version>=8?99000:games.version===7?92000:games.version===6?64000:games.version===5?60000:games.version===4?50000:40000,
  shield:shieldStages.length?shieldStages[shieldStages.length-1].shield:100,
  cumulativeExtraDamage:typeof heroBaseDamage==='function'?
   earned.reduce((sum,stage)=>sum+(stage.bonusDamage||0),0):null,
  stages};
}
export function dogMiniDodgePenalty(raw,uid){
 const games=dogNormalizeMiniGames(raw);if(!games||games.version===1||games.version>=3)return 0;
 const dodge=games.rounds.find(r=>r.kind==='dodge');if(!dodge)return 0;
 const correct=(games.answers[uid]?.[dodge.round]?.attempts||[])
  .filter(a=>a.correct).length;
 return Math.max(0,3-correct)*.025;
}
export function dogSubmitMiniAnswer(raw,roster,uid,roundIndex,value,now,startedAt,step=0,tapAt=null,receivedAt=now){
 const games=dogNormalizeMiniGames(raw);
 if(!games)throw Error('DOG_MINIGAME_MISSING');
 if(!Array.isArray(roster)||!roster.some(m=>m.uid===uid))
  throw Error('DOG_MINIGAME_NOT_PARTICIPANT');
 if(!Number.isSafeInteger(roundIndex)||roundIndex<0||roundIndex>=(games.rounds.length))
  throw Error('DOG_MINIGAME_BAD_ROUND');
 if(!Array.isArray(value)&&(!Number.isSafeInteger(value)||value<0||value>4))
  throw Error('DOG_MINIGAME_BAD_ANSWER');
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(startedAt)||startedAt<=0)
  throw Error('DOG_MINIGAME_NOT_RUNNING');
 const round=games.rounds[roundIndex],elapsed=now-startedAt,mine=games.answers[uid]||{};
 // Both fast sprints submit once: 8 math choices or up to 10 symbol targets.
 // No network wait between taps; server checks every private correctIndex.
 if(Array.isArray(value)){
  const targetSprint=games.version>=10&&round.kind==='target';
  const mathSprint=games.version>=2&&round.kind==='math';
  if((!targetSprint&&!mathSprint)||step!==0||
   value.length<1||value.length>(targetSprint?10:8)||
   value.some((choice,i)=>!Number.isSafeInteger(choice)||choice<0||
    choice>=(targetSprint?round.puzzles[i].options.length:3)))
   throw Error('DOG_MINIGAME_BAD_ANSWER');
  // A short transit grace lets the final visible tap be scored even if the
  // network arrives just after the window. Never accept a future round early.
  if(elapsed<round.startMs||elapsed>=round.endMs+2000)
   throw Error('DOG_MINIGAME_TOO_LATE');
  if(mine[roundIndex]?.attempts?.length)
   throw Error('DOG_MINIGAME_STEP_ORDER');
  const attempts=value.map((choice,index)=>({
   step:index,correct:choice===round.puzzles[index].correctIndex,at:now
  }));
  const correctCount=attempts.filter(a=>a.correct).length;
  const entry={attempts,correct:correctCount>0,correctCount,at:now};
  const next={...games,answers:{...games.answers,
   [uid]:{...mine,[roundIndex]:entry}}};
  return {games:next,correct:correctCount>0,replayed:false,
   step:0,correctCount};
 }
 if(games.version>=10&&round.kind==='target')
  throw Error('DOG_MINIGAME_BAD_ANSWER');
 if(games.version===1){
  if(mine[roundIndex])return {games,correct:mine[roundIndex].correct,replayed:true,step:0};
  if(step!==0)throw Error('DOG_MINIGAME_BAD_STEP');
  if(elapsed<round.startMs||elapsed>=round.endMs)
   throw Error('DOG_MINIGAME_TOO_LATE');
  let correct=false;
  if(round.kind==='math')correct=value===round.correctIndex;
  else if(round.kind==='dodge')correct=value<round.lanes&&
   value!==round.dangerIndex&&value!==round.secondDangerIndex;
  else if(round.kind==='reaction')correct=value===1&&
   Math.abs(elapsed-round.targetMs)<=round.toleranceMs;
  else if(round.kind==='target'&&value<round.lanes){
   correct=value===dogMiniTargetIndex(round,elapsed);
   const phase=(elapsed-round.startMs)%round.stepMs;
   if(!correct&&phase<150&&elapsed>=round.startMs+round.stepMs)
    correct=value===dogMiniTargetIndex(round,elapsed-150);
  }
  const next={...games,answers:{...games.answers,[uid]:{
   ...mine,[roundIndex]:{correct,at:now}}}};
  return {games:next,correct,replayed:false,step:0};
 }
 if(!Number.isSafeInteger(step)||step<0||step>=round.maxSteps)
  throw Error('DOG_MINIGAME_BAD_STEP');
 const history=mine[roundIndex]?.attempts||[];
 if(history[step])return {games,correct:history[step].correct,replayed:true,step};
 if(step!==history.length&&!(round.kind==='dodge'&&step>history.length))
  throw Error('DOG_MINIGAME_STEP_ORDER');
 const preciseReaction=games.version>=9&&round.kind==='reaction';
 let judgedElapsed=elapsed,verifiedTap=false;
 // Calculate clicks from the actual input timestamp, not the later Firestore
 // transaction. The server accepts only a tightly bounded network transfer.
 if(preciseReaction&&tapAt!==null&&tapAt!==undefined){
  if(!Number.isSafeInteger(tapAt)||!Number.isSafeInteger(receivedAt)||
   tapAt<startedAt+round.startMs||tapAt>=startedAt+round.endMs||
   tapAt>receivedAt+90||receivedAt-tapAt>900)
   throw Error('DOG_MINIGAME_BAD_TIMESTAMP');
  judgedElapsed=tapAt-startedAt;verifiedTap=true;
 }
 if(elapsed<round.startMs||(elapsed>=round.endMs&&
    !(preciseReaction&&verifiedTap&&elapsed<round.endMs+1500)))
  throw Error('DOG_MINIGAME_TOO_LATE');
 if(history.length&&round.kind!=='dodge'&&now-history[history.length-1].at<
  (round.kind==='math'?210:round.kind==='reaction'?420:300))
  throw Error('DOG_MINIGAME_TOO_FAST');
 let correct=false;
 if(round.kind==='math')correct=value===round.puzzles[step].correctIndex;
 else if(round.kind==='dodge'){
  const attack=round.attacks[step];
  if(elapsed<attack.startMs||elapsed>=attack.impactMs)
   throw Error('DOG_MINIGAME_TOO_LATE');
  correct=value<round.lanes&&value!==attack.dangerIndex&&
   value!==attack.secondDangerIndex;
 }else if(round.kind==='reaction')
  correct=value===1&&(preciseReaction?
   Math.abs(dogMiniReactionPosition(round,judgedElapsed)-.5)<=round.zoneRadius+.004:
   dogMiniReactionValid(round,elapsed));
 else if(round.kind==='target'&&value<round.lanes){
  correct=value===dogMiniTargetIndex(round,elapsed);
  const phase=(elapsed-round.startMs)%round.stepMs;
  if(!correct&&phase<120&&elapsed>=round.startMs+round.stepMs)
   correct=value===dogMiniTargetIndex(round,elapsed-120);
 }
 const attempts=[...history];
 if(round.kind==='dodge'&&step>history.length){
  // Each unplayed strike becomes a verified miss after its real impact.
  // Never accept a future strike early or let an unplayed step deadlock
  // all later attempts.
  for(let missing=history.length;missing<step;missing++){
   const impact=round.attacks[missing].impactMs;
   if(elapsed<impact)throw Error('DOG_MINIGAME_STEP_ORDER');
   attempts.push({step:missing,correct:false,at:startedAt+impact});
  }
 }
 attempts.push({step,correct,at:now,
  ...(preciseReaction&&verifiedTap?{tappedAt:tapAt}:{}),
  ...(round.kind==='dodge'?{choice:value}:{})});
 const entry={attempts,correct:attempts.some(a=>a.correct),at:now,
  correctCount:attempts.filter(a=>a.correct).length};
 const next={...games,answers:{...games.answers,[uid]:{...mine,[roundIndex]:entry}}};
 return {games:next,correct,replayed:false,step,correctCount:entry.correctCount};
}
