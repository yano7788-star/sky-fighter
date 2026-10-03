import { createRng, type Rng } from './rng';

/**
 * 지상전 「강하」 규칙 (순수 TS, Phaser 무관). 한 틱 = 1/60초. 트윈스틱 탑다운 슈터.
 * 룸 3개(웨이브 방식) + 보스. 좌표는 공중전과 같은 논리 해상도(450×800).
 * 연출은 events 로 내보내고 렌더/사운드는 씬이 처리한다.
 */
export const GW = 450, GH = 800;
export const ARENA = { x0: 22, x1: 428, y0: 78, y1: 760 };   // 이동 가능 영역 (벽 안쪽)
export const DOOR = { x: 225, w: 64, y: 70 };                  // 위쪽 출구

export type WeaponId = 'pistol' | 'shotgun' | 'smg' | 'rail';
export type GKind = 'rifle' | 'charger' | 'sniper' | 'turret' | 'drone' | 'tank' | 'boss';
export type CoverKind = 'barrier' | 'crate' | 'stack' | 'crates2' | 'barrel';

export const WEAPONS: Record<WeaponId, { name: string; dmg: number; cd: number; speed: number; spread: number; pellets: number; ammo: number; pierce: number; kick: number }> = {
  pistol:  { name: '권총',       dmg: 1.25, cd: 13, speed: 10,  spread: 0.03, pellets: 1, ammo: Infinity, pierce: 0, kick: 0.6 },
  shotgun: { name: '샷건',       dmg: 0.95, cd: 38, speed: 9,   spread: 0.55, pellets: 7, ammo: 9,        pierce: 0, kick: 2.2 },
  smg:     { name: 'SMG',        dmg: 0.62, cd: 5,  speed: 11,  spread: 0.11, pellets: 1, ammo: 110,      pierce: 0, kick: 0.5 },
  rail:    { name: '레일 라이플', dmg: 7,    cd: 58, speed: 20,  spread: 0,    pellets: 1, ammo: 9,        pierce: 9, kick: 3 },
};

export const GROUND = {
  hp: 4, speed: 3.1, radius: 8,
  rollFrames: 18, rollInvuln: 24, rollSpeed: 8.2, rollCd: 66,
  hurtInvuln: 60, comboFrames: 150, grenadeCd: 40,
  tickSpawn: 40,
} as const;

export interface GroundOpts { seed: number; pilot: 0 | 1 | 2; dmgMult: number; rateMult: number; maxHp: number; grenades: number; assist: boolean }
export const DEFAULT_GROUND_OPTS: GroundOpts = { seed: 1, pilot: 0, dmgMult: 1, rateMult: 1, maxHp: GROUND.hp, grenades: 2, assist: true };

export interface GInput { mx: number; my: number; ax: number; ay: number; fire: boolean; roll: boolean; grenade: boolean }
export const NO_INPUT: GInput = { mx: 0, my: 0, ax: 0, ay: 0, fire: false, roll: false, grenade: false };

export interface GPlayer {
  x: number; y: number; r: number; hp: number; maxHp: number;
  aim: number;                       // 조준 각도 (0 = 오른쪽, π/2 = 아래)
  face: 'up' | 'down';               // 스프라이트 방향 (조준 기준)
  rollT: number; rollCd: number; rdx: number; rdy: number; invuln: number;
  fireCd: number; weapon: WeaponId; ammo: number; grenades: number; grenadeCd: number;
  kick: number; walk: number; dashBonus: number;   // dashBonus: 구르기 직후 첫 사격 보너스 남은 프레임
}
export interface GEnemy {
  id: number; kind: GKind; x: number; y: number; r: number; hp: number; maxHp: number;
  state: 'SPAWN' | 'IDLE' | 'WIND' | 'DASH' | 'STUN';
  t: number; cd: number; ang: number; lx: number; ly: number; dir: number; burst: number; flash: number; phase: number; styled: boolean;
}
export interface GBullet { x: number; y: number; vx: number; vy: number; r: number; dmg: number; friendly: boolean; pierce: number; hit: number[]; life: number; kind?: 'normal' | 'throw' | 'sniper'; src?: GKind }
export interface GCover { id: number; kind: CoverKind; x: number; y: number; w: number; h: number; hp: number; dead: boolean }
export interface GZone { x: number; y: number; r: number; t: number; max: number; dmg: number; foe: boolean; src?: GKind }   // 폭발 예고(박격포/수류탄)
export interface GPickup { id: number; kind: 'heart' | 'weapon'; weapon?: WeaponId; x: number; y: number; t: number }
export interface GGrenade { x: number; y: number; sx: number; sy: number; tx: number; ty: number; t: number; max: number }

