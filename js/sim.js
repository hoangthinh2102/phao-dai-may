'use strict';
/* ===== Pháo Đài Mây — match simulation (offline + online host) ===== */

let G = null;
const PHOENIX = { key: 'phoenix', name: 'Phượng Hoàng', dmg: 280, r: 60, status: ['burn', 3], col: '#ff7a2c' };

function newMatch(cfg) {
  G = {
    seed: cfg.seed, perTeam: cfg.perTeam, diff: cfg.diff ?? 1, map: MAPS[cfg.map] ? cfg.map : 'may',
    heroes: [], projs: [], crates: [], stickies: [], pending: [], pillars: [],
    ops: [], opSeq: 0, events: [], evId: 0,
    round: 0, phase: 0, phaseTeam: 0, queue: [], actor: null, state: 'between', stateT: 1.2, settleT: 0,
    turnT: TURN_TIME, wind: 0, prevWind: 0, turnNo: 0, water: H - 70, over: false, winner: -1, t: 0, nextId: 1,
    firstTeam: cfg.seed & 1, onEvent: cfg.onEvent || null,
  };
  genTerrain(cfg.seed, cfg.perTeam, G.map);
  G.wind = G.prevWind = Math.round(rnd(-1.2, 1.2) * 10) / 10;
  const idx = [0, 0];
  cfg.slots.forEach((sl, i) => {
    const sp = TERR.spawns[sl.team][idx[sl.team]++ % TERR.spawns[sl.team].length];
    G.heroes.push(makeHero(i + 1, sl, sp));
  });
  startRound();
  return G;
}
function makeHero(id, sl, sp) {
  const D = HEROES[sl.hero];
  return {
    id, team: sl.team, key: sl.hero, name: sl.name, bot: !sl.human, peer: sl.peer || null,
    x: sp.x, y: sp.y, vx: 0, vy: 0, grounded: true, airborne: false, apexY: sp.y, speed: D.speed, face: sl.team ? -1 : 1, ang: 45, lastPower: 55, charge: 0,
    hp: D.hp, maxHp: D.hp, shield: 0, energy: 0, delay: id * 0.01, dead: false,
    status: {}, burnPow: 40, skillCd: 0, flyCd: 0, flying: false, items: [], stamina: STAMINA, sel: 0, bank: BANK_TIME,
    turnBuffs: {}, turnDelay: 0, frozenTurn: false, stunnedTurn: false, stunImmune: 0, input: { mv: 0 }, walking: false, hurtT: 0,
    huntId: 0, huntStack: 0, kills: 0, dmgDealt: 0, shots: 0, hits: 0, ai: null,
  };
}

/* ---------- helpers ---------- */
const heroById = (id) => G.heroes.find((h) => h.id === id);
const alive = (team) => G.heroes.filter((h) => !h.dead && (team === undefined || h.team === team));
const center = (h) => [h.x, h.y - 22];
function emit(type, x, y, a = 0, b = 0) {
  const e = { id: ++G.evId, type, x: Math.round(x), y: Math.round(y), a, b };
  G.events.push(e); if (G.events.length > 40) G.events.shift();
  if (G.onEvent) G.onEvent(e);
}
function pushOp(op) {
  op = op.map((v, i) => (i ? Math.round(v) : v));
  G.ops.push({ seq: ++G.opSeq, op }); if (G.ops.length > 60) G.ops.shift();
  applyOp(op);
}
function schedule(dt, fn) { G.pending.push({ t: G.t + dt, fn }); }

/* ---------- rounds & turns ---------- */
function startRound() {
  G.round++; G.phase = 0;
  if (G.round > 1) {
    for (const s of G.stickies.slice()) detonateSticky(s);
    G.stickies = [];
    for (const h of alive()) {
      if (h.status.burn) { damageHero(h, h.burnPow, h.burnSrc ? heroById(h.burnSrc) : null, {}); emit('burn', h.x, h.y - 40); }
      for (const k of ['wet', 'burn', 'mark']) if (h.status[k]) { h.status[k]--; if (h.status[k] <= 0) delete h.status[k]; }
      if (h.stunImmune > 0) h.stunImmune--;
    }
    if (G.round >= SUDDEN_ROUND) { G.water = Math.max(H * 0.36, G.water - 45); emit('text', W / 2, G.water - 40, 0, 'Nước dâng!'); }
    if (G.round % 2 === 0) for (let k = 0; k < (G.perTeam >= 3 ? 2 : 1); k++) dropCrate();
    // Thổ Thần: the war horn turns the wind right round every few rounds
    if (G.map === 'tho' && G.round % HORN_EVERY === 0) {
      const dir = G.wind >= 0 ? -1 : 1;
      G.prevWind = G.wind; G.wind = Math.round(dir * rnd(1.5, WIND_MAX) * 10) / 10; G.holdWind = true;
      emit('horn', W / 2, 160, Math.round(G.wind * 10), 0);
    }
  }
  if (G.map === 'tho') spawnPillar();
  emit('round', W / 2, 200, G.round, 0);
  if (checkWin()) return;
  beginPhase();
}
function beginPhase() {
  G.phaseTeam = (G.firstTeam + G.round + G.phase) % 2;
  G.queue = alive(G.phaseTeam).sort((a, b) => a.delay - b.delay || a.id - b.id);
  G.state = 'between'; G.stateT = 0.6; G.actor = null;
}
function advancePhase() {
  if (checkWin()) return;
  G.phase++;
  if (G.phase >= 2) startRound(); else beginPhase();
}
function nextActor() {
  if (checkWin()) return;
  while (G.queue.length && G.queue[0].dead) G.queue.shift();
  if (!G.queue.length) { advancePhase(); return; }
  const h = G.queue.shift();
  G.actor = h; G.state = 'aim'; G.turnT = TURN_TIME;
  if (G.turnNo++ > 0) { if (G.holdWind) G.holdWind = false; else { G.prevWind = G.wind; G.wind = nextWind(G.wind); } }
  h.stamina = STAMINA; h.turnBuffs = {}; h.turnDelay = 0; h.charge = 0; h.input = { mv: 0 };
  h.frozenTurn = false; h.stunnedTurn = false;
  if (h.status.frozen) { h.frozenTurn = true; h.status.frozen--; if (h.status.frozen <= 0) delete h.status.frozen; }
  if (h.status.stun) { h.stunnedTurn = true; delete h.status.stun; h.stunImmune = 2; emit('text', h.x, h.y - 80, 0, 'Choáng!'); }
  if (h.skillCd > 0) h.skillCd--;
  if (h.flyCd > 0) h.flyCd--;
  if (h.key === 'moclan') for (const a of alive(h.team)) if (a !== h && dist(a.x, a.y, h.x, h.y) < 300) { heal(a, 60); }
  emit('turn', h.x, h.y, h.id);
  if (h.bot) h.ai = { t: DIFF[G.diff].think + rnd(0, 0.6), plan: null };
}
/* Gunny-style wind: small drift every turn, sometimes a gust change; always within ±WIND_MAX */
function nextWind(w) {
  const n = Math.random() < 0.18 ? rnd(-WIND_MAX, WIND_MAX) : w + rnd(-0.7, 0.7);
  return Math.round(clamp(n, -WIND_MAX, WIND_MAX) * 10) / 10;
}
function endTurn() {
  const h = G.actor;
  if (h) { h.delay += Math.max(80, h.turnDelay || 100); h.turnBuffs = {}; h.charge = 0; h.walking = false; h.input = { mv: 0 }; h.stunnedTurn = false; h.frozenTurn = false; }
  G.actor = null; G.state = 'between'; G.stateT = 0.7; G.idleT = 0;
}
function checkWin() {
  if (G.over) return true;
  const a = alive(0).length, b = alive(1).length;
  if (a && b) return false;
  G.over = true; G.winner = a ? 0 : b ? 1 : -1; G.state = 'over';
  return true;
}

