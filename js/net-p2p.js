'use strict';
/* ===== Pháo Đài Mây — online play outside Claude: browser-to-browser WebRTC via PeerJS, with a relay fallback =====
   Mirrors the part of the Claude `room` API the game uses: join(name) → { presence, onPeers, peers, leave }.
   Star topology: the host owns the presence table. Clients only need the host's state, so the host relays
   just its own presence plus the member list, right when it changes.
   Direct link: PeerJS's free broker introduces the browsers, then data flows straight between them.
   Relay: when two networks cannot reach each other directly (mobile data, office firewalls, same Wi-Fi on Chrome)
   and no TURN server is configured, both sides talk through public MQTT brokers instead. Slower, but it connects. */

const PEERJS_URL = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const MQTT_URL = 'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js';
const P2P_PREFIX = 'phaodaimay-v1-';
const RELAYS = ['wss://test.mosquitto.org:8081', 'wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const RELAY_ROOT = 'phaodaimay/v1/';
const RELAY_GAP = 100;     // ms between two relayed states (public brokers throttle faster senders)
const RELAY_AFTER = 3000;  // a client opens the relay when the direct link is not up after this long
const FORCE_RELAY = /[?&]relay=1/.test(location.search); // testing: clients skip the direct link
// the host's per-tick game state: only the newest one matters, so it travels apart from the rest of the presence,
// on a channel that never resends or waits for a lost packet (a negotiated channel on the same connection)
const FAST_KEY = 's';
const FAST_ID = 42;
const FAST_BUF = 32768;    // skip a state while this much is still queued on the fast channel
const slowPart = (p) => { const o = {}; for (const k in p) if (k !== FAST_KEY) o[k] = p[k]; return o; };
const zOf = (s) => (s && typeof s.z === 'number' ? s.z : -1);
function openFast(c, onMsg) {
  try {
    const pc = c.peerConnection; if (!pc) return null;
    const d = pc.createDataChannel('pdm-fast', { negotiated: true, id: FAST_ID, ordered: false, maxRetransmits: 0 });
    d.onmessage = (e) => { if (typeof e.data !== 'string' || e.data.length > 24000) return; let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
    return d;
  } catch (e) { return null; }
}
// PeerJS's own TURN servers are gone, so only STUN by default; /api/turn adds a real TURN when it is configured
const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];

function loadScript(src) {
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
}
let iceP = null;
function iceServers() {
  return iceP || (iceP = (async () => {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch('/api/turn', { signal: ctl.signal, cache: 'no-store' }); clearTimeout(t);
      const j = r.ok ? await r.json() : null;
      if (j && Array.isArray(j.iceServers) && j.iceServers.length) return STUN.concat(j.iceServers);
    } catch (e) { /* no TURN endpoint (local server) */ }
    return STUN;
  })());
}
let mqttP = null;
const loadMqtt = () => mqttP || (mqttP = (window.mqtt ? Promise.resolve() : loadScript(MQTT_URL)).then(() => window.mqtt || null, () => { mqttP = null; return null; }));
// last network events, for bug reports: copy window.__p2plog from the console
const plog = (...a) => { const L = window.__p2plog || (window.__p2plog = []); L.push([Math.round(performance.now())].concat(a).join(' ')); if (L.length > 150) L.shift(); };
const randId = (n) => { let s = ''; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); };

/* one relay = a connection to every public broker, subscribed to some topics; messages come tagged with the broker
   index, topic and whether the broker had stored it (retained) rather than relaying it live
   (null message = empty payload, i.e. a cleared retained message). opts.will: MQTT last will */
