import test from 'node:test';
import assert from 'node:assert/strict';
import {
 SCRATCH_GRID_VARIANTS,SCRATCH_VARIANT_IDS,
 evaluateScratchGrid,generateScratchGrid,validateScratchGrid,
 attachScratchPrizes,verifyScratchPrizes
} from '../dog/christmas-scratch-grid.js';

const fixtures=Object.freeze([
 ['gifts',9],['snow',16],['stars',12],['elf',20],['reindeer',12],
 ['candy',6],['tree',15],['cookie',16],['diamond',9],['bells',20]
]);

test('all ten unique scratch game variants are registered with their sizes and rules',()=>{
 assert.equal(SCRATCH_VARIANT_IDS.length,10);
 assert.equal(new Set(SCRATCH_VARIANT_IDS).size,10);
 for(const [id,count] of fixtures){
  assert.equal(SCRATCH_GRID_VARIANTS[id].cellCount,count);
  assert.ok(SCRATCH_GRID_VARIANTS[id].rule.length>15);
 }
});
for(const [id,cellCount] of fixtures){
 for(let expected=0;expected<=3;expected++){
  test(id+': '+expected+' visible winning combination(s)',()=>{
   for(let round=0;round<100;round++){
    const board=generateScratchGrid(id,expected);
    assert.equal(board.cells.length,cellCount);
    assert.ok(validateScratchGrid(board,expected));
    const evaluated=evaluateScratchGrid({variantId:id,cells:board.cells});
    assert.equal(evaluated.length,expected);
    assert.deepEqual(board.wins,evaluated);
    for(const line of evaluated){
     assert.ok(line.indices.length>=2);
     assert.ok(line.indices.every(i=>i>=0&&i<cellCount));
    }
    const prizes=Array.from({length:expected},(_,i)=>(
     i%2===0?{type:'coins',amount:300+i}:{type:'unlock',prize:{unlockId:'cosmetic-'+i,name:'Prize '+i}}
    ));
    const paid=attachScratchPrizes(board,prizes);
    assert.ok(verifyScratchPrizes(paid));
    if(expected>0){
     const forged={...paid,wins:paid.wins.map(w=>({...w}))};
     forged.wins[0]={...forged.wins[0],indices:[999]};
     assert.equal(verifyScratchPrizes(forged),false);
     assert.equal(validateScratchGrid(paid,expected),false,'annotated board requires separately verified payout binding');
    }
   }
  });
 }
}
test('invalid variant, invalid count, and malformed payout are rejected',()=>{
 assert.throws(()=>generateScratchGrid('not-real',1),/SCRATCH_GRID_REQUEST_INVALID/);
 assert.throws(()=>generateScratchGrid('gifts',4),/SCRATCH_GRID_REQUEST_INVALID/);
 assert.equal(validateScratchGrid({variantId:'gifts',cells:['🎁']},0),false);
 assert.throws(()=>attachScratchPrizes(generateScratchGrid('gifts',1),[]),/SCRATCH_PRIZE_MATCH_MISMATCH/);
 assert.throws(()=>attachScratchPrizes(generateScratchGrid('gifts',1),[{type:'coins',amount:-1}]),/SCRATCH_PRIZE_COINS_INVALID/);
});