/* ---------- actor actions ---------- */
function canAct(h) { return !G.over && G.state === 'aim' && G.actor === h && !h.dead; }
function setAim(h, ang, face) {
  if (!canAct(h)) return;
  h.ang = clamp(ang, -20, 90);
  if (face === 1 || face === -1) h.face = face;
}
function doFire(h, sel, ang, power) {
  if (!canAct(h)) return false;
  sel = clamp(sel | 0, 0, 4);
  const D = HEROES[h.key];
  if (sel === 3 && h.energy < 100) return false;
  if (sel === 4 && (h.flyCd > 0 || h.frozenTurn || h.stunnedTurn || !h.grounded)) return false;
  const st = selCost(h.key, sel);
  if (h.stamina < st) return false;
  h.stamina -= st;
  h.ang = clamp(ang, -20, 90); power = clamp(power, 0, 100);
  if (h.stunnedTurn) power = clamp(power + rnd(-7, 7), 0, 100);
  h.lastPower = power; h.sel = sel; h.charge = 0;
  G.state = 'flight'; G.settleT = 0; h.shots++;
  let mult = h.turnBuffs.power ? 1.4 : 1;
  const tele = !!h.turnBuffs.teleport;
  // Thổ Thần map: a teammate close by, and the red pillar's blessing
  if (sel !== 4 && broNear(h)) { mult *= BRO_MULT; emit('bro', h.x, h.y - 70, h.id, 0); }
  if (sel !== 4 && h.blessDmg) { mult *= 1.25; h.blessDmg = false; }
  let fire;
  if (sel === 4) {
    h.flyCd = FLY_CD + 1; h.turnDelay += SHELLS.fly.delay;
    launchShell(h, 'fly', h.ang, power, {});
    emit('shoot', h.x, h.y - 24, h.id, 4);
    return true;
  }
  if (sel === 3) { h.energy = 0; h.turnDelay += 100 + ULTS[D.ult].delay; fire = (first) => fireUlt(h, h.ang, power, mult); }
  else {
    const key = D.shells[sel], T = toolBlocked(key) ? null : toolCombo(h.turnBuffs.tools);
    h.turnDelay += SHELLS[key].delay + (T ? T.delay : 0);
    if (T && T.keys.length) {
      // tools stack: 1 + extra rounds on the same path, each round a fan of 3 when x3 is on
      const fan = T.spread || [0], ang = h.ang;
      const round = (first, r) => { if (!h.dead) fan.forEach((da) => launchShell(h, key, ang + da, power, { mult: mult * T.mult, tele: tele && first && r === 0 && da === 0 })); };
      fire = (first) => { round(first, 0); for (let r = 1; r <= T.extra; r++) schedule(0.32 * r, () => round(first, r)); };
    } else fire = (first) => launchShell(h, key, h.ang, power, { mult, tele: tele && first });
  }
  fire(true);
  if (h.turnBuffs.double) schedule(0.7, () => { if (!h.dead) fire(false); });
  emit('shoot', h.x, h.y - 24, h.id, sel);
  return true;
}
function useSkill(h) {
  if (!canAct(h) || h.skillCd > 0) return false;
  const sk = HEROES[h.key].skill;
  if (h.stamina < SKILLS[sk].st) return false;
  switch (sk) {
    case 'scope': h.turnBuffs.scope = true; emit('text', h.x, h.y - 70, 0, 'Ống Ngắm'); break;
    case 'stoneShield': {
      let best = h, br = h.hp / h.maxHp;
      for (const a of alive(h.team)) if (dist(a.x, a.y, h.x, h.y) < 450 && a.hp / a.maxHp < br) { br = a.hp / a.maxHp; best = a; }
      best.shield += 250; emit('shield', best.x, best.y - 22, best.id); break;
    }
    case 'barricade': {
      const x = h.x + h.face * 42;
      if (solid(x, h.y - 50)) return false;
      pushOp([3, x - 8, h.y - 84, 16, 84]); emit('wall', x, h.y - 40); break;
    }
    case 'calm': h.turnBuffs.calm = true; emit('text', h.x, h.y - 70, 0, 'Lặng gió'); break;
    case 'leap': if (!h.grounded || h.frozenTurn || h.stunnedTurn) return false; h.vx = h.face * 320; h.vy = -560; h.grounded = false; emit('leap', h.x, h.y); break;
  }
  h.skillCd = SKILLS[sk].cd + 1; h.turnDelay += 30; h.stamina -= SKILLS[sk].st;
  return true;
}
/* combat tool (+1, +2, x3): toggle on/off for this turn, they stack; paid with stamina, refunded when turned off */
function useTool(h, k) {
  if (!canAct(h) || !TOOLS[k]) return false;
  const on = h.turnBuffs.tools || (h.turnBuffs.tools = []), i = on.indexOf(k);
  if (i >= 0) { on.splice(i, 1); h.stamina = Math.min(STAMINA, h.stamina + TOOLS[k].cost); return true; }
  if (h.stamina < TOOLS[k].cost) return false;
  on.push(k); h.stamina -= TOOLS[k].cost;
  return true;
}
function useItem(h, slot) {
  if (!canAct(h) || !h.items[slot]) return false;
  const it = h.items.splice(slot, 1)[0];
  switch (it) {
    case 'power': h.turnBuffs.power = true; break;
    case 'double': h.turnBuffs.double = true; break;
    case 'medkit': heal(h, 300); break;
    case 'shield': h.shield += 200; emit('shield', h.x, h.y - 22, h.id); break;
    case 'teleport': h.turnBuffs.teleport = true; break;
  }
  h.turnDelay += 20; emit('text', h.x, h.y - 70, 0, ITEMS[it].name);
  return true;
}
function skipTurn(h) { if (canAct(h)) { h.turnDelay += 100; endTurn(); } }

