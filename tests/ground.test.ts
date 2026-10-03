import { describe, expect, it } from 'vitest';
import { ARENA, GROUND, GroundSim, NO_INPUT, ROOM_COUNT, WEAPONS } from '../src/core/ground';
import { groundBot } from '../src/core/groundbot';
import { Sim } from '../src/core/sim';
import { metaParams } from '../src/core/meta';
import type { SimInput } from '../src/core/types';

const idle = (s: Sim): SimInput => ({ targetX: s.player.x, targetY: s.player.y, fire: false, bomb: false });
const spawnDone = (g: GroundSim) => { for (let i = 0; i < 200; i++) { g.step(NO_INPUT); if (g.enemies.length && g.enemies.every(e => e.state !== 'SPAWN')) return; } };

describe('지상전 코어', () => {
  it('시작 상태: 룸 1, 권총, 체력 가득', () => {
    const g = new GroundSim({ seed: 1 });
    expect(g.room).toBe(0); expect(g.p.weapon).toBe('pistol'); expect(g.p.hp).toBe(GROUND.hp);
    expect(ROOM_COUNT).toBe(4);
  });
  it('같은 시드·같은 입력이면 결과가 같다', () => {
    const run = () => { const g = new GroundSim({ seed: 9 }); for (let i = 0; i < 1500; i++) { g.step(groundBot(g, 0.7)); g.drain(); } return [g.score, g.kills, g.p.hp, g.p.x.toFixed(2), g.enemies.length].join('|'); };
    expect(run()).toBe(run());
  });
  it('구르기: 무적 프레임 동안 탄에 맞지 않고, 쿨다운이 있다', () => {
    const g = new GroundSim({ seed: 2 }); spawnDone(g);
    g.step({ ...NO_INPUT, mx: 1, roll: true });
    expect(g.p.rollT).toBeGreaterThan(0); expect(g.p.invuln).toBeGreaterThanOrEqual(GROUND.rollInvuln - 1);
    g.bullets.push({ x: g.p.x, y: g.p.y, vx: 0, vy: 0, r: 4, dmg: 1, friendly: false, pierce: 0, hit: [], life: 50 });
    const hp = g.p.hp; g.step(NO_INPUT); expect(g.p.hp).toBe(hp);
    const cd = g.p.rollCd; g.step({ ...NO_INPUT, roll: true }); expect(g.p.rollCd).toBeLessThanOrEqual(cd);   // 쿨다운 중 재구르기 불가
  });
  it('피격: 체력이 줄고 무적 시간이 생긴다', () => {
    const g = new GroundSim({ seed: 2 }); g.p.invuln = 0;
    g.bullets.push({ x: g.p.x, y: g.p.y, vx: 0, vy: 0, r: 4, dmg: 1, friendly: false, pierce: 0, hit: [], life: 50 });
    g.step(NO_INPUT); expect(g.p.hp).toBe(GROUND.hp - 1); expect(g.p.invuln).toBeGreaterThan(30);
  });
  it('엄폐물은 탄을 막는다 (적 탄도, 플레이어 탄도)', () => {
    const g = new GroundSim({ seed: 2 }); g.p.invuln = 0; g.cover.length = 0;
    g.cover.push({ id: 99, kind: 'crate', x: 225, y: 600, w: 42, h: 31, hp: 999, dead: false });
    g.p.x = 225; g.p.y = 700;
    g.bullets.push({ x: 225, y: 560, vx: 0, vy: 3, r: 3, dmg: 1, friendly: false, pierce: 0, hit: [], life: 200 });   // 위에서 아래로 → 상자에 막힘
    for (let i = 0; i < 80; i++) g.step(NO_INPUT);
    expect(g.p.hp).toBe(GROUND.hp);
  });
  it('엄폐물 안에 끼어도 밖으로 밀려난다 (이동 버그 회귀)', () => {
    const g = new GroundSim({ seed: 2 }); g.cover.length = 0;
    g.cover.push({ id: 99, kind: 'barrier', x: 225, y: 400, w: 78, h: 26, hp: 999, dead: false });
    g.p.x = 225; g.p.y = 402;
    g.step(NO_INPUT); g.step({ ...NO_INPUT, mx: 1 });
    const c = g.cover[0]; expect(Math.abs(g.p.x - c.x) >= c.w / 2 || Math.abs(g.p.y - c.y) >= c.h / 2).toBe(true);
  });
  it('이동 영역을 벗어나지 않는다', () => {
    const g = new GroundSim({ seed: 3 }); g.cover.length = 0;
    for (let i = 0; i < 400; i++) g.step({ ...NO_INPUT, mx: -1, my: -1 });
    expect(g.p.x).toBeGreaterThanOrEqual(ARENA.x0); expect(g.p.y).toBeGreaterThanOrEqual(ARENA.y0);
  });
  it('폭발 드럼통: 맞으면 터져 주변 적에게 피해, 연쇄 폭발', () => {
    const g = new GroundSim({ seed: 4 }); spawnDone(g); g.cover.length = 0;
    g.cover.push({ id: 90, kind: 'barrel', x: 300, y: 400, w: 18, h: 28, hp: 1, dead: false }, { id: 91, kind: 'barrel', x: 340, y: 400, w: 18, h: 28, hp: 1, dead: false });
    const e = g.enemies[0]; e.x = 320; e.y = 400; const hp0 = e.hp;
    g.bullets.push({ x: 300, y: 400, vx: 0, vy: 0, r: 3, dmg: 1, friendly: true, pierce: 0, hit: [], life: 5 });
    g.step(NO_INPUT);
    expect(g.cover.every(c => c.dead)).toBe(true);
    expect(g.enemies.includes(e) ? e.hp < hp0 : true).toBe(true);
  });
  it('무기 종류와 탄약: 탄이 떨어지면 권총으로 돌아가고 던진 총이 날아간다', () => {
    const g = new GroundSim({ seed: 5 }); g.p.weapon = 'shotgun'; g.p.ammo = 1; g.p.invuln = 99999;
    g.step({ ...NO_INPUT, fire: true, ax: 0, ay: -1 });
    expect(g.p.weapon).toBe('pistol'); expect(g.bullets.some(b => b.kind === 'throw')).toBe(true);
    expect(WEAPONS.shotgun.pellets).toBeGreaterThan(1);
  });
  it('봇이 룸을 순서대로 돌파한다 (여러 시드 중 일부는 클리어)', () => {
    let wins = 0, maxRoom = 0;
    for (let s = 1; s <= 12; s++) {
      const g = new GroundSim({ seed: s }); let rv = 0;
      for (let i = 0; i < 60 * 300; i++) { g.step(groundBot(g, 0.8)); g.drain(); if ((g.state as string) === 'DEAD') { if (rv++ >= 1) break; g.revive(); } if ((g.state as string) === 'WIN') break; }
      maxRoom = Math.max(maxRoom, g.room); if ((g.state as string) === 'WIN') wins++;
    }
    expect(maxRoom).toBe(ROOM_COUNT - 1); expect(wins).toBeGreaterThan(0);
  });
  it('사망 후 revive: 같은 룸을 처음부터, 체력 일부 회복', () => {
    const g = new GroundSim({ seed: 6 }); g.p.hp = 0; g.step(NO_INPUT);
    expect(g.state).toBe('DEAD'); const room = g.room; g.revive();
    expect(g.state).toBe('ROOM'); expect(g.room).toBe(room); expect(g.p.hp).toBeGreaterThan(0);
  });
});

