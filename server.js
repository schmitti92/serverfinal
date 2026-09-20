import fs from "fs";
import path from "path";
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import admin from "firebase-admin";

const PORT = process.env.PORT || 10000;
const SERVER_BUILD = "barikade-v12.0-release-candidate-20260920";

// ---------- Player Colors (Lobby Selection) ----------
// WICHTIG (Christoph-Wunsch): KEINE automatische Farbe mehr beim Join.
// Jeder (auch Host) wählt seine Farbe aktiv in der Lobby.
// Reconnect via sessionToken behält die Farbe.
//
// 2–4 Spieler: alle 4 Farben sind grundsätzlich möglich.
// Die Turn-Reihenfolge läuft über room.state.activeColors (nur die tatsächlich
// im Match verwendeten Farben). Pieces existieren aber immer für alle 4 Farben.
const ALLOWED_COLORS = ["red", "blue", "green", "yellow"];
const ALLOWED_DICE_STYLES = ["classic", "neon", "royal"];
function normalizeDiceStyle(value){
  const v = String(value || "").toLowerCase().trim();
  return ALLOWED_DICE_STYLES.includes(v) ? v : "classic";
}

// ---------- Wheel Quotes (Kick) ----------
const KICK_QUOTES = [
  "Abflug! Sitzplatz gibt's draussen.",
  "Raus mit dir – das ist Barikade, kein Wellnessurlaub!",
  "Zack! Das war ein Kurztrip ins Aus.",
  "Du wolltest Action? Bitte sehr.",
  "Heute gibt’s keinen Rabatt auf Schadenfreude.",
  "Einmal frische Luft fuers Karma!",
  "Und tschues – wir sehen uns am Startfeld!",
  "Der Wurf war gut… fuer mich. Schlecht fuer dich.",
  "Das Brett ist voll – einer muss gehen.",
  "Gerade noch drin, jetzt schon draussen.",
  "Das war kein Schritt, das war ein Rausschmiss.",
  "Kleiner Ausflug? Nein: grosser Rauswurf.",
  "Hier fliegen Figuren schneller als Ausreden.",
  "Wenn’s kracht, dann richtig!",
  "Barikade sagt: Bitte hinten anstellen – draussen.",
  "Du bist nicht raus… du bist nur woanders.",
  "Einmal Kick to go.",
  "Auf Wiedersehen im Rueckspiegel!",
  "Das Spielfeld hat gesprochen.",
  "Heute ist nicht dein Tag – heute ist meiner!",
  "Ich nenn das: taktische Luftnummer.",
  "Sorry, Regeln sind Regeln – und ich bin Chef.",
  "Gute Reise! Nicht vergessen: Rueckflug erst spaeter.",
  "Bumm. Und weg war sie/er.",
  "Das ist kein Bug – das ist Barikade.",
  "Wenn du fällst, dann stilvoll.",
  "Ich schubs nur… der Rest macht die Physik.",
  "Kopf hoch – Startfeld ist auch schoen.",
  "Aus dem Weg, ich hab Ziele!",
  "Schnelltest: raus oder raus? Ergebnis: raus."
];


// ---------- Action-Mode Joker Stacks (v2) ----------
// We keep the existing action.jokersByColor for backwards compatibility,
// but internally we store earned/base jokers as arrays with an "origin color".
// This allows: multiple jokers per type, and correct display of the kicked color.
const ACTION_JOKER_TYPES = ["allColors","barricade","reroll","double"];

function ensureActionJokers(action){
  if(!action) return;
  if(!action.jokersOwned || typeof action.jokersOwned !== "object"){
    action.jokersOwned = { red: [], blue: [], green: [], yellow: [] };
  } else {
    for(const c of ALLOWED_COLORS){
      if(!Array.isArray(action.jokersOwned[c])) action.jokersOwned[c] = [];
      // V10.6: legacy Choose/Summe vollständig aus alten Saves entfernen.
      action.jokersOwned[c] = action.jokersOwned[c].filter(j => ACTION_JOKER_TYPES.includes(String(j?.type || "")));
    }
  }
  if(!action.jokersByColor || typeof action.jokersByColor !== "object"){
    action.jokersByColor = {
      red:      { allColors:0, barricade:0, reroll:0, double:0 },
      blue:     { allColors:0, barricade:0, reroll:0, double:0 },
      green:    { allColors:0, barricade:0, reroll:0, double:0 },
      yellow:   { allColors:0, barricade:0, reroll:0, double:0 },
    };
  } else {
    for(const c of ALLOWED_COLORS){
      if(!action.jokersByColor[c] || typeof action.jokersByColor[c] !== "object"){
        action.jokersByColor[c] = { allColors:0, barricade:0, reroll:0, double:0 };
      }
      delete action.jokersByColor[c].choose;
      delete action.jokersByColor[c].sum;
      for(const t of ACTION_JOKER_TYPES){
        const v = action.jokersByColor[c][t];
        if(v === true) action.jokersByColor[c][t] = 1;
        else if(v === false || v == null) action.jokersByColor[c][t] = 0;
        else if(typeof v !== "number" || !isFinite(v)) action.jokersByColor[c][t] = 0;
        else action.jokersByColor[c][t] = Math.max(0, Math.floor(v));
      }
    }
  }
}

function syncJokerCountsFromOwned(action){
  if(!action) return;
  ensureActionJokers(action);
  for(const c of ALLOWED_COLORS){
    const owned = action.jokersOwned[c] || [];
    const counts = { allColors:0, barricade:0, reroll:0, double:0 };
    for(const j of owned){
      const t = String(j?.type || "");
      if(counts[t] != null) counts[t] += 1;
    }
    action.jokersByColor[c] = counts;
  }
}

function addOwnedJoker(action, ownerColor, type, originColor, source="wheel"){
  if(!action) return;
  ensureActionJokers(action);
  if(!ALLOWED_COLORS.includes(ownerColor)) return;
  const t = String(type || "");
  if(!ACTION_JOKER_TYPES.includes(t)) return;
  const origin = ALLOWED_COLORS.includes(originColor) ? originColor : ownerColor;
  action.jokersOwned[ownerColor].push({ type: t, color: origin, source, ts: Date.now() });
  syncJokerCountsFromOwned(action);
}

function consumeOwnedJoker(action, ownerColor, type){
  if(!action) return null;
  ensureActionJokers(action);
  if(!ALLOWED_COLORS.includes(ownerColor)) return null;
  const t = String(type || "");
  const arr = action.jokersOwned[ownerColor];
  if(!Array.isArray(arr) || !arr.length) return null;
  const idx = arr.findIndex(j => String(j?.type) === t);
  if(idx < 0) return null;
  const [removed] = arr.splice(idx, 1);
  syncJokerCountsFromOwned(action);
  return removed || null;
}

function countOwnedJokers(action, ownerColor, type){
  if(!action) return 0;
  ensureActionJokers(action);
  const arr = action.jokersOwned?.[ownerColor];
  if(!Array.isArray(arr)) return 0;
  const t = String(type || "");
  let n = 0;
  for(const j of arr){ if(String(j?.type) === t) n++; }
  return n;
}

function jokerGameplayEnabled(room){
  return !!(room?.state?.action && (String(room.state.mode || "classic") === "action" || room.state.bossMode));
}


// ---------- V11.0 Action-Bossmodus: wandernde Bosse ----------
// Bossfelder sind nur Eintrittsportale. Danach laufen Bosse auf dem kompletten Brett.
// WICHTIG: Bosse erzeugen/vernichten KEINE Barikaden. Die vorhandene Anzahl bleibt erhalten.
const BOSS_TYPES = {
  hunter: { key:"hunter", name:"Der Jäger", icon:"🐺", hp:1, steps:1, cadence:"roll" },
  curse:  { key:"curse",  name:"Der Fluchmeister", icon:"🧙", hp:1, steps:5, cadence:"round" },
  shadow: { key:"shadow", name:"Der Schatten", icon:"👻", hp:1, steps:3, cadence:"round" },
};

// ---------- V11.5 Ereigniskarten: exakt 54 Karten ----------
// Jede Karte besitzt eine eindeutige ID. Das Deck wird vollständig gemischt,
// Karte für Karte gezogen und erst nach Verbrauch aller 54 Karten neu gemischt.
function repeatEventCards(prefix,count,base){
  return Array.from({length:count},(_,i)=>({
    ...base,
    id:`${prefix}_${String(i+1).padStart(2,"0")}`,
  }));
}

const EVENT_CARD_DEFS = [
  ...repeatEventCards("boss_one",15,{
    icon:"👹", title:"Ein Boss erscheint",
    text:"Ein zufälliger Boss erscheint an einem freien Bossportal.",
    effect:"spawn_one"
  }),
  ...repeatEventCards("boss_two",3,{
    icon:"☠️", title:"Zwei Bosse erscheinen",
    text:"Bis zu zwei zufällige Bosse erscheinen an freien Bossportalen.",
    effect:"spawn_two"
  }),
  ...repeatEventCards("again",5,{
    icon:"🎲", title:"Nochmal würfeln",
    text:"Du darfst nach diesem Zug sofort erneut würfeln.",
    effect:"extra_roll"
  }),
  ...repeatEventCards("minus2",2,{
    icon:"🥾", title:"Schwerer Fluch",
    text:"Dein nächster Würfelwurf erhält −2. Minimum bleibt 1.",
    effect:"roll_minus2"
  }),
  ...repeatEventCards("barrier_shuffle",1,{
    icon:"🧱", title:"Barikadenchaos",
    text:"Alle 12 Barikaden werden zufällig neu auf zulässige Felder verteilt.",
    effect:"barrier_shuffle_all"
  }),
  ...repeatEventCards("boss_now",2,{
    icon:"⚡", title:"Bossaktion!",
    text:"Alle aktiven Bosse führen sofort ihre normale Bossaktion aus.",
    effect:"boss_action_now"
  }),
  ...repeatEventCards("joker_one",5,{
    icon:"🎁", title:"Joker erhalten",
    text:"Du erhältst einen zufälligen Joker.",
    effect:"joker_one"
  }),
  ...repeatEventCards("positions",1,{
    icon:"🔀", title:"Positionschaos",
    text:"Alle Figuren auf dem Brett tauschen ihre Positionen zufällig. Figuren im Starthaus bleiben dort.",
    effect:"player_positions_shuffle"
  }),
  ...repeatEventCards("boss_sleep",2,{
    icon:"😴", title:"Bosse setzen aus",
    text:"Alle Bosse setzen die nächste vollständige Bossrunde aus.",
    effect:"boss_sleep"
  }),
  ...repeatEventCards("boss_defeat_all",3,{
    icon:"⚔️", title:"Alle Bosse besiegt",
    text:"Alle aktuell aktiven Bosse sind sofort besiegt und verschwinden.",
    effect:"defeat_all_bosses"
  }),
  ...repeatEventCards("walk10",1,{
    icon:"🚀", title:"10 Felder laufen",
    text:"Du darfst direkt eine eigene Figur genau 10 Felder bewegen.",
    effect:"walk10"
  }),
  ...repeatEventCards("boss_teleport",2,{
    icon:"🌀", title:"Boss-Teleport",
    text:"Ein zufälliger aktiver Boss wird auf ein zufälliges freies Brettfeld teleportiert.",
    effect:"boss_teleport"
  }),
  ...repeatEventCards("bounty",1,{
    icon:"🎯", title:"Kopfgeld",
    text:"Der nächste von einem Spieler besiegte Boss bringt 2 Joker statt 1.",
    effect:"bounty"
  }),
  ...repeatEventCards("barrier_wander",2,{
    icon:"🧱", title:"Barikadenwanderung",
    text:"Drei zufällige Barikaden werden auf neue zulässige Felder versetzt.",
    effect:"barrier_wander3"
  }),
  ...repeatEventCards("curse_wave",1,{
    icon:"🧙", title:"Fluchwelle",
    text:"Spieler in bis zu 3 Feldern Entfernung zum Fluchmeister erhalten −2 auf den nächsten Wurf.",
    effect:"curse_wave"
  }),
  ...repeatEventCards("skip_next",1,{
    icon:"⏸️", title:"Nächste Runde aussetzen",
    text:"Du setzt deinen nächsten vollständigen Spielzug aus.",
    effect:"skip_next_turn"
  }),
  ...repeatEventCards("joker_two",5,{
    icon:"🎁", title:"Doppel-Joker",
    text:"Du erhältst 2 zufällige Joker.",
    effect:"joker_two"
  }),
  ...repeatEventCards("lose_jokers",1,{
    icon:"💀", title:"Alle Joker verlieren",
    text:"Du verlierst alle Joker, die du aktuell besitzt.",
    effect:"lose_all_jokers"
  }),
  ...repeatEventCards("all_forward",1,{
    icon:"⏩", title:"Alle vorwärts!",
    text:"Alle Figuren auf dem Brett bewegen sich 1 Feld Richtung Ziel. Eigene Figuren, die zu Beginn der Kartenaktion im Weg stehen, werden übersprungen.",
    effect:"all_pieces_forward"
  }),
];

if(EVENT_CARD_DEFS.length !== 54){
  throw new Error(`Ereigniskartendeck muss exakt 54 Karten enthalten, aktuell: ${EVENT_CARD_DEFS.length}`);
}

function bossFieldDefs(){
  return Array.isArray(BOARD?.meta?.bossFields) ? BOARD.meta.bossFields : [];
}

function normalizedBossSlots(){
  const fields=bossFieldDefs();
  const slots=fields.slice(0,2).map((f,i)=>({
    id:String(f?.id || `boss_${i+1}`),
    name:String(f?.name || `Bossfeld ${i+1}`),
    anchors:(Array.isArray(f?.anchors)?f.anchors:(Array.isArray(f?.path)?f.path:(f?.anchor?[f.anchor]:[]))).map(String),
    boss:null,
  }));
  while(slots.length<2) slots.push({id:`boss_${slots.length+1}`,name:`Bossfeld ${slots.length+1}`,anchors:[],boss:null});
  return slots;
}

const BOSS_EVENT_FIELD_COUNT = 8;
const BOSS_EVENT_MIN_DISTANCE = 3;

function createBossState(){
  const deck=EVENT_CARD_DEFS.map(c=>c.id); shuffleInPlace(deck);
  return {
    v:5,
    slots:normalizedBossSlots(),
    // V11.4: Die 8 Ereignisfelder werden serverseitig zufällig verteilt.
    eventFields:[],
    deck, discard:[], lastEvent:null, lastAction:null, history:[],
    eventSeq:0, actionSeq:0, round:1, turnsInRound:0, sleepRounds:0, sleepActiveRound:null,
    rollModsByColor:{red:0,blue:0,green:0,yellow:0},
    skipTurnsByColor:{red:0,blue:0,green:0,yellow:0},
    forcedMoveByColor:{red:0,blue:0,green:0,yellow:0},
    bountyNextBoss:false,
  };
}

function eventFieldStaticCandidates(){
  const starts=new Set(Object.values(STARTS||{}).map(String));
  return (BOARD.nodes||[])
    .filter(n=>n?.kind==="board")
    .map(n=>String(n.id))
    .filter(id=>id && id!==String(GOAL||"") && !starts.has(id));
}

function eventFieldGraphDistance(a,b,stopAt=BOSS_EVENT_MIN_DISTANCE-1){
  a=String(a||""); b=String(b||"");
  if(!a||!b) return Infinity;
  if(a===b) return 0;
  const q=[[a,0]], seen=new Set([a]);
  for(let qi=0;qi<q.length;qi++){
    const [u,d]=q[qi];
    if(d>=stopAt) continue;
    const ns=ADJ.get(u); if(!ns) continue;
    for(const v of ns){
      if(NODES.get(String(v))?.kind!=="board") continue;
      if(String(v)===b) return d+1;
      if(!seen.has(String(v))){seen.add(String(v));q.push([String(v),d+1]);}
    }
  }
  return Infinity;
}

function eventFieldsSpaced(ids,minDistance=BOSS_EVENT_MIN_DISTANCE){
  const arr=(ids||[]).map(String);
  for(let i=0;i<arr.length;i++){
    for(let j=i+1;j<arr.length;j++){
      if(eventFieldGraphDistance(arr[i],arr[j],minDistance-1)<minDistance) return false;
    }
  }
  return true;
}

function eventFieldDynamicBlocked(room,b){
  const blocked=new Set();
  for(const id of (room?.state?.barricades||[])) blocked.add(String(id));
  for(const p of (room?.state?.pieces||[])){
    if(p?.posKind==="board" && p?.nodeId) blocked.add(String(p.nodeId));
  }
  for(const slot of (b?.slots||[])){
    if(slot?.boss?.nodeId) blocked.add(String(slot.boss.nodeId));
  }
  return blocked;
}

function randomEventFieldLayout(room,b,count=BOSS_EVENT_FIELD_COUNT,{avoidDynamic=true,excludeIds=[]}={}){
  const excluded=new Set((excludeIds||[]).map(String));
  const blocked=avoidDynamic?eventFieldDynamicBlocked(room,b):new Set();
  const base=eventFieldStaticCandidates().filter(id=>!excluded.has(id)&&!blocked.has(id));
  if(count<=0) return [];
  if(base.length<count) return [];

  // Schneller Zufallsweg für den Normalfall.
  let best=[];
  for(let attempt=0;attempt<220;attempt++){
    const pool=base.slice(); shuffleInPlace(pool);
    const chosen=[];
    for(const id of pool){
      if(chosen.every(other=>eventFieldGraphDistance(id,other,BOSS_EVENT_MIN_DISTANCE-1)>=BOSS_EVENT_MIN_DISTANCE)){
        chosen.push(id);
        if(chosen.length>=count) return chosen;
      }
    }
    if(chosen.length>best.length) best=chosen;
  }

  // Sicherheitsnetz: randomisiertes Backtracking statt eines unsicheren Fallbacks.
  // Damit bleiben die Bedingungen „genau 8 Felder“ + Mindestabstand 3 erhalten,
  // solange auf dem Brett überhaupt eine gültige Verteilung existiert.
  const pool=base.slice(); shuffleInPlace(pool);
  const compatible=new Map();
  for(const a of pool){
    const set=new Set();
    for(const c of pool){
      if(a!==c && eventFieldGraphDistance(a,c,BOSS_EVENT_MIN_DISTANCE-1)>=BOSS_EVENT_MIN_DISTANCE) set.add(c);
    }
    compatible.set(a,set);
  }

  let visits=0;
  const MAX_VISITS=250000;
  function search(candidates,chosen){
    visits++;
    if(chosen.length>=count) return chosen.slice(0,count);
    const need=count-chosen.length;
    if(candidates.length<need || visits>MAX_VISITS) return null;

    // Kandidaten mit vielen kompatiblen Restfeldern zuerst probieren.
    candidates.sort((a,c)=>{
      const ca=compatible.get(a), cc=compatible.get(c);
      let na=0,nc=0;
      for(const x of candidates){ if(ca?.has(x)) na++; if(cc?.has(x)) nc++; }
      return nc-na;
    });

    for(let i=0;i<candidates.length;i++){
      const id=candidates[i];
      if(!chosen.every(other=>compatible.get(id)?.has(other))) continue;
      const next=[];
      const comp=compatible.get(id);
      for(let j=i+1;j<candidates.length;j++) if(comp?.has(candidates[j])) next.push(candidates[j]);
      const found=search(next,chosen.concat(id));
      if(found) return found;
    }
    return null;
  }

  return search(pool,[]) || best;
}

function ensureBossEventFieldLayout(room,b,force=false){
  if(!b) return [];
  const staticSet=new Set(eventFieldStaticCandidates());
  const current=Array.isArray(b.eventFields)?[...new Set(b.eventFields.map(String))].filter(id=>staticSet.has(id)):[];
  const valid=current.length===BOSS_EVENT_FIELD_COUNT && eventFieldsSpaced(current);
  if(valid && !force){b.eventFields=current;return current;}

  const next=randomEventFieldLayout(room,b,BOSS_EVENT_FIELD_COUNT,{avoidDynamic:true});
  // Niemals Ereignisfelder unter Figuren, Barikaden oder aktive Bosse legen.
  // Sollte ein extrem belegtes Brett vorübergehend keine 8 sicheren Felder zulassen,
  // behalten wir nur die sicher gefundenen Felder statt eine Kollision zu erzeugen.
  b.eventFields=next.slice(0,BOSS_EVENT_FIELD_COUNT);
  return b.eventFields;
}

function respawnBossEventField(room,b,usedFieldId){
  if(!b) return null;
  const used=String(usedFieldId||"");
  const remaining=(Array.isArray(b.eventFields)?b.eventFields:[]).map(String).filter(id=>id!==used);
  b.eventFields=[...new Set(remaining)];

  const blocked=eventFieldDynamicBlocked(room,b);
  let candidates=eventFieldStaticCandidates().filter(id=>
    id!==used && !b.eventFields.includes(id) && !blocked.has(id) &&
    b.eventFields.every(other=>eventFieldGraphDistance(id,other,BOSS_EVENT_MIN_DISTANCE-1)>=BOSS_EVENT_MIN_DISTANCE)
  );
  shuffleInPlace(candidates);
  let next=candidates[0]||null;

  if(!next){
    // Kein unsicherer Fallback: stattdessen alle 8 Felder komplett neu und kollisionsfrei suchen.
    const relayout=randomEventFieldLayout(room,b,BOSS_EVENT_FIELD_COUNT,{avoidDynamic:true,excludeIds:[used]});
    if(relayout.length===BOSS_EVENT_FIELD_COUNT){
      b.eventFields=relayout.slice();
      next=b.eventFields.find(id=>!remaining.includes(id)) || b.eventFields[b.eventFields.length-1] || null;
      return next;
    }
  }

  if(next) b.eventFields.push(String(next));
  if(b.eventFields.length!==BOSS_EVENT_FIELD_COUNT || !eventFieldsSpaced(b.eventFields)){
    const relayout=randomEventFieldLayout(room,b,BOSS_EVENT_FIELD_COUNT,{avoidDynamic:true,excludeIds:[used]});
    if(relayout.length===BOSS_EVENT_FIELD_COUNT){
      b.eventFields=relayout.slice();
      next=b.eventFields.find(id=>!remaining.includes(id)) || b.eventFields[b.eventFields.length-1] || null;
    }
  }
  return next;
}

