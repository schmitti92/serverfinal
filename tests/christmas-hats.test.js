import test from 'node:test';
import assert from 'node:assert/strict';
import {HATS_MAX_ROOM,HATS_SUPER_ODDS,drawHatsRoom,scoreHatsPrize,installChristmasHatsApi} from '../christmas-hats-api.js';

test('ten rooms and escalating Superglück chances',()=>{
 assert.equal(HATS_MAX_ROOM,10);
 assert.deepEqual(HATS_SUPER_ODDS,[2,2,2,5,5,5,10,10,15,15]);
});

test('one bomb, normal and strictly better gift in every room',()=>{
 for(let room=1;room<=10;room++)for(let i=0;i<500;i++){
  const hats=drawHatsRoom(room);
  assert.equal(hats.length,3);
  assert.deepEqual(hats.map(h=>h.type).sort(),['bomb','gift','super']);
  const ordinary=hats.find(h=>h.type==='gift'),better=hats.find(h=>h.type==='super');
  assert.ok(scoreHatsPrize(better)>scoreHatsPrize(ordinary),'better must be worth more');
  for(const h of [ordinary,better]){
   assert.ok(h.items.length>=1&&h.items.length<=5);
   const distinct=new Set();
   for(const item of h.items){
    assert.ok(Number.isInteger(item.quantity)&&item.quantity>=1&&item.quantity<=3);
    if(item.kind==='cash'){
     assert.ok(Number.isSafeInteger(item.amountCents));
     assert.ok(item.amountCents>=1&&item.amountCents<=500000000,'max five million euros');
    }
    const key=[item.kind,item.packId,item.hammer].join(':');
    assert.ok(!distinct.has(key),'one reward category only once per hat');
    distinct.add(key);
   }
   if(room<=3&&!h.superLuck){
    assert.ok(h.items.every(item=>item.kind==='hammer'&&item.hammer==='single'||item.kind==='pack'&&item.packId==='small'),
     'rooms 1–3 are limited to ordinary packs and simple hammers');
   }
  }
 }
});

test('rejects invalid rooms',()=>{
 for(const number of [0,11,-5,1.5,'7'])assert.throws(()=>drawHatsRoom(number),/INVALID_ROOM/);
});

test('Superglück is reachable even in the first room',()=>{
 let found=false;
 for(let i=0;i<4000&&!found;i++)found=drawHatsRoom(1).some(h=>h.superLuck);
 assert.equal(found,true);
});


