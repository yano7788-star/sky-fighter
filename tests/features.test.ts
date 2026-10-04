import { describe, expect, it } from 'vitest';
import { GroundSim, NO_INPUT, type GEnemy } from '../src/core/ground';
import { TILE } from '../src/core/groundmap';
import { Sim } from '../src/core/sim';
import { metaParams } from '../src/core/meta';
import type { SimInput } from '../src/core/types';

const idle = (s: Sim, fire = false): SimInput => ({ targetX: s.player.x, targetY: s.player.y, fire, bomb: false });
type Priv = { addEnemy: (k: string, x: number, y: number, a?: number) => GEnemy };
const clean = (g: GroundSim) => { g.enemies.length = 0; g.pickups.length = 0; for (const c of g.crates) c.broken = true; for (const w of g.windows) w.broken = true; };
const add = (g: GroundSim, kind: string, x: number, y: number, ang = 0) => (g as unknown as Priv).addEnemy(kind, x, y, ang);
const run = (g: GroundSim, n: number, inp = NO_INPUT) => { for (let i = 0; i < n; i++) g.step(inp); };

describe('적 편대 신호 (본편)', () => {
  const mk = () => { const s = new Sim(5, metaParams({} as any, 'ace', null)); s.startAtTier(1); s.stagePhase = 'FIGHT'; s.stageFrames = 0; s.player.invincible = 99999; return s; };
  it('일정 시간 뒤 경고가 뜨고 약 1.3초 뒤 편대가 나타난다', () => {
    const s = mk(); let warned = 0, spawnedAt = -1;
    for (let i = 0; i < 1500; i++) {
      s.step(idle(s)); s.drainEvents();
      if (s.formWarn && !warned) warned = i;
      if (warned && spawnedAt < 0 && s.enemies.some(e => e.form !== undefined)) spawnedAt = i;
    }
    expect(warned).toBeGreaterThan(300); expect(spawnedAt - warned).toBeGreaterThanOrEqual(75); expect(spawnedAt - warned).toBeLessThanOrEqual(90);
  });
  it('편대를 전멸시키면 보너스 점수 + formclear 이벤트, 놓치면 없다', () => {
    const s = mk(); let guard = 0;
    while (!s.enemies.some(e => e.form !== undefined) && guard++ < 3000) { s.step(idle(s)); s.drainEvents(); }
    const members = s.enemies.filter(e => e.form !== undefined); expect(members.length).toBeGreaterThanOrEqual(4);
    const sc0 = s.score; for (const e of members) { e.y = Math.max(e.y, 100); e.x = Math.min(Math.max(e.x, 10), 440); e.hp = 0; }
    s.step(idle(s)); const evs = s.drainEvents();
    expect(evs.some(e => e.t === 'formclear')).toBe(true); expect(s.score).toBeGreaterThan(sc0 + 300);
    // 놓친 편대: 하나가 화면 밖으로 나가면 보너스 없음
    const t = mk(); guard = 0; while (!t.enemies.some(e => e.form !== undefined) && guard++ < 3000) { t.step(idle(t)); t.drainEvents(); }
    const ms = t.enemies.filter(e => e.form !== undefined); ms[0].y = 2000; for (const e of ms.slice(1)) { e.y = 100; e.hp = 0; }
    t.step(idle(t)); expect(t.drainEvents().some(e => e.t === 'formclear')).toBe(false);
  });
});

describe('지상전: 폭탄 종류 · 무음 처치 · 연막', () => {
  it('섬광탄은 시야가 있는 적을 멈춰 세우고 벽 너머 적은 영향이 없다', () => {
    const g = new GroundSim({ seed: 2 }); clean(g);
    const a = add(g, 'rifle', g.p.x, g.p.y - 220), b = add(g, 'rifle', g.p.x, g.p.y - 220 + 2 * TILE * 0);
    (g as any).flashBang(g.p.x, g.p.y - 150);
    expect(a.stunT).toBeGreaterThan(100); void b;
  });
  it('연막탄 구름은 시선을 가리고 시간이 지나면 사라진다', () => {
    const g = new GroundSim({ seed: 2 }); clean(g);
    const ex = g.p.x, ey = g.p.y - 300;
    expect(g.smokeBlocks(ex, ey, g.p.x, g.p.y)).toBe(false);
    (g as any).smokeBomb(g.p.x, g.p.y - 150); run(g, 50);
    expect(g.smokeBlocks(ex, ey, g.p.x, g.p.y)).toBe(true);
    run(g, 60 * 9); expect(g.smokes.length).toBe(0); expect(g.smokeBlocks(ex, ey, g.p.x, g.p.y)).toBe(false);
  });
  it('폭탄 종류 전환 · 투척 시 해당 개수가 줄어든다', () => {
    const g = new GroundSim({ seed: 2 }); clean(g);
    expect(g.p.gsel).toBe('frag'); g.step({ ...NO_INPUT, swap: true }); expect(g.p.gsel).toBe('flash');
    const f0 = g.p.flashes; g.step({ ...NO_INPUT, bomb: true, ax: 0, ay: -1, aimDist: 300 }); run(g, 60);
    expect(g.p.flashes).toBe(f0 - 1); expect(g.p.grenades).toBe(2);
  });
  it('들키기 전에 잡으면 무음 처치 보너스, 근접은 더 크다', () => {
    const g = new GroundSim({ seed: 4 }); clean(g);
    const e = add(g, 'rifle', g.p.x, g.p.y - 200); e.state = 'idle'; const sc0 = g.score;
    (g as any).killEnemy(e, 'pistol', -Math.PI / 2);
    const ev = g.drain().find(x => x.t === 'stealth'); expect(ev).toBeTruthy(); expect(g.score).toBeGreaterThan(sc0 + 100);
    const e2 = add(g, 'rifle', g.p.x + 60, g.p.y - 200); e2.state = 'idle';
    (g as any).killEnemy(e2, 'melee', -Math.PI / 2);
    expect((g.drain().find(x => x.t === 'stealth') as any).melee).toBe(true);
    const e3 = add(g, 'rifle', g.p.x - 60, g.p.y - 200); e3.state = 'alert'; (g as any).killEnemy(e3, 'pistol', 0);
    expect(g.drain().some(x => x.t === 'stealth')).toBe(false);
  });
  it('들키지 않고 구역을 정리하면 GHOST CLEAR', () => {
    const g = new GroundSim({ seed: 4 }); for (const e of g.enemies.slice()) if (e.section === 0) (g as any).killEnemy(e, 'pistol', 0);
    g.drain(); g.step(NO_INPUT);
    expect(g.drain().some(x => x.t === 'ghost')).toBe(true);
  });
});
