import { createRng, type Rng } from './rng';
import { COLS, ROWS, SECTIONS, T, TILE, WORLD_H, WORLD_W, blocksBullet, blocksMove, blocksSight, buildLevel, flowField, rayBlocked, sectionOfRow, tileAt, type Level } from './groundmap';

/**
 * 지상전 「강하」 규칙 (순수 TS, Phaser 무관). 한 틱 = 1/60초.
 * 핫라인 마이애미식: 옥상 → 건물 2개 층 → 격납고까지 위로 걸어 올라가는 스크롤 맵. 일반 적은 한두 방에 쓰러지지만
 * 시야각·소음에 반응하고, 시체·무기·탄피는 바닥에 남는다. 연출은 events 로 내보내고 렌더/사운드는 씬이 처리한다.
 */
export const GW = WORLD_W, GH = WORLD_H;

export type WeaponId = 'pistol' | 'shotgun' | 'smg' | 'rail';
export type GKind = 'rifle' | 'charger' | 'sniper' | 'turret' | 'drone' | 'tank' | 'boss' | 'heavy' | 'dog';
export type CoverKind = 'barrier' | 'crate' | 'stack' | 'crates2' | 'barrel';

export const WEAPONS: Record<WeaponId, { name: string; dmg: number; cd: number; speed: number; spread: number; pellets: number; ammo: number; pierce: number; kick: number; noise: number }> = {
  pistol:  { name: '권총',       dmg: 1.25, cd: 13, speed: 10,  spread: 0.03, pellets: 1, ammo: Infinity, pierce: 0, kick: 0.6, noise: 230 },
  shotgun: { name: '샷건',       dmg: 0.95, cd: 38, speed: 9,   spread: 0.55, pellets: 7, ammo: 9,        pierce: 0, kick: 2.2, noise: 650 },
  smg:     { name: 'SMG',        dmg: 0.62, cd: 5,  speed: 11,  spread: 0.11, pellets: 1, ammo: 110,      pierce: 0, kick: 0.5, noise: 330 },
  rail:    { name: '레일 라이플', dmg: 7,    cd: 58, speed: 20,  spread: 0,    pellets: 1, ammo: 9,        pierce: 9, kick: 3,   noise: 450 },
};

export const GROUND = {
  hp: 4, speed: 3.1, radius: 8,
  rollFrames: 18, rollInvuln: 24, rollSpeed: 8.2, rollCd: 66,
  hurtInvuln: 60, comboFrames: 150, grenadeCd: 40,
  viewDist: 330, viewHalf: 0.96, reactFrames: 9, doorStun: 100,
} as const;

export interface GroundOpts { seed: number; pilot: 0 | 1 | 2; dmgMult: number; rateMult: number; maxHp: number; grenades: number; assist: boolean }
export const DEFAULT_GROUND_OPTS: GroundOpts = { seed: 1, pilot: 0, dmgMult: 1, rateMult: 1, maxHp: GROUND.hp, grenades: 2, assist: true };

export interface GInput { mx: number; my: number; ax: number; ay: number; fire: boolean; roll: boolean; grenade: boolean; pickup?: boolean; throwW?: boolean }
export const NO_INPUT: GInput = { mx: 0, my: 0, ax: 0, ay: 0, fire: false, roll: false, grenade: false };

export interface GPlayer {
  x: number; y: number; r: number; hp: number; maxHp: number;
  aim: number;                       // 조준 각도 (0 = 오른쪽, π/2 = 아래)
  rollT: number; rollCd: number; rdx: number; rdy: number; invuln: number;
  fireCd: number; weapon: WeaponId; ammo: number; grenades: number; grenadeCd: number;
  kick: number; walk: number; dashBonus: number; moving: boolean; pickCd: number;
}
export interface GEnemy {
  id: number; kind: GKind; x: number; y: number; r: number; hp: number; maxHp: number; section: number;
  state: 'IDLE' | 'WIND' | 'DASH' | 'STUN';
  aw: 0 | 1 | 2;                      // 0 순찰·대기 / 1 소음 조사 / 2 교전
  react: number; look: number; tx: number; ty: number;   // 반응 지연, 조사 후 두리번 시간, 조사 목표
  t: number; cd: number; ang: number; lx: number; ly: number; dir: number; burst: number; flash: number; phase: number; styled: boolean;
  home: { x: number; y: number; ang: number }; patrol?: [number, number][]; pi: number; moved: number;
}
export interface GBullet { x: number; y: number; vx: number; vy: number; r: number; dmg: number; friendly: boolean; pierce: number; hit: number[]; life: number; kind?: 'normal' | 'throw' | 'sniper'; src?: GKind; w?: WeaponId }
export interface GCover { id: number; kind: CoverKind; x: number; y: number; w: number; h: number; hp: number; dead: boolean; section: number }
export interface GZone { x: number; y: number; r: number; t: number; max: number; dmg: number; foe: boolean; src?: GKind }   // 폭발 예고(박격포/수류탄)
export interface GPickup { id: number; kind: 'heart' | 'weapon'; weapon?: WeaponId; ammo?: number; x: number; y: number; t: number; section: number; dropped?: boolean }
export interface GGrenade { x: number; y: number; sx: number; sy: number; tx: number; ty: number; t: number; max: number }
export interface GCorpse { id: number; kind: GKind; x: number; y: number; a: number; vx: number; vy: number; section: number }

export type GEvent =
  | { t: 'shot'; x: number; y: number; weapon: WeaponId; ang: number }
  | { t: 'hit'; x: number; y: number; dmg: number; kill: boolean; kind: GKind; ang: number }
  | { t: 'hurt'; x: number; y: number; by?: GKind }
  | { t: 'roll'; x: number; y: number }
  | { t: 'boom'; x: number; y: number; r: number }
  | { t: 'kill'; x: number; y: number; kind: GKind; pts: number; combo: number; ang: number }
  | { t: 'style'; x: number; y: number }
  | { t: 'pickup'; what: 'heart' | 'weapon' | 'ammo'; x: number; y: number }
  | { t: 'drop'; x: number; y: number; weapon: WeaponId }
  | { t: 'wallhit'; x: number; y: number; ang: number }
  | { t: 'alert'; x: number; y: number }
  | { t: 'doorbash'; x: number; y: number }
  | { t: 'door'; c: number; r: number }
  | { t: 'gate'; section: number }
  | { t: 'section'; n: number; name: string }
  | { t: 'cleared'; n: number }
  | { t: 'shake'; v: number; ang?: number }
  | { t: 'hitstop'; frames: number }
  | { t: 'slowmo'; ms: number; scale: number }
  | { t: 'throw'; x: number; y: number }
  | { t: 'bossPhase'; phase: number }
  | { t: 'coverBreak'; x: number; y: number }
  | { t: 'reset'; section: number }
  | { t: 'exitopen' }
  | { t: 'win' } | { t: 'dead' };

