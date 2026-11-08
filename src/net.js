// Online play client. Loaded on demand from main.js when the player picks
// "Play online", so single player never depends on it or on the server.
//
// Server address: ?server=wss://host:port wins; otherwise, when the page is
// served over http(s) by the game server itself, the same host is used;
// otherwise SW.ONLINE_SERVER (set this once a server is deployed).
(function () {
  'use strict';
  const SW = window.SW;

  SW.ONLINE_SERVER = SW.ONLINE_SERVER || '';   // e.g. 'wss://sand-war.example.com'
  const CONNECT_TIMEOUT = 5000;
  const INPUT_MS = 33;
  const UNAVAILABLE = 'Online server unavailable. Play vs bots instead.';

  function serverUrl() {
    const q = new URLSearchParams(location.search).get('server');
    if (q) return q;
    const isHttp = location.protocol === 'http:' || location.protocol === 'https:';
    if (isHttp && !location.hostname.endsWith('github.io')) {
      return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    }
    return SW.ONLINE_SERVER || null;
  }

  const $ = (id) => document.getElementById(id);

  class NetClient {
    constructor(game) {
      this.game = game;
      this.ws = null;
      this.active = false;        // true while a match is being shown
      this.room = null;
      this.youClient = -1;
      this.youChar = -1;
      this.isHost = false;
      this.bots = 1;
      this.lastInput = '';
      this.lastInputAt = 0;
      this.overShown = false;
      this.view = makeView(game);
      this.prev = null;           // previous snapshot (for interpolation)
      this.cur = null;
      this.bindUi();
    }

    bindUi() {
      $('net-create').addEventListener('click', (e) => { e.target.blur(); this.create(); });
      $('net-join').addEventListener('click', (e) => { e.target.blur(); this.join($('net-code').value); });
      $('net-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.join($('net-code').value); });
      $('lobby-start').addEventListener('click', (e) => { e.target.blur(); this.send({ t: 'start', bots: this.bots }); });
      $('lobby-leave').addEventListener('click', (e) => { e.target.blur(); this.leave(); this.status(''); });
      document.querySelectorAll('[data-netbots]').forEach((b) => {
        b.addEventListener('click', () => {
          this.bots = +b.dataset.netbots;
          document.querySelectorAll('[data-netbots]').forEach((o) => o.classList.toggle('sel', o === b));
          b.blur();
        });
      });
    }

    status(text) { $('online-status').textContent = text; }

    openPanel(room) {
      $('online').classList.remove('hidden');
      try { $('net-name').value = localStorage.getItem('sandwar-name') || $('net-name').value; } catch (e) { /* storage blocked */ }
      if (!serverUrl()) { this.status('No online server is configured yet. Play vs bots instead.'); return; }
      if (room) { $('net-code').value = room.toUpperCase(); this.join(room); }
    }

    name() {
      const n = $('net-name').value.trim() || 'Player';
      try { localStorage.setItem('sandwar-name', n); } catch (e) { /* storage blocked */ }
      return n;
    }

    // Open the socket, or fail within CONNECT_TIMEOUT.
    connect() {
      if (this.ws && this.ws.readyState === 1) return Promise.resolve();
      const url = serverUrl();
      if (!url) return Promise.reject(new Error('no server'));
      this.status('Connecting...');
      return new Promise((resolve, reject) => {
        let done = false;
        let ws;
        try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
        ws.binaryType = 'arraybuffer';
        const timer = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch (e) { /* ignore */ } reject(new Error('timeout')); } }, CONNECT_TIMEOUT);
        ws.onopen = () => { if (done) return; done = true; clearTimeout(timer); this.ws = ws; this.status(''); resolve(); };
        ws.onerror = () => { if (done) return; done = true; clearTimeout(timer); reject(new Error('error')); };
        ws.onmessage = (ev) => this.onMessage(ev.data);
        ws.onclose = () => { if (this.ws === ws) this.onClosed(); };
      });
    }

    create() {
      this.connect().then(() => this.send({ t: 'create', name: this.name() }))
        .catch(() => this.status(UNAVAILABLE));
    }

    join(code) {
      code = String(code || '').trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) { this.status('Room codes are 4 letters.'); return; }
      this.connect().then(() => this.send({ t: 'join', room: code, name: this.name() }))
        .catch(() => this.status(UNAVAILABLE));
    }

    send(msg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); }

    leave() {
      const ws = this.ws;
      this.ws = null;
      if (ws) { try { ws.close(); } catch (e) { /* ignore */ } }
      this.reset();
    }

    reset() {
      this.active = false;
      this.room = null;
      this.prev = this.cur = null;
      $('lobby').classList.add('hidden');
      this.game.setOverButtons(true);
    }

    onClosed() {
      const wasPlaying = this.active;
      this.ws = null;
      this.reset();
      if (wasPlaying) this.game.showMenu();
      this.status(wasPlaying ? 'Disconnected from the server. Play vs bots instead.' : UNAVAILABLE);
    }

    onMessage(data) {
      if (typeof data !== 'string') { this.onSnapshot(data); return; }
      let msg;
      try { msg = JSON.parse(data); } catch (e) { return; }
      if (msg.t === 'joined') {
        this.room = msg.room;
        this.youClient = msg.you;
        $('lobby').classList.remove('hidden');
        $('lobby-code').textContent = msg.room;
        const link = location.href.split('?')[0] + '?room=' + msg.room
          + (new URLSearchParams(location.search).get('server') ? '&server=' + encodeURIComponent(serverUrl()) : '');
        $('lobby-link').textContent = link;
      } else if (msg.t === 'lobby') {
        this.isHost = msg.players.some((p) => p.host && p.id === this.youClient);
        $('lobby-players').innerHTML = '';
        for (const p of msg.players) {
          const li = document.createElement('li');
          li.textContent = p.name + (p.host ? ' (host)' : '') + (p.id === this.youClient ? ' - you' : '');
          $('lobby-players').appendChild(li);
        }
        $('lobby-host').classList.toggle('hidden', !this.isHost);
        $('lobby-wait').classList.toggle('hidden', this.isHost);
        if (this.active && this.view.state === 'over') this.updateOverButtons();
      } else if (msg.t === 'start') {
        this.youChar = msg.you;
        this.startMatch();
      } else if (msg.t === 'error') {
        this.status(msg.msg);
      }
    }

    startMatch() {
      const game = this.game;
      game.state = 'online';
      game.menuEl.classList.add('hidden');
      game.overEl.classList.add('hidden');
      this.view = makeView(game);
      this.prev = this.cur = null;
      this.overShown = false;
      this.active = true;
    }

    onSnapshot(buf) {
      if (!this.active) return;
      const head = SW.Proto.decodeSnapshot(buf, this.view);
      if (!head) return;
      head.at = performance.now();
      this.prev = this.cur;
      this.cur = head;
      const v = this.view;
      v.frame = head.f;
      v.toasts = head.toasts;
      v.state = head.over ? 'over' : 'playing';
      v.shots.booms = head.booms.map((b) => ({ x: b.x, y: b.y, t: b.t, life: b.l, r: b.r, kind: b.k }));
      if (head.over && !this.overShown) this.showOver(head);
    }

    showOver(head) {
      this.overShown = true;
      const game = this.game;
      const winner = head.chars.find((c) => c.id === head.win);
      game.overTitle.textContent = winner ? (winner.id === this.youChar ? 'Victory!' : `${winner.n} wins!`) : 'Everyone was buried!';
      game.overSub.textContent = winner && winner.id !== this.youChar && this.youChar >= 0
        ? 'You ran out of air under the sand.' : `Match lasted ${Math.round(head.f / 60)} seconds.`;
      this.updateOverButtons();
      setTimeout(() => { if (this.active && this.overShown) game.overEl.classList.remove('hidden'); }, 1000);
    }

    updateOverButtons() {
      this.game.setOverButtons(this.isHost, this.isHost ? 'Play again (R)' : 'Waiting for host');
    }

    rematch() { if (this.isHost) this.send({ t: 'start', bots: this.bots }); }

    onKey(code) {
      if (code === 'Escape') this.game.showMenu();
      else if (code === 'KeyR' && this.view.state === 'over') this.rematch();
    }

    // Called every animation frame while active: interpolate, then send input.
    frame(now) {
      const v = this.view, cur = this.cur, prev = this.prev;
      if (!cur) return;
      // Show the world one snapshot behind, blending towards the newest.
      const span = prev ? Math.max(16, cur.at - prev.at) : 33;
      const alpha = prev ? Math.min(1, (now - cur.at) / span) : 1;
      v.chars = cur.chars.map((c) => {
        const p = prev && prev.chars.find((o) => o.id === c.id);
        return toChar(c, p, alpha);
      });
      v.player = v.chars.find((c) => c.id === this.youChar) || null;
      v.shots.list = cur.shots.map((s) => {
        const p = prev && prev.shots.find((o) => o.id === s.id);
        return { kind: s.k, x: p ? lerp(p.x, s.x, alpha) : s.x, y: p ? lerp(p.y, s.y, alpha) : s.y, spin: s.sp };
      });

      if (v.player && v.player.alive && v.state === 'playing' && now - this.lastInputAt >= INPUT_MS) {
        const i = this.game.input.playerInput(v.player);
        const msg = JSON.stringify({ t: 'input', m: i.move, j: i.jump ? 1 : 0, f: i.fire ? 1 : 0, a: Math.round(i.aim * 1000) / 1000, w: i.weapon });
        // Re-send unchanged input occasionally so a lost update can't stick.
        if (msg !== this.lastInput || now - this.lastInputAt > 250) {
          this.send(JSON.parse(msg));
          this.lastInput = msg;
          this.lastInputAt = now;
        }
      }
    }
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function toChar(c, p, alpha) {
    return {
      id: c.id, name: c.n, color: c.c, isBot: !!c.bot,
      x: p ? lerp(p.x, c.x, alpha) : c.x, y: p ? lerp(p.y, c.y, alpha) : c.y,
      w: 6, h: 12, aim: c.a, weapon: c.w, alive: !!c.al, grounded: !!c.g,
      vx: c.vx, walkPhase: c.wp, breath: c.b, buried: !!c.bu, stun: c.s, ammo: c.am,
    };
  }

  // What the renderer draws in online mode (same shape as the local Game).
  function makeView(game) {
    const cap = 65536;
    return {
      online: true,
      grid: new SW.Grid(SW.GW, SW.GH),
      particles: { n: 0, x: new Float32Array(cap), y: new Float32Array(cap), type: new Uint8Array(cap), shade: new Uint8Array(cap) },
      shots: { list: [], booms: [] },
      chars: [],
      player: null,
      toasts: [],
      frame: 0,
      state: 'playing',
      input: game.input,
    };
  }

  SW.NetClient = NetClient;
})();
