// 게임 전역 상수 — 논리 해상도는 고정(9:16)이고 화면 크기에 맞춰 Phaser Scale(FIT)이 확대/축소한다.
export const W = 450;
export const H = 800;

export const STEP_MS = 1000 / 60;   // 고정 타임스텝 (게임 로직은 항상 60Hz)

// 스테이지 진행 단계 길이(프레임)
export const PHASE_FRAMES = { WARNING: 130, BOSS_DYING: 80, CLEAR: 120, INTRO: 150 } as const;

export const PLAYER = {
  radius: 22,
  maxEnergy: 100,
  startLives: 2,
  startBombs: 1,
  maxBombs: 2,
  spawnY: H - 140,
  minX: 38, maxX: W - 38,
  minY: 45, maxY: H - 45,
} as const;

export const FIRST_BOSS_SCORE = 250;     // 첫 보스 등장 점수
export const NEXT_BOSS_SCORE_STEP = 450; // 이후 스테이지: 클리어 시점 점수 + 450
export const MAX_TIER = 5;
