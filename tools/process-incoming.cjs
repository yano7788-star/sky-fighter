// assets-src/incoming/ 의 생성 이미지(초록/마젠타 크로마키 배경)를 게임용 WebP로 변환한다.
//   SHARP_DIR=<sharp가 설치된 폴더> node tools/process-incoming.cjs [이름...]   (이름 생략 시 전부)
// - 크로마키: 초록은 채도 기반 소프트 키잉 + 스필 제거, 마젠타는 가장자리 연결 영역만 제거(내부 분홍색 보존)
// - 워터마크(✦): 가장자리에 닿는 덩어리·아주 작은 덩어리 제거 / 배경은 아래쪽 크롭
const path = require('path');
const fs = require('fs');
let sharp;
try { sharp = require('sharp'); } catch (e) { sharp = require(require.resolve('sharp', { paths: [process.env.SHARP_DIR || process.cwd()] })); }

const ROOT = path.resolve(__dirname, '..');
const IN = path.join(ROOT, 'assets-src', 'incoming');
const OUT = path.join(ROOT, 'public', 'assets', 'img');
fs.mkdirSync(OUT, { recursive: true });
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const kb = f => (fs.statSync(f).size / 1024).toFixed(0);
const findIn = base => ['.png', '.PNG', '.jpg', '.JPG', '.jpeg', '.webp'].map(e => path.join(IN, base + e)).find(fs.existsSync);

async function raw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

// ---------------------------------------------------------------- 크로마키
function keyGreen(img) {
  const { data, w, h } = img;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2];
    const gdom = g - Math.max(r, b);
    const a = 1 - clamp((gdom - 25) / 85);          // 초록 우세도가 높을수록 투명
    if (gdom > 0) data[p + 1] = Math.min(g, Math.max(r, b) + 4);   // 스필 제거
    data[p + 3] = Math.round(a * 255);
  }
}
function keyMagenta(img) {
  const { data, w, h } = img;
  const mdom = i => Math.min(data[i * 4], data[i * 4 + 2]) - data[i * 4 + 1];
  const bg = new Uint8Array(w * h), q = [];
  const push = i => { if (!bg[i] && mdom(i) >= 90 && data[i * 4] > 140 && data[i * 4 + 2] > 140) { bg[i] = 1; q.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w);
  }
  // 가장자리 띠(배경에서 3px 이내): 소프트 알파 + 스필 제거
  const near = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (bg[i]) { const x = i % w, y = (i / w) | 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h) near[ny * w + nx] = 1; } }
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    if (bg[i]) { data[p + 3] = 0; continue; }
    if (near[i]) {
      const m = mdom(i);
      if (m > 20) { data[p + 3] = Math.round((1 - clamp((m - 20) / 80)) * 255); const spill = m * 0.6; data[p] = Math.max(0, data[p] - spill); data[p + 2] = Math.max(0, data[p + 2] - spill); }
    }
  }
}

// ---------------------------------------------------------------- 덩어리 처리
function components(img, thr = 24) {
  const { data, w, h } = img;
  const label = new Int32Array(w * h), comps = [null];
  let n = 0; const st = [];
  for (let s = 0; s < w * h; s++) {
    if (label[s] || data[s * 4 + 3] < thr) continue;
    n++; const c = { id: n, area: 0, minX: w, minY: h, maxX: 0, maxY: 0, border: false }; comps.push(c);
    label[s] = n; st.push(s);
    while (st.length) {
      const p = st.pop(), x = p % w, y = (p / w) | 0;
      c.area++; if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x; if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c.border = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx; if (!label[q] && data[q * 4 + 3] >= thr) { label[q] = n; st.push(q); }
      }
    }
  }
  return { label, comps };
}
/** 화면 가장자리에 닿는 덩어리, 가장 큰 덩어리의 2% 미만인 덩어리(워터마크 등)를 지운다 */
function cleanBlobs(img, { dropBorder = true, minRatio = 0.02 } = {}) {
  const { data, w, h } = img;
  const { label, comps } = components(img);
  const max = Math.max(...comps.slice(1).filter(c => !(dropBorder && c.border)).map(c => c.area), 1);
  const drop = new Set(comps.slice(1).filter(c => (dropBorder && c.border) || c.area < max * minRatio).map(c => c.id));
  for (let i = 0; i < w * h; i++) if (label[i] && drop.has(label[i])) data[i * 4 + 3] = 0;
}
function bbox(img, thr = 10) {
  const { data, w, h } = img; let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > thr) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function save(img, name, { maxSide = 512, trim = true, pad = 2, lossless = true } = {}) {
  let { data, w, h } = img;
  let region = trim ? bbox(img) : { left: 0, top: 0, width: w, height: h };
  if (!region) throw new Error(name + ': 빈 이미지');
  const left = Math.max(0, region.left - pad), top = Math.max(0, region.top - pad);
  region = { left, top, width: Math.min(w - left, region.width + pad * 2), height: Math.min(h - top, region.height + pad * 2) };
  const dst = path.join(OUT, name + '.webp');
  await sharp(data, { raw: { width: w, height: h, channels: 4 } }).extract(region)
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .webp(lossless ? { lossless: true, effort: 6 } : { quality: 92, alphaQuality: 95, effort: 6 }).toFile(dst);
  const m = await sharp(dst).metadata();
  console.log(`${name}: ${m.width}x${m.height} ${kb(dst)}KB`);
}

