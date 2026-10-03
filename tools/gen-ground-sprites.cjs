// 지상전(정탑다운) 스프라이트 생성기 — 코드로 그린 도트 시트 (public/assets/img/gs_*.png)
//   SHARP_DIR=<sharp 폴더> node tools/gen-ground-sprites.cjs
// 1) assets-src/mvp/ 의 기준 시트(구르기·근접·던지기·총 4종·적 보병)를 우리 팔레트로 바꾸고 오른쪽 열만 잘라 쓴다.
// 2) 소총 시트를 바탕으로 레일 라이플 시트를, 보병 시트 색 변형으로 돌격병·저격수·헤비를 만든다.
// 3) 개·드론·포탑·보스·무기 겹침 장식(칼날·긴 총·방패)·소총 아이콘은 전부 코드로 새로 그린다.
// 규격: 한 프레임 = S×S 도트(월드 4배), 몸 중심 = 프레임 정중앙, 오른쪽(+x)을 향한 한 열만 두고 조준각으로 회전해서 쓴다.
const path = require('path');
const fs = require('fs');
let sharp;
try { sharp = require('sharp'); } catch (e) { sharp = require(require.resolve('sharp', { paths: [process.env.SHARP_DIR || process.cwd()] })); }
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets-src', 'mvp');
const OUT = path.join(ROOT, 'public', 'assets', 'img');
fs.mkdirSync(OUT, { recursive: true });
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ------------------------------------------------------------ 도트 캔버스
class Pix {
  constructor(w, h) { this.w = w; this.h = h; this.d = Buffer.alloc(w * h * 4); }
  set(x, y, c) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const i = (y * this.w + x) * 4, k = typeof c === 'string' ? hex(c) : c; this.d[i] = k[0]; this.d[i + 1] = k[1]; this.d[i + 2] = k[2]; this.d[i + 3] = 255; }
  get(x, y) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0; return this.d[(y * this.w + x) * 4 + 3]; }
  rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c); }
  disc(cx, cy, r, c) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) this.set(cx + x, cy + y, c); }
  ell(cx, cy, rx, ry, c) { for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x * x) / (rx * rx + 0.5) + (y * y) / (ry * ry + 0.5) <= 1) this.set(cx + x, cy + y, c); }
  line(x0, y0, x1, y1, c, t = 1) { const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx - dy, x = x0, y = y0; for (;;) { for (let a = 0; a < t; a++) for (let b = 0; b < t; b++) this.set(x + a - (t >> 1), y + b - (t >> 1), c); if (x === x1 && y === y1) break; const e2 = 2 * e; if (e2 > -dy) { e -= dy; x += sx; } if (e2 < dx) { e += dx; y += sy; } } }
  /** 바깥 윤곽선(검은 1픽셀)을 두른다 */
  outline(c = '#12160e') { const add = []; for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (!this.get(x, y) && (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1))) add.push([x, y]); for (const [x, y] of add) this.set(x, y, c); }
  blit(o, ox, oy) { for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) { const i = (y * o.w + x) * 4; if (o.d[i + 3]) this.set(ox + x, oy + y, [o.d[i], o.d[i + 1], o.d[i + 2]]); } }
}
async function writeSheet(name, frames, S, FW = S) {
  const sheet = new Pix(FW, S * frames.length);
  frames.forEach((f, i) => sheet.blit(f, 0, i * S));
  const file = path.join(OUT, name + '.png');
  await sharp(sheet.d, { raw: { width: sheet.w, height: sheet.h, channels: 4 } }).png({ compressionLevel: 9 }).toFile(file);
  console.log(name.padEnd(16), `${sheet.w}x${sheet.h}`, (fs.statSync(file).size / 1024).toFixed(1) + 'KB');
}

