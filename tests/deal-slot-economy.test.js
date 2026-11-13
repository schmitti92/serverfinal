import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_DEAL_ECONOMY,normalizeDealEconomy,validateDealEconomy} from '../deal-economy.js';
import {MONSTER_SLOTS_WEIGHTS,slotCashChance,drawMonsterSlot} from '../monster-slots.js';

const valid=()=>({prices:{...DEFAULT_DEAL_ECONOMY.prices},slotWeights:{...MONSTER_SLOTS_WEIGHTS},
 doubleBoostEnabled:true,packsEnabled:true});
test('old settings documents and old host payloads retain a safe default slot weighting',()=>{
 const previous=normalizeDealEconomy({prices:{...DEFAULT_DEAL_ECONOMY.prices}});
 assert.deepEqual(previous.slotWeights,MONSTER_SLOTS_WEIGHTS);
 const oldClient=valid();delete oldClient.slotWeights;
 assert.equal(validateDealEconomy(oldClient).slotWeights,null);
 assert.equal(slotCashChance(previous.slotWeights),2/3);
});
test('host may set any positive distribution of independent slot categories',()=>{
 const input=valid();input.slotWeights={cash:650,chest:0,pack:1,hammer:2,joker:0,minigame:0,monster:0};
 const posted=validateDealEconomy(input);
 assert.deepEqual(posted.slotWeights,input.slotWeights);
 assert.equal(normalizeDealEconomy(posted).slotWeights.cash,650);
 assert.equal(drawMonsterSlot(1,()=>0,{cash:1,chest:0,pack:0,hammer:0,joker:0,minigame:0,monster:0}).kind,'cash');
});
test('invalid or empty odds cannot be stored by a host',()=>{
 for(const invalid of [
  {...valid(),slotWeights:{...MONSTER_SLOTS_WEIGHTS,cash:-1}},
  {...valid(),slotWeights:{...MONSTER_SLOTS_WEIGHTS,cash:10001}},
  {...valid(),slotWeights:{...MONSTER_SLOTS_WEIGHTS,hammer:3.5}},
  {...valid(),slotWeights:Object.fromEntries(Object.keys(MONSTER_SLOTS_WEIGHTS).map(k=>[k,0]))},
  {...valid(),slotWeights:{cash:100}},
  {...valid(),slotWeights:[]}
 ])assert.throws(()=>validateDealEconomy(invalid),/INVALID_SLOT_WEIGHTS/);
});
test('stored malformed odds fall back instead of breaking slot claims',()=>{
 const s=normalizeDealEconomy({slotWeights:{cash:-5}});
 assert.deepEqual(s.slotWeights,MONSTER_SLOTS_WEIGHTS);
});