function ensureBossState(room){
  if(!room?.state?.bossMode) return null;
  if(!room.state.boss || typeof room.state.boss!=="object") room.state.boss=createBossState();
  const b=room.state.boss;
  const defs=normalizedBossSlots();

  // Einmalige Migration aus der alten Boss-Version. Danach Slot-Objekte stabil lassen,
  // damit Referenzen beim Spawnen/Bewegen nicht durch erneutes Mapping verloren gehen.
  if(!Array.isArray(b.slots) || Number(b.v||0)<2){
    const oldSlots=Array.isArray(b.slots)?b.slots:[];
    b.slots=defs.map((def,i)=>{
      const old=oldSlots.find(s=>String(s?.id||"")===def.id) || oldSlots[i] || null;
      const boss=old?.boss && BOSS_TYPES[String(old.boss.type||"")] ? old.boss : null;
      return {...def,boss};
    });
  }else{
    while(b.slots.length<defs.length) b.slots.push({...defs[b.slots.length],boss:null});
    if(b.slots.length>defs.length) b.slots=b.slots.slice(0,defs.length);
    for(let i=0;i<defs.length;i++){
      const slot=b.slots[i] || (b.slots[i]={...defs[i],boss:null});
      slot.id=defs[i].id; slot.name=defs[i].name; slot.anchors=defs[i].anchors.slice();
    }
  }

  // Alte Boss-Typen endgültig entfernen und die drei neuen auf exakt 1 Leben normieren.
  for(const slot of b.slots){
    const boss=slot?.boss;
    if(!boss) continue;
    const bd=BOSS_TYPES[String(boss.type||"")];
    if(!bd){slot.boss=null;continue;}
    boss.name=bd.name; boss.icon=bd.icon; boss.hp=1; boss.maxHp=1;
    boss.nodeId=boss.nodeId ? String(boss.nodeId) : null;
    boss.lastNodeId=boss.lastNodeId ? String(boss.lastNodeId) : null;
    if(!Array.isArray(boss.lastPath)) boss.lastPath=[];
  }

  if(!Array.isArray(b.eventFields)) b.eventFields=[];
  if(!Array.isArray(b.deck) || b.deck.some(id=>!EVENT_CARD_DEFS.some(c=>c.id===id))) b.deck=[];
  if(!Array.isArray(b.discard)) b.discard=[];
  if(!Array.isArray(b.history)) b.history=[];
  if(!b.rollModsByColor || typeof b.rollModsByColor!=="object") b.rollModsByColor={red:0,blue:0,green:0,yellow:0};
  if(!b.skipTurnsByColor || typeof b.skipTurnsByColor!=="object") b.skipTurnsByColor={red:0,blue:0,green:0,yellow:0};
  if(!b.forcedMoveByColor || typeof b.forcedMoveByColor!=="object") b.forcedMoveByColor={red:0,blue:0,green:0,yellow:0};
  for(const c of ALLOWED_COLORS){
    if(!Number.isFinite(Number(b.rollModsByColor[c]))) b.rollModsByColor[c]=0;
    b.skipTurnsByColor[c]=Math.max(0,Math.floor(Number(b.skipTurnsByColor[c]||0)));
    b.forcedMoveByColor[c]=Math.max(0,Math.floor(Number(b.forcedMoveByColor[c]||0)));
  }
  b.bountyNextBoss=!!b.bountyNextBoss;
  b.round=Math.max(1,Number(b.round||1)); b.turnsInRound=Math.max(0,Number(b.turnsInRound||0));
  b.sleepRounds=Math.max(0,Math.floor(Number(b.sleepRounds||0)));
  b.sleepActiveRound=Number.isFinite(Number(b.sleepActiveRound))&&Number(b.sleepActiveRound)>0?Math.floor(Number(b.sleepActiveRound)):null;
  b.eventSeq=Math.max(0,Number(b.eventSeq||0)); b.actionSeq=Math.max(0,Number(b.actionSeq||0));
  ensureBossEventFieldLayout(room,b,false);
  b.v=5;
  return b;
}

function bossAction(room,icon,title,text){
  const b=ensureBossState(room); if(!b) return null;
  const a={seq:++b.actionSeq,icon:String(icon||"👹"),title:String(title||"Boss"),text:String(text||""),ts:Date.now()};
  b.lastAction=a; b.history.push(a); if(b.history.length>16) b.history.splice(0,b.history.length-16); return a;
}

function activeBossEntries(room){
  const b=ensureBossState(room); if(!b) return [];
  return b.slots.map((slot,index)=>({slot,index,boss:slot?.boss})).filter(x=>x.boss);
}

function activeBossColors(room){
  const a=Array.isArray(room?.state?.activeColors)&&room.state.activeColors.length?room.state.activeColors:ALLOWED_COLORS;
  return a.filter(c=>ALLOWED_COLORS.includes(String(c)));
}

function bossBoardNeighbors(nodeId){
  const ns=ADJ.get(String(nodeId)); if(!ns) return [];
  return [...ns].filter(id=>NODES.get(id)?.kind==="board");
}

function bossShortestPath(startId,targetId){
  startId=String(startId||""); targetId=String(targetId||"");
  if(!startId||!targetId||!NODES.has(startId)||!NODES.has(targetId)) return null;
  if(startId===targetId) return [startId];
  const q=[startId], prev=new Map([[startId,null]]);
  for(let qi=0;qi<q.length;qi++){
    const u=q[qi];
    for(const v of bossBoardNeighbors(u)){
      if(prev.has(v)) continue; prev.set(v,u);
      if(v===targetId){
        const path=[v]; let cur=u; while(cur){path.push(cur);cur=prev.get(cur);} path.reverse(); return path;
      }
      q.push(v);
    }
  }
  return null;
}

function boardPiecesForColor(room,color){
  return (room?.state?.pieces||[]).filter(p=>p && p.color===color && p.posKind==="board" && p.nodeId && NODES.get(String(p.nodeId))?.kind==="board");
}
function piecesOnBossNode(room,nodeId){
  return (room?.state?.pieces||[]).filter(p=>p && p.posKind==="board" && String(p.nodeId||"")===String(nodeId||"") && activeBossColors(room).includes(p.color));
}
function bossTargetNodes(room,color){
  const pcs=boardPiecesForColor(room,color); if(pcs.length) return pcs.map(p=>String(p.nodeId));
  const s=STARTS?.[color]; return s?[String(s)]:[];
}
function bossLeaderMetric(room,color){
  let best=Infinity;
  for(const p of boardPiecesForColor(room,color)){
    const d=DIST_TO_GOAL.get(String(p.nodeId)); if(Number.isFinite(d)) best=Math.min(best,d);
  }
  if(best<Infinity) return best;
  const s=STARTS?.[color], d=s?DIST_TO_GOAL.get(String(s)):null;
  return Number.isFinite(d)?d:9999;
}
function bossLeadingColor(room,subset=null){
  const colors=(Array.isArray(subset)&&subset.length?subset:activeBossColors(room));
  return colors.slice().sort((a,b)=>bossLeaderMetric(room,a)-bossLeaderMetric(room,b) || activeBossColors(room).indexOf(a)-activeBossColors(room).indexOf(b))[0] || colors[0] || "red";
}
function totalJokersForColor(room,color){
  const action=room?.state?.action; if(!action) return 0; ensureActionJokers(action);
  return Array.isArray(action.jokersOwned?.[color])?action.jokersOwned[color].length:0;
}
function shadowTargetColor(room){
  const colors=activeBossColors(room); if(!colors.length) return "red";
  let max=-1; for(const c of colors) max=Math.max(max,totalJokersForColor(room,c));
  if(max<=0) return bossLeadingColor(room,colors);
  const tied=colors.filter(c=>totalJokersForColor(room,c)===max);
  return tied.length===1?tied[0]:bossLeadingColor(room,tied);
}

function chooseSpawnAnchor(slot,targetNodes){
  const anchors=(slot?.anchors||[]).filter(id=>NODES.get(String(id))?.kind==="board").map(String);
  if(!anchors.length) return null;
  let best=null,bestDist=Infinity;
  for(const a of anchors){
    let d=Infinity;
    for(const t of targetNodes||[]){const p=bossShortestPath(a,t);if(p)d=Math.min(d,p.length-1);}
    if(d<bestDist){bestDist=d;best=a;}
  }
  return best || anchors[0];
}

function spawnBoss(room,preferredType=null,preferredSlotId=null){
  const b=ensureBossState(room); if(!b) return {ok:false,text:"Bossmodus ist aus."};
  let slot=preferredSlotId?b.slots.find(s=>String(s.id)===String(preferredSlotId)&&!s.boss):null;
  if(!slot) slot=b.slots.find(s=>!s.boss);
  if(!slot) return {ok:false,text:"Beide Bossportale sind bereits belegt."};
  const used=new Set(activeBossEntries(room).map(x=>String(x.boss?.type||"")));
  let key=String(preferredType||"");
  if(!BOSS_TYPES[key]){
    let choices=Object.keys(BOSS_TYPES).filter(k=>!used.has(k)); if(!choices.length) choices=Object.keys(BOSS_TYPES);
    key=choices[Math.floor(Math.random()*choices.length)];
  }
  const def=BOSS_TYPES[key];
  slot.boss={id:`${key}_${uid()}`,type:key,name:def.name,icon:def.icon,hp:1,maxHp:1,nodeId:null,lastNodeId:null,lastPath:[],spawnedAt:Date.now()};
  bossAction(room,def.icon,"Boss erschienen",`${def.name} wartet an ${slot.name} und läuft über einen Bossweg ins Spielfeld.`);
  return {ok:true,text:`${def.icon} ${def.name} erscheint an ${slot.name}.`,boss:slot.boss,slotId:slot.id};
}
function spawnRandomBoss(room){ return spawnBoss(room,null,null); }


function grantRandomEventJokers(room,color,count=1,source="event"){
  const action=room?.state?.action;
  const wheels=[];
  const n=Math.max(0,Math.floor(Number(count||0)));
  if(!action || !ALLOWED_COLORS.includes(String(color))) return {text:"Joker-System ist nicht aktiv.",wheels};
  ensureActionJokers(action);
  const player=Array.from(room.players?.values?.()||[]).find(p=>p?.color===color);
  for(let i=0;i<n;i++){
    const result=ACTION_JOKER_TYPES[Math.floor(Math.random()*ACTION_JOKER_TYPES.length)];
    addOwnedJoker(action,color,result,color,source);
    wheels.push({
      targetColor:color,ownerColor:color,jokerColor:color,result,durationMs:5000,
      attackerName:"Ereigniskarte",victimName:player?.name||"",
      headline:n>1?`🎁 Doppel-Joker für ${player?.name||String(color).toUpperCase()}`:`🎁 Joker für ${player?.name||String(color).toUpperCase()}`,
      quote:n>1?"Zwei zufällige Joker!":"Ein zufälliger Joker!",
      event:true
    });
  }
  syncJokerCountsFromOwned(action);
  return {text:n===1?"Du erhältst 1 zufälligen Joker.":`Du erhältst ${n} zufällige Joker.`,wheels};
}

function clearAllJokersForColor(room,color){
  const action=room?.state?.action;
  if(!action || !ALLOWED_COLORS.includes(String(color))) return 0;
  ensureActionJokers(action);
  const count=Array.isArray(action.jokersOwned?.[color])?action.jokersOwned[color].length:0;
  action.jokersOwned[color]=[];
  syncJokerCountsFromOwned(action);
  return count;
}

function forceAllBossActions(room,{label="Ereignis"}={}){
  const active=activeBossEntries(room);
  if(!active.length) return {text:"Kein Boss ist aktiv – die Karte ist wirkungslos.",wheels:[]};
  const wheels=[],texts=[];
  for(const e of active){
    const r=moveBossEntry(room,e,{forced:true});
    if(Array.isArray(r?.wheels)) wheels.push(...r.wheels);
    if(r?.text) texts.push(r.text);
  }
  bossAction(room,"⚡",label,`${active.length} Boss${active.length===1?"":"e"} führen sofort eine Aktion aus.`);
  return {text:texts.join(" ")||"Bossaktion sofort ausgeführt.",wheels};
}

function spawnBossesFromEvent(room,count){
  const wanted=Math.max(1,Math.floor(Number(count||1)));
  const texts=[];
  let spawned=0;
  for(let i=0;i<wanted;i++){
    const r=spawnRandomBoss(room);
    if(r?.ok){spawned++; if(r.text) texts.push(r.text);}
    else break;
  }
  let wheels=[];
  if(spawned<wanted){
    const forced=forceAllBossActions(room,{label:"Bossportale belegt"});
    wheels=forced.wheels||[];
    if(forced.text) texts.push(`Kein weiteres Bossportal frei: ${forced.text}`);
  }
  return {text:texts.join(" ")||"Keine Bossaktion möglich.",wheels};
}

function teleportRandomBoss(room){
  const b=ensureBossState(room);
  const active=activeBossEntries(room);
  if(!b||!active.length) return {text:"Kein Boss aktiv – Boss-Teleport ist wirkungslos.",wheels:[]};
  const entry=active[Math.floor(Math.random()*active.length)];
  const blocked=new Set((room.state.barricades||[]).map(String));
  for(const p of (room.state.pieces||[])) if(p?.posKind==="board"&&p?.nodeId) blocked.add(String(p.nodeId));
  for(const e of active) if(e!==entry && e.boss?.nodeId) blocked.add(String(e.boss.nodeId));
  for(const id of (b.eventFields||[])) blocked.add(String(id));
  const candidates=(BOARD.nodes||[])
    .filter(n=>n?.kind==="board")
    .map(n=>String(n.id))
    .filter(id=>id!==String(GOAL||"")&&!blocked.has(id));
  if(!candidates.length) return {text:"Kein freies Feld für den Boss-Teleport gefunden.",wheels:[]};
  const to=candidates[Math.floor(Math.random()*candidates.length)];
  const boss=entry.boss;
  const from=boss.nodeId?String(boss.nodeId):entry.slot?.name||"Bossportal";
  boss.lastNodeId=boss.nodeId?String(boss.nodeId):null;
  boss.nodeId=String(to);
  boss.lastPath=[String(to)];
  boss.lastMovedAt=Date.now();
  bossAction(room,"🌀","Boss-Teleport",`${boss.icon} ${boss.name}: ${from} → ${to}.`);
  return {text:`${boss.icon} ${boss.name} wird auf ${to} teleportiert.`,wheels:[]};
}

function barrierEventCandidateFields(room,{ignoreStarts=true}={}){
  const b=ensureBossState(room);
  const blocked=new Set();
  for(const p of (room.state.pieces||[])) if(p?.posKind==="board"&&p?.nodeId) blocked.add(String(p.nodeId));
  for(const e of activeBossEntries(room)) if(e.boss?.nodeId) blocked.add(String(e.boss.nodeId));
  for(const id of (b?.eventFields||[])) blocked.add(String(id));
  const starts=new Set(Object.values(STARTS||{}).map(String));
  return (BOARD.nodes||[])
    .filter(n=>n?.kind==="board")
    .map(n=>String(n.id))
    .filter(id=>id!==String(GOAL||"")&&!blocked.has(id)&&(!ignoreStarts||!starts.has(id)));
}

function shuffleAllBarricadesEvent(room){
  const targetCount=12;
  let pool=barrierEventCandidateFields(room,{ignoreStarts:true});
  if(pool.length<targetCount) pool=barrierEventCandidateFields(room,{ignoreStarts:false});
  shuffleInPlace(pool);
  if(pool.length<targetCount) return {ok:false,text:"Nicht genügend freie Felder für 12 Barikaden gefunden."};
  room.state.barricades=pool.slice(0,targetCount);
  return {ok:true,text:"Alle 12 Barikaden wurden zufällig neu verteilt."};
}

function wanderBarricadesEvent(room,count=3){
  const arr=Array.isArray(room?.state?.barricades)?room.state.barricades:null;
  if(!arr||!arr.length) return {ok:false,text:"Keine Barikaden vorhanden."};
  const n=Math.min(Math.max(1,Math.floor(Number(count||3))),arr.length);
  const indexes=arr.map((_,i)=>i); shuffleInPlace(indexes);
  const chosen=indexes.slice(0,n);
  const oldChosen=new Set(chosen.map(i=>String(arr[i])));
  const remaining=new Set(arr.filter((_,i)=>!chosen.includes(i)).map(String));
  let pool=barrierEventCandidateFields(room,{ignoreStarts:true}).filter(id=>!remaining.has(id)&&!oldChosen.has(id));
  if(pool.length<n) pool=barrierEventCandidateFields(room,{ignoreStarts:false}).filter(id=>!remaining.has(id)&&!oldChosen.has(id));
  shuffleInPlace(pool);
  if(pool.length<n) return {ok:false,text:"Die Barikadenwanderung findet keine passenden neuen Felder."};
  const before=arr.length;
  chosen.forEach((idx,j)=>{arr[idx]=String(pool[j]);});
  if(arr.length!==before) throw new Error("Barikadenwanderung darf die Barikadenanzahl nicht verändern");
  return {ok:true,text:`${n} Barikaden wurden auf neue zufällige Felder versetzt.`};
}

function shufflePlayerBoardPositions(room){
  const pcs=(room?.state?.pieces||[]).filter(p=>p?.posKind==="board"&&p?.nodeId);
  if(pcs.length<2) return {text:"Zu wenige Figuren auf dem Brett – Positionschaos ist wirkungslos."};
  const original=pcs.map(p=>String(p.nodeId));
  let shuffled=original.slice();
  for(let attempt=0;attempt<20;attempt++){
    shuffleInPlace(shuffled);
    if(shuffled.some((id,i)=>id!==original[i])) break;
  }
  if(!shuffled.some((id,i)=>id!==original[i])){
    shuffled=original.slice(1).concat(original[0]);
  }
  pcs.forEach((p,i)=>{p.nodeId=String(shuffled[i]);});
  return {text:`${pcs.length} Figuren auf dem Brett haben ihre Positionen zufällig getauscht.`};
}

function defeatAllBossesEvent(room){
  const b=ensureBossState(room); if(!b) return {text:"Bossmodus ist aus."};
  let count=0;
  for(const slot of b.slots){
    if(slot?.boss){slot.boss=null;count++;}
  }
  if(!count) return {text:"Kein Boss aktiv – die Karte ist wirkungslos."};
  bossAction(room,"⚔️","Alle Bosse besiegt",`${count} aktiver Boss${count===1?"":"e"} verschwindet${count===1?"":"n"}.`);
  return {text:`Alle ${count} aktiven Bosse sind besiegt und verschwinden.`};
}

function curseWaveEvent(room){
  const b=ensureBossState(room);
  const curses=activeBossEntries(room).filter(e=>e.boss?.type==="curse"&&e.boss?.nodeId);
  if(!b||!curses.length) return {text:"Kein Fluchmeister auf dem Brett – die Fluchwelle ist wirkungslos."};
  const hit=[];
  for(const color of activeBossColors(room)){
    const pcs=boardPiecesForColor(room,color);
    const near=pcs.some(pc=>curses.some(e=>eventFieldGraphDistance(String(pc.nodeId),String(e.boss.nodeId),3)<=3));
    if(near){b.rollModsByColor[color]=-2;hit.push(color);}
  }
  return {text:hit.length?`${hit.map(c=>String(c).toUpperCase()).join(", ")}: nächster Wurf −2.`:"Keine Spielfigur steht innerhalb von 3 Feldern zum Fluchmeister."};
}

function forwardChoices(nodeId){
  const cur=Number(DIST_TO_GOAL.get(String(nodeId)));
  if(!Number.isFinite(cur)) return [];
  return bossBoardNeighbors(String(nodeId))
    .filter(id=>{
      const d=Number(DIST_TO_GOAL.get(String(id)));
      return Number.isFinite(d)&&d<cur;
    })
    .sort((a,b)=>Number(DIST_TO_GOAL.get(String(a)))-Number(DIST_TO_GOAL.get(String(b))));
}

function chooseForwardDestinationForEvent(room,piece,{ownSnapshot=null,reservedOwn=null}={}){
  if(!piece?.nodeId) return null;
  const barriers=new Set((room.state.barricades||[]).map(String));
  const bossNodes=new Set(activeBossEntries(room).map(e=>String(e.boss?.nodeId||"")).filter(Boolean));
  const ownOccupied = ownSnapshot instanceof Set
    ? ownSnapshot
    : new Set((room.state.pieces||[])
        .filter(p=>p!==piece&&p?.posKind==="board"&&p?.color===piece.color&&p?.nodeId)
        .map(p=>String(p.nodeId)));
  const reserved = reservedOwn instanceof Set ? reservedOwn : new Set();
  let cursor=String(piece.nodeId);
  const seen=new Set([cursor]);
  for(let skip=0;skip<12;skip++){
    let choices=forwardChoices(cursor).filter(id=>!barriers.has(String(id))&&!bossNodes.has(String(id)));
    if(!choices.length) return null;
    const bestDist=Math.min(...choices.map(id=>Number(DIST_TO_GOAL.get(String(id)))));
    choices=choices.filter(id=>Number(DIST_TO_GOAL.get(String(id)))===bestDist);
    shuffleInPlace(choices);

    // Zielkollisionen mit einer bereits für dieselbe Farbe geplanten Figur vermeiden.
    // Wenn möglich, wird bei einer Verzweigung ein anderer gleichwertiger Weg genommen.
    const freeChoice=choices.find(id=>!reserved.has(String(id)));
    const next=String(freeChoice || choices[0]);

    // Wichtig für die Karte „Alle vorwärts!“: Die Belegung wird vom Zustand VOR
    // Beginn der Ereigniskarte genommen. Eine vordere eigene Figur wird deshalb
    // wirklich übersprungen, auch wenn sie in derselben Kartenaktion zuerst zieht.
    if(ownOccupied.has(next) || reserved.has(next)){
      if(seen.has(next)) return null;
      seen.add(next); cursor=next; continue;
    }
    return next;
  }
  return null;
}

function moveAllPiecesForwardEvent(room){
  const pcs=(room?.state?.pieces||[])
    .filter(p=>p?.posKind==="board"&&p?.nodeId)
    .sort((a,b)=>(Number(DIST_TO_GOAL.get(String(a.nodeId)))||9999)-(Number(DIST_TO_GOAL.get(String(b.nodeId)))||9999));

  // Snapshot der eigenen Figuren VOR der Kartenwirkung. So hängt „eigene Figur
  // überspringen“ nicht von der Reihenfolge ab, in der wir die Figuren abarbeiten.
  const ownByColor={};
  const reservedByColor={};
  for(const color of ALLOWED_COLORS){
    ownByColor[color]=new Set(pcs.filter(p=>p.color===color).map(p=>String(p.nodeId)));
    reservedByColor[color]=new Set();
  }

  let moved=0,kicked=0;
  for(const pc of pcs){
    if(pc.posKind!=="board"||!pc.nodeId) continue; // könnte vorher geschmissen worden sein
    const ownSnapshot=new Set(ownByColor[pc.color]||[]);
    ownSnapshot.delete(String(pc.nodeId));
    const reserved=reservedByColor[pc.color] || new Set();
    const dest=chooseForwardDestinationForEvent(room,pc,{ownSnapshot,reservedOwn:reserved});
    if(!dest) continue;

    for(const op of (room.state.pieces||[])){
      if(op!==pc&&op?.posKind==="board"&&op?.color!==pc.color&&String(op.nodeId||"")===String(dest)){
        sendPieceHome(room,op); kicked++;
      }
    }
    pc.nodeId=String(dest);
    reserved.add(String(dest));
    moved++;
  }
  return {text:`${moved} Figur${moved===1?"":"en"} bewegt${moved===1?" sich":"en sich"} Richtung Ziel.${kicked?` ${kicked} gegnerische Figur${kicked===1?" wurde":"en wurden"} dabei geschmissen.`:""}`};
}

function takeForcedEventMove(room,color){
  const b=ensureBossState(room); if(!b) return 0;
  const n=Math.max(0,Math.floor(Number(b.forcedMoveByColor?.[color]||0)));
  if(n>0) b.forcedMoveByColor[color]=0;
  return n;
}

function hasAnyLegalMoveForSteps(room,color,steps){
  const n=Math.max(1,Math.floor(Number(steps||0)));
  for(const pc of (room?.state?.pieces||[])){
    if(!pc||pc.color!==color) continue;
    const startField=STARTS[color];
    if(!startField) continue;
    if(pc.posKind==="house"){
      const remaining=n-1;
      if(remaining===0){
        const blocked=occupiedByColor(room,color,pc.id);
        if(!blocked.has(String(startField))) return true;
      }else if(remaining>0){
        const targets=computeAllTargets(room,startField,remaining,color,pc.id);
        if(targets.size) return true;
      }
    }else if(pc.posKind==="board"&&pc.nodeId){
      const targets=computeAllTargets(room,pc.nodeId,n,color,pc.id);
      if(targets.size) return true;
    }
  }
  return false;
}

function rewardBossHit(room,color){
  const b=ensureBossState(room);
  const bounty=!!b?.bountyNextBoss;
  const rewardCount=bounty?2:1;
  if(bounty) b.bountyNextBoss=false;

  if(room?.state?.action){
    const gained=[];
    for(let i=0;i<rewardCount;i++){
      const t=ACTION_JOKER_TYPES[Math.floor(Math.random()*ACTION_JOKER_TYPES.length)];
      addOwnedJoker(room.state.action,color,t,color,bounty?"boss_bounty":"boss");
      gained.push(t);
    }
    return bounty
      ? `Kopfgeld! Belohnung: 2 Joker (${gained.join(", ")}).`
      : `Belohnung: 1 ${gained[0]}-Joker.`;
  }
  if(b) b.rollModsByColor[color]=Math.min(2,Number(b.rollModsByColor[color]||0)+rewardCount);
  return bounty?"Kopfgeld! +2 auf deinen nächsten Wurf.":"Belohnung: +1 auf deinen nächsten Wurf.";
}

