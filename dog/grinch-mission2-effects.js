/**
 * Grinch Mission 2 - server-authoritative 40-effect slot rules.
 * Pure state adapters. Never imported by classic DOG or mission 1.
 */
export const EFFECT_NAMES=Object.freeze([
 'Großes Erdbeben','Kleines Erdbeben','Schneelawine','Eiskalter Rückzug','Grinchs Fußtritt',
 'Ab nach Hause','Figurenwirbel','Zeitdieb','Nachbeben','Kurz vorm Ziel!',
 'Verflixte 7','Verflixte 8','Zahlentausch','Doppelte Verwirrung','Rückwärtsfluch',
 'Kaputte 13','Schwache Elf','Falscher Tausch','Gefangener Joker','Zahlenwahnsinn',
 'Eisgefängnis','Doppelter Eisfluch','Frostschock','Schneesperre','Rutschiger Boden',
 'Grinch-Fallen','Gefährliche Falle','Vereiste Portale','Schneewand','Frostige Spur',
 'Kartenklau','Kartenverwechslung','Kartenkarussell','Kartenfrost','Grinchs Entscheidung',
 'Verkehrte Reihenfolge','Zwangspause','Grinch steuert!','Kartensteuer','Tauschverbot'
]);
export const EFFECT_IDS=Object.freeze(Array.from({length:40},(_,i)=>i+1));
export const BONUS_PROBABILITY=.10;
export const NEVER_WINNABLE=Object.freeze([10,50,100]);
const start=[0,16,48],mod=x=>(x%64+64)%64,at=p=>mod(start[p.seat]+p.steps);
const active=s=>s.pieces.filter(p=>p.place==='track'&&at(p)%16!==0);
const occupied=s=>new Set(s.pieces.filter(p=>p.place==='track').map(at));
const ownProtected=p=>p?.place==='track'&&at(p)===start[p.seat];
const rand=s=>{s.m2.counter++;let x=(Math.imul((s.seed^Math.imul(s.round,7919)^s.m2.counter)>>>0,1664525)+1013904223)>>>0;return x/4294967296;};
const pick=(s,items)=>items.length?items[Math.floor(rand(s)*items.length)]:null;
const group=id=>Math.floor((id-1)/10);
const log=(s,message)=>{s.history.unshift(message);s.history=s.history.slice(0,12);};
const clearField=p=>{p.place='home';p.steps=-1;};
const unoccupied=(s,exclude=[])=>Array.from({length:64},(_,i)=>i).filter(i=>i%16!==0&&!occupied(s).has(i)&&!exclude.includes(i));
function retreat(s,p,distance,forward=false){
 if(!p||p.place!=='track'||ownProtected(p))return 0;
 let moved=0;
 for(let i=0;i<distance;i++){
  const next=p.steps+(forward?1:-1);
  if(next<0||next>=64)break; // forced moves never teleport or leave own start gate
  const position=mod(start[p.seat]+next);
  if(occupied(s).has(position))break;
  // A special event cannot place a pawn onto ANY occupied/colored starting square.
  if(position%16===0)break;
  p.steps=next;moved++;
 }
 return moved;
}
function quake(s,steps){
 let moved=0;
 for(let n=0;n<steps;n++){
  const before=occupied(s),changes=[];
  for(const p of active(s)){
   const dst=p.steps-1;
   if(dst<0)continue;
   const field=mod(start[p.seat]+dst);
   if(field%16===0||before.has(field))continue;
   changes.push(p);
  }
  changes.forEach(p=>p.steps--);moved+=changes.length;
 }
 return moved;
}
function drawCard(s){
 if(!s.draw.length){
  if(!s.discard.length)return null;
  // Use the existing deterministic mix, never introduce extra cards.
  s.draw=s.discard.splice(0);
  for(let i=s.draw.length-1;i>0;i--){
   const j=Math.floor(rand(s)*(i+1));[s.draw[i],s.draw[j]]=[s.draw[j],s.draw[i]];
  }
 }
 return s.draw.pop()||null;
}
function replaceCard(s,seat,selector){
 const hand=s.hands[seat],index=selector(hand);
 if(index<0)return false;
 const original=hand.splice(index,1)[0];s.discard.push(original);
 const card=drawCard(s);
 if(card)hand.push(card);
 else hand.push(s.discard.pop()); // conserve 110 card IDs even in tiny end-decks
 return true;
}
const numbers=hand=>hand.map((c,i)=>({i,value:/^\d+$/.test(c.type)?Number(c.type):c.type==='1/11'?11:-1})).filter(c=>c.value>0);
const hazardNames={endblock:'Schneesperre',slip:'Rutschiger Boden',trap:'Grinch-Falle',home:'Gefährliche Falle',wall:'Schneewand'};
function hazard(s,type,n,duration=3){
 const fields=[],until=s.turn+duration;
 for(let k=0;k<n;k++){
  const position=pick(s,unoccupied(s,fields));
  if(position===null)break;
  fields.push(position);s.m2.hazards.push({field:position,type,until,used:false});
 }
 return fields.length;
}
const noMoves=s=>active(s).length===0;
function eligible(s,id){
 if(id>=1&&id<=5||id===9||id===10)return active(s).some(p=>p.steps>0);
 if(id===6||id===21||id===22||id===38)return active(s).length>0;
 if(id===7)return active(s).length>=2;
 if(id===8)return !!s.m2.lastMotion;
 if(id===31||id===32||id===33||id===34||id===35||id===37)return s.hands.some(h=>h.length>0);
 if(id===39)return s.hands.some(h=>numbers(h).length>0);
 if(id===25||id===26||id===27||id===24||id===29)return unoccupied(s).length>=3;
 return true;
}
function record(s,id){
 if(!Number.isInteger(id)||id<1||id>40)throw Error('INVALID_GRINCH_EFFECT');
 const name=EFFECT_NAMES[id-1];
 let detail='';
 switch(id){
  case 1:detail=quake(s,3)+' Schritte erzwungen';break;
  case 2:detail=quake(s,1)+' Schritte erzwungen';break;
  case 3:for(let seat=0;seat<3;seat++){const p=active(s).filter(p=>p.seat===seat).sort((a,b)=>b.steps-a.steps)[0];retreat(s,p,5);}break;
  case 4:for(let seat=0;seat<3;seat++){const p=active(s).filter(p=>p.seat===seat).sort((a,b)=>a.steps-b.steps)[0];retreat(s,p,3);}break;
  case 5:retreat(s,pick(s,active(s)),8);break;
  case 6:clearField(pick(s,active(s)));break;
  case 7:{
   const one=pick(s,active(s)),two=pick(s,active(s).filter(p=>p.id!==one?.id));
   if(one&&two){const a=at(one),b=at(two);one.steps=mod(b-start[one.seat]);two.steps=mod(a-start[two.seat]);}
   break;
  }
  case 8:{
   const old=s.m2.lastMotion,p=s.pieces.find(p=>p.id===old?.pieceId);
   if(p?.place==='track'&&p.steps===old.toSteps&&!occupied(s).has(mod(start[p.seat]+old.fromSteps))){
    p.steps=old.fromSteps;detail='Letzte sichere Figurenbewegung zurückgesetzt';
   }
   s.m2.lastMotion=null;
   break;
  }
  case 9:s.m2.afterMovePush=2;break;
  case 10:retreat(s,active(s).sort((a,b)=>b.steps-a.steps)[0],6);break;
  case 11:case 12:case 13:case 14:case 15:case 16:case 17:case 18:case 19:case 20:
   s.m2.cardCurse=id;detail='Bis zum Ende der Kartenphase';break;
  case 21:case 22:{
   const pool=active(s),count=id===21?1:2;
   for(let j=0;j<count&&pool.length;j++){
    const p=pick(s,pool);pool.splice(pool.indexOf(p),1);
    s.m2.frozen[p.id]=true;
   }break;
  }
  case 23:s.m2.skipSeat=pick(s,[0,1,2]);break;
  case 24:hazard(s,'endblock',2);break;
  case 25:hazard(s,'slip',3,999);break;
  case 26:hazard(s,'trap',3,999);break;
  case 27:hazard(s,'home',1,999);break;
  case 28:s.m2.portalUntil=s.turn+3;break;
  case 29:hazard(s,'wall',2);break;
  case 30:s.m2.frostLands=3;break;
  case 31:{const seat=pick(s,[0,1,2].filter(i=>s.hands[i].length));if(seat!==null)replaceCard(s,seat,h=>Math.floor(rand(s)*h.length));break;}
  case 32:{const two=[0,1,2].filter(i=>s.hands[i].length);if(two.length>=2){const a=pick(s,two),b=pick(s,two.filter(i=>i!==a));const ai=Math.floor(rand(s)*s.hands[a].length),bi=Math.floor(rand(s)*s.hands[b].length);[s.hands[a][ai],s.hands[b][bi]]=[s.hands[b][bi],s.hands[a][ai]];}break;}
  case 33:{if(s.hands.every(h=>h.length)){const indexes=s.hands.map(h=>Math.floor(rand(s)*h.length));const picked=s.hands.map((h,i)=>h[indexes[i]]);s.hands[0][indexes[0]]=picked[2];s.hands[1][indexes[1]]=picked[0];s.hands[2][indexes[2]]=picked[1];}break;}
  case 34:{const seat=pick(s,[0,1,2].filter(i=>s.hands[i].length));if(seat!==null)s.m2.lockedCard={seat,id:pick(s,s.hands[seat]).id};break;}
  case 35:{const seat=pick(s,[0,1,2].filter(i=>s.hands[i].length));if(seat!==null)s.m2.forcedCard={seat,id:pick(s,s.hands[seat]).id};break;}
  case 36:s.m2.reverse=true;break;
  case 37:s.m2.skipSeat=pick(s,[0,1,2].filter(i=>s.hands[i].length));break;
  case 38:{const seat=pick(s,[0,1,2].filter(i=>active(s).some(p=>p.seat===i)));if(seat!==null)s.m2.forcedPiece={seat,id:pick(s,active(s).filter(p=>p.seat===seat)).id};break;}
  case 39:for(let seat=0;seat<3;seat++)replaceCard(s,seat,hand=>{const arr=numbers(hand).sort((a,b)=>b.value-a.value);return arr[0]?.i??-1;});break;
  case 40:s.m2.noSwapUntil=s.turn+3;break;
 }
 log(s,'🎰 '+name+(detail?' · '+detail:''));
 return {id,name,category:group(id)};
}
export function initializeMission2(s){
 s.m2={counter:0,spins:[],cardCurse:null,hazards:[],frozen:{},skipSeat:null,afterMovePush:0,portalUntil:-1,noSwapUntil:-1,
  forcedCard:null,forcedPiece:null,lockedCard:null,reverse:false,frostLands:0,lastMotion:null};
 return s;
}
export function slotForNewPhase(s){
 if(!s.m2)initializeMission2(s);
 const m=s.m2;
 m.cardCurse=null;m.hazards=[];m.frozen={};m.skipSeat=null;m.afterMovePush=0;m.portalUntil=-1;m.noSwapUntil=-1;
 m.forcedCard=null;m.forcedPiece=null;m.lockedCard=null;m.reverse=false;m.frostLands=0;
 const available=EFFECT_IDS.filter(id=>eligible(s,id));
 const first=pick(s,available),effects=[record(s,first)];
 const double=rand(s)<BONUS_PROBABILITY;
 if(double){
  const second=pick(s,EFFECT_IDS.filter(id=>group(id)!==group(first)&&eligible(s,id)));
  if(second)effects.push(record(s,second));
 }
 m.spins.push({round:s.round,effects,double:effects.length===2});
 m.spins=m.spins.slice(-4);
 return effects;
}
export function effectiveCardTypes(s,card,types){
 const curse=s.m2?.cardCurse;
 if(curse===19&&card.type==='joker')return types.filter(t=>t!=='swap'&&t!=='7');
 if(card.type==='joker')return types; // Joker chooses original types; value rules adapt below.
 const swaps={11:{'7':'8'},12:{'8':'7'},13:{'2':'12','12':'2'},
  14:{'5':'10','10':'5'},18:{swap:'6'},20:{'3':'9','9':'3'}};
 return types.map(type=>swaps[curse]?.[type]||type);
}
export function mission2Values(s,type,original){
 const curse=s.m2?.cardCurse;
 if(type==='4')return curse===15?[-4]:[4,-4];
 if(type==='13'&&curse===16)return [3];
 if(type==='1/11'&&curse===17)return [1];
 if(type==='1/11')return [1,11];
 if(type==='7'||type==='swap'||type==='joker')return [];
 return /^\d+$/.test(type)?[Number(type)]:[];
}
export function moveAllowedByCurse(s,seat,card,pieceId,type,fromSteps,toSteps,distance){
 const m=s.m2;
 if(!m)return true;
 if(m.lockedCard?.seat===seat&&m.lockedCard.id===card.id)return false;
 if(m.forcedCard?.seat===seat&&m.forcedCard.id!==card.id)return false;
 if(m.forcedPiece?.seat===seat&&m.forcedPiece.id!==pieceId)return false;
 if(type==='swap'&&s.turn<m.noSwapUntil)return false;
 if(toSteps===64&&s.turn<m.portalUntil)return false;
 if(toSteps>=0&&toSteps<64&&m.hazards.some(h=>h.type==='endblock'&&h.until>s.turn&&h.field===mod(start[seat]+toSteps)))return false;
 if(fromSteps!==null&&distance!==null){
  for(let i=1;i<=Math.abs(distance);i++){
   const p=mod(start[seat]+fromSteps+i*Math.sign(distance));
   if(m.hazards.some(h=>h.type==='wall'&&h.until>s.turn&&h.field===p))return false;
  }
 }
 return !m.frozen[pieceId];
}
export function afterMission2Card(s,seat,chosen,originalPiece){
 const m=s.m2;
 if(!m)return;
 const p=s.pieces.find(x=>x.id===chosen.pieceId);
 if(chosen.kind==='move'||chosen.kind==='seven'){
  if(p?.place==='track'&&originalPiece?.place==='track'&&!(chosen.captureIds||[]).length)
   m.lastMotion={pieceId:p.id,fromSteps:originalPiece.steps,toSteps:p.steps};
  else m.lastMotion=null;
 }
 if(p?.place==='track'){
  if(m.afterMovePush){retreat(s,p,m.afterMovePush);m.afterMovePush=0;}
  const field=at(p);
  for(const hazard of m.hazards){
   if(hazard.used||hazard.until<=s.turn||hazard.field!==field)continue;
   hazard.used=true;
   if(hazard.type==='slip')retreat(s,p,2,true);
   if(hazard.type==='trap')retreat(s,p,4);
   if(hazard.type==='home')clearField(p);
   log(s,'❄️ '+(hazardNames[hazard.type]||'Grinch-Effekt')+' auf Feld '+hazard.field);
   break;
  }
  if(m.frostLands>0&&p.place==='track'){m.frostLands--;m.frozen[p.id]=true;}
 }
 if(m.forcedCard?.seat===seat)m.forcedCard=null;
 if(m.forcedPiece?.seat===seat)m.forcedPiece=null;
 if(m.lockedCard?.seat===seat)m.lockedCard=null;
 // Freeze lasts only through its owner's next completed turn.
 for(const [id] of Object.entries(m.frozen)){
  const pawn=s.pieces.find(p=>p.id===id);
  if(pawn?.seat===seat)delete m.frozen[id];
 }
 m.hazards=m.hazards.filter(h=>!h.used&&h.until>s.turn);
}
export function mission2TurnAdvance(s,seat){
 const m=s.m2;if(!m)return false;
 if(m.skipSeat!==seat)return false;
 m.skipSeat=null;
 const card=s.hands[seat].shift();
 if(card)s.discard.push(card);
 log(s,'⏸️ '+s.players[seat].name+' muss aussetzen und legt eine Karte ab.');
 return true;
}
export function mission2TurnDirection(s){return s.m2?.reverse?-1:1;}
export function projectedMission2(s){
 if(!s?.m2)return;
 delete s.m2.lastMotion;delete s.m2.counter;
 // No future events or player cards are included in mission2 metadata.
}
