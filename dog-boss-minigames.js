/** Shared, server-owned micro challenges for 30-second DOG boss fights.
 * Each fight gets exactly three unique games out of dodge, reaction,
 * mental arithmetic and moving weakpoint. One answer per hero/game.
 * A hero can gain at most 10% total extra damage, never 10% per game.
 */
import {randomInt} from 'node:crypto';
export const DOG_MINIGAME_KINDS=Object.freeze(['dodge','reaction','math','target']);
export const DOG_MINIGAME_WINDOWS=Object.freeze([
 Object.freeze({startMs:3000,endMs:10000}),
 Object.freeze({startMs:10000,endMs:17000}),
 Object.freeze({startMs:17000,endMs:24000})
]);
const draw=(rand,max)=>{
 const n=rand(max);
 if(!Number.isSafeInteger(n)||n<0||n>=max)throw Error('DOG_MINIGAME_BAD_RANDOM');
 return n;
};
const isObj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const safeUid=x=>typeof x==='string'&&x.length>0&&x.length<=200;
const int=(n,lo,hi,d=lo)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi?n:d;
export const dogMiniDifficulty=gate=>{
 if(!Number.isSafeInteger(gate)||gate<10||gate>100||gate%10!==0)
  throw Error('DOG_MINIGAME_BAD_GATE');
 const tier=gate/10;
 return Object.freeze({
  tier,choices:tier>=6?3:2,
  reactionToleranceMs:Math.max(400,790-tier*39),
  targetStepMs:Math.max(530,1300-tier*75),
  mathTier:tier>=9?4:tier>=7?3:tier>=4?2:1
 });
};
const mathPuzzle=(difficulty,rand)=>{
 const {mathTier,tier}=difficulty;
 let a,b,answer,question;
 if(mathTier===1){
  a=6+draw(rand,10+tier*3);b=4+draw(rand,10+tier*2);
  answer=a+b;question=a+' + '+b+' = ?';
 }else if(mathTier===2){
  a=3+draw(rand,6+tier);b=3+draw(rand,7);
  answer=a*b;question=a+' × '+b+' = ?';
 }else if(mathTier===3){
  b=3+draw(rand,7);answer=4+draw(rand,12+tier);
  question=(b*answer)+' ÷ '+b+' = ?';
 }else{
  a=4+draw(rand,9);b=4+draw(rand,9);
  const c=3+draw(rand,17);
  answer=a*b+c;question=a+' × '+b+' + '+c+' = ?';
 }
 const delta=mathTier>=3?3+draw(rand,6):2+draw(rand,5);
 const correctIndex=draw(rand,3);
 const options=Array.from({length:3},(_,i)=>i===correctIndex?answer:
  Math.max(0,answer+(i<correctIndex?-(correctIndex-i)*delta:(i-correctIndex)*delta)));
 return {question,options,correctIndex};
};
const createRound=(kind,round,gate,rand)=>{
 const {startMs,endMs}=DOG_MINIGAME_WINDOWS[round];
 const d=dogMiniDifficulty(gate);
 const base={kind,round,startMs,endMs,difficulty:d.tier};
 if(kind==='dodge'){
  const dangerIndex=draw(rand,d.choices);
  return {...base,lanes:d.choices,dangerIndex,
   hint:'Weiche auf ein freies Feld aus!'};
 }
 if(kind==='reaction'){
  const targetMs=startMs+3000+draw(rand,1300);
  return {...base,targetMs,toleranceMs:d.reactionToleranceMs,
   hint:'Tippe, sobald der Ring im grünen Bereich ist!'};
 }
 if(kind==='target'){
  const lanes=d.tier>=8?5:d.tier>=4?4:3;
  return {...base,lanes,initialIndex:draw(rand,lanes),
   stepMs:d.targetStepMs,hint:'Triff den wandernden Schwachpunkt!'};
 }
 return {...base,...mathPuzzle(d,rand),hint:'Löse die Rechnung vor Ablauf der Zeit!'};
};
export function dogCreateMiniGames(gate,rand=randomInt){
 const available=[...DOG_MINIGAME_KINDS];
 // Fisher-Yates without replacement. The order is frozen for the encounter.
 for(let i=available.length-1;i>0;i--){
  const n=draw(rand,i+1);[available[i],available[n]]=[available[n],available[i]];
 }
 const rounds=available.slice(0,3).map((kind,i)=>createRound(kind,i,gate,rand));
 return {version:1,gate,rounds,answers:{}};
}
export function dogNormalizeMiniGames(raw){
 if(!isObj(raw)||raw.version!==1||!Array.isArray(raw.rounds)||
  raw.rounds.length!==3||!Number.isSafeInteger(raw.gate))return null;
 const gameGate=raw.gate;
 if(gameGate<10||gameGate>100||gameGate%10!==0)return null;
 const rounds=raw.rounds.map((round,i)=>{
  if(!DOG_MINIGAME_KINDS.includes(round?.kind)||round.round!==i)return null;
  const fixed=DOG_MINIGAME_WINDOWS[i];
  if(round.startMs!==fixed.startMs||round.endMs!==fixed.endMs)return null;
  const d=dogMiniDifficulty(gameGate);
  const base={kind:round.kind,round:i,startMs:fixed.startMs,endMs:fixed.endMs,
   difficulty:d.tier,hint:String(round.hint||'').slice(0,120)};
  if(round.kind==='dodge'){
   const lanes=int(round.lanes,2,3,2);
   return {...base,lanes,dangerIndex:int(round.dangerIndex,0,lanes-1,0)};
  }
  if(round.kind==='reaction')return {...base,
   targetMs:int(round.targetMs,fixed.startMs+2500,fixed.startMs+4500,fixed.startMs+3000),
   toleranceMs:d.reactionToleranceMs};
  if(round.kind==='target'){
   const lanes=int(round.lanes,3,5,3);
   return {...base,lanes,initialIndex:int(round.initialIndex,0,lanes-1,0),
    stepMs:d.targetStepMs};
  }
  const options=Array.isArray(round.options)&&round.options.length===3?
   round.options.map(n=>int(n,0,2000,0)):[0,1,2];
  return {...base,question:String(round.question||'').slice(0,60),
   options,correctIndex:int(round.correctIndex,0,2,0)};
 });
 if(rounds.some(x=>!x)||new Set(rounds.map(x=>x.kind)).size!==3)return null;
 const answers={};
 if(isObj(raw.answers))for(const [uid,records] of Object.entries(raw.answers).slice(0,3)){
  if(!safeUid(uid)||!isObj(records))continue;
  answers[uid]={};
  for(let i=0;i<3;i++){
   const item=records[i];
   if(item?.correct===true||item?.correct===false)
    answers[uid][i]={correct:item.correct,at:int(item.at,0,10_000_000_000_000,0)};
  }
 }
 return {version:1,gate:gameGate,rounds,answers};
}
export function dogMiniTargetIndex(round,relativeMs){
 const ticks=Math.max(0,Math.floor((relativeMs-round.startMs)/round.stepMs));
 return (round.initialIndex+ticks)%round.lanes;
}
/** Keep private answers and math solutions out of every authenticated view. */
export function dogPublicMiniGames(raw,uid){
 const games=dogNormalizeMiniGames(raw);
 if(!games)return null;
 return {gate:games.gate,rounds:games.rounds.map(x=>{
  const {correctIndex,dangerIndex,...publicFields}=x;
  return publicFields;
 }),myAnswers:games.answers[uid]||{},
  completedBy:Object.fromEntries(Object.entries(games.answers)
   .map(([id,answers])=>[id,Object.keys(answers).length]))};
}
export function dogMiniBonus(raw,uid){
 const games=dogNormalizeMiniGames(raw);
 if(!games)return 0;
 return Math.min(.10,(Object.values(games.answers[uid]||{})
  .filter(x=>x.correct).length/3)*.10);
}
export function dogSubmitMiniAnswer(raw,roster,uid,roundIndex,value,now,startedAt){
 const games=dogNormalizeMiniGames(raw);
 if(!games)throw Error('DOG_MINIGAME_MISSING');
 if(!Array.isArray(roster)||!roster.some(m=>m.uid===uid))
  throw Error('DOG_MINIGAME_NOT_PARTICIPANT');
 if(!Number.isSafeInteger(roundIndex)||roundIndex<0||roundIndex>2)
  throw Error('DOG_MINIGAME_BAD_ROUND');
 if(!Number.isSafeInteger(value)||value<0||value>4)
  throw Error('DOG_MINIGAME_BAD_ANSWER');
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(startedAt)||startedAt<=0)
  throw Error('DOG_MINIGAME_NOT_RUNNING');
 const round=games.rounds[roundIndex],elapsed=now-startedAt;
 const mine=games.answers[uid]||{};
 if(mine[roundIndex])return {games,correct:mine[roundIndex].correct,replayed:true};
 if(elapsed<round.startMs||elapsed>=round.endMs)
  throw Error('DOG_MINIGAME_TOO_LATE');
 let correct=false;
 if(round.kind==='math')correct=value===round.correctIndex;
 else if(round.kind==='dodge')correct=value<round.lanes&&value!==round.dangerIndex;
 else if(round.kind==='reaction')correct=value===1&&
  Math.abs(elapsed-round.targetMs)<=round.toleranceMs;
 else if(round.kind==='target'){
  if(value<round.lanes){
   correct=value===dogMiniTargetIndex(round,elapsed);
   // Small network tolerance at lane transitions, not full client trust.
   const phase=(elapsed-round.startMs)%round.stepMs;
   if(!correct&&phase<150&&elapsed>=round.startMs+round.stepMs)
    correct=value===dogMiniTargetIndex(round,elapsed-150);
  }
 }
 const next={...games,answers:{...games.answers,[uid]:{
  ...mine,[roundIndex]:{correct,at:now}}}};
 return {games:next,correct,replayed:false};
}
