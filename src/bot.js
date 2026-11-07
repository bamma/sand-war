// Bot AI: picks a target, chooses an element, aims ballistically, digs out when buried.
(function () {
  'use strict';
  const SW = window.SW;
  const { SAND, MUD } = SW.T;

  class BotBrain {
    constructor(c, skill) {
      this.c = c;
      this.skill = skill;            // 0..1
      this.think = 0;
      this.move = 0;
      this.weapon = 0;
      this.firing = false;
      this.highArc = false;
      this.err = 0;
      this.burstAt = 0.5;
      this.lastX = c.x;
      this.stuck = 0;
      this.mode = 'fight';
      this.escapeAim = -Math.PI / 2;
      this.wantDist = 60 + Math.random() * 80;
      this.jumpT = 0;
      this.target = null;
      this.startDelay = 70 + ((Math.random() * 60) | 0);
    }

    pickTarget(game) {
      const c = this.c;
      let best = null, bd = Infinity;
      for (const o of game.chars) {
        if (o === c || !o.alive) continue;
        const d = Math.abs(o.cx - c.cx) + Math.abs(o.cy - c.cy) * 0.5 + (Math.random() * 30);
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    }

    getInput(game) {
      const c = this.c;
      const inp = { move: 0, jump: false, fire: false, aim: c.aim, weapon: this.weapon };
      if (!c.alive) return inp;
      if (!this.target || !this.target.alive) this.target = this.pickTarget(game);
      if (--this.think <= 0) {
        this.think = 12 + ((Math.random() * 16) | 0);
        if (Math.random() < 0.15) this.target = this.pickTarget(game);
        this.decide(game);
      }
      const target = this.target;

      if (this.move !== 0 && c.x === this.lastX) this.stuck++; else this.stuck = 0;
      this.lastX = c.x;

      inp.move = this.move;
      inp.jump = this.mode === 'escape' || this.stuck > 8 || this.jumpT > 0;
      if (this.jumpT > 0) this.jumpT--;

      if (this.mode === 'escape') {
        inp.aim = this.escapeAim;
      } else if (target) {
        const ox = c.x + c.w / 2, oy = c.y + 5;
        if (this.weapon === 2) {
          inp.aim = Math.atan2(target.cy - oy, target.cx - ox) + this.err;
        } else {
          inp.aim = SW.ballisticAim(ox, oy, target.cx, target.y - 2, SW.SHOT_SPEED, SW.PG, this.highArc) + this.err;
        }
      }

      const ammo = c.ammo[this.weapon], max = SW.WEAPONS[this.weapon].max;
      if (game.frame < this.startDelay || (!target && this.mode !== 'escape')) this.firing = false;
      else if (this.firing) { if (ammo < 2) this.firing = false; }
      else if (ammo > max * this.burstAt || (this.mode === 'escape' && ammo > 6)) this.firing = true;

      inp.fire = this.firing;
      inp.weapon = this.weapon;
      return inp;
    }

    decide(game) {
      const c = this.c;
      const prev = this.weapon;
      const buried = c.headF > 0.35 || c.sandF > 0.5 || c.mudF > 0.1 || c.topLoad > 10;
      if (buried) {
        this.mode = 'escape';
        if (c.ammo[2] > 6) this.weapon = 2;
        this.escapeAim = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
        this.move = Math.random() < 0.5 ? -1 : 1;
        if (prev !== this.weapon) this.firing = false;
        return;
      }
      this.mode = 'fight';
      const target = this.target;
      if (!target) { this.move = 0; return; }

      const dx = target.cx - c.cx, dist = Math.abs(dx);
      const r = Math.random();
      if (target.sandF > 0.2 && c.ammo[1] > 40 && r < 0.55) this.weapon = 1;
      else if (this.blocked(game.grid, c, target) && c.ammo[2] > 40 && r < 0.45) this.weapon = 2;
      else if (dist < 30 && c.ammo[2] > 50 && r < 0.12) this.weapon = 2;
      else if (c.ammo[0] > 15 || r < 0.5) this.weapon = 0;
      if (prev !== this.weapon) this.firing = false;

      this.highArc = Math.random() < 0.45;
      this.err = (Math.random() - 0.5) * 0.12 * (1.3 - this.skill);
      this.burstAt = 0.15 + Math.random() * 0.35;

      if (dist > this.wantDist + 25) this.move = Math.sign(dx);
      else if (dist < this.wantDist - 25) this.move = -Math.sign(dx);
      else this.move = Math.random() < 0.35 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      if (Math.random() < 0.08) this.jumpT = 4;
      if (Math.random() < 0.1) this.wantDist = 45 + Math.random() * 100;
    }

    blocked(g, c, t) {
      const x0 = c.cx, y0 = c.y + 5, x1 = t.cx, y1 = t.cy;
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
      let count = 0;
      for (let k = 4; k < n - 4; k++) {
        const tt = g.get(Math.floor(x0 + (x1 - x0) * k / n), Math.floor(y0 + (y1 - y0) * k / n));
        if (tt === SAND || tt === MUD) count++;
      }
      return count > 12;
    }
  }

  SW.BotBrain = BotBrain;
})();
