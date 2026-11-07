// Player / bot body: movement through sand, sinking, and burial.
//
// Character bodies are solid to the sand simulation (see Grid.stampBodies), so
// sand piles on heads and shoulders and fills in around a character. You are
// "buried" when sand covers your head and surrounds it on both sides.
(function () {
  'use strict';
  const SW = window.SW;
  const { EMPTY, WALL, SAND, MUD, WATER } = SW.T;

  const MAX_BREATH = 180;        // frames of air once the head is buried (~3 s)
  const BURIED_AT = 0.7;
  SW.MAX_BREATH = MAX_BREATH;
  SW.BURIED_AT = BURIED_AT;

  const solid = (t) => t === WALL || t === SAND || t === MUD;
  const loose = (t) => t === SAND || t === MUD || t === WATER;

  class Character {
    constructor(id, name, color, x, y, isBot) {
      this.id = id;
      this.name = name;
      this.color = color;
      this.isBot = isBot;
      this.w = 6;
      this.h = 12;
      this.x = x | 0;
      this.y = y | 0;
      this.rx = 0; this.ry = 0;
      this.vx = 0; this.vy = 0;
      this.kx = 0;               // knockback (wind, hits)
      this.load = 0;             // recent sand hits: these push you down into the ground
      this.sinkAcc = 0;
      this.aim = isBot ? Math.PI : 0;
      this.weapon = 0;
      this.ammo = SW.WEAPONS.map((w) => w.max);
      this.breath = MAX_BREATH;
      this.alive = true;
      this.grounded = false;
      this.jumpCd = 0;
      this.firing = false;
      this.walkPhase = 0;
      this.stun = 0;             // frames left stunned by a direct hit
      this.cool = 0;             // weapon cooldown frames
      // sandF: how deep we are sunk (side cells filled), mudF: mud share of that,
      // headF: how covered the head is, topLoad: grains piled on our head.
      this.sandF = 0; this.mudF = 0; this.waterF = 0; this.headF = 0; this.topLoad = 0; this.footMud = 0;
    }

    get cx() { return this.x + this.w / 2; }
    get cy() { return this.y + this.h / 2; }
    get buried() { return this.headF >= BURIED_AT; }

    computeFills(g) {
      const x0 = this.x - 1, x1 = this.x + this.w;
      let side = 0, mud = 0, water = 0, sideHead = 0;
      for (let r = 0; r < this.h; r++) {
        const yy = this.y + r;
        for (let k = 0; k < 2; k++) {
          const t = g.get(k ? x1 : x0, yy);
          if (t === SAND || t === MUD) side++;
          if (t === MUD) mud++;
          else if (t === WATER) water++;
          if (r < 3 && solid(t)) sideHead++;
        }
      }
      let top = 0, load = 0;
      for (let c = 0; c < this.w; c++) {
        const xx = this.x + c;
        if (solid(g.get(xx, this.y - 1))) top++;
        for (let r = 1; r <= 8; r++) {
          const t = g.get(xx, this.y - r);
          if (t !== SAND && t !== MUD) break;
          load++;
        }
      }
      const n = 2 * this.h;
      this.sandF = side / n;
      this.mudF = mud / n;
      this.waterF = water / n;
      this.headF = 0.5 * (top / this.w) + 0.5 * (sideHead / 6);
      let foot = 0;
      for (let c = 0; c < this.w; c++) if (g.get(this.x + c, this.y + this.h) === MUD) foot++;
      this.footMud = foot / this.w;   // share of the ground under our feet that is mud
      // Pinned against the arena ceiling by rising sand: no air up there.
      if (this.y <= 2 && top === this.w && this.sandF > 0.3) this.headF = 1;
      this.topLoad = load;
    }

    update(game, inp) {
      const g = game.grid;
      this.computeFills(g);
      if (!this.alive) {
        // Bodies stay in the arena as obstacles, but still fall.
        this.firing = false;
        this.vy = Math.min(3.5, this.vy + 0.13);
        this.moveY(g, this.vy);
        return;
      }

      for (let k = 0; k < this.ammo.length; k++) {
        const W = SW.WEAPONS[k];
        this.ammo[k] = Math.min(W.max, this.ammo[k] + W.regen);
      }
      if (this.cool > 0) this.cool--;
      if (this.stun > 0) {
        this.stun--;
        inp = { move: 0, jump: false, fire: false, aim: this.aim, weapon: this.weapon };
      }
      if (inp.weapon !== undefined) this.weapon = inp.weapon;
      this.aim = inp.aim;

      const mudSlow = Math.min(1, this.mudF * 3);
      // Mud is sticky: standing in it or walking on it drags you down.
      const speed = 0.7 * (1 - 0.55 * this.sandF) * (1 - 0.8 * mudSlow) * (1 - 0.6 * this.footMud);
      this.vx += (inp.move * speed - this.vx) * (this.grounded ? 0.35 : 0.12);
      this.kx *= 0.9;
      if (Math.abs(this.kx) < 0.01) this.kx = 0;
      this.vy += 0.13;
      if (this.waterF > 0) this.vy *= 0.97;
      if (this.vy > 3.5) this.vy = 3.5;

      if (this.jumpCd > 0) this.jumpCd--;
      if (inp.jump && this.grounded && this.jumpCd === 0) {
        const jm = Math.max(0.18, (1 - 0.3 * this.sandF - 2.4 * this.mudF) * (1 - 0.5 * this.footMud));
        this.vy = -2.6 * jm;
        this.jumpCd = 14;
      }

      this.moveX(g, this.vx + this.kx);
      this.moveY(g, this.vy);
      this.grounded = this.checkGround(g);
      this.sink(g);
      if (inp.move !== 0 && this.grounded) this.walkPhase += Math.abs(this.vx) * 0.6;

      this.computeFills(g);
      if (this.headF >= BURIED_AT) {
        this.breath -= 1;
        if (this.breath <= 0) {
          this.breath = 0;
          this.alive = false;
          this.firing = false;
          game.onDeath(this);
          return;
        }
      } else {
        this.breath = Math.min(MAX_BREATH, this.breath + 2);
      }
      this.firing = !!inp.fire;
    }

    moveX(g, v) {
      this.rx += v;
      while (this.rx >= 1) {
        this.rx -= 1;
        if (!this.stepX(g, 1)) { this.rx = 0; this.vx = 0; this.kx = 0; break; }
      }
      while (this.rx <= -1) {
        this.rx += 1;
        if (!this.stepX(g, -1)) { this.rx = 0; this.vx = 0; this.kx = 0; break; }
      }
    }

    moveY(g, v) {
      this.ry += v;
      while (this.ry >= 1) {
        this.ry -= 1;
        if (!this.stepY(g, 1)) { this.ry = 0; this.vy = 0; break; }
      }
      while (this.ry <= -1) {
        this.ry += 1;
        if (!this.stepY(g, -1)) { this.ry = 0; this.vy = 0; break; }
        if (this.vy >= 0) { this.ry = 0; break; }
      }
    }

    stepX(g, d) {
      const lx = d > 0 ? this.x + this.w : this.x - 1;
      let wall = false, run = 0, upper = false, inRun = true;
      for (let r = this.h - 1; r >= 0; r--) {
        const t = g.get(lx, this.y + r);
        const s = solid(t);
        if (inRun) { if (s) run++; else inRun = false; } else if (s) upper = true;
        if (t === WALL) wall = true;
      }
      if (run === 0 && !upper) { this.x += d; return true; }

      // Small step (slope / low ledge): climb it if there is headroom.
      if (run <= 3 && !upper && this.sandF < 0.3) {
        const x0 = Math.min(this.x, lx), x1 = Math.max(this.x + this.w - 1, lx);
        let clear = true;
        for (let k = 1; k <= run && clear; k++) {
          for (let x = x0; x <= x1; x++) if (solid(g.get(x, this.y - k))) { clear = false; break; }
        }
        if (clear) { this.y -= run; this.x += d; return true; }
      }
      if (wall) return false;

      // Wade / plough through loose material, pushing it behind us.
      const tx = d > 0 ? this.x : this.x + this.w - 1;
      let cost = 0;
      for (let r = 0; r < this.h; r++) {
        const yy = this.y + r;
        if (!g.inb(lx, yy)) continue;
        const li = g.idx(lx, yy);
        const t = g.type[li];
        if (!loose(t)) continue;
        cost += t === MUD ? 0.2 : t === SAND ? 0.05 : 0.01;
        const ti = g.idx(tx, yy);
        if (g.type[ti] === EMPTY) g.moveCell(li, ti);
      }
      this.x += d;
      const f = Math.max(0, 1 - cost);
      this.vx *= f; this.kx *= f; this.rx *= f;
      return true;
    }

    stepY(g, d) {
      if (d > 0) {
        const fy = this.y + this.h;
        for (let c = 0; c < this.w; c++) if (solid(g.get(this.x + c, fy))) return false;
        this.y++;
        return true;
      }
      const hy = this.y - 1;
      if (hy < -40) return false;
      for (let c = 0; c < this.w; c++) if (g.get(this.x + c, hy) === WALL) return false;
      // Pushing up through sand/mud: it gets displaced beneath our feet, at a cost.
      let cost = 0;
      if (hy >= 0) {
        const by = this.y + this.h - 1;
        for (let c = 0; c < this.w; c++) {
          const hi = g.idx(this.x + c, hy);
          const t = g.type[hi];
          if (!loose(t)) continue;
          cost += t === MUD ? 0.25 : t === SAND ? 0.1 : 0.01;
          const bi = g.idx(this.x + c, by);
          if (g.type[bi] === EMPTY) g.moveCell(hi, bi);
        }
      }
      this.y--;
      this.vy = Math.min(0, this.vy + cost);
      return true;
    }

    // Standing on loose ground while being pelted, carrying a pile of sand on
    // your head, or standing in mud makes you slowly sink, like quicksand.
    sink(g) {
      this.load = Math.max(0, this.load - 0.12);
      if (!this.grounded || this.vy < 0) { this.sinkAcc = 0; return; }
      const fy = this.y + this.h;
      let lc = 0, mud = 0;
      for (let c = 0; c < this.w; c++) {
        const t = g.get(this.x + c, fy);
        if (t === WALL) { this.sinkAcc = 0; return; }
        if (t === SAND) lc++;
        else if (t === MUD) { lc++; mud++; }
      }
      if (lc < this.w / 2) return;
      this.sinkAcc += Math.min(this.load, 40) * 0.002
        + Math.min(this.topLoad, 30) * 0.0006
        + (mud >= 2 || this.mudF > 0.05 ? 0.014 : 0);
      while (this.sinkAcc >= 1) {
        this.sinkAcc -= 1;
        if (!this.sinkOne(g)) break;
      }
    }

    // Sink one row into loose ground: the ground under our feet is pushed up
    // and over us. Returns false if there is wall (or the floor) underfoot.
    sinkOne(g) {
      const fy = this.y + this.h;
      if (fy + 1 >= g.h - 3) return false;
      let lc = 0;
      for (let c = 0; c < this.w; c++) {
        const t = g.get(this.x + c, fy);
        if (t === WALL) return false;
        if (t === SAND || t === MUD) lc++;
      }
      if (lc < this.w / 2) return false;
      for (let c = 0; c < this.w; c++) {
        const xx = this.x + c;
        const fi = g.idx(xx, fy);
        if (!loose(g.type[fi])) continue;
        let moved = false;
        for (let yy = this.y - 1; yy >= 0; yy--) {
          const t = g.type[g.idx(xx, yy)];
          if (t === EMPTY) { g.moveCell(fi, g.idx(xx, yy)); moved = true; break; }
          if (t === WALL) break;
        }
        if (!moved) g.clear(fi);
      }
      this.y++;
      return true;
    }

    checkGround(g) {
      const fy = this.y + this.h;
      for (let c = 0; c < this.w; c++) if (solid(g.get(this.x + c, fy))) return true;
      return false;
    }
  }

  SW.Character = Character;
})();
