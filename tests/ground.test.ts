import { describe, expect, it } from 'vitest';
import { FEEL, GROUND, GroundSim, NO_INPUT, SECTION_COUNT, WEAPONS, type GBullet, type GEnemy } from '../src/core/ground';
import { groundBot } from '../src/core/groundbot';
import { COLS, TILE, WORLD_H } from '../src/core/groundmap';
import { Sim } from '../src/core/sim';
import { metaParams } from '../src/core/meta';
import type { SimInput } from '../src/core/types';

const idle = (s: Sim): SimInput => ({ targetX: s.player.x, targetY: s.player.y, fire: false, bomb: false });
type Priv = { addEnemy: (k: string, x: number, y: number, a?: number) => GEnemy };
/** 시험용: 구역을 비운 빈 공간을 만든다 (적·아이템·상자 제거) */
const clean = (g: GroundSim) => { g.enemies.length = 0; g.pickups.length = 0; for (const c of g.crates) c.broken = true; for (const w of g.windows) w.broken = true; };
const add = (g: GroundSim, kind: string, x: number, y: number, ang = 0) => (g as unknown as Priv).addEnemy(kind, x, y, ang);
const bullet = (g: GroundSim, o: Partial<GBullet>) => g.bullets.push({ x: g.p.x, y: g.p.y, vx: 0, vy: 0, dmg: 1, friendly: false, w: 'rifle', life: 200, dist: 0, pellet: false, first: true, pierce: 0, hit: [], dodged: false, ...o });
const run = (g: GroundSim, n: number, inp = NO_INPUT) => { for (let i = 0; i < n; i++) g.step(inp); };
const doorAt = (g: GroundSim, c: number, r: number) => g.doors.find(d => d.c === c && d.r === r)!;

