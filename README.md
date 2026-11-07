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
