// 지상전 에셋(초록 크로마키 시트) → 픽셀 아트 PNG (public/assets/img/g_*.png)
//   SHARP_DIR=<sharp 폴더> node tools/process-ground.cjs [probe]
// 파이프라인: 초록 키잉 → 덩어리(스프라이트) 분리 → 면적 평균 다운스케일 → 알파 이진화 → 32색 팔레트 양자화.
// 게임에서는 NEAREST 필터로 그린다 (render/ground.ts).
const path = require('path');
const fs = require('fs');
let sharp;
try { sharp = require('sharp'); } catch (e) { sharp = require(require.resolve('sharp', { paths: [process.env.SHARP_DIR || process.cwd()] })); }
const ROOT = path.resolve(__dirname, '..');
const IN = path.join(ROOT, 'assets-src', 'incoming');
const OUT = path.join(ROOT, 'public', 'assets', 'img');
fs.mkdirSync(OUT, { recursive: true });
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

async function loadKeyed(name) {
  const { data, info } = await sharp(path.join(IN, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2];
    const gdom = g - Math.max(r, b);
    data[p + 3] = Math.round((1 - clamp((gdom - 40) / 70)) * 255);
    if (gdom > 0) data[p + 1] = Math.min(g, Math.max(r, b) + 3);
  }
  return { data, w, h };
}

/** 알파 덩어리 분리 (8방향). 작은 덩어리(워터마크/먼지)는 면적 비율로 제거 */
function components(img, thr = 60) {
  const { data, w, h } = img;
  const label = new Int32Array(w * h), comps = [];
  const st = [];
  for (let s = 0; s < w * h; s++) {
    if (label[s] || data[s * 4 + 3] < thr) continue;
    const c = { id: comps.length + 1, area: 0, minX: w, minY: h, maxX: 0, maxY: 0 };
    comps.push(c); label[s] = c.id; st.push(s);
    while (st.length) {
      const p = st.pop(), x = p % w, y = (p / w) | 0;
      c.area++; if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x; if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx; if (!label[q] && data[q * 4 + 3] >= thr) { label[q] = c.id; st.push(q); }
      }
    }
  }
  return { label, comps };
}

/** 가까운 덩어리를 한 스프라이트로 합친다 (몸통+총 등이 떨어져 있는 경우) */
function merge(comps, gap) {
  const out = [];
  for (const c of comps.sort((a, b) => b.area - a.area)) {
    const m = out.find(o => c.minX <= o.maxX + gap && c.maxX >= o.minX - gap && c.minY <= o.maxY + gap && c.maxY >= o.minY - gap);
    if (m) { m.area += c.area; m.minX = Math.min(m.minX, c.minX); m.minY = Math.min(m.minY, c.minY); m.maxX = Math.max(m.maxX, c.maxX); m.maxY = Math.max(m.maxY, c.maxY); m.ids.push(c.id); }
    else out.push({ ...c, ids: [c.id] });
  }
  return out;
}

/** 스프라이트 하나를 잘라 다운스케일·양자화해서 저장. maxDim = 긴 변 픽셀 수 */
async function save(img, label, c, name, maxDim, { scale: forced } = {}) {
  const { data, w } = img, cw = c.maxX - c.minX + 1, ch = c.maxY - c.minY + 1;
  const buf = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const si = ((c.minY + y) * w + c.minX + x) * 4, di = (y * cw + x) * 4;
    if (c.ids && !c.ids.includes(label[(c.minY + y) * w + c.minX + x])) { buf[di + 3] = 0; continue; }   // 다른 스프라이트가 걸친 픽셀은 지운다
    buf[di] = data[si]; buf[di + 1] = data[si + 1]; buf[di + 2] = data[si + 2]; buf[di + 3] = data[si + 3];
  }
  const k = forced ?? maxDim / Math.max(cw, ch), tw = Math.max(1, Math.round(cw * k)), th = Math.max(1, Math.round(ch * k));
  const { data: small } = await sharp(buf, { raw: { width: cw, height: ch, channels: 4 } }).resize(tw, th, { kernel: 'cubic' }).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < tw * th; i++) { small[i * 4 + 3] = small[i * 4 + 3] >= 128 ? 255 : 0; }
  const file = path.join(OUT, name + '.png');
  await sharp(small, { raw: { width: tw, height: th, channels: 4 } }).png({ palette: true, colors: 32, dither: 0, effort: 10 }).toFile(file);
  console.log(name.padEnd(14), `${tw}x${th}`, (fs.statSync(file).size / 1024).toFixed(1) + 'KB');
  return { k, tw, th };
}

