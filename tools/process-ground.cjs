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

async function main() {
  if (process.argv[2] === 'v2') {
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