function damageBossSlot(room,slot,attackerColor,source="attack"){
  if(!slot?.boss) return {hit:false,defeated:false,text:"Kein Boss auf diesem Feld."};
  const boss=slot.boss; boss.hp=0; slot.boss=null;
  const reward=attackerColor?rewardBossHit(room,attackerColor):"";
  bossAction(room,"🏆","Boss besiegt",`${boss.icon} ${boss.name} wurde besiegt. ${reward}`.trim());
  return {hit:true,defeated:true,text:`🏆 ${boss.name} besiegt! ${reward}`.trim(),source};
}

// Spieler besiegen einen wandernden Boss, indem sie auf seinem aktuellen Feld landen.
function resolveBossBoardHit(room,landed,color){
  const b=ensureBossState(room); if(!b) return null;
  const slot=b.slots.find(s=>s?.boss?.nodeId && String(s.boss.nodeId)===String(landed||""));
  return slot?damageBossSlot(room,slot,color,"board_collision"):null;
}

function isBossDropFieldFree(room,nodeId,ignoreBarricadeNode=null){
  const id=String(nodeId||"");
  if(!id||NODES.get(id)?.kind!=="board"||id===String(GOAL||"")) return false;
  const starts=new Set(Object.values(STARTS||{}).map(String));
  if(starts.has(id)) return false;
  const barr=new Set((room?.state?.barricades||[]).map(String)); if(ignoreBarricadeNode) barr.delete(String(ignoreBarricadeNode));
  if(barr.has(id)) return false;
  const b=ensureBossState(room);
  if((b?.eventFields||[]).map(String).includes(id)) return false;
  for(const p of (room?.state?.pieces||[])) if(p?.posKind==="board"&&String(p.nodeId||"")===id) return false;
  for(const x of activeBossEntries(room)){ if(String(x.boss?.nodeId||"")===id) return false; }
  return true;
}

// Jäger/Schatten: tritt der Boss auf eine Barikade, wandert sie hinter ihn.
// Normalfall: zurück auf ein freies Feld seiner gerade gelaufenen Spur.
// Sonderfall Portal-Einstieg: dort gibt es noch kein vorheriges Brettfeld. Dann wird zuerst
// ein freies Nachbarfeld und nur im absoluten Notfall ein anderes freies Brettfeld verwendet.
// Die Anzahl bleibt in jedem Fall exakt gleich.
function bossRelocateBarricade(room,toNode,trail){
  const arr=room?.state?.barricades; if(!Array.isArray(arr)) return null;
  const to=String(toNode);
  const idx=arr.indexOf(to); if(idx<0) return null;
  const before=arr.length;
  const walked=(trail||[]).slice(0,-1).reverse().map(String);
  let dest=walked.find(id=>isBossDropFieldFree(room,id,to))||null;

  if(!dest){
    const trailSet=new Set((trail||[]).map(String));
    const neighbors=bossBoardNeighbors(to).filter(id=>!trailSet.has(String(id))&&isBossDropFieldFree(room,id,to));
    if(neighbors.length) dest=String(neighbors[Math.floor(Math.random()*neighbors.length)]);
  }

  if(!dest){
    const candidates=(BOARD.nodes||[])
      .filter(n=>n?.kind==="board")
      .map(n=>String(n.id))
      .filter(id=>id!==to&&isBossDropFieldFree(room,id,to));
    if(candidates.length) dest=String(candidates[Math.floor(Math.random()*candidates.length)]);
  }

  if(!dest) return null;
  arr[idx]=dest;
  if(arr.length!==before) throw new Error("Boss darf Barikadenanzahl nicht verändern");
  return {from:to,to:dest};
}

function setPieceToStart(room,piece){
  // Jäger-Treffer = wie normales Schmeißen im Barikade-Spiel:
  // Die getroffene Figur geht vollständig zurück ins Haus.
  sendPieceHome(room,piece);
}

function removeRandomShadowJoker(room,color){
  const action=room?.state?.action; if(!action) return null; ensureActionJokers(action);
  const arr=action.jokersOwned?.[color]; if(!Array.isArray(arr)||!arr.length) return null;
  const idx=Math.floor(Math.random()*arr.length); const [j]=arr.splice(idx,1); syncJokerCountsFromOwned(action); return j||null;
}
function addShadowBonusJokers(room,color,count=2){
  const action=room?.state?.action; const wheels=[]; if(!action) return wheels;
  const player=Array.from(room.players?.values?.()||[]).find(p=>p?.color===color);
  for(let i=0;i<count;i++){
    const result=ACTION_JOKER_TYPES[Math.floor(Math.random()*ACTION_JOKER_TYPES.length)];
    addOwnedJoker(action,color,result,color,"shadow_bonus");
    wheels.push({targetColor:color,jokerColor:color,result,durationMs:5000,attackerName:"Der Schatten",victimName:player?.name||"",headline:`👻 Schatten-Bonus für ${player?.name||String(color).toUpperCase()}`,quote:"Kein Joker vorhanden – du erhältst zwei neue Joker!",boss:true});
  }
  return wheels;
}

function applyShadowHit(room,color,wheels){
  const count=totalJokersForColor(room,color);
  if(count>0){
    const j=removeRandomShadowJoker(room,color);
    return `${String(color).toUpperCase()} verliert ${j?.type||"einen"} Joker.`;
  }
  const bonus=addShadowBonusJokers(room,color,2); wheels.push(...bonus);
  return `${String(color).toUpperCase()} hatte keinen Joker und erhält 2 zufällige Joker.`;
}

function bossPathScoreHits(room,path){
  const colors=new Set();
  for(const id of path||[]) for(const p of piecesOnBossNode(room,id)) colors.add(p.color);
  return colors.size;
}
function minDistanceFromNodeToTargets(nodeId,targets){
  let best=Infinity; for(const t of targets||[]){const p=bossShortestPath(nodeId,t);if(p)best=Math.min(best,p.length-1);} return best;
}

function enumerateBossPaths(startId,steps){
  const out=[];
  function dfs(node,left,visited,path){
    if(left<=0){out.push(path.slice());return;}
    const ns=bossBoardNeighbors(node).filter(n=>!visited.has(n));
    if(!ns.length){out.push(path.slice());return;}
    for(const nx of ns){visited.add(nx);path.push(nx);dfs(nx,left-1,visited,path);path.pop();visited.delete(nx);}
  }
  dfs(String(startId),Math.max(0,steps),new Set([String(startId)]),[String(startId)]); return out;
}

function chooseHunterRoute(room,entry){
  const boss=entry.boss, slot=entry.slot; const colors=activeBossColors(room);
  const targets=[]; for(const c of colors) targets.push(...bossTargetNodes(room,c));
  if(!targets.length) return [];
  if(!boss.nodeId){const a=chooseSpawnAnchor(slot,targets);return a?[a]:[];}
  let best=null;
  for(const t of targets){const p=bossShortestPath(boss.nodeId,t);if(p&&(!best||p.length<best.length))best=p;}
  return best&&best.length>1?[best[1]]:[];
}

function chooseShadowRoute(room,entry,steps=3){
  const boss=entry.boss,slot=entry.slot,targetColor=shadowTargetColor(room),targets=bossTargetNodes(room,targetColor);
  if(!targets.length) return [];
  let prefix=[]; let start=boss.nodeId; let left=steps;
  if(!start){const a=chooseSpawnAnchor(slot,targets); if(!a)return []; prefix=[a];start=a;left--;}
  if(left<=0) return prefix;
  const paths=enumerateBossPaths(start,left);
  let best=[],bestTargetHit=-1,bestHits=-1,bestDist=Infinity;
  for(const p of paths){
    const tail=p.slice(1); const full=prefix.concat(tail);
    let targetHit=0; for(const id of full){if(piecesOnBossNode(room,id).some(pc=>pc.color===targetColor))targetHit++;}
    const hits=bossPathScoreHits(room,full); const end=full[full.length-1]||start; const d=minDistanceFromNodeToTargets(end,targets);
    if(targetHit>bestTargetHit || (targetHit===bestTargetHit&&hits>bestHits) || (targetHit===bestTargetHit&&hits===bestHits&&d<bestDist)){
      best=full;bestTargetHit=targetHit;bestHits=hits;bestDist=d;
    }
  }
  return best;
}

function chooseCurseRoute(room,entry,steps=5){
  const boss=entry.boss,slot=entry.slot,lead=bossLeadingColor(room),leadTargets=bossTargetNodes(room,lead);
  const allTargets=[];for(const c of activeBossColors(room))allTargets.push(...bossTargetNodes(room,c));
  let prefix=[];let start=boss.nodeId;let left=steps;
  if(!start){const a=chooseSpawnAnchor(slot,allTargets.length?allTargets:leadTargets);if(!a)return [];prefix=[a];start=a;left--;}
  if(left<=0)return prefix;
  const paths=enumerateBossPaths(start,left);let best=[],bestHits=-1,bestDist=Infinity;
  for(const p of paths){
    const full=prefix.concat(p.slice(1)); const hits=bossPathScoreHits(room,full); const end=full[full.length-1]||start; const d=minDistanceFromNodeToTargets(end,leadTargets);
    if(hits>bestHits || (hits===bestHits&&d<bestDist)){best=full;bestHits=hits;bestDist=d;}
  }
  return best;
}

function executeBossRoute(room,entry,route){
  const boss=entry.boss; if(!boss||!Array.isArray(route)||!route.length) return {wheels:[],texts:[]};
  const b=ensureBossState(room); const wheels=[],texts=[],hitColors=new Set();
  const trail=[]; if(boss.nodeId) trail.push(String(boss.nodeId));
  for(const nodeIdRaw of route){
    const nodeId=String(nodeIdRaw); const prev=boss.nodeId?String(boss.nodeId):null;
    boss.lastNodeId=prev; boss.nodeId=nodeId; trail.push(nodeId);
    if(boss.type!=="curse"){
      const moved=bossRelocateBarricade(room,nodeId,trail);
      if(moved) texts.push(`Barikade ${moved.from} → ${moved.to}.`);
    }
    const pcs=piecesOnBossNode(room,nodeId);
    for(const pc of pcs){
      if(hitColors.has(pc.color)) continue; hitColors.add(pc.color);
      if(boss.type==="hunter"){
        setPieceToStart(room,pc); texts.push(`${String(pc.color).toUpperCase()} wird vom Jäger geschmissen und zurück ins Haus gesetzt.`);
      }else if(boss.type==="curse"){
        b.rollModsByColor[pc.color]=-2; texts.push(`${String(pc.color).toUpperCase()} wird verflucht: nächster Wurf −2.`);
      }else if(boss.type==="shadow"){
        texts.push(applyShadowHit(room,pc.color,wheels));
      }
    }
  }
  boss.lastPath=route.map(String); boss.lastMovedAt=Date.now();
  return {wheels,texts};
}

function moveBossEntry(room,entry,{forced=false}={}){
  const boss=entry?.boss;if(!boss)return {wheels:[],text:""};
  const def=BOSS_TYPES[boss.type];if(!def)return {wheels:[],text:""};
  const route=boss.type==="hunter"?chooseHunterRoute(room,entry):boss.type==="curse"?chooseCurseRoute(room,entry,def.steps):chooseShadowRoute(room,entry,def.steps);
  const res=executeBossRoute(room,entry,route);
  const where=boss.nodeId?` bis ${boss.nodeId}`:"";
  const extra=res.texts.length?` ${res.texts.join(" ")}`:"";
  bossAction(room,boss.icon,boss.name,`${forced?"Test: ":""}${route.length} Feld${route.length===1?"":"er"}${where}.${extra}`.trim());
  return {wheels:res.wheels,text:`${boss.icon} ${boss.name}: ${route.length} Felder${where}.`};
}

function bossSleepActiveNow(b){
  return !!b && Number(b.sleepActiveRound||0)===Number(b.round||0);
}

// Jäger bewegt sich NACH JEDEM Würfelwurf (auch bei Extra-/Neu-Wurf).
// Eine gezogene Schlaf-Karte betrifft niemals den Rest der laufenden Runde,
// sondern erst die nächste vollständig beginnende Spielrunde.
function bossAfterRoll(room){
  const b=ensureBossState(room);if(!b||bossSleepActiveNow(b))return [];
  const wheels=[];
  for(const e of activeBossEntries(room)) if(e.boss?.type==="hunter") wheels.push(...moveBossEntry(room,e).wheels);
  return wheels;
}

// Fluchmeister + Schatten bewegen sich einmal nach jeder vollständig abgeschlossenen Spielrunde.
// Schlaf wird rundenrein behandelt: Karte in Runde R -> komplette Runde R+1 schläft.
function bossTurnCompleted(room,endedColor){
  const b=ensureBossState(room);if(!b)return [];
  const active=activeBossColors(room); b.turnsInRound=Number(b.turnsInRound||0)+1;
  if(b.turnsInRound<active.length)return [];

  b.turnsInRound=0;
  const completedRound=Math.max(1,Number(b.round||1));
  const sleeping=bossSleepActiveNow(b);
  const wheels=[];

  if(sleeping){
    bossAction(room,"😴","Bossrunde ausgesetzt",`Runde ${completedRound}: Alle Bosse bleiben vollständig inaktiv.`);
  }else{
    for(const e of activeBossEntries(room)) if(e.boss?.type==="curse"||e.boss?.type==="shadow") wheels.push(...moveBossEntry(room,e).wheels);
  }

  // Erst NACH Abschluss der alten Runde beginnt die neue Runde.
  b.round=completedRound+1;
  b.sleepActiveRound=null;
  if(Number(b.sleepRounds||0)>0){
    b.sleepRounds=Math.max(0,Number(b.sleepRounds||0)-1);
    b.sleepActiveRound=b.round;
    bossAction(room,"😴","Bossruhe beginnt",`In Runde ${b.round} setzen alle Bosse ihre regulären Aktionen aus.`);
  }
  return wheels;
}

function advanceTurnWithEventSkips(room,endedColor){
  let wheels=[];
  const first=bossTurnCompleted(room,endedColor);
  if(Array.isArray(first)) wheels.push(...first);

  let next=nextTurnColor(room,endedColor);
  const b=ensureBossState(room);
  const active=activeBossColors(room);
  const skipped=[];
  let guard=0;

  while(b && next && active.includes(next) && Number(b.skipTurnsByColor?.[next]||0)>0 && guard<active.length){
    b.skipTurnsByColor[next]=Math.max(0,Number(b.skipTurnsByColor[next]||0)-1);
    skipped.push(next);
    bossAction(room,"⏸️","Spielzug ausgesetzt",`${String(next).toUpperCase()} setzt diesen vollständigen Spielzug aus.`);
    const bw=bossTurnCompleted(room,next);
    if(Array.isArray(bw)) wheels.push(...bw);
    next=nextTurnColor(room,next);
    guard++;
  }

  room.state.turnColor=next;
  return {wheels,skipped,next};
}

function drawBossEventCard(room,fieldId,color){
  const b=ensureBossState(room);
  if(!b||!b.eventFields.includes(String(fieldId))) return null;

  if(!b.deck.length){
    b.deck=EVENT_CARD_DEFS.map(c=>c.id);
    shuffleInPlace(b.deck);
    b.discard=[];
  }

  const cardId=String(b.deck.shift()||"");
  const card=EVENT_CARD_DEFS.find(c=>c.id===cardId)||EVENT_CARD_DEFS[0];
  b.discard.push(card.id);

  let effectText="";
  let wheels=[];
  const eff=card.effect;

  if(eff==="spawn_one"){
    const r=spawnBossesFromEvent(room,1); effectText=r.text; wheels.push(...(r.wheels||[]));
  }else if(eff==="spawn_two"){
    const r=spawnBossesFromEvent(room,2); effectText=r.text; wheels.push(...(r.wheels||[]));
  }else if(eff==="extra_roll"){
    room.state.extraRollPending=true;
    effectText="Du behältst den Zug und darfst nach diesem Zug erneut würfeln. Zusatzwürfe werden nicht mehrfach gestapelt.";
  }else if(eff==="roll_minus2"){
    b.rollModsByColor[color]=-2;
    effectText="Dein nächster Würfelwurf erhält −2. Das Ergebnis kann nicht unter 1 fallen; mehrere −2-Effekte stapeln sich nicht.";
  }else if(eff==="barrier_shuffle_all"){
    effectText=shuffleAllBarricadesEvent(room).text;
  }else if(eff==="boss_action_now"){
    const r=forceAllBossActions(room,{label:"Bossaktion durch Ereigniskarte"});
    effectText=r.text; wheels.push(...(r.wheels||[]));
  }else if(eff==="joker_one"){
    const r=grantRandomEventJokers(room,color,1,"event_one");
    effectText=r.text; wheels.push(...r.wheels);
  }else if(eff==="player_positions_shuffle"){
    effectText=shufflePlayerBoardPositions(room).text;
  }else if(eff==="boss_sleep"){
    b.sleepRounds=Math.max(0,Number(b.sleepRounds||0))+1;
    effectText="Alle Bosse setzen die nächste vollständige Bossrunde aus.";
  }else if(eff==="defeat_all_bosses"){
    effectText=defeatAllBossesEvent(room).text;
  }else if(eff==="walk10"){
    b.forcedMoveByColor[color]=10;
    effectText="Nach dieser Bewegung darfst du direkt eine eigene Figur genau 10 Felder bewegen.";
  }else if(eff==="boss_teleport"){
    effectText=teleportRandomBoss(room).text;
  }else if(eff==="bounty"){
    b.bountyNextBoss=true;
    effectText="Kopfgeld aktiv: Der nächste von einem Spieler besiegte Boss bringt 2 Joker statt 1.";
  }else if(eff==="barrier_wander3"){
    effectText=wanderBarricadesEvent(room,3).text;
  }else if(eff==="curse_wave"){
    effectText=curseWaveEvent(room).text;
  }else if(eff==="skip_next_turn"){
    b.skipTurnsByColor[color]=Math.max(0,Number(b.skipTurnsByColor[color]||0))+1;
    effectText="Du setzt deinen nächsten vollständigen Spielzug automatisch aus.";
  }else if(eff==="joker_two"){
    const r=grantRandomEventJokers(room,color,2,"event_two");
    effectText=r.text; wheels.push(...r.wheels);
  }else if(eff==="lose_all_jokers"){
    const lost=clearAllJokersForColor(room,color);
    effectText=lost?`Du verlierst alle deine Joker (${lost}).`:"Du hast keine Joker – die Karte ist wirkungslos.";
  }else if(eff==="all_pieces_forward"){
    effectText=moveAllPiecesForwardEvent(room).text;
  }else{
    effectText="Keine direkte Auswirkung.";
  }

  // Das betretene Ereignisfeld verschwindet sofort und wird an einer neuen Zufallsposition gespawnt.
  // Zu jedem anderen Ereignisfeld bleiben mindestens 3 Brett-Schritte Abstand.
  const respawnFieldId=respawnBossEventField(room,b,fieldId);
  effectText=`${effectText} Das Ereignisfeld verschwindet und erscheint zufällig an einer neuen Stelle.`.trim();

  const evt={
    seq:++b.eventSeq,cardId:card.id,icon:card.icon,title:card.title,text:card.text,effectText,
    fieldId:String(fieldId),respawnFieldId:respawnFieldId?String(respawnFieldId):null,
    color:String(color||""),ts:Date.now(),
    deckRemaining:b.deck.length,deckSize:EVENT_CARD_DEFS.length
  };
  if(wheels.length) evt.wheels=wheels;

  b.lastEvent=evt;
  b.history.push({seq:evt.seq,icon:evt.icon,title:evt.title,text:evt.effectText,ts:evt.ts,event:true});
  if(b.history.length>16)b.history.splice(0,b.history.length-16);
  return evt;
}

function roomUpdatePayload(room, playersOverride) {
  return {
    type: "room_update",
    players: Array.isArray(playersOverride) ? playersOverride : currentPlayersList(room),
    canStart: canStart(room),
    jokerAwardMode: (room.state && room.state.jokerAwardMode) ? room.state.jokerAwardMode : (room.jokerAwardMode || "thrower"),
    jokerStartCount: Number.isInteger(room?.jokerStartCount) ? room.jokerStartCount : null,
    allowedColors: ALLOWED_COLORS,
    allowedDiceStyles: ALLOWED_DICE_STYLES,
  };
}

// ---------- Firebase (optional, but recommended for 100% Restore) ----------
// IMPORTANT: We do NOT remove the existing disk save/restore.
// Firebase is an additional, durable persistence layer.
const FIREBASE_ENABLED = String(process.env.FIREBASE_ENABLED || "").trim() === "1";
const FIREBASE_COLLECTION = process.env.FIREBASE_COLLECTION || "rooms";


const STATS_COLLECTION = process.env.STATS_COLLECTION || "stats";
let firestore = null;

function parseServiceAccountFromEnv() {
  // Supports either:
  // - FIREBASE_SERVICE_ACCOUNT_JSON: raw JSON string
  // - FIREBASE_SERVICE_ACCOUNT_B64: base64 encoded JSON
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  try {
    if (raw && raw.trim().startsWith("{")) return JSON.parse(raw);
  } catch (_e) {}
  try {
    if (b64 && b64.trim().length > 10) {
      const json = Buffer.from(b64.trim(), "base64").toString("utf8");
      return JSON.parse(json);
    }
  } catch (_e) {}
  return null;
}