const COVER_SIZE: Record<CoverKind, [number, number]> = { barrier: [78, 26], crate: [42, 31], stack: [27, 47], crates2: [36, 44], barrel: [18, 28] };
export const SECTION_COUNT = SECTIONS.length;

const ENEMY_DEF: Record<GKind, { hp: number; r: number; pts: number }> = {
  rifle: { hp: 1.2, r: 13, pts: 100 }, charger: { hp: 2, r: 15, pts: 160 }, sniper: { hp: 1.2, r: 12, pts: 220 }, heavy: { hp: 8, r: 18, pts: 400 }, dog: { hp: 1.2, r: 11, pts: 120 },
  turret: { hp: 11, r: 24, pts: 220 }, drone: { hp: 1, r: 10, pts: 40 }, tank: { hp: 55, r: 46, pts: 900 }, boss: { hp: 160, r: 62, pts: 4000 },
};
const DROPS: Partial<Record<GKind, { w: WeaponId; p: number }>> = { rifle: { w: 'smg', p: 0.4 }, heavy: { w: 'shotgun', p: 0.7 }, sniper: { w: 'rail', p: 0.3 } };

const LEVEL: Level = buildLevel();

export class GroundSim {
  rng: Rng;
  opts: GroundOpts;
  frame = 0;
  state: 'PLAY' | 'WIN' | 'DEAD' = 'PLAY';
  tiles: Uint8Array = LEVEL.tiles.slice();
  p!: GPlayer;
  enemies: GEnemy[] = []; bullets: GBullet[] = []; cover: GCover[] = []; zones: GZone[] = []; pickups: GPickup[] = []; grenadeList: GGrenade[] = []; corpses: GCorpse[] = [];
  doorT = new Map<number, number>();     // 스윙 도어 열림 애니메이션 (타일 인덱스 → 남은 프레임)
  events: GEvent[] = [];
  cleared: boolean[] = SECTIONS.map(() => false);
  reached = 0;                           // 가장 높이 도달한 구역
  score = 0; kills = 0; combo = 0; comboT = 0; time = 0; maxCombo = 0; styles = 0;
  private nextId = 1;
  private pflow = new Int16Array(COLS * ROWS);
  private pflowAt = -99; private pflowTile = -1;
  private nflow = new Int16Array(COLS * ROWS);
  private nflowAt = -999; private nflowTile = -1;

  constructor(opts: Partial<GroundOpts> = {}) {
    this.opts = { ...DEFAULT_GROUND_OPTS, ...opts };
    this.rng = createRng(this.opts.seed + 7919);
    this.p = {
      x: LEVEL.start.x, y: LEVEL.start.y, r: GROUND.radius, hp: this.opts.maxHp, maxHp: this.opts.maxHp, aim: -Math.PI / 2,
      rollT: 0, rollCd: 0, rdx: 0, rdy: 0, invuln: 60, fireCd: 0, weapon: 'pistol', ammo: Infinity, grenades: this.opts.grenades, grenadeCd: 0, kick: 0, walk: 0, dashBonus: 0, moving: false, pickCd: 0,
    };
    for (let s = 0; s < SECTION_COUNT; s++) this.populate(s);
    this.emit({ t: 'section', n: 0, name: SECTIONS[0].name });
  }

  private emit(e: GEvent): void { this.events.push(e); }
  drain(): GEvent[] { const e = this.events; this.events = []; return e; }
  get boss(): GEnemy | undefined { return this.enemies.find(e => e.kind === 'boss'); }
  get section(): number { return sectionOfRow(Math.floor(this.p.y / TILE)); }
  get isBossRoom(): boolean { return this.section === 3; }
  get remaining(): number { const s = this.section; return this.enemies.filter(e => e.section === s && e.kind !== 'drone').length; }
  get exitOpen(): boolean { return this.cleared[3]; }

  // ---------------------------------------------------------------- 구역 구성
  /** 구역의 적·엄폐물·무기를 처음 상태로 채운다 (처음 + 사망 후 재시작) */
  private populate(s: number): void {
    this.enemies = this.enemies.filter(e => e.section !== s); this.cover = this.cover.filter(c => c.section !== s);
    this.pickups = this.pickups.filter(k => k.section !== s); this.corpses = this.corpses.filter(c => c.section !== s);
    for (const m of LEVEL.spawns) if (m.section === s) this.addEnemy(m.k, m.x, m.y, m.ang ?? Math.PI / 2, m.patrol);
    for (const c of LEVEL.covers) if (c.section === s) { const [w, h] = COVER_SIZE[c.kind]; this.cover.push({ id: this.nextId++, kind: c.kind, x: c.x, y: c.y, w, h, hp: c.kind === 'barrel' ? 1 : 999, dead: false, section: s }); }
    for (const k of LEVEL.pickups) if (k.section === s) this.pickups.push({ id: this.nextId++, kind: 'weapon', weapon: k.weapon, ammo: WEAPONS[k.weapon].ammo, x: k.x, y: k.y, t: 0, section: s });
  }

  private addEnemy(kind: GKind, x: number, y: number, ang = Math.PI / 2, patrol?: [number, number][]): GEnemy {
    const d = ENEMY_DEF[kind];
    const e: GEnemy = {
      id: this.nextId++, kind, x, y, r: d.r, hp: d.hp, maxHp: d.hp, section: sectionOfRow(Math.floor(y / TILE)), state: 'IDLE', aw: 0, react: 0, look: 0, tx: x, ty: y,
      t: 0, cd: 40 + Math.floor(this.rng() * 50), ang, lx: 0, ly: 0, dir: this.rng() < 0.5 ? -1 : 1, burst: 0, flash: 0, phase: 1, styled: false, home: { x, y, ang }, patrol, pi: 0, moved: 0,
    };
    this.enemies.push(e);
    return e;
  }

  /** 사망 후 이어하기: 지금 구역을 처음부터 다시 (이미 정리한 구역은 그대로) */
  revive(): void {
    const s = this.section, def = SECTIONS[s];
    this.p.hp = Math.max(2, Math.ceil(this.p.maxHp / 2)); this.p.invuln = 120; this.combo = 0; this.comboT = 0;
    this.state = 'PLAY'; this.bullets.length = 0; this.zones.length = 0; this.grenadeList.length = 0;
    if (!this.cleared[s]) this.populate(s);   // 정리한 구역은 다시 채우지 않는다
    this.p.x = s === 0 ? LEVEL.start.x : (9 * TILE); this.p.y = s === 0 ? LEVEL.start.y : (def.r1 - 1) * TILE + TILE / 2; this.p.rollT = 0;
    this.p.weapon = 'pistol'; this.p.ammo = Infinity;
    this.emit({ t: 'reset', section: s });
  }

