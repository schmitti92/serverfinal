// DOG Sammelalbum Saison 2 – eigener persistenter Kartenbestand, Saison 1 bleibt archiviert.
// Jede Tafel besteht aus 16 echten GitHub-Bildern. Bingo-Preise zahlt ausschließlich der Server aus.
import {randomInt} from 'node:crypto';
import {addExpeditionChestToInventory,DOG_MATERIALS_COLLECTION} from './dog-materials.js';
import {newIceState,normalizeIceState} from './christmas-ice-engine.js';
import {checkMonsterBalance} from './monster-wheel.js';
import {dogS2RewardStatus,dogS2PlanBingoClaims} from './dog-album-bingo-rewards.js';
export const DOG_S2_COLLECTION='deal_dog_album_season2_v1';
export const DOG_S2_BOARDS=Object.freeze(['DOG & Königreich','Weltraum','Dinosaurier','Freizeitpark','Märchen','Western']);
const FILES=Object.freeze([["DOG_01_11.png","DOG_02.png","DOG_03.png","DOG_04_plus_minus.png","DOG_05.png","DOG_06.png","DOG_07.png","DOG_08.png","DOG_09.png","DOG_10.png","DOG_12.png","DOG_13.png","DOG_Joker.png","DOG_Tauschen.png","DOG_31_Vier_Koenige.png","DOG_32_Koenigliche_Allianz.png"],["DOG_43_Astronauten.png","DOG_44_Raumstation.png","DOG_45_Rakete.png","DOG_46_Mondlandung.png","DOG_47_Alien_Kartenspiel.png","DOG_48_Galaktischer_Pokal.png","DOG_49_Kosmischer_Wuerfel.png","DOG_50_Weltraum_Sieger.png","DOG_51_Sternenpokal.png","DOG_52_Mondforscher.png","DOG_53_Raumstation.png","DOG_54_Schwerelos.png","DOG_55_Raketenstart.png","DOG_56_Alien_Kartenspiel.png","DOG_57_Sternenportal.png","DOG_58_Weltraumschatz.png"],["DOG_59_Dino_Pokal.png","DOG_60_Dino_Entdecker.png","DOG_61_Dino_Schatz.png","DOG_62_Dino_Spielrunde.png","DOG_63_Dino_Ritter.png","DOG_64_Dino_Zauberer.png","DOG_123_T_Rex_Team.png","DOG_124_Triceratops_Spielbrett.png","DOG_125_Brachiosaurus_Karten.png","DOG_126_Stegosaurus_Wuerfel.png","DOG_127_Raptor_Schatzkarte.png","DOG_128_Flugsaurier_Team.png","DOG_129_Spinosaurus_Spielmuenze.png","DOG_130_Ankylosaurus_Schatzkiste.png","DOG_131_Dino_Baby.png","DOG_132_Dino_Siegerpokal.png"],["DOG_65_Freizeitpark_Panorama.png","DOG_66_Spielpark_Eingang.png","DOG_67_Achterbahn.png","DOG_68_Geisterbahn.png","DOG_134_Achterbahn.png","DOG_135_Riesenrad.png","DOG_136_Karussell.png","DOG_137_Wildwasserbahn.png","DOG_138_Geisterbahn.png","DOG_139_Suessigkeiten.png","DOG_140_Dosenwerfen.png","DOG_141_Kettenkarussell.png","DOG_142_Heissluftballon.png","DOG_143_Feuerwerk.png","DOG_144_Freizeitpark_Pokal.png","DOG_33_Koenigspokal.png"],["DOG_69_Rapunzel.png","DOG_77_Maerchenschloss.png","DOG_78_Kuerbiskutsche.png","DOG_79_Dornroeschen.png","DOG_80_Rotkaeppchen.png","DOG_81_Drei_Schweinchen.png","DOG_82_Schwert_im_Stein.png","DOG_83_Schneewittchen.png","DOG_84_Magisches_Maerchenbuch.png","DOG_145_Rotkaeppchen.png","DOG_146_Haensel_und_Gretel.png","DOG_148_Schneewittchen.png","DOG_149_Gestiefelter_Kater.png","DOG_150_Dornroeschen.png","DOG_151_Rumpelstilzchen.png","DOG_34_Vier_Koenigreiche.png"],["DOG_85_Sheriff.png","DOG_86_Dampflokomotive.png","DOG_87_Western_Freundschaft.png","DOG_88_Saloon.png","DOG_89_Bandit.png","DOG_90_Wuestenlandschaft.png","DOG_91_Cowgirl.png","DOG_92_Rodeo.png","DOG_152_Westernstadt.png","DOG_154_Sheriff.png","DOG_155_Dampflok.png","DOG_156_Cowboy_Pferd.png","DOG_158_Lagerfeuer.png","DOG_159_Sonnenuntergang.png","a_highly_detailed_colorful_glossy_3d_style_board.png","a_highly_detailed_glossy_colorful_close_up_illus.png"]]);
const RARITIES=['common','rare','epic','legendary'];
// Six DOG worlds of 16 cards each. Slots 1–4 / 5–8 / 9–12 / 13–16
// are common / rare / epic / legendary. The bottom-right legendary (16)
// is a 1-in-500 hit CONDITIONAL on a draw belonging to its 16-card board,
// including the guaranteed-rarity draws of Premium and Platin packages.
// Every pack keeps its existing rarity odds; the world is chosen uniformly.
// A special legendary roll adjusts for the pack's legendary probability.
// The 15 other cards keep four normal, three 3x, four 8x, two 15x and
// two 30x rarer cards within their own rarity category.
export const DOG_S2_JACKPOT_SLOT=16;
export const DOG_S2_JACKPOT_ODDS=500;
export const DOG_S2_SPECIAL_CARD_SLOTS=Object.freeze([
 Object.freeze({normal:Object.freeze([1,5,9,13]),triple:Object.freeze([2,6,10]),octuple:Object.freeze([3,7,11,15]),fifteen:Object.freeze([4,12]),thirty:Object.freeze([8,14]),jackpot:Object.freeze([16])}),
 Object.freeze({normal:Object.freeze([3,6,11,15]),triple:Object.freeze([4,7,12]),octuple:Object.freeze([1,8,9,13]),fifteen:Object.freeze([2,10]),thirty:Object.freeze([5,14]),jackpot:Object.freeze([16])}),
 Object.freeze({normal:Object.freeze([2,8,10,14]),triple:Object.freeze([3,5,11]),octuple:Object.freeze([4,6,12,15]),fifteen:Object.freeze([1,9]),thirty:Object.freeze([7,13]),jackpot:Object.freeze([16])}),
 Object.freeze({normal:Object.freeze([4,7,12,13]),triple:Object.freeze([1,8,9]),octuple:Object.freeze([2,5,10,15]),fifteen:Object.freeze([3,11]),thirty:Object.freeze([6,14]),jackpot:Object.freeze([16])}),
 Object.freeze({normal:Object.freeze([1,6,10,13]),triple:Object.freeze([2,7,11]),octuple:Object.freeze([3,8,12,14]),fifteen:Object.freeze([4,9]),thirty:Object.freeze([5,15]),jackpot:Object.freeze([16])}),
 Object.freeze({normal:Object.freeze([3,5,9,14]),triple:Object.freeze([4,6,10]),octuple:Object.freeze([1,7,11,15]),fifteen:Object.freeze([2,12]),thirty:Object.freeze([8,13]),jackpot:Object.freeze([16])})
]);
export const DOG_S2_CARD_WEIGHT_BASE=120;
export function dogS2CardDrawWeight(card){
 const config=DOG_S2_SPECIAL_CARD_SLOTS[(card?.board||0)-1];
 if(!config||!Number.isInteger(card?.slot)||card.slot<1||card.slot>16)throw Error('INVALID_DOG_CARD');
 if(config.jackpot.includes(card.slot))return 0; // Only awarded by the exact 1:500 lottery.
 if(config.thirty.includes(card.slot))return 4;
 if(config.fifteen.includes(card.slot))return 8;
 if(config.octuple.includes(card.slot))return 15;
 if(config.triple.includes(card.slot))return 40;
 if(config.normal.includes(card.slot))return DOG_S2_CARD_WEIGHT_BASE;
 throw Error('INVALID_DOG_CARD');
}