function relayLink(topic, onMsg, opts = {}) {
  const L = { cs: [], up: new Set(), closed: false, failed: false, onUp: null };
  loadMqtt().then((mq) => {
    if (L.closed) return;
    if (!mq) { L.failed = true; return; }
    RELAYS.forEach((url, i) => {
      let c;
      try { c = mq.connect(url, { clientId: 'pdm' + randId(10), keepalive: 15, reconnectPeriod: 3000, connectTimeout: 8000, clean: true, will: opts.will }); } catch (e) { return; }
      L.cs[i] = c;
      c.on('connect', () => { plog('relay up', i); L.up.add(i); c.subscribe(topic, { qos: 0 }); if (L.onUp) L.onUp(i); });
      c.on('close', () => { if (L.up.delete(i)) plog('relay down', i); });
      c.on('error', () => { /* reconnects by itself */ });
      c.on('message', (tp, buf, pk) => {
        if (buf.length > 24000) return;
        const stored = !!(pk && pk.retain);
        if (!buf.length) { onMsg(null, i, tp, stored); return; }
        let m; try { m = JSON.parse(buf.toString()); } catch (e) { return; }
        onMsg(m, i, tp, stored);
      });
    });
  });
  L.send = (i, to, msg, retain = false) => { const c = L.cs[i]; if (c && L.up.has(i)) try { c.publish(to, msg === null ? '' : JSON.stringify(msg), { qos: 0, retain }); } catch (e) { /* closing */ } };
  L.sendAll = (to, msg, retain) => { for (const i of L.up) L.send(i, to, msg, retain); };
  L.close = () => { L.closed = true; for (const c of L.cs) if (c) try { c.end(true); } catch (e) { /* gone */ } };
  return L;
}

/* shared lobby for everyone who has the game open: each tab keeps a retained presence message on the public brokers,
   cleared by its last will when the tab goes away. Same shape as the Claude room: presence, peers, onPeers. */
