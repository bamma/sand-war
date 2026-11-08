// Touch controls for phones and tablets: twin floating sticks plus buttons.
//   Left half of the screen:  drag to move, push up to jump.
//   Right half of the screen: drag to aim, fire while the stick is pushed out.
//   Buttons: element select (Sand / Water / Wind), pause and menu.
// Writes into input.touch, which Input.playerInput merges with the keyboard.
(function () {
  'use strict';
  const SW = window.SW;

  const STICK_R = 56;      // knob travel, CSS px
  const MOVE_DEAD = 14;    // horizontal dead zone for walking
  const JUMP_DY = 28;      // push this far up to jump
  const FIRE_DEAD = 20;    // aim stick must be pushed this far to fire

  function isTouchDevice() {
    return ('ontouchstart' in window) || navigator.maxTouchPoints > 0
      || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
  }

  class TouchControls {
    constructor(game) {
      this.game = game;
      this.input = game.input;
      this.t = this.input.touch;
      this.sticks = { move: null, aim: null }; // active pointer per stick
      this.enabled = false;

      this.layer = document.getElementById('touch');
      this.moveBase = this.layer.querySelector('.stick.move');
      this.aimBase = this.layer.querySelector('.stick.aim');
      this.weaponBtns = [...this.layer.querySelectorAll('[data-weapon]')];
      this.pauseBtn = this.layer.querySelector('[data-act="pause"]');

      if (isTouchDevice()) this.enable();
      // A hybrid laptop may only reveal touch when it's used.
      window.addEventListener('touchstart', () => this.enable(), { passive: true, once: true });

      this.layer.addEventListener('pointerdown', (e) => this.down(e));
      this.layer.addEventListener('pointermove', (e) => this.move(e));
      this.layer.addEventListener('pointerup', (e) => this.up(e));
      this.layer.addEventListener('pointercancel', (e) => this.up(e));
      this.layer.addEventListener('contextmenu', (e) => e.preventDefault());

      this.weaponBtns.forEach((b) => {
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault(); e.stopPropagation();
          this.input.weaponSel = +b.dataset.weapon;
        });
      });
      this.layer.querySelectorAll('[data-act]').forEach((b) => {
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault(); e.stopPropagation();
          const code = b.dataset.act === 'pause' ? 'KeyP' : 'Escape';
          if (this.input.onKey) this.input.onKey(code);
        });
      });

      // Go fullscreen + landscape when a match starts from a tap (where allowed).
      ['start', 'again', 'lobby-start'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => { if (this.enabled) goFullscreen(); });
      });

      requestAnimationFrame(() => this.tick());
    }

    enable() {
      if (this.enabled) return;
      this.enabled = true;
      document.body.classList.add('touch');
    }

    // Show the controls only while a match is on screen.
    tick() {
      const g = this.game;
      const menuOpen = !document.getElementById('menu').classList.contains('hidden');
      const overOpen = !document.getElementById('over').classList.contains('hidden');
      const show = this.enabled && !menuOpen && !overOpen;
      this.layer.classList.toggle('hidden', !show);
      if (!show && (this.sticks.move || this.sticks.aim)) this.reset();
      if (show) {
        this.weaponBtns.forEach((b, i) => b.classList.toggle('sel', i === this.input.weaponSel));
        this.pauseBtn.classList.toggle('hidden', !!(g.net && g.net.active));
      }
      requestAnimationFrame(() => this.tick());
    }

    reset() {
      this.sticks.move = this.sticks.aim = null;
      this.t.move = 0; this.t.jump = false; this.t.fire = false;
      this.moveBase.classList.remove('on');
      this.aimBase.classList.remove('on');
    }

    down(e) {
      e.preventDefault();
      const which = e.clientX < window.innerWidth / 2 ? 'move' : 'aim';
      if (this.sticks[which]) return;
      this.layer.setPointerCapture(e.pointerId);
      this.sticks[which] = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this.t.active = true;
      const base = which === 'move' ? this.moveBase : this.aimBase;
      base.style.left = e.clientX + 'px';
      base.style.top = e.clientY + 'px';
      base.classList.add('on');
      this.update(which, e);
    }

    move(e) {
      for (const which of ['move', 'aim']) {
        const s = this.sticks[which];
        if (s && s.id === e.pointerId) { e.preventDefault(); this.update(which, e); }
      }
    }

    up(e) {
      for (const which of ['move', 'aim']) {
        const s = this.sticks[which];
        if (!s || s.id !== e.pointerId) continue;
        this.sticks[which] = null;
        if (which === 'move') { this.t.move = 0; this.t.jump = false; this.moveBase.classList.remove('on'); }
        else { this.t.fire = false; this.aimBase.classList.remove('on'); }
      }
    }

    update(which, e) {
      const s = this.sticks[which];
      let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
      const base = which === 'move' ? this.moveBase : this.aimBase;
      base.firstElementChild.style.transform = `translate(${dx}px, ${dy}px)`;
      if (which === 'move') {
        this.t.move = dx > MOVE_DEAD ? 1 : dx < -MOVE_DEAD ? -1 : 0;
        this.t.jump = dy < -JUMP_DY;
      } else {
        if (d > 6) this.t.angle = Math.atan2(dy, dx);
        this.t.fire = d > FIRE_DEAD;
      }
    }
  }

  function goFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req || document.fullscreenElement || document.webkitFullscreenElement) return;
    try {
      const p = req.call(el, { navigationUI: 'hide' });
      if (p && p.then) {
        p.then(() => {
          if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        }).catch(() => {});
      }
    } catch (err) { /* not allowed here (e.g. iPhone Safari) */ }
  }

  SW.TouchControls = TouchControls;
})();
