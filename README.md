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

Each element has its own ammo meter that refills over time.

- **Sand.** A stream of grains with real physics. Grains pile into dunes with natural, varied slopes. A grain that hits a character lands on their head or beside them, and the impacts push them down into loose ground.
- **Water.** Soaks into sand and turns it into dark **mud**, seeping down through layers. Mud is sticky: it holds steep walls, slows you a lot, makes jumps weak, and makes you sink like quicksand. Mud dries back into sand after about 25 s.
- **Wind.** A short-range cone gust. Dry sand in its path sprays up and away off the dune, and it shoves characters and airborne grains. Mud is too heavy to move and blocks the gust. Point it up when you're buried to clear sand off your head.

## Rules

- When sand covers your head and surrounds it, a breath bar appears. If it runs out (about 3 s), you're **out**. Jump repeatedly or use wind to dig out. Digging out of mud is much harder.
- After 90 s a **sandstorm** starts raining sand from the sky. It gets heavier until the arena fills, so every match ends.

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
| `src/main.js` | Arena setup, game loop, sandstorm, match flow |

The simulation runs on a 320×180 grid, drawn at 4× scale, with a fixed 60 Hz timestep.
