/**
 * DOG Grinch campaign – Mission 3, isolated gameplay foundation (packages 1 & 2).
 * This module has NO imports from, or writes to, classic DOG or missions 1–2.
 * Campaign tasks, scripted attacks, smart AI, official online launch and rewards
 * are intentionally not activated in this foundation.
 */
export const MISSION3_ID=3;
export const MISSION3_TRACK=64;
export const MISSION3_GRINCH=3;
export const MISSION3_STARTS=Object.freeze([0,16,48,32]);
export const MISSION3_COLORS=Object.freeze(['#e45b55','#499cf2','#eac04d','#43c66c']);
export const MISSION3_TYPES=Object.freeze(['1/11','2','3','4','5','6','7','8','9','10','12','13','swap','joker']);
export const MISSION3_STAGE_NAMES=Object.freeze(['Die Weihnachtslichter','Der Eisbrecher','Die magische Versiegelung']);
const copy=x=>JSON.parse(JSON.stringify(x));
const mod=n=>(n%MISSION3_TRACK+MISSION3_TRACK)%MISSION3_TRACK;
function random(seed){let v=(seed>>>0)||1;return ()=>((v=(Math.imul(v,1664525)+1013904223)>>>0)/4294967296);}
function shuffle(list,rng){const arr=[...list];for(let i=arr.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr;}
function newDeck(rng){
 let id=0;
 return shuffle(MISSION3_TYPES.flatMap(type=>Array.from({length:type==='joker'?6:8},()=>({id:++id,type}))),rng);
}
function record(s,message){s.history.unshift(message);s.history.length=Math.min(14,s.history.length);}
export const mission3CardTotal=s=>s.draw.length+s.discard.length+s.hands.reduce((n,hand)=>n+hand.length,0);
export const mission3HandSize=(stage,seat)=>seat===MISSION3_GRINCH?6*(stage+1):6;
export const mission3Start=owner=>MISSION3_STARTS[owner];
export function mission3Protected(p){return Boolean(p&&p.place==='track'&&p.pos===MISSION3_STARTS[p.owner]);}
function onField(s,field,except=null){return s.pieces.find(p=>p.place==='track'&&p.pos===field&&p.id!==except);}
function owned(s,owner){return s.pieces.filter(p=>p.owner===owner);}
function cardSteps(type){
 if(type==='4')return [4,-4];
 if(type==='1/11')return [1,11];
 if(type==='swap'||type==='joker'||type==='7')return [];
 return /^\d+$/.test(type)?[Number(type)]:[];
}
function deal(s){
 s.phase++;
 s.stageAtDeal=s.stage;
 const count=Array.from({length:4},(_,i)=>mission3HandSize(s.stageAtDeal,i));
 s.hands=[[],[],[],[]];
 for(let n=0;n<Math.max(...count);n++){
  for(let seat=0;seat<4;seat++){
   if(n>=count[seat])continue;
   if(!s.draw.length){
    if(!s.discard.length)throw Error('Der DOG-Kartenstapel ist leer.');
    s.draw=shuffle(s.discard.splice(0),random(s.seed^Math.imul(s.phase,15485863)));
   }
   s.hands[seat].push(s.draw.pop());
  }
 }
 s.current=0;s.grinchActionsLeft=0;s.grinchUsed=[];s.seven=null;
 s.lastEvent={type:'deal',phase:s.phase,stage:s.stageAtDeal};
 record(s,'🃏 Kartenphase '+s.phase+': Menschen je 6, Grinch '+count[3]+' Karten.');
}
export function createMission3(seed=Math.floor(Math.random()*2147483647),names=['Rot','Blau','Gelb']){
 if(!Number.isInteger(seed))throw Error('Ungültiger Seed');
 const rng=random(seed),places=shuffle(Array.from({length:64},(_,i)=>i),rng);
 const players=[
  ...['Rot','Blau','Gelb'].map((name,owner)=>({owner,name:String(names[owner]||name).slice(0,25),kind:'human'})),
  {owner:3,name:'Grinch',kind:'ai'}
 ];
 let at=0;
 const pieces=players.flatMap(p=>Array.from({length:p.owner===MISSION3_GRINCH?5:3},(_,n)=>({
  id:['r','b','y','g'][p.owner]+n,owner:p.owner,place:'track',pos:places[at++],frozenTurns:0,captured:false
 })));
 const s={version:1,mission:3,prototype:true,seed,players,pieces,
  current:0,turn:0,phase:0,stage:0,stageAtDeal:0,
  draw:newDeck(rng),discard:[],hands:[[],[],[],[]],seven:null,
  grinchActionsLeft:0,grinchUsed:[],history:[],lastPlayedCard:null,lastEvent:null,
  capturedPerHuman:[0,0,0],tasks:null,revision:0};
 deal(s);settle(s);
 return s;
}
function relocate(s,victim,attackerOwner,reservedLanding=null){
 if(attackerOwner===MISSION3_GRINCH){
  const gate=mission3Start(victim.owner);
  const occupied=onField(s,gate,victim.id);
  if(occupied||gate===reservedLanding){victim.place='home';victim.pos=-1;return 'Haus';}
  victim.place='track';victim.pos=gate;return 'Startfeld';
 }
 victim.place='home';victim.pos=-1;return 'Haus';
}
function path(s,p,distance,split=false){
 if(!p||p.place!=='track'||!Number.isInteger(distance)||distance===0)return null;
 const captureIds=[];
 const step=Math.sign(distance);
 for(let i=1;i<=Math.abs(distance);i++){
  const field=mod(p.pos+step*i),other=onField(s,field,p.id);
  if(!other||captureIds.includes(other.id))continue;
  const final=i===Math.abs(distance);
  if(other.owner===p.owner){
   if(final)return null;
   if(other.owner!==MISSION3_GRINCH&&mission3Protected(other))return null;
   continue;
  }
  if(p.owner!==MISSION3_GRINCH&&other.owner===MISSION3_GRINCH){
   if(final||split)return null; // Grinch is invincible
   continue; // passing an occupied regular field does not capture
  }
  if(mission3Protected(other)){
   if(p.owner===MISSION3_GRINCH){if(final)return null;else continue;} // Grinch can pass safe starts
   return null;
  }
  if(split||final)captureIds.push(other.id);
 }
 return {to:mod(p.pos+distance),captureIds};
}
function applyMovement(s,pieceId,distance,split){
 const pawn=s.pieces.find(p=>p.id===pieceId);
 const route=path(s,pawn,distance,split);
 if(!route)throw Error('Dieser Weg ist blockiert.');
 for(const id of route.captureIds){
  const victim=s.pieces.find(p=>p.id===id);
  const where=relocate(s,victim,pawn.owner,route.to);
  record(s,(pawn.owner===3?'😈 Grinch':s.players[pawn.owner].name)+' schlägt '+s.players[victim.owner].name+' → '+where);
 }
 pawn.pos=route.to;
 return route;
}
function sevenOptions(s,seat,remaining,cardId){
 const result=[];
 for(const p of owned(s,seat).filter(p=>p.place==='track'&&(seat!==3||!s.grinchUsed.includes(p.id)))){
  for(let distance=1;distance<=remaining;distance++){
   const route=path(s,p,distance,true);
   if(route)result.push({kind:'seven',pieceId:p.id,cardId,as:'7',distance,to:route.to,captureIds:route.captureIds});
  }
 }
 return result;
}
function canFinishSeven(s,seat,left,cardId,seen=new Set()){
 if(left===0)return true;
 const key=left+'|'+s.pieces.map(p=>p.id+':'+p.place+':'+p.pos).join(';');
 if(seen.has(key))return false;
 seen.add(key);
 for(const choice of sevenOptions(s,seat,left,cardId).sort((a,b)=>b.distance-a.distance)){
  const next=copy(s);
  applyMovement(next,choice.pieceId,choice.distance,true);
  if(canFinishSeven(next,seat,left-choice.distance,cardId,seen))return true;
 }
 return false;
}
export function mission3LegalMoves(s,seat=s?.current){
 if(!s||seat!==s.current||!Number.isInteger(seat)||seat<0||seat>3)return [];
 const hand=s.hands[seat],pending=s.seven;
 const result=[];
 for(const card of hand){
  if(pending&&pending.cardId!==card.id)continue;
  const types=pending?[pending.as]:card.type==='joker'?MISSION3_TYPES.filter(x=>x!=='joker'):[card.type];
  for(const as of types){
   if(as==='7'){
    const left=pending?7-pending.spent:7;
    for(const option of sevenOptions(s,seat,left,card.id)){
     const next=copy(s);applyMovement(next,option.pieceId,option.distance,true);
     if(canFinishSeven(next,seat,left-option.distance,card.id))result.push(option);
    }
    continue;
   }
   if(pending)continue;
   if((as==='1/11'||as==='13')&&seat!==MISSION3_GRINCH){
    for(const pawn of owned(s,seat).filter(p=>p.place==='home')){
     const at=onField(s,MISSION3_STARTS[seat],pawn.id);
     if(!at||(!mission3Protected(at)&&at.owner!==MISSION3_GRINCH))
      result.push({kind:'start',cardId:card.id,as,pieceId:pawn.id});
    }
   }
   if(as==='swap'){
    const sources=owned(s,seat).filter(p=>p.place==='track'&&!mission3Protected(p)&&!s.grinchUsed.includes(p.id));
    const targets=s.pieces.filter(p=>p.owner!==seat&&p.place==='track'&&!mission3Protected(p)&&
      (seat===MISSION3_GRINCH||p.owner!==MISSION3_GRINCH));
    let total=0;
    for(const a of sources)for(const b of targets){
     total++;result.push({kind:'swap',cardId:card.id,as,pieceId:a.id,targetId:b.id});
    }
    if(!total)result.push({kind:'emptySwap',cardId:card.id,as});
    continue;
   }
   for(const distance of cardSteps(as))for(const p of owned(s,seat).filter(p=>p.place==='track')){
    if(seat===MISSION3_GRINCH&&s.grinchUsed.includes(p.id))continue;
    const r=path(s,p,distance);
    if(r)result.push({kind:'move',cardId:card.id,as,pieceId:p.id,distance,to:r.to,captureIds:r.captureIds});
   }
  }
 }
 return result;
}
function advance(s){
 if(s.current===3){
  s.grinchActionsLeft--;
  if(s.grinchActionsLeft>0&&s.hands[3].length)return;
  s.grinchActionsLeft=0;s.grinchUsed=[];s.current=0;
 }else if(s.current===2){
  s.current=3;s.grinchActionsLeft=s.stageAtDeal+1;s.grinchUsed=[];
 }else s.current++;
 s.turn++;
}
function settle(s){
 for(let guard=0;guard<360;guard++){
  if(s.hands.every(h=>h.length===0)){deal(s);continue;}
  if(s.seven)return;
  if(s.current===3&&s.grinchActionsLeft<=0)s.grinchActionsLeft=s.stageAtDeal+1;
  if(s.hands[s.current].length&&mission3LegalMoves(s,s.current).length)return;
  if(s.hands[s.current].length){
   record(s,s.players[s.current].name+' kann nicht ziehen und legt '+s.hands[s.current].length+' Karte(n) ab.');
   s.discard.push(...s.hands[s.current].splice(0));
  }
  if(s.hands.every(h=>h.length===0)){deal(s);continue;}
  if(s.current===3)s.grinchActionsLeft=1;
  advance(s);
 }
 throw Error('Mission 3: Kein gültiger Zug nach mehreren Kartenphasen.');
}
export function mission3Play(original,seat,action){
 if(!original||seat!==original.current)throw Error('Du bist nicht am Zug.');
 const options=mission3LegalMoves(original,seat);
 const chosen=options.find(m=>m.kind===action.kind&&m.cardId===action.cardId&&m.as===action.as&&
  m.pieceId===action.pieceId&&m.targetId===action.targetId&&m.distance===action.distance);
 if(!chosen)throw Error('Ungültiger Mission-3-Zug.');
 const s=copy(original);
 const card=s.hands[seat].find(c=>c.id===chosen.cardId);
 if(chosen.kind==='start'){
  const pawn=s.pieces.find(p=>p.id===chosen.pieceId),other=onField(s,MISSION3_STARTS[seat],pawn.id);
  if(other){if(other.owner===3||mission3Protected(other))throw Error('Geschütztes Startfeld.');relocate(s,other,seat);}
  pawn.place='track';pawn.pos=MISSION3_STARTS[seat];
 }else if(chosen.kind==='move'||chosen.kind==='seven'){
  applyMovement(s,chosen.pieceId,chosen.distance,chosen.kind==='seven');
 }else if(chosen.kind==='swap'){
  const pawn=s.pieces.find(p=>p.id===chosen.pieceId),other=s.pieces.find(p=>p.id===chosen.targetId);
  const temp=pawn.pos;pawn.pos=other.pos;other.pos=temp;
 }
 if(chosen.kind==='seven'){
  if(!s.seven)s.seven={seat,cardId:chosen.cardId,as:'7',spent:0};
  s.seven.spent+=chosen.distance;
  if(s.seven.spent<7){
   record(s,s.players[seat].name+' teilt die 7: '+s.seven.spent+'/7 Schritte.');
   s.revision++;return s;
  }
  s.seven=null;
 }
 const i=s.hands[seat].findIndex(c=>c.id===card.id);
 s.discard.push(s.hands[seat].splice(i,1)[0]);
 s.lastPlayedCard=card.type;
 record(s,(seat===3?'😈 Grinch':s.players[seat].name)+' spielt '+(card.type==='joker'?'Joker als '+chosen.as:chosen.as));
 if(seat===3&&chosen.pieceId&&!s.grinchUsed.includes(chosen.pieceId))s.grinchUsed.push(chosen.pieceId);
 advance(s);settle(s);
 if(mission3CardTotal(s)!==110)throw Error('DOG-Kartenbestand beschädigt.');
 s.revision++;return s;
}
/** Preview stage change only; 6/12/18 hands take effect on the NEXT deal. */
export function mission3SetPreviewStage(original,stage){
 if(!Number.isInteger(stage)||stage<0||stage>2)throw Error('Ungültige Missionsstufe');
 const s=copy(original);s.stage=stage;s.revision++;
 record(s,'🧪 Testvorschau: '+MISSION3_STAGE_NAMES[stage]+'. Neue Grinch-Hand ab nächster Verteilung.');
 return s;
}
/** Local preview ONLY: end the current phase while keeping all 110 card IDs. */
export function mission3NextPreviewDeal(original){
 const s=copy(original);
 for(const hand of s.hands)s.discard.push(...hand);
 s.hands=[[],[],[],[]];s.seven=null;
 deal(s);settle(s);s.revision++;
 if(mission3CardTotal(s)!==110)throw Error('DOG-Kartenbestand beschädigt.');
 return s;
}
export function mission3ChooseGrinchMove(s){
 if(s.current!==3)return null;
 const moves=mission3LegalMoves(s,3);
 if(!moves.length)return null;
 // Baseline bot for the local foundation ONLY. Tactical lookahead follows in package 3.
 return [...moves].sort((a,b)=>{
  const score=x=>(x.captureIds?.length||0)*100+(x.kind==='swap'?12:0)+
   (x.kind==='move'&&x.distance>0?x.distance:0)+(x.kind==='seven'?x.distance:0);
  return score(b)-score(a)||a.cardId-b.cardId||String(a.pieceId).localeCompare(String(b.pieceId));
 })[0];
}
export function mission3AutoGrinch(original){
 let s=original;let guard=0;
 while(s.current===3&&guard++<25){
  const chosen=mission3ChooseGrinchMove(s);
  if(!chosen)throw Error('Die Grinch-Hand enthält keinen gültigen Zug.');
  s=mission3Play(s,3,chosen);
 }
 if(guard>=25)throw Error('Grinch: zu viele Figurenaktionen.');
 return s;
}
export function mission3Projection(raw,viewerSeat=null){
 const s=copy(raw),seat=Number.isInteger(viewerSeat)&&viewerSeat>=0&&viewerSeat<3?viewerSeat:null;
 s.handCounts=s.hands.map(hand=>hand.length);
 s.hands=s.hands.map((hand,i)=>i===seat?hand:[]);
 s.drawCount=s.draw.length;s.discardCount=s.discard.length;
 s.draw=[];s.discard=[];s.seed=null;s.viewerSeat=seat;
 return s;
}
export function mission3Validate(s){
 if(!s||s.version!==1||s.mission!==3||!Array.isArray(s.pieces)||s.pieces.length!==14||
  !Array.isArray(s.hands)||s.hands.length!==4||!Array.isArray(s.players)||s.players.length!==4)return false;
 if(!s.pieces.every(p=>['track','home','captured'].includes(p.place)||p.place==='lost'))return false;
 const occupied=s.pieces.filter(p=>p.place==='track').map(p=>p.pos);
 return occupied.length===new Set(occupied).size&&mission3CardTotal(s)===110;
}
