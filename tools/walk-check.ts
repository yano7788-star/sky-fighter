import { GroundSim, NO_INPUT } from '../src/core/ground';
import { TILE, buildRescueLevel } from '../src/core/groundmap';
import { makeGrid } from './clear-check';

const LV = buildRescueLevel(), { blocked, G, GW, GH } = makeGrid(LV);
/** 16px 격자 최단 경로(반경 36 기준 통행 가능 칸)를 따라 실제 물리(문 밀기 포함)로 걸어서 목표 지점에 닿는지 확인한다 */
export function walkTo(g: GroundSim, tx: number, ty: number, maxFrames = 6000): { ok: boolean; frames: number; at: [number, number] } {
  const dist = new Int32Array(GW * GH).fill(-1), q: number[] = []; const t0 = Math.floor(ty / G) * GW + Math.floor(tx / G); dist[t0] = 0; q.push(t0);
  for (let h = 0; h < q.length; h++) { const x = q[h] % GW, y = (q[h] / GW) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH || dist[ny * GW + nx] >= 0 || blocked[ny * GW + nx]) continue; dist[ny * GW + nx] = dist[q[h]] + 1; q.push(ny * GW + nx); } }
  for (let i = 0; i < maxFrames; i++) {
    const p = g.p; if (Math.hypot(tx - p.x, ty - p.y) < 60) return { ok: true, frames: i, at: [p.x, p.y] };
    let cx = Math.floor(p.x / G), cy = Math.floor(p.y / G);
    for (let k = 0; k < 4; k++) { let b = dist[cy * GW + cx] < 0 ? 1e9 : dist[cy * GW + cx], bx = cx, by = cy; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue; const v = dist[ny * GW + nx]; if (v >= 0 && v < b) { b = v; bx = nx; by = ny; } } cx = bx; cy = by; }
    const a = Math.atan2((cy + 0.5) * G - p.y, (cx + 0.5) * G - p.x);
    g.step({ ...NO_INPUT, mx: Math.cos(a), my: Math.sin(a), ax: Math.cos(a), ay: Math.sin(a), sneak: true }); g.drain();
    g.p.invuln = 99999; g.p.hp = g.p.maxHp;
  }
  return { ok: false, frames: maxFrames, at: [g.p.x, g.p.y] };
}
if (process.argv[1]?.includes('walk-check')) {
  const g = new GroundSim({ seed: 3, mission: 'rescue', hostageWho: 2 }); g.enemies.length = 0;
  const h = g.hostage!;
  const to = (n: string, x: number, y: number) => { const r = walkTo(g, x, y); console.log(n.padEnd(14), r.ok ? 'OK ' + r.frames + '프레임' : 'FAIL 정지 위치 (' + (r.at[0] / TILE).toFixed(1) + ', ' + (r.at[1] / TILE).toFixed(1) + ')'); return r.ok; };
  let ok = to('외곽→지하', 9 * TILE, 100 * TILE) && to('지하 통로 끝', 9 * TILE, 70.5 * TILE) && to('감방동 입구', 9 * TILE, 66 * TILE) && to('감방 문 앞', 10 * TILE, 52 * TILE) && to('인질 곁', h.x - 15, h.y);
  if (ok) { console.log('거리', Math.hypot(g.p.x - h.x, g.p.y - h.y).toFixed(0), 'freeT', h.freeT, 'section', g.section); run(g, 100); console.log('거리', Math.hypot(g.p.x - h.x, g.p.y - h.y).toFixed(0), 'freeT', h.freeT); console.log('인질 상태', h.state); to('헬기장 출구', 9 * TILE, 1.6 * TILE); ok = h.state !== 'caged' && g.state === 'WIN'; console.log('최종 y(타일)', (g.p.y / TILE).toFixed(1), '상태', g.state); }
  process.exit(ok ? 0 : 1);
}
function run(g: GroundSim, n: number) { for (let i = 0; i < n; i++) { g.step({ ...NO_INPUT }); g.drain(); g.p.invuln = 99999; } }
