// A local "computer opponent" that speaks the exact same message protocol as
// BS.Net, so app.js can't tell the difference. No networking — the bot keeps
// its own board and fires back with a simple hunt/target AI.
(function () {
  const BS = window.BS || (window.BS = {});

  BS.BotNet = class {
    constructor() {
      this.isHost = true;             // the human is treated as the host
      this.conn = { open: true };     // so `net.conn && net.conn.open` checks pass
      this.handlers = {};
      this.name = "Admiral Bot";
      this.bot = new BS.Game();
      this.firstBot = false;
      this._resetAI();
    }

    _resetAI() {
      this.shots = {};      // "x,y" -> true: cells the bot has fired at the human
      this.targets = [];    // stack of follow-up cells after a hit (hunt/target)
    }

    on(event, fn) { this.handlers[event] = fn; return this; }
    emit(event, data) { if (this.handlers[event]) this.handlers[event](data); }
    _deliver(obj) { this.emit("data", obj); }   // a message FROM the bot TO the app
    close() { this.conn = null; }

    // Pretend a peer just connected; the app then drives placement.
    start() {
      this.bot.randomize();
      setTimeout(() => this.emit("connected"), 150);
    }

    // Messages FROM the human TO the bot.
    send(obj) {
      if (!obj || !obj.type) return;
      switch (obj.type) {
        case "hello":  setTimeout(() => this._deliver({ type: "hello", name: this.name }), 120); break;
        case "ready":  setTimeout(() => this._deliver({ type: "ready" }), 250); break;  // bot is always ready
        case "start":  this._onStart(obj); break;
        case "fire":   this._onHumanFire(obj); break;
        case "sonar":  this._onHumanSonar(obj); break;
        case "result": this._onResult(obj); break;   // outcome of the bot's shot at the human
        case "rematch": this._onRematch(); break;
        // "surrender" / "bye": nothing for the bot to do
      }
    }

    _onStart(obj) {
      this.bot.phase = "battle";
      this.firstBot = obj.first === "guest";   // human is host, so "guest" == bot
      if (this.firstBot) this._botTurn(900);
    }

    _onHumanFire(obj) {
      const r = this.bot.receiveFire(obj.x, obj.y);
      setTimeout(() => {
        this._deliver({ type: "result", x: obj.x, y: obj.y, result: r.result, sunk: r.sunk, sunkCells: r.sunkCells, defeated: r.defeated });
        if (r.defeated) return;                 // human won
        if (r.result === "miss") this._botTurn(900);   // a miss hands the turn to the bot
      }, 500);
    }

    _onHumanSonar(obj) {
      const cells = this.bot.sonarScan(obj.x, obj.y);
      setTimeout(() => {
        this._deliver({ type: "sonar-result", cells: cells });
        this._botTurn(900);                     // sonar costs the human's turn
      }, 450);
    }

    // The app reported the outcome of the bot's shot at the human.
    _onResult(obj) {
      if (obj.defeated) return;                 // bot won; the human side ends the game
      if (obj.result === "hit") {
        this._registerHit(obj.x, obj.y, obj.sunk);
        this._botTurn(800);                     // a hit earns the bot another shot
      }
      // a miss hands the turn back to the human; the bot waits
    }

    _botTurn(delay) {
      setTimeout(() => {
        const cell = this._pickTarget();
        if (!cell) return;
        this.shots[cell.x + "," + cell.y] = true;
        this._deliver({ type: "fire", x: cell.x, y: cell.y });
      }, delay || 700);
    }

    _registerHit(x, y, sunk) {
      if (sunk) { this.targets = []; return; }  // ship destroyed — stop hunting it
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= BS.SIZE || ny >= BS.SIZE) continue;
        if (this.shots[nx + "," + ny]) continue;
        this.targets.push({ x: nx, y: ny });
      }
    }

    _pickTarget() {
      while (this.targets.length) {
        const c = this.targets.pop();
        if (!this.shots[c.x + "," + c.y]) return c;
      }
      // hunt mode: random untried cell, biased to a checkerboard for efficiency
      const free = [];
      for (let y = 0; y < BS.SIZE; y++) {
        for (let x = 0; x < BS.SIZE; x++) {
          if (!this.shots[x + "," + y]) free.push({ x: x, y: y });
        }
      }
      if (!free.length) return null;
      const parity = free.filter(c => (c.x + c.y) % 2 === 0);
      const pool = parity.length ? parity : free;
      return pool[Math.floor(Math.random() * pool.length)];
    }

    _onRematch() {
      this.bot = new BS.Game();
      this.bot.randomize();
      this.bot.phase = "battle";
      this._resetAI();
      setTimeout(() => this._deliver({ type: "rematch" }), 250);
    }
  };
})();
