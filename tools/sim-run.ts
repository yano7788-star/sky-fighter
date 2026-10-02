// 헤드리스 밸런스 시뮬레이터 (Node). 브라우저 없이 수천 판을 돌려 난이도 곡선을 측정한다.
//   npm run sim                      기본: 시드 200개, 1스테이지부터
//   npm run sim -- --seeds 500 --skill 0.6 --tier 3
// 봇은 "탄을 피하는 약~중간 실력 플레이어" — 사람 실력의 하한선으로 해석할 것.
import { H, W } from '../src/core/config';
import { Sim } from '../src/core/sim';

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const SEEDS = arg('seeds', 200);
const START_TIER = arg('tier', 1);
const SKILL = arg('skill', 0.7);          // 0~1: 회피 반응거리/폭탄 판단 정확도
const MAX_SECONDS = arg('max', 900);

interface RunResult { stage: number; cleared: boolean; seconds: number; score: number; lives: number; bombsUsed: number; deathPhase: string; }

function runOne(seed: number): RunResult {
  const s = new Sim(seed);
  if (START_TIER > 1) s.startAtTier(START_TIER);
  let bombsUsed = 0;
  const reaction = 70 + SKILL * 70;       // 이 거리 안의 탄을 피한다
  const maxF = 60 * MAX_SECONDS;
  for (let f = 0; f < maxF && s.state === 'PLAYING'; f++) {
    const p = s.player;
    let tx = s.boss ? s.boss.x : (s.enemies.length ? nearestEnemyX(s) : W / 2);
    let near: { x: number; y: number } | null = null, nd = 1e9, danger = 0;
    for (const b of s.enemyBullets) {
      if (b.y > p.y + 20) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < reaction) danger++;
      if (d < nd) { nd = d; near = b; }
    }
    if (near && nd < reaction) {
      const dir = near.x < p.x ? 1 : -1;
      tx = p.x + dir * 70;
      if (p.x < 70) tx = p.x + 70; else if (p.x > W - 70) tx = p.x - 70;
    }
    const bomb = s.bombs > 0 && (nd < 45 * SKILL + 15 || danger > 14) && (f % 7 === 0);
    if (bomb) bombsUsed++;
    s.step({ targetX: Math.max(40, Math.min(W - 40, tx)), targetY: H - 120, fire: true, bomb });
    s.drainEvents();
  }
  return { stage: s.bossTier, cleared: s.state === 'GAMECLEAR', seconds: s.frame / 60, score: s.score, lives: s.lives, bombsUsed, deathPhase: s.stagePhase };
}
function nearestEnemyX(s: Sim): number {
  let best = s.enemies[0];
  for (const e of s.enemies) if (e.y > best.y) best = e;
  return best.x;
}

const results: RunResult[] = [];
for (let i = 1; i <= SEEDS; i++) results.push(runOne(i));

const pct = (n: number) => (100 * n / results.length).toFixed(1) + '%';
const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
console.log(`seeds=${SEEDS} startTier=${START_TIER} skill=${SKILL}`);
console.log(`클리어율 ${pct(results.filter(r => r.cleared).length)} | 평균 플레이 ${avg(r => r.seconds)}s | 평균 점수 ${avg(r => r.score)} | 평균 폭탄 사용 ${avg(r => r.bombsUsed)}`);
console.log('스테이지별 도달/탈락 (게임오버가 난 스테이지):');
for (let t = START_TIER; t <= 5; t++) {
  const reached = results.filter(r => r.stage >= t).length;
  const diedHere = results.filter(r => r.stage === t && !r.cleared).length;
  console.log(`  stage ${t}: 도달 ${pct(reached)} | 여기서 탈락 ${pct(diedHere)}`);
}
const phases: Record<string, number> = {};
for (const r of results.filter(r => !r.cleared)) phases[r.deathPhase] = (phases[r.deathPhase] ?? 0) + 1;
console.log('탈락 시점 단계:', phases);