const byX = (a, b) => (a.minX + a.maxX) - (b.minX + b.maxX);
const byY = (a, b) => (a.minY + a.maxY) - (b.minY + b.maxY);

/** v2 시트(균등 격자): 칸 안쪽(inset)만 보고 가장 큰 덩어리를 한 스프라이트로 저장한다. 칸 구분선·워터마크·떠다니는 잡물은 무시 */
async function gridSheet(file, cols, rows, items, inset = 14) {
  const img = await loadKeyed(file), cw = Math.floor(img.w / cols), ch = Math.floor(img.h / rows);
  for (const [idx, name, dim] of items) {
    const cx = (idx % cols) * cw + inset, cy = Math.floor(idx / cols) * ch + inset, sw = cw - 2 * inset, sh = ch - 2 * inset;
    const sub = Buffer.alloc(sw * sh * 4);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const si = ((cy + y) * img.w + cx + x) * 4, di = (y * sw + x) * 4; sub[di] = img.data[si]; sub[di + 1] = img.data[si + 1]; sub[di + 2] = img.data[si + 2]; sub[di + 3] = img.data[si + 3]; }
    const simg = { data: sub, w: sw, h: sh }, { label, comps } = components(simg);
    if (!comps.length) { console.log('empty', name); continue; }
    const big = Math.max(...comps.map(c => c.area)), main = merge(comps.filter(c => c.area > big * 0.12), 8).sort((p, q) => q.area - p.area)[0];
    await save(simg, label, main, name, dim);
  }
}

/** 같은 캐릭터의 여러 프레임: 칸마다 글자(상단)·워터마크를 지우고, 모든 프레임이 공통 영역(합집합 bbox)으로 잘려 머리 위치가 어긋나지 않게 저장한다 */
async function frameGroup(file, cols, rows, cells, eraseTopFrac, targetH, inset = 6) {
  const img = await loadKeyed(file), cw = Math.floor(img.w / cols), ch = Math.floor(img.h / rows), frames = [];
  for (const [idx, name] of cells) {
    const cx = (idx % cols) * cw + inset, cy = Math.floor(idx / cols) * ch + inset, sw = cw - 2 * inset, sh = ch - 2 * inset, top = Math.floor(sh * eraseTopFrac);
    const buf = Buffer.alloc(sw * sh * 4);
    for (let y = top; y < sh; y++) for (let x = 0; x < sw; x++) { const si = ((cy + y) * img.w + cx + x) * 4, di = (y * sw + x) * 4; buf[di] = img.data[si]; buf[di + 1] = img.data[si + 1]; buf[di + 2] = img.data[si + 2]; buf[di + 3] = img.data[si + 3]; }
    const { label, comps } = components({ data: buf, w: sw, h: sh }), big = Math.max(...comps.map(c => c.area)), main = merge(comps.filter(c => c.area > big * 0.1), 10).sort((p, q) => q.area - p.area)[0];
    for (let i = 0; i < sw * sh; i++) if (!main.ids.includes(label[i])) buf[i * 4 + 3] = 0;   // 주 덩어리(캐릭터) 외 전부 투명: 글자·워터마크·탄피
    frames.push({ name, buf, sw, sh, bb: main });
  }
  const u = frames.reduce((a2, f) => ({ x0: Math.min(a2.x0, f.bb.minX), y0: Math.min(a2.y0, f.bb.minY), x1: Math.max(a2.x1, f.bb.maxX), y1: Math.max(a2.y1, f.bb.maxY) }), { x0: 1e9, y0: 1e9, x1: 0, y1: 0 });
  const uw = u.x1 - u.x0 + 1, uh = u.y1 - u.y0 + 1, k = targetH / uh, tw = Math.round(uw * k), th = Math.round(uh * k);
  for (const f of frames) {
    const crop = Buffer.alloc(uw * uh * 4);
    for (let y = 0; y < uh; y++) for (let x = 0; x < uw; x++) { const si = ((u.y0 + y) * f.sw + u.x0 + x) * 4, di = (y * uw + x) * 4; crop[di] = f.buf[si]; crop[di + 1] = f.buf[si + 1]; crop[di + 2] = f.buf[si + 2]; crop[di + 3] = f.buf[si + 3]; }
    const { data: small } = await sharp(crop, { raw: { width: uw, height: uh, channels: 4 } }).resize(tw, th, { kernel: 'cubic' }).raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < tw * th; i++) small[i * 4 + 3] = small[i * 4 + 3] >= 128 ? 255 : 0;
    const out = path.join(OUT, f.name + '.png');
    await sharp(small, { raw: { width: tw, height: th, channels: 4 } }).png({ palette: true, colors: 32, dither: 0, effort: 10 }).toFile(out);
    console.log(f.name.padEnd(12), tw + 'x' + th, (fs.statSync(out).size / 1024).toFixed(1) + 'KB');
  }
}

