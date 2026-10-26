'use strict';
/* ===== Pháo Đài Mây — destructible terrain (grid of 2px cells) ===== */

const M_AIR = 0, M_DIRT = 1, M_STONE = 2, M_WOOD = 3, M_MOUND = 4;
const TERR = {
  g: new Uint8Array(TW * TH),   // material
  sc: new Uint8Array(TW * TH),  // scorch level 0..3
  seed: 0, map: 'may', pal: null, canvas: null, ctx: null, img: null, decor: [], spawns: [[], []], islands: [], dirty: null, version: 0,
};

function noise1(seed) {
  const r = mulberry32(seed), v = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) v[i] = r();
  return (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return v[i & 1023] + (v[(i + 1) & 1023] - v[i & 1023]) * u; };
}

function solid(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  return TERR.g[((y / CELL) | 0) * TW + ((x / CELL) | 0)] !== M_AIR;
}
function matAt(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return M_AIR;
  return TERR.g[((y / CELL) | 0) * TW + ((x / CELL) | 0)];
}
function surfaceBelow(x, y) {
  for (let yy = Math.max(0, y); yy < H; yy += 2) if (solid(x, yy)) return yy;
  return H + 100;
}
function normalAt(x, y) {
  let nx = 0, ny = 0;
  for (let dy = -8; dy <= 8; dy += 4) for (let dx = -8; dx <= 8; dx += 4) if (solid(x + dx, y + dy)) { nx -= dx; ny -= dy; }
  const l = Math.hypot(nx, ny) || 1; return [nx / l, ny / l];
}

