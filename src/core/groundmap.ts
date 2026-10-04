/**
 * 지상전 맵 (핫라인식 스크롤 맵): 옥상 → 건물 1층 → 2층 → 격납고. 아래에서 위로 올라간다.
 * 타일 64px, 18열 × 132행 = 1152 × 8448 (월드 px). 그림 한 도트 = 월드 4px 이므로 한 타일 = 16도트.
 * 벽만 타일이고, 문·유리창·상자·통(폭발)은 오브젝트(파괴 규칙은 ground.ts). 순수 데이터 (Phaser 무관).
 */
import type { GKind, WeaponId } from './ground';

export const TILE = 64, COLS = 18, ROWS = 132, WORLD_W = COLS * TILE, WORLD_H = ROWS * TILE;
export const ART = 4;   // 월드 px / 도트
export const T = { FLOOR: 0, WALL: 1 } as const;

export type FloorStyle = 'roof' | 'indoor' | 'hangar' | 'yard' | 'bunker' | 'cells' | 'pad';
export interface SectionDef { id: number; name: string; r0: number; r1: number; floor: FloorStyle }
export const SECTIONS: SectionDef[] = [
  { id: 0, name: '옥상', r0: 102, r1: 131, floor: 'roof' },
  { id: 1, name: '건물 1층', r0: 68, r1: 101, floor: 'indoor' },
  { id: 2, name: '건물 2층', r0: 34, r1: 67, floor: 'indoor' },
  { id: 3, name: '격납고', r0: 0, r1: 33, floor: 'hangar' },
];
/** 인질 구출 임무(야간 수용소): 같은 행 범위를 쓰되 이름과 바닥 종류가 다르다 */
export const SECTIONS_RESCUE: SectionDef[] = [
  { id: 0, name: '외곽 침투', r0: 102, r1: 131, floor: 'yard' },
  { id: 1, name: '지하 통로', r0: 68, r1: 101, floor: 'bunker' },
  { id: 2, name: '감방동', r0: 34, r1: 67, floor: 'cells' },
  { id: 3, name: '옥상 헬기장', r0: 0, r1: 33, floor: 'pad' },
];
export type MissionKind = 'assault' | 'rescue';
export const sectionsOf = (m: MissionKind): SectionDef[] => (m === 'rescue' ? SECTIONS_RESCUE : SECTIONS);
export const sectionOfRow = (r: number): number => (r < 34 ? 3 : r < 68 ? 2 : r < 102 ? 1 : 0);

/** 통로 사각형(타일 단위) — 문·유리창·잠긴 문(게이트) 공통 */
export interface MapDoor { c: number; r: number; w: number; h: number; o: 'v' | 'h'; kind: 'door' | 'gate' | 'exit'; section: number }
export interface MapWindow { c: number; r: number; w: number; h: number; o: 'v' | 'h'; section: number }
export interface MapCrate { c: number; r: number; kind: 'crate' | 'barrel'; section: number }
export interface MapSpawn { k: GKind; x: number; y: number; section: number; patrol?: [number, number][]; ang?: number }
export interface MapPickup { weapon: WeaponId; x: number; y: number; section: number }
export type BombKind = 'frag' | 'flash' | 'smoke';
export interface Level { hostage?: { x: number; y: number }; reinforce?: { x: number; y: number; section: number }[]; bombPickups?: { bt: BombKind; x: number; y: number; section: number }[]; tiles: Uint8Array; doors: MapDoor[]; windows: MapWindow[]; crates: MapCrate[]; spawns: MapSpawn[]; pickups: MapPickup[]; start: { x: number; y: number } }

const tc = (t: number): number => (t + 0.5) * TILE;

