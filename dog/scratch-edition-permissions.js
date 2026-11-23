/**
 * Authoritative edition permissions shared by the hub and edition routes.
 * Browser-only developer preview (PIN 123 / dog-dev-active) is NEVER an
 * authorization credential. Only verified Firebase UIDs explicitly trusted
 * by the Render environment can edit or retire real communal print runs.
 */
const uidPattern=/^[A-Za-z0-9_-]{4,200}$/;
export function scratchUidAllowlist(input){
 const candidates=Array.isArray(input)?input:String(input||'').split(/[\s,;]+/);
 return new Set(candidates.filter(x=>typeof x==='string'&&uidPattern.test(x)));
}
export function createScratchEditionPermissionPolicy({
 scratchAdminUids=process.env.DOG_SCRATCH_ADMIN_UIDS||'',
 developerUids=process.env.DOG_DEVELOPER_UIDS||''
}={}){
 const administrators=scratchUidAllowlist(scratchAdminUids);
 const developers=scratchUidAllowlist(developerUids);
 const isDeveloper=uid=>typeof uid==='string'&&developers.has(uid);
 const canManage=uid=>typeof uid==='string'&&(administrators.has(uid)||isDeveloper(uid));
 // Registered developers can manage older print runs made by another
 // creator. Ordinary scratch administrators keep creator-only edit rules.
 const canEdit= (uid,creatorUid)=>canManage(uid)&&
  (uid===creatorUid||isDeveloper(uid));
 return Object.freeze({isDeveloper,canManage,canEdit});
}
