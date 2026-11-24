import test from 'node:test';
import assert from 'node:assert/strict';
import {installSharedLobby} from '../shared-lobby.js';
import {mission3LegalMoves,mission3SetPreviewStage,mission3Validate} from '../dog/grinch-mission3.js';

const clone=value=>value===undefined?undefined:structuredClone(value);
function makeHarness({grinchOnlineEnabled=true,grinchMission3Enabled=true}={}){
 const docs=new Map(),routes=[],middleware=[];
 const people={alice:{uid:'alice-uid',name:'Alice'},bob:{uid:'bob-uid',name:'Bob'},cara:{uid:'cara-uid',name:'Cara'},outsider:{uid:'outside-uid',name:'Outsider'}};
 const snapshot=data=>({exists:data!==undefined,data:()=>clone(data)});
 let pending=Promise.resolve();
 const store={
  collection:name=>({doc:id=>({path:name+'/'+id,get:async()=>snapshot(docs.get(name+'/'+id))})}),
  runTransaction(fn){
   const work=pending.then(async()=>{
    const staged=[];
    const tx={
     get:async ref=>snapshot(docs.get(ref.path)),
     set:(ref,v)=>staged.push(()=>docs.set(ref.path,clone(v))),
     update:(ref,v)=>staged.push(()=>docs.set(ref.path,{...docs.get(ref.path),...clone(v)})),
     delete:ref=>staged.push(()=>docs.delete(ref.path))
    };
    const result=await fn(tx);staged.forEach(op=>op());return result;
   });
   pending=work.catch(()=>{});return work;
  }
 };
 const app={
  get:(path,...handlers)=>routes.push({method:'GET',path,handlers}),
  post:(path,...handlers)=>routes.push({method:'POST',path,handlers}),
  use:(path,handler)=>middleware.push({path,handler})
 };
 installSharedLobby(app,{verifyProfile:async token=>people[token]||null,
  getFirestore:()=>store,clock:()=>1700000000000,codeGenerator:()=> '123',grinchOnlineEnabled,grinchMission3Enabled});
 function routeMatches(template,path){
  const a=template.split('/'),b=path.split('/');
  return a.length===b.length&&a.every((p,i)=>p.startsWith(':')||p===b[i]);
 }
 async function call(method,path,user='alice',body={}){
  const route=routes.find(r=>r.method===method&&routeMatches(r.path,path));
  assert.ok(route,'Route exists: '+method+' '+path);
  const routeParts=route.path.split('/'),actualParts=path.split('/');
  const params=Object.fromEntries(routeParts.filter(p=>p.startsWith(':')).map(p=>[p.slice(1),actualParts[routeParts.indexOf(p)]]));
  const req={params,body,get:key=>key==='authorization'?'Bearer '+user:''};
  const res={statusCode:200,status(code){this.statusCode=code;return this;},json(data){this.body=data;return this;}};
  const chain=[...middleware.filter(m=>path===m.path||path.startsWith(m.path+'/')).map(m=>m.handler),...route.handlers];
  async function dispatch(index=0){
   const handler=chain[index];if(!handler)return;
   let downstream;
   await handler(req,res,()=>{downstream=dispatch(index+1);});
   if(downstream)await downstream;
  }
  await dispatch();
  return {status:res.statusCode,...res.body};
 }
 return {docs,people,call};
}

const village={levels:{tower:5,workshop:5,bakery:5,inn:5,luckhouse:5,academy:5}};
const route='/api/hub/rooms/123/grinch';
async function three(h){
 const created=await h.call('POST','/api/hub/rooms');
 assert.equal(created.status,200);
 await h.call('POST','/api/hub/rooms/123/join','bob');
 await h.call('POST','/api/hub/rooms/123/join','cara');
 h.docs.set('dog_christmas_villages_v1/lichtertal_2026_shared',village);
}