export type GEvent =
  | { t: 'shot'; x: number; y: number; weapon: WeaponId; ang: number }
  | { t: 'hit'; x: number; y: number; dmg: number; kill: boolean; kind: GKind }
  | { t: 'hurt'; x: number; y: number; by?: GKind }
  | { t: 'roll'; x: number; y: number }
  | { t: 'boom'; x: number; y: number; r: number }
  | { t: 'kill'; x: number; y: number; kind: GKind; pts: number; combo: number }
  | { t: 'style'; x: number; y: number }
  | { t: 'pickup'; what: 'heart' | 'weapon' | 'ammo'; x: number; y: number }
  | { t: 'door' }
  | { t: 'room'; n: number; boss: boolean }
  | { t: 'cleared'; n: number }
  | { t: 'shake'; v: number }
  | { t: 'hitstop'; frames: number }
  | { t: 'slowmo'; ms: number; scale: number }
  | { t: 'throw'; x: number; y: number }
  | { t: 'bossPhase'; phase: number }
  | { t: 'coverBreak'; x: number; y: number }
  | { t: 'win' } | { t: 'dead' };

interface Spawn { k: GKind; n: number; at?: [number, number][] }
interface RoomDef { cover: [CoverKind, number, number][]; waves: Spawn[][]; reward: WeaponId | null; heal: boolean }

const COVER_SIZE: Record<CoverKind, [number, number]> = { barrier: [78, 26], crate: [42, 31], stack: [27, 47], crates2: [36, 44], barrel: [18, 28] };
export const ROOMS: RoomDef[] = [
  { cover: [['barrier', 225, 430], ['crate', 105, 540], ['crate', 345, 540], ['crates2', 110, 300], ['stack', 345, 300], ['barrel', 60, 440]],
    waves: [[{ k: 'rifle', n: 3 }], [{ k: 'rifle', n: 4 }]], reward: 'shotgun', heal: false },
  { cover: [['barrier', 150, 460], ['barrier', 300, 460], ['crates2', 225, 320], ['barrel', 95, 360], ['barrel', 355, 360], ['crate', 60, 600], ['crate', 390, 600]],
    waves: [[{ k: 'rifle', n: 3 }, { k: 'charger', n: 1 }], [{ k: 'turret', n: 2, at: [[100, 170], [350, 170]] }, { k: 'charger', n: 2 }], [{ k: 'drone', n: 7 }]], reward: 'smg', heal: true },
  { cover: [['stack', 120, 400], ['stack', 330, 400], ['barrier', 225, 560], ['crates2', 225, 280], ['barrel', 60, 240], ['barrel', 390, 240], ['crate', 110, 620], ['crate', 340, 620]],
    waves: [[{ k: 'sniper', n: 2 }, { k: 'rifle', n: 3 }], [{ k: 'drone', n: 8 }, { k: 'charger', n: 2 }], [{ k: 'tank', n: 1 }]], reward: 'rail', heal: true },
  { cover: [['crate', 70, 330], ['crate', 380, 330], ['barrier', 160, 580], ['barrier', 290, 580], ['barrel', 55, 500], ['barrel', 395, 500]],
    waves: [[{ k: 'boss', n: 1 }]], reward: null, heal: false },
];
export const ROOM_COUNT = ROOMS.length;

const ENEMY_DEF: Record<GKind, { hp: number; r: number; pts: number }> = {
  rifle: { hp: 3, r: 13, pts: 100 }, charger: { hp: 6, r: 15, pts: 160 }, sniper: { hp: 3, r: 12, pts: 220 },
  turret: { hp: 11, r: 24, pts: 220 }, drone: { hp: 1, r: 10, pts: 40 }, tank: { hp: 55, r: 46, pts: 900 }, boss: { hp: 160, r: 62, pts: 4000 },
};

export class GroundSim {
  rng: Rng;
  opts: GroundOpts;
  frame = 0;
  state: 'ROOM' | 'CLEAR' | 'TRANSIT' | 'WIN' | 'DEAD' = 'ROOM';
  room = 0;                          // 0-based
  wave = 0;
  p!: GPlayer;
  enemies: GEnemy[] = []; bullets: GBullet[] = []; cover: GCover[] = []; zones: GZone[] = []; pickups: GPickup[] = []; grenadeList: GGrenade[] = [];
  events: GEvent[] = [];
  score = 0; kills = 0; combo = 0; comboT = 0; time = 0; maxCombo = 0; styles = 0;
  doorOpen = false; transitT = 0; waveDelay = 0;
  private nextId = 1;

