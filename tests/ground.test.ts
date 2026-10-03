import { describe, expect, it } from 'vitest';
import { GROUND, GroundSim, NO_INPUT, SECTION_COUNT, WEAPONS, type GBullet } from '../src/core/ground';
import { groundBot } from '../src/core/groundbot';
import { COLS, T, TILE, WORLD_H, tileAt } from '../src/core/groundmap';
import { Sim } from '../src/core/sim';
import { metaParams } from '../src/core/meta';
import type { SimInput } from '../src/core/types';

const idle = (s: Sim): SimInput => ({ targetX: s.player.x, targetY: s.player.y, fire: false, bomb: false });
/** 시험용: 구역의 적·엄폐물을 비워 단순한 방을 만든다 */
const clean = (g: GroundSim) => { g.enemies.length = 0; g.cover.length = 0; g.pickups.length = 0; };
const bullet = (g: GroundSim, o: Partial<GBullet>) => g.bullets.push({ x: g.p.x, y: g.p.y, vx: 0, vy: 0, r: 4, dmg: 1, friendly: false, pierce: 0, hit: [], life: 60, ...o });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const add = (g: GroundSim, kind: string, x: number, y: number, ang = 0) => (g as any).addEnemy(kind, x, y, ang);

describe('지상전 코어', () => {
  it('시작: 옥상, 권총, 체력 가득, 구역 4개', () => {
    const g = new GroundSim({ seed: 1 });
    expect(g.section).toBe(0); expect(g.p.weapon).toBe('pistol'); expect(g.p.hp).toBe(GROUND.hp); expect(SECTION_COUNT).toBe(4);
    expect(g.enemies.length).toBeGreaterThan(20); expect(g.p.y).toBeLessThan(WORLD_H);
  });
  it('같은 시드·같은 입력이면 결과가 같다', () => {
    const run = () => { const g = new GroundSim({ seed: 9 }); for (let i = 0; i < 2500; i++) { g.step(groundBot(g, 0.7)); g.drain(); } return [g.score, g.kills, g.p.hp, g.p.x.toFixed(2), g.enemies.length].join('|'); };
    expect(run()).toBe(run());
  });
  it('구르기: 무적 프레임 동안 탄에 맞지 않고, 쿨다운이 있다', () => {
    const g = new GroundSim({ seed: 2 }); clean(g);
    g.step({ ...NO_INPUT, mx: 1, roll: true });
    expect(g.p.rollT).toBeGreaterThan(0); expect(g.p.invuln).toBeGreaterThanOrEqual(GROUND.rollInvuln - 1);
    bullet(g, {}); const hp = g.p.hp; g.step(NO_INPUT); expect(g.p.hp).toBe(hp);
    const cd = g.p.rollCd; g.step({ ...NO_INPUT, roll: true }); expect(g.p.rollCd).toBeLessThanOrEqual(cd);
  });
  it('피격: 체력이 줄고 무적 시간이 생긴다', () => {
    const g = new GroundSim({ seed: 2 }); clean(g); g.p.invuln = 0;
    bullet(g, {}); g.step(NO_INPUT); expect(g.p.hp).toBe(GROUND.hp - 1); expect(g.p.invuln).toBeGreaterThan(30);
  });
  it('엄폐물과 벽은 탄을 막고, 유리는 탄이 통과한다', () => {
    const g = new GroundSim({ seed: 2 }); clean(g); g.p.invuln = 0;
    g.cover.push({ id: 99, kind: 'crate', x: g.p.x, y: g.p.y - 100, w: 42, h: 31, hp: 999, dead: false, section: 0 });
    bullet(g, { x: g.p.x, y: g.p.y - 160, vy: 3 });   // 위에서 아래로 → 상자에 막힘
    for (let i = 0; i < 80; i++) g.step(NO_INPUT);
    expect(g.p.hp).toBe(GROUND.hp);
    // 유리: 위쪽 타일을 유리로 바꾸면 탄이 지나간다 / 벽이면 막힌다
    const c = Math.floor(g.p.x / TILE), r = Math.floor(g.p.y / TILE) - 3; g.tiles[r * COLS + c] = T.GLASS; g.cover.length = 0;
    bullet(g, { x: g.p.x, y: g.p.y - 140, vy: 4 }); g.p.invuln = 0;
    for (let i = 0; i < 60; i++) g.step(NO_INPUT);
    expect(g.p.hp).toBe(GROUND.hp - 1);
    g.tiles[r * COLS + c] = T.WALL; g.p.invuln = 0; g.p.hp = GROUND.hp; bullet(g, { x: g.p.x, y: g.p.y - 140, vy: 4 });
    for (let i = 0; i < 60; i++) g.step(NO_INPUT);
    expect(g.p.hp).toBe(GROUND.hp);
  });
  it('벽/엄폐물에 끼어도 밖으로 밀려난다 (이동 버그 회귀)', () => {
    const g = new GroundSim({ seed: 2 }); clean(g);
    g.cover.push({ id: 99, kind: 'barrier', x: g.p.x, y: g.p.y - 60, w: 78, h: 26, hp: 999, dead: false, section: 0 });
    g.p.y -= 58; g.step(NO_INPUT); g.step({ ...NO_INPUT, mx: 1 });
    const c = g.cover[0]; expect(Math.abs(g.p.x - c.x) >= c.w / 2 || Math.abs(g.p.y - c.y) >= c.h / 2).toBe(true);
    for (let i = 0; i < 300; i++) g.step({ ...NO_INPUT, mx: -1 });
    expect(tileAt(g.tiles, g.p.x, g.p.y)).not.toBe(T.WALL);
  });
  it('폭발 드럼통: 맞으면 터져 주변 적에게 피해, 연쇄 폭발', () => {
    const g = new GroundSim({ seed: 4 }); clean(g);
    const y = g.p.y - 200;
    g.cover.push({ id: 90, kind: 'barrel', x: 200, y, w: 18, h: 28, hp: 1, dead: false, section: 0 }, { id: 91, kind: 'barrel', x: 240, y, w: 18, h: 28, hp: 1, dead: false, section: 0 });
    add(g, 'heavy', 220, y); const e = g.enemies[0]; const hp0 = e.hp;
    bullet(g, { x: 200, y, friendly: true, r: 3 }); g.step(NO_INPUT);
    expect(g.cover.every(c => c.dead)).toBe(true); expect(e.hp).toBeLessThan(hp0);
  });
  it('무기: 탄이 떨어지면 권총으로 돌아가고 던진 총이 날아간다', () => {
    const g = new GroundSim({ seed: 5 }); clean(g); g.p.weapon = 'shotgun'; g.p.ammo = 1; g.p.invuln = 99999;
    g.step({ ...NO_INPUT, fire: true, ax: 0, ay: -1 });
    expect(g.p.weapon).toBe('pistol'); expect(g.bullets.some(b => b.kind === 'throw')).toBe(true); expect(WEAPONS.shotgun.pellets).toBeGreaterThan(1);
  });
  it('소음: 총을 쏘면 근처 경계 전 적이 조사하러 오고, 샷건은 더 멀리 들린다', () => {
    const g = new GroundSim({ seed: 6 }); clean(g);
    add(g, 'rifle', g.p.x + 280, g.p.y); const e = g.enemies[0]; e.ang = 0;
    g.p.weapon = 'pistol'; g.step({ ...NO_INPUT, fire: true, ax: 0, ay: -1 });
    expect(e.aw).toBe(0);   // 권총 소음(230) 밖
    g.p.weapon = 'shotgun'; g.p.ammo = 5; g.p.fireCd = 0; g.step({ ...NO_INPUT, fire: true, ax: 0, ay: -1 });
    expect(e.aw).toBeGreaterThanOrEqual(1);
  });
  it('시야: 플레이어를 향한 적은 보고 교전하고, 등을 돌린 적은 보지 못한다', () => {
    const g = new GroundSim({ seed: 6 }); clean(g);
    add(g, 'rifle', g.p.x - 150, g.p.y); add(g, 'rifle', g.p.x + 150, g.p.y);   // 첫째는 플레이어 왼쪽, 둘째는 오른쪽
    const [left, right] = g.enemies;
    for (let i = 0; i < 30; i++) { left.ang = 0; left.home.ang = 0; right.ang = 0; right.home.ang = 0; g.step(NO_INPUT); }   // 둘 다 오른쪽(0)을 본다 → 왼쪽 적은 플레이어를 보고, 오른쪽 적은 플레이어가 등 뒤
    expect(left.aw).toBe(2); expect(right.aw).toBe(0);
  });
  it('스윙 도어: 박차고 지나가면 문 근처 적이 기절한다', () => {
    const g = new GroundSim({ seed: 7 }); clean(g);
    const c = 6, r = 68 + 6;   // 1층 왼쪽 문
    expect(g.tiles[r * COLS + c]).toBe(T.DOOR);
    g.p.x = (c + 1.5) * TILE; g.p.y = (r + 0.5) * TILE;
    add(g, 'rifle', (c - 0.4) * TILE, (r + 0.5) * TILE); const e = g.enemies[0];
    for (let i = 0; i < 20; i++) g.step({ ...NO_INPUT, mx: -1 });
    expect(e.state === 'STUN' || e.aw >= 1).toBe(true); expect(g.score).toBeGreaterThanOrEqual(100);
  });
  it('구역을 모두 정리하면 위층 문이 열리고 체력 아이템이 나온다', () => {
    const g = new GroundSim({ seed: 8 });
    g.enemies = g.enemies.filter(e => e.section !== 0); g.step(NO_INPUT);
    expect(g.cleared[0]).toBe(true); expect(g.tiles[102 * COLS + 8]).toBe(T.FLOOR); expect(g.pickups.some(k => k.kind === 'heart' && k.section === 0)).toBe(true);
    expect(g.cleared[1]).toBe(false); expect(g.tiles[68 * COLS + 8]).toBe(T.GATE);
  });
  it('적이 무기를 떨구고 시체가 남는다. 권총일 때는 닿으면 줍고, 다른 총을 들었으면 줍기 입력이 필요하다', () => {
    const g = new GroundSim({ seed: 10 }); clean(g);
    for (let i = 0; i < 40; i++) { add(g, 'heavy', g.p.x, g.p.y - 120 - i); const e = g.enemies[g.enemies.length - 1]; (g as unknown as { damage: (e: unknown, d: number, x: number, y: number, a: number) => void }).damage(e, 99, e.x, e.y, 0); }
    expect(g.corpses.length).toBe(40); expect(g.pickups.filter(k => k.dropped).length).toBeGreaterThan(10);
    g.pickups = [{ id: 7, kind: 'weapon', weapon: 'shotgun', ammo: 7, x: g.p.x, y: g.p.y, t: 0, section: 0 }];
    g.step(NO_INPUT); expect(g.p.weapon).toBe('shotgun'); expect(g.p.ammo).toBe(7);
    g.pickups = [{ id: 8, kind: 'weapon', weapon: 'smg', ammo: 50, x: g.p.x, y: g.p.y, t: 0, section: 0 }]; g.p.pickCd = 0;
    g.step(NO_INPUT); expect(g.p.weapon).toBe('shotgun');   // 입력 없으면 안 줍는다
    g.step({ ...NO_INPUT, pickup: true }); expect(g.p.weapon).toBe('smg');
    expect(g.pickups.some(k => k.weapon === 'shotgun' && k.dropped)).toBe(true);   // 들고 있던 총은 바닥에 떨어진다
  });
  it('봇이 맵을 끝까지 돌파한다 (여러 시드 중 일부는 클리어)', () => {
    let wins = 0, maxSec = 0;
    for (let s = 1; s <= 8; s++) {
      const g = new GroundSim({ seed: s }); let rv = 0;
      for (let i = 0; i < 60 * 300; i++) { g.step(groundBot(g, 0.85)); g.drain(); if ((g.state as string) === 'DEAD') { if (rv++ >= 2) break; g.revive(); } if ((g.state as string) === 'WIN') break; }
      maxSec = Math.max(maxSec, g.reached); if ((g.state as string) === 'WIN') wins++;
    }
    expect(maxSec).toBe(3); expect(wins).toBeGreaterThan(0);
  });
  it('사망 후 revive: 같은 구역을 처음부터, 체력 일부 회복, 정리한 구역은 유지', () => {
    const g = new GroundSim({ seed: 6 }); g.enemies = g.enemies.filter(e => e.section !== 0); g.step(NO_INPUT);
    g.p.hp = 0; g.step(NO_INPUT); expect(g.state).toBe('DEAD'); g.revive();
    expect(g.state).toBe('PLAY'); expect(g.p.hp).toBeGreaterThan(0); expect(g.cleared[0]).toBe(true); expect(g.enemies.some(e => e.section === 0)).toBe(false);
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
