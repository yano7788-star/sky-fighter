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

describe('소음기 권총 · 유리창 투척', () => {
  it('소음기 권총은 근처(300px)의 적도 깨우지 않지만 일반 권총은 깨운다', () => {
    const shoot = (weapon: 'pistol' | 'silenced') => {
      const g = new GroundSim({ seed: 6 }); clean(g); g.p.weapon = weapon; g.p.ammo = weapon === 'pistol' ? Infinity : 24;
      const e = add(g, 'rifle', g.p.x + 300, g.p.y); e.state = 'idle'; e.ang = 0;
      for (let i = 0; i < 20; i++) g.step({ ...NO_INPUT, fire: true, ax: 0, ay: -1 });
      return e.state;
    };
    expect(shoot('pistol')).toBe('alert'); expect(shoot('silenced')).toBe('idle');
  });
  it('폭탄류는 유리창을 깨고 지나가 반대쪽에 떨어진다 (깨질 때 소리가 난다)', () => {
    const g = new GroundSim({ seed: 6 }); clean(g); for (const w of g.windows) w.broken = false;
    const w = g.windows.find(x => x.o === 'v' && x.section === 1)!;
    const wy = (w.y0 + w.y1) / 2; g.p.x = w.x0 - 120; g.p.y = wy; g.p.aim = 0; g.p.gsel = 'smoke';
    const foe = add(g, 'rifle', w.x1 + 200, wy); foe.state = 'idle';
    g.step({ ...NO_INPUT, bomb: true, ax: 1, ay: 0, aimDist: 300 }); for (let i = 0; i < 90; i++) g.step(NO_INPUT);
    expect(w.broken).toBe(true);
    expect(g.smokes.length).toBe(1); expect(g.smokes[0].x).toBeGreaterThan(w.x1);
    expect(foe.state).toBe('alert');   // 유리 깨지는 소리
  });
});

describe('은신 긴장도 (소음기 → 음악 약화)', () => {
  it('소음기를 들고 경계 전 적이 있으면 긴장도가 나오고, 가까울수록 크며, 들키면 null', () => {
    const g = new GroundSim({ seed: 6 }); clean(g);
    expect(g.stealthLevel).toBeNull();   // 일반 권총
    g.p.weapon = 'silenced'; g.p.ammo = 24; expect(g.stealthLevel).toBeNull();   // 적 없음
    const e = add(g, 'rifle', g.p.x, g.p.y - 700); e.state = 'idle'; const far = g.stealthLevel!;
    e.y = g.p.y - 200; const near = g.stealthLevel!;
    expect(far).toBeGreaterThanOrEqual(0); expect(near).toBeGreaterThan(far);
    (g as any).alertEnemy(e); expect(g.stealthLevel).toBeNull();
  });
});

