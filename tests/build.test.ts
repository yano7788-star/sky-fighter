import { describe, expect, it } from 'vitest';
import { BOMB, BOSS_PATTERNS, ULT } from '../src/core/data';
import { CARDS, fusionAvailable, newBuild, offerCards, statsOf, xpNeeded } from '../src/core/build';
import { createRng } from '../src/core/rng';
import { creditsFor, metaParams } from '../src/core/meta';
import { dailyMutator, dailySeed, dayKey, offerMutators } from '../src/core/mutators';
import type { EnemyBullet } from '../src/core/types';
import { ACHIEVEMENTS, newlyUnlocked } from '../src/core/achievements';
import { Sim } from '../src/core/sim';
import type { Enemy, EnemyType, SimInput } from '../src/core/types';

const idle = (s: Sim, fire = false, extra: Partial<SimInput> = {}): SimInput => ({ targetX: s.player.x, targetY: s.player.y, fire, bomb: false, ...extra });
const mkEnemy = (type: EnemyType, x: number, y: number): Enemy =>
  ({ type, x, y, hp: 1, maxHp: 1, speed: 0, baseX: x, age: 0, fireCd: 999, hold: 0 });
function spawnBoss(s: Sim, tier = 1) {
  s.bossTier = tier; s.stagePhase = 'WARNING'; s.phaseTimer = 1; s.player.invincible = 99999; s.step(idle(s));
  return s.boss!;
}

describe('폭탄 (강화판)', () => {
  it('모든 적 탄을 점수로 바꾸고 화면의 적을 전부 파괴하며 무적이 된다', () => {
    const s = new Sim(1);
    for (let i = 0; i < 30; i++) s.enemyBullets.push({ x: 50 + i * 10, y: 300, vx: 0, vy: 0, color: '#fff', r: 4 });
    s.enemies.push(mkEnemy('scout', 100, 200), mkEnemy('sniper', 300, 250));
    s.frame = 100; s.bombs = 1;
    const before = s.score;
    s.fireBomb();
    expect(s.enemyBullets).toHaveLength(0);
    expect(s.score - before).toBe(30);
    expect(s.enemies.every(e => e.hp <= 0)).toBe(true);
    expect(s.player.invincible).toBeGreaterThanOrEqual(BOMB.invincibleFrames);
  });
  it('보스에게 최대 체력의 12% + 폭발장 지속 피해를 준다', () => {
    const s = new Sim(1);
    const boss = spawnBoss(s, 5);
    boss.y = 135; boss.hp = boss.maxHp;
    s.frame = 100; s.bombs = 1; s.player.x = boss.x; s.player.y = 300;
    s.fireBomb();
    expect(boss.hp).toBeLessThanOrEqual(boss.maxHp * (1 - BOMB.bossBurstPct) + 1);
    for (let i = 0; i < BOMB.fieldFrames + 2; i++) s.step(idle(s));
    expect(boss.hp).toBeLessThan(boss.maxHp * (1 - BOMB.bossBurstPct - BOMB.fieldPctTotal * 0.5));
  });
  it('폭발장이 퍼지는 동안 새로 나온 탄도 지운다', () => {
    const s = new Sim(1); s.frame = 100; s.bombs = 1; s.fireBomb();
    s.enemyBullets.push({ x: s.player.x + 40, y: s.player.y, vx: 0, vy: 0, color: '#fff', r: 4 });
    for (let i = 0; i < 20; i++) s.step(idle(s));
    expect(s.enemyBullets).toHaveLength(0);
  });
});

describe('경험치 / 레벨업 / 카드', () => {
  it('경험치 젬을 모으면 레벨업하고 선택 전까지 시뮬레이션이 멈춘다', () => {
    const s = new Sim(1);
    s.gems.push({ x: s.player.x, y: s.player.y, v: xpNeeded(1) });
    s.step(idle(s));
    expect(s.level).toBe(2); expect(s.pending).toHaveLength(3);
    const f = s.frame;
    for (let i = 0; i < 30; i++) s.step(idle(s));
    expect(s.frame).toBe(f);             // 정지
    s.chooseCard(0);
    expect(s.pending).toBeNull();
    s.step(idle(s)); expect(s.frame).toBe(f + 1);
  });
  it('카드를 고르면 빌드 레벨이 오른다', () => {
    const s = new Sim(1);
    s.gems.push({ x: s.player.x, y: s.player.y, v: xpNeeded(1) }); s.step(idle(s));
    const id = s.pending![1]; s.chooseCard(1);
    expect(s.build.levels[id]).toBe(1);
  });
  it('연속 레벨업이면 바로 다음 카드를 제안한다', () => {
    const s = new Sim(1);
    s.gems.push({ x: s.player.x, y: s.player.y, v: xpNeeded(1) + xpNeeded(2) + 1 }); s.step(idle(s));
    s.chooseCard(0);
    expect(s.pending).not.toBeNull(); expect(s.level).toBe(3);
  });
  it('카드 제안은 3장이고 중복·최대 레벨 카드를 포함하지 않는다', () => {
    const b = newBuild(); b.levels.spread = 4;
    for (let i = 0; i < 50; i++) {
      const offer = offerCards(b, createRng(i));
      expect(offer).toHaveLength(3); expect(new Set(offer).size).toBe(3); expect(offer).not.toContain('spread');
    }
  });
  it('융합 조건이 맞으면 융합 카드가 반드시 제안된다', () => {
    const b = newBuild(); b.levels.spread = 3; b.levels.homing = 3;
    expect(fusionAvailable(b, 'swarm')).toBe(true);
    for (let i = 0; i < 30; i++) expect(offerCards(b, createRng(i))).toContain('swarm');
    b.levels.swarm = 1;
    expect(fusionAvailable(b, 'swarm')).toBe(false);
  });
  it('모든 카드에 설명이 있다', () => {
    for (const c of Object.values(CARDS)) { expect(c.desc(1).length).toBeGreaterThan(0); expect(c.max).toBeGreaterThan(0); }
  });
  it('패시브 수치가 반영된다', () => {
    const b = newBuild(); b.levels.rate = 5; b.levels.power = 5; b.levels.scholar = 3;
    const st = statsOf(b);
    expect(st.rateMult).toBeCloseTo(1.4); expect(st.dmgMult).toBeCloseTo(1.6); expect(st.xpMult).toBeCloseTo(1.45);
  });
  it('강화 장갑은 최대 에너지를 늘린다', () => {
    const s = new Sim(1);
    s.pending = ['vitality', 'rate', 'power']; s.chooseCard(0);
    expect(s.player.maxEnergy).toBe(125);
  });
});

