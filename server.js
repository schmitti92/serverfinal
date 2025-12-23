
import fs from "fs";
import path from "path";
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 10000;

const app = express();
app.get("/", (_req,res)=>res.status(200).send("barikade-server ok"));
app.get("/health", (_req,res)=>res.status(200).json({ok:true, ts:Date.now(), rooms:rooms.size, clients:clients.size}));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/** ---------- Board graph (server authoritative path + legality) ---------- **/
const boardPath = path.join(process.cwd(), "board.json");
const BOARD = JSON.parse(fs.readFileSync(boardPath, "utf-8"));
const NODES = new Map(BOARD.nodes.map(n=>[n.id,n]));
const EDGES = BOARD.edges || [];
const ADJ = new Map();
for(const [a,b] of EDGES){
  if(!ADJ.has(a)) ADJ.set(a, new Set());
  if(!ADJ.has(b)) ADJ.set(b, new Set());
  ADJ.get(a).add(b);
  ADJ.get(b).add(a);
}
const STARTS = BOARD.meta?.starts || {};
const GOAL = BOARD.meta?.goal || null;

function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function uid(){
  return Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(2,8);
}

/** ---------- Rooms + Clients ---------- **/
const clients = new Map(); // clientId -> {ws, room, name, sessionToken}
const rooms = new Map();   // code -> room

function makeRoom(code){
  return {
    code,
    players: new Map(), // clientId -> {id,name,color,isHost,sessionToken, lastSeen}
    state: null,
    lastRollWasSix: false,
    carryingByColor: { red:false, blue:false },
  };
}

