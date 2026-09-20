<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>Barikade</title>

  <!-- Deine CSS Datei (muss im gleichen Ordner liegen) -->
  <link rel="stylesheet" href="styles.css?v=barikade_sidebar_v3_20260919_1" />
</head>

<body class="game-page">
  <div class="topbar">
    <div class="brand">
      <div class="t">Barikade</div>
      <div class="s">Online · Server steuert Würfel + Züge · 2–3 Spieler</div>
    </div>

    <div class="rightActions">
      <div class="pill"><span id="turnDot" class="dot"></span> <span id="turnText">–</span></div>
      <div id="emojiBar" class="emojiBar" aria-label="Emojis im Spiel">
        <button id="emojiLaughBtn" class="emojiBtn" type="button" title="Lachen">😂</button>
        <button id="emojiAngryBtn" class="emojiBtn" type="button" title="Wütend">😡</button>
        <button id="emojiCoolBtn" class="emojiBtn" type="button" title="Cool">😎</button>
      </div>
      <button id="backLobbyBtn" class="btn">⬅ Zur Lobby</button>
      <button id="endBtn" class="btn">Zug beenden</button>
      <button id="skipBtn" class="btn">Runde aussetzen</button>
      <button id="forfeitBtn" class="btn" style="background:rgba(239,68,68,.18); border-color:rgba(239,68,68,.35)">Aufgeben</button>
      <button id="resetBtn" class="btn">Reset</button>
    </div>
  </div>

  <div class="app">
    <div class="boardWrap">
      <canvas id="c"></canvas>
    </div>

    <div class="panel">
      <!-- Würfel -->
      <h3>Würfel</h3>
      <div class="row">
        <button id="rollBtn" class="btn">Würfeln</button>
        <div class="dicePill">
          <!-- Der Würfel selbst (dein game.js setzt data-face) -->
          <div id="diceCube" data-face="1"></div>
        </div>
      </div>

      <!-- Joker / Action -->
      <div class="sectionGap"></div>
      <h3>Joker</h3>
      <div id="actionToggleRow" class="row" style="justify-content:space-between;">
        <label style="display:flex;align-items:center;gap:10px;opacity:.9;">
          <input id="actionModeToggle" type="checkbox" />
          Action-Modus (Joker-Extra)
        </label>
        <button id="debugToggle" class="btn" style="margin-left:auto;">Debug</button>
      </div>

      <div id="actionCard" style="display:none; margin-top:12px;">
        <div id="actionHint" style="opacity:.85; font-size:13px; margin-bottom:10px;">Action-Modus aktiv</div>

        <!-- Statuszeilen (IDs müssen existieren, game.js versteckt ggf. choose/sum nur optisch) -->
        <div class="kv"><span>🎯 Choose</span><span id="jokerChooseState">–</span></div>
        <div class="kv"><span>➕ Summe</span><span id="jokerSumState">–</span></div>
        <div class="kv"><span>🌈 Alle Farben</span><span id="jokerAllColorsState">–</span></div>
        <div class="kv"><span>🧱 Barikade</span><span id="jokerBarricadeState">–</span></div>
        <div class="kv"><span>🔁 Neu-Wurf</span><span id="jokerRerollState">–</span></div>
        <div class="kv"><span>✨ Effekte</span><span id="actionEffectsState">–</span></div>

        <div class="joker-grid joker-grid-4">
          <button id="jokerAllColorsBtn" class="joker-btn joker-power" type="button">
            <span class="j-ico">🌈</span><span class="j-name">Alle Farben</span><span class="j-count" data-jcount="allColors">0</span>
          </button>
          <button id="jokerBarricadeBtn" class="joker-btn joker-power" type="button">
            <span class="j-ico">🧱</span><span class="j-name">Barikade</span><span class="j-count" data-jcount="barricade">0</span>
          </button>
          <button id="jokerRerollBtn" class="joker-btn joker-power" type="button">
            <span class="j-ico">🔁</span><span class="j-name">Neu‑Wurf</span><span class="j-count" data-jcount="reroll">0</span>
          </button>
          <button id="jokerDoubleBtn" class="joker-btn joker-power" type="button">
            <span class="j-ico">🎲🎲</span><span class="j-name">Doppelwurf</span><span class="j-count" data-jcount="double">0</span>
          </button>
        </div>
      </div>

      <pre id="debugLog"></pre>

      <!-- Kompakter Spielstatus -->
      <div class="sectionGap"></div>
      <h3>Status</h3>
      <div class="statusCompact" aria-label="Spielstatus">
        <div class="statusMini"><span>Board</span><strong id="boardInfo">–</strong></div>
        <div class="statusMini"><span>🧱 Barikaden</span><strong id="barrInfo">–</strong></div>
        <div class="statusMini statusNet"><span>Verbindung</span><strong id="netStatus">Offline</strong></div>
      </div>

      <!-- Technische Online-Details bleiben vollständig erreichbar, sind im Spiel aber kompakt -->
      <details id="connectionDetails" class="connectionDetails">
        <summary>
          <span>⚙ Verbindung & Details</span>
          <small>Server · Raum · Spieler</small>
        </summary>
        <div class="connectionDetailsBody">
          <div id="onlineBox">
            <div class="connectionIntro">Server ist fest hinterlegt. Raum- und Host-Werkzeuge findest du hier.</div>
            <div class="kv"><span>Server</span><span id="serverLabel">–</span></div>

            <div class="row" style="margin-top:10px;">
              <input id="roomCode" placeholder="Raumcode" style="flex:1; padding:10px 12px; border-radius:12px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.04); color:#e6edf3;" />
            </div>

            <div class="row" style="margin-top:10px;">
              <button id="hostBtn" class="btn">Host</button>
              <button id="joinBtn" class="btn">Beitreten</button>
              <button id="leaveBtn" class="btn">Trennen</button>
            </div>

            <div class="kv" style="margin-top:10px;"><span>Spieler</span><span id="netPlayers">–</span></div>
            <div class="kv"><span>Meine Farbe</span><span id="myColor">–</span></div>

            <!-- Host Tools (müssen existieren, game.js blendet sie host-only ein) -->
            <div id="hostTools" class="row" style="display:none; margin-top:12px;">
              <button id="saveBtn" class="btn">Save</button>
              <button id="loadBtn" class="btn">Load</button>
              <button id="restoreBtn" class="btn">Restore</button>
              <input id="loadFile" type="file" accept="application/json" style="display:none;" />
            </div>
            <div id="autoSaveInfo" style="display:none; margin-top:8px; opacity:.75; font-size:12px;">Auto-Save: –</div>
          </div>

          <!-- Resume (optional, wird genutzt) -->
          <div class="row gameStartRow" style="margin-top:10px;">
            <button id="startBtn" class="btn">Spiel starten</button>
            <button id="resumeBtn" class="btn">Spiel fortsetzen</button>
          </div>
        </div>
      </details>
    </div>
  </div>

  <!-- Toast & Banner -->
  <div id="toast"></div>
  <div id="netBanner"></div>

  <div id="emojiOverlay" aria-hidden="true">
    <div class="emojiOverlayCard">
      <div id="emojiOverlayIcon">😂</div>
      <div id="emojiOverlayName">Spieler</div>
    </div>
  </div>

  <!-- Overlay -->
  <div id="overlay">
    <div class="overlayCard">
      <h2 id="overlayTitle">–</h2>
      <p id="overlaySub">–</p>
      <p id="overlayHint">–</p>
      <div class="row" style="justify-content:flex-end; margin-top:12px;">
        <button id="overlayOk" class="btn">OK</button>
      </div>
    </div>
  </div>

  <script>
    // Apply compact UI and lobby-selected defaults BEFORE game.js runs.
    (function(){
      const qs = new URLSearchParams(location.search);
      if(qs.get('compact') === '1') document.body.classList.add('compact');
      const am = (localStorage.getItem('barikade_action_mode') || 'classic');
      document.addEventListener('DOMContentLoaded', ()=>{
        const t = document.getElementById('actionModeToggle');
        if(t) t.checked = (am === 'action');
      });
    })();
  </script>

  <!-- Smiley V9.3: Anzeige ausschliesslich ueber game.js nach Server-Befehl emoji_show. -->

<!-- Neue Versionskennung zwingt Browser/GitHub Pages, game.js frisch zu laden. -->
  <script src="game.js?v=barikade_server_url_fix_v9_3_20260920"></script>
</body>
</html>