// ------------------------------------------------------------ 1) 기준 시트 재채색
async function loadRaw(file) { const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; }
/** 팔레트 교체: map = { '#rrggbb': '#rrggbb' } (정확히 일치하는 색만) */
function recolor(img, map) {
  const m = new Map(Object.entries(map).map(([a, b]) => [hex(a).join(','), hex(b)]));
  const out = Buffer.from(img.data);
  for (let i = 0; i < img.w * img.h; i++) { if (out[i * 4 + 3] < 128) { out[i * 4 + 3] = 0; continue; } const k = `${out[i * 4]},${out[i * 4 + 1]},${out[i * 4 + 2]}`, r = m.get(k); if (r) { out[i * 4] = r[0]; out[i * 4 + 1] = r[1]; out[i * 4 + 2] = r[2]; } out[i * 4 + 3] = 255 * (out[i * 4 + 3] >= 128 ? 1 : 0); }
  return { data: out, w: img.w, h: img.h };
}
/** 시트에서 오른쪽(1번) 열의 프레임들을 Pix 배열로 */
function rightColumn(img, S) {
  const rows = img.h / S, frames = [];
  for (let r = 0; r < rows; r++) { const p = new Pix(S, S); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = ((r * S + y) * img.w + (S + x)) * 4; if (img.data[i + 3] > 127) p.set(x, y, [img.data[i], img.data[i + 1], img.data[i + 2]]); } frames.push(p); }
  return frames;
}
// 플레이어: 초록 군복 → 건메탈(주인공 파일럿의 어두운 강화복) , 총·피부·화염은 그대로
const HERO = { '#485e34': '#3e4656', '#586c3e': '#4f5a6e', '#3e502c': '#2d3342', '#7a9258': '#7e8aa4' };
// 적: 붉은 보병 → 변형 (몸 3색 + 강조 2색)
const FOE = {
  rifle: {},
  charger: { '#802e28': '#9a5a1c', '#960e14': '#d9801a', '#ce3430': '#ffb040', '#581e1c': '#5e3410', '#68080e': '#8a4a0c' },
  sniper: { '#802e28': '#2c4a80', '#960e14': '#3c6ad0', '#ce3430': '#7aa8ff', '#581e1c': '#1c2e52', '#68080e': '#223a78' },
  heavy: { '#802e28': '#5a6272', '#960e14': '#7e8aa0', '#ce3430': '#c0cad8', '#581e1c': '#363c48', '#68080e': '#4a5262' },
};

