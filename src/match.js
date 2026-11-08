// One match of Sand War: arena, characters, sandstorm and win condition.
// Pure simulation with no DOM, so it runs both in the browser (single player)
// and on the Node server (online). It is the `game` object the sim modules
// receive (they read grid, particles, shots, chars, frame and call onDeath).
(function () {
  'use strict';
  const SW = globalThis.SW;
  const { WALL, SAND } = SW.T;

  const GW = 320, GH = 180;
  const STORM_AT = 90 * 60;
  const COLORS = ['#3d7be0', '#e0503d', '#3daf5a', '#a54de0'];
  const BOT_NAMES = ['Dusty', 'Dune', 'Grit'];
  SW.GW = GW;
  SW.GH = GH;
  SW.COLORS = COLORS;
  SW.MAX_FIGHTERS = 4;

  class Match {
    // opts.humans: [{ name, color? }] (array order = character ids 0..)
    // opts.bots:   number of bots to add after the humans
    // opts.demo:   menu-background match (bots only, fixed spots)
    constructor(opts) {
      this.grid = new SW.Grid(GW, GH);
      this.particles = new SW.Particles(6000);
      this.shots = new SW.Shots();
      this.chars = [];
      this.toasts = [];
      this.frame = 0;
      this.over = false;
      this.winner = null;     // last character standing, or null
      this.overAt = 0;
      this.onDeathHook = null;
      this.buildArena();

      const humans = opts.humans || [];
      const nBots = Math.max(0, Math.min(SW.MAX_FIGHTERS - humans.length, opts.bots | 0));
      const spots = spawnSpots(humans.length, nBots, !!opts.demo);
      let id = 0;
      humans.forEach((h, k) => {
        this.chars.push(new SW.Character(id++, h.name, h.color || COLORS[k % COLORS.length], spots[id - 1], 30, false));
      });
      for (let k = 0; k < nBots; k++) {
        const color = COLORS[(humans.length + k) % COLORS.length];
        const c = new SW.Character(id++, BOT_NAMES[k], color, spots[id - 1], 30, true);
        c.brain = new SW.BotBrain(c, 0.5 + Math.random() * 0.4);
        this.chars.push(c);
      }
    }

    buildArena() {
      const g = this.grid;
      for (let y = 0; y < GH; y++) {
        for (let x = 0; x < GW; x++) {
          if (x < 2 || x >= GW - 2 || y < 2 || y >= GH - 3) g.setCell(x, y, WALL);
        }
      }
      // Rolling starting dunes.
      const p1 = Math.random() * 6, p2 = Math.random() * 6;
      for (let x = 2; x < GW - 2; x++) {
        const h = Math.round(16 + 6 * Math.sin(x * 0.03 + p1) + 3 * Math.sin(x * 0.085 + p2));
        for (let y = GH - 3 - h; y < GH - 3; y++) g.setCell(x, y, SAND);
      }
      // Stone ledges and a central pillar.
      const rect = (x0, y0, x1, y1) => {
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g.setCell(x, y, WALL);
      };
      rect(22, 112, 66, 116);
      rect(GW - 66, 112, GW - 22, 116);
      rect(152, 128, 168, GH - 3);
      rect(120, 86, 200, 89);
      // Let the dunes settle a little so they look natural from frame one.
      for (let k = 0; k < 40; k++) g.update();
    }

    // After STORM_AT the sky starts raining sand, slowly filling the arena so
    // every match eventually ends.
    sandstorm() {
      const t = this.frame - STORM_AT;
      if (t === 0) this.toast('Sandstorm incoming!', 200);
      if (t < 0) return;
      const rate = Math.min(8, 0.5 + t / 600);
      let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
      while (n--) {
        this.particles.spawn(3 + Math.random() * (GW - 6), 2.5, (Math.random() - 0.3) * 0.6, 0.5 + Math.random(), SAND, -1);
      }
    }

    toast(text, life) { this.toasts.push({ text, life: life || 180 }); }

    onDeath(c) {
      this.toast(c.name === 'You' ? 'You were buried!' : `${c.name} was buried!`);
      if (this.onDeathHook) this.onDeathHook(c);
    }

    // inputFor(c) returns the input for a non-bot character this frame.
    step(inputFor) {
      this.frame++;
      for (const c of this.chars) {
        const inp = c.isBot ? c.brain.getInput(this) : inputFor(c);
        c.update(this, inp);
      }
      for (const c of this.chars) SW.fire(this, c);
      this.shots.update(this);
      this.sandstorm();
      this.particles.update(this);
      this.grid.stampBodies(this.chars);
      this.grid.update();
      this.grid.unstampBodies(this.chars);
      for (const t of this.toasts) t.life--;
      this.toasts = this.toasts.filter((t) => t.life > 0);
      this.checkOver();
    }

    // Over when one fighter is left, or every human is out.
    checkOver() {
      if (this.over) return;
      const alive = this.chars.filter((c) => c.alive);
      const hasHumans = this.chars.some((c) => !c.isBot);
      if (alive.length <= 1 || (hasHumans && !alive.some((c) => !c.isBot))) {
        this.over = true;
        this.overAt = this.frame;
        this.winner = alive.length === 1 ? alive[0] : null;
      }
    }
  }

  // Spawn x positions. Single player and the menu demo keep their original
  // spots; online matches spread fighters evenly.
  function spawnSpots(nHumans, nBots, demo) {
    if (demo) return [40, 150, 270];
    if (nHumans === 1) {
      const bots = nBots === 1 ? [250] : nBots === 2 ? [190, 275] : [40, 200, 275];
      return [90].concat(bots);
    }
    const n = nHumans + nBots, out = [];
    for (let k = 0; k < n; k++) out.push(Math.round(30 + (k * (GW - 66)) / Math.max(1, n - 1)));
    return out;
  }

  SW.Match = Match;
})();
