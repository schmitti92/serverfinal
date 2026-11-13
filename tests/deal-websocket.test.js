import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import crypto from 'node:crypto';
import {installDealOrNoDeal} from '../deal-or-no-deal-api.js';
import {BANKER_30_OPENINGS} from '../deal-or-no-deal.js';

const flush=()=>new Promise(resolve=>setTimeout(resolve,20));
function harness(participants=['a','b'],{roomReadDelay=0}={}){
 const routes=new Map(),docs=new Map(),reads=new Map();
 docs.set('spielesammlung_hub_v1/123',{hostUid:'a',revision:1,players:participants.map(uid=>({uid,name:uid.toUpperCase()}))});
 const app={get:(path,...fns)=>routes.set('GET '+path,fns),post:(path,...fns)=>routes.set('POST '+path,fns)};
 const db={collection:name=>({doc:id=>({
  get:async()=>{
   const key=name+'/'+id;
   reads.set(key,(reads.get(key)||0)+1);
   if(name==='spielesammlung_hub_v1'&&roomReadDelay)
    await new Promise(resolve=>setTimeout(resolve,roomReadDelay));
   return {exists:docs.has(key),data:()=>docs.get(key)};
  },
  set:async data=>docs.set(name+'/'+id,data)
 })}),runTransaction:async fn=>{
  const pending=[];
  const tx={get:async ref=>ref.get(),set:(ref,data)=>pending.push(()=>ref.set(data)),update:(ref,data)=>pending.push(async()=>ref.set({...((await ref.get()).data()||{}),...data})),create:(ref,data)=>pending.push(()=>ref.set(data))};
  const result=await fn(tx);for(const write of pending)await write();return result;
 }};
 const api=installDealOrNoDeal(app,{verifyProfile:async token=>participants.includes(token)?{uid:token}:null,getFirestore:()=>db});
 class Socket extends EventEmitter{
  readyState=1;sent=[];
  send(value){this.sent.push(JSON.parse(value))}
  close(){this.readyState=3;this.emit('close')}
  message(value){this.emit('message',JSON.stringify(value))}
 }
 const invoke=async(method,path,uid,body={})=>{
  const handlers=routes.get(method+' '+path);assert.ok(handlers,'route exists');
  const req={params:{code:'123'},body,get:()=> 'Bearer '+uid};
  const res={statusCode:200,headers:{},status(code){this.statusCode=code;return this},set(name,value){this.headers[name]=value;return this},json(value){this.body=value;return this}};
  for(const fn of handlers){await new Promise((resolve,reject)=>{let next=false;Promise.resolve(fn(req,res,()=>{next=true;resolve()})).then(()=>{if(!next)resolve()},reject)})}
  return res;
 };
 return {api,Socket,invoke,docs,reads};
}
test('Concurrent room checks share one Firestore read but every write gets a fresh membership check',async()=>{
 const {invoke,reads}=harness(['a','b','c'],{roomReadDelay:35});
 const path='/api/deal-or-no-deal/:code',key='spielesammlung_hub_v1/123';
 const requests=await Promise.all(['a','b','c'].map(uid=>invoke('GET',path,uid)));
 assert.ok(requests.every(r=>r.statusCode===200));
 assert.equal(reads.get(key),1,'three simultaneous GETs must not repeat the same room document');
 const start=await invoke('POST',path+'/start','a');
 assert.equal(start.body.ok,true,JSON.stringify(start.body));
 assert.equal(reads.get(key),2,'the mutation cannot authorize itself using a stale cached read');
});

test('Deal socket rejects users who are not room members',async()=>{
 const {api,Socket}=harness();const ws=new Socket();api.attachSocket(ws);
 ws.message({type:'subscribe',code:'123',token:'stranger'});await flush();
 assert.ok(ws.sent.some(m=>m.type==='deal-error'));
 assert.equal(ws.readyState,3);
});
test('Deal socket reauthenticates in-place and keeps every player synchronized',async()=>{
 const {api,Socket,invoke}=harness(['a','b']);
 const a=new Socket(),b=new Socket();
 api.attachSocket(a);api.attachSocket(b);
 a.message({type:'subscribe',code:'123',token:'a'});
 b.message({type:'subscribe',code:'123',token:'b'});
 await flush();
 a.message({type:'reauth',token:'a'});
 b.message({type:'reauth',token:'b'});
 await flush();
 assert.ok(a.sent.some(m=>m.type==='deal-reauthenticated'));
 assert.ok(b.sent.some(m=>m.type==='deal-reauthenticated'));
 assert.equal(a.readyState,1);
 assert.equal(b.readyState,1);
 const start=await invoke('POST','/api/deal-or-no-deal/:code/start','a');
 assert.equal(start.body.ok,true);
 for(const ws of [a,b]){
  assert.equal(ws.sent.filter(m=>m.type==='deal-state').at(-1)?.game?.id,start.body.game.id);
 }
 a.close();b.close();
});