// ---------------------------------------------------------------- 종류별 처리
async function sprite(base, outName, { key = 'green', maxSide = 360, borderBlobs = true, fixSky = false } = {}) {
  const f = findIn(base); if (!f) { console.log(`(건너뜀) ${base} 없음`); return; }
  const img = await raw(f);
  if (fixSky) {   // 생성 이미지 상단에 섞여 들어온 하늘/구름(파란 기운) 제거: 위쪽 45% 영역의 파란 우세 픽셀
    for (let y = 0; y < img.h * 0.45; y++) for (let x = 0; x < img.w; x++) { const p = (y * img.w + x) * 4; if (img.data[p + 2] > img.data[p] + 6) img.data[p + 3] = 0; }
  }
  if (fixSky) { const g = { data: img.data, w: img.w, h: img.h }; for (let i = 0; i < g.w * g.h; i++) if (g.data[i * 4 + 3] === 0) { g.data[i * 4] = 0; g.data[i * 4 + 1] = 255; g.data[i * 4 + 2] = 0; g.data[i * 4 + 3] = 255; } }
  key === 'green' ? keyGreen(img) : keyMagenta(img);
  cleanBlobs(img, { dropBorder: borderBlobs });
  await save(img, outName, { maxSide });
}

async function background(base, outName, { cropBottomPct = 0.07, maxW = 1080, quality = 82 } = {}) {
  const f = findIn(base); if (!f) { console.log(`(건너뜀) ${base} 없음`); return; }
  const m = await sharp(f).metadata();
  const dst = path.join(OUT, outName + '.webp');
  await sharp(f).extract({ left: 0, top: 0, width: m.width, height: Math.floor(m.height * (1 - cropBottomPct)) })
    .resize({ width: maxW, withoutEnlargement: true }).webp({ quality, effort: 6 }).toFile(dst);
  const o = await sharp(dst).metadata();
  console.log(`${outName}: ${o.width}x${o.height} ${kb(dst)}KB`);
}

async function items() {
  const f = findIn('items_sheet'); if (!f) return;
  const img = await raw(f); keyMagenta(img);
  const { comps } = components(img, 40);
  const big = comps.slice(1).filter(c => !c.border);
  const max = Math.max(...big.map(c => c.area));
  const icons = big.filter(c => c.area > max * 0.25);
  // 행(세로 중심 가까운 것끼리) → 가로 순서
  icons.sort((a, b) => ((a.minY + a.maxY) / 2 - (b.minY + b.maxY) / 2));
  const rowH = Math.max(...icons.map(c => c.maxY - c.minY)) * 0.6;
  const rows = []; for (const c of icons) { const cy = (c.minY + c.maxY) / 2; const r = rows.find(r => Math.abs(r.cy - cy) < rowH); if (r) r.items.push(c); else rows.push({ cy, items: [c] }); }
  const ordered = rows.sort((a, b) => a.cy - b.cy).flatMap(r => r.items.sort((a, b) => a.minX - b.minX));
  const names = ['item_P', 'item_M', 'item_E', 'item_X', 'item_B', 'item_G', 'item_L'];
  console.log(`아이템 시트: 아이콘 ${ordered.length}개 감지`);
  for (let i = 0; i < ordered.length && i < names.length; i++) {
    const c = ordered[i], w = c.maxX - c.minX + 1, h = c.maxY - c.minY + 1;
    const buf = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((c.minY + y) * img.w + c.minX + x) * 4, d = (y * w + x) * 4; buf[d] = img.data[s]; buf[d + 1] = img.data[s + 1]; buf[d + 2] = img.data[s + 2]; buf[d + 3] = img.data[s + 3]; }
    await save({ data: buf, w, h }, names[i], { maxSide: 128, trim: false, pad: 0 });
  }
}

