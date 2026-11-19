import test from 'node:test';
import assert from 'node:assert/strict';
import {installSharedLobby} from '../shared-lobby.js';
import {newGame,legalMoves,play,publicMissionState,pieceCoord} from '../dog/grinch-mission1.js';

const clone=value=>value===undefined?undefined:structuredClone(value);
function makeHarness(){
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
  getFirestore:()=>store,clock:()=>1700000000000,codeGenerator:()=> '123'});
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

test('figure 5 starts on protected start and public state hides hands, seed, and future losses',()=>{
 const s=newGame(1234,['Alice','Bob','Cara']);
 assert.equal(s.pieces.length,15);
 assert.deepEqual(s.pieces.filter(p=>p.place==='track').map(pieceCoord),[0,16,48]);
 assert.equal(s.pieces.filter(p=>p.place==='home').length,12);
 const alice=publicMissionState(s,0),bob=publicMissionState(s,1),spectator=publicMissionState(s,null);
 assert.equal(alice.seed,null);assert.deepEqual(alice.draw,[]);
 assert.equal(alice.players[0].lossType,undefined);
 assert.equal(alice.hands[0].length,6);
 assert.equal(alice.hands[1].length,0);
 assert.equal(bob.hands[0].length,0);
 assert.equal(bob.hands[1].length,6);
 assert.equal(spectator.hands.flat().length,0);
 assert.deepEqual(alice.handCounts,[6,6,6]);
 assert.equal(s.seed,1234,'projecting the game never mutates the server state');
});

test('shared hub launch requires host, three real players and verified level 10',async()=>{
 const h=makeHarness();
 const created=await h.call('POST','/api/hub/rooms');
 const code=created.room.code;assert.equal(code,'123');
 await h.call('POST',`/api/hub/rooms/${code}/join`,'bob');
 assert.equal((await h.call('POST',`/api/hub/rooms/${code}/grinch/launch`,'bob')).status,403);
 assert.equal((await h.call('POST',`/api/hub/rooms/${code}/grinch/launch`)).status,409,'two players are insufficient');
 await h.call('POST',`/api/hub/rooms/${code}/join`,'cara');
 const locked=await h.call('POST',`/api/hub/rooms/${code}/grinch/launch`);
 assert.equal(locked.status,409);assert.equal(locked.error,'GRINCH_TREE_LEVEL_10_REQUIRED');
 h.docs.set('dog_christmas_villages_v1/lichtertal_2026_shared',
  {levels:{tower:5,workshop:5,bakery:5,inn:5,luckhouse:1,academy:1}});
 const launched=await h.call('POST',`/api/hub/rooms/${code}/grinch/launch`);
 assert.equal(launched.status,200);
 assert.equal(launched.room.code,code,'the main hub code is reused');
 assert.equal(launched.room.match.game,'dog-grinch1');
 assert.equal(launched.room.match.grinchRoster.length,3);
 assert.equal(launched.room.match.grinch.seed,null);
 assert.deepEqual(launched.room.match.grinch.draw,[]);
 const bob=await h.call('GET',`/api/hub/rooms/${code}`,'bob');
 assert.equal(bob.room.match.grinchSeat,1);
 assert.equal(bob.room.match.grinch.hands[0].length,0);
 assert.equal(bob.room.match.grinch.hands[1].length,6);
 assert.equal(bob.room.match.grinch.players[0].lossType,undefined);
 assert.equal((await h.call('GET',`/api/hub/rooms/${code}`,'outsider')).status,403);
 const before=h.docs.get('spielesammlung_hub_v1/'+code);
 const actor=before.match.grinchRoster[before.match.grinch.current];
 const card=before.match.grinch.hands[before.match.grinch.current][0];
 const fake={kind:'win',cardId:card.id};
 const invalid=await h.call('POST',`/api/hub/rooms/${code}/grinch/action`,Object.keys(h.people).find(k=>h.people[k].uid===actor.uid),{
  matchId:before.match.id,expectedRevision:before.match.grinch.revision,actionId:'forged-action-01',action:fake});
 assert.equal(invalid.status,409);
 assert.deepEqual((await h.call('GET','/api/hub/grinch/progress','alice')).progress.completedMissions,[]);
});

test('all three authenticated players receive an idempotent durable unlock only after real completion',async()=>{
 const h=makeHarness();
 const created=await h.call('POST','/api/hub/rooms');
 await h.call('POST','/api/hub/rooms/123/join','bob');
 await h.call('POST','/api/hub/rooms/123/join','cara');
 h.docs.set('dog_christmas_villages_v1/lichtertal_2026_shared',
  {levels:{tower:5,workshop:5,bakery:5,inn:5,luckhouse:1,academy:1}});
 const started=await h.call('POST','/api/hub/rooms/123/grinch/launch');
 assert.equal(started.status,200);
 const authForUid=uid=>Object.keys(h.people).find(k=>h.people[k].uid===uid);
 let moves=0,lastPayload=null,lastActor=null;
 while(moves<1400){
  const saved=h.docs.get('spielesammlung_hub_v1/123');
  const g=saved.match.grinch;
  if(g.complete)break;
  const seat=g.current;
  const legal=g.hands[seat].flatMap(card=>legalMoves(g,seat,card));
  assert.ok(legal.length,'the authenticated game must not deadlock');
  legal.sort((a,b)=>(b.kind==='start'?70:b.kind==='move'?b.targetSteps:b.kind==='seven'?b.targetSteps:0)-
    (a.kind==='start'?70:a.kind==='move'?a.targetSteps:a.kind==='seven'?a.targetSteps:0));
  const selected=legal[0];
  const body={matchId:saved.match.id,actionId:'grinch-test-'+String(moves+1).padStart(5,'0'),
    expectedRevision:g.revision,action:selected};
  const who=authForUid(saved.match.grinchRoster[seat].uid);
  const response=await h.call('POST','/api/hub/rooms/123/grinch/action',who,body);
  assert.equal(response.status,200,JSON.stringify(response));
  assert.equal(response.room.match.grinch.seed,null);
  const own=response.room.match.grinch.hands.filter(h=>h.length>0);
  assert.ok(own.length<=1,'no other player's cards may escape the server');
  lastPayload=body;lastActor=who;moves++;
 }
 assert.ok(moves<1400,'the real game finished');
 const room=h.docs.get('spielesammlung_hub_v1/123');
 assert.equal(room.match.grinch.complete,true);
 assert.equal(room.match.grinchCompletionRecorded,true);
 assert.equal(room.match.grinch.pieces.filter(p=>p.place==='lost').length,3);
 assert.equal(room.match.grinch.pieces.filter(p=>p.place==='teleported').length,12);
 for(const person of ['alice','bob','cara']){
  const p=await h.call('GET','/api/hub/grinch/progress',person);
  assert.equal(p.status,200);
  assert.deepEqual(p.progress.completedMissions,[1]);
  assert.equal(p.progress.highestUnlocked,2);
  assert.equal(p.progress.lastCompletedMatchId,room.match.id);
 }
 const replay=await h.call('POST','/api/hub/rooms/123/grinch/action',lastActor,lastPayload);
 assert.equal(replay.status,200);
 assert.equal(h.docs.get('spielesammlung_hub_v1/123').match.grinch.revision,
  room.match.grinch.revision,'replayed command cannot apply a second move');
});
