import { ARENA, DOOR, NO_INPUT, type GInput, type GroundSim } from './ground';

/** 지상전 봇 (테스트·밸런스 측정용): 위협 탄을 피하고, 가까운 적을 쏘며, 보상 → 출구로 이동한다. skill 0~1 = 반응 정확도 */
export function groundBot(g: GroundSim, skill = 0.7): GInput {
  const p = g.p, inp: GInput = { ...NO_INPUT };
  let tx = p.x, ty = p.y;
  if (g.state === 'CLEAR') {
    const want = g.pickups.find(k => k.kind === 'weapon') ?? g.pickups.find(k => k.kind === 'heart' && p.hp < p.maxHp);
    if (want) { tx = want.x; ty = want.y; } else { tx = DOOR.x; ty = DOOR.y; }
  } else {
    // 가장 가까운 적과 적당한 거리를 유지
    let near = null as null | { x: number; y: number; d: number; kind: string };
    for (const e of g.enemies) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (!near || d < near.d) near = { x: e.x, y: e.y, d, kind: e.kind }; }
    if (near) {
      const want = near.kind === 'charger' || near.kind === 'drone' ? 200 : 230, a = Math.atan2(near.y - p.y, near.x - p.x);
      const k = near.d < want - 30 ? -1 : near.d > want + 60 ? 1 : 0;
      inp.mx = Math.cos(a) * k + Math.cos(a + Math.PI / 2) * 0.5 * Math.sin(g.frame * 0.03); inp.my = Math.sin(a) * k + Math.sin(a + Math.PI / 2) * 0.5 * Math.sin(g.frame * 0.03);
      tx = p.x + inp.mx * 40; ty = p.y + inp.my * 40;
    }
    inp.fire = true;
    // 전투 중 보급(보스전 중간에 나오는 총/체력)이 있으면 위험이 낮을 때 주우러 간다
    const sup = g.pickups.find(k => k.kind === 'weapon' || p.hp < p.maxHp);
    if (sup && (!near || near.d > 120)) { const w = steer(g, sup.x, sup.y); inp.mx = w[0] - p.x; inp.my = w[1] - p.y; }
  }
  // 위협 회피
  let ax = 0, ay = 0, imminent = false;
  for (const b of g.bullets) {
    if (b.friendly) continue;
    const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy); if (d > 90) continue;
    const vlen = Math.hypot(b.vx, b.vy) || 1, cross = (dx * b.vy - dy * b.vx) / vlen;   // 탄 궤적과 플레이어 사이 수직 거리
    if (Math.abs(cross) < 26 && dx * b.vx + dy * b.vy < 0) { const s = cross >= 0 ? 1 : -1; ax += (-b.vy / vlen) * -s; ay += (b.vx / vlen) * -s; if (d < 38) imminent = true; }
  }
  for (const z of g.zones) { const d = Math.hypot(z.x - p.x, z.y - p.y); if (d < z.r + 30) { ax += (p.x - z.x) / (d || 1) * 2; ay += (p.y - z.y) / (d || 1) * 2; } }
  for (const e of g.enemies) {
    if ((e.kind === 'charger' || e.kind === 'boss') && (e.state === 'WIND' || e.state === 'DASH')) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (e.state === 'DASH' && d < 70 && skill > 0.4) imminent = true;
      if (d < 220) { ax += (p.x - e.x) / (d || 1) * 1.5; ay += (p.y - e.y) / (d || 1) * 1.5; }
    }
  }
  if (ax || ay) { inp.mx += ax * 2; inp.my += ay * 2; }
  else if (g.state === 'CLEAR') { const w = steer(g, tx, ty); inp.mx = w[0] - p.x; inp.my = w[1] - p.y; }
  if (imminent && g.frame % Math.max(1, Math.round(6 / Math.max(0.2, skill))) === 0) inp.roll = true;
  // 벽 쪽에 몰리면 중앙으로
  if (p.x < ARENA.x0 + 30) inp.mx += 1; if (p.x > ARENA.x1 - 30) inp.mx -= 1; if (p.y > ARENA.y1 - 30 && g.state !== 'CLEAR') inp.my -= 1; if (p.y < ARENA.y0 + 40 && g.state !== 'CLEAR') inp.my += 1;
  if (g.p.grenades > 0 && g.enemies.length >= 4 && g.frame % 90 === 0) inp.grenade = true;
  return inp;
}

/** 직선 경로가 엄폐물에 막히면 가장자리 옆을 지나는 경유점을 돌려준다 */
function steer(g: GroundSim, tx: number, ty: number): [number, number] {
  const p = g.p;
  for (const c of g.cover) {
    if (c.dead) continue;
    const hx = c.w / 2 + 14, hy = c.h / 2 + 14;
    // 선분-사각형 교차 (샘플링)
    let hit = false;
    for (let i = 1; i <= 12; i++) { const x = p.x + ((tx - p.x) * i) / 12, y = p.y + ((ty - p.y) * i) / 12; if (Math.abs(x - c.x) < hx && Math.abs(y - c.y) < hy) { hit = true; break; } }
    if (hit) { const side = p.x < c.x ? -1 : 1; return [c.x + side * (hx + 6), ty < c.y ? c.y - hy - 6 : c.y + hy + 6]; }
  }
  return [tx, ty];
}