/** 타일셋(8×4): 칸마다 96px 로 줄여 한 장의 아틀라스로 묶는다 (t2_atlas.png, 칸 번호 = 행*8+열) */
async function tileAtlas(file) {
  const m = await sharp(path.join(IN, file)).metadata(), cw = Math.floor(m.width / 8), ch = Math.floor(m.height / 4), cells = [];
  for (let i = 0; i < 32; i++) cells.push({ input: await sharp(path.join(IN, file)).extract({ left: (i % 8) * cw + 3, top: Math.floor(i / 8) * ch + 3, width: cw - 6, height: ch - 6 }).resize(96, 96, { kernel: 'cubic' }).png().toBuffer(), left: (i % 8) * 96, top: Math.floor(i / 8) * 96 });
  const out = path.join(OUT, 't2_atlas.png');
  await sharp({ create: { width: 768, height: 384, channels: 3, background: '#000' } }).composite(cells).png({ palette: true, colors: 64, dither: 0, effort: 10 }).toFile(out);
  console.log('t2_atlas', (fs.statSync(out).size / 1024).toFixed(0) + 'KB');
}

/** 4방향(아래·위·왼·오른쪽) × 9동작 시트 (흰 배경 + 라벨 + 발밑 초록 그림자) → 한 장의 스프라이트시트 p3_dir.png (칸 하나 = frameW×frameH, 프레임 번호 = 방향*9+동작) */
async function dirSheet(file, out, cols, rows, targetH) {
  const { data, info } = await sharp(path.join(IN, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, keep = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]; keep[i] = ((r > 222 && g > 222 && b > 222) || g - Math.max(r, b) > 22) ? 0 : 1; }
  for (let pass = 0; pass < 2; pass++) {   // 흰 테두리 잔상 제거: 배경에 닿은 밝은 픽셀을 깎는다
    const del = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (!keep[i]) continue; const p = i * 4; if (Math.min(data[p], data[p + 1], data[p + 2]) < 170) continue; if (!keep[i - 1] || !keep[i + 1] || !keep[i - w] || !keep[i + w]) del.push(i); }
    for (const i of del) keep[i] = 0;
  }
  const lab = new Int32Array(w * h), comps = [], st = [];
  for (let s0 = 0; s0 < w * h; s0++) {
    if (!keep[s0] || lab[s0]) continue;
    const c = { id: comps.length + 1, a: 0, x0: w, y0: h, x1: 0, y1: 0 }; comps.push(c); lab[s0] = c.id; st.push(s0);
    while (st.length) { const p = st.pop(), x = p % w, y = (p / w) | 0; c.a++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const q = ny * w + nx; if (keep[q] && !lab[q]) { lab[q] = c.id; st.push(q); } } }
  }
  // 라벨(머리글·왼쪽 글자 상자)은 건너뛰고, 캐릭터 덩어리의 가운데 좌표로 열·행 중심을 구한다
  const hdr = Math.min(...comps.filter(c => c.a > 1500 && (c.x1 - c.x0) > 55 && (c.y1 - c.y0) < 60).map(c => c.y0)), isLabel = c => c.y1 < hdr + 60 || (c.x1 < 110 && c.a > 600);
  const chars = comps.filter(c => c.a > 3000 && !isLabel(c)), rowY = []; 
  for (const c of chars.sort((p, q) => p.y0 - q.y0)) { const r = rowY.find(rr => Math.abs(rr.top - c.y0) < 40); if (r) { r.n++; r.top = Math.min(r.top, c.y0); } else rowY.push({ top: c.y0, n: 1 }); }
  const tops = rowY.map(r => r.top).slice(0, rows), colX = [];
  for (const c of chars.filter(c => Math.abs(c.y0 - tops[0]) < 40).sort((p, q) => p.x0 - q.x0)) colX.push((c.x0 + c.x1) / 2);
  console.log('cols', colX.map(Math.round).join(','), 'rows', tops.join(','));
  if (colX.length !== cols || tops.length !== rows) throw new Error('grid detect failed');
  const rowOf = (cy) => { let r0 = 0; for (let i = 0; i < rows; i++) if (cy >= tops[i] - 30) r0 = i; return r0; };
  const bottoms = tops.map((_, i) => Math.max(...chars.filter(c => rowOf((c.y0 + c.y1) / 2) === i).map(c => c.y1)));   // 방향마다 발 위치를 맞춘다 (방향을 바꿔도 캐릭터가 튀지 않게)
  const winW = 120, winH = Math.max(...chars.map(c => c.y1 - c.y0)) + 12, cell = new Map();
  for (const c of comps) {
    if (isLabel(c) || c.a < 4) continue;
    const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2; let ri = 0; for (let i = 0; i < rows; i++) if (cy >= tops[i] - 30) ri = i;
    let ci = 0, bd = 1e9; colX.forEach((x, i) => { const d = Math.abs(cx - x); if (d < bd) { bd = d; ci = i; } });
    const k = ri * cols + ci; (cell.get(k) ?? cell.set(k, []).get(k)).push(c.id);
  }
  const fw = Math.round(winW * targetH / winH), fh = targetH, sheet = Buffer.alloc(fw * cols * fh * rows * 4);
  for (let k = 0; k < cols * rows; k++) {
    const ri = Math.floor(k / cols), ci = k % cols, ids = new Set(cell.get(k) ?? []), x0 = Math.round(colX[ci] - winW / 2), y0 = bottoms[ri] - winH + 5;
    const buf = Buffer.alloc(winW * winH * 4);
    for (let y = 0; y < winH; y++) for (let x = 0; x < winW; x++) { const sx = x0 + x, sy = y0 + y; if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue; const si = sy * w + sx; if (!ids.has(lab[si])) continue; const p = si * 4, d = (y * winW + x) * 4; buf[d] = data[p]; buf[d + 1] = data[p + 1]; buf[d + 2] = data[p + 2]; buf[d + 3] = 255; }
    const { data: small } = await sharp(buf, { raw: { width: winW, height: winH, channels: 4 } }).resize(fw, fh, { kernel: 'cubic' }).raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) { const si = (y * fw + x) * 4, di = ((ri * fh + y) * fw * cols + ci * fw + x) * 4; sheet[di] = small[si]; sheet[di + 1] = small[si + 1]; sheet[di + 2] = small[si + 2]; sheet[di + 3] = small[si + 3] >= 128 ? 255 : 0; }
  }
  const outFile = path.join(OUT, out + '.png');
  await sharp(sheet, { raw: { width: fw * cols, height: fh * rows, channels: 4 } }).png({ palette: true, colors: 48, dither: 0, effort: 10 }).toFile(outFile);
  console.log(out, 'frame', fw + 'x' + fh, (fs.statSync(outFile).size / 1024).toFixed(1) + 'KB');
}

