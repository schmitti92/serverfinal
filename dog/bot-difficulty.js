/**
 * DOG bot strengths shared by the local UI and authoritative Render bot moves.
 * Pure policy decisions: never changes room state or directly reads Firebase.
 *
 * Medium intentionally reuses the established classic bot heuristic.
 * Expert looks only at the board and its own cards: never at opponents' hands.
 * Every result comes from legalActions(), so even a weak bot follows the rules.
 */
import {CARD_TYPES,legalActions,takeAction,botAction} from './engine.js';

export const DOG_BOT_DIFFICULTY_KEY='dog:bot-difficulties:v1';
export const DOG_BOT_DIFFICULTIES=Object.freeze(['easy','medium','expert']);
const DEFAULT='medium';
const slots=Object.freeze([0,1,2,3]);
const mod=n=>((n%64)+64)%64;

export function normalizeDogBotDifficulty(value){
 return DOG_BOT_DIFFICULTIES.includes(value)?value:DEFAULT;
}
export function readDogBotDifficulties(storage=typeof localStorage==='undefined'?null:localStorage){
 try{
  const value=JSON.parse(storage?.getItem(DOG_BOT_DIFFICULTY_KEY)||'{}');
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const result={};
  for(const seat of [...slots,'default'])
   if(DOG_BOT_DIFFICULTIES.includes(value[seat]))result[seat]=value[seat];
  return result;
 }catch{return {};}
}
export function saveDogBotDifficulty(seat,level,storage=typeof localStorage==='undefined'?null:localStorage){
 const result=readDogBotDifficulties(storage);
 if(seat!=='default'&&(!Number.isInteger(seat)||seat<0||seat>3))return result;
 result[seat]=normalizeDogBotDifficulty(level);
 try{storage?.setItem(DOG_BOT_DIFFICULTY_KEY,JSON.stringify(result));}catch(_){}
 return result;
}
export function dogBotDifficultyForSeat(settings,seat){
 return normalizeDogBotDifficulty(settings?.[seat]??settings?.default);
}

function cardAt(game,seat,cardId){
 return game.hands?.[seat]?.find(card=>card.id===cardId)||null;
}
function friendly(game,seat,owner){
 return owner===seat||(game.mode==='teams4'&&owner%2===seat%2);
}
function progress(owner,position){
 return mod(position-owner*16);
}
function expertScore(game,seat,action){
 const own=game.pieces.filter(p=>p.owner===seat);
 const card=cardAt(game,seat,action.cardId);
 const holdingStart=own.some(p=>p.place==='home');
 const teammate=game.mode!=='teams4'?null:(seat+2)%4;
 const partnerOut=teammate!==null&&
   game.pieces.some(p=>p.owner===teammate&&p.place==='track');
 if(action.type==='exchange'){
  if(!card)return -200;
  // If the partner is stuck in reserve, pass a way out. Otherwise preserve
  // joker/start cards for our own turns and donate a useful ordinary card.
  const rescue=['13','1/11','joker'].includes(card.type);
  if(!partnerOut)return rescue?(card.type==='joker'?55:110):0;
  const value={'2':32,'3':30,'4':26,'5':25,'6':24,'8':23,'9':22,'10':21,
   '12':20,'swap':13,'7':8,'1/11':2,'13':1,'joker':-10};
  return value[card.type]??0;
 }
 if(['discard','discardDraw'].includes(action.type))return 0;
 if(action.type==='emptySwap')return -250;
 if(action.type==='seven-finish')return -120;
 if(action.type==='seven')return 75;
 if(action.type==='start'){
  const occupant=game.pieces.find(p=>p.owner!==seat&&p.place==='track'&&p.pos===seat*16);
  return 155+(occupant?(friendly(game,seat,occupant.owner)?-110:85):0)
   -(card?.type==='joker'?22:0);
 }
 if(action.type==='swap'){
  const mine=game.pieces.find(p=>p.id===action.pieceId);
  const theirs=game.pieces.find(p=>p.id===action.targetId);
  if(!mine||!theirs)return -100;
  const improvement=progress(seat,theirs.pos)-progress(seat,mine.pos);
  const opponentLoss=progress(theirs.owner,theirs.pos)-progress(theirs.owner,mine.pos);
  return 22+Math.max(-100,Math.min(100,improvement*2.4))+
   (friendly(game,seat,theirs.owner)?-85:Math.max(-35,Math.min(45,opponentLoss*.75)))-
   (card?.type==='joker'?22:0);
 }
 if(action.type!=='move'&&action.type!=='seven-step')return -100;
 const pawn=game.pieces.find(p=>p.id===action.pieceId);
 if(!pawn)return -100;
 const goal=typeof action.to==='string'&&action.to.startsWith('goal:');
 const target=typeof action.to==='string'&&action.to.startsWith('track:')?
  Number(action.to.slice(6)):null;
 let value=12;
 if(goal){
  const slot=Number(action.to.slice(5));
  value+=pawn.place==='goal'?45+35*(slot-pawn.pos):190+slot*38;
  // The game's actual victory condition is four pawns in goal, regardless
  // of their precise goal slots.
  if(pawn.place!=='goal'&&own.filter(p=>p.place==='goal').length===3)value+=10000;
 }else{
  value+=Math.max(-16,Math.min(75,Number(action.steps||0)*5));
  // Moving backwards from the start can be a deliberate setup for entering
  // the finish on the next card instead of circling another lap.
  if(action.steps===-4&&pawn.place==='track'&&
     progress(seat,pawn.pos)<8)value+=34;
  if(target===seat*16&&pawn.place==='track'&&pawn.pos!==target)value+=25;
  if(target!==null&&target!==seat*16){
   // Unknown cards remain unknown: estimate danger only from board geometry.
   const risk=game.pieces.filter(p=>!friendly(game,seat,p.owner)&&p.place==='track'&&
     mod(target-p.pos)>=1&&mod(target-p.pos)<=13).length;
   value-=Math.min(28,risk*9);
  }
 }
 for(const id of action.captures||[]){
  const struck=game.pieces.find(p=>p.id===id);
  if(!struck)continue;
  value+=friendly(game,seat,struck.owner)?-125:95;
 }
 if(card?.type==='joker')value-=22;
 if(holdingStart&&pawn.place==='goal')value-=12;
 return value;
}


