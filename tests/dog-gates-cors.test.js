import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Exercise the actual express middleware without starting a network server or
// connecting to Firebase. An authenticated browser request first preflights
// Authorization; missing CORS headers otherwise hide the whole 100-Tore event.
const serverSource=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const marker=serverSource.indexOf('// CORS for GitHub Pages / mobile browsers');
const start=serverSource.indexOf('app.use((req, res, next) => {',marker);
const end=serverSource.indexOf('app.use(express.json(',start);
assert.ok(marker>0&&start>marker&&end>start,'server CORS middleware found');

let corsMiddleware;
runInNewContext(serverSource.slice(start,end),{
 app:{use(handler){corsMiddleware=handler}},
 process:{env:{PROFILE_ALLOWED_ORIGINS:'https://schmitti92.github.io'}}
});
assert.equal(typeof corsMiddleware,'function');

function request(path,origin,method='OPTIONS'){
 const headers={};
 const res={
  statusCode:200,ended:false,
  setHeader(key,value){headers[key.toLowerCase()]=value},
  status(code){this.statusCode=code;return this},
  end(){this.ended=true;return this}
 };
 const req={path,method,get(key){return key==='origin'?origin:null}};
 let nextCalled=false;
 corsMiddleware(req,res,()=>{nextCalled=true});
 return {headers,status:res.statusCode,ended:res.ended,nextCalled};
}

test('Every 100-Tore browser endpoint accepts the authenticated Pages preflight',()=>{
 const routes=[
  '/api/dog/gates/map','/api/dog/gates/join','/api/dog/gates/fight',
  '/api/dog/gates/boss10','/api/dog/gates/boss10/ready',
  '/api/dog/gates/boss/20','/api/dog/gates/boss/100/minigame',
  '/api/dog/gates/ascension','/api/dog/gates/ascension/upgrade',
  '/api/dog/materials/open','/api/dog/forge/me'
 ];
 for(const path of routes){
  const preflight=request(path,'https://schmitti92.github.io');
  assert.equal(preflight.status,204,path+' preflight status');
  assert.equal(preflight.ended,true,path+' preflight ends');
  assert.equal(preflight.nextCalled,false,path+' preflight does not hit auth');
  assert.equal(preflight.headers['access-control-allow-origin'],
   'https://schmitti92.github.io',path+' allow origin');
  assert.match(preflight.headers['access-control-allow-headers'],/Authorization/i,path);
  assert.match(preflight.headers['access-control-allow-methods'],/POST/,path);
  assert.equal(preflight.headers['vary'],'Origin',path);
  const get=request(path,'https://schmitti92.github.io','GET');
  assert.equal(get.nextCalled,true,path+' GET reaches authenticated route');
 }
});

test('Only approved origins receive authentication CORS permission',()=>{
 const outside=request('/api/dog/gates/map','https://malicious.invalid');
 assert.equal(outside.headers['access-control-allow-origin'],undefined);
 const approved=request('/api/dog/gates/boss/100','https://schmitti92.github.io');
 assert.equal(approved.headers['access-control-allow-origin'],'https://schmitti92.github.io');
 const hub=request('/api/hub/rooms','https://schmitti92.github.io');
 assert.match(hub.headers['access-control-allow-headers'],/Authorization/);
});
