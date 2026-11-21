import test from 'node:test';
import assert from 'node:assert/strict';
import {deferChristmasResetOnSafePreflight} from '../dog-christmas-startup-policy.js';

test('known no-write safety preflights defer a Christmas reset without disabling the game API',()=>{
 assert.equal(deferChristmasResetOnSafePreflight(new Error('CHRISTMAS_RESET_TOO_MANY_ROOMS')),true);
 assert.equal(deferChristmasResetOnSafePreflight(new Error('CHRISTMAS_RESET_TOO_MANY_LIVE_DOG_ROOMS')),true);
 assert.equal(deferChristmasResetOnSafePreflight(new Error('CHRISTMAS_RESET_TOO_MANY_DOCUMENTS_181')),true);
});
test('database, inconsistent marker, active match and unexpected errors still prevent unsafe startup',()=>{
 for(const value of ['CHRISTMAS_RESET_FIRESTORE_REQUIRED','CHRISTMAS_RESET_MARKER_INCONSISTENT',
  'CHRISTMAS_RESET_DOG_MATCH_ACTIVE','CHRISTMAS_RESET_TOO_MANY_DOCUMENTS',
  'CHRISTMAS_RESET_TOO_MANY_DOCUMENTS_abc','FIRESTORE_PERMISSION_DENIED']){
  assert.equal(deferChristmasResetOnSafePreflight(new Error(value)),false,value);
 }
 assert.equal(deferChristmasResetOnSafePreflight(null),false);
});
