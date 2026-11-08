// One online room: who's in it, the running round, and the series scoreboard.
//
// Flow (fully automatic, no start button):
//  - Creating a room starts a round right away against bots.
//  - When a second player joins a solo player, everything resets: new series,
//    all scores 0, new round. Later joiners don't reset anything; they watch
//    the current round and fight from the next one with 0 wins.
//  - First to `winsToWin` round wins takes the series; after a short pause a
//    new series starts from 0-0.
//  - Bots fill empty fighter slots when a player is alone, or always when the
//    server's "fill room with bots" setting is on.
//
// Transport-agnostic: the server passes send(client, data, droppable), which
// returns false if the message was not sent, so this can be tested headlessly.
'use strict';

const SW = globalThis.SW;
const FPS = 60;
const SNAP_EVERY = 2;              // snapshot every 2 sim steps (30 Hz)
const BETWEEN_ROUNDS = 4 * FPS;
const AFTER_CHAMPION = 8 * FPS;

const keyOf = (client) => 'c' + client.id;

class Room {
  constructor(code, opts) {
    this.code = code;
    this.fillBots = !!opts.fillBots;
    this.winsToWin = opts.winsToWin || 3;
    this.send = opts.send;
    this.clients = [];             // join order; clients[0] is host
    this.scores = new Map();       // key -> { name, wins, bot }
    this.match = null;
    this.fighterKeys = [];         // character id -> score key
    this.inputs = new Map();       // character id -> latest input
    this.phase = 'round';          // 'round' | 'between' | 'champion'
    this.countdown = 0;
    this.round = 0;
    this.champion = null;
    this.lastWinner = null;
    this.steps = 0;
  }

  get host() { return this.clients[0] || null; }

  // ------------------------------------------------------------ membership --

  addClient(client) {
    const before = this.clients.length;
    this.clients.push(client);
    client.room = this;
    client.charId = -1;
    client.lastGrid = null;
    this.sendTo(client, { t: 'joined', room: this.code, you: client.id });
    if (before <= 1) {
      // First player (solo vs bots), or the first opponent: start from zero.
      this.newSeries();
    } else {
      // Later joiners watch this round and fight from the next one.
      client.waiting = true;
      this.scores.set(keyOf(client), { name: client.name, wins: 0, bot: false });
      this.sendTo(client, { t: 'start', you: -1 });
      this.broadcastScores();
    }
    this.broadcastLobby();
  }

  removeClient(client) {
    const i = this.clients.indexOf(client);
    if (i < 0) return;
    this.clients.splice(i, 1);
    client.room = null;
    const m = this.match;
    if (m && client.charId >= 0) {
      const ch = m.chars[client.charId];
      if (ch && ch.alive) { ch.alive = false; m.toast(`${ch.name} left the match`); }
    }
    this.scores.delete(keyOf(client));
    if (!this.clients.length) return;
    if (this.clients.length === 1) this.newSeries();   // back to solo vs bots
    else this.broadcastScores();
    this.broadcastLobby();
  }

  // ---------------------------------------------------------------- series --

  newSeries() {
    this.scores.clear();
    this.champion = null;
    this.lastWinner = null;
    this.round = 0;
    this.startRound();
  }

  startRound() {
    for (const c of this.clients) c.waiting = false;
    const fighters = this.clients.slice(0, SW.MAX_FIGHTERS);
    const nBots = fighters.length === 1 || this.fillBots ? SW.MAX_FIGHTERS - fighters.length : 0;
    this.match = new SW.Match({ humans: fighters.map((c) => ({ name: c.name })), bots: nBots });
    this.round++;
    this.phase = 'round';
    this.countdown = 0;
    this.lastWinner = null;
    this.inputs.clear();
    this.steps = 0;

    this.fighterKeys = this.match.chars.map((ch) => (ch.isBot ? 'b' + ch.name : keyOf(fighters[ch.id])));
    this.match.chars.forEach((ch, k) => {
      const key = this.fighterKeys[k];
      if (!this.scores.has(key)) this.scores.set(key, { name: ch.name, wins: 0, bot: ch.isBot });
    });
    // Bots that are no longer in the round drop off the scoreboard.
    for (const key of [...this.scores.keys()]) {
      if (key[0] === 'b' && !this.fighterKeys.includes(key)) this.scores.delete(key);
    }

    for (const c of this.clients) {
      c.charId = fighters.indexOf(c);
      c.lastGrid = null;             // next snapshot carries the full grid
      this.sendTo(c, { t: 'start', you: c.charId });
    }
    this.broadcastScores();
  }

  onRoundEnd() {
    const w = this.match.winner;
    let champion = null;
    if (w) {
      const s = this.scores.get(this.fighterKeys[w.id]);
      if (s) {
        s.wins++;
        if (s.wins >= this.winsToWin) champion = s.name;
      }
      this.lastWinner = w.name;
    }
    if (champion) {
      this.champion = champion;
      this.phase = 'champion';
      this.countdown = AFTER_CHAMPION;
    } else {
      this.phase = 'between';
      this.countdown = BETWEEN_ROUNDS;
    }
    this.broadcastScores();
  }

  // ----------------------------------------------------------------- ticks --

  step() {
    const m = this.match;
    if (!m) return;
    m.step((c) => this.inputs.get(c.id) || { move: 0, jump: false, fire: false, aim: c.aim, weapon: c.weapon });
    if (this.phase === 'round') {
      if (m.over) this.onRoundEnd();
    } else if (--this.countdown <= 0) {
      if (this.phase === 'champion') this.newSeries(); else this.startRound();
      return;
    } else if (this.countdown % FPS === 0) {
      this.broadcastScores();
    }
    if (++this.steps % SNAP_EVERY === 0) this.snapshot();
  }

  setInput(client, inp) {
    if (client.charId >= 0 && this.match) this.inputs.set(client.charId, inp);
  }

  snapshot() {
    const g = this.match.grid;
    const cur = { a: new Uint8Array(g.type.length), b: new Uint8Array(g.type.length) };
    SW.Proto.packGrid(g, cur.a, cur.b);
    for (const c of this.clients) {
      const { buf } = SW.Proto.encodeSnapshot(this.match, c.charId, cur, c.lastGrid);
      if (this.send(c, buf, true)) c.lastGrid = cur;
    }
  }

  // ------------------------------------------------------------- messages --

  sendTo(client, msg) { this.send(client, JSON.stringify(msg), false); }

  scoreboard(forClient) {
    const colorOf = new Map(this.fighterKeys.map((k, i) => [k, this.match.chars[i].color]));
    const rows = [...this.scores.entries()].map(([key, s]) => ({
      key, name: s.name, wins: s.wins, bot: s.bot,
      you: forClient ? key === keyOf(forClient) : false,
      color: colorOf.get(key) || '#888888',
      waiting: !colorOf.has(key),
    }));
    rows.sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
    return {
      t: 'score', target: this.winsToWin, round: this.round, phase: this.phase,
      countdown: Math.ceil(this.countdown / FPS), champion: this.champion,
      winner: this.lastWinner, rows,
    };
  }

  broadcastScores() { for (const c of this.clients) this.sendTo(c, this.scoreboard(c)); }

  broadcastLobby() {
    const msg = {
      t: 'lobby', room: this.code,
      players: this.clients.map((c) => ({ id: c.id, name: c.name, host: c === this.host })),
    };
    for (const c of this.clients) this.sendTo(c, msg);
  }
}

module.exports = { Room };
