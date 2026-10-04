import { createRng, type Rng } from './rng';
import { COLS, ROWS, SECTIONS, TILE, WORLD_H, WORLD_W, buildLevel, buildRescueLevel, flowField, sectionOfRow, sectionsOf, type Level, type MissionKind, type SectionDef } from './groundmap';

/**
 * 지상전 「강하」 규칙 (순수 TS, Phaser 무관). 한 틱 = 1/60초, 길이 단위는 월드 px (타일 64, 도트 4).
 * 탑다운 슈터 MVP(assets-src/mvp/HANDOFF.md)의 규칙·수치를 그대로 이식했다: 무기별 발사 시퀀스, 근접·폭탄·구르기,
 * 부서지는 문·유리창·상자, 총 겹침 방지, 시야/소음/거리장 AI, 앞/뒤 쓰러짐, 피격 11가지 효과표.
 * 우리 게임에 맞춘 부분: 플레이어 체력 4칸, 구역 정리 → 위층 문 해제, 격납고 보스, 무기 줍기/탄약, 점수·콤보.
 */
export const GW = WORLD_W, GH = WORLD_H;
export type WeaponId = 'pistol' | 'silenced' | 'smg' | 'rifle' | 'shotgun' | 'rail';
export type GKind = 'rifle' | 'charger' | 'sniper' | 'turret' | 'drone' | 'boss' | 'heavy' | 'dog';
export type FeelKey = WeaponId | 'melee' | 'door' | 'bomb';
const f = (sec: number): number => Math.round(sec * 60);   // 초 → 틱

// ---------------------------------------------------------------- 무기 (시퀀스 [포즈, 틱, 이벤트?])
type Seq = [string, number, string?][];
export interface WeaponDef { name: string; dmg: number; cd: number; speed: number; spread: number; pellets: number; life: number; noise: number; move: number; muzzle: [number, number]; ammo: number; pierce: number; seq: Seq }
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol:  { name: '권총',       dmg: 34,  cd: f(0.26),  speed: 1050 / 60, spread: 0.02, pellets: 1, life: 90, noise: 600, move: 255 / 60, muzzle: [13, 2], ammo: Infinity, pierce: 0, seq: [['shoot', f(0.1)]] },
  rifle:   { name: '소총',       dmg: 20,  cd: f(0.11),  speed: 1200 / 60, spread: 0.03, pellets: 1, life: 90, noise: 700, move: 255 / 60, muzzle: [14, 0], ammo: 60,       pierce: 0, seq: [['shoot', f(0.07)]] },
  silenced: { name: '소음기 권총', dmg: 30, cd: f(0.28), speed: 1000 / 60, spread: 0.02, pellets: 1, life: 90, noise: 60, move: 250 / 60, muzzle: [21, 2], ammo: 24, pierce: 0, seq: [['shoot', f(0.1)]] },   // 소음 거의 0: 바로 옆이 아니면 아무도 못 듣는다
  smg:     { name: 'SMG',        dmg: 13,  cd: f(0.075), speed: 1100 / 60, spread: 0.07, pellets: 1, life: 90, noise: 700, move: 190 / 60, muzzle: [21, 0], ammo: 90,       pierce: 0, seq: [['shoot_a', f(0.06)], ['aim', f(0.3)]] },
  shotgun: { name: '샷건',       dmg: 22,  cd: 0,        speed: 870 / 60,  spread: 0.2,  pellets: 6, life: 25, noise: 800, move: 125 / 60, muzzle: [20, 1], ammo: 8,        pierce: 0, seq: [['shoot', f(0.09)], ['pump_back', f(0.14), 'casing'], ['pump_fwd', f(0.14)], ['aim', f(0.32)]] },
  rail:    { name: '레일 라이플', dmg: 140, cd: f(0.97),  speed: 1800 / 60, spread: 0,    pellets: 1, life: 60, noise: 800, move: 225 / 60, muzzle: [14, 0], ammo: 8,        pierce: 6, seq: [['shoot', f(0.13)]] },
};
/** 피격 효과표: dmg·knock(px/s)·stun·hitPose·flash(틱)·blood[앞,뒤]·spread·mist·stamp·shake·stop(틱) / 사망 */
export interface Feel { dmg: number; knock: number; stun: number; pose: number; flash: number; blood: [number, number]; spread: number; mist: number; stamp: number; shake: number; stop: number;
  dKnock: number; dBlood: number; dMist: number; dGibs: number; dPool: number; dShake: number; dStop: number; dSlow: number }
export const FEEL: Record<FeelKey, Feel> = {
  pistol:  { dmg: 34, knock: 260, stun: f(0.25), pose: f(0.14), flash: f(0.07), blood: [9, 3],  spread: 0.55, mist: 1, stamp: 10, shake: 3.5, stop: f(0.03),  dKnock: 430,  dBlood: 24, dMist: 3, dGibs: 0, dPool: 30, dShake: 6,  dStop: f(0.05), dSlow: 0 },
  rifle:   { dmg: 20, knock: 110, stun: f(0.12), pose: f(0.09), flash: f(0.05), blood: [5, 2],  spread: 0.6,  mist: 0, stamp: 7,  shake: 1.5, stop: 0,        dKnock: 300,  dBlood: 16, dMist: 2, dGibs: 0, dPool: 26, dShake: 4,  dStop: f(0.04), dSlow: 0 },
  silenced: { dmg: 30, knock: 240, stun: f(0.25), pose: f(0.14), flash: f(0.05), blood: [8, 3], spread: 0.5, mist: 1, stamp: 9, shake: 1.5, stop: f(0.03), dKnock: 380, dBlood: 22, dMist: 3, dGibs: 0, dPool: 28, dShake: 3, dStop: f(0.05), dSlow: 0 },
  smg:     { dmg: 13, knock: 50,  stun: f(0.07), pose: f(0.06), flash: f(0.04), blood: [3, 1],  spread: 0.7,  mist: 0, stamp: 5,  shake: 1,   stop: 0,        dKnock: 220,  dBlood: 12, dMist: 1, dGibs: 0, dPool: 24, dShake: 3,  dStop: f(0.03), dSlow: 0 },
  shotgun: { dmg: 22, knock: 210, stun: f(0.4),  pose: f(0.2),  flash: f(0.09), blood: [7, 3],  spread: 0.8,  mist: 1, stamp: 12, shake: 4,   stop: f(0.045), dKnock: 740,  dBlood: 36, dMist: 5, dGibs: 4, dPool: 40, dShake: 11, dStop: f(0.09), dSlow: 250 },
  rail:    { dmg: 140, knock: 600, stun: f(0.6), pose: f(0.2),  flash: f(0.1),  blood: [14, 5], spread: 0.35, mist: 2, stamp: 14, shake: 6,   stop: f(0.05),  dKnock: 900,  dBlood: 30, dMist: 4, dGibs: 2, dPool: 36, dShake: 9,  dStop: f(0.07), dSlow: 150 },
  melee:   { dmg: 55, knock: 520, stun: f(0.5),  pose: f(0.25), flash: f(0.12), blood: [16, 4], spread: 1.2,  mist: 3, stamp: 14, shake: 8,   stop: f(0.08),  dKnock: 640,  dBlood: 28, dMist: 4, dGibs: 1, dPool: 34, dShake: 9,  dStop: f(0.1),  dSlow: 200 },
  door:    { dmg: 30, knock: 420, stun: f(0.9),  pose: f(0.3),  flash: f(0.1),  blood: [3, 0],  spread: 1,    mist: 0, stamp: 6,  shake: 4,   stop: f(0.05),  dKnock: 420,  dBlood: 18, dMist: 2, dGibs: 0, dPool: 28, dShake: 6,  dStop: f(0.05), dSlow: 0 },
  bomb:    { dmg: 400, knock: 1100, stun: f(1), pose: f(0.3),  flash: f(0.1),  blood: [20, 6], spread: 1.5,  mist: 4, stamp: 18, shake: 12,  stop: f(0.1),   dKnock: 1100, dBlood: 44, dMist: 6, dGibs: 8, dPool: 46, dShake: 16, dStop: f(0.1),  dSlow: 350 },
};

// ---------------------------------------------------------------- 상수
export const GROUND = {
  hp: 4, hitR: 26, moveR: 36, speed: 265 / 60, enemyMoveR: 34, enemyHitR: 30,
  hurtInvuln: 45, comboFrames: 150, grenades: 2, grenadeMax: 4,
  rollSteps: [['roll_1', f(0.07)], ['roll_2', f(0.1)], ['roll_3', f(0.1)], ['roll_4', f(0.1)], ['roll_5', f(0.13)]] as Seq, rollSpeed: [420, 420, 380, 300, 150].map(v => v / 60), rollInvulnSteps: 4, rollCd: f(0.75),
  meleeSteps: [['melee_1', f(0.1)], ['melee_2', f(0.07), 'hit'], ['melee_3', f(0.13)]] as Seq, throwSteps: [['throw_1', f(0.1)], ['throw_2', f(0.08)], ['throw_3', f(0.16), 'release']] as Seq,
  bombFuse: f(1.9), enemyBulletSpeed: 620 / 60, enemyBulletLife: f(1.3), viewDist: 520, viewHalf: 1.25, nearSee: 160, backSee: 55, backCone: 2.09, sneakMul: 0.55, stepNoise: 150, stepFrames: 18, stabRange: 105, allyAlert: 220, doorRate: 7, kickRate: 15,
} as const;
export const SECTION_COUNT = SECTIONS.length;

export interface GroundOpts { seed: number; pilot: 0 | 1 | 2; dmgMult: number; rateMult: number; maxHp: number; grenades: number; assist: boolean; mission: MissionKind; hostageWho: 1 | 2 }
export const DEFAULT_GROUND_OPTS: GroundOpts = { seed: 1, pilot: 0, dmgMult: 1, rateMult: 1, maxHp: GROUND.hp, grenades: GROUND.grenades, assist: false, mission: 'assault', hostageWho: 2 };

export interface GInput { mx: number; my: number; ax: number; ay: number; fire: boolean; roll: boolean; melee: boolean; bomb: boolean; swap?: boolean; sneak?: boolean; pickup?: boolean; aimDist?: number }
export const NO_INPUT: GInput = { mx: 0, my: 0, ax: 0, ay: 0, fire: false, roll: false, melee: false, bomb: false };