  constructor(opts: Partial<GroundOpts> = {}) {
    this.opts = { ...DEFAULT_GROUND_OPTS, ...opts };
    this.rng = createRng(this.opts.seed + 7919);
    this.p = {
      x: GW / 2, y: ARENA.y1 - 30, r: GROUND.radius, hp: this.opts.maxHp, maxHp: this.opts.maxHp, aim: -Math.PI / 2, face: 'up',
      rollT: 0, rollCd: 0, rdx: 0, rdy: 0, invuln: 0, fireCd: 0, weapon: 'pistol', ammo: Infinity, grenades: this.opts.grenades, grenadeCd: 0, kick: 0, walk: 0, dashBonus: 0,
    };
    this.enterRoom(0);
  }

  private emit(e: GEvent): void { this.events.push(e); }
  drain(): GEvent[] { const e = this.events; this.events = []; return e; }
  get def(): RoomDef { return ROOMS[this.room]; }
  get isBossRoom(): boolean { return this.room === ROOMS.length - 1; }
  get boss(): GEnemy | undefined { return this.enemies.find(e => e.kind === 'boss'); }

  // ---------------------------------------------------------------- 룸
  private enterRoom(n: number): void {
    this.room = n; this.wave = 0; this.state = 'ROOM'; this.doorOpen = false; this.waveDelay = 30;
    this.enemies.length = 0; this.bullets.length = 0; this.zones.length = 0; this.pickups.length = 0; this.grenadeList.length = 0;
    this.cover = this.def.cover.map(([kind, x, y]) => { const [w, h] = COVER_SIZE[kind]; return { id: this.nextId++, kind, x, y, w, h, hp: kind === 'barrel' ? 1 : 999, dead: false }; });
    this.p.x = GW / 2; this.p.y = ARENA.y1 - 30; this.p.rollT = 0; this.p.invuln = 60;
    this.emit({ t: 'room', n, boss: this.isBossRoom });
  }

  /** 사망 후 이어하기: 이 룸을 처음부터 (체력 회복) */
  revive(): void {
    this.p.hp = Math.max(2, Math.ceil(this.p.maxHp / 2)); this.p.invuln = 120;
    this.state = 'ROOM'; this.combo = 0;
    this.enterRoom(this.room);
  }

  private spawnWave(): void {
    const list = this.def.waves[this.wave]; if (!list) return;
    for (const s of list) {
      for (let i = 0; i < s.n; i++) {
        let x: number, y: number;
        if (s.at && s.at[i]) [x, y] = s.at[i];
        else if (s.k === 'boss') { x = GW / 2; y = 190; }
        else if (s.k === 'tank') { x = GW / 2; y = 150; }
        else if (s.k === 'drone') { x = ARENA.x0 + 20 + this.rng() * (ARENA.x1 - ARENA.x0 - 40); y = ARENA.y0 + 10 + this.rng() * 40; }
        else if (s.k === 'sniper') { x = i % 2 ? 360 : 90; y = 120 + this.rng() * 30; }
        else { x = 60 + this.rng() * 330; y = 110 + this.rng() * 120; }
        this.addEnemy(s.k, x, y);
      }
    }
  }

  private addEnemy(kind: GKind, x: number, y: number): GEnemy {
    const d = ENEMY_DEF[kind];
    const e: GEnemy = { id: this.nextId++, kind, x, y, r: d.r, hp: d.hp, maxHp: d.hp, state: 'SPAWN', t: GROUND.tickSpawn, cd: 40 + Math.floor(this.rng() * 50), ang: Math.PI / 2, lx: 0, ly: 0, dir: this.rng() < 0.5 ? -1 : 1, burst: 0, flash: 0, phase: 1, styled: false };
    this.enemies.push(e);
    return e;
  }

  // ---------------------------------------------------------------- 틱
  step(inp: GInput): void {
    if (this.state === 'WIN' || this.state === 'DEAD') return;
    this.frame++; this.time++;
    const p = this.p;
    if (this.comboT > 0 && --this.comboT === 0) this.combo = 0;
    if (p.invuln > 0) p.invuln--;
    if (p.fireCd > 0) p.fireCd--;
    if (p.rollCd > 0) p.rollCd--;
    if (p.grenadeCd > 0) p.grenadeCd--;
    if (p.dashBonus > 0) p.dashBonus--;
    p.kick *= 0.8;

    if (this.state === 'TRANSIT') {
      if (--this.transitT <= 0) { this.enterRoom(this.room + 1); }
      return;
    }
    this.updatePlayer(inp);
    this.updateGrenades();
    this.updateEnemies();
    this.updateBullets();
    this.updateZones();
    this.updatePickups();
    this.updateRoom();
    if (p.hp <= 0 && (this.state as string) !== 'DEAD') { this.state = 'DEAD'; this.emit({ t: 'dead' }); }
  }