function grant(h){
 for(const p of Object.values(h.people).filter(p=>p.uid!=='outside-uid'))
  h.docs.set('dog_grinch_campaign_v1/'+p.uid,{uid:p.uid,completedMissions:[1,2],highestUnlocked:3});
}
test('mission 3 gate, host, and all three prerequisite completions',async()=>{
 const locked=makeHarness({grinchMission3Enabled:false});await three(locked);grant(locked);
 assert.equal((await locked.call('POST',route+'/launch3')).status,403);
 assert.equal((await locked.call('POST',route+'/action3')).status,403);
 const h=makeHarness();await three(h);
 assert.equal((await h.call('POST',route+'/launch3','bob')).status,403);
 assert.equal((await h.call('POST',route+'/launch3')).error,'GRINCH_MISSION2_REQUIRED_FOR_ALL_PLAYERS');
 grant(h);
 const res=await h.call('POST',route+'/launch3');
 assert.equal(res.status,200,JSON.stringify(res));assert.equal(res.room.match.game,'dog-grinch3');
 assert.equal(res.room.match.grinch.hands[0].length,6);
 assert.equal(res.room.match.grinch.hands[1].length,0);
 assert.equal(res.room.match.grinch3Json,undefined);
 const bob=await h.call('GET','/api/hub/rooms/123','bob');
 assert.equal(bob.room.match.grinch.hands[0].length,0);
 assert.equal(bob.room.match.grinch.hands[1].length,6);
 assert.equal((await h.call('GET','/api/hub/rooms/123','outsider')).status,403);
});
test('accepted human action, durable private state and idempotent retries',async()=>{
 const h=makeHarness();await three(h);grant(h);
 assert.equal((await h.call('POST',route+'/launch3')).status,200);
 const room=()=>h.docs.get('spielesammlung_hub_v1/123');
 const initial=JSON.parse(room().match.grinch3Json);
 const seat=initial.state.current;
 const user=Object.keys(h.people).find(k=>h.people[k].uid===initial.roster[seat].uid);
 const action=mission3LegalMoves(initial.state,seat)[0];
 const body={matchId:initial.id,actionId:'test-action-001',expectedRevision:initial.state.revision,action};
 assert.equal((await h.call('POST',route+'/action3','outsider',body)).status,403);
 const result=await h.call('POST',route+'/action3',user,body);
 assert.equal(result.status,200,JSON.stringify(result));
 const saved=room().match.grinch3Json,rev=room().revision;
 assert.ok(JSON.parse(saved).state.revision>initial.state.revision);
 const replay=await h.call('POST',route+'/action3',user,body);
 assert.equal(replay.status,200);assert.equal(room().revision,rev);assert.equal(room().match.grinch3Json,saved);
 assert.deepEqual(h.docs.get('dog_grinch_campaign_v1/'+initial.roster[seat].uid).completedMissions,[1,2]);
});

test('last verified rune commits progress for all three and never repeats the victory',async()=>{
 const h=makeHarness();await three(h);grant(h);
 assert.equal((await h.call('POST',route+'/launch3')).status,200);
 const room=h.docs.get('spielesammlung_hub_v1/123'),m=JSON.parse(room.match.grinch3Json);
 // Arrange a server-owned near-final state, never via a client action.
 const s=mission3SetPreviewStage(m.state,2);
 s.current=0;s.seven=null;
 const p=s.pieces.find(x=>x.owner===0&&x.place==='track');
 assert.ok(p);
 const occupied=new Set(s.pieces.filter(x=>x.place==='track').map(x=>x.pos));
 const target=Array.from({length:64},(_,i)=>i).find(i=>i%16!==0&&(i+63)%64%16!==0&&!occupied.has(i)&&!occupied.has((i+63)%64));
 p.pos=(target+63)%64;
 s.tasks.objectives.forEach((o,i)=>{o.collected=i<2;if(i===2)o.field=target;});
 s.tasks.progress=[3,4,2];s.tasks.activeFields=[target];
 s.hands[0][0].type='1/11';
 assert.ok(mission3Validate(s));
 m.state=s;room.match.grinch3Json=JSON.stringify(m);
 const move=mission3LegalMoves(s,0).find(x=>x.pieceId===p.id&&x.kind==='move'&&x.distance===1);
 assert.ok(move);
 const user=Object.keys(h.people).find(k=>h.people[k].uid===m.roster[0].uid);
 const body={matchId:m.id,actionId:'final-action-001',expectedRevision:s.revision,action:move};
 const final=await h.call('POST',route+'/action3',user,body);
 assert.equal(final.status,200,JSON.stringify(final));assert.equal(final.room.match.grinch.complete,true);
 assert.equal(final.room.match.status.phase,'finished');
 for(const person of m.roster){
  const progress=h.docs.get('dog_grinch_campaign_v1/'+person.uid);
  assert.deepEqual(progress.completedMissions,[1,2,3]);assert.equal(progress.highestUnlocked,4);assert.ok(progress.mission3Captive);
 }
 const rev=h.docs.get('spielesammlung_hub_v1/123').revision;
 assert.equal((await h.call('POST',route+'/action3',user,body)).status,200);
 assert.equal(h.docs.get('spielesammlung_hub_v1/123').revision,rev);
});
