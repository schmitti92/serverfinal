/**
 * Passive 10-minute DOG Firestore budget comparison for live Render health.
 *
 * This summarizes ALREADY COLLECTED server SDK counters. It does not issue
 * Firebase reads or writes and must never claim to represent billed usage:
 * an SDK GET attempt may be retried, a watch notification is not identical
 * to a billed document read, and client/other-game traffic is excluded.
 *
 * No private values (UIDs, room codes, hands, tokens) enter this report.
 */
const nonNegative=n=>Number.isSafeInteger(n)&&n>=0?n:0;
const ratio=(numerator,denominator)=>
 denominator>0?Math.round(numerator*100/denominator)/100:null;
const empty=()=>({});

export function dogFirebaseBudgetSummary({
  writes,reads,roomCollection='spielesammlung_hub_v1'
}={}){
 const writeTotals=writes&&typeof writes==='object'?writes:empty();
 const readTotals=reads&&typeof reads==='object'?reads:empty();
 const byCollection=writeTotals.byCollection||empty();
 const match=writeTotals.byKind?.['dog-match']||empty();
 const roomWrites=nonNegative(byCollection[roomCollection]);
 const writeCalls=nonNegative(writeTotals.writeCalls);
 const nonRoomWrites=Math.max(0,writeCalls-roomWrites);
 const committedMatchOperations=nonNegative(match.transactions);
 const normalMoveWriteCalls=nonNegative(match.writeCalls);
 const transactionGetAttempts=nonNegative(readTotals.transactionGetAttempts);
 const httpRoomGetResults=nonNegative(readTotals.httpRoomGetResults);
 const watchNotifications=nonNegative(readTotals.watchNotifications);
 const totalReadSignals=transactionGetAttempts+httpRoomGetResults+watchNotifications;
 // This is NOT a billed-read percentage. It divides raw SDK attempts
 // by the subset of successful DOG match mutations, for diagnosis only.
 const load={
  writeCalls,
  roomWrites,
  nonRoomWrites,
  dogMatchCommittedOperations:committedMatchOperations,
  dogMatchWriteCalls:normalMoveWriteCalls,
  noOpMutations:nonNegative(writeTotals.noops),
  transactionGetAttempts,
  httpRoomGetResults,
  watchNotifications,
  totalReadSignals
 };
 const writeLevel=writeCalls>=500?'critical':writeCalls>=100?'elevated':'normal';
 const readLevel=totalReadSignals>=2500?'critical':
  totalReadSignals>=500?'elevated':'normal';
 const severity=writeLevel==='critical'||readLevel==='critical'?'critical':
  writeLevel==='elevated'||readLevel==='elevated'?'elevated':'normal';
 return {
  windowMinutes:10,
  status:writeCalls===0&&totalReadSignals===0?'no-observed-dog-traffic':
   severity,
  ...load,
  sdkTransactionGetsPerCommittedDogMatchOperation:
   ratio(transactionGetAttempts,committedMatchOperations),
  roomWritesPerCommittedDogMatchOperation:
   ratio(roomWrites,committedMatchOperations),
  warning:{
   level:severity,writeLevel,readLevel,
   // Alerts are deliberately operational thresholds, not free quota
   // percentages. Verify Firebase billing separately.
   triggerWriteCalls10m:500,
   triggerReadSignals10m:2500
  },
  measurement:'Server SDK writes/GET attempts plus watch notifications; excludes other services, direct client Firebase activity and actual billed reads',
  billingVerified:false
 };
}
