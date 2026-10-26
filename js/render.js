'use strict';
/* ===== Pháo Đài Mây — rendering: sky, terrain, heroes, effects ===== */

const P = [];        // particles (world space)
const FLOATS = [];   // floating texts
let shake = 0, flash = 0;
let P_MAX = 700, AMB_K = 1; // lowered on phones (app.js) to keep frames light
const SKY = { mountains: null, clouds: [], far: [] };

function initSky(seed) {
  const R = mulberry32(seed + 5), K = MAPS[TERR.map].sky;
  SKY.clouds = [];
  for (let i = 0; i < 16; i++) SKY.clouds.push({ x: R() * 4000, y: 40 + R() * 420, s: 0.6 + R() * 1.1, depth: 0.25 + R() * 0.5, puffs: 4 + Math.floor(R() * 4), seed: R(), v: i % CLOUD_VARIANTS });
  SKY.cloudSprites = buildCloudSprites(K, seed);
  SKY.far = [];
  for (let i = 0; i < 7; i++) SKY.far.push({ x: R() * 3600, y: 300 + R() * 260, w: 120 + R() * 220, h: 50 + R() * 70, depth: 0.12 + R() * 0.12, seed: R() });
  SKY.ridge = [noise1(seed + 71), noise1(seed + 72)];
  SKY.stars = [];
  for (let i = 0; i < (K.stars || 0); i++) SKY.stars.push({ x: R(), y: R() * 0.62, r: 0.6 + R() * 1.4, sp: 1 + R() * 3, ph: R() * 6 });
  AMB.length = 0;
}

/* ---------- background (screen space, parallax) ---------- */
function drawSky(g, vw, vh, cam, t, wind) {
  const K = MAPS[TERR.map].sky;
  const art = !K.tribe && typeof artSky === 'function' ? artSky() : null;
  if (art) { // 3D: a painted backdrop, slow parallax, the clouds still drift over it
    const s = Math.max(vw * 1.12 / art.width, vh / art.height), w = art.width * s, h = art.height * s;
    g.drawImage(art, -(w - vw) * clamp(0.5 + (cam.x - W / 2) / W * 0.9, 0, 1), vh - h, w, h);
  } else {
  const gr = g.createLinearGradient(0, 0, 0, vh);
  [0, 0.45, 0.78, 1].forEach((o, i) => gr.addColorStop(o, K.stops[i]));
  g.fillStyle = gr; g.fillRect(0, 0, vw, vh);
  // stars + aurora (night maps)
  for (const st of SKY.stars) { g.fillStyle = `rgba(255,255,255,${0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * st.sp + st.ph))})`; g.fillRect(((st.x * vw - cam.x * 0.01 * cam.zoom) % vw + vw) % vw, st.y * vh, st.r * 1.6, st.r * 1.6); }
  if (K.aurora) {
    g.save(); g.globalCompositeOperation = 'lighter';
    [['80,255,170', 0.16], ['120,180,255', 0.22], ['200,120,255', 0.12]].forEach(([c, base], k) => {
      const ag = g.createLinearGradient(0, vh * (base - 0.05), 0, vh * (base + 0.2));
      ag.addColorStop(0, `rgba(${c},0)`); ag.addColorStop(0.35, `rgba(${c},0.28)`); ag.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = ag; g.beginPath();
      const yAt = (x) => vh * base + Math.sin(x * 0.0035 + t * 0.25 + k * 2) * vh * 0.05 + Math.sin(x * 0.011 - t * 0.4) * vh * 0.015;
      g.moveTo(0, yAt(0)); for (let x = 0; x <= vw + 30; x += 30) g.lineTo(x, yAt(x));
      for (let x = vw + 30; x >= 0; x -= 30) g.lineTo(x, yAt(x) + vh * (0.16 + 0.05 * Math.sin(x * 0.006 + t * 0.5 + k)));
      g.closePath(); g.fill();
    });
    g.restore();
  }
  // Thổ Thần: rainbow light pillars across the sky, as in the event art
  if (K.rainbow) {
    g.save(); g.globalCompositeOperation = 'lighter';
    const cols = ['63,210,122', '255,90,74', '255,210,63', '63,140,255', '255,63,106', '180,110,255', '255,150,60'];
    for (let k = 0; k < cols.length; k++) {
      const cx = ((k + 0.5) / cols.length * 1.3 - 0.15) * vw - cam.x * 0.03 * cam.zoom + Math.sin(t * 0.3 + k) * 20;
      const w = vw * (0.05 + 0.025 * Math.sin(t * 0.7 + k * 1.7)), a = 0.16 + 0.07 * Math.sin(t * 0.9 + k * 2.3);
      const lg = g.createLinearGradient(0, 0, 0, vh * 0.92);
      lg.addColorStop(0, `rgba(${cols[k]},0)`); lg.addColorStop(0.55, `rgba(${cols[k]},${a})`); lg.addColorStop(1, `rgba(${cols[k]},${a * 1.6})`);
      g.fillStyle = lg; g.fillRect(cx - w / 2, 0, w, vh);
    }
    g.restore();
  }
  // sun or moon
  if (K.sun) {
    const S = K.sun, sx = vw * S.x - cam.x * 0.02 * cam.zoom, sy = vh * S.y;
    const sg = g.createRadialGradient(sx, sy, 0, sx, sy, vh * 0.45);
    sg.addColorStop(0, `rgba(${S.glow},0.95)`); sg.addColorStop(0.12, `rgba(${S.glow},0.6)`); sg.addColorStop(1, `rgba(${S.glow},0)`);
    g.fillStyle = sg; g.fillRect(0, 0, vw, vh);
    g.fillStyle = S.col; g.beginPath(); g.arc(sx, sy, vh * S.r, 0, 7); g.fill();
  }
  if (K.tribe) drawTribeBackdrop(g, vw, vh, cam, t, K);
  if (K.glowLow) {
    const lg = g.createRadialGradient(vw / 2, vh * 1.05, 0, vw / 2, vh * 1.05, vh * 0.9);
    lg.addColorStop(0, `rgba(${K.glowLow},0.55)`); lg.addColorStop(1, `rgba(${K.glowLow},0)`);
    g.fillStyle = lg; g.fillRect(0, 0, vw, vh);
  }
  // mountain ridges
  const ridge = (k, col, base, amp, par, freq) => {
    g.fillStyle = col; g.beginPath(); g.moveTo(0, vh);
    const off = cam.x * par;
    for (let x = 0; x <= vw + 20; x += 16) { const n = SKY.ridge[k]((x + off) / freq); g.lineTo(x, vh * base - n * amp * vh); }
    g.lineTo(vw, vh); g.closePath(); g.fill();
  };
  if (SKY.ridge) {
    ridge(0, K.ridges[0], 0.86, 0.22, 0.05, 260);
    ridge(1, K.ridges[1], 0.93, 0.16, 0.09, 180);
  }
  // distant floating islands (mesas on the desert, ruins with columns)
  if (!K.tribe) for (const f of SKY.far) {
    const x = ((f.x - cam.x * f.depth) % 3600 + 3600) % 3600 - 300, y = f.y / H * vh + Math.sin(t * 0.3 + f.seed * 9) * 6;
    const w = f.w * cam.zoom * 0.6, h = f.h * cam.zoom * 0.6;
    g.fillStyle = K.far[0];
    if (K.mesas) {
      const by = vh * 0.9 - f.seed * vh * 0.06, top = by - h * 1.6;
      g.beginPath(); g.moveTo(x - w * 0.5, by); g.lineTo(x - w * 0.36, top + h * 0.2); g.lineTo(x - w * 0.3, top); g.lineTo(x + w * 0.3, top); g.lineTo(x + w * 0.36, top + h * 0.2); g.lineTo(x + w * 0.5, by); g.closePath(); g.fill();
      g.fillStyle = K.far[1]; g.fillRect(x - w * 0.3, top, w * 0.6, h * 0.12);
      continue;
    }
    g.beginPath(); g.moveTo(x - w / 2, y);
    g.bezierCurveTo(x - w * 0.42, y + h * 0.5, x - w * 0.2, y + h * 0.7, x - w * 0.08, y + h * 1.25);
    g.quadraticCurveTo(x, y + h * 1.45, x + w * 0.06, y + h * 1.15);
    g.bezierCurveTo(x + w * 0.22, y + h * 0.7, x + w * 0.44, y + h * 0.45, x + w / 2, y);
    g.closePath(); g.fill();
    g.fillStyle = K.far[1]; g.beginPath(); g.ellipse(x, y, w * 0.52, h * 0.16, 0, 0, 7); g.fill();
    if (K.columns) { g.fillStyle = K.far[0]; for (let k = -2; k <= 2; k++) { if ((k + Math.round(f.seed * 7)) % 3 === 0) continue; const ch = h * (0.5 + ((k + 3) * f.seed * 7 % 1) * 0.5); g.fillRect(x + k * w * 0.16 - w * 0.025, y - ch, w * 0.05, ch); } g.fillRect(x - w * 0.36, y - h * 0.62, w * 0.36, h * 0.07); }
    else { g.fillStyle = K.far[1]; for (let k = -1; k <= 1; k += 2) { g.beginPath(); g.arc(x + k * w * 0.22, y - h * 0.18, h * 0.22, 0, 7); g.fill(); } }
  }
  if (K.tribe) drawTribeSkyLife(g, vw, vh, cam, t);
  }
  // clouds drift with the wind
  for (const c of SKY.clouds) {
    c.x += (6 + wind * 9) * c.depth * 0.016;
    const x = ((c.x - cam.x * c.depth) % 4000 + 4000) % 4000 - 400, y = c.y / H * vh;
    const sp = SKY.cloudSprites && SKY.cloudSprites[c.v];
    if (sp) { const w = 70 * c.s * Math.max(0.6, cam.zoom) * 4.4, h = w * sp.height / sp.width; g.globalAlpha = Math.min(1, (0.55 + c.depth * 0.5) * K.cloudA) * (art ? 0.55 : 1); g.drawImage(sp, x - w / 2, y - h * 0.7, w, h); g.globalAlpha = 1; }
    else drawCloud(g, x, y, 70 * c.s * Math.max(0.6, cam.zoom), c.puffs, c.seed, (0.55 + c.depth * 0.5) * K.cloudA, K.cloud);
  }
  if (K.tribe) drawTribeSign(g, t);
}
/* ---------- Thổ Thần backdrop: sun rays, two ranges of red mesas, the giant GAMOTA sign, the carved earth god ---------- */
const TB = { key: '', bg: null, sign: null };
const BACK_W = 1.4; // the backdrop is wider than the screen so parallax never shows an edge
/* everything static behind the islands goes into one half-resolution image, painted once per screen size:
   rainbow pillars, sun rays, two ranges of mesas, the carved Earth God and a warm haze. One drawImage per frame. */
