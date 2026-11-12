/* S-01/S-02 · Deterministic server-authored combat event protocol.
 * Stage strikes keep their already-confirmed HP deltas. Only after the
 * authoritative outcome is persisted can the server append the difference
 * between cinematic phase damage and final rolled damage. No extra random
 * rolls, DB operations, side effects, or client-generated damage.
 */
const nonNegative=value=>Math.max(0,Math.round(Number(value)||0));
const safeHero=value=>typeof value==='string'&&value.length>0&&value.length<=200;

export function buildDogCombatStream({
 gate,attempt=1,startedAt=0,endsAt=0,roster=[],bossHp=0,strikes=[],result=null,heroMaximum=()=>145
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
   damage,amount:damage,rawDamage:damage,overkillDamage:0,
   hpBefore:before,hpAfter:after,
   atMs,impactAt:startedAt+atMs,
   blocked:hit.kind==='boss-strike'&&damage===0,
   correct:hit.correct??null
  });
 }
 // Finished battles alone may reveal the random roll, rare critical
 // and their difference from the conservative cinematic stage damage.
 // A visible LP loss is never larger than the remaining boss LP.
 let reconciliation=null;
 if(result&&typeof result.win==='boolean'&&
    Number.isSafeInteger(result.damage)&&result.damage>=0&&
    Number.isSafeInteger(result.hpRemaining)&&result.hpRemaining>=0){
  const finalHp=Math.min(initialBossHp,result.hpRemaining);
  const rawDamage=result.damage;
  const stageDamage=initialBossHp-bossRemaining;
  const appliedDamage=initialBossHp-finalHp;
  const extraApplied=bossRemaining-finalHp;
  const extraRaw=rawDamage-stageDamage;
  const overkillDamage=Math.max(0,rawDamage-appliedDamage);
  // A tuned/legacy result that disagrees with the existing stage events
  // cannot be "corrected" by fabricating negative damage. Expose a
  // mismatch for inspection instead of inventing an event.
  const reconciled=extraApplied>=0&&extraRaw>=extraApplied&&
   appliedDamage<=rawDamage&&
   Math.max(0,initialBossHp-rawDamage)===finalHp;
  if(reconciled&&(extraApplied>0||extraRaw>0)){
   const sequence=events.length+1;
   const lastRound=events.reduce((m,e)=>Math.max(m,e.round),0);
   const atMs=Math.max(nonNegative(endsAt-startedAt),
    events.length?events.at(-1).atMs+1:0);
   const roll=Number.isSafeInteger(result.roll)&&result.roll>=0&&result.roll<10000?
    result.roll:null;
   const luckFactor=roll===null?null:Number((Number(gate)===10?
    1.15-.25*(roll/10000):.82+.34*(1-roll/9999)).toFixed(5));
   events.push({
    eventId:fightId+':'+sequence,sequence,fightId,
    gate:nonNegative(gate),round:lastRound,
    uid:null,heroId:null,slot:players.length,
    actorId:'team',targetId:'boss',
    kind:'team-finisher',attackType:'team-finisher',
    damage:extraApplied,amount:extraApplied,
    rawDamage:extraRaw,overkillDamage:extraRaw-extraApplied,
    hpBefore:bossRemaining,hpAfter:finalHp,
    atMs,impactAt:startedAt+atMs,
    blocked:false,correct:null,
    rareCritical:result.rareCritical===true,
    luckRoll:roll,luckFactor
   });
  }
  reconciliation={reconciled,rawDamage,appliedDamage,
   stageDamage,finisherDamage:reconciled?extraApplied:null,
   overkillDamage,finalBossHp:finalHp,
   rareCritical:result.rareCritical===true};
 }
 return {version:1,fightId,latestSequence:events.length,
  initialBossHp,initialHeroHp,events,reconciliation};
}
