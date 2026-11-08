// Keyboard + mouse input for the human player (touch is merged in from src/touch.js).
(function () {
  'use strict';
  const SW = window.SW;

  class Input {
    constructor(canvas, gw, gh) {
      this.canvas = canvas;
      this.gw = gw;
      this.gh = gh;
      this.keys = new Set();
      this.mouse = { x: gw * 0.75, y: gh * 0.5, down: false, inside: false };
      this.weaponSel = 0;
      // Written by SW.TouchControls. active = touch was the last aiming device.
      this.touch = { active: false, move: 0, jump: false, fire: false, angle: null };
      this.onKey = null; // hook for game-level keys (R, Esc, Enter)

      window.addEventListener('keydown', (e) => {
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
        this.keys.add(e.code);
        if (e.code === 'Digit1') this.weaponSel = 0;
        if (e.code === 'Digit2') this.weaponSel = 1;
        if (e.code === 'Digit3') this.weaponSel = 2;
        if (e.code === 'KeyQ') this.cycle(-1);
        if (e.code === 'KeyE') this.cycle(1);
        if (this.onKey) this.onKey(e.code);
      });
      window.addEventListener('keyup', (e) => this.keys.delete(e.code));
      window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });

      const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        this.mouse.x = ((e.clientX - r.left) / r.width) * gw;
        this.mouse.y = ((e.clientY - r.top) / r.height) * gh;
      };
      canvas.addEventListener('mousemove', (e) => { pos(e); this.mouse.inside = true; this.touch.active = false; });
      canvas.addEventListener('mouseleave', () => { this.mouse.inside = false; });
      canvas.addEventListener('mousedown', (e) => { pos(e); if (e.button === 0) this.mouse.down = true; });
      window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.cycle(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    }

    cycle(d) {
      const n = SW.WEAPONS.length;
      this.weaponSel = (this.weaponSel + d + n) % n;
    }

    playerInput(c) {
      const k = this.keys;
      const left = k.has('KeyA') || k.has('ArrowLeft');
      const right = k.has('KeyD') || k.has('ArrowRight');
      const t = this.touch;
      const cx = c.x + c.w / 2, cy = c.y + 5;
      let aim;
      if (t.active) {
        aim = t.angle === null ? c.aim : t.angle;
        // Park the crosshair a little way out along the aim so it still shows.
        this.mouse.x = cx + Math.cos(aim) * 24;
        this.mouse.y = cy + Math.sin(aim) * 24;
        this.mouse.inside = true;
      } else {
        aim = Math.atan2(this.mouse.y - cy, this.mouse.x - cx);
      }
      const move = (right ? 1 : 0) - (left ? 1 : 0) + t.move;
      return {
        move: Math.max(-1, Math.min(1, move)),
        jump: k.has('KeyW') || k.has('Space') || k.has('ArrowUp') || t.jump,
        fire: this.mouse.down || t.fire,
        aim,
        weapon: this.weaponSel,
      };
    }
  }

  SW.Input = Input;
})();
