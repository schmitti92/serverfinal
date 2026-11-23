import test from 'node:test';
import assert from 'node:assert/strict';
import {scratchUidAllowlist,createScratchEditionPermissionPolicy}
 from '../dog/scratch-edition-permissions.js';

test('DOG: developer accounts authorized by their verified UID receive all edition rights',()=>{
 const policy=createScratchEditionPermissionPolicy({
  scratchAdminUids:'original_admin',
  developerUids:'developer_one,developer_two'
 });
 for(const uid of ['developer_one','developer_two']){
  assert.equal(policy.isDeveloper(uid),true);
  assert.equal(policy.canManage(uid),true);
  assert.equal(policy.canEdit(uid,'original_admin'),true);
  assert.equal(policy.canEdit(uid,'unrelated_creator'),true);
 }
 // Old scratch admins remain creators-only, unless promoted as developer.
 assert.equal(policy.canManage('original_admin'),true);
 assert.equal(policy.canEdit('original_admin','original_admin'),true);
 assert.equal(policy.canEdit('original_admin','unrelated_creator'),false);
});
test('DOG: the local preview, its PIN and a username cannot grant server privileges',()=>{
 const policy=createScratchEditionPermissionPolicy({
  scratchAdminUids:[],developerUids:['trusted_developer']
 });
 for(const uid of [undefined,null,'','Chris','123','dog-dev-active','trusted_developer2']){
  assert.equal(policy.canManage(uid),false);
  assert.equal(policy.canEdit(uid,'trusted_developer'),false);
 }
 assert.equal(policy.canEdit('trusted_developer','other_creator'),true);
 const closed=createScratchEditionPermissionPolicy({
  scratchAdminUids:'',developerUids:''
 });
 assert.equal(closed.canManage('trusted_developer'),false);
});
test('DOG: malformed or duplicate UIDs never enter the privileged allowlist',()=>{
 const result=scratchUidAllowlist('dev_one;dev_one,dev_two invalid.email $foo');
 assert.deepEqual([...result].sort(),['dev_one','dev_two']);
});

test('DOG: separate Chris UID grant adds full developer powers without removing existing permissions',()=>{
 const policy=createScratchEditionPermissionPolicy({
  scratchAdminUids:'other_admin',
  developerUids:'existing_developer',
  chrisDeveloperUid:'chris_verified_uid_123'
 });
 assert.equal(policy.canManage('chris_verified_uid_123'),true);
 assert.equal(policy.canEdit('chris_verified_uid_123','unrelated_creator'),true);
 assert.equal(policy.canEdit('existing_developer','unrelated_creator'),true);
 assert.equal(policy.canManage('other_admin'),true);
 assert.equal(policy.canEdit('other_admin','unrelated_creator'),false);
 const invalid=createScratchEditionPermissionPolicy({
  scratchAdminUids:'',developerUids:'',chrisDeveloperUid:'not valid uid'
 });
 assert.equal(invalid.canManage('not valid uid'),false);
});