// ------------------------------------------------------------ 3) 새로 그리는 스프라이트
const C = { out: '#12160e', steel: '#5e6877', steelD: '#3a414d', steelL: '#8a92a2', dark: '#20242c', red: '#ff2a2a', redL: '#ff9a9a', flash: '#ffe27a', orange: '#ff9628' };
function dogFrame(kind) {   // 32×32, 오른쪽을 본다
  const p = new Pix(32, 32), base = '#8a6034', shade = '#5f3f20', light = '#b08050';
  const legs = { idle: [[19, 11, 19, 21, 9, 11, 9, 21]], run_a: [[23, 10, 23, 22, 6, 12, 6, 20]], run_b: [[17, 12, 17, 20, 11, 10, 11, 22]], bite: [[21, 11, 21, 21, 8, 11, 8, 21]], hit: [[19, 11, 19, 21, 9, 11, 9, 21]] }[kind] ?? [[19, 11, 19, 21, 9, 11, 9, 21]];
  if (kind === 'dead') {
    p.ell(15, 16, 9, 4, shade); p.ell(15, 16, 8, 3, base); p.disc(6, 19, 3, base); p.rect(3, 19, 4, 20, light);
    p.line(18, 12, 23, 9, shade, 2); p.line(18, 21, 24, 24, shade, 2); p.line(9, 12, 6, 8, shade, 2); p.line(10, 21, 7, 25, shade, 2); p.outline(); return p;
  }
  const L = legs[0], lift = kind === 'hit' ? '#d0a070' : base;
  for (let i = 0; i < 8; i += 2) p.rect(L[i], L[i + 1], L[i] + 2, L[i + 1] + 2, shade);
  p.ell(14, 16, 9, 5, lift); p.ell(14, 16, 8, 2, shade);   // 몸통 + 등줄기
  p.line(5, 16, 1, kind === 'run_a' ? 12 : kind === 'run_b' ? 20 : 15, shade, 2);   // 꼬리
  const hx = kind === 'bite' ? 26 : 24; p.disc(hx, 16, 4, lift); p.rect(hx + 2, 15, hx + 5, 17, light); p.set(hx + 5, 16, '#101010');
  p.rect(hx - 3, 11, hx - 2, 12, shade); p.rect(hx - 3, 20, hx - 2, 21, shade);   // 귀
  if (kind === 'bite') { p.rect(hx + 3, 14, hx + 5, 14, '#f0f0e4'); p.rect(hx + 3, 18, hx + 5, 18, '#f0f0e4'); }
  p.set(hx + 1, 14, '#ff3030'); p.set(hx + 1, 18, '#ff3030');
  p.outline(); return p;
}
function droneFrame(kind) {   // 24×24
  const p = new Pix(24, 24);
  const arms = [[4, 4], [19, 4], [4, 19], [19, 19]];
  if (kind === 'wreck') {
    p.disc(12, 12, 5, '#23262d'); p.disc(12, 12, 3, '#14161a'); p.disc(14, 10, 2, '#a04010'); p.line(12, 12, 4, 4, '#2a303c'); p.line(12, 12, 19, 19, '#2a303c'); p.line(12, 12, 5, 19, '#2a303c');
    p.rect(2, 3, 5, 4, '#5a6478'); p.rect(18, 18, 21, 19, '#5a6478'); p.outline(); return p;
  }
  for (const [x, y] of arms) p.line(12, 12, x, y, '#2a303c', 1);
  for (const [x, y] of arms) { p.disc(x, y, 3, '#3a4252'); if (kind === 'a') { p.line(x - 3, y, x + 3, y, '#c4ccd8'); } else { p.line(x, y - 3, x, y + 3, '#c4ccd8'); p.line(x - 2, y - 2, x + 2, y + 2, '#8a92a2'); } }
  p.disc(12, 12, 5, '#3a4252'); p.disc(12, 12, 3, '#5a6478'); p.rect(14, 11, 17, 13, '#ff2a2a'); p.set(17, 12, '#ffd0d0');
  p.outline(); return p;
}
function turretFrame(kind) {   // 40×40
  const p = new Pix(40, 40);
  if (kind === 'wreck') {
    p.disc(20, 20, 15, '#2a2d34'); p.disc(20, 20, 12, '#15171b'); p.disc(24, 17, 4, '#a04010'); p.disc(15, 24, 3, '#702e0a');
    p.line(22, 18, 31, 10, '#20242c', 3); p.line(22, 22, 29, 28, '#20242c', 2); p.outline(); return p;
  }
  const rec = kind === 'fire' ? -2 : 0;
  p.disc(20, 20, 15, C.steel); p.disc(20, 20, 13, '#4a525f');
  for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4 + 0.39; p.rect(20 + Math.round(Math.cos(a) * 12) - 1, 20 + Math.round(Math.sin(a) * 12) - 1, 20 + Math.round(Math.cos(a) * 12), 20 + Math.round(Math.sin(a) * 12), C.steelL); }
  p.disc(20, 20, 8, '#394150'); p.disc(20, 20, 5, '#2f3540'); p.set(19, 19, '#8a92a2');
  for (const y of [16, 22]) { p.rect(21 + rec, y, 33 + rec, y + 2, C.dark); p.rect(21 + rec, y, 33 + rec, y, C.steelL); p.rect(31 + rec, y - 1, 34 + rec, y + 3, '#2a2d34'); }
  if (kind === 'fire') { p.rect(35, 15, 37, 19, C.flash); p.rect(35, 21, 37, 25, C.flash); p.rect(38, 17, 39, 17, '#fff'); p.rect(38, 23, 39, 23, '#fff'); }
  if (kind === 'dmg') { p.line(8, 12, 14, 18, C.dark, 1); p.line(26, 30, 31, 35, C.dark, 1); p.line(10, 30, 15, 26, C.dark, 1); p.disc(28, 12, 2, '#a04010'); p.set(12, 10, '#ff9628'); p.set(30, 31, '#ff9628'); }
  p.outline(); return p;
}
function bossFrame(kind) {   // 64×64, 오른쪽을 본다
  const p = new Pix(64, 64), o = '#55583f', oL = '#6e7254', oD = '#3b3d2b';
  const step = kind === 'step_l' ? 3 : kind === 'step_r' ? -3 : 0;
  if (kind === 'wreck') {
    p.rect(16, 18, 44, 46, '#2a2c22'); p.disc(32, 32, 10, '#14150f'); p.disc(36, 28, 5, '#a04010'); p.line(18, 22, 44, 44, '#12130e', 2); p.line(20, 44, 42, 20, '#12130e', 2);
    p.rect(30, 8, 40, 14, '#23262d'); p.line(40, 48, 52, 56, '#23262d', 3); p.outline(); return p;
  }
  p.rect(12 + step, 10, 22 + step, 18, oD); p.rect(12 - step, 46, 22 - step, 54, oD);   // 발
  p.rect(14 + step, 12, 20 + step, 16, o); p.rect(14 - step, 48, 20 - step, 52, o);
  p.rect(16, 18, 44, 46, o); p.rect(16, 18, 44, 21, oL); p.rect(16, 43, 44, 46, oD); p.rect(16, 18, 18, 46, oD);   // 몸통
  p.rect(22, 24, 38, 40, oD); p.rect(23, 25, 37, 39, '#4a4d36'); p.rect(25, 27, 35, 28, oL);
  p.disc(37, 32, 6, '#3b0a0a'); p.disc(37, 32, 4, kind === 'dmg2' ? '#a02020' : C.red); p.set(36, 30, C.redL); p.set(37, 30, C.redL);
  for (const y0 of [6, 50]) { p.rect(28, y0, 40, y0 + 8, oD); p.rect(28, y0, 40, y0 + 1, oL); for (const dy of [2, 5]) { p.rect(40, y0 + dy, 49, y0 + dy + 1, C.dark); p.rect(40, y0 + dy, 49, y0 + dy, C.steelL); } }   // 어깨 포
  if (kind === 'dmg2') { p.rect(28, 6, 40, 14, '#23262d'); p.rect(40, 8, 44, 9, C.dark); }
  p.rect(38, 44, 60, 51, C.dark); for (let x = 40; x < 60; x += 4) p.rect(x, 44, x, 51, C.steelD); p.rect(54, 45, 62, 46, C.steelL); p.rect(54, 49, 62, 50, C.steelL);   // 개틀링 팔
  p.rect(40, 10, 46, 22, C.steel); p.rect(40, 10, 46, 11, C.steelL); p.rect(45, 10, 46, 22, C.steelD);   // 방패
  if (kind === 'dmg1' || kind === 'dmg2') { p.line(18, 20, 28, 30, C.dark, 1); p.line(30, 44, 42, 36, C.dark, 1); p.line(24, 38, 20, 44, C.dark, 1); p.set(22, 25, C.orange); p.set(40, 40, C.orange); }
  if (kind === 'dmg2') { p.line(36, 20, 44, 26, C.dark, 1); p.line(18, 30, 25, 33, C.dark, 1); p.disc(30, 24, 2, '#a04010'); p.set(34, 40, C.orange); p.set(21, 43, C.orange); }
  p.outline(); return p;
}
function bladeSprite() { const p = new Pix(22, 8); p.rect(0, 3, 4, 4, C.dark); p.rect(5, 2, 20, 5, '#ff3030'); p.rect(5, 3, 21, 4, '#ffd0d0'); p.rect(6, 1, 18, 1, '#ff606088'.slice(0, 7)); p.outline(); return p; }
function longGunSprite() { const p = new Pix(30, 7); p.rect(0, 2, 29, 4, C.dark); p.rect(0, 2, 29, 2, C.steelL); p.rect(8, 0, 13, 1, '#3a414d'); p.rect(26, 1, 29, 5, '#2a2d34'); p.outline(); return p; }
function shieldSprite() { const p = new Pix(10, 26); p.rect(0, 0, 8, 24, C.steel); p.rect(0, 0, 8, 1, C.steelL); p.rect(7, 0, 8, 24, C.steelD); p.rect(2, 8, 5, 16, '#2f3540'); p.outline(); return p; }
function rifleIcon() { const p = new Pix(38, 10); p.rect(0, 3, 9, 7, '#5c3a1e'); p.rect(0, 3, 9, 3, '#80542e'); p.rect(10, 3, 31, 6, '#34343a'); p.rect(10, 3, 31, 3, '#737380'); p.rect(14, 6, 17, 9, '#2a2a30'); p.rect(30, 4, 36, 5, '#20242c'); p.rect(12, 1, 16, 2, '#34343a'); p.outline(); return p; }