test('Deal socket refresh cannot change player identity or bypass fresh room membership',async()=>{
 const {api,Socket,docs}=harness(['a','b']);
 const a=new Socket();api.attachSocket(a);
 a.message({type:'subscribe',code:'123',token:'a'});
 await flush();
 assert.equal(a.readyState,1);
 a.message({type:'reauth',token:'b'});
 await flush();
 assert.equal(a.readyState,3,'a different player token must invalidate the subscription');
 assert.equal(a.sent.some(m=>m.type==='deal-reauthenticated'),false);
 const b=new Socket();api.attachSocket(b);
 b.message({type:'subscribe',code:'123',token:'a'});
 await flush();
 const room=docs.get('spielesammlung_hub_v1/123');
 docs.set('spielesammlung_hub_v1/123',{...room,players:room.players.filter(p=>p.uid!=='a')});
 b.message({type:'reauth',token:'a'});
 await flush();
 assert.equal(b.readyState,3,'removed members cannot renew a socket');
 assert.ok(b.sent.some(m=>m.type==='deal-error'));
});

test('Deal socket delivers public state to two players after start',async()=>{
 const {api,Socket,invoke}=harness();
 const a=new Socket(),b=new Socket();
 api.attachSocket(a);api.attachSocket(b);
 a.message({type:'subscribe',code:'123',token:'a'});
 b.message({type:'subscribe',code:'123',token:'b'});
 await flush();
 assert.ok(a.sent.some(m=>m.type==='deal-subscribed'));
 assert.ok(b.sent.some(m=>m.type==='deal-subscribed'));
 const res=await invoke('POST','/api/deal-or-no-deal/:code/start','a');
 assert.equal(res.statusCode,200);
 assert.equal(res.body.ok,true);
 for(const ws of [a,b]){
  const state=ws.sent.filter(m=>m.type==='deal-state').at(-1);
  assert.ok(state?.game);
  assert.equal(state.game.players.length,2);
  assert.equal(Object.hasOwn(state.game,'values'),false);
  assert.equal(Object.hasOwn(state.game,'commands'),false);
  ws.close();
 }
});

test('Three viewers receive the identical timed briefcase reveal without secret amounts',async()=>{
 const {api,Socket,invoke}=harness(['a','b','c']);
 const viewers=['a','b','c'].map(uid=>{
  const ws=new Socket();api.attachSocket(ws);
  ws.message({type:'subscribe',code:'123',token:uid});return ws;
 });
 await flush();
 let res=await invoke('POST','/api/deal-or-no-deal/:code/start','a');
 assert.equal(res.body.ok,true);
 let game=res.body.game;
 for(let i=0;i<3;i++){
  res=await invoke('POST','/api/deal-or-no-deal/:code/action',game.order[i],{id:crypto.randomUUID(),revision:game.revision,type:'select',case:i});
  assert.equal(res.body.ok,true,JSON.stringify(res.body));game=res.body.game;
 }
 const actor=game.order[game.turnIndex];
 res=await invoke('POST','/api/deal-or-no-deal/:code/action',actor,{id:crypto.randomUUID(),revision:game.revision,type:'open',case:3});
 assert.equal(res.body.ok,true,JSON.stringify(res.body));
 assert.equal(res.body.game.phase,'reveal');
 const revealAt=res.body.game.pending.startedAt;
 assert.ok(Number.isFinite(revealAt));
 for(const ws of viewers){
  const state=ws.sent.filter(x=>x.type==='deal-state').at(-1).game;
  assert.equal(state.phase,'reveal');
  assert.equal(state.pending.startedAt,revealAt);
  assert.equal(state.pending.eventId,res.body.game.pending.eventId);
  assert.deepEqual(state.openedAmounts,[],'no case amount leaks during the shared reveal');
 }
 for(const ws of viewers)ws.close();
});

test('Both subscribed players receive every committed selection, open and reveal',async()=>{
 const {api,Socket,invoke}=harness();
 const a=new Socket(),b=new Socket();
 api.attachSocket(a);api.attachSocket(b);
 a.message({type:'subscribe',code:'123',token:'a'});
 b.message({type:'subscribe',code:'123',token:'b'});
 await flush();
 const started=await invoke('POST','/api/deal-or-no-deal/:code/start','a');
 assert.equal(started.body.ok,true);
 let game=started.body.game;
 const act=async(actor,type,extra={})=>{
  const result=await invoke('POST','/api/deal-or-no-deal/:code/action',actor,{id:crypto.randomUUID(),revision:game.revision,type,...extra});
  assert.equal(result.statusCode,200,JSON.stringify(result.body));
  game=result.body.game;
  for(const ws of [a,b]){
   const last=ws.sent.filter(m=>m.type==='deal-state').at(-1);
   assert.equal(last.game.revision,game.revision);
   assert.equal(last.game.phase,game.phase);
   assert.equal(Object.hasOwn(last.game,'values'),false);
  }
 };
 for(let i=0;i<2;i++)await act(game.order[i],'select',{case:i});
 assert.equal(game.phase,'open');
 const actor=game.order[game.turnIndex];
 await act(actor,'open',{case:2});
 assert.equal(game.phase,'reveal');
 await act(actor,'ack-reveal');
 assert.equal(game.phase,'open');
 assert.equal(game.opened.length,1);
 a.close();b.close();
});