export const DOG_S2_CARDS=Object.freeze(FILES.flatMap((files,board)=>files.map((image,slot)=>{
 const number=board*16+slot+1;
 const raw=image.replace(/\.png$/i,'').replace(/^DOG_\d+_?/,'').replace(/^a_/,'');
 const name=raw.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
 return Object.freeze({id:'dog2-'+String(number).padStart(3,'0'),name,image,rarity:RARITIES[Math.floor(slot/4)],series:DOG_S2_BOARDS[board],board:board+1,slot:slot+1});
})));
export const DOG_S2_PACKS=Object.freeze([
 Object.freeze({id:'small',name:'DOG Normalpaket',price:200000000,count:3,guaranteed:'common',guaranteedCount:0,weights:{common:65,rare:29,epic:5,legendary:1}}),
 Object.freeze({id:'large',name:'DOG Goldpaket',price:400000000,count:7,guaranteed:'rare',guaranteedCount:1,weights:{common:55,rare:32,epic:10,legendary:3}}),
 Object.freeze({id:'premium',name:'DOG Premiumpaket',price:600000000,count:12,guaranteed:'epic',guaranteedCount:2,weights:{common:40,rare:35,epic:17,legendary:8}}),
 Object.freeze({id:'platinum',name:'DOG Platinpaket',price:2000000000,count:16,guaranteed:'epic',guaranteedCount:4,weights:{common:30,rare:35,epic:25,legendary:10}})
]);
const LINES=Object.freeze([
 ...Array.from({length:4},(_,r)=>[0,1,2,3].map(c=>r*4+c)),
 ...Array.from({length:4},(_,c)=>[0,1,2,3].map(r=>r*4+c)),
 [0,5,10,15],[3,6,9,12]
]);
const positive=n=>Number.isSafeInteger(n)&&n>0?n:0;
export function dogS2Progress(cards={}){
 const boards=DOG_S2_BOARDS.map((name,index)=>{
  const slice=DOG_S2_CARDS.slice(index*16,index*16+16);
  const owned=slice.map(c=>positive(cards[c.id])>0);
  const bingoLines=LINES.map((line,i)=>line.every(j=>owned[j])?i:null).filter(n=>n!==null);
  return {name,index:index+1,collected:owned.filter(Boolean).length,total:16,ownedSlots:owned,bingoLines,bingos:bingoLines.length,maxBingos:10};
 });
 return {season:2,collected:boards.reduce((s,b)=>s+b.collected,0),total:96,
  bingos:boards.reduce((s,b)=>s+b.bingos,0),maxBingos:60,boards,
  rewardsEnabled:true,rewardNote:'Alle 2 Bingos eine Materialkiste und zufällige Zusatzgewinne.'};
}

 // ONLY the six DOG season-2 boards take part in repeatable collection,
 // super-slot tickets and monthly tournaments. The Christmas Hammer-Bingo
 // lives in a completely different collection and is never inspected here.