function tribeLayers(vw, vh, K) {
  const key = vw + 'x' + vh; if (TB.key === key) return;
  TB.key = key;
  const LW = Math.round(vw * BACK_W), pad = (LW - vw) / 2, c = document.createElement('canvas');
  c.width = Math.round(LW / 2); c.height = Math.round(vh / 2);
  const g = c.getContext('2d'); g.scale(c.width / LW, c.height / vh);
  TB.bg = c; TB.LW = LW;
  const R = mulberry32(2013); // Gamota since 2013
  // rainbow light pillars
  g.save(); g.globalCompositeOperation = 'lighter';
  ['63,210,122', '255,90,74', '255,210,63', '63,140,255', '255,63,106', '180,110,255', '255,150,60'].forEach((col, k) => {
    const cx = pad + ((k + 0.5) / 7 * 1.3 - 0.15) * vw, w = vw * (0.045 + 0.02 * ((k * 3) % 4) / 3), a = 0.15 + 0.05 * (k % 3);
    const lg = g.createLinearGradient(0, 0, 0, vh * 0.92); lg.addColorStop(0, `rgba(${col},0)`); lg.addColorStop(0.55, `rgba(${col},${a})`); lg.addColorStop(1, `rgba(${col},${a * 1.6})`);
    g.fillStyle = lg; g.fillRect(cx - w / 2, 0, w, vh);
  });
  // sun rays fanning up from the low sun
  const sx = pad + vw * K.sun.x, sy = vh * K.sun.y;
  for (let k = 0; k < 9; k++) {
    const ang = -Math.PI + (k + 0.5) / 9 * Math.PI, w = 0.05 + (k % 3) * 0.02, L = vh * 1.4;
    g.fillStyle = `rgba(255,214,160,${0.04 + 0.025 * (k % 2)})`;
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(ang - w) * L, sy + Math.sin(ang - w) * L); g.lineTo(sx + Math.cos(ang + w) * L, sy + Math.sin(ang + w) * L); g.closePath(); g.fill();
  }
  g.restore();
  const mesa = (x, w, top, base, col, rim, stripes) => {
    g.fillStyle = col; g.beginPath(); g.moveTo(x - w * 0.62, base);
    g.lineTo(x - w * 0.5, top + (base - top) * 0.35); g.lineTo(x - w * 0.46, top + 6); g.lineTo(x - w * 0.42, top);
    g.lineTo(x + w * 0.42, top); g.lineTo(x + w * 0.46, top + 6); g.lineTo(x + w * 0.5, top + (base - top) * 0.35); g.lineTo(x + w * 0.62, base); g.closePath(); g.fill();
    g.fillStyle = rim; g.fillRect(x - w * 0.42, top, w * 0.84, Math.max(2, vh * 0.006));
    if (stripes) { g.save(); g.clip(); g.fillStyle = stripes; for (let y = top + vh * 0.03; y < base; y += vh * 0.035) g.fillRect(x - w, y, w * 2, vh * 0.008); g.restore(); }
  };
  // far range: hazy purple mesas; the sign stands on the tallest one
  const fb = vh * 0.9;
  for (const [fx, fw, fh] of [[0.06, 0.2, 0.3], [0.38, 0.2, 0.56], [0.62, 0.18, 0.26], [0.86, 0.24, 0.34], [1.15, 0.22, 0.3], [1.34, 0.16, 0.24]])
    mesa(fx * vw, fw * vw, fb - fh * vh, fb + 4, 'rgba(150,80,140,0.42)', 'rgba(255,190,160,0.5)', 'rgba(110,50,110,0.18)');
  g.fillStyle = 'rgba(150,80,140,0.42)'; g.fillRect(0, fb, LW, vh - fb);
  TB.signX = 0.38 * vw; TB.signY = fb - 0.56 * vh; // high in the sky, above where the islands sit
  TB.sign = renderSign(vh);
  // mid range: closer red buttes; the tallest one is carved into the face of the Earth God
  const mb = vh * 0.97;
  for (const [mx, mw, mh] of [[0.0, 0.16, 0.24], [0.22, 0.12, 0.17], [0.5, 0.1, 0.14], [0.86, 0.12, 0.2], [1.12, 0.24, 0.74], [1.36, 0.1, 0.18]])
    mesa(mx * vw + (R() - 0.5) * 20, mw * vw, mb - mh * vh, mb + 4, 'rgba(178,84,104,0.5)', 'rgba(255,200,160,0.65)', 'rgba(130,50,80,0.3)');
  const fx = 1.12 * vw, fy = mb - 0.74 * vh, s = vh * 0.0028;
  g.save(); g.translate(fx, fy + vh * 0.14);
  g.fillStyle = 'rgba(150,62,84,0.75)'; g.beginPath(); g.ellipse(0, 0, 46 * s, 60 * s, 0, 0, 7); g.fill();            // face block
  g.fillStyle = 'rgba(196,96,108,0.8)'; g.fillRect(-50 * s, -30 * s, 100 * s, 12 * s);                                  // brow
  g.fillStyle = 'rgba(70,20,34,0.95)'; for (const e of [-1, 1]) { g.beginPath(); g.ellipse(e * 20 * s, -6 * s, 12 * s, 9 * s, 0, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(196,96,108,0.8)'; g.beginPath(); g.moveTo(-8 * s, -10 * s); g.lineTo(0, 22 * s); g.lineTo(8 * s, -10 * s); g.closePath(); g.fill(); // nose
  g.fillStyle = 'rgba(70,20,34,0.95)'; g.fillRect(-22 * s, 34 * s, 44 * s, 7 * s);                                    // mouth
  g.fillStyle = 'rgba(70,140,220,0.75)';                                                                                // carved crest: 3 plumes
  for (const [dx, h] of [[-26, 34], [26, 34], [0, 48]]) { g.beginPath(); g.moveTo(dx * s - 14 * s, -36 * s); g.quadraticCurveTo(dx * s, -36 * s - h * s * 1.3, dx * s + 14 * s, -36 * s); g.closePath(); g.fill(); }
  g.restore();
  TB.godX = fx; TB.godY = fy + vh * 0.14 - 6 * s; TB.godS = s;
  g.fillStyle = 'rgba(178,84,104,0.5)'; g.fillRect(0, mb, LW, vh - mb);
  // warm haze pushes the whole backdrop behind the islands
  const hz = g.createLinearGradient(0, vh * 0.35, 0, vh); hz.addColorStop(0, 'rgba(255,170,150,0)'); hz.addColorStop(1, 'rgba(255,170,150,0.35)');
  g.fillStyle = hz; g.fillRect(0, vh * 0.35, LW, vh * 0.65);
}
/* the real Gamota logo: white on transparent (assets/gamota-logo.png), tinted as needed.
   Until it loads (or where the file is missing, e.g. on claude.ai) the drawn mark and wordmark below are used. */
const LOGO = { mask: null, tints: {}, onReady: null };
(function loadLogo() {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return;
  const img = new Image();
  img.onload = () => {
    LOGO.mask = img; LOGO.tints = {};
    TB.key = ''; crownCv = null; DL.src = null; // repaint everything that shows the logo
    if (LOGO.onReady) LOGO.onReady();
  };
  img.src = 'assets/gamota-logo.png';
})();
function logoTint(col) {
  if (!LOGO.mask) return null;
  let c = LOGO.tints[col]; if (c) return c;
  c = LOGO.tints[col] = document.createElement('canvas'); c.width = LOGO.mask.naturalWidth; c.height = LOGO.mask.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(LOGO.mask, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height);
  return c;
}
/* draw the logo h tall with its left edge at x (centre when align = 'center'); returns its width, or 0 if not loaded */
function drawLogo(g, x, y, h, col, align = 'left') {
  const L = logoTint(col); if (!L) return 0;
  const w = h * L.width / L.height, q = g.imageSmoothingQuality;
  g.imageSmoothingQuality = 'high'; g.drawImage(L, align === 'center' ? x - w / 2 : x, y, w, h); g.imageSmoothingQuality = q;
  return w;
}
/* the Gamota mark, traced from the logo: three separate blades stacked like a stylised F.
   Top: a wing with a curved top and its point to the right. Middle: a short band. Bottom: a blade curving down to a point.
   Returns a canvas h tall and about 0.78h wide. */
function gamotaMark(h, col) {
  const c = document.createElement('canvas'); c.width = Math.ceil(h * 0.8) + 4; c.height = Math.ceil(h) + 4;
  const g = c.getContext('2d'); g.translate(2, 2); g.fillStyle = col;
  const P = (u, v) => [u * h, v * h];
  // top wing
  g.beginPath(); g.moveTo(...P(0.149, 0.004));
  g.quadraticCurveTo(...P(0.52, 0.06), ...P(0.766, 0.298));      // curved top edge out to the point
  g.lineTo(...P(0.638, 0.404));
  g.quadraticCurveTo(...P(0.3, 0.33), ...P(0.0, 0.383));          // underside
  g.quadraticCurveTo(...P(0.04, 0.18), ...P(0.149, 0.004));       // left edge
  g.fill();
  // middle band
  g.beginPath(); g.moveTo(...P(0.149, 0.464));
  g.quadraticCurveTo(...P(0.4, 0.445), ...P(0.606, 0.451));
  g.lineTo(...P(0.521, 0.57));
  g.quadraticCurveTo(...P(0.29, 0.6), ...P(0.106, 0.713));
  g.quadraticCurveTo(...P(0.115, 0.58), ...P(0.149, 0.464));
  g.fill();
  // bottom blade
  g.beginPath(); g.moveTo(...P(0.287, 0.713));
  g.lineTo(...P(0.532, 0.628));
  g.quadraticCurveTo(...P(0.52, 0.85), ...P(0.309, 0.996));        // outer edge curving down to the point
  g.quadraticCurveTo(...P(0.25, 0.86), ...P(0.287, 0.713));
  g.fill();
  return c;
}
/* the GAMOTA sign, drawn once: the mark and big lit letters on scaffold legs, with the slogan under it */
function renderSign(vh) {
  if (LOGO.mask) return renderLogoSign(vh);
  const fh = Math.round(vh * 0.085), c = document.createElement('canvas'), pad = fh;
  const g0 = c.getContext('2d'); g0.font = `800 ${fh}px "Baloo 2", sans-serif`;
  const tw = g0.measureText('GAMOTA').width * 1.12, sub = Math.round(fh * 0.3), mw = fh * 1.08, gap = fh * 0.14;
  const full = mw + gap + tw;
  c.width = Math.ceil(full + pad * 2); c.height = Math.ceil(fh * 2.1 + pad);
  const g = c.getContext('2d'), x0 = pad, tx = x0 + mw + gap, base = pad * 0.5 + fh;
  g.strokeStyle = 'rgba(70,30,40,0.85)'; g.lineWidth = Math.max(2, fh * 0.04);
  for (let k = 0; k <= 7; k++) { const x = x0 + full * k / 7; g.beginPath(); g.moveTo(x, base - fh * 0.3); g.lineTo(x - fh * 0.12, c.height); g.moveTo(x, base - fh * 0.3); g.lineTo(x + fh * 0.12, c.height); g.stroke(); }
  g.shadowColor = 'rgba(255,200,120,0.95)'; g.shadowBlur = fh * 0.45;
  g.drawImage(gamotaMark(fh * 1.36, '#fff3d6'), x0, base - fh * 1.02); // taller than the letters, as in the logo
  g.font = `800 ${fh}px "Baloo 2", sans-serif`; g.textBaseline = 'alphabetic';
  let x = tx; const step = tw / 6;
  for (const ch of 'GAMOTA') { g.fillStyle = '#fff3d6'; g.fillText(ch, x + (step - g.measureText(ch).width) / 2, base); x += step; }
  g.shadowBlur = 0; g.lineWidth = Math.max(1.5, fh * 0.03); g.strokeStyle = '#c0432c';
  x = tx; for (const ch of 'GAMOTA') { g.strokeText(ch, x + (step - g.measureText(ch).width) / 2, base); x += step; }
  // marquee bulbs along the top and bottom edge
  g.fillStyle = '#ffe680'; for (let k = 0; k <= 28; k++) { const bx = x0 + full * k / 28; g.beginPath(); g.arc(bx, base - fh * 0.98, fh * 0.035, 0, 7); g.arc(bx, base + fh * 0.14, fh * 0.035, 0, 7); g.fill(); }
  // slogan, letter-spaced like the logo
  g.font = `800 ${sub}px "Baloo 2", sans-serif`;
  const slogan = 'GAME IS GOOD', sp = sub * 0.5, sw = [...slogan].reduce((a, ch) => a + g.measureText(ch).width + sp, -sp), sy = base + fh * 0.52;
  g.fillStyle = 'rgba(90,26,24,0.72)'; roundRect(g, tx + tw / 2 - sw / 2 - sub * 0.6, sy - sub * 0.95, sw + sub * 1.2, sub * 1.3, sub * 0.4); g.fill(); // dark plate behind
  g.fillStyle = '#fff3d6'; g.shadowColor = 'rgba(255,170,90,0.9)'; g.shadowBlur = sub * 0.6;
  x = tx + tw / 2 - sw / 2; for (const ch of slogan) { g.fillText(ch, x, sy); x += g.measureText(ch).width + sp; }
  return c;
}
/* the sign built from the real logo: glowing logo on scaffold legs, marquee bulbs above and below */
function renderLogoSign(vh) {
  const lh = Math.round(vh * 0.125), lw = lh * LOGO.mask.naturalWidth / LOGO.mask.naturalHeight, pad = lh * 0.35, c = document.createElement('canvas');
  c.width = Math.ceil(lw + pad * 2); c.height = Math.ceil(lh * 1.75);
  const g = c.getContext('2d'), top = pad * 0.6;
  g.strokeStyle = 'rgba(70,30,40,0.85)'; g.lineWidth = Math.max(2, lh * 0.02);
  for (let k = 0; k <= 7; k++) { const x = pad + lw * k / 7, y0 = top + lh * 1.08; g.beginPath(); g.moveTo(x, y0); g.lineTo(x - lh * 0.06, c.height); g.moveTo(x, y0); g.lineTo(x + lh * 0.06, c.height); g.stroke(); } // legs start under the board
  // dark backing so the white logo reads against the bright sky
  g.fillStyle = 'rgba(70,20,40,0.42)'; roundRect(g, pad * 0.5, top - lh * 0.08, lw + pad, lh * 1.16, lh * 0.12); g.fill();
  g.fillStyle = '#ffe680'; for (let k = 0; k <= 30; k++) { const bx = pad * 0.6 + (lw + pad * 0.8) * k / 30; g.beginPath(); g.arc(bx, top - lh * 0.08, lh * 0.018, 0, 7); g.arc(bx, top + lh * 1.08, lh * 0.018, 0, 7); g.fill(); }
  g.shadowColor = 'rgba(255,190,110,0.95)'; g.shadowBlur = lh * 0.18;
  drawLogo(g, pad, top, lh, '#fff6e6');
  g.shadowBlur = 0; drawLogo(g, pad, top, lh, '#ffffff');
  return c;
}
function drawTribeBackdrop(g, vw, vh, cam, t, K) {
  tribeLayers(vw, vh, K);
  const o = TB.fo = -vw * (BACK_W - 1) / 2 - (cam.x - W / 2) * 0.035 * cam.zoom;
  g.drawImage(TB.bg, o, 0, TB.LW, vh);
  // the Earth God's eyes glow
  const ex = o + TB.godX, ey = TB.godY, es = TB.godS, pul = 0.6 + 0.4 * Math.sin(t * 1.6);
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const e of [-1, 1]) { glow(g, ex + e * 20 * es, ey, 28 * es, '#ff9a46', 0.9 * pul); glow(g, ex + e * 20 * es, ey, 11 * es, '#ffe08a', pul); }
  g.restore();
}
/* the giant GAMOTA sign: drawn after the clouds so nothing in the sky hides it */
function drawTribeSign(g, t) {
  if (!TB.sign) return;
  const sw = TB.sign.width, sh = TB.sign.height, signX = TB.fo + TB.signX - sw / 2, signY = TB.signY - sh + sh * 0.04;
  g.save(); g.globalCompositeOperation = 'lighter';
  glow(g, signX + sw / 2, signY + sh * 0.45, sw * 0.6, '#ffbe6e', 0.55 + 0.15 * Math.sin(t * 2));
  g.restore();
  g.drawImage(TB.sign, signX, signY);
}
/* sky lanterns drifting up and birds gliding across */
const LANTERNS = Array.from({ length: 16 }, (_, i) => ({ x: (i * 0.618) % 1, y0: (i * 0.37) % 1, sp: 0.012 + (i % 5) * 0.004, s: 0.6 + (i % 4) * 0.18, ph: i * 1.3 }));
const BIRDS = Array.from({ length: 4 }, (_, i) => ({ x0: i * 0.31, y: 0.16 + i * 0.07, sp: 0.018 + i * 0.006, s: 0.8 + (i % 2) * 0.4 }));
let lanternCv = null;
function lanternSprite() {
  if (lanternCv) return lanternCv;
  const c = lanternCv = document.createElement('canvas'); c.width = c.height = 64;
  const k = c.getContext('2d'), r = 8;
  const lg = k.createRadialGradient(32, 32, 0, 32, 32, 32); lg.addColorStop(0, 'rgba(255,190,90,0.5)'); lg.addColorStop(1, 'rgba(255,150,60,0)');
  k.fillStyle = lg; k.fillRect(0, 0, 64, 64);
  k.fillStyle = 'rgba(255,170,80,0.9)'; k.beginPath(); k.moveTo(32 - r * 0.7, 32 - r); k.lineTo(32 + r * 0.7, 32 - r); k.lineTo(32 + r * 0.55, 32 + r); k.lineTo(32 - r * 0.55, 32 + r); k.closePath(); k.fill();
  k.fillStyle = 'rgb(255,240,180)'; k.fillRect(32 - r * 0.25, 32 + r * 0.3, r * 0.5, r * 0.5);
  return c;
}
const lowFx = () => typeof RS !== 'undefined' && RS.k < 0.8; // the game already dropped resolution: skip the extras
function drawTribeSkyLife(g, vw, vh, cam, t) {
  if (lowFx()) return;
  const sp = lanternSprite();
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const L of LANTERNS) {
    const y = (((L.y0 - t * L.sp) % 1.15) + 1.15) % 1.15 * vh * 0.9, x = ((L.x * vw * 1.2 - cam.x * 0.04 * cam.zoom + Math.sin(t * 0.4 + L.ph) * 14) % (vw * 1.2) + vw * 1.2) % (vw * 1.2) - vw * 0.1;
    const r = vh * 0.012 * L.s * 4;
    g.globalAlpha = 0.75 + 0.25 * Math.sin(t * 6 + L.ph * 3);
    g.drawImage(sp, x - r, y - r, r * 2, r * 2);
  }
  g.restore();
  g.strokeStyle = 'rgba(70,30,60,0.65)'; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const B of BIRDS) {
    const x = ((B.x0 + t * B.sp) % 1.3 - 0.15) * vw, y = B.y * vh + Math.sin(t * 0.7 + B.x0 * 9) * vh * 0.02, w = vh * 0.018 * B.s, f = Math.sin(t * 7 + B.x0 * 20) * w * 0.5;
    g.lineWidth = Math.max(1.5, w * 0.14); g.beginPath(); g.moveTo(x - w, y - f); g.quadraticCurveTo(x - w * 0.4, y - w * 0.3, x, y); g.quadraticCurveTo(x + w * 0.4, y - w * 0.3, x + w, y - f); g.stroke();
  }
}
/* the GAMOTA plaque that crowns the totem; it sits on whatever is left of the totem */
let crownCv = null;
function drawTotemCrown(g, t) {
  const T = TERR.totem; if (!T) return;
  let y = -1; for (let yy = T.top - 10; yy < T.top + T.tiers * T.tierH + 40; yy += 2) if (solid(W / 2 - 4, yy) || solid(W / 2 + 4, yy)) { y = yy; break; }
  if (y < 0) return;
  if (!crownCv) {
    const sc = 3, c = crownCv = document.createElement('canvas'); c.width = 180 * sc; c.height = 92 * sc;
    const k = c.getContext('2d'); k.scale(sc, sc);
    // sunburst behind the plaque
    k.fillStyle = '#ffd23f'; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; k.beginPath(); k.moveTo(90, 40); k.lineTo(90 + Math.cos(a - 0.09) * 44, 40 + Math.sin(a - 0.09) * 44); k.lineTo(90 + Math.cos(a + 0.09) * 44, 40 + Math.sin(a + 0.09) * 44); k.closePath(); k.fill(); }
    k.strokeStyle = '#6b4226'; k.lineWidth = 5; k.beginPath(); k.moveTo(58, 52); k.lineTo(58, 92); k.moveTo(122, 52); k.lineTo(122, 92); k.stroke();
    k.fillStyle = '#c7442e'; k.strokeStyle = '#4f2414'; k.lineWidth = 3; roundRect(k, 14, 22, 152, 40, 9); k.fill(); k.stroke();
    k.fillStyle = '#fff0d6'; zigzag(k, 18, 162, 54, 5, 20); k.fill();
    if (!drawLogo(k, 90, 24, 31, '#fff6e6', 'center')) {
      k.font = '800 30px "Baloo 2", sans-serif'; k.textAlign = 'center'; k.lineJoin = 'round';
      k.lineWidth = 5; k.strokeStyle = '#4f2414'; k.strokeText('GAMOTA', 90, 51); k.fillStyle = '#fff3d6'; k.fillText('GAMOTA', 90, 51);
    }
  }
  const w = 180, h = 92;
  glow(g, W / 2, y - 52, 90, '#ffb347', 0.3 + 0.08 * Math.sin(t * 2));
  g.drawImage(crownCv, W / 2 - w / 2, y - h + 2, w, h);
}
/* soft cumulus clouds, painted once per map into sprites: flat shaded base, puffy lit top, rim highlights */
const CLOUD_VARIANTS = 6;
function buildCloudSprites(K, seed) {
  const R = mulberry32(seed + 77), out = [];
  const rgb = (s) => s.split(',').map(Number), mixc = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const base = rgb(K.cloud || '255,255,255'), lit = rgb(K.cloudLit || '255,255,255'), shade = K.cloudShade ? rgb(K.cloudShade) : mixc(base, [118, 132, 176], 0.42);
  for (let v = 0; v < CLOUD_VARIANTS; v++) {
    const cw = 360, ch = 170, c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const g = c.getContext('2d'), floor = ch * 0.78, n = 5 + Math.floor(R() * 4), puffs = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), x = cw * (0.16 + u * 0.68) + (R() - 0.5) * 18, r = (0.18 + Math.sin(u * Math.PI) * 0.16 + R() * 0.06) * ch;
      puffs.push({ x, y: floor - r * (0.55 + R() * 0.25), r });
    }
    const shape = (dy = 0, k = 1) => { g.beginPath(); for (const p of puffs) { g.moveTo(p.x + p.r * k, p.y + dy); g.arc(p.x, p.y + dy, p.r * k, 0, 7); } g.rect(puffs[0].x, floor - ch * 0.14 + dy, puffs[n - 1].x - puffs[0].x, ch * 0.14); };
    if ('filter' in g) g.filter = 'blur(1.2px)';
    // body: shaded at the bottom, lit at the top
    const gr = g.createLinearGradient(0, floor - ch * 0.62, 0, floor);
    gr.addColorStop(0, `rgb(${lit})`); gr.addColorStop(0.55, `rgb(${base})`); gr.addColorStop(1, `rgb(${shade})`);
    g.fillStyle = gr; shape(); g.fill();
    // a soft highlight on each puff, towards the top-left
    for (const p of puffs) {
      const hg = g.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.4, 0, p.x - p.r * 0.3, p.y - p.r * 0.4, p.r * 0.9);
      hg.addColorStop(0, `rgba(${lit},0.85)`); hg.addColorStop(1, `rgba(${lit},0)`);
      g.fillStyle = hg; g.beginPath(); g.arc(p.x, p.y, p.r * 0.98, 0, 7); g.fill();
    }
    // inner shadow along the flat base
    g.globalCompositeOperation = 'source-atop';
    const sg = g.createLinearGradient(0, floor - ch * 0.2, 0, floor); sg.addColorStop(0, `rgba(${shade},0)`); sg.addColorStop(1, `rgba(${shade},0.75)`);
    g.fillStyle = sg; g.fillRect(0, floor - ch * 0.2, cw, ch * 0.2);
    g.globalCompositeOperation = 'source-over';
    // flatten the bottom with a soft cut
    g.globalCompositeOperation = 'destination-out'; if ('filter' in g) g.filter = 'blur(3px)';
    g.fillStyle = '#000'; g.fillRect(0, floor + 2, cw, ch);
    g.globalCompositeOperation = 'source-over'; if ('filter' in g) g.filter = 'none';
    out.push(c);
  }
  return out;
}
function drawCloud(g, x, y, s, n, seed, a, rgb = '255,255,255') {
  g.fillStyle = `rgba(${rgb},${a})`;
  for (let i = 0; i < n; i++) {
    const px = x + (i - n / 2) * s * 0.55, py = y - Math.sin(i / (n - 1 || 1) * Math.PI) * s * 0.35 + ((seed * 97 + i * 13) % 7) - 3;
    g.beginPath(); g.arc(px, py, s * (0.42 + ((seed * 31 + i * 7) % 5) * 0.05), 0, 7); g.fill();
  }
  g.fillStyle = `rgba(${rgb},${a * 0.45})`; g.beginPath(); g.ellipse(x - s * 0.1, y + s * 0.18, s * n * 0.28, s * 0.16, 0, 0, 7); g.fill();
}

