import { COLS, ROWS, SECTIONS, TILE } from './groundmap';
import { NO_INPUT, type GEnemy, type GInput, type GroundSim } from './ground';

interface BotMem { flow: Int16Array; at: number; tile: number }
const mem = new WeakMap<GroundSim, BotMem>();

/** 거리장에서 한 걸음 나아갈 방향 (이웃 8타일 중 가장 가까운 타일 중심) */
function stepDir(g: GroundSim, f: Int16Array): [number, number] | null {
  const p = g.p, c = Math.floor(p.x / TILE), r = Math.floor(p.y / TILE), here = f[r * COLS + c];
  let bd = here < 0 ? 1e9 : here, bx = 0, by = 0, found = false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue; const nc = c + dx, nr = r + dy; if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
    if (dx && dy && (f[r * COLS + nc] < 0 || f[nr * COLS + c] < 0)) continue;
    const d = f[nr * COLS + nc]; if (d >= 0 && d < bd) { bd = d; bx = (nc + 0.5) * TILE; by = (nr + 0.5) * TILE; found = true; }
  }
  if (!found) return null;
  const a = Math.atan2(by - p.y, bx - p.x); return [Math.cos(a), Math.sin(a)];
}

/** 지상전 봇 (테스트·밸런스 측정용): 구역의 적을 찾아 쓰러뜨리고, 위협 탄을 피하며, 무기를 줍고, 문으로 올라간다. skill 0~1 = 반응 정확도 */
export function groundBot(g: GroundSim, skill = 0.7): GInput {
  const p = g.p, inp: GInput = { ...NO_INPUT };
  const s = g.section, def = SECTIONS[s];
  let m = mem.get(g); if (!m) mem.set(g, m = { flow: new Int16Array(COLS * ROWS), at: -99, tile: -1 });

  // ---- 목표 정하기
  const foes = g.enemies.filter(e => e.section === s && e.kind !== 'drone');
  let tx = p.x, ty = p.y, near: GEnemy | null = null, nd = 1e9, seen: GEnemy | null = null, sd = 1e9;
  for (const e of g.enemies) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (e.section === s && d < nd) { nd = d; near = e; }
    if (d < 420 && d < sd && g.canSee(p.x, p.y, e.x, e.y)) { sd = d; seen = e; }
  }
  const weaponPk = g.pickups.find(k => k.kind === 'weapon' && k.section === s && p.weapon === 'pistol' && Math.hypot(k.x - p.x, k.y - p.y) < 260);
  const heartPk = g.pickups.find(k => k.kind === 'heart' && k.section === s && p.hp < p.maxHp);
  let goal: 'enemy' | 'pickup' | 'gate' = 'gate';
  if (weaponPk) { tx = weaponPk.x; ty = weaponPk.y; goal = 'pickup'; }
  else if (heartPk && Math.hypot(heartPk.x - p.x, heartPk.y - p.y) < 400) { tx = heartPk.x; ty = heartPk.y; goal = 'pickup'; }
  else if (foes.length && near) { tx = near.x; ty = near.y; goal = 'enemy'; }
  else if (s === 3 && g.exitOpen) { tx = 8.5 * TILE; ty = 0.5 * TILE; }
  else if (s === 3) { const b = g.boss; if (b) { tx = b.x; ty = b.y; goal = 'enemy'; } }
  else { tx = 8.5 * TILE; ty = (def.r0 - 2.5) * TILE; }   // 위층으로 이어지는 문을 지나 한 구역 위까지

  // ---- 이동: 거리장 따라가기 (적이 시야 안에 있고 가까우면 멈춰서 쏜다)
  const stand = goal === 'enemy' && seen != null && sd < 260;
  const tile = Math.floor(ty / TILE) * COLS + Math.floor(tx / TILE);
  if (g.frame - m.at >= 10 || tile !== m.tile) { g.flowTo(tx, ty, m.flow); m.at = g.frame; m.tile = tile; }
  if (!stand) {
    if (goal === 'pickup' && Math.hypot(tx - p.x, ty - p.y) < 70) { const a = Math.atan2(ty - p.y, tx - p.x); inp.mx = Math.cos(a); inp.my = Math.sin(a); }   // 가까우면 직선으로
    else { const d = stepDir(g, m.flow); if (d) { inp.mx = d[0]; inp.my = d[1]; } }
  }
  else if (seen) {   // 교전: 거리를 유지하며 좌우로 움직인다
    const a = Math.atan2(seen.y - p.y, seen.x - p.x), k = sd < 150 ? -1 : 0;
    inp.mx = Math.cos(a) * k + Math.cos(a + Math.PI / 2) * 0.6 * Math.sin(g.frame * 0.04); inp.my = Math.sin(a) * k + Math.sin(a + Math.PI / 2) * 0.6 * Math.sin(g.frame * 0.04);
  }
  inp.fire = seen != null && sd < 430;

  // ---- 위협 회피
  let ax = 0, ay = 0, imminent = false;
  for (const b of g.bullets) {
    if (b.friendly) continue;
    const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy); if (d > 90) continue;
    const vlen = Math.hypot(b.vx, b.vy) || 1, cross = (dx * b.vy - dy * b.vx) / vlen;
    if (Math.abs(cross) < 26 && dx * b.vx + dy * b.vy < 0) { const sg = cross >= 0 ? 1 : -1; ax += (-b.vy / vlen) * -sg; ay += (b.vx / vlen) * -sg; if (d < 38) imminent = true; }
  }
  for (const z of g.zones) { const d = Math.hypot(z.x - p.x, z.y - p.y); if (d < z.r + 30) { ax += ((p.x - z.x) / (d || 1)) * 2; ay += ((p.y - z.y) / (d || 1)) * 2; } }
  for (const e of g.enemies) {
    if ((e.kind === 'charger' || e.kind === 'boss') && (e.state === 'WIND' || e.state === 'DASH')) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (e.state === 'DASH' && d < 70 && skill > 0.4) imminent = true;
      if (d < 220) { ax += ((p.x - e.x) / (d || 1)) * 1.5; ay += ((p.y - e.y) / (d || 1)) * 1.5; }
    }
    if (e.kind === 'dog' && e.aw === 2) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < 50 && skill > 0.4) imminent = true; }
  }
  if (ax || ay) { inp.mx += ax * 2; inp.my += ay * 2; }
  if (imminent && g.frame % Math.max(1, Math.round(6 / Math.max(0.2, skill))) === 0) inp.roll = true;
  if (g.p.grenades > 0 && foes.length >= 4 && seen && sd < 220 && g.frame % 90 === 0) inp.grenade = true;
  if (weaponPk && Math.hypot(weaponPk.x - p.x, weaponPk.y - p.y) < 28) inp.pickup = true;
  return inp;
}