  private updateRoom(): void {
    if (this.state === 'ROOM') {
      if (this.enemies.length === 0) {
        if (this.waveDelay > 0) { this.waveDelay--; return; }
        if (this.wave < this.def.waves.length) { this.spawnWave(); this.wave++; this.waveDelay = 50; }
        else this.clearRoom();
      }
    } else if (this.state === 'CLEAR') {
      const p = this.p;
      if (p.y < DOOR.y + 20 && Math.abs(p.x - DOOR.x) < DOOR.w / 2) { this.state = 'TRANSIT'; this.transitT = 36; }
    }
  }

  private clearRoom(): void {
    const d = this.def;
    this.emit({ t: 'cleared', n: this.room });
    if (this.isBossRoom) { this.state = 'WIN'; this.emit({ t: 'win' }); this.emit({ t: 'slowmo', ms: 900, scale: 0.25 }); return; }
    this.state = 'CLEAR'; this.doorOpen = true; this.emit({ t: 'door' });
    if (d.reward) { const [x, y] = this.freeSpot(); this.pickups.push({ id: this.nextId++, kind: 'weapon', weapon: d.reward, x, y, t: 0 }); }
    if (d.heal || this.p.hp < this.p.maxHp - 1) { const [x, y] = this.freeSpot(); this.pickups.push({ id: this.nextId++, kind: 'heart', x, y, t: 0 }); }
    this.score += 300 + 150 * this.room;
  }

  /** 엄폐물·다른 아이템과 겹치지 않는 아이템 자리 */
  private freeSpot(): [number, number] {
    const cand: [number, number][] = [[225, 360], [150, 380], [300, 380], [225, 520], [90, 500], [360, 500], [225, 230], [120, 230], [330, 230]];
    for (const [x, y] of cand) if (!this.cover.some(c => !c.dead && Math.abs(c.x - x) < c.w / 2 + 34 && Math.abs(c.y - y) < c.h / 2 + 34) && !this.pickups.some(k => Math.hypot(k.x - x, k.y - y) < 60)) return [x, y];
    return [GW / 2, 360];
  }

