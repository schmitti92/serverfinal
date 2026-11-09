import {randomInt} from 'node:crypto';

// Keep ids christmas-01 .. christmas-32 unchanged: existing profiles store them.
// The two new 4x4 fields use persistent IDs christmas-33 .. christmas-64.
export const CHRISTMAS_RARITIES=Object.freeze(['common','rare','epic','legendary']);
const ORIGINAL_NAMES=["Winterdorf","Lebkuchenhaus","Weihnachtsmann","Rentier","Weihnachtsbaum","Weihnachtszug","Schneekugel","Wichtelwerkstatt","Polarlichter","Eisschloss","Rentierschlitten","Weihnachtslaterne","Weihnachtsengel","Adventskerzen","Schneemannfamilie","Weihnachtskrippe","Schneemann","Weihnachtsengel","Rentier im Schnee","Weihnachtsbaum im Glanz","Lebkuchenmann","Weihnachtskranz","Schlittenfahrt","Stern von Bethlehem","Elfenhilfe","Weihnachtspinguin","Polarbär","Weihnachtsglocken","Kerzenschein","Winterdorf im Schnee","Geschenkstapel","Schneeflocke"];
const HAMMER_NAMES=["Winterwanderung zur Berghütte","Plätzchenbacken mit Opa","Weihnachtsmarkt zu zweit","Punsch am Weihnachtsmarkt","Gemeinsam den Baum schmücken","Geschenke liebevoll einpacken","Winterlicher Marktspaziergang","Plätzchen mit den Großeltern","Der Stern auf dem Weihnachtsbaum","Bescherung unterm Weihnachtsbaum","Winterdorf bei Sonnenuntergang","Winterhütte im Abendlicht","Festlicher Waldweg","Verschneiter Waldpfad","Berghütte im Sonnenlicht","Weihnachtsmarkt im Winterdorf","Weihnachtsleuchtturm am Meer","Wintersee im Abendrot","Eislaufen am Wintersee","Weihnachtszug durch die Berge","Verschneite Brücke am Bach","Weihnachtsdorf im Bergtal","Weihnachtsmarkt im Schneetreiben","Bergdorf in der Abenddämmerung","Wintersee beim Sonnenaufgang","Berghütte in der Winternacht","Weihnachtsmarkt im Lichterglanz","Festlicher Baum im Winterwald","Waldhütte im Abendrot","Alpenhütte im Sonnenuntergang","Laternenweg zur Winterkapelle","Weihnachtsdorf am Bergsee"];
const BINGO_LINES=Object.freeze([
 ...Array.from({length:4},(_,row)=>[0,1,2,3].map(col=>row*4+col)),
 ...Array.from({length:4},(_,col)=>[0,1,2,3].map(row=>row*4+col)),
 [0,5,10,15],[3,6,9,12]
]);

export const CHRISTMAS_CARDS=Object.freeze([...ORIGINAL_NAMES,...HAMMER_NAMES].map((name,index)=>{
 const rarity=index<32?CHRISTMAS_RARITIES[Math.floor(index%16/4)]
 :index<48?'common':CHRISTMAS_RARITIES[(index-48)%4];
 return Object.freeze({
   id:'christmas-'+String(index+1).padStart(2,'0'),
   name,rarity,
   series:index<16?'Weihnachtskollektion I':index<32?'Weihnachtskollektion II'
      :index<48?'Weihnachtswerkstatt':'Legendäre Winterwelt'
 });
}));

// First draw a *rarity* from the published pack weights, then select a card
// uniformly inside that rarity. This protects the published 65/29/5/1,
// 55/32/10/3 and 40/35/17/8 odds despite unequal rarity pool sizes.
export function christmasDraw(pack,rand=randomInt){
 if(!pack||!Number.isInteger(pack.count)||pack.count<1)throw Error('INVALID_PACK');
 const result=[];
 for(let i=0;i<pack.count;i++){
  const guaranteed=i<(pack.guaranteedCount||0);
  const minRarity=guaranteed?pack.guaranteed:'common';
  const minIndex=CHRISTMAS_RARITIES.indexOf(minRarity);
  if(minIndex<0)throw Error('INVALID_RARITY');
  const candidates=CHRISTMAS_RARITIES.slice(minIndex).map(rarity=>({
   rarity,weight:Number(pack.weights?.[rarity]||0)
  })).filter(({rarity,weight})=>weight>0&&CHRISTMAS_CARDS.some(card=>card.rarity===rarity));
  const total=candidates.reduce((sum,c)=>sum+c.weight,0);
  if(!Number.isSafeInteger(total)||total<=0)throw Error('INVALID_PACK_WEIGHTS');
  let roll=rand(total),selected=candidates.at(-1).rarity;
  for(const c of candidates){roll-=c.weight;if(roll<0){selected=c.rarity;break}}
  const pool=CHRISTMAS_CARDS.filter(c=>c.rarity===selected);
  result.push(pool[rand(pool.length)]);
 }
 return result;
}