function shuffleInPlace(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function assignColorsRandom(room){
  // remove offline placeholders on reset (no reservation after reset)
  for(const p of Array.from(room.players.values())){
    if(!isConnectedPlayer(p)){
      room.players.delete(p.id);
    }
  }
  const connected = Array.from(room.players.values()).filter(p=>isConnectedPlayer(p));
  // clear colors first
  for(const p of connected) p.color = null;

  if(connected.length === 0) return;
  if(connected.length > 2){
    // should not happen because join blocks, but keep it safe
    connected.length = 2;
  }
  shuffleInPlace(connected);
  const first = connected[0];
  const second = connected[1] || null;
  const firstColor = (Math.random() < 0.5) ? "red" : "blue";
  first.color = firstColor;
  if(second) second.color = (firstColor === "red") ? "blue" : "red";
}


function isConnectedPlayer(p){
  const c = clients.get(p.id);
  return !!(c?.ws && c.ws.readyState === 1);
}
function currentPlayersList(room){
  return Array.from(room.players.values()).map(p=>({
    id:p.id,
    name:p.name,
    color:p.color||null,
    isHost:!!p.isHost,
    connected: isConnectedPlayer(p),
    lastSeen: p.lastSeen || null
  }));
}
function canStart(room){
  // require two connected colored players
  const coloredConnected = Array.from(room.players.values()).filter(p=>p.color && isConnectedPlayer(p));
  return coloredConnected.length >= 2;
}
function broadcast(room, obj){
  const msg = JSON.stringify(obj);
  for(const p of room.players.values()){
    const c = clients.get(p.id);
    if(c?.ws?.readyState === 1){
      try{ c.ws.send(msg); }catch(_e){}
    }
  }
}
function send(ws, obj){
  try{ ws.send(JSON.stringify(obj)); }catch(_e){}
}

function initGameState(room){
  // pieces 5 per color in house
  const pieces = [];
  for(const color of ["red","blue"]){
    const houses = BOARD.nodes
      .filter(n=>n.kind==="house" && String(n.flags?.houseColor||"").toLowerCase()===color)
      .sort((a,b)=>(a.flags?.houseSlot??0)-(b.flags?.houseSlot??0));
    for(let i=0;i<5;i++){
      pieces.push({
        id:`p_${color}_${i+1}`,
        label:i+1,
        color,
        posKind:"house",
        houseId: houses[i]?.id || houses[0]?.id || null,
        nodeId:null
      });
    }
  }

  // barricades: all run nodes
  const barricades = BOARD.nodes
    .filter(n=>n.kind==="board" && n.flags?.run)
    .map(n=>n.id);

  // choose starter
  const turnColor = (Math.random() < 0.5) ? "red" : "blue";

  room.lastRollWasSix = false;
  room.carryingByColor = { red:false, blue:false };

  room.state = {
    started:true,
    paused:false,
    turnColor,
    phase:"need_roll", // need_roll | need_move | place_barricade
    rolled:null,
    pieces,
    barricades,
    goal: GOAL
  };
}

function otherColor(c){ return c==="red" ? "blue" : "red"; }
function getPiece(room, pieceId){
  return room.state?.pieces?.find(p=>p.id===pieceId) || null;
}
function occupiedByColor(room, color, excludePieceId=null){
  const set = new Set();
  for(const p of room.state.pieces){
    if(p.color!==color) continue;
    if(excludePieceId && p.id===excludePieceId) continue;
    if(p.posKind==="board" && p.nodeId) set.add(p.nodeId);
  }
  return set;
}
function occupiedAny(room){
  const set=new Set();
  for(const p of room.state.pieces){
    if(p.posKind==="board" && p.nodeId) set.add(p.nodeId);
  }
  return set;
}
function isPlacableBarricade(room, nodeId){
  const n = NODES.get(nodeId);
  if(!n || n.kind!=="board") return false;

  // Ziel bleibt tabu (sonst blockiert man das Spiel komplett)
  if(n.flags?.goal) return false;

  // nicht auf Figuren oder bestehende Barikaden setzen
  if(room.state.barricades.includes(nodeId)) return false;
  if(occupiedAny(room).has(nodeId)) return false;

  // ALLES ANDERE ist erlaubt (auch Start/noBarricade usw.)
  return true;
}

/** ---------- Path + legality (exact steps, no immediate backtrack, no revisits) ---------- **/
function computeAllTargets(room, startNodeId, steps, color, pieceId){
  const blockedEnd = occupiedByColor(room, color, pieceId); // cannot END on own piece
  const barricades = new Set(room.state.barricades || []);
  const targets = new Map(); // nodeId -> path array

  function dfs(node, depth, prevNode, visited, path){
    if(depth === steps){
      // end legality
      if(!blockedEnd.has(node)){
        if(!targets.has(node)) targets.set(node, [...path]);
      }
      return;
    }
    const neigh = ADJ.get(node);
    if(!neigh) return;

    for(const nx of neigh){
      // no immediate backtrack
      if(prevNode && nx === prevNode) continue;
      // no revisits
      if(visited.has(nx)) continue;

      // barricade cannot be passed through; only land
      if(barricades.has(nx) && (depth+1) < steps) continue;

      // end can't be own piece
      if((depth+1)===steps && blockedEnd.has(nx)) continue;

      visited.add(nx);
      path.push(nx);
      dfs(nx, depth+1, node, visited, path);
      path.pop();
      visited.delete(nx);
    }
  }

  const visited = new Set([startNodeId]);
  dfs(startNodeId, 0, null, visited, [startNodeId]);

  return targets;
}

function pathForTarget(room, piece, targetId){
  const color = piece.color;
  const roll = room.state.rolled;
  if(!(roll>=1 && roll<=6)) return {ok:false, msg:"no roll"};
  const startField = STARTS[color];
  if(!startField || !NODES.has(startField)) return {ok:false, msg:"missing start in board.meta.starts"};

  if(piece.posKind==="house"){
    // first step is leaving to start
    const remaining = roll - 1;
    if(remaining < 0) return {ok:false, msg:"bad remaining"};
    if(remaining === 0){
      if(targetId !== startField) return {ok:false, msg:"with roll=1 you must go to start"};
      return {ok:true, path:[startField]};
    }
    // compute paths from startField with remaining steps
    const targets = computeAllTargets(room, startField, remaining, color, piece.id);
    const p = targets.get(targetId);
    if(!p) return {ok:false, msg:"illegal target"};
    return {ok:true, path:p};
  }

  if(piece.posKind==="board"){
    const cur = piece.nodeId;
    if(!cur) return {ok:false, msg:"piece has no nodeId"};
    const targets = computeAllTargets(room, cur, roll, color, piece.id);
    const p = targets.get(targetId);
    if(!p) return {ok:false, msg:"illegal target"};
    return {ok:true, path:p};
  }

  return {ok:false, msg:"unknown piece pos"};
}

/** ---------- Protocol ---------- **/
function requireRoomState(room, ws){
  if(!room.state){ send(ws,{type:"error", code:"NO_STATE", message:"Spiel nicht gestartet"}); return false; }
  return true;
}
function requireTurn(room, clientId, ws){
  const me = room.players.get(clientId);
  if(!me?.color){ send(ws,{type:"error", code:"SPECTATOR", message:"Du hast keine Farbe"}); return false; }
  if(room.state.paused){ send(ws,{type:"error", code:"PAUSED", message:"Spiel pausiert"}); return false; }
  if(room.state.turnColor !== me.color){
    send(ws,{type:"error", code:"NOT_YOUR_TURN", message:`Nicht dran. Dran: ${room.state.turnColor.toUpperCase()}`});
    return false;
  }
  return true;
}

wss.on("connection", (ws)=>{
  const clientId = uid();
  clients.set(clientId, {ws, room:null, name:null, sessionToken:null});
  send(ws, {type:"hello", clientId});

  ws.on("message", (buf)=>{
    let msg;
    try{ msg = JSON.parse(String(buf)); }catch(_e){ return; }
    const c = clients.get(clientId);
    if(!c) return;

    if(msg.type==="ping"){ send(ws,{type:"pong"}); return; }

    if(msg.type==="join"){
      const roomCode = String(msg.room||"").trim().toUpperCase();
      const name = String(msg.name||"Spieler").slice(0,32);
      const asHost = !!msg.asHost;
      const sessionToken = String(msg.sessionToken||"").slice(0,60);

      if(!roomCode){ send(ws,{type:"error", code:"NO_ROOM", message:"Kein Raumcode"}); return; }

      // leave old room
      if(c.room){
        const old = rooms.get(c.room);
        if(old){
          old.players.delete(clientId);
          broadcast(old, {type:"room_update", players: currentPlayersList(old), canStart: canStart(old)});
        }
      }

      // get/create room
      let room = rooms.get(roomCode);
      if(!room){ room = makeRoom(roomCode); rooms.set(roomCode, room); }

      // check reconnect via sessionToken
      let existing = null;
      if(sessionToken){
        for(const p of room.players.values()){
          if(p.sessionToken && p.sessionToken === sessionToken){
            existing = p;
            break;
          }
        }
      }
      if(existing){
        // take over existing slot (color/host)
        room.players.delete(existing.id);
      }

      // host assignment
      const hasHost = Array.from(room.players.values()).some(p=>p.isHost);
      const isHost = asHost && !hasHost;

      // color assignment (server authoritative, max 2 players: red/blue)
      const COLORS = ["red","blue"];
      const used = Array.from(room.players.values()).map(p=>p.color).filter(Boolean);

      // If reconnect slot existed, keep its color
      let color = existing?.color || null;

      if(!color){
        // Room full?
        if(used.length >= 2){
          send(ws,{type:"error", code:"ROOM_FULL", message:"Raum ist voll (max. 2 Spieler)."});
          return;
        }
        if(used.length === 0){
          // first player: random
          color = COLORS[randInt(0,1)];
        }else{
          // second player: the other color
          color = COLORS.find(c=>!used.includes(c)) || null;
        }
      }
room.players.set(clientId, {id:clientId, name, color, isHost, sessionToken, lastSeen:Date.now()});

      // --- Unpause on reconnect (disconnect-safe) ---
      // If the active turn player reconnects (or both players are connected), resume the game.
      if(room.state){
        const turn = room.state.turnColor;
        const turnPlayer = Array.from(room.players.values()).find(p=>p.color===turn);
        if(turnPlayer && isConnectedPlayer(turnPlayer)) room.state.paused = false;
        const coloredConnected = Array.from(room.players.values()).filter(p=>p.color && isConnectedPlayer(p));
        if(coloredConnected.length >= 2) room.state.paused = false;
      }
      console.log(`[join] room=${roomCode} name=${name} host=${isHost} color=${color} existing=${!!existing}`);
      c.room = roomCode; c.name = name; c.sessionToken=sessionToken;

      send(ws, {type:"room_update", players: currentPlayersList(room), canStart: canStart(room)});
      broadcast(room, {type:"room_update", players: currentPlayersList(room), canStart: canStart(room)});
      if(room.state){
        send(ws, {type:"snapshot", state: room.state});
      }
      return;
    }

    // all other messages need room
    const roomCode = c.room;
    if(!roomCode) return;
    const room = rooms.get(roomCode);
    if(!room) return;

    if(msg.type==="leave"){
      room.players.delete(clientId);
      c.room=null;
      send(ws, {type:"room_update", players: [], canStart:false});
      broadcast(room, {type:"room_update", players: currentPlayersList(room), canStart: canStart(room)});
      return;
    }

    if(msg.type==="start"){
      const me = room.players.get(clientId);
      if(!me?.isHost){ send(ws,{type:"error", code:"NOT_HOST", message:"Nur Host kann starten"}); return; }
      if(!canStart(room)){ send(ws,{type:"error", code:"NEED_2P", message:"Mindestens 2 Spieler nötig"}); return; }
      initGameState(room);
      console.log(`[start] room=${room.code} starter=${room.state.turnColor}`);
      broadcast(room, {type:"started", state: room.state});
      
    if(msg.type==="reset"){
      const me = room.players.get(clientId);
      if(!me?.isHost){ send(ws,{type:"error", code:"NOT_HOST", message:"Nur Host kann resetten"}); return; }

      // Full reset: new random colors for currently connected players, no reservations.
      room.state = null;
      room.lastRollWasSix = false;
      room.carryingByColor = { red:false, blue:false };

      assignColorsRandom(room);
      console.log(`[reset] room=${room.code} by=host`);

      broadcast(room, {type:"room_update", players: currentPlayersList(room), canStart: canStart(room)});
      broadcast(room, {type:"reset_done"});
      return;
    }

return;
    }

    if(msg.type==="roll_request"){
      if(!requireRoomState(room, ws)) return;
      if(!requireTurn(room, clientId, ws)) return;
      if(room.state.phase !== "need_roll"){
        send(ws,{type:"error", code:"BAD_PHASE", message:"Erst Zug beenden"}); return;
      }
      const v = randInt(1,6);
      console.log(`[roll] room=${room.code} by=${room.state.turnColor} value=${v}`);
      room.state.rolled = v;
      room.lastRollWasSix = (v===6);
      room.state.phase = "need_move";
      broadcast(room, {type:"roll", value:v, state: room.state});
      return;
    }

    

    if(msg.type==="end_turn" || msg.type==="skip_turn"){
      if(!requireRoomState(room, ws)) return;
      if(!requireTurn(room, clientId, ws)) return;

      // Safety: do not allow skipping during mandatory barricade placement
      if(room.state.phase === "place_barricade"){
        send(ws,{type:"error", code:"BAD_PHASE", message:"Erst Barikade platzieren"}); return;
      }

      room.lastRollWasSix = false;
      room.state.rolled = null;
      room.state.phase = "need_roll";
      room.state.turnColor = otherColor(room.state.turnColor);

      broadcast(room, {type:"move", state: room.state});
      broadcast(room, {type:"room_update", players: currentPlayersList(room), canStart: canStart(room)});
      return;
    }
if(msg.type==="legal_request"){
      if(!requireRoomState(room, ws)) return;
      if(!requireTurn(room, clientId, ws)) return;
      if(room.state.phase !== "need_move"){
        send(ws,{type:"error", code:"BAD_PHASE", message:"Erst würfeln"}); return;
      }
      const pieceId = String(msg.pieceId||"");
      const pc = getPiece(room, pieceId);
      if(!pc || pc.color !== room.state.turnColor){
        send(ws,{type:"error", code:"BAD_PIECE", message:"Ungültige Figur"}); return;
      }
      const roll = room.state.rolled;
      const startField = STARTS[pc.color];
      let targets=new Map();
      if(pc.posKind==="house"){
        const remaining = roll - 1;
        if(remaining===0){
          targets = new Map([[startField, [startField]]]);
        }else{
          targets = computeAllTargets(room, startField, remaining, pc.color, pc.id);
        }
      }else{
        targets = computeAllTargets(room, pc.nodeId, roll, pc.color, pc.id);
      }
      send(ws, {type:"legal", pieceId, targets: Array.from(targets.keys())});
      return;
    }

    if(msg.type==="move_request"){
      if(!requireRoomState(room, ws)) return;
      if(!requireTurn(room, clientId, ws)) return;
      if(room.state.phase !== "need_move"){
        send(ws,{type:"error", code:"BAD_PHASE", message:"Erst würfeln"}); return;
      }

      const pieceId = String(msg.pieceId||"");
      const targetId = String(msg.targetId||"");
      const pc = getPiece(room, pieceId);
      if(!pc || pc.color !== room.state.turnColor){
        send(ws,{type:"error", code:"BAD_PIECE", message:"Ungültige Figur"}); return;
      }

      const res = pathForTarget(room, pc, targetId);
      if(!res.ok){ send(ws,{type:"error", code:"ILLEGAL", message: res.msg || "illegal"}); return; }

      // apply move: if piece in house, first place on start (already in path[0])
      pc.posKind = "board";
      pc.nodeId = res.path[res.path.length-1];

      // landed on barricade?
      const landed = pc.nodeId;
      const barricades = room.state.barricades;
      const idx = barricades.indexOf(landed);
      let picked = false;
      if(idx >= 0){
        barricades.splice(idx,1);
        picked = true;
        room.carryingByColor[pc.color] = true;
        room.state.phase = "place_barricade";
      }else{
        room.state.phase = "need_roll";
      }

      // if no barricade placement needed:
      if(!picked){
        if(room.lastRollWasSix){
          // extra roll, same player
          room.state.turnColor = pc.color;
          room.state.phase = "need_roll";
          room.state.rolled = null;
        }else{
          // next player
          room.state.turnColor = otherColor(pc.color);
          room.state.phase = "need_roll";
          room.state.rolled = null;
        }
      }else{
        // wait for placement; keep rolled in state (for possible extra roll after placement)
      }

      console.log(`[move] room=${room.code} color=${pc.color} piece=${pc.id} to=${pc.nodeId} picked=${picked}`);
      broadcast(room, {type:"move", action:{pieceId:pc.id, path: res.path, pickedBarricade: picked}, state: room.state});
      return;
    }

    if(msg.type==="place_barricade"){
      if(!requireRoomState(room, ws)) return;
      if(!requireTurn(room, clientId, ws)) return;
      if(room.state.phase !== "place_barricade"){
        send(ws,{type:"error", code:"BAD_PHASE", message:"Keine Barikade zu platzieren"}); return;
      }
      const color = room.state.turnColor;
      if(!room.carryingByColor[color]){
        send(ws,{type:"error", code:"NO_CARRY", message:"Du trägst keine Barikade"}); return;
      }
      const nodeId = String(msg.nodeId||"");
      if(!isPlacableBarricade(room, nodeId)){
        send(ws,{type:"error", code:"BAD_NODE", message:"Hier darf keine Barikade hin"}); return;
      }
      room.state.barricades.push(nodeId);
      console.log(`[place] room=${room.code} color=${color} node=${nodeId}`);
      room.carryingByColor[color]=false;

      // after placement: handle extra roll or turn switch
      if(room.lastRollWasSix){
        room.state.turnColor = color;
      }else{
        room.state.turnColor = otherColor(color);
      }
      room.state.phase = "need_roll";
      room.state.rolled = null;

      broadcast(room, {type:"snapshot", state: room.state});
      return;
    }
  });

  ws.on("close", ()=>{
    const c = clients.get(clientId);
    if(!c) return;
    const roomCode = c.room;
    if(roomCode){
      const room = rooms.get(roomCode);
      if(room){
        // mark paused if active player disconnected
        const p = room.players.get(clientId);
        const wasColor = p?.color;
        const wasTurn = room.state?.turnColor;
        if(p){ p.lastSeen = Date.now(); }

        if(room.state && wasColor && wasTurn && wasColor===wasTurn){
          room.state.paused = true;
        }
        broadcast(room, {type:"room_update", players: currentPlayersList(room), canStart: canStart(room)});
        if(room.state){
          broadcast(room, {type:"snapshot", state: room.state});
        }
      }
    }
    clients.delete(clientId);
  });
});

server.listen(PORT, ()=>console.log("Barikade server listening on", PORT));