const LOBBY_TTL = 45000;   // a tab not heard from for this long is gone
const LOBBY_BEAT = 15000;  // presence is re-sent this often (that is also what keeps it fresh)
const LOBBY_GC = 600000;
const LOBBY_BYE = 3000;    // a tab that said goodbye stays listed this long: a reload comes back within it, so no flicker   // a stored presence this old (or unstamped) is a tab that died without its last will
// one id per browser, so two tabs or a reload count as one person
function lobbyUid() {
  try {
    let u = localStorage.getItem('pdmUid');
    if (!/^u[a-z0-9]{10}$/.test(u || '')) { u = 'u' + randId(10); localStorage.setItem('pdmUid', u); }
    return u;
  } catch (e) { return 'u' + randId(10); }
}
function p2pLobby() {
  const id = 'u' + randId(10), uid = lobbyUid(), mine = {}, seen = new Map(), cand = new Map(), mineTopic = RELAY_ROOT + 'online/' + id;
  let fns = [], lastSend = 0, sendT = null, notifyQ = false;
  // seen: tab id → { p: presence, ts: its newest stamp, off: our clock minus its clock, at: that stamp on our clock,
  // on: brokers that hold it }; cand: tabs with an old or odd stamp, waiting for a second one
  // the list has one row per person: their most recently heard tab; our own other tabs are us
  const list = () => {
    const now = Date.now(), best = new Map();
    for (const [k, v] of seen) {
      if (now - v.at >= LOBBY_TTL || (v.bye && now - v.bye >= LOBBY_BYE)) continue;
      const u = typeof v.p.u === 'string' ? v.p.u : k;
      if (u === uid) continue;
      const b = best.get(u); if (!b || (!v.bye && b.v.bye) || (!v.bye === !b.v.bye && v.at > b.v.at)) best.set(u, { k, v });
    }
    const out = [{ peer: id, presence: mine, sameTab: true, isMe: true }];
    for (const { k, v } of best.values()) out.push({ peer: k, presence: v.p, sameTab: false, isMe: false });
    return out;
  };
  const notify = () => { if (notifyQ) return; notifyQ = true; queueMicrotask(() => { notifyQ = false; const peers = list(); for (const fn of fns.slice()) try { fn({ peers }); } catch (e) { console.error(e); } }); };
  const L = relayLink(RELAY_ROOT + 'online/+', (m, b, tp, stored) => {
    const k = String(tp).slice(RELAY_ROOT.length + 7);
    if (!/^u[a-z0-9]{10}$/.test(k) || k === id) return;
    const v = seen.get(k);
    // gone from one broker (last will, or the tab left): gone once no broker has it
    if (m === null) { if (v) { v.on.delete(b); if (!v.on.size && !v.bye) { v.bye = Date.now(); setTimeout(notify, LOBBY_BYE + 50); } } return; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    // freshness comes from the sender's own stamp, never from the broker: brokers keep stored copies of dead tabs and
    // can even replay them as if live (seen on test.mosquitto.org)
    const now = Date.now(), ts = typeof m.ts === 'number' ? m.ts : 0;
    if (!ts || now - ts > LOBBY_GC) { L.send(b, tp, null, true); return; } // unstamped (very old build) or long dead: erase
    if (v) {
      if (ts < v.ts) return; // an older copy
      v.on.add(b);
      if (ts > v.ts) { v.p = m; v.ts = ts; v.at = Math.min(now, ts + v.off); v.bye = 0; notify(); }
      return;
    }
    // a stamp from the last 45 s: alive. Anything else is a dead tab, or a live one whose clock is off: keep it aside;
    // it counts once a later stamp has moved on by as much time as really passed here (replayed copies arrive together)
    const c = cand.get(k);
    let off = 0;
    if (now - ts >= LOBBY_TTL || ts - now > 5000) {
      if (!c || ts <= c.ts || Math.abs((ts - c.ts) - (now - c.rx)) > 4000) { if (!c || ts > c.ts) cand.set(k, { ts, rx: now }); return; }
      off = now - ts;
    }
    cand.delete(k);
    seen.set(k, { p: m, ts, off, at: Math.min(now, ts + off), on: new Set([b]) }); notify();
  }, { will: { topic: mineTopic, payload: '', retain: true, qos: 0 } });
  const stamp = () => { mine.ts = Date.now(); mine.u = uid; return mine; };
  const send = () => { clearTimeout(sendT); sendT = null; lastSend = Date.now(); L.sendAll(mineTopic, stamp(), true); };
  L.onUp = (i) => L.send(i, mineTopic, stamp(), true);
  addEventListener('pagehide', () => L.sendAll(mineTopic, null, true));
  return {
    id,
    presence(patch) {
      for (const k in patch) { if (patch[k] === null || patch[k] === undefined) delete mine[k]; else mine[k] = patch[k]; }
      // at most 2 sends a second
      if (!sendT) sendT = setTimeout(send, Math.max(0, 500 - (Date.now() - lastSend)));
      return Promise.resolve();
    },
    peers: list,
    onPeers(fn) { fns.push(fn); return () => { fns = fns.filter((f) => f !== fn); }; },
    keepAlive() {
      if (Date.now() - lastSend > LOBBY_BEAT) send();
      const now = Date.now(); let gone = false;
      for (const [k, v] of seen) if (now - v.at >= LOBBY_TTL || (v.bye && now - v.bye >= LOBBY_BYE)) { seen.delete(k); gone = true; }
      for (const [k, c] of cand) if (now - c.rx > 2 * LOBBY_TTL) cand.delete(k);
      if (gone) notify();
    },
  };
}

/* room object: the shared lobby plus join(name) for game rooms */
async function p2pRoom() {
  try { if (!window.Peer) await loadScript(PEERJS_URL); } catch (e) { return null; }
  if (!window.Peer) return null;
  iceServers(); // warm up
  let role = 'client';
  const lobby = p2pLobby();
  const R = {
    p2p: true, onStatus: null, current: null,
    presence: lobby.presence, peers: lobby.peers, onPeers: lobby.onPeers,
    setRole(r) { role = r; },
    join(name) {
      const r = role; role = 'client';
      const p = r === 'host' ? p2pHost(name) : p2pClient(name, (st) => R.onStatus && R.onStatus(st));
      return p.then((api) => (R.current = api));
    },
    // called every few seconds from a worker timer: keeps the links alive even in a background tab
    keepAlive() { lobby.keepAlive(); if (R.current && R.current.keepAlive) R.current.keepAlive(); },
    tick() { if (R.current && R.current.tick) R.current.tick(); },
  };
  return R;
}
/* broker link upkeep: reconnect if dropped, otherwise send a heartbeat */
function p2pKeep(peer) {
  if (peer.destroyed) return;
  if (peer.disconnected) { try { peer.reconnect(); } catch (e) { /* retried on the next tick */ } return; }
  try { if (peer.socket && peer.socket._sendHeartbeat) peer.socket._sendHeartbeat(); } catch (e) { /* private API changed */ }
}

/* shared presence table + onPeers bookkeeping */
function p2pTable() {
  const T = { me: '', tab: {}, fns: [], prev: new Set() };
  T.merge = (id, patch) => {
    const p = T.tab[id] || (T.tab[id] = {});
    for (const k in patch) { if (patch[k] === null) delete p[k]; else p[k] = patch[k]; }
  };
  T.list = () => Object.keys(T.tab).map((id) => ({ peer: id, presence: T.tab[id], sameTab: id === T.me, isMe: id === T.me, guest: false, kind: 'viewer', by: null }));
  T.notify = () => {
    const peers = T.list(), now = new Set(peers.map((p) => p.peer));
    const joined = peers.filter((p) => !T.prev.has(p.peer)), left = [...T.prev].filter((id) => !now.has(id)).map((id) => ({ peer: id }));
    T.prev = now;
    for (const fn of T.fns.slice()) try { fn({ peers, joined, left }); } catch (e) { console.error(e); }
  };
  T.api = (extra) => Object.assign({
    onPeers(fn) { T.fns.push(fn); setTimeout(() => fn({ peers: T.list(), joined: T.list(), left: [] }), 0); return () => { T.fns = T.fns.filter((f) => f !== fn); }; },
    peers() { return T.list(); },
  }, extra);
  return T;
}
const okPresence = (p) => p && typeof p === 'object' && !Array.isArray(p) && JSON.stringify(p).length < 6000;

async function p2pHost(name) {
  const ice = await iceServers();
  return new Promise((resolve, reject) => {
    const T = p2pTable(), conns = new Map(), rc = new Map(), base = RELAY_ROOT + name + '/';
    const peer = new Peer(P2P_PREFIX + name, { debug: 0, config: { iceServers: ice } });
    let opened = false, queued = false, rT = 0, rTimer = null, rDue = false, relay = null, slowV = 0, rSlowV = -1;
    const tabMsg = () => ({ t: 'tab', hid: T.me, host: slowPart(T.tab[T.me] || {}), ids: Object.keys(T.tab) });
    // at most one relayed message per RELAY_GAP; a skipped one goes out with the next change or tick
    // (a timer alone stalls for up to a minute in a background tab). The game state rides along every time,
    // the rest of the host's presence only when it changed, plus a refresh from keepAlive
    const relayOut = () => {
      if (!rc.size || !relay) return;
      const wait = RELAY_GAP - (Date.now() - rT);
      if (wait > 0) { rDue = true; if (!rTimer) rTimer = setTimeout(() => { rTimer = null; if (rDue) relayOut(); }, wait); return; }
      rT = Date.now(); rDue = false;
      const me = T.tab[T.me] || {}, msg = { t: 'tab', hid: T.me, ids: Object.keys(T.tab) };
      if (rSlowV !== slowV) { msg.host = slowPart(me); rSlowV = slowV; }
      if (me[FAST_KEY]) msg.s = me[FAST_KEY];
      for (const b of new Set([...rc.values()].map((v) => v.b))) relay.send(b, base + 'c', msg);
    };
    const flush = () => {
      queued = false;
      const msg = tabMsg();
      for (const c of conns.values()) if (c.open) try { c.send(msg); } catch (e) { /* closing */ }
      relayOut();
    };
    // out = membership or the host's own (slow) presence changed; client input changes stay on the host
    const changed = (out) => { if (out) slowV++; if (out && !queued) { queued = true; queueMicrotask(flush); } else if (rDue) relayOut(); T.notify(); };
    // game state: the fast channel when the client has answered on it, else the reliable one
    const sendFast = (s) => {
      let str = null;
      for (const c of conns.values()) {
        if (!c.open) continue;
        const d = c.pdmFast;
        if (d && c.pdmFastOk && d.readyState === 'open') { if (d.bufferedAmount < FAST_BUF) try { d.send(str || (str = JSON.stringify({ t: 's', s }))); } catch (e) { /* closing */ } }
        else try { c.send({ t: 's', s }); } catch (e) { /* closing */ }
      }
      relayOut();
    };
    // a client is gone only when neither link has it; a short grace lets it switch links without losing its seat
    const gone = (id) => setTimeout(() => { if (!conns.has(id) && !rc.has(id) && T.tab[id]) { plog('gone', id); delete T.tab[id]; changed(true); } }, 4000);
    const start = (id) => { if (opened) return; opened = true; T.me = id; T.tab[id] = T.tab[id] || {}; resolve(api); };
    relay = relayLink(base + 'h', (m, b) => {
      if (!m || typeof m.f !== 'string' || m.f.length > 80 || m.f === T.me) return;
      // a client timing each broker: answer at once, on the same broker
      if (typeof m.ping === 'number') { relay.send(b, base + 'c', { t: 'pong', to: m.f, ping: m.ping }); return; }
      if (m.bye) { if (rc.delete(m.f)) { plog('relay bye', m.f); gone(m.f); } return; }
      if (!okPresence(m.p)) return;
      const fresh = !rc.has(m.f) || !T.tab[m.f];
      if (fresh) { plog('relay client', m.f, 'via', b); rSlowV = -1; }
      rc.set(m.f, { b, seen: Date.now() });
      T.tab[m.f] = m.p; // relayed clients always send their whole presence
      changed(fresh);
      if (fresh) relayOut();
    });
    peer.on('open', (id) => start(id));
    peer.on('error', (e) => {
      if (opened) return;
      if (e.type === 'unavailable-id') { relay.close(); reject(e); return; } // code taken: try another
      // broker unreachable: the room still works through the relay alone
      const t0 = Date.now(), wait = () => { if (relay.up.size) start(P2P_PREFIX + name); else if (relay.failed || Date.now() - t0 > 8000) { relay.close(); reject(e); } else setTimeout(wait, 300); };
      wait();
    });
    peer.on('disconnected', () => { if (!peer.destroyed) try { peer.reconnect(); } catch (e) { /* broker gone; open data channels keep working */ } });
    peer.on('connection', (c) => {
      c.on('open', () => {
        conns.set(c.peer, c); T.tab[c.peer] = T.tab[c.peer] || {};
        c.pdmFast = openFast(c, (m) => { if (m && m.t === 'fh') c.pdmFastOk = true; });
        changed(true);
      });
      c.on('data', (m) => { if (m && m.t === 'p' && okPresence(m.patch)) { T.merge(c.peer, m.patch); changed(false); } });
      const drop = () => { if (conns.get(c.peer) === c) { conns.delete(c.peer); gone(c.peer); } if (c.pdmFast) try { c.pdmFast.close(); } catch (e) { /* gone */ } };
      c.on('close', drop); c.on('error', drop);
    });
    const api = T.api({
      presence(patch) {
        T.merge(T.me, patch);
        if (Object.keys(patch).some((k) => k !== FAST_KEY)) changed(true);
        if (patch[FAST_KEY]) sendFast(patch[FAST_KEY]);
        return Promise.resolve();
      },
      leave() { peer.destroy(); relay.close(); clearTimeout(rTimer); return Promise.resolve(); },
      keepAlive() {
        p2pKeep(peer);
        // relayed clients send a heartbeat every few seconds; forget the silent ones, and remind the rest we are here
        const now = Date.now();
        for (const [id, v] of rc) if (now - v.seen > 12000) { plog('relay silent', id); rc.delete(id); gone(id); }
        if (rc.size) { rT = 0; rSlowV = -1; relayOut(); }
      },
      tick() { if (rDue) relayOut(); },
    });
  });
}

/* client: finds the host through the broker and opens a data channel to it; falls back to the relay.
   onStatus: 'connecting' | 'ok' | 'ok-relay' | 'no-room' (no such host) | 'no-link' (host found, no link) | 'no-broker' | 'lost' */
async function p2pClient(name, onStatus) {
  const ice = await iceServers();
  return new Promise((resolve, reject) => {
    const T = p2pTable(), base = RELAY_ROOT + name + '/', myId = P2P_PREFIX + 'c-' + randId(10);
    const peer = new Peer(myId, { debug: 0, config: { iceServers: ice } });
    let opened = false, conn = null, tries = 0, linked = null, linkT = null, ended = false, left = false;
    let unavailable = false, brokerDown = false, directDone = false;
    let relay = null, relayB = -1, relaySeen = 0, relayUpAt = 0, relayAt = 0, helloT = null, relaySendT = null, relayLastSend = 0, relayDue = false, relayT = null, lostT = null;
    const rtt = {}; let switchAt = 0; // broker → smoothed round trip through it (ms)
    const status = (st) => { if (left) return; plog('status', st); try { onStatus(st); } catch (e) { console.error(e); } };
    // host messages: 'tab' = members, plus the host's presence when it changed and/or its game state; 's' = game state alone
    const onTab = (m) => {
      if (!m || m.t !== 'tab' || !Array.isArray(m.ids) || typeof m.hid !== 'string') return;
      const mine = T.tab[T.me], old = T.tab, tab = {}, oldHost = old[m.hid] || {};
      for (const id of m.ids) if (typeof id === 'string') tab[id] = id === T.me ? mine : (old[id] || {});
      const host = m.host && typeof m.host === 'object' ? Object.assign({}, m.host) : Object.assign({}, oldHost);
      if (oldHost[FAST_KEY]) host[FAST_KEY] = oldHost[FAST_KEY];
      if (m.s && zOf(m.s) > zOf(host[FAST_KEY])) host[FAST_KEY] = m.s;
      tab[m.hid] = host; tab[T.me] = mine; T.hid = m.hid; T.tab = tab; T.notify();
    };
    // the fast channel is unordered: a late, older state is dropped
    const onFast = (m) => {
      const h = m && m.t === 's' && m.s && T.hid && T.tab[T.hid];
      if (!h || zOf(m.s) <= zOf(h[FAST_KEY])) return;
      h[FAST_KEY] = m.s; T.notify();
    };
    const link = (how) => {
      clearTimeout(lostT);
      if (linked === how) return;
      const first = !linked; linked = how; clearTimeout(linkT);
      if (how === 'direct') clearTimeout(relayT);
      if (how === 'direct' && relay) {
        // tell the host after a moment, so it never sees us gone in between
        const r = relay, b = relayB; setTimeout(() => { if (linked === 'direct') { r.send(b, base + 'h', { f: T.me, bye: 1 }); r.close(); if (relay === r) { relay = null; relayB = -1; } } }, 2500);
      }
      if (first || how === 'direct') status(how === 'direct' ? 'ok' : 'ok-relay');
    };
    // nothing worked: tell the game why (called whenever a path fails)
    const decide = () => {
      if (linked || ended) return;
      // the relay has failed when no broker could be reached, or the brokers are up but no host answered
      const now = Date.now(), relayDead = !relay || relay.failed || (relayUpAt ? now - relayUpAt > 4500 : now - relayAt > 10000);
      if (!relayDead || !(unavailable || directDone || brokerDown)) return;
      ended = true; clearInterval(helloT);
      status(unavailable || (relay && relay.up.size) ? 'no-room' : brokerDown ? 'no-broker' : 'no-link');
    };
    const sendRelay = () => {
      if (!relay || relayB < 0) return;
      relayLastSend = Date.now(); relayDue = false; relay.send(relayB, base + 'h', { f: T.me, p: T.tab[T.me] || {} });
    };
    // at most 10 sends a second; a skipped change goes out with the next one (or the timer, when nothing follows)
    const queueRelay = () => {
      if (Date.now() - relayLastSend >= 100) { sendRelay(); return; }
      relayDue = true;
      if (!relaySendT) relaySendT = setTimeout(() => { relaySendT = null; if (relayDue) sendRelay(); }, 100);
    };
    // time the round trip through every broker; move to a clearly faster one (the host follows where we send)
    const pingRelay = () => { if (!relay) return; const t = Math.round(performance.now()); for (const b of relay.up) relay.send(b, base + 'h', { f: T.me, ping: t }); };
    const gotPong = (b, t) => {
      const ms = performance.now() - t; if (!(ms >= 0 && ms < 10000)) return;
      rtt[b] = rtt[b] === undefined ? ms : rtt[b] * 0.6 + ms * 0.4;
      if (relayB < 0 || b === relayB || linked !== 'relay' || Date.now() - switchAt < 3000) return;
      const cur = rtt[relayB] === undefined ? Infinity : rtt[relayB];
      if (relay.up.has(b) && rtt[b] < cur - 25) {
        plog('relay faster', relayB, Math.round(cur), '->', b, Math.round(rtt[b]));
        relayB = b; switchAt = Date.now(); sendRelay();
      }
    };
    const startRelay = () => {
      if (relay || ended || left || linked === 'direct') return;
      clearTimeout(relayT); relayAt = Date.now();
      relay = relayLink(base + 'c', (m, b) => {
        if (!m) return;
        if (m.t === 'pong') { if (m.to === T.me && typeof m.ping === 'number') gotPong(b, m.ping); return; }
        if (m.t !== 'tab') return;
        if (relayB < 0) { relayB = b; switchAt = Date.now(); plog('relay host via', b); sendRelay(); pingRelay(); }
        if (b !== relayB) return;
        relaySeen = Date.now();
        if (linked !== 'direct') { link('relay'); onTab(m); }
      });
      // hello on every broker until the host answers on one of them
      const hello = () => { if (relayB >= 0 || !relay) return; for (const b of relay.up) relay.send(b, base + 'h', { f: T.me, p: T.tab[T.me] || {} }); };
      relay.onUp = (b) => { if (!relayUpAt) relayUpAt = Date.now(); hello(); if (relayB === b) sendRelay(); };
      helloT = setInterval(() => { hello(); decide(); }, 1500);
    };
    const connect = () => {
      if (peer.destroyed || linked === 'direct') return;
      tries++; if (!linked) status('connecting');
      if (conn) try { conn.close(); } catch (e) { /* already gone */ }
      const c = conn = peer.connect(P2P_PREFIX + name, { reliable: true, serialization: 'json' });
      let fastOk = false;
      c.on('open', () => {
        if (conn !== c) return;
        link('direct'); c.send({ t: 'p', patch: T.tab[T.me] });
        // the fast channel: say hello until the host's first state comes through it
        const d = c.pdmFast = openFast(c, (m) => { fastOk = true; if (conn === c && linked === 'direct') onFast(m); });
        let n = 0;
        const hi = () => {
          if (!d || fastOk || n++ > 25 || conn !== c || d.readyState === 'closed' || d.readyState === 'closing') return;
          if (d.readyState === 'open') try { d.send('{"t":"fh"}'); } catch (e) { /* closing */ }
          setTimeout(hi, 400);
        };
        hi();
      });
      c.on('data', (m) => { if (conn !== c || linked !== 'direct') return; if (m && m.t === 's') onFast(m); else onTab(m); });
      c.on('close', () => {
        if (c.pdmFast) try { c.pdmFast.close(); } catch (e) { /* gone */ }
        if (conn !== c || linked !== 'direct' || left) return;
        plog('direct closed');
        // direct link dropped mid-game: carry on through the relay if it can be reached
        linked = null; conn = null; startRelay();
        lostT = setTimeout(() => { if (!linked) { T.tab = { [T.me]: T.tab[T.me] }; T.notify(); status('lost'); } }, 10000);
      });
      c.on('error', () => { /* handled by the open timeout */ });
      // the host was found but the channel did not open (slow or strict network): try again, then leave it to the relay
      clearTimeout(linkT);
      linkT = setTimeout(() => { if (linked === 'direct' || peer.destroyed || conn !== c) return; startRelay(); if (tries < 3) connect(); else { directDone = true; decide(); } }, 7000);
    };
    peer.on('open', (id) => {
      if (opened) return; opened = true; T.me = id; T.tab = { [id]: T.tab[id] || {} };
      if (FORCE_RELAY) { directDone = true; startRelay(); } else connect();
      resolve(api);
    });
    peer.on('error', (e) => {
      plog('peer error', e.type);
      if (linked === 'direct') return;
      if (e.type === 'peer-unavailable') {
        // the broker does not know this host: wrong code, or the host's phone dropped the broker for a moment
        unavailable = true; clearTimeout(linkT); startRelay(); decide();
      } else if (['network', 'server-error', 'socket-error', 'socket-closed', 'unavailable-id'].includes(e.type)) {
        brokerDown = true; startRelay();
        if (!opened) { opened = true; T.me = myId; T.tab = { [myId]: {} }; resolve(api); }
        decide();
      }
    });
    peer.on('disconnected', () => { if (!peer.destroyed) try { peer.reconnect(); } catch (e) { /* data channel may still be up */ } });
    if (!FORCE_RELAY) relayT = setTimeout(startRelay, RELAY_AFTER);
    const api = T.api({
      presence(patch) {
        T.merge(T.me, patch);
        if (linked === 'direct' && conn && conn.open) try { conn.send({ t: 'p', patch }); } catch (e) { /* closing */ }
        else if (linked === 'relay') queueRelay();
        return Promise.resolve();
      },
      leave() {
        ended = left = true; clearTimeout(linkT); clearTimeout(relayT); clearTimeout(lostT); clearInterval(helloT); clearTimeout(relaySendT);
        if (relay) { if (relayB >= 0) relay.send(relayB, base + 'h', { f: T.me, bye: 1 }); const r = relay; setTimeout(() => r.close(), 300); }
        peer.destroy(); return Promise.resolve();
      },
      tick() { if (relayDue && linked === 'relay' && Date.now() - relayLastSend >= 100) sendRelay(); },
      keepAlive() {
        p2pKeep(peer);
        if (linked !== 'relay') return;
        sendRelay(); pingRelay(); // heartbeat
        if (Date.now() - relaySeen > 15000) { plog('relay host silent', Date.now() - relaySeen); linked = null; T.tab = { [T.me]: T.tab[T.me] }; T.notify(); status('lost'); }
      },
      // how this client reaches the host, for the HUD: 'direct' | 'fast' (direct + fast channel) | 'relay'
      link() { return linked === 'direct' ? (conn && conn.pdmFast && conn.pdmFast.readyState === 'open' ? 'fast' : 'direct') : linked; },
    });
  });
}