describe('지상전 코어 (MVP 이식)', () => {
  it('시작: 옥상, 권총, 체력 가득, 구역 4개, 월드 타일 64', () => {
    const g = new GroundSim({ seed: 1 });
    expect(g.section).toBe(0); expect(g.p.weapon).toBe('pistol'); expect(g.p.hp).toBe(GROUND.hp); expect(SECTION_COUNT).toBe(4); expect(TILE).toBe(64);
    expect(g.enemies.length).toBeGreaterThan(20); expect(g.p.y).toBeLessThan(WORLD_H);
  });
  it('같은 시드·같은 입력이면 결과가 같다', () => {
    const go = () => { const g = new GroundSim({ seed: 9 }); for (let i = 0; i < 2500; i++) { g.step(groundBot(g, 0.7)); g.drain(); } return [g.score, g.kills, g.p.hp, g.p.x.toFixed(2), g.enemies.length].join('|'); };
    expect(go()).toBe(go());
  });
  it('맵 검증: 스폰·무기가 벽/상자 칸 안에 있지 않다', () => {
    const g = new GroundSim({ seed: 1 }), crate = new Set(g.crates.map(c => Math.floor(c.x / TILE) + ',' + Math.floor(c.y / TILE)));
    for (const e of g.enemies) { const c = Math.floor(e.x / TILE), r = Math.floor(e.y / TILE); expect(g.tiles[r * COLS + c]).toBe(0); expect(crate.has(c + ',' + r)).toBe(false); }
    for (const k of g.pickups) { const c = Math.floor(k.x / TILE), r = Math.floor(k.y / TILE); expect(g.tiles[r * COLS + c]).toBe(0); expect(crate.has(c + ',' + r)).toBe(false); }
  });
  it('구르기: 앞 구간 무적(탄이 통과·회피 표시), 쿨다운 동안 재입력 무시, 끝나면 정상 피격', () => {
    const g = new GroundSim({ seed: 2 }); clean(g); g.p.invuln = 0;
    g.step({ ...NO_INPUT, mx: 1, roll: true });
    expect(g.p.seq?.kind).toBe('roll'); expect(g.p.rollI).toBeGreaterThan(15);
    bullet(g, { x: g.p.x, y: g.p.y }); const hp = g.p.hp; g.step(NO_INPUT);
    expect(g.p.hp).toBe(hp); expect(g.drain().some(e => e.t === 'dodge')).toBe(true);
    const cd = g.p.rollCd; g.step({ ...NO_INPUT, roll: true }); expect(g.p.rollCd).toBeLessThanOrEqual(cd);
    run(g, 40); expect(g.p.seq).toBeNull(); bullet(g, { x: g.p.x, y: g.p.y }); g.step(NO_INPUT); expect(g.p.hp).toBe(hp - 1);
  });
  it('구르기는 발사를 끊고, 근접 중에는 못 끊는다', () => {
    const g = new GroundSim({ seed: 2 }); clean(g); g.p.weapon = 'shotgun'; g.p.ammo = 5;
    g.step({ ...NO_INPUT, fire: true, ax: 0, ay: -1 }); expect(g.p.seq?.kind).toBe('fire');
    g.step({ ...NO_INPUT, roll: true }); expect(g.p.seq?.kind).toBe('roll');
    const h = new GroundSim({ seed: 2 }); clean(h); h.step({ ...NO_INPUT, melee: true, ax: 0, ay: -1 }); expect(h.p.seq?.kind).toBe('melee');
    h.step({ ...NO_INPUT, roll: true }); expect(h.p.seq?.kind).toBe('melee');
  });
  it('피격: 체력이 줄고 무적 시간이 생긴다', () => {
    const g = new GroundSim({ seed: 2 }); clean(g); g.p.invuln = 0;
    bullet(g, {}); g.step(NO_INPUT); expect(g.p.hp).toBe(GROUND.hp - 1); expect(g.p.invuln).toBeGreaterThan(30);
  });
  it('벽은 파괴되지 않고 총알을 막는다', () => {
    const g = new GroundSim({ seed: 2 }); clean(g); g.p.invuln = 0;
    const wall = { x: 3 * TILE + 10, y: 102.5 * TILE };   // 옥상 계단실 벽
    expect(g.obstacleAt(wall.x, wall.y)?.type).toBe('wall');
    bullet(g, { x: wall.x, y: wall.y + 150, vy: -12, friendly: true, w: 'pistol', life: 60 }); run(g, 30); expect(g.bullets.length).toBe(0); expect(g.obstacleAt(wall.x, wall.y)?.type).toBe('wall');
  });
  it('상자: 총알 3발에 부서지고 막던 칸이 열린다 / 폭발 통은 연쇄 폭발', () => {
    const g = new GroundSim({ seed: 3 }); g.enemies.length = 0;
    const c = g.crates.find(x => x.kind === 'crate' && x.section === 0)!; expect(g.obstacleAt(c.x, c.y)?.type).toBe('crate');
    for (let i = 0; i < 3; i++) bullet(g, { x: c.x, y: c.y + 20, vy: -8, friendly: true, w: 'pistol' }), g.step(NO_INPUT);
    expect(c.broken).toBe(true); expect(g.obstacleAt(c.x, c.y)).toBeNull();
    const b1 = g.crates.find(x => x.kind === 'barrel' && x.section === 0)!;
    bullet(g, { x: b1.x, y: b1.y + 20, vy: -8, friendly: true, w: 'pistol' }); g.step(NO_INPUT); expect(b1.broken).toBe(true);
  });
  it('유리창: 총알 2발에 깨지고 총알은 계속 날아간다 / 시야는 막지 않는다', () => {
    const g = new GroundSim({ seed: 3 }); g.enemies.length = 0;
    const w = g.windows[0], cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2;
    expect(g.obstacleAt(cx, cy)?.type).toBe('window'); expect(g.los(cx - 120, cy, cx + 120, cy)).toBe(true); expect(g.los(cx - 120, cy, cx + 120, cy, true)).toBe(false);
    for (let i = 0; i < 2; i++) { bullet(g, { x: cx - 40, y: cy, vx: 14, friendly: true, w: 'pistol', life: 40 }); g.step(NO_INPUT); }
    run(g, 6); expect(w.broken).toBe(true); expect(g.obstacleAt(cx, cy)).toBeNull();
  });
  it('문: 몸으로 밀면 반대쪽으로 열려 통과된다 / 닫힌 문은 시야·총알을 막는다 / 근접으로 걷어차면 빨리 열린다', () => {
    const g = new GroundSim({ seed: 3 }); clean(g);
    const d = doorAt(g, 6, 74); expect(d.kind).toBe('door');
    g.p.x = (d.c + 1.8) * TILE; g.p.y = (d.r + 1) * TILE;   // 문 오른쪽(복도)에서 왼쪽 방으로
    expect(g.obstacleAt((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2)?.type).toBe('door'); expect(g.los(g.p.x, g.p.y, d.x0 - 100, g.p.y)).toBe(false);
    run(g, 60, { ...NO_INPUT, mx: -1 });
    expect(Math.abs(d.phi)).toBeGreaterThan(45); expect(g.p.x).toBeLessThan(d.x0);
    const k = doorAt(g, 11, 76); expect(k.kind).toBe('door'); g.p.x = (k.c - 1) * TILE + 20; g.p.y = (k.r + 1) * TILE; g.p.aim = 0;
    g.step({ ...NO_INPUT, melee: true, ax: 1, ay: 0 }); run(g, 12); expect(Math.abs(k.phi)).toBeGreaterThan(30);
  });
  it('문은 12발에 부서져 통로가 영구히 열린다', () => {
    const g = new GroundSim({ seed: 3 }); g.enemies.length = 0;
    const d = doorAt(g, 6, 74); const cx = (d.x0 + d.x1) / 2, cy = (d.y0 + d.y1) / 2;
    for (let i = 0; i < 12; i++) { bullet(g, { x: cx + 60, y: cy, vx: -12, friendly: true, w: 'pistol', life: 20 }); g.step(NO_INPUT); }
    run(g, 6); expect(d.broken).toBe(true); expect(g.obstacleAt(cx, cy)).toBeNull();
  });
  it('잠긴 문(층 이동)은 구역을 정리하기 전에는 열리지 않는다', () => {
    const g = new GroundSim({ seed: 8 }); const gate = g.doors.find(d => d.kind === 'gate' && d.section === 0)!;
    expect(gate.locked).toBe(true); expect(g.obstacleAt((gate.x0 + gate.x1) / 2, (gate.y0 + gate.y1) / 2)?.type).toBe('door');
    g.enemies = g.enemies.filter(e => e.section !== 0); g.step(NO_INPUT);
    expect(g.cleared[0]).toBe(true); expect(gate.locked).toBe(false); run(g, 80); expect(Math.abs(gate.phi)).toBeGreaterThan(45);
    expect(g.pickups.some(k => k.kind === 'heart' && k.section === 0)).toBe(true);
  });
  it('총 겹침 방지: 벽에 바짝 붙어 벽을 겨누면 총이 막혀 발사되지 않는다', () => {
    const g = new GroundSim({ seed: 2 }); clean(g); g.p.weapon = 'smg'; g.p.ammo = 90;
    g.p.x = 5 * TILE; g.p.y = 104 * TILE + 40;   // 계단실 벽 바로 아래
    g.step({ ...NO_INPUT, fire: true, ax: 0, ay: -1 }); expect(g.p.gunBlocked).toBe(true); expect(g.bullets.length).toBe(0);
    g.p.y += 160; g.p.cd = 0; g.step({ ...NO_INPUT, fire: true, ax: 0, ay: -1 }); expect(g.p.gunBlocked).toBe(false); expect(g.bullets.length).toBeGreaterThan(0);
  });
  it('근접·폭탄은 정면에 벽이 있으면 시작하지 않는다', () => {
    const g = new GroundSim({ seed: 2 }); clean(g); g.p.x = 5 * TILE; g.p.y = 104 * TILE + 60;
    g.step({ ...NO_INPUT, melee: true, ax: 0, ay: -1 }); expect(g.p.seq).toBeNull();
    g.step({ ...NO_INPUT, bomb: true, ax: 0, ay: -1 }); expect(g.p.seq).toBeNull();
  });
  it('무기 4+1종: 시퀀스·탄 수·샷건 거리 감쇠', () => {
    const g = new GroundSim({ seed: 5 }); clean(g); g.p.weapon = 'shotgun'; g.p.ammo = 5;
    g.step({ ...NO_INPUT, fire: true, ax: 0, ay: -1 }); expect(g.bullets.length).toBe(6); expect(g.p.ammo).toBe(4);
    const h = new GroundSim({ seed: 5 }); clean(h); h.p.weapon = 'rail'; h.p.ammo = 3; h.step({ ...NO_INPUT, fire: true, ax: 0, ay: -1 }); expect(h.bullets[0].dmg).toBe(WEAPONS.rail.dmg);
    const near = new GroundSim({ seed: 5 }), far = new GroundSim({ seed: 5 });
    for (const [s, d] of [[near, 100], [far, 700]] as [GroundSim, number][]) { clean(s); s.p.x = 9 * TILE; s.p.y = 120 * TILE; const e = add(s, 'heavy', s.p.x, s.p.y - d - 80, 90); const hp0 = e.hp; s.p.weapon = 'shotgun'; s.p.ammo = 5; run(s, 40, { ...NO_INPUT, fire: true, ax: 0, ay: -1 }); (e as unknown as { d: number }).d = hp0 - e.hp; }
    expect(near.enemies[0].hp).toBeLessThan(far.enemies[0].hp);
  });
  it('사살 수: 권총 2방(체력 60) / 근접 2방 / 총알은 피격 효과표대로', () => {
    expect(Math.ceil(60 / FEEL.pistol.dmg)).toBe(2); expect(Math.ceil(60 / FEEL.melee.dmg)).toBe(2);
    const g = new GroundSim({ seed: 5 }); clean(g); g.p.x = 9 * TILE; g.p.y = 120 * TILE; const e = add(g, 'rifle', g.p.x, g.p.y - 300, 90);
    for (let i = 0; i < 2; i++) { g.p.cd = 0; g.p.seq = null; g.step({ ...NO_INPUT, fire: true, ax: 0, ay: -1 }); run(g, 20); }
    expect(g.enemies.includes(e)).toBe(false); expect(g.dying.includes(e) || g.drain().some(v => v.t === 'kill')).toBe(true);
  });
  it('소음: 총을 쏘면 같은 구역의 경계 전 적이 즉시 경계한다 (샷건 800 > 권총 600)', () => {
    const g = new GroundSim({ seed: 6 }); clean(g); g.p.x = 9 * TILE; g.p.y = 120 * TILE;
    const e = add(g, 'rifle', g.p.x, g.p.y - 700, 90); e.ang = 90; e.base = 0;
    g.p.weapon = 'pistol'; g.step({ ...NO_INPUT, fire: true, ax: 0, ay: 1 }); expect(e.state).toBe('idle');
    g.p.weapon = 'shotgun'; g.p.ammo = 5; g.p.cd = 0; g.p.seq = null; g.step({ ...NO_INPUT, fire: true, ax: 0, ay: 1 }); expect(e.state).toBe('alert');
  });
  it('시야: 정면 시야각 안에서 보이면 경계하고, 등 뒤나 벽 너머는 보지 못한다', () => {
    const g = new GroundSim({ seed: 6 }); clean(g); g.p.x = 9 * TILE; g.p.y = 120 * TILE;
    const front = add(g, 'rifle', g.p.x - 300, g.p.y, 0), back = add(g, 'rifle', g.p.x + 300, g.p.y, 0);   // 둘 다 오른쪽(0)을 본다: front 는 플레이어를 보고, back 은 등을 돌림
    front.base = 0; back.base = 0; run(g, 5);
    expect(front.state).toBe('alert'); expect(back.state).toBe('idle');
  });
  it('쓰러지는 방향: 등 뒤에서 맞으면 앞으로 엎어지고, 정면에서 맞으면 뒤로 쓰러진다', () => {
    const g = new GroundSim({ seed: 7 }); clean(g); g.p.x = 9 * TILE; g.p.y = 120 * TILE;
    const kill = (facing: number): boolean => { const e = add(g, 'rifle', g.p.x, g.p.y - 300, facing); e.ang = facing; e.base = facing; e.hp = 1; bullet(g, { x: e.x, y: e.y + 80, vy: -14, friendly: true, w: 'pistol', life: 20 }); run(g, 8); return g.dying[g.dying.length - 1].fallF; };
    expect(kill(-Math.PI / 2)).toBe(true);    // 총알(위로)과 같은 방향을 보고 있었다 = 등 뒤
    expect(kill(Math.PI / 2)).toBe(false);    // 총알을 마주 보고 있었다 = 정면
  });
  it('시체는 총알 방향으로 미끄러지다 멈추면 바닥 데칼로 합성(stamp)되고 사라진다', () => {
    const g = new GroundSim({ seed: 7 }); clean(g); g.p.x = 9 * TILE; g.p.y = 120 * TILE;
    const e = add(g, 'rifle', g.p.x, g.p.y - 300, 90); e.hp = 1; bullet(g, { x: e.x, y: e.y + 80, vy: -14, friendly: true, w: 'shotgun', life: 20 }); run(g, 8);
    expect(g.dying.length).toBe(1); const y0 = g.dying[0].y; run(g, 10); expect(g.dying[0].y).toBeLessThan(y0 - 5);
    const evs: string[] = []; for (let i = 0; i < 120; i++) { g.step(NO_INPUT); for (const v of g.drain()) evs.push(v.t); }
    expect(evs).toContain('stamp'); expect(g.dying.length).toBe(0);
  });
  it('폭탄: 시야가 있는 적을 죽이고 벽 너머의 적은 죽이지 않는다', () => {
    const g = new GroundSim({ seed: 8 }); clean(g); g.p.x = 9 * TILE; g.p.y = 120 * TILE;
    const open = add(g, 'rifle', g.p.x + 320, g.p.y - 60, 0), beyond = add(g, 'rifle', g.p.x, 101.5 * TILE, 0);   // 계단실 벽 너머
    g.p.hp = 99; g.p.maxHp = 99; g.p.invuln = 99999;
    g.step({ ...NO_INPUT, bomb: true, ax: 1, ay: 0.001 }); run(g, 150);
    expect(g.enemies.includes(open)).toBe(false); expect(g.enemies.includes(beyond)).toBe(true);
  });
  it('적이 무기를 떨구고, 권총일 때는 닿으면 줍고 다른 총을 들었으면 줍기 입력이 필요하다', () => {
    const g = new GroundSim({ seed: 10 }); clean(g); g.p.x = 9 * TILE; g.p.y = 120 * TILE;
    g.pickups = [{ id: 7, kind: 'weapon', weapon: 'shotgun', ammo: 7, x: g.p.x, y: g.p.y, t: 0, section: 0 }];
    g.step(NO_INPUT); expect(g.p.weapon).toBe('shotgun'); expect(g.p.ammo).toBe(7);
    g.pickups = [{ id: 8, kind: 'weapon', weapon: 'smg', ammo: 50, x: g.p.x, y: g.p.y, t: 0, section: 0 }]; g.p.pickCd = 0;
    g.step(NO_INPUT); expect(g.p.weapon).toBe('shotgun');
    g.step({ ...NO_INPUT, pickup: true }); expect(g.p.weapon).toBe('smg'); expect(g.pickups.some(k => k.weapon === 'shotgun' && k.dropped)).toBe(true);
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

import { newSimpleState, preciseAim, simpleControl } from '../src/core/groundinput';

describe('지상전 조작 모드', () => {
  it('간편: 이동하면 몸이 이동 방향을 보고, 데드존 안에서는 가만히 있는다', () => {
    const st = newSimpleState(); let o = simpleControl(st, 0, 0, false); expect(o.mx).toBe(0);
    o = simpleControl(st, 1, 0, false); expect(o.mx).toBeGreaterThan(0.9); expect(o.aim).toBeCloseTo(0);
    o = simpleControl(st, 0, -1, false); expect(o.aim).toBeCloseTo(-Math.PI / 2);
  });
  it('간편: 사격 버튼을 누르는 동안 방향이 잠겨 뒷걸음질 사격이 된다', () => {
    const st = newSimpleState(); simpleControl(st, 1, 0, false);   // 오른쪽을 보고
    let o = simpleControl(st, 1, 0, true); expect(o.fire).toBe(true); expect(o.aim).toBeCloseTo(0);
    o = simpleControl(st, -1, 0, true); expect(o.mx).toBeLessThan(-0.9); expect(o.aim).toBeCloseTo(0);   // 왼쪽으로 물러나며 오른쪽으로 쏜다
    o = simpleControl(st, -1, 0, false); expect(o.aim).toBeCloseTo(Math.PI);   // 버튼을 떼면 다시 이동 방향
  });
  it('간편: 제자리 회전 구역은 이동 없이 방향만 바꾼다 (사격 중에도)', () => {
    const st = newSimpleState(); let o = simpleControl(st, 0.25, 0, false); expect(o.mx).toBe(0); expect(o.aim).toBeCloseTo(0);
    o = simpleControl(st, 0, 0.25, true); expect(o.mx).toBe(0); expect(o.my).toBe(0); expect(o.aim).toBeCloseTo(Math.PI / 2);
  });
  it('정밀: 조준 스틱을 살짝만 밀어도 발사하고, 놓으면 조준이 없다', () => {
    expect(preciseAim(0.1, 0)).toBeNull();
    expect(preciseAim(0.25, 0)?.fire).toBe(false); expect(preciseAim(0.35, 0)?.fire).toBe(true); expect(preciseAim(0, 1)?.aim).toBeCloseTo(Math.PI / 2);
  });
});

describe('3스테이지 보스 자폭 → 탈출 → 지상전', () => {
  const mk = () => new Sim(3, metaParams({} as any, 'ace', null));
  it('지상전이 켜져 있으면 보스가 쓰러질 때 과부하 → 자폭 → 탈출 대기 (유물은 아직 안 나온다)', () => {
    const s = mk(); s.groundEnabled = true; s.startAtTier(3); s.bossTier = 3; s.stagePhase = 'BOSS'; (s as any).spawnBoss(3); s.boss!.y = 135; s.boss!.hp = 1; s.player.invincible = 99999;
    s.step(idle(s)); const evs0 = s.drainEvents().map(e => e.t); s.boss!.hp = 0; s.step(idle(s));
    const evs = s.drainEvents().map(e => e.t); expect(evs).toContain('overload'); expect(s.overload).toBe(true); void evs0;
    let n = 0; while (s.stagePhase === 'BOSS_DYING' && n++ < 400) s.step(idle(s));
    expect(s.stagePhase).toBe('EJECT'); expect(s.damaged).toBe(true); expect(s.pending).toBeNull();
    expect(s.drainEvents().map(e => e.t)).toContain('selfdestruct');
  });
  it('탈출 버튼(또는 시간 초과)으로 탈출하면 강하 요청이 나가고, 지상전 클리어 뒤 유물을 준다', () => {
    const s = mk(); s.groundEnabled = true; s.startAtTier(3); s.bossTier = 3; s.stagePhase = 'EJECT'; s.phaseTimer = 100; s.player.invincible = 99999;
    s.eject(); expect(s.stagePhase).toBe('CLEAR'); s.step(idle(s)); s.step(idle(s)); expect(s.groundRequest).toBe(true);
    const t = mk(); t.groundEnabled = true; t.startAtTier(3); t.bossTier = 3; t.stagePhase = 'EJECT'; t.phaseTimer = 5; t.player.invincible = 99999;   // 자동 탈출
    for (let i = 0; i < 12; i++) t.step(idle(t)); expect(t.groundRequest).toBe(true);
    s.startGround(); s.finishGround({ score: 100, rooms: 4 }); expect(s.pending?.length).toBeGreaterThan(0); expect(s.overload).toBe(false); expect(s.damaged).toBe(false);
  });
  it('지상전이 꺼져 있으면(헤드리스) 기존 보스 처치 흐름 그대로', () => {
    const s = mk(); s.startAtTier(3); s.bossTier = 3; s.stagePhase = 'BOSS'; (s as any).spawnBoss(3); s.boss!.y = 135; s.boss!.hp = 0; s.player.invincible = 99999;
    s.step(idle(s)); expect(s.overload).toBe(false); let n = 0; while (s.stagePhase === 'BOSS_DYING' && n++ < 400) s.step(idle(s));
    expect(s.stagePhase).toBe('CLEAR'); expect(s.pending?.length).toBeGreaterThan(0);
  });
});
