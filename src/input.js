// Keyboard + mouse input for the human player.
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
      canvas.addEventListener('mousemove', (e) => { pos(e); this.mouse.inside = true; });
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
      return {
        move: (right ? 1 : 0) - (left ? 1 : 0),
        jump: k.has('KeyW') || k.has('Space') || k.has('ArrowUp'),
        fire: this.mouse.down,
        aim: Math.atan2(this.mouse.y - (c.y + 5), this.mouse.x - (c.x + c.w / 2)),
        weapon: this.weaponSel,
      };
    }
  }

  SW.Input = Input;
})();
