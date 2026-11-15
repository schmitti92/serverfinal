import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DOG_META_ALBUM_MILESTONES,dogMetaAlbumStatus} from '../dog-meta-album.js';
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('nine Christmas meta pictures map onto existing claimed DOG bingo rewards at 2..18',()=>{
 assert.deepEqual(DOG_META_ALBUM_MILESTONES.map(m=>m.at),[2,4,6,8,10,12,14,16,18]);
 assert.equal(new Set(DOG_META_ALBUM_MILESTONES.map(m=>m.id)).size,9);
 assert.equal(new Set(DOG_META_ALBUM_MILESTONES.map(m=>m.unlockId)).size,9);
 assert.deepEqual(DOG_META_ALBUM_MILESTONES.map(m=>m.unlockId),
  Array.from({length:9},(_,n)=>'meta:christmas1:picture:'+String(n+1).padStart(2,'0')));
});
test('no pictures unlock just because Bingo progress was reached; existing claim grants them',()=>{
 let result=dogMetaAlbumStatus(18,{});
 assert.equal(result.unlockedCount,0);
 assert.deepEqual(result.milestones.map(m=>m.state),Array(9).fill('ready'));
 result=dogMetaAlbumStatus(18,{'2':111,'4':222,'6':333});
 assert.equal(result.unlockedCount,3);
 assert.equal(result.unlockedIds.length,3);
 assert.equal(result.milestones[3].state,'ready');
 assert.equal(result.nextAt,8);
});
test('claimed bingo rewards stay unlocked when current bingo count changes or account reopens',()=>{
 const claims=Object.fromEntries(Array.from({length:9},(_,i)=>[String((i+1)*2),1700000000000+i]));
 const status=dogMetaAlbumStatus(0,claims);
 assert.equal(status.unlockedCount,9);
 assert.deepEqual(status.milestones.map(x=>x.state),Array(9).fill('unlocked'));
 assert.equal(status.nextAt,null);
 assert.equal(status.eventId,'weihnachtsevent-1');
 assert.equal(status.source,'dog-season-2-bingo-rewards');
 assert.equal(dogMetaAlbumStatus(40,claims).unlockedCount,9);
});
test('invalid claim receipts cannot produce unlocks',()=>{
 const result=dogMetaAlbumStatus(18,{'2':true,'4':'123','6':-1,'8':null,'10':12.3});
 assert.equal(result.unlockedCount,0);
 assert.equal(dogMetaAlbumStatus(Number.NaN,null).unlockedCount,0);
});
test('one authenticated GET reads the existing season-2 doc and performs no extra writes',()=>{
 const js=source('../dog-album-season2.js');
 const from=js.indexOf("app.get(base+'/meta-album',auth,");
 const to=js.indexOf("app.get(base+'/me',auth,",from);
 assert.ok(from>0&&to>from);
 const route=js.slice(from,to);
 assert.match(route,/db.collection\(DOG_S2_COLLECTION\)\.doc\(req\.dealIdentity\.uid\)\.get\(\)/);
 assert.doesNotMatch(route,/\.set\(|\.update\(|\.create\(|runTransaction\(/);
 assert.match(js,/metaAlbum:dogMetaAlbumStatus\(progress.bingos,claimed\)/);
});
