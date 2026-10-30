// Fallende Gegenstaende: isolated, RAM-only WebSocket multiplayer. No Firebase reads.
import { randomInt } from "node:crypto";
export function installFallingOnline(app) {
 const rooms=new Map();
 const send=(ws,msg)=>{if(ws?.readyState===1)ws.send(JSON.stringify(msg))};
 const broadcast=(r,msg)=>r.players.forEach(p=>send(p.ws,msg));
 const view=r=>({type:"state",code:r.code,round:r.round,phase:r.phase,players:r.players.map(p=>({seat:p.seat,name:p.name,score:p.score,stops:p.stops,connected:p.ws?.readyState===1})),startAt:r.startAt,duration:r.duration});
 const emit=r=>broadcast(r,view(r));
 const cleanup=r=>{clearTimeout(r.timer);rooms.delete(r.code)};
 const next=r=>{
  clearTimeout(r.timer);r.round++;if(r.round>5){r.phase="finished";emit(r);return}
  r.phase="countdown";r.players.forEach(p=>p.stops=null);r.startAt=Date.now()+3000;r.duration=[4000,3300,3700,3000,3500][r.round-1];emit(r);
  r.timer=setTimeout(()=>{r.phase="fall";emit(r);r.timer=setTimeout(()=>end(r),r.duration+450)},3000);
 };
 const end=r=>{
  if(r.phase!=="fall")return;
  r.phase="result";
  for(const p of r.players){if(p.stops===null){p.stops=100;p.score=Math.round((p.score+100)*10)/10}}
  emit(r);r.timer=setTimeout(()=>next(r),3300);
 };
 app.get("/falling-health",(_req,res)=>res.json({ok:true,rooms:rooms.size}));
 setInterval(()=>{for(const r of rooms.values())if(Date.now()-r.updated>3600000)cleanup(r)},60000).unref();
 return ws=>{
  let room=null,player=null;
  const error=message=>send(ws,{type:"error",message});
  ws.on("message",raw=>{
   let m;try{m=JSON.parse(String(raw))}catch{return}
   if(m.type==="create"){
    if(room)return error("Bereits im Raum");
    let code;do{code=String(randomInt(100000,1000000))}while(rooms.has(code));
    room={code,players:[],round:0,phase:"lobby",startAt:0,duration:0,timer:null,updated:Date.now()};rooms.set(code,room);
    player={ws,seat:1,name:String(m.name||"Spieler 1").slice(0,24),score:0,stops:null};room.players.push(player);emit(room);
   }else if(m.type==="join"){
    if(room)return error("Bereits im Raum");
    const r=rooms.get(String(m.code||"").trim());if(!r)return error("Raum nicht gefunden");
    if(r.phase!=="lobby"||r.players.length>=4)return error("Raum läuft oder ist voll");
    room=r;player={ws,seat:r.players.length+1,name:String(m.name||"Spieler").slice(0,24),score:0,stops:null};r.players.push(player);emit(r);
   }else if(m.type==="start"){
    if(!room||!player||player.seat!==1||room.phase!=="lobby")return error("Nur der Host kann starten");
    if(room.players.length<2)return error("Mindestens zwei Spieler nötig");
    room.round=0;room.players.forEach(p=>{p.score=0;p.stops=null});next(room);
   }else if(m.type==="stop"){
    if(!room||!player||room.phase!=="fall"||player.stops!==null)return;
    const elapsed=Date.now()-room.startAt;
    // Relative fall progress is server-authoritative; each 1% remaining corresponds to 1 cm.
    const gap=Math.max(0,Math.round((1-elapsed/room.duration)*1000)/10);
    const cm=elapsed>=room.duration?100:gap;
    player.stops=cm;player.score=Math.round((player.score+cm)*10)/10;emit(room);
    if(room.players.every(p=>p.stops!==null)){clearTimeout(room.timer);room.timer=setTimeout(()=>end(room),600)}
   }else if(m.type==="ping")send(ws,{type:"pong",serverTime:Date.now(),clientTime:m.clientTime});
   if(room)room.updated=Date.now();
  });
  ws.on("close",()=>{if(!room||!player)return;player.ws=null;if(room.phase==="lobby"){room.players=room.players.filter(p=>p!==player);room.players.forEach((p,i)=>p.seat=i+1);if(!room.players.length)cleanup(room);else emit(room)}else{if(room.players.every(p=>!p.ws||p.ws.readyState!==1))cleanup(room);else emit(room)}});
 };
}