export const DOG_S2_TOURNAMENT_COLLECTION='dog_s2_monthly_tournaments_v1';
const DOG_S2_BINGO_POINTS=15, DOG_S2_BOARD_POINTS=200;
const DOG_S2_CARD_POINTS=Object.freeze({common:2,rare:7,epic:12,legendary:22});
export const dogS2TournamentMonth=(now=Date.now())=>new Date(now).toISOString().slice(0,7);
const cycleCounts=(cards,baseline)=>Object.fromEntries(DOG_S2_CARDS.map(card=>[
 card.id,Math.max(0,positive(cards?.[card.id])-positive(baseline?.[card.id]))
]));
export function dogS2CycleProgress(cards={},state={},now=Date.now()){
 const base=state.cycleBase||{};
 const p=dogS2Progress(cycleCounts(cards,base));
 const completions=Array.from({length:6},(_,i)=>positive(state.cycleCompletions?.[i]));
 const month=dogS2TournamentMonth(now);
 return {...p,boards:p.boards.map((board,i)=>({...board,completions:completions[i],
  round:completions[i]+1,readyToComplete:board.collected===16})),
  completedTotal:completions.reduce((a,b)=>a+b,0),
  superSlotTickets:positive(state.superSlotTickets),
  tournament:{month,points:state.tournamentMonth===month?positive(state.tournamentPoints):0,
   lifetimePoints:positive(state.tournamentLifetimePoints),
   monthCompleted:state.tournamentMonth===month?positive(state.tournamentMonthCompleted):0}};
}
export function dogS2AdvanceCycles(previousCards={},cards={},state={},now=Date.now()){
 const initial=dogS2CycleProgress(previousCards,state,now),after=dogS2CycleProgress(cards,state,now);
 const baseline={...(state.cycleBase||{})},completions=[...Array.from({length:6},(_,i)=>positive(state.cycleCompletions?.[i]))];
 let delta=0,finished=[];
 for(let board=0;board<6;board++){
  const before=initial.boards[board],next=after.boards[board];
  for(const card of DOG_S2_CARDS.slice(board*16,board*16+16)){
   if(positive(previousCards[card.id])<=positive(baseline[card.id])&&positive(cards[card.id])>positive(baseline[card.id]))
    delta+=DOG_S2_CARD_POINTS[card.rarity];
  }
  delta+=Math.max(0,next.bingos-before.bingos)*DOG_S2_BINGO_POINTS;
  // A full pre-existing board is claimable after migration, but can be
  // completed only ONCE. The baseline then makes the next round empty.
  if(next.collected===16){
   finished.push({board:board+1,name:DOG_S2_BOARDS[board],round:completions[board]+1});
   completions[board]++;
   for(const card of DOG_S2_CARDS.slice(board*16,board*16+16))
    baseline[card.id]=positive(cards[card.id]);
   delta+=DOG_S2_BOARD_POINTS;
  }
 }
 const month=dogS2TournamentMonth(now),sameMonth=state.tournamentMonth===month;
 const tickets=positive(state.superSlotTickets)+finished.length;
 if(!Number.isSafeInteger(tickets)||tickets>1000000)throw Error('INVALID_SUPER_SLOT_TICKETS');
 const monthPoints=(sameMonth?positive(state.tournamentPoints):0)+delta;
 const lifetimePoints=positive(state.tournamentLifetimePoints)+delta;
 if(!Number.isSafeInteger(monthPoints)||!Number.isSafeInteger(lifetimePoints))
  throw Error('INVALID_TOURNAMENT_POINTS');
 const updates={
  cycleBase:baseline,cycleCompletions:completions,superSlotTickets:tickets,
  tournamentMonth:month,tournamentPoints:monthPoints,
  tournamentLifetimePoints:lifetimePoints,
  tournamentMonthCompleted:(sameMonth?positive(state.tournamentMonthCompleted):0)+finished.length
 };
 return {updates,finished,pointsAdded:delta,progress:dogS2CycleProgress(cards,{...state,...updates},now)};
}

