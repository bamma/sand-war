// Weapons: sand gun, water gun and wind gust.
(function () {
  'use strict';
  const SW = window.SW;
  const { EMPTY, WALL, SAND, MUD, WATER, AIR } = SW.T;

  SW.SHOT_SPEED = 5.2;

  SW.WEAPONS = [
    { id: 'sand', name: 'Sand', key: '1', max: 200, regen: 0.9, color: '#e8c27a' },
    { id: 'water', name: 'Water', key: '2', max: 100, regen: 0.32, color: '#4f8fe8' },
    { id: 'wind', name: 'Wind', key: '3', max: 100, regen: 0.4, color: '#d8f1ff' },
  ];

  const WIND_COST = 1.4;
  const WIND_RANGE = 56;
  const WIND_HALF = 0.4;
  const WIND_RAYS = 15;

  SW.muzzle = function (c) {
    return {
      x: c.x + c.w / 2 + Math.cos(c.aim) * 5,
      y: c.y + 5 + Math.sin(c.aim) * 5,
    };
  };

  SW.fire = function (game, c) {
    if (!c.alive || !c.firing) return;
    const w = c.weapon;
    if (w === 2) { gust(game, c); return; }
    const m = SW.muzzle(c);
    const type = w === 0 ? SAND : WATER;
    const spread = w === 0 ? 0.09 : 0.06;
    const per = w === 0 ? 3 : 2;
    for (let k = 0; k < per; k++) {
      if (c.ammo[w] < 1) break;
      c.ammo[w] -= 1;
      const a = c.aim + (Math.random() - 0.5) * spread;
      const sp = SW.SHOT_SPEED * (0.93 + Math.random() * 0.12);
      game.particles.spawn(m.x, m.y, Math.cos(a) * sp + c.vx * 0.4, Math.sin(a) * sp, type, c.id);
    }
  };

  function gust(game, c) {
    if (c.ammo[2] < WIND_COST) return;
    c.ammo[2] -= WIND_COST;
    const g = game.grid, P = game.particles;
    const ox = c.x + c.w / 2, oy = c.y + c.h / 2 - 1;

    for (let r = 0; r < WIND_RAYS; r++) {
      const a = c.aim + ((r + Math.random()) / WIND_RAYS - 0.5) * 2 * WIND_HALF;
      const dx = Math.cos(a), dy = Math.sin(a);
      let blown = 0, reach = WIND_RANGE;
      for (let d = 1; d < WIND_RANGE; d++) {
        const ix = Math.floor(ox + dx * d), iy = Math.floor(oy + dy * d);
        if (ix < 0 || ix >= g.w || iy >= g.h) break;
        if (iy < 0) continue;
        const i = iy * g.w + ix;
        const t = g.type[i];
        if (t === WALL || t === MUD) { reach = d; break; } // wet mud is too heavy to blow
        if (t === SAND || t === WATER) {
          const s = 1 - d / WIND_RANGE;
          if (Math.random() < 0.25 + 0.7 * s) {
            // Lift the grain out at the surface of its column so it sprays
            // up and away instead of being shoved back into the dune.
            let top = iy - 1;
            while (top >= 0 && iy - top < 30 && g.type[top * g.w + ix] !== EMPTY) top--;
            if (top >= 0 && g.type[top * g.w + ix] !== EMPTY) { reach = d; break; }
            const sh = g.shade[i];
            g.clear(i);
            const sp = 2.2 + 4 * s + Math.random() * 0.8;
            P.spawn(ix + 0.5, Math.max(0, top) + 0.5,
              dx * sp + (Math.random() - 0.5) * 0.8,
              dy * sp - 1.0 - Math.random() * 1.6,
              t, c.id, sh);
            if (++blown >= 2) { reach = d; break; }
          } else { reach = d; break; }
        }
      }
      if (Math.random() < 0.6 && reach > 4) {
        const d = 3 + Math.random() * (reach - 4);
        P.spawn(ox + dx * d, oy + dy * d, dx * 3.5, dy * 3.5, AIR, c.id);
      }
    }

    // Push other characters.
    const ax = Math.cos(c.aim), ay = Math.sin(c.aim);
    for (const o of game.chars) {
      if (o === c || !o.alive) continue;
      const ddx = o.cx - ox, ddy = o.cy - oy;
      const dist = Math.hypot(ddx, ddy);
      if (dist > WIND_RANGE + 3 || dist < 0.01) continue;
      if (Math.abs(angleDiff(Math.atan2(ddy, ddx), c.aim)) > WIND_HALF + 0.2) continue;
      if (!clearLine(g, ox, oy, o.cx, o.cy)) continue;
      const s = 1 - dist / WIND_RANGE;
      o.kx += ax * 0.07 * s;
      o.vy += ay * 0.08 * s - (o.grounded ? 0.03 * s : 0);
    }

    // Push airborne grains too.
    for (let i = 0; i < P.n; i++) {
      const t = P.type[i];
      if (t !== SAND && t !== WATER) continue;
      const ddx = P.x[i] - ox, ddy = P.y[i] - oy;
      const dist = Math.hypot(ddx, ddy);
      if (dist > WIND_RANGE || dist < 0.01) continue;
      if (Math.abs(angleDiff(Math.atan2(ddy, ddx), c.aim)) > WIND_HALF) continue;
      const s = 1 - dist / WIND_RANGE;
      P.vx[i] += ax * 0.4 * s;
      P.vy[i] += ay * 0.4 * s;
    }
  }

  function clearLine(g, x0, y0, x1, y1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let k = 1; k < n; k++) {
      const t = g.get(Math.floor(x0 + (x1 - x0) * k / n), Math.floor(y0 + (y1 - y0) * k / n));
      if (t === WALL || t === MUD) return false;
    }
    return true;
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
})();
