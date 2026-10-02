import type { Boss, BossConfig, EnemyBullet } from './types';

// 보스 1~5 설정 (HP: 200/380/620/970/1500)
export const BOSS_CONFIGS: Record<number, BossConfig> = {
  1: { name: 'STAGE 1: TANK BUSTER',     hp: 200,  color: '#4d7c0f', subColor: '#bef264', w: 130, h: 110, shotCd: 44 },
  2: { name: 'STAGE 2: CYBER STEALTH',   hp: 380,  color: '#0284c7', subColor: '#38bdf8', w: 140, h: 120, shotCd: 38 },
  3: { name: 'STAGE 3: AEGIS FLAGSHIP',  hp: 620,  color: '#ca8a04', subColor: '#facc15', w: 150, h: 130, shotCd: 34 },
  4: { name: 'STAGE 4: HEAVY DESTROYER', hp: 970,  color: '#b91c1c', subColor: '#f87171', w: 155, h: 135, shotCd: 30 },
  5: { name: 'STAGE 5: VOID ARCHANGEL',  hp: 1500, color: '#7e22ce', subColor: '#c084fc', w: 165, h: 150, shotCd: 26 },
};

// ---------------------------------------------------------------------------
// 보스 탄막 패턴 — 선언형 테이블
//   BOSS_PATTERNS[티어][0=1페이즈 | 1=2페이즈][공격모드 1|2] = 발사 함수
// ---------------------------------------------------------------------------
export interface PatternCtx {
  player: { x: number; y: number };
  frame: number;
  emit(b: EnemyBullet): void;
}
export type Pattern = (b: Boss, c: PatternCtx) => void;

// 플레이어를 정확히 조준하는 각도 (vx = sin(ang), vy = cos(ang) 규약)
const aimAng = (b: Boss, c: PatternCtx) => Math.atan2(c.player.x - b.x, c.player.y - b.y);
const shot = (b: Boss, c: PatternCtx, ox: number, oy: number, vx: number, vy: number, color: string, r: number) =>
  c.emit({ x: b.x + ox, y: b.y + oy, vx, vy, color, r });

/** 부채꼴. offs: 라디안 오프셋, aim=true면 플레이어 조준 기준 */
const fan = (offs: number[], spd: number, color: string, r: number, oy: number, aim = false): Pattern => (b, c) => {
  const base = aim ? aimAng(b, c) : 0;
  for (const o of offs) shot(b, c, 0, oy, Math.sin(base + o) * spd, Math.cos(base + o) * spd, color, r);
};
/** 원형. n방향, rot: 숫자 또는 (frame) => 회전각 */
const ring = (n: number, spd: number, color: string, r: number, oy: number, rot: number | ((frame: number) => number) = 0): Pattern => (b, c) => {
  const base = typeof rot === 'function' ? rot(c.frame) : rot;
  for (let a = 0; a < n; a++) {
    const ang = (Math.PI * 2 / n) * a + base;
    shot(b, c, 0, oy, Math.cos(ang) * spd, Math.sin(ang) * spd, color, r);
  }
};
/** 일직선 탄. xs: 가로 오프셋, spread>0이면 바깥쪽으로 살짝 퍼짐 */
const line = (xs: number[], vy: number, color: string, r: number, oy: number, spread = 0): Pattern => (b, c) => {
  for (const ox of xs) shot(b, c, ox, oy, spread ? (ox / 40) * spread : 0, vy, color, r);
};
const both = (...fns: Pattern[]): Pattern => (b, c) => { for (const f of fns) f(b, c); };

type PhasePatterns = { 1: Pattern; 2: Pattern };

export const BOSS_PATTERNS: Record<number, [PhasePatterns, PhasePatterns]> = {
  1: [
    { 1: line([-20, 20], 3.4, '#facc15', 4.5, 35),            2: fan([-0.3, 0, 0.3], 2.0, '#fb923c', 5.5, 35) },
    { 1: line([-32, -12, 12, 32], 4.2, '#facc15', 4.8, 35),   2: fan([-0.22, 0, 0.22], 3.2, '#ea580c', 6.5, 35, true) },
  ],
  2: [
    { 1: fan([-0.3, 0, 0.3], 4.2, '#38bdf8', 4.5, 40),        2: fan([-0.5, -0.25, 0, 0.25, 0.5], 2.1, '#06b6d4', 5.5, 40) },
    { 1: fan([-0.5, -0.33, -0.16, 0, 0.16, 0.33, 0.5], 4.8, '#38bdf8', 4.5, 40), 2: ring(8, 2.4, '#06b6d4', 5.5, 40, f => f * 0.08) },
  ],
  3: [
    { 1: fan([-0.4, -0.2, 0, 0.2, 0.4], 3.6, '#fde047', 4.5, 45), 2: fan([-0.6, -0.3, 0, 0.3, 0.6], 1.8, '#fef08a', 6.5, 45) },
    { 1: ring(8, 3.4, '#facc15', 5.0, 45, 0.39),              2: fan([-0.35, -0.15, 0.15, 0.35], 2.2, '#fef08a', 7.0, 45, true) },
  ],
  4: [
    { 1: fan([-0.3, -0.1, 0.1, 0.3], 3.8, '#f87171', 4.5, 35), 2: ring(8, 2.0, '#ef4444', 5.5, 35) },
    { 1: line([-40, -24, -8, 8, 24, 40], 4.0, '#f87171', 4.8, 35, 1.2), 2: ring(10, 2.2, '#ef4444', 6.0, 35) },
  ],
  5: [
    { 1: ring(8, 3.8, '#c084fc', 4.5, 20, f => f * 0.04),     2: ring(12, 2.0, '#f472b6', 6.5, 20, f => -f * 0.02) },
    { 1: ring(12, 4.2, '#c084fc', 4.8, 20, f => f * 0.06),
      2: both(fan([-0.18, 0, 0.18], 5.2, '#f472b6', 6.0, 20, true), ring(8, 1.8, '#e879f9', 7.0, 20, f => -f * 0.03)) },
  ],
};

export function fireBossPattern(b: Boss, c: PatternCtx): void {
  BOSS_PATTERNS[b.tier][b.phase2 ? 1 : 0][b.attackMode](b, c);
}