/* ---------- ambient weather (snow, dust, embers, petals) ---------- */
const AMB = [];
function ambientTick(g, dt, x0, x1, y0, y1, wind, t) {
  const kind = MAPS[TERR.map].ambient; if (!kind) return;
  const rate = { snow: 60, dust: 18, ember: 22, petal: 7 }[kind] * AMB_K;
  let n = rate * dt; while (n > 0 && AMB.length < 220) {
    if (Math.random() < n) {
      const a = { x: rnd(x0 - 200, x1 + 200), y: y0 - 20, t: 0, r: rnd(1.4, 3.2), sp: Math.random() * 6, life: rnd(7, 12) };
      if (kind === 'snow') { a.vy = rnd(35, 70); }
      else if (kind === 'dust') { a.y = rnd(y0, y1); a.x = wind >= 0 ? x0 - 40 : x1 + 40; a.vy = rnd(-6, 6); a.r = rnd(1, 2.2); }
      else if (kind === 'ember') { a.y = y1 + 10; a.vy = -rnd(30, 70); a.r = rnd(1.2, 2.6); }
      else { a.vy = rnd(25, 45); a.r = rnd(3, 5); a.rot = Math.random() * 6; }
      AMB.push(a);
    }
    n -= 1;
  }
  g.save();
  if (kind === 'ember') g.globalCompositeOperation = 'lighter';
  for (let i = AMB.length - 1; i >= 0; i--) {
    const a = AMB[i]; a.t += dt;
    const sway = Math.sin(a.t * 1.5 + a.sp) * (kind === 'petal' ? 30 : 12);
    a.x += ((kind === 'dust' ? 140 : 18) * wind + sway * 0.6) * dt; a.y += a.vy * dt;
    if (a.t > a.life || a.y > H + 20 || a.y < y0 - 60) { AMB.splice(i, 1); continue; }
    const fade = Math.min(1, a.t * 2, (a.life - a.t) * 2);
    if (kind === 'snow') { g.fillStyle = `rgba(255,255,255,${0.85 * fade})`; g.beginPath(); g.arc(a.x, a.y, a.r, 0, 7); g.fill(); }
    else if (kind === 'dust') { g.strokeStyle = `rgba(255,226,170,${0.4 * fade})`; g.lineWidth = a.r; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(a.x - Math.sign(wind || 1) * 16, a.y); g.stroke(); }
    else if (kind === 'ember') { g.fillStyle = `rgba(255,${120 + (a.sp * 20 | 0)},50,${0.8 * fade * (0.6 + 0.4 * Math.sin(t * 9 + a.sp))})`; g.beginPath(); g.arc(a.x, a.y, a.r, 0, 7); g.fill(); }
    else { g.save(); g.translate(a.x, a.y); g.rotate(a.rot + a.t * 2); g.fillStyle = `rgba(255,182,214,${0.85 * fade})`; g.beginPath(); g.ellipse(0, 0, a.r, a.r * 0.5, 0, 0, 7); g.fill(); g.restore(); }
  }
  g.restore();
}

/* ---------- decor ---------- */
/* Static decor is painted once into a cached layer (redrawn only when decor changes); only glowing,
   flickering pieces are drawn live. Drawing ~180 trees and tufts every frame cost 5-10ms. */
const DL = { cv: null, src: null, map: '' };
const decorLive = (d) => d.type === 'vent' || d.type === 'lantern' || d.type === 'campfire' || d.type === 'flag' || (d.type === 'crystal' && TERR.map === 'nui');
function drawDecorLayer(g, t, x0, x1) {
  if (DL.src !== TERR.decor || DL.map !== TERR.map) {
    const sc = typeof TOUCHUI !== 'undefined' && TOUCHUI ? 1 : Math.min(1.5, window.devicePixelRatio || 1);
    if (!DL.cv) DL.cv = document.createElement('canvas');
    if (DL.cv.width !== Math.round(W * sc)) { DL.cv.width = Math.round(W * sc); DL.cv.height = Math.round(H * sc); }
    const c = DL.cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, DL.cv.width, DL.cv.height); c.setTransform(sc, 0, 0, sc, 0, 0);
    for (const d of TERR.decor) if (d.type === 'tree' && !decorLive(d)) drawDecor(c, d, 0, -1e4, 1e4);
    for (const d of TERR.decor) if (d.type !== 'tree' && !decorLive(d)) drawDecor(c, d, 0, -1e4, 1e4);
    DL.src = TERR.decor; DL.map = TERR.map;
  }
  g.drawImage(DL.cv, 0, 0, DL.cv.width, DL.cv.height, 0, 0, W, H);
  for (const d of TERR.decor) if (decorLive(d)) drawDecor(g, d, t, x0, x1);
}
function drawDecor(g, d, t, x0, x1) {
  if (d.x < x0 - 120 || d.x > x1 + 120) return;
  const sway = Math.sin(t * 1.6 + d.seed * 10) * 2;
  const s = d.s;
  switch (d.type) {
    case 'tuft':
    case 'ashtuft': case 'snowtuft':
      g.strokeStyle = d.col || '#5cae45'; g.lineWidth = 2; g.lineCap = 'round';
      for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(d.x + k * 3, d.y + 1); g.quadraticCurveTo(d.x + k * 4, d.y - 6 * s, d.x + k * 6 + sway, d.y - 11 * s); g.stroke(); }
      if (d.type === 'snowtuft') { g.fillStyle = '#ffffff'; for (let k = -1; k <= 1; k++) { g.beginPath(); g.arc(d.x + k * 6 + sway, d.y - 11 * s, 1.8, 0, 7); g.fill(); } }
      break;
    case 'drygrass':
      g.strokeStyle = d.col; g.lineWidth = 1.6; g.lineCap = 'round';
      for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(d.x + k * 2, d.y + 1); g.quadraticCurveTo(d.x + k * 5, d.y - 5 * s, d.x + k * 8 + sway * 1.5, d.y - (8 + (k & 1) * 4) * s); g.stroke(); }
      break;
    case 'deadbush':
      g.strokeStyle = TERR.map === 'nui' ? '#3a2a26' : '#8a6a4a'; g.lineWidth = 1.6; g.lineCap = 'round';
      for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k - 2) * 0.42, l = (10 + (k % 2) * 5) * s; g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x + Math.cos(a) * l, d.y + Math.sin(a) * l); g.lineTo(d.x + Math.cos(a - 0.5) * l * 1.3, d.y + Math.sin(a - 0.5) * l * 1.3); g.stroke(); }
      break;
    case 'cactus': {
      const h = 18 * s, w = 9 * s;
      g.fillStyle = '#4f9a54'; roundRect(g, d.x - w / 2, d.y - h, w, h + 2, w / 2); g.fill();
      g.strokeStyle = 'rgba(30,70,40,0.4)'; g.lineWidth = 1; g.beginPath(); g.moveTo(d.x, d.y - h + 3); g.lineTo(d.x, d.y); g.stroke();
      g.fillStyle = '#6fbf6a'; g.fillRect(d.x - w / 2 + 2, d.y - h + 4, 2, h - 6);
      if (d.seed > 0.6) { g.fillStyle = '#ff7aa8'; g.beginPath(); g.arc(d.x, d.y - h, 3 * s, 0, 7); g.fill(); }
      break;
    }
    case 'saguaro': {
      const h = 78 * s, w = 14 * s, col = '#4f9a54', hi = '#6fbf6a';
      g.fillStyle = col; roundRect(g, d.x - w / 2, d.y - h, w, h + 2, w / 2); g.fill();
      const arm = (dir, y0, len) => { g.fillStyle = col; roundRect(g, d.x + dir * w * 0.3 - (dir < 0 ? w * 1.4 : 0), d.y - y0, w * 1.4, w * 0.8, w * 0.4); g.fill(); roundRect(g, d.x + dir * w * 1.3 - w * 0.4, d.y - y0 - len, w * 0.8, len + w * 0.6, w * 0.4); g.fill(); };
      arm(-1, h * 0.45, h * 0.3); arm(1, h * 0.6, h * 0.25);
      g.fillStyle = hi; g.fillRect(d.x - w * 0.25, d.y - h + 6, 2.5, h - 10);
      break;
    }
    case 'crystal': {
      g.fillStyle = d.c; g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1;
      for (const [dx, hh, ww, a] of [[-5, 14, 4, -0.3], [0, 20, 5, 0], [6, 12, 4, 0.35]]) {
        g.save(); g.translate(d.x + dx * s, d.y + 2); g.rotate(a);
        g.beginPath(); g.moveTo(-ww * s, 0); g.lineTo(-ww * s * 0.8, -hh * s * 0.75); g.lineTo(0, -hh * s); g.lineTo(ww * s * 0.8, -hh * s * 0.75); g.lineTo(ww * s, 0); g.closePath(); g.fill(); g.stroke(); g.restore();
      }
      if (TERR.map === 'nui') glow(g, d.x, d.y - 8 * s, 22 * s, '#ff6a2c', 0.35 + 0.15 * Math.sin(t * 3 + d.seed * 9));
      break;
    }
    case 'smallpine': case 'pine': {
      const big = d.type === 'pine', h = (big ? 96 : 26) * s, w = (big ? 40 : 12) * s;
      g.fillStyle = '#6b4a34'; g.fillRect(d.x - (big ? 4 : 1.5) * s, d.y - h * 0.25, (big ? 8 : 3) * s, h * 0.25 + 2);
      for (let k = 0; k < 3; k++) {
        const ty = d.y - h * 0.2 - k * h * 0.26, tw = w * (1 - k * 0.24);
        g.fillStyle = k % 2 ? '#2f6b5a' : '#28604f'; g.beginPath(); g.moveTo(d.x - tw / 2, ty); g.lineTo(d.x + sway * 0.3, ty - h * 0.42); g.lineTo(d.x + tw / 2, ty); g.closePath(); g.fill();
        g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(d.x - tw * 0.18, ty - h * 0.28); g.lineTo(d.x + sway * 0.3, ty - h * 0.42); g.lineTo(d.x + tw * 0.18, ty - h * 0.28); g.closePath(); g.fill();
      }
      break;
    }
    case 'deadtree': {
      const h = 80 * s;
      g.strokeStyle = '#2e2220'; g.lineCap = 'round';
      g.lineWidth = 8 * s; g.beginPath(); g.moveTo(d.x, d.y + 2); g.quadraticCurveTo(d.x - 4 * s, d.y - h * 0.5, d.x + 3 * s, d.y - h); g.stroke();
      g.lineWidth = 3.5 * s;
      for (const [y, dir, l] of [[0.45, -1, 0.35], [0.6, 1, 0.3], [0.78, -1, 0.22], [0.88, 1, 0.18]]) { g.beginPath(); g.moveTo(d.x, d.y - h * y); g.lineTo(d.x + dir * h * l, d.y - h * (y + l * 0.6)); g.stroke(); }
      glow(g, d.x, d.y - 4, 16 * s, '#ff6a2c', 0.18);
      break;
    }
    case 'vent': {
      g.fillStyle = '#1e1414'; g.beginPath(); g.ellipse(d.x, d.y, 10 * s, 3.5 * s, 0, 0, 7); g.fill();
      const fl = 0.55 + 0.25 * Math.sin(t * 4 + d.seed * 20);
      glow(g, d.x, d.y - 2, 18 * s, '#ff7a2c', fl);
      g.fillStyle = `rgba(255,190,90,${fl})`; g.beginPath(); g.ellipse(d.x, d.y, 6 * s, 1.8 * s, 0, 0, 7); g.fill();
      for (let k = 0; k < 3; k++) { const ph = (t * 0.5 + d.seed + k / 3) % 1; g.fillStyle = `rgba(120,100,100,${0.35 * (1 - ph)})`; g.beginPath(); g.arc(d.x + Math.sin(ph * 6 + k) * 5, d.y - ph * 46 * s, 4 + ph * 9, 0, 7); g.fill(); }
      break;
    }
    case 'column': {
      const h = (26 + d.seed * 30) * s, w = 12 * s;
      g.fillStyle = '#e6dccb'; g.fillRect(d.x - w / 2, d.y - h, w, h + 2);
      g.fillStyle = 'rgba(120,105,85,0.25)'; for (let k = -1; k <= 1; k++) g.fillRect(d.x + k * w * 0.28 - 0.7, d.y - h, 1.4, h);
      g.fillStyle = '#d4c8b4'; g.fillRect(d.x - w * 0.7, d.y - 4 * s, w * 1.4, 4 * s + 2);
      g.fillStyle = '#e6dccb'; g.beginPath(); g.moveTo(d.x - w / 2, d.y - h); g.lineTo(d.x - w * 0.2, d.y - h - 4 * s); g.lineTo(d.x + w * 0.1, d.y - h - 1); g.lineTo(d.x + w / 2, d.y - h - 6 * s); g.lineTo(d.x + w / 2, d.y - h); g.closePath(); g.fill();
      if (d.seed > 0.5) { g.strokeStyle = '#6fb352'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(d.x - w / 2, d.y); g.quadraticCurveTo(d.x + w * 0.6, d.y - h * 0.4, d.x - w * 0.3, d.y - h * 0.8); g.stroke(); }
      break;
    }
    case 'lantern': {
      const h = 34 * s;
      g.strokeStyle = '#6b4a2a'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(d.x, d.y + 2); g.lineTo(d.x, d.y - h); g.lineTo(d.x + 9 * s, d.y - h); g.stroke();
      const fl = 0.75 + 0.2 * Math.sin(t * 7 + d.seed * 30);
      glow(g, d.x + 9 * s, d.y - h + 9 * s, 22 * s, '#ffcf6b', 0.45 * fl);
      g.fillStyle = '#c0392b'; roundRect(g, d.x + 5 * s, d.y - h + 2, 8 * s, 11 * s, 3); g.fill();
      g.fillStyle = `rgba(255,220,120,${fl})`; g.fillRect(d.x + 7 * s, d.y - h + 5, 4 * s, 6 * s);
      break;
    }
    case 'teepee': { // tribal tent: hide cover with zigzag trim, crossed poles on top
      const h = 74 * s, w = 62 * s, red = d.seed > 0.5;
      g.strokeStyle = '#5a3a22'; g.lineWidth = 2.4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(d.x - 6 * s, d.y - h - 10 * s); g.lineTo(d.x + 3 * s, d.y - h + 8 * s); g.moveTo(d.x + 7 * s, d.y - h - 9 * s); g.lineTo(d.x - 3 * s, d.y - h + 8 * s); g.stroke();
      g.fillStyle = red ? '#d8573a' : '#e2a85a'; g.beginPath(); g.moveTo(d.x - w / 2, d.y + 2); g.lineTo(d.x, d.y - h); g.lineTo(d.x + w / 2, d.y + 2); g.closePath(); g.fill();
      g.fillStyle = red ? '#b8432c' : '#c98a40'; g.beginPath(); g.moveTo(d.x, d.y - h); g.lineTo(d.x + w / 2, d.y + 2); g.lineTo(d.x + w * 0.12, d.y + 2); g.closePath(); g.fill();
      g.save(); g.beginPath(); g.moveTo(d.x - w / 2, d.y + 2); g.lineTo(d.x, d.y - h); g.lineTo(d.x + w / 2, d.y + 2); g.closePath(); g.clip();
      for (const [yy, c1, c2] of [[0.78, '#fff0d6', '#2f8fd0'], [0.42, '#fff0d6', '#d8432f']]) {
        const by = d.y - h * (1 - yy); g.fillStyle = c1; g.fillRect(d.x - w, by - 5 * s, w * 2, 8 * s);
        g.fillStyle = c2; zigzag(g, d.x - w, d.x + w, by - 5 * s, 6 * s, 24); g.fill();
      }
      g.restore();
      g.fillStyle = '#3a2418'; g.beginPath(); g.moveTo(d.x - 8 * s, d.y + 2); g.lineTo(d.x, d.y - 20 * s); g.lineTo(d.x + 8 * s, d.y + 2); g.closePath(); g.fill();
      break;
    }
    case 'campfire': {
      g.fillStyle = '#7a7268'; for (let k = -2; k <= 2; k++) { g.beginPath(); g.ellipse(d.x + k * 6 * s, d.y - 1, 3.6 * s, 2.6 * s, 0, 0, 7); g.fill(); }
      g.strokeStyle = '#6b4226'; g.lineWidth = 3 * s; g.lineCap = 'round'; g.beginPath(); g.moveTo(d.x - 9 * s, d.y - 1); g.lineTo(d.x + 7 * s, d.y - 6 * s); g.moveTo(d.x + 9 * s, d.y - 1); g.lineTo(d.x - 7 * s, d.y - 6 * s); g.stroke();
      const fl = Math.sin(t * 9 + d.seed * 30) * 0.5 + 0.5;
      glow(g, d.x, d.y - 10 * s, 40 * s, '#ff9a3c', 0.32 + fl * 0.12);
      for (const [dx, hh, col] of [[-3, 18, '#ff6a2c'], [3, 15, '#ff8f3c'], [0, 22 + fl * 4, '#ffd23f']]) {
        const sw = Math.sin(t * 7 + dx + d.seed * 9) * 1.5;
        g.fillStyle = col; g.beginPath(); g.moveTo(d.x + (dx - 5) * s, d.y - 4 * s); g.quadraticCurveTo(d.x + (dx - 4) * s + sw, d.y - hh * 0.6 * s, d.x + dx * s + sw * 1.5, d.y - hh * s); g.quadraticCurveTo(d.x + (dx + 4) * s + sw, d.y - hh * 0.6 * s, d.x + (dx + 5) * s, d.y - 4 * s); g.closePath(); g.fill();
      }
      break;
    }
    case 'drum': {
      const w = 22 * s, h = 18 * s;
      g.fillStyle = '#9a5a2e'; roundRect(g, d.x - w / 2, d.y - h, w, h + 1, 3); g.fill();
      g.fillStyle = '#d8432f'; zigzag(g, d.x - w / 2, d.x + w / 2, d.y - h * 0.6, 4 * s, 6); g.fill();
      g.fillStyle = '#f6e6c8'; g.beginPath(); g.ellipse(d.x, d.y - h, w / 2, 3.4 * s, 0, 0, 7); g.fill();
      g.strokeStyle = '#5a3424'; g.lineWidth = 1; g.beginPath(); g.ellipse(d.x, d.y - h, w / 2, 3.4 * s, 0, 0, 7); g.stroke();
      break;
    }
    case 'spear': {
      const h = 42 * s, lean = (d.seed - 0.5) * 0.5;
      g.save(); g.translate(d.x, d.y + 2); g.rotate(lean);
      g.strokeStyle = '#a0703a'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -h); g.stroke();
      g.fillStyle = '#d8432f'; g.fillRect(-1.6, -h * 0.72, 3.2, 4);
      g.fillStyle = '#f4efe6'; g.beginPath(); g.moveTo(-4 * s, -h); g.lineTo(0, -h - 12 * s); g.lineTo(4 * s, -h); g.closePath(); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.ellipse(3, -h * 0.66, 1.6, 4, 0.6, 0, 7); g.fill();
      g.restore();
      break;
    }
    case 'gate': { // a tribal gate at each camp: two totem posts and a big GAMOTA banner between them
      const h = 96 * s, w = 120 * s, wv = (k) => Math.sin(t * 2.6 + d.seed * 9 + k) * 2.5;
      for (const e of [-1, 1]) {
        const px = d.x + e * w / 2;
        g.fillStyle = '#8a5a34'; g.fillRect(px - 5 * s, d.y - h, 10 * s, h + 2);
        for (let k = 0; k < 4; k++) { g.fillStyle = ['#c7442e', '#f2d9a8', '#2f78c4', '#3a8f5a'][k]; g.fillRect(px - 6 * s, d.y - h + k * 14 * s, 12 * s, 9 * s); }
        g.fillStyle = '#fff'; g.beginPath(); g.ellipse(px + e * 6 * s, d.y - h - 4 * s, 3 * s, 9 * s, e * 0.5, 0, 7); g.fill();
        g.fillStyle = '#2f7fd8'; g.beginPath(); g.ellipse(px, d.y - h - 6 * s, 4 * s, 10 * s, 0, 0, 7); g.fill();
      }
      const top = d.y - h + 8 * s, bh = 34 * s;
      g.fillStyle = '#c7442e'; g.beginPath(); g.moveTo(d.x - w / 2 + 5 * s, top); g.quadraticCurveTo(d.x, top + 6 * s + wv(0), d.x + w / 2 - 5 * s, top);
      g.lineTo(d.x + w / 2 - 5 * s, top + bh); g.quadraticCurveTo(d.x, top + bh + 8 * s + wv(1), d.x - w / 2 + 5 * s, top + bh); g.closePath(); g.fill();
      g.fillStyle = '#fff0d6'; zigzag(g, d.x - w / 2 + 6 * s, d.x + w / 2 - 6 * s, top + bh - 6 * s, 5 * s, 14); g.fill();
      if (!drawLogo(g, d.x, top + 4 * s, bh - 12 * s, '#fff6e6', 'center')) {
        g.font = `800 ${Math.round(20 * s)}px "Baloo 2", sans-serif`; g.textAlign = 'center'; g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = '#4f2414';
        const ty = top + bh * 0.62 + wv(0) * 0.6; g.strokeText('GAMOTA', d.x, ty); g.fillStyle = '#fff3d6'; g.fillText('GAMOTA', d.x, ty);
      }
      break;
    }
    case 'flag': { // Gamota pennant waving in the wind
      const h = 60 * s, wv = (k) => Math.sin(t * 4 + d.seed * 9 + k * 1.6) * 3;
      g.strokeStyle = '#6b4226'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(d.x, d.y + 2); g.lineTo(d.x, d.y - h); g.stroke();
      g.fillStyle = d.seed > 0.5 ? '#d8432f' : '#2f78c4';
      g.beginPath(); g.moveTo(d.x, d.y - h); g.quadraticCurveTo(d.x + 24 * s, d.y - h + wv(0), d.x + 46 * s, d.y - h + 4 + wv(1)); g.lineTo(d.x + 40 * s, d.y - h + 11 * s + wv(1)); g.lineTo(d.x + 46 * s, d.y - h + 18 * s + wv(2)); g.quadraticCurveTo(d.x + 24 * s, d.y - h + 20 * s + wv(1), d.x, d.y - h + 20 * s); g.closePath(); g.fill();
      if (!drawLogo(g, d.x + 3 * s, d.y - h + 3 * s + wv(1) * 0.5, 14 * s, '#ffffff')) {
        g.fillStyle = '#fff'; g.font = `800 ${Math.round(8 * s + 2)}px "Baloo 2", sans-serif`; g.textAlign = 'left'; g.fillText('GAMOTA', d.x + 4 * s, d.y - h + 13 * s + wv(1) * 0.5);
      }
      g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(d.x, d.y - h - 2, 2.6, 0, 7); g.fill();
      break;
    }
    case 'flower':
      g.strokeStyle = '#4f9a3b'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(d.x, d.y + 1); g.quadraticCurveTo(d.x, d.y - 8 * s, d.x + sway, d.y - 14 * s); g.stroke();
      g.fillStyle = d.c; for (let k = 0; k < 5; k++) { const a = k * 1.256; g.beginPath(); g.arc(d.x + sway + Math.cos(a) * 3.4 * s, d.y - 14 * s + Math.sin(a) * 3.4 * s, 2.6 * s, 0, 7); g.fill(); }
      g.fillStyle = '#ffcf3f'; g.beginPath(); g.arc(d.x + sway, d.y - 14 * s, 1.8 * s, 0, 7); g.fill();
      break;
    case 'shroom':
      g.fillStyle = '#fff3e0'; g.fillRect(d.x - 2 * s, d.y - 8 * s, 4 * s, 8 * s);
      g.fillStyle = d.c; g.beginPath(); g.arc(d.x, d.y - 8 * s, 7 * s, Math.PI, 0); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(d.x - 2.5 * s, d.y - 11 * s, 1.4 * s, 0, 7); g.arc(d.x + 3 * s, d.y - 10 * s, 1.1 * s, 0, 7); g.fill();
      break;
    case 'pebble':
      g.fillStyle = '#9b96a8'; g.beginPath(); g.ellipse(d.x, d.y - 2, 5 * s, 3.4 * s, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(d.x - 1.5 * s, d.y - 3.4 * s, 2 * s, 1 * s, 0, 0, 7); g.fill();
      break;
    case 'bush':
      g.fillStyle = '#4f9a3b'; for (let k = -1; k <= 1; k++) { g.beginPath(); g.arc(d.x + k * 9 * s, d.y - 7 * s - (k === 0 ? 4 : 0), 10 * s, 0, 7); g.fill(); }
      g.fillStyle = '#6cc251'; g.beginPath(); g.arc(d.x - 4 * s, d.y - 12 * s, 6 * s, 0, 7); g.fill();
      if (d.seed > 0.6) { g.fillStyle = '#ff6b8a'; for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(d.x + (k - 1) * 8 * s, d.y - 9 * s + (k % 2) * 4, 2 * s, 0, 7); g.fill(); } }
      break;
    case 'tree': {
      const h = 90 * s, cy = d.y - h;
      g.fillStyle = '#8b5a35'; g.beginPath(); g.moveTo(d.x - 6 * s, d.y + 2); g.quadraticCurveTo(d.x - 3 * s, d.y - h * 0.5, d.x - 2 * s, cy + 10); g.lineTo(d.x + 3 * s, cy + 10); g.quadraticCurveTo(d.x + 4 * s, d.y - h * 0.5, d.x + 7 * s, d.y + 2); g.fill();
      const pink = d.hue > 0.7, base = pink ? '#f4a3c2' : '#4f9a3b', mid = pink ? '#f8bfd6' : '#66b84d', top = pink ? '#ffd9e8' : '#8fd36a';
      const sw = Math.sin(t * 0.9 + d.seed * 6) * 2;
      g.fillStyle = base; for (const [dx, dy, r] of [[-20, 6, 26], [20, 6, 26], [0, -14, 30]]) { g.beginPath(); g.arc(d.x + dx * s + sw, cy + dy * s, r * s, 0, 7); g.fill(); }
      g.fillStyle = mid; for (const [dx, dy, r] of [[-12, -2, 20], [14, -6, 18], [0, -20, 20]]) { g.beginPath(); g.arc(d.x + dx * s + sw, cy + dy * s, r * s, 0, 7); g.fill(); }
      g.fillStyle = top; g.beginPath(); g.arc(d.x - 6 * s + sw, cy - 22 * s, 10 * s, 0, 7); g.fill();
      if (!pink && d.seed > 0.5) { g.fillStyle = '#ff6b6b'; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(d.x + (k - 1.5) * 12 * s + sw, cy + ((k * 7) % 11 - 6) * s, 3 * s, 0, 7); g.fill(); } }
      break;
    }
  }
}