export function dogS2Draw(pack,rand=randomInt){
 if(!pack||!Number.isInteger(pack.count)||pack.count<1)throw Error('INVALID_PACK');
 const result=[];
 for(let i=0;i<pack.count;i++){
  const min=i<(pack.guaranteedCount||0)?RARITIES.indexOf(pack.guaranteed):0;
  const candidates=RARITIES.slice(min).map(rarity=>({rarity,weight:pack.weights[rarity]||0})).filter(x=>x.weight>0);
  const total=candidates.reduce((sum,x)=>sum+x.weight,0);
  if(!total)throw Error('INVALID_PACK_WEIGHTS');
  let roll=rand(total),rarity=candidates.at(-1).rarity;
  for(const c of candidates){roll-=c.weight;if(roll<0){rarity=c.rarity;break}}
  // Choose the 16-card world independently, with equal 1/6 probability.
  const board=rand(DOG_S2_BOARDS.length)+1;
  if(!Number.isInteger(board)||board<1||board>DOG_S2_BOARDS.length)throw Error('INVALID_PACK_RANDOM');
  if(rarity==='legendary'){
   const legendaryTickets=candidates.find(c=>c.rarity==='legendary')?.weight||0;
   // P(jackpot | chosen board) = P(legendary) *
   // [total / (500 * legendaryTickets)] = 1/500.
   // The normal/Gold/Premium/Platin pack tiers all satisfy this bound.
   const denominator=DOG_S2_JACKPOT_ODDS*legendaryTickets;
   if(!Number.isSafeInteger(denominator)||denominator<total)throw Error('INVALID_PACK_WEIGHTS');
   if(rand(denominator)<total){
    result.push(DOG_S2_CARDS[(board-1)*16+DOG_S2_JACKPOT_SLOT-1]);
    continue;
   }
  }
  // The other 15 cards keep their relative 3x/8x/15x/30x weights
  // inside the rarity selected above; jackpots cannot leak into these rolls.
  const pool=DOG_S2_CARDS.filter(c=>c.board===board&&c.rarity===rarity&&c.slot!==DOG_S2_JACKPOT_SLOT);
  const poolTotal=pool.reduce((sum,card)=>sum+dogS2CardDrawWeight(card),0);
  if(poolTotal<1)throw Error('INVALID_PACK_WEIGHTS');
  let cardRoll=rand(poolTotal),selected=pool.at(-1);
  for(const card of pool){
   cardRoll-=dogS2CardDrawWeight(card);
   if(cardRoll<0){selected=card;break}
  }
  result.push(selected);
 }
 return result;
}
export function dogS2Discoveries(drawn,previous={}){
 const seen=new Set();
 return drawn.map(card=>{
  const isNew=!positive(previous[card.id])&&!seen.has(card.id);
  seen.add(card.id);return {...card,isNew};
 });
}
// Used by Monster Slots: awarded packs are opened and credited in the very
// same Firestore transaction as the three slot prizes. No paid pack purchase,
// no voucher consumption and no client-driven second draw.
export function dogS2OpenGrantedPacks(packId,quantity,previous={},rand=randomInt,cycleBase={}){
 const pack=DOG_S2_PACKS.find(p=>p.id===packId);
 if(!pack||!Number.isSafeInteger(quantity)||quantity<1||quantity>3)throw Error('INVALID_GRANTED_PACK');
 const cards={...previous},openedPacks=[];
 for(let n=0;n<quantity;n++){
  const revealed=dogS2Discoveries(dogS2Draw(pack,rand),cycleCounts(cards,cycleBase));
  for(const card of revealed)cards[card.id]=positive(cards[card.id])+1;
  openedPacks.push({packId,packName:pack.name,hasNew:revealed.some(card=>card.isNew===true),revealed});
 }
 return {cards,openedPacks};
}
// Slot packs are drawn, marked NEW, and credited as part of the same
// idempotent game-settlement transaction. This is pure so the caller can
// handle Firestore reads/writes once per player, even for several packs.
export function dogS2OpenSlotPacks(prizes,previousCards={},rand=randomInt){
 const cards={...previousCards},packReveals=[];
 for(const [reelIndex,prize] of prizes.entries()){
  if(prize.kind!=='pack')continue;
  const pack=DOG_S2_PACKS.find(p=>p.id===prize.id);
  if(!pack||!Number.isInteger(prize.quantity)||prize.quantity<1||prize.quantity>3)
   throw Error('INVALID_SLOT_PACK');
  for(let packNumber=1;packNumber<=prize.quantity;packNumber++){
   const revealed=dogS2Discoveries(dogS2Draw(pack,rand),cards);
   for(const card of revealed)cards[card.id]=(Number(cards[card.id])||0)+1;
   packReveals.push({
    reelIndex,packId:pack.id,packNumber,newCount:revealed.filter(card=>card.isNew).length,revealed
   });
  }
 }
 return {cards,packReveals};
}
export function dogS2Duplicates(cards={},tickets=0){
 const available=DOG_S2_CARDS.reduce((sum,c)=>sum+Math.max(0,positive(cards[c.id])-1),0);
 return {available,tickets:positive(tickets),exchangeCost:100,canExchange:available>=100};
}
export function dogS2Redeem(cards={}){
 if(dogS2Duplicates(cards).available<100)throw Error('INSUFFICIENT_DUPLICATES');
 const next={...cards};let due=100;
 for(const card of DOG_S2_CARDS){
  if(!due)break;
  const spent=Math.min(due,Math.max(0,positive(next[card.id])-1));
  if(spent){next[card.id]-=spent;due-=spent}
 }
 return next;
}
export function installDogAlbumSeason2(app,{auth,getFirestore,fail}){
 const base='/api/deal-or-no-deal/christmas/season2';
 const legacy='deal_or_no_deal_christmas_v1';
 const wallet='deal_or_no_deal_wallets_v1';
 const receipts='deal_dog_album_season2_receipts_v1';
 app.get(base+'/me',auth,async(req,res)=>{
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const uid=req.dealIdentity.uid;
   const [w,s,old]=await Promise.all([db.collection(wallet).doc(uid).get(),db.collection(DOG_S2_COLLECTION).doc(uid).get(),db.collection(legacy).doc(uid).get()]);
   const data=s.exists?s.data():{},legacyData=old.exists?old.data():{};
   const cards=data.cards||{};
   res.set('Cache-Control','no-store');
   res.json({ok:true,season:2,cards,definitions:DOG_S2_CARDS,packs:DOG_S2_PACKS,
    balance:positive(w.data()?.balance),opened:positive(data.opened),
    progress:dogS2CycleProgress(cards,data),lifetimeProgress:dogS2Progress(cards),
    rewards:dogS2RewardStatus(dogS2Progress(cards).bingos,data.bingoRewardsClaimed,data.bingoRewardsHistory),
    freePacks:Object.fromEntries(DOG_S2_PACKS.map(p=>[p.id,positive(legacyData.freeChristmasPacks?.[p.id])])),
    duplicates:dogS2Duplicates(cards,legacyData.monsterWheelTickets||0)});
  }catch(e){return fail(res,e)}
 });
 app.post(base+'/open',auth,async(req,res)=>{
  try{
   const pack=DOG_S2_PACKS.find(p=>p.id===req.body?.packId);if(!pack)throw Error('INVALID_PACK');
   const requestId=String(req.body?.requestId||'');
   if(!/^[A-Za-z0-9_-]{12,90}$/.test(requestId))throw Error('INVALID_REQUEST_ID');
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const uid=req.dealIdentity.uid,now=Date.now();
   const sRef=db.collection(DOG_S2_COLLECTION).doc(uid),wRef=db.collection(wallet).doc(uid),
    oldRef=db.collection(legacy).doc(uid),receipt=db.collection(receipts).doc(uid+'_'+requestId);
   const result=await db.runTransaction(async tx=>{
    const [s,w,old,r]=await Promise.all([tx.get(sRef),tx.get(wRef),tx.get(oldRef),tx.get(receipt)]);
    if(r.exists){
     if(r.data().packId!==pack.id)throw Error('INVALID_REQUEST_ID');
     return {...r.data().result,replayed:true};
    }
    const prev=s.exists?s.data():{},legacyData=old.exists?old.data():{};
    const balance=Number(w.data()?.balance)||0;
    if(!Number.isSafeInteger(balance)||balance<0)throw Error('INVALID_WALLET_BALANCE');
    const vouchers={...(legacyData.freeChristmasPacks||{})};
    const free=positive(vouchers[pack.id])>0;
    if(!free&&balance<pack.price)throw Error('INSUFFICIENT_FUNDS');
    if(free)vouchers[pack.id]-=1;
    const cards={...(prev.cards||{})};
    const revealed=dogS2Discoveries(dogS2Draw(pack),cycleCounts(cards,prev.cycleBase));
    for(const card of revealed)cards[card.id]=positive(cards[card.id])+1;
    const remaining=free?balance:balance-pack.price;
    const cycles=dogS2AdvanceCycles(prev.cards||{},cards,prev,now);
    const freePacks=Object.fromEntries(DOG_S2_PACKS.map(p=>[p.id,positive(vouchers[p.id])]));
    const result={season:2,packId:pack.id,opened:positive(prev.opened)+1,balance:remaining,cards,revealed,
     usedFreePack:free,freePacks,progress:cycles.progress,lifetimeProgress:dogS2Progress(cards),
     completedBoards:cycles.finished,pointsAdded:cycles.pointsAdded,
     rewards:dogS2RewardStatus(dogS2Progress(cards).bingos,prev.bingoRewardsClaimed,prev.bingoRewardsHistory),
     duplicates:dogS2Duplicates(cards,legacyData.monsterWheelTickets||0)};
    if(!free)tx.set(wRef,{balance:remaining,updatedAt:now},{merge:true});
    else tx.set(oldRef,{freeChristmasPacks:vouchers,updatedAt:now},{merge:true});
    tx.set(sRef,{season:2,cards,...cycles.updates,
     tournamentName:String(req.dealIdentity?.displayName||req.dealIdentity?.name||('Spieler '+uid.slice(0,5))).slice(0,32),
     opened:result.opened,updatedAt:now},{merge:true});
    if(cycles.pointsAdded)tx.set(db.collection(DOG_S2_TOURNAMENT_COLLECTION+'_'+cycles.progress.tournament.month).doc(uid),{
     uid,points:cycles.progress.tournament.points,completed:cycles.progress.tournament.monthCompleted,
     name:String(req.dealIdentity?.displayName||req.dealIdentity?.name||('Spieler '+uid.slice(0,5))).slice(0,32),updatedAt:now
    },{merge:true});
    tx.create(receipt,{uid,packId:pack.id,result,createdAt:now});
    return result;
   });
   res.set('Cache-Control','no-store');res.json({ok:true,...result});
  }catch(e){return fail(res,e)}
 });
 app.post(base+'/duplicates/exchange',auth,async(req,res)=>{
  try{
   const requestId=String(req.body?.requestId||'');
   if(!/^[A-Za-z0-9_-]{12,90}$/.test(requestId))throw Error('INVALID_REQUEST_ID');
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');const uid=req.dealIdentity.uid;
   const sRef=db.collection(DOG_S2_COLLECTION).doc(uid),oldRef=db.collection(legacy).doc(uid),
    rRef=db.collection('deal_dog_album_season2_trades_v1').doc(uid+'_'+requestId);
   const result=await db.runTransaction(async tx=>{
    const [s,old,receipt]=await Promise.all([tx.get(sRef),tx.get(oldRef),tx.get(rRef)]);
    if(receipt.exists)return {...receipt.data().result,replayed:true};
    const before=s.exists?s.data():{},legacyData=old.exists?old.data():{};
    const cards=dogS2Redeem(before.cards||{});
    const tickets=positive(legacyData.monsterWheelTickets)+1;
    const result={cards,progress:dogS2CycleProgress(cards,before),lifetimeProgress:dogS2Progress(cards),duplicates:dogS2Duplicates(cards,tickets),monsterWheelTickets:tickets,replayed:false};
    const now=Date.now();
    tx.set(sRef,{cards,updatedAt:now},{merge:true});
    tx.set(oldRef,{monsterWheelTickets:tickets,monsterWheelTradeCount:positive(legacyData.monsterWheelTradeCount)+1,updatedAt:now},{merge:true});
    tx.create(rRef,{uid,requestId,result,createdAt:now});
    return result;
   });
   res.set('Cache-Control','no-store');res.json({ok:true,...result});
  }catch(e){return fail(res,e)}
 });

 // Existing full DOG boards can be reset and awarded when the player opens
 // the album. Already reset boards have 0/16 so this can never double-pay.
 app.post(base+'/cycles/claim',auth,async(req,res)=>{
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const uid=req.dealIdentity.uid,now=Date.now();
   const albumRef=db.collection(DOG_S2_COLLECTION).doc(uid);
   const result=await db.runTransaction(async tx=>{
    const snap=await tx.get(albumRef),old=snap.exists?snap.data():{};
    const cards=old.cards||{};
    const cycles=dogS2AdvanceCycles(cards,cards,old,now);
    if(!cycles.finished.length)return {ok:true,progress:cycles.progress,lifetimeProgress:dogS2Progress(cards),completedBoards:[],replayed:true};
    tx.set(albumRef,{...cycles.updates,updatedAt:now},{merge:true});
    if(cycles.pointsAdded)tx.set(db.collection(DOG_S2_TOURNAMENT_COLLECTION+'_'+cycles.progress.tournament.month).doc(uid),{
     uid,points:cycles.progress.tournament.points,completed:cycles.progress.tournament.monthCompleted,
     name:String(req.dealIdentity?.displayName||req.dealIdentity?.name||('Spieler '+uid.slice(0,5))).slice(0,32),updatedAt:now
    },{merge:true});
    return {ok:true,progress:cycles.progress,lifetimeProgress:dogS2Progress(cards),
     completedBoards:cycles.finished,pointsAdded:cycles.pointsAdded,replayed:false};
   });
   res.set('Cache-Control','no-store');return res.json(result);
  }catch(e){return fail(res,e)}
 });
 // Read leaderboard only when the user opens the tournament tab.
 // Each month has its own compact score collection; only a score update writes.
 app.get(base+'/tournament',auth,async(req,res)=>{
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const month=dogS2TournamentMonth(),snap=await db.collection(DOG_S2_TOURNAMENT_COLLECTION+'_'+month)
    .orderBy('points','desc').limit(20).get();
   const leaderboard=snap.docs.map((doc,index)=>({
    rank:index+1,name:String(doc.data().name||'Spieler'),points:positive(doc.data().points),
    completed:positive(doc.data().completed),isMe:doc.id===req.dealIdentity.uid
   }));
   res.set('Cache-Control','no-store');return res.json({ok:true,month,leaderboard});
  }catch(e){return fail(res,e)}
 });
 // Alle erreichten Zweier-Bingos werden in EINER Transaktion gebucht.
 // Kein automatisches Firestore-Polling. Ein Aufruf ohne fällige Gewinne liest
 // nur das Album; die Inventare werden nur bei echten Auszahlungen gelesen.
 app.post(base+'/rewards/claim',auth,async(req,res)=>{
  try{
   const db=getFirestore();if(!db)throw Error('STORAGE_UNAVAILABLE');
   const uid=req.dealIdentity.uid;
   const albumRef=db.collection(DOG_S2_COLLECTION).doc(uid);
   const materialRef=db.collection(DOG_MATERIALS_COLLECTION).doc(uid);
   const walletRef=db.collection(wallet).doc(uid);
   const legacyRef=db.collection(legacy).doc(uid);
   const iceRef=db.collection('christmas_ice_progress_v1').doc(uid);
   const jokerRef=db.collection('deal_peek_inventory_v1').doc(uid);
   const hatsRef=db.collection('deal_christmas_hats_v1').doc(uid);
   const result=await db.runTransaction(async tx=>{
    const albumSnap=await tx.get(albumRef);
    const old=albumSnap.exists?albumSnap.data():{};
    const progress=dogS2Progress(old.cards||{});
    const priorClaims=old.bingoRewardsClaimed||{},history=Array.isArray(old.bingoRewardsHistory)?old.bingoRewardsHistory:[];
    const {awards,lastKind}=dogS2PlanBingoClaims(progress,priorClaims,old.bingoRewardsLastBonus||'');
    if(!awards.length)return {awarded:[],progress:dogS2CycleProgress(old.cards||{},old),lifetimeProgress:progress,
     rewards:dogS2RewardStatus(progress.bingos,priorClaims,history),replayed:true};
    const bonuses=awards.flatMap(a=>a.bonuses);
    const needed=new Set(bonuses.map(b=>b.kind));
    const [materialSnap,walletSnap,legacySnap,iceSnap,jokerSnap,hatsSnap]=await Promise.all([
     tx.get(materialRef),
     needed.has('cash')?tx.get(walletRef):null,
     needed.has('monster')?tx.get(legacyRef):null,
     needed.has('hammer')?tx.get(iceRef):null,
     needed.has('joker')?tx.get(jokerRef):null,
     needed.has('minigame')?tx.get(hatsRef):null
    ]);
    const now=Date.now();
    let material=materialSnap.exists?materialSnap.data():null;
    let cash=0,monsterTickets=0,jokers=0,minigameTickets=0;
    const hammers={single:0,double:0,lucky:0};
    const claimed={...priorClaims},newHistory=[...history];
    for(const award of awards){
     for(const chest of award.chests)material=addExpeditionChestToInventory(material,chest,now);
     for(const bonus of award.bonuses){
      if(bonus.kind==='cash')cash=checkMonsterBalance(cash,bonus.amountCents);
      else if(bonus.kind==='monster')monsterTickets=checkMonsterBalance(monsterTickets,bonus.quantity,1000000);
      else if(bonus.kind==='minigame')minigameTickets=checkMonsterBalance(minigameTickets,bonus.quantity,1000000);
      else if(bonus.kind==='joker')jokers=checkMonsterBalance(jokers,bonus.quantity,1000000);
      else if(bonus.kind==='hammer')hammers[bonus.hammer]=checkMonsterBalance(hammers[bonus.hammer],bonus.quantity,1000000);
      else throw Error('INVALID_BINGO_REWARD');
     }
     claimed[String(award.at)]=now;
     newHistory.push({at:award.at,chestTier:award.chestTier,chests:award.chests,
      bonuses:award.bonuses,claimedAt:now});
    }
    tx.set(materialRef,material);
    let balance;
    if(cash){
     const prior=Number(walletSnap?.data()?.balance||0);
     balance=checkMonsterBalance(prior,cash);
     tx.set(walletRef,{balance,updatedAt:now},{merge:true});
    }
    if(monsterTickets){
     const tickets=checkMonsterBalance(Number(legacySnap?.data()?.monsterWheelTickets||0),monsterTickets,1000000);
     tx.set(legacyRef,{monsterWheelTickets:tickets,updatedAt:now},{merge:true});
    }
    if(jokers){
     const jokerBalance=checkMonsterBalance(Number(jokerSnap?.data()?.balance||0),jokers,1000000);
     tx.set(jokerRef,{balance:jokerBalance,updatedAt:now},{merge:true});
    }
    if(minigameTickets){
     const bonusTickets=checkMonsterBalance(Number(hatsSnap?.data()?.bonusTickets||0),minigameTickets,1000000);
     tx.set(hatsRef,{bonusTickets,...(!hatsSnap?.exists?{voucherOnly:true}:{}),updatedAt:now},{merge:true});
    }
    if(Object.values(hammers).some(n=>n>0)){
     const ice=iceSnap?.exists?normalizeIceState(iceSnap.data()):newIceState();
     const freeHammers={...ice.freeHammers},wheelHammers={...ice.wheelHammers};
     for(const kind of ['single','double','lucky']){
      freeHammers[kind]=checkMonsterBalance(Number(freeHammers[kind]||0),hammers[kind],1000000);
      wheelHammers[kind]=checkMonsterBalance(Number(wheelHammers[kind]||0),hammers[kind],1000000);
     }
     tx.set(iceRef,{...ice,freeHammers,wheelHammers,updatedAt:now});
    }
    tx.set(albumRef,{
     bingoRewardsClaimed:claimed,bingoRewardsHistory:newHistory.slice(-30),
     bingoRewardsLastBonus:lastKind,bingoRewardsUpdatedAt:now
    },{merge:true});
    return {awarded:awards,progress:dogS2CycleProgress(old.cards||{},old),lifetimeProgress:progress,
     rewards:dogS2RewardStatus(progress.bingos,claimed,newHistory),
     ...(balance!==undefined?{balance}:{}),replayed:false};
   });
   res.set('Cache-Control','no-store');return res.json({ok:true,...result});
  }catch(e){return fail(res,e)}
 });

}
