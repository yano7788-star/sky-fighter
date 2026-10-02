import type { Boss, BossConfig, EnemyBullet, EnemyType, MidBossConfig, Rank } from './types';

// 보스 1~5 설정 (HP: 700/1300/1950/3900/6800 — 플레이어가 성장하는 로그라이트 구조에 맞춰 상향)
export const BOSS_CONFIGS: Record<number, BossConfig> = {
  1: { name: 'STAGE 1: TANK BUSTER',     hp: 700,  color: '#4d7c0f', subColor: '#bef264', w: 130, h: 110, shotCd: 44 },
  2: { name: 'STAGE 2: CYBER STEALTH',   hp: 1300, color: '#0284c7', subColor: '#38bdf8', w: 140, h: 120, shotCd: 38 },
  3: { name: 'STAGE 3: AEGIS FLAGSHIP',  hp: 1950, color: '#ca8a04', subColor: '#facc15', w: 150, h: 130, shotCd: 34 },
  4: { name: 'STAGE 4: HEAVY DESTROYER', hp: 3900, color: '#b91c1c', subColor: '#f87171', w: 155, h: 135, shotCd: 30 },
  5: { name: 'STAGE 5: VOID ARCHANGEL',  hp: 6800, color: '#7e22ce', subColor: '#c084fc', w: 165, h: 150, shotCd: 26 },
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

export const BOSS_PATTERNS: Record<number, [PhasePatterns, PhasePatterns, PhasePatterns?]> = {
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
    // 3페이즈 (최종 폭주): 촘촘한 회전 탄막 + 조준 부채꼴
    { 1: both(ring(14, 4.4, '#e879f9', 5.0, 20, f => f * 0.09), fan([-0.5, -0.25, 0, 0.25, 0.5], 5.6, '#fb7185', 6.0, 20, true)),
      2: both(ring(16, 2.4, '#c084fc', 6.5, 20, f => -f * 0.05), ring(10, 3.6, '#f472b6', 5.0, 20, f => f * 0.11)) },
  ],
};

export function fireBossPattern(b: Boss, c: PatternCtx): void {
  const tbl = BOSS_PATTERNS[b.tier];
  const set = (b.phase3 && tbl[2]) ? tbl[2] : tbl[b.phase2 ? 1 : 0];
  set![b.attackMode](b, c);
}

// ---------------------------------------------------------------------------
// 일반 적 4종 — 체력·점수·충돌 크기, 스테이지별 등장 비중
// ---------------------------------------------------------------------------
export interface EnemyDef { hp: number; score: number; hitR: number; bodyR: number; xp: number; }
export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  scout:    { hp: 2, score: 10, hitR: 20, bodyR: 14, xp: 3 },   // 직선 강하 + 가끔 사격
  zigzag:   { hp: 3, score: 20, hitR: 22, bodyR: 15, xp: 5 },   // 좌우로 흔들리며 내려오고 조준탄을 쏨
  kamikaze: { hp: 2, score: 15, hitR: 20, bodyR: 14, xp: 4 },   // 플레이어 쪽으로 가속하며 돌진
  sniper:   { hp: 5, score: 40, hitR: 26, bodyR: 18, xp: 10 },   // 상단에 멈춰서 조준 사격 후 퇴장
};
/** 스테이지(1~5)별 등장 가중치 */
export const ENEMY_WEIGHTS: Record<number, Partial<Record<EnemyType, number>>> = {
  1: { scout: 100 },
  2: { scout: 55, zigzag: 30, kamikaze: 15 },
  3: { scout: 35, zigzag: 25, kamikaze: 20, sniper: 20 },
  4: { scout: 25, zigzag: 25, kamikaze: 25, sniper: 25 },
  5: { scout: 20, zigzag: 25, kamikaze: 30, sniper: 25 },
};