/* ---------- heroes ---------- */
function drawHero(g, key, team, x, y, face, ang, t, o = {}) {
  const D = HEROES[key], big = key === 'thachgiap' ? 1.12 : 1;
  const walk = o.walking ? Math.sin(t * 14) : 0;
  const bob = o.walking ? Math.abs(walk) * 2.4 : Math.sin(t * 2.4 + x * 0.01) * 1.1;
  g.save(); g.translate(x, y); g.scale(big * (o.scale || 1), big * (o.scale || 1));
  // shadow + team ring
  if (!o.noShadow) {
    g.fillStyle = 'rgba(30,20,40,0.22)'; g.beginPath(); g.ellipse(0, 0, 18, 5, 0, 0, 7); g.fill();
    if (team >= 0) { g.strokeStyle = TEAM_COL[team]; g.lineWidth = 2.5; g.beginPath(); g.ellipse(0, 0, 21, 6.5, 0, 0, 7); g.stroke(); }
  }
  if (o.tribe) { drawTribeBody(g, key, D, team, face, ang, t, o, walk, bob); g.restore(); return; }
  // tail (cat)
  if (D.ult === 'phoenix') {
    g.strokeStyle = D.color; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath();
    g.moveTo(-face * 8, -12 - bob); g.quadraticCurveTo(-face * 22, -14 + Math.sin(t * 3) * 6, -face * 20, -30 + Math.sin(t * 3) * 4); g.stroke();
    g.strokeStyle = D.light; g.lineWidth = 3; g.beginPath(); g.moveTo(-face * 20, -26 + Math.sin(t * 3) * 4); g.lineTo(-face * 20, -31 + Math.sin(t * 3) * 4); g.stroke();
  }
  // feet
  g.fillStyle = D.dark;
  g.beginPath(); g.ellipse(-6 + walk * 3, -3, 6, 4, 0, 0, 7); g.fill();
  g.beginPath(); g.ellipse(6 - walk * 3, -3, 6, 4, 0, 0, 7); g.fill();
  // body
  const by = -14 - bob;
  g.fillStyle = D.color; g.strokeStyle = D.dark; g.lineWidth = 2;
  g.beginPath(); g.ellipse(0, by, 12, 11, 0, 0, 7); g.fill(); g.stroke();
  g.fillStyle = D.light; g.beginPath(); g.ellipse(0, by + 3, 7, 6, 0, 0, 7); g.fill();
  // scarf in team colour
  if (team >= 0) {
    g.fillStyle = TEAM_COL[team]; g.beginPath(); g.ellipse(0, by - 8, 11, 4, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(-face * 6, by - 7); g.quadraticCurveTo(-face * 16, by - 4 + Math.sin(t * 5) * 2, -face * 18, by + 2); g.lineTo(-face * 12, by - 3); g.closePath(); g.fill();
  }
  // weapon behind/in front of head depending on angle
  const a = ang * Math.PI / 180;
  drawWeapon(g, key, D, face, a, by, t, o);
  // head
  const hy = by - 20;
  if (key === 'thachgiap') {
    g.fillStyle = D.color; g.strokeStyle = D.dark; g.lineWidth = 2;
    g.beginPath(); for (let i = 0; i < 9; i++) { const aa = i / 9 * Math.PI * 2, rr = 17 + ((i * 37) % 5) - 2; i ? g.lineTo(Math.cos(aa) * rr, hy + Math.sin(aa) * rr * 0.92) : g.moveTo(Math.cos(aa) * rr, hy + Math.sin(aa) * rr * 0.92); } g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(80,70,60,0.5)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-8, hy - 12); g.lineTo(-3, hy - 5); g.lineTo(-6, hy); g.stroke();
    g.fillStyle = '#7fcf6a'; g.beginPath(); g.ellipse(2, hy - 15, 11, 4, 0.1, 0, 7); g.fill();
  } else {
    g.fillStyle = D.light; g.strokeStyle = D.dark; g.lineWidth = 2;
    g.beginPath(); g.arc(0, hy, 16, 0, 7); g.fill(); g.stroke();
  }
  drawHair(g, key, D, face, hy, t);
  drawFace(g, key, D, face, hy, t, o);
  drawHat(g, key, D, face, hy, t);
  if (o.stunned) for (let k = 0; k < 3; k++) { const aa = t * 5 + k * 2.09; g.fillStyle = k % 2 ? '#fff3a0' : '#ffd43b'; starPath(g, Math.cos(aa) * 16, hy - 22 + Math.sin(aa) * 4, 5, 2, 5); g.fill(); }
  // status overlays
  if (o.frozen) {
    g.fillStyle = 'rgba(170,230,255,0.45)'; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-20, 0); g.lineTo(-22, -40); g.lineTo(-10, -58); g.lineTo(12, -60); g.lineTo(22, -42); g.lineTo(20, 0); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.moveTo(-12, -48); g.lineTo(-4, -30); g.stroke();
  }
  if (o.hurt) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,80,80,0.35)'; g.fillRect(-30, -70, 60, 72); g.globalCompositeOperation = 'source-over'; }
  g.restore();
}
/* ---------- Thổ Thần skin: the Gamota tribe (feather crest, headband, face paint, tribal necklace and loincloth) ---------- */
const TR = { skin: '#f8dcc4', skinDk: '#e9b998', line: '#5a3424', cloth: '#dca35c', clothDk: '#a8692e', red: '#d8432f', cream: '#fff0d6', crest: '#2f7fd8', crestHi: '#8cc8ff' };
function zigzag(g, x0, x1, y, h, n) { g.beginPath(); g.moveTo(x0, y); for (let i = 0; i <= n; i++) g.lineTo(x0 + (x1 - x0) * i / n, y + (i % 2 ? h : 0)); g.lineTo(x1, y); g.closePath(); }
function drawTribeBody(g, key, D, team, face, ang, t, o, walk, bob) {
  const girl = key === 'moclan', band = team >= 0 ? TEAM_COL[team] : TR.red;
  const by = -14 - bob, hy = by - 20, a = ang * Math.PI / 180;
  g.lineJoin = 'round';
  // feet with feathered ankle bands
  for (const s of [-1, 1]) {
    const fx = s * 6 + (s < 0 ? walk * 3 : -walk * 3);
    g.fillStyle = TR.skin; g.strokeStyle = TR.line; g.lineWidth = 1.6; g.beginPath(); g.ellipse(fx, -3, 6, 4, 0, 0, 7); g.fill(); g.stroke();
    g.fillStyle = TR.clothDk; g.fillRect(fx - 4, -8, 8, 2.4);
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(fx - s * 5, -9, 1.6, 3.4, s * 0.6, 0, 7); g.fill();
  }
  // shield behind the body when facing away (Thạch Giáp)
  const shield = () => {
    g.save(); g.translate(face * 9, by + 2);
    g.fillStyle = '#fff6e4'; g.strokeStyle = '#8a5a2c'; g.lineWidth = 2.6; g.beginPath(); g.ellipse(0, 0, 11, 14, 0, 0, 7); g.fill(); g.stroke();
    g.strokeStyle = '#e0a640'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(-7, -6); g.quadraticCurveTo(0, -2, 6, -9); g.moveTo(-8, 2); g.quadraticCurveTo(0, 6, 7, -1); g.moveTo(-5, 9); g.quadraticCurveTo(1, 9, 5, 6); g.stroke();
    g.restore();
  };
  // body: bare chest + loincloth (girls wear a top and a skirt)
  g.fillStyle = TR.skin; g.strokeStyle = TR.line; g.lineWidth = 2;
  g.beginPath(); g.ellipse(0, by, 12, 11, 0, 0, 7); g.fill(); g.stroke();
  g.save(); g.beginPath(); g.ellipse(0, by, 11, 10, 0, 0, 7); g.clip();
  if (girl) { g.fillStyle = '#e8892e'; g.fillRect(-12, by - 6, 24, 6); }
  g.fillStyle = girl ? '#e8892e' : TR.cloth; g.fillRect(-12, by + 2, 24, 10);
  g.fillStyle = TR.clothDk; g.fillRect(-12, by + 1, 24, 2.2);
  g.fillStyle = TR.red; zigzag(g, -12, 12, by + 8, 3, 8); g.fill();
  g.restore();
  // necklace of red/cream triangles
  for (let k = -2; k <= 2; k++) {
    const nx = k * 4.2, ny = by - 8 + Math.abs(k) * -0.6;
    g.fillStyle = k % 2 ? TR.cream : TR.red; g.strokeStyle = TR.line; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(nx - 2.4, ny); g.lineTo(nx + 2.4, ny); g.lineTo(nx, ny + 4); g.closePath(); g.fill(); g.stroke();
  }
  if (key === 'thachgiap' && face < 0) shield();
  drawTribeWeapon(g, key, face, a, by, t, o);
  if (key === 'thachgiap' && face > 0) shield();
  // head
  if (girl) { // long black hair behind the head
    g.fillStyle = '#2a2230'; g.beginPath(); g.moveTo(-17, hy - 2); g.quadraticCurveTo(-20, hy + 16, -14, hy + 22); g.lineTo(14, hy + 22); g.quadraticCurveTo(20, hy + 16, 17, hy - 2); g.closePath(); g.fill();
  }
  g.fillStyle = TR.skin; g.strokeStyle = TR.line; g.lineWidth = 2;
  g.beginPath(); g.arc(0, hy, 16, 0, 7); g.fill(); g.stroke();
  if (girl) { g.fillStyle = '#2a2230'; g.beginPath(); g.arc(0, hy - 3, 16.2, Math.PI * 1.05, Math.PI * 1.95); g.closePath(); g.fill(); }
  // feather crest (the blue mohawk of the art), smaller for the girl
  // three broad plumes, the middle one tallest (as in the event art)
  const cn = 3, cw = girl ? 7 : 10, fw = girl ? 4.5 : 6.5, sway = Math.sin(t * 3 + key.length) * 1.2;
  for (const k of [0, 2, 1]) {
    const u = k / (cn - 1) - 0.5, bx = u * cw * 2, len = (girl ? 14 : 22) - Math.abs(u) * 8;
    const tipx = bx + u * 12 + sway, tipy = hy - 12 - len;
    g.fillStyle = TR.crest; g.strokeStyle = '#1d4f8f'; g.lineWidth = 1.3;
    g.beginPath(); g.moveTo(bx - fw, hy - 10); g.quadraticCurveTo(bx - fw - 2 + u * 5, hy - 15 - len * 0.55, tipx, tipy); g.quadraticCurveTo(bx + fw + 2 + u * 5, hy - 15 - len * 0.55, bx + fw, hy - 10); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = TR.crestHi; g.lineWidth = 1.2; g.beginPath(); g.moveTo(bx, hy - 11); g.lineTo((bx + tipx) / 2, (hy - 11 + tipy) / 2); g.stroke();
  }
  // white side feather
  g.fillStyle = '#fff'; g.strokeStyle = '#c9c0b4'; g.lineWidth = 1; g.beginPath(); g.ellipse(-face * 15, hy - 8, 2.6, 7, -face * 0.9, 0, 7); g.fill(); g.stroke();
  // headband in the team colour with a medallion
  g.fillStyle = band; g.strokeStyle = TR.line; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(-16, hy - 7); g.quadraticCurveTo(0, hy - 13, 16, hy - 7); g.lineTo(16, hy - 2); g.quadraticCurveTo(0, hy - 8, -16, hy - 2); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#2b2238'; g.beginPath(); g.arc(face * 6, hy - 6.5, 3.4, 0, 7); g.fill();
  g.fillStyle = '#3fb5e0'; g.beginPath(); g.arc(face * 6, hy - 6.5, 2, 0, 7); g.fill();
  drawFace(g, key === 'thachgiap' ? 'bombi' : key, D, face, hy + 1, t, o);
  // face paint: two orange strokes on each cheek
  g.strokeStyle = 'rgba(232,96,40,0.9)'; g.lineWidth = 1.3; g.lineCap = 'round';
  for (const s of [-1, 1]) for (let k = 0; k < 2; k++) { const cx = face * 4 + s * 11, cy = hy + 3 + k * 3; g.beginPath(); g.moveTo(cx - 2.5, cy); g.lineTo(cx + 2.5, cy - 1); g.stroke(); }
  if (o.stunned) for (let k = 0; k < 3; k++) { const aa = t * 5 + k * 2.09; g.fillStyle = k % 2 ? '#fff3a0' : '#ffd43b'; starPath(g, Math.cos(aa) * 16, hy - 30 + Math.sin(aa) * 4, 5, 2, 5); g.fill(); }
  if (o.frozen) {
    g.fillStyle = 'rgba(170,230,255,0.45)'; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-20, 0); g.lineTo(-22, -44); g.lineTo(-10, -66); g.lineTo(12, -68); g.lineTo(22, -46); g.lineTo(20, 0); g.closePath(); g.fill(); g.stroke();
  }
  if (o.hurt) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,80,80,0.35)'; g.fillRect(-30, -80, 60, 82); g.globalCompositeOperation = 'source-over'; }
}
function drawTribeWeapon(g, key, face, a, by, t, o) {
  g.save(); g.translate(face * 4, by - 2); g.scale(face, 1); g.rotate(-a);
  g.translate(-(o.recoil || 0) * 6, 0);
  const shaft = (x0, x1, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, 0); g.lineTo(x1, 0); g.stroke(); };
  const head = (x, len, w, col) => { g.fillStyle = col; g.strokeStyle = TR.line; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, -w); g.lineTo(x + len, 0); g.lineTo(x, w); g.lineTo(x + 2, 0); g.closePath(); g.fill(); g.stroke(); };
  switch (key) {
    case 'bombi': // the chief's great spear
      shaft(-12, 36, 3.6, '#b07a3e'); g.fillStyle = TR.red; g.fillRect(24, -2.6, 4, 5.2); g.fillStyle = TR.cream; g.fillRect(28, -2.6, 2, 5.2);
      head(34, 16, 6, '#fffaf0');
      break;
    case 'thachgiap': // short spear (the shield is drawn with the body)
      shaft(-6, 24, 3.4, '#9a6a36'); head(23, 10, 4.5, '#e8e4dc');
      break;
    case 'moclan': { // bone staff with a blooming tip
      shaft(-4, 26, 3, '#e9dcc0');
      g.fillStyle = '#7cc576'; g.beginPath(); g.ellipse(24, -4, 5, 2.2, -0.6, 0, 7); g.ellipse(24, 4, 5, 2.2, 0.6, 0, 7); g.fill();
      g.fillStyle = '#ff8fbf'; for (let k = 0; k < 5; k++) { const aa = k * 1.256 + t; g.beginPath(); g.arc(29 + Math.cos(aa) * 3.4, Math.sin(aa) * 3.4, 2.4, 0, 7); g.fill(); }
      g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(29, 0, 2, 0, 7); g.fill();
      break;
    }
    case 'loivu': { // war horn: narrow at the mouth, wide bell forward, crackling with lightning
      g.fillStyle = '#f1e2c0'; g.strokeStyle = TR.line; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(-4, -2); g.quadraticCurveTo(10, -8, 26, -9); g.lineTo(27, 9); g.quadraticCurveTo(10, 6, -4, 2); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#8a5a2c'; for (const x of [6, 14]) g.fillRect(x, -6.5 + x * 0.05, 2.4, 12 - x * 0.1);
      g.fillStyle = '#5ab8ff'; g.beginPath(); g.ellipse(26.5, 0, 3, 9, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,240,140,0.95)'; g.lineWidth = 1.3; const j = Math.sin(t * 13) * 2;
      g.beginPath(); g.moveTo(29, -6); g.lineTo(34, -2 + j); g.lineTo(31, 0); g.lineTo(37, 5 - j); g.stroke();
      break;
    }
    case 'hoamieu': // hunter's spear with a burning tip
      shaft(-8, 30, 2.6, '#9a6a36'); head(29, 11, 4, '#e8e4dc');
      g.fillStyle = `rgba(255,${140 + Math.sin(t * 12) * 50},60,0.9)`; g.beginPath(); g.arc(41, 0, 3.4 + Math.sin(t * 15), 0, 7); g.fill();
      break;
  }
  g.fillStyle = TR.skin; g.strokeStyle = TR.line; g.lineWidth = 1.5; g.beginPath(); g.arc(4, 4, 4, 0, 7); g.fill(); g.stroke();
  g.restore();
}
/* the light pillar behind the hero whose turn it is, and the cracks glowing on the ground under them */
function drawTribeAura(g, key, x, y, t) {
  const col = (TRIBE[key] || TRIBE.bombi).aura;
  g.save(); g.globalCompositeOperation = 'lighter';
  const pulse = 0.75 + 0.25 * Math.sin(t * 3);
  const gr = g.createLinearGradient(0, y - 170, 0, y);
  gr.addColorStop(0, hexA(col, 0)); gr.addColorStop(0.6, hexA(col, 0.22 * pulse)); gr.addColorStop(1, hexA(col, 0.5 * pulse));
  g.fillStyle = gr; g.beginPath(); g.moveTo(x - 30, y); g.lineTo(x - 18, y - 170); g.lineTo(x + 18, y - 170); g.lineTo(x + 30, y); g.closePath(); g.fill();
  g.strokeStyle = hexA(col, 0.85 * pulse); g.lineWidth = 1.6; g.lineCap = 'round';
  for (let k = 0; k < 6; k++) {
    const ang = k / 6 * Math.PI + 0.15, len = 22 + (k * 37 % 13);
    g.beginPath(); g.moveTo(x, y + 1);
    g.lineTo(x + Math.cos(ang) * len * 0.5, y + 1 + (k % 2 ? 2 : -1)); g.lineTo(x + Math.cos(ang) * len, y + 2 + (k % 3) - 1); g.stroke();
  }
  g.restore();
}
/* a blessing pillar: a beam of coloured light rising from the ground */
function drawPillar(g, p, t) {
  const B = BLESS[p.type] || BLESS[0], h = 220, x = p.x, y = p.y, w = 22 + Math.sin(t * 2.4 + p.id) * 3;
  g.save(); g.globalCompositeOperation = 'lighter';
  const gr = g.createLinearGradient(0, y - h, 0, y);
  gr.addColorStop(0, hexA(B.col, 0)); gr.addColorStop(0.5, hexA(B.col, 0.32)); gr.addColorStop(1, hexA(B.col, 0.75));
  g.fillStyle = gr; g.fillRect(x - w / 2, y - h, w, h);
  g.fillStyle = hexA('#ffffff', 0.35); g.fillRect(x - 3, y - h * 0.8, 6, h * 0.8);
  glow(g, x, y - 6, 34, B.col, 0.55);
  for (let k = 0; k < 5; k++) { const ph = (t * 0.6 + k / 5 + p.id * 0.13) % 1; g.fillStyle = hexA('#ffffff', 0.8 * (1 - ph)); g.beginPath(); g.arc(x + Math.sin(ph * 9 + k) * w * 0.35, y - ph * h * 0.8, 2, 0, 7); g.fill(); }
  g.restore();
  g.fillStyle = 'rgba(255,255,255,0.92)'; roundRect(g, x - 34, y - 46, 68, 17, 8); g.fill();
  g.fillStyle = B.col; g.font = '800 11px "Baloo 2", sans-serif'; g.textAlign = 'center'; g.fillText(B.name, x, y - 34);
}
function drawWeapon(g, key, D, face, a, by, t, o) {
  g.save(); g.translate(face * 4, by - 2); g.scale(face, 1); g.rotate(-a);
  const recoil = o.recoil || 0;
  g.translate(-recoil * 6, 0);
  switch (key) {
    case 'bombi':
      g.fillStyle = '#3a3a4a'; roundRect(g, -6, -6, 34, 12, 5); g.fill();
      g.fillStyle = D.color; g.fillRect(6, -6, 4, 12); g.fillRect(16, -6, 4, 12);
      g.fillStyle = '#26262f'; roundRect(g, 26, -8, 7, 16, 3); g.fill();
      g.fillStyle = '#ffd166'; g.beginPath(); g.arc(-4, 0, 4, 0, 7); g.fill();
      break;
    case 'thachgiap':
      g.fillStyle = '#7d7468'; roundRect(g, -6, -8, 30, 16, 6); g.fill();
      g.fillStyle = '#5f5446'; roundRect(g, 20, -10, 9, 20, 4); g.fill();
      g.fillStyle = D.accent; g.beginPath(); g.arc(8, 0, 3.5, 0, 7); g.fill();
      break;
    case 'moclan':
      g.strokeStyle = '#8b5a35'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(-4, 0); g.lineTo(26, 0); g.stroke();
      g.strokeStyle = '#a0703f'; g.lineWidth = 3; g.beginPath(); g.arc(22, 0, 12, -1.35, 1.35); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.moveTo(22 + Math.cos(-1.35) * 12, Math.sin(-1.35) * 12); g.lineTo(14 - (o.charge || 0) * 0.08, 0); g.lineTo(22 + Math.cos(1.35) * 12, Math.sin(1.35) * 12); g.stroke();
      g.fillStyle = '#7cc576'; g.beginPath(); g.ellipse(8, -5, 5, 2.4, -0.5, 0, 7); g.fill();
      g.fillStyle = D.accent; g.beginPath(); g.arc(26, 0, 3.2, 0, 7); g.fill();
      break;
    case 'loivu': {
      g.strokeStyle = '#6b4a2b'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(-6, 0); g.lineTo(24, 0); g.stroke();
      g.fillStyle = '#ffe066'; g.shadowColor = '#ffe066'; g.shadowBlur = 12; g.beginPath(); g.arc(28, 0, 6 + Math.sin(t * 9) * 0.8, 0, 7); g.fill(); g.shadowBlur = 0;
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(24, -6); g.lineTo(28, -1); g.lineTo(25, 1); g.lineTo(30, 7); g.stroke();
      break;
    }
    case 'hoamieu':
      g.fillStyle = '#b3263c'; roundRect(g, -8, -7, 32, 14, 6); g.fill();
      g.fillStyle = D.accent; g.fillRect(2, -7, 4, 14);
      g.fillStyle = '#3a2a2a'; roundRect(g, 22, -9, 8, 18, 4); g.fill();
      g.fillStyle = `rgba(255,${150 + Math.sin(t * 12) * 50},60,0.9)`; g.beginPath(); g.arc(31, 0, 3.5 + Math.sin(t * 15) * 1, 0, 7); g.fill();
      break;
  }
  // hand
  g.fillStyle = D.light; g.strokeStyle = D.dark; g.lineWidth = 1.5; g.beginPath(); g.arc(4, 4, 4, 0, 7); g.fill(); g.stroke();
  g.restore();
}
function drawHair(g, key, D, face, hy, t) {
  switch (key) {
    case 'bombi':
      g.fillStyle = '#5a3a24'; g.beginPath(); g.arc(0, hy - 4, 16, Math.PI * 1.05, Math.PI * 1.95); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-6, hy - 18); g.quadraticCurveTo(2, hy - 26, 6, hy - 18); g.fill();
      break;
    case 'moclan':
      g.fillStyle = '#3f7f3f'; g.beginPath(); g.arc(0, hy - 2, 18, Math.PI * 0.85, Math.PI * 2.15); g.quadraticCurveTo(14, hy + 16, 10, hy + 18); g.lineTo(-10, hy + 18); g.quadraticCurveTo(-14, hy + 16, -17, hy + 6); g.fill();
      g.fillStyle = D.light; g.beginPath(); g.arc(0, hy + 2, 13, 0, 7); g.fill();
      break;
    case 'loivu':
      g.fillStyle = '#2a4fb0'; g.beginPath(); g.moveTo(-16, hy - 2);
      for (let i = 0; i <= 6; i++) { const xx = -16 + i * 32 / 6; g.lineTo(xx, hy - 12 - (i % 2 ? 10 : 2)); }
      g.lineTo(16, hy - 2); g.closePath(); g.fill();
      break;
    case 'hoamieu':
      g.fillStyle = '#d93a52'; g.beginPath(); g.arc(0, hy - 3, 16.5, Math.PI * 1.02, Math.PI * 1.98); g.closePath(); g.fill();
      for (const s of [-1, 1]) {
        g.fillStyle = D.color; g.beginPath(); g.moveTo(s * 6, hy - 13); g.lineTo(s * 15, hy - 27); g.lineTo(s * 16, hy - 9); g.closePath(); g.fill();
        g.fillStyle = '#ffb3c1'; g.beginPath(); g.moveTo(s * 9, hy - 13); g.lineTo(s * 14, hy - 22); g.lineTo(s * 14.5, hy - 12); g.closePath(); g.fill();
      }
      break;
  }
}
function drawFace(g, key, D, face, hy, t, o) {
  const fx = face * 4;
  const blink = Math.sin(t * 1.3 + hy) > 0.985;
  const stone = key === 'thachgiap';
  for (const s of [-1, 1]) {
    const ex = fx + s * 6, ey = hy + 1;
    if (stone) { g.fillStyle = D.accent; g.shadowColor = D.accent; g.shadowBlur = 8; g.beginPath(); g.ellipse(ex, ey, 3, blink ? 0.6 : 3.4, 0, 0, 7); g.fill(); g.shadowBlur = 0; continue; }
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(ex, ey, 4.2, blink ? 0.8 : 5, 0, 0, 7); g.fill();
    if (!blink) {
      g.fillStyle = o.dead ? '#888' : '#2b2238'; g.beginPath(); g.ellipse(ex + face * 1.2, ey + 0.6, 2.7, 3.4, 0, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(ex + face * 0.4 - 0.8, ey - 1.4, 1.2, 0, 7); g.fill();
    }
  }
  if (!stone) {
    g.fillStyle = 'rgba(255,120,140,0.5)'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(fx + s * 10, hy + 7, 3, 1.8, 0, 0, 7); g.fill(); }
    g.strokeStyle = '#5a3040'; g.lineWidth = 1.4; g.beginPath();
    if (o.hurt) g.arc(fx, hy + 10, 2.4, 0, 7); else if (o.charge) g.ellipse(fx, hy + 9, 2.4, 1.6, 0, 0, 7); else g.arc(fx, hy + 7.5, 3, 0.2, Math.PI - 0.2);
    g.stroke();
  }
  if (key === 'bombi') { g.fillStyle = 'rgba(180,100,60,0.5)'; for (const [dx, dy] of [[-9, 5], [-7, 7], [9, 5], [11, 7]]) { g.beginPath(); g.arc(fx + dx, hy + dy, 0.8, 0, 7); g.fill(); } }
}
function drawHat(g, key, D, face, hy, t) {
  switch (key) {
    case 'bombi':
      g.fillStyle = '#6b4a2b'; g.fillRect(-16, hy - 10, 32, 5);
      for (const s of [-1, 1]) { g.fillStyle = '#c9d6e3'; g.strokeStyle = '#5a6672'; g.lineWidth = 1.5; g.beginPath(); g.arc(s * 7, hy - 8, 5, 0, 7); g.fill(); g.stroke(); g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(s * 7 - 1.5, hy - 9.5, 1.5, 0, 7); g.fill(); }
      break;
    case 'moclan':
      for (let k = 0; k < 5; k++) { const a = k * 1.256 + 0.3; g.fillStyle = k % 2 ? '#ffd6e8' : D.accent; g.beginPath(); g.arc(face * 10 + Math.cos(a) * 5, hy - 14 + Math.sin(a) * 5, 4, 0, 7); g.fill(); }
      g.fillStyle = '#ffcf3f'; g.beginPath(); g.arc(face * 10, hy - 14, 2.6, 0, 7); g.fill();
      g.fillStyle = '#7cc576'; g.beginPath(); g.ellipse(-face * 6, hy - 18, 7, 3, -face * 0.6, 0, 7); g.fill();
      break;
    case 'loivu':
      g.fillStyle = '#f2f6ff'; for (const [dx, dy, r] of [[-9, -16, 8], [0, -20, 10], [9, -16, 8], [4, -12, 7]]) { g.beginPath(); g.arc(dx, hy + dy, r, 0, 7); g.fill(); }
      g.fillStyle = '#ffd43b'; g.beginPath(); g.moveTo(2, hy - 24); g.lineTo(-3, hy - 16); g.lineTo(1, hy - 16); g.lineTo(-2, hy - 9); g.lineTo(5, hy - 18); g.lineTo(1, hy - 18); g.closePath(); g.fill();
      break;
    case 'hoamieu':
      g.fillStyle = D.accent; g.beginPath(); g.arc(face * 9, hy - 12, 3, 0, 7); g.fill();
      break;
    case 'thachgiap':
      g.fillStyle = 'rgba(102,217,168,0.9)'; g.beginPath(); g.moveTo(-2, hy - 17); g.lineTo(2, hy - 28); g.lineTo(6, hy - 17); g.closePath(); g.fill();
      break;
  }
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/* ---------- projectiles ---------- */
const TRAIL = {
  cannon: { type: 'smoke', col: 'rgba(110,104,118,', rate: 45, size: 5 },
  barrage: { type: 'smoke', col: 'rgba(110,104,118,', rate: 45, size: 5 },
  cluster: { type: 'spark', col: '#ffd166', rate: 60, size: 2.5 },
  drill: { type: 'spark', col: '#ff9a3c', rate: 70, size: 2.2 },
  hammer: { type: 'smoke', col: 'rgba(217,199,163,', rate: 35, size: 4 },
  bouncer: { type: 'smoke', col: 'rgba(185,164,138,', rate: 30, size: 4 },
  mound: { type: 'chunk', col: '#c98e57', rate: 22, size: 3 },
  gravity: { type: 'swirl', col: '#b9a0ff', rate: 55, size: 3 },
  heal: { type: 'leaf', col: '#8fe38f', rate: 28, size: 4 },
  water: { type: 'bubble', col: '#cdeeff', rate: 32, size: 3 },
  portal: { type: 'star', col: '#ffc2e6', rate: 45, size: 3.2 },
  bolt: { type: 'spark', col: '#fff3a0', rate: 90, size: 2.2 },
  ice: { type: 'frost', col: '#e6f8ff', rate: 50, size: 3 },
  fire: { type: 'ember', col: '#ff8a3c', rate: 85, size: 4.2 },
  sticky: { type: 'spark', col: '#ff6b84', rate: 40, size: 2 },
  marker: { type: 'spark', col: '#ffadc5', rate: 35, size: 2 },
  phoenix: { type: 'ember', col: '#ffb347', rate: 140, size: 5.5 },
  fly: { type: 'star', col: '#ffffff', rate: 40, size: 3 },
};
function projKey(p) { return p.kind === 'phoenix' ? 'phoenix' : p.key; }
function emitTrails(projs, dt) {
  for (const p of projs) {
    const c = TRAIL[projKey(p)] || TRAIL.cannon;
    p._acc = (p._acc || 0) + c.rate * dt;
    while (p._acc >= 1) {
      p._acc--;
      const back = Math.atan2(-p.vy, -p.vx) + rnd(-0.35, 0.35), s = rnd(10, 60);
      const o = { type: c.type, x: p.x + rnd(-3, 3), y: p.y + rnd(-3, 3), vx: Math.cos(back) * s, vy: Math.sin(back) * s, life: rnd(0.35, 0.8), r: c.size * rnd(0.7, 1.3), col: c.col };
      if (c.type === 'smoke') { o.vy -= 20; o.life = rnd(0.6, 1.1); }
      if (c.type === 'ember') { o.vy -= 40; o.g = -60; }
      if (c.type === 'chunk') { o.g = 600; o.rot = Math.random() * 6; }
      if (c.type === 'leaf' || c.type === 'star' || c.type === 'frost') o.rot = Math.random() * 6;
      addP(o);
    }
  }
}
/* soft glow: one pre-rendered sprite per colour, drawn scaled (a new radial gradient per call was costly) */
const GLOWS = {};
function glowSprite(col) {
  let c = GLOWS[col]; if (c) return c;
  c = GLOWS[col] = document.createElement('canvas'); c.width = c.height = 128;
  const k = c.getContext('2d'), gr = k.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, hexA(col, 1)); gr.addColorStop(0.45, hexA(col, 0.35)); gr.addColorStop(1, hexA(col, 0));
  k.fillStyle = gr; k.fillRect(0, 0, 128, 128);
  return c;
}
function glow(g, x, y, r, col, a = 0.6) {
  if (r <= 0 || a <= 0) return;
  const ga = g.globalAlpha; g.globalAlpha = ga * Math.min(1, a);
  g.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2);
  g.globalAlpha = ga;
}
function ball(g, x, y, r, light, dark) {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  gr.addColorStop(0, light); gr.addColorStop(1, dark);
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
}
function drawProj(g, p, t) {
  const key = projKey(p), col = key === 'phoenix' ? '#ff7a2c' : (SHELLS[key] || SHELLS.cannon).col;
  const a = Math.atan2(p.vy, p.vx), fl = Math.sin(t * 40 + (p.id || 0)) * 0.5 + 0.5;
  g.save(); g.globalCompositeOperation = 'lighter'; glow(g, p.x, p.y, key === 'phoenix' ? 46 : 26, col, 0.55); g.restore();
  g.save(); g.translate(p.x, p.y);
  switch (key) {
    case 'cannon': case 'barrage':
      g.rotate(a);
      ball(g, 0, 0, 9, '#6d6d80', '#16161d');
      g.strokeStyle = '#8c8ca0'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 9, -1.1, 1.1); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(-3, -4, 3, 1.6, -0.6, 0, 7); g.fill();
      g.strokeStyle = '#a07a4a'; g.lineWidth = 2; g.beginPath(); g.moveTo(-8, 0); g.quadraticCurveTo(-12, -3, -14, 0); g.stroke();
      g.fillStyle = '#fff3b0'; starPath(g, -15, 0, 3 + fl * 2.5, 1.2, 5); g.fill();
      break;
    case 'cluster':
      g.rotate(t * 6);
      for (let i = 0; i < 3; i++) { const aa = i * 2.094; ball(g, Math.cos(aa) * 6, Math.sin(aa) * 6, 5, '#fff1a8', '#e8a317'); }
      g.strokeStyle = '#ff6b6b'; g.lineWidth = 1.6; g.beginPath(); g.arc(0, 0, 6, 0, 7); g.stroke();
      break;
    case 'drill': {
      g.rotate(a);
      g.fillStyle = `rgba(255,${140 + fl * 80},60,0.9)`; g.beginPath(); g.moveTo(-8, -4); g.lineTo(-18 - fl * 6, 0); g.lineTo(-8, 4); g.fill();
      g.fillStyle = '#e07a2e'; roundRect(g, -9, -5.5, 8, 11, 2); g.fill();
      const gr = g.createLinearGradient(0, -6, 0, 6); gr.addColorStop(0, '#f2f5fb'); gr.addColorStop(0.5, '#9aa3b8'); gr.addColorStop(1, '#5e667a');
      g.fillStyle = gr; g.beginPath(); g.moveTo(16, 0); g.lineTo(-1, -6); g.lineTo(-1, 6); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(60,66,82,0.7)'; g.lineWidth = 1.3;
      const off = (t * 60) % 5;
      for (let k = -1 + off; k < 15; k += 5) { const hw = 6 * (1 - k / 16); g.beginPath(); g.moveTo(k, -hw); g.lineTo(k + 2.5, hw); g.stroke(); }
      break;
    }
    case 'hammer':
      g.rotate(t * 13);
      g.fillStyle = '#8b5a35'; roundRect(g, -2, -2, 22, 4, 2); g.fill();
      { const gr = g.createLinearGradient(-12, -9, -12, 9); gr.addColorStop(0, '#efe3c8'); gr.addColorStop(1, '#a8957a'); g.fillStyle = gr; }
      roundRect(g, -14, -9, 14, 18, 4); g.fill();
      g.strokeStyle = 'rgba(90,75,55,0.55)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-11, -6); g.lineTo(-7, 0); g.lineTo(-10, 5); g.stroke();
      g.fillStyle = '#7fcf6a'; g.beginPath(); g.ellipse(-7, -9, 5, 2, 0, 0, 7); g.fill();
      break;
    case 'bouncer':
      g.rotate(t * 12); g.fillStyle = '#9c8f7e'; g.beginPath(); for (let i = 0; i < 7; i++) { const aa = i / 7 * Math.PI * 2, r = 9 + (i % 2) * 2; i ? g.lineTo(Math.cos(aa) * r, Math.sin(aa) * r) : g.moveTo(Math.cos(aa) * r, Math.sin(aa) * r); } g.closePath(); g.fill();
      break;
    case 'mound':
      g.rotate(t * 5);
      ball(g, 0, 0, 10, '#e2aa70', '#8b5a35');
      g.fillStyle = '#6fc24f'; for (let k = -1; k <= 1; k++) { g.beginPath(); g.ellipse(k * 4, -9, 2.2, 5, k * 0.4, 0, 7); g.fill(); }
      g.fillStyle = '#9b96a8'; g.beginPath(); g.arc(4, 4, 2.2, 0, 7); g.arc(-4, 5, 1.6, 0, 7); g.fill();
      break;
    case 'gravity': {
      g.save(); g.rotate(t * 3); g.scale(1, 0.42);
      g.strokeStyle = 'rgba(190,160,255,0.95)'; g.lineWidth = 4; g.beginPath(); g.arc(0, 0, 17, 0, 7); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, 13, t * 5, t * 5 + 2); g.stroke();
      g.restore();
      ball(g, 0, 0, 7.5, '#5b3fa8', '#0e0620');
      g.strokeStyle = 'rgba(200,170,255,0.9)'; g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, 7.5, 0, 7); g.stroke();
      break;
    }
    case 'heal': {
      const s = 1 + Math.sin(t * 10) * 0.08; g.scale(s, s); g.rotate(a * 0.3);
      g.fillStyle = '#4fae55'; g.beginPath(); g.ellipse(-5, -6, 7, 3.2, -0.7, 0, 7); g.fill(); g.beginPath(); g.ellipse(5, -6, 7, 3.2, 0.7, 0, 7); g.fill();
      ball(g, 0, 1, 7, '#f2ffd9', '#7ee081');
      g.fillStyle = '#ffffff'; g.fillRect(-1, -3, 2, 7); g.fillRect(-3.5, -0.5, 7, 2);
      break;
    }
    case 'water': {
      const wb = Math.sin(t * 14) * 0.1; g.scale(1 + wb, 1 - wb);
      const gr = g.createRadialGradient(-3, -3, 1, 0, 0, 11); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.35, 'rgba(160,220,255,0.55)'); gr.addColorStop(1, 'rgba(70,160,230,0.8)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 11, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, 11, 0, 7); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 7, 3.6, 4.5); g.stroke();
      break;
    }
    case 'portal':
      g.rotate(t * 6);
      g.fillStyle = '#ff9fd4'; starPath(g, 0, 0, 12, 5, 5); g.fill();
      g.fillStyle = '#fff'; starPath(g, 0, 0, 6, 2.6, 5); g.fill();
      for (let k = 0; k < 3; k++) { const aa = -t * 9 + k * 2.09; g.fillStyle = '#ffd6f0'; g.beginPath(); g.arc(Math.cos(aa) * 16, Math.sin(aa) * 16, 2.2, 0, 7); g.fill(); }
      break;
    case 'bolt': {
      ball(g, 0, 0, 9, '#ffffff', '#ffd43b');
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 1.5;
      for (let k = 0; k < 4; k++) {
        const aa = Math.random() * Math.PI * 2; let r = 8; g.beginPath(); g.moveTo(Math.cos(aa) * r, Math.sin(aa) * r);
        for (let j = 0; j < 3; j++) { r += 5; const jj = aa + rnd(-0.5, 0.5); g.lineTo(Math.cos(jj) * r, Math.sin(jj) * r); }
        g.stroke();
      }
      break;
    }
    case 'ice': {
      g.rotate(a);
      const gr = g.createLinearGradient(0, -6, 0, 6); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#bdeeff'); gr.addColorStop(1, '#6cc8ec');
      g.fillStyle = gr; g.beginPath(); g.moveTo(17, 0); g.lineTo(6, -6); g.lineTo(-10, -4); g.lineTo(-14, 0); g.lineTo(-10, 4); g.lineTo(6, 6); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1; g.beginPath(); g.moveTo(17, 0); g.lineTo(-14, 0); g.moveTo(6, -6); g.lineTo(2, 0); g.lineTo(6, 6); g.stroke();
      g.fillStyle = '#fff'; starPath(g, 9, -2, 3 + fl * 2, 0.8, 4); g.fill();
      break;
    }
    case 'fire': {
      g.rotate(a);
      const L = 22 + fl * 8;
      for (const [len, wid, c] of [[L, 11, '#ff4d2e'], [L * 0.75, 8, '#ff9a3c'], [L * 0.5, 5, '#ffe36e']]) {
        g.fillStyle = c; g.beginPath(); g.moveTo(wid * 0.9, 0); g.quadraticCurveTo(wid * 0.6, -wid, -len * 0.3, -wid * 0.55); g.quadraticCurveTo(-len, -wid * 0.2 + Math.sin(t * 30) * 2, -len, 0); g.quadraticCurveTo(-len, wid * 0.2, -len * 0.3, wid * 0.55); g.quadraticCurveTo(wid * 0.6, wid, wid * 0.9, 0); g.fill();
      }
      ball(g, 2, 0, 5, '#ffffff', '#ffe36e');
      break;
    }
    case 'sticky': {
      g.rotate(t * 4);
      ball(g, 0, 0, 9, '#ff8fa3', '#c21d3f');
      g.fillStyle = '#3a2a2a'; g.fillRect(-3, -11, 6, 4);
      g.fillStyle = Math.sin(t * 16) > 0 ? '#fff066' : '#7a2030'; g.beginPath(); g.arc(0, 0, 3, 0, 7); g.fill();
      g.fillStyle = 'rgba(160,255,140,0.85)'; g.beginPath(); g.ellipse(5, 8, 2.4, 3.6, 0, 0, 7); g.fill();
      break;
    }
    case 'marker':
      g.rotate(a);
      g.fillStyle = '#ff8fab'; roundRect(g, -10, -3, 18, 6, 3); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(14, 0); g.lineTo(7, -4); g.lineTo(7, 4); g.closePath(); g.fill();
      g.fillStyle = '#c2185b'; g.beginPath(); g.moveTo(-10, 0); g.lineTo(-15, -6); g.lineTo(-7, -2); g.closePath(); g.fill(); g.beginPath(); g.moveTo(-10, 0); g.lineTo(-15, 6); g.lineTo(-7, 2); g.closePath(); g.fill();
      break;
    case 'phoenix': g.rotate(a); drawPhoenix(g, t); break;
    case 'fly': {
      // a little cloud the hero rides on; the hero itself is drawn by the hero pass
      g.translate(0, 26);
      g.fillStyle = 'rgba(255,255,255,0.95)';
      for (const [dx, dy, r] of [[-16, 2, 10], [-5, -3, 13], [8, -1, 12], [18, 3, 9]]) { g.beginPath(); g.arc(dx, dy, r, 0, 7); g.fill(); }
      g.fillStyle = 'rgba(200,225,255,0.9)'; g.beginPath(); g.ellipse(0, 8, 24, 5, 0, 0, 7); g.fill();
      const fw = Math.sin(t * 18) * 6;
      g.fillStyle = 'rgba(255,255,255,0.9)';
      for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(sx * 8, -20); g.quadraticCurveTo(sx * 30, -38 - fw, sx * 36, -18 - fw); g.quadraticCurveTo(sx * 24, -22, sx * 8, -12); g.fill(); }
      break;
    }
    default: g.fillStyle = col; g.beginPath(); g.arc(0, 0, 7, 0, 7); g.fill();
  }
  g.restore();
}
function drawPhoenix(g, t) {
  const f = Math.sin(t * 16) * 9;
  g.fillStyle = 'rgba(255,90,40,0.75)';
  g.beginPath(); g.moveTo(-10, 0); g.quadraticCurveTo(-28, -6, -40, -14 + Math.sin(t * 10) * 4); g.quadraticCurveTo(-30, 0, -40, 14 - Math.sin(t * 10) * 4); g.quadraticCurveTo(-28, 6, -10, 0); g.fill();
  const wing = (s) => { g.beginPath(); g.moveTo(4, 0); g.quadraticCurveTo(-4, s * (10 + f), -18, s * (26 + f)); g.quadraticCurveTo(-8, s * 12, -12, s * 4); g.closePath(); g.fill(); };
  g.fillStyle = '#ff7a2c'; wing(-1); wing(1);
  g.fillStyle = '#ffb347'; g.beginPath(); g.ellipse(2, 0, 13, 6, 0, 0, 7); g.fill();
  g.fillStyle = '#ffe36e'; g.beginPath(); g.ellipse(9, -1, 6, 4.5, 0, 0, 7); g.fill();
  g.fillStyle = '#ff5a2c'; g.beginPath(); g.moveTo(14, -1); g.lineTo(20, 1); g.lineTo(14, 3); g.fill();
  g.fillStyle = '#2b2238'; g.beginPath(); g.arc(11, -2, 1.3, 0, 7); g.fill();
  g.fillStyle = '#ffd43b'; g.beginPath(); g.moveTo(6, -5); g.quadraticCurveTo(4, -12, 9, -14); g.quadraticCurveTo(8, -9, 10, -5); g.fill();
}
function starPath(g, x, y, R, r, n) { g.beginPath(); for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, rr = i % 2 ? r : R; i ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); }
const rgbHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

