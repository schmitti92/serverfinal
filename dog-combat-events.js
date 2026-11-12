/* S-01 · Server-authored, deterministic combat event protocol.
 * Pure projection of the ALREADY confirmed cinematic strikes (no independent
 * damage rolls, Firestore reads/writes, local time, or persisted documents).
 * It intentionally does not invent the final random combat adjustment:
 * settling the full result is S-02, which must reconcile that delta.
 */
const nonNegative=value=>Math.max(0,Math.round(Number(value)||0));
const safeHero=value=>typeof value==='string'&&value.length>0&&value.length<=200;

export function buildDogCombatStream({
 gate,attempt=1,startedAt=0,roster=[],bossHp=0,strikes=[],heroMaximum=()=>145
}={}){
 const initialBossHp=nonNegative(bossHp);
 const players=Array.isArray(roster)?roster.filter(p=>safeHero(p?.uid)).slice(0,3):[];
 const initialHeroHp=Object.fromEntries(players.map(hero=>{
  const hp=nonNegative(heroMaximum(hero));
  return [hero.uid,hp];
 }));
 const validStart=Number.isSafeInteger(startedAt)&&startedAt>0;
 const fightId=validStart?'g'+gate+'-t'+startedAt+'-a'+nonNegative(attempt):null;
 const events=[];
 if(!fightId)return {version:1,fightId:null,latestSequence:0,
  initialBossHp,initialHeroHp,events};
 const heroHp={...initialHeroHp};
 let bossRemaining=initialBossHp;
 const known=new Set(players.map(p=>p.uid));
 const ordered=(Array.isArray(strikes)?strikes:[])
  .filter(hit=>hit&&known.has(hit.uid)&&
   ['hero-strike','boss-strike'].includes(hit.kind)&&
   Number.isInteger(hit.round)&&hit.round>=0&&hit.round<20&&
   Number.isInteger(hit.slot)&&hit.slot>=0&&hit.slot<3&&
   Number.isFinite(Number(hit.atMs))&&Number(hit.atMs)>=0&&
   Number.isFinite(Number(hit.amount))&&Number(hit.amount)>=0)
  .sort((a,b)=>a.atMs-b.atMs||a.round-b.round||a.slot-b.slot);
 for(const hit of ordered){
  const targetId=hit.kind==='hero-strike'?'boss':hit.uid;
  const before=targetId==='boss'?bossRemaining:heroHp[targetId];
  const damage=Math.min(before,nonNegative(hit.amount));
  const after=before-damage;
  if(targetId==='boss')bossRemaining=after;
  else heroHp[targetId]=after;
  const sequence=events.length+1;
  const atMs=nonNegative(hit.atMs);
  // Keep legacy strike field names: older clients read these verbatim.
  events.push({
   eventId:fightId+':'+sequence,sequence,fightId,
   gate:nonNegative(gate),round:hit.round,
   uid:hit.uid,heroId:hit.uid,slot:hit.slot,
   actorId:hit.kind==='hero-strike'?hit.uid:'boss',
   targetId,attackType:hit.kind,kind:hit.kind,
   damage,amount:damage,hpBefore:before,hpAfter:after,
   atMs,impactAt:startedAt+atMs,
   blocked:hit.kind==='boss-strike'&&damage===0,
   correct:hit.correct??null
  });
 }
 return {version:1,fightId,latestSequence:events.length,
  initialBossHp,initialHeroHp,events};
}
