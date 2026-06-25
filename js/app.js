// Orchestrates UI, game state and networking.
(function () {
  const BS = window.BS;
  const SIZE = BS.SIZE;
  const sfx = BS.sfx;
  const LETTERS = "ABCDEFGHIJ";

  const game = new BS.Game();
  let net = new BS.Net();

  const state = {
    myName: "",
    oppName: "Opponent",
    code: "",
    vsBot: false,
    wins: 0,              // session tally across rematches
    losses: 0,
    streak: 0,            // my current run of consecutive hits
    lastIncoming: null,   // {x,y} the opponent last fired at me
    peerLeft: false,      // opponent left on purpose (clean 'bye')
    pendingShot: null,    // the fire/sonar message we're awaiting a reply for
    pendingTimer: null,   // watchdog that re-sends a shot if the reply is lost
    pendingRetries: 0,
    shotSeq: 0,           // monotonic id per shot, so a late reply can't match a newer shot
    lastSonarSeq: null,   // dedupe a re-sent sonar sweep
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
    $("#bot-btn").addEventListener("click", startBot);
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
    clearPending();
    if (!state.vsBot && net.conn && net.conn.open) net.send({ type: "bye" });
    net.close();
    setConn(false);
    resetMatchState();
    state.wins = 0; state.losses = 0;
    state.vsBot = false; state.peerLeft = false;
    state.oppName = "Opponent";
    game.reset();
    net = new BS.Net();
    bindNetHandlers();
    show("#screen-home");
  }

  function resetMatchState() {
    state.myTurn = false; state.pending = false;
    state.myReady = false; state.oppReady = false;
    state.started = false; state.restarting = false;
    state.myRematch = false; state.oppRematch = false;
    state.selectedShip = 0; state.placeHorizontal = true; state.preview = null;
    state.streak = 0; state.lastIncoming = null;
    state.sonarLeft = 1; state.sonarArmed = false;
    state.lastSonarSeq = null;
    clearPending();
  }

  // ---------- Networking events ----------
  function setupNet() { bindNetHandlers(); }

  // Attaches all handlers to the current `net` (a real BS.Net or a BS.BotNet).
  function bindNetHandlers() {
    net.on("open", () => { /* host id is ready; nothing else needed */ });

    net.on("connected", () => {
      clearTimeout(state.joinTimer);
      setConn(true);
      net.send({ type: "hello", name: state.myName });
      toast(state.vsBot ? "Battle stations!" : "Connected! Battle stations.");
      enterPlacement();
    });

    net.on("data", onMessage);

    net.on("closed", () => {
      setConn(false);
      if (game.phase === "over" || state.vsBot) return;
      toast(state.peerLeft ? state.oppName + " left the game." : "Connection to " + state.oppName + " lost.");
      setTimeout(backHome, 1500);
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

  // ---------- Solo vs computer ----------
  function startBot() {
    if (!requireName()) return;
    net.close();
    net = new BS.BotNet();
    bindNetHandlers();
    state.vsBot = true;
    state.code = "BOT";
    state.oppName = "Admiral Bot";
    net.start();
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
        handleIncomingFire(msg.x, msg.y, msg.seq);
        break;
      case "result":
        handleResult(msg);
        break;
      case "sonar":
        handleIncomingSonar(msg.x, msg.y, msg.seq);
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
      case "surrender":
        if (game.phase === "battle") { toast(state.oppName + " surrendered! ⚓"); endGame(true); }
        break;
      case "bye":
        state.peerLeft = true;
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
    state.streak = 0;
    state.lastIncoming = null;
    enterBattle();
  }

  // ---------- Battle ----------
  function enterBattle() {
    game.phase = "battle";
    show("#screen-battle");
    updateNames();
    clearChat();
    renderScoreboard();
    buildGrid($("#my-board"), false, null, null);
    buildGrid($("#enemy-board"), true, enemyClick, null);
    renderBattle();
    sfx.turn();
  }

  function renderScoreboard() {
    const el = $("#scoreboard");
    if (!el) return;
    if (state.wins || state.losses) {
      el.textContent = "Series — You " + state.wins + " · " + state.losses + " " + state.oppName;
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  }

  function renderBattle() {
    // My fleet board — show ships + incoming shots.
    const my = $("#my-board");
    const li = state.lastIncoming;
    eachCell(my, (c, x, y) => {
      c.className = "cell";
      const id = game.board[y][x];
      if (id !== null) c.classList.add("ship");
      const inc = game.incoming[y][x];
      if (inc === "hit") c.classList.add("hit");
      else if (inc === "miss") c.classList.add("miss");
      if (id !== null && game.ship(id).hits >= game.ship(id).size) c.classList.add("sunk");
      if (li && li.x === x && li.y === y) c.classList.add("last-shot");
    });

    // Enemy waters — only what I've discovered.
    const sunkKeys = new Set(game.enemySunkCells.map(c => c.x + "," + c.y));
    const enemy = $("#enemy-board");
    eachCell(enemy, (c, x, y) => {
      c.className = "cell";
      const t = game.tracking[y][x];
      if (t === "hit") { c.classList.add("hit"); if (sunkKeys.has(x + "," + y)) c.classList.add("sunk"); }
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
    sendPending({ type: "fire", x, y });
    renderBanner();
  }

  // ---------- Lost-message resilience ----------
  // Send a shot and keep a watchdog: if the reply never arrives (a dropped
  // message on a flaky link), re-send it. Replies are idempotent on both sides.
  function sendPending(msg) {
    msg.seq = ++state.shotSeq;
    state.pendingShot = msg;
    state.pendingRetries = 0;
    clearInterval(state.pendingTimer);
    state.pendingTimer = setInterval(() => {
      if (!state.pending || !state.pendingShot || game.phase !== "battle") { clearPending(); return; }
      state.pendingRetries++;
      if (state.pendingRetries === 3) toast("Connection seems slow — still trying to reach " + state.oppName + "…");
      if (state.pendingRetries > 15) { clearInterval(state.pendingTimer); state.pendingTimer = null; toast("No reply from " + state.oppName + ". Check your connection or restart the match."); return; }
      net.send(state.pendingShot);
    }, 4000);
    net.send(msg);
  }

  function clearPending() {
    clearInterval(state.pendingTimer);
    state.pendingTimer = null;
    state.pendingShot = null;
    state.pendingRetries = 0;
  }

  // ---------- Sonar ----------
  function fireSonar(x, y) {
    if (state.sonarLeft <= 0) return;
    state.sonarLeft--;
    state.sonarArmed = false;
    state.pending = true;
    sfx.sonar();
    sendPending({ type: "sonar", x, y });
    $("#enemy-board").classList.remove("active");
    renderBattle();
  }

  // The opponent swept my waters — report contacts and take my turn next.
  function handleIncomingSonar(x, y, seq) {
    const cells = game.sonarScan(x, y);
    net.send({ type: "sonar-result", cells: cells, seq: seq });
    if (seq != null && seq === state.lastSonarSeq) return;   // re-sent sonar: re-ack only
    state.lastSonarSeq = seq;
    sfx.sonar();
    toast(state.oppName + " swept the waters with sonar 📡");
    state.myTurn = true;
    sfx.turn();
    renderBattle();
  }

  // My sonar sweep came back with intel. It cost me my turn.
  function handleSonarResult(msg) {
    // ignore a duplicate or stale reply (must match the sonar we're waiting on)
    if (!state.pending || !state.pendingShot || msg.seq !== state.pendingShot.seq) return;
    state.pending = false;
    clearPending();
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
    // ignore a duplicate or stale reply (must match the shot we're waiting on)
    if (!state.pending || !state.pendingShot || msg.seq !== state.pendingShot.seq) return;
    state.pending = false;
    clearPending();
    game.recordResult(msg.x, msg.y, msg.result, msg.sunk, msg.sunkCells);
    if (msg.result === "hit") {
      sfx.hit();
      state.streak++;
      if (msg.sunk) {
        sfx.sunk();
        toast("💥 You sank " + state.oppName + "'s " + msg.sunk + "! Fire again!");
        sinkCells($("#enemy-board"), msg.sunkCells);
      } else {
        toast(state.streak >= 2 ? "🔥 " + state.streak + " hits in a row — fire again!" : "🎯 Direct hit — fire again!");
      }
    } else {
      sfx.miss();
      state.streak = 0;
    }
    if (msg.defeated) { renderBattle(); endGame(true); return; }
    // Classic rule: a hit earns another shot; only a miss ends your turn.
    state.myTurn = msg.result === "hit";
    renderBattle();
  }

  // Play a one-shot sinking animation over a ship's cells on the given board.
  function sinkCells(boardEl, cells) {
    if (!boardEl || !cells) return;
    cells.forEach(c => {
      const el = boardEl.querySelector('.cell[data-x="' + c.x + '"][data-y="' + c.y + '"]');
      if (!el) return;
      el.classList.add("sinking");
      setTimeout(() => el.classList.remove("sinking"), 900);
    });
  }

  // The opponent fired at ME.
  function handleIncomingFire(x, y, seq) {
    const duplicate = game.incoming[y][x] !== null;
    const r = game.receiveFire(x, y);
    net.send({ type: "result", x, y, result: r.result, sunk: r.sunk, sunkCells: r.sunkCells, defeated: r.defeated, seq: seq });
    if (duplicate) return;   // re-sent shot: just re-acknowledge; don't touch turn/pending
    // A genuine new shot from the opponent means my own pending shot already
    // resolved on their side (a miss handed them the turn). Stop awaiting its
    // reply so a late result can't clobber the turn they just handed back.
    if (state.pending) { state.pending = false; clearPending(); }
    state.lastIncoming = { x, y };
    if (r.result === "hit") { sfx.hit(); if (r.sunk) sfx.sunk(); }
    else sfx.miss();
    if (r.defeated) { renderBattle(); if (r.sunk) sinkCells($("#my-board"), r.sunkCells); endGame(false); return; }
    // The shooter keeps firing after a hit — I only get the turn back on a miss.
    state.myTurn = r.result === "miss";
    if (state.myTurn) sfx.turn();
    renderBattle();
    if (r.sunk) sinkCells($("#my-board"), r.sunkCells);
  }

  // ---------- Game over ----------
  function endGame(won) {
    if (game.phase === "over") return;   // guard against duplicate/late messages
    game.phase = "over";
    clearPending();
    if (won) state.wins++; else state.losses++;
    state.sonarArmed = false;
    show("#screen-over");
    const title = $("#over-title");
    title.textContent = won ? "⚓ Victory!" : "💀 Defeated";
    title.className = won ? "win" : "lose";
    $("#over-text").textContent = won
      ? "You sent " + state.oppName + "'s fleet to the depths. Glorious."
      : state.oppName + " sank your whole fleet. Regroup and try again!";
    const series = $("#over-series");
    if (series) series.textContent = "Series — You " + state.wins + " · " + state.losses + " " + state.oppName;
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
    const sr = $("#surrender-btn");
    if (sr) sr.addEventListener("click", surrender);
  }

  function surrender() {
    if (game.phase !== "battle") return;
    if (!window.confirm("Surrender this battle?")) return;
    net.send({ type: "surrender" });
    toast("You struck your colours. 🏳️");
    endGame(false);
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
