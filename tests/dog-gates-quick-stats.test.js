import test from 'node:test';
import assert from 'node:assert/strict';
import {dogGateFight} from '../dog-gates.js';
const base={people:{hero:{currentGate:1,highestGate:1,normals:[],minis:[],miniRewards:[],lastAttemptAt:0,lastResult:null}},sharedBosses:[]};
test('normal gate win includes server-owned combat summary with enemy HP zero',()=>{
 const result=dogGateFight(base,'hero',1,{levels:{weapon:1,armor:1}},()=>0,5000).result;
 assert.equal(result.win,true);
 assert.equal(result.combatStats.enemyRemainingHp,0);
 assert.equal(result.combatStats.enemyDamageTaken,result.combatStats.enemyMaxHp);
 assert.ok(result.combatStats.heroRemainingHp>0);
 assert.equal(result.combatStats.model,'single-roll-summary-v1');
});
test('normal gate loss has enemy HP remaining and hero defeated',()=>{
 const result=dogGateFight(base,'hero',1,{levels:{weapon:1,armor:1}},()=>9999,5000).result;
 assert.equal(result.win,false);
 assert.ok(result.combatStats.enemyRemainingHp>0);
 assert.equal(result.combatStats.heroRemainingHp,0);
});
