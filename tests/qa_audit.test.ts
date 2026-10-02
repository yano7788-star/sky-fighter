import { describe, expect, it } from 'vitest';
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

  it('시간 정지 중에도 보스 2페이즈 연출(phase2Alert/slowmo)이 시작된다', () => {
    const s = new Sim(4) as any;
    s.stagePhase = 'BOSS'; s.spawnBoss(1); const b = s.boss; b.y = b.targetY;
    s.ult.kind = 'timestop'; s.ult.phase = 'ACTIVE'; s.ult.t = 0; b.hp = b.maxHp * 0.4;
    s.step(idle);
    expect(b.phase2).toBe(true);
    expect(s.drainEvents().some((e: any) => e.t === 'slowmo')).toBe(true);
  });
});
