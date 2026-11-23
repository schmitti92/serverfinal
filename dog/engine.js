// DOG classic four-player engine. Independent of UI and transport.
// Ruleset versioning deliberately leaves room for future optional variants.
export const RULESET = Object.freeze({id:'classic-dog',version:1,trackSize:64,seats:4,piecesPerSeat:4,goalSize:4});
export const CARD_TYPES = Object.freeze(['1/11','2','3','4','5','6','7','8','9','10','12','13','swap','joker']);
export const COLORS = Object.freeze(['#e65f58','#4c9bfa','#5ac68d','#e8b84e']);
const stepsByCard = { '1/11':[1,11], '2':[2], '3':[3], '4':[4,-4], '5':[5], '6':[6], '7':[7], '8':[8], '9':[9], '10':[10], '12':[12], '13':[13] };
const startCards = new Set(['1/11','13']);
const clone = value => JSON.parse(JSON.stringify(value));
const mod = n => ((n%64)+64)%64;
const opponentTeam = owner => owner%2;
const activeSeats=s=>s.players.filter(p=>!p.inactive).map(p=>p.seat);
const soloMode=s=>s.mode==='solo3'||s.mode==='solo2';
const nextSeat=(s,seat)=>{for(let n=1;n<=4;n++){const next=(seat+n)%4;if(!s.players[next].inactive)return next;}throw Error('NO_ACTIVE_SEAT');};
export function makeDeck(){
  const cards=[];let id=0;
  for(const type of CARD_TYPES) for(let n=0;n<(type==='joker'?6:8);n++)cards.push({id:++id,type});
  if(cards.length!==110)throw Error('BAD_DECK_SIZE');
  return cards;
}
function shuffle(list,rng=Math.random){
  const a=[...list];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function allInGoal(s,seat){const own=s.pieces.filter(x=>x.owner===seat);return own.length===4&&own.every(x=>x.place==='goal');}
 /** First participant with four pawns in the finish wins classic DOG.
  * Grinch missions use separate engines and are deliberately unaffected.
  */
 export function completedDogSeat(s){
   if(!s||!Array.isArray(s.players)||!Array.isArray(s.pieces))return null;
   const seat=activeSeats(s).find(seat=>allInGoal(s,seat));
   return Number.isInteger(seat)?seat:null;
 }
 function moverOwner(s,seat){return seat;}
function pieceAt(s,space,except){
  return s.pieces.find(p=>p.id!==except && p.place===space.place && p.pos===space.pos && (space.place!=='goal'||p.owner===space.owner));
}
const COLOURED_START_FIELDS = Object.freeze([0,16,32,48]);
// Protection belongs to the PAWN'S colour, never to whichever coloured field it visits.
// A foreign pawn on any start square can be captured by an ordinary move or by spawning.
function protectedPiece(p){
  return !!p && p.place==='track' && Number.isInteger(p.owner)
    && COLOURED_START_FIELDS[p.owner]===p.pos;
}
function validateCardChoice(card,as){
  return card.type==='joker' ? CARD_TYPES.filter(t=>t!=='joker').includes(as) : card.type===as;
}
function replacePosition(p,pathStep){p.place=pathStep.place;p.pos=pathStep.pos;}
function stepPath(s,id,count,homeChoice,seven=false){
  const piece=s.pieces.find(p=>p.id===id);
  if(!piece||piece.place==='home'||!Number.isInteger(count)||count===0)return null;
  let current={place:piece.place,pos:piece.pos,owner:piece.owner};
  let entering=false;
  // Retain goal entry earned by crossing the owner's start square from behind.
  // A pawn freshly placed from the reserve must not gain this permission.
  let goalReady=piece.place==='track'&&piece.pos===piece.owner*16&&piece.goalReady===true;
  const path=[];const captures=[];
  for(let i=0;i<Math.abs(count);i++){
    if(current.place==='goal'){
      if(count<0)return null;
      current={...current,pos:current.pos+1};
      if(current.pos>=4)return null;
    }else{
      const oldPos=current.pos;
      const newPos=mod(oldPos+(count>0?1:-1));
      if(count>0 && homeChoice && oldPos===piece.owner*16 && goalReady){
        current={place:'goal',pos:0,owner:piece.owner};entering=true;
        goalReady=false;
      }else{
        current={place:'track',pos:newPos,owner:piece.owner};
        // Only a step onto the entry square makes a later goal entry legal.
        goalReady=count>0&&newPos===piece.owner*16&&oldPos!==newPos;
      }
    }
    const occupant=pieceAt(s,current,id);
    if(current.place==='goal'&&occupant)return null;
    if(current.place==='track'&&occupant&&protectedPiece(occupant))return null;
    // A seven hits every crossed space. Other cards only hit their final destination.
    if(current.place==='track'&&occupant&&(seven||i===Math.abs(count)-1))
      captures.push(occupant.id);
    path.push({...current});
    // When entering the finish, the remaining steps must stay inside that lane.
  }
  if(!path.length)return null;
  return {pieceId:id,steps:count,viaGoal:entering,homeChoice:!!homeChoice,path,captures:[...new Set(captures)],goalReady:current.place==='track'&&goalReady};
}
function applyMovement(s,m,seven=false){
  const piece=s.pieces.find(p=>p.id===m.pieceId);
  for(let i=0;i<m.path.length;i++){
    const next=m.path[i];
    const occupant=pieceAt(s,next,piece.id);
    if(occupant && (seven || i===m.path.length-1)){
      if(protectedPiece(occupant))throw Error('PROTECTED_FIELD');
      occupant.place='home';occupant.pos=-1;delete occupant.goalReady;
    }
    replacePosition(piece,next);
  }
  // This travels with ordinary room state; no extra server/Firebase writes.
  if(m.goalReady)piece.goalReady=true;
  else delete piece.goalReady;
}
export function createGame(options={}){
  const rng=options.rng||Math.random;
  const names=Array.isArray(options.names)?options.names:['Du','Blau','Grün','Gelb'];
  const bots=Array.isArray(options.bots)?options.bots:[false,true,true,true];
  const missing=Array.isArray(options.inactiveSeats)?options.inactiveSeats:[];
  if(missing.length>2||new Set(missing).size!==missing.length||missing.some(seat=>!Number.isInteger(seat)||seat<0||seat>3))throw Error('INVALID_INACTIVE_SEATS');
  // Two players duel, three play free-for-all; four keep two classic teams.
  const mode=missing.length===2?'solo2':missing.length===1?'solo3':'teams4';
  const players=Array.from({length:4},(_,seat)=>({seat,
    name:missing.includes(seat)?'Freier Platz':String(names[seat]||'Spieler '+(seat+1)).slice(0,25),
    bot:!missing.includes(seat)&&!!bots[seat],inactive:missing.includes(seat),team:mode==='teams4'?seat%2:seat}));
  const startingSeats=players.filter(p=>!p.inactive).map(p=>p.seat);
  // Select the opening player once per match (humans and bots have equal chances).
  const startingSeat=startingSeats[Math.min(startingSeats.length-1,Math.floor(rng()*startingSeats.length))];
  const s={schemaVersion:1,ruleset:RULESET.id,mode,phase:'exchange',round:0,revision:0,starter:startingSeat,current:startingSeat,players,
    pieces:Array.from({length:16},(_,i)=>({id:i,owner:Math.floor(i/4),place:'home',pos:-1})).filter(p=>!players[p.owner].inactive),
    hands:[[],[],[],[]],exchanges:[null,null,null,null],deck:shuffle(makeDeck(),rng),discard:[],seven:null,rescue:null,winner:null,winnerSeat:null,history:[],drawEvents:[]};
  deal(s,rng);return s;
}
function history(s,text){s.history.unshift(text);s.history.length=Math.min(s.history.length,12);}
function deal(s,rng){
  s.round++;
  const count=[6,5,4,3,2][(s.round-1)%5];
  const seats=activeSeats(s);
  // The initial starter was randomized at game creation; later card rounds rotate.
  if(s.round>1)s.starter=nextSeat(s,s.starter);
  s.current=s.starter;s.phase='exchange';
  s.exchanges=s.players.map(p=>p.inactive?true:null);
  s.seven=null;s.rescue=null;
  s.hands=[[],[],[],[]];
  for(let n=0;n<count;n++)for(const seat of seats){
    if(s.deck.length===0)s.deck=shuffle(s.discard.splice(0),rng);
    if(s.deck.length===0)throw Error('NO_CARDS');
    s.hands[seat].push(s.deck.pop());
  }
  history(s,'Runde '+s.round+': '+count+' Karten pro Person');
}
/** Optional, paid research: replace exactly one of the owner's cards before
 * the partner exchange. Unlike the partner exchange, this draws from the deck.
 * Once per match, preserves all 110 IDs and never exposes other hands.
 */
export function researchSwapCard(original,seat,cardId,rng=Math.random){
 const s=clone(original);
 if(s.phase!=='exchange'||s.exchanges[seat]!==null||s.researchSwapped?.[seat])
  throw Error('RESEARCH_SWAP_ALREADY_USED');
 if(!Number.isInteger(cardId)||!Array.isArray(s.hands[seat]))throw Error('CARD_NOT_HELD');
 const index=s.hands[seat].findIndex(card=>card.id===cardId);
 if(index<0)throw Error('CARD_NOT_HELD');
 if(!s.deck.length&&s.discard.length)s.deck=shuffle(s.discard.splice(0),rng);
 if(!s.deck.length)throw Error('RESEARCH_DECK_EMPTY');
 const discarded=s.hands[seat][index];
 s.hands[seat][index]=s.deck.pop();
 s.discard.push(discarded);
 s.researchSwapped=Array.isArray(s.researchSwapped)?s.researchSwapped:[false,false,false,false];
 s.researchSwapped[seat]=true;
 history(s,'🔬 '+s.players[seat].name+' hat vor der Runde eine Karte erforscht.');
 s.revision++;return s;
}
export function exchangeCard(original,seat,cardId,rng=Math.random){
  const s=clone(original);
  if(s.phase!=='exchange'||s.exchanges[seat]!==null)throw Error('EXCHANGE_NOT_ALLOWED');
  const hand=s.hands[seat],at=hand.findIndex(x=>x.id===cardId);
  if(at<0)throw Error('CARD_NOT_HELD');
  s.exchanges[seat]=hand.splice(at,1)[0];
  if(s.exchanges.every(Boolean)){
    for(const i of activeSeats(s))s.hands[soloMode(s)?nextSeat(s,i):(i+2)%4].push(s.exchanges[i]);
    s.exchanges=s.players.map(p=>p.inactive?true:null);s.phase='play';s.current=s.starter;
    history(s,soloMode(s)?'Alle Karten wurden verdeckt im Uhrzeigersinn weitergegeben':'Alle Partnerkarten wurden verdeckt getauscht');
    settle(s,rng);
  }
  s.revision++;return s;
}
function candidateMoves(s,seat,card,as){
  if(!validateCardChoice(card,as))return [];
  if(as==='7')return sevenCandidates(s,seat);
  const moves=[];const owner=moverOwner(s,seat),ours=s.pieces.filter(x=>x.owner===owner);
  if(startCards.has(as)){
    for(const p of ours.filter(x=>x.place==='home')){
      const target={place:'track',pos:owner*16,owner};
      const occupant=pieceAt(s,target,p.id);
      // A figure on a foreign-colour start square is not protected: entering
      // from home captures it. A figure on its own start square remains
      // protected and blocks everybody, including the owner's reserve.
      if(!occupant || !protectedPiece(occupant)) moves.push({type:'start',cardId:card.id,as,pieceId:p.id});
    }
  }
  if(as==='swap'){
    const sources=ours.filter(p=>p.place==='track'&&!protectedPiece(p));
    const targets=s.pieces.filter(p=>p.owner!==owner&&p.place==='track'&&!protectedPiece(p));
    for(const a of sources)for(const b of targets) moves.push({type:'swap',cardId:card.id,as,pieceId:a.id,targetId:b.id});
    if(!moves.length)moves.push({type:'emptySwap',cardId:card.id,as});
  }else for(const count of stepsByCard[as]||[]){
    if(as==='7')continue;
    for(const p of ours.filter(x=>x.place!=='home')){
      for(const via of [false,true]){
        const m=stepPath(s,p.id,count,via);
        if(!m)continue;
        if(via&&!m.viaGoal)continue;
        if(!via&&moves.some(x=>x.type==='move'&&x.cardId===card.id&&x.pieceId===p.id&&x.steps===count&&x.to===m.path.at(-1).place+':'+m.path.at(-1).pos))continue;
        moves.push({type:'move',cardId:card.id,as,pieceId:p.id,steps:count,viaGoal:!!via,to:m.path.at(-1).place+':'+m.path.at(-1).pos,captures:m.captures});
      }
    }
  }
  return moves;
}
function sevenCandidates(s,seat){
  const owner=moverOwner(s,seat),pieces=s.pieces.filter(p=>p.owner===owner&&p.place!=='home');
  const moves=[];for(const p of pieces){
    for(let n=1;n<=7;n++)for(const via of [false,true]){
      const m=stepPath(s,p.id,n,via,true);
      if(!m || via&&!m.viaGoal)continue;
      moves.push({type:'seven-step',pieceId:p.id,steps:n,viaGoal:!!via,to:m.path.at(-1).place+':'+m.path.at(-1).pos});
    }
  }
  return moves;
}
// Only the last unfinished pawn reaching its goal may burn unused 7 steps.
// This is evaluated on the transition, not just on an already finished side.
function completesLastPawn(before,after,owner){
  const ours=before.pieces.filter(p=>p.owner===owner);
  return ours.length===4&&ours.filter(p=>p.place!=='goal').length===1&&
    after.pieces.filter(p=>p.owner===owner).every(p=>p.place==='goal');
}
function canSeven(s,seat,left,depth=0){
  if(left===0)return true;
  if(depth>=7)return false;
  const own=moverOwner(s,seat);
  const available=s.pieces.filter(p=>p.owner===own&&p.place!=='home');
  for(const p of available)for(let n=1;n<=left;n++)for(const via of [false,true]){
    const path=stepPath(s,p.id,n,via,true);
    if(!path||via&&!path.viaGoal)continue;
    const next=clone(s);applyMovement(next,path,true);
    if(n<left&&completesLastPawn(s,next,own))return true;
    if(canSeven(next,seat,left-n,depth+1))return true;
  }
  return false;
}
function winningSevenMoves(s,seat,left){
  const candidates=sevenCandidates(s,seat).filter(m=>m.steps<=left);
  const good=[];
  for(const m of candidates){
    const path=stepPath(s,m.pieceId,m.steps,m.viaGoal,true);
    if(!path)continue;
    const next=clone(s);applyMovement(next,path,true);
    if((m.steps<left&&completesLastPawn(s,next,moverOwner(s,seat)))||
       canSeven(next,seat,left-m.steps))
      good.push({...m,captures:path.captures});
  }
  return good;
}
// Replacement draws are an exception for a player whose four own figures
// are still in the starting house. A figure on the start square (including
// another player's pawn) means the player is blocked, not eligible to draw.
export function houseRescueAllowed(s,seat){
 const own=s.pieces.filter(piece=>piece.owner===seat);
 return own.length===4 && own.every(piece=>piece.place==='home') &&
  !s.pieces.some(piece=>piece.place==='track'&&piece.pos===seat*16);
}
export function legalActions(s,seat=s.current){
  if(s.phase==='finished'||completedDogSeat(s)!==null)return [];
  if(!s.players[seat]||s.players[seat].inactive)return [];
  if(s.phase==='exchange')return s.exchanges[seat]===null?s.hands[seat].map(c=>({type:'exchange',cardId:c.id})): [];
  if(s.phase==='seven'){
    if(s.current!==seat)return [];
    const rest=7-s.seven.spent;
    const moves=winningSevenMoves(s,seat,rest);
    // Explicit choice: spend the remainder with the partner or let it lapse.
    // No other pawn can ever make this action available.
    if(s.seven.canForfeit&&rest>0)moves.push({type:'seven-finish',remaining:rest});
    // Before any split movement, the selected 7 may be deselected without
    // discarding it or changing the turn. This is a normal authoritative action.
    if(s.seven.spent===0)moves.push({type:'seven-cancel',cardId:s.seven.cardId});
    return moves;
  }
  // A drawn rescue card may ONLY take a figure out of the house.
  // The remaining hand is not playable during this special opportunity.
  if(s.phase==='rescue'){
    if(s.current!==seat||!Number.isInteger(s.rescue?.cardId))return [];
    const card=s.hands[seat].find(c=>c.id===s.rescue.cardId);
    if(!card)return [];
    const types=card.type==='joker'?['1/11','13']:[card.type];
    return types.flatMap(as=>startCards.has(as)?
      candidateMoves(s,seat,card,as).filter(m=>m.type==='start'):[]);
  }
  if(s.phase!=='play'||s.current!==seat)return [];
  const list=[];
  for(const card of s.hands[seat])for(const as of card.type==='joker'?CARD_TYPES.filter(t=>t!=='joker'):[card.type]){
    if(as==='7'){
      if(canSeven(s,seat,7))list.push({type:'seven',cardId:card.id,as});
    }else list.push(...candidateMoves(s,seat,card,as));
  }
  // A swap with nobody to exchange is not a genuine move.
  // Only four figures inside an unblocked starting house justify a single
  // replacement draw. Any other blocked hand simply discards one chosen
  // card and passes immediately to the next player.
  if(list.some(m=>m.type!=='emptySwap'))return list;
  const type=houseRescueAllowed(s,seat)?'discardDraw':'discard';
  return s.hands[seat].map(card=>({type,cardId:card.id}));
}
function finishIfWon(s){
  if(s.phase==='finished')return true;
  const seat=completedDogSeat(s);
  if(seat===null)return false;
  s.winnerSeat=seat;
  // Preserve winner's team parity for existing scoreboards and statistics.
  s.winner=soloMode(s)?seat:seat%2;
  s.phase='finished';
  history(s,'🏆 '+s.players[seat].name+' gewinnt! Alle vier eigenen Figuren sind im Ziel.');
  return true;
}
/** One-time, idempotent repair for legacy online matches already at 4/4.
 * Only the server can persist this result and its corresponding stats.
 */
export function finalizeCompletedDogGame(original){
 if(!original||original.phase==='finished')return null;
 const s=clone(original);
 if(!finishIfWon(s))return null;
 if(s.seven){
  const cardId=s.seven.cardId;
  if(s.hands[s.current]?.some(card=>card.id===cardId))discardCard(s,s.current,cardId);
  s.seven=null;
 }
 s.rescue=null;
 s.revision++;
 return s;
}
function settle(s,rng=Math.random){
  if(finishIfWon(s))return;
  let guard=0;
  while(s.phase==='play'&&++guard<30){
    if(s.hands.every(h=>h.length===0)){deal(s,rng);return;}
    if(s.hands[s.current].length===0){s.current=nextSeat(s,s.current);continue;}
    // No legal move: wait for a human/bot to choose ONE discard.
    // Only the true house exception exposes discardDraw (with a draw).
    if(legalActions(s,s.current).length)break;
    s.current=nextSeat(s,s.current);
  }
  if(guard>=30)throw Error('TURN_LOOP');
}
function cardFor(s,seat,id){const c=s.hands[seat].find(x=>x.id===id);if(!c)throw Error('CARD_NOT_HELD');return c;}
function discardCard(s,seat,id){const index=s.hands[seat].findIndex(x=>x.id===id);if(index<0)throw Error('CARD_NOT_HELD');const card=s.hands[seat].splice(index,1)[0];s.discard.push(card);s.lastPlayedCard={type:card.type,seat};}
export function takeAction(original,seat,action,rng=Math.random){
  const s=clone(original);
  if(s.phase==='finished'||completedDogSeat(s)!==null)throw Error('GAME_ALREADY_FINISHED');
  if(s.phase==='exchange')return exchangeCard(s,seat,action.cardId,rng);
  if(s.current!==seat)throw Error('NOT_YOUR_TURN');
  const avail=legalActions(s,seat);
  const found=avail.find(m=>m.type===action.type&&m.cardId===action.cardId&&m.as===action.as&&m.pieceId===action.pieceId&&m.targetId===action.targetId&&m.steps===action.steps&&m.viaGoal===action.viaGoal);
  if(!found)throw Error('ILLEGAL_ACTION');
  if(action.type==='discard'){
    // Physical blocking never draws a new card, even if the deck has
    // start cards or the player selected a joker. Do not emit drawEvents.
    discardCard(s,seat,action.cardId);
    history(s,s.players[seat].name+' ist blockiert, wirft eine Karte ab und setzt aus');
    s.current=nextSeat(s,seat);
    settle(s,rng);
    s.revision++;
    return s;
  }
  if(action.type==='discardDraw'){
    if(!houseRescueAllowed(s,seat))throw Error('REPLACEMENT_DRAW_NOT_ALLOWED');
    discardCard(s,seat,action.cardId);
    if(!s.deck.length&&s.discard.length)s.deck=shuffle(s.discard.splice(0),rng);
    if(!s.deck.length)throw Error('NO_CARDS');
    const drawn=s.deck.pop();
    const types=drawn.type==='joker'?['1/11','13']:[drawn.type];
    const canExit=types.some(as=>startCards.has(as)&&
      candidateMoves(s,seat,drawn,as).some(m=>m.type==='start'));
    // Public presentation event, not a second move. Players see the drawn
    // replacement face once; never publish the private deck/hand card ID.
    s.drawEvents=[...(Array.isArray(s.drawEvents)?s.drawEvents:[]),
      {revision:s.revision+1,seat,cardType:drawn.type,canExit}].slice(-12);
    if(canExit){
      s.hands[seat].push(drawn);
      s.phase='rescue';s.rescue={cardId:drawn.id};
      history(s,s.players[seat].name+' wirft eine Karte ab und zieht eine Startkarte');
    }else{
      s.discard.push(drawn);
      s.lastPlayedCard={type:drawn.type,seat};
      history(s,s.players[seat].name+' wirft eine Karte ab; Ersatzkarte kann nicht heraussetzen');
      s.current=nextSeat(s,seat);settle(s,rng);
    }
    s.revision++;return s;
  }
  if(s.phase==='seven'){
    if(action.type==='seven-cancel'){
      if(s.seven.spent!==0)throw Error('SEVEN_ALREADY_MOVED');
      s.seven=null;s.phase='play';
      history(s,s.players[seat].name+' wählt die 7 wieder ab');
    }else if(action.type==='seven-finish'){
      if(!s.seven.canForfeit||s.seven.spent>=7)throw Error('SEVEN_REMAINDER_MUST_BE_USED');
      const rest=7-s.seven.spent;
      discardCard(s,seat,s.seven.cardId);s.seven=null;
      history(s,s.players[seat].name+' lässt nach der letzten Zielfigur '+rest+' Schritte der 7 verfallen');
      s.phase='play';s.current=nextSeat(s,seat);settle(s,rng);
    }else{
      const owner=moverOwner(s,seat);
      const p=stepPath(s,action.pieceId,action.steps,!!action.viaGoal,true);
      applyMovement(s,p,true);
      // Forfeiting is possible only immediately after finishing the last
      // pawn; a normal partial move never grants this exception.
      s.seven.canForfeit=completesLastPawn(original,s,owner);
      s.seven.spent+=action.steps;
      history(s,s.players[seat].name+' teilt die 7: '+action.steps+' Felder');
      if(s.seven.spent===7){
        discardCard(s,seat,s.seven.cardId);s.seven=null;
        s.phase='play';s.current=nextSeat(s,seat);settle(s,rng);
      }
    }
  }else if(action.type==='seven'){
    s.phase='seven';s.seven={cardId:action.cardId,spent:0,canForfeit:false,snapshot:clone(s.pieces)};
    history(s,s.players[seat].name+' spielt eine 7');
  }else{
    const c=cardFor(s,seat,action.cardId);
    if(!validateCardChoice(c,action.as))throw Error('BAD_JOKER_CHOICE');
    if(action.type==='start'){
      const p=s.pieces.find(p=>p.id===action.pieceId);
      const target={place:'track',pos:p.owner*16,owner:p.owner};
      const occupant=pieceAt(s,target,p.id);
      if(occupant){
        if(protectedPiece(occupant))throw Error('PROTECTED_FIELD');
        occupant.place='home';occupant.pos=-1;delete occupant.goalReady;
      }
      p.place='track';p.pos=p.owner*16;delete p.goalReady;
    }else if(action.type==='swap'){
      const a=s.pieces.find(p=>p.id===action.pieceId),b=s.pieces.find(p=>p.id===action.targetId);
      const pos=a.pos;a.pos=b.pos;b.pos=pos;
      delete a.goalReady;delete b.goalReady;
    }else if(action.type==='move'){
      const m=stepPath(s,action.pieceId,action.steps,!!action.viaGoal);
      if(!m)throw Error('PATH_INVALID');
      applyMovement(s,m);
    }
    discardCard(s,seat,action.cardId);
    history(s,s.players[seat].name+' spielt '+(c.type==='joker'?'Joker als '+action.as:action.as));
    if(s.phase==='rescue'){s.phase='play';s.rescue=null;}
    s.current=nextSeat(s,seat);settle(s,rng);
  }
  finishIfWon(s);
  // The first player to finish all four pawns ends the match immediately,
  // including during a split seven. Discard its remainder atomically.
  if(s.phase==='finished'&&s.seven){
    if(s.seven.spent<7&&!s.seven.canForfeit)throw Error('SEVEN_REMAINDER_MUST_BE_USED');
    const rest=7-s.seven.spent;
    discardCard(s,seat,s.seven.cardId);
    s.seven=null;
    if(rest>0)history(s,'Letzte Zielfigur erreicht: '+rest+' Restschritte der 7 verfallen');
  }
  s.revision++;
  return s;
}
export function cancelSeven(original,seat){
  if(original.phase!=='seven'||original.current!==seat)throw Error('CANNOT_CANCEL');
  const s=clone(original);s.pieces=s.seven.snapshot;s.seven=null;s.phase='play';s.revision++;return s;
}
function score(s,action,player=s.current){
  if(action.type==='exchange'){
    const card=s.hands[player].find(c=>c.id===action.cardId);
    const partner=(player+2)%4;
    const partnerHasMove=s.pieces.some(p=>p.owner===partner&&p.place==='track');
    return (!partnerHasMove&&['1/11','13','joker'].includes(card.type)?50:0)+(card.type==='swap'?-4:0)+Math.random()*2;
  }
  if(action.type==='start')return 95;
  if(action.type==='emptySwap')return -20;
  if(action.type==='swap')return 18;
  if(action.type==='seven')return 30;
  const p=s.pieces.find(x=>x.id===action.pieceId);
  if(action.type==='move'||action.type==='seven-step'){
    const home=action.to?.startsWith('goal')?150:0;
    const capture=(action.captures||[]).reduce((n,id)=>n+(s.pieces.find(p=>p.id===id).owner%2===player%2?-25:40),0);
    const distance=p.place==='track'?mod(p.owner*16-p.pos):0;
    return home+capture+(action.steps||0)*1.4+(distance<15?12:0)+Math.random()*6;
  }
  return 0;
}
export function botAction(s,seat=s.current){
  const opts=legalActions(s,seat);
  if(!opts.length)return null;
  return [...opts].sort((a,b)=>score(s,b,seat)-score(s,a,seat))[0];
}
export function publicState(s,seat=null){
  const t=clone(s);t.deckCount=t.deck.length;delete t.deck;t.discardCount=t.discard.length;delete t.discard; // lastPlayedCard remains public: only the last played card, never a hidden hand.
  t.hands=t.hands.map((hand,i)=>i===seat?hand:{count:hand.length});
  t.exchanges=t.exchanges.map(x=>x?true:false);
  if(t.seven)delete t.seven.snapshot;
  // The rescue card's stable deck ID reveals its value. Keep it private.
  if(seat!==s.current)delete t.rescue;
  return t;
}
