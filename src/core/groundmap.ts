import type { CoverKind, GKind, WeaponId } from './ground';

/**
 * 지상전 맵: 옥상 → 건물 1층 → 2층 → 격납고. 아래에서 위로 올라가며 방을 하나씩 정리한다 (핫라인 마이애미 식 스크롤 맵).
 * 타일 18열 × 132행 (25px) = 450 × 3300. 순수 데이터/계산 (Phaser 무관).
 */
export const TILE = 25, COLS = 18, ROWS = 132, WORLD_W = COLS * TILE, WORLD_H = ROWS * TILE;
export const T = { FLOOR: 0, WALL: 1, GLASS: 2, DOOR: 3, GATE: 4, EXIT: 5, LOW: 6 } as const;
/** 시야 차단 / 탄 차단 / 이동 차단 */
export const blocksSight = (t: number): boolean => t === T.WALL || t === T.DOOR || t === T.GATE || t === T.EXIT;
export const blocksBullet = (t: number): boolean => t === T.WALL || t === T.DOOR || t === T.GATE || t === T.EXIT;   // 유리·낮은 벽은 탄이 통과 (유리창 너머로 사격전)
export const blocksMove = (t: number): boolean => t === T.WALL || t === T.GLASS || t === T.GATE || t === T.EXIT || t === T.LOW;

export type FloorStyle = 'roof' | 'indoor' | 'hangar';
export interface SectionDef { id: number; name: string; r0: number; r1: number; floor: FloorStyle }
export const SECTIONS: SectionDef[] = [
  { id: 0, name: '옥상', r0: 102, r1: 131, floor: 'roof' },
  { id: 1, name: '건물 1층', r0: 68, r1: 101, floor: 'indoor' },
  { id: 2, name: '건물 2층', r0: 34, r1: 67, floor: 'indoor' },
  { id: 3, name: '격납고', r0: 0, r1: 33, floor: 'hangar' },
];
export const sectionOfRow = (r: number): number => (r < 34 ? 3 : r < 68 ? 2 : r < 102 ? 1 : 0);

export interface MapSpawn { k: GKind; x: number; y: number; section: number; patrol?: [number, number][]; ang?: number }
export interface MapCover { kind: CoverKind; x: number; y: number; section: number }
export interface MapPickup { weapon: WeaponId; x: number; y: number; section: number }
export interface Level { tiles: Uint8Array; spawns: MapSpawn[]; covers: MapCover[]; pickups: MapPickup[]; start: { x: number; y: number } }

const tc = (t: number): number => (t + 0.5) * TILE;

