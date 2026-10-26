'use strict';
/* ===== Pháo Đài Mây — app: screens, controls, HUD, camera, online rooms ===== */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('pdm.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('pdm.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};
const BOT_NAMES = ['Mây Hồng', 'Gió Nhẹ', 'Sấm Nhỏ', 'Lửa Con', 'Hạt Đậu', 'Mèo Mun', 'Cún Bông', 'Sóc Nâu', 'Bé Nấm', 'Chim Sẻ'];

const App = {
  perTeam: Math.min(3, store.get('perTeam', 2)), diff: store.get('diff', 1), hero: store.get('hero', 'bombi'), name: store.get('name', ''),
  map: store.get('mapv', 0) === 2 ? store.get('map', SPECIAL_MAP) : SPECIAL_MAP, assist: store.get('assist', 1), lastShot: null, pendingShot: null,
  game: null, paused: false, zoomMul: 1, freeCam: 0, overShown: false, boardOpen: false, helpFrom: null, pickingForLobby: false,
  bannerT: 0, lastActor: -1, pings: [], drag: null, mouse: { x: 0, y: 0, wx: 0, wy: 0 },
  gfx: store.get('gfx', '3d') === '2d' ? '2d' : '3d',
};
if (!HEROES[App.hero]) App.hero = 'bombi';
if (App.map !== 'rand' && !MAPS[App.map]) App.map = SPECIAL_MAP;
// the event map is the default; an older saved choice is reset once so everyone starts on it
if (store.get('mapv', 0) !== 2) { store.set('mapv', 2); store.set('map', App.map); }
const Ctl = { ang: 45, face: 1, sel: 0, charging: false, power: 0, dir: 1, lastPower: 0, keys: {}, practice: null, target: null, preset: null, hint: null, hintSig: '', hintT: 0 };
const resolveMap = (m) => (MAPS[m] ? m : pick(MAP_KEYS));
/* online: the host's lobby setting applies to everyone */
const assistLevel = () => clamp(((kind() === 'host' || kind() === 'client') && Net.lob ? Net.lob.as ?? 1 : App.assist) | 0, 0, 2);
const heroTools = (h) => (kind() === 'client' ? h.tools : h.turnBuffs && h.turnBuffs.tools) || [];
/* Thổ Thần buffs as the local view sees them (host: live sim, client: snapshot flags) */
const heroBro = (h) => (kind() === 'client' ? !!h.bro : !!(G && G.actor === h && typeof broNear === 'function' && broNear(h)));
const heroBlessed = (h) => (kind() === 'client' ? !!h.blessed : !!h.blessDmg);
const comboName = (c) => c.keys.map((k) => TOOLS[k].name).join(' + ') + (c.n > 1 ? ` (${c.n} viên)` : '');
/* tools that apply to the weapon slot sel (none for the ult, flight, beam and portal) */
const activeTools = (h, sel) => (sel >= 3 || toolBlocked(HEROES[h.key].shells[sel]) ? [] : heroTools(h));
let CV = null;
const cv = $('cv'), ctx = cv.getContext('2d');
let dpr = 1, cssW = 0, cssH = 0;
const cam = { x: W / 2, y: H / 2, zoom: 1 };

/* ---------- sound ---------- */
const SFX = {
  ac: null, on: store.get('sound', true), musicOn: store.get('music', true), loops: null, voices: [],
  fxVol: store.get('fxVol', 1), musVol: store.get('musVol', 0.8), theme: 'menu', intensity: 0, want: 0,
  init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ac = null; return; }
    const ac = this.ac;
    this.out = ac.createDynamicsCompressor(); this.out.threshold.value = -14; this.out.ratio.value = 4; this.out.connect(ac.destination);
    this.master = ac.createGain(); this.master.gain.value = 0.9; this.master.connect(this.out);
    this.fx = ac.createGain(); this.fx.gain.value = this.on ? this.fxVol : 0; this.fx.connect(this.master);
    // music: its own bus, ducked under big explosions
    this.mus = ac.createGain(); this.mus.gain.value = this.musicOn ? 0.55 * this.musVol : 0;
    this.duckG = ac.createGain(); this.mus.connect(this.duckG); this.duckG.connect(this.master);
    this.rev = ac.createConvolver(); this.rev.buffer = this.impulse(2.2, 2.6, 0);
    this.revIn = ac.createGain(); this.revIn.gain.value = 0.35; this.revIn.connect(this.rev); this.rev.connect(this.master);
    // echo off the canyon walls (Thổ Thần): a feedback delay into the reverb
    this.echo = ac.createDelay(1); this.echo.delayTime.value = 0.34; this.echoFb = ac.createGain(); this.echoFb.gain.value = 0;
    this.echo.connect(this.echoFb); this.echoFb.connect(this.echo); this.echoOut = ac.createGain(); this.echoOut.gain.value = 0; this.echo.connect(this.echoOut); this.echoOut.connect(this.master); this.revIn.connect(this.echo);
    const n = ac.sampleRate * 2; this.noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
    const nd = this.noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) nd[i] = Math.random() * 2 - 1;
    this.loops = { charge: this.loopTone('triangle'), wind: this.loopNoise('lowpass', 400, 0.5) };
    this.startMusic();
  },
  loopTone(type) { const ac = this.ac, o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = 200; g.gain.value = 0; o.connect(g); g.connect(this.fx); o.start(); return { o, g }; },
  loopNoise(ft, f, q) { const ac = this.ac, s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = this.noiseBuf; s.loop = true; fl.type = ft; fl.frequency.value = f; fl.Q.value = q; g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(this.fx); s.start(); return { f: fl, g }; },
  setFx(on) { this.on = on; store.set('sound', on); if (this.fx) this.fx.gain.setTargetAtTime(on ? this.fxVol : 0, this.ac.currentTime, 0.05); },
  setMusic(on) { this.musicOn = on; store.set('music', on); if (this.mus) this.mus.gain.setTargetAtTime(on ? 0.55 * this.musVol : 0, this.ac.currentTime, 0.3); },
  setVol(kind, v) {
    v = clamp(+v, 0, 1);
    if (kind === 'mus') { this.musVol = v; store.set('musVol', v); if (this.mus && this.musicOn) this.mus.gain.setTargetAtTime(0.55 * v, this.ac.currentTime, 0.1); }
    else { this.fxVol = v; store.set('fxVol', v); if (this.fx && this.on) this.fx.gain.setTargetAtTime(v, this.ac.currentTime, 0.05); }
  },
  /* a reverb tail: seconds, decay power, darkness (0 bright … 1 dark: low-passed noise) */
  impulse(sec, pow, dark) {
    const ac = this.ac, len = Math.round(ac.sampleRate * sec), imp = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = imp.getChannelData(c); let lp = 0; const k = 1 - dark * 0.92;
      for (let i = 0; i < len; i++) { lp += ((Math.random() * 2 - 1) - lp) * k; d[i] = lp * Math.pow(1 - i / len, pow) * (1 + dark * 1.5); }
    }
    return imp;
  },
  /* each map sounds like its place: open sky, desert, ice cave, volcano, ruins, the tribe's canyon */
  SPACE: { menu: [1.6, 2.8, 0.2, 0.3, 0], may: [1.4, 3, 0.1, 0.28, 0], sa: [1.8, 2.6, 0.35, 0.3, 0.08], bang: [3.2, 2, 0.05, 0.45, 0], nui: [2.6, 2.2, 0.75, 0.4, 0.05], phe: [2.8, 2.2, 0.4, 0.42, 0.12], tho: [2.2, 2.4, 0.45, 0.36, 0.3] },
  setTheme(theme) {
    if (!this.ac || this.theme === theme) { this.theme = theme; return; }
    this.theme = theme;
    const S = this.SPACE[theme] || this.SPACE.menu, t = this.ac.currentTime;
    this.rev.buffer = this.impulse(S[0], S[1], S[2]);
    this.revIn.gain.setTargetAtTime(S[3], t, 0.3);
    this.echoFb.gain.setTargetAtTime(S[4] ? 0.32 : 0, t, 0.2); this.echoOut.gain.setTargetAtTime(S[4], t, 0.2);
    this.musStep = 0; this.motif = null;
  },
  /* music dips under a big blast, then comes back */
  duck(amount) { if (!this.ac) return; const t = this.ac.currentTime, g = this.duckG.gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(1 - amount, t + 0.03); g.setTargetAtTime(1, t + 0.25, 0.5); },
  vol(d) { return d ? clamp(1 - d / 1800, 0.2, 1) : 1; },
  /* where a world point sits on screen: stereo pan and loudness (fainter off-screen) */
  spatial(x, y) {
    if (x === undefined || !cssW) return { v: 1, pan: 0 };
    const sx = (x - cam.x) * cam.zoom / (cssW / 2), sy = (y - cam.y) * cam.zoom / (cssH / 2);
    const off = Math.max(0, Math.hypot(sx, sy * 0.7) - 1);
    const v = clamp(1 - off * 0.45, 0.22, 1);
    return { v, pan: clamp(sx * 0.75, -0.85, 0.85), lp: v > 0.97 ? 0 : 500 * Math.pow(36, (v - 0.22) / 0.78) };
  },
  /* route a gain node to the fx bus (optionally panned) and the reverb */
  route(g, pan, rev, bus, lp) {
    const ac = this.ac; let out = g;
    if (lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 0.5; out.connect(f); out = f; }
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    out.connect(bus || this.fx);
    if (rev) { const r = ac.createGain(); r.gain.value = rev; out.connect(r); r.connect(this.revIn); }
  },
  osc({ type = 'sine', f = 440, f2 = 0, dur = 0.2, vol = 0.1, at = 0, attack = 0.005, rev = 0, bus = null, pan = 0, lp = 0 }) {
    if (!this.ac) return;
    const ac = this.ac, t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); this.route(g, pan, rev, bus, lp);
    o.start(t); o.stop(t + dur + 0.05);
  },
  noise({ dur = 0.3, vol = 0.2, type = 'lowpass', f = 1200, f2 = 0, q = 0.8, at = 0, attack = 0.004, rev = 0, pan = 0, lp = 0, bus = null }) {
    if (!this.ac) return;
    const ac = this.ac, t = ac.currentTime + at, s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = this.noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t + dur); fl.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); this.route(g, pan, rev, bus, lp);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  },
  tone(f, dur, type = 'sine', vol = 0.1, slide = 1, at = 0) { this.osc({ type, f, f2: slide !== 1 ? f * slide : 0, dur, vol, at }); },

  /* ---------- impacts: crack + body + rumble + debris by material + a signature per shell ---------- */
  boom(r, key, x, y, mat) {
    if (!this.ac) return;
    const sp = this.spatial(x, y), pan = sp.pan, size = clamp(r / 55, 0.55, 1.6), v = sp.v * size;
    if (size > 0.8) this.duck(clamp(0.25 + size * 0.2, 0.3, 0.6) * sp.v);
    if (sp.lp) return this.boomFar(sp, size, mat);
    this.noise({ dur: 0.07, vol: 0.32 * v, type: 'highpass', f: 2400, pan });                                     // crack
    this.osc({ type: 'sine', f: 130 / Math.sqrt(size), f2: 32, dur: 0.55 + size * 0.2, vol: 0.6 * v, pan });       // body
    this.osc({ type: 'triangle', f: 70, f2: 28, dur: 0.8, vol: 0.18 * v * size, pan });                            // sub
    this.noise({ dur: 0.9 + size * 0.4, vol: 0.42 * v, f: 1800, f2: 70, rev: 0.55, pan });                         // rumble tail
    // debris: dirt patters, stone clinks, wood knocks
    if (mat === M_STONE) for (let i = 0; i < 9; i++) { const at = 0.06 + Math.random() * 0.55; this.osc({ type: 'triangle', f: 1300 + Math.random() * 2200, dur: 0.06, vol: 0.035 * v, at, pan: pan + rnd(-0.2, 0.2) }); this.noise({ dur: 0.03, vol: 0.06 * v, type: 'bandpass', f: 3500, q: 3, at, pan }); }
    else if (mat === M_WOOD) for (let i = 0; i < 5; i++) { const at = 0.05 + Math.random() * 0.4; this.osc({ type: 'sine', f: 240 + Math.random() * 160, f2: 150, dur: 0.09, vol: 0.09 * v, at, pan }); this.noise({ dur: 0.04, vol: 0.07 * v, type: 'bandpass', f: 800, q: 2, at, pan }); }
    else if (mat) for (let i = 0; i < 8; i++) this.noise({ dur: 0.05 + Math.random() * 0.05, vol: 0.07 * v, type: 'lowpass', f: 500 + Math.random() * 500, at: 0.15 + Math.random() * 0.7, pan: pan + rnd(-0.25, 0.25) });
    switch (key) {
      case 'ice': // shatter: a shower of glassy pings
        for (let i = 0; i < 14; i++) this.osc({ type: 'triangle', f: 2000 + Math.random() * 3500, dur: 0.18 + Math.random() * 0.4, vol: 0.035 * v, at: Math.random() * 0.35, rev: 0.6, pan: pan + rnd(-0.3, 0.3) });
        this.noise({ dur: 0.35, vol: 0.18 * v, type: 'highpass', f: 5000, pan }); break;
      case 'fire': case 'phoenix': // ignition whoosh + crackles
        this.noise({ dur: 1.0, vol: 0.3 * v, type: 'bandpass', f: 350, f2: 2200, q: 0.6, rev: 0.35, pan });
        for (let i = 0; i < 10; i++) this.noise({ dur: 0.025, vol: 0.12 * v, type: 'highpass', f: 2500, at: 0.1 + Math.random() * 0.9, pan: pan + rnd(-0.3, 0.3) }); break;
      case 'water': // splash and bubbles
        this.noise({ dur: 0.7, vol: 0.26 * v, type: 'bandpass', f: 1500, f2: 600, q: 0.6, rev: 0.3, pan });
        for (let i = 0; i < 12; i++) this.osc({ type: 'sine', f: 280 + Math.random() * 500, f2: 900 + Math.random() * 600, dur: 0.07, vol: 0.06 * v, at: 0.05 + i * 0.045, pan: pan + rnd(-0.2, 0.2) }); break;
      case 'bolt': // thunder crack and a lingering buzz
        this.noise({ dur: 0.08, vol: 0.4 * v, type: 'highpass', f: 1800, pan });
        this.osc({ type: 'sawtooth', f: 1900, f2: 90, dur: 0.45, vol: 0.09 * v, pan });
        this.osc({ type: 'square', f: 60, dur: 0.5, vol: 0.05 * v, attack: 0.01, pan }); break;
      case 'gravity': // suck-in swell, then a hollow drop
        this.osc({ type: 'sine', f: 40, f2: 320, dur: 0.45, vol: 0.22 * v, rev: 0.6, pan });
        this.osc({ type: 'sine', f: 420, f2: 55, dur: 0.6, vol: 0.12 * v, at: 0.42, pan }); break;
      case 'hammer': // metal clang (inharmonic partials) and stunned birdies
        [220, 557, 1123, 1780].forEach((f, i) => this.osc({ type: i ? 'triangle' : 'square', f, dur: 1.1 - i * 0.2, vol: 0.06 * v, rev: 0.5, pan }));
        for (let i = 0; i < 3; i++) this.osc({ type: 'sine', f: 2200, f2: 3000, dur: 0.08, vol: 0.03 * v, at: 0.4 + i * 0.13, pan }); break;
      case 'heal': [523, 659, 784, 1047, 1319].forEach((f, i) => this.osc({ type: 'sine', f, dur: 0.6, vol: 0.05 * v, at: i * 0.06, rev: 0.7, pan })); break;
      case 'sticky': this.osc({ type: 'sine', f: 52, f2: 22, dur: 1.2, vol: 0.45 * v, pan }); this.noise({ dur: 1.4, vol: 0.25 * v, f: 900, f2: 50, rev: 0.6, pan }); break;
      case 'cluster': for (let i = 0; i < 3; i++) { this.noise({ dur: 0.25, vol: 0.2 * v, f: 1700, f2: 200, at: 0.07 * i, pan: pan + (i - 1) * 0.2 }); this.osc({ type: 'sine', f: 180, f2: 50, dur: 0.25, vol: 0.15 * v, at: 0.07 * i, pan }); } break;
      case 'marker': this.osc({ type: 'triangle', f: 1320, dur: 0.35, vol: 0.06 * v, rev: 0.5, pan }); this.osc({ type: 'triangle', f: 1760, dur: 0.3, vol: 0.05 * v, at: 0.1, rev: 0.5, pan }); break;
      case 'mound': this.noise({ dur: 0.8, vol: 0.3 * v, f: 400, f2: 90, pan }); break;
      case 'drill': this.osc({ type: 'sawtooth', f: 120, f2: 60, dur: 0.3, vol: 0.06 * v, pan }); break;
    }
  },
  /* far away: a muffled thump and rumble, no crack */
  boomFar(sp, size, mat) {
    const v = sp.v * size, pan = sp.pan, lp = sp.lp;
    this.osc({ type: 'sine', f: 110 / Math.sqrt(size), f2: 30, dur: 0.7, vol: 0.5 * v, pan, lp });
    this.noise({ dur: 1.1 + size * 0.4, vol: 0.4 * v, f: 900, f2: 60, rev: 0.7, pan, lp });
    if (mat === M_STONE) for (let i = 0; i < 4; i++) this.noise({ dur: 0.04, vol: 0.05 * v, type: 'bandpass', f: 1500, q: 3, at: 0.1 + Math.random() * 0.4, pan, lp });
  },
  /* a hero takes a hit: punchy "thwack", heavier for big hits */
  hit(amount, x, y, mine) {
    const sp = this.spatial(x, y), v = sp.v * clamp(amount / 180, 0.5, 1.4) * (mine ? 1.3 : 1);
    this.noise({ dur: 0.09, vol: 0.22 * v, type: 'bandpass', f: 1100, q: 1.2, pan: sp.pan });
    this.osc({ type: 'sine', f: 240, f2: 85, dur: 0.16, vol: 0.22 * v, pan: sp.pan });
    if (amount > 200) this.osc({ type: 'triangle', f: 110, f2: 45, dur: 0.3, vol: 0.12 * v, pan: sp.pan });
  },
  /* firing: a muzzle pop flavoured by the shell */
  shoot(key, x, y) {
    const sp = this.spatial(x, y), v = sp.v, pan = sp.pan;
    this.osc({ type: 'sine', f: 170, f2: 55, dur: 0.22, vol: 0.33 * v, pan });
    this.noise({ dur: 0.28, vol: 0.2 * v, type: 'bandpass', f: 500, f2: 2600, q: 0.9, pan });
    switch (key) {
      case 'fly': this.noise({ dur: 0.9, vol: 0.15 * v, type: 'bandpass', f: 400, f2: 1600, q: 0.5, rev: 0.4, pan }); break;
      case 'ice': this.osc({ type: 'triangle', f: 1800, f2: 2600, dur: 0.15, vol: 0.05 * v, pan }); break;
      case 'bolt': case 'beam': this.osc({ type: 'sawtooth', f: 900, f2: 2400, dur: 0.12, vol: 0.06 * v, pan }); break;
      case 'water': for (let i = 0; i < 3; i++) this.osc({ type: 'sine', f: 400 + i * 150, f2: 900, dur: 0.06, vol: 0.05 * v, at: i * 0.04, pan }); break;
      case 'fire': this.noise({ dur: 0.4, vol: 0.14 * v, type: 'bandpass', f: 700, f2: 1800, q: 0.7, pan }); break;
      case 'hammer': case 'bouncer': case 'mound': this.osc({ type: 'sine', f: 90, f2: 45, dur: 0.25, vol: 0.2 * v, pan }); break;
      case 'heal': case 'portal': this.osc({ type: 'sine', f: 880, f2: 1320, dur: 0.18, vol: 0.05 * v, rev: 0.5, pan }); break;
    }
  },
  knock(x, y) { const sp = this.spatial(x, y); this.osc({ type: 'sine', f: 190, f2: 110, dur: 0.12, vol: 0.2 * sp.v, pan: sp.pan }); this.noise({ dur: 0.05, vol: 0.12 * sp.v, type: 'bandpass', f: 1300, q: 2, pan: sp.pan }); },
  sizzle(x, y) { const sp = this.spatial(x, y); this.noise({ dur: 1.4, vol: 0.22 * sp.v, type: 'highpass', f: 2600, rev: 0.3, pan: sp.pan }); for (let i = 0; i < 12; i++) this.noise({ dur: 0.02, vol: 0.1 * sp.v, type: 'highpass', f: 4000, at: Math.random() * 1.2, pan: sp.pan }); this.osc({ type: 'sine', f: 90, f2: 40, dur: 0.6, vol: 0.2 * sp.v, pan: sp.pan }); },
  heal() { [659, 784, 988, 1319].forEach((f, i) => this.osc({ type: 'sine', f, dur: 0.35, vol: 0.05, at: i * 0.07, rev: 0.6 })); },
  zap() { this.osc({ type: 'sawtooth', f: 1400, f2: 200, dur: 0.18, vol: 0.06 }); this.noise({ dur: 0.12, vol: 0.1, type: 'highpass', f: 4000 }); },
  combo() { [784, 988, 1175, 1568].forEach((f, i) => this.osc({ type: 'square', f, dur: 0.14, vol: 0.04, at: i * 0.06, rev: 0.4 })); },
  death() { this.osc({ type: 'triangle', f: 520, f2: 120, dur: 0.7, vol: 0.12, rev: 0.4 }); this.noise({ dur: 0.4, vol: 0.15, f: 900, f2: 200, at: 0.1 }); },
  splash(x, y) { const sp = this.spatial(x, y); this.noise({ dur: 0.8, vol: 0.3 * sp.v, type: 'bandpass', f: 1300, f2: 500, q: 0.5, rev: 0.3, pan: sp.pan }); for (let i = 0; i < 6; i++) this.osc({ type: 'sine', f: 400 + Math.random() * 600, f2: 900, dur: 0.07, vol: 0.05 * sp.v, at: 0.1 + i * 0.06, pan: sp.pan }); },
  thud(d) { const v = this.vol(d); this.osc({ type: 'sine', f: 120, f2: 50, dur: 0.2, vol: 0.25 * v }); this.noise({ dur: 0.1, vol: 0.12 * v, f: 600 }); },
  portal() { this.osc({ type: 'sine', f: 400, f2: 1600, dur: 0.4, vol: 0.08, rev: 0.6 }); this.osc({ type: 'triangle', f: 800, f2: 2400, dur: 0.4, vol: 0.04, at: 0.05, rev: 0.6 }); },
  shield() { this.osc({ type: 'triangle', f: 660, f2: 990, dur: 0.25, vol: 0.07, rev: 0.4 }); },
  // Thổ Thần: the war horn (low brass swell) and three drum hits
  horn() {
    this.osc({ type: 'sawtooth', f: 110, f2: 147, dur: 1.4, vol: 0.035, attack: 0.3, rev: 0.7 });
    this.osc({ type: 'triangle', f: 220, f2: 294, dur: 1.4, vol: 0.06, attack: 0.25, rev: 0.7 });
    this.osc({ type: 'sine', f: 55, f2: 74, dur: 1.5, vol: 0.08, attack: 0.3 });
    [1.35, 1.6, 1.85].forEach((at, i) => { this.osc({ type: 'sine', f: 120, f2: 48, dur: 0.3, vol: i === 2 ? 0.22 : 0.16, at }); this.noise({ dur: 0.12, vol: 0.1, f: 900, at }); });
  },
  bless() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.osc({ type: 'sine', f, dur: 0.5, vol: 0.05, at: i * 0.06, rev: 0.8 })); this.noise({ dur: 0.6, vol: 0.04, type: 'highpass', f: 5000, rev: 0.6 }); },
  pillar() { this.osc({ type: 'sine', f: 880, f2: 1320, dur: 0.6, vol: 0.035, attack: 0.1, rev: 0.8 }); },
  pickup() { [988, 1319, 1568].forEach((f, i) => this.osc({ type: 'square', f, dur: 0.1, vol: 0.04, at: i * 0.07 })); },
  ui() { this.osc({ type: 'triangle', f: 880, f2: 660, dur: 0.06, vol: 0.05 }); },
  turn() { [523, 784].forEach((f, i) => this.osc({ type: 'triangle', f, dur: 0.3, vol: 0.07, at: i * 0.12, rev: 0.5 })); },
  myTurn() { [523, 659, 784, 1047].forEach((f, i) => this.osc({ type: 'triangle', f, dur: 0.35, vol: 0.08, at: i * 0.09, rev: 0.5 })); },
  step(d, mat) {
    const v = this.vol(d);
    if (mat === M_STONE) { this.noise({ dur: 0.04, vol: 0.06 * v, type: 'bandpass', f: 2400, q: 2 }); this.osc({ type: 'triangle', f: 900 + Math.random() * 300, dur: 0.03, vol: 0.02 * v }); }
    else if (mat === M_WOOD) { this.osc({ type: 'sine', f: 260 + Math.random() * 40, f2: 170, dur: 0.07, vol: 0.07 * v }); this.noise({ dur: 0.03, vol: 0.04 * v, type: 'bandpass', f: 900, q: 2 }); }
    else if (mat === M_MOUND) this.noise({ dur: 0.08, vol: 0.06 * v, f: 380, q: 0.4 });
    else { this.noise({ dur: 0.06, vol: 0.07 * v, f: 520 + Math.random() * 120, q: 0.5 }); this.noise({ dur: 0.04, vol: 0.025 * v, type: 'highpass', f: 3500, at: 0.01 }); }
  },

  /* ---------- in-flight voices: one per shell on screen, each with its own character ---------- */
  // whistle: sine whose pitch falls as the shell drops · air: wind noise that follows speed
  // buzz: saw drone · crackle: random noise ticks · wobble: vibrato tone · bubbles / sparkle / tick: little blips
  FLY: {
    cannon: { air: [700, 0.9], whistle: [1050, 0.022] }, cluster: { air: [900, 0.6], whistle: [1600, 0.03] },
    drill: { air: [500, 0.6], buzz: [95, 0.045] }, bouncer: { air: [380, 1.0], wobble: [70, 7, 12, 0.03, 'triangle'] },
    hammer: { air: [320, 1.1], wobble: [55, 4, 8, 0.035, 'triangle'] }, mound: { air: [300, 0.9] },
    gravity: { air: [500, 0.4], wobble: [170, 6, 45, 0.04, 'sine'] }, heal: { air: [1400, 0.35], sparkle: [2600, 0.025] },
    water: { air: [900, 0.4], bubbles: [0.045] }, portal: { air: [1600, 0.3], wobble: [880, 9, 30, 0.025, 'triangle'], sparkle: [3200, 0.02] },
    bolt: { air: [2500, 0.4], buzz: [62, 0.03], crackle: [0.09] }, ice: { air: [1800, 0.5], whistle: [2300, 0.018], sparkle: [3800, 0.018] },
    fire: { air: [420, 1.1], crackle: [0.07] }, phoenix: { air: [380, 1.4], crackle: [0.1], wobble: [620, 5, 80, 0.02, 'sawtooth'] },
    sticky: { air: [600, 0.6], tick: [1800, 0.05] }, marker: { air: [900, 0.5], whistle: [1350, 0.02] },
    fly: { air: [600, 1.6] }, beam: {}, barrage: { air: [700, 0.9], whistle: [1050, 0.02] },
  },
  makeVoice(key) {
    const ac = this.ac, spec = this.FLY[key] || this.FLY.cannon, t = ac.currentTime;
    const out = ac.createGain(); out.gain.value = 0;
    const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
    if (pan) { out.connect(pan); pan.connect(this.fx); } else out.connect(this.fx);
    const V = { key, spec, out, pan, nodes: [], t0: t, nextBlip: t, born: performance.now() };
    if (spec.air) { const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = this.noiseBuf; s.loop = true; f.type = 'bandpass'; f.frequency.value = spec.air[0]; f.Q.value = 1.1; g.gain.value = 0; s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random()); V.air = { s, f, g }; V.nodes.push(s); }
    if (spec.whistle) { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = spec.whistle[0]; g.gain.value = 0; o.connect(g); g.connect(out); o.start(t); V.whistle = { o, g }; V.nodes.push(o); }
    if (spec.buzz) { const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain(); o.type = 'sawtooth'; o.frequency.value = spec.buzz[0]; f.type = 'lowpass'; f.frequency.value = 900; lfo.frequency.value = 23; lg.gain.value = spec.buzz[1] * 0.5; lfo.connect(lg); lg.connect(g.gain); g.gain.value = spec.buzz[1]; o.connect(f); f.connect(g); g.connect(out); o.start(t); lfo.start(t); V.nodes.push(o, lfo); }
    if (spec.wobble) { const [f0, rate, depth, vol, type] = spec.wobble, o = ac.createOscillator(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain(); o.type = type; o.frequency.value = f0; lfo.frequency.value = rate; lg.gain.value = depth; lfo.connect(lg); lg.connect(o.frequency); g.gain.value = vol; o.connect(g); g.connect(out); o.start(t); lfo.start(t); V.nodes.push(o, lfo); }
    return V;
  },
  /* blips scheduled into a voice: bubbles, sparkles, sticky-bomb ticks, crackles */
  voiceBlip(V, now) {
    const ac = this.ac, spec = V.spec, t = ac.currentTime;
    const blip = (type, f, f2, dur, vol) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(V.out); o.start(t); o.stop(t + dur + 0.02); };
    if (spec.bubbles) { blip('sine', 250 + Math.random() * 400, 700 + Math.random() * 600, 0.06, spec.bubbles[0]); V.nextBlip = now + 0.05 + Math.random() * 0.07; }
    else if (spec.tick) { blip('square', spec.tick[0], 0, 0.04, spec.tick[1]); V.nextBlip = now + 0.22; }
    else if (spec.crackle) { const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = this.noiseBuf; f.type = 'highpass'; f.frequency.value = 2500 + Math.random() * 2500; g.gain.setValueAtTime(spec.crackle[0], t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03); s.connect(f); f.connect(g); g.connect(V.out); s.start(t, Math.random()); s.stop(t + 0.05); V.nextBlip = now + 0.02 + Math.random() * 0.08; }
    if (spec.sparkle && Math.random() < 0.5) blip('triangle', spec.sparkle[0] * (0.8 + Math.random() * 0.5), 0, 0.12, spec.sparkle[1]);
    if (spec.sparkle && !spec.bubbles && !spec.tick && !spec.crackle) V.nextBlip = now + 0.06 + Math.random() * 0.1;
  },
  killVoice(V) {
    const t = this.ac.currentTime;
    V.out.gain.cancelScheduledValues(t); V.out.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => { for (const n of V.nodes) try { n.stop(); } catch (e) { /* stopped */ } try { V.out.disconnect(); } catch (e) { /* gone */ } }, 400);
  },
  /* match shells on screen to voices (by kind and nearest position), update pitch, pan and loudness */
  flyUpdate(projs) {
    if (!this.ac || !this.loops) return;
    const now = this.ac.currentTime, list = projs.slice(-8), used = new Set();
    for (const p of list) {
      const key = p.kind === 'phoenix' ? 'phoenix' : p.key, speed = Math.hypot(p.vx, p.vy);
      let best = null, bd = 260;
      for (const V of this.voices) if (!used.has(V) && V.key === key) { const d = Math.hypot(V.x - p.x, V.y - p.y); if (d < bd) { bd = d; best = V; } }
      if (!best && this.voices.length < 6) { best = this.makeVoice(key); this.voices.push(best); }
      if (!best) continue;
      used.add(best); best.x = p.x; best.y = p.y; best.seen = now;
      const sp = this.spatial(p.x, p.y), spec = best.spec, k = clamp(speed / 1100, 0.15, 1.3);
      best.out.gain.setTargetAtTime(sp.v * 0.9 / Math.max(1, list.length * 0.6), now, 0.04);
      if (best.pan) best.pan.pan.setTargetAtTime(sp.pan, now, 0.05);
      if (best.air) { best.air.f.frequency.setTargetAtTime(spec.air[0] * (0.6 + k * 0.8), now, 0.05); best.air.g.gain.setTargetAtTime(0.05 * spec.air[1] * k, now, 0.05); }
      if (best.whistle) { best.whistle.o.frequency.setTargetAtTime(clamp(spec.whistle[0] - p.vy * 0.55, spec.whistle[0] * 0.45, spec.whistle[0] * 1.5), now, 0.05); best.whistle.g.gain.setTargetAtTime(spec.whistle[1] * clamp(k, 0.4, 1), now, 0.05); }
      if (best.nextBlip <= now) this.voiceBlip(best, now);
    }
    this.voices = this.voices.filter((V) => { if (used.has(V)) return true; this.killVoice(V); return false; });
  },
  stopFlight() { if (this.ac) for (const V of this.voices) this.killVoice(V); this.voices = []; },
  /* continuous layers, updated every frame */
  charge(p) { if (!this.loops) return; const t = this.ac.currentTime, L = this.loops.charge; if (p < 0) { L.g.gain.setTargetAtTime(0, t, 0.03); return; } L.o.frequency.setTargetAtTime(180 + p * 7, t, 0.02); L.g.gain.setTargetAtTime(0.045, t, 0.03); },
  windAmb(w) { if (!this.loops) return; const t = this.ac.currentTime, L = this.loops.wind; L.g.gain.setTargetAtTime(Math.abs(w) * 0.03, t, 0.5); L.f.frequency.setTargetAtTime(250 + Math.abs(w) * 220, t, 0.5); },
  /* ---------- adaptive music ----------
     16th-note sequencer with a short look-ahead. Each theme has a key, scale, tempo and its instruments; a 2-bar motif
     is composed from the scale and repeated with variations, so it sounds like phrases, not random notes.
     intensity (0 calm … 1 tense, from the match) brings in drums, bass drive and a counter line. */
  THEMES: {
    menu: { bpm: 84, root: 48, scale: [0, 2, 4, 7, 9], prog: [0, 9, 5, 7], lead: 'bell', drums: 'soft' },
    may: { bpm: 100, root: 50, scale: [0, 2, 4, 7, 9], prog: [0, 7, 9, 5], lead: 'pluck', drums: 'pop' },
    sa: { bpm: 92, root: 50, scale: [0, 1, 4, 5, 7, 8, 10], prog: [0, 1, 0, 10], lead: 'reed', drums: 'hand' },
    bang: { bpm: 88, root: 52, scale: [0, 2, 4, 7, 11], prog: [0, 9, 4, 5], lead: 'bell', drums: 'soft' },
    nui: { bpm: 104, root: 45, scale: [0, 2, 3, 7, 8], prog: [0, 8, 3, 7], lead: 'saw', drums: 'heavy' },
    phe: { bpm: 90, root: 47, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 5, 3, 7], lead: 'pluck', drums: 'hand' },
    tho: { bpm: 96, root: 50, scale: [0, 3, 5, 7, 10], prog: [0, 0, 10, 7], lead: 'flute', drums: 'tribal' },
  },
  mf(m) { return 440 * Math.pow(2, (m - 69) / 12); },
  // instruments (all on the music bus)
  inst(kind, f, at, dur, vol, pan = 0) {
    const ac = this.ac, t = ac.currentTime + at, bus = this.mus;
    const env = (g, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + d); };
    const out = (g) => { if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(bus); } else g.connect(bus); };
    if (kind === 'pad') { // two detuned saws through a soft low-pass
      const g = ac.createGain(), fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 900; fl.Q.value = 0.4;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      for (const d of [-7, 7]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d; o.connect(fl); o.start(t); o.stop(t + dur + 0.05); }
      fl.connect(g); out(g); const r = ac.createGain(); r.gain.value = 0.5; g.connect(r); r.connect(this.revIn); return;
    }
    const o = ac.createOscillator(), g = ac.createGain();
    if (kind === 'pluck') { o.type = 'triangle'; const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(f * 6, t); fl.frequency.exponentialRampToValueAtTime(f * 1.2, t + dur); o.connect(fl); fl.connect(g); env(g, 0.004, vol, dur); }
    else if (kind === 'bell') { o.type = 'sine'; const o2 = ac.createOscillator(), g2 = ac.createGain(); o2.type = 'sine'; o2.frequency.value = f * 2.76; env(g2, 0.002, vol * 0.35, dur * 0.5); o2.connect(g2); out(g2); o2.start(t); o2.stop(t + dur); o.connect(g); env(g, 0.003, vol, dur); }
    else if (kind === 'flute' || kind === 'reed') { // breathy, with vibrato after the attack
      o.type = kind === 'reed' ? 'square' : 'sine';
      const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 5.2; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.012, t + 0.25); lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + dur + 0.05);
      const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = kind === 'reed' ? 1400 : 3000; o.connect(fl); fl.connect(g);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.06); g.gain.setValueAtTime(vol * 0.85, t + dur * 0.7); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      const s = ac.createBufferSource(), nf = ac.createBiquadFilter(), ng = ac.createGain(); s.buffer = this.noiseBuf; nf.type = 'bandpass'; nf.frequency.value = f * 2; nf.Q.value = 2; ng.gain.setValueAtTime(vol * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.15); s.connect(nf); nf.connect(ng); out(ng); s.start(t, Math.random()); s.stop(t + 0.2);
      const r = ac.createGain(); r.gain.value = 0.45; g.connect(r); r.connect(this.revIn);
    }
    else if (kind === 'saw') { o.type = 'sawtooth'; const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(2200, t); fl.frequency.exponentialRampToValueAtTime(500, t + dur); o.connect(fl); fl.connect(g); env(g, 0.01, vol * 0.6, dur); }
    else if (kind === 'bass') { o.type = 'triangle'; o.connect(g); env(g, 0.006, vol, dur); }
    else if (kind === 'horn') { o.type = 'sawtooth'; const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(300, t); fl.frequency.linearRampToValueAtTime(1100, t + dur * 0.5); o.connect(fl); fl.connect(g); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + dur); const r = ac.createGain(); r.gain.value = 0.6; g.connect(r); r.connect(this.revIn); }
    o.frequency.setValueAtTime(f, t); out(g); o.start(t); o.stop(t + dur + 0.05);
  },
  drum(kind, at, vol) {
    const bus = this.mus;
    switch (kind) {
      case 'kick': this.osc({ type: 'sine', f: 140, f2: 42, dur: 0.28, vol: vol, at, bus }); break;
      case 'snare': this.noise({ dur: 0.16, vol: vol * 0.55, type: 'bandpass', f: 1800, q: 0.7, at, bus }); this.osc({ type: 'triangle', f: 210, f2: 150, dur: 0.1, vol: vol * 0.35, at, bus }); break;
      case 'hat': this.noise({ dur: 0.035, vol: vol * 0.3, type: 'highpass', f: 7000, at, bus }); break;
      case 'shaker': this.noise({ dur: 0.06, vol: vol * 0.22, type: 'bandpass', f: 5200, q: 1.5, at, bus }); break;
      case 'tomL': this.osc({ type: 'sine', f: 105, f2: 70, dur: 0.38, vol, at, bus }); this.noise({ dur: 0.05, vol: vol * 0.25, f: 700, at, bus }); break;
      case 'tomH': this.osc({ type: 'sine', f: 175, f2: 120, dur: 0.25, vol: vol * 0.8, at, bus }); this.noise({ dur: 0.04, vol: vol * 0.2, f: 1100, at, bus }); break;
      case 'frame': this.osc({ type: 'sine', f: 88, f2: 60, dur: 0.5, vol: vol * 1.1, at, bus }); this.noise({ dur: 0.08, vol: vol * 0.3, type: 'bandpass', f: 400, q: 0.8, at, bus }); break;
      case 'clap': for (let i = 0; i < 3; i++) this.noise({ dur: 0.05, vol: vol * 0.35, type: 'bandpass', f: 1400, q: 1, at: at + i * 0.012, bus }); break;
    }
  },
  // a 2-bar motif: scale degrees and rests, kept for 4 bars then varied
  makeMotif(Th) {
    const notes = [], R = Math.random;
    let d = (R() * Th.scale.length) | 0;
    for (let i = 0; i < 16; i++) {
      if (i % 2 === 1 && R() < 0.6) { notes.push(null); continue; }
      if (R() < 0.3) { notes.push(null); continue; }
      d = clamp(d + [-2, -1, -1, 0, 1, 1, 2][(R() * 7) | 0], 0, Th.scale.length * 2 - 1);
      notes.push(d);
    }
    return notes;
  },
  startMusic() {
    const ac = this.ac;
    this.musStep = 0; this.next = ac.currentTime + 0.3;
    const tick = () => {
      if (!this.musicOn) { this.next = ac.currentTime + 0.2; return; }
      this.intensity += (this.want - this.intensity) * 0.04;
      const Th = this.THEMES[this.theme] || this.THEMES.menu, s16 = 60 / Th.bpm / 4;
      if (this.next < ac.currentTime) this.next = ac.currentTime + 0.05;
      while (this.next < ac.currentTime + 0.3) this.musStepAt(Th, this.next - ac.currentTime, s16), this.next += s16, this.musStep++;
    };
    // a worker tick keeps it going smoothly even when the timer of a background tab is throttled
    startTicker(tick, 50);
  },
  musStepAt(Th, at, s16) {
    const st = this.musStep, bar = (st >> 4) % 4, b16 = st % 16, I = this.intensity, deg = Th.prog[bar];
    const note = (d, oct = 0) => { const n = Th.scale.length, k = ((d % n) + n) % n; return Th.root + deg + Th.scale[k] + 12 * (Math.floor(d / n) + oct); };
    if (!this.motif || (st % 128 === 0 && b16 === 0)) this.motif = this.makeMotif(Th);
    // chords / drone
    if (b16 === 0) {
      if (Th.drums === 'tribal') { this.inst('pad', this.mf(Th.root - 12), at, s16 * 16, 0.035); this.inst('pad', this.mf(Th.root - 5), at, s16 * 16, 0.025); }
      else for (const k of [0, 2, 4]) this.inst('pad', this.mf(note(k, 1) - 12), at, s16 * 16, 0.022);
    }
    // bass
    const bassOn = Th.drums === 'tribal' ? b16 === 0 || b16 === 10 : b16 % 8 === 0 || (I > 0.5 && b16 % 4 === 2);
    if (bassOn) this.inst('bass', this.mf(Th.root + deg - 12), at, s16 * (I > 0.5 ? 2.5 : 5), 0.09 + I * 0.04);
    // lead: the motif (second half of each 4 bars an octave up when tense)
    const m = st % 2 === 0 ? this.motif[(st % 32) >> 1] : null;
    if (st % 2 === 0 && m !== null && m !== undefined) {
      const up = I > 0.65 && bar >= 2 ? 12 : 0;
      this.inst(Th.lead, this.mf(note(m, 1) + up), at, s16 * (Th.lead === 'flute' || Th.lead === 'reed' ? 3.5 : 3), (Th.lead === 'saw' ? 0.03 : 0.045) * (0.8 + I * 0.3), Math.sin(st * 0.7) * 0.25);
    }
    // a counter line of plucked arpeggios when the match heats up
    if (I > 0.45 && b16 % 2 === 1 && Th.lead !== 'pluck') this.inst('pluck', this.mf(note([0, 2, 4, 2][(b16 >> 1) % 4], 1)), at, s16 * 2, 0.022 * I, -0.3);
    if (Th.lead === 'pluck' && b16 % 2 === 1) this.inst('bell', this.mf(note([4, 2, 0, 2][(b16 >> 1) % 4], 2)), at, s16 * 3, 0.012 + I * 0.012, 0.3);
    // drums
    const d = Th.drums, v = 0.07 + I * 0.08;
    if (d === 'tribal') {
      const pat = [1, 0, 0, 2, 0, 0, 1, 0, 1, 0, 2, 0, 0, 0, 3, 0];
      if (pat[b16] === 1) this.drum('frame', at, v * 1.4); else if (pat[b16] === 2) this.drum('tomH', at, v); else if (pat[b16] === 3 && I > 0.3) this.drum('tomL', at, v * 1.2);
      if (I > 0.35 && b16 % 2 === 0) this.drum('shaker', at, v);
      if (I > 0.7 && (b16 === 12 || b16 === 13 || b16 === 15)) this.drum('tomH', at, v * 0.9);
      if (bar === 3 && b16 === 0 && I > 0.55 && (st >> 6) % 2) this.inst('horn', this.mf(Th.root - 12), at, s16 * 14, 0.03);
    } else if (d === 'hand') {
      if (b16 % 8 === 0) this.drum('tomL', at, v); if (b16 % 8 === 6) this.drum('tomH', at, v * 0.7);
      if (I > 0.35 && b16 % 2 === 0) this.drum('shaker', at, v * 0.9);
      if (I > 0.6 && b16 % 8 === 4) this.drum('clap', at, v);
    } else if (I > 0.25 || d === 'heavy') {
      if (b16 % 8 === 0 || (d === 'heavy' && b16 % 8 === 3)) this.drum('kick', at, v * 1.2);
      if (I > 0.4 && b16 % 8 === 4) this.drum(d === 'pop' ? 'clap' : 'snare', at, v);
      if (I > 0.3 && b16 % 2 === 0) this.drum('hat', at, v * (b16 % 4 === 2 ? 1 : 0.6));
      if (I > 0.75 && b16 % 2 === 1) this.drum('hat', at, v * 0.4);
    } else if (d === 'soft' && b16 === 0) this.drum('kick', at, 0.04);
  },
  /* the end of a match: a short fanfare, or a falling phrase */
  stinger(win) {
    if (!this.ac) return;
    const Th = this.THEMES[this.theme] || this.THEMES.menu, r = Th.root + 12;
    this.duck(0.85);
    const seq = win ? [0, 4, 7, 12, 16] : [7, 5, 3, 0];
    seq.forEach((k, i) => this.inst(win ? 'bell' : 'flute', this.mf(r + k), i * 0.14, win ? 0.9 : 0.5, 0.07));
    if (win) { this.drum('kick', 0, 0.14); this.drum('clap', 0.56, 0.12); this.inst('pad', this.mf(r - 12), 0.56, 2.2, 0.05); }
  },
  /* ambience of the place, a sound now and then */
  ambient(dt) {
    if (!this.ac || !this.on) return;
    this.ambT = (this.ambT || 0) - dt; if (this.ambT > 0) return;
    this.ambT = 0.6 + Math.random() * 2.2;
    const th = this.theme, pan = rnd(-0.8, 0.8);
    if (th === 'tho') { // campfire crackle, crickets, a far drum
      if (Math.random() < 0.6) for (let i = 0; i < 4; i++) this.noise({ dur: 0.02, vol: 0.03, type: 'highpass', f: 3000, at: Math.random() * 0.4, pan });
      if (Math.random() < 0.35) for (let i = 0; i < 6; i++) this.osc({ type: 'sine', f: 4300, dur: 0.025, vol: 0.006, at: i * 0.07, pan });
      if (Math.random() < 0.12) this.osc({ type: 'sine', f: 70, f2: 50, dur: 0.6, vol: 0.05, rev: 0.8, pan });
    } else if (th === 'may' || th === 'menu') { // birds
      if (Math.random() < 0.45) { const f = 2400 + Math.random() * 1200; for (let i = 0; i < 2 + (Math.random() * 3 | 0); i++) this.osc({ type: 'sine', f, f2: f * 1.35, dur: 0.07, vol: 0.012, at: i * 0.11, pan }); }
    } else if (th === 'nui') { // the volcano rumbles, rocks settle
      if (Math.random() < 0.5) this.noise({ dur: 2.2, vol: 0.05, f: 140, f2: 60, attack: 0.6, pan });
      if (Math.random() < 0.3) this.noise({ dur: 0.05, vol: 0.03, type: 'bandpass', f: 1600, q: 3, pan });
    } else if (th === 'bang') { // icy chimes in the wind
      if (Math.random() < 0.4) this.osc({ type: 'triangle', f: 2600 + Math.random() * 1600, dur: 0.8, vol: 0.008, rev: 0.9, pan });
    } else if (th === 'sa') { if (Math.random() < 0.4) this.noise({ dur: 2.5, vol: 0.03, type: 'bandpass', f: 600, f2: 1300, q: 0.6, attack: 1, pan }); }
    else if (th === 'phe') { if (Math.random() < 0.18) this.osc({ type: 'sine', f: 660, dur: 2.2, vol: 0.012, rev: 0.9, pan }); }
  },
};