describe('모듈 효과', () => {
  const fireTicks = (s: Sim, n: number) => { for (let i = 0; i < n; i++) { s.player.invincible = 99999; s.step(idle(s, true)); } };
  it('산탄 모듈은 발사당 탄 수를 늘린다', () => {
    const a = new Sim(1), b = new Sim(1);
    b.build.levels.spread = 2; b.stats = statsOf(b.build);
    fireTicks(a, 1); fireTicks(b, 1);
    expect(b.bullets.length).toBe(a.bullets.length + 4);
  });
  it('관통탄은 적을 통과해 여러 적을 맞춘다', () => {
    const s = new Sim(1);
    s.build.levels.pierce = 3; s.stats = statsOf(s.build);
    s.enemies.push(mkEnemy('scout', 225, 400), mkEnemy('scout', 225, 430));
    s.bullets.push({ x: 225, y: 440, vx: 0, vy: -13, dmg: 1, pierce: 3 });
    for (let i = 0; i < 3; i++) s.step(idle(s));
    expect(s.enemies.length).toBe(0);
  });
  it('레이저는 사격 중 전방의 적에게 피해를 준다', () => {
    const s = new Sim(1);
    s.build.levels.laser = 2; s.stats = statsOf(s.build);
    s.enemies.push({ ...mkEnemy('sniper', s.player.x, s.player.y - 200), hp: 4, maxHp: 4 });
    fireTicks(s, 12);
    expect(s.enemies.length === 0 || s.enemies[0].hp < 4).toBe(true);
    expect(s.laser.on).toBe(true);
  });
  it('드론은 레벨만큼 생기고 함께 사격한다', () => {
    const s = new Sim(1);
    s.build.levels.drone = 3; s.stats = statsOf(s.build);
    expect(s.dronePositions()).toHaveLength(3);
    fireTicks(s, 1);
    expect(s.bullets.length).toBeGreaterThanOrEqual(2 + 3);
  });
  it('유도 모듈은 사격 중 미사일을 상시 발사한다', () => {
    const s = new Sim(1);
    s.build.levels.homing = 1; s.stats = statsOf(s.build);
    fireTicks(s, 2);
    expect(s.missiles.length).toBeGreaterThan(0);
  });
  it('스웜 융합은 보조탄이 적을 추적한다', () => {
    const s = new Sim(1);
    s.build.levels.spread = 3; s.build.levels.homing = 3; s.build.levels.swarm = 1; s.stats = statsOf(s.build);
    s.enemies.push(mkEnemy('scout', 40, 300));
    fireTicks(s, 1);
    expect(s.bullets.some(b => b.homing)).toBe(true);
  });
});

describe('동료', () => {
  it('동료 아이템을 먹으면 사용 가능, 사용하면 8초 후 종료, 스테이지당 1회', () => {
    const s = new Sim(1);
    s.items.push({ x: s.player.x, y: s.player.y, type: 'C' }); s.step(idle(s));
    expect(s.comp.cat.ready).toBe(true);
    s.step(idle(s, false, { skill: 'cat' }));
    expect(s.comp.cat.active).toBe(true); expect(s.comp.cat.ready).toBe(false);
    for (let i = 0; i < 480; i++) { s.player.invincible = 999; s.step(idle(s)); }
    expect(s.comp.cat.active).toBe(false);
    s.comp.cat.ready = true;
    s.step(idle(s, false, { skill: 'cat' }));
    expect(s.comp.cat.active).toBe(false);   // 이번 스테이지에서 이미 사용
  });
  it('고양이(흡혈)는 준 피해의 일부를 에너지로 회복하되 80%까지만', () => {
    const s = new Sim(1);
    s.comp.cat.active = true; s.comp.cat.timer = 300; s.player.energy = 50;
    s.enemies.push({ ...mkEnemy('sniper', 225, 300), hp: 4, maxHp: 4 });
    s.bullets.push({ x: 225, y: 300, vx: 0, vy: 0, dmg: 1, pierce: 0 });
    s.step(idle(s));
    expect(s.player.energy).toBeGreaterThan(50);
    s.player.energy = 85;
    s.bullets.push({ x: s.enemies[0].x, y: s.enemies[0].y, vx: 0, vy: 0, dmg: 1, pierce: 0 }); s.step(idle(s));
    expect(s.player.energy).toBe(85);        // 이미 80% 이상이면 회복 없음 (깎지도 않음)
  });
  it('고양이 활성 중에는 내 탄이 적을 향해 휜다', () => {
    const s = new Sim(1);
    s.comp.cat.active = true; s.comp.cat.timer = 300;
    s.enemies.push(mkEnemy('scout', 300, 200));
    s.bullets.push({ x: 225, y: 500, vx: 0, vy: -13, dmg: 1, pierce: 0 });
    for (let i = 0; i < 10; i++) s.step(idle(s));
    expect(s.bullets[0].vx).toBeGreaterThan(0.5);
  });
  it('강아지 방어막은 반경 안의 적 탄을 지운다', () => {
    const s = new Sim(1);
    s.comp.dog.active = true; s.comp.dog.timer = 300;
    s.enemyBullets.push({ x: s.player.x + 30, y: s.player.y, vx: 0, vy: 0, color: '#fff', r: 4 });
    const e0 = s.player.energy; s.step(idle(s));
    expect(s.enemyBullets).toHaveLength(0); expect(s.player.energy).toBe(e0);
  });
  it('다음 스테이지가 되면 동료를 다시 쓸 수 있다', () => {
    const s = new Sim(1);
    s.comp.dog.used = true;
    s.stagePhase = 'CLEAR'; s.phaseTimer = 1; s.step(idle(s));
    expect(s.stagePhase).toBe('INTRO'); expect(s.comp.dog.used).toBe(false);
  });
});