/**
 * Expert planner (local games only)
 *
 * - Legal moves and seven continuations are ALWAYS validated by the engine.
 * - Search uses the bot's own hand, public discards and PUBLIC enemy hand counts.
 *   Other players' card faces and the shuffled deck are replaced with dummies
 *   before any hypothetical action. There is no perfect-information cheating.
 * - A bounded beam search considers the next 2–3 plays from the known hand.
 *   Split-seven moves are searched as one indivisible card.
 * - A probability model estimates captures by unknown enemy cards, swaps and
 *   starts using remaining deck frequencies. It does NOT predict the future
 *   or grant the bot information no player can see.
 * - A 145 ms bounded search with tactical move diversity preserves responsive animations.
 */
const EXPERT_THINK_MS=145;
const EXPERT_MAX_NODES=112;
const EXPERT_ROOT_WIDTH=16;
const EXPERT_BRANCH_WIDTH=5;
const DECK_TOTAL=Object.freeze(Object.fromEntries(CARD_TYPES.map(t=>[t,t==='joker'?6:8])));
const KNOWN_FORWARD=Object.freeze({'1/11':[1,11],'2':[2],'3':[3],'4':[4,-4],'5':[5],
 '6':[6],'7':[1,2,3,4,5,6,7],'8':[8],'9':[9],'10':[10],'12':[12],'13':[13],
 'swap':[],'joker':[1,2,3,4,5,6,7,8,9,10,11,12,13,-4]});
const nowMs=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();