function initFirebaseIfConfigured() {
  try {
    if (firestore) return;
    const serviceAccount = parseServiceAccountFromEnv();
    // Robust: credentials alone are enough. FIREBASE_ENABLED=1 is still supported,
    // but a missing flag no longer disables statistics when credentials exist.
    if (!FIREBASE_ENABLED && !serviceAccount) return;
    if (!serviceAccount) {
      console.warn("[firebase] Firebase requested but no service account JSON found. Stats/persistence unavailable.");
      return;
    }
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    firestore = admin.firestore();
    console.log("[firebase] Firestore enabled for persistence");
  } catch (e) {
    console.warn("[firebase] init failed, falling back to disk only:", e?.message || e);
    firestore = null;
  }
}


 // ---------- Global Barikade Stats (Firestore) ----------
 // Requirements:
 // - count ONLY registered names (no "Gast")
 // - count a game when someone wins (including forfeit)
 // - store in Firebase (Firestore). If Firestore unavailable, stats are skipped (game never breaks).
 function normName(name){
   return String(name||"").trim().replace(/\s+/g," ").slice(0,32);
 }
 function isGuestName(name){
   const n = normName(name).toLowerCase();
   return !n || n === "gast" || n === "guest";
 }

 // ---------- Test Mode (Exclude from Stats) ----------
 // If a room is marked as test, we do NOT write roll/game stats to Firestore.
 // How a room becomes "test":
 // 1) Room code starts with one of TEST_ROOM_PREFIXES (default: "TEST")
 // 2) Host can toggle it in lobby via WS message: {type:"set_test_mode", isTest:true}
 const TEST_ROOM_PREFIXES = String(process.env.TEST_ROOM_PREFIXES || "TEST")
   .split(",")
   .map(s => s.trim().toUpperCase())
   .filter(Boolean);

 function isTestRoomCode(code){
   const c = normalizeRoomCode(code);
   if(!c) return false;
   for(const pref of TEST_ROOM_PREFIXES){
     if(pref && c.startsWith(pref)) return true;
   }
   return false;
 }

 function isTestRoom(room){
   try{
     if(room?.state && room.state.isTest === true) return true;
     if(room?.isTest === true) return true;
     return isTestRoomCode(room?.code);
   }catch(_e){
     return false;
   }
 }
 function statsDocId(name){
   return normName(name).toUpperCase().replace(/[^A-Z0-9_-]/g,"_").slice(0,64) || "UNKNOWN";
 }
 async function statsUpsert(name, patch){
   try{
     initFirebaseIfConfigured();
     if(!firestore) return false;
     const displayName = normName(name);
     if(isGuestName(displayName)) return false;

     const ref = firestore.collection(STATS_COLLECTION).doc(statsDocId(displayName));
     await firestore.runTransaction(async (tx) => {
       const snap = await tx.get(ref);
       const cur = snap.exists ? (snap.data()||{}) : {};
       const next = { ...cur };

       // Keep display name (last seen)
       next.name = displayName;

       // Apply numeric increments or sets
       for(const [k,v] of Object.entries(patch||{})){
         if(typeof v === "number" && isFinite(v)){
           next[k] = (typeof next[k]==="number" && isFinite(next[k])) ? next[k] + v : v;
         }else if(v != null){
           next[k] = v;
         }
       }

       // Defaults
       if(typeof next.games !== "number") next.games = 0;
       if(typeof next.wins !== "number") next.wins = 0;
       if(typeof next.forfeits !== "number") next.forfeits = 0;
       if(typeof next.rollCount !== "number") next.rollCount = 0;
       if(typeof next.rollSum !== "number") next.rollSum = 0;
       if(typeof next.playMs !== "number") next.playMs = 0;

       next.updatedAt = Date.now();
       tx.set(ref, next, { merge: true });
     });
     return true;
   }catch(e){
     console.warn("[stats] upsert failed:", e?.message||e);
     return false;
   }
 }
 function getPlayerNameByColor(room, color){
   try{
     color = String(color||"").toLowerCase();
     for(const p of room.players.values()){
       if(String(p?.color||"").toLowerCase() === color){
         return normName(p?.name);
       }
     }
   }catch(_e){}
   return "";
 }
 async function recordRollStat(room, color, value){
   const name = getPlayerNameByColor(room, color);
   if(isGuestName(name)) return;
   await statsUpsert(name, { rollCount: 1, rollSum: Number(value)||0 });
 }
 
 // ---------------- Match tracking (titles per finished game) ----------------
 function ensureMatchTrack(room){
   if(!room?.state) return;
   if(!room.state.matchTrack){
     const perPlayer = {};
     (room.players||[]).forEach(p=>{
       const nk = String(p.nameKey||"").trim();
       if(!nk) return;
       perPlayer[nk] = { kills:0, deaths:0, six:0, one:0, distance:0, turnSumMs:0, turnCount:0 };
     });
     room.state.matchTrack = { perPlayer, turnStartedAt: Date.now() };
   }
 }
 function ensureMatchPlayer(room, nameKey){
   ensureMatchTrack(room);
   if(!room?.state?.matchTrack) return null;
   const nk = String(nameKey||"").trim();
   if(!nk) return null;
   const per = room.state.matchTrack.perPlayer;
   if(!per[nk]) per[nk] = { kills:0, deaths:0, six:0, one:0, distance:0, turnSumMs:0, turnCount:0 };
   return per[nk];
 }
 function recordMatchRoll(room, color, value){
   const name = getPlayerNameByColor(room, color);
   if(!name || isGuestName(name)) return;
   const st = ensureMatchPlayer(room, name);
   if(!st) return;
   const v = Number(value)||0;
   if(v===1) st.one++;
   if(v===6) st.six++;
 }
 function recordMatchMove(room, color, steps){
   const name = getPlayerNameByColor(room, color);
   if(!name || isGuestName(name)) return;
   const st = ensureMatchPlayer(room, name);
   if(!st) return;
   st.distance += Math.max(0, Number(steps)||0);
 }

// Track joker usage per match (for titles). Server is chef.
function recordMatchJoker(room, color, type){
  const name = getPlayerNameByColor(room, color);
  if(!name || isGuestName(name)) return;
  const st = ensureMatchPlayer(room, name);
  if(!st) return;
  if(typeof st.jokersUsed !== "number") st.jokersUsed = 0;
  st.jokersUsed += 1;
  const k = String(type||"").toLowerCase();
  if(k){
    if(!st.jokersByType || typeof st.jokersByType !== "object") st.jokersByType = {};
    st.jokersByType[k] = (typeof st.jokersByType[k]==="number" ? st.jokersByType[k] : 0) + 1;
  }
}
 function recordMatchKick(room, attackerColor, victimColor){
   const attacker = getPlayerNameByColor(room, attackerColor);
   const victim   = getPlayerNameByColor(room, victimColor);
   if(attacker && !isGuestName(attacker)){
     const a = ensureMatchPlayer(room, attacker);
     if(a) a.kills++;
   }
   if(victim && !isGuestName(victim)){
     const v = ensureMatchPlayer(room, victim);
     if(v) v.deaths++;
   }
 }
 function recordMatchTurnTime(room, color, ms){
   const name = getPlayerNameByColor(room, color);
   if(!name || isGuestName(name)) return;
   const st = ensureMatchPlayer(room, name);
   if(!st) return;
   const capped = Math.max(0, Math.min(60000, Number(ms)||0)); // cap at 60s (AFK/reconnect safe)
   st.turnSumMs += capped;
   st.turnCount += 1;
 }
 function computeMatchAwards(room){
   ensureMatchTrack(room);
   const per = room?.state?.matchTrack?.perPlayer || {};
   const rows = Object.entries(per).map(([name, s])=>({
     name,
     kills: s.kills||0,
     deaths: s.deaths||0,
     six: s.six||0,
     one: s.one||0,
     distance: s.distance||0,
     jokersUsed: s.jokersUsed||0,
     avgTurnMs: (s.turnCount ? (s.turnSumMs/s.turnCount) : null)
   })).filter(r=>r.name && !isGuestName(r.name));

   const winnersMax = (key)=>{
     const max = rows.reduce((m,r)=>Math.max(m, r[key]??0), -Infinity);
     const ws = rows.filter(r=>(r[key]??0)===max).map(r=>r.name);
     return { value:max, winners:ws };
   };
   const winnersMinAvg = ()=>{
     const valid = rows.filter(r=>r.avgTurnMs!=null && isFinite(r.avgTurnMs));
     if(valid.length===0) return { value:null, winners:[] };
     const min = valid.reduce((m,r)=>Math.min(m, r.avgTurnMs), Infinity);
     const ws = valid.filter(r=>r.avgTurnMs===min).map(r=>r.name);
     return { value:min, winners:ws };
   };
   const winnersMaxAvg = ()=>{
     const valid = rows.filter(r=>r.avgTurnMs!=null && isFinite(r.avgTurnMs));
     if(valid.length===0) return { value:null, winners:[] };
     const max = valid.reduce((m,r)=>Math.max(m, r.avgTurnMs), -Infinity);
     const ws = valid.filter(r=>r.avgTurnMs===max).map(r=>r.name);
     return { value:max, winners:ws };
   };

   const a1 = winnersMax("kills");
   const a2 = winnersMax("deaths");
   const a3 = winnersMax("six");
   const a4 = winnersMax("one");
   const a5 = winnersMax("distance");
   const a8 = winnersMax("jokersUsed");
   const a6 = winnersMaxAvg();
   const a7 = winnersMinAvg();

   return [
     { id:"kills",    title:"👊 Rauswurf‑König",      unit:"Gegner rausgeworfen", value:a1.value, winners:a1.winners },
     { id:"deaths",   title:"🛡 Stehauf‑Männchen",    unit:"mal rausgeworfen",    value:a2.value, winners:a2.winners },
     { id:"six",      title:"🎲 Glückspilz",         unit:"× 6 gewürfelt",       value:a3.value, winners:a3.winners },
     { id:"one",      title:"🧊 Pechvogel",           unit:"× 1 gewürfelt",       value:a4.value, winners:a4.winners },
     { id:"distance", title:"🥾 Wanderer",            unit:"Felder gelaufen",     value:a5.value, winners:a5.winners },
     { id:"jokers",   title:"🃏 Joker‑Meister",       unit:"Joker genutzt",       value:a8.value, winners:a8.winners },
     { id:"slow",     title:"🐢 Vieldenker",          unit:"Ø Sekunden pro Zug",  value:a6.value!=null?Math.round(a6.value/100)/10:null, winners:a6.winners },
     { id:"fast",     title:"⚡ Blitzspieler",        unit:"Ø Sekunden pro Zug",  value:a7.value!=null?Math.round(a7.value/100)/10:null, winners:a7.winners },
   ];
 }
 // --------------------------------------------------------------------------

async function finalizeMatchStats(room, winnerColor, opts={}){
   try{
     if(!room?.state) return;
     if(isTestRoom(room)) return;
     if(room.state.statsFinalized) return;
     room.state.statsFinalized = true;

     const startedAt = Number(room.state.startedAt || 0) || 0;
     const finishedAt = Number(room.state.finishedAt || Date.now()) || Date.now();
     const playMs = Math.max(0, finishedAt - startedAt);

     const active = Array.isArray(room.state.activeColors) && room.state.activeColors.length ? room.state.activeColors : ALLOWED_COLORS;
     const winner = String(winnerColor||"").toLowerCase();

     for(const c of active){
       const name = getPlayerNameByColor(room, c);
       if(isGuestName(name)) continue;
       await statsUpsert(name, { games: 1, playMs });
     }

     const wName = getPlayerNameByColor(room, winner);
     if(!isGuestName(wName)){
       await statsUpsert(wName, { wins: 1 });
     }

     const forfeiter = String(opts.forfeiterColor||"").toLowerCase();
     if(forfeiter){
       const fName = getPlayerNameByColor(room, forfeiter);
       if(!isGuestName(fName)){
         await statsUpsert(fName, { forfeits: 1 });
       }
     }
   }catch(e){
     console.warn("[stats] finalize failed:", e?.message||e);
   }
 }


function docIdForRoom(code) {
  // Keep identical sanitization as disk filename
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 20) || "ROOM";
}


// ---------- Lobby Reservations (Name + Color Pre-Join) ----------
// Goal:
// - In the name-selection mask, show who already clicked a name ("ready") and who is already in-game.
// - Lock selected colors immediately for others.
// - Purely additive: does NOT change gameplay rules.
const LOBBY_TTL_MS = Number(process.env.LOBBY_TTL_MS || (30 * 60 * 1000)); // default 30 min

function nowMs(){ return Date.now(); }

function normalizeRoomCode(code){
  return String(code||"").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);
}

function ensureLobby(room){
  if(!room) return;
  if(!room.lobby || typeof room.lobby !== "object") room.lobby = { reservations:{}, colorLocks:{} };
  if(!room.lobby.reservations || typeof room.lobby.reservations !== "object") room.lobby.reservations = {};
  if(!room.lobby.colorLocks || typeof room.lobby.colorLocks !== "object") room.lobby.colorLocks = {};
}

function lobbyCleanup(room){
  try{
    ensureLobby(room);
    const t = nowMs();
    for(const [nameKey, r] of Object.entries(room.lobby.reservations)){
      if(!r || typeof r !== "object"){ delete room.lobby.reservations[nameKey]; continue; }
      const ts = Number(r.ts||0);
      if(ts && (t - ts) > LOBBY_TTL_MS){
        // release color lock
        const c = String(r.color||"").toLowerCase();
        if(c && room.lobby.colorLocks[c] === nameKey) delete room.lobby.colorLocks[c];
        delete room.lobby.reservations[nameKey];
      }
    }
    // remove stale colorLocks that point to missing reservation
    for(const [c, nameKey] of Object.entries(room.lobby.colorLocks)){
      if(!room.lobby.reservations[nameKey]) delete room.lobby.colorLocks[c];
    }
  }catch(_e){}
}

function lobbySnapshot(room){
  ensureLobby(room);
  lobbyCleanup(room);
  return {
    reservations: room.lobby.reservations,
    colorLocks: room.lobby.colorLocks,
    ts: nowMs()
  };
}

function reserveLobby(room, nameKey, color, status, diceStyle){
  ensureLobby(room);
  lobbyCleanup(room);
  const nk = String(nameKey||"").trim();
  if(!nk) return { ok:false, error:"NO_NAME" };
  const c = ALLOWED_COLORS.includes(String(color||"").toLowerCase()) ? String(color).toLowerCase() : null;
  const st = (status === "in_game") ? "in_game" : "lobby";

  // enforce unique color lock (if requested)
  if(c){
    const currentHolder = room.lobby.colorLocks[c];
    if(currentHolder && currentHolder !== nk){
      // If current holder is stale (not reserved anymore), allow
      if(!room.lobby.reservations[currentHolder]){
        delete room.lobby.colorLocks[c];
      } else {
        return { ok:false, error:"COLOR_TAKEN", holder: currentHolder };
      }
    }
  }

  // update reservation
  const prev = room.lobby.reservations[nk] || null;
  const rawDiceStyle = String(diceStyle || "").toLowerCase().trim();
  const ds = ALLOWED_DICE_STYLES.includes(rawDiceStyle) ? rawDiceStyle : normalizeDiceStyle(prev?.diceStyle || "classic");
  // if changing color, release previous lock
  if(prev && prev.color && prev.color !== c){
    const pc = String(prev.color).toLowerCase();
    if(room.lobby.colorLocks[pc] === nk) delete room.lobby.colorLocks[pc];
  }

  room.lobby.reservations[nk] = { ts: nowMs(), color: c, status: st, diceStyle: ds };
  if(c) room.lobby.colorLocks[c] = nk;
  return { ok:true };
}

// ---------- Match Stats safety guard ----------
// Some deployed versions call ensureMatchStats() during initGameState.
// If stats are not enabled in this build, we keep a safe no-op to avoid crashes.
function ensureMatchStats(_room){ /* no-op unless stats module is present */ }

// ---------- Save / Restore (best-effort) ----------
// NOTE: On some hosts (z.B. Render free) kann das Dateisystem nach Restart leer sein.
// Daher zusätzlich "Export/Import" über WebSocket (Host kann JSON herunterladen/hochladen).
const SAVE_DIR = process.env.SAVE_DIR || path.join(process.cwd(), "saves");
try { fs.mkdirSync(SAVE_DIR, { recursive: true }); } catch (_e) {}

function savePathForRoom(code){
  const safe = String(code||"").toUpperCase().replace(/[^A-Z0-9_-]/g,"").slice(0,20) || "ROOM";
  return path.join(SAVE_DIR, safe + ".json");
}

function persistedSeatSnapshot(room){
  try{
    if(!room || !(room.players instanceof Map)) return [];
    return Array.from(room.players.values())
      .filter(p => p && p.sessionToken && ALLOWED_COLORS.includes(String(p.color || "")))
      .map(p => ({
        name: String(p.name || "Spieler").slice(0, 32),
        color: String(p.color || ""),
        diceStyle: normalizeDiceStyle(p.diceStyle),
        isHost: !!p.isHost,
        sessionToken: String(p.sessionToken || "").slice(0, 60),
        lastSeen: Number(p.lastSeen || Date.now()) || Date.now(),
      }));
  }catch(_e){ return []; }
}

function restorePersistedSeats(room, seats, hostToken){
  try{
    if(!room) return;
    if(!(room.players instanceof Map)) room.players = new Map();
    if(hostToken) room.hostToken = String(hostToken).slice(0, 60);
    if(!Array.isArray(seats)) return;
    for(const seat of seats){
      const token = String(seat?.sessionToken || "").slice(0, 60);
      const color = String(seat?.color || "").toLowerCase();
      if(!token || !ALLOWED_COLORS.includes(color)) continue;
      const already = Array.from(room.players.values()).some(p => p?.sessionToken === token);
      if(already) continue;
      const id = `restored_${color}_${Math.random().toString(36).slice(2, 10)}`;
      room.players.set(id, {
        id,
        name: String(seat?.name || "Spieler").slice(0, 32),
        color,
        diceStyle: normalizeDiceStyle(seat?.diceStyle),
        isHost: !!seat?.isHost,
        sessionToken: token,
        lastSeen: Number(seat?.lastSeen || Date.now()) || Date.now(),
      });
    }
    if(room.hostToken){
      for(const p of room.players.values()) p.isHost = !!(p.sessionToken && p.sessionToken === room.hostToken);
    }
  }catch(_e){}
}

function restoreDerivedRuntimeState(room){
  try{
    if(!room?.state) return;
    const st = room.state;
    if(typeof st.extraRollPending !== "boolean"){
      st.extraRollPending = (Number(st.rolled) === 6) && (st.phase === "need_move" || st.phase === "place_barricade");
    }
    room.lastRollWasSix = !!st.extraRollPending;
  }catch(_e){}
}

// V11.7: Export/Import und Reconnect muessen dieselben Persistenz-Felder behalten
// wie ein normaler Firestore-/Disk-Restore. Dadurch gehen Boss-/Event-Zustaende
// (10-Felder-Zug, Kopfgeld, Bossruhe, Flueche, Deckstand, Joker usw.) beim
// manuellen Wiederherstellen nicht verloren oder bleiben in einem Altformat haengen.
function normalizeImportedGameState(room){
  try{
    if(!room?.state || typeof room.state !== "object") return;
    restoreDerivedRuntimeState(room);

    if(!room.state.carryingByColor || typeof room.state.carryingByColor !== "object"){
      room.state.carryingByColor={red:false,blue:false,green:false,yellow:false};
    }else{
      for(const c of ALLOWED_COLORS){
        if(typeof room.state.carryingByColor[c] !== "boolean") room.state.carryingByColor[c]=false;
      }
    }
    room.carryingByColor=room.state.carryingByColor;

    if(!Array.isArray(room.state.activeColors)) room.state.activeColors=[];
    if(!room.state.jokerAwardMode) room.state.jokerAwardMode="thrower";
    room.jokerAwardMode=room.state.jokerAwardMode;

    if(room.state.bossMode) ensureBossState(room);

    if(room.state.action){
      ensureActionJokers(room.state.action);
      if(!room.state.action.jokersOwned || typeof room.state.action.jokersOwned !== "object"){
        room.state.action.jokersOwned={red:[],blue:[],green:[],yellow:[]};
      }
      for(const c of ALLOWED_COLORS){
        if(!Array.isArray(room.state.action.jokersOwned[c])) room.state.action.jokersOwned[c]=[];
      }
      const emptyAll=ALLOWED_COLORS.every(c=>room.state.action.jokersOwned[c].length===0);
      if(emptyAll && room.state.action.jokersByColor){
        for(const c of ALLOWED_COLORS){
          const set=room.state.action.jokersByColor[c]||{};
          for(const t of ACTION_JOKER_TYPES){
            const v=set[t];
            const n=(v===true)?1:((typeof v==="number"&&isFinite(v))?Math.max(0,Math.floor(v)):0);
            for(let i=0;i<n;i++) room.state.action.jokersOwned[c].push({type:t,color:c,source:"legacy",ts:Date.now()});
          }
        }
      }
      syncJokerCountsFromOwned(room.state.action);
    }
  }catch(_e){}
}