describe('궁극기 「자매의 손바닥」', () => {
  it('게이지가 가득 차야 쓸 수 있다', () => {
    const s = new Sim(1);
    s.step(idle(s, false, { skill: 'ult' }));
    expect(s.ult.phase).toBe('IDLE');
    s.ult.gauge = 100;
    s.step(idle(s, false, { skill: 'ult' }));
    expect(s.ult.phase).toBe('CUTIN');
  });
  it('컷인·낙하 중에는 게임이 정지하고, 충돌 시 탄 제거 + 적 50%/보스 30% 피해', () => {
    const s = new Sim(1);
    const boss = spawnBoss(s, 3); boss.y = 135; boss.hp = boss.maxHp;
    s.enemyBullets.push({ x: 100, y: 300, vx: 0, vy: 0, color: '#fff', r: 4 });
    s.enemies.push({ ...mkEnemy('sniper', 200, 300), hp: 4, maxHp: 4 });
    s.ult.gauge = 100;
    s.step(idle(s, false, { skill: 'ult' }));
    const f = s.frame;
    for (let i = 0; i < ULT.frames.CUTIN + ULT.frames.FALL - 1; i++) { s.step(idle(s)); expect(s.frame).toBe(f); }
    s.step(idle(s));
    expect(s.ult.phase).toBe('IMPACT');
    expect(s.enemyBullets).toHaveLength(0);
    expect(s.enemies[0].hp).toBe(2);
    expect(boss.hp).toBe(boss.maxHp - Math.ceil(boss.maxHp * ULT.bossPct));
    expect(s.player.invincible).toBeGreaterThan(0);
  });
  it('3번째 보스를 목숨 2개 이상 유지하고 처치하면 게이지가 가득 찬다', () => {
    const s = new Sim(1);
    const boss = spawnBoss(s, 3); boss.hp = 0; s.step(idle(s));
    expect(s.ult.gauge).toBe(100);
    const s2 = new Sim(1); s2.lives = 1;
    const b2 = spawnBoss(s2, 3); b2.hp = 0; s2.step(idle(s2));
    expect(s2.ult.gauge).toBeLessThan(100);
  });
  it('처치로 게이지가 찬다', () => {
    const s = new Sim(1);
    s.enemies.push({ ...mkEnemy('sniper', 200, 300), hp: 0, maxHp: 4 }); s.step(idle(s));
    expect(s.ult.gauge).toBeGreaterThan(5);
  });
});

describe('영구 성장(격납고)', () => {
  it('메타 레벨이 시작 수치에 반영된다', () => {
    const m = metaParams({ hull: 3, munitions: 1, intel: 2, burst: 2 });
    const s = new Sim(1, m);
    expect(s.player.maxEnergy).toBe(130); expect(s.bombs).toBe(2); expect(s.stats.xpMult).toBeCloseTo(1.2); expect(s.ult.gauge).toBe(40);
  });
  it('크레딧은 점수·스테이지·클리어로 정해진다', () => {
    expect(creditsFor(2000, 3, false)).toBe(100 + 90);
    expect(creditsFor(2000, 5, true)).toBe(100 + 150 + 300);
  });
});

describe('파일럿', () => {
  it('언니는 연사·피해 보너스, 동생은 에너지·흡수·경험치 보너스를 받는다', () => {
    const base = new Sim(1, metaParams({}, 'ace'));
    const a = new Sim(1, metaParams({}, 'sister1'));
    expect(a.stats.rateMult).toBeCloseTo(base.stats.rateMult * 1.15); expect(a.stats.dmgMult).toBeCloseTo(base.stats.dmgMult * 1.1);
    const b = new Sim(1, metaParams({}, 'sister2'));
    expect(b.player.maxEnergy).toBe(base.player.maxEnergy + 25); expect(b.stats.magnetMult).toBeCloseTo(1.3); expect(b.stats.xpMult).toBeCloseTo(1.1);
  });
  it('알 수 없는 파일럿 id는 기본(에이스)으로 처리한다', () => {
    expect(metaParams({}, 'nobody').rateMult).toBe(1);
  });
  it('격납고 강화와 파일럿 패시브가 곱/합으로 함께 적용된다', () => {
    const s = new Sim(1, metaParams({ hull: 2, intel: 3 }, 'sister2'));
    expect(s.player.maxEnergy).toBe(100 + 20 + 25);
    expect(s.stats.xpMult).toBeCloseTo(1.3 * 1.1);
  });
});

