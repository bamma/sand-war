// Arena layouts. Shared by the browser (single player) and the server (online).
//
// Each map: { id, name, build(g, u), spawns }.
//  - build() draws stone (WALL), sand, mud and water into the grid using the
//    helpers in `u`. The outer frame and ceiling are always added first.
//  - spawns: up to 4 spawn points {x, y} (top-left of a 6x12 fighter) in
//    preference order; a match with N fighters uses the first N, so the first
//    two should be far apart. Fighters drop from there onto whatever is below.
(function () {
  'use strict';
  const SW = globalThis.SW;
  const { EMPTY, WALL, SAND, MUD, WATER } = SW.T;
  const GW = 320, GH = 180, FLOOR = GH - 3;

  function helpers(g) {
    const set = (x, y, t) => { if (x >= 2 && x < GW - 2 && y >= 2 && y < FLOOR) g.setCell(x, y, t); };
    return {
      walls() {
        for (let y = 0; y < GH; y++) {
          for (let x = 0; x < GW; x++) {
            if (x < 2 || x >= GW - 2 || y < 2 || y >= FLOOR) g.setCell(x, y, WALL);
          }
        }
      },
      // Fill [x0,x1) x [y0,y1) with a cell type (default stone).
      rect(x0, y0, x1, y1, t = WALL) {
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, t);
      },
      // Rolling sand floor `base` cells deep, varying by about `amp`.
      dunes(base, amp, x0 = 2, x1 = GW - 2) {
        const p1 = Math.random() * 6, p2 = Math.random() * 6;
        for (let x = x0; x < x1; x++) {
          const h = Math.round(base + amp * Math.sin(x * 0.03 + p1) + amp * 0.5 * Math.sin(x * 0.085 + p2));
          for (let y = FLOOR - h; y < FLOOR; y++) if (g.get(x, y) === EMPTY) set(x, y, SAND);
        }
      },
      // A 2-cell-thick stone line going diagonally down from (x, y), `len`
      // cells long, towards dir = +1 (right) or -1 (left). Thick enough that
      // sand slides along it instead of leaking through.
      slope(x, y, len, dir) {
        for (let k = 0; k < len; k++) { set(x + k * dir, y + k, WALL); set(x + k * dir, y + k + 1, WALL); }
      },
      // Make cells of `type` inside a rect last much longer (pool water, mud).
      longLife(x0, y0, x1, y1, type, life) {
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = g.idx(x, y);
          if (g.type[i] === type) g.life[i] = life;
        }
      },
    };
  }

  const MAPS = [
    {
      id: 'classic', name: 'Dunes',
      build(g, u) {
        u.dunes(16, 6);
        u.rect(22, 112, 66, 116);
        u.rect(GW - 66, 112, GW - 22, 116);
        u.rect(152, 128, 168, FLOOR);
        u.rect(120, 86, 200, 89);
      },
      // Same spots as before maps existed: the player starts on the sand floor, not the ledge.
      spawns: [{ x: 90, y: 30 }, { x: 270, y: 30 }, { x: 190, y: 30 }, { x: 40, y: 30 }],
    },
    {
      id: 'open', name: 'Open Desert',
      build(g, u) { u.dunes(18, 9); },
      spawns: [{ x: 40, y: 30 }, { x: 280, y: 30 }, { x: 120, y: 30 }, { x: 200, y: 30 }],
    },
    {
      id: 'ledges', name: 'Three Ledges',
      build(g, u) {
        u.dunes(14, 5);
        u.rect(26, 120, 96, 124);
        u.rect(125, 95, 195, 99);
        u.rect(224, 120, 294, 124);
      },
      spawns: [{ x: 50, y: 100 }, { x: 264, y: 100 }, { x: 157, y: 70 }, { x: 110, y: 30 }],
    },
    {
      id: 'canyon', name: 'Canyon',
      build(g, u) {
        u.rect(2, 105, 95, FLOOR);                // left cliff
        u.rect(225, 105, GW - 2, FLOOR);          // right cliff
        u.rect(2, 99, 95, 105, SAND);             // sand on the cliff tops
        u.rect(225, 99, GW - 2, 105, SAND);
        u.dunes(18, 4, 95, 225);                  // the pit floor, ~60 rows down
      },
      spawns: [{ x: 20, y: 80 }, { x: 292, y: 80 }, { x: 62, y: 80 }, { x: 250, y: 80 }],
    },
    {
      id: 'oasis', name: 'Oasis',
      build(g, u) {
        u.dunes(18, 5);
        // Raised stone basin full of water in the middle.
        u.rect(124, 136, 196, 170);
        u.rect(128, 136, 192, 166, EMPTY);
        u.rect(128, 144, 192, 166, WATER);
        u.longLife(128, 144, 192, 166, WATER, 60000);   // ~16 min: it won't dry up
        // A ring of mud around it that lasts about 100 s.
        for (let x = 96; x < 224; x++) {
          if (x >= 124 && x < 196) continue;
          let depth = 0;
          for (let y = 2; y < FLOOR && depth < 7; y++) {
            const t = g.get(x, y);
            if (t === SAND) { g.wet(g.idx(x, y)); g.life[g.idx(x, y)] = 6000; depth++; } else if (depth || t === WALL) break;
          }
        }
      },
      spawns: [{ x: 30, y: 30 }, { x: 284, y: 30 }, { x: 90, y: 30 }, { x: 224, y: 30 }],
    },
    {
      id: 'towers', name: 'Twin Towers',
      build(g, u) {
        u.dunes(10, 3);
        u.rect(70, 100, 90, FLOOR);               // towers
        u.rect(230, 100, 250, FLOOR);
        u.rect(52, 138, 70, 141);                 // halfway ledges on the outer sides
        u.rect(250, 138, 268, 141);
      },
      spawns: [{ x: 77, y: 80 }, { x: 237, y: 80 }, { x: 20, y: 30 }, { x: 294, y: 30 }],
    },
    {
      id: 'hourglass', name: 'Hourglass',
      build(g, u) {
        u.dunes(14, 5);
        // Two V-shaped funnels with a 3-cell hole at the bottom.
        for (const cx of [95, 225]) {
          u.slope(cx - 36, 38, 35, 1);
          u.slope(cx + 36, 38, 35, -1);
        }
      },
      spawns: [{ x: 30, y: 85 }, { x: 286, y: 85 }, { x: 157, y: 85 }, { x: 120, y: 85 }],
    },
  ];

  const byId = new Map(MAPS.map((m) => [m.id, m]));

  SW.MAPS = MAPS;
  SW.MAP_IDS = MAPS.map((m) => m.id);
  SW.mapById = (id) => byId.get(id) || byId.get('classic');
  SW.randomMapId = () => MAPS[(Math.random() * MAPS.length) | 0].id;

  // Draw a map into a fresh grid and let the sand settle.
  SW.buildMap = function (g, map) {
    const u = helpers(g);
    u.walls();
    map.build(g, u);
    for (let k = 0; k < 40; k++) g.update();
  };
})();