(async () => {
  // 1) 플레이어 시트 (오른쪽 열만, 건메탈 채색)
  const mk = async (src, out, S, map = HERO, post) => {
    const img = recolor(await loadRaw(path.join(SRC, src)), map), frames = rightColumn(img, S);
    if (post) post(frames);
    await writeSheet(out, frames, S);
    return frames;
  };
  await mk('shotgun_spritesheet.png', 'gs_shotgun', 64);
  await mk('pistol_spritesheet.png', 'gs_pistol', 48);
  const rifle = await mk('rifle_spritesheet.png', 'gs_rifle', 48);
  await mk('smg_spritesheet.png', 'gs_smg', 64);
  await mk('throw_spritesheet.png', 'gs_throw', 48);
  await mk('roll_spritesheet.png', 'gs_roll', 48);
  // 레일 라이플: 소총 프레임의 총 부분을 청색 코일 총으로 바꾸고 총신을 6픽셀 늘린다 (몸은 그대로)
  const GUN = new Set(['52,52,58', '115,115,128', '118,118,132', '105,105,118', '52,52,58']), RAIL = [[28, 70, 92], [56, 208, 255], [190, 244, 255]];
  const railFrames = rifle.map((f, fi) => {
    const p = new Pix(48, 48); let maxX = 0, my = 24;
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) { const i = (y * 48 + x) * 4; if (!f.d[i + 3]) continue; const key = `${f.d[i]},${f.d[i + 1]},${f.d[i + 2]}`; if (GUN.has(key)) { const l = (x + y) % 4 === 0 ? RAIL[2] : (x % 3 === 0 ? RAIL[1] : RAIL[0]); p.set(x, y, l); if (x > maxX) { maxX = x; my = y; } } else if (key === '255,150,40' || key === '255,240,130' || key === '255,232,90') p.set(x, y, [110, 231, 255]); else p.set(x, y, [f.d[i], f.d[i + 1], f.d[i + 2]]); }
    if (fi < 3 && maxX > 0) { for (let x = maxX + 1; x <= Math.min(47, maxX + 6); x++) { p.set(x, my, x % 2 ? RAIL[1] : RAIL[2]); p.set(x, my - 1, RAIL[0]); } p.set(Math.min(47, maxX + 7), my, RAIL[2]); }
    return p;
  });
  await writeSheet('gs_rail', railFrames, 48);
  // 2) 적 인간형 시트 (보병·돌격병·저격수·헤비)
  for (const [k, map] of Object.entries(FOE)) {
    const img = recolor(await loadRaw(path.join(SRC, 'enemy_spritesheet.png')), map);
    await writeSheet('gs_foe_' + k, rightColumn(img, 64), 64);
  }
  // 3) 새로 그린 스프라이트
  await writeSheet('gs_dog', ['idle', 'run_a', 'run_b', 'bite', 'hit', 'dead'].map(dogFrame), 32);
  await writeSheet('gs_drone', ['a', 'b', 'wreck'].map(droneFrame), 24);
  await writeSheet('gs_turret', ['idle', 'fire', 'dmg', 'wreck'].map(turretFrame), 40);
  await writeSheet('gs_boss', ['idle', 'step_l', 'step_r', 'dmg1', 'dmg2', 'wreck'].map(bossFrame), 64);
  await writeSheet('gs_blade', [bladeSprite()], 8, 22);
  await writeSheet('gs_longgun', [longGunSprite()], 7, 30);
  await writeSheet('gs_shield', [shieldSprite()], 26, 10);
  await writeSheet('i_rifle', [rifleIcon()], 10, 38);
  // 4) 폭탄·폭발은 그대로 복사
  for (const [src, dst] of [['bomb.png', 'gs_bomb.png'], ['explosion.png', 'gs_explosion.png']]) fs.copyFileSync(path.join(SRC, src), path.join(OUT, dst));
  console.log('done');
})().catch(e => { console.error(e); process.exit(1); });
