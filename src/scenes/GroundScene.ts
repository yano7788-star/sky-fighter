import Phaser from 'phaser';
import { H, STEP_MS, W } from '../core/config';
import { GroundSim, WEAPONS, type GEnemy, type GEvent, type GInput, type GKind, type WeaponId } from '../core/ground';
import { COLS, ROWS, SECTIONS, T, TILE, WORLD_H, WORLD_W, blocksSight, tileAt } from '../core/groundmap';
import type { Sim } from '../core/sim';
import { Fx } from '../render/fx';
import { textStyle } from '../render/hud';
import { R } from '../render/textures';
import { audio } from '../systems/audio';
import type { GroundTest } from '../groundtest';

const CUTS = ['cut_shotdown', 'cut_landing', 'cut_takeoff'];
const ENEMY_TEX: Record<GKind, string> = { rifle: 'g_rifle', charger: 'g_charger', sniper: 'g_sniper', turret: 'g_turret', drone: 'g_drone', tank: 'g_tank', boss: 'g_boss', heavy: 'g_charger', dog: 'g_rifle' };
const COVER_TEX = { barrier: 'p_barrier', crate: 'p_crate', stack: 'p_stack', crates2: 'p_crates2', barrel: 'p_barrel' } as const;
const SKIN = ['ace', 'sis1', 'sis2'];
const BLOOD: Record<GKind, number> = { rifle: 0x8b1a1a, charger: 0x8b1a1a, sniper: 0x8b1a1a, heavy: 0x8b1a1a, dog: 0x8b1a1a, turret: 0x20262e, drone: 0x20262e, tank: 0x20262e, boss: 0x20262e };
const SPARK: Record<GKind, string> = { rifle: '#fca5a5', charger: '#fca5a5', sniper: '#fca5a5', heavy: '#fca5a5', dog: '#fca5a5', turret: '#fde68a', drone: '#fde68a', tank: '#fde68a', boss: '#fde68a' };
/** 픽셀 아트 표시 배율 (판정은 그대로, 눈에 잘 띄게 키운다). 보스는 원본 크기가 이미 크다 */
const TIP_D = [58, 51, 60, 55];   // 시트 방향별(아래·왼·위·오른쪽) 몸통 중심 → 총구 거리(px)
const DIR_ANG = [Math.PI / 2, Math.PI, -Math.PI / 2, 0];   // 각 방향 프레임이 바라보는 각도
const K = { player: 1.2, cover: 1.3, enemy: 1.3, tank: 1.15, boss: 1.0, heavy: 1.6, dog: 0.95 };
const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
const CAM_FOLLOW_Y = 520;   // 플레이어가 화면 아래쪽 1/3에 오도록 (위가 진행 방향)

type Stage = 'INTRO' | 'PLAY' | 'OUTRO' | 'DEAD' | 'END';
interface Puff { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number }
interface Casing { x: number; y: number; vx: number; vy: number; life: number; rot: number }
interface Trace { x0: number; y0: number; x1: number; y1: number; life: number }

/**
 * 지상전 「강하」 (핫라인 마이애미식): 3스테이지 보스 직후 본편(GameScene)을 멈추고 이 씬을 위에 띄운다.
 *  컷(격추) → 줌인+모자이크 → 컷(착지) → 옥상에서 건물 두 층을 거쳐 격납고까지 걸어 올라가는 픽셀 아트 탑다운 → 컷(이륙) → 본편 복귀.
 * 규칙은 core/ground.ts(GroundSim), 이 씬은 입력·연출·렌더만 맡는다.
 */
export class GroundScene extends Phaser.Scene {
  private sim!: Sim;
  private g!: GroundSim;
  private stage: Stage = 'INTRO';
  private root!: Phaser.GameObjects.Container;
  private world!: Phaser.GameObjects.Container;
  private ui!: Phaser.GameObjects.Container;
  private fx!: Fx;
  private decals!: Phaser.GameObjects.RenderTexture;
  private tileCtx!: CanvasRenderingContext2D;
  private tileTex!: Phaser.Textures.CanvasTexture;
  private corpseLayer!: Phaser.GameObjects.Container;
  private pickupLayer!: Phaser.GameObjects.Container;
  private coverLayer!: Phaser.GameObjects.Container;
  private actorLayer!: Phaser.GameObjects.Container;
  private shadowG!: Phaser.GameObjects.Graphics;
  private doorG!: Phaser.GameObjects.Graphics;
  private ovG!: Phaser.GameObjects.Graphics;
  private bulletG!: Phaser.GameObjects.Graphics;
  private hudG!: Phaser.GameObjects.Graphics;
  private playerImg!: Phaser.GameObjects.Image;
  private coverImgs = new Map<number, Phaser.GameObjects.Image>();
  private enemyImgs = new Map<number, Phaser.GameObjects.Image>();
  private pickupImgs = new Map<number, Phaser.GameObjects.Image>();
  private corpseImgs = new Map<number, Phaser.GameObjects.Image>();
  private cutImg!: Phaser.GameObjects.Image;
  private hudText!: Record<string, Phaser.GameObjects.Text>;
  private banner!: Phaser.GameObjects.Text;
  private bannerT = 0;
  private veil!: Phaser.GameObjects.Rectangle;
  private redFlash!: Phaser.GameObjects.Rectangle;
  private pixel: Phaser.FX.Pixelate | null = null;
  private caps: Phaser.GameObjects.Text[] = [];
  private puffs: Puff[] = [];
  private casings: Casing[] = [];
  private traces: Trace[] = [];
  private muzzleT = 0; private muzzleW: WeaponId = 'pistol'; private lastShotAt = 0;
  private camY = WORLD_H - H;
  private decalDirty = 0;

  private keys = new Set<string>();
  private mouse = { x: W / 2, y: H / 2, used: false, down: false };
  private moveStick = { id: -1, ax: 0, ay: 0, vx: 0, vy: 0 };
  private aimStick = { id: -1, ax: 0, ay: 0, vx: 0, vy: 0 };
  private rollQ = false; private grenQ = false; private pickQ = false; private throwQ = false;
  private touchMode = false;
  private acc = 0; private hitStop = 0; private shake = 0; private slowUntil = 0; private slowScale = 1;
  private paused = false; private quitArmed = false;
  private tutorialT = 0; private deadTimer = 0; private finished = false;
  private ovT?: Phaser.GameObjects.Text;

  constructor() { super('GroundScene'); }

  private test: GroundTest | null = null;   // 테스트 페이지(?groundtest) 옵션

