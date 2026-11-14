/** Short-lived read-only snapshot from a successfully committed Deal game update.
 * Does not persist or approve actions. Keeps only publicView(game) projections.
 * The existing authorization check still runs before every HTTP game read.
 */
export function createDealCommittedStateSeed({clock=Date.now,ttlMs=2500,maxKnown=300}={}){
 const lastCommitted=new Map();
 const counters={seeds:0,staleSkipped:0};
 function seed(code,game,view){
  if(typeof code!=='string'||!code||typeof game?.id!=='string'||
     !Number.isSafeInteger(game.revision)||game.revision<0||
     !view||view.id!==game.id||view.revision!==game.revision)return null;
  const prior=lastCommitted.get(code);
  // Concurrent handlers can publish in reverse order. Never put an older
  // revision back in RAM after a newer locally confirmed transaction.
  if(prior&&(
    (prior.id===game.id&&prior.revision>game.revision)||
    (prior.id!==game.id&&!['final','done'].includes(prior.phase))
  )){counters.staleSkipped++;return null;}
  lastCommitted.delete(code);
  lastCommitted.set(code,{id:game.id,revision:game.revision,phase:game.phase});
  if(lastCommitted.size>maxKnown)lastCommitted.delete(lastCommitted.keys().next().value);
  counters.seeds++;
  return {promise:Promise.resolve(view),expires:clock()+ttlMs,committed:true};
 }
 function stats(){return {...counters,ttlMs,knownRooms:lastCommitted.size};}
 return {seed,stats};
}
