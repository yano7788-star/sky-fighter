import { COLS, ROWS, TILE, T, buildLevel, buildRescueLevel, flowField, type Level } from '../src/core/groundmap';

function check(name: string, L: Level): number {
  const at = (c: number, r: number) => L.tiles[r * COLS + c];
  const win = new Set<number>(); for (const w of L.windows) for (let rr = w.r; rr < w.r + w.h; rr++) for (let cc = w.c; cc < w.c + w.w; cc++) win.add(rr * COLS + cc);
  const walk = (c: number, r: number) => at(c, r) === T.FLOOR && !win.has(r * COLS + c);   // 유리창은 못 지나간다(깨면 지나간다)
  const sc = Math.floor(L.start.x / TILE), sr = Math.floor(L.start.y / TILE);
  const d = flowField(sc, sr, walk);
  let bad = 0;
  const chk = (n: string, x: number, y: number) => { const c = Math.floor(x / TILE), r = Math.floor(y / TILE); if (at(c, r) !== T.FLOOR) { console.log(name, '벽 위:', n, c, r); bad++; } else if (d[r * COLS + c] < 0) { console.log(name, '도달불가:', n, c, r); bad++; } };
  for (const s of L.spawns) chk('spawn ' + s.k, s.x, s.y);
  for (const p of L.pickups) chk('pickup ' + p.weapon, p.x, p.y);
  for (const p of L.bombPickups ?? []) chk('bomb ' + p.bt, p.x, p.y);
  for (const c of L.crates) chk('crate', (c.c + 0.5) * TILE, (c.r + 0.5) * TILE);
  if (L.hostage) chk('hostage', L.hostage.x, L.hostage.y);
  for (const r of L.reinforce ?? []) chk('reinforce', r.x, r.y);
  for (const door of L.doors) { if (at(door.c, door.r) !== T.FLOOR) { console.log(name, '문이 벽 위:', door.c, door.r); bad++; } }
  for (const w of L.windows) { if (at(w.c, w.r) !== T.FLOOR) { console.log(name, '창이 벽 위:', w.c, w.r); bad++; } }
  const seen = new Set<string>(); for (const c of L.crates) { const k = c.c + ',' + c.r; if (seen.has(k)) { console.log(name, '상자 겹침', k); bad++; } seen.add(k); }
  // 출구(맨 위 문 안쪽)까지 도달 가능한가
  const ex = L.doors.find(x => x.kind === 'exit'); if (ex && d[(ex.r + 1) * COLS + ex.c] < 0) { console.log(name, '출구 도달불가'); bad++; }
  console.log(name, bad ? `문제 ${bad}건` : '검사 통과', 'ROWS', ROWS);
  return bad;
}
const bad = check('assault', buildLevel()) + check('rescue', buildRescueLevel());
process.exit(bad ? 1 : 0);
