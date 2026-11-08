// Free-flying particles: fired sand/water, wind-blown sand, and air streaks.
// When a material particle lands it is written back into the grid.
(function () {
  'use strict';
  const SW = globalThis.SW;
  const { EMPTY, WALL, SAND, MUD, WATER, AIR } = SW.T;

  SW.PG = 0.15;          // particle gravity (cells / frame^2)
  const MAX_SPEED = 9;
  const CEILING = 2;     // first open row below the stone ceiling

  class Particles {
    constructor(cap) {
      this.cap = cap;
      this.n = 0;
      this.x = new Float32Array(cap);
      this.y = new Float32Array(cap);
      this.vx = new Float32Array(cap);
      this.vy = new Float32Array(cap);
      this.type = new Uint8Array(cap);
      this.shade = new Uint8Array(cap);
      this.owner = new Int8Array(cap);
      this.age = new Uint16Array(cap);
      this.canHit = new Uint8Array(cap);
      this.ghost = new Uint8Array(cap);   // frames this grain passes through terrain (blast ejecta)
    }

    reset() { this.n = 0; }

    spawn(x, y, vx, vy, type, owner, shade) {
      if (this.n >= this.cap) return -1;
      const i = this.n++;
      this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
      this.type[i] = type;
      this.owner[i] = owner === undefined ? -1 : owner;
      this.shade[i] = shade === undefined ? (Math.random() * 16) | 0 : shade;
      this.age[i] = 0;
      this.canHit[i] = type === AIR ? 0 : 1;
      this.ghost[i] = 0;
      return i;
    }

    kill(i) {
      const l = --this.n;
      if (i === l) return;
      this.x[i] = this.x[l]; this.y[i] = this.y[l];
      this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l];
      this.type[i] = this.type[l]; this.shade[i] = this.shade[l];
      this.owner[i] = this.owner[l]; this.age[i] = this.age[l];
      this.canHit[i] = this.canHit[l];
      this.ghost[i] = this.ghost[l];
    }

    update(game) {
      const g = game.grid, chars = game.chars;
      for (let i = this.n - 1; i >= 0; i--) {
        if (!this.step(i, g, chars)) this.kill(i);
      }
    }

    // Advance one particle; returns false when it should be removed.
    step(i, g, chars) {
      const t = this.type[i];
      const age = ++this.age[i];
      if (t === AIR) {
        this.x[i] += this.vx[i]; this.y[i] += this.vy[i];
        this.vx[i] *= 0.9; this.vy[i] *= 0.9;
        return age < 16;
      }
      let vx = this.vx[i], vy = this.vy[i] + SW.PG;
      const sp = Math.hypot(vx, vy);
      if (sp > MAX_SPEED) { vx *= MAX_SPEED / sp; vy *= MAX_SPEED / sp; }
      let x = this.x[i], y = this.y[i];
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy))));
      const sx = vx / steps, sy = vy / steps;
      const W = g.w, H = g.h;
      const shade = this.shade[i];
      const ghost = this.ghost[i] > 0;
      if (ghost) this.ghost[i]--;

      for (let s = 0; s < steps; s++) {
        const nx = x + sx, ny = y + sy;
        const cx = Math.floor(nx), cy = Math.floor(ny);
        if (cx < 0 || cx >= W || cy >= H) return false;
        if (cy < CEILING) {
          // Hit the ceiling: stop dead and fall straight down from there.
          y = CEILING + 0.01; vx = 0; vy = 0;
          break;
        }
        {
          const ci = cy * W + cx;
          const ct = g.type[ci];
          // Blast ejecta may pass through loose sand for a few frames,
          // but never through stone.
          if (ct !== EMPTY && !(ghost && ct !== WALL)) {
            if (t === WATER && ct === SAND) {
              g.wet(ci);
              wetAround(g, cx, cy);
              return false;
            }
            if (t === WATER && ct === MUD) {
              g.refresh(ci);
              if (Math.random() < 0.6) return false;
            }
            settle(g, Math.floor(x), Math.floor(y), t, shade, chars);
            return false;
          }
        }
        x = nx; y = ny;

        if (this.canHit[i]) {
          const owner = this.owner[i];
          for (let k = 0; k < chars.length; k++) {
            const c = chars[k];
            if (c.id === owner && age < 30) continue;
            if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) {
              // Hit: the grain is deposited on the target's head or against
              // the side it struck, so sand piles up on and around them.
              if (c.alive) {
                c.kx += vx * 0.008;
                if (t === SAND) c.load += 1;
              }
              if (y - c.y < 2 || vy > Math.abs(vx) * 1.5) settle(g, Math.floor(x), c.y - 1, t, shade, chars);
              else settle(g, vx > 0 ? c.x - 1 : c.x + c.w, Math.floor(y), t, shade, chars);
              return false;
            }
          }
        }
      }
      this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
      return true;
    }
  }

  function wetAround(g, cx, cy) {
    for (let k = 0; k < 6; k++) {
      const x = cx + ((Math.random() * 5) | 0) - 2;
      const y = cy + ((Math.random() * 4) | 0);
      if (g.get(x, y) === SAND && Math.random() < 0.6) g.wet(g.idx(x, y));
    }
  }

  // Write a landed grain into the grid at (px,py), or the first free cell
  // above it. If that column is full (e.g. packed up against the ceiling),
  // use the nearest free cell around it so sand is never destroyed.
  function settle(g, px, py, t, shade, chars) {
    px = Math.max(0, Math.min(g.w - 1, px));
    for (let k = 0; k < 14; k++) {
      const y = py - k;
      if (y < CEILING) break;
      if (y >= g.h) continue;
      if (g.type[y * g.w + px] === EMPTY && !inBody(chars, px, y)) { g.setCell(px, y, t, shade); return; }
    }
    const cy = Math.max(CEILING, Math.min(g.h - 1, py));
    for (let r = 1; r <= 8; r++) {
      let best = -1, bestD = Infinity;
      for (let y = cy - r; y <= cy + r; y++) {
        if (y < CEILING || y >= g.h) continue;
        for (let x = px - r; x <= px + r; x++) {
          if (x < 0 || x >= g.w) continue;
          if (Math.max(Math.abs(x - px), Math.abs(y - cy)) !== r) continue; // ring only
          if (g.type[y * g.w + x] !== EMPTY || inBody(chars, x, y)) continue;
          const d = (x - px) * (x - px) + (y - cy) * (y - cy);
          if (d < bestD) { bestD = d; best = y * g.w + x; }
        }
      }
      if (best >= 0) { g.setCell(best % g.w, (best / g.w) | 0, t, shade); return; }
    }
  }

  function inBody(chars, x, y) {
    if (!chars) return false;
    for (let k = 0; k < chars.length; k++) {
      const c = chars[k];
      if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) return true;
    }
    return false;
  }

  SW.Particles = Particles;
})();