describe('지상전 ↔ 본편 연동', () => {
  const mk = () => new Sim(3, metaParams({} as any, 'ace', null));
  it('기본(헤드리스)에서는 지상전을 건너뛴다', () => {
    const s = mk(); s.startAtTier(3); s.bossTier = 3; s.stagePhase = 'CLEAR'; s.phaseTimer = 1; s.player.invincible = 99999;
    s.step(idle(s)); s.step(idle(s));
    expect(s.groundRequest).toBe(false); expect(s.bossTier).toBe(4);
  });
  it('활성화하면 3스테이지 보스 직후 요청이 나가고, 본편이 정지한다', () => {
    const s = mk(); s.groundEnabled = true; s.startAtTier(3); s.bossTier = 3; s.stagePhase = 'CLEAR'; s.phaseTimer = 1; s.player.invincible = 99999;
    s.step(idle(s));
    expect(s.groundRequest).toBe(true);
    const f = s.frame; s.step(idle(s)); expect(s.frame).toBe(f);   // 정지
    s.startGround(); expect(s.groundActive).toBe(true); s.step(idle(s)); expect(s.frame).toBe(f);
  });
  it('2스테이지 보스 후에는 요청이 없다', () => {
    const s = mk(); s.groundEnabled = true; s.startAtTier(2); s.bossTier = 2; s.stagePhase = 'CLEAR'; s.phaseTimer = 1; s.player.invincible = 99999;
    s.step(idle(s)); expect(s.groundRequest).toBe(false); expect(s.bossTier).toBe(3);
  });
  it('클리어: 점수 반영 + 유물 선택 → 다음 스테이지(항로 선택)로', () => {
    const s = mk(); s.groundEnabled = true; s.startAtTier(3); s.bossTier = 3; s.stagePhase = 'CLEAR'; s.phaseTimer = 1; s.player.invincible = 99999;
    s.step(idle(s)); s.startGround(); const sc = s.score; s.player.energy = 10;
    s.finishGround({ score: 1234, rooms: 4 });
    expect(s.score).toBe(sc + 1234); expect(s.player.energy).toBeGreaterThan(10); expect(s.groundActive).toBe(false);
    expect(s.pending?.length).toBeGreaterThan(0); expect(s.bossTier).toBe(3);   // 유물 선택 중
    s.chooseCard(0);
    expect(s.bossTier).toBe(4); expect(s.pending?.length).toBeGreaterThan(0);   // 다음 스테이지 항로 선택
  });
  it('실패: 목숨이 있으면 이어하고, 없으면 게임오버', () => {
    const s = mk(); const l = s.lives;
    expect(s.useGroundLife()).toBe(true); expect(s.lives).toBe(l - 1);
    s.lives = 0; expect(s.useGroundLife()).toBe(false);
    s.groundFail(); expect(s.state).toBe('GAMEOVER');
  });
  it('지상전 옵션이 빌드를 반영한다', () => {
    const s = mk(); s.build.levels['power'] = 3; (s as any).refreshStats();
    const o = s.groundOpts(1); expect(o.dmgMult).toBeGreaterThan(1.2);
  });
});