/** 정탑다운 4방향 시트(방향별 열 묶음 × IDLE/WALK/RUN/SHOOT 행): 총이 바라보는 방향으로 곧게 뻗어 있다 → p4_top.png (칸 S×S, 프레임 = 방향*10+동작, 동작 0 idle / 1-3 walk / 4-6 run / 7-9 shoot).
 *  방향 순서: 0 아래, 1 왼쪽, 2 위, 3 오른쪽. 각 프레임은 '머리 쪽 가장자리'를 기준으로 몸통 중심(pivot)이 칸 중앙에 오게 맞춰 회전 중심이 어긋나지 않는다. */
async function topSheet(file, out, scale, f = 1, PIV = [62, 70, 62, 70]) {   // f: 시트 가로 해상도 / 2000 (좌표 임계값 보정)
  const { data, info } = await sharp(path.join(IN, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, keep = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]; keep[i] = (data[i * 4 + 3] < 128 || (r > 222 && g > 222 && b > 222)) ? 0 : 1; }   // 투명 배경(webp) 또는 흰 배경
  for (let pass = 0; pass < 2; pass++) { const del = []; for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (!keep[i]) continue; const p = i * 4; if (Math.min(data[p], data[p + 1], data[p + 2]) < 170) continue; if (!keep[i - 1] || !keep[i + 1] || !keep[i - w] || !keep[i + w]) del.push(i); } for (const i of del) keep[i] = 0; }
  const lab = new Int32Array(w * h), comps = [], st = [];
  for (let s0 = 0; s0 < w * h; s0++) {
    if (!keep[s0] || lab[s0]) continue;
    const c = { id: comps.length + 1, a: 0, x0: w, y0: h, x1: 0, y1: 0 }; comps.push(c); lab[s0] = c.id; st.push(s0);
    while (st.length) { const p = st.pop(), x = p % w, y = (p / w) | 0; c.a++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const q = ny * w + nx; if (keep[q] && !lab[q]) { lab[q] = c.id; st.push(q); } } }
  }
  const f2 = f * f, isLabel = c => c.y1 < 130 * f || (c.x1 < 225 * f && c.a > 600 * f2);
  const big = comps.filter(c => c.a > 1500 * f2 && !isLabel(c)), small = comps.filter(c => c.a >= 3 && c.a <= 1500 * f2 && !isLabel(c) && c.y0 > 120 * f && c.x0 > 225 * f);
  const dirOf = c => { const cx = (c.x0 + c.x1) / 2; return cx < 620 * f ? 0 : cx < 1060 * f ? 1 : cx < 1480 * f ? 2 : 3; }, rowOf = c => { const cy = (c.y0 + c.y1) / 2; return cy < 360 * f ? 0 : cy < 625 * f ? 1 : cy < 900 * f ? 2 : 3; };
  const groups = new Map();
  for (const c of big) { const k = dirOf(c) * 4 + rowOf(c); (groups.get(k) ?? groups.set(k, []).get(k)).push({ ...c, ids: [c.id] }); }
  for (const g of groups.values()) g.sort((p, q) => p.x0 - q.x0);
  for (const c of small) {   // 총구 화염·탄피·불꽃은 가장 가까운 캐릭터 프레임에 붙인다
    let best = null, bd = 190 * f; for (const g of groups.values()) for (const f of g) { const dx = Math.max(f.x0 - c.x1, 0, c.x0 - f.x1), dy = Math.max(f.y0 - c.y1, 0, c.y0 - f.y1), d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = f; } }
    if (best) best.ids.push(c.id);
  }
  const S = 160, ox = 70, oy = 62;   // PIV: 머리쪽 가장자리에서 몸통 중심까지(원본 px)
  const half = Math.round(S / scale / 2), sheet = Buffer.alloc(S * 10 * S * 4 * 4), tips = [[], [], [], []];
  void ox; void oy;
  const want = (d, r) => (r === 0 ? 1 : r === 3 ? (d === 1 ? 2 : 3) : 3);
  for (let d = 0; d < 4; d++) for (let r = 0; r < 4; r++) {
    const g = groups.get(d * 4 + r) ?? []; if (g.length < 1) throw new Error('missing group ' + d + ',' + r + ' ' + g.length);
    for (let i = 0; i < want(d, r); i++) {
      const f = g[Math.min(i, g.length - 1)], col = r === 0 ? 0 : r === 1 ? 1 + i : r === 2 ? 4 + i : 7 + i;
      // pivot: 방향별 머리쪽 가장자리 기준 (아래: 위쪽 / 위: 아래쪽 / 왼쪽: 오른쪽 / 오른쪽: 왼쪽)
      const cx = (f.x0 + f.x1) / 2, cy = (f.y0 + f.y1) / 2, px = d === 0 || d === 2 ? cx : d === 1 ? f.x1 - PIV[d] : f.x0 + PIV[d], py = d === 1 || d === 3 ? cy : d === 0 ? f.y0 + PIV[d] : f.y1 - PIV[d];
      const win = half * 2, buf = Buffer.alloc(win * win * 4), ids = new Set(f.ids);
      for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const sx = Math.round(px - half + x), sy = Math.round(py - half + y); if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue; const si = sy * w + sx; if (!ids.has(lab[si])) continue; const p = si * 4, q = (y * win + x) * 4; buf[q] = data[p]; buf[q + 1] = data[p + 1]; buf[q + 2] = data[p + 2]; buf[q + 3] = 255; }
      const { data: small2 } = await sharp(buf, { raw: { width: win, height: win, channels: 4 } }).resize(S, S, { kernel: 'cubic' }).raw().toBuffer({ resolveWithObject: true });
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const si = (y * S + x) * 4, di = ((d * S + y) * S * 10 + col * S + x) * 4; sheet[di] = small2[si]; sheet[di + 1] = small2[si + 1]; sheet[di + 2] = small2[si + 2]; sheet[di + 3] = small2[si + 3] >= 128 ? 255 : 0; }
      if (r === 0) tips[d].push(d === 0 ? (f.y1 - py) * scale : d === 2 ? (py - f.y0) * scale : d === 1 ? (px - f.x0) * scale : (f.x1 - px) * scale);   // 가만히 있을 때 총구까지의 거리
    }
    if (r === 3 && d === 1 && g.length === 2) { /* 왼쪽 사격은 2프레임: 마지막 프레임을 복제 */
      const col = 9; for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const si = ((d * S + y) * S * 10 + 8 * S + x) * 4, di = ((d * S + y) * S * 10 + col * S + x) * 4; sheet[di] = sheet[si]; sheet[di + 1] = sheet[si + 1]; sheet[di + 2] = sheet[si + 2]; sheet[di + 3] = sheet[si + 3]; }
    }
  }
  const outFile = path.join(OUT, out + '.png');
  await sharp(sheet, { raw: { width: S * 10, height: S * 4, channels: 4 } }).png({ palette: true, colors: 48, dither: 0, effort: 10 }).toFile(outFile);
  console.log(out, 'cell', S, (fs.statSync(outFile).size / 1024).toFixed(1) + 'KB', 'idle tip dist (px)', tips.map(t => Math.round(t[0])).join(','));
}