describe('미사일 타격감', () => {
  const E2 = (x: number, y: number, hp: number, type: EnemyType = 'zigzag'): Enemy => ({ ...mkEnemy(type, x, y), hp, maxHp: hp });
  it('미사일이 맞으면 착탄 이벤트·피격 섬광·넉백이 생긴다', () => {
    const s = new Sim(1);
    s.enemies.push(E2(225, 300, 8));
    s.missiles.push({ x: 225, y: 300, vx: 0, vy: 0, speed: 7.5, dmg: 3 });
    s.step(idle(s));
    const ev = s.drainEvents().filter(e => e.t === 'missileHit');
    expect(ev).toHaveLength(1);
    expect(ev[0].t === 'missileHit' && ev[0].kill).toBe(false);
    expect(s.enemies[0].flash).toBeGreaterThan(0);
    expect(s.enemies[0].y).toBeLessThan(300);          // 넉백
  });
  it('미사일 처치는 kill 이벤트에 missile=true, 점수 팝업용 pts가 담긴다', () => {
    const s = new Sim(1);
    s.enemies.push(E2(225, 300, 2));
    s.missiles.push({ x: 225, y: 300, vx: 0, vy: 0, speed: 7.5, dmg: 3 });
    s.step(idle(s));
    const ev = s.drainEvents();
    const hit = ev.find(e => e.t === 'missileHit'), kill = ev.find(e => e.t === 'kill');
    expect(hit && hit.t === 'missileHit' && hit.kill).toBe(true);
    expect(kill && kill.t === 'kill' && kill.missile && kill.pts > 0).toBe(true);
  });
  it('총알 처치는 missile=false', () => {
    const s = new Sim(1);
    s.enemies.push(E2(225, 300, 1, 'scout'));
    s.bullets.push({ x: 225, y: 300, vx: 0, vy: 0, dmg: 1, pierce: 0 });
    s.step(idle(s));
    const kill = s.drainEvents().find(e => e.t === 'kill');
    expect(kill && kill.t === 'kill' && kill.missile).toBe(false);
  });
  it('폭발 범위 피해: 착탄 지점 주변의 다른 적도 절반 피해를 입고, 먼 적은 무사하다', () => {
    const s = new Sim(1);
    s.enemies.push(E2(225, 300, 6, 'scout'), E2(255, 300, 6, 'scout'), E2(400, 300, 6, 'scout'));
    s.missiles.push({ x: 225, y: 300, vx: 0, vy: 0, speed: 7.5, dmg: 4 });
    s.step(idle(s));
    const byX = (x: number) => s.enemies.find(e => Math.abs(e.x - x) < 2)!;
    expect(byX(255).hp).toBe(4);                       // 4 × 0.5 = 2 피해
    expect(byX(400).hp).toBe(6);
  });
});

describe('파일럿 전용 궁극기', () => {
  const fill = (s: Sim) => { s.ult.gauge = 100; };
  it('파일럿에 따라 궁극기 종류가 정해진다', () => {
    expect(new Sim(1, metaParams({}, 'ace')).ult.kind).toBe('palm');
    expect(new Sim(1, metaParams({}, 'sister1')).ult.kind).toBe('barrage');
    expect(new Sim(1, metaParams({}, 'sister2')).ult.kind).toBe('timestop');
  });
  it('언니: 컷인 동안 정지 → 탄 제거 → 3초간 위에서 미사일이 쏟아지고 끝나면 IDLE', () => {
    const s = new Sim(1, metaParams({}, 'sister1')); fill(s);
    s.enemyBullets.push({ x: 100, y: 300, vx: 0, vy: 0, color: '#fff', r: 4 });
    s.step(idle(s, false, { skill: 'ult' }));
    const f = s.frame;
    for (let i = 0; i < 89; i++) { s.step(idle(s)); expect(s.frame).toBe(f); }
    s.step(idle(s));
    expect(s.ult.phase).toBe('ACTIVE'); expect(s.enemyBullets).toHaveLength(0); expect(s.player.invincible).toBeGreaterThan(100);
    let maxMissiles = 0, fromTop = false;
    for (let i = 0; i < 80; i++) { s.step(idle(s)); maxMissiles = Math.max(maxMissiles, s.missiles.length); if (s.missiles.some(m => m.vy > 0)) fromTop = true; }
    expect(maxMissiles).toBeGreaterThan(20); expect(fromTop).toBe(true);
    for (let i = 0; i < 160; i++) s.step(idle(s));
    expect(s.ult.phase).toBe('IDLE');
  });
  it('언니의 미사일 포격은 보스에게 큰 피해를 준다', () => {
    const s = new Sim(1, metaParams({}, 'sister1'));
    s.bossTier = 3; s.stagePhase = 'WARNING'; s.phaseTimer = 1; s.player.invincible = 99999; s.step(idle(s));
    const boss = s.boss!; boss.y = 135; const hp0 = boss.hp;
    fill(s); s.step(idle(s, false, { skill: 'ult' }));
    for (let i = 0; i < 90 + 220; i++) { s.player.invincible = 99999; s.step(idle(s)); }
    expect(boss.hp).toBeLessThan(hp0 * 0.9);
  });
  it('동생: 시간 정지 동안 적·적 탄·보스는 움직이지 않지만 내 공격은 들어간다', () => {
    const s = new Sim(1, metaParams({}, 'sister2'));
    s.enemies.push({ ...mkEnemy('scout', 200, 200), hp: 50, maxHp: 50, speed: 3 });
    s.enemyBullets.push({ x: 300, y: 300, vx: 0, vy: 3, color: '#fff', r: 4 });
    fill(s); s.step(idle(s, false, { skill: 'ult' }));
    for (let i = 0; i < 90; i++) s.step(idle(s));     // 컷인
    expect(s.timeStopped).toBe(true);
    const ey = s.enemies[0].y, by = s.enemyBullets[0].y;
    for (let i = 0; i < 60; i++) s.step(idle(s, true));
    expect(s.enemies[0].y).toBe(ey); expect(s.enemyBullets[0].y).toBe(by);
    s.bullets.push({ x: 200, y: 200, vx: 0, vy: 0, dmg: 4, pierce: 0 }); s.step(idle(s));
    expect(s.enemies[0].hp).toBeLessThan(50);          // 정지 중에도 피해는 들어간다
    for (let i = 0; i < 100; i++) s.step(idle(s));
    expect(s.timeStopped).toBe(false);
    s.step(idle(s)); expect(s.enemies[0].y).toBeGreaterThan(ey); // 해제 후 다시 움직임
  });
  it('시간 정지 중에는 새 적이 나오지 않고, 플레이어는 피해를 받지 않는다', () => {
    const s = new Sim(1, metaParams({}, 'sister2'));
    fill(s); s.step(idle(s, false, { skill: 'ult' }));
    for (let i = 0; i < 90; i++) s.step(idle(s));
    const n = s.enemies.length;
    for (let i = 0; i < 120; i++) s.step(idle(s));
    expect(s.enemies.length).toBe(n);
    const e0 = s.player.energy; s.applyDamage(50);
    expect(s.player.energy).toBe(e0);
  });
  it('시간 정지 중에는 내 탄 피해가 1.5배', () => {
    const a = new Sim(1, metaParams({}, 'sister2')), b = new Sim(1, metaParams({}, 'sister2'));
    fill(b); b.step(idle(b, false, { skill: 'ult' })); for (let i = 0; i < 90; i++) b.step(idle(b));
    a.step(idle(a, true)); b.step(idle(b, true));
    expect(b.bullets[0].dmg).toBeCloseTo(a.bullets[0].dmg * 1.5);
  });
});

