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
  const res={statusCode:200,status(code){this.statusCode=code;return this},json(value){this.body=value;return this}};
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
 }
 const second=await invoke('GET','/api/deal-or-no-deal/:code/balances','b');
 assert.equal(second.body.ok,true);
 for(const p of second.body.players){
  assert.equal(p.balance,balances.get(p.id).balance);
  assert.equal(p.games,1);
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