test('Two players finish a banker round and receive exactly one wallet payout',async()=>{
 const {api,Socket,invoke,docs}=harness();
 const a=new Socket(),b=new Socket();
 api.attachSocket(a);api.attachSocket(b);
 a.message({type:'subscribe',code:'123',token:'a'});
 b.message({type:'subscribe',code:'123',token:'b'});
 await flush();
 let result=await invoke('POST','/api/deal-or-no-deal/:code/start','a');
 assert.equal(result.body.ok,true);
 let game=result.body.game;
 const act=async(actor,type,extra={})=>{
  const body={id:crypto.randomUUID(),revision:game.revision,type,...extra};
  result=await invoke('POST','/api/deal-or-no-deal/:code/action',actor,body);
  assert.equal(result.body.ok,true,JSON.stringify(result.body));
  game=result.body.game;
  for(const ws of [a,b]){
   const last=ws.sent.filter(m=>m.type==='deal-state').at(-1)?.game;
   assert.equal(last?.revision,game.revision);
   assert.equal(last?.phase,game.phase);
   assert.equal(Object.hasOwn(last,'values'),false);
  }
 };
 for(let i=0;i<2;i++)await act(game.order[i],'select',{case:i});
 for(let i=2;i<2+game.bankerSchedule[0];i++){
  const actor=game.order[game.turnIndex];
  await act(actor,'open',{case:i});
  await act(actor,'ack-reveal');
 }
 assert.equal(game.phase,'decision');
 const voters=game.history.at(-1).participants;
 for(const actor of voters)await act(actor,'decide',{deal:true});
 assert.equal(game.phase,'final');
 for(const uid of ['a','b']){
  const wallet=docs.get('deal_or_no_deal_wallets_v1/'+uid);
  assert.equal(wallet?.games,1);
  assert.ok(docs.has('deal_or_no_deal_payouts_v1/'+game.id+'_'+uid));
  const materials=docs.get('dog_material_inventory_v1/'+uid);
  assert.equal(materials?.unopened,1,'a finished Deal match gives one chest');
  assert.equal(materials?.earned,1);
 }
 const final=a.sent.filter(m=>m.type==='deal-state').at(-1).game;
 assert.equal(final.finalValues.length,2);
 a.close();b.close();
});

test('Three players share case selections and a simultaneous banker vote',async()=>{
 const {api,Socket,invoke,docs}=harness(['a','b','c']);
 const sockets=['a','b','c'].map(uid=>{const ws=new Socket();api.attachSocket(ws);ws.message({type:'subscribe',code:'123',token:uid});return ws});
 await flush();
 let res=await invoke('POST','/api/deal-or-no-deal/:code/start','a');
 assert.equal(res.body.ok,true);
 let game=res.body.game;
 const act=async(uid,type,extra={})=>{
  const response=await invoke('POST','/api/deal-or-no-deal/:code/action',uid,{id:crypto.randomUUID(),revision:game.revision,type,...extra});
  assert.equal(response.body.ok,true,JSON.stringify(response.body));
  game=response.body.game;
  for(const ws of sockets){
   const state=ws.sent.filter(m=>m.type==='deal-state').at(-1)?.game;
   assert.equal(state?.revision,game.revision);
   assert.equal(Object.hasOwn(state,'values'),false);
  }
 };
 for(let i=0;i<3;i++)await act(game.order[i],'select',{case:i});
 for(let i=3;i<3+game.bankerSchedule[0];i++){
  const actor=game.order[game.turnIndex];
  await act(actor,'open',{case:i});
  await act(actor,'ack-reveal');
 }
 assert.equal(game.phase,'decision');
 const voters=game.history.at(-1).participants;
 assert.equal(voters.length,3);
 for(const actor of voters)await act(actor,'decide',{deal:true});
 assert.equal(game.phase,'final');
 assert.equal(game.finalValues.length,3);
 // The first balance request settles the final match; repeated requests must not double-credit.
 const first=await invoke('GET','/api/deal-or-no-deal/:code/balances','a');
 assert.equal(first.body.ok,true,JSON.stringify(first.body));
 const balances=new Map(first.body.players.map(p=>[p.id,p]));
 for(const payout of game.finalValues){
  assert.equal(balances.get(payout.id)?.balance,payout.payout);
  assert.equal(balances.get(payout.id)?.games,1);
  assert.equal(docs.get('deal_or_no_deal_payouts_v1/'+game.id+'_'+payout.id)?.amount,payout.payout);
  const materials=docs.get('dog_material_inventory_v1/'+payout.id);
  assert.equal(materials?.unopened,1);
  assert.equal(materials?.earned,1);
 }
 const second=await invoke('GET','/api/deal-or-no-deal/:code/balances','b');
 assert.equal(second.body.ok,true);
 for(const p of second.body.players){
  assert.equal(p.balance,balances.get(p.id).balance);
  assert.equal(p.games,1);
  assert.equal(docs.get('dog_material_inventory_v1/'+p.id)?.earned,1,'repeated settlement must not grant a second chest');
 }
 for(const ws of sockets)ws.close();
});

