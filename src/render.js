// Rendering: background, characters, the sand layer and the HUD.
(function () {
  'use strict';
  const SW = window.SW;
  const { EMPTY, WALL, SAND, MUD, WATER, AIR } = SW.T;

  const pack = (r, g, b, a = 255) =>
    ((a << 24) | (clamp(b) << 16) | (clamp(g) << 8) | clamp(r)) >>> 0;
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const lerp = (a, b, t) => a + (b - a) * t;

  const SAND_RGB = [222, 186, 124];
  const MUD_RGB = [104, 74, 50];

  class Renderer {
    constructor(canvas, gw, gh, scale) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.gw = gw; this.gh = gh; this.S = scale;
      this.layer = document.createElement('canvas');
      this.layer.width = gw; this.layer.height = gh;
      this.lctx = this.layer.getContext('2d');
      this.img = this.lctx.createImageData(gw, gh);
      this.buf = new Uint32Array(this.img.data.buffer);
      this.depth = new Uint8Array(gw);
      this.buildPalettes();
      this.bg = this.buildBackground();
    }

    buildPalettes() {
      // sand[tier*16 + shade]; tier 0 = surface highlight, 3 = deep
      const tierMul = [1.1, 1.0, 0.93, 0.86];
      this.sand = new Uint32Array(64);
      for (let tier = 0; tier < 4; tier++) {
        for (let s = 0; s < 16; s++) {
          const v = (s - 8) * 2.6 + (s % 5 === 0 ? -10 : 0);
          const m = tierMul[tier];
          this.sand[tier * 16 + s] = pack((SAND_RGB[0] + v) * m, (SAND_RGB[1] + v) * m, (SAND_RGB[2] + v * 0.8) * m);
        }
      }
      // mud[dry*16 + shade]; dry 0 = fully wet, 7 = almost sand
      this.mud = new Uint32Array(128);
      for (let dry = 0; dry < 8; dry++) {
        const t = (dry / 8) * 0.75;
        for (let s = 0; s < 16; s++) {
          const v = (s - 8) * 1.6;
          this.mud[dry * 16 + s] = pack(
            lerp(MUD_RGB[0], SAND_RGB[0], t) + v,
            lerp(MUD_RGB[1], SAND_RGB[1], t) + v,
            lerp(MUD_RGB[2], SAND_RGB[2], t) + v);
        }
      }
      this.water = new Uint32Array(16);
      this.waterP = new Uint32Array(16);
      for (let s = 0; s < 16; s++) {
        const v = (s - 8) * 2;
        this.water[s] = pack(58 + v, 128 + v, 220 + v, 205);
        this.waterP[s] = pack(110 + v, 175 + v, 245, 235);
      }
      this.wall = new Uint32Array(16);
      for (let s = 0; s < 16; s++) {
        const v = (s - 8) * 2.2;
        this.wall[s] = pack(86 + v, 80 + v, 78 + v);
      }
      this.wallTop = pack(118, 110, 104);
      this.air = pack(255, 255, 255, 80);
    }

    buildBackground() {
      const S = this.S, W = this.gw * S, H = this.gh * S;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d');
      const sky = x.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#6fa7d6');
      sky.addColorStop(0.55, '#b9d3e3');
      sky.addColorStop(1, '#f1d7ae');
      x.fillStyle = sky;
      x.fillRect(0, 0, W, H);
      // sun
      const sun = x.createRadialGradient(W * 0.8, H * 0.2, 10, W * 0.8, H * 0.2, 140);
      sun.addColorStop(0, 'rgba(255,250,225,0.95)');
      sun.addColorStop(0.25, 'rgba(255,240,190,0.6)');
      sun.addColorStop(1, 'rgba(255,240,190,0)');
      x.fillStyle = sun;
      x.fillRect(0, 0, W, H);
      // distant hazy dunes
      const layers = [
        { base: 0.62, amp: 40, f: 0.006, col: 'rgba(196,186,190,0.55)' },
        { base: 0.72, amp: 30, f: 0.009, col: 'rgba(214,190,160,0.55)' },
      ];
      for (const L of layers) {
        x.fillStyle = L.col;
        x.beginPath();
        x.moveTo(0, H);
        for (let px = 0; px <= W; px += 8) {
          const y = H * L.base - Math.sin(px * L.f) * L.amp - Math.sin(px * L.f * 2.7 + 1) * L.amp * 0.4;
          x.lineTo(px, y);
        }
        x.lineTo(W, H);
        x.fill();
      }
      return c;
    }

    draw(game) {
      const ctx = this.ctx, S = this.S;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.bg, 0, 0);

      for (const c of game.chars) if (!c.alive) this.drawChar(c);
      for (const c of game.chars) if (c.alive) this.drawChar(c);

      this.drawLayer(game);
      ctx.drawImage(this.layer, 0, 0, this.gw * S, this.gh * S);
      this.drawShots(game);

      this.drawHud(game);
    }

    drawLayer(game) {
      const g = game.grid, buf = this.buf, W = g.w, H = g.h;
      const type = g.type, shade = g.shade, life = g.life;
      const depth = this.depth;
      depth.fill(0);
      const FADE = SW.MUD_DRY_FADE;
      let i = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++, i++) {
          const t = type[i];
          if (t === EMPTY) { buf[i] = 0; depth[x] = 0; continue; }
          if (t === SAND || t === MUD) {
            const d = ++depth[x];
            if (t === SAND) {
              const tier = d === 1 ? 0 : d < 4 ? 1 : d < 12 ? 2 : 3;
              buf[i] = this.sand[tier * 16 + shade[i]];
            } else {
              const l = life[i];
              const dry = l >= FADE ? 0 : Math.min(7, ((FADE - l) / FADE * 8) | 0);
              buf[i] = this.mud[dry * 16 + shade[i]];
            }
          } else if (t === WATER) {
            depth[x] = 0;
            buf[i] = this.water[shade[i]];
          } else if (t === WALL) {
            buf[i] = depth[x] === 0 && (y === 0 || type[i - W] !== WALL) ? this.wallTop : this.wall[shade[i]];
            depth[x] = 100;
          }
        }
      }
      const P = game.particles;
      for (let k = 0; k < P.n; k++) {
        const x = Math.floor(P.x[k]), y = Math.floor(P.y[k]);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const j = y * W + x;
        const t = P.type[k];
        if (t === SAND) buf[j] = this.sand[16 + P.shade[k]];
        else if (t === WATER) buf[j] = this.waterP[P.shade[k]];
        else if (t === AIR && buf[j] === 0) buf[j] = this.air;
      }
      this.lctx.putImageData(this.img, 0, 0);
    }

    drawChar(c) {
      const ctx = this.ctx, S = this.S;
      const dead = !c.alive;
      const body = dead ? '#8a8a8a' : c.color;
      const dark = dead ? '#5c5c5c' : shadeHex(c.color, -50);
      const skin = dead ? '#a8a8a8' : '#efc39c';
      const f = Math.cos(c.aim) >= 0 ? 1 : -1;
      const rect = (x, y, w, h, col) => {
        ctx.fillStyle = col;
        ctx.fillRect(Math.round((c.x + x) * S), Math.round((c.y + y) * S), Math.round(w * S), Math.round(h * S));
      };
      const walking = c.alive && c.grounded && Math.abs(c.vx) > 0.08;
      const sw = walking ? Math.sin(c.walkPhase) * 0.6 : 0;
      // legs
      rect(1, 9 + Math.max(0, sw), 1.5, 3 - Math.max(0, sw), dark);
      rect(3.5, 9 + Math.max(0, -sw), 1.5, 3 - Math.max(0, -sw), dark);
      // torso + belt
      rect(0.5, 4.5, 5, 4.75, body);
      rect(0.5, 8.5, 5, 0.75, dark);
      // head, head-wrap, tail
      rect(1, 0.75, 4, 3.75, skin);
      rect(0.75, 0.25, 4.5, 1.5, body);
      rect(f > 0 ? 0 : 5.25, 1, 0.75, 2.25, body);
      // goggles
      if (dead) {
        rect(f > 0 ? 3 : 1.5, 2, 0.5, 0.5, '#333');
        rect(f > 0 ? 4 : 2.5, 2, 0.5, 0.5, '#333');
      } else {
        rect(f > 0 ? 2.75 : 1.25, 2, 2, 1, '#1f2a36');
        rect(f > 0 ? 4.25 : 1.5, 2.1, 0.4, 0.4, '#9fe3ff');
      }
      if (dead) return;
      // arm + gun
      ctx.save();
      ctx.translate((c.x + 3) * S, (c.y + 5.5) * S);
      ctx.rotate(c.aim);
      ctx.fillStyle = '#3a3a40';
      ctx.fillRect(0, -0.7 * S, 5.5 * S, 1.4 * S);
      ctx.fillStyle = SW.WEAPONS[c.weapon].color;
      ctx.fillRect(4.25 * S, -1 * S, 1.75 * S, 2 * S);
      ctx.fillStyle = skin;
      ctx.fillRect(1 * S, -0.75 * S, 1.25 * S, 1.5 * S);
      ctx.restore();
    }

    drawShots(game) {
      const ctx = this.ctx, S = this.S;
      for (const s of game.shots.list) {
        const x = s.x * S, y = s.y * S;
        if (s.kind === SW.SHOT.CLUMP) {
          ctx.fillStyle = '#8a6a3c';
          ctx.beginPath(); ctx.arc(x, y, 2.8 * S, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#e4c07c';
          ctx.beginPath(); ctx.arc(x - 0.3 * S, y - 0.3 * S, 2.2 * S, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#f6dfa8';
          for (let k = 0; k < 4; k++) {
            const a = s.spin + k * 1.6;
            ctx.fillRect(x + Math.cos(a) * 1.2 * S - 2, y + Math.sin(a) * 1.2 * S - 2, 4, 4);
          }
        } else {
          ctx.strokeStyle = 'rgba(235,248,255,0.95)';
          ctx.lineWidth = 3;
          for (let k = 0; k < 3; k++) {
            ctx.beginPath();
            ctx.arc(x, y, (1.2 + k) * S, s.spin + k * 2, s.spin + k * 2 + 3.6);
            ctx.stroke();
          }
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.beginPath(); ctx.arc(x, y, 1.6 * S, 0, Math.PI * 2); ctx.fill();
        }
      }
      for (const b of game.shots.booms) {
        const f = b.t / b.life;
        if (b.kind === SW.SHOT.BLAST && f < 0.4) {
          ctx.fillStyle = `rgba(255,255,255,${0.45 * (1 - f / 0.4)})`;
          ctx.beginPath();
          ctx.arc(b.x * S, b.y * S, b.r * S * (0.4 + f), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = b.kind === SW.SHOT.BLAST ? `rgba(240,250,255,${1 - f})` : `rgba(240,210,150,${0.8 * (1 - f)})`;
        ctx.lineWidth = b.kind === SW.SHOT.BLAST ? 5 * (1 - f) + 1 : 3;
        ctx.beginPath();
        ctx.arc(b.x * S, b.y * S, b.r * S * (0.3 + 0.9 * f), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    drawHud(game) {
      const ctx = this.ctx, S = this.S;
      ctx.textBaseline = 'middle';

      // Labels, breath bars and buried warnings above each character.
      for (const c of game.chars) {
        const px = (c.x + c.w / 2) * S;
        let py = Math.max(14, (c.y - 3) * S);
        ctx.textAlign = 'center';
        ctx.font = 'bold 12px monospace';
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillText(c.alive ? c.name : c.name + ' - OUT', px + 1, py - 9);
        ctx.fillStyle = c.alive ? '#fff' : '#ddd';
        ctx.fillText(c.alive ? c.name : c.name + ' - OUT', px, py - 10);
        if (!c.alive) continue;
        if (c.stun > 0) {
          ctx.fillStyle = '#ffe34d';
          for (let k = 0; k < 3; k++) {
            const a = game.frame * 0.2 + k * 2.1;
            const sx = px + Math.cos(a) * 14, sy = (c.y - 1) * S + Math.sin(a) * 4;
            ctx.fillRect(sx - 3, sy - 1, 6, 2);
            ctx.fillRect(sx - 1, sy - 3, 2, 6);
          }
        }
        if (c.breath < SW.MAX_BREATH) {
          const bw = 34, frac = c.breath / SW.MAX_BREATH;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(px - bw / 2 - 1, py - 2, bw + 2, 6);
          ctx.fillStyle = frac > 0.5 ? '#7fd3ff' : frac > 0.25 ? '#ffc04d' : '#ff5a4d';
          ctx.fillRect(px - bw / 2, py - 1, bw * frac, 4);
        }
        if (c.buried && (game.frame >> 3) % 2 === 0) {
          ctx.fillStyle = '#ff4d3d';
          ctx.font = 'bold 16px monospace';
          ctx.fillText('BURIED!', px, py - 24);
        }
      }

      // Weapon panel (player only).
      const p = game.player;
      if (p) {
        ctx.textAlign = 'left';
        SW.WEAPONS.forEach((w, k) => {
          const x = 14 + k * 136, y = 12;
          const sel = p.weapon === k;
          ctx.fillStyle = sel ? 'rgba(20,20,30,0.75)' : 'rgba(20,20,30,0.45)';
          roundRect(ctx, x, y, 126, 42, 6);
          ctx.fill();
          if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
          ctx.fillStyle = w.color;
          ctx.fillRect(x + 8, y + 9, 12, 12);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 14px monospace';
          ctx.fillText(`${w.key} ${w.name}`, x + 26, y + 15);
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          ctx.fillRect(x + 8, y + 28, 110, 6);
          ctx.fillStyle = w.color;
          ctx.fillRect(x + 8, y + 28, 110 * (p.ammo[k] / w.max), 6);
          if (w.cost > 1) {
            // Tick marks: one segment per shot.
            ctx.fillStyle = 'rgba(20,20,30,0.9)';
            for (let v = w.cost; v < w.max; v += w.cost) ctx.fillRect(x + 8 + 110 * (v / w.max) - 1, y + 27, 2, 8);
          }
        });
      }

      // Alive counter.
      const bots = game.chars.filter((c) => c.isBot);
      ctx.textAlign = 'right';
      ctx.font = 'bold 16px monospace';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      const label = `Bots left: ${bots.filter((b) => b.alive).length}/${bots.length}`;
      ctx.fillText(label, this.canvas.width - 15, 31);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, this.canvas.width - 16, 30);

      // Toasts.
      ctx.textAlign = 'center';
      let ty = 84;
      for (const t of game.toasts) {
        const a = Math.min(1, t.life / 30);
        ctx.font = 'bold 18px monospace';
        ctx.fillStyle = `rgba(0,0,0,${0.5 * a})`;
        ctx.fillText(t.text, this.canvas.width / 2 + 1, ty + 1);
        ctx.fillStyle = `rgba(255,236,200,${a})`;
        ctx.fillText(t.text, this.canvas.width / 2, ty);
        ty += 24;
      }

      // Crosshair.
      if (p && p.alive && game.input.mouse.inside && game.state === 'playing') {
        const mx = game.input.mouse.x * S, my = game.input.mouse.y * S;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(mx, my, 8, 0, Math.PI * 2);
        ctx.moveTo(mx - 13, my); ctx.lineTo(mx - 4, my);
        ctx.moveTo(mx + 4, my); ctx.lineTo(mx + 13, my);
        ctx.moveTo(mx, my - 13); ctx.lineTo(mx, my - 4);
        ctx.moveTo(mx, my + 4); ctx.lineTo(mx, my + 13);
        ctx.stroke();
      }
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shadeHex(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp((n >> 16) + amt), g = clamp(((n >> 8) & 255) + amt), b = clamp((n & 255) + amt);
    return `rgb(${r},${g},${b})`;
  }

  SW.Renderer = Renderer;
})();
