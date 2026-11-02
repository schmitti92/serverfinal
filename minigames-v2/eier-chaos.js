/** Eier-Chaos online rules. Pure reducer; hub owns identity, clock and persistence. */
export const DURATION_MS=60000;
export const EGG_COUNT=200;
const STAGES=[{start:0,count:40,interval:460,fall:1600},{start:20000,count:70,interval:260,fall:1250},{start:40000,count:90,interval:205,fall:950}];
const rottenAt=index=>{let offset=index;for(const stage of STAGES){if(offset<stage.count)return (offset+1)%(stage.start===0?10:stage.start===20000?4:3)===0;offset-=stage.count;}return false;};
const eligible=Array.from({length:EGG_COUNT},(_,i)=>i).filter(i=>!rottenAt(i));
const golden=new Set(Array.from({length:20},(_,k)=>eligible[Math.floor((k+.5)*eligible.length/20)]));
export function eggAt(index){
 if(!Number.isSafeInteger(index)||index<0||index>=EGG_COUNT)throw Error('INVALID_EGG_INDEX');
 let offset=index,spawnMs,fall;
 for(const stage of STAGES){if(offset<stage.count){spawnMs=stage.start+offset*stage.interval;fall=stage.fall;break;}offset-=stage.count;}
 return {index,spawnMs,landMs:spawnMs+fall,x:[.105,.263,.421,.579,.737,.895][(index*37+Math.floor(index/2)*3)%6],points:golden.has(index)?3:rottenAt(index)?-1:1};
}
function checkMembers(members){
 if(!Array.isArray(members)||members.length<1||members.length>4||members.some(m=>typeof m?.uid!=='string'||!m.uid)||new Set(members.map(m=>m.uid)).size!==members.length)throw Error('INVALID_MEMBERS');
}
export function createEierChaosMatch(members){
 checkMembers(members);
 return {phase:'instructions',ready:[],startAt:null,finished:false,players:Object.fromEntries(members.map(m=>[m.uid,{score:0,basket:.5,lastAt:0,caught:[]}]))};
}
export function acknowledgeEierChaos(match,members,uid,now){
 checkMembers(members);
 if(!members.some(m=>m.uid===uid))throw Error('NOT_A_PARTICIPANT');
 if(!Number.isFinite(now))throw Error('INVALID_TIME');
 if(match.phase!=='instructions')return match;
 if(!match.ready.includes(uid))match.ready.push(uid);
 if(match.ready.length===members.length){match.phase='countdown';match.startAt=now+3000;}
 return match;
}
function scoreBots(match){
 for(const [uid,player] of Object.entries(match.players)){
  if(!uid.startsWith('testbot:'))continue;
  let score=0;const caught=[];
  for(let i=0;i<EGG_COUNT;i++){
   const egg=eggAt(i);
   // Deterministic bots with distinct skill levels; no network calls or client scores.
   const skill=uid.endsWith(':1')?3:uid.endsWith(':2')?4:5;
   if((i+skill)%skill===0){score+=egg.points;caught.push(i);}
  }
  player.score=score;player.caught=caught;
 }
}
export function advanceEierChaos(match,now){
 if(!Number.isFinite(now))throw Error('INVALID_TIME');
 if(match.phase==='countdown'&&now>=match.startAt)match.phase='playing';
 if(match.phase==='playing'&&now>=match.startAt+DURATION_MS){scoreBots(match);match.phase='finished';match.finished=true;}
 return match;
}
/** Server timestamp is authoritative. Movement samples are rate-limited by caller.
 * A caught egg is awarded only when a sample brackets its landing time.
 * No client-supplied score or caught list is accepted.
 */
export function moveEierChaos(match,members,uid,{x},now){
 checkMembers(members);
 if(!members.some(m=>m.uid===uid))throw Error('NOT_A_PARTICIPANT');
 if(!Number.isFinite(x)||x<0||x>1)throw Error('INVALID_POSITION');
 if(match.phase==='countdown'&&now>=match.startAt)match.phase='playing';
 if(match.phase!=='playing')throw Error('NOT_PLAYING');
 const player=match.players[uid],at=Math.min(DURATION_MS,now-match.startAt);
 if(at<player.lastAt)throw Error('OUT_OF_ORDER_ACTION');
 const previous=player.lastAt;
 for(let i=0;i<EGG_COUNT;i++){
  const egg=eggAt(i);
  if(egg.landMs>previous&&egg.landMs<=at&&egg.spawnMs<DURATION_MS&&!player.caught.includes(i)&&Math.abs(x-egg.x)<=.055){
   player.score+=egg.points;player.caught.push(i);
  }
 }
 player.lastAt=at;player.basket=x;
 return match;
}
export function publicEierChaos(match,members,uid,now){
 const phase=match.phase==='countdown'&&now>=match.startAt?'playing':match.phase==='playing'&&now>=match.startAt+DURATION_MS?'finished':match.phase;
 return {phase,startAt:match.startAt,durationMs:DURATION_MS,readyCount:match.ready.length,playerCount:members.length,myBasket:match.players[uid]?.basket??null,results:phase==='finished'?members.map(m=>({seat:m.seat,name:m.name,score:match.players[m.uid].score})):null};
}
