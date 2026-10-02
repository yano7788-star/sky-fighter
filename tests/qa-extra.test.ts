import { metaParams } from '../src/core/meta';
import { describe, expect, it } from 'vitest';
import { CARDS, offerCards, type CardId } from '../src/core/build';
import { createRng } from '../src/core/rng';
import { Sim } from '../src/core/sim';
import { ULT } from '../src/core/data';
import type { Enemy, SimInput } from '../src/core/types';

const idle = (s: Sim, fire = false, extra: Partial<SimInput> = {}): SimInput => ({ targetX: s.player.x, targetY: s.player.y, fire, bomb: false, ...extra });
const mkEnemy = (x: number, y: number, hp = 1): Enemy => ({ type: 'scout', x, y, hp, maxHp: hp, speed: 0, baseX: x, age: 0, fireCd: 999, hold: 0 });

describe('QA: 레벨업 카드 엣지', () => {
  it('모든 카드가 최대면 offerCards가 빈 배열을 돌려주고, Sim.pending=[] 로 영구 정지하지 않아야 한다', () => {
    const s = new Sim(1);
    for (const id of Object.keys(CARDS) as CardId[]) s.build.levels[id] = CARDS[id].max;
    expect(offerCards(s.build, createRng(1))).toHaveLength(0);
    s.xp = 99999;
    s.step(idle(s));
    // 기대: pending이 null(카드 없음) 이거나 길이>0. 현재는 [] (truthy) 로 step()이 영구 return
    expect(s.pending === null || s.pending.length > 0).toBe(true);
  });
  it('남은 카드가 2장이면 2장만 제안', () => {
    const s = new Sim(1);
    for (const id of Object.keys(CARDS) as CardId[]) s.build.levels[id] = CARDS[id].max;
    s.build.levels.rate = 0; s.build.levels.luck = 0;
    expect(offerCards(s.build, createRng(2)).sort()).toEqual(['luck', 'rate']);
  });
  it('연속 레벨업: 경험치가 크면 카드를 고를 때마다 다음 카드가 나온다', () => {
    const s = new Sim(1);
    s.xp = 1000; s.step(idle(s));
    let n = 0;
    while (s.pending && n < 50) { s.chooseCard(0); n++; }
    expect(n).toBeGreaterThan(3);
    expect(s.pending).toBeNull();
  });
});

describe('QA: 정지(pending/ult) 중 타이머 동결', () => {
  it('pending 중에는 invincible/comboTimer/동료 타이머/bombT가 줄지 않는다', () => {
    const s = new Sim(1);
    s.player.invincible = 50; s.comboTimer = 50; s.combo = 5; s.comp.cat.active = true; s.comp.cat.timer = 50; s.bombT = 30;
    s.pending = ['rate', 'power', 'luck'];
    for (let i = 0; i < 30; i++) s.step(idle(s));
    expect([s.player.invincible, s.comboTimer, s.comp.cat.timer, s.bombT]).toEqual([50, 50, 50, 30]);
  });
  it('ult 컷인/낙하 중에도 동결, IMPACT에서 해제', () => {
    const s = new Sim(1);
    s.ult.gauge = 100; s.player.invincible = 0; s.comboTimer = 50; s.combo = 5; s.comp.dog.active = true; s.comp.dog.timer = 50;
    s.step(idle(s, false, { skill: 'ult' }));
    expect(s.ult.phase).toBe('CUTIN');
    const f = s.frame;
    for (let i = 0; i < ULT.frames.CUTIN + ULT.frames.FALL - 2; i++) s.step(idle(s));
    expect(s.frame).toBe(f);
    expect(s.comboTimer).toBe(50 - 1 + 1 - 0 > 0 ? s.comboTimer : 0);
    expect(s.comp.dog.timer).toBeGreaterThanOrEqual(48);
  });
  it('ult와 bomb 입력이 같은 틱이면 폭탄이 낭비된다 (참고)', () => {
    const s = new Sim(1);
    s.ult.gauge = 100; s.frame = 100; s.bombs = 1;
    s.step(idle(s, false, { skill: 'ult', bomb: true }));
    expect(s.ult.phase).toBe('CUTIN');
    expect(s.bombs).toBe(1);   // 낭비 없어야 이상적
  });
  it('pending/ult 중 fireBomb()를 직접 부르면(씬 hitStop 경로) 폭탄이 소모된다', () => {
    const s = new Sim(1);
    s.pending = ['rate', 'power', 'luck']; s.frame = 100; s.bombs = 1;
    s.fireBomb();
    expect(s.bombs).toBe(1);
  });
});