async function persistRoomState(room){
  // Disk persistence (kept as fallback)
  try{
    if(!room || !room.code || !room.state) return;

    // Revision counter (monotonic, used for stale snapshot protection)
    if (typeof room.state.rev !== "number") room.state.rev = 0;
    room.state.rev += 1;

    const file = savePathForRoom(room.code);
    const payload = { code: room.code, ts: Date.now(), state: room.state, seats: persistedSeatSnapshot(room), hostToken: room.hostToken || null };
    fs.writeFileSync(file, JSON.stringify(payload));
  }catch(_e){}

  // Firestore persistence (durable)
  try{
    initFirebaseIfConfigured();
    if(!firestore || !room?.code || !room?.state) return;
    const docId = docIdForRoom(room.code);
    const now = Date.now();
    await firestore.collection(FIREBASE_COLLECTION).doc(docId).set({
      code: room.code,
      ts: now,
      rev: room.state.rev,
      state: room.state,
      seats: persistedSeatSnapshot(room),
      hostToken: room.hostToken || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }catch(e){
    // We do NOT throw: game continues. Disk fallback still exists.
    console.warn("[firebase] persist failed:", e?.message || e);
  }
}

async function restoreRoomState(room){
  // Prefer Firestore when enabled; otherwise disk.
  try{
    initFirebaseIfConfigured();
    if (firestore && room?.code) {
      const docId = docIdForRoom(room.code);
      const snap = await firestore.collection(FIREBASE_COLLECTION).doc(docId).get();
      const data = snap.exists ? snap.data() : null;
      if (data?.state && typeof data.state === "object") {
        room.state = data.state;
        restorePersistedSeats(room, data.seats, data.hostToken);
        restoreDerivedRuntimeState(room);
        // Backward-compat + safety defaults
        if (!room.state.carryingByColor || typeof room.state.carryingByColor !== "object") {
          room.state.carryingByColor = { red: false, blue: false, green: false, yellow: false };
        } else {
          // Backward-compat: fehlende Farben auffüllen
          for (const c of ALLOWED_COLORS) {
            if (typeof room.state.carryingByColor[c] !== "boolean") room.state.carryingByColor[c] = false;
          }
        }
        if (!Array.isArray(room.state.activeColors)) room.state.activeColors = [];
        if (!room.state.jokerAwardMode) room.state.jokerAwardMode = "thrower";
        room.jokerAwardMode = room.state.jokerAwardMode;
        if(room.state.bossMode){ ensureBossState(room); }
        room.carryingByColor = room.state.carryingByColor;

        // Action-Mode Joker backward-compat / defaults
        try{
          if (room.state.action) {
            ensureActionJokers(room.state.action);
            // If we restored an old snapshot without jokersOwned, rebuild it from counts/booleans.
            let hasOwned = room.state.action.jokersOwned && typeof room.state.action.jokersOwned === "object";
            if (!hasOwned) room.state.action.jokersOwned = { red: [], blue: [], green: [], yellow: [] };
            for (const c of ALLOWED_COLORS) {
              if (!Array.isArray(room.state.action.jokersOwned[c])) room.state.action.jokersOwned[c] = [];
            }
            // If owned arrays are empty but jokersByColor has counts, rebuild.
            const emptyAll = ALLOWED_COLORS.every(c => (room.state.action.jokersOwned[c].length === 0));
            if (emptyAll && room.state.action.jokersByColor) {
              for (const c of ALLOWED_COLORS) {
                const set = room.state.action.jokersByColor[c] || {};
                for (const t of ACTION_JOKER_TYPES) {
                  const v = set[t];
                  const n = (v===true) ? 1 : ((typeof v==="number" && isFinite(v)) ? Math.max(0, Math.floor(v)) : 0);
                  for (let i=0;i<n;i++){
                    room.state.action.jokersOwned[c].push({ type: t, color: c, source: "legacy", ts: Date.now() });
                  }
                }
              }
            }
            syncJokerCountsFromOwned(room.state.action);
          }
        }catch(_e){}
        return true;
      }
    }
  } catch (e) {
    console.warn("[firebase] restore failed, trying disk:", e?.message || e);
  }

  try{
    if(!room || !room.code) return false;
    const file = savePathForRoom(room.code);
    if(!fs.existsSync(file)) return false;
    const raw = fs.readFileSync(file, "utf8");
    const payload = JSON.parse(raw);
    if(payload && payload.state && typeof payload.state === "object"){
      room.state = payload.state;
      restorePersistedSeats(room, payload.seats, payload.hostToken);
      restoreDerivedRuntimeState(room);
      if (!room.state.carryingByColor || typeof room.state.carryingByColor !== "object") {
        room.state.carryingByColor = { red: false, blue: false, green: false, yellow: false };
      } else {
        for (const c of ALLOWED_COLORS) {
          if (typeof room.state.carryingByColor[c] !== "boolean") room.state.carryingByColor[c] = false;
        }
      }
      if (!Array.isArray(room.state.activeColors)) room.state.activeColors = [];
        if (!room.state.jokerAwardMode) room.state.jokerAwardMode = "thrower";
        room.jokerAwardMode = room.state.jokerAwardMode;
      // Disk-Restore muss dieselbe Boss-/Event-Migration erhalten wie Firestore-Restore.
      if(room.state.bossMode){ ensureBossState(room); }
      room.carryingByColor = room.state.carryingByColor;

        // Action-Mode Joker backward-compat / defaults
        try{
          if (room.state.action) {
            ensureActionJokers(room.state.action);
            // If we restored an old snapshot without jokersOwned, rebuild it from counts/booleans.
            let hasOwned = room.state.action.jokersOwned && typeof room.state.action.jokersOwned === "object";
            if (!hasOwned) room.state.action.jokersOwned = { red: [], blue: [], green: [], yellow: [] };
            for (const c of ALLOWED_COLORS) {
              if (!Array.isArray(room.state.action.jokersOwned[c])) room.state.action.jokersOwned[c] = [];
            }
            // If owned arrays are empty but jokersByColor has counts, rebuild.
            const emptyAll = ALLOWED_COLORS.every(c => (room.state.action.jokersOwned[c].length === 0));
            if (emptyAll && room.state.action.jokersByColor) {
              for (const c of ALLOWED_COLORS) {
                const set = room.state.action.jokersByColor[c] || {};
                for (const t of ACTION_JOKER_TYPES) {
                  const v = set[t];
                  const n = (v===true) ? 1 : ((typeof v==="number" && isFinite(v)) ? Math.max(0, Math.floor(v)) : 0);
                  for (let i=0;i<n;i++){
                    room.state.action.jokersOwned[c].push({ type: t, color: c, source: "legacy", ts: Date.now() });
                  }
                }
              }
            }
            syncJokerCountsFromOwned(room.state.action);
          }
        }catch(_e){}
      return true;
    }
  }catch(_e){}
  return false;
}

async function deletePersisted(room){
  // delete disk + firestore (if configured)
  try{
    if(!room || !room.code) return;
    const file = savePathForRoom(room.code);
    if(fs.existsSync(file)) fs.unlinkSync(file);
  }catch(_e){}

  try{
    initFirebaseIfConfigured();
    if(!firestore || !room?.code) return;
    const docId = docIdForRoom(room.code);
    await firestore.collection(FIREBASE_COLLECTION).doc(docId).delete();
  }catch(e){
    console.warn("[firebase] delete failed:", e?.message || e);
  }
}

// ---------- Rooms + Clients (müssen vor /health existieren) ----------
const clients = new Map(); // clientId -> {ws, room, name, sessionToken}
const rooms = new Map();   // code -> room

const app = express();

// CORS for GitHub Pages / mobile browsers (stats/presence endpoints).
// NOTE: WebSocket is unchanged; this only affects HTTP requests.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});
app.use(express.json({ limit: "200kb" }));
app.get("/", (_req, res) => res.status(200).send(`barikade-server ok · ${SERVER_BUILD}`));
app.get("/health", (_req, res) =>
  res.status(200).json({ ok: true, build: SERVER_BUILD, ts: Date.now(), rooms: rooms.size, clients: clients.size })
);





// --- Global Statistics (Lobby) ---
app.get("/stats", async (_req, res) => {
  try{
    initFirebaseIfConfigured();

    if(!firestore){
      return res.status(200).json({ ok:true, source:"none", rows: [], firebaseEnabled:FIREBASE_ENABLED, credentialsPresent:!!parseServiceAccountFromEnv() });
    }

    // Primary: composite sort (needs Firestore composite index)
    try{
      const snap = await firestore.collection(STATS_COLLECTION)
        .orderBy("wins","desc")
        .orderBy("games","desc")
        .limit(200)
        .get();

      const rows = [];
      snap.forEach(doc => {
        const d = doc.data() || {};
        const games = Number(d.games||0)||0;
        const wins = Number(d.wins||0)||0;
        const rollCount = Number(d.rollCount||0)||0;
        const rollSum = Number(d.rollSum||0)||0;
        const playMs = Number(d.playMs||0)||0;
        rows.push({
          name: String(d.name||doc.id),
          games,
          wins,
          forfeits: Number(d.forfeits||0)||0,
          avgRoll: rollCount ? (rollSum/rollCount) : 0,
          playMs,
          updatedAt: Number(d.updatedAt||0)||0,
        });
      });
      return res.status(200).json({ ok:true, source:"firestore", rows });
    }catch(e){
      // Fallback: if composite index missing, return a simpler ordering instead of failing.
      const msg = String(e?.message||e||"");
      const needsIndex = msg.includes("requires an index") || msg.includes("FAILED_PRECONDITION");
      if(!needsIndex) throw e;

      const snap = await firestore.collection(STATS_COLLECTION)
        .orderBy("wins","desc")
        .limit(200)
        .get();

      const rows = [];
      snap.forEach(doc => {
        const d = doc.data() || {};
        const games = Number(d.games||0)||0;
        const wins = Number(d.wins||0)||0;
        const rollCount = Number(d.rollCount||0)||0;
        const rollSum = Number(d.rollSum||0)||0;
        const playMs = Number(d.playMs||0)||0;
        rows.push({
          name: String(d.name||doc.id),
          games,
          wins,
          forfeits: Number(d.forfeits||0)||0,
          avgRoll: rollCount ? (rollSum/rollCount) : 0,
          playMs,
          updatedAt: Number(d.updatedAt||0)||0,
        });
      });
      return res.status(200).json({ ok:true, source:"firestore_fallback", rows, warning:"INDEX_MISSING" });
    }
  }catch(e){
    return res.status(500).json({ ok:false, error:"STATS_ERR", message: e?.message||String(e) });
  }
});

// --- Room presence (Lobby) ---
// Returns current players list for a room (no join, read-only).
app.get("/room/:code", (req, res) => {
  try {
    const code = String(req.params.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);
    if (!code) return res.status(400).json({ ok: false, error: "NO_CODE" });
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ ok: false, error: "NO_ROOM" });
    return res.status(200).json({ ok: true, ...roomUpdatePayload(room) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "ERR" });
  }
});

// Ensures the room exists (host can create the room before anyone opens the game).
app.post("/room/:code/ensure", (req, res) => {
  try {
    const code = String(req.params.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);
    if (!code) return res.status(400).json({ ok: false, error: "NO_CODE" });
    let room = rooms.get(code);
    if (!room) {
      room = makeRoom(code);
      rooms.set(code, room);
    }
    return res.status(200).json({ ok: true, code, rooms: rooms.size });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "ERR" });
  }
});

// --- Lobby presence/reservations (pre-join) ---
// Lets the lobby show: who clicked a name (ready) and which colors are locked.
app.get("/room/:code/presence", (req, res) => {
  try{
    const code = normalizeRoomCode(req.params.code);
    if(!code) return res.status(400).json({ ok:false, error:"NO_CODE" });
    const room = rooms.get(code);
    if(!room) return res.status(404).json({ ok:false, error:"NO_ROOM" });
    return res.status(200).json({ ok:true, code, ...lobbySnapshot(room), players: currentPlayersList(room) });
  }catch(_e){
    return res.status(500).json({ ok:false, error:"ERR" });
  }
});

app.post("/room/:code/reserve", (req, res) => {
  try{
    const code = normalizeRoomCode(req.params.code);
    if(!code) return res.status(400).json({ ok:false, error:"NO_CODE" });
    const room = rooms.get(code);
    if(!room) return res.status(404).json({ ok:false, error:"NO_ROOM" });

    const nameKey = String(req.body?.nameKey || req.body?.name || "").trim();
    const color = String(req.body?.color || "").toLowerCase().trim();
    const diceStyle = req.body?.diceStyle;
    const status = String(req.body?.status || "lobby").trim();

    const r = reserveLobby(room, nameKey, color, status, diceStyle);
    if(!r.ok) return res.status(409).json({ ok:false, ...r });

    return res.status(200).json({ ok:true, code, ...lobbySnapshot(room) });
  }catch(_e){
    return res.status(500).json({ ok:false, error:"ERR" });
  }
});


const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/** ---------- Board graph (server authoritative path + legality) ---------- **/
const boardPath = path.join(process.cwd(), "board.json");
const BOARD = JSON.parse(fs.readFileSync(boardPath, "utf-8"));
const NODES = new Map((BOARD.nodes || []).map(n => [n.id, n]));
const EDGES = BOARD.edges || [];
const ADJ = new Map();

for (const [a, b] of EDGES) {
  if (!ADJ.has(a)) ADJ.set(a, new Set());
  if (!ADJ.has(b)) ADJ.set(b, new Set());
  ADJ.get(a).add(b);
  ADJ.get(b).add(a);
}

const STARTS = BOARD.meta?.starts || {};
const GOAL = BOARD.meta?.goal || null;



// ---------- Distances to goal (for forfeit winner calculation) ----------
function computeDistancesFrom(startId){
  if(!startId) return new Map();
  const dist = new Map();
  const q = [startId];
  dist.set(startId, 0);
  for(let qi=0; qi<q.length; qi++){
    const u = q[qi];
    const du = dist.get(u);
    const ns = ADJ.get(u);
    if(!ns) continue;
    for(const v of ns){
      if(!dist.has(v)){
        dist.set(v, du+1);
        q.push(v);
      }
    }
  }
  return dist;
}
const DIST_TO_GOAL = computeDistancesFrom(GOAL);
const HOUSE_BY_COLOR = (() => {
  const map = { red: [], blue: [], green: [], yellow: [] };
  for (const n of BOARD.nodes || []) {
    if (n.kind !== "house") continue;
    const c = String(n.flags?.houseColor || "").toLowerCase();
    const slot = Number(n.flags?.houseSlot || 0);
    if (!map[c]) map[c] = [];
    map[c].push([slot, n.id]);
  }
  for (const c of Object.keys(map)) {
    map[c].sort((a, b) => a[0] - b[0]);
    map[c] = map[c].map(x => x[1]);
  }
  return map;
})();

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(2, 8);
}

/** ---------- Rooms ---------- **/
function makeRoom(code) {
  return {
    code,
    isTest: false, // host-toggleable test mode (excluded from stats)
    lobby: { reservations: {}, colorLocks: {} },
    hostToken: null, // stable host identity (sessionToken)
    // Socket index for this room (used for host-swap/reconnect messaging)
    clients: new Map(), // clientId -> ws
    players: new Map(), // clientId -> {id,name,color,isHost,sessionToken,lastSeen}
    state: null,
    jokerAwardMode: "thrower",
    jokerStartCount: null,
    lastRollWasSix: false,
    // Backward-compat field. Source of truth is room.state.carryingByColor
    // because only room.state is persisted to disk/Firebase.
    carryingByColor: { red: false, blue: false, green: false, yellow: false },
    // Reaktionen/Smilies: nur Laufzeitdaten, kein Einfluss auf den Spielstand.
    emojiCooldowns: new Map(),
    emojiSeq: 0,
  };
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isConnectedPlayer(p) {
  const c = clients.get(p.id);
  return !!(c?.ws && c.ws.readyState === 1);
}

function currentPlayersList(room) {
  return Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    color: p.color || null,
    diceStyle: normalizeDiceStyle(p.diceStyle),
    isHost: !!p.isHost,
    connected: isConnectedPlayer(p),
    lastSeen: p.lastSeen || null
  }));
}

function canStart(room) {
  const coloredConnected = Array.from(room.players.values()).filter(p => p.color && isConnectedPlayer(p));
  return coloredConnected.length >= 2;
}

function detachPlayerFromRoom(room, clientId, preserveSeat = true){
  try{
    if(!room) return;
    const p = room.players instanceof Map ? room.players.get(clientId) : null;
    if(room.clients instanceof Map) room.clients.delete(clientId);
    if(!(room.players instanceof Map)) return;
    room.players.delete(clientId);
    if(preserveSeat && room.state && p?.sessionToken && ALLOWED_COLORS.includes(String(p.color || ""))){
      const seatId = `offline_${String(p.color)}_${Math.random().toString(36).slice(2, 10)}`;
      room.players.set(seatId, { ...p, id: seatId, lastSeen: Date.now() });
    }
  }catch(_e){}
}

// Reconnect-Sicherheit:
// - Sobald weniger als 2 farbige Spieler verbunden sind, pausieren wir IMMER.
// - Entpausen passiert NUR explizit per Host-Button (msg.type === "resume").
function enforcePauseIfNotReady(room){
  try{
    if(!room?.state) return;
    const ready = canStart(room);
    if(!ready) room.state.paused = true;
  }catch(_e){}
}

// Legacy helper (auto-unpause ist absichtlich deaktiviert)
function resumeIfReady(room) {
  enforcePauseIfNotReady(room);
}


function broadcast(room, obj) {
  if (!room) return 0;
  const msg = JSON.stringify(obj);
  const sentSockets = new Set();
  let sent = 0;

  // 1) Per-room socket index. This is the normal realtime path.
  if (room.clients instanceof Map) {
    for (const ws of room.clients.values()) {
      if (!ws || ws.readyState !== 1 || sentSockets.has(ws)) continue;
      try {
        ws.send(msg);
        sentSockets.add(ws);
        sent++;
      } catch (_e) {}
    }
  }

  // 2) Global client index. Do NOT return after room.clients: on reconnects the
  // room index can briefly be stale while the global client already knows the room.
  const code = String(room.code || "").trim().toUpperCase();
  if (code) {
    for (const c of clients.values()) {
      if (String(c?.room || "").trim().toUpperCase() !== code) continue;
      const ws = c?.ws;
      if (!ws || ws.readyState !== 1 || sentSockets.has(ws)) continue;
      try {
        ws.send(msg);
        sentSockets.add(ws);
        sent++;
      } catch (_e) {}
    }
  }

  // 3) Player-index fallback for older/restored room records.
  if (room.players instanceof Map) {
    for (const p of room.players.values()) {
      const c = clients.get(p?.id);
      const ws = c?.ws;
      if (!ws || ws.readyState !== 1 || sentSockets.has(ws)) continue;
      try {
        ws.send(msg);
        sentSockets.add(ws);
        sent++;
      } catch (_e) {}
    }
  }

  return sent;
}


function send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch (_e) {}
}

// Defensive helper: accepts possibly-undefined ws and never throws.
// (We saw crashes when a reconnect/host-swap tried to message a socket
// that was already gone.)
function safeSend(ws, obj) {
  if (!ws || ws.readyState !== 1) return;
  try { ws.send(JSON.stringify(obj)); } catch (_e) {}
}


// ---------- Emoji / Smiley realtime broadcast ----------
// Wichtig: Fuer Reaktionen verlassen wir uns NICHT nur auf room.players/room.clients.
// Reconnects koennen diese Indizes kurzzeitig auseinanderlaufen. Deshalb wird ueber
// den globalen Client-Index an JEDEN aktuell verbundenen Socket desselben Raums gesendet.
function normalizeEmojiKey(value) {
  const v = String(value || "").trim();
  const low = v.toLowerCase();
  if (v === "😂" || low === "laugh") return "laugh";
  if (v === "😡" || low === "angry") return "angry";
  if (v === "😎" || low === "cool") return "cool";
  if (v === "💩" || low === "poop" || low === "shit") return "poop";
  return "";
}

function emojiGlyph(key) {
  if (key === "laugh") return "😂";
  if (key === "angry") return "😡";
  if (key === "cool") return "😎";
  if (key === "poop") return "💩";
  return "";
}

function broadcastEmojiToRoom(room, payload) {
  if (!room) return 0;
  const code = String(room.code || "").trim().toUpperCase();
  if (!code) return 0;
  const raw = JSON.stringify(payload);
  const sentSockets = new Set();
  let sent = 0;

  // PRIMARY: exakt derselbe Socket-Index, ueber den auch Spielzuege/Snapshots laufen.
  // Wenn das Spiel auf einem Geraet synchron ist, erreicht der Smiley es damit ebenfalls.
  if (room.clients && room.clients instanceof Map) {
    for (const ws of room.clients.values()) {
      if (!ws || ws.readyState !== 1 || sentSockets.has(ws)) continue;
      try {
        ws.send(raw);
        sentSockets.add(ws);
        sent++;
      } catch (_e) {}
    }
  }

  // FALLBACK: globale Client-Liste fuer Reconnect-/Index-Randfaelle.
  for (const c of clients.values()) {
    if (String(c?.room || "").trim().toUpperCase() !== code) continue;
    const ws = c?.ws;
    if (!ws || ws.readyState !== 1 || sentSockets.has(ws)) continue;
    try {
      ws.send(raw);
      sentSockets.add(ws);
      sent++;
    } catch (_e) {}
  }
  return sent;
}

function assignColorsRandom(room) {
  // remove offline placeholders on reset
  for (const p of Array.from(room.players.values())) {
    if (!isConnectedPlayer(p)) room.players.delete(p.id);
  }
  const connected = Array.from(room.players.values()).filter(p => isConnectedPlayer(p));
  for (const p of connected) p.color = null;
  if (connected.length === 0) return;
  if (connected.length > ALLOWED_COLORS.length) connected.length = ALLOWED_COLORS.length;

  // Zufällig verteilen, aber eindeutig
  shuffleInPlace(connected);
  const colors = [...ALLOWED_COLORS];
  shuffleInPlace(colors);
  for (let i = 0; i < connected.length; i++) {
    connected[i].color = colors[i];
  }
}

/** ---------- Game state ---------- **/
function initGameState(room, activeColors, mode = "classic", starterColor = null, jokerStartCount = null, bossMode = false) {
  // Normalize activeColors (colors that are actually participating in turn order).
  activeColors = Array.isArray(activeColors) && activeColors.length
    ? activeColors.map(c => String(c).toLowerCase())
    : null;

  if (!activeColors) {
    const fromState = room?.state?.activeColors;
    if (Array.isArray(fromState) && fromState.length) {
      activeColors = fromState.map(c => String(c).toLowerCase());
    }
  }

  if (!activeColors) {
    // Fallback: connected players with a chosen color, in stable order.
    const order = ["red","blue","green","yellow"];
    activeColors = order.filter(col => room.players && [...room.players.values()].some(p => p && p.color === col));
    if (!activeColors.length) activeColors = ["red","blue"]; // last-resort fallback
  }

  // pieces 5 per color in house
  // WICHTIG: Für 2–4 Spieler müssen alle 4 Farben echte Pieces im Server-State haben,
  // sonst kann z.B. Grün zwar würfeln, aber keine Figur auswählen/bewegen.
  const pieces = [];
  for (const color of ALLOWED_COLORS) {
    const houses = (BOARD.nodes || [])
      .filter(n => n.kind === "house" && String(n.flags?.houseColor || "").toLowerCase() === color)
      .sort((a, b) => (a.flags?.houseSlot ?? 0) - (b.flags?.houseSlot ?? 0));

    for (let i = 0; i < 5; i++) {
      pieces.push({
        id: `p_${color}_${i + 1}`,
        label: i + 1,
        color,
        posKind: "house",
        houseId: houses[i]?.id || houses[0]?.id || null,
        nodeId: null,
      });
    }
  }

  // barricades: all run nodes
  const barricades = (BOARD.nodes || [])
    .filter(n => n.kind === "board" && n.flags?.run)
    .map(n => n.id);

  // activeColors = die Farben, die beim Spielstart tatsächlich mitspielen
  // (2–4). Falls nicht angegeben, aus den verbundenen Spielern ableiten.
  const act = Array.isArray(activeColors) && activeColors.length
    ? activeColors.filter(c => ALLOWED_COLORS.includes(c))
    : ALLOWED_COLORS.filter(c => Array.from(room.players.values()).some(p => isConnectedPlayer(p) && p.color === c));

  // Fallback: mindestens 2 Farben erzwingen (damit Turn-Cycle nicht kaputt geht)
  const active = (act.length >= 2) ? act : ALLOWED_COLORS.slice(0, 2);

  // choose starter
  const sc = String(starterColor || "").toLowerCase().trim();
  const turnColor = (sc && active.includes(sc)) ? sc : (active[0] || "red");

  room.lastRollWasSix = false;
  // IMPORTANT: carrying must survive restart -> store in room.state (persisted)
  const carryingByColor = { red: false, blue: false, green: false, yellow: false };
  room.carryingByColor = carryingByColor; // backward-compat alias

  // ===== Joker-System =====
  // Im normalen Action-Modus starten die gewählten Joker wie bisher.
  // Im Bossmodus ist der Joker-Speicher ebenfalls aktiv (Startbestand 0), damit der Schatten
  // auch in einer sonst klassischen Partie Joker stehlen/verschenken kann.
  const gameMode = (String(mode || "classic").toLowerCase() === "action") ? "action" : "classic";
  const bossModeEnabled = !!bossMode;
  const baseJokerCount = (gameMode === "action")
    ? Math.max(1, Math.min(5, Number(jokerStartCount ?? room?.jokerStartCount ?? 1) || 1))
    : 0;

  // Action state lives fully on the server (persisted in room.state).
  // Client UI only reads this snapshot.
  const action = (gameMode === "action" || bossModeEnabled) ? {
    // Earned/base jokers live here (with origin color for display)
    jokersOwned: {
      red:    ACTION_JOKER_TYPES.flatMap(t => Array.from({ length: baseJokerCount }, () => ({ type: t, color: "red",    source: "base", ts: Date.now() }))),
      blue:   ACTION_JOKER_TYPES.flatMap(t => Array.from({ length: baseJokerCount }, () => ({ type: t, color: "blue",   source: "base", ts: Date.now() }))),
      green:  ACTION_JOKER_TYPES.flatMap(t => Array.from({ length: baseJokerCount }, () => ({ type: t, color: "green",  source: "base", ts: Date.now() }))),
      yellow: ACTION_JOKER_TYPES.flatMap(t => Array.from({ length: baseJokerCount }, () => ({ type: t, color: "yellow", source: "base", ts: Date.now() }))),
    },
    // Backward compat snapshot for UI (counts)
    jokersByColor: {
      red:      { allColors: baseJokerCount, barricade: baseJokerCount, reroll: baseJokerCount, double: baseJokerCount },
      blue:     { allColors: baseJokerCount, barricade: baseJokerCount, reroll: baseJokerCount, double: baseJokerCount },
      green:    { allColors: baseJokerCount, barricade: baseJokerCount, reroll: baseJokerCount, double: baseJokerCount },
      yellow:   { allColors: baseJokerCount, barricade: baseJokerCount, reroll: baseJokerCount, double: baseJokerCount },
    },
    // Active effects for the CURRENT turn only (cleared on end_turn)
    effects: {
      allColorsBy: null,   // color that may move any piece this turn
      barricadeBy: null,   // color that may move one barricade this turn
      doubleRoll: null,    // {kind:"sum2", by:"red", pending:true, rolls:[..], chosen?:n }
    },
    // version for future-proofing
    v: 2,
  } : null;

  const bossState = bossModeEnabled ? createBossState() : null;

  room.state = {
    started: true,
    isTest: (room.isTest === true) || isTestRoomCode(room.code),
    
    matchId: uid(),
    startedAt: Date.now(),
    statsFinalized: false,
paused: false,
    finished: false,
    winnerColor: null,
    finishedAt: null,
    mode: gameMode,
    bossMode: bossModeEnabled,
    boss: bossState,
    jokerStartCount: baseJokerCount,
    jokerAwardMode: (room.state && room.state.jokerAwardMode) ? room.state.jokerAwardMode : (room.jokerAwardMode || "thrower"),
    action,
    turnColor,
    phase: "need_roll", // need_roll | need_move | place_barricade
    rolled: null,
    extraRollPending: false, // persisted: survives server restart after rolling a 6
    eventMoveActive: null, // {color,steps,source} während "10 Felder laufen"
    pieces,
    barricades,
    goal: GOAL,
    carryingByColor,
    activeColors: active,

    // ---- Per-match tracking (for end-of-game title ceremony) ----
    matchTrack: (function(){
      const perPlayer = {};
      (room.players || []).forEach(p=>{
        // room.players is a Map; values contain {name,...}. nameKey is not guaranteed.
        const nk = String(p?.name || p?.nameKey || "").trim();
        if(!nk) return;
        perPlayer[nk] = { kills:0, deaths:0, six:0, one:0, distance:0, turnSumMs:0, turnCount:0 };
      });
      return { perPlayer, turnStartedAt: Date.now() };
    })(),
  };

  if(bossModeEnabled && room.state.boss){
    ensureBossEventFieldLayout(room,room.state.boss,true);
  }
}

