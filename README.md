# ⚓ Battleship Duel

A two-player, peer-to-peer Battleship game that runs entirely in the browser.
No account, no backend, no database — just static files you can host on **GitHub Pages**.

One captain creates a game and gets a shareable code/link. The other opens it from
anywhere and the two browsers connect **directly** to each other (WebRTC via
[PeerJS](https://peerjs.com/)). Your fleet's positions never leave your own browser —
only individual shots and their splash reports are exchanged, so neither player can
ever see the other's board.

## How to play

1. Enter your captain name.
2. **Create a game** → share the 5-letter code or the invite link with your friend.
3. Your friend opens the link (or enters the code) and joins.
4. Both players deploy their fleet (5 ships). Click a cell to place the highlighted
   ship, press **R** or **Rotate** to turn it, or hit **🎲 Random**.
   Like the classic rules, **ships may not touch** — not even diagonally.
5. Click **Ready**. When both are ready, the battle begins — players take turns firing
   at "Enemy Waters". Land a hit and you fire again; miss and it's the enemy's turn.
   First to sink the enemy's whole fleet wins.

## Features

- **No-touch deployment** — ships must keep at least one cell of clear water between them.
- **Hit = fire again** — land a hit and you keep shooting; only a miss ends your turn.
- **🤖 Solo vs computer** — no opponent around? Play a local bot with a hunt/target AI.
- **📡 Sonar sweep** — once per game, scan a 3×3 patch of enemy waters for free (you still
  take your shot); gold rings mark detected ships, faint blue dots mark clear water
  (intel only, no damage).
- **💬 In-game chat & emotes** — taunt your opponent during the battle.
- **🏳️ Surrender** — concede a hopeless battle cleanly.
- **📊 Stats & series** — end-of-game shots/hits/accuracy plus a running win–loss tally
  across rematches.
- **Sinking animations, hit-streak callouts and a marker** showing where the enemy last fired.

## Run it locally

Because the browser loads the files over `fetch`, open it through a tiny local server
rather than double-clicking `index.html`:

```bash
# Python 3
python -m http.server 8000
# then visit http://localhost:8000

# …or with Node
npx serve .
```

To test a full match on one machine, open the site in two browser windows
(e.g. one normal, one incognito): create in one, join with the code in the other.

## Host it on GitHub Pages

1. Create a repository and push these files to it:
   ```bash
   git init
   git add .
   git commit -m "Battleship Duel"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. On GitHub: **Settings → Pages → Build and deployment**.
   Set **Source = Deploy from a branch**, **Branch = `main` / `root`**, save.
3. After a minute your game is live at
   `https://<you>.github.io/<repo>/`. Share that URL — the in-game invite links
   are generated from it automatically.

## Project layout

```
index.html        # markup & screens
css/styles.css    # nautical theme, animations
js/audio.js       # WebAudio sound effects (no asset files)
js/game.js        # pure game rules & state (board, ships, shots)
js/net.js         # PeerJS / WebRTC wrapper
js/app.js         # UI + networking orchestration
.nojekyll         # tell GitHub Pages to serve the folders as-is
```

## Notes & limits

- Both players must be online at the same time (it's a live P2P session).
- PeerJS uses a free public broker just to introduce the two peers; gameplay then
  flows directly browser-to-browser.
- Very strict corporate/symmetric-NAT firewalls can occasionally block the direct
  WebRTC connection. Normal home/mobile networks are fine. If you ever need
  bulletproof connectivity, the next step would be adding a TURN server or swapping
  the transport for a hosted realtime service.

Fair winds, Captain. 🌊