function expertContext(game,seat){
 const remaining={...DECK_TOTAL};
 // All discarded card faces and our own hand are already known. Nothing from
 // an opponent's hand or the server's hidden deck is inspected.
 for(const card of game.discard||[])if(card?.type in remaining)remaining[card.type]=Math.max(0,remaining[card.type]-1);
 for(const card of game.hands?.[seat]||[])if(card?.type in remaining)remaining[card.type]=Math.max(0,remaining[card.type]-1);
 const total=Object.values(remaining).reduce((sum,count)=>sum+count,0)||110;
 const handCounts=game.players.map((p,i)=>p.inactive||i===seat?0:
   Array.isArray(game.hands?.[i])?game.hands[i].length:
   Number.isInteger(game.hands?.[i]?.count)?game.hands[i].count:0);
 return {seat,remaining,total,handCounts,deadline:nowMs()+EXPERT_THINK_MS,nodes:0};
}
function chanceHasCard(probability,handCount){
 return 1-Math.pow(1-Math.max(0,Math.min(1,probability)),Math.max(0,handCount));
}
function enemyThreat(game,pawn,ctx){
 const {seat,remaining,total,handCounts}=ctx;
 if(pawn.place!=='track'||(pawn.pos===pawn.owner*16))return 0; // protected by its colour
 let combined=1;
 for(const enemy of game.players){
  if(enemy.inactive||friendly(game,seat,enemy.seat))continue;
  const count=handCounts[enemy.seat];
  if(!count)continue;
  const attackers=game.pieces.filter(p=>p.owner===enemy.seat&&p.place==='track');
  const canSpawn=game.pieces.some(p=>p.owner===enemy.seat&&p.place==='home')&&
    pawn.pos===enemy.seat*16;
  // With no enemy pawn out and no spawn on this field, there is no
  // immediate capture threat; a joker cannot attack out of thin air.
  if(!attackers.length&&!canSpawn)continue;
  const threateningTypes=new Set(attackers.length?['joker']:[]);
  for(const other of attackers){
   const distance=mod(pawn.pos-other.pos);
   const backward=mod(other.pos-pawn.pos);
   for(const [type,steps] of Object.entries(KNOWN_FORWARD)){
    if(type==='joker'||type==='swap')continue;
    if(steps.some(n=>n>0&&n===distance||n<0&&-n===backward))
     threateningTypes.add(type);
   }
  }
  // The same card is counted ONCE even if two different pawns could use it.
  let matching=[...threateningTypes].reduce((total,type)=>total+(remaining[type]||0),0);
  // An opponent can spawn on its own coloured start square and displace a
  // foreign pawn if it still has a figure in reserve.
  if(canSpawn)
   for(const type of ['13','1/11'])if(!threateningTypes.has(type))matching+=remaining[type]||0;
  // A swap can also remove a valuable advancing piece from its position.
  if(attackers.some(p=>p.pos!==enemy.seat*16))
   matching+=(remaining.swap||0)*.17;
  combined*=1-chanceHasCard(Math.min(.95,matching/total),count);
 }
 return Math.max(0,Math.min(1,1-combined));
}
// A player with 3/4 goals can win on their next card. Estimate this
// separately: a final pawn entering the goal is far more dangerous than an
// ordinary capture. Goal slot 0 must be free for that last pawn to enter.
function immediateEnemyWinProbability(game,enemy,ctx){
 const pieces=game.pieces.filter(p=>p.owner===enemy.seat);
 if(pieces.filter(p=>p.place==='goal').length!==3||
    pieces.some(p=>p.place==='goal'&&p.pos===0))return 0;
 const last=pieces.find(p=>p.place!=='goal');
 if(!last||last.place!=='track')return 0;
 const start=enemy.seat*16;
 const distance=mod(start-last.pos);
 const steps=distance===0?(last.goalReady?1:Infinity):distance+1;
 if(steps>13)return 0;
 const relevant=new Set(['joker']);
 for(const [type,values] of Object.entries(KNOWN_FORWARD)){
  if(type==='joker'||type==='swap')continue;
  if(values.some(n=>n===steps))relevant.add(type);
 }
 const count=ctx.handCounts[enemy.seat]||0;
 const matching=[...relevant].reduce((sum,type)=>sum+(ctx.remaining[type]||0),0);
 return chanceHasCard(matching/ctx.total,count);
}
function pawnValue(p){
 if(p.place==='home')return 0;
 if(p.place==='goal')return 270+p.pos*13;
 const lap=progress(p.owner,p.pos);
 // Pawns one step before passing their own start are almost at the finish.
 return 100+lap*2.2+(p.goalReady?35:0)+(p.pos===p.owner*16?17:0);
}
function expertBoardValue(game,ctx){
 const {seat}=ctx;
 if(game.phase==='finished'){
  const winner=game.winnerSeat;
  if(winner===seat)return 1000000;
  if(winner!==null&&friendly(game,seat,winner))return 700000;
  return -1000000;
 }
 let score=0;
 for(const player of game.players){
  if(player.inactive)continue;
  const pieces=game.pieces.filter(p=>p.owner===player.seat);
  const goals=pieces.filter(p=>p.place==='goal').length;
  const mine=player.seat===seat;
  const allied=!mine&&friendly(game,seat,player.seat);
  const mult=mine?1:allied?.16:-.57;
  for(const piece of pieces){
   score+=pawnValue(piece)*mult;
   if((mine||allied)&&piece.place==='track'){
    const likelihood=enemyThreat(game,piece,ctx);
    const value=65+progress(piece.owner,piece.pos)*1.35;
    score-=likelihood*value*(mine?.79:.24);
   }
  }
  score+=mult*(goals*goals*9);
  // A rival with three pawns finished is an urgent strategic threat.
  if(!mine&&!allied&&goals===3){
   score-=78;
   score-=immediateEnemyWinProbability(game,player,ctx)*850;
  }
 }
 return score;
}
function actionSignature(game,seat,action){
 const own=game.pieces.find(p=>p.id===action.pieceId);
 const card=game.hands?.[seat]?.find(c=>c.id===action.cardId);
 const target=game.pieces.find(p=>p.id===action.targetId);
 return [action.type,card?.type,action.as,action.steps,action.viaGoal,action.to,
  own?.place,own?.pos,target?.owner,target?.pos].join('|');
}
function dedupeAndRank(game,seat,actions){
 const used=new Set(),result=[];
 for(const action of actions){
  const signature=actionSignature(game,seat,action);
  if(used.has(signature))continue;
  used.add(signature);
  result.push({action,quick:expertScore(game,seat,action)});
 }
 result.sort((a,b)=>b.quick-a.quick);
 return result;
}
// Discarding is an irreversible loss of a known hand card, with an unknown
// replacement. Save the rare flexible cards for the next round whenever a
// hand is completely blocked (the engine permits discarding ANY card).
function discardCost(type){
 return ({swap:0,'2':12,'3':15,'12':18,'8':19,'9':22,'10':23,
   '5':27,'6':30,'4':47,'7':92,'1/11':112,'13':118,joker:160})[type]??30;
}
function bestDiscardAction(game,seat,actions){
 return [...actions].sort((a,b)=>
   discardCost(cardAt(game,seat,a.cardId)?.type)-
   discardCost(cardAt(game,seat,b.cardId)?.type))[0];
}
// Preserve tactical diversity: a seven split of 1+6 is not equivalent to
// 6+1, and a joker-goal or capture should not disappear behind 15 superficially
// similar long moves.
function variedCandidates(game,seat,ranked,limit){
 if(ranked.length<=limit)return ranked;
 const selected=[],keys=new Set();
 function add(entry){
  if(selected.length>=limit)return;
  const action=entry.action;
  const key=actionSignature(game,seat,action);
  if(keys.has(key))return;
  keys.add(key);selected.push(entry);
 }
 const byCard=new Set(),byPiece=new Set(),bySteps=new Set();
 for(const entry of ranked){
  const {action}=entry;
  const card=cardAt(game,seat,action.cardId);
  const key=card?.type||action.type;
  if(!byCard.has(key)){
   byCard.add(key);add(entry);
  }
 }
 for(const entry of ranked){
  const action=entry.action;
  const key=action.type==='seven-step'?action.steps:null;
  if(key!==null&&!bySteps.has(key)){bySteps.add(key);add(entry);}
 }
 for(const entry of ranked){
  const id=entry.action.pieceId;
  if(id!==undefined&&!byPiece.has(id)){byPiece.add(id);add(entry);}
 }
 for(const entry of ranked)
  if(entry.action.to?.startsWith('goal:')||(entry.action.captures||[]).length)
   add(entry);
 for(const entry of ranked)add(entry);
 return selected;
}
function actionBonus(game,seat,action){
 const card=cardAt(game,seat,action.cardId);
 if(action.type==='exchange')return 0;
 if(action.type==='seven-finish')return -(action.remaining||0)*3;
 if(['discard','discardDraw'].includes(action.type))return 0;
 let score=0;
 if(card?.type==='joker')score-=32;
 if(action.type==='swap'){
  const partner=game.pieces.find(p=>p.id===action.targetId);
  if(partner&&friendly(game,seat,partner.owner))score-=115;
 }
 for(const id of action.captures||[]){
  const captured=game.pieces.find(p=>p.id===id);
  if(!captured)continue;
  score+=friendly(game,seat,captured.owner)?-130:
   36+progress(captured.owner,captured.pos)*.48+
    (game.pieces.filter(p=>p.owner===captured.owner&&p.place==='goal').length===3?90:0);
 }
 return score;
}
/**
 * A self-contained counterfactual. It never reads opponents' hidden cards:
 * placeholders preserve only turn machinery, not their actual values. Search
 * intentionally does not draw unknown replacement cards.
 */