/* ---------- movement ---------- */
function supported(h) { return solid(h.x, h.y + 1) || solid(h.x - 7, h.y + 1) || solid(h.x + 7, h.y + 1); }
function walk(h, dir, dt) {
  h.face = dir;
  // input.rs = stamina the player keeps for the weapon they picked, so walking never eats it
  const keep = clamp(+h.input.rs || 0, 0, STAMINA);
  if (h.stamina <= keep || h.frozenTurn || h.stunnedTurn || !h.grounded) return false;
  const step = h.speed * dt, nx = h.x + dir * step;
  if (nx < 8 || nx > W - 8) return false;
  let ny = null;
  for (let dy = -12; dy <= 14; dy++) if (!solid(nx, h.y + dy - 1) && solid(nx, h.y + dy)) { ny = h.y + dy; break; }
  if (ny === null) {
    if (solid(nx, h.y - 12)) return false;
    h.x = nx; h.grounded = false;
  } else {
    if (solid(nx, ny - 22) || solid(nx, ny - 38)) return false;
    h.x = nx; h.y = ny;
  }
  h.stamina = Math.max(keep, h.stamina - step * WALK_ST);
  h.walking = true;
  return true;
}
function heroPhysics(h, dt) {
  if (h.dead || h.flying) return;
  if (h.hurtT > 0) h.hurtT -= dt;
  if (h.grounded) {
    if (solid(h.x, h.y - 6)) h.y -= 2;
    if (!supported(h)) h.grounded = false;
  }
  if (!h.grounded) {
    if (!h.airborne) { h.airborne = true; h.apexY = h.y; }
    h.apexY = Math.min(h.apexY, h.y);
    h.vy = Math.min(1500, h.vy + GRAV * dt);
    const n = Math.ceil((Math.abs(h.vx) + Math.abs(h.vy)) * dt / 3) + 1;
    for (let i = 0; i < n; i++) {
      const nx = h.x + h.vx * dt / n, ny = h.y + h.vy * dt / n;
      if (solid(nx, ny - 22) || solid(nx, ny - 38)) h.vx *= -0.25; else h.x = nx;
      if (h.vy < 0 && solid(h.x, ny - BODY_H)) h.vy = 0; else h.y = ny;
      if (h.vy >= 0 && solid(h.x, h.y)) {
        let k = 0; while (solid(h.x, h.y - 1) && k++ < 40) h.y -= 1;
        h.y = Math.ceil(h.y); h.vx = 0; h.vy = 0; h.grounded = true; landed(h); break;
      }
    }
    h.x = clamp(h.x, -80, W + 80);
  }
  if (h.y > G.water + 6) { emit('splash', h.x, G.water); killHero(h, h.lastHitBy ? heroById(h.lastHitBy) : null, 'drown'); return; }
  for (const p of G.pillars) if (!p.taken && Math.abs(h.x - p.x) < 28 && h.y > p.y - 150 && h.y < p.y + 12) takePillar(h, p);
  for (const c of G.crates) if (!c.taken && dist(c.x, c.y - 14, h.x, h.y - 22) < 38) {
    c.taken = true;
    if (h.items.length < 3) { h.items.push(c.item); emit('pickup', c.x, c.y - 20, h.id, ITEM_KEYS.indexOf(c.item)); }
    else emit('text', c.x, c.y - 30, 0, 'Túi đầy');
  }
}
function landed(h) {
  h.airborne = false;
  const fall = h.y - h.apexY;
  if (fall <= FALL_SAFE) return;
  let dmg = Math.min(FALL_MAX, (fall - FALL_SAFE) * FALL_DMG);
  if (h.key === 'thachgiap') dmg *= 0.5;
  emit('fall', h.x, h.y, Math.round(fall));
  emit('text', h.x, h.y - 84, 0, 'Rơi đau!');
  damageHero(h, dmg, h.lastHitBy ? heroById(h.lastHitBy) : null, {});
}
function settled() {
  for (const h of G.heroes) if (!h.dead && (!h.grounded || Math.abs(h.vx) > 5)) return false;
  return true;
}

/* ---------- Thổ Thần map: anh em + blessing pillars ---------- */
const broNear = (h) => G.map === 'tho' && alive(h.team).some((a) => a !== h && dist(a.x, a.y, h.x, h.y) < BRO_R);
function spawnPillar() {
  if (G.pillars.filter((p) => !p.taken).length >= 2) return;
  for (let tries = 0; tries < 40; tries++) {
    const x = rnd(140, W - 140);
    if (Math.abs(x - W / 2) < 90) continue; // not on the totem
    const y = topSurfaceAt(x); if (y < 0 || y > G.water - 60) continue;
    if (G.heroes.some((h) => !h.dead && Math.abs(h.x - x) < 70)) continue;
    const p = { id: G.nextId++, x: Math.round(x), y, type: (Math.random() * BLESS.length) | 0, taken: false };
    G.pillars.push(p); emit('pillar', p.x, p.y, p.type, 0);
    return;
  }
}
function takePillar(h, p) {
  if (h.dead) return;
  p.taken = true;
  switch (p.type) {
    case 0: h.blessDmg = true; break;
    case 1: h.shield += 150; emit('shield', h.x, h.y - 22, h.id); break;
    case 2: heal(h, 150); break;
    case 3: h.energy = Math.min(100, h.energy + 30); break;
  }
  emit('bless', p.x, p.y, p.type, h.id);
  emit('text', h.x, h.y - 84, 0, BLESS[p.type].name + '!');
}
function updatePillars() {
  for (const p of G.pillars) {
    if (p.taken) continue;
    // the ground under it was blown away: it sinks to the next surface, or is lost in the water
    if (!solid(p.x, p.y + 2)) { const y = surfaceBelow(p.x, p.y); if (y >= G.water - 4) p.taken = true; else p.y = y; }
  }
  G.pillars = G.pillars.filter((p) => !p.taken);
}

