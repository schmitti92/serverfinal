/**
 * MiniGame Engine 2.0 – isolated, deterministic room/match coordinator.
 * No imports from legacy engine, no DOM, network, storage or authentication.
 * The caller MUST authenticate identities and durably commit the returned
 * state/event before acknowledging a binding command.
 */
export const ENGINE_VERSION='2.0.0';
const clone=x=>structuredClone(x);
const fail=code=>{throw Error(code);};
const unique=xs=>new Set(xs).size===xs.length;
const member=(s,id)=>s.members.find(p=>p.id===id);
const playing=s=>s.match&&['countdown','playing','awaiting-results'].includes(s.match.phase);
const isHost=(s,id)=>s.hostId===id;
const MAX=4;
function check(s){
 if(!s||s.version!==ENGINE_VERSION||!s.roomId||!s.hostId)fail('INVALID_ROOM');
 if(!Array.isArray(s.members)||!unique(s.members.map(p=>p.id)))fail('INVALID_MEMBERS');
 if(s.match&&(!unique(s.match.roster)||s.match.roster.length<1||s.match.roster.length>MAX))fail('INVALID_ROSTER');
 return s;
}
export function createRoom({roomId,hostId,hostName='',botPreset=0,now=0}){
 if(typeof roomId!=='string'||!roomId||typeof hostId!=='string'||!hostId)fail('INVALID_ID');
 if(!Number.isInteger(botPreset)||botPreset<0||botPreset>3)fail('INVALID_BOT_PRESET');
 return check({version:ENGINE_VERSION,roomId,hostId,revision:0,botPreset,
  members:[{id:hostId,name:hostName,joined:0,played:0}],waitlist:[],match:null,
  archive:[],processed:[],closed:false,hostAbsentSince:null,createdAt:now});
}
function order(s){return s.members.filter(p=>p.id!==undefined).sort((a,b)=>a.played-b.played||a.joined-b.joined);}
function pick(s,excluded=[]){
 const eligible=order(s).filter(p=>!excluded.includes(p.id));
 const humans=eligible.slice(0,MAX);
 const bots=Array.from({length:Math.min(s.botPreset,MAX-humans.length)},(_,i)=>'bot:'+s.roomId+':'+i);
 return [...humans.map(p=>p.id),...bots];
}
function refreshQueue(s){const chosen=new Set(s.match?.roster||[]);s.waitlist=order(s).filter(p=>!chosen.has(p.id)).map(p=>p.id);}
function ensureActor(s,id){if(!member(s,id))fail('NOT_A_MEMBER');}
function ensureHost(s,id){ensureActor(s,id);if(!isHost(s,id))fail('HOST_ONLY');}
function apply(s,c){
 const id=c.actorId, m=s.match;
 switch(c.type){
 case 'join':{
  if(s.members.some(p=>p.id===id))return;
  if(typeof id!=='string'||!id)fail('INVALID_ID');
  s.members.push({id,name:String(c.name||'').slice(0,40),joined:s.members.reduce((n,p)=>Math.max(n,p.joined),0)+1,played:0});
  if(m?.phase==='instructions'){/* new humans spectate until next match */}
  refreshQueue(s);return;
 }
 case 'leave':{
  ensureActor(s,id);
  if(isHost(s,id))fail('HOST_CLOSE_REQUIRED');
  s.members=s.members.filter(p=>p.id!==id);
  if(m?.phase==='instructions'&&m.roster.includes(id)){
   m.roster=m.roster.filter(p=>p!==id);delete m.ready[id];
   if(!m.roster.length)fail('NO_PARTICIPANTS');
   const next=pick(s,m.excluded).find(p=>!m.roster.includes(p));
   if(next)m.roster.push(next);
  }
  refreshQueue(s);return;
 }
 case 'bot-preset':{
  ensureHost(s,id);
  if(m&&!['finished','invalid','aborted'].includes(m.phase))fail('MATCH_ACTIVE');
  if(!Number.isInteger(c.count)||c.count<0||c.count>3)fail('INVALID_BOT_PRESET');
  s.botPreset=c.count;return;
 }
 case 'prepare':{
  ensureHost(s,id);
  if(m&&!['finished','invalid','aborted'].includes(m.phase))fail('MATCH_ACTIVE');
  if(typeof c.matchId!=='string'||!c.matchId||s.archive.some(a=>a.id===c.matchId)||m?.id===c.matchId)fail('MATCH_ID_REUSED');
  if(typeof c.gameId!=='string'||!c.gameId)fail('INVALID_GAME');
  const roster=pick(s);if(!roster.length)fail('NO_PARTICIPANTS');
  s.match={id:c.matchId,gameId:c.gameId,phase:'instructions',roster,ready:{},excluded:[],results:{},startedAt:null,finishedAt:null};
  refreshQueue(s);return;
 }
 case 'exclude':{
  ensureHost(s,id);
  if(m?.phase!=='instructions')fail('NOT_PREPARING');
  if(!m.roster.includes(c.targetId)||c.targetId.startsWith('bot:'))fail('NOT_SELECTED_HUMAN');
  if(m.ready[c.targetId])fail('PLAYER_ALREADY_READY');
  m.excluded.push(c.targetId);m.roster=m.roster.filter(p=>p!==c.targetId);
  delete m.ready[c.targetId];
  const next=pick(s,m.excluded).find(p=>!m.roster.includes(p));
  if(next)m.roster.push(next);
  if(!m.roster.length)fail('NO_PARTICIPANTS');
  refreshQueue(s);return;
 }
 case 'ready':{
  ensureActor(s,id);
  if(m?.phase!=='instructions'||!m.roster.includes(id))fail('NOT_SELECTED');
  m.ready[id]=true;
  if(m.roster.every(p=>(p.startsWith('bot:')||p.startsWith('testbot:'))||m.ready[p])){
   m.phase='countdown';m.startedAt=c.now+3000;
  }return;
 }
 case 'tick':{
  ensureHost(s,id);
  if(m?.phase==='countdown'&&c.now>=m.startedAt)m.phase='playing';
  return;
 }
 case 'submit-result':{
  if(!m||!['playing','awaiting-results'].includes(m.phase))fail('NOT_PLAYING');
  if(!m.roster.includes(id))fail('NOT_SELECTED');
  if(Object.hasOwn(m.results,id))fail('RESULT_ALREADY_SUBMITTED');
  if(!c.verified||!Number.isFinite(c.score))fail('UNVERIFIED_RESULT');
  m.results[id]={score:c.score,status:'verified'};
  m.phase='awaiting-results';
  if(m.roster.every(p=>Object.hasOwn(m.results,p)))finish(s,c.now);
  return;
 }
 case 'disqualify':{
  ensureHost(s,id);
  if(!m||!['playing','awaiting-results'].includes(m.phase))fail('NOT_PLAYING');
  if(!m.roster.includes(c.targetId)||Object.hasOwn(m.results,c.targetId))fail('INVALID_DISQUALIFICATION');
  if(c.reason!=='disconnect-expired')fail('INVALID_DISQUALIFICATION');
  m.results[c.targetId]={status:'disqualified'};
  m.phase='awaiting-results';
  if(m.roster.every(p=>Object.hasOwn(m.results,p)))finish(s,c.now);
  return;
 }
 case 'abort':{
  ensureHost(s,id);if(!m||!['instructions','countdown','playing','awaiting-results'].includes(m.phase))fail('NOT_ACTIVE');
  m.phase='aborted';m.finishedAt=c.now;archive(s);return;
 }
 case 'invalidate':{
  ensureHost(s,id);if(!m||['finished','invalid','aborted'].includes(m.phase))fail('NOT_ACTIVE');
  if(c.reason!=='unrecoverable-state')fail('INVALID_REASON');
  m.phase='invalid';m.finishedAt=c.now;archive(s);return;
 }
 case 'close':{
  ensureHost(s,id);if(playing(s))fail('PROTECTED_MATCH');
  s.closed=true;return;
 }
 default:fail('UNKNOWN_COMMAND');
 }
}
function archive(s){
 if(s.archive.some(a=>a.id===s.match.id))return;
 s.archive.push({id:s.match.id,gameId:s.match.gameId,phase:s.match.phase,
  results:clone(s.match.results),finishedAt:s.match.finishedAt});
 if(s.match.phase==='finished')for(const id of s.match.roster){
  const p=member(s,id);if(p)p.played++;
 }
 refreshQueue(s);
}
function finish(s,now){s.match.phase='finished';s.match.finishedAt=now;archive(s);}
export function dispatch(state,command){
 const s=check(clone(state));
 if(s.closed)fail('ROOM_CLOSED');
 if(!command||typeof command!=='object'||typeof command.commandId!=='string'||!command.commandId)fail('COMMAND_ID_REQUIRED');
 if(s.processed.includes(command.commandId))return {state:s,event:null,duplicate:true};
 if(command.expectedRevision!==s.revision)fail('STALE_REVISION');
 if(!Number.isFinite(command.now))fail('INVALID_TIME');
 apply(s,command);s.revision++;
 s.processed.push(command.commandId);
 // Caller must retain command IDs for the durable deduplication horizon.
 const event={roomId:s.roomId,matchId:s.match?.id||null,revision:s.revision,
  commandId:command.commandId,type:command.type,at:command.now};
 return {state:check(s),event,duplicate:false};
}
export function project(state,viewerId){
 const s=check(state),m=s.match;
 const own=m?.roster.includes(viewerId);
 return {version:s.version,roomId:s.roomId,revision:s.revision,hostId:s.hostId,
  members:s.members.map(({id,name})=>({id,name})),waitlist:[...s.waitlist],
  match:m?{id:m.id,gameId:m.gameId,phase:m.phase,roster:[...m.roster],
   readyCount:Object.keys(m.ready).length,startedAt:m.startedAt,
   results:m.phase==='finished'?clone(m.results):null,participating:!!own}:null};
}
