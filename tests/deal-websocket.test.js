import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import crypto from 'node:crypto';
import {installDealOrNoDeal} from '../deal-or-no-deal-api.js';

const flush=()=>new Promise(resolve=>setTimeout(resolve,20));
function harness(participants=['a','b']){
 const routes=new Map(),docs=new Map();
 docs.set('spielesammlung_hub_v1/123',{hostUid:'a',revision:1,players:participants.map(uid=>({uid,name:uid.toUpperCase()}))});
 const app={get:(path,...fns)=>routes.set('GET '+path,fns),post:(path,...fns)=>routes.set('POST '+path,fns)};
 const db={collection:name=>({doc:id=>({
  get:async()=>({exists:docs.has(name+'/'+id),data:()=>docs.get(name+'/'+id)}),
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
 return {api,Socket,invoke,docs};
}
test('Deal socket rejects users who are not room members',async()=>{
 const {api,Socket}=harness();const ws=new Socket();api.attachSocket(ws);
 ws.message({type:'subscribe',code:'123',token:'stranger'});await flush();
 assert.ok(ws.sent.some(m=>m.type==='deal-error'));
 assert.equal(ws.readyState,3);
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
 for(let i=2;i<7;i++){
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
 for(let i=3;i<8;i++){
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
 assert.deepEqual(game.bankerSchedule,[6,5,5,4,3,3,2,1]);
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
  if(game.phase==='open'){
   const opened=new Set(game.opened);
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
 const replay=await invoke('POST',root+'/start','a',{skipFinalWheel:true,caseCount:30});
 assert.equal(replay.statusCode,200,JSON.stringify(replay.body));
 assert.equal(replay.body.game.caseCount,30);
 assert.equal(replay.body.game.phase,'select');
 assert.equal(docs.get('deal_or_no_deal_matches_v1/123').game.values.length,30);
 assert.equal(docs.get('deal_or_no_deal_wallets_v1/a').balance,5000000000);
 ws.close();
});