  // ---------------------------------------------------------------- 플레이어
  private updatePlayer(inp: GInput): void {
    const p = this.p, o = this.opts;
    // 이동
    let mx = inp.mx, my = inp.my; const m = Math.hypot(mx, my); if (m > 1) { mx /= m; my /= m; }
    if (inp.roll && p.rollT <= 0 && p.rollCd <= 0) {
      const l = Math.hypot(mx, my) || 0, dx = l > 0.1 ? mx / l : Math.cos(p.aim), dy = l > 0.1 ? my / l : Math.sin(p.aim);
      p.rollT = GROUND.rollFrames; p.rdx = dx; p.rdy = dy; p.invuln = Math.max(p.invuln, GROUND.rollInvuln);
      p.rollCd = Math.round(GROUND.rollCd * (o.pilot === 0 ? 0.8 : 1)); p.dashBonus = 0;
      this.emit({ t: 'roll', x: p.x, y: p.y });
    }
    if (p.rollT > 0) {
      p.rollT--; this.move(p, p.rdx * GROUND.rollSpeed, p.rdy * GROUND.rollSpeed, p.r);
      if (p.rollT === 0) p.dashBonus = 40;   // 구르기 직후 첫 사격 강화 (대시-킬)
    } else {
      this.move(p, mx * GROUND.speed, my * GROUND.speed, p.r);
      if (m > 0.1) p.walk += 0.28;
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
    p.aim = aim; p.face = Math.sin(aim) < -0.25 ? 'up' : 'down';

    // 사격 (구르는 중에는 불가)
    if (inp.fire && p.rollT <= 0 && p.fireCd <= 0) this.shoot();
    // 수류탄
    if (inp.grenade && p.grenades > 0 && p.grenadeCd <= 0) {
      p.grenades--; p.grenadeCd = GROUND.grenadeCd;
      const dist = 170, tx = Math.max(ARENA.x0, Math.min(ARENA.x1, p.x + Math.cos(p.aim) * dist)), ty = Math.max(ARENA.y0, Math.min(ARENA.y1, p.y + Math.sin(p.aim) * dist));
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
      this.bullets.push({ x: p.x + Math.cos(p.aim) * 14, y: p.y + Math.sin(p.aim) * 14, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: p.weapon === 'rail' ? 5 : 3, dmg: w.dmg * o.dmgMult * bonus * pil, friendly: true, pierce, hit: [], life: 70 });
    }
    p.kick = w.kick;
    this.emit({ t: 'shot', x: p.x, y: p.y, weapon: p.weapon, ang: p.aim });
    if (p.weapon !== 'pistol' && --p.ammo <= 0) this.throwWeapon();
  }

  /** 탄이 떨어지면 총을 던진다 (엔터 더 건전 오마주): 적에게 큰 피해 + 스턴 */
  private throwWeapon(): void {
    const p = this.p;
    this.bullets.push({ x: p.x, y: p.y, vx: Math.cos(p.aim) * 8, vy: Math.sin(p.aim) * 8, r: 7, dmg: 9 * this.opts.dmgMult, friendly: true, pierce: 0, hit: [], life: 45, kind: 'throw' });
    p.weapon = 'pistol'; p.ammo = Infinity; this.emit({ t: 'throw', x: p.x, y: p.y });
  }

  private nearestEnemy(): GEnemy | null {
    let best: GEnemy | null = null, bd = 1e9;
    for (const e of this.enemies) { if (e.state === 'SPAWN') continue; const d = (e.x - this.p.x) ** 2 + (e.y - this.p.y) ** 2; if (d < bd) { bd = d; best = e; } }
    return best;
  }
  private nearestInCone(aim: number, cone: number): GEnemy | null {
    let best: GEnemy | null = null, bd = 1e9;
    for (const e of this.enemies) {
      if (e.state === 'SPAWN') continue;
      let da = Math.atan2(e.y - this.p.y, e.x - this.p.x) - aim; da = Math.atan2(Math.sin(da), Math.cos(da));
      const d = Math.hypot(e.x - this.p.x, e.y - this.p.y);
      if (Math.abs(da) < cone && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  private updateGrenades(): void {
    for (let i = this.grenadeList.length - 1; i >= 0; i--) {
      const g = this.grenadeList[i]; g.t++;
      const k = g.t / g.max; g.x = g.sx + (g.tx - g.sx) * k; g.y = g.sy + (g.ty - g.sy) * k;
      if (g.t >= g.max) { this.grenadeList.splice(i, 1); this.explode(g.tx, g.ty, 58, 6 * this.opts.dmgMult); }
    }
  }

  // ---------------------------------------------------------------- 이동·충돌
  private move(o: { x: number; y: number }, dx: number, dy: number, r: number): void {
    o.x += dx; o.y += dy;
    o.x = Math.max(ARENA.x0 + r, Math.min(ARENA.x1 - r, o.x));
    o.y = Math.max(ARENA.y0 + r, Math.min(ARENA.y1 - r, o.y));
    for (const c of this.cover) {
      if (c.dead) continue;
      const hx = c.w / 2, hy = c.h / 2;
      const nx = Math.max(c.x - hx, Math.min(o.x, c.x + hx)), ny = Math.max(c.y - hy, Math.min(o.y, c.y + hy));
      const ddx = o.x - nx, ddy = o.y - ny, d2 = ddx * ddx + ddy * ddy;
      if (d2 >= r * r) continue;
      if (d2 > 1e-6) { const d = Math.sqrt(d2), push = r - d + 0.01; o.x += (ddx / d) * push; o.y += (ddy / d) * push; }
      else {   // 중심이 사각형 안으로 파고든 경우: 가장 가까운 면 바깥으로 밀어낸다
        const l = o.x - (c.x - hx), rr = c.x + hx - o.x, t = o.y - (c.y - hy), bt = c.y + hy - o.y, m = Math.min(l, rr, t, bt);
        if (m === l) o.x = c.x - hx - r - 0.01; else if (m === rr) o.x = c.x + hx + r + 0.01; else if (m === t) o.y = c.y - hy - r - 0.01; else o.y = c.y + hy + r + 0.01;
      }
    }
  }
  private blocked(x: number, y: number): GCover | null {
    for (const c of this.cover) if (!c.dead && Math.abs(x - c.x) < c.w / 2 && Math.abs(y - c.y) < c.h / 2) return c;
    return null;
  }

  // ---------------------------------------------------------------- 적
  private enemyShot(e: GEnemy, ang: number, speed: number, dmg = 1, r = 3.5, kind: GBullet['kind'] = 'normal'): void {
    this.bullets.push({ x: e.x + Math.cos(ang) * (e.r * 0.8), y: e.y + Math.sin(ang) * (e.r * 0.8), vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r, dmg, friendly: false, pierce: 0, hit: [], life: 220, kind, src: e.kind });
  }
  private angToPlayer(e: GEnemy): number { return Math.atan2(this.p.y - e.y, this.p.x - e.x); }

  private updateEnemies(): void {
    const p = this.p;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.flash > 0) e.flash--;
      if (e.state === 'SPAWN') { if (--e.t <= 0) e.state = 'IDLE'; continue; }
      const dist = Math.hypot(p.x - e.x, p.y - e.y), toP = this.angToPlayer(e);
      switch (e.kind) {
        case 'rifle': {
          e.ang = toP;
          const want = dist > 280 ? 1 : dist < 150 ? -1 : 0, sp = 1.25;
          if (--e.t <= 0) { e.dir = -e.dir; e.t = 60 + Math.floor(this.rng() * 60); }   // 무작위 좌우 전환
          const mx = Math.cos(toP) * want + Math.cos(toP + Math.PI / 2) * e.dir * 0.8, my = Math.sin(toP) * want + Math.sin(toP + Math.PI / 2) * e.dir * 0.8;
          this.move(e, mx * sp, my * sp, e.r);
          if (e.burst > 0) { if (--e.cd <= 0) { this.enemyShot(e, toP + (this.rng() - 0.5) * 0.1, 3.3); e.burst--; e.cd = 7; if (e.burst === 0) e.cd = 130 + Math.floor(this.rng() * 60); } }
          else if (--e.cd <= 0) { e.burst = 3; e.cd = 0; }
          break;
        }
        case 'charger': {
          e.ang = toP;
          if (e.state === 'IDLE') {
            this.move(e, Math.cos(toP) * 1.5, Math.sin(toP) * 1.5, e.r);
            if (--e.cd <= 0 && dist < 330) { e.state = 'WIND'; e.t = 40; }
          } else if (e.state === 'WIND') {
            if (e.t > 12) { e.lx = p.x; e.ly = p.y; }   // 마지막 12프레임은 조준 고정 (구르기로 피할 틈)
            e.ang = Math.atan2(e.ly - e.y, e.lx - e.x);
            if (--e.t <= 0) { e.state = 'DASH'; e.t = 30; }
          } else if (e.state === 'DASH') {
            const a = Math.atan2(e.ly - e.y, e.lx - e.x), x0 = e.x, y0 = e.y;
            this.move(e, Math.cos(a) * 7.8, Math.sin(a) * 7.8, e.r);
            if (Math.hypot(e.x - x0, e.y - y0) < 4) e.t = Math.min(e.t, 1);   // 벽/엄폐물에 막힘
            if (!e.styled && Math.hypot(p.x - e.x, p.y - e.y) < e.r + p.r + 8) {
              if (p.rollT > 0) { e.styled = true; this.styles++; this.score += 250; this.emit({ t: 'style', x: p.x, y: p.y }); this.emit({ t: 'slowmo', ms: 220, scale: 0.35 }); this.p.dashBonus = 60; }
              else this.hurt(1, e.x, e.y, 'charger');
            }
            if (--e.t <= 0) { e.state = 'STUN'; e.t = 55; e.styled = false; }
          } else { if (--e.t <= 0) { e.state = 'IDLE'; e.cd = 60 + Math.floor(this.rng() * 40); } }
          break;
        }
        case 'sniper': {
          e.ang = toP;
          if (e.state === 'IDLE') {
            const want = dist < 300 ? -1 : 0;
            this.move(e, Math.cos(toP) * want * 1.2 + Math.cos(toP + Math.PI / 2) * e.dir * 0.4, Math.sin(toP) * want * 1.2 + Math.sin(toP + Math.PI / 2) * e.dir * 0.4, e.r);
            if (--e.cd <= 0) { e.state = 'WIND'; e.t = 75; }
          } else {
            if (e.t > 22) { e.lx = p.x; e.ly = p.y; }
            e.ang = Math.atan2(e.ly - e.y, e.lx - e.x);
            if (--e.t <= 0) { this.enemyShot(e, e.ang, 11, 1, 4, 'sniper'); e.state = 'IDLE'; e.cd = 150 + Math.floor(this.rng() * 40); }
          }
          break;
        }
        case 'turret': {
          e.ang += 0.02;
          if (--e.cd <= 0) { for (let k = -1; k <= 1; k++) this.enemyShot(e, toP + k * 0.3, 2.7, 1, 4); e.cd = 105; }
          break;
        }
        case 'drone': {
          const a = toP, sp = 2.35; e.ang = a;
          this.move(e, Math.cos(a) * sp, Math.sin(a) * sp, 6);
          if (dist < e.r + p.r + 2) { this.hurt(1, e.x, e.y, 'drone'); this.emit({ t: 'boom', x: e.x, y: e.y, r: 28 }); this.enemies.splice(i, 1); }
          break;
        }
        case 'tank': {
          e.ang = toP;
          const ty = 190, dx = p.x - e.x;
          this.move(e, Math.max(-0.7, Math.min(0.7, dx * 0.02)), (ty - e.y) * 0.02, e.r);
          if (--e.cd <= 0) { for (let k = -1; k <= 1; k++) this.enemyShot(e, toP + k * 0.18, 3.6, 1, 5); e.cd = 120; e.t++; if (e.t % 3 === 0) this.zone('tank', p.x + (this.rng() - 0.5) * 90, p.y + (this.rng() - 0.5) * 90, 44, 62); }
          break;
        }
        case 'boss': this.updateBoss(e, toP); break;
      }
    }
  }

  private zone(src: GKind, x: number, y: number, r: number, t: number, dmg = 1): void {
    this.zones.push({ x: Math.max(ARENA.x0, Math.min(ARENA.x1, x)), y: Math.max(ARENA.y0, Math.min(ARENA.y1, y)), r, t, max: t, dmg, foe: true, src });
  }

  private updateBoss(e: GEnemy, toP: number): void {
    const p = this.p, hpK = e.hp / e.maxHp, phase = hpK > 0.66 ? 1 : hpK > 0.33 ? 2 : 3;
    if (phase > e.phase) {
      e.phase = phase; e.state = 'IDLE'; e.cd = 60;
      this.emit({ t: 'bossPhase', phase }); this.emit({ t: 'shake', v: 12 }); this.emit({ t: 'slowmo', ms: 500, scale: 0.3 });
      if (phase >= 2) for (let k = 0; k < 4; k++) this.addEnemy('drone', 80 + k * 95, 100);
      // 보급: 2페이즈에 SMG, 3페이즈에 체력 (플레이어가 구르며 주워야 한다)
      const [sx, sy] = this.freeSpot(); this.pickups.push(phase === 2 ? { id: this.nextId++, kind: 'weapon', weapon: 'smg', x: sx, y: sy, t: 0 } : { id: this.nextId++, kind: 'heart', x: sx, y: sy, t: 0 });
    }
    e.ang = toP;
    if (e.state === 'IDLE') {
      // 천천히 좌우로 따라다니며 가틀링 연사 + 어깨 포 부채꼴
      const ty = 200, dx = p.x - e.x;
      e.x += Math.max(-0.9, Math.min(0.9, dx * 0.02)); e.y += (ty - e.y) * 0.03;
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
      e.x = Math.max(ARENA.x0 + 50, Math.min(ARENA.x1 - 50, e.x)); e.y = Math.max(ARENA.y0 + 60, Math.min(ARENA.y1 - 60, e.y));
      if (Math.hypot(p.x - e.x, p.y - e.y) < e.r + p.r - 10) { if (p.rollT > 0) { if (!e.styled) { e.styled = true; this.styles++; this.score += 500; this.emit({ t: 'style', x: p.x, y: p.y }); this.emit({ t: 'slowmo', ms: 260, scale: 0.35 }); } } else this.hurt(1, e.x, e.y, 'boss'); }
      const stuck = Math.hypot(e.x - x0, e.y - y0) < 4;
      if (--e.t <= 0 || stuck) { e.state = 'STUN'; e.t = 110; e.styled = false; this.emit({ t: 'shake', v: 10 }); this.emit({ t: 'boom', x: e.x, y: e.y, r: 70 }); for (let k = 0; k < 8; k++) this.enemyShot(e, (k / 8) * Math.PI * 2 + 0.2, 2.4, 1, 4); }
    } else if (e.state === 'STUN') {   // 약점 노출: 이때 피해 ×2
      e.y += (230 - e.y) * 0.02;
      if (--e.t <= 0) { e.state = 'IDLE'; e.cd = 50; }
    }
  }

  // ---------------------------------------------------------------- 탄
  private updateBullets(): void {
    const p = this.p;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx; b.y += b.vy;
      if (--b.life <= 0 || b.x < ARENA.x0 - 20 || b.x > ARENA.x1 + 20 || b.y < ARENA.y0 - 20 || b.y > ARENA.y1 + 20) { this.bullets.splice(i, 1); continue; }
      const c = this.blocked(b.x, b.y);
      if (c) {
        if (c.kind === 'barrel') this.breakCover(c);
        if (!(b.friendly && b.pierce > 0 && b.kind !== 'throw') || c.kind !== 'barrel') { this.bullets.splice(i, 1); }
        continue;
      }
      if (b.friendly) {
        for (const e of this.enemies) {
          if (e.state === 'SPAWN' || b.hit.includes(e.id)) continue;
          if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < (e.r + b.r) ** 2) {
            this.damage(e, b.dmg * (e.state === 'STUN' ? 1.6 : 1), b.x, b.y);
            if (b.kind === 'throw') { e.state = 'STUN'; e.t = Math.max(e.t, 70); this.emit({ t: 'boom', x: b.x, y: b.y, r: 34 }); }
            b.hit.push(e.id);
            if (b.pierce-- <= 0) { this.bullets.splice(i, 1); break; }
          }
        }
      } else if (p.invuln <= 0 && (p.x - b.x) ** 2 + (p.y - b.y) ** 2 < (p.r + b.r) ** 2) {
        this.hurt(b.dmg, b.x, b.y, b.src); this.bullets.splice(i, 1);
      }
    }
  }