export function buildLevel(): Level {
  const tiles = new Uint8Array(COLS * ROWS);
  const set = (c: number, r: number, t: number) => { if (c >= 0 && c < COLS && r >= 0 && r < ROWS) tiles[r * COLS + c] = t; };
  const fill = (c0: number, r0: number, c1: number, r1: number, t: number) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) set(c, r, t); };
  const doors: MapDoor[] = [], windows: MapWindow[] = [], crates: MapCrate[] = [], spawns: MapSpawn[] = [], pickups: MapPickup[] = [];
  const en = (k: GKind, c: number, r: number, extra: Partial<MapSpawn> = {}) => spawns.push({ k, x: tc(c), y: tc(r), section: sectionOfRow(r), ...extra });
  const crate = (c: number, r: number) => crates.push({ c, r, kind: 'crate', section: sectionOfRow(r) });
  const barrel = (c: number, r: number) => crates.push({ c, r, kind: 'barrel', section: sectionOfRow(r) });
  const wp = (weapon: WeaponId, c: number, r: number) => pickups.push({ weapon, x: tc(c), y: tc(r), section: sectionOfRow(r) });
  const door = (c: number, r: number, w: number, h: number, o: 'v' | 'h', kind: MapDoor['kind'] = 'door') => doors.push({ c, r, w, h, o, kind, section: sectionOfRow(r) });
  const win = (c: number, r: number, w: number, h: number, o: 'v' | 'h') => windows.push({ c, r, w, h, o, section: sectionOfRow(r) });

  // ---------------------------------------------------------------- 격납고 (행 0~33)
  fill(0, 0, COLS - 1, 1, T.WALL); fill(0, 0, 0, 33, T.WALL); fill(COLS - 1, 0, COLS - 1, 33, T.WALL);
  fill(8, 0, 9, 1, T.FLOOR); door(8, 0, 2, 2, 'h', 'exit');   // 보스를 잡으면 열리는 이륙 격납고 문
  crate(3, 9); crate(4, 9); crate(13, 9); crate(14, 9); crate(6, 16); crate(7, 16); crate(10, 16); crate(11, 16); barrel(2, 14); barrel(15, 14); crate(8, 22); crate(9, 22); crate(3, 26); crate(14, 26); crate(8, 29); crate(9, 29);
  fill(1, 19, 4, 19, T.WALL); fill(13, 13, 13, 15, T.WALL); fill(15, 23, 16, 23, T.WALL);   // 엄폐 벽(좌우가 다르다)
  en('boss', 9, 9);

  // ---------------------------------------------------------------- 건물 층 (공통 구조): 방 6개(좌우 3개씩) + 복도 + 로비
  const interior = (b: number, left: number[], right: number[], winL: number[], winR: number[], divL: number[], divR: number[], pillars: [number, number, number][]): void => {   // 좌우 칸막이 행(divL/divR)이 서로 달라 방 크기가 비대칭, pillars=[열,시작행,끝행] 복도 기둥
    fill(0, b, COLS - 1, b + 1, T.WALL); fill(0, b, 0, b + 33, T.WALL); fill(COLS - 1, b, COLS - 1, b + 33, T.WALL);
    set(8, b, T.FLOOR); set(9, b, T.FLOOR); set(8, b + 1, T.FLOOR); set(9, b + 1, T.FLOOR); door(8, b, 2, 2, 'h', 'gate');   // 위층으로 가는 잠긴 문 (층을 정리하면 열림)
    fill(6, b + 2, 6, b + 27, T.WALL); fill(11, b + 2, 11, b + 27, T.WALL);
    fill(0, b + 28, 6, b + 28, T.WALL); fill(11, b + 28, 17, b + 28, T.WALL);
    for (const r of divL) fill(1, b + r, 5, b + r, T.WALL);
    for (const r of divR) fill(12, b + r, 16, b + r, T.WALL);
    for (const [c, r0, r1] of pillars) fill(c, b + r0, c, b + r1, T.WALL);
    for (const r of left) { fill(6, b + r, 6, b + r + 1, T.FLOOR); door(6, b + r, 1, 2, 'v'); }
    for (const r of right) { fill(11, b + r, 11, b + r + 1, T.FLOOR); door(11, b + r, 1, 2, 'v'); }
    for (const r of winL) { fill(6, b + r, 6, b + r + 1, T.FLOOR); win(6, b + r, 1, 2, 'v'); }
    for (const r of winR) { fill(11, b + r, 11, b + r + 1, T.FLOOR); win(11, b + r, 1, 2, 'v'); }
  };

  // 1층 (행 68~101)
  interior(68, [6, 16, 24], [5, 14, 24], [3, 18], [21], [12, 20], [10, 19], []);
  crate(3, 72); crate(1, 78); barrel(1, 79); crate(4, 84); crate(3, 93); crate(13, 73); crate(14, 73); crate(13, 85); crate(14, 92); crate(15, 92);
  crate(7, 80); crate(8, 80); crate(9, 89); crate(10, 89); crate(7, 99); crate(14, 99); barrel(2, 99);
  en('rifle', 3, 74, { ang: 0 }); en('rifle', 2, 77, { ang: 0 }); en('charger', 3, 85, { ang: 0 }); en('rifle', 2, 94, { ang: 0 });
  en('rifle', 15, 74, { ang: 180 }); en('rifle', 14, 85, { ang: 180 }); en('rifle', 13, 93, { ang: 180 }); en('rifle', 15, 91, { ang: 180 });
  en('rifle', 8, 77, { patrol: [[tc(8), tc(77)], [tc(9), tc(92)]] }); en('rifle', 9, 94, { patrol: [[tc(9), tc(94)], [tc(8), tc(82)]] }); en('turret', 9, 99);
  wp('smg', 15, 76); wp('shotgun', 2, 93);

  // 2층 (행 34~67)
  interior(34, [5, 17, 25], [9, 14, 24], [8, 19], [3, 15], [14, 22], [11, 18], []);
  crate(2, 38); crate(3, 38); crate(4, 43); crate(1, 49); barrel(1, 50); crate(4, 52); crate(2, 58); crate(3, 58); crate(14, 39); crate(15, 44); barrel(16, 44); crate(15, 51); crate(13, 59);
  crate(7, 45); crate(8, 45); crate(9, 53); crate(10, 53); crate(8, 65); crate(14, 64); barrel(3, 64);
  en('sniper', 2, 42, { ang: 0 }); en('rifle', 4, 38, { ang: 0 }); en('rifle', 3, 50, { ang: 0 }); en('heavy', 4, 59, { ang: 0 });
  en('rifle', 14, 38, { ang: 180 }); en('charger', 14, 44, { ang: 180 }); en('rifle', 14, 51, { ang: 180 }); en('heavy', 14, 59, { ang: 180 }); en('rifle', 15, 57, { ang: 180 });
  en('dog', 8, 42, { patrol: [[tc(8), tc(42)], [tc(9), tc(58)]] }); en('dog', 9, 54, { patrol: [[tc(9), tc(54)], [tc(8), tc(40)]] }); en('rifle', 8, 63, { patrol: [[tc(7), tc(63)], [tc(10), tc(65)]] }); en('turret', 4, 65); en('turret', 13, 65);
  wp('smg', 1, 42); wp('shotgun', 16, 58); wp('rail', 9, 48);

  // ---------------------------------------------------------------- 옥상 (행 102~131)
  fill(0, 102, COLS - 1, 103, T.WALL);   // 계단실
  set(8, 102, T.FLOOR); set(9, 102, T.FLOOR); set(8, 103, T.FLOOR); set(9, 103, T.FLOOR); door(8, 102, 2, 2, 'h', 'gate');
  fill(0, 104, 0, 131, T.WALL); fill(COLS - 1, 104, COLS - 1, 131, T.WALL); fill(0, 131, COLS - 1, 131, T.WALL);   // 옥상 가장자리 벽
  crate(4, 108); crate(4, 109); crate(14, 109); crate(15, 109); crate(15, 108); crate(8, 112); crate(9, 112); crate(4, 118); crate(5, 118); crate(11, 121); crate(12, 121); crate(9, 122); barrel(2, 114); barrel(15, 114); crate(3, 126); crate(14, 126); crate(7, 126); crate(10, 126);
  en('rifle', 5, 107, { ang: 90 }); en('rifle', 12, 107, { ang: 90 }); en('rifle', 4, 114, { ang: 90 }); en('rifle', 13, 114, { ang: 90 });
  en('rifle', 8, 117, { patrol: [[tc(3), tc(117)], [tc(14), tc(119)]] }); en('charger', 9, 110, { ang: 90 });
  fill(12, 113, 15, 113, T.WALL); fill(12, 113, 12, 115, T.WALL);   // 옥상 오른쪽 환기구 엄폐벽
  wp('smg', 2, 121); wp('silenced', 7, 124);   // 시작 지점 근처: 소음기 권총
  return { tiles, doors, windows, crates, spawns, pickups, start: { x: tc(9), y: tc(128) } };
}

