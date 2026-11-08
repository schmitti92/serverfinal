import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installDealOrNoDeal} from '../deal-or-no-deal-api.js';

const flush=()=>new Promise(resolve=>setTimeout(resolve,20));
function harness(){
 const routes=new Map(),docs=new Map();
 docs.set('spielesammlung_hub_v1/123',{hostUid:'a',revision:1,players:[{uid:'a',name:'A'},{uid:'b',name:'B'}]});
 const app={get:(path,...fns)=>routes.set('GET '+path,fns),post:(path,...fns)=>routes.set('POST '+path,fns)};
 const db={collection:name=>({doc:id=>({
  get:async()=>({exists:docs.has(name+'/'+id),data:()=>docs.get(name+'/'+id)}),
  set:async data=>docs.set(name+'/'+id,data)
 })}),runTransaction:async fn=>{
  const pending=[];
  const tx={get:async ref=>ref.get(),set:(ref,data)=>pending.push(()=>ref.set(data)),update:(ref,data)=>pending.push(async()=>ref.set({...((await ref.get()).data()||{}),...data})),create:(ref,data)=>pending.push(()=>ref.set(data))};
  const result=await fn(tx);for(const write of pending)await write();return result;
 }};
 const api=installDealOrNoDeal(app,{verifyProfile:async token=>['a','b'].includes(token)?{uid:token}:null,getFirestore:()=>db});
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
 return {api,Socket,invoke};
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