function detectWinnerColor(room) {
  const goalId = room?.state?.goal || GOAL;
  if (!goalId) return null;
  const pcs = room?.state?.pieces;
  if (!Array.isArray(pcs)) return null;
  for (const p of pcs) {
    if (p && p.posKind === "board" && p.nodeId === goalId) return p.color || null;
  }
  return null;
}

function setGameOver(room, winnerColor) {
  if (!room || !room.state) return;
  if (room.state.finished) return;
  room.state.finished = true;
  room.state.winnerColor = String(winnerColor || "").toLowerCase() || null;
  room.state.finishedAt = Date.now();
  room.state.phase = "game_over";
  try{
    room.state.matchAwards = computeMatchAwards(room);
  }catch(_e){ room.state.matchAwards = []; }
}

function nextTurnColor(room, current) {
  const act = Array.isArray(room.state?.activeColors) && room.state.activeColors.length
    ? room.state.activeColors
    : ALLOWED_COLORS;
  const i = act.indexOf(current);
  if (i < 0) return act[0] || "red";
  return act[(i + 1) % act.length];
}
function getPiece(room, pieceId) {
  return room.state?.pieces?.find(p => p.id === pieceId) || null;
}

function occupiedByColor(room, color, excludePieceId = null) {
  const set = new Set();
  for (const p of room.state.pieces) {
    if (p.color !== color) continue;
    if (excludePieceId && p.id === excludePieceId) continue;
    if (p.posKind === "board" && p.nodeId) set.add(p.nodeId);
  }
  return set;
}

function occupiedAny(room) {
  const set = new Set();
  for (const p of room.state.pieces) {
    if (p.posKind === "board" && p.nodeId) set.add(p.nodeId);
  }
  return set;
}

function nextFreeHouseId(room, color) {
  const homes = HOUSE_BY_COLOR[color] || [];
  if (!homes.length) return null;

  const used = new Set();
  for (const p of room.state.pieces) {
    if (p.color === color && p.posKind === "house" && p.houseId) used.add(p.houseId);
  }
  for (const hid of homes) {
    if (!used.has(hid)) return hid;
  }
  return homes[0] || null;
}

function sendPieceHome(room, piece) {
  piece.posKind = "house";
  piece.nodeId = null;
  piece.houseId = nextFreeHouseId(room, piece.color);
}

function isPlacableBarricade(room, nodeId) {
  const n = NODES.get(nodeId);
  if (!n || n.kind !== "board") return false;

  // goal tabu
  if (n.flags?.goal) return false;

  // Ereignisfelder und aktuelle Bosspositionen bleiben sichtbar/frei.
  if(room?.state?.bossMode && room.state?.boss){
    const b=room.state.boss;
    if(Array.isArray(b.eventFields) && b.eventFields.map(String).includes(String(nodeId))) return false;
    if(Array.isArray(b.slots) && b.slots.some(slot=>String(slot?.boss?.nodeId||"")===String(nodeId))) return false;
  }

  // not on existing barricade / pieces
  if (room.state.barricades.includes(nodeId)) return false;
  if (occupiedAny(room).has(nodeId)) return false;

  return true;
}

/** ---------- Path + legality (exact steps, no immediate backtrack, no revisits) ---------- **/
function computeAllTargets(room, startNodeId, steps, color, pieceId) {
  const blockedEnd = occupiedByColor(room, color, pieceId); // cannot END on own piece
  const barricades = new Set(room.state.barricades || []);
  const targets = new Map(); // nodeId -> path array

  function dfs(node, depth, prevNode, visited, pathArr) {
    if (depth === steps) {
      if (!blockedEnd.has(node)) {
        if (!targets.has(node)) targets.set(node, [...pathArr]);
      }
      return;
    }
    const neigh = ADJ.get(node);
    if (!neigh) return;

    for (const nx of neigh) {
      if (prevNode && nx === prevNode) continue; // no immediate backtrack
      if (visited.has(nx)) continue;             // no revisits

      // barricade cannot be passed through; only land
      if (barricades.has(nx) && (depth + 1) < steps) continue;

      // end can't be own piece
      if ((depth + 1) === steps && blockedEnd.has(nx)) continue;

      visited.add(nx);
      pathArr.push(nx);
      dfs(nx, depth + 1, node, visited, pathArr);
      pathArr.pop();
      visited.delete(nx);
    }
  }

  const visited = new Set([startNodeId]);
  dfs(startNodeId, 0, null, visited, [startNodeId]);
  return targets;
}

function pathForTarget(room, piece, targetId) {
  const color = piece.color;
  const roll = room.state.rolled;
  // Doppelwurf kann 7–12 ergeben. Der Server setzt room.state.rolled,
  // daher ist es sicher, hier bis 12 zuzulassen.
  if (!(roll >= 1 && roll <= 12)) return { ok: false, msg: "no roll" };

  const startField = STARTS[color];
  if (!startField || !NODES.has(startField)) return { ok: false, msg: "missing start in board.meta.starts" };

  if (piece.posKind === "house") {
    const remaining = roll - 1;
    if (remaining < 0) return { ok: false, msg: "bad remaining" };

    if (remaining === 0) {
      if (targetId !== startField) return { ok: false, msg: "with roll=1 you must go to start" };
      return { ok: true, path: [startField] };
    }

    const targets = computeAllTargets(room, startField, remaining, color, piece.id);
    const p = targets.get(targetId);
    if (!p) return { ok: false, msg: "illegal target" };
    return { ok: true, path: p };
  }

  if (piece.posKind === "board") {
    const cur = piece.nodeId;
    if (!cur) return { ok: false, msg: "piece has no nodeId" };

    const targets = computeAllTargets(room, cur, roll, color, piece.id);
    const p = targets.get(targetId);
    if (!p) return { ok: false, msg: "illegal target" };
    return { ok: true, path: p };
  }

  return { ok: false, msg: "unknown piece pos" };
}

/** ---------- Protocol ---------- **/
function requireRoomState(room, ws) {
  if (!room.state) {
    send(ws, { type: "error", code: "NO_STATE", message: "Spiel nicht gestartet" });
    return false;
  }
  return true;
}

function requireTurn(room, clientId, ws) {
  const me = room.players.get(clientId);
  if (!me?.color) { send(ws, { type: "error", code: "SPECTATOR", message: "Du hast keine Farbe" }); return false; }
  if (room.state?.finished) {
    send(ws, { type: "error", code: "GAME_OVER", message: `Spiel beendet. Gewinner: ${(room.state.winnerColor || "?").toUpperCase()}` });
    return false;
  }
  if (room.state.paused) { send(ws, { type: "error", code: "PAUSED", message: "Spiel pausiert" }); return false; }
  if (room.state.turnColor !== me.color) {
    send(ws, { type: "error", code: "NOT_YOUR_TURN", message: `Nicht dran. Dran: ${room.state.turnColor.toUpperCase()}` });
    return false;
  }
  return true;
}