test('server checkpoint and exact-once cash settlement',async()=>{
 const previousChrisUid=process.env.DEAL_CHRIS_BONUS_UID;
 process.env.DEAL_CHRIS_BONUS_UID='player1';
 const docs=new Map(),routes=new Map();
 const app={
  get(path,...handlers){routes.set('GET '+path,handlers);},
  post(path,...handlers){routes.set('POST '+path,handlers);}
 };
 const snapshot=(path)=>({exists:docs.has(path),data:()=>structuredClone(docs.get(path))});
 const db={
  collection(name){return {doc(uid){const path=name+'/'+uid;return {get:async()=>snapshot(path),_path:path};}};},
  async runTransaction(run){
   const pending=[];
   const tx={
    async get(ref){return snapshot(ref._path);},
    set(ref,value,opt){pending.push({path:ref._path,value:structuredClone(value),merge:!!opt?.merge});}
   };
   const result=await run(tx);
   for(const entry of pending){docs.set(entry.path,entry.merge?{...(docs.get(entry.path)||{}),...entry.value}:entry.value);}
   return result;
  }
 };
 installChristmasHatsApi(app,{getFirestore:()=>db,verifyProfile:async token=>token==='test' ? {uid:'player1'} : null});
 async function request(method,path,body={},query={}){
  const handlers=routes.get(method+' '+path);
  assert.ok(handlers,'route must be registered: '+path);
  const req={body,query,get(name){return name==='authorization'?'Bearer test':null;}};
  const res={code:200,body:null,status(n){this.code=n;return this;},set(){return this;},json(b){this.body=b;return this;}};
  for(let i=0;i<handlers.length-1;i++)await new Promise(resolve=>handlers[i](req,res,resolve));
  await handlers.at(-1)(req,res);
  assert.equal(res.code,200,JSON.stringify(res.body));
  assert.equal(res.body.ok,true);
  return res.body;
 }
 const action=(body)=>request('POST','/api/christmas-hats/action',body);
 let r=await action({type:'start',requestId:'start_test_0000000001'});
 assert.equal(r.state.room,1);
 assert.ok(!Object.hasOwn(r.state,'layout'),'hats positions must never leak to client');
 const runId=r.state.id;
 let firstPickIndex=null;
 for(let room=1;room<=3;room++){
  const hidden=docs.get('deal_christmas_hats_v1/player1');
  const index=hidden.layout.findIndex(x=>x.type==='gift');
  if(room===1)firstPickIndex=index;
  r=await action({type:'pick',index,requestId:'pick_checkpoint_'+room+'xxxxxxx',runId});
  assert.equal(r.result.type,'gift');
 }
 assert.equal(r.state.checkpoint,3);
 assert.equal(r.state.secured.length,3);
 assert.equal(r.state.pending.length,0);
 // Replay the FIRST of three picks after two newer picks: never select a
 // second hat in room four or credit a second prize.
 const untouched=structuredClone([...docs.entries()]);
 const oldPick=await action({type:'pick',index:firstPickIndex,
  requestId:'pick_checkpoint_1xxxxxxx',runId});
 assert.equal(oldPick.replayed,true);
 assert.equal(oldPick.outdated,true);
 assert.equal(oldPick.state.room,4);
 assert.deepEqual([...docs.entries()],untouched,'late pick cannot open a new room');
 const recovered=await request('GET','/api/christmas-hats/me',{}, {pendingId:'pick_checkpoint_1xxxxxxx'});
 assert.equal(recovered.pendingAction.applied,true);
 assert.equal(recovered.pendingAction.result.room,1);
 const fourth=docs.get('deal_christmas_hats_v1/player1');
 const bomb=fourth.layout.findIndex(x=>x.type==='bomb');
 const bombAction={type:'pick',index:bomb,requestId:'bomb_checkpoint_xxx1',runId};
 r=await action(bombAction);
 assert.equal(r.state.status,'finished');
 assert.equal(r.state.summary.reason,'bomb');
 assert.equal(r.state.summary.awarded.length,3);
 assert.equal(r.state.summary.lost.length,0);
 const after=structuredClone([...docs.entries()]);
 const replay=await action(bombAction);
 assert.equal(replay.replayed,true);
 assert.deepEqual([...docs.entries()],after,'replay must not issue duplicate rewards');
 const newRun=await action({type:'start',requestId:'new_run_after_bomb_x'});
 assert.notEqual(newRun.state.id,runId);
 const zero=await action({type:'cash',runId:newRun.state.id,requestId:'cash_out_without_prize_x'});
 assert.equal(zero.state.status,'finished');
 assert.equal(zero.state.summary.awarded.length,0);
 const thirdRun=await action({type:'start',requestId:'start_seven_checkpoint_001'});
 let current=thirdRun;
 const thirdId=thirdRun.state.id;
 for(let i=1;i<=7;i++){
  const saved=docs.get('deal_christmas_hats_v1/player1');
  const gift=saved.layout.findIndex(h=>h.type==='gift');
  current=await action({type:'pick',runId:thirdId,index:gift,requestId:'seven_checkpoint_'+i+'_actionxxx'});
 }
 assert.equal(current.state.checkpoint,7);
 assert.equal(current.state.secured.length,7);
 assert.equal(current.state.pending.length,0);
 const resultCash=await action({type:'cash',runId:thirdId,requestId:'cash_after_seven_roomx'});
 assert.equal(resultCash.state.status,'finished');
 assert.equal(resultCash.state.summary.reason,'cash');
 assert.equal(resultCash.state.summary.awarded.length,7);
 const beforeCashReplay=structuredClone([...docs.entries()]);
 const cashAgain=await action({type:'cash',runId:thirdId,requestId:'cash_after_seven_roomx'});
 assert.equal(cashAgain.replayed,true);
 assert.deepEqual([...docs.entries()],beforeCashReplay);
 const access=await request('GET','/api/christmas-hats/access');
 assert.equal(access.allowed,true);
 if(previousChrisUid===undefined)delete process.env.DEAL_CHRIS_BONUS_UID;
 else process.env.DEAL_CHRIS_BONUS_UID=previousChrisUid;
});


test('private beta access uses verified UID and fails closed if not configured',async()=>{
 const previous=process.env.DEAL_CHRIS_BONUS_UID;
 try{
  delete process.env.DEAL_CHRIS_BONUS_UID;
  const handlers=new Map();
  const app={get(path,...fn){handlers.set('GET '+path,fn);},post(path,...fn){handlers.set('POST '+path,fn);}};
  installChristmasHatsApi(app,{verifyProfile:async token=>token==='chris'?{uid:'player1'}:token==='david'?{uid:'player2'}:null,getFirestore:()=>null});
  async function invoke(path,token){
   const list=handlers.get('GET '+path);
   const req={get(name){return name==='authorization'?'Bearer '+token:'';}};
   const res={code:200,body:null,status(c){this.code=c;return this;},set(){return this;},json(v){this.body=v;return this;}};
   for(let i=0;i<list.length-1;i++){let called=false;await new Promise(resolve=>list[i](req,res,()=>{called=true;resolve()})); if(!called)break;}
   // direct invocation is enough for the public access route; restricted /me
   // must return 403 before accessing Firestore.
   if(path==='/api/christmas-hats/access')await list.at(-1)(req,res);
   return res;
  }
  const empty=await invoke('/api/christmas-hats/access','chris');
  assert.equal(empty.body.allowed,false);
  process.env.DEAL_CHRIS_BONUS_UID='player1';
  const tester=await invoke('/api/christmas-hats/access','chris');
  const other=await invoke('/api/christmas-hats/access','david');
  assert.equal(tester.body.allowed,true);
  assert.equal(other.body.allowed,false);
 }finally{
  if(previous===undefined)delete process.env.DEAL_CHRIS_BONUS_UID;
  else process.env.DEAL_CHRIS_BONUS_UID=previous;
 }
});
