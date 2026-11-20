import test from 'node:test';
import assert from 'node:assert/strict';
import {installSharedLobby} from '../shared-lobby.js';
import {newGame,legalMoves,play,publicMissionState,pieceCoord} from '../dog/grinch-mission2.js';

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

const village={levels:{tower:5,workshop:5,bakery:5,inn:5,luckhouse:1,academy:1}};
const route='/api/hub/rooms/123/grinch';
async function three(h){
 const created=await h.call('POST','/api/hub/rooms');
 assert.equal(created.status,200);
 await h.call('POST','/api/hub/rooms/123/join','bob');
 await h.call('POST','/api/hub/rooms/123/join','cara');
 h.docs.set('dog_christmas_villages_v1/lichtertal_2026_shared',village);
}
function grantMission1(h){
 for(const who of Object.values(h.people).filter(p=>p.uid!=='outside-uid')){
  h.docs.set('dog_grinch_campaign_v1/'+who.uid,
   {uid:who.uid,name:who.name,completedMissions:[1],highestUnlocked:2});
 }
}
test('mission 2: only the host can start, and EVERY real player must finish mission 1',async()=>{
 const h=makeHarness();await three(h);
 let res=await h.call('POST',route+'/launch2','bob');assert.equal(res.status,403);
 res=await h.call('POST',route+'/launch2');assert.equal(res.status,409);
 assert.equal(res.error,'GRINCH_MISSION1_REQUIRED_FOR_ALL_PLAYERS');
 grantMission1(h);
 h.docs.get('dog_grinch_campaign_v1/cara-uid').completedMissions=[];
 res=await h.call('POST',route+'/launch2');
 assert.equal(res.status,409);
 assert.equal(res.error,'GRINCH_MISSION1_REQUIRED_FOR_ALL_PLAYERS');
 h.docs.get('dog_grinch_campaign_v1/cara-uid').completedMissions=[1];
 res=await h.call('POST',route+'/launch2');
 assert.equal(res.status,200,JSON.stringify(res));
 assert.equal(res.room.match.game,'dog-grinch2');
 assert.equal(res.room.match.grinch.mission,2);
 assert.equal(res.room.match.grinch.seed,null);
 assert.equal(res.room.match.grinch.hands[1].length,0);
 assert.equal(res.room.match.grinch.m2.spins[0].round,1);
 const bob=await h.call('GET','/api/hub/rooms/123','bob');
 assert.equal(bob.room.match.grinchSeat,1);
 assert.equal(bob.room.match.grinch.hands[0].length,0);
 assert.equal(bob.room.match.grinch.hands[1].length,6);
 assert.equal((await h.call('GET','/api/hub/rooms/123','outsider')).status,403);
});
test('mission 2: protected turn, one-time actions and true effects',async()=>{
 const h=makeHarness();await three(h);grantMission1(h);
 const started=await h.call('POST',route+'/launch2');
 assert.equal(started.status,200);
 const saved=h.docs.get('spielesammlung_hub_v1/123');
 const g=saved.match.grinch,seat=g.current;
 const actor=saved.match.grinchRoster[seat].uid;
 const who=Object.keys(h.people).find(x=>h.people[x].uid===actor);
 const opts=g.hands[seat].flatMap(c=>legalMoves(g,seat,c));
 assert.ok(opts.length);
 const invalid=await h.call('POST',route+'/action',who,{
  matchId:saved.match.id,actionId:'m2-illegal-test-001',expectedRevision:g.revision,action:{kind:'win'}
 });
 assert.equal(invalid.status,409);
 const action={matchId:saved.match.id,expectedRevision:g.revision,actionId:'m2-valid-action-001',action:opts[0]};
 const good=await h.call('POST',route+'/action',who,action);
 assert.equal(good.status,200,JSON.stringify(good));
 const replay=await h.call('POST',route+'/action',who,action);
 assert.equal(replay.status,200);
 assert.equal(replay.room.match.grinch.revision,good.room.match.grinch.revision);
 assert.equal(h.docs.get('spielesammlung_hub_v1/123').match.grinch.pieces.length,15);
 const progress=await h.call('GET','/api/hub/grinch/progress','alice');
 assert.deepEqual(progress.progress.completedMissions,[1],'no fabricated mission 2 completion from early move');
});


test('mission 2: verified nine-portal victory records mission 2 exactly once for all three, never pays fake tickets',async()=>{
 const h=makeHarness();await three(h);grantMission1(h);
 const started=await h.call('POST',route+'/launch2');
 assert.equal(started.status,200);
 const saved=h.docs.get('spielesammlung_hub_v1/123');
 const g=saved.match.grinch;
 // Arrange a near-complete server-owned match. Only one legitimate last step
 // remains; the server must still calculate and verify that final card action.
 g.players.forEach(info=>{info.lost=true;info.m2Lost=true;info.moves=12;});
 g.pieces.forEach(p=>{
  const i=Number(p.id.slice(1))%5;
  if(i===4||i===3){p.place='lost';p.steps=-1;}
  else if(p.seat===2&&i===2){p.place='track';p.steps=63;}
  else{p.place='teleported';p.steps=64;}
 });
 g.current=2;g.seven=null;
 g.hands[2][0].type='1/11';
 g.m2.cardCurse=null;g.m2.frozen={};g.m2.hazards=[];
 g.m2.portalUntil=-1;g.m2.noSwapUntil=-1;g.m2.lockedCard=null;g.m2.forcedCard=null;
 g.m2.forcedPiece=null;g.m2.afterMovePush=0;g.m2.frostLands=0;
 const legal=g.hands[2].flatMap(c=>legalMoves(g,2,c));
 const action=legal.find(m=>m.pieceId==='p12'&&m.kind==='move'&&m.distance===1&&m.targetSteps===64);
 assert.ok(action,'last genuine 1-step portal move exists');
 const player=h.people.cara;
 const body={matchId:saved.match.id,expectedRevision:g.revision,actionId:'grinch-m2-final-001',action};
 const final=await h.call('POST',route+'/action','cara',body);
 assert.equal(final.status,200,JSON.stringify(final));
 assert.equal(final.room.match.grinch.complete,true);
 const persisted=h.docs.get('spielesammlung_hub_v1/123');
 assert.equal(persisted.match.grinchCompletionRecorded,true);
 assert.equal(persisted.match.grinch.pieces.filter(p=>p.place==='teleported').length,9);
 assert.equal(persisted.match.grinch.pieces.filter(p=>p.place==='lost').length,6);
 for(const person of ['alice','bob','cara']){
  const progress=await h.call('GET','/api/hub/grinch/progress',person);
  assert.deepEqual(progress.progress.completedMissions,[1,2]);
  assert.equal(progress.progress.highestUnlocked,3);
 }
 const replay=await h.call('POST',route+'/action','cara',body);
 assert.equal(replay.status,200);
 assert.equal(h.docs.get('spielesammlung_hub_v1/123').match.grinch.revision,
  persisted.match.grinch.revision,'duplicate victory cannot reapply the action');
});
