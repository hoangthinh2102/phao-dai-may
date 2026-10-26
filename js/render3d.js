'use strict';
/* ===== Pháo Đài Mây — 3D view (Three.js) =====
   The match itself stays 2D (sim, terrain grid, network); this draws the same world in 3D:
   - islands are slabs: the painted terrain is the front face, and its smoothed outline is extruded backwards into
     walls, so craters become real 3D holes. Only the chunks an explosion touched are rebuilt.
   - decor (trees, tents, the gate) stands on the top of the slabs, a little behind the heroes.
   - heroes are chibi 3D models built from primitives: toon shading, ink outlines, an anime face painted on the head.
   The camera looks straight at the play plane (z = 0) from slightly above, with an off-centre frustum, so that plane
   maps to the screen exactly as in 2D: everything drawn on the 2D overlay (shells, particles, aim, labels) still lines up. */

const THREE_URLS = ['https://unpkg.com/three@0.169.0/build/three.module.min.js', 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js'];
const R3 = { T: null, ready: false, loading: false, failed: false, renderer: null, scene: null, camera: null, views: new Map(), gen: -1 };
const SLAB_D = 120;    // island depth (world px)
const HERO_Z = -14;    // heroes walk this far back on the top of the islands
const DECOR_Z = -52;   // decor stands behind them
const CH = 32;         // terrain chunk size in cells
const NCX = Math.ceil(TW / CH), NCY = Math.ceil(TH / CH);

function r3Load() { return R3.loadP || (R3.loadP = r3LoadOnce()); }
async function r3LoadOnce() {
  R3.loading = true;
  try {
    let T = null;
    for (const u of THREE_URLS) { try { T = await import(u); break; } catch (e) { /* next mirror */ } }
    if (!T) throw new Error('three.js unavailable');
    R3.T = T;
    T.ColorManagement.enabled = false; // colours as written, like the 2D canvas
    r3Init();
    R3.ready = true;
  } catch (e) { console.warn('3D off:', e); R3.failed = true; }
  R3.loading = false;
  return R3.ready;
}

function r3Init() {
  const T = R3.T;
  const c3 = document.createElement('canvas'); c3.id = 'cv3';
  const cf = document.createElement('canvas'); cf.id = 'cvF';
  cv.after(c3); c3.after(cf);
  const renderer = new T.WebGLRenderer({ canvas: c3, antialias: true, alpha: true, powerPreference: 'high-performance', premultipliedAlpha: true });
  if (!renderer.getContext()) throw new Error('no WebGL');
  renderer.outputColorSpace = T.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  renderer.sortObjects = true;
  Object.assign(R3, { renderer, c3, cf, ctxF: cf.getContext('2d'), scene: new T.Scene(), camera: new T.PerspectiveCamera(30, 1, 10, 9000) });
  R3.camera.matrixAutoUpdate = true;
  // light: soft sky fill + a warm key from the upper left front
  R3.scene.add(new T.HemisphereLight(0xfff6ea, 0x8a86a8, 1.75));
  const sun = new T.DirectionalLight(0xffffff, 2.1); sun.position.set(-0.55, 1, 0.85); R3.scene.add(sun); R3.scene.add(sun.target);
  const g = new Uint8Array([105, 175, 255]);
  R3.toonRamp = new T.DataTexture(g, 3, 1, T.RedFormat); R3.toonRamp.minFilter = R3.toonRamp.magFilter = T.NearestFilter; R3.toonRamp.needsUpdate = true;
  // ink outline: back faces pushed out along the normal, by about the same number of screen pixels at any zoom
  R3.inkU = { uInkPx: { value: 2 }, uViewH: { value: 720 } };
  R3.inkMats = {};
  R3.inkMat = inkMat('#2b1d2e');
  r3TerrainInit();
}

function inkMat(col) {
  if (R3.inkMats[col]) return R3.inkMats[col];
  const m = new R3.T.MeshBasicMaterial({ color: col, side: R3.T.BackSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, R3.inkU);
    sh.vertexShader = 'uniform float uInkPx, uViewH;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  vec3 inkN = normalize(normalMatrix * normal);
  mvPosition.xyz += inkN * (uInkPx * 2.0 * max(-mvPosition.z, 1.0) / (projectionMatrix[1][1] * uViewH));
  gl_Position = projectionMatrix * mvPosition;`);
  };
  return (R3.inkMats[col] = m);
}
// toon shading plus a rim light and a small hard highlight, like a glossy vinyl toy
function toonGloss(sh) {
  sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `{
  vec3 vv = normalize(vViewPosition);
  float rim = smoothstep(0.42, 0.78, 1.0 - max(dot(normal, vv), 0.0)) * (0.35 + 0.65 * clamp(normal.y + 0.45, 0.0, 1.0));
  float spec = smoothstep(0.955, 0.975, dot(normal, normalize(vec3(-0.42, 0.62, 0.66) + vv)));
  outgoingLight += vec3(1.0, 0.96, 0.9) * (rim * 0.3 + spec * 0.22);
}
#include <opaque_fragment>`);
}
/* ---------- canvases ---------- */
function r3Sync(on) {
  if (!R3.ready) return;
  if (R3.c3.hidden === !on) return;
  R3.c3.hidden = !on; R3.cf.hidden = !on;
  if (!on) { R3.ctxF.setTransform(1, 0, 0, 1, 0, 0); R3.ctxF.clearRect(0, 0, R3.cf.width, R3.cf.height); }
}
function r3Size(w, h) {
  if (R3.cf.width !== w || R3.cf.height !== h) { R3.cf.width = w; R3.cf.height = h; }
  if (R3.w !== w || R3.h !== h) { R3.w = w; R3.h = h; R3.renderer.setSize(w, h, false); }
}

/* ---------- terrain: front face + extruded edges ----------
   Both follow one smooth outline: the cell grid blurred a little (F, one value per cell centre), cut at 0.5.
   - the front face is shaded on the GPU from two cell textures, so nothing on it shows the 2px cell stairs:
       col: rgb = the cell's own colour (soil keeps its strata, grass bands left out), a = F
       aux: r = smooth depth below the surface, g = material, b = scorch, a = stone blurred
     the grass bands are cut from the smooth depth, stone/soil from the blurred stone mask, colours are blended only
     between cells of the same material, and the F = 0.5 edge gets an ink line about 2 screen pixels wide
   - the walls are that same contour traced with marching squares and pushed back by SLAB_D */
const FACE_VS = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FACE_FS = `uniform sampler2D tCol, tAux, tDet;
uniform float uDet;
uniform vec2 uSize;
uniform vec3 uTop, uGrass, uGrassDk, uStoneTop, uScorch;
uniform float uInk, uSat, uCut;
varying vec2 vUv;
float aa(float v, float e, float w) { return smoothstep(e - w, e + w, v); }
float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 q) { vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec4 c0 = texture2D(tCol, vUv);
  float F = c0.a, wF = max(fwidth(F), 1e-4);
  float alpha = aa(F, 0.5, wF * 0.7);
  if (alpha < uCut) discard;
  vec4 ax = texture2D(tAux, vUv);
  vec2 p = vUv * uSize - 0.5, fp = fwidth(p);
  float stone = aa(ax.a, 0.5, max(fwidth(ax.a), 2e-3) * 0.7);
  vec3 base = c0.rgb;
  float dirt = 1.0 - stone;
  float mag = clamp((1.0 - max(fp.x, fp.y)) * 2.0, 0.0, 1.0); // texels bigger than a screen pixel: blend within one material only
  if (mag > 0.0) {
    ivec2 i0 = ivec2(floor(p)), hi = ivec2(uSize) - 1;
    vec2 f = fract(p);
    vec3 cs = vec3(0.0), co = vec3(0.0);
    float ws = 0.0, wo = 0.0, wd = 0.0;
    for (int k = 0; k < 4; k++) {
      ivec2 o = ivec2(k & 1, k >> 1), q = clamp(i0 + o, ivec2(0), hi);
      float w = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y) + 1e-5;
      vec3 c = texelFetch(tCol, q, 0).rgb;
      float m = floor(texelFetch(tAux, q, 0).g * 4.25 + 0.5);
      if (m < 0.5) w *= 0.05; // air: colour borrowed from a neighbour
      if (m > 1.5 && m < 2.5) { cs += c * w; ws += w; } else { co += c * w; wo += w; if (m > 0.5 && m < 1.5) wd += w; }
    }
    vec3 o = wo > 0.0 ? co / wo : cs / ws, st = ws > 0.0 ? cs / ws : o;
    base = mix(base, mix(o, st, stone), mag);
    dirt = mix(dirt, (wo > 0.0 ? wd / wo : 0.0) * (1.0 - stone), mag);
  }
  // bands under the surface, from the smooth depth (in cells)
  float d = ax.r * 16.0, wd = max(fwidth(d) * 0.7, 0.02);
  vec3 bc = mix(uGrassDk, base, aa(d, 6.0, wd));
  bc = mix(uGrass, bc, aa(d, 4.0, wd));
  bc = mix(uTop, bc, aa(d, 1.0, wd));
  vec3 col = mix(base, bc, dirt);
  col = mix(col, mix(uStoneTop, base, aa(d, 3.0, wd)), stone);
  // a soft shadow under the grass lip, and a painted grain (stronger on rock)
  col *= 1.0 - 0.16 * dirt * aa(d, 6.0, wd) * (1.0 - aa(d, 10.0, 1.2));
  float n = vnoise(p * 0.11) * 0.6 + vnoise(p * 0.37 + 7.0) * 0.4;
  col *= 1.0 + (n - 0.5) * (0.08 + 0.1 * stone) * (1.0 - uDet * 0.7);
  if (uDet > 0.0) { // painted detail: r soil, g rock, b grass (each a tile around 0.5)
    vec3 dt = texture2D(tDet, p / 96.0).rgb;
    float gb = dirt * (1.0 - aa(d, 6.0, wd));
    float dv = mix(mix(dt.r, dt.g, stone), dt.b, gb);
    col *= mix(1.0, 0.5 + dv, uDet);
  }
  col = mix(col, uScorch, clamp(ax.b * 255.0 / 80.0 / 3.4, 0.0, 1.0));
  // a little calmer than the heroes
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat);
  // ink along the edge
  float e = (F - 0.5) / wF;
  col = mix(col, col * vec3(0.30, 0.27, 0.36), (1.0 - smoothstep(uInk - 0.7, uInk + 0.7, e)) * 0.92);
  gl_FragColor = vec4(col, alpha);
}`;
function r3TerrainInit() {
  const T = R3.T;
  R3.field = new Float32Array(TW * TH);
  R3.faceData = new Uint8Array(TW * TH * 4);
  R3.auxData = new Uint8Array(TW * TH * 4);
  const tex = (data) => { const t = new T.DataTexture(data, TW, TH, T.RGBAFormat); t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; return t; };
  R3.faceTex = tex(R3.faceData); R3.auxTex = tex(R3.auxData);
  const msaa = R3.renderer.getContext().getContextAttributes().antialias;
  R3.faceMat = new T.ShaderMaterial({
    vertexShader: FACE_VS, fragmentShader: FACE_FS, alphaToCoverage: msaa,
    uniforms: {
      tCol: { value: R3.faceTex }, tAux: { value: R3.auxTex }, uSize: { value: new T.Vector2(TW, TH) },
      uTop: { value: new T.Vector3() }, uGrass: { value: new T.Vector3() }, uGrassDk: { value: new T.Vector3() }, uStoneTop: { value: new T.Vector3() }, uScorch: { value: new T.Vector3() },
      uInk: { value: 1.6 }, uSat: { value: 0.86 }, uCut: { value: msaa ? 0.02 : 0.5 },
      tDet: { value: null }, uDet: { value: 0 },
    },
  });
  const pg = new T.PlaneGeometry(W, H), uv = pg.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i)); // data row 0 is the top of the world
  R3.face = new T.Mesh(pg, R3.faceMat);
  R3.face.position.set(W / 2, -H / 2, 0);
  R3.scene.add(R3.face);
  R3.edgeGeo = new T.BufferGeometry();
  R3.edgeCap = 0;
  R3.edges = new T.Mesh(R3.edgeGeo, new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide }));
  R3.edges.frustumCulled = false;
  R3.scene.add(R3.edges);
  R3.chunks = new Array(NCX * NCY).fill(null);
  R3.dirty = new Set(); R3.rect = null;
  R3.decorStrips = [];
  // the terrain tells us which cells changed
  TERR.on3 = (x0, y0, x1, y1) => {
    const r = R3.rect;
    if (!r) R3.rect = [x0, y0, x1, y1]; else { r[0] = Math.min(r[0], x0); r[1] = Math.min(r[1], y0); r[2] = Math.max(r[2], x1); r[3] = Math.max(r[3], y1); }
    const a = Math.max(0, ((x0 - 3) / CH) | 0), b = Math.min(NCX - 1, ((x1 + 3) / CH) | 0);
    const c = Math.max(0, ((y0 - 3) / CH) | 0), d = Math.min(NCY - 1, ((y1 + 3) / CH) | 0);
    for (let y = c; y <= d; y++) for (let x = a; x <= b; x++) R3.dirty.add(y * NCX + x);
  };
}
// the map's band colours for the face shader
function r3FacePalette() {
  const P = TERR.pal, u = R3.faceMat.uniforms, v = (k, c) => u[k].value.set(c[0] / 255, c[1] / 255, c[2] / 255);
  v('uTop', P.top); v('uGrass', P.grass); v('uGrassDk', P.grassDk); v('uStoneTop', P.stoneTop); v('uScorch', P.scorch);
}
// F = occupancy blurred with a 3x3 binomial kernel, the stone mask blurred the same way, the smooth depth (from where
// F crosses 0.5 above, per column) and each cell's colour. Depth and colour reach far below a change, so +42 rows.
function r3Field(x0, y0, x1, y1) {
  const g = TERR.g, sc = TERR.sc, F = R3.field, D = R3.faceData, A = R3.auxData, P = TERR.pal;
  x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(TW - 1, x1 + 2); y1 = Math.min(TH - 1, y1 + 42);
  const s = (x, y) => (x < 0 || y < 0 || x >= TW || y >= TH ? 0 : g[y * TW + x] ? 1 : 0);
  // separable 1-2-1 blur of occupancy and of the stone mask: rows first (with a row of margin), then columns
  const w = x1 - x0 + 1, ry0 = Math.max(0, y0 - 1), ry1 = Math.min(TH - 1, y1 + 1), rh = ry1 - ry0 + 1;
  const n = w * rh;
  if (!R3.tmpO || R3.tmpO.length < n) { R3.tmpO = new Float32Array(n); R3.tmpS = new Float32Array(n); }
  const HO = R3.tmpO, HS = R3.tmpS;
  for (let y = ry0; y <= ry1; y++) {
    const row = y * TW, o = (y - ry0) * w;
    for (let x = x0; x <= x1; x++) {
      const m = g[row + x], l = x > 0 ? g[row + x - 1] : 0, r = x < TW - 1 ? g[row + x + 1] : 0;
      HO[o + x - x0] = (l ? 1 : 0) + (m ? 2 : 0) + (r ? 1 : 0);
      HS[o + x - x0] = (l === M_STONE ? 1 : 0) + (m === M_STONE ? 2 : 0) + (r === M_STONE ? 1 : 0);
    }
  }
  for (let y = y0; y <= y1; y++) {
    const o = (y - ry0) * w, up = y > ry0 ? o - w : -1, dn = y < ry1 ? o + w : -1;
    for (let x = x0; x <= x1; x++) {
      const k = x - x0, i = y * TW + x, q = i * 4;
      const f = ((up >= 0 ? HO[up + k] : 0) + 2 * HO[o + k] + (dn >= 0 ? HO[dn + k] : 0)) / 16;
      const sv = ((up >= 0 ? HS[up + k] : 0) + 2 * HS[o + k] + (dn >= 0 ? HS[dn + k] : 0)) / 16;
      F[i] = f; D[q + 3] = Math.round(f * 255);
      A[q + 1] = g[i] * 60; A[q + 2] = sc[i] * 80; A[q + 3] = Math.round(sv * 255);
    }
  }
  for (let x = x0; x <= x1; x++) {
    let run = 0, sy = -99, pf = 0;
    const ys = Math.max(0, y0 - 80);
    for (let y = ys; y <= y1; y++) {
      const i = y * TW + x, m = g[i], f = F[i];
      if (f >= 0.5) { if (pf < 0.5) sy = y === ys ? y - 16 : y - 1 + (0.5 - pf) / (f - pf); } else sy = -99;
      pf = f;
      const depth = run; run = m ? run + 1 : 0;
      if (y < y0) continue;
      const o = i * 4;
      A[o] = sy > -99 ? Math.round(Math.min(15.9, y - sy) * 16) : 0;
      if (!m) continue;
      const c = cellCol(x, y, i, m, m === M_DIRT ? Math.max(6, depth) : m === M_STONE ? Math.max(3, depth) : depth, P);
      const k = 1 + ((((x * 73856093) ^ (y * 19349663)) & 255) / 255 - 0.5) * 0.06;
      D[o] = Math.min(255, c[0] * k); D[o + 1] = Math.min(255, c[1] * k); D[o + 2] = Math.min(255, c[2] * k);
    }
  }
  // air takes the colour of a solid neighbour, so the soft edge never fades to black
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * TW + x; if (g[i]) continue;
    const o = i * 4;
    let src = -1;
    if (s(x, y - 1)) src = o - TW * 4; else if (s(x, y + 1)) src = o + TW * 4; else if (s(x - 1, y)) src = o - 4; else if (s(x + 1, y)) src = o + 4;
    if (src >= 0) { D[o] = D[src]; D[o + 1] = D[src + 1]; D[o + 2] = D[src + 2]; }
  }
}
// one chunk of wall quads along the F = 0.5 contour (marching squares between cell centres).
// Shading is baked into the colours from F's gradient (light from the upper left), darker towards the back.
function r3Chunk(ci) {
  const g = TERR.g, px = TERR.img.data, F = R3.field;
  const cx0 = (ci % NCX) * CH, cy0 = ((ci / NCX) | 0) * CH, cx1 = Math.min(TW - 1, cx0 + CH), cy1 = Math.min(TH - 1, cy0 + CH);
  const segs = [];
  for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) {
    const i = y * TW + x, a = F[i], b = F[i + 1], c = F[i + TW + 1], d = F[i + TW];
    const k = (a >= 0.5 ? 8 : 0) | (b >= 0.5 ? 4 : 0) | (c >= 0.5 ? 2 : 0) | (d >= 0.5 ? 1 : 0);
    if (k === 0 || k === 15) continue;
    const X = x * CELL + 1, Y = y * CELL + 1, t = (p, q) => (0.5 - p) / (q - p);
    const P = { T: [X + t(a, b) * CELL, Y], R: [X + CELL, Y + t(b, c) * CELL], B: [X + t(d, c) * CELL, Y + CELL], L: [X, Y + t(a, d) * CELL] };
    const pairs = k === 5 ? [['T', 'R'], ['B', 'L']] : k === 10 ? [['T', 'L'], ['R', 'B']] : null;
    const crossed = [];
    if ((a >= 0.5) !== (b >= 0.5)) crossed.push('T'); if ((b >= 0.5) !== (c >= 0.5)) crossed.push('R');
    if ((c >= 0.5) !== (d >= 0.5)) crossed.push('B'); if ((d >= 0.5) !== (a >= 0.5)) crossed.push('L');
    const gx = (b + c - a - d) / 2, gy = (d + c - a - b) / 2;
    // the most solid corner gives the colour
    const corners = [[a, i], [b, i + 1], [c, i + TW + 1], [d, i + TW]];
    let best = corners[0]; for (const q of corners) if (q[0] > best[0] && g[q[1]]) best = q; if (!g[best[1]]) for (const q of corners) if (g[q[1]]) { best = q; break; }
    for (const pr of pairs || [crossed]) segs.push(P[pr[0]], P[pr[1]], gx, gy, best[1]);
  }
  const n = segs.length / 5;
  if (!n) return null;
  // colour and light are worked out per vertex from its position only, so neighbouring quads share them exactly
  const Fs = (wx, wy) => { // F, bilinear, at a world point
    const fx = clamp((wx - 1) / CELL, 0, TW - 1.001), fy = clamp((wy - 1) / CELL, 0, TH - 1.001), x = fx | 0, y = fy | 0, u = fx - x, v = fy - y, i = y * TW + x;
    return (F[i] * (1 - u) + F[i + 1] * u) * (1 - v) + (F[i + TW] * (1 - u) + F[i + TW + 1] * u) * v;
  };
  const cache = new Map();
  const shade = (wx, wy) => {
    const key = Math.round(wx * 8) * 100003 + Math.round(wy * 8);
    let c = cache.get(key); if (c) return c;
    let ox = Fs(wx - 4, wy) - Fs(wx + 4, wy), oy = Fs(wx, wy - 4) - Fs(wx, wy + 4);
    const len = Math.hypot(ox, oy) || 1; ox /= len; oy /= len;
    const f = 0.6 + 0.46 * Math.max(0, ox * -0.35 + oy * -0.94) - 0.14 * Math.max(0, oy), top = oy < -0.55;
    const cx = clamp(Math.floor(wx / CELL), 0, TW - 1), cy = clamp(Math.floor(wy / CELL), 0, TH - 1);
    let r = 0, gg = 0, bb = 0, cnt = 0;
    if (top) { // the walkable top: the surface colour of the columns around
      for (let k = -4; k <= 4; k++) {
        const xx = cx + k; if (xx < 0 || xx >= TW) continue;
        let yy = cy; while (yy > 0 && g[(yy - 1) * TW + xx] && cy - yy < 6) yy--;
        while (yy < TH - 1 && !g[yy * TW + xx] && yy - cy < 6) yy++;
        if (!g[yy * TW + xx]) continue;
        const w = 5 - Math.abs(k), oo = (yy * TW + xx) * 4; r += px[oo] * w; gg += px[oo + 1] * w; bb += px[oo + 2] * w; cnt += w;
      }
    } else { // a wall: the solid cells right behind this point
      for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1], [1, 0], [0, 1], [1, 1], [-1, 1], [1, -1]]) {
        const xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= TW || yy >= TH || !g[yy * TW + xx]) continue;
        const oo = (yy * TW + xx) * 4; r += px[oo]; gg += px[oo + 1]; bb += px[oo + 2]; cnt++;
      }
    }
    if (!cnt) { r = gg = bb = 120; cnt = 1; }
    r /= cnt; gg /= cnt; bb /= cnt;
    const ff = f * (top ? 1.06 : 1), fb = f * (top ? 0.93 : 0.66);
    c = [Math.min(255, r * ff), Math.min(255, gg * ff), Math.min(255, bb * ff), Math.min(255, r * fb), Math.min(255, gg * fb), Math.min(255, bb * fb)];
    cache.set(key, c); return c;
  };
  const pos = new Float32Array(n * 12), col = new Uint8Array(n * 12);
  for (let q = 0; q < n; q++) {
    const A = segs[q * 5], B = segs[q * 5 + 1], p = q * 12, ca = shade(A[0], A[1]), cb = shade(B[0], B[1]);
    pos[p] = A[0]; pos[p + 1] = -A[1]; pos[p + 2] = 0;
    pos[p + 3] = B[0]; pos[p + 4] = -B[1]; pos[p + 5] = 0;
    pos[p + 6] = B[0]; pos[p + 7] = -B[1]; pos[p + 8] = -SLAB_D;
    pos[p + 9] = A[0]; pos[p + 10] = -A[1]; pos[p + 11] = -SLAB_D;
    col[p] = ca[0]; col[p + 1] = ca[1]; col[p + 2] = ca[2];
    col[p + 3] = cb[0]; col[p + 4] = cb[1]; col[p + 5] = cb[2];
    col[p + 6] = cb[3]; col[p + 7] = cb[4]; col[p + 8] = cb[5];
    col[p + 9] = ca[3]; col[p + 10] = ca[4]; col[p + 11] = ca[5];
  }
  return { pos, col, n };
}
function r3EdgesRebuild(all) {
  const T = R3.T;
  if (all) { r3Field(0, 0, TW - 1, TH - 1); R3.rect = null; R3.dirty.clear(); for (let i = 0; i < R3.chunks.length; i++) R3.chunks[i] = r3Chunk(i); }
  else {
    if (R3.rect) { const r = R3.rect; R3.rect = null; r3Field(r[0], r[1], r[2], r[3]); }
    for (const i of R3.dirty) R3.chunks[i] = r3Chunk(i); R3.dirty.clear();
  }
  R3.faceTex.needsUpdate = true; R3.auxTex.needsUpdate = true;
  let total = 0; for (const c of R3.chunks) if (c) total += c.n;
  if (total > R3.edgeCap) {
    const cap = Math.ceil(total * 1.4) + 256;
    R3.edgeCap = cap;
    R3.edgePos = new T.BufferAttribute(new Float32Array(cap * 12), 3); R3.edgePos.setUsage(T.DynamicDrawUsage);
    R3.edgeCol = new T.BufferAttribute(new Uint8Array(cap * 12), 3, true); R3.edgeCol.setUsage(T.DynamicDrawUsage);
    const idx = new Uint32Array(cap * 6);
    for (let k = 0; k < cap; k++) { const v = k * 4, o = k * 6; idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3; }
    R3.edgeGeo.dispose();
    R3.edgeGeo = new T.BufferGeometry();
    R3.edgeGeo.setAttribute('position', R3.edgePos); R3.edgeGeo.setAttribute('color', R3.edgeCol); R3.edgeGeo.setIndex(new T.BufferAttribute(idx, 1));
    R3.edges.geometry = R3.edgeGeo;
  }
  let o = 0;
  for (const c of R3.chunks) if (c) { R3.edgePos.array.set(c.pos, o * 12); R3.edgeCol.array.set(c.col, o * 12); o += c.n; }
  R3.edgePos.needsUpdate = true; R3.edgeCol.needsUpdate = true;
  R3.edgeGeo.setDrawRange(0, total * 6);
}

