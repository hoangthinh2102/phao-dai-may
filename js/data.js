'use strict';
/* ===== Pháo Đài Mây — data: rules, heroes, shells, skills, items ===== */

const W = 2400, H = 1300;
const CELL = 2, TW = W / CELL, TH = H / CELL;
const GRAV = 900;          // px/s²
const POWER_K = 14.2;      // launch speed = power × POWER_K
const WIND_K = 26;         // horizontal accel per wind unit
const WIND_MAX = 2;        // wind stays within ±2 and drifts a little every turn
const TURN_TIME = 20;      // seconds per turn
const BANK_TIME = 60;      // extra thinking time per player for the whole match
const STAMINA = 150;      // per turn: walking, shells, skills and tools all draw from it
const WALK_ST = 0.25;      // stamina per px walked (a full bar walks 600px)
const SUDDEN_ROUND = 10;   // water starts rising from this round
const BODY_R = 20, BODY_H = 44;
const UNIT = 100;          // 1 "ô" = 100px, used for distance read-outs and the power formula
const FLY_CD = 3;          // turns between two flights
const TEAM_COL = ['#3d8ef0', '#ff7a45'];
const TEAM_DARK = ['#1f5fbf', '#cf5520'];
const TEAM_LIGHT = ['#d9e9ff', '#ffe2d3'];
const TEAM_NAME = ['Đội Xanh', 'Đội Cam'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- status effects (durations in rounds) ---------- */
const STATUS = {
  wet: { name: 'Ướt', icon: '💧', col: '#4fb3ff', desc: 'Trúng Sét chịu ×1.8 sát thương. Trúng Lửa thì bốc hơi, không bị cháy.' },
  frozen: { name: 'Đóng Băng', icon: '🧊', col: '#9fe6ff', desc: 'Không di chuyển được ở lượt kế. Vụ nổ kế tiếp gây ×1.5 (Vỡ Băng).' },
  burn: { name: 'Cháy', icon: '🔥', col: '#ff7a2c', desc: 'Mất máu đầu mỗi vòng. Dội Nước để dập lửa.' },
  mark: { name: 'Bị Đánh Dấu', icon: '🎯', col: '#ff4d6d', desc: 'Nhận thêm 25% sát thương từ mọi nguồn.' },
  stun: { name: 'Choáng', icon: '💫', col: '#ffd43b', desc: 'Lượt kế không di chuyển được, lực bắn bị lệch nhẹ và phải đi cuối đội. Sau đó miễn choáng 2 vòng.' },
};
const FALL_SAFE = 300;      // falls shorter than this are free
const FALL_DMG = 0.9;       // damage per px beyond FALL_SAFE
const FALL_MAX = 350;

/* ---------- shells (kind drives the physics) ---------- */
const SHELLS = {
  cannon: { name: 'Đạn Pháo', icon: '💣', st: 0, kind: 'std', dmg: 220, r: 55, delay: 100, col: '#ffb347', desc: 'Đạn tiêu chuẩn: nổ mạnh, khoét hố vừa.' },
  cluster: { name: 'Đạn Chùm', icon: '🎆', st: 20, kind: 'split', dmg: 105, r: 40, delay: 130, col: '#ffd166', desc: 'Tới đỉnh quỹ đạo thì tách 3 viên, phủ rộng.' },
  drill: { name: 'Đạn Khoan', icon: '🔩', st: 30, kind: 'drill', dmg: 240, r: 50, drill: 150, delay: 140, col: '#c0c6d6', desc: 'Khoan xuyên đất tới 150px rồi mới nổ. Khắc tinh của kẻ núp hầm.' },
  bouncer: { name: 'Đá Nảy', icon: '🪨', st: 15, kind: 'bounce', dmg: 170, r: 45, bounces: 2, delay: 110, col: '#b9a48a', desc: 'Nảy 2 lần trên mặt đất trước khi nổ. Lăn được vào góc khuất.' },
  hammer: { name: 'Búa Đá', icon: '🔨', st: 0, kind: 'std', dmg: 150, r: 45, delay: 120, col: '#d9c7a3', status: ['stun', 1], desc: 'Nện trúng thì gây Choáng: lượt kế không đi được, lực bị lệch và phải đi cuối đội.' },
  mound: { name: 'Đạn Lũy', icon: '⛰️', st: 15, kind: 'mound', dmg: 60, r: 70, delay: 90, col: '#c98b4f', desc: 'Đắp ụ đất nơi đạn rơi: dựng tường che hoặc lấp hố cho đồng đội.' },
  gravity: { name: 'Đạn Hấp Lực', icon: '🌀', st: 25, kind: 'gravity', dmg: 100, r: 50, pull: 140, delay: 120, col: '#a78bfa', desc: 'Hút kẻ địch gần đó về tâm nổ. Kéo chúng ra mép đảo!' },
  heal: { name: 'Hạt Hồi Sinh', icon: '🌱', st: 0, kind: 'heal', heal: 190, dmg: 40, r: 95, delay: 90, col: '#7ee081', noCrater: true, desc: 'Hồi 190 máu cho đồng đội trong vùng, gây chút sát thương cho địch.' },
  water: { name: 'Bong Bóng Nước', icon: '🫧', st: 10, kind: 'std', dmg: 80, r: 65, delay: 100, col: '#5ab8ff', status: ['wet', 2], small: true, desc: 'Làm Ướt kẻ địch 2 vòng và dập lửa. Mở combo cho Sét.' },
  portal: { name: 'Hạt Dịch Chuyển', icon: '✨', st: 35, kind: 'portal', dmg: 0, r: 0, delay: 150, col: '#f9a8d4', desc: 'Dịch chuyển bản thân tới nơi hạt rơi.' },
  bolt: { name: 'Cầu Sét', icon: '⚡', st: 0, kind: 'std', dmg: 190, r: 45, delay: 110, col: '#ffe066', nowind: true, elec: true, desc: 'Không bị gió ảnh hưởng. Trúng mục tiêu Ướt gây ×1.8.' },
  ice: { name: 'Băng Tiễn', icon: '❄️', st: 20, kind: 'std', dmg: 120, r: 35, delay: 110, col: '#9fe6ff', status: ['frozen', 1], desc: 'Đóng Băng mục tiêu 1 vòng: không đi được, nổ kế tiếp ×1.5.' },
  beam: { name: 'Tia Chớp', icon: '🌩️', st: 30, kind: 'beam', dmg: 170, r: 22, range: 850, delay: 120, col: '#fff3a0', elec: true, desc: 'Bắn thẳng, không rơi, xuyên nhiều kẻ địch. Tầm 850.' },
  fire: { name: 'Đạn Lửa', icon: '🔥', st: 0, kind: 'std', dmg: 150, r: 50, delay: 110, col: '#ff7a2c', status: ['burn', 3], desc: 'Gây Cháy 3 vòng (40 máu mỗi vòng).' },
  sticky: { name: 'Bom Dính', icon: '🧨', st: 30, kind: 'sticky', dmg: 300, r: 80, delay: 150, col: '#ff4d6d', desc: 'Dính vào đất hoặc kẻ địch, phát nổ lớn khi bắt đầu vòng sau.' },
  fly: { name: 'Bay', icon: '🪽', st: 40, kind: 'fly', dmg: 0, r: 0, delay: 120, col: '#ffffff', desc: 'Cưỡi mây bay theo quỹ đạo đạn và đáp xuống nơi đạn rơi. Thay cho lượt bắn, hồi ' + 3 + ' lượt. Bay ra ngoài đảo là rơi xuống nước!' },
  marker: { name: 'Đạn Đánh Dấu', icon: '🎯', st: 10, kind: 'std', dmg: 60, r: 30, delay: 80, col: '#ff8fab', status: ['mark', 2], small: true, desc: 'Đánh Dấu 2 vòng: mục tiêu nhận thêm 25% sát thương.' },
};

const SKILLS = {
  scope: { name: 'Ống Ngắm', icon: '🔭', st: 20, cd: 3, desc: 'Hiện toàn bộ đường bay trong lượt này.' },
  stoneShield: { name: 'Khiên Đá', icon: '🛡️', st: 30, cd: 3, desc: 'Bọc khiên 250 cho đồng đội ít máu nhất trong tầm 450 (gồm bản thân).' },
  barricade: { name: 'Dựng Ụ Gỗ', icon: '🪵', st: 25, cd: 3, desc: 'Dựng bức tường gỗ ngay trước mặt để chắn đạn.' },
  calm: { name: 'Hô Phong', icon: '🍃', st: 20, cd: 3, desc: 'Lặng gió cho phát bắn của bạn trong lượt này.' },
  leap: { name: 'Nhảy Vọt', icon: '🐾', st: 30, cd: 2, desc: 'Bật nhảy thật xa về phía trước.' },
};

const ULTS = {
  barrage: { name: 'Mưa Pháo', icon: '☄️', delay: 60, desc: 'Bắn liên tiếp 5 quả pháo với lực dao động quanh lực bạn chọn.' },
  quake: { name: 'Động Đất', icon: '🌋', delay: 60, desc: 'Đất dưới chân mọi kẻ địch sụp xuống, gây 140 sát thương.' },
  bloom: { name: 'Mưa Lành', icon: '🌸', delay: 60, desc: 'Hồi 35% máu tối đa và giải mọi hiệu ứng xấu cho cả đội.' },
  thunder: { name: 'Thiên Lôi', icon: '🌩️', delay: 60, desc: 'Sét đánh xuống mọi kẻ địch: 150 sát thương, ×2 nếu đang Ướt.' },
  phoenix: { name: 'Phượng Hoàng', icon: '🐦‍🔥', delay: 60, desc: 'Thả phượng lửa tự bay tới kẻ địch gần nhất: 280 sát thương và gây Cháy.' },
};

const HERO_KEYS = ['bombi', 'thachgiap', 'moclan', 'loivu', 'hoamieu'];
const HEROES = {
  bombi: {
    name: 'Bom Bi', role: 'Pháo Thủ', hp: 1000, speed: 95,
    color: '#ff9f43', dark: '#b8661a', light: '#ffe0b3', accent: '#3a3a4a',
    tag: 'Nhiều loại đạn phá hầm, càng bắn trúng càng đau.',
    passive: { name: 'Thợ Săn', desc: 'Trúng cùng một kẻ địch nhiều lượt liên tiếp: +15% sát thương mỗi lần, tối đa +45%.' },
    shells: ['cannon', 'cluster', 'drill'], skill: 'scope', ult: 'barrage',
    stats: { atk: 5, def: 2, ctrl: 2, sup: 1, easy: 5 },
  },
  thachgiap: {
    name: 'Thạch Giáp', role: 'Đỡ Đòn', hp: 1500, speed: 75,
    color: '#9c8f7e', dark: '#5f5446', light: '#d8cfc2', accent: '#66d9a8',
    tag: 'Lì đòn, đắp ụ, hút kẻ địch ra mép vực.',
    passive: { name: 'Vững Chãi', desc: 'Không bị hất văng. Nhận ít hơn 20% sát thương từ vụ nổ và một nửa sát thương khi rơi.' },
    shells: ['hammer', 'mound', 'gravity'], skill: 'stoneShield', ult: 'quake',
    stats: { atk: 2, def: 5, ctrl: 4, sup: 3, easy: 3 },
  },
  moclan: {
    name: 'Mộc Lan', role: 'Hỗ Trợ', hp: 950, speed: 95,
    color: '#7cc576', dark: '#3f7f3f', light: '#e7f7d9', accent: '#ff8fbf',
    tag: 'Hồi máu, dựng chướng ngại, dịch chuyển đồng đội vào thế.',
    passive: { name: 'Sức Sống', desc: 'Đầu lượt của Mộc Lan, đồng đội trong tầm 300 hồi 60 máu.' },
    shells: ['heal', 'water', 'portal'], skill: 'barricade', ult: 'bloom',
    stats: { atk: 1, def: 3, ctrl: 3, sup: 5, easy: 4 },
  },
  loivu: {
    name: 'Lôi Vũ', role: 'Pháp Sư Sét', hp: 900, speed: 90,
    color: '#5b8cff', dark: '#2a4fb0', light: '#dbe6ff', accent: '#ffe066',
    tag: 'Sét không sợ gió, đóng băng, combo cực mạnh với Nước.',
    passive: { name: 'Dẫn Điện', desc: 'Đạn Sét lan sang 1 kẻ địch khác trong tầm 220, gây 40% sát thương.' },
    shells: ['bolt', 'ice', 'beam'], skill: 'calm', ult: 'thunder',
    stats: { atk: 4, def: 1, ctrl: 5, sup: 2, easy: 3 },
  },
  hoamieu: {
    name: 'Hỏa Miêu', role: 'Sát Thủ Lửa', hp: 900, speed: 105,
    color: '#ff5d73', dark: '#b3263c', light: '#ffd6dc', accent: '#ffb703',
    tag: 'Đốt dần, gài bom dính, đánh dấu con mồi cho cả đội.',
    passive: { name: 'Lửa Dai', desc: 'Cháy kéo dài thêm 1 vòng và đốt mạnh hơn 50%.' },
    shells: ['fire', 'sticky', 'marker'], skill: 'leap', ult: 'phoenix',
    stats: { atk: 5, def: 1, ctrl: 3, sup: 1, easy: 2 },
  },
};

/* ---------- crate items ---------- */
const ITEM_KEYS = ['power', 'double', 'medkit', 'shield', 'teleport'];
const ITEMS = {
  power: { name: 'Tăng Lực', icon: '💪', desc: '+40% sát thương cho phát bắn lượt này.' },
  double: { name: 'Bắn Đôi', icon: '✌️', desc: 'Phát bắn lượt này được bắn thêm 1 lần y hệt.' },
  medkit: { name: 'Hồi Máu', icon: '💗', desc: 'Hồi ngay 300 máu.' },
  shield: { name: 'Khiên Tạm', icon: '🔰', desc: 'Nhận khiên 200 tới khi bị phá.' },
  teleport: { name: 'Dịch Chuyển', icon: '🌀', desc: 'Phát bắn lượt này đưa bạn tới nơi đạn rơi.' },
};

const DIFF = [
  { name: 'Dễ', err: 9, angErr: 4, think: 1.8 },
  { name: 'Thường', err: 3, angErr: 1.5, think: 1.4 },
  { name: 'Khó', err: 1.5, angErr: 0.8, think: 1.0 },
];

/* combat tools, Gunny style: stack any of them in one turn as long as the stamina lasts.
   extra = rounds fired after the first on the same path, spread = angle offsets of a fan */
const TOOLS = {
  p1: { name: '+1 Đạn', icon: '➕1', key: '4', cost: 35, delay: 25, extra: 1, desc: 'Bắn thêm 1 loạt theo cùng quỹ đạo.' },
  p2: { name: '+2 Đạn', icon: '➕2', key: '5', cost: 60, delay: 45, extra: 2, desc: 'Bắn thêm 2 loạt theo cùng quỹ đạo, khoét hố sâu.' },
  x3: { name: 'x3 Tia', icon: '✳️', key: '6', cost: 50, delay: 40, spread: [-4, 0, 4], desc: 'Mỗi loạt thành 3 viên tỏa hình quạt (lệch ±4°), dễ trúng hơn.' },
};
const TOOL_KEYS = Object.keys(TOOLS);
const ROUND_MULT = [1, 0.65, 0.5, 0.42];   // damage of every shell by extra rounds (+1, +2, +1 +2)
const FAN_MULT = 0.55;                     // and again ×0.55 when x3 is on
/* what a set of tools does together: rounds × shells per round, damage of each shell */
function toolCombo(keys) {
  keys = (keys || []).filter((k) => TOOLS[k]);
  const extra = keys.reduce((s, k) => s + (TOOLS[k].extra || 0), 0), fan = keys.includes('x3');
  return { keys, extra, spread: fan ? TOOLS.x3.spread : null, n: (extra + 1) * (fan ? 3 : 1),
    mult: ROUND_MULT[extra] * (fan ? FAN_MULT : 1), delay: keys.reduce((s, k) => s + TOOLS[k].delay, 0), cost: keys.reduce((s, k) => s + TOOLS[k].cost, 0) };
}
const toolBlocked = (shellKey) => !shellKey || ['portal', 'fly', 'beam'].includes(SHELLS[shellKey].kind);

/* aim assist levels: arc = seconds of predicted path shown, hint = power hint on the bar, preset = click the bar to set power */
const ASSIST = [
  { name: 'Dễ', arc: 1.1, hint: 'wind', preset: true, speed: 36, desc: 'Gợi ý lực đã tính gió, gợi ý góc khi bị chắn, đường đạn dài. Bấm vào thanh lực để chọn lực chính xác.' },
  { name: 'Vừa', arc: 0.55, hint: 'calm', preset: false, speed: 52, desc: 'Gợi ý lực chưa tính gió (tự bù gió), gợi ý góc khi bị chắn, đường đạn ngắn.' },
  { name: 'Khó', arc: 0, hint: null, preset: false, speed: 52, desc: 'Tự tính góc và lực: không gợi ý, không đường đạn. Chỉ có thước đo, khoảng cách và dấu điểm rơi lượt trước.' },
];

/* ---------- maps ---------- */
/* pal: terrain colours · sky: background · liquid: what you fall into · decor: [type, weight] · big: large decor per island */
const MAPS = {
  /* special map for the company event: the Gamota tribe from "Thổ Thần Giao Tranh" */
  tho: {
    special: true, name: 'Thổ Thần Giao Tranh', icon: '🔥', layout: 'tribe', tagline: 'Bộ tộc Gamota',
    desc: 'Vùng đất của bộ tộc Gamota với lều da, lửa trại và Totem 12 tầng. Ai cũng khoác áo bộ lạc. Đứng cạnh anh em được thêm sát thương, bước vào cột sáng để nhận phước lành, và cứ 3 vòng tù và trận lại đổi gió.',
    rules: [['🤝', 'Có anh em', 'Bắn khi đứng gần đồng đội: +10% sát thương.'], ['🌈', 'Cột sáng', 'Mỗi vòng một cột sáng mọc lên. Bước vào để nhận phước lành theo màu.'], ['📯', 'Tù và trận', 'Cứ 3 vòng tù và vang lên, gió đổi chiều thật mạnh.']],
    pal: { top: '#ffd9a0', grass: '#f2b872', grassDk: '#d98f52', soil: '#c8643c', soilDk: '#7a2e1c', stone: '#b4553a', stoneDk: '#6e2a1e', wood: '#8a5a34', woodDk: '#4f2f18', mound: '#e8a868', scorch: '#3a1e16', band: '#ffe0b0', bandA: 0.18, stoneTop: '#e89a62', tribal: true, tri1: '#d8432f', tri2: '#fff0d6', tri3: '#2f8fd0' },
    sky: { stops: ['#4a2f86', '#c2569a', '#ff8f6a', '#ffd08a'], sun: { x: 0.74, y: 0.64, r: 0.09, col: '#ffe3a0', glow: '255,160,110' }, ridges: ['rgba(190,90,110,0.45)', 'rgba(140,60,90,0.6)'], far: ['rgba(150,70,100,0.45)', 'rgba(240,150,110,0.45)'], cloud: '255,190,178', cloudLit: '255,236,200', cloudShade: '150,78,138', cloudA: 0.8, tribe: true },
    liquid: { stops: ['rgba(255,170,120,0.85)', 'rgba(200,90,120,0.92)', '#4a1f4a'], foam: 'rgba(255,235,200,0.8)', fleck: 'rgba(255,240,210,0.4)', name: 'suối hoàng hôn' },
    decor: [['drygrass', 40], ['pebble', 20], ['deadbush', 10], ['cactus', 6], ['spear', 8], ['drum', 5], ['flag', 1.5], ['campfire', 4]], big: ['gate', 'teepee'], grassCol: '#c98a4a', ambient: 'ember',
  },
  may: {
    name: 'Đảo Mây', icon: '☁️', layout: 'islands', desc: 'Đảo cỏ nối bằng cầu gỗ dưới trời trong. Cân bằng, hợp để làm quen.',
    pal: { top: '#9be36e', grass: '#6fc24f', grassDk: '#4f9a3b', soil: '#c98e57', soilDk: '#8b5a35', stone: '#a29db1', stoneDk: '#7b7690', wood: '#c48a4e', woodDk: '#8a5a2c', mound: '#d19a62', scorch: '#4a3426', band: '#ffe6be', bandA: 0.18 },
    sky: { stops: ['#6fb6ff', '#a9d8ff', '#ffe1c4', '#ffc9a8'], sun: { x: 0.78, y: 0.2, r: 0.05, col: '#fff7d6', glow: '255,236,170' }, ridges: ['rgba(160,190,230,0.55)', 'rgba(140,175,215,0.6)'], far: ['rgba(160,180,215,0.42)', 'rgba(165,205,160,0.5)'], cloud: '255,255,255', cloudA: 1 },
    liquid: { stops: ['rgba(90,190,230,0.88)', 'rgba(50,140,200,0.95)', '#1d5f99'], foam: 'rgba(255,255,255,0.75)', fleck: 'rgba(255,255,255,0.35)', name: 'nước' },
    decor: [['tuft', 50], ['flower', 28], ['shroom', 7], ['pebble', 8], ['bush', 5.5], ['tree', 1.5]], big: 'tree', grassCol: '#5cae45',
  },
  sa: {
    name: 'Sa Mạc Hoàng Hôn', icon: '🏜️', layout: 'dunes', desc: 'Đồi cát dài và cột đá đỏ cao. Phải bắn vòng qua cột đá.',
    pal: { top: '#ffe6a8', grass: '#f6d087', grassDk: '#e8b86c', soil: '#eab673', soilDk: '#b8743f', stone: '#cf7f57', stoneDk: '#9a523a', wood: '#a8784a', woodDk: '#6e4a28', mound: '#ecc684', scorch: '#5a3a28', band: '#fff2cc', bandA: 0.28, stoneTop: '#e8a56e' },
    sky: { stops: ['#4f3f94', '#b9629a', '#ff9a68', '#ffd38c'], sun: { x: 0.7, y: 0.6, r: 0.085, col: '#ffe7a8', glow: '255,170,100' }, ridges: ['rgba(196,108,112,0.42)', 'rgba(160,84,98,0.55)'], far: ['rgba(150,82,104,0.42)', 'rgba(232,160,112,0.45)'], cloud: '255,206,196', cloudA: 0.7, mesas: true },
    liquid: { stops: ['rgba(84,204,190,0.9)', 'rgba(40,150,150,0.95)', '#145e66'], foam: 'rgba(240,255,250,0.75)', fleck: 'rgba(255,255,255,0.3)', name: 'hồ ốc đảo' },
    decor: [['drygrass', 42], ['pebble', 26], ['cactus', 20], ['deadbush', 12]], big: 'saguaro', grassCol: '#c9a25a', ambient: 'dust',
  },
  bang: {
    name: 'Băng Nguyên', icon: '❄️', layout: 'glacier', desc: 'Đảo băng dưới cực quang, nhiều nhũ băng treo và mỏm nhỏ dễ sụp.',
    pal: { top: '#ffffff', grass: '#eef7ff', grassDk: '#d2e6f7', soil: '#93bbdc', soilDk: '#4e7aa6', stone: '#bfe8ff', stoneDk: '#7db3de', wood: '#8a6a50', woodDk: '#5a4232', mound: '#dcedfb', scorch: '#3b4a63', band: '#eaf6ff', bandA: 0.3, stoneTop: '#f4fbff' },
    sky: { stops: ['#0b1a42', '#1b3272', '#3a5fa2', '#7fa6d8'], sun: { x: 0.22, y: 0.18, r: 0.035, col: '#f4f8ff', glow: '200,220,255' }, stars: 140, aurora: true, ridges: ['rgba(120,150,205,0.5)', 'rgba(88,118,176,0.62)'], far: ['rgba(120,150,205,0.38)', 'rgba(232,242,255,0.55)'], cloud: '190,206,236', cloudA: 0.5 },
    liquid: { stops: ['rgba(140,205,240,0.86)', 'rgba(58,108,172,0.95)', '#152c58'], foam: 'rgba(240,250,255,0.85)', fleck: 'rgba(255,255,255,0.4)', name: 'biển băng' },
    decor: [['snowtuft', 40], ['pebble', 20], ['crystal', 20], ['smallpine', 20]], big: 'pine', grassCol: '#9fc2df', ambient: 'snow',
  },
  nui: {
    name: 'Núi Lửa', icon: '🌋', layout: 'volcano', desc: 'Ngọn núi lửa giữa bản đồ chắn tầm bắn thẳng, bên dưới là dung nham.',
    pal: { top: '#958581', grass: '#74655f', grassDk: '#5a4c48', soil: '#4c3c3a', soilDk: '#2b2122', stone: '#3d3536', stoneDk: '#231d1f', wood: '#7a4a2c', woodDk: '#4a2a18', mound: '#6e5a52', scorch: '#1a1010', band: '#ff7a3a', bandA: 0.4, stoneTop: '#6a5c58' },
    sky: { stops: ['#240c18', '#561a20', '#a3351e', '#e8692c'], ridges: ['rgba(64,20,26,0.7)', 'rgba(40,12,16,0.82)'], far: ['rgba(72,26,30,0.55)', 'rgba(118,52,40,0.5)'], cloud: '96,64,64', cloudA: 0.38, glowLow: '255,120,40' },
    liquid: { stops: ['rgba(255,176,64,0.97)', 'rgba(232,82,20,0.98)', '#7a1a08'], foam: 'rgba(255,238,150,0.95)', fleck: 'rgba(255,230,120,0.55)', name: 'dung nham', lava: true },
    decor: [['ashtuft', 18], ['pebble', 36], ['vent', 14], ['deadbush', 18], ['crystal', 14]], big: 'deadtree', grassCol: '#8a7a74', ambient: 'ember',
  },
  phe: {
    name: 'Phế Tích Trên Mây', icon: '🏛️', layout: 'ruins', desc: 'Nhiều tầng bệ đá, cột cổ và cầu treo. Đánh theo chiều cao.',
    pal: { top: '#b2e07e', grass: '#84c466', grassDk: '#5f9c4e', soil: '#a8917c', soilDk: '#6b5848', stone: '#dcd2c2', stoneDk: '#a99b88', wood: '#b07a48', woodDk: '#74481f', mound: '#c6a47e', scorch: '#3d2f2a', band: '#fff3dd', bandA: 0.2, bricks: true, stoneTop: '#a9d07c' },
    sky: { stops: ['#4c5ad0', '#9a8fe6', '#f2b5d6', '#ffdab8'], sun: { x: 0.8, y: 0.3, r: 0.045, col: '#fff1e0', glow: '255,210,222' }, ridges: ['rgba(142,132,212,0.5)', 'rgba(120,110,190,0.56)'], far: ['rgba(140,130,200,0.42)', 'rgba(170,205,160,0.45)'], cloud: '255,240,250', cloudA: 0.85, columns: true },
    liquid: { stops: ['rgba(152,170,242,0.86)', 'rgba(98,108,210,0.95)', '#2b2f80'], foam: 'rgba(255,255,255,0.75)', fleck: 'rgba(255,255,255,0.35)', name: 'biển mây' },
    decor: [['tuft', 34], ['flower', 20], ['shroom', 14], ['bush', 10], ['column', 12], ['lantern', 10]], big: 'tree', grassCol: '#6fb352', ambient: 'petal',
  },
};
const MAP_KEYS = Object.keys(MAPS).filter((k) => !MAPS[k].special); // regular maps (also the random pool)
const SPECIAL_MAP = 'tho';
const ALL_MAPS = [SPECIAL_MAP].concat(MAP_KEYS);
/* Thổ Thần map: tribe look per hero (aura = the light pillar behind them in the event art) */
const TRIBE = {
  bombi: { aura: '#ffd23f', title: 'Tù Trưởng' },
  thachgiap: { aura: '#3f8cff', title: 'Chiến Binh Khiên' },
  moclan: { aura: '#ff6a4a', title: 'Nữ Pháp Sư' },
  loivu: { aura: '#3fd27a', title: 'Người Thổi Tù Và' },
  hoamieu: { aura: '#ff3f6a', title: 'Thợ Săn' },
};
/* blessing pillars on the Thổ Thần map: walk into one to take it */
const BLESS = [
  { name: 'Sức Mạnh', col: '#ff5a4a', desc: '+25% sát thương lượt này' },
  { name: 'Bảo Hộ', col: '#3f8cff', desc: 'Khiên 150' },
  { name: 'Hồi Sinh', col: '#3fd27a', desc: 'Hồi 150 máu' },
  { name: 'Hào Quang', col: '#ffd23f', desc: '+30 Nộ' },
];
const BRO_R = 160, BRO_MULT = 1.1, HORN_EVERY = 3;

/* hero flag bits (network + render) */
const F_BRO = 1 << 14, F_BLESS = 1 << 15; // Thổ Thần map buffs
const F_GROUND = 1, F_WALK = 2, F_SHIELD = 4, F_HURT = 8, F_CHARGE = 16, F_SCOPE = 32, F_CALM = 64, F_POWER = 128, F_DOUBLE = 256, F_TELE = 512, F_FLY = 1024;
const F_TOOL_SHIFT = 11; // bits 11-13: one bit per tool that is on (p1, p2, x3)
const toolBits = (keys) => (keys || []).reduce((b, k) => b | (1 << TOOL_KEYS.indexOf(k)), 0);
const bitsTools = (b) => TOOL_KEYS.filter((k, i) => b & (1 << i));
/* stamina a weapon slot costs when fired: 0-2 shells, 3 ult (paid with rage instead), 4 flight */
const selCost = (heroKey, sel) => (sel === 4 ? SHELLS.fly.st : sel === 3 ? 0 : SHELLS[HEROES[heroKey].shells[sel]].st);
const PK = ['cannon', 'cluster', 'drill', 'bouncer', 'mound', 'gravity', 'heal', 'water', 'portal', 'bolt', 'ice', 'beam', 'fire', 'sticky', 'marker', 'barrage', 'phoenix', 'hammer', 'fly'];
for (const k in SHELLS) SHELLS[k].key = k;
const EK = ['boom', 'heal', 'dmg', 'text', 'death', 'splash', 'zap', 'freeze', 'burn', 'mound', 'portal', 'beam', 'thunder', 'quake', 'shield', 'crate', 'pickup', 'fire', 'wall', 'bloom', 'stick', 'combo', 'turn', 'round', 'leap', 'shoot', 'bounce', 'ping', 'fall', 'stun', 'horn', 'bless', 'pillar', 'bro'];
