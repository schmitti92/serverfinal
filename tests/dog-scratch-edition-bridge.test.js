import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const get=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const hub=get('../shared-lobby.js');
const edition=get('../christmas-scratch-api.js');
const server=get('../server.js');

test('original shared-lobby remains the only GET, settings and purchase API',()=>{
 assert.match(hub,/app\.get\('\/api\/hub\/scratch',authentication/);
 assert.match(hub,/app\.post\('\/api\/hub\/scratch\/settings',authentication/);
 assert.match(hub,/app\.post\('\/api\/hub\/scratch\/buy',authentication/);
 assert.doesNotMatch(edition,/app\.get\(base/);
 assert.doesNotMatch(edition,/app\.post\(base\+'\/buy'/);
 assert.doesNotMatch(edition,/app\.post\(base\+'\/settings'/);
 assert.match(edition,/installDogScratchEditionApi/);
 assert.match(server,/installDogScratchEditionApi\(app,/);
 assert.doesNotMatch(server,/installChristmasScratchApi\(/);
});
test('all seven edition statuses are returned by the existing authenticated scratch GET',()=>{
 assert.match(hub,/app\.get\('\/api\/hub\/scratch',authentication/);
 assert.match(hub,/giftsEdition:giftsEditionPublic\(/);
 assert.match(hub,/snowEdition:snowEditionPublic\(/);
 assert.match(hub,/ticEdition:ticEditionPublic\(/);
 assert.match(hub,/otherEditions:Object\.fromEntries\(/);
 assert.match(hub,/OTHER_EDITION_VARIANTS\.map\(/);
 assert.match(hub,/dogLuckhouseDiscountPercent\(villageSnap/);
});
test('edition purchases stay atomic with tree entitlements and shared lights',()=>{
 const start=hub.indexOf("app.post('/api/hub/scratch/buy',authentication");
 const end=hub.indexOf("app.get('/api/hub/dog/stats',authentication",start);
 assert.ok(start>0&&end>start,'The original purchase handler must exist');
 const buy=hub.slice(start,end);
 assert.match(buy,/if\(!christmasActive\(\)\)throw error\(409,'DOG_CHRISTMAS_EVENT_ENDED'\)/);
 for(const text of ['tx.get(treeRef)','tx.get(sharedVillageRef)','issueGiftsEditionTicket(wallet,tree',
  'issueSnowEditionTicket(wallet,tree','issueTicEditionTicket(wallet,tree',
  'issueOtherEditionTicket(wallet,tree','tx.set(accountRef,result.wallet)',
  'tx.set(ticEditionRef,nextTicEdition)','tx.set(otherEditionRef,nextOtherEdition)',
  'creditDogVillage('])assert.ok(buy.includes(text),'Missing transaction step: '+text);
 assert.match(buy,/if\(!result\.unchanged\&\&Number\.isSafeInteger\(result\.result\?\.totalLights\)/);
 assert.match(buy,/discountPercent:dogLuckhouseDiscountPercent\(/);
 assert.match(buy,/return \{result:result\.result,replayed:result\.unchanged/);
});
test('edition-only API never handles or bypasses the original purchase',()=>{
 assert.doesNotMatch(edition,/buyScratchTicket\(/);
 assert.doesNotMatch(edition,/app\.post\(root\+'buy'/);
 assert.match(edition,/app\.post\(root\+variant,async\(req,res\)=>/);
 assert.match(edition,/app\.post\(root\+variant\+'\/edit'/);
 assert.match(edition,/current\.createdBy!==uid/);
 assert.match(edition,/current\.revision!==req\.body\.expectedRevision/);
});