/* ---------- crates ---------- */
function dropCrate() {
  const xs = TERR.spawns[0].concat(TERR.spawns[1]).map((s) => s.x);
  const x = clamp(pick(xs) + rnd(-160, 160), 60, W - 60);
  G.crates.push({ id: G.nextId++, x, y: -60, vy: 0, item: pick(ITEM_KEYS), landed: false, taken: false });
  emit('crate', x, 0);
}
function updateCrates(dt) {
  for (const c of G.crates) {
    if (c.taken || c.landed) { if (c.landed && !solid(c.x, c.y) && !solid(c.x, c.y + 1)) c.landed = false; continue; }
    c.vy = Math.min(c.vy + GRAV * 0.25 * dt, 130);
    c.y += c.vy * dt;
    if (solid(c.x, c.y)) { let k = 0; while (solid(c.x, c.y - 1) && k++ < 60) c.y -= 1; c.y = Math.ceil(c.y); c.landed = true; c.vy = 0; }
    if (c.y > G.water) c.taken = true;
  }
  G.crates = G.crates.filter((c) => !c.taken);
}

/* ---------- shooting ---------- */
function muzzle(h, ang) {
  const a = ang * Math.PI / 180;
  return [h.x + Math.cos(a) * h.face * 26, h.y - 24 - Math.sin(a) * 26, Math.cos(a) * h.face, -Math.sin(a)];
}
function launchShell(h, key, ang, power, opts = {}) {
  const S = SHELLS[key];
  if (S.kind === 'beam') return fireBeam(h, key, ang, opts);
  const [mx, my, dx, dy] = muzzle(h, ang), v = power * POWER_K;
  G.projs.push({
    id: G.nextId++, key, kind: S.kind, owner: h, team: h.team, x: mx, y: my, vx: dx * v, vy: dy * v, t: 0,
    bounces: S.bounces || 0, split: false, inGround: false, drillD: 0, nowind: !!(S.nowind || h.turnBuffs.calm),
    mult: opts.mult || 1, tele: !!opts.tele,
  });
  if (S.kind === 'fly') { h.flying = true; h.grounded = false; h.vx = 0; h.vy = 0; }
}
function fireBeam(h, key, ang, opts) {
  const S = SHELLS[key], [mx, my, dx, dy] = muzzle(h, ang);
  let x = mx, y = my, hitList = [];
  for (let d = 0; d < S.range; d += 4) {
    x = mx + dx * d; y = my + dy * d;
    if (solid(x, y) || y > G.water) break;
    for (const e of alive()) if (e.team !== h.team && !hitList.includes(e) && dist(x, y, e.x, e.y - 22) < BODY_R + 6) hitList.push(e);
  }
  emit('beam', mx, my, Math.round(x), Math.round(y));
  for (const e of hitList) hitHero(e, S, h, opts.mult || 1, 1, x, y);
  if (solid(x, y)) pushOp([1, x, y, S.r]);
  if (opts.tele) teleport(h, x, y);
  bombiHunt(h, hitList[0] || null);
}
function updateProjs(dt) {
  const keep = [];
  for (const p of G.projs) {
    let alive_ = true;
    const sp = Math.hypot(p.vx, p.vy), n = Math.max(1, Math.ceil(sp * dt / 5)), sdt = dt / n;
    for (let s = 0; s < n && alive_; s++) {
      if (p.kind === 'phoenix') {
        const t = p.target && !p.target.dead ? p.target : nearestEnemy(p.team, p.x, p.y);
        if (t) {
          const want = Math.atan2(t.y - 22 - p.y, t.x - p.x), cur = Math.atan2(p.vy, p.vx);
          let da = want - cur; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
          const na = cur + clamp(da, -3.2 * sdt, 3.2 * sdt); p.vx = Math.cos(na) * 640; p.vy = Math.sin(na) * 640;
        }
      } else {
        p.vy += GRAV * sdt;
        if (!p.nowind) p.vx += G.wind * WIND_K * sdt;
      }
      const ovy = p.vy;
      p.x += p.vx * sdt; p.y += p.vy * sdt; p.t += sdt;
      if (p.kind === 'split' && !p.split && ovy < 0 && p.vy >= 0) {
        p.split = true;
        for (const dvx of [-150, 150]) G.projs.push({ ...p, id: G.nextId++, vx: p.vx + dvx, split: true });
        keep.push(...G.projs.splice(G.projs.length - 2, 2));
      }
      if (p.x < -500 || p.x > W + 500 || p.y > H + 60 || p.t > 14) { if (p.kind === 'fly') flyDrop(p); alive_ = false; break; }
      if (p.y > G.water) { emit('splash', p.x, G.water); if (p.kind === 'fly') flyDrop(p); alive_ = false; break; }
      if (p.kind === 'fly') {
        const h = p.owner; h.x = p.x; h.y = p.y + 22; h.face = p.vx >= 0 ? 1 : -1;
        if (p.t > 0.08 && (solid(p.x, p.y + 22) || solid(p.x, p.y))) { flyLand(p); alive_ = false; break; }
        continue;
      }
      const hit = heroAtPoint(p.x, p.y, p.owner, p.t);
      if (hit) { impact(p, p.x, p.y, hit); alive_ = false; break; }
      const sol = solid(p.x, p.y);
      if (p.kind === 'drill') {
        if (sol) { p.inGround = true; p.drillD += Math.hypot(p.vx, p.vy) * sdt; if (p.drillD >= SHELLS.drill.drill) { impact(p, p.x, p.y, null); alive_ = false; } }
        else if (p.inGround) { impact(p, p.x, p.y, null); alive_ = false; }
        continue;
      }
      if (!sol) continue;
      if (p.kind === 'bounce' && p.bounces > 0) {
        const [nx, ny] = normalAt(p.x, p.y);
        p.x -= p.vx * sdt; p.y -= p.vy * sdt;
        const dot = p.vx * nx + p.vy * ny;
        p.vx = (p.vx - 2 * dot * nx) * 0.58; p.vy = (p.vy - 2 * dot * ny) * 0.58;
        p.bounces--; emit('bounce', p.x, p.y);
        continue;
      }
      impact(p, p.x, p.y, null); alive_ = false;
    }
    if (alive_ && G.projs.includes(p)) keep.push(p);
  }
  G.projs = keep.filter((p, i, arr) => arr.indexOf(p) === i);
}
function flyLand(p) {
  const h = p.owner; h.flying = false;
  let x = p.x, y = p.y + 22, k = 0;
  while (solid(x, y - 1) && k++ < 120) y -= 2;
  h.x = clamp(x, 10, W - 10); h.y = y; h.vx = 0; h.vy = 0; h.grounded = false; h.airborne = true; h.apexY = y;
  emit('portal', h.x, h.y - 22);
}
function flyDrop(p) {
  const h = p.owner; h.flying = false;
  h.x = clamp(p.x, -60, W + 60); h.y = Math.min(p.y + 22, G.water + 20); h.vx = p.vx * 0.2; h.vy = 200; h.grounded = false; h.airborne = true; h.apexY = h.y;
}
function heroAtPoint(x, y, owner, t) {
  for (const h of G.heroes) {
    if (h.dead || h.flying || (h === owner && t < 0.35)) continue;
    if (dist(x, y, h.x, h.y - 22) < BODY_R + 3) return h;
  }
  return null;
}
function nearestEnemy(team, x, y) {
  let best = null, bd = 1e9;
  for (const e of alive()) if (e.team !== team) { const d = dist(x, y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
  return best;
}
function impact(p, x, y, hitHero) {
  const h = p.owner;
  if (p.kind === 'portal') { teleport(h, x, y); return; }
  if (p.kind === 'sticky') {
    if (hitHero && hitHero.team !== p.team) G.stickies.push({ x, y, attach: hitHero.id, dx: x - hitHero.x, dy: y - hitHero.y, owner: h.id, team: p.team, mult: p.mult });
    else if (!hitHero) G.stickies.push({ x, y, attach: 0, owner: h.id, team: p.team, mult: p.mult });
    emit('stick', x, y);
    if (p.tele) teleport(h, x, y);
    return;
  }
  const S = p.kind === 'phoenix' ? PHOENIX : SHELLS[p.key];
  if (p.kind === 'mound') {
    pushOp([2, x, y + 12, S.r]); emit('mound', x, y, S.r);
    if (hitHero && hitHero.team !== p.team) hitHero_(hitHero, S, h, p.mult, x, y);
    if (p.tele) teleport(h, x, y - S.r);
    return;
  }
  if (p.kind === 'heal') {
    for (const a of alive()) {
      const d = dist(x, y, a.x, a.y - 22); if (d > S.r + BODY_R) continue;
      if (a.team === p.team) heal(a, S.heal * p.mult); else damageHero(a, S.dmg * p.mult, h, { blast: true });
    }
    emit('heal', x, y, S.r);
    if (p.tele) teleport(h, x, y);
    return;
  }
  explode(x, y, S, h, p.mult, hitHero, p.kind);
  if (p.tele) teleport(h, x, y);
}
function hitHero_(v, S, src, mult, x, y) { hitHero(v, S, src, mult, 1, x, y); }

function explode(x, y, S, src, mult, direct, kind) {
  if (!S.noCrater && S.r > 0) pushOp([1, x, y, S.small ? S.r * 0.6 : S.r]);
  emit('boom', x, y, S.r, S.key || 'cannon');
  const victims = [];
  for (const v of alive()) {
    if (v.team === src.team) continue;
    const d = dist(x, y, v.x, v.y - 22); if (d > S.r + BODY_R) continue;
    const f = 1 - 0.55 * clamp(d / (S.r + BODY_R), 0, 1);
    victims.push(v);
    hitHero(v, S, src, mult, f, x, y);
  }
  if (kind === 'gravity') {
    for (const v of alive()) {
      if (v.team === src.team || v.key === 'thachgiap') continue;
      const d = dist(x, y, v.x, v.y - 22); if (d > S.r * 2.8 || d < 6) continue;
      const k = (1 - d / (S.r * 2.8)) * 520;
      v.vx += (x - v.x) / d * k; v.vy -= 260; v.grounded = false;
    }
    emit('text', x, y - 60, 0, 'Hấp lực!');
  }
  // Lôi Vũ — conduction
  if (S.elec && src.key === 'loivu' && victims.length) {
    const prim = victims.reduce((a, b) => (dist(x, y, a.x, a.y) < dist(x, y, b.x, b.y) ? a : b));
    let chain = null, bd = 220;
    for (const e of alive()) if (e.team !== src.team && !victims.includes(e)) { const d = dist(prim.x, prim.y, e.x, e.y); if (d < bd) { bd = d; chain = e; } }
    if (chain) { emit('zap', prim.x, prim.y - 22, chain.x, chain.y - 22); hitHero(chain, { ...S, dmg: S.dmg * 0.4, status: null }, src, mult, 1, chain.x, chain.y - 22, true); }
  }
  bombiHunt(src, direct || victims[0] || null);
}
function bombiHunt(src, target) {
  if (!src || src.key !== 'bombi') return;
  if (!target) { src.huntStack = 0; src.huntId = 0; return; }
  if (target.id === src.huntId) src.huntStack = Math.min(3, src.huntStack + 1);
  else { src.huntId = target.id; src.huntStack = 0; }
}
/* Apply one shell's effect on one enemy hero, with combos. f = falloff 0..1 */
function hitHero(v, S, src, mult, f, x, y, noKnock) {
  if (v.dead) return;
  let dmg = S.dmg * f * mult;
  if (src && src.key === 'bombi' && src.huntId === v.id) dmg *= 1 + 0.15 * src.huntStack;
  let applyStatus = S.status;
  if (v.status.frozen) { dmg *= 1.5; delete v.status.frozen; emit('combo', v.x, v.y - 70, 0, 'Vỡ Băng! ×1.5'); }
  if (S.elec && v.status.wet) { dmg *= 1.8; emit('combo', v.x, v.y - 70, 0, 'Điện Giật! ×1.8'); emit('zap', v.x, v.y - 120, v.x, v.y - 22); }
  if (applyStatus && applyStatus[0] === 'burn' && v.status.wet) { applyStatus = null; delete v.status.wet; emit('combo', v.x, v.y - 70, 0, 'Hơi Nước!'); }
  if (applyStatus && applyStatus[0] === 'wet' && v.status.burn) { delete v.status.burn; emit('combo', v.x, v.y - 70, 0, 'Dập Lửa'); }
  if (dmg > 0) damageHero(v, dmg, src, { blast: true });
  if (src) src.hits++;
  if (applyStatus && applyStatus[0] === 'stun' && !v.dead) {
    if (v.stunImmune > 0 || v.stunnedTurn) { emit('text', v.x, v.y - 60, 0, 'Miễn choáng'); }
    else { v.status.stun = 1; v.delay += 150; G.queue.sort((a, b) => a.delay - b.delay || a.id - b.id); emit('stun', v.x, v.y - 60, 0, STATUS.stun.name); }
    applyStatus = null;
  }
  if (applyStatus && !v.dead) {
    let [k, dur] = applyStatus;
    if (k === 'burn' && src && src.key === 'hoamieu') { dur += 1; v.burnPow = 60; } else if (k === 'burn') v.burnPow = 40;
    if (k === 'burn') v.burnSrc = src ? src.id : 0;
    v.status[k] = Math.max(v.status[k] || 0, dur);
    emit(k === 'frozen' ? 'freeze' : k === 'burn' ? 'fire' : 'text', v.x, v.y - 60, 0, STATUS[k].name);
  }
  if (!noKnock && !v.dead && v.key !== 'thachgiap' && f > 0) {
    // light knock-back (Gunny-like): a nudge, not a launch; falling should come from holes in the ground
    const dx = v.x - x, dy = (v.y - 22) - y, d = Math.hypot(dx, dy) || 1, k = 115 * f * Math.min(1.4, mult);
    v.vx += dx / d * k; v.vy += Math.min(-70, dy / d * k - 70); v.grounded = false;
  }
}
function damageHero(v, amount, src, opts = {}) {
  if (v.dead || amount <= 0) return 0;
  let a = amount;
  if (v.status.mark) a *= 1.25;
  if (opts.blast && v.key === 'thachgiap') a *= 0.8;
  if (v.shield > 0) { const s = Math.min(v.shield, a); v.shield -= s; a -= s; if (s > 0) emit('shield', v.x, v.y - 22, v.id); }
  a = Math.round(a);
  if (a <= 0) return 0;
  v.hp -= a; v.hurtT = 0.35;
  v.energy = Math.min(100, v.energy + a / 12);
  if (src && src.team !== v.team) { src.energy = Math.min(100, src.energy + a / 8); src.dmgDealt += a; v.lastHitBy = src.id; }
  emit('dmg', v.x, v.y - 56, a);
  if (v.hp <= 0) killHero(v, src, 'hp');
  return a;
}
function heal(h, amt) {
  if (h.dead) return;
  const a = Math.round(Math.min(amt, h.maxHp - h.hp)); if (a <= 0) return;
  h.hp += a; emit('heal', h.x, h.y - 56, -a);
}
function killHero(v, src, cause) {
  if (v.dead) return;
  v.dead = true; v.hp = 0; v.vx = v.vy = 0; v.shield = 0;
  if (src && src.team !== v.team) src.kills++;
  G.stickies = G.stickies.filter((s) => s.attach !== v.id);
  emit('death', v.x, v.y - 22, v.id, cause === 'drown' ? 1 : 0);
}
function teleport(h, x, y) {
  if (h.dead) return;
  let k = 0; while (solid(x, y) && k++ < 80) y -= 2;
  emit('portal', h.x, h.y - 22);
  h.x = clamp(x, 10, W - 10); h.y = y; h.vx = 0; h.vy = 0; h.grounded = false; h.airborne = true; h.apexY = y;
  emit('portal', h.x, h.y - 22);
}
function detonateSticky(s) {
  const src = heroById(s.owner) || { team: s.team, key: '', id: 0 };
  let x = s.x, y = s.y;
  if (s.attach) { const v = heroById(s.attach); if (v && !v.dead) { x = v.x + s.dx; y = v.y + s.dy; } }
  explode(x, y, SHELLS.sticky, src, s.mult || 1, null, 'sticky');
}

/* ---------- ultimates ---------- */
function fireUlt(h, ang, power, mult) {
  const u = HEROES[h.key].ult;
  emit('text', h.x, h.y - 80, 0, ULTS[u].name + '!');
  switch (u) {
    case 'barrage':
      for (let k = 0; k < 5; k++) schedule(k * 0.2, () => { if (!h.dead) launchShell(h, 'cannon', ang + (k - 2) * 1.1, clamp(power + (k - 2) * 3.5, 5, 100), { mult: 0.62 * mult }); });
      break;
    case 'quake':
      alive().filter((e) => e.team !== h.team).forEach((e, i) => schedule(0.25 + i * 0.3, () => {
        if (e.dead) return;
        pushOp([1, e.x, e.y + 18, 72]); emit('quake', e.x, e.y);
        damageHero(e, 140 * mult, h, { blast: true }); e.grounded = false; e.vy = -120;
      }));
      break;
    case 'bloom':
      for (const a of alive(h.team)) { heal(a, a.maxHp * 0.35); a.status = {}; emit('bloom', a.x, a.y - 22); }
      break;
    case 'thunder':
      alive().filter((e) => e.team !== h.team).forEach((e, i) => schedule(0.2 + i * 0.28, () => {
        if (e.dead) return;
        const wet = !!e.status.wet;
        emit('thunder', e.x, e.y - 22);
        if (wet) emit('combo', e.x, e.y - 70, 0, 'Điện Giật! ×2');
        pushOp([1, e.x, e.y + 4, 26]);
        damageHero(e, 150 * (wet ? 2 : 1) * mult, h, {});
      }));
      break;
    case 'phoenix': {
      const [mx, my] = muzzle(h, ang);
      const t = nearestEnemy(h.team, h.x, h.y);
      G.projs.push({ id: G.nextId++, key: 'fire', kind: 'phoenix', owner: h, team: h.team, x: mx, y: my, vx: h.face * 300, vy: -500, t: 0, target: t, mult, nowind: true });
      break;
    }
  }
}

/* ---------- trajectory prediction (bots + aim preview) ---------- */
function predictPath(h, ang, power, nowind, wind, maxT = 6, sample = 0.05) {
  const [mx, my, dx, dy] = muzzle(h, ang), v = power * POWER_K;
  let x = mx, y = my, vx = dx * v, vy = dy * v, t = 0, st = 0;
  const pts = [[x, y]], dt = 1 / 90;
  while (t < maxT) {
    vy += GRAV * dt; if (!nowind) vx += wind * WIND_K * dt;
    x += vx * dt; y += vy * dt; t += dt; st += dt;
    if (st >= sample) { pts.push([x, y]); st = 0; }
    if (x < -300 || x > W + 300 || y > H) return { pts, x, y, hit: null, end: 'out' };
    if (t > 0.3) for (const e of G_heroesView()) if (!e.dead && dist(x, y, e.x, e.y - 22) < BODY_R + 3) { pts.push([x, y]); return { pts, x, y, hit: e, end: 'hero' }; }
    if (solid(x, y)) { pts.push([x, y]); return { pts, x, y, hit: null, end: 'ground' }; }
  }
  return { pts, x, y, hit: null, end: 'time' };
}
let G_heroesView = () => (G ? G.heroes : []);

/* ---------- bots ---------- */
function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) * 1.4; }
function botChoose(h) {
  const D = HEROES[h.key], enemies = alive().filter((e) => e.team !== h.team), allies = alive(h.team);
  const plan = { sel: 0, skill: false, item: -1, target: null, ally: false };
  const weakest = enemies.slice().sort((a, b) => a.hp - b.hp)[0];
  let target = weakest;
  // prefer closer if weakest is very far
  const near = enemies.slice().sort((a, b) => Math.abs(a.x - h.x) - Math.abs(b.x - h.x))[0];
  if (near && weakest && Math.abs(weakest.x - h.x) > Math.abs(near.x - h.x) + 700) target = near;
  plan.target = target;
  if (h.energy >= 100) {
    const u = D.ult;
    if (u === 'bloom') { if (allies.some((a) => a.hp / a.maxHp < 0.6)) { plan.sel = 3; return plan; } }
    else { plan.sel = 3; return plan; }
  }
  const hurtAlly = allies.filter((a) => a.hp / a.maxHp < 0.6).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  switch (h.key) {
    case 'bombi':
      plan.sel = target && solid(target.x, target.y - 70) ? 2 : Math.random() < 0.25 ? 1 : 0; break;
    case 'thachgiap':
      plan.sel = Math.random() < 0.3 ? 2 : 0; // 0 = Búa Đá (stun)
      if (hurtAlly && h.skillCd <= 0) plan.skill = true;
      break;
    case 'moclan':
      if (hurtAlly) { plan.sel = 0; plan.target = hurtAlly; plan.ally = true; }
      else plan.sel = 1;
      if (h.skillCd <= 0 && Math.random() < 0.25) plan.skill = true;
      break;
    case 'loivu': {
      const wetE = enemies.find((e) => e.status.wet);
      if (wetE) { plan.sel = 0; plan.target = wetE; }
      else if (target && Math.abs(target.x - h.x) < 780 && beamClear(h, target)) plan.sel = 2;
      else plan.sel = Math.abs(G.wind) >= 1.4 || Math.random() < 0.6 ? 0 : 1;
      if (plan.sel !== 0 && Math.abs(G.wind) >= 1.8 && h.skillCd <= 0) plan.skill = true;
      break;
    }
    case 'hoamieu':
      if (target && !target.status.mark && allies.length > 1 && Math.random() < 0.35) plan.sel = 2;
      else plan.sel = target && target.status.burn ? 1 : 0;
      break;
  }
  if (plan.sel < 3 && !plan.ally && !toolBlocked(D.shells[plan.sel]) && Math.random() < 0.3 + G.diff * 0.1) {
    // pick a random stack of tools that still leaves stamina for the shell and the skill
    let left = h.stamina - selCost(h.key, plan.sel) - (plan.skill ? SKILLS[D.skill].st : 0);
    plan.tools = [];
    for (const k of TOOL_KEYS.slice().sort(() => Math.random() - 0.5)) if (TOOLS[k].cost <= left && (!plan.tools.length || Math.random() < 0.15 + G.diff * 0.1)) { plan.tools.push(k); left -= TOOLS[k].cost; }
  }
  if (h.items.includes('medkit') && h.hp / h.maxHp < 0.5) plan.item = h.items.indexOf('medkit');
  else if (h.items.includes('shield') && h.hp / h.maxHp < 0.6) plan.item = h.items.indexOf('shield');
  else if (h.items.includes('power')) plan.item = h.items.indexOf('power');
  else if (h.items.includes('double')) plan.item = h.items.indexOf('double');
  return plan;
}
function beamClear(h, t) {
  const a = Math.atan2(-(t.y - 22 - (h.y - 24)), Math.abs(t.x - h.x)) * 180 / Math.PI;
  if (a < -20 || a > 90) return false;
  const face = t.x >= h.x ? 1 : -1, [mx, my, dx, dy] = muzzle({ ...h, face }, a);
  const len = dist(mx, my, t.x, t.y - 22);
  for (let d = 0; d < len; d += 6) if (solid(mx + dx * d, my + dy * d)) return false;
  return true;
}
/* exhaustive angle × power search, yielding after each angle so the host can spread it over several frames */
function botAim(h, plan) { const it = botAimSteps(h, plan); let r; do r = it.next(); while (!r.done); return r.value; }
function* botAimSteps(h, plan) {
  const t = plan.target; if (!t) return { ang: 45, power: 50, face: h.face };
  const face = t.x >= h.x ? 1 : -1;
  const hh = { ...h, face };
  const key = plan.sel === 3 ? null : HEROES[h.key].shells[plan.sel];
  if (key && SHELLS[key].kind === 'beam') return { ang: Math.atan2(-(t.y - 22 - (h.y - 24)), Math.abs(t.x - h.x)) * 180 / Math.PI, power: 50, face };
  const nowind = (key && SHELLS[key].nowind) || plan.skillCalm || HEROES[h.key].ult === 'phoenix' && plan.sel === 3;
  let best = { ang: 45, power: 50, score: 1e9 };
  const tx = t.x, ty = t.y - 18;
  for (let ang = -5; ang <= 85; ang += 2.5) {
    for (let pw = 18; pw <= 100; pw += 2) {
      const r = predictPath(hh, ang, pw, nowind, G.wind, 6, 1);
      let s = dist(r.x, r.y, tx, ty);
      if (r.hit && r.hit === t) s = 0;
      else if (r.hit && r.hit.team === h.team && !plan.ally) s += 400;
      if (r.end === 'out') s += 300;
      if (dist(r.x, r.y, h.x, h.y) < 90 && !plan.ally) s += 500;
      s += Math.abs(ang - 50) * 0.4;
      if (s < best.score) best = { ang, power: pw, score: s };
    }
    yield;
  }
  const Df = DIFF[G.diff];
  return { ang: clamp(best.ang + gauss() * Df.angErr, -20, 90), power: clamp(best.power + gauss() * Df.err, 5, 100), face };
}
function botUpdate(h, dt) {
  const ai = h.ai; if (!ai) return;
  ai.t -= dt; if (ai.t > 0) return;
  if (!ai.plan) {
    if (!ai.search) {
      const plan = botChoose(h);
      if (h.key === 'loivu' && plan.skill) plan.skillCalm = true;
      ai.search = { plan, it: botAimSteps(h, plan) };
    }
    // at most ~4ms of searching per tick, so the host never stalls a frame
    const t0 = performance.now(); let r;
    do r = ai.search.it.next(); while (!r.done && performance.now() - t0 < 4);
    if (!r.done) return;
    ai.plan = Object.assign(ai.search.plan, r.value); ai.search = null; ai.t = 0.3; return;
  }
  const p = ai.plan;
  if (p.item >= 0 && !p.itemDone) { useItem(h, p.item); p.itemDone = true; ai.t = 0.4; return; }
  if (p.skill && !p.skillDone) { useSkill(h); p.skillDone = true; ai.t = 0.5; return; }
  if (p.tools && p.tools.length) { useTool(h, p.tools.shift()); ai.t = 0.4; return; }
  h.face = p.face;
  if (Math.abs(h.ang - p.ang) > 0.6) { h.ang += clamp(p.ang - h.ang, -70 * dt, 70 * dt); return; }
  if (h.charge < p.power) { h.charge = Math.min(p.power, h.charge + 75 * dt); return; }
  doFire(h, p.sel, p.ang, p.power);
  h.ai = null;
}