// ---------------------------------------------------------------------------
// 중간보스 (스테이지 2·3): 메인 보스 전 등장, 부채꼴 사격 + 레이저
// ---------------------------------------------------------------------------
export const MID_CONFIGS: Record<number, MidBossConfig> = {
  2: { hp: 900, w: 100, h: 86, fanCount: 3, fanSpeed: 3.2, color: '#38bdf8' },
  3: { hp: 1500, w: 110, h: 94, fanCount: 5, fanSpeed: 3.0, color: '#facc15' },
};
export const MID_BOSS_AT = 0.55;           // 스테이지 전투 시간의 이 비율 지점에서 중간보스 등장

// ---------------------------------------------------------------------------
// 스테이지 진행: 점수가 아니라 '전투 시간'으로 보스가 등장한다 (콤보·그레이즈로 점수가 부풀어도 길이가 일정)
// ---------------------------------------------------------------------------
export const FIGHT_FRAMES: Record<number, number> = { 1: 2100, 2: 2400, 3: 2700, 4: 3000, 5: 3300 };   // 35 / 40 / 45 / 50 / 55초
/** 스테이지별 일반 적 스폰 간격(프레임) — 높은 스테이지일수록 촘촘 */
export const SPAWN_INTERVAL: Record<number, number> = { 1: 30, 2: 26, 3: 23, 4: 20, 5: 17 };
/** 스테이지가 오를수록 일반 적 체력 배율 */
export const enemyHpScale = (tier: number) => 1 + 0.14 * (tier - 1);
/** 적이 이 높이(y) 아래로 내려와 '화면 안'에 들어오기 전에는 맞지 않는다 (화면 밖에서 죽는 문제 방지) */
export const ON_SCREEN_Y = 14;

/** 하이퍼 모드: 탄을 스쳐 게이지를 채우면 자동 발동 — 탄 소거(+점수), 점수 ×2, 연사 +20% */
export const HYPER = { perGraze: 4, frames: 360, scoreMult: 2, rate: 1.2, bulletScore: 10 };
/** 유물·약점 노출 도입 후의 보스 체력 보정 */
export const BOSS_HP_MULT = 1.5;

/** 보스 특수 공격: 스테이지별 종류(순서대로 번갈아) — 1스테이지는 기본기만 */
export const BOSS_SPECIALS: Record<number, ('laser' | 'charge')[]> = { 2: ['laser'], 3: ['charge'], 4: ['laser', 'charge'], 5: ['laser', 'charge'] };
export const BOSS_SP = {
  cd: [420, 330, 250],            // 1·2·3페이즈 특수 공격 간격(프레임)
  laserWarn: 70, laserAct: 45, laserHalf: 34, laserDmg: 30, tripleOff: 120,   // 2페이즈부터 빔 3줄기(사이 틈으로 피한다)
  stun: 80, stunDmg: 1.6,   // 특수 공격을 넘기면 보스가 잠깐 멈추고 피해 ×2 (피한 뒤 반격하는 리듬)
  chargeWarn: 60, dashMax: 17, retSpeed: 6, chargeDmg: 40,
};

/** 스테이지 장애물 출현 간격(프레임). 2: 바람 / 3: 운석 / 4: 용암 기둥 / 5: 전부. 무한 모드 루프마다 12프레임씩 빨라진다 */
export const HAZARDS: Record<number, { meteor?: number; lava?: number; wind?: number }> = {
  2: { wind: 780 },
  3: { meteor: 210 },
  4: { lava: 240 },
  5: { meteor: 300, lava: 360, wind: 960 },
};
export const HAZARD = { meteorWarn: 60, meteorSpeed: 10, meteorR: 14, lavaWarn: 70, lavaDur: 40, lavaHalfW: 22, damage: 15, windWarn: 60, windDur: 180, windPush: 3.5, windBullet: 0.9, grace: 300 };

// ---------------------------------------------------------------------------
// 아이템 드랍: 한 번의 난수로 기본 4종, 별도 난수로 신규 3종
// ---------------------------------------------------------------------------
export const DROP_BASE: [number, 'P' | 'M' | 'E' | 'B'][] = [[0.04, 'P'], [0.07, 'M'], [0.105, 'E'], [0.113, 'B']];   // 누적 확률
export const DROP_EXTRA: [number, 'G' | 'L'][] = [[0.01, 'G'], [0.014, 'L']];

