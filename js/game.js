// Pure game state & rules — no DOM, no networking.
(function () {
  const BS = window.BS || (window.BS = {});

  BS.SIZE = 10;
  BS.SHIPS = [
    { name: "Carrier", size: 5 },
    { name: "Battleship", size: 4 },
    { name: "Cruiser", size: 3 },
    { name: "Submarine", size: 3 },
    { name: "Destroyer", size: 2 },
  ];

  function emptyGrid() {
    const g = [];
    for (let y = 0; y < BS.SIZE; y++) g.push(new Array(BS.SIZE).fill(null));
    return g;
  }

  BS.Game = class {
    constructor() { this.reset(); }

    reset() {
      this.board = emptyGrid();      // shipId or null — where MY ships sit
      this.incoming = emptyGrid();   // 'hit' | 'miss' | null — shots fired AT me
      this.tracking = emptyGrid();   // 'hit' | 'miss' | null — shots I fired at the enemy
      this.scan = emptyGrid();       // 'ship' | 'clear' | null — sonar intel about enemy waters
      this.ships = BS.SHIPS.map((s, i) => ({
        id: i, name: s.name, size: s.size, horizontal: true, cells: [], hits: 0, placed: false,
      }));
      this.enemySunk = [];           // names of enemy ships I have sunk
      this.phase = "placement";      // 'placement' | 'battle' | 'over'
    }

    ship(id) { return this.ships[id]; }

    canPlace(id, x, y, horizontal) {
      const sh = this.ship(id);
      const cells = [];
      for (let i = 0; i < sh.size; i++) {
        const cx = x + (horizontal ? i : 0);
        const cy = y + (horizontal ? 0 : i);
        if (cx < 0 || cy < 0 || cx >= BS.SIZE || cy >= BS.SIZE) return false;
        const occ = this.board[cy][cx];
        if (occ !== null && occ !== id) return false;
        cells.push({ x: cx, y: cy });
      }
      // Classic rule: ships may not touch each other — not even diagonally.
      for (const c of cells) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = c.x + dx, ny = c.y + dy;
            if (nx < 0 || ny < 0 || nx >= BS.SIZE || ny >= BS.SIZE) continue;
            const occ = this.board[ny][nx];
            if (occ !== null && occ !== id) return false;
          }
        }
      }
      return true;
    }

    place(id, x, y, horizontal) {
      this.remove(id);
      if (!this.canPlace(id, x, y, horizontal)) return false;
      const sh = this.ship(id);
      sh.cells = [];
      for (let i = 0; i < sh.size; i++) {
        const cx = x + (horizontal ? i : 0);
        const cy = y + (horizontal ? 0 : i);
        this.board[cy][cx] = id;
        sh.cells.push({ x: cx, y: cy });
      }
      sh.horizontal = horizontal;
      sh.placed = true;
      return true;
    }

    remove(id) {
      const sh = this.ship(id);
      sh.cells.forEach(c => { if (this.board[c.y][c.x] === id) this.board[c.y][c.x] = null; });
      sh.cells = [];
      sh.placed = false;
    }

    clearAll() { this.ships.forEach(s => this.remove(s.id)); }

    allPlaced() { return this.ships.every(s => s.placed); }

    randomize() {
      this.clearAll();
      for (const sh of this.ships) {
        let ok = false, tries = 0;
        while (!ok && tries < 2000) {
          tries++;
          const h = Math.random() < 0.5;
          const x = Math.floor(Math.random() * BS.SIZE);
          const y = Math.floor(Math.random() * BS.SIZE);
          if (this.canPlace(sh.id, x, y, h)) { this.place(sh.id, x, y, h); ok = true; }
        }
      }
    }

    // The opponent fired at (x, y) on MY board. Returns the outcome to report back.
    receiveFire(x, y) {
      const id = this.board[y][x];
      let result, sunk = null;
      if (id === null) {
        this.incoming[y][x] = "miss";
        result = "miss";
      } else {
        this.incoming[y][x] = "hit";
        result = "hit";
        const sh = this.ship(id);
        sh.hits++;
        if (sh.hits >= sh.size) sunk = sh.name;
      }
      const defeated = this.ships.every(s => s.hits >= s.size);
      return { x, y, result, sunk, defeated };
    }

    // The enemy reported the outcome of MY shot at (x, y).
    recordResult(x, y, result, sunk) {
      this.tracking[y][x] = result;
      if (sunk) this.enemySunk.push(sunk);
    }

    // The opponent swept (x, y) with sonar. Report which of the surrounding
    // cells on MY board hold a ship (intel only — no damage dealt).
    sonarScan(x, y) {
      const cells = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= BS.SIZE || ny >= BS.SIZE) continue;
          cells.push({ x: nx, y: ny, ship: this.board[ny][nx] !== null });
        }
      }
      return cells;
    }

    // The enemy reported a sonar sweep of THEIR waters.
    recordScan(cells) {
      cells.forEach(c => {
        if (this.tracking[c.y][c.x] !== null) return; // already confirmed by a shot
        this.scan[c.y][c.x] = c.ship ? "ship" : "clear";
      });
    }

    // Accuracy stats derived from a 'hit'/'miss' grid (tracking or incoming).
    static gridStats(grid) {
      let shots = 0, hits = 0;
      for (let y = 0; y < BS.SIZE; y++) {
        for (let x = 0; x < BS.SIZE; x++) {
          const v = grid[y][x];
          if (v === "hit") { shots++; hits++; }
          else if (v === "miss") { shots++; }
        }
      }
      return { shots, hits, accuracy: shots ? Math.round((hits / shots) * 100) : 0 };
    }

    myShipsRemaining() { return this.ships.filter(s => s.hits < s.size).length; }
  };
})();
