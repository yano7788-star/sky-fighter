// 어디서 피해를 입는지 집계 (밸런스 진단용): npm run sim 의 봇과 같은 행동
import { H, W } from '../src/core/config';
import { Sim } from '../src/core/sim';

const SEEDS = 80;
const byDmg: Record<string, number> = {};
const byStage: Record<string, Record<string, number>> = {};
for (let seed = 1; seed <= SEEDS; seed++) {
  const s = new Sim(seed);
  const orig = s.applyDamage.bind(s);
  s.applyDamage = (dmg: number) => {
    const before = s.player.energy, inv = s.player.invincible;
    orig(dmg);
    if (inv === 0 && (s.player.energy < before || s.lives < 2)) {
      const src = dmg === 20 ? 'bullet' : dmg === 35 ? 'ram(scout/zig/snp)' : dmg === 45 ? 'kamikaze' : dmg === 40 ? 'midboss(body/laser)' : 'boss body';
      byDmg[src] = (byDmg[src] ?? 0) + 1;
      const k = `stage${s.bossTier}`; byStage[k] ??= {}; byStage[k][src] = (byStage[k][src] ?? 0) + 1;
    }
  };
  for (let f = 0; f < 60 * 300 && s.state === 'PLAYING'; f++) {
    const p = s.player;
    let tx = s.boss ? s.boss.x : s.midBoss ? s.midBoss.x : (s.enemies.length ? s.enemies.reduce((a, e) => (e.y > a.y ? e : a)).x : W / 2);
    let near: { x: number; y: number } | null = null, nd = 1e9;
    for (const b of s.enemyBullets) { if (b.y > p.y + 20) continue; const d = Math.hypot(b.x - p.x, b.y - p.y); if (d < nd) { nd = d; near = b; } }
    if (near && nd < 112) tx = p.x + (near.x < p.x ? 70 : -70);
    s.step({ targetX: Math.max(40, Math.min(W - 40, tx)), targetY: H - 120, fire: true, bomb: s.bombs > 0 && nd < 45 && f % 7 === 0 });
    s.drainEvents();
  }
}
console.log('원인별 피격:', byDmg);
console.log('스테이지별:', JSON.stringify(byStage));