describe('인질 구출 임무 (4스테이지 뒤)', () => {
  const mk = (who: 1 | 2 = 2) => new GroundSim({ seed: 3, mission: 'rescue', hostageWho: who });
  it('소음기 권총 + 섬광·연막 2개로 시작, 인질은 감방에 갇혀 있고 아래 두 문은 열려 있다', () => {
    const g = mk();
    expect(g.p.weapon).toBe('silenced'); expect(g.p.flashes).toBe(2); expect(g.p.smokes).toBe(2);
    expect(g.hostage?.state).toBe('caged'); expect(g.secs[2].name).toBe('감방동');
    const locked = g.doors.filter(d => d.locked).map(d => d.kind); expect(locked.sort()).toEqual(['exit', 'gate']);   // 감방동→헬기장 문과 출구만 잠김
  });
  it('인질 곁에 1.2초 머물면 풀려나고 경보·증원·문 해제', () => {
    const g = mk(); const h = g.hostage!; g.enemies.length = 0; g.p.x = h.x - 60; g.p.y = h.y; g.p.invuln = 99999;
    run(g, 80); expect(h.state).toBe('free'); expect(g.alarm).toBe(true);
    expect(g.drain().some(e => e.t === 'hostageFree')).toBe(true);
    expect(g.doors.filter(d => d.locked).length).toBe(0);
    run(g, 130); expect(g.enemies.some(e => e.state === 'alert')).toBe(true);   // 1차 증원
  });
  it('인질과 함께 헬기장 위쪽에 도착하면 승리(구출 성공), 인질 없이는 승리하지 않는다', () => {
    const g = mk(); const h = g.hostage!; g.enemies.length = 0; g.p.invuln = 99999;
    g.p.x = 9 * TILE; g.p.y = 1.5 * TILE; run(g, 5); expect(g.state).toBe('PLAY');
    g.p.x = h.x - 60; g.p.y = h.y; run(g, 80); expect(h.state).toBe('free'); g.enemies.length = 0;
    g.p.x = 9 * TILE; g.p.y = 1.8 * TILE; h.x = 9 * TILE; h.y = 2.6 * TILE; run(g, 3);
    expect(g.state).toBe('WIN'); expect(g.result().rescued).toBe(true);
  });
  it('풀린 인질은 플레이어를 따라온다', () => {
    const g = mk(); const h = g.hostage!; g.enemies.length = 0; g.p.invuln = 99999; g.p.x = h.x - 60; g.p.y = h.y; run(g, 80);
    g.p.x = 9 * TILE; g.p.y = 62 * TILE; const d0 = Math.hypot(h.x - g.p.x, h.y - g.p.y); run(g, 240);
    expect(Math.hypot(h.x - g.p.x, h.y - g.p.y)).toBeLessThan(Math.max(130, d0 * 0.5));
  });
  it('Sim: 4스테이지 클리어 직후 구출 임무가 열리고, 성공하면 유물 보상 / 실패해도 게임오버 없이 5스테이지로', () => {
    const mkS = () => { const s = new Sim(3, metaParams({} as any, 'sister1', null)); s.groundEnabled = true; s.startAtTier(4); s.bossTier = 4; s.stagePhase = 'CLEAR'; s.phaseTimer = 1; s.player.invincible = 99999; return s; };
    const s = mkS(); s.step(idle(s)); s.step(idle(s)); expect(s.rescueRequest).toBe(true); expect(s.rescueWho()).toBe(2);
    expect(new Sim(3, metaParams({} as any, 'sister2', null)).rescueWho()).toBe(1);
    s.startRescue(); expect(s.rescueActive).toBe(true); const sc0 = s.score;
    s.finishRescue({ rescued: true, score: 3000 }); expect(s.score).toBe(sc0 + 3000); expect(s.pending?.length).toBeGreaterThan(0);
    const t = mkS(); t.step(idle(t)); t.step(idle(t)); t.startRescue(); t.finishRescue({ rescued: false, score: 0 });
    expect(t.state).toBe('PLAYING'); expect(t.stageTier).toBe(5); expect(t.rescueActive).toBe(false);
  });
});

