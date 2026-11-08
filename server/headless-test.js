// Headless checks for the shared simulation, run with `npm test` in server/.
//  1. A full bots-only match runs in Node (no browser) and ends.
//  2. Snapshots round-trip: a client that applies full + delta snapshots ends
//     up with exactly the server's grid.
'use strict';

const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
for (const f of ['grid', 'particles', 'elements', 'character', 'bot', 'maps', 'match', 'protocol']) {
  require(path.join(ROOT, 'src', f + '.js'));
}
const SW = globalThis.SW;

// 1. Bot match.
{
  const t0 = Date.now();
  const m = new SW.Match({ humans: [], bots: 3, demo: true });
  const idle = (c) => ({ move: 0, jump: false, fire: false, aim: c.aim });
  while (!m.over && m.frame < 60 * 60 * 5) m.step(idle);
  const ms = (Date.now() - t0) / m.frame;
  assert.ok(m.over, 'match should end');
  console.log(`bot match ended at ${(m.frame / 60).toFixed(1)}s game time; winner ${m.winner ? m.winner.name : 'none'}; ${ms.toFixed(2)} ms/step`);
}

// 2. Snapshot round trip (full, then deltas) with a human character.
{
  const m = new SW.Match({ humans: [{ name: 'Tester' }], bots: 2 });
  const n = m.grid.type.length;
  const view = {
    grid: new SW.Grid(SW.GW, SW.GH),
    particles: { n: 0, x: new Float32Array(65536), y: new Float32Array(65536), type: new Uint8Array(65536), shade: new Uint8Array(65536) },
  };
  let prev = null, bytesFull = 0, bytesDelta = 0, deltas = 0;
  const walk = (c) => ({ move: 1, jump: m.frame % 40 === 0, fire: m.frame % 30 === 0, aim: -0.6, weapon: 0 });
  for (let k = 0; k < 600; k++) {
    m.step(walk);
    if (k % 2) continue;  // snapshot every other step, like the server
    const cur = { a: new Uint8Array(n), b: new Uint8Array(n) };
    SW.Proto.packGrid(m.grid, cur.a, cur.b);
    const { buf, full } = SW.Proto.encodeSnapshot(m, 0, cur, prev);
    if (full) bytesFull = buf.byteLength; else { bytesDelta += buf.byteLength; deltas++; }
    const head = SW.Proto.decodeSnapshot(buf, view);
    assert.strictEqual(head.f, m.frame);
    prev = cur;
  }
  // Compare against the last state actually sent (the sim may have run on).
  for (let i = 0; i < n; i++) {
    assert.strictEqual(view.grid.type[i], prev.a[i] >> 4, `type mismatch at cell ${i}`);
    assert.strictEqual(view.grid.shade[i], prev.a[i] & 15, `shade mismatch at cell ${i}`);
  }
  console.log(`snapshot round trip OK: full ${(bytesFull / 1024).toFixed(1)} KB, average delta ${(bytesDelta / deltas / 1024).toFixed(1)} KB (before compression)`);
}

// 3. Every map: spawns are in open air, everyone lands, a bot match ends.
{
  const idle = (c) => ({ move: 0, jump: false, fire: false, aim: c.aim });
  for (const map of SW.MAPS) {
    const t0 = Date.now();
    const m = new SW.Match({ humans: [{ name: 'Idle' }], bots: 3, map: map.id });
    assert.strictEqual(m.mapId, map.id);
    assert.strictEqual(m.chars.length, 4);
    for (const c of m.chars) {
      for (let r = 0; r < c.h; r++) for (let k = 0; k < c.w; k++) {
        assert.strictEqual(m.grid.get(c.x + k, c.y + r), SW.T.EMPTY, `${map.id}: ${c.name} spawns inside terrain`);
      }
    }
    const touched = new Set();
    for (let f = 0; f < 180; f++) { m.step(idle); for (const c of m.chars) if (c.grounded) touched.add(c); }
    const fell = m.chars.filter((c) => !touched.has(c));
    assert.strictEqual(fell.length, 0, `${map.id}: ${fell.map((c) => c.name)} never landed in 3 s`);
    const landed = m.chars[0].x + ',' + m.chars[0].y;
    while (!m.over && m.frame < 60 * 60 * 6) m.step(idle);
    assert.ok(m.over, `${map.id}: match should end`);
    console.log(`map ${map.id.padEnd(9)} idle player landed at ${landed.padEnd(8)} match ended ${(m.frame / 60).toFixed(0).padStart(3)}s (${((Date.now() - t0) / 1000).toFixed(1)}s real)`);
  }
}

console.log('all headless checks passed');
