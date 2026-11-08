// Online snapshot format, shared by the server (encode) and client (decode).
//
// Binary message layout (little endian):
//   u8  kind = 1 (snapshot)
//   u32 header length, then UTF-8 JSON header: frame, characters, shots,
//       explosions, toasts, match result
//   u16 airborne grain count, then per grain: i16 x*8, i16 y*8, u8 type<<4|shade
//   u8  grid mode: 0 = full grid, 1 = changes since the last snapshot sent
//       full:  W*H bytes "a" (type<<4|shade), then W*H bytes "b" (mud dryness 0..7)
//       delta: u32 count, then per cell: u16 index, u8 a, u8 b
//
// WebSockets deliver messages reliably and in order, so a delta against the
// last grid we sent to that client is always safe to apply.
(function () {
  'use strict';
  const SW = globalThis.SW;
  const { MUD } = SW.T;
  const SNAPSHOT = 1;

  const r2 = (v) => Math.round(v * 100) / 100;

  // Pack a grid into the two wire arrays (a = type<<4|shade, b = mud dryness).
  function packGrid(g, a, b) {
    const FADE = SW.MUD_DRY_FADE, type = g.type, shade = g.shade, life = g.life;
    for (let i = 0, n = type.length; i < n; i++) {
      const t = type[i];
      a[i] = (t << 4) | shade[i];
      if (t === MUD) {
        const l = life[i];
        b[i] = l >= FADE ? 0 : Math.min(7, ((FADE - l) / FADE * 8) | 0);
      } else b[i] = 0;
    }
  }

  function header(match, youId) {
    return {
      f: match.frame,
      over: match.over,
      win: match.winner ? match.winner.id : null,
      you: youId,
      chars: match.chars.map((c) => ({
        id: c.id, n: c.name, c: c.color, bot: c.isBot ? 1 : 0,
        x: c.x, y: c.y, a: r2(c.aim), w: c.weapon, al: c.alive ? 1 : 0,
        g: c.grounded ? 1 : 0, vx: r2(c.vx), wp: r2(c.walkPhase),
        b: c.breath, bu: c.buried ? 1 : 0, s: c.stun,
        am: c.ammo.map((v) => Math.floor(v)),
      })),
      shots: match.shots.list.map((s) => ({ id: s.id, k: s.kind, x: r2(s.x), y: r2(s.y), sp: r2(s.spin) })),
      booms: match.shots.booms.map((b) => ({ x: r2(b.x), y: r2(b.y), t: b.t, l: b.life, r: b.r, k: b.kind })),
      toasts: match.toasts.map((t) => ({ text: t.text, life: t.life })),
    };
  }

  // Build one snapshot. `cur` is the freshly packed grid {a, b};
  // `prev` is what this client last received ({a, b}) or null for a full grid.
  function encodeSnapshot(match, youId, cur, prev) {
    const head = new TextEncoder().encode(JSON.stringify(header(match, youId)));
    const P = match.particles;
    let pn = 0;
    for (let i = 0; i < P.n; i++) if (P.type[i] !== SW.T.AIR) pn++;
    pn = Math.min(pn, 65535);
    const n = cur.a.length;

    let changed = null, count = 0;
    if (prev) {
      changed = new Uint32Array(n);
      const A = cur.a, B = cur.b, pa = prev.a, pb = prev.b;
      for (let i = 0; i < n; i++) if (A[i] !== pa[i] || B[i] !== pb[i]) changed[count++] = i;
      if (count * 4 > n * 2) changed = null; // too many changes: a full grid is smaller
    }
    const gridBytes = changed ? 4 + count * 4 : n * 2;
    const size = 1 + 4 + head.length + 2 + pn * 5 + 1 + gridBytes;
    const buf = new ArrayBuffer(size);
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let o = 0;
    dv.setUint8(o, SNAPSHOT); o += 1;
    dv.setUint32(o, head.length, true); o += 4;
    u8.set(head, o); o += head.length;
    dv.setUint16(o, pn, true); o += 2;
    for (let i = 0, k = 0; i < P.n && k < pn; i++) {
      const t = P.type[i];
      if (t === SW.T.AIR) continue;
      dv.setInt16(o, clamp16(P.x[i] * 8), true);
      dv.setInt16(o + 2, clamp16(P.y[i] * 8), true);
      dv.setUint8(o + 4, (t << 4) | P.shade[i]);
      o += 5; k++;
    }
    if (changed) {
      dv.setUint8(o, 1); o += 1;
      dv.setUint32(o, count, true); o += 4;
      for (let k = 0; k < count; k++) {
        const i = changed[k];
        dv.setUint16(o, i, true);
        dv.setUint8(o + 2, cur.a[i]);
        dv.setUint8(o + 3, cur.b[i]);
        o += 4;
      }
    } else {
      dv.setUint8(o, 0); o += 1;
      u8.set(cur.a, o); o += n;
      u8.set(cur.b, o); o += n;
    }
    return { buf, full: !changed, cells: changed ? count : n };
  }

  function clamp16(v) { return Math.max(-32768, Math.min(32767, Math.round(v))); }

  // Apply a snapshot to a client view: {grid, particles} are updated in place.
  // Returns the parsed header, or null if this isn't a snapshot.
  function decodeSnapshot(buf, view) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let o = 0;
    if (dv.getUint8(o) !== SNAPSHOT) return null;
    o += 1;
    const hl = dv.getUint32(o, true); o += 4;
    const head = JSON.parse(new TextDecoder().decode(u8.subarray(o, o + hl))); o += hl;
    const pn = dv.getUint16(o, true); o += 2;
    const P = view.particles;
    P.n = pn;
    for (let k = 0; k < pn; k++) {
      P.x[k] = dv.getInt16(o, true) / 8;
      P.y[k] = dv.getInt16(o + 2, true) / 8;
      const ts = dv.getUint8(o + 4);
      P.type[k] = ts >> 4;
      P.shade[k] = ts & 15;
      o += 5;
    }
    const g = view.grid;
    const mode = dv.getUint8(o); o += 1;
    if (mode === 0) {
      const n = g.type.length;
      for (let i = 0; i < n; i++) setCell(g, i, u8[o + i], u8[o + n + i]);
    } else {
      const count = dv.getUint32(o, true); o += 4;
      for (let k = 0; k < count; k++) {
        setCell(g, dv.getUint16(o, true), dv.getUint8(o + 2), dv.getUint8(o + 3));
        o += 4;
      }
    }
    return head;
  }

  function setCell(g, i, a, b) {
    const FADE = SW.MUD_DRY_FADE;
    g.type[i] = a >> 4;
    g.shade[i] = a & 15;
    // Rebuild a mud "life" value that renders with the same dryness.
    g.life[i] = b === 0 ? FADE + 100 : Math.round(FADE - (b + 0.5) * FADE / 8);
  }

  SW.Proto = { packGrid, encodeSnapshot, decodeSnapshot };
})();