export function buildLevel(): Level {
  const tiles = new Uint8Array(COLS * ROWS);
  const set = (c: number, r: number, t: number) => { if (c >= 0 && c < COLS && r >= 0 && r < ROWS) tiles[r * COLS + c] = t; };
  const fill = (c0: number, r0: number, c1: number, r1: number, t: number) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) set(c, r, t); };
  const spawns: MapSpawn[] = [], covers: MapCover[] = [], pickups: MapPickup[] = [];
  const en = (k: GKind, c: number, r: number, extra: Partial<MapSpawn> = {}) => spawns.push({ k, x: tc(c), y: tc(r), section: sectionOfRow(r), ...extra });
  const cov = (kind: CoverKind, c: number, r: number) => covers.push({ kind, x: tc(c), y: tc(r), section: sectionOfRow(r) });
  const wp = (weapon: WeaponId, c: number, r: number) => pickups.push({ weapon, x: tc(c), y: tc(r), section: sectionOfRow(r) });

  // ---------------------------------------------------------------- 격납고 (행 0~33)
  fill(0, 0, COLS - 1, 1, T.WALL); fill(0, 0, 0, 33, T.WALL); fill(COLS - 1, 0, COLS - 1, 33, T.WALL);
  fill(8, 0, 9, 1, T.EXIT);   // 보스를 잡으면 열리는 이륙 격납고 문
  cov('crate', 3, 8); cov('crate', 14, 8); cov('barrier', 5, 16); cov('barrier', 12, 16); cov('barrel', 2, 14); cov('barrel', 15, 14); cov('stack', 8, 22); cov('crates2', 3, 26); cov('crates2', 14, 26); cov('barrier', 9, 28);
  en('boss', 9, 8);

  // ---------------------------------------------------------------- 건물 2개 층 (공통 구조)
  const interior = (b: number, left: number[], right: number[]): void => {
    fill(0, b, COLS - 1, b + 1, T.WALL); fill(0, b, 0, b + 33, T.WALL); fill(COLS - 1, b, COLS - 1, b + 33, T.WALL);
    fill(8, b, 9, b + 1, T.GATE);                          // 위층(다음 구역)으로 가는 잠긴 문: 이 층을 정리하면 열린다
    fill(6, b + 2, 6, b + 27, T.WALL); fill(11, b + 2, 11, b + 27, T.WALL);   // 복도와 방 사이 벽
    fill(0, b + 28, 6, b + 28, T.WALL); fill(11, b + 28, 17, b + 28, T.WALL);
    for (const r of [12, 20]) { fill(1, b + r, 5, b + r, T.WALL); fill(12, b + r, 16, b + r, T.WALL); }   // 방 칸막이
    for (const r of left) { set(6, b + r, T.DOOR); set(6, b + r + 1, T.DOOR); }     // 문은 두 칸 높이 (캐릭터 몸통이 지나갈 폭)
    for (const r of right) { set(11, b + r, T.DOOR); set(11, b + r + 1, T.DOOR); }
  };

  // 1층 (행 68~101)
  interior(68, [6, 16, 24], [8, 15, 25]);
  fill(6, 68 + 3, 6, 68 + 4, T.GLASS); fill(11, 68 + 21, 11, 68 + 22, T.GLASS); fill(6, 68 + 18, 6, 68 + 19, T.GLASS);
  cov('crate', 3, 68 + 4); cov('barrel', 1, 68 + 10); cov('crates2', 4, 68 + 16); cov('crate', 3, 68 + 25); cov('stack', 14, 68 + 5); cov('crate', 13, 68 + 17); cov('crates2', 14, 68 + 24);
  cov('barrier', 8, 68 + 12); cov('barrier', 9, 68 + 21); cov('crate', 8, 68 + 31); cov('crate', 14, 68 + 31); cov('barrel', 3, 68 + 31);
  en('rifle', 3, 68 + 6, { ang: 0 }); en('rifle', 2, 68 + 9, { ang: 0 }); en('charger', 3, 68 + 16, { ang: 0 }); en('rifle', 3, 68 + 24, { ang: 0 });
  en('rifle', 14, 68 + 5, { ang: Math.PI }); en('rifle', 14, 68 + 17, { ang: Math.PI }); en('rifle', 13, 68 + 24, { ang: Math.PI }); en('rifle', 15, 68 + 22, { ang: Math.PI });
  en('rifle', 8, 68 + 9, { patrol: [[tc(8), tc(68 + 9)], [tc(9), tc(68 + 24)]] }); en('rifle', 9, 68 + 26, { patrol: [[tc(9), tc(68 + 26)], [tc(8), tc(68 + 14)]] }); en('turret', 9, 68 + 31);
  wp('smg', 15, 68 + 10); wp('shotgun', 2, 68 + 25);

  // 2층 (행 34~67)
  interior(34, [5, 17, 25], [9, 14, 24]);
  fill(6, 34 + 8, 6, 34 + 10, T.GLASS); fill(11, 34 + 3, 11, 34 + 4, T.GLASS); fill(11, 34 + 17, 11, 34 + 18, T.GLASS); fill(6, 34 + 22, 6, 34 + 23, T.GLASS);
  cov('crates2', 2, 34 + 4); cov('crate', 4, 34 + 9); cov('barrel', 1, 34 + 15); cov('crate', 4, 34 + 18); cov('stack', 2, 34 + 24); cov('crate', 14, 34 + 5); cov('barrel', 16, 34 + 10); cov('crates2', 15, 34 + 17); cov('crate', 13, 34 + 25);
  cov('barrier', 8, 34 + 11); cov('barrier', 9, 34 + 19); cov('crate', 8, 34 + 31); cov('crate', 14, 34 + 30); cov('barrel', 3, 34 + 30);
  en('sniper', 2, 34 + 8, { ang: 0 }); en('rifle', 4, 34 + 4, { ang: 0 }); en('rifle', 3, 34 + 16, { ang: 0 }); en('heavy', 3, 34 + 24, { ang: 0 });
  en('rifle', 14, 34 + 4, { ang: Math.PI }); en('charger', 14, 34 + 10, { ang: Math.PI }); en('rifle', 14, 34 + 17, { ang: Math.PI }); en('heavy', 14, 34 + 25, { ang: Math.PI }); en('rifle', 15, 34 + 23, { ang: Math.PI });
  en('dog', 8, 34 + 8, { patrol: [[tc(8), tc(34 + 8)], [tc(9), tc(34 + 24)]] }); en('dog', 9, 34 + 20, { patrol: [[tc(9), tc(34 + 20)], [tc(8), tc(34 + 6)]] }); en('rifle', 8, 34 + 29, { patrol: [[tc(7), tc(34 + 29)], [tc(10), tc(34 + 31)]] }); en('turret', 4, 34 + 31); en('turret', 13, 34 + 31);
  wp('smg', 1, 34 + 8); wp('shotgun', 16, 34 + 24); wp('rail', 9, 34 + 14);

  // ---------------------------------------------------------------- 옥상 (행 102~131)
  fill(0, 102, COLS - 1, 103, T.WALL); fill(8, 102, 9, 103, T.GATE);   // 계단실
  fill(0, 104, 0, 131, T.LOW); fill(COLS - 1, 104, COLS - 1, 131, T.LOW); fill(0, 131, COLS - 1, 131, T.LOW);   // 난간: 이동만 막고 탄·시야는 통과
  cov('stack', 4, 108); cov('stack', 13, 108); cov('crates2', 8, 112); cov('barrier', 4, 118); cov('barrier', 13, 118); cov('crate', 9, 122); cov('barrel', 2, 114); cov('barrel', 15, 114); cov('crate', 3, 126); cov('crate', 14, 126); cov('stack', 7, 126); cov('stack', 10, 126);
  en('rifle', 5, 107, { ang: Math.PI / 2 }); en('rifle', 12, 107, { ang: Math.PI / 2 }); en('rifle', 4, 114, { ang: Math.PI / 2 }); en('rifle', 13, 114, { ang: Math.PI / 2 });
  en('rifle', 8, 117, { patrol: [[tc(3), tc(117)], [tc(14), tc(119)]] }); en('charger', 9, 110, { ang: Math.PI / 2 });
  wp('smg', 2, 121);
  return { tiles, spawns, covers, pickups, start: { x: tc(9), y: tc(128) } };
}

