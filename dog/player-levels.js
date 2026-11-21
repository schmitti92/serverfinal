/**
 * DOG-Spielerpass 1–50. Bestehende XP-Schwellen für 1–10 und bestehende
 * Freischaltungen bleiben erhalten; Gutscheine werden serverseitig abgeholt.
 */
export const DOG_LEVEL_MAX=50;
export const DOG_LEVEL_THRESHOLDS=Object.freeze(Array.from({length:DOG_LEVEL_MAX},(_,i)=>100*i+25*i*(i-1)));
export const DOG_LEVEL_XP=Object.freeze({complete:50,win:50,knockout:10,maxCountedKnockouts:5});
const voucher=(tier,id,count=1)=>Object.freeze({tier,id,count});
const SIMPLE=['gifts','snow_collect'];
const MEDIUM=['elf','tic_tac_toe','number_one_20'];
const PREMIUM=['premium_27','dog_jackpot_9'];
function scratchPack(n){
 if(n===1)return [voucher('simple','gifts'),voucher('simple','snow_collect'),
  voucher('medium','elf'),voucher('premium','premium_27')];
 const count=n%9===0?3:n%3===0||n%4===0?2:1;
 const pack=[voucher('simple',SIMPLE[n%2],count)];
 if(n%5===0&&n%10!==0)pack.push(voucher('medium',MEDIUM[(n/5-1)%MEDIUM.length]));
 if(n%8===0)pack.push(voucher('medium',MEDIUM[(n/8)%MEDIUM.length]));
 if(n%10===0)pack.push(voucher('premium',PREMIUM[(n/10-1)%PREMIUM.length]));
 return pack;
}
const SPECIAL=Object.freeze({
 2:{type:'feature',id:'dog-design-studio',title:'🎨 Brettdesigner'},
 3:{type:'cardEdition',id:'kartendesign-05',title:'🎅 Nikolaus-Kartendeck · Deluxe'},
 4:{type:'pieceShape',id:'dog-pawn-3d',title:'♟️ Klassische 3D-Spielfiguren'}
});
export const DOG_LEVEL_REWARDS=Object.freeze(Array.from({length:DOG_LEVEL_MAX},(_,i)=>{
 const n=i+1,bonus=SPECIAL[n],vouchers=Object.freeze(scratchPack(n));
 const count=vouchers.reduce((sum,v)=>sum+v.count,0);
 const reward=Object.freeze({
  type:n===1?'scratchStarter':bonus?.type||'scratchBundle',
  id:n===1?'scratch-vouchers-4':bonus?.id||'dog-level-scratch-'+n,
  title:n===1?'🎟️ Vier Rubbellos-Gutscheine · je 1 pro Losart':
   bonus?.title||('🎟️ '+count+' Rubbellos-'+(count===1?'Gutschein':'Gutscheine')),
  vouchers
 });
 return Object.freeze({level:n,id:'dog-player-level-'+n,configured:true,reward});
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
   lastEarnedXp:safeXp(d.lastEarnedXp),lastXpBonusPercent:Math.max(0,Math.min(140,Number.isInteger(d.lastXpBonusPercent)?d.lastXpBonusPercent:0)),
   lastWinXpBonusPercent:Math.max(0,Math.min(300,Number.isInteger(d.lastWinXpBonusPercent)?d.lastWinXpBonusPercent:0)),totalVerifiedMatches:Number.isSafeInteger(d.xpMatches)&&d.xpMatches>=0?d.xpMatches:0,
   wins:Number.isSafeInteger(d.wins)&&d.wins>=0?d.wins:0,
   xpRules:DOG_LEVEL_XP};
}
export function creditDogMatchXp(raw,{won=false,knockedOut=0,matchId,now=Date.now(),bonusPercent=0,researchPercent=0,winBonusPercent=0}={}){
 const old=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
 // A complete DOG match must always have a real, server-generated match ID.
 if(typeof matchId!=='string'||!matchId.trim()||matchId.length>128)throw Error('DOG_LEVEL_INVALID_MATCH');
 if(old.xpLastMatchId===matchId)return {...old,credited:false,xp:safeXp(old.xp),lastEarnedXp:0};
 const base=dogMatchXp({won,knockedOut});
 const academy=Number.isInteger(bonusPercent)?Math.max(0,Math.min(40,bonusPercent)):0;
 const research=Number.isInteger(researchPercent)?Math.max(0,Math.min(100,researchPercent)):0;
 const winBonus=Number.isInteger(winBonusPercent)?Math.max(0,Math.min(300,winBonusPercent)):0;
 const safeBonus=academy+research;
 // The win talent multiplies only the original 50 win XP, not the whole match.
 const earned=base+Math.round(base*safeBonus/100)+(won?Math.round(DOG_LEVEL_XP.win*winBonus/100):0);
 return {...old,lastXpBonusPercent:safeBonus,lastWinXpBonusPercent:winBonus,
   xp:Math.min(1000000000,safeXp(old.xp)+earned),
   lastEarnedXp:earned,xpLastMatchId:matchId,
   xpMatches:(Number.isSafeInteger(old.xpMatches)&&old.xpMatches>=0?old.xpMatches:0)+1,
   xpUpdatedAt:now,credited:true};
}
