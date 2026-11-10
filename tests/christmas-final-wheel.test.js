import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {drawFinalWinnerPack,FINAL_WINNER_PACK_ODDS} from '../christmas-final-wheel.js';

test('the winner wheel contains exactly 70 Gold, 30 Premium and no normal packages',()=>{
 assert.deepEqual(FINAL_WINNER_PACK_ODDS,{premium:30,large:70,small:0});
 let gold=0,premium=0;
 for(let roll=0;roll<100;roll++){
  const id=drawFinalWinnerPack(max=>{assert.equal(max,100);return roll});
  if(id==='premium')premium++;
  else if(id==='large')gold++;
  else assert.fail('normal package is forbidden for a winner: '+id);
 }
 assert.equal(premium,30);
 assert.equal(gold,70);
 assert.equal(drawFinalWinnerPack(()=>29),'premium');
 assert.equal(drawFinalWinnerPack(()=>30),'large');
 assert.equal(drawFinalWinnerPack(()=>99),'large');
});

test('rejects invalid rolls rather than quietly awarding wrong prize',()=>{
 for(const value of [-1,100,1.5,NaN])assert.throws(()=>drawFinalWinnerPack(()=>value),/INVALID_FINAL_PACK_ROLL/);
});

test('only the final winner changes; 1-cent and banker rewards retain their rules',()=>{
 const api=readFileSync(new URL('../deal-or-no-deal-api.js',import.meta.url),'utf8');
 assert.match(api,/import \{drawFinalWinnerPack\} from '\.\/christmas-final-wheel\.js'/);
 const final=api.slice(api.indexOf("if(before.phase!=='final'&&after.phase==='final')"));
 assert.match(final,/const finalPackId=drawFinalWinnerPack\(\),pack=CHRISTMAS_PACKS\.find\(p=>p\.id===finalPackId\)/);
 assert.doesNotMatch(final,/CHRISTMAS_PACKS\.find\(p=>p\.id===drawFinalWinnerPack\(\)\)/,
  'never reroll once per catalog item — must draw just once for correct odds');
 assert.match(final,/packName:pack\.id==='large'\?'Gold-Kartenpaket':pack\.name/);
 assert.doesNotMatch(final,/roll<60\?'large':'small'/);
 const oneCent=api.slice(api.indexOf('const openedOneCent'),api.indexOf('// A Christmas pack is included in a banker offer'));
 assert.match(oneCent,/roll<10\?'premium':roll<60\?'large':'small'/);
});