describe('무한 모드', () => {
  function clearAll(s: Sim) {
    for (let i = 0; i < 60 * 60 * 25 && s.state === 'PLAYING'; i++) {
      s.player.invincible = 999; if (s.pending) s.chooseCard(0);
      s.step({ targetX: s.boss ? s.boss.x : s.midBoss ? s.midBoss.x : 225, targetY: 650, fire: true, bomb: false });
    }
  }
  it('5스테이지 클리어 후 GAMECLEAR → startEndless로 6스테이지(1번 구성, 루프 1)가 이어진다', () => {
    const s = new Sim(7); clearAll(s);
    expect(s.state).toBe('GAMECLEAR'); expect(s.endless).toBe(false);
    s.startEndless();
    expect(s.state).toBe('PLAYING'); expect(s.endless).toBe(true);
    expect(s.bossTier).toBe(6); expect(s.stageTier).toBe(1); expect(s.loopCount).toBe(1); expect(s.stagePhase).toBe('INTRO');
  });
  it('루프 1의 보스는 체력 +50%, 이름은 STAGE 6로 표시, 적 탄은 더 빠르다', () => {
    const s = new Sim(1); s.bossTier = 6; s.endless = true;
    s.stagePhase = 'WARNING'; s.phaseTimer = 1; s.player.invincible = 99999; s.step({ targetX: 225, targetY: 650, fire: false, bomb: false });
    expect(s.boss!.name).toContain('STAGE 6'); expect(s.boss!.maxHp).toBe(Math.round(700 * 1.5)); expect(s.boss!.tier).toBe(1);
    expect(s.enemyBulletSpeed).toBeCloseTo(1.06);
  });
  it('무한 모드에서는 5스테이지를 넘겨도 GAMECLEAR 되지 않고 계속 진행한다', () => {
    const s = new Sim(1); s.bossTier = 5; s.endless = true; s.stagePhase = 'CLEAR'; s.phaseTimer = 1;
    s.step({ targetX: 225, targetY: 650, fire: false, bomb: false });
    expect(s.state).toBe('PLAYING'); expect(s.bossTier).toBe(6);
  });
  it('startEndless는 GAMECLEAR가 아닐 때는 아무 일도 하지 않는다', () => {
    const s = new Sim(1); s.startEndless();
    expect(s.endless).toBe(false); expect(s.bossTier).toBe(1);
  });
  it('3번째 보스 궁극기 보너스는 첫 루프에서만', () => {
    const s = new Sim(1); s.bossTier = 8; s.endless = true; s.stagePhase = 'WARNING'; s.phaseTimer = 1; s.player.invincible = 99999;
    s.step({ targetX: 225, targetY: 650, fire: false, bomb: false });
    s.boss!.hp = 0; s.step({ targetX: 225, targetY: 650, fire: false, bomb: false });
    expect(s.ult.gauge).toBeLessThan(100);
  });
});

describe('런 모디파이어', () => {
  const sim = (id: string | null) => new Sim(1, metaParams({}, 'ace', id));
  it('모디파이어가 없으면 기본값과 동일하다', () => {
    const a = sim(null);
    expect(a.player.maxEnergy).toBe(100); expect(a.enemyBulletSpeed).toBe(1); expect(a.meta.mutator).toBeNull();
  });
  it('유리 대포: 최대 에너지 60%, 내 피해 1.5배', () => {
    const s = sim('glass'), base = sim(null);
    expect(s.player.maxEnergy).toBe(60); expect(s.stats.dmgMult).toBeCloseTo(base.stats.dmgMult * 1.5);
  });
  it('탄막 폭풍: 적 탄이 빠르고 보스 공격 주기가 짧다', () => {
    const s = sim('storm');
    expect(s.enemyBulletSpeed).toBeCloseTo(1.2);
    s.stagePhase = 'WARNING'; s.phaseTimer = 1; s.player.invincible = 99999; s.step(idle(s));
    expect(s.boss!.shotCdMax).toBe(Math.round(44 * 0.85));
  });
  it('강철 장갑 / 평온한 하늘: 일반 적 체력이 변한다', () => {
    const spawn = (id: string | null) => { const s = sim(id); for (let i = 0; i < 400 && s.enemies.length === 0; i++) { s.player.invincible = 99999; s.step(idle(s)); } return s.enemies[0].maxHp; };
    expect(spawn('tough')).toBeGreaterThan(spawn(null)); expect(spawn('calm')).toBeLessThan(spawn(null));
  });
  it('질주하는 적: 적 이동 속도 +25%', () => {
    const spawn = (id: string | null) => { const s = new Sim(5, metaParams({}, 'ace', id)); for (let i = 0; i < 400 && s.enemies.length === 0; i++) { s.player.invincible = 99999; s.step(idle(s)); } return s.enemies[0].speed; };
    expect(spawn('swift')).toBeCloseTo(spawn(null) * 1.25);
  });
  it('보급 단절: 아이템이 훨씬 덜 나온다', () => {
    const drops = (id: string | null) => { const s = new Sim(3, metaParams({}, 'ace', id)); let n = 0; for (let i = 0; i < 3000; i++) { s.enemies.push({ ...mkEnemy('scout', 225, 300), hp: 0, maxHp: 1 }); s.player.invincible = 99999; s.step(idle(s)); } n = s.items.length; return n; };
    expect(drops('famine')).toBeLessThan(drops(null));
  });
  it('점수/경험치/크레딧 배율이 반영된다', () => {
    const s = sim('swift'); expect(s.stats.xpMult).toBeCloseTo(1.25); expect(s.meta.mut.credit).toBe(1.2);
    const kill = (id: string | null) => { const t = sim(id); t.enemies.push({ ...mkEnemy('scout', 225, 300), hp: 0, maxHp: 1 }); t.step(idle(t)); return t.score; };
    expect(kill('swift')).toBeGreaterThan(kill(null) - 1);
    expect(kill('glass')).toBe(Math.round(10 * 1.3));
  });
  it('제안은 서로 다른 3개', () => {
    const o = offerMutators(createRng(9)); expect(o).toHaveLength(3); expect(new Set(o).size).toBe(3);
  });
});