// ---------------------------------------------------------------------------
// 콤보 / 랭크
// ---------------------------------------------------------------------------
export const COMBO_WINDOW = 120;                       // 이 프레임 안에 다음 처치가 없으면 콤보 종료
export const comboMultiplier = (combo: number) => Math.min(2.5, 1 + Math.floor(combo / 6) * 0.25);
export const GRAZE_MARGIN = 16;                         // 탄이 플레이어 판정에서 이만큼 안쪽을 스치면 그레이즈
export const GRAZE_SCORE = 2;

/** 스테이지 중 피격 횟수로 랭크와 보너스 결정 */
export function rankFor(hits: number): { rank: Rank; bonus: number } {
  if (hits === 0) return { rank: 'S', bonus: 500 };
  if (hits === 1) return { rank: 'A', bonus: 300 };
  if (hits === 2) return { rank: 'B', bonus: 150 };
  return { rank: 'C', bonus: 0 };
}

// ---------------------------------------------------------------------------
// 동료 (고양이: 흡혈+유도탄 / 강아지: 방어막) — 아이템을 먹으면 버튼이 생기고, 누르면 8초간 출동. 스테이지당 각 1회
// ---------------------------------------------------------------------------
export const COMPANION_FRAMES = 480;
export const LIFESTEAL_RATE = 0.2;       // 준 피해의 20%를 에너지로 회복
export const LIFESTEAL_CAP = 0.8;        // 흡혈은 최대 에너지의 80%까지만
export const MOB_HIT_VALUE = 8;          // 일반 적 처치 1회를 피해량 8로 환산
export const SHIELD_R = 52;              // 강아지 방어막 반경
/** 처치 수가 쌓일수록 동료 아이템 드랍 확률 상승 (스테이지당 한 번은 거의 확실히 등장) */
export const companionDropChance = (pity: number) => Math.min(0.45, 0.01 + 0.004 * pity);

// ---------------------------------------------------------------------------
// 폭탄 (강화판): 즉시 피해 + 잠깐 남는 폭발장 + 무적
// ---------------------------------------------------------------------------
export const BOMB = {
  invincibleFrames: 90,
  fieldFrames: 70,            // 폭발장이 퍼지며 탄을 계속 지우고 피해를 주는 시간
  bossBurstPct: 0.12,         // 즉시: 보스/중간보스 최대 체력의 12% (최소 minBurst)
  minBurst: 60,
  fieldPctTotal: 0.08,        // 폭발장 동안 누적: 최대 체력의 8%
  fieldRadiusMax: 560,
};

// ---------------------------------------------------------------------------
// 궁극기 「자매의 손바닥」 — 게이지가 가득 차면 사용. 컷인 → 손바닥 낙하 → 화면 전체 피해
// ---------------------------------------------------------------------------
/** 파일럿별 궁극기 */
export const ULT_KIND = {
  palm:     { name: '자매의 손바닥', owner: '에이스', cutin: 120 },
  barrage:  { name: '미사일 포격',   owner: '언니',   cutin: 90, active: 200, invincible: 210, dmg: 4.2, interval: 3 },   // 약 3.3초간 위에서 미사일 비
  timestop: { name: '시간 정지',     owner: '동생',   cutin: 90, active: 150, boost: 1.5 },                                // 2.5초간 적·탄 정지, 내 피해 1.5배
} as const;

export const ULT = {
  frames: { CUTIN: 120, FALL: 75, IMPACT: 60 },
  enemyPct: 0.5,              // 일반 적·중간보스: 최대 체력의 50%
  bossPct: 0.3,               // 메인 보스: 30%
  gaugePerXp: 0.7,            // 처치 시 게이지 = 경험치값 × 0.7
  gaugePerGraze: 0.2,
  gaugeMidBoss: 15,
  gaugeBoss: 20,
};
