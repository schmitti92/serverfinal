import test from 'node:test';
import assert from 'node:assert/strict';
import {
 SCRATCH_GRID_VARIANTS,SCRATCH_VARIANT_IDS,SCRATCH_ARCHIVED_VARIANT_IDS,SCRATCH_VARIANT_IDS_BY_TIER,
 evaluateScratchGrid,generateScratchGrid,validateScratchGrid,
 attachScratchPrizes,verifyScratchPrizes
} from '../dog/christmas-scratch-grid.js';

const fixtures=Object.freeze([
 ['gifts',9],['snow',16],['snow_collect',16],['stars',12],['elf',20],['reindeer',12],
 ['candy',6],['tree',15],['cookie',16],['diamond',9],['bells',20]
]);

test('seven active scratch games by tier; archived tickets remain valid',()=>{
 assert.deepEqual(SCRATCH_VARIANT_IDS,['gifts','snow_collect','elf','premium_27','tic_tac_toe','number_one_20','dog_jackpot_9']);
 assert.equal(new Set(SCRATCH_VARIANT_IDS).size,7);
 assert.equal(Object.keys(SCRATCH_GRID_VARIANTS).length,15);
 assert.deepEqual(SCRATCH_VARIANT_IDS_BY_TIER,{
  simple:['gifts','snow_collect'],
  medium:['elf','tic_tac_toe','number_one_20'],
  premium:['premium_27','dog_jackpot_9']
 });
 assert.deepEqual(SCRATCH_ARCHIVED_VARIANT_IDS,
  ['snow','stars','reindeer','candy','tree','cookie','diamond','bells']);
 for(const [id,count] of fixtures){
  assert.equal(SCRATCH_GRID_VARIANTS[id].cellCount,count);
  assert.ok(SCRATCH_GRID_VARIANTS[id].rule.length>15);
 }
});
test('new snow bingo wins with ANY three matching symbols, not lines, and ice blanks never count',()=>{
 const cells=['❄️','🧊','🎁','🎄',
  '🔔','❄️','🧊','⭐',
  '🎄','🧊','❄️','🎁',
  '🧊','⭐','🎄','🔔'];
 const wins=evaluateScratchGrid({variantId:'snow_collect',cells});
 assert.equal(wins.length,2); // three ❄️ and three 🎄, anywhere
 assert.deepEqual(new Set(wins.map(w=>w.symbol)),new Set(['❄️','🎄']));
 assert.ok(wins.every(w=>w.rule==='three-anywhere'&&w.indices.length===3));
 const ice=Array.from({length:16},()=> '🧊');
 assert.equal(evaluateScratchGrid({variantId:'snow_collect',cells:ice}).length,0);
 const oldBoard=generateScratchGrid('snow',1);
 assert.equal(evaluateScratchGrid(oldBoard).length,1,'legacy four-in-a-row rule remains intact');
});
test('medium elf paths join only orthogonal neighbors and may wind across rows',()=>{
 const alternating=Array.from({length:20},(_,i)=>i%5%2===0?'🎁':'⭐');
 const zigzag=[0,1,6,7,12,13,14];
 for(const index of zigzag)alternating[index]='🍪';
 const revealed=evaluateScratchGrid({variantId:'elf',cells:alternating});
 assert.equal(revealed.length,1);
 assert.equal(revealed[0].symbol,'🍪');
 assert.deepEqual(revealed[0].indices,zigzag);
 assert.equal(revealed[0].indices[0]%5,0);
 assert.equal(revealed[0].indices.at(-1)%5,4);
 const diagonal=Array.from({length:20},(_,i)=>i%5%2===0?'🎁':'⭐');
 for(const index of [0,6,12,18,19])diagonal[index]='🍪';
 assert.equal(evaluateScratchGrid({variantId:'elf',cells:diagonal}).length,0,
  'diagonally touching symbols cannot complete a path');
 let curved=0;
 for(let n=0;n<150;n++){
  const board=generateScratchGrid('elf',1);
  const win=evaluateScratchGrid(board)[0];
  assert.equal(win.indices[0]%5,0);
  assert.equal(win.indices.at(-1)%5,4);
  for(let j=1;j<win.indices.length;j++){
   const a=win.indices[j-1],b=win.indices[j];
   assert.equal(Math.abs(Math.floor(a/5)-Math.floor(b/5))+
    Math.abs(a%5-b%5),1,'each path step uses a directly neighboring cell');
  }
  if(new Set(win.indices.map(i=>Math.floor(i/5))).size>1)curved++;
 }
 assert.ok(curved>0,'medium generator must create winding paths, not only straight rows');
});

test('premium card is 9 rows by 3, and 24 symbols count for both milestones',()=>{
 assert.equal(SCRATCH_GRID_VARIANTS.premium_27.cellCount,27);
 const twenty=Array(27).fill('🧊');
 for(let i=0;i<20;i++)twenty[i]=i%3===2?'⭐':'🎁';
 const gold=evaluateScratchGrid({variantId:'premium_27',cells:twenty});
 assert.ok(gold.some(w=>w.rule==='gold-20'));
 assert.ok(!gold.some(w=>w.rule==='premium-24'));
 const twentyFour=Array(27).fill('🧊');
 for(let i=0;i<24;i++)twentyFour[i]=i%3===2?'⭐':'🎁';
 const premium=evaluateScratchGrid({variantId:'premium_27',cells:twentyFour});
 assert.equal(premium.length,2);
 assert.deepEqual(premium.map(w=>w.rule),['gold-20','premium-24']);
 const row=Array(27).fill('🧊');row[3]='🎁';row[4]='🎁';row[5]='🎁';
 assert.deepEqual(evaluateScratchGrid({variantId:'premium_27',cells:row}).map(w=>w.rule),['row-3']);
 assert.equal(evaluateScratchGrid({variantId:'premium_27',cells:Array(27).fill('🧊')}).length,0);
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
