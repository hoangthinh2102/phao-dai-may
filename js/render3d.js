'use strict';
/* ===== Pháo Đài Mây — 3D view (Three.js) =====
   The match itself stays 2D (sim, terrain grid, network); this draws the same world in 3D:
   - islands are slabs: the painted terrain is the front face, and its smoothed outline is extruded backwards into
     walls, so craters become real 3D holes. The walkable top gets a rounded lip (grass / sand / snow / ash per map)
     with instanced tufts and pebbles, walls get strata and occlusion, crater rims are charred, rocks hang below.
     Only the chunks an explosion touched are rebuilt.
   - one warm key light casts soft shadows (heroes, decor, shells, the slabs) with a tight frustum around the view,
     a hemisphere fill is tinted per map, heroes get a rim light so they pop from the sky.
   - decor (trees, tents, the gate) is painted into a few cards standing on the slabs, a little behind the heroes.
   - heroes are chibi 3D models built from primitives: toon shading, ink outlines, a painted anime face with
     expressions (blink, aim, charge, hurt, KO, happy, surprised), and a small animation set.
   - the water (or lava) is a 3D surface with waves, foam where it meets the islands and their reflection.
   The camera looks straight at the play plane (z = 0) from slightly above, with an off-centre frustum, so that plane
   maps to the screen exactly as in 2D: everything drawn on the 2D overlay (shells, particles, aim, labels) still lines up. */