  private damage(e: GEnemy, dmg: number, x: number, y: number): void {
    e.hp -= dmg; e.flash = 4;
    const kill = e.hp <= 0;
    this.emit({ t: 'hit', x, y, dmg, kill, kind: e.kind });
    if (kill) this.killEnemy(e);
  }

  private killEnemy(e: GEnemy): void {
    const i = this.enemies.indexOf(e); if (i < 0) return;
    this.enemies.splice(i, 1); this.kills++;
    this.combo++; this.comboT = GROUND.comboFrames; this.maxCombo = Math.max(this.maxCombo, this.combo);
    const mult = 1 + 0.2 * Math.min(this.combo - 1, 10), pts = Math.round(ENEMY_DEF[e.kind].pts * mult);
    this.score += pts;
    this.emit({ t: 'kill', x: e.x, y: e.y, kind: e.kind, pts, combo: this.combo });
    if (e.kind === 'tank' || e.kind === 'boss') { this.emit({ t: 'boom', x: e.x, y: e.y, r: e.r * 2.2 }); this.emit({ t: 'shake', v: 14 }); this.emit({ t: 'hitstop', frames: 8 }); }
    else if (e.kind !== 'drone') this.emit({ t: 'hitstop', frames: 2 });
    if (e.kind === 'boss') {   // 보스가 쓰러지면 남은 드론·적 탄이 모두 사라진다 (배열을 순회 중일 수 있어 수명만 0으로)
      this.enemies = this.enemies.filter(b => b.kind !== 'drone');
      for (const b of this.bullets) if (!b.friendly) b.life = 1;
    }
    // 드랍: 보병은 가끔 탄약(현재 총 보충)
    if ((e.kind === 'rifle' || e.kind === 'charger') && this.rng() < 0.22 && this.p.weapon !== 'pistol') {
      this.p.ammo = Math.min(WEAPONS[this.p.weapon].ammo, this.p.ammo + Math.ceil(WEAPONS[this.p.weapon].ammo * 0.25)); this.emit({ t: 'pickup', what: 'ammo', x: e.x, y: e.y });
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
    if (dmg > 0) for (const e of this.enemies.slice()) if (e.state !== 'SPAWN' && Math.hypot(e.x - x, e.y - y) < r + e.r) this.damage(e, dmg, e.x, e.y);
    for (const c of this.cover) if (!c.dead && c.kind === 'barrel' && Math.hypot(c.x - x, c.y - y) < r + 8) this.breakCover(c);
  }
  private breakCover(c: GCover): void {
    if (c.dead || c.kind !== 'barrel') return;
    c.dead = true; this.emit({ t: 'coverBreak', x: c.x, y: c.y });
    // 폭발 드럼통: 적에게 큰 피해, 플레이어에게도 1 (연쇄 폭발)
    this.emit({ t: 'boom', x: c.x, y: c.y, r: 70 }); this.emit({ t: 'shake', v: 10 }); this.emit({ t: 'hitstop', frames: 3 });
    for (const e of this.enemies.slice()) if (e.state !== 'SPAWN' && Math.hypot(e.x - c.x, e.y - c.y) < 70 + e.r) this.damage(e, 8, e.x, e.y);
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
  private updatePickups(): void {
    const p = this.p;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i]; k.t++;
      if (Math.hypot(p.x - k.x, p.y - k.y) > 24) continue;
      if (k.kind === 'heart') { if (p.hp >= p.maxHp) continue; p.hp = Math.min(p.maxHp, p.hp + 2); this.emit({ t: 'pickup', what: 'heart', x: k.x, y: k.y }); }
      else { p.weapon = k.weapon!; p.ammo = WEAPONS[p.weapon].ammo; this.emit({ t: 'pickup', what: 'weapon', x: k.x, y: k.y }); }
      this.pickups.splice(i, 1);
    }
  }

  /** 결과: 본편으로 돌아갈 때 쓰는 보상 정산 */
  result(): { win: boolean; score: number; kills: number; rooms: number; maxCombo: number; styles: number; hpLeft: number } {
    return { win: this.state === 'WIN', score: this.score, kills: this.kills, rooms: this.room + (this.state === 'WIN' ? 1 : 0), maxCombo: this.maxCombo, styles: this.styles, hpLeft: this.p.hp };
  }
}