/* ---------- decor: painted into a few vertical strips standing on the islands ---------- */
const STRIP_W = 480;
function r3Decor(full) {
  artLoad();
  const T = R3.T, sc = typeof TOUCHUI !== 'undefined' && TOUCHUI ? 1 : 1.5;
  const n = Math.ceil(W / STRIP_W);
  if (full || !R3.decorStrips.length) {
    for (const s of R3.decorStrips) { R3.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.tex.dispose(); }
    R3.decorStrips = [];
    for (let k = 0; k < n; k++) {
      const c = document.createElement('canvas'), tex = new T.CanvasTexture(c);
      tex.minFilter = T.LinearFilter; tex.generateMipmaps = false;
      const mesh = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, alphaTest: 0.04 }));
      mesh.renderOrder = 1;
      R3.scene.add(mesh);
      R3.decorStrips.push({ c, tex, mesh, x0: k * STRIP_W, x1: Math.min(W, (k + 1) * STRIP_W), sig: '' });
    }
  }
  let changed = !!full;
  for (const s of R3.decorStrips) {
    const list = TERR.decor.filter((d) => d.x > s.x0 - 160 && d.x < s.x1 + 160);
    const sig = list.length + ':' + list.reduce((a, d) => a + d.x * 7 + d.y, 0) + ':' + (LOGO.mask ? 1 : 0) + ':' + TERR.map + TERR.seed + ':' + ART.n;
    if (sig === s.sig) continue;
    s.sig = sig; changed = true;
    const ys = list.filter((d) => d.x >= s.x0 && d.x < s.x1);
    const top = ys.length ? Math.max(0, Math.min(...ys.map((d) => d.y)) - 300) : 0, bot = ys.length ? Math.min(H, Math.max(...ys.map((d) => d.y)) + 40) : 2;
    const w = s.x1 - s.x0, h = Math.max(2, bot - top);
    s.c.width = Math.max(2, Math.round(w * sc)); s.c.height = Math.max(2, Math.round(h * sc));
    const g = s.c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, s.c.width, s.c.height);
    g.setTransform(sc, 0, 0, sc, -s.x0 * sc, -top * sc);
    for (const d of list) if (d.type === 'tree') drawDecor3(g, d);
    for (const d of list) if (d.type !== 'tree') drawDecor3(g, d);
    s.tex.dispose(); s.tex = new T.CanvasTexture(s.c); s.tex.minFilter = T.LinearMipmapLinearFilter; s.tex.generateMipmaps = true; s.tex.anisotropy = 4;
    s.mesh.material.map = s.tex; s.mesh.material.needsUpdate = true;
    s.mesh.scale.set(w, h, 1); s.mesh.position.set(s.x0 + w / 2, -(top + h / 2), DECOR_Z);
    s.mesh.visible = ys.length > 0 || list.length > 0;
  }
  if (changed) r3DecorShadows();
}
// soft contact shadows under the bigger decor: a small grid per item that follows the ground it stands on
const SHADOW_R = { tree: 46, pine: 34, deadtree: 30, saguaro: 24, teepee: 48, gate: 74, bush: 18, cactus: 13, smallpine: 17, column: 15, lantern: 11, drum: 13, campfire: 17, crystal: 12, shroom: 8, spear: 7, flag: 8, deadbush: 11 };
function r3DecorShadows() {
  const T = R3.T;
  if (!R3.shadowMat) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    R3.shadowMat = new T.MeshBasicMaterial({ color: 0x2a1c34, alphaMap: new T.CanvasTexture(c), transparent: true, opacity: 0.36, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    R3.shadows = new T.Mesh(new T.BufferGeometry(), R3.shadowMat);
    R3.shadows.renderOrder = 0.5; R3.shadows.frustumCulled = false;
    R3.scene.add(R3.shadows);
  }
  const NX = 8, NZ = 3, pos = [], uv = [], idx = [];
  for (const d of TERR.decor) {
    const r = SHADOW_R[d.type]; if (!r) continue;
    const rx = r * (d.s || 1), rz = rx * 0.5, base = pos.length / 3;
    for (let i = 0; i <= NX; i++) {
      const x = d.x - rx + (2 * rx * i) / NX;
      const gy = Math.abs(surfaceBelow(x, d.y - 24) - d.y) < 30 ? surfaceBelow(x, d.y - 24) : d.y;
      for (let j = 0; j <= NZ; j++) { pos.push(x, -gy + 0.8, DECOR_Z - rz + (2 * rz * j) / NZ); uv.push(i / NX, j / NZ); }
    }
    for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) { const a = base + i * (NZ + 1) + j, b = a + NZ + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
  R3.shadows.geometry.dispose(); R3.shadows.geometry = geo;
}
// painted decor where there is art for it, else the 2D drawing
const DECOR_ART = { tree: ['tree', 150], pine: ['pine', 124], smallpine: ['pine', 36], saguaro: ['saguaro', 92], cactus: ['cactus', 26], deadtree: ['deadtree', 104], teepee: ['teepee', 88], bush: ['bush', 30] };
function drawDecor3(g, d) {
  const e = DECOR_ART[d.type], name = e && (d.type === 'tree' && d.hue > 0.7 ? 'tree_pink' : e[0]);
  const im = e && ART.m && ART.m.decor && ART.m.decor[name] ? artImg('decor_' + name) : null;
  if (!im) { drawDecor(g, d, 0, -1e4, 1e4); return; }
  const h = e[1] * (d.s || 1), w = h * im.width / im.height;
  g.save(); g.translate(d.x, d.y + h * 0.03); if (d.seed > 0.5) g.scale(-1, 1);
  g.drawImage(im, -w / 2, -h, w, h); g.restore();
}
// the painted sky of the map (3D only; the event map keeps its own backdrop)
function artSky() {
  if (!R3.ready || App.gfx !== '3d') return null;
  if (!ART.m) { artLoad(); return null; }
  return ART.m.skies && ART.m.skies[TERR.map] ? artImg('sky_' + TERR.map) : null;
}
// glowing decor (campfires, lanterns, vents) flickers on the 2D overlay
function r3DecorGlow(g, t, x0, x1, lift) {
  for (const d of TERR.decor) {
    if (d.x < x0 - 60 || d.x > x1 + 60) continue;
    const fl = 0.8 + 0.2 * Math.sin(t * 9 + d.seed * 20) * Math.sin(t * 5.3 + d.seed * 7);
    if (d.type === 'campfire') glow(g, d.x, d.y - 10 * d.s - lift, 40 * d.s, '#ff9a3c', 0.55 * fl);
    else if (d.type === 'lantern') glow(g, d.x, d.y - 46 * d.s - lift, 30 * d.s, '#ffcf6b', 0.5 * fl);
    else if (d.type === 'vent') glow(g, d.x, d.y - 6 - lift, 34, '#ff6a2a', 0.45 * fl);
    else if (d.type === 'crystal' && TERR.map === 'nui') glow(g, d.x, d.y - 12 * d.s - lift, 22 * d.s, '#ff7a3a', 0.4 * fl);
  }
}

/* ---------- chibi heroes ---------- */
const HG = new Map(); // geometry cache: key|team|tribe → parts
function colMul(hexCol, k) { const c = new R3.T.Color(hexCol).multiplyScalar(k); return '#' + c.getHexString(); }
function r3Mat(o) { const m = Object.assign(new R3.T.MeshToonMaterial({ gradientMap: R3.toonRamp }), o); m.onBeforeCompile = toonGloss; return m; }
// a list of primitives, each with its own colour, merged into one geometry (one draw call per moving part)
function partList() {
  const T = R3.T, list = [];
  const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz));
  const add = (geo, color, m) => {
    if (m) geo.applyMatrix4(m);
    const c = new T.Color(color), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new T.BufferAttribute(a, 3));
    if (geo.attributes.uv) geo.deleteAttribute('uv');
    list.push(geo);
  };
  const ell = (rx, ry, rz, col, x, y, z, ax = 0, ay = 0, az = 0, seg = 20) => add(new T.SphereGeometry(1, seg, Math.max(6, (seg * 0.7) | 0)), col, M(x, y, z, rx, ry, rz, ax, ay, az));
  const cyl = (r1, r2, h, col, x, y, z, ax = 0, ay = 0, az = 0, seg = 18) => add(new T.CylinderGeometry(r1, r2, h, seg), col, M(x, y, z, 1, 1, 1, ax, ay, az));
  const cone = (r, h, col, x, y, z, ax = 0, ay = 0, az = 0, seg = 8) => add(new T.ConeGeometry(r, h, seg), col, M(x, y, z, 1, 1, 1, ax, ay, az));
  const tor = (R, r, col, x, y, z, ax = 0, ay = 0, az = 0, arc = Math.PI * 2) => add(new T.TorusGeometry(R, r, 8, 28, arc), col, M(x, y, z, 1, 1, 1, ax, ay, az));
  const box = (w, h, d, col, x, y, z, ax = 0, ay = 0, az = 0) => add(new T.BoxGeometry(w, h, d), col, M(x, y, z, 1, 1, 1, ax, ay, az));
  const cap = (r, len, col, x, y, z, ax = 0, ay = 0, az = 0) => add(new T.CapsuleGeometry(r, len, 5, 14), col, M(x, y, z, 1, 1, 1, ax, ay, az));
  // a gumdrop body: widest low down, narrowing to the neck
  const bean = (col, x, y, z, sx = 1, sy = 1, sz = 1) => add(new T.LatheGeometry([[0, -11], [6.5, -10.8], [10.8, -8.6], [12.6, -4], [12.4, 1.5], [10.6, 6.4], [7, 9.8], [0, 11]].map(([r, h]) => new T.Vector2(r, h)), 28), col, M(x, y, z, sx, sy, sz));
  return { list, add, ell, cyl, cone, tor, box, cap, bean, M };
}
function mergeParts(list) {
  const T = R3.T;
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let v = 0, k = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, v * 3); nor.set(g.attributes.normal.array, v * 3); col.set(g.attributes.color.array, v * 3);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[k++] = g.index.array[i] + v;
    else for (let i = 0; i < n; i++) idx[k++] = v + i;
    v += n; g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3)); out.setAttribute('normal', new T.BufferAttribute(nor, 3)); out.setAttribute('color', new T.BufferAttribute(col, 3));
  out.setIndex(new T.BufferAttribute(idx, 1)); out.computeBoundingSphere();
  return out;
}
// the face, painted with the 2D drawFace onto the head's texture (front of a sphere = u 0.25)
function faceTexture(key, tribe, closed) {
  const T = R3.T, c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d'), D = HEROES[key];
  const stone = key === 'thachgiap' && !tribe;
  g.fillStyle = tribe ? TR.skin : stone ? D.color : D.light; g.fillRect(0, 0, 512, 256);
  if (stone) { // speckles on the rock
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(60,50,40,${0.08 + (i % 5) * 0.03})`; g.beginPath(); g.arc((i * 146) % 512, (i * 82) % 256, 4 + (i % 4) * 2, 0, 7); g.fill(); }
  }
  const k = 5.9, hy = 0, blinkT = (Math.PI / 2 - (hy + 1)) / 1.3;
  g.setTransform(k, 0, 0, k, 128, 124);
  drawFace(g, key === 'thachgiap' && tribe ? 'bombi' : key, D, 0, hy, closed ? blinkT : 0, {});
  if (tribe) {
    g.strokeStyle = 'rgba(232,96,40,0.9)'; g.lineWidth = 1.3; g.lineCap = 'round';
    for (const s of [-1, 1]) for (let j = 0; j < 2; j++) { const cx = s * 11, cy = hy + 3 + j * 3; g.beginPath(); g.moveTo(cx - 2.5, cy); g.lineTo(cx + 2.5, cy - 1); g.stroke(); }
  }
  const tex = new T.CanvasTexture(c); tex.anisotropy = 4;
  return tex;
}
function heroParts(key, team, tribe) {
  const id = key + '|' + team + '|' + (tribe ? 1 : 0);
  if (HG.has(id)) return HG.get(id);
  const T = R3.T, D = HEROES[key], tc = team >= 0 ? TEAM_COL[team] : '#d8432f';
  const girl = key === 'moclan';
  // feet
  const foot = partList();
  if (tribe) {
    foot.ell(6, 4, 5.2, TR.skin, 0, 3.4, 1);
    foot.tor(4.2, 1.2, TR.clothDk, 0, 7.2, 0.5, Math.PI / 2);
    foot.ell(1.3, 3.6, 1, '#ffffff', -4.6, 9.4, 0, 0, 0, -0.6, 8);
  } else { foot.ell(6, 4, 5.4, D.dark, 0, 3.6, 1); foot.ell(6.5, 1.5, 5.9, colMul(D.dark, 0.55), 0, 0.9, 1.2); }
  // body (with scarf, belly, necklace, loincloth, tail, shield)
  const body = partList();
  if (tribe) {
    body.ell(12, 11, 10, TR.skin, 0, 14, 0);
    body.cap(2.9, 5.5, TR.skin, -11.4, 14.6, 2.5, 0, 0, -0.5);
    body.cyl(12.3, 12.6, 9, girl ? '#e8892e' : TR.cloth, 0, 7.6, 0, 0, 0, 0, 16);
    body.cyl(12.8, 12.8, 2.2, TR.red, 0, 5, 0, 0, 0, 0, 16);
    body.cyl(12.5, 12.5, 1.6, TR.clothDk, 0, 12.2, 0, 0, 0, 0, 16);
    if (girl) body.cyl(11.2, 11.8, 5, '#e8892e', 0, 18.5, 0, 0, 0, 0, 16);
    for (let k = -2; k <= 2; k++) { const x = k * 4.2, z = Math.sqrt(Math.max(0, 121 - x * x)) - 0.6; body.cone(2.2, 4.4, k % 2 ? TR.cream : TR.red, x, 20.5 - Math.abs(k) * 0.5, z, Math.PI, 0, 0, 3); }
    if (key === 'thachgiap') { // the round shield on the arm, in front
      body.cyl(11, 11, 2.6, '#fff6e4', 9, 15, 10, Math.PI / 2, 0, 0, 20);
      body.tor(11, 1.4, '#8a5a2c', 9, 15, 11.4, 0, 0, 0);
      body.tor(5.5, 1.1, '#e0a640', 9, 15, 11.6, 0, 0, 0.6, Math.PI * 1.3);
    }
  } else {
    body.bean(D.color, 0, 14, 0, 1, 1, 0.84);
    body.ell(7, 6, 3, D.light, 0, 11.5, 8.4);
    // the free arm, hanging at the back side
    body.cap(2.9, 5.5, D.color, -11.4, 14.6, 2.5, 0, 0, -0.5);
    body.ell(3.4, 3.4, 3.4, D.light, -13.9, 9.8, 3);
    body.tor(9.2, 3, tc, 0, 22, 0, Math.PI / 2 + 0.12);
    body.cap(2.6, 7, tc, -9.5, 17, -3, 0, 0, 0.9);
    if (key === 'hoamieu') { body.cap(2.6, 12, D.color, -13, 18, -5, 0, 0, 0.75); body.cap(2.3, 7, D.color, -17.5, 27, -6, 0, 0, -0.2); body.ell(2.4, 3, 2.4, D.light, -18, 31.5, -6); }
  }
  // hair, hats, crest (around the head centre)
  const hair = partList();
  if (tribe) {
    if (girl) { hair.ell(16.8, 15, 16.8, '#2a2230', 0, 2.4, -1.2); hair.ell(15, 13, 8, '#2a2230', 0, -8, -9); }
    hair.tor(16.1, 2.1, tc, 0, 6.6, 0, Math.PI / 2 - 0.12);
    hair.ell(3.4, 3.4, 2, '#2b2238', 5.6, 6.8, 14.6);
    hair.ell(2.1, 2.1, 1.5, '#3fb5e0', 5.6, 6.8, 15.8);
    const cw = girl ? 7 : 10, fw = girl ? 4.5 : 6.5;
    for (const k of [0, 1, 2]) {
      const u = k / 2 - 0.5, len = (girl ? 14 : 22) - Math.abs(u) * 8, bx = u * cw * 2;
      const tilt = -u * 0.55;
      hair.ell(fw, len * 0.62, 2.6, TR.crest, bx + Math.sin(-tilt) * len * 0.45, 12 + len * 0.5, -1, 0, 0, tilt, 10);
      hair.ell(fw * 0.25, len * 0.5, 1.2, TR.crestHi, bx + Math.sin(-tilt) * len * 0.42, 12 + len * 0.48, 1.6, 0, 0, tilt, 8);
    }
    hair.ell(2.6, 7, 1.4, '#ffffff', -14.5, 8.5, -2, 0, 0, 0.9, 8);
  } else switch (key) {
    case 'bombi':
      hair.add(new T.SphereGeometry(16.7, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), '#5a3a24', hair.M(0, 5, -0.5, 1, 1, 1, -0.1));
      hair.ell(4, 5, 4, '#5a3a24', 1, 19, 2, 0, 0, -0.3, 8);
      hair.tor(16.2, 2.4, '#6b4a2b', 0, 9.5, 0, Math.PI / 2 - 0.14);
      for (const s of [-1, 1]) { hair.cyl(5, 5, 3.6, '#c9d6e3', s * 7, 11, 13.2, Math.PI / 2 - 0.45, 0, 0, 14); hair.tor(5, 1.1, '#5a6672', s * 7, 11.6, 14.8, -0.45); }
      break;
    case 'moclan':
      hair.add(new T.SphereGeometry(18, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.46), '#3f7f3f', hair.M(0, 3.6, -1.5, 1, 1, 1, -0.2));
      hair.ell(16, 15, 9, '#3f7f3f', 0, -5, -9);
      for (let k = 0; k < 5; k++) { const a = k * 1.256 + 0.3; hair.ell(3.6, 3.6, 2.4, k % 2 ? '#ffd6e8' : D.accent, 10 + Math.cos(a) * 4.6, 13 + Math.sin(a) * 4.6, 9, 0, 0, 0, 8); }
      hair.ell(2.4, 2.4, 2.4, '#ffcf3f', 10, 13, 10.5, 0, 0, 0, 8);
      hair.ell(7, 2.6, 3, '#7cc576', -6, 17, 5, 0, 0, 0.6, 8);
      break;
    case 'loivu':
      hair.add(new T.SphereGeometry(16.6, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.4), '#2a4fb0', hair.M(0, 4, -0.5, 1, 1, 1, -0.1));
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; hair.cone(4, 11, '#2a4fb0', Math.cos(a) * 9, 16, Math.sin(a) * 9 - 2, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5, 6); }
      for (const [x, y, r] of [[-9, 22, 8], [0, 27, 10], [9, 22, 8], [4, 19, 7]]) hair.ell(r, r * 0.8, r * 0.8, '#f2f6ff', x, y, -6, 0, 0, 0, 10);
      hair.box(3, 9, 2, '#ffd43b', 0, 26, 2, 0, 0, 0.5); hair.box(3, 9, 2, '#ffd43b', 2, 19, 2.5, 0, 0, 0.5);
      break;
    case 'hoamieu':
      hair.add(new T.SphereGeometry(16.9, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), '#d93a52', hair.M(0, 4.6, -0.5, 1, 1, 1, -0.1));
      for (const s of [-1, 1]) { hair.cone(5.6, 13, D.color, s * 10, 19, -1, 0, 0, -s * 0.45, 4); hair.cone(3, 8, '#ffb3c1', s * 9.6, 18, 1.4, 0, 0, -s * 0.45, 4); }
      hair.ell(3, 3, 3, D.accent, 9, 12, 9, 0, 0, 0, 8);
      break;
    case 'thachgiap':
      hair.ell(11, 4, 9, '#7fcf6a', 2, 15, 0, 0, 0, 0.1, 10);
      hair.cone(4, 12, '#66d9a8', 2, 22, 0, 0, 0, -0.15, 6);
      break;
  }
  // weapon (points along +x from the shoulder; the hand sits at its base)
  const wp = partList();
  const skin = tribe ? TR.skin : D.light;
  if (tribe) {
    const spear = (x0, x1, r, col) => wp.cyl(r, r, x1 - x0, col, (x0 + x1) / 2, 0, 0, 0, 0, Math.PI / 2, 8);
    const tip = (x, len, w, col) => wp.cone(w, len, col, x + len / 2, 0, 0, 0, 0, -Math.PI / 2, 4);
    if (key === 'bombi') { spear(-12, 36, 1.9, '#b07a3e'); wp.cyl(2.6, 2.6, 4, TR.red, 26, 0, 0, 0, 0, Math.PI / 2, 8); wp.cyl(2.6, 2.6, 2, TR.cream, 29, 0, 0, 0, 0, Math.PI / 2, 8); tip(34, 16, 5, '#fffaf0'); }
    else if (key === 'thachgiap') { spear(-6, 24, 1.8, '#9a6a36'); tip(23, 10, 4, '#e8e4dc'); }
    else if (key === 'moclan') { spear(-4, 26, 1.6, '#e9dcc0'); wp.ell(5, 2.2, 1.5, '#7cc576', 24, 4, 0, 0, 0, 0.6, 8); wp.ell(5, 2.2, 1.5, '#7cc576', 24, -4, 0, 0, 0, -0.6, 8); for (let k = 0; k < 5; k++) { const a = k * 1.256; wp.ell(2.4, 2.4, 1.6, '#ff8fbf', 29 + Math.cos(a) * 3.4, Math.sin(a) * 3.4, 0, 0, 0, 0, 6); } wp.ell(2, 2, 2, '#ffd23f', 29, 0, 1, 0, 0, 0, 6); }
    else if (key === 'loivu') { wp.cyl(9, 2, 30, '#f1e2c0', 11, 0, 0, 0, 0, Math.PI / 2, 12); for (const x of [6, 14]) wp.cyl(4.2 + x * 0.12, 4.2 + x * 0.12, 2.4, '#8a5a2c', x, 0, 0, 0, 0, Math.PI / 2, 10); wp.ell(1.6, 8.6, 8.6, '#5ab8ff', 26.5, 0, 0, 0, 0, 0, 10); }
    else if (key === 'hoamieu') { spear(-8, 30, 1.4, '#9a6a36'); tip(29, 11, 3.6, '#e8e4dc'); wp.ell(3.6, 3.6, 3.6, '#ff8a3c', 41, 0, 0, 0, 0, 0, 8); }
  } else switch (key) {
    case 'bombi': wp.cap(6, 26, '#3a3a4a', 12, 0, 0, 0, 0, Math.PI / 2); for (const x of [8, 18]) wp.cyl(6.4, 6.4, 3.4, D.color, x, 0, 0, 0, 0, Math.PI / 2, 12); wp.cyl(8, 8, 6, '#26262f', 29, 0, 0, 0, 0, Math.PI / 2, 12); wp.ell(4, 4, 4, '#ffd166', -5, 0, 0, 0, 0, 0, 8); break;
    case 'thachgiap': wp.cap(8, 18, '#7d7468', 9, 0, 0, 0, 0, Math.PI / 2); wp.cyl(10, 10, 8, '#5f5446', 24, 0, 0, 0, 0, Math.PI / 2, 12); wp.ell(3.5, 3.5, 3.5, D.accent, 8, 0, 7.5, 0, 0, 0, 8); break;
    case 'moclan': wp.cyl(2, 2, 30, '#8b5a35', 11, 0, 0, 0, 0, Math.PI / 2, 8); wp.tor(12, 1.5, '#a0703f', 22, 0, 0, 0, 0, -1.35, 2.7); wp.cyl(0.4, 0.4, 23, '#ffffff', 25, 0, 0, 0, 0, 0, 4); wp.ell(5, 2.4, 1.6, '#7cc576', 8, -5, 0, 0, 0, 0.5, 8); wp.ell(3.2, 3.2, 3.2, D.accent, 26, 0, 0, 0, 0, 0, 8); break;
    case 'loivu': wp.cyl(2, 2, 30, '#6b4a2b', 9, 0, 0, 0, 0, Math.PI / 2, 8); wp.ell(6, 6, 6, '#ffe066', 28, 0, 0, 0, 0, 0, 12); break;
    case 'hoamieu': wp.cap(7, 18, '#b3263c', 8, 0, 0, 0, 0, Math.PI / 2); wp.cyl(7.4, 7.4, 4, D.accent, 4, 0, 0, 0, 0, Math.PI / 2, 12); wp.cyl(9, 9, 8, '#3a2a2a', 26, 0, 0, 0, 0, Math.PI / 2, 12); wp.ell(3.5, 3.5, 3.5, '#ff8a3c', 31, 0, 0, 0, 0, 0, 8); break;
  }
  wp.ell(4, 4, 4, skin, 4, -4, 2, 0, 0, 0, 10);
  // head: a sphere (rough rock for Thạch Giáp) with the face texture
  const stone = key === 'thachgiap' && !tribe;
  const head = stone ? new T.SphereGeometry(17, 12, 9) : new T.SphereGeometry(16, 36, 26);
  if (stone) { const p = head.attributes.position; for (let i = 0; i < p.count; i++) { const s = 1 + (((i * 2654435761) >>> 0) % 100) / 100 * 0.12 - 0.06; p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.94, p.getZ(i) * s); } head.computeVertexNormals(); }
  const parts = {
    foot: mergeParts(foot.list), body: mergeParts(body.list), hair: mergeParts(hair.list), weapon: mergeParts(wp.list), head,
    face: faceTexture(key, tribe, false), blink: faceTexture(key, tribe, true), big: key === 'thachgiap' ? 1.12 : 1,
  };
  HG.set(id, parts);
  return parts;
}
// a soft shadow and the team ring on the ground under each hero
const ringTex = {};
function groundDecal(team) {
  if (ringTex[team]) return ringTex[team];
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 50); gr.addColorStop(0, 'rgba(30,20,40,0.42)'); gr.addColorStop(1, 'rgba(30,20,40,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(64, 64, 50, 0, 7); g.fill();
  if (team >= 0) { g.strokeStyle = TEAM_COL[team]; g.lineWidth = 7; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.stroke(); }
  return (ringTex[team] = new R3.T.CanvasTexture(c));
}
function heroView(h, tribe) {
  const sig = h.key + '|' + h.team + '|' + (tribe ? 1 : 0);
  let v = R3.views.get(h.id);
  if (v && v.sig === sig) return v;
  if (v) r3DropView(h.id);
  v = heroRig(h.key, h.team, tribe, h.face);
  R3.scene.add(v.root);
  R3.views.set(h.id, v);
  return v;
}
function heroRig(key, team, tribe, face) {
  const T = R3.T, sig = key + '|' + team + '|' + (tribe ? 1 : 0);
  const P = heroParts(key, team, tribe);
  const mat = r3Mat({ vertexColors: true });
  const headMat = r3Mat({ map: P.face });
  const D = HEROES[key], ink = inkMat(tribe ? '#3a1c14' : '#' + new T.Color(D.dark).lerp(new T.Color('#24162c'), 0.62).getHexString());
  const mesh = (geo, m) => { const o = new T.Group(), a = new T.Mesh(geo, m), b = new T.Mesh(geo, ink); o.add(b, a); return o; };
  const root = new T.Group(), turn = new T.Group(), upper = new T.Group(), headG = new T.Group();
  const footL = mesh(P.foot, mat), footR = mesh(P.foot, mat);
  const bodyM = mesh(P.body, mat), hairM = mesh(P.hair, mat), headM = mesh(P.head, headMat);
  headG.add(headM, hairM); headG.position.y = 34;
  upper.add(bodyM, headG);
  turn.add(footL, footR, upper);
  const weapon = mesh(P.weapon, mat);
  const decal = new T.Mesh(new T.PlaneGeometry(48, 48), new T.MeshBasicMaterial({ map: groundDecal(team), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  decal.rotation.x = -Math.PI / 2; decal.position.y = 0.6; decal.renderOrder = 2;
  root.add(decal, turn, weapon);
  root.scale.setScalar(P.big);
  return { sig, root, turn, upper, headG, footL, footR, weapon, decal, mat, headMat, P, turnA: face * 0.6, blinkT: 2 + Math.random() * 3, ice: null, stars: null };
}
function r3DropView(id) {
  const v = R3.views.get(id); if (!v) return;
  R3.scene.remove(v.root); v.mat.dispose(); v.headMat.dispose(); v.decal.geometry.dispose(); v.decal.material.dispose();
  if (v.geos) for (const g of v.geos) g.dispose();
  R3.views.delete(id);
}
function r3Hero(h, t, dt, isActor, face, ang, tribe) {
  const a = artHero(h.key, tribe);
  if (a) artPose(artView(h, tribe, a), h, t, dt, face, ang); else r3Pose(heroView(h, tribe), h, t, dt, face, ang);
}
function r3Pose(v, h, t, dt, face, ang) {
  const T = R3.T;
  v.root.visible = true;
  v.root.position.set(h.x, -h.y, HERO_Z);
  const tt = t + h.id;
  // squash and stretch: stretched while flying fast, squashed on landing, breathing when idle
  const vy = v.py === undefined || dt <= 0 ? 0 : (h.y - v.py) / dt;
  v.py = h.y;
  v.vy = (v.vy || 0) + (vy - (v.vy || 0)) * Math.min(1, dt * 14);
  const air = h.grounded === false && !h.flying;
  if (air) v.airT = (v.airT || 0) + dt; else { if ((v.airT || 0) > 0.14) v.land = 1; v.airT = 0; }
  v.land = Math.max(0, (v.land || 0) - dt * 4.5);
  v.recoil = Math.max(0, (v.recoil || 0) - dt * 5);
  const st = air ? Math.min(0.13, Math.abs(v.vy) / 6000) : 0;
  const lq = Math.sin(v.land * Math.PI) * 0.2 * v.land;
  const br = h.walking ? 0 : Math.sin(tt * 2.6) * 0.02;
  const sy = 1 + st - lq + br, sxz = 1 - st * 0.5 + lq * 0.6 - br * 0.5;
  const walk = h.walking ? Math.sin(tt * 14) : 0;
  const bob = h.walking ? Math.abs(walk) * 2.4 : Math.sin(tt * 2.4 + h.x * 0.01) * 1.1;
  // turn towards the side the hero faces (3/4 view); mirror while passing the front
  const want = face * 0.6;
  v.turnA += (want - v.turnA) * Math.min(1, dt * 12);
  const side = v.turnA >= 0 ? 1 : -1;
  v.turn.scale.set(side * sxz, sy, sxz); v.turn.rotation.y = v.turnA;
  v.footL.position.set(-6 + walk * 3, 0, 0); v.footR.position.set(6 - walk * 3, 0, 0);
  v.upper.position.y = bob;
  v.headG.rotation.z = Math.sin(tt * 1.7) * 0.04;
  // the weapon follows the aim exactly, in the play plane
  const a = ang * Math.PI / 180;
  const rc = v.recoil * v.recoil * 7;
  v.weapon.position.set(face * 4 - Math.cos(a) * face * rc, (16 + bob) * sy + Math.sin(a) * rc * -1, 12);
  v.weapon.scale.x = face; v.weapon.rotation.z = face * (a + v.recoil * 0.22);
  v.upper.rotation.z = v.recoil * 0.12; // inside the mirrored group: always leans away from the shot
  // blink now and then
  v.blinkT -= dt;
  const closed = v.blinkT < 0;
  if (closed && v.blinkT < -0.13) v.blinkT = 2 + Math.random() * 3.5;
  const map = closed ? v.P.blink : v.P.face;
  if (v.headMat.map !== map) { v.headMat.map = map; v.headMat.needsUpdate = true; }
  // hurt flash, charge glow
  const hurt = h.hurtT > 0;
  v.mat.emissive.setRGB(hurt ? 0.45 : h.charge > 0 ? 0.04 + h.charge * 0.0012 : 0, hurt ? 0.05 : h.charge > 0 ? 0.03 : 0, hurt ? 0.08 : 0);
  v.headMat.emissive.copy(v.mat.emissive);
  v.decal.visible = h.grounded !== false && !h.flying;
  r3Status(v, h, t, 1);
}
// frozen: an ice block; stunned: stars over the head (k: model height / 60)
function r3Status(v, h, t, k) {
  const T = R3.T;
  const frozen = !!(h.status && h.status.frozen) || h.frozenTurn, stunned = !!(h.status && h.status.stun) || h.stunnedTurn;
  if (frozen && !v.ice) {
    v.ice = new T.Mesh(new T.IcosahedronGeometry(1, 1), new T.MeshToonMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.5, gradientMap: R3.toonRamp, emissive: 0x2a5068 }));
    v.ice.scale.set(24 * k, 34 * k, 20); v.ice.position.y = 28 * k; v.root.add(v.ice);
  }
  if (v.ice) v.ice.visible = frozen;
  if (stunned && !v.stars) {
    v.stars = new T.Group();
    for (let k = 0; k < 3; k++) { const s = new T.Mesh(new T.OctahedronGeometry(4, 0), new T.MeshBasicMaterial({ color: k % 2 ? 0xfff3a0 : 0xffd43b })); s.scale.y = 1.4; v.stars.add(s); }
    v.stars.position.y = 60 * k; v.root.add(v.stars);
  }
  if (v.stars) {
    v.stars.visible = stunned;
    if (stunned) v.stars.children.forEach((s, k) => { const aa = t * 5 + k * 2.09; s.position.set(Math.cos(aa) * 16, Math.sin(aa * 2) * 2, Math.sin(aa) * 10); s.rotation.y = t * 4; });
  }
}

/* ---------- frame ---------- */
// cx, cy: world point at the screen centre; z: device px per world px
function r3Render(S, t, dt, cx, cy, z, vw, vh, local, actorId, aimState) {
  const T = R3.T;
  r3Size(vw, vh);
  if (R3.gen !== TERR.gen || R3.canvasRef !== TERR.canvas) {
    R3.gen = TERR.gen; R3.canvasRef = TERR.canvas;
    for (const id of [...R3.views.keys()]) r3DropView(id);
    r3FacePalette(); r3EdgesRebuild(true); r3Decor(true); R3.faceVer = TERR.version;
  } else {
    if (R3.dirty.size || R3.rect) r3EdgesRebuild(false);
    R3.faceVer = TERR.version;
    if (R3.decorSrc !== TERR.decor || R3.logo !== LOGO.mask || R3.artN !== ART.n) { R3.artN = ART.n; r3Decor(false); }
  }
  R3.decorSrc = TERR.decor; R3.logo = LOGO.mask;
  // heroes
  const tribe = TERR.map === SPECIAL_MAP, seen = new Set();
  for (const h of S.heroes) {
    if (h.dead) continue;
    seen.add(h.id);
    const isActor = h.id === actorId && aimState;
    const mine = local && h.id === local.id && isActor;
    r3Hero(h, t, dt, isActor, mine ? Ctl.face : h.face, mine ? Ctl.ang : h.ang, tribe);
  }
  for (const [id, v] of R3.views) if (!seen.has(id)) v.root.visible = false;
  r3Projs(S.projs, t);
  // camera: straight at the play plane, from above (off-centre frustum keeps z = 0 mapped exactly as in 2D)
  const hw = vw / 2 / z, hh = vh / 2 / z, zc = hh * 2.6, yo = hh * (R3.tilt ?? 1.3), n = 20;
  const cam = R3.camera;
  if (!R3.faceMat.uniforms.uDet.value && ART.m && ART.m.tex && ART.m.tex.detail) { // painted terrain detail, once it has loaded
    const td = artTex('tex_detail');
    if (td) { td.wrapS = td.wrapT = T.RepeatWrapping; td.needsUpdate = true; R3.faceMat.uniforms.tDet.value = td; R3.faceMat.uniforms.uDet.value = 0.55; }
  }
  R3.inkU.uViewH.value = vh; R3.inkU.uInkPx.value = clamp(1.1 + z * 0.8, 1.5, 4.2);
  cam.position.set(cx, -cy + yo, zc); cam.updateMatrixWorld();
  cam.projectionMatrix.makePerspective(-hw * n / zc, hw * n / zc, (hh - yo) * n / zc, (-hh - yo) * n / zc, n, zc + 2000);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  R3.renderer.render(R3.scene, cam);
  R3.lift = yo * -DECOR_Z / (zc - DECOR_Z); // how much higher decor looks than the play plane
}

/* ---------- portraits: the same models, rendered on a small second renderer ---------- */
const RP = { r: null };
function r3PortraitInit() {
  const T = R3.T, c = document.createElement('canvas');
  const r = new T.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.outputColorSpace = T.LinearSRGBColorSpace; r.setClearColor(0, 0); r.setPixelRatio(1);
  const scene = new T.Scene();
  scene.add(new T.HemisphereLight(0xfff6ea, 0x8a86a8, 1.8));
  const sun = new T.DirectionalLight(0xffffff, 2.2); sun.position.set(-0.6, 0.9, 1); scene.add(sun);
  Object.assign(RP, { r, c, scene, cam: new T.PerspectiveCamera(24, 1, 10, 2000), rigs: {} });
}
// draws hero `key` into the 2D canvas g (size px square); full body like the 2D portraits
function r3PortraitDraw(g, size, key, team, tribe, t, ang = 30, charge = 0) {
  if (!R3.ready) return false;
  if (artPortrait(g, size, key, tribe, t, ang)) return 'art';
  if (!RP.r) r3PortraitInit();
  const id = key + '|' + team + '|' + (tribe ? 1 : 0);
  let v = RP.rigs[id];
  if (!v) { v = RP.rigs[id] = heroRig(key, team, tribe, 1); v.decal.visible = false; RP.scene.add(v.root); }
  for (const k in RP.rigs) RP.rigs[k].root.visible = RP.rigs[k] === v;
  r3Pose(v, { x: 0, y: 0, id: 0, walking: false, hurtT: 0, charge, status: {}, grounded: false, flying: false }, t, 1, 1, ang);
  v.decal.visible = false; v.root.position.set(0, 0, 0);
  if (RP.c.width !== size) { RP.r.setSize(size, size, false); }
  const top = tribe ? 96 : 76, mid = top / 2 - 2;
  RP.cam.position.set(18, mid + 6, top * 2.55); RP.cam.lookAt(0, mid, 0); RP.cam.updateMatrixWorld();
  R3.inkU.uViewH.value = size; R3.inkU.uInkPx.value = Math.max(1.4, size / 120);
  RP.r.render(RP.scene, RP.cam);
  g.drawImage(RP.c, 0, 0, size, size);
  return true;
}

/* ---------- shells: a 3D body per projectile (the glow and trails stay on the 2D overlay) ---------- */
const P3_KEYS = new Set(['cannon', 'barrage', 'cluster', 'drill', 'hammer', 'bouncer', 'mound', 'gravity', 'heal', 'water', 'portal', 'bolt', 'ice', 'fire', 'sticky', 'marker']);
const P3G = {};
function projParts(key) {
  if (P3G[key]) return P3G[key];
  const T = R3.T, L = partList(), col = (SHELLS[key] || SHELLS.cannon).col;
  let glowy = false;
  switch (key) {
    case 'cannon': case 'barrage': L.ell(9, 9, 9, '#3a3a4a', 0, 0, 0); L.ell(3, 2, 2, '#9a9ab0', -3, 4, 6); L.cyl(1.2, 1.2, 7, '#a07a4a', -10, 0, 0, 0, 0, Math.PI / 2, 6); break;
    case 'cluster': for (let i = 0; i < 3; i++) { const a = i * 2.094; L.ell(5, 5, 5, '#ffd84a', Math.cos(a) * 6, Math.sin(a) * 6, 0); } break;
    case 'drill': L.cone(6.5, 17, '#b8c0d0', 7, 0, 0, 0, 0, -Math.PI / 2, 12); L.cyl(5.8, 5.8, 8, '#e07a2e', -5, 0, 0, 0, 0, Math.PI / 2, 12); break;
    case 'hammer': L.box(14, 18, 12, '#d9cbb0', -7, 0, 0); L.cyl(2, 2, 22, '#8b5a35', 9, 0, 0, 0, 0, Math.PI / 2, 8); L.ell(5, 2, 5, '#7fcf6a', -7, 9, 0); break;
    case 'bouncer': L.add(new T.DodecahedronGeometry(10, 0), '#9c8f7e'); break;
    case 'mound': L.ell(9, 8, 9, '#a0703f', 0, 0, 0); L.ell(6, 3, 6, '#7cc576', 0, 6, 0); break;
    case 'gravity': L.ell(8, 8, 8, '#4a2f7a', 0, 0, 0); L.tor(13, 1.6, '#c9a8ff', 0, 0, 0, 1.2, 0, 0); glowy = true; break;
    case 'heal': L.ell(8, 8, 8, '#5fdc8f', 0, 0, 0); L.box(3, 10, 3, '#ffffff', 0, 0, 7.5); L.box(10, 3, 3, '#ffffff', 0, 0, 7.5); glowy = true; break;
    case 'water': L.ell(9, 10, 9, '#5ab8ff', 0, 0, 0); L.ell(3, 3, 2, '#e6f6ff', -3, 4, 7); break;
    case 'portal': L.tor(9, 3, '#b07cff', 0, 0, 0); L.ell(5, 5, 2, '#f0e0ff', 0, 0, 0); glowy = true; break;
    case 'bolt': L.add(new T.OctahedronGeometry(9, 0), '#ffe066', L.M(0, 0, 0, 1, 1.4, 1)); glowy = true; break;
    case 'ice': L.add(new T.IcosahedronGeometry(9, 0), '#bfeaff', L.M(0, 0, 0, 1.2, 0.9, 0.9)); break;
    case 'fire': L.ell(8, 8, 8, '#ff8a3c', 0, 0, 0); L.ell(5, 5, 5, '#ffe08a', 2, 1, 4); glowy = true; break;
    case 'sticky': L.ell(9, 7, 8, '#7ccf4a', 0, 0, 0); L.ell(3, 3, 3, '#c8f5a8', -3, 3, 6); break;
    case 'marker': L.cone(6, 16, '#ff5c5c', 0, 0, 0, 0, 0, -Math.PI / 2, 10); L.ell(4, 4, 4, '#ffffff', -8, 0, 0); break;
  }
  const geo = mergeParts(L.list);
  const mat = r3Mat({ vertexColors: true });
  if (glowy) mat.emissive = new T.Color(col).multiplyScalar(0.35);
  return (P3G[key] = { geo, mat, spin: key === 'cluster' || key === 'hammer' || key === 'bouncer' || key === 'portal' || key === 'ice' || key === 'bolt', dir: key === 'drill' || key === 'cannon' || key === 'barrage' || key === 'marker' });
}
function r3Projs(projs, t) {
  const T = R3.T, live = new Set();
  R3.projs = R3.projs || new Map();
  for (const p of projs) {
    const key = projKey(p);
    if (!P3_KEYS.has(key) || p.id === undefined) continue;
    live.add(p.id);
    let v = R3.projs.get(p.id);
    if (!v || v.key !== key) {
      if (v) R3.scene.remove(v.o);
      const P = projParts(key), o = new T.Group();
      o.add(new T.Mesh(P.geo, R3.inkMat), new T.Mesh(P.geo, P.mat));
      R3.scene.add(o); v = { o, key, P }; R3.projs.set(p.id, v);
      if (R3.projsSeen) { // a new shell: kick the hero who fired it
        let best = null, bd = 4900;
        for (const hv of R3.views.values()) { if (!hv.root.visible) continue; const dx = hv.root.position.x - p.x, dy = -hv.root.position.y - 20 - p.y, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = hv; } }
        if (best) best.recoil = 1;
      }
    }
    v.o.position.set(p.x, -p.y, -6);
    if (v.P.dir) v.o.rotation.set(0, 0, -Math.atan2(p.vy, p.vx));
    else if (v.P.spin) v.o.rotation.set(t * 3, t * 7 + p.id, 0);
    v.o.visible = !p.inGround;
  }
  for (const [id, v] of R3.projs) if (!live.has(id)) { R3.scene.remove(v.o); R3.projs.delete(id); }
  R3.projsSeen = true;
}

/* ---------- painted heroes (AI renders, cut out with an ink outline) ----------
   art/art.json lists each sprite: heroes[id] = { w, h, hand: [fx, fy] (where the weapon is held, as a fraction of the
   image), scale }, weapons[id] = { w, h, grip: [fx, fy], len (world px) }; id = hero key, + '_t' for the tribe outfit.
   The sprite stands in the 3D scene as a flat card; it breathes, waddles, squashes and stretches, and the weapon card
   turns with the aim. Until the art has loaded (or if it is missing) the modelled heroes are used. */
const ART = { state: 0, m: null, img: {}, tex: {}, n: 0 };
function artLoad() {
  if (ART.state) return;
  ART.state = 1;
  fetch('art/art.json?v=' + (window.PDM_BUILD || '')).then((r) => r.json()).then((m) => { ART.m = m; ART.state = 2; }).catch(() => { ART.state = 3; });
}
function artImg(name) {
  let im = ART.img[name];
  if (!im) { im = ART.img[name] = new Image(); im.decoding = 'async'; im.onload = () => { ART.n++; }; im.src = 'art/' + name + '.webp?v=' + (window.PDM_BUILD || ''); }
  return im.complete && im.naturalWidth ? im : null;
}
function artTex(name) {
  let t = ART.tex[name];
  if (t) return t;
  const im = artImg(name); if (!im) return null;
  t = ART.tex[name] = new R3.T.Texture(im);
  t.minFilter = R3.T.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
function artHero(key, tribe) {
  if (!ART.m) { artLoad(); return null; }
  const id = key + (tribe ? '_t' : ''), A = ART.m.heroes && ART.m.heroes[id], Wp = ART.m.weapons && ART.m.weapons[id];
  if (!A || !Wp) return null;
  const tb = artTex('hero_' + id), tw = artTex('wpn_' + id);
  return tb && tw ? { id, A, Wp, tb, tw } : null;
}
function artMat(tex) {
  const msaa = R3.renderer.getContext().getContextAttributes().antialias;
  return new R3.T.MeshBasicMaterial({ map: tex, side: R3.T.DoubleSide, alphaToCoverage: msaa, alphaTest: msaa ? 0.04 : 0.5 });
}
function artView(h, tribe, a) {
  const sig = h.key + '|' + h.team + '|' + (tribe ? 1 : 0) + '|art';
  let v = R3.views.get(h.id);
  if (v && v.sig === sig) return v;
  if (v) r3DropView(h.id);
  v = artRig(h.key, h.team, a);
  v.sig = sig;
  R3.scene.add(v.root);
  R3.views.set(h.id, v);
  return v;
}
function artRig(key, team, a) {
  const T = R3.T, A = a.A, Wp = a.Wp;
  const hH = 72 * (A.scale || 1), hW = hH * A.w / A.h, foot = A.foot || 0.03;
  const mat = artMat(a.tb), wmat = artMat(a.tw);
  const bg = new T.PlaneGeometry(hW, hH); bg.translate(0, hH / 2 - hH * foot, 0);
  const wl = Wp.len, wh = wl * Wp.h / Wp.w;
  const wg = new T.PlaneGeometry(wl, wh); wg.translate((0.5 - Wp.grip[0]) * wl, (Wp.grip[1] - 0.5) * wh, 0);
  const root = new T.Group(), turn = new T.Group(), body = new T.Mesh(bg, mat), weapon = new T.Mesh(wg, wmat);
  turn.add(body);
  const decal = new T.Mesh(new T.PlaneGeometry(48, 48), new T.MeshBasicMaterial({ map: groundDecal(team), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  decal.rotation.x = -Math.PI / 2; decal.position.y = 0.6; decal.renderOrder = 2;
  root.add(decal, turn, weapon);
  return { art: true, root, turn, body, weapon, decal, mat, headMat: wmat, geos: [bg, wg], hW, hH, hand: [(A.hand[0] - 0.5) * hW, (1 - A.hand[1] - foot) * hH], faceS: 1, ice: null, stars: null };
}
function artPose(v, h, t, dt, face, ang) {
  v.root.visible = true;
  v.root.position.set(h.x, -h.y, HERO_Z + 2);
  const tt = t + h.id;
  const vy = v.py === undefined || dt <= 0 ? 0 : (h.y - v.py) / dt;
  v.py = h.y;
  v.vy = (v.vy || 0) + (vy - (v.vy || 0)) * Math.min(1, dt * 14);
  const air = h.grounded === false && !h.flying;
  if (air) v.airT = (v.airT || 0) + dt; else { if ((v.airT || 0) > 0.14) v.land = 1; v.airT = 0; }
  v.land = Math.max(0, (v.land || 0) - dt * 4.5);
  v.recoil = Math.max(0, (v.recoil || 0) - dt * 5);
  const st = air ? Math.min(0.12, Math.abs(v.vy) / 6000) : 0;
  const lq = Math.sin(v.land * Math.PI) * 0.2 * v.land;
  const br = h.walking ? 0 : Math.sin(tt * 2.6) * 0.022;
  const sy = 1 + st - lq + br, sx = 1 - st * 0.5 + lq * 0.6 - br * 0.6;
  const walk = h.walking ? Math.sin(tt * 14) : 0, bob = h.walking ? Math.abs(walk) * 2.6 : 0;
  // turning round: the card flips through edge-on, quickly
  v.faceS += (face - v.faceS) * Math.min(1, dt * 16);
  const fs = Math.abs(v.faceS) < 0.06 ? 0.06 * (v.faceS < 0 ? -1 : 1) : v.faceS;
  v.turn.scale.set(fs * sx, sy, 1);
  v.turn.position.y = bob;
  v.turn.rotation.z = walk * 0.07 + Math.sin(tt * 1.7) * 0.015 + face * v.recoil * 0.1;
  const a = ang * Math.PI / 180, rc = v.recoil * v.recoil * 7;
  v.weapon.position.set(face * v.hand[0] * sx - Math.cos(a) * face * rc, v.hand[1] * sy + bob - Math.sin(a) * rc, 3);
  v.weapon.scale.set(face, 1, 1); v.weapon.rotation.z = face * (a + v.recoil * 0.22);
  const hurt = h.hurtT > 0, ch = h.charge > 0 ? Math.min(1, h.charge / 100) : 0;
  v.mat.color.setRGB(hurt ? 1.5 : 1 + ch * 0.25, hurt ? 0.72 : 1 + ch * 0.1, hurt ? 0.72 : 1);
  v.headMat.color.copy(v.mat.color);
  v.decal.visible = h.grounded !== false && !h.flying;
  r3Status(v, h, t, v.hH / 60);
}
// the painted hero for menus and the HUD (2D canvas), weapon at the given angle
function artPortrait(g, size, key, tribe, t, ang) {
  if (!ART.m) { artLoad(); return false; }
  const id = key + (tribe ? '_t' : ''), A = ART.m.heroes && ART.m.heroes[id], Wp = ART.m.weapons && ART.m.weapons[id];
  if (!A || !Wp) return false;
  const ib = artImg('hero_' + id), iw = artImg('wpn_' + id);
  if (!ib || !iw) return false;
  const s = size * 0.9 / A.h, bw = A.w * s, bh = A.h * s, x0 = (size - bw) / 2 - size * 0.05, y0 = size * 0.98 - bh;
  const br = Math.sin(t * 2.6) * 0.02;
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  g.translate(size / 2, size * 0.98); g.scale(1 - br * 0.6, 1 + br); g.translate(-size / 2, -size * 0.98);
  g.drawImage(ib, x0, y0, bw, bh);
  const wl = Wp.len / (72 * (A.scale || 1)) * bh, wh = wl * Wp.h / Wp.w;
  g.translate(x0 + A.hand[0] * bw, y0 + A.hand[1] * bh); g.rotate(-ang * Math.PI / 180);
  g.drawImage(iw, -Wp.grip[0] * wl, -Wp.grip[1] * wh, wl, wh);
  g.restore();
  return true;
}