test('Rejoining player gets latest state after missing a committed move',async()=>{
 const {api,Socket,invoke}=harness(['a','b','c']);
 const a=new Socket(),b=new Socket(),c=new Socket();
 for(const [ws,uid] of [[a,'a'],[b,'b'],[c,'c']]){api.attachSocket(ws);ws.message({type:'subscribe',code:'123',token:uid})}
 await flush();
 let response=await invoke('POST','/api/deal-or-no-deal/:code/start','a');
 assert.equal(response.body.ok,true);
 const game=response.body.game;
 b.close();
 response=await invoke('POST','/api/deal-or-no-deal/:code/action',game.order[0],{id:crypto.randomUUID(),revision:game.revision,type:'select',case:0});
 assert.equal(response.body.ok,true,JSON.stringify(response.body));
 assert.equal(a.sent.filter(m=>m.type==='deal-state').at(-1)?.game?.revision,1);
 assert.equal(c.sent.filter(m=>m.type==='deal-state').at(-1)?.game?.revision,1);
 const rejoined=new Socket();api.attachSocket(rejoined);
 rejoined.message({type:'subscribe',code:'123',token:'b'});
 await flush();
 assert.equal(rejoined.sent.filter(m=>m.type==='deal-state').at(-1)?.game?.revision,1);
 assert.equal(rejoined.sent.filter(m=>m.type==='deal-state').at(-1)?.game?.players.length,3);
 a.close();c.close();rejoined.close();
});

test('Subscribed sockets receive an authoritative clock sample without requiring game revision',async()=>{
 const {api,Socket}=harness();
 const ws=new Socket();api.attachSocket(ws);
 ws.message({type:'subscribe',code:'123',token:'a',clientSentAt:12345});
 await flush();
 const subscribed=ws.sent.find(m=>m.type==='deal-subscribed');
 assert.ok(subscribed);
 assert.equal(subscribed.clientSentAt,12345);
 assert.ok(Number.isSafeInteger(subscribed.serverNow));
 assert.ok(Math.abs(Date.now()-subscribed.serverNow)<10000);
 ws.message({type:'ping',clientSentAt:23456});
 await flush();
 const pong=ws.sent.find(m=>m.type==='pong');
 assert.ok(pong);
 assert.equal(pong.clientSentAt,23456);
 assert.ok(Number.isSafeInteger(pong.serverNow));
 ws.close();
});

test('Banker deal packs can be revealed and confirmed without spinning a wheel',async()=>{
 const {invoke,docs}=harness();
 const url='/api/deal-or-no-deal/:code';
 const started=await invoke('POST',url+'/start','a');
 assert.equal(started.statusCode,200);
 let game=started.body.game;
 const act=async(actor,type,extra={})=>{
  const response=await invoke('POST',url+'/action',actor,{id:crypto.randomUUID(),revision:game.revision,type,...extra});
  assert.equal(response.statusCode,200,JSON.stringify(response.body));
  game=response.body.game;
 };
 for(let i=0;i<2;i++)await act(game.order[i],'select',{case:i});
 for(let i=2;i<7;i++){
  const actor=game.order[game.turnIndex];
  await act(actor,'open',{case:i});
  await act(actor,'ack-reveal');
 }
 assert.equal(game.phase,'decision');
 // Fix the randomized banker pack for deterministic coverage.
 const stored=docs.get('deal_or_no_deal_matches_v1/123');
 stored.game.history.at(-1).bonusPack='small';
 const participants=game.history.at(-1).participants;
 for(const actor of participants)await act(actor,'decide',{deal:true});
 assert.equal(game.phase,'final');
 const rewardId=game.id+'_1_a';
 const savedPack=docs.get('deal_christmas_banker_rewards_v1/'+rewardId);
 assert.equal(savedPack?.packId,'small');
 assert.ok(savedPack?.revealed?.length>0);
 assert.equal(game.christmasWheelSpins?.['banker:'+rewardId],undefined);
 const before=game.revision;
 const viewer=await invoke('POST',url+'/christmas-wheel-continue','b',{kind:'banker',rewardId});
 assert.equal(viewer.statusCode,409);
 assert.equal(viewer.body.error,'WINNER_ONLY');
 const confirmed=await invoke('POST',url+'/christmas-wheel-continue','a',{kind:'banker',rewardId});
 assert.equal(confirmed.statusCode,200,JSON.stringify(confirmed.body));
 assert.ok(confirmed.body.closedAt>0);
 const after=docs.get('deal_or_no_deal_matches_v1/123').game;
 assert.equal(after.revision,before+1);
 assert.ok(after.christmasWheelClosed['banker:'+rewardId]);
 assert.equal(after.christmasWheelSpins?.['banker:'+rewardId],undefined);
 const again=await invoke('POST',url+'/christmas-wheel-continue','a',{kind:'banker',rewardId});
 assert.equal(again.statusCode,200);
 assert.equal(docs.get('deal_or_no_deal_matches_v1/123').game.revision,before+1);
 // Other reward types still require a server-confirmed wheel start.
 const fakeCentId=game.id+'_cent-test';
 docs.set('deal_christmas_cent_rewards_v1/'+fakeCentId,{uid:'a',gameId:game.id});
 const cent=await invoke('POST',url+'/christmas-wheel-continue','a',{kind:'cent',rewardId:fakeCentId});
 assert.equal(cent.statusCode,409);
 assert.equal(cent.body.error,'WHEEL_NOT_STARTED');
});

