import test from 'node:test';
import assert from 'node:assert/strict';
import { installSharedLobby } from '../shared-lobby.js';
import { installHubBusiness } from '../business-hub.js';

function suite(){
 const docs=new Map(),routes=[],middleware=[];
 const snapshot=v=>({exists:!!v,data:()=>structuredClone(v)});
 const db={pending:Promise.resolve(),collection(name){return {doc(code){return {path:name+'/'+code,get:async()=>snapshot(docs.get(name+'/'+code))}}}},runTransaction(fn){
   const job=this.pending.catch(()=>{}).then(async()=>{const operations=[],tx={get:async ref=>snapshot(docs.get(ref.path)),set:(ref,v)=>operations.push(()=>docs.set(ref.path,structuredClone(v))),delete:ref=>operations.push(()=>docs.delete(ref.path))};const result=await fn(tx);operations.forEach(f=>f());return result;});this.pending=job.catch(()=>{});return job;
 }};
 const users={alice:{uid:'id_alice',name:'Alex'},bob:{uid:'id_bob',name:'Alex'},cara:{uid:'id_cara',name:'Cara'},outsider:{uid:'id_out',name:'Out'}};
 const app={get:(path,fn)=>routes.push({method:'GET',path,fn}),post:(path,fn)=>routes.push({method:'POST',path,fn}),use:(path,fn)=>middleware.push({path,fn})};
 const hub=installSharedLobby(app,{verifyProfile:async token=>users[token]||null,getFirestore:()=>db,clock:()=>1000,codeGenerator:()=>"ABC23D",isMatchFinished:async match=>business.isFinished(match)});
 const business=installHubBusiness(app,{verifyProfile:async token=>users[token]||null,getSeat:hub.businessSeat,getFirestore:()=>db});
 async function request(method,path,user='alice',body,query={}){
   const route=routes.find(x=>x.method===method&&x.path.split('/').length===path.split('/').length&&x.path.split('/').every((p,i)=>p[0]===':'||p===path.split('/')[i]));
   if(!route)throw Error('ROUTE_NOT_FOUND '+path);
   const params={};route.path.split('/').forEach((v,i)=>{if(v.startsWith(':'))params[v.slice(1)]=path.split('/')[i]});
   const req={params,body:body||{},query,get:k=>k==='authorization'?`Bearer ${user}`:''};
   const res={statusCode:200,status(n){this.statusCode=n;return this},json(data){this.body=data;return this}};
   const mw=middleware.find(x=>path===x.path||path.startsWith(x.path+'/'));
   if(mw){let next;await mw.fn(req,res,()=>{next=route.fn(req,res)});if(next)await next;}else await route.fn(req,res);
   return {status:res.statusCode,...res.body};
 }
 const start=async()=>{
   const {room}=await request('POST','/api/hub/rooms');const code=room.code;
   await request('POST',`/api/hub/rooms/${code}/join`,'bob');
   await request('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'business'});
   await request('POST',`/api/hub/rooms/${code}/business-settings`,'alice',{settings:{rounds:30}});
   await request('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
   const started=await request('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true});
   const gameCode=started.room.match.gameCode, matchId=started.room.match.id;
   const hostSeat=await hub.businessSeat(gameCode,users.alice);
   const game={players:hostSeat.members.map(m=>({name:m.name,cash:0})),targetRounds:30,current:0,turnNumber:1,bank:1000,gameEnded:false,market:[],deck:[]};
   return {code,gameCode,matchId,hostSeat,game};
 };
 return {request,start,hub,business,db,docs,users};
}
test('Business starts automatically in the same room with host-owned 30-round setting and unique player names',async()=>{
 const h=suite(),root=await h.start();
 assert.match(root.gameCode,/^D[A-HJ-NP-Z2-9]{9}$/);assert.equal(root.gameCode.slice(1,7),root.code);
 assert.deepEqual(root.hostSeat.members.map(x=>x.name),['Alex','Alex 2']);
 assert.equal(root.hostSeat.settings.rounds,30);
 assert.equal((await h.request('POST',`/api/hub/rooms/${root.code}/business-settings`,'bob',{settings:{rounds:10}})).status,403);
 assert.equal((await h.request('GET',`/api/hub/business/${root.gameCode}`,'outsider')).status,403);
});
test('Business hub state can only be initialized by the host, exactly once',async()=>{
 const h=suite(),root=await h.start(),url=`/api/hub/business/${root.gameCode}`;
 const payload={matchId:root.matchId,game:root.game};
 assert.equal((await h.request('POST',url+'/bootstrap','bob',payload)).status,403);
 assert.equal((await h.request('POST',url+'/bootstrap','alice',{...payload,matchId:'bad'})).status,409);
 const pair=await Promise.all([h.request('POST',url+'/bootstrap','alice',payload),h.request('POST',url+'/bootstrap','alice',payload)]);
 assert.deepEqual(pair.map(x=>x.status),[200,200]);assert.equal(pair[0].rev,1);assert.equal(pair[1].rev,1);
 const wrong=structuredClone(root.game);wrong.players[1].name='Intruder';
 assert.equal((await h.request('POST',url+'/bootstrap','alice',{...payload,game:wrong})).status,400);
});
test('Business hub rejects outsiders, spectators and manipulated rosters',async()=>{
 const h=suite(),root=await h.start(),url=`/api/hub/business/${root.gameCode}`;
 assert.equal((await h.request('GET',url,'outsider')).status,403);
 assert.equal((await h.request('POST',url+'/state','outsider',{baseRev:1,game:root.game})).status,403);
 const x=await h.request('POST',url+'/bootstrap','alice',{matchId:root.matchId,game:root.game});assert.equal(x.status,200);
 const roster=structuredClone(root.game);roster.players.push({name:'Out'});
 assert.equal((await h.request('POST',url+'/state','alice',{baseRev:1,game:roster})).status,400);
 assert.equal((await h.request('POST',url+'/state','alice',{baseRev:1,game:{...root.game,targetRounds:10}})).status,400);
});
test('Business hub enforces optimistic concurrency and active user turn',async()=>{
 const h=suite(),root=await h.start(),url=`/api/hub/business/${root.gameCode}`;
 await h.request('POST',url+'/bootstrap','alice',{matchId:root.matchId,game:root.game});
 assert.equal((await h.request('POST',url+'/state','bob',{baseRev:1,game:root.game})).status,403);
 const updated={...root.game,turnNumber:2,current:1};
 assert.equal((await h.request('POST',url+'/state','alice',{baseRev:1,game:updated})).status,200);
 assert.equal((await h.request('POST',url+'/state','alice',{baseRev:1,game:updated})).status,409);
 const current=await h.request('GET',url,'bob',undefined,{rev:'1'});
 assert.equal(current.rev,2);assert.equal(current.game.current,1);
 assert.equal((await h.request('POST',url+'/state','alice',{baseRev:2,game:{...updated,turnNumber:3,current:0}})).status,403);
});
test('Business can be finished and next match played without losing hub members',async()=>{
 const h=suite(),root=await h.start(),url=`/api/hub/business/${root.gameCode}`;
 await h.request('POST',url+'/bootstrap','alice',{matchId:root.matchId,game:root.game});
 assert.equal((await h.request('POST',`/api/hub/rooms/${root.code}/finish`,'alice')).status,409);
 const ended={...root.game,gameEnded:true};
 assert.equal((await h.request('POST',url+'/state','alice',{baseRev:1,game:ended})).status,200);
 assert.equal((await h.request('POST',url+'/state','alice',{baseRev:2,game:ended})).status,409);
 assert.equal((await h.request('POST',`/api/hub/rooms/${root.code}/finish`,'bob')).status,403);
 assert.equal((await h.request('POST',`/api/hub/rooms/${root.code}/finish`,'alice')).status,200);
 const inside=await h.request('GET',`/api/hub/rooms/${root.code}`);assert.equal(inside.room.players.length,2);assert.equal(inside.room.phase,'lobby');
 await h.request('POST',`/api/hub/rooms/${root.code}/select`,'alice',{game:'business'});
 await h.request('POST',`/api/hub/rooms/${root.code}/ready`,'alice',{ready:true});
 const second=await h.request('POST',`/api/hub/rooms/${root.code}/ready`,'bob',{ready:true});
 assert.notEqual(second.room.match.gameCode,root.gameCode);
});

test('Business rejects skipped seats, seat swaps within a turn and tampered match settings',async()=>{
 const h=suite(),root=await h.start(),url=`/api/hub/business/${root.gameCode}`;
 const game={...root.game,bankStart:3640,longGameVersion:1,playerCount:2};
 assert.equal((await h.request('POST',url+'/bootstrap','alice',{matchId:root.matchId,game})).status,200);
 const cases=[
  {...game,current:1},
  {...game,turnNumber:2,current:0},
  {...game,turnNumber:2,current:1,bankStart:999999},
  {...game,turnNumber:2,current:1,longGameVersion:99},
  {...game,turnNumber:2,current:1,playerCount:3}
 ];
 for(const invalid of cases){
  const response=await h.request('POST',url+'/state','alice',{baseRev:1,game:invalid});
  assert.ok(response.status===400||response.status===409,JSON.stringify(response));
 }
 assert.equal((await h.request('POST',url+'/state','alice',{baseRev:1,game:{...game,turnNumber:2,current:1}})).status,200);
});

test('Business refuses corrupted or impossible player balances without changing saved revision',async()=>{
 const h=suite(),root=await h.start(),url=`/api/hub/business/${root.gameCode}`;
 const corrupt=structuredClone(root.game);
 corrupt.players[0].cash=-1;
 assert.equal((await h.request('POST',url+'/bootstrap','alice',{matchId:root.matchId,game:corrupt})).status,400);
 assert.equal((await h.request('POST',url+'/bootstrap','alice',{matchId:root.matchId,game:root.game})).status,200);
 for(const cash of [-1,1.5,Number.MAX_SAFE_INTEGER+1,'1000',null]){
  const next=structuredClone(root.game);
  next.players[0].cash=cash;
  assert.equal((await h.request('POST',url+'/state','alice',{baseRev:1,game:next})).status,400);
 }
 const unchanged=await h.request('GET',url,'alice');
 assert.equal(unchanged.rev,1);
 assert.equal(unchanged.game.players[0].cash,0);
});

test('Business rejects invalid bank, dice and roll counters without changing the persisted match',async()=>{
 const h=suite(),root=await h.start(),url=`/api/hub/business/${root.gameCode}`;
 const initial={...root.game,dice:[1,2,3,4,5],rolls:0,roundAnchor:0,finalRound:false};
 assert.equal((await h.request('POST',url+'/bootstrap','alice',{matchId:root.matchId,game:initial})).status,200);
 const changes=[
  {bank:-1},{bank:1.25},{bank:'1000'},
  {dice:[1,2,3,4,7]},{dice:[1,2,3]},
  {rolls:-1},{rolls:4},{rolls:1.5},
  {roundAnchor:1}
 ];
 for(const change of changes){
  const response=await h.request('POST',url+'/state','alice',{baseRev:1,game:{...initial,...change}});
  assert.equal(response.status,400,JSON.stringify(change));
 }
 assert.equal((await h.request('GET',url,'alice')).rev,1);
 assert.equal((await h.request('POST',url+'/state','alice',{baseRev:1,game:{...initial,rolls:1,dice:[6,6,6,6,6]}})).status,200);
});
