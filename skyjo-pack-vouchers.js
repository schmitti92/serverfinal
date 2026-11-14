// Award SKYJO Monster Slot DOG pack prizes as redeemable vouchers.
// Existing DOG Season 2 pack opening consumes freeChristmasPacks, so this
// inventory is compatible with the original reveal animation and NEW labels.
export const SKYJO_PACK_IDS=Object.freeze(['small','large','premium','platinum']);
export function skyjoPackVoucherBalances(raw={}){
 return Object.fromEntries(SKYJO_PACK_IDS.map(id=>{
  const n=raw?.[id]??0;
  if(!Number.isSafeInteger(n)||n<0||n>1000000)throw Error('SKYJO_PACK_BALANCE_INVALID');
  return [id,n];
 }));
}
export function creditSkyjoPackVouchers(existing={},prizes=[]){
 const next=skyjoPackVoucherBalances(existing);
 for(const prize of prizes){
  if(prize.kind!=='pack')continue;
  if(!SKYJO_PACK_IDS.includes(prize.id)||!Number.isSafeInteger(prize.quantity)||prize.quantity<1||prize.quantity>3)
   throw Error('SKYJO_PACK_INVALID');
  const sum=next[prize.id]+prize.quantity;
  if(sum>1000000)throw Error('SKYJO_PACK_BALANCE_LIMIT');
  next[prize.id]=sum;
 }
 return next;
}
