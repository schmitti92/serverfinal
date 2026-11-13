import test from 'node:test';
import assert from 'node:assert/strict';
import {DOG_S2_CARDS,dogS2Progress,dogS2CycleProgress,dogS2AdvanceCycles,
 dogS2OpenGrantedPacks,dogS2Duplicates} from '../dog-album-season2.js';

const first=()=>DOG_S2_CARDS.slice(0,16);
const fullBoard=()=>Object.fromEntries(first().map(card=>[card.id,1]));
test('DOG-only 16/16 completion resets the visible run but keeps the entire lifetime collection',()=>{
 const cards=fullBoard(),before={...cards,[first()[15].id]:0};
 const result=dogS2AdvanceCycles(before,cards,{},Date.UTC(2026,10,13));
 assert.equal(result.finished.length,1);
 assert.deepEqual(result.finished.map(c=>c.board),[1]);
 assert.equal(result.updates.superSlotTickets,1,'one five-reel ticket per full board');
 assert.equal(result.progress.boards[0].collected,0,'the completed board is empty in the new run');
 assert.equal(result.progress.boards[0].bingos,0);
 assert.equal(result.progress.boards[0].completions,1);
 assert.equal(result.progress.completedTotal,1);
 assert.equal(dogS2Progress(cards).boards[0].collected,16,'lifetime album is not erased');
 assert.equal(dogS2Duplicates(cards).available,0,'duplicates remain unchanged');
 const newCycle=dogS2CycleProgress({...cards,[first()[0].id]:2},result.updates);
 assert.equal(newCycle.boards[0].collected,1,'a previously owned card can be collected again');
 assert.equal(newCycle.boards[0].round,2);
 const repeated=dogS2AdvanceCycles(cards,cards,result.updates,Date.UTC(2026,10,13));
 assert.equal(repeated.finished.length,0,'same board cannot grant a second ticket on retry');
 assert.equal(repeated.updates.superSlotTickets,1);
});

test('repeatable DOG board produces exactly one more slot ticket and retains completion totals',()=>{
 const original=fullBoard(),firstCycle=dogS2AdvanceCycles({},original,{},Date.UTC(2026,10,13));
 const next=Object.fromEntries(Object.entries(original).map(([id,value])=>[id,value+1]));
 const repeated=dogS2AdvanceCycles(original,next,firstCycle.updates,Date.UTC(2026,10,13));
 assert.deepEqual(repeated.finished.map(f=>f.round),[2]);
 assert.equal(repeated.updates.superSlotTickets,2);
 assert.equal(repeated.progress.completedTotal,2);
 assert.equal(repeated.progress.boards[0].collected,0);
 assert.equal(dogS2Duplicates(next).available,16,'lifetime duplicates are not lost by reset');
 const ready=dogS2CycleProgress(original,{});
 assert.equal(ready.boards[0].readyToComplete,true,'full legacy board can be migrated by claim');
 const migrated=dogS2AdvanceCycles(original,original,{},Date.UTC(2026,10,13));
 assert.equal(migrated.finished.length,1,'full legacy board can collect its one-time transition ticket');
});

test('monthly points are server-computed from DOG cards, Bingo lines and complete 16-card boards only',()=>{
 const cards=fullBoard(),before={...cards,[first()[15].id]:0};
 const r=dogS2AdvanceCycles(before,cards,{},Date.UTC(2026,10,13));
 assert.equal(r.pointsAdded,22+3*15+200,'new legendary + completed row, column and diagonal + board completion');
 assert.equal(r.progress.tournament.month,'2026-11');
 assert.equal(r.progress.tournament.monthCompleted,1);
 const next=dogS2AdvanceCycles(cards,cards,r.updates,Date.UTC(2026,11,1));
 assert.equal(next.progress.tournament.month,'2026-12');
 assert.equal(next.progress.tournament.points,0,'month score resets in December');
 assert.equal(next.progress.tournament.lifetimePoints,r.pointsAdded,'all-time history remains');
 // The other Christmas/Hammer-Bingo collection is never passed to this engine.
 assert.ok(!Object.keys(r.updates).some(k=>/hammer|christmas/i.test(k)));
});

test('re-collected DOG cards are marked new within the current cycle while existing inventory stays untouched',()=>{
 const base=fullBoard();base[first()[0].id]=3;
 const lifetime={...base};
 const opened=dogS2OpenGrantedPacks('small',1,lifetime,()=>0,base);
 assert.equal(opened.openedPacks[0].revealed[0].isNew,true);
 assert.equal(opened.cards[first()[0].id],6);
});
