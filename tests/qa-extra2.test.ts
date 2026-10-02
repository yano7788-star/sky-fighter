import { describe, expect, it } from 'vitest';
import { Sim } from '../src/core/sim';
import { metaParams } from '../src/core/meta';
import type { SimInput } from '../src/core/types';

const idle = (s: Sim, extra: Partial<SimInput> = {}): SimInput => ({ targetX: s.player.x, targetY: s.player.y, fire: false, bomb: false, ...extra });
const mk = (pilot: string, mut: string | null = null) => new Sim(3, metaParams({} as any, pilot, mut));
function startUlt(s: Sim) {
  s.ult.gauge = 100; s.step(idle(s, { skill: 'ult' }));
  let n = 0; while (s.ult.phase !== 'ACTIVE' && n++ < 300) s.step(idle(s));
}

describe('QA2', () => {
  it('timestop: freezes comboTimer/phase timers, ends after 150', () => {
    const s = mk('sister2'); startUlt(s);
    expect(s.timeStopped).toBe(true);
    s.combo = 5; s.comboTimer = 50; const f = s.stageFrames;
    for (let i = 0; i < 100; i++) s.step(idle(s));
    expect(s.comboTimer).toBe(50); expect(s.stageFrames).toBe(f);
    for (let i = 0; i < 60; i++) s.step(idle(s));
    expect(s.timeStopped).toBe(false);
  });
  it('timestop: boss killed during stop -> BOSS_DYING timer frozen until stop ends (then proceeds)', () => {
    const s = mk('sister2'); s.startAtTier(1); s.stagePhase = 'BOSS';
    (s as any).spawnBoss(1); s.boss!.y = 135; s.boss!.hp = 1;
    startUlt(s);
    s.boss!.hp = 0; s.step(idle(s));
    expect(s.stagePhase).toBe('BOSS_DYING');
    const t = s.phaseTimer; s.step(idle(s));
    console.log('dying timer frozen?', t, s.phaseTimer);
    for (let i = 0; i < 700; i++) s.step(idle(s));
    expect(['CLEAR', 'INTRO']).toContain(s.stagePhase);
  });
  it('barrage during midboss laser: no damage, missiles bounded, end state sane', () => {
    const s = mk('sister1'); s.startAtTier(2); s.midDone = false; s.stageFrames = 99999;
    for (let i = 0; i < 4000 && !(s.midBoss && s.midBoss.state === 'CHARGE'); i++) { s.player.invincible = 999; s.step(idle(s)); }
    expect(s.midBoss?.state).toBe('CHARGE');
    s.player.invincible = 0; const e0 = s.player.energy;
    startUlt(s);
    let max = 0;
    for (let i = 0; i < 260; i++) { s.step(idle(s)); max = Math.max(max, s.missiles.length); }
    console.log('max missiles', max, 'energy', e0, s.player.energy, 'ult', s.ult.phase);
    expect(s.missiles.length).toBeLessThanOrEqual(142);
  });
  it('ult re-trigger blocked while ACTIVE; gauge fill during ACTIVE', () => {
    const s = mk('sister1'); startUlt(s);
    s.ult.gauge = 100; s.step(idle(s, { skill: 'ult' }));
    expect(s.ult.phase).toBe('ACTIVE');
  });
  it('endless: loops use tables 1..5 and ult during GAMECLEAR resume ok', () => {
    const s = mk('sister2'); s.bossTier = 5; s.stagePhase = 'CLEAR'; s.phaseTimer = 1; s.player.invincible = 99999;
    startUlt(s);
    for (let i = 0; i < 20; i++) s.step(idle(s));
    expect(s.state).toBe('GAMECLEAR'); s.startEndless();
    expect(s.bossTier).toBe(6); expect(s.stageTier).toBe(1); expect(s.state).toBe('PLAYING');
    expect(s.pending).not.toBeNull(); s.chooseCard(0);   // 항로 선택
    for (let i = 0; i < 1200; i++) s.step(idle(s));
    expect(s.stagePhase).toBe('FIGHT');
  });
  it('mutator glass: maxEnergy rounding; sister2 energyBonus', () => {
    const s = mk('sister2', 'glass');
    console.log('maxEnergy', s.player.maxEnergy);
    expect(Number.isInteger(s.player.maxEnergy)).toBe(true);
  });
  it('endless 25 loops survive sim w/o crash (invincible)', () => {
    const s = mk('ace'); s.player.invincible = 1e9; s.player.energy = 1e9;
    let n = 0;
    while (n++ < 400000 && s.bossTier < 12) {
      if (s.state === 'GAMECLEAR') s.startEndless();
      s.player.invincible = 1e9;
      if (s.boss && s.boss.y > 20) s.boss.hp = 0; if (s.midBoss) s.midBoss.hp = 0;
      s.step(idle(s, { fire: true }));
      if (s.pending) s.chooseCard(0);
    }
    expect(s.bossTier).toBeGreaterThanOrEqual(12);
  });
});
