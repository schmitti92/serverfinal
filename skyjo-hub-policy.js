export function validHubSkyjoState(next,previous,seat){
  if(!next||next.kind!=='skyjo-room-v2'||next.version!==2||!next.lobby||!Array.isArray(next.lobby.players))return false;
  const expect=seat.members;
  if(next.lobby.players.length!==expect.length||next.lobby.hostId!=='hub_'+seat.hostUid)return false;
  if(next.lobby.players.some((p,i)=>p.id!=='hub_'+expect[i].uid||p.name!==expect[i].name))return false;
  if(JSON.stringify(next.lobby.settings)!==JSON.stringify(seat.settings))return false;
  if(!previous||previous.kind!=='skyjo-room-v2')return false;
  // No in-game player may recreate the lobby, modify seats, or reset a hub match.
  if(previous.game&&!next.game)return false;
  if(previous.lobby.status==='playing'&&next.lobby.status!=='playing')return false;
  if(previous.lobby.status==='lobby'){
    if(!seat.host||next.lobby.status!=='playing'||next.game?.version!==1)return false;
    if(next.game?.players?.length!==expect.length||next.game.players.some((p,i)=>p.name!==expect[i].name))return false;
  }
  if(previous.lobby.status==='playing'&&(!next.game||next.lobby.status!=='playing'))return false;
  return true;
}