function expertSimulation(game,seat){
 const model=JSON.parse(JSON.stringify(game));
 model.hands=model.hands.map((hand,i)=>i===seat?hand:
   model.players[i]?.inactive?[]:[{id:-100-i,type:'2'}]);
 model.deck=[];
 model.discard=[];
 return model;
}
function simulateAction(model,seat,action){
 if(['discard','discardDraw'].includes(action.type))return null; // cannot predict unknown deck top
 try{
  const state=JSON.parse(JSON.stringify(model));
  state.current=seat;
  const next=takeAction(state,seat,action,()=>.5);
  return next;
 }catch(_){return null;} // the original legal move remains a safe fallback
}
function exhausted(ctx){
 return ctx.nodes>=EXPERT_MAX_NODES||nowMs()>=ctx.deadline;
}
function bestContinuation(state,ctx,depth,sevenSteps=0){
 const seat=ctx.seat;
 const baseline=expertBoardValue(state,ctx);
 if(state.phase==='finished'||exhausted(ctx))return baseline;
 const inSeven=state.phase==='seven';
 if(inSeven&&sevenSteps>=6)return baseline;
 if(!inSeven&&(state.phase!=='play'||depth<=0||!state.hands?.[seat]?.length))
  return baseline;
 const nextState={...state,current:seat};
 const moves=dedupeAndRank(nextState,seat,legalActions(nextState,seat));
 const options=variedCandidates(nextState,seat,moves,
   inSeven?Math.min(9,moves.length):Math.min(EXPERT_BRANCH_WIDTH,moves.length));
 let best=baseline;
 // A seven must be fully allocated. Its partial-state score is only a
 // fallback in the (rare) case where the thinking budget runs out.
 if(inSeven)best=-Infinity;
 for(let i=0;i<options.length&&!exhausted(ctx);i++){
  const move=options[i].action;
  const next=simulateAction(nextState,seat,move);
  ctx.nodes++;
  if(!next)continue;
  const current=expertBoardValue(next,ctx);
  let future=current;
  if(next.phase==='seven')
   future=bestContinuation(next,ctx,depth,sevenSteps+1);
  else if(depth>0&&next.phase==='play'&&next.hands?.[seat]?.length)
   future=bestContinuation(next,ctx,depth-1,0);
  const tactical=actionBonus(nextState,seat,move);
  const reward=next.phase==='seven'?future:
   current+(future-current)*.62;
  const value=reward+tactical*.65;
  if(value>best)best=value;
 }
 return Number.isFinite(best)?best:baseline;
}
function expertPlannedAction(game,seat,actions){
 const ctx=expertContext(game,seat);
 const root=expertSimulation(game,seat);
 const ranked=dedupeAndRank(game,seat,actions);
 let best=ranked[0].action;
 let bestScore=-Infinity;
 const base=expertBoardValue(root,ctx);
 const shortlist=variedCandidates(game,seat,ranked,EXPERT_ROOT_WIDTH);
 const handLength=Array.isArray(game.hands?.[seat])?game.hands[seat].length:0;
 const depth=handLength>=4?2:handLength>=2?1:0;
 for(const {action,quick} of shortlist){
  if(exhausted(ctx)&&bestScore!==-Infinity)break;
  const next=simulateAction(root,seat,action);
  ctx.nodes++;
  if(!next)continue;
  const immediate=expertBoardValue(next,ctx);
  let completed=immediate;
  if(next.phase==='seven')completed=bestContinuation(next,ctx,depth,0);
  else if(next.phase==='play'&&next.hands?.[seat]?.length&&!exhausted(ctx))
   completed=bestContinuation(next,ctx,depth,0);
  const upcoming=next.phase==='seven'?completed:
   immediate+(completed-immediate)*.6;
  const value=upcoming-base+actionBonus(root,seat,action)+quick*.08;
  if(value>bestScore){bestScore=value;best=action;}
  // Any legal immediate victory dominates all positional forecasts.
  if(next.phase==='finished'&&next.winnerSeat===seat)return action;
 }
 return best;
}

/**
 * Returns a legal action only, never applies one.
 * easy: random legal move
 * medium: existing heuristic
 * expert: positional goals, winning move, captures, threats, exchanges
 */
export function chooseDogBotAction(game,seat=game?.current,difficulty=DEFAULT,rng=Math.random){
 if(!game?.players?.[seat]?.bot||game.players[seat].inactive)return null;
 const level=normalizeDogBotDifficulty(difficulty);
 if(level==='medium')return botAction(game,seat);
 const actions=legalActions(game,seat);
 if(actions.length===0)return null;
 if(level==='easy'){
  const roll=Number(rng());
  return actions[Math.max(0,Math.min(actions.length-1,
   Math.floor((Number.isFinite(roll)?roll:0)*actions.length)))];
 }
 if(actions.length===1)return actions[0];
 if(actions.every(action=>['discard','discardDraw'].includes(action.type)))
  return bestDiscardAction(game,seat,actions);
 if(game.phase==='exchange'){
  // Exchanges need team-aware card reservation but no speculative opponent
  // turns (a sealed exchange would never let us observe their private hand).
  return dedupeAndRank(game,seat,actions)[0].action;
 }
 return expertPlannedAction(game,seat,actions);
}