async function main() {
  if (process.argv[2] === 'v4') { await topSheet('ground2_topdown_dirs2.webp', 'p4_top', 0.65, 0.768, [38, 40, 38, 40]); return; }
  if (process.argv[2] === 'v3') { await dirSheet('ground2_dir_armed.jpg', 'p3_armed', 9, 4, 72); return; }
  if (process.argv[2] === 'v2') {
    await frameGroup('ground2_pilot_sis2_topdown.webp', 4, 2, [[0, 'p2_walk0'], [1, 'p2_walk1'], [2, 'p2_walk2'], [3, 'p2_walk3'], [4, 'p2_fire0'], [5, 'p2_fire1']], 0.14, 58);
    await frameGroup('ground2_pilot_sis2_topdown.webp', 4, 2, [[6, 'p2_corpse']], 0.14, 52);
    await frameGroup('ground2_pilot_sis2_pistol.png', 2, 1, [[0, 'p2_pistol0'], [1, 'p2_pistol1']], 0.2, 58);
    await tileAtlas('ground2_tiles.png');
    await gridSheet('ground2_items.png', 4, 2, [[0, 'i_pistol', 30], [1, 'i_smg', 40], [2, 'i_shotgun', 52], [3, 'i_rail', 54], [4, 'i_grenade', 16], [5, 'i_medkit', 24], [6, 'i_ammo', 24], [7, 'i_crate', 34]]);
    await gridSheet('ground2_boss.png', 3, 2, [[0, 'b2_0', 190], [3, 'b2_1', 190], [1, 'b2_2', 190], [2, 'b2_dmg1', 190], [5, 'b2_dmg2', 190]], 10);
    return;
  }
  const probe = process.argv[2] === 'probe';
  // ---- 파일럿: sheet1(앞면, 윗줄 에이스/언니/동생), sheet2(뒷면: 윗줄 언니/동생, 아랫줄 에이스)
  {
    const front = await loadKeyed('ground_pilots_sheet1.png'), back = await loadKeyed('ground_pilots_sheet2.png');
    const pick = img => {
      const { label, comps } = components(img), big = Math.max(...comps.map(c => c.area));
      const list = merge(comps.filter(c => c.area > big * 0.08), 40);
      return { label, list };
    };
    const f = pick(front), b = pick(back);
    console.log('pilots front', f.list.map(c => [c.minX, c.minY, c.maxX, c.maxY, c.area].join(',')));
    console.log('pilots back ', b.list.map(c => [c.minX, c.minY, c.maxX, c.maxY, c.area].join(',')));
    if (!probe) {
      const top = l => l.filter(c => c.minY < 900).sort(byX);
      const [ace, sis1, sis2] = top(f.list);
      const bt = top(b.list), bace = b.list.find(c => c.minY >= 900);
      // 모든 파일럿 스프라이트가 같은 배율을 쓰도록 에이스 앞면 높이를 기준으로 한다
      const base = 52 / Math.max(ace.maxY - ace.minY + 1, 1);
      await save(front, f.label, ace, 'g_ace_f', 0, { scale: base });
      await save(front, f.label, sis1, 'g_sis1_f', 0, { scale: base });
      await save(front, f.label, sis2, 'g_sis2_f', 0, { scale: base });
      await save(back, b.label, bace, 'g_ace_b', 0, { scale: base });
      await save(back, b.label, bt[0], 'g_sis1_b', 0, { scale: base });
      await save(back, b.label, bt[1], 'g_sis2_b', 0, { scale: base });
    }
  }
  // ---- 적 6종 (3×2 격자, 칸 구분선이 있으므로 칸 안쪽만 본다)
  {
    const img = await loadKeyed('ground_enemies_sheet.png'), { w, h } = img;
    const xs = [0, w * 0.25, w * 0.5, w], ch = h / 2, names = ['g_rifle', 'g_charger', 'g_sniper', 'g_turret', 'g_drone', 'g_tank'];
    const dims = [48, 52, 78, 44, 36, 100];
    for (let i = 0; i < 6; i++) {
      const cx = xs[i % 3], cw = xs[(i % 3) + 1] - xs[i % 3], cy = ((i / 3) | 0) * ch, m = 14;
      // 칸 구분선(검은 선)이 불투명으로 남지 않도록, 칸 안쪽 영역만 복사해 따로 분석
      const sub = Buffer.alloc((cw - 2 * m) * (ch - 2 * m) * 4), sw = Math.floor(cw - 2 * m), sh = Math.floor(ch - 2 * m);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const si = ((Math.floor(cy) + m + y) * w + Math.floor(cx) + m + x) * 4, di = (y * sw + x) * 4;
        sub[di] = img.data[si]; sub[di + 1] = img.data[si + 1]; sub[di + 2] = img.data[si + 2]; sub[di + 3] = img.data[si + 3];
      }
      const simg = { data: sub, w: sw, h: sh }, { label, comps } = components(simg), big = Math.max(...comps.map(c => c.area));
      const list = merge(comps.filter(c => c.area > big * 0.04), 30), main = list.sort((a, b) => b.area - a.area)[0];
      if (probe) console.log(names[i], list.map(c => [c.minX, c.minY, c.maxX, c.maxY, c.area].join(',')));
      else await save(simg, label, main, names[i], dims[i]);
    }
  }
  // ---- 보스
  {
    const img = await loadKeyed('ground_boss.png'), { label, comps } = components(img), big = Math.max(...comps.map(c => c.area));
    const list = merge(comps.filter(c => c.area > big * 0.03), 60), main = list.sort((a, b) => b.area - a.area)[0];
    console.log('boss', [main.minX, main.minY, main.maxX, main.maxY].join(','));
    if (!probe) await save(img, label, main, 'g_boss', 190);
  }
  // ---- 소품 (4×? 불규칙 → 덩어리 위치로 분류)
  {
    const img = await loadKeyed('props_sheet.png'), { label, comps } = components(img), big = Math.max(...comps.map(c => c.area));
    const list = merge(comps.filter(c => c.area > big * 0.04), 12);
    if (!probe) {
      // 소품은 위치로 식별한다 (minX,minY 근접 매칭)
      const table = [['p_barrier', 5, 94, 64], ['p_stack', 433, 21, 40], ['p_crate', 222, 75, 36], ['p_crates2', 219, 277, 38], ['p_door', 15, 276, 60], ['p_barrel', 444, 290, 24], ['p_weapon', 413, 537, 44], ['p_door2', 12, 498, 60], ['p_dooropen', 209, 498, 60], ['p_weapon2', 15, 741, 44], ['p_pad', 240, 735, 30]];
      for (const [name, x, y, dim] of table) {
        const c = list.find(c => Math.abs(c.minX - x) < 20 && Math.abs(c.minY - y) < 20);
        if (!c) { console.log('missing', name); continue; }
        await save(img, label, c, name, dim);
      }

    }
  }
  // ---- 타일: 바닥/벽 (가로 세로 비율 달라 정사각 중앙 크롭 후 128px)
  if (!probe) {
    for (const [src, dst, sz] of [['tile_floor.png', 'g_floor', 160], ['tile_wall.png', 'g_wall', 160]]) {
      const m = await sharp(path.join(IN, src)).metadata(), s = Math.min(m.width, m.height);
      const file = path.join(OUT, dst + '.png');
      await sharp(path.join(IN, src)).extract({ left: Math.floor((m.width - s) / 2), top: Math.floor((m.height - s) / 2), width: s, height: s })
        .resize(sz, sz, { kernel: 'cubic' }).png({ palette: true, colors: 32, dither: 0, effort: 10 }).toFile(file);
      console.log(dst, sz + 'x' + sz, (fs.statSync(file).size / 1024).toFixed(1) + 'KB');
    }
    // ---- 컷 3장: 세로 9:16, 폭 540 WebP
    for (const n of ['cut_shotdown', 'cut_landing', 'cut_takeoff']) {
      const file = path.join(OUT, n + '.webp');
      // 우하단 AI 워터마크(✦)가 있으므로 오른쪽·아래 6%를 잘라 낸다 (9:16 비율 유지)
      const m = await sharp(path.join(IN, n + '.png')).metadata(), cw = Math.floor(m.width * 0.94), ch = Math.floor(m.height * 0.94);
      await sharp(path.join(IN, n + '.png')).extract({ left: 0, top: 0, width: cw, height: ch }).resize({ width: 540, height: 960, fit: 'fill' }).webp({ quality: 80 }).toFile(file);
      console.log(n, (fs.statSync(file).size / 1024).toFixed(0) + 'KB');
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