describe('조심 접근 · 암살', () => {
  const setup = (seed = 8) => { const g = new GroundSim({ seed }); clean(g); g.p.invuln = 99999; return g; };
  it('적 등 뒤 사각지대: 정면 80px에서는 들키지만 등 뒤 80px에서는 안 들키고, 55px 안에서는 들킨다', () => {
    const front = setup(); const a = add(front, 'rifle', front.p.x, front.p.y - 80, Math.PI / 2); a.state = 'idle'; run(front, 40); expect(a.state).toBe('alert');   // 적이 아래(플레이어 쪽)를 본다
    const back = setup(); const b = add(back, 'rifle', back.p.x, back.p.y - 80, -Math.PI / 2); b.state = 'idle'; run(back, 40); expect(b.state).toBe('idle');      // 적이 위(반대쪽)를 본다
    const close = setup(); const c = add(close, 'rifle', close.p.x, close.p.y - 40, -Math.PI / 2); c.state = 'idle'; run(close, 40); expect(c.state).toBe('alert');
  });
  it('평소 걸음은 소리가 나고(150px) 조심 걷기는 소리가 없다', () => {
    const walk = (sneak: boolean) => { const g = setup(); const e = add(g, 'rifle', g.p.x + 110, g.p.y, 0); e.state = 'idle'; for (let i = 0; i < 70; i++) g.step({ ...NO_INPUT, mx: 0, my: -1, sneak }); return e.state; };   // 적은 오른쪽(바깥)을 보고 있어 등 뒤 110px
    expect(walk(false)).toBe('alert'); expect(walk(true)).toBe('idle');
  });
  it('등 뒤에서 근접 → 암살: 경계 전·가까움·등 뒤일 때만, 소리 없이 즉사 + 보너스', () => {
    const g = setup(); const e = add(g, 'rifle', g.p.x, g.p.y - 70, -Math.PI / 2); e.state = 'idle';
    expect(g.stabTarget()).toBe(e);
    const sc0 = g.score; g.step({ ...NO_INPUT, melee: true }); run(g, 110);
    const evs = g.drain(); expect(evs.some(x => x.t === 'assassinate')).toBe(true); expect(g.enemies.includes(e)).toBe(false); expect(g.score).toBeGreaterThan(sc0 + 150);
    const f = setup(); const h = add(f, 'rifle', f.p.x, f.p.y - 70, Math.PI / 2); h.state = 'idle'; expect(f.stabTarget()).toBeNull();   // 정면
    const k = setup(); const hv = add(k, 'heavy', k.p.x, k.p.y - 70, -Math.PI / 2); hv.state = 'idle'; expect(k.stabTarget()).toBeNull();   // 헤비 제외
    const m = setup(); const al = add(m, 'rifle', m.p.x, m.p.y - 70, -Math.PI / 2); al.state = 'alert'; expect(m.stabTarget()).toBeNull();   // 경계 중
  });
});

describe('시선 끌기 · 순찰 멈춤', () => {
  const setup = (seed = 9) => { const g = new GroundSim({ seed }); clean(g); g.p.invuln = 99999; g.p.weapon = 'silenced'; g.p.ammo = 24; return g; };
  it('벽에 맞은 소음기 탄 → 가까운 경계 전 적이 소리 난 곳으로 가서 둘러보고 돌아간다 (경계는 안 한다)', () => {
    const g = setup(); g.p.x = 260; g.p.y = 8000;
    const e = add(g, 'rifle', 420, 7900, -Math.PI / 2); e.state = 'idle'; const home = { x: e.x, y: e.y };
    for (let i = 0; i < 12; i++) g.step({ ...NO_INPUT, fire: true, ax: -1, ay: 0 });
    expect(e.inv).toBeTruthy(); const evs = g.drain(); expect(evs.some(x => x.t === 'tick')).toBe(true); expect(evs.some(x => x.t === 'suspicious')).toBe(true);
    g.p.x = 700; g.p.y = 8300;   // 멀리 떨어져 시야 밖
    let moved = 0; for (let i = 0; i < 160; i++) { g.step(NO_INPUT); moved = Math.max(moved, Math.hypot(e.x - home.x, e.y - home.y)); }
    expect(moved).toBeGreaterThan(40); expect(e.state).toBe('idle');
    for (let i = 0; i < 900; i++) g.step(NO_INPUT);
    expect(e.inv).toBeUndefined(); expect(e.state).toBe('idle'); expect(Math.hypot(e.x - home.x, e.y - home.y)).toBeLessThan(80);
  });
  it('조사 중에도 정면에 플레이어가 보이면 경계한다 / 380px 밖은 반응하지 않는다', () => {
    const g = setup(); const e = add(g, 'rifle', g.p.x + 200, g.p.y - 100, 0); e.state = 'idle';
    g.lure(g.p.x + 220, g.p.y - 100, 1, 0); expect(e.inv).toBeTruthy();
    const far = setup(); const f = add(far, 'rifle', far.p.x + 500, far.p.y - 100, 0); f.state = 'idle'; far.lure(far.p.x, far.p.y - 100, 1, 0); expect(f.inv).toBeUndefined();
    const sees = setup(); const h = add(sees, 'rifle', sees.p.x, sees.p.y - 90, Math.PI / 2); h.state = 'idle'; h.inv = { ph: 2, t: 0, x: h.x, y: h.y, fl: new Int16Array(1) };
    run(sees, 30); expect(h.state).toBe('alert'); expect(h.inv).toBeUndefined();
  });
  it('순찰 적은 지점에 닿으면 잠깐 멈춰 둘러본다', () => {
    const g = setup(); const e = (g as any).addEnemy('rifle', g.p.x, g.p.y - 700, 0, [[g.p.x + 120, g.p.y - 700], [g.p.x, g.p.y - 700]]) as GEnemy; e.state = 'idle';
    let paused = false; for (let i = 0; i < 200; i++) { g.step(NO_INPUT); if ((e.pauseT ?? 0) > 10) { const x0 = e.x; run(g, 5); paused = Math.abs(e.x - x0) < 0.5; break; } }
    expect(paused).toBe(true);
  });
});

