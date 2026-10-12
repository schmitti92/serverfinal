import test from 'node:test';
import assert from 'node:assert/strict';
import { installSharedLobby } from '../shared-lobby.js';

function harness(){
 const docs=new Map(),routes=[],middles=[];
 const store={
  collection:name=>({doc:code=>({path:name+'/'+code,get:async()=>snapshot(docs.get(name+'/'+code))})}),
  pending:Promise.resolve(),
  runTransaction(fn){
   const task=this.pending.catch(()=>{}).then(async()=>{
    const ops=[];
    const tx={get:async ref=>snapshot(docs.get(ref.path)),set:(ref,value)=>ops.push(()=>docs.set(ref.path,structuredClone(value))),delete:ref=>ops.push(()=>docs.delete(ref.path))};
    const result=await fn(tx);ops.forEach(o=>o());return result;
   });this.pending=task.catch(()=>{});return task;
  },
 };
 function snapshot(value){return {exists:!!value,data:()=>structuredClone(value)};}
 const app={get(path,fn){routes.push({method:'GET',path,fn});},post(path,fn){routes.push({method:'POST',path,fn});},use(path,fn){middles.push({path,fn});}};
 const identities={alice:{uid:'user_alice123',name:'Alice'},bob:{uid:'user_bobby123',name:'Bob'},cara:{uid:'user_carol123',name:'Cara'}};
 let id=0,now=1000;
 installSharedLobby(app,{verifyProfile:async token=>identities[token]||null,getFirestore:()=>store,clock:()=>now,codeGenerator:()=>`ABC23${['D','E','F'][id++%3]}`});
 async function api(method,path,user='alice',body){
  const route=routes.find(r=>r.method===method&&matches(r.path,path));if(!route)throw Error('NO_ROUTE '+method+' '+path);
  const params=Object.fromEntries(route.path.split('/').filter(x=>x.startsWith(':')).map((x,i)=>[x.slice(1),path.split('/')[route.path.split('/').indexOf(x)]]));
  const req={body:body||{},params,get:header=>header==='authorization'?`Bearer ${user}`:''};
  const res={statusCode:200,status(n){this.statusCode=n;return this;},json(data){this.jsonBody=data;return this;}};
  const auth=middles.find(x=>path===x.path||path.startsWith(x.path+'/'));
  if(auth){let downstream;await auth.fn(req,res,()=>{downstream=route.fn(req,res);});if(downstream)await downstream;}else await route.fn(req,res);
  return {status:res.statusCode,...res.jsonBody};
 }
 const matches=(pattern,path)=>pattern.split('/').length===path.split('/').length && pattern.split('/').every((p,i)=>p.startsWith(':')||p===path.split('/')[i]);
 return {api,store,docs,identities,advance:ms=>now+=ms};
}

test('Room create, verified membership, host powers and ready reset',async()=>{
 const h=harness(),created=await h.api('POST','/api/hub/rooms');
 assert.equal(created.status,200);const code=created.room.code;assert.equal(code,'ABC23D');assert.equal(created.room.host,true);
 assert.equal((await h.api('GET',`/api/hub/rooms/${code}`,'bob')).status,403);
 const joined=await h.api('POST',`/api/hub/rooms/${code}/join`,'bob');assert.equal(joined.room.players.length,2);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/select`,'bob',{game:'skyjo'})).status,403);
 const selected=await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'skyjo'});assert.equal(selected.room.game,'skyjo');
 await h.api('POST',`/api/hub/rooms/${code}/ready`,'alice',{ready:true});
 const ready=await h.api('POST',`/api/hub/rooms/${code}/ready`,'bob',{ready:true});
 assert.equal(ready.room.allReady,true);assert.equal(ready.room.canLaunch,false);
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/start`,'alice')).status,409);
 const reselection=await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'barikade'});
 assert.deepEqual(reselection.room.players.map(p=>p.ready),[false,false]);
 const leave=await h.api('POST',`/api/hub/rooms/${code}/leave`,'alice');assert.equal(leave.left,true);
 const host=await h.api('GET',`/api/hub/rooms/${code}`,'bob');assert.equal(host.room.host,true);
 const final=await h.api('POST',`/api/hub/rooms/${code}/leave`,'bob');assert.equal(final.roomDeleted,true);
 assert.equal((await h.api('GET',`/api/hub/rooms/${code}`,'bob')).status,404);
});
test('Strict authentication and no accounts can modify other rooms',async()=>{
 const h=harness();assert.equal((await h.api('POST','/api/hub/rooms','stranger')).status,401);
 const {room}=await h.api('POST','/api/hub/rooms');
 assert.equal((await h.api('POST',`/api/hub/rooms/${room.code}/ready`,'bob',{ready:true})).status,403);
 assert.equal((await h.api('POST',`/api/hub/rooms/${room.code}/select`,'alice',{game:'nope'})).status,400);
});
test('Concurrent joins do not duplicate a seat or overbook game capacity',async()=>{
 const h=harness();const {room}=await h.api('POST','/api/hub/rooms');
 const code=room.code;
 await h.api('POST',`/api/hub/rooms/${code}/select`,'alice',{game:'skyjo'});
 const [a,b,c]=await Promise.all([
  h.api('POST',`/api/hub/rooms/${code}/join`,'bob'),
  h.api('POST',`/api/hub/rooms/${code}/join`,'bob'),
  h.api('POST',`/api/hub/rooms/${code}/join`,'cara')
 ]);
 assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(c.status,200);
 assert.equal((await h.api('GET',`/api/hub/rooms/${code}`)).room.players.length,3);
 h.identities.dave={uid:'user_david123',name:'Dave'};
 assert.equal((await h.api('POST',`/api/hub/rooms/${code}/join`,'dave')).status,409);
});
test('Room expires and duplicate creation codes are retried',async()=>{
 const h=harness();const one=await h.api('POST','/api/hub/rooms');const two=await h.api('POST','/api/hub/rooms');
 assert.notEqual(one.room.code,two.room.code);
 h.advance(25*3600*1000);
 assert.equal((await h.api('GET',`/api/hub/rooms/${one.room.code}`)).status,404);
});