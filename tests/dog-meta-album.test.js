import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DOG_META_ALBUM_MILESTONES,dogMetaAlbumStatus} from '../dog-meta-album.js';
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('12 Christmas pictures have distinct permanent identities',()=>{
 assert.equal(DOG_META_ALBUM_MILESTONES.length,12);
 assert.equal(new Set(DOG_META_ALBUM_MILESTONES.map(m=>m.id)).size,12);
 assert.equal(new Set(DOG_META_ALBUM_MILESTONES.map(m=>m.unlockId)).size,12);
});
test('tree unlocks only at Lichtertal level 10, regardless of Bingo rewards',()=>{
 for(let level=0;level<=9;level++){
  const result=dogMetaAlbumStatus({highestTreeLevel:level});
  assert.equal(result.milestones[0].state,'locked');
  assert.equal(result.unlockedIds.includes('meta:christmas1:picture:01'),false);
 }
 assert.equal(dogMetaAlbumStatus({highestTreeLevel:10}).milestones[0].state,'unlocked');
});
test('four buildings each unlock their OWN image exclusively at level 5',()=>{
 for(const id of ['bakery','workshop','tower','inn']){
  const until4=dogMetaAlbumStatus({highestBuildingLevels:{[id]:4}});
  const at5=dogMetaAlbumStatus({highestBuildingLevels:{[id]:5}});
  const m=at5.milestones.find(x=>x.buildingId===id);
  assert.ok(m);
  assert.equal(until4.milestones.find(x=>x.buildingId===id).state,'locked');
  assert.equal(m.state,'unlocked');
  assert.equal(at5.unlockedCount,1);
  assert.equal(at5.unlockedIds[0],m.unlockId);
 }
});
test('seven further images stay locked until their own rules exist',()=>{
 const result=dogMetaAlbumStatus({
  highestTreeLevel:10,
  highestBuildingLevels:{bakery:5,workshop:5,tower:5,inn:5},
  bingos:60,bingoRewardsClaimed:{'2':1234,'4':1234}
 });
 assert.equal(result.unlockedCount,5);
 assert.equal(result.milestones.filter(m=>m.state==='locked').length,7);
 assert.equal(result.source,'dog-lichtertal-event');
 assert.equal(dogMetaAlbumStatus({highestTreeLevel:'10',highestBuildingLevels:{inn:'5'}}).unlockedCount,0);
});
test('only authoritative, read-only Lichtertal world storage feeds the meta album route',()=>{
 const server=source('../dog-album-season2.js');
 const start=server.indexOf("app.get(base+'/meta-album',auth,");
 const end=server.indexOf("app.get(base+'/me',auth,",start);
 assert.ok(start>=0&&end>start);
 const route=server.slice(start,end);
 assert.match(route,/db.collection\('dog_lichtertal_world_v1'\).doc\('main'\).get\(\)/);
 assert.doesNotMatch(route,/\.set\(|\.update\(|runTransaction\(/);
 assert.doesNotMatch(route,/req\.body|req\.query|bingoRewardsClaimed/);
});