/* ---------- main step ---------- */
function stepMatch(dt) {
  if (G.over) return;
  G.t += dt;
  for (const q of G.pending.slice()) if (G.t >= q.t) { G.pending.splice(G.pending.indexOf(q), 1); q.fn(); }
  const a = G.actor;
  for (const h of G.heroes) h.walking = false;
  if (G.state === 'aim' && a && !a.dead && a.input.mv) walk(a, a.input.mv, dt);
  for (const h of G.heroes) heroPhysics(h, dt);
  for (const s of G.stickies) if (s.attach) { const v = heroById(s.attach); if (v) { s.x = v.x + s.dx; s.y = v.y + s.dy; } }
  updateProjs(dt);
  updateCrates(dt);
  if (G.pillars.length) updatePillars();
  if (checkWin()) return;
  switch (G.state) {
    case 'between':
      G.stateT -= dt;
      if (G.stateT <= 0 && ((settled() && !G.projs.length && !G.pending.length) || G.stateT < -4)) nextActor();
      break;
    case 'aim':
      if (!a || a.dead) { endTurn(); break; }
      if (G.turnT > 0) G.turnT -= dt;
      else { a.bank = Math.max(0, a.bank - dt); if (a.bank <= 0) { emit('text', a.x, a.y - 70, 0, 'Hết giờ'); skipTurn(a); break; } }
      if (a.bot) botUpdate(a, dt);
      break;
    case 'flight':
      if (!G.projs.length && !G.pending.length) {
        G.idleT = (G.idleT || 0) + dt;
        if (settled()) { G.settleT += dt; if (G.settleT > 0.45) endTurn(); } else G.settleT = 0;
        if (G.idleT > 4) endTurn();
      } else { G.settleT = 0; G.idleT = 0; }
      break;
  }
}

