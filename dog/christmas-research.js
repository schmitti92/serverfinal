/** Lichtertal Weihnachtsforschung – personal, server-owned progression.
 * Only entries with enabled:true can be purchased. Other ideas are previews,
 * not misleading charged upgrades. Never trust the browser for levels/points.
 */
import {dogLevelFromXp} from './player-levels.js';

export const DOG_RESEARCH_COLLECTION='dog_christmas_research_v1';
const skill=(id,icon,name,category,maxLevel,description,steps,{enabled=false,onceCost=0}={})=>
 Object.freeze({id,icon,name,category,maxLevel,description,steps,enabled,onceCost});
export const DOG_RESEARCH_SKILLS=Object.freeze([
 skill('card_swap','🃏','Magischer Kartentausch','game',1,'Vor einer Kartenphase eine Handkarte einmal zufällig tauschen.','Eine Karte pro Partie',{onceCost:5}),
 skill('future_sight','🔮','Blick in die Zukunft','game',3,'Die oberste Nachziehkarte heimlich ansehen.','1 / 2 / 3 Einblicke'),
 skill('thaw','🛡️','Weihnachtsschutz','game',2,'Eingefrorene Figur durch Antippen befreien, auch bei Mitspielern.','Bis Stufe 2'),
 skill('fog_lantern','🏮','Magische Nebellaterne','game',3,'Nebel im Grinch-Event kurzzeitig lichten.','1 / 2 / 3 Felder'),
 skill('grinch_compass','🧭','Grinch-Kompass','game',3,'Grinch-Figur kurzzeitig sichtbar machen.','1 / 2 / 3 Einsichten'),
 skill('xp','📚','Wichtelwissen','xp',10,'Mehr Erfahrung nach jeder abgeschlossenen DOG-Partie.','Je Stufe +10 %, maximal +100 %',{enabled:true}),
 skill('win_xp','🏆','Siegerakademie','xp',10,'Mehr Erfahrung für gewonnene DOG-Partien.','Je Stufe +30 % auf Sieger-XP, maximal +300 %',{enabled:true}),
 skill('daily_xp','🌅','Weihnachtlicher Frühstart','xp',3,'Ein XP-Bonus für die erste Partie des Tages.','+10 / +20 / +30 XP'),
 skill('mission_xp','📜','Missionsforscher','xp',3,'Mehr XP für Eventmissionen.','+5 / +10 / +15 %'),
 skill('effort','💪','Winterlicher Fleiß','xp',3,'Bonus für regelmäßige DOG-Partien.','+10 / +20 / +30 XP'),
 skill('discount','🎟️','Glückshaus-Rabatt','scratch',10,'Persönlicher Rabatt auf bezahlte Rubbellose, zusätzlich zum Dorf.','Je Stufe 2 %, maximal 20 %',{enabled:true}),
 skill('coin_bonus','💰','Goldene Gewinnforschung','scratch',10,'Zusätzliche Münzen bei Gewinn; getrennt vom Auflagenbudget.','Je Stufe +2 %, maximal +20 %',{enabled:true}),
 skill('pity','🍀','Trostengel','scratch',5,'Nach bezahlten Nieten erhältst du ein einfaches Gratislos.','9 / 8 / 7 / 6 / 5 Nieten',{enabled:true}),
 skill('free_ticket','🎫','Wichtel-Losfabrik','scratch',10,'Einfaches oder mittleres Los regelmäßig von Hand abholen.','Alle 24 / 22 / 20 / … / 6 Stunden',{enabled:true}),
 skill('spot_ticket','🔍','Verborgener Losfinder','game',1,'Ein Losfeld ist zu Spielbeginn ausschließlich für dich sichtbar.','Eine geheime Feldmarkierung',{onceCost:3}),
 skill('spot_light','🌟','Lichtfeld-Entdecker','game',1,'Ein Lichtfeld ist zu Spielbeginn ausschließlich für dich sichtbar.','Eine geheime Feldmarkierung',{onceCost:3}),
 skill('lights_bonus','⭐','Sternensammler','village',10,'Bis zu 50 % mehr persönlich gesammelte Weihnachtslichter.','Je Stufe +5 %, maximal 50 %'),
 skill('gift_magnet','🎁','Geschenkmagnet','village',3,'Zusätzliche Geschenke auf dem Brett finden.','+2 / +4 / +6 %'),
 skill('elf_luck','🧝','Wichtelglück','village',3,'Mehr zusätzliche Sammelobjekte.','+1 / +2 / +3 %'),
 skill('builder','🏗️','Weihnachtsbaumeister','village',3,'Alle zwei Stunden Lichter aktiv einsammeln, ohne Stapelung.','1 / 2 / 3 Lichter pro Abholung',{enabled:true}),
 skill('advent','🎁','Adventssegen','village',3,'Gutscheine für abgeschlossene Grinch-Missionen.','1 / 2 / 3 Lose')
]);
export const dogResearchSkill=id=>DOG_RESEARCH_SKILLS.find(skill=>skill.id===id);
export const dogResearchLevel=(raw,id)=>{
 const skill=dogResearchSkill(id);
 const value=raw?.levels?.[id];
 return skill&&Number.isInteger(value)?Math.max(0,Math.min(skill.maxLevel,value)):0;
};
export function dogResearchEarned(level){
 let result=0;
 for(let n=2;n<=Math.min(50,Math.max(1,level));n++)result+=n%10===0?3:n%5===0?2:1;
 return result;
}
export function dogResearchCost(skill,targetLevel){
 if(!skill||targetLevel<1||targetLevel>skill.maxLevel)return Infinity;
 if(skill.onceCost)return skill.onceCost;
 if(skill.maxLevel===10)return targetLevel<=3?1:targetLevel<=7?2:3;
 if(skill.maxLevel===5)return [1,1,2,2,3][targetLevel-1];
 return targetLevel;
}
export function dogResearchStatus(raw,xp=0,now=Date.now()){
 const lvl=dogLevelFromXp(xp).level;
 const levels=Object.fromEntries(DOG_RESEARCH_SKILLS.map(skill=>[skill.id,dogResearchLevel(raw,skill.id)]));
 const spent=DOG_RESEARCH_SKILLS.reduce((sum,skill)=>{
  const amount=levels[skill.id];
  for(let n=1;n<=amount;n++)sum+=dogResearchCost(skill,n);
  return sum;
 },0);
 const earned=dogResearchEarned(lvl);
 const cooldowns={
  freeTicketAt:Number.isSafeInteger(raw?.freeTicketAt)?raw.freeTicketAt:0,
  builderAt:Number.isSafeInteger(raw?.builderAt)?raw.builderAt:0
 };
 return {level:lvl,earned,spent,available:Math.max(0,earned-spent),levels,
  cooldowns,now, pityNiets:Number.isInteger(raw?.pityNiets)?Math.max(0,Math.min(999,raw.pityNiets)):0,
  skills:DOG_RESEARCH_SKILLS.map(s=>({...s,nextCost:levels[s.id]<s.maxLevel?dogResearchCost(s,levels[s.id]+1):null}))};
}
export function dogResearchUpgrade(raw,xp,id,now=Date.now()){
 const skill=dogResearchSkill(id);
 if(!skill)throw Error('RESEARCH_UNKNOWN');
 if(!skill.enabled)throw Error('RESEARCH_NOT_READY');
 const current=dogResearchStatus(raw,xp,now),oldLevel=current.levels[id];
 if(oldLevel>=skill.maxLevel)throw Error('RESEARCH_MAX_LEVEL');
 const cost=dogResearchCost(skill,oldLevel+1);
 if(cost>current.available)throw Error('RESEARCH_NOT_ENOUGH_POINTS');
 const levels={...(raw?.levels||{}),[id]:oldLevel+1};
 const next={...(raw||{}),levels,updatedAt:now};
 if(id==='builder'&&!Number.isSafeInteger(next.builderAt))next.builderAt=now+7200000;
 if(id==='free_ticket'&&!Number.isSafeInteger(next.freeTicketAt))next.freeTicketAt=now+86400000;
 return next;
}
export const dogResearchPityThreshold=level=>level>0?10-Math.min(5,level):0;
export const dogResearchTicketMs=level=>Math.max(6,24-2*(Math.max(1,level)-1))*3600000;