async function explosion() {
  const f = findIn('explosion_sheet'); if (!f) return;
  const img = await raw(f); keyGreen(img);
  const COLS = 5, ROWS = 3, FR = 128, cw = Math.floor(img.w / COLS), ch = Math.floor(img.h / ROWS);
  const cells = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const buf = Buffer.alloc(cw * ch * 4);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const s2 = ((r * ch + y) * img.w + c * cw + x) * 4, d = (y * cw + x) * 4; for (let k = 0; k < 4; k++) buf[d + k] = img.data[s2 + k]; }
    const cell = { data: buf, w: cw, h: ch };
    cleanBlobs(cell, { dropBorder: false, minRatio: 0.03 });
    const bb = bbox(cell, 12);
    if (bb) cells.push({ cell, bb });   // 빈 칸 제외
  }
  // 모든 프레임에 같은 크기의 정사각형 창을 써서 '작은 섬광 → 큰 폭발' 크기 변화를 유지한다
  const side = Math.min(Math.max(...cells.map(c => Math.max(c.bb.width, c.bb.height))) + 8, cw, ch);
  const pngs = [];
  for (const { cell, bb } of cells) {
    const cx = bb.left + bb.width / 2, cy = bb.top + bb.height / 2;
    pngs.push(await sharp(cell.data, { raw: { width: cw, height: ch, channels: 4 } })
      .extract({ left: Math.max(0, Math.min(cw - side, Math.round(cx - side / 2))), top: Math.max(0, Math.min(ch - side, Math.round(cy - side / 2))), width: side, height: side })
      .resize(FR, FR).png().toBuffer());
  }
  const rowsN = Math.ceil(pngs.length / COLS);
  const dst = path.join(OUT, 'explosion.webp');
  await sharp({ create: { width: COLS * FR, height: rowsN * FR, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(pngs.map((input, i) => ({ input, left: (i % COLS) * FR, top: Math.floor(i / COLS) * FR })))
    .webp({ lossless: true, effort: 6 }).toFile(dst);
  console.log();
}

const ALL = {
  bosses: async () => { await sprite('boss1', 'boss1', { key: 'magenta' }); for (let i = 2; i <= 5; i++) await sprite('boss' + i, 'boss' + i); },
  player: async () => { await sprite('player', 'player', { maxSide: 300 }); await sprite('player_skin_2', 'player_skin2', { maxSide: 300 }); await sprite('player_skin_3', 'player_skin3', { maxSide: 300 }); },
  pilots: async () => { await sprite('pilot_sister1', 'pilot1', { maxSide: 512, borderBlobs: false }); await sprite('pilot_sister2', 'pilot2', { maxSide: 512, borderBlobs: false }); },
  enemies: async () => { for (const n of ['scout', 'zigzag', 'kamikaze']) await sprite('enemy_' + n, 'enemy_' + n, { maxSide: 200, fixSky: n === 'scout' }); },
  midbosses: async () => { await sprite('midboss_2', 'midboss_2', { maxSide: 360 }); await sprite('midboss_3', 'midboss_3', { maxSide: 360 }); },
  icons: async () => { await sprite('gem', 'gem', { key: 'magenta', maxSide: 128, borderBlobs: false }); await sprite('drone', 'drone', { key: 'magenta', maxSide: 128, borderBlobs: false }); await items(); },
  logo: async () => { await sprite('logo', 'logo', { maxSide: 720, borderBlobs: false }); },
  explosion,
  backgrounds: async () => { await background('bg1', 'bg1'); await background('bg2', 'bg2'); await background('title_bg', 'title_bg', { cropBottomPct: 0.06 }); },
};

(async () => {
  const want = process.argv.slice(2);
  for (const [name, fn] of Object.entries(ALL)) if (!want.length || want.includes(name)) { console.log(`== ${name}`); await fn(); }
})();