describe('융합 확장 (아이기스 오빗 / 프리즘 / 오버클럭)', () => {
  const make = (levels: Record<string, number>) => { const s = new Sim(1); s.build.levels = levels as never; s.stats = statsOf(s.build); return s; };
  it('조건을 만족해야 융합 카드가 열린다 (패시브와의 융합 포함)', () => {
    const b = newBuild(); b.levels.drone = 2; b.levels.aegis = 1;
    expect(fusionAvailable(b, 'aegisorbit')).toBe(false);
    b.levels.aegis = 2; expect(fusionAvailable(b, 'aegisorbit')).toBe(true);
    const c = newBuild(); c.levels.laser = 3; c.levels.spread = 3; expect(fusionAvailable(c, 'prism')).toBe(true);
    const d = newBuild(); d.levels.rate = 3; d.levels.power = 3; expect(fusionAvailable(d, 'overdrive')).toBe(true);
  });
  it('프리즘: 레이저가 3줄기로 갈라져 양옆의 적도 맞힌다', () => {
    const s = make({ laser: 3, spread: 3, prism: 1 });
    s.enemies.push({ ...mkEnemy('sniper', s.player.x + 38, s.player.y - 200), hp: 6, maxHp: 6 });
    for (let i = 0; i < 12; i++) { s.player.invincible = 99999; s.step(idle(s, true)); }
    expect(s.laser.offs).toEqual([-38, 0, 38]);
    expect(s.enemies.length === 0 || s.enemies[0].hp < 6).toBe(true);
  });
  it('오버클럭: 콤보 5 이상일 때만 연사·피해가 오른다', () => {
    const a = make({ rate: 3, power: 3, overdrive: 1 }), b = make({ rate: 3, power: 3, overdrive: 1 });
    b.combo = 6; b.comboTimer = 100;
    a.step(idle(a, true)); b.step(idle(b, true));
    expect(b.bullets[0].dmg).toBeCloseTo(a.bullets[0].dmg * 1.2);
  });
  it('아이기스 오빗: 드론이 닿는 적 탄을 지운다', () => {
    const s = make({ drone: 2, aegis: 2, aegisorbit: 1 });
    const d = s.dronePositions()[0];
    s.enemyBullets.push({ x: d.x, y: d.y, vx: 0, vy: 0, color: '#fff', r: 4 });
    const e0 = s.player.energy; s.step(idle(s));
    expect(s.enemyBullets).toHaveLength(0); expect(s.player.energy).toBe(e0);
  });
});

describe('일일 도전', () => {
  it('같은 날짜는 같은 시드·같은 모디파이어, 날짜가 바뀌면 달라질 수 있다', () => {
    expect(dailySeed('2026-10-02')).toBe(dailySeed('2026-10-02'));
    expect(dailySeed('2026-10-02')).not.toBe(dailySeed('2026-10-03'));
    expect(dailyMutator('2026-10-02')).toBe(dailyMutator('2026-10-02'));
    const seen = new Set<string>(); for (let d = 1; d <= 28; d++) seen.add(dailyMutator(`2026-10-${String(d).padStart(2, '0')}`));
    expect(seen.size).toBeGreaterThan(2);
  });
  it('같은 시드와 같은 입력이면 항상 같은 결과 (모두가 같은 조건)', () => {
    const run = () => { const s = new Sim(dailySeed('2026-10-02'), metaParams({}, 'ace', dailyMutator('2026-10-02'))); for (let i = 0; i < 1200; i++) { if (s.pending) s.chooseCard(0); s.player.invincible = 999; s.step({ targetX: 225 + Math.sin(i / 25) * 140, targetY: 640, fire: true, bomb: false }); } return [s.score, s.enemies.length, s.level].join(','); };
    expect(run()).toBe(run());
  });
  it('dayKey 형식은 YYYY-MM-DD', () => { expect(dayKey(new Date(2026, 9, 2))).toBe('2026-10-02'); });
});

