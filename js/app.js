// Orchestrates UI, game state and networking.
(function () {
  const BS = window.BS;
  const SIZE = BS.SIZE;
  const sfx = BS.sfx;
  const LETTERS = "ABCDEFGHIJ";

  const game = new BS.Game();
  const net = new BS.Net();

  const state = {
    myName: "",
    oppName: "Opponent",
    code: "",
    placeHorizontal: true,
    selectedShip: 0,
    preview: null,        // {x, y} while hovering during placement
    myTurn: false,
    pending: false,       // waiting for the result of my shot
    myReady: false,
    oppReady: false,
    started: false,
    myRematch: false,
    oppRematch: false,
    restarting: false,
    joinTimer: null,
    sonarLeft: 1,         // sonar sweeps remaining this game
    sonarArmed: false,    // next click on enemy waters scans instead of fires
  };

  // ---------- DOM helpers ----------
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  function show(id) {
    $$(".screen").forEach(s => s.classList.add("hidden"));
    $(id).classList.remove("hidden");
  }

  function toast(msg, ms) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), ms || 2800);
  }

  function setConn(online) {
    const p = $("#conn-pill");
    p.textContent = online ? "connected" : "offline";
    p.className = "pill " + (online ? "pill-on" : "pill-off");
  }

  // ---------- Grid building ----------
  function buildGrid(el, clickable, onClick, onHover) {
    el.innerHTML = "";
    el.appendChild(label(""));
    for (let x = 0; x < SIZE; x++) el.appendChild(label(LETTERS[x]));
    for (let y = 0; y < SIZE; y++) {
      el.appendChild(label(String(y + 1)));
      for (let x = 0; x < SIZE; x++) {
        const c = document.createElement("button");
        c.className = "cell";
        c.type = "button";
        c.dataset.x = x;
        c.dataset.y = y;
        if (clickable) {
          c.addEventListener("click", () => onClick(x, y));
          if (onHover) c.addEventListener("mouseenter", () => onHover(x, y));
        } else {
          c.tabIndex = -1;
        }
        el.appendChild(c);
      }
    }
    if (onHover) el.addEventListener("mouseleave", () => onHover(-1, -1));
  }

  function label(t) {
    const d = document.createElement("div");
    d.className = "lab";
    d.textContent = t;
    return d;
  }

  function eachCell(el, fn) {
    el.querySelectorAll(".cell").forEach(c => fn(c, +c.dataset.x, +c.dataset.y));
  }

  // A little hull silhouette whose length scales with the ship's size.
  function shipIcon(size) {
    let segs = "";
    for (let i = 0; i < size; i++) {
      const cls = "seg" + (i === size - 1 ? " bow" : "") + (i === 1 ? " tower" : "");
      segs += '<span class="' + cls + '"></span>';
    }
    return '<span class="ship-icon" aria-hidden="true">' + segs + "</span>";
  }

  // ---------- Home ----------
  function setupHome() {
    const saved = localStorage.getItem("bs-name");
    if (saved) $("#name-input").value = saved;

    const params = new URLSearchParams(location.search);
    const g = params.get("game");
    if (g) {
      $("#join-code").value = g.toUpperCase().slice(0, 5);
      $("#home-hint").textContent = "You've been invited to game " + g.toUpperCase() + " — enter your name and hit Join!";
      $("#name-input").focus();
    }

    $("#create-btn").addEventListener("click", () => {
      const name = requireName();
      if (!name) return;
      startHost();
    });
    $("#join-btn").addEventListener("click", () => {
      const name = requireName();
      if (!name) return;
      const code = $("#join-code").value.trim().toUpperCase();
      if (code.length < 4) { toast("Enter the game code your friend sent you."); return; }
      startJoin(code);
    });
    $("#join-code").addEventListener("keydown", e => { if (e.key === "Enter") $("#join-btn").click(); });
    $("#name-input").addEventListener("input", () => localStorage.setItem("bs-name", $("#name-input").value.trim()));
  }

  function requireName() {
    const name = $("#name-input").value.trim();
    if (!name) { toast("Captain, we need your name first!"); $("#name-input").focus(); return null; }
    state.myName = name;
    localStorage.setItem("bs-name", name);
    sfx.resume();
    return name;
  }

  // ---------- Lobby ----------
  function startHost() {
    state.code = BS.makeCode();
    show("#screen-lobby");
    $("#lobby-title").textContent = "Waiting for your opponent…";
    $("#lobby-host").classList.remove("hidden");
    $("#code-display").textContent = state.code;
    $("#lobby-status").textContent = "Keep this tab open — the game starts the moment they join.";
    net.host(state.code);
  }

  function startJoin(code) {
    state.code = code;
    show("#screen-lobby");
    $("#lobby-title").textContent = "Connecting to game " + code + "…";
    $("#lobby-host").classList.add("hidden");
    $("#lobby-status").textContent = "Hailing the other ship…";
    net.join(code);
    clearTimeout(state.joinTimer);
    state.joinTimer = setTimeout(() => {
      if (!net.conn || !net.conn.open) {
        toast("Couldn't reach that game. Double-check the code and that your friend is waiting.");
        backHome();
      }
    }, 15000);
  }

  function setupLobby() {
    $("#copy-code").addEventListener("click", () => copy(state.code, "Code copied!"));
    $("#copy-link").addEventListener("click", () => copy(inviteLink(), "Invite link copied!"));
    $("#lobby-cancel").addEventListener("click", backHome);
  }

  function inviteLink() {
    return location.origin + location.pathname + "?game=" + state.code;
  }

  function copy(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast(okMsg)).catch(() => toast(text));
    } else {
      toast(text);
    }
  }

  function backHome() {
    clearTimeout(state.joinTimer);
    net.close();
    setConn(false);
    resetMatchState();
    game.reset();
    show("#screen-home");
  }

  function resetMatchState() {
    state.myTurn = false; state.pending = false;
    state.myReady = false; state.oppReady = false;
    state.started = false; state.restarting = false;
    state.myRematch = false; state.oppRematch = false;
    state.selectedShip = 0; state.placeHorizontal = true; state.preview = null;
  }

  // ---------- Networking events ----------
  function setupNet() {
    net.on("open", () => { /* host id is ready; nothing else needed */ });

    net.on("connected", () => {
      clearTimeout(state.joinTimer);
      setConn(true);
      net.send({ type: "hello", name: state.myName });
      toast("Connected! Battle stations.");
      enterPlacement();
    });

    net.on("data", onMessage);

    net.on("closed", () => {
      setConn(false);
      if (game.phase !== "over") {
        toast(state.oppName + " left the game.");
        setTimeout(backHome, 1500);
      }
    });

    net.on("peererror", e => {
      const type = e && e.type;
      if (type === "unavailable-id") { toast("That code was taken — getting a fresh one."); startHost(); return; }
      if (type === "peer-unavailable") { toast("No game found with code " + state.code + "."); backHome(); return; }
      if (type === "browser-incompatible") { toast("Your browser doesn't support peer-to-peer play."); return; }
      if (type === "network" || type === "server-error" || type === "socket-error") {
        toast("Network hiccup reaching the matchmaking broker. Try again."); return;
      }
      toast("Connection error" + (type ? " (" + type + ")" : "") + ".");
    });

    net.on("connerror", () => { /* surfaced via 'closed' in practice */ });
  }

  function onMessage(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case "hello":
        state.oppName = (msg.name || "Opponent").slice(0, 16);
        updateNames();
        break;
      case "ready":
        state.oppReady = true;
        updateOppStatus();
        maybeStart();
        break;
      case "start":
        if (!net.isHost) beginBattle(msg.first);
        break;
      case "fire":
        handleIncomingFire(msg.x, msg.y);
        break;
      case "result":
        handleResult(msg);
        break;
      case "sonar":
        handleIncomingSonar(msg.x, msg.y);
        break;
      case "sonar-result":
        handleSonarResult(msg);
        break;
      case "chat":
        addChat(state.oppName, msg.text, false);
        sfx.chat();
        break;
      case "rematch":
        state.oppRematch = true;
        if (!state.myRematch) { toast(state.oppName + " wants a rematch!"); $("#rematch-btn").classList.add("btn-primary"); }
        maybeRematch();
        break;
    }
  }

  function updateNames() {
    $("#enemy-name").textContent = state.oppName ? "· " + state.oppName : "";
    $("#my-name").textContent = state.myName ? "· " + state.myName : "";
  }

  // ---------- Placement ----------
  function enterPlacement() {
    game.phase = "placement";
    state.selectedShip = firstUnplaced();
    state.placeHorizontal = true;
    show("#screen-place");
    $("#place-heading").textContent = "Deploy your fleet, Captain " + state.myName;
    buildGrid($("#place-board"), true, placeClick, placeHover);
    renderPlaceBoard();
    renderDock();
    updateOppStatus();
    $("#ready-btn").disabled = !game.allPlaced();
  }

  function firstUnplaced() {
    const s = game.ships.find(s => !s.placed);
    return s ? s.id : null;
  }

  function previewCells() {
    if (state.preview == null || state.selectedShip == null) return null;
    const sh = game.ship(state.selectedShip);
    const cells = [];
    for (let i = 0; i < sh.size; i++) {
      const cx = state.preview.x + (state.placeHorizontal ? i : 0);
      const cy = state.preview.y + (state.placeHorizontal ? 0 : i);
      cells.push({ x: cx, y: cy });
    }
    const valid = game.canPlace(state.selectedShip, state.preview.x, state.preview.y, state.placeHorizontal);
    return { cells, valid };
  }

  function renderPlaceBoard() {
    const board = $("#place-board");
    const pv = previewCells();
    eachCell(board, (c, x, y) => {
      c.className = "cell";
      if (game.board[y][x] !== null) c.classList.add("ship");
    });
    if (pv) {
      pv.cells.forEach(cell => {
        if (cell.x < 0 || cell.y < 0 || cell.x >= SIZE || cell.y >= SIZE) return;
        const el = board.querySelector('.cell[data-x="' + cell.x + '"][data-y="' + cell.y + '"]');
        if (el) el.classList.add(pv.valid ? "preview" : "preview-bad");
      });
    }
  }

  function renderDock() {
    const dock = $("#ship-dock");
    dock.innerHTML = "";
    game.ships.forEach(sh => {
      const li = document.createElement("li");
      li.className = "ship-item" + (sh.placed ? " placed" : "") + (sh.id === state.selectedShip ? " selected" : "");
      li.innerHTML = '<span class="ship-name">' + sh.name + "</span>" + shipIcon(sh.size);
      li.addEventListener("click", () => {
        if (sh.placed) { game.remove(sh.id); }
        state.selectedShip = sh.id;
        sfx.click();
        renderPlaceBoard(); renderDock();
        $("#ready-btn").disabled = !game.allPlaced();
      });
      dock.appendChild(li);
    });
  }

  function placeHover(x, y) {
    state.preview = x < 0 ? null : { x, y };
    renderPlaceBoard();
  }

  function placeClick(x, y) {
    // Pick up an already-placed ship by clicking it.
    const occ = game.board[y][x];
    if (occ !== null && game.ship(occ).placed) {
      game.remove(occ);
      state.selectedShip = occ;
      sfx.click();
      renderPlaceBoard(); renderDock();
      $("#ready-btn").disabled = true;
      return;
    }
    if (state.selectedShip == null) { state.selectedShip = firstUnplaced(); }
    if (state.selectedShip == null) return;
    if (game.place(state.selectedShip, x, y, state.placeHorizontal)) {
      sfx.place();
      state.selectedShip = firstUnplaced();
      renderPlaceBoard(); renderDock();
      $("#ready-btn").disabled = !game.allPlaced();
    } else {
      toast("Can't place there — out of bounds or overlapping.");
    }
  }

  function setupPlacement() {
    $("#rotate-btn").addEventListener("click", rotate);
    $("#random-btn").addEventListener("click", () => {
      game.randomize();
      state.selectedShip = null;
      sfx.place();
      renderPlaceBoard(); renderDock();
      $("#ready-btn").disabled = !game.allPlaced();
    });
    $("#clear-btn").addEventListener("click", () => {
      game.clearAll();
      state.selectedShip = firstUnplaced();
      sfx.click();
      renderPlaceBoard(); renderDock();
      $("#ready-btn").disabled = true;
    });
    $("#ready-btn").addEventListener("click", onReady);
    document.addEventListener("keydown", e => {
      if (e.key === "r" || e.key === "R") {
        if (!$("#screen-place").classList.contains("hidden")) rotate();
      }
    });
  }

  function rotate() {
    state.placeHorizontal = !state.placeHorizontal;
    sfx.click();
    renderPlaceBoard();
  }

  function onReady() {
    if (!game.allPlaced()) return;
    state.myReady = true;
    net.send({ type: "ready" });
    $("#ready-btn").disabled = true;
    $("#ready-btn").textContent = "Ready ✓ — waiting for opponent…";
    updateOppStatus();
    maybeStart();
  }

  function updateOppStatus() {
    const el = $("#place-opp-status");
    if (!el) return;
    el.textContent = state.oppReady
      ? state.oppName + " is ready and waiting!"
      : state.oppName + " is still deploying…";
  }

  // ---------- Start / turn coordination ----------
  function maybeStart() {
    if (state.started) return;
    if (state.myReady && state.oppReady) {
      if (net.isHost) {
        const first = Math.random() < 0.5 ? "host" : "guest";
        net.send({ type: "start", first });
        beginBattle(first);
      }
      // guest waits for the 'start' message
    }
  }

  function beginBattle(first) {
    if (state.started) return;
    state.started = true;
    state.myTurn = net.isHost ? (first === "host") : (first === "guest");
    state.sonarLeft = 1;
    state.sonarArmed = false;
    enterBattle();
  }

  // ---------- Battle ----------
  function enterBattle() {
    game.phase = "battle";
    show("#screen-battle");
    updateNames();
    clearChat();
    buildGrid($("#my-board"), false, null, null);
    buildGrid($("#enemy-board"), true, enemyClick, null);
    renderBattle();
    sfx.turn();
  }

  function renderBattle() {
    // My fleet board — show ships + incoming shots.
    const my = $("#my-board");
    eachCell(my, (c, x, y) => {
      c.className = "cell";
      const hasShip = game.board[y][x] !== null;
      if (hasShip) c.classList.add("ship");
      const inc = game.incoming[y][x];
      if (inc === "hit") c.classList.add("hit");
      else if (inc === "miss") c.classList.add("miss");
    });

    // Enemy waters — only what I've discovered.
    const enemy = $("#enemy-board");
    eachCell(enemy, (c, x, y) => {
      c.className = "cell";
      const t = game.tracking[y][x];
      if (t === "hit") c.classList.add("hit");
      else if (t === "miss") c.classList.add("miss");
      else {
        const s = game.scan[y][x];
        if (s === "ship") c.classList.add("scan-ship");
        else if (s === "clear") c.classList.add("scan-clear");
      }
    });
    enemy.classList.toggle("active", state.myTurn && !state.pending && game.phase === "battle");
    enemy.classList.toggle("aiming-sonar", state.sonarArmed);

    renderFleets();
    renderBanner();
    updateSonarBtn();
  }

  function renderFleets() {
    // Enemy ships I've sunk.
    const ef = $("#enemy-fleet");
    ef.innerHTML = "";
    BS.SHIPS.forEach(s => {
      const sunk = game.enemySunk.includes(s.name);
      const li = document.createElement("li");
      li.className = sunk ? "sunk" : "";
      li.innerHTML = shipIcon(s.size) + '<span class="fleet-name">' + s.name + "</span>";
      ef.appendChild(li);
    });
    // My ships still afloat.
    const mf = $("#my-fleet");
    mf.innerHTML = "";
    game.ships.forEach(s => {
      const dead = s.hits >= s.size;
      const li = document.createElement("li");
      li.className = dead ? "sunk" : "";
      li.innerHTML = shipIcon(s.size) + '<span class="fleet-name">' + s.name + "</span>";
      mf.appendChild(li);
    });
  }

  function renderBanner() {
    const b = $("#turn-banner");
    if (game.phase !== "battle") return;
    if (state.pending) {
      b.textContent = "🎯 Shot away… awaiting splash report";
      b.className = "turn-banner";
    } else if (state.myTurn) {
      b.textContent = "🔥 Your turn — fire at Enemy Waters!";
      b.className = "turn-banner you";
    } else {
      b.textContent = "⏳ " + state.oppName + " is taking aim…";
      b.className = "turn-banner them";
    }
  }

  function enemyClick(x, y) {
    if (game.phase !== "battle" || !state.myTurn || state.pending) return;
    if (game.tracking[y][x] !== null) return;
    if (state.sonarArmed) { fireSonar(x, y); return; }
    state.pending = true;
    sfx.fire();
    const cell = $("#enemy-board").querySelector('.cell[data-x="' + x + '"][data-y="' + y + '"]');
    if (cell) cell.classList.add("firing");
    $("#enemy-board").classList.remove("active");
    net.send({ type: "fire", x, y });
    renderBanner();
  }

  // ---------- Sonar ----------
  function fireSonar(x, y) {
    if (state.sonarLeft <= 0) return;
    state.sonarLeft--;
    state.sonarArmed = false;
    state.pending = true;
    sfx.sonar();
    net.send({ type: "sonar", x, y });
    $("#enemy-board").classList.remove("active");
    renderBattle();
  }

  // The opponent swept my waters — report contacts and take my turn next.
  function handleIncomingSonar(x, y) {
    const cells = game.sonarScan(x, y);
    net.send({ type: "sonar-result", cells });
    sfx.sonar();
    toast(state.oppName + " swept the waters with sonar 📡");
    state.myTurn = true;
    sfx.turn();
    renderBattle();
  }

  // My sonar sweep came back with intel. It cost me my turn.
  function handleSonarResult(msg) {
    state.pending = false;
    game.recordScan(msg.cells || []);
    const found = (msg.cells || []).filter(c => c.ship).length;
    toast(found
      ? "📡 Sonar: " + found + " contact" + (found > 1 ? "s" : "") + " detected!"
      : "📡 Sonar: these waters are clear.");
    state.myTurn = false;
    renderBattle();
  }

  function updateSonarBtn() {
    const b = $("#sonar-btn");
    if (!b) return;
    b.textContent = "📡 Sonar (" + state.sonarLeft + ")";
    b.disabled = state.sonarLeft <= 0 || !state.myTurn || state.pending || game.phase !== "battle";
    b.classList.toggle("armed", state.sonarArmed);
  }

  function toggleSonar() {
    if (state.sonarLeft <= 0 || !state.myTurn || state.pending) return;
    state.sonarArmed = !state.sonarArmed;
    sfx.click();
    toast(state.sonarArmed
      ? "Sonar armed — click an area on Enemy Waters to scan a 3×3 patch."
      : "Sonar disarmed.");
    renderBattle();
  }

  // The enemy reported the result of MY shot.
  function handleResult(msg) {
    state.pending = false;
    game.recordResult(msg.x, msg.y, msg.result, msg.sunk);
    if (msg.result === "hit") {
      sfx.hit();
      if (msg.sunk) { sfx.sunk(); toast("💥 You sank " + state.oppName + "'s " + msg.sunk + "!"); }
    } else {
      sfx.miss();
    }
    if (msg.defeated) { renderBattle(); endGame(true); return; }
    state.myTurn = false;
    renderBattle();
  }

  // The opponent fired at ME.
  function handleIncomingFire(x, y) {
    const r = game.receiveFire(x, y);
    net.send({ type: "result", x, y, result: r.result, sunk: r.sunk, defeated: r.defeated });
    if (r.result === "hit") { sfx.hit(); if (r.sunk) sfx.sunk(); }
    else sfx.miss();
    if (r.defeated) { renderBattle(); endGame(false); return; }
    state.myTurn = true;
    sfx.turn();
    renderBattle();
  }

  // ---------- Game over ----------
  function endGame(won) {
    game.phase = "over";
    show("#screen-over");
    const title = $("#over-title");
    title.textContent = won ? "⚓ Victory!" : "💀 Defeated";
    title.className = won ? "win" : "lose";
    $("#over-text").textContent = won
      ? "You sent " + state.oppName + "'s fleet to the depths. Glorious."
      : state.oppName + " sank your whole fleet. Regroup and try again!";
    renderStats();
    $("#rematch-status").textContent = "";
    $("#rematch-btn").textContent = "Rematch";
    $("#rematch-btn").disabled = false;
    state.myRematch = false;
    state.oppRematch = false;
    state.restarting = false;
    won ? sfx.win() : sfx.lose();
  }

  function setupOver() {
    $("#rematch-btn").addEventListener("click", () => {
      if (state.myRematch) return;
      state.myRematch = true;
      net.send({ type: "rematch" });
      $("#rematch-btn").disabled = true;
      $("#rematch-status").textContent = "Waiting for " + state.oppName + " to accept…";
      maybeRematch();
    });
    $("#home-btn").addEventListener("click", backHome);
  }

  function setupBattle() {
    const s = $("#sonar-btn");
    if (s) s.addEventListener("click", toggleSonar);
  }

  function maybeRematch() {
    if (state.myRematch && state.oppRematch && !state.restarting) {
      state.restarting = true;
      game.reset();
      state.myTurn = false; state.pending = false;
      state.myReady = false; state.oppReady = false;
      state.started = false;
      state.selectedShip = 0; state.placeHorizontal = true; state.preview = null;
      $("#ready-btn").disabled = true;
      $("#ready-btn").textContent = "Ready for battle";
      toast("Rematch! Deploy your fleet.");
      enterPlacement();
    }
  }

  function renderStats() {
    const box = $("#over-stats");
    if (!box) return;
    const mine = BS.Game.gridStats(game.tracking);   // shots I fired at the enemy
    const theirs = BS.Game.gridStats(game.incoming);  // shots that landed on me
    const sunk = game.enemySunk.length;
    const rows = [
      ["Shots fired", mine.shots],
      ["Hits landed", mine.hits],
      ["Accuracy", mine.accuracy + "%"],
      ["Ships sunk", sunk + " / " + BS.SHIPS.length],
      ["Hits taken", theirs.hits],
    ];
    box.innerHTML = rows.map(r =>
      '<div class="stat"><span class="stat-val">' + r[1] + '</span><span class="stat-lab">' + r[0] + "</span></div>"
    ).join("");
  }

  // ---------- Chat ----------
  function setupChat() {
    const form = $("#chat-form");
    if (form) {
      form.addEventListener("submit", e => {
        e.preventDefault();
        sendChat($("#chat-text").value);
        $("#chat-text").value = "";
      });
    }
    $$(".emote").forEach(b => b.addEventListener("click", () => sendChat(b.textContent)));
  }

  function sendChat(text) {
    text = (text || "").trim().slice(0, 120);
    if (!text || !net.conn || !net.conn.open) return;
    net.send({ type: "chat", text });
    addChat(state.myName, text, true);
    sfx.chat();
  }

  function addChat(who, text, mine) {
    const log = $("#chat-log");
    if (!log) return;
    const div = document.createElement("div");
    div.className = "chat-msg" + (mine ? " mine" : "");
    const w = document.createElement("span"); w.className = "chat-who"; w.textContent = who || (mine ? "You" : "Opponent");
    const b = document.createElement("span"); b.className = "chat-body"; b.textContent = text;
    div.appendChild(w); div.appendChild(b);
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function clearChat() {
    const log = $("#chat-log");
    if (log) log.innerHTML = "";
  }

  // ---------- Sound toggle ----------
  function setupMute() {
    const stored = localStorage.getItem("bs-muted") === "1";
    sfx.setMuted(stored);
    $("#mute-btn").textContent = stored ? "🔇" : "🔊";
    $("#mute-btn").addEventListener("click", () => {
      const m = !sfx.isMuted();
      sfx.setMuted(m);
      localStorage.setItem("bs-muted", m ? "1" : "0");
      $("#mute-btn").textContent = m ? "🔇" : "🔊";
      if (!m) { sfx.resume(); sfx.click(); }
    });
  }

  // ---------- Boot ----------
  function init() {
    setupHome();
    setupLobby();
    setupPlacement();
    setupBattle();
    setupChat();
    setupOver();
    setupNet();
    setupMute();
    show("#screen-home");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