/* ---------- crates & stickies ---------- */
function drawCrate(g, c, t) {
  const sway = c.landed ? 0 : Math.sin(t * 2 + c.id) * 0.15;
  g.save(); g.translate(c.x, c.y); g.rotate(sway);
  if (!c.landed) {
    g.strokeStyle = 'rgba(80,60,40,0.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-12, -28); g.lineTo(-24, -62); g.moveTo(12, -28); g.lineTo(24, -62); g.stroke();
    g.fillStyle = '#ff8fab'; g.beginPath(); g.moveTo(-30, -60); g.quadraticCurveTo(0, -96, 30, -60); g.quadraticCurveTo(0, -70, -30, -60); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(-10, -66); g.quadraticCurveTo(0, -92, 10, -66); g.quadraticCurveTo(0, -70, -10, -66); g.fill();
  }
  g.fillStyle = '#c98a4b'; g.strokeStyle = '#7a4f24'; g.lineWidth = 2; roundRect(g, -14, -28, 28, 28, 4); g.fill(); g.stroke();
  g.strokeStyle = '#8f5f2e'; g.beginPath(); g.moveTo(-14, -14); g.lineTo(14, -14); g.moveTo(0, -28); g.lineTo(0, 0); g.stroke();
  g.fillStyle = '#ffe066'; g.font = '14px sans-serif'; g.textAlign = 'center'; g.fillText(ITEMS[c.item] ? ITEMS[c.item].icon : '?', 0, -9); g.textAlign = 'left';
  if (c.landed) { g.globalAlpha = 0.4 + Math.sin(t * 4) * 0.2; g.strokeStyle = '#fff6b0'; g.lineWidth = 2; roundRect(g, -17, -31, 34, 34, 6); g.stroke(); g.globalAlpha = 1; }
  g.restore();
}
function drawSticky(g, s, t) {
  const blink = Math.sin(t * 10) > 0;
  g.fillStyle = '#ff4d6d'; roundRect(g, s.x - 7, s.y - 5, 14, 10, 3); g.fill();
  g.fillStyle = blink ? '#fff066' : '#7a2030'; g.beginPath(); g.arc(s.x, s.y, 2.5, 0, 7); g.fill();
}

