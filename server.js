// --- C1 minimal guards (avoid crashes if optional helpers are missing) ---
(() => {
  if (typeof window.init !== 'function') window.init = () => {};
  if (typeof window.showOverlay !== 'function') window.showOverlay = () => {};
  if (typeof window.hideOverlay !== 'function') window.hideOverlay = () => {};
  if (typeof window.canUseAllColorsNow !== 'function') window.canUseAllColorsNow = () => true;
})();

let isAnimatingMove = false; // FIX: verhindert Klick-Crash nach Refactor

// FIX (Stabilität): Wird in WS-Flow genutzt, muss aber existieren, sonst bricht ws.onmessage ab
let pendingSaveExport = false;

(() => {
  const $ = (id) => document.getElementById(id);


  // ===== C1: UX stability fixes (NO functional changes) =====
  // 1) Prevent viewport jump on mobile while keeping right panel scrollable.
  // 2) Prevent dice clipping by ensuring the dice container allows overflow & adapts size.
  function applyUxStabilityFixes(){
    try{
      const topbar = document.querySelector('.topbar');
      const sidePanel = document.querySelector('.app > .panel');
      if(!sidePanel) return;

      // Ensure the document doesn't become scroll-container (prevents mobile "refresh-like" jumps)
      // while the right panel gets its own scroll.
      try{
        document.documentElement.style.height = '100%';
        document.body.style.height = '100%';
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overscrollBehavior = 'none';
        document.documentElement.style.overscrollBehavior = 'none';
      }catch(_e){}

      // Compute available height for right panel and enable smooth scrolling (tablet friendly)
      const topH = topbar ? topbar.getBoundingClientRect().height : 0;
      const pad = 16; // matches .app padding
      const maxH = Math.max(200, window.innerHeight - topH - pad*2);
      sidePanel.style.maxHeight = maxH + 'px';
      sidePanel.style.overflowY = 'auto';
      sidePanel.style.webkitOverflowScrolling = 'touch';

      // Make sure dice isn't clipped by the dice pill (index.html had overflow:hidden)
      const dicePill = sidePanel.querySelector('.dicePill');
      if(dicePill){
        dicePill.style.overflow = 'visible';
        // Give it a predictable box so large dice stays inside the panel
        // (still responsive; doesn't break desktop)
        const maxSize = Math.min(190, Math.max(92, Math.floor(sidePanel.clientWidth * 0.40)));
        dicePill.style.width = maxSize + 'px';
        dicePill.style.height = maxSize + 'px';
        dicePill.style.flex = '0 0 auto';
        // keep a small inner padding so it doesn't touch the panel edge
        dicePill.style.padding = '6px';
        dicePill.style.boxSizing = 'border-box';
      }

      // Let the cube fill the pill; pips scale automatically with CSS grid
      const diceCube = document.getElementById('diceCube');
      if(diceCube && dicePill){
        diceCube.style.width = '100%';
        diceCube.style.height = '100%';
      }
    }catch(_e){}
  }

  // Apply now + on resize/orientation changes
  window.addEventListener('resize', () => { try{ applyUxStabilityFixes(); }catch(_e){} }, { passive:true });
  window.addEventListener('orientationchange', () => { try{ setTimeout(applyUxStabilityFixes, 50); }catch(_e){} });

  function debugLog(...args){
    try{ console.log(...args); }catch(_e){}
    const el = document.getElementById('debugLog');
    if(el){
      try{
        el.textContent += args.map(a=>typeof a==='string'?a:JSON.stringify(a)).join(' ') + "\n";
        el.scrollTop = el.scrollHeight;
      }catch(_e){}
    }
  }


  // ===== UI refs =====
  let canvas = $("c");
  if(!canvas){
    console.warn("[ui] Canvas #c not found – creating fallback canvas (cache/HTML mismatch?)");
    canvas = document.createElement("canvas");
    canvas.id = "c";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    document.body.appendChild(canvas);
  }

  const ctx = canvas.getContext("2d");
  const toastEl = $("toast");
  const netBannerEl = $("netBanner");
  const debugToggle = $("debugToggle");
  const debugLogEl = $("debugLog");


  // Run UX stability fixes once after we have DOM.
  applyUxStabilityFixes();

  const rollBtn = $("rollBtn");
  const startBtn = $("startBtn");
  const endBtn  = $("endBtn");
  const skipBtn = $("skipBtn");
  const forfeitBtn = $("forfeitBtn");
  const resetBtn= $("resetBtn");
  const resumeBtn = $("resumeBtn");
  // Host tools (Save/Load) - host only
  const hostTools = $("hostTools");
  const saveBtn = $("saveBtn");
  const loadBtn = $("loadBtn");
  const restoreBtn = $("restoreBtn");
  const loadFile = $("loadFile");
  const autoSaveInfo = $("autoSaveInfo");

  // Ensure we always have a container for host-only controls (mobile/older index.html may miss #hostTools)
  let hostToolsBox = hostTools;
  try {
    if (!hostToolsBox) {
      // If Save/Load buttons exist, use their parent as host tools area
      if (saveBtn && saveBtn.parentElement) hostToolsBox = saveBtn.parentElement;
      else if (loadBtn && loadBtn.parentElement) hostToolsBox = loadBtn.parentElement;
      else if (restoreBtn && restoreBtn.parentElement) hostToolsBox = restoreBtn.parentElement;
    }
    if (!hostToolsBox) {
      // Create a host tools box inside the side panel (fallback)
      const panel = document.querySelector(".panel");
      if (panel) {
        hostToolsBox = document.createElement("div");
        hostToolsBox.id = "hostTools";
        hostToolsBox.className = "row";
        hostToolsBox.style.gap = "8px";
        hostToolsBox.style.flexWrap = "wrap";
        // Insert near the bottom of the panel (before the last big buttons if possible)
        const resume = $("resumeBtn");
        if (resume && resume.parentElement === panel) panel.insertBefore(hostToolsBox, resume);
        else panel.appendChild(hostToolsBox);
      }
    }
  } catch(_e) {}


  // Notfall: Farben tauschen (Host-only)
  let swapColorsBtn = $("swapColorsBtn");
  try{
    // Falls index.html den Button noch nicht hat, erzeugen wir ihn sicher per JS,
    // damit du nur game.js tauschen musst.
    if(!swapColorsBtn && hostToolsBox){
      swapColorsBtn = document.createElement("button");
      swapColorsBtn.id = "swapColorsBtn";
      swapColorsBtn.className = "btn";
      swapColorsBtn.textContent = "🔁 Rot ↔ Blau";
      hostToolsBox.appendChild(swapColorsBtn);

      // Joker award mode toggle (Host only): who receives a Joker on kick-out?
      const jokerModeWrap = document.createElement("div");
      jokerModeWrap.style.marginTop = "10px";
      jokerModeWrap.style.display = "flex";
      jokerModeWrap.style.gap = "8px";
      jokerModeWrap.style.flexWrap = "wrap";

      const jokerModeLabel = document.createElement("div");
      jokerModeLabel.textContent = "Joker bei Rausschmeißen:";
      jokerModeLabel.style.width = "100%";
      jokerModeLabel.style.opacity = ".85";
      jokerModeLabel.style.fontWeight = "800";
      jokerModeWrap.appendChild(jokerModeLabel);

      const btnThrower = document.createElement("button");
      btnThrower.className = "btn";
      btnThrower.textContent = "Werfer bekommt Joker";
      btnThrower.onclick = () => {
        netJokerAwardMode = "thrower";
        wsSend({ type: "set_award_mode", mode: "thrower" });
        updateJokerModeButtons();
      };

      const btnVictim = document.createElement("button");
      btnVictim.className = "btn";
      btnVictim.textContent = "Opfer bekommt Joker";
      btnVictim.onclick = () => {
        netJokerAwardMode = "victim";
        wsSend({ type: "set_award_mode", mode: "victim" });
        updateJokerModeButtons();
      };

      function updateJokerModeButtons(){
        btnThrower.className = (netJokerAwardMode === "thrower") ? "btn primary" : "btn";
        btnVictim.className  = (netJokerAwardMode === "victim")  ? "btn primary" : "btn";
      }
      updateJokerModeButtons();

      jokerModeWrap.appendChild(btnThrower);
      jokerModeWrap.appendChild(btnVictim);
      hostToolsBox.appendChild(jokerModeWrap);

    }
  }catch(_e){}
  const diceEl  = $("diceCube");
  // ===== Dice pips (render directly on the cube face) =====
  // Additiv: erzeugt die 9 Pip-Zellen im #diceCube, damit die Augen sichtbar sind.
  // Entfernt keine Funktion und ändert keine Spielregeln.
  function ensureDicePips(){
    try{
      if(!diceEl) return;
      // Already built?
      if(diceEl.querySelector && diceEl.querySelector(".dip")) return;

      // Build pips grid inside diceCube (needed for styles.css selectors)
      diceEl.innerHTML = "";
      const frag = document.createDocumentFragment();
      for(let i=1;i<=9;i++){
        const cell = document.createElement("div");
        cell.className = "dip p"+i;
        const pip = document.createElement("span");
        pip.className = "pip";
        cell.appendChild(pip);
        frag.appendChild(cell);
      }
      diceEl.appendChild(frag);

      // Safety: if some environments miss the CSS grid styles, apply minimal inline fallbacks
      // (keeps sizes from CSS; only sets layout if missing)
      const cs = getComputedStyle(diceEl);
      if(cs.display === "inline" || cs.display === "block"){
        diceEl.style.display = "grid";
        diceEl.style.gridTemplateColumns = "repeat(3, 1fr)";
        diceEl.style.gridTemplateRows = "repeat(3, 1fr)";
        diceEl.style.gap = "3px";
      }
    }catch(_e){}
  }
  
  // Additiv: macht die Augen größer und kontrastreicher (reine Anzeige, keine Logik).
  function applyDicePipSizing(){
    try{
      if(!diceEl) return;
      const rect = diceEl.getBoundingClientRect();
      if(!rect || !rect.width) return;

      // Größe proportional zur Würfelfläche (Tablet: gut sichtbar)
      const pipSize = Math.max(14, Math.round(rect.width * 0.16)); // ~16% der Würfelseite
      const pipColor = "#111"; // dunkler für mehr Kontrast

      // Zellen zentrieren (Fallback, falls CSS fehlt)
      const cells = diceEl.querySelectorAll ? diceEl.querySelectorAll(".dip") : [];
      cells.forEach(c => {
        c.style.display = "flex";
        c.style.alignItems = "center";
        c.style.justifyContent = "center";
      });

      const pips = diceEl.querySelectorAll ? diceEl.querySelectorAll(".pip") : [];
      pips.forEach(p => {
        p.style.width = pipSize + "px";
        p.style.height = pipSize + "px";
        p.style.borderRadius = "999px";
        p.style.background = pipColor;
        // wirkt optisch größer, ohne zu übertreiben
        p.style.boxShadow = "inset 0 2px 3px rgba(255,255,255,0.22), 0 2px 4px rgba(0,0,0,0.45)";
      });
    }catch(_e){}
  }

  // Resize-sicher: wenn sich Layout ändert (Rotation/Tablet), Pips neu skalieren
  (function(){
    let raf = 0;
    function onResize(){
      if(raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { raf = 0; try{ applyDicePipSizing(); }catch(_e){} });
    }
    try{ window.addEventListener("resize", onResize, {passive:true}); }catch(_e){}
    try{ window.addEventListener("orientationchange", onResize, {passive:true}); }catch(_e){}
  })();
// Build pips once at startup (safe even if dice is later replaced)
  try{ ensureDicePips(); }catch(_e){}

  
  try{ applyDicePipSizing(); }catch(_e){}
// UI-only: ensure dice is visible even before the first roll.
  try{ if(diceEl && String(diceEl.getAttribute("data-face")||"0")==="0") diceEl.setAttribute("data-face","1"); }catch(_e){}
  // ===== Dice value label overlay (for sums > 6, e.g. Doppelwurf 7–12) =====
  // Additiv: nur Anzeige, beeinflusst Gameplay nicht.
  let diceValueLabel = null;
  function ensureDiceValueLabel(){
    try{
      if(diceValueLabel && diceValueLabel.isConnected) return diceValueLabel;
      if(!diceEl) return null;
      // Put label inside the dice container so it moves with the cube
      const host = diceEl.parentElement || diceEl;
      // Ensure host can position children
      try{
        const cs = getComputedStyle(host);
        if(cs.position === "static") host.style.position = "relative";
      }catch(_e){}
      const el = document.createElement("div");
      el.id = "diceValueLabel";
      el.textContent = "";
      el.style.position = "absolute";
      el.style.inset = "0";
      el.style.display = "none";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";
      el.style.fontWeight = "900";
      el.style.fontSize = "28px";
      el.style.letterSpacing = "0.5px";
      el.style.color = "rgba(255,255,255,0.95)";
      el.style.textShadow = "0 6px 14px rgba(0,0,0,0.75)";
      el.style.pointerEvents = "none";
      el.style.zIndex = "5";
      el.style.userSelect = "none";
      el.style.display = "flex";
      el.style.display = "none";
      host.appendChild(el);
      diceValueLabel = el;
      return diceValueLabel;
    }catch(_e){ return null; }
  }

  const turnText= $("turnText");
  const turnDot = $("turnDot");
  const boardInfo = $("boardInfo");
  const barrInfo  = $("barrInfo");
  const emojiBar = $("emojiBar");
  const emojiLaughBtn = $("emojiLaughBtn");
  const emojiAngryBtn = $("emojiAngryBtn");
  const emojiCoolBtn = $("emojiCoolBtn");
  const emojiOverlay = $("emojiOverlay");
  const emojiOverlayIcon = $("emojiOverlayIcon");
  const emojiOverlayName = $("emojiOverlayName");
  let emojiOverlayTimer = null;
  let lastEmojiSentAt = 0;

  // ===== Legendary Dice (visual only, isolated) =====
  // Additive: inject styles from JS so du musst NICHT die index.html anfassen.
  // Entfernt keine Funktion – nur Optik für den Würfel.
  function ensureLegendaryDiceStyles(){
    try{
      if(document.getElementById("legendaryDiceStyles")) return;
      const style = document.createElement("style");
      style.id = "legendaryDiceStyles";
      style.textContent = `
        /* Legendary Dice – additive, should not affect gameplay */
        #diceCube{
          position: relative;
          transform-style: preserve-3d;
          will-change: transform, filter;
          filter: drop-shadow(0 10px 22px rgba(0,0,0,.55));
        }
        #diceCube.legend-roll{
          animation: legendRoll 650ms cubic-bezier(.2,.9,.2,1) both;
        }
        #diceCube.legend-ping{
          animation: legendPing 420ms cubic-bezier(.2,.9,.2,1) both;
        }
        #diceCube.legend-crit6::after{
          content:"";
          position:absolute; inset:-14px;
          border-radius: 18px;
          background: radial-gradient(circle at 50% 50%, rgba(255,255,255,.35), rgba(255,255,255,0) 60%);
          filter: blur(0px);
          animation: critGlow 950ms ease-out both;
          pointer-events:none;
          mix-blend-mode: screen;
        }
        #diceCube.legend-crit1::after{
          content:"";
          position:absolute; inset:-16px;
          border-radius: 18px;
          background: radial-gradient(circle at 50% 60%, rgba(255,80,80,.28), rgba(255,80,80,0) 62%);
          animation: critRed 950ms ease-out both;
          pointer-events:none;
          mix-blend-mode: screen;
        }
        /* If older CSS misses .shake, provide a safe fallback */
        #diceCube.shake{
          animation: diceShake 280ms ease-in-out both;
        }
        @keyframes diceShake{
          0%{ transform: translate3d(0,0,0) rotate(0deg) scale(1); }
          20%{ transform: translate3d(-2px,1px,0) rotate(-4deg) scale(1.02); }
          40%{ transform: translate3d(2px,-1px,0) rotate(4deg) scale(1.03); }
          60%{ transform: translate3d(-1px,-2px,0) rotate(-3deg) scale(1.02); }
          80%{ transform: translate3d(1px,2px,0) rotate(3deg) scale(1.01); }
          100%{ transform: translate3d(0,0,0) rotate(0deg) scale(1); }
        }
        @keyframes legendRoll{
          0%{ transform: translate3d(0,0,0) rotateX(0deg) rotateY(0deg) scale(1); filter: drop-shadow(0 10px 22px rgba(0,0,0,.55)); }
          45%{ transform: translate3d(0,-6px,0) rotateX(520deg) rotateY(620deg) scale(1.10); filter: drop-shadow(0 16px 30px rgba(0,0,0,.55)); }
          70%{ transform: translate3d(0,-2px,0) rotateX(760deg) rotateY(840deg) scale(1.06); }
          100%{ transform: translate3d(0,0,0) rotateX(720deg) rotateY(720deg) scale(1); }
        }
        @keyframes legendPing{
          0%{ transform: translate3d(0,0,0) scale(1); }
          40%{ transform: translate3d(0,-2px,0) scale(1.08); }
          100%{ transform: translate3d(0,0,0) scale(1); }
        }
        @keyframes critGlow{
          0%{ opacity:0; transform: scale(.92); }
          25%{ opacity:1; transform: scale(1); }
          100%{ opacity:0; transform: scale(1.14); }
        }
        @keyframes critRed{
          0%{ opacity:0; transform: scale(.92); }
          25%{ opacity:1; transform: scale(1); }
          100%{ opacity:0; transform: scale(1.18); }
        }
      `;
      document.head.appendChild(style);
    }catch(_e){}
  }

  // call once (safe)
  ensureLegendaryDiceStyles();

  // Online
  const serverLabel = $("serverLabel");
  const roomCodeInp = $("roomCode");
  const hostBtn = $("hostBtn");
  const joinBtn = $("joinBtn");
  const leaveBtn= $("leaveBtn");
  const netStatus = $("netStatus");
  const netPlayersEl = $("netPlayers");
  const myColorEl = $("myColor");

  // ===== Action-Mode (J1: Anzeige-Only, kein Gameplay-Risiko) =====
  const actionModeToggle = $("actionModeToggle");
  const actionCard = $("actionCard");
  const actionHint = $("actionHint");
  const jokerChooseState = $("jokerChooseState");
  const jokerSumState = $("jokerSumState");
  const jokerAllColorsState = $("jokerAllColorsState");
  const jokerBarricadeState = $("jokerBarricadeState");
  const jokerRerollState = $("jokerRerollState");
  let jokerDoubleState = $("jokerDoubleState");
  const actionEffectsState = $("actionEffectsState");


  
  const jokerAllColorsBtn = $("jokerAllColorsBtn");
  const jokerBarricadeBtn = $("jokerBarricadeBtn");
  let jokerRerollBtn = $("jokerRerollBtn");

  

  // ===== Visual: Hide legacy jokers (Choose + Summe) =====
  // NOTE: Only visual removal. No gameplay logic is removed on server/client.
  function hideLegacyChooseSumUI(){
    try{
      const ids = ["jokerChooseState","jokerSumState"];
      ids.forEach(id=>{
        const el = document.getElementById(id);
        if(!el) return;
        // hide the row that contains the state label
        const row = el.closest("div") || el.parentElement;
        if(row) row.style.display = "none";
      });

      // hide any related buttons inside action card (if they exist)
      if(actionCard){
        const btns = actionCard.querySelectorAll("button");
        btns.forEach(b=>{
          const t = (b.textContent || "").toLowerCase();
          if(t.includes("choose") || t.includes("summe") || t.includes("sum")) {
            b.style.display = "none";
          }
        });
      }
    }catch(_e){}
  }

// ===== Joker #3: Neu-Wurf (UI inject, additive) =====
  function ensureActionJoker3UI(){
    try{
      if(!actionCard) return;
      // (fixed) no self-recursion

      // Add status row if missing
      if(!document.getElementById("jokerRerollState")){
        const row = document.createElement("div");
        row.className = "kv";
        const left = document.createElement("span");
        left.textContent = "🔁 Neu‑Wurf";
        const right = document.createElement("span");
        right.id = "jokerRerollState";
        right.textContent = "–";
        row.appendChild(left);
        row.appendChild(right);

        const afterSpan = document.getElementById("jokerBarricadeState");
        const afterKv = afterSpan ? afterSpan.closest(".kv") : null;
        if(afterKv && afterKv.parentElement){
          afterKv.parentElement.insertBefore(row, afterKv.nextSibling);
        } else {
          actionCard.appendChild(row);
        }
      }

      // Add button if missing
      if(!document.getElementById("jokerRerollBtn")){
        const grid = actionCard.querySelector(".joker-grid");
        if(grid){
          const btn = document.createElement("button");
          btn.id = "jokerRerollBtn";
          btn.className = "joker-btn";
          btn.type = "button";
          btn.textContent = "🔁 Neu‑Wurf nutzen";
          grid.appendChild(btn);
        }
      }

      // refresh local ref
      jokerRerollBtn = document.getElementById("jokerRerollBtn");
    }catch(_e){}
  }
  ensureActionJoker3UI();

  // ===== Epic Joker UI (visual only, keeps IDs/handlers) =====
  function ensureEpicJokerUI(){
    try{
      if(!actionCard) return;

      // 1) CSS (only once)
      if(!document.getElementById("epicJokerStyles")){
        const st = document.createElement("style");
        st.id = "epicJokerStyles";
        st.textContent = `
          .epic-jokers{ margin-top:12px; padding:12px; border:1px solid rgba(255,255,255,.10); border-radius:16px;
            background: radial-gradient(900px 380px at 10% 0%, rgba(255,255,255,.06), rgba(255,255,255,.02) 60%, rgba(0,0,0,0) 100%);
            box-shadow: 0 18px 50px rgba(0,0,0,.25);
          }
          .epic-jokers .title{ display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:10px; }
          .epic-jokers .title b{ font-size:16px; letter-spacing:.2px; }
          .epic-jokers .title span{ font-size:12px; opacity:.7; }
          .epic-jokers .grid{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
          @media (min-width: 880px){ .epic-jokers .grid{ grid-template-columns:repeat(2,minmax(0,1fr)); } }
          .joker-tile{ position:relative; padding:10px; border-radius:16px; border:1px solid rgba(255,255,255,.10);
            background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
            box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
          }
          .joker-tile .hdr{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; }
          .joker-tile .name{ font-weight:800; font-size:14px; display:flex; align-items:center; gap:8px; }
          .joker-tile .badge{ min-width:38px; height:26px; padding:0 10px; border-radius:999px; display:inline-flex; align-items:center; justify-content:center;
            font-weight:900; letter-spacing:.3px; font-size:13px;
            background: rgba(255,255,255,.10); border:1px solid rgba(255,255,255,.14);
          }
          .joker-tile .origin{ font-size:12px; opacity:.75; min-height:16px; margin-bottom:8px; }
          .joker-tile .joker-btn{ width:100%; border-radius:14px; padding:12px 12px; font-weight:800; }
          .joker-tile.off .badge{ opacity:.55; }
          .joker-tile.off .origin{ opacity:.55; }
          .joker-tile.off .joker-btn{ opacity:.45; }
          /* Keep legacy kv rows readable but less dominant */
          #actionCard .kv{ opacity:.75; }
        `;
        document.head.appendChild(st);
      }

      // 2) Create container once
      let wrap = document.getElementById("epicJokers");
      if(!wrap){
        wrap = document.createElement("div");
        wrap.id = "epicJokers";
        wrap.className = "epic-jokers";

        const title = document.createElement("div");
        title.className = "title";
        const left = document.createElement("b");
        left.textContent = "Joker‑Arsenal";
        const right = document.createElement("span");
        right.textContent = "4 Powers • ein Klick = nutzen";
        title.appendChild(left);
        title.appendChild(right);

        const grid = document.createElement("div");
        grid.className = "grid";
        wrap.appendChild(title);
        wrap.appendChild(grid);

        // Insert at top of action card (after hint if present)
        const hint = document.getElementById("actionHint");
        const anchor = hint ? hint.parentElement : actionCard;
        if(anchor){
          // put after hint row if possible
          if(hint && hint.nextSibling) anchor.insertBefore(wrap, hint.nextSibling);
          else anchor.insertBefore(wrap, anchor.firstChild);
        } else {
          actionCard.insertBefore(wrap, actionCard.firstChild);
        }

        const mkTile = (key, icon, name, btnId, badgeId, originId) => {
          const tile = document.createElement("div");
          tile.className = "joker-tile";
          tile.dataset.jkey = key;

          const hdr = document.createElement("div");
          hdr.className = "hdr";

          const nm = document.createElement("div");
          nm.className = "name";
          nm.textContent = icon + " " + name;

          const badge = document.createElement("div");
          badge.className = "badge";
          badge.id = badgeId;
          badge.textContent = "0";

          hdr.appendChild(nm);
          hdr.appendChild(badge);

          const origin = document.createElement("div");
          origin.className = "origin";
          origin.id = originId;
          origin.textContent = "–";

          tile.appendChild(hdr);
          tile.appendChild(origin);

          // Move existing button into tile (keeps handlers/ids)
          let btn = document.getElementById(btnId);
          if(!btn){
            btn = document.createElement("button");
            btn.id = btnId;
            btn.className = "joker-btn";
            btn.type = "button";
            btn.textContent = icon + " " + name + " nutzen";
          }else{
            // ensure class for consistent styling
            btn.classList.add("joker-btn");
          }
          btn.textContent = icon + " " + name + " nutzen";
          tile.appendChild(btn);

          grid.appendChild(tile);
        };

        mkTile("allColors", "🌈", "Alle Farben", "jokerAllColorsBtn", "jokerAllColorsBadge", "jokerAllColorsOrigin");
        mkTile("barricade", "🧱", "Barikade",   "jokerBarricadeBtn", "jokerBarricadeBadge", "jokerBarricadeOrigin");
        mkTile("reroll",   "🔁", "Neu‑Wurf",   "jokerRerollBtn", "jokerRerollBadge", "jokerRerollOrigin");
        mkTile("double",   "🎲🎲", "Doppelwurf", "jokerDoubleBtn", "jokerDoubleBadge", "jokerDoubleOrigin");
      }

      // 3) De-emphasize old grid (kept for fallback/IDs)
      const oldGrid = actionCard.querySelector(".joker-grid");
      if(oldGrid) oldGrid.style.display = "none";
    }catch(_e){}
  }
  try{ ensureEpicJokerUI(); }catch(_e){}


  // ===== Epic Joker UI (visual only, NO gameplay changes) =====
  // Ziel: 4 klare Buttons (Name + Anzahl), weniger Text, nicht verwirrend.
  // WICHTIG: Wir bewegen nur DOM-Elemente & stylen sie. IDs/Clicks bleiben gleich.
  function ensureEpicJokerUI(){
    try{
      if(!actionCard) return;

      // 1) Inject styles once
      if(!document.getElementById("epicJokerStyles")){
        const st = document.createElement("style");
        st.id = "epicJokerStyles";
        st.textContent = `
          /* Epic Joker Grid */
          #actionCard .epicJokerGrid{
            display:grid;
            grid-template-columns: 1fr 1fr;
            gap:10px;
            margin-top:10px;
          }
          #actionCard .epicJokerBtn{
            position:relative;
            display:flex;
            align-items:center;
            justify-content:flex-start;
            gap:10px;
            padding:12px 12px;
            border-radius:14px;
            border:1px solid rgba(255,255,255,.10);
            background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
            box-shadow: 0 10px 22px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.08);
            cursor:pointer;
            user-select:none;
            transform: translateZ(0);
            transition: transform .12s ease, filter .12s ease, border-color .12s ease;
            min-height:54px;
            text-align:left;
            width:100%;
          }
          #actionCard .epicJokerBtn:hover{
            transform: translateY(-1px) scale(1.01);
            border-color: rgba(255,255,255,.18);
            filter: brightness(1.05);
          }
          #actionCard .epicJokerBtn:active{
            transform: translateY(0px) scale(.995);
            filter: brightness(.98);
          }
          #actionCard .epicJokerBtn .ejIcon{
            width:36px; height:36px;
            display:grid; place-items:center;
            border-radius:12px;
            background: radial-gradient(circle at 30% 20%, rgba(255,255,255,.18), rgba(255,255,255,.05) 60%);
            box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
            font-size:18px;
          }
          #actionCard .epicJokerBtn .ejName{
            font-weight:900;
            letter-spacing:.2px;
            font-size:14px;
            line-height:1.05;
          }
          #actionCard .epicJokerBtn .ejSub{
            display:block;
            opacity:.75;
            font-weight:700;
            font-size:11px;
            margin-top:2px;
          }
          #actionCard .epicJokerBtn .ejCount{
            margin-left:auto;
            font-weight:1000;
            padding:6px 10px;
            border-radius:999px;
            background: rgba(255,255,255,.08);
            border: 1px solid rgba(255,255,255,.12);
            box-shadow: inset 0 1px 0 rgba(255,255,255,.10);
            min-width:44px;
            text-align:center;
          }
          #actionCard .epicJokerBtn.ejEmpty{
            opacity:.45;
            filter: grayscale(.35);
          }

          /* Hide verbose legacy rows */
          #actionCard .kv.ejHideRow{ display:none !important; }
          /* If old .joker-grid exists, hide it (we re-home buttons) */
          #actionCard .joker-grid.ejOldGridHidden{ display:none !important; }
        `;
        document.head.appendChild(st);
      }

      // 2) Hide verbose state rows (we show counts on buttons instead)
      const hideIds = ["jokerAllColorsState","jokerBarricadeState","jokerRerollState","jokerDoubleState","jokerChooseState","jokerSumState"];
      hideIds.forEach(id=>{
        const el = document.getElementById(id);
        if(!el) return;
        const row = el.closest(".kv") || el.closest("div") || el.parentElement;
        if(row) row.classList.add("ejHideRow");
      });

      // 3) Create epic grid container once
      let grid = document.getElementById("epicJokerGrid");
      if(!grid){
        grid = document.createElement("div");
        grid.id = "epicJokerGrid";
        grid.className = "epicJokerGrid";
        // Insert near the bottom but above effects / below hint
        // Prefer: after actionHint
        if(actionHint && actionHint.parentElement){
          const parent = actionHint.parentElement;
          // try to place after hint text node
          parent.insertBefore(grid, actionHint.nextSibling);
        }else{
          actionCard.appendChild(grid);
        }
      }

      // 4) Ensure we have references to all 4 buttons
      const bAll = document.getElementById("jokerAllColorsBtn");
      const bBar = document.getElementById("jokerBarricadeBtn");
      const bRe  = document.getElementById("jokerRerollBtn");
      const bDo  = document.getElementById("jokerDoubleBtn");

      // If old grid exists, hide it to reduce clutter
      const oldGrid = actionCard.querySelector(".joker-grid");
      if(oldGrid) oldGrid.classList.add("ejOldGridHidden");

      function makeEpic(btn, key, icon, name, sub){
        if(!btn) return;
        btn.classList.add("epicJokerBtn");
        btn.dataset.jokerKey = key;

        // Build layout once
        if(!btn.querySelector(".ejIcon")){
          btn.innerHTML = `
            <span class="ejIcon">${icon}</span>
            <span class="ejText">
              <span class="ejName">${name}</span>
              <span class="ejSub">${sub||""}</span>
            </span>
            <span class="ejCount" id="ejCount_${key}">x0</span>
          `;
        }else{
          // ensure count id exists
          const c = btn.querySelector(".ejCount");
          if(c && !c.id) c.id = `ejCount_${key}`;
        }

        // Move into epic grid (keeps click listeners)
        if(btn.parentElement !== grid){
          grid.appendChild(btn);
        }
      }

      makeEpic(bAll, "allColors", "🌈", "Alle Farben", "alle Farben nutzbar");
      makeEpic(bBar, "barricade", "🧱", "Barikade", "Barikade versetzen");
      makeEpic(bRe,  "reroll",   "🔁", "Neu‑Wurf", "würfle nochmal");
      makeEpic(bDo,  "double",   "🎲", "Doppelwurf", "2 Würfel zählen");

    }catch(_e){}
  }
  // run once on load (safe if elements appear later)
  try{ ensureEpicJokerUI(); }catch(_e){}


// Color picker (A1.1)
  // NOTE: Manche index.html Versionen enthalten die Elemente nicht.
  // Damit du NUR game.js tauschen musst, erzeugen wir sie sicher per JS.
  let colorPickWrap = $("colorPick");
  let btnPickRed = $("pickRed");
  let btnPickBlue = $("pickBlue");
  let btnPickGreen = $("pickGreen");
  let btnPickYellow = $("pickYellow");

  // Server can tell which colors are currently supported online.
  // (Additiv: if missing, fallback to red/blue)
  let allowedColorsOnline = new Set(["red","blue"]);

  let _colorPickBound = false;

  function bindColorPickHandlers(){
    if(_colorPickBound) return;
    if(!btnPickRed || !btnPickBlue) return;
    _colorPickBound = true;
    btnPickRed.addEventListener("click", ()=> requestColor("red"));
    btnPickBlue.addEventListener("click", ()=> requestColor("blue"));
    if(btnPickGreen) btnPickGreen.addEventListener("click", ()=> requestColor("green"));
    if(btnPickYellow) btnPickYellow.addEventListener("click", ()=> requestColor("yellow"));
  }

  function ensureColorPickerUI(){
    try{
      if(colorPickWrap && btnPickRed && btnPickBlue) return;

      // Wir haengen den Farbwähler unter die Online-Buttons (Host/Beitreten/Trennen),
      // wenn moeglich.
      const anchor = leaveBtn?.parentElement || hostBtn?.parentElement || document.body;
      if(!anchor) return;

      // Wrapper
      colorPickWrap = document.createElement('div');
      colorPickWrap.id = 'colorPick';
      colorPickWrap.style.marginTop = '10px';
      colorPickWrap.style.display = 'block';

      const title = document.createElement('div');
      title.textContent = 'Farbe wählen (vor Spielstart)';
      title.style.fontWeight = '700';
      title.style.opacity = '0.9';
      title.style.marginBottom = '6px';

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.flexWrap = 'wrap';

      const mkBtn = (id, label) => {
        const b = document.createElement('button');
        b.id = id;
        b.className = 'btn';
        b.type = 'button';
        b.textContent = label;
        b.style.minWidth = '110px';
        return b;
      };

      btnPickRed = mkBtn('pickRed', '🔴 Rot');
      btnPickBlue = mkBtn('pickBlue', '🔵 Blau');
      // Falls du spaeter 3/4 Spieler aktivierst, sind die Buttons schon vorbereitet.
      btnPickGreen = mkBtn('pickGreen', '🟢 Grün');
      btnPickYellow = mkBtn('pickYellow', '🟡 Gelb');
      // Sichtbar lassen – online ggf. automatisch gesperrt ("bald").

      row.appendChild(btnPickRed);
      row.appendChild(btnPickBlue);
      row.appendChild(btnPickGreen);
      row.appendChild(btnPickYellow);

      const hint = document.createElement('div');
      hint.id = 'colorPickHint';
      hint.style.marginTop = '6px';
      hint.style.opacity = '0.75';
      hint.style.fontSize = '12px';
      hint.textContent = 'Du kannst die Wunschfarbe auch offline auswählen – sie wird beim Join gesendet.';

      colorPickWrap.appendChild(title);
      colorPickWrap.appendChild(row);
      colorPickWrap.appendChild(hint);

      // Einfügen: nach der Button-Reihe (Host/Beitreten/Trennen)
      // Einfügen: nach der Button-Reihe (Host/Beitreten/Trennen)
      // WICHTIG: anchor ist oft die Button-Reihe selbst (Flex). Dann würde der Picker unsichtbar "weggequetscht".
      // Deshalb: wenn anchor eine Zeile ist -> nach der Zeile einfügen.
      if(anchor && anchor.insertAdjacentElement){
        anchor.insertAdjacentElement('afterend', colorPickWrap);
      }else{
        anchor.appendChild(colorPickWrap);
      }

      // Handler erst NACH dem Erzeugen binden.
      // (Wenn Elemente im HTML vorhanden sind, bindet das spaeter auch.)
      bindColorPickHandlers();
    }catch(_e){}
  }

  // sofort versuchen, UI zu erzeugen (rein additiv)
  ensureColorPickerUI();
  // Wichtig: Manche HTML-Versionen haben #colorPick initial auf display:none.
  // Wenn man noch OFFLINE ist, kam frueher kein room_update -> UI blieb unsichtbar.
  // Daher initial einmal aktualisieren.
  try{ updateColorPickUI(); }catch(_e){}

  // Overlay
  const overlay = $("overlay");
  const overlayTitle = $("overlayTitle");
  const overlaySub = $("overlaySub");
  const overlayHint = $("overlayHint");
  const overlayOk = $("overlayOk");

  const CSS = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const COLORS = {
    node: CSS("--node"), stroke: CSS("--stroke"),
    edge: CSS("--edge"),
    goal: CSS("--goal"), run: CSS("--run"),
    red: CSS("--red"), blue: CSS("--blue"), green: CSS("--green"), yellow: CSS("--yellow"),
  };

  const DEFAULT_PLAYERS = ["red","blue","green","yellow"];
  const PLAYER_NAME = {red:"Rot", blue:"Blau", green:"Grün", yellow:"Gelb"};

  // Additiv: Namen pro Farbe aus der Lobby/Room-Roster (Server) – nur Anzeige, keine Regeln.
  let nameByColor = { red:null, blue:null, green:null, yellow:null };
  function labelForColor(c){
    const k = String(c||"").toLowerCase();
    const n = nameByColor && nameByColor[k];
    return (n && String(n).trim()) ? String(n).trim() : (PLAYER_NAME[k] || k || "–");
  }

  // Prevent showing the win overlay multiple times (snapshot + event)
  let winShown = false;
let awardsShown = false;

  let PLAYERS = ["red","blue"];
  function setPlayers(arg){
    if(Array.isArray(arg)){
      const order = {red:0, blue:1, green:2, yellow:3};
      const uniq=[], seen=new Set();
      for(const c of arg){
        if(!order.hasOwnProperty(c)) continue;
        if(seen.has(c)) continue;
        seen.add(c); uniq.push(c);
      }
      uniq.sort((a,b)=>order[a]-order[b]);
      PLAYERS = uniq.length ? uniq : ["red","blue"];
      return;
    }
    const n = Math.max(2, Math.min(4, Number(arg)||2));
    PLAYERS = DEFAULT_PLAYERS.slice(0, n);
  }

  // ===== Board =====
  let board=null, nodeById=new Map(), adj=new Map(), runNodes=new Set();
  let goalNodeId=null, startNodeId={red:null,blue:null,green:null,yellow:null};

  // Camera
  let dpr=1, view={x:40,y:40,s:1,_fittedOnce:false};

  const AUTO_CENTER_ALWAYS = true; // immer beim Start zentrieren (überschreibt gespeicherte Ansicht)
  let pointerMap=new Map(), isPanning=false, panStart=null;

  // ===== View persistence (Tablet-safe) =====
  const VIEW_KEY = "barikade_view_v2";
  let lastTapTs = 0;
  let lastTapPos = null;

  function saveView(){
    try{
      const data = { x:view.x, y:view.y, s:view.s, ts:Date.now() };
      localStorage.setItem(VIEW_KEY, JSON.stringify(data));
    }catch(_e){}
  }
  function loadView(){
    try{
      const raw = localStorage.getItem(VIEW_KEY);
      if(!raw) return false;
      const v = JSON.parse(raw);
      if(!v || typeof v!=="object") return false;
      if(typeof v.x!=="number" || typeof v.y!=="number" || typeof v.s!=="number") return false;
      // sanity
      if(!(v.s>0.05 && v.s<20)) return false;
      view.x = v.x; view.y = v.y; view.s = v.s;
      view._fittedOnce = true; // we have an explicit view
      return true;
    }catch(_e){ return false; }
  }
  function clearView(){
    try{ localStorage.removeItem(VIEW_KEY); }catch(_e){}
    view._fittedOnce = false;
  }

  // ===== Game state =====
  let phase = "need_roll";            // need_roll | need_move | placing_barricade | game_over
  let legalTargets = [];
  let placingChoices = [];

  function setPhase(p){ phase=p; if(state) state.phase=p; }
  function setPlacingChoices(arr){
    placingChoices = Array.isArray(arr) ? arr : [];
    if(state) state.placingChoices = [...placingChoices];
  }

  let selected=null;
  let actionBarricadeFrom = null; // Action-Modus B2: von welcher Barikade wird verschoben
  let actionBarricadeActive = false;
  let pendingBarricadePick = false;
  let legalMovesAll=[];
  let legalMovesByPiece=new Map();
  let state=null;

  // Helper: some older patches referenced a missing variable "isActionMode".
  // Keep it as a function so all callers can safely use it.
  function isActionMode(){
    try{ return String(state?.mode || "classic") === "action"; }catch(_e){}
    return false;
  }

  function clearLocalState(){
    state = null;
    legalMovesByPiece = new Map();
    // UI reset
    if(turnText) turnText.textContent = '–';
    if(turnDot) turnDot.className = 'dot';
    lastDiceFace = 0;
    if(diceEl) diceEl.setAttribute('data-face','0');
    updateStartButton();
    draw();
  }

  // ===== FX (safe, visual only) =====
  let lastDiceFace = 0;
  let _diceFlickerTimer = null;
  let _diceFlickerStop = null;

  let lastMoveFx = null;
  let moveGhostFx = null;

  // ===== Animation loop for move FX =====
  // Ohne requestAnimationFrame wird nur 1 Frame gezeichnet → wirkt wie Teleport.
  // Das Loop läuft nur solange FX aktiv sind (CPU-schonend) und sorgt auch dafür,
  // dass die Figur am Endfeld sofort sichtbar bleibt.
  let _raf = null;
  function _fxActive(now=performance.now()){
    try{
      if(lastMoveFx && lastMoveFx.pts && (now - lastMoveFx.t0) < 900) return true;
      if(moveGhostFx && moveGhostFx.pts && (now - moveGhostFx.t0) < (moveGhostFx.dur||0)) return true;
    }catch(_e){}
    return false;
  }
  function requestDrawLoop(){
    if(_raf!=null) return;
    _raf = requestAnimationFrame(function step(){
      _raf = null;
      if(!board || !state) return;
      draw();
      if(_fxActive()) requestDrawLoop();
    });
  }

  // Step-by-step move animation (visual override so it doesn't look like teleport)
  let moveAnim = null;   // { pieceId, color, nodes:[{x,y,id}], t0, stepMs, hop, totalMs }
  let animPieceId = null;
  let rafDrawId = 0;

  // ===== Online =====
  const SERVER_URL = "wss://spiel-server.onrender.com";
  if(serverLabel) serverLabel.textContent = SERVER_URL;

  let ws=null;
  // Start-Joker Setup: Host setzt beim Spielstart automatisch 2x pro Joker-Art (nur Barikade Action-Modus)
  let _pendingStartJokerInit = false;
  let _pendingStartStarterPick = false; // Host: Startspieler per Glücksrad
  let _pendingStartStarterColor = null;  // 'red'|'blue'|'green'|'yellow'

  let _pendingStartMode = "classic";
  
  function getLobbyJokerCount(){
    try{
      const keyRoom = "barikade_joker_count_" + normalizeRoomCode(roomCode || (roomCodeInp ? roomCodeInp.value : "") || localStorage.getItem("barikade_room") || "");
      const raw = localStorage.getItem(keyRoom) ?? localStorage.getItem("barikade_joker_count");
      const n = Number(raw);
      return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
    }catch(_e){ return null; }
  }
  function getStartJokerCounts(){
    const n = getLobbyJokerCount();
    if(!n) return null;
    return { allColors:n, barricade:n, reroll:n, double:n };
  }


  // Net watchdog: detects "silent" sockets that look connected but receive no messages
  let _lastNetMsgAt = Date.now();
  let _netWatchdogIv = null;
  let _netPingIv = null;
  let _netWatchdogArmed = false;
  let netMode="offline";
  let netCanStart=false;    // offline | host | client
  let roomCode="";
  let clientId="";
  let lastNetPlayers=[];
  let rosterById=new Map();
  let myColor=null;

  let reconnectTimer=null;
  let reconnectAttempt=0;
  let pendingIntents=[];

  // ===== Host Auto-Save (Browser) =====
  // Robust against Render sleep/restart: host stores last server snapshot in localStorage.
  function autosaveKey(){
    const rc = roomCode || (roomCodeInp ? normalizeRoomCode(roomCodeInp.value) : "");
    return `barikade_host_autosave_${rc || "room"}`;
  }
  function setAutoSaveInfo(text){
    if(!autoSaveInfo) return;
    autoSaveInfo.style.display = text ? "block" : "none";
    autoSaveInfo.textContent = text ? `Auto‑Save: ${text}` : "";
  }
  function writeHostAutosave(serverState){
    // only host writes autosave
    if(netMode === "offline" || !isMeHost()) return;
    if(!serverState || typeof serverState !== "object") return;
    try{
      const payload = { room: roomCode || "", ts: Date.now(), state: serverState };
      localStorage.setItem(autosaveKey(), JSON.stringify(payload));
      const t = new Date(payload.ts);
      const hh = String(t.getHours()).padStart(2,'0');
      const mm = String(t.getMinutes()).padStart(2,'0');
      const ss = String(t.getSeconds()).padStart(2,'0');
      setAutoSaveInfo(`${hh}:${mm}:${ss}`);
    }catch(_e){ /* ignore */ }
  }
  function readHostAutosave(){
    try{
      const raw = localStorage.getItem(autosaveKey());
      if(!raw) return null;
      const v = JSON.parse(raw);
      if(!v || typeof v !== "object") return null;
      if(!v.state || typeof v.state !== "object") return null;
      return v;
    }catch(_e){ return null; }
  }

  function randId(len=10){
    const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s=""; for(let i=0;i<len;i++) s += chars[Math.floor(Math.random()*chars.length)];
    return s;
  }
  function normalizeRoomCode(s){
    return (s||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,10);
  }
  function safeJsonParse(s){ try{ return JSON.parse(s); }catch(_e){ return null; } }

  // ===== Wunschfarbe (Lobby) =====
  // Additiv: beeinflusst Reconnect/Save NICHT. Nur ein Wunsch vor Spielstart.
  function reqColorKey(){
    const rc = roomCode || (roomCodeInp ? normalizeRoomCode(roomCodeInp.value) : "");
    return "barikade_requested_color_" + (rc || "room");
  }
  function getRequestedColor(){
    try{
      const v = localStorage.getItem(reqColorKey()) || localStorage.getItem("barikade_requested_color") || "";
      const c = String(v).toLowerCase().trim();
      return (c==="red"||c==="blue"||c==="green"||c==="yellow") ? c : null;
    }catch(_e){ return null; }
  }
  function setRequestedColor(c){
    const v = (c==="red"||c==="blue"||c==="green"||c==="yellow") ? c : "";
    try{
      if(v) localStorage.setItem(reqColorKey(), v); else localStorage.removeItem(reqColorKey());
      // global fallback for old sessions
      if(v) localStorage.setItem("barikade_requested_color", v);
    }catch(_e){}
  }

  function isLobbyPhase(){
    // Server-Game nutzt state.started
    return !(state && state.started);
  }

  function usedColorsSet(){
    const used = new Set();
    for(const pl of (lastNetPlayers||[])){
      if(pl && pl.color) used.add(String(pl.color).toLowerCase());
    }
    return used;
  }

  function updateColorPickUI(){
    // Falls UI fehlt (alte index.html), nacherzeugen.
    if(!colorPickWrap || !btnPickRed || !btnPickBlue){
      ensureColorPickerUI();
    }
    if(!colorPickWrap) return;

    // Farbauswahl nur vor Spielstart (Lobby). Auch offline anzeigen,
    // damit man die Wunschfarbe schon VOR dem Verbinden festlegen kann.
    const show = isLobbyPhase();
    colorPickWrap.style.display = show ? "block" : "none";
    if(!show) return;

    const used = usedColorsSet();
    const want = getRequestedColor();

    // Online-Server unterstuetzt aktuell nur Rot/Blau (server.js: ALLOWED_COLORS).
    // Gruen/Gelb bleiben sichtbar (falls du spaeter 3/4 Spieler aktivierst),
    // sind aber online gesperrt, damit man keinen Server-Fehler provoziert.
    const onlineLimited = (netMode !== "offline");
    const onlineAllowed = allowedColorsOnline || new Set(["red","blue"]);

    function configBtn(btn, color){
      if(!btn) return;
      const c = String(color).toLowerCase();
      const mine = (myColor === c);
      const takenByOther = used.has(c) && !mine;

      const supportedOnline = !onlineLimited || onlineAllowed.has(c);

      btn.disabled = takenByOther || !supportedOnline;
      btn.style.opacity = (takenByOther || !supportedOnline) ? "0.4" : "1";

      // active mark: current wish or my assigned color
      const active = (want === c) || mine;
      btn.classList.toggle("active", !!active);

      // label add: show lock
      const base = (c==="red") ? "🔴 Rot" : (c==="blue") ? "🔵 Blau" : (c==="green") ? "🟢 Grün" : "🟡 Gelb";
      if(!supportedOnline){
        btn.textContent = base + " (bald)";
      } else {
        btn.textContent = takenByOther ? (base + " 🔒") : base;
      }
    }

    configBtn(btnPickRed, "red");
    configBtn(btnPickBlue, "blue");
    configBtn(btnPickGreen, "green");
    configBtn(btnPickYellow, "yellow");
  }


  // ===== Action-Mode UI (J1: nur anzeigen, NICHT eingreifen) =====
  function updateActionUI_J1(){
    try{
      if(!actionCard) return;
      const mode = (state && state.mode) ? String(state.mode) : "classic";
      const show = (mode === "action") || (!!(actionModeToggle && actionModeToggle.checked));
      actionCard.style.display = show ? "block" : "none";
      if(!show) return;

      const ac = (state && state.action) ? state.action : null;
      const my = myColor || (state ? state.currentPlayer : null);

      // Hint text
      if(actionHint){
        actionHint.textContent = (mode === "action") ? (ac ? "Joker-Status (Anzeige):" : "Action-Modus aktiv (Status lädt…)") : ((actionModeToggle && actionModeToggle.checked) ? "Action-Modus aktiv (warte auf Server…)" : (ac ? "Joker-Status (Anzeige):" : "Action-Modus aktiv (Status lädt…)"));
      }

      const js = ac && ac.jokersByColor ? ac.jokersByColor : null;
      const eff = ac && ac.effects ? ac.effects : null;

      function jokerCountVal(v){
        if(v===true) return 1;
        if(v===false || v==null) return 0;
        // allow numeric counts
        if(typeof v==="number" && isFinite(v)) return Math.max(0, Math.floor(v));
        // allow object form: {count:3} or {n:3}
        if(typeof v==="object"){
          const c = (v.count!=null) ? v.count : (v.n!=null ? v.n : null);
          if(typeof c==="number" && isFinite(c)) return Math.max(0, Math.floor(c));
        }
        return 0;
      }

      function colorLabel(c){
        if(!c) return "";
        const key = String(c);
        return (typeof PLAYER_NAME==="object" && PLAYER_NAME && PLAYER_NAME[key]) ? PLAYER_NAME[key] : key;
      }

      // Prefer server v2 structure: ac.jokersOwned[ownerColor] = [{type,color(origin),...}, ...]
      function ownedSummary(typeKey){
        try{
          if(!ac || !ac.jokersOwned || !my) return null;
          const arr = ac.jokersOwned[my];
          if(!Array.isArray(arr)) return null;
          const by = {};
          let total = 0;
          for(const j of arr){
            if(String(j?.type) !== String(typeKey)) continue;
            total++;
            const oc = String(j?.color || "");
            if(oc) by[oc] = (by[oc]||0)+1;
          }
          return { total, by };
        }catch(_e){ return null; }
      }

      function fmtCount(total){
        if(total<=0) return "verbraucht";
        return `bereit (x${total})`;
      }

      function fmtWithOrigin(typeKey, legacyVal){
        const sum = ownedSummary(typeKey);
        if(sum){
          const base = fmtCount(sum.total);
          if(sum.total<=0) return base;
          const keys = Object.keys(sum.by||{}).filter(k => sum.by[k]>0);
          if(!keys.length) return base;
          // show origins sorted
          keys.sort();
          const originStr = keys.map(k => `${colorLabel(k)}×${sum.by[k]}`).join(", ");
          return `${base} (${originStr})`;
        }
        // fallback to legacy counts: show owner color label
        const c = jokerCountVal(legacyVal);
        const base = fmtCount(c);
        if(c<=0) return base;
        return my ? `${base} (${colorLabel(my)})` : base;
      }

      
      // Epic Joker Buttons: counts directly on buttons (visual only)
      try{ ensureEpicJokerUI(); }catch(_e){}
      function setEpicBadge(key, cnt){
        try{
          const el = document.getElementById(`ejCount_${key}`);
          const btn = actionCard ? actionCard.querySelector(`#joker${key==="allColors"?"AllColors":key==="barricade"?"Barricade":key==="reroll"?"Reroll":"Double"}Btn`) : null;
          if(el) el.textContent = `x${Math.max(0, cnt|0)}`;
          // mark empty visually, but DO NOT disable (no gameplay change)
          const b = document.querySelector(`#joker${key==="allColors"?"AllColors":key==="barricade"?"Barricade":key==="reroll"?"Reroll":"Double"}Btn`);
          if(b){
            b.classList.toggle("ejEmpty", !(cnt>0));
            // add tooltip with full legacy/origin info for power users (no clutter)
            try{
              const legacyVal = js && my ? js[my]?.[key] : null;
              b.title = fmtWithOrigin(key, legacyVal);
            }catch(_e){}
          }
        }catch(_e){}
      }

      function countFor(typeKey){
        const sum = ownedSummary(typeKey);
        if(sum) return sum.total||0;
        // fallback to legacy counts in jokersByColor
        const legacyVal = js && my ? js[my]?.[typeKey] : null;
        return jokerCountVal(legacyVal);
      }

      setEpicBadge("allColors", countFor("allColors"));
      setEpicBadge("barricade", countFor("barricade"));
      setEpicBadge("reroll", countFor("reroll"));
      setEpicBadge("double", countFor("double"));

if(jokerChooseState) jokerChooseState.textContent = fmtWithOrigin("choose", js && my ? js[my]?.choose : null);
      if(jokerSumState) jokerSumState.textContent = fmtWithOrigin("sum", js && my ? js[my]?.sum : null);
      if(jokerAllColorsState) jokerAllColorsState.textContent = fmtWithOrigin("allColors", js && my ? js[my]?.allColors : null);
      if(jokerBarricadeState) jokerBarricadeState.textContent = fmtWithOrigin("barricade", js && my ? js[my]?.barricade : null);
      if(jokerRerollState) jokerRerollState.textContent = fmtWithOrigin("reroll", js && my ? js[my]?.reroll : null);
      if(jokerDoubleState) jokerDoubleState.textContent = fmtWithOrigin("double", js && my ? js[my]?.double : null);
      const rrEl = document.getElementById("jokerRerollState");
      if(rrEl) rrEl.textContent = fmtWithOrigin("reroll", js && my ? js[my]?.reroll : null);

      // --- Epic Joker tiles (visual, no logic change) ---
      function setEpic(typeKey, legacyVal, badgeId, originId, tileKey){
        try{
          const badge = document.getElementById(badgeId);
          const origin = document.getElementById(originId);
          const tile = actionCard ? actionCard.querySelector('.joker-tile[data-jkey="'+tileKey+'"]') : null;

          const sum = ownedSummary(typeKey);
          let total = 0;
          let originStr = "–";
          if(sum){
            total = sum.total || 0;
            const keys = Object.keys(sum.by||{}).filter(k => (sum.by||{})[k]>0).sort();
            originStr = keys.length ? keys.map(k => `${colorLabel(k)}×${sum.by[k]}`).join(", ") : "–";
          }else{
            total = jokerCountVal(legacyVal);
            originStr = (total>0 && my) ? colorLabel(my) : "–";
          }

          if(badge) badge.textContent = String(total);
          if(origin) origin.textContent = originStr;

          if(tile){
            tile.classList.toggle("off", !(total>0));
          }
        }catch(_e){}
      }

      setEpic("allColors", js && my ? js[my]?.allColors : null, "jokerAllColorsBadge", "jokerAllColorsOrigin", "allColors");
      setEpic("barricade", js && my ? js[my]?.barricade : null, "jokerBarricadeBadge", "jokerBarricadeOrigin", "barricade");
      setEpic("reroll",   js && my ? js[my]?.reroll   : null, "jokerRerollBadge",   "jokerRerollOrigin",   "reroll");
      setEpic("double",   js && my ? js[my]?.double   : null, "jokerDoubleBadge",   "jokerDoubleOrigin",   "double");


if(actionEffectsState){
        if(!eff){ actionEffectsState.textContent = "–"; }
        else{
          const parts = [];
          if(eff.allColorsBy) parts.push("Alle Farben aktiv");
          if(eff.doubleRoll && eff.doubleRoll.kind) parts.push("Doppelwurf: " + eff.doubleRoll.kind);
          if(eff.barricadeBy) parts.push("Barikade-Joker aktiv");
          actionEffectsState.textContent = parts.length ? parts.join(" • ") : "keine Effekte";
        }
      }
    }catch(_e){}
  }


  function setNetStatus(text, good){
    if(!netStatus) return;
    netStatus.textContent = text;
    netStatus.style.color = good ? "var(--green)" : "var(--muted)";
  }

  function wsSend(obj){
    if(!ws || ws.readyState!==1) return false;
    try{ ws.send(JSON.stringify(obj)); return true; }catch(_e){ return false; }
  }

  // Host-only: ensure each player starts with 2 jokers of the 4 Barikade types (Action-Modus).
  // Additiv und sicher: wird nur 1x direkt nach Start ausgeführt, danach nie wieder.
  function maybeInitStartJokers(remoteState){
    try{
      if(!_pendingStartJokerInit) return;
      if(netMode !== "host") { _pendingStartJokerInit = false; return; }
      if(_pendingStartMode !== "action") { _pendingStartJokerInit = false; return; }
      if(!remoteState || typeof remoteState !== "object") return;

      const startCounts = getStartJokerCounts();
      if(!startCounts){
        _pendingStartJokerInit = false;
        toast("Host muss in der Lobby 1 bis 5 Joker wählen");
        return;
      }

      // Clone so we never mutate incoming objects unexpectedly
      const st = JSON.parse(JSON.stringify(remoteState));

      // Ensure action container
      if(!st.action || typeof st.action !== "object") st.action = {};
      st.mode = "action";

      // Determine participating colors
      const colors = Array.isArray(st.players) && st.players.length ? st.players.slice()
                   : (Array.isArray(st.activeColors) && st.activeColors.length ? st.activeColors.slice()
                   : (Array.isArray(PLAYERS) && PLAYERS.length ? PLAYERS.slice() : ["red","blue"]));

      const uniq = [];
      const seen = new Set();
      for(const c of colors){
        const cc = String(c||"").toLowerCase().trim();
        if(!cc || seen.has(cc)) continue;
        seen.add(cc);
        uniq.push(cc);
      }
      if(!uniq.length) uniq.push("red","blue");

      // 1) Count-based structure (legacy / simple)
      if(!st.action.jokersByColor || typeof st.action.jokersByColor !== "object") st.action.jokersByColor = {};
      for(const c of uniq){
        const cur = (st.action.jokersByColor[c] && typeof st.action.jokersByColor[c] === "object") ? st.action.jokersByColor[c] : {};
        st.action.jokersByColor[c] = {
          ...cur,
          allColors: Math.max(Number(cur.allColors||0), startCounts.allColors),
          barricade: Math.max(Number(cur.barricade||0), startCounts.barricade),
          reroll: Math.max(Number(cur.reroll||0), startCounts.reroll),
          double: Math.max(Number(cur.double||0), startCounts.double),
        };
      }

      // 2) Owned-list structure (preferred by UI + some server builds)
      //    st.action.jokersOwned[ownerColor] = [{type:"allColors", color:"red"}, ...]
      if(!st.action.jokersOwned || typeof st.action.jokersOwned !== "object") st.action.jokersOwned = {};
      const TYPES = ["allColors","barricade","reroll","double"];
      for(const owner of uniq){
        const arr = Array.isArray(st.action.jokersOwned[owner]) ? st.action.jokersOwned[owner].slice() : [];
        // Count existing
        const counts = {allColors:0,barricade:0,reroll:0,double:0};
        for(const j of arr){
          const t = String(j && j.type || "");
          if(counts.hasOwnProperty(t)) counts[t] += 1;
        }
        // Add missing up to target (do NOT remove extras, just ensure at least 2)
        for(const t of TYPES){
          const target = startCounts[t] || 1;
          while((counts[t]||0) < target){
            arr.push({ type: t, color: owner });
            counts[t] += 1;
          }
        }
        st.action.jokersOwned[owner] = arr;
      }

      _pendingStartJokerInit = false;

      // Import back to server (host only)
      wsSend({ type:"import_state", state: st, ts: Date.now(), reason:"init_start_jokers_selected" });
      toast("Start-Joker gesetzt");
    }catch(_e){
      // keep pending so we can try again on next snapshot
    }
  }


  function setNetPlayers(list){
    lastNetPlayers = Array.isArray(list) ? list : [];
    rosterById = new Map();
    for(const p of lastNetPlayers){ if(p && p.id) rosterById.set(p.id, p); }

    // Build display names by color (server roster includes p.name + p.color)
    nameByColor = { red:null, blue:null, green:null, yellow:null };
    for(const p of lastNetPlayers){
      const col = (p && p.color) ? String(p.color).toLowerCase() : "";
      const nm  = (p && p.name) ? String(p.name).trim() : "";
      if(col && nm && nameByColor[col] == null) nameByColor[col] = nm;
    }

    const me = rosterById.get(clientId);
    myColor = (me && me.color) ? me.color : null;

    if(myColorEl){
      // Meine Farbe bleibt farbbasiert, damit es klar ist (Name steht oben im Turn-Label).
      myColorEl.textContent = myColor ? PLAYER_NAME[myColor] : "–";
      myColorEl.style.color = myColor ? COLORS[myColor] : "var(--muted)";
    updateStartButton();
    }
    updateColorPickUI();
    updateActionUI_J1();
    updateActionUI_J1();

    // Host: keep state players in sync with chosen colors
    if(netMode==="host" && state){
      const active = getActiveColors();
      const prev = Array.isArray(state.players) ? state.players : [];
      const same = prev.length===active.length && prev.every((c,i)=>c===active[i]);
      if(!same){
        setPlayers(active);
        state.players = [...PLAYERS];
        state.pieces = state.pieces || {};
        for(const c of PLAYERS){
          if(!state.pieces[c]) state.pieces[c] = Array.from({length:5},()=>({pos:"house"}));
        }
        if(!state.players.includes(state.currentPlayer)){
          state.currentPlayer = state.players[0];
          setPhase("need_roll");
          state.dice=null;
        }
        broadcastState("snapshot");
      }
    }

    if(netPlayersEl){
      if(!lastNetPlayers.length){ netPlayersEl.textContent="–"; return; }
      const parts = lastNetPlayers.map(p=>{
        const name = p.name || p.id || "Spieler";
        const role = p.role ? `(${p.role})` : "";
        const col  = p.color ? `· ${PLAYER_NAME[p.color]}` : "";
        const con  = (p.connected===false) ? " ✖" : " ✔";
        return `${name} ${role} ${col}${con}`;
      });
      netPlayersEl.textContent = parts.join(" · ");
    }

    // host-only controls visibility
    updateHostToolsUI();
  }

  function updateStartButton(){
    if(!startBtn) return;
    const me = rosterById.get(clientId);
    const amHost = !!(me && me.isHost);
    const hasState = !!(state && state.started);
    startBtn.disabled = !(amHost && netCanStart && !hasState);
    startBtn.textContent = hasState ? 'Spiel läuft' : 'Spiel starten';
  }

  function isMeHost(){
    const me = rosterById.get(clientId);
    return !!(me && me.isHost);
  }

  // Host-only UI block (Save/Load)
  function updateHostToolsUI(){
    const show = (netMode !== "offline") && isMeHost();
    if(hostTools) hostTools.style.display = show ? "flex" : "none";
    if(autoSaveInfo) autoSaveInfo.style.display = show ? "block" : "none";
    if(restoreBtn){
      const has = !!readHostAutosave();
      restoreBtn.disabled = !(show && has);
      restoreBtn.style.opacity = (show && has) ? "1" : "0.6";
    }
  }

  function scheduleReconnect(){
    if(reconnectTimer) return;
    reconnectAttempt++;
    const delay = Math.min(12000, 600 * Math.pow(1.6, reconnectAttempt));
    setNetStatus(`Reconnect in ${Math.round(delay/1000)}s…`, false);
    reconnectTimer = setTimeout(()=>{ reconnectTimer=null; connectWS(); }, delay);
  }
  function stopReconnect(){
    if(reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer=null; }
    reconnectAttempt = 0;
  }

  function connectWS(){
    if(!roomCode) return;
    if(ws && (ws.readyState===0 || ws.readyState===1)) return;

    setNetStatus("Verbinden…", false);
    
    view._fittedOnce = false;
try{ ws = new WebSocket(SERVER_URL); }
    catch(_e){ setNetStatus("WebSocket nicht möglich", false); scheduleReconnect(); return; }

    ws.onopen = () => {
      stopReconnect();
      _lastNetMsgAt = Date.now();
      // Start watchdog only once per connection lifecycle
      try{ if(_netWatchdogIv) clearInterval(_netWatchdogIv); }catch(_e){}
      try{ if(_netPingIv) clearInterval(_netPingIv); }catch(_e){}
      _netWatchdogIv = setInterval(()=>{
        if(netMode === "offline") return;
        if(!ws || ws.readyState!==1) return;
        const age = Date.now() - (_lastNetMsgAt||0);
        if(age > 12000){
          // Force reconnect: socket is "silent" (common on some WLANs)
          try{ ws.close(); }catch(_e){}
        }
      }, 2000);
      // Lightweight ping to keep some routers/proxies happy (server may ignore)
      _netPingIv = setInterval(()=>{
        if(!ws || ws.readyState!==1) return;
        try{ ws.send(JSON.stringify({type:"ping", ts:Date.now()})); }catch(_e){}
      }, 5000);
      hideNetBanner();
      setNetStatus("Verbunden – join…", true);

      const sessionToken = getSessionToken();
      const savedName = (()=>{ try{ return (localStorage.getItem('barikade_playerName')||'').trim(); }catch(_e){ return ''; } })();
      wsSend({
        type: "join",
        room: roomCode,
        name: savedName || (netMode === "host" ? "Host" : "Client"),
        asHost: (netMode === "host"),
        sessionToken,
        requestedColor: getRequestedColor(),
        ts: Date.now()
      });
    };

    ws.onmessage = (ev) => {
      _lastNetMsgAt = Date.now();
      const msg = (typeof ev.data==="string") ? safeJsonParse(ev.data) : null;
      if(!msg) return;
      const type = msg.type;

      if(type==="hello"){
        if(msg.clientId) clientId = msg.clientId;
        updateEmojiUI();
        return;
      }

      if(type==="emoji_event"){
        try{ showEmojiOverlay(msg.name || msg.playerName || "Spieler", msg.emoji || msg.emojiKey || msg.icon || "😀"); }catch(_e){}
        return;
      }
if(type==="start_spin"){
  try{
    const cols = Array.isArray(msg.activeColors) && msg.activeColors.length ? msg.activeColors.map(c=>String(c||"").toLowerCase().trim()).filter(Boolean) : getActiveColors();
    const dur = Number(msg.durationMs || 4200) || 4200;
    const winner = String(msg.starterColor || "").toLowerCase().trim();
    // Run the same wheel animation on ALL clients, but with the server-chosen winner.
    startWheelSpin(cols, dur, winner).then(()=>{}).catch(()=>{});

// IMPORTANT: In the current server protocol, 'start_request' only triggers the spin.
// The actual game state is created ONLY after the host sends a follow-up {type:'start'}.
// To make this reliable (mobile timers, focus changes, etc.), auto-send 'start'
// from the host once the spin duration has elapsed.
try{
  if(netMode === "host"){
    // Guard against double-starts / repeated spins.
    window.__pendingHostStartAfterSpin = {
      at: Date.now(),
      dur,
      starterColor: winner,
      mode: String(msg.mode || _pendingStartMode || (actionModeToggle && actionModeToggle.checked ? "action" : "classic") || "classic")
    };
    window.setTimeout(()=>{
      try{
        // If we already started meanwhile, do nothing.
        if(state && state.started) return;
        if(!ws || ws.readyState!==1) return;
        const p = window.__pendingHostStartAfterSpin;
        if(!p) return;
        // Send the definitive start to the server (server is truth, will validate again).
        wsSend({ type:"start", mode: p.mode, ts: Date.now(), starterColor: p.starterColor, startJokers: (getStartJokerCounts() || undefined) });
      }catch(_e){}
    }, dur + 60);
  }
}catch(_e){}
    // While spinning, disable start button to avoid double actions.
    try{ if(startBtn) startBtn.disabled = true; }catch(_e){}
    window.setTimeout(()=>{ try{ updateStartButton(); }catch(_e){} }, dur + 1200);
  }catch(_e){}
  return;
}

      if(type==="room_update"){
        if(Array.isArray(msg.players)) setNetPlayers(msg.players);
        if(Array.isArray(msg.allowedColors)){
          const s = new Set();
          for(const c of msg.allowedColors){
            const cc = String(c||"").toLowerCase().trim();
            if(cc) s.add(cc);
          }
          if(s.size) allowedColorsOnline = s;
        }
        netCanStart = !!msg.canStart;
      if (msg.jokerAwardMode) netJokerAwardMode = msg.jokerAwardMode;
        updateStartButton();
        updateEmojiUI();
        return;
      }

      if(type==="forfeit"){
        try{
          if(msg.state) applyRemoteState(msg.state);
          const by = String(msg.by||"").toUpperCase();
          const w = String(msg.winnerColor || msg.winner || (msg.state && msg.state.winnerColor) || "").toUpperCase();
          toast(`${by} hat aufgegeben! Gewinner: ${w}`);
        }catch(_e){}
        return;
      }
      if(type==="snapshot" || type==="started" || type==="place_barricade"){
        if(msg.state){
          applyRemoteState(msg.state);
          maybeInitStartStarter(msg.state);
          maybeInitStartStarter(msg.state);
          maybeInitStartJokers(msg.state);
          writeHostAutosave(msg.state);
        }
        updateEmojiUI();
        if(Array.isArray(msg.players)) setNetPlayers(msg.players);
        if(Array.isArray(msg.wheel) && msg.wheel.length) enqueueWheel(msg.wheel);
        return;
      }
      if(type==="roll"){
        // (108/26) small suspense + particles
        if(typeof msg.value==="number") setDiceFaceAnimated(msg.value);
        if(msg.state){
          applyRemoteState(msg.state);
          maybeInitStartJokers(msg.state);
          writeHostAutosave(msg.state);
        }
        updateEmojiUI();
        if(Array.isArray(msg.players)) setNetPlayers(msg.players);
        if(Array.isArray(msg.wheel) && msg.wheel.length) enqueueWheel(msg.wheel);
        return;
      }
      if(type==="move"){
        // (7/8/109) animate path + destination glow
        if(msg.action) queueMoveFx(msg.action);
        if(msg.state){
          applyRemoteState(msg.state);
          maybeInitStartJokers(msg.state);
          writeHostAutosave(msg.state);
        }
        updateEmojiUI();
        if(Array.isArray(msg.players)) setNetPlayers(msg.players);
        if(Array.isArray(msg.wheel) && msg.wheel.length) enqueueWheel(msg.wheel);
        return;
      }

      if(type==="game_over"){
        const wc = (msg.winnerColor ? String(msg.winnerColor) : null);
        if(state){
          state.phase = 'game_over';
          state.winner = wc;
        }
        if(wc && !winShown){
          winShown = true;
          showEpicWin(wc);
        }
        updateTurnUI();
        updateEmojiUI();
        return;
      }

      // Host Save/Load: server sends back a JSON snapshot for download
      if(type==="export_state"){
        pendingSaveExport = false;
        const ok = downloadJSON(msg.state ?? null, `barikade_save_${roomCode || "room"}.json`);
        toast(ok ? "Save heruntergeladen" : "Save fehlgeschlagen");
        return;
      }

      if(type==="error"){
        const code = msg.code || "";
        const message = msg.message || "Server-Fehler";
        // If server has no running game state (e.g. after restart), unlock manual start.
        if(code==="NO_STATE" || /Spiel nicht gestartet/i.test(message)){
          debugLog("[server:NO_STATE]", code, message);
          // WICHTIG: lokalen Snapshot NICHT löschen – sonst kann man nach Reconnect nichts mehr sichern.
          // Falls gerade ein Save angefordert wurde, mache stattdessen einen Offline-Save aus dem letzten Snapshot.
          if(pendingSaveExport && state){
            pendingSaveExport = false;
            const st = serializeState();
            const ok = downloadJSON(st, `barikade_save_offline_${roomCode || "room"}.json`);
            toast(ok ? "Server ohne Spielstand – Offline-Save heruntergeladen" : "Offline-Save fehlgeschlagen");
            return;
          }
          pendingSaveExport = false;
          // UI-Hinweis statt Reset:
          const hasAuto = !!readHostAutosave();
          if(isMeHost() && hasAuto){
            showNetBanner("Server war offline/sleep (kein Spielstand). Klicke als Host auf \"Restore\" (Auto‑Save) oder \"Load\" (JSON).");
          }else{
            showNetBanner("Kein Spielstand am Server. Nutze Load (JSON) oder starte neu.");
          }
          updateHostToolsUI();
          return;
        }
        toast(message);
        return;
      }
      if(type==="pong") return;
    };

    ws.onerror = () => { setNetStatus("Fehler – Reconnect…", false); showNetBanner("Verbindungsfehler – Reconnect läuft…"); };
    ws.onclose = () => {
      updateEmojiUI();
      try{ if(_netWatchdogIv) clearInterval(_netWatchdogIv); }catch(_e){}
      try{ if(_netPingIv) clearInterval(_netPingIv); }catch(_e){}
      _netWatchdogIv=null; _netPingIv=null;
      setNetStatus("Getrennt – Reconnect…", false);
      showNetBanner("Verbindung getrennt – Reconnect läuft…");
      if(netMode!=="offline") scheduleReconnect();
    };
  }

  function disconnectWS(){
    stopReconnect();
    try{ if(_netWatchdogIv) clearInterval(_netWatchdogIv); }catch(_e){}
    try{ if(_netPingIv) clearInterval(_netPingIv); }catch(_e){}
    _netWatchdogIv=null; _netPingIv=null;
    if(ws){
      try{ ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null; ws.close(); }catch(_e){}
      ws=null;
    }
    setNetStatus("Offline", false);
    hideNetBanner();
    updateHostToolsUI();
  }

  function saveSession(){
    try{
      localStorage.setItem("barikade_room", roomCode||"");
      localStorage.setItem("barikade_mode", netMode||"offline");
      localStorage.setItem("barikade_clientId", clientId||"");
    }catch(_e){}
  }
  function loadSession(){
    try{
      return {
        r: localStorage.getItem("barikade_room")||"",
        m: localStorage.getItem("barikade_mode")||"offline",
        id: localStorage.getItem("barikade_clientId")||""
      };
    }catch(_e){ return {r:"", m:"offline", id:""}; }
  }

  // Server uses sessionToken to reconnect a "slot" (same color) after refresh.
  function getSessionToken(){
    try{
      let t = localStorage.getItem("barikade_sessionToken") || "";
      if(!t){
        t = "S-" + randId(16);
        localStorage.setItem("barikade_sessionToken", t);
      }
      return t;
    }catch(_e){
      return "S-" + randId(16);
    }
  }

  function chooseColor(color){
    // Store requested color for this room (used on join + reconnect)
    try{
      if(currentRoom){
        localStorage.setItem("barikade_reqColor_"+currentRoom, String(color));
      }
    }catch(_e){}

    // If online & already connected, ask server immediately
    if(netMode==="online" && ws && ws.readyState===1){
      wsSend({type:"request_color", room: currentRoom, sessionToken: sessionToken, color: String(color)});
    } else {
      // If not connected yet, we reconnect so the next join includes requestedColor
      toast("Farbe gespeichert. Beim Beitreten/Reconnect wird sie angefragt.");
    }
  }

  function getActiveColors(){
    if(netMode==="offline") return [...PLAYERS];
    const order=["red","blue","green","yellow"];
    const colors=[], seen=new Set();
    for(const p of lastNetPlayers){
      if(!p || !p.color) continue;
      if(seen.has(p.color)) continue;
      seen.add(p.color);
      colors.push(p.color);
    }
    colors.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
    return colors.length>=2 ? colors : ["red","blue"];
  }

  // ===== State sync =====
  function applyRemoteState(remote){
    const st = (typeof remote==="string") ? safeJsonParse(remote) : remote;
    if(!st || typeof st!=="object") return;

    // --- Server-state adapter (serverfinal protocol) ---
    // server state: {turnColor, phase, rolled, pieces:[{id,color,posKind,houseId,nodeId}], barricades:[...], goal}
    if(st.turnColor && Array.isArray(st.pieces) && Array.isArray(st.barricades)){
      const server = st;
      // In Online-Mode we ALWAYS render all 4 Farben (auch wenn nicht gewählt),
      // damit Gelb/Grün im Haus sichtbar bleiben.
      const players = ["red","blue","green","yellow"];
      setPlayers(players);
      const piecesByColor = {red:[], blue:[], green:[], yellow:[]};
      // ensure 5 slots per color
      for(const c of players) piecesByColor[c] = Array.from({length:5}, ()=>({pos:"house"}));

      for(const pc of server.pieces){
        if(!pc || !pc.color || !piecesByColor[pc.color]) continue;
        // pc.label is 1..5
        const idx = Math.max(0, Math.min(4, Number(pc.label||1)-1));
        let pos = "house";
        if(pc.posKind==="board" && pc.nodeId) pos = String(pc.nodeId);
        else if(pc.posKind==="goal") pos = "goal";
        else pos = "house";
        piecesByColor[pc.color][idx] = {pos, pieceId: pc.id};
      }

      state = {
        started: true,
        players,
        currentPlayer: server.turnColor,
        dice: (server.rolled==null ? null : Number(server.rolled)),
        phase: server.phase,
        placingChoices: [],
        pieces: Object.fromEntries(players.map(c => [c, piecesByColor[c] || []])),
        barricades: new Set(server.barricades.map(String)),
        winner: (server.winnerColor ? String(server.winnerColor) : null),
        goalNodeId: server.goal ? String(server.goal) : goalNodeId,
        // optional info from server (used by some UIs)
        activeColors: Array.isArray(server.activeColors) ? server.activeColors.slice() : null
              ,
        mode: String(server.mode || "classic"),
        action: (server.action && typeof server.action === "object") ? server.action : null
      
      };

      // map phases
      const ph = server.phase;
      if(ph==="need_roll") phase="need_roll";
      else if(ph==="need_move") phase="need_move";
      else if(ph==="place_barricade") phase="placing_barricade";
      else phase="need_roll";

      // show dice
      setDiceFaceAnimated(state.dice==null ? 0 : Number(state.dice));
      if(barrInfo) barrInfo.textContent = String(state.barricades.size);

      // in online mode we let the server validate moves, so don't compute legalTargets
      legalTargets = [];
      legalMovesAll = [];
      legalMovesByPiece = new Map();
      placingChoices = [];
      // auto-enter Barrikade-Pick nach Server-Aktivierung
      try{
        const eff = (state.action && state.action.effects) ? state.action.effects : {};
    const effAllActive = !!eff.allColors;
    const effBarrActive = !!eff.barricadeBy;
        if(pendingBarricadePick && eff && eff.barricadeBy===myColor){
          pendingBarricadePick=false;
          actionBarricadeActive=true;
          actionBarricadeFrom=null;
          toast("Barikade: Quelle wählen (auf eine Barikade klicken)");
        }
      }catch(e){}

      if(!(server.finished || server.phase === 'game_over')){ winShown = false; awardsShown = false; }

      if ((server.finished || server.phase === 'game_over') && state.winner && !winShown) {
        winShown = true;
        showEpicWin(state.winner);
        if(!awardsShown){
          awardsShown = true;
          const awards = (st && st.matchAwards) || (server && server.matchAwards) || [];
          setTimeout(()=>{ try{ runTitleCeremony(awards); }catch(_e){} }, 1200);
        }
      }

      updateTurnUI(); updateStartButton(); draw();
    updateActionUI_J1();
      updateActionUI_J1();
      ensureFittedOnce();
      return;
    }

    if(st.barricades && Array.isArray(st.barricades)) st.barricades = new Set(st.barricades);
    state = st;

    if(st.players && Array.isArray(st.players) && st.players.length>=2) setPlayers(st.players);

    if(typeof st.phase === "string") phase = st.phase;
    else phase = st.winner ? "game_over" : (st.dice==null ? "need_roll" : "need_move");

    placingChoices = Array.isArray(st.placingChoices) ? st.placingChoices : [];

    if(phase==="need_move" && st.dice!=null && !st.winner){
      legalMovesAll = computeLegalMoves(st.currentPlayer, st.dice);
      legalMovesByPiece = new Map();
      for(const m of legalMovesAll){
        const idx = m.piece.index;
        if(!legalMovesByPiece.has(idx)) legalMovesByPiece.set(idx, []);
        legalMovesByPiece.get(idx).push(m);
      }
      legalTargets = legalMovesAll;
    }else{
      legalTargets = [];
      legalMovesAll = [];
      legalMovesByPiece = new Map();
      if(phase!=="placing_barricade") selected=null;
    }

    if(barrInfo) barrInfo.textContent = String(state.barricades?.size ?? 0);
    setDiceFaceAnimated(state.dice==null ? 0 : Number(state.dice));
    // auto-enter Barrikade-Pick nach Server-Aktivierung
      try{
        const eff = (state.action && state.action.effects) ? state.action.effects : {};
    const effAllActive = !!eff.allColors;
    const effBarrActive = !!eff.barricadeBy;
        if(pendingBarricadePick && eff && eff.barricadeBy===myColor){
          pendingBarricadePick=false;
          actionBarricadeActive=true;
          actionBarricadeFrom=null;
          toast("Barikade: Quelle wählen (auf eine Barikade klicken)");
        }
      }catch(e){}

      updateTurnUI(); updateStartButton(); draw();
    updateActionUI_J1();
      ensureFittedOnce();
  }

  function serializeState(){
    const st = JSON.parse(JSON.stringify(state));
    if(state.barricades instanceof Set) st.barricades = Array.from(state.barricades);
    st.players = state?.players ? [...state.players] : [...PLAYERS];
    st.phase = phase;
    st.placingChoices = Array.isArray(placingChoices) ? [...placingChoices] : [];
    return st;
  }

  function broadcastState(kind="state"){
    if(netMode!=="host") return;
    wsSend({type:kind, room:roomCode, state:serializeState(), ts:Date.now()});
  }

  function sendIntent(intent){
    const msg = {type:"intent", room:roomCode, clientId, intent, ts:Date.now()};
    if(!wsSend(msg)) pendingIntents.push(msg);
  }

  // ===== Game =====
  
  function downloadJSON(obj, filename){
    try{
      const payload = JSON.stringify(obj ?? null, null, 2);
      const blob = new Blob([payload], {type:"application/json"});
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename || "barikade_save.json";
      a.click();
      setTimeout(()=>{ try{ URL.revokeObjectURL(a.href); }catch(_e){} }, 1200);
      return true;
    }catch(_e){
      return false;
    }
  }

function toast(msg){
    if(!toastEl) return;
    toastEl.textContent=msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t=setTimeout(()=>toastEl.classList.remove("show"), 1200);
  }


  // ===== Visual helpers (safe) =====
  function showNetBanner(text){
    if(!netBannerEl) return;
    netBannerEl.textContent = text || "";
    netBannerEl.classList.add("show");
  }
  function hideNetBanner(){
    if(!netBannerEl) return;
    netBannerEl.classList.remove("show");
  }

  function spawnDiceParticles(){
    if(!diceEl) return;
    const host = diceEl.parentElement;
    if(!host) return;
    const rect = diceEl.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const cx = (rect.left - hostRect.left) + rect.width/2;
    const cy = (rect.top - hostRect.top) + rect.height/2;

    const count = 12;
    for(let i=0;i<count;i++){
      const el = document.createElement("div");
      el.className = "diceParticle";
      el.style.left = (cx-3) + "px";
      el.style.top  = (cy-3) + "px";
      const ang = Math.random()*Math.PI*2;
      const dist = 14 + Math.random()*20;
      const dx = Math.cos(ang)*dist;
      const dy = Math.sin(ang)*dist;
      el.style.setProperty("--dx", dx.toFixed(1) + "px");
      el.style.setProperty("--dy", dy.toFixed(1) + "px");
      host.appendChild(el);
      setTimeout(()=>{ try{ el.remove(); }catch(_e){} }, 650);
    }
  }

  function setDiceFaceAnimated(v){
    if(!diceEl) return;
    try{ ensureDiceValueLabel(); }catch(_e){}
    // Werte >6 als Zahl anzeigen (z.B. Doppelwurf 7-12)
    if (typeof v === "number" && v > 6) {
      if (diceValueLabel) { diceValueLabel.textContent = String(v); diceValueLabel.style.display = "block"; }
      v = 0;
    } else {
      if (diceValueLabel) diceValueLabel.style.display = "none";
    }
    const face = (v>=1 && v<=6) ? v : 0;

    // clear any previous roll timers (visual only)
    try{
      if(_diceFlickerTimer){ clearInterval(_diceFlickerTimer); _diceFlickerTimer=null; }
      if(_diceFlickerStop){ clearTimeout(_diceFlickerStop); _diceFlickerStop=null; }
    }catch(_e){}

    // reset helper classes
    try{
      diceEl.classList.remove("legend-roll","legend-ping","legend-crit6","legend-crit1");
    }catch(_e){}

    if(face===0){
      diceEl.dataset.face = "0";
      lastDiceFace = 0;
      return;
    }

    const sameAsBefore = (face === lastDiceFace);
    lastDiceFace = face;

    // start legendary roll animation
    // - flicker faces quickly for suspense
    // - then settle on final face and keep it until next roll
    try{
      // restart animation class reliably
      diceEl.classList.remove("legend-roll");
      void diceEl.offsetWidth;
      if(!sameAsBefore){
        diceEl.classList.add("legend-roll");
      }

      // also keep old shake (if CSS exists)
      diceEl.classList.remove("shake");
      void diceEl.offsetWidth;
      diceEl.classList.add("shake");
    }catch(_e){}

    // Flicker: 10–14 quick random faces (visual only)
    // But ONLY when the face actually changes; otherwise snapshots would cause jitter.
    const t0 = performance.now();
    if(!sameAsBefore){
      _diceFlickerTimer = setInterval(()=>{
      try{
        const r = 1 + Math.floor(Math.random()*6);
        diceEl.dataset.face = String(r);
      }catch(_e){}
      // hard stop safety
      if(performance.now() - t0 > 520){
        try{ clearInterval(_diceFlickerTimer); }catch(_e){}
        _diceFlickerTimer=null;
      }
      }, 45);
    }

    // particles (existing)
    try{ spawnDiceParticles(); }catch(_e){}

    // settle on real result
    _diceFlickerStop = setTimeout(()=>{
      try{
        if(_diceFlickerTimer){ clearInterval(_diceFlickerTimer); _diceFlickerTimer=null; }
      }catch(_e){}
      try{
        diceEl.dataset.face = String(face);
        diceEl.classList.remove("shake");
        // if same face, give a small ping so it still feels alive
        if(sameAsBefore){
          diceEl.classList.remove("legend-ping");
          void diceEl.offsetWidth;
          diceEl.classList.add("legend-ping");
        }
        // crit effects
        if(face===6) diceEl.classList.add("legend-crit6");
        if(face===1) diceEl.classList.add("legend-crit1");
        // remove crit classes after a moment (visual only)
        setTimeout(()=>{
          try{ diceEl.classList.remove("legend-crit6","legend-crit1","legend-ping"); }catch(_e){}
        }, 1000);
      }catch(_e){}
    }, 560);
  }

  function parseColorFromPieceId(pieceId){
    const s = String(pieceId||"");
    // expected: p_red_1, p_blue_3 ...
    if(s.includes("red")) return "red";
    if(s.includes("blue")) return "blue";
    if(s.includes("green")) return "green";
    if(s.includes("yellow")) return "yellow";
    return null;
  }

  function queueMoveFx(action){
    if(!action || !board) return;
    const path = Array.isArray(action.path) ? action.path.map(String) : [];
    if(path.length < 2) return;

    const color = parseColorFromPieceId(action.pieceId) || "white";

    // Build WORLD nodes for the path (screen coords are calculated during draw so zoom/pan stays correct)
    const nodes=[];
    for(const id of path){
      const n = nodeById.get(String(id));
      if(!n) continue;
      nodes.push({ x:n.x, y:n.y, id:String(id) });
    }
    if(nodes.length < 2) return;

    const steps = nodes.length - 1;

    // Per-step duration (tweak feel here). Total scales with steps so it never looks like teleport.
    const stepMs = 220; // 180..260 feels good
    const totalMs = Math.min(2400, Math.max(420, steps * stepMs));

    const now = performance.now();

    // Trail/highlight (optional)
    const pts = nodes.map(n => worldToScreen(n));
    lastMoveFx = { color: color || "white", pts, t0: now, dur: totalMs };

    // Disable old sliding-ghost (we render the real piece as a visual override)
    moveGhostFx = null;

    // Real piece animation override
    moveAnim = {
      pieceId: String(action.pieceId),
      color: color || "white",
      nodes,
      t0: now,
      stepMs,
      hop: 16,       // hop height in px-ish (scaled with zoom below)
      totalMs
    };
    animPieceId = moveAnim.pieceId;
    isAnimatingMove = true;

    requestDraw();
  }

  function showOverlay(title, sub, hint){
    overlayTitle.textContent=title;
    overlaySub.textContent=sub||"";
    overlayHint.textContent=hint||"";
    overlay.classList.add("show");
  }

  // Legendary win screen (works for offline + online)
  let winFxRunning = false;
  function ensureWinCanvas(){
    const ov = $('overlay');
    if(!ov) return null;
    let c = document.getElementById('winFx');
    if(!c){
      c = document.createElement('canvas');
      c.id = 'winFx';
      c.style.position = 'absolute';
      c.style.inset = '0';
      c.style.width = '100%';
      c.style.height = '100%';
      c.style.pointerEvents = 'none';
      c.style.opacity = '0.9';
      ov.appendChild(c);
      // ensure overlay is relative
      if(getComputedStyle(ov).position === 'static') ov.style.position = 'relative';
    }
    return c;
  }

  function startWinFx(){
    if(winFxRunning) return;
    const c = ensureWinCanvas();
    if(!c) return;
    const ov = $('overlay');
    const g = c.getContext('2d');
    winFxRunning = true;

    const parts = [];
    const rand = (a,b)=>Math.random()*(b-a)+a;
    const resize = ()=>{
      const r = ov.getBoundingClientRect();
      c.width = Math.max(1, Math.floor(r.width));
      c.height = Math.max(1, Math.floor(r.height));
    };
    resize();
    window.addEventListener('resize', resize, { passive:true });

    for(let i=0;i<180;i++){
      parts.push({
        x: rand(0,c.width),
        y: rand(-c.height*0.15, c.height*0.05),
        vx: rand(-2.0,2.0),
        vy: rand(1.4,4.4),
        s: rand(2,5),
        rot: rand(0,Math.PI*2),
        vr: rand(-0.22,0.22),
        life: rand(900,1700)
      });
    }

    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    function frame(t){
      const age = t - t0;
      g.clearRect(0,0,c.width,c.height);
      g.save();
      g.globalCompositeOperation = 'lighter';
      for(const p of parts){
        if(age > p.life) continue;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.03;
        p.rot += p.vr;
        g.save();
        g.translate(p.x,p.y);
        g.rotate(p.rot);
        g.globalAlpha = Math.max(0, 1 - age/p.life);
        g.fillRect(-p.s, -p.s*0.6, p.s*2, p.s*1.2);
        g.restore();
      }
      g.restore();
      if(age < 1900 && ov.classList.contains('show')){
        requestAnimationFrame(frame);
      } else {
        winFxRunning = false;
      }
    }
    requestAnimationFrame(frame);
  }

  
// ---------- End-of-game Title Ceremony (per match) ----------
function ensureAwardsStyles(){
  if(document.getElementById("baAwardsStyles")) return;
  const st = document.createElement("style");
  st.id = "baAwardsStyles";
  st.textContent = `
    #baAwardsOverlay{ position:fixed; inset:0; display:none; align-items:center; justify-content:center; z-index:99999;
      background: radial-gradient(900px 600px at 50% 40%, rgba(255,255,255,.10), rgba(0,0,0,.82) 70%);
      backdrop-filter: blur(4px);
    }
    #baAwardsCard{ width:min(920px,92vw); border-radius:24px; padding:22px 18px; border:1px solid rgba(255,255,255,.12);
      background: rgba(5,10,22,.55);
      box-shadow: 0 12px 50px rgba(0,0,0,.55);
      text-align:center;
      transform: translateY(10px) scale(.98);
      opacity:0;
      transition: .22s ease;
    }
    #baAwardsOverlay.show #baAwardsCard{ transform: translateY(0) scale(1); opacity:1; }
    #baAwardsTitle{ font-weight:1000; letter-spacing:.2px; font-size:clamp(22px,4.2vw,44px); }
    #baAwardsValue{ margin-top:12px; font-weight:950; font-size:clamp(20px,3.6vw,38px); opacity:0; transform: translateY(6px); transition:.22s ease; }
    #baAwardsName{ margin-top:10px; font-weight:900; font-size:clamp(18px,3vw,30px); color: rgba(255,255,255,.86);
      opacity:0; transform: translateY(6px); transition:.22s ease;
    }
    #baAwardsValue.show, #baAwardsName.show{ opacity:1; transform: translateY(0); }
    #baAwardsSub{ margin-top:12px; font-size:13px; color: rgba(255,255,255,.62); }
  `;
  document.head.appendChild(st);
}

  const EMOJI_MAP = { laugh:"😂", angry:"😡", cool:"😎" };
  function normalizeEmojiKey(value){
    const v = String(value || "").trim();
    if(v === "😂" || v.toLowerCase() === "laugh") return "laugh";
    if(v === "😡" || v.toLowerCase() === "angry") return "angry";
    if(v === "😎" || v.toLowerCase() === "cool") return "cool";
    return "";
  }
  function updateEmojiUI(){
    const running = !!(state && state.started && !state.winner);
    const onlineReady = !!(netMode !== "offline" && ws && ws.readyState === 1);
    const canUse = running && onlineReady;
    if(emojiBar) emojiBar.style.display = running ? "flex" : "none";
    for(const btn of [emojiLaughBtn, emojiAngryBtn, emojiCoolBtn]){
      if(btn) btn.disabled = !canUse;
    }
  }
  function showEmojiOverlay(name, emoji){
    const key = normalizeEmojiKey(emoji);
    const icon = EMOJI_MAP[key] || String(emoji || "").trim() || "😀";
    if(emojiOverlayIcon) emojiOverlayIcon.textContent = icon;
    if(emojiOverlayName) emojiOverlayName.textContent = String(name || "Spieler");
    if(!emojiOverlay) return;
    emojiOverlay.classList.remove("show");
    void emojiOverlay.offsetWidth;
    emojiOverlay.classList.add("show");
    if(emojiOverlayTimer) clearTimeout(emojiOverlayTimer);
    emojiOverlayTimer = setTimeout(()=>{
      try{ emojiOverlay.classList.remove("show"); }catch(_e){}
    }, 2200);
  }
  function sendEmojiReaction(kind){
    const key = normalizeEmojiKey(kind);
    if(!key) return;
    if(!(state && state.started) || state.winner){ toast("Spiel läuft nicht"); return; }
    if(netMode === "offline" || !ws || ws.readyState !== 1){ toast("Nicht verbunden"); return; }
    const now = Date.now();
    if(now - lastEmojiSentAt < 1800){ toast("Kurz warten…"); return; }
    lastEmojiSentAt = now;
    // optimistic local overlay so the sender always sees immediate feedback
    try{ showEmojiOverlay(labelForColor(myColor) || "Spieler", key); }catch(_e){}
    const ok = wsSend({ type:"emoji_send", emoji:key, ts:now });
    if(!ok){ lastEmojiSentAt = 0; toast("Emoji konnte nicht gesendet werden"); }
  }
  function bindEmojiButtons(){
    const pairs = [[emojiLaughBtn, "laugh"],[emojiAngryBtn, "angry"],[emojiCoolBtn, "cool"]];
    for(const pair of pairs){
      const btn = pair[0]; const key = pair[1];
      if(!btn || btn.__emojiBound) continue;
      btn.__emojiBound = true;
      btn.addEventListener("click", ()=> sendEmojiReaction(key));
    }
    updateEmojiUI();
  }

  function initEmojiOverlaySystem(){
    try{ bindEmojiButtons(); }catch(_e){}
    try{ updateEmojiUI(); }catch(_e){}
  }

  // robust init: some devices/pages restore DOM late, so bind more than once safely
  try{ initEmojiOverlaySystem(); }catch(_e){}
  try{ window.addEventListener("load", initEmojiOverlaySystem, { once:true }); }catch(_e){}
  try{ document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) initEmojiOverlaySystem(); }); }catch(_e){}

