// Sand War online server.
//
// Runs the same simulation as the browser (src/*.js) authoritatively, one
// Match per room. Clients send inputs; the server streams snapshots back.
// It also serves the game page, so `npm start` + http://localhost:8080 is a
// complete local setup.
//
//   PORT=8080 FILL_BOTS=1 WINS_TO_WIN=3 node server/index.js
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

const { Room } = require('./room');

// Server settings (environment variables).
const PORT = +process.env.PORT || 8080;
const FILL_BOTS = /^(1|true|yes|on)$/i.test(process.env.FILL_BOTS || '');  // "fill room with bots"
const WINS_TO_WIN = Math.max(1, +process.env.WINS_TO_WIN || 3);
const MAX_IN_ROOM = 8;             // 4 fighters, the rest watch
const STEP_MS = 1000 / 60;
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

// Deliver to a client's socket. Droppable messages (snapshots) are skipped
// when the socket is backed up; returns whether the message was sent.
function deliver(client, data, droppable) {
  const ws = client.ws;
  if (ws.readyState !== 1) return false;
  if (droppable && ws.bufferedAmount > 1 << 20) return false;
  ws.send(data);
  return true;
}

function makeRoom() {
  const r = new Room(newCode(), { fillBots: FILL_BOTS, winsToWin: WINS_TO_WIN, send: deliver });
  rooms.set(r.code, r);
  return r;
}

function leaveRoom(client) {
  const r = client.room;
  if (!r) return;
  r.removeClient(client);
  if (!r.clients.length) rooms.delete(r.code);
}

// ------------------------------------------------------------- websocket --

const wss = new WebSocketServer({ server, perMessageDeflate: { threshold: 256 }, maxPayload: 4096 });

function sendJson(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function cleanName(s) {
  const n = String(s || '').replace(/[^\w \-]/g, '').trim().slice(0, 10);
  return n || 'Player';
}

wss.on('connection', (ws) => {
  const client = { id: nextClientId++, ws, name: 'Player', room: null, charId: -1, lastGrid: null, waiting: false };

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    switch (msg.t) {
      case 'create': {
        leaveRoom(client);
        client.name = cleanName(msg.name);
        makeRoom().addClient(client);
        break;
      }
      case 'join': {
        const code = String(msg.room || '').toUpperCase().slice(0, 4);
        const r = rooms.get(code);
        if (!r) { sendJson(ws, { t: 'error', msg: `No room called ${code}` }); break; }
        if (r === client.room) break;
        if (r.clients.length >= MAX_IN_ROOM) { sendJson(ws, { t: 'error', msg: 'That room is full' }); break; }
        leaveRoom(client);
        client.name = cleanName(msg.name);
        r.addClient(client);
        break;
      }
      case 'input': {
        if (!client.room) break;
        const aim = Number(msg.a);
        client.room.setInput(client, {
          move: Math.max(-1, Math.min(1, Math.round(Number(msg.m) || 0))),
          jump: !!msg.j,
          fire: !!msg.f,
          aim: Number.isFinite(aim) ? aim : 0,
          weapon: Math.max(0, Math.min(SW.WEAPONS.length - 1, msg.w | 0)),
        });
        break;
      }
      case 'leave': {
        leaveRoom(client);
        break;
      }
    }
  });

  ws.on('close', () => leaveRoom(client));
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
  console.log(`Settings: fill room with bots ${FILL_BOTS ? 'ON' : 'off'}, first to ${WINS_TO_WIN} wins`);
});

module.exports = { server, rooms };