/* ---------- water ---------- */
function drawWater(g, wl, x0, x1, t) {
  const L = MAPS[TERR.map].liquid, top = wl;
  const wave = (x) => top + Math.sin(x * 0.02 + t * (L.lava ? 0.8 : 1.6)) * 4 + Math.sin(x * 0.05 - t * (L.lava ? 1.1 : 2.3)) * 2;
  if (L.lava) { const lg = g.createLinearGradient(0, top - 90, 0, top); lg.addColorStop(0, 'rgba(255,120,40,0)'); lg.addColorStop(1, 'rgba(255,120,40,0.35)'); g.fillStyle = lg; g.fillRect(x0 - 50, top - 90, x1 - x0 + 100, 92); }
  const gr = g.createLinearGradient(0, top, 0, H + 200);
  gr.addColorStop(0, L.stops[0]); gr.addColorStop(0.4, L.stops[1]); gr.addColorStop(1, L.stops[2]);
  g.fillStyle = gr; g.beginPath(); g.moveTo(x0 - 50, H + 400);
  for (let x = x0 - 50; x <= x1 + 50; x += 20) g.lineTo(x, wave(x));
  g.lineTo(x1 + 50, H + 400); g.closePath(); g.fill();
  g.strokeStyle = L.foam; g.lineWidth = 3; g.beginPath();
  for (let x = x0 - 50; x <= x1 + 50; x += 20) { const y = wave(x); x === x0 - 50 ? g.moveTo(x, y) : g.lineTo(x, y); }
  g.stroke();
  g.fillStyle = L.fleck;
  for (let x = Math.floor(x0 / 90) * 90; x < x1 + 90; x += 90) { const ox = (x * 7.3) % 50; g.beginPath(); g.ellipse(x + ox + Math.sin(t + x) * 10, top + 26 + (x % 3) * 18, 18, 2, 0, 0, 7); g.fill(); }
  if (L.lava) for (let x = Math.floor(x0 / 130) * 130; x < x1 + 130; x += 130) {
    const ph = (t * 0.55 + (x * 0.013) % 1) % 1, bx = x + ((x * 3.7) % 60);
    g.strokeStyle = `rgba(255,236,150,${0.9 * (1 - ph)})`; g.lineWidth = 2; g.beginPath(); g.arc(bx, wave(bx) + 3, 3 + ph * 8, Math.PI, 0); g.stroke();
  }
}