interface Seqn { kind: 'fire' | 'melee' | 'throw' | 'roll'; steps: Seq; i: number; t: number }
export interface GPlayer {
  x: number; y: number; hp: number; maxHp: number; aim: number; invuln: number;
  weapon: WeaponId; ammo: number; grenades: number; flashes: number; smokes: number; gsel: BombType; seq: Seqn | null; cd: number; rollCd: number; rollAng: number; rollI: number;
  moving: boolean; walk: number; stab?: boolean; sneaking?: boolean; stepT?: number; gunBlocked: boolean; kick: number; pickCd: number; smgAlt: number; combatT: number; hitFlash: number;
}
export interface GEnemy {
  id: number; kind: GKind; x: number; y: number; hp: number; maxHp: number; section: number;
  state: 'idle' | 'alert'; ang: number; base: number; look: number; aimT: number; cd: number; shotT: number; hitT: number; hitPose: number; stunT: number; vx: number; vy: number; moving: boolean; walk: number;
  home: { x: number; y: number; ang: number }; patrol?: [number, number][]; pi: number; moved: number;
  alertT: number; windT: number; dashT: number; lx: number; ly: number; burst: number; phase: number; styled: boolean; fire: number;
  dying: boolean; fallT: number; fallF: boolean; deathAng: number; smearD: number; w: FeelKey;
}
export interface GBullet { x: number; y: number; vx: number; vy: number; dmg: number; friendly: boolean; w: FeelKey; life: number; dist: number; pellet: boolean; first: boolean; pierce: number; hit: number[]; dodged: boolean; src?: GKind; kind?: 'normal' | 'sniper' }
export interface GDoor { id: number; c: number; r: number; w: number; h: number; o: 'v' | 'h'; kind: 'door' | 'gate' | 'exit'; section: number; hp: number; phi: number; target: number; rate: number; broken: boolean; locked: boolean; x0: number; y0: number; x1: number; y1: number }
export interface GWindow { id: number; c: number; r: number; w: number; h: number; o: 'v' | 'h'; section: number; hp: number; broken: boolean; x0: number; y0: number; x1: number; y1: number }
export interface GCrate { id: number; kind: 'crate' | 'barrel'; x: number; y: number; hp: number; broken: boolean; section: number; hitT: number; hs: number }
export interface GPickup { id: number; kind: 'heart' | 'weapon' | 'bomb'; bt?: BombType; weapon?: WeaponId; ammo?: number; x: number; y: number; t: number; section: number; dropped?: boolean }
export type BombType = 'frag' | 'flash' | 'smoke';
export const BOMB_TYPES: BombType[] = ['frag', 'flash', 'smoke'];
export const BOMB_NAME: Record<BombType, string> = { frag: '파편탄', flash: '섬광탄', smoke: '연막탄' };
export interface GSmoke { x: number; y: number; r: number; t: number; life: number }
export interface GBomb { type: BombType;  x: number; y: number; sx: number; sy: number; tx: number; ty: number; t: number; flight: number; fuse: number; bounce: number }
type Obj = { t: 'door'; o: GDoor } | { t: 'window'; o: GWindow } | { t: 'crate'; o: GCrate };

export type GEvent =
  | { t: 'shot'; weapon: WeaponId; x: number; y: number; ang: number }
  | { t: 'casing'; x: number; y: number; ang: number; left: boolean; weapon: WeaponId }
  | { t: 'hit'; x: number; y: number; ang: number; w: FeelKey; kill: boolean; kind: GKind; dmg: number; armor: boolean }
  | { t: 'kill'; x: number; y: number; ang: number; w: FeelKey; kind: GKind; pts: number; combo: number }
  | { t: 'smear'; x: number; y: number } | { t: 'pool'; x: number; y: number; r: number } | { t: 'stamp'; x: number; y: number; ang: number; fallF: boolean; kind: GKind }
  | { t: 'dodge'; x: number; y: number } | { t: 'hurt'; x: number; y: number; by?: GKind } | { t: 'roll'; x: number; y: number; ang: number } | { t: 'swing'; x: number; y: number; ang: number }
  | { t: 'throw' } | { t: 'release'; x: number; y: number } | { t: 'boom'; x: number; y: number; r: number }
  | { t: 'doorKick'; x: number; y: number } | { t: 'doorOpen'; x: number; y: number } | { t: 'doorHit'; x: number; y: number } | { t: 'doorBreak'; x: number; y: number; o: 'v' | 'h' }
  | { t: 'windowHit'; x: number; y: number } | { t: 'windowBreak'; x: number; y: number; o: 'v' | 'h' } | { t: 'crateHit'; x: number; y: number } | { t: 'crateBreak'; x: number; y: number; barrel: boolean }
  | { t: 'wallhit'; x: number; y: number; ang: number } | { t: 'alert'; x: number; y: number }
  | { t: 'hostageFree'; x: number; y: number } | { t: 'reinforce'; x: number; y: number } | { t: 'hostageProgress'; k: number }
  | { t: 'assassinate'; x: number; y: number; ang: number } | { t: 'step'; x: number; y: number; r: number }
  | { t: 'flashbang'; x: number; y: number; r: number } | { t: 'smoke'; x: number; y: number; r: number } | { t: 'stealth'; x: number; y: number; pts: number; melee: boolean } | { t: 'ghost'; n: number; pts: number } | { t: 'swap'; to: BombType }
  | { t: 'pickup'; what: 'heart' | 'weapon' | 'bomb'; x: number; y: number } | { t: 'drop'; x: number; y: number; weapon: WeaponId }
  | { t: 'gate'; section: number } | { t: 'section'; n: number; name: string } | { t: 'cleared'; n: number } | { t: 'exitopen' } | { t: 'reset'; section: number }
  | { t: 'shake'; v: number } | { t: 'hitstop'; frames: number } | { t: 'slowmo'; ms: number; scale: number } | { t: 'bossPhase'; phase: number } | { t: 'style'; x: number; y: number }
  | { t: 'win' } | { t: 'dead' };

const ENEMY_DEF: Record<GKind, { hp: number; pts: number; speed: number }> = {
  rifle: { hp: 60, pts: 100, speed: 90 / 60 }, charger: { hp: 100, pts: 160, speed: 100 / 60 }, sniper: { hp: 60, pts: 220, speed: 70 / 60 }, heavy: { hp: 260, pts: 400, speed: 70 / 60 },
  dog: { hp: 50, pts: 120, speed: 270 / 60 }, turret: { hp: 220, pts: 220, speed: 0 }, drone: { hp: 20, pts: 40, speed: 230 / 60 }, boss: { hp: 2400, pts: 4000, speed: 80 / 60 },
};
/** 총알 종류별 피해 배율: 중장갑(헤비·포탑)은 소구경탄에 강하다 */
const ARMOR: Partial<Record<GKind, Partial<Record<FeelKey, number>>>> = { heavy: { pistol: 0.55, silenced: 0.55, rifle: 0.55, smg: 0.55, shotgun: 0.8 }, turret: { pistol: 0.6, rifle: 0.6, smg: 0.6, shotgun: 0.8 }, boss: {} };
const DROPS: Partial<Record<GKind, { w: WeaponId; p: number }>> = { rifle: { w: 'smg', p: 0.35 }, heavy: { w: 'shotgun', p: 0.7 }, sniper: { w: 'rail', p: 0.4 }, charger: { w: 'rifle', p: 0.3 } };
/** 폭탄 드랍 확률(적 종류별, 아주 낮게). 소지 한도는 GROUND.grenadeMax */
const BOMB_DROP: Partial<Record<GKind, number>> = { rifle: 0.07, charger: 0.1, sniper: 0.12, heavy: 0.25, turret: 0.12 };
const BODY_R: Record<GKind, number> = { rifle: 34, charger: 36, sniper: 34, heavy: 46, dog: 28, turret: 60, drone: 22, boss: 96 };
const HIT_R: Record<GKind, number> = { rifle: 30, charger: 32, sniper: 30, heavy: 42, dog: 26, turret: 58, drone: 22, boss: 92 };