/** ---------- WebSocket ---------- **/
wss.on("connection", (ws) => {
  const clientId = uid();
  clients.set(clientId, { ws, room: null, name: null, sessionToken: null });
  send(ws, { type: "hello", clientId });

  ws.on("message", async (buf) => {
    let msg;
    try { msg = JSON.parse(String(buf)); } catch (_e) { return; }
    const c = clients.get(clientId);
    if (!c) return;

    if (msg.type === "ping") { send(ws, { type: "pong" }); return; }

    // ---------- JOIN ----------
    if (msg.type === "join") {
      const roomCode = String(msg.room || "").trim().toUpperCase();
      const name = String(msg.name || "Spieler").slice(0, 32);
      const asHost = !!msg.asHost;
      const sessionToken = String(msg.sessionToken || "").slice(0, 60);
      const requestedColor = String(msg.requestedColor || "").toLowerCase().trim();
      const requestedDiceStyle = normalizeDiceStyle(msg.requestedDiceStyle || "classic");

      if (!roomCode) { send(ws, { type: "error", code: "NO_ROOM", message: "Kein Raumcode" }); return; }

      // leave old room; a running match keeps the colored seat reserved for reconnect
      if (c.room) {
        const old = rooms.get(c.room);
        if (old) {
          detachPlayerFromRoom(old, clientId, true);
          broadcast(old, roomUpdatePayload(old));
          if(old.state) await persistRoomState(old);
        }
      }

      // get/create room
      let room = rooms.get(roomCode);
      if (!room) { room = makeRoom(roomCode); rooms.set(roomCode, room); }
      // hotfix: ensure per-room ws map exists (prevents crashes after restore)
      if (!room.clients || !(room.clients instanceof Map)) room.clients = new Map();

      // If server restarted / room.state missing, try to restore from disk (best-effort)
      if (!room.state) {
        const restored = await restoreRoomState(room);
        if (restored) {
          console.log(`[restore] room=${roomCode} restored state (firebase/disk)`);
        }
      }

      // reconnect via sessionToken
      let existing = null;
      if (sessionToken) {
        for (const p of room.players.values()) {
          if (p.sessionToken && p.sessionToken === sessionToken) { existing = p; break; }
        }
      }
      if (existing) {
        // Prevent a NEW client from kicking a currently-connected player that uses the same sessionToken.
        // If the old one is truly disconnected, reconnect still works (old ws not in room.clients).
        const existingWs = (room.clients && room.clients.get) ? room.clients.get(existing.id) : null;
        if (existingWs && existingWs.readyState === 1 && existing.id !== clientId) {
          safeSend(ws, { t: "error", code: "DUPLICATE_SESSION", message: "Diese Sitzung ist bereits verbunden (Session bereits aktiv)." });
          try { ws.close(4000, "DUPLICATE_SESSION"); } catch (_) {}
          return;
        }
        room.players.delete(existing.id);
      }
      const existingColor = existing?.color || null;

      
// host assignment (stable, server-chef):
// - host is bound to room.hostToken (sessionToken)
// - prevents race condition when BOTH players reconnect
let isHost = false;

// Establish hostToken once (first host join with sessionToken)
if (!room.hostToken) {
  if (existing?.isHost && existing?.sessionToken) {
    room.hostToken = existing.sessionToken;
  } else if (asHost && sessionToken) {
    room.hostToken = sessionToken;
  }
}

// Determine host strictly by token
if (room.hostToken && sessionToken && sessionToken === room.hostToken) {
  isHost = true;
}

// Ensure single-host: if true host joins, clear host flag on all others
if (isHost) {
  for (const p of room.players.values()) p.isHost = false;
}

// color assignment
// IMPORTANT CHANGE (requested):
// - KEINE automatische Farbe mehr beim Join.
// - Jeder (auch Host) waehlt seine Farbe aktiv in der Lobby.
// - Reconnect via sessionToken behaelt die vorherige Farbe.
// - Wunschfarbe kann beim Join mitgeschickt werden (requestedColor) und wird nur gesetzt,
//   wenn der Slot frei ist.
//
// Das aktuelle Board/Game-Logic unterstützt alle vier Farben aus ALLOWED_COLORS.

// If reconnecting via sessionToken, keep the exact previous color
let color = existing?.color || null;

// V10.6: Once a match exists, colored seats stay reserved for their sessionToken.
const matchSeatsLocked = !!room.state;
if(!matchSeatsLocked){
  for (const p of Array.from(room.players.values())) {
    if (p.color && !isConnectedPlayer(p)) room.players.delete(p.id);
  }
}

const requiredSeatColors = matchSeatsLocked && Array.isArray(room.state?.activeColors)
  ? room.state.activeColors.map(c => String(c || "").toLowerCase()).filter(c => ALLOWED_COLORS.includes(c))
  : [];
const tokenSeatColors = new Set(Array.from(room.players.values())
  .filter(p => p && p.sessionToken && ALLOWED_COLORS.includes(String(p.color || "")))
  .map(p => String(p.color).toLowerCase()));
const seatRosterComplete = requiredSeatColors.length >= 2 && requiredSeatColors.every(c => tokenSeatColors.has(c));

if(matchSeatsLocked && seatRosterComplete && !existing){
  send(ws, { type: "error", code: "MATCH_LOCKED", message: "Dieses Spiel läuft bereits. Bitte mit der ursprünglichen Sitzung erneut verbinden." });
  return;
}

// Migration path for old V10.5 saves that did not persist seat tokens yet:
// only the original active colors may reclaim a still-unbound seat.
if(matchSeatsLocked && !seatRosterComplete && !existing && requiredSeatColors.length){
  const want = ALLOWED_COLORS.includes(requestedColor) ? requestedColor : null;
  if(!want || !requiredSeatColors.includes(want) || tokenSeatColors.has(want)){
    send(ws, { type: "error", code: "MATCH_RECOVERY_COLOR", message: "Für diesen alten Spielstand muss die ursprüngliche Spielerfarbe verwendet werden." });
    return;
  }
}

// Max 4 gleichzeitig verbundene Spieler pro Raum
{
  const connectedCount = Array.from(room.players.values()).filter(p => isConnectedPlayer(p)).length;
  if (!existing && connectedCount >= ALLOWED_COLORS.length) {
    send(ws, { type: "error", code: "ROOM_FULL", message: `Raum ist voll (max ${ALLOWED_COLORS.length} Spieler).` });
    return;
  }
}

// If not reconnecting, honor requestedColor ONLY if free
if (!color) {
  const usedNow = new Set(Array.from(room.players.values()).map(p => p.color).filter(Boolean));
  const want = ALLOWED_COLORS.includes(requestedColor) ? requestedColor : null;
  if (want && !usedNow.has(want)) {
    color = want;
  } else {
    // stay spectator until player actively chooses
    color = null;
  }
}

const diceStyle = msg.requestedDiceStyle ? requestedDiceStyle : normalizeDiceStyle(existing?.diceStyle || requestedDiceStyle);
room.players.set(clientId, { id: clientId, name, color, diceStyle, isHost, sessionToken, lastSeen: Date.now() });
	      // Auto-unpause deaktiviert: Fortsetzen nur per Host (resume)
	      c.room = roomCode; c.name = name; c.sessionToken = sessionToken;
	      // keep per-room socket map in sync (host-swap/reconnect depends on it)
	      room.clients.set(clientId, ws);

// Lobby presence: mark name as in_game and lock chosen color (if any)
try{
  ensureLobby(room);
  const nk = typeof normalizeNameKey === "function" ? (normalizeNameKey(name) || name) : name;
  // only lock canonical names + Gast if provided
  reserveLobby(room, nk, color, "in_game", diceStyle);
}catch(_e){}


      // Reconnect-Sicherheit: Wenn noch nicht wieder 2 Spieler verbunden sind,
      // pausieren wir den Raum sofort (auch nach Server-Restart/Restore).
      if (room.state) {
        enforcePauseIfNotReady(room);
        await persistRoomState(room);
      }

      console.log(`[join] room=${roomCode} name=${name} host=${isHost} color=${color} dice=${diceStyle} existing=${!!existing}`);

      send(ws, roomUpdatePayload(room));
      broadcast(room, roomUpdatePayload(room));


      if (room.state) send(ws, { type: "snapshot", state: room.state });
      return;
    }

    // ---------- ALL OTHER MESSAGES NEED ROOM ----------
    const roomCode = c.room;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    // hotfix: ensure per-room ws map exists (prevents crashes)
    if (!room.clients || !(room.clients instanceof Map)) room.clients = new Map();
    if (!room.emojiCooldowns || !(room.emojiCooldowns instanceof Map)) room.emojiCooldowns = new Map();

    // ---------- EMOJI / SMILEY V9: SERVER IST ALLEINIGER CHEF ----------
    // Client sendet nur einen Wunsch. Ausschliesslich der Server erzeugt den
    // Anzeige-Befehl und verteilt ihn an ALLE aktuell verbundenen Sockets im Raum.
    if (msg.type === "emoji_request") {
      console.log(`[emoji-v9.2] REQUEST_RECEIVED room=${room.code} client=${clientId} rawEmoji=${String(msg.emoji || "")}`);
      const me = room.players.get(clientId);
      if (!me) {
        send(ws, { type:"error", code:"NO_PLAYER", message:"Spieler nicht gefunden" });
        return;
      }

      const key = normalizeEmojiKey(msg.emoji);
      if (!key) {
        send(ws, { type:"error", code:"BAD_EMOJI", message:"Ungueltiges Emoji" });
        return;
      }

      const now = Date.now();
      const cooldownKey = String(me.sessionToken || clientId);
      const last = Number(room.emojiCooldowns.get(cooldownKey) || 0);
      if ((now - last) < 900) return;
      room.emojiCooldowns.set(cooldownKey, now);
      room.emojiSeq = Number(room.emojiSeq || 0) + 1;

      // Event-ID wird ausschliesslich vom Server erzeugt.
      const eventId = `emoji:${room.code}:${now}:${room.emojiSeq}`;
      const senderName = me.name || c.name || "Spieler";
      const command = {
        type: "emoji_show",
        eventId,
        room: room.code,
        playerId: clientId,
        senderId: clientId,
        senderName,
        name: senderName,
        emoji: key,
        icon: emojiGlyph(key),
        ts: now,
        serverCommand: true
      };

      // EIN Server-Befehl, EIN Broadcast-Weg, ALLE Sockets des Raums.
      const delivered = broadcastEmojiToRoom(room, command);
      const roomSockets = room.clients instanceof Map
        ? Array.from(room.clients.values()).filter(s => s?.readyState === 1).length
        : 0;
      const globalRoomSockets = Array.from(clients.values()).filter(cc =>
        String(cc?.room || "").trim().toUpperCase() === String(room.code || "").trim().toUpperCase() &&
        cc?.ws?.readyState === 1
      ).length;

      // Diagnose nur an den Absender: damit sehen wir im Browser, ob der Server den
      // Request wirklich verarbeitet hat und wie viele aktive Sockets er erreicht hat.
      send(ws, {
        type:"emoji_debug",
        stage:"server_broadcast",
        eventId,
        room:room.code,
        delivered,
        roomSockets,
        globalRoomSockets,
        players:room.players.size,
        ts:Date.now()
      });

      console.log(`[emoji-v9.2] BROADCAST room=${room.code} sender=${senderName} key=${key} event=${eventId} delivered=${delivered} players=${room.players.size} roomSockets=${roomSockets} globalRoomSockets=${globalRoomSockets}`);
      return;
    }

    if (msg.type === "leave") {
      detachPlayerFromRoom(room, clientId, true);
      c.room = null;
      send(ws, roomUpdatePayload(room, []));
      broadcast(room, roomUpdatePayload(room));
      if(room.state) await persistRoomState(room);
      return;
    }


    // ---------- CLAIM COLOR (DEPRECATED) ----------
    // Früher konnte der Host Slots anderen Spielern zuweisen.
    // Neuer Standard (dein Wunsch): Jeder wählt seine Farbe selbst in der Lobby.
    // Wir lassen den Message-Typ existieren, damit alte Clients nicht crashen,
    // aber wir blocken die Aktion mit einer klaren Fehlermeldung.
    if (msg.type === "claim_color") {
      send(ws, {
        type: "error",
        code: "DEPRECATED",
        message: "Slot-Zuweisung durch Host ist deaktiviert. Jeder Spieler wählt seine Farbe selbst (Lobby).",
      });
      return;
    }

    // ---------- REQUEST COLOR (Self, lobby only) ----------
    // Additive feature: player can request a preferred color BEFORE the game starts.
    // Does NOT remove/replace any existing logic (reconnect, pause/resume, save/restore stay unchanged).
    if (msg.type === "request_color") {
      // only in lobby (no running state yet)
      if (room.state) {
        send(ws, { type: "error", code: "GAME_STARTED", message: "Farbe nur vor Spielstart wählbar" });
        return;
      }

      const me = room.players.get(clientId);
      if (!me || !isConnectedPlayer(me)) {
        send(ws, { type: "error", code: "BAD_PLAYER", message: "Spieler nicht verbunden" });
        return;
      }

      const targetColor = String(msg.color || msg.targetColor || "").toLowerCase().trim();
      if (!ALLOWED_COLORS.includes(targetColor)) {
        send(ws, { type: "error", code: "BAD_COLOR", message: "Ungültige Farbe" });
        return;
      }

      // If I'm already that color -> ok
      if (me.color === targetColor) {
        send(ws, roomUpdatePayload(room));
        return;
      }

      // Check if slot is held
      let holderId = null;
      for (const p of room.players.values()) {
        if (p.color === targetColor) { holderId = p.id; break; }
      }
      if (holderId) {
        const holder = room.players.get(holderId);
        // connected holder blocks
        if (holder && isConnectedPlayer(holder)) {
          send(ws, { type: "error", code: "SLOT_IN_USE", message: "Slot ist gerade belegt" });
          return;
        }
        // offline placeholder -> remove
        if (holder && !isConnectedPlayer(holder)) room.players.delete(holderId);
      }

      // assign
      me.color = targetColor;

      

// Also lock the color in lobby reservations so other devices see it immediately.
try{
  reserveLobby(room, typeof normalizeNameKey === "function" ? (normalizeNameKey(me.name) || me.name) : me.name, targetColor, "lobby", me.diceStyle);
}catch(_e){}
broadcast(room, roomUpdatePayload(room));
      await persistRoomState(room);
      return;
    }

    
    
    // ---------- TEST MODE (Host, lobby only) ----------
    // Additive: lets the host flag a room as "test" so roll/game stats are NOT recorded.
    // Safe: does not change gameplay; only affects Firestore stats writes.
    if (msg.type === "set_test_mode") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host" }); return; }
      if (room.state) { send(ws, { type: "error", code: "GAME_STARTED", message: "Testmodus nur vor Spielstart" }); return; }
      room.isTest = !!(msg.isTest ?? msg.value ?? msg.enabled);
      broadcast(room, { type: "test_mode", isTest: room.isTest, prefixes: TEST_ROOM_PREFIXES });
      broadcast(room, roomUpdatePayload(room));
      return;
    }


    if (msg.type === "set_joker_start_count") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host kann die Joker-Anzahl ändern" }); return; }
      if (room.state) { send(ws, { type: "error", code: "GAME_STARTED", message: "Joker-Anzahl nur vor Spielstart" }); return; }

      const count = Number(msg.count);
      if (!Number.isInteger(count) || count < 1 || count > 5) {
        send(ws, { type: "error", code: "BAD_JOKER_COUNT", message: "Bitte 1 bis 5 Joker wählen" });
        return;
      }

      room.jokerStartCount = count;
      broadcast(room, roomUpdatePayload(room));
      return;
    }

// ---------- JOKER AWARD MODE ----------
    if (msg.type === "set_award_mode") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host kann den Modus ändern" }); return; }

      const mode = (msg.mode === "victim") ? "victim" : "thrower";
      room.jokerAwardMode = mode;
      if (room.state) room.state.jokerAwardMode = mode;

      broadcast(room, roomUpdatePayload(room));
      if (room.state) await persistRoomState(room);
      return;
    }

// ---------- START / RESET ----------

    if (msg.type === "start_request") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host kann starten" }); return; }
      if (room.state) { send(ws, { type: "error", code: "GAME_EXISTS", message: "Es existiert bereits eine Partie. Nutze Revanche oder Reset." }); return; }
      if (!canStart(room)) { send(ws, { type: "error", code: "NEED_2P", message: "Mindestens 2 Spieler nötig" }); return; }

      // aktive Farben anhand verbundener Spieler (mit gewählter Farbe)
      const act = Array.from(room.players.values())
        .filter(p => isConnectedPlayer(p) && ALLOWED_COLORS.includes(p.color))
        .map(p => p.color);
      const uniqueAct = ALLOWED_COLORS.filter(c => act.includes(c));
      if (uniqueAct.length < 2) {
        send(ws, { type: "error", code: "NEED_COLORS", message: "Mindestens 2 Spieler müssen eine Farbe wählen" });
        return;
      }

      // Server entscheidet zufällig die Startfarbe (Quelle der Wahrheit)
      const starterColor = uniqueAct[Math.floor(Math.random() * uniqueAct.length)];
      const requestedMode = String(msg.mode || "classic").toLowerCase() === "action" ? "action" : "classic";
      const requestedBossMode = !!(msg.bossMode ?? msg.actionBossMode ?? false);

      // V9.5: Jokerzahl atomar mit start_request übernehmen. Damit muss sie nicht
      // vorher in einem separaten Request angekommen sein. Classic braucht keine Jokerzahl.
      let jokerStartCount = null;
      if (requestedMode === "action") {
        const incomingCount = Number(msg.jokerStartCount ?? room.jokerStartCount);
        if (!Number.isInteger(incomingCount) || incomingCount < 1 || incomingCount > 5) {
          send(ws, { type: "error", code: "NEED_JOKER_COUNT", message: "Host muss zuerst die Joker-Anzahl 1 bis 5 wählen" });
          return;
        }
        jokerStartCount = incomingCount;
        room.jokerStartCount = incomingCount;
      }

      // pending info (nur im RAM, kein Persist nötig)
      room._pendingStart = { starterColor, mode: requestedMode, bossMode: requestedBossMode, jokerStartCount, activeColors: uniqueAct.slice(), ts: Date.now() };

      broadcast(room, { type: "start_spin", activeColors: uniqueAct, starterColor, mode: requestedMode, bossMode: requestedBossMode, jokerStartCount, durationMs: 4200 });
      return;
    }

    if (msg.type === "start") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host kann starten" }); return; }
      if (room.state) { room._pendingStart = null; send(ws, { type: "error", code: "GAME_EXISTS", message: "Es existiert bereits eine Partie. Nutze Revanche oder Reset." }); return; }
      if (!canStart(room)) { send(ws, { type: "error", code: "NEED_2P", message: "Mindestens 2 Spieler nötig" }); return; }

      // aktive Farben anhand verbundener Spieler (mit gewählter Farbe)
      const act = Array.from(room.players.values())
        .filter(p => isConnectedPlayer(p) && ALLOWED_COLORS.includes(p.color))
        .map(p => p.color);
      const uniqueAct = ALLOWED_COLORS.filter(c => act.includes(c));
      if (uniqueAct.length < 2) {
        send(ws, { type: "error", code: "NEED_COLORS", message: "Mindestens 2 Spieler müssen eine Farbe wählen" });
        return;
      }

      // V10.6: finaler Start akzeptiert nur die serverseitig erzeugte Auslosung.
      const pending = room._pendingStart;
      if(!pending || !pending.starterColor || (Date.now() - Number(pending.ts || 0)) > 20000){
        room._pendingStart = null;
        send(ws, { type: "error", code: "START_NOT_ARMED", message: "Startauslosung abgelaufen. Bitte Spielstart erneut auslösen." });
        return;
      }
      const starter = String(pending.starterColor || "").toLowerCase().trim();
      if(!uniqueAct.includes(starter)){
        room._pendingStart = null;
        send(ws, { type: "error", code: "START_ROSTER_CHANGED", message: "Spielerbelegung hat sich geändert. Bitte Start erneut auslösen." });
        return;
      }
      const pendingColors = Array.isArray(pending.activeColors) ? pending.activeColors : [];
      const sameRoster = pendingColors.length === uniqueAct.length && pendingColors.every(c => uniqueAct.includes(c));
      if(!sameRoster){
        room._pendingStart = null;
        send(ws, { type: "error", code: "START_ROSTER_CHANGED", message: "Spielerbelegung hat sich geändert. Bitte Start erneut auslösen." });
        return;
      }
      const requestedMode = String(pending.mode || "classic").toLowerCase() === "action" ? "action" : "classic";
      const requestedBossMode = !!pending.bossMode;
      let jokerStartCount = null;
      if (requestedMode === "action") {
        const incomingCount = Number(pending.jokerStartCount);
        if (!Number.isInteger(incomingCount) || incomingCount < 1 || incomingCount > 5) {
          room._pendingStart = null;
          send(ws, { type: "error", code: "NEED_JOKER_COUNT", message: "Host muss zuerst die Joker-Anzahl 1 bis 5 wählen" });
          return;
        }
        jokerStartCount = incomingCount;
        room.jokerStartCount = incomingCount;
      }

      initGameState(room, uniqueAct, requestedMode, starter, jokerStartCount, requestedBossMode);
      room._pendingStart = null;
      await persistRoomState(room);
      console.log(`[start] room=${room.code} mode=${requestedMode} bossMode=${requestedBossMode?"on":"off"} jokerStartCount=${jokerStartCount ?? "-"} starter=${room.state.turnColor}`);
      broadcast(room, { type: "started", state: room.state });
      return;
    }

    if (msg.type === "rematch") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host kann eine Revanche starten" }); return; }
      if (!room.state || !room.state.finished) { send(ws, { type: "error", code: "NOT_FINISHED", message: "Revanche ist erst nach Spielende möglich" }); return; }

      // Revanche bedeutet bewusst: gleicher Raum, gleiche Spieler/Farben/Würfel und gleicher Modus.
      // Deshalb müssen die Teilnehmer der letzten Runde wieder verbunden sein.
      const prev = room.state;
      const previousActive = Array.isArray(prev.activeColors)
        ? prev.activeColors.map(c => String(c || "").toLowerCase()).filter(c => ALLOWED_COLORS.includes(c))
        : [];
      const connectedColors = new Set(Array.from(room.players.values())
        .filter(p => isConnectedPlayer(p) && ALLOWED_COLORS.includes(p.color))
        .map(p => p.color));
      const active = previousActive.length ? previousActive : ALLOWED_COLORS.filter(c => connectedColors.has(c));

      if (active.length < 2) {
        send(ws, { type: "error", code: "NEED_2P", message: "Mindestens 2 Spieler müssen für die Revanche verbunden sein" });
        return;
      }
      const missing = active.filter(c => !connectedColors.has(c));
      if (missing.length) {
        send(ws, { type: "error", code: "REMATCH_WAIT_PLAYERS", message: "Für die Revanche müssen alle Spieler der letzten Runde wieder verbunden sein" });
        return;
      }

      const requestedMode = String(prev.mode || "classic").toLowerCase() === "action" ? "action" : "classic";
      const jokerStartCount = requestedMode === "action"
        ? Math.max(1, Math.min(5, Number(prev.jokerStartCount ?? room.jokerStartCount ?? 1) || 1))
        : null;
      const starterColor = active[Math.floor(Math.random() * active.length)];
      const requestedBossMode = !!prev.bossMode;

      initGameState(room, active, requestedMode, starterColor, jokerStartCount, requestedBossMode);
      room._pendingStart = null;
      await persistRoomState(room);
      console.log(`[rematch] room=${room.code} mode=${requestedMode} starter=${starterColor} players=${active.join(",")}`);

      broadcast(room, {
        type: "rematch_started",
        state: room.state,
        starterColor,
        activeColors: active
      });
      broadcast(room, roomUpdatePayload(room));
      return;
    }

    if (msg.type === "reset") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host kann resetten" }); return; }

      // Erst NACH der Host-Prüfung löschen. Sonst könnte ein normaler Mitspieler
      // zwar den laufenden State nicht resetten, aber den persistierten Save zerstören.
      await deletePersisted(room);

      room.state = null;
      room.jokerStartCount = null;
      room.lastRollWasSix = false;
      room.carryingByColor = { red: false, blue: false, green: false, yellow: false };
      // Farben NICHT neu zufaellig zuweisen:
      // Neuer Standard: Spieler waehlen ihre Farbe selbst in der Lobby.
      // (Reconnect/Token bleibt damit konsistent.)

      console.log(`[reset] room=${room.code} by=host`);
      broadcast(room, roomUpdatePayload(room));
      broadcast(room, { type: "reset_done" });
      return;
    }

    // ---------- RESUME (Host) ----------
    // Reconnect-Sicherheit: Der Raum bleibt pausiert, bis der Host aktiv fortsetzt.
    // Wichtig: Nur fortsetzen, wenn wieder 2 farbige Spieler verbunden sind.
    if (msg.type === "resume") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host kann fortsetzen" }); return; }
      if (!room.state) { send(ws, { type: "error", code: "NO_STATE", message: "Spiel nicht gestartet" }); return; }
      if (!canStart(room)) {
        room.state.paused = true;
        await persistRoomState(room);
        send(ws, { type: "error", code: "NEED_2P", message: "Warte auf 2 Spieler…" });
        broadcast(room, { type: "snapshot", state: room.state });
        return;
      }
      room.state.paused = false;
      await persistRoomState(room);
      broadcast(room, { type: "snapshot", state: room.state });
      return;
    }

    // ---------- BOSS TESTWERKZEUGE (nur Host, nur laufender Bossmodus) ----------
    // Dient ausschließlich zum schnellen Prüfen der drei Bossregeln im echten Online-Spiel.
    if (msg.type === "boss_test") {
      if (!requireRoomState(room, ws)) return;
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type:"error", code:"NOT_HOST", message:"Nur Host kann Bosse testen" }); return; }
      if (!room.state.bossMode) { send(ws, { type:"error", code:"BOSS_OFF", message:"Bossmodus ist nicht aktiv" }); return; }
      const b = ensureBossState(room);
      const action = String(msg.action || "").toLowerCase();
      let text = "";
      let wheels = [];

      if (action === "spawn") {
        const type = String(msg.bossType || "").toLowerCase();
        if (!BOSS_TYPES[type]) { send(ws, { type:"boss_test_result", ok:false, text:"Unbekannter Boss" }); return; }
        const r = spawnBoss(room, type, msg.slotId || null);
        text = r.text;
        if(!r.ok){ send(ws, { type:"boss_test_result", ok:false, text }); return; }
      } else if (action === "act") {
        const entries = activeBossEntries(room);
        if(!entries.length){ send(ws, { type:"boss_test_result", ok:false, text:"Kein Boss aktiv" }); return; }
        const parts=[];
        for(const e of entries){
          const r=moveBossEntry(room,e,{forced:true});
          if(r.text) parts.push(r.text);
          if(Array.isArray(r.wheels)) wheels.push(...r.wheels);
        }
        text = parts.join(" ") || "Bossaktion ausgeführt.";
      } else if (action === "events") {
        ensureBossEventFieldLayout(room,b,true);
        bossAction(room,"🎲","Ereignisfelder","8 Ereignisfelder wurden zufällig neu verteilt (Mindestabstand 3 Felder).");
        text="8 Ereignisfelder zufällig neu verteilt.";
      } else if (action === "event_card") {
        const effect=String(msg.eventEffect||"");
        const card=EVENT_CARD_DEFS.find(c=>String(c.effect)===effect);
        if(!card){ send(ws,{type:"boss_test_result",ok:false,text:"Unbekannte Ereigniskarte"}); return; }
        if(!ALLOWED_COLORS.includes(String(me?.color||""))){ send(ws,{type:"boss_test_result",ok:false,text:"Host hat keine aktive Spielerfarbe"}); return; }
        if(!Array.isArray(b.eventFields)||!b.eventFields.length) ensureBossEventFieldLayout(room,b,true);
        const field=String(b.eventFields?.[0]||"");
        if(!field){ send(ws,{type:"boss_test_result",ok:false,text:"Kein Ereignisfeld zum Testen verfügbar"}); return; }
        // Testkarte wird nur temporär oben auf das Deck gelegt. Dadurch lässt sich jede Wirkung
        // gezielt im echten Online-Spiel prüfen, ohne die normale Zufallslogik umzubauen.
        b.deck.unshift(card.id);
        const evt=drawBossEventCard(room,field,String(me.color));
        if(Array.isArray(evt?.wheels)) wheels.push(...evt.wheels);
        text=evt?`${evt.icon||"🃏"} ${evt.title}: ${evt.effectText||""}`:"Ereigniskarte konnte nicht ausgelöst werden.";
      } else if (action === "clear") {
        for(const slot of b.slots) slot.boss=null;
        b.rollModsByColor={red:0,blue:0,green:0,yellow:0};
        b.skipTurnsByColor={red:0,blue:0,green:0,yellow:0};
        b.forcedMoveByColor={red:0,blue:0,green:0,yellow:0};
        b.bountyNextBoss=false;
        b.sleepRounds=0;
        b.sleepActiveRound=null;
        room.state.eventMoveActive=null;
        bossAction(room,"🧹","Boss-Test","Alle Bosse und temporären Boss-/Ereigniseffekte wurden entfernt.");
        text="Alle Bosse entfernt.";
      } else {
        send(ws, { type:"boss_test_result", ok:false, text:"Unbekannte Testaktion" }); return;
      }

      await persistRoomState(room);
      broadcast(room, { type:"snapshot", state:room.state, wheel:wheels.length?wheels:undefined });
      send(ws, { type:"boss_test_result", ok:true, text });
      return;
    }

    // ---------- ACTION MODE / BOSS-JOKER (server is chef) ----------
    // V10.6: four supported jokers only: allColors, barricade, reroll, double.
    if (msg.type === "use_joker") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (!jokerGameplayEnabled(room)) {
        send(ws, { type: "error", code: "NOT_ACTION", message: "Action-Modus ist nicht aktiv" });
        return;
      }

      const turnColor = room.state.turnColor;
      if(room.state.eventMoveActive?.color===turnColor){
        send(ws,{type:"error",code:"FORCED_EVENT_MOVE",message:"Ereigniskarte: Zuerst die 10-Felder-Bewegung ausführen."});
        return;
      }
      const action = room.state.action;
      ensureActionJokers(action);
      const set = action.jokersByColor?.[turnColor];
      if (!set) { send(ws, { type: "error", code: "NO_JOKERS", message: "Joker-Set fehlt" }); return; }

      const joker = String(msg.joker || "").toLowerCase().trim();

      // helper: count/consume (stackable)
      const hasJoker = (k) => countOwnedJokers(action, turnColor, k) > 0;
      const consumeNow = (k) => consumeOwnedJoker(action, turnColor, k);


      if (joker === "allcolors") {
        if (!hasJoker("allColors")) { send(ws, { type: "error", code: "USED", message: "Alle Farben Joker schon verbraucht" }); return; }
        // Wunsch: Joker erst NACH dem Würfeln (Phase need_move)
        if (room.state.phase !== "need_move" || room.state.rolled == null) {
          send(ws, { type: "error", code: "BAD_PHASE", message: "Erst würfeln – dann Joker wählen" });
          return;
        }
        room.state.action.effects.allColorsBy = turnColor;
        consumeNow("allColors");
        try{ recordMatchJoker(room, turnColor, "allColors"); }catch(_e){}
        await persistRoomState(room);
        broadcast(room, { type: "snapshot", state: room.state, joker: "allcolors" });
        return;
      }

      if (joker === "barricade") {
        if (!hasJoker("barricade")) { send(ws, { type: "error", code: "USED", message: "Barikade Joker schon verbraucht" }); return; }
        // Barikade-Joker soll *vor* dem Würfeln eingesetzt werden.
        // Wenn man ihn nach dem Wurf aktiviert, kann der Spieler die Barikade nicht mehr bewegen
        // (weil das Spiel dann in phase=need_move ist) und es fühlt sich "buggy" an.
        if (room.state.phase !== "need_roll" || room.state.rolled != null) {
          send(ws, { type: "error", code: "BAD_PHASE", message: "Barikade-Joker nur vor dem Würfeln" });
          return;
        }
        
        // Falls schon aktiv (z.B. Doppel-Klick), nicht nochmal „verbrauchen“.
        if (room.state.action.effects.barricadeBy === turnColor) {
          broadcast(room, { type: "snapshot", state: room.state, joker: "barricade" });
          return;
        }

        room.state.action.effects.barricadeBy = turnColor;
        // NOTE: Joker wird erst nach erfolgreichem Versetzen verbraucht (Commit in action_barricade_move)
        await persistRoomState(room);
        broadcast(room, { type: "snapshot", state: room.state, joker: "barricade" });
        return;
      }


      if (joker === "reroll") {
        if (!hasJoker("reroll")) { send(ws, { type: "error", code: "USED", message: "Neu-Wurf Joker schon verbraucht" }); return; }
        // Neu-Wurf-Joker: erst NACH dem Würfeln (need_move) nutzbar
        if (room.state.phase !== "need_move" || room.state.rolled == null) {
          send(ws, { type: "error", code: "BAD_PHASE", message: "Erst würfeln – dann Neu-Wurf" });
          return;
        }
        // Wurf verfällt -> zurück in need_roll
        room.state.rolled = null;
        room.state.extraRollPending = false;
        room.lastRollWasSix = false; // backward-compat alias
        room.state.phase = "need_roll";
        consumeNow("reroll");
        try{ recordMatchJoker(room, turnColor, "reroll"); }catch(_e){}
        await persistRoomState(room);
        broadcast(room, { type: "snapshot", state: room.state, joker: "reroll" });
        return;
      }

      
      if (joker === "double") {
        if (!hasJoker("double")) { send(ws, { type: "error", code: "USED", message: "Doppelwurf Joker schon verbraucht" }); return; }
        // Doppelwurf-Joker soll *vor* dem Würfeln eingesetzt werden.
        if (room.state.phase !== "need_roll" || room.state.rolled != null) {
          send(ws, { type: "error", code: "BAD_PHASE", message: "Doppelwurf nur vor dem Würfeln" });
          return;
        }
        // Falls schon aktiv, nicht nochmal verbrauchen
        if (room.state.action.effects.doubleRoll && room.state.action.effects.doubleRoll.by === turnColor && room.state.action.effects.doubleRoll.kind === "sum2" && room.state.action.effects.doubleRoll.pending === true) {
          broadcast(room, { type: "snapshot", state: room.state, joker: "double" });
          return;
        }
        room.state.action.effects.doubleRoll = { kind: "sum2", by: turnColor, pending: true, rolls: null, chosen: null };
        consumeNow("double");
        try{ recordMatchJoker(room, turnColor, "double"); }catch(_e){}
        await persistRoomState(room);
        broadcast(room, { type: "snapshot", state: room.state, joker: "double" });
        return;
      }

      send(ws, { type: "error", code: "BAD_JOKER", message: "Unbekannter Joker" });
      return;
    }

    if (msg.type === "cancel_joker") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (!jokerGameplayEnabled(room)) {
        send(ws, { type: "error", code: "NOT_ACTION", message: "Action-Modus ist nicht aktiv" });
        return;
      }

      const action = room.state.action;
      ensureActionJokers(action);

      const turnColor = room.state.turnColor;
      const kindRaw = String(msg.joker || "").toLowerCase().trim();

      // Normalize to server joker keys
      const kind =
        kindRaw === "allcolors" ? "allColors" :
        kindRaw === "barricade" ? "barricade" :
        kindRaw === "double" ? "double" :
        kindRaw === "reroll" ? "reroll" :
        kindRaw;

      // Cancel only makes sense for toggle-like jokers
      if (kind === "allColors") {
        // AllColors is consumed on activation -> refund on cancel if still active
        if (action.effects?.allColorsBy === turnColor) {
          action.effects.allColorsBy = null;
          addOwnedJoker(action, turnColor, "allColors", turnColor, "cancel_refund");
          syncJokerCountsFromOwned(action);
        }
      } else if (kind === "barricade") {
        // Barricade is consumed only on successful move -> just clear effect
        if (action.effects?.barricadeBy === turnColor) {
          action.effects.barricadeBy = null;
        }
      } else if (kind === "double") {
        // Double is consumed on activation -> refund only if still pending (not rolled yet)
        if (action.effects?.doubleRoll
            && action.effects.doubleRoll.by === turnColor
            && action.effects.doubleRoll.pending === true) {
          action.effects.doubleRoll = null;
          addOwnedJoker(action, turnColor, "double", turnColor, "cancel_refund");
          syncJokerCountsFromOwned(action);
        }
      } else {
        // reroll is not cancellable because it immediately changes the roll state
      }

      await persistRoomState(room);
      broadcast(room, { type: "snapshot", state: room.state, jokerCanceled: kindRaw });
      return;
    }