/* ---------- particles & events ---------- */
function addP(o) { if (P.length > P_MAX) P.shift(); P.push(Object.assign({ vx: 0, vy: 0, g: 0, life: 1, t: 0, r: 3, col: '#fff', type: 'dot', drag: 0 }, o)); }
function addFloat(x, y, text, col, size = 18, life = 1.1) { FLOATS.push({ x, y, text, col, size, t: 0, life }); if (FLOATS.length > 60) FLOATS.shift(); }
function burst(x, y, n, col, spd, life, r, g = 600) {
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = spd * (0.4 + Math.random() * 0.8); addP({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - spd * 0.3, g, life: life * (0.6 + Math.random() * 0.6), r: r * (0.6 + Math.random() * 0.8), col }); }
}
function playEvent(e, local) {
  const near = local ? dist(local.x, local.y, e.x, e.y) : 0;
  switch (e.type) {
    case 'boom': {
      const key = typeof e.b === 'string' ? e.b : 'cannon', S = SHELLS[key], r = e.a || 50;
      const col = S ? S.col : key === 'phoenix' ? '#ff7a2c' : '#ffb347';
      const mat = matAt(e.x, e.y + 8) || matAt(e.x, e.y + 22);
      const Pl = TERR.pal, debris = mat === M_STONE ? [rgbHex(Pl.stone), rgbHex(Pl.stoneDk)] : mat === M_WOOD ? [rgbHex(Pl.wood), rgbHex(Pl.woodDk)] : [rgbHex(Pl.soil), rgbHex(Pl.grass), rgbHex(Pl.soilDk), rgbHex(Pl.top)];
      addP({ type: 'glow', x: e.x, y: e.y, r: r * 2.4, life: 0.3, col: '#fff4cc' });
      addP({ type: 'glow', x: e.x, y: e.y, r: r * 1.6, life: 0.6, col });
      addP({ type: 'ring', x: e.x, y: e.y, r: r * 1.35, life: 0.4, col: '#ffffff' });
      addP({ type: 'ring', x: e.x, y: e.y, r: r * 1.0, life: 0.65, col });
      for (let i = 0; i < 20; i++) { const a = Math.random() * Math.PI * 2, s = rnd(260, 560); addP({ type: 'streak', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 500, life: rnd(0.2, 0.45), r: 2.2, col }); }
      for (let i = 0; i < 18; i++) { const a = -Math.PI * Math.random(), s = rnd(150, 480); addP({ type: 'chunk', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 900, life: 1.4, r: rnd(2, 6), col: pick(debris), rot: Math.random() * 6 }); }
      for (let i = 0; i < 10; i++) addP({ type: 'smoke', x: e.x + rnd(-r, r) * 0.5, y: e.y + rnd(-r, r) * 0.4, vx: rnd(-25, 25), vy: rnd(-60, -15), life: rnd(1.2, 2.2), r: r * rnd(0.3, 0.5), col: 'rgba(95,88,96,' });
      switch (key) {
        case 'ice':
          for (let i = 0; i < 18; i++) { const a = Math.random() * Math.PI * 2, s = rnd(120, 360); addP({ type: 'shard', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, g: 800, life: 1.1, r: rnd(3, 7), col: pick(['#ffffff', '#cdf3ff', '#8fd8f5']), rot: Math.random() * 6 }); }
          addP({ type: 'ring', x: e.x, y: e.y, r: r * 1.8, life: 0.8, col: '#bdf0ff' }); break;
        case 'fire': case 'phoenix':
          addP({ type: 'glow', x: e.x, y: e.y - 10, r: r * 2, life: 0.9, col: '#ff6a2c' });
          for (let i = 0; i < 34; i++) addP({ type: 'ember', x: e.x + rnd(-r, r) * 0.7, y: e.y + rnd(-10, 10), vx: rnd(-60, 60), vy: rnd(-260, -80), g: -40, life: rnd(0.6, 1.3), r: rnd(3, 6), col: pick(['#ff7a2c', '#ffb347', '#ffe36e']) });
          break;
        case 'water':
          for (let i = 0; i < 26; i++) { const a = -Math.PI / 2 + rnd(-1.2, 1.2), s = rnd(160, 420); addP({ type: 'drop', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 900, life: 1, r: rnd(2, 4), col: '#bfe8ff' }); }
          for (let i = 0; i < 12; i++) addP({ type: 'bubble', x: e.x + rnd(-r, r) * 0.6, y: e.y + rnd(-r, r) * 0.4, vy: rnd(-70, -20), life: rnd(0.8, 1.4), r: rnd(3, 7), col: '#e6f7ff' });
          break;
        case 'bolt':
          for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2; addP({ type: 'bolt', x: e.x, y: e.y, x2: e.x + Math.cos(a) * r * 1.8, y2: e.y + Math.sin(a) * r * 1.8, life: 0.3, col: '#fff3a0' }); }
          break;
        case 'gravity':
          addP({ type: 'implode', x: e.x, y: e.y, r: r * 2.8, life: 0.55, col: '#b9a0ff' });
          for (let i = 0; i < 26; i++) { const a = Math.random() * Math.PI * 2, d = r * 2.6; addP({ type: 'swirl', x: e.x + Math.cos(a) * d, y: e.y + Math.sin(a) * d, vx: -Math.cos(a) * d * 2, vy: -Math.sin(a) * d * 2, life: 0.5, r: 3, col: '#c9b4ff' }); }
          break;
        case 'hammer':
          for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + rnd(-1.3, 1.3), s = rnd(120, 260); addP({ type: 'star', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 500, life: 0.9, r: 5, col: '#ffd43b', rot: Math.random() * 6 }); }
          break;
        case 'sticky':
          addP({ type: 'glow', x: e.x, y: e.y, r: r * 2.6, life: 0.7, col: '#ff4d6d' });
          break;
        case 'marker':
          addP({ type: 'ring', x: e.x, y: e.y, r: 46, life: 0.8, col: '#ff8fab' }); addP({ type: 'ring', x: e.x, y: e.y, r: 28, life: 0.8, col: '#ffffff' });
          break;
      }
      if (TERR.map === 'tho') for (let i = 0; i < 6; i++) { const a = rnd(-0.5, 0.5) + (i % 2 ? 0 : Math.PI), l = r * rnd(0.9, 1.6); addP({ type: 'bolt', x: e.x, y: e.y + 6, x2: e.x + Math.cos(a) * l, y2: e.y + 6 + Math.abs(Math.sin(a)) * l * 0.25, life: 0.5, col: pick(['#ffd23f', '#ff8a3c', '#ffffff']) }); }
      shake = Math.max(shake, Math.min(20, r * 0.24) * (near < 900 ? 1 : 0.5)); flash = 0.08;
      SFX.boom(r, key, e.x, e.y, mat);
      break;
    }
    case 'stun': addFloat(e.x, e.y, e.b, '#ffe066', 22); for (let i = 0; i < 8; i++) addP({ type: 'star', x: e.x + rnd(-20, 20), y: e.y + 20, vx: rnd(-80, 80), vy: rnd(-160, -60), g: 300, life: 0.9, r: 5, col: '#ffd43b', rot: Math.random() * 6 }); SFX.tone(900, 0.3, 'square', 0.04, 0.5); break;
    case 'fall': for (let i = 0; i < 18; i++) { const a = -Math.PI * Math.random(); addP({ type: 'smoke', x: e.x + rnd(-14, 14), y: e.y, vx: Math.cos(a) * rnd(60, 160), vy: Math.sin(a) * rnd(20, 60), life: rnd(0.6, 1), r: rnd(6, 11), col: 'rgba(210,190,160,' }); } addP({ type: 'ring', x: e.x, y: e.y, r: 40, life: 0.4, col: '#e8d9c0' }); shake = Math.max(shake, 7); SFX.thud(); break;
    case 'dmg': addFloat(e.x + rnd(-10, 10), e.y, '-' + e.a, '#ffffff', e.a > 200 ? 26 : 20); break;
    case 'heal':
      if (typeof e.a === 'number' && e.a < 0) { addFloat(e.x, e.y, '+' + (-e.a), '#8dff9b', 20); for (let i = 0; i < 8; i++) addP({ type: 'plus', x: e.x + rnd(-14, 14), y: e.y + 30 + rnd(-10, 10), vy: -60 - Math.random() * 40, life: 1, r: 5, col: '#7ee081' }); }
      else { addP({ type: 'ring', x: e.x, y: e.y, r: e.a || 90, life: 0.6, col: '#7ee081' }); for (let i = 0; i < 16; i++) addP({ type: 'plus', x: e.x + rnd(-60, 60), y: e.y + rnd(-30, 30), vy: -50 - Math.random() * 60, life: 1.1, r: 5, col: '#a5f3a8' }); SFX.heal(); }
      break;
    case 'text': addFloat(e.x, e.y, e.b, '#fff6c8', 18, 1.4); break;
    case 'combo': addFloat(e.x, e.y, e.b, '#ffd43b', 26, 1.6); shake = Math.max(shake, 8); SFX.combo(); break;
    case 'death': addP({ type: 'ghost', x: e.x, y: e.y, vy: -40, life: 1.8, r: 14, col: '#fff' }); burst(e.x, e.y, 20, '#ffffff', 200, 0.8, 3, 200); SFX.death(); break;
    case 'splash': { const lava = MAPS[TERR.map].liquid.lava; for (let i = 0; i < 24; i++) { const a = -Math.PI / 2 + rnd(-0.9, 0.9), s = 200 + Math.random() * 300; addP({ type: lava ? 'ember' : 'drop', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 900, life: 1, r: lava ? 5 : 3, col: lava ? pick(['#ffb347', '#ff7a2c', '#ffe36e']) : '#bfe8ff' }); } } addP({ type: 'ring', x: e.x, y: e.y, r: 40, life: 0.5, col: '#ffffff' }); if (MAPS[TERR.map].liquid.lava) SFX.sizzle(e.x, e.y); else SFX.splash(e.x, e.y); break;
    case 'zap': addP({ type: 'bolt', x: e.x, y: e.y, x2: e.a, y2: e.b, life: 0.3, col: '#fff3a0' }); SFX.zap(); break;
    case 'thunder': addP({ type: 'bolt', x: e.x + rnd(-30, 30), y: e.y - 700, x2: e.x, y2: e.y, life: 0.4, col: '#fff3a0', w: 6 }); addP({ type: 'flash', x: e.x, y: e.y, r: 120, life: 0.2, col: '#fffbd0' }); shake = Math.max(shake, 12); flash = 0.12; SFX.zap(); break;
    case 'freeze': addFloat(e.x, e.y, e.b, '#bdf0ff', 18); burst(e.x, e.y + 30, 14, '#dff6ff', 160, 0.7, 3, 300); break;
    case 'fire': addFloat(e.x, e.y, e.b, '#ffb08a', 18); burst(e.x, e.y + 30, 14, '#ff9a3c', 120, 0.8, 3, -100); break;
    case 'burn': for (let i = 0; i < 10; i++) addP({ type: 'ember', x: e.x + rnd(-12, 12), y: e.y + 30, vy: -80 - Math.random() * 60, life: 0.8, r: 3, col: '#ff7a2c' }); break;
    case 'mound': burst(e.x, e.y, 18, '#c98e57', 200, 0.8, 4); addP({ type: 'ring', x: e.x, y: e.y, r: e.a, life: 0.4, col: '#e8c08a' }); SFX.thud(); break;
    case 'portal': addP({ type: 'ring', x: e.x, y: e.y, r: 34, life: 0.5, col: '#f9a8d4' }); for (let i = 0; i < 14; i++) addP({ type: 'spark', x: e.x, y: e.y, vx: rnd(-160, 160), vy: rnd(-160, 160), life: 0.6, r: 3, col: '#ffd6f0' }); SFX.portal(); break;
    case 'beam': {
      addP({ type: 'beamcore', x: e.x, y: e.y, x2: e.a, y2: e.b, life: 0.45, col: '#fff3a0' });
      addP({ type: 'beam', x: e.x, y: e.y, x2: e.a, y2: e.b, life: 0.3, col: '#fff3a0' });
      const L = Math.hypot(e.a - e.x, e.b - e.y);
      for (let d = 0; d < L; d += 40) { const t2 = d / L; addP({ type: 'spark', x: lerp(e.x, e.a, t2), y: lerp(e.y, e.b, t2), vx: rnd(-80, 80), vy: rnd(-80, 80), life: rnd(0.3, 0.6), r: 2.5, col: '#fff3a0' }); }
      addP({ type: 'glow', x: e.a, y: e.b, r: 60, life: 0.4, col: '#ffe066' });
      SFX.zap(); break;
    }
    case 'quake': for (let i = 0; i < 26; i++) addP({ type: 'chunk', x: e.x + rnd(-60, 60), y: e.y, vx: rnd(-120, 120), vy: rnd(-420, -160), g: 900, life: 1.3, r: 3 + Math.random() * 4, col: '#8b5a35', rot: 0 }); shake = Math.max(shake, 16); SFX.boom(80); break;
    case 'shield': addP({ type: 'ring', x: e.x, y: e.y, r: 32, life: 0.5, col: '#9fd0ff' }); SFX.shield(); break;
    case 'crate': SFX.ui(); break;
    case 'pickup': addFloat(e.x, e.y, '+ ' + (ITEMS[ITEM_KEYS[e.b]] ? ITEMS[ITEM_KEYS[e.b]].name : 'vật phẩm'), '#ffe066', 18); SFX.pickup(); break;
    case 'wall': burst(e.x, e.y, 12, '#c48a4e', 140, 0.6, 3); SFX.thud(); break;
    case 'bloom': for (let i = 0; i < 18; i++) addP({ type: 'petal', x: e.x + rnd(-40, 40), y: e.y - 80 - Math.random() * 60, vx: rnd(-30, 30), vy: 40 + Math.random() * 30, life: 1.6, r: 4, col: Math.random() < 0.5 ? '#ffb3d1' : '#ffffff' }); break;
    case 'stick': SFX.thud(); break;
    case 'leap': burst(e.x, e.y, 10, '#e8d9c0', 120, 0.5, 4, 200); break;
    case 'bounce': burst(e.x, e.y, 6, '#c9b48f', 120, 0.4, 3); SFX.knock(e.x, e.y); break;
    case 'shoot': {
      const sh = G_heroesView().find((h) => h.id === e.a), D = sh && HEROES[sh.key];
      SFX.shoot(e.b === 4 ? 'fly' : e.b === 3 ? (D && D.ult === 'phoenix' ? 'fire' : 'cannon') : D ? D.shells[e.b] : 'cannon', e.x, e.y);
      break;
    }
    case 'horn': shake = Math.max(shake, 6); SFX.horn(); break;
    case 'pillar': addP({ type: 'ring', x: e.x, y: e.y, r: 40, life: 0.7, col: (BLESS[e.a] || BLESS[0]).col }); SFX.pillar(); break;
    case 'bless': {
      const col = (BLESS[e.a] || BLESS[0]).col;
      addP({ type: 'glow', x: e.x, y: e.y - 40, r: 90, life: 0.7, col }); addP({ type: 'ring', x: e.x, y: e.y - 20, r: 60, life: 0.6, col });
      for (let i = 0; i < 24; i++) addP({ type: 'spark', x: e.x + rnd(-16, 16), y: e.y - rnd(0, 160), vx: rnd(-60, 60), vy: rnd(-120, -20), life: rnd(0.6, 1.1), r: 3, col });
      SFX.bless(); break;
    }
    case 'bro': addFloat(e.x, e.y, '🤝 Có anh em +10%', '#ffd23f', 18, 1.3); break;
    case 'turn': case 'round': break;
  }
}
function updateParticles(dt) {
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i]; p.t += dt;
    if (p.t >= p.life) { P.splice(i, 1); continue; }
    p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.type === 'chunk' && p.vy > 0 && solid(p.x, p.y)) { p.vy *= -0.3; p.vx *= 0.6; p.y -= 2; }
  }
  for (let i = FLOATS.length - 1; i >= 0; i--) { const f = FLOATS[i]; f.t += dt; if (f.t >= f.life) FLOATS.splice(i, 1); }
}
const ADDITIVE = new Set(['glow', 'streak', 'spark', 'ember', 'swirl', 'bolt', 'beam', 'beamcore', 'flash']);
function drawParticle(g, p) {
  const k = p.t / p.life, a = 1 - k;
  switch (p.type) {
    case 'flash': g.fillStyle = hexA(p.col, 0.8 * a); g.beginPath(); g.arc(p.x, p.y, p.r * (0.6 + k), 0, 7); g.fill(); break;
    case 'glow': glow(g, p.x, p.y, p.r * (0.7 + k * 0.5), p.col, 0.9 * a); break;
    case 'ring': g.strokeStyle = hexA(p.col, a); g.lineWidth = 7 * a + 1; g.beginPath(); g.arc(p.x, p.y, p.r * (0.35 + k * 0.9), 0, 7); g.stroke(); break;
    case 'implode': g.strokeStyle = hexA(p.col, a); g.lineWidth = 4 + 6 * k; g.beginPath(); g.arc(p.x, p.y, Math.max(1, p.r * (1 - k)), 0, 7); g.stroke(); break;
    case 'smoke': g.fillStyle = p.col + (0.32 * a) + ')'; g.beginPath(); g.arc(p.x, p.y, p.r * (0.6 + k * 1.3), 0, 7); g.fill(); break;
    case 'chunk': g.save(); g.translate(p.x, p.y); g.rotate((p.rot || 0) + p.t * 8); g.globalAlpha = Math.min(1, a * 2); g.fillStyle = p.col; g.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.8); g.restore(); break;
    case 'shard': g.save(); g.translate(p.x, p.y); g.rotate((p.rot || 0) + p.t * 10); g.globalAlpha = Math.min(1, a * 2); g.fillStyle = p.col; g.beginPath(); g.moveTo(0, -p.r); g.lineTo(p.r * 0.5, p.r * 0.6); g.lineTo(-p.r * 0.5, p.r * 0.6); g.closePath(); g.fill(); g.restore(); break;
    case 'streak': { const sp = Math.hypot(p.vx, p.vy) || 1, l = 14 * a + 4; g.strokeStyle = hexA(p.col, a); g.lineWidth = p.r; g.lineCap = 'round'; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx / sp * l, p.y - p.vy / sp * l); g.stroke(); break; }
    case 'plus': g.fillStyle = hexA(p.col, a); g.fillRect(p.x - p.r, p.y - 1.2, p.r * 2, 2.4); g.fillRect(p.x - 1.2, p.y - p.r, 2.4, p.r * 2); break;
    case 'leaf': g.save(); g.translate(p.x, p.y); g.rotate((p.rot || 0) + p.t * 6); g.fillStyle = hexA(p.col, a); g.beginPath(); g.ellipse(0, 0, p.r, p.r * 0.45, 0, 0, 7); g.fill(); g.restore(); break;
    case 'bubble': g.strokeStyle = hexA(p.col, a); g.lineWidth = 1.5; g.beginPath(); g.arc(p.x + Math.sin(p.t * 9) * 3, p.y, p.r, 0, 7); g.stroke(); break;
    case 'star': g.save(); g.translate(p.x, p.y); g.rotate((p.rot || 0) + p.t * 5); g.fillStyle = hexA(p.col, a); starPath(g, 0, 0, p.r, p.r * 0.4, 4); g.fill(); g.restore(); break;
    case 'frost': g.save(); g.translate(p.x, p.y); g.rotate(p.rot || 0); g.fillStyle = hexA(p.col, a); g.fillRect(-p.r / 2, -p.r / 2, p.r, p.r); g.restore(); break;
    case 'ghost': g.globalAlpha = a; g.fillStyle = '#fff'; g.beginPath(); g.arc(p.x, p.y, p.r, Math.PI, 0); g.lineTo(p.x + p.r, p.y + p.r); for (let i = 0; i < 4; i++) g.lineTo(p.x + p.r - (i + 0.5) * p.r / 2, p.y + p.r * (i % 2 ? 1 : 0.6)); g.closePath(); g.fill();
      g.fillStyle = '#2b2238'; g.beginPath(); g.arc(p.x - 4, p.y - 2, 2, 0, 7); g.arc(p.x + 4, p.y - 2, 2, 0, 7); g.fill(); g.globalAlpha = 1; break;
    case 'bolt': case 'beam': {
      g.strokeStyle = hexA(p.col, a); g.lineWidth = (p.w || (p.type === 'beam' ? 7 : 3.5)) * a + 1;
      g.beginPath(); g.moveTo(p.x, p.y);
      const n = 8; for (let i = 1; i <= n; i++) { const t = i / n; g.lineTo(lerp(p.x, p.x2, t) + (i < n ? rnd(-10, 10) : 0), lerp(p.y, p.y2, t) + (i < n ? rnd(-10, 10) : 0)); }
      g.stroke(); break;
    }
    case 'beamcore': g.lineCap = 'round'; g.strokeStyle = hexA('#ffe066', 0.5 * a); g.lineWidth = 22 * a + 2; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x2, p.y2); g.stroke(); g.strokeStyle = hexA('#ffffff', a); g.lineWidth = 6 * a + 1; g.stroke(); break;
    case 'swirl': case 'spark': g.fillStyle = hexA(p.col, a); g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); break;
    default: g.fillStyle = hexA(p.col, a); g.beginPath(); g.arc(p.x, p.y, p.r * (p.type === 'ember' ? 0.4 + a * 0.6 : 1), 0, 7); g.fill();
  }
}
function drawParticles(g) {
  for (const p of P) if (!ADDITIVE.has(p.type)) drawParticle(g, p);
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const p of P) if (ADDITIVE.has(p.type)) drawParticle(g, p);
  g.restore();
}
function drawFloats(g) {
  for (const f of FLOATS) {
    const k = f.t / f.life, a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3, y = f.y - k * 46, sc = k < 0.12 ? 0.6 + k / 0.12 * 0.5 : 1.1 - Math.min(0.1, k);
    g.globalAlpha = a; g.font = `800 ${f.size * sc}px "Baloo 2", sans-serif`; g.textAlign = 'center';
    g.lineWidth = 5; g.strokeStyle = 'rgba(40,25,50,0.75)'; g.strokeText(f.text, f.x, y); g.fillStyle = f.col; g.fillText(f.text, f.x, y);
  }
  g.globalAlpha = 1; g.textAlign = 'left';
}