function ensureAwardsUI(){
  ensureAwardsStyles();
  let ov = document.getElementById("baAwardsOverlay");
  if(ov) return ov;
  ov = document.createElement("div");
  ov.id = "baAwardsOverlay";
  ov.innerHTML = `
    <div id="baAwardsCard">
      <div id="baAwardsTitle">Titel</div>
      <div id="baAwardsValue">Wert</div>
      <div id="baAwardsName">Name</div>
      <div id="baAwardsSub">Titel‑Ehrung (dieses Spiel)</div>
    </div>
  `;
  document.body.appendChild(ov);
  return ov;
}
function fmtAwardValue(a){
  if(!a) return "";
  const v = a.value;
  const unit = a.unit || "";
  if(v==null || v===undefined || (typeof v==="number" && !isFinite(v))) return unit ? unit : "–";
  // number formatting: keep as given (server already rounded for seconds)
  return unit ? `${v} ${unit}` : String(v);
}
function fmtWinners(a){
  const ws = Array.isArray(a?.winners) ? a.winners.filter(Boolean) : [];
  if(ws.length===0) return "–";
  return ws.join(" & ");
}
let _awardsRunning = false;
async function runTitleCeremony(awards){
  if(_awardsRunning) return;
  const arr = Array.isArray(awards) ? awards : [];
  if(arr.length===0) return;
  _awardsRunning = true;
  const ov = ensureAwardsUI();
  const card = document.getElementById("baAwardsCard");
  const tEl = document.getElementById("baAwardsTitle");
  const vEl = document.getElementById("baAwardsValue");
  const nEl = document.getElementById("baAwardsName");

  const wait = (ms)=>new Promise(r=>setTimeout(r, ms));

  ov.style.display = "flex";
  // for each title: title -> value -> name, total 5s
  for(const a of arr){
    // reset
    vEl.classList.remove("show");
    nEl.classList.remove("show");
    tEl.textContent = String(a.title||"Titel");
    vEl.textContent = fmtAwardValue(a);
    nEl.textContent = fmtWinners(a);

    ov.classList.add("show");
    await wait(220);

    // Step 1: Title (≈1.2s)
    await wait(1000);

    // Step 2: Value
    vEl.classList.add("show");
    await wait(1200);

    // Step 3: Name(s)
    nEl.classList.add("show");
    await wait(2400);

    // Fade out between titles
    ov.classList.remove("show");
    await wait(260);
  }

  ov.style.display = "none";
  _awardsRunning = false;
}
// ------------------------------------------------------

