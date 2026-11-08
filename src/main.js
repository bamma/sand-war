// Browser game shell: menu, single-player loop and hand-off to online play.
// Single player is entirely local (src/match.js) and never touches the
// network. Online play lives in src/net.js, which is only loaded when the
// player picks "Play online", so a missing server can't break single player.
(function () {
  'use strict';
  const SW = window.SW;

  const SCALE = 4;
  const STEP = 1000 / 60;

  class Game {
    constructor() {
      this.canvas = document.getElementById('game');
      this.canvas.width = SW.GW * SCALE;
      this.canvas.height = SW.GH * SCALE;
      this.renderer = new SW.Renderer(this.canvas, SW.GW, SW.GH, SCALE);
      this.input = new SW.Input(this.canvas, SW.GW, SW.GH);
      this.match = null;
      this.player = null;
      this.state = 'menu';
      this.botCount = 2;
      this.paused = false;
      this.demo = true;
      this.net = null;       // online client, created on demand

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
      document.getElementById('again').addEventListener('click', (e) => {
        e.target.blur();
        if (this.net && this.net.active) this.net.rematch(); else this.start();
      });
      document.getElementById('to-menu').addEventListener('click', (e) => { e.target.blur(); this.showMenu(); });
      document.getElementById('online-btn').addEventListener('click', (e) => { e.target.blur(); this.openOnline(); });

      this.input.onKey = (code) => {
        if (this.net && this.net.active) { this.net.onKey(code); return; }
        if (code === 'Enter' && this.state === 'menu' && !this.onlinePanelOpen()) this.start();
        else if (code === 'KeyR' && this.state !== 'menu') this.start();
        else if (code === 'Escape' && this.state !== 'menu') this.showMenu();
        else if (code === 'KeyP' && this.state === 'playing') this.paused = !this.paused;
      };

      if (SW.TouchControls) this.touch = new SW.TouchControls(this);

      this.newMatch(3, true);
      this.last = performance.now();
      this.acc = 0;
      requestAnimationFrame((t) => this.loop(t));

      const room = new URLSearchParams(location.search).get('room');
      if (room) this.openOnline(room);
    }

    // The renderer and older tooling read these straight off the game.
    get grid() { return this.match.grid; }
    get particles() { return this.match.particles; }
    get shots() { return this.match.shots; }
    get chars() { return this.match.chars; }
    get toasts() { return this.match.toasts; }
    get frame() { return this.match.frame; }
    set frame(v) { this.match.frame = v; }

    onlinePanelOpen() {
      const el = document.getElementById('online');
      return el && !el.classList.contains('hidden');
    }

    showMenu() {
      if (this.net) this.net.leave();
      this.state = 'menu';
      this.overEl.classList.add('hidden');
      this.menuEl.classList.remove('hidden');
      this.newMatch(3, true);
    }

    start() {
      if (this.net) this.net.leave();
      this.menuEl.classList.add('hidden');
      this.overEl.classList.add('hidden');
      this.state = 'playing';
      this.paused = false;
      this.newMatch(this.botCount, false);
    }

    newMatch(nBots, demo) {
      this.demo = demo;
      this.match = demo
        ? new SW.Match({ humans: [], bots: 3, demo: true })
        : new SW.Match({ humans: [{ name: 'You' }], bots: nBots });
      this.match.onDeathHook = (c) => this.onDeath(c);
      this.player = demo ? null : this.match.chars[0];
      this.overShown = false;
    }

    onDeath() {}

    newMatchIfDemoOver() {
      const m = this.match;
      if (m.over && m.frame - m.overAt > 240) this.newMatch(3, true);
    }

    step() {
      this.match.step((c) => (this.state === 'playing' && c === this.player
        ? this.input.playerInput(c)
        : { move: 0, jump: false, fire: false, aim: c.aim }));
      this.checkEnd();
    }

    checkEnd() {
      const m = this.match;
      if (this.demo) { this.newMatchIfDemoOver(); return; }
      if (this.state === 'playing' && m.over) {
        this.state = 'over';
        const win = this.player.alive;
        this.overTitle.textContent = win ? 'Victory!' : 'Buried!';
        this.overSub.textContent = win
          ? `You sank every bot in ${Math.round(m.frame / 60)} seconds.`
          : 'You ran out of air under the sand.';
        this.setOverButtons(true);
      }
      if (this.state === 'over' && !this.overShown && m.frame - m.overAt > 60) {
        this.overShown = true;
        this.overEl.classList.remove('hidden');
      }
    }

    setOverButtons(canRestart, label) {
      const again = document.getElementById('again');
      again.disabled = !canRestart;
      let text = label || 'Play again (R)';
      if (document.body.classList.contains('touch')) text = text.replace(' (R)', '');
      again.textContent = text;
    }

    openOnline(room) {
      const ready = SW.NetClient ? Promise.resolve()
        : loadScript('src/protocol.js').then(() => loadScript('src/net.js'));
      ready.then(() => {
        if (!this.net) this.net = new SW.NetClient(this);
        this.net.openPanel(room);
      }).catch(() => {
        document.getElementById('online-status').textContent = 'Online play could not be loaded. Play vs bots instead.';
      });
    }

    loop(t) {
      let dt = t - this.last;
      this.last = t;
      if (dt > 250) dt = 250;
      if (this.net && this.net.active) {
        this.net.frame(t);
        this.renderer.draw(this.net.view);
        requestAnimationFrame((tt) => this.loop(tt));
        return;
      }
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

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  window.addEventListener('load', () => { window.game = new Game(); });
})();