describe('최종 보스 3페이즈', () => {
  const boss5 = () => { const s = new Sim(1); s.bossTier = 5; s.stagePhase = 'WARNING'; s.phaseTimer = 1; s.player.invincible = 99999; s.step(idle(s)); s.boss!.y = 135; return s; };
  it('체력 20% 이하에서 한 번만 3페이즈에 들어가고 경고 타이머가 줄어든다', () => {
    const s = boss5(); const b = s.boss!;
    b.hp = b.maxHp * 0.45; s.step(idle(s)); expect(b.phase2).toBe(true); expect(b.phase3).toBeFalsy();
    b.hp = b.maxHp * 0.19; s.step(idle(s)); expect(b.phase3).toBe(true); expect(b.phase3Alert).toBeGreaterThan(90);
    const cd = b.shotCdMax; for (let i = 0; i < 120; i++) { s.player.invincible = 99999; s.step(idle(s)); }
    expect(b.shotCdMax).toBe(cd); expect(b.phase3Alert).toBe(0);
  });
  it('3페이즈 패턴은 2페이즈와 다르다', () => {
    const out2: EnemyBullet[] = [], out3: EnemyBullet[] = [];
    const b = { tier: 5, name: 't', x: 100, y: 100, targetY: 100, width: 100, height: 100, vx: 2, hp: 1, maxHp: 1, shootCooldown: 0, attackMode: 1 as 1 | 2, color: '#fff', subColor: '#fff', shotCdMax: 20, phase2: true, phase2Alert: 0, dying: false, deathTimer: 0 };
    BOSS_PATTERNS[5][1]![1](b, { player: { x: 300, y: 500 }, frame: 5, emit: x => out2.push(x) });
    BOSS_PATTERNS[5][2]![1](b, { player: { x: 300, y: 500 }, frame: 5, emit: x => out3.push(x) });
    expect(out3.length).toBe(14 + 5); expect(out3.length).not.toBe(out2.length);
  });
  it('다른 보스에는 3페이즈가 없다', () => {
    const s = new Sim(1); s.bossTier = 3; s.stagePhase = 'WARNING'; s.phaseTimer = 1; s.player.invincible = 99999; s.step(idle(s));
    s.boss!.y = 135; s.boss!.hp = s.boss!.maxHp * 0.05; s.step(idle(s)); expect(s.boss!.phase3).toBeFalsy();
  });
});

describe('스테이지 장애물', () => {
  const at = (tier: number) => { const s = new Sim(7); s.startAtTier(tier); s.stagePhase = 'FIGHT'; s.stageFrames = 0; s.player.invincible = 0; return s; };
  const run = (s: Sim, n: number, f?: () => void) => { for (let i = 0; i < n; i++) { f?.(); s.step(idle(s)); } };
  it('1스테이지에는 장애물이 없다', () => {
    const s = at(1); s.player.invincible = 99999; run(s, 1500);
    expect(s.hazards.length).toBe(0); expect(s.windT + s.windWarn).toBe(0);
  });
  it('3스테이지: 운석이 예고 후 떨어지고 맞으면 피해를 준다', () => {
    const s = at(3); s.player.invincible = 99999; let seen = false;
    run(s, 800, () => { s.player.invincible = 99999; if (s.hazards.some(h => h.kind === 'meteor')) seen = true; s.stageFrames = Math.min(s.stageFrames, 500); });
    expect(seen).toBe(true);
    s.player.invincible = 0; const e0 = s.player.energy;
    s.hazards.push({ kind: 'meteor', x: s.player.x, y: s.player.y - 5, t: 61, warn: 60, dur: 0 });
    s.step(idle(s)); expect(s.player.energy).toBeLessThan(e0);
  });
  it('4스테이지: 용암 기둥은 예고 중에는 안전하고 분출하면 아프다', () => {
    const s = at(4); s.player.invincible = 0; const e0 = s.player.energy;
    s.hazards.push({ kind: 'lava', x: s.player.x, y: 0, t: 5, warn: 70, dur: 40 });
    run(s, 30); expect(s.player.energy).toBe(e0);
    s.hazards.push({ kind: 'lava', x: s.player.x, y: 0, t: 70, warn: 70, dur: 40 });
    s.step(idle(s)); expect(s.player.energy).toBeLessThan(e0);
  });
  it('2스테이지: 바람이 불면 적 탄이 밀리고 보스전에서는 사라진다', () => {
    const s = at(2); s.windDir = 1; s.windT = 100;
    expect(s.windForce).toBeGreaterThan(0);
    s.stagePhase = 'WARNING'; s.step(idle(s));
    expect(s.windT).toBe(0); expect(s.hazards.length).toBe(0);
  });
  it('시간 정지 중에는 장애물이 진행하지 않는다', () => {
    const s = at(3); s.hazards.push({ kind: 'meteor', x: 100, y: -24, t: 0, warn: 60, dur: 0 });
    (s as any).ult.phase = 'ACTIVE'; (s as any).ult.kind = 'timestop';
    s.step(idle(s)); expect(s.hazards[0].t).toBe(0);
  });
});

