/* DOG room color reservations. Pure mapping: each human chooses their own
 * red/blue/green/yellow seat. Unassigned humans fill remaining seats in
 * their original order; unoccupied slots become DOG computer players. */
export const DOG_LOBBY_COLORS=Object.freeze(['red','blue','green','yellow']);
export function dogLobbySeats(players){
 const seats=Array(4).fill(null),unassigned=[];
 for(const player of players){
  const desired=DOG_LOBBY_COLORS.indexOf(player?.colorPref);
  if(desired!==-1&&!seats[desired])seats[desired]=player;
  else unassigned.push(player);
 }
 for(let i=0;i<seats.length;i++)if(!seats[i]&&unassigned.length)seats[i]=unassigned.shift();
 if(unassigned.length)throw Error('DOG_LOBBY_TOO_MANY_PLAYERS');
 return seats;
}