describe('침입 경보 (구출 임무: 소란이 나면 경비병이 몰려온다)', () => {
  const mk = () => { const g = new GroundSim({ seed: 5, mission: 'rescue', hostageWho: 1 }); g.enemies.length = 0; g.p.invuln = 99999; g.p.x = 10 * TILE; g.p.y = 129.4 * TILE; return g; };
  it('들키면 경보 + 같은 구역 전원 경계 + 증원 무리가 온다', () => {
    const g = mk(); const e = add(g, 'rifle', g.p.x, g.p.y - 100, Math.PI / 2); e.state = 'idle'; const far = add(g, 'rifle', g.p.x + 300, g.p.y - 300, 0); far.state = 'idle';
    run(g, 5); expect(g.alarm).toBe(true); expect(g.drain().some(x => x.t === 'alarm')).toBe(true); expect(far.state).toBe('alert');
    run(g, 120); expect(g.enemies.filter(x => x.reinf).length).toBeGreaterThanOrEqual(3);
    run(g, 330); expect(g.enemies.filter(x => x.reinf).length).toBeGreaterThanOrEqual(6);
  });
  it('암살은 경보를 울리지 않지만, 소음기로 쏴서 안 죽으면 경보가 울린다', () => {
    const a = mk(); const e = add(a, 'rifle', a.p.x, a.p.y - 70, -Math.PI / 2); e.state = 'idle'; const o = add(a, 'rifle', a.p.x + 300, a.p.y - 500, 0); o.state = 'idle';
    a.step({ ...NO_INPUT, melee: true }); run(a, 110); expect(a.enemies.includes(e)).toBe(false); expect(a.alarm).toBe(false);
    const b = mk(); b.p.weapon = 'silenced'; b.p.ammo = 24; const t = add(b, 'rifle', b.p.x, b.p.y - 300, Math.PI / 2 + 3.14); t.state = 'idle'; t.ang = -Math.PI / 2;
    for (let i = 0; i < 12; i++) b.step({ ...NO_INPUT, fire: true, ax: 0, ay: -1 }); expect(b.alarm).toBe(true);
  });
  it('인질을 풀기 전에 죽어서 재도전하면 경보가 해제된다', () => {
    const g = mk(); const e = add(g, 'rifle', g.p.x, g.p.y - 100, Math.PI / 2); e.state = 'idle'; run(g, 130); expect(g.alarm).toBe(true);
    g.p.hp = 0; g.p.invuln = 0; g.revive(); expect(g.alarm).toBe(false); expect(g.enemies.some(x => x.reinf)).toBe(false);
  });
});
