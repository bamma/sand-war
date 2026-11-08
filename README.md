# Sand War

A side-view arena brawler built on a falling-sand physics simulation. Shoot sand at the bots to bury them before they bury you. The last one breathing wins.

## Play

Open `index.html` in a browser (double-clicking works; no build or server needed), pick 1–3 bots and press **Start**.

| Input | Action |
|---|---|
| A / D (or ← / →) | Move |
| W / Space / ↑ | Jump (and push up through sand on top of you) |
| Mouse | Aim |
| Left click (hold) | Fire |
| 1 / 2 / 3, Q / E, mouse wheel | Switch element |
| R | Restart · **P** pause · **Esc** menu |

## Elements

Each element has its own ammo meter that refills over time. Sand holds 4 clumps (one bar segment each). Wind holds a **single** blast that takes 5 s to recharge, so you only get one emergency escape at a time.

- **Sand: clump launcher.** Fires a ball of 80 grains in an arc.
  - A **direct hit** dumps the whole clump on the target's head. It also knocks them out of the air, hammers them a few rows into loose ground, and **stuns** them for 1 s.
  - A miss bursts into a mound where it lands. Loose sand still piles into dunes with real physics.
- **Water: stream.** Hold to spray. Water soaks into sand and turns it into dark **mud**, seeping down through layers.
  - Mud is sticky: it holds steep walls and makes you sink like quicksand. Walking on mud cuts your run speed to about 40% and your jump to about a quarter of normal.
  - Mud dries back into sand after about 25 s.
- **Wind: blast shot.** Fires a fast air ball that **explodes** on impact, like a bomb going off in a dune.
  - Dry sand in the blast radius is flung up and outward. Mud and stone hold firm.
  - The shockwave knocks back everyone nearby, and a direct hit stuns.
  - Fire it at your own feet when buried to blast yourself free (it doubles as a rocket jump).

## Rocket jumping

Every weapon kicks back while you're in the air: shooting **down** mid-jump launches you higher. A big shot fired downward also cancels your fall.

| Move | Height (rows) |
|---|---|
| Plain jump | about 26 |
| Jump, then a sand shot down | about 52 (enough for the side ledges) |
| Jump, sand shot down, then a wind blast down | about 74 |

The water stream gives a gentle push that slows your fall. On the ground your feet absorb the recoil.

## Rules

- When sand covers your head and surrounds it, a breath bar appears. If it runs out (about 3 s), you're **out**. Jump repeatedly or use wind to dig out. Digging out of mud is much harder.
- After 90 s a **sandstorm** starts raining sand from the sky. It gets heavier until the arena fills, so every match ends.

## Online multiplayer (prototype)

Play against friends (up to 4 fighters per match, bots fill empty slots) on a small Node.js server. The server runs the real simulation and streams it to every player, so everyone sees the same dunes.

**Single player never needs the server.** Online code only loads when you click **Play online**. If the server is down or unreachable, you get a "play vs bots instead" message, and single player keeps working.

### Run it locally

```bash
cd server
npm install
npm start
```

Then open http://localhost:8080. The server serves the game page too.
1. Enter a name and click **Create room** to get a 4-letter code. You start playing against bots right away.
2. Friends on the same network open `http://<your-ip>:8080/?room=CODE`, or click **Play online** and type the code.

### Series and scoreboard

- **First to 3 round wins** takes the series. A scoreboard in the top right shows each fighter's wins.
- **Rounds run automatically.** The next round starts 4 s after a round ends. After a champion, the final result shows for 8 s, then a new series starts from 0–0.
- **Bots keep you busy while you wait.** On your own, you play against 3 bots. When the **first opponent joins, the game resets**: new series, all scores 0.
- **Later joiners don't reset anything.** They watch the current round, then fight from the next one with 0 wins.
- **Leaving:** if everyone else leaves, the last player goes back to playing bots.
- A round where everyone is buried scores nothing.
- Up to 4 fighters per round. Extra players (up to 8 per room) watch.

### Server settings

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port for the page and WebSocket |
| `FILL_BOTS` | off | "Fill room with bots": `1` adds bots to fill every round up to 4 fighters. When off, bots only play against a player who is alone. |
| `WINS_TO_WIN` | `3` | Round wins needed to take the series |

```bash
FILL_BOTS=1 WINS_TO_WIN=3 npm start
```

### Which server the page uses

| How the page is opened | Server used |
|---|---|
| With `?server=wss://host` in the URL | That server |
| Served over http(s) by the game server | The same host |
| From GitHub Pages or as a local file | `SW.ONLINE_SERVER` in `src/net.js`, empty until a server is deployed |

### Current limits

This is phases 1–2 of the plan: a working online prototype.
- Snapshots go out 30 times a second. The sand grid is sent as changes only, about 35 KB/s per player before WebSocket compression.
- Other players are interpolated, but your own character isn't predicted yet, so you feel your round-trip lag.
- Next steps: client-side prediction, smarter compression, then deploying the server.

`cd server && npm test` runs three checks: a headless bot match in Node, a test that snapshots rebuild the exact grid, and the series rules (reset on first opponent, late joiners, first to 3, leaving), with "fill room with bots" both on and off.

## Code layout

| File | Purpose |
|---|---|
| `src/grid.js` | Cellular automaton: sand, mud, water and wall cells, mud drying |
| `src/particles.js` | Flying grains (shots, wind spray) that settle back into the grid |
| `src/elements.js` | Weapons: sand gun, water gun, wind gust, ballistic aiming helper |
| `src/character.js` | Character movement through sand, sinking, burial and breath |
| `src/bot.js` | Bot AI: targeting, element choice, ballistic aim, digging out |
| `src/input.js` | Keyboard and mouse |
| `src/render.js` | Pixel rendering of the world, characters and HUD |
| `src/match.js` | One match: arena, sandstorm, win condition (shared by browser and server) |
| `src/main.js` | Browser shell: menu, single-player loop, hand-off to online play |
| `src/protocol.js` | Binary snapshot format (full grid or changed cells) |
| `src/net.js` | Online client: rooms/lobby, sending input, drawing server snapshots (loaded on demand) |
| `server/index.js` | Node server: serves the page, WebSockets, settings, 60 Hz tick loop |
| `server/room.js` | One room: players, automatic rounds, first-to-3 series scoreboard |
| `server/room-test.js` | Headless test of the series rules |
| `server/headless-test.js` | Headless bot match and snapshot round-trip check |

The simulation runs on a 320×180 grid, drawn at 4× scale, with a fixed 60 Hz timestep.