  // ---------------------------------------------------------------- 길찾기
  /** 이동 가능한 타일인가 (엄폐물이 놓인 타일은 제외) */
  walkable = (c: number, r: number): boolean => {
    const t = this.tiles[r * COLS + c];
    if (blocksMove(t)) return false;
    const x = (c + 0.5) * TILE, y = (r + 0.5) * TILE;
    for (const k of this.cover) if (!k.dead && Math.abs(x - k.x) < k.w / 2 + 6 && Math.abs(y - k.y) < k.h / 2 + 6) return false;
    return true;
  };
  /** 플레이어 위치에서 퍼지는 거리장 (8프레임마다 갱신) */
  private playerFlow(): Int16Array {
    const tile = Math.floor(this.p.y / TILE) * COLS + Math.floor(this.p.x / TILE);
    if (this.frame - this.pflowAt >= 8 || tile !== this.pflowTile) { flowField(Math.floor(this.p.x / TILE), Math.floor(this.p.y / TILE), this.walkable, this.pflow); this.pflowAt = this.frame; this.pflowTile = tile; }
    return this.pflow;
  }
  /** 임의 지점 거리장 (봇·소음 조사용) */
  flowTo(x: number, y: number, out?: Int16Array): Int16Array {
    return flowField(Math.floor(x / TILE), Math.floor(y / TILE), this.walkable, out);
  }
  private noiseFlow(x: number, y: number): Int16Array {
    const tile = Math.floor(y / TILE) * COLS + Math.floor(x / TILE);
    if (tile !== this.nflowTile || this.frame - this.nflowAt > 120) { flowField(Math.floor(x / TILE), Math.floor(y / TILE), this.walkable, this.nflow); this.nflowTile = tile; this.nflowAt = this.frame; }
    return this.nflow;
  }
  /** 거리장 기울기를 따라 한 걸음 */
  private stepFlow(e: { x: number; y: number }, f: Int16Array, speed: number, r: number): boolean {
    const c = Math.floor(e.x / TILE), rr = Math.floor(e.y / TILE), here = f[rr * COLS + c];
    let best = -1, bx = 0, by = 0, bd = here < 0 ? 1e9 : here;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const nc = c + dx, nr = rr + dy; if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      if (dx && dy && (f[rr * COLS + nc] < 0 || f[nr * COLS + c] < 0)) continue;   // 모서리 가로지르기 방지
      const d = f[nr * COLS + nc]; if (d >= 0 && d < bd) { bd = d; best = 1; bx = (nc + 0.5) * TILE; by = (nr + 0.5) * TILE; }
    }
    if (best < 0) return false;
    const a = Math.atan2(by - e.y, bx - e.x); this.move(e, Math.cos(a) * speed, Math.sin(a) * speed, r);
    return true;
  }
  canSee(ax: number, ay: number, bx: number, by: number): boolean { return !rayBlocked(this.tiles, ax, ay, bx, by, blocksSight); }

  // ---------------------------------------------------------------- 틱
  step(inp: GInput): void {
    if (this.state !== 'PLAY') return;
    this.frame++; this.time++;
    const p = this.p;
    if (this.comboT > 0 && --this.comboT === 0) this.combo = 0;
    if (p.invuln > 0) p.invuln--;
    if (p.fireCd > 0) p.fireCd--;
    if (p.rollCd > 0) p.rollCd--;
    if (p.grenadeCd > 0) p.grenadeCd--;
    if (p.dashBonus > 0) p.dashBonus--;
    if (p.pickCd > 0) p.pickCd--;
    p.kick *= 0.8;
    for (const [k, v] of this.doorT) { if (v <= 1) this.doorT.delete(k); else this.doorT.set(k, v - 1); }
    this.updatePlayer(inp);
    this.updateGrenades();
    this.updateEnemies();
    this.updateBullets();
    this.updateZones();
    this.updatePickups(inp);
    this.updateCorpses();
    this.updateSections();
    if (p.hp <= 0 && (this.state as string) !== 'DEAD') { this.state = 'DEAD'; this.emit({ t: 'dead' }); }
  }

  private updateSections(): void {
    const s = this.section;
    if (s > this.reached) { this.reached = s; this.emit({ t: 'section', n: s, name: SECTIONS[s].name }); this.score += 200; }
    for (let i = 0; i < 3; i++) {   // 일반 구역: 모두 정리하면 위층 문이 열린다
      if (this.cleared[i] || this.enemies.some(e => e.section === i)) continue;
      this.cleared[i] = true; this.openGates(i);
      this.score += 300 + 150 * i; this.emit({ t: 'cleared', n: i });
      const r = SECTIONS[i].r0; this.pickups.push({ id: this.nextId++, kind: 'heart', x: 9 * TILE, y: (r + 4) * TILE, t: 0, section: i });
    }
    if (!this.cleared[3] && this.reached === 3 && !this.boss) {
      this.cleared[3] = true; this.score += 800;
      for (let r = 0; r < 2; r++) for (let c = 8; c <= 9; c++) if (this.tiles[r * COLS + c] === T.EXIT) this.tiles[r * COLS + c] = T.FLOOR;
      this.emit({ t: 'exitopen' }); this.emit({ t: 'gate', section: 3 }); this.emit({ t: 'cleared', n: 3 });
      this.enemies = this.enemies.filter(k => k.section !== 3);   // 남은 드론 정리
    }
    if (this.cleared[3] && this.p.y < 2 * TILE && Math.abs(this.p.x - 9 * TILE) < 2 * TILE) { this.state = 'WIN'; this.emit({ t: 'win' }); this.emit({ t: 'slowmo', ms: 700, scale: 0.3 }); }
  }
  private openGates(section: number): void {
    const r0 = SECTIONS[section].r0;
    for (let r = r0; r <= r0 + 1; r++) for (let c = 8; c <= 9; c++) if (this.tiles[r * COLS + c] === T.GATE) this.tiles[r * COLS + c] = T.FLOOR;
    this.emit({ t: 'gate', section });
  }

  // ---------------------------------------------------------------- 플레이어
  private updatePlayer(inp: GInput): void {
    const p = this.p, o = this.opts;
    let mx = inp.mx, my = inp.my; const m = Math.hypot(mx, my); if (m > 1) { mx /= m; my /= m; }
    if (inp.roll && p.rollT <= 0 && p.rollCd <= 0) {
      const l = Math.hypot(mx, my) || 0, dx = l > 0.1 ? mx / l : Math.cos(p.aim), dy = l > 0.1 ? my / l : Math.sin(p.aim);
      p.rollT = GROUND.rollFrames; p.rdx = dx; p.rdy = dy; p.invuln = Math.max(p.invuln, GROUND.rollInvuln);
      p.rollCd = Math.round(GROUND.rollCd * (o.pilot === 0 ? 0.8 : 1)); p.dashBonus = 0;
      this.emit({ t: 'roll', x: p.x, y: p.y });
    }
    p.moving = false;
    if (p.rollT > 0) {
      p.rollT--; this.move(p, p.rdx * GROUND.rollSpeed, p.rdy * GROUND.rollSpeed, p.r, true);
      if (p.rollT === 0) p.dashBonus = 40;   // 구르기 직후 첫 사격 강화 (대시-킬)
    } else {
      this.move(p, mx * GROUND.speed, my * GROUND.speed, p.r, true);
      if (m > 0.1) { p.walk += 0.28; p.moving = true; }
    }
    // 조준: 조준 입력이 있으면 그 방향, 없으면(발사 중) 가장 가까운 적 자동 조준, 둘 다 없으면 이동 방향
    let aim = p.aim;
    const hasAim = Math.hypot(inp.ax, inp.ay) > 0.2;
    if (hasAim) {
      aim = Math.atan2(inp.ay, inp.ax);
      if (o.assist) { const t = this.nearestInCone(aim, 0.22); if (t) aim = Math.atan2(t.y - p.y, t.x - p.x); }
    } else if (inp.fire) {
      const t = this.nearestEnemy(); if (t) aim = Math.atan2(t.y - p.y, t.x - p.x); else if (m > 0.1) aim = Math.atan2(my, mx);
    } else if (m > 0.1) aim = Math.atan2(my, mx);
    p.aim = aim;
    if (inp.fire && p.rollT <= 0 && p.fireCd <= 0) this.shoot();
    if (inp.throwW && p.weapon !== 'pistol') this.throwWeapon();
    if (inp.grenade && p.grenades > 0 && p.grenadeCd <= 0) {
      p.grenades--; p.grenadeCd = GROUND.grenadeCd;
      const dist = 170, tx = p.x + Math.cos(p.aim) * dist, ty = p.y + Math.sin(p.aim) * dist;
      this.grenadeList.push({ x: p.x, y: p.y, sx: p.x, sy: p.y, tx, ty, t: 0, max: 40 });
    }
  }

  private shoot(): void {
    const p = this.p, o = this.opts, w = WEAPONS[p.weapon];
    p.fireCd = Math.max(2, Math.round(w.cd / o.rateMult));
    const bonus = p.dashBonus > 0 ? 1.5 : 1; if (p.dashBonus > 0) p.dashBonus = 0;
    const pil = o.pilot === 1 ? 1.2 : 1, pierce = w.pierce + (o.pilot === 2 ? 1 : 0), spd = w.speed * (o.pilot === 2 ? 1.15 : 1);
    for (let i = 0; i < w.pellets; i++) {
      const a = p.aim + (w.pellets > 1 ? (i / (w.pellets - 1) - 0.5) * w.spread + (this.rng() - 0.5) * 0.08 : (this.rng() - 0.5) * w.spread * 2);
      this.bullets.push({ x: p.x + Math.cos(p.aim) * 16, y: p.y + Math.sin(p.aim) * 16, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: p.weapon === 'rail' ? 5 : 3, dmg: w.dmg * o.dmgMult * bonus * pil, friendly: true, pierce, hit: [], life: 75, w: p.weapon });
    }
    p.kick = w.kick;
    this.emit({ t: 'shot', x: p.x, y: p.y, weapon: p.weapon, ang: p.aim });
    this.makeNoise(p.x, p.y, w.noise);
    if (p.weapon !== 'pistol' && --p.ammo <= 0) this.throwWeapon();
  }

  /** 총을 던진다 (탄이 떨어졌을 때 자동 / 수동): 적에게 큰 피해 + 스턴 */
  private throwWeapon(): void {
    const p = this.p;
    this.bullets.push({ x: p.x, y: p.y, vx: Math.cos(p.aim) * 8, vy: Math.sin(p.aim) * 8, r: 7, dmg: 9 * this.opts.dmgMult, friendly: true, pierce: 0, hit: [], life: 45, kind: 'throw' });
    p.weapon = 'pistol'; p.ammo = Infinity; this.emit({ t: 'throw', x: p.x, y: p.y });
  }

  private nearestEnemy(): GEnemy | null {
    let best: GEnemy | null = null, bd = 1e9;
    for (const e of this.enemies) { const d = (e.x - this.p.x) ** 2 + (e.y - this.p.y) ** 2; if (d < bd && d < 520 * 520 && this.canSee(this.p.x, this.p.y, e.x, e.y)) { bd = d; best = e; } }
    return best;
  }
  private nearestInCone(aim: number, cone: number): GEnemy | null {
    let best: GEnemy | null = null, bd = 1e9;
    for (const e of this.enemies) {
      let da = Math.atan2(e.y - this.p.y, e.x - this.p.x) - aim; da = Math.atan2(Math.sin(da), Math.cos(da));
      const d = Math.hypot(e.x - this.p.x, e.y - this.p.y);
      if (Math.abs(da) < cone && d < bd && d < 520 && this.canSee(this.p.x, this.p.y, e.x, e.y)) { bd = d; best = e; }
    }
    return best;
  }

  private updateGrenades(): void {
    for (let i = this.grenadeList.length - 1; i >= 0; i--) {
      const g = this.grenadeList[i]; g.t++;
      const k = g.t / g.max; g.x = g.sx + (g.tx - g.sx) * k; g.y = g.sy + (g.ty - g.sy) * k;
      if (blocksBullet(tileAt(this.tiles, g.x, g.y))) { g.tx = g.sx + (g.tx - g.sx) * (k - 0.1); g.ty = g.sy + (g.ty - g.sy) * (k - 0.1); g.t = g.max; }   // 벽에 맞으면 그 자리에서 터진다
      if (g.t >= g.max) { this.grenadeList.splice(i, 1); this.explode(g.tx, g.ty, 62, 6 * this.opts.dmgMult); this.makeNoise(g.tx, g.ty, 600); }
    }
  }

  // ---------------------------------------------------------------- 이동·충돌
  /** 원형 몸체를 타일·엄폐물과 부딪히며 이동 (isPlayer: 스윙 도어를 밀면 열림) */
  private move(o: { x: number; y: number }, dx: number, dy: number, r: number, isPlayer = false): void {
    o.x = Math.max(r, Math.min(WORLD_W - r, o.x + dx)); o.y = Math.max(r, Math.min(WORLD_H - r, o.y + dy));
    const c0 = Math.floor((o.x - r) / TILE), c1 = Math.floor((o.x + r) / TILE), r0 = Math.floor((o.y - r) / TILE), r1 = Math.floor((o.y + r) / TILE);
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) {
      if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) continue;
      const t = this.tiles[rr * COLS + cc];
      if (t === T.DOOR) { if ((this.doorT.get(rr * COLS + cc) ?? 0) < 10) this.openDoor(cc, rr, o, isPlayer); continue; }
      if (blocksMove(t)) this.pushOut(o, r, cc * TILE + TILE / 2, rr * TILE + TILE / 2, TILE / 2, TILE / 2);
    }
    for (const c of this.cover) if (!c.dead) this.pushOut(o, r, c.x, c.y, c.w / 2, c.h / 2);
  }
  private pushOut(o: { x: number; y: number }, r: number, cx: number, cy: number, hx: number, hy: number): void {
    const nx = Math.max(cx - hx, Math.min(o.x, cx + hx)), ny = Math.max(cy - hy, Math.min(o.y, cy + hy));
    const ddx = o.x - nx, ddy = o.y - ny, d2 = ddx * ddx + ddy * ddy;
    if (d2 >= r * r) return;
    if (d2 > 1e-6) { const d = Math.sqrt(d2), push = r - d + 0.01; o.x += (ddx / d) * push; o.y += (ddy / d) * push; }
    else {   // 중심이 사각형 안으로 파고든 경우: 가장 가까운 면 바깥으로 밀어낸다
      const l = o.x - (cx - hx), rr = cx + hx - o.x, t = o.y - (cy - hy), bt = cy + hy - o.y, m = Math.min(l, rr, t, bt);
      if (m === l) o.x = cx - hx - r - 0.01; else if (m === rr) o.x = cx + hx + r + 0.01; else if (m === t) o.y = cy - hy - r - 0.01; else o.y = cy + hy + r + 0.01;
    }
  }
  /** 스윙 도어: 지나가면 열렸다 닫힌다. 플레이어가 박차고 들어오면 문 근처의 적이 기절한다 */
  private openDoor(c: number, r: number, who: { x: number; y: number }, isPlayer: boolean): void {
    const idx = r * COLS + c; this.doorT.set(idx, 26); this.emit({ t: 'door', c, r });
    if (!isPlayer) return;
    const cx = (c + 0.5) * TILE, cy = (r + 0.5) * TILE;
    for (const e of this.enemies) {
      if (e.kind === 'dog' || e.kind === 'heavy' || e.kind === 'boss' || e.kind === 'turret') continue;
      if (Math.hypot(e.x - cx, e.y - cy) < 44 && (e.x - who.x) * (cx - who.x) + (e.y - who.y) * (cy - who.y) > -200) {
        e.state = 'STUN'; e.t = GROUND.doorStun; e.aw = Math.max(e.aw, 1) as 1 | 2; e.styled = false;
        this.emit({ t: 'doorbash', x: e.x, y: e.y }); this.score += 100;
      }
    }
  }

  // ---------------------------------------------------------------- 소음·시야
  /** 총소리: 반경 안의 경계 전 적이 소리 난 곳을 조사하러 온다 (벽 너머는 반경 절반) */
  private makeNoise(x: number, y: number, radius: number): void {
    for (const e of this.enemies) {
      if (e.aw !== 0 || e.kind === 'drone') continue;
      const d = Math.hypot(e.x - x, e.y - y), rad = (e.kind === 'dog' ? 1.4 : 1) * radius * (this.canSee(e.x, e.y, x, y) ? 1 : 0.55);
      if (d < rad) { e.aw = 1; e.tx = x; e.ty = y; e.look = 0; this.emit({ t: 'alert', x: e.x, y: e.y }); }
    }
  }
  /** 적이 플레이어를 볼 수 있는가: 시야각(전방 110°)·거리·벽 */
  private sees(e: GEnemy): boolean {
    const p = this.p, dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
    const view = e.kind === 'sniper' ? 520 : e.kind === 'turret' ? 400 : GROUND.viewDist;
    if (d > view) return false;
    if (d > 70 && e.kind !== 'turret') { let da = Math.atan2(dy, dx) - e.ang; da = Math.atan2(Math.sin(da), Math.cos(da)); if (Math.abs(da) > GROUND.viewHalf) return false; }
    return this.canSee(e.x, e.y, p.x, p.y);
  }

  // ---------------------------------------------------------------- 적
  private enemyShot(e: GEnemy, ang: number, speed: number, dmg = 1, r = 3.5, kind: GBullet['kind'] = 'normal'): void {
    this.bullets.push({ x: e.x + Math.cos(ang) * (e.r * 0.8), y: e.y + Math.sin(ang) * (e.r * 0.8), vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r, dmg, friendly: false, pierce: 0, hit: [], life: 240, kind, src: e.kind });
  }
  private angToPlayer(e: GEnemy): number { return Math.atan2(this.p.y - e.y, this.p.x - e.x); }

  private updateEnemies(): void {
    const p = this.p;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e) continue;
      if (e.flash > 0) e.flash--;
      const dist = Math.hypot(p.x - e.x, p.y - e.y);
      if (e.aw === 0 && dist > 900) continue;                     // 멀리 있는 경계 전 적은 쉰다
      if (e.state === 'STUN') { if (--e.t <= 0) { e.state = 'IDLE'; e.cd = 40; } continue; }
      if (e.kind === 'boss' && e.aw < 2) { if (this.section === 3 && (this.sees(e) || dist < 380)) e.aw = 2; else { e.ang = this.angToPlayer(e); continue; } }
      if (e.aw < 2) {
        if (this.sees(e)) {   // 발견: 잠깐 반응 지연 뒤 교전
          if (++e.react >= GROUND.reactFrames) {
            e.aw = 2; e.react = 0; this.emit({ t: 'alert', x: e.x, y: e.y });
            for (const o of this.enemies) if (o !== e && o.aw === 0 && o.section === e.section && Math.hypot(o.x - e.x, o.y - e.y) < 160) { o.aw = 1; o.tx = p.x; o.ty = p.y; o.look = 0; }   // 비명: 가까운 동료도 달려온다
          }
          e.ang = this.angToPlayer(e);
        } else {
          e.react = Math.max(0, e.react - 1);
          if (e.aw === 1) this.investigate(e); else this.idle(e);
        }
        continue;
      }
      this.combat(e, dist);
    }
  }

  private idle(e: GEnemy): void {
    if (e.patrol && e.patrol.length > 1) {   // 순찰: 경유점을 오간다
      const [wx, wy] = e.patrol[e.pi], a = Math.atan2(wy - e.y, wx - e.x), x0 = e.x, y0 = e.y;
      this.move(e, Math.cos(a) * 0.9, Math.sin(a) * 0.9, e.r); e.ang += (((a - e.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.15;
      if (Math.hypot(wx - e.x, wy - e.y) < 14 || (Math.hypot(e.x - x0, e.y - y0) < 0.2 && ++e.moved > 30)) { e.pi = (e.pi + 1) % e.patrol.length; e.moved = 0; }
    } else if (e.kind !== 'turret') e.ang = e.home.ang + Math.sin((this.frame + e.id * 17) * 0.018) * 0.7;   // 제자리에서 두리번
    else e.ang += 0.015;
  }
  private investigate(e: GEnemy): void {
    const d = Math.hypot(e.tx - e.x, e.ty - e.y);
    if (d > 26 && e.kind !== 'turret') {
      if (e.kind === 'sniper') { e.ang = Math.atan2(e.ty - e.y, e.tx - e.x); return; }   // 저격수는 자리를 지키며 그쪽만 본다
      const f = this.noiseFlow(e.tx, e.ty), x0 = e.x, y0 = e.y;
      if (!this.stepFlow(e, f, e.kind === 'dog' ? 2.6 : 1.5, e.r)) e.look = 999;
      if (Math.hypot(e.x - x0, e.y - y0) > 0.1) e.ang = Math.atan2(e.y - y0, e.x - x0);
    } else if (++e.look > 120) { e.aw = 0; e.look = 0; }
    else e.ang += 0.05;
  }

  /** 교전: 종류별 행동. 시야가 막히면 거리장을 따라 추격한다 */
  private combat(e: GEnemy, dist: number): void {
    const p = this.p, los = this.canSee(e.x, e.y, p.x, p.y), toP = this.angToPlayer(e);
    const chase = (sp: number) => { if (los) { this.move(e, Math.cos(toP) * sp, Math.sin(toP) * sp, e.r); } else this.stepFlow(e, this.playerFlow(), sp, e.r); };
    switch (e.kind) {
      case 'rifle': {
        e.ang = los ? toP : e.ang;
        if (!los) { chase(1.5); break; }
        const want = dist > 270 ? 1 : dist < 150 ? -1 : 0, sp = 1.25;
        if (--e.t <= 0) { e.dir = -e.dir; e.t = 60 + Math.floor(this.rng() * 60); }
        this.move(e, (Math.cos(toP) * want + Math.cos(toP + Math.PI / 2) * e.dir * 0.8) * sp, (Math.sin(toP) * want + Math.sin(toP + Math.PI / 2) * e.dir * 0.8) * sp, e.r);
        if (e.burst > 0) { if (--e.cd <= 0) { this.enemyShot(e, toP + (this.rng() - 0.5) * 0.1, 3.4); e.burst--; e.cd = 7; if (e.burst === 0) e.cd = 120 + Math.floor(this.rng() * 60); } }
        else if (--e.cd <= 0) { e.burst = 3; e.cd = 0; }
        break;
      }
      case 'heavy': {
        e.ang = los ? toP : e.ang;
        if (!los || dist > 200) chase(0.95);
        if (los && --e.cd <= 0) { for (let k = -2; k <= 2; k++) this.enemyShot(e, toP + k * 0.16, 3.1, 1, 4); e.cd = 85; }
        break;
      }
      case 'dog': {
        e.ang = toP; chase(3.1);
        if (dist < e.r + p.r + 5 && --e.cd <= 0) { this.hurt(1, e.x, e.y, 'dog'); e.cd = 45; }
        break;
      }
      case 'charger': {
        if (e.state === 'IDLE') {
          e.ang = toP; chase(1.6);
          if (--e.cd <= 0 && los && dist < 330) { e.state = 'WIND'; e.t = 40; }
        } else if (e.state === 'WIND') {
          if (e.t > 12) { e.lx = p.x; e.ly = p.y; }
          e.ang = Math.atan2(e.ly - e.y, e.lx - e.x);
          if (--e.t <= 0) { e.state = 'DASH'; e.t = 30; }
        } else if (e.state === 'DASH') {
          const a = Math.atan2(e.ly - e.y, e.lx - e.x), x0 = e.x, y0 = e.y;
          this.move(e, Math.cos(a) * 7.8, Math.sin(a) * 7.8, e.r);
          if (Math.hypot(e.x - x0, e.y - y0) < 4) e.t = Math.min(e.t, 1);
          if (!e.styled && Math.hypot(p.x - e.x, p.y - e.y) < e.r + p.r + 8) {
            if (p.rollT > 0) { e.styled = true; this.styles++; this.score += 250; this.emit({ t: 'style', x: p.x, y: p.y }); this.emit({ t: 'slowmo', ms: 220, scale: 0.35 }); this.p.dashBonus = 60; }
            else this.hurt(1, e.x, e.y, 'charger');
          }
          if (--e.t <= 0) { e.state = 'IDLE'; e.cd = 70 + Math.floor(this.rng() * 40); e.styled = false; }
        }
        break;
      }
      case 'sniper': {
        if (!los) { chase(1.1); break; }
        if (e.state === 'IDLE') {
          e.ang = toP;
          const want = dist < 260 ? -1 : 0;
          this.move(e, Math.cos(toP) * want * 1.1, Math.sin(toP) * want * 1.1, e.r);
          if (--e.cd <= 0) { e.state = 'WIND'; e.t = 75; }
        } else {
          if (e.t > 22) { e.lx = p.x; e.ly = p.y; }
          e.ang = Math.atan2(e.ly - e.y, e.lx - e.x);
          if (--e.t <= 0) { this.enemyShot(e, e.ang, 11, 1, 4, 'sniper'); e.state = 'IDLE'; e.cd = 150 + Math.floor(this.rng() * 40); }
        }
        break;
      }
      case 'turret': {
        e.ang = los ? toP : e.ang + 0.02;
        if (los && --e.cd <= 0) { for (let k = -1; k <= 1; k++) this.enemyShot(e, toP + k * 0.3, 2.9, 1, 4); e.cd = 100; }
        break;
      }
      case 'drone': {
        e.ang = toP; e.x += Math.cos(toP) * 2.35; e.y += Math.sin(toP) * 2.35;   // 비행: 벽에 걸리지 않는다
        if (dist < e.r + p.r + 2) { this.hurt(1, e.x, e.y, 'drone'); this.emit({ t: 'boom', x: e.x, y: e.y, r: 28 }); this.enemies.splice(this.enemies.indexOf(e), 1); }
        break;
      }
      case 'tank': {
        e.ang = toP; chase(0.7);
        if (los && --e.cd <= 0) { for (let k = -1; k <= 1; k++) this.enemyShot(e, toP + k * 0.18, 3.6, 1, 5); e.cd = 120; e.t++; if (e.t % 3 === 0) this.zone('tank', p.x + (this.rng() - 0.5) * 90, p.y + (this.rng() - 0.5) * 90, 44, 62); }
        break;
      }
      case 'boss': this.updateBoss(e, toP); break;
    }
  }

  private zone(src: GKind, x: number, y: number, r: number, t: number, dmg = 1): void {
    this.zones.push({ x, y, r, t, max: t, dmg, foe: true, src });
  }

  private updateBoss(e: GEnemy, toP: number): void {
    const p = this.p, hpK = e.hp / e.maxHp, phase = hpK > 0.66 ? 1 : hpK > 0.33 ? 2 : 3;
    const X0 = 70, X1 = WORLD_W - 70, Y0 = 3 * TILE + 70, Y1 = 33 * TILE - 70;
    if (phase > e.phase) {
      e.phase = phase; e.state = 'IDLE'; e.cd = 60;
      this.emit({ t: 'bossPhase', phase }); this.emit({ t: 'shake', v: 12 }); this.emit({ t: 'slowmo', ms: 500, scale: 0.3 });
      if (phase >= 2) for (let k = 0; k < 4; k++) { const d = this.addEnemy('drone', X0 + k * 95, Y0 - 30); d.aw = 2; }
      // 보급: 2페이즈에 SMG, 3페이즈에 체력 (플레이어 근처에 떨어진다)
      const [sx, sy] = this.freeSpot(); this.pickups.push(phase === 2 ? { id: this.nextId++, kind: 'weapon', weapon: 'smg', ammo: WEAPONS.smg.ammo, x: sx, y: sy, t: 0, section: 3 } : { id: this.nextId++, kind: 'heart', x: sx, y: sy, t: 0, section: 3 });
    }
    e.ang = toP;
    if (e.state === 'IDLE') {
      const ty = Math.max(Y0, Math.min(p.y - 330, 12 * TILE)), dx = p.x - e.x;
      e.x += Math.max(-0.9, Math.min(0.9, dx * 0.02)); e.y += (Math.max(Y0, Math.min(Y1, ty)) - e.y) * 0.03;
      const rate = phase === 3 ? 7 : 9;
      e.t++;
      if (e.t % 120 < 40 && e.t % rate === 0) this.enemyShot(e, toP + (this.rng() - 0.5) * 0.22 + 0.2 * Math.sin(e.t * 0.1), 3.6, 1, 4);
      if (--e.cd <= 0) {
        for (let k = -2; k <= 2; k++) this.enemyShot(e, Math.PI / 2 + k * 0.4, 2.6, 1, 5);
        e.cd = phase === 1 ? 130 : 110;
        if (phase >= 3) for (let k = 0; k < 2; k++) this.zone('boss', p.x + (this.rng() - 0.5) * 140, p.y + (this.rng() - 0.5) * 140, 48, 70);
        if (phase >= 2 && this.rng() < 0.5) { e.state = 'WIND'; e.t = 55; }
      }
    } else if (e.state === 'WIND') {
      if (e.t > 14) { e.lx = p.x; e.ly = p.y; }
      if (--e.t <= 0) { e.state = 'DASH'; e.t = 36; }
    } else if (e.state === 'DASH') {
      const a = Math.atan2(e.ly - e.y, e.lx - e.x), x0 = e.x, y0 = e.y;
      e.x += Math.cos(a) * 8.5; e.y += Math.sin(a) * 8.5;
      e.x = Math.max(X0, Math.min(X1, e.x)); e.y = Math.max(Y0, Math.min(Y1, e.y));
      if (Math.hypot(p.x - e.x, p.y - e.y) < e.r + p.r - 10) { if (p.rollT > 0) { if (!e.styled) { e.styled = true; this.styles++; this.score += 500; this.emit({ t: 'style', x: p.x, y: p.y }); this.emit({ t: 'slowmo', ms: 260, scale: 0.35 }); } } else this.hurt(1, e.x, e.y, 'boss'); }
      const stuck = Math.hypot(e.x - x0, e.y - y0) < 4;
      if (--e.t <= 0 || stuck) { e.state = 'STUN'; e.t = 110; e.styled = false; this.emit({ t: 'shake', v: 10 }); this.emit({ t: 'boom', x: e.x, y: e.y, r: 70 }); for (let k = 0; k < 8; k++) this.enemyShot(e, (k / 8) * Math.PI * 2 + 0.2, 2.4, 1, 4); }
    }
  }

  /** 플레이어 근처의 비어 있는 보급 자리 */
  private freeSpot(): [number, number] {
    const p = this.p;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + 0.7, d = 70 + (i % 3) * 25, x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (blocksMove(tileAt(this.tiles, x, y)) || this.cover.some(c => !c.dead && Math.abs(c.x - x) < c.w / 2 + 14 && Math.abs(c.y - y) < c.h / 2 + 14)) continue;
      if (this.pickups.some(k => Math.hypot(k.x - x, k.y - y) < 40)) continue;
      return [x, y];
    }
    return [p.x, p.y + 60];
  }

  // ---------------------------------------------------------------- 탄
  private updateBullets(): void {
    const p = this.p;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const sp = Math.hypot(b.vx, b.vy), sub = sp > 9 ? Math.ceil(sp / 9) : 1;
      let gone = false;
      for (let s = 0; s < sub && !gone; s++) {
        b.x += b.vx / sub; b.y += b.vy / sub;
        const t = tileAt(this.tiles, b.x, b.y);
        if (blocksBullet(t)) { this.emit({ t: 'wallhit', x: b.x - b.vx / sub, y: b.y - b.vy / sub, ang: Math.atan2(b.vy, b.vx) }); gone = true; break; }
        const c = this.blocked(b.x, b.y);
        if (c) { if (c.kind === 'barrel') this.breakCover(c); if (!(b.friendly && b.pierce > 0 && c.kind === 'barrel')) { this.emit({ t: 'wallhit', x: b.x, y: b.y, ang: Math.atan2(b.vy, b.vx) }); gone = true; } break; }
        if (b.friendly) {
          for (const e of this.enemies.slice()) {
            if (b.hit.includes(e.id)) continue;
            if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < (e.r + b.r) ** 2) {
              this.damage(e, b.dmg * (e.state === 'STUN' ? 1.6 : 1), b.x, b.y, Math.atan2(b.vy, b.vx), b.w === 'shotgun');
              if (b.kind === 'throw') { e.state = 'STUN'; e.t = Math.max(e.t, 70); this.emit({ t: 'boom', x: b.x, y: b.y, r: 34 }); }
              b.hit.push(e.id);
              if (b.pierce-- <= 0) { gone = true; break; }
            }
          }
        } else if (p.invuln <= 0 && (p.x - b.x) ** 2 + (p.y - b.y) ** 2 < (p.r + b.r) ** 2) {
          this.hurt(b.dmg, b.x, b.y, b.src); gone = true;
        }
      }
      if (gone || --b.life <= 0) this.bullets.splice(i, 1);
    }
  }
  private blocked(x: number, y: number): GCover | null {
    for (const c of this.cover) if (!c.dead && Math.abs(x - c.x) < c.w / 2 && Math.abs(y - c.y) < c.h / 2) return c;
    return null;
  }

  private damage(e: GEnemy, dmg: number, x: number, y: number, ang: number, shotgun = false): void {
    e.hp -= dmg; e.flash = 4;
    if (e.aw < 2) { e.aw = 2; this.emit({ t: 'alert', x: e.x, y: e.y }); }
    const kill = e.hp <= 0;
    this.emit({ t: 'hit', x, y, dmg, kill, kind: e.kind, ang });
    if (!kill && shotgun && e.kind !== 'boss' && e.kind !== 'tank' && e.kind !== 'turret') this.move(e, Math.cos(ang) * 4, Math.sin(ang) * 4, e.r);   // 샷건 넉백
    if (kill) this.killEnemy(e, ang);
  }

  private killEnemy(e: GEnemy, ang: number): void {
    const i = this.enemies.indexOf(e); if (i < 0) return;
    this.enemies.splice(i, 1); this.kills++;
    this.combo++; this.comboT = GROUND.comboFrames; this.maxCombo = Math.max(this.maxCombo, this.combo);
    const mult = 1 + 0.2 * Math.min(this.combo - 1, 10), pts = Math.round(ENEMY_DEF[e.kind].pts * mult);
    this.score += pts;
    this.emit({ t: 'kill', x: e.x, y: e.y, kind: e.kind, pts, combo: this.combo, ang });
    if (e.kind === 'tank' || e.kind === 'boss') { this.emit({ t: 'boom', x: e.x, y: e.y, r: e.r * 2.2 }); this.emit({ t: 'shake', v: 14 }); this.emit({ t: 'hitstop', frames: 8 }); }
    else if (e.kind !== 'drone') this.emit({ t: 'hitstop', frames: 2 });
    if (e.kind !== 'drone' && e.kind !== 'turret' && e.kind !== 'tank') {   // 시체는 총알 방향으로 미끄러지며 바닥에 남는다
      const k = e.kind === 'boss' ? 0 : 5 + this.rng() * 2.5;
      this.corpses.push({ id: this.nextId++, kind: e.kind, x: e.x, y: e.y, a: ang + (this.rng() - 0.5) * 0.6, vx: Math.cos(ang) * k, vy: Math.sin(ang) * k, section: e.section });
    }
    const dr = DROPS[e.kind];   // 무기를 떨군다: 바닥에서 주워 쓸 수 있다
    if (dr && this.rng() < dr.p) {
      const ammo = Math.ceil(WEAPONS[dr.w].ammo * (0.35 + this.rng() * 0.3));
      this.pickups.push({ id: this.nextId++, kind: 'weapon', weapon: dr.w, ammo, x: e.x, y: e.y, t: 0, section: e.section, dropped: true });
      this.emit({ t: 'drop', x: e.x, y: e.y, weapon: dr.w });
    }
    if (e.kind === 'boss') {
      this.enemies = this.enemies.filter(b => b.kind !== 'drone');
      for (const b of this.bullets) if (!b.friendly) b.life = 1;
    }
  }
  private updateCorpses(): void {
    for (const c of this.corpses) {
      if (Math.abs(c.vx) + Math.abs(c.vy) < 0.15) { c.vx = 0; c.vy = 0; continue; }
      const nx = c.x + c.vx, ny = c.y + c.vy;
      if (blocksMove(tileAt(this.tiles, nx, ny))) { c.vx = 0; c.vy = 0; continue; }
      c.x = nx; c.y = ny; c.vx *= 0.86; c.vy *= 0.86;
    }
  }

  private hurt(dmg: number, x: number, y: number, by?: GKind): void {
    const p = this.p; if (p.invuln > 0 || (this.state as string) === 'DEAD') return;
    p.hp -= dmg; p.invuln = GROUND.hurtInvuln; this.combo = 0; this.comboT = 0;
    this.emit({ t: 'hurt', x, y, by }); this.emit({ t: 'shake', v: 9 }); this.emit({ t: 'hitstop', frames: 4 });
  }

  // ---------------------------------------------------------------- 폭발/구역/엄폐물/아이템
  private explode(x: number, y: number, r: number, dmg: number): void {
    this.emit({ t: 'boom', x, y, r }); this.emit({ t: 'shake', v: Math.min(12, 4 + r / 12) });
    if (dmg > 0) for (const e of this.enemies.slice()) if (Math.hypot(e.x - x, e.y - y) < r + e.r) this.damage(e, dmg, e.x, e.y, Math.atan2(e.y - y, e.x - x));
    for (const c of this.cover) if (!c.dead && c.kind === 'barrel' && Math.hypot(c.x - x, c.y - y) < r + 8) this.breakCover(c);
  }
  private breakCover(c: GCover): void {
    if (c.dead || c.kind !== 'barrel') return;
    c.dead = true; this.emit({ t: 'coverBreak', x: c.x, y: c.y });
    this.emit({ t: 'boom', x: c.x, y: c.y, r: 70 }); this.emit({ t: 'shake', v: 10 }); this.emit({ t: 'hitstop', frames: 3 });
    this.makeNoise(c.x, c.y, 500);
    for (const e of this.enemies.slice()) if (Math.hypot(e.x - c.x, e.y - c.y) < 70 + e.r) this.damage(e, 8, e.x, e.y, Math.atan2(e.y - c.y, e.x - c.x));
    if (Math.hypot(this.p.x - c.x, this.p.y - c.y) < 62) this.hurt(1, c.x, c.y);
    for (const o of this.cover) if (!o.dead && o.kind === 'barrel' && Math.hypot(o.x - c.x, o.y - c.y) < 90) this.breakCover(o);
  }
  private updateZones(): void {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      if (--z.t > 0) continue;
      this.zones.splice(i, 1);
      this.emit({ t: 'boom', x: z.x, y: z.y, r: z.r }); this.emit({ t: 'shake', v: 6 });
      if (Math.hypot(this.p.x - z.x, this.p.y - z.y) < z.r) this.hurt(z.dmg, z.x, z.y, z.src);
      for (const c of this.cover) if (!c.dead && c.kind === 'barrel' && Math.hypot(c.x - z.x, c.y - z.y) < z.r + 8) this.breakCover(c);
    }
  }
  /** 아이템: 체력은 닿으면, 무기는 (권총/빈 총일 때) 닿으면 줍고 그 외에는 줍기 입력 */
  private updatePickups(inp: GInput): void {
    const p = this.p;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i]; k.t++;
      if (Math.hypot(p.x - k.x, p.y - k.y) > 24) continue;
      if (k.kind === 'heart') { if (p.hp >= p.maxHp) continue; p.hp = Math.min(p.maxHp, p.hp + 2); this.emit({ t: 'pickup', what: 'heart', x: k.x, y: k.y }); this.pickups.splice(i, 1); continue; }
      if (p.pickCd > 0) continue;
      const free = p.weapon === 'pistol' || p.ammo <= 0;
      if (!free && !inp.pickup) continue;
      if (!free && p.weapon !== 'pistol') {   // 들고 있던 총은 그 자리에 떨어진다 (남은 탄 그대로)
        this.pickups.push({ id: this.nextId++, kind: 'weapon', weapon: p.weapon, ammo: p.ammo, x: k.x, y: k.y, t: 0, section: k.section, dropped: true });
      }
      p.weapon = k.weapon!; p.ammo = k.ammo ?? WEAPONS[p.weapon].ammo; p.pickCd = 30;
      this.emit({ t: 'pickup', what: 'weapon', x: k.x, y: k.y }); this.pickups.splice(i, 1);
    }
  }
  /** 가까이에 줍을 수 있는 무기가 있는가 (모바일 버튼 표시용) */
  nearWeapon(): GPickup | null { return this.pickups.find(k => k.kind === 'weapon' && Math.hypot(this.p.x - k.x, this.p.y - k.y) < 30) ?? null; }

  /** 결과: 본편으로 돌아갈 때 쓰는 보상 정산 */
  result(): { win: boolean; score: number; kills: number; rooms: number; maxCombo: number; styles: number; hpLeft: number } {
    return { win: this.state === 'WIN', score: this.score, kills: this.kills, rooms: this.reached + (this.state === 'WIN' ? 1 : 0), maxCombo: this.maxCombo, styles: this.styles, hpLeft: this.p.hp };
  }
}
