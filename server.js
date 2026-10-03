import fs from "fs";
import path from "path";
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import admin from "firebase-admin";

const PORT = process.env.PORT || 10000;
const SERVER_BUILD = "barikade-v29-skyjo-true-multiplayer-20261003";

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
const ALLOWED_BOARD_THEMES = ["classic", "wood", "stone"];
function normalizeDiceStyle(value){
  const v = String(value || "").toLowerCase().trim();
  return ALLOWED_DICE_STYLES.includes(v) ? v : "classic";
}

// V13.9.3: Zentrale Normalisierung fuer das Brettdesign.
// Diese Funktion wurde in V13.9.x bereits aufgerufen, fehlte aber versehentlich
// in der Serverdatei. Das fuehrte bei /ensure zur Laufzeit zu ReferenceError
// und damit zu "Raum konnte nicht erstellt werden".
function normalizeBoardTheme(value){
  const v = String(value || "").toLowerCase().trim();
  return ALLOWED_BOARD_THEMES.includes(v) ? v : "wood";
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
const BASE_ACTION_JOKER_TYPES = ["allColors","barricade","reroll","double"];
const BOSS_ACTION_JOKER_TYPES = ["bossSpawn","bossRemove"];
const ACTION_JOKER_TYPES = [...BASE_ACTION_JOKER_TYPES, ...BOSS_ACTION_JOKER_TYPES];

function jokerTypesForRoom(room){
  return room?.state?.bossMode ? ACTION_JOKER_TYPES : BASE_ACTION_JOKER_TYPES;
}

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
      red:      { allColors:0, barricade:0, reroll:0, double:0, bossSpawn:0, bossRemove:0 },
      blue:     { allColors:0, barricade:0, reroll:0, double:0, bossSpawn:0, bossRemove:0 },
      green:    { allColors:0, barricade:0, reroll:0, double:0, bossSpawn:0, bossRemove:0 },
      yellow:   { allColors:0, barricade:0, reroll:0, double:0, bossSpawn:0, bossRemove:0 },
    };
  } else {
    for(const c of ALLOWED_COLORS){
      if(!action.jokersByColor[c] || typeof action.jokersByColor[c] !== "object"){
        action.jokersByColor[c] = { allColors:0, barricade:0, reroll:0, double:0, bossSpawn:0, bossRemove:0 };
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
    const counts = { allColors:0, barricade:0, reroll:0, double:0, bossSpawn:0, bossRemove:0 };
    for(const j of owned){
      const t = String(j?.type || "");
      if(counts[t] != null) counts[t] += 1;
    }
    action.jokersByColor[c] = counts;
  }
}

function seedBossJokersForLegacyRoom(room){
  try{
    const state=room?.state;
    const action=state?.action;
    if(!state?.bossMode || !action) return false;

    ensureActionJokers(action);

    // Nur EINMAL pro altem Spielstand. Nach Verbrauch werden die Joker nie automatisch aufgefüllt.
    if(action.bossJokerSeedV1 === true) return false;

    const configured = Number(state.jokerStartCount ?? room?.jokerStartCount);
    let seedCount = Number.isFinite(configured) ? Math.max(0, Math.min(5, Math.floor(configured))) : 0;

    // Für ältere Saves ohne jokerStartCount: aus dem vorhandenen Startbestand der
    // vier bisherigen Joker ableiten. So wird z.B. ein alter x2-Spielstand zu x2/x2.
    if(seedCount===0){
      let inferred=0;
      for(const c of ALLOWED_COLORS){
        const set=action.jokersByColor?.[c] || {};
        inferred=Math.max(
          inferred,
          Number(set.allColors||0),
          Number(set.barricade||0),
          Number(set.reroll||0),
          Number(set.double||0)
        );
      }
      seedCount=Math.max(0,Math.min(5,Math.floor(inferred||0)));
    }

    // Nur hinzufügen, wenn die neuen Typen in diesem alten Save noch gar nicht vorhanden sind.
    for(const c of ALLOWED_COLORS){
      if(!Array.isArray(action.jokersOwned[c])) action.jokersOwned[c]=[];

      const hasSpawn=action.jokersOwned[c].some(j=>String(j?.type||"")==="bossSpawn");
      const hasRemove=action.jokersOwned[c].some(j=>String(j?.type||"")==="bossRemove");

      if(!hasSpawn){
        for(let i=0;i<seedCount;i++){
          action.jokersOwned[c].push({type:"bossSpawn",color:c,source:"boss-joker-migration",ts:Date.now()});
        }
      }
      if(!hasRemove){
        for(let i=0;i<seedCount;i++){
          action.jokersOwned[c].push({type:"bossRemove",color:c,source:"boss-joker-migration",ts:Date.now()});
        }
      }
    }

    action.bossJokerSeedV1=true;
    syncJokerCountsFromOwned(action);
    return seedCount>0;
  }catch(_e){
    return false;
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
  hunter:   { key:"hunter",   name:"Der Jäger",         icon:"🐺", hp:1, steps:1, cadence:"player_move", rewardJokers:1 },
  curse:    { key:"curse",    name:"Der Fluchmeister", icon:"🧙", hp:1, steps:5, cadence:"round",       rewardJokers:1 },
  shadow:   { key:"shadow",   name:"Der Schatten",     icon:"👻", hp:1, steps:3, cadence:"round",       rewardJokers:1 },
  doppel:   { key:"doppel",   name:"Der Doppelgänger", icon:"👥", hp:1, steps:0, cadence:"player_move", rewardJokers:2 },
  devourer: { key:"devourer", name:"Der Weltenfresser",icon:"🌌", hp:1, steps:0, cadence:"turn5",       rewardJokers:3 },
};

// ---------- V14 Ereigniskarten: exakt 106 Karten ----------
// Jede Karte besitzt eine eindeutige ID. Das Deck wird vollständig gemischt,
// Karte für Karte gezogen und erst nach Verbrauch aller 106 Karten neu gemischt.
const EVENT_DECK_VERSION = 14;
function repeatEventCards(prefix,count,base){
  return Array.from({length:count},(_,i)=>({
    ...base,
    id:`${prefix}_${String(i+1).padStart(2,"0")}`,
  }));
}

const EVENT_CARD_DEFS = [
  ...repeatEventCards("boss_one",15,{icon:"👹",title:"Ein Boss erscheint",text:"Ein zufälliger Boss erscheint an einem freien Bossportal.",effect:"spawn_one"}),
  ...repeatEventCards("boss_two",6,{icon:"☠️",title:"Zwei Bosse erscheinen",text:"Bis zu zwei zufällige Bosse erscheinen an freien Bossportalen.",effect:"spawn_two"}),
  ...repeatEventCards("again",5,{icon:"🎲",title:"Nochmal würfeln",text:"Du darfst nach diesem Zug sofort erneut würfeln.",effect:"extra_roll"}),
  ...repeatEventCards("minus2",2,{icon:"🥾",title:"Schwerer Fluch",text:"Dein nächster Würfelwurf erhält −2. Minimum bleibt 1.",effect:"roll_minus2"}),
  ...repeatEventCards("barrier_shuffle",1,{icon:"🧱",title:"Barikadenchaos",text:"Alle 12 Barikaden werden zufällig neu auf zulässige Felder verteilt.",effect:"barrier_shuffle_all"}),
  ...repeatEventCards("boss_now",2,{icon:"⚡",title:"Bossaktion!",text:"Alle aktiven Bosse führen sofort ihre normale Bossaktion aus.",effect:"boss_action_now"}),
  ...repeatEventCards("joker_one",5,{icon:"🎁",title:"Joker erhalten",text:"Du erhältst einen zufälligen Joker.",effect:"joker_one"}),
  ...repeatEventCards("positions",1,{icon:"🔀",title:"Positionschaos",text:"Alle Figuren auf dem Brett tauschen ihre Positionen zufällig. Figuren im Starthaus bleiben dort.",effect:"player_positions_shuffle"}),
  ...repeatEventCards("boss_sleep",2,{icon:"😴",title:"Bosse setzen aus",text:"Alle Bosse setzen die nächste vollständige Bossrunde aus.",effect:"boss_sleep"}),
  ...repeatEventCards("boss_defeat_all",3,{icon:"⚔️",title:"Alle Bosse besiegt",text:"Alle aktuell aktiven Bosse sind sofort besiegt und verschwinden.",effect:"defeat_all_bosses"}),
  ...repeatEventCards("walk10",1,{icon:"🚀",title:"10 Felder laufen",text:"Du darfst direkt eine eigene Figur genau 10 Felder bewegen.",effect:"walk10"}),
  ...repeatEventCards("boss_teleport",2,{icon:"🌀",title:"Boss-Teleport",text:"Ein zufälliger aktiver Boss wird auf ein zufälliges freies Brettfeld teleportiert.",effect:"boss_teleport"}),
  ...repeatEventCards("bounty",1,{icon:"🎯",title:"Kopfgeld",text:"Der nächste von einem Spieler besiegte Boss bringt mindestens 2 Joker. Eine höhere normale Bossbelohnung bleibt erhalten.",effect:"bounty"}),
  ...repeatEventCards("barrier_wander",2,{icon:"🧱",title:"Barikadenwanderung",text:"Drei zufällige Barikaden werden auf neue zulässige Felder versetzt.",effect:"barrier_wander3"}),
  ...repeatEventCards("curse_wave",1,{icon:"🧙",title:"Fluchwelle",text:"Spieler in bis zu 3 Feldern Entfernung zum Fluchmeister erhalten −2 auf den nächsten Wurf.",effect:"curse_wave"}),
  ...repeatEventCards("skip_next",1,{icon:"⏸️",title:"Nächste Runde aussetzen",text:"Du setzt deinen nächsten vollständigen Spielzug aus.",effect:"skip_next_turn"}),
  ...repeatEventCards("joker_two",5,{icon:"🎁",title:"Doppel-Joker",text:"Du erhältst 2 zufällige Joker.",effect:"joker_two"}),
  ...repeatEventCards("lose_jokers",1,{icon:"💀",title:"Alle Joker verlieren",text:"Du verlierst alle Joker, die du aktuell besitzt.",effect:"lose_all_jokers"}),
  ...repeatEventCards("all_forward",1,{icon:"⏩",title:"Alle vorwärts!",text:"Alle Figuren auf dem Brett bewegen sich 1 Feld Richtung Ziel.",effect:"all_pieces_forward"}),

  // --- neue Karten V14 ---
  ...repeatEventCards("piece_home",2,{icon:"🏠",title:"Zurück ins Haus",text:"Wähle eine eigene Spielfigur auf dem Brett. Sie wird zurück ins Starthaus teleportiert.",effect:"piece_home"}),
  ...repeatEventCards("walk20",1,{icon:"🚀",title:"20 Felder laufen",text:"Du darfst direkt eine eigene Figur genau 20 Felder bewegen.",effect:"walk20"}),
  ...repeatEventCards("boss_global_shield",1,{icon:"🛡️",title:"Boss-Schutzschild – 3 Runden",text:"Alle aktiven Bosse sind 3 vollständige Bossrunden lang vor dem Besiegen geschützt.",effect:"boss_global_shield_3"}),
  ...repeatEventCards("double_dice_round",1,{icon:"🎲",title:"Doppelwurf-Runde",text:"Jeder aktive Spieler würfelt bei seinem nächsten Wurf mit 2 Würfeln. Beide Augen werden addiert.",effect:"all_double_roll_round"}),
  ...repeatEventCards("piece_swap",1,{icon:"🔁",title:"Figurentausch",text:"Tausche eine eigene Brettfigur mit einer Brettfigur eines anderen Spielers.",effect:"swap_piece_opponent"}),
  ...repeatEventCards("barrier_steal",1,{icon:"🧱",title:"Barikade klauen",text:"Wähle eine Barikade und versetze sie auf ein anderes erlaubtes Feld.",effect:"barrier_steal"}),
  ...repeatEventCards("piece_shield",3,{icon:"🛡️",title:"Schutzschild",text:"Die Figur, die diese Karte ausgelöst hat, ist bis zu deinem nächsten Zug vor negativen Ereignissen geschützt.",effect:"piece_event_shield"}),
  ...repeatEventCards("walk3",1,{icon:"👣",title:"Kleine Abkürzung",text:"Du darfst direkt eine eigene Figur genau 3 Felder bewegen.",effect:"walk3"}),
  ...repeatEventCards("back3",1,{icon:"🔙",title:"Rückwärtsgang",text:"Wähle eine gegnerische Figur auf dem Brett. Sie geht 3 Felder zurück.",effect:"opponent_back3"}),
  ...repeatEventCards("exact_roll",1,{icon:"🎯",title:"Exakter Zug",text:"Bei deinem nächsten Wurf darfst du das Ergebnis um 1 erhöhen oder senken.",effect:"exact_roll"}),
  ...repeatEventCards("predict",1,{icon:"🔮",title:"Vorhersage",text:"Sage für deinen nächsten Wurf gerade oder ungerade voraus. Richtig = +2 Felder als Zusatzbewegung.",effect:"predict_parity"}),
  ...repeatEventCards("barrier_swap",1,{icon:"🧱",title:"Barikaden-Tausch",text:"Wähle zwei Barikaden. Ihre Sonderzustände und Positionen werden miteinander getauscht.",effect:"barrier_swap"}),
  ...repeatEventCards("barrier_lock",1,{icon:"🔐",title:"Feste Barikade",text:"Wähle eine Barikade. Bis zu deinem nächsten Zug darf sie nicht bewegt werden.",effect:"barrier_lock"}),
  ...repeatEventCards("barrier_magnet",1,{icon:"🧲",title:"Barikaden-Magnet",text:"Wähle eine eigene Figur. Die nächstgelegene Barikade wird auf ein freies Feld direkt vor ihr gezogen.",effect:"barrier_magnet"}),
  ...repeatEventCards("roadblock",1,{icon:"🚧",title:"Straßensperre",text:"Platziere für zwei Runden eine zusätzliche feste Barikade. Sie kann nicht aufgehoben oder übersprungen werden.",effect:"roadblock_2rounds"}),
  ...repeatEventCards("barrier_blast",1,{icon:"🧨",title:"Sprengmeister",text:"Wähle eine Barikade. Sie wird sofort auf ein zufälliges erlaubtes Feld versetzt.",effect:"barrier_blast"}),
  ...repeatEventCards("barrier_ban",1,{icon:"❌",title:"Barikadenverbot",text:"Bis zu deinem nächsten Zug darf kein Gegner eine Barikade direkt vor eine deiner Figuren setzen.",effect:"barrier_ban"}),
  ...repeatEventCards("six_hunt",1,{icon:"6️⃣",title:"Sechser-Jagd",text:"Deine nächste gewürfelte 6 bringt zusätzlich einen zufälligen Joker.",effect:"six_hunt"}),
  ...repeatEventCards("three_rule",1,{icon:"3️⃣",title:"Dreier-Regel",text:"Würfelst du bei deinem nächsten Wurf genau eine 3, darfst du anschließend nochmals würfeln.",effect:"three_rule"}),
  ...repeatEventCards("minimum3",1,{icon:"🎲",title:"Minimum garantiert",text:"Dein nächster Würfelwurf kann nicht kleiner als 3 sein.",effect:"minimum3"}),
  ...repeatEventCards("joker_bet",4,{icon:"🃏",title:"Joker-Wette",text:"Du darfst freiwillig einen Joker setzen. Würfle 4–6 und du erhältst zwei zufällige Joker zurück.",effect:"joker_bet"}),
  ...repeatEventCards("joker_lock",5,{icon:"🔒",title:"Joker-Sperre",text:"Wähle einen Gegner. Er kann in seinem nächsten Zug keinen Joker einsetzen.",effect:"joker_lock"}),
  ...repeatEventCards("boss_rage",1,{icon:"👹",title:"Boss wird wütend",text:"Wähle einen aktiven Boss. Seine nächste Bewegung wird doppelt ausgeführt.",effect:"boss_rage"}),
  ...repeatEventCards("boss_shield_activation",1,{icon:"🛡️",title:"Boss-Schutzschild",text:"Wähle einen aktiven Boss. Er kann bis nach seiner nächsten Aktivierung nicht besiegt werden.",effect:"boss_shield_activation"}),
  ...repeatEventCards("boss_change",1,{icon:"🔀",title:"Boss-Wechsel",text:"Wähle einen aktiven Boss. Er wird durch einen anderen Boss-Typ ersetzt; seine Position bleibt gleich.",effect:"boss_change"}),
  ...repeatEventCards("laggard",1,{icon:"👥",title:"Nachzüglerhilfe",text:"Deine am weitesten hinten stehende Brettfigur bewegt sich 4 Felder Richtung Ziel.",effect:"laggard4"}),
  ...repeatEventCards("trap",10,{icon:"🕳️",title:"Falle stellen",text:"Markiere ein freies Brettfeld. Der nächste gegnerische Spieler, der dort landet, muss dir einen Joker geben.",effect:"trap"}),
  ...repeatEventCards("miniportal",1,{icon:"🚪",title:"Miniportal",text:"Platziere zwei dauerhaft verbundene Portalfelder. Sie dürfen höchstens 6 Brettfelder voneinander entfernt sein.",effect:"miniportal"}),
  ...repeatEventCards("leave_house",1,{icon:"🏃",title:"Alle raus!",text:"Alle Spielfiguren verlassen das Starthaus und werden auf freie Felder nahe ihrem Start gesetzt.",effect:"all_leave_house"}),
  ...repeatEventCards("barriers_gone",1,{icon:"💨",title:"Keine Barikaden mehr!",text:"Alle Barikaden verschwinden dauerhaft für den Rest des Spiels vom Brett.",effect:"barriers_gone_forever"}),
];

if(EVENT_CARD_DEFS.length !== 106){
  throw new Error(`Ereigniskartendeck muss exakt 106 Karten enthalten, aktuell: ${EVENT_CARD_DEFS.length}`);
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

const BOSS_EVENT_FIELD_DEFAULT = 8;
const BOSS_EVENT_FIELD_MIN = 5;
const BOSS_EVENT_FIELD_MAX = 20;
const BOSS_EVENT_MIN_DISTANCE = 3;
const BOSS_EVENT_BOSS_TRIGGER_DEFAULT = 3;
const BOSS_EVENT_BOSS_TRIGGER_MIN = 0;
const BOSS_EVENT_BOSS_TRIGGER_MAX = 10;

function normalizeBossEventFieldCount(value, fallback=BOSS_EVENT_FIELD_DEFAULT){
  const n=Math.floor(Number(value));
  if(Number.isInteger(n) && n>=BOSS_EVENT_FIELD_MIN && n<=BOSS_EVENT_FIELD_MAX) return n;
  const f=Math.floor(Number(fallback));
  return Number.isInteger(f) && f>=BOSS_EVENT_FIELD_MIN && f<=BOSS_EVENT_FIELD_MAX ? f : BOSS_EVENT_FIELD_DEFAULT;
}

function bossEventFieldCount(room,b){
  return normalizeBossEventFieldCount(
    b?.eventFieldCount ?? room?.state?.eventFieldCount,
    BOSS_EVENT_FIELD_DEFAULT
  );
}

function normalizeBossEventBossTrigger(value, fallback=BOSS_EVENT_BOSS_TRIGGER_DEFAULT){
  const n=Math.floor(Number(value));
  if(Number.isInteger(n) && n>=BOSS_EVENT_BOSS_TRIGGER_MIN && n<=BOSS_EVENT_BOSS_TRIGGER_MAX) return n;
  const f=Math.floor(Number(fallback));
  return Number.isInteger(f) && f>=BOSS_EVENT_BOSS_TRIGGER_MIN && f<=BOSS_EVENT_BOSS_TRIGGER_MAX ? f : BOSS_EVENT_BOSS_TRIGGER_DEFAULT;
}

function bossEventBossTrigger(room,b){
  return normalizeBossEventBossTrigger(
    b?.bossEventTrigger ?? room?.state?.bossEventTrigger ?? room?.bossEventTrigger,
    BOSS_EVENT_BOSS_TRIGGER_DEFAULT
  );
}

function createBossState(eventFieldCount=BOSS_EVENT_FIELD_DEFAULT, bossEventTrigger=BOSS_EVENT_BOSS_TRIGGER_DEFAULT){
  const deck=EVENT_CARD_DEFS.map(c=>c.id); shuffleInPlace(deck);
  return {
    v:10,
    slots:normalizedBossSlots(),
    eventFieldCount:normalizeBossEventFieldCount(eventFieldCount),
    bossEventTrigger:normalizeBossEventBossTrigger(bossEventTrigger),
    // Anzahl ist in der Lobby zwischen 5 und 20 wählbar.
    eventFields:[],
    // Zusatzboss-Countdown: 0 = deaktiviert, 1–10 = nach so vielen bestätigten Ereigniskarten.
    // Sind beide Portale beim Erreichen von 0 belegt, wartet der Spawn auf ein freies Portal.
    bossEventCountdown:normalizeBossEventBossTrigger(bossEventTrigger),
    bossCountdownPending:false,
    bossEventTriggersTotal:0,
    deck, discard:[], lastEvent:null, lastAction:null, history:[],
    // V24: persistente Boss-Enthuellung fuer alle Clients.
    lastSpawn:null, spawnHistory:[], spawnSeq:0,
    // V27: 15er-Bosspool. Jede der 5 Bossarten liegt exakt 3x im Pool.
    // Der Pool wird komplett gemischt und erst nach 15 Ziehungen neu befuellt.
    // Persistiert ueber Reconnect/Save-State.
    bossPool:[], bossPoolCycle:0, bossPoolDraws:0,
    eventSeq:0, actionSeq:0, round:1, turnsInRound:0, sleepRounds:0, sleepActiveRound:null,
    rollModsByColor:{red:0,blue:0,green:0,yellow:0},
    skipTurnsByColor:{red:0,blue:0,green:0,yellow:0},
    forcedMoveByColor:{red:0,blue:0,green:0,yellow:0}, // Legacy-Fallback für alte gespeicherte Räume
    forcedMoveQueueByColor:{red:[],blue:[],green:[],yellow:[]},
    bountyNextBoss:false,
    deckVersion:EVENT_DECK_VERSION,
    pendingChoice:null,
    // V17: hält den Spielerzug an, bis die sichtbare Ereigniskarte bestätigt und vollständig abgearbeitet wurde.
    pendingEventTurn:null,
    globalBossShieldRounds:0,
    doubleDiceByColor:{red:false,blue:false,green:false,yellow:false},
    exactRollByColor:{red:false,blue:false,green:false,yellow:false},
    predictionByColor:{red:null,blue:null,green:null,yellow:null},
    threeRuleByColor:{red:false,blue:false,green:false,yellow:false},
    minimum3ByColor:{red:false,blue:false,green:false,yellow:false},
    sixHuntByColor:{red:false,blue:false,green:false,yellow:false},
    jokerLockByColor:{red:false,blue:false,green:false,yellow:false},
    barrierBanUntilRound:{red:0,blue:0,green:0,yellow:0},
    pieceEventShields:{},
    lockedBarricades:{},
    roadblocks:{},
    traps:[],
    miniPortal:null,
    // Weltenfresser: genau ein globales schwarzes Loch gleichzeitig.
    blackHole:null,
    // Doppelgänger-Zug wird beim Aufheben einer Barikade bis nach deren Platzierung gepuffert.
    pendingDoppelCopy:null,
    barricadesDisabled:false,
  };
}

// Globale Start-Schutzregel:
// Alle im Brett bereits als noBarricade markierten Startzonen sind fuer
// dynamisch erzeugte Spezialfelder tabu. Das gilt zentral fuer Ereignisfelder,
// Fallen, Miniportale, temporaere Barikaden und kuenftige Felder wie das
// Schwarze Loch des Weltenfressers. Figuren und Bosse duerfen diese Felder
// weiterhin normal betreten; nur neue Spezial-/Sperrfelder duerfen dort nicht entstehen.
function isStartProtectedNode(nodeId){
  const n=NODES.get(String(nodeId||""));
  return !!(n && n.kind==="board" && (n.flags?.noBarricade || n.flags?.startColor));
}

function eventFieldStaticCandidates(){
  const starts=new Set(Object.values(STARTS||{}).map(String));
  return (BOARD.nodes||[])
    .filter(n=>n?.kind==="board")
    .map(n=>String(n.id))
    .filter(id=>id && id!==String(GOAL||"") && !starts.has(id) && !isStartProtectedNode(id));
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
  for(const t of (b?.traps||[])) if(t?.nodeId) blocked.add(String(t.nodeId));
  if(b?.miniPortal?.a) blocked.add(String(b.miniPortal.a));
  if(b?.miniPortal?.b) blocked.add(String(b.miniPortal.b));
  if(b?.blackHole?.nodeId) blocked.add(String(b.blackHole.nodeId));
  return blocked;
}

function randomEventFieldLayout(room,b,count=null,{avoidDynamic=true,excludeIds=[]}={}){
  count=normalizeBossEventFieldCount(count ?? bossEventFieldCount(room,b));
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
  // Damit bleiben die Bedingungen „gewählte Feldanzahl“ + Mindestabstand 3 erhalten,
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
  const desired=bossEventFieldCount(room,b);
  b.eventFieldCount=desired;
  if(room?.state) room.state.eventFieldCount=desired;
  const staticSet=new Set(eventFieldStaticCandidates());
  const current=Array.isArray(b.eventFields)?[...new Set(b.eventFields.map(String))].filter(id=>staticSet.has(id)):[];
  const valid=current.length===desired && eventFieldsSpaced(current);
  if(valid && !force){b.eventFields=current;return current;}

  const next=randomEventFieldLayout(room,b,desired,{avoidDynamic:true});
  // Niemals Ereignisfelder unter Figuren, Barikaden oder aktive Bosse legen.
  // Sollte ein extrem belegtes Brett vorübergehend nicht alle gewünschten sicheren
  // Felder zulassen, behalten wir nur die sicher gefundenen Felder statt Kollisionen.
  b.eventFields=next.slice(0,desired);
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
    // Kein unsicherer Fallback: stattdessen alle gewählten Felder komplett neu und kollisionsfrei suchen.
    const desired=bossEventFieldCount(room,b);
    const relayout=randomEventFieldLayout(room,b,desired,{avoidDynamic:true,excludeIds:[used]});
    if(relayout.length===desired){
      b.eventFields=relayout.slice();
      next=b.eventFields.find(id=>!remaining.includes(id)) || b.eventFields[b.eventFields.length-1] || null;
      return next;
    }
  }

  if(next) b.eventFields.push(String(next));
  const desired=bossEventFieldCount(room,b);
  if(b.eventFields.length!==desired || !eventFieldsSpaced(b.eventFields)){
    const relayout=randomEventFieldLayout(room,b,desired,{avoidDynamic:true,excludeIds:[used]});
    if(relayout.length===desired){
      b.eventFields=relayout.slice();
      next=b.eventFields.find(id=>!remaining.includes(id)) || b.eventFields[b.eventFields.length-1] || null;
    }
  }
  return next;
}

function ensureBossState(room){
  if(!room?.state?.bossMode) return null;
  if(!room.state.boss || typeof room.state.boss!=="object") room.state.boss=createBossState(room?.state?.eventFieldCount, room?.state?.bossEventTrigger ?? room?.bossEventTrigger);
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
    if(boss.type==="devourer") boss.turnsSinceAction=Math.max(0,Math.min(4,Math.floor(Number(boss.turnsSinceAction||0))));
  }

  if(!Array.isArray(b.eventFields)) b.eventFields=[];
  b.eventFieldCount=normalizeBossEventFieldCount(b.eventFieldCount ?? room?.state?.eventFieldCount);
  room.state.eventFieldCount=b.eventFieldCount;
  b.bossEventTrigger=normalizeBossEventBossTrigger(b.bossEventTrigger ?? room?.state?.bossEventTrigger ?? room?.bossEventTrigger);
  room.state.bossEventTrigger=b.bossEventTrigger;
  if(b.bossEventTrigger<=0){
    b.bossEventCountdown=0;
    b.bossCountdownPending=false;
  }else{
    b.bossEventCountdown=Math.max(0,Math.min(b.bossEventTrigger,Math.floor(Number(b.bossEventCountdown ?? b.bossEventTrigger))));
    b.bossCountdownPending=!!b.bossCountdownPending;
  }
  b.bossEventTriggersTotal=Math.max(0,Math.floor(Number(b.bossEventTriggersTotal||0)));
  if(Number(b.deckVersion||0)!==EVENT_DECK_VERSION){
    b.deck=EVENT_CARD_DEFS.map(c=>c.id); shuffleInPlace(b.deck); b.discard=[]; b.deckVersion=EVENT_DECK_VERSION;
  }
  if(!Array.isArray(b.deck) || b.deck.some(id=>!EVENT_CARD_DEFS.some(c=>c.id===id))) b.deck=[];
  if(!Array.isArray(b.discard)) b.discard=[];
  if(!Array.isArray(b.history)) b.history=[];
  if(!b.rollModsByColor || typeof b.rollModsByColor!=="object") b.rollModsByColor={red:0,blue:0,green:0,yellow:0};
  if(!b.skipTurnsByColor || typeof b.skipTurnsByColor!=="object") b.skipTurnsByColor={red:0,blue:0,green:0,yellow:0};
  if(!b.forcedMoveByColor || typeof b.forcedMoveByColor!=="object") b.forcedMoveByColor={red:0,blue:0,green:0,yellow:0};
  if(!b.forcedMoveQueueByColor || typeof b.forcedMoveQueueByColor!=="object") b.forcedMoveQueueByColor={red:[],blue:[],green:[],yellow:[]};
  for(const c of ALLOWED_COLORS){
    if(!Number.isFinite(Number(b.rollModsByColor[c]))) b.rollModsByColor[c]=0;
    b.skipTurnsByColor[c]=Math.max(0,Math.floor(Number(b.skipTurnsByColor[c]||0)));
    b.forcedMoveByColor[c]=Math.max(0,Math.floor(Number(b.forcedMoveByColor[c]||0)));
    if(!Array.isArray(b.forcedMoveQueueByColor[c])) b.forcedMoveQueueByColor[c]=[];
    b.forcedMoveQueueByColor[c]=b.forcedMoveQueueByColor[c]
      .map(x=>Math.max(0,Math.floor(Number(x||0))))
      .filter(x=>x>0&&x<=20)
      .slice(0,8);
  }
  b.bountyNextBoss=!!b.bountyNextBoss;
  b.pendingChoice=(b.pendingChoice&&typeof b.pendingChoice==="object")?b.pendingChoice:null;
  b.pendingEventTurn=(b.pendingEventTurn&&typeof b.pendingEventTurn==="object"&&Number(b.pendingEventTurn.seq)>0)
    ? {seq:Math.floor(Number(b.pendingEventTurn.seq)),color:String(b.pendingEventTurn.color||""),pickedBarricade:!!b.pendingEventTurn.pickedBarricade,createdAt:Number(b.pendingEventTurn.createdAt||Date.now())}
    : null;
  b.globalBossShieldRounds=Math.max(0,Math.floor(Number(b.globalBossShieldRounds||0)));
  b.globalBossShieldStartRound=Math.max(1,Math.floor(Number(b.globalBossShieldStartRound||1)));
  for(const key of ["doubleDiceByColor","exactRollByColor","threeRuleByColor","minimum3ByColor","sixHuntByColor","jokerLockByColor"]){
    if(!b[key]||typeof b[key]!=="object") b[key]={red:false,blue:false,green:false,yellow:false};
    for(const c of ALLOWED_COLORS) b[key][c]=!!b[key][c];
  }
  if(!b.predictionByColor||typeof b.predictionByColor!=="object") b.predictionByColor={red:null,blue:null,green:null,yellow:null};
  for(const c of ALLOWED_COLORS) b.predictionByColor[c]=["even","odd"].includes(String(b.predictionByColor[c]||""))?String(b.predictionByColor[c]):null;
  if(!b.barrierBanUntilRound||typeof b.barrierBanUntilRound!=="object") b.barrierBanUntilRound={red:0,blue:0,green:0,yellow:0};
  for(const c of ALLOWED_COLORS) b.barrierBanUntilRound[c]=Math.max(0,Math.floor(Number(b.barrierBanUntilRound[c]||0)));
  if(!b.pieceEventShields||typeof b.pieceEventShields!=="object") b.pieceEventShields={};
  if(!b.lockedBarricades||typeof b.lockedBarricades!=="object") b.lockedBarricades={};
  if(!b.roadblocks||typeof b.roadblocks!=="object") b.roadblocks={};
  for(const [id,rec] of Object.entries({...b.roadblocks})){
    if(!rec||!(room.state.barricades||[]).map(String).includes(String(id))){ delete b.roadblocks[id]; continue; }
    rec.ownerColor=String(rec.ownerColor||""); rec.roundsLeft=Math.max(0,Math.floor(Number(rec.roundsLeft||0))); rec.startRound=Math.max(1,Math.floor(Number(rec.startRound||1)));
  }
  if(!Array.isArray(b.traps)) b.traps=[];
  // Migration/Sicherheitsnetz: alte Spielstaende duerfen keine Spezialfelder
  // in der neuen globalen Start-Schutzregion behalten.
  b.traps=b.traps
    .filter(t=>t&&t.nodeId&&ALLOWED_COLORS.includes(String(t.ownerColor||""))&&!isStartProtectedNode(String(t.nodeId)))
    .map(t=>({nodeId:String(t.nodeId),ownerColor:String(t.ownerColor)}));
  b.miniPortal=(b.miniPortal&&b.miniPortal.a&&b.miniPortal.b)?{a:String(b.miniPortal.a),b:String(b.miniPortal.b)}:null;
  if(b.miniPortal && (isStartProtectedNode(b.miniPortal.a)||isStartProtectedNode(b.miniPortal.b))) b.miniPortal=null;
  b.blackHole=(b.blackHole&&b.blackHole.nodeId)?{
    nodeId:String(b.blackHole.nodeId),
    sourceBossId:String(b.blackHole.sourceBossId||""),
    createdRound:Math.max(1,Math.floor(Number(b.blackHole.createdRound||b.round||1)))
  }:null;
  if(b.blackHole){
    const hid=String(b.blackHole.nodeId);
    const hn=NODES.get(hid);
    const invalid=!hn||hn.kind!=="board"||hid===String(GOAL||"")||isStartProtectedNode(hid)
      ||(room.state.pieces||[]).some(pc=>pc?.posKind==="board"&&String(pc.nodeId||"")===hid);
    if(invalid) b.blackHole=null;
    if(b.blackHole){
      const sourceAlive=b.slots.some(sl=>sl?.boss?.type==="devourer"&&String(sl.boss.id||"")===String(b.blackHole.sourceBossId||""));
      if(!sourceAlive) b.blackHole=null;
    }
  }
  b.pendingDoppelCopy=(b.pendingDoppelCopy&&ALLOWED_COLORS.includes(String(b.pendingDoppelCopy.color||""))&&Number(b.pendingDoppelCopy.steps)>0)
    ? {color:String(b.pendingDoppelCopy.color),steps:Math.max(1,Math.min(20,Math.floor(Number(b.pendingDoppelCopy.steps))))}
    : null;
  b.barricadesDisabled=!!b.barricadesDisabled;
  if(b.barricadesDisabled){ room.state.barricades=[]; b.roadblocks={}; b.lockedBarricades={}; }
  b.round=Math.max(1,Number(b.round||1)); b.turnsInRound=Math.max(0,Number(b.turnsInRound||0));
  b.sleepRounds=Math.max(0,Math.floor(Number(b.sleepRounds||0)));
  b.sleepActiveRound=Number.isFinite(Number(b.sleepActiveRound))&&Number(b.sleepActiveRound)>0?Math.floor(Number(b.sleepActiveRound)):null;
  b.eventSeq=Math.max(0,Number(b.eventSeq||0)); b.actionSeq=Math.max(0,Number(b.actionSeq||0));
  b.spawnSeq=Math.max(0,Math.floor(Number(b.spawnSeq||0)));
  b.lastSpawn=(b.lastSpawn&&typeof b.lastSpawn==="object"&&Number(b.lastSpawn.seq)>0)?b.lastSpawn:null;
  if(!Array.isArray(b.spawnHistory)) b.spawnHistory=[];
  b.spawnHistory=b.spawnHistory.filter(x=>x&&Number(x.seq)>0).slice(-8);
  // V26 Migration: alte Raeume erhalten beim ersten Zugriff einen frischen Boss-Mischbeutel.
  normalizeBossBag(b);
  ensureBossEventFieldLayout(room,b,false);
  b.v=11;
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

function bossShortestPath(startId,targetId,room=null){
  startId=String(startId||""); targetId=String(targetId||"");
  if(!startId||!targetId||!NODES.has(startId)||!NODES.has(targetId)) return null;
  if(startId===targetId) return [startId];
  const blackHole=room?.state?.bossMode?String(ensureBossState(room)?.blackHole?.nodeId||""):"";
  if(blackHole && (startId===blackHole || targetId===blackHole)) return null;
  const q=[startId], prev=new Map([[startId,null]]);
  for(let qi=0;qi<q.length;qi++){
    const u=q[qi];
    for(const v of bossBoardNeighbors(u)){
      if(blackHole && String(v)===blackHole) continue;
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

// Doppelgänger: Ziel ist immer der Spieler mit den meisten Figuren AUF dem Brett.
function doppelTargetColor(room){
  const colors=activeBossColors(room); if(!colors.length) return "red";
  let max=-1;
  const counts=new Map();
  for(const c of colors){
    const n=boardPiecesForColor(room,c).length; counts.set(c,n); max=Math.max(max,n);
  }
  const tied=colors.filter(c=>counts.get(c)===max);
  // Bei Gleichstand wird der weiter vorne liegende Spieler als eindeutiger Tie-Breaker gewählt.
  return tied.length===1?tied[0]:bossLeadingColor(room,tied);
}

function doppelTargetNodes(room){
  const c=doppelTargetColor(room);
  const pcs=boardPiecesForColor(room,c);
  if(pcs.length) return pcs.map(p=>String(p.nodeId));
  const st=STARTS?.[c];
  return st?[String(st)]:[];
}

function blackHoleNode(room){
  const b=room?.state?.bossMode?ensureBossState(room):null;
  return String(b?.blackHole?.nodeId||"");
}

function doppelBarricadeFrontTargets(room,ignoreBarricadeNode=null){
  const colors=activeBossColors(room).slice(); shuffleInPlace(colors);
  const out=[];
  for(const c of colors){
    const pcs=boardPiecesForColor(room,c).slice(); shuffleInPlace(pcs);
    for(const pc of pcs){
      const choices=forwardChoices(String(pc.nodeId)).slice(); shuffleInPlace(choices);
      for(const id of choices){
        if(isBossDropFieldFree(room,String(id),ignoreBarricadeNode) && !barrierPlacementForbiddenForActor(room,"__boss__",String(id))){
          out.push({nodeId:String(id),color:c,pieceId:String(pc.id||"")});
        }
      }
    }
  }
  return out;
}

function canDoppelLandOnBarricade(room,nodeId){
  const id=String(nodeId||"");
  const b=ensureBossState(room);
  if(!(room.state.barricades||[]).map(String).includes(id)) return true;
  if(b?.barricadesDisabled || barrierLockActive(room,id) || b?.roadblocks?.[id]) return false;
  return doppelBarricadeFrontTargets(room,id).length>0;
}

function doppelNodeAllowed(room,nodeId,isFinal){
  const id=String(nodeId||"");
  const b=ensureBossState(room);
  if(!id || NODES.get(id)?.kind!=="board") return false;
  if(String(b?.blackHole?.nodeId||"")===id) return false;
  if(b?.roadblocks?.[id] || barrierLockActive(room,id)) return false;
  const barr=(room.state.barricades||[]).map(String).includes(id);
  if(barr && !isFinal) return false; // Barikaden dürfen niemals übersprungen werden.
  if(barr && isFinal && !canDoppelLandOnBarricade(room,id)) return false;
  // Andere Bosse sind keine begehbaren Felder.
  if(activeBossEntries(room).some(e=>String(e.boss?.nodeId||"")===id)) return false;
  return true;
}

// Exakte Schrittzahl: findet nur Routen, auf denen keine Barikade vor dem Zielfeld liegt.
// Existiert keine komplette legale Strecke, bleibt der Doppelgänger vollständig stehen.
function chooseDoppelRoute(room,entry,steps){
  steps=Math.max(0,Math.min(20,Math.floor(Number(steps||0))));
  if(!steps) return [];
  const boss=entry?.boss, slot=entry?.slot; if(!boss) return [];
  const targets=doppelTargetNodes(room); if(!targets.length) return [];

  const starts=[];
  if(boss.nodeId){
    starts.push({node:String(boss.nodeId),path:[],used:new Set([String(boss.nodeId)]),left:steps});
  }else{
    for(const a of (slot?.anchors||[]).map(String)){
      if(!doppelNodeAllowed(room,a,steps===1)) continue;
      starts.push({node:a,path:[a],used:new Set([a]),left:steps-1});
    }
  }
  if(!starts.length) return [];

  // ZUGZWANG: Ein legaler Weg darf auch vom Ziel WEG führen (z.B. rückwärts vor einer
  // Barikade). Priorität bleibt: möglichst viele der kopierten Felder laufen; bei gleicher
  // Länge endet der Doppelgänger möglichst nah am Zielspieler. Nur wenn überhaupt kein
  // einziger legaler Schritt existiert, bleibt er stehen.
  let best=[],bestLen=-1,bestDist=Infinity,visits=0;
  const MAX_VISITS=60000;
  function consider(path,end){
    if(!path.length) return;
    const d=minDistanceFromNodeToTargets(String(end),targets,room);
    if(path.length>bestLen || (path.length===bestLen && d<bestDist)){
      best=path.slice();bestLen=path.length;bestDist=d;
    }
  }
  function dfs(node,path,used,left){
    if(++visits>MAX_VISITS) return;
    consider(path,node);
    if(left<=0) return;
    const ns=bossBoardNeighbors(node).map(String);
    ns.sort((a,c)=>minDistanceFromNodeToTargets(a,targets,room)-minDistanceFromNodeToTargets(c,targets,room));
    for(const nx of ns){
      if(used.has(nx)) continue;
      const isFinal=left===1;
      const isBarricade=(room.state.barricades||[]).map(String).includes(String(nx));
      // Zugzwang-Sonderfall: Liegt eine bewegliche Barikade direkt im einzig möglichen Weg,
      // darf der Doppelgänger auf ihr LANDEN und dort seinen verkürzten Lauf beenden.
      // Er darf sie niemals vor dem letzten tatsächlich gelaufenen Schritt überschreiten.
      if(isBarricade && !isFinal){
        if(canDoppelLandOnBarricade(room,nx)){
          path.push(nx); consider(path,nx); path.pop();
        }
        continue;
      }
      if(!doppelNodeAllowed(room,nx,isFinal)) continue;
      used.add(nx);path.push(nx);dfs(nx,path,used,left-1);path.pop();used.delete(nx);
      if(visits>MAX_VISITS) break;
    }
  }

  for(const st of starts){
    consider(st.path,st.node);
    dfs(st.node,st.path,st.used,st.left);
    if(bestLen===steps) break;
  }
  return bestLen>0?best:[];
}

function relocateDoppelLandingBarricade(room,nodeId){
  const id=String(nodeId||"");
  const arr=room.state.barricades||[]; const idx=arr.indexOf(id);
  if(idx<0) return null;
  const targets=doppelBarricadeFrontTargets(room,id); if(!targets.length) return null;
  const pick=targets[Math.floor(Math.random()*targets.length)];
  arr[idx]=String(pick.nodeId);
  return {from:id,to:String(pick.nodeId),targetColor:pick.color};
}

function executeDoppelRoute(room,entry,route){
  const boss=entry?.boss; if(!boss||!route?.length) return {text:"",kicked:0};
  const old=boss.nodeId?String(boss.nodeId):null;
  const final=String(route[route.length-1]);
  boss.lastNodeId=old; boss.nodeId=final;
  let barText="";
  if((room.state.barricades||[]).map(String).includes(final)){
    const moved=relocateDoppelLandingBarricade(room,final);
    if(moved) barText=` Barikade ${moved.from} → ${moved.to} direkt vor ${String(moved.targetColor).toUpperCase()}.`;
  }
  // Nur EXAKTE Landung schickt Figuren zurück ins Haus. Überquerte Figuren bleiben stehen.
  let kicked=0;
  for(const pc of piecesOnBossNode(room,final)){
    sendPieceHome(room,pc); kicked++;
  }
  boss.lastPath=route.map(String); boss.lastMovedAt=Date.now();
  return {kicked,text:`${kicked?`${kicked} Figur${kicked===1?"":"en"} zurück ins Haus.`:""}${barText}`.trim()};
}

function moveDoppelgangerEntry(room,entry,steps,{forced=false,actorColor=null}={}){
  const boss=entry?.boss; if(!boss||boss.type!=="doppel") return {wheels:[],text:""};
  steps=Math.max(1,Math.min(20,Math.floor(Number(steps||boss.lastCopiedSteps||1))));
  boss.lastCopiedSteps=steps;
  const route=chooseDoppelRoute(room,entry,steps);
  const parts=[];
  if(route.length){
    const r=executeDoppelRoute(room,entry,route);
    if(route.length<steps) parts.push(`Zugzwang: kein vollständiger ${steps}-Felder-Weg möglich – ${route.length} legal${route.length===1?"es Feld":"e Felder"} gelaufen.`);
    if(r.text) parts.push(r.text);
  }else{
    parts.push(`Kein einziger legaler Schritt möglich – der Doppelgänger muss stehen bleiben.`);
  }
  if(boss.rageDoubleNext){
    boss.rageDoubleNext=false;
    const r2=chooseDoppelRoute(room,entry,steps);
    if(r2.length){
      const rr=executeDoppelRoute(room,entry,r2);
      parts.push(`🔥 Wutanfall: zweiter Lauf mit ${r2.length}/${steps} Feldern.${rr.text?` ${rr.text}`:""}`);
    } else parts.push("🔥 Wutanfall: Kein legaler Schritt möglich.");
  }
  if(Number(boss.eventShieldActivations||0)>0) boss.eventShieldActivations=Math.max(0,Number(boss.eventShieldActivations||0)-1);
  const target=doppelTargetColor(room);
  const txt=`${forced?"Test: ":""}${steps} Felder kopiert${actorColor?` von ${String(actorColor).toUpperCase()}`:""}; Zielrichtung ${String(target).toUpperCase()}. ${parts.join(" ")}`.trim();
  bossAction(room,boss.icon,boss.name,txt);
  return {wheels:[],text:`${boss.icon} ${boss.name}: ${txt}`};
}
function doppelgangerAfterPlayerMove(room,actorColor,steps){
  const b=ensureBossState(room); if(!b||bossSleepActiveNow(b)) return [];
  const n=Math.max(0,Math.floor(Number(steps||0))); if(!n) return [];
  const texts=[];
  for(const e of activeBossEntries(room).filter(x=>x.boss?.type==="doppel")){
    const r=moveDoppelgangerEntry(room,e,n,{actorColor}); if(r.text) texts.push(r.text);
  }
  return texts;
}

function doppelReflectBarricadeJoker(room,actorColor){
  const doubles=activeBossEntries(room).filter(e=>e.boss?.type==="doppel");
  if(!doubles.length) return null;
  const b=ensureBossState(room); if(b?.barricadesDisabled) return null;
  const pieces=boardPiecesForColor(room,actorColor); if(!pieces.length) return null;
  // Zielfeld direkt vor irgendeiner Figur DES Joker-Nutzers.
  const targets=[];
  for(const pc of pieces){
    for(const id of forwardChoices(String(pc.nodeId))){
      if(isPlacableBarricade(room,String(id)) && !barrierPlacementForbiddenForActor(room,"__boss__",String(id))) targets.push(String(id));
    }
  }
  if(!targets.length) return null;
  const bstate=ensureBossState(room);
  const movable=(room.state.barricades||[]).map(String).filter(id=>!barrierLockActive(room,id)&&!bstate?.roadblocks?.[id]&&!targets.includes(id));
  if(!movable.length) return null;
  const from=movable[Math.floor(Math.random()*movable.length)];
  const to=targets[Math.floor(Math.random()*targets.length)];
  const i=room.state.barricades.indexOf(from); if(i<0) return null;
  room.state.barricades[i]=to;
  bossAction(room,"👥","Doppelgänger spiegelt Joker",`Barikaden-Joker von ${String(actorColor).toUpperCase()} gespiegelt: ${from} → ${to} direkt vor eine Figur.`);
  return {from,to};
}

function clearWorldEaterHoleForBoss(room,bossId){
  const b=ensureBossState(room); if(!b?.blackHole) return false;
  if(!bossId || String(b.blackHole.sourceBossId||"")===String(bossId)){
    b.blackHole=null; return true;
  }
  return false;
}

// Weltenfresser-Sicherheitsregel: Ein schwarzes Loch darf Umwege und lokale
// Sackgassen erzeugen, aber niemals den grundsaetzlichen einzigen Weg eines
// Startbereichs zum Ziel kappen. Barikaden werden hier bewusst ignoriert, weil
// sie beweglich sind; geprueft wird die feste Brett-Topologie.
function boardRouteExistsAvoiding(blockedNode,startNode,targetNode){
  const blocked=String(blockedNode||""), start=String(startNode||""), target=String(targetNode||"");
  if(!start||!target||start===blocked||target===blocked) return false;
  const q=[start],seen=new Set([start]);
  for(let i=0;i<q.length;i++){
    const u=q[i]; if(u===target) return true;
    for(const v of bossBoardNeighbors(u)){
      const id=String(v); if(id===blocked||seen.has(id)) continue;
      seen.add(id); q.push(id);
    }
  }
  return false;
}
function blackHoleKeepsBoardPlayable(room,nodeId){
  const id=String(nodeId||"");
  if(!id||id===String(GOAL||"")) return false;
  // Jeder aktive Startbereich muss weiterhin einen Brettweg zum Ziel besitzen.
  for(const c of activeBossColors(room)){
    const st=String(STARTS?.[c]||"");
    if(st && !boardRouteExistsAvoiding(id,st,String(GOAL||""))) return false;
  }
  // Ebenso darf keine bereits ausgespielte Figur durch die neue Sperre komplett
  // vom Ziel abgeschnitten werden.
  for(const p of (room?.state?.pieces||[])){
    if(p?.posKind!=="board"||!p?.nodeId) continue;
    if(!boardRouteExistsAvoiding(id,String(p.nodeId),String(GOAL||""))) return false;
  }
  return true;
}
function blackHoleCandidates(room){
  return specialFreeFields(room).filter(id=>blackHoleKeepsBoardPlayable(room,String(id)));
}

function worldEaterRoundAction(room,entry,{forced=false,completedRound=null}={}){
  const b=ensureBossState(room), boss=entry?.boss;
  if(!b||!boss||boss.type!=="devourer") return {wheels:[],text:""};
  // Das alte Loch verschwindet vor jeder neuen Weltenfresser-Aktion.
  clearWorldEaterHoleForBoss(room,boss.id);

  const old=boss.nodeId?String(boss.nodeId):null;
  let pool=specialFreeFields(room).filter(id=>String(id)!==old);
  shuffleInPlace(pool);
  const to=pool[0]||null;
  if(to){
    boss.lastNodeId=old; boss.nodeId=String(to); boss.lastPath=[String(to)]; boss.lastMovedAt=Date.now();
  }

  // Nach dem Teleport ein NEUES freies Feld für das schwarze Loch bestimmen.
  let holes=blackHoleCandidates(room).filter(id=>String(id)!==String(boss.nodeId||""));
  shuffleInPlace(holes);
  const hole=holes[0]||null;
  if(hole){
    b.blackHole={nodeId:String(hole),sourceBossId:String(boss.id),createdRound:Math.max(1,Number(completedRound||b.round||1))};
  }else b.blackHole=null;

  if(boss.rageDoubleNext){
    boss.rageDoubleNext=false;
    // Wutanfall = ein zusätzlicher Teleport; das Loch bleibt EINMALIG und wird danach neu gesetzt.
    const prev=String(boss.nodeId||"");
    clearWorldEaterHoleForBoss(room,boss.id);
    let p2=specialFreeFields(room).filter(id=>String(id)!==prev); shuffleInPlace(p2);
    if(p2[0]){boss.lastNodeId=prev;boss.nodeId=String(p2[0]);boss.lastPath=[String(p2[0])];boss.lastMovedAt=Date.now();}
    let h2=blackHoleCandidates(room).filter(id=>String(id)!==String(boss.nodeId||""));shuffleInPlace(h2);
    if(h2[0]) b.blackHole={nodeId:String(h2[0]),sourceBossId:String(boss.id),createdRound:Math.max(1,Number(completedRound||b.round||1))};
  }
  if(Number(boss.eventShieldActivations||0)>0) boss.eventShieldActivations=Math.max(0,Number(boss.eventShieldActivations||0)-1);
  const txt=`${forced?"Sofortaktion: ":""}${to?`teleportiert nach ${boss.nodeId}`:"kein freies Teleportfeld"}. ${b.blackHole?.nodeId?`🕳️ Schwarzes Loch auf ${b.blackHole.nodeId}.`:"Kein freies Feld für ein schwarzes Loch."}`;
  bossAction(room,boss.icon,boss.name,txt);
  return {wheels:[],text:`${boss.icon} ${boss.name}: ${txt}`};
}

function activateBossEntry(room,entry,{forced=false,doppelSteps=null,actorColor=null,completedRound=null}={}){
  const type=String(entry?.boss?.type||"");
  if(type==="doppel") return moveDoppelgangerEntry(room,entry,doppelSteps||entry.boss?.lastCopiedSteps||1,{forced,actorColor});
  if(type==="devourer") return worldEaterRoundAction(room,entry,{forced,completedRound});
  return moveBossEntry(room,entry,{forced});
}

function chooseSpawnAnchor(slot,targetNodes,room=null){
  const hole=room?blackHoleNode(room):"";
  const anchors=(slot?.anchors||[]).filter(id=>NODES.get(String(id))?.kind==="board"&&(!hole||String(id)!==hole)).map(String);
  if(!anchors.length) return null;
  let best=null,bestDist=Infinity;
  for(const a of anchors){
    let d=Infinity;
    for(const t of targetNodes||[]){const p=bossShortestPath(a,t,room);if(p)d=Math.min(d,p.length-1);}
    if(d<bestDist){bestDist=d;best=a;}
  }
  return best || anchors[0];
}

function freeBossSlots(room){
  const b=ensureBossState(room); if(!b) return [];
  return (b.slots||[]).filter(slot=>slot&&!slot.boss);
}

const BOSS_POOL_COPIES_PER_TYPE = 3;

function refillBossPool(b){
  const all=Object.keys(BOSS_TYPES);
  const pool=[];
  for(const type of all){
    for(let i=0;i<BOSS_POOL_COPIES_PER_TYPE;i++) pool.push(type);
  }
  shuffleInPlace(pool);
  b.bossPool=pool;
  b.bossPoolCycle=Math.max(0,Math.floor(Number(b.bossPoolCycle||0)))+1;
  return pool;
}

function normalizeBossPool(b){
  const valid=new Set(Object.keys(BOSS_TYPES));
  if(!Array.isArray(b.bossPool)) b.bossPool=[];

  // Ein Pool besteht aus 15 Eintraegen: 3 Kopien jeder der 5 Bossarten.
  // Duplikate sind hier absichtlich erlaubt.
  b.bossPool=b.bossPool.map(String).filter(k=>valid.has(k));
  b.bossPoolCycle=Math.max(0,Math.floor(Number(b.bossPoolCycle||0)));
  b.bossPoolDraws=Math.max(0,Math.floor(Number(b.bossPoolDraws||0)));

  // Migration vom alten V26-Mischbeutel: kein halb alter/halb neuer Zyklus.
  // Sobald ein V27-Server einen Raum sieht, startet er einen frischen 15er-Pool.
  if(!b.bossPool.length) refillBossPool(b);
  return b.bossPool;
}

function pickRandomBossType(room){
  const b=ensureBossState(room);
  if(!b) return Object.keys(BOSS_TYPES)[0];
  normalizeBossPool(b);

  const active=new Set(activeBossEntries(room).map(x=>String(x.boss?.type||"")));

  // Der Pool selbst ist bereits zufaellig gemischt. Wenn moeglich wird ein Typ
  // gezogen, der nicht schon gleichzeitig aktiv ist. Die uebersprungenen Karten
  // bleiben im Pool und koennen spaeter gezogen werden.
  let idx=b.bossPool.findIndex(k=>!active.has(String(k)));

  // Falls im Restpool nur noch aktuell aktive Bossarten liegen, darf ausnahmsweise
  // ein Duplikat erscheinen. So werden keine Poolkarten verworfen.
  if(idx<0) idx=0;
  const key=String(b.bossPool.splice(idx,1)[0]||Object.keys(BOSS_TYPES)[0]);
  b.bossPoolDraws=Math.max(0,Math.floor(Number(b.bossPoolDraws||0)))+1;
  return BOSS_TYPES[key] ? key : Object.keys(BOSS_TYPES)[0];
}

function bossSlotSideLabel(b,slot){
  const idx=(b?.slots||[]).findIndex(s=>s===slot||String(s?.id||"")===String(slot?.id||""));
  if(String(slot?.id||"").toLowerCase().includes("left")||idx===0) return "LINKS";
  if(String(slot?.id||"").toLowerCase().includes("right")||idx===1) return "RECHTS";
  return String(slot?.name||"BOSSFELD").toUpperCase();
}

function recordBossSpawn(room,boss,slot,source="random"){
  const b=ensureBossState(room); if(!b||!boss||!slot) return null;
  const rec={
    seq:++b.spawnSeq,
    bossId:String(boss.id||""), bossType:String(boss.type||""), bossName:String(boss.name||"Boss"),
    icon:String(boss.icon||"👹"), slotId:String(slot.id||""), slotName:String(slot.name||"Bossfeld"),
    side:bossSlotSideLabel(b,slot), source:String(source||"random"), ts:Date.now()
  };
  b.lastSpawn=rec;
  if(!Array.isArray(b.spawnHistory)) b.spawnHistory=[];
  b.spawnHistory.push({...rec});
  if(b.spawnHistory.length>8) b.spawnHistory=b.spawnHistory.slice(-8);
  return rec;
}

function spawnBoss(room,preferredType=null,preferredSlotId=null,source="random"){
  const b=ensureBossState(room); if(!b) return {ok:false,text:"Bossmodus ist aus."};
  let slot=preferredSlotId?b.slots.find(s=>String(s.id)===String(preferredSlotId)&&!s.boss):null;
  if(preferredSlotId && !slot) return {ok:false,text:"Dieses Bossportal ist nicht mehr frei."};
  if(!slot){
    const free=freeBossSlots(room);
    if(!free.length) return {ok:false,text:"Beide Bossportale sind bereits belegt."};
    slot=free[Math.floor(Math.random()*free.length)];
  }
  let key=String(preferredType||"");
  if(!BOSS_TYPES[key]) key=pickRandomBossType(room);
  const def=BOSS_TYPES[key];
  slot.boss={id:`${key}_${uid()}`,type:key,name:def.name,icon:def.icon,hp:1,maxHp:1,nodeId:null,lastNodeId:null,lastPath:[],spawnedAt:Date.now()};
  if(key==="devourer") slot.boss.turnsSinceAction=0;
  const spawnRule=key==="devourer"
    ? "aktiviert sich nach jeweils 5 abgeschlossenen Spielerzügen"
    : key==="doppel"
      ? "kopiert nach der nächsten Spielerbewegung deren Schrittzahl"
      : key==="hunter"
        ? "jagt erst nach der nächsten abgeschlossenen Spielerbewegung"
        : "läuft bei seiner nächsten Aktivierung über einen Bossweg ins Spielfeld";
  const spawnRec=recordBossSpawn(room,slot.boss,slot,source);
  bossAction(room,def.icon,"Boss erschienen",`${def.name} erscheint ${spawnRec?.side?`${spawnRec.side.toLowerCase()} `:""}an ${slot.name} und ${spawnRule}.`);
  return {ok:true,text:`${def.icon} ${def.name} erscheint ${spawnRec?.side?`${spawnRec.side.toLowerCase()} `:""}an ${slot.name}.`,boss:slot.boss,slotId:slot.id,spawn:spawnRec};
}
function spawnRandomBoss(room,source="random"){ return spawnBoss(room,null,null,source); }

function advanceBossEventCountdown(room){
  const b=ensureBossState(room);
  if(!b) return {spawned:false,pending:false,disabled:false,text:""};

  b.bossEventTriggersTotal=Math.max(0,Math.floor(Number(b.bossEventTriggersTotal||0)))+1;
  const trigger=bossEventBossTrigger(room,b);

  if(trigger<=0){
    b.bossEventCountdown=0;
    b.bossCountdownPending=false;
    return {spawned:false,pending:false,disabled:true,text:"👹 Automatischer Zusatzboss ist deaktiviert."};
  }

  // Wenn bereits ein Boss auf ein freies Portal wartet, bleibt der Countdown bei 0.
  if(b.bossCountdownPending){
    b.bossEventCountdown=0;
    return {spawned:false,pending:true,disabled:false,text:"👹 Boss-Countdown wartet auf ein freies Bossportal."};
  }

  const current=Math.max(1,Math.min(trigger,Math.floor(Number(b.bossEventCountdown||trigger))));
  const next=current-1;
  b.bossEventCountdown=Math.max(0,next);

  if(next>0){
    return {spawned:false,pending:false,disabled:false,text:`👹 Boss-Countdown: noch ${next} bestätigte Ereigniskarte${next===1?"":"n"} bis zum nächsten Zusatzboss.`};
  }

  const spawned=spawnRandomBoss(room,"countdown");
  if(spawned?.ok){
    b.bossEventCountdown=trigger;
    b.bossCountdownPending=false;
    return {spawned:true,pending:false,disabled:false,text:`👹 Countdown erreicht 0: ${spawned.text}`};
  }

  b.bossEventCountdown=0;
  b.bossCountdownPending=true;
  bossAction(room,"⏳","Boss wartet",`${trigger} bestätigte Ereigniskarte${trigger===1?"":"n"} wurden ausgelöst, aber beide Bossportale sind belegt. Der nächste Zusatzboss erscheint, sobald ein Portal frei wird.`);
  return {spawned:false,pending:true,disabled:false,text:"👹 Countdown erreicht 0: Boss wartet auf ein freies Bossportal."};
}

function resolvePendingCountdownBoss(room){
  const b=ensureBossState(room);
  if(!b?.bossCountdownPending) return null;
  const trigger=bossEventBossTrigger(room,b);
  if(trigger<=0){ b.bossCountdownPending=false; b.bossEventCountdown=0; return null; }
  if(!b.slots?.some(s=>!s?.boss)) return null;
  const r=spawnRandomBoss(room,"countdown_pending");
  if(!r?.ok) return null;
  b.bossCountdownPending=false;
  b.bossEventCountdown=trigger;
  bossAction(room,"👹","Countdown-Boss erscheint",`${r.text} Der Ereignis-Countdown startet wieder bei ${trigger}.`);
  return r;
}

function removeBossByJoker(room,{bossId=null,slotId=null}={}){
  const b=ensureBossState(room);
  if(!b) return {ok:false,text:"Bossmodus ist aus."};
  let slot=null;
  if(slotId) slot=b.slots.find(s=>String(s?.id||"")===String(slotId)&&s?.boss);
  if(!slot && bossId) slot=b.slots.find(s=>String(s?.boss?.id||"")===String(bossId));
  if(!slot?.boss) return {ok:false,text:"Dieser Boss ist nicht mehr aktiv."};
  const removed=slot.boss;
  if(removed?.type==="devourer") clearWorldEaterHoleForBoss(room,removed.id);
  slot.boss=null;
  bossAction(room,"🌀","Boss entfernt",`${removed.icon||"👹"} ${removed.name||"Boss"} wurde durch einen Boss-entfernen-Joker verbannt.`);
  const queued=resolvePendingCountdownBoss(room);
  return {ok:true,text:`${removed.icon||"👹"} ${removed.name||"Boss"} wurde entfernt.${queued?.ok?` ${queued.text}`:""}`,boss:removed,slotId:slot.id};
}


function grantRandomEventJokers(room,color,count=1,source="event"){
  const action=room?.state?.action;
  const wheels=[];
  const n=Math.max(0,Math.floor(Number(count||0)));
  if(!action || !ALLOWED_COLORS.includes(String(color))) return {text:"Joker-System ist nicht aktiv.",wheels};
  ensureActionJokers(action);
  const player=Array.from(room.players?.values?.()||[]).find(p=>p?.color===color);
  for(let i=0;i<n;i++){
    const pool=jokerTypesForRoom(room);
    const result=pool[Math.floor(Math.random()*pool.length)];
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
    const r=activateBossEntry(room,e,{forced:true,completedRound:Number(ensureBossState(room)?.round||1)});
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
    const r=spawnRandomBoss(room,"event_multi");
    if(r?.ok){spawned++; if(r.text) texts.push(r.text);}
    else break;
  }
  if(spawned<wanted){
    texts.push(spawned>0?"Kein weiteres Bossportal frei.":"Beide Bossportale sind bereits belegt – kein neuer Boss erscheint.");
  }
  return {text:texts.join(" ")||"Kein neuer Boss erscheint.",wheels:[]};
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
  for(const t of (b.traps||[])) if(t?.nodeId) blocked.add(String(t.nodeId));
  if(b?.miniPortal?.a) blocked.add(String(b.miniPortal.a));
  if(b?.miniPortal?.b) blocked.add(String(b.miniPortal.b));
  if(b?.blackHole?.nodeId) blocked.add(String(b.blackHole.nodeId));
  const candidates=(BOARD.nodes||[])
    .filter(n=>n?.kind==="board")
    .map(n=>String(n.id))
    .filter(id=>id!==String(GOAL||"")&&!isStartProtectedNode(id)&&!blocked.has(id));
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

function barrierEventCandidateFields(room,{ignoreStarts=true,actorColor=null}={}){
  const b=ensureBossState(room);
  const blocked=new Set();
  for(const p of (room.state.pieces||[])) if(p?.posKind==="board"&&p?.nodeId) blocked.add(String(p.nodeId));
  for(const e of activeBossEntries(room)) if(e.boss?.nodeId) blocked.add(String(e.boss.nodeId));
  if(b?.blackHole?.nodeId) blocked.add(String(b.blackHole.nodeId));
  for(const id of (b?.eventFields||[])) blocked.add(String(id));
  // V14.2: Spezialfelder dürfen durch automatische Barikaden-Effekte niemals
  // überdeckt werden. Das betrifft Fallen und beide Miniportal-Enden.
  for(const t of (b?.traps||[])) if(t?.nodeId) blocked.add(String(t.nodeId));
  if(b?.miniPortal?.a) blocked.add(String(b.miniPortal.a));
  if(b?.miniPortal?.b) blocked.add(String(b.miniPortal.b));
  const starts=new Set(Object.values(STARTS||{}).map(String));
  return (BOARD.nodes||[])
    .filter(n=>n?.kind==="board" && !isStartProtectedNode(String(n.id)))
    .map(n=>String(n.id))
    .filter(id=>id!==String(GOAL||"")&&!blocked.has(id)&&(!ignoreStarts||!starts.has(id)))
    .filter(id=>!actorColor || !barrierPlacementForbiddenForActor(room,String(actorColor),id));
}

function shuffleAllBarricadesEvent(room,actorColor=null){
  const b=ensureBossState(room);
  if(b?.barricadesDisabled) return {ok:false,text:"Barikaden sind für dieses Spiel dauerhaft deaktiviert."};
  const current=(room.state.barricades||[]).map(String);
  // Normal sind es 12 Barikaden. Temporäre Straßensperren sind zusätzliche Barikaden
  // und dürfen durch Barikadenchaos nicht versehentlich eine normale Barikade verdrängen.
  const targetCount=Math.max(12,current.length);
  const fixed=current.filter(id=>barrierLockActive(room,id)||b?.roadblocks?.[id]);
  const movableCount=Math.max(0,targetCount-fixed.length);
  let pool=barrierEventCandidateFields(room,{ignoreStarts:true,actorColor}).filter(id=>!fixed.includes(String(id)));
  if(pool.length<movableCount) pool=barrierEventCandidateFields(room,{ignoreStarts:false,actorColor}).filter(id=>!fixed.includes(String(id)));
  shuffleInPlace(pool);
  if(pool.length<movableCount) return {ok:false,text:"Nicht genügend freie Felder für die Barikaden gefunden."};
  room.state.barricades=fixed.concat(pool.slice(0,movableCount));
  return {ok:true,text:fixed.length?`Alle beweglichen Barikaden wurden neu verteilt; ${fixed.length} feste Barikade${fixed.length===1?" bleibt":"n bleiben"} stehen.`:"Alle 12 Barikaden wurden zufällig neu verteilt."};
}

function wanderBarricadesEvent(room,count=3,actorColor=null){
  const b=ensureBossState(room);
  if(b?.barricadesDisabled) return {ok:false,text:"Barikaden sind für dieses Spiel dauerhaft deaktiviert."};
  const arr=Array.isArray(room?.state?.barricades)?room.state.barricades:null;
  if(!arr||!arr.length) return {ok:false,text:"Keine Barikaden vorhanden."};
  const indexes=arr.map((id,i)=>({id:String(id),i})).filter(x=>!barrierLockActive(room,x.id)&&!b?.roadblocks?.[x.id]).map(x=>x.i);
  if(!indexes.length) return {ok:false,text:"Alle vorhandenen Barikaden sind aktuell fest."};
  const n=Math.min(Math.max(1,Math.floor(Number(count||3))),indexes.length);
  shuffleInPlace(indexes);
  const chosen=indexes.slice(0,n);
  const oldChosen=new Set(chosen.map(i=>String(arr[i])));
  const remaining=new Set(arr.filter((_,i)=>!chosen.includes(i)).map(String));
  let pool=barrierEventCandidateFields(room,{ignoreStarts:true,actorColor}).filter(id=>!remaining.has(id)&&!oldChosen.has(id));
  if(pool.length<n) pool=barrierEventCandidateFields(room,{ignoreStarts:false,actorColor}).filter(id=>!remaining.has(id)&&!oldChosen.has(id));
  shuffleInPlace(pool);
  if(pool.length<n) return {ok:false,text:"Die Barikadenwanderung findet keine passenden neuen Felder."};
  const before=arr.length;
  chosen.forEach((idx,j)=>{arr[idx]=String(pool[j]);});
  if(arr.length!==before) throw new Error("Barikadenwanderung darf die Barikadenanzahl nicht verändern");
  return {ok:true,text:`${n} Barikaden wurden auf neue zufällige Felder versetzt.`};
}

function shufflePlayerBoardPositions(room){
  const pcs=(room?.state?.pieces||[]).filter(p=>p?.posKind==="board"&&p?.nodeId&&!pieceEventShieldActive(room,p));
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
  if(Number(b.globalBossShieldRounds||0)>0) return {text:"🛡️ Der aktive 3-Runden-Boss-Schutzschild verhindert das Besiegen aller Bosse."};
  let count=0,protectedCount=0;
  for(const slot of b.slots){
    if(!slot?.boss) continue;
    if(Number(slot.boss.eventShieldActivations||0)>0){protectedCount++;continue;}
    if(slot.boss.type==="devourer") clearWorldEaterHoleForBoss(room,slot.boss.id);
    slot.boss=null;count++;
  }
  if(!count) return {text:protectedCount?`🛡️ ${protectedCount} Boss${protectedCount===1?" ist":"e sind"} geschützt.`:"Kein Boss aktiv – die Karte ist wirkungslos."};
  bossAction(room,"⚔️","Alle Bosse besiegt",`${count} ungeschützter Boss${count===1?"":"e"} verschwindet${count===1?"":"n"}.`);
  const queued=resolvePendingCountdownBoss(room);
  return {text:`${count} Boss${count===1?"":"e"} besiegt.${protectedCount?` ${protectedCount} geschützt.`:""}${queued?.ok?` ${queued.text}`:""}`};
}

function curseWaveEvent(room){
  const b=ensureBossState(room);
  const curses=activeBossEntries(room).filter(e=>e.boss?.type==="curse"&&e.boss?.nodeId);
  if(!b||!curses.length) return {text:"Kein Fluchmeister auf dem Brett – die Fluchwelle ist wirkungslos."};
  const hit=[];
  for(const color of activeBossColors(room)){
    const pcs=boardPiecesForColor(room,color).filter(pc=>!pieceEventShieldActive(room,pc));
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
  const blackHole=String(ensureBossState(room)?.blackHole?.nodeId||"");
  if(blackHole) bossNodes.add(blackHole);
  const shieldedOpponents=new Set((room.state.pieces||[])
    .filter(p=>p!==piece&&p?.color!==piece.color&&p?.posKind==="board"&&p?.nodeId&&pieceEventShieldActive(room,p))
    .map(p=>String(p.nodeId)));
  const ownOccupied=new Set((room.state.pieces||[])
    .filter(p=>p!==piece&&p?.posKind==="board"&&p?.color===piece.color&&p?.nodeId)
    .map(p=>String(p.nodeId)));
  const reserved = reservedOwn instanceof Set ? reservedOwn : new Set();

  // V14.5: „Alle vorwärts!“ bedeutet wirklich GENAU ein benachbartes Feld.
  // Frühere Versionen konnten bei einer eigenen Figur vor dem Spieler mehrere
  // Felder überspringen. Jetzt wird bei einer Verzweigung ein anderes freies
  // Vorwärtsfeld gewählt; gibt es keines, bleibt die Figur stehen.
  let choices=forwardChoices(String(piece.nodeId))
    .map(String)
    .filter(id=>!barriers.has(id)&&!bossNodes.has(id)&&!shieldedOpponents.has(id)&&!ownOccupied.has(id)&&!reserved.has(id));
  if(!choices.length) return null;

  const bestDist=Math.min(...choices.map(id=>Number(DIST_TO_GOAL.get(String(id)))));
  choices=choices.filter(id=>Number(DIST_TO_GOAL.get(String(id)))===bestDist);
  shuffleInPlace(choices);
  return String(choices[0]);
}

function moveAllPiecesForwardEvent(room){
  const pcs=(room?.state?.pieces||[])
    .filter(p=>p?.posKind==="board"&&p?.nodeId)
    .sort((a,b)=>(Number(DIST_TO_GOAL.get(String(a.nodeId)))||9999)-(Number(DIST_TO_GOAL.get(String(b.nodeId)))||9999));
  const wheels=[], specialTexts=[];

  // Figuren werden von vorne nach hinten abgearbeitet. Dadurch kann eine hintere
  // eigene Figur in ein Feld nachrücken, das eine vordere Figur gerade freigemacht hat,
  // ohne jemals mehr als genau einen Brettschritt zu laufen.
  const reservedByColor={};
  for(const color of ALLOWED_COLORS) reservedByColor[color]=new Set();

  let moved=0,kicked=0;
  for(const pc of pcs){
    if(pc.posKind!=="board"||!pc.nodeId) continue; // könnte vorher geschmissen worden sein
    const reserved=reservedByColor[pc.color] || new Set();
    const dest=chooseForwardDestinationForEvent(room,pc,{reservedOwn:reserved});
    if(!dest) continue;

    pc.nodeId=String(dest);
    const special=resolveDirectEventLanding(room,pc);
    kicked+=Number(special.kicked||0);
    if(Array.isArray(special.wheels)) wheels.push(...special.wheels);
    if(Array.isArray(special.texts)&&special.texts.length) specialTexts.push(...special.texts);
    reserved.add(String(pc.nodeId||dest));
    moved++;
  }
  return {text:`${moved} Figur${moved===1?"":"en"} bewegt${moved===1?" sich":"en sich"} Richtung Ziel.${specialTexts.length?` ${specialTexts.join(" ")}`:""}`,wheels};
}


function eventPendingChoice(room){
  const b=ensureBossState(room);
  return b?.pendingChoice && typeof b.pendingChoice==="object" ? b.pendingChoice : null;
}

function setEventChoice(room,color,type,extra={}){
  const b=ensureBossState(room); if(!b) return null;
  b.pendingChoice={
    id:`ec_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    color:String(color||""), type:String(type||""), stage:String(extra.stage||"start"),
    createdAt:Date.now(), ...extra
  };
  return b.pendingChoice;
}

function clearEventChoice(room){
  const b=ensureBossState(room); if(b) b.pendingChoice=null;
}


// Bossbewegungen können nach dem Ziehen einer Karte die letzte gültige Auswahl
// entfernen (z.B. Doppelgänger wirft die einzige gegnerische Figur ins Haus).
// Dann darf die Partie nicht in einer nicht lösbaren pendingChoice hängen bleiben.
function eventChoiceStillPossible(room){
  const b=ensureBossState(room), ch=b?.pendingChoice; if(!ch) return true;
  const color=String(ch.color||""), type=String(ch.type||"");
  const ownBoard=()=> (room.state.pieces||[]).filter(p=>p?.color===color&&p?.posKind==="board");
  const oppBoard=()=> (room.state.pieces||[]).filter(p=>p?.color!==color&&p?.posKind==="board"&&!pieceEventShieldActive(room,p));
  const movable=()=>movableEventBarricades(room);
  if(type==="own_board_piece_home") return ownBoard().some(p=>!pieceEventShieldActive(room,p));
  if(type==="boss_spawn_slot") return freeBossSlots(room).length>0 && !!BOSS_TYPES[String(ch.bossType||"")];
  if(type==="swap_piece"){
    if(ch.stage==="own") return ownBoard().length>0 && oppBoard().length>0;
    const a=getPiece(room,String(ch.selectedPieceId||"")); return !!(a&&a.posKind==="board"&&a.color===color&&oppBoard().length>0);
  }
  if(type==="move_barrier"){
    if(ch.stage==="from") return movable().length>0&&hasPlacableBarricadeField(room,color);
    return (room.state.barricades||[]).map(String).includes(String(ch.from||""))&&!barrierLockActive(room,String(ch.from||""))&&hasPlacableBarricadeField(room,color);
  }
  if(type==="opponent_piece_back3") return oppBoard().length>0;
  if(type==="barrier_swap") return movable().length>=2;
  if(type==="barrier_lock") return movable().length>=1;
  if(type==="barrier_magnet") return ownBoard().length>0&&movable().length>0;
  if(type==="roadblock") return !b.barricadesDisabled&&hasPlacableBarricadeField(room,color);
  if(type==="barrier_blast") return movable().length>0&&hasPlacableBarricadeField(room,color);
  if(type==="joker_lock") return activeBossColors(room).some(c=>c!==color);
  if(["boss_rage","boss_shield","boss_change"].includes(type)) return activeBossEntries(room).length>0;
  if(type==="trap") return specialFreeFields(room).length>0;
  if(type==="miniportal"){
    if(ch.stage==="first") return miniPortalPairExists(room,6);
    const first=String(ch.first||"");
    return specialFreeFields(room).some(id=>{
      if(String(id)===first) return false;
      const path=bossShortestPath(first,String(id)); return !!path&&path.length-1<=6;
    });
  }
  if(type==="adjust_roll") return room.state.turnColor===color&&room.state.phase==="need_move"&&room.state.rolled!=null;
  // Vorhersage/Joker-Wette und andere reine Menüentscheidungen bleiben immer lösbar.
  return true;
}

function clearImpossibleEventChoice(room,reason="Bossaktion"){
  const b=ensureBossState(room); if(!b?.pendingChoice||eventChoiceStillPossible(room)) return false;
  b.pendingChoice=null;
  if(b.lastEvent && !b.lastEvent.confirmedAt){
    b.lastEvent.effectText=`${String(b.lastEvent.effectText||"")} ${reason}: Es gibt keine gültige Auswahl mehr; der Auswahlteil der Karte ist wirkungslos.`.trim();
  }
  bossAction(room,"⚠️","Ereignisauswahl aufgehoben",`${reason}: Keine gültige Auswahl mehr vorhanden.`);
  return true;
}

function blockForPendingEventChoice(room,ws){
  const pc=eventPendingChoice(room);
  if(!pc) return false;
  send(ws,{type:"error",code:"EVENT_CHOICE_PENDING",message:"Zuerst die offene Ereigniskarten-Auswahl abschließen."});
  return true;
}

function pieceEventShieldActive(room,piece){
  const b=ensureBossState(room); if(!b||!piece) return false;
  return !!b.pieceEventShields?.[String(piece.id)];
}

function barrierLockActive(room,nodeId){
  const b=ensureBossState(room); if(!b) return false;
  return !!b.lockedBarricades?.[String(nodeId)];
}

function barrierBanActiveForColor(room,color){
  const b=ensureBossState(room); if(!b) return false;
  return Number(b.barrierBanUntilRound?.[String(color)]||0)>0;
}

function clearUntilNextTurnEffects(room,color){
  const b=ensureBossState(room); if(!b||!color) return;
  const c=String(color);
  for(const [pid,rec] of Object.entries({...b.pieceEventShields})) if(String(rec?.ownerColor||"")===c) delete b.pieceEventShields[pid];
  for(const [id,rec] of Object.entries({...b.lockedBarricades})) if(String(rec?.ownerColor||"")===c) delete b.lockedBarricades[id];
  if(b.barrierBanUntilRound) b.barrierBanUntilRound[c]=0;
}

function protectedForwardFields(room,color){
  const out=new Set();
  if(!barrierBanActiveForColor(room,color)) return out;
  for(const p of (room?.state?.pieces||[])){
    if(p?.color!==color||p?.posKind!=="board"||!p?.nodeId) continue;
    for(const id of forwardChoices(String(p.nodeId))) out.add(String(id));
  }
  return out;
}

function barrierPlacementForbiddenForActor(room,actorColor,nodeId){
  const id=String(nodeId||"");
  for(const c of activeBossColors(room)){
    if(c===String(actorColor||"")) continue;
    if(protectedForwardFields(room,c).has(id)) return true;
  }
  return false;
}

function isSpecialFieldFree(room,nodeId,{allowBarricade=false}={}){
  const id=String(nodeId||"");
  if(!id||NODES.get(id)?.kind!=="board"||id===String(GOAL||"")) return false;
  // Start-Schutzbereich: keine Falle, kein Miniportal und kein anderes
  // dynamisches Spezialfeld in den geschuetzten Startreihen.
  if(isStartProtectedNode(id)) return false;
  const b=ensureBossState(room);
  if(!allowBarricade && (room.state.barricades||[]).map(String).includes(id)) return false;
  if((room.state.pieces||[]).some(p=>p?.posKind==="board"&&String(p.nodeId||"")===id)) return false;
  if(activeBossEntries(room).some(e=>String(e.boss?.nodeId||"")===id)) return false;
  if((b?.eventFields||[]).map(String).includes(id)) return false;
  if((b?.traps||[]).some(t=>String(t.nodeId||"")===id)) return false;
  if(String(b?.miniPortal?.a||"")===id||String(b?.miniPortal?.b||"")===id) return false;
  if(String(b?.blackHole?.nodeId||"")===id) return false;
  return true;
}

function movableEventBarricades(room){
  const b=ensureBossState(room);
  return (room?.state?.barricades||[]).map(String).filter(id=>!barrierLockActive(room,id)&&!b?.roadblocks?.[id]);
}

function hasPlacableBarricadeField(room,actorColor=null){
  return (BOARD.nodes||[]).some(n=>n?.kind==="board" && isPlacableBarricade(room,String(n.id)) && (!actorColor || !barrierPlacementForbiddenForActor(room,String(actorColor),String(n.id))));
}

function specialFreeFields(room){
  return (BOARD.nodes||[]).filter(n=>n?.kind==="board").map(n=>String(n.id)).filter(id=>isSpecialFieldFree(room,id));
}

function miniPortalPairExists(room,maxDistance=6){
  const fields=specialFreeFields(room);
  for(let i=0;i<fields.length;i++){
    for(let j=i+1;j<fields.length;j++){
      const path=bossShortestPath(fields[i],fields[j]);
      if(path && path.length-1<=maxDistance) return true;
    }
  }
  return false;
}

function backwardChoices(nodeId){
  const cur=Number(DIST_TO_GOAL.get(String(nodeId)));
  if(!Number.isFinite(cur)) return [];
  return bossBoardNeighbors(String(nodeId))
    .filter(id=>{
      const d=Number(DIST_TO_GOAL.get(String(id)));
      return Number.isFinite(d)&&d>cur;
    })
    .sort((a,b)=>Number(DIST_TO_GOAL.get(String(b)))-Number(DIST_TO_GOAL.get(String(a))));
}

function directEventPath(room,piece,steps,direction="forward"){
  if(!piece||piece.posKind!=="board"||!piece.nodeId) return [];
  const barriers=new Set((room.state.barricades||[]).map(String));
  const bosses=new Set(activeBossEntries(room).map(e=>String(e.boss?.nodeId||"")).filter(Boolean));
  const blackHole=String(ensureBossState(room)?.blackHole?.nodeId||"");
  if(blackHole) bosses.add(blackHole);
  const own=new Set((room.state.pieces||[]).filter(p=>p!==piece&&p?.color===piece.color&&p?.posKind==="board"&&p?.nodeId).map(p=>String(p.nodeId)));
  const shieldedOpponents=new Set((room.state.pieces||[]).filter(p=>p!==piece&&p?.color!==piece.color&&p?.posKind==="board"&&p?.nodeId&&pieceEventShieldActive(room,p)).map(p=>String(p.nodeId)));
  const totalSteps=Math.max(0,Number(steps||0));
  if(totalSteps===0) return [];

  // V14.5: echte Tiefensuche statt gieriger Einbahn-Auswahl.
  // So findet Rückwärtsgang/Nachzüglerhilfe auch bei Verzweigungen einen legalen
  // exakten 3-/4-Felder-Weg, wenn der zuerst bevorzugte Ast später blockiert ist.
  const start=String(piece.nodeId);
  const seen=new Set([start]);
  const path=[];
  const metric=id=>Number(DIST_TO_GOAL.get(String(id)));

  function dfs(cur,depth){
    if(depth===totalSteps) return true;
    let choices=(direction==="backward"?backwardChoices(cur):forwardChoices(cur))
      .map(String)
      .filter(id=>!seen.has(id)&&!barriers.has(id)&&!bosses.has(id)&&!own.has(id))
      .filter(id=>(depth<totalSteps-1)||!shieldedOpponents.has(id));
    choices.sort((a,c)=>direction==="backward"?metric(c)-metric(a):metric(a)-metric(c));
    for(const nx of choices){
      seen.add(nx); path.push(nx);
      if(dfs(nx,depth+1)) return true;
      path.pop(); seen.delete(nx);
    }
    return false;
  }

  return dfs(start,0) ? path.slice() : [];
}

function kickOpponentsAt(room,piece,nodeId){
  let kicked=0;
  for(const op of (room.state.pieces||[])){
    if(op!==piece&&op?.posKind==="board"&&op?.color!==piece.color&&String(op.nodeId||"")===String(nodeId)){
      sendPieceHome(room,op); kicked++;
    }
  }
  return kicked;
}

function movePieceByEvent(room,piece,steps,direction="forward"){
  const path=directEventPath(room,piece,steps,direction);
  if(path.length!==Number(steps||0)) return {ok:false,text:`Keine freie ${steps}-Felder-Strecke gefunden.`,wheels:[]};
  piece.nodeId=String(path[path.length-1]); piece.posKind="board";
  const special=resolveDirectEventLanding(room,piece);
  const extra=special.texts?.length?` ${special.texts.join(" ")}`:"";
  return {ok:true,text:`Figur bewegt sich ${steps} Felder ${direction==="backward"?"zurück":"vor"}.${extra}`.trim(),wheels:special.wheels||[]};
}

function laggardHelpEvent(room,color){
  const pcs=(room.state.pieces||[]).filter(p=>p?.color===color&&p?.posKind==="board"&&p?.nodeId);
  if(!pcs.length) return {text:"Keine eigene Figur steht auf dem Brett – Nachzüglerhilfe ist wirkungslos."};
  pcs.sort((a,c)=>(Number(DIST_TO_GOAL.get(String(c.nodeId)))||0)-(Number(DIST_TO_GOAL.get(String(a.nodeId)))||0));
  const r=movePieceByEvent(room,pcs[0],4,"forward");
  return {text:`Nachzüglerhilfe: ${r.text}`,wheels:r.wheels||[]};
}

function allLeaveHouseEvent(room){
  const b=ensureBossState(room); let moved=0;
  const occupied=occupiedAny(room);
  const blocked=new Set((room.state.barricades||[]).map(String));
  for(const e of activeBossEntries(room)) if(e.boss?.nodeId) blocked.add(String(e.boss.nodeId));
  if(b?.blackHole?.nodeId) blocked.add(String(b.blackHole.nodeId));
  for(const c of activeBossColors(room)){
    const start=String(STARTS?.[c]||""); if(!start) continue;
    const house=(room.state.pieces||[]).filter(p=>p?.color===c&&p?.posKind==="house");
    if(!house.length) continue;
    // freie Felder nach graphischer Nähe zum Start; Ereignis-/Portal-/Fallenfelder bleiben frei.
    const q=[[start,0]],seen=new Set([start]),cands=[];
    for(let qi=0;qi<q.length;qi++){
      const [id,d]=q[qi];
      if(NODES.get(id)?.kind==="board" && id!==String(GOAL||"") && !blocked.has(id) && !occupied.has(id) && !(b?.eventFields||[]).map(String).includes(id) && !(b?.traps||[]).some(t=>String(t.nodeId)===id) && String(b?.miniPortal?.a||"")!==id && String(b?.miniPortal?.b||"")!==id) cands.push([id,d]);
      for(const nx of bossBoardNeighbors(id)) if(!seen.has(String(nx))){seen.add(String(nx));q.push([String(nx),d+1]);}
    }
    cands.sort((a,x)=>a[1]-x[1]);
    for(const pc of house){
      const item=cands.shift(); if(!item) break;
      pc.posKind="board"; pc.nodeId=item[0]; pc.houseId=null; occupied.add(item[0]); moved++;
    }
  }
  return {text:`${moved} Figur${moved===1?"":"en"} ${moved===1?"verlässt":"verlassen"} das Starthaus.`};
}

function transferRandomJoker(room,fromColor,toColor){
  const action=room?.state?.action; if(!action) return {ok:false,text:"Joker-System ist nicht aktiv."};
  ensureActionJokers(action);
  const arr=action.jokersOwned?.[fromColor];
  if(!Array.isArray(arr)||!arr.length) return {ok:false,text:`${String(fromColor).toUpperCase()} hat keinen Joker.`};
  const idx=Math.floor(Math.random()*arr.length); const [j]=arr.splice(idx,1);
  if(!Array.isArray(action.jokersOwned[toColor])) action.jokersOwned[toColor]=[];
  action.jokersOwned[toColor].push({...j,source:"event_trap_transfer",ts:Date.now()});
  syncJokerCountsFromOwned(action);
  return {ok:true,text:`${String(fromColor).toUpperCase()} gibt ${String(toColor).toUpperCase()} einen Joker (${j?.type||"Joker"}).`};
}

function resolveTrapLanding(room,nodeId,color){
  const b=ensureBossState(room); if(!b||!Array.isArray(b.traps)) return null;
  const idx=b.traps.findIndex(t=>String(t?.nodeId||"")===String(nodeId||"")&&String(t?.ownerColor||"")!==String(color||""));
  if(idx<0) return null;
  const landedPiece=(room.state.pieces||[]).find(p=>p?.color===color&&p?.posKind==="board"&&String(p.nodeId||"")===String(nodeId||""));
  if(landedPiece && pieceEventShieldActive(room,landedPiece)){
    const r={ok:false,shielded:true,text:`🛡️ ${String(color).toUpperCase()} ist vor der Falle geschützt. Die Falle bleibt liegen.`};
    bossAction(room,"🛡️","Falle abgewehrt",r.text);
    return r;
  }
  const trap=b.traps.splice(idx,1)[0];
  const r=transferRandomJoker(room,color,trap.ownerColor);
  bossAction(room,"🕳️","Falle ausgelöst",r.text);
  return r;
}

function portalLandingDestination(room,nodeId){
  const b=ensureBossState(room); if(!b?.miniPortal) return null;
  const id=String(nodeId||"");
  if(id===String(b.miniPortal.a)) return String(b.miniPortal.b);
  if(id===String(b.miniPortal.b)) return String(b.miniPortal.a);
  return null;
}

// Direkte Kartenbewegungen (z.B. Rückwärtsgang/Nachzügler/Alle vorwärts)
// müssen dauerhafte Spezialfelder genauso beachten wie ein normaler Spielerzug.
// Ereignisfelder selbst lösen hier bewusst KEINE neue Karte aus, damit keine
// unkontrollierten Ereignisketten entstehen.
function resolveDirectEventLanding(room,piece){
  const texts=[],wheels=[];
  if(!piece||piece.posKind!=="board"||!piece.nodeId) return {texts,wheels,kicked:0,nodeId:null};
  let landed=String(piece.nodeId);
  const portalTo=portalLandingDestination(room,landed);
  if(portalTo){
    const ownBlocked=(room.state.pieces||[]).some(x=>x!==piece&&x?.color===piece.color&&x?.posKind==="board"&&String(x.nodeId||"")===String(portalTo));
    const shieldBlocked=(room.state.pieces||[]).some(x=>x!==piece&&x?.color!==piece.color&&x?.posKind==="board"&&String(x.nodeId||"")===String(portalTo)&&pieceEventShieldActive(room,x));
    const barrierBlocked=(room.state.barricades||[]).map(String).includes(String(portalTo));
    if(!ownBlocked&&!shieldBlocked&&!barrierBlocked){
      const from=landed; piece.nodeId=String(portalTo); landed=String(portalTo);
      texts.push(`🚪 Miniportal: ${from} → ${landed}.`);
    }
  }
  const kicked=kickOpponentsAt(room,piece,landed);
  if(kicked) texts.push(`${kicked} gegnerische Figur${kicked===1?" wurde":"en wurden"} geschmissen.`);
  const trap=resolveTrapLanding(room,landed,piece.color);
  if(trap?.text) texts.push(trap.text);
  const bossHit=resolveBossBoardHit(room,landed,piece.color);
  if(bossHit?.text) texts.push(bossHit.text);
  if(Array.isArray(bossHit?.wheels)) wheels.push(...bossHit.wheels);
  return {texts,wheels,kicked,nodeId:landed};
}

function removeRoadblocksIfExpired(room,completedRound){
  const b=ensureBossState(room); if(!b||!b.roadblocks) return;
  for(const [id,rec] of Object.entries({...b.roadblocks})){
    if(Number(completedRound||0)<Number(rec?.startRound||0)) continue;
    rec.roundsLeft=Math.max(0,Math.floor(Number(rec.roundsLeft||0))-1);
    if(rec.roundsLeft<=0){
      delete b.roadblocks[id];
      const idx=(room.state.barricades||[]).indexOf(String(id)); if(idx>=0) room.state.barricades.splice(idx,1);
    }
  }
}

function cleanupRoundStatuses(room){
  const b=ensureBossState(room); if(!b) return;
  // "Bis zu deinem nächsten Zug" wird turn-genau in clearUntilNextTurnEffects aufgelöst.
  // Hier nur verwaiste Einträge entfernen.
  const pieceIds=new Set((room.state.pieces||[]).map(p=>String(p.id)));
  for(const pid of Object.keys({...b.pieceEventShields})) if(!pieceIds.has(String(pid))) delete b.pieceEventShields[pid];
  const bars=new Set((room.state.barricades||[]).map(String));
  for(const id of Object.keys({...b.lockedBarricades})) if(!bars.has(String(id))) delete b.lockedBarricades[id];
}

function randomRelocateBarricade(room,from,actorColor=null){
  const b=ensureBossState(room); if(b?.barricadesDisabled) return {ok:false,text:"Barikaden sind für dieses Spiel dauerhaft deaktiviert."};
  from=String(from||"");
  if(!(room.state.barricades||[]).includes(from)) return {ok:false,text:"Auf diesem Feld steht keine Barikade."};
  if(barrierLockActive(room,from)||b?.roadblocks?.[from]) return {ok:false,text:"Diese Barikade ist fest und kann nicht bewegt werden."};
  let pool=barrierEventCandidateFields(room,{ignoreStarts:false,actorColor}).filter(id=>String(id)!==from && !(room.state.barricades||[]).includes(String(id)));
  shuffleInPlace(pool); if(!pool.length) return {ok:false,text:"Kein freies Zielfeld gefunden."};
  const to=String(pool[0]); const idx=room.state.barricades.indexOf(from); room.state.barricades[idx]=to;
  if(b.lockedBarricades[from]){b.lockedBarricades[to]=b.lockedBarricades[from];delete b.lockedBarricades[from];}
  if(b.roadblocks[from]){b.roadblocks[to]=b.roadblocks[from];delete b.roadblocks[from];}
  return {ok:true,text:`Barikade ${from} → ${to}.`,to};
}

function bossChoiceEntries(room){ return activeBossEntries(room).map(e=>({slotId:String(e.slot.id),bossId:String(e.boss.id||""),name:e.boss.name,icon:e.boss.icon,type:e.boss.type})); }

function queueForcedEventMove(room,color,steps){
  const b=ensureBossState(room); if(!b) return false;
  const c=String(color||"");
  const n=Math.max(1,Math.min(20,Math.floor(Number(steps||0))));
  if(!ALLOWED_COLORS.includes(c)) return false;
  if(!Array.isArray(b.forcedMoveQueueByColor?.[c])){
    if(!b.forcedMoveQueueByColor||typeof b.forcedMoveQueueByColor!=="object") b.forcedMoveQueueByColor={red:[],blue:[],green:[],yellow:[]};
    b.forcedMoveQueueByColor[c]=[];
  }
  // Sicherheitslimit: realistisch entstehen nur 1–2 Einträge; 8 verhindert
  // kaputte Importzustände ohne echte Kartenwirkungen zu verlieren.
  if(b.forcedMoveQueueByColor[c].length<8) b.forcedMoveQueueByColor[c].push(n);
  return true;
}

function takeForcedEventMove(room,color){
  const b=ensureBossState(room); if(!b) return 0;
  const c=String(color||"");
  const q=Array.isArray(b.forcedMoveQueueByColor?.[c])?b.forcedMoveQueueByColor[c]:null;
  if(q&&q.length){
    const n=Math.max(0,Math.floor(Number(q.shift()||0)));
    return n;
  }
  // Migration/Fallback für vor V14.6 gespeicherte Räume.
  const legacy=Math.max(0,Math.floor(Number(b.forcedMoveByColor?.[c]||0)));
  if(legacy>0) b.forcedMoveByColor[c]=0;
  return legacy;
}

function takeNextLegalForcedEventMove(room,color){
  let guard=0;
  while(guard<10){
    const n=takeForcedEventMove(room,color);
    if(n<=0) return 0;
    if(hasAnyLegalMoveForSteps(room,color,n,{respectEventShields:true})) return n;
    guard++;
  }
  return 0;
}

function hasAnyLegalMoveForSteps(room,color,steps,{respectEventShields=false}={}){
  const n=Math.max(1,Math.floor(Number(steps||0)));
  const shieldBlocks=(nodeId)=>respectEventShields && (room.state.pieces||[]).some(op=>op?.color!==color&&op?.posKind==="board"&&String(op.nodeId||"")===String(nodeId||"")&&pieceEventShieldActive(room,op));
  for(const pc of (room?.state?.pieces||[])){
    if(!pc||pc.color!==color) continue;
    const startField=STARTS[color];
    if(!startField) continue;
    if(pc.posKind==="house"){
      const remaining=n-1;
      if(remaining===0){
        const blocked=occupiedByColor(room,color,pc.id);
        if(!blocked.has(String(startField))&&!shieldBlocks(startField)) return true;
      }else if(remaining>0){
        const targets=computeAllTargets(room,startField,remaining,color,pc.id);
        if([...targets.keys()].some(id=>!shieldBlocks(id))) return true;
      }
    }else if(pc.posKind==="board"&&pc.nodeId){
      const targets=computeAllTargets(room,pc.nodeId,n,color,pc.id);
      if([...targets.keys()].some(id=>!shieldBlocks(id))) return true;
    }
  }
return false;
}

function rewardBossHit(room,color,bossName="Boss",bossType=""){
  const b=ensureBossState(room);
  const bounty=!!b?.bountyNextBoss;
  const baseReward=Math.max(1,Math.floor(Number(BOSS_TYPES[String(bossType||"")]?.rewardJokers||1)));
  // Kopfgeld darf einen höherwertigen Boss niemals verschlechtern.
  const rewardCount=bounty?Math.max(2,baseReward):baseReward;
  if(bounty) b.bountyNextBoss=false;

  const wheels=[];
  if(room?.state?.action){
    const gained=[];
    const player=Array.from(room.players?.values?.()||[]).find(p=>p?.color===color);
    for(let i=0;i<rewardCount;i++){
      const pool=jokerTypesForRoom(room);
      const t=pool[Math.floor(Math.random()*pool.length)];
      addOwnedJoker(room.state.action,color,t,color,bounty?"boss_bounty":"boss");
      gained.push(t);
      wheels.push({
        ownerColor:color,targetColor:color,jokerColor:color,result:t,durationMs:5000,
        attackerName:String(bossName||"Boss"),victimName:player?.name||"",
        headline:bounty
          ? `🏆 Kopfgeld! Joker ${i+1}/${rewardCount} für ${player?.name||String(color).toUpperCase()}`
          : `🏆 Boss besiegt! Joker ${i+1}/${rewardCount} für ${player?.name||String(color).toUpperCase()}`,
        quote:bounty?`Kopfgeld aktiv – insgesamt ${rewardCount} Joker!`:`Boss-Belohnung: ${rewardCount} Joker!`,
        bossReward:true
      });
    }
    syncJokerCountsFromOwned(room.state.action);
    return {
      text:`${bounty?"Kopfgeld! ":""}Belohnung: ${rewardCount} Joker über das Glücksrad.`,
      wheels
    };
  }
  if(b) b.rollModsByColor[color]=Math.min(2,Number(b.rollModsByColor[color]||0)+rewardCount);
  return {text:`${bounty?"Kopfgeld! ":""}Belohnung: +${Math.min(2,rewardCount)} auf deinen nächsten Wurf.`,wheels};
}

function damageBossSlot(room,slot,attackerColor,source="attack"){
  if(!slot?.boss) return {hit:false,defeated:false,text:"Kein Boss auf diesem Feld.",wheels:[]};
  const b=ensureBossState(room); const boss=slot.boss;
  if(Number(b?.globalBossShieldRounds||0)>0){
    bossAction(room,"🛡️","Boss-Schutzschild",`${boss.icon} ${boss.name} ist durch den 3-Runden-Schutzschild geschützt.`);
    return {hit:true,defeated:false,text:`🛡️ ${boss.name} ist geschützt und kann aktuell nicht besiegt werden.`,wheels:[]};
  }
  if(Number(boss.eventShieldActivations||0)>0){
    bossAction(room,"🛡️","Boss-Schutzschild",`${boss.icon} ${boss.name} ist bis nach seiner nächsten Aktivierung geschützt.`);
    return {hit:true,defeated:false,text:`🛡️ ${boss.name} ist bis nach seiner nächsten Aktivierung geschützt.`,wheels:[]};
  }
  boss.hp=0;
  if(boss.type==="devourer") clearWorldEaterHoleForBoss(room,boss.id);
  slot.boss=null;
  const rewardResult=attackerColor?rewardBossHit(room,attackerColor,boss.name,boss.type):{text:"",wheels:[]};
  const reward=rewardResult?.text||"";
  bossAction(room,"🏆","Boss besiegt",`${boss.icon} ${boss.name} wurde besiegt. ${reward}`.trim());
  const queued=resolvePendingCountdownBoss(room);
  return {hit:true,defeated:true,text:`🏆 ${boss.name} besiegt! ${reward}${queued?.ok?` ${queued.text}`:""}`.trim(),source,wheels:rewardResult?.wheels||[]};
}

// Spieler besiegen einen wandernden Boss, indem sie auf seinem aktuellen Feld landen.
function resolveBossBoardHit(room,landed,color){
  const b=ensureBossState(room); if(!b) return null;
  const slot=b.slots.find(s=>s?.boss?.nodeId && String(s.boss.nodeId)===String(landed||""));
  return slot?damageBossSlot(room,slot,color,"board_collision"):null;
}

function isBossDropFieldFree(room,nodeId,ignoreBarricadeNode=null){
  const id=String(nodeId||"");
  const node=NODES.get(id);
  if(!id||node?.kind!=="board"||id===String(GOAL||"")||isStartProtectedNode(id)) return false;
  const starts=new Set(Object.values(STARTS||{}).map(String));
  if(starts.has(id)) return false;
  const barr=new Set((room?.state?.barricades||[]).map(String)); if(ignoreBarricadeNode) barr.delete(String(ignoreBarricadeNode));
  if(barr.has(id)) return false;
  const b=ensureBossState(room);
  if((b?.eventFields||[]).map(String).includes(id)) return false;
  if((b?.traps||[]).some(t=>String(t?.nodeId||"")===id)) return false;
  if(String(b?.miniPortal?.a||"")===id || String(b?.miniPortal?.b||"")===id) return false;
  if(String(b?.blackHole?.nodeId||"")===id) return false;
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
  const bstate=ensureBossState(room); if(bstate?.barricadesDisabled) return null;
  const to=String(toNode);
  const idx=arr.indexOf(to); if(idx<0) return null;
  if(barrierLockActive(room,to)||bstate?.roadblocks?.[to]) return null;
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
    const pool=jokerTypesForRoom(room);
    const result=pool[Math.floor(Math.random()*pool.length)];
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
function minDistanceFromNodeToTargets(nodeId,targets,room=null){
  let best=Infinity; for(const t of targets||[]){const p=bossShortestPath(nodeId,t,room);if(p)best=Math.min(best,p.length-1);} return best;
}

function enumerateBossPaths(startId,steps,room=null){
  const out=[]; const hole=room?blackHoleNode(room):"";
  function dfs(node,left,visited,path){
    if(left<=0){out.push(path.slice());return;}
    const ns=bossBoardNeighbors(node).filter(n=>!visited.has(n)&&(!hole||String(n)!==hole));
    if(!ns.length){out.push(path.slice());return;}
    for(const nx of ns){visited.add(nx);path.push(nx);dfs(nx,left-1,visited,path);path.pop();visited.delete(nx);}
  }
  dfs(String(startId),Math.max(0,steps),new Set([String(startId)]),[String(startId)]); return out;
}

function chooseBossZugzwangFallback(room,entry,steps=1){
  const boss=entry?.boss;
  if(!boss?.nodeId) return [];
  steps=Math.max(1,Math.min(20,Math.floor(Number(steps||1))));
  const paths=enumerateBossPaths(String(boss.nodeId),steps,room)
    .map(p=>Array.isArray(p)?p.slice(1).map(String):[])
    .filter(p=>p.length>0);
  if(!paths.length) return [];
  let maxLen=Math.max(...paths.map(p=>p.length));
  const longest=paths.filter(p=>p.length===maxLen);
  // Bei mehreren Rück-/Ausweichwegen weiterhin möglichst sinnvoll in Richtung einer Spielfigur.
  const targets=[];
  for(const c of activeBossColors(room)) targets.push(...bossTargetNodes(room,c));
  let best=longest[0],bestDist=Infinity;
  for(const p of longest){
    const end=p[p.length-1];
    const d=targets.length?minDistanceFromNodeToTargets(end,targets,room):Infinity;
    if(d<bestDist){best=p;bestDist=d;}
  }
  return best||[];
}

function chooseHunterRoute(room,entry){
  const boss=entry.boss, slot=entry.slot;
  const colors=activeBossColors(room);

  // Der Jäger verfolgt immer eine TATSÄCHLICH auf dem Brett stehende Figur.
  // Wichtig: Spieler ohne Brettfigur dürfen nicht über ihr leeres Startfeld
  // weiter als Ziel gelten. Sonst kann der Jäger nach einem Abschuss am alten
  // Spieler hängen bleiben, obwohl ein anderer Spieler noch Figuren auf dem Brett hat.
  const targets=[];
  for(const c of colors){
    for(const pc of boardPiecesForColor(room,c)){
      targets.push(String(pc.nodeId));
    }
  }

  // Nur wenn überhaupt keine Spielerfigur auf dem Brett steht, darf der Jäger
  // ersatzweise zu einem Startfeld laufen. Sobald wieder eine Figur auf dem Brett
  // steht, wird automatisch diese gejagt.
  if(!targets.length){
    for(const c of colors){
      const s=STARTS?.[c];
      if(s) targets.push(String(s));
    }
  }

  if(!targets.length) return [];

  if(!boss.nodeId){
    const a=chooseSpawnAnchor(slot,targets,room);
    return a?[a]:[];
  }

  let best=null;
  for(const t of targets){
    const p=bossShortestPath(boss.nodeId,t,room);
    if(p && (!best || p.length<best.length)) best=p;
  }

  return best&&best.length>1 ? [best[1]] : [];
}

function chooseShadowRoute(room,entry,steps=3){
  const boss=entry.boss,slot=entry.slot,targetColor=shadowTargetColor(room),targets=bossTargetNodes(room,targetColor);
  if(!targets.length) return [];
  let prefix=[]; let start=boss.nodeId; let left=steps;
  if(!start){const a=chooseSpawnAnchor(slot,targets,room); if(!a)return []; prefix=[a];start=a;left--;}
  if(left<=0) return prefix;
  const paths=enumerateBossPaths(start,left,room);
  const candidates=paths.map(p=>prefix.concat(p.slice(1)));
  const maxLen=candidates.length?Math.max(...candidates.map(p=>p.length)):0;
  const longest=candidates.filter(p=>p.length===maxLen);
  let best=[],bestTargetHit=-1,bestHits=-1,bestDist=Infinity;
  for(const full of longest){
    let targetHit=0; for(const id of full){if(piecesOnBossNode(room,id).some(pc=>pc.color===targetColor))targetHit++;}
    const hits=bossPathScoreHits(room,full); const end=full[full.length-1]||start; const d=minDistanceFromNodeToTargets(end,targets,room);
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
  if(!start){const a=chooseSpawnAnchor(slot,allTargets.length?allTargets:leadTargets,room);if(!a)return [];prefix=[a];start=a;left--;}
  if(left<=0)return prefix;
  const paths=enumerateBossPaths(start,left,room);
  const candidates=paths.map(p=>prefix.concat(p.slice(1)));
  const maxLen=candidates.length?Math.max(...candidates.map(p=>p.length)):0;
  const longest=candidates.filter(p=>p.length===maxLen);
  let best=[],bestHits=-1,bestDist=Infinity;
  for(const full of longest){
    const hits=bossPathScoreHits(room,full); const end=full[full.length-1]||start; const d=minDistanceFromNodeToTargets(end,leadTargets,room);
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

  const preferredRoute=()=>boss.type==="hunter"
    ? chooseHunterRoute(room,entry)
    : boss.type==="curse"
      ? chooseCurseRoute(room,entry,def.steps)
      : chooseShadowRoute(room,entry,def.steps);
  const desiredSteps=boss.type==="hunter"?1:Math.max(1,Number(def.steps||1));
  const chooseRoute=()=>{
    const preferred=preferredRoute();
    if(Array.isArray(preferred)&&preferred.length) return preferred;
    // V17 Zugzwang: Wenn der bevorzugte Vorwärtsweg nicht möglich ist, muss der Boss
    // einen legalen Rück-/Ausweichweg nehmen. Nur ohne jeden legalen Schritt bleibt er stehen.
    return chooseBossZugzwangFallback(room,entry,desiredSteps);
  };

  // Prüft ALLE Spielfiguren auf einem Brettfeld.
  // Bewusst nicht über activeBossColors(), damit die Zusatzregel auch bei
  // reconnectenden / momentan nicht verbundenen Sitzplätzen zuverlässig greift.
  const playerPiecesOnNode=(nodeId)=>(room?.state?.pieces||[]).filter(
    p=>p && p.posKind==="board" && String(p.nodeId||"")===String(nodeId||"")
  );

  // 1. normaler Bosszug
  const route1=chooseRoute();
  const landingNode1=route1.length ? String(route1[route1.length-1]) : "";

  // WICHTIG: Landing VOR Ausführung merken.
  // Dadurch kann der Treffer nicht durch spätere Effektlogik "verschwinden".
  const landingPiecesBefore1=landingNode1 ? playerPiecesOnNode(landingNode1) : [];
  const landsOnPlayerBefore1=landingPiecesBefore1.length>0;

  const res1=executeBossRoute(room,entry,route1);

  const wheels=[...(res1.wheels||[])];
  const texts=[...(res1.texts||[])];
  const combinedRoute=[...route1];
  let bonusRun=false;

  // Regel:
  // Landet Fluchmeister oder Schatten EXAKT am Ende ihres Zuges auf mindestens
  // einer Spielerfigur, die sie nicht schmeißen dürfen, bekommen sie GENAU EINEN
  // weiteren vollständigen normalen Zug (Fluchmeister 5 / Schatten 3 Felder).
  // Der Zusatzlauf selbst kann keinen weiteren Zusatzlauf auslösen.
  const landedOnUnthrowablePiece =
    boss.type!=="hunter" &&
    route1.length>0 &&
    landsOnPlayerBefore1;

  if(landedOnUnthrowablePiece){
    bonusRun=true;
    texts.push(`⚡ Zusatzlauf: ${boss.name} ist auf einer Figur gelandet und darf sofort noch einmal ziehen.`);

    const route2=chooseRoute();
    const res2=executeBossRoute(room,entry,route2);

    wheels.push(...(res2.wheels||[]));
    texts.push(...(res2.texts||[]));
    combinedRoute.push(...route2);
  }

  // Ereigniskarte „Boss wird wütend“: genau ein zusätzlicher vollständiger Bosszug.
  if(boss.rageDoubleNext){
    boss.rageDoubleNext=false;
    const rageRoute=chooseRoute();
    const rageRes=executeBossRoute(room,entry,rageRoute);
    wheels.push(...(rageRes.wheels||[])); texts.push(`🔥 Wutanfall: ${boss.name} bewegt sich ein zweites Mal.`); texts.push(...(rageRes.texts||[]));
    combinedRoute.push(...rageRoute);
  }

  // Ein Aktivierungs-Schutzschild endet erst NACH dieser Bossaktivierung.
  if(Number(boss.eventShieldActivations||0)>0) boss.eventShieldActivations=Math.max(0,Number(boss.eventShieldActivations||0)-1);

  // Für die Client-Animation den kompletten Weg aus Hauptzug + Zusatzlauf behalten.
  boss.lastPath=combinedRoute.map(String);
  boss.lastMovedAt=Date.now();

  const where=boss.nodeId?` bis ${boss.nodeId}`:"";
  const movedCount=combinedRoute.length;
  const bonusText=bonusRun?" · ⚡ Zusatzlauf":"";
  const extra=texts.length?` ${texts.join(" ")}`:"";

  bossAction(
    room,
    boss.icon,
    boss.name,
    `${forced?"Test: ":""}${movedCount} Feld${movedCount===1?"":"er"}${where}${bonusText}.${extra}`.trim()
  );

  return {
    wheels,
    text:`${boss.icon} ${boss.name}: ${movedCount} Felder${where}${bonusText}.`,
    bonusRun,
    landingNode: landingNode1,
    landedOnPlayer: landsOnPlayerBefore1
  };
}

function bossSleepActiveNow(b){
  return !!b && Number(b.sleepActiveRound||0)===Number(b.round||0);
}

// V24: Der Jäger reagiert NICHT mehr auf den Würfelwurf. Er läuft erst,
// nachdem der Spieler seine normale Würfelbewegung tatsächlich abgeschlossen hat.
function hunterAfterPlayerMove(room){
  const b=ensureBossState(room);if(!b||bossSleepActiveNow(b))return [];
  const wheels=[];
  for(const e of activeBossEntries(room)) if(e.boss?.type==="hunter") wheels.push(...moveBossEntry(room,e).wheels);
  return wheels;
}

// V24: Der Weltenfresser aktiviert sich nach jeweils 5 abgeschlossenen Spielerzügen,
// unabhängig von der Spielerzahl. Fluchmeister und Schatten bleiben Rundenbosse.
function bossTurnCompleted(room,endedColor){
  const b=ensureBossState(room);if(!b)return [];
  const active=activeBossColors(room);
  const sleeping=bossSleepActiveNow(b);
  const wheels=[];

  for(const e of activeBossEntries(room)){
    if(String(e.boss?.type||"")!=="devourer") continue;
    e.boss.turnsSinceAction=Math.max(0,Math.floor(Number(e.boss.turnsSinceAction||0)))+1;
    if(e.boss.turnsSinceAction>=5){
      e.boss.turnsSinceAction=0;
      if(!sleeping){
        const r=activateBossEntry(room,e,{completedRound:Number(b.round||1)});
        if(Array.isArray(r?.wheels)) wheels.push(...r.wheels);
      }
    }
  }

  b.turnsInRound=Number(b.turnsInRound||0)+1;
  if(b.turnsInRound<active.length)return wheels;

  b.turnsInRound=0;
  const completedRound=Math.max(1,Number(b.round||1));

  if(sleeping){
    bossAction(room,"😴","Bossrunde ausgesetzt",`Runde ${completedRound}: Alle regulären Bossaktionen dieser Runde bleiben aus.`);
  }else{
    for(const e of activeBossEntries(room)) if(["curse","shadow"].includes(String(e.boss?.type||""))){
      const r=activateBossEntry(room,e,{completedRound});
      if(Array.isArray(r?.wheels)) wheels.push(...r.wheels);
    }
  }

  // Rundenbasierte Ereigniseffekte laufen nur nach VOLLSTÄNDIG abgeschlossenen Runden ab.
  if(Number(b.globalBossShieldRounds||0)>0 && completedRound>=Number(b.globalBossShieldStartRound||Infinity)){
    b.globalBossShieldRounds=Math.max(0,Number(b.globalBossShieldRounds||0)-1);
    if(b.globalBossShieldRounds===0) bossAction(room,"🛡️","Boss-Schutzschild endet","Der 3-Runden-Boss-Schutzschild ist abgelaufen.");
  }
  removeRoadblocksIfExpired(room,completedRound);

  // Erst NACH Abschluss der alten Runde beginnt die neue Runde.
  b.round=completedRound+1;
  b.sleepActiveRound=null;
  cleanupRoundStatuses(room);
  if(Number(b.sleepRounds||0)>0){
    b.sleepRounds=Math.max(0,Number(b.sleepRounds||0)-1);
    b.sleepActiveRound=b.round;
    bossAction(room,"😴","Bossruhe beginnt",`In Runde ${b.round} setzen alle Bosse ihre regulären Aktionen aus.`);
  }
  return wheels;
}

function advanceTurnWithEventSkips(room,endedColor){
  let wheels=[];
  const eb=ensureBossState(room); if(eb?.jokerLockByColor?.[endedColor]) eb.jokerLockByColor[endedColor]=false;
  const first=bossTurnCompleted(room,endedColor);
  if(Array.isArray(first)) wheels.push(...first);

  let next=nextTurnColor(room,endedColor);
  clearUntilNextTurnEffects(room,next);
  const b=ensureBossState(room);
  const active=activeBossColors(room);
  const skipped=[];
  let guard=0;

  while(b && next && active.includes(next) && Number(b.skipTurnsByColor?.[next]||0)>0 && guard<active.length){
    b.skipTurnsByColor[next]=Math.max(0,Number(b.skipTurnsByColor[next]||0)-1);
    // V14.4: Eine Joker-Sperre gilt für den nächsten vollständigen Zug.
    // Wird genau dieser Zug durch eine Aussetzen-Karte übersprungen, ist die Sperre
    // damit ebenfalls verbraucht und darf nicht noch in den darauffolgenden Zug rutschen.
    if(b.jokerLockByColor?.[next]) b.jokerLockByColor[next]=false;
    skipped.push(next);
    bossAction(room,"⏸️","Spielzug ausgesetzt",`${String(next).toUpperCase()} setzt diesen vollständigen Spielzug aus.`);
    const bw=bossTurnCompleted(room,next);
    if(Array.isArray(bw)) wheels.push(...bw);
    next=nextTurnColor(room,next);
    clearUntilNextTurnEffects(room,next);
    guard++;
  }

  room.state.turnColor=next;
  return {wheels,skipped,next};
}

function finalizePendingEventTurn(room,seq=null){
  const b=ensureBossState(room);
  const pending=b?.pendingEventTurn;
  if(!b||!pending) return {done:false,wheels:[]};
  if(seq!=null && Number(pending.seq||0)!==Number(seq||0)) return {done:false,wheels:[]};
  // Solange eine Auswahl zur gerade bestätigten Karte offen ist, bleibt der Zug eingefroren.
  if(b.pendingChoice) return {done:false,wheels:[]};

  const color=String(pending.color||"");
  const wheels=[];
  if(!ALLOWED_COLORS.includes(color)){
    b.pendingEventTurn=null;
    if(room.state.phase==="event_wait") room.state.phase="need_roll";
    return {done:true,wheels};
  }

  room.state.turnColor=color;

  // Extrem seltener Legacy-Fall: Ereignisfeld und aufhebbare Barikade lagen gleichzeitig.
  // Dann wird nach der Kartenbestätigung zuerst die normale Barikadenplatzierung beendet.
  if(pending.pickedBarricade && !b.barricadesDisabled && !!room.state.carryingByColor?.[color]){
    room.state.phase="place_barricade";
    room.state.rolled=null;
    room.state.rollVisual=null;
    b.pendingEventTurn=null;
    return {done:true,wheels};
  }

  const forcedSteps=takeNextLegalForcedEventMove(room,color);
  if(forcedSteps>0){
    room.state.rolled=forcedSteps;
    room.state.phase="need_move";
    room.state.eventMoveActive={color,steps:forcedSteps,source:`event_walk_${forcedSteps}`};
  }else{
    if(room.state.extraRollPending){
      room.state.turnColor=color;
    }else{
      const adv=advanceTurnWithEventSkips(room,color);
      if(Array.isArray(adv?.wheels) && adv.wheels.length) wheels.push(...adv.wheels);
    }
    room.state.extraRollPending=false;
    room.lastRollWasSix=false;
    room.state.phase="need_roll";
    room.state.rolled=null;
    room.state.rollVisual=null;
    room.state.eventMoveActive=null;
  }
  b.pendingEventTurn=null;
  return {done:true,wheels};
}

function applyBossEventEffect(room,evt){
  const b=ensureBossState(room);
  if(!b||!evt) return {effectText:"",wheels:[]};
  if(evt.effectAppliedAt) return {effectText:String(evt.effectText||""),wheels:Array.isArray(evt.wheels)?evt.wheels:[]};
  const card=EVENT_CARD_DEFS.find(c=>String(c.id)===String(evt.cardId||""))||EVENT_CARD_DEFS[0];
  const fieldId=String(evt.fieldId||"");
  const color=String(evt.color||"");
  const ctx={pieceId:String(evt.triggerPieceId||"")};
  let effectText="";
  let wheels=[];
  const eff=card.effect;
  // V17: Countdown, Kartenwirkung und Respawn passieren ERST nach der sichtbaren Bestätigung.
  const bossCountdownResult=advanceBossEventCountdown(room);
  if(eff==="spawn_one"){
    const free=freeBossSlots(room);
    if(!free.length){
      effectText="Beide Bossportale sind bereits belegt – kein neuer Boss erscheint.";
    }else{
      const bossType=pickRandomBossType(room), def=BOSS_TYPES[bossType];
      if(free.length===1){
        const r=spawnBoss(room,bossType,free[0].id,"event_single_only_slot");
        effectText=r.text;
      }else{
        setEventChoice(room,color,"boss_spawn_slot",{
          bossType,
          message:`${def.icon} ${def.name} erscheint! Wähle sein Bossfeld: links oder rechts.`
        });
        effectText=`${def.icon} ${def.name} wurde enthüllt. Wähle jetzt, ob er links oder rechts erscheint.`;
      }
    }
  }else if(eff==="spawn_two"){
    const r=spawnBossesFromEvent(room,2); effectText=r.text; wheels.push(...(r.wheels||[]));
  }else if(eff==="extra_roll"){
    room.state.extraRollPending=true;
    effectText="Du behältst den Zug und darfst nach diesem Zug erneut würfeln. Zusatzwürfe werden nicht mehrfach gestapelt.";
  }else if(eff==="roll_minus2"){
    b.rollModsByColor[color]=-2;
    effectText="Dein nächster Würfelwurf erhält −2. Das Ergebnis kann nicht unter 1 fallen; mehrere −2-Effekte stapeln sich nicht.";
  }else if(eff==="barrier_shuffle_all"){
    effectText=shuffleAllBarricadesEvent(room,color).text;
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
    queueForcedEventMove(room,color,10);
    effectText="Nach dieser Bewegung darfst du direkt eine eigene Figur genau 10 Felder bewegen.";
  }else if(eff==="boss_teleport"){
    effectText=teleportRandomBoss(room).text;
  }else if(eff==="bounty"){
    b.bountyNextBoss=true;
    effectText="Kopfgeld aktiv: Der nächste von einem Spieler besiegte Boss bringt mindestens 2 Joker; eine höhere normale Bossbelohnung bleibt erhalten.";
  }else if(eff==="barrier_wander3"){
    effectText=wanderBarricadesEvent(room,3,color).text;
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
    const r=moveAllPiecesForwardEvent(room); effectText=r.text; wheels.push(...(r.wheels||[]));
  }else if(eff==="piece_home"){
    const opts=(room.state.pieces||[]).filter(p=>p.color===color&&p.posKind==="board"&&!pieceEventShieldActive(room,p));
    if(opts.length) { setEventChoice(room,color,"own_board_piece_home",{message:"Wähle eine eigene Figur, die zurück ins Haus soll."}); effectText="Wähle jetzt eine eigene Brettfigur."; }
    else effectText="Keine ungeschützte eigene Brettfigur vorhanden – wirkungslos.";
  }else if(eff==="walk20"){
    queueForcedEventMove(room,color,20); effectText="Nach dieser Bewegung darfst du eine eigene Figur genau 20 Felder bewegen.";
  }else if(eff==="boss_global_shield_3"){
    b.globalBossShieldRounds=3; b.globalBossShieldStartRound=Number(b.round||1)+1; effectText="🛡️ Alle Bosse sind ab sofort und für die nächsten 3 vollständigen Runden geschützt.";
  }else if(eff==="all_double_roll_round"){
    for(const c of activeBossColors(room)) b.doubleDiceByColor[c]=true; effectText="Jeder aktive Spieler würfelt bei seinem nächsten Wurf mit 2 Würfeln.";
  }else if(eff==="swap_piece_opponent"){
    const ownSwap=(room.state.pieces||[]).some(p=>p.color===color&&p.posKind==="board");
    const oppSwap=(room.state.pieces||[]).some(p=>p.color!==color&&p.posKind==="board"&&!pieceEventShieldActive(room,p));
    if(ownSwap&&oppSwap){ setEventChoice(room,color,"swap_piece",{stage:"own",message:"Wähle zuerst deine Figur, dann eine ungeschützte gegnerische."}); effectText="Wähle zuerst deine eigene Brettfigur."; } else effectText="Keine gültige ungeschützte gegnerische Brettfigur zum Tauschen vorhanden.";
  }else if(eff==="barrier_steal"){
    if(!b.barricadesDisabled&&movableEventBarricades(room).length&&hasPlacableBarricadeField(room,color)){ setEventChoice(room,color,"move_barrier",{stage:"from",message:"Wähle eine Barikade und danach ihr neues Feld."}); effectText="Wähle eine Barikade und danach ein freies Zielfeld."; } else effectText="Keine bewegliche Barikade oder kein erlaubtes Zielfeld vorhanden – wirkungslos.";
  }else if(eff==="piece_event_shield"){
    const pc=getPiece(room,String(ctx.pieceId||"")); if(pc){ b.pieceEventShields[pc.id]={ownerColor:color}; effectText="🛡️ Die auslösende Figur ist bis zu deinem nächsten Zug vor negativen Ereignissen geschützt."; } else effectText="Keine auslösende Figur gefunden.";
  }else if(eff==="walk3"){
    queueForcedEventMove(room,color,3); effectText="Nach dieser Bewegung darfst du eine eigene Figur genau 3 Felder bewegen.";
  }else if(eff==="opponent_back3"){
    if((room.state.pieces||[]).some(p=>p.color!==color&&p.posKind==="board"&&!pieceEventShieldActive(room,p))){ setEventChoice(room,color,"opponent_piece_back3",{message:"Wähle eine ungeschützte gegnerische Brettfigur."}); effectText="Wähle eine gegnerische Figur: sie geht 3 Felder zurück."; } else effectText="Keine ungeschützte gegnerische Brettfigur vorhanden – wirkungslos.";
  }else if(eff==="exact_roll"){
    b.exactRollByColor[color]=true; effectText="Beim nächsten Wurf darfst du anschließend −1, 0 oder +1 wählen.";
  }else if(eff==="predict_parity"){
    setEventChoice(room,color,"predict_parity",{message:"Sage für deinen nächsten Wurf gerade oder ungerade voraus."}); effectText="Wähle jetzt: gerade oder ungerade.";
  }else if(eff==="barrier_swap"){
    if(movableEventBarricades(room).length>=2){ setEventChoice(room,color,"barrier_swap",{stage:"first",message:"Wähle zwei bewegliche Barikaden."}); effectText="Wähle zwei bewegliche Barikaden."; } else effectText="Zu wenige bewegliche Barikaden vorhanden – wirkungslos.";
  }else if(eff==="barrier_lock"){
    if(movableEventBarricades(room).length){ setEventChoice(room,color,"barrier_lock",{message:"Wähle eine bewegliche Barikade, die bis zu deinem nächsten Zug festgesetzt wird."}); effectText="Wähle eine bewegliche Barikade."; } else effectText="Keine bewegliche Barikade vorhanden – wirkungslos.";
  }else if(eff==="barrier_magnet"){
    if((room.state.pieces||[]).some(p=>p.color===color&&p.posKind==="board")&&(room.state.barricades||[]).length){ setEventChoice(room,color,"barrier_magnet",{message:"Wähle eine eigene Brettfigur."}); effectText="Wähle deine Figur für den Barikaden-Magneten."; } else effectText="Magnet ist wirkungslos.";
  }else if(eff==="roadblock_2rounds"){
    if(!b.barricadesDisabled&&hasPlacableBarricadeField(room,color)){ setEventChoice(room,color,"roadblock",{message:"Wähle ein freies Feld für die Straßensperre."}); effectText="Wähle ein freies Feld. Die Sperre bleibt 2 vollständige Runden."; } else effectText=b.barricadesDisabled?"Barikaden sind dauerhaft deaktiviert.":"Kein erlaubtes freies Feld für die Straßensperre vorhanden – wirkungslos.";
  }else if(eff==="barrier_blast"){
    if(movableEventBarricades(room).length&&hasPlacableBarricadeField(room,color)){ setEventChoice(room,color,"barrier_blast",{message:"Wähle die Barikade für den Sprengmeister."}); effectText="Wähle eine bewegliche Barikade."; } else effectText="Keine bewegliche Barikade oder kein erlaubtes Zielfeld vorhanden – wirkungslos.";
  }else if(eff==="barrier_ban"){
    b.barrierBanUntilRound[color]=1; effectText="Bis zu deinem nächsten Zug darf kein Gegner eine Barikade direkt vor deine Figuren setzen.";
  }else if(eff==="six_hunt"){
    b.sixHuntByColor[color]=true; effectText="Deine nächste 6 bringt einen zusätzlichen Zufallsjoker.";
  }else if(eff==="three_rule"){
    b.threeRuleByColor[color]=true; effectText="Dein nächster Wurf: genau 3 = zusätzlicher Wurf.";
  }else if(eff==="minimum3"){
    b.minimum3ByColor[color]=true; effectText="Dein nächster Wurf beträgt mindestens 3.";
  }else if(eff==="joker_bet"){
    setEventChoice(room,color,"joker_bet",{message:"Du kannst einen Joker setzen oder die Wette ablehnen."}); effectText="Entscheide jetzt, ob du einen Joker setzen möchtest.";
  }else if(eff==="joker_lock"){
    setEventChoice(room,color,"joker_lock",{message:"Wähle einen Gegner für die Joker-Sperre."}); effectText="Wähle einen Gegner.";
  }else if(eff==="boss_rage"){
    if(activeBossEntries(room).length){ setEventChoice(room,color,"boss_rage",{message:"Wähle einen aktiven Boss."}); effectText="Wähle einen Boss: seine nächste Bewegung wird doppelt ausgeführt."; } else effectText="Kein Boss aktiv.";
  }else if(eff==="boss_shield_activation"){
    if(activeBossEntries(room).length){ setEventChoice(room,color,"boss_shield",{message:"Wähle einen aktiven Boss."}); effectText="Wähle einen Boss für den Schutzschild."; } else effectText="Kein Boss aktiv.";
  }else if(eff==="boss_change"){
    if(activeBossEntries(room).length){ setEventChoice(room,color,"boss_change",{message:"Wähle einen aktiven Boss."}); effectText="Wähle den Boss, der seinen Typ wechseln soll."; } else effectText="Kein Boss aktiv.";
  }else if(eff==="laggard4"){
    const r=laggardHelpEvent(room,color); effectText=r.text; wheels.push(...(r.wheels||[]));
  }else if(eff==="trap"){
    if(specialFreeFields(room).length){ setEventChoice(room,color,"trap",{message:"Wähle ein freies Feld für deine Falle."}); effectText="Wähle ein freies Brettfeld für die Falle."; } else effectText="Kein freies Feld für eine Falle vorhanden – wirkungslos.";
  }else if(eff==="miniportal"){
    if(b.miniPortal?.a&&b.miniPortal?.b){ effectText="🚪 Das dauerhafte Miniportal ist bereits aktiv und bleibt unverändert bestehen."; }
    else if(miniPortalPairExists(room,6)){ setEventChoice(room,color,"miniportal",{stage:"first",message:"Wähle das erste Portalfeld."}); effectText="Wähle zwei freie Felder mit maximal 6 Feldern Abstand."; }
    else effectText="Kein gültiges freies Feldpaar für ein Miniportal vorhanden – wirkungslos.";
  }else if(eff==="all_leave_house"){
    effectText=allLeaveHouseEvent(room).text;
  }else if(eff==="barriers_gone_forever"){
    room.state.barricades=[]; b.roadblocks={}; b.lockedBarricades={}; b.barricadesDisabled=true; if(room.state.carryingByColor) for(const c of ALLOWED_COLORS) room.state.carryingByColor[c]=false; effectText="💨 Alle Barikaden verschwinden und bleiben für den Rest des Spiels deaktiviert.";
  }else{
    effectText="Keine direkte Auswirkung.";
  }

  if(bossCountdownResult?.text){
    effectText=`${effectText} ${bossCountdownResult.text}`.trim();
  }

  // Das betretene Ereignisfeld verschwindet sofort und wird an einer neuen Zufallsposition gespawnt.
  // Zu jedem anderen Ereignisfeld bleiben mindestens 3 Brett-Schritte Abstand.
  const respawnFieldId=respawnBossEventField(room,b,fieldId);
  effectText=`${effectText} Das Ereignisfeld verschwindet und erscheint zufällig an einer neuen Stelle.`.trim();

  evt.effectText=String(effectText||"");
  evt.respawnFieldId=respawnFieldId?String(respawnFieldId):null;
  evt.effectAppliedAt=Date.now();
  evt.wheels=wheels.length?wheels.map(w=>({...w})):[];
  const hist=(b.history||[]).find(h=>h&&Number(h.seq||0)===Number(evt.seq||0)&&h.event);
  if(hist) hist.text=evt.effectText;
  return {effectText:evt.effectText,wheels:evt.wheels,respawnFieldId:evt.respawnFieldId};
}

function drawBossEventCard(room,fieldId,color,ctx={}){
  const b=ensureBossState(room);
  if(!b||!b.eventFields.includes(String(fieldId))) return null;
  // Solange die sichtbare Karte nicht bestätigt wurde, darf keine zweite Ereigniskarte darübergelegt werden.
  if(b.lastEvent && !b.lastEvent.confirmedAt) return null;

  if(!b.deck.length){
    b.deck=EVENT_CARD_DEFS.map(c=>c.id);
    shuffleInPlace(b.deck);
    b.discard=[];
  }

  const cardId=String(b.deck.shift()||"");
  const card=EVENT_CARD_DEFS.find(c=>c.id===cardId)||EVENT_CARD_DEFS[0];
  b.discard.push(card.id);

  const evt={
    seq:++b.eventSeq,cardId:card.id,icon:card.icon,title:card.title,text:card.text,
    effectText:"Bestätige die Ereigniskarte – danach wird der Effekt ausgelöst.",
    fieldId:String(fieldId),respawnFieldId:null,
    color:String(color||""),triggerPieceId:String(ctx?.pieceId||""),ts:Date.now(),
    confirmedAt:null,confirmedByColor:null,effectAppliedAt:null,
    wheelJobId:null,wheelJobCreatedAt:null,
    deckRemaining:b.deck.length,deckSize:EVENT_CARD_DEFS.length
  };

  b.lastEvent=evt;
  b.history.push({seq:evt.seq,icon:evt.icon,title:evt.title,text:"Wartet auf Bestätigung.",ts:evt.ts,event:true});
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
    eventFieldCount: (Number.isInteger(Number(room?.state?.eventFieldCount)) || Number.isInteger(Number(room?.eventFieldCount))) ? normalizeBossEventFieldCount(room?.state?.eventFieldCount ?? room?.eventFieldCount) : null,
    boardTheme: normalizeBoardTheme(room?.state?.boardTheme || room?.lobby?.boardTheme),
    allowedColors: ALLOWED_COLORS,
    allowedDiceStyles: ALLOWED_DICE_STYLES,
  };
}

// ---------- Firebase (optional, but recommended for 100% Restore) ----------
// IMPORTANT: We do NOT remove the existing disk save/restore.
// Firebase is an additional, durable persistence layer.
const FIREBASE_ENABLED = String(process.env.FIREBASE_ENABLED || "").trim() === "1";
const FIREBASE_COLLECTION = process.env.FIREBASE_COLLECTION || "rooms";
const SKYJO_COLLECTION = process.env.SKYJO_COLLECTION || "skyjo_rooms";


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
 
 // ---------------- Match tracking / final scoreboard ----------------
 function blankMatchRow(color, name){
   return {
     color:String(color||'').toLowerCase(),
     name:normName(name)||String(color||'Spieler'),
     kills:0, deaths:0, six:0, one:0, distance:0,
     jokersUsed:0, rollCount:0, rollSum:0,
     turnSumMs:0, turnCount:0
   };
 }
 function ensureMatchTrack(room){
   if(!room?.state) return null;
   if(!room.state.matchTrack || typeof room.state.matchTrack!=="object"){
     room.state.matchTrack={perColor:{},turnStartedAt:Date.now(),turnColor:String(room.state.turnColor||'').toLowerCase()};
   }
   const mt=room.state.matchTrack;
   if(!mt.perColor || typeof mt.perColor!=="object") mt.perColor={};
   const active=Array.isArray(room.state.activeColors)&&room.state.activeColors.length?room.state.activeColors:ALLOWED_COLORS;
   for(const c0 of active){
     const c=String(c0||'').toLowerCase();
     if(!c) continue;
     const currentName=getPlayerNameByColor(room,c)||c;
     if(!mt.perColor[c]){
       // Migrate older V22 perPlayer saves if present.
       const legacy=mt.perPlayer&&typeof mt.perPlayer==='object'?mt.perPlayer[currentName]:null;
       mt.perColor[c]={...blankMatchRow(c,currentName),...(legacy&&typeof legacy==='object'?legacy:{})};
     }
     mt.perColor[c].color=c;
     mt.perColor[c].name=normName(currentName)||mt.perColor[c].name||c;
     for(const k of ['kills','deaths','six','one','distance','jokersUsed','rollCount','rollSum','turnSumMs','turnCount']){
       if(!Number.isFinite(Number(mt.perColor[c][k]))) mt.perColor[c][k]=0;
     }
   }
   if(!Number.isFinite(Number(mt.turnStartedAt)) && !room.state.finished) mt.turnStartedAt=Date.now();
   if(!mt.turnColor) mt.turnColor=String(room.state.turnColor||'').toLowerCase();
   return mt;
 }
 function ensureMatchColor(room,color){
   const mt=ensureMatchTrack(room); if(!mt) return null;
   const c=String(color||'').toLowerCase(); if(!c) return null;
   if(!mt.perColor[c]) mt.perColor[c]=blankMatchRow(c,getPlayerNameByColor(room,c)||c);
   const row=mt.perColor[c];
   row.color=c;
   row.name=normName(getPlayerNameByColor(room,c))||row.name||c;
   return row;
 }
 function recordMatchRoll(room, color, value){
   const st=ensureMatchColor(room,color); if(!st) return;
   const v=Number(value)||0;
   st.rollCount+=1; st.rollSum+=v;
   if(v===1) st.one+=1;
   if(v===6) st.six+=1;
 }
 function recordMatchMove(room, color, steps){
   const st=ensureMatchColor(room,color); if(!st) return;
   st.distance += Math.max(0,Number(steps)||0);
 }
 function recordMatchJoker(room, color, type){
   const st=ensureMatchColor(room,color); if(!st) return;
   st.jokersUsed += 1;
   const k=String(type||'').toLowerCase();
   if(k){
     if(!st.jokersByType||typeof st.jokersByType!=="object") st.jokersByType={};
     st.jokersByType[k]=(Number(st.jokersByType[k])||0)+1;
   }
 }
 function recordMatchKick(room, attackerColor, victimColor){
   const a=ensureMatchColor(room,attackerColor); if(a) a.kills+=1;
   const v=ensureMatchColor(room,victimColor); if(v) v.deaths+=1;
 }
 function recordMatchTurnTime(room, color, ms){
   const st=ensureMatchColor(room,color); if(!st) return;
   const capped=Math.max(0,Math.min(120000,Number(ms)||0)); // 2 min cap: reconnect/AFK safe, but realistic long turns remain visible
   st.turnSumMs+=capped;
   st.turnCount+=1;
 }
 function closeCurrentTurnTimer(room){
   try{
     const mt=ensureMatchTrack(room); if(!mt) return;
     const started=Number(mt.turnStartedAt||0);
     if(started>0){
const c=String(mt.turnColor||room.state?.turnColor||'').toLowerCase();
       if(c) recordMatchTurnTime(room,c,Date.now()-started);
     }
     mt.turnStartedAt=0;
     mt.turnColor='';
   }catch(_e){}
 }
 function matchRows(room){
   const mt=ensureMatchTrack(room);
   const active=Array.isArray(room?.state?.activeColors)&&room.state.activeColors.length?room.state.activeColors:ALLOWED_COLORS;
   return active.map(c=>{
     const r=ensureMatchColor(room,c)||blankMatchRow(c,getPlayerNameByColor(room,c));
     const avgTurnMs=r.turnCount?r.turnSumMs/r.turnCount:null;
     const avgRoll=r.rollCount?r.rollSum/r.rollCount:null;
     return {
       color:String(c),name:r.name||getPlayerNameByColor(room,c)||String(c).toUpperCase(),
       kills:Number(r.kills)||0,deaths:Number(r.deaths)||0,six:Number(r.six)||0,one:Number(r.one)||0,
       distance:Number(r.distance)||0,jokersUsed:Number(r.jokersUsed)||0,
       rollCount:Number(r.rollCount)||0,avgRoll:avgRoll!=null?Math.round(avgRoll*100)/100:null,
       turnCount:Number(r.turnCount)||0,avgTurnMs:avgTurnMs!=null?Math.round(avgTurnMs):null
     };
   });
 }
 function topHighlight(rows,key,title,icon,unit,preferMin=false){
   const valid=(rows||[]).filter(r=>r[key]!=null && Number.isFinite(Number(r[key])));
   if(!valid.length) return null;
   const vals=valid.map(r=>Number(r[key]));
   const value=preferMin?Math.min(...vals):Math.max(...vals);
   if(!preferMin && value<=0) return null;
   const winners=valid.filter(r=>Number(r[key])===value).map(r=>r.name);
   return {key,title,icon,unit,value,winners};
 }
 function computeMatchAwards(room){
   const rows=matchRows(room);
   const candidates=[
     topHighlight(rows,'kills','Rauswurf-König','👊','Rauswürfe'),
     topHighlight(rows,'six','Glückspilz','🎲','Sechsen'),
     topHighlight(rows,'jokersUsed','Joker-Meister','🃏','Joker'),
     topHighlight(rows,'deaths','Stehauf-Männchen','🛡️','Rückschläge'),
     topHighlight(rows,'avgTurnMs','Blitzspieler','⚡','Ø Zug',true)
   ].filter(Boolean);
   return candidates.map(a=>({
     id:a.key,title:`${a.icon} ${a.title}`,unit:a.unit,
     value:a.key==='avgTurnMs'?Math.round(a.value/100)/10:a.value,
     winners:a.winners
   }));
 }
 function buildMatchSummary(room,winnerColor){
   const rows=matchRows(room);
   const startedAt=Number(room?.state?.startedAt||0)||0;
   const finishedAt=Number(room?.state?.finishedAt||Date.now())||Date.now();
   const durationMs=startedAt?Math.max(0,finishedAt-startedAt):0;
   const winner=String(winnerColor||room?.state?.winnerColor||'').toLowerCase();
   const totalRolls=rows.reduce((a,r)=>a+(Number(r.rollCount)||0),0);
   const totalTurns=rows.reduce((a,r)=>a+(Number(r.turnCount)||0),0);
   const totalKicks=rows.reduce((a,r)=>a+(Number(r.kills)||0),0);
   const totalJokers=rows.reduce((a,r)=>a+(Number(r.jokersUsed)||0),0);
   const awards=computeMatchAwards(room).slice(0,3);
   return {
     version:1,winnerColor:winner,winnerName:getPlayerNameByColor(room,winner)||winner.toUpperCase(),
     startedAt,finishedAt,durationMs,totalRolls,totalTurns,totalKicks,totalJokers,
     reason:String(room?.state?.gameOverReason||'goal'),players:rows,highlights:awards
   };
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
  if(room.lobby.colorMode !== "wheel") room.lobby.colorMode = "manual";
  if(typeof room.lobby.colorsAssigned !== "boolean") room.lobby.colorsAssigned = false;
  if(!room.lobby.colorWheel || typeof room.lobby.colorWheel !== "object") room.lobby.colorWheel = { seq:0, assignments:[], spunAt:0, durationMs:4600, revealAt:0, design:"slots_v1" };
  if(!Number.isInteger(room.lobby.colorWheel.seq)) room.lobby.colorWheel.seq = 0;
  if(!Array.isArray(room.lobby.colorWheel.assignments)) room.lobby.colorWheel.assignments = [];
  if(!Number.isFinite(Number(room.lobby.colorWheel.spunAt))) room.lobby.colorWheel.spunAt = 0;
  if(!Number.isFinite(Number(room.lobby.colorWheel.durationMs))) room.lobby.colorWheel.durationMs = 4600;
  if(!Number.isFinite(Number(room.lobby.colorWheel.revealAt))) room.lobby.colorWheel.revealAt = 0;
  room.lobby.colorWheel.design = "slots_v1";
  room.lobby.boardTheme = normalizeBoardTheme(room.lobby.boardTheme);
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
    colorMode: room.lobby.colorMode === "wheel" ? "wheel" : "manual",
    colorsAssigned: !!room.lobby.colorsAssigned,
    colorWheel: room.lobby.colorWheel,
    boardTheme: normalizeBoardTheme(room.lobby.boardTheme),
    ts: nowMs()
  };
}

function reserveLobby(room, nameKey, color, status, diceStyle){
  ensureLobby(room);
  lobbyCleanup(room);
  const nk = String(nameKey||"").trim();
  if(!nk) return { ok:false, error:"NO_NAME" };
  const st = (status === "in_game") ? "in_game" : "lobby";
  const prev = room.lobby.reservations[nk] || null;
  let c = ALLOWED_COLORS.includes(String(color||"").toLowerCase()) ? String(color).toLowerCase() : null;

  // Farb-Slots laufen als serverautoritärer Startschritt. Während die Reels noch
  // drehen, darf niemand bereits mit der zugelosten Farbe ins Spiel wechseln.
  if(room.lobby.colorMode === "wheel" && room.lobby.colorsAssigned){
    const revealAt = Number(room.lobby.colorWheel?.revealAt || 0);
    if(revealAt && nowMs() < revealAt) return { ok:false, error:"COLOR_SLOTS_SPINNING", revealAt };
  }

  // Slot-Modus: Vor der Auslosung darf niemand selbst eine Farbe reservieren.
  // Nach der Auslosung bleibt die serverseitig zugeloste Farbe stabil.
  if(room.lobby.colorMode === "wheel"){
    if(room.lobby.colorsAssigned && prev && ALLOWED_COLORS.includes(String(prev.color||"").toLowerCase())){
      c = String(prev.color).toLowerCase();
    }else{
      c = null;
      if(room.lobby.colorsAssigned && !prev){
        // Ein neuer Spieler ist nach einer Auslosung hinzugekommen: Host muss erneut auslosen.
        room.lobby.colorsAssigned = false;
      }
    }
  }

  // enforce unique color lock (if requested)
  if(c){
    const currentHolder = room.lobby.colorLocks[c];
    if(currentHolder && currentHolder !== nk){
      if(!room.lobby.reservations[currentHolder]){
        delete room.lobby.colorLocks[c];
      } else {
        return { ok:false, error:"COLOR_TAKEN", holder: currentHolder };
      }
    }
  }

  const rawDiceStyle = String(diceStyle || "").toLowerCase().trim();
  const ds = ALLOWED_DICE_STYLES.includes(rawDiceStyle) ? rawDiceStyle : normalizeDiceStyle(prev?.diceStyle || "classic");
  if(prev && prev.color && prev.color !== c){
    const pc = String(prev.color).toLowerCase();
    if(room.lobby.colorLocks[pc] === nk) delete room.lobby.colorLocks[pc];
  }

  room.lobby.reservations[nk] = { ts: nowMs(), color: c, status: st, diceStyle: ds };
  if(c) room.lobby.colorLocks[c] = nk;
  return { ok:true };
}

function setLobbyColorMode(room, mode){
  ensureLobby(room);
  const next = String(mode||"").toLowerCase() === "wheel" ? "wheel" : "manual";
  if(room.lobby.colorMode === next) return;
  room.lobby.colorMode = next;
  room.lobby.colorsAssigned = false;
  room.lobby.colorLocks = {};
  for(const r of Object.values(room.lobby.reservations)){
    if(r && typeof r === "object") r.color = null;
  }
  room.lobby.colorWheel = {
    seq: Number(room.lobby.colorWheel?.seq||0),
    assignments: [],
    spunAt: 0,
    durationMs: 4600,
    revealAt: 0,
    design: "slots_v1"
  };
}

function setLobbyBoardTheme(room, theme){
  ensureLobby(room);
  room.lobby.boardTheme = normalizeBoardTheme(theme);
  return room.lobby.boardTheme;
}

function assignLobbyColorsByWheel(room){
  ensureLobby(room);
  lobbyCleanup(room);
  if(room.lobby.colorMode !== "wheel") return { ok:false, error:"NOT_WHEEL_MODE" };
  const activeRevealAt = Number(room.lobby.colorWheel?.revealAt || 0);
  if(room.lobby.colorsAssigned && activeRevealAt && nowMs() < activeRevealAt){
    return { ok:false, error:"COLOR_SLOTS_SPINNING", revealAt:activeRevealAt };
  }
  const entries = Object.entries(room.lobby.reservations)
    .filter(([,r]) => r && typeof r === "object")
    .slice(0, ALLOWED_COLORS.length);
  if(entries.length < 2) return { ok:false, error:"NEED_2P" };

  const colors = shuffleInPlace([...ALLOWED_COLORS]);
  room.lobby.colorLocks = {};
  const assignments = [];
  entries.forEach(([nameKey, r], i) => {
    const color = colors[i];
    r.color = color;
    r.ts = nowMs();
    room.lobby.colorLocks[color] = nameKey;
    assignments.push({ nameKey, color });
  });
  room.lobby.colorsAssigned = true;
  const spunAt = nowMs();
  const durationMs = 4600;
  room.lobby.colorWheel = {
    seq: Number(room.lobby.colorWheel?.seq||0) + 1,
    assignments,
    spunAt,
    durationMs,
    revealAt: spunAt + durationMs,
    design: "slots_v1"
  };
  return { ok:true, assignments };
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


// ---------- SKYJO Action: independent Firestore + disk persistence ----------
// Kept separate from Barikade room.state so both games can use the same backend safely.
const SKYJO_MAX_STATE_BYTES = Number(process.env.SKYJO_MAX_STATE_BYTES || 350000);
function skyjoSavePath(code){
  const safe = docIdForRoom(code);
  return path.join(SAVE_DIR, `SKYJO_${safe}.json`);
}
function normalizeSkyjoCode(code){ return normalizeRoomCode(code); }
function readSkyjoDisk(code){
  try{
    const file=skyjoSavePath(code);
    if(!fs.existsSync(file)) return null;
    const data=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!data || typeof data!=="object" || !data.state || typeof data.state!=="object") return null;
    return { code:normalizeSkyjoCode(code), rev:Number(data.rev||0)||0, state:data.state, updatedAtMs:Number(data.updatedAtMs||data.ts||0)||0, source:"disk" };
  }catch(_e){ return null; }
}
async function readSkyjoPersisted(code){
  const rc=normalizeSkyjoCode(code); if(!rc) return null;
  try{
    initFirebaseIfConfigured();
    if(firestore){
      const snap=await firestore.collection(SKYJO_COLLECTION).doc(docIdForRoom(rc)).get();
      if(snap.exists){
        const d=snap.data()||{};
        if(d.state && typeof d.state==="object") return { code:rc, rev:Number(d.rev||0)||0, state:d.state, updatedAtMs:Number(d.updatedAtMs||d.ts||0)||0, source:"firestore" };
      }
    }
  }catch(e){ console.warn("[skyjo/firebase] read failed:",e?.message||e); }
  return readSkyjoDisk(rc);
}
async function writeSkyjoPersisted(code,state,baseRev){
  const rc=normalizeSkyjoCode(code); if(!rc) return {ok:false,error:"NO_CODE"};
  if(!state || typeof state!=="object" || Array.isArray(state)) return {ok:false,error:"BAD_STATE"};
  let raw=""; try{ raw=JSON.stringify(state); }catch(_e){ return {ok:false,error:"BAD_STATE"}; }
  if(Buffer.byteLength(raw,"utf8")>SKYJO_MAX_STATE_BYTES) return {ok:false,error:"STATE_TOO_LARGE"};
  const cur=await readSkyjoPersisted(rc);
  const curRev=Number(cur?.rev||0)||0;
  if(baseRev!=null && Number(baseRev)!==curRev){
    return {ok:false,conflict:true,error:"STALE_REV",rev:curRev,state:cur?.state||null,updatedAtMs:cur?.updatedAtMs||0};
  }
  const rev=curRev+1, updatedAtMs=Date.now();
  const payload={code:rc,rev,state,updatedAtMs,ts:updatedAtMs};
  try{ fs.writeFileSync(skyjoSavePath(rc),JSON.stringify(payload)); }catch(e){ console.warn("[skyjo/disk] persist failed:",e?.message||e); }
  let firebaseSaved=false;
  try{
    initFirebaseIfConfigured();
    if(firestore){
      await firestore.collection(SKYJO_COLLECTION).doc(docIdForRoom(rc)).set({
        code:rc,rev,state,updatedAtMs,ts:updatedAtMs,
        updatedAt:admin.firestore.FieldValue.serverTimestamp()
      },{merge:false});
      firebaseSaved=true;
    }
  }catch(e){ console.warn("[skyjo/firebase] persist failed:",e?.message||e); }
  return {ok:true,code:rc,rev,updatedAtMs,source:firebaseSaved?"firestore+disk":"disk"};
}
async function deleteSkyjoPersisted(code){
  const rc=normalizeSkyjoCode(code); if(!rc) return false;
  try{ const f=skyjoSavePath(rc); if(fs.existsSync(f))fs.unlinkSync(f); }catch(_e){}
  try{ initFirebaseIfConfigured(); if(firestore)await firestore.collection(SKYJO_COLLECTION).doc(docIdForRoom(rc)).delete(); }catch(e){ console.warn("[skyjo/firebase] delete failed:",e?.message||e); }
  return true;
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
    ensurePersistentWheelJobs(room);
    recoverHeldPersistentWheelJobs(room);
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
      seedBossJokersForLegacyRoom(room);
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
            seedBossJokersForLegacyRoom(room);
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
            seedBossJokersForLegacyRoom(room);
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
app.use(express.json({ limit: "500kb" }));
app.get("/", (_req, res) => res.status(200).send(`barikade-server ok · ${SERVER_BUILD}`));
app.get("/health", (_req, res) =>
  res.status(200).json({ ok: true, build: SERVER_BUILD, ts: Date.now(), rooms: rooms.size, clients: clients.size })
);


// --- SKYJO Action cloud rooms ---
// GET loads the latest state. POST /state writes with optimistic revision protection.
app.get("/skyjo/:code", async (req,res)=>{
  try{
    const code=normalizeSkyjoCode(req.params.code);
    if(!code) return res.status(400).json({ok:false,error:"NO_CODE"});
    const data=await readSkyjoPersisted(code);
    if(!data) return res.status(200).json({ok:true,found:false,code,rev:0,firebaseEnabled:!!firestore||FIREBASE_ENABLED});
    return res.status(200).json({ok:true,found:true,code,rev:data.rev,state:data.state,updatedAtMs:data.updatedAtMs,source:data.source});
  }catch(e){ console.error("[skyjo/get]",e); return res.status(500).json({ok:false,error:"ERR"}); }
});
app.post("/skyjo/:code/state", async (req,res)=>{
  try{
    const code=normalizeSkyjoCode(req.params.code);
    if(!code) return res.status(400).json({ok:false,error:"NO_CODE"});
    const result=await writeSkyjoPersisted(code,req.body?.state,req.body?.baseRev);
    if(result?.conflict) return res.status(409).json(result);
    if(!result?.ok){
      const status=result?.error==="STATE_TOO_LARGE"?413:400;
      return res.status(status).json(result||{ok:false,error:"ERR"});
    }
    return res.status(200).json(result);
  }catch(e){ console.error("[skyjo/state]",e); return res.status(500).json({ok:false,error:"ERR"}); }
});
app.post("/skyjo/:code/reset", async (req,res)=>{
  try{
    const code=normalizeSkyjoCode(req.params.code);
    if(!code) return res.status(400).json({ok:false,error:"NO_CODE"});
    await deleteSkyjoPersisted(code);
    return res.status(200).json({ok:true,code});
  }catch(e){ console.error("[skyjo/reset]",e); return res.status(500).json({ok:false,error:"ERR"}); }
});





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
          avgGameMs: games ? (playMs/games) : 0,
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
          avgGameMs: games ? (playMs/games) : 0,
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

    // V13.9.1: Schon die Lobby kann die stabile Host-Sitzung an den Raum binden.
    // Dadurch entscheidet bei Lobby-Einstellungen der Server und nicht nur die UI.
    const token = String(req.body?.sessionToken || "").trim().slice(0, 80);
    const asHost = req.body?.asHost === true;
    if(asHost && token){
      if(!room.hostToken) room.hostToken = token;
      else if(room.hostToken !== token){
        return res.status(403).json({ ok:false, error:"NOT_HOST" });
      }

      // V13.9.2: /ensure ist die einzige Host-Wahrheit fuer Lobby-Einstellungen.
      // Raum anlegen/beanspruchen und Brettdesign setzen passieren atomar.
      const requestedTheme=String(req.body?.boardTheme || "").toLowerCase();
      if(requestedTheme==='classic' || requestedTheme==='wood' || requestedTheme==='stone'){
        const boardTheme=setLobbyBoardTheme(room,requestedTheme);
        if(room.state){
          room.state.boardTheme=boardTheme;
          try{ Promise.resolve(persistRoomState(room)).catch(()=>{}); }catch(_e){}
          broadcast(room,{type:"snapshot",state:room.state});
          broadcast(room,roomUpdatePayload(room));
        }
      }
    }

    return res.status(200).json({ ok: true, code, rooms: rooms.size, hostClaimed: !!(asHost && token && room.hostToken===token), ...lobbySnapshot(room) });
  } catch (e) {
    console.error("[room/ensure]", e);
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

// Lobby-Farbmodus: optional manuell oder serverseitige Farb-Slots.
app.post("/room/:code/color-mode", (req, res) => {
  try{
    const code = normalizeRoomCode(req.params.code);
    if(!code) return res.status(400).json({ ok:false, error:"NO_CODE" });
    const room = rooms.get(code);
    if(!room) return res.status(404).json({ ok:false, error:"NO_ROOM" });
    if(room.state || Array.from(room.players?.values?.() || []).some(p => isConnectedPlayer(p))){
      return res.status(409).json({ ok:false, error:"PLAYERS_ALREADY_IN_GAME" });
    }
    setLobbyColorMode(room, req.body?.mode);
    return res.status(200).json({ ok:true, code, ...lobbySnapshot(room) });
  }catch(_e){
    return res.status(500).json({ ok:false, error:"ERR" });
  }
});

// Lobby-Brettdesign: Host-UI wählt Klassisch, Holz oder Burgstein.
// Das Ergebnis liegt serverseitig am Raum und wird beim Start in room.state übernommen.
app.post("/room/:code/board-theme", async (req, res) => {
  try{
    const code = normalizeRoomCode(req.params.code);
    if(!code) return res.status(400).json({ ok:false, error:"NO_CODE" });
    const room = rooms.get(code);
    if(!room) return res.status(404).json({ ok:false, error:"NO_ROOM" });

    // Brettdesign ist eine reine Darstellungseinstellung. Sie darf deshalb auch
    // bei einem vorhandenen Spielzustand geändert werden. Der Server prüft aber
    // strikt die stabile Host-Sitzung.
    const token = String(req.body?.sessionToken || "").trim().slice(0, 80);
    if(!token || !room.hostToken || token !== room.hostToken){
      return res.status(403).json({ ok:false, error:"NOT_HOST" });
    }

    const boardTheme = setLobbyBoardTheme(room, req.body?.theme);

    // Falls bereits ein Spielzustand existiert, ziehen wir die rein visuelle
    // Einstellung direkt nach. So können Lobby, Reconnect und offene Spiel-Tabs
    // niemals unterschiedliche Brettdesigns anzeigen.
    if(room.state){
      room.state.boardTheme = boardTheme;
      try{ await persistRoomState(room); }catch(_e){}
      broadcast(room, { type:"snapshot", state:room.state });
      broadcast(room, roomUpdatePayload(room));
    }

    return res.status(200).json({ ok:true, code, boardTheme, ...lobbySnapshot(room) });
  }catch(_e){
    return res.status(500).json({ ok:false, error:"ERR" });
  }
});

app.post("/room/:code/spin-colors", (req, res) => {
  try{
    const code = normalizeRoomCode(req.params.code);
    if(!code) return res.status(400).json({ ok:false, error:"NO_CODE" });
    const room = rooms.get(code);
    if(!room) return res.status(404).json({ ok:false, error:"NO_ROOM" });
    if(room.state || Array.from(room.players?.values?.() || []).some(p => isConnectedPlayer(p))){
      return res.status(409).json({ ok:false, error:"PLAYERS_ALREADY_IN_GAME" });
    }
    const result = assignLobbyColorsByWheel(room);
    if(!result.ok) return res.status(409).json({ ok:false, ...result, code, ...lobbySnapshot(room) });
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
    lobby: { reservations: {}, colorLocks: {}, colorMode:"manual", colorsAssigned:false, colorWheel:{seq:0,assignments:[],spunAt:0,durationMs:4600,revealAt:0,design:"slots_v1"}, boardTheme:"wood" },
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

// ---------- V13.6: PERSISTENTE SERVER-AUTORITÄT FÜR JOKER-RÄDER ----------
// Grundsatz: Der Joker ist Spielzustand und wird sofort serverseitig vergeben.
// Das Glücksrad ist ein separater visueller Auftrag. Jeder Auftrag lebt in room.state,
// wird also auf Disk/Firebase gespeichert, und bleibt dort, bis jeder vorgesehene
// Spieler JEDE Rad-Animation als vollständig beendet bestätigt hat.
//
// Zustellung = "at least once": der Server darf denselben Auftrag mehrfach senden.
// visualId macht jeden einzelnen Radlauf idempotent; der Client spielt ihn nur einmal.
// Damit sind verlorene UND doppelte WebSocket-Pakete harmlos.
const WHEEL_JOB_PROTOCOL = 1;
const WHEEL_JOB_RETRY_MS = 900;

function stableWheelSpinTurns(visualId){
  const str=String(visualId||"");
  let h=2166136261;
  for(let i=0;i<str.length;i++){
    h^=str.charCodeAt(i);
    h=Math.imul(h,16777619)>>>0;
  }
  return 6+(h%3); // immer 6, 7 oder 8 volle Umdrehungen – serverbestimmt
}

function ensurePersistentWheelJobs(room){
  if(!room?.state) return [];
  const st=room.state;
  if(!Array.isArray(st.wheelJobs)) st.wheelJobs=[];
  if(!Number.isInteger(st.wheelJobSeq) || st.wheelJobSeq<0) st.wheelJobSeq=0;

  // Bereits sauberer V13.6-Zustand bleibt objektidentisch. Das vermeidet unnötige
  // Kopien/stale Referenzen während Dispatch + ACK.
  const alreadyNormalized = Number(st.wheelProtocolVersion||0)===WHEEL_JOB_PROTOCOL &&
    st.wheelJobs.every(j=>j && typeof j==="object" && typeof j.id==="string" &&
      Array.isArray(j.expectedColors) && Array.isArray(j.wheel) &&
      typeof j.released==="boolean" && j.finishedByColor && typeof j.finishedByColor==="object");
  if(alreadyNormalized) return st.wheelJobs;

  st.wheelProtocolVersion=WHEEL_JOB_PROTOCOL;
  // Alt-/Importdaten defensiv normalisieren. Ausschließlich JSON-kompatible Werte,
  // weil room.state unverändert in Disk/Firebase geschrieben wird.
  st.wheelJobs=st.wheelJobs.filter(j=>j && typeof j==="object").map((j,jobIndex)=>{
    const id=String(j.id||`restored-wheel-${Number(st.startedAt||0)}-${jobIndex}`);
    const expected=[...new Set((Array.isArray(j.expectedColors)?j.expectedColors:[])
      .map(c=>String(c||"").toLowerCase()).filter(c=>ALLOWED_COLORS.includes(c)))];
    const wheel=(Array.isArray(j.wheel)?j.wheel:[]).filter(Boolean).map((w,i)=>{
      const visualId=String(w?.visualId||`${id}:${i}`);
      return {
        ...w,
        visualId,
        spinTurns:Number.isInteger(w?.spinTurns)?Math.max(6,Math.min(8,w.spinTurns)):stableWheelSpinTurns(visualId),
        serverWheelJobId:id,
        serverWheelIndex:Number.isInteger(w?.serverWheelIndex)?w.serverWheelIndex:i
      };
    });
    const finishedByColor={};
    const src=(j.finishedByColor && typeof j.finishedByColor==="object")?j.finishedByColor:{};
    for(const c of expected){
      finishedByColor[c]=[...new Set((Array.isArray(src[c])?src[c]:[]).map(String)
        .filter(v=>wheel.some(w=>w.visualId===v)))];
    }
    return {
      id,
      source:String(j.source||"server"),
      seq:Number(j.seq||0),
      createdAt:Number(j.createdAt||Date.now()),
      released:j.released!==false,
      releaseAt:Number(j.releaseAt||j.createdAt||Date.now()),
      expectedColors:expected,
      finishedByColor,
      wheel
    };
  });
  return st.wheelJobs;
}

function wheelJobRecipientColors(room){
  const active=Array.isArray(room?.state?.activeColors)
    ? room.state.activeColors.map(c=>String(c||"").toLowerCase()).filter(c=>ALLOWED_COLORS.includes(c))
    : [];
  if(active.length) return [...new Set(active)];
  const current=[];
  for(const p of room?.players?.values?.() || []){
    const c=String(p?.color||"").toLowerCase();
    if(ALLOWED_COLORS.includes(c)) current.push(c);
  }
  return [...new Set(current)];
}

function wheelJobVisualIds(job){
  return (Array.isArray(job?.wheel)?job.wheel:[]).map(w=>String(w?.visualId||"")).filter(Boolean);
}

function wheelJobFinishedIds(job,color){
  const c=String(color||"").toLowerCase();
  if(!job.finishedByColor || typeof job.finishedByColor!=="object") job.finishedByColor={};
  if(!Array.isArray(job.finishedByColor[c])) job.finishedByColor[c]=[];
  return job.finishedByColor[c];
}

function wheelJobComplete(job){
  if(!job) return true;
  const ids=wheelJobVisualIds(job);
  const colors=Array.isArray(job.expectedColors)?job.expectedColors:[];
  if(!ids.length || !colors.length) return true;
  for(const color of colors){
    const done=new Set(wheelJobFinishedIds(job,color));
    for(const id of ids) if(!done.has(id)) return false;
  }
  return true;
}

function findPersistentWheelJob(room,jobId){
  const id=String(jobId||"");
  return ensurePersistentWheelJobs(room).find(j=>j.id===id)||null;
}

function createPersistentWheelJob(room,{source="server",seq=0,jobId="",wheel=[],released=true,releaseAt=Date.now()}={}){
  if(!room?.state) return null;
  const items=(Array.isArray(wheel)?wheel:[]).filter(Boolean);
  if(!items.length) return null;
  const jobs=ensurePersistentWheelJobs(room);
  const st=room.state;
  let id=String(jobId||"").trim();
  if(!id){
    st.wheelJobSeq=(Number(st.wheelJobSeq)||0)+1;
    id=`wheel-${String(st.matchId||"match")}-${st.wheelJobSeq}`;
  }
  const existing=jobs.find(j=>j.id===id);
  if(existing) return existing;

  const expectedColors=wheelJobRecipientColors(room);
  const finishedByColor={};
  for(const c of expectedColors) finishedByColor[c]=[];
  const job={
    id,
    source:String(source||"server"),
    seq:Number(seq||0),
    createdAt:Date.now(),
    released:released!==false,
    releaseAt:released===false ? 0 : Math.max(Date.now(),Number(releaseAt)||Date.now()),
    expectedColors,
    finishedByColor,
    wheel:items.map((w,i)=>{
      const visualId=`${id}:${i}`;
      return {
        ...w,
        visualId,
        spinTurns:Number.isInteger(w?.spinTurns)?Math.max(6,Math.min(8,w.spinTurns)):stableWheelSpinTurns(visualId),
        serverWheelJobId:id,
        serverWheelIndex:i
      };
    })
  };
  jobs.push(job);
  return job;
}

function releasePersistentWheelJob(room,jobId,delayMs=0){
  const job=findPersistentWheelJob(room,jobId);
  if(!job) return null;
  job.released=true;
  job.releaseAt=Date.now()+Math.max(0,Number(delayMs)||0);
  return job;
}

function recoverHeldPersistentWheelJobs(room){
  try{
    if(!room?.state) return;
    const lastEvt=room.state?.boss?.lastEvent||null;
    for(const job of ensurePersistentWheelJobs(room)){
      if(job.released!==false) continue;
      // Ein bestätigtes Ereignis darf nach einem Serverneustart nicht in "held" hängen.
      if(job.source==="boss_event" && lastEvt?.confirmedAt && Number(lastEvt.seq||0)===Number(job.seq||0)){
        job.released=true;
        job.releaseAt=Date.now()+250;
      }
    }
  }catch(_e){}
}

function unfinishedWheelItemsForColor(job,color){
  const c=String(color||"").toLowerCase();
  if(!Array.isArray(job?.expectedColors) || !job.expectedColors.includes(c)) return [];
  const done=new Set(wheelJobFinishedIds(job,c));
  return (Array.isArray(job.wheel)?job.wheel:[]).filter(w=>!done.has(String(w?.visualId||"")));
}

function wheelJobPayload(job,color){
  return {
    type:"server_wheel_job",
    serverCommand:true,
    protocol:WHEEL_JOB_PROTOCOL,
    jobId:String(job?.id||""),
    source:String(job?.source||"server"),
    seq:Number(job?.seq||0),
    createdAt:Number(job?.createdAt||0),
    releaseAt:Number(job?.releaseAt||0),
    wheel:unfinishedWheelItemsForColor(job,color)
  };
}

function sendPendingWheelJobsToPlayer(room,player,wsOverride=null){
  try{
    if(!room?.state||!player) return 0;
    const color=String(player.color||"").toLowerCase();
    if(!ALLOWED_COLORS.includes(color)) return 0;
    const ws=wsOverride || clients.get(player.id)?.ws || null;
    if(!ws || ws.readyState!==1) return 0;
    const now=Date.now();
    let sent=0;
    for(const job of ensurePersistentWheelJobs(room)){
      if(job.released!==true) continue;
      if(Number(job.releaseAt||0)>now) continue;
      const pending=unfinishedWheelItemsForColor(job,color);
      if(!pending.length) continue;
      send(ws,wheelJobPayload(job,color));
      sent++;
    }
    return sent;
  }catch(_e){ return 0; }
}

function dispatchPendingWheelJobs(room){
  try{
    if(!room?.state) return 0;
    let sent=0;
    for(const p of room.players?.values?.() || []){
      if(!isConnectedPlayer(p)) continue;
      sent+=sendPendingWheelJobsToPlayer(room,p);
    }
    return sent;
  }catch(_e){ return 0; }
}

function acknowledgePersistentWheelFinished(room,playerColor,jobId,visualId){
  if(!room?.state) return {ok:false,changed:false,jobRemoved:false};
  const color=String(playerColor||"").toLowerCase();
  const id=String(jobId||"");
  const vid=String(visualId||"");
  if(!ALLOWED_COLORS.includes(color)||!id||!vid) return {ok:false,changed:false,jobRemoved:false};
  const jobs=ensurePersistentWheelJobs(room);
  const idx=jobs.findIndex(j=>j.id===id);
  if(idx<0){
    // Job bereits komplett entfernt: ACK darf idempotent erneut kommen.
    return {ok:true,changed:false,jobRemoved:true};
  }
  const job=jobs[idx];
  if(!job.expectedColors.includes(color)) return {ok:false,changed:false,jobRemoved:false};
  if(!job.wheel.some(w=>String(w?.visualId||"")===vid)) return {ok:false,changed:false,jobRemoved:false};
  const done=wheelJobFinishedIds(job,color);
  let changed=false;
  if(!done.includes(vid)){ done.push(vid); changed=true; }
  let jobRemoved=false;
  if(wheelJobComplete(job)){
    jobs.splice(idx,1);
    jobRemoved=true;
    changed=true;
  }
  return {ok:true,changed,jobRemoved};
}

// Ein einziger, kleiner Server-Puls ersetzt alle per-Job-Timer. Solange ein Auftrag
// nicht vollständig bestätigt wurde, wird er den noch offenen verbundenen Spielern
// erneut angeboten. Es gibt bewusst KEIN 15-Sekunden-Verfallsdatum.
const _wheelJobRetryTimer=setInterval(()=>{
  try{
    for(const room of rooms.values()) dispatchPendingWheelJobs(room);
  }catch(_e){}
},WHEEL_JOB_RETRY_MS);
if(typeof _wheelJobRetryTimer?.unref==="function") _wheelJobRetryTimer.unref();


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
  if (v === "⏳" || v === "⌛" || low === "clock" || low === "hourglass" || low === "timer" || low === "zeituhr") return "clock";
  return "";
}

function emojiGlyph(key) {
  if (key === "laugh") return "😂";
  if (key === "angry") return "😡";
  if (key === "cool") return "😎";
  if (key === "poop") return "💩";
  if (key === "clock") return "⏳";
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
function initGameState(room, activeColors, mode = "classic", starterColor = null, jokerStartCount = null, bossMode = false, boardTheme = null, eventFieldCount = BOSS_EVENT_FIELD_DEFAULT, bossEventTrigger = BOSS_EVENT_BOSS_TRIGGER_DEFAULT) {
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
  const startJokerTypes = bossModeEnabled ? ACTION_JOKER_TYPES : BASE_ACTION_JOKER_TYPES;

  // Action state lives fully on the server (persisted in room.state).
  // Client UI only reads this snapshot.
  const action = (gameMode === "action" || bossModeEnabled) ? {
    // Earned/base jokers live here (with origin color for display)
    jokersOwned: {
      red:    startJokerTypes.flatMap(t => Array.from({ length: baseJokerCount }, () => ({ type: t, color: "red",    source: "base", ts: Date.now() }))),
      blue:   startJokerTypes.flatMap(t => Array.from({ length: baseJokerCount }, () => ({ type: t, color: "blue",   source: "base", ts: Date.now() }))),
      green:  startJokerTypes.flatMap(t => Array.from({ length: baseJokerCount }, () => ({ type: t, color: "green",  source: "base", ts: Date.now() }))),
      yellow: startJokerTypes.flatMap(t => Array.from({ length: baseJokerCount }, () => ({ type: t, color: "yellow", source: "base", ts: Date.now() }))),
    },
    // Backward compat snapshot for UI (counts)
    jokersByColor: {
      red:      { allColors: baseJokerCount, barricade: baseJokerCount, reroll: baseJokerCount, double: baseJokerCount, bossSpawn: bossModeEnabled ? baseJokerCount : 0, bossRemove: bossModeEnabled ? baseJokerCount : 0 },
      blue:     { allColors: baseJokerCount, barricade: baseJokerCount, reroll: baseJokerCount, double: baseJokerCount, bossSpawn: bossModeEnabled ? baseJokerCount : 0, bossRemove: bossModeEnabled ? baseJokerCount : 0 },
      green:    { allColors: baseJokerCount, barricade: baseJokerCount, reroll: baseJokerCount, double: baseJokerCount, bossSpawn: bossModeEnabled ? baseJokerCount : 0, bossRemove: bossModeEnabled ? baseJokerCount : 0 },
      yellow:   { allColors: baseJokerCount, barricade: baseJokerCount, reroll: baseJokerCount, double: baseJokerCount, bossSpawn: bossModeEnabled ? baseJokerCount : 0, bossRemove: bossModeEnabled ? baseJokerCount : 0 },
    },
    // Active effects for the CURRENT turn only (cleared on end_turn)
    effects: {
      allColorsBy: null,   // color that may move any piece this turn
      barricadeBy: null,   // color that may move one barricade this turn
      doubleRoll: null,    // {kind:"sum2", by:"red", pending:true, rolls:[..], chosen?:n }
    },
    // version for future-proofing
    v: 2,
    bossJokerSeedV1: bossModeEnabled,
  } : null;

  const selectedEventFieldCount = bossModeEnabled ? normalizeBossEventFieldCount(eventFieldCount) : 0;
  const selectedBossEventTrigger = bossModeEnabled ? normalizeBossEventBossTrigger(bossEventTrigger) : 0;
  const bossState = bossModeEnabled ? createBossState(selectedEventFieldCount, selectedBossEventTrigger) : null;

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
    eventFieldCount: selectedEventFieldCount,
    bossEventTrigger: selectedBossEventTrigger,
    boardTheme: normalizeBoardTheme(boardTheme || room?.lobby?.boardTheme || room?.state?.boardTheme),
    boss: bossState,
    jokerStartCount: baseJokerCount,
    jokerAwardMode: (room.state && room.state.jokerAwardMode) ? room.state.jokerAwardMode : (room.jokerAwardMode || "thrower"),
    action,
    turnColor,
    phase: "need_roll", // need_roll | need_move | place_barricade
    rolled: null,
    rollVisual: null,
    extraRollPending: false, // persisted: survives server restart after rolling a 6
    eventMoveActive: null, // {color,steps,source} während "10 Felder laufen"
    pieces,
    barricades,
    goal: GOAL,
    carryingByColor,
    activeColors: active,
    wheelProtocolVersion: WHEEL_JOB_PROTOCOL,
    wheelJobSeq: 0,
    wheelJobs: [],

    // ---- Per-match tracking for the compact final scoreboard ----
    matchTrack: (function(){
      const perColor={};
      for(const c of active){
        perColor[c]=blankMatchRow(c,getPlayerNameByColor(room,c)||c);
      }
      return {perColor,turnStartedAt:Date.now(),turnColor:String(turnColor||'').toLowerCase()};
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
  // The winning turn previously never reached end_turn, so its duration was missing.
  closeCurrentTurnTimer(room);
  room.state.finished = true;
  room.state.winnerColor = String(winnerColor || "").toLowerCase() || null;
  room.state.finishedAt = Date.now();
  room.state.phase = "game_over";
  try{
    room.state.matchAwards = computeMatchAwards(room);
    room.state.matchSummary = buildMatchSummary(room,room.state.winnerColor);
  }catch(_e){ room.state.matchAwards = []; room.state.matchSummary = null; }
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
  const eb=room?.state?.bossMode?ensureBossState(room):null;
  if(eb?.barricadesDisabled) return false;

  // Ziel und ausdrücklich barikadenfreie Brettfelder sind tabu.
  if (n.flags?.goal || isStartProtectedNode(nodeId)) return false;

  // Ereignisfelder und aktuelle Bosspositionen bleiben sichtbar/frei.
  if(room?.state?.bossMode && room.state?.boss){
    const b=room.state.boss;
    if(Array.isArray(b.eventFields) && b.eventFields.map(String).includes(String(nodeId))) return false;
    if(Array.isArray(b.slots) && b.slots.some(slot=>String(slot?.boss?.nodeId||"")===String(nodeId))) return false;
    if(Array.isArray(b.traps) && b.traps.some(t=>String(t?.nodeId||"")===String(nodeId))) return false;
    if(String(b?.miniPortal?.a||"")===String(nodeId)||String(b?.miniPortal?.b||"")===String(nodeId)) return false;
    if(String(b?.blackHole?.nodeId||"")===String(nodeId)) return false;
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
  const eb=room?.state?.bossMode?ensureBossState(room):null;
  const hardBlocked=new Set(Object.keys(eb?.roadblocks||{}).map(String));
  if(eb?.blackHole?.nodeId) hardBlocked.add(String(eb.blackHole.nodeId));
  for(const id of (room.state.barricades||[])) if(barrierLockActive(room,String(id))) hardBlocked.add(String(id));
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

      // Straßensperren sind komplett unpassierbar und dürfen auch nicht als Zielfeld dienen.
      if (hardBlocked.has(String(nx))) continue;
      // normale Barikade cannot be passed through; only land
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
  if (!(roll >= 1 && roll <= 20)) return { ok: false, msg: "no roll" };

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
      // Reconnect: persistente, noch nicht vollständig abgespielte Rad-Aufträge
      // werden ausschließlich für diese Spielerfarbe erneut zugestellt.
      sendPendingWheelJobsToPlayer(room, room.players.get(clientId), ws);
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
      const requestedBoardTheme = normalizeBoardTheme(room?.lobby?.boardTheme);
      const requestedEventFieldCount = requestedBossMode
        ? normalizeBossEventFieldCount(msg.eventFieldCount ?? room?.eventFieldCount)
        : BOSS_EVENT_FIELD_DEFAULT;
      const requestedBossEventTrigger = requestedBossMode
        ? normalizeBossEventBossTrigger(msg.bossEventTrigger ?? room?.bossEventTrigger)
        : 0;
      room.eventFieldCount = requestedEventFieldCount;
      room.bossEventTrigger = requestedBossEventTrigger;

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
      room._pendingStart = { starterColor, mode: requestedMode, bossMode: requestedBossMode, boardTheme: requestedBoardTheme, jokerStartCount, eventFieldCount: requestedEventFieldCount, bossEventTrigger: requestedBossEventTrigger, activeColors: uniqueAct.slice(), ts: Date.now() };

      broadcast(room, { type: "start_spin", activeColors: uniqueAct, starterColor, mode: requestedMode, bossMode: requestedBossMode, boardTheme: requestedBoardTheme, jokerStartCount, eventFieldCount: requestedEventFieldCount, bossEventTrigger: requestedBossEventTrigger, durationMs: 4200 });
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
      const requestedBoardTheme = normalizeBoardTheme(pending.boardTheme || room?.lobby?.boardTheme);
      const requestedEventFieldCount = requestedBossMode
        ? normalizeBossEventFieldCount(pending.eventFieldCount ?? room?.eventFieldCount)
        : BOSS_EVENT_FIELD_DEFAULT;
      const requestedBossEventTrigger = requestedBossMode
        ? normalizeBossEventBossTrigger(pending.bossEventTrigger ?? room?.bossEventTrigger)
        : 0;
      room.eventFieldCount = requestedEventFieldCount;
      room.bossEventTrigger = requestedBossEventTrigger;
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

      initGameState(room, uniqueAct, requestedMode, starter, jokerStartCount, requestedBossMode, requestedBoardTheme, requestedEventFieldCount, requestedBossEventTrigger);
      room._pendingStart = null;
      await persistRoomState(room);
      console.log(`[start] room=${room.code} mode=${requestedMode} bossMode=${requestedBossMode?"on":"off"} eventFields=${requestedEventFieldCount} bossTrigger=${requestedBossEventTrigger} boardTheme=${requestedBoardTheme} jokerStartCount=${jokerStartCount ?? "-"} starter=${room.state.turnColor}`);
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
      const requestedBoardTheme = normalizeBoardTheme(room?.lobby?.boardTheme || prev.boardTheme);
      const requestedEventFieldCount = requestedBossMode
        ? normalizeBossEventFieldCount(prev.eventFieldCount ?? prev?.boss?.eventFieldCount ?? room?.eventFieldCount)
        : BOSS_EVENT_FIELD_DEFAULT;
      const requestedBossEventTrigger = requestedBossMode
        ? normalizeBossEventBossTrigger(prev.bossEventTrigger ?? prev?.boss?.bossEventTrigger ?? room?.bossEventTrigger)
        : 0;
      room.eventFieldCount = requestedEventFieldCount;
      room.bossEventTrigger = requestedBossEventTrigger;

      initGameState(room, active, requestedMode, starterColor, jokerStartCount, requestedBossMode, requestedBoardTheme, requestedEventFieldCount, requestedBossEventTrigger);
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

    // ---------- V13.6: Client bestätigt die VOLLSTÄNDIG BEENDETE Animation ----------
    // Der Server löscht einen persistenten Rad-Auftrag erst, wenn jede vorgesehene
    // Spielerfarbe jeden Radlauf als fertig bestätigt hat.
    if (msg.type === "wheel_visual_finished") {
      if (!requireRoomState(room, ws)) return;
      const me = room.players.get(clientId);
      const result=acknowledgePersistentWheelFinished(room, me?.color, msg.jobId, msg.visualId);
      if(result.ok){
        send(ws,{type:"wheel_visual_finished_ack",jobId:String(msg.jobId||""),visualId:String(msg.visualId||"")});
        if(result.changed) await persistRoomState(room);
      }
      return;
    }

    // ---------- EREIGNISKARTE: eine Bestätigung schließt sie bei ALLEN ----------
    // Nur der Spieler, der die Karte ausgelöst hat, darf sie bestätigen.
    // Der aktuelle turnColor kann zu diesem Zeitpunkt bereits weitergeschaltet sein,
    // deshalb prüfen wir bewusst gegen lastEvent.color.
    if (msg.type === "boss_event_ack") {
      if (!requireRoomState(room, ws)) return;
      const b = ensureBossState(room);
      const evt = b?.lastEvent || null;
      const me = room.players.get(clientId);
      const seq = Math.max(0, Math.floor(Number(msg.seq || 0)));

      if (!evt || !seq || Number(evt.seq || 0) !== seq) {
        send(ws, { type:"boss_event_ack_result", ok:false, code:"EVENT_STALE", seq, message:"Diese Ereigniskarte ist nicht mehr aktiv." });
        return;
      }

      const eventColor = String(evt.color || "").toLowerCase();
      const playerColor = String(me?.color || "").toLowerCase();
      if (!eventColor || playerColor !== eventColor) {
        send(ws, { type:"boss_event_ack_result", ok:false, code:"NOT_EVENT_PLAYER", seq, message:"Nur der Spieler dieser Ereigniskarte kann bestätigen." });
        return;
      }

      // Idempotent: ein zweiter Klick / verspätetes Paket ist harmlos.
      const firstConfirm = !evt.confirmedAt;
      if (firstConfirm) {
        evt.confirmedAt = Date.now();
        evt.confirmedByColor = playerColor;
      }

      // V17: Die Karte wurde bis hierhin NUR angezeigt. Erst mit diesem bestätigten OK
      // werden Countdown, Kartenwirkung und Ereignisfeld-Respawn serverautoritär ausgeführt.
      if(!evt.effectAppliedAt) applyBossEventEffect(room,evt);

      // Karten ohne nachfolgende Auswahl können den eingefrorenen Spielerzug sofort
      // fortsetzen. Öffnet der Effekt eine Auswahl, bleibt der Zug bis zu deren Abschluss stehen.
      const continuation=finalizePendingEventTurn(room,seq);
      const continuationWheels=Array.isArray(continuation?.wheels)?continuation.wheels.filter(Boolean):[];
      const eventWheels = (Array.isArray(evt.wheels) ? evt.wheels.filter(Boolean) : []).concat(continuationWheels);
      let eventWheelJob=null;

      // Ereignis-Rad zunächst bewusst "held" anlegen. Der globale Retry-Puls darf
      // diesen Auftrag in dieser Phase NICHT senden. Dadurch ist selbst bei einer
      // langsamen Firestore-Antwort garantiert: kein Rad vor dem gemeinsamen Schließen.
      if(eventWheels.length && !evt.wheelJobCreatedAt){
        const deterministicId=String(evt.wheelJobId || `event-${String(room.state.matchId||"match")}-${Number(evt.seq||0)}`);
        eventWheelJob=createPersistentWheelJob(room,{
          source:"boss_event",
          seq:Number(evt.seq||0),
          jobId:deterministicId,
          wheel:eventWheels,
          released:false
        });
        if(eventWheelJob){
          evt.wheelJobId=eventWheelJob.id;
          evt.wheelJobCreatedAt=Date.now();
        }
      }else if(evt.wheelJobId){
        eventWheelJob=findPersistentWheelJob(room,evt.wheelJobId);
      }

      // 1) Bestätigung + HELD-Radauftrag dauerhaft sichern.
      await persistRoomState(room);

      // 2) Jetzt erst Ereigniskarte bei allen schließen.
      broadcast(room, {
        type:"boss_event_ack",
        seq:Number(evt.seq || 0),
        byColor:playerColor,
        confirmedAt:Number(evt.confirmedAt || Date.now())
      });
      broadcast(room, { type:"snapshot", state:room.state });

      // 3) Nach dem Schließen Radauftrag freigeben und erneut dauerhaft sichern.
      // Bei einem Serverneustart genau zwischen 2) und 3) erkennt Restore den bestätigten
      // Event-Job und gibt ihn automatisch frei; er kann also weder zu früh noch verloren gehen.
      if(eventWheelJob && eventWheelJob.released===false){
        eventWheelJob=releasePersistentWheelJob(room,eventWheelJob.id,180);
        await persistRoomState(room);
      }

      // 4) Nach Freigabe zügig zustellen; danach übernimmt der unbegrenzte Retry-Puls.
      if(eventWheelJob){
        const wait=Math.max(0,Number(eventWheelJob.releaseAt||0)-Date.now())+20;
        setTimeout(()=>{ try{ dispatchPendingWheelJobs(room); }catch(_e){} },wait);
      }
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
        const r = spawnBoss(room, type, msg.slotId || null,"boss_test");
        text = r.text;
        if(!r.ok){ send(ws, { type:"boss_test_result", ok:false, text }); return; }
      } else if (action === "act") {
        const entries = activeBossEntries(room);
        if(!entries.length){ send(ws, { type:"boss_test_result", ok:false, text:"Kein Boss aktiv" }); return; }
        const parts=[];
        for(const e of entries){
          const r=activateBossEntry(room,e,{forced:true,completedRound:Number(b.round||1)});
          if(r.text) parts.push(r.text);
          if(Array.isArray(r.wheels)) wheels.push(...r.wheels);
        }
        text = parts.join(" ") || "Bossaktion ausgeführt.";
      } else if (action === "events") {
        ensureBossEventFieldLayout(room,b,true);
        const eventCount=bossEventFieldCount(room,b);
        bossAction(room,"🎲","Ereignisfelder",`${eventCount} Ereignisfelder wurden zufällig neu verteilt (Mindestabstand 3 Felder).`);
        text=`${eventCount} Ereignisfelder zufällig neu verteilt.`;
      } else if (action === "event_card") {
        if(b.lastEvent && !b.lastEvent.confirmedAt){
          send(ws,{type:"boss_test_result",ok:false,text:"Die vorherige Ereigniskarte ist noch offen. Erst für alle bestätigen."});
          return;
        }
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
        // Ereignis-Räder werden NICHT in Snapshot/Move kopiert. Sie bleiben bis zur
        // Bestätigung an der Ereigniskarte und werden danach in genau EINEN persistenten
        // serverautoritären wheelJob überführt.
        text=evt?`${evt.icon||"🃏"} ${evt.title}: ${evt.effectText||""}`:"Ereigniskarte konnte nicht ausgelöst werden.";
      } else if (action === "clear") {
        for(const slot of b.slots) slot.boss=null;
        b.rollModsByColor={red:0,blue:0,green:0,yellow:0};
        b.skipTurnsByColor={red:0,blue:0,green:0,yellow:0};
        b.forcedMoveByColor={red:0,blue:0,green:0,yellow:0};
        b.forcedMoveQueueByColor={red:[],blue:[],green:[],yellow:[]};
        b.bountyNextBoss=false;
        b.sleepRounds=0;
        b.sleepActiveRound=null;
        b.pendingChoice=null;
        b.pendingEventTurn=null;
        if(room.state.phase==="event_wait") room.state.phase="need_roll";
        b.bossEventCountdown=Math.max(0,Number(b.bossEventTrigger||0));
        b.bossCountdownPending=false;
        b.bossEventTriggersTotal=0;
        b.globalBossShieldRounds=0;
        b.globalBossShieldStartRound=1;
        b.doubleDiceByColor={red:false,blue:false,green:false,yellow:false};
        b.exactRollByColor={red:false,blue:false,green:false,yellow:false};
        b.predictionByColor={red:null,blue:null,green:null,yellow:null};
        b.threeRuleByColor={red:false,blue:false,green:false,yellow:false};
        b.minimum3ByColor={red:false,blue:false,green:false,yellow:false};
        b.sixHuntByColor={red:false,blue:false,green:false,yellow:false};
        b.jokerLockByColor={red:false,blue:false,green:false,yellow:false};
        b.pieceEventShields={}; b.lockedBarricades={}; b.roadblocks={}; b.traps=[]; b.miniPortal=null; b.blackHole=null; b.pendingDoppelCopy=null;
        room.state.eventMoveActive=null;
        bossAction(room,"🧹","Boss-Test","Alle Bosse und temporären Boss-/Ereigniseffekte wurden entfernt.");
        text="Alle Bosse entfernt.";
      } else {
        send(ws, { type:"boss_test_result", ok:false, text:"Unbekannte Testaktion" }); return;
      }

      let testWheelJob=null;
      if(wheels.length){
        testWheelJob=createPersistentWheelJob(room,{source:"boss_test",wheel:wheels,releaseAt:Date.now()});
      }
      await persistRoomState(room);
      broadcast(room, { type:"snapshot", state:room.state });
      if(testWheelJob) dispatchPendingWheelJobs(room);
      send(ws, { type:"boss_test_result", ok:true, text });
      return;
    }


    // ---------- EREIGNISKARTEN-AUSWAHL (serverautoritär) ----------
    if(msg.type === "event_choice"){
      if(!requireRoomState(room,ws)) return;
      const b=ensureBossState(room); const ch=b?.pendingChoice;
      const actor=room.players.get(clientId); const myColor=String(actor?.color||"");
      if(!ch){ send(ws,{type:"error",code:"NO_EVENT_CHOICE",message:"Keine Ereignis-Auswahl offen."}); return; }
      if(myColor!==String(ch.color||"")){ send(ws,{type:"error",code:"NOT_EVENT_OWNER",message:"Diese Ereignis-Auswahl gehört einem anderen Spieler."}); return; }
      const type=String(ch.type||""); let text=""; let done=true; let wheelJob=null;
      const piece=(id)=>getPiece(room,String(id||""));
      const node=String(msg.nodeId||"");
      const chosenPiece=piece(msg.pieceId);

      if(type==="boss_spawn_slot"){
        const bossType=String(ch.bossType||"");
        const slot=b?.slots?.find(s=>String(s?.id||"")===String(msg.slotId||"")&&!s?.boss);
        if(!BOSS_TYPES[bossType]){send(ws,{type:"error",code:"BAD_BOSS",message:"Der angekündigte Boss ist nicht mehr gültig."});return;}
        if(!slot){send(ws,{type:"error",code:"BAD_CHOICE",message:"Dieses Bossfeld ist nicht frei. Wähle ein freies Bossfeld."});return;}
        const r=spawnBoss(room,bossType,slot.id,"event_single_choice");
        if(!r?.ok){send(ws,{type:"error",code:"NO_BOSS_PORTAL",message:r?.text||"Boss konnte nicht erscheinen."});return;}
        text=`👹 ${r.text}`;
      }else if(type==="own_board_piece_home"){
        if(!chosenPiece||chosenPiece.color!==myColor||chosenPiece.posKind!=="board"){send(ws,{type:"error",code:"BAD_CHOICE",message:"Wähle eine eigene Brettfigur."});return;}
        if(pieceEventShieldActive(room,chosenPiece)){send(ws,{type:"error",code:"SHIELDED",message:"Diese Figur ist durch ihr Ereignis-Schutzschild geschützt. Wähle eine andere Figur."});return;}
        sendPieceHome(room,chosenPiece); text="🏠 Die gewählte Figur wurde ins Haus teleportiert.";
      }else if(type==="swap_piece"){
        if(ch.stage==="own"){
          if(!chosenPiece||chosenPiece.color!==myColor||chosenPiece.posKind!=="board"){send(ws,{type:"error",code:"BAD_CHOICE",message:"Wähle zuerst deine eigene Brettfigur."});return;}
          ch.stage="opponent"; ch.selectedPieceId=chosenPiece.id; ch.message="Wähle jetzt eine gegnerische Brettfigur."; done=false; text="Eigene Figur gewählt.";
        }else{
          const a=piece(ch.selectedPieceId), o=chosenPiece;
          if(!a||!o||o.color===myColor||o.posKind!=="board"||a.posKind!=="board"){send(ws,{type:"error",code:"BAD_CHOICE",message:"Wähle eine gegnerische Brettfigur."});return;}
          if(pieceEventShieldActive(room,o)){send(ws,{type:"error",code:"SHIELDED",message:"Diese gegnerische Figur ist durch ein Ereignis-Schutzschild geschützt."});return;}
          const tmp=a.nodeId;a.nodeId=o.nodeId;o.nodeId=tmp;text="🔁 Die beiden Figuren haben ihre Positionen getauscht.";
        }
      }else if(type==="move_barrier"){
        if(ch.stage==="from"){
          if(!(room.state.barricades||[]).includes(node)||barrierLockActive(room,node)||b.roadblocks?.[node]){send(ws,{type:"error",code:"BAD_CHOICE",message:"Diese Barikade kann nicht bewegt werden."});return;}
          ch.stage="to"; ch.from=node; ch.message="Wähle jetzt ein freies Zielfeld."; done=false; text="Barikade gewählt.";
        }else{
          if(!isPlacableBarricade(room,node)||barrierPlacementForbiddenForActor(room,myColor,node)){send(ws,{type:"error",code:"BAD_CHOICE",message:"Dieses Zielfeld ist nicht erlaubt oder durch Barikadenverbot geschützt."});return;}
          const i=room.state.barricades.indexOf(String(ch.from)); if(i<0){send(ws,{type:"error",code:"BAD_CHOICE",message:"Barikade existiert nicht mehr."});return;}
          room.state.barricades[i]=node;text=`🧱 Barikade nach ${node} versetzt.`;
        }
      }else if(type==="opponent_piece_back3"){
        if(!chosenPiece||chosenPiece.color===myColor||chosenPiece.posKind!=="board"){send(ws,{type:"error",code:"BAD_CHOICE",message:"Wähle eine gegnerische Brettfigur."});return;}
        if(pieceEventShieldActive(room,chosenPiece)){send(ws,{type:"error",code:"SHIELDED",message:"Diese Figur ist durch ein Ereignis-Schutzschild geschützt."});return;}
        const rr=movePieceByEvent(room,chosenPiece,3,"backward"); text=rr.text;
        if(rr.wheels?.length) wheelJob=createPersistentWheelJob(room,{source:"event_back3_boss",wheel:rr.wheels,releaseAt:Date.now()});
      }else if(type==="predict_parity"){
        const val=String(msg.choice||""); if(!["even","odd"].includes(val)){send(ws,{type:"error",code:"BAD_CHOICE",message:"Gerade oder ungerade wählen."});return;}
        b.predictionByColor[myColor]=val;text=`🔮 Vorhersage gespeichert: ${val==="even"?"gerade":"ungerade"}.`;
      }else if(type==="barrier_swap"){
        if(ch.stage==="first"){
          if(!(room.state.barricades||[]).includes(node)||barrierLockActive(room,node)||b.roadblocks?.[node]){send(ws,{type:"error",code:"BAD_CHOICE",message:"Wähle eine bewegliche normale Barikade."});return;}
          ch.stage="second";ch.first=node;ch.message="Wähle die zweite bewegliche Barikade.";done=false;text="Erste Barikade gewählt.";
        }else{
          if(node===String(ch.first)||!(room.state.barricades||[]).includes(node)||barrierLockActive(room,node)||b.roadblocks?.[node]){send(ws,{type:"error",code:"BAD_CHOICE",message:"Wähle eine andere bewegliche normale Barikade."});return;}
          // Zwei normale Barikaden sind spielmechanisch identisch. Der Positions-Tausch
          // wird daher korrekt akzeptiert, hat ohne individuelle Barikaden-IDs aber
          // naturgemäß keine sichtbare Auswirkung auf das Brett.
          text="🧱 Die beiden normalen Barikaden wurden getauscht.";
        }
      }else if(type==="barrier_lock"){
        if(!(room.state.barricades||[]).includes(node)||barrierLockActive(room,node)||b.roadblocks?.[node]){send(ws,{type:"error",code:"BAD_CHOICE",message:"Wähle eine bewegliche, noch nicht feste Barikade."});return;}
        b.lockedBarricades[node]={ownerColor:myColor};text="🔐 Barikade bis zu deinem nächsten Zug fixiert.";
      }else if(type==="barrier_magnet"){
        if(!chosenPiece||chosenPiece.color!==myColor||chosenPiece.posKind!=="board"){send(ws,{type:"error",code:"BAD_CHOICE",message:"Wähle eine eigene Brettfigur."});return;}
        const dest=forwardChoices(chosenPiece.nodeId).find(id=>isPlacableBarricade(room,String(id))&&!barrierPlacementForbiddenForActor(room,myColor,String(id)));
        const mov=(room.state.barricades||[]).filter(id=>!barrierLockActive(room,id)&&!b.roadblocks?.[id]);
        if(!dest||!mov.length){text="🧲 Kein gültiges Magnet-Ziel gefunden.";}else{
          mov.sort((a,c)=>{const pa=bossShortestPath(chosenPiece.nodeId,a),pc=bossShortestPath(chosenPiece.nodeId,c);return (pa?.length||9999)-(pc?.length||9999);});
          const from=String(mov[0]),i=room.state.barricades.indexOf(from);room.state.barricades[i]=String(dest);text=`🧲 Nächste Barikade wurde direkt vor die Figur gezogen.`;
        }
      }else if(type==="roadblock"){
        if(b.barricadesDisabled||!isPlacableBarricade(room,node)||barrierPlacementForbiddenForActor(room,myColor,node)){send(ws,{type:"error",code:"BAD_CHOICE",message:"Wähle ein freies erlaubtes Feld außerhalb eines Barikadenverbots."});return;}
        room.state.barricades.push(node);b.roadblocks[node]={ownerColor:myColor,roundsLeft:2,startRound:Number(b.round||1)+1};text="🚧 Straßensperre steht für zwei vollständige Runden.";
      }else if(type==="barrier_blast"){
        const rr=randomRelocateBarricade(room,node,myColor);
        if(!rr.ok){send(ws,{type:"error",code:"BAD_CHOICE",message:rr.text||"Diese Barikade kann nicht versetzt werden."});return;}
        text=`🧨 ${rr.text}`;
      }else if(type==="joker_bet"){
        const jt=String(msg.jokerType||"");
        if(!jt||jt==="skip"){text="🃏 Joker-Wette abgelehnt.";}else{
          if(!consumeOwnedJoker(room.state.action,myColor,jt)){send(ws,{type:"error",code:"NO_JOKER",message:"Diesen Joker besitzt du nicht."});return;}
          const roll=randInt(1,6); if(roll>=4){const r=grantRandomEventJokers(room,myColor,2,"joker_bet");text=`🃏 Wette: ${roll} – gewonnen! Zwei Joker.`; if(r.wheels?.length) wheelJob=createPersistentWheelJob(room,{source:"joker_bet",wheel:r.wheels,releaseAt:Date.now()});}else text=`🃏 Wette: ${roll} – verloren. Der gesetzte Joker ist weg.`;
        }
      }else if(type==="joker_lock"){
        const target=String(msg.targetColor||"");if(!activeBossColors(room).includes(target)||target===myColor){send(ws,{type:"error",code:"BAD_CHOICE",message:"Wähle einen Gegner."});return;}
        b.jokerLockByColor[target]=true;text=`🔒 ${target.toUpperCase()} kann im nächsten Zug keinen Joker einsetzen.`;
      }else if(["boss_rage","boss_shield","boss_change"].includes(type)){
        const slot=b.slots.find(s=>String(s.id)===String(msg.slotId||"")&&s.boss);if(!slot){send(ws,{type:"error",code:"BAD_CHOICE",message:"Wähle einen aktiven Boss."});return;}
        if(type==="boss_rage"){slot.boss.rageDoubleNext=true;text=`👹 ${slot.boss.name} bewegt sich bei der nächsten Aktivierung doppelt.`;}
        if(type==="boss_shield"){slot.boss.eventShieldActivations=1;text=`🛡️ ${slot.boss.name} ist bis nach der nächsten Aktivierung geschützt.`;}
        if(type==="boss_change"){
          const usedByOthers=new Set(b.slots.filter(s=>s!==slot&&s?.boss).map(s=>String(s.boss.type||"")));
          let pool=Object.keys(BOSS_TYPES).filter(k=>k!==slot.boss.type&&!usedByOthers.has(k));
          if(!pool.length) pool=Object.keys(BOSS_TYPES).filter(k=>k!==slot.boss.type);
          const oldType=String(slot.boss.type||"");
          if(oldType==="devourer") clearWorldEaterHoleForBoss(room,slot.boss.id);
          const nt=pool[Math.floor(Math.random()*pool.length)], d=BOSS_TYPES[nt];
          slot.boss.type=nt;slot.boss.name=d.name;slot.boss.icon=d.icon;slot.boss.hp=1;slot.boss.maxHp=1;
          slot.boss.lastCopiedSteps=0; slot.boss.turnsSinceAction=(nt==="devourer"?0:undefined);
          text=`🔀 Boss-Wechsel: ${d.icon} ${d.name}.`;
        }
      }else if(type==="trap"){
        if(!isSpecialFieldFree(room,node)){send(ws,{type:"error",code:"BAD_CHOICE",message:"Wähle ein freies Brettfeld."});return;}
        b.traps.push({nodeId:node,ownerColor:myColor});text="🕳️ Falle wurde gelegt.";
      }else if(type==="miniportal"){
        if(ch.stage==="first"){
          if(!isSpecialFieldFree(room,node)){send(ws,{type:"error",code:"BAD_CHOICE",message:"Wähle ein freies Brettfeld."});return;}
          // Nur ein erstes Portal akzeptieren, von dem aus auch wirklich ein zweites
          // freies Portal innerhalb von 6 Brettschritten erreichbar ist. Sonst könnte
          // der Spieler in Stufe 2 ohne gültige Auswahl festhängen.
          const partnerExists=specialFreeFields(room).some(id=>{
            if(String(id)===node) return false;
            const p=bossShortestPath(node,String(id));
            return !!p && p.length-1<=6;
          });
          if(!partnerExists){send(ws,{type:"error",code:"NO_PORTAL_PARTNER",message:"Von diesem Feld gibt es innerhalb von 6 Feldern kein zweites freies Portalfeld. Wähle ein anderes erstes Feld."});return;}
          ch.stage="second";ch.first=node;ch.message="Wähle das zweite Portalfeld (maximal 6 Felder entfernt).";done=false;text="Erstes Portal gewählt.";
        }else{
          const path=bossShortestPath(String(ch.first),node); if(!isSpecialFieldFree(room,node)||node===String(ch.first)||!path||path.length-1>6){send(ws,{type:"error",code:"BAD_CHOICE",message:"Zweites Portal muss frei und höchstens 6 Felder entfernt sein."});return;}
          b.miniPortal={a:String(ch.first),b:node};text="🚪 Miniportal dauerhaft aktiviert.";
        }
      }else if(type==="adjust_roll"){
        const delta=Math.max(-1,Math.min(1,Number(msg.delta||0))); if(room.state.turnColor!==myColor||room.state.phase!=="need_move"||room.state.rolled==null){send(ws,{type:"error",code:"BAD_PHASE",message:"Wurf kann nicht mehr angepasst werden."});return;}
        const minRoll=Math.max(1,Math.min(20,Number(ch.minRoll||1)));
        // V14.4: Exakter Zug verändert nur den Bewegungswert. Bereits durch den
        // ursprünglichen Wurf verdiente Extra-Würfe (natürliche 6 / Dreier-Regel)
        // bleiben erhalten; außerdem kann „Minimum 3“ nicht nachträglich auf 2
        // abgesenkt werden. Doppelwürfe dürfen durch +1 auch 13 erreichen.
        const hadExtra=!!room.state.extraRollPending;
        const beforeAdjust=Number(room.state.rolled);
        const targetAdjust=beforeAdjust+delta;
        room.state.rolled=Math.max(minRoll,Math.min(20,targetAdjust));
        if(room.state.rollVisual && typeof room.state.rollVisual==="object"){
          if(!Array.isArray(room.state.rollVisual.mods)) room.state.rollVisual.mods=[];
          if(delta){
            room.state.rollVisual.mods.push({kind:"delta",value:delta,label:`${delta>0?"+":""}${delta}`,source:"Exakter Zug"});
          }
          if(Number(room.state.rolled)!==targetAdjust){
            room.state.rollVisual.mods.push({kind:"minimum",value:0,label:`MIN ${minRoll}`,source:"Minimum garantiert"});
          }
          room.state.rollVisual.result=Number(room.state.rolled);
        }
        room.state.extraRollPending=hadExtra;
        room.lastRollWasSix=room.state.extraRollPending;
        text=`🎯 Würfelwert angepasst auf ${room.state.rolled}.`;
      }else{send(ws,{type:"error",code:"BAD_CHOICE",message:"Unbekannte Ereignis-Auswahl."});return;}

      let continuationWheelJob=null;
      if(done){
        clearEventChoice(room);
        const evtSeq=Number(b?.lastEvent?.seq||0);
        const cont=finalizePendingEventTurn(room,evtSeq||null);
        if(Array.isArray(cont?.wheels) && cont.wheels.length){
          continuationWheelJob=createPersistentWheelJob(room,{source:"event_continue",wheel:cont.wheels,releaseAt:Date.now()});
        }
      }
      if(text) bossAction(room,"🃏","Ereignis-Auswahl",text);
      await persistRoomState(room); broadcast(room,{type:"snapshot",state:room.state,eventChoiceResult:text});
      if(wheelJob||continuationWheelJob) dispatchPendingWheelJobs(room);
      return;
    }

    // ---------- ACTION MODE / BOSS-JOKER (server is chef) ----------
    // V12.12: 4 Basis-Joker + 2 Bossmodus-Joker (Boss spawnen / Boss entfernen).
    if (msg.type === "use_joker") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;
      if(blockForPendingEventChoice(room,ws)) return;

      if (!jokerGameplayEnabled(room)) {
        send(ws, { type: "error", code: "NOT_ACTION", message: "Action-Modus ist nicht aktiv" });
        return;
      }

      const turnColor = room.state.turnColor;
      const bossStateForJoker=ensureBossState(room);
      if(bossStateForJoker?.jokerLockByColor?.[turnColor]){
        send(ws,{type:"error",code:"JOKER_LOCKED",message:"🔒 Ereigniskarte: In diesem Zug sind deine Joker gesperrt."}); return;
      }
      if(room.state.eventMoveActive?.color===turnColor){
        const n=Math.max(1,Number(room.state.eventMoveActive.steps||0));
        send(ws,{type:"error",code:"FORCED_EVENT_MOVE",message:`Ereigniskarte: Zuerst die ${n}-Felder-Zusatzbewegung ausführen.`});
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
        const ebBarr=room.state.bossMode?ensureBossState(room):null;
        if(ebBarr?.barricadesDisabled){
          send(ws,{type:"error",code:"BARRICADES_DISABLED",message:"💨 Ereigniskarte: Barikaden sind für dieses Spiel dauerhaft deaktiviert – dein Joker bleibt erhalten."});
          return;
        }
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
      room.state.rollVisual = null;
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
        const ebDouble=room.state.bossMode?ensureBossState(room):null;
        if(ebDouble?.doubleDiceByColor?.[turnColor]){
          send(ws,{type:"error",code:"EVENT_DOUBLE_ACTIVE",message:"🎲 Doppelwurf ist für deinen nächsten Wurf bereits durch eine Ereigniskarte aktiv – dein Joker bleibt erhalten."});
          return;
        }
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

      if (joker === "bossspawn") {
        if (!room.state.bossMode) { send(ws,{type:"error",code:"BOSS_MODE_ONLY",message:"Dieser Joker ist nur im Bossmodus verfügbar."}); return; }
        if (!hasJoker("bossSpawn")) { send(ws,{type:"error",code:"USED",message:"Boss-spawnen-Joker nicht verfügbar."}); return; }
        if (!["need_roll","need_move"].includes(String(room.state.phase||""))) {
          send(ws,{type:"error",code:"BAD_PHASE",message:"Boss-Joker nur während deines normalen Zuges nutzbar."}); return;
        }
        const spawned=spawnRandomBoss(room,"joker");
        if(!spawned?.ok){
          send(ws,{type:"error",code:"NO_BOSS_PORTAL",message:spawned?.text||"Kein freies Bossportal."});
          return; // Joker NICHT verbrauchen
        }
        consumeNow("bossSpawn");
        try{ recordMatchJoker(room,turnColor,"bossSpawn"); }catch(_e){}
        bossAction(room,"👹","Boss-Joker",`${String(turnColor).toUpperCase()} ruft einen Boss: ${spawned.text}`);
        await persistRoomState(room);
        broadcast(room,{type:"snapshot",state:room.state,joker:"bossspawn"});
        return;
      }

      if (joker === "bossremove") {
        if (!room.state.bossMode) { send(ws,{type:"error",code:"BOSS_MODE_ONLY",message:"Dieser Joker ist nur im Bossmodus verfügbar."}); return; }
        if (!hasJoker("bossRemove")) { send(ws,{type:"error",code:"USED",message:"Boss-entfernen-Joker nicht verfügbar."}); return; }
        if (!["need_roll","need_move"].includes(String(room.state.phase||""))) {
          send(ws,{type:"error",code:"BAD_PHASE",message:"Boss-Joker nur während deines normalen Zuges nutzbar."}); return;
        }
        const removed=removeBossByJoker(room,{bossId:msg.bossId,slotId:msg.slotId});
        if(!removed?.ok){
          send(ws,{type:"error",code:"NO_ACTIVE_BOSS",message:removed?.text||"Kein Boss ausgewählt."});
          return; // Joker NICHT verbrauchen
        }
        consumeNow("bossRemove");
        try{ recordMatchJoker(room,turnColor,"bossRemove"); }catch(_e){}
        await persistRoomState(room);
        broadcast(room,{type:"snapshot",state:room.state,joker:"bossremove",removedBossId:removed?.boss?.id||null});
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
      if(blockForPendingEventChoice(room,ws)) return;

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
      const eb=ensureBossState(room);
      if(eb?.barricadesDisabled){ send(ws,{type:"error",code:"BARRICADES_DISABLED",message:"Barikaden sind für dieses Spiel dauerhaft deaktiviert."}); return; }
      if (!barr.includes(from)) { send(ws, { type: "error", code: "NO_BARR", message: "Quelle hat keine Barikade" }); return; }
      if(barrierLockActive(room,from)||eb?.roadblocks?.[from]){ send(ws,{type:"error",code:"BARRIER_LOCKED",message:"Diese Barikade ist aktuell fest und kann nicht bewegt werden."}); return; }
      if (barr.includes(to)) { send(ws, { type: "error", code: "HAS_BARR", message: "Ziel hat schon eine Barikade" }); return; }
      // V14.3: Auch der normale Barikaden-Joker muss dieselben serverseitigen
      // Zielfeldregeln respektieren wie Ereigniskarten und normales Platzieren.
      // Dadurch können Miniportal, Fallen, Ereignisfelder, Bossfelder, Figuren und
      // ausdrücklich barikadenfreie Felder nicht nachträglich überdeckt werden.
      if(!isPlacableBarricade(room,to)){ send(ws,{type:"error",code:"BAD_NODE",message:"Dieses Feld ist für eine Barikade nicht erlaubt."}); return; }
      if(barrierPlacementForbiddenForActor(room,turnColor,to)){ send(ws,{type:"error",code:"BARRIER_BAN",message:"Barikadenverbot: Dieses Feld direkt vor einer geschützten Figur ist gesperrt."}); return; }

      // move
      room.state.barricades = barr.filter(x => x !== from);
      room.state.barricades.push(to);

      // Doppelgänger spiegelt den Barikaden-Joker als Gegenwirkung:
      // eine andere bewegliche Barikade wird direkt vor eine Figur des Nutzers gesetzt.
      try{ doppelReflectBarricadeJoker(room,turnColor); }catch(e){ console.warn("[boss] doppel joker mirror failed",e?.message||e); }

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
      if(blockForPendingEventChoice(room,ws)) return;

      if (room.state.phase !== "need_roll") {
        send(ws, { type: "error", code: "BAD_PHASE", message: "Erst Zug beenden" });
        return;
      }

      let v = randInt(1, 6);
      let double = null;
      // V21: echte Würfelaugen getrennt von späteren Modifikatoren speichern.
      let rollVisual = { dice:[v], base:v, mods:[], result:v, isDouble:false };

      // Action-Mode: Doppelwurf (2x würfeln, Summe) – wird VOR dem Würfeln aktiviert
      try{
        if (jokerGameplayEnabled(room) && room.state.action.effects) {
          const eff = room.state.action.effects.doubleRoll;
          if (eff && eff.by === room.state.turnColor && eff.kind === "sum2" && eff.pending === true) {
            const a = randInt(1, 6);
            const b = randInt(1, 6);
            v = a + b;
            double = [a, b];
            rollVisual.dice=[a,b];
            rollVisual.base=v;
            rollVisual.result=v;
            rollVisual.isDouble=true;
            eff.pending = false;
            eff.rolls = [a, b];
            eff.chosen = v;
            // Effekt nach dem Wurf entfernen (Joker ist ohnehin schon verbraucht)
            room.state.action.effects.doubleRoll = null;
          }
        }
      }catch(_e){}

      // Ereigniskarte: Jeder Spieler würfelt einmal mit zwei Würfeln.
      try{
        const b=ensureBossState(room); const c=room.state.turnColor;
        if(b?.doubleDiceByColor?.[c]){
          if(!double){
            const a=randInt(1,6), d=randInt(1,6);
            v=a+d; double=[a,d];
            rollVisual.dice=[a,d];
            rollVisual.base=v;
            rollVisual.result=v;
            rollVisual.isDouble=true;
          }
          b.doubleDiceByColor[c]=false;
        }
      }catch(_e){}

      // Action-Bossmodus: einmaliger Würfelmodifikator aus Events/Bossen.
      try{
        const b=ensureBossState(room);
        if(b){
          const c=room.state.turnColor;
          const mod=Math.max(-2,Math.min(2,Number(b.rollModsByColor?.[c]||0)));
          if(mod){
            const before=v;
            const target=before+mod;
            v=Math.max(1,Math.min(12,target));
            // Den eigentlichen Effekt immer sichtbar machen, auch wenn Minimum/Maximum
            // den rechnerischen Wert anschließend begrenzt.
            rollVisual.mods.push({kind:"delta",value:mod,label:`${mod>0?"+":""}${mod}`,source:"Effekt"});
            if(v!==target){
              rollVisual.mods.push({kind:"minimum",value:0,label:v===1?"MIN 1":"MAX 12",source:"Würfelgrenze"});
            }
            rollVisual.result=v;
            b.rollModsByColor[c]=0;
            bossAction(room, mod>0?"🔥":"🥾", "Würfelmodifikator", `${String(c).toUpperCase()}: ${mod>0?"+":""}${mod} → ${v}.`);
          }
        }
      }catch(_e){}

      // Weitere Ereignis-Würfeffekte werden auf den finalen Wert angewandt.
      let eventRollWheelJob=null;
      try{
        const b=ensureBossState(room), c=room.state.turnColor;
        const minimum3Active=!!b?.minimum3ByColor?.[c];
        if(minimum3Active){
          const before=v;
          v=Math.max(3,v);
          if(v!==before) rollVisual.mods.push({kind:"minimum",value:v-before,label:"MIN 3",source:"Minimum garantiert"});
          rollVisual.result=v;
          b.minimum3ByColor[c]=false;
        }
        const threeActive=!!b?.threeRuleByColor?.[c]; if(threeActive) b.threeRuleByColor[c]=false;
        if(b?.predictionByColor?.[c]){
          const predicted=b.predictionByColor[c]; b.predictionByColor[c]=null;
          const correct=(predicted==="even" ? v%2===0 : v%2===1);
          if(correct) queueForcedEventMove(room,c,2);
          bossAction(room,"🔮","Vorhersage",correct?`${String(c).toUpperCase()} lag richtig und erhält +2 Felder Zusatzbewegung.`:`${String(c).toUpperCase()} lag falsch.`);
        }
        if(b?.sixHuntByColor?.[c] && v===6){
          b.sixHuntByColor[c]=false; const rr=grantRandomEventJokers(room,c,1,"six_hunt");
          if(rr.wheels?.length) eventRollWheelJob=createPersistentWheelJob(room,{source:"six_hunt",wheel:rr.wheels,releaseAt:Date.now()});
        }
        if(b?.exactRollByColor?.[c]){
          b.exactRollByColor[c]=false;
          setEventChoice(room,c,"adjust_roll",{
            message:"Wähle für diesen Wurf −1, unverändert oder +1.",
            // „Minimum garantiert“ bleibt auch nach der manuellen ±1-Anpassung gültig.
            minRoll: minimum3Active ? 3 : 1
          });
        }
        room.__eventThreeExtra = threeActive && v===3;
      }catch(_e){}

      console.log(`[roll] room=${room.code} by=${room.state.turnColor} value=${v}`);

      // Stats: track rolls for registered players (no Gast)
      await recordRollStat(room, room.state.turnColor, v);

      // Per-match titles: count rolled 1/6 etc. (server authoritative)
      try{ recordMatchRoll(room, room.state.turnColor, v); }catch(_e){}

      rollVisual.result=v;
      room.state.rollVisual=rollVisual;
      room.state.rolled = v;
      room.state.extraRollPending = (v === 6) || !!room.__eventThreeExtra;
      room.__eventThreeExtra=false;
      room.lastRollWasSix = room.state.extraRollPending; // backward-compat alias
      room.state.phase = "need_move";
      // V24: Der Jäger wartet bis NACH der tatsächlichen Spielerbewegung.
      await persistRoomState(room);
      broadcast(room, { type: "roll", value: v, state: room.state, double, rollVisual:room.state.rollVisual });
      if(eventRollWheelJob) dispatchPendingWheelJobs(room);
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

      // Mark reason before the final summary is calculated.
      room.state.gameOverReason = "forfeit";
      room.state.forfeiterColor = myColor;
      setGameOver(room, winnerColor);

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
      if(blockForPendingEventChoice(room,ws)) return;

      if (room.state.phase === "place_barricade") {
        send(ws, { type: "error", code: "BAD_PHASE", message: "Erst Barikade platzieren" });
        return;
      }
      if(room.state.eventMoveActive?.color===room.state.turnColor){
        const n=Math.max(1,Number(room.state.eventMoveActive.steps||0));
        send(ws,{type:"error",code:"FORCED_EVENT_MOVE",message:`Ereigniskarte: Du musst zuerst die ${n}-Felder-Zusatzbewegung ausführen.`});
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
      room.state.rollVisual = null;
      room.state.phase = "need_roll";
      const endedBossColor = room.state.turnColor;
      const adv=advanceTurnWithEventSkips(room,endedBossColor);
      const bossWheel=adv?.wheels||[];
      room.state.eventMoveActive=null;
      if(room.state.matchTrack){ room.state.matchTrack.turnStartedAt = Date.now(); room.state.matchTrack.turnColor = String(room.state.turnColor||'').toLowerCase(); }

      let endTurnWheelJob=null;
      if(bossWheel && bossWheel.length){
        endTurnWheelJob=createPersistentWheelJob(room,{source:"end_turn_boss",wheel:bossWheel,releaseAt:Date.now()});
      }
      await persistRoomState(room);
      broadcast(room, { type: "move", state: room.state });
      if(endTurnWheelJob) dispatchPendingWheelJobs(room);
      broadcast(room, roomUpdatePayload(room));
      return;
    }

    // ---------- LEGAL TARGETS ----------
    if (msg.type === "legal_request") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;
      if(blockForPendingEventChoice(room,ws)) return;

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
      if(blockForPendingEventChoice(room,ws)) return;

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

      // Ein aktiver Ereignis-Zusatzlauf (3/10/20/+2) darf keine durch eine
      // Ereigniskarte geschützte gegnerische Figur negativ beeinflussen.
      const wasForcedEventMove = !!(
        room.state.eventMoveActive &&
        room.state.eventMoveActive.color === activeColor &&
        Number(room.state.eventMoveActive.steps||0) === Number(room.state.rolled||0)
      );
      if(wasForcedEventMove){
        const finalTarget=String(res.path[res.path.length-1]||"");
        const shieldedVictim=(room.state.pieces||[]).some(op=>op!==pc&&op?.color!==pc.color&&op?.posKind==="board"&&String(op.nodeId||"")===finalTarget&&pieceEventShieldActive(room,op));
        if(shieldedVictim){send(ws,{type:"error",code:"EVENT_SHIELD",message:"🛡️ Diese Figur ist bis zu ihrem nächsten Zug vor negativen Ereigniswirkungen geschützt. Wähle ein anderes Ziel."});return;}
      }
      // Der Doppelgänger kopiert nur die eigentliche Würfelbewegung des aktiven Spielers,
      // nicht zusätzliche 3/10/20-Felder-Ereignisbewegungen.
      const doppelCopySteps = wasForcedEventMove ? 0 : Math.max(0,Math.floor(Number(room.state.rolled||0)));
      if(wasForcedEventMove) room.state.eventMoveActive=null;

      // apply move
      const movedFromHouse = pc.posKind === "house";
      pc.posKind = "board";
      pc.nodeId = res.path[res.path.length - 1];

      let landed = pc.nodeId;

      // Dauerhaftes Miniportal: Landung auf einem Portal teleportiert genau einmal zum Gegenportal.
      try{
        const portalTo=portalLandingDestination(room,landed);
        if(portalTo){
          const ownBlocked=(room.state.pieces||[]).some(x=>x!==pc&&x?.color===pc.color&&x?.posKind==="board"&&String(x.nodeId||"")===String(portalTo));
          const shieldBlocked=wasForcedEventMove && (room.state.pieces||[]).some(x=>x!==pc&&x?.color!==pc.color&&x?.posKind==="board"&&String(x.nodeId||"")===String(portalTo)&&pieceEventShieldActive(room,x));
          const barrierBlocked=(room.state.barricades||[]).map(String).includes(String(portalTo));
          // Ein Boss am Ausgang blockiert das Portal NICHT: Die Figur teleportiert hin
          // und kann den Boss anschließend über die normale Landungslogik angreifen.
          // Bei einer Ereignis-Zusatzbewegung blockiert dagegen ein geschützter Gegner,
          // damit sein Schutzschild nicht über den Portal-Ausgang umgangen werden kann.
          if(!ownBlocked&&!shieldBlocked&&!barrierBlocked){
            const fromPortal=landed; pc.nodeId=String(portalTo); landed=String(portalTo);
            bossAction(room,"🚪","Miniportal",`${String(activeColor).toUpperCase()}: ${fromPortal} → ${landed}.`);
          }
        }
      }catch(_e){}

      // Per-match titles: count walked fields (server authoritative)
      try{
        const actualSteps = movedFromHouse ? Math.max(1,res.path.length) : Math.max(0,res.path.length-1);
        recordMatchMove(room, activeColor, actualSteps || Number(room.state.rolled||0) || 0);
      }catch(_e){}

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

      // Falle wird nach der endgültigen Landung (inkl. Miniportal) ausgelöst und danach entfernt.
      try{ resolveTrapLanding(room,landed,activeColor); }catch(_e){}

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

          const segments = jokerTypesForRoom(room); // Bossmodus: zusätzlich Boss spawnen / Boss entfernen
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
        if(Array.isArray(bossHit?.wheels) && bossHit.wheels.length){
          wheel = (Array.isArray(wheel) ? wheel : []).concat(bossHit.wheels);
        }
        // Keine Ereignisketten: Ein durch die Karte „10 Felder laufen“ ausgelöster Zusatzlauf
        // kann Bosse besiegen und normal schlagen, zieht aber nicht direkt eine weitere Ereigniskarte.
        eventCard = wasForcedEventMove ? null : drawBossEventCard(room, landed, activeColor,{pieceId:pc.id});
        // V13.3: Räder, die DIREKT zu einer Ereigniskarte gehören, werden absichtlich
        // NICHT mehr mit dem Move-Paket verschickt. Sie bleiben in eventCard.wheels
        // serverseitig zurückgehalten und werden erst nach boss_event_ack ausgelöst.
        // Dadurch kann kein Client das Rad vor der Kartenbestätigung starten oder
        // durch eine verlorene lokale Warteschlange verschlucken.
      }catch(_e){}

      // landed on barricade?
      const barricades = room.state.barricades;
      const idx = barricades.indexOf(landed);
      let picked = false;

      const landedRoadblock=!!ensureBossState(room)?.roadblocks?.[String(landed)];
      if (idx >= 0 && !landedRoadblock) {
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

      // V24: Erst nachdem die Spielfigur wirklich gelaufen ist, reagiert der Jäger.
      // Ereignis-Zusatzbewegungen (3/10/20 Felder) lösen keinen zusätzlichen Jägerlauf aus.
      if(!wasForcedEventMove){
        try{
          const hw=hunterAfterPlayerMove(room);
          if(Array.isArray(hw)&&hw.length) wheel=(Array.isArray(wheel)?wheel:[]).concat(hw);
        }catch(e){ console.warn("[boss] hunter after player move failed",e?.message||e); }
      }

      // Doppelgänger bewegt sich nach jeder abgeschlossenen Spielerbewegung.
      // Muss der Spieler erst eine aufgehobene Barikade neu setzen, wird der Bosszug
      // persistent bis direkt NACH dieser Platzierung aufgeschoben.
      if(doppelCopySteps>0){
        const db=ensureBossState(room);
        if(picked) db.pendingDoppelCopy={color:activeColor,steps:doppelCopySteps};
        else { doppelgangerAfterPlayerMove(room,activeColor,doppelCopySteps); clearImpossibleEventChoice(room,"Doppelgänger"); }
      }

      // V17: Bei einem Ereignisfeld friert der Server den Zug ein, bis der auslösende
      // Spieler die sichtbare Karte mit OK bestätigt hat. Erst DANACH wird die Wirkung
      // ausgeführt und der Zug fortgesetzt. Dadurch kann kein Effekt vor der Karte passieren.
      if(eventCard){
        const eb=ensureBossState(room);
        eb.pendingEventTurn={seq:Number(eventCard.seq||0),color:activeColor,pickedBarricade:!!picked,createdAt:Date.now()};
        room.state.turnColor=activeColor;
        room.state.phase="event_wait";
        room.state.rolled=null;
    room.state.rollVisual=null;
      } else if (!picked) {
        const forcedSteps=takeNextLegalForcedEventMove(room,activeColor);
        const canForced=forcedSteps>0;
        if(canForced){
          // Ereignis-Zusatzbewegung: Der Jäger reagiert nur auf die normale Würfelbewegung und läuft hier NICHT zusätzlich.
          room.state.turnColor=activeColor;
          // Einen bereits verdienten Extra-Wurf (z.B. gewürfelte 6 / Dreier-Regel /
          // Ereigniskarte „Nochmal würfeln“) über die Zusatzbewegung hinweg erhalten.
          room.state.rolled=forcedSteps;
          room.state.phase="need_move";
          room.state.eventMoveActive={color:activeColor,steps:forcedSteps,source:`event_walk_${forcedSteps}`};
        }else{
          if(forcedSteps>0 && eventCard){
            eventCard.effectText=`${eventCard.effectText} Es gibt keine legale ${forcedSteps}-Felder-Bewegung; der Zusatzlauf verfällt.`;
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
      room.state.rollVisual = null;
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

      // Alle NICHT an eine offene Ereigniskarte gebundenen Rad-Belohnungen werden
      // jetzt ebenfalls über denselben persistenten Server-Job ausgeliefert.
      let moveWheelJob=null;
      if(Array.isArray(wheel) && wheel.length){
        moveWheelJob=createPersistentWheelJob(room,{source:"move_reward",wheel,releaseAt:Date.now()});
      }

      // Erst Spielzustand + Radauftrag dauerhaft sichern, danach an Clients senden.
      await persistRoomState(room);

      console.log(`[move] room=${room.code} active=${activeColor} moved=${pc.color} piece=${pc.id} to=${pc.nodeId} picked=${picked}`);
      broadcast(room, {
        type: "move",
        action: { pieceId: pc.id, path: res.path, pickedBarricade: picked, kickedPieces: kicked },
        bossHit: bossHit || undefined,
        eventCard: eventCard || undefined,
        state: room.state
      });
      if(moveWheelJob) dispatchPendingWheelJobs(room);
      if (room.state.finished) {
        broadcast(room, { type: "game_over", winnerColor: room.state.winnerColor, finishedAt: room.state.finishedAt, awards: room.state.matchAwards || [], summary: room.state.matchSummary || null });
      }
      return;
    }

    // ---------- PLACE BARRICADE (Host+Client) ----------
// ---------- PLACE BARRICADE (Host+Client) ----------
if (msg.type === "place_barricade") {
  if (!requireRoomState(room, ws)) return;
  if(blockForPendingEventChoice(room,ws)) return;

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

  if(barrierPlacementForbiddenForActor(room,color,nodeId)){
    send(ws,{type:"error",code:"BARRIER_BAN",message:"Barikadenverbot: Kein Gegner darf hier bis zum nächsten Zug des geschützten Spielers platzieren."});
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

  // Jetzt ist der komplette Spielerzug inklusive Barikadenplatzierung abgeschlossen:
  // eventuell gepufferten Doppelgänger-Zug ausführen.
  try{
    const db=ensureBossState(room);
    const pending=db?.pendingDoppelCopy;
    if(pending && String(pending.color||"")===String(color)){
      db.pendingDoppelCopy=null;
      doppelgangerAfterPlayerMove(room,color,Number(pending.steps||0));
      clearImpossibleEventChoice(room,"Doppelgänger");
    }
  }catch(e){ console.warn("[boss] doppel after barricade failed",e?.message||e); }

  // ✅ weiter
  let bossWheel = [];
  const forcedSteps=takeNextLegalForcedEventMove(room,color);
  const canForced=forcedSteps>0;
  if(canForced){
    room.state.turnColor=color;
    // Extra-Wurf bleibt auch erhalten, wenn zuerst noch die Ereignis-Zusatzbewegung
    // ausgeführt werden muss.
    room.state.phase="need_move";
    room.state.rolled=forcedSteps;
    room.state.eventMoveActive={color,steps:forcedSteps,source:`event_walk_${forcedSteps}`};
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
      room.state.rollVisual = null;
    room.state.eventMoveActive=null;
  }

  let placeWheelJob=null;
  if(bossWheel && bossWheel.length){
    placeWheelJob=createPersistentWheelJob(room,{source:"place_barricade_boss",wheel:bossWheel,releaseAt:Date.now()});
  }
  await persistRoomState(room);
  broadcast(room, { type: "snapshot", state: room.state });
  if(placeWheelJob) dispatchPendingWheelJobs(room);
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
