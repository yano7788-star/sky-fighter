// 지상전 봇 시뮬레이션: npm run ground -- --seeds 100 --skill 0.7
import { GroundSim } from '../src/core/ground';
import { groundBot } from '../src/core/groundbot';

const arg = (k: string, d: number) => { const i = process.argv.indexOf('--' + k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const seeds = arg('seeds', 100), skill = arg('skill', 0.7), pilot = arg('pilot', 0) as 0 | 1 | 2, dmg = arg('dmg', 1);
const hurtBy: Record<string, number> = {};
let win = 0, dead = 0, timeout = 0, hpSum = 0, tSum = 0; const secDeaths: number[] = [0, 0, 0, 0];
for (let s = 1; s <= seeds; s++) {
  const g = new GroundSim({ seed: s, pilot, dmgMult: dmg });
  let revives = 0;
  while (g.frame < 60 * 400) {
    g.step(groundBot(g, skill));
    for (const e of g.drain()) if (e.t === 'hurt') hurtBy[e.by ?? '?'] = (hurtBy[e.by ?? '?'] ?? 0) + 1;
    if ((g.state as string) === 'DEAD') { secDeaths[g.section]++; if (revives++ >= 1) break; g.revive(); }   // 목숨 1개로 이어하기
    if ((g.state as string) === 'WIN') break;
  }
  if ((g.state as string) === 'WIN') { win++; hpSum += g.p.hp; tSum += g.time / 60; } else if ((g.state as string) === 'DEAD') dead++; else timeout++;
}
console.log(`지상전 봇(skill ${skill}, pilot ${pilot}): 클리어 ${win}/${seeds} (${((win / seeds) * 100).toFixed(0)}%), 사망 ${dead}, 시간초과 ${timeout}`);
console.log(`평균 클리어 시간 ${(tSum / Math.max(1, win)).toFixed(0)}s, 남은 체력 ${(hpSum / Math.max(1, win)).toFixed(1)}, 구역별 사망 [${secDeaths.join(', ')}]`);
console.log('피격 원인', JSON.stringify(hurtBy));
