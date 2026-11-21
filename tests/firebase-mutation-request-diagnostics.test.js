import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createFirebaseMutationRequestDiagnostics} from '../firebase-mutation-request-diagnostics.js';

test('counts successful write-intent routes without capturing identities or contacting Firestore',()=>{
 let now=1_200_000;
 const diagnostic=createFirebaseMutationRequestDiagnostics({clock:()=>now});
 const requests=[
  {method:'POST',url:'/api/hub/rooms/123/dog/action',path:'/api/hub/rooms/:code/dog/action',status:200},
  {method:'POST',url:'/api/hub/rooms/999/dog/action',path:'/api/hub/rooms/:code/dog/action',status:200},
  {method:'POST',url:'/api/hub/rooms/123/dog/action',path:'/api/hub/rooms/:code/dog/action',status:409},
  {method:'GET',url:'/api/hub/rooms/123',path:'/api/hub/rooms/:code',status:200}
 ];
 for(const row of requests){
  const req={method:row.method,route:{path:row.path},baseUrl:'',originalUrl:row.url,
   headers:{authorization:'Bearer secret'},body:{uid:'not-recorded'}};
  const res=new EventEmitter();res.statusCode=row.status;
  let nextCalled=false;diagnostic.observe(req,res,()=>{nextCalled=true});
  assert.equal(nextCalled,true);
  res.emit('finish');
 }
 const snapshot=diagnostic.snapshot();
 assert.equal(snapshot.successfulRequests,2);
 assert.deepEqual(snapshot.byRoute,[{route:'POST /api/hub/rooms/:code/dog/action',count:2}]);
 assert.equal(JSON.stringify(snapshot).includes('123'),false);
 assert.equal(JSON.stringify(snapshot).includes('999'),false);
 assert.equal(JSON.stringify(snapshot).includes('secret'),false);
 now+=660000;
 assert.equal(diagnostic.snapshot().successfulRequests,0,'outdated request activity rolls off');
});
