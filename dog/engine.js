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
function allInGoal(s,seat){return s.pieces.filter(x=>x.owner===seat).every(x=>x.place==='goal');}
function moverOwner(s,seat){return allInGoal(s,seat)?(seat+2)%4:seat;}
function pieceAt(s,space,except){
  return s.pieces.find(p=>p.id!==except && p.place===space.place && p.pos===space.pos && (space.place!=='goal'||p.owner===space.owner));
}
function protectedPiece(p){return p.place==='track'&&p.pos===p.owner*16;}
function validateCardChoice(card,as){
  return card.type==='joker' ? CARD_TYPES.filter(t=>t!=='joker').includes(as) : card.type===as;
}
function replacePosition(p,pathStep){p.place=pathStep.place;p.pos=pathStep.pos;}
function stepPath(s,id,count,homeChoice,seven=false){
  const piece=s.pieces.find(p=>p.id===id);
  if(!piece||piece.place==='home'||!Number.isInteger(count)||count===0)return null;
  let current={place:piece.place,pos:piece.pos,owner:piece.owner};
  let entering=false, cameFromBehind=false;
  const path=[];const captures=[];
  for(let i=0;i<Math.abs(count);i++){
    if(current.place==='goal'){
      if(count<0)return null;
      current={...current,pos:current.pos+1};
      if(current.pos>=4)return null;
    }else{
      const oldPos=current.pos;
      const newPos=mod(oldPos+(count>0?1:-1));
      if(count>0 && newPos===piece.owner*16 && oldPos!==newPos)cameFromBehind=true;
      if(count>0 && homeChoice && oldPos===piece.owner*16 && cameFromBehind){
        current={place:'goal',pos:0,owner:piece.owner};entering=true;
      }else current={place:'track',pos:newPos,owner:piece.owner};
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
  return {pieceId:id,steps:count,viaGoal:entering,homeChoice:!!homeChoice,path,captures:[...new Set(captures)]};
}
function applyMovement(s,m,seven=false){
  const piece=s.pieces.find(p=>p.id===m.pieceId);
  for(let i=0;i<m.path.length;i++){
    const next=m.path[i];
    const occupant=pieceAt(s,next,piece.id);
    if(occupant && (seven || i===m.path.length-1)){
      if(protectedPiece(occupant))throw Error('PROTECTED_FIELD');
      occupant.place='home';occupant.pos=-1;
    }
    replacePosition(piece,next);
  }
}
export function createGame(options={}){
  const rng=options.rng||Math.random;
  const names=Array.isArray(options.names)?options.names:['Du','Blau','Grün','Gelb'];
  const bots=Array.isArray(options.bots)?options.bots:[false,true,true,true];
  const s={schemaVersion:1,ruleset:RULESET.id,phase:'exchange',round:0,revision:0,starter:0,current:0,players:Array.from({length:4},(_,seat)=>({seat,name:String(names[seat]||'Spieler '+(seat+1)).slice(0,25),bot:!!bots[seat],team:seat%2})),pieces:Array.from({length:16},(_,i)=>({id:i,owner:Math.floor(i/4),place:'home',pos:-1})),hands:[[],[],[],[]],exchanges:[null,null,null,null],deck:shuffle(makeDeck(),rng),discard:[],seven:null,winner:null,history:[]};
  deal(s,rng);return s;
}
function history(s,text){s.history.unshift(text);s.history.length=Math.min(s.history.length,12);}
function deal(s,rng){
  s.round++;
  const count=[6,5,4,3,2][(s.round-1)%5];
  s.starter=(s.round-1)%4;s.current=s.starter;s.phase='exchange';
  s.exchanges=[null,null,null,null];
  s.seven=null;
  s.hands=[[],[],[],[]];
  for(let n=0;n<count;n++)for(let seat=0;seat<4;seat++){
    if(s.deck.length===0)s.deck=shuffle(s.discard.splice(0),rng);
    if(s.deck.length===0)throw Error('NO_CARDS');
    s.hands[seat].push(s.deck.pop());
  }
  history(s,'Runde '+s.round+': '+count+' Karten pro Person');
}
export function exchangeCard(original,seat,cardId){
  const s=clone(original);
  if(s.phase!=='exchange'||s.exchanges[seat]!==null)throw Error('EXCHANGE_NOT_ALLOWED');
  const hand=s.hands[seat],at=hand.findIndex(x=>x.id===cardId);
  if(at<0)throw Error('CARD_NOT_HELD');
  s.exchanges[seat]=hand.splice(at,1)[0];
  if(s.exchanges.every(Boolean)){
    for(let i=0;i<4;i++)s.hands[(i+2)%4].push(s.exchanges[i]);
    s.exchanges=[null,null,null,null];s.phase='play';s.current=s.starter;
    history(s,'Alle Partnerkarten wurden verdeckt getauscht');
    settle(s);
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
function canSeven(s,seat,left,depth=0){
  if(left===0)return true;
  if(depth>=7)return false;
  const own=moverOwner(s,seat);
  const available=s.pieces.filter(p=>p.owner===own&&p.place!=='home');
  for(const p of available)for(let n=1;n<=left;n++)for(const via of [false,true]){
    const path=stepPath(s,p.id,n,via,true);
    if(!path||via&&!path.viaGoal)continue;
    const next=clone(s);applyMovement(next,path,true);
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
    if(canSeven(next,seat,left-m.steps))good.push({...m,captures:path.captures});
  }
  return good;
}
export function legalActions(s,seat=s.current){
  if(s.phase==='exchange')return s.exchanges[seat]===null?s.hands[seat].map(c=>({type:'exchange',cardId:c.id})): [];
  if(s.phase==='seven'){
    if(s.current!==seat)return [];
    return winningSevenMoves(s,seat,7-s.seven.spent);
  }
  if(s.phase!=='play'||s.current!==seat)return [];
  const list=[];
  for(const card of s.hands[seat])for(const as of card.type==='joker'?CARD_TYPES.filter(t=>t!=='joker'):[card.type]){
    if(as==='7'){
      if(canSeven(s,seat,7))list.push({type:'seven',cardId:card.id,as});
    }else list.push(...candidateMoves(s,seat,card,as));
  }
  return list;
}
function finishIfWon(s){
  for(const team of [0,1]){
    if(s.pieces.filter(p=>p.owner%2===team).every(p=>p.place==='goal')){
      s.winner=team;s.phase='finished';history(s,'Team '+(team===0?'Rot/Grün':'Blau/Gelb')+' gewinnt!');
      return true;
    }
  }
  return false;
}
function settle(s,rng=Math.random){
  if(finishIfWon(s))return;
  let guard=0;
  while(s.phase==='play'&&++guard<30){
    if(s.hands.every(h=>h.length===0)){deal(s,rng);return;}
    if(s.hands[s.current].length===0){s.current=(s.current+1)%4;continue;}
    const acts=legalActions(s,s.current);
    if(acts.length)break;
    s.discard.push(...s.hands[s.current].splice(0));
    history(s,s.players[s.current].name+' kann nicht ziehen und legt die Hand ab');
    s.current=(s.current+1)%4;
  }
  if(guard>=30)throw Error('TURN_LOOP');
}
function cardFor(s,seat,id){const c=s.hands[seat].find(x=>x.id===id);if(!c)throw Error('CARD_NOT_HELD');return c;}
function discardCard(s,seat,id){const index=s.hands[seat].findIndex(x=>x.id===id);if(index<0)throw Error('CARD_NOT_HELD');s.discard.push(s.hands[seat].splice(index,1)[0]);}
export function takeAction(original,seat,action,rng=Math.random){
  const s=clone(original);
  if(s.phase==='exchange')return exchangeCard(s,seat,action.cardId);
  if(s.current!==seat)throw Error('NOT_YOUR_TURN');
  const avail=legalActions(s,seat);
  const found=avail.find(m=>m.type===action.type&&m.cardId===action.cardId&&m.as===action.as&&m.pieceId===action.pieceId&&m.targetId===action.targetId&&m.steps===action.steps&&m.viaGoal===action.viaGoal);
  if(!found)throw Error('ILLEGAL_ACTION');
  if(s.phase==='seven'){
    const p=stepPath(s,action.pieceId,action.steps,!!action.viaGoal,true);
    applyMovement(s,p,true);
    s.seven.spent+=action.steps;
    history(s,s.players[seat].name+' teilt die 7: '+action.steps+' Felder');
    if(s.seven.spent===7){
      discardCard(s,seat,s.seven.cardId);s.seven=null;
      s.phase='play';s.current=(seat+1)%4;settle(s,rng);
    }
  }else if(action.type==='seven'){
    s.phase='seven';s.seven={cardId:action.cardId,spent:0,snapshot:clone(s.pieces)};
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
        occupant.place='home';occupant.pos=-1;
      }
      p.place='track';p.pos=p.owner*16;
    }else if(action.type==='swap'){
      const a=s.pieces.find(p=>p.id===action.pieceId),b=s.pieces.find(p=>p.id===action.targetId);
      const pos=a.pos;a.pos=b.pos;b.pos=pos;
    }else if(action.type==='move'){
      const m=stepPath(s,action.pieceId,action.steps,!!action.viaGoal);
      if(!m)throw Error('PATH_INVALID');
      applyMovement(s,m);
    }
    discardCard(s,seat,action.cardId);
    history(s,s.players[seat].name+' spielt '+(c.type==='joker'?'Joker als '+action.as:action.as));
    s.current=(seat+1)%4;settle(s,rng);
  }
  finishIfWon(s);s.revision++;
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
  const t=clone(s);t.deckCount=t.deck.length;delete t.deck;t.discardCount=t.discard.length;delete t.discard;
  t.hands=t.hands.map((hand,i)=>i===seat?hand:{count:hand.length});
  t.exchanges=t.exchanges.map(x=>x?true:false);
  if(t.seven)delete t.seven.snapshot;
  return t;
}
