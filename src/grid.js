// Cellular-automaton world grid: sand, mud, water and walls.
(function () {
  'use strict';
  const SW = (window.SW = window.SW || {});

  const EMPTY = 0, WALL = 1, SAND = 2, MUD = 3, WATER = 4, AIR = 5, BODY = 6;
  SW.T = { EMPTY, WALL, SAND, MUD, WATER, AIR, BODY };

  const MUD_LIFE = 1500;      // frames until mud dries back into sand (~25 s)
  const MUD_LIFE_VAR = 600;
  const WATER_LIFE = 900;     // standing water evaporates after ~15 s
  SW.MUD_DRY_FADE = 420;      // last N frames of mud life fade towards sand colour

  SW.isSolid = (t) => t === WALL || t === SAND || t === MUD;
  SW.isLoose = (t) => t === SAND || t === MUD || t === WATER;

  class Grid {
    constructor(w, h) {
      this.w = w;
      this.h = h;
      const n = w * h;
      this.type = new Uint8Array(n);
      this.shade = new Uint8Array(n);
      this.life = new Uint16Array(n);
      this.stamp = new Uint8Array(n);
      this.active = new Uint8Array(n);
      this.frame = 1;
    }

    idx(x, y) { return y * this.w + x; }
    inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

    get(x, y) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return y < 0 ? EMPTY : WALL;
      return this.type[y * this.w + x];
    }

    setCell(x, y, t, shade) {
      if (!this.inb(x, y)) return;
      const i = y * this.w + x;
      this.type[i] = t;
      this.shade[i] = shade === undefined ? (Math.random() * 16) | 0 : shade;
      this.life[i] = t === MUD ? mudLife() : t === WATER ? WATER_LIFE : 0;
      this.active[i] = 1;
    }

    clear(i) {
      this.type[i] = EMPTY;
      this.life[i] = 0;
      this.active[i] = 0;
    }

    // Sand -> mud (keeps grain shade so it dries back looking the same).
    wet(i) {
      this.type[i] = MUD;
      this.life[i] = mudLife();
      this.active[i] = 0;
    }

    refresh(i) {
      if (this.type[i] === MUD && this.life[i] < MUD_LIFE) this.life[i] = mudLife();
    }

    moveCell(i, j) {
      this.type[j] = this.type[i];
      this.shade[j] = this.shade[i];
      this.life[j] = this.life[i];
      this.stamp[j] = this.frame;
      this.active[j] = 1;
      this.type[i] = EMPTY;
      this.life[i] = 0;
      this.active[i] = 0;
    }

    swapCells(i, j) {
      const t = this.type[i], s = this.shade[i], l = this.life[i];
      this.type[i] = this.type[j]; this.shade[i] = this.shade[j]; this.life[i] = this.life[j];
      this.type[j] = t; this.shade[j] = s; this.life[j] = l;
      this.stamp[i] = this.stamp[j] = this.frame;
      this.active[i] = this.active[j] = 1;
    }

    // Mark character bodies as occupied so sand piles on them instead of
    // falling through. Call unstampBodies() after update().
    stampBodies(chars) {
      for (const c of chars) this._fillBody(c, EMPTY, BODY);
    }

    unstampBodies(chars) {
      for (const c of chars) this._fillBody(c, BODY, EMPTY);
    }

    _fillBody(c, from, to) {
      const x0 = Math.max(0, c.x), x1 = Math.min(this.w, c.x + c.w);
      const y0 = Math.max(0, c.y), y1 = Math.min(this.h, c.y + c.h);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * this.w + x;
          if (this.type[i] === from) this.type[i] = to;
        }
      }
    }

    update() {
      this.frame = (this.frame % 255) + 1;
      const f = this.frame, W = this.w, H = this.h, type = this.type, stamp = this.stamp;
      const ltr = (f & 1) === 0;
      for (let y = H - 2; y >= 0; y--) {
        const row = y * W;
        for (let k = 0; k < W; k++) {
          const x = ltr ? k : W - 1 - k;
          const i = row + x;
          const t = type[i];
          if (t <= WALL || stamp[i] === f) continue;
          if (t === SAND) this._sand(i);
          else if (t === MUD) this._mud(i);
          else if (t === WATER) this._water(i);
        }
      }
    }

    _sand(i) {
      const type = this.type, W = this.w;
      const b = i + W;
      const tb = type[b];
      if (tb === EMPTY) { this.moveCell(i, b); return; }
      if (tb === WATER) { if (Math.random() < 0.6) this.swapCells(i, b); return; }
      const d = Math.random() < 0.5 ? 1 : -1;
      if (type[b + d] === EMPTY && type[i + d] !== WALL) { this.moveCell(i, b + d); return; }
      if (type[b - d] === EMPTY && type[i - d] !== WALL) { this.moveCell(i, b - d); return; }
      // Grains that are still "moving" can creep further, giving dunes a
      // gentler and more varied slope than a perfect 45 degree pile.
      if (this.active[i]) {
        if (Math.random() < 0.35) {
          if (type[i + d] === EMPTY && type[b + 2 * d] === EMPTY) { this.moveCell(i, i + d); return; }
        }
        if (Math.random() < 0.18) this.active[i] = 0;
      }
    }

    _mud(i) {
      const type = this.type, W = this.w;
      if (--this.life[i] <= 0) { type[i] = SAND; this.active[i] = 1; return; }
      const b = i + W;
      const tb = type[b];
      if (tb === EMPTY) { this.moveCell(i, b); return; }
      if (tb === WATER) { if (Math.random() < 0.3) this.swapCells(i, b); return; }
      // Mud is sticky: it almost never slides, so it holds steep walls.
      if (Math.random() < 0.004) {
        const d = Math.random() < 0.5 ? 1 : -1;
        if (type[b + d] === EMPTY && type[i + d] === EMPTY) this.moveCell(i, b + d);
      }
    }

    _water(i) {
      const type = this.type, W = this.w;
      if (--this.life[i] <= 0) { this.clear(i); return; }
      // Soak into neighbouring sand, turning it into mud.
      const nb0 = i + W, nb1 = i - 1, nb2 = i + 1, nb3 = i - W;
      for (let k = 0; k < 4; k++) {
        const j = k === 0 ? nb0 : k === 1 ? nb1 : k === 2 ? nb2 : nb3;
        const t = type[j];
        if (t === SAND) {
          this.wet(j);
          if (Math.random() < 0.5) { this.clear(i); return; }
        } else if (t === MUD) {
          this.refresh(j);
        }
      }
      // Seep down through mud and soak the sand beneath it.
      if (type[nb0] === MUD) {
        let j = nb0 + W;
        for (let s = 0; s < 8 && j < type.length; s++, j += W) {
          const t = type[j];
          if (t === SAND) {
            this.wet(j);
            if (Math.random() < 0.5) { this.clear(i); return; }
            break;
          }
          if (t !== MUD) break;
        }
      }
      const b = i + W;
      if (type[b] === EMPTY) { this.moveCell(i, b); return; }
      const d = Math.random() < 0.5 ? 1 : -1;
      if (type[b + d] === EMPTY) { this.moveCell(i, b + d); return; }
      if (type[b - d] === EMPTY) { this.moveCell(i, b - d); return; }
      let j = i;
      for (let s = 0; s < 3; s++) { if (type[j + d] !== EMPTY) break; j += d; }
      if (j !== i) { this.moveCell(i, j); return; }
      for (let s = 0; s < 3; s++) { if (type[j - d] !== EMPTY) break; j -= d; }
      if (j !== i) this.moveCell(i, j);
    }
  }

  function mudLife() { return MUD_LIFE + ((Math.random() * MUD_LIFE_VAR) | 0); }

  SW.Grid = Grid;
})();
