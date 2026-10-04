import { COLS, ROWS, TILE, T, buildLevel, flowField } from '../src/core/groundmap';
const L = buildLevel(), at = (c: number, r: number) => L.tiles[r * COLS + c];
const walk = (c: number, r: number) => at(c, r) === T.FLOOR;
const sc = Math.floor(L.start.x / TILE), sr = Math.floor(L.start.y / TILE);
const d = flowField(sc, sr, walk);
let bad = 0;
const chk = (n: string, x: number, y: number) => { const c = Math.floor(x / TILE), r = Math.floor(y / TILE); if (at(c, r) !== T.FLOOR) { console.log('벽 위:', n, c, r); bad++; } else if (d[r * COLS + c] < 0) { console.log('도달불가:', n, c, r); bad++; } };
// 문 자리는 바닥으로 열려 있다고 가정(문 타일은 FLOOR)
for (const s of L.spawns) chk('spawn ' + s.k, s.x, s.y);
for (const p of L.pickups) chk('pickup ' + p.weapon, p.x, p.y);
for (const c of L.crates) chk('crate', (c.c + 0.5) * TILE, (c.r + 0.5) * TILE);
for (const door of L.doors) if (door.kind !== 'exit') { const c = door.c, r = door.r; if (at(c, r) !== T.FLOOR) { console.log('문이 벽 위:', c, r); bad++; } }
for (const w of L.windows) { if (at(w.c, w.r) !== T.FLOOR) { console.log('창이 벽 위:', w.c, w.r); bad++; } }
// 상자 겹침
const seen = new Set<string>(); for (const c of L.crates) { const k = c.c + ',' + c.r; if (seen.has(k)) { console.log('상자 겹침', k); bad++; } seen.add(k); }
console.log(bad ? `문제 ${bad}건` : '맵 검사 통과', 'ROWS', ROWS);
