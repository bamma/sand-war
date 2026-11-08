// Headless test of the online series rules (server/room.js), no sockets.
// Rounds are ended quickly by burying chosen fighters (alive = false).
'use strict';

const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
for (const f of ['grid', 'particles', 'elements', 'character', 'bot', 'maps', 'match', 'protocol']) {
  require(path.join(ROOT, 'src', f + '.js'));
}
const SW = globalThis.SW;
const { Room } = require('./room');

let nextId = 1;
function client(name) {
  return { id: nextId++, name, inbox: [], charId: -1, lastGrid: null, waiting: false };
}
function send(c, data) { if (typeof data === 'string') c.inbox.push(JSON.parse(data)); return true; }
function lastOf(c, t) { for (let i = c.inbox.length - 1; i >= 0; i--) if (c.inbox[i].t === t) return c.inbox[i]; return null; }
function wins(room, c) { const s = room.scores.get('c' + c.id); return s ? s.wins : null; }

// Make `winner` (a character) the last one standing, then run until the next round starts.
function winRound(room, winner) {
  const m = room.match;
  for (const ch of m.chars) if (ch !== winner) ch.alive = false;
  room.step();                                  // match notices it's over
  assert.notStrictEqual(room.phase, 'round', 'round should have ended');
  const phase = room.phase;
  while (room.match === m) room.step();         // countdown, then next round or new series
  return phase;
}
const charOf = (room, c) => room.match.chars[c.charId];

for (const fillBots of [false, true]) {
  const room = new Room('TEST', { fillBots, winsToWin: 3, send });
  const a = client('Alice'), b = client('Bob'), c = client('Cara');

  // Alone: plays vs 3 bots immediately.
  room.addClient(a);
  assert.strictEqual(room.match.chars.length, 4, 'solo player gets 3 bots');
  assert.strictEqual(lastOf(a, 'start').you, 0);
  assert.strictEqual(lastOf(a, 'score').rows.length, 4, 'scoreboard: player + 3 bots');

  // Solo player racks up a win against the bots...
  winRound(room, charOf(room, a));
  assert.strictEqual(wins(room, a), 1);

  // ...then the first opponent joins: everything resets to zero.
  const roundBefore = room.round;
  room.addClient(b);
  assert.strictEqual(wins(room, a), 0, 'scores reset when the 2nd player joins');
  assert.strictEqual(room.round, 1, 'new series starts at round 1');
  assert.ok(room.round <= roundBefore);
  const humansOnly = room.match.chars.filter((ch) => !ch.isBot).length;
  assert.strictEqual(humansOnly, 2);
  assert.strictEqual(room.match.chars.length, fillBots ? 4 : 2, fillBots ? 'bots fill the room' : 'no bots with 2 humans');
  assert.strictEqual(lastOf(b, 'start').you, 1);

  // Alice wins a round: +1.
  winRound(room, charOf(room, a));
  assert.strictEqual(wins(room, a), 1);
  assert.strictEqual(wins(room, b), 0);

  // A third player joins mid-series: no reset, watches this round.
  room.addClient(c);
  assert.strictEqual(wins(room, a), 1, 'later joiners do not reset scores');
  assert.strictEqual(wins(room, c), 0);
  assert.strictEqual(lastOf(c, 'start').you, -1, 'late joiner spectates the current round');
  assert.ok(c.waiting);

  // Next round: Cara fights.
  winRound(room, charOf(room, b));
  assert.ok(c.charId >= 0, 'late joiner fights from the next round');
  assert.strictEqual(wins(room, b), 1);
  assert.strictEqual(room.match.chars.filter((ch) => !ch.isBot).length, 3);

  // A draw (everyone buried) scores nothing.
  for (const ch of room.match.chars) ch.alive = false;
  room.step();
  assert.strictEqual(room.phase, 'between');
  while (room.phase !== 'round') room.step();
  assert.deepStrictEqual([wins(room, a), wins(room, b), wins(room, c)], [1, 1, 0]);

  // Alice reaches 3 wins: champion, then a fresh series.
  winRound(room, charOf(room, a));
  const phase = winRound(room, charOf(room, a));
  assert.strictEqual(phase, 'champion');
  const champMsg = a.inbox.filter((m) => m.t === 'score' && m.phase === 'champion').pop();
  assert.strictEqual(champMsg.champion, 'Alice');
  assert.strictEqual(wins(room, a), 0, 'new series starts from 0');
  assert.strictEqual(room.round, 1);

  // Players leave until one is left: back to solo vs bots.
  winRound(room, charOf(room, b));
  room.removeClient(c);
  assert.strictEqual(wins(room, b), 1, 'a leave with 2+ players left does not reset');
  room.removeClient(b);
  assert.strictEqual(room.match.chars.length, 4, 'last player is back to playing bots');
  assert.strictEqual(wins(room, a), 0);

  console.log(`series rules OK (fill room with bots: ${fillBots ? 'on' : 'off'})`);
}
// Maps rotate every round, in order; MAPS limits the rotation; score carries the map name.
{
  const room = new Room('MAPS', { fillBots: false, winsToWin: 99, maps: ['canyon', 'oasis'], send });
  const a = client('Ann'), b = client('Ben');
  room.addClient(a);
  room.addClient(b);
  const seen = [];
  for (let k = 0; k < 4; k++) {
    seen.push(room.match.mapId);
    assert.strictEqual(lastOf(a, 'score').map, room.match.mapName);
    winRound(room, charOf(room, a));
  }
  assert.ok(seen.every((id) => id === 'canyon' || id === 'oasis'), 'only maps from the rotation');
  for (let k = 1; k < seen.length; k++) assert.notStrictEqual(seen[k], seen[k - 1], 'map changes every round');
  const all = new Room('ALL', { fillBots: false, winsToWin: 99, send });
  const c = client('Cy');
  all.addClient(c);
  const ids = new Set();
  for (let k = 0; k < SW.MAP_IDS.length; k++) { ids.add(all.match.mapId); winRound(all, charOf(all, c)); }
  assert.strictEqual(ids.size, SW.MAP_IDS.length, 'default rotation visits every map');
  console.log(`map rotation OK (${seen.join(' -> ')}; default rotation covers ${ids.size} maps)`);
}
console.log('all room checks passed');