/**
 * 인질 구출 임무 맵 (야간 수용소): 외곽 마당 → 지하 통로(뱀 모양) → 감방동(인질) → 옥상 헬기장.
 * 3스테이지 건물 맵과 달리 방 칸막이가 아니라 마당·미로 복도·감방·열린 옥상으로 이뤄진다. 아래 두 문은 열려 있고(정리 불필요), 감방동→헬기장 문은 인질을 풀면 열린다.
 */
export function buildRescueLevel(): Level {
  const tiles = new Uint8Array(COLS * ROWS);
  const set = (c: number, r: number, t: number) => { if (c >= 0 && c < COLS && r >= 0 && r < ROWS) tiles[r * COLS + c] = t; };
  const fill = (c0: number, r0: number, c1: number, r1: number, t: number) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) set(c, r, t); };
  const doors: MapDoor[] = [], windows: MapWindow[] = [], crates: MapCrate[] = [], spawns: MapSpawn[] = [], pickups: MapPickup[] = [], bombPickups: NonNullable<Level['bombPickups']> = [];
  const en = (k: GKind, c: number, r: number, extra: Partial<MapSpawn> = {}) => spawns.push({ k, x: tc(c), y: tc(r), section: sectionOfRow(r), ...extra });
  const crate = (c: number, r: number) => crates.push({ c, r, kind: 'crate', section: sectionOfRow(r) });
  const barrel = (c: number, r: number) => crates.push({ c, r, kind: 'barrel', section: sectionOfRow(r) });
  const wp = (weapon: WeaponId, c: number, r: number) => pickups.push({ weapon, x: tc(c), y: tc(r), section: sectionOfRow(r) });
  const bp = (bt: BombKind, c: number, r: number) => bombPickups.push({ bt, x: tc(c), y: tc(r), section: sectionOfRow(r) });
  const door = (c: number, r: number, w: number, h: number, o: 'v' | 'h', kind: MapDoor['kind'] = 'door') => doors.push({ c, r, w, h, o, kind, section: sectionOfRow(r) });
  const win = (c: number, r: number, w: number, h: number, o: 'v' | 'h') => windows.push({ c, r, w, h, o, section: sectionOfRow(r) });
  const band = (b: number, kind: MapDoor['kind']) => { fill(0, b, COLS - 1, b + 1, T.WALL); fill(8, b, 9, b + 1, T.FLOOR); door(8, b, 2, 2, 'h', kind); };
  const gapRow = (r: number, g0: number, g1: number) => { fill(1, r, COLS - 2, r, T.WALL); fill(g0, r, g1, r, T.FLOOR); };   // 한 줄 벽, 틈 [g0..g1]
  fill(0, 0, 0, ROWS - 1, T.WALL); fill(COLS - 1, 0, COLS - 1, ROWS - 1, T.WALL); fill(0, ROWS - 1, COLS - 1, ROWS - 1, T.WALL);

  // ---------------------------------------------------------------- 옥상 헬기장 (행 0~33): 열린 옥상, 불규칙한 콘크리트 장벽
  band(0, 'exit'); band(34, 'gate');
  fill(3, 28, 7, 28, T.WALL); fill(11, 24, 15, 24, T.WALL); fill(5, 17, 5, 21, T.WALL); fill(12, 11, 12, 15, T.WALL); fill(2, 8, 6, 8, T.WALL); fill(14, 5, 16, 5, T.WALL); fill(9, 14, 10, 14, T.WALL);
  crate(8, 30); crate(14, 29); crate(2, 24); crate(3, 24); crate(15, 18); crate(16, 18); crate(9, 20); crate(13, 8); crate(7, 12); barrel(4, 14); barrel(15, 10); barrel(10, 26);
  en('sniper', 15, 9, { ang: 180 }); en('heavy', 3, 22, { ang: 0 }); en('rifle', 3, 13, { ang: 0 }); en('rifle', 13, 21, { ang: 180 }); en('turret', 2, 4);
  const reinforce = [{ x: tc(2), y: tc(17), section: 3 }, { x: tc(15), y: tc(19), section: 3 }, { x: tc(2), y: tc(27), section: 3 }];

  // ---------------------------------------------------------------- 감방동 (행 34~67): 가운데 복도, 왼쪽 경비실, 오른쪽 감방 4칸
  fill(11, 37, 16, 37, T.WALL); fill(11, 38, 11, 61, T.WALL); for (const r of [43, 49, 55]) fill(12, r, 16, r, T.WALL); fill(12, 61, 16, 61, T.WALL);
  for (const r of [39, 45, 51, 57]) { fill(11, r, 11, r + 1, T.FLOOR); door(11, r, 1, 2, 'v'); }   // 감방 문
  for (const r of [41, 47, 53, 59]) { fill(11, r, 11, r + 1, T.FLOOR); win(11, r, 1, 2, 'v'); }    // 감방 창(복도에서 던져 넣을 수 있다)
  fill(1, 55, 6, 55, T.WALL); fill(1, 66, 6, 66, T.WALL); fill(6, 55, 6, 66, T.WALL);          // 왼쪽 경비실 (열린 쪽 = 아래 오른쪽)
  fill(6, 58, 6, 59, T.FLOOR); door(6, 58, 1, 2, 'v'); fill(6, 62, 6, 63, T.FLOOR); win(6, 62, 1, 2, 'v');
  fill(1, 44, 4, 44, T.WALL);   // 왼쪽 위 서류 벽
  crate(8, 44); crate(9, 44); crate(7, 52); crate(10, 60); crate(8, 64); crate(2, 50); crate(3, 50); crate(2, 63); barrel(9, 40); barrel(1, 47); crate(14, 47); crate(13, 58);
  en('rifle', 14, 41, { ang: 180 }); en('charger', 14, 59, { ang: 180 }); en('rifle', 8, 41, { patrol: [[tc(8), tc(41)], [tc(9), tc(63)]] }); en('heavy', 10, 47, { ang: 90 });
  en('rifle', 3, 62, { ang: 0 }); en('rifle', 4, 58, { ang: 0 }); en('dog', 3, 52, { patrol: [[tc(2), tc(52)], [tc(5), tc(50)]] });
  wp('silenced', 14, 46); bp('flash', 14, 53 + 1); bp('smoke', 2, 65);
  const hostage = { x: tc(14), y: tc(52) };

  // ---------------------------------------------------------------- 지하 통로 (행 68~101): 틈이 번갈아 나는 뱀 모양 복도 + 유리 관측창
  band(68, 'door');
  gapRow(96, 14, 16); gapRow(90, 1, 3); gapRow(84, 14, 16); gapRow(78, 1, 3); gapRow(72, 8, 9);
  for (const [c, r] of [[6, 96], [7, 96], [9, 90], [10, 90], [6, 84], [7, 84], [11, 78], [12, 78]] as [number, number][]) { set(c, r, T.FLOOR); }
  win(6, 96, 2, 1, 'h'); win(9, 90, 2, 1, 'h'); win(6, 84, 2, 1, 'h'); win(11, 78, 2, 1, 'h');
  fill(8, 98, 8, 100, T.WALL); fill(4, 92, 4, 94, T.WALL); fill(11, 86, 11, 88, T.WALL); fill(7, 80, 7, 82, T.WALL); fill(13, 74, 13, 76, T.WALL);
  crate(2, 99); crate(3, 99); crate(13, 99); crate(14, 98); crate(10, 93); crate(11, 93); crate(2, 87); crate(15, 87); crate(15, 81); crate(2, 75); crate(3, 75); crate(10, 76); barrel(16, 94); barrel(1, 82);
  en('rifle', 4, 99, { ang: 0 }); en('rifle', 3, 93, { patrol: [[tc(2), tc(93)], [tc(13), tc(94)]] }); en('sniper', 15, 92, { ang: 180 }); en('charger', 3, 87, { ang: 0 }); en('rifle', 9, 86, { ang: 90 });
  en('rifle', 12, 81, { ang: 180 }); en('rifle', 14, 79, { ang: 180 }); en('dog', 5, 80, { patrol: [[tc(3), tc(81)], [tc(14), tc(82)]] }); en('heavy', 9, 75, { ang: 90 }); en('turret', 16, 74);
  wp('silenced', 2, 100); wp('smg', 15, 88);
  bp('smoke', 15, 98); bp('flash', 2, 82);

  // ---------------------------------------------------------------- 외곽 침투 (행 102~131): 야간 마당, 경비초소, 콘크리트 장벽, 차량(상자)
  band(102, 'door');
  fill(2, 116, 6, 116, T.WALL); fill(2, 121, 6, 121, T.WALL); fill(2, 116, 2, 121, T.WALL); fill(6, 116, 6, 121, T.WALL);
  fill(6, 117, 6, 118, T.FLOOR); door(6, 117, 1, 2, 'v'); fill(6, 119, 6, 120, T.FLOOR); win(6, 119, 1, 2, 'v');   // 초소: 문 + 유리창
  fill(9, 124, 13, 124, T.WALL); fill(13, 124, 13, 126, T.WALL); fill(3, 108, 3, 112, T.WALL); fill(6, 110, 10, 110, T.WALL); fill(13, 112, 16, 112, T.WALL); fill(10, 118, 10, 120, T.WALL);
  crate(11, 115); crate(12, 115); crate(11, 116); crate(14, 108); crate(15, 108); crate(7, 126); crate(6, 126); crate(4, 124); crate(15, 120); crate(16, 120); crate(8, 106); barrel(13, 106); barrel(1, 112); barrel(16, 128);
  en('rifle', 4, 119, { ang: 0 }); en('rifle', 4, 107, { patrol: [[tc(4), tc(107)], [tc(12), tc(108)]] }); en('rifle', 14, 118, { ang: 180 }); en('rifle', 9, 113, { ang: 90 }); en('dog', 2, 105, { patrol: [[tc(2), tc(105)], [tc(15), tc(106)]] }); en('rifle', 14, 104, { ang: 90 });
  wp('silenced', 3, 119); bp('flash', 13, 120); bp('smoke', 1, 124);
  return { tiles, doors, windows, crates, spawns, pickups, bombPickups, hostage, reinforce, start: { x: tc(9), y: tc(128) } };
}

/** 목표 타일에서 퍼져 나가는 거리장(BFS, 8방향). walk(c,r) 가 true 인 타일만 지나간다. 값 -1 = 도달 불가 */
export function flowField(tx: number, ty: number, walk: (c: number, r: number) => boolean, out?: Int16Array): Int16Array {
  const d = out ?? new Int16Array(COLS * ROWS); d.fill(-1);
  const c0 = Math.max(0, Math.min(COLS - 1, tx)), r0 = Math.max(0, Math.min(ROWS - 1, ty));
  const q = new Int32Array(COLS * ROWS); let h = 0, t = 0;
  d[r0 * COLS + c0] = 0; q[t++] = r0 * COLS + c0;
  while (h < t) {
    const i = q[h++], c = i % COLS, r = (i / COLS) | 0, nd = d[i] + 1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nc = c + dx, nr = r + dy; if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const j = nr * COLS + nc; if (d[j] >= 0 || !walk(nc, nr)) continue;
      if (dx && dy && (!walk(c + dx, r) || !walk(c, r + dy))) continue;   // 대각선은 양옆이 모두 통과 가능할 때만
      d[j] = nd; q[t++] = j;
    }
  }
  return d;
}