function showEpicWin(winnerColor){
    const name = labelForColor(winnerColor);
    showOverlay('🏆 EPISCHER SIEG 🏆', `${name} gewinnt!`, 'Erste Figur auf dem Zielfeld.');
    startWinFx();
  }
  function hideOverlay(){ overlay.classList.remove("show"); }
  overlayOk.addEventListener("click", hideOverlay);

  async function loadBoard(){
    const res = await fetch("board.json", { cache:"force-cache" });
    if(!res.ok) throw new Error("board.json nicht gefunden");
    return await res.json();
  }

  function buildGraph(){
    nodeById.clear(); adj.clear(); runNodes.clear();
    goalNodeId=null;
    startNodeId={red:null,blue:null,green:null,yellow:null};

    for(const n of board.nodes){
      nodeById.set(n.id, n);
      if(n.kind==="board"){
        adj.set(n.id, []);
        if(n.flags?.run) runNodes.add(n.id);
        if(n.flags?.goal) goalNodeId=n.id;
        if(n.flags?.startColor) startNodeId[n.flags.startColor]=n.id;
      }
    }
    for(const e of board.edges||[]){
      const a=String(e[0]), b=String(e[1]);
      if(!adj.has(a)||!adj.has(b)) continue;
      adj.get(a).push(b); adj.get(b).push(a);
    }
    if(board.meta?.goal) goalNodeId=board.meta.goal;
    if(board.meta?.starts){
      for(const c of DEFAULT_PLAYERS) if(board.meta.starts[c]) startNodeId[c]=board.meta.starts[c];
    }
    if(boardInfo) boardInfo.textContent = `${[...adj.keys()].length} Felder`;
  }

  // ===== View / Fit-to-screen (Tablet / Zoom-Fix) =====
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  function computeBounds(){
    if(!board || !Array.isArray(board.nodes) || board.nodes.length===0) return null;
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for(const n of board.nodes){
      if(typeof n.x!=="number" || typeof n.y!=="number") continue;
      if(n.x<minX) minX=n.x; if(n.x>maxX) maxX=n.x;
      if(n.y<minY) minY=n.y; if(n.y>maxY) maxY=n.y;
    }
    if(!isFinite(minX)) return null;
    return {minX,maxX,minY,maxY};
  }

  function fitBoardToView(){
    const b = computeBounds();
    if(!b) return;
    const rect = canvas.getBoundingClientRect();
    const vw = rect.width, vh = rect.height;
    if(vw < 20 || vh < 20) return;

    const pad = 70; // world units
    const minX = b.minX - pad, maxX = b.maxX + pad;
    const minY = b.minY - pad, maxY = b.maxY + pad;
    const bw = (maxX - minX);
    const bh = (maxY - minY);

    const s = Math.min(vw / bw, vh / bh);
    view.s = clamp(s, 0.28, 3.2);

    const leftPx = (vw - bw * view.s) / 2;
    const topPx  = (vh - bh * view.s) / 2;
    view.x = (leftPx / view.s) - minX;
    view.y = (topPx  / view.s) - minY;
    saveView();
  }

  function ensureFittedOnce(){
    if(view._fittedOnce) return;
    fitBoardToView();
    view._fittedOnce = true;
    draw();
  }


  function newGame(){
    const active = getActiveColors();
    setPlayers(active);

    state={
      players:[...PLAYERS],
      currentPlayer:PLAYERS[0],
      dice:null,
      phase:"need_roll",
      placingChoices:[],
      pieces:Object.fromEntries(PLAYERS.map(c=>[c, Array.from({length:5},()=>({pos:"house"}))])),
      barricades:new Set(),
      winner:null
    };



    // Start-Joker (offline Action-Modus): 2x pro Joker-Art (Anzeige + kompatibel zu Online-Structure)
    try{
      const _m = (actionModeToggle && actionModeToggle.checked) ? "action" : "classic";
      state.mode = _m;
      if(_m === "action"){
        state.action = state.action && typeof state.action==="object" ? state.action : {};
        state.action.jokersByColor = state.action.jokersByColor && typeof state.action.jokersByColor==="object" ? state.action.jokersByColor : {};
        state.action.jokersOwned = state.action.jokersOwned && typeof state.action.jokersOwned==="object" ? state.action.jokersOwned : {};
        const cols = Array.isArray(PLAYERS) ? PLAYERS.slice() : ["red","blue"];
        for(const c of cols){
          const startCounts = getStartJokerCounts() || { allColors:2, barricade:2, reroll:2, double:2 };
        state.action.jokersByColor[c] = { allColors:startCounts.allColors, barricade:startCounts.barricade, reroll:startCounts.reroll, double:startCounts.double };
          const arr = [];
          for(const t of ["allColors","barricade","reroll","double"]){
            const count = Number(startCounts[t] || 0);
            for(let i=0;i<count;i++) arr.push({type:t, color:c});
          }
          state.action.jokersOwned[c] = arr;
        }
      }
    }catch(_e){}
    // 🔥 BRUTAL: Barikaden starten auf ALLEN RUN-Feldern (außer Ziel)
    for(const id of runNodes){
      if(id===goalNodeId) continue;
      state.barricades.add(id);
    }

    if(barrInfo) barrInfo.textContent=String(state.barricades.size);
    setPhase("need_roll");
    /* dice handled via data-face */
    legalTargets=[]; setPlacingChoices([]);
    selected=null; legalMovesAll=[]; legalMovesByPiece=new Map();
    // auto-enter Barrikade-Pick nach Server-Aktivierung
      try{
        const eff = (state.action && state.action.effects) ? state.action.effects : {};
    const effAllActive = !!eff.allColors;
    const effBarrActive = !!eff.barricadeBy;
        if(pendingBarricadePick && eff && eff.barricadeBy===myColor){
          pendingBarricadePick=false;
          actionBarricadeActive=true;
          actionBarricadeFrom=null;
          toast("Barikade: Quelle wählen (auf eine Barikade klicken)");
        }
      }catch(e){}

      updateTurnUI(); updateStartButton(); draw();
    try{ ensureFittedOnce(); }catch(_e){}

      // draw board immediately even before server state arrives
      requestDraw();
  }

  function updateTurnUI(){
    // Guard: can be called before we have a snapshot/state
    // (e.g. right after reconnect/assign or after a NO_STATE error)
    if(!state){
      if(turnText) turnText.textContent = "Spiel nicht gestartet";
      if(turnDot) turnDot.style.background = "#555";
      if(rollBtn) rollBtn.disabled = true;
      if(endBtn)  endBtn.disabled  = true;
      if(skipBtn) skipBtn.disabled = true;
      updateColorPickUI();
      updateEmojiUI();
      return;
    }

    const c=state.currentPlayer;
    turnText.textContent = state.winner ? `${labelForColor(state.winner)} gewinnt!` : `${labelForColor(c)} ist dran`;
    turnDot.style.background = COLORS[c];

    const isMyTurn = (netMode==="offline") ? true : (myColor && myColor===state.currentPlayer);
    rollBtn.disabled = (phase!=="need_roll") || !isMyTurn;
    endBtn.disabled  = (phase==="need_roll"||phase==="placing_barricade"||phase==="game_over") || !isMyTurn;
    if(skipBtn) skipBtn.disabled = (phase==="placing_barricade"||phase==="game_over") || !isMyTurn;

    // While a move animation is running, lock the controls so the next action can't happen mid-hop
    if(isAnimatingMove){
      rollBtn.disabled = true;
      endBtn.disabled  = true;
      if(skipBtn) skipBtn.disabled = true;
    }

    updateColorPickUI();
    updateEmojiUI();
  }

  function endTurn(){
    if(state && state.dice === 6 && !state.winner){
      state.dice = null;
      setDiceFaceAnimated(0);

      legalTargets=[]; setPlacingChoices([]);
      selected=null; legalMovesAll=[]; legalMovesByPiece=new Map();
      setPhase("need_roll");
      // auto-enter Barrikade-Pick nach Server-Aktivierung
      try{
        const eff = (state.action && state.action.effects) ? state.action.effects : {};
    const effAllActive = !!eff.allColors;
    const effBarrActive = !!eff.barricadeBy;
        if(pendingBarricadePick && eff && eff.barricadeBy===myColor){
          pendingBarricadePick=false;
          actionBarricadeActive=true;
          actionBarricadeFrom=null;
          toast("Barikade: Quelle wählen (auf eine Barikade klicken)");
        }
      }catch(e){}

      updateTurnUI(); updateStartButton(); draw();
      toast("6! Nochmal würfeln");
      return;
    }
    nextPlayer();
  }

  function nextPlayer(){
    const order = state.players?.length ? state.players : PLAYERS;
    const idx = order.indexOf(state.currentPlayer);
    state.currentPlayer = order[(idx+1)%order.length];
    state.dice=null;
    setDiceFaceAnimated(0);
    legalTargets=[]; setPlacingChoices([]);
    selected=null; legalMovesAll=[]; legalMovesByPiece=new Map();
    setPhase("need_roll");
    // auto-enter Barrikade-Pick nach Server-Aktivierung
      try{
        const eff = (state.action && state.action.effects) ? state.action.effects : {};
    const effAllActive = !!eff.allColors;
    const effBarrActive = !!eff.barricadeBy;
        if(pendingBarricadePick && eff && eff.barricadeBy===myColor){
          pendingBarricadePick=false;
          actionBarricadeActive=true;
          actionBarricadeFrom=null;
          toast("Barikade: Quelle wählen (auf eine Barikade klicken)");
        }
      }catch(e){}

      updateTurnUI(); updateStartButton(); draw();
  }

  function rollDice(){
    if(phase!=="need_roll") return;
    state.dice = 1 + Math.floor(Math.random()*6);
    setDiceFaceAnimated(state.dice);

    toast(`Wurf: ${state.dice}`);

    legalMovesAll = computeLegalMoves(state.currentPlayer, state.dice);
    legalMovesByPiece = new Map();
    for(const m of legalMovesAll){
      const idx = m.piece.index;
      if(!legalMovesByPiece.has(idx)) legalMovesByPiece.set(idx, []);
      legalMovesByPiece.get(idx).push(m);
    }
    legalTargets = legalMovesAll;

    if(legalMovesAll.length===0){
      toast("Kein Zug möglich – Zug verfällt");
      endTurn();
      return;
    }
    setPhase("need_move");
    // auto-enter Barrikade-Pick nach Server-Aktivierung
      try{
        const eff = (state.action && state.action.effects) ? state.action.effects : {};
    const effAllActive = !!eff.allColors;
    const effBarrActive = !!eff.barricadeBy;
        if(pendingBarricadePick && eff && eff.barricadeBy===myColor){
          pendingBarricadePick=false;
          actionBarricadeActive=true;
          actionBarricadeFrom=null;
          toast("Barikade: Quelle wählen (auf eine Barikade klicken)");
        }
      }catch(e){}

      updateTurnUI(); updateStartButton(); draw();
  }

  function pieceAtBoardNode(nodeId, color){
    const arr = state.pieces[color];
    for(let i=0;i<arr.length;i++){
      if(arr[i].pos === nodeId) return {color, index:i};
    }
    return null;
  }
  function selectPiece(sel){
    selected = sel;
    toast(`${PLAYER_NAME[sel.color]} Figur ${sel.index+1} gewählt`);
  }
  function trySelectAtNode(node){
      if (!state || !state.currentPlayer) { return false; }
      if(!node) return false;

      const turn = state.currentPlayer;
      const isMyTurnOnline = (netMode!=="offline") ? (myColor && myColor===turn) : true;
      const allowAll = !!(isMyTurnOnline && state && state.mode==="action" && state.action && state.action.effects && state.action.effects.allColorsBy===turn);

      // Action-Modus B2: Barikade-Joker (vor dem Wurf) – Barikade anklicken, dann Zielfeld
      const allowBarricadeJoker = !!(
        isMyTurnOnline &&
        state &&
        state.mode === "action" &&
        state.action &&
        state.action.effects &&
        state.action.effects.barricadeBy === turn &&
        state.phase === "need_roll"
      );
      if (allowBarricadeJoker && node.kind === "board") {
        const bset = (() => {
          const b = state.barricades;
          if (!b) return new Set();
          if (Array.isArray(b)) return new Set(b.map(String));
          if (typeof b.has === "function") return b; // already a Set
          if (typeof b === "object") {
            // object map {id:true}
            return new Set(Object.keys(b).filter(k => b[k]).map(String));
          }
          return new Set();
        })();
        if (actionBarricadeFrom == null) {
          if (!bset.has(String(node.id))) { toast("Erst eine Barikade wählen"); return true; }
          actionBarricadeFrom = node.id;
          toast("Ziel-Feld wählen");
          draw();
          return true;
        } else {
          const from = actionBarricadeFrom;
          actionBarricadeFrom = null;
          wsSend({ type: "action_barricade_move", from, to: node.id });
          draw();
          return true;
        }
      }

      if(node.kind === "board"){
        let p = pieceAtBoardNode(node.id, turn);
        if(!p && allowAll){
          for(const col of ["red","blue","green","yellow"]){
            p = pieceAtBoardNode(node.id, col);
            if(p) break;
          }
        }
        if(p){ selectPiece(p); return true; }
        return false;
      }

      if(node.kind === "house" && node.flags?.houseColor && node.flags?.houseSlot){
        const hc = String(node.flags.houseColor).toLowerCase();
        const idx = Number(node.flags.houseSlot) - 1;
        if(idx>=0 && idx<5){
          const can = (hc === turn) || allowAll;
          if(!can) return false;
          if(state.pieces[hc] && state.pieces[hc][idx] && state.pieces[hc][idx].pos === "house"){
            selectPiece({color:hc, index:idx});
            return true;
          }else{
            toast("Diese Figur ist nicht im Haus");
            return true;
          }
        }
      }
      return false;
    }

  function anyPiecesAtNode(nodeId){
    const res=[];
    for(const c of getActiveColors()){
      const arr=state.pieces[c];
      for(let i=0;i<arr.length;i++) if(arr[i].pos===nodeId) res.push({color:c,index:i});
    }
    return res;
  }

  function enumeratePaths(startId, steps){
    const results=[];
    const visited=new Set([startId]);
    function dfs(curr, remaining, path){
      if(remaining===0){ results.push([...path]); return; }
      for(const nb of (adj.get(curr)||[])){
        if(visited.has(nb)) continue;
        if(state.barricades.has(nb) && remaining>1) continue; // cannot pass barricade
        visited.add(nb); path.push(nb);
        dfs(nb, remaining-1, path);
        path.pop(); visited.delete(nb);
      }
    }
    dfs(startId, steps, [startId]);
    return results;
  }

  function computeLegalMoves(color, dice){
    const moves=[];
    for(let i=0;i<5;i++){
      const pc=state.pieces[color][i];
      if(typeof pc.pos==="string" && adj.has(pc.pos)){
        for(const p of enumeratePaths(pc.pos, dice)){
          moves.push({piece:{color,index:i}, path:p, toId:p[p.length-1], fromHouse:false});
        }
      }
    }
    const start=startNodeId[color];
    const hasHouse = state.pieces[color].some(p=>p.pos==="house");
    if(hasHouse && start && !state.barricades.has(start)){
      const remaining=dice-1;
      if(remaining===0){
        for(let i=0;i<5;i++) if(state.pieces[color][i].pos==="house"){
          moves.push({piece:{color,index:i}, path:[start], toId:start, fromHouse:true});
        }
      }else{
        const paths=enumeratePaths(start, remaining);
        for(let i=0;i<5;i++) if(state.pieces[color][i].pos==="house"){
          for(const p of paths) moves.push({piece:{color,index:i}, path:p, toId:p[p.length-1], fromHouse:true});
        }
      }
    }
    const seen=new Set(), uniq=[];
    for(const m of moves){
      const k=`${m.piece.color}:${m.piece.index}->${m.toId}:${m.fromHouse?'H':'B'}`;
      if(seen.has(k)) continue;
      seen.add(k); uniq.push(m);
    }
    return uniq;
  }

  function checkWin(){
    // Gewinner: wer als erstes mit EINER Figur im Ziel ist.
    for(const c of getActiveColors()){
      if(state.pieces[c].some(p=>p.pos==="goal")){
        state.winner=c;
        return;
      }
    }
  }

  // 🔥 BRUTAL placements: any node (except goal, no duplicates)
  function computeBarricadePlacements(){
    const choices=[];
    for(const id of adj.keys()){
      if(id===goalNodeId) continue;
      if(state.barricades.has(id)) continue;
      choices.push(id);
    }
    setPlacingChoices(choices);
  }

  function movePiece(move){
    const {color,index}=move.piece;
    const toId=move.toId;

    // hit enemies
    const enemies = anyPiecesAtNode(toId).filter(p=>p.color!==color);
    for(const e of enemies) state.pieces[e.color][e.index].pos="house";

    const landsOnBarr = state.barricades.has(toId);
    state.pieces[color][index].pos=toId;

    if(toId===goalNodeId){
      state.pieces[color][index].pos="goal";
      toast("Ziel erreicht!");
      checkWin();
      if(state.winner){
        setPhase("game_over"); // auto-enter Barrikade-Pick nach Server-Aktivierung
      try{
        const eff = (state.action && state.action.effects) ? state.action.effects : {};
    const effAllActive = !!eff.allColors;
    const effBarrActive = !!eff.barricadeBy;
        if(pendingBarricadePick && eff && eff.barricadeBy===myColor){
          pendingBarricadePick=false;
          actionBarricadeActive=true;
          actionBarricadeFrom=null;
          toast("Barikade: Quelle wählen (auf eine Barikade klicken)");
        }
      }catch(e){}

      updateTurnUI(); updateStartButton(); draw();
        showEpicWin(state.winner);
        if(!awardsShown){
          awardsShown = true;
          const awards = (st && st.matchAwards) || (server && server.matchAwards) || [];
          setTimeout(()=>{ try{ runTitleCeremony(awards); }catch(_e){} }, 1200);
        }
        return;
      }
      endTurn();
      return;
    }

    if(landsOnBarr){
      state.barricades.delete(toId);
      if(barrInfo) barrInfo.textContent=String(state.barricades.size);
      setPhase("placing_barricade");
      computeBarricadePlacements();
      // auto-enter Barrikade-Pick nach Server-Aktivierung
      try{
        const eff = (state.action && state.action.effects) ? state.action.effects : {};
    const effAllActive = !!eff.allColors;
    const effBarrActive = !!eff.barricadeBy;
        if(pendingBarricadePick && eff && eff.barricadeBy===myColor){
          pendingBarricadePick=false;
          actionBarricadeActive=true;
          actionBarricadeFrom=null;
          toast("Barikade: Quelle wählen (auf eine Barikade klicken)");
        }
      }catch(e){}

      updateTurnUI(); updateStartButton(); draw();
      toast("Barikade eingesammelt – jetzt neu platzieren");
      return;
    }

    endTurn();
  }

  function placeBarricade(nodeId){
    if(phase!=="placing_barricade") return;
    if(nodeId===goalNodeId){ toast("Ziel ist gesperrt"); return; }
    if(!placingChoices.includes(nodeId)){ toast("Hier darf keine Barikade hin"); return; }
    state.barricades.add(nodeId);
    if(barrInfo) barrInfo.textContent=String(state.barricades.size);
    setPlacingChoices([]);
    toast("Barikade platziert");
    endTurn();
  }

  // ===== Rendering =====
  function resize(){
    dpr=Math.max(1, Math.min(2.5, window.devicePixelRatio||1));
    const r=canvas.getBoundingClientRect();
    canvas.width=Math.floor(r.width*dpr);
    canvas.height=Math.floor(r.height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    draw();
    // Mobile browsers report unstable canvas size during load/orientation.
    setTimeout(()=>{ if(!view._fittedOnce) { try{ ensureFittedOnce(); }catch(_e){} } }, 80);

  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", ()=>{
    // force re-fit after rotation/addressbar changes
    view._fittedOnce = false;
    setTimeout(()=>{ try{ resize(); ensureFittedOnce(); }catch(_e){} }, 200);
  });

  function worldToScreen(p){ return {x:(p.x+view.x)*view.s, y:(p.y+view.y)*view.s}; }
  function screenToWorld(p){ return {x:p.x/view.s-view.x, y:p.y/view.s-view.y}; }

  function drawBarricadeIcon(x,y,r){
    ctx.save();
    ctx.fillStyle="rgba(0,0,0,0.85)";
    ctx.strokeStyle="rgba(230,237,243,0.9)";
    ctx.lineWidth=3;
    ctx.beginPath();
    ctx.arc(x,y,r*0.95,0,Math.PI*2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  function drawSelectionRing(x,y,r){
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x,y,r*1.05,0,Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }
  function drawHousePieces(node, x, y, r){
    const color = node.flags && node.flags.houseColor;
    const slot = Number(node.flags && node.flags.houseSlot);
    if(!color || !slot) return;
    const idx = slot - 1;
    if(!state?.pieces?.[color]) return;
    if(state.pieces[color][idx].pos !== "house") return;

    ctx.save();
    // (27) subtle gradient for pieces
    const g = ctx.createRadialGradient(x - r*0.18, y - r*0.18, r*0.15, x, y, r*0.75);
    g.addColorStop(0, "rgba(255,255,255,0.45)");
    g.addColorStop(0.35, COLORS[color]);
    g.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.fillStyle = g;
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r*0.55, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function drawStack(arr, x, y, r){
    const p = arr[0];
    ctx.save();
    // (27) subtle gradient for pieces
    const g = ctx.createRadialGradient(x - r*0.22, y - r*0.22, r*0.2, x, y, r*1.15);
    g.addColorStop(0, "rgba(255,255,255,0.45)");
    g.addColorStop(0.4, COLORS[p.color]);
    g.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.fillStyle = g;
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r*0.95, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();

    if(arr.length > 1){
      ctx.fillStyle="rgba(0,0,0,0.65)";
      ctx.beginPath();
      ctx.arc(x, y, r*0.45, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle="rgba(230,237,243,0.95)";
      ctx.font="bold 14px system-ui";
      ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText(String(arr.length), x, y);
    }
    ctx.restore();
  }

  // Request a redraw on the next animation frame (prevents spamming draw() calls)
  function requestDraw(){
    if(rafDrawId) return;
    rafDrawId = requestAnimationFrame(() => {
      rafDrawId = 0;
      draw();
    });
  }



  function draw(){
    if(!board) return;
    const hasState = !!state;
    const rect=canvas.getBoundingClientRect();
    ctx.clearRect(0,0,rect.width,rect.height);

    // grid
    const grid=Math.max(10,(board.ui?.gridSize||20))*view.s;
    ctx.save();
    ctx.strokeStyle="rgba(28,36,51,0.75)";
    ctx.lineWidth=1;
    const ox=(view.x*view.s)%grid, oy=(view.y*view.s)%grid;
    for(let x=-ox;x<rect.width;x+=grid){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,rect.height);ctx.stroke();}
    for(let y=-oy;y<rect.height;y+=grid){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(rect.width,y);ctx.stroke();}
    ctx.restore();

    // edges
    ctx.save();
    ctx.lineWidth=3; ctx.strokeStyle=COLORS.edge;
    for(const e of board.edges||[]){
      const a=nodeById.get(String(e[0])), b=nodeById.get(String(e[1]));
      if(!a||!b||a.kind!=="board"||b.kind!=="board") continue;
      const sa=worldToScreen(a), sb=worldToScreen(b);
      ctx.beginPath();ctx.moveTo(sa.x,sa.y);ctx.lineTo(sb.x,sb.y);ctx.stroke();
    }
    ctx.restore();

    // (109) last move trail + (8) destination glow
    const nowFx = performance.now();
    if(lastMoveFx && lastMoveFx.pts && nowFx - lastMoveFx.t0 < 900){
      const age = (nowFx - lastMoveFx.t0);
      const a = Math.max(0, 1 - age/900);
      const col = COLORS[lastMoveFx.color] || lastMoveFx.color || 'rgba(255,255,255,0.9)';
      ctx.save();
      ctx.globalAlpha = 0.55 * a;
      ctx.strokeStyle = col;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(lastMoveFx.pts[0].x, lastMoveFx.pts[0].y);
      for(let i=1;i<lastMoveFx.pts.length;i++) ctx.lineTo(lastMoveFx.pts[i].x, lastMoveFx.pts[i].y);
      ctx.stroke();
      // destination glow
      const end = lastMoveFx.pts[lastMoveFx.pts.length-1];
      ctx.globalAlpha = 0.35 * a;
      ctx.beginPath();
      ctx.arc(end.x, end.y, 22, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }

    // (7) step-by-step hop animation (visual override so it doesn't look like teleport)
    

const r=Math.max(16, board.ui?.nodeRadius || 20);

    // nodes
    for(const n of board.nodes){
      const s=worldToScreen(n);
      let fill=COLORS.node;
      if(n.kind==="board"){
        if(n.id===goalNodeId) fill=COLORS.goal;
        else if(n.flags?.startColor) fill=COLORS.node; // ✅ neutral start fields
        else if(n.flags?.run) fill=COLORS.run;
      }else if(n.kind==="house"){
        fill=COLORS[n.flags?.houseColor]||COLORS.node;
      }

      ctx.beginPath(); ctx.fillStyle=fill; ctx.arc(s.x,s.y,r,0,Math.PI*2); ctx.fill();
      ctx.lineWidth=3; ctx.strokeStyle=COLORS.stroke; ctx.stroke();

      if(n.kind==="house" && n.flags?.houseSlot){
        ctx.fillStyle="rgba(0,0,0,0.55)";
        ctx.beginPath(); ctx.arc(s.x,s.y,r*0.55,0,Math.PI*2); ctx.fill();
        ctx.fillStyle="rgba(230,237,243,0.95)";
        ctx.font="bold 13px system-ui";
        ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText(String(n.flags.houseSlot), s.x, s.y);
        if(hasState) drawHousePieces(n, s.x, s.y, r);

        if(hasState && selected && n.flags && n.flags.houseColor===selected.color && Number(n.flags.houseSlot)===selected.index+1){
          drawSelectionRing(s.x, s.y, r*0.85);
        }
      }

      if(n.kind==="board" && hasState && state.barricades && state.barricades.has(n.id)){
        drawBarricadeIcon(s.x,s.y,r);
        if(actionBarricadeFrom === n.id) drawSelectionRing(s.x, s.y, r*0.85);
      }
    }

    if(phase==="placing_barricade"){
      ctx.save();
      ctx.lineWidth=6;
      ctx.strokeStyle="rgba(255,209,102,0.9)";
      ctx.setLineDash([10,7]);
      for(const id of placingChoices){
        const n=nodeById.get(id); if(!n) continue;
        const s=worldToScreen(n);
        ctx.beginPath(); ctx.arc(s.x,s.y,r+7,0,Math.PI*2); ctx.stroke();
      }
      ctx.restore();
    }

    
    // Wenn noch kein Server-State da ist: Board trotzdem anzeigen (leer)
    if(!hasState){
      try{
        ctx.save();
        ctx.fillStyle = "rgba(230,237,243,0.85)";
        ctx.font = "600 14px system-ui";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("Warte auf Spielstart…", 12, 12);
        ctx.restore();
      }catch(_e){}
      return;
    }

// pieces stacked
    const stacks=new Map();
    // Show ALL colors always (also unchosen)
    for(const c of PLAYERS){
      const pcs=state.pieces[c];
      for(let i=0;i<pcs.length;i++){
        const pc = pcs[i];
        const pos = pc.pos;
        const pid = pc.pieceId;
        if(animPieceId && pid === animPieceId){
          continue; // draw as animated override, not as a stack at the target
        }
        if(typeof pos==="string" && adj.has(pos)){
          if(!stacks.has(pos)) stacks.set(pos, []);
          stacks.get(pos).push({color:c,index:i});
        }
      }
    }
    for(const [nodeId, arr] of stacks.entries()){
      const n=nodeById.get(nodeId); if(!n) continue;
      const s=worldToScreen(n);
      drawStack(arr, s.x, s.y, r);
    }

    // ===== animated moving piece (drawn ON TOP of nodes & pieces) =====
    if(moveAnim){
      const now = performance.now();
      const t = now - moveAnim.t0;

      if(t >= moveAnim.totalMs){
        // Animation finished: clear override BEFORE next render, otherwise the piece may stay hidden
        // because stacks skipped animPieceId in the current frame.
        moveAnim = null;
        animPieceId = null;
        isAnimatingMove = false;
        // UI re-evaluate (buttons etc.)
        updateTurnUI();
        // Force one extra frame so the final stack is drawn immediately.
        requestDraw();
      } else {
        const nodes = moveAnim.nodes;
        const steps = nodes.length - 1;
        const f = Math.max(0, Math.min(1, t / moveAnim.totalMs)); // 0..1
        const segF = f * steps;
        const seg = Math.min(steps - 1, Math.floor(segF));
        const u = segF - seg; // 0..1 within current segment

        const a = nodes[seg];
        const b = nodes[seg+1];

        // linear world interpolation
        const wx = a.x + (b.x - a.x) * u;
        const wy = a.y + (b.y - a.y) * u;

        // convert to screen
        const sp = worldToScreen({x:wx, y:wy});

        // hop curve: 0..1..0 each step
        const hop = Math.sin(Math.PI * u);
        const hopPx = (moveAnim.hop || 16) * (0.85 + 0.15*view.s);
        const yHop = sp.y - hop * hopPx;

        // force top-layer drawing (client sometimes had composite state left over)
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;

        // make it CLEARLY in front: slightly bigger + shadow
        const col = COLORS[moveAnim.color] || moveAnim.color || 'rgba(255,255,255,0.95)';
        const rr = 18;

        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 5;

        // solid + subtle highlight (less transparent than before)
        ctx.fillStyle = col;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.arc(sp.x, yHop, rr, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();

        // small top highlight
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.arc(sp.x - rr*0.25, yHop - rr*0.35, rr*0.45, 0, Math.PI*2);
        ctx.fill();

        ctx.restore();

        // keep animating
        requestDraw();
      }
    }
if(selected){
      const pc = state.pieces[selected.color]?.[selected.index];
      if(pc && typeof pc.pos==="string" && adj.has(pc.pos)){
        const n = nodeById.get(pc.pos);
        if(n){
          const s = worldToScreen(n);
          drawSelectionRing(s.x, s.y, r);
        }
      }
    }
  }

  // ===== Interaction =====
  function pointerPos(ev){
    const r=canvas.getBoundingClientRect();
    return {x:ev.clientX-r.left, y:ev.clientY-r.top};
  }
  function hitNode(wp){
    const r=Math.max(16, board.ui?.nodeRadius || 20);
    const hitR=(r+10)/view.s;
    let best=null, bd=Infinity;
    for(const n of board.nodes){
      const d=Math.hypot(n.x-wp.x, n.y-wp.y);
      if(d<hitR && d<bd){best=n; bd=d;}
    }
    return best;
  }

  function onPointerDown(ev){
      if (!state) { return; }
canvas.setPointerCapture(ev.pointerId);
    const sp=pointerPos(ev);
    // double-tap (or double-click) to auto-fit board (tablet safe)
    const nowTs = Date.now();
    if(pointerMap.size===0){
      if(lastTapPos && (nowTs - lastTapTs) < 350){
        const dx = sp.x - lastTapPos.x, dy = sp.y - lastTapPos.y;
        if((dx*dx + dy*dy) < (28*28)){
          // fit + persist
          clearView();
          try{ ensureFittedOnce(); }catch(_e){}
          saveView();
          lastTapTs = 0; lastTapPos = null;
          return;
        }
      }
      lastTapTs = nowTs;
      lastTapPos = {x:sp.x,y:sp.y};
    }
    pointerMap.set(ev.pointerId, {x:sp.x,y:sp.y});
    if(pointerMap.size===2){ isPanning=false; panStart=null; return; }

    const wp=screenToWorld(sp);
    const hit=hitNode(wp);
      const isMyTurn = (netMode!=="client") || (myColor && myColor===state.currentPlayer);
      // IMPORTANT: Board-Panning soll immer gehen (auch wenn man nicht dran ist).
      // Wir blocken daher NICHT mehr den gesamten PointerDown, sondern nur Gameplay-Interaktion.
      const allowGameInput = (netMode!=="client") || (myColor && isMyTurn);

if(allowGameInput && phase==="placing_barricade" && hit && hit.kind==="board"){
  // ONLINE: Server entscheidet immer (Host + Client senden)
  if(netMode!=="offline"){
    wsSend({type:"place_barricade", nodeId: hit.id, ts:Date.now()});
    return;
  }

  // OFFLINE: lokal platzieren
  placeBarricade(hit.id);
  return;
}

    // IMPORTANT: In 'need_roll' (vor dem Würfeln) müssen Klicks ebenfalls
    // ausgewertet werden, sonst funktionieren Action-Mode Joker (z.B. Barikade)
    // nicht, weil der Click-Handler bisher nur in 'need_move' aktiv war.
    if(allowGameInput && phase==="need_roll"){
      if(trySelectAtNode(hit)) { draw(); return; }
    }

    if(allowGameInput && phase==="need_move"){
      if(trySelectAtNode(hit)) { draw(); return; }
      if(selected && hit && hit.kind==="board"){
        if(netMode!=="offline"){
          const pid = state?.pieces?.[selected.color]?.[selected.index]?.pieceId;
          if(!pid){ toast("PieceId fehlt"); return; }
          wsSend({type:"move_request", pieceId: pid, targetId: hit.id, ts:Date.now()});
          return;
        }
        const list = legalMovesByPiece.get(selected.index) || [];
        const m = list.find(x => x.toId===hit.id);
        if(m){
          if(netMode==="client"){ wsSend({type:"move_request", pieceId: (state.pieces[selected.color][selected.index].pieceId), targetId: hit.id, ts:Date.now()}); return; }
          movePiece(m);
          if(netMode==="host") broadcastState("state");
          draw();
          return;
        }
        toast("Ungültiges Zielfeld (bitte neu zählen)");
        return;
      }
    }

    isPanning=true;
    panStart={sx:sp.x,sy:sp.y,vx:view.x,vy:view.y};
  }

  function onPointerMove(ev){
    if(!pointerMap.has(ev.pointerId)) return;
    const sp=pointerPos(ev);
    pointerMap.set(ev.pointerId, {x:sp.x,y:sp.y});

    if(pointerMap.size===2){
      const pts=[...pointerMap.values()];
      const a=pts[0], b=pts[1];
      if(!onPointerMove._pinch){
        onPointerMove._pinch={d0:Math.hypot(a.x-b.x,a.y-b.y), s0:view.s};
      }
      const pz=onPointerMove._pinch;
      const d1=Math.hypot(a.x-b.x,a.y-b.y);
      const factor=d1/Math.max(10,pz.d0);
      view.s=Math.max(0.25, Math.min(3.2, pz.s0*factor));
      draw(); return;
    } else { onPointerMove._pinch=null; }

    if(isPanning && panStart){
      const dx=(sp.x-panStart.sx)/view.s;
      const dy=(sp.y-panStart.sy)/view.s;
      view.x=panStart.vx+dx;
      view.y=panStart.vy+dy;
      draw();
    }
  }
  function onPointerUp(ev){
    if(pointerMap.has(ev.pointerId)) pointerMap.delete(ev.pointerId);
    if(pointerMap.size===0){ isPanning=false; panStart=null; onPointerMove._pinch=null; saveView(); }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);

  // ===== Start-Glücksrad (entscheidet Startspieler) =====
  // Additiv: Host zeigt beim Start ein Glücksrad und setzt danach den Startspieler via import_state.
  function _ensureStartWheelUI(){
    try{
      if(document.getElementById("startWheelOverlay")) return;
      const style = document.createElement("style");
      style.id = "startWheelStyle";
      style.textContent = `
#startWheelOverlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.62);z-index:9999;opacity:0;pointer-events:none;transition:opacity .2s ease;}
#startWheelOverlay.show{opacity:1;pointer-events:auto;}
#startWheelCard{width:min(560px,94vw);border-radius:18px;background:#111;box-shadow:0 12px 50px rgba(0,0,0,.55);padding:16px 16px 18px 16px;border:1px solid rgba(255,255,255,.12);}
#startWheelTitle{font-weight:900;font-size:18px;margin:0;}
#startWheelSub{opacity:.85;margin:6px 0 0 0;line-height:1.35;font-size:13px;}
#startWheelWrap{display:flex;align-items:center;justify-content:center;padding:10px 0 6px 0;}
#startWheelCanvas{width:min(360px,78vw);height:auto;max-width:360px;aspect-ratio:1/1;}
#startWheelPointer{width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-bottom:18px solid rgba(255,255,255,.9);filter:drop-shadow(0 2px 6px rgba(0,0,0,.6));margin:0 auto -6px auto;}
#startWheelResult{margin-top:10px;font-weight:900;font-size:16px;min-height:22px;}
#startWheelHint{opacity:.7;font-size:12px;margin-top:6px;}
      `;
      document.head.appendChild(style);

      const overlay = document.createElement("div");
      overlay.id = "startWheelOverlay";
      overlay.innerHTML = `
        <div id="startWheelCard">
          <div>
            <div id="startWheelTitle">Startspieler wird ausgelost…</div>
            <p id="startWheelSub">Das Glücksrad dreht…</p>
          </div>
          <div id="startWheelPointer"></div>
          <div id="startWheelWrap">
            <canvas id="startWheelCanvas" width="720" height="720"></canvas>
          </div>
          <div id="startWheelResult"></div>
          <div id="startWheelHint">Der Gewinner beginnt die Partie.</div>
        </div>
      `;
      document.body.appendChild(overlay);
    }catch(_e){}
  }

  function _startWheelDraw(angleRad, colors){
    const cvs = document.getElementById("startWheelCanvas");
    if(!cvs) return;
    const ctx = cvs.getContext("2d");
    const w=cvs.width,h=cvs.height,cx=w/2,cy=h/2;
    const r = Math.min(w,h)*0.44;

    ctx.clearRect(0,0,w,h);

    // ring
    ctx.beginPath();
    ctx.arc(cx,cy,r+18,0,Math.PI*2);
    ctx.fillStyle="rgba(255,255,255,.08)";
    ctx.fill();

    const segN = Math.max(2, colors.length||0);
    const seg = (Math.PI*2)/segN;

    for(let i=0;i<segN;i++){
      const col = colors[i%colors.length] || "red";
      const a0 = angleRad + i*seg - Math.PI/2;
      const a1 = a0 + seg;

      ctx.beginPath();
      ctx.moveTo(cx,cy);
      ctx.arc(cx,cy,r,a0,a1);
      ctx.closePath();

      // use game palette if available
      const fill = (COLORS && COLORS[col]) ? COLORS[col] : col;
      ctx.fillStyle = fill;
      ctx.globalAlpha = 0.78;
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle="rgba(0,0,0,.35)";
      ctx.lineWidth=4;
      ctx.stroke();

      // label
      const mid=(a0+a1)/2;
      ctx.save();
      ctx.translate(cx,cy);
      ctx.rotate(mid);
      ctx.textAlign="right";
      ctx.textBaseline="middle";
      ctx.fillStyle="rgba(255,255,255,.95)";
      ctx.font="900 34px system-ui,-apple-system,Segoe UI,Roboto,Arial";
      const lbl = (PLAYER_NAME && PLAYER_NAME[col]) ? PLAYER_NAME[col] : String(col);
      ctx.fillText(lbl, r-18, 0);
      ctx.restore();
    }

    // hub
    ctx.beginPath();
    ctx.arc(cx,cy,r*0.18,0,Math.PI*2);
    ctx.fillStyle="rgba(0,0,0,.55)";
    ctx.fill();
    ctx.strokeStyle="rgba(255,255,255,.20)";
    ctx.lineWidth=6;
    ctx.stroke();

    ctx.fillStyle="rgba(255,255,255,.92)";
    ctx.font="900 34px system-ui,-apple-system,Segoe UI,Roboto,Arial";
    ctx.textAlign="center";
    ctx.textBaseline="middle";
    ctx.fillText("START", cx, cy);
  }

  let _startWheelAngle = 0;

  function startWheelSpin(colors, durationMs=2800, forcedWinner=null){
    return new Promise((resolve)=>{
      try{
        _ensureStartWheelUI();
        const overlay = document.getElementById("startWheelOverlay");
        const res = document.getElementById("startWheelResult");
        const sub = document.getElementById("startWheelSub");
        if(res) res.textContent = "";
        if(sub) sub.textContent = "Das Glücksrad dreht…";

        const cols = Array.isArray(colors) && colors.length ? colors.slice() : ["red","blue"];
        // pick winner (server-chef can force a winner)
        let idx = -1;
        const fw = forcedWinner ? String(forcedWinner).toLowerCase().trim() : null;
        if(fw) idx = cols.findIndex(c => String(c).toLowerCase() === fw);
        if(idx < 0) idx = Math.floor(Math.random()*cols.length);
        const winner = cols[idx];

        // compute final angle so that idx segment center is at pointer (top)
        const seg = (Math.PI*2)/cols.length;
        const center = (idx + 0.5)*seg;
        const base = -center;
        const spins = 6 + Math.floor(Math.random()*3);
        const finalAngle = base + spins*Math.PI*2;

        const startAngle = _startWheelAngle;
        const delta = finalAngle - startAngle;

        const t0 = performance.now();
        const easeOutCubic = (t)=> 1 - Math.pow(1-t,3);

        if(overlay) overlay.classList.add("show");

        const tick = (now)=>{
          const t = Math.min(1, (now - t0)/durationMs);
          const eased = easeOutCubic(t);
          _startWheelAngle = startAngle + delta*eased;
          _startWheelDraw(_startWheelAngle, cols);
          if(t<1) requestAnimationFrame(tick);
          else{
            if(res) res.textContent = "Startspieler: " + labelForColor(winner);
            window.setTimeout(()=>{
              try{ if(overlay) overlay.classList.remove("show"); }catch(_e){}
              resolve(winner);
            }, 950);
          }
        };

        _startWheelDraw(_startWheelAngle, cols);
        requestAnimationFrame(tick);
      }catch(_e){
        // fallback: no UI
        const cols = Array.isArray(colors) && colors.length ? colors : ["red","blue"];
        resolve(cols[Math.floor(Math.random()*cols.length)]);
      }
    });
  }

  function maybeInitStartStarter(remoteState){
    try{
      if(!_pendingStartStarterPick) return;
      if(netMode !== "host") { _pendingStartStarterPick=false; return; }
      if(!_pendingStartStarterColor) { _pendingStartStarterPick=false; return; }
      if(!remoteState || typeof remoteState !== "object") return;

      const st = JSON.parse(JSON.stringify(remoteState));

      // Support server protocol (turnColor/phase/rolled) and legacy (currentPlayer/dice)
      if(st.turnColor != null) st.turnColor = _pendingStartStarterColor;
      if(st.currentPlayer != null) st.currentPlayer = _pendingStartStarterColor;

      if(st.phase != null) st.phase = "need_roll";
      if(st.rolled != null) st.rolled = null;
      if(st.dice != null) st.dice = null;

      _pendingStartStarterPick = false;
      const starter = _pendingStartStarterColor;
      _pendingStartStarterColor = null;

      wsSend({ type:"import_state", state: st, ts: Date.now(), reason:"init_start_player", starter });
      toast("Startspieler gesetzt: " + labelForColor(starter));
    }catch(_e){
      _pendingStartStarterPick = false;
    }
  }

  async function hostStartWithWheel(mode){
    try{
      const colors = getActiveColors();
      if(!Array.isArray(colors) || colors.length < 2){
        toast("Mindestens 2 Spieler nötig");
        return;
      }
      const winner = await startWheelSpin(colors, 2800);
      _pendingStartStarterColor = winner;
      _pendingStartStarterPick = true;
      // proceed with normal start; starter will be applied on first snapshot
      wsSend({type:"start", mode:mode, ts:Date.now(), startJokers:_START_JOKER_COUNTS, starter:winner});
    }catch(_e){
      wsSend({type:"start", mode:mode, ts:Date.now(), startJokers:_START_JOKER_COUNTS});
    }
  }


  // ===== Buttons =====
  debugToggle && debugToggle.addEventListener("click", () => {
    if(!debugLogEl) return;
    const show = debugLogEl.style.display !== "block";
    debugLogEl.style.display = show ? "block" : "none";
  });

  startBtn && startBtn.addEventListener("click", () => {
    if(netMode!=="host"){ toast("Nur Host kann starten"); return; }
    if(!ws || ws.readyState!==1){ toast("Nicht verbunden"); return; }
    if(state && state.started){ toast("Spiel läuft bereits"); return; }
    if(!netCanStart){ toast("Mindestens 2 Spieler nötig"); return; }
    const _m = (actionModeToggle && actionModeToggle.checked ? "action" : "classic");
    if(_m === "action" && !getStartJokerCounts()){ toast("Host muss in der Lobby 1 bis 5 Joker wählen"); return; }
    _pendingStartMode = _m;
    _pendingStartJokerInit = true;
    // Neu: Startspieler per Glücksrad bestimmen (server-chef, für alle sichtbar)
    wsSend({ type:"start_request", mode:_m, ts:Date.now() });
  });

  // Host-only: unpause / continue after reconnect (server-side paused flag)
  resumeBtn && resumeBtn.addEventListener("click", () => {
    if(netMode!=="host"){ toast("Nur Host kann fortsetzen"); return; }
    if(!ws || ws.readyState!==1){ toast("Nicht verbunden"); return; }
    wsSend({type:"resume", ts:Date.now()});
  });

  
  

  // ===== Joker #4: Doppelwurf (2x würfeln, Summe) (UI inject, additive) =====
  function ensureActionJoker4UI(){
    try{
      if(!actionCard) return;

      // Add status row if missing
      if(!document.getElementById("jokerDoubleState")){
        const row = document.createElement("div");
        row.className = "kv";
        const left = document.createElement("span");
        left.textContent = "🎲🎲 Doppelwurf";
        const right = document.createElement("span");
        right.id = "jokerDoubleState";
        right.textContent = "–";
        row.appendChild(left);
        row.appendChild(right);

        const afterSpan = document.getElementById("jokerRerollState") || document.getElementById("jokerBarricadeState");
        const afterKv = afterSpan ? afterSpan.closest(".kv") : null;
        if(afterKv && afterKv.parentElement){
          afterKv.parentElement.insertBefore(row, afterKv.nextSibling);
        } else {
          actionCard.appendChild(row);
        }
      }

      // Add button if missing
      if(!document.getElementById("jokerDoubleBtn")){
        const grid = actionCard.querySelector(".joker-grid");
        if(grid){
          const btn = document.createElement("button");
          btn.id = "jokerDoubleBtn";
          btn.className = "joker-btn";
          btn.textContent = "🎲🎲 Doppelwurf nutzen";
          grid.appendChild(btn);
        }
      }
    }catch(_e){}
  }
  try{ ensureActionJoker4UI(); }catch(_e){}
  try{ hideLegacyChooseSumUI(); }catch(_e){}

  jokerDoubleState = $("jokerDoubleState");
  let jokerDoubleBtn = $("jokerDoubleBtn");
// ===== Action-Modus B1: Joker "Alle Farben" (nach dem Wurf) =====
  if(jokerAllColorsBtn){
  jokerAllColorsBtn.addEventListener("click", () => {
      if (!isActionMode()) return;
      const eff = state?.action?.effects || {};
      // Toggle: if already active for me -> cancel
      if (eff.allColorsBy && myColor && String(eff.allColorsBy).toLowerCase() === String(myColor).toLowerCase()) {
        wsSend({ type: "cancel_joker", joker: "allcolors" });
        toast("Alle-Farben Joker abgewählt");
        return;
      }
      wsSend({ type: "use_joker", joker: "allcolors" });
    });
  }

  // Barrikade-Joker: VOR dem Wurf aktivieren, danach Quelle+Ziel klicken
  jokerBarricadeBtn.addEventListener("click", () => {
      if (!isActionMode()) return;

      const eff = state?.action?.effects || {};
      const effByMe = (eff.barricadeBy && myColor && String(eff.barricadeBy).toLowerCase() === String(myColor).toLowerCase());

      // Toggle OFF: cancel local selection / effect
      if (actionBarricadeActive || actionBarricadeFrom || pendingBarricadePick) {
        actionBarricadeActive = false;
        actionBarricadeFrom = null;
        pendingBarricadePick = false;
        if (effByMe) wsSend({ type: "cancel_joker", joker: "barricade" });
        toast("Barikade-Joker abgewählt");
        draw();
        return;
      }

      // If effect already active (server-side), we enter selection mode
      if (effByMe) {
        actionBarricadeActive = true;
        actionBarricadeFrom = null;
        pendingBarricadePick = true;
        toast("Barikade-Joker aktiv: Quelle wählen (oder Joker erneut klicken zum Abbrechen)");
        draw();
        return;
      }

      // Otherwise: activate on server
      wsSend({ type: "use_joker", joker: "barricade" });
    });


  // Helper: robust access to action joker set for current player (server snapshot is source of truth)
function getMyJokerSet(){
  try{
    const c = (myColor || (state && state.currentPlayer)) || null;
    if(!c) return null;
    // preferred path (server v14+)
    if(state && state.action && state.action.jokersByColor && state.action.jokersByColor[c]) return state.action.jokersByColor[c];
    // backward-compat fallbacks (older builds)
    if(state && state.actionJokers && state.actionJokers[c]) return state.actionJokers[c];
    if(state && state.jokers && state.jokers[c]) return state.jokers[c];
  }catch(_e){}
  return null;
}

function jokerCount(obj, key){
  try{
    if(!obj) return 0;
    const v = obj[key];
    if(v===true) return 1;
    if(v===false || v==null) return 0;
    if(typeof v==="number" && isFinite(v)) return Math.max(0, Math.floor(v));
  }catch(_e){}
  return 0;
}
function hasJoker(obj, key){ return jokerCount(obj, key) > 0; }

// Neu-Wurf-Joker: NACH dem Wurf -> erster Wurf verfällt, dann neu würfeln
  const bindReroll = () => {
    jokerRerollBtn = document.getElementById("jokerRerollBtn");
    if(!jokerRerollBtn || jokerRerollBtn.__bound) return;
    jokerRerollBtn.__bound = true;
    jokerRerollBtn.addEventListener("click", () => {
      if(netMode==="offline" || !ws || ws.readyState!==1) { toast("Nicht verbunden"); return; }
      if(!state || !state.started) { toast("Spiel läuft nicht"); return; }
      if(String(state.mode||"classic")!=="action") { toast("Action-Modus ist nicht aktiv"); return; }
      if(state.currentPlayer!==myColor) { toast("Nicht dein Zug"); return; }
      if(state.phase!=="need_move" || state.dice==null) { toast("Erst würfeln – dann Neu-Wurf"); return; }
      const set = getMyJokerSet();
      if(!hasJoker(set,"reroll")) { toast("Neu-Wurf nicht verfügbar"); return; }
      wsSend({ type: "use_joker", joker: "reroll" });
    });
  };

  // Joker #4: Doppelwurf (vor dem Würfeln)
  const bindDouble = () => {
    jokerDoubleBtn = document.getElementById("jokerDoubleBtn");
    if(!jokerDoubleBtn || jokerDoubleBtn.__bound) return;
    jokerDoubleBtn.__bound = true;
    jokerDoubleBtn.addEventListener("click", () => {
      if (!isActionMode()) return;

      const eff = state?.action?.effects || {};
      const pendingByMe = !!(eff.doubleRoll && myColor
        && String(eff.doubleRoll.by).toLowerCase() === String(myColor).toLowerCase()
        && eff.doubleRoll.pending === true);

      // Toggle: cancel pending double-roll (before rolling)
      if (pendingByMe) {
        wsSend({ type: "cancel_joker", joker: "double" });
        toast("Doppelwurf abgewählt");
        return;
      }

      wsSend({ type: "use_joker", joker: "double" });
    });
  };

  // bind now + also after UI injection
  // ESC cancels active joker selection (no risk, client-side convenience)
  if (!window.__barikadeEscJokerBound) {
    window.__barikadeEscJokerBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      try {
        const eff = state?.action?.effects || {};
        const effByMe = (eff.barricadeBy && myColor && String(eff.barricadeBy).toLowerCase() === String(myColor).toLowerCase());
        if (actionBarricadeActive || actionBarricadeFrom || pendingBarricadePick) {
          actionBarricadeActive = false;
          actionBarricadeFrom = null;
          pendingBarricadePick = false;
          if (effByMe) wsSend({ type: 'cancel_joker', joker: 'barricade' });
          toast('Joker abgewählt');
          draw();
          return;
        }
        const allByMe = (eff.allColorsBy && myColor && String(eff.allColorsBy).toLowerCase() === String(myColor).toLowerCase());
        if (allByMe) {
          wsSend({ type: 'cancel_joker', joker: 'allcolors' });
          toast('Joker abgewählt');
          return;
        }
        const dblByMe = !!(eff.doubleRoll && myColor && String(eff.doubleRoll.by).toLowerCase() === String(myColor).toLowerCase() && eff.doubleRoll.pending === true);
        if (dblByMe) {
          wsSend({ type: 'cancel_joker', joker: 'double' });
          toast('Joker abgewählt');
          return;
        }
      } catch (_e) {}
    });
  }
  bindReroll();
  bindDouble();



rollBtn.addEventListener("click", () => {
    if(netMode!=="offline"){
      if(!ws || ws.readyState!==1){ toast("Nicht verbunden"); return; }
      // server checks turn
      wsSend({type:"roll_request", ts:Date.now()});
      return;
    }
    rollDice();
    if(netMode==="host") broadcastState("state");
  });

  endBtn.addEventListener("click", () => {
    if(netMode!=="offline"){
      if(!ws || ws.readyState!==1){ toast("Nicht verbunden"); return; }
      wsSend({type:"end_turn", ts:Date.now()});
      return;
    }
    if(phase!=="placing_barricade" && phase!=="game_over") nextPlayer();
    if(netMode==="host") broadcastState("state");
  });

  if(skipBtn) skipBtn.addEventListener("click", () => {
    if(netMode!=="offline"){
      if(!myColor){ toast("Bitte Farbe wählen"); return; }
      if(myColor!==state.currentPlayer){ toast("Du bist nicht dran"); return; }
      if(!ws || ws.readyState!==1){ toast("Nicht verbunden"); return; }
      wsSend({type:"skip_turn", ts:Date.now()});
      return;
    }
    if(phase!=="placing_barricade" && phase!=="game_over"){ toast("Runde ausgesetzt"); nextPlayer(); }
    if(netMode==="host") broadcastState("state");
  });

  resetBtn.addEventListener("click", () => {
    if(netMode==="offline"){
      newGame();
      return;
    }
    if(!ws || ws.readyState!==1){ toast("Nicht verbunden"); return; }
    wsSend({type:"reset", ts:Date.now()});
  });

  // Online actions
  hostBtn.addEventListener("click", () => {
    netMode = "host";
    clientId = clientId || ("H-" + randId(8));
    roomCode = normalizeRoomCode(roomCodeInp.value) || randId(6);
    roomCodeInp.value = roomCode;
    saveSession();
    connectWS();
    toast("Host gestartet – teile den Raumcode");
  });

  joinBtn.addEventListener("click", () => {
    netMode = "client";
    clientId = clientId || ("C-" + randId(8));
    roomCode = normalizeRoomCode(roomCodeInp.value);
    if(!roomCode){ toast("Bitte Raumcode eingeben"); return; }
    saveSession();
    connectWS();
    toast("Beitreten…");
  });

  

  // Farbauswahl (nur Lobby): Wunsch speichern + an Server schicken
  function requestColor(color){
    const c = String(color||"").toLowerCase();
    if(!(c==="red"||c==="blue"||c==="green"||c==="yellow")) return;
    setRequestedColor(c);
    updateColorPickUI();
    if(ws && ws.readyState===1){
      wsSend({ type:"request_color", color: c, ts: Date.now() });
    } else {
      toast("Wunschfarbe gespeichert (wird beim Join gesendet)");
    }
  }

  // Handlers werden zentral ueber bindColorPickHandlers() gebunden,
  // damit es auch funktioniert, wenn die Buttons erst per JS erzeugt wurden.
  bindColorPickHandlers();
leaveBtn.addEventListener("click", () => {
    netMode = "offline";
    saveSession();
    disconnectWS();
    setNetPlayers([]);
    updateHostToolsUI();
    toast("Offline");
  });

  // Host tools (Save/Load) – only host can use
  if(saveBtn) saveBtn.addEventListener("click", () => {
    if(!isMeHost()) { toast("Nur Host"); return; }

    // Allow Save even during reconnect / offline WS, using the last known snapshot in memory.
    if(!ws || ws.readyState!==1){
      if(!state){
        toast("Kein Spielstand im Speicher");
        return;
      }
      const st = serializeState();
      const ok = downloadJSON(st, `barikade_save_offline_${roomCode || "room"}.json`);
      toast(ok ? "Offline-Save heruntergeladen" : "Save fehlgeschlagen");
      return;
    }

    pendingSaveExport = true;
    wsSend({ type:"export_state", ts: Date.now() });
    toast("Save angefordert…");
  });

  if(loadBtn) loadBtn.addEventListener("click", () => {
    if(!isMeHost()) { toast("Nur Host"); return; }
    if(!loadFile) return;
    loadFile.value = "";
    loadFile.click();
  });

  if(loadFile) loadFile.addEventListener("change", async () => {
    if(!isMeHost()) { toast("Nur Host"); return; }
    const f = loadFile.files && loadFile.files[0];
    if(!f) return;
    const text = await f.text();
    let st = null;
    try { st = JSON.parse(text); } catch(_e) { toast("Ungültige JSON"); return; }
    if(!ws || ws.readyState!==1){ toast("Nicht verbunden"); return; }
    wsSend({ type:"import_state", state: st, ts: Date.now() });
    toast("Load gesendet…");
  });

  // Host tool: Restore last Auto-Save from browser (useful after server sleep/restart on Render)
  if(restoreBtn) restoreBtn.addEventListener("click", () => {
    if(!isMeHost()) { toast("Nur Host"); return; }
    const v = readHostAutosave();
    if(!v || !v.state){ toast("Kein Auto‑Save gefunden"); return; }
    if(!ws || ws.readyState!==1){
      // even if offline, allow downloading the autosave so nothing is lost
      const ok = downloadJSON(v.state, `barikade_restore_offline_${roomCode || "room"}.json`);
      toast(ok ? "Nicht verbunden – Restore als Datei gespeichert" : "Restore fehlgeschlagen");
      return;
    }
    wsSend({ type:"import_state", state: v.state, ts: Date.now(), reason:"host_autosave_restore" });
    toast("Auto‑Save wiederherstellen…");
  });

  // Host tool: Notfall – Farben tauschen (Rot ↔ Blau)
  if(swapColorsBtn) swapColorsBtn.addEventListener("click", () => {
    if(!isMeHost()) { toast("Nur Host"); return; }
    if(!ws || ws.readyState!==1){ toast("Nicht verbunden"); return; }
    wsSend({ type:"swap_colors", ts: Date.now() });
    toast("Farben tauschen…");
  });


  // (Legacy) In aelteren Offline-Versionen gab es chooseColor().
  // Wir binden hier NICHT doppelt, um keine Doppel-Sends zu erzeugen.

  // ===== Host: intent processing =====
  function colorOf(id){
    const p = rosterById.get(id) || null;
    return p && p.color ? p.color : null;
  }
  function roleOf(id){
    const p = rosterById.get(id) || null;
    return p && p.role ? p.role : null;
  }
  function handleRemoteIntent(intent, senderId=""){
    const senderColor = colorOf(senderId);
    const mustBeTurnPlayer = () => senderColor && senderColor===state.currentPlayer;

    const t = intent.type;
    if(t==="roll"){
      if(!mustBeTurnPlayer()) return;
      rollDice(); broadcastState("state"); return;
    }
    if(t==="end"){
      if(!mustBeTurnPlayer()) return;
      if(phase!=="placing_barricade" && phase!=="game_over") nextPlayer();
      broadcastState("state"); return;
    }
    if(t==="skip"){
      if(!mustBeTurnPlayer()) return;
      if(phase!=="placing_barricade" && phase!=="game_over"){ toast("Runde ausgesetzt"); nextPlayer(); }
      broadcastState("state"); return;
    }
    if(t==="reset"){
      if(roleOf(senderId)!=="host") return;
      newGame(); broadcastState("snapshot"); return;
    }
    if(t==="move"){
      if(!mustBeTurnPlayer()) return;
      if(phase!=="need_move") return;

      const toId = intent.toId;
      const pieceIndex = Number(intent.pieceIndex);
      if(!toId || !(pieceIndex>=0 && pieceIndex<5)) return;

      const list = legalMovesByPiece.get(pieceIndex) || [];
      const m = list.find(x=>x.toId===toId && x.piece.color===senderColor);
      if(m){ movePiece(m); broadcastState("state"); return; }
      return;
    }
    if(t==="placeBarricade"){
      if(!mustBeTurnPlayer()) return;
      if(phase!=="placing_barricade") return;
      placeBarricade(intent.nodeId);
      broadcastState("state");
      return;
    }
  }

  // ===== Init =====
  (async function init(){
    try{
      board = await loadBoard();
      buildGraph();
      resize();

      // restore previous view if available (optional)
      let hadSavedView = false;
      if(AUTO_CENTER_ALWAYS){
        clearView();
        hadSavedView = false;
      }else{
        hadSavedView = loadView();
      }

      // auto center
      if(AUTO_CENTER_ALWAYS || !hadSavedView){
      const xs = board.nodes.map(n=>n.x), ys=board.nodes.map(n=>n.y);
      const minX=Math.min(...xs), maxX=Math.max(...xs);
      const minY=Math.min(...ys), maxY=Math.max(...ys);
      const cx=(minX+maxX)/2, cy=(minY+maxY)/2;
      const rect = canvas.getBoundingClientRect();
      const bw=(maxX-minX)+200, bh=(maxY-minY)+200;
      const sx=rect.width/Math.max(200,bw), sy=rect.height/Math.max(200,bh);
      view.s = Math.max(0.35, Math.min(1.4, Math.min(sx,sy)));
      view.x = (rect.width/2)/view.s - cx;
      view.y = (rect.height/2)/view.s - cy;

      }

      // ensure board is on-screen immediately
      view._fittedOnce = false;
      try{ ensureFittedOnce(); }catch(_e){}

      const sess = loadSession();
      clientId = sess.id || "";
      if(sess.r){ roomCode = normalizeRoomCode(sess.r); roomCodeInp.value = roomCode; }
      if(sess.m==="host" || sess.m==="client"){
        netMode = sess.m;
        setNetStatus("Reconnect…", false);
        connectWS();
      }
      if(netMode==="offline"){
        newGame();
      }
      toast("Bereit. Online: Host/Beitreten.");
    }catch(err){
      showOverlay("Fehler","Board konnte nicht geladen werden", String(err.message||err));
      console.error(err);
    }
  })();
})();


// ===== Dice Dock (safe) =====
// The dice should stay inside the "Würfel" card next to the Roll button.
// Some older patches forced CSS transforms to "none" which can make the 3D dice invisible.
// This helper ONLY ensures the element is inside the dicePill (if present) and does not override transforms.
(function ensureDiceInDiceCard(){
  function dock(){
    const dice = document.getElementById("diceCube");
    const rollBtn = document.getElementById("rollBtn");
    if(!dice || !rollBtn) return false;

    const diceCard =
      rollBtn.closest(".card") ||
      rollBtn.closest(".panel") ||
      rollBtn.closest("section") ||
      rollBtn.parentElement;

    if(!diceCard) return false;

    const pill = diceCard.querySelector(".dicePill");

// Create a wrapper inside the pill so we can scale/center the 3D cube without touching its own transform.
let wrap = pill ? pill.querySelector("#diceDockWrap") : null;
if(pill && !wrap){
  wrap = document.createElement("div");
  wrap.id = "diceDockWrap";
  wrap.style.position = "absolute";
  wrap.style.inset = "0";
  wrap.style.display = "flex";
  wrap.style.alignItems = "center";
  wrap.style.justifyContent = "center";
  // Scale the whole cube to fit the small pill (change 0.62 if you want a bit bigger/smaller)
  wrap.style.transform = "scale(1.0)";
  wrap.style.transformOrigin = "50% 50%";
  pill.style.position = pill.style.position || "relative";
  pill.style.overflow = "hidden";
  pill.appendChild(wrap);
}

if(pill){
  // Ensure the cube is inside the wrapper (keeps cube transform intact)
  if(wrap && !wrap.contains(dice)) wrap.appendChild(dice);
  else if(!pill.contains(dice)) pill.appendChild(dice);
} else if(!diceCard.contains(dice)){
  diceCard.appendChild(dice);
}

// IMPORTANT: do NOT touch `transform` here (3D dice uses it).
dice.style.position = "relative";
dice.style.left = "";
dice.style.top = "";
dice.style.right = "";
dice.style.bottom = "";

    return true;
  }

  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    if(dock() || tries > 40) clearInterval(iv);
  }, 120);

  

// =========================
// Back to Lobby (safe leave)
// =========================
(function wireBackToLobby(){
  const btn = document.getElementById("backLobbyBtn");
  if(!btn) return;
  btn.addEventListener("click", () => {
    try{
      // Close WS to ensure server sees disconnect and lobby "joined" list updates.
      if(ws && (ws.readyState===0 || ws.readyState===1)){
        try{ ws.close(); }catch(_e){}
      }
    }catch(_e){}
    // Clear transient session token so next start is clean
    try{ localStorage.removeItem("barikade_sessionToken"); }catch(_e){}
    // Navigate back
    window.location.href = "barikade_lobby.html";
  });
})();

window.addEventListener("load", () => { try{ dock(); }catch(_e){} });
})();


