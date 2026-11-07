// Free-flying particles: fired sand/water, wind-blown sand, and air streaks.
// When a material particle lands it is written back into the grid.
(function () {
  'use strict';
  const SW = window.SW;
  const { EMPTY, SAND, MUD, WATER, AIR } = SW.T;

  SW.PG = 0.15;          // particle gravity (cells / frame^2)
  const MAX_SPEED = 9;

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

      for (let s = 0; s < steps; s++) {
        const nx = x + sx, ny = y + sy;
        const cx = Math.floor(nx), cy = Math.floor(ny);
        if (cx < 0 || cx >= W || cy >= H) return false;
        if (cy >= 0) {
          const ci = cy * W + cx;
          const ct = g.type[ci];
          if (ct !== EMPTY) {
            if (t === WATER && ct === SAND) {
              g.wet(ci);
              wetAround(g, cx, cy);
              return false;
            }
            if (t === WATER && ct === MUD) {
              g.refresh(ci);
              if (Math.random() < 0.6) return false;
            }
            settle(g, Math.floor(x), Math.floor(y), t, shade);
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
              if (y - c.y < 2 || vy > Math.abs(vx) * 1.5) settle(g, Math.floor(x), c.y - 1, t, shade);
              else settle(g, vx > 0 ? c.x - 1 : c.x + c.w, Math.floor(y), t, shade);
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

  // Write a landed grain into the grid at (px,py), or the first free cell above.
  function settle(g, px, py, t, shade) {
    if (px < 0 || px >= g.w) return;
    for (let k = 0; k < 14; k++) {
      const y = py - k;
      if (y < 0) return;
      if (y >= g.h) continue;
      if (g.type[y * g.w + px] === EMPTY) { g.setCell(px, y, t, shade); return; }
    }
  }

  SW.Particles = Particles;
})();