/* ---------- generation (left half, mirrored for fairness) ---------- */
function genTerrain(seed, perTeam, mapKey) {
  const key = MAPS[mapKey] ? mapKey : 'may', M = MAPS[key];
  TERR.map = key; TERR.seed = seed; TERR.g.fill(0); TERR.sc.fill(0); TERR.decor = []; TERR.bridge = null; TERR.totem = null; TERR.version++;
  TERR.gen = (TERR.gen || 0) + 1; // a new map: the 3D view rebuilds everything
  setPalette(M.pal);
  const R = mulberry32(seed);
  const N = { a: noise1(seed + 11), b: noise1(seed + 23), c: noise1(seed + 37), s: noise1(seed + 51), v: noise1(seed + 67) };
  LAYOUTS[M.layout](R, N);
  pickSpawns(perTeam);
  buildDecor(seed);
}
function setCellMirror(x, y, m, mirror) {
  const cx = (x / CELL) | 0, cy = (y / CELL) | 0; if (cx < 0 || cy < 0 || cx >= TW || cy >= TH) return;
  TERR.g[cy * TW + cx] = m; if (mirror) TERR.g[cy * TW + (TW - 1 - cx)] = m;
}
/* one column of land: dirt on top, stone deeper down and in veins */
function fillCol(wx, top, bottom, k, N, o) {
  const sd = o.stoneDepth ?? 46, veins = o.veins ?? 0.86;
  for (let wy = Math.max(0, top | 0); wy < Math.min(H - 2, bottom); wy += CELL) {
    const depth = wy - top;
    let m = depth > sd + N.s(wx / 40 + k * 13) * 70 ? M_STONE : M_DIRT;
    if (N.v((wx + wy * 0.7) / 34) > veins && depth > 20) m = M_STONE;
    setCellMirror(wx, wy, m, true);
  }
}
function paintIslands(isl, N, o = {}) {
  isl.forEach((s, k) => { s.k = k; });
  const ha = o.hill ?? 90, da = o.detail ?? 22, fq = o.freq ?? 170;
  for (let x = 0; x < TW / 2; x++) {
    const wx = x * CELL + 1;
    for (const s of isl) {
      const dx = (wx - s.cx) / s.half; if (dx <= -1 || dx >= 1) continue;
      const hill = (N.a(wx / fq + s.k * 7) - 0.5) * (s.small ? 20 : ha) + (N.b(wx / 55 + s.k * 3) - 0.5) * da;
      const d2 = dx * dx, top = s.top + hill + d2 * d2 * 70;
      const shape = 1 - d2;
      fillCol(wx, top, top + s.thick * shape * (0.55 + 0.45 * N.c(wx / 90 + s.k)) + 18 * shape, s.k, N, o);
    }
  }
}
function fillBox(x0, y0, x1, y1, m) { for (let x = Math.max(0, x0); x <= Math.min(W / 2 - 1, x1); x += CELL) for (let y = y0; y <= y1; y += CELL) setCellMirror(x, y, m, true); }
/* sagging wooden bridge between two surface points */
function bridge(x0, x1, sagMax = 26) {
  if (!(x1 - x0 > 60 && x1 - x0 < 560)) return false;
  const y0 = surfaceBelow(x0, 0), y1 = surfaceBelow(x1, 0);
  if (y0 >= H || y1 >= H) return false;
  for (let wx = x0; wx <= Math.min(x1, W / 2); wx += 2) {
    const t = (wx - x0) / (x1 - x0), wy = lerp(y0, y1, t) + 4 * t * (1 - t) * sagMax - 2;
    for (let dy = 0; dy < 8; dy += 2) setCellMirror(wx, wy + dy, M_WOOD, true);
  }
  TERR.bridge = { x0, x1, y0, y1 };
  return true;
}
const LAYOUTS = {
  /* Thổ Thần Giao Tranh: two red-clay plateaus per side and a centre mesa carrying the 12-tier totem */
  tribe(R, N) {
    const isl = [
      { cx: 330 + R() * 40, half: 250, top: 730 + R() * 40, thick: 270 },
      { cx: 800 + R() * 30, half: 175 + R() * 20, top: 650 + R() * 50, thick: 220 },
      { cx: W / 2, half: 150, top: 700 + R() * 30, thick: 230, center: true, noBig: true },
    ];
    TERR.islands = isl; paintIslands(isl, N, { hill: 56, detail: 12, freq: 210, stoneDepth: 60, veins: 0.88 });
    // the totem: 12 painted tiers (one per year of Gamota), wider and narrower in turn, wings near the top
    const base = surfaceBelow(W / 2 - 3, 0);
    if (base < H) {
      const tierH = 17, tiers = 12, top = base + 6 - tiers * tierH;
      for (let k = 0; k < tiers; k++) {
        const y0 = top + k * tierH, hw = k % 2 ? 21 : 26;
        fillBox(W / 2 - hw, y0, W / 2 - 1, y0 + tierH - 1, M_WOOD);
      }
      for (let dy = 0; dy < 14; dy += 2) fillBox(W / 2 - 26 - 46 + dy * 3, top + tierH + dy, W / 2 - 26, top + tierH + dy, M_WOOD);
      TERR.totem = { top, tierH, tiers };
    }
  },
  /* Đảo Mây: two big islands, a centre island, small floating rocks */
  islands(R, N) {
    const isl = [
      { cx: 290 + R() * 70, half: 210 + R() * 60, top: 660 + R() * 110, thick: 230 + R() * 60 },
      { cx: 790 + R() * 70, half: 200 + R() * 50, top: 560 + R() * 150, thick: 210 + R() * 60 },
    ];
    if (R() < 0.8) isl.push({ cx: 1200, half: 150 + R() * 80, top: 500 + R() * 190, thick: 170 + R() * 50, center: true });
    const smalls = 1 + (R() < 0.5 ? 1 : 0);
    for (let k = 0; k < smalls; k++) isl.push({ cx: 480 + R() * 560, half: 55 + R() * 30, top: 300 + R() * 170, thick: 50 + R() * 25, small: true });
    TERR.islands = isl; paintIslands(isl, N);
    const C = isl.find((s) => s.center);
    if (C) bridge(isl[1].cx + isl[1].half * 0.8, C.cx - C.half * 0.75);
  },
  /* Băng Nguyên: flatter ice shelves, more floating chunks, icicles underneath */
  glacier(R, N) {
    const isl = [
      { cx: 300 + R() * 60, half: 220 + R() * 50, top: 700 + R() * 80, thick: 210 + R() * 40 },
      { cx: 790 + R() * 60, half: 185 + R() * 40, top: 590 + R() * 130, thick: 190 + R() * 40 },
    ];
    if (R() < 0.75) isl.push({ cx: 1200, half: 140 + R() * 60, top: 560 + R() * 140, thick: 150 + R() * 30, center: true });
    const smalls = 2 + (R() < 0.5 ? 1 : 0);
    for (let k = 0; k < smalls; k++) isl.push({ cx: 440 + R() * 660, half: 45 + R() * 30, top: 300 + R() * 230, thick: 45 + R() * 20, small: true });
    TERR.islands = isl; paintIslands(isl, N, { hill: 46, detail: 12, stoneDepth: 26, veins: 0.78 });
    for (const s of isl) {
      const n = s.small ? 1 : 3 + Math.floor(R() * 4);
      for (let k = 0; k < n; k++) {
        const x = s.cx + (R() - 0.5) * s.half * 1.3; let y = surfaceBelow(x, 0); if (y >= H) continue;
        while (y < H && solid(x, y)) y += 2;
        const len = (s.small ? 25 : 35) + R() * 70, w0 = 6 + R() * 9;
        for (let dy = -6; dy < len; dy += 2) { const w = w0 * (1 - Math.max(0, dy) / len); fillBox(x - w, y + dy, x + w, y + dy, M_STONE); }
      }
    }
  },
  /* Sa Mạc: one long dune per side, a low oasis island in the middle, tall sandstone mesas */
  dunes(R, N) {
    const isl = [{ cx: 560 + R() * 40, half: 470, top: 770 + R() * 40, thick: 290 }];
    if (R() < 0.85) isl.push({ cx: 1200, half: 120 + R() * 60, top: 800 + R() * 60, thick: 170, center: true });
    TERR.islands = isl; paintIslands(isl, N, { hill: 150, detail: 10, freq: 260, stoneDepth: 70, veins: 0.9 });
    const nm = 1 + (R() < 0.65 ? 1 : 0);
    for (let k = 0; k < nm; k++) {
      const mx = (nm === 1 ? 640 : 470 + k * 400) + (R() - 0.5) * 120, w = 64 + R() * 46, hgt = 140 + R() * 110;
      const base = surfaceBelow(mx, 0); if (base >= H) continue;
      const top = base - hgt;
      for (let wy = top; wy < base + 40; wy += 2) {
        const hw = w / 2 * (0.8 + 0.2 * (wy - top) / hgt) + (N.b(wy / 26 + k * 5) - 0.5) * 9;
        fillBox(mx - hw, wy, mx + hw, wy, M_STONE);
      }
    }
  },
  /* Núi Lửa: two plateaus per side and a tall crater cone in the middle rising from the lava */
  volcano(R, N) {
    const isl = [
      { cx: 300 + R() * 40, half: 240, top: 730 + R() * 50, thick: 260 },
      { cx: 720 + R() * 40, half: 165, top: 640 + R() * 90, thick: 200 },
    ];
    TERR.islands = isl; paintIslands(isl, N, { hill: 70, stoneDepth: 60, veins: 0.84 });
    const peak = 400 + R() * 90, half = 330 + R() * 40;
    for (let wx = W / 2 - half; wx < W / 2; wx += CELL) {
      const dx = (W / 2 - wx) / half;
      let top = peak + Math.pow(dx, 1.4) * (980 - peak);
      if (dx < 0.14) top += 80 * (1 - dx / 0.14);
      top += (N.b(wx / 40) - 0.5) * 18;
      fillCol(wx, top, H, 9, N, { stoneDepth: 80, veins: 0.84 });
    }
  },
  /* Phế Tích: three low islands, floating brick platforms higher up, broken columns, rope bridge */
  ruins(R, N) {
    const isl = [
      { cx: 320 + R() * 40, half: 230, top: 820 + R() * 40, thick: 220 },
      { cx: 820 + R() * 40, half: 160, top: 760 + R() * 60, thick: 200 },
      { cx: 1200, half: 110, top: 860 + R() * 30, thick: 150, center: true },
    ];
    TERR.islands = isl; paintIslands(isl, N, { hill: 40, detail: 10 });
    bridge(isl[0].cx + isl[0].half * 0.82, isl[1].cx - isl[1].half * 0.8, 34);
    const plats = [{ cx: 560 + R() * 60, half: 105 + R() * 30, y: 540 + R() * 70 }, { cx: 980 + R() * 60, half: 95 + R() * 20, y: 450 + R() * 70 }];
    if (R() < 0.7) plats.push({ cx: W / 2, half: 70 + R() * 30, y: 620 + R() * 50 });
    for (const p of plats) {
      fillBox(p.cx - p.half, p.y, p.cx + p.half, p.y + 24, M_STONE);
      for (let k = 0; k < 34; k += 2) { const hw = p.half * 0.7 * (1 - k / 34); fillBox(p.cx - hw, p.y + 24 + k, p.cx + hw, p.y + 24 + k, M_STONE); }
    }
    for (let k = 0; k < 2; k++) {
      const s = isl[k], x = s.cx + (R() - 0.5) * s.half, base = surfaceBelow(x, 0); if (base >= H) continue;
      const hgt = 60 + R() * 70;
      fillBox(x - 12, base - hgt, x + 12, base + 30, M_STONE);
      fillBox(x - 17, base - hgt - 8, x + 17, base - hgt, M_STONE);
    }
  },
};
/* spawns: evenly over the left side's thick ground, mirrored for the right team */
function pickSpawns(perTeam) {
  TERR.spawns = [[], []];
  const cand = [];
  for (let x = 110; x < 1120; x += 10) {
    let y = surfaceBelow(x, 0); if (y >= H - 120) continue;
    if (!solid(x, y + 90)) { y = surfaceBelow(x, y + 100); if (y >= H - 120 || !solid(x, y + 90)) continue; }
    let clear = true; for (let dy = 6; dy <= 70; dy += 4) if (solid(x, y - dy) || solid(x - 10, y - dy) || solid(x + 10, y - dy)) { clear = false; break; }
    // nothing right beside the body either (a column next to you would eat every shot)
    for (let dy = 24; dy <= 64 && clear; dy += 8) for (const dx of [-44, -28, 28, 44]) if (solid(x + dx, y - dy)) { clear = false; break; }
    if (!clear) continue;
    const yl = surfaceBelow(x - 14, y - 30), yr = surfaceBelow(x + 14, y - 30);
    if (Math.abs(yl - yr) > 16) continue;
    // "safe" = solid ground 160px behind (hits push you away from the enemy side) and 70px in front
    const safe = [-160, -110, -60, 70].every((dx) => { const yy = surfaceBelow(x + dx, y - 70); return yy < y + 70; });
    // "open" = a 40° shot towards the enemy side clears the first 180px
    let open = true; for (let d = 30; d <= 180; d += 10) if (solid(x + d * 0.766, y - 24 - d * 0.643)) { open = false; break; }
    cand.push({ x, y, safe, open });
  }
  const want = Math.max(1, perTeam);
  for (let k = 0; k < want && cand.length; k++) {
    const target = 300 + (k + 0.5) * (760 / want);
    let best = cand[0];
    const cost = (c) => Math.abs(c.x - target) + (c.safe ? 0 : 260) + (c.open ? 0 : 200);
    for (const c of cand) if (cost(c) < cost(best)) best = c;
    TERR.spawns[0].push({ x: best.x, y: best.y });
    TERR.spawns[1].push({ x: W - best.x, y: best.y });
  }
}
function buildDecor(seed) {
  const R = mulberry32(seed + 999), M = MAPS[TERR.map];
  const flowers = ['#ffffff', '#ffd6e8', '#fff2a8', '#ffc0cb', '#d8c8ff', '#ffb5a7'];
  const total = M.decor.reduce((a, d) => a + d[1], 0);
  for (let x = 6; x < W / 2; x += 6 + R() * 12) {
    const y = topSurfaceAt(x); if (y < 0) continue;
    if (matAt(x, y + 2) !== M_DIRT) continue;
    let r = R() * total, type = M.decor[0][0];
    for (const [t, w] of M.decor) { if (r < w) { type = t; break; } r -= w; }
    const d = { type, s: 0.7 + R() * 0.6, x, y, seed: R(), col: M.grassCol };
    if (type === 'flower') d.c = flowers[(R() * flowers.length) | 0];
    else if (type === 'shroom') d.c = R() < 0.5 ? '#ff6b6b' : '#ffa94d';
    else if (type === 'crystal') d.c = TERR.map === 'nui' ? '#ff7a3a' : '#a8e4ff';
    else if (type === 'tree') d.hue = R();
    if (type === 'tree' || type === 'pine' || type === 'saguaro' || type === 'deadtree') d.s = 0.85 + R() * 0.35;
    TERR.decor.push(d, { ...d, x: W - x, seed: d.seed + 0.5 });
  }
  // a few guaranteed big ones on the large islands
  TERR.islands.forEach((s, si) => {
    if (s.small || s.noBig) return;
    const n = s.center ? 1 : 2;
    for (let k = 0; k < n; k++) {
      const x = s.cx + (R() - 0.5) * s.half * 1.2; const y = topSurfaceAt(x); if (y < 0 || x > W / 2 || matAt(x, y + 2) !== M_DIRT) continue;
      // a list of big ones: the first goes once on the first island (the Thổ Thần gate), the rest everywhere else
      const type = !Array.isArray(M.big) ? M.big : si === 0 && k === 0 ? M.big[0] : M.big[1 + (k % (M.big.length - 1))];
      const d = { type, x, y, s: 0.95 + R() * 0.4, hue: R(), seed: R(), col: M.grassCol };
      TERR.decor.push(d, { ...d, x: W - x });
    }
  });
}
function topSurfaceAt(x) {
  for (let y = 0; y < H - 4; y += 2) if (solid(x, y)) return y;
  return -1;
}

