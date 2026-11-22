import test from 'node:test';
import assert from 'node:assert/strict';
import { installSharedLobby } from '../shared-lobby.js';

function harness(options={}){
 let finished=false,skyjoBootstraps=0,watchStarts=0,watchStops=0;
 let adapter;
 const docs=new Map(),routes=[],middles=[],listeners=new Map();
 const store={
  collection:name=>({doc:code=>({path:name+'/'+code,get:async()=>snapshot(docs.get(name+'/'+code)),
     set:async value=>{docs.set(name+'/'+code,structuredClone(value));},
    onSnapshot(cb,_onError){
     watchStarts++;
     const key=name+'/'+code;const set=listeners.get(key)||new Set();set.add(cb);listeners.set(key,set);
     queueMicrotask(()=>{if(set.has(cb))cb(snapshot(docs.get(key)));});
     return ()=>{watchStops++;set.delete(cb);};
    }
   })}),
  pending:Promise.resolve(),
  runTransaction(fn){
   const task=this.pending.catch(()=>{}).then(async()=>{
    const ops=[];
    const tx={get:async ref=>snapshot(docs.get(ref.path)),set:(ref,value)=>ops.push(()=>docs.set(ref.path,structuredClone(value))),delete:ref=>ops.push(()=>docs.delete(ref.path))};
    const result=await fn(tx);ops.forEach(o=>o());
   for(const [key,set] of listeners)for(const cb of set)queueMicrotask(()=>cb(snapshot(docs.get(key))));
   return result;
   });this.pending=task.catch(()=>{});return task;
  },
 };
 function snapshot(value){return {exists:!!value,data:()=>structuredClone(value)};}
 // Real Express routes may use multiple handlers (authentication, response).
 // Run the complete chain for scratch endpoints rather than invoking auth
 // alone and mistakenly treating next() as missing.
 const chain=handlers=>async(req,res)=>{
  const call=async i=>{
   if(i>=handlers.length)return;
   let downstream;
   await handlers[i](req,res,()=>{downstream=call(i+1)});
   if(downstream)await downstream;
  };
  return call(0);
 };
 const routeFn=(path,handlers)=>path.startsWith('/api/hub/scratch')||path.startsWith('/api/hub/dog/video-library')||path.startsWith('/api/hub/dog/christmas-tab-badges')?
  chain(handlers):handlers[0];
 const app={
  get(path,...handlers){routes.push({method:'GET',path,fn:routeFn(path,handlers)});},
  post(path,...handlers){routes.push({method:'POST',path,fn:routeFn(path,handlers)});},
  use(path,fn){middles.push({path,fn});}
 };
 const identities={alice:{uid:'user_alice123',name:'Alice'},bob:{uid:'user_bobby123',name:'Bob'},cara:{uid:'user_carol123',name:'Cara'},dana:{uid:'user_dana123',name:'Dana'}};
 let id=0,now=1000;
 adapter=installSharedLobby(app,{verifyProfile:options.verifyProfile|| (async token=>identities[token]||null),getFirestore:()=>store,clock:()=>now,codeGenerator:()=>`ABC23${['D','E','F'][id++%3]}`,isMatchFinished:async()=>finished,challengeRandomInt:options.challengeRandomInt,christmasEventActive:options.christmasEventActive,bootstrapSkyjo:async seat=>{skyjoBootstraps++;return {ok:true,rev:1,state:{kind:'skyjo-room-v2',version:2,lobby:{players:seat.members.map(p=>({id:'hub_'+p.uid,name:p.name})),hostId:'hub_'+seat.hostUid,settings:seat.settings,status:'lobby'},game:null}};}});
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
 return {api,store,docs,identities,advance:ms=>now+=ms,adapter,watchStats:()=>({starts:watchStarts,stops:watchStops}),setFinished(value){finished=value;},bootstraps:()=>skyjoBootstraps};
}

test('one private readonly Christmas tab-badge endpoint counts current personal rewards',async()=>{
 const h=harness();
 h.docs.set('dog_player_statistics_v1/user_alice123',{xp:3000,played:11});
 h.docs.set('dog_christmas_research_v1/user_alice123',{levels:{card_swap:1}});
 h.docs.set('dog_christmas_scratch_wallet_v1/user_alice123',{
  vouchers:{simple:2,medium:1,premium:0},
  variantVouchers:{gifts:3},
  levelRewardClaims:{1:1000,2:1200}
 });
 const before=structuredClone([...h.docs]);
 const result=await h.api('GET','/api/hub/dog/christmas-tab-badges','alice');
 assert.equal(result.status,200);
 assert.equal(result.badges.scratch,6);
 assert.ok(result.badges.research>=0);
 assert.ok(result.badges.level>=0);
 assert.equal(result.scope,'authenticated-personal-dog-christmas-menu');
 assert.deepEqual([...h.docs],before,'opening the tab menu never writes a document');
 assert.equal(h.watchStats().starts,0,'no new room listener');
 const bob=await h.api('GET','/api/hub/dog/christmas-tab-badges','bob');
 assert.equal(bob.status,200);
 assert.equal(bob.badges.scratch,0,'personal voucher balance cannot be borrowed');
 assert.equal((await h.api('GET','/api/hub/dog/christmas-tab-badges','stranger')).status,401);
});

test('menu summary does not depend on opening a DOG room or a Christmas village',async()=>{
 const h=harness();
 const result=await h.api('GET','/api/hub/dog/christmas-tab-badges','alice');
 assert.equal(result.status,200);
 assert.equal(result.badges.scratch,0);
 assert.equal(result.badges.research,0);
 assert.equal(result.badges.level,1);
 assert.equal(h.watchStats().starts,0);
});