if (msg.type === "action_barricade_move") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (!jokerGameplayEnabled(room)) {
        send(ws, { type: "error", code: "NOT_ACTION", message: "Action-Modus ist nicht aktiv" });
        return;
      }

      const turnColor = room.state.turnColor;
      const eff = room.state.action.effects || {};
      if (eff.barricadeBy !== turnColor) {
        send(ws, { type: "error", code: "NO_EFFECT", message: "Barikade-Effekt ist nicht aktiv" });
        return;
      }
      if (room.state.phase !== "need_roll") {
        send(ws, { type: "error", code: "BAD_PHASE", message: "Barikade-Joker nur vor dem Würfeln" });
        return;
      }

      const from = String(msg.from || "");
      const to   = String(msg.to || "");
      if (!from || !to) { send(ws, { type: "error", code: "BAD_ARGS", message: "from/to fehlt" }); return; }
      if (from === to) { send(ws, { type: "error", code: "BAD_ARGS", message: "Quelle = Ziel" }); return; }
      if (to === String(room.state.goal)) { send(ws, { type: "error", code: "GOAL_BLOCKED", message: "Ziel-Feld ist gesperrt" }); return; }

      const barr = room.state.barricades || [];
      if (!barr.includes(from)) { send(ws, { type: "error", code: "NO_BARR", message: "Quelle hat keine Barikade" }); return; }
      if (barr.includes(to)) { send(ws, { type: "error", code: "HAS_BARR", message: "Ziel hat schon eine Barikade" }); return; }

      // move
      room.state.barricades = barr.filter(x => x !== from);
      room.state.barricades.push(to);

      // effect is single-use per turn -> clear now
      room.state.action.effects.barricadeBy = null;


      // Commit: Joker jetzt verbrauchen (erst nach erfolgreichem Move)
      try{
        if (room.state.action) {
          consumeOwnedJoker(room.state.action, turnColor, "barricade");
          try{ recordMatchJoker(room, turnColor, "barricade"); }catch(_e){}
        }
      }catch(_e){}
      await persistRoomState(room);
      broadcast(room, { type: "snapshot", state: room.state, moved: { from, to } });
      return;
    }



    // ---------- ROLL ----------
    if (msg.type === "roll_request") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (room.state.phase !== "need_roll") {
        send(ws, { type: "error", code: "BAD_PHASE", message: "Erst Zug beenden" });
        return;
      }

      let v = randInt(1, 6);
      let double = null;

      // Action-Mode: Doppelwurf (2x würfeln, Summe) – wird VOR dem Würfeln aktiviert
      try{
        if (jokerGameplayEnabled(room) && room.state.action.effects) {
          const eff = room.state.action.effects.doubleRoll;
          if (eff && eff.by === room.state.turnColor && eff.kind === "sum2" && eff.pending === true) {
            const a = randInt(1, 6);
            const b = randInt(1, 6);
            v = a + b;
            double = [a, b];
            eff.pending = false;
            eff.rolls = [a, b];
            eff.chosen = v;
            // Effekt nach dem Wurf entfernen (Joker ist ohnehin schon verbraucht)
            room.state.action.effects.doubleRoll = null;
          }
        }
      }catch(_e){}

      // Action-Bossmodus: einmaliger Würfelmodifikator aus Events/Bossen.
      try{
        const b=ensureBossState(room);
        if(b){
          const c=room.state.turnColor;
          const mod=Math.max(-2,Math.min(2,Number(b.rollModsByColor?.[c]||0)));
          if(mod){
            v=Math.max(1,Math.min(12,v+mod));
            b.rollModsByColor[c]=0;
            bossAction(room, mod>0?"🔥":"🥾", "Würfelmodifikator", `${String(c).toUpperCase()}: ${mod>0?"+":""}${mod} → ${v}.`);
          }
        }
      }catch(_e){}

      console.log(`[roll] room=${room.code} by=${room.state.turnColor} value=${v}`);

      // Stats: track rolls for registered players (no Gast)
      await recordRollStat(room, room.state.turnColor, v);

      // Per-match titles: count rolled 1/6 etc. (server authoritative)
      try{ recordMatchRoll(room, room.state.turnColor, v); }catch(_e){}

      room.state.rolled = v;
      room.state.extraRollPending = (v === 6);
      room.lastRollWasSix = room.state.extraRollPending; // backward-compat alias
      room.state.phase = "need_move";
      // Jäger läuft wirklich nach JEDEM Würfelwurf, bevor der Spieler seine Figur zieht.
      try{ bossAfterRoll(room); }catch(e){ console.warn("[boss] after-roll failed", e?.message||e); }
      await persistRoomState(room);
    broadcast(room, { type: "roll", value: v, state: room.state, double });
      return;
    }

    
    // ---------- FORFEIT / AUFGEBEN ----------
    if (msg.type === "forfeit") {
      if (!requireRoomState(room, ws)) return;

      // Only a player with a color can forfeit
      const me = room.players.get(clientId);
      const myColor = String(me?.color || "").toLowerCase();
      if (!myColor) { send(ws, { type:"error", code:"SPECTATOR", message:"Du hast keine Farbe" }); return; }
      if (room.state.finished) { send(ws, { type:"error", code:"GAME_OVER", message:"Spiel ist bereits beendet" }); return; }

      // Determine winner: player with the smallest distance to the goal (closest piece wins)
      const goalId = room.state.goal || GOAL;
      const active = Array.isArray(room.state.activeColors) && room.state.activeColors.length ? room.state.activeColors : ALLOWED_COLORS;

      function minDistForColor(color){
        let best = Infinity;
        for(const p of (room.state.pieces || [])){
          if(!p || String(p.color||"").toLowerCase() !== String(color||"").toLowerCase()) continue;
          if(p.posKind !== "board") continue;
          const d = DIST_TO_GOAL.get(p.nodeId);
          if(typeof d === "number" && d < best) best = d;
        }
        return best;
      }

      // Build ranking (deterministic): distance asc, then active order
      let winnerColor = null;
      let bestDist = Infinity;
      for(const c of active){
        const d = minDistForColor(c);
        if(d < bestDist){
          bestDist = d;
          winnerColor = c;
        }
      }
      // If distances are missing (shouldn't), fall back to turnColor
      if(!winnerColor) winnerColor = room.state.turnColor || active[0] || myColor;

      setGameOver(room, winnerColor);

      // Mark reason + forfeiter
      room.state.gameOverReason = "forfeit";
      room.state.forfeiterColor = myColor;

      await finalizeMatchStats(room, room.state.winnerColor, { forfeiterColor: myColor });
      await persistRoomState(room);

      broadcast(room, {
        type: "forfeit",
        by: myColor,
        winner: room.state.winnerColor,
        state: room.state,
      });
      return;
    }


    // ---------- END / SKIP ----------
    if (msg.type === "end_turn" || msg.type === "skip_turn") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (room.state.phase === "place_barricade") {
        send(ws, { type: "error", code: "BAD_PHASE", message: "Erst Barikade platzieren" });
        return;
      }
      if(room.state.eventMoveActive?.color===room.state.turnColor){
        send(ws,{type:"error",code:"FORCED_EVENT_MOVE",message:"Ereigniskarte: Du musst zuerst die 10-Felder-Bewegung ausführen."});
        return;
      }

      // Action-Mode: clear per-turn effects when a turn ends (prevents desync / stuck effects)
      if (jokerGameplayEnabled(room) && room.state.action.effects) {
        const ended = room.state.turnColor;
        const eff = room.state.action.effects;
        if (eff.allColorsBy === ended) eff.allColorsBy = null;
        if (eff.barricadeBy === ended) eff.barricadeBy = null;
        if (eff.doubleRoll && eff.doubleRoll.by === ended) eff.doubleRoll = null;
      }

      // per-match titles: turn time tracking (cap at 60s)
      try{
        if(room.state.matchTrack && room.state.matchTrack.turnStartedAt){
          const dt = Date.now() - room.state.matchTrack.turnStartedAt;
          recordMatchTurnTime(room, room.state.turnColor, dt);
        }
      }catch(_e){}

      room.lastRollWasSix = false;
      room.state.extraRollPending = false;
      room.state.rolled = null;
      room.state.phase = "need_roll";
      const endedBossColor = room.state.turnColor;
      const adv=advanceTurnWithEventSkips(room,endedBossColor);
      const bossWheel=adv?.wheels||[];
      room.state.eventMoveActive=null;
      if(room.state.matchTrack) room.state.matchTrack.turnStartedAt = Date.now();

      await persistRoomState(room);
    broadcast(room, { type: "move", state: room.state, wheel: (bossWheel && bossWheel.length) ? bossWheel : undefined });
      broadcast(room, roomUpdatePayload(room));
      return;
    }

    // ---------- LEGAL TARGETS ----------
    if (msg.type === "legal_request") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (room.state.phase !== "need_move") {
        send(ws, { type: "error", code: "BAD_PHASE", message: "Erst würfeln" });
        return;
      }

      const pieceId = String(msg.pieceId || "");
      const pc = getPiece(room, pieceId);
      const allowAll = jokerGameplayEnabled(room) && room.state.action.effects && (room.state.action.effects.allColorsBy === room.state.turnColor);

      if (!pc || (!allowAll && pc.color !== room.state.turnColor)) {
        send(ws, { type: "error", code: "BAD_PIECE", message: "Ungültige Figur" });
        return;
      }

      const roll = room.state.rolled;
      const startField = STARTS[pc.color];
      let targets = new Map();

      if (pc.posKind === "house") {
        const remaining = roll - 1;
        if (remaining === 0) targets = new Map([[startField, [startField]]]);
        else targets = computeAllTargets(room, startField, remaining, pc.color, pc.id);
      } else {
        targets = computeAllTargets(room, pc.nodeId, roll, pc.color, pc.id);
      }

      send(ws, { type: "legal", pieceId, targets: Array.from(targets.keys()) });
      return;
    }

    // ---------- MOVE ----------
    
  // ---------- EXPORT / IMPORT (Host only) ----------
  // export_state: Server sendet aktuellen room.state zurück (Host kann als JSON speichern)
  if (msg.type === "export_state") {
    if (!room) return;
    const me = room.players.get(clientId);
    if (!me?.isHost) return send(ws, { type: "error", code: "HOST_ONLY", message: "Nur Host" });
    if (!room.state) return send(ws, { type: "error", code: "NO_STATE", message: "Spiel nicht gestartet" });
    return send(ws, { type: "export_state", code: room.code, state: room.state, ts: Date.now() });
  }

  // import_state: Host sendet state JSON zurück → Server setzt room.state und broadcastet snapshot
  if (msg.type === "import_state") {
    if (!room) return;
    const me = room.players.get(clientId);
    if (!me?.isHost) return send(ws, { type: "error", code: "HOST_ONLY", message: "Nur Host" });
    if(String(msg.reason || "") === "init_start_player"){
      return send(ws, { type: "error", code: "START_SERVER_ONLY", message: "Der Startspieler wird ausschließlich vom Server festgelegt." });
    }
    const st = msg.state;
    if (!st || typeof st !== "object") return send(ws, { type: "error", code: "BAD_STATE", message: "Ungültiger State" });

    // Minimal sanity: muss turnColor & phase besitzen
    if (!st.turnColor || !st.phase || !Array.isArray(st.pieces) || !Array.isArray(st.barricades)) {
      return send(ws, { type: "error", code: "BAD_STATE", message: "State-Format passt nicht" });
    }

    room.state = st;
    normalizeImportedGameState(room);
    // Import darf die Reconnect-Sicherheit nicht umgehen: mit mindestens zwei
    // verbundenen farbigen Spielern kann direkt weitergespielt werden, sonst bleibt
    // der Raum pausiert bis der Host nach dem Reconnect „Fortsetzen“ drückt.
    room.state.paused = !canStart(room);
    await persistRoomState(room);
    broadcast(room, { type: "snapshot", state: room.state, players: currentPlayersList(room) });
    return;
  }

if (msg.type === "move_request") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (room.state.phase !== "need_move") {
        send(ws, { type: "error", code: "BAD_PHASE", message: "Erst würfeln" });
        return;
      }

      const pieceId = String(msg.pieceId || "");
      const targetId = String(msg.targetId || "");
      const pc = getPiece(room, pieceId);

      // Action‑Mode Joker "Alle Farben": aktiver Spieler bleibt turnColor,
      // aber darf (einmalig) auch fremde Figuren bewegen.
      const activeColor = room.state.turnColor;
      const allowAll = jokerGameplayEnabled(room)
        && room.state.action
        && room.state.action.effects
        && (room.state.action.effects.allColorsBy === activeColor);

      if (!pc || (!allowAll && pc.color !== activeColor)) {
        send(ws, { type: "error", code: "BAD_PIECE", message: "Ungültige Figur" });
        return;
      }

      const res = pathForTarget(room, pc, targetId);
      if (!res.ok) {
        send(ws, { type: "error", code: "ILLEGAL", message: res.msg || "illegal" });
        return;
      }

      // Ein aktiver 10-Felder-Ereigniszug wird mit genau dieser erfolgreichen Bewegung erfüllt.
      const wasForcedEventMove = !!(
        room.state.eventMoveActive &&
        room.state.eventMoveActive.color === activeColor &&
        Number(room.state.eventMoveActive.steps||0) === Number(room.state.rolled||0)
      );
      if(wasForcedEventMove) room.state.eventMoveActive=null;

      // apply move
      pc.posKind = "board";
      pc.nodeId = res.path[res.path.length - 1];

      const landed = pc.nodeId;

      // Per-match titles: count walked fields (server authoritative)
      try{ recordMatchMove(room, activeColor, Number(room.state.rolled||0) || 0); }catch(_e){}

      // kick opponent on landing
      const kicked = [];
      const kickedVictimColors = [];
      for (const op of room.state.pieces) {
        if (op.posKind === "board" && op.nodeId === landed && op.color !== pc.color) {
          kickedVictimColors.push(op.color);
          sendPieceHome(room, op);
          kicked.push(op.id);
        }
      }

      if (kickedVictimColors.length) {
        kickedVictimColors.forEach(vc=>recordMatchKick(room, activeColor, vc));
      }

      // Wheel: if a piece is kicked in Action-Mode, the ACTIVE (current) player gets a 50% chance
      // to receive a random joker. The joker "origin color" is the kicked piece color (for UI display).
      // Server decides instantly (no delays). Client may animate it visually.
      let wheel = null;
      try {
        const isAction = jokerGameplayEnabled(room);
        const action = room.state?.action;
        if (isAction && action && kicked.length) {
          ensureActionJokers(action);

          // Determine which colors were kicked (usually 1)
          const kickedColors = new Set();
          for (const pid of kicked) {
            const pp = room.state.pieces.find(x => String(x.id) === String(pid));
            if (pp && pp.color) kickedColors.add(pp.color);
          }

          const segments = ["allColors","barricade","reroll","double"]; // keine Nieten
          wheel = [];

          for (const kc of kickedColors) {
            const pick = segments[Math.floor(Math.random() * segments.length)];
            const result = pick;

            const awardMode = room.state?.jokerAwardMode || room.jokerAwardMode || "thrower";
            const targetColor = (awardMode === "victim") ? kc : activeColor;

            // Keep both keys for backwards/forwards compatibility (client may read either).
            const attacker = Array.from(room.players.values()).find(p=>p && p.color===targetColor);
            const victim = Array.from(room.players.values()).find(p=>p && p.color===kc);
            const quote = KICK_QUOTES[Math.floor(Math.random()*KICK_QUOTES.length)];
            wheel.push({ ownerColor: targetColor, targetColor, jokerColor: kc, result, durationMs: 5000, attackerName: attacker?.name || "", victimName: victim?.name || "", quote }); // Christoph-Wunsch: 5s

            // Grant to selected recipient (thrower OR victim). Origin color=kc for display.
            if (result) {
              addOwnedJoker(action, targetColor, result, kc, "wheel");
            }
          }

          // Keep counts snapshot in sync
          syncJokerCountsFromOwned(action);
        }
      } catch (_e) {
        wheel = null;
      }

      // Action-Bossmodus: Angriffsfeld + Ereignisfeld werden serverseitig ausgewertet.
      let bossHit = null;
      let eventCard = null;
      try{
        bossHit = resolveBossBoardHit(room, landed, activeColor);
        // Keine Ereignisketten: Ein durch die Karte „10 Felder laufen“ ausgelöster Zusatzlauf
        // kann Bosse besiegen und normal schlagen, zieht aber nicht direkt eine weitere Ereigniskarte.
        eventCard = wasForcedEventMove ? null : drawBossEventCard(room, landed, activeColor);
        if(Array.isArray(eventCard?.wheels) && eventCard.wheels.length){
          wheel = (Array.isArray(wheel) ? wheel : []).concat(eventCard.wheels);
        }
      }catch(_e){}

      // landed on barricade?
      const barricades = room.state.barricades;
      const idx = barricades.indexOf(landed);
      let picked = false;

      if (idx >= 0) {
        barricades.splice(idx, 1);
        picked = true;
        // Persist the "carrying" flag inside state (so it survives restart)
        if (!room.state.carryingByColor || typeof room.state.carryingByColor !== "object") {
  room.state.carryingByColor = { red: false, blue: false, green: false, yellow: false };
        }
        room.state.carryingByColor[activeColor] = true;
        room.carryingByColor = room.state.carryingByColor; // compat alias
        room.state.phase = "place_barricade";
      } else {
        room.state.phase = "need_roll";
      }

      // if no barricade placement needed:
      if (!picked) {
        const forcedSteps=takeForcedEventMove(room,activeColor);
        const canForced=forcedSteps>0 && hasAnyLegalMoveForSteps(room,activeColor,forcedSteps);
        if(canForced){
          // "10 Felder laufen": kein neuer Würfelwurf, daher bewegt sich der Jäger hier NICHT zusätzlich.
          room.state.turnColor=activeColor;
          room.state.extraRollPending=false;
          room.lastRollWasSix=false;
          room.state.rolled=forcedSteps;
          room.state.phase="need_move";
          room.state.eventMoveActive={color:activeColor,steps:forcedSteps,source:"event_walk10"};
        }else{
          if(forcedSteps>0 && eventCard){
            eventCard.effectText=`${eventCard.effectText} Es gibt keine legale 10-Felder-Bewegung; der Zusatzlauf verfällt.`;
          }
          if (room.state.extraRollPending) {
            room.state.turnColor = activeColor; // extra roll survives restart
          } else {
            const adv=advanceTurnWithEventSkips(room,activeColor);
            if(Array.isArray(adv?.wheels) && adv.wheels.length) wheel=(Array.isArray(wheel)?wheel:[]).concat(adv.wheels);
          }
          room.state.extraRollPending = false;
          room.lastRollWasSix = false;
          room.state.phase = "need_roll";
          room.state.rolled = null;
          room.state.eventMoveActive=null;
        }
      }

      // Joker‑Effekt endet nach dem Zug (verhindert Turn‑Chaos)
      if (jokerGameplayEnabled(room) && room.state.action.effects) {
        if (room.state.action.effects.allColorsBy === activeColor) {
          room.state.action.effects.allColorsBy = null;
        }
      }

      // ✅ Win condition (server is chef): first piece that reaches the goal node wins.
      const winner = detectWinnerColor(room);
      if (winner) {
        setGameOver(room, winner);
        console.log(`[win] room=${room.code} winner=${room.state.winnerColor}`);
        await finalizeMatchStats(room, room.state.winnerColor);
      }

      console.log(`[move] room=${room.code} active=${activeColor} moved=${pc.color} piece=${pc.id} to=${pc.nodeId} picked=${picked}`);
      broadcast(room, {
        type: "move",
        action: { pieceId: pc.id, path: res.path, pickedBarricade: picked, kickedPieces: kicked },
        wheel: wheel || undefined,
        bossHit: bossHit || undefined,
        eventCard: eventCard || undefined,
        state: room.state
      });
      if (room.state.finished) {
        broadcast(room, { type: "game_over", winnerColor: room.state.winnerColor, finishedAt: room.state.finishedAt, awards: room.state.matchAwards || [] });
      }
      // Persist after every successful move so a server restart has the newest possible state.
      await persistRoomState(room);
      return;
    }

    // ---------- PLACE BARRICADE (Host+Client) ----------
// ---------- PLACE BARRICADE (Host+Client) ----------
if (msg.type === "place_barricade") {
  if (!requireRoomState(room, ws)) return;

  if (room.state.phase !== "place_barricade") {
    send(ws, { type: "error", code: "BAD_PHASE", message: "Keine Barikade zu platzieren" });
    return;
  }

  const me = room.players.get(clientId);
  if (!me?.color) {
    send(ws, { type: "error", code: "SPECTATOR", message: "Du hast keine Farbe" });
    return;
  }

  const color = room.state.turnColor;

  // Zug über Spielerfarbe prüfen (Host/Client egal)
  if (me.color !== color) {
    send(ws, { type: "error", code: "NOT_YOUR_TURN", message: "Nicht dein Zug" });
    return;
  }

  // carrying flag is persisted in room.state
  if (!room.state.carryingByColor || typeof room.state.carryingByColor !== "object") {
    room.state.carryingByColor = { red: false, blue: false, green: false, yellow: false };
  }
  room.carryingByColor = room.state.carryingByColor; // compat alias

  if (!room.state.carryingByColor[color]) {
    send(ws, { type: "error", code: "NO_BARRICADE", message: "Du trägst keine Barikade" });
    return;
  }

  // ✅ Robust: viele mögliche Payload-Formate akzeptieren
  let nodeId = "";
  if (typeof msg.nodeId === "string") nodeId = msg.nodeId;
  else if (typeof msg.at === "string") nodeId = msg.at;
  else if (typeof msg.id === "string") nodeId = msg.id;
  else if (typeof msg.targetId === "string") nodeId = msg.targetId;
  else if (msg.node && typeof msg.node === "object" && typeof msg.node.id === "string") nodeId = msg.node.id;

  // falls aus irgendeinem Grund eine Zahl/Index kommt:
  if (!nodeId && (typeof msg.nodeId === "number" || typeof msg.at === "number" || typeof msg.id === "number")) {
    const idx = Number(msg.nodeId ?? msg.at ?? msg.id);
    const n = (BOARD.nodes || [])[idx];
    if (n?.id) nodeId = String(n.id);
  }

  nodeId = String(nodeId || "").trim();

  // 🔧 normalize ids (host/client may send "12" or "node_12" etc.)
  if (nodeId && !NODES.has(nodeId)) {
    const m = String(nodeId).match(/(\d+)/);
    if (/^\d+$/.test(nodeId)) nodeId = `n_${nodeId}`;
    else if (m) nodeId = `n_${m[1]}`;
  }

  // 🔧 fallback: if still unknown but coords exist, snap to nearest board node
  if (nodeId && !NODES.has(nodeId)) {
    let x = null, y = null;
    if (typeof msg.x === "number" && typeof msg.y === "number") { x = msg.x; y = msg.y; }
    else if (msg.pos && typeof msg.pos.x === "number" && typeof msg.pos.y === "number") { x = msg.pos.x; y = msg.pos.y; }
    if (x !== null && y !== null) {
      let best = null;
      let bestD = Infinity;
      for (const n of (BOARD.nodes || [])) {
        if (n.kind !== "board") continue;
        const dx = (n.x ?? 0) - x;
        const dy = (n.y ?? 0) - y;
        const d = dx*dx + dy*dy;
        if (d < bestD) { bestD = d; best = n; }
      }
      if (best?.id) nodeId = best.id;
    }
  }

  if (!nodeId) {
    send(ws, { type: "error", code: "NO_NODE", message: "Kein Zielfeld" });
    return;
  }

  if (!isPlacableBarricade(room, nodeId)) {
    // Mini-Debug, damit du es im Render Log sofort siehst:
    const n = NODES.get(nodeId);
    console.log("[place_barricade] FAIL",
      "player=", me.color,
      "turn=", color,
      "nodeId=", nodeId,
      "exists=", !!n,
      "kind=", n?.kind
    );
    send(ws, { type: "error", code: "BAD_NODE", message: "Hier darf keine Barikade hin" });
    return;
  }

  // ✅ platzieren
  room.state.barricades.push(nodeId);
  room.state.carryingByColor[color] = false;
  room.carryingByColor = room.state.carryingByColor; // compat alias

  // ✅ weiter
  let bossWheel = [];
  const forcedSteps=takeForcedEventMove(room,color);
  const canForced=forcedSteps>0 && hasAnyLegalMoveForSteps(room,color,forcedSteps);
  if(canForced){
    room.state.turnColor=color;
    room.state.extraRollPending=false;
    room.lastRollWasSix=false;
    room.state.phase="need_move";
    room.state.rolled=forcedSteps;
    room.state.eventMoveActive={color,steps:forcedSteps,source:"event_walk10"};
  }else{
    if(room.state.extraRollPending){
      room.state.turnColor = color;
    }else{
      const adv=advanceTurnWithEventSkips(room,color);
      bossWheel=adv?.wheels||[];
    }
    room.state.extraRollPending = false;
    room.lastRollWasSix = false;
    room.state.phase = "need_roll";
    room.state.rolled = null;
    room.state.eventMoveActive=null;
  }

  await persistRoomState(room);
  broadcast(room, { type: "snapshot", state: room.state, wheel: (bossWheel && bossWheel.length) ? bossWheel : undefined });
  return;
}

    // fallback: unknown message
    return;
  }); // ✅ Ende ws.on("message")

  ws.on("close", async () => {
    const c = clients.get(clientId);
    if (!c) return;

    const roomCode = c.room;
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
	      // keep per-room socket index clean
	      if (room.clients) room.clients.delete(clientId);
        const p = room.players.get(clientId);
        const wasColor = p?.color;
        const wasTurn = room.state?.turnColor;
        if (p) p.lastSeen = Date.now();

        // pause if active player disconnected
        if (room.state && wasColor && wasTurn && wasColor === wasTurn) {
          room.state.paused = true;
        }


        // Wenn wirklich niemand mehr verbunden ist → sicher pausieren (beide reconnect edge-case)
        if (room.state) {
          const anyConnected = Array.from(room.players.values()).some(pp => isConnectedPlayer(pp));
          if (!anyConnected) room.state.paused = true;
        }

        // Reconnect-Sicherheit: sobald <2 Spieler verbunden sind → pausiert
        enforcePauseIfNotReady(room);
        broadcast(room, roomUpdatePayload(room));
        if (room.state) await persistRoomState(room);
    broadcast(room, { type: "snapshot", state: room.state });
      }
    }

    clients.delete(clientId);
  });
});



// ---------- Snapshot Heartbeat (Server is Chef) ----------
// Sends the current authoritative snapshot periodically so clients can resync after
// Render sleep/reconnect/message-loss without any risky auto-repair.
// Safe: does NOT change game state, only broadcasts existing room.state.
const SNAPSHOT_HEARTBEAT_MS = Number(process.env.SNAPSHOT_HEARTBEAT_MS || 3000);

setInterval(() => {
  try {
    for (const room of rooms.values()) {
      if (!room || !room.state || !room.state.started) continue;

      // only if at least one connected player is present
      const hasConnected = Array.from(room.players.values()).some(p => isConnectedPlayer(p));
      if (!hasConnected) continue;

      broadcast(room, { type: "snapshot", state: room.state, hb: true, ts: Date.now() });
    }
  } catch (_e) {
    // never crash the server because of heartbeat
  }
}, SNAPSHOT_HEARTBEAT_MS);

server.listen(PORT, () => console.log("Barikade server listening on", PORT, "build", SERVER_BUILD));
