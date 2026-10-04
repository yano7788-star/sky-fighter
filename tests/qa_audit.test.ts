import { describe, expect, it } from 'vitest';
import { newlyUnlocked } from '../src/core/achievements';
import { MISSIONS } from '../src/core/missions';
import { Sim } from '../src/core/sim';

const idle = { targetX: 225, targetY: 660, fire: false, bomb: false, skill: null } as const;

describe('QA audit', () => {
  it('flank 횡대: 6열째 드론이 화면에 들어오기 전에 age>30 조건으로 삭제되지 않아야 한다', () => {
    const s = new Sim(1) as any;
    s.spawnHorde('flank', -20);
    const n0 = s.enemies.length;
    for (let i = 0; i < 40; i++) s.step(idle);
    // 36기 중 아직 화면을 가로지르는 중이어야 함 (너무 빨리 사라지면 버그)
    expect(n0).toBe(36);
    expect(s.enemies.length).toBeGreaterThanOrEqual(34);
  });

  it('시간 정지 중 hordeWarn 이 멈춘다 (HUD 경고가 정지 내내 깜빡임)', () => {
    const s = new Sim(2) as any;
    s.hordeWarn = 50; s.ult.kind = 'timestop'; s.ult.phase = 'ACTIVE'; s.ult.t = 0;
    for (let i = 0; i < 30; i++) s.step(idle);
    expect(s.hordeWarn).toBe(50);
  });

  it('시간 정지 중 보스가 레이저 ACT 상태면 sp.t 가 멈춘 채 sp 가 유지된다', () => {
    const s = new Sim(3) as any;
    s.stagePhase = 'BOSS'; s.spawnBoss(1); const b = s.boss; b.y = b.targetY; b.sp = { kind: 'laser', state: 'ACT', t: 5, lockX: b.x, beams: [0] };
    s.ult.kind = 'timestop'; s.ult.phase = 'ACTIVE'; s.ult.t = 0;
    for (let i = 0; i < 20; i++) s.step(idle);
    expect(b.sp).toBeTruthy(); expect(b.sp.t).toBe(5);
  });

  it('시간 정지 중에는 보스 페이즈 전환이 보류되고, 정지가 풀린 직후 전환된다', () => {
    const s = new Sim(4) as any;
    s.stagePhase = 'BOSS'; s.spawnBoss(1); const b = s.boss; b.y = b.targetY;
    s.ult.kind = 'timestop'; s.ult.phase = 'ACTIVE'; s.ult.t = 0; b.hp = b.maxHp * 0.4;
    s.step(idle); expect(b.phase2).toBe(false); expect(b.phase2Alert).toBe(0);
    s.ult.phase = 'IDLE'; s.step(idle);
    expect(b.phase2).toBe(true);
    expect(s.drainEvents().some((e: any) => e.t === 'slowmo')).toBe(true);
  });
});

describe('QA audit 2 (수정 확인)', () => {
  const noop = { targetX: 225, targetY: 660, fire: false, bomb: false, skill: null } as const;
  it('히트스톱 중 비상 폭탄도 통계(run.bombs)에 잡힌다', () => {
    const s = new Sim(1) as any; s.bombs = 2; s.frame = 100; s.fireBomb();
    expect(s.run.bombs).toBe(1); expect(s.bombs).toBe(1);
  });
  it('시간 정지가 끝나는 순간 짧은 무적이 생긴다', () => {
    const s = new Sim(2) as any; s.player.invincible = 0;
    s.ult.kind = 'timestop'; s.ult.phase = 'ACTIVE'; s.ult.t = 224;
    s.step(noop); expect(s.ult.phase).toBe('IDLE'); expect(s.player.invincible).toBeGreaterThanOrEqual(29);
  });
  it('미션 bosses 값은 무한 모드에서 과대 집계되지 않는다', () => {
    const m = (MISSIONS as any[]).find(x => x.id === 'bosses');
    const base = { score: 0, bossTier: 6, cleared: true, endless: true, hypers: 0, kills: 0, maxCombo: 0, graze: 0, hits: 0, bombs: 0, ults: 0, fusions: 0, mutator: null, daily: false };
    expect(m.value(base)).toBe(5); expect(m.value({ ...base, endless: false, bossTier: 5 })).toBe(5); expect(m.value({ ...base, endless: false, cleared: false, bossTier: 3 })).toBe(2);
  });
  it('일일 도전 업적은 2스테이지 이상 도달해야 얻는다', () => {
    const base = { score: 0, bossTier: 1, cleared: false, endless: false, hypers: 0, kills: 0, maxCombo: 0, graze: 0, hits: 0, bombs: 0, ults: 0, fusions: 0, mutator: null, daily: true };
    expect(newlyUnlocked(base, []).some(a => a.id === 'daily')).toBe(false);
    expect(newlyUnlocked({ ...base, bossTier: 2 }, []).some(a => a.id === 'daily')).toBe(true);
  });
});