/* ---------- destruction / building ---------- */
function markDirty(x0, y0, x1, y1) {
  const d = TERR.dirty;
  if (!d) TERR.dirty = [x0, y0, x1, y1];
  else { d[0] = Math.min(d[0], x0); d[1] = Math.min(d[1], y0); d[2] = Math.max(d[2], x1); d[3] = Math.max(d[3], y1); }
  TERR.version++;
  if (TERR.on3) TERR.on3(x0, y0, x1, y1);
}
function carve(x, y, r) {
  const g = TERR.g, sc = TERR.sc, R = r + 8;
  const c0 = Math.max(0, ((x - R) / CELL) | 0), c1 = Math.min(TW - 1, ((x + R) / CELL) | 0);
  const r0 = Math.max(0, ((y - R) / CELL) | 0), r1 = Math.min(TH - 1, ((y + R) / CELL) | 0);
  for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
    const i = cy * TW + cx; if (!g[i]) continue;
    const d = Math.hypot(cx * CELL + 1 - x, cy * CELL + 1 - y);
    if (d < r) { if (g[i] === M_STONE && d > r * 0.62) { sc[i] = Math.min(3, sc[i] + 2); continue; } g[i] = M_AIR; sc[i] = 0; }
    else if (d < R) sc[i] = Math.min(3, sc[i] + (d < r + 4 ? 2 : 1));
  }
  markDirty(c0, r0, c1, r1);
  pruneDecor(x - R - 10, y - R - 30, x + R + 10, y + R + 10);
}
function addMound(x, y, r) {
  const g = TERR.g;
  const c0 = Math.max(0, ((x - r) / CELL) | 0), c1 = Math.min(TW - 1, ((x + r) / CELL) | 0);
  const r0 = Math.max(0, ((y - r) / CELL) | 0), r1 = Math.min(TH - 1, ((y + r) / CELL) | 0);
  for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
    const dx = cx * CELL + 1 - x, dy = cy * CELL + 1 - y;
    if (dx * dx + dy * dy < r * r && dy > -r * 0.8) { const i = cy * TW + cx; if (!g[i]) { g[i] = M_MOUND; TERR.sc[i] = 0; } }
  }
  markDirty(c0, r0, c1, r1);
  pruneDecor(x - r - 10, y - r - 30, x + r + 10, y + r + 10);
}
function addWall(x, y, w, h, m = M_WOOD) {
  const c0 = Math.max(0, (x / CELL) | 0), c1 = Math.min(TW - 1, ((x + w) / CELL) | 0);
  const r0 = Math.max(0, (y / CELL) | 0), r1 = Math.min(TH - 1, ((y + h) / CELL) | 0);
  for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) { const i = cy * TW + cx; if (!TERR.g[i]) TERR.g[i] = m; }
  markDirty(c0, r0, c1, r1);
}
function pruneDecor(x0, y0, x1, y1) {
  // keep the same array when nothing was removed, so the cached decor layer stays valid
  const next = TERR.decor.filter((d) => {
    if (d.x < x0 || d.x > x1 || d.y < y0 || d.y > y1 + 40) return true;
    return solid(d.x, d.y + 3) && !solid(d.x, d.y - 4);
  });
  if (next.length !== TERR.decor.length) TERR.decor = next;
}
/* Apply a network op: [type, x, y, a, b] */
function applyOp(op) {
  const [t, x, y, a, b] = op;
  if (t === 1) carve(x, y, a);
  else if (t === 2) addMound(x, y, a);
  else if (t === 3) addWall(x, y, a, b);
}