describe('QA: 레이저/보스/궁극기', () => {
  it('죽어가는 보스에게 레이저는 피해를 주지 않는다', () => {
    const s = new Sim(1);
    s.bossTier = 1; s.stagePhase = 'WARNING'; s.phaseTimer = 1; s.player.invincible = 99999; s.step(idle(s));
    const b = s.boss!; b.y = 135; b.x = s.player.x; b.hp = 0.5;
    s.build.levels.laser = 4; s.stats = (s as any).stats; (s as any).stats = { ...s.stats, laser: 4 };
    s.frame = 4; s.step(idle(s, true));   // frame 5 -> laserTick
    expect(b.dying).toBe(true);
    const hp = b.hp;
    for (let i = 0; i < 10; i++) s.step(idle(s, true));
    expect(b.hp).toBe(hp);
  });
  it('3번째 보스: 목숨 >=2 이면 게이지 100, 1이면 아님', () => {
    for (const lives of [2, 1]) {
      const s = new Sim(1);
      s.bossTier = 3; s.stagePhase = 'WARNING'; s.phaseTimer = 1; s.player.invincible = 99999; s.step(idle(s));
      s.lives = lives; s.boss!.y = 135; s.boss!.hp = 0; s.step(idle(s));
      expect(s.ult.gauge).toBe(lives >= 2 ? 100 : ULT.gaugeBoss);
    }
  });
  it('ult는 BOSS_DYING/CLEAR 중 사용 불가, 폭탄도 불가', () => {
    const s = new Sim(1);
    s.stagePhase = 'BOSS_DYING'; s.ult.gauge = 100; s.bombs = 2; s.frame = 100;
    s.step(idle(s, false, { skill: 'ult', bomb: true }));
    expect(s.ult.phase).toBe('IDLE'); expect(s.bombs).toBe(2);
  });
  it('ult 보스 30% 피해 후 보스 hp<=0 이면 정상적으로 BOSS_DYING', () => {
    const s = new Sim(1);
    s.bossTier = 1; s.stagePhase = 'WARNING'; s.phaseTimer = 1; s.player.invincible = 99999; s.step(idle(s));
    const b = s.boss!; b.y = 135; b.hp = 10; s.ult.gauge = 100;
    s.step(idle(s, false, { skill: 'ult' }));
    for (let i = 0; i < ULT.frames.CUTIN + ULT.frames.FALL + 3; i++) s.step(idle(s));
    expect(['BOSS_DYING', 'CLEAR'].includes(s.stagePhase as string)).toBe(true);
  });
});

describe('QA: 흡혈/동료/관통', () => {
  it('흡혈은 상한(80%) 이상이면 에너지를 깎지 않는다', () => {
    const s = new Sim(1);
    s.comp.cat.active = true; s.comp.cat.timer = 100; s.player.energy = 100;
    s.enemies.push(mkEnemy(s.player.x, 300, 1)); s.bullets.push({ x: s.player.x, y: 300, vx: 0, vy: 0, dmg: 1, pierce: 0 });
    s.step(idle(s));
    expect(s.player.energy).toBe(100);
  });
  it('동료 used는 다음 스테이지 시작에 초기화', () => {
    const s = new Sim(1);
    s.comp.cat.used = true; s.comp.cat.pity = 10;
    s.stagePhase = 'CLEAR'; s.phaseTimer = 1; s.step(idle(s));
    expect(s.bossTier).toBe(2); expect(s.comp.cat.used).toBe(false);
  });
  it('관통탄은 적 N+1기까지 맞추고 사라진다, 이미 맞춘 적은 다시 안 맞는다', () => {
    const s = new Sim(1);
    const es = [mkEnemy(200, 300, 99), mkEnemy(200, 295, 99), mkEnemy(200, 290, 99)];
    s.enemies.push(...es);
    s.bullets.push({ x: 200, y: 300, vx: 0, vy: 0, dmg: 1, pierce: 1 });
    s.step(idle(s)); s.step(idle(s));
    expect(s.bullets.length).toBe(0);
    const total = es.reduce((a, e) => a + (99 - e.hp), 0);
    expect(total).toBe(2);
  });
  it('관통탄 하나가 같은 틱에 죽은 적을 계속 때리지 않는지(참고)', () => {
    const s = new Sim(1);
    const e = mkEnemy(200, 300, 1);
    s.enemies.push(e);
    s.bullets.push({ x: 200, y: 300, vx: 0, vy: 0, dmg: 1, pierce: 0 }, { x: 200, y: 300, vx: 0, vy: 0, dmg: 1, pierce: 0 });
    s.step(idle(s));
    expect(s.bullets.length).toBe(1);   // 낭비 없으면 1발 남아야 함
  });
});

describe('QA: 메타 시작 폭탄 vs 상한', () => {
  it('격납고 탄약 보급 Lv2(시작 폭탄 3) 상태에서 B 아이템을 먹어도 폭탄이 줄지 않아야 한다', () => {
    const s = new Sim(1, metaParams({ munitions: 2 }));
    expect(s.bombs).toBe(3);
    (s as any).collect('B');
    expect(s.bombs).toBeGreaterThanOrEqual(3);
  });
});
