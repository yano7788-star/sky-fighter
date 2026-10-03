import Phaser from 'phaser';
import { H, STEP_MS, W } from '../core/config';
import { FEEL, GroundSim, WEAPONS, type GBullet, type GDoor, type GEnemy, type GEvent, type GInput, type GKind, type WeaponId } from '../core/ground';
import { ART, COLS, ROWS, SECTIONS, TILE, WORLD_H, WORLD_W, sectionOfRow } from '../core/groundmap';
import type { Sim } from '../core/sim';
import { textStyle } from '../render/hud';
import { R } from '../render/textures';
import { audio } from '../systems/audio';
import type { GroundTest } from '../groundtest';

const CUTS = ['cut_shotdown', 'cut_landing', 'cut_takeoff'];
const Z = 0.5;   // 월드 px → 논리 px (R=2 와 곱해 월드 1px = 화면 1px, 도트 1개 = 화면 4px: 정수 배율)
const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
const VIEW_W = W / Z, VIEW_H = H / Z;   // 한 화면에 보이는 월드 크기 (900 × 1600)

/** 무기 시트의 행 번호 (오른쪽 한 열) */
const ROW: Record<WeaponId, Record<string, number>> = {
  shotgun: { idle: 0, walk_a: 1, walk_b: 2, aim: 3, shoot: 4, pump_back: 5, pump_fwd: 6, melee_1: 7, melee_2: 8, melee_3: 9 },
  pistol: { idle: 0, walk_a: 1, walk_b: 2, shoot: 3, melee_1: 4, melee_2: 5, melee_3: 6 },
  rifle: { idle: 0, walk_a: 1, walk_b: 2, shoot: 3, melee_1: 4, melee_2: 5, melee_3: 6 },
  rail: { idle: 0, walk_a: 1, walk_b: 2, shoot: 3, melee_1: 4, melee_2: 5, melee_3: 6 },
  smg: { idle: 0, walk_a: 1, walk_b: 2, aim: 3, shoot_a: 4, shoot_b: 5, melee_1: 6, melee_2: 7, melee_3: 8 },
};
const FOE_ROW = { idle: 0, walk_a: 1, walk_b: 2, aim: 3, shoot: 4, hit: 5 };
const FOE_SHEET: Partial<Record<GKind, string>> = { rifle: 'gs_foe_rifle', charger: 'gs_foe_charger', sniper: 'gs_foe_sniper', heavy: 'gs_foe_heavy' };
const SCALE_OF: Record<GKind, number> = { rifle: 4, charger: 4.3, sniper: 4, heavy: 5.2, dog: 4, drone: 4, turret: 4, boss: 4 };
/** 구역별 분위기: 바닥 두 색 · 줄눈 · 네온 경계선 */
const STYLE = [
  { base: [74, 79, 87], alt: [66, 71, 79], line: [44, 48, 55], neon: '#35e0ff' },    // 옥상 (콘크리트)
  { base: [43, 62, 72], alt: [38, 55, 65], line: [26, 38, 46], neon: '#ff4fd8' },    // 1층 (청록 타일)
  { base: [62, 55, 44], alt: [56, 49, 39], line: [38, 32, 24], neon: '#ffb02e' },    // 2층 (황갈 타일)
  { base: [62, 68, 78], alt: [55, 60, 70], line: [36, 40, 48], neon: '#ff4d4d' },    // 격납고 (강판)
];

type Stage = 'INTRO' | 'PLAY' | 'OUTRO' | 'DEAD' | 'END';
interface Prt { k: 'blood' | 'mist' | 'gib' | 'spark' | 'dust' | 'wood' | 'glass' | 'smoke' | 'casing'; x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; c: number; a: number }
interface Pop { x: number; y: number; life: number; text: string; color: string; size: number }
interface EnemyView { img: Phaser.GameObjects.Image; extra: Phaser.GameObjects.Image | null }
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/**
 * 지상전 「강하」 (핫라인 마이애미식): 3스테이지 보스 직후 본편(GameScene)을 멈추고 이 씬을 위에 띄운다.
 *  컷(격추) → 줌인+모자이크 → 컷(착지) → 옥상에서 건물 두 층을 거쳐 격납고까지 걸어 올라가는 정탑다운 도트 → 컷(이륙) → 본편 복귀.
 * 규칙은 core/ground.ts(GroundSim), 이 씬은 입력·연출·렌더만 맡는다. 월드 4px = 도트 1개, 화면 1:1 정수 배율.
 */
export class GroundScene extends Phaser.Scene {
  private sim!: Sim;
  private g!: GroundSim;
  private stage: Stage = 'INTRO';
  private root!: Phaser.GameObjects.Container;
  private world!: Phaser.GameObjects.Container;
  private ui!: Phaser.GameObjects.Container;
  private decals: Phaser.GameObjects.RenderTexture[] = [];
  private objG!: Phaser.GameObjects.Graphics;
  private shadowG!: Phaser.GameObjects.Graphics;
  private partG!: Phaser.GameObjects.Graphics;
  private bulletG!: Phaser.GameObjects.Graphics;
  private topG!: Phaser.GameObjects.Graphics;
  private hudG!: Phaser.GameObjects.Graphics;
  private pickupLayer!: Phaser.GameObjects.Container;
  private dyingLayer!: Phaser.GameObjects.Container;
  private actorLayer!: Phaser.GameObjects.Container;
  private playerImg!: Phaser.GameObjects.Image;
  private stampImg!: Phaser.GameObjects.Image;
  private glow!: Phaser.GameObjects.Image;
  private boomSprites: Phaser.GameObjects.Sprite[] = [];
  private enemyImgs = new Map<number, EnemyView>();
  private dyingImgs = new Map<number, Phaser.GameObjects.Image>();
  private pickupImgs = new Map<number, Phaser.GameObjects.Image>();
  private cutImg!: Phaser.GameObjects.Image;
  private hudText!: Record<string, Phaser.GameObjects.Text>;
  private popTexts: Phaser.GameObjects.Text[] = [];
  private banner!: Phaser.GameObjects.Text;
  private bannerT = 0;
  private veil!: Phaser.GameObjects.Rectangle;
  private redFlash!: Phaser.GameObjects.Rectangle;
  private whiteFlash!: Phaser.GameObjects.Rectangle;
  private pixel: Phaser.FX.Pixelate | null = null;
  private caps: Phaser.GameObjects.Text[] = [];
  private prts: Prt[] = [];
  private pops: Pop[] = [];
  private cam = { x: 0, y: WORLD_H - VIEW_H };
  private kick = { x: 0, y: 0 };
  private cross = { spread: 0, hit: 0, kill: 0 };
  private glowT = 0; private glowBig = false;
  private stampBudget = 0;
  private test: GroundTest | null = null;

  private keys = new Set<string>();
  private mouse = { x: W / 2, y: H / 2, used: false, down: false };
  private moveStick = { id: -1, ax: 0, ay: 0, vx: 0, vy: 0 };
  private aimStick = { id: -1, ax: 0, ay: 0, vx: 0, vy: 0 };
  private rollQ = false; private meleeQ = false; private bombQ = false; private pickQ = false;
  private touchMode = false;
  private acc = 0; private hitStop = 0; private shake = 0; private slowUntil = 0; private slowScale = 1;
  private paused = false; private quitArmed = false;
  private tutorialT = 0; private deadTimer = 0; private finished = false;
  private ovT?: Phaser.GameObjects.Text;

  constructor() { super('GroundScene'); }

  init(data: { sim: Sim; test?: GroundTest }): void {
    this.sim = data.sim; this.test = data.test ?? null; this.stage = 'INTRO'; this.finished = false; this.paused = false; this.quitArmed = false; this.keys.clear();
    this.enemyImgs = new Map(); this.dyingImgs = new Map(); this.pickupImgs = new Map(); this.decals = []; this.boomSprites = []; this.popTexts = [];
    this.acc = 0; this.hitStop = 0; this.shake = 0; this.slowUntil = 0; this.slowScale = 1; this.deadTimer = 0; this.bannerT = 0; this.pixel = null; this.caps = [];
    this.prts = []; this.pops = []; this.kick = { x: 0, y: 0 }; this.cross = { spread: 0, hit: 0, kill: 0 }; this.glowT = 0; this.cam = { x: 0, y: WORLD_H - VIEW_H };
    this.moveStick = { id: -1, ax: 0, ay: 0, vx: 0, vy: 0 }; this.aimStick = { id: -1, ax: 0, ay: 0, vx: 0, vy: 0 }; this.ovT = undefined;
  }

  preload(): void {
    this.load.setPath('assets/img/');
    for (const n of CUTS) if (!this.textures.exists(n)) this.load.image(n, `${n}.webp?v=${__BUILD__}`);
  }