/* ---------- rendering to an offscreen canvas ---------- */
function terrainInitCanvas() {
  TERR.canvas = document.createElement('canvas');
  TERR.canvas.width = TW; TERR.canvas.height = TH;
  TERR.ctx = TERR.canvas.getContext('2d');
  TERR.img = TERR.ctx.createImageData(TW, TH);
  TERR.dirty = [0, 0, TW - 1, TH - 1];
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function setPalette(p) {
  const P = {};
  for (const k in p) P[k] = typeof p[k] === 'string' && p[k][0] === '#' ? hex(p[k]) : p[k];
  P.stoneTop = P.stoneTop || mix(P.grass, P.stone, 0.45);
  TERR.pal = P;
}
const STRATA = noise1(4242);
/* rock carvings: 9x9 cell glyphs on a hashed grid */
const GLYPHS = [
  ['...#.#...', '....#....', '.#.###.#.', '..#####..', '###...###', '..#####..', '.#.###.#.', '....#....', '...#.#...'], // sun
  ['..#####..', '.#.....#.', '#..###..#', '#.#...#.#', '#.#.#.#.#', '#.#..##.#', '#..#....#', '.#..####.', '..#......'], // spiral
  ['.#.#.#...', '.#.#.#.#.', '.#.#.#.#.', '.#######.', '.#######.', '#.#####..', '.######..', '..####...', '..####...'], // hand
  ['...###...', '...###...', '....#....', '#.#####.#', '.#..#..#.', '....#....', '...#.#...', '..#...#..', '.#.....#.'], // figure
];
function glyphAt(x, y) {
  const gx = Math.floor(x / 26), gy = Math.floor(y / 22), h = ((gx * 73856093) ^ (gy * 19349663)) >>> 0;
  if (h % 5 !== 0) return false;
  const lx = x - gx * 26 - 8, ly = y - gy * 22 - 6;
  if (lx < 0 || ly < 0 || lx > 8 || ly > 8) return false;
  return GLYPHS[(h >>> 4) % GLYPHS.length][ly][lx] === '#';
}
/* totem paint: each tier has its own colour, a zigzag rim and a carved face (eyes + mouth) */
const TOTEM_TIERS = ['#9a5a2e', '#c7442e', '#f2d9a8', '#2f78c4', '#c7442e', '#3a8f5a'].map(hex);
function totemCol(x, y, P) {
  const T = TERR.totem, wy = y * CELL + 1, dx = Math.abs(x * CELL + 1 - W / 2);
  if (dx > 30) return (y % 3 === 0) ? P.woodDk : mix(P.tri1, P.woodDk, 0.15); // wings
  const k = Math.floor((wy - T.top) / T.tierH), ly = wy - T.top - k * T.tierH;
  if (k < 0 || k >= T.tiers) return P.wood;
  const dark = [58, 32, 20];
  if (ly < 2) return dark;
  const tri = Math.abs((x % 6) - 3);
  if (ly - 2 >= tri && ly - 2 < tri + 2) return k % 2 ? P.tri2 : P.tri1;
  if (ly >= 7 && ly < 10 && dx >= 6 && dx <= 12) return k % 3 === 2 ? [255, 236, 160] : dark;  // eyes
  if (ly >= 12 && ly < 14 && dx < 8) return dark;                                               // mouth
  return TOTEM_TIERS[k % TOTEM_TIERS.length];
}
/* the base colour of a solid cell (before light and scorch); depth = solid cells above it */
function cellCol(x, y, i, m, depth, P) {
  let c;
  if (m === M_STONE) {
    c = mix(P.stone, P.stoneDk, Math.min(1, depth / 60));
    if (P.bricks) { const row = (y / 6) | 0; if (y % 6 === 0 || (x + (row & 1) * 5) % 10 === 0) c = mix(c, P.stoneDk, 0.55); }
    if (depth < 3 && TERR.g[i - TW * depth - TW] === 0) c = P.stoneTop;
  }
  else if (m === M_WOOD) c = P.tribal && TERR.totem ? totemCol(x, y, P) : (y % 4 === 0 || x % 14 === 0) ? P.woodDk : P.wood;
  else if (m === M_MOUND) c = depth < 2 ? mix(P.mound, P.grass, 0.25) : P.mound;
  else {
    if (depth === 0) c = P.top;
    else if (depth < 4) c = P.grass;
    else if (depth < 6) c = P.grassDk;
    else {
      c = mix(P.soil, P.soilDk, Math.min(1, (depth - 6) / 70));
      const band = (y + STRATA(x / 40) * 10) % 26;
      if (band < 2.2) c = mix(c, P.band, P.bandA);
      // tribal zigzag band under the surface, like the trim on the tents and loincloths
      if (P.tribal && depth >= 8 && depth < 19) { const l = depth - 8, tri = Math.abs((x % 10) - 5); if (l >= tri && l < tri + 3) c = P.tri1; else if (l >= tri + 4 && l < tri + 6) c = P.tri2; }
      else if (P.tribal && depth >= 19) {
        // sandstone strata, and rock carvings (sun, spiral, hand, figure) scattered over the cliffs
        const sb = (y + STRATA(x / 50) * 9) % 14; if (sb < 4) c = mix(c, sb < 2 ? P.tri2 : P.soilDk, 0.22);
        if (depth > 26 && glyphAt(x, y)) c = mix(c, P.tri2, 0.7);
      }
    }
  }
  return c;
}
function terrainFlush() {
  const d = TERR.dirty; if (!d || !TERR.img) return;
  TERR.dirty = null;
  const g = TERR.g, sc = TERR.sc, px = TERR.img.data, P = TERR.pal;
  const x0 = Math.max(0, d[0] - 2), x1 = Math.min(TW - 1, d[2] + 2), y0 = Math.max(0, d[1] - 2), y1 = Math.min(TH - 1, d[3] + 40);
  for (let x = x0; x <= x1; x++) {
    // depth = solid run length above the cell (scan up from y0)
    let run = 0;
    for (let y = Math.max(0, y0 - 60); y < y0; y++) run = g[y * TW + x] ? run + 1 : 0;
    for (let y = y0; y <= y1; y++) {
      const i = y * TW + x, m = g[i], o = i * 4;
      if (!m) { run = 0; px[o + 3] = 0; continue; }
      const depth = run; run++;
      const below = y + 1 < TH ? g[i + TW] : 0;
      const left = x > 0 ? g[i - 1] : 0, right = x + 1 < TW ? g[i + 1] : 0;
      const c = cellCol(x, y, i, m, depth, P);
      let k = 1;
      const hsh = ((x * 73856093) ^ (y * 19349663)) & 255;
      k += (hsh / 255 - 0.5) * 0.08;
      if (!below) k *= 0.62;
      else if (!left || !right) k *= 0.82;
      if (below && y + 2 < TH && !g[i + TW * 2]) k *= 0.8;
      let r = c[0] * k, gg = c[1] * k, b = c[2] * k;
      if (sc[i]) { const t = sc[i] / 3.4; r = lerp(r, P.scorch[0], t); gg = lerp(gg, P.scorch[1], t); b = lerp(b, P.scorch[2], t); }
      px[o] = r; px[o + 1] = gg; px[o + 2] = b; px[o + 3] = 255;
    }
  }
  TERR.ctx.putImageData(TERR.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
