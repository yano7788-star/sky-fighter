// Reproduces assets/img/* from the root-level originals.
// Usage: NODE_PATH=<dir with node_modules containing sharp> node tools/optimize-assets.js [--stats]
// (sharp is NOT in the repo; install it in a temp dir, e.g. `npm i sharp` outside the project.)
const path = require('path');
const fs = require('fs');
let sharp;
try { sharp = require('sharp'); }
catch (e) { sharp = require(require.resolve('sharp', { paths: [process.env.SHARP_DIR || process.cwd()] })); }

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'assets', 'img');
fs.mkdirSync(OUT, { recursive: true });

// Same algorithm as removeFakeBackground() in index.html
function removeFakeBackground(data, w, h) {
  const px = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
  const isBg = (r, g, b, a) => {
    if (a === 0) return true;
    for (const c of corners) if (Math.hypot(r - c[0], g - c[1], b - c[2]) < 45) return true;
    const diff = Math.max(r, g, b) - Math.min(r, g, b);
    return diff < 20 && r > 160;
  };
  const visited = new Uint8Array(w * h);
  const queue = [];
  for (let x = 0; x < w; x++) { queue.push(x); visited[x] = 1; queue.push((h - 1) * w + x); visited[(h - 1) * w + x] = 1; }
  for (let y = 1; y < h - 1; y++) { queue.push(y * w); visited[y * w] = 1; queue.push(y * w + w - 1); visited[y * w + w - 1] = 1; }
  let head = 0;
  while (head < queue.length) {
    const pos = queue[head++];
    const qx = pos % w, qy = (pos / w) | 0, idx = pos * 4;
    if (isBg(data[idx], data[idx + 1], data[idx + 2], data[idx + 3])) {
      data[idx + 3] = 0;
      if (qx + 1 < w && !visited[pos + 1]) { visited[pos + 1] = 1; queue.push(pos + 1); }
      if (qx - 1 >= 0 && !visited[pos - 1]) { visited[pos - 1] = 1; queue.push(pos - 1); }
      if (qy + 1 < h && !visited[pos + w]) { visited[pos + w] = 1; queue.push(pos + w); }
      if (qy - 1 >= 0 && !visited[pos - w]) { visited[pos - w] = 1; queue.push(pos - w); }
    }
  }
}

const kb = f => (fs.statSync(f).size / 1024).toFixed(0);

// 생성 AI 워터마크(우하단 반짝이 마크)가 모든 원본에 들어 있다.
//  - 배경: 아래쪽을 잘라낸다 (거울 타일링이라 높이가 줄어도 무방)
//  - 시작 화면: 잘라낼 수 없으므로 왼쪽 인접 영역을 가장자리 페더링해서 덮어쓴다
//  - 스프라이트: 배경 제거 후 남는 고립된 작은 덩어리(= 워터마크)를 지운다 (removeSmallBlobs)
const CROP_BOTTOM = { bg1: 170, bg2: 170, bg3: 170, bg4: 170, bg5: 170 };

async function patchStartWatermark(src) {
  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const cx = w - 120, cy = h - 115, R = 56, SH = 150;   // 워터마크 중심/반경, 복사해 올 왼쪽 오프셋
  for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const d = Math.hypot(x - cx, y - cy) / R; if (d >= 1) continue;
    const t = d < 0.6 ? 1 : 1 - (d - 0.6) / 0.4, i = (y * w + x) * 3, j = (y * w + (x - SH)) * 3;
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * (1 - t) + data[j + c] * t);
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

async function bg(name, maxW, maxKB) {
  const src = path.join(ROOT, 'assets-src', 'originals', name + '.png'), dst = path.join(OUT, name + '.webp');
  let input = src;
  if (CROP_BOTTOM[name]) { const m = await sharp(src).metadata(); input = await sharp(src).extract({ left: 0, top: 0, width: m.width, height: m.height - CROP_BOTTOM[name] }).toBuffer(); }
  if (name === 'Startscreen') input = await patchStartWatermark(src);
  let q = 80;
  for (; q >= 40; q -= 5) {
    await sharp(input).resize({ width: maxW, withoutEnlargement: true })
      .webp({ quality: q, effort: 6 }).toFile(dst);
    if (fs.statSync(dst).size <= maxKB * 1024) break;
  }
  console.log(`${name}: ${kb(src)}KB -> ${kb(dst)}KB (q=${q})`);
}

// 가장 큰 덩어리 대비 면적이 2% 미만인 고립 픽셀 덩어리를 투명 처리 (8방향 연결)
function removeSmallBlobs(data, w, h) {
  const label = new Int32Array(w * h), sizes = [0];
  let n = 0; const stack = [];
  for (let p0 = 0; p0 < w * h; p0++) {
    if (label[p0] || data[p0 * 4 + 3] === 0) continue;
    n++; sizes[n] = 0; label[p0] = n; stack.push(p0);
    while (stack.length) {
      const p = stack.pop(); sizes[n]++;
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx; if (!label[q] && data[q * 4 + 3] !== 0) { label[q] = n; stack.push(q); }
      }
    }
  }
  const maxSize = Math.max(...sizes);
  // 덩어리별 경계 상자 — 우하단 모서리에 완전히 들어가는 5% 미만 덩어리도 워터마크로 간주
  const minX = new Int32Array(n + 1).fill(w), minY = new Int32Array(n + 1).fill(h);
  for (let p = 0; p < w * h; p++) { const l = label[p]; if (!l) continue; const x = p % w, y = (p / w) | 0; if (x < minX[l]) minX[l] = x; if (y < minY[l]) minY[l] = y; }
  for (let p = 0; p < w * h; p++) {
    const l = label[p]; if (!l) continue;
    const corner = minX[l] > w * 0.7 && minY[l] > h * 0.7 && sizes[l] < maxSize * 0.05;
    if (sizes[l] < maxSize * 0.02 || corner) data[p * 4 + 3] = 0;
  }
}

async function sprite(name, maxSide) {
  const src = path.join(ROOT, 'assets-src', 'originals', name + '.png'), dst = path.join(OUT, name + '.webp');
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  removeFakeBackground(data, info.width, info.height);
  removeSmallBlobs(data, info.width, info.height);
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .webp({ lossless: true, effort: 6 }).toFile(dst);
  console.log(`${name}: ${kb(src)}KB -> ${kb(dst)}KB`);
}

async function stats(name) {
  const { data, info } = await sharp(path.join(ROOT, 'assets-src', 'originals', name + '.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info, rb = w * 3;
  const mad = (ya, yb, n) => {
    let s = 0;
    for (let k = 0; k < n; k++) for (let i = 0; i < rb; i++) s += Math.abs(data[(ya + k) * rb + i] - data[(yb + k) * rb + i]);
    return (s / (n * rb)).toFixed(2);
  };
  console.log(`${name}: ${w}x${h} seam row0-vs-last=${mad(0, h - 1, 1)} top8-vs-bottom8=${mad(0, h - 8, 8)}`);
}

(async () => {
  for (const n of ['bg1', 'bg2', 'bg3', 'bg4', 'bg5']) await bg(n, 1080, 200);
  await sprite('player', 256);
  await sprite('bomb', 256);
  for (let i = 1; i <= 5; i++) await sprite('boss' + i, 320);
  if (process.argv.includes('--stats')) {
    for (const n of ['bg1', 'bg2', 'bg3', 'bg4', 'bg5', 'player', 'bomb', 'boss1', 'boss2', 'boss3', 'boss4', 'boss5']) await stats(n);
  }
})();