  create(): void {
    const seed = (Math.floor(this.sim.score) * 31 + this.sim.frame) >>> 0;
    this.g = new GroundSim({ ...this.sim.groundOpts(seed), ...(this.test ? { pilot: this.test.pilot } : {}) });
    if (this.test && (this.test.section > 0 || this.test.weapon !== 'pistol')) this.g.debugStart(this.test.section, this.test.weapon);
    this.cameras.main.setBackgroundColor('#000000');
    this.root = this.add.container(0, 0).setScale(R);
    this.world = this.add.container(0, 0).setScale(Z);
    this.ui = this.add.container(0, 0);
    this.root.add([this.world, this.ui]);
    if (!this.anims.exists('gs_boom')) this.anims.create({ key: 'gs_boom', frames: this.anims.generateFrameNumbers('gs_explosion', { start: 0, end: 6 }), frameRate: 16, repeat: 0 });
    this.buildWorld();
    this.buildHud();
    this.cutImg = this.add.image(0, 0, 'cut_shotdown').setOrigin(0, 0).setVisible(false);
    this.root.add(this.cutImg);
    this.veil = this.add.rectangle(0, 0, W, H, 0x000000, 1).setOrigin(0, 0);
    this.redFlash = this.add.rectangle(0, 0, W, H, 0xff2222, 0).setOrigin(0, 0);
    this.whiteFlash = this.add.rectangle(0, 0, W, H, 0xffffff, 0).setOrigin(0, 0);
    this.root.add([this.veil, this.redFlash, this.whiteFlash]);
    this.bindInput();
    this.world.setVisible(false); this.ui.setVisible(false);
    if (this.test?.skipIntro) { this.world.setVisible(true); this.ui.setVisible(true); this.veil.setAlpha(0); this.stage = 'PLAY'; this.tutorialT = 60 * 7; }
    else this.runIntro();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { audio.resume(); });
  }

  // ---------------------------------------------------------------- 월드 구성: 구역마다 바닥/벽 캔버스(도트 해상도) + 데칼 RT
  private buildWorld(): void {
    const floorImgs: Phaser.GameObjects.Image[] = [], wallImgs: Phaser.GameObjects.Image[] = [];
    for (const sec of SECTIONS) {
      const rows = sec.r1 - sec.r0 + 1, w = COLS * 16, h = rows * 16, fk = `gt_f${sec.id}`, wk = `gt_w${sec.id}`;
      for (const k of [fk, wk]) if (this.textures.exists(k)) this.textures.remove(k);
      const ft = this.textures.createCanvas(fk, w, h)!, wt = this.textures.createCanvas(wk, w, h)!;
      this.drawChunk(sec.id, ft.getContext(), wt.getContext());
      ft.refresh(); wt.refresh(); ft.setFilter(Phaser.Textures.FilterMode.NEAREST); wt.setFilter(Phaser.Textures.FilterMode.NEAREST);
      floorImgs.push(this.add.image(0, sec.r0 * TILE, fk).setOrigin(0, 0).setScale(ART)); wallImgs.push(this.add.image(0, sec.r0 * TILE, wk).setOrigin(0, 0).setScale(ART));
      const rt = this.add.renderTexture(0, sec.r0 * TILE, w, h).setOrigin(0, 0).setScale(ART); rt.texture.setFilter(Phaser.Textures.FilterMode.NEAREST); this.decals.push(rt);
    }
    this.shadowG = this.add.graphics(); this.objG = this.add.graphics(); this.partG = this.add.graphics(); this.bulletG = this.add.graphics(); this.topG = this.add.graphics();
    this.pickupLayer = this.add.container(0, 0); this.dyingLayer = this.add.container(0, 0); this.actorLayer = this.add.container(0, 0);
    this.playerImg = this.add.image(0, 0, 'gs_pistol', 0).setScale(ART);
    this.stampImg = this.add.image(0, 0, 'gs_foe_rifle', 9).setVisible(false);
    this.glow = this.add.image(0, 0, 'dot').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffd27a).setVisible(false);
    this.world.add([...floorImgs, ...this.decals, this.shadowG, this.objG, this.pickupLayer, this.dyingLayer, this.actorLayer, this.partG, this.bulletG, this.playerImg, ...wallImgs, this.topG, this.glow]);
  }

  /** 한 구역의 바닥·벽을 캔버스(도트 1px = 월드 4px)에 그린다: 타일 16×16 도트 */
  private drawChunk(s: number, fc: CanvasRenderingContext2D, wc: CanvasRenderingContext2D): void {
    const sec = SECTIONS[s], st = STYLE[s], tiles = this.g.tiles;
    const rgb = (a: number[]) => `rgb(${a[0]},${a[1]},${a[2]})`;
    const isWall = (c: number, r: number) => c < 0 || c >= COLS || r < 0 || r >= ROWS || tiles[r * COLS + c] === 1;
    for (let r = sec.r0; r <= sec.r1; r++) for (let c = 0; c < COLS; c++) {
      const x = c * 16, y = (r - sec.r0) * 16, h = ((c * 73856093) ^ (r * 19349663)) >>> 0;
      if (isWall(c, r)) { fc.fillStyle = '#0c0d10'; fc.fillRect(x, y, 16, 16); continue; }
      fc.fillStyle = rgb((c + r) % 2 === 0 ? st.base : st.alt); fc.fillRect(x, y, 16, 16);
      if (s === 1 || s === 2) { fc.fillStyle = rgb(st.line); fc.fillRect(x, y + 7, 16, 1); fc.fillRect(x + 7, y, 1, 16); fc.fillStyle = 'rgba(255,255,255,.05)'; fc.fillRect(x + 1, y + 1, 6, 1); fc.fillRect(x + 9, y + 9, 6, 1); }
      else if (s === 0) { fc.fillStyle = rgb(st.line); fc.fillRect(x, y, 16, 1); fc.fillRect(x, y, 1, 16); for (let i = 0; i < 6; i++) { const q = (h >>> (i * 3)) & 255; fc.fillStyle = q & 1 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.16)'; fc.fillRect(x + 2 + (q % 12), y + 2 + ((q >> 3) % 12), 1, 1); } if (h % 11 === 0) { fc.fillStyle = rgb(st.line); fc.fillRect(x + 3, y + 5, 4, 1); fc.fillRect(x + 6, y + 6, 3, 1); fc.fillRect(x + 8, y + 7, 2, 1); } }
      else { fc.fillStyle = rgb(st.line); fc.fillRect(x, y, 16, 1); fc.fillRect(x, y, 1, 16); fc.fillStyle = 'rgba(255,255,255,.10)'; fc.fillRect(x + 1, y + 1, 1, 1); fc.fillRect(x + 14, y + 1, 1, 1); fc.fillRect(x + 1, y + 14, 1, 1); fc.fillRect(x + 14, y + 14, 1, 1); if (h % 9 === 0) { fc.fillStyle = 'rgba(0,0,0,.18)'; fc.fillRect(x + 4, y + 4, 8, 8); } }
    }
    // 벽이 바닥에 드리우는 그림자(+2,+2 도트) → 벽 윗면 → 네온 경계선
    fc.fillStyle = 'rgba(0,0,0,.38)';
    for (let r = sec.r0; r <= sec.r1; r++) for (let c = 0; c < COLS; c++) if (isWall(c, r)) fc.fillRect(c * 16 + 2, (r - sec.r0) * 16 + 2, 16, 16);
    for (let r = sec.r0; r <= sec.r1; r++) for (let c = 0; c < COLS; c++) {
      if (!isWall(c, r)) continue;
      const x = c * 16, y = (r - sec.r0) * 16, h = ((c * 83492791) ^ (r * 2654435761)) >>> 0;
      wc.fillStyle = '#14161b'; wc.fillRect(x, y, 16, 16);
      if (h % 4 === 0) { wc.fillStyle = '#191c22'; wc.fillRect(x + 3, y + 3, 6, 5); }
      for (const [dx, dy, sx, sy, sw, sh] of [[0, -1, x, y, 16, 1], [0, 1, x, y + 15, 16, 1], [-1, 0, x, y, 1, 16], [1, 0, x + 15, y, 1, 16]] as [number, number, number, number, number, number][]) {
        if (isWall(c + dx, r + dy)) continue;
        wc.fillStyle = st.neon; wc.fillRect(sx, sy, sw, sh);   // 바닥 쪽 경계의 네온선
        fc.fillStyle = st.neon + '40'; const nx = (c + dx) * 16, ny = (r + dy - sec.r0) * 16;   // 바닥 쪽으로 번지는 약한 글로우
        if (dx) fc.fillRect(dx > 0 ? nx : nx + 14, ny, 2, 16); else fc.fillRect(nx, dy > 0 ? ny : ny + 14, 16, 2);
      }
    }
  }

  // ---------------------------------------------------------------- HUD
  private buildHud(): void {
    this.hudG = this.add.graphics();
    this.ui.add(this.hudG);
    const t = (x: number, y: number, size: number, color: string, ox = 0, oy = 0) => { const o = this.add.text(x, y, '', textStyle(size, color)).setOrigin(ox, oy); o.setShadow(0, 1, '#000', 3, true, true); this.ui.add(o); return o; };
    this.hudText = {
      room: t(W / 2, 12, 13, '#e2e8f0', 0.5, 0), score: t(W - 12, 12, 13, '#fde68a', 1, 0), weapon: t(12, H - 46, 14, '#e2e8f0', 0, 0), grenade: t(12, H - 26, 12, '#cbd5e1', 0, 0),
      combo: t(W / 2, 100, 18, '#fbbf24', 0.5, 0.5), boss: t(W / 2, 40, 12, '#fca5a5', 0.5, 0), hint: t(W / 2, H - 120, 13, '#e2e8f0', 0.5, 0.5), left: t(W / 2, 28, 11, '#94a3b8', 0.5, 0),
      roll: t(W - 46, H - 244, 10, '#94a3b8', 0.5, 0.5), melee: t(W - 46, H - 314, 10, '#94a3b8', 0.5, 0.5), bomb: t(W - 46, H - 384, 10, '#94a3b8', 0.5, 0.5), pick: t(W - 46, H - 454, 10, '#fde68a', 0.5, 0.5),
    };
    this.banner = this.add.text(W / 2, H * 0.4, '', { ...textStyle(34, '#ffffff'), stroke: '#02060e', strokeThickness: 6 }).setOrigin(0.5).setAlpha(0);
    this.ui.add(this.banner);
  }

  // ---------------------------------------------------------------- 입력
  private bindInput(): void {
    const kb = this.input.keyboard!;
    kb.on('keydown', (e: KeyboardEvent) => {
      audio.unlock();
      const k = e.key.toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'tab'].includes(k)) e.preventDefault();
      if (this.keys.has(k)) return;
      this.keys.add(k);
      if (k === 'p' || k === 'escape') { this.setPaused(!this.paused); return; }
      if (this.stage === 'DEAD' && (k === 'r' || k === 'enter' || k === ' ')) { this.deadConfirm(); return; }
      if (this.paused) { if (k === 'enter') this.setPaused(false); else if (k === 't') this.pressQuit(); return; }
      if (k === 'shift' || k === ' ') this.rollQ = true;
      if (k === 'f') this.meleeQ = true;
      if (k === 'g' || k === 'q') this.bombQ = true;
      if (k === 'e') this.pickQ = true;
    });
    kb.on('keyup', (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase()));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.pointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.pointerMove(p));
    const up = (p: Phaser.Input.Pointer) => this.pointerUp(p);
    this.input.on('pointerup', up); this.input.on('pointerupoutside', up);
    this.input.mouse?.disableContextMenu();
    const onBlur = () => this.keys.clear();
    window.addEventListener('blur', onBlur);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('blur', onBlur));
  }
  private lx(p: Phaser.Input.Pointer): number { return p.x / R; }
  private ly(p: Phaser.Input.Pointer): number { return p.y / R; }
  private inBtn(x: number, y: number, bx: number, by: number): boolean { return Math.hypot(x - bx, y - by) < 36; }
  private btnPos(i: number): [number, number] { return [W - 46, H - 244 - i * 70]; }

  private pointerDown(p: Phaser.Input.Pointer): void {
    audio.unlock();
    const x = this.lx(p), y = this.ly(p);
    if (this.stage === 'DEAD') { this.deadConfirm(); return; }
    if (this.paused) { this.setPaused(false); return; }
    if (this.stage !== 'PLAY') return;
    if (p.wasTouch) {
      this.touchMode = true;
      const acts = [() => { this.rollQ = true; }, () => { this.meleeQ = true; }, () => { this.bombQ = true; }, () => { this.pickQ = true; }];
      for (let i = 0; i < 4; i++) { const [bx, by] = this.btnPos(i); if (this.inBtn(x, y, bx, by)) { acts[i](); return; } }
      if (x < W / 2 && this.moveStick.id < 0) this.moveStick = { id: p.id, ax: x, ay: y, vx: 0, vy: 0 };
      else if (x >= W / 2 && this.aimStick.id < 0) this.aimStick = { id: p.id, ax: x, ay: y, vx: 0, vy: 0 };
    } else {
      this.mouse.used = true; this.mouse.x = x; this.mouse.y = y;
      if (p.rightButtonDown()) this.meleeQ = true; else this.mouse.down = true;
    }
  }
  private pointerMove(p: Phaser.Input.Pointer): void {
    const x = this.lx(p), y = this.ly(p);
    if (!p.wasTouch) { this.mouse.used = true; this.mouse.x = x; this.mouse.y = y; return; }
    for (const s of [this.moveStick, this.aimStick]) if (s.id === p.id) {
      const dx = x - s.ax, dy = y - s.ay, d = Math.hypot(dx, dy), max = 56;
      s.vx = d > 0 ? (dx / d) * Math.min(1, d / max) : 0; s.vy = d > 0 ? (dy / d) * Math.min(1, d / max) : 0;
      if (d > max * 1.6) { s.ax += (dx / d) * (d - max * 1.6); s.ay += (dy / d) * (d - max * 1.6); }   // 스틱이 손가락을 따라온다
    }
  }
  private pointerUp(p: Phaser.Input.Pointer): void {
    if (p.wasTouch) { for (const s of [this.moveStick, this.aimStick]) if (s.id === p.id) { s.id = -1; s.vx = 0; s.vy = 0; } }
    else this.mouse.down = false;
  }
  private buildInput(): GInput {
    const k = this.keys, p = this.g.p;
    const mx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0) + (this.moveStick.id >= 0 ? this.moveStick.vx : 0);
    const my = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0) + (this.moveStick.id >= 0 ? this.moveStick.vy : 0);
    let ax = 0, ay = 0, fire = k.has('j') || k.has('z') || k.has('control'), aimDist: number | undefined;
    if (this.aimStick.id >= 0) { const m = Math.hypot(this.aimStick.vx, this.aimStick.vy); if (m > 0.2) { ax = this.aimStick.vx; ay = this.aimStick.vy; if (m > 0.55) fire = true; } }   // 조준 스틱 0.55 이상이면 발사
    else if (this.mouse.used && !this.touchMode) { const wx = this.cam.x + this.mouse.x / Z, wy = this.cam.y + this.mouse.y / Z; ax = wx - p.x; ay = wy - p.y; aimDist = Math.hypot(ax, ay); if (aimDist < 24) { ax = 0; ay = 0; } if (this.mouse.down) fire = true; }
    const inp: GInput = { mx, my, ax, ay, fire, roll: this.rollQ, melee: this.meleeQ, bomb: this.bombQ, pickup: this.pickQ || k.has('e'), aimDist };
    this.rollQ = false; this.meleeQ = false; this.bombQ = false; this.pickQ = false;
    return inp;
  }
  private setPaused(v: boolean): void { if (this.stage !== 'PLAY') return; this.paused = v; this.quitArmed = false; if (v) audio.suspend(); else audio.resume(); }
  private pressQuit(): void { if (!this.quitArmed) { this.quitArmed = true; return; } this.finish(false); }

  // ---------------------------------------------------------------- 연출 타임라인
  private cover2(key: string): void { this.cutImg.setTexture(key).setVisible(true).setPosition(0, 0).setAlpha(1).setScale(W / this.cutImg.width, H / this.cutImg.height); }
  private addPixelate(amount: number): void { const fx = this.cameras.main.postFX; if (!fx || this.game.renderer.type !== Phaser.WEBGL) return; this.pixel = fx.addPixelate(amount); }
  private setPixel(v: number): void { if (this.pixel) this.pixel.amount = v; }
  private clearPixel(): void { this.cameras.main.postFX?.clear(); this.pixel = null; }
  private caption(text: string, size = 22, y = H * 0.82): Phaser.GameObjects.Text {
    const t = this.add.text(W / 2, y, text, { ...textStyle(size, '#ffffff'), stroke: '#02060e', strokeThickness: 5 }).setOrigin(0.5).setAlpha(0);
    this.root.add(t); this.caps.push(t); this.tweens.add({ targets: t, alpha: 1, duration: 260 }); return t;
  }
  private runIntro(): void {
    const cam = this.cameras.main;
    audio.updateMusic(null);
    this.cover2('cut_shotdown'); this.veil.setAlpha(1);
    this.tweens.add({ targets: this.veil, alpha: 0, duration: 350 });
    audio.sfx('boom'); audio.sfx('enrage');
    const cap = this.caption('EJECT!', 40, H * 0.14);
    this.tweens.add({ targets: this.cutImg, scale: this.cutImg.scale * 1.06, duration: 1500, ease: 'Sine.easeOut' });
    this.time.delayedCall(1500, () => {
      cap.destroy(); this.addPixelate(1); audio.sfx('missile');
      this.tweens.add({ targets: cam, zoom: 3.2, duration: 950, ease: 'Cubic.easeIn' });
      this.tweens.addCounter({ from: 1, to: 26, duration: 950, ease: 'Cubic.easeIn', onUpdate: tw => this.setPixel(tw.getValue() ?? 1) });
    });
    this.time.delayedCall(2450, () => {
      cam.setZoom(1.9); cam.flash(260, 255, 255, 255);
      this.cover2('cut_landing');
      this.tweens.addCounter({ from: 22, to: 0.5, duration: 900, ease: 'Cubic.easeOut', onUpdate: tw => this.setPixel(tw.getValue() ?? 0.5) });
      this.tweens.add({ targets: cam, zoom: 1, duration: 900, ease: 'Cubic.easeOut' });
      this.tweens.add({ targets: this.cutImg, scale: this.cutImg.scale * 1.1, duration: 1800, ease: 'Sine.easeOut' });
      this.caption('옥상 착지 — 격납고까지 올라가라', 20);
      audio.sfx('heal');
    });
    this.time.delayedCall(4300, () => {
      this.world.setVisible(true); this.ui.setVisible(true);
      this.caps.forEach(c => c.destroy()); this.caps = [];
      this.tweens.add({ targets: this.cutImg, alpha: 0, duration: 450, onComplete: () => this.cutImg.setVisible(false) });
      this.setPixel(16); cam.setZoom(1.5);
      this.tweens.addCounter({ from: 16, to: 0, duration: 650, ease: 'Cubic.easeOut', onUpdate: tw => this.setPixel(tw.getValue() ?? 0), onComplete: () => this.clearPixel() });
      this.tweens.add({ targets: cam, zoom: 1, duration: 650, ease: 'Cubic.easeOut' });
      this.stage = 'PLAY'; this.tutorialT = 60 * 10; this.say('옥상');
    });
  }
  private runOutro(): void {
    this.stage = 'OUTRO';
    const cam = this.cameras.main;
    this.time.delayedCall(1300, () => {
      this.cover2('cut_takeoff'); this.cutImg.setAlpha(0);
      this.tweens.add({ targets: this.cutImg, alpha: 1, duration: 500 });
      this.tweens.add({ targets: this.cutImg, scale: this.cutImg.scale * 1.08, duration: 2200, ease: 'Sine.easeOut' });
      this.caption('기체 탈환! 이륙!', 26);
      audio.sfx('item'); audio.sfx('enrage');
    });
    this.time.delayedCall(3600, () => {
      this.addPixelate(0.5);
      this.tweens.add({ targets: cam, zoom: 2.6, duration: 800, ease: 'Cubic.easeIn' });
      this.tweens.addCounter({ from: 0.5, to: 22, duration: 800, ease: 'Cubic.easeIn', onUpdate: tw => this.setPixel(tw.getValue() ?? 1) });
      this.tweens.add({ targets: this.veil, alpha: 1, duration: 800, delay: 300 });
    });
    this.time.delayedCall(4500, () => this.finish(true));
  }
  private say(text: string, size = 34): void {
    this.banner.setText(text).setFontSize(size).setAlpha(1).setScale(1.5); this.bannerT = 90;
    this.tweens.add({ targets: this.banner, scale: 1, duration: 180, ease: 'Back.easeOut' });
  }
  private finish(win: boolean): void {
    if (this.test) { this.scene.restart({ sim: this.sim, test: this.test }); return; }   // 테스트 페이지: 끝나면 같은 설정으로 다시
    if (this.finished) return; this.finished = true; this.stage = 'END';
    this.clearPixel(); this.cameras.main.setZoom(1);
    const r = this.g.result();
    if (win) this.sim.finishGround({ score: r.score, rooms: r.rooms }); else this.sim.groundFail();
    audio.resume();
    this.scene.stop();
    this.scene.resume('GameScene');
  }
  /** 핫라인식 즉시 재시작: 같은 구역 입구에서 바로 다시 (목숨 1개) */
  private deadConfirm(): void {
    if (this.deadTimer > 0) return;
    if (this.sim.useGroundLife()) {
      this.g.revive(); this.stage = 'PLAY';
      this.enemyImgs.forEach(o => { o.img.destroy(); o.extra?.destroy(); }); this.enemyImgs.clear(); this.dyingImgs.forEach(i => i.destroy()); this.dyingImgs.clear(); this.pickupImgs.forEach(i => i.destroy()); this.pickupImgs.clear();
      this.redFlash.setAlpha(0); this.say('RETRY', 30);
      for (const e of this.g.drain()) this.handle(e);
    } else this.finish(false);
  }

  // ---------------------------------------------------------------- 틱
  update(_t: number, delta: number): void {
    if (this.stage === 'PLAY' && !this.paused) {
      const dt = Math.min(delta, 50) * (this.time.now < this.slowUntil ? this.slowScale : 1);
      this.acc += dt;
      while (this.acc >= STEP_MS) {
        this.acc -= STEP_MS;
        if (this.hitStop > 0) { this.hitStop--; this.tickFx(0.2); continue; }   // 히트스톱: 시뮬레이션은 멈추고 입자만 아주 느리게
        this.tick();
      }
      audio.updateMusic(this.g.isBossRoom ? 'boss' : 'solar');
    }
    if (this.stage === 'DEAD' && this.deadTimer > 0) this.deadTimer--;
    this.render();
  }
  private tick(): void {
    const g = this.g;
    if (this.test?.god) { g.p.invuln = 99999; g.p.hp = g.p.maxHp; }
    g.step(this.buildInput());
    this.tickFx(1);
    if (this.tutorialT > 0) this.tutorialT--;
    for (const e of g.drain()) this.handle(e);
    this.stampBudget = 0;
  }
  private tickFx(k: number): void {
    this.shake = this.shake > 0.3 ? this.shake * Math.pow(0.86, k) : 0;
    this.kick.x *= Math.pow(0.78, k); this.kick.y *= Math.pow(0.78, k);
    this.cross.spread *= 0.9; if (this.cross.hit > 0) this.cross.hit--; if (this.cross.kill > 0) this.cross.kill--; if (this.glowT > 0) this.glowT--;
    const dt = k / 60;
    for (let i = this.prts.length - 1; i >= 0; i--) {
      const p = this.prts[i]; p.x += p.vx * dt; p.y += p.vy * dt;
      const drag = p.k === 'blood' || p.k === 'gib' ? 0.93 : p.k === 'casing' ? 0.9 : p.k === 'smoke' || p.k === 'mist' ? 0.95 : 0.9;
      p.vx *= Math.pow(drag, k); p.vy *= Math.pow(drag, k);
      p.life -= k;
      if (p.life <= 0) {   // 떨어진 자리에 영구 데칼로 남긴다
        if (p.k === 'blood') this.stamp(p.x, p.y, 1 + (p.size > 8 ? 1 : 0), 1 + (p.size > 8 ? 1 : 0), 0x8b1a1a, 0.85);
        else if (p.k === 'gib') this.stamp(p.x, p.y, 3, 3, 0x6e1212, 0.9);
        else if (p.k === 'casing') { this.stamp(p.x, p.y, 1, 1, 0xd9a93a, 0.95); audio.sfx('gCasing'); }
        else if (p.k === 'wood') this.stamp(p.x, p.y, 2, 1, 0x8a6a3e, 0.9);
        else if (p.k === 'glass') this.stamp(p.x, p.y, 1, 1, 0xbfe9ff, 0.8);
        this.prts.splice(i, 1);
      }
    }
    for (let i = this.pops.length - 1; i >= 0; i--) { const p = this.pops[i]; p.y -= 1.2 * k; if ((p.life -= k) <= 0) this.pops.splice(i, 1); }
  }

  // ---------------------------------------------------------------- 데칼 / 입자 도우미
  /** 바닥 데칼에 한 점 (도트 단위 크기). 구역별 RT 에 찍는다 */
  private stamp(x: number, y: number, w: number, h: number, color: number, alpha: number): void {
    if (this.stampBudget > 160) return;
    const s = sectionOfRow(Math.floor(y / TILE)), sec = SECTIONS[s], rt = this.decals[s]; if (!rt) return;
    this.stampBudget++; rt.fill(color, alpha, Math.floor(x / ART), Math.floor((y - sec.r0 * TILE) / ART), w, h);
  }
  private prt(k: Prt['k'], x: number, y: number, ang: number, sp: number, life: number, size: number, c: number): void {
    if (this.prts.length >= 1500) this.prts.shift();
    this.prts.push({ k, x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life, max: life, size, c, a: ang });
  }
  private pop(x: number, y: number, text: string, color = '#ffffff', size = 14): void { if (this.pops.length >= 14) this.pops.shift(); this.pops.push({ x, y, life: 46, text, color, size }); }
  /** 출혈 2방향: 진행 방향 front 개(퍼짐 spread, 속도 160~420) + 반대 방향 back 개(퍼짐 0.7, 속도 60~180) + 피안개 + 살점. robot=true 면 불꽃 */
  private blood(x: number, y: number, ang: number, front: number, back: number, spread: number, mist: number, gibs = 0, robot = false): void {
    if (robot) { for (let i = 0; i < front + back; i++) this.prt('spark', x, y, ang + rnd(-1.2, 1.2), rnd(200, 520), rnd(8, 16), 4, 0xffd27a); return; }
    for (let i = 0; i < front; i++) this.prt('blood', x, y, ang + rnd(-spread, spread), rnd(160, 420), rnd(14, 36), 6, 0x8b1a1a);
    for (let i = 0; i < back; i++) this.prt('blood', x, y, ang + Math.PI + rnd(-0.7, 0.7), rnd(60, 180), rnd(10, 26), 6, 0x8b1a1a);
    for (let i = 0; i < mist; i++) this.prt('mist', x, y, ang + rnd(-0.6, 0.6), rnd(20, 70), 19, 14, 0xb01818);
    for (let i = 0; i < gibs; i++) this.prt('gib', x, y, ang + rnd(-spread, spread), rnd(200, 500), rnd(20, 40), 12, 0x7a1414);
  }

  // ---------------------------------------------------------------- 이벤트 → 연출·소리
  private handle(e: GEvent): void {
    const g = this.g, p = g.p;
    switch (e.t) {
      case 'shot': {
        const w = e.weapon, F = w === 'shotgun' ? 14 : w === 'rail' ? 16 : w === 'pistol' ? 7 : w === 'rifle' ? 4 : 3;
        audio.sfx(w === 'pistol' ? 'gPistol' : w === 'shotgun' ? 'gShotgun' : w === 'smg' ? 'gSmg' : w === 'rail' ? 'gRail' : 'gRifle');
        this.kick.x -= Math.cos(e.ang) * F; this.kick.y -= Math.sin(e.ang) * F; this.cross.spread = Math.min(1, this.cross.spread + (w === 'shotgun' ? 0.9 : 0.35));
        this.shake = Math.max(this.shake, w === 'shotgun' ? 5 : w === 'rail' ? 6 : 1.5); this.glowT = 3; this.glowBig = w === 'shotgun' || w === 'rail';
        for (let i = 0; i < (w === 'shotgun' ? 8 : 3); i++) this.prt('smoke', e.x, e.y, e.ang + rnd(-0.5, 0.5), rnd(30, 110), rnd(20, 34), 8, 0xb0b8c4);
        break;
      }
      case 'casing': {
        const a = e.ang + (e.left ? -Math.PI / 2 : Math.PI / 2) + rnd(-0.6, 0.6), off = e.weapon === 'smg' ? [10, -2] : e.weapon === 'shotgun' ? [7, 4] : [8, 2];
        this.prt('casing', e.x + Math.cos(e.ang) * off[0] * ART - Math.sin(e.ang) * off[1] * ART, e.y + Math.sin(e.ang) * off[0] * ART + Math.cos(e.ang) * off[1] * ART, a, rnd(120, 300), rnd(18, 28), 6, 0xd9a93a);
        if (e.weapon === 'shotgun') audio.sfx('gPump');
        break;
      }
      case 'hit': {
        const F = FEEL[e.w], robot = e.kind === 'turret' || e.kind === 'drone' || e.kind === 'boss' || e.armor;
        audio.sfx('gHit'); if (e.w === 'melee') audio.sfx('gMelee'); else if (e.w === 'shotgun' || e.w === 'rail') audio.sfx('bossHit');
        this.blood(e.x, e.y, e.ang, F.blood[0], F.blood[1], F.spread, F.mist, 0, robot);
        for (let i = 0; i < Math.min(8, F.stamp / 2); i++) this.stamp(e.x + rnd(-14, 14), e.y + rnd(-14, 14), 2, 2, robot ? 0x20262e : 0x8b1a1a, 0.7);
        this.cross.hit = 12;
        if (e.kill) this.cross.kill = 22; else if (e.dmg >= 20) this.pop(e.x, e.y - 40, String(Math.round(e.dmg)), '#ffffff', 11);
        break;
      }
      case 'kill': {
        const D = FEEL[e.w], robot = e.kind === 'turret' || e.kind === 'drone' || e.kind === 'boss';
        audio.sfx('gKill'); if (e.w === 'shotgun' || e.w === 'bomb' || e.w === 'rail') audio.sfx('bossHeavy');
        this.blood(e.x, e.y, e.ang, D.dBlood * (robot ? 0.5 : 1), Math.round(D.dBlood / 3), 0.6, D.dMist, D.dGibs, robot);
        this.pop(e.x, e.y - 70, `+${e.pts}`, '#fde68a', 14); if (e.combo >= 3) this.pop(e.x, e.y - 100, `${e.combo} COMBO`, '#fbbf24', 12);
        break;
      }
      case 'smear': this.stamp(e.x, e.y, 3, 3, 0x7a1414, 0.7); break;
      case 'pool': for (let i = 0; i < 3; i++) this.stamp(e.x + rnd(-e.r, e.r), e.y + rnd(-e.r, e.r), Math.max(2, Math.round(e.r / 5)), Math.max(2, Math.round(e.r / 5)), 0x6e1212, 0.22); break;
      case 'stamp': {   // 시체를 바닥 데칼에 합성 (이후 비용 0)
        const s = sectionOfRow(Math.floor(e.y / TILE)), sec = SECTIONS[s], rt = this.decals[s]; if (!rt) break;
        const sheet = e.kind === 'dog' ? 'gs_dog' : e.kind === 'drone' ? 'gs_drone' : e.kind === 'turret' ? 'gs_turret' : e.kind === 'boss' ? 'gs_boss' : FOE_SHEET[e.kind] ?? 'gs_foe_rifle';
        const row = FOE_SHEET[e.kind] ? (e.fallF ? 13 : 9) : e.kind === 'dog' ? 5 : e.kind === 'drone' ? 2 : e.kind === 'turret' ? 3 : 5;
        this.stampImg.setTexture(sheet, row).setPosition(e.x / ART, (e.y - sec.r0 * TILE) / ART).setRotation(e.ang).setScale(1).setVisible(false);
        rt.draw(this.stampImg); break;
      }
      case 'dodge': audio.sfx('gDodge'); this.pop(p.x, p.y - 80, '회피!', '#67e8f9', 16); for (let i = 0; i < 3; i++) this.prt('spark', p.x, p.y, rnd(0, 6.28), rnd(150, 300), 10, 3, 0x67e8f9); break;
      case 'hurt': audio.sfx('gHurt'); this.redFlash.setAlpha(0.4); this.tweens.add({ targets: this.redFlash, alpha: 0, duration: 300 }); this.shake = Math.max(this.shake, 6); try { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(50); } catch { /* 미지원 */ } break;
      case 'roll': audio.sfx('gRoll'); break;
      case 'swing': audio.sfx('gSwing'); break;
      case 'throw': audio.sfx('gThrow'); break;
      case 'release': audio.sfx('gBombLand'); break;
      case 'boom': {
        audio.sfx('boom'); audio.sfx('bossHeavy');
        let sp = this.boomSprites.find(s2 => !s2.visible);
        if (!sp) { const made = this.add.sprite(0, 0, 'gs_explosion').setScale(ART); this.world.add(made); this.boomSprites.push(made); made.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => made.setVisible(false)); sp = made; }
        sp.setVisible(true).setPosition(e.x, e.y).setScale(Math.max(2, e.r / 32)).setRotation(rnd(0, 6.28)).play('gs_boom');
        for (let i = 0; i < 24; i++) this.prt('spark', e.x, e.y, rnd(0, 6.28), rnd(150, 520), rnd(14, 30), 4, 0xffb347);
        for (let i = 0; i < 10; i++) this.prt('smoke', e.x, e.y, rnd(0, 6.28), rnd(40, 160), rnd(34, 60), 12, 0x9aa2ae);
        for (let i = 0; i < 18; i++) { const a = rnd(0, 6.28), d = rnd(0, e.r * 0.6); this.stamp(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, 3, 3, 0x0b0f14, 0.4); }
        this.whiteFlash.setAlpha(0.55); this.tweens.add({ targets: this.whiteFlash, alpha: 0, duration: 260 });
        break;
      }
      case 'doorKick': audio.sfx('gDoorKick'); break;
      case 'doorOpen': audio.sfx('gDoor'); break;
      case 'doorHit': audio.sfx('gCrate'); break;
      case 'doorBreak': audio.sfx('gDoorBreak'); for (let i = 0; i < 16; i++) this.prt('wood', e.x + rnd(-40, 40), e.y + rnd(-40, 40), rnd(0, 6.28), rnd(120, 420), rnd(18, 34), 6, 0x7a5230); this.shake = Math.max(this.shake, 4); break;
      case 'windowHit': audio.sfx('gGlass'); for (let i = 0; i < 3; i++) this.prt('glass', e.x, e.y, rnd(0, 6.28), rnd(80, 200), rnd(14, 24), 4, 0xbfe9ff); break;
      case 'windowBreak': audio.sfx('gGlass'); for (let i = 0; i < 26; i++) this.prt('glass', e.x + rnd(-30, 30), e.y + rnd(-60, 60), rnd(0, 6.28), rnd(100, 420), rnd(18, 36), 5, 0xbfe9ff); break;
      case 'crateHit': audio.sfx('gCrate'); break;
      case 'crateBreak': audio.sfx('gDoorBreak'); for (let i = 0; i < 12; i++) this.prt('wood', e.x, e.y, rnd(0, 6.28), rnd(120, 400), rnd(16, 30), 6, e.barrel ? 0xb8322a : 0x8a6a3e); break;
      case 'wallhit': for (let i = 0; i < 4; i++) this.prt('spark', e.x, e.y, e.ang + Math.PI + rnd(-0.9, 0.9), rnd(150, 420), rnd(6, 12), 3, 0xffe27a); this.prt('dust', e.x, e.y, e.ang + Math.PI, rnd(30, 90), 22, 8, 0xb0b8c4); this.stamp(e.x, e.y, 1, 1, 0x0b0f14, 0.7); break;
      case 'alert': this.pop(e.x, e.y - 90, '!', '#ff4040', 22); audio.sfx('gEnemyShot'); break;
      case 'pickup': audio.sfx(e.what === 'heart' ? 'heal' : 'item'); this.pop(e.x, e.y - 40, e.what === 'heart' ? '+♥' : 'WEAPON', '#ffffff', 12); break;
      case 'drop': this.pop(e.x, e.y - 30, '▼', '#fde68a', 12); break;
      case 'gate': audio.sfx('item'); break;
      case 'section': if (e.n > 0 || this.stage === 'PLAY') this.say(e.name); break;
      case 'cleared': this.say(e.n === 3 ? 'MISSION CLEAR' : 'CLEAR!', 30); audio.sfx('item'); break;
      case 'exitopen': this.say('출구로! 이륙 격납고', 26); break;
      case 'shake': this.shake = Math.max(this.shake, e.v); break;
      case 'hitstop': this.hitStop = Math.max(this.hitStop, e.frames); break;
      case 'slowmo': this.slowUntil = this.time.now + e.ms; this.slowScale = e.scale; break;
      case 'bossPhase': this.say(`PHASE ${e.phase}`, 30); audio.sfx('enrage'); break;
      case 'style': audio.sfx('gStyle'); this.pop(e.x, e.y - 90, 'STYLE!', '#67e8f9', 18); break;
      case 'reset': this.decals[e.section]?.clear(); break;
      case 'win': audio.sfx('item'); this.runOutro(); break;
      case 'dead': this.stage = 'DEAD'; this.deadTimer = 25; audio.sfx('enrage'); break;
    }
  }

  // ---------------------------------------------------------------- 렌더
  private ellipseRot(g: Phaser.GameObjects.Graphics, cx: number, cy: number, rx: number, ry: number, rot: number, alpha: number): void {
    g.fillStyle(0x000000, alpha); g.beginPath();
    for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2, ex = Math.cos(a) * rx, ey = Math.sin(a) * ry, x = cx + ex * Math.cos(rot) - ey * Math.sin(rot), y = cy + ex * Math.sin(rot) + ey * Math.cos(rot); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.closePath(); g.fillPath();
  }

  private render(): void {
    if (this.stage === 'INTRO' || this.stage === 'END') return;
    const g = this.g, p = g.p, t = this.time.now;
    // 카메라: 플레이어를 아래쪽 1/3 지점에 두고 조준 방향을 조금 내다본다 + 발사 킥 + 흔들림 (정수 좌표로 이음새 방지)
    let lookX = 0, lookY = 0;
    if (this.aimStick.id >= 0) { lookX = this.aimStick.vx * 180; lookY = this.aimStick.vy * 220; }
    else if (this.mouse.used && !this.touchMode) { const wx = this.cam.x + this.mouse.x / Z - p.x, wy = this.cam.y + this.mouse.y / Z - p.y; lookX = Math.max(-260, Math.min(260, wx * 0.25)); lookY = Math.max(-300, Math.min(300, wy * 0.25)); }
    const wantX = Math.max(0, Math.min(WORLD_W - VIEW_W, p.x - VIEW_W / 2 + lookX)), wantY = Math.max(0, Math.min(WORLD_H - VIEW_H, p.y - VIEW_H * 0.62 + lookY));
    this.cam.x += (wantX - this.cam.x) * 0.16; this.cam.y += (wantY - this.cam.y) * 0.16;
    const sh = this.shake, sx = sh ? (Math.random() - 0.5) * sh * 2 : 0, sy = sh ? (Math.random() - 0.5) * sh * 2 : 0;
    const cx = Math.round(this.cam.x + this.kick.x + sx), cy = Math.round(this.cam.y + this.kick.y + sy);
    this.world.setPosition(-cx * Z, -cy * Z);
    const inView = (x: number, y: number) => x > cx - 200 && x < cx + VIEW_W + 200 && y > cy - 200 && y < cy + VIEW_H + 200;
    this.shadowG.clear(); this.objG.clear(); this.partG.clear(); this.bulletG.clear(); this.topG.clear();

    this.renderObjects(inView);
    const livePk = new Set<number>(); let nearW = '';
    for (const k of g.pickups) {   // 바닥에 놓인 무기·구급상자
      livePk.add(k.id);
      let img = this.pickupImgs.get(k.id);
      if (!img) { img = this.add.image(k.x, k.y, k.kind === 'weapon' ? `i_${k.weapon}` : 'i_medkit').setScale(ART * 0.7); this.pickupLayer.add(img); this.pickupImgs.set(k.id, img); }
      const vis = inView(k.x, k.y); img.setVisible(vis).setPosition(Math.round(k.x), Math.round(k.y + Math.sin(k.t * 0.08) * 3)).setRotation(k.kind === 'weapon' ? ((k.id * 1.7) % 1.2) - 0.6 : 0);
      if (vis) { this.topG.lineStyle(3, k.kind === 'heart' ? 0xf87171 : 0xfde68a, 0.4 + 0.3 * Math.sin(k.t * 0.1)); this.topG.strokeCircle(k.x, k.y, 40); }
      if (k.kind === 'weapon' && Math.hypot(p.x - k.x, p.y - k.y) < 60) nearW = `E 줍기: ${WEAPONS[k.weapon!].name}${k.ammo !== undefined && k.ammo < 999 ? ' ' + k.ammo : ''}`;
    }
    for (const [id, img] of this.pickupImgs) if (!livePk.has(id)) { img.destroy(); this.pickupImgs.delete(id); }
    this.renderEnemies(inView);
    this.renderBullets(inView);
    this.renderPlayer(t);
    for (const q of this.prts) {   // 입자
      if (!inView(q.x, q.y)) continue; const k = q.life / q.max, px = Math.round(q.x / 4) * 4, py = Math.round(q.y / 4) * 4;
      if (q.k === 'mist') { this.partG.fillStyle(q.c, 0.32 * k); this.partG.fillCircle(q.x, q.y, q.size * (2 - k) * 2); }
      else if (q.k === 'smoke') { this.partG.fillStyle(q.c, 0.2 * k); this.partG.fillCircle(q.x, q.y, q.size * (2.4 - k)); }
      else if (q.k === 'dust') { this.partG.fillStyle(q.c, 0.3 * k); this.partG.fillCircle(q.x, q.y, q.size * (2 - k)); }
      else if (q.k === 'spark') { this.partG.lineStyle(4, q.c, Math.min(1, k * 1.5)); this.partG.beginPath(); this.partG.moveTo(q.x, q.y); this.partG.lineTo(q.x - Math.cos(q.a) * q.size * 3 * k, q.y - Math.sin(q.a) * q.size * 3 * k); this.partG.strokePath(); }
      else if (q.k === 'casing') { this.partG.fillStyle(q.c, 1); this.partG.fillRect(px, py, 8, 4); }
      else { this.partG.fillStyle(q.c, Math.min(1, k * 2)); this.partG.fillRect(px, py, q.k === 'gib' ? 12 : 8, q.k === 'gib' ? 12 : 8); }
    }
    for (const b of g.bombs) {   // 폭탄: 공중에서 커지고 그림자는 작고 옅어진다 (높이 z = 4u(1-u)), 착지 후 한 번 튕김, 불빛은 점점 빨리 깜빡
      const u = Math.min(1, b.t / b.flight), z = 4 * u * (1 - u), bounce = u >= 1 ? Math.abs(Math.sin((b.t - b.flight) * 0.35)) * Math.max(0, 1 - (b.t - b.flight) / 12) * 0.3 : 0, zz = Math.max(z, bounce), k = 1 + 1.1 * zz;
      const rate = 3 + 12 * Math.pow(b.t / b.fuse, 2), lit = Math.floor((b.t / 60) * rate * 2) % 2, by = b.y - zz * 38;
      this.shadowG.fillStyle(0x000000, 0.4 * (1 - 0.55 * zz)); this.shadowG.fillEllipse(b.x + 4, b.y + 6, 36 * (1 - 0.3 * zz), 18 * (1 - 0.3 * zz));
      this.topG.fillStyle(0x3a4a2a, 1); this.topG.fillCircle(b.x, by, 12 * k); this.topG.fillStyle(0x1a2412, 1); this.topG.fillCircle(b.x, by, 8 * k);
      if (lit) { this.topG.fillStyle(0xff3b3b, 1); this.topG.fillCircle(b.x, by, 6 * k); this.topG.fillStyle(0xffd0d0, 1); this.topG.fillCircle(b.x, by, 3 * k); }
      if (u >= 1 && lit && b.t % 6 === 0) audio.sfx('gBeep');
    }
    if (this.glowT > 0 && !p.gunBlocked) { const [mx, my] = this.muzzleXY(); this.glow.setVisible(true).setPosition(mx, my).setScale((this.glowBig ? 150 : 100) / 4).setAlpha(0.55 * (this.glowT / 3)); } else this.glow.setVisible(false);   // 총구 불빛 번쩍(가산)
    this.renderHud(nearW, cx, cy);
  }
  private muzzleXY(): [number, number] { const p = this.g.p, [fw, sd] = WEAPONS[p.weapon].muzzle; return [p.x + Math.cos(p.aim) * fw * ART - Math.sin(p.aim) * sd * ART, p.y + Math.sin(p.aim) * fw * ART + Math.cos(p.aim) * sd * ART]; }

  /** 문·유리창·상자(통) */
  private renderObjects(inView: (x: number, y: number) => boolean): void {
    const g = this.g, o = this.objG;
    for (const c of g.crates) {
      if (c.broken || !inView(c.x, c.y)) continue;
      const shake = c.hitT > 0 ? (c.hitT % 2 ? 2 : -2) : 0, x = Math.round((c.x - c.hs) / 4) * 4 + shake, y = Math.round((c.y - c.hs) / 4) * 4, s = c.hs * 2, hit = c.hitT > 0;
      this.shadowG.fillStyle(0x000000, 0.3); this.shadowG.fillRect(x + 8, y + 8, s, s);
      if (c.kind === 'barrel') {
        o.fillStyle(0x3a0d0a, 1); o.fillRect(x, y + 4, s, s - 8); o.fillRect(x + 4, y, s - 8, s); o.fillStyle(hit ? 0xffffff : 0xb8322a, 1); o.fillRect(x + 4, y + 8, s - 8, s - 16); o.fillRect(x + 8, y + 4, s - 16, s - 8);
        o.fillStyle(hit ? 0xffffff : 0x7a1d18, 1); o.fillRect(x + 4, y + 16, s - 8, 4); o.fillRect(x + 4, y + s - 20, s - 8, 4); o.fillStyle(0xffd23a, 1); o.fillRect(x + s / 2 - 4, y + s / 2 - 8, 8, 16);
      } else {
        o.fillStyle(0x3a2814, 1); o.fillRect(x, y, s, s); o.fillStyle(hit ? 0xffffff : 0x8a6a3e, 1); o.fillRect(x + 4, y + 4, s - 8, s - 8);
        o.fillStyle(hit ? 0xf0f0f0 : 0x6b4f2b, 1); for (let i = 1; i < 4; i++) o.fillRect(x + 4, y + 4 + i * ((s - 8) / 4), s - 8, 4); o.fillStyle(0x4a3218, 1); o.fillRect(x + 4, y + 4, 4, s - 8); o.fillRect(x + s - 8, y + 4, 4, s - 8);
        o.fillStyle(0xc9a86a, 1); for (const [dx, dy] of [[8, 8], [s - 12, 8], [8, s - 12], [s - 12, s - 12]]) o.fillRect(x + dx, y + dy, 4, 4);
        if (c.hp < 3) { o.fillStyle(0x2a1d0e, 1); o.fillRect(x + 12, y + 12, 4, s - 24); o.fillRect(x + 12, y + 12, s - 24, 4); }
      }
    }
    for (const w of g.windows) {
      if (w.broken || !inView((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2)) continue;
      const x = w.x0, y = w.y0, ww = w.x1 - w.x0, hh = w.y1 - w.y0;
      o.fillStyle(0x6fb6d8, 0.45); o.fillRect(x, y, ww, hh); o.fillStyle(0xd8f4ff, 0.9); o.fillRect(x, y, ww, 4); o.fillRect(x, y + hh - 4, ww, 4); o.fillRect(x, y, 4, hh); o.fillRect(x + ww - 4, y, 4, hh);
      o.fillStyle(0xffffff, 0.5); o.fillRect(x + 12, y + 10, 4, 24); o.fillRect(x + 20, y + 22, 4, 16);
      if (w.hp < 2) { o.lineStyle(3, 0xffffff, 0.8); o.beginPath(); o.moveTo(x + 8, y + 8); o.lineTo(x + ww - 8, y + hh - 8); o.moveTo(x + ww / 2, y + 4); o.lineTo(x + 10, y + hh / 2); o.strokePath(); }
    }
    for (const d of g.doors) { if (d.broken || !inView((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2)) continue; this.drawDoor(d); }
  }
  /** 문 판: 경첩(세로 문은 위쪽 끝, 가로 문은 왼쪽 끝)에서 통로 길이만큼 뻗은 판을 φ 만큼 회전해서 그린다 */
  private drawDoor(d: GDoor): void {
    const o = this.objG, cx = (d.x0 + d.x1) / 2, cy = (d.y0 + d.y1) / 2, vert = d.o === 'v', len = vert ? (d.y1 - d.y0) : (d.x1 - d.x0);
    o.fillStyle(0x20242c, 1);
    if (vert) { o.fillRect(d.x0, d.y0 - 4, d.x1 - d.x0, 8); o.fillRect(d.x0, d.y1 - 4, d.x1 - d.x0, 8); } else { o.fillRect(d.x0 - 4, d.y0, 8, d.y1 - d.y0); o.fillRect(d.x1 - 4, d.y0, 8, d.y1 - d.y0); }   // 문틀
    const hx = vert ? cx : d.x0, hy = vert ? d.y0 : cy, ph = (d.phi * Math.PI) / 180, ang = vert ? Math.PI / 2 - ph : ph, ex = hx + Math.cos(ang) * len, ey = hy + Math.sin(ang) * len;
    const gate = d.kind !== 'door', th = gate ? 14 : 10, col = gate ? 0x8a2a30 : 0x8a5a2b, edge = gate ? 0x4a1418 : 0x4a2f14, nx = -Math.sin(ang) * th / 2, ny = Math.cos(ang) * th / 2;
    o.fillStyle(edge, 1); o.beginPath(); o.moveTo(hx + nx - 2, hy + ny - 2); o.lineTo(ex + nx + 2, ey + ny + 2); o.lineTo(ex - nx + 2, ey - ny + 2); o.lineTo(hx - nx - 2, hy - ny - 2); o.closePath(); o.fillPath();
    o.fillStyle(col, 1); o.beginPath(); o.moveTo(hx + nx * 0.6, hy + ny * 0.6); o.lineTo(ex + nx * 0.6, ey + ny * 0.6); o.lineTo(ex - nx * 0.6, ey - ny * 0.6); o.lineTo(hx - nx * 0.6, hy - ny * 0.6); o.closePath(); o.fillPath();
    if (gate) { o.fillStyle(d.locked ? 0xff4040 : 0x40ff80, 1); o.fillRect(Math.round((hx + (ex - hx) * 0.5) / 4) * 4 - 4, Math.round((hy + (ey - hy) * 0.5) / 4) * 4 - 4, 8, 8); }
    else { o.fillStyle(0xfbbf24, 1); o.fillRect(Math.round((hx + (ex - hx) * 0.82) / 4) * 4, Math.round((hy + (ey - hy) * 0.82) / 4) * 4, 8, 8); }
    o.fillStyle(0x20242c, 1); o.fillCircle(hx, hy, 8);
  }

  private foePose(e: GEnemy): number {
    if (e.hitPose > 0) return FOE_ROW.hit;
    if (e.shotT > 0) return FOE_ROW.shoot;
    if (e.aimT > 0) return FOE_ROW.aim;
    if (e.moving) return [FOE_ROW.walk_a, FOE_ROW.idle, FOE_ROW.walk_b, FOE_ROW.idle][Math.floor(e.walk / 10) % 4];
    return FOE_ROW.idle;
  }
  /** 적의 시트·행·회전: 사망이면 쓰러짐 프레임(뒤 fall 6~9 / 앞 fallf 10~13), 시체는 머리가 총알 방향 */
  private foeFrame(e: GEnemy, dying: boolean, t: number): { sheet: string; row: number; rot: number } {
    const sheet = e.kind === 'dog' ? 'gs_dog' : e.kind === 'drone' ? 'gs_drone' : e.kind === 'turret' ? 'gs_turret' : e.kind === 'boss' ? 'gs_boss' : FOE_SHEET[e.kind]!;
    let row: number;
    if (dying) {
      if (FOE_SHEET[e.kind]) { const n = e.fallT < 5 ? 1 : e.fallT < 10 ? 2 : e.fallT < 16 ? 3 : 4; row = e.fallF ? 9 + n : 5 + n; } else row = e.kind === 'dog' ? 5 : e.kind === 'drone' ? 2 : e.kind === 'turret' ? 3 : 5;
      return { sheet, row, rot: e.deathAng };
    }
    if (FOE_SHEET[e.kind]) row = this.foePose(e);
    else if (e.kind === 'dog') row = e.hitPose > 0 ? 4 : e.shotT > 0 ? 3 : e.moving ? 1 + (Math.floor(e.walk / 6) % 2) : 0;
    else if (e.kind === 'drone') row = Math.floor(t / 60) % 2;
    else if (e.kind === 'turret') row = e.fire > 0 ? 1 : e.hp < e.maxHp * 0.5 ? 2 : 0;
    else row = e.hp < e.maxHp * 0.33 ? 4 : e.hp < e.maxHp * 0.66 ? 3 : e.moving ? 1 + (Math.floor(e.walk / 14) % 2) : 0;
    return { sheet, row, rot: e.ang };
  }
  private renderEnemies(inView: (x: number, y: number) => boolean): void {
    const g = this.g, t = this.time.now, live = new Set<number>();
    for (const e of g.enemies) {
      live.add(e.id);
      const { sheet, row, rot } = this.foeFrame(e, false, t), sc = SCALE_OF[e.kind];
      let o = this.enemyImgs.get(e.id);
      if (!o) {
        const img = this.add.image(e.x, e.y, sheet, row).setScale(sc); this.actorLayer.add(img);
        const mk = (k: string) => { const x = this.add.image(0, 0, k).setScale(ART).setVisible(false); this.actorLayer.add(x); return x; };
        o = { img, extra: e.kind === 'charger' ? mk('gs_blade') : e.kind === 'sniper' ? mk('gs_longgun') : e.kind === 'heavy' ? mk('gs_shield') : null };
        if (e.kind === 'charger' || e.kind === 'sniper') o.extra!.setOrigin(0, 0.5);
        this.enemyImgs.set(e.id, o);
      }
      const vis = inView(e.x, e.y); o.img.setVisible(vis); if (o.extra) o.extra.setVisible(vis);
      if (!vis) continue;
      o.img.setTexture(sheet, row).setPosition(Math.round(e.x), Math.round(e.y)).setRotation(rot).setScale(sc);
      if (e.hitT > 0) o.img.setTintFill(0xffffff); else o.img.clearTint();   // 맞은 순간 흰 실루엣
      if (o.extra) {
        const a = e.ang;
        if (e.kind === 'charger') { const fw = (e.windT > 0 || e.dashT > 0 ? 16 : 12) * ART, sd = 5 * ART; o.extra.setPosition(e.x + Math.cos(a) * fw - Math.sin(a) * sd, e.y + Math.sin(a) * fw + Math.cos(a) * sd).setRotation(a + (e.windT > 0 ? -0.9 : 0)); }
        else if (e.kind === 'sniper') o.extra.setPosition(e.x + Math.cos(a) * 10 * ART - Math.sin(a) * 2 * ART, e.y + Math.sin(a) * 10 * ART + Math.cos(a) * 2 * ART).setRotation(a);
        else o.extra.setPosition(e.x + Math.cos(a) * 12 * ART + Math.sin(a) * 10 * ART, e.y + Math.sin(a) * 12 * ART - Math.cos(a) * 10 * ART).setRotation(a);
        if (e.hitT > 0) o.extra.setTintFill(0xffffff); else o.extra.clearTint();
      }
      this.ellipseRot(this.shadowG, e.x + 4, e.y + 6, 20 * (sc / 4), 38 * (sc / 4), e.ang, 0.32);
      if (e.windT > 0 && (e.kind === 'charger' || e.kind === 'boss')) { const a = Math.atan2(e.ly - e.y, e.lx - e.x); this.topG.lineStyle(8, 0xff3b3b, 0.35 + 0.4 * (1 - e.windT / 60)); this.topG.beginPath(); this.topG.moveTo(e.x, e.y); this.topG.lineTo(e.x + Math.cos(a) * 900, e.y + Math.sin(a) * 900); this.topG.strokePath(); }
      if (e.kind === 'sniper' && e.aimT > 0) { const k = 1 - e.aimT / 60; this.topG.lineStyle(3 + k * 5, 0xff3b3b, 0.35 + 0.5 * k); this.topG.beginPath(); this.topG.moveTo(e.x, e.y); this.topG.lineTo(e.x + Math.cos(e.ang) * 1800, e.y + Math.sin(e.ang) * 1800); this.topG.strokePath(); }
    }
    for (const [id, o] of this.enemyImgs) if (!live.has(id)) { o.img.destroy(); o.extra?.destroy(); this.enemyImgs.delete(id); }
    const liveD = new Set<number>();   // 죽어가는 적: 총알 방향으로 미끄러지며 쓰러진다
    for (const e of g.dying) {
      liveD.add(e.id); const { sheet, row, rot } = this.foeFrame(e, true, t);
      let img = this.dyingImgs.get(e.id);
      if (!img) { img = this.add.image(e.x, e.y, sheet, row).setScale(SCALE_OF[e.kind]); this.dyingLayer.add(img); this.dyingImgs.set(e.id, img); }
      img.setVisible(inView(e.x, e.y)).setTexture(sheet, row).setPosition(Math.round(e.x), Math.round(e.y)).setRotation(rot);
      if (e.fallT < 4) img.setTintFill(0xffffff); else img.clearTint();
    }
    for (const [id, img] of this.dyingImgs) if (!liveD.has(id)) { img.destroy(); this.dyingImgs.delete(id); }
    for (const e of g.enemies) if (e.state === 'alert' && e.alertT > 0 && inView(e.x, e.y)) { this.topG.fillStyle(0xff3030, 1); this.topG.fillRect(Math.round(e.x / 4) * 4 - 4, Math.round((e.y - 120) / 4) * 4, 8, 20); this.topG.fillRect(Math.round(e.x / 4) * 4 - 4, Math.round((e.y - 92) / 4) * 4, 8, 8); }   // 머리 위 빨간 !
  }
  private renderBullets(inView: (x: number, y: number) => boolean): void {
    const b2 = this.bulletG;
    for (const b of this.g.bullets as GBullet[]) {
      if (!inView(b.x, b.y)) continue; const px = Math.round(b.x / 4) * 4, py = Math.round(b.y / 4) * 4, sp = Math.hypot(b.vx, b.vy) || 1;
      if (b.friendly) {
        if (b.w === 'rail') { b2.lineStyle(10, 0x7dd3fc, 0.55); b2.beginPath(); b2.moveTo(b.x - b.vx * 3, b.y - b.vy * 3); b2.lineTo(b.x, b.y); b2.strokePath(); b2.lineStyle(4, 0xffffff, 1); b2.beginPath(); b2.moveTo(b.x - b.vx * 3, b.y - b.vy * 3); b2.lineTo(b.x, b.y); b2.strokePath(); continue; }
        b2.lineStyle(6, 0xffd27a, 0.45); b2.beginPath(); b2.moveTo(b.x - (b.vx / sp) * 26, b.y - (b.vy / sp) * 26); b2.lineTo(b.x, b.y); b2.strokePath();
        b2.fillStyle(0xfff3b0, 1); b2.fillRect(px - 4, py - 4, 8, 8);
      } else if (b.kind === 'sniper') { b2.fillStyle(0xff3b3b, 1); b2.fillRect(px - 8, py - 8, 16, 16); b2.fillStyle(0xffffff, 1); b2.fillRect(px - 4, py - 4, 8, 8); }
      else { b2.lineStyle(6, 0xff5a3c, 0.4); b2.beginPath(); b2.moveTo(b.x - (b.vx / sp) * 22, b.y - (b.vy / sp) * 22); b2.lineTo(b.x, b.y); b2.strokePath(); b2.fillStyle(0xff5a3c, 1); b2.fillRect(px - 8, py - 8, 16, 16); b2.fillStyle(0xffe1d0, 1); b2.fillRect(px - 4, py - 4, 8, 8); }
    }
  }

  /** 플레이어 포즈 우선순위: ① 시퀀스(구르기/던지기/근접/발사) ② 이동 중 걷기(walk_a→idle→walk_b→idle) ③ 대기. 총이 막혀 있으면 총을 내린 자세 */
  private playerPose(): { sheet: string; row: number; rot: number } {
    const p = this.g.p, sq = p.seq, W = p.weapon, rows = ROW[W], sheet = `gs_${W}`;
    if (sq && sq.kind === 'roll') return { sheet: 'gs_roll', row: sq.i, rot: p.rollAng };
    if (sq && sq.kind === 'throw') return { sheet: 'gs_throw', row: sq.i, rot: p.aim };
    if (sq && sq.kind === 'melee') return { sheet, row: rows[`melee_${sq.i + 1}`], rot: p.aim };
    if (sq && sq.kind === 'fire' && !p.gunBlocked) return { sheet, row: rows[sq.steps[sq.i][0]] ?? rows.idle, rot: p.aim };
    const walk = p.moving ? [rows.walk_a, rows.idle, rows.walk_b, rows.idle][Math.floor(p.walk / 8) % 4] : rows.idle;
    return { sheet, row: walk, rot: p.aim };
  }
  private renderPlayer(t: number): void {
    const p = this.g.p, { sheet, row, rot } = this.playerPose(), img = this.playerImg;
    img.setTexture(sheet, row).setPosition(Math.round(p.x), Math.round(p.y)).setRotation(rot).setScale(ART);
    img.setAlpha(p.invuln > 0 && p.invuln < 1000 && p.seq?.kind !== 'roll' && Math.floor(t / 70) % 2 === 0 ? 0.4 : 1);
    if (p.hitFlash > 12) img.setTintFill(0xff6060); else img.clearTint();
    this.ellipseRot(this.shadowG, p.x + 4, p.y + 6, 20, 38, rot, 0.32);
    if (p.seq?.kind === 'roll' && p.rollI > 0 && Math.random() < 0.5) this.prt('dust', p.x - Math.cos(p.rollAng) * 30, p.y - Math.sin(p.rollAng) * 30, rnd(0, 6.28), rnd(20, 60), 18, 8, 0xb0b8c4);
  }

  private renderHud(nearW: string, cx: number, cy: number): void {
    const g = this.g, p = g.p, h = this.hudG, T2 = this.hudText;
    h.clear();
    for (let i = 0; i < p.maxHp; i++) {   // 체력 하트
      const full = p.hp >= i + 1, half = !full && p.hp > i, x0 = 12 + i * 18, y0 = 34;
      HEART.forEach((row, ry) => { for (let rx = 0; rx < 7; rx++) if (row[rx] === 'X') { h.fillStyle(full || (half && rx < 4) ? 0xef4444 : 0x3b0d12, 1); h.fillRect(x0 + rx * 2, y0 + ry * 2, 2, 2); } });
    }
    const sec = g.section;
    T2.room.setText(`${SECTIONS[sec].name}  ${sec === 3 ? (g.exitOpen ? '— 출구!' : '— BOSS') : ''}`);
    T2.left.setText(g.cleared[sec] ? (sec === 3 ? '' : '▲ 위층으로 올라가라') : sec === 3 ? '' : `남은 적 ${g.remaining}`);
    T2.score.setText(String(Math.round(g.score)));
    const w = WEAPONS[p.weapon];
    T2.weapon.setText(p.weapon === 'pistol' ? w.name : `${w.name}  ${p.ammo}/${w.ammo}`).setColor(p.gunBlocked ? '#f87171' : p.weapon === 'pistol' ? '#cbd5e1' : '#fde68a');
    T2.grenade.setText(`폭탄 ×${p.grenades}`);
    T2.combo.setText(g.combo >= 2 ? `${g.combo} COMBO  ×${(1 + 0.2 * Math.min(g.combo - 1, 10)).toFixed(1)}` : '').setAlpha(g.comboT > 0 ? Math.min(1, g.comboT / 30) : 0);
    const b = g.boss;
    if (b && b.state === 'alert') { T2.boss.setText('격납고 수문장'); h.fillStyle(0x0f172a, 0.8); h.fillRect(W / 2 - 100, 56, 200, 8); h.fillStyle(0xef4444, 1); h.fillRect(W / 2 - 100, 56, 200 * Math.max(0, b.hp / b.maxHp), 8); h.lineStyle(1, 0xffffff, 0.5); h.strokeRect(W / 2 - 100, 56, 200, 8); } else T2.boss.setText('');
    const touch = this.touchMode || this.sys.game.device.input.touch;
    if (nearW && p.weapon !== 'pistol' && !touch) T2.hint.setText(nearW).setAlpha(1);
    else if (p.gunBlocked && this.stage === 'PLAY') T2.hint.setText('총이 벽에 막혀 있다 — 물러서라').setAlpha(0.9);
    else if (this.tutorialT > 0) T2.hint.setText(touch ? '왼쪽 스틱: 이동 · 오른쪽 스틱을 끝까지 밀면 사격 · 문은 몸으로 밀어서 연다' : 'WASD 이동 · 마우스 조준/클릭 사격 · Shift 구르기(무적) · F/우클릭 근접 · G 폭탄 · E 줍기').setAlpha(Math.min(1, this.tutorialT / 30));
    else T2.hint.setAlpha(0);
    if ((g.cleared[sec] && sec < 3) || (sec === 3 && g.exitOpen)) { const gy = (SECTIONS[sec].r0 + 1) * TILE; if (gy < cy) { const a = 0.6 + 0.4 * Math.sin(this.time.now * 0.008); h.fillStyle(0xfde68a, a); h.fillTriangle(W / 2, 74, W / 2 - 12, 92, W / 2 + 12, 92); } }   // 다음 구역 문 방향 화살표
    this.popTexts.forEach(tx => tx.setVisible(false));   // 월드 → 화면 팝업 글자
    this.pops.forEach((pp, i) => { let tx = this.popTexts[i]; if (!tx) { tx = this.add.text(0, 0, '', textStyle(14, '#fff')).setOrigin(0.5); tx.setShadow(0, 0, '#000', 4, true, true); this.ui.add(tx); this.popTexts[i] = tx; } tx.setVisible(true).setText(pp.text).setColor(pp.color).setFontSize(pp.size).setPosition((pp.x - cx) * Z, (pp.y - cy) * Z).setAlpha(Math.min(1, pp.life / 14)); });
    if (this.mouse.used && !this.touchMode && this.stage === 'PLAY') {   // 크로스헤어: 발사하면 벌어지고, 명중은 흰 X, 사살은 빨간 X, 총이 막히면 빨강
      const mx = this.mouse.x, my = this.mouse.y, sp = 8 + this.cross.spread * 12, col = p.gunBlocked ? 0xf87171 : 0xffffff;
      h.lineStyle(1.5, col, 0.9); h.strokeCircle(mx, my, sp);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { h.beginPath(); h.moveTo(mx + dx * (sp + 2), my + dy * (sp + 2)); h.lineTo(mx + dx * (sp + 8), my + dy * (sp + 8)); h.strokePath(); }
      if (this.cross.hit > 0 || this.cross.kill > 0) { const k = this.cross.kill > 0, r = k ? 11 : 7, c2 = k ? 0xff3b3b : 0xffffff; h.lineStyle(k ? 3 : 2, c2, 1); h.beginPath(); h.moveTo(mx - r, my - r); h.lineTo(mx + r, my + r); h.moveTo(mx + r, my - r); h.lineTo(mx - r, my + r); h.strokePath(); }
    }
    const names = ['구르기', '근접', '폭탄', '줍기'];   // 모바일 버튼/스틱
    [T2.roll, T2.melee, T2.bomb, T2.pick].forEach((tx, i) => tx.setText(touch && (i < 3 || nearW) ? names[i] : ''));
    if (touch) {
      for (let i = 0; i < 4; i++) {
        if (i === 3 && !nearW) continue; const [bx, by] = this.btnPos(i), on = i === 0 ? p.rollCd <= 0 : i === 2 ? p.grenades > 0 : true;
        h.fillStyle(0x0f172a, 0.5); h.fillCircle(bx, by, 31); h.lineStyle(2, on ? 0x7dd3fc : 0x475569, 0.9); h.strokeCircle(bx, by, 31);
      }
      for (const s of [this.moveStick, this.aimStick]) if (s.id >= 0) { const fireOn = s === this.aimStick && Math.hypot(s.vx, s.vy) > 0.55; h.lineStyle(2, 0xffffff, 0.3); h.strokeCircle(s.ax, s.ay, 56); h.fillStyle(p.gunBlocked && s === this.aimStick ? 0xf87171 : fireOn ? 0xfde047 : 0xffffff, 0.4); h.fillCircle(s.ax + s.vx * 56, s.ay + s.vy * 56, 18); }
    }
    if (this.bannerT > 0) { this.bannerT--; if (this.bannerT < 30) this.banner.setAlpha(this.bannerT / 30); }
    if (this.paused) { h.fillStyle(0x000000, 0.6); h.fillRect(0, 0, W, H); }
    if (this.stage === 'DEAD') { h.fillStyle(0x000000, 0.55); h.fillRect(0, 0, W, H); }
    this.overlayText();
  }
  private overlayText(): void {
    if (!this.ovT) { this.ovT = this.add.text(W / 2, H / 2, '', { ...textStyle(20, '#ffffff'), align: 'center', lineSpacing: 10 }).setOrigin(0.5); this.ui.add(this.ovT); }
    if (this.paused) this.ovT.setText(`일시정지\n\n탭 / Enter: 계속\nT 두 번: 포기하고 본편으로${this.quitArmed ? '\n\n한 번 더 T → 포기 확인' : ''}`).setVisible(true);
    else if (this.stage === 'DEAD') this.ovT.setText(this.sim.lives > 0 ? `격추당했다…\n\n목숨 −1 · 이 구역 입구에서 바로 재시작\n(R / Enter / 탭)` : `격추당했다…\n\n더 이상 목숨이 없다\n(R / Enter / 탭)`).setVisible(true);
    else this.ovT.setVisible(false);
  }
}