const LEVEL: Level = buildLevel();
let LEVEL_R: Level | null = null;   // 구출 임무 맵(처음 쓸 때 만든다)
export interface GHostage { x: number; y: number; who: 1 | 2; state: 'caged' | 'free' | 'safe'; freeT: number; ang: number; walk: number; moving: boolean }
const cellOf = (x: number, y: number): number => Math.floor(y / TILE) * COLS + Math.floor(x / TILE);
const norm = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class GroundSim {
  rng: Rng;
  opts: GroundOpts;
  frame = 0;
  state: 'PLAY' | 'WIN' | 'DEAD' = 'PLAY';
  tiles!: Uint8Array; level: Level = LEVEL; secs: SectionDef[] = SECTIONS;
  /** 인질 구출 임무 상태 */
  hostage: GHostage | null = null; alarm = false; alarmT = 0; private wave = 0; private hflow = new Int16Array(COLS * ROWS); private hflowAt = -99;
  get mission(): MissionKind { return this.opts.mission; }
  p!: GPlayer;
  enemies: GEnemy[] = []; dying: GEnemy[] = []; bullets: GBullet[] = []; pickups: GPickup[] = []; bombs: GBomb[] = []; smokes: GSmoke[] = []; private alerted: boolean[] = [false, false, false, false]; stealthKills = 0;
  doors: GDoor[] = []; windows: GWindow[] = []; crates: GCrate[] = [];
  events: GEvent[] = [];
  cleared: boolean[] = [false, false, false, false];
  reached = 0;
  score = 0; kills = 0; combo = 0; comboT = 0; time = 0; maxCombo = 0; styles = 0;
  private cells: Obj[][] = [];
  private nextId = 1;
  private pflow = new Int16Array(COLS * ROWS); private pflowAt = -99; private pflowTile = -1;

  constructor(opts: Partial<GroundOpts> = {}) {
    this.opts = { ...DEFAULT_GROUND_OPTS, ...opts };
    this.rng = createRng(this.opts.seed + 7919);
    if (this.opts.mission === 'rescue') { LEVEL_R ??= buildRescueLevel(); this.level = LEVEL_R; this.secs = sectionsOf('rescue'); }
    const LV = this.level;
    this.p = { x: LV.start.x, y: LV.start.y, hp: this.opts.maxHp, maxHp: this.opts.maxHp, aim: -Math.PI / 2, invuln: 60, weapon: 'pistol', ammo: Infinity, grenades: this.opts.grenades, flashes: 1, smokes: 1, gsel: 'frag', seq: null, cd: 0, rollCd: 0, rollAng: 0, rollI: 0, moving: false, walk: 0, gunBlocked: false, kick: 0, pickCd: 0, smgAlt: 0, combatT: 0, hitFlash: 0 };
    this.tiles = LV.tiles.slice();   // 벽 타일은 변하지 않지만 시험에서 바꿀 수 있게 복사
    // 오브젝트 생성 + 칸 색인
    for (const d of LV.doors) { const o: GDoor = { id: this.nextId++, c: d.c, r: d.r, w: d.w, h: d.h, o: d.o, kind: d.kind, section: d.section, hp: 12, phi: 0, target: 0, rate: GROUND.doorRate, broken: false, locked: d.kind !== 'door', x0: d.c * TILE, y0: d.r * TILE, x1: (d.c + d.w) * TILE, y1: (d.r + d.h) * TILE }; this.doors.push(o); this.index(o.c, o.r, o.w, o.h, { t: 'door', o }); }
    for (const w of LV.windows) { const o: GWindow = { id: this.nextId++, c: w.c, r: w.r, w: w.w, h: w.h, o: w.o, section: w.section, hp: 2, broken: false, x0: w.c * TILE, y0: w.r * TILE, x1: (w.c + w.w) * TILE, y1: (w.r + w.h) * TILE }; this.windows.push(o); this.index(o.c, o.r, o.w, o.h, { t: 'window', o }); }
    for (const c of LV.crates) { const o: GCrate = { id: this.nextId++, kind: c.kind, x: (c.c + 0.5) * TILE, y: (c.r + 0.5) * TILE, hp: c.kind === 'barrel' ? 1 : 3, broken: false, section: c.section, hitT: 0, hs: c.kind === 'barrel' ? 22 : 28 }; this.crates.push(o); this.index(c.c, c.r, 1, 1, { t: 'crate', o }); }
    for (let s = 0; s < SECTION_COUNT; s++) this.populate(s);
    this.emit({ t: 'section', n: 0, name: this.secs[0].name });
    if (this.opts.mission === 'rescue') {   // 소음기 권총 + 섬광/연막 2개씩으로 시작, 인질은 감방에
      this.p.weapon = 'silenced'; this.p.ammo = WEAPONS.silenced.ammo; this.p.flashes = 2; this.p.smokes = 2;
      this.hostage = { x: LV.hostage!.x, y: LV.hostage!.y, who: this.opts.hostageWho, state: 'caged', freeT: 0, ang: Math.PI, walk: 0, moving: false };
    }
  }
  private index(c: number, r: number, w: number, h: number, o: Obj): void { for (let rr = r; rr < r + h; rr++) for (let cc = c; cc < c + w; cc++) { const i = rr * COLS + cc; (this.cells[i] ??= []).push(o); } }
  private emit(e: GEvent): void { this.events.push(e); }
  drain(): GEvent[] { const e = this.events; this.events = []; return e; }
  get boss(): GEnemy | undefined { return this.enemies.find(e => e.kind === 'boss'); }
  get section(): number { return sectionOfRow(Math.floor(this.p.y / TILE)); }
  get isBossRoom(): boolean { return this.opts.mission === 'assault' && this.section === 3; }
  get remaining(): number { const s = this.section; return this.enemies.filter(e => e.section === s && e.kind !== 'drone').length; }
  get exitOpen(): boolean { return this.opts.mission === 'rescue' ? this.hostage?.state !== 'caged' : this.cleared[3]; }

  // ---------------------------------------------------------------- 구역 구성
  private populate(s: number): void {
    this.alerted[s] = false;
    this.enemies = this.enemies.filter(e => e.section !== s); this.dying = this.dying.filter(e => e.section !== s); this.pickups = this.pickups.filter(k => k.section !== s);
    for (const m of this.level.spawns) if (m.section === s) this.addEnemy(m.k, m.x, m.y, ((m.ang ?? 90) * Math.PI) / 180, m.patrol);
    for (const k of this.level.bombPickups ?? []) if (k.section === s) this.pickups.push({ id: this.nextId++, kind: 'bomb', bt: k.bt, x: k.x, y: k.y, t: 0, section: s });
    for (const k of this.level.pickups) if (k.section === s) this.pickups.push({ id: this.nextId++, kind: 'weapon', weapon: k.weapon, ammo: WEAPONS[k.weapon].ammo, x: k.x, y: k.y, t: 0, section: s });
    for (const d of this.doors) if (d.section === s && !(this.cleared[s] && d.kind !== 'door')) { d.hp = 12; d.phi = 0; d.target = 0; d.broken = false; d.locked = d.kind !== 'door'; }
    for (const w of this.windows) if (w.section === s) { w.hp = 2; w.broken = false; }
    for (const c of this.crates) if (c.section === s) { c.hp = c.kind === 'barrel' ? 1 : 3; c.broken = false; }
  }
  private addEnemy(kind: GKind, x: number, y: number, ang = Math.PI / 2, patrol?: [number, number][]): GEnemy {
    const d = ENEMY_DEF[kind];
    const e: GEnemy = {
      id: this.nextId++, kind, x, y, hp: d.hp, maxHp: d.hp, section: sectionOfRow(Math.floor(y / TILE)), state: 'idle', ang, base: ang, look: this.rng() * 6, aimT: 0, cd: 20 + Math.floor(this.rng() * 60), shotT: 0, hitT: 0, hitPose: 0, stunT: 0, vx: 0, vy: 0, moving: false, walk: 0,
      home: { x, y, ang }, patrol, pi: 0, moved: 0, alertT: 0, windT: 0, dashT: 0, lx: 0, ly: 0, burst: 0, phase: 1, styled: false, fire: 0, dying: false, fallT: 0, fallF: false, deathAng: 0, smearD: 0, w: 'pistol',
    };
    this.enemies.push(e);
    return e;
  }
  /** 사망 후 이어하기: 지금 구역을 처음부터 다시 (이미 정리한 구역은 그대로) */
  revive(): void {
    const s = this.section, def = this.secs[s];
    this.p.hp = Math.max(2, Math.ceil(this.p.maxHp / 2)); this.p.invuln = 120; this.combo = 0; this.comboT = 0; this.p.seq = null; this.p.rollI = 0;
    this.state = 'PLAY'; this.bullets.length = 0; this.bombs.length = 0;
    if (!this.cleared[s]) this.populate(s);
    this.p.x = s === 0 ? this.level.start.x : 9 * TILE; this.p.y = s === 0 ? this.level.start.y : (def.r1 - 1.5) * TILE;
    if (this.opts.mission === 'rescue') { this.p.weapon = 'silenced'; this.p.ammo = WEAPONS.silenced.ammo; if (this.hostage?.state === 'free') { this.hostage.x = this.p.x; this.hostage.y = this.p.y + 90; } }
    else { this.p.weapon = 'pistol'; this.p.ammo = Infinity; }
    this.emit({ t: 'reset', section: s });
  }
  /** 테스트용: 지정 구역에서 시작 — 아래 구역은 정리된 것으로 처리하고 플레이어를 그 구역 입구로 옮긴다 */
  debugStart(section: number, weapon: WeaponId): void {
    for (let s = 0; s < Math.min(section, 3); s++) { this.enemies = this.enemies.filter(e => e.section !== s); this.pickups = this.pickups.filter(k => k.section !== s); this.cleared[s] = true; this.unlock(s); }
    const def = this.secs[section];
    this.p.x = section === 0 ? this.level.start.x : 9 * TILE; this.p.y = section === 0 ? this.level.start.y : (def.r1 - 1.5) * TILE; this.reached = section;
    this.p.weapon = weapon; this.p.ammo = WEAPONS[weapon].ammo; this.p.invuln = 60;
    this.emit({ t: 'section', n: section, name: def.name });
  }

  // ---------------------------------------------------------------- 장애물 질의
  private doorBlocks(d: GDoor): boolean { return !d.broken && (d.locked || Math.abs(d.phi) < 45); }
  /** (x,y) 의 장애물: 벽 / 닫힌 문 / 멀쩡한 유리창 / 안 부서진 상자 */
  obstacleAt(x: number, y: number): { type: 'wall' | 'door' | 'window' | 'crate'; o?: GDoor | GWindow | GCrate } | null {
    const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS || this.tiles[r * COLS + c] === 1) return { type: 'wall' };
    const list = this.cells[r * COLS + c]; if (!list) return null;
    for (const ob of list) {
      if (ob.t === 'door') { if (this.doorBlocks(ob.o)) return { type: 'door', o: ob.o }; }
      else if (ob.t === 'window') { if (!ob.o.broken) return { type: 'window', o: ob.o }; }
      else if (!ob.o.broken && Math.abs(x - ob.o.x) < ob.o.hs && Math.abs(y - ob.o.y) < ob.o.hs) return { type: 'crate', o: ob.o };
    }
    return null;
  }
  /** 시야: 벽·닫힌 문·상자가 막는다. 유리창은 기본적으로 통과 (glass=true 면 폭발처럼 유리도 막는다) */
  los(ax: number, ay: number, bx: number, by: number, glass = false): boolean {
    const dx = bx - ax, dy = by - ay, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 14));
    for (let i = 1; i < n; i++) { const ob = this.obstacleAt(ax + (dx * i) / n, ay + (dy * i) / n); if (ob && (ob.type !== 'window' || glass)) return false; }
    return true;
  }
  /** 연막 구름이 두 점 사이 시선을 막는가 (아주 가까우면(130px) 구름 속에서도 보인다) */
  smokeBlocks(ax: number, ay: number, bx: number, by: number): boolean {
    if (!this.smokes.length || Math.hypot(bx - ax, by - ay) < 130) return false;
    for (const s of this.smokes) {
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1, u = Math.max(0, Math.min(1, ((s.x - ax) * dx + (s.y - ay) * dy) / L2));
      if (Math.hypot(ax + dx * u - s.x, ay + dy * u - s.y) < s.r * Math.min(1, s.t / 40)) return true;
    }
    return false;
  }
  canSee(ax: number, ay: number, bx: number, by: number): boolean { return this.los(ax, ay, bx, by); }
  private rayEnd(ax: number, ay: number, ang: number, max: number): [number, number] {   // 마지막 빈 지점 (폭탄 경로)
    let lx = ax, ly = ay; for (let d = 10; d <= max; d += 10) { const x = ax + Math.cos(ang) * d, y = ay + Math.sin(ang) * d; const ob = this.obstacleAt(x, y); if (ob && ob.type !== 'window') break; lx = x; ly = y; }   // 유리창은 폭탄이 깨고 지나간다
    return [lx, ly];
  }
  walkable = (c: number, r: number): boolean => {
    if (this.tiles[r * COLS + c] === 1) return false;
    const list = this.cells[r * COLS + c]; if (!list) return true;
    for (const ob of list) { if (ob.t === 'door') { if (!ob.o.broken && ob.o.locked) return false; } else if (ob.t === 'window') { if (!ob.o.broken) return false; } else if (!ob.o.broken) return false; }
    return true;
  };
  private playerFlow(): Int16Array {
    const tile = cellOf(this.p.x, this.p.y);
    if (this.frame - this.pflowAt >= 15 || tile !== this.pflowTile) { flowField(Math.floor(this.p.x / TILE), Math.floor(this.p.y / TILE), this.walkable, this.pflow); this.pflowAt = this.frame; this.pflowTile = tile; }
    return this.pflow;
  }
  flowTo(x: number, y: number, out?: Int16Array): Int16Array { return flowField(Math.floor(x / TILE), Math.floor(y / TILE), this.walkable, out); }
  /** 거리장 기울기를 따라 한 걸음 (현재 칸 주변 8칸 중 거리가 더 작은 칸 중심 방향) */
  private stepFlow(o: { x: number; y: number }, fl: Int16Array, speed: number, r: number, push = false): boolean {
    const c = Math.floor(o.x / TILE), rr = Math.floor(o.y / TILE), here = fl[rr * COLS + c];
    let bx = 0, by = 0, bd = here < 0 ? 1e9 : here, found = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const nc = c + dx, nr = rr + dy; if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      if (dx && dy && (fl[rr * COLS + nc] < 0 || fl[nr * COLS + c] < 0)) continue;
      const d = fl[nr * COLS + nc]; if (d >= 0 && d < bd) { bd = d; bx = (nc + 0.5) * TILE; by = (nr + 0.5) * TILE; found = true; }
    }
    if (!found) return false;
    const a = Math.atan2(by - o.y, bx - o.x); this.move(o, Math.cos(a) * speed, Math.sin(a) * speed, r, push); return true;
  }

  // ---------------------------------------------------------------- 이동·충돌 (원 vs 사각형, 3회 반복)
  private pushRect(o: { x: number; y: number }, r: number, x0: number, y0: number, x1: number, y1: number): boolean {
    const nx = Math.max(x0, Math.min(o.x, x1)), ny = Math.max(y0, Math.min(o.y, y1)), dx = o.x - nx, dy = o.y - ny, d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return false;
    if (d2 > 1e-6) { const d = Math.sqrt(d2), push = r - d + 0.01; o.x += (dx / d) * push; o.y += (dy / d) * push; }
    else { const l = o.x - x0, rr = x1 - o.x, t = o.y - y0, b = y1 - o.y, m = Math.min(l, rr, t, b); if (m === l) o.x = x0 - r - 0.01; else if (m === rr) o.x = x1 + r + 0.01; else if (m === t) o.y = y0 - r - 0.01; else o.y = y1 + r + 0.01; }
    return true;
  }
  /** pusher=true 면 문 영역에 닿을 때 문을 연다 */
  private move(o: { x: number; y: number }, dx: number, dy: number, r: number, pusher = false): void {
    o.x = Math.max(r, Math.min(WORLD_W - r, o.x + dx)); o.y = Math.max(r, Math.min(WORLD_H - r, o.y + dy));
    for (let it = 0; it < 3; it++) {
      const c0 = Math.floor((o.x - r) / TILE), c1 = Math.floor((o.x + r) / TILE), r0 = Math.floor((o.y - r) / TILE), r1 = Math.floor((o.y + r) / TILE);
      let hit = false;
      for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) {
        if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) continue;
        if (this.tiles[rr * COLS + cc] === 1) { if (this.pushRect(o, r, cc * TILE, rr * TILE, (cc + 1) * TILE, (rr + 1) * TILE)) hit = true; continue; }
        const list = this.cells[rr * COLS + cc]; if (!list) continue;
        for (const ob of list) {
          if (ob.t === 'door') { const d = ob.o; if (d.broken) continue; if (pusher && !d.locked && this.circleRect(o, r + 2, d)) this.pushDoor(d, o, GROUND.doorRate); if (this.doorBlocks(d) && this.pushRect(o, r, d.x0, d.y0, d.x1, d.y1)) hit = true; }
          else if (ob.t === 'window') { if (!ob.o.broken && this.pushRect(o, r, ob.o.x0, ob.o.y0, ob.o.x1, ob.o.y1)) hit = true; }
          else if (!ob.o.broken && this.pushRect(o, r, ob.o.x - ob.o.hs, ob.o.y - ob.o.hs, ob.o.x + ob.o.hs, ob.o.y + ob.o.hs)) hit = true;
        }
      }
      if (!hit) break;
    }
  }
  private circleRect(o: { x: number; y: number }, r: number, d: { x0: number; y0: number; x1: number; y1: number }): boolean { const nx = Math.max(d.x0, Math.min(o.x, d.x1)), ny = Math.max(d.y0, Math.min(o.y, d.y1)); return (o.x - nx) ** 2 + (o.y - ny) ** 2 < r * r; }
  /** 문을 미는 쪽의 반대 방향으로 연다 (±100°) */
  private pushDoor(d: GDoor, from: { x: number; y: number }, rate: number): void {
    if (d.broken || d.locked) return;
    const cx = (d.x0 + d.x1) / 2, cy = (d.y0 + d.y1) / 2, side = d.o === 'v' ? (from.x < cx ? 1 : -1) : (from.y < cy ? 1 : -1);
    if (Math.abs(d.phi) < 5 && Math.abs(d.target) < 5) this.emit({ t: 'doorOpen', x: cx, y: cy });
    if (d.target === 0 || rate > d.rate) { d.target = 100 * side; }
    d.rate = Math.max(d.rate, rate);
  }

  // ---------------------------------------------------------------- 소음·알림
  private noise(x: number, y: number, radius: number): void {
    const s = sectionOfRow(Math.floor(y / TILE));
    for (const e of this.enemies) if (e.state === 'idle' && e.section === s && Math.hypot(e.x - x, e.y - y) < radius) this.alertEnemy(e);
  }
  private alertEnemy(e: GEnemy): void { if (e.state === 'alert' || e.dying) return; if (e.section >= 0 && e.section < 4) this.alerted[e.section] = true; e.state = 'alert'; e.alertT = f(0.7); e.windT = 0; this.emit({ t: 'alert', x: e.x, y: e.y }); }

  // ---------------------------------------------------------------- 틱
  step(inp: GInput): void {
    if (this.state !== 'PLAY') return;
    this.frame++; this.time++;
    const p = this.p;
    if (this.comboT > 0 && --this.comboT === 0) this.combo = 0;
    if (p.invuln > 0) p.invuln--;
    if (p.cd > 0) p.cd--;
    if (p.rollCd > 0) p.rollCd--;
    if (p.rollI > 0) p.rollI--;
    if (p.pickCd > 0) p.pickCd--;
    if (p.hitFlash > 0) p.hitFlash--;
    p.kick *= 0.8;
    this.updateDoors();
    for (const c of this.crates) if (c.hitT > 0) c.hitT--;
    this.updatePlayer(inp);
    if (inp.swap) this.swapBomb();
    this.updateBombs(); this.updateSmokes();
    this.updateEnemies();
    this.updateDying();
    this.updateBullets();
    this.updatePickups(inp);
    this.updateSections();
    if (p.hp <= 0 && (this.state as string) !== 'DEAD') { this.state = 'DEAD'; this.emit({ t: 'dead' }); }
  }

  private updateDoors(): void {
    for (const d of this.doors) { if (d.broken) continue; const diff = d.target - d.phi; if (Math.abs(diff) > 0.01) d.phi += Math.max(-d.rate, Math.min(d.rate, diff)); }
  }

  private updateSections(): void {
    const s = this.section;
    if (this.opts.mission === 'rescue') { this.updateRescue(); return; }
    if (s > this.reached) { this.reached = s; this.emit({ t: 'section', n: s, name: this.secs[s].name }); this.score += 200; }
    for (let i = 0; i < 3; i++) {   // 일반 구역: 모두 정리하면 위층 문이 열린다
      if (this.cleared[i] || this.enemies.some(e => e.section === i)) continue;
      this.cleared[i] = true; this.unlock(i);
      this.score += 300 + 150 * i; this.emit({ t: 'cleared', n: i });
      if (!this.alerted[i]) { const gp = 500 + 200 * i; this.score += gp; this.emit({ t: 'ghost', n: i, pts: gp }); }   // 한 번도 들키지 않고 정리
      this.pickups.push({ id: this.nextId++, kind: 'heart', x: 9 * TILE, y: (this.secs[i].r0 + 4) * TILE, t: 0, section: i });
    }
    if (!this.cleared[3] && this.reached === 3 && !this.boss) {
      this.cleared[3] = true; this.score += 800; this.unlock(3);
      this.emit({ t: 'exitopen' }); this.emit({ t: 'cleared', n: 3 });
      this.enemies = this.enemies.filter(k => k.section !== 3);
    }
    if (this.cleared[3] && this.p.y < 2.2 * TILE && Math.abs(this.p.x - 9 * TILE) < 2.2 * TILE) { this.state = 'WIN'; this.emit({ t: 'win' }); this.emit({ t: 'slowmo', ms: 700, scale: 0.3 }); }
  }
  /** 인질 구출 임무: 구역 진행(들키지 않고 지나가면 보너스), 인질 풀기(가까이 1.2초), 경보·증원, 인질 호송, 헬기장 도착 */
  private updateRescue(): void {
    const s = this.section, p = this.p, h = this.hostage!;
    if (s > this.reached) {
      if (this.reached < 2 && !this.alerted[this.reached]) { const gp = 400 + 300 * this.reached; this.score += gp; this.emit({ t: 'ghost', n: this.reached, pts: gp }); }   // 한 번도 들키지 않고 통과
      this.reached = s; this.emit({ t: 'section', n: s, name: this.secs[s].name }); this.score += 200;
    }
    if (h.state === 'caged') {
      const near = Math.hypot(p.x - h.x, p.y - h.y) < 95;
      const was = h.freeT; h.freeT = near ? h.freeT + 1 : Math.max(0, h.freeT - 2);
      if (h.freeT !== was) this.emit({ t: 'hostageProgress', k: Math.min(1, h.freeT / 75) });
      if (h.freeT >= 75) this.freeHostage();
    } else if (h.state === 'free') {
      this.updateHostageMove(h); this.alarmT++;
      const waves = [120, 540, 960, 1380];   // 증원: 2~3명씩 좌우 계단에서 쏟아진다
      if (this.wave < waves.length && this.alarmT >= waves[this.wave]) this.spawnWave(this.wave++);
      if (p.y < 3 * TILE && Math.abs(p.x - 9 * TILE) < 2.4 * TILE && Math.hypot(p.x - h.x, p.y - h.y) < 320) {
        h.state = 'safe'; this.state = 'WIN'; this.score += 1000;
        this.emit({ t: 'win' }); this.emit({ t: 'slowmo', ms: 800, scale: 0.3 });
      }
    }
  }
  private freeHostage(): void {
    const h = this.hostage!; h.state = 'free'; h.freeT = 75; this.alarm = true; this.alarmT = 0; this.wave = 0; this.score += 1500;
    if (!this.alerted[2]) { this.score += 1000; this.emit({ t: 'ghost', n: 2, pts: 1000 }); }   // 완전 잠입으로 구출
    this.emit({ t: 'hostageFree', x: h.x, y: h.y }); this.emit({ t: 'shake', v: 10 });
    this.unlock(2); this.unlock(3);
    for (const e of this.enemies) if (e.section >= 2 && !e.dying) this.alertEnemy(e);
  }
  private spawnWave(i: number): void {
    const pts = this.level.reinforce ?? [], kinds: GKind[][] = [['rifle', 'rifle'], ['rifle', 'charger', 'rifle'], ['rifle', 'rifle', 'charger'], ['charger', 'rifle', 'rifle']];
    kinds[i].forEach((k, j) => {
      const pt = pts[(i + j) % pts.length]; if (!pt) return;
      const e = this.addEnemy(k, pt.x + (j - 1) * 40, pt.y, pt.x < 9 * TILE ? 0 : Math.PI); this.alertEnemy(e); this.emit({ t: 'reinforce', x: e.x, y: e.y });
    });
  }
  /** 풀려난 인질: 플레이어를 따라다닌다(가까우면 멈춤). 적의 표적이 되지는 않는다 */
  private updateHostageMove(h: GHostage): void {
    const p = this.p, d = Math.hypot(p.x - h.x, p.y - h.y);
    h.moving = false;
    if (d > 900) { h.x = p.x; h.y = p.y + 70; return; }   // 너무 뒤처지면 곁으로
    if (d > 110) {
      if (this.frame - this.hflowAt >= 12) { flowField(Math.floor(p.x / TILE), Math.floor(p.y / TILE), this.walkable, this.hflow); this.hflowAt = this.frame; }
      const ox = h.x, oy = h.y;
      if (!this.stepFlow(h, this.hflow, GROUND.speed * (d > 260 ? 1.15 : 0.95), 26, true)) { const a = Math.atan2(p.y - h.y, p.x - h.x); this.move(h, Math.cos(a) * 2, Math.sin(a) * 2, 26, true); }
      if (Math.hypot(h.x - ox, h.y - oy) > 0.3) { h.moving = true; h.ang = Math.atan2(h.y - oy, h.x - ox); h.walk++; }
    } else h.ang = Math.atan2(p.y - h.y, p.x - h.x);
  }
  /** 구역의 잠긴 문(위층 문 / 출구)을 열어 둔다 */
  private unlock(section: number): void {
    for (const d of this.doors) if (d.section === section && d.kind !== 'door') { d.locked = false; d.target = 100; d.rate = 3.5; }
    this.emit({ t: 'gate', section });
  }

  // ---------------------------------------------------------------- 플레이어
  private muzzle(w: WeaponId, a: number): [number, number] {
    const [fw, sd] = WEAPONS[w].muzzle, S = 4, p = this.p;
    return [p.x + Math.cos(a) * fw * S - Math.sin(a) * sd * S, p.y + Math.sin(a) * fw * S + Math.cos(a) * sd * S];
  }
  /** 총구로 가는 선분(0.35/0.6/0.8/1.0 지점 + 16px 앞)이 장애물 안이면 막힌다 */
  private gunBlockedNow(w: WeaponId, a: number): boolean {
    const p = this.p, [mx, my] = this.muzzle(w, a);
    for (const k of [0.35, 0.6, 0.8, 1.0]) { const ob = this.obstacleAt(p.x + (mx - p.x) * k, p.y + (my - p.y) * k); if (ob) return true; }
    return !!this.obstacleAt(mx + Math.cos(a) * 16, my + Math.sin(a) * 16);
  }
  private wallAhead(a: number, d: number): boolean { const p = this.p; for (let k = 16; k <= d; k += 16) { const ob = this.obstacleAt(p.x + Math.cos(a) * k, p.y + Math.sin(a) * k); if (ob && ob.type === 'wall') return true; } return false; }

  private startSeq(kind: Seqn['kind'], steps: Seq): void {
    const p = this.p; p.seq = { kind, steps, i: 0, t: 0 }; this.seqEvent(steps[0][2]);
  }
  private seqEvent(ev?: string): void {
    const p = this.p; if (!ev) return;
    if (ev === 'casing') this.emit({ t: 'casing', x: p.x, y: p.y, ang: p.aim, left: false, weapon: p.weapon });
    else if (ev === 'hit') this.meleeHit();
    else if (ev === 'release') this.releaseBomb();
  }
  private updatePlayer(inp: GInput): void {
    const p = this.p, o = this.opts;
    // 조준: 조준 입력 > (발사 중) 가장 가까운 적 > 이동 방향
    const hasAim = Math.hypot(inp.ax, inp.ay) > 0.2, m = Math.hypot(inp.mx, inp.my);
    if (p.seq?.kind !== 'roll') {
      if (hasAim) { p.aim = Math.atan2(inp.ay, inp.ax); if (o.assist && !inp.aimDist) { const t = this.nearestInCone(p.aim, 0.26); if (t) p.aim += norm(Math.atan2(t.y - p.y, t.x - p.x) - p.aim) * 0.5; } }
      else if (inp.fire) { const t = this.nearestEnemy(); if (t) p.aim = Math.atan2(t.y - p.y, t.x - p.x); else if (m > 0.15) p.aim = Math.atan2(inp.my, inp.mx); }
      else if (m > 0.15) p.aim = Math.atan2(inp.my, inp.mx);
    }
    p.gunBlocked = this.gunBlockedNow(p.weapon, p.aim);
    // 시퀀스 진행
    if (p.seq) { const sq = p.seq; if (++sq.t >= sq.steps[sq.i][1]) { sq.i++; sq.t = 0; if (sq.i >= sq.steps.length) { p.seq = null; p.stab = false; this.stabE = null; } else this.seqEvent(sq.steps[sq.i][2]); } }
    const sq = p.seq, canCancel = !sq || sq.kind === 'fire';
    // 구르기 / 근접 / 폭탄은 발사 시퀀스를 끊고 들어갈 수 있다
    if (inp.roll && p.rollCd <= 0 && canCancel) {
      p.rollAng = m > 0.15 ? Math.atan2(inp.my, inp.mx) : p.aim; p.rollCd = GROUND.rollCd; p.rollI = f(0.37); this.noise(p.x, p.y, 210); this.startSeq('roll', GROUND.rollSteps); this.emit({ t: 'roll', x: p.x, y: p.y, ang: p.rollAng });
    } else if (inp.melee && canCancel && this.tryAssassinate()) { /* 암살 시작 */
    } else if (inp.melee && canCancel && !this.wallAhead(p.aim, 85)) { this.startSeq('melee', GROUND.meleeSteps); this.emit({ t: 'swing', x: p.x, y: p.y, ang: p.aim }); this.noise(p.x, p.y, 260); }
    else if (inp.bomb && canCancel && this.bombCount(p.gsel) > 0 && !this.wallAhead(p.aim, 64)) { this.bombDist = inp.aimDist ?? 300; this.startSeq('throw', GROUND.throwSteps); this.emit({ t: 'throw' }); }
    // 이동
    const sk = p.seq?.kind;
    p.moving = false; p.sneaking = false;
    if (sk === 'roll') { const sp = GROUND.rollSpeed[p.seq!.i]; this.move(p, Math.cos(p.rollAng) * sp, Math.sin(p.rollAng) * sp, GROUND.moveR, true); }
    else if (m > 0.15) {
      const W = WEAPONS[p.weapon], base = sk === 'fire' ? W.move : sk === 'melee' ? 150 / 60 : sk === 'throw' ? 130 / 60 : GROUND.speed, sneak = !!inp.sneak && !sk, k = Math.min(1, m * (m > 1 ? 1 : 1.3)) * (sneak ? GROUND.sneakMul : 1);
      p.sneaking = sneak;
      if (!sneak && sk !== 'melee' && sk !== 'throw' && ((p.stepT = (p.stepT ?? 0) + 1) % GROUND.stepFrames === 0)) { this.noise(p.x, p.y, GROUND.stepNoise); this.emit({ t: 'step', x: p.x, y: p.y, r: GROUND.stepNoise }); }   // 평소 걸음은 작은 소리가 난다 (조심 걷기는 소리 없음)
      this.move(p, (inp.mx / (m || 1)) * base * k, (inp.my / (m || 1)) * base * k, GROUND.moveR, true); p.moving = true; p.walk += 1;
    }
    // 사격
    if (inp.fire && !p.gunBlocked && p.cd <= 0 && sk !== 'roll' && sk !== 'melee' && sk !== 'throw') {
      const W = WEAPONS[p.weapon];
      if (p.weapon === 'shotgun' ? !p.seq : true) this.fireWeapon(W);
    }
  }
  private bombDist = 300;
  private fireWeapon(W: WeaponDef): void {
    const p = this.p, o = this.opts, [mx, my] = this.muzzle(p.weapon, p.aim);
    const seq: Seq = p.weapon === 'smg' ? [[p.smgAlt++ % 2 ? 'shoot_b' : 'shoot_a', f(0.06)], ['aim', f(0.3)]] : W.seq;
    this.startSeq('fire', seq);
    p.cd = Math.max(2, Math.round(W.cd / o.rateMult)); p.kick = p.weapon === 'shotgun' ? 3 : 1.2; p.combatT = 600;
    for (let i = 0; i < W.pellets; i++) {
      const a = p.aim + (this.rng() * 2 - 1) * W.spread, sp = p.weapon === 'shotgun' ? W.speed * (0.9 + this.rng() * 0.2) : W.speed;
      this.bullets.push({ x: mx, y: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg: W.dmg * o.dmgMult * (o.pilot === 1 ? 1.15 : 1), friendly: true, w: p.weapon, life: W.life, dist: 0, pellet: W.pellets > 1, first: i === 0, pierce: W.pierce + (o.pilot === 2 ? 1 : 0), hit: [], dodged: false });
    }
    this.emit({ t: 'shot', weapon: p.weapon, x: mx, y: my, ang: p.aim });
    if (p.weapon === 'smg') this.emit({ t: 'casing', x: p.x, y: p.y, ang: p.aim, left: true, weapon: 'smg' }); else if (p.weapon !== 'shotgun' && p.weapon !== 'rail') this.emit({ t: 'casing', x: p.x, y: p.y, ang: p.aim, left: false, weapon: p.weapon });
    this.noise(p.x, p.y, W.noise);
    if (p.weapon !== 'pistol' && --p.ammo <= 0) { p.weapon = 'pistol'; p.ammo = Infinity; }
  }
  private nearestEnemy(): GEnemy | null {
    let best: GEnemy | null = null, bd = 1e9;
    for (const e of this.enemies) { const d = (e.x - this.p.x) ** 2 + (e.y - this.p.y) ** 2; if (d < bd && d < 900 * 900 && this.los(this.p.x, this.p.y, e.x, e.y)) { bd = d; best = e; } }
    return best;
  }
  private nearestInCone(aim: number, cone: number): GEnemy | null {
    let best: GEnemy | null = null, bd = 1e9;
    for (const e of this.enemies) { const da = Math.abs(norm(Math.atan2(e.y - this.p.y, e.x - this.p.x) - aim)), d = Math.hypot(e.x - this.p.x, e.y - this.p.y); if (da < cone && d < bd && d < 900 && this.los(this.p.x, this.p.y, e.x, e.y)) { bd = d; best = e; } }
    return best;
  }

  // ---------------------------------------------------------------- 근접 · 폭탄
  /** 암살 가능한 적: 경계 전 · 등 뒤 · 가까움 · 시야 있음 (헤비·개·포탑·드론·보스 제외). 씬이 머리 위 아이콘에 쓴다 */
  stabTarget(): GEnemy | null {
    const p = this.p; let best: GEnemy | null = null, bd = 1e9;
    for (const e of this.enemies) {
      if (e.dying || e.state !== 'idle' || (e.kind !== 'rifle' && e.kind !== 'charger' && e.kind !== 'sniper')) continue;
      const d = Math.hypot(p.x - e.x, p.y - e.y); if (d > GROUND.stabRange || d >= bd) continue;
      if (Math.abs(norm(Math.atan2(p.y - e.y, p.x - e.x) - e.ang)) <= GROUND.backCone) continue;   // 등 뒤가 아니다
      if (!this.los(p.x, p.y, e.x, e.y)) continue;
      best = e; bd = d;
    }
    return best;
  }
  private stabE: GEnemy | null = null; private stabbing = false;
  private tryAssassinate(): boolean {
    const e = this.stabTarget(), p = this.p; if (!e) return false;
    const a = Math.atan2(e.y - p.y, e.x - p.x); p.aim = a;
    const tx = e.x - Math.cos(a) * 46, ty = e.y - Math.sin(a) * 46;   // 등 뒤로 파고든다 (막혀 있으면 제자리에서)
    if (!this.obstacleAt(tx, ty) && this.los(p.x, p.y, tx, ty)) { p.x = tx; p.y = ty; }
    p.stab = true; this.stabE = e; this.startSeq('melee', GROUND.meleeSteps); this.emit({ t: 'assassinate', x: e.x, y: e.y, ang: a });
    return true;
  }
  private meleeHit(): void {
    if (this.p.stab) { const e = this.stabE; if (e && !e.dying && this.enemies.includes(e)) { this.stabbing = true; this.killEnemy(e, 'melee', this.p.aim); this.stabbing = false; } return; }   // 암살: 소리 없이 한 방, 주변은 건드리지 않는다
    const p = this.p, sector = (x: number, y: number, rng: number, half: number): boolean => Math.hypot(x - p.x, y - p.y) < rng && Math.abs(norm(Math.atan2(y - p.y, x - p.x) - p.aim)) < half;
    for (const e of this.enemies.slice()) if (sector(e.x, e.y, 165, 1.05) && this.los(p.x, p.y, e.x, e.y)) this.hitEnemy(e, 'melee', p.aim, 1, p.x, p.y);
    for (const c of this.crates) if (!c.broken && sector(c.x, c.y, 135, 1.0)) this.hurtCrate(c, 2);
    for (const d of this.doors) if (!d.broken && !d.locked && sector((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, 175, 1.1)) this.kickDoor(d);
    for (const w of this.windows) if (!w.broken && sector((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, 175, 1.0)) this.breakWindow(w);
  }
  private kickDoor(d: GDoor): void {
    const cx = (d.x0 + d.x1) / 2, cy = (d.y0 + d.y1) / 2;
    this.emit({ t: 'doorKick', x: cx, y: cy }); this.noise(cx, cy, 450);
    d.hp -= 3; if (d.hp <= 0) { this.breakDoor(d); } else this.pushDoor(d, this.p, GROUND.kickRate);
    for (const e of this.enemies.slice()) if (e.kind !== 'dog' && e.kind !== 'heavy' && e.kind !== 'boss' && e.kind !== 'turret' && this.circleRect(e, 70, d)) this.hitEnemy(e, 'door', Math.atan2(e.y - this.p.y, e.x - this.p.x), 1, cx, cy);
  }
  private hurtDoor(d: GDoor, dmg = 1): void { d.hp -= dmg; this.emit({ t: 'doorHit', x: (d.x0 + d.x1) / 2, y: (d.y0 + d.y1) / 2 }); if (d.hp <= 0) this.breakDoor(d); }
  private breakDoor(d: GDoor): void { if (d.broken) return; d.broken = true; this.emit({ t: 'doorBreak', x: (d.x0 + d.x1) / 2, y: (d.y0 + d.y1) / 2, o: d.o }); this.noise((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, 500); this.emit({ t: 'shake', v: 4 }); }
  private breakWindow(w: GWindow): void { if (w.broken) return; w.broken = true; this.emit({ t: 'windowBreak', x: (w.x0 + w.x1) / 2, y: (w.y0 + w.y1) / 2, o: w.o }); this.noise((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, 500); }
  private hurtCrate(c: GCrate, dmg = 1): void {
    if (c.broken) return; c.hp -= dmg; c.hitT = 8; this.emit({ t: 'crateHit', x: c.x, y: c.y });
    if (c.hp > 0) return;
    c.broken = true; this.emit({ t: 'crateBreak', x: c.x, y: c.y, barrel: c.kind === 'barrel' });
    if (c.kind === 'barrel') this.explode(c.x, c.y, true);   // 통: 폭발 (연쇄)
  }
  /** 은신 긴장도(소음기 은신 중에만): 같은 구역에서 경계 전인 가장 가까운 적이 가까울수록 1에 가깝다. 아니면 null (→ 음악 복귀) */
  get stealthLevel(): number | null {
    const p = this.p, s = this.section;
    if (p.weapon !== 'silenced' || this.alerted[s] || this.isBossRoom) return null;
    let d = 1e9; for (const e of this.enemies) if (e.section === s && e.state === 'idle' && !e.dying) d = Math.min(d, Math.hypot(e.x - p.x, e.y - p.y));
    return d >= 1e9 ? null : Math.max(0, Math.min(1, 1 - d / 800));
  }
  bombCount(t: BombType): number { return t === 'frag' ? this.p.grenades : t === 'flash' ? this.p.flashes : this.p.smokes; }
  private swapBomb(): void { const i = BOMB_TYPES.indexOf(this.p.gsel); this.p.gsel = BOMB_TYPES[(i + 1) % 3]; this.emit({ t: 'swap', to: this.p.gsel }); }
  private releaseBomb(): void {
    const p = this.p, a = p.aim, bx = p.x + Math.cos(a) * 12 * 4 - Math.sin(a) * 6 * 4, by = p.y + Math.sin(a) * 12 * 4 + Math.cos(a) * 6 * 4;
    const dist = Math.max(150, Math.min(480, this.bombDist)), [tx, ty] = this.rayEnd(p.x, p.y, a, dist), tt = Math.hypot(tx - bx, ty - by);
    const type = p.gsel; if (type === 'frag') p.grenades--; else if (type === 'flash') p.flashes--; else p.smokes--;
    this.bombs.push({ type, x: bx, y: by, sx: bx, sy: by, tx, ty, t: 0, flight: f(0.55 + tt / 800), fuse: type === 'frag' ? GROUND.bombFuse : f(type === 'flash' ? 1.2 : 0.9), bounce: 0 }); this.emit({ t: 'release', x: bx, y: by });
  }
  private updateBombs(): void {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i]; b.t++; const u = Math.min(1, b.t / b.flight); b.x = b.sx + (b.tx - b.sx) * u; b.y = b.sy + (b.ty - b.sy) * u;
      const ob = this.obstacleAt(b.x, b.y); if (ob?.type === 'window') this.breakWindow(ob.o as GWindow);   // 날아가다 유리창에 닿으면 깨지는 소리가 난다
      if (b.t >= b.fuse) { this.bombs.splice(i, 1); if (b.type === 'flash') this.flashBang(b.x, b.y); else if (b.type === 'smoke') this.smokeBomb(b.x, b.y); else this.explode(b.x, b.y, false); }
    }
  }
  /** 섬광탄: 시야가 있는 적을 2.5초 멈춰 세운다(보스는 0.5초). 소리는 크다 */
  private flashBang(x: number, y: number): void {
    const R = 420;
    this.emit({ t: 'flashbang', x, y, r: R }); this.emit({ t: 'shake', v: 8 }); this.noise(x, y, 700);
    for (const e of this.enemies) if (!e.dying && Math.hypot(e.x - x, e.y - y) < R && this.los(x, y, e.x, e.y, true)) { e.stunT = Math.max(e.stunT, e.kind === 'boss' ? 30 : f(2.5)); e.aimT = 0; e.hitPose = 0; }
    const p = this.p; if (Math.hypot(p.x - x, p.y - y) < 160 && this.los(x, y, p.x, p.y, true)) p.hitFlash = 30;   // 가까이서 터뜨리면 나도 눈이 부시다(연출)
  }
  /** 연막탄: 8초 동안 구름이 시선을 가린다. 조용하다 */
  private smokeBomb(x: number, y: number): void { this.smokes.push({ x, y, r: 150, t: 0, life: f(8) }); this.emit({ t: 'smoke', x, y, r: 150 }); this.noise(x, y, 150); }
  private updateSmokes(): void { for (let i = this.smokes.length - 1; i >= 0; i--) { const s = this.smokes[i]; s.t++; if (s.t > s.life) this.smokes.splice(i, 1); else if (s.life - s.t < 60) s.r *= 0.99; } }
  /** 폭발: 시야가 있는 곳만 (유리창도 막는다) */
  private explode(x: number, y: number, small: boolean): void {
    const R = small ? 170 : 230;
    this.emit({ t: 'boom', x, y, r: R }); this.emit({ t: 'shake', v: small ? 10 : 16 }); this.noise(x, y, small ? 900 : 1200);
    for (const e of this.enemies.slice()) if (Math.hypot(e.x - x, e.y - y) < R && this.los(x, y, e.x, e.y, true)) this.hitEnemy(e, 'bomb', Math.atan2(e.y - y, e.x - x), small ? 0.6 : 1, x, y);
    for (const d of this.doors) if (!d.broken && !d.locked && Math.hypot((d.x0 + d.x1) / 2 - x, (d.y0 + d.y1) / 2 - y) < 190 && this.los(x, y, (d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, true)) this.breakDoor(d);
    for (const w of this.windows) if (!w.broken && Math.hypot((w.x0 + w.x1) / 2 - x, (w.y0 + w.y1) / 2 - y) < 230 && this.los(x, y, (w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, true)) this.breakWindow(w);
    for (const c of this.crates) if (!c.broken && Math.hypot(c.x - x, c.y - y) < 170 && this.los(x, y, c.x, c.y, true)) this.hurtCrate(c, 9);
    if (Math.hypot(this.p.x - x, this.p.y - y) < 150 && this.los(x, y, this.p.x, this.p.y, true)) this.hurt(1, x, y);
  }

  // ---------------------------------------------------------------- 탄
  private updateBullets(): void {
    const p = this.p;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]; let gone = false;
      const sp = Math.hypot(b.vx, b.vy);
      for (let s = 0; s < 3 && !gone; s++) {
        b.x += b.vx / 3; b.y += b.vy / 3; b.dist += sp / 3;
        const ob = this.obstacleAt(b.x, b.y);
        if (ob) {
          if (ob.type === 'wall') { this.emit({ t: 'wallhit', x: b.x - b.vx / 3, y: b.y - b.vy / 3, ang: Math.atan2(b.vy, b.vx) }); gone = true; }
          else if (ob.type === 'door') { this.hurtDoor(ob.o as GDoor); gone = true; }
          else if (ob.type === 'crate') { this.hurtCrate(ob.o as GCrate); this.emit({ t: 'wallhit', x: b.x, y: b.y, ang: Math.atan2(b.vy, b.vx) }); gone = true; }
          else if (ob.type === 'window') { const w = ob.o as GWindow; if (!b.hit.includes(-w.id)) { b.hit.push(-w.id); w.hp--; this.emit({ t: 'windowHit', x: b.x, y: b.y }); if (w.hp <= 0) this.breakWindow(w); } }   // 유리창은 깨고 총알은 계속 날아간다
          if (gone) break;
        }
        if (b.friendly) {
          for (const e of this.enemies.slice()) {
            if (b.hit.includes(e.id)) continue;
            if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < (HIT_R[e.kind] + 3) ** 2) {
              const mult = b.w === 'shotgun' ? Math.max(0.25, Math.min(1, 1.25 - b.dist / 380)) : 1;
              this.hitEnemy(e, b.w, Math.atan2(b.vy, b.vx), mult, b.x, b.y, b.dmg / FEEL[b.w].dmg, b.first);
              b.hit.push(e.id); if (b.pierce-- <= 0) { gone = true; break; }
            }
          }
        } else if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 < (GROUND.hitR + 3) ** 2) {
          if (p.rollI > 0) { if (!b.dodged) { b.dodged = true; this.emit({ t: 'dodge', x: p.x, y: p.y }); this.score += 40; } }
          else if (p.invuln <= 0) { this.hurt(1, b.x, b.y, b.src); gone = true; }
        }
      }
      if (gone || --b.life <= 0) this.bullets.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- 적 피격 · 사망
  /** mult: 샷건 거리 감쇠 / dmgScale: 아군 피해 배율(빌드 보정). first: 샷건은 한 번 발사당 한 번만 히트스톱 */
  private hitEnemy(e: GEnemy, w: FeelKey, ang: number, mult: number, ix: number, iy: number, dmgScale = 1, first = true): void {
    if (e.dying) return;
    const F = FEEL[w], arm = ARMOR[e.kind]?.[w] ?? 1, dmg = F.dmg * dmgScale * mult * arm;
    e.hp -= dmg; e.hitT = F.flash; this.alertEnemy(e);
    const boss = e.kind === 'boss', turret = e.kind === 'turret';
    if (!boss && !turret) { e.hitPose = F.pose; e.stunT = Math.max(e.stunT, Math.round(F.stun * mult)); e.vx += Math.cos(ang) * F.knock * mult / (e.kind === 'heavy' ? 2.5 : 1); e.vy += Math.sin(ang) * F.knock * mult / (e.kind === 'heavy' ? 2.5 : 1); const vm = Math.hypot(e.vx, e.vy); if (vm > 1000) { e.vx *= 1000 / vm; e.vy *= 1000 / vm; } e.aimT = 0; e.windT = 0; }
    const kill = e.hp <= 0;
    this.emit({ t: 'hit', x: ix, y: iy, ang, w, kill, kind: e.kind, dmg, armor: arm < 1 });
    if (!kill) { if (first && F.stop) this.emit({ t: 'hitstop', frames: F.stop }); if (F.shake) this.emit({ t: 'shake', v: F.shake }); }
    for (const o of this.enemies) if (o !== e && o.state === 'idle' && o.section === e.section && Math.hypot(o.x - e.x, o.y - e.y) < GROUND.allyAlert && kill) this.alertEnemy(o);
    if (kill) this.killEnemy(e, w, ang);
  }
  private killEnemy(e: GEnemy, w: FeelKey, ang: number): void {
    const i = this.enemies.indexOf(e); if (i < 0) return;
    this.enemies.splice(i, 1); this.kills++; e.dying = true; e.w = w; e.fallT = 0;
    this.combo++; this.comboT = GROUND.comboFrames; this.maxCombo = Math.max(this.maxCombo, this.combo);
    const mult = 1 + 0.2 * Math.min(this.combo - 1, 10), pts = Math.round(ENEMY_DEF[e.kind].pts * mult);
    this.score += pts;
    if (e.state === 'idle' && e.kind !== 'boss' && e.kind !== 'drone') { const sp = Math.round(ENEMY_DEF[e.kind].pts * (this.stabbing ? 1.8 : w === 'melee' ? 1.2 : 0.6)); this.score += sp; this.stealthKills++; this.emit({ t: 'stealth', x: e.x, y: e.y, pts: sp, melee: w === 'melee' }); }   // 들키기 전에 처치(근접은 암살)
    const D = FEEL[w];
    e.deathAng = ang + (this.rng() - 0.5) * 0.5; const fd = Math.cos(e.ang - ang);
    e.fallF = fd > 0.35 ? true : fd < -0.35 ? false : this.rng() < 0.5;   // 등 뒤에서 맞으면 앞으로 엎어짐
    const boss = e.kind === 'boss';
    if (!boss) { e.vx = Math.cos(ang) * D.dKnock * (e.kind === 'heavy' ? 0.4 : 1); e.vy = Math.sin(ang) * D.dKnock * (e.kind === 'heavy' ? 0.4 : 1); } else { e.vx = 0; e.vy = 0; }
    this.emit({ t: 'kill', x: e.x, y: e.y, ang, w, kind: e.kind, pts, combo: this.combo });
    this.emit({ t: 'hitstop', frames: boss ? 12 : D.dStop }); this.emit({ t: 'shake', v: boss ? 16 : D.dShake }); if (D.dSlow || boss) this.emit({ t: 'slowmo', ms: boss ? 900 : D.dSlow, scale: boss ? 0.25 : 0.4 });
    const dr = DROPS[e.kind];
    if (dr && this.rng() < dr.p) { const ammo = Math.ceil(WEAPONS[dr.w].ammo * (0.35 + this.rng() * 0.3)); this.pickups.push({ id: this.nextId++, kind: 'weapon', weapon: dr.w, ammo, x: e.x, y: e.y, t: 0, section: e.section, dropped: true }); this.emit({ t: 'drop', x: e.x, y: e.y, weapon: dr.w }); }
    else if (BOMB_DROP[e.kind] && this.rng() < BOMB_DROP[e.kind]!) { this.pickups.push({ id: this.nextId++, kind: 'bomb', bt: ((r) => r < 0.5 ? 'frag' : r < 0.8 ? 'flash' : 'smoke')(this.rng()) as BombType, x: e.x, y: e.y, t: 0, section: e.section, dropped: true }); this.emit({ t: 'drop', x: e.x, y: e.y, weapon: 'pistol' }); }
    if (boss) { this.enemies = this.enemies.filter(b => b.kind !== 'drone'); for (const b of this.bullets) if (!b.friendly) b.life = 1; }
    this.dying.push(e);
  }
  private updateDying(): void {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const e = this.dying[i]; e.fallT++;
      const sp = Math.hypot(e.vx, e.vy);
      if (sp > 0.5) {
        const nx = e.x + e.vx / 60, ny = e.y + e.vy / 60;
        if (!this.obstacleAt(nx, e.y)) e.x = nx; else e.vx = 0;
        if (!this.obstacleAt(e.x, ny)) e.y = ny; else e.vy = 0;
        const k = Math.exp(-5 / 60); e.vx *= k; e.vy *= k;
        if (sp > 40) { e.smearD += sp / 60; if (e.smearD > 16) { e.smearD = 0; this.emit({ t: 'smear', x: e.x, y: e.y }); } }
      }
      if (e.fallT < 54 && e.fallT % 4 === 0) this.emit({ t: 'pool', x: e.x, y: e.y, r: 8 + (FEEL[e.w].dPool - 8) * Math.min(1, e.fallT / 54) });
      if (e.fallT > 69 && sp < 14) { this.emit({ t: 'stamp', x: e.x, y: e.y, ang: e.deathAng, fallF: e.fallF, kind: e.kind }); this.dying.splice(i, 1); }
    }
  }

  // ---------------------------------------------------------------- 플레이어 피해
  hurt(dmg: number, x: number, y: number, by?: GKind): void {
    const p = this.p; if (p.invuln > 0 || p.rollI > 0 || (this.state as string) === 'DEAD') return;
    p.hp -= dmg; p.invuln = GROUND.hurtInvuln; p.hitFlash = 18; this.combo = 0; this.comboT = 0;
    this.emit({ t: 'hurt', x, y, by }); this.emit({ t: 'shake', v: 8 }); this.emit({ t: 'hitstop', frames: 4 });
  }

  // ---------------------------------------------------------------- 적 AI
  private enemyShoot(e: GEnemy, ang: number, speed = GROUND.enemyBulletSpeed, acc = 0.1, kind: GBullet['kind'] = 'normal'): void {
    const mx = e.x + Math.cos(ang) * 56, my = e.y + Math.sin(ang) * 56 + 0;
    if (this.obstacleAt(mx, my) || this.obstacleAt(e.x + Math.cos(ang) * 36, e.y + Math.sin(ang) * 36)) return;   // 총구가 장애물 안이면 쏘지 않는다
    const a = ang + (this.rng() * 2 - 1) * acc;
    this.bullets.push({ x: mx, y: my, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, dmg: 1, friendly: false, w: 'rifle', life: GROUND.enemyBulletLife, dist: 0, pellet: false, first: false, pierce: 0, hit: [], dodged: false, src: e.kind, kind });
    e.shotT = f(0.1); e.fire = 6;
  }
  private sees(e: GEnemy): boolean {
    const p = this.p, dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
    const view = e.kind === 'sniper' ? 900 : e.kind === 'turret' ? 700 : GROUND.viewDist;
    if (!this.los(e.x, e.y, p.x, p.y) || this.smokeBlocks(e.x, e.y, p.x, p.y)) return false;
    const ang = Math.atan2(dy, dx), behind = Math.abs(norm(ang - e.ang)) > GROUND.backCone;   // 적 등 뒤 약 120°
    if (d < GROUND.nearSee) return behind ? d < GROUND.backSee : true;
    return d < view && Math.abs(norm(Math.atan2(dy, dx) - e.ang)) < GROUND.viewHalf;
  }
  private updateEnemies(): void {
    const p = this.p;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]; if (!e) continue;
      if (e.hitT > 0) e.hitT--; if (e.shotT > 0) e.shotT--; if (e.hitPose > 0) e.hitPose--; if (e.fire > 0) e.fire--; if (e.alertT > 0) e.alertT--;
      const dist = Math.hypot(p.x - e.x, p.y - e.y);
      if (e.state === 'idle' && dist > 1300) continue;
      // 넉백은 덮어쓰기 속도 (exp(-8t) 감속)
      const vs = Math.hypot(e.vx, e.vy);
      if (vs > 1) { const nx = e.x + e.vx / 60, ny = e.y + e.vy / 60; const r = BODY_R[e.kind]; const o = { x: nx, y: ny }; this.move(o, 0, 0, r); e.x = o.x; e.y = o.y; const k = Math.exp(-8 / 60); e.vx *= k; e.vy *= k; }
      const px0 = e.x, py0 = e.y;
      if (e.stunT > 0) { e.stunT--; e.moving = false; continue; }
      if (e.state === 'idle') {
        if (e.kind === 'turret') e.ang = e.base + Math.sin((this.frame + e.id * 31) * 0.02) * 1.2;
        else if (e.patrol && e.patrol.length > 1 && e.kind !== 'sniper') { const [wx, wy] = e.patrol[e.pi], a = Math.atan2(wy - e.y, wx - e.x), o = { x: e.x, y: e.y }; this.move(o, Math.cos(a) * 0.9, Math.sin(a) * 0.9, BODY_R[e.kind], false); e.x = o.x; e.y = o.y; e.ang += norm(a - e.ang) * 0.15; if (Math.hypot(wx - e.x, wy - e.y) < 28 || (Math.hypot(e.x - px0, e.y - py0) < 0.2 && ++e.moved > 30)) { e.pi = (e.pi + 1) % e.patrol.length; e.moved = 0; } }
        else e.ang = e.base + 0.35 * Math.sin((this.frame / 60 + e.look) * 2.29);
        if (e.kind === 'boss') { if (this.section === 3 && (this.sees(e) || dist < 700)) this.alertEnemy(e); else { e.ang = Math.atan2(p.y - e.y, p.x - e.x); continue; } }
        else if (e.kind !== 'drone' && this.sees(e)) this.alertEnemy(e);
        e.moving = Math.hypot(e.x - px0, e.y - py0) > 0.3; if (e.moving) e.walk++;
        continue;
      }
      this.combat(e, dist);
      e.moving = Math.hypot(e.x - px0, e.y - py0) > 0.3; if (e.moving) e.walk++;
    }
  }
  private chase(e: GEnemy, sp: number, los: boolean, toP: number): void {
    const r = BODY_R[e.kind];
    if (los) this.move(e, Math.cos(toP) * sp, Math.sin(toP) * sp, r, true); else this.stepFlow(e, this.playerFlow(), sp, r, true);
  }
  private combat(e: GEnemy, dist: number): void {
    const p = this.p, los = this.los(e.x, e.y, p.x, p.y) && !this.smokeBlocks(e.x, e.y, p.x, p.y), toP = Math.atan2(p.y - e.y, p.x - e.x), D = ENEMY_DEF[e.kind];
    switch (e.kind) {
      case 'rifle': case 'heavy': case 'sniper': {
        const range = e.kind === 'sniper' ? 880 : 380, hold = e.kind === 'sniper' ? 520 : 240;
        if (los) e.ang = toP;
        if (e.aimT > 0) { if (los) e.ang = toP; if (--e.aimT === 0) { if (e.kind === 'heavy') { for (let k = -2; k <= 2; k++) this.enemyShoot(e, toP + k * 0.16, GROUND.enemyBulletSpeed * 0.85, 0.04); } else if (e.kind === 'sniper') this.enemyShoot(e, e.ang, 24, 0.01, 'sniper'); else this.enemyShoot(e, toP); e.cd = f(1.3) + Math.floor(this.rng() * f(1.1)) + (e.kind === 'heavy' ? 50 : 0); if (e.kind === 'sniper') e.cd += 90; } break; }
        if (los && dist <= range && e.cd <= 0) { e.aimT = e.kind === 'sniper' ? f(1.0) : e.kind === 'heavy' ? f(0.6) : f(0.45); break; }
        if (e.cd > 0) e.cd--;
        if (!los || dist > hold) this.chase(e, D.speed, los, toP);
        break;
      }
      case 'charger': {
        if (e.windT > 0) { if (e.windT > 12) { e.lx = p.x; e.ly = p.y; } e.ang = Math.atan2(e.ly - e.y, e.lx - e.x); if (--e.windT === 0) e.dashT = f(0.45); break; }
        if (e.dashT > 0) {
          e.dashT--; const a = Math.atan2(e.ly - e.y, e.lx - e.x), x0 = e.x, y0 = e.y; this.move(e, Math.cos(a) * 11, Math.sin(a) * 11, BODY_R[e.kind], true);
          if (Math.hypot(e.x - x0, e.y - y0) < 3) e.dashT = Math.min(e.dashT, 1);
          if (!e.styled && Math.hypot(p.x - e.x, p.y - e.y) < BODY_R.charger + GROUND.hitR) { if (p.rollI > 0) { e.styled = true; this.styles++; this.score += 250; this.emit({ t: 'style', x: p.x, y: p.y }); this.emit({ t: 'slowmo', ms: 220, scale: 0.35 }); } else this.hurt(1, e.x, e.y, 'charger'); }
          if (e.dashT === 0) { e.stunT = f(0.7); e.styled = false; e.cd = f(1.2); }
          break;
        }
        e.ang = los ? toP : e.ang; if (e.cd > 0) e.cd--;
        this.chase(e, D.speed * 1.5, los, toP);
        if (los && dist < 460 && e.cd <= 0) e.windT = f(0.6);
        break;
      }
      case 'dog': {
        e.ang = los ? toP : e.ang; this.chase(e, D.speed, los, toP);
        if (e.cd > 0) e.cd--;
        if (dist < 78 && e.cd <= 0) { this.hurt(1, e.x, e.y, 'dog'); e.cd = 40; e.shotT = 8; }
        break;
      }
      case 'turret': {
        if (los && dist < 760) { e.ang = toP; if (--e.cd <= 0) { for (let k = -1; k <= 1; k++) this.enemyShoot(e, toP + k * 0.22, GROUND.enemyBulletSpeed * 0.8, 0.03); e.cd = f(2.4); } } else e.ang += 0.02;
        break;
      }
      case 'drone': {
        e.ang = toP; const o = { x: e.x + Math.cos(toP) * D.speed, y: e.y + Math.sin(toP) * D.speed }; e.x = o.x; e.y = o.y;   // 비행: 벽에 걸리지 않는다
        if (dist < BODY_R.drone + GROUND.hitR) { this.hurt(1, e.x, e.y, 'drone'); this.emit({ t: 'boom', x: e.x, y: e.y, r: 70 }); this.enemies.splice(this.enemies.indexOf(e), 1); }
        break;
      }
      case 'boss': this.updateBoss(e, toP); break;
    }
  }
  private updateBoss(e: GEnemy, toP: number): void {
    const p = this.p, hpK = e.hp / e.maxHp, phase = hpK > 0.66 ? 1 : hpK > 0.33 ? 2 : 3;
    const X0 = 150, X1 = WORLD_W - 150, Y0 = 4 * TILE, Y1 = 32 * TILE;
    if (phase > e.phase) {
      e.phase = phase; e.windT = 0; e.dashT = 0; e.cd = 60;
      this.emit({ t: 'bossPhase', phase }); this.emit({ t: 'shake', v: 12 }); this.emit({ t: 'slowmo', ms: 500, scale: 0.3 });
      if (phase >= 2) for (let k = 0; k < 4; k++) { const d = this.addEnemy('drone', X0 + k * 230, Y0 - 100); d.state = 'alert'; }
      const [sx, sy] = this.freeSpot(); this.pickups.push(phase === 2 ? { id: this.nextId++, kind: 'weapon', weapon: 'smg', ammo: WEAPONS.smg.ammo, x: sx, y: sy, t: 0, section: 3 } : { id: this.nextId++, kind: 'heart', x: sx, y: sy, t: 0, section: 3 });
    }
    e.ang = toP;
    if (e.windT > 0) { if (e.windT > 14) { e.lx = p.x; e.ly = p.y; } if (--e.windT === 0) e.dashT = 36; return; }
    if (e.dashT > 0) {
      const a = Math.atan2(e.ly - e.y, e.lx - e.x), x0 = e.x, y0 = e.y; e.x += Math.cos(a) * 20; e.y += Math.sin(a) * 20; e.x = Math.max(X0, Math.min(X1, e.x)); e.y = Math.max(Y0, Math.min(Y1, e.y));
      if (Math.hypot(p.x - e.x, p.y - e.y) < BODY_R.boss + GROUND.hitR - 20) { if (p.rollI > 0) { if (!e.styled) { e.styled = true; this.styles++; this.score += 500; this.emit({ t: 'style', x: p.x, y: p.y }); this.emit({ t: 'slowmo', ms: 260, scale: 0.35 }); } } else this.hurt(1, e.x, e.y, 'boss'); }
      const stuck = Math.hypot(e.x - x0, e.y - y0) < 4;
      if (--e.dashT <= 0 || stuck) { e.dashT = 0; e.stunT = 110; e.styled = false; this.emit({ t: 'shake', v: 10 }); this.emit({ t: 'boom', x: e.x, y: e.y, r: 170 }); for (let k = 0; k < 8; k++) this.enemyShoot(e, (k / 8) * Math.PI * 2 + 0.2, GROUND.enemyBulletSpeed * 0.55, 0); }
      return;
    }
    // 평소: 플레이어 위쪽을 따라다니며 가틀링 + 어깨 포 부채꼴
    const ty = Math.max(Y0, Math.min(p.y - 800, 12 * TILE)), dx = p.x - e.x;
    e.x += Math.max(-1.4, Math.min(1.4, dx * 0.02)); e.y += (Math.max(Y0, Math.min(Y1, ty)) - e.y) * 0.03;
    const rate = phase === 3 ? 8 : 10; e.burst++;
    if (e.burst % 150 < 30 && e.burst % rate === 0) this.enemyShoot(e, toP + 0.2 * Math.sin(e.burst * 0.1), GROUND.enemyBulletSpeed * 0.75, 0.08);
    if (--e.cd <= 0) {
      for (let k = -2; k <= 2; k++) this.enemyShoot(e, Math.PI / 2 + k * 0.4, GROUND.enemyBulletSpeed * 0.55, 0);
      e.cd = phase === 1 ? 170 : 140;
      if (phase >= 3) for (let k = 0; k < 2; k++) this.emit({ t: 'boom', x: p.x + (this.rng() - 0.5) * 300, y: p.y + (this.rng() - 0.5) * 300, r: 110 });
      if (phase >= 2 && this.rng() < 0.4) e.windT = 60;
    }
  }
  private freeSpot(): [number, number] {
    const p = this.p;
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2 + 0.7, d = 150 + (i % 3) * 50, x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d; if (this.obstacleAt(x, y) || this.pickups.some(k => Math.hypot(k.x - x, k.y - y) < 80)) continue; return [x, y]; }
    return [p.x, p.y + 120];
  }

  // ---------------------------------------------------------------- 아이템
  private updatePickups(inp: GInput): void {
    const p = this.p;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i]; k.t++;
      if (Math.hypot(p.x - k.x, p.y - k.y) > 54) continue;
      if (k.kind === 'bomb') { const bt = k.bt ?? 'frag'; if (this.bombCount(bt) >= (bt === 'frag' ? GROUND.grenadeMax : 3)) continue; if (bt === 'frag') p.grenades++; else if (bt === 'flash') p.flashes++; else p.smokes++; this.emit({ t: 'pickup', what: 'bomb', x: k.x, y: k.y }); this.pickups.splice(i, 1); continue; }
      if (k.kind === 'heart') { if (p.hp >= p.maxHp) continue; p.hp = Math.min(p.maxHp, p.hp + 2); this.emit({ t: 'pickup', what: 'heart', x: k.x, y: k.y }); this.pickups.splice(i, 1); continue; }
      if (p.pickCd > 0) continue;
      const free = p.weapon === 'pistol' || p.ammo <= 0;
      if (!free && !inp.pickup) continue;
      if (!free) this.pickups.push({ id: this.nextId++, kind: 'weapon', weapon: p.weapon, ammo: p.ammo, x: k.x, y: k.y, t: 0, section: k.section, dropped: true });
      p.weapon = k.weapon!; p.ammo = k.ammo ?? WEAPONS[p.weapon].ammo; p.pickCd = 30; p.seq = null;
      this.emit({ t: 'pickup', what: 'weapon', x: k.x, y: k.y }); this.pickups.splice(i, 1);
    }
  }
  nearWeapon(): GPickup | null { return this.pickups.find(k => k.kind === 'weapon' && Math.hypot(this.p.x - k.x, this.p.y - k.y) < 60) ?? null; }

  result(): { win: boolean; score: number; kills: number; rooms: number; maxCombo: number; styles: number; hpLeft: number; rescued: boolean } {
    return { rescued: this.hostage?.state === 'safe', win: this.state === 'WIN', score: this.score, kills: this.kills, rooms: this.reached + (this.state === 'WIN' ? 1 : 0), maxCombo: this.maxCombo, styles: this.styles, hpLeft: this.p.hp };
  }
}
