// Game setup, loop and match flow.
(function () {
  'use strict';
  const SW = window.SW;
  const { WALL, SAND } = SW.T;

  const GW = 320, GH = 180, SCALE = 4;
  const STEP = 1000 / 60;
  const STORM_AT = 90 * 60;
  const COLORS = ['#3d7be0', '#e0503d', '#3daf5a', '#a54de0'];
  const BOT_NAMES = ['Dusty', 'Dune', 'Grit'];

  class Game {
    constructor() {
      this.canvas = document.getElementById('game');
      this.canvas.width = GW * SCALE;
      this.canvas.height = GH * SCALE;
      this.renderer = new SW.Renderer(this.canvas, GW, GH, SCALE);
      this.input = new SW.Input(this.canvas, GW, GH);
      this.grid = new SW.Grid(GW, GH);
      this.particles = new SW.Particles(6000);
      this.shots = new SW.Shots();
      this.chars = [];
      this.player = null;
      this.toasts = [];
      this.frame = 0;
      this.state = 'menu';
      this.botCount = 2;
      this.overAt = 0;
      this.paused = false;

      this.menuEl = document.getElementById('menu');
      this.overEl = document.getElementById('over');
      this.overTitle = document.getElementById('over-title');
      this.overSub = document.getElementById('over-sub');

      document.querySelectorAll('[data-bots]').forEach((b) => {
        b.addEventListener('click', () => {
          this.botCount = +b.dataset.bots;
          document.querySelectorAll('[data-bots]').forEach((o) => o.classList.toggle('sel', o === b));
          b.blur();
        });
      });
      document.getElementById('start').addEventListener('click', (e) => { e.target.blur(); this.start(); });
      document.getElementById('again').addEventListener('click', (e) => { e.target.blur(); this.start(); });
      document.getElementById('to-menu').addEventListener('click', (e) => { e.target.blur(); this.showMenu(); });

      this.input.onKey = (code) => {
        if (code === 'Enter' && this.state === 'menu') this.start();
        else if (code === 'KeyR' && this.state !== 'menu') this.start();
        else if (code === 'Escape' && this.state !== 'menu') this.showMenu();
        else if (code === 'KeyP' && this.state === 'playing') this.paused = !this.paused;
      };

      this.newMatch(3, true);
      this.last = performance.now();
      this.acc = 0;
      requestAnimationFrame((t) => this.loop(t));
    }

    showMenu() {
      this.state = 'menu';
      this.overEl.classList.add('hidden');
      this.menuEl.classList.remove('hidden');
      this.newMatch(3, true);
    }

    start() {
      this.menuEl.classList.add('hidden');
      this.overEl.classList.add('hidden');
      this.state = 'playing';
      this.paused = false;
      this.newMatch(this.botCount, false);
    }

    newMatch(nBots, demo) {
      this.grid = new SW.Grid(GW, GH);
      this.particles.reset();
      this.shots.reset();
      this.toasts = [];
      this.frame = 0;
      this.buildArena();
      this.chars = [];
      this.player = null;
      let id = 0;
      if (!demo) {
        this.player = new SW.Character(id++, 'You', COLORS[0], 90, 30, false);
        this.chars.push(this.player);
      }
      const spots = demo
        ? [[40], [150], [270]]
        : nBots === 1 ? [[250]] : nBots === 2 ? [[190], [275]] : [[40], [200], [275]];
      for (let k = 0; k < nBots; k++) {
        const c = new SW.Character(id++, BOT_NAMES[k], COLORS[k + 1], spots[k][0], 30, true);
        c.brain = new SW.BotBrain(c, 0.5 + Math.random() * 0.4);
        this.chars.push(c);
      }
      this.demo = demo;
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
      if (t === 0) this.toasts.push({ text: 'Sandstorm incoming!', life: 200 });
      if (t < 0) return;
      const rate = Math.min(8, 0.5 + t / 600);
      let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
      while (n--) {
        this.particles.spawn(3 + Math.random() * (GW - 6), 2.5, (Math.random() - 0.3) * 0.6, 0.5 + Math.random(), SAND, -1);
      }
    }

    onDeath(c) {
      this.toasts.push({ text: c === this.player ? 'You were buried!' : `${c.name} was buried!`, life: 180 });
    }

    step() {
      this.frame++;
      for (const c of this.chars) {
        const inp = c.isBot ? c.brain.getInput(this) : this.state === 'playing'
          ? this.input.playerInput(c) : { move: 0, jump: false, fire: false, aim: c.aim };
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
      this.checkEnd();
    }

    checkEnd() {
      if (this.demo) {
        const alive = this.chars.filter((c) => c.alive).length;
        if (alive <= 1) {
          if (!this.overAt) this.overAt = this.frame;
          else if (this.frame - this.overAt > 240) { this.overAt = 0; this.newMatch(3, true); }
        }
        return;
      }
      if (this.state !== 'playing') {
        if (this.state === 'over' && this.frame - this.overAt > 60) this.overEl.classList.remove('hidden');
        return;
      }
      const botsAlive = this.chars.some((c) => c.isBot && c.alive);
      if (!this.player.alive || !botsAlive) {
        this.state = 'over';
        this.overAt = this.frame;
        const win = this.player.alive;
        this.overTitle.textContent = win ? 'Victory!' : 'Buried!';
        this.overSub.textContent = win
          ? `You sank every bot in ${Math.round(this.frame / 60)} seconds.`
          : 'You ran out of air under the sand.';
      }
    }

    loop(t) {
      let dt = t - this.last;
      this.last = t;
      if (dt > 250) dt = 250;
      if (!this.paused) {
        this.acc += dt;
        let n = 0;
        while (this.acc >= STEP && n < 4) { this.step(); this.acc -= STEP; n++; }
        if (n === 4) this.acc = 0;
      }
      this.renderer.draw(this);
      if (this.paused) {
        const ctx = this.renderer.ctx;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.font = 'bold 40px monospace';
        ctx.fillText('PAUSED', this.canvas.width / 2, this.canvas.height / 2);
      }
      requestAnimationFrame((tt) => this.loop(tt));
    }
  }

  window.addEventListener('load', () => { window.game = new Game(); });
})();