/* ---------- sizing ---------- */
/* touch devices get the pad + big fire button and a compact HUD; small windows get the compact HUD too */
const TOUCHUI = /[?&]touch=1/.test(location.search) || matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(any-pointer: fine)').matches);
document.documentElement.classList.toggle('touchui', TOUCHUI);
if (TOUCHUI) { P_MAX = 380; AMB_K = 0.5; }
const buzz = (p) => { if (TOUCHUI && navigator.vibrate) try { navigator.vibrate(p); } catch (e) { /* not allowed */ } };
/* render scale drops automatically when frames take too long (big Retina canvases on modest GPUs) */
const RS = { k: 1, cost: 0, gap: 0, n: 0 };
function resize() {
  document.documentElement.classList.toggle('compact', TOUCHUI || window.innerHeight < 560 || window.innerWidth < 760);
  dpr = Math.min(TOUCHUI ? 1.5 : 2, window.devicePixelRatio || 1) * RS.k; cssW = window.innerWidth; cssH = window.innerHeight; cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr); updateRotate(); }
window.addEventListener('resize', resize);

/* ---------- world access ---------- */
const kind = () => (App.game ? App.game.kind : null);
const world = () => (kind() === 'client' ? CV : G);
function localHero() { const S = world(); if (!S || !App.game || App.game.kind === 'demo') return null; return S.heroes.find((h) => h.id === App.game.localId) || null; }
function viewState(S) {
  if (S === G) return { state: G.state, actorId: G.actor ? G.actor.id : 0, queueIds: G.queue.map((h) => h.id), phaseTeam: G.phaseTeam, round: G.round, turnT: G.turnT, wind: G.wind, prevWind: G.prevWind, water: G.water, winner: G.over ? G.winner : -2 };
  return { state: CV.state, actorId: CV.actorId, queueIds: CV.queue, phaseTeam: CV.phaseTeam, round: CV.round, turnT: CV.turnT - (performance.now() - CV.recv) / 1000 * (CV.state === 'aim' ? 1 : 0), wind: CV.wind, prevWind: CV.prevWind ?? CV.wind, water: CV.water, winner: CV.winner };
}

/* ---------- portraits ---------- */
const portraitCache = {};
function portrait(key, team, size = 96, tribe = false) {
  const three = App.gfx === '3d' && R3.ready;
  const id = key + team + size + (tribe ? 't' : '') + (three ? '3' + ART.n : ''); // ART.n: painted heroes loaded so far
  if (portraitCache[id]) return portraitCache[id];
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  if (three && r3PortraitDraw(g, size, key, team, tribe, 0.3, 30)) return (portraitCache[id] = c.toDataURL());
  g.scale(size / 80, size / 80);
  if (tribe) drawHero(g, key, team, 40, 92, 1, 30, 0.3, { noShadow: true, scale: 1.12, tribe: true });
  else drawHero(g, key, team, 40, 74, 1, 30, 0.3, { noShadow: true, scale: 1.25 });
  return (portraitCache[id] = c.toDataURL());
}

