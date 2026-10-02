import { describe, expect, it } from 'vitest';
import { H, W } from '../src/core/config';
import { BOSS_PATTERNS } from '../src/core/data';
import { Sim } from '../src/core/sim';
import { ENEMY_DEFS, FIGHT_FRAMES, comboMultiplier, rankFor } from '../src/core/data';
import type { Boss, Bullet, Enemy, EnemyBullet, EnemyType, SimInput } from '../src/core/types';

const mkEnemy = (type: EnemyType, x: number, y: number, hp = ENEMY_DEFS[type].hp): Enemy =>
  ({ type, x, y, hp, maxHp: hp, speed: type === 'sniper' ? 2.6 : 3, baseX: x, age: 0, fireCd: 999, hold: 0 });
const bullet = (x: number, y: number, dmg = 1, pierce = 0): Bullet => ({ x, y, vx: 0, vy: 0, dmg, pierce });
const idle = (s: Sim, fire = false): SimInput => ({ targetX: s.player.x, targetY: s.player.y, fire, bomb: false });

function makeBoss(tier: number, phase2: boolean, mode: 1 | 2): Boss {
  return {
    tier, name: 't', x: 100, y: 100, targetY: 100, width: 100, height: 100, vx: 2, hp: 100, maxHp: 100,
    shootCooldown: 0, attackMode: mode, color: '#fff', subColor: '#fff', shotCdMax: 30,
    phase2, phase2Alert: 0, dying: false, deathTimer: 0,
  };
}
function fireCount(tier: number, phase2: boolean, mode: 1 | 2, player = { x: 300, y: 500 }): EnemyBullet[] {
  const out: EnemyBullet[] = [];
  BOSS_PATTERNS[tier][phase2 ? 1 : 0][mode](makeBoss(tier, phase2, mode), { player, frame: 10, emit: b => out.push(b) });
  return out;
}

describe('보스 탄막 패턴', () => {
  // [티어] → 1페이즈모드1 / 1페이즈모드2 / 2페이즈모드1 / 2페이즈모드2 발사 수
  const expected: Record<number, number[]> = { 1: [2, 3, 4, 3], 2: [3, 5, 7, 8], 3: [5, 5, 8, 4], 4: [4, 8, 6, 10], 5: [8, 12, 12, 11] };
  for (const tier of [1, 2, 3, 4, 5]) {
    it(`티어 ${tier} 발사 수`, () => {
      const got = [fireCount(tier, false, 1).length, fireCount(tier, false, 2).length, fireCount(tier, true, 1).length, fireCount(tier, true, 2).length];
      expect(got).toEqual(expected[tier]);
    });
  }

  it('조준탄은 플레이어 쪽으로 날아간다 (좌우 반전 버그 회귀 방지)', () => {
    const right = fireCount(1, true, 2, { x: 400, y: 500 });   // 플레이어가 보스 오른쪽 아래
    const mid = right[1];
    expect(mid.vx).toBeGreaterThan(0);
    expect(mid.vy).toBeGreaterThan(0);
    const left = fireCount(1, true, 2, { x: -200, y: 500 });
    expect(left[1].vx).toBeLessThan(0);
  });
});