/* ---------- network snapshot ---------- */
const STATUS_CODE = { wet: 'w', frozen: 'f', burn: 'b', mark: 'm', stun: 's' };
const STATE_CODE = { between: 0, aim: 1, flight: 2, over: 3 };
function encodeSnap() {
  const st = (h) => Object.keys(h.status).map((k) => STATUS_CODE[k] + h.status[k]).join('');
  const flags = (h) => (h.grounded ? F_GROUND : 0) | (h.walking ? F_WALK : 0) | (h.shield > 0 ? F_SHIELD : 0) | (h.hurtT > 0 ? F_HURT : 0) | (h.charge > 0 ? F_CHARGE : 0)
    | (h.turnBuffs.scope ? F_SCOPE : 0) | (h.turnBuffs.calm ? F_CALM : 0) | (h.turnBuffs.power ? F_POWER : 0) | (h.turnBuffs.double ? F_DOUBLE : 0) | (h.turnBuffs.teleport ? F_TELE : 0) | (h.flying ? F_FLY : 0)
    | (G.actor === h && broNear(h) ? F_BRO : 0) | (h.blessDmg ? F_BLESS : 0)
    | (toolBits(h.turnBuffs.tools) << F_TOOL_SHIFT);
  return {
    r: G.round, pt: G.phaseTeam, s: STATE_CODE[G.state], a: G.actor ? G.actor.id : 0, tt: Math.ceil(G.turnT * 10), w: Math.round(G.wind * 10), pw: Math.round(G.prevWind * 10), wl: Math.round(G.water),
    q: G.queue.map((h) => h.id), ov: G.over ? G.winner : -2,
    h: G.heroes.map((h) => [h.id, Math.round(h.x), Math.round(h.y), Math.ceil(h.hp), h.maxHp, h.face, Math.round(h.ang * 10), flags(h), Math.floor(h.energy), Math.round(h.delay),
      Math.round(h.shield), h.dead ? 1 : 0, h.sel, h.items.map((k) => ITEM_KEYS.indexOf(k)).join(''), Math.round(h.stamina), h.skillCd, Math.ceil(h.bank), st(h),
      Math.round(h.charge), h.kills, Math.round(h.dmgDealt / 10), h.shots, h.hits, (h.frozenTurn ? 1 : 0) | (h.stunnedTurn ? 2 : 0), h.huntStack, h.flyCd]),
    p: G.projs.slice(-30).map((p) => [PK.indexOf(p.kind === 'phoenix' ? 'phoenix' : p.key), Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy), p.nowind ? 1 : 0, p.id]),
    bl: G.pillars.map((p) => [p.id, p.x, Math.round(p.y), p.type]),
    c: G.crates.map((c) => [c.id, Math.round(c.x), Math.round(c.y), ITEM_KEYS.indexOf(c.item), c.landed ? 1 : 0]),
    k: G.stickies.map((s) => [Math.round(s.x), Math.round(s.y)]),
    o: G.ops.slice(-64).map((o) => [o.seq].concat(o.op)),
    e: G.events.slice(-14).map((e) => [e.id, EK.indexOf(e.type), e.x, e.y, typeof e.a === 'number' ? Math.round(e.a) : e.a, e.b]),
  };
}