test('Nordpol Bingo milestones 22–30 credit packs, hammers, jokers and monster ticket exactly once',async()=>{
 const {invoke,docs}=harness(['a']);
 const base='deal_or_no_deal_christmas_v1/a';
 const cards=Object.fromEntries(Array.from({length:32},(_,i)=>['christmas-'+String(i+1).padStart(2,'0'),1]));
 // 20 original Bingos plus two complete Nordpol rows = 22.
 for(let i=65;i<=72;i++)cards['christmas-'+i]=1;
 docs.set(base,{cards,opened:0,monsterWheelTickets:0});
 const claim=()=>invoke('POST','/api/deal-or-no-deal/christmas/north-pole/claim','a',{});
 const first=await claim();
 assert.equal(first.statusCode,200,JSON.stringify(first.body));
 assert.deepEqual(first.body.claimed.map(x=>x.at),[22]);
 assert.equal(first.body.packs.length,0,'Bingo 22 now saves two Premium vouchers for later shop opening');
 assert.equal(first.body.freePacks.premium,2);
 assert.equal(docs.get(base).freeChristmasPacks.premium,2);
 assert.equal(docs.get(base).opened,0,'no cards drawn until user opens a free package');
 assert.equal(docs.get(base).northPoleMilestonesClaimed['north-premium-2']>0,true);
 const second=await claim();
 assert.equal(second.statusCode,200);
 assert.equal(second.body.claimed.length,0);
 assert.equal(docs.get(base).opened,0);
 // Existing Nordpol cards now complete the entire third board, yielding 30.
 const progressed=docs.get(base);
 for(let i=65;i<=80;i++)progressed.cards['christmas-'+i]=1;
 docs.set(base,progressed);
 const third=await claim();
 assert.equal(third.statusCode,200,JSON.stringify(third.body));
 assert.deepEqual(third.body.claimed.map(x=>x.at),[24,26,28,30]);
 assert.equal(third.body.packs.length,1);
 assert.equal(third.body.packs[0].packId,'platinum');
 assert.equal(third.body.packs[0].revealed.length,16);
 assert.equal(third.body.packs[0].revealed.filter(x=>x.rarity==='legendary').length>=1,true);
 assert.equal(third.body.goldHammers,3);
 assert.equal(third.body.jokers,3);
 assert.equal(third.body.monsterTickets,1);
 assert.equal(docs.get('christmas_ice_progress_v1/a').freeHammers.lucky,3);
 assert.equal(docs.get('christmas_ice_progress_v1/a').wheelHammers.lucky,3);
 assert.equal(docs.get('deal_peek_inventory_v1/a').balance,3);
 assert.equal(docs.get(base).monsterWheelTickets,1);
 assert.equal(docs.get(base).opened,1,'only the platinum combo opens cards immediately');
 assert.equal(docs.get(base).freeChristmasPacks.premium,2);
 const fourth=await claim();
 assert.equal(fourth.body.claimed.length,0);
 assert.equal(docs.get(base).monsterWheelTickets,1);
 assert.equal(docs.get('deal_peek_inventory_v1/a').balance,3);
 assert.equal(docs.get('christmas_ice_progress_v1/a').freeHammers.lucky,3);
});
test('Unauthenticated heartbeat does not receive a pong',async()=>{
 const {api,Socket}=harness();
 const ws=new Socket();api.attachSocket(ws);
 ws.message({type:'ping'});
 await flush();
 assert.equal(ws.sent.length,0);
 ws.close();
});

