import test from 'node:test';
import assert from 'node:assert/strict';
import {HATS_MAX_ROOM,HATS_SUPER_ODDS,HATS_BOMB_ODDS,HATS_CHECKPOINTS,drawHatsRoom,scoreHatsPrize,installChristmasHatsApi} from '../christmas-hats-api.js';

test('twenty rooms with escalating Superglück and bomb probabilities',()=>{
 assert.equal(HATS_MAX_ROOM,20);
 assert.deepEqual(HATS_SUPER_ODDS,[2,2,2,5,5,5,10,10,15,15,16,16,17,17,18,18,19,19,20,22]);
 assert.deepEqual(HATS_BOMB_ODDS,[10,11,12,13,14,15,17,19,21,23,25,26,27,28,29,30,31,32,33,33]);
 assert.deepEqual(HATS_CHECKPOINTS,[3,5,7,9,12,15,18]);
});

test('each room has at most one bomb and the super hat is best',()=>{
 for(let room=1;room<=20;room++)for(let i=0;i<250;i++){
  const hats=drawHatsRoom(room);
  assert.equal(hats.length,3);
  assert.ok(hats.filter(h=>h.type==='bomb').length<=1);
  assert.equal(hats.filter(h=>h.type==='super').length,1);
  assert.ok(hats.some(h=>h.type==='gift'));
  const ordinary=hats.filter(h=>h.type==='gift'),better=hats.find(h=>h.type==='super');
  for(const gift of ordinary)assert.ok(scoreHatsPrize(better)>scoreHatsPrize(gift),'better must be worth more');
  for(const h of [...ordinary,better]){
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
   if(room>=4&&!h.superLuck){
    assert.ok(h.items.every(item=>item.kind!=='pack'||item.packId!=='small'),'no tiny packs from room 4 onward');
    assert.ok(h.items.every(item=>item.kind!=='hammer'||item.hammer!=='single'),'no weak hammer from room 4 onward');
   }
   if(room>=7&&!h.superLuck){
    assert.ok(h.items.every(item=>item.kind!=='pack'||['large','premium','platinum'].includes(item.packId)),
      'jackpot rooms use only medium/high packs');
   }
  }
 }
});

test('probability of the chosen hat containing a bomb matches each advertised room chance',()=>{
 for(const room of [1,3,5,6,8,10,12,15,18,20]){
  const trials=3000;let pickedBombs=0,zeroBombRooms=0;
  for(let i=0;i<trials;i++){
   const layout=drawHatsRoom(room);
   if(layout[0].type==='bomb')pickedBombs++;
   if(!layout.some(h=>h.type==='bomb'))zeroBombRooms++;
  }
  const actual=pickedBombs/trials*100;
  assert.ok(Math.abs(actual-HATS_BOMB_ODDS[room-1])<3.5,'room '+room+' advertised odds '+HATS_BOMB_ODDS[room-1]+'% actual '+actual.toFixed(2)+'%');
  if(room===1)assert.ok(zeroBombRooms>1500,'most first rooms contain no bombs');
 }
});

test('new 20-room sessions remain independent of still-active 10-room legacy sessions',()=>{
 const old2=drawHatsRoom(10,2),old1=drawHatsRoom(10,1);
 assert.equal(old1.filter(h=>h.type==='bomb').length,1);
 assert.ok(old2.filter(h=>h.type==='bomb').length<=1);
 assert.throws(()=>drawHatsRoom(11,1),/INVALID_ROOM/);
 assert.throws(()=>drawHatsRoom(11,2),/INVALID_ROOM/);
 assert.equal(drawHatsRoom(11,3).length,3);
 assert.equal(drawHatsRoom(20,3).length,3);
});

test('rejects invalid rooms',()=>{
 for(const number of [0,21,-5,1.5,'7'])assert.throws(()=>drawHatsRoom(number),/INVALID_ROOM/);
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
 assert.equal(r.state.bombOdds,10);
 assert.equal(r.state.rulesVersion,3);
 assert.equal(r.state.maxRoom,20);
 assert.deepEqual(r.state.checkpoints,[3,5,7,9,12,15,18]);
 assert.equal(r.vouchers.total,0,'first start consumes the one-time free voucher');
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
 let bomb=fourth.layout.findIndex(x=>x.type==='bomb');
 // With favorable probabilities, some rooms have no bomb. Force one only
 // in this server fixture to verify correct failure/receipt behavior.
 if(bomb<0){bomb=0;fourth.layout[0]={type:'bomb',items:[]};docs.set('deal_christmas_hats_v1/player1',fourth);}
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
 // One lifetime free ticket cannot be used again after the bomb.
 const usedVoucher=docs.get('deal_christmas_hats_v1/player1');
 assert.equal(usedVoucher.freeVoucherUsed,true);
 assert.equal(usedVoucher.bonusTickets,0);
 let blocked;
 try{await action({type:'start',requestId:'blocked_second_free_x'})}catch(e){blocked=e}
 assert.ok(blocked,'a second free run must be rejected');
 // Future event achievements can later issue extraTickets from a trusted server action.
 // Simulate two such later rewards to exercise resumability and receipt settlement.
 docs.set('deal_christmas_hats_v1/player1',{...usedVoucher,bonusTickets:2});
 const newRun=await action({type:'start',requestId:'new_run_after_bomb_x'});
 assert.notEqual(newRun.state.id,runId);
 assert.equal(newRun.vouchers.total,1,'only one of two bonus tickets spent');
 const zero=await action({type:'cash',runId:newRun.state.id,requestId:'cash_out_without_prize_x'});
 assert.equal(zero.state.status,'finished');
 assert.equal(zero.state.summary.awarded.length,0);
 const thirdRun=await action({type:'start',requestId:'start_seven_checkpoint_001'});
 assert.equal(thirdRun.vouchers.total,0);
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
 const finished=await request('GET','/api/christmas-hats/me');
 assert.equal(finished.vouchers.free,0);
 assert.equal(finished.vouchers.bonus,0);
 if(previousChrisUid===undefined)delete process.env.DEAL_CHRIS_BONUS_UID;
 else process.env.DEAL_CHRIS_BONUS_UID=previousChrisUid;
});


test('hats are open to all authenticated profiles regardless of former Chris beta flag',async()=>{
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
  assert.equal(empty.body.allowed,true);
  process.env.DEAL_CHRIS_BONUS_UID='player1';
  const tester=await invoke('/api/christmas-hats/access','chris');
  const other=await invoke('/api/christmas-hats/access','david');
  assert.equal(tester.body.allowed,true);
  assert.equal(other.body.allowed,true);
 }finally{
  if(previous===undefined)delete process.env.DEAL_CHRIS_BONUS_UID;
  else process.env.DEAL_CHRIS_BONUS_UID=previous;
 }
});
