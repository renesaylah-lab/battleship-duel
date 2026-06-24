// Thin PeerJS (WebRTC) wrapper. All game messages are plain JSON objects.
(function () {
  const BS = window.BS || (window.BS = {});

  // Namespace prefix so our IDs don't collide with other apps on the public broker.
  const PREFIX = "bs-duel-v1-";

  // Friendly 5-char codes, ambiguous characters (0/O/1/I) removed.
  BS.makeCode = function () {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  };

  BS.Net = class {
    constructor() {
      this.peer = null;
      this.conn = null;
      this.isHost = false;
      this.handlers = {};
    }

    on(event, fn) { this.handlers[event] = fn; return this; }
    emit(event, data) { if (this.handlers[event]) this.handlers[event](data); }

    send(obj) {
      try { if (this.conn && this.conn.open) this.conn.send(obj); } catch (e) { /* ignore */ }
    }

    _bindConn(conn) {
      this.conn = conn;
      conn.on("open", () => this.emit("connected"));
      conn.on("data", d => this.emit("data", d));
      conn.on("close", () => this.emit("closed"));
      conn.on("error", e => this.emit("connerror", e));
    }

    host(code) {
      this.close();
      this.isHost = true;
      this.peer = new Peer(PREFIX + code);
      this.peer.on("open", () => this.emit("open", code));
      this.peer.on("connection", conn => {
        if (this.conn && this.conn.open) { conn.close(); return; } // only one opponent
        this._bindConn(conn);
      });
      this.peer.on("error", e => this.emit("peererror", e));
    }

    join(code) {
      this.close();
      this.isHost = false;
      this.peer = new Peer();
      this.peer.on("open", () => {
        const conn = this.peer.connect(PREFIX + code, { reliable: true });
        this._bindConn(conn);
      });
      this.peer.on("error", e => this.emit("peererror", e));
    }

    close() {
      try { if (this.conn) this.conn.close(); } catch (e) {}
      try { if (this.peer) this.peer.destroy(); } catch (e) {}
      this.conn = null;
      this.peer = null;
    }
  };
})();