test('Closed subscription receives no later game broadcasts',async()=>{
 const {api,Socket,invoke}=harness();
 const departed=new Socket(),active=new Socket();
 api.attachSocket(departed);api.attachSocket(active);
 departed.message({type:'subscribe',code:'123',token:'a'});
 active.message({type:'subscribe',code:'123',token:'b'});
 await flush();
 const prior=departed.sent.length;
 departed.close();
 const started=await invoke('POST','/api/deal-or-no-deal/:code/start','a');
 assert.equal(started.body.ok,true);
 assert.equal(departed.sent.length,prior);
 assert.ok(active.sent.some(m=>m.type==='deal-state'&&m.game?.id===started.body.game.id));
 active.close();
});


test('30-case 50-million jackpot survives multiplayer protocol, final settlement and host replay',async()=>{
 const {api,Socket,invoke,docs}=harness(['a']);
 const root='/api/deal-or-no-deal/:code';
 const ws=new Socket();
 api.attachSocket(ws);
 ws.message({type:'subscribe',code:'123',token:'a'});
 await flush();
 let response=await invoke('POST',root+'/start','a',{caseCount:30});
 assert.equal(response.statusCode,200,JSON.stringify(response.body));
 let game=response.body.game;
 assert.equal(game.caseCount,30);
 assert.ok(Number.isInteger(game.bankerScheduleVariant)&&game.bankerScheduleVariant>=1&&game.bankerScheduleVariant<=2);
 const midCalls=BANKER_30_OPENINGS[game.bankerScheduleVariant-1]
  .slice(1,-3).map(target=>Math.round(3+(target-9)*(27-3)/16));
 const targets=[3,...midCalls,27,28,29];
 assert.deepEqual(game.bankerSchedule,targets.map((n,i)=>n-(targets[i-1]||0)),
  'two Banker variants make 7 or 8 calls and end on the last three openable cases');
 assert.equal(targets.length,game.bankerScheduleVariant===1?7:8);
 assert.equal(game.values,undefined,'private case amounts never enter multiplayer updates');
 const stored=docs.get('deal_or_no_deal_matches_v1/123').game;
 assert.equal(stored.values.length,30);
 const jackpotIndex=stored.values.indexOf(5000000000);
 assert.ok(jackpotIndex>=0&&jackpotIndex<30);
 const take=async(type,extra={})=>{
  response=await invoke('POST',root+'/action','a',{
   type,...extra,id:crypto.randomUUID(),revision:game.revision
  });
  assert.equal(response.statusCode,200,JSON.stringify(response.body));
  game=response.body.game;
  assert.equal(game.caseCount,30);
  assert.equal(game.values,undefined,'never reveal hidden jackpot values through the API');
  const latest=ws.sent.filter(m=>m.type==='deal-state').at(-1)?.game;
  assert.equal(latest?.caseCount,30);
  assert.equal(latest?.revision,game.revision);
 };
 await take('select',{case:jackpotIndex});
 assert.equal(game.players[0].case,jackpotIndex);
 let guard=0;
 while(game.phase!=='final'&&guard++<150){
  if(game.phase==='batch-reveal'){
   docs.get('deal_or_no_deal_matches_v1/123').game.openingBatch.endsAt=Date.now()-1;
   await take('ack-batch');
  }else if(game.phase==='batch-pick'||game.phase==='open'){
   const opened=new Set([...game.opened,...(game.openingBatch?.picks||[]).map(p=>p.case)]);
   const next=Array.from({length:30},(_,i)=>i)
    .find(i=>i!==jackpotIndex&&!opened.has(i));
   assert.ok(Number.isInteger(next));
   await take('open',{case:next});
  }else if(game.phase==='reveal'){
   await take('ack-reveal');
  }else if(game.phase==='decision'){
   await take('decide',{deal:false});
  }else assert.fail('Unexpected game phase '+game.phase);
 }
 assert.equal(game.phase,'final');
 assert.equal(game.opened.length,29);
 assert.equal(game.finalValues[0].amount,5000000000);
 assert.equal(game.finalValues[0].payout,5000000000);
 const wallets=await invoke('GET',root+'/balances','a');
 assert.equal(wallets.statusCode,200,JSON.stringify(wallets.body));
 assert.equal(wallets.body.players[0].balance,5000000000,'€50m credited once');
 const secondWallet=await invoke('GET',root+'/balances','a');
 assert.equal(secondWallet.body.players[0].balance,5000000000,'no duplicate settlement');
 // A new match cannot begin until the shared Slot finale has been confirmed.
 const blocked=await invoke('POST',root+'/start','a',{skipFinalWheel:true,caseCount:30});
 assert.equal(blocked.statusCode,409);
 assert.equal(blocked.body.error,'SLOT_SHOW_PENDING');
 const slotSpin=await invoke('POST',root+'/monster-slots/show','a',{gameId:game.id,operation:'spin'});
 assert.equal(slotSpin.statusCode,200,JSON.stringify(slotSpin.body));
 assert.equal(slotSpin.body.game.monsterSlotShow.phase,'rolling');
 docs.get('deal_or_no_deal_matches_v1/123').game.monsterSlotShow.startedAt=Date.now()-10000;
 const slotConfirmed=await invoke('POST',root+'/monster-slots/show','a',{gameId:game.id,operation:'confirm'});
 assert.equal(slotConfirmed.statusCode,200,JSON.stringify(slotConfirmed.body));
 assert.equal(slotConfirmed.body.game.monsterSlotShow.phase,'ceremony');
 const replay=await invoke('POST',root+'/start','a',{skipFinalWheel:true,caseCount:30});
 assert.equal(replay.statusCode,200,JSON.stringify(replay.body));
 assert.equal(replay.body.game.caseCount,30);
 assert.equal(replay.body.game.phase,'select');
 assert.equal(docs.get('deal_or_no_deal_matches_v1/123').game.values.length,30);
 const awarded=docs.get('deal_monster_slots_receipts_v1/'+game.id+'_a');
 assert.ok(awarded,'restarting the room settles the champion\'s three slots exactly once');
 assert.equal(awarded.result.prizes.length,3);
 const extraCash=awarded.result.prizes.filter(p=>p.kind==='cash')
  .reduce((sum,p)=>sum+p.amountCents,0);
 assert.equal(docs.get('deal_or_no_deal_wallets_v1/a').balance,5000000000+extraCash,
  'the original €50m prize remains intact; additional Slot money is credited separately');
 ws.close();
});