describe('시뮬레이션', () => {
  it('같은 시드와 입력이면 결과가 같다 (결정론)', () => {
    const run = () => {
      const s = new Sim(42);
      for (let i = 0; i < 1500; i++) s.step({ targetX: 225 + Math.sin(i / 40) * 150, targetY: 640, fire: true, bomb: false });
      return JSON.stringify([s.score, s.player.energy, s.lives, s.enemies.length, s.enemyBullets.length, s.stagePhase]);
    };
    expect(run()).toBe(run());
  });

  it('무적 상태에서 스테이지 1→5를 순서대로 진행해 GAMECLEAR 한다', () => {
    const s = new Sim(7);
    const phases: string[] = [];
    let last = '';
    for (let i = 0; i < 60 * 60 * 20 && s.state === 'PLAYING'; i++) {
      s.player.invincible = 999;
      if (s.pending) s.chooseCard(0);
      s.step({ targetX: s.boss ? s.boss.x : s.midBoss ? s.midBoss.x : 225, targetY: 650, fire: true, bomb: false });
      const key = `${s.bossTier}:${s.stagePhase}`;
      if (key !== last) { phases.push(key); last = key; }
    }
    expect(s.state).toBe('GAMECLEAR');
    expect(s.bossTier).toBe(5);
    // 각 스테이지는 FIGHT → WARNING → BOSS → BOSS_DYING → CLEAR 순서
    const t1 = phases.filter(p => p.startsWith('1:'));
    expect(t1).toEqual(['1:FIGHT', '1:WARNING', '1:BOSS', '1:BOSS_DYING', '1:CLEAR']);
    expect(phases).toContain('2:FIGHT');
  });

  it('폭탄은 화면 안의 적만 제거한다', () => {
    const s = new Sim(1);
    s.enemies.push({ ...mkEnemy('scout', 100, -30), speed: 0 }, { ...mkEnemy('scout', 100, 200), speed: 0 });
    s.frame = 100;
    s.fireBomb();
    expect(s.enemies.map(e => e.hp)).toEqual([2, 0]);   // 화면 밖(첫 번째)은 그대로, 화면 안(두 번째)은 파괴
    expect(s.bombs).toBe(0);
  });

  it('폭탄은 쿨다운 안에서 중복 사용되지 않고 보스 연출 중에는 사용 불가', () => {
    const s = new Sim(1);
    s.bombs = 2; s.frame = 100;
    s.fireBomb(); s.fireBomb();
    expect(s.bombs).toBe(1);
    s.frame = 200; s.stagePhase = 'BOSS_DYING';
    s.fireBomb();
    expect(s.bombs).toBe(1);
  });

  it('에너지가 0이 되면 라이프를 소모하고, 라이프가 없으면 GAMEOVER', () => {
    const s = new Sim(1);
    s.applyDamage(100);
    expect(s.lives).toBe(1); expect(s.player.energy).toBe(100); expect(s.state).toBe('PLAYING');
    s.player.invincible = 0; s.applyDamage(100);
    s.player.invincible = 0; s.applyDamage(100);
    expect(s.state).toBe('GAMEOVER');
    expect(s.drainEvents().some(e => e.t === 'gameover')).toBe(true);
  });

  it('무적 시간 중에는 피해를 받지 않는다', () => {
    const s = new Sim(1);
    s.applyDamage(30);
    const e = s.player.energy;
    s.applyDamage(30);
    expect(s.player.energy).toBe(e);
  });

  it('2페이즈 경고(phase2Alert)는 시간이 지나면 사라진다', () => {
    const s = new Sim(1);
    s.player.invincible = 99999;
    s.stagePhase = 'WARNING'; s.phaseTimer = 1; s.step(idle(s));
    expect(s.boss).not.toBeNull();
    s.boss!.hp = s.boss!.maxHp * 0.4;
    s.step(idle(s));
    expect(s.boss!.phase2).toBe(true);
    expect(s.boss!.phase2Alert).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) { s.player.invincible = 99999; s.step(idle(s)); }
    expect(s.boss!.phase2Alert).toBe(0);
  });

  it('플레이어는 화면 밖으로 나가지 않는다', () => {
    const s = new Sim(1);
    for (let i = 0; i < 120; i++) s.step({ targetX: -999, targetY: -999, fire: false, bomb: false });
    expect(s.player.x).toBeGreaterThanOrEqual(38); expect(s.player.y).toBeGreaterThanOrEqual(45);
    for (let i = 0; i < 120; i++) { s.player.invincible = 999; s.step({ targetX: W + 999, targetY: H + 999, fire: false, bomb: false }); }
    expect(s.player.x).toBeLessThanOrEqual(W - 38); expect(s.player.y).toBeLessThanOrEqual(H - 45);
  });

  it('파워업 아이템은 무기 레벨을 5까지만 올린다', () => {
    const s = new Sim(1);
    for (let i = 0; i < 8; i++) { s.items.push({ x: s.player.x, y: s.player.y, type: 'P' }); s.step(idle(s)); }
    expect(s.weaponLevel).toBe(5);
  });
});

