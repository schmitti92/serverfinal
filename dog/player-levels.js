/**
 * Personal DOG player progression (levels 1–10).
 * Progress is awarded only on an authoritative, completed online DOG match.
 * Level 2 opens the DOG Design-Studio; level 3 unlocks the Nikolaus card deck.
 * Rewards are bound to authenticated, server-verified experience points.
 */
export const DOG_LEVEL_MAX=10;
export const DOG_LEVEL_THRESHOLDS=Object.freeze([0,100,250,450,700,1000,1350,1750,2200,2700]);
export const DOG_LEVEL_XP=Object.freeze({complete:50,win:50,knockout:10,maxCountedKnockouts:5});
export const DOG_LEVEL_REWARDS=Object.freeze(Array.from({length:DOG_LEVEL_MAX},(_,i)=>{
 const reward=i===1?Object.freeze({type:'feature',id:'dog-design-studio',title:'Brettdesigner'}):
  i===2?Object.freeze({type:'cardEdition',id:'kartendesign-05',title:'🎅 Nikolaus-Kartendeck · Deluxe'}):null;
 return Object.freeze({level:i+1,id:'dog-player-level-'+(i+1),configured:reward!==null,reward});
}));
const safeXp=value=>Number.isSafeInteger(value)&&value>=0?Math.min(value,1000000000):0;
export function dogLevelFromXp(totalXp){
 const xp=safeXp(totalXp);
 const level=DOG_LEVEL_THRESHOLDS.reduce((current,threshold,i)=>xp>=threshold?i+1:current,1);
 const at=DOG_LEVEL_THRESHOLDS[level-1];
 const next=level===DOG_LEVEL_MAX?null:DOG_LEVEL_THRESHOLDS[level];
 const earned=xp-at;
 const required=next===null?0:next-at;
 return {level,maxLevel:DOG_LEVEL_MAX,totalXp:xp,xpIntoLevel:next===null?0:earned,
   xpForNextLevel:required,xpRemaining:next===null?0:Math.max(0,next-xp),
   progressPercent:next===null?100:Math.max(0,Math.min(100,Math.floor(earned/required*100))),
   nextLevel:next===null?null:level+1};
}
export function dogMatchXp({won=false,knockedOut=0}={}){
 const knockouts=Number.isSafeInteger(knockedOut)&&knockedOut>=0?Math.min(knockedOut,DOG_LEVEL_XP.maxCountedKnockouts):0;
 return DOG_LEVEL_XP.complete+(won?DOG_LEVEL_XP.win:0)+knockouts*DOG_LEVEL_XP.knockout;
}
export function dogPlayerLevelStatus(raw){
 const d=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
 return {...dogLevelFromXp(d.xp),rewards:DOG_LEVEL_REWARDS,
   lastEarnedXp:safeXp(d.lastEarnedXp),totalVerifiedMatches:Number.isSafeInteger(d.xpMatches)&&d.xpMatches>=0?d.xpMatches:0,
   xpRules:DOG_LEVEL_XP};
}
export function creditDogMatchXp(raw,{won=false,knockedOut=0,matchId,now=Date.now()}={}){
 const old=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
 // A complete DOG match must always have a real, server-generated match ID.
 if(typeof matchId!=='string'||!matchId.trim()||matchId.length>128)throw Error('DOG_LEVEL_INVALID_MATCH');
 if(old.xpLastMatchId===matchId)return {...old,credited:false,xp:safeXp(old.xp),lastEarnedXp:0};
 const earned=dogMatchXp({won,knockedOut});
 return {...old,xp:Math.min(1000000000,safeXp(old.xp)+earned),
   lastEarnedXp:earned,xpLastMatchId:matchId,
   xpMatches:(Number.isSafeInteger(old.xpMatches)&&old.xpMatches>=0?old.xpMatches:0)+1,
   xpUpdatedAt:now,credited:true};
}
