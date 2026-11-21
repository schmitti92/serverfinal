import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createFirebaseReadRequestDiagnostics} from '../firebase-read-request-diagnostics.js';

function request(d,method,template,status=200){
 const req={method,route:{path:template}},res=new EventEmitter();
 res.statusCode=status;
 let next=false;
 d.observe(req,res,()=>{next=true});
 assert.equal(next,true);
 res.emit('finish');
}
test('route-only diagnostics count successful GETs without room codes, tokens or UIDs',()=>{
 let now=1_000_000;
 const d=createFirebaseReadRequestDiagnostics({clock:()=>now});
 request(d,'GET','/api/hub/scratch');
 request(d,'GET','/api/hub/scratch');
 request(d,'GET','/api/hub/rooms/:code',200);
 request(d,'GET','/api/hub/rooms/:code',403);
 request(d,'POST','/api/hub/scratch',200);
 request(d,'GET','/api/firebase/read-activity');
 const r=d.snapshot();
 assert.equal(r.successfulRequests,3);
 assert.deepEqual(r.byRoute,[
  {route:'/api/hub/scratch',count:2},
  {route:'/api/hub/rooms/:code',count:1}
 ]);
 assert.equal(JSON.stringify(r).includes('123'),false,'no real room codes in telemetry');
 now+=11*60*1000;
 assert.equal(d.snapshot().successfulRequests,0);
});
