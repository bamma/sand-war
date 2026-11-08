// Sand War online server.
//
// Runs the same simulation as the browser (src/*.js) authoritatively, one
// Match per room. Clients send inputs; the server streams snapshots back.
// It also serves the game page, so `npm start` + http://localhost:8080 is a
// complete local setup.
//
//   PORT=8080 node server/index.js
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const ROOT = path.resolve(__dirname, '..');
for (const f of ['grid', 'particles', 'elements', 'character', 'bot', 'match', 'protocol']) {
  require(path.join(ROOT, 'src', f + '.js'));
}
const SW = globalThis.SW;

const PORT = +process.env.PORT || 8080;
const STEP_MS = 1000 / 60;
const SNAP_EVERY = 2;            // send a snapshot every 2 sim steps (30 Hz)
const MAX_HUMANS = SW.MAX_FIGHTERS;
const OVER_LINGER = 6 * 60;      // keep simulating this long after a match ends
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ';

// ------------------------------------------------------------------ http --

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.md': 'text/plain' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  const file = path.resolve(ROOT, '.' + url);
  const ext = path.extname(file);
  const allowed = file.startsWith(ROOT + path.sep) && TYPES[ext] && !file.includes(`${path.sep}server${path.sep}`)
    && !file.includes(`${path.sep}node_modules${path.sep}`) && !file.includes(`${path.sep}.git`);
  if (!allowed) { res.writeHead(404); res.end('not found'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[ext], 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ----------------------------------------------------------------- rooms --

const rooms = new Map();
let nextClientId = 1;

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    if (!rooms.has(c)) return c;
  }
}

class Room {
  constructor(code) {
    this.code = code;
    this.clients = [];          // join order; clients[0] is host
    this.bots = 1;
    this.match = null;
    this.inputs = new Map();    // character id -> latest input
    this.steps = 0;
  }

  get host() { return this.clients[0] || null; }

  lobby() {
    return {
      t: 'lobby', room: this.code, bots: this.bots, inMatch: !!this.match && !this.match.over,
      players: this.clients.map((c) => ({ id: c.id, name: c.name, host: c === this.host })),
    };
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const c of this.clients) send(c.ws, s);
  }

  start(bots) {
    const humans = this.clients.slice(0, MAX_HUMANS);
    this.bots = Math.max(0, Math.min(SW.MAX_FIGHTERS - humans.length, bots | 0));
    this.match = new SW.Match({ humans: humans.map((c) => ({ name: c.name })), bots: this.bots });
    this.inputs.clear();
    this.steps = 0;
    for (const c of this.clients) {
      const k = humans.indexOf(c);
      c.charId = k >= 0 ? k : -1;  // -1 = spectator (joined while full)
      c.lastGrid = null;           // next snapshot carries the full grid
      send(c.ws, JSON.stringify({ t: 'start', you: c.charId }));
    }
    this.broadcast(this.lobby());
  }

  step() {
    const m = this.match;
    if (!m) return;
    if (m.over && m.frame - m.overAt > OVER_LINGER) return;
    m.step((c) => this.inputs.get(c.id) || { move: 0, jump: false, fire: false, aim: c.aim, weapon: c.weapon });
    if (++this.steps % SNAP_EVERY === 0) this.snapshot();
  }

  snapshot() {
    const g = this.match.grid;
    const cur = { a: new Uint8Array(g.type.length), b: new Uint8Array(g.type.length) };
    SW.Proto.packGrid(g, cur.a, cur.b);
    for (const c of this.clients) {
      if (c.ws.readyState !== 1) continue;
      // Skip clients whose socket is backed up rather than queueing forever.
      if (c.ws.bufferedAmount > 1 << 20) continue;
      const { buf } = SW.Proto.encodeSnapshot(this.match, c.charId, cur, c.lastGrid);
      c.ws.send(buf);
      c.lastGrid = cur;
    }
  }

  remove(client) {
    const i = this.clients.indexOf(client);
    if (i < 0) return;
    this.clients.splice(i, 1);
    const m = this.match;
    if (m && client.charId >= 0) {
      const ch = m.chars[client.charId];
      if (ch && ch.alive) { ch.alive = false; m.toast(`${ch.name} left the match`); }
    }
    if (!this.clients.length) { rooms.delete(this.code); return; }
    this.broadcast(this.lobby());
  }
}

// ------------------------------------------------------------- websocket --

const wss = new WebSocketServer({ server, perMessageDeflate: { threshold: 256 }, maxPayload: 4096 });

function send(ws, data) { if (ws.readyState === 1) ws.send(data); }

function cleanName(s) {
  const n = String(s || '').replace(/[^\w \-]/g, '').trim().slice(0, 10);
  return n || 'Player';
}

wss.on('connection', (ws) => {
  const client = { id: nextClientId++, ws, name: 'Player', room: null, charId: -1, lastGrid: null };

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    const room = client.room;
    switch (msg.t) {
      case 'create': {
        if (room) room.remove(client);
        client.name = cleanName(msg.name);
        const r = new Room(newCode());
        rooms.set(r.code, r);
        r.clients.push(client);
        client.room = r;
        send(ws, JSON.stringify({ t: 'joined', room: r.code, you: client.id }));
        r.broadcast(r.lobby());
        break;
      }
      case 'join': {
        const code = String(msg.room || '').toUpperCase().slice(0, 4);
        const r = rooms.get(code);
        if (!r) { send(ws, JSON.stringify({ t: 'error', msg: `No room called ${code}` })); break; }
        if (r.clients.length >= 8) { send(ws, JSON.stringify({ t: 'error', msg: 'That room is full' })); break; }
        if (room) room.remove(client);
        client.name = cleanName(msg.name);
        r.clients.push(client);
        client.room = r;
        client.charId = -1;
        client.lastGrid = null;
        send(ws, JSON.stringify({ t: 'joined', room: r.code, you: client.id }));
        r.broadcast(r.lobby());
        break;
      }
      case 'start': {
        if (!room || room.host !== client) break;
        if (room.match && !room.match.over) break;
        room.start(msg.bots);
        break;
      }
      case 'input': {
        if (!room || !room.match || client.charId < 0) break;
        const aim = Number(msg.a);
        room.inputs.set(client.charId, {
          move: Math.max(-1, Math.min(1, Math.round(Number(msg.m) || 0))),
          jump: !!msg.j,
          fire: !!msg.f,
          aim: Number.isFinite(aim) ? aim : 0,
          weapon: Math.max(0, Math.min(SW.WEAPONS.length - 1, msg.w | 0)),
        });
        break;
      }
      case 'leave': {
        if (room) room.remove(client);
        client.room = null;
        break;
      }
    }
  });

  ws.on('close', () => { if (client.room) client.room.remove(client); });
  ws.on('error', () => {});
});

// ------------------------------------------------------------- game loop --

let last = Date.now(), acc = 0;
setInterval(() => {
  const now = Date.now();
  acc += now - last;
  last = now;
  let n = 0;
  while (acc >= STEP_MS && n < 4) {
    for (const r of rooms.values()) r.step();
    acc -= STEP_MS;
    n++;
  }
  if (n === 4) acc = 0; // fell behind: drop time rather than spiral
}, 4);

server.listen(PORT, () => {
  console.log(`Sand War server on http://localhost:${PORT}  (WebSocket on the same port)`);
});

module.exports = { server, rooms };