// Annotate the result BEFORE any counts are incremented. Only the first copy
// of an as-yet-unowned card within one pack is a new discovery. Keep this
// information in the server-side pack receipt so retries replay identical badges.
export function markChristmasDiscoveries(drawn,previousCards={}){
 const seen=new Set();
 return drawn.map(card=>{
  const isNew=!(Number(previousCards[card.id])>0)&&!seen.has(card.id);
  seen.add(card.id);
  return {...card,isNew};
 });
}

// Read-only progress for the Hammer-Bingo boards. Rewards and resets will
// require exactly-once server receipts and are deliberately NOT granted here.
export function hammerBingoProgress(cards={},claimed={}){
 const claims=normalizeHammerClaims(claimed);
 const boards=[33,49].map((start,i)=>{
  const owned=Array.from({length:16},(_,offset)=>Number(cards['christmas-'+String(start+offset).padStart(2,'0')]||0)>0);
  const bingoLines=BINGO_LINES.map((line,k)=>line.every(index=>owned[index])?k:null).filter(k=>k!==null);
  const key=i===0?'common':'mixed';
  const claimedLines=claims[key];
  return {board:i+3,collected:owned.filter(Boolean).length,total:16,bingoLines,bingos:bingoLines.length,maxBingos:10,complete:owned.every(Boolean),claimedLines,claimableLines:bingoLines.filter(line=>!claimedLines.includes(line))};
 });
 return {collected:boards.reduce((sum,b)=>sum+b.collected,0),total:32,boards};
}

/**
 * 4 rows (right), 4 columns (below) and 2 diagonals. Indexes 0..9
 * follow the same BINGO_LINES order on the Christmas album.
 * The mixed/legendary board pays exactly twice the standard board.
 */
export const HAMMER_BINGO_BASE_PRIZES=Object.freeze([
 Object.freeze({single:1}), // row 1
 Object.freeze({single:1}), // row 2
 Object.freeze({single:1}), // row 3
 Object.freeze({single:2}), // row 4
 Object.freeze({single:1}), // column 1
 Object.freeze({single:2}), // column 2
 Object.freeze({double:1}), // column 3
 Object.freeze({double:1}), // column 4
 Object.freeze({double:1}), // diagonal \
 Object.freeze({lucky:1})   // diagonal /
]);
export function hammerBingoPrize(board,lineIndex){
 if(![3,4].includes(board)||!Number.isInteger(lineIndex)||lineIndex<0||lineIndex>9)throw Error('INVALID_BINGO_LINE');
 const multiplier=board===4?2:1;
 return Object.fromEntries(Object.entries(HAMMER_BINGO_BASE_PRIZES[lineIndex]).map(([type,n])=>[type,n*multiplier]));
}
export function normalizeHammerClaims(claims){
 return {
  common:[...new Set((Array.isArray(claims?.common)?claims.common:[]).filter(i=>Number.isInteger(i)&&i>=0&&i<10))].sort((a,b)=>a-b),
  mixed:[...new Set((Array.isArray(claims?.mixed)?claims.mixed:[]).filter(i=>Number.isInteger(i)&&i>=0&&i<10))].sort((a,b)=>a-b)
 };
}
export function collectHammerBingoClaims(cards={},previousClaims={}){
 const claims=normalizeHammerClaims(previousClaims);
 const nextClaims={common:[...claims.common],mixed:[...claims.mixed]};
 const awarded=[],totals={single:0,double:0,lucky:0};
 for(const [board,start,key] of [[3,33,'common'],[4,49,'mixed']]){
  const owned=Array.from({length:16},(_,i)=>Number(cards['christmas-'+String(start+i).padStart(2,'0')]||0)>0);
  for(let line=0;line<10;line++){
   if(nextClaims[key].includes(line)||!BINGO_LINES[line].every(i=>owned[i]))continue;
   const hammers=hammerBingoPrize(board,line);
   awarded.push({board,line,hammers});
   nextClaims[key].push(line);
   for(const [type,count] of Object.entries(hammers))totals[type]+=count;
  }
  nextClaims[key].sort((a,b)=>a-b);
 }
 return {claims:nextClaims,awarded,totals};
}