/* ---------- menu ---------- */
function renderRoster() {
  $('roster').innerHTML = HERO_KEYS.map((k) => `<button class="hcard ${k === App.hero ? 'on' : ''}" data-k="${k}"><canvas width="220" height="220" data-k="${k}"></canvas><b>${HEROES[k].name}</b><small>${HEROES[k].role}</small></button>`).join('');
  const D = HEROES[App.hero];
  const pip = (n) => `<div class="pips">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'f' : ''}"></i>`).join('')}</div>`;
  const shell = (k, i) => { const S = SHELLS[k]; return `<div class="kit-item"><div class="ic">${S.icon}<b>${i + 1}</b></div><div><h5>${S.name}</h5><div class="meta">${S.dmg ? 'Sát thương ' + S.dmg + ' · ' : ''}Delay ${S.delay}</div><p>${S.desc}</p></div></div>`; };
  const sk = SKILLS[D.skill], ul = ULTS[D.ult];
  // title screen: the hero's name over the big 3D model; the full kit opens on demand
  $('tsHero').innerHTML = `<h2>${D.name}</h2><span class="role" style="background:${D.dark}">${D.role} · ${D.hp} máu</span><p>${D.tag}</p><button class="kitbtn" type="button">${$('detail').hidden ? 'Xem kỹ năng ▴' : 'Ẩn kỹ năng ▾'}</button>`;
  $('detail').innerHTML = `<div>
    <div class="statbars"><span>Tấn công</span>${pip(D.stats.atk)}<span>Phòng thủ</span>${pip(D.stats.def)}<span>Khống chế</span>${pip(D.stats.ctrl)}<span>Hỗ trợ</span>${pip(D.stats.sup)}<span>Dễ chơi</span>${pip(D.stats.easy)}</div></div>
    <div><h2>${D.name}</h2><span class="role" style="background:${D.dark}">${D.role} · ${D.hp} máu</span><p class="tagline">${D.tag}</p>
    <div class="kit">
      <div class="kit-item passive"><div class="ic">✦</div><div><h5>Nội tại · ${D.passive.name}</h5><p>${D.passive.desc}</p></div></div>
      ${D.shells.map(shell).join('')}
      <div class="kit-item"><div class="ic">${sk.icon}<b>Q</b></div><div><h5>${sk.name}</h5><div class="meta">Hồi ${sk.cd} lượt · không tốn lượt bắn</div><p>${sk.desc}</p></div></div>
      <div class="kit-item" style="background:#fff6d6"><div class="ic">${ul.icon}<b>R</b></div><div><h5>Tuyệt kỹ · ${ul.name}</h5><div class="meta">Cần 100 Nộ</div><p>${ul.desc}</p></div></div>
    </div></div>`;
}
/* title screen: the settings and online panels, the match summary line, the kit toggle */
function tsPanel(id) {
  for (const p of ['pSetup', 'pOnline']) $(p).hidden = p !== id;
  $('menu').classList.toggle('paneled', !!id);
}
function tsSummary() {
  const mapName = App.map === 'rand' ? 'Bản đồ ngẫu nhiên' : MAPS[App.map] ? MAPS[App.map].name : '';
  $('tsSum').innerHTML = `<b>${App.perTeam}v${App.perTeam}</b> · Bot ${DIFF[App.diff].name} · Ngắm ${ASSIST[App.assist].name} · ${esc(mapName)}`;
}
$('menu').addEventListener('click', (e) => {
  const t = e.target.closest('[data-panel],[data-back],[data-play],.kitbtn'); setTimeout(tsSummary, 0);
  if (!t) return;
  SFX.init(); SFX.ui();
  if (t.dataset.panel) tsPanel(t.dataset.panel);
  else if (t.hasAttribute('data-back')) tsPanel(null);
  else if (t.hasAttribute('data-play')) { tsPanel(null); $('btnPlay').click(); }
  else { $('detail').hidden = !$('detail').hidden; t.textContent = $('detail').hidden ? 'Xem kỹ năng ▴' : 'Ẩn kỹ năng ▾'; }
});
$('roster').addEventListener('click', (e) => { const b = e.target.closest('.hcard'); if (!b) return; App.hero = b.dataset.k; store.set('hero', App.hero); if (typeof r3PortraitPose === 'function') r3PortraitPose(App.hero); SFX.init(); SFX.ui(); renderRoster(); heroChanged(); });
function animateMenu(t) {
  if ($('menu').hidden) return;
  if (gfx3D()) { // 3D models: the small cards once, the big one animated
    document.querySelectorAll('#roster canvas').forEach((c) => {
      if (c.dataset.r3 === String(ART.n)) return;
      const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
      if (r3PortraitDraw(g, c.width, c.dataset.k, -1, false, 0.3, 35)) c.dataset.r3 = ART.n;
    });
    const big = $('bigHero');
    if (big) { const n = big.width, g = big.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, n, n); r3PortraitDraw(g, n, App.hero, 0, false, t, 35 + Math.sin(t) * 15, Math.sin(t * 0.7) > 0.6 ? 40 : 0); }
    return;
  }
  document.querySelectorAll('#roster canvas').forEach((c) => {
    const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.scale(c.width / 80, c.width / 80);
    drawHero(g, c.dataset.k, -1, 40, 68, 1, 35, t + c.dataset.k.length, { scale: 1.05 });
  });
  const big = $('bigHero');
  if (big) { const n = big.width, g = big.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, n, n); g.scale(n / 80, n / 80); drawHero(g, App.hero, 0, 40, 66, 1, 35 + Math.sin(t) * 15, t, { scale: 1.15, charge: Math.sin(t * 0.7) > 0.6 ? 40 : 0 }); }
}
/* graphics: '3d' (WebGL, loaded on first use) or '2d' (the canvas renderer, also the fallback) */
function gfx3D() {
  const want = App.gfx === '3d';
  if (want && !R3.ready && !R3.failed) r3Load().then((ok) => { if (!ok && App.gfx === '3d') toast('Máy này chưa chạy được đồ hoạ 3D, đang dùng 2D', true); });
  const on = want && R3.ready;
  r3Sync(on);
  return on;
}
function gfxRefresh() { renderRoster(); if (Net.lob && !$('lobby').hidden) renderLobby(); App.orderSig = ''; }
function setGfx(v) {
  App.gfx = v === '2d' ? '2d' : '3d'; store.set('gfx', App.gfx);
  document.documentElement.classList.toggle('g3', App.gfx === '3d');
  if (App.gfx === '3d') r3Load().then((ok) => { if (ok) gfxRefresh(); }); else gfxRefresh();
  document.querySelectorAll('.gfxSeg').forEach((el) => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.g === App.gfx)));
}
document.addEventListener('click', (e) => { const b = e.target.closest('.gfxSeg button'); if (!b) return; SFX.ui(); setGfx(b.dataset.g); });
function segInit(id, val, cb) {
  const el = $(id); const set = (v) => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.v === v));
  set(val); el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; set(+b.dataset.v); SFX.ui(); cb(+b.dataset.v); });
  return set;
}
segInit('modeSeg', App.perTeam, (v) => { App.perTeam = v; store.set('perTeam', v); });
segInit('diffSeg', App.diff, (v) => { App.diff = v; store.set('diff', v); });
$('nameIn').value = App.name;
/* name can be changed from the menu or inside a room; in a room everyone sees the new name */
function setPlayerName(v, from) {
  App.name = String(v).trim().slice(0, 14); store.set('name', App.name);
  if (from !== 'menu') $('nameIn').value = App.name;
  if (from !== 'lobby') $('lobName').value = App.name;
  clearTimeout(App.nameT);
  App.nameT = setTimeout(() => {
    if (Net.role === 'client' && Net.nr) Net.nr.presence({ n: playerName() }).catch(() => {});
    if (Net.role === 'host' && Net.lob && Net.lob.st === 'lobby') { const sl = Net.lob.sl.find((x) => x[0] === '@h'); if (sl) { sl[1] = cleanName(playerName()); publishLob(); renderLobby(); } }
  }, 250);
}
$('nameIn').addEventListener('input', () => setPlayerName($('nameIn').value, 'menu'));
$('lobName').addEventListener('input', () => setPlayerName($('lobName').value, 'lobby'));
const playerName = () => App.name || 'Người chơi';

/* map picker: small previews rendered once from a fixed seed */
const mapPreviews = {};
function buildMapPreviews() {
  for (const k of ALL_MAPS) {
    genTerrain(1234, 2, k);
    const M = MAPS[k], c = document.createElement('canvas'), cw = 240, ch = 130; c.width = cw; c.height = ch;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, ch);
    [0, 0.45, 0.78, 1].forEach((o, i) => gr.addColorStop(o, M.sky.stops[i])); g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
    if (M.sky.sun) { g.fillStyle = M.sky.sun.col; g.beginPath(); g.arc(cw * M.sky.sun.x, ch * M.sky.sun.y, 7, 0, 7); g.fill(); }
    const img = g.getImageData(0, 0, cw, ch), d = img.data, P = TERR.pal, sx = W / cw, sy = H / ch;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const wx = x * sx + sx / 2, wy = y * sy + sy / 2, m = matAt(wx, wy); if (!m) continue;
      const top = !solid(wx, wy - sy * 1.2), c3 = m === M_STONE ? (top ? P.stoneTop : P.stone) : m === M_WOOD ? P.wood : top ? P.top : P.soil, o = (y * cw + x) * 4;
      d[o] = c3[0]; d[o + 1] = c3[1]; d[o + 2] = c3[2]; d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const wl = (H - 70) / sy, lg = g.createLinearGradient(0, wl, 0, ch); lg.addColorStop(0, M.liquid.stops[0]); lg.addColorStop(1, M.liquid.stops[2]);
    g.fillStyle = lg; g.fillRect(0, wl, cw, ch - wl);
    mapPreviews[k] = c.toDataURL();
  }
  mapPreviews.banner = specialBanner();
}
/* banner for the event map: its sky, the rainbow pillars, the tribe lined up and the title */
function specialBanner() {
  const M = MAPS[SPECIAL_MAP], c = document.createElement('canvas'), cw = 600, ch = 250; c.width = cw; c.height = ch;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, ch);
  [0, 0.45, 0.78, 1].forEach((o, i) => gr.addColorStop(o, M.sky.stops[i])); g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
  g.save(); g.globalCompositeOperation = 'lighter';
  ['63,210,122', '255,90,74', '255,210,63', '63,140,255', '255,63,106'].forEach((col, k) => {
    const x = 380 + (k - 2) * 70, lg = g.createLinearGradient(0, 0, 0, ch);
    lg.addColorStop(0, `rgba(${col},0)`); lg.addColorStop(0.6, `rgba(${col},0.35)`); lg.addColorStop(1, `rgba(${col},0.6)`);
    g.fillStyle = lg; g.fillRect(x - 24, 0, 48, ch);
  });
  g.restore();
  g.fillStyle = 'rgba(150,70,100,0.55)';
  for (const [x, w, h] of [[60, 120, 70], [520, 150, 90], [430, 70, 50]]) { g.beginPath(); g.moveTo(x - w / 2, ch - 40); g.lineTo(x - w * 0.36, ch - 40 - h); g.lineTo(x + w * 0.36, ch - 40 - h); g.lineTo(x + w / 2, ch - 40); g.closePath(); g.fill(); }
  g.fillStyle = '#c8643c'; g.fillRect(0, ch - 46, cw, 46);
  g.fillStyle = '#f2b872'; g.fillRect(0, ch - 50, cw, 6);
  g.fillStyle = '#d8432f'; zigzag(g, 0, cw, ch - 30, 8, 60); g.fill();
  const order = ['loivu', 'moclan', 'bombi', 'thachgiap', 'hoamieu'];
  order.forEach((k, i) => { const x = 380 + (i - 2) * 70, big = i === 2 ? 1.9 : 1.55; drawHero(g, k, -1, x, ch - 46, i < 2 ? 1 : i > 2 ? -1 : 1, i === 2 ? 70 : 30, i * 0.7, { tribe: true, noShadow: true, scale: big }); });
  g.textAlign = 'left'; g.lineJoin = 'round';
  g.font = '800 34px "Baloo 2", sans-serif'; g.lineWidth = 7; g.strokeStyle = '#5a1a10';
  for (const [txt, y] of [['THỔ THẦN', 44], ['GIAO TRANH', 80]]) { g.strokeText(txt, 16, y); const tg = g.createLinearGradient(0, y - 28, 0, y); tg.addColorStop(0, '#fff3a0'); tg.addColorStop(1, '#ff8a2a'); g.fillStyle = tg; g.fillText(txt, 16, y); }
  if (!drawLogo(g, 14, 86, 44, '#ffffff')) { g.font = '800 13px "Baloo 2", sans-serif'; g.fillStyle = '#fff'; g.fillText('GAMOTA · GAME IS GOOD', 18, 102); }
  return c.toDataURL();
}
function renderMapPick() {
  const card = (k, img, name) => `<button class="mcard ${App.map === k ? 'on' : ''}" data-m="${k}" title="${esc(name)}">${img}<b>${esc(name)}</b></button>`;
  $('mapPick').innerHTML = card('rand', '<span class="mrand">🎲</span>', 'Ngẫu nhiên') + MAP_KEYS.map((k) => card(k, `<img src="${mapPreviews[k]}" alt="">`, MAPS[k].name)).join('');
  const SM = MAPS[SPECIAL_MAP], sp = $('mapSpecial');
  sp.classList.toggle('on', App.map === SPECIAL_MAP);
  if (!sp.dataset.built) {
    sp.dataset.built = 1;
    sp.innerHTML = `<img src="${mapPreviews.banner}" alt=""><span class="ms-on">✓ Đang chọn</span><span class="ms-b"><b>${SM.icon} ${esc(SM.name)}</b><small>${esc(SM.tagline)} · nhân vật mặc áo bộ lạc</small><span class="ms-r">${SM.rules.map((r) => `<span title="${esc(r[2])}">${r[0]} ${esc(r[1])}</span>`).join('')}</span></span>`;
  }
  // the description sits under whichever area holds the chosen map
  const special = App.map === SPECIAL_MAP;
  $('mapSpecialDesc').hidden = !special; $('mapDesc').hidden = special;
  (special ? $('mapSpecialDesc') : $('mapDesc')).textContent = App.map === 'rand' ? 'Mỗi trận một bản đồ thường bất kỳ.' : MAPS[App.map].desc;
}
// the logo image loads after the menu is built: redraw the banner with it
LOGO.onReady = () => { if (!mapPreviews.banner) return; mapPreviews.banner = specialBanner(); const im = $('mapSpecial').querySelector('img'); if (im) im.src = mapPreviews.banner; };
$('mapSpecial').addEventListener('click', () => { App.map = SPECIAL_MAP; store.set('map', App.map); SFX.init(); SFX.ui(); renderMapPick(); });
$('mapPick').addEventListener('click', (e) => { const b = e.target.closest('.mcard'); if (!b) return; App.map = b.dataset.m; store.set('map', App.map); SFX.init(); SFX.ui(); renderMapPick(); });
const assistNote = () => { $('assistDesc').textContent = ASSIST[App.assist].desc; };
segInit('assistSeg', App.assist, (v) => { App.assist = v; store.set('assist', v); assistNote(); });
assistNote();
function heroChanged() {
  if (Net.role === 'client' && Net.nr) Net.nr.presence({ h: App.hero }).catch(() => {});
  if (Net.role === 'host' && Net.lob && Net.lob.st === 'lobby') { const s = Net.lob.sl.find((s) => s[0] === '@h'); if (s) { s[2] = App.hero; publishLob(); renderLobby(); } }
}

/* ---------- help ---------- */
function renderHelp() {
  $('helpBody').innerHTML = `
  <section><h3>Điều khiển</h3><ul>
    <li><kbd>←</kbd> <kbd>→</kbd> di chuyển (tốn thể lực) · <kbd>↑</kbd> <kbd>↓</kbd> chỉnh góc (giữ <kbd>Shift</kbd> để chỉnh từng chút).</li>
    <li>Giữ <kbd>Space</kbd> để nạp lực, thả ra để bắn. Thanh lực chạy lên 100 rồi tự chạy ngược về 0. Vạch đen là lực lần trước.</li>
    <li><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> chọn đạn · <kbd>4</kbd> <kbd>5</kbd> <kbd>6</kbd> đạo cụ +1 / +2 / x3 · <kbd>R</kbd> Tuyệt kỹ (đầy Nộ) · <kbd>B</kbd> Bay · <kbd>Q</kbd> kỹ năng · <kbd>Z</kbd> <kbd>X</kbd> <kbd>C</kbd> dùng vật phẩm.</li>
    <li><b>Chọn mục tiêu:</b> bấm chuột vào địch (hoặc bấm <kbd>T</kbd> để đổi lần lượt). Bấm vào chỗ trống để nhắm một điểm, ví dụ rương. Mặc định là địch gần nhất, nhân vật tự quay mặt về phía mục tiêu.</li>
    <li>Sau mỗi phát bắn, chỗ đạn rơi có dấu ✕ ghi góc và lực, kèm chữ <b>Xa quá / Thiếu … ô</b> so với mục tiêu. Dựa vào đó để chỉnh lực lượt sau.</li>
    <li><b>Kéo chuột</b> (hoặc kéo ngón tay) để nhìn quanh bản đồ. Khi kéo sẽ hiện <b>thước đo</b> từ bạn tới con trỏ. Giữ <kbd>M</kbd> để đo mà không kéo. <kbd>F</kbd> về lại camera, lăn chuột để phóng to.</li>
    <li>Trên đầu mỗi địch luôn có khoảng cách tới bạn: số ô theo chiều ngang, ↑ là địch cao hơn bạn, ↓ là thấp hơn. 1 ô = ${UNIT}px.</li>
    <li><kbd>G</kbd> đánh dấu vị trí con trỏ cho đồng đội.</li>
    <li><b>Điện thoại:</b> ◀ ▶ để đi, ▲ ▼ chỉnh góc (chạm là 1°, giữ thì chạy liên tục), giữ nút <b>BẮN</b> để nạp lực rồi thả. Kéo một ngón để nhìn quanh, chụm hai ngón để thu phóng, nhấn giữ một tướng để xem thông tin. Nên xoay ngang và bật toàn màn hình (nút ⛶).</li>
    <li>Chưa tới lượt vẫn chỉnh góc và nạp lực được để <b>ngắm thử</b>: thấy điểm rơi dự kiến nhưng không bắn thật.</li></ul></section>
  <section><h3>Hỗ trợ ngắm</h3><ul>
    ${ASSIST.map((a, i) => `<li><b>${a.name}${i === 1 ? ' (mặc định)' : ''}:</b> ${a.desc}</li>`).join('')}
    <li>Ở mức Dễ: bấm hoặc kéo trên thanh lực để đặt lực, <kbd>[</kbd> <kbd>]</kbd> chỉnh ±0.5, rồi nhấn <kbd>Enter</kbd> hoặc nút BẮN. Giữ <kbd>Space</kbd> vẫn nạp lực như thường.</li>
    <li>Vạch 🎯 xanh trên thanh lực là lực gợi ý cho góc hiện tại. Đổi góc thì vạch tự cập nhật.</li>
    <li>Chơi online thì chủ phòng chọn mức hỗ trợ cho cả phòng.</li></ul></section>
  <section><h3>Đạo cụ bắn (kiểu Gunny)</h3><ul>
    ${TOOL_KEYS.map((k) => `<li><kbd>${TOOLS[k].key}</kbd> <b>${TOOLS[k].name}</b> (${TOOLS[k].cost} thể lực): ${TOOLS[k].desc}</li>`).join('')}
    <li><b>Dùng chung được</b> như Gunny: +2 với x3 là 3 loạt × 3 viên = 9 viên; bật cả ba là 4 loạt × 3 viên. Càng nhiều viên thì mỗi viên càng yếu (${ROUND_MULT.slice(1).map((m) => Math.round(m * 100) + '%').join(' / ')} theo số loạt thêm, x3 nhân thêm ${Math.round(FAN_MULT * 100)}%).</li>
    <li>Bấm lại để hủy và lấy lại thể lực.</li></ul></section>
  <section><h3>Thể lực</h3><ul>
    <li>Mỗi lượt có ${STAMINA} thể lực ⚡, dùng chung cho di chuyển, đạn, kỹ năng và đạo cụ. Đi hết thanh được khoảng ${Math.round(STAMINA / WALK_ST / UNIT)} ô.</li>
    <li>Đạn đầu tiên của mỗi tướng miễn phí. Các đạn mạnh hơn tốn ${[...new Set(HERO_KEYS.flatMap((k) => HEROES[k].shells.map((s) => SHELLS[s].st)).filter(Boolean))].sort((a, b) => a - b).join(' / ')}, Bay tốn ${SHELLS.fly.st}, kỹ năng Q tốn ${[...new Set(Object.values(SKILLS).map((s) => s.st))].sort((a, b) => a - b).join(' / ')}. Số ⚡ nhỏ ở góc mỗi nút là giá.</li>
    <li>Thể lực của đạn đang chọn được giữ lại: đi bộ không ăn vào phần đó. Tuyệt kỹ không tốn thể lực (dùng Nộ).</li>
    <li>Không dùng với Tuyệt kỹ, Bay, Tia Chớp và Hạt Dịch Chuyển.</li></ul></section>
  <section><h3>Gió</h3><ul>
    <li>Gió từ 0 đến ${WIND_MAX}, đổi nhẹ sau mỗi lượt (thỉnh thoảng đổi hẳn). Ô gió ở trên cùng ghi cả <b>gió lượt trước</b> và mức thay đổi.</li>
    <li>Cách căn: lượt trước bắn lực L với gió g₁ rơi đúng chỗ, lượt này gió là g₂ thì lực mới ≈ <b>L × √((1 − 0.029 × g₂) ÷ (1 − 0.029 × g₁))</b> (gió xuôi mang dấu +, ngược mang dấu −). Gió đổi 1 vạch thì lực đổi khoảng 1.5%.</li></ul></section>
  <section><h3>⭐ Map đặc biệt: ${MAPS[SPECIAL_MAP].name}</h3><ul>
    <li>${MAPS[SPECIAL_MAP].desc}</li>
    ${MAPS[SPECIAL_MAP].rules.map((r) => `<li>${r[0]} <b>${r[1]}:</b> ${r[2]}</li>`).join('')}
    <li>🌈 Màu cột sáng: ${BLESS.map((b) => `<b style="color:${b.col}">${b.name}</b> (${b.desc})`).join(', ')}.</li></ul></section>
  <section><h3>Bản đồ thường</h3><ul>
    ${MAP_KEYS.map((k) => `<li>${MAPS[k].icon} <b>${MAPS[k].name}:</b> ${MAPS[k].desc}</li>`).join('')}</ul></section>
  <section><h3>Lượt chơi theo đội</h3><ul>
    <li>Mỗi vòng, một đội đi trước rồi tới đội kia (đổi đội đi trước mỗi vòng).</li>
    <li>Trong đội, ai có <b>delay</b> thấp hơn được đi trước. Đạn mạnh, kỹ năng, vật phẩm đều cộng delay. Dùng thứ tự này để xếp combo: người làm Ướt đi trước, người đánh Sét đi sau.</li>
    <li>Mỗi lượt có ${TURN_TIME} giây, cộng thêm ${BANK_TIME} giây dự trữ cho cả trận khi cần suy nghĩ lâu.</li>
    <li>Đồng đội thấy góc ngắm của bạn và các dấu đánh dấu bằng <kbd>G</kbd>.</li>
    <li>Rớt xuống nước là bị loại. Từ vòng ${SUDDEN_ROUND}, nước dâng dần. Đội còn người cuối cùng thắng.</li>
    <li>Rơi từ độ cao hơn ${FALL_SAFE}px (ví dụ bị phá đất dưới chân) sẽ mất máu, tối đa ${FALL_MAX}.</li></ul></section>
  <section><h3>Combo trạng thái</h3><ul>
    ${Object.keys(STATUS).map((k) => `<li>${STATUS[k].icon} <b>${STATUS[k].name}:</b> ${STATUS[k].desc}</li>`).join('')}
    <li>Ví dụ: Mộc Lan bắn Bong Bóng Nước, rồi Lôi Vũ bắn Cầu Sét → sát thương ×1.8 và lan sang kẻ bên cạnh.</li></ul></section>
  <section><h3>Rương thả dù</h3><ul>
    <li>Cứ 2 vòng có rương rơi xuống. Chạm vào để nhặt (tối đa 3 món).</li>
    ${ITEM_KEYS.map((k) => `<li>${ITEMS[k].icon} <b>${ITEMS[k].name}:</b> ${ITEMS[k].desc}</li>`).join('')}</ul></section>
  <section><h3>Công thức lực bắn</h3><ul>
    <li>Bắn <b>45°</b>, cùng độ cao, không gió: <b>Lực = 21.1 × √D</b> (D là số ô). Ví dụ: 4 ô → 42, 9 ô → 63, 16 ô → 85.</li>
    <li>Góc θ bất kỳ, địch cao hơn H ô (thấp hơn thì H âm): <b>Lực = 14.94 × D ÷ (cos θ × √(D × tan θ − H))</b>.</li>
    <li>Gió xuôi chiều bắn làm đạn bay xa hơn. Ở 45°, mỗi 1 gió xuôi đẩy đạn xa thêm khoảng 2.9% quãng đường: <b>Lực ≈ 21.1 × √(D × (1 − 0.029 × gió))</b>, gió ngược thì gió mang dấu âm.</li>
    <li>Góc càng cao, đạn bay càng lâu nên càng bị gió đẩy nhiều. Cầu Sét và kỹ năng Hô Phong bỏ qua gió.</li></ul>
    <div class="box" style="margin-top:10px">
      <div class="row"><label class="label" style="width:96px" for="cAng">Góc (°)</label><input class="input" id="cAng" type="number" value="45" min="-20" max="90" step="1"></div>
      <div class="row"><label class="label" style="width:96px" for="cD">Khoảng cách (ô)</label><input class="input" id="cD" type="number" value="8" min="0.5" max="24" step="0.1"></div>
      <div class="row"><label class="label" style="width:96px" for="cH">Chênh cao (ô)</label><input class="input" id="cH" type="number" value="0" min="-10" max="10" step="0.1"></div>
      <div class="row"><label class="label" style="width:96px" for="cW">Gió xuôi (+) / ngược (−)</label><input class="input" id="cW" type="number" value="0" min="-${WIND_MAX}" max="${WIND_MAX}" step="0.1"></div>
      <div style="font-family:var(--font-display);font-size:26px" id="cOut">Lực ≈ –</div>
    </div></section>
  <section><h3>Nộ và Tuyệt kỹ</h3><ul>
    <li>Gây và nhận sát thương sẽ tích Nộ. Đầy 100 thì bấm <kbd>R</kbd> để chọn Tuyệt kỹ thay cho đạn thường.</li></ul></section>`;
}
function openHelp(from) {
  App.helpFrom = from; renderHelp(); show('help');
  const run = () => { const p = calcPower(+$('cAng').value, +$('cD').value, +$('cH').value, +$('cW').value); $('cOut').textContent = p === null ? 'Không với tới (lực > 100)' : 'Lực ≈ ' + p.toFixed(1); };
  ['cAng', 'cD', 'cH', 'cW'].forEach((id) => $(id).addEventListener('input', run)); run();
}
/* Exact power for this game's physics (wind taken along the shot direction). Returns null if > 100. */
function calcPower(angDeg, D, Hh, wind) {
  const th = angDeg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), X = D * UNIT, Y = Hh * UNIT, acc = wind * WIND_K;
  const yAt = (v) => {
    let t;
    if (Math.abs(acc) < 1e-6) t = X / (v * c);
    else { const disc = v * v * c * c + 2 * acc * X; if (disc < 0) return -1e9; t = (-v * c + Math.sqrt(disc)) / acc; }
    if (!(t > 0)) return -1e9;
    return v * s * t - GRAV * t * t / 2;
  };
  let lo = 1, hi = 100 * POWER_K;
  if (yAt(hi) < Y) return null;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (yAt(m) < Y) lo = m; else hi = m; }
  return hi / POWER_K;
}
$('helpClose').onclick = () => show(App.helpFrom);
$('btnHelpMenu').onclick = () => openHelp('menu');

/* ---------- screens & toasts ---------- */
const SCREENS = ['menu', 'lobby', 'pause', 'help', 'end'];
function show(id) { for (const s of SCREENS) $(s).hidden = s !== id; }
function toast(text, err = false) {
  const box = $('toasts'), el = document.createElement('div'); el.className = 'toast' + (err ? ' err' : ''); el.textContent = text;
  box.appendChild(el); while (box.children.length > 3) box.firstChild.remove(); setTimeout(() => el.remove(), err ? 5000 : 2400);
}
function banner(text, sub = '', dur = 1.5) { $('banner').innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : ''); $('banner').style.opacity = 1; App.bannerT = dur; }

/* ---------- match lifecycle ---------- */
function botTeam(n, taken) {
  const out = [];
  for (let i = 0; i < n; i++) { let pool = HERO_KEYS.filter((k) => !taken.includes(k)); if (!pool.length) pool = HERO_KEYS; const k = pick(pool); taken.push(k); out.push(k); }
  return out;
}
let botIdx = 0;
const botName = () => BOT_NAMES[(botIdx++) % BOT_NAMES.length] + ' 🤖';
function onSimEvent(e) { handleEvent(e); }
function startOffline() {
  const n = App.perTeam, slots = [{ team: 0, hero: App.hero, name: playerName(), human: true }];
  botIdx = Math.floor(Math.random() * BOT_NAMES.length);
  for (const k of botTeam(n - 1, [App.hero])) slots.push({ team: 0, hero: k, name: botName(), human: false });
  for (const k of botTeam(n, [])) slots.push({ team: 1, hero: k, name: botName(), human: false });
  const seed = (Math.random() * 1e9) | 0;
  newMatch({ seed, perTeam: n, slots, diff: App.diff, map: resolveMap(App.map), onEvent: onSimEvent });
  afterTerrain(seed);
  App.game = { kind: 'offline', localId: 1 };
  enterMatch();
}
function startDemo() {
  const slots = []; botIdx = 0;
  for (let t = 0; t < 2; t++) for (const k of botTeam(3, [])) slots.push({ team: t, hero: k, name: botName(), human: false });
  const seed = (Math.random() * 1e9) | 0;
  newMatch({ seed, perTeam: 3, slots, diff: 2, map: Math.random() < 0.5 ? SPECIAL_MAP : pick(MAP_KEYS), onEvent: (e) => playEvent(e, null) });
  afterTerrain(seed);
  App.game = { kind: 'demo' };
}
function afterTerrain(seed) { terrainInitCanvas(); initSky(seed); P.length = 0; FLOATS.length = 0; G_heroesView = () => { const S = world(); return S ? S.heroes : []; }; }
function enterMatch() {
  show(null); $('hud').hidden = false; $('board').hidden = true; $('toasts').innerHTML = ''; updateRotate();
  App.paused = false; App.overShown = false; App.freeCam = 0; App.lastActor = -1; App.pings = []; App.boardOpen = false;
  advertise(); // everyone online sees "in a match" right away
  const h = localHero();
  $('pingTag').hidden = true; Net.rtt = 0; Net.pred = null;
  SFX.setTheme(TERR.map);
  if (h) { cam.x = h.x; cam.y = h.y - 100; Ctl.ang = h.ang; Ctl.face = h.face; Ctl.sel = 0; Ctl.power = 0; Ctl.charging = false; Ctl.lastPower = 0; }
  Object.assign(Ctl, { target: null, preset: null, hint: null, hintSig: '' }); App.lastShot = null; App.pendingShot = null;
  buildArms();
  SFX.init();
}
function leaveMatch() {
  if (Net.nr) netLeave();
  App.game = null; CV = null; $('hud').hidden = true; hideTip(); updateRotate(); SFX.stopFlight();
  startDemo(); show('menu'); renderRoster(); SFX.setTheme('menu');
  advertise(); laterUpdate();
}
function showEnd() {
  if (App.overShown) return; App.overShown = true;
  const S = world(), v = viewState(S), local = localHero(), my = local ? local.team : 0;
  SFX.stinger(v.winner === my);
  $('endTitle').textContent = v.winner === -1 ? 'Hòa!' : v.winner === my ? 'Chiến thắng!' : 'Thất bại';
  $('endTitle').style.color = v.winner === -1 ? 'var(--ink)' : v.winner === my ? 'var(--mint-dark)' : 'var(--danger)';
  $('endSub').textContent = (v.winner >= 0 ? TEAM_NAME[v.winner] + ' trụ vững' : 'Cả hai đội cùng rơi') + ` sau ${v.round} vòng · ${MAPS[TERR.map].name}.` + (TERR.map === SPECIAL_MAP ? ' Game is Good!' : '');
  $('endBoard').innerHTML = boardHTML(S, local, true);
  $('btnAgain').hidden = kind() === 'client';
  $('btnAgain').textContent = kind() === 'host' ? 'Về sảnh chờ' : 'Chơi lại';
  $('hud').hidden = true; show('end');
  if (v.winner === my) SFX.combo(); else SFX.death();
}
$('btnPlay').onclick = () => { SFX.init(); startOffline(); };
$('btnAgain').onclick = () => {
  if (kind() === 'host') { Net.lob.st = 'lobby'; delete Net.lob.hm; publishLob(); App.game = null; startDemo(); renderLobby(); show('lobby'); }
  else startOffline();
};
$('btnHome').onclick = () => leaveMatch();
$('btnPause').onclick = () => openPause();
function openPause() { if (kind() === 'offline') App.paused = true; $('pauseNote').textContent = kind() === 'offline' ? 'Trận đang dừng.' : 'Trận online vẫn tiếp tục.'; show('pause'); }
$('btnResume').onclick = () => { App.paused = false; show(null); };
$('btnHelpPause').onclick = () => openHelp('pause');
$('btnQuit').onclick = () => { App.paused = false; leaveMatch(); };
$('btnHelp').onclick = () => { if (kind() === 'offline') App.paused = true; openHelp(kind() === 'offline' ? 'pause' : null); };
$('btnBoard').onclick = () => { App.boardOpen = !App.boardOpen; $('board').hidden = !App.boardOpen; };
const soundBtn = () => { $('btnSound').textContent = SFX.on ? '🔊' : '🔇'; $('btnMusic').style.opacity = SFX.musicOn ? 1 : 0.45; };
soundBtn();
$('btnSound').onclick = () => { SFX.init(); SFX.setFx(!SFX.on); soundBtn(); };
$('btnMusic').onclick = () => { SFX.init(); SFX.setMusic(!SFX.musicOn); soundBtn(); };
$('volMus').value = SFX.musVol; $('volFx').value = SFX.fxVol;
$('volMus').oninput = (e) => { SFX.init(); SFX.setVol('mus', e.target.value); if (+e.target.value > 0 && !SFX.musicOn) { SFX.setMusic(true); soundBtn(); } };
$('volFx').oninput = (e) => { SFX.init(); SFX.setVol('fx', e.target.value); if (+e.target.value > 0 && !SFX.on) { SFX.setFx(true); soundBtn(); } };
document.addEventListener('pointerdown', () => SFX.init(), { once: true });
document.addEventListener('keydown', () => SFX.init(), { once: true });

/* ---------- events (from sim or snapshots) ---------- */
function handleEvent(e) {
  const S = world(), local = localHero();
  if (e.type === 'ping') {
    const who = S && S.heroes.find((h) => h.id === e.b);
    if (!local || (who && who.team === local.team)) { App.pings.push({ x: e.x, y: e.y, t: 0, col: who ? TEAM_COL[who.team] : '#fff', name: who ? who.name : '' }); SFX.tone(990, 0.1, 'sine', 0.06); }
    return;
  }
  if (e.type === 'turn' && kind() !== 'demo' && S) {
    const a = S.heroes.find((h) => h.id === e.a);
    if (a) {
      App.freeCam = 0;
      if (local && a.id === local.id) {
        const v = viewState(S);
        banner('Lượt của bạn!', 'Gió ' + windLabel(v.wind) + (v.prevWind !== v.wind ? '  (lượt trước ' + windLabel(v.prevWind) + ')' : ''));
        SFX.myTurn(); buzz([30, 70, 30]); Ctl.ang = a.ang; Ctl.face = a.face;
        const tp = targetPos(S, local); if (tp) Ctl.face = tp[0] >= local.x ? 1 : -1;
      }
      else {
        banner(a.name, HEROES[a.key].name + ' · ' + TEAM_NAME[a.team], 1.1); SFX.turn();
        const v = viewState(S);
        if (local && !local.dead && v.queueIds[0] === local.id) toast('Bạn đi tiếp theo, chuẩn bị nhé!');
      }
    }
  }
  if (e.type === 'round' && kind() !== 'demo') banner('Vòng ' + e.a, e.a === 1 && TERR.map === SPECIAL_MAP ? 'Chơi game phải có anh em!' : '', e.a === 1 && TERR.map === SPECIAL_MAP ? 2 : 1.2);
  if (e.type === 'horn' && kind() !== 'demo') banner('📯 Tù và trận!', 'Gió đổi chiều: ' + windLabel(e.a / 10), 1.8);
  if (e.type === 'dmg') {
    const mine = !!(local && !local.dead && Math.abs(e.x - local.x) < 6 && Math.abs(e.y - (local.y - 56)) < 12);
    SFX.hit(+e.a || 0, e.x, e.y, mine); if (mine) buzz(e.a > 150 ? 60 : 30);
  }
  if (e.type === 'turn' && App.pendingShot) { if (App.pendingShot.hits.length) landShot(); App.pendingShot = null; }
  if (e.type === 'boom' && App.pendingShot) { const ps = App.pendingShot; ps.hits.push([e.x, e.y]); if (ps.hits.length >= ps.n) landShot(); }
  if (e.type === 'shoot' && S) {
    const h = S.heroes.find((x) => x.id === e.a);
    if (h) {
      const a = h.ang * Math.PI / 180, dx = Math.cos(a) * h.face, dy = -Math.sin(a), mx = h.x + dx * 30, my = h.y - 24 + dy * 30;
      const col = e.b === 3 ? '#ffd43b' : (SHELLS[HEROES[h.key].shells[e.b]] || SHELLS.cannon).col;
      addP({ type: 'glow', x: mx, y: my, r: 34, life: 0.18, col: '#fff4cc' });
      addP({ type: 'glow', x: mx, y: my, r: 26, life: 0.3, col });
      for (let i = 0; i < 8; i++) { const s2 = rnd(140, 320), j = rnd(-0.45, 0.45); addP({ type: 'streak', x: mx, y: my, vx: (dx * Math.cos(j) - dy * Math.sin(j)) * s2, vy: (dx * Math.sin(j) + dy * Math.cos(j)) * s2, life: rnd(0.12, 0.25), r: 2, col }); }
      for (let i = 0; i < 5; i++) addP({ type: 'smoke', x: mx, y: my, vx: dx * rnd(20, 70) + rnd(-15, 15), vy: dy * rnd(20, 70) - 20, life: rnd(0.5, 0.9), r: rnd(5, 9), col: 'rgba(200,195,205,' });
    }
  }
  playEvent(e, local);
}
const relWind = (w, face) => (w === 0 ? 'lặng gió' : `gió ${w * face > 0 ? 'xuôi' : 'ngược'} ${Math.abs(w).toFixed(1)}`);
const windLabel = (w) => (w === 0 ? 'lặng' : (w > 0 ? '→ ' : '← ') + Math.abs(w).toFixed(1));
/* remember where my shot landed and how far from the target it was */
function landShot() {
  const ps = App.pendingShot; App.pendingShot = null;
  // x3: the middle shell (by distance) is the one fired at your exact angle
  const hs = ps.hits.slice().sort((a, b) => (a[0] - b[0]) * ps.face), [x, y] = hs[Math.floor((hs.length - 1) / 2)];
  App.lastShot = Object.assign(ps, { lx: x, ly: y });
  if (!ps.tx || !ASSIST[assistLevel()].hint) return;
  const off = (x - ps.tx) * ps.face / UNIT;
  const txt = Math.abs(off) < 0.3 ? 'Chuẩn!' : off > 0 ? `Xa quá ${off.toFixed(1)} ô` : `Thiếu ${(-off).toFixed(1)} ô`;
  addFloat(x, y - 60, txt, Math.abs(off) < 0.3 ? '#8dff9b' : '#ffe066', 20, 1.8);
}

/* ---------- actions ---------- */
function act(a) {
  const k = kind(); if (!k || k === 'demo') return;
  if (k === 'client') return netAction(a);
  const h = localHero(); if (!h) return;
  switch (a.k) {
    case 'fire': h.face = a.face; doFire(h, a.sel, a.ang, a.power); break;
    case 'skill': if (!useSkill(h)) toast(canAct(h) && h.stamina < SKILLS[HEROES[h.key].skill].st ? 'Không đủ thể lực cho kỹ năng' : 'Chưa dùng được kỹ năng', true); break;
    case 'item': useItem(h, a.slot); break;
    case 'skip': skipTurn(h); break;
    case 'ping': emit('ping', a.x, a.y, 0, h.id); break;
    case 'tool': if (!useTool(h, a.tool)) toast(canAct(h) ? 'Không đủ thể lực cho ' + TOOLS[a.tool].name : 'Chưa tới lượt của bạn', true); break;
  }
}
function toggleTool(k) {
  const S = world(), h = localHero(); if (!h || !TOOLS[k]) return;
  if (!isMyTurn(S, h)) { toast('Chỉ dùng đạo cụ trong lượt của bạn', true); return; }
  const on = heroTools(h).includes(k);
  if (!on && (Ctl.sel >= 3 || toolBlocked(HEROES[h.key].shells[Ctl.sel]))) { toast(TOOLS[k].name + ' không dùng với ' + (Ctl.sel === 3 ? 'Tuyệt kỹ' : Ctl.sel === 4 ? 'Bay' : SHELLS[HEROES[h.key].shells[Ctl.sel]].name), true); return; }
  // keep enough stamina for the weapon that is picked
  if (!on && h.stamina - TOOLS[k].cost < selCost(h.key, Ctl.sel)) { toast(`Không đủ thể lực cho ${TOOLS[k].name}: cần ${TOOLS[k].cost}${selCost(h.key, Ctl.sel) ? ' + ' + selCost(h.key, Ctl.sel) + ' cho đạn' : ''}, còn ${Math.floor(h.stamina)}`, true); return; }
  SFX.ui(); act({ k: 'tool', tool: k });
}
function isMyTurn(S, h) { const v = viewState(S); return h && !h.dead && v.state === 'aim' && v.actorId === h.id; }
function selectShell(i) {
  const h = localHero(); if (!h) return;
  if (i === 3 && h.energy < 100) { toast('Cần đầy 100 Nộ để dùng Tuyệt kỹ', true); return; }
  if (i === 4 && h.flyCd > 0) { toast('Bay còn hồi ' + h.flyCd + ' lượt', true); return; }
  if (i === 4 && Ctl.sel === 4) i = 0;
  const mine = isMyTurn(world(), h), tools = heroTools(h);
  if (mine && i !== Ctl.sel && h.stamina < selCost(h.key, i)) { toast(`Không đủ thể lực: ${i === 4 ? 'Bay' : SHELLS[HEROES[h.key].shells[i]].name} cần ${selCost(h.key, i)}, còn ${Math.floor(h.stamina)}`, true); return; }
  if (mine && tools.length && (i >= 3 || toolBlocked(HEROES[h.key].shells[i]))) for (const t of tools.slice()) act({ k: 'tool', tool: t });
  Ctl.sel = i; SFX.ui(); refreshArms();
}
function firePreset() { if (Ctl.preset === null) return false; Ctl.power = Ctl.preset; fireNow(); return true; }
/* target: an enemy (follows them) or a fixed point; defaults to the nearest enemy */
function targetPos(S, h) {
  if (!S || !h) return null;
  const T = Ctl.target;
  if (T && T.id) { const e = S.heroes.find((x) => x.id === T.id); if (e && !e.dead) return [e.x, e.y - 22, e]; }
  if (T && T.pt) return [T.x, T.y, null];
  const en = S.heroes.filter((e) => !e.dead && e.team !== h.team).sort((a, b) => Math.abs(a.x - h.x) - Math.abs(b.x - h.x))[0];
  if (!en) return null;
  Ctl.target = { id: en.id }; return [en.x, en.y - 22, en];
}
function setTarget(t) {
  Ctl.target = t; Ctl.hintSig = '';
  const S = world(), h = localHero(), tp = targetPos(S, h);
  if (h && tp && isMyTurn(S, h) && !Ctl.charging) Ctl.face = tp[0] >= h.x ? 1 : -1;
}
function cycleTarget() {
  const S = world(), h = localHero(); if (!S || !h) return;
  const en = S.heroes.filter((e) => !e.dead && e.team !== h.team).sort((a, b) => a.x - b.x); if (!en.length) return;
  const i = en.findIndex((e) => Ctl.target && e.id === Ctl.target.id);
  setTarget({ id: en[(i + 1) % en.length].id }); SFX.ui();
}
/* power hint for the current angle: searched with the real trajectory (with or without wind) */
/* hint trajectory: the game's physics without the per-step hero loop. Returns how far the shell ends from the
   target (0..23 = it passes through the target's body). About 10x cheaper than predictPath. */
function hintMiss(h, ang, pw, nowind, wind, tx, ty) {
  const [mx, my, dx, dy] = muzzle(h, ang), v = pw * POWER_K, dt = 1 / 90, ax = nowind ? 0 : wind * WIND_K;
  let x = mx, y = my, vx = dx * v, vy = dy * v;
  for (let t = 0; t < 7; t += dt) {
    vy += GRAV * dt; vx += ax * dt; x += vx * dt; y += vy * dt;
    const ddx = x - tx, ddy = y - ty;
    if (t > 0.2 && ddx * ddx + ddy * ddy < (BODY_R + 3) * (BODY_R + 3)) return Math.hypot(ddx, ddy);
    if (y > H || x < -300 || x > W + 300 || solid(x, y)) break;
  }
  return Math.hypot(x - tx, y - ty);
}
function updateHint(S, h, now) {
  const lvl = ASSIST[assistLevel()], tp = targetPos(S, h);
  if (!lvl.hint || !tp || h.dead || Ctl.sel === 4) { Ctl.hint = null; return; }
  const v = viewState(S), key = Ctl.sel < 3 ? HEROES[h.key].shells[Ctl.sel] : null;
  if (key && SHELLS[key].kind === 'beam') { Ctl.hint = null; return; }
  const nowind = lvl.hint === 'calm' || (key && SHELLS[key].nowind) || !!h.calm;
  const sig = [Math.round(Ctl.ang * 2), Ctl.face, h.x | 0, h.y | 0, tp[0] >> 3, tp[1] >> 3, v.wind, nowind, TERR.version].join('|');
  // while waiting for your turn the hint only needs to refresh now and then
  const every = isMyTurn(S, h) ? 150 : 700;
  if (sig === Ctl.hintSig || now - Ctl.hintT < every || Ctl.keys.up || Ctl.keys.down) return;
  Ctl.hintSig = sig; Ctl.hintT = now;
  const face = tp[0] >= h.x ? 1 : -1, proxy = { x: h.x, y: h.y, face };
  const sc = (ang, pw) => hintMiss(proxy, ang, pw, nowind, v.wind, tp[0], tp[1]);
  const search = (ang, step) => { let b = { pw: 0, s: 1e9 }; for (let pw = 4; pw <= 100; pw += step) { const s2 = sc(ang, pw); if (s2 < b.s) b = { pw, s: s2 }; } return b; };
  let best = Ctl.face === face ? search(Ctl.ang, 2) : { pw: 0, s: 1e9 };
  if (best.s < 1e9) for (const step of [0.5, 0.1]) { const c = best.pw; for (let pw = c - step * 4; pw <= c + step * 4; pw += step) { if (pw < 0 || pw > 100) continue; const s2 = sc(Ctl.ang, pw); if (s2 < best.s) best = { pw, s: s2 }; } }
  let alt = null;
  if (!(best.s < 60)) {
    // blocked or out of reach at this angle: find the nearest angle that gets there
    for (const d of [5, 10, 15, 20, 30, 40]) { for (const a2 of [Ctl.ang + d, Ctl.ang - d]) if (a2 >= -10 && a2 <= 85 && search(a2, 6).s < 70) { alt = Math.round(a2 / 5) * 5; break; } if (alt !== null) break; }
  }
  Ctl.hint = { pw: Math.round(best.pw * 10) / 10, ok: best.s < 60, calm: nowind && lvl.hint === 'calm', alt, turn: Ctl.face !== face };
}
function fireNow() {
  const S = world(), h = localHero(); if (!h) return;
  const power = Math.round(Ctl.power * 10) / 10;
  Ctl.charging = false; Ctl.power = 0;
  if (!isMyTurn(S, h)) { Ctl.practice = { ang: Ctl.ang, power, face: Ctl.face, t: 2.5 }; return; }
  if (Ctl.sel === 3 && h.energy < 100) Ctl.sel = 0;
  if (Ctl.sel === 4 && h.flyCd > 0) Ctl.sel = 0;
  if (h.stamina < selCost(h.key, Ctl.sel)) { toast(`Không đủ thể lực để bắn (cần ${selCost(h.key, Ctl.sel)}), hãy chọn đạn khác`, true); return; }
  Ctl.lastPower = power;
  if (Ctl.sel !== 4) { const tp = targetPos(S, h);
    App.pendingShot = { ang: Ctl.ang, power, face: Ctl.face, wind: viewState(S).wind, tx: tp ? tp[0] : 0, n: toolCombo(activeTools(h, Ctl.sel)).n, hits: [] }; }
  act({ k: 'fire', sel: Ctl.sel, ang: Ctl.ang, power, face: Ctl.face }); buzz(20);
  if (Ctl.sel >= 3) Ctl.sel = 0;
}

/* ---------- dock (weapons, skill, items) ---------- */
function buildArms() {
  const h = localHero(), box = $('arms');
  if (!h) { box.innerHTML = ''; return; }
  const D = HEROES[h.key], sk = SKILLS[D.skill], ul = ULTS[D.ult], fly = SHELLS.fly;
  const stTag = (n) => (n ? `<span class="cost st">${n}</span>` : '');
  box.innerHTML = `<span class="stam" id="stamBox" aria-label="Thể lực của lượt: dùng cho di chuyển, đạn, kỹ năng và đạo cụ"><b>⚡</b><i><b id="stamFill"></b><em id="stamNeed"></em></i><span id="stamT">${STAMINA}</span></span>`
    + D.shells.map((k, i) => `<button class="slotbtn" data-sel="${i}" aria-label="${esc(SHELLS[k].name)}: ${esc(SHELLS[k].desc)}${SHELLS[k].st ? ' Tốn ' + SHELLS[k].st + ' thể lực.' : ''}"><span class="k">${i + 1}</span><span class="ic">${SHELLS[k].icon}</span>${stTag(SHELLS[k].st)}</button>`).join('')
    + `<button class="slotbtn ult" data-sel="3" aria-label="Tuyệt kỹ ${esc(ul.name)}: ${esc(ul.desc)} (cần 100 Nộ)"><span class="fill" id="ultFill"></span><span class="k">R</span><span class="ic">${ul.icon}</span></button>`
    + `<span class="divider"></span>`
    + TOOL_KEYS.map((k) => `<button class="slotbtn tool" data-tool="${k}" aria-label="${esc(TOOLS[k].name)}: ${esc(TOOLS[k].desc)} Tốn ${TOOLS[k].cost} thể lực. Dùng chung được với các đạo cụ khác."><span class="k">${TOOLS[k].key}</span><span class="ic">${k === 'x3' ? 'x3' : '+' + TOOLS[k].extra}</span><span class="cost">${TOOLS[k].cost}</span></button>`).join('')
    + `<span class="divider"></span>`
    + `<button class="slotbtn" id="skBtn" aria-label="${esc(sk.name)}: ${esc(sk.desc)} Tốn ${sk.st} thể lực."><span class="k">Q</span><span class="ic">${sk.icon}</span>${stTag(sk.st)}<span class="cd" hidden></span></button>`
    + `<button class="slotbtn fly" data-sel="4" id="flyBtn" aria-label="${esc(fly.name)}: ${esc(fly.desc)} Tốn ${fly.st} thể lực."><span class="k">B</span><span class="ic">${fly.icon}</span>${stTag(fly.st)}<span class="cd" hidden></span></button>`
    + `<span class="divider"></span>`
    + [0, 1, 2].map((i) => `<button class="slotbtn mini empty" data-item="${i}"><span class="k">${'ZXC'[i]}</span></button>`).join('')
    + `<button class="slotbtn mini" id="skipBtn" aria-label="Bỏ lượt"><span class="ic">⏭</span></button>`;
  box.querySelectorAll('[data-sel]').forEach((b) => (b.onclick = () => selectShell(+b.dataset.sel)));
  box.querySelectorAll('[data-item]').forEach((b) => (b.onclick = () => act({ k: 'item', slot: +b.dataset.item })));
  box.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => toggleTool(b.dataset.tool)));
  $('skBtn').onclick = () => act({ k: 'skill' });
  $('skipBtn').onclick = () => act({ k: 'skip' });
  App.armsSig = ''; App.angSig = ''; hideSlotTip();
}
function refreshArms() { App.armsSig = ''; }
/* ---------- dock tooltips: hover with a mouse, hold on a touch screen ---------- */
const SLOT_SEL = '[data-sel],[data-tool],[data-item],#skBtn,#skipBtn';
const SlotTip = { el: null, timer: null, suppress: false, sig: '' };
function slotTipHtml(b) {
  const h = localHero(); if (!h) return '';
  const D = HEROES[h.key], mine = isMyTurn(world(), h), st = Math.floor(h.stamina);
  const chips = (list) => `<div class="chips">${list.filter(Boolean).map((c) => `<span class="chip-s${c[1] ? ' hot' : ''}">${c[0]}</span>`).join('')}</div>`;
  const head = (icon, name, sub) => `<div class="st-h"><span class="st-i">${icon}</span><div><b>${esc(name)}</b><small>${sub}</small></div></div>`;
  const p = (t) => `<p class="st-d">${t}</p>`, warn = (t) => `<p class="st-w">${t}</p>`;
  const need = (c) => (mine && c > h.stamina ? warn(`Không đủ thể lực: cần ${c}, còn ${st}`) : '');
  if (b.dataset.sel !== undefined) {
    const i = +b.dataset.sel;
    if (i <= 2) {
      const k = D.shells[i], S = SHELLS[k];
      return head(S.icon, S.name, `Phím ${i + 1} · Đạn`)
        + chips([S.dmg && [`💥 ${S.dmg} sát thương`], S.heal && [`💚 hồi ${S.heal}`], S.r && [`◎ vùng nổ ${S.r}`], [`⏱ delay ${S.delay}`], [S.st ? `⚡ ${S.st} thể lực` : '⚡ miễn phí', !!S.st]])
        + p(esc(S.desc)) + (toolBlocked(k) ? p('<i>Không dùng chung với +1, +2, x3.</i>') : '') + (i !== Ctl.sel ? need(S.st) : '');
    }
    if (i === 3) {
      const U = ULTS[D.ult];
      return head(U.icon, U.name, 'Phím R · Tuyệt kỹ') + chips([[`🔥 Nộ ${Math.floor(h.energy)}/100`, h.energy >= 100], ['⚡ không tốn thể lực']])
        + p(esc(U.desc)) + (h.energy < 100 ? warn('Tích đủ 100 Nộ bằng cách gây hoặc nhận sát thương') : '');
    }
    const F = SHELLS.fly;
    return head(F.icon, F.name, 'Phím B') + chips([[`⚡ ${F.st} thể lực`, true], [`⏳ hồi ${FLY_CD} lượt`]]) + p(esc(F.desc))
      + (h.flyCd > 0 ? warn(`Còn hồi ${h.flyCd} lượt`) : i !== Ctl.sel ? need(F.st) : '');
  }
  if (b.dataset.tool) {
    const k = b.dataset.tool, T = TOOLS[k], on = heroTools(h), isOn = on.includes(k);
    const c = toolCombo(isOn ? on : on.concat(k));
    const blocked = Ctl.sel >= 3 || toolBlocked(D.shells[Ctl.sel]);
    return head(k === 'x3' ? '✳️' : '➕', T.name, `Phím ${T.key} · Đạo cụ${isOn ? ' · đang bật' : ''}`)
      + chips([[`⚡ ${T.cost} thể lực`, true], [`⏱ delay +${T.delay}`]]) + p(esc(T.desc))
      + p(`${isOn ? 'Đang bật' : 'Nếu bật'}: <b>${esc(comboName(c))}</b>, mỗi viên ${Math.round(c.mult * 100)}% sát thương.`)
      + (blocked ? warn('Đạn đang chọn không dùng được đạo cụ') : !isOn && mine && h.stamina - T.cost < selCost(h.key, Ctl.sel) ? warn(`Không đủ thể lực: cần ${T.cost}${selCost(h.key, Ctl.sel) ? ' + ' + selCost(h.key, Ctl.sel) + ' cho đạn' : ''}, còn ${st}`) : '')
      + p('<i>Dùng chung được với các đạo cụ khác. Bấm lại để hủy và lấy lại thể lực.</i>');
  }
  if (b.id === 'skBtn') {
    const K = SKILLS[D.skill];
    return head(K.icon, K.name, 'Phím Q · Kỹ năng') + chips([[`⚡ ${K.st} thể lực`, true], [`⏳ hồi ${K.cd} lượt`]]) + p(esc(K.desc))
      + (h.skillCd > 0 ? warn(`Còn hồi ${h.skillCd} lượt`) : mine && h.stamina - K.st < selCost(h.key, Ctl.sel) ? warn(`Không đủ thể lực: cần ${K.st}${selCost(h.key, Ctl.sel) ? ' + ' + selCost(h.key, Ctl.sel) + ' cho đạn' : ''}, còn ${st}`) : '');
  }
  if (b.dataset.item !== undefined) {
    const it = h.items[+b.dataset.item];
    return it ? head(ITEMS[it].icon, ITEMS[it].name, `Phím ${'ZXC'[+b.dataset.item]} · Vật phẩm`) + p(esc(ITEMS[it].desc)) + p('<i>Không tốn thể lực.</i>')
      : head('📦', 'Ô vật phẩm trống', `Phím ${'ZXC'[+b.dataset.item]}`) + p('Nhặt rương thả dù (rơi 2 vòng một lần) để có vật phẩm.');
  }
  if (b.id === 'skipBtn') return head('⏭', 'Bỏ lượt', 'Kết thúc lượt ngay') + p('Không bắn, chỉ cộng 100 delay.');
  return '';
}
function showSlotTip(b) {
  const html = slotTipHtml(b), t = $('slotTip');
  if (!html) return;
  SlotTip.el = b;
  if (html !== SlotTip.sig) { SlotTip.sig = html; t.innerHTML = html; }
  t.hidden = false;
  const r = b.getBoundingClientRect(), w = t.offsetWidth, ht = t.offsetHeight;
  let y = r.top - ht - 10; if (y < 8) y = r.bottom + 10;
  t.style.left = clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8) + 'px'; t.style.top = y + 'px';
}
function hideSlotTip() { clearTimeout(SlotTip.timer); SlotTip.el = null; SlotTip.sig = ''; const t = $('slotTip'); if (t) t.hidden = true; }
$('arms').addEventListener('pointerover', (e) => { if (e.pointerType !== 'mouse') return; const b = e.target.closest(SLOT_SEL); if (b && b !== SlotTip.el) showSlotTip(b); });
$('arms').addEventListener('pointerout', (e) => { if (e.pointerType !== 'mouse') return; const b = e.target.closest(SLOT_SEL); if (b && !b.contains(e.relatedTarget)) hideSlotTip(); });
$('arms').addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  const b = e.target.closest(SLOT_SEL); if (!b) return;
  clearTimeout(SlotTip.timer);
  SlotTip.timer = setTimeout(() => { showSlotTip(b); SlotTip.suppress = true; buzz(10); }, 420);
});
for (const ev of ['pointerup', 'pointercancel']) $('arms').addEventListener(ev, (e) => {
  if (e.pointerType === 'mouse') return;
  clearTimeout(SlotTip.timer);
  if (SlotTip.el) { const el = SlotTip.el; SlotTip.timer = setTimeout(() => { if (SlotTip.el === el) hideSlotTip(); }, 1600); }
});
// a hold that opened the card is not also a tap on the button
$('arms').addEventListener('click', (e) => { if (SlotTip.suppress) { SlotTip.suppress = false; e.stopPropagation(); e.preventDefault(); } }, true);
const angCtx = $('angCv').getContext('2d');
function drawAngleDial(ang, face) {
  const g = angCtx, w = 220, h = 156, cx = face > 0 ? 34 : w - 34, cy = h - 22, R = 112;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#eef5ff'; g.beginPath(); g.moveTo(cx, cy);
  g.arc(cx, cy, R, face > 0 ? -Math.PI / 2 : Math.PI, face > 0 ? 0 : -Math.PI / 2); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(51,40,63,0.35)'; g.lineWidth = 2;
  for (let a = 0; a <= 90; a += 10) {
    const r = a * Math.PI / 180, l = a % 30 === 0 ? 16 : 9;
    g.beginPath(); g.moveTo(cx + Math.cos(r) * (R - l) * face, cy - Math.sin(r) * (R - l)); g.lineTo(cx + Math.cos(r) * R * face, cy - Math.sin(r) * R); g.stroke();
  }
  const r = ang * Math.PI / 180;
  g.strokeStyle = '#ff7a45'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(r) * (R - 8) * face, cy - Math.sin(r) * (R - 8)); g.stroke();
  g.fillStyle = '#33283f'; g.beginPath(); g.arc(cx, cy, 8, 0, 7); g.fill();
}
function updateDock(S, h) {
  const v = viewState(S), mine = isMyTurn(S, h), lvl = ASSIST[assistLevel()];
  const angSig = Math.round(Ctl.ang * 2) + '|' + Ctl.face;
  if (angSig !== App.angSig) { App.angSig = angSig; $('angT').textContent = Math.round(Ctl.ang) + '°'; drawAngleDial(Ctl.ang, Ctl.face); }
  const pb = $('powerBar');
  pb.querySelector('i').style.width = (Ctl.charging ? Ctl.power : Ctl.preset ?? 0) + '%';
  pb.classList.toggle('preset', !Ctl.charging && Ctl.preset !== null);
  pb.classList.toggle('clickable', lvl.preset);
  const em = pb.querySelector('em.last'), lm = $('lastMark');
  em.hidden = lm.hidden = !Ctl.lastPower;
  em.style.left = Ctl.lastPower + '%'; lm.style.left = clamp(Ctl.lastPower, 16, 84) + '%';
  const ls = App.lastShot;
  $('lastT').textContent = ls ? `${ls.power.toFixed(1)} · ${Math.round(ls.ang)}° · ${relWind(ls.wind, ls.face)}` : Math.round(Ctl.lastPower);
  const hm = $('hintMark'), he = pb.querySelector('em.hint'), H_ = Ctl.hint;
  he.hidden = hm.hidden = !H_;
  if (H_) {
    he.hidden = !H_.ok; he.style.left = H_.pw + '%'; hm.style.left = clamp(H_.ok ? H_.pw : 50, 12, 88) + '%';
    hm.textContent = H_.ok ? `🎯 ${H_.pw.toFixed(1)}${H_.calm ? ' · chưa tính gió' : ''}` : H_.turn ? '🎯 quay mặt về mục tiêu' : H_.alt !== null ? `🎯 bị chắn, thử góc ${H_.alt}°` : '🎯 quá xa, hãy di chuyển';
    hm.classList.toggle('bad', !H_.ok);
  }
  $('pwT').textContent = Ctl.charging ? Math.round(Ctl.power) : Ctl.preset !== null ? Ctl.preset.toFixed(1) : '0';
  $('pwBox').classList.toggle('charging', Ctl.charging);
  $('btnFire').classList.toggle('charging', Ctl.charging);
  const fT = Ctl.charging ? String(Math.round(Ctl.power)) : lvl.preset && Ctl.preset !== null ? Ctl.preset.toFixed(1) : 'BẮN';
  if ($('fireT').textContent !== fT) $('fireT').textContent = fT;
  const fS = Ctl.charging ? 'thả để bắn' : lvl.preset && Ctl.preset !== null ? 'chạm để bắn' : mine ? 'giữ để nạp' : 'ngắm thử';
  if ($('fireS').textContent !== fS) $('fireS').textContent = fS;
  $('pwHint').textContent = lvl.preset && Ctl.preset !== null && !Ctl.charging ? 'BẤM ĐỂ BẮN' : 'GIỮ ĐỂ BẮN';
  const a = S.heroes.find((x) => x.id === v.actorId), tools = activeTools(h, Ctl.sel), combo = toolCombo(tools);
  const selName = Ctl.sel === 4 ? SHELLS.fly.name : Ctl.sel === 3 ? ULTS[HEROES[h.key].ult].name : SHELLS[HEROES[h.key].shells[Ctl.sel]].name;
  const windTxt = relWind(v.wind, Ctl.face);
  $('modeT').innerHTML = h.dead ? 'Bạn đã bị loại, xem đồng đội chiến đấu'
    : v.state === 'flight' ? 'Đạn đang bay…'
    : mine ? (h.stunnedTurn ? '<b>Bị choáng:</b> không đi được, lực nạp chậm và lệch' : h.frozenTurn ? '<b>Bị đóng băng:</b> không di chuyển được' : `<b>Lượt của bạn</b> · ${esc(selName)}${tools.length ? ' <b>' + comboName(combo) + '</b>' : ''}${heroBro(h) ? ' · <b>🤝 Có anh em +10%</b>' : ''}${heroBlessed(h) ? ' · <b>🌈 +25%</b>' : ''} · ${windTxt}`)
    : 'Ngắm thử · đang chờ ' + esc(a ? a.name : '…') + ' · ' + windTxt;
  $('ultFill').style.height = Math.min(100, h.energy) + '%';
  const blocked = Ctl.sel >= 3 || toolBlocked(HEROES[h.key].shells[Ctl.sel]);
  // stamina bar: what is left, and the part the picked weapon will take when fired
  const need = mine ? selCost(h.key, Ctl.sel) : 0, sp = clamp(h.stamina / STAMINA * 100, 0, 100);
  $('stamFill').style.width = sp + '%';
  const nd = $('stamNeed'); nd.style.width = clamp(need / STAMINA * 100, 0, sp) + '%'; nd.style.left = Math.max(0, sp - need / STAMINA * 100) + '%';
  const stT = String(Math.floor(h.stamina)); if ($('stamT').textContent !== stT) $('stamT').textContent = stT;
  $('stamBox').classList.toggle('dim', !mine);
  const sig = [Ctl.sel, h.energy >= 100, h.skillCd, h.flyCd, h.items.join(','), mine, tools.join(), Math.floor(h.stamina)].join('|');
  if (SlotTip.el && (!SlotTip.el.isConnected || !SlotTip.el.offsetParent || document.querySelector('.dock').classList.contains('away'))) hideSlotTip();
  if (sig === App.armsSig) return;
  App.armsSig = sig;
  if (SlotTip.el) queueMicrotask(() => { if (SlotTip.el) showSlotTip(SlotTip.el); });
  document.querySelectorAll('#arms [data-sel]').forEach((b) => {
    b.classList.toggle('on', +b.dataset.sel === Ctl.sel);
    if (+b.dataset.sel !== 3) b.classList.toggle('poor', mine && +b.dataset.sel !== Ctl.sel && h.stamina < selCost(h.key, +b.dataset.sel));
    if (b.classList.contains('ult')) { b.classList.toggle('ready', h.energy >= 100); b.classList.toggle('off', h.energy < 100); }
  });
  document.querySelectorAll('#arms [data-tool]').forEach((b) => {
    const k = b.dataset.tool, on = tools.includes(k);
    b.classList.toggle('on', on);
    b.classList.toggle('off', !on && (!mine || blocked || h.stamina - TOOLS[k].cost < need));
  });
  const cd = $('skBtn').querySelector('.cd'); cd.hidden = !(h.skillCd > 0); cd.textContent = h.skillCd;
  $('skBtn').classList.toggle('poor', mine && h.skillCd <= 0 && h.stamina - SKILLS[HEROES[h.key].skill].st < need);
  const fcd = $('flyBtn').querySelector('.cd'); fcd.hidden = !(h.flyCd > 0); fcd.textContent = h.flyCd;
  document.querySelectorAll('#arms [data-item]').forEach((b) => {
    const it = h.items[+b.dataset.item];
    b.classList.toggle('empty', !it); b.innerHTML = `<span class="k">${'ZXC'[+b.dataset.item]}</span>${it ? `<span class="ic">${ITEMS[it].icon}</span>` : ''}`;
    b.setAttribute('aria-label', it ? ITEMS[it].name + ': ' + ITEMS[it].desc : 'Ô trống. Nhặt rương để có vật phẩm');
  });
}
function updateTop(S, local) {
  const v = viewState(S);
  $('roundBox').innerHTML = `Vòng ${v.round}<small>Lượt ${TEAM_NAME[v.phaseTeam]}${v.round >= SUDDEN_ROUND ? ' · Nước dâng' : ''}</small>`;
  const a = S.heroes.find((x) => x.id === v.actorId);
  const tt = Math.max(0, v.turnT), bank = a ? a.bank : BANK_TIME;
  const usingBank = v.state === 'aim' && tt <= 0;
  $('timerT').textContent = v.state === 'aim' ? (usingBank ? Math.ceil(bank) : Math.ceil(tt)) : '–';
  const frac = v.state === 'aim' ? (usingBank ? bank / BANK_TIME : tt / TURN_TIME) : 0;
  const arc = $('timerArc'); arc.style.strokeDashoffset = (138.2 * (1 - frac)).toFixed(1);
  arc.style.stroke = usingBank ? '#ff7a45' : tt < 5 ? '#ef4f5f' : tt < 10 ? '#ffc53d' : '#4fc38a';
  $('bankT').textContent = a ? 'Dự trữ ' + Math.ceil(bank) + 's' : '';
  // whose turn: a pill under the order strip, a glowing frame on your turn, the dock steps aside while shells fly
  const mine = !!(local && a && a.id === local.id && v.state === 'aim'), nextMine = !!(local && !mine && v.queueIds[0] === local.id && !local.dead);
  const pill = $('turnPill'), secs = Math.ceil(usingBank ? bank : tt);
  const ptxt = mine ? `🎯 LƯỢT CỦA BẠN · ${secs}s` : a && v.state === 'aim' ? `Đang bắn: ${a.name} · ${TEAM_NAME[a.team]}${nextMine ? ' · bạn đi tiếp theo' : ''}` : v.state === 'flight' ? 'Đạn đang bay…' : '';
  if (pill.textContent !== ptxt) pill.textContent = ptxt;
  pill.className = 'turnpill' + (mine ? ' mine' : nextMine ? ' next' : '');
  pill.style.background = mine || nextMine || !a ? '' : TEAM_COL[a.team];
  if (!mine && !nextMine && !a) pill.style.background = 'rgba(51,40,63,.7)';
  $('myTurnGlow').classList.toggle('on', mine);
  const flying = v.state === 'flight' || v.state === 'between'; // hidden from the release until the next turn starts
  document.querySelector('.dock').classList.toggle('away', flying);
  document.querySelector('.dock').classList.toggle('waiting', !mine && !flying);
  $('hud').classList.toggle('flying', flying);
  drawWind(v.wind);
  const d = Math.round((v.wind - v.prevWind) * 10) / 10, wsig = v.wind + '|' + v.prevWind;
  if (wsig !== App.windSig) { App.windSig = wsig; $('windPrev').innerHTML = `Lượt trước <b>${windLabel(v.prevWind)}</b>` + (d ? ` · đổi ${d > 0 ? '→' : '←'} ${Math.abs(d).toFixed(1)}` : ' · không đổi'); }
  // order strip
  const ids = [v.actorId].concat(v.queueIds).filter(Boolean);
  const other = S.heroes.filter((h) => h.team !== v.phaseTeam);
  const sig = ids.join(',') + '|' + other.map((h) => h.id + (h.dead ? 'd' : '')).join(',');
  if (sig !== App.orderSig) {
    App.orderSig = sig;
    const img = (h, cls) => `<img src="${portrait(h.key, h.team, 72, TERR.map === SPECIAL_MAP)}" class="${cls}" data-id="${h.id}" alt="${esc(h.name)}">`;
    $('order').innerHTML = ids.map((id, i) => { const h = S.heroes.find((x) => x.id === id); return h ? img(h, (i === 0 && v.actorId ? 'act' : '') + (h.dead ? ' dead' : '')) : ''; }).join('')
      + '<span class="sep"></span>' + other.map((h) => img(h, h.dead ? 'dead' : '')).join('');
  }
}
const windCtx = $('windCv').getContext('2d');
function drawWind(w) {
  const g = windCtx, cw = 300, ch = 64;
  g.clearRect(0, 0, cw, ch);
  g.fillStyle = '#eaf3ff'; roundRect(g, 4, 5, cw - 8, 54, 27); g.fill();
  const dir = Math.sign(w), col = w > 0 ? '#3d8ef0' : '#ff7a45', ax = 200;
  g.font = '800 34px "Baloo 2", sans-serif'; g.textAlign = 'center'; g.fillStyle = '#33283f';
  g.fillText(w === 0 ? '0' : Math.abs(w).toFixed(1), 60, 45);
  g.font = '800 13px Nunito, sans-serif'; g.fillStyle = '#7a6c80'; g.fillText('GIÓ', 116, 26);
  for (let i = 1; i <= 4; i++) { g.fillStyle = i * 0.5 <= Math.abs(w) + 0.12 ? col : '#d6e3f3'; g.beginPath(); g.arc(ax + (i - 2.5) * 18, 49, 4.5, 0, 7); g.fill(); }
  if (w !== 0) {
    const len = 26 + Math.abs(w) / WIND_MAX * 46, x0 = ax - dir * len / 2, x1 = ax + dir * len / 2;
    g.fillStyle = col; g.beginPath();
    g.moveTo(x0, 22); g.lineTo(x1 - dir * 14, 22); g.lineTo(x1 - dir * 14, 13); g.lineTo(x1 + dir * 6, 27); g.lineTo(x1 - dir * 14, 41); g.lineTo(x1 - dir * 14, 32); g.lineTo(x0, 32); g.closePath(); g.fill();
  } else { g.font = '800 15px Nunito, sans-serif'; g.fillStyle = '#7a6c80'; g.fillText('Lặng gió', ax, 32); }
  g.textAlign = 'left';
}
function boardHTML(S, local, end) {
  let out = '<table><thead><tr><th>Tướng</th><th>Máu</th><th>Sát thương</th><th>Hạ gục</th><th>Chính xác</th></tr></thead><tbody>';
  for (let t = 0; t < 2; t++) {
    out += `<tr class="thead"><td colspan="5" style="color:${TEAM_COL[t]}">${TEAM_NAME[t]}</td></tr>`;
    for (const h of S.heroes.filter((x) => x.team === t)) {
      const acc = h.shots ? Math.round(Math.min(1, h.hits / h.shots) * 100) + '%' : '–';
      out += `<tr style="${local && h.id === local.id ? 'background:#fff4d6' : ''}"><td><img src="${portrait(h.key, h.team, 56, TERR.map === SPECIAL_MAP)}" alt="">${esc(h.name)} <small style="color:var(--ink-soft)">${HEROES[h.key].name}</small></td><td>${h.dead ? 'Bị loại' : Math.ceil(h.hp) + '/' + h.maxHp}</td><td>${Math.round(h.dmgDealt)}</td><td>${h.kills}</td><td>${acc}</td></tr>`;
    }
  }
  return out + '</tbody></table>';
}

/* ---------- input ---------- */
const KEYMAP = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down' };
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  const k = kind(), inGame = k && k !== 'demo' && !$('hud').hidden;
  if (!inGame) { if (e.key === 'Escape' && !$('help').hidden) $('helpClose').click(); return; }
  if (!$('pause').hidden || !$('help').hidden) { if (e.key === 'Escape') (!$('help').hidden ? $('helpClose') : $('btnResume')).click(); return; }
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (KEYMAP[key]) { Ctl.keys[KEYMAP[key]] = true; e.preventDefault(); return; }
  if (key === 'Shift') { Ctl.keys.fine = true; return; }
  if (key === 'm') { Ctl.keys.measure = true; return; }
  if (key === ' ') { e.preventDefault(); if (!e.repeat && !Ctl.charging) { Ctl.charging = true; Ctl.power = 0; Ctl.dir = 1; } return; }
  if (key === 'Tab') { e.preventDefault(); App.boardOpen = true; $('board').hidden = false; return; }
  if (e.repeat) return;
  switch (key) {
    case '1': case '2': case '3': selectShell(+key - 1); break;
    case '4': case '5': case '6': toggleTool(TOOL_KEYS[+key - 4]); break;
    case 't': cycleTarget(); break;
    case 'Enter': if (ASSIST[assistLevel()].preset && !firePreset()) toast('Bấm vào thanh lực để chọn lực trước', true); break;
    case '[': case ']': if (ASSIST[assistLevel()].preset) { Ctl.preset = clamp(Math.round(((Ctl.preset ?? Ctl.lastPower) + (key === ']' ? 0.5 : -0.5)) * 10) / 10, 0, 100); } break;
    case 'r': selectShell(3); break;
    case 'b': selectShell(4); break;
    case 'q': case 'e': act({ k: 'skill' }); break;
    case 'z': act({ k: 'item', slot: 0 }); break;
    case 'x': act({ k: 'item', slot: 1 }); break;
    case 'c': act({ k: 'item', slot: 2 }); break;
    case 'g': act({ k: 'ping', x: App.mouse.wx, y: App.mouse.wy }); break;
    case 'f': App.freeCam = 0; break;
    case 'h': $('btnHelp').click(); break;
    case 'Escape': if (Ctl.charging) { Ctl.charging = false; Ctl.power = 0; } else if (App.boardOpen) { App.boardOpen = false; $('board').hidden = true; } else openPause(); break;
  }
});
window.addEventListener('keyup', (e) => {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (KEYMAP[key]) Ctl.keys[KEYMAP[key]] = false;
  if (key === 'Shift') Ctl.keys.fine = false;
  if (key === 'm') Ctl.keys.measure = false;
  if (key === ' ' && Ctl.charging) fireNow();
  if (key === 'Tab') { App.boardOpen = false; $('board').hidden = true; }
});
window.addEventListener('blur', () => { Ctl.keys = {}; });
const screenToWorld = (sx, sy) => [cam.x + (sx - cssW / 2) / cam.zoom, cam.y + (sy - cssH / 2) / cam.zoom];
cv.addEventListener('contextmenu', (e) => e.preventDefault());
const TOUCHES = new Map();
cv.addEventListener('pointerdown', (e) => {
  SFX.init();
  if (e.pointerType === 'touch') {
    TOUCHES.set(e.pointerId, [e.clientX, e.clientY]);
    if (TOUCHES.size === 2) {
      const [a, b] = [...TOUCHES.values()];
      App.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z: App.zoomMul };
      if (App.drag) { clearTimeout(App.drag.hold); App.drag.used = true; App.drag.moved = true; }
      return;
    }
  }
  if (e.pointerType === 'mouse') { App.drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; cv.style.cursor = 'grabbing'; return; }
  if (e.pointerType !== 'mouse') {
    const d = App.drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, touch: true, moved: false };
    if (Tip.pinned) { hideTip(); d.used = true; return; }
    // touch: press and hold a hero to see its card
    d.hold = setTimeout(() => {
      if (App.drag !== d || d.moved) return;
      const [wx, wy] = screenToWorld(d.x, d.y), h = heroAt(wx, wy);
      if (h) { d.used = true; showTip(h.id, d.x, d.y, true); if (navigator.vibrate) navigator.vibrate(15); }
    }, 420);
  }
});
window.addEventListener('pointermove', (e) => {
  if (TOUCHES.has(e.pointerId)) TOUCHES.set(e.pointerId, [e.clientX, e.clientY]);
  if (App.pinch && TOUCHES.size >= 2) {
    const [a, b] = [...TOUCHES.values()];
    App.zoomMul = clamp(App.pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / App.pinch.d, 0.55, 1.9); App.freeCam = 6;
    return;
  }
  App.mouse.x = e.clientX; App.mouse.y = e.clientY;
  if (App.drag) {
    const dx = e.clientX - App.drag.x, dy = e.clientY - App.drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) App.drag.moved = true;
    if (App.drag.moved || !App.drag.touch) { cam.x = App.drag.cx - dx / cam.zoom; cam.y = App.drag.cy - dy / cam.zoom; App.freeCam = 6; }
  }
});
const endTouch = (e) => { TOUCHES.delete(e.pointerId); if (TOUCHES.size < 2) App.pinch = null; };
window.addEventListener('pointercancel', (e) => { endTouch(e); if (App.drag) clearTimeout(App.drag.hold); App.drag = null; });
window.addEventListener('pointerup', (e) => {
  endTouch(e);
  if (App.drag) clearTimeout(App.drag.hold);
  if (App.drag && !App.drag.moved && !App.drag.used && kind() && kind() !== 'demo') {
    const [wx, wy] = screenToWorld(e.clientX, e.clientY), S = world(), h = localHero();
    const en = S && h && S.heroes.find((x) => !x.dead && x.team !== h.team && dist(wx, wy, x.x, x.y - 22) < 48);
    if (en) setTarget({ id: en.id });
    else if (App.drag.touch) act({ k: 'ping', x: wx, y: wy });
    else if (h) setTarget({ pt: true, x: wx, y: wy });
  }
  App.drag = null; cv.style.cursor = 'grab';
});
cv.style.cursor = 'grab';
cv.addEventListener('wheel', (e) => { e.preventDefault(); App.zoomMul = clamp(App.zoomMul * (e.deltaY > 0 ? 0.9 : 1.1), 0.55, 1.9); }, { passive: false });
document.querySelectorAll('#pad button').forEach((b) => {
  const k = b.dataset.k, ang = k === 'up' || k === 'down';
  const release = () => { Ctl.keys[k] = false; b.classList.remove('held'); if (ang) Ctl.padHold = 0; };
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault(); SFX.init(); b.setPointerCapture(e.pointerId); b.classList.add('held');
    if (ang) { Ctl.ang = clamp(Math.round(Ctl.ang) + (k === 'up' ? 1 : -1), -20, 90); Ctl.padHold = performance.now(); buzz(6); }
    Ctl.keys[k] = true;
  });
  b.addEventListener('pointerup', release); b.addEventListener('pointercancel', release);
});
for (const id of ['btnFire', 'pwBox']) {
  const b = $(id);
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault(); SFX.init();
    if (ASSIST[assistLevel()].preset && Ctl.preset !== null) { firePreset(); return; }
    Ctl.charging = true; Ctl.power = 0; Ctl.dir = 1; b.setPointerCapture(e.pointerId);
  });
  b.addEventListener('pointerup', () => { if (Ctl.charging) fireNow(); });
  b.addEventListener('pointercancel', () => { Ctl.charging = false; Ctl.power = 0; });
}
/* easy assist: click or drag on the bar to set an exact power, then fire with Enter or the button */
(() => {
  const bar = $('powerBar'); let down = false;
  const setFrom = (e) => { const r = bar.getBoundingClientRect(); Ctl.preset = clamp(Math.round((e.clientX - r.left) / r.width * 200) / 2, 0, 100); };
  bar.addEventListener('pointerdown', (e) => { if (!ASSIST[assistLevel()].preset || Ctl.charging) return; down = true; bar.setPointerCapture(e.pointerId); setFrom(e); SFX.ui(); });
  bar.addEventListener('pointermove', (e) => { if (down) setFrom(e); });
  bar.addEventListener('pointerup', () => { down = false; });
})();

/* per-frame control → sim/presence */
function controlTick(dt, S, h) {
  if (!h || h.dead || h.flying) { Ctl.charging = false; SFX.charge(-1); return; }
  const mine = isMyTurn(S, h);
  let rate = Ctl.keys.fine ? 8 : 38;
  // touch ▲▼: a tap moves 1°, holding waits a moment, then creeps (7°/s), then runs (26°/s)
  if (Ctl.padHold) { const held = performance.now() - Ctl.padHold; rate = held < 380 ? 0 : held < 1400 ? 7 : 26; }
  if (Ctl.keys.up) Ctl.ang = Math.min(90, Ctl.ang + rate * dt);
  if (Ctl.keys.down) Ctl.ang = Math.max(-20, Ctl.ang - rate * dt);
  const mv = Ctl.keys.left ? -1 : Ctl.keys.right ? 1 : 0;
  if (mv) Ctl.face = mv;
  if (Ctl.charging) {
    // Gunny-style: the bar bounces 0 → 100 → 0 while the button is held
    Ctl.power += Ctl.dir * (h.stunnedTurn ? 32 : ASSIST[assistLevel()].speed) * dt;
    if (Ctl.power >= 100) { Ctl.power = 100; Ctl.dir = -1; }
    else if (Ctl.power <= 0) { Ctl.power = 0; Ctl.dir = 1; }
  }
  if (Ctl.practice) { Ctl.practice.t -= dt; if (Ctl.practice.t <= 0) Ctl.practice = null; }
  updateHint(S, h, performance.now());
  SFX.charge(Ctl.charging ? Ctl.power : -1);
  const k = kind();
  if (mine && (k === 'offline' || k === 'host')) {
    h.input.mv = Ctl.charging ? 0 : mv; h.input.rs = selCost(h.key, Ctl.sel);
    setAim(h, Ctl.ang, Ctl.face); h.charge = Ctl.charging ? Ctl.power : 0;
  } else if (mine && k === 'client') netInput({ mv: Ctl.charging ? 0 : mv, ang: Math.round(Ctl.ang * 10) / 10, face: Ctl.face, ch: Ctl.charging ? Math.round(Ctl.power) : 0, rs: selCost(h.key, Ctl.sel) });
  if (!mine && k === 'client') netInput(null);
}

/* ---------- fullscreen + "turn your phone" prompt ---------- */
const FS = document.documentElement, fsReq = FS.requestFullscreen || FS.webkitRequestFullscreen;
const fsOn = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
function toggleFull() {
  if (fsOn()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
  if (!fsReq) return;
  Promise.resolve(fsReq.call(FS)).then(() => { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); }).catch(() => toast('Trình duyệt không cho bật toàn màn hình', true));
}
$('btnFull').hidden = !fsReq;
$('btnFull').onclick = toggleFull;
$('rotFull').hidden = !fsReq;
$('rotFull').onclick = () => { toggleFull(); };
$('rotSkip').onclick = () => { App.rotSkip = true; updateRotate(); };
function updateRotate() {
  const show = TOUCHUI && !App.rotSkip && window.innerHeight > window.innerWidth && !$('hud').hidden;
  $('rotate').hidden = !show;
}

/* ---------- hero card (hover on desktop, press-and-hold or tap the order strip on touch) ---------- */
const Tip = { id: 0, x: 0, y: 0, pinned: false, sig: '', src: '' };
function heroAt(wx, wy) { const S = world(); return S ? S.heroes.find((h) => !h.dead && Math.abs(wx - h.x) < 26 && wy > h.y - 58 && wy < h.y + 6) || null : null; }
function showTip(id, x, y, pinned, src = 'world') { Object.assign(Tip, { id, x, y, pinned: !!pinned, src }); updateTip(true); }
function hideTip() { Tip.id = 0; Tip.pinned = false; $('heroTip').hidden = true; }
function updateTip(force) {
  const el = $('heroTip'), S = world();
  const h = S && Tip.id ? S.heroes.find((x) => x.id === Tip.id) : null;
  if (!h || kind() === 'demo' || $('hud').hidden) { el.hidden = true; return; }
  const D = HEROES[h.key], v = viewState(S), actor = v.actorId === h.id && v.state === 'aim', local = localHero();
  const tools = heroTools(h);
  const sig = [h.id, Math.ceil(h.hp), h.shield | 0, h.energy | 0, Math.round(h.stamina), h.skillCd, h.flyCd, JSON.stringify(h.status), h.items.join(), tools.join(), actor, h.dead].join('|');
  if (force || sig !== Tip.sig) {
    Tip.sig = sig;
    const bar = (label, val, max, col, extra = '') => `<div class="tb"><span>${label}</span><i><b style="width:${clamp(val / max * 100, 0, 100)}%;background:${col}"></b></i><em>${Math.ceil(val)}${max === 100 && label !== 'Máu' ? '' : '/' + max}${extra}</em></div>`;
    const chips = [];
    for (const k in h.status) chips.push(`<span class="chip-s">${STATUS[k].icon} ${STATUS[k].name}${h.status[k] > 0 ? ' · ' + h.status[k] + ' vòng' : ''}</span>`);
    if (h.frozenTurn) chips.push('<span class="chip-s">🧊 Đóng băng lượt này</span>');
    if (h.stunnedTurn) chips.push('<span class="chip-s">💫 Choáng lượt này</span>');
    if (tools.length) chips.push(`<span class="chip-s hot">${comboName(toolCombo(tools))}</span>`);
    if (heroBro(h)) chips.push('<span class="chip-s hot">🤝 Có anh em +10%</span>');
    if (heroBlessed(h)) chips.push('<span class="chip-s hot">🌈 Sức Mạnh +25%</span>');
    if (h.skillCd > 0) chips.push(`<span class="chip-s">Q hồi ${h.skillCd} lượt</span>`);
    if (h.flyCd > 0) chips.push(`<span class="chip-s">Bay hồi ${h.flyCd} lượt</span>`);
    for (const it of h.items) chips.push(`<span class="chip-s" title="${esc(ITEMS[it].desc)}">${ITEMS[it].icon} ${ITEMS[it].name}</span>`);
    const sk = SKILLS[D.skill], ul = ULTS[D.ult];
    const kit = `<li><b>✦ ${esc(D.passive.name)}</b> ${esc(D.passive.desc)}</li>`
      + D.shells.map((k, i) => `<li><b>${i + 1} ${SHELLS[k].icon} ${esc(SHELLS[k].name)}</b>${SHELLS[k].dmg ? ` <small>${SHELLS[k].dmg} st</small>` : ''}${SHELLS[k].st ? ` <small>⚡${SHELLS[k].st}</small>` : ''} ${esc(SHELLS[k].desc)}</li>`).join('')
      + `<li><b>Q ${sk.icon} ${esc(sk.name)}</b> <small>⚡${sk.st} · hồi ${sk.cd} lượt</small> ${esc(sk.desc)}</li>`
      + `<li><b>R ${ul.icon} ${esc(ul.name)}</b> <small>100 Nộ</small> ${esc(ul.desc)}</li>`;
    const rel = !local ? '' : h.id === local.id ? ' · Bạn' : h.team === local.team ? ' · Đồng đội' : ' · Đối thủ';
    el.innerHTML = `<div class="tip-h" style="--tc:${TEAM_COL[h.team]}"><img src="${portrait(h.key, h.team, 72, TERR.map === SPECIAL_MAP)}" alt=""><div><b>${esc(h.name)}</b><small>${D.name}${TERR.map === SPECIAL_MAP ? ' · ' + TRIBE[h.key].title : ''} · ${D.role} · ${TEAM_NAME[h.team]}${rel}</small></div>${Tip.pinned ? '<button class="tip-x" aria-label="Đóng">✕</button>' : ''}</div>`
      + bar('Máu', h.hp, h.maxHp, h.hp / h.maxHp > 0.5 ? '#4fc38a' : h.hp / h.maxHp > 0.25 ? '#ffc53d' : '#ef4f5f', h.shield > 0 ? ` +${Math.round(h.shield)} khiên` : '')
      + bar('Nộ', h.energy, 100, '#ffb703', h.energy >= 100 ? ' · sẵn sàng' : '')
      + (actor ? bar('Thể lực', h.stamina, STAMINA, '#5ab8ff') : '')
      + (chips.length ? `<div class="chips">${chips.join('')}</div>` : '')
      + `<div class="tip-stat">Hạ gục ${h.kills || 0} · Sát thương ${Math.round(h.dmgDealt || 0)} · Trúng ${h.shots ? Math.round(Math.min(1, h.hits / h.shots) * 100) + '%' : '–'}</div>`
      + `<ul class="kit-l">${kit}</ul>`;
    const x = el.querySelector('.tip-x'); if (x) x.onclick = hideTip;
  }
  el.hidden = false;
  // keep the card on screen, beside the pointer
  const r = el.getBoundingClientRect(), pad = 12;
  let left = Tip.x + 18, top = Tip.y + 18;
  if (left + r.width > cssW - pad) left = Tip.x - r.width - 18;
  if (top + r.height > cssH - pad) top = Math.max(pad, cssH - r.height - pad);
  el.style.left = clamp(left, pad, Math.max(pad, cssW - r.width - pad)) + 'px'; el.style.top = Math.max(pad, top) + 'px';
}
$('order').addEventListener('pointerover', (e) => { const im = e.target.closest('img[data-id]'); if (im && e.pointerType === 'mouse' && !Tip.pinned) { const r = im.getBoundingClientRect(); showTip(+im.dataset.id, r.left, r.bottom, false, 'order'); } });
$('order').addEventListener('pointerout', (e) => { if (e.pointerType === 'mouse' && !Tip.pinned && Tip.src === 'order') hideTip(); });
$('order').addEventListener('click', (e) => { const im = e.target.closest('img[data-id]'); if (!im) return; const r = im.getBoundingClientRect(); if (Tip.pinned && Tip.id === +im.dataset.id) hideTip(); else showTip(+im.dataset.id, r.left, r.bottom, true, 'order'); });

/* ---------- camera ---------- */
function cameraTick(dt, S, local) {
  const v = viewState(S);
  cam.zoom = clamp(cssH / 1000, TOUCHUI ? 0.5 : 0.42, 1.25) * App.zoomMul * (cssW < 700 && cssH > cssW ? 0.8 : 1);
  let tx = null, ty = null, speed = 4;
  if (S.projs.length) { const p = S.projs[S.projs.length - 1]; tx = p.x; ty = p.y; speed = 6; }
  else { const a = S.heroes.find((h) => h.id === v.actorId); if (a) { tx = a.x; ty = a.y - 120; } else if (local && !local.dead) { tx = local.x; ty = local.y - 120; } }
  if (kind() === 'demo' && tx === null) { tx = W / 2; ty = H / 2; }
  if (typeof fxCamTick === 'function') { const fc = fxCamTick(dt, S, App.freeCam > 0); if (fc.on) { tx = fc.x; ty = fc.y; speed = fc.speed; } cam.zoom *= fc.zoom; } // [FX-B] shell follow with lead, impact hold, K.O. zoom punch (visual only; free-cam wins)
  if (App.freeCam > 0) App.freeCam -= dt;
  else if (tx !== null) { cam.x += (tx - cam.x) * Math.min(1, dt * speed); cam.y += (ty - cam.y) * Math.min(1, dt * speed); }
  const hw = cssW / 2 / cam.zoom, hh = cssH / 2 / cam.zoom;
  cam.x = W > hw * 2 ? clamp(cam.x, hw - 200, W - hw + 200) : W / 2;
  cam.y = clamp(cam.y, Math.min(hh - 400, H / 2), Math.max(H - hh + 40, H / 2));
}

/* ---------- world render ---------- */
function renderFrame(S, local, t, dt) {
  const v = viewState(S), z = cam.zoom * dpr, vw = cv.width, vh = cv.height;
  const g3 = gfx3D();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawSky(ctx, vw, vh, { x: cam.x, zoom: z }, t, v.wind);
  // 3D: a light haze over the far background, so the islands and heroes stand out from it
  if (g3 && TERR.map !== 'nui') { ctx.fillStyle = 'rgba(236,241,250,0.07)'; ctx.fillRect(0, 0, vw, vh); }
  let sx = 0, sy = 0;
  if (shake > 0) { sx = rnd(-shake, shake) * dpr; sy = rnd(-shake, shake) * dpr; shake *= Math.pow(0.02, dt); if (shake < 0.3) shake = 0; }
  const x0 = cam.x - vw / 2 / z, x1 = cam.x + vw / 2 / z;
  terrainFlush();
  // 3D: islands, decor and heroes in WebGL; everything else on the 2D overlay above it (same world transform)
  let g = ctx;
  if (g3) {
    r3Render(S, t, dt, cam.x - sx / z, cam.y - sy / z, z, vw, vh, local, v.actorId, v.state === 'aim');
    g = R3.ctxF; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, vw, vh);
  }
  g.setTransform(z, 0, 0, z, vw / 2 - cam.x * z + sx, vh / 2 - cam.y * z + sy);
  if (!g3) {
    ctx.imageSmoothingEnabled = true;
    if (TERR.canvas) ctx.drawImage(TERR.canvas, 0, 0, TW, TH, 0, 0, W, H);
    drawDecorLayer(ctx, t, x0, x1);
  } else r3DecorGlow(g, t, x0, x1, R3.lift || 0);
  for (const s of S.stickies) drawSticky(g, s, t);
  for (const c of S.crates) drawCrate(g, c, t);
  const tribe = TERR.map === SPECIAL_MAP;
  if (tribe) drawTotemCrown(g, t);
  if (S.pillars) for (const p of S.pillars) drawPillar(g, p, t);
  const myTeam = local ? local.team : 0;
  for (const h of S.heroes) {
    if (h.dead) continue;
    if (h.status.burn && Math.random() < 0.25) addP({ type: 'ember', x: h.x + rnd(-10, 10), y: h.y - 30, vy: -70, life: 0.7, r: 3, col: '#ff7a2c' });
    if (h.status.wet && Math.random() < 0.08) addP({ type: 'drop', x: h.x + rnd(-10, 10), y: h.y - 40, vy: 40, g: 400, life: 0.5, r: 2, col: '#7fc8ff' });
    const isActor = h.id === v.actorId && v.state === 'aim';
    if (h.walking && t - (h._stepT || 0) > 0.3) { h._stepT = t; SFX.step(dist(h.x, h.y, cam.x, cam.y), matAt(h.x, h.y + 3)); }
    const face = local && h.id === local.id && isActor ? Ctl.face : h.face;
    const ang = local && h.id === local.id && isActor ? Ctl.ang : h.ang;
    // the light behind the hero whose turn it is (in 3D: on the sky layer, behind the model)
    if (tribe && isActor) { if (g3) ctx.setTransform(z, 0, 0, z, vw / 2 - cam.x * z + sx, vh / 2 - cam.y * z + sy); drawTribeAura(g3 ? ctx : g, h.key, h.x, h.y, t); }
    if (!g3) drawHero(g, h.key, h.team, h.x, h.y, face, ang, t + h.id, { walking: h.walking, hurt: h.hurtT > 0, charge: h.charge, frozen: !!(h.status.frozen || h.frozenTurn), stunned: !!(h.status.stun || h.stunnedTurn), tribe });
    if (h.shield > 0) { g.strokeStyle = 'rgba(160,210,255,0.85)'; g.fillStyle = 'rgba(180,220,255,0.18)'; g.lineWidth = 2; g.beginPath(); const hv = heroVis(); g.ellipse(h.x, h.y - 26 * hv, 28 * hv, 34 * hv, 0, 0, 7); g.fill(); g.stroke(); }
  }
  // 3D: shell bodies are models; the overlay adds their glow
  for (const p of S.projs) { if (g3 && P3_KEYS.has(projKey(p)) && p.id !== undefined) { /* glow: drawProjAura in render.js */ } else drawProj(g, p, t); }
  // aim guides
  const nowindFor = (h, sel) => (sel < 3 && SHELLS[HEROES[h.key].shells[sel]] && SHELLS[HEROES[h.key].shells[sel]].nowind) || !!h.calm;
  if (local && !local.dead && !local.flying) {
    const mine = isMyTurn(S, local);
    const proxy = { x: local.x, y: local.y, face: Ctl.face };
    const nw = nowindFor(local, Ctl.sel) || (mine && local.calm);
    const lvl = ASSIST[assistLevel()], arcT = lvl.arc;
    const pw = Ctl.charging ? Ctl.power : Ctl.preset ?? Ctl.lastPower;
    const spread = toolCombo(activeTools(local, Ctl.sel)).spread;
    const tp = targetPos(S, local);
    if (tp) drawTargetMark(g, tp[0], tp[1], t, tp[2] ? '#ff5c5c' : '#ffe066');
    if (App.lastShot) drawLastShot(g, App.lastShot, t);
    if (mine) drawAimGuide(g, proxy, Ctl.ang, pw, !!local.scope, '#ffffff', true, nw, v.wind, arcT, spread);
    else {
      drawAimGuide(g, proxy, Ctl.ang, Ctl.charging ? Ctl.power : 0, false, '#ffffff', Ctl.charging || Ctl.keys.up || Ctl.keys.down, nw, v.wind, arcT);
      // practice shot preview: full path only on Easy, a short arc on Medium, nothing on Hard
      if (Ctl.practice && lvl.arc > 0) { const pp = Ctl.practice; g.globalAlpha = Math.min(1, pp.t); drawAimGuide(g, { ...proxy, face: pp.face }, pp.ang, pp.power, lvl.preset, '#ffe066', false, nw, v.wind, lvl.arc); g.globalAlpha = 1; }
    }
  }
  const actor = S.heroes.find((h) => h.id === v.actorId);
  if (actor && v.state === 'aim' && (!local || actor.id !== local.id) && actor.team === myTeam && kind() !== 'demo') {
    drawAimGuide(g, actor, actor.ang, actor.charge || 0, false, TEAM_COL[actor.team], true, false, v.wind, ASSIST[assistLevel()].arc);
  }
  drawParticles(ctx);
  ambientTick(g, dt, x0, x1, cam.y - vh / 2 / z, cam.y + vh / 2 / z, v.wind, t);
  drawWater(g, v.water, x0, x1, t);
  drawFloats(ctx);
  const myAim = local && isMyTurn(S, local);
  for (const h of S.heroes) if (!h.dead) drawHeroUI(g, h, h.id === v.actorId && v.state === 'aim', local && h.id === local.id, myTeam, t, myAim && h.id === local.id ? h.stamina : undefined);
  if (local && !local.dead && kind() !== 'demo') {
    for (const e of S.heroes) if (!e.dead && e.team !== local.team) drawDistanceTag(g, local, e);
    if ((App.drag && App.drag.moved !== false) || Ctl.keys.measure) drawTape(g, local.x, local.y - 22, App.mouse.wx, App.mouse.wy, '#ffe066');
  }
  for (let i = App.pings.length - 1; i >= 0; i--) {
    const p = App.pings[i]; p.t += dt; if (p.t > 4) { App.pings.splice(i, 1); continue; }
    const a = 1 - p.t / 4, r = 14 + Math.sin(p.t * 8) * 4;
    g.strokeStyle = hexA(p.col, a); g.lineWidth = 3; g.beginPath(); g.arc(p.x, p.y, r, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(p.x, p.y - r - 26); g.lineTo(p.x, p.y - r); g.stroke();
    g.fillStyle = hexA(p.col, a); g.beginPath(); g.moveTo(p.x, p.y - r - 26); g.lineTo(p.x + 16, p.y - r - 20); g.lineTo(p.x, p.y - r - 14); g.fill();
    g.font = '800 12px Nunito, sans-serif'; g.fillText(p.name, p.x + 4, p.y - r - 30);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (flash > 0) { g.fillStyle = `rgba(255,250,230,${flash})`; g.fillRect(0, 0, vw, vh); flash = Math.max(0, flash - dt); }
}

/* ---------- online (room capability) ---------- */
const NET_PV = 2; // bump when host and client code can no longer talk to each other
const Net = { room: null, nr: null, role: null, code: '', lob: null, lobRef: null, snapRef: null, myPeer: null, hostPeer: null, seq: 0, actions: [], lastSeq: {}, lastEv: -1, lastOp: 0, unsub: [], team: 0, inLast: '', flushT: null, sendT: 0, rtt: 0, ackSig: '', ptT: 0, ptAt: {}, pred: null };
/* ---------- updates: a new deploy reloads the page at a safe moment (never in a room or a match) ---------- */
// the build stamps window.PDM_BUILD into the page and writes the same id to version.json
const Upd = { ready: false, told: false };
async function checkUpdate(quiet = false) {
  if (!window.PDM_BUILD) return false;
  if (!Upd.ready) try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch('version.json', { cache: 'no-store', signal: ctl.signal }); clearTimeout(t);
    const j = r.ok ? await r.json() : null;
    // tried that version already and still got the old page (a cache in between): no reload loop
    let tried = null; try { tried = sessionStorage.getItem('pdmTried'); } catch (e) { /* storage blocked */ }
    if (j && j.v && String(j.v) !== String(window.PDM_BUILD) && String(j.v) !== tried) { Upd.ready = true; Upd.v = String(j.v); }
  } catch (e) { /* offline: next time */ }
  if (Upd.ready && !quiet) applyUpdate();
  return Upd.ready;
}
function applyUpdate() {
  if (!Upd.ready) return;
  const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (!Net.nr && !Net.joining && (!App.game || App.game.kind === 'demo') && !typing) { markTried(); location.reload(); return; }
  if (!Upd.told) { Upd.told = true; toast('Có bản cập nhật mới: game sẽ tự tải lại khi bạn về màn hình chính'); }
}
const markTried = () => { try { sessionStorage.setItem('pdmTried', Upd.v || ''); } catch (e) { /* storage blocked */ } };
// after leaving a room or a match (the leave messages go out first)
const laterUpdate = () => { if (Upd.ready) setTimeout(applyUpdate, 600); };
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
startTicker(() => checkUpdate(), 60000);
async function netInit() {
  setNetUI(null);
  // on claude.ai: the platform's room; anywhere else (Vercel, local): direct WebRTC between browsers
  if (window.claude && typeof window.claude.use === 'function') { try { Net.room = await window.claude.use('room'); } catch (e) { Net.room = null; } }
  else Net.room = await p2pRoom();
  setNetUI(!!Net.room);
  if (!Net.room) return;
  if (Net.room.onPeers) { Net.room.onPeers(() => { renderOpenRooms(); renderOnline(); }); renderOpenRooms(); renderOnline(); advertise(); }
  const code = inviteCode();
  if (code) {
    $('codeIn').value = code; toast('Đang vào phòng ' + code + '…'); joinRoom(code);
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* sandboxed */ }
  }
}
/* invite links carry ?room=CODE (read from the page URL, its hash, or the embedding page) */
function inviteCode() {
  // the referrer only matters inside claude.ai's frame; on the web it could be a stale link from an earlier visit
  const inClaude = window.claude && typeof window.claude.use === 'function';
  const m = [location.search, location.hash, inClaude ? document.referrer : ''].join(' ').match(/[?&#]room=([A-Za-z0-9]{4,6})/);
  return m ? m[1].toUpperCase() : null;
}
const ARTIFACT_URL = 'https://claude.ai/artifact/4hWrRubw9q8EKBoBi6NjF8';
const shareLink = (code) => (window.claude && typeof window.claude.use === 'function' ? ARTIFACT_URL : location.origin + location.pathname) + '?room=' + code;
/* hosts advertise their room in the shared lobby so friends who open the game see it and join with one tap */
/* also tells everyone online who we are and what we are doing (st: menu, bot, room, play), and carries our invites */
function advertise() {
  if (!Net.room || !Net.room.presence) return;
  const L = Net.lob, open = Net.role === 'host' && L ? { c: Net.code, n: playerName(), m: L.m, p: L.sl.length, mp: L.mp, st: L.st } : null;
  const k = kind(), st = k === 'host' || k === 'client' ? 'play' : Net.role ? 'room' : k === 'offline' ? 'bot' : 'menu';
  const now = Date.now(); Online.sent = Online.sent.filter((v) => now - v[4] < INVITE_TTL);
  const me = { n: playerName(), h: App.hero, st, open, inv: Online.sent.length ? Online.sent : null };
  const sig = JSON.stringify(me);
  if (sig === Online.sig) return;
  Online.sig = sig; Net.room.presence(me).catch(() => {});
}
function renderOpenRooms() {
  const el = $('openRooms'); if (!Net.room || !Net.room.peers) { el.hidden = true; return; }
  const rooms = Net.room.peers().filter((p) => !p.sameTab && p.presence && p.presence.open && /^[A-Z0-9]{4,6}$/.test(String(p.presence.open.c))).map((p) => p.presence.open).slice(0, 6);
  el.hidden = !rooms.length;
  el.innerHTML = '<span class="label">🎮 Phòng đang mở</span>' + rooms.map((r) => {
    const m = clamp(r.m | 0, 1, 3), full = (r.p | 0) >= m * 2, play = r.st === 'play' || full, mp = MAPS[r.mp] ? MAPS[r.mp].name : 'Ngẫu nhiên';
    return `<div class="oroom"><span><b>${esc(cleanName(r.n))}</b><small>${m}v${m} · ${esc(mp)} · ${clamp(r.p | 0, 0, 6)}/${m * 2} người${r.st === 'play' ? ' · đang đấu' : full ? ' · đã đủ' : ''}</small></span><button class="btn small mint" data-c="${r.c}" ${play ? 'disabled' : ''}>Vào</button></div>`;
  }).join('');
}
$('openRooms').addEventListener('click', (e) => { const b = e.target.closest('button[data-c]'); if (b && !Net.nr) joinRoom(b.dataset.c); });
/* ---------- who is online, and direct invites ---------- */
const INVITE_TTL = 45000;
const Online = { sig: '', sent: [], seen: new Set(), open: false, card: null, cardT: null };
const ST_TXT = { menu: 'Đang ở sảnh', bot: 'Đang chơi với bot', room: 'Đang trong phòng chờ', play: 'Đang trong trận' };
function onlinePeers() {
  if (!Net.room || !Net.room.peers) return [];
  return Net.room.peers().filter((p) => p.presence && (p.sameTab || typeof p.presence.n === 'string')).slice(0, 60);
}
const myLobbyId = () => { const me = onlinePeers().find((p) => p.sameTab); return me ? me.peer : null; };
const inMyRoomLobby = () => !!(Net.role && Net.lob && Net.lob.st === 'lobby' && Net.code);
function renderOnline() {
  const peers = onlinePeers(), n = Math.max(1, peers.length);
  $('onlineLine').hidden = !Net.room || !Net.room.peers;
  $('onlineN').textContent = n;
  $('onlineTxt').textContent = n > 1 ? ' người đang online' : ' người đang online (chỉ có bạn)';
  $('btnInvite').hidden = !Net.room || !Net.room.peers;
  const iv = `👥 Mời người online (${Math.max(0, n - 1)})`; if ($('btnInvite').textContent !== iv) $('btnInvite').textContent = iv;
  checkInvites(peers);
  if (Online.open) renderOnlineList(peers);
}
function renderOnlineList(peers = onlinePeers()) {
  const inRoom = inMyRoomLobby();
  $('onlineTitle').textContent = `Người chơi đang online (${Math.max(1, peers.length)})`;
  $('onlineHint').textContent = inRoom ? `Bấm "Mời" để gửi lời mời vào phòng ${Net.code}. Người được mời sẽ thấy thông báo và vào bằng một chạm.`
    : 'Tạo phòng để mời người khác, hoặc bấm "Vào" ở phòng đang mở.';
  $('onlineHost').hidden = inRoom || !!Net.role || !!Net.joining;
  const order = { menu: 0, bot: 1, room: 2, play: 3 };
  const rows = peers.slice().sort((a, b) => (b.sameTab - a.sameTab) || ((order[a.presence.st] ?? 4) - (order[b.presence.st] ?? 4)));
  $('onlineList').innerHTML = rows.map((p) => {
    const P = p.presence, me = p.sameTab, st = ST_TXT[P.st] ? P.st : 'menu', o = P.open && /^[A-Z0-9]{4,6}$/.test(String(P.open.c)) ? P.open : null;
    const sent = Online.sent.find((v) => v[0] === p.peer && v[1] === Net.code);
    let act = '';
    if (me) act = '<span class="olme">Bạn</span>';
    else if (inRoom && (st === 'menu' || st === 'bot')) act = sent ? `<button class="btn small" disabled>Đã mời</button>` : `<button class="btn small mint" data-inv="${esc(p.peer)}">Mời</button>`;
    else if (!Net.role && o && o.st === 'lobby' && (o.p | 0) < clamp(o.m | 0, 1, 3) * 2) act = `<button class="btn small mint" data-c="${o.c}">Vào</button>`;
    const om = o && clamp(o.m | 0, 1, 3);
    const sub = !o ? ST_TXT[st] : o.st === 'play' ? `${ST_TXT.play} · chủ phòng ${o.c} · ${om}v${om}` : `Chủ phòng ${o.c} · ${om}v${om} · ${clamp(o.p | 0, 0, 6)}/${om * 2} người`;
    const stc = o && o.st === 'play' ? 'play' : st;
    return `<div class="olrow${me ? ' me' : ''}"><img src="${portrait(validHero(P.h), 0, 40)}" alt=""><span><b>${esc(cleanName(P.n))}</b><small class="st-${stc}">${esc(sub)}</small></span>${act}</div>`;
  }).join('') || '<p class="note">Chưa thấy ai online.</p>';
}
function openOnline() { Online.open = true; $('onlineBox').hidden = false; renderOnlineList(); SFX.ui(); }
function closeOnline() { Online.open = false; $('onlineBox').hidden = true; }
function sendInvite(to) {
  if (!inMyRoomLobby()) return toast('Hãy tạo hoặc vào một phòng trước', true);
  if (Online.sent.some((v) => v[0] === to && v[1] === Net.code)) return;
  const L = Net.lob;
  Online.sent.push([to, Net.code, L.m, L.mp || '', Date.now()]);
  if (Online.sent.length > 6) Online.sent.shift();
  advertise(); renderOnlineList(); SFX.ui();
  const p = onlinePeers().find((x) => x.peer === to);
  toast('Đã gửi lời mời tới ' + cleanName(p && p.presence.n));
}
/* invites addressed to us sit in the inviter's presence; show each one once, only when we are free to join */
function checkInvites(peers) {
  const me = myLobbyId(); if (!me) return;
  const free = !Net.role && !Net.joining && (kind() === 'demo' || kind() === 'offline' || !kind());
  for (const p of peers) {
    if (p.sameTab || !Array.isArray(p.presence.inv)) continue;
    for (const v of p.presence.inv.slice(0, 8)) {
      if (!Array.isArray(v) || v[0] !== me || !/^[A-Z0-9]{5}$/.test(String(v[1]))) continue;
      const key = p.peer + '|' + v[1] + '|' + v[4];
      if (Online.seen.has(key)) continue;
      Online.seen.add(key);
      if (free) showInvite(p.presence, v);
    }
  }
}
function showInvite(P, v) {
  const m = clamp(v[2] | 0, 1, 3), mp = MAPS[v[3]] ? MAPS[v[3]].name : 'Ngẫu nhiên', code = String(v[1]);
  Online.card = code;
  $('inviteCard').innerHTML = `<img src="${portrait(validHero(P.h), 0, 48)}" alt=""><div class="ic-t"><b>${esc(cleanName(P.n))}</b> mời bạn vào phòng <b>${code}</b><small>${m}v${m} · ${esc(mp)}</small></div>`
    + `<div class="ic-b"><button class="btn small mint" id="invYes">Vào</button><button class="btn small" id="invNo">Bỏ qua</button></div>`;
  $('inviteCard').hidden = false; SFX.ui(); buzz([30, 60, 30]);
  $('invYes').onclick = () => acceptInvite(code);
  $('invNo').onclick = hideInvite;
  clearTimeout(Online.cardT); Online.cardT = setTimeout(hideInvite, 30000);
}
function hideInvite() { $('inviteCard').hidden = true; Online.card = null; clearTimeout(Online.cardT); }
function acceptInvite(code) {
  hideInvite(); closeOnline();
  if (kind() === 'offline') leaveMatch();
  show('menu'); joinRoom(code);
}
$('btnOnline').onclick = openOnline;
$('btnInvite').onclick = openOnline;
$('onlineClose').onclick = closeOnline;
$('onlineBox').addEventListener('click', (e) => {
  if (e.target === $('onlineBox')) return closeOnline();
  const inv = e.target.closest('button[data-inv]'); if (inv) return sendInvite(inv.dataset.inv);
  const j = e.target.closest('button[data-c]'); if (j && !Net.nr) { closeOnline(); joinRoom(j.dataset.c); }
  if (e.target.closest('#onlineHost')) { closeOnline(); $('btnHost').click(); }
});
function setNetUI(ok) {
  $('btnHost').disabled = !ok; $('btnJoin').disabled = !ok;
  const n = $('netNote');
  if (ok === null) n.textContent = 'Đang kiểm tra kết nối…';
  else if (ok) { n.textContent = 'Tạo phòng rồi gửi mã cho bạn bè. Chỗ trống sẽ do bot chơi.'; n.classList.remove('warn'); }
  else { n.textContent = window.claude ? 'Muốn chơi online, hãy mở game trên claude.ai và đăng nhập. Chơi với bot vẫn bình thường.' : 'Không tải được kết nối online, hãy kiểm tra mạng rồi tải lại trang. Chơi với bot vẫn bình thường.'; n.classList.add('warn'); }
}
const randCode = () => { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += a[(Math.random() * a.length) | 0]; return s; };
const BAD_CHARS = new RegExp('[\\u0000-\\u001f\\u200b-\\u200f\\u2028-\\u202e]', 'g');
const cleanName = (n) => String(n || '').replace(BAD_CHARS, '').trim().slice(0, 14) || 'Người chơi';
const validHero = (k) => (HEROES[k] ? k : 'bombi');
async function hostRoom() {
  if (Net.nr || Net.joining) return;
  if (await checkUpdate(true)) { markTried(); location.reload(); return; }
  SFX.init(); let code = '';
  Net.joining = true;
  // a code can be taken (or the broker hiccups): try a few fresh codes before giving up
  for (let i = 0; i < 3 && !Net.nr; i++) {
    code = randCode();
    if (Net.room.setRole) Net.room.setRole('host');
    try { Net.nr = await Net.room.join('pdm-' + code.toLowerCase()); } catch (e) { await new Promise((r) => setTimeout(r, 600)); }
  }
  Net.joining = false;
  if (!Net.nr) return toast('Không tạo được phòng, kiểm tra mạng rồi thử lại', true);
  Object.assign(Net, { role: 'host', code, lastSeq: {} });
  Net.lob = { v: 1, pv: NET_PV, m: Math.min(3, App.perTeam), d: App.diff, mp: App.map, as: App.assist, st: 'lobby', sl: [['@h', playerName(), App.hero, 0]] };
  Net.nr.presence({ r: 'h', n: playerName() }).catch(() => {});
  publishLob(); Net.unsub.push(Net.nr.onPeers(onPeersHost)); showLobby();
}
/* accepts a bare code or a whole pasted invite link; codes never contain I, L, O, 0 or 1 */
function parseCode(raw) {
  const s = String(raw || ''), m = s.match(/room=([A-Za-z0-9]{4,6})/i);
  let c = (m ? m[1] : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!m && c.length > 5) c = c.slice(-5);
  return c;
}
function setJoinUI(busy) {
  $('btnJoin').disabled = busy || !Net.room; $('btnJoin').textContent = busy ? 'Đang vào…' : 'Vào';
  $('btnHost').disabled = busy || !Net.room;
}
async function joinRoom(raw) {
  if (Net.joining || Net.nr) return; // already joining or already in a room
  SFX.init();
  const code = parseCode(raw);
  if (code.length !== 5) return toast('Mã phòng gồm 5 ký tự, ví dụ AB3CD', true);
  if (!Net.room) return toast('Chưa kết nối được online, hãy tải lại trang', true);
  if (await checkUpdate(true)) { markTried(); location.href = location.pathname + '?room=' + code; return; }
  Net.joining = true; setJoinUI(true); $('codeIn').value = code;
  let st = 'connecting';
  if (Net.room.p2p) Net.room.onStatus = (x) => {
    st = x;
    if (x === 'no-room' || x === 'no-link' || x === 'no-broker') failJoin(code, x);
    else if (x === 'ok-relay') toast('Không nối thẳng được tới chủ phòng, đang chơi qua máy chủ trung gian (trễ hơn một chút)');
  };
  let nr = null;
  for (let i = 0; i < 2 && !nr; i++) { try { nr = await Net.room.join('pdm-' + code.toLowerCase()); } catch (e) { if (!i) await new Promise((r) => setTimeout(r, 800)); } }
  Net.joining = false; setJoinUI(false);
  if (!nr) return toast('Không kết nối được máy chủ ghép phòng, kiểm tra mạng rồi thử lại', true);
  Net.nr = nr;
  Object.assign(Net, { role: 'client', code, hostPeer: null, lob: null, lobRef: null, snapRef: null, seq: 0, actions: [], lastEv: -1, lastOp: 0, team: 0 });
  Net.nr.presence({ r: 'c', pv: NET_PV, n: playerName(), h: App.hero, t: 0, a: [] }).catch(() => {});
  Net.unsub.push(Net.nr.onPeers(onPeersClient)); showLobby();
  // p2p retries for up to ~25s (finding the host, then opening the channel); claude.ai rooms answer fast
  setTimeout(() => failJoin(code, st === 'connecting' || st === 'ok' || st === 'ok-relay' ? 'no-link' : st), Net.room.p2p ? 30000 : 8000);
}
function failJoin(code, why) {
  if (Net.role !== 'client' || Net.code !== code || Net.hostPeer) return; // already in, or a different attempt
  const msg = {
    'no-room': `Không tìm thấy phòng ${code}. Kiểm tra lại mã, hoặc chủ phòng đã đóng phòng.`,
    'no-link': `Chưa kết nối được tới chủ phòng ${code}. Thử lại, hoặc đổi mạng (Wi-Fi/4G).`,
    'no-broker': 'Không kết nối được máy chủ ghép phòng, kiểm tra mạng rồi thử lại.',
  }[why] || `Không tìm thấy phòng ${code}`;
  toast(msg, true); netLeave(); show('menu');
}
function netLeave() { laterUpdate(); for (const u of Net.unsub) try { u(); } catch (e) { /* closed */ } Net.unsub = []; if (Net.nr) Net.nr.leave().catch(() => {}); Object.assign(Net, { nr: null, role: null, lob: null, hostPeer: null, joining: false }); if (Net.room) Net.room.onStatus = null; advertise(); endPick(); }
function endPick() { App.pickingForLobby = false; document.querySelector('.menu-grid').classList.remove('picking'); const b = $('pickDone'); if (b) b.hidden = true; }
function publishLob() { if (Net.nr && Net.role === 'host') { Net.lob.v++; Net.nr.presence({ lob: Net.lob }).catch(() => {}); advertise(); } }
const teamCount = (t) => Net.lob.sl.filter((s) => s[3] === t).length;
function onPeersHost(ch) {
  // a client on another build cannot follow our states: it gets no seat (it sees the version notice on its side)
  const clients = ch.peers.filter((p) => !p.sameTab && p.presence && p.presence.r === 'c' && p.presence.pv === NET_PV);
  const L = Net.lob; let changed = false;
  if (L.st === 'lobby') {
    const before = JSON.stringify(L.sl);
    L.sl = L.sl.filter((s) => s[0] === '@h' || clients.some((p) => p.peer === s[0]));
    for (const p of clients) {
      const name = cleanName(p.presence.n), hero = validHero(p.presence.h), want = p.presence.t === 1 ? 1 : 0;
      let s = L.sl.find((s) => s[0] === p.peer);
      if (!s) { if (L.sl.length >= L.m * 2) continue; L.sl.push([p.peer, name, hero, teamCount(want) < L.m ? want : 1 - want]); }
      else { s[1] = name; s[2] = hero; if (want !== s[3] && teamCount(want) < L.m) s[3] = want; }
    }
    changed = before !== JSON.stringify(L.sl); if (changed) renderLobby();
  } else if (L.st === 'play' && G) {
    for (const e of L.hm) if (e[1] && e[1] !== '@h' && !clients.some((p) => p.peer === e[1])) {
      const h = heroById(e[0]); if (h) { h.bot = true; h.peer = null; h.name = e[2] = botName(); if (G.actor === h) h.ai = { t: 1, plan: null }; }
      e[1] = ''; changed = true; toast('Một người chơi đã rời, bot chơi thay');
    }
  }
  if (changed) publishLob();
}
function hostStart() {
  const L = Net.lob, m = clamp(L.m, 1, 3), hm = []; let id = 1; botIdx = Math.floor(Math.random() * BOT_NAMES.length);
  for (let t = 0; t < 2; t++) {
    const humans = L.sl.filter((s) => s[3] === t).slice(0, m), taken = humans.map((s) => s[2]);
    for (const s of humans) hm.push([id++, s[0], s[1], s[2], t]);
    for (const k of botTeam(m - humans.length, taken)) hm.push([id++, '', botName(), k, t]);
  }
  L.seed = (Math.random() * 1e9) | 0; L.hm = hm; L.st = 'play'; L.mk = resolveMap(L.mp);
  newMatch({ seed: L.seed, perTeam: m, slots: hm.map((e) => ({ team: e[4], hero: e[3], name: e[2], human: !!e[1], peer: e[1] || null })), diff: L.d, map: L.mk, onEvent: onSimEvent });
  afterTerrain(L.seed);
  App.game = { kind: 'host', localId: hm.find((e) => e[1] === '@h')[0] };
  publishLob(); hostSendSnap(); enterMatch();
}
function hostReadInputs() {
  if (!Net.nr || !Net.lob || !Net.lob.hm) return;
  for (const p of Net.nr.peers()) {
    if (p.sameTab || !p.presence || p.presence.r !== 'c') continue;
    const e = Net.lob.hm.find((e) => e[1] === p.peer); if (!e) continue;
    const h = heroById(e[0]); if (!h) continue;
    const pt = p.presence.pt, seen = Net.ptAt[p.peer];
    if (typeof pt === 'number' && (!seen || seen[0] !== pt)) Net.ptAt[p.peer] = [pt, performance.now()];
    const inp = p.presence.in;
    if (G.actor === h && G.state === 'aim') {
      if (inp && typeof inp === 'object') { h.input.mv = inp.mv === 1 ? 1 : inp.mv === -1 ? -1 : 0; h.input.rs = clamp(+inp.rs || 0, 0, STAMINA); setAim(h, +inp.ang || 0, inp.face); h.charge = clamp(+inp.ch || 0, 0, 100); }
      else { h.input.mv = 0; h.charge = 0; }
    }
    if (!Array.isArray(p.presence.a)) continue;
    let last = Net.lastSeq[p.peer] || 0;
    for (const a of p.presence.a) {
      if (!Array.isArray(a) || typeof a[0] !== 'number' || a[0] <= last) continue;
      last = a[0];
      const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
      switch (a[1]) {
        case 1: if (G.actor === h) { h.face = a[5] === -1 ? -1 : 1; doFire(h, n(a[2]), n(a[3]), n(a[4])); } break;
        case 2: useSkill(h); break;
        case 3: useItem(h, clamp(n(a[2]) | 0, 0, 2)); break;
        case 4: skipTurn(h); break;
        case 5: emit('ping', n(a[2]), n(a[3]), 0, h.id); break;
        case 6: if (TOOL_KEYS[n(a[2])]) useTool(h, TOOL_KEYS[n(a[2])]); break;
      }
    }
    Net.lastSeq[p.peer] = last;
  }
}
const enc = new TextEncoder();
/* clients confirm the last terrain op and event they applied (presence k = [match seed, op, event]), so a state
   carries only what someone still lacks instead of the whole recent history. Also echoes each client's ping stamp
   (pe = [hero id, stamp, ms the host held it]) so clients can measure their round trip. */
function hostAcks() {
  let op = Infinity, ev = Infinity, all = true; const pe = [];
  for (const p of Net.nr.peers()) {
    if (p.sameTab || !p.presence || p.presence.r !== 'c') continue;
    const e = Net.lob.hm.find((e) => e[1] === p.peer); if (!e) continue;
    const k = p.presence.k;
    if (Array.isArray(k) && k[0] === Net.lob.seed) { op = Math.min(op, +k[1] || 0); ev = Math.min(ev, Number.isFinite(+k[2]) ? +k[2] : -1); } else all = false;
    const pt = Net.ptAt[p.peer]; if (pt) pe.push([e[0], pt[0], Math.round(performance.now() - pt[1])]);
  }
  return { op: all && op !== Infinity ? op : -1, ev: all && ev !== Infinity ? ev : -1, pe };
}
// at = the wall-clock moment this state belongs to (the ticker can run several steps at once); clients interpolate on it
function hostSendSnap(at = performance.now()) {
  if (!Net.nr) return;
  const s = encodeSnap(); s.z = Net.snapN = (Net.snapN || 0) + 1; s.m = Net.lob.seed;
  s.t = Net.snapT = Math.max(Math.round(at), (Net.snapT || 0) + 1);
  const A = hostAcks();
  if (A.op >= 0) s.o = s.o.filter((o) => o[0] > A.op);
  if (A.ev >= 0) s.e = s.e.filter((e) => e[0] > A.ev);
  if (A.pe.length) s.pe = A.pe;
  if (enc.encode(JSON.stringify(s)).length > 3300) { s.o = s.o.slice(-25); s.e = s.e.slice(-8); }
  Net.nr.presence({ s }).catch(() => {});
}
function netAction(a) {
  const r = (v) => Math.round(v * 10) / 10;
  const code = { fire: [1, a.sel, r(a.ang || 0), r(a.power || 0), a.face], skill: [2], item: [3, a.slot], skip: [4], ping: [5, Math.round(a.x || 0), Math.round(a.y || 0)], tool: [6, TOOL_KEYS.indexOf(a.tool)] }[a.k];
  if (!code) return;
  Net.seq++; Net.actions.push([Net.seq].concat(code)); if (Net.actions.length > 8) Net.actions.shift();
  flushNet();
}
function netInput(inp) { const s = JSON.stringify(inp); if (s === Net.inLast) return; Net.inLast = s; Net.pendingIn = inp; flushNet(); }
function flushNet() {
  if (Net.flushT || !Net.nr) return;
  Net.flushT = setTimeout(() => {
    Net.flushT = null; Net.sendT = performance.now(); if (!Net.nr) return;
    const patch = { a: Net.actions.slice(), in: Net.pendingIn || null };
    if (CV && CV.seed !== undefined) patch.k = [CV.seed, Net.lastOp, Net.lastEv];
    if (Net.sendT - Net.ptT > 1000) { Net.ptT = Net.sendT; patch.pt = Math.round(Net.sendT); }
    Net.nr.presence(patch).catch(() => {});
  }, Math.max(0, (Net.room && Net.room.p2p ? 33 : 60) - (performance.now() - Net.sendT)));
}
/* after a state: confirm what was applied (so the host stops resending it), and keep a ping going */
function clientAck() {
  const sig = Net.lastOp + ',' + Net.lastEv;
  if (sig !== Net.ackSig || performance.now() - Net.ptT > 1000) { Net.ackSig = sig; flushNet(); }
}
function onPeersClient(ch) {
  const me = ch.peers.find((p) => p.sameTab); if (me) Net.myPeer = me.peer;
  const host = ch.peers.find((p) => p.presence && p.presence.r === 'h' && !p.sameTab);
  if (!host) { if (Net.hostPeer && ch.left.some((p) => p.peer === Net.hostPeer)) { toast('Chủ phòng đã rời phòng', true); leaveMatch(); } return; }
  Net.hostPeer = host.peer;
  const lob = host.presence.lob, lobSig = lob && JSON.stringify(lob);
  if (lob && lobSig !== Net.lobRef) { Net.lobRef = lobSig; Net.lob = lob; onClientLob(); }
  const s = host.presence.s;
  if (!s || kind() !== 'client') return;
  // states can arrive out of order on the fast channel: only a newer one counts
  if (typeof s.z === 'number' ? s.z > (Net.snapRef ?? -1) : s !== Net.snapRef) { Net.snapRef = typeof s.z === 'number' ? s.z : s; applySnap(s); }
}
function onClientLob() {
  const L = Net.lob;
  if (L.pv !== NET_PV) {
    toast('Chủ phòng đang dùng phiên bản game khác. Cả hai hãy tải lại trang rồi vào lại phòng.', true);
    netLeave(); show('menu'); return;
  }
  const inLobby = L.sl.some((s) => s[0] === Net.myPeer), inMatch = (L.hm || []).some((e) => e[1] === Net.myPeer);
  if (kind() !== 'client' && !inLobby && !inMatch && (L.st === 'play' || L.sl.length >= L.m * 2)) {
    toast(L.st === 'play' ? `Phòng ${Net.code} đang trong trận, hãy thử lại sau` : `Phòng ${Net.code} đã đủ người (${L.m}v${L.m})`, true);
    netLeave(); show('menu'); return;
  }
  if (L.st === 'lobby') { if (kind() === 'client') { App.game = null; CV = null; $('hud').hidden = true; startDemo(); advertise(); } renderLobby(); if ($('help').hidden && $('end').hidden && !App.pickingForLobby) show('lobby'); return; }
  if (L.st === 'play' && kind() !== 'client') {
    const mine = (L.hm || []).find((e) => e[1] === Net.myPeer);
    if (!mine) { $('lobStatus').textContent = 'Trận đang diễn ra, hãy chờ trận sau.'; return; }
    G = null; genTerrain(L.seed, L.m, MAPS[L.mk] ? L.mk : 'may'); afterTerrain(L.seed);
    CV = { seed: L.seed, heroes: L.hm.map((e) => clientHero(e, L.m)), projs: [], crates: [], stickies: [], pillars: [], wind: 0, water: H - 70, round: 1, phaseTeam: 0, state: 'between', actorId: 0, turnT: TURN_TIME, queue: [], winner: -2, recv: performance.now(), clk: { off: null, jit: 0, gap: 50, lastT: -1 } };
    App.game = { kind: 'client', localId: mine[0] }; Net.lastEv = -1; Net.lastOp = 0; Net.ackSig = ''; Net.pred = null;
    enterMatch();
  }
}
function clientHero(e, perTeam) {
  const D = HEROES[e[3]];
  return { id: e[0], team: e[4], key: e[3], name: e[2], x: 0, y: 0, buf: [], grounded: true, speed: D.speed, flyCd: 0, flying: false, face: e[4] ? -1 : 1, ang: 45, hp: D.hp, maxHp: D.hp, shield: 0, energy: 0, dead: false, status: {}, items: [], stamina: STAMINA, skillCd: 0, bank: BANK_TIME, sel: 0, charge: 0, walking: false, hurtT: 0, frozenTurn: false, kills: 0, dmgDealt: 0, shots: 0, hits: 0, lastPower: 0 };
}
const STATE_NAME = ['between', 'aim', 'flight', 'over'];
function applySnap(s) {
  const V = CV; if (!V) return;
  if (s.m !== undefined && V.seed !== undefined && s.m !== V.seed) return; // the next match's state, ahead of its lobby
  const now = performance.now();
  // terrain ops first, in order
  for (const o of s.o) if (o[0] > Net.lastOp) { if (Net.lastOp && o[0] > Net.lastOp + 1 && s.o[0][0] > Net.lastOp + 1) toast('Mất đồng bộ địa hình một phần', true); applyOp(o.slice(1)); Net.lastOp = o[0]; }
  V.round = s.r; V.phaseTeam = s.pt; V.state = STATE_NAME[s.s]; V.actorId = s.a; V.turnT = s.tt / 10; V.wind = s.w / 10; V.prevWind = (s.pw ?? s.w) / 10; V.water = s.wl; V.queue = s.q; V.winner = s.ov; V.recv = performance.now();
  snapClock(V.clk, s, now);
  const rev = { w: 'wet', f: 'frozen', b: 'burn', m: 'mark', s: 'stun' };
  for (const a of s.h) {
    const h = V.heroes.find((x) => x.id === a[0]); if (!h) continue;
    // positions go into a short history: clientPredict draws everyone a moment in the past, between two states
    const b = h.buf, t = typeof s.t === 'number' ? s.t : now;
    if (!b.length) { h.x = a[1]; h.y = a[2]; }
    if (!b.length || t > b[b.length - 1][0]) { b.push([t, a[1], a[2]]); if (b.length > 16) b.shift(); }
    h.hp = a[3]; h.maxHp = a[4]; h.face = a[5]; h.ang = a[6] / 10; const f = a[7];
    h.walking = !!(f & F_WALK); h.grounded = !!(f & F_GROUND); h.tools = bitsTools((f >> F_TOOL_SHIFT) & 7); h.flying = !!(f & F_FLY); h.flyCd = a[25] || 0; h.hurtT = f & F_HURT ? 0.2 : 0; h.scope = !!(f & F_SCOPE); h.calm = !!(f & F_CALM); h.bro = !!(f & F_BRO); h.blessed = !!(f & F_BLESS);
    h.energy = a[8]; h.delay = a[9]; h.shield = a[10]; h.dead = !!a[11]; h.sel = a[12];
    h.items = String(a[13] || '').split('').map((c) => ITEM_KEYS[+c]).filter(Boolean); h.stamina = a[14]; h.skillCd = a[15]; h.bank = a[16];
    h.status = {}; const st = a[17] || ''; for (let i = 0; i + 1 < st.length; i += 2) if (rev[st[i]]) h.status[rev[st[i]]] = +st[i + 1];
    h.charge = a[18]; h.kills = a[19]; h.dmgDealt = a[20] * 10; h.shots = a[21]; h.hits = a[22]; h.frozenTurn = !!(a[23] & 1); h.stunnedTurn = !!(a[23] & 2);
  }
  // a shell keeps its object (trails, sound) and is drawn from where it was shown; the gap to the host's
  // position fades out in clientPredict instead of jumping with every state
  const shown = new Map(); for (const p of V.projs) if (p.id !== undefined) shown.set(p.id, p);
  V.projs = s.p.map((p) => {
    const o = p[6] !== undefined ? shown.get(p[6]) : null, q = o || { id: p[6], ex: 0, ey: 0 };
    q.ex = q.ey = 0;
    if (o) { const ex = o.x - p[1], ey = o.y - p[2]; if (ex * ex + ey * ey < 120 * 120) { q.ex = ex; q.ey = ey; } }
    q.key = PK[p[0]] === 'phoenix' ? 'fire' : PK[p[0]]; q.kind = PK[p[0]] === 'phoenix' ? 'phoenix' : '';
    q.sx = p[1]; q.sy = p[2]; q.vx = p[3]; q.vy = p[4]; q.nowind = !!p[5]; q.x = q.sx + q.ex; q.y = q.sy + q.ey;
    return q;
  });
  V.crates = s.c.map((c) => ({ id: c[0], x: c[1], y: c[2], item: ITEM_KEYS[c[3]], landed: !!c[4] }));
  V.stickies = s.k.map((k) => ({ x: k[0], y: k[1] }));
  V.pillars = (s.bl || []).map((p) => ({ id: p[0], x: p[1], y: p[2], type: p[3] }));
  const maxEv = s.e.length ? s.e[s.e.length - 1][0] : Net.lastEv;
  if (Net.lastEv < 0) Net.lastEv = maxEv;
  else for (const e of s.e) if (e[0] > Net.lastEv) { Net.lastEv = e[0]; handleEvent({ id: e[0], type: EK[e[1]], x: e[2], y: e[3], a: e[4], b: e[5] }); }
  // round trip: our ping stamp echoed back, minus the time the host held it
  const pe = Array.isArray(s.pe) && App.game && s.pe.find((e) => e[0] === App.game.localId);
  if (pe && pe[1] !== Net.peSeen) { Net.peSeen = pe[1]; const r = now - pe[1] - pe[2]; if (r > 0 && r < 5000) { Net.rtt = Net.rtt ? Net.rtt * 0.7 + r * 0.3 : r; showPing(); } }
  clientAck();
}
/* the host's clock as seen here: off = arrival time - host time, tracked from the quickest arrivals (the others were
   held up on the way); jit = how much later than that states usually come; gap = time between two states in motion */
function snapClock(C, s, now) {
  const t = typeof s.t === 'number' ? s.t : now, sample = now - t;
  if (C.off === null) C.off = sample;
  else if (sample < C.off) C.off += (sample - C.off) * 0.5;
  else C.off += (sample - C.off) * 0.01; // drift: the path got slower, or the clocks run apart
  C.jit += (Math.abs(sample - C.off) - C.jit) * 0.1;
  const moving = s.s === 2 || s.h.some((a) => !a[11] && ((a[7] & F_WALK) || !(a[7] & F_GROUND)));
  if (moving && s.s !== 3 && C.lastT >= 0 && t > C.lastT) C.gap += (Math.min(250, t - C.lastT) - C.gap) * 0.15;
  C.lastT = t;
}
// how far in the past to draw: one state gap plus room for late ones
const interpDelay = (C) => clamp(C.gap * 1.25 + C.jit * 2, 45, 400);
function showPing() {
  const el = $('pingTag'); if (!el) return;
  const ms = Math.round(Net.rtt), how = Net.nr && Net.nr.link ? Net.nr.link() : null;
  el.hidden = kind() !== 'client' || !ms;
  el.className = 'chip pingtag ' + (ms < 120 ? 'good' : ms < 250 ? 'ok' : 'bad');
  el.textContent = ms + ' ms' + (how === 'relay' ? ' · trung gian' : '');
}
function clientPredict(dt) {
  if (!CV) return;
  const fade = Math.exp(-dt * 14);
  for (const p of CV.projs) {
    if (p.kind !== 'phoenix') { p.vy += GRAV * dt; if (!p.nowind) p.vx += CV.wind * WIND_K * dt; }
    p.sx += p.vx * dt; p.sy += p.vy * dt; p.ex *= fade; p.ey *= fade; p.x = p.sx + p.ex; p.y = p.sy + p.ey;
  }
  for (const c of CV.crates) if (!c.landed) c.y += 110 * dt;
  // heroes: between the two states around (now - delay), so they move evenly however unevenly states arrive;
  // a big jump (teleport, respawn) is not slid across. The player's own hero in their turn is predicted (clientLocal)
  const C = CV.clk; if (C.off === null) return;
  const rt = performance.now() - C.off - interpDelay(C);
  for (const h of CV.heroes) {
    const b = h.buf; if (!b.length || (Net.pred && Net.pred.id === h.id)) continue;
    let j = 0; while (j < b.length && b[j][0] <= rt) j++;
    const A = b[Math.max(0, j - 1)], B = b[Math.min(b.length - 1, j)];
    if (A === B || Math.abs(B[1] - A[1]) + Math.abs(B[2] - A[2]) > 160) { h.x = A[1]; h.y = A[2]; continue; }
    const k = clamp((rt - A[0]) / (B[0] - A[0]), 0, 1);
    h.x = A[1] + (B[1] - A[1]) * k; h.y = A[2] + (B[2] - A[2]) * k;
  }
}
/* the player's own turn on a client: aim, facing and walking answer the controls at once. The host's positions lag
   by a round trip, so they only pull the hero back once the player has stopped (or when the two clearly disagree) */
function clientLocal(dt, h) {
  if (!CV || !h || kind() !== 'client') return;
  const b = h.buf, last = b && b[b.length - 1];
  if (!last || h.dead || h.flying || !h.grounded || !isMyTurn(CV, h)) { Net.pred = null; return; }
  h.ang = Ctl.ang; h.face = Ctl.face; h.charge = Ctl.charging ? Ctl.power : 0;
  let P = Net.pred;
  if (!P || P.id !== h.id) P = Net.pred = { id: h.id, x: h.x, y: h.y, st: h.stamina, mvAt: 0, air: false };
  h.walking = false;
  const now = performance.now(), mv = Ctl.charging ? 0 : Ctl.keys.left ? -1 : Ctl.keys.right ? 1 : 0;
  P.st = Math.min(P.st, h.stamina); // the host spent some on a tool or a shot
  if (mv) {
    P.mvAt = now;
    const sh = { x: P.x, y: P.y, face: mv, speed: h.speed, input: { rs: selCost(h.key, Ctl.sel) }, stamina: P.st, grounded: true, frozenTurn: h.frozenTurn, stunnedTurn: h.stunnedTurn };
    // stepping off a ledge: stop here and let the host's fall take over
    if (!P.air && walk(sh, mv, dt)) { P.x = sh.x; P.y = sh.y; P.st = sh.stamina; P.air = !sh.grounded; h.walking = true; }
  }
  const settle = Math.max(250, Net.rtt + 200), d = Math.hypot(P.x - last[1], P.y - last[2]);
  if (d > 160) { P.x = last[1]; P.y = last[2]; P.air = false; }
  else if (now - P.mvAt > settle) { const k = Math.min(1, dt * 10); P.x += (last[1] - P.x) * k; P.y += (last[2] - P.y) * k; P.st = h.stamina; P.air = false; }
  else if (d > h.speed * settle / 1000 + 30) { const k = Math.min(1, dt * 5); P.x += (last[1] - P.x) * k; P.y += (last[2] - P.y) * k; }
  h.x = P.x; h.y = P.y; h.stamina = P.st;
}
function showLobby() {
  advertise();
  $('lobCode').textContent = Net.code; $('lobLink').value = shareLink(Net.code); $('lobName').value = App.name;
  $('lobLinkNote').innerHTML = Net.room && Net.room.p2p ? 'Gửi link cho bạn bè: mở link là tự vào phòng. Hoặc nhập mã phòng ở màn hình chính. Giữ tab game của chủ phòng luôn mở ở phía trước.'
    : 'Gửi link cho bạn bè. Khi mở game, phòng của bạn hiện ngay đầu màn hình chính ở mục <b>Phòng đang mở</b>, bấm <b>Vào</b> là xong. Hoặc nhập mã phòng.';
  renderLobby(); show('lobby');
}
function renderLobby() {
  const L = Net.lob, host = Net.role === 'host';
  $('lobHostCtl').style.display = host ? '' : 'none'; $('btnStart').hidden = !host;
  if (!L) { $('lobTeams').innerHTML = ''; $('lobStatus').textContent = 'Đang kết nối tới phòng ' + Net.code + '…'; return; }
  if (!host && !Net.hostPeer) { $('lobStatus').textContent = `Đang kết nối tới phòng ${Net.code}…`; }
  else $('lobStatus').textContent = host ? 'Bạn là chủ phòng. Bấm Bắt đầu khi mọi người sẵn sàng.' : L.st === 'play' ? 'Trận đang diễn ra…' : 'Đang chờ chủ phòng bắt đầu…';
  const A = ASSIST[clamp(L.as ?? 1, 0, 2)];
  $('lobSpecial').classList.toggle('on', L.mp === SPECIAL_MAP);
  $('lobInfo').innerHTML = `<b>${L.m}v${L.m}</b> · Bản đồ <b>${esc(MAPS[L.mp] ? MAPS[L.mp].name : 'Ngẫu nhiên')}</b> · Độ khó ngắm <b>${A.name}</b>: ${esc(A.desc)}`;
  const mine = (s) => (host ? s[0] === '@h' : s[0] === Net.myPeer);
  $('lobTeams').innerHTML = [0, 1].map((t) => {
    const ss = L.sl.filter((s) => s[3] === t);
    let rows = ss.map((s) => `<div class="slot"><img src="${portrait(validHero(s[2]), t, 80, L.mp === SPECIAL_MAP)}" alt=""><span>${esc(s[1])}<br><small style="color:var(--ink-soft)">${HEROES[validHero(s[2])].name}</small></span>${mine(s) ? '<span class="you">Bạn</span>' : ''}</div>`).join('');
    for (let i = ss.length; i < L.m; i++) rows += '<div class="slot empty">Bot sẽ chơi thay</div>';
    return `<div class="team-col t${t}"><h3 style="color:${TEAM_DARK[t]}">${TEAM_NAME[t]}</h3>${rows}</div>`;
  }).join('');
}
const setLobMode = segInit('lobMode', App.perTeam, (v) => { if (Net.role !== 'host') return; Net.lob.m = v; for (const t of [0, 1]) while (teamCount(t) > v) { const s = Net.lob.sl.filter((s) => s[3] === t && s[0] !== '@h').pop() || Net.lob.sl.filter((s) => s[3] === t).pop(); s[3] = 1 - t; if (teamCount(1 - t) > v) { Net.lob.sl.splice(Net.lob.sl.indexOf(s), 1); } } publishLob(); renderLobby(); });
const setLobDiff = segInit('lobDiff', App.diff, (v) => { if (Net.role === 'host') { Net.lob.d = v; publishLob(); } });
$('lobMap').innerHTML = '<button data-v="0">Ngẫu nhiên</button>' + MAP_KEYS.map((k, i) => `<button data-v="${i + 1}">${MAPS[k].icon} ${MAPS[k].name}</button>`).join('');
$('lobSpecial').onclick = () => { if (Net.role !== 'host') return; SFX.ui(); setLobMap(-1); Net.lob.mp = SPECIAL_MAP; publishLob(); renderLobby(); };
const mapIdx = (m) => (m === SPECIAL_MAP ? -1 : MAP_KEYS.indexOf(m) + 1); // -1 = the special map (no regular map lit)
const setLobMap = segInit('lobMap', mapIdx(App.map), (v) => { if (Net.role === 'host') { Net.lob.mp = v ? MAP_KEYS[v - 1] : 'rand'; publishLob(); renderLobby(); } });
const setLobAssist = segInit('lobAssist', App.assist, (v) => { if (Net.role === 'host') { Net.lob.as = v; publishLob(); renderLobby(); } });
$('btnHost').onclick = () => { setLobMode(App.perTeam); setLobDiff(App.diff); setLobMap(mapIdx(App.map)); setLobAssist(App.assist); hostRoom(); };
$('btnJoin').onclick = () => joinRoom($('codeIn').value);
$('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom($('codeIn').value); });
$('btnStart').onclick = () => { if (Net.role === 'host') hostStart(); };
$('btnLeave').onclick = () => { netLeave(); show('menu'); };
$('btnSwap').onclick = () => {
  if (Net.role === 'host') { const s = Net.lob.sl.find((s) => s[0] === '@h'), to = 1 - s[3]; if (teamCount(to) < Net.lob.m) { s[3] = to; publishLob(); renderLobby(); } else toast('Đội bên kia đã đủ người', true); }
  else if (Net.nr) { Net.team = 1 - Net.team; Net.nr.presence({ t: Net.team }).catch(() => {}); }
};
function copyText(text, done, fallback) { try { navigator.clipboard.writeText(text).then(() => toast(done), fallback); } catch (e) { fallback(); } }
$('btnCopy').onclick = () => copyText(Net.code, 'Đã sao chép mã ' + Net.code, selectCode);
$('btnLink').onclick = () => copyText(shareLink(Net.code), 'Đã sao chép link mời, gửi cho bạn bè nhé', () => { $('lobLink').select(); toast('Hãy bấm Ctrl+C / Cmd+C để sao chép link'); });
$('lobLink').addEventListener('focus', () => $('lobLink').select());
function selectCode() { const r = document.createRange(); r.selectNodeContents($('lobCode')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
$('btnPick').onclick = () => { App.pickingForLobby = true; show('menu'); document.querySelector('.menu-grid').classList.add('picking'); $('pickDone').hidden = false; };
(() => {
  const b = document.createElement('button'); b.className = 'btn gold'; b.id = 'pickDone'; b.textContent = 'Xong, về sảnh chờ'; b.hidden = true; b.style.alignSelf = 'flex-end';
  b.onclick = () => { endPick(); renderLobby(); show('lobby'); };
  document.querySelector('.menu-grid > .col:last-child').appendChild(b);
})();

/* ---------- loops ---------- */
let acc = 0, lastStep = performance.now();
/* 60Hz ticker from a Web Worker: browsers throttle page timers to ~1/s in background tabs,
   which would freeze an online match whenever the host switches tabs. Falls back to setInterval. */
function startTicker(fn, ms = 1000 / 60) {
  let fallback = null;
  const useTimer = () => { if (!fallback) fallback = setInterval(fn, ms); };
  try {
    const w = new Worker(URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: 'text/javascript' })));
    w.onmessage = fn; w.onerror = () => { w.terminate(); useTimer(); };
  } catch (e) { useTimer(); }
}
startTicker(() => { if (Net.room && Net.room.keepAlive) Net.room.keepAlive(); advertise(); if (Online.open) renderOnlineList(); }, 4000);
// relayed links send their throttled updates from here, so they keep flowing in a background tab
startTicker(() => { if (Net.room && Net.room.tick) Net.room.tick(); }, 50);
startTicker(() => {
  const now = performance.now(), el = Math.min(0.25, (now - lastStep) / 1000); lastStep = now;
  const k = kind();
  if (!G || !(k === 'offline' || k === 'host' || k === 'demo')) return;
  if (k === 'offline' && App.paused) return;
  if (G.over) {
    if (k === 'demo') { G.overT = (G.overT || 0) + el; if (G.overT > 3) startDemo(); return; }
    if (!App.overShown) { if (k === 'host') hostSendSnap(); G.overT = (G.overT || 0) + el; if (G.overT > 1.6) showEnd(); }
    return;
  }
  acc += el; let n = 0;
  while (acc >= 1 / 60 && n < 8) {
    if (k === 'host') hostReadInputs();
    stepMatch(1 / 60); acc -= 1 / 60; n++;
    // 20 snapshots/s while something moves (shells, walking, falling), 10/s otherwise
    if (k === 'host') { const moving = G.state === 'flight' || G.heroes.some((h) => h.walking || !h.grounded); if (Math.round(G.t * 60) % (moving ? 3 : 6) === 0) hostSendSnap(now - acc * 1000); }
  }
});

let lastFrame = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now; const t = now / 1000;
  animateMenu(t);
  const S = world(); if (!S) return;
  if (kind() === 'client') clientPredict(dt);
  const local = localHero();
  controlTick(dt, S, local);
  if (kind() === 'client') clientLocal(dt, local);
  emitTrails(S.projs, dt);
  SFX.flyUpdate(S.projs);
  SFX.windAmb(kind() === 'demo' ? 0 : viewState(S).wind);
  SFX.ambient(dt);
  if (kind() === 'demo' || !App.game) SFX.want = 0;
  else {
    const vs = viewState(S), hpOf = (t) => { let a = 0, m = 0; for (const h of S.heroes) if (h.team === t) { a += h.dead ? 0 : h.hp; m += h.maxHp; } return m ? a / m : 1; };
    const low = Math.min(hpOf(0), hpOf(1));
    SFX.want = clamp(0.25 + (vs.state === 'aim' ? 0.1 : 0) + (S.projs.length ? 0.2 : 0) + (low < 0.35 ? 0.35 : low < 0.6 ? 0.15 : 0) + (local && isMyTurn(S, local) ? 0.1 : 0), 0, 1);
  }
  updateParticles(dt);
  cameraTick(dt, S, local);
  const [wx, wy] = screenToWorld(App.mouse.x, App.mouse.y); App.mouse.wx = wx; App.mouse.wy = wy;
  if (local) { local.scope = kind() === 'client' ? local.scope : !!(local.turnBuffs && local.turnBuffs.scope); if (kind() !== 'client') local.calm = !!(local.turnBuffs && local.turnBuffs.calm); }
  const r0 = performance.now();
  renderFrame(S, local, t, dt);
  if (!document.hidden) {
    RS.cost += performance.now() - r0; RS.gap += dt * 1000; RS.n++;
    if (RS.n >= 90) {
      const cost = RS.cost / RS.n, gap = RS.gap / RS.n;
      if ((cost > 10 || gap > 24) && RS.k > 0.55) { RS.k = Math.max(0.55, RS.k - 0.15); resize(); }
      else if (cost < 4.5 && gap < 18 && RS.k < 1) { RS.k = Math.min(1, RS.k + 0.15); resize(); }
      RS.cost = RS.gap = RS.n = 0;
    }
  }
  if (App.bannerT > 0) { App.bannerT -= dt; if (App.bannerT <= 0) $('banner').style.opacity = 0; }
  if (kind() !== 'demo' && !$('hud').hidden) {
    updateTop(S, local);
    if (local) updateDock(S, local);
    if (!Tip.pinned && Tip.src !== 'order' && matchMedia('(hover: hover)').matches) {
      const h = !App.drag ? heroAt(App.mouse.wx, App.mouse.wy) : null;
      if (h) { Tip.id = h.id; Tip.x = App.mouse.x; Tip.y = App.mouse.y; Tip.src = 'world'; } else if (Tip.src === 'world') Tip.id = 0;
    }
    if (Tip.id) { if (!App.tipT || now - App.tipT > 100) { App.tipT = now; updateTip(false); } } else $('heroTip').hidden = true;
    if (App.boardOpen) { if (!App.boardT || now - App.boardT > 500) { App.boardT = now; $('board').innerHTML = boardHTML(S, local, false); } }
    if (kind() === 'client' && CV.winner > -2) setTimeout(showEnd, 1500);
  }
}

/* ---------- boot ---------- */
function boot() {
  resize(); renderRoster(); buildMapPreviews(); renderMapPick(); setGfx(App.gfx); startDemo(); show('menu'); tsSummary(); netInit();
  requestAnimationFrame(frame);
}
boot();