test('30-case nine-case reveal still credits the one-cent Christmas pack to its opener only once',async()=>{
 const {invoke,docs}=harness(['a','b','c']),root='/api/deal-or-no-deal/:code';
 let r=await invoke('POST',root+'/start','a',{caseCount:30});
 assert.equal(r.statusCode,200,JSON.stringify(r.body));
 let game=r.body.game;
 const stored=docs.get('deal_or_no_deal_matches_v1/123').game;
 const oneCent=stored.values.indexOf(1);
 assert.ok(oneCent>=0);
 const protectedCases=Array.from({length:30},(_,i)=>i).filter(i=>i!==oneCent).slice(0,3);
 const act=async(uid,type,extra={})=>{
  const res=await invoke('POST',root+'/action',uid,{id:crypto.randomUUID(),revision:game.revision,type,...extra});
  assert.equal(res.statusCode,200,JSON.stringify(res.body));
  game=res.body.game;
 };
 for(let i=0;i<3;i++)await act(game.order[i],'select',{case:protectedCases[i]});
 assert.equal(game.phase,'batch-pick');
 const owner=game.order[0];
 const queue=[oneCent,...Array.from({length:30},(_,i)=>i).filter(i=>i!==oneCent&&!protectedCases.includes(i)).slice(0,8)];
 for(let i=0;i<9;i++)await act(game.order[Math.floor(i/3)],'open',{case:queue[i]});
 assert.equal(game.phase,'batch-reveal');
 assert.equal(game.openedAmounts.length,0);
 stored.openingBatch=docs.get('deal_or_no_deal_matches_v1/123').game.openingBatch;
 stored.openingBatch.endsAt=Date.now()-1;
 // A different player may complete the shared reveal; the reward goes to the opener.
 await act(game.order[2],'ack-batch');
 assert.equal(game.phase,'decision');
 const cent=game.events.find(e=>e.type==='opened'&&e.amount===1);
 assert.equal(cent.playerId,owner);
 const reward=docs.get('deal_christmas_cent_rewards_v1/'+game.id+'_'+cent.eventId);
 assert.equal(reward?.uid,owner);
 assert.ok(reward?.revealed?.length>0);
 assert.equal(docs.get('deal_or_no_deal_christmas_v1/'+owner)?.opened,1);
 const repeat=await invoke('POST',root+'/action',game.order[2],{id:crypto.randomUUID(),revision:game.revision,type:'ack-batch'});
 assert.equal(repeat.statusCode,409);
 assert.equal(docs.get('deal_or_no_deal_christmas_v1/'+owner)?.opened,1,'reward can never repeat');
});


