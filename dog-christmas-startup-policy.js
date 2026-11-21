/** When a known, read-only Christmas-reset safety preflight blocks, start the
 * application without modifying any event data. Keep the one-time reset
 * scheduled for a later deliberate launch, rather than blocking all API
 * upgrades. Unknown errors (including transaction failures) still abort.
 */
export function deferChristmasResetOnSafePreflight(err){
 const message=typeof err?.message==='string'?err.message:'';
 return message==='CHRISTMAS_RESET_TOO_MANY_ROOMS' ||
  message==='CHRISTMAS_RESET_TOO_MANY_LIVE_DOG_ROOMS' ||
  /^CHRISTMAS_RESET_TOO_MANY_DOCUMENTS_[0-9]+$/.test(message) ||
  /^CHRISTMAS_RESET_UNSUPPORTED_EDITION_[a-z0-9_]+$/.test(message) ||
  message==='CHRISTMAS_RESET_DOG_MATCH_ACTIVE';
}