describe('업적', () => {
  const base = { score: 0, bossTier: 1, cleared: false, endless: false, kills: 0, maxCombo: 0, graze: 0, hits: 0, bombs: 0, ults: 0, fusions: 0, mutator: null, daily: false };
  it('조건을 만족한 업적만 새로 해금되고, 이미 가진 것은 제외된다', () => {
    const ids = (r: any, have: string[] = []) => newlyUnlocked({ ...base, ...r }, have).map(a => a.id);
    expect(ids({})).toEqual([]);
    expect(ids({ bossTier: 3, hits: 0 })).toEqual(expect.arrayContaining(['stage2', 'stage3', 'untouched']));
    expect(ids({ bossTier: 3 }, ['stage2'])).not.toContain('stage2');
    expect(ids({ cleared: true, bossTier: 5, mutator: 'swift' })).toEqual(expect.arrayContaining(['clear', 'mutclear']));
    expect(ids({ bossTier: 4, bombs: 1 })).not.toContain('nobomb');
  });
  it('Sim이 처치·콤보·피격·폭탄 통계를 센다', () => {
    const s = new Sim(3); s.player.invincible = 0;
    s.bombs = 2; s.frame = 100; s.step(idle(s, false, { bomb: true }));
    expect(s.run.bombs).toBe(1);
    s.player.invincible = 0; s.applyDamage(10); expect(s.run.hits).toBe(1);
    expect(s.runStats(true)).toMatchObject({ hits: 1, bombs: 1, daily: true, cleared: false });
  });
  it('업적 id는 중복되지 않는다', () => {
    expect(new Set(ACHIEVEMENTS.map(a => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});

describe('보스 특수 공격(레이저/돌진)', () => {
  const boss = (tier: number) => { const s = new Sim(1); s.bossTier = tier; s.stagePhase = 'WARNING'; s.phaseTimer = 1; s.player.invincible = 99999; s.step(idle(s)); s.boss!.y = s.boss!.targetY; return s; };
  const spin = (s: Sim, n: number, f?: () => void) => { for (let i = 0; i < n; i++) { f?.(); s.step(idle(s)); } };
  it('1스테이지 보스는 특수 공격이 없다', () => {
    const s = boss(1); spin(s, 1500, () => { s.player.invincible = 99999; s.boss!.hp = s.boss!.maxHp; });
    expect(s.boss!.sp).toBeUndefined();
  });
  it('2스테이지 보스: 레이저가 예고 → 발사 → 끝나고 일반 패턴으로 돌아간다', () => {
    const s = boss(2); const seen = new Set<string>();
    spin(s, 900, () => { s.player.invincible = 99999; s.boss!.hp = s.boss!.maxHp; if (s.boss!.sp) seen.add(s.boss!.sp.kind + ':' + s.boss!.sp.state); });
    expect(seen.has('laser:WARN')).toBe(true); expect(seen.has('laser:ACT')).toBe(true);
    expect(s.boss!.sp === undefined || s.boss!.sp.kind === 'laser').toBe(true);
  });
  it('레이저: 빔 안에 있으면 피해, 2페이즈의 틈에서는 안전', () => {
    const s = boss(2); const b = s.boss!; b.x = 225; s.player.invincible = 0; s.player.x = 225; s.player.y = 600; const e0 = s.player.energy;
    b.sp = { kind: 'laser', state: 'ACT', t: 1, lockX: 225, beams: [0] };
    s.step(idle(s)); expect(s.player.energy).toBeLessThan(e0);
    const s2 = boss(2); const b2 = s2.boss!; b2.phase2 = true; b2.x = 225; s2.player.invincible = 0; s2.player.x = 225 + 60; s2.player.y = 600; const e1 = s2.player.energy;
    b2.sp = { kind: 'laser', state: 'ACT', t: 1, lockX: 225, beams: [-120, 0, 120] };
    s2.step({ ...idle(s2), targetX: 285, targetY: 600 }); expect(s2.player.energy).toBe(e1);
  });
  it('3스테이지 보스: 돌진은 바닥에서 충격파(탄 고리)를 내고 제자리로 복귀한다', () => {
    const s = boss(3); const b = s.boss!; s.player.x = 60; s.player.targetX = 60;
    b.sp = { kind: 'charge', state: 'ACT', t: 0, lockX: b.x, beams: [0] };
    let impact = false, bullets0 = s.enemyBullets.length;
    spin(s, 120, () => { s.player.invincible = 99999; b.hp = b.maxHp; if (b.sp?.state === 'RET') impact = true; });
    expect(impact).toBe(true); expect(s.enemyBullets.length).toBeGreaterThan(bullets0 - 1);
    spin(s, 120, () => { s.player.invincible = 99999; b.hp = b.maxHp; });
    expect(b.sp).toBeUndefined(); expect(b.y).toBe(b.targetY);
  });
  it('보스가 죽는 순간 특수 공격은 중단되고 시간 정지 중에는 진행하지 않는다', () => {
    const s = boss(2); const b = s.boss!; b.sp = { kind: 'laser', state: 'WARN', t: 0, lockX: 100, beams: [0] };
    (s as any).ult.phase = 'ACTIVE'; (s as any).ult.kind = 'timestop'; const x0 = b.x; s.step(idle(s)); expect(b.x).toBe(x0); expect(b.sp.t).toBe(0);
    (s as any).ult.phase = 'IDLE'; b.hp = 0; s.step(idle(s)); expect(b.sp).toBeUndefined();
  });
});

describe('보스 약점 노출(그로기)', () => {
  const boss = () => { const s = new Sim(1); s.bossTier = 2; s.stagePhase = 'WARNING'; s.phaseTimer = 1; s.player.invincible = 99999; s.step(idle(s)); s.boss!.y = s.boss!.targetY; return s; };
  it('특수 공격이 끝나면 보스가 멈추고 탄이 지워지며 피해가 늘어난다', () => {
    const s = boss(); const b = s.boss!;
    b.sp = { kind: 'laser', state: 'ACT', t: 44, lockX: 225, beams: [0] };
    s.enemyBullets.push({ x: 10, y: 10, vx: 0, vy: 0, color: '#fff', r: 3 });
    s.step(idle(s));
    expect(b.sp).toBeUndefined(); expect(b.stun).toBeGreaterThan(70); expect(s.enemyBullets.length).toBe(0);
    const x0 = b.x; s.step(idle(s)); expect(b.x).toBe(x0);
    const hp0 = b.hp; s.bullets.push({ x: b.x, y: b.y, vx: 0, vy: 0, dmg: 2, pierce: 0 } as any); s.step(idle(s));
    expect(hp0 - b.hp).toBeGreaterThanOrEqual(3);
  });
  it('그로기가 끝나면 다시 움직이고, 보스가 죽으면 그로기는 해제된다', () => {
    const s = boss(); const b = s.boss!; b.stun = 3;
    for (let i = 0; i < 6; i++) { s.player.invincible = 99999; s.step(idle(s)); }
    expect(b.stun).toBe(0);
    b.stun = 50; b.hp = 0; s.step(idle(s)); expect(b.stun).toBe(0);
  });
});
