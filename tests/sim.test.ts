import { describe, expect, it } from 'vitest';
import { H, W } from '../src/core/config';
import { BOSS_PATTERNS } from '../src/core/data';
import { Sim } from '../src/core/sim';
import type { Boss, EnemyBullet, SimInput } from '../src/core/types';

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
      s.step({ targetX: s.boss ? s.boss.x : 225, targetY: 650, fire: true, bomb: false });
      const key = `${s.bossTier}:${s.stagePhase}`;
      if (key !== last) { phases.push(key); last = key; }
    }
    expect(s.state).toBe('GAMECLEAR');
    expect(s.bossTier).toBe(5);
    // 각 스테이지는 FIGHT → WARNING → BOSS → BOSS_DYING → CLEAR 순서
    const t1 = phases.filter(p => p.startsWith('1:'));
    expect(t1).toEqual(['1:FIGHT', '1:WARNING', '1:BOSS', '1:BOSS_DYING', '1:CLEAR']);
  });

  it('폭탄은 화면 안의 적만 제거한다', () => {
    const s = new Sim(1);
    s.enemies.push({ x: 100, y: -30, hp: 1, speed: 0 }, { x: 100, y: 200, hp: 1, speed: 0 });
    s.frame = 100;
    s.fireBomb();
    expect(s.enemies.map(e => e.hp)).toEqual([1, 0]);
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

  it('파워업 아이템은 무기 레벨을 3까지만 올린다', () => {
    const s = new Sim(1);
    for (let i = 0; i < 5; i++) { s.items.push({ x: s.player.x, y: s.player.y, type: 'P' }); s.step(idle(s)); }
    expect(s.weaponLevel).toBe(3);
  });
});