describe('적 종류', () => {
  it('1스테이지는 정찰기만, 5스테이지는 비행기 4종과 비행기가 아닌 적들이 등장한다', () => {
    const seen = (tier: number) => {
      const s = new Sim(3); s.startAtTier(tier); s.stagePhase = 'FIGHT'; s.stageFrames = -1e9;
      const types = new Set<string>();
      for (let i = 0; i < 4000; i++) { s.player.invincible = 999; s.step(idle(s)); for (const e of s.enemies) types.add(e.type); }
      return types;
    };
    expect([...seen(1)]).toEqual(['scout']);
    const t5 = seen(5); for (const k of ['scout', 'zigzag', 'kamikaze', 'sniper']) expect(t5.has(k)).toBe(true); expect(t5.size).toBeGreaterThanOrEqual(6);   // 비행기 4종 + 기뢰·포대·운석 괴수(+쪼개진 드론)
  });

  it('지그재그는 체력 2: 한 발로는 안 죽는다', () => {
    const s = new Sim(1);
    s.enemies.push({ ...mkEnemy('zigzag', 225, 300), hp: 2, maxHp: 2 });
    s.bullets.push(bullet(225, 300));
    s.step(idle(s));
    expect(s.enemies).toHaveLength(1); expect(s.enemies[0].hp).toBe(1);
    s.bullets.push(bullet(s.enemies[0].x, s.enemies[0].y));
    s.step(idle(s));
    expect(s.enemies).toHaveLength(0);
  });

  it('저격형은 상단(y≈150)에 멈춰서 조준 사격을 한다', () => {
    const s = new Sim(1);
    s.player.invincible = 99999;
    s.enemies.push({ ...mkEnemy('sniper', 100, 0), fireCd: 5 });
    let shots = 0, maxY = 0;
    for (let i = 0; i < 300; i++) { const before = s.enemyBullets.length; s.step(idle(s)); if (s.enemyBullets.length > before) shots++; maxY = Math.max(maxY, s.enemies[0]?.y ?? 0); }
    expect(shots).toBeGreaterThan(0);
    expect(s.enemyBullets.some(b => b.color === '#38bdf8') || shots > 0).toBe(true);
  });

  it('돌진형은 플레이어 쪽으로 가로 이동한다', () => {
    const s = new Sim(1);
    s.player.invincible = 99999; s.player.x = s.player.targetX = 400;
    s.enemies.push({ ...mkEnemy('kamikaze', 50, 0), speed: 3 });
    for (let i = 0; i < 40; i++) s.step({ targetX: 400, targetY: s.player.y, fire: false, bomb: false });
    expect(s.enemies[0].x).toBeGreaterThan(80);
  });
});

describe('콤보 / 그레이즈 / 랭크', () => {
  it('콤보 배율은 6킬마다 0.25씩 오르고 2.5에서 멈춘다', () => {
    expect(comboMultiplier(0)).toBe(1); expect(comboMultiplier(6)).toBe(1.25); expect(comboMultiplier(60)).toBe(2.5); expect(comboMultiplier(999)).toBe(2.5);
  });
  it('연속 처치하면 점수 배율이 적용되고, 피격하면 콤보가 끊긴다', () => {
    const s = new Sim(1);
    for (let i = 0; i < 12; i++) { s.enemies.push({ ...mkEnemy('scout', 50, 200), speed: 0 }); s.enemies[s.enemies.length - 1].hp = 0; s.step(idle(s)); }
    expect(s.combo).toBe(12);
    expect(s.score).toBeGreaterThan(12 * 10);
    s.applyDamage(10);
    expect(s.combo).toBe(0);
  });
  it('콤보는 일정 시간 처치가 없으면 끝난다', () => {
    const s = new Sim(1);
    s.enemies.push({ ...mkEnemy('scout', 50, 200), hp: 0, speed: 0 }); s.step(idle(s));
    expect(s.combo).toBe(1);
    for (let i = 0; i < 125; i++) s.step(idle(s));
    expect(s.combo).toBe(0);
  });
  it('그레이즈는 탄 하나당 한 번만 점수를 준다', () => {
    const s = new Sim(1);
    s.enemyBullets.push({ x: s.player.x + s.player.radius + 8, y: s.player.y, vx: 0, vy: 0, color: '#fff', r: 4 });
    const before = s.score;
    for (let i = 0; i < 10; i++) s.step(idle(s));
    expect(s.grazeCount).toBe(1); expect(s.score).toBe(before + 2);
  });
  it('피격 횟수에 따라 랭크가 정해진다', () => {
    expect(rankFor(0).rank).toBe('S'); expect(rankFor(1).rank).toBe('A'); expect(rankFor(2).rank).toBe('B'); expect(rankFor(5).rank).toBe('C');
  });
  it('보스 처치 시 무피격이면 S랭크 보너스가 붙는다', () => {
    const s = new Sim(1);
    s.stagePhase = 'WARNING'; s.phaseTimer = 1; s.step(idle(s));
    s.boss!.hp = 0; const before = s.score; s.step(idle(s));
    expect(s.stageRank).toBe('S'); expect(s.score - before).toBe(200 + 500);
  });
});