const THREE_URLS = ['https://unpkg.com/three@0.169.0/build/three.module.min.js', 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js'];
// heroes are drawn this much bigger than the old chibi (feet stay on the same ground point). The model is about
// 54 units from the feet to the top of the head (crests and hats up to ~64), so the head top is near h.y - 54 * HERO_VIS.
const HERO_VIS = 1.4;
const R3 = { T: null, ready: false, loading: false, failed: false, renderer: null, scene: null, camera: null, views: new Map(), gen: -1, q: 2, k: 1, water3d: false };
const SLAB_D = 120;    // island depth (world px)
const HERO_Z = -18;    // heroes walk this far back on the top of the islands
const DECOR_Z = -52;   // decor stands behind them
const CH = 32;         // terrain chunk size in cells
const NCX = Math.ceil(TW / CH), NCY = Math.ceil(TH / CH);
const isTouch = () => typeof TOUCHUI !== 'undefined' && TOUCHUI;

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

/* per-map light: hemisphere sky/ground, key light colour and side (+1: from the right, where the painted sun is),
   rim colour on the heroes, tint of the painted front face */
const LIT = {
  tho: { sky: 0xffe6d2, gnd: 0x7a4c7e, hemi: 1.26, sun: 0xffdcb0, sunI: 2.92, side: 1, rim: 0xffcf9a, face: [1.0, 0.97, 0.95] },
  may: { sky: 0xf2f6ff, gnd: 0x7c84b4, hemi: 1.30, sun: 0xfff1d8, sunI: 2.80, side: 1, rim: 0xfff4dc, face: [1.0, 1.0, 1.0] },
  sa: { sky: 0xffe8d0, gnd: 0x9a6276, hemi: 1.22, sun: 0xffd6a0, sunI: 2.98, side: 1, rim: 0xffc890, face: [1.0, 0.97, 0.93] },
  bang: { sky: 0xe4eeff, gnd: 0x4e5c9c, hemi: 1.37, sun: 0xf2f7ff, sunI: 2.48, side: -1, rim: 0xc8e2ff, face: [0.96, 0.98, 1.0] },
  nui: { sky: 0xffc4ac, gnd: 0x9a3018, hemi: 1.22, sun: 0xffb486, sunI: 2.73, side: -1, rim: 0xff9a56, face: [1.0, 0.94, 0.9] },
  phe: { sky: 0xfff0f6, gnd: 0x7a72b8, hemi: 1.30, sun: 0xfff0e2, sunI: 2.73, side: 1, rim: 0xffe2f2, face: [1.0, 0.99, 1.0] },
};

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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  Object.assign(R3, { renderer, c3, cf, ctxF: cf.getContext('2d'), scene: new T.Scene(), camera: new T.PerspectiveCamera(30, 1, 10, 9000) });
  R3.q = isTouch() ? 1 : 2;
  // light: a hemisphere fill and one warm key light with soft shadows (tight frustum fitted to the view every frame)
  R3.hemi = new T.HemisphereLight(0xfff6ea, 0x8a86a8, 1.8); R3.scene.add(R3.hemi);
  const sun = R3.sun = new T.DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.9; sun.shadow.radius = 2.6;
  R3.scene.add(sun); R3.scene.add(sun.target);
  R3.sunDir = new T.Vector3(0.5, 1, 0.75).normalize();
  R3.v1 = new T.Vector3(); R3.v2 = new T.Vector3(); R3.v3 = new T.Vector3();
  r3ShadowSize();
  const g = new Uint8Array([150, 208, 255]);
  R3.toonRamp = new T.DataTexture(g, 3, 1, T.RedFormat); R3.toonRamp.minFilter = R3.toonRamp.magFilter = T.NearestFilter; R3.toonRamp.needsUpdate = true;
  R3.rimU = { uRim: { value: new T.Color(0xfff2dc) }, uSunV: { value: R3.sunDir } };
  // ink outline: back faces pushed out along the normal, by about the same number of screen pixels at any zoom
  R3.inkU = { uInkPx: { value: 2 }, uViewH: { value: 720 } };
  R3.inkMats = {};
  R3.inkMat = inkMat('#2b1d2e');
  R3.timeU = { value: 0 };
  r3TerrainInit();
  r3WaterInit();
}
function r3ShadowSize() {
  const sun = R3.sun, n = R3.q >= 2 ? 2048 : 1024;
  sun.castShadow = R3.q > 0;
  if (sun.shadow.mapSize.x !== n) { sun.shadow.mapSize.set(n, n); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
}
/* the look of the current map: lights, rim, face tint */
function r3MapLook() {
  const L = LIT[TERR.map] || LIT.may;
  R3.hemi.color.setHex(L.sky); R3.hemi.groundColor.setHex(L.gnd); R3.hemi.intensity = L.hemi;
  R3.sun.color.setHex(L.sun); R3.sun.intensity = L.sunI;
  R3.sunDir.set(1.0 * L.side, 1, 0.38).normalize();
  R3.rimU.uRim.value.setHex(L.rim);
  R3.faceMat.uniforms.uLit.value.set(L.face[0], L.face[1], L.face[2]);
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
// toon shading plus a rim light (tinted per map) and a small hard highlight, like a glossy vinyl toy
function toonGloss(sh) {
  Object.assign(sh.uniforms, R3.rimU);
  sh.fragmentShader = 'uniform vec3 uRim, uSunV;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `{
  vec3 vv = normalize(vViewPosition);
  float ndv = max(dot(normal, vv), 0.0);
  float rim = smoothstep(0.52, 0.86, 1.0 - ndv) * (0.35 + 0.65 * clamp(normal.y + 0.55, 0.0, 1.0));
  float spec = smoothstep(0.935, 0.965, dot(normal, normalize(uSunV + vv)));
  outgoingLight += uRim * rim * 0.42 + vec3(1.0, 0.97, 0.92) * spec * 0.2;
}
#include <opaque_fragment>`);
}
/* ---------- canvases, resolution, quality ---------- */
function r3Sync(on) {
  if (!R3.ready) return;
  if (!on) R3.water3d = false;
  if (R3.c3.hidden === !on) return;
  R3.c3.hidden = !on; R3.cf.hidden = !on;
  if (!on) { R3.ctxF.setTransform(1, 0, 0, 1, 0, 0); R3.ctxF.clearRect(0, 0, R3.cf.width, R3.cf.height); }
}
// w, h: device pixels of the 2D canvases. The 3D canvas renders at most 1.5 (desktop) / 1.25 (phone) px per CSS px,
// less at lower quality; CSS stretches it to the full size.
function r3Size(w, h) {
  if (R3.cf.width !== w || R3.cf.height !== h) { R3.cf.width = w; R3.cf.height = h; }
  const css = typeof cssW !== 'undefined' && cssW > 0 ? cssW : window.innerWidth;
  const dprNow = w / css, cap = (isTouch() ? 1.25 : 1.5) * (R3.q >= 2 ? 1 : R3.q === 1 ? 0.9 : 0.78);
  const k = Math.min(1, cap / Math.max(0.5, dprNow));
  const iw = Math.max(2, Math.round(w * k)), ih = Math.max(2, Math.round(h * k));
  R3.k = iw / w;
  if (R3.w !== iw || R3.h !== ih) { R3.w = iw; R3.h = ih; R3.renderer.setSize(iw, ih, false); }
}
// step down (never up) when frames are slow: 2 = full shadows, 1 = smaller shadow map, 0 = no shadows
const QS = { n: 0, sum: 0, hold: 0 };
function r3Quality(dt) {
  if (document.hidden || dt <= 0 || dt > 0.25) return;
  QS.sum += dt; QS.n++;
  if (QS.n < 120) return;
  const avg = QS.sum / QS.n; QS.sum = 0; QS.n = 0;
  if (QS.hold > 0) { QS.hold--; return; }
  if (avg > 1 / 44 && R3.q > 0) { R3.q--; r3ShadowSize(); QS.hold = 2; if (R3.dress) r3DressBuild(); }
}

/* ---------- terrain: front face + extruded edges ----------
   Both follow one smooth outline: the cell grid blurred a little (F, one value per cell centre), cut at 0.5.
   - the front face is shaded on the GPU from two cell textures, so nothing on it shows the 2px cell stairs:
       col: rgb = the cell's own colour (soil keeps its strata, grass bands left out), a = F
       aux: r = smooth depth below the surface, g = material, b = scorch, a = stone blurred
     the grass bands are cut from the smooth depth, stone/soil from the blurred stone mask, colours are blended only
     between cells of the same material, and the F = 0.5 edge gets an ink line about 2 screen pixels wide
   - the walls are that same contour traced with marching squares and pushed back by SLAB_D; they are lit (Lambert)
     and receive shadows; the top of the slab gets a rounded lip along its front edge */
const FACE_VS = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FACE_FS = `uniform sampler2D tCol, tAux, tDet;
uniform float uDet;
uniform vec2 uSize;
uniform vec3 uTop, uGrass, uGrassDk, uStoneTop, uScorch, uLit;
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
  // the shadow under the 3D lip, and a painted grain (stronger on rock)
  col *= 1.0 - 0.24 * aa(d, 3.5, wd) * (1.0 - aa(d, 9.0, 1.4)) * (0.6 + 0.4 * dirt);
  float n = vnoise(p * 0.11) * 0.6 + vnoise(p * 0.37 + 7.0) * 0.4;
  col *= 1.0 + (n - 0.5) * (0.08 + 0.1 * stone) * (1.0 - uDet * 0.7);
  if (uDet > 0.0) { // painted detail: r soil, g rock, b grass (each a tile around 0.5)
    vec3 dt = texture2D(tDet, p / 96.0).rgb;
    float gb = dirt * (1.0 - aa(d, 6.0, wd));
    float dv = mix(mix(dt.r, dt.g, stone), dt.b, gb);
    col *= mix(1.0, 0.5 + dv, uDet);
  }
  // charred around craters
  float sc = clamp(ax.b * 255.0 / 80.0 / 3.0, 0.0, 1.0);
  col = mix(col, uScorch * (0.75 + 0.5 * n), sc * 0.9);
  // occlusion towards the underside: darker and cooler near a bottom edge
  float b1 = texture2D(tCol, vUv + vec2(0.0, 5.0 / uSize.y)).a, b2 = texture2D(tCol, vUv + vec2(0.0, 12.0 / uSize.y)).a;
  float under = (1.0 - smoothstep(0.2, 0.6, b1)) * 0.6 + (1.0 - smoothstep(0.2, 0.6, b2)) * 0.4;
  col *= mix(vec3(1.0), vec3(0.72, 0.74, 0.86), under * 0.85);
  col *= uLit;
  // a little calmer than the heroes
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat);
  // ink along the edge
  float e = (F - 0.5) / wF;
  col = mix(col, col * vec3(0.30, 0.27, 0.36), (1.0 - smoothstep(uInk - 0.7, uInk + 0.7, e)) * 0.92);
  gl_FragColor = vec4(col, alpha);
}`;
const R3_NOISE = `float r3hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 q) { vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(r3hash(i), r3hash(i + vec2(1, 0)), f.x), mix(r3hash(i + vec2(0, 1)), r3hash(i + vec2(1, 1)), f.x), f.y); }
`;
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
      uLit: { value: new T.Vector3(1, 1, 1) },
      uInk: { value: 1.6 }, uSat: { value: 0.88 }, uCut: { value: msaa ? 0.02 : 0.5 },
      tDet: { value: null }, uDet: { value: 0 },
    },
  });
  const pg = new T.PlaneGeometry(W, H), uv = pg.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i)); // data row 0 is the top of the world
  R3.face = new T.Mesh(pg, R3.faceMat);
  R3.face.position.set(W / 2, -H / 2, 0);
  R3.scene.add(R3.face);
  // walls, tops and lips: lit, shadowed; strata, back fade and scorch are worked out in the shader
  R3.edgeMat = new T.MeshLambertMaterial({ vertexColors: true });
  R3.edgeU = { uScorchC: { value: new T.Color() } };
  R3.edgeMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, R3.edgeU);
    sh.vertexShader = 'attribute vec2 aux;\nvarying vec2 vAux;\nvarying vec3 vWP;\nvarying vec3 vWN;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vAux = aux; vWP = (modelMatrix * vec4(position, 1.0)).xyz; vWN = normal;`);
    sh.fragmentShader = 'uniform vec3 uScorchC;\nvarying vec2 vAux;\nvarying vec3 vWP;\nvarying vec3 vWN;\n' + R3_NOISE + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec3 c = diffuseColor.rgb;
    float up = smoothstep(0.42, 0.8, vWN.y);
    float n1 = vnoise(vWP.xz * vec2(0.045, 0.07)), n2 = vnoise(vWP.xz * 0.23 + 3.0), n3 = vnoise(vWP.xy * vec2(0.03, 0.11));
    float back = smoothstep(-14.0, -${SLAB_D}.0, vWP.z);
    vec3 cTop = c * (0.9 + 0.17 * n1 + 0.1 * (n2 - 0.5)) * mix(1.03, 0.8, back);
    float sb = sin(vWP.y * 0.19 + n3 * 5.0) * 0.5 + 0.5;
    vec3 cWall = c * (0.93 + 0.12 * smoothstep(0.35, 0.95, sb) - 0.06 * smoothstep(0.85, 1.0, sb) + 0.07 * (n2 - 0.5)) * mix(1.0, 0.7, back);
    c = mix(cWall, cTop, up);
    c *= mix(vec3(1.0), vec3(0.86, 0.88, 1.0), smoothstep(-0.3, -0.8, vWN.y));
    c *= vAux.x;
    c = mix(c, uScorchC * (0.7 + 0.6 * n2), clamp(vAux.y * 1.1, 0.0, 0.92));
    diffuseColor.rgb = c;
  }`);
  };
  R3.edgeGeo = new T.BufferGeometry();
  R3.edgeCap = 0;
  R3.edges = new T.Mesh(R3.edgeGeo, R3.edgeMat);
  R3.edges.frustumCulled = false; R3.edges.castShadow = true; R3.edges.receiveShadow = true;
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
  R3.edgeU.uScorchC.value.setRGB(P.scorch[0] / 255, P.scorch[1] / 255, P.scorch[2] / 255);
}
// F = occupancy blurred with a 3x3 binomial kernel, the stone mask blurred the same way, the smooth depth (from where
// F crosses 0.5 above, per column) and each cell's colour. Depth and colour reach far below a change, so +42 rows.
function r3Field(x0, y0, x1, y1) {
  const g = TERR.g, sc = TERR.sc, F = R3.field, D = R3.faceData, A = R3.auxData, P = TERR.pal;
  x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(TW - 1, x1 + 2); y1 = Math.min(TH - 1, y1 + 42);
  const s = (x, y) => (x < 0 || y < 0 || x >= TW || y >= TH ? 0 : g[y * TW + x] ? 1 : 0);
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
// the lip profile: [up along the outward normal, z] from the top of the slab, over the front edge, down the face
const LIP = [[0, -11], [1.7, -6], [2.3, -1.5], [1.4, 2.4], [-1.2, 4.6], [-4.8, 4.6], [-7.6, 2.6], [-8.6, -0.6]];
const LIP_N = LIP.map((p, i) => {
  const a = LIP[Math.max(0, i - 1)], b = LIP[Math.min(LIP.length - 1, i + 1)];
  const ny = b[1] - a[1], nz = -(b[0] - a[0]), l = Math.hypot(ny, nz) || 1; return [ny / l, nz / l];
});
const LIP_SHADE = [1.04, 1.07, 1.08, 1.0, 0.9, 0.82, 0.76, 0.72];
const hash2 = (a, b) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smoothstep01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// lip colour: the surface colour on top (sliding darker below the edge by LIP_SHADE)
function lipCol(c, P) {
  const m = c[8];
  if (m === M_STONE) return P.stoneTop;
  if (m === M_MOUND) return P.mound;
  return [c[0] * 0.5 + P.top[0] * 0.5, c[1] * 0.5 + P.top[1] * 0.5, c[2] * 0.5 + P.top[2] * 0.5];
}
// one chunk of wall quads along the F = 0.5 contour (marching squares between cell centres), plus the lip along the
// tops, plus the spots for tufts (along the tops) and hanging rocks (under the bottoms)
function r3Chunk(ci) {
  const g = TERR.g, sc = TERR.sc, px = TERR.img.data, F = R3.field, P = TERR.pal;
  const cx0 = (ci % NCX) * CH, cy0 = ((ci / NCX) | 0) * CH, cx1 = Math.min(TW - 1, cx0 + CH), cy1 = Math.min(TH - 1, cy0 + CH);
  const segs = [];
  for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) {
    const i = y * TW + x, a = F[i], b = F[i + 1], c = F[i + TW + 1], d = F[i + TW];
    const k = (a >= 0.5 ? 8 : 0) | (b >= 0.5 ? 4 : 0) | (c >= 0.5 ? 2 : 0) | (d >= 0.5 ? 1 : 0);
    if (k === 0 || k === 15) continue;
    const X = x * CELL + 1, Y = y * CELL + 1, t = (p, q) => (0.5 - p) / (q - p);
    const Pt = { T: [X + t(a, b) * CELL, Y], R: [X + CELL, Y + t(b, c) * CELL], B: [X + t(d, c) * CELL, Y + CELL], L: [X, Y + t(a, d) * CELL] };
    const pairs = k === 5 ? [['T', 'R'], ['B', 'L']] : k === 10 ? [['T', 'L'], ['R', 'B']] : null;
    const crossed = [];
    if ((a >= 0.5) !== (b >= 0.5)) crossed.push('T'); if ((b >= 0.5) !== (c >= 0.5)) crossed.push('R');
    if ((c >= 0.5) !== (d >= 0.5)) crossed.push('B'); if ((d >= 0.5) !== (a >= 0.5)) crossed.push('L');
    for (const pr of pairs || [crossed]) segs.push(Pt[pr[0]], Pt[pr[1]]);
  }
  const ns = segs.length / 2;
  if (!ns) return null;
  const Fs = (wx, wy) => { // F, bilinear, at a world point
    const fx = clamp((wx - 1) / CELL, 0, TW - 1.001), fy = clamp((wy - 1) / CELL, 0, TH - 1.001), x = fx | 0, y = fy | 0, u = fx - x, v = fy - y, i = y * TW + x;
    return (F[i] * (1 - u) + F[i + 1] * u) * (1 - v) + (F[i + TW] * (1 - u) + F[i + TW + 1] * u) * v;
  };
  // per point (shared exactly by neighbouring quads): [r, g, b, nx, ny (world, up +), ao, scorch, up-ness, material]
  const cache = new Map();
  const shade = (wx, wy) => {
    const key = Math.round(wx * 8) * 100003 + Math.round(wy * 8);
    let c = cache.get(key); if (c) return c;
    let ox = Fs(wx - 4, wy) - Fs(wx + 4, wy), oy = Fs(wx, wy - 4) - Fs(wx, wy + 4);
    const len = Math.hypot(ox, oy) || 1; ox /= len; oy /= len;
    const up = -oy, top = up > 0.5;
    const sx = clamp(Math.floor((wx - ox * 2.5) / CELL), 0, TW - 1), sy = clamp(Math.floor((wy - oy * 2.5) / CELL), 0, TH - 1);
    let r = 0, gg = 0, bb = 0, cnt = 0, mat = g[sy * TW + sx];
    if (top) { // the walkable top: the surface colour of the columns around
      for (let k = -4; k <= 4; k++) {
        const xx = sx + k; if (xx < 0 || xx >= TW) continue;
        let yy = sy; while (yy > 0 && g[(yy - 1) * TW + xx] && sy - yy < 6) yy--;
        while (yy < TH - 1 && !g[yy * TW + xx] && yy - sy < 6) yy++;
        if (!g[yy * TW + xx]) continue;
        const w = 5 - Math.abs(k), oo = (yy * TW + xx) * 4; r += px[oo] * w; gg += px[oo + 1] * w; bb += px[oo + 2] * w; cnt += w;
        if (k === 0) mat = g[yy * TW + xx];
      }
    } else { // a wall: the solid cells right behind this point
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = sx + dx, yy = sy + dy; if (xx < 0 || yy < 0 || xx >= TW || yy >= TH || !g[yy * TW + xx]) continue;
        const oo = (yy * TW + xx) * 4; r += px[oo]; gg += px[oo + 1]; bb += px[oo + 2]; cnt++;
      }
    }
    if (!cnt) { r = gg = bb = 120; cnt = 1; }
    r /= cnt; gg /= cnt; bb /= cnt;
    // occlusion: walls darken just under the top (the lip overhangs) and on the underside
    let ao = 1;
    if (!top) {
      let d = 0, yy = sy; while (yy > 0 && g[(yy - 1) * TW + sx] && d < 10) { yy--; d++; }
      ao = up < -0.5 ? 0.82 : 0.66 + 0.34 * Math.min(1, d / 9);
    }
    let s = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = sx + dx, yy = sy + dy; if (xx >= 0 && yy >= 0 && xx < TW && yy < TH) s = Math.max(s, sc[yy * TW + xx]); }
    c = [Math.min(255, r), Math.min(255, gg), Math.min(255, bb), ox, up, Math.min(255, ao * 250), Math.min(255, s / 3 * 255), up, mat];
    cache.set(key, c); return c;
  };
  // quads: walls (1 per segment) + lips (7 per top segment)
  let nq = 0; const lipSeg = new Uint8Array(ns);
  for (let q = 0; q < ns; q++) {
    nq++;
    const A = segs[q * 2], B = segs[q * 2 + 1], ca = shade(A[0], A[1]), cb = shade(B[0], B[1]);
    if (ca[7] > 0.4 && cb[7] > 0.4 && ca[8] !== M_WOOD && cb[8] !== M_WOOD) { lipSeg[q] = 1; nq += LIP.length - 1; }
  }
  const pos = new Float32Array(nq * 12), nor = new Float32Array(nq * 12), col = new Uint8Array(nq * 12), aux = new Uint8Array(nq * 8);
  const tufts = [], rocks = [];
  let o = 0;
  const vert = (x, y, z, nx, ny, nz, c, k, ao, s) => {
    pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z;
    nor[o * 3] = nx; nor[o * 3 + 1] = ny; nor[o * 3 + 2] = nz;
    col[o * 3] = Math.min(255, c[0] * k); col[o * 3 + 1] = Math.min(255, c[1] * k); col[o * 3 + 2] = Math.min(255, c[2] * k);
    aux[o * 2] = ao; aux[o * 2 + 1] = s; o++;
  };
  const lipK = TERR.map === 'bang' ? 1.3 : TERR.map === 'nui' ? 0.7 : TERR.map === 'sa' ? 0.85 : 1;
  const lipV = (pt, c, w, gc, k) => { const p = LIP[k]; vert(pt[0] + c[3] * p[0] * w, -pt[1] + c[4] * p[0] * w, p[1] * w, c[3] * LIP_N[k][0], c[4] * LIP_N[k][0], LIP_N[k][1], gc, LIP_SHADE[k], 240, c[6]); };
  for (let q = 0; q < ns; q++) {
    let A = segs[q * 2], B = segs[q * 2 + 1];
    let ca = shade(A[0], A[1]), cb = shade(B[0], B[1]);
    // wind so the front side faces out
    if ((B[1] - A[1]) * (ca[3] + cb[3]) + (B[0] - A[0]) * (ca[4] + cb[4]) < 0) { const t = A; A = B; B = t; const u = ca; ca = cb; cb = u; }
    vert(A[0], -A[1], 0, ca[3], ca[4], 0, ca, 1, ca[5], ca[6]);
    vert(B[0], -B[1], 0, cb[3], cb[4], 0, cb, 1, cb[5], cb[6]);
    vert(B[0], -B[1], -SLAB_D, cb[3], cb[4], 0, cb, 1, cb[5], cb[6]);
    vert(A[0], -A[1], -SLAB_D, ca[3], ca[4], 0, ca, 1, ca[5], ca[6]);
    if (lipSeg[q]) {
      const wa = smoothstep01((ca[7] - 0.45) / 0.35) * lipK, wb = smoothstep01((cb[7] - 0.45) / 0.35) * lipK;
      const ga = lipCol(ca, P), gb = lipCol(cb, P);
      for (let k = 0; k < LIP.length - 1; k++) { lipV(B, cb, wb, gb, k); lipV(A, ca, wa, ga, k); lipV(A, ca, wa, ga, k + 1); lipV(B, cb, wb, gb, k + 1); }
      // tuft spots: where the segment crosses a 5px grid line
      const ia = Math.floor(A[0] / 5), ib = Math.floor(B[0] / 5);
      if (ia !== ib && ca[6] < 120) tufts.push((A[0] + B[0]) / 2, -(A[1] + B[1]) / 2, Math.max(ia, ib), (ca[7] + cb[7]) / 2, ca[8]);
    } else if (ca[7] < -0.6 && cb[7] < -0.6 && ca[8] !== M_WOOD) {
      const ia = Math.floor(A[0] / 18), ib = Math.floor(B[0] / 18);
      if (ia !== ib) rocks.push((A[0] + B[0]) / 2, -(A[1] + B[1]) / 2, Math.max(ia, ib), ca[8]);
    }
  }
  return { pos, nor, col, aux, n: nq, tufts, rocks };
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
    const at = (arr, n, norm) => { const a = new T.BufferAttribute(arr, n, norm); a.setUsage(T.DynamicDrawUsage); return a; };
    R3.edgePos = at(new Float32Array(cap * 12), 3); R3.edgeNor = at(new Float32Array(cap * 12), 3);
    R3.edgeCol = at(new Uint8Array(cap * 12), 3, true); R3.edgeAux = at(new Uint8Array(cap * 8), 2, true);
    const idx = new Uint32Array(cap * 6);
    for (let k = 0; k < cap; k++) { const v = k * 4, o = k * 6; idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3; }
    R3.edgeGeo.dispose();
    R3.edgeGeo = new T.BufferGeometry();
    R3.edgeGeo.setAttribute('position', R3.edgePos); R3.edgeGeo.setAttribute('normal', R3.edgeNor);
    R3.edgeGeo.setAttribute('color', R3.edgeCol); R3.edgeGeo.setAttribute('aux', R3.edgeAux);
    R3.edgeGeo.setIndex(new T.BufferAttribute(idx, 1));
    R3.edges.geometry = R3.edgeGeo;
  }
  let o = 0;
  for (const c of R3.chunks) if (c) { R3.edgePos.array.set(c.pos, o * 12); R3.edgeNor.array.set(c.nor, o * 12); R3.edgeCol.array.set(c.col, o * 12); R3.edgeAux.array.set(c.aux, o * 8); o += c.n; }
  for (const a of [R3.edgePos, R3.edgeNor, R3.edgeCol, R3.edgeAux]) { a.clearUpdateRanges(); a.addUpdateRange(0, o * a.itemSize * 4); a.needsUpdate = true; }
  R3.edgeGeo.setDrawRange(0, total * 6);
  r3DressBuild();
}

/* ---------- island dressing: tufts and pebbles on the tops, rocks hanging under them (instanced) ---------- */
function r3DressInit() {
  const T = R3.T, map = TERR.map;
  if (R3.dress) { for (const m of R3.dress.meshes) { R3.scene.remove(m); m.geometry.dispose(); m.material.dispose(); m.dispose(); } }
  const kind = map === 'bang' ? 'snow' : map === 'nui' ? 'ash' : map === 'sa' || map === 'tho' ? 'dry' : 'grass';
  // a tuft: a few blades fanning out, darker at the root (vertex colour), tinted per instance
  const L = partList();
  if (kind === 'snow') {
    L.ell(3.2, 1.8, 2.6, '#ffffff', 0, 0.6, 0, 0, 0, 0, 7); L.ell(2, 1.4, 1.8, '#f4fbff', 2.4, 0.4, 0.8, 0, 0, 0, 6); L.ell(1.6, 1.1, 1.5, '#ffffff', -2.2, 0.3, -0.6, 0, 0, 0, 6);
    L.add(new T.OctahedronGeometry(1.1, 0), '#bfeaff', L.M(0.8, 2.4, 0.4, 0.7, 1.8, 0.7, 0, 0, 0.3));
  } else if (kind === 'ash') {
    L.add(new T.DodecahedronGeometry(1.6, 0), '#ffffff', L.M(0, 0.8, 0, 1, 0.7, 1)); L.add(new T.DodecahedronGeometry(1.1, 0), '#cccccc', L.M(2.2, 0.5, 0.6, 1, 0.7, 1));
  } else {
    const n = kind === 'dry' ? 6 : 7, h = kind === 'dry' ? 8.5 : 7;
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) - 0.5) * (kind === 'dry' ? 1.5 : 1.2), hh = h * (0.7 + 0.3 * Math.cos(a * 1.6)) * (0.85 + (i % 3) * 0.12);
      const geo = new T.ConeGeometry(kind === 'dry' ? 0.55 : 0.85, hh, 3, 2); geo.translate(0, hh / 2, 0);
      const pz = ((i * 37) % 5 - 2) * 0.5;
      L.add(geo, '#ffffff', L.M(Math.sin(a) * 1.2, 0, pz, 1, 1, 1, pz * 0.25, 0, -a));
      const ca = geo.attributes.color.array, pa = geo.attributes.position.array;
      for (let v = 0; v < ca.length / 3; v++) { const k = 0.55 + 0.6 * clamp(pa[v * 3 + 1] / hh, 0, 1); ca[v * 3] = ca[v * 3 + 1] = ca[v * 3 + 2] = k; }
    }
  }
  const tuftGeo = mergeParts(L.list);
  const pebGeo = new T.IcosahedronGeometry(1, 0);
  const rockGeo = new T.ConeGeometry(1, 1, 6, 3); rockGeo.rotateX(Math.PI); rockGeo.translate(0, -0.5, 0);
  { const p = rockGeo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), j = 1 + (Math.sin(x * 7.1 + y * 13.3) * Math.cos(z * 9.7 - y * 5.1)) * 0.22; p.setXYZ(i, x * j, y, z * j); } rockGeo.computeVertexNormals(); }
  const swayMat = new T.MeshLambertMaterial({ vertexColors: true });
  swayMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = R3.timeU;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  { float ph = instanceMatrix[3].x * 0.031 + instanceMatrix[3].z * 0.05; transformed.x += sin(uTime * 2.1 + ph) * position.y * 0.07 + sin(uTime * 5.3 + ph * 3.0) * position.y * 0.02; }`);
  };
  const im = (geo, mat, n) => { const m = new T.InstancedMesh(geo, mat, n); m.count = 0; m.frustumCulled = false; m.receiveShadow = true; R3.scene.add(m); return m; };
  const tuft = im(tuftGeo, kind === 'ash' || kind === 'snow' ? new T.MeshLambertMaterial({ vertexColors: true, flatShading: kind === 'ash' }) : swayMat, 4000);
  const peb = im(pebGeo, new T.MeshLambertMaterial({ flatShading: true }), 1200);
  const rock = im(rockGeo, new T.MeshLambertMaterial({ flatShading: true }), 600);
  rock.receiveShadow = false;
  R3.dress = { kind, tuft, peb, rock, meshes: [tuft, peb, rock], m: new T.Matrix4(), q: new T.Quaternion(), e: new T.Euler(), p: new T.Vector3(), s: new T.Vector3(), c: new T.Color() };
}
function r3DressBuild() {
  if (!R3.dress) return;
  const D = R3.dress, P = TERR.pal, { m, q, e, p, s, c } = D, M = MAPS[TERR.map];
  const dense = R3.q >= 2 ? 1 : R3.q === 1 ? 0.75 : 0.45;
  const gcol = hex(M.grassCol || '#6fc24f');
  let nt = 0, np = 0, nr = 0;
  const put = (mesh, i, x, y, z, sx, sy, sz, ry, rz, col, k) => {
    p.set(x, y, z); e.set(0, ry, rz); q.setFromEuler(e); s.set(sx, sy, sz); m.compose(p, q, s); mesh.setMatrixAt(i, m);
    c.setRGB(col[0] / 255 * k, col[1] / 255 * k, col[2] / 255 * k); mesh.setColorAt(i, c);
  };
  const ash = [140, 124, 118], snow = [255, 255, 255];
  for (const ch of R3.chunks) {
    if (!ch) continue;
    const T_ = ch.tufts;
    for (let i = 0; i < T_.length; i += 5) {
      const x = T_[i], y = T_[i + 1], id = T_[i + 2], up = T_[i + 3], mat = T_[i + 4];
      const h1 = hash2(id, 11), h2 = hash2(id, 23), h3 = hash2(id, 37), h4 = hash2(id, 51);
      if (mat === M_STONE && D.kind !== 'snow' && h4 < 0.7) continue;
      // along the crown of the lip
      if (h1 < 0.62 * dense && nt < 4000) {
        const sz = 0.75 + h2 * 0.65, base = D.kind === 'dry' ? gcol : D.kind === 'grass' ? (h3 < 0.5 ? P.grass : P.top) : D.kind === 'snow' ? snow : ash;
        put(D.tuft, nt++, x + (h3 - 0.5) * 4, y + 1.2 * up, -2.5 - h4 * 5, sz, sz * (0.8 + h3 * 0.5), sz, h2 * 6.28, 0, base, 0.85 + h4 * 0.3);
      }
      // scattered further back on the top
      if (h3 < 0.42 * dense && nt < 4000) {
        const sz = 0.7 + h1 * 0.6, base = D.kind === 'dry' ? gcol : D.kind === 'grass' ? P.grass : D.kind === 'snow' ? snow : ash;
        put(D.tuft, nt++, x + (h1 - 0.5) * 5, y - 0.3, -16 - h2 * 96, sz, sz, sz, h4 * 6.28, 0, base, 0.8 + h2 * 0.35);
      }
      if (h4 < 0.16 * dense && np < 1200) {
        const r = 1.3 + h2 * 2.2;
        put(D.peb, np++, x + (h2 - 0.5) * 3, y + r * 0.25, -8 - h1 * 100, r * 1.2, r * 0.7, r, h3 * 6.28, 0, P.stone, 0.82 + h3 * 0.3);
      }
    }
    const R_ = ch.rocks;
    for (let i = 0; i < R_.length; i += 4) {
      const x = R_[i], y = R_[i + 1], id = R_[i + 2];
      const h1 = hash2(id, 71), h2 = hash2(id, 83), h3 = hash2(id, 97);
      if (h1 > 0.5 || nr >= 600) continue;
      const r = 4 + h2 * 7, len = 10 + h3 * 34, base = R_[i + 3] === M_STONE ? P.stoneDk : P.soilDk;
      put(D.rock, nr++, x, y + 3, 4 - h2 * 70, r, len, r * 0.9, h1 * 12, (h3 - 0.5) * 0.25, base, 0.9 + h1 * 0.4);
      if (h3 > 0.55 && nr < 600) put(D.rock, nr++, x + 7 + h1 * 4, y + 2, -12 - h3 * 40, r * 0.55, len * 0.5, r * 0.5, h2 * 9, 0.2, base, 1.05);
    }
  }
  for (const [mesh, n] of [[D.tuft, nt], [D.peb, np], [D.rock, nr]]) {
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

/* ---------- decor: painted into a few vertical strips standing on the islands (they cast shadows too) ---------- */
const STRIP_W = 480;
function r3Decor(full) {
  artLoad();
  const T = R3.T, sc = isTouch() ? 1 : 1.5;
  const n = Math.ceil(W / STRIP_W);
  if (full || !R3.decorStrips.length) {
    for (const s of R3.decorStrips) { R3.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.tex.dispose(); s.mesh.material.dispose(); s.mesh.customDepthMaterial.dispose(); }
    R3.decorStrips = [];
    for (let k = 0; k < n; k++) {
      const c = document.createElement('canvas'), tex = new T.CanvasTexture(c);
      tex.minFilter = T.LinearFilter; tex.generateMipmaps = false;
      const mesh = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, alphaTest: 0.04, shadowSide: T.DoubleSide }));
      mesh.customDepthMaterial = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, map: tex, alphaTest: 0.45, side: T.DoubleSide });
      mesh.renderOrder = 1; mesh.castShadow = true;
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
    s.mesh.customDepthMaterial.map = s.tex; s.mesh.customDepthMaterial.needsUpdate = true;
    s.mesh.scale.set(w, h, 1); s.mesh.position.set(s.x0 + w / 2, -(top + h / 2), DECOR_Z);
    s.mesh.visible = ys.length > 0 || list.length > 0;
  }
  if (changed) r3DecorShadows();
}
// soft contact occlusion under the bigger decor (the real shadow falls behind them): a small grid per item that follows the ground
const SHADOW_R = { tree: 40, pine: 30, deadtree: 26, saguaro: 20, teepee: 44, gate: 66, bush: 16, cactus: 11, smallpine: 15, column: 14, lantern: 10, drum: 12, campfire: 15, crystal: 10, shroom: 7, spear: 6, flag: 7, deadbush: 10 };
function r3DecorShadows() {
  const T = R3.T;
  if (!R3.shadowMat) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    R3.shadowMat = new T.MeshBasicMaterial({ color: 0x2a1c34, alphaMap: new T.CanvasTexture(c), transparent: true, opacity: 0.26, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
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

/* ---------- water / lava: a 3D surface (the 2D water is skipped while R3.water3d is set) ----------
   waves in the vertex shader; colour from the map's liquid stops by distance towards the camera; the islands'
   front faces reflected (mirrored through the surface, sampled from the face texture); foam where it meets the
   islands (distance to the slab footprint at the water line, from a 1D texture); lava gets a glowing crust instead */
const WATER_VS = `uniform float uTime, uLava;
varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float sp = uLava > 0.5 ? 0.5 : 1.0;
  wp.y += sin(wp.x * 0.02 + uTime * 1.6 * sp) * 2.6 + sin(wp.x * 0.05 - uTime * 2.3 * sp + wp.z * 0.02) * 1.3 + sin(wp.z * 0.06 + uTime * 1.2 * sp) * 1.2;
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const WATER_FS = `uniform float uTime, uLava, uWL;
uniform vec4 uC0, uC1, uC2, uFoam;
uniform vec3 uCam, uSky;
uniform sampler2D tDist, tFace;
uniform vec2 uWorld;
varying vec3 vW;
${R3_NOISE}
void main() {
  float z = vW.z;
  vec4 c = mix(uC0, uC1, smoothstep(-60.0, 260.0, z));
  c = mix(c, uC2, smoothstep(260.0, 1000.0, z));
  float t = uTime * (uLava > 0.5 ? 0.35 : 1.0);
  float n1 = vnoise(vec2(vW.x * 0.03 + t * 0.25, z * 0.07 - t * 0.1)), n2 = vnoise(vec2(vW.x * 0.11 - t * 0.6, z * 0.21 + t * 0.4));
  vec3 col = c.rgb;
  float a = max(c.a, 0.86);
  // footprint of the islands at the water line: distance in px along x, and in z outside the slab
  float dx = texture2D(tDist, vec2(vW.x / uWorld.x, 0.5)).r * 64.0;
  float dz = z > 0.0 ? z : (z < -${SLAB_D}.0 ? -${SLAB_D}.0 - z : 0.0);
  float d = length(vec2(dx, dz));
  if (uLava > 0.5) {
    float cn = vnoise(vec2(vW.x * 0.012 + t * 0.08, z * 0.03 - t * 0.05)) * 0.65 + n2 * 0.35;
    float crust = smoothstep(0.58, 0.8, cn);
    col = mix(col * 1.1 + vec3(0.22, 0.09, 0.0) * (1.0 - crust) * (0.6 + 0.4 * n1), col * 0.5, crust * 0.55);
    col += vec3(1.0, 0.85, 0.4) * smoothstep(0.82, 0.95, n1 * 0.6 + n2 * 0.4) * 0.25;
    col += vec3(1.0, 0.75, 0.3) * (1.0 - smoothstep(0.0, 18.0, d)) * 0.5;
    a = 1.0;
  } else {
    // the islands, mirrored in the surface (only in front of the face plane)
    if (z > 2.0) {
      vec3 dir = vW - uCam;
      float s = -uCam.z / dir.z;
      vec3 Q = uCam + dir * s;
      vec2 uv = vec2(Q.x / uWorld.x, (2.0 * uWL + Q.y) / uWorld.y) + vec2(n2 - 0.5, n1 - 0.5) * 0.004;
      vec4 f = texture2D(tFace, uv);
      float k = smoothstep(0.35, 0.65, f.a) * (1.0 - smoothstep(30.0, 500.0, z)) * step(uv.y, 1.0) * step(0.0, uv.y);
      col = mix(col, f.rgb * vec3(0.78, 0.86, 1.0), k * 0.42);
    }
    // sky sheen towards the back, little glints
    col = mix(col, uSky, smoothstep(40.0, -${SLAB_D}.0, z) * 0.25);
    col += vec3(1.0, 0.98, 0.9) * smoothstep(0.8, 0.94, n1 * 0.55 + n2 * 0.45) * 0.3;
    col *= 0.96 + 0.08 * n2;
    // foam: a line where it touches the islands, rings drifting away
    float fn = vnoise(vec2(vW.x * 0.15 + t, z * 0.15 - t * 0.7));
    float foam = 1.0 - smoothstep(3.0, 12.0 + fn * 8.0, d);
    foam += smoothstep(0.55, 1.0, sin(d * 0.32 - uTime * 2.6 + fn * 2.0)) * (1.0 - smoothstep(8.0, 34.0, d)) * 0.5;
    col = mix(col, mix(uFoam.rgb, vec3(1.0), 0.35), clamp(foam, 0.0, 1.0) * min(1.0, uFoam.a + 0.15));
  }
  // fade out behind the islands so the far edge never shows
  a *= smoothstep(-${SLAB_D}.0 - 150.0, -${SLAB_D}.0 - 20.0, z);
  gl_FragColor = vec4(col * a, a);
}`;
function r3WaterInit() {
  const T = R3.T;
  R3.distData = new Uint8Array(TW);
  R3.distTex = new T.DataTexture(R3.distData, TW, 1, T.RedFormat); R3.distTex.magFilter = R3.distTex.minFilter = T.LinearFilter; R3.distTex.needsUpdate = true;
  const u = (v) => ({ value: v });
  R3.waterMat = new T.ShaderMaterial({
    vertexShader: WATER_VS, fragmentShader: WATER_FS, transparent: true, depthWrite: true,
    blending: T.CustomBlending, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor,
    uniforms: { uTime: R3.timeU, uLava: u(0), uWL: u(0), uC0: u(new T.Vector4()), uC1: u(new T.Vector4()), uC2: u(new T.Vector4()), uFoam: u(new T.Vector4()), uCam: u(new T.Vector3()), uSky: u(new T.Vector3()), tDist: u(R3.distTex), tFace: u(R3.faceTex), uWorld: u(new T.Vector2(W, H)) },
  });
  const geo = new T.PlaneGeometry(1, 1, 96, 28); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, -0.5); // z from 0 (near) to -1 (far)
  R3.water = new T.Mesh(geo, R3.waterMat); R3.water.frustumCulled = false; R3.water.renderOrder = 3;
  R3.scene.add(R3.water);
}
const rgbaOf = (s, v) => {
  if (s[0] === '#') { const c = hex(s); return v.set(c[0] / 255, c[1] / 255, c[2] / 255, 1); }
  const m = s.match(/[\d.]+/g).map(Number); return v.set(m[0] / 255, m[1] / 255, m[2] / 255, m.length > 3 ? m[3] : 1);
};
function r3WaterLook() {
  const L = MAPS[TERR.map].liquid, u = R3.waterMat.uniforms;
  rgbaOf(L.stops[0], u.uC0.value); rgbaOf(L.stops[1], u.uC1.value); rgbaOf(L.stops[2], u.uC2.value); rgbaOf(L.foam, u.uFoam.value);
  u.uLava.value = L.lava ? 1 : 0;
  const sky = MAPS[TERR.map].sky.stops; const sc = hex(sky[sky.length - 1]); u.uSky.value.set(sc[0] / 255, sc[1] / 255, sc[2] / 255);
}
function r3WaterFoot(wl) {
  const g = TERR.g, D = R3.distData, row = clamp(Math.round(wl / CELL), 0, TH - 1);
  const solidAt = (x) => g[row * TW + x] || (row > 1 && g[(row - 2) * TW + x]) || (row < TH - 2 && g[(row + 2) * TW + x]);
  const tmp = R3.distTmp || (R3.distTmp = new Float32Array(TW));
  let d = 1e9;
  for (let x = 0; x < TW; x++) { d = solidAt(x) ? 0 : d + CELL; tmp[x] = d; }
  d = 1e9;
  for (let x = TW - 1; x >= 0; x--) { d = solidAt(x) ? 0 : d + CELL; tmp[x] = Math.min(tmp[x], d); D[x] = Math.min(255, tmp[x] / 64 * 255); }
  R3.distTex.needsUpdate = true;
}
function r3Water(wl, cx, hw, zc) {
  const on = typeof wl === 'number' && wl < H + 150;
  R3.water.visible = on; R3.water3d = on;
  if (!on) return;
  const key = Math.round(wl) + ':' + TERR.version + ':' + TERR.gen;
  if (R3.waterKey !== key) { R3.waterKey = key; r3WaterFoot(wl); }
  const near = zc - 25, far = -SLAB_D - 180, w = hw * 3 + 600;
  R3.water.position.set(cx, -wl, near); R3.water.scale.set(w, 1, near - far);
  R3.waterMat.uniforms.uWL.value = wl;
}

/* ---------- chibi heroes ----------
   Model units: feet at y = 0, about 54 to the top of the head, facing +z (the camera); +x is the side the hero faces
   (the body is mirrored for the other side). Parts that move are separate meshes, each a merged geometry with vertex
   colours: legs, torso, head (with the painted face), hair/hat, the free arm, a tail; the weapon (with the arm that
   holds it) turns with the aim in the play plane. */
const HB = { HIP: 9.5, BY: 16, HY: 37, HR: 14.5, SPIN: 22, SH: [6.5, 19.5, 7], ARMB: [-9.4, 22, -0.5] };
const SKIN = '#ffd9bf';
const HC = {
  bombi: { suit: '#ff9f43', suitDk: '#e07d22', patch: '#ffd7a0', shoe: '#6b3f22', sole: '#3a2418', cap: '#93582e', capDk: '#6e3e1e', hair: '#5a3a24', glove: '#8a5530' },
  thachgiap: { stone: '#d9ab79', stoneDk: '#ab7b50', belly: '#ebc797', moss: '#7cbf52', mossDk: '#5a9a3c', gem: '#3fe0b0', gemHi: '#b6ffe8' },
  moclan: { dress: '#7cc576', dressDk: '#4f9a45', dressLt: '#b8eaa0', hood: '#8fd35f', hoodIn: '#4f8f3a', hair: '#f2cf73', petal: '#ff9cc4', petal2: '#ffd6e8', mid: '#ffd23f', shoe: '#58a048', wood: '#a0703f' },
  loivu: { robe: '#4f7fe8', robeDk: '#2f58c0', trim: '#ffd23f', hair: '#3a6fe0', hat: '#3060d4', hatDk: '#1f3f9a', boot: '#3a2a5a', wood: '#7a4a2a' },
  hoamieu: { fur: '#f58a98', furLt: '#ffd0d6', ear: '#ffb3c1', robe: '#d8344a', robeDk: '#9a1f33', gold: '#ffc53d' },
};
const TRC = { skin: '#f7cba8', cloth: '#f3e2c2', red: '#d8432f', brown: '#8a5a34', crest: '#3a88e0', crestHi: '#8cc8ff', cream: '#fff0d6', hair: '#4a2e1c', black: '#2a2230' };
const HG = new Map(); // shared geometry: key|team|tribe → parts
const HF = new Map(); // painted faces: key|tribe → textures
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
    return geo;
  };
  const ell = (rx, ry, rz, col, x, y, z, ax = 0, ay = 0, az = 0, seg = 20) => add(new T.SphereGeometry(1, seg, Math.max(6, (seg * 0.7) | 0)), col, M(x, y, z, rx, ry, rz, ax, ay, az));
  const cyl = (r1, r2, h, col, x, y, z, ax = 0, ay = 0, az = 0, seg = 18) => add(new T.CylinderGeometry(r1, r2, h, seg), col, M(x, y, z, 1, 1, 1, ax, ay, az));
  // a cylinder lying along +x (r1 at the -x end)
  const rod = (r1, r2, x0, x1, col, y = 0, z = 0, seg = 12) => add(new T.CylinderGeometry(r2, r1, x1 - x0, seg), col, M((x0 + x1) / 2, y, z, 1, 1, 1, 0, 0, -Math.PI / 2));
  const cone = (r, h, col, x, y, z, ax = 0, ay = 0, az = 0, seg = 10) => add(new T.ConeGeometry(r, h, seg), col, M(x, y, z, 1, 1, 1, ax, ay, az));
  const tor = (R, r, col, x, y, z, ax = 0, ay = 0, az = 0, arc = Math.PI * 2, rs = 8, ts = 28) => add(new T.TorusGeometry(R, r, rs, ts, arc), col, M(x, y, z, 1, 1, 1, ax, ay, az));
  const box = (w, h, d, col, x, y, z, ax = 0, ay = 0, az = 0) => add(new T.BoxGeometry(w, h, d), col, M(x, y, z, 1, 1, 1, ax, ay, az));
  const cap = (r, len, col, x, y, z, ax = 0, ay = 0, az = 0) => add(new T.CapsuleGeometry(r, len, 5, 14), col, M(x, y, z, 1, 1, 1, ax, ay, az));
  const lathe = (pts, col, x, y, z, sx = 1, sy = 1, sz = 1, seg = 28) => add(new T.LatheGeometry(pts.map(([r, h]) => new T.Vector2(r, h)), seg), col, M(x, y, z, sx, sy, sz));
  // a tube along a path with a radius per point; flat < 1 squashes it into a ribbon (broad across the first normal n0)
  const sweep = (pts, radii, col, sides = 10, flat = 1, n0 = [1, 0, 0]) => {
    const n = pts.length, pos = [], nor = [], idx = [];
    const Tn = new T.Vector3(), N = new T.Vector3(n0[0], n0[1], n0[2]), B = new T.Vector3(), d = new T.Vector3();
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      Tn.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      N.addScaledVector(Tn, -N.dot(Tn)); if (N.lengthSq() < 1e-6) N.set(0, 0, 1).addScaledVector(Tn, -Tn.z); N.normalize();
      B.crossVectors(Tn, N).normalize();
      for (let s = 0; s <= sides; s++) {
        const an = (s / sides) * Math.PI * 2, c = Math.cos(an), sn = Math.sin(an), r = radii[i];
        pos.push(pts[i][0] + r * (N.x * c + B.x * sn * flat), pts[i][1] + r * (N.y * c + B.y * sn * flat), pts[i][2] + r * (N.z * c + B.z * sn * flat));
        d.set(N.x * c * flat + B.x * sn, N.y * c * flat + B.y * sn, N.z * c * flat + B.z * sn).normalize(); nor.push(d.x, d.y, d.z);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let s = 0; s < sides; s++) { const a = i * (sides + 1) + s, b = a + sides + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    for (const [i, sgn] of [[0, -1], [n - 1, 1]]) {
      if (radii[i] < 0.05) continue;
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      Tn.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize().multiplyScalar(sgn);
      const c0 = pos.length / 3; pos.push(pts[i][0], pts[i][1], pts[i][2]); nor.push(Tn.x, Tn.y, Tn.z);
      for (let s = 0; s <= sides; s++) { const k = i * (sides + 1) + s; pos.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]); nor.push(Tn.x, Tn.y, Tn.z); }
      for (let s = 0; s < sides; s++) { if (sgn < 0) idx.push(c0, c0 + 2 + s, c0 + 1 + s); else idx.push(c0, c0 + 1 + s, c0 + 2 + s); }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); geo.setIndex(idx);
    return add(geo, col);
  };
  const flip = (geo) => { const ix = geo.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } const nn = geo.attributes.normal.array; for (let i = 0; i < nn.length; i++) nn[i] = -nn[i]; return geo; };
  // a 5-petal flower facing +z, tilted back by rx
  const flower = (x, y, z, r, col, mid, rx = -0.5, rz = 0) => {
    for (let k = 0; k < 5; k++) { const a = k * 1.2566 + rz; ell(r, r * 0.62, r * 0.4, col, x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9 * Math.cos(rx), z - Math.sin(a) * r * 0.9 * Math.sin(rx), rx, 0, a, 8); }
    ell(r * 0.55, r * 0.55, r * 0.5, mid, x, y, z + r * 0.2, rx, 0, 0, 8);
  };
  return { list, add, ell, cyl, rod, cone, tor, box, cap, lathe, sweep, flip, flower, M };
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

/* ---- the face: painted on a canvas, mapped onto the front of the head (u, v span FACE_AZ x FACE_EL radians around
   the point straight ahead, slightly below the equator; outside it the texture edge = plain skin) ---- */
const FACE_AZ = 2.6, FACE_EL = 2.5, FACE_E0 = -0.12;
const EX = { normal: 0, blink: 1, aim: 2, charge: 3, hurt: 4, ko: 5, happy: 6, wow: 7 };
function headGeo(r, jit) {
  const T = R3.T, g = new T.SphereGeometry(r, 44, 30, -Math.PI / 2, Math.PI * 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const az = (uv.getX(i) - 0.5) * Math.PI * 2, el = (uv.getY(i) - 0.5) * Math.PI;
    uv.setXY(i, 0.5 + az / FACE_AZ, 0.5 + (el - FACE_E0) / FACE_EL);
    if (jit) { const x = p.getX(i) / r, y = p.getY(i) / r, z = p.getZ(i) / r, s = 1 + jit * (Math.sin(x * 5.1 + y * 3.3) * Math.sin(z * 4.3 - y * 6.1) + 0.5 * Math.sin(x * 9.7 - z * 8.3)); p.setXYZ(i, x * r * s, y * r * s, z * r * s); }
  }
  if (jit) g.computeVertexNormals();
  return g;
}
const FACE_STYLE = {
  bombi: { eye: '#8a4a1e', brow: '#5a3a24', bw: 5.5, freckle: true },
  thachgiap: { eye: '#1fb889', stone: true, skin: '#d9ab79' },
  moclan: { eye: '#a0602a', brow: '#c49a3a', bw: 3.4, lash: true },
  loivu: { eye: '#2f6fe0', brow: '#2a4fb0', bw: 4.6 },
  hoamieu: { eye: '#3faa5a', cat: true, skin: '#f58a98', muzzle: '#ffe2e6', nose: '#c8405a', brow: null },
};
function faceStyle(key, tribe) {
  const f = Object.assign({ skin: SKIN, brow: '#4a2a1a', bw: 4.6, mouth: '#6e2434' }, FACE_STYLE[key]);
  if (tribe) {
    f.paint = true; f.stone = false;
    if (key === 'hoamieu') { f.skin = '#f6d2a8'; f.muzzle = '#fff3e2'; f.nose = '#d0705a'; }
    else { f.skin = TRC.skin; f.brow = key === 'moclan' ? '#2a2230' : '#4a2e1c'; f.bw = key === 'moclan' ? 3.4 : 5; if (key === 'thachgiap') { f.eye = '#6a4020'; f.bw = 6; } }
  }
  return f;
}
function paintFace(f, ex) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = f.skin; g.fillRect(0, 0, S, S);
  const el = (x, y, rx, ry, rot = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); };
  const ink = '#2b1a22';
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (f.stone) { g.fillStyle = 'rgba(120,80,50,0.16)'; for (let i = 0; i < 14; i++) { el((i * 71) % S, (i * 113) % S, 4 + (i % 3) * 3, 3 + (i % 2) * 2); g.fill(); } }
  if (f.cat) { // muzzle, nose and whiskers
    g.fillStyle = f.muzzle; el(117, 163, 15, 11); g.fill(); el(139, 163, 15, 11); g.fill();
    g.fillStyle = f.nose; g.beginPath(); g.moveTo(122, 150); g.lineTo(134, 150); g.lineTo(128, 158); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(90,40,50,0.55)'; g.lineWidth = 2;
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(128 + s * 24, 158 + k * 6); g.lineTo(128 + s * 52, 152 + k * 9); g.stroke(); }
  }
  // blush
  const bl = ex === EX.happy || ex === EX.hurt ? 0.6 : 0.42;
  for (const s of [-1, 1]) { const gr = g.createRadialGradient(128 + s * 66, 156, 2, 128 + s * 66, 156, 20); gr.addColorStop(0, `rgba(255,105,125,${bl})`); gr.addColorStop(1, 'rgba(255,105,125,0)'); g.fillStyle = gr; el(128 + s * 66, 156, 22, 14); g.fill(); }
  if (f.freckle) { g.fillStyle = 'rgba(170,90,50,0.55)'; for (const s of [-1, 1]) for (const [dx, dy] of [[-6, -3], [2, 1], [8, -2]]) { el(128 + s * (62 + dx), 150 + dy, 1.8, 1.8); g.fill(); } }
  if (f.paint) { // tribe face paint: two orange strokes on each cheek
    g.strokeStyle = 'rgba(236,98,36,0.92)'; g.lineWidth = 4.2;
    for (const s of [-1, 1]) for (let k = 0; k < 2; k++) { const x = 128 + s * 70, y = 144 + k * 10; g.beginPath(); g.moveTo(x - 9, y + 1); g.lineTo(x + 9, y - 2); g.stroke(); }
  }
  const E = [[-1, 81], [1, 175]], ey = 124;
  for (const [s, x] of E) {
    const y = ey;
    if (ex === EX.blink) { g.strokeStyle = ink; g.lineWidth = 5; g.beginPath(); g.moveTo(x - 15, y + 2); g.quadraticCurveTo(x, y + 12, x + 15, y + 2); g.stroke(); if (f.lash) { g.beginPath(); g.moveTo(x + s * 15, y + 2); g.lineTo(x + s * 21, y - 2); g.stroke(); } continue; }
    if (ex === EX.happy) { g.strokeStyle = ink; g.lineWidth = 5.5; g.beginPath(); g.moveTo(x - 14, y + 8); g.quadraticCurveTo(x, y - 14, x + 14, y + 8); g.stroke(); continue; }
    if (ex === EX.hurt) { g.strokeStyle = ink; g.lineWidth = 5.5; const tx = -s * 9; g.beginPath(); g.moveTo(x - tx, y - 12); g.lineTo(x + tx, y); g.lineTo(x - tx, y + 12); g.stroke(); continue; }
    if (ex === EX.ko) { g.strokeStyle = ink; g.lineWidth = 5; g.beginPath(); g.moveTo(x - 11, y - 11); g.lineTo(x + 11, y + 11); g.moveTo(x - 11, y + 11); g.lineTo(x + 11, y - 11); g.stroke(); continue; }
    const wow = ex === EX.wow, sq = ex === EX.aim ? 0.42 : ex === EX.charge ? 0.55 : 0;
    const rx = wow ? 17 : 15, ry = wow ? 21 : 20, look = wow ? 0 : 3;
    if (f.stone) { // glossy gem eyes
      g.fillStyle = '#1d3b33'; el(x, y + 1, rx + 1.5, ry + 1.5); g.fill();
      const gr = g.createLinearGradient(0, y - ry, 0, y + ry); gr.addColorStop(0, colMul(f.eye, 0.55)); gr.addColorStop(1, colMul(f.eye, 1.35)); g.fillStyle = gr; el(x, y + 1, rx, ry); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.95)'; el(x - 5 + look, y - 7, 5.5, 6.5); g.fill(); el(x + 5 + look, y + 9, 2.6, 2.6); g.fill();
    } else {
      g.fillStyle = '#ffffff'; el(x, y, rx, ry); g.fill();
      const ir = wow ? 8 : 12.5, irY = wow ? 10.5 : 16.5;
      const gr = g.createLinearGradient(0, y - irY, 0, y + irY); gr.addColorStop(0, colMul(f.eye, 0.45)); gr.addColorStop(0.55, f.eye); gr.addColorStop(1, colMul(f.eye, 1.5));
      g.fillStyle = gr; el(x + look, y + 2.5, ir, irY); g.fill();
      g.fillStyle = '#1a1018'; if (f.cat && !wow) el(x + look, y + 3, 3, 11); else el(x + look, y + 3, ir * 0.48, irY * 0.5); g.fill();
      g.fillStyle = '#ffffff'; el(x + look - 5, y - 5, wow ? 3.5 : 5.2, wow ? 4 : 6); g.fill(); el(x + look + 4.5, y + 9, 2.4, 2.4); g.fill();
      g.strokeStyle = ink; g.lineWidth = 5.5; g.beginPath(); g.moveTo(x - rx - 1, y - 4); g.quadraticCurveTo(x - 2, y - ry - 8, x + rx + 1, y - 5); g.stroke();
      if (f.lash) { g.lineWidth = 4; g.beginPath(); g.moveTo(x + s * (rx - 1), y - 7); g.lineTo(x + s * (rx + 8), y - 13); g.moveTo(x + s * (rx - 5), y - 13); g.lineTo(x + s * (rx + 3), y - 20); g.stroke(); }
    }
    if (sq > 0) { // focused: a flat lid slanting down to the nose, cheeks pushed up a little
      const lo = y - ry - 4, inner = y - ry + 2 + sq * 34, outer = y - ry + sq * 24, xi = x - s * (rx + 3), xo = x + s * (rx + 3);
      g.fillStyle = f.skin; g.beginPath(); g.moveTo(xo, lo - 6); g.lineTo(xi, lo - 6); g.lineTo(xi, inner); g.lineTo(xo, outer); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(xo, y + ry + 6); g.lineTo(xi, y + ry + 6); g.lineTo(xi, y + ry - 5 * sq); g.lineTo(xo, y + ry - 3 * sq); g.closePath(); g.fill();
      g.strokeStyle = ink; g.lineWidth = 5.5; g.beginPath(); g.moveTo(xo - s * 2, outer + 1); g.lineTo(xi + s * 3, inner + 1); g.stroke();
    }
  }
  if (f.brow && !f.stone) {
    g.strokeStyle = f.brow; g.lineWidth = f.bw;
    for (const [s, x] of E) {
      const xi = x - s * 13, xo = x + s * 13;
      let yi = ey - 33, yo = ey - 35, mid = ey - 40;
      if (ex === EX.aim || ex === EX.charge) { yi = ey - 24; yo = ey - 36; mid = ey - 31; }
      else if (ex === EX.hurt || ex === EX.wow || ex === EX.ko) { yi = ey - 42; yo = ey - 33; mid = ey - 41; }
      else if (ex === EX.happy) { yi = ey - 38; yo = ey - 38; mid = ey - 46; }
      g.beginPath(); g.moveTo(xo, yo); g.quadraticCurveTo(x, mid, xi, yi); g.stroke();
    }
  }
  const my = f.cat ? 170 : 166;
  g.strokeStyle = f.mouth; g.fillStyle = f.mouth; g.lineWidth = 4;
  if (ex === EX.happy) {
    g.beginPath(); g.moveTo(110, my - 6); g.quadraticCurveTo(128, my - 2, 146, my - 6); g.quadraticCurveTo(144, my + 20, 128, my + 20); g.quadraticCurveTo(112, my + 20, 110, my - 6); g.fill();
    g.fillStyle = '#ff7a8a'; el(128, my + 13, 8, 5); g.fill();
  } else if (ex === EX.charge) {
    g.fillStyle = '#ffffff'; g.beginPath(); if (g.roundRect) g.roundRect(112, my - 8, 32, 14, 6); else g.rect(112, my - 8, 32, 14); g.fill(); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.moveTo(113, my - 1); g.lineTo(143, my - 1); g.stroke();
  } else if (ex === EX.hurt) {
    g.beginPath(); g.moveTo(114, my + 4); g.quadraticCurveTo(121, my - 6, 128, my + 2); g.quadraticCurveTo(135, my - 6, 142, my + 4); g.quadraticCurveTo(128, my + 14, 114, my + 4); g.fill();
  } else if (ex === EX.ko || ex === EX.wow) {
    el(128, my + 3, ex === EX.wow ? 8 : 6, ex === EX.wow ? 10 : 7); g.fill();
  } else if (ex === EX.aim) {
    g.beginPath(); g.moveTo(118, my + 1); g.quadraticCurveTo(129, my + 4, 139, my - 1); g.stroke();
  } else if (f.cat) {
    g.lineWidth = 3.5; g.beginPath(); g.moveTo(114, my - 2); g.quadraticCurveTo(121, my + 8, 128, my - 1); g.quadraticCurveTo(135, my + 8, 142, my - 2); g.stroke();
  } else {
    g.beginPath(); g.moveTo(117, my - 2); g.quadraticCurveTo(128, my + 9, 139, my - 2); g.stroke();
  }
  if (ex === EX.hurt || ex === EX.charge) { // sweat drop
    g.fillStyle = 'rgba(120,200,255,0.95)'; g.beginPath(); g.moveTo(212, 70); g.quadraticCurveTo(224, 92, 212, 98); g.quadraticCurveTo(200, 92, 212, 70); g.fill();
  }
  return c;
}

/* ---- the models ---- */
function heroParts(key, team, tribe) {
  const id = key + '|' + team + '|' + (tribe ? 1 : 0);
  if (HG.has(id)) return HG.get(id);
  const T = R3.T, tc = team >= 0 ? TEAM_COL[team] : '#e0533a';
  const C = HC[key], { HIP, BY, HR } = HB;
  const stoneHero = key === 'thachgiap' && !tribe, cat = key === 'hoamieu';
  const skin = tribe ? (cat ? '#f6d2a8' : TRC.skin) : stoneHero ? C.stone : cat ? C.fur : SKIN;
  const leg = partList(), torso = partList(), hair = partList(), arm = partList(), wp = partList(), tail = partList();
  const BEAN = [[0, -7.6], [6.5, -7.3], [10.4, -5.2], [11.6, -1.2], [11.2, 3.2], [9.4, 6.8], [6, 9.6], [0, 10.6]];
  const bw = stoneHero ? 1.14 : key === 'thachgiap' ? 1.08 : 1;
  /* legs (pivot at the hip) */
  if (tribe) {
    leg.cap(2.6, 2.4, skin, 0, -3.6, 0); leg.ell(3.7, 2.5, 4.7, skin, 0, -7.4, 1.2);
    leg.tor(2.75, 0.9, TRC.red, 0, -5.2, 0.2, Math.PI / 2, 0, 0, Math.PI * 2, 6, 16);
  } else if (key === 'bombi') { leg.cap(3, 2.4, C.suit, 0, -3.2, 0); leg.ell(4.1, 3, 5.4, C.shoe, 0, -7.1, 1.4); leg.ell(4.3, 1.1, 5.6, C.sole, 0, -8.9, 1.4); leg.tor(3.1, 0.8, C.suitDk, 0, -4.6, 0, Math.PI / 2); }
  else if (key === 'thachgiap') { leg.cap(3.8, 2, C.stone, 0, -3.4, 0); leg.ell(4.8, 3.2, 5.6, C.stone, 0, -7, 1.2); leg.ell(4.9, 1.2, 5.7, C.stoneDk, 0, -8.9, 1.2); }
  else if (key === 'moclan') { leg.cap(2.4, 2.8, SKIN, 0, -3.4, 0); leg.ell(3.6, 2.6, 4.9, C.shoe, 0, -7.4, 1.4); leg.ell(1.6, 1.2, 1, C.petal, 0, -6.2, 5.6); }
  else if (key === 'loivu') { leg.cap(2.8, 2.4, C.robeDk, 0, -3.2, 0); leg.ell(3.9, 2.9, 5.6, C.boot, 0, -7.2, 1.6, -0.12); leg.ell(4.1, 1.1, 5.8, '#22183a', 0, -8.9, 1.6); }
  else if (key === 'hoamieu') { leg.cap(2.8, 2.4, C.fur, 0, -3.4, 0); leg.ell(3.9, 2.7, 5, C.fur, 0, -7.4, 1.4); for (const x of [-1.6, 0, 1.6]) leg.ell(1.1, 0.9, 0.9, C.furLt, x, -7.6, 6.1, 0, 0, 0, 8); }
  /* torso (built in model space, moved to the hip pivot below) */
  const B = torso;
  if (tribe) {
    B.lathe(BEAN, skin, 0, BY, 0, bw, 1, 0.86 * bw);
    B.ell(1.1, 1.1, 0.6, colMul(skin, 0.8), 0, BY - 1.5, 9.8);
    // loincloth skirt (cream) with a red zigzag, belt
    B.lathe([[13.4 * bw, -4.2], [12.7 * bw, -1.8], [11.9 * bw, 0.6], [11.3 * bw, 2.4]], key === 'moclan' ? '#e8892e' : TRC.cloth, 0, BY - 4.6, 0, 1, 1, 0.9);
    B.tor(13.3 * bw, 0.9, TRC.red, 0, BY - 8.7, 0, Math.PI / 2, 0, 0, Math.PI * 2, 6, 32);
    for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; B.add(new T.ConeGeometry(1.6, 3, 3), TRC.red, B.M(Math.sin(a) * 12.9 * bw, BY - 6.1, Math.cos(a) * 12.9 * bw * 0.9, 1, 1, 0.3, 0, a, Math.PI)); }
    B.tor(11.5 * bw, 1.25, TRC.brown, 0, BY - 2.2, 0, Math.PI / 2, 0, 0, Math.PI * 2, 6, 28);
    if (key === 'moclan') { B.cyl(10.7, 11.5, 5, '#e8892e', 0, BY + 4.6, 0, 0, 0, 0, 20); B.tor(10.9, 0.7, TRC.red, 0, BY + 2.2, 0, Math.PI / 2); }
    if (key === 'loivu') { for (let k = -4; k <= 4; k++) { const a = k * 0.28; B.ell(1.25, 1.25, 1.25, '#fbf6ea', Math.sin(a) * 9.6, BY + 8.6 - Math.abs(k) * 0.35, Math.cos(a) * 8.4, 0, 0, 0, 8); } }
    else for (let k = -2; k <= 2; k++) { const a = k * 0.34; B.add(new T.ConeGeometry(1.7, 3.2, 3), k % 2 ? TRC.cream : TRC.red, B.M(Math.sin(a) * 9.6, BY + 7.6 - Math.abs(k) * 0.4, Math.cos(a) * 8.6, 1, 1, 0.35, 0, a, Math.PI)); }
    B.tor(9.4, 0.45, TRC.brown, 0, BY + 9.2, 0.6, Math.PI / 2 + 0.25, 0, 0, Math.PI * 2, 4, 24);
    if (key === 'thachgiap') { // the round wooden shield, held on the free-arm side in front
      const sx = -9.5, sy = BY + 1, sz = 9.5;
      B.cyl(11.5, 11.5, 2.2, '#c99a5a', sx, sy, sz, Math.PI / 2, 0, 0, 24); B.tor(11.4, 1.3, '#8a5a2c', sx, sy, sz + 1.1, 0, 0, 0, Math.PI * 2, 6, 32);
      B.tor(6.8, 0.75, TRC.red, sx, sy, sz + 1.25, 0, 0, 0, Math.PI * 2, 4, 24); B.ell(3.2, 3.2, 2, '#8a5a2c', sx, sy, sz + 1.4);
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; B.ell(0.9, 0.9, 0.6, TRC.cream, sx + Math.cos(a) * 9.2, sy + Math.sin(a) * 9.2, sz + 1.3, 0, 0, 0, 6); }
    }
  } else if (key === 'bombi') {
    B.lathe(BEAN, C.suit, 0, BY, 0, 1, 1, 0.86);
    B.ell(7.2, 6, 2.6, C.patch, 0, BY + 0.5, 9.2); B.box(4.6, 3.6, 1.2, C.suitDk, -3.6, BY + 2.4, 9.9, -0.1, 0, 0);
    B.box(0.9, 10, 1, C.suitDk, 0.8, BY + 1.5, 10.1, -0.12); B.tor(11.3, 1.5, '#6b4a2b', 0, BY - 4.2, 0, Math.PI / 2, 0, 0, Math.PI * 2, 6, 28);
    B.box(3.8, 3, 1.4, '#ffd166', 0, BY - 4.2, 9.9);
    B.tor(8.6, 2.9, tc, 0, BY + 9.2, 0, Math.PI / 2 + 0.12, 0, 0, Math.PI * 2, 8, 24);
    B.sweep([[-3, BY + 8.4, -7], [-7.5, BY + 7, -9.5], [-12, BY + 5.4, -9.5], [-15.5, BY + 4.2, -8]], [2.6, 2.5, 2.2, 1.6], tc, 8, 0.4, [0, 1, 0]);
  } else if (key === 'thachgiap') {
    B.lathe(BEAN, C.stone, 0, BY - 0.5, 0, bw, 1.04, 0.9 * bw);
    B.ell(8, 6.6, 2.8, C.belly, 0, BY - 0.6, 9.4);
    B.add(new T.OctahedronGeometry(1.8, 0), C.gem, B.M(-5, BY + 4.4, 10.1, 1, 1.3, 0.8)); B.add(new T.OctahedronGeometry(1.5, 0), C.gem, B.M(5.6, BY - 1.4, 10, 1, 1.3, 0.8)); B.add(new T.OctahedronGeometry(1.2, 0), C.gem, B.M(1.5, BY + 7.6, 8.7, 1, 1.2, 0.8));
    for (const s of [-1, 1]) B.ell(5.4, 3.8, 5.2, C.stoneDk, s * 10, BY + 6.8, -0.5, 0, 0, s * 0.3, 10);
    B.ell(4.4, 2.2, 3, C.moss, -7, BY + 9.8, 2, 0, 0, 0.3, 10);
  } else if (key === 'moclan') {
    B.lathe([[0, -8.2], [10.6, -8], [13.4, -6.6], [12.6, -2.6], [10.4, 1.6], [9.2, 5.8], [6.8, 9.4], [0, 10.4]], C.dress, 0, BY, 0, 1, 1, 0.9);
    B.tor(13.1, 1.1, C.dressLt, 0, BY - 7.2, 0, Math.PI / 2, 0, 0, Math.PI * 2, 6, 32);
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; B.ell(2.6, 1.6, 1, C.dressLt, Math.sin(a) * 13.2, BY - 8.2, Math.cos(a) * 11.9, 0, a, 0, 8); }
    for (const s of [-1, 1]) B.ell(5, 2.2, 3.2, '#a8e07c', s * 3.8, BY + 9, 6.6, 0.4, 0, s * 0.5, 10);
    B.ell(2.6, 1.7, 1.3, C.petal, -2.2, BY + 8.4, 9.3, 0, 0, 0.5, 8); B.ell(2.6, 1.7, 1.3, C.petal, 2.2, BY + 8.4, 9.3, 0, 0, -0.5, 8); B.ell(1.3, 1.3, 1.2, '#ff6fa8', 0, BY + 8.4, 9.6, 0, 0, 0, 8);
    B.tor(10.6, 0.9, C.dressDk, 0, BY + 1.4, 0, Math.PI / 2);
  } else if (key === 'loivu') {
    B.lathe([[0, -8.4], [10.6, -8.2], [13, -6.8], [12.2, -2.4], [10.6, 2], [9.6, 6], [6.6, 9.6], [0, 10.6]], C.robe, 0, BY, 0, 1, 1, 0.9);
    B.tor(12.9, 1.15, C.trim, 0, BY - 7.5, 0, Math.PI / 2, 0, 0, Math.PI * 2, 6, 32);
    B.ell(1.5, 8.6, 1, C.trim, 0, BY - 0.6, 11, -0.08); B.tor(11.2, 1.3, C.trim, 0, BY - 1.2, 0, Math.PI / 2);
    B.tor(7.6, 1.7, C.trim, 0, BY + 9.2, 0.6, Math.PI / 2 + 0.18, 0, 0, Math.PI * 2, 6, 24);
    for (const s of [-1, 1]) B.ell(1.2, 1.2, 0.8, '#ffffff', s * 1.6, BY + 4, 10.6, 0, 0, 0, 8);
  } else if (key === 'hoamieu') {
    B.lathe(BEAN, C.robe, 0, BY, 0, 1, 1, 0.86);
    B.tor(11.4, 1.3, C.gold, 0, BY - 5.8, 0, Math.PI / 2, 0, 0, Math.PI * 2, 6, 28);
    B.tor(11.2, 1.6, C.gold, 0, BY - 0.4, 0, Math.PI / 2, 0, 0, Math.PI * 2, 6, 28); B.ell(2.4, 2, 1.4, C.gold, 3.2, BY - 0.6, 10.4); B.cap(0.9, 3, C.gold, 4.4, BY - 3.8, 10.2, 0, 0, 0.3);
    B.tor(7.4, 1.7, C.gold, 0, BY + 9, 0.6, Math.PI / 2 + 0.18, 0, 0, Math.PI * 2, 6, 24);
    B.ell(5.6, 5, 2.2, C.furLt, 0, BY + 6.6, 7.2);
    B.tor(5, 0.9, tc, 0, BY + 9.6, 1, Math.PI / 2 + 0.2, 0, 0, Math.PI * 2, 6, 20); B.ell(1.6, 1.6, 1.6, '#ffd23f', 0, BY + 6.2, 8.4, 0, 0, 0, 10);
  }
  // team colour accent: a scarf tail (Bom Bi has his scarf; tribe heroes wear the headband)
  if (!tribe && key !== 'bombi') B.sweep([[-3.5, BY + 8.6, -7], [-8, BY + 7.2, -9], [-12.5, BY + 5.4, -8.8]], [2.1, 2, 1.5], tc, 8, 0.4, [0, 1, 0]);
  /* the free arm (pivot at the shoulder) */
  const sleeve = tribe ? skin : key === 'bombi' ? C.suit : key === 'thachgiap' ? C.stone : key === 'moclan' ? SKIN : C.robe;
  const hand = tribe ? skin : key === 'bombi' ? C.glove : key === 'thachgiap' ? C.stone : cat ? C.fur : SKIN;
  const ar = key === 'thachgiap' ? 3.4 : 2.7;
  if (key === 'loivu' && !tribe) { arm.cyl(2.4, 4.3, 7.5, sleeve, -1.2, -4.4, 0.2, 0, 0, -0.32, 14); arm.tor(4.1, 0.8, C.trim, -2.4, -8, 0.2, Math.PI / 2, 0.32, 0); }
  else arm.cap(ar, 4.4, sleeve, -1.3, -4, 0, 0, 0, -0.3);
  if (tribe) arm.tor(ar + 0.2, 0.75, TRC.red, -1.4, -3.4, 0, Math.PI / 2, 0.3, 0, Math.PI * 2, 6, 16);
  arm.ell(ar + 0.7, ar + 0.6, ar + 0.6, hand, -2.9, -8.6, 0.6);
  /* tail */
  let hasTail = false;
  if (cat) {
    hasTail = true;
    const fur = tribe ? '#f6d2a8' : C.fur;
    tail.sweep([[0, 0, 0], [-3, 2, -4], [-8, 6.5, -5.5], [-11, 12, -5], [-10.5, 17.5, -3.5], [-8, 20.5, -2.5]], [2.2, 2.2, 2.1, 2, 1.9, 1.6], fur, 10);
    if (tribe) tail.ell(2.2, 3, 2.2, '#c98a5a', -8, 21, -2.5);
  }
  /* head extras (relative to the head centre) */
  const H_ = hair;
  if (tribe) {
    const hc = key === 'moclan' ? TRC.black : key === 'loivu' ? '#3a2a22' : TRC.hair;
    if (!cat) H_.add(new T.SphereGeometry(HR + 0.7, 30, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), hc, H_.M(0, 0.6, -0.8, 1.04, 1, 1, -0.3));
    if (key === 'moclan') { H_.ell(14, 17, 8, hc, 0, -8, -8); for (const s of [-1, 1]) H_.ell(3.4, 12, 3.4, hc, s * 13.2, -8.5, 2.4, 0, 0, s * 0.08); H_.ell(5, 3, 3, hc, -6, 7.5, 12, 0, 0, 0.5); H_.ell(5, 3, 3, hc, 5, 7.8, 12.2, 0, 0, -0.4); }
    else if (!cat) { H_.ell(4.6, 3, 3, hc, -6, 7.6, 11.8, 0, 0, 0.45); H_.ell(4.2, 2.8, 3, hc, 1, 8.6, 12.6); H_.ell(4, 2.6, 3, hc, 7, 7.4, 11.6, 0, 0, -0.4); }
    if (key === 'loivu') H_.ell(3.6, 3.4, 3.6, hc, 0, 15.5, -4);
    if (cat) for (const s of [-1, 1]) { H_.cone(4.8, 9, '#f6d2a8', s * 8.6, 12.6, -1, -0.1, 0, -s * 0.42, 10); H_.cone(2.9, 5.6, '#ffb3a0', s * 8.4, 12.2, 1.3, -0.1, 0, -s * 0.42, 10); }
    // headband in the team colour with cream beads and a medallion
    H_.tor(HR + 0.6, 1.9, tc, 0, 5.4, 0, Math.PI / 2 - 0.14, 0, 0, Math.PI * 2, 8, 36);
    for (let k = -3; k <= 3; k++) { const a = k * 0.32; H_.ell(0.9, 0.9, 0.6, TRC.cream, Math.sin(a) * (HR + 2.3), 5.3 + Math.cos(a) * 1.8, Math.cos(a) * (HR + 1.5), 0, a, 0, 6); }
    H_.ell(2.7, 2.7, 1.2, '#2b2238', 6.2, 7.6, 13.6, -0.2, 0.4, 0); H_.ell(1.6, 1.6, 1, '#3fb5e0', 6.6, 7.7, 14.6, -0.2, 0.4, 0, 10);
    // three feather plumes (the middle one tallest) and a white side feather
    const girl = key === 'moclan', cw = girl ? 4.2 : 5.6;
    for (const u of [-1, 0, 1]) {
      const len = (girl ? 15 : 21) - Math.abs(u) * 5, bx = u * cw;
      const pts = [[bx, 8, -7], [bx + u * 2.2, 8 + len * 0.4, -9], [bx + u * 4.6, 8 + len * 0.78, -9.5], [bx + u * 5.8, 8 + len * 0.96, -9.4], [bx + u * 6.2, 8 + len * 1.04, -9.2]];
      H_.sweep(pts, [2.2, 4.0, 3.8, 2.4, 0.4], TRC.crest, 12, 0.24);
      H_.sweep(pts.map((p) => [p[0], p[1], p[2] + 0.9]), [0.5, 0.8, 0.7, 0.4, 0.1], TRC.crestHi, 6, 0.6);
    }
  } else if (key === 'bombi') {
    H_.add(new T.SphereGeometry(HR + 0.9, 30, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), C.cap, H_.M(0, 0.4, -0.9, 1.03, 1.02, 1.02, -0.2));
    H_.tor(HR + 0.4, 1.3, C.capDk, 0, 1.9, -0.4, Math.PI / 2 - 0.2, 0, 0, Math.PI * 2, 6, 36);
    for (const s of [-1, 1]) { H_.ell(4.2, 6.6, 3, C.cap, s * 13.8, -3.4, -1.2, 0, 0, -s * 0.1); H_.cap(0.8, 4, C.capDk, s * 13.4, -9.6, -0.6); }
    H_.ell(1.6, 6, 1.6, C.capDk, 0, 14, 4, 0.9, 0, 0);
    for (const [x, y, z, rz] of [[-6, 6.6, 11.6, 0.45], [0.5, 7.4, 12.6, 0], [6, 6.4, 11.8, -0.45]]) H_.ell(4.4, 3, 3, C.hair, x, y, z, 0, 0, rz);
    // goggles pushed up on the cap
    H_.tor(HR + 1.3, 0.8, '#4a3020', 0, 9.6, -1.6, Math.PI / 2 - 0.85, 0, 0, Math.PI * 2, 4, 36);
    for (const s of [-1, 1]) { H_.tor(2.9, 1.05, '#c9a25a', s * 4.4, 12.2, 8.6, -0.95, 0, 0, Math.PI * 2, 8, 18); H_.ell(2.4, 2.4, 1, '#4f7f9a', s * 4.4, 12.2, 8.7, -0.95, 0, 0, 12); H_.ell(0.8, 0.8, 0.4, '#ffffff', s * 4.4 - 0.9, 13, 9.4, -0.95); }
    H_.box(2.4, 1.1, 1.1, '#c9a25a', 0, 12.2, 8.8, -0.95);
  } else if (key === 'thachgiap') {
    H_.add(new T.SphereGeometry(HR + 0.9, 26, 10, 0, Math.PI * 2, 0, Math.PI * 0.3), C.moss, H_.M(0, 0.8, -0.6, 1.02, 1, 1, -0.1));
    for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2; H_.ell(3.3, 2.4, 3.3, k % 2 ? C.moss : C.mossDk, Math.cos(a) * 8.6, 12.4 + (k % 3) * 0.5, Math.sin(a) * 8.6 - 0.6, 0, 0, 0, 10); }
    H_.add(new T.ConeGeometry(2.6, 9, 6), C.gem, H_.M(1.4, 19.5, -0.5, 1, 1, 1, 0, 0, -0.18)); H_.add(new T.ConeGeometry(1.8, 6, 6), C.gemHi, H_.M(-2.6, 17.6, 0.6, 1, 1, 1, 0, 0, 0.5));
    H_.ell(3.6, 1.2, 2, '#9fe07a', 4.8, 16.6, 2, 0, 0, -0.5, 8);
  } else if (key === 'moclan') {
    for (const [x, y, z, rz] of [[-6, 6.8, 11.6, 0.5], [0, 8, 12.8, 0], [6, 6.8, 11.6, -0.5]]) H_.ell(5, 3.2, 3, C.hair, x, y, z, 0, 0, rz);
    for (const s of [-1, 1]) H_.ell(2.8, 6.4, 2.8, C.hair, s * 12.8, -3.4, 4.2, 0, 0, s * 0.12);
    // the leaf hood: a shell open towards the face (inner side darker), a rim, a curled tip, flowers
    const hood = new T.SphereGeometry(HR + 3, 32, 20, 0, Math.PI * 2, 0.98, Math.PI - 0.98);
    H_.add(hood, C.hood, H_.M(0, 1.4, -1.8, 1.04, 1, 1, Math.PI / 2 - 0.12, 0, 0));
    const inner = H_.flip(new T.SphereGeometry(HR + 2.3, 32, 20, 0, Math.PI * 2, 0.98, Math.PI - 0.98));
    H_.add(inner, C.hoodIn, H_.M(0, 1.4, -1.8, 1.04, 1, 1, Math.PI / 2 - 0.12, 0, 0));
    H_.tor((HR + 2.6) * Math.sin(0.98) * 1.02, 1.5, '#a8e07c', 0, 1.4 + 1.1, -1.8 + (HR + 2.6) * Math.cos(0.98), -0.12, 0, 0, Math.PI * 2, 8, 40);
    H_.sweep([[0, 16, -5], [1, 21, -8], [4, 24.5, -11], [8, 25, -12.5], [9.5, 23, -12]], [3, 2.4, 1.6, 0.9, 0.4], C.hood, 10);
    H_.ell(4.5, 1.6, 2.4, '#6fb84a', -5, 19, -6, 0.3, 0, 0.6, 10);
    H_.flower(-7.5, 14.5, 7.5, 2.7, C.petal, C.mid, -0.7, 0.2); H_.flower(0.5, 17, 5.2, 3, C.petal2, C.mid, -0.9, 0.5); H_.flower(8, 14, 7, 2.5, C.petal, C.mid, -0.7, 0.9);
  } else if (key === 'loivu') {
    for (const [x, y, z, rx, rz] of [[-6, 7.4, 12, 2.6, 0.5], [0, 8, 13, 2.8, 0], [6, 7.4, 12, 2.6, -0.5]]) H_.cone(3, 7, C.hair, x, y, z, rx, 0, rz, 6);
    for (let k = 0; k < 7; k++) { const a = Math.PI * (0.62 + (k / 6) * 0.76) + Math.PI / 2; H_.cone(3.2, 8, C.hair, Math.cos(a) * 13.8, 2.5 - (k % 2) * 2, Math.sin(a) * 13.8 - 1, Math.sin(a) * -1.9, 0, Math.cos(a) * 1.9, 6); }
    H_.cyl(20, 20, 1.6, C.hat, 0, 8.6, -0.8, -0.14, 0, 0, 36); H_.tor(20, 0.8, C.hatDk, 0, 8.6, -0.8, Math.PI / 2 - 0.14, 0, 0, Math.PI * 2, 6, 40);
    H_.cyl(12.2, 12.8, 3.4, C.trim, 0, 10.6, -1.2, -0.14, 0, 0, 28);
    H_.sweep([[0, 10, -1.4], [0, 16, -2.6], [-0.6, 22, -4.4], [-3, 27, -7.4], [-7, 29.5, -10], [-10, 29, -11]], [12.2, 10, 7.2, 4.6, 2.2, 0.4], C.hat, 16);
    for (const [x, y, r] of [[-2.6, 16.2, 2.6], [0.6, 17.4, 3], [3.6, 16.2, 2.4]]) H_.ell(r, r * 0.8, r * 0.7, '#ffffff', x, y, 10.6 - Math.abs(x) * 0.15, 0, 0, 0, 10);
    H_.box(1.6, 5, 1, C.trim, 0.8, 13.2, 11.2, 0, 0, 0.5); H_.box(1.6, 4, 1, C.trim, -0.4, 10.6, 11.4, 0, 0, 0.5);
    H_.ell(1.8, 1.8, 1.8, C.trim, -10, 29, -11, 0, 0, 0, 8);
  } else if (key === 'hoamieu') {
    for (const s of [-1, 1]) { H_.cone(5, 9.5, C.fur, s * 8.8, 12.8, -1, -0.1, 0, -s * 0.42, 10); H_.cone(3, 6, C.ear, s * 8.6, 12.4, 1.4, -0.1, 0, -s * 0.42, 10); H_.ell(2.8, 2.2, 2, C.furLt, s * 13.2, -5, 4, 0, 0, s * 0.4, 8); }
    H_.ell(3, 2, 2.4, colMul(C.fur, 0.92), 0, 13.6, 3, 0, 0, 0, 10); H_.ell(2.4, 2.4, 2, C.gold, 9, 11, 9, 0, 0, 0, 10);
  }
  /* weapon (pivot at the shoulder; the hand sits at x = 7.5) — with the sleeve of the arm that holds it */
  const W_ = wp;
  W_.add(new T.CapsuleGeometry(ar, 3.4, 4, 12), sleeve, W_.M(3.4, -0.4, 0, 1, 1, 1, 0, 0, -Math.PI / 2));
  const glows = [];
  if (tribe) {
    const blade = (x, len, w, col) => { W_.ell(len * 0.5, w, 1.2, col, x + len * 0.5, 0, 0, 0, 0, 0, 12); W_.cone(w * 0.55, len * 0.4, col, x + len * 1.05, 0, 0, 0, 0, -Math.PI / 2, 6); };
    if (key === 'bombi') { W_.rod(1.3, 1.3, -14, 34, '#b07a3e'); W_.rod(1.9, 1.9, 24, 27, TRC.red); W_.rod(1.9, 1.9, 27, 29, TRC.cream); blade(33, 13, 3.6, '#fffaf0'); W_.ell(0.9, 3.4, 0.6, '#ffffff', 30, -4.2, 0.6, 0, 0, 0.2, 8); W_.ell(0.9, 3, 0.6, TRC.crest, 31.5, -3.8, -0.4, 0, 0, -0.1, 8); }
    else if (key === 'thachgiap') { W_.rod(1.3, 1.3, -6, 22, '#9a6a36'); W_.rod(1.8, 1.8, 18, 21, TRC.red); blade(21.5, 9, 3, '#ece6dc'); }
    else if (key === 'moclan') { W_.rod(1.3, 1.4, -4, 25, '#efe3c8'); W_.ell(2.2, 2.2, 2.2, '#efe3c8', 25, 0, 0); W_.ell(4.6, 1.8, 1.2, '#7cc576', 24, 3.6, 0, 0, 0, 0.6, 8); W_.ell(4.6, 1.8, 1.2, '#7cc576', 24, -3.6, 0, 0, 0, -0.6, 8); W_.flower(29, 0, 0.5, 3, '#ff8fbf', '#ffd23f', 0, 0.3); }
    else if (key === 'loivu') {
      W_.sweep([[-2, 0, 0], [6, 1.6, 0], [14, 3.6, 0], [21, 4.4, 0], [26, 3.6, 0]], [1.6, 2.4, 3.8, 5.6, 7.4], '#f1e2c0', 14);
      for (const [x, y, r] of [[7, 1.8, 2.6], [15, 3.8, 4]]) W_.tor(r, 0.75, '#8a5a2c', x, y, 0, 0, Math.PI / 2, 0.2, Math.PI * 2, 6, 20);
      W_.ell(0.8, 6.6, 6.6, '#5a3a2a', 26.2, 3.6, 0); glows.push(['#7fd0ff', 27.5, 3.6, 0, 3.4]);
    } else if (key === 'hoamieu') { W_.rod(1.2, 1.2, -8, 28, '#9a6a36'); W_.rod(1.7, 1.7, 20, 23, TRC.red); blade(27.5, 9, 3, '#ece6dc'); glows.push(['#ff8a3c', 39.5, 0, 0, 3.4]); }
  } else if (key === 'bombi') {
    W_.ell(4.8, 4.8, 4.8, '#3d3f52', 8, 1.6, 0); W_.rod(5, 5.4, 8, 26, '#3d3f52', 1.6); W_.rod(6.4, 6.4, 25.5, 29, '#26262f', 1.6);
    for (const x of [13, 20]) W_.rod(5.7, 5.7, x, x + 2.6, C.suit, 1.6);
    W_.cyl(0.7, 0.7, 4.4, '#c9a36a', 5.4, 6.4, 0, 0, 0, 0.7, 6); W_.box(1.6, 2.4, 1.6, '#26262f', 23, 7.6, 0);
    W_.ell(3.4, 2.2, 2.2, '#ffd166', 18, 1.6, 4.6, 0, 0, 0, 10);
    glows.push(['#ffd166', 3.6, 8.4, 0, 1.7]);
  } else if (key === 'thachgiap') {
    W_.rod(1.7, 1.7, 2, 24, '#8b5a35'); W_.rod(2.1, 2.1, 10, 13, '#5f4026');
    W_.cyl(6.4, 6.4, 13, '#a49482', 26, 0, 0, 0, 0, 0, 12); for (const s of [-1, 1]) W_.ell(6.4, 1.8, 6.4, '#8a7a68', 26, s * 6.6, 0, 0, 0, 0, 12);
    W_.ell(2.4, 2.4, 1.4, C.gem, 26, 0, 6.2); W_.ell(4, 1.4, 3, C.moss, 25, 6.8, 1, 0, 0, 0.1, 10);
  } else if (key === 'moclan') {
    W_.tor(13, 1.2, C.wood, -5.5, 0, 0, 0, 0, -1.15, 2.3, 6, 24); W_.cyl(0.35, 0.35, 23.6, '#ffffff', 0.4, 0, 0, 0, 0, 0, 4);
    for (const s of [-1, 1]) W_.ell(3.4, 1.4, 1, '#7cc576', 0.9, s * 12.2, 0.4, 0, 0, s * 0.7, 8);
    W_.cyl(1.6, 1.6, 4.4, '#7cc576', 7.5, 0, 0, 0, 0, 0, 10);
    W_.rod(0.55, 0.55, -2, 19, '#c79a5a', 0, 1.2, 6); W_.flower(20.5, 0, 1.2, 2.3, C.petal, C.mid, 0, 0.2); W_.ell(2.4, 0.9, 0.8, '#7cc576', 0.5, 1.6, 1.2, 0, 0, 0.6, 6); W_.ell(2.4, 0.9, 0.8, '#7cc576', 0.5, -1.6, 1.2, 0, 0, -0.6, 6);
  } else if (key === 'loivu') {
    W_.rod(1.4, 1.4, -4, 27, C.wood); W_.rod(1.9, 1.9, 5, 9, C.trim);
    W_.tor(4.6, 0.9, '#c9a36a', 30.5, 0, 0, 0, 0, 0, Math.PI * 1.6, 6, 20);
    glows.push(['#ffe066', 30.5, 0, 0, 3.6]);
  } else if (key === 'hoamieu') {
    W_.rod(4.4, 4.8, 5, 23, C.robe, 0.5); W_.rod(5.4, 5.4, 9, 11.4, C.gold, 0.5); W_.rod(5.4, 5.4, 17, 19.4, C.gold, 0.5); W_.rod(5.6, 4.6, 23, 27, '#3a2a2a', 0.5);
    W_.ell(4.4, 4.4, 4.4, C.robe, 5, 0.5, 0); W_.box(2.4, 6, 2.4, C.robeDk, 9, -4, 0, 0, 0, 0.2);
    glows.push(['#ff8a3c', 30, 0.5, 0, 3.2]);
  }
  W_.ell(ar + 0.8, ar + 0.7, ar + 0.7, hand, 7.5, -0.4, 2.2);
  if (cat && !tribe) glows.push(['#ff8a3c', -8, 23, -2.5, 2.8, 'tail']); // the tail flame of the fire cat
  const torsoG = mergeParts(torso.list); torsoG.translate(0, -HIP, 0);
  // the painted faces (one texture per expression) do not depend on the team: shared per hero and outfit
  const fk = key + (tribe ? '|t' : '');
  let faces = HF.get(fk);
  if (!faces) {
    const style = faceStyle(key, tribe);
    faces = [];
    for (let e = 0; e < 8; e++) { const t = new T.CanvasTexture(paintFace(style, e)); t.anisotropy = 4; faces.push(t); }
    HF.set(fk, faces);
  }
  const parts = {
    leg: mergeParts(leg.list), torso: torsoG, arm: mergeParts(arm.list), hair: mergeParts(hair.list), weapon: mergeParts(wp.list),
    tail: hasTail ? mergeParts(tail.list) : null, head: headGeo(stoneHero ? HR + 0.6 : HR, stoneHero ? 0.035 : 0), headSX: key === 'thachgiap' ? 1.08 : 1.05,
    faces, glows, big: key === 'thachgiap' ? 1.1 : 1,
    ink: tribe ? '#3a1c14' : '#' + new T.Color(HEROES[key].dark).lerp(new T.Color('#24162c'), 0.62).getHexString(),
  };
  HG.set(id, parts);
  return parts;
}
// the team ring and a little contact shadow under each hero (the real shadow falls behind)
const ringTex = {};
function groundDecal(team) {
  if (ringTex[team]) return ringTex[team];
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 34); gr.addColorStop(0, 'rgba(30,20,40,0.5)'); gr.addColorStop(1, 'rgba(30,20,40,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(64, 64, 40, 0, 7); g.fill();
  if (team >= 0) { g.strokeStyle = TEAM_COL[team]; g.globalAlpha = 0.9; g.lineWidth = 6; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.stroke(); }
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
  const mat = r3Mat({ vertexColors: true }), wMat = r3Mat({ vertexColors: true }), headMat = r3Mat({ map: P.faces[0] });
  const ink = inkMat(P.ink);
  const mesh = (geo, m) => { const o = new T.Group(), a = new T.Mesh(geo, m), b = new T.Mesh(geo, ink); a.castShadow = true; o.add(b, a); return o; };
  const { HIP, HY, SPIN, ARMB } = HB;
  const root = new T.Group(), spin = new T.Group(), inner = new T.Group(), turn = new T.Group(), torso = new T.Group(), headG = new T.Group();
  spin.position.y = SPIN; inner.position.y = -SPIN;
  const legL = mesh(P.leg, mat), legR = mesh(P.leg, mat);
  legL.position.set(-4.4, HIP, 0); legR.position.set(4.4, HIP, 0);
  torso.position.y = HIP; torso.add(mesh(P.torso, mat));
  const head = mesh(P.head, headMat); head.scale.x = P.headSX;
  headG.position.y = HY - HIP; headG.add(head, mesh(P.hair, mat));
  const armB = mesh(P.arm, mat); armB.position.set(ARMB[0], ARMB[1] - HIP, ARMB[2]);
  torso.add(headG, armB);
  let tail = null;
  if (P.tail) { tail = mesh(P.tail, mat); tail.position.set(0, HB.BY - 5 - HIP, -9); torso.add(tail); }
  turn.add(legL, legR, torso);
  const weapon = new T.Group(); weapon.add(mesh(P.weapon, wMat));
  // glowing bits: an orb, a flame (unlit, flickering)
  const glows = [];
  for (const [col, x, y, z, r, where] of P.glows) {
    if (!R3.glowGeo) R3.glowGeo = new T.SphereGeometry(1, 14, 10);
    const m = new T.Mesh(R3.glowGeo, new T.MeshBasicMaterial({ color: col })), core = new T.Mesh(R3.glowGeo, new T.MeshBasicMaterial({ color: '#fff6c8' }));
    core.scale.setScalar(0.55); m.add(core); m.position.set(x, y, z);
    (where === 'tail' ? tail : weapon).add(m);
    glows.push({ m, r, tail: where === 'tail' });
  }
  inner.add(turn, weapon); spin.add(inner);
  const decal = new T.Mesh(new T.PlaneGeometry(40, 40), new T.MeshBasicMaterial({ map: groundDecal(team), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  decal.rotation.x = -Math.PI / 2; decal.position.y = 0.5; decal.renderOrder = 2;
  root.add(decal, spin);
  root.scale.setScalar(HERO_VIS * P.big);
  return { sig, root, spin, inner, turn, torso, headG, legL, legR, armB, tail, weapon, decal, glows, mat, wMat, headMat, P,
    turnA: face * 0.5, blinkT: 2 + Math.random() * 3, ex: 0, px: undefined, py: 0, vx: 0, vy: 0, airT: 0, land: 0, recoil: 0, flinch: 0, hurtWas: false, tumble: 0, walkPh: 0, koT: 0, enter: 0 };
}
function r3DropView(id) {
  const v = R3.views.get(id); if (!v) return;
  R3.scene.remove(v.root); r3DisposeRig(v);
  R3.views.delete(id);
}
function r3DisposeRig(v) {
  v.mat.dispose(); v.wMat.dispose(); v.headMat.dispose(); v.decal.geometry.dispose(); v.decal.material.dispose();
  for (const g of v.glows) { g.m.material.dispose(); g.m.children[0].material.dispose(); }
}
function r3Hero(h, t, dt, isActor, face, ang, tribe, won) { r3Pose(heroView(h, tribe), h, t, dt, face, ang, isActor, won); }
/* one frame of animation: idle breathing, walk, aim, charge wobble, recoil, hurt flinch, knock-back tumble, KO, victory hop */
function r3Pose(v, h, t, dt, face, ang, isActor, won) {
  const root = v.root;
  root.visible = true;
  root.position.set(h.x, -h.y, HERO_Z);
  const tt = t + h.id * 1.7;
  // velocities from the motion itself (works the same for the host and for clients)
  if (v.px === undefined || dt <= 0) { v.px = h.x; v.py = h.y; }
  const ivx = dt > 0 ? (h.x - v.px) / dt : 0, ivy = dt > 0 ? (h.y - v.py) / dt : 0;
  v.px = h.x; v.py = h.y;
  const kk = Math.min(1, dt * 12);
  v.vx += (clamp(ivx, -2000, 2000) - v.vx) * kk; v.vy += (clamp(ivy, -3000, 3000) - v.vy) * kk;
  const dead = !!h.dead, air = !dead && h.grounded === false && !h.flying;
  if (air) v.airT += dt; else { if (v.airT > 0.14) v.land = 1; v.airT = 0; }
  v.land = Math.max(0, v.land - dt * 4.5);
  v.recoil = Math.max(0, v.recoil - dt * 4.2);
  const hurt = h.hurtT > 0;
  if (hurt && !v.hurtWas) v.flinch = 1;
  v.hurtWas = hurt; v.flinch = Math.max(0, v.flinch - dt * 2.8);
  v.enter = Math.max(0, v.enter - dt * 1.6);
  if (dead) v.koT += dt; else v.koT = 0;
  // knocked through the air: tumble a little in the direction of travel
  const knock = air && v.airT > 0.06 && Math.abs(v.vx) > 60 && h.key !== 'thachgiap';
  if (knock) v.tumble -= Math.sign(v.vx) * dt * 7.5 * Math.min(1, Math.abs(v.vx) / 300);
  else { v.tumble = Math.atan2(Math.sin(v.tumble), Math.cos(v.tumble)); v.tumble *= Math.max(0, 1 - dt * 9); }
  const ch = h.charge > 0 && !dead ? Math.min(1, h.charge / 100) : 0;
  const walking = h.walking && !dead && !air;
  if (walking) v.walkPh += dt * 13;
  // squash and stretch: stretched while falling fast, squashed on landing, breathing when idle, crouched when charging
  const st = air ? Math.min(0.12, Math.abs(v.vy) / 6500) : 0;
  const lq = Math.sin(v.land * Math.PI) * 0.2 * v.land;
  const br = walking || dead ? 0 : Math.sin(tt * 2.6) * 0.022;
  let hop = 0, hopSq = 0;
  if (won && !dead) { const p = (tt * 1.15) % 1, s = Math.sin(p * Math.PI); hop = s * 10; hopSq = p < 0.12 || p > 0.92 ? 0.08 : -0.03; }
  if (v.enter > 0) { const e = 1 - v.enter; hop = Math.max(hop, Math.sin(Math.min(1, e * 1.6) * Math.PI) * 12); hopSq = e > 0.6 ? Math.sin((e - 0.6) / 0.4 * Math.PI) * 0.12 : -0.04; }
  const sy = 1 + st - lq + br - ch * 0.07 - hopSq - v.flinch * 0.06, sxz = 1 - st * 0.5 + lq * 0.6 - br * 0.5 + ch * 0.05 + hopSq * 0.8 + v.flinch * 0.04;
  const wph = Math.sin(v.walkPh), bob = walking ? Math.abs(wph) * 2.2 : Math.sin(tt * 2.4) * 0.6;
  // turn towards the side the hero faces (3/4 view); mirror while passing the front
  const want = face * (v.portrait ? v.portraitTurn : 0.5);
  v.turnA += (want - v.turnA) * Math.min(1, dt * 11);
  const side = v.turnA >= 0 ? 1 : -1;
  v.turn.scale.set(side * sxz, sy, sxz); v.turn.rotation.y = v.turnA;
  // whole-body rotation about the waist: tumble, KO fall, recoil and flinch leaning back, charge shiver
  const koE = dead ? Math.min(1, v.koT / 0.35) : 0, koEase = 1 - (1 - koE) * (1 - koE);
  const lean = face * (v.recoil * v.recoil * 0.16 + v.flinch * 0.26) + (ch > 0 ? Math.sin(tt * 41) * 0.035 * ch : 0) - (walking ? face * 0.06 : 0);
  v.spin.rotation.z = v.tumble + lean + face * 1.5 * koEase;
  v.spin.position.y = HB.SPIN + hop + (dead ? -HB.SPIN * 0.62 * koEase + 4 * Math.sin(koE * Math.PI) : 0);
  // legs and the free arm swing; arms fly up when falling or tumbling
  const sw = walking ? wph * 0.62 : 0;
  v.legL.rotation.z = sw; v.legR.rotation.z = -sw;
  v.legL.position.y = HB.HIP + (walking ? Math.max(0, -wph) * 1.4 : 0); v.legR.position.y = HB.HIP + (walking ? Math.max(0, wph) * 1.4 : 0);
  v.torso.position.y = HB.HIP + bob - ch * 1.2;
  let armZ = walking ? -sw * 0.9 : Math.sin(tt * 2.2) * 0.06 - 0.05;
  if (air && (v.airT > 0.25 || knock)) armZ = -2.1 + Math.sin(tt * 18) * 0.25;
  if (won || v.enter > 0.3) armZ = -2.4 + Math.sin(tt * 9) * 0.2;
  if (dead) armZ = -1.2;
  v.armB.rotation.z = armZ;
  // the head looks a little along the aim, nods when walking, snaps back when hit
  const a = ang * Math.PI / 180;
  v.headG.rotation.x = -(isActor ? a : 0.2) * 0.22 + v.flinch * 0.25 + (walking ? Math.sin(v.walkPh * 2) * 0.03 : 0);
  v.headG.rotation.z = Math.sin(tt * 1.7) * 0.05 + (ch > 0 ? Math.sin(tt * 37) * 0.03 * ch : 0);
  if (v.tail) { v.tail.rotation.y = Math.sin(tt * 2.1) * 0.35; v.tail.rotation.z = Math.sin(tt * 1.4) * 0.15 + (walking ? 0.2 : 0); }
  // the weapon follows the aim exactly, in the play plane; kicks back on fire
  const rc = v.recoil * v.recoil * 7, pull = ch * 2.2;
  const wa = won ? 1.25 + Math.sin(tt * 6) * 0.1 : dead ? -0.9 : a;
  v.weapon.position.set(face * HB.SH[0] * sxz - Math.cos(wa) * face * (rc + pull), (HB.SH[1] + bob - ch * 1.2) * sy - Math.sin(wa) * (rc + pull), HB.SH[2]);
  v.weapon.scale.set(face, 1, 1); v.weapon.rotation.z = face * (wa + v.recoil * 0.3 + (ch > 0 ? Math.sin(tt * 47) * 0.02 * ch : 0));
  v.weapon.visible = !dead || v.koT < 0.25;
  for (const g of v.glows) { const f = 1 + Math.sin(tt * (g.tail ? 17 : 9) + g.r) * 0.12 + ch * 0.35; g.m.scale.set(g.r * f, g.r * f * (g.tail ? 1.45 : 1), g.r * f); }
  // KO: lie still a moment, then sink away
  const S0 = HERO_VIS * v.P.big;
  if (dead && v.koT > 1.4) root.scale.setScalar(S0 * Math.max(0.001, 1 - (v.koT - 1.4) / 0.8));
  else if (root.scale.x !== S0) root.scale.setScalar(S0);
  // face: expression by state, blinking now and then
  v.blinkT -= dt;
  if (v.blinkT < -0.13) v.blinkT = 1.8 + Math.random() * 3.4;
  const frozen = !!(h.status && h.status.frozen) || h.frozenTurn, stunned = !!(h.status && h.status.stun) || h.stunnedTurn;
  let ex = EX.normal;
  if (dead) ex = EX.ko;
  else if (won || h.flying || v.enter > 0.25) ex = EX.happy;
  else if (hurt || v.flinch > 0.3) ex = EX.hurt;
  else if (knock || (air && v.airT > 0.3) || frozen) ex = EX.wow;
  else if (stunned) ex = EX.hurt;
  else if (ch > 0) ex = EX.charge;
  else if (isActor) ex = EX.aim;
  if ((ex === EX.normal || ex === EX.aim) && v.blinkT < 0) ex = EX.blink;
  if (ex !== v.ex) { v.ex = ex; v.headMat.map = v.P.faces[ex]; }
  // hurt flash, charge glow on the weapon
  const fl = hurt ? 0.5 : v.flinch * 0.3;
  v.mat.emissive.setRGB(fl, fl * 0.12, fl * 0.16);
  v.headMat.emissive.copy(v.mat.emissive);
  const cg = ch > 0 ? ch * (0.3 + 0.15 * Math.sin(tt * 22)) : 0;
  v.wMat.emissive.setRGB(fl + cg, fl * 0.12 + cg * 0.7, fl * 0.16 + cg * 0.2);
  v.decal.visible = !air && !h.flying && !dead;
}

/* ---------- frame ---------- */
// cx, cy: world point at the screen centre; z: device px per world px
function r3Render(S, t, dt, cx, cy, z, vw, vh, local, actorId, aimState) {
  const T = R3.T;
  r3Size(vw, vh);
  r3Quality(dt);
  R3.timeU.value = t;
  if (R3.gen !== TERR.gen || R3.canvasRef !== TERR.canvas) {
    R3.gen = TERR.gen; R3.canvasRef = TERR.canvas;
    for (const id of [...R3.views.keys()]) r3DropView(id);
    r3FacePalette(); r3MapLook(); r3WaterLook(); r3DressInit(); r3EdgesRebuild(true); r3Decor(true); R3.faceVer = TERR.version;
  } else {
    if (R3.dirty.size || R3.rect) r3EdgesRebuild(false);
    R3.faceVer = TERR.version;
    if (R3.decorSrc !== TERR.decor || R3.logo !== LOGO.mask || R3.artN !== ART.n) { R3.artN = ART.n; r3Decor(false); }
  }
  R3.decorSrc = TERR.decor; R3.logo = LOGO.mask;
  // heroes (a fallen hero lies in a KO pose for a moment)
  const tribe = TERR.map === SPECIAL_MAP;
  const winner = S === G ? (G && G.over ? G.winner : -2) : (S.winner ?? -2);
  const seen = R3.seen || (R3.seen = new Set()); seen.clear();
  for (const h of S.heroes) {
    if (h.dead) { const v = R3.views.get(h.id); if (!v || !v.root.visible || v.koT > 2.3) continue; }
    seen.add(h.id);
    const isActor = h.id === actorId && aimState;
    const mine = local && h.id === local.id && isActor;
    r3Hero(h, t, dt, isActor, mine ? Ctl.face : h.face, mine ? Ctl.ang : h.ang, tribe, winner >= 0 && h.team === winner);
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
  R3.inkU.uViewH.value = R3.h; R3.inkU.uInkPx.value = clamp(1.1 + z * 0.8, 1.5, 4.2) * R3.k;
  cam.position.set(cx, -cy + yo, zc); cam.updateMatrixWorld();
  cam.projectionMatrix.makePerspective(-hw * n / zc, hw * n / zc, (hh - yo) * n / zc, (-hh - yo) * n / zc, n, zc + 2000);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  r3Water(S.water, cx, hw, zc);
  R3.waterMat.uniforms.uCam.value.copy(cam.position);
  r3FitShadow(cx, cy, hw, hh);
  R3.renderer.render(R3.scene, cam);
  R3.lift = yo * -DECOR_Z / (zc - DECOR_Z); // how much higher decor looks than the play plane
}
// the key light's shadow camera: fixed direction and origin (stable texels), bounds fitted to what is on screen.
// Light space is (X, Y, L) with X = up × L normalised, Y = L × X: the same basis three.js gives the shadow camera.
function r3FitShadow(cx, cy, hw, hh) {
  const sun = R3.sun, L = R3.sunDir, P = sun.position.set(W / 2, -H / 2, 0).addScaledVector(L, 3000);
  sun.target.position.set(W / 2, -H / 2, 0);
  if (!sun.castShadow) return;
  const X = R3.v1.set(L.z, 0, -L.x).normalize(), Y = R3.v2.crossVectors(L, X), d = R3.v3;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  const m = 60;
  for (let i = 0; i < 8; i++) {
    d.set(i & 1 ? cx + hw + m : cx - hw - m, i & 2 ? -cy + hh + 320 : -cy - hh - 60, i & 4 ? 40 : -SLAB_D - 40).sub(P);
    const a = d.dot(X), b = d.dot(Y), c = d.dot(L);
    x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); z0 = Math.min(z0, c); z1 = Math.max(z1, c);
  }
  const ms = sun.shadow.mapSize.x, ext = Math.ceil(Math.max(x1 - x0, y1 - y0) / 128) * 128, tx = ext / ms;
  x0 = Math.floor(x0 / tx) * tx; y0 = Math.floor(y0 / tx) * tx;
  const sc = sun.shadow.camera;
  sc.left = x0; sc.right = x0 + ext; sc.bottom = y0; sc.top = y0 + ext; sc.near = -z1 - 10; sc.far = -z0 + 10;
  sc.updateProjectionMatrix();
}

/* ---------- portraits: the same models, rendered on a small second renderer ----------
   r3PortraitDraw(g, size, key, team, tribe, t, ang, charge): draws the hero full body into the 2D canvas g (size px
   square, transparent background, a little headroom): idle breathing and blinking driven by t, weapon at angle ang.
   r3PortraitPose(key): the next draw of that hero starts an entrance (a hop with a happy face, arms up). */
const RP = { r: null, enter: {} };
function r3PortraitInit() {
  const T = R3.T, c = document.createElement('canvas');
  const r = new T.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: true });
  r.outputColorSpace = T.LinearSRGBColorSpace; r.setClearColor(0, 0); r.setPixelRatio(1);
  const scene = new T.Scene();
  scene.add(new T.HemisphereLight(0xfff2e8, 0x8a80b4, 1.75));
  const sun = new T.DirectionalLight(0xffe8cc, 2.1); sun.position.set(0.7, 1, 0.8); scene.add(sun);
  Object.assign(RP, { r, c, scene, cam: new T.PerspectiveCamera(24, 1, 10, 3000), rigs: {}, last: {}, fake: { x: 0, y: 0, id: 0, walking: false, hurtT: 0, charge: 0, status: {}, grounded: true, flying: false, dead: false } });
}
function r3PortraitPose(key) { RP.enter[key] = true; }
function r3PortraitDraw(g, size, key, team, tribe, t, ang = 30, charge = 0) {
  if (!R3.ready) return false;
  if (!RP.r) r3PortraitInit();
  const id = key + '|' + team + '|' + (tribe ? 1 : 0);
  let v = RP.rigs[id];
  if (!v) { v = RP.rigs[id] = heroRig(key, team, tribe, 1); v.decal.visible = false; v.portrait = true; v.portraitTurn = 0.32; RP.scene.add(v.root); }
  for (const k in RP.rigs) RP.rigs[k].root.visible = RP.rigs[k] === v;
  if (RP.enter[key]) { RP.enter[key] = false; v.enter = 1; }
  const dt = clamp(t - (RP.last[id] ?? t), 0, 0.1); RP.last[id] = t;
  const f = RP.fake; f.charge = charge;
  r3Pose(v, f, t, dt > 0 ? dt : 0.016, 1, ang, false, false);
  v.decal.visible = false; v.root.position.set(0, 0, 0);
  if (RP.size !== size) { RP.size = size; RP.r.setSize(size, size, false); }
  const s = HERO_VIS * v.P.big, top = (tribe ? 70 : 64) * s, mid = top * 0.47;
  RP.cam.position.set(16 * s, mid + 8 * s, top * 2.9); RP.cam.lookAt(7 * s, mid, 0); RP.cam.updateMatrixWorld();
  R3.inkU.uViewH.value = size; R3.inkU.uInkPx.value = Math.max(1.4, size / 170);
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
  const T = R3.T;
  const live = R3.liveP || (R3.liveP = new Set()); live.clear();
  R3.projs = R3.projs || new Map();
  for (const p of projs) {
    const key = projKey(p);
    if (!P3_KEYS.has(key) || p.id === undefined) continue;
    live.add(p.id);
    let v = R3.projs.get(p.id);
    if (!v || v.key !== key) {
      if (v) R3.scene.remove(v.o);
      const P = projParts(key), o = new T.Group(), body = new T.Mesh(P.geo, P.mat);
      body.castShadow = true;
      o.add(new T.Mesh(P.geo, R3.inkMat), body);
      R3.scene.add(o); v = { o, key, P }; R3.projs.set(p.id, v);
      if (R3.projsSeen) { // a new shell: kick the hero who fired it
        let best = null, bd = 6400;
        for (const hv of R3.views.values()) { if (!hv.root.visible) continue; const dx = hv.root.position.x - p.x, dy = -hv.root.position.y - 26 - p.y, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = hv; } }
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

/* ---------- painted art (decor cards, painted skies, terrain detail) ----------
   art/art.json lists each image; until it has loaded (or if it is missing) the 2D drawings are used. */
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