/** 타일 질의 (좌표는 px) */
export function tileAt(tiles: Uint8Array, x: number, y: number): number {
  const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return T.WALL;
  return tiles[r * COLS + c];
}

/** 두 점 사이에 시야/탄을 막는 타일이 있는가 (DDA 샘플링: 타일 절반 간격) */
export function rayBlocked(tiles: Uint8Array, x0: number, y0: number, x1: number, y1: number, test: (t: number) => boolean): boolean {
  const dx = x1 - x0, dy = y1 - y0, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (TILE / 2)));
  for (let i = 1; i < n; i++) if (test(tileAt(tiles, x0 + (dx * i) / n, y0 + (dy * i) / n))) return true;
  return false;
}

/** 목표 타일에서 퍼져 나가는 거리장(BFS). walk(c,r) 가 true 인 타일만 지나간다. 값 -1 = 도달 불가 */
export function flowField(tx: number, ty: number, walk: (c: number, r: number) => boolean, out?: Int16Array): Int16Array {
  const d = out ?? new Int16Array(COLS * ROWS); d.fill(-1);
  const c0 = Math.max(0, Math.min(COLS - 1, tx)), r0 = Math.max(0, Math.min(ROWS - 1, ty));
  const q = new Int32Array(COLS * ROWS); let h = 0, t = 0;
  d[r0 * COLS + c0] = 0; q[t++] = r0 * COLS + c0;
  while (h < t) {
    const i = q[h++], c = i % COLS, r = (i / COLS) | 0, nd = d[i] + 1;
    for (let k = 0; k < 4; k++) {
      const nc = c + (k === 0 ? 1 : k === 1 ? -1 : 0), nr = r + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const j = nr * COLS + nc; if (d[j] >= 0 || !walk(nc, nr)) continue;
      d[j] = nd; q[t++] = j;
    }
  }
  return d;
}
