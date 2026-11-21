/**
 * Read-only statistics projected for players in one authenticated DOG room.
 * Only authenticated room membership is allowed by the route. The response
 * never includes profile UIDs or the account's financial/private wallet data.
 * Accumulated scratch progress was not kept for all historical tickets:
 * historical gaps are explicitly flagged instead of inventing exact totals.
 */
import {dogPlayerStats} from './player-stats.js';
import {dogScratchStatus} from './christmas-scratch.js';

const count=n=>Number.isSafeInteger(n)&&n>=0?n:0;
const displayName=s=>String(s||'Spieler').replace(/[<>\u0000-\u001f\u007f]/g,'').trim().slice(0,28)||'Spieler';
const goodDoc=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};

export function christmasLeaderboardRow(member,statsRaw,scratchRaw,treeRaw,viewerUid,index){
 const stats=dogPlayerStats(statsRaw,member.uid);
 const wallet=dogScratchStatus(scratchRaw);
 const progress=wallet.progress||{};
 const tree=goodDoc(treeRaw);
 const treeClaims=goodDoc(tree.claims);
 const levelClaims=goodDoc(wallet.levelRewardClaims);
 const scratchWins=count(progress.winTickets);
 const counted=count(progress.tracked);
 const tickets=count(progress.opened);
 const unclassified=Math.max(count(progress.olderUnclassified),tickets-counted);
 const prizesFromScratch=count(progress.unlocks);
 const treeRewards=Object.values(treeClaims).filter(x=>x&&typeof x==='object'&&x.claimedAt).length;
 const levelRewards=Object.values(levelClaims).filter(Boolean).length;
 return {
  key:index+1,name:displayName(member.name),you:member.uid===viewerUid,
  dog:{played:stats.played,wins:stats.wins,losses:Math.max(0,stats.played-stats.wins),
   winRate:stats.played?Math.round(1000*stats.wins/stats.played)/10:0,
   knockedOut:stats.knockedOut,wasKnockedOut:stats.wasKnockedOut},
  scratch:{opened:tickets,verifiedFrom:counted,winTickets:scratchWins,
   losingTickets:count(progress.duds),coinsWon:count(progress.coinsWon),
   lightsWon:count(progress.lightsWon),olderUnclassified:unclassified,
   incomplete:unclassified>0},
  rewards:{scratchUnlocks:prizesFromScratch,treeClaims:treeRewards,
   levelClaims:levelRewards,total:prizesFromScratch+treeRewards+levelRewards,
   incomplete:unclassified>0}
 };
}
export function christmasLeaderboard(members,raws,viewerUid){
 const players=members.map((m,i)=>christmasLeaderboardRow(
  m,raws[i]?.stats,raws[i]?.scratch,raws[i]?.tree,viewerUid,i
 ));
 const ranking=[...players].sort((a,b)=>b.dog.wins-a.dog.wins||
  b.dog.winRate-a.dog.winRate||b.dog.played-a.dog.played||
  a.name.localeCompare(b.name,'de'));
 return {
  scope:'room-participants',tracking:'completed-dog-online-matches',
  note:'Rubbellos- und Belohnungszahlen können bei älteren Tickets nur Mindestwerte sein.',
  players:players.map(row=>({...row,rank:ranking.indexOf(row)+1})),
  totals:{participants:players.length,played:players.reduce((n,p)=>n+p.dog.played,0),
   wins:players.reduce((n,p)=>n+p.dog.wins,0),
   winningTickets:players.reduce((n,p)=>n+p.scratch.winTickets,0),
   rewards:players.reduce((n,p)=>n+p.rewards.total,0)}
 };
}
