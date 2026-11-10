import test from 'node:test';
import assert from 'node:assert/strict';
import {installChristmasIceApi} from '../christmas-ice-api.js';
import {newIceState,resetIceState} from '../christmas-ice-engine.js';

function fixture({completed=29,maxRewarded=completed,opened=Array.from({length:29},(_,i)=>i),tickets=0,claimed=false}={}){
 const uid='picture30-player';
 const ice={...newIceState(()=>0),completed,maxRewarded,opened:[...opened],tileCount:30,star:null,
  freeHammers:{single:1,double:0,lucky:0},finished:false,
  ...(claimed?{picture30MonsterSpinsClaimed:true}:{})};
 const docs=new Map([
  ['christmas_ice_progress_v1/'+uid,ice],
  ['deal_or_no_deal_wallets_v1/'+uid,{balance:0}],
  ['deal_peek_inventory_v1/'+uid,{balance:0}],
  ['deal_or_no_deal_christmas_v1/'+uid,{monsterWheelTickets:tickets}]
 ]);
 const routes=new Map(),writes=[],reads=[];
 const app={get:(url,...handlers)=>routes.set('GET '+url,handlers),
  post:(url,...handlers)=>routes.set('POST '+url,handlers)};
 const db={
  collection:name=>({doc:key=>({path:name+'/'+key})}),
  runTransaction:async cb=>{
   const changes=[];let wrote=false;
   const tx={
    get:async ref=>{
     assert.equal(wrote,false,'Firestore reads must precede every transaction write');
     reads.push(ref.path);
     const value=docs.get(ref.path);
     return {exists:value!==undefined,data:()=>value};
    },
    set:(ref,value,options)=>{
     wrote=true;changes.push({ref,value,options});
    },
    create:(ref,value)=>{wrote=true;changes.push({ref,value})},
    update:(ref,value)=>{wrote=true;changes.push({ref,value,options:{merge:true}})}
   };
   const result=await cb(tx);
   for(const entry of changes){
    writes.push(entry.ref.path);
    docs.set(entry.ref.path,entry.options?.merge?{...(docs.get(entry.ref.path)||{}),...entry.value}:entry.value);
   }
   return result;
  }
 };
 installChristmasIceApi(app,{verifyProfile:async()=>({uid}),getFirestore:()=>db});
 const invoke=async(url,body={})=>{
  const handlers=routes.get('POST '+url);assert.ok(handlers,'route '+url);
  const req={body,get:()=> 'Bearer valid-account'};
  const res={statusCode:200,headers:{},status(n){this.statusCode=n;return this},
   set(name,value){this.headers[name]=value;return this},
   json(value){this.body=value;return value}};
  await new Promise((resolve,reject)=>{
   handlers[0](req,res,()=>resolve(handlers[1](req,res))).catch(reject);
  });
  return res;
 };
 return {docs,reads,writes,uid,invoke,
  album:()=>docs.get('deal_or_no_deal_christmas_v1/'+uid),
  ice:()=>docs.get('christmas_ice_progress_v1/'+uid)};
}
const action={type:'strike',index:29,hammer:'single',requestId:'last-tile-picture-30-0001',expectedPicture:30};
test('picture 30 final ice block atomically awards 3 Monster-Wheel spins and the ordinary joker',async()=>{
 const f=fixture();
 const result=await f.invoke('/api/christmas-ice/action',action);
 assert.equal(result.statusCode,200);
 assert.equal(result.body.ok,true);
 assert.equal(result.body.result.found,true);
 assert.equal(result.body.state.completed,30);
 assert.equal(result.body.result.gift?.kind,'joker','regular picture 30 gift remains');
 assert.equal(result.body.result.monsterSpinsGranted,3);
 assert.equal(f.album().monsterWheelTickets,3);
 assert.equal(f.album().icePicture30MonsterSpinsGranted,true);
 assert.equal(f.ice().picture30MonsterSpinsClaimed,true);
 assert.equal(f.ice().peekJokers,1);
 assert.deepEqual(f.writes.filter(x=>x.startsWith('deal_or_no_deal_christmas_v1')).length,1);
 assert.equal(f.reads.includes('deal_or_no_deal_christmas_v1/'+f.uid),true);
});

test('replaying the winning strike and pressing claim again cannot credit another spin',async()=>{
 const f=fixture();
 await f.invoke('/api/christmas-ice/action',action);
 const written=f.writes.length;
 const repeated=await f.invoke('/api/christmas-ice/action',action);
 assert.equal(repeated.statusCode,200);
 assert.equal(repeated.body.result.replayed,true);
 assert.equal(repeated.body.result.monsterSpinsGranted,3,'original receipt is returned, not another award');
 assert.equal(f.writes.length,written);
 const claim=await f.invoke('/api/christmas-ice/claim-picture30',{claimed:false,tickets:999});
 assert.equal(claim.statusCode,200);
 assert.equal(claim.body.granted,false);
 assert.equal(claim.body.amount,0);
 assert.equal(claim.body.tickets,3);
 assert.equal(f.album().monsterWheelTickets,3);
 assert.equal(f.writes.length,written);
 const reset=resetIceState(f.ice(),()=>0);
 assert.equal(reset.picture30MonsterSpinsClaimed,true,'picture 30 receipt survives reset');
 assert.equal(reset.maxRewarded,30);
});

test('players who finished picture 30 before the update receive one retroactive credit',async()=>{
 const f=fixture({completed:35,maxRewarded:35,opened:[],tickets:2});
 const first=await f.invoke('/api/christmas-ice/claim-picture30');
 assert.equal(first.statusCode,200);
 assert.equal(first.body.granted,true);
 assert.equal(first.body.amount,3);
 assert.equal(first.body.tickets,5);
 assert.equal(f.ice().picture30MonsterSpinsClaimed,true);
 const again=await f.invoke('/api/christmas-ice/claim-picture30');
 assert.equal(again.body.granted,false);
 assert.equal(f.album().monsterWheelTickets,5);
 assert.equal(f.writes.filter(x=>x.startsWith('deal_or_no_deal_christmas_v1')).length,1);
});

test('picture 29 never grants Monster-Wheel tickets, including a forged claim',async()=>{
 const f=fixture({completed:28,maxRewarded:28,opened:Array.from({length:29},(_,i)=>i)});
 const rejected=await f.invoke('/api/christmas-ice/claim-picture30',{completed:70,amount:3});
 assert.equal(rejected.statusCode,409);
 assert.equal(rejected.body.error,'PICTURE_30_NOT_REACHED');
 const strike=await f.invoke('/api/christmas-ice/action',{...action,expectedPicture:29,requestId:'last-tile-picture-29-0001'});
 assert.equal(strike.statusCode,200);
 assert.equal(strike.body.state.completed,29);
 assert.equal(f.album().monsterWheelTickets,0);
 assert.equal(f.reads.filter(x=>x.startsWith('deal_or_no_deal_christmas_v1')).length,2,
  'one album read for claim, but no album read for ordinary picture 29 completion');
});

test('preexisting album award marker prevents duplicate backfill if the visible progress flag was lost',async()=>{
 const f=fixture({completed:35,maxRewarded:35,tickets:12});
 f.docs.set('deal_or_no_deal_christmas_v1/'+f.uid,{monsterWheelTickets:12,icePicture30MonsterSpinsGranted:true});
 const result=await f.invoke('/api/christmas-ice/claim-picture30');
 assert.equal(result.statusCode,200);
 assert.equal(result.body.granted,false);
 assert.equal(result.body.tickets,12);
 assert.equal(f.ice().picture30MonsterSpinsClaimed,true);
});
