import { describe, expect, it } from 'vitest';
import { BOMB, ULT } from '../src/core/data';
import { CARDS, fusionAvailable, newBuild, offerCards, statsOf, xpNeeded } from '../src/core/build';
import { createRng } from '../src/core/rng';
import { creditsFor, metaParams } from '../src/core/meta';
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