  init(data: { sim: Sim; test?: GroundTest }): void {
    this.sim = data.sim; this.test = data.test ?? null; this.stage = 'INTRO'; this.finished = false; this.paused = false; this.quitArmed = false; this.keys.clear();
    this.coverImgs = new Map(); this.enemyImgs = new Map(); this.pickupImgs = new Map(); this.corpseImgs = new Map();
    this.acc = 0; this.hitStop = 0; this.shake = 0; this.slowUntil = 0; this.slowScale = 1; this.deadTimer = 0; this.bannerT = 0; this.pixel = null; this.caps = [];
    this.puffs = []; this.casings = []; this.traces = []; this.muzzleT = 0; this.camY = WORLD_H - H; this.decalDirty = 0;
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
    this.world = this.add.container(0, 0);
    this.ui = this.add.container(0, 0);
    this.root.add([this.world, this.ui]);
    this.buildWorld();
    this.buildHud();
    this.cutImg = this.add.image(0, 0, 'cut_shotdown').setOrigin(0, 0).setVisible(false);
    this.root.add(this.cutImg);
    this.veil = this.add.rectangle(0, 0, W, H, 0x000000, 1).setOrigin(0, 0);
    this.root.add(this.veil);
    this.redFlash = this.add.rectangle(0, 0, W, H, 0xff2222, 0).setOrigin(0, 0);
    this.root.add(this.redFlash);
    this.bindInput();
    this.world.setVisible(false); this.ui.setVisible(false);
    if (this.test?.skipIntro) { this.world.setVisible(true); this.ui.setVisible(true); this.veil.setAlpha(0); this.stage = 'PLAY'; this.tutorialT = 60 * 6; for (let sct = 0; sct < this.test.section; sct++) this.redrawGate(sct); }
    else this.runIntro();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { audio.resume(); });
  }

  // ---------------------------------------------------------------- 월드 구성 (타일은 캔버스에 한 번 그린다)
  private buildWorld(): void {
    if (this.textures.exists('g_world')) this.textures.remove('g_world');
    this.tileTex = this.textures.createCanvas('g_world', WORLD_W, WORLD_H)!;
    this.tileCtx = this.tileTex.getContext(); this.tileCtx.imageSmoothingEnabled = false;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) this.drawTile(c, r);
    this.tileTex.refresh(); this.tileTex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    const tileImg = this.add.image(0, 0, 'g_world').setOrigin(0, 0);
    this.decals = this.add.renderTexture(0, 0, WORLD_W, WORLD_H).setOrigin(0, 0);
    this.decals.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.corpseLayer = this.add.container(0, 0); this.pickupLayer = this.add.container(0, 0); this.coverLayer = this.add.container(0, 0); this.actorLayer = this.add.container(0, 0);
    this.shadowG = this.add.graphics(); this.doorG = this.add.graphics(); this.ovG = this.add.graphics(); this.bulletG = this.add.graphics();
    this.playerImg = this.add.image(0, 0, `g_${SKIN[this.g.opts.pilot]}_b`);
    const fxLayer = this.add.container(0, 0);
    this.fx = new Fx(this, fxLayer);
    this.world.add([tileImg, this.decals, this.shadowG, this.corpseLayer, this.pickupLayer, this.coverLayer, this.doorG, this.actorLayer, this.playerImg, this.bulletG, this.ovG, fxLayer]);
  }

  /** 아틀라스(8×4, 칸 96px)에서 한 칸의 (sx,sy,sw,sh) 영역을 (x,y) 25×25 에 그린다 */
  private atlas(cell: number, ox: number, oy: number, ow: number, oh: number, x: number, y: number, w = TILE, h = TILE): void {
    const src = this.textures.get('t2_atlas').getSourceImage() as HTMLImageElement;
    this.tileCtx.drawImage(src, (cell % 8) * 96 + ox, Math.floor(cell / 8) * 96 + oy, ow, oh, x, y, w, h);
  }

  /** 타일 한 칸을 캔버스에 그린다 (벽·유리·잠긴 문·바닥). 스윙 도어 판은 매 프레임 따로 그린다 */
  private drawTile(c: number, r: number): void {
    const ctx = this.tileCtx, t = this.g.tiles[r * COLS + c], x = c * TILE, y = r * TILE, sec = SECTIONS[r < 34 ? 3 : r < 68 ? 2 : r < 102 ? 1 : 0];
    const h = ((c * 73856093) ^ (r * 19349663)) >>> 0;
    const floor = () => {
      const base = sec.floor === 'roof' ? [0, 1, 2] : sec.floor === 'indoor' ? [8, 9, 10] : [16, 17, 18], bh = (((c >> 2) * 2654435761) ^ ((r >> 2) * 40503)) >>> 0, vi = bh % 20 < 14 ? 0 : bh % 20 < 19 ? 1 : 2;
      this.atlas(base[vi], (c % 4) * 24, (r % 4) * 24, 24, 24, x, y);   // 4×4 타일 덩어리마다 변형을 골라 이어 붙인다
      ctx.fillStyle = sec.floor === 'hangar' ? 'rgba(8,12,20,.14)' : 'rgba(8,12,20,.24)'; ctx.fillRect(x, y, TILE, TILE);   // 바닥을 살짝 눌러 캐릭터·적이 돋보이게
      if (r > 0 && this.g.tiles[(r - 1) * COLS + c] === T.WALL) { ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.fillRect(x, y, TILE, 6); }
    };
    switch (t) {
      case T.WALL: {
        this.atlas(sec.floor === 'hangar' ? 20 : 13, (c % 4) * 24, (r % 4) * 24, 24, 24, x, y); ctx.fillStyle = 'rgba(8,12,20,.25)'; ctx.fillRect(x, y, TILE, TILE);
        const below = r + 1 < ROWS && this.g.tiles[(r + 1) * COLS + c] !== T.WALL, above = r > 0 && this.g.tiles[(r - 1) * COLS + c] !== T.WALL;
        if (above) { ctx.fillStyle = '#3d495c'; ctx.fillRect(x, y, TILE, 3); }
        if (below) { ctx.fillStyle = '#12161d'; ctx.fillRect(x, y + TILE - 7, TILE, 7); ctx.fillStyle = '#323d4d'; ctx.fillRect(x, y + TILE - 7, TILE, 1); }
        if (h % 5 === 0) { ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.fillRect(x + 4, y + 8, 12, 2); }
        break;
      }
      case T.LOW: { floor(); this.atlas(3, 0, 0, 96, 96, x, y); break; }
      case T.GLASS: { floor(); this.atlas(25, 0, 0, 96, 96, x, y); break; }
      case T.GATE: { floor(); { const top = this.g.tiles[(r - 1) * COLS + c] === T.GATE ? r - 1 : r, left = this.g.tiles[r * COLS + c - 1] === T.GATE ? c - 1 : c; this.atlas(28, (c - left) * 48, (r - top) * 48, 48, 48, x, y); } break; }
      case T.EXIT: { floor(); { const top = this.g.tiles[(r - 1) * COLS + c] === T.EXIT ? r - 1 : r, left = this.g.tiles[r * COLS + c - 1] === T.EXIT ? c - 1 : c; this.atlas(21, (c - left) * 48, (r - top) * 48, 48, 48, x, y); } break; }
      default: floor(); if (t === T.DOOR) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x, y, TILE, TILE); }
    }
  }
  private redrawGate(section: number): void {
    const r0 = SECTIONS[section].r0;
    for (let r = r0 - 1; r <= r0 + 2; r++) for (let c = 7; c <= 10; c++) if (r >= 0) this.drawTile(c, r);
    if (section < 3) this.atlas(29, 0, 0, 96, 96, 8 * TILE, r0 * TILE, 2 * TILE, 2 * TILE);   // 열린 보안문
    this.tileTex.refresh();
  }

  private buildHud(): void {
    this.hudG = this.add.graphics();
    this.ui.add(this.hudG);
    const t = (x: number, y: number, size: number, color: string, ox = 0, oy = 0) => { const o = this.add.text(x, y, '', textStyle(size, color)).setOrigin(ox, oy); o.setShadow(0, 1, '#000', 3, true, true); this.ui.add(o); return o; };
    this.hudText = {
      room: t(W / 2, 12, 13, '#e2e8f0', 0.5, 0), score: t(W - 12, 12, 13, '#fde68a', 1, 0), weapon: t(12, H - 46, 14, '#e2e8f0', 0, 0), grenade: t(12, H - 26, 12, '#cbd5e1', 0, 0),
      combo: t(W / 2, 100, 18, '#fbbf24', 0.5, 0.5), boss: t(W / 2, 40, 12, '#fca5a5', 0.5, 0), hint: t(W / 2, H - 120, 13, '#e2e8f0', 0.5, 0.5), roll: t(W - 52, H - 252, 10, '#94a3b8', 0.5, 0.5), gren: t(W - 52, H - 332, 10, '#94a3b8', 0.5, 0.5), pick: t(W - 52, H - 412, 10, '#fde68a', 0.5, 0.5),
      left: t(W / 2, 28, 11, '#94a3b8', 0.5, 0),
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
      if (k === 'q') this.grenQ = true;
      if (k === 'e') this.pickQ = true;
      if (k === 'f') this.throwQ = true;
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
  private inBtn(x: number, y: number, bx: number, by: number): boolean { return Math.hypot(x - bx, y - by) < 40; }

  private pointerDown(p: Phaser.Input.Pointer): void {
    audio.unlock();
    const x = this.lx(p), y = this.ly(p);
    if (this.stage === 'DEAD') { this.deadConfirm(); return; }
    if (this.paused) { this.setPaused(false); return; }
    if (this.stage !== 'PLAY') return;
    if (p.wasTouch) {
      this.touchMode = true;
      if (this.inBtn(x, y, W - 52, H - 252)) { this.rollQ = true; return; }
      if (this.inBtn(x, y, W - 52, H - 332)) { this.grenQ = true; return; }
      if (this.inBtn(x, y, W - 52, H - 412)) { this.pickQ = true; return; }
      if (x < W / 2 && this.moveStick.id < 0) this.moveStick = { id: p.id, ax: x, ay: y, vx: 0, vy: 0 };
      else if (x >= W / 2 && this.aimStick.id < 0) this.aimStick = { id: p.id, ax: x, ay: y, vx: 0, vy: 0 };
    } else {
      this.mouse.used = true; this.mouse.x = x; this.mouse.y = y;
      if (p.rightButtonDown()) this.throwQ = true; else this.mouse.down = true;
    }
  }
  private pointerMove(p: Phaser.Input.Pointer): void {
    const x = this.lx(p), y = this.ly(p);
    if (!p.wasTouch) { this.mouse.used = true; this.mouse.x = x; this.mouse.y = y; return; }
    for (const s of [this.moveStick, this.aimStick]) if (s.id === p.id) {
      const dx = x - s.ax, dy = y - s.ay, d = Math.hypot(dx, dy), max = 52;
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
    let ax = 0, ay = 0, fire = k.has('j') || k.has('z') || k.has('control');
    if (this.aimStick.id >= 0) { const m = Math.hypot(this.aimStick.vx, this.aimStick.vy); if (m > 0.22) { ax = this.aimStick.vx; ay = this.aimStick.vy; fire = true; } }
    else if (this.mouse.used && !this.touchMode) { ax = this.mouse.x - p.x; ay = this.mouse.y + this.camY - p.y; if (Math.hypot(ax, ay) < 12) { ax = 0; ay = 0; } if (this.mouse.down) fire = true; }
    const inp: GInput = { mx, my, ax, ay, fire, roll: this.rollQ, grenade: this.grenQ, pickup: this.pickQ || k.has('e'), throwW: this.throwQ };
    this.rollQ = false; this.grenQ = false; this.pickQ = false; this.throwQ = false;
    return inp;
  }

  private setPaused(v: boolean): void {
    if (this.stage !== 'PLAY') return;
    this.paused = v; this.quitArmed = false;
    if (v) audio.suspend(); else audio.resume();
  }
  private pressQuit(): void {
    if (!this.quitArmed) { this.quitArmed = true; return; }
    this.finish(false);
  }

  // ---------------------------------------------------------------- 연출 타임라인
  private cover2(key: string): void {
    this.cutImg.setTexture(key).setVisible(true).setPosition(0, 0).setAlpha(1).setScale(W / this.cutImg.width, H / this.cutImg.height);
  }
  private addPixelate(amount: number): void {
    const fx = this.cameras.main.postFX;
    if (!fx || this.game.renderer.type !== Phaser.WEBGL) return;
    this.pixel = fx.addPixelate(amount);
  }
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
    // ① 격추 컷 유지 → ② 줌인 + 모자이크 → ③ 착지 컷
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
    // ④ 지상으로: 컷을 걷어내며 한 번 더 모자이크가 풀린다
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

  /** 지상전을 끝내고 본편으로 돌아간다 (win=false: 포기/실패 → 게임오버) */
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
      this.coverImgs.forEach(i => i.destroy()); this.coverImgs.clear(); this.enemyImgs.forEach(i => i.destroy()); this.enemyImgs.clear(); this.pickupImgs.forEach(i => i.destroy()); this.pickupImgs.clear(); this.corpseImgs.forEach(i => i.destroy()); this.corpseImgs.clear();
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
        if (this.hitStop > 0) { this.hitStop--; continue; }
        this.tick();
      }
      audio.updateMusic(this.g.isBossRoom ? 'boss' : 'solar');
    }
    if (this.stage === 'DEAD' && this.deadTimer > 0) this.deadTimer--;
    this.render();
  }

  private tick(): void {
    const g = this.g;
    if (this.test?.god) { g.p.invuln = 99999; g.p.hp = g.p.maxHp; }   // 무적 (깜박임 방지로 피격 연출만 남는다)
    g.step(this.buildInput());
    this.fx.tick(); this.tickParticles();
    if (this.tutorialT > 0) this.tutorialT--;
    for (const e of g.drain()) this.handle(e);
    if (this.shake > 0.1) this.shake *= 0.82; else this.shake = 0;
    this.decalDirty = 0;
  }

  private tickParticles(): void {
    for (let i = this.puffs.length - 1; i >= 0; i--) { const p = this.puffs[i]; p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; if (--p.life <= 0) this.puffs.splice(i, 1); }
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i]; c.x += c.vx; c.y += c.vy; c.vx *= 0.9; c.vy *= 0.9; c.rot += 0.5;
      if (--c.life <= 0) { this.stamp(c.x, c.y, 2, 1, 0xd4a537, 0.95); this.casings.splice(i, 1); }   // 바닥에 떨어져 남는다
    }
    for (let i = this.traces.length - 1; i >= 0; i--) if (--this.traces[i].life <= 0) this.traces.splice(i, 1);
  }

  /** 바닥 데칼(혈흔·탄흔·탄피)을 한 점 찍는다 */
  private stamp(x: number, y: number, w: number, h: number, color: number, alpha: number): void {
    if (this.decalDirty > 120) return;
    this.decals.fill(color, alpha, Math.round(x), Math.round(y), w, h); this.decalDirty++;
  }
  private smoke(x: number, y: number, n: number, spread = 1.2, size = 4): void {
    for (let i = 0; i < n && this.puffs.length < 90; i++) this.puffs.push({ x, y, vx: (Math.random() - 0.5) * spread, vy: (Math.random() - 0.5) * spread - 0.2, life: 30 + Math.random() * 20, max: 50, size: size * (0.7 + Math.random() * 0.8) });
  }

  private handle(e: GEvent): void {
    const fx = this.fx, g = this.g;
    switch (e.t) {
      case 'shot': {
        audio.sfx(e.weapon === 'pistol' ? 'gPistol' : e.weapon === 'shotgun' ? 'gShotgun' : e.weapon === 'smg' ? 'gSmg' : 'gRail');
        this.shake = Math.max(this.shake, WEAPONS[e.weapon].kick * (e.weapon === 'shotgun' ? 1.5 : 1)); this.muzzleT = e.weapon === 'smg' ? 2 : 3; this.muzzleW = e.weapon; this.lastShotAt = this.time.now;
        const a = e.ang, tp = this.tip(a), mx = e.x + tp[0], my = e.y + tp[1];
        this.smoke(mx, my, e.weapon === 'shotgun' ? 4 : 1, 0.8, e.weapon === 'shotgun' ? 6 : 3);
        // 탄피: 총의 오른쪽으로 튄다
        if (this.casings.length < 60 && e.weapon !== 'rail') { const side = a + Math.PI / 2 + (Math.random() - 0.5) * 0.9, sp = 2 + Math.random() * 2.5; this.casings.push({ x: e.x + this.tip(a)[0] * 0.6, y: e.y + this.tip(a)[1] * 0.6, vx: Math.cos(side) * sp, vy: Math.sin(side) * sp, life: 14 + Math.random() * 10, rot: 0 }); }
        if (e.weapon === 'rail') { let ex = e.x, ey = e.y; for (let i = 0; i < 90; i++) { ex += Math.cos(a) * 9; ey += Math.sin(a) * 9; if (blocksSight(tileAt(g.tiles, ex, ey)) && tileAt(g.tiles, ex, ey) !== T.DOOR) break; } this.traces.push({ x0: mx, y0: my, x1: ex, y1: ey, life: 8 }); }
        break;
      }
      case 'hit': {
        audio.sfx('gHit'); fx.sparkBurst(e.x, e.y, SPARK[e.kind], 4);
        const bl = BLOOD[e.kind]; for (let i = 0; i < 3; i++) this.stamp(e.x + Math.cos(e.ang) * (6 + i * 5) + (Math.random() - 0.5) * 5, e.y + Math.sin(e.ang) * (6 + i * 5) + (Math.random() - 0.5) * 5, 2, 2, bl, 0.7);
        if (!e.kill && e.dmg >= 1) fx.pop(e.x, e.y - 12, String(Math.max(1, Math.round(e.dmg * 10))), '#ffffff', 11);
        break;
      }
      case 'kill': {
        audio.sfx('gKill'); fx.explosion(e.x, e.y, SPARK[e.kind], e.kind === 'tank' || e.kind === 'boss' ? 30 : 8); fx.pop(e.x, e.y - 18, `+${e.pts}`, '#fde68a', 13); if (e.combo >= 3) fx.pop(e.x, e.y - 34, `${e.combo} COMBO`, '#fbbf24', 12);
        // 혈흔: 쓰러진 방향으로 길게 번진다
        const bl = BLOOD[e.kind], n = e.kind === 'boss' ? 16 : 11;
        for (let i = 0; i < n; i++) { const d = 4 + i * 2.3 + Math.random() * 6, spread = (Math.random() - 0.5) * (0.5 + i * 0.07), s = 2 + Math.floor(Math.random() * 3); this.stamp(e.x + Math.cos(e.ang + spread) * d, e.y + Math.sin(e.ang + spread) * d, s, s, bl, 0.75); }
        for (let i = 0; i < 5; i++) this.stamp(e.x + (Math.random() - 0.5) * 20, e.y + (Math.random() - 0.5) * 20, 4, 4, bl, 0.8);
        break;
      }
      case 'boom': audio.sfx('boom'); fx.explosion(e.x, e.y, '#fb923c', Math.min(30, 10 + Math.round(e.r / 5))); fx.ring(e.x, e.y, '#fde68a', e.r); this.scorch(e.x, e.y, e.r); this.smoke(e.x, e.y, 6, 2.4, 7); break;
      case 'hurt': audio.sfx('gHurt'); this.redFlash.setAlpha(0.35); this.tweens.add({ targets: this.redFlash, alpha: 0, duration: 300 }); this.shake = Math.max(this.shake, 8); try { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(50); } catch { /* 미지원 */ } break;
      case 'roll': audio.sfx('gRoll'); fx.ring(e.x, e.y + 6, '#cbd5e1', 22); break;
      case 'style': audio.sfx('gStyle'); fx.pop(e.x, e.y - 30, 'STYLE!', '#67e8f9', 18); fx.ring(e.x, e.y, '#67e8f9', 50); break;
      case 'pickup': audio.sfx(e.what === 'heart' ? 'heal' : 'item'); fx.ring(e.x, e.y, e.what === 'heart' ? '#f87171' : '#fde68a', 40); fx.pop(e.x, e.y - 20, e.what === 'heart' ? '+♥' : e.what === 'weapon' ? 'WEAPON' : 'AMMO', '#ffffff', 12); break;
      case 'drop': fx.ring(e.x, e.y, '#fde68a', 22); break;
      case 'wallhit': fx.sparkDir(e.x, e.y, '#fde68a', 4, e.ang + Math.PI, 0.8); this.stamp(e.x, e.y, 2, 2, 0x0b0f14, 0.7); this.smoke(e.x, e.y, 1, 0.6, 2); break;
      case 'alert': fx.pop(e.x, e.y - 26, '!', '#ff5555', 20); audio.sfx('gEnemyShot'); break;
      case 'doorbash': audio.sfx('gKill'); fx.pop(e.x, e.y - 22, 'DOOR!', '#67e8f9', 14); fx.ring(e.x, e.y, '#67e8f9', 36); break;
      case 'door': audio.sfx('gRoll'); break;
      case 'gate': audio.sfx('item'); this.redrawGate(e.section); break;
      case 'throw': audio.sfx('gThrow'); fx.pop(g.p.x, g.p.y - 26, 'THROW!', '#fde68a', 14); break;
      case 'section': if (e.n > 0 || this.stage === 'PLAY') this.say(e.name); break;
      case 'cleared': this.say(e.n === 3 ? 'MISSION CLEAR' : 'CLEAR!', 30); audio.sfx('item'); break;
      case 'exitopen': this.say('출구로! 이륙 격납고', 26); break;
      case 'shake': this.shake = Math.max(this.shake, e.v); break;
      case 'hitstop': this.hitStop = Math.max(this.hitStop, e.frames); break;
      case 'slowmo': this.slowUntil = this.time.now + e.ms; this.slowScale = e.scale; break;
      case 'bossPhase': this.say(`PHASE ${e.phase}`, 30); audio.sfx('enrage'); break;
      case 'coverBreak': fx.explosion(e.x, e.y, '#f97316', 14); break;
      case 'reset': this.decals.clear(); break;
      case 'win': audio.sfx('item'); this.runOutro(); break;
      case 'dead': this.stage = 'DEAD'; this.deadTimer = 25; audio.sfx('enrage'); break;
    }
  }

  private scorch(x: number, y: number, r: number): void {
    const n = Math.min(14, 4 + Math.round(r / 8));
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, d = Math.random() * r * 0.45, s = 3 + Math.floor(Math.random() * 5); this.stamp(x + Math.cos(a) * d, y + Math.sin(a) * d, s, s, 0x0b0f14, 0.4); }
  }

  // ---------------------------------------------------------------- 렌더
  private spriteRot(e: GEnemy): number {
    switch (e.kind) {
      case 'rifle': case 'charger': case 'heavy': case 'dog': return e.ang - Math.PI / 2;
      case 'sniper': case 'turret': return e.ang;
      default: return 0;
    }
  }
  /** 보스 스프라이트: 체력에 따라 외피 파손, 평소엔 걸음 프레임을 번갈아 */
  private bossFrame(e: GEnemy): string {
    const k = e.hp / e.maxHp; if (k < 0.34) return 'b2_dmg2'; if (k < 0.67) return 'b2_dmg1';
    return ['b2_0', 'b2_1', 'b2_0', 'b2_2'][Math.floor(this.time.now / 260) % 4];
  }
  private onScreen(y: number, m = 80): boolean { return y > this.camY - m && y < this.camY + H + m; }

  private render(): void {
    if (this.stage === 'INTRO' || this.stage === 'END') return;
    const g = this.g, p = g.p, t = this.time.now;
    // 카메라: 플레이어를 아래쪽 1/3에 두고, 조준 방향 쪽으로 살짝 내다본다 (마우스 위치 / 조준 스틱)
    let look = 0;
    if (this.aimStick.id >= 0) look = this.aimStick.vy * 90; else if (this.mouse.used && !this.touchMode) look = Math.max(-140, Math.min(140, (this.mouse.y + this.camY - p.y) * 0.3));
    const want = Math.max(0, Math.min(WORLD_H - H, p.y - CAM_FOLLOW_Y + look));
    this.camY += (want - this.camY) * 0.14;
    const sh = this.shake;
    this.world.setPosition(sh ? (Math.random() - 0.5) * sh : 0, -Math.round(this.camY) + (sh ? (Math.random() - 0.5) * sh : 0));
    this.fx.render();
    this.shadowG.clear(); this.ovG.clear(); this.bulletG.clear(); this.doorG.clear();
    const px = (v: number) => Math.round(v);

    // 엄폐물
    for (const c of g.cover) {
      let img = this.coverImgs.get(c.id);
      if (!img) { img = this.add.image(c.x, c.y, COVER_TEX[c.kind]).setScale(K.cover); this.coverLayer.add(img); this.coverImgs.set(c.id, img); }
      const vis = !c.dead && this.onScreen(c.y); img.setVisible(vis).setPosition(c.x, c.y + (c.kind === 'barrel' ? -2 : 0));
      if (vis) this.shadowG.fillStyle(0x000000, 0.28).fillEllipse(c.x + 3, c.y + c.h / 2 + 1, c.w * 0.9, 8);
    }
    // 시체: 바닥에 남아 있다 (쓰러진 방향으로 눕는다)
    for (const c of g.corpses) {
      let img = this.corpseImgs.get(c.id);
      if (!img) { img = this.add.image(c.x, c.y, c.kind === 'boss' ? 'b2_dmg2' : 'p2_corpse').setTint(c.kind === 'boss' ? 0x777777 : c.kind === 'dog' ? 0xb08a5a : 0xcc7a6a); this.corpseLayer.add(img); this.corpseImgs.set(c.id, img); }
      const ks = (c.kind === 'boss' ? K.boss : c.kind === 'heavy' ? K.heavy : c.kind === 'dog' ? K.dog : K.enemy);
      if (c.kind === 'boss') img.setVisible(this.onScreen(c.y)).setPosition(px(c.x), px(c.y)).setScale(1).setAlpha(0.92);
      else img.setVisible(this.onScreen(c.y)).setPosition(px(c.x), px(c.y)).setRotation(c.a - Math.PI / 2).setScale(ks * 0.78 * (c.kind === 'dog' ? 0.7 : 1)).setAlpha(0.95);
    }
    // 문 (스윙 도어 판): 열린 방향은 플레이어 반대쪽
    for (let r = Math.max(0, Math.floor(this.camY / TILE) - 1); r < Math.min(ROWS, Math.floor((this.camY + H) / TILE) + 2); r++) for (let c = 0; c < COLS; c++) {
      if (g.tiles[r * COLS + c] !== T.DOOR) continue;
      const cx = (c + 0.5) * TILE, hy = r * TILE + 1, open = Math.min(1, (g.doorT.get(r * COLS + c) ?? 0) / 14), side = p.x < cx ? 1 : -1, ang = Math.PI / 2 - side * open * 1.35;
      this.doorG.lineStyle(5, 0x6b7280, 1); this.doorG.beginPath(); this.doorG.moveTo(cx, hy); this.doorG.lineTo(cx + Math.cos(ang) * 22, hy + Math.sin(ang) * 22); this.doorG.strokePath();
      this.doorG.lineStyle(2, 0x9aa3b2, 1); this.doorG.beginPath(); this.doorG.moveTo(cx, hy); this.doorG.lineTo(cx + Math.cos(ang) * 22, hy + Math.sin(ang) * 22); this.doorG.strokePath();
      this.doorG.fillStyle(0xfbbf24, 1).fillRect(px(cx + Math.cos(ang) * 17) - 1, px(hy + Math.sin(ang) * 17) - 1, 3, 3);
    }
    // 아이템 (바닥에 놓인 무기: 종류별 색)
    const livePk = new Set<number>();
    let nearW = '';
    for (const k of g.pickups) {
      livePk.add(k.id);
      let img = this.pickupImgs.get(k.id);
      if (!img) { img = this.add.image(k.x, k.y, k.kind === 'weapon' ? `i_${k.weapon}` : 'i_medkit').setScale(1.25).setRotation(k.kind === 'weapon' ? ((k.id * 1.7) % 1.2) - 0.6 : 0); this.pickupLayer.add(img); this.pickupImgs.set(k.id, img); }
      const vis = this.onScreen(k.y); img.setVisible(vis).setPosition(px(k.x), px(k.y + Math.sin(k.t * 0.08) * 1.5));
      if (vis) { this.ovG.lineStyle(1, k.kind === 'heart' ? 0xf87171 : 0xfde68a, 0.4 + 0.3 * Math.sin(k.t * 0.1)); this.ovG.strokeCircle(k.x, k.y, 16 + Math.sin(k.t * 0.1) * 1.5); }
      if (k.kind === 'weapon' && Math.hypot(p.x - k.x, p.y - k.y) < 30) nearW = `E 줍기: ${WEAPONS[k.weapon!].name}${k.ammo !== undefined && k.ammo < 999 ? ' ' + k.ammo : ''}`;
    }
    for (const [id, img] of this.pickupImgs) if (!livePk.has(id)) { img.destroy(); this.pickupImgs.delete(id); }
    // 적
    const live = new Set<number>();
    for (const e of g.enemies) {
      live.add(e.id);
      let img = this.enemyImgs.get(e.id);
      if (!img) { img = this.add.image(e.x, e.y, ENEMY_TEX[e.kind]); this.actorLayer.add(img); this.enemyImgs.set(e.id, img); }
      const vis = this.onScreen(e.y, 120); img.setVisible(vis);
      if (!vis) continue;
      const ks = e.kind === 'boss' ? K.boss : e.kind === 'tank' ? K.tank : e.kind === 'heavy' ? K.heavy : e.kind === 'dog' ? K.dog : K.enemy, bob = e.kind === 'drone' ? Math.sin(t * 0.012 + e.id) * 2 : 0;
      if (e.kind === 'boss') img.setTexture(this.bossFrame(e));
      img.setPosition(px(e.x), px(e.y + bob)).setRotation(this.spriteRot(e)).setScale(ks, e.kind === 'dog' ? ks * 0.7 : ks);
      if (e.flash > 0) img.setTintFill(0xffffff);
      else if (e.state === 'STUN') img.setTint(0xffcc66);
      else if (e.kind === 'heavy') img.setTint(0x9aa7b8);
      else if (e.kind === 'dog') img.setTint(0xb08a5a);
      else img.clearTint();
      this.shadowG.fillStyle(0x000000, 0.3).fillEllipse(e.x + 2, e.y + e.r * 0.8, e.r * 1.7, e.r * 0.7);
      // 시야 부채꼴: 경계 전 적의 시야를 벽에 막히는 만큼만 보여 준다 (은신 플레이용)
      if (e.aw < 2 && e.kind !== 'drone' && e.kind !== 'turret') this.drawCone(e);
      if (e.state === 'WIND') {
        const a = Math.atan2(e.ly - e.y, e.lx - e.x), len = e.kind === 'sniper' ? 900 : e.kind === 'boss' ? 900 : 360, k = e.kind === 'sniper' ? 1 - e.t / 75 : 1 - e.t / 55;
        this.ovG.lineStyle(e.kind === 'sniper' ? 1 + k * 2 : 4, 0xff3b3b, 0.35 + 0.5 * k);
        this.ovG.beginPath(); this.ovG.moveTo(e.x, e.y); this.ovG.lineTo(e.x + Math.cos(a) * len, e.y + Math.sin(a) * len); this.ovG.strokePath();
        if (e.kind !== 'sniper') { this.ovG.fillStyle(0xff3b3b, 0.18 * k); this.ovG.fillCircle(e.lx, e.ly, 18); }
      }
      if (e.aw === 1) { this.ovG.lineStyle(2, 0xfbbf24, 0.8); this.ovG.strokeCircle(e.x, e.y - e.r - 10, 4); }
    }
    for (const [id, img] of this.enemyImgs) if (!live.has(id)) { img.destroy(); this.enemyImgs.delete(id); }
    // 폭발 예고 구역
    for (const z of g.zones) {
      const k = 1 - z.t / z.max;
      this.ovG.fillStyle(0xff3b3b, 0.12 + 0.2 * k); this.ovG.fillCircle(z.x, z.y, z.r);
      this.ovG.lineStyle(2, 0xff6b6b, 0.8); this.ovG.strokeCircle(z.x, z.y, z.r); this.ovG.strokeCircle(z.x, z.y, z.r * k);
    }
    // 수류탄
    for (const gr of g.grenadeList) { const arc = Math.sin((gr.t / gr.max) * Math.PI) * 26; this.shadowG.fillStyle(0, 0.3).fillEllipse(gr.x, gr.y, 8, 4); this.bulletG.fillStyle(0x65a30d, 1).fillCircle(px(gr.x), px(gr.y - arc), 4); this.ovG.lineStyle(1, 0xfde68a, 0.4); this.ovG.strokeCircle(gr.tx, gr.ty, 62); }
    this.renderPlayer(t);
    // 탄 (픽셀 사각형) — 화면 안의 것만
    for (const b of g.bullets) {
      if (!this.onScreen(b.y, 30)) continue;
      const x = px(b.x), y = px(b.y);
      if (b.friendly) {
        if (b.kind === 'throw') { this.bulletG.fillStyle(0xcbd5e1, 1).fillRect(x - 6, y - 2, 12, 4); continue; }
        if (b.w === 'rail') continue;   // 레일은 궤적선으로
        this.bulletG.fillStyle(0xfff1a8, 1).fillRect(x - 2, y - 2, 4, 4); this.bulletG.fillStyle(0xffffff, 1).fillRect(x - 1, y - 1, 2, 2);
        this.bulletG.fillStyle(0xfff1a8, 0.35).fillRect(px(b.x - b.vx * 0.9) - 1, px(b.y - b.vy * 0.9) - 1, 3, 3);   // 짧은 꼬리
      } else if (b.kind === 'sniper') {
        this.bulletG.fillStyle(0xff3b3b, 1).fillRect(x - 3, y - 3, 6, 6); this.bulletG.fillStyle(0xffffff, 1).fillRect(x - 1, y - 1, 2, 2);
      } else {
        const s = Math.max(3, Math.round(b.r)); this.bulletG.fillStyle(0xff5a3c, 1).fillRect(x - s, y - s, s * 2, s * 2); this.bulletG.fillStyle(0xffe1d0, 1).fillRect(x - 1, y - 1, 2, 2);
      }
    }
    for (const tr of this.traces) { const k = tr.life / 8; this.bulletG.lineStyle(4 * k + 1, 0x7dd3fc, k); this.bulletG.beginPath(); this.bulletG.moveTo(tr.x0, tr.y0); this.bulletG.lineTo(tr.x1, tr.y1); this.bulletG.strokePath(); this.bulletG.lineStyle(1, 0xffffff, k); this.bulletG.beginPath(); this.bulletG.moveTo(tr.x0, tr.y0); this.bulletG.lineTo(tr.x1, tr.y1); this.bulletG.strokePath(); }
    // 연기·탄피(날아가는 중)
    for (const s of this.puffs) { const k = s.life / s.max; this.ovG.fillStyle(0xaab2bd, 0.28 * k); this.ovG.fillRect(px(s.x - s.size / 2), px(s.y - s.size / 2), Math.ceil(s.size), Math.ceil(s.size)); }
    for (const c of this.casings) { this.bulletG.fillStyle(0xe2b34a, 1).fillRect(px(c.x), px(c.y), 2, 2); }
    this.renderHud(nearW);
  }

  /** 시야 부채꼴을 벽에 맞춰 잘라서 그린다 */
  private drawCone(e: GEnemy): void {
    const view = e.kind === 'sniper' ? 520 : 330, half = 0.96, N = 11, pts: number[] = [e.x, e.y];
    for (let i = 0; i <= N; i++) {
      const a = e.ang - half + (i / N) * half * 2, ca = Math.cos(a), sa = Math.sin(a);
      let d = 14; while (d < view && !blocksSight(tileAt(this.g.tiles, e.x + ca * d, e.y + sa * d))) d += 12;
      pts.push(e.x + ca * Math.min(d, view), e.y + sa * Math.min(d, view));
    }
    this.ovG.fillStyle(e.aw === 1 ? 0xfbbf24 : 0xffffff, e.aw === 1 ? 0.12 : 0.07);
    this.ovG.beginPath(); this.ovG.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) this.ovG.lineTo(pts[i], pts[i + 1]); this.ovG.closePath(); this.ovG.fillPath();
  }

  /** 조준 각도에 가장 가까운 시트 방향 (0 아래, 1 왼쪽, 2 위, 3 오른쪽)과 그 방향의 기준 각도 */
  private dirOf(a: number): number { const c = Math.cos(a), s2 = Math.sin(a); return Math.abs(c) > Math.abs(s2) ? (c < 0 ? 1 : 3) : (s2 < 0 ? 2 : 0); }
  /** 총구 위치: 몸통 중심에서 조준 방향으로 (방향별 총 길이가 조금씩 다르다) */
  private tip(a: number): [number, number] { const d = TIP_D[this.dirOf(a)] * K.player; return [Math.cos(a) * d, Math.sin(a) * d]; }

  private renderPlayer(t: number): void {
    const g = this.g, p = g.p, img = this.playerImg;
    // 정탑다운 도트: 총이 바라보는 방향으로 곧게 뻗은 4방향 프레임 + 조준각과의 나머지(≤45°)만큼 몸통 중심으로 회전
    const dir = this.dirOf(p.aim), firing = this.muzzleT > 0 || this.time.now - this.lastShotAt < 90;
    const col = firing ? 7 + (Math.floor(this.time.now / 50) % 3) : p.moving ? Math.floor(p.walk * 0.75) % 4 : 0;   // 이동: 대기 + 걷기 3프레임 = 4프레임 순환 (달리기 줄은 쓰지 않는다)
    let rot = Math.atan2(Math.sin(p.aim - DIR_ANG[dir]), Math.cos(p.aim - DIR_ANG[dir])), sc = K.player;
    if (p.rollT > 0) { const k = 1 - p.rollT / 18; rot += k * Math.PI * 2 * (p.rdx >= 0 ? 1 : -1); sc *= 0.88; }
    img.setTexture('p4_top', dir * 10 + (p.rollT > 0 ? 0 : col)).setOrigin(0.5, 0.5).setFlipX(false);
    const recoil = p.kick * 0.6;
    img.setPosition(Math.round(p.x - Math.cos(p.aim) * recoil), Math.round(p.y - Math.sin(p.aim) * recoil)).setRotation(rot).setScale(sc);
    img.setAlpha(p.invuln > 0 && p.invuln < 1000 && p.rollT <= 0 && Math.floor(t / 70) % 2 === 0 ? 0.35 : 1);
    this.shadowG.fillStyle(0x000000, 0.3).fillEllipse(p.x + 3, p.y + 7, 28, 14);
    if (p.rollT > 0) { this.ovG.lineStyle(1, 0xffffff, 0.35); this.ovG.strokeCircle(p.x, p.y, 14); }
    // 샷건·레일은 시트의 총구 화염보다 큰 화염을 코드로 덧그린다 (SMG·권총은 시트 프레임의 화염을 그대로 쓴다)
    if (this.muzzleT > 0 && (this.muzzleW === 'shotgun' || this.muzzleW === 'rail')) {
      this.muzzleT--;
      const [tx, ty] = this.tip(p.aim), a = p.aim, mx = p.x + tx, my = p.y + ty, w = this.muzzleW, big = w === 'shotgun' ? 17 : 14;
      const col2 = w === 'rail' ? 0x7dd3fc : 0xffb347, spikes = w === 'shotgun' ? 7 : 4;
      this.ovG.fillStyle(col2, 0.95); this.ovG.beginPath(); this.ovG.moveTo(mx, my);
      for (let k = 0; k <= spikes; k++) { const aa = a + (k / spikes - 0.5) * (w === 'shotgun' ? 1.5 : 1.0), rr = k % 2 === 0 ? big : big * 0.45; this.ovG.lineTo(mx + Math.cos(aa) * rr, my + Math.sin(aa) * rr); }
      this.ovG.closePath(); this.ovG.fillPath(); this.ovG.fillStyle(0xffffff, 0.95); this.ovG.fillCircle(mx, my, big * 0.28);
    } else if (this.muzzleT > 0) this.muzzleT--;
    // 조준선
    const ax = p.x + Math.cos(p.aim) * 38, ay = p.y + Math.sin(p.aim) * 38;
    this.ovG.lineStyle(1, 0xffffff, 0.3); this.ovG.beginPath(); this.ovG.moveTo(p.x + Math.cos(p.aim) * 26, p.y + Math.sin(p.aim) * 26); this.ovG.lineTo(ax + Math.cos(p.aim) * 90, ay + Math.sin(p.aim) * 90); this.ovG.strokePath();
    if (p.rollCd > 0) { this.ovG.lineStyle(2, 0x93c5fd, 0.8); this.ovG.beginPath(); this.ovG.arc(p.x, p.y + 20, 9, -Math.PI / 2, -Math.PI / 2 + (1 - p.rollCd / 66) * Math.PI * 2); this.ovG.strokePath(); }
    if (this.mouse.used && !this.touchMode) { const mx = this.mouse.x, my = this.mouse.y + this.camY; this.ovG.lineStyle(1, 0xffffff, 0.8); this.ovG.strokeCircle(mx, my, 7); this.ovG.beginPath(); this.ovG.moveTo(mx - 11, my); this.ovG.lineTo(mx + 11, my); this.ovG.moveTo(mx, my - 11); this.ovG.lineTo(mx, my + 11); this.ovG.strokePath(); }
  }

  private renderHud(nearW: string): void {
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
    T2.weapon.setText(p.weapon === 'pistol' ? w.name : `${w.name}  ${p.ammo}/${w.ammo}`).setColor(p.weapon === 'pistol' ? '#cbd5e1' : '#fde68a');
    T2.grenade.setText(`수류탄 ×${p.grenades}`);
    T2.combo.setText(g.combo >= 2 ? `${g.combo} COMBO  ×${(1 + 0.2 * Math.min(g.combo - 1, 10)).toFixed(1)}` : '').setAlpha(g.comboT > 0 ? Math.min(1, g.comboT / 30) : 0);
    const b = g.boss;
    if (b && b.aw === 2) { T2.boss.setText('격납고 수문장'); h.fillStyle(0x0f172a, 0.8); h.fillRect(W / 2 - 100, 56, 200, 8); h.fillStyle(0xef4444, 1); h.fillRect(W / 2 - 100, 56, 200 * Math.max(0, b.hp / b.maxHp), 8); h.lineStyle(1, 0xffffff, 0.5); h.strokeRect(W / 2 - 100, 56, 200, 8); } else T2.boss.setText('');
    const touch = this.touchMode || this.sys.game.device.input.touch;
    if (nearW && p.weapon !== 'pistol' && !touch) T2.hint.setText(nearW).setAlpha(1);
    else if (this.tutorialT > 0) T2.hint.setText(touch ? '왼쪽 스틱: 이동 · 오른쪽 스틱: 조준·사격 · 문을 박차고 들어가라' : 'WASD 이동 · 마우스 조준/클릭 사격 · Shift 구르기 · Q 수류탄 · E 줍기 · F 던지기').setAlpha(Math.min(1, this.tutorialT / 30));
    else T2.hint.setAlpha(0);
    // 다음 구역 문 방향 화살표
    if ((g.cleared[sec] && sec < 3) || (sec === 3 && g.exitOpen)) { const gy = (SECTIONS[sec].r0 + 1) * TILE; if (gy < this.camY) { const a = 0.6 + 0.4 * Math.sin(this.time.now * 0.008); h.fillStyle(0xfde68a, a); h.fillTriangle(W / 2, 74, W / 2 - 12, 92, W / 2 + 12, 92); } }
    // 모바일 버튼/스틱
    T2.roll.setText(touch ? '구르기' : ''); T2.gren.setText(touch ? '수류탄' : ''); T2.pick.setText(touch && nearW ? '줍기' : '');
    if (touch) {
      for (const [bx, by, on, show] of [[W - 52, H - 252, p.rollCd <= 0, true], [W - 52, H - 332, p.grenades > 0 && p.grenadeCd <= 0, true], [W - 52, H - 412, true, !!nearW]] as [number, number, boolean, boolean][]) {
        if (!show) continue;
        h.fillStyle(0x0f172a, 0.5); h.fillCircle(bx, by, 30); h.lineStyle(2, on ? 0x7dd3fc : 0x475569, 0.9); h.strokeCircle(bx, by, 30);
      }
      for (const s of [this.moveStick, this.aimStick]) if (s.id >= 0) { h.lineStyle(2, 0xffffff, 0.3); h.strokeCircle(s.ax, s.ay, 52); h.fillStyle(0xffffff, 0.35); h.fillCircle(s.ax + s.vx * 52, s.ay + s.vy * 52, 18); }
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
