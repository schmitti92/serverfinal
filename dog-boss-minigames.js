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
const mathPuzzle=(difficulty,rand)=>{
 const {mathTier,tier}=difficulty;let a,b,answer,question;
 if(mathTier===1){a=6+draw(rand,10+tier*3);b=4+draw(rand,10+tier*2);
  answer=a+b;question=a+' + '+b+' = ?';}
 else if(mathTier===2){a=3+draw(rand,6+tier);b=3+draw(rand,7);
  answer=a*b;question=a+' × '+b+' = ?';}
 else if(mathTier===3){b=3+draw(rand,7);answer=4+draw(rand,12+tier);
  question=(b*answer)+' ÷ '+b+' = ?';}
 else{a=4+draw(rand,9);b=4+draw(rand,9);const c=3+draw(rand,17);
  answer=a*b+c;question=a+' × '+b+' + '+c+' = ?';}
 const delta=mathTier>=3?3+draw(rand,6):2+draw(rand,5);
 const correctIndex=draw(rand,3);
 const options=Array.from({length:3},(_,i)=>i===correctIndex?answer:
  Math.max(0,answer+(i<correctIndex?-(correctIndex-i)*delta:(i-correctIndex)*delta)));
 return {question,options,correctIndex};
};
function createRound(kind,round,gate,rand){
 const {startMs,endMs}=DOG_MINIGAME_WINDOWS[round],d=dogMiniDifficulty(gate);
 const base={kind,round,startMs,endMs,difficulty:d.tier,
  maxSteps:TYPES[kind]};
 if(kind==='math'){
  return {...base,puzzles:Array.from({length:8},()=>mathPuzzle(d,rand)),
   hint:'Acht Sekunden: Löse so viele Aufgaben wie möglich!'};
 }
 if(kind==='dodge'){
  const attacks=Array.from({length:3},(_,step)=>{
   const dangerIndex=draw(rand,d.choices);
   return {step,startMs:startMs+Math.floor(step*8000/3),
    impactMs:startMs+Math.floor((step+0.66)*8000/3),
    dangerIndex,secondDangerIndex:d.choices===3?
     (dangerIndex+1+draw(rand,2))%3:null};
  });
  return {...base,lanes:d.choices,attacks,
   hint:'Drei Einschläge! Weiche vor jedem Schlag in ein sicheres Feld aus.'};
 }
 if(kind==='reaction')return {...base,
  zoneRadius:Math.round((.12-d.tier*.005)*1000)/1000,
  hint:'Triff dreimal die grüne Zone. Der Zeiger wird ständig schneller!'};
 return {...base,lanes:d.tier>=8?5:d.tier>=4?4:3,
  initialIndex:draw(rand,d.tier>=8?5:d.tier>=4?4:3),
  stepMs:d.targetStepMs,hint:'Treffe drei wandernde Schwachpunkte!'};
}
export function dogCreateMiniGames(gate,rand=randomInt){
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
function normalizeV2Round(round,i,gate){
 const fixed=DOG_MINIGAME_WINDOWS[i],d=dogMiniDifficulty(gate);
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
   const startMs=fixed.startMs+Math.floor(step*8000/3);
   const impactMs=fixed.startMs+Math.floor((step+.66)*8000/3);
   const dangerIndex=int(attack?.dangerIndex,0,lanes-1,0);
   const second=int(attack?.secondDangerIndex,0,lanes-1,-1);
   return {step,startMs,impactMs,dangerIndex,secondDangerIndex:
    lanes===3&&second!==dangerIndex?second:null};
  });
  return {...base,lanes,attacks};
 }
 if(round.kind==='reaction')return {...base,
  zoneRadius:Math.round((.12-d.tier*.005)*1000)/1000};
 return {...base,lanes:int(round.lanes,3,5,3),
  initialIndex:int(round.initialIndex,0,4,0),stepMs:d.targetStepMs};
}
export function dogNormalizeMiniGames(raw){
 if(!isObj(raw)||![1,2].includes(raw.version)||
  !Array.isArray(raw.rounds)||raw.rounds.length!==3||
  !Number.isSafeInteger(raw.gate))return null;
 if(raw.gate<10||raw.gate>100||raw.gate%10!==0)return null;
 const rounds=raw.rounds.map((round,i)=>{
  if(!DOG_MINIGAME_KINDS.includes(round?.kind)||round.round!==i||
   round.startMs!==(raw.version===1?LEGACY_WINDOWS[i]:DOG_MINIGAME_WINDOWS[i]).startMs||
   round.endMs!==(raw.version===1?LEGACY_WINDOWS[i]:DOG_MINIGAME_WINDOWS[i]).endMs)return null;
  return raw.version===1?normalizeV1Round(round,i,raw.gate):
   normalizeV2Round(round,i,raw.gate);
 });
 if(rounds.some(x=>!x)||new Set(rounds.map(x=>x.kind)).size!==3)return null;
 const answers={};
 if(isObj(raw.answers))for(const [uid,records] of Object.entries(raw.answers).slice(0,3)){
  if(!uidOkay(uid)||!isObj(records))continue;
  answers[uid]={};
  for(let i=0;i<3;i++){
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
     at:int(item.at,0,10_000_000_000_000,0)});
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
export function dogPublicMiniGames(raw,uid){
 const games=dogNormalizeMiniGames(raw);
 if(!games)return null;
 return {version:games.version,gate:games.gate,
  rounds:games.rounds.map(round=>{
   if(games.version===1){const {correctIndex,...publicFields}=round;return publicFields;}
   if(round.kind==='math')return {...round,
    puzzles:round.puzzles.map(({correctIndex,...p})=>p)};
   return {...round};
  }),
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
 const weights={math:.06,dodge:.02,reaction:.04,target:.03};
 return Math.min(.15,games.rounds.reduce((score,round)=>{
  const count=(games.answers[uid]?.[round.round]?.attempts||[]).filter(a=>a.correct).length;
  return score+weights[round.kind]*Math.min(1,count/round.maxSteps);
 },0));
}
/** Missing or failed dodges have an actual defensive penalty (max 7.5 %).
 * A perfect triple dodge avoids this entirely. */
export function dogMiniDodgePenalty(raw,uid){
 const games=dogNormalizeMiniGames(raw);if(!games||games.version===1)return 0;
 const dodge=games.rounds.find(r=>r.kind==='dodge');if(!dodge)return 0;
 const correct=(games.answers[uid]?.[dodge.round]?.attempts||[])
  .filter(a=>a.correct).length;
 return Math.max(0,3-correct)*.025;
}
export function dogSubmitMiniAnswer(raw,roster,uid,roundIndex,value,now,startedAt,step=0){
 const games=dogNormalizeMiniGames(raw);
 if(!games)throw Error('DOG_MINIGAME_MISSING');
 if(!Array.isArray(roster)||!roster.some(m=>m.uid===uid))
  throw Error('DOG_MINIGAME_NOT_PARTICIPANT');
 if(!Number.isSafeInteger(roundIndex)||roundIndex<0||roundIndex>2)
  throw Error('DOG_MINIGAME_BAD_ROUND');
 if(!Array.isArray(value)&&(!Number.isSafeInteger(value)||value<0||value>4))
  throw Error('DOG_MINIGAME_BAD_ANSWER');
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(startedAt)||startedAt<=0)
  throw Error('DOG_MINIGAME_NOT_RUNNING');
 const round=games.rounds[roundIndex],elapsed=now-startedAt,mine=games.answers[uid]||{};
 // Maths is a very fast eight-second sprint. A SINGLE receipt for all
 // locally answered puzzles avoids 8 consecutive network round-trips.
 // The server still checks every secret answer and rejects extra attempts.
 // Up to two seconds transfer grace prevents punishing a final-moment submit.
 if(Array.isArray(value)){
  if(games.version!==2||round.kind!=='math'||step!==0||
   value.length<1||value.length>8||
   value.some(n=>!Number.isSafeInteger(n)||n<0||n>2))
   throw Error('DOG_MINIGAME_BAD_ANSWER');
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
 if(elapsed<round.startMs||elapsed>=round.endMs)
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
  correct=value===1&&Math.abs(dogMiniReactionPosition(round,elapsed)-.5)<=round.zoneRadius;
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
 attempts.push({step,correct,at:now});
 const entry={attempts,correct:attempts.some(a=>a.correct),at:now,
  correctCount:attempts.filter(a=>a.correct).length};
 const next={...games,answers:{...games.answers,[uid]:{...mine,[roundIndex]:entry}}};
 return {games:next,correct,replayed:false,step,correctCount:entry.correctCount};
}