// ---------- Wheel UI (client only, does not block gameplay) ----------
let _wheelQueue = [];
let _wheelBusy = false;

function enqueueWheel(list) {
  try {
    for (const it of list) _wheelQueue.push(it);
    if (!_wheelBusy) _wheelNext();
  } catch (_e) {}
}

// ----- Wheel UI (visual spinning wheel) -----
// Note: Pure UI. Server already decides the result. No game-state changes here.
const _WHEEL_SEGMENTS = [
  { key: "allColors", label: "Alle Farben" },
  { key: "barricade", label: "Barikade" },
  { key: "reroll",    label: "Neu-Wurf" },
  { key: "double",    label: "Doppelwurf" },
];

let _wheelAngle = 0; // radians (0 = segment 0 centered at top after calibration)

function _wheelEnsureUI() {
  if (document.getElementById("wheelOverlay")) return;

  const style = document.createElement("style");
  style.id = "wheelStyle";
  style.textContent = `
#wheelOverlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.62);z-index:9999;opacity:0;pointer-events:none;transition:opacity .2s ease;}
#wheelOverlay.show{opacity:1;pointer-events:auto;}
#wheelCard{width:min(560px,94vw);border-radius:18px;background:#111;box-shadow:0 12px 50px rgba(0,0,0,.55);padding:16px 16px 18px 16px;border:1px solid rgba(255,255,255,.12);}
#wheelHeader{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px;}
#wheelTitle{font-weight:800;font-size:18px;margin:0;}
#wheelSub{opacity:.85;margin:6px 0 0 0;line-height:1.35;font-size:13px;}
#wheelBig{margin-top:10px;font-weight:900;font-size:28px;letter-spacing:.2px;line-height:1.1;text-transform:uppercase;text-align:center;}
@media (max-width:420px){#wheelBig{font-size:22px;}}
#wheelQuote{margin-top:8px;font-size:15px;line-height:1.35;color:#d7d7ff;text-align:center;opacity:.95;}

#wheelWrap{display:flex;align-items:center;justify-content:center;padding:10px 0 6px 0;}
#wheelCanvas{width:min(360px,78vw);height:auto;max-width:360px;aspect-ratio:1/1;}
#wheelPointer{width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-bottom:18px solid rgba(255,255,255,.9);filter:drop-shadow(0 2px 6px rgba(0,0,0,.6));margin:0 auto -6px auto;}
#wheelResult{margin-top:10px;font-weight:800;font-size:16px;min-height:22px;}
#wheelHint{opacity:.7;font-size:12px;margin-top:6px;}
  `;
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.id = "wheelOverlay";
  overlay.innerHTML = `
    <div id="wheelCard">
      <div id="wheelHeader">
        <div>
          <div id="wheelTitle">Gluecksrad</div>
          <p id="wheelSub">Das Rad dreht...</p>
          <div id="wheelBig"></div>
          <div id="wheelQuote"></div>
        </div>
      </div>
      <div id="wheelPointer"></div>
      <div id="wheelWrap">
        <canvas id="wheelCanvas" width="720" height="720"></canvas>
      </div>
      <div id="wheelResult"></div>
      <div id="wheelHint">Joker-Rad (ohne Nieten)</div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function _wheelDraw(angleRad) {
  const cvs = document.getElementById("wheelCanvas");
  if (!cvs) return;
  const ctx = cvs.getContext("2d");
  const w = cvs.width, h = cvs.height;
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) * 0.44;

  ctx.clearRect(0, 0, w, h);

  // outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, r + 18, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,.08)";
  ctx.fill();

  // segments
  const segN = _WHEEL_SEGMENTS.length;
  const seg = (Math.PI * 2) / segN;

  for (let i = 0; i < segN; i++) {
    const a0 = angleRad + i * seg - Math.PI / 2;
    const a1 = a0 + seg;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();

    // alternating fill
    ctx.fillStyle = (i % 2 === 0) ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.10)";
    ctx.fill();

    // border
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.lineWidth = 4;
    ctx.stroke();

    // label
    const mid = (a0 + a1) / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(mid);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.font = "bold 34px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText(_WHEEL_SEGMENTS[i].label, r - 18, 0);
    ctx.restore();
  }

  // center hub
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.20)";
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.font = "bold 36px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("RAD", cx, cy);
}

function _wheelResolveIndex(resultKey) {
  const key = String(resultKey || "").trim();
  if (!key) {
    // Fallback: random segment (keine Nieten mehr)
    return Math.floor(Math.random() * _WHEEL_SEGMENTS.length);
  }
  const k = key.toLowerCase();
  for (let i = 0; i < _WHEEL_SEGMENTS.length; i++) {
    if (_WHEEL_SEGMENTS[i].key.toLowerCase() === k) return i;
  }
  // if server sends "allColors" etc. with odd formatting
  const norm = k.replace(/[^a-z]/g, "");
  for (let i = 0; i < _WHEEL_SEGMENTS.length; i++) {
    if (_WHEEL_SEGMENTS[i].key.toLowerCase() === norm) return i;
  }
  return 0;
}

function _wheelNext() {
  const item = _wheelQueue.shift();
  if (!item) { _wheelBusy = false; return; }
  _wheelBusy = true;

  _wheelEnsureUI();
  const overlay = document.getElementById("wheelOverlay");
  const title = document.getElementById("wheelTitle");
  const sub = document.getElementById("wheelSub");
  const res = document.getElementById("wheelResult");
  const big = document.getElementById("wheelBig");
  const quote = document.getElementById("wheelQuote");

  const _colorName = (c)=>({RED:"Rot",BLUE:"Blau",GREEN:"Gruen",YELLOW:"Gelb"}[String(c||"").toUpperCase()] || String(c||""));
  const attackerName = String(item.attackerName || "").trim();
  const victimName = String(item.victimName || "").trim();
  const attackerLabel = attackerName || (_colorName(item.targetColor) || "Jemand");
  const victimLabel = victimName || (_colorName(item.jokerColor) || "jemanden");
  const headline = attackerLabel + " schmeisst " + victimLabel + " raus!";
  if (big) big.textContent = headline;
  if (quote) quote.textContent = String(item.quote || "");


  const targetColor = String(item.targetColor || "").toUpperCase();
  const durationMs = 5000; // Christoph-Wunsch: immer 5 Sekunden

  title.textContent = "Gluecksrad fuer " + (targetColor || "Spieler");
  sub.textContent = "Das Rad dreht...";
  res.textContent = "";

  overlay.classList.add("show");

  // Determine target segment based on server result.
  const idx = _wheelResolveIndex(item.result);

  // Compute final angle so that the segment center lands at the pointer (top).
  const seg = (Math.PI * 2) / _WHEEL_SEGMENTS.length;
  const center = (idx + 0.5) * seg;
  const base = -center; // because draw rotates labels by angleRad and we subtract pi/2 inside draw
  const spins = 6 + Math.floor(Math.random() * 3); // 6..8 full rotations
  const finalAngle = base + spins * Math.PI * 2;

  const startAngle = _wheelAngle;
  const delta = finalAngle - startAngle;

  const t0 = performance.now();
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  const tick = (now) => {
    const t = Math.min(1, (now - t0) / durationMs);
    const eased = easeOutCubic(t);
    _wheelAngle = startAngle + delta * eased;
    _wheelDraw(_wheelAngle);
    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      const r = item.result;
      if (r) {
        const pretty = (_WHEEL_SEGMENTS[idx] && _WHEEL_SEGMENTS[idx].key !== "none") ? _WHEEL_SEGMENTS[idx].label : String(r);
        res.textContent = "Joker gewonnen: " + pretty;
      } else {
        res.textContent = "Kein Joker erhalten.";
      }
      // hide shortly after
      window.setTimeout(() => {
        overlay.classList.remove("show");
        window.setTimeout(() => _wheelNext(), 250);
      }, 1200);
    }
  };

  // initial draw and start animation
  _wheelDraw(_wheelAngle);
  requestAnimationFrame(tick);
}

  // ---------- Aufgeben (Forfeit) ----------
  if(forfeitBtn) forfeitBtn.addEventListener("click", () => {
    if(netMode==="offline"){
      toast("Aufgeben ist nur im Online-Spiel (Server) aktiv.");
      return;
    }
    if(!myColor){ toast("Bitte Farbe wählen"); return; }
    if(!ws || ws.readyState!==1){ toast("Keine Verbindung"); return; }
    const ok = confirm("Wirklich aufgeben? Gewinner ist dann der Spieler, der am nächsten am Ziel ist.");
    if(!ok) return;
    wsSend({ type:"forfeit", ts:Date.now() });
    toast("Du hast aufgegeben…");
  });