test('Monster-wheel Giftzwerg unlock survives character selection and reaches every game spectator',async()=>{
 const {api,Socket,invoke,docs}=harness(['a','b']);
 const base='/api/deal-or-no-deal/:code';
 // Only players who actually won the avatar are allowed to choose it.
 const locked=await invoke('POST',base+'/avatar','a',{avatar:15});
 assert.notEqual(locked.statusCode,200,'still locked before the real Monster-wheel prize');
 docs.set('deal_or_no_deal_christmas_v1/a',{monsterGiftzwergUnlocked:true});
 const chosen=await invoke('POST',base+'/avatar','a',{avatar:15});
 assert.equal(chosen.statusCode,200,JSON.stringify(chosen.body));
 assert.equal(chosen.body.avatar,15);
 assert.equal(chosen.body.avatars.a,15);
 const viewer=new Socket();
 api.attachSocket(viewer);
 viewer.message({type:'subscribe',code:'123',token:'b'});
 await flush();
 const start=await invoke('POST',base+'/start','a',{caseCount:30});
 assert.equal(start.statusCode,200,JSON.stringify(start.body));
 assert.equal(start.body.game.players.find(p=>p.id==='a')?.avatar,15,
  'the Giftzwerg ID must not be dropped after the selection-to-match transition');
 assert.equal(docs.get('deal_or_no_deal_matches_v1/123').game.players.find(p=>p.id==='a')?.avatar,15);
 assert.equal(viewer.sent.filter(x=>x.type==='deal-state').at(-1)?.game.players.find(p=>p.id==='a')?.avatar,15,
  'all spectator clients must receive the Giftzwerg ID for portrait and comments');
 viewer.close();
});


test('Shared Banker card prize freezes the room, broadcasts both owners and releases after each confirmation',async()=>{
 const {api,Socket,invoke,docs}=harness(['a','b']);
 const root='/api/deal-or-no-deal/:code';
 const spectators=['a','b'].map(uid=>{
  const ws=new Socket();api.attachSocket(ws);ws.message({type:'subscribe',code:'123',token:uid});return ws;
 });
 await flush();
 let result=await invoke('POST',root+'/start','a');
 assert.equal(result.statusCode,200,JSON.stringify(result.body));
 let game=result.body.game;
 const act=async(actor,type,extra={})=>{
  const response=await invoke('POST',root+'/action',actor,{id:crypto.randomUUID(),revision:game.revision,type,...extra});
  assert.equal(response.statusCode,200,JSON.stringify(response.body));
  game=response.body.game;
 };
 for(let i=0;i<2;i++)await act(game.order[i],'select',{case:i});
 for(let i=2;i<2+game.bankerSchedule[0];i++){
  const actor=game.order[game.turnIndex];
  await act(actor,'open',{case:i});
  await act(actor,'ack-reveal');
 }
 assert.equal(game.phase,'decision');
 docs.get('deal_or_no_deal_matches_v1/123').game.history.at(-1).bonusPack='small';
 for(const actor of game.history.at(-1).participants)await act(actor,'decide',{deal:true});
 assert.equal(game.phase,'final');
 assert.deepEqual(game.pendingCardReveals.map(x=>x.uid),game.history.at(-1).decisions.map(x=>x.id));
 const [first,second]=game.pendingCardReveals;
 assert.equal(first.kind,'banker');
 assert.equal(second.kind,'banker');
 for(const ws of spectators){
  const state=ws.sent.filter(m=>m.type==='deal-state').at(-1)?.game;
  assert.deepEqual(state.pendingCardReveals,game.pendingCardReveals);
  assert.equal(state.values,undefined);
 }
 const visible=await invoke('GET',root+'/christmas-banker-rewards','b');
 assert.equal(visible.statusCode,200,JSON.stringify(visible.body));
 assert.equal(visible.body.rewards.length,2);
 assert.ok(visible.body.rewards.every(x=>x.revealed.length>0));
 const move=await invoke('POST',root+'/action','b',{type:'open',case:12,revision:game.revision,id:crypto.randomUUID()});
 assert.equal(move.body.error,'CARD_REVEAL_PENDING');
 const replay=await invoke('POST',root+'/start','a',{skipFinalWheel:true});
 assert.equal(replay.body.error,'CARD_REVEAL_PENDING');
 const slots=await invoke('POST',root+'/monster-slots/show','a',{gameId:game.id,operation:'spin'});
 assert.equal(slots.body.error,'CARD_REVEAL_PENDING');
 const viewer=await invoke('POST',root+'/christmas-wheel-continue',second.uid,{kind:second.kind,rewardId:first.rewardId});
 assert.equal(viewer.body.error,'WINNER_ONLY');
 const early=await invoke('POST',root+'/christmas-wheel-continue',second.uid,{kind:second.kind,rewardId:second.rewardId});
 assert.equal(early.body.error,'CARD_REVEAL_OUT_OF_ORDER');
 const confirmed=await invoke('POST',root+'/christmas-wheel-continue',first.uid,{kind:first.kind,rewardId:first.rewardId});
 assert.equal(confirmed.statusCode,200,JSON.stringify(confirmed.body));
 assert.deepEqual(docs.get('deal_or_no_deal_matches_v1/123').game.pendingCardReveals,[second]);
 const next=await invoke('POST',root+'/christmas-wheel-continue',second.uid,{kind:second.kind,rewardId:second.rewardId});
 assert.equal(next.statusCode,200,JSON.stringify(next.body));
 assert.deepEqual(docs.get('deal_or_no_deal_matches_v1/123').game.pendingCardReveals,[]);
 spectators.forEach(ws=>ws.close());
});
