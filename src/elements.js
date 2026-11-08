// Weapons: sand clump launcher, water stream and wind blast.
//
// Sand and wind fire projectiles (SW.Shots). A sand clump bursts into a pile of
// grains where it lands; a direct hit dumps the pile on the target and stuns
// them. A wind blast explodes on impact, blowing a crater in dry sand (mud
// resists it) and knocking back anyone nearby.
(function () {
  'use strict';
  const SW = window.SW;
  const { EMPTY, WALL, SAND, MUD, WATER, AIR } = SW.T;

  SW.SHOT_SPEED = 5.2;           // sand clump launch speed (uses particle gravity SW.PG)
  SW.WATER_SPEED = 5.2;
  SW.BLAST_SPEED = 6.5;
  SW.BLAST_G = 0.05;

  const CLUMP = 1, BLAST = 2;
  const CLUMP_GRAINS = 80;
  const CLUMP_COOLDOWN = 22;
  const BLAST_COST = 25;
  const BLAST_COOLDOWN = 32;
  const BLAST_LIFE = 55;         // frames before an airborne blast pops by itself
  const BLAST_RADIUS = 16;
  const STUN_CLUMP = 60;
  const CLUMP_DRIVE = 4;          // rows a direct hit drives the target into loose ground
  const STUN_BLAST = 35;

  SW.WEAPONS = [
    { id: 'sand', name: 'Sand', key: '1', max: 320, regen: 1.3, cost: CLUMP_GRAINS, color: '#e8c27a' },
    { id: 'water', name: 'Water', key: '2', max: 100, regen: 0.32, cost: 1, color: '#4f8fe8' },
    { id: 'wind', name: 'Wind', key: '3', max: BLAST_COST, regen: BLAST_COST / 300, cost: BLAST_COST, color: '#d8f1ff' },
  ];

  SW.muzzle = function (c) {
    return {
      x: c.x + c.w / 2 + Math.cos(c.aim) * 5,
      y: c.y + 5 + Math.sin(c.aim) * 5,
    };
  };

  SW.fire = function (game, c) {
    if (!c.alive || !c.firing || c.cool > 0) return;
    const w = c.weapon;
    const m = SW.muzzle(c);
    if (w === 0) {
      if (c.ammo[0] < CLUMP_GRAINS) return;
      c.ammo[0] -= CLUMP_GRAINS;
      c.cool = CLUMP_COOLDOWN;
      const sp = SW.SHOT_SPEED;
      game.shots.spawn(CLUMP, m.x, m.y, Math.cos(c.aim) * sp + c.vx * 0.4, Math.sin(c.aim) * sp, c.id);
      recoil(c, 2.4);
    } else if (w === 2) {
      if (c.ammo[2] < BLAST_COST) return;
      c.ammo[2] -= BLAST_COST;
      c.cool = BLAST_COOLDOWN;
      const sp = SW.BLAST_SPEED;
      game.shots.spawn(BLAST, m.x, m.y, Math.cos(c.aim) * sp, Math.sin(c.aim) * sp, c.id);
      recoil(c, 2.6);
    } else {
      for (let k = 0; k < 2; k++) {
        if (c.ammo[1] < 1) break;
        c.ammo[1] -= 1;
        const a = c.aim + (Math.random() - 0.5) * 0.06;
        const sp = SW.WATER_SPEED * (0.93 + Math.random() * 0.12);
        game.particles.spawn(m.x, m.y, Math.cos(a) * sp + c.vx * 0.4, Math.sin(a) * sp, WATER, c.id);
      }
      recoil(c, 0.08);
    }
  };

  // Rocket-jump: firing while airborne kicks you the opposite way, so
  // shooting down gives lift. On the ground the feet absorb it.
  function recoil(c, power) {
    if (c.grounded) return;
    const ax = Math.cos(c.aim), ay = Math.sin(c.aim);
    // A big shot fired downward also cancels the fall, like a rocket jump.
    const base = power > 1 && ay > 0 ? Math.min(c.vy, 0) : c.vy;
    c.vy = Math.max(-3.4, base - ay * power);
    c.kx -= ax * power * 0.4;
  }

  // ---------------------------------------------------------------- shots --

  class Shots {
    constructor() { this.list = []; this.booms = []; }
    reset() { this.list.length = 0; this.booms.length = 0; }

    spawn(kind, x, y, vx, vy, owner) {
      this.list.push({ kind, x, y, vx, vy, owner, age: 0, spin: Math.random() * 6 });
    }

    update(game) {
      const g = game.grid;
      this.list = this.list.filter((s) => this.step(game, g, s));
      for (const b of this.booms) b.t++;
      this.booms = this.booms.filter((b) => b.t < b.life);
    }

    // Returns false once the shot has hit something.
    step(game, g, s) {
      s.age++;
      s.spin += 0.3;
      s.vy += s.kind === BLAST ? SW.BLAST_G : SW.PG;
      if (s.kind === BLAST && s.age > BLAST_LIFE) { explode(game, s.x, s.y, s.owner, null); return false; }
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(s.vx), Math.abs(s.vy))));
      const sx = s.vx / steps, sy = s.vy / steps;
      for (let k = 0; k < steps; k++) {
        const nx = s.x + sx, ny = s.y + sy;
        const cx = Math.floor(nx), cy = Math.floor(ny);
        if (cx < 0 || cx >= g.w || cy >= g.h) return false;
        // Characters first: a direct hit.
        for (const c of game.chars) {
          if (c.id === s.owner && s.age < 25) continue;
          if (nx >= c.x - 0.5 && nx < c.x + c.w + 0.5 && ny >= c.y - 0.5 && ny < c.y + c.h + 0.5) {
            this.impact(game, s, nx, ny, c);
            return false;
          }
        }
        if (cy >= 0 && g.type[cy * g.w + cx] !== EMPTY) {
          // Bombs go off inside the dune; clumps burst just in front of it.
          if (s.kind === BLAST) this.impact(game, s, nx, ny, null);
          else this.impact(game, s, s.x, s.y, null);
          return false;
        }
        s.x = nx; s.y = ny;
      }
      return true;
    }

    impact(game, s, x, y, hit) {
      if (s.kind === BLAST) { explode(game, x, y, s.owner, hit); return; }
      const P = game.particles;
      if (hit && hit.alive) {
        hit.stun = Math.max(hit.stun, STUN_CLUMP);
        hit.load += 30;
        hit.kx += s.vx * 0.15;
        // Pile-driver: knocked out of the air, and hammered into loose ground.
        if (hit.vy < 1.5) hit.vy = 1.5;
        if (hit.grounded) for (let k = 0; k < CLUMP_DRIVE; k++) if (!hit.sinkOne(game.grid)) break;
        // The whole clump comes down on top of them.
        for (let i = 0; i < CLUMP_GRAINS; i++) {
          P.spawn(hit.x - 3 + Math.random() * (hit.w + 6), hit.y - 2 - Math.random() * 8,
            (Math.random() - 0.5) * 0.6, Math.random() * 0.5, SAND, -1);
        }
      } else {
        // Burst into a small splash that settles as a mound.
        for (let i = 0; i < CLUMP_GRAINS; i++) {
          const a = -Math.PI * Math.random();
          const sp = 0.3 + Math.random() * 1.4;
          P.spawn(x + (Math.random() - 0.5) * 3, y + (Math.random() - 0.5) * 3,
            Math.cos(a) * sp + s.vx * 0.12, Math.sin(a) * sp, SAND, -1);
        }
      }
      this.booms.push({ x, y, t: 0, life: 8, r: 6, kind: CLUMP });
    }
  }
  SW.Shots = Shots;

  // Wind bomb: scoop dry sand/water out of a disc and fling it up and outwards.
  function explode(game, x, y, owner, hit) {
    const g = game.grid, P = game.particles;
    const R = BLAST_RADIUS;
    const x0 = Math.max(0, Math.floor(x - R)), x1 = Math.min(g.w - 1, Math.ceil(x + R));
    const y0 = Math.max(0, Math.floor(y - R)), y1 = Math.min(g.h - 1, Math.ceil(y + R));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx + 0.5 - x, dy = yy + 0.5 - y;
        const d = Math.hypot(dx, dy);
        if (d > R) continue;
        const i = yy * g.w + xx;
        const t = g.type[i];
        if (t !== SAND && t !== WATER) continue; // walls and wet mud hold firm
        const s = 1 - d / R;
        if (Math.random() > 0.45 + 0.6 * s) continue;
        const sh = g.shade[i];
        const nx = d > 0.01 ? dx / d : 0, ny = d > 0.01 ? dy / d : -1;
        // Ejecta fan out sideways but always go up: the open side of an impact
        // crater is the sky, so grains escape instead of re-hitting the dune.
        const sp = 1.5 + 4 * s + Math.random();
        const pi = P.spawn(xx + 0.5, yy + 0.5,
          nx * sp + (Math.random() - 0.5) * 1.2,
          Math.min(ny, 0) * sp * 0.5 - 1.8 - 3.5 * s - Math.random() * 1.5,
          t, owner, sh);
        if (pi < 0) continue;          // particle pool full: leave the grain where it is
        g.clear(i);
        P.ghost[pi] = 4;
      }
    }
    // Shockwave on characters.
    for (const c of game.chars) {
      if (!c.alive) continue;
      const dx = c.cx - x, dy = c.cy - y;
      const d = Math.hypot(dx, dy);
      if (d > R + 8 && c !== hit) continue;
      const s = c === hit ? 1 : Math.max(0, 1 - d / (R + 8));
      const mul = c.id === owner ? 0.6 : 1;
      const nx = d > 0.01 ? dx / d : 0;
      c.kx += nx * 1.6 * s * mul;
      c.vy = Math.min(c.vy, c.vy - 1.8 * s * mul);
      if (c === hit && c.id !== owner) c.stun = Math.max(c.stun, STUN_BLAST);
    }
    // And on grains already in the air.
    for (let i = 0; i < P.n; i++) {
      const dx = P.x[i] - x, dy = P.y[i] - y;
      const d = Math.hypot(dx, dy);
      if (d > R * 2 || d < 0.01) continue;
      const s = 1 - d / (R * 2);
      P.vx[i] += (dx / d) * 3 * s;
      P.vy[i] += (dy / d) * 3 * s - s;
    }
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * Math.PI * 2;
      P.spawn(x, y, Math.cos(a) * 4, Math.sin(a) * 4, AIR, owner);
    }
    game.shots.booms.push({ x, y, t: 0, life: 12, r: R, kind: BLAST });
  }

  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }
  SW.angleDiff = angleDiff;

  // Launch angle (screen coords, y down) to hit (tx,ty) from (ox,oy).
  SW.ballisticAim = function (ox, oy, tx, ty, v, g, high) {
    const X = tx - ox, Y = oy - ty; // Y up-positive
    const ax = Math.max(1, Math.abs(X));
    const v2 = v * v;
    const disc = v2 * v2 - g * (g * ax * ax + 2 * Y * v2);
    let theta;
    if (disc < 0) theta = Math.PI / 4;
    else theta = Math.atan((v2 + (high ? 1 : -1) * Math.sqrt(disc)) / (g * ax));
    return X >= 0 ? -theta : theta - Math.PI;
  };

  SW.SHOT = { CLUMP, BLAST };
})();
