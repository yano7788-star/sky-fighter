import { COLS, ROWS, TILE, T, buildLevel, buildRescueLevel, type Level } from '../src/core/groundmap';

/** 플레이어(반경 36)가 실제로 지나갈 수 있는 길만으로 시작점에서 도달 가능한지 검사한다 (16px 격자 BFS. 벽·유리창·상자 = 장애물, 문 = 열린 것으로 취급) */
const R = 36, G = 16, GW = (COLS * TILE) / G, GH = (ROWS * TILE) / G;
export function makeGrid(L: Level): { blocked: Uint8Array; G: number; GW: number; GH: number } {
  const solidTile = new Uint8Array(COLS * ROWS);
  for (let i = 0; i < solidTile.length; i++) solidTile[i] = L.tiles[i] === T.WALL ? 1 : 0;
  for (const w of L.windows) for (let r = w.r; r < w.r + w.h; r++) for (let c = w.c; c < w.c + w.w; c++) solidTile[r * COLS + c] = 1;
  const boxes = L.crates.map(c => ({ x: (c.c + 0.5) * TILE, y: (c.r + 0.5) * TILE, hs: c.kind === 'barrel' ? 22 : 28 }));
  const hit = (x: number, y: number): boolean => {
    const c0 = Math.floor((x - R) / TILE), c1 = Math.floor((x + R) / TILE), r0 = Math.floor((y - R) / TILE), r1 = Math.floor((y + R) / TILE);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS || solidTile[r * COLS + c]) { const nx = Math.max(c * TILE, Math.min(x, (c + 1) * TILE)), ny = Math.max(r * TILE, Math.min(y, (r + 1) * TILE)); if (Math.hypot(x - nx, y - ny) < R) return true; }
    }
    for (const b of boxes) { const nx = Math.max(b.x - b.hs, Math.min(x, b.x + b.hs)), ny = Math.max(b.y - b.hs, Math.min(y, b.y + b.hs)); if (Math.hypot(x - nx, y - ny) < R) return true; }
    return false;
  };
  const blocked = new Uint8Array(GW * GH); for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) blocked[gy * GW + gx] = hit(gx * G + G / 2, gy * G + G / 2) ? 1 : 0;
  return { blocked, G, GW, GH };
}
export function clearance(L: Level, label: string): { bad: number; seen: Uint8Array } {
  const { blocked } = makeGrid(L);
  const sx = Math.floor(L.start.x / G), sy = Math.floor(L.start.y / G);
  const seen = new Uint8Array(GW * GH), q: number[] = [sy * GW + sx]; seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const x = q[h] % GW, y = (q[h] / GW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || nx >= GW || ny < 0 || ny >= GH || seen[ny * GW + nx] || blocked[ny * GW + nx]) continue; seen[ny * GW + nx] = 1; q.push(ny * GW + nx); }
  }
  let bad = 0;
  const reach = (x: number, y: number) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const gx = Math.floor(x / G) + dx, gy = Math.floor(y / G) + dy; if (gx >= 0 && gy >= 0 && gx < GW && gy < GH && seen[gy * GW + gx]) return true; } return false; };   // 목표 주변 32px 안에 닿을 수 있으면 OK
  const need = (n: string, x: number, y: number) => { if (!reach(x, y)) { console.log(label, '지나갈 수 없음:', n, `(${(x / TILE).toFixed(1)},${(y / TILE).toFixed(1)})`); bad++; } };
  for (const s of L.spawns) need('spawn ' + s.k, s.x, s.y);
  for (const p of L.pickups) need('pickup ' + p.weapon, p.x, p.y);
  for (const p of L.bombPickups ?? []) need('bomb ' + p.bt, p.x, p.y);
  if (L.hostage) need('인질 주변', L.hostage.x - 60, L.hostage.y);
  for (const r of L.reinforce ?? []) need('증원', r.x, r.y);
  for (const d of L.doors) need('문 ' + d.kind, (d.c + d.w / 2) * TILE, (d.r + d.h / 2) * TILE);
  const ex = L.doors.find(x => x.kind === 'exit'); if (ex) need('출구 앞', (ex.c + 1) * TILE, (ex.r + 2.5) * TILE);
  console.log(label, bad ? `통과 불가 ${bad}건` : '통과 검사 OK');
  return { bad, seen };
}
if (process.argv[1]?.includes('clear-check')) { const bad = clearance(buildLevel(), 'assault').bad + clearance(buildRescueLevel(), 'rescue').bad; process.exit(bad ? 1 : 0); }