/* ---------- overhead UI ---------- */
function drawHeroUI(g, h, isActor, mine, myTeam, t, stamina) {
  const y = h.y - 74 - (HEROES[h.key].hp > 1200 ? 6 : 0);
  const w = 56, x = h.x - w / 2;
  g.fillStyle = 'rgba(30,20,40,0.55)'; roundRect(g, x - 2, y - 2, w + 4, 10, 4); g.fill();
  const tot = Math.max(h.maxHp, h.hp + (h.shield || 0));
  g.fillStyle = h.team === myTeam ? (mine ? '#6fe06f' : '#5aa9ff') : '#ff5c5c';
  roundRect(g, x, y, Math.max(0.1, w * h.hp / tot), 6, 3); g.fill();
  if (h.shield > 0) { g.fillStyle = '#e6f0ff'; g.fillRect(x + w * h.hp / tot, y, w * h.shield / tot, 6); }
  g.fillStyle = '#ffd43b'; g.fillRect(x, y + 7, w * (h.energy || 0) / 100, 2);
  if (stamina !== undefined) { g.fillStyle = 'rgba(30,20,40,0.45)'; g.fillRect(x, y + 10, w, 4); g.fillStyle = '#5ab8ff'; g.fillRect(x, y + 10, w * stamina / STAMINA, 4); }
  g.font = '800 12px Nunito, sans-serif'; g.textAlign = 'center'; g.lineWidth = 3.5; g.strokeStyle = 'rgba(30,20,40,0.7)';
  g.strokeText(h.name, h.x, y - 6); g.fillStyle = h.team === myTeam ? '#ffffff' : '#ffe0d6'; g.fillText(h.name, h.x, y - 6);
  // statuses
  const st = Object.keys(h.status || {});
  if (st.length) { g.font = '13px sans-serif'; st.forEach((k, i) => g.fillText(STATUS[k].icon, h.x - (st.length - 1) * 8 + i * 16, y + 24)); }
  if (isActor) {
    // whose turn it is, readable from across the map: pulsing ring at the feet, big arrow and a label
    const col = mine ? '#ffb703' : TEAM_COL[h.team], by = y - 50 + Math.sin(t * 5) * 5, pul = 0.5 + 0.5 * Math.sin(t * 4);
    g.save();
    g.globalAlpha = 0.45 + 0.35 * pul; g.strokeStyle = col; g.lineWidth = 4;
    g.beginPath(); g.ellipse(h.x, h.y + 2, 30 + pul * 4, 9 + pul, 0, 0, 7); g.stroke();
    g.globalAlpha = 1; g.fillStyle = col; g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(h.x - 15, by - 15); g.lineTo(h.x + 15, by - 15); g.lineTo(h.x, by + 6); g.closePath(); g.fill(); g.stroke();
    const lab = mine ? 'LƯỢT BẠN' : 'ĐANG BẮN';
    g.font = '800 14px "Baloo 2", sans-serif'; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = 'rgba(30,20,40,0.75)';
    g.strokeText(lab, h.x, by - 22); g.fillStyle = col; g.fillText(lab, h.x, by - 22);
    g.restore();
  }
  g.textAlign = 'left';
}
const fmtU = (px) => (px / UNIT).toFixed(1);
function drawTape(g, ax, ay, bx, by, col) {
  const dx = bx - ax, dy = ay - by;
  g.save();
  g.setLineDash([10, 7]); g.strokeStyle = col; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, ay); g.lineTo(bx, by); g.stroke(); g.setLineDash([]);
  g.strokeStyle = hexA('#ffffff', 0.5); g.lineWidth = 1.5; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
  for (let k = 1; k * UNIT < Math.abs(dx); k++) { const xx = ax + Math.sign(dx) * k * UNIT; g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(xx, ay - (k % 5 ? 5 : 10)); g.lineTo(xx, ay + (k % 5 ? 5 : 10)); g.stroke(); }
  const label = `↔ ${fmtU(Math.abs(dx))} ô   ${dy >= 0 ? '↑' : '↓'} ${fmtU(Math.abs(dy))} ô`;
  g.font = '800 16px "Baloo 2", sans-serif'; const tw = g.measureText(label).width;
  const lx = (ax + bx) / 2, ly = ay - 16;
  g.fillStyle = 'rgba(30,20,40,0.78)'; roundRect(g, lx - tw / 2 - 10, ly - 18, tw + 20, 26, 9); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(label, lx, ly + 1); g.textAlign = 'left';
  g.fillStyle = col; g.beginPath(); g.arc(bx, by, 6, 0, 7); g.fill();
  g.restore();
}
function drawDistanceTag(g, me, e) {
  const dx = Math.abs(e.x - me.x), dy = me.y - e.y;
  const label = `${fmtU(dx)} ô ${dy >= 0 ? '↑' : '↓'}${fmtU(Math.abs(dy))}`;
  const y = e.y - 104 - (HEROES[e.key].hp > 1200 ? 6 : 0);
  g.font = '800 13px "Baloo 2", sans-serif'; const tw = g.measureText(label).width;
  g.fillStyle = 'rgba(255,92,92,0.9)'; roundRect(g, e.x - tw / 2 - 7, y - 13, tw + 14, 19, 7); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(label, e.x, y + 1); g.textAlign = 'left';
}
function drawAimGuide(g, h, ang, power, full, col, showArc, nowind, wind, arcT = 0.55, spread = null) {
  if (showArc) {
    const cx = h.x, cy = h.y - 24, R = 64;
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 2;
    g.beginPath(); for (let a = -20; a <= 90; a += 2) { const r = a * Math.PI / 180, x = cx + Math.cos(r) * R * h.face, y = cy - Math.sin(r) * R; a === -20 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke();
    for (let a = 0; a <= 90; a += 10) { const r = a * Math.PI / 180, l = a % 30 === 0 ? 9 : 5; g.beginPath(); g.moveTo(cx + Math.cos(r) * (R - l) * h.face, cy - Math.sin(r) * (R - l)); g.lineTo(cx + Math.cos(r) * R * h.face, cy - Math.sin(r) * R); g.stroke(); }
    const r = ang * Math.PI / 180;
    g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.moveTo(cx + Math.cos(r) * 24 * h.face, cy - Math.sin(r) * 24); g.lineTo(cx + Math.cos(r) * (R + 10) * h.face, cy - Math.sin(r) * (R + 10)); g.stroke();
    if (spread) for (const da of spread) { if (!da) continue; const r2 = (ang + da) * Math.PI / 180; g.strokeStyle = hexA(col, 0.55); g.lineWidth = 2; g.beginPath(); g.moveTo(cx + Math.cos(r2) * 30 * h.face, cy - Math.sin(r2) * 30); g.lineTo(cx + Math.cos(r2) * (R + 4) * h.face, cy - Math.sin(r2) * (R + 4)); g.stroke(); }
    g.font = '800 15px "Baloo 2", sans-serif'; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = 'rgba(30,20,40,0.7)';
    const tx = cx + Math.cos(r) * (R + 26) * h.face, ty = cy - Math.sin(r) * (R + 26) + 5;
    g.strokeText(Math.round(ang) + '°', tx, ty); g.fillStyle = '#fff'; g.fillText(Math.round(ang) + '°', tx, ty); g.textAlign = 'left';
  }
  if (power > 0 && (full || arcT > 0)) {
    for (const da of spread || [0]) {
      const r = predictPath(h, ang + da, power, nowind, wind, full ? 6 : arcT, 0.035);
      const pts = r.pts;
      for (let i = 1; i < pts.length; i++) {
        const a = (full ? 0.9 : 1 - i / pts.length) * (da ? 0.6 : 1);
        g.fillStyle = hexA(col, a); g.beginPath(); g.arc(pts[i][0], pts[i][1], full ? 2.6 : 3.2, 0, 7); g.fill();
      }
      if (full) { g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(r.x, r.y, 12, 0, 7); g.stroke(); }
    }
  }
}
/* chosen target: rotating reticle */
function drawTargetMark(g, x, y, t, col) {
  g.save(); g.translate(x, y); g.rotate(t * 1.2);
  g.strokeStyle = col; g.lineWidth = 3; g.setLineDash([9, 7]);
  g.beginPath(); g.arc(0, 0, 30, 0, 7); g.stroke(); g.setLineDash([]);
  for (let k = 0; k < 4; k++) { g.rotate(Math.PI / 2); g.beginPath(); g.moveTo(22, 0); g.lineTo(38, 0); g.stroke(); }
  g.restore();
}
/* where my previous shot landed, with its settings */
function drawLastShot(g, ls, t) {
  const x = ls.lx, y = ls.ly;
  g.save();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(x - 8, y - 8); g.lineTo(x + 8, y + 8); g.moveTo(x + 8, y - 8); g.lineTo(x - 8, y + 8); g.stroke();
  g.strokeStyle = 'rgba(255,224,102,0.9)'; g.lineWidth = 1.5; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(x, y - 10); g.lineTo(x, y - 34); g.stroke(); g.setLineDash([]);
  const label = `Lượt trước · ${Math.round(ls.ang)}° · ${ls.power.toFixed(1)}`;
  g.font = '800 12px Nunito, sans-serif'; const tw = g.measureText(label).width;
  g.fillStyle = 'rgba(30,20,40,0.72)'; roundRect(g, x - tw / 2 - 7, y - 54, tw + 14, 20, 7); g.fill();
  g.fillStyle = '#ffe066'; g.textAlign = 'center'; g.fillText(label, x, y - 40); g.textAlign = 'left';
  g.restore();
}