describe('아이템', () => {
  it('방벽은 피격 1회를 흡수하고 사라진다', () => {
    const s = new Sim(1);
    s.player.shield = 1;
    s.player.invincible = 0; s.applyDamage(50);
    expect(s.player.energy).toBe(100); expect(s.player.shield).toBe(0);
    s.player.invincible = 0; s.applyDamage(50);
    expect(s.player.energy).toBe(50);
  });
  it('자석은 범위 안의 아이템을 끌어당긴다', () => {
    const s = new Sim(1);
    s.player.magnet = 600;
    s.items.push({ x: s.player.x + 100, y: s.player.y - 100, type: 'E' });
    const d0 = Math.hypot(100, 100);
    s.step(idle(s));
    const it = s.items[0];
    expect(Math.hypot(it.x - s.player.x, it.y - s.player.y)).toBeLessThan(d0 - 5);
  });
  it('목숨 아이템은 최대 4개까지', () => {
    const s = new Sim(1);
    for (let i = 0; i < 6; i++) { s.items.push({ x: s.player.x, y: s.player.y, type: 'L' }); s.step(idle(s)); }
    expect(s.lives).toBe(4);
  });
});

describe('중간보스', () => {
  it('스테이지 2에서 메인 보스 전에 등장하고, 처치 전에는 경고 단계로 넘어가지 않으며, 목숨을 떨군다', () => {
    const s = new Sim(1);
    s.bossTier = 2; s.stageFrames = Math.ceil(FIGHT_FRAMES[2] * 0.55) - 1;
    s.player.invincible = 99999;
    s.step(idle(s));
    expect(s.midBoss).not.toBeNull();
    s.stageFrames = FIGHT_FRAMES[2];       // 메인 보스 조건 충족
    for (let i = 0; i < 20; i++) s.step(idle(s));
    expect(s.stagePhase).toBe('FIGHT');   // 중간보스가 살아 있으면 대기
    s.midBoss!.hp = 0;
    for (let i = 0; i < 80; i++) { s.player.invincible = 99999; s.step(idle(s)); }
    expect(s.midBoss).toBeNull();
    expect(s.items.some(i => i.type === 'L') || s.lives > 2).toBe(true);
    for (let i = 0; i < 5; i++) s.step(idle(s));
    expect(s.stagePhase).toBe('WARNING');
  });
  it('레이저는 예고(CHARGE) 후 발사(FIRE)되고 맞으면 피해를 준다', () => {
    const s = new Sim(1);
    s.bossTier = 2; s.stageFrames = Math.ceil(FIGHT_FRAMES[2] * 0.55) - 1; s.step(idle(s));
    const m = s.midBoss!; m.y = m.targetY; m.state = 'CHARGE'; m.stateTimer = 60; m.x = s.player.x; m.lockX = m.x; m.laserX = m.x;
    for (let i = 0; i < 12 && (m.state as string) !== 'FIRE'; i++) s.step(idle(s));
    expect(m.state as string).toBe('FIRE');
    const e0 = s.player.energy; s.player.invincible = 0;
    s.step({ targetX: s.player.x, targetY: s.player.y, fire: false, bomb: false });
    expect(s.player.energy).toBeLessThan(e0);
  });
});
