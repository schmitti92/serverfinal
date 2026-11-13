// DOG Sammelalbum Saison 2 – garantiertes Kisten-Bingo und zufällige Zusatzpreise.
// Server-seitig, einmal pro 2 echte Bingo-Linien (6 Tafeln à 10 Linien).
import {randomInt} from 'node:crypto';
import {DOG_CHEST_TYPES} from './dog-balance.js';

const TIER_NAMES=Object.freeze({wood:'Holzkiste',iron:'Eisenkiste',silver:'Silberkiste',gold:'Goldkiste',legendary:'Legendäre Kiste'});
export const DOG_S2_BINGO_MILESTONES=Object.freeze(Array.from({length:30},(_,i)=>{
 const at=(i+1)*2;
 const tier=at<=12?'wood':at<=24?'iron':at<=36?'silver':at<=48?'gold':'legendary';
 const stage=Math.min(9,Math.floor((at-2)/6));
 const extraCount=at===60?4:at>=50?3:at>=38?2:1;
 return Object.freeze({at,tier,stage,chests:at===60?2:1,extraCount});
}));
const DEFAULT_WEIGHTS=Object.freeze([
 Object.freeze({cash:40,hammer:33,joker:12,minigame:10,monster:5}),
 Object.freeze({cash:32,hammer:27,joker:16,minigame:13,monster:12}),
 Object.freeze({cash:25,hammer:23,joker:20,minigame:16,monster:16})
]);
const pick=(weights,rand)=>{
 const entries=Object.entries(weights).filter(([,w])=>w>0);
 const total=entries.reduce((sum,[,weight])=>sum+weight,0);
 if(total<1)throw Error('INVALID_BINGO_WEIGHTS');
 let value=rand(total);
 for(const [kind,weight] of entries){value-=weight;if(value<0)return kind}
 throw Error('INVALID_BINGO_RANDOM');
};
const randomRange=(min,max,rand)=>min+rand(max-min+1);
const validTimestamp=v=>Number.isSafeInteger(v)&&v>0?v:0;
export const rewardTierLabel=tier=>TIER_NAMES[tier]||tier;
export function dogS2RewardStatus(bingos=0,claims={},history=[]){
 const totalBingos=Math.max(0,Math.min(60,Number.isSafeInteger(bingos)?bingos:0));
 const validClaims=claims&&typeof claims==='object'&&!Array.isArray(claims)?claims:{};
 const past=Array.isArray(history)?history:[];
 const milestones=DOG_S2_BINGO_MILESTONES.map(m=>{
  const claimedAt=validTimestamp(validClaims[String(m.at)]);
  const claimed=claimedAt>0;
  const open=totalBingos>=m.at;
  const prize=past.find(x=>x?.at===m.at);
  return {at:m.at,tier:m.tier,stage:m.stage,chests:m.chests,extraCount:m.extraCount,
   state:claimed?'claimed':open?'ready':'locked',claimedAt,bonuses:claimed?prize?.bonuses||[]:[]};
 });
 return {total:30,claimed:milestones.filter(m=>m.state==='claimed').length,
  pending:milestones.filter(m=>m.state==='ready').map(m=>m.at),
  milestones,history:past.slice(-30)};
}
export function dogS2DrawMilestone(milestone,previousKind='',rand=randomInt){
 if(!DOG_S2_BINGO_MILESTONES.includes(milestone))throw Error('INVALID_BINGO_MILESTONE');
 const stage=milestone.at<=20?0:milestone.at<=40?1:2;
 const weights=DEFAULT_WEIGHTS[stage],bonuses=[],used=new Set();
 let lastKind=previousKind;
 for(let i=0;i<milestone.extraCount;i++){
  const candidate=Object.fromEntries(Object.entries(weights).filter(([kind])=>kind!==lastKind&&!used.has(kind)));
  // The fifth category is always available; late milestones have max four extras.
  const kind=pick(candidate,rand);
  used.add(kind);lastKind=kind;
  if(kind==='cash'){
   const bands=milestone.at<=12?[10000,80000]:
    milestone.at<=24?[50000,200000]:
    milestone.at<=36?[100000,500000]:
    milestone.at<=48?[250000,1000000]:
    milestone.at<60?[500000,2000000]:[1000000,5000000];
   const euros=randomRange(...bands,rand);
   bonuses.push({kind,amountCents:euros*100,label:euros.toLocaleString('de-DE')+' € Spielgeld'});
  }else if(kind==='hammer'){
   const options=milestone.at<=12?['single','single','double']:
    milestone.at<=36?['single','double','double','lucky']:
     ['double','lucky','lucky'];
   const hammer=options[rand(options.length)];
   const quantity=milestone.at>=54?randomRange(2,3,rand):milestone.at>=36?randomRange(1,2,rand):1;
   bonuses.push({kind,hammer,quantity,label:quantity+'× '+({single:'Einfachhammer',double:'Doppelhammer',lucky:'Glückshammer'})[hammer]});
  }else if(kind==='joker'){
   const quantity=milestone.at>=50?randomRange(1,2,rand):1;
   bonuses.push({kind,quantity,label:quantity+'× Kofferblick-Joker'});
  }else if(kind==='minigame'){
   const quantity=milestone.at===60?3:milestone.at>=50?randomRange(1,2,rand):1;
   bonuses.push({kind,quantity,label:quantity+'× Minispiel-Gutschein'});
  }else if(kind==='monster'){
   const quantity=milestone.at===60?3:milestone.at>=50?randomRange(1,2,rand):1;
   bonuses.push({kind,quantity,label:quantity+'× Monster-Rad-Dreh'});
  }
 }
 const spec=DOG_CHEST_TYPES[milestone.tier];
 const offers=Array.from({length:milestone.chests},()=>{
  const count=spec.countWeights?Number(pick(Object.fromEntries(spec.countWeights.map((weight,i)=>[spec.min+i,weight])),rand)):
   randomRange(spec.min,spec.max,rand);
  return {version:4,stage:milestone.stage,tier:milestone.tier,count};
 });
 return {at:milestone.at,chestTier:milestone.tier,chestLabel:rewardTierLabel(milestone.tier),
  chests:offers,bonuses,previousKind:lastKind};
}
export function dogS2PlanBingoClaims(progress,claims={},lastKind='',rand=randomInt){
 if(!Number.isSafeInteger(progress?.bingos)||progress.bingos<0||progress.bingos>60)throw Error('INVALID_BINGO_PROGRESS');
 const status=dogS2RewardStatus(progress.bingos,claims);
 let previous=lastKind;
 const awards=status.pending.map(at=>{
  const milestone=DOG_S2_BINGO_MILESTONES.find(m=>m.at===at);
  const award=dogS2DrawMilestone(milestone,previous,rand);
  previous=award.previousKind;
  const {previousKind,...publicAward}=award;
  return publicAward;
 });
 return {awards,lastKind:previous};
}
