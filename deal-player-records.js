// Lifetime Deal or No Deal and cash-only Slot prize records.
// Stored on the same wallet document as a paid payout: zero extra documents,
// zero additional settlement writes and strict receipt-based idempotency.
export const DEAL_JACKPOT_CENTS=5_000_000_000; // Highest base-case payout: €50m.
export const SLOT_JACKPOT_CENTS=500_000_000; // One Slot reel: €5m.
const natural=value=>Number.isSafeInteger(value)&&value>=0?value:0;
const validMoney=value=>Number.isSafeInteger(value)&&value>=0;
function addRecords(previous={},amounts=[],jackpot){
 const record=previous&&typeof previous==='object'&&!Array.isArray(previous)?previous:{};
 const oldMin=validMoney(record.minCents)?record.minCents:null;
 const oldMax=validMoney(record.maxCents)?record.maxCents:null;
 const prizes=amounts.filter(validMoney);
 if(prizes.length!==amounts.length)throw Error('INVALID_RECORD_PAYOUT');
 if(!prizes.length)return {...record,
  count:natural(record.count),minCents:oldMin,maxCents:oldMax,jackpots:natural(record.jackpots)};
 const lowest=Math.min(...prizes),highest=Math.max(...prizes);
 return {count:natural(record.count)+prizes.length,
  minCents:oldMin===null?lowest:Math.min(oldMin,lowest),
  maxCents:oldMax===null?highest:Math.max(oldMax,highest),
  jackpots:natural(record.jackpots)+prizes.filter(amount=>amount===jackpot).length};
}
export function addDealRecord(wallet={},basePayout){
 if(!validMoney(basePayout)||basePayout>DEAL_JACKPOT_CENTS)throw Error('INVALID_DEAL_RECORD');
 return addRecords(wallet.dealPrizeStats,[basePayout],DEAL_JACKPOT_CENTS);
}
export function addSlotMoneyRecords(wallet={},cashAmounts=[]){
 if(!Array.isArray(cashAmounts)||cashAmounts.some(n=>!validMoney(n)||n>SLOT_JACKPOT_CENTS))
  throw Error('INVALID_SLOT_RECORD');
 return addRecords(wallet.slotCashPrizeStats,cashAmounts,SLOT_JACKPOT_CENTS);
}
export function viewPrizeRecord(value){
 const record=value&&typeof value==='object'?value:{};
 return {count:natural(record.count),
  minCents:validMoney(record.minCents)?record.minCents:null,
  maxCents:validMoney(record.maxCents)?record.maxCents:null,
  jackpots:natural(record.jackpots)};
}
