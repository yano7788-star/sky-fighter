import Phaser from 'phaser';
import { H, STEP_MS, W } from '../core/config';
import { ARENA, DOOR, GroundSim, ROOM_COUNT, WEAPONS, type GEnemy, type GEvent, type GInput, type GKind } from '../core/ground';
import type { Sim } from '../core/sim';
import { Fx } from '../render/fx';
import { textStyle } from '../render/hud';
import { R } from '../render/textures';
import { audio } from '../systems/audio';

const CUTS = ['cut_shotdown', 'cut_landing', 'cut_takeoff'];
const ENEMY_TEX: Record<GKind, string> = { rifle: 'g_rifle', charger: 'g_charger', sniper: 'g_sniper', turret: 'g_turret', drone: 'g_drone', tank: 'g_tank', boss: 'g_boss' };
const COVER_TEX = { barrier: 'p_barrier', crate: 'p_crate', stack: 'p_stack', crates2: 'p_crates2', barrel: 'p_barrel' } as const;
const SKIN = ['ace', 'sis1', 'sis2'];
const BLOOD: Record<GKind, number> = { rifle: 0x7f1d1d, charger: 0x7f1d1d, sniper: 0x7f1d1d, turret: 0x1f2937, drone: 0x1f2937, tank: 0x1f2937, boss: 0x1f2937 };
const SPARK: Record<GKind, string> = { rifle: '#fca5a5', charger: '#fca5a5', sniper: '#fca5a5', turret: '#fde68a', drone: '#fde68a', tank: '#fde68a', boss: '#fde68a' };
/** 픽셀 아트 표시 배율 (판정은 그대로, 눈에 잘 띄게 키운다). 보스는 원본 크기가 이미 크다 */
const K = { player: 1.3, cover: 1.3, enemy: 1.3, tank: 1.15, boss: 1.0 };
const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];

type Stage = 'INTRO' | 'PLAY' | 'OUTRO' | 'DEAD' | 'END';

/**
 * 지상전 「강하」: 3스테이지 보스 직후 본편(GameScene)을 멈추고 이 씬을 위에 띄운다.
 *  컷(격추) → 줌인+모자이크 → 컷(착지) → 픽셀 아트 트윈스틱 탑다운 → 컷(이륙) → 본편 복귀.
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
  private floor!: Phaser.GameObjects.TileSprite;
  private door!: Phaser.GameObjects.Image;
  private shadowG!: Phaser.GameObjects.Graphics;
  private decalG!: Phaser.GameObjects.Graphics;
  private ovG!: Phaser.GameObjects.Graphics;
  private bulletG!: Phaser.GameObjects.Graphics;
  private hudG!: Phaser.GameObjects.Graphics;
  private playerImg!: Phaser.GameObjects.Image;
  private muzzle!: Phaser.GameObjects.Image;
  private coverImgs = new Map<number, Phaser.GameObjects.Image>();
  private enemyImgs = new Map<number, Phaser.GameObjects.Image>();
  private pickupImgs = new Map<number, Phaser.GameObjects.Image>();
  private cutImg!: Phaser.GameObjects.Image;
  private cover!: Phaser.GameObjects.Container;
  private hudText!: Record<string, Phaser.GameObjects.Text>;
  private banner!: Phaser.GameObjects.Text;
  private bannerT = 0;
  private veil!: Phaser.GameObjects.Rectangle;
  private redFlash!: Phaser.GameObjects.Rectangle;
  private pixel: Phaser.FX.Pixelate | null = null;
  private caps: Phaser.GameObjects.Text[] = [];

  private keys = new Set<string>();
  private mouse = { x: W / 2, y: H / 2, used: false, down: false };
  private moveStick = { id: -1, ax: 0, ay: 0, vx: 0, vy: 0 };
  private aimStick = { id: -1, ax: 0, ay: 0, vx: 0, vy: 0 };
  private rollQ = false;
  private grenQ = false;
  private touchMode = false;
  private acc = 0;
  private hitStop = 0;
  private shake = 0;
  private slowUntil = 0;
  private slowScale = 1;
  private paused = false;
  private quitArmed = false;
  private tutorialT = 0;
  private deadTimer = 0;
  private finished = false;

  constructor() { super('GroundScene'); }

  init(data: { sim: Sim }): void { this.sim = data.sim; this.stage = 'INTRO'; this.finished = false; this.paused = false; this.quitArmed = false; this.keys.clear(); this.coverImgs = new Map(); this.enemyImgs = new Map(); this.pickupImgs = new Map(); this.acc = 0; this.hitStop = 0; this.shake = 0; this.slowUntil = 0; this.slowScale = 1; this.deadTimer = 0; this.bannerT = 0; this.pixel = null; this.caps = []; this.moveStick.id = -1; this.aimStick.id = -1; }

  preload(): void {
    this.load.setPath('assets/img/');
    for (const n of CUTS) if (!this.textures.exists(n)) this.load.image(n, `${n}.webp?v=${__BUILD__}`);
  }

  create(): void {
    const seed = (Math.floor(this.sim.score) * 31 + this.sim.frame) >>> 0;
    this.g = new GroundSim(this.sim.groundOpts(seed));
    this.cameras.main.setBackgroundColor('#000000');
    this.root = this.add.container(0, 0).setScale(R);
    this.world = this.add.container(0, 0);
    this.ui = this.add.container(0, 0);
    this.root.add([this.world, this.ui]);
    this.buildWorld();
    this.buildHud();
    this.fx = new Fx(this, this.world);
    // 컷 이미지 (맨 위, 연출 중에만 보인다)
    this.cutImg = this.add.image(0, 0, 'cut_shotdown').setOrigin(0, 0).setVisible(false);
    this.root.add(this.cutImg);
    this.veil = this.add.rectangle(0, 0, W, H, 0x000000, 1).setOrigin(0, 0);
    this.root.add(this.veil);
    this.redFlash = this.add.rectangle(0, 0, W, H, 0xff2222, 0).setOrigin(0, 0);
    this.root.add(this.redFlash);
    this.bindInput();
    this.world.setVisible(false); this.ui.setVisible(false);
    this.runIntro();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { audio.resume(); });
  }

  // ---------------------------------------------------------------- 월드 구성
  private buildWorld(): void {
    // 바닥: 원본 타일이 이음새 없는 타일이 아니라서 좌우·상하로 뒤집어 붙인 2×2 캔버스 텍스처를 쓴다 (이음새 제거)
    if (!this.textures.exists('g_floor4')) {
      const src = this.textures.get('g_floor').getSourceImage() as HTMLImageElement, w = src.width, h = src.height;
      const cv = this.textures.createCanvas('g_floor4', w * 2, h * 2)!, ctx = cv.getContext();
      ctx.imageSmoothingEnabled = false;
      for (let i = 0; i < 4; i++) { ctx.save(); const fx = i % 2, fy = (i / 2) | 0; ctx.translate(fx ? w * 2 : 0, fy ? h * 2 : 0); ctx.scale(fx ? -1 : 1, fy ? -1 : 1); ctx.drawImage(src, 0, 0); ctx.restore(); }
      cv.refresh(); cv.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    this.floor = this.add.tileSprite(0, 0, W, H, 'g_floor4').setOrigin(0, 0).setTileScale(1.15);
    const wall = (x: number, y: number, w: number, h: number) => this.add.tileSprite(x, y, w, h, 'g_wall').setOrigin(0, 0).setTileScale(0.9).setTint(0x9ca3af);
    this.decalG = this.add.graphics();
    this.shadowG = this.add.graphics();
    this.cover = this.add.container(0, 0);
    this.door = this.add.image(DOOR.x, DOOR.y - 14, 'p_door').setDisplaySize(72, 82);
    this.playerImg = this.add.image(0, 0, `g_${SKIN[this.g.opts.pilot]}_b`);
    this.muzzle = this.add.image(0, 0, 'dot').setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff1a8).setVisible(false);
    this.bulletG = this.add.graphics();
    this.ovG = this.add.graphics();
    this.world.add([this.floor, wall(0, 0, W, ARENA.y0 - 6), wall(0, ARENA.y1 + 6, W, H - ARENA.y1 - 6), wall(0, ARENA.y0 - 6, ARENA.x0 - 4, ARENA.y1 - ARENA.y0 + 12), wall(ARENA.x1 + 4, ARENA.y0 - 6, W - ARENA.x1 - 4, ARENA.y1 - ARENA.y0 + 12),
      this.decalG, this.shadowG, this.door, this.cover, this.playerImg, this.muzzle, this.bulletG, this.ovG]);
  }

  private buildHud(): void {
    this.hudG = this.add.graphics();
    this.ui.add(this.hudG);
    const t = (x: number, y: number, size: number, color: string, ox = 0, oy = 0) => { const o = this.add.text(x, y, '', textStyle(size, color)).setOrigin(ox, oy); o.setShadow(0, 1, '#000', 3, true, true); this.ui.add(o); return o; };
    this.hudText = {
      room: t(W / 2, 12, 13, '#e2e8f0', 0.5, 0), score: t(W - 12, 12, 13, '#fde68a', 1, 0), weapon: t(12, H - 46, 14, '#e2e8f0', 0, 0), grenade: t(12, H - 26, 12, '#cbd5e1', 0, 0),
      combo: t(W / 2, 100, 18, '#fbbf24', 0.5, 0.5), boss: t(W / 2, 40, 12, '#fca5a5', 0.5, 0), hint: t(W / 2, H - 120, 13, '#e2e8f0', 0.5, 0.5), roll: t(W - 52, H - 252, 10, '#94a3b8', 0.5, 0.5), gren: t(W - 52, H - 332, 10, '#94a3b8', 0.5, 0.5),
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
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
      if (this.keys.has(k)) return;
      this.keys.add(k);
      if (k === 'p' || k === 'escape') { this.setPaused(!this.paused); return; }
      if (this.paused) { if (k === 'enter') this.setPaused(false); else if (k === 't') this.pressQuit(); return; }
      if (k === 'shift' || k === ' ') this.rollQ = true;
      if (k === 'q' || k === 'e') this.grenQ = true;
      if (this.stage === 'DEAD' && (k === 'enter' || k === ' ')) this.deadConfirm();
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
      if (x < W / 2 && this.moveStick.id < 0) this.moveStick = { id: p.id, ax: x, ay: y, vx: 0, vy: 0 };
      else if (x >= W / 2 && this.aimStick.id < 0) this.aimStick = { id: p.id, ax: x, ay: y, vx: 0, vy: 0 };
    } else {
      this.mouse.used = true; this.mouse.x = x; this.mouse.y = y;
      if (p.rightButtonDown()) this.rollQ = true; else this.mouse.down = true;
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
    const k = this.keys, g = this.g, p = g.p;
    let mx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    let my = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    let ax = 0, ay = 0, fire = k.has('j') || k.has('z') || k.has('control');
    if (this.moveStick.id >= 0) { mx += this.moveStick.vx; my += this.moveStick.vy; }
    if (this.aimStick.id >= 0) { const m = Math.hypot(this.aimStick.vx, this.aimStick.vy); if (m > 0.22) { ax = this.aimStick.vx; ay = this.aimStick.vy; fire = true; } }
    else if (this.mouse.used && !this.touchMode) { ax = this.mouse.x - p.x; ay = this.mouse.y - p.y; if (Math.hypot(ax, ay) < 12) { ax = 0; ay = 0; } if (this.mouse.down) fire = true; }
    const inp: GInput = { mx, my, ax, ay, fire, roll: this.rollQ, grenade: this.grenQ };
    this.rollQ = false; this.grenQ = false;
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
    this.cutImg.setTexture(key).setVisible(true).setDisplaySize(W, H).setPosition(0, 0).setAlpha(1).setScale(W / this.cutImg.width, H / this.cutImg.height);
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
      this.caption('강하 — 적 기지 침투', 22);
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
      this.stage = 'PLAY'; this.tutorialT = 60 * 9; this.say('ROOM 1');
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
    if (this.finished) return; this.finished = true; this.stage = 'END';
    this.clearPixel(); this.cameras.main.setZoom(1);
    const r = this.g.result();
    if (win) this.sim.finishGround({ score: r.score, rooms: r.rooms }); else this.sim.groundFail();
    audio.resume();
    this.scene.stop();
    this.scene.resume('GameScene');
  }

  private deadConfirm(): void {
    if (this.deadTimer > 0) return;
    if (this.sim.useGroundLife()) {
      this.g.revive(); this.stage = 'PLAY'; this.coverImgs.forEach(i => i.destroy()); this.coverImgs.clear(); this.enemyImgs.forEach(i => i.destroy()); this.enemyImgs.clear(); this.pickupImgs.forEach(i => i.destroy()); this.pickupImgs.clear();
      this.redFlash.setAlpha(0); this.say('RETRY', 30);
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
    if (this.stage === 'DEAD') { if (this.deadTimer > 0) this.deadTimer--; }
    this.render();
  }

  private tick(): void {
    const g = this.g;
    const inp = this.buildInput();
    g.step(inp);
    this.fx.tick();
    if (this.tutorialT > 0) this.tutorialT--;
    for (const e of g.drain()) this.handle(e);
    if (this.shake > 0.1) this.shake *= 0.82; else this.shake = 0;
  }

  private handle(e: GEvent): void {
    const fx = this.fx, g = this.g;
    switch (e.t) {
      case 'shot': audio.sfx(e.weapon === 'pistol' ? 'gPistol' : e.weapon === 'shotgun' ? 'gShotgun' : e.weapon === 'smg' ? 'gSmg' : 'gRail'); this.shake = Math.max(this.shake, WEAPONS[e.weapon].kick); this.muzzleT = 3; break;
      case 'hit': audio.sfx('gHit'); fx.sparkBurst(e.x, e.y, e.kind === 'rifle' || e.kind === 'charger' || e.kind === 'sniper' ? '#fecaca' : '#fde68a', 4); if (!e.kill) fx.pop(e.x, e.y - 10, String(Math.max(1, Math.round(e.dmg * 10))), '#ffffff', 11); break;
      case 'kill': audio.sfx('gKill'); fx.explosion(e.x, e.y, SPARK[e.kind], e.kind === 'tank' || e.kind === 'boss' ? 30 : 10); this.splat(e.x, e.y, e.kind); fx.pop(e.x, e.y - 18, `+${e.pts}`, '#fde68a', 13); if (e.combo >= 3) fx.pop(e.x, e.y - 34, `${e.combo} COMBO`, '#fbbf24', 12); break;
      case 'boom': audio.sfx('boom'); fx.explosion(e.x, e.y, '#fb923c', Math.min(30, 10 + Math.round(e.r / 5))); fx.ring(e.x, e.y, '#fde68a', e.r); this.scorch(e.x, e.y, e.r); break;
      case 'hurt': audio.sfx('gHurt'); this.redFlash.setAlpha(0.35); this.tweens.add({ targets: this.redFlash, alpha: 0, duration: 300 }); this.shake = Math.max(this.shake, 8); try { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(50); } catch { /* 미지원 */ } break;
      case 'roll': audio.sfx('gRoll'); fx.ring(e.x, e.y + 6, '#cbd5e1', 22); break;
      case 'style': audio.sfx('gStyle'); fx.pop(e.x, e.y - 30, 'STYLE!', '#67e8f9', 18); fx.ring(e.x, e.y, '#67e8f9', 50); break;
      case 'pickup': audio.sfx(e.what === 'heart' ? 'heal' : 'item'); fx.ring(e.x, e.y, e.what === 'heart' ? '#f87171' : '#fde68a', 40); fx.pop(e.x, e.y - 20, e.what === 'heart' ? '+♥' : e.what === 'weapon' ? 'NEW WEAPON' : 'AMMO', '#ffffff', 12); break;
      case 'throw': audio.sfx('gThrow'); fx.pop(g.p.x, g.p.y - 26, 'THROW!', '#fde68a', 14); break;
      case 'door': audio.sfx('item'); this.door.setTexture('p_dooropen'); this.say('CLEAR!', 30); break;
      case 'room': this.door.setTexture('p_door'); this.clearDecals(); if (e.n > 0) this.say(e.boss ? 'BOSS' : `ROOM ${e.n + 1}`); else if (e.boss) this.say('BOSS'); break;
      case 'shake': this.shake = Math.max(this.shake, e.v); break;
      case 'hitstop': this.hitStop = Math.max(this.hitStop, e.frames); break;
      case 'slowmo': this.slowUntil = this.time.now + e.ms; this.slowScale = e.scale; break;
      case 'bossPhase': this.say(`PHASE ${e.phase}`, 30); audio.sfx('enrage'); break;
      case 'coverBreak': fx.explosion(e.x, e.y, '#f97316', 14); break;
      case 'win': this.say('MISSION CLEAR', 30); audio.sfx('item'); this.runOutro(); break;
      case 'dead': this.stage = 'DEAD'; this.deadTimer = 40; audio.sfx('enrage'); break;
      case 'cleared': break;
    }
  }
  private muzzleT = 0;

  private splat(x: number, y: number, kind: GKind): void {
    const g = this.decalG, c = BLOOD[kind], n = kind === 'boss' || kind === 'tank' ? 10 : 5;
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, d = Math.random() * (n > 5 ? 26 : 11), s = 2 + Math.random() * 4; g.fillStyle(c, 0.55); g.fillRect(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d), s, s); }
  }
  private scorch(x: number, y: number, r: number): void {
    const g = this.decalG; g.fillStyle(0x0b0f14, 0.45); g.fillCircle(Math.round(x), Math.round(y), Math.min(r * 0.45, 26));
  }
  private clearDecals(): void { this.decalG.clear(); }

  // ---------------------------------------------------------------- 렌더
  private spriteOf(e: GEnemy): number {
    switch (e.kind) {
      case 'rifle': case 'charger': return e.ang - Math.PI / 2;
      case 'sniper': return e.ang;
      case 'turret': return e.ang;
      default: return 0;
    }
  }

  private render(): void {
    const g = this.g, t = this.time.now;
    if (this.stage === 'INTRO' || this.stage === 'END') return;
    // 화면 흔들림
    const sh = this.shake; this.world.setPosition(sh ? (Math.random() - 0.5) * sh : 0, sh ? (Math.random() - 0.5) * sh : 0);
    this.fx.render();
    this.shadowG.clear(); this.ovG.clear(); this.bulletG.clear();
    const px = (v: number) => Math.round(v);
    // 엄폐물
    for (const c of g.cover) {
      let img = this.coverImgs.get(c.id);
      if (!img) { img = this.add.image(c.x, c.y, COVER_TEX[c.kind]); img.setOrigin(0.5, 0.5); this.cover.add(img); this.coverImgs.set(c.id, img); }
      img.setVisible(!c.dead).setPosition(c.x, c.y + (c.kind === 'barrel' ? -2 : 0)).setScale(K.cover);
      if (!c.dead) this.shadowG.fillStyle(0x000000, 0.28).fillEllipse(c.x + 3, c.y + c.h / 2 + 1, c.w * 0.9, 8);
    }
    // 문
    this.door.setVisible(true);
    if (g.doorOpen) { this.ovG.fillStyle(0xfde68a, 0.1 + 0.08 * Math.sin(t * 0.006)); this.ovG.fillRect(DOOR.x - 30, DOOR.y - 6, 60, 70); this.hudText.hint.setText('▲ 문으로 이동'); }
    // 픽업
    const livePk = new Set<number>();
    for (const k of g.pickups) {
      livePk.add(k.id);
      let img = this.pickupImgs.get(k.id);
      if (!img) { img = this.add.image(k.x, k.y, k.kind === 'weapon' ? 'p_weapon' : 'p_pad'); this.world.add(img); this.pickupImgs.set(k.id, img); }
      img.setPosition(px(k.x), px(k.y + Math.sin(k.t * 0.08) * 2)).setTint(k.kind === 'heart' ? 0xff8a8a : 0xffffff);
      this.ovG.lineStyle(1, k.kind === 'heart' ? 0xf87171 : 0xfde68a, 0.55 + 0.3 * Math.sin(k.t * 0.1)); this.ovG.strokeCircle(k.x, k.y, 22 + Math.sin(k.t * 0.1) * 2);
      if (k.kind === 'weapon') { this.ovG.fillStyle(0xffffff, 1); }
      this.hudText.weapon.setAlpha(1);
    }
    for (const [id, img] of this.pickupImgs) if (!livePk.has(id)) { img.destroy(); this.pickupImgs.delete(id); }
    // 적
    const live = new Set<number>();
    for (const e of g.enemies) {
      live.add(e.id);
      let img = this.enemyImgs.get(e.id);
      if (!img) { img = this.add.image(e.x, e.y, ENEMY_TEX[e.kind]); this.world.add(img); this.enemyImgs.set(e.id, img); }
      const bob = e.kind === 'drone' ? Math.sin(t * 0.012 + e.id) * 2 : 0;
      const ks = e.kind === 'boss' ? K.boss : e.kind === 'tank' ? K.tank : K.enemy;
      img.setPosition(px(e.x), px(e.y + bob)).setRotation(this.spriteOf(e));
      if (e.kind === 'tank') img.setFlipX(false);
      img.setAlpha(e.state === 'SPAWN' ? 0.25 + 0.5 * (1 - e.t / 40) : 1);
      if (e.flash > 0) img.setTintFill(0xffffff); else if (e.state === 'STUN') img.setTint(0xffcc66); else img.clearTint();
      img.setScale(ks * (e.state === 'SPAWN' ? 0.6 + 0.4 * (1 - e.t / 40) : 1));
      this.shadowG.fillStyle(0x000000, 0.3).fillEllipse(e.x + 2, e.y + e.r * 0.8, e.r * 1.7, e.r * 0.7);
      // 예고선·표식
      if (e.state === 'WIND') {
        const a = Math.atan2(e.ly - e.y, e.lx - e.x), len = e.kind === 'sniper' ? 900 : e.kind === 'boss' ? 900 : 360, k = e.kind === 'sniper' ? 1 - e.t / 75 : 1 - e.t / 55;
        this.ovG.lineStyle(e.kind === 'sniper' ? 1 + k * 2 : 4, 0xff3b3b, 0.35 + 0.5 * k);
        this.ovG.beginPath(); this.ovG.moveTo(e.x, e.y); this.ovG.lineTo(e.x + Math.cos(a) * len, e.y + Math.sin(a) * len); this.ovG.strokePath();
        if (e.kind !== 'sniper') { this.ovG.fillStyle(0xff3b3b, 0.18 * k); this.ovG.fillCircle(e.lx, e.ly, 18); }
      }
      if (e.state === 'SPAWN') { this.ovG.lineStyle(2, 0xff6b6b, 0.6); this.ovG.strokeCircle(e.x, e.y, e.r + 4 + (e.t % 10)); }
    }
    for (const [id, img] of this.enemyImgs) if (!live.has(id)) { img.destroy(); this.enemyImgs.delete(id); }
    // 폭발 예고 구역
    for (const z of g.zones) {
      const k = 1 - z.t / z.max;
      this.ovG.fillStyle(0xff3b3b, 0.12 + 0.2 * k); this.ovG.fillCircle(z.x, z.y, z.r);
      this.ovG.lineStyle(2, 0xff6b6b, 0.8); this.ovG.strokeCircle(z.x, z.y, z.r); this.ovG.strokeCircle(z.x, z.y, z.r * k);
    }
    // 수류탄
    for (const gr of g.grenadeList) { const arc = Math.sin((gr.t / gr.max) * Math.PI) * 26; this.shadowG.fillStyle(0, 0.3).fillEllipse(gr.x, gr.y, 8, 4); this.bulletG.fillStyle(0x65a30d, 1).fillCircle(px(gr.x), px(gr.y - arc), 4); this.ovG.lineStyle(1, 0xfde68a, 0.4); this.ovG.strokeCircle(gr.tx, gr.ty, 58); }
    // 플레이어
    this.renderPlayer(t);
    // 탄 (픽셀 사각형)
    for (const b of g.bullets) {
      const x = px(b.x), y = px(b.y);
      if (b.friendly) {
        if (b.kind === 'throw') { this.bulletG.fillStyle(0xcbd5e1, 1).fillRect(x - 6, y - 2, 12, 4); continue; }
        this.bulletG.fillStyle(0xfff1a8, 1).fillRect(x - 2, y - 2, 4, 4); this.bulletG.fillStyle(0xffffff, 1).fillRect(x - 1, y - 1, 2, 2);
        if (b.r > 4) { this.bulletG.fillStyle(0x7dd3fc, 0.8).fillRect(x - 3, y - 3, 6, 6); }
      } else if (b.kind === 'sniper') {
        this.bulletG.fillStyle(0xff3b3b, 1).fillRect(x - 3, y - 3, 6, 6); this.bulletG.fillStyle(0xffffff, 1).fillRect(x - 1, y - 1, 2, 2);
      } else {
        const s = Math.max(3, Math.round(b.r)); this.bulletG.fillStyle(0xff5a3c, 1).fillRect(x - s, y - s, s * 2, s * 2); this.bulletG.fillStyle(0xffe1d0, 1).fillRect(x - 1, y - 1, 2, 2);
      }
    }
    this.renderHud();
  }

  private renderPlayer(t: number): void {
    const g = this.g, p = g.p, img = this.playerImg;
    const base = `g_${SKIN[g.opts.pilot]}`;
    img.setTexture(`${base}_${p.face === 'up' ? 'b' : 'f'}`);
    const moving = p.walk > 0 ? Math.sin(p.walk) : 0;
    const dir = Math.cos(p.aim) >= 0 ? 1 : -1;
    img.setFlipX(dir > 0);   // 원본 스프라이트는 총이 왼쪽에 있다
    let rot = 0, sx = 1, sy = 1;
    if (p.rollT > 0) { const k = 1 - p.rollT / 18; rot = k * Math.PI * 2 * (p.rdx >= 0 ? 1 : -1); sx = sy = 0.88; }
    else { rot = moving * 0.05; sy = 1 + Math.abs(moving) * 0.03; }
    sx *= K.player; sy *= K.player;
    const recoil = p.kick * 0.5;
    img.setPosition(Math.round(p.x - Math.cos(p.aim) * recoil), Math.round(p.y + (p.rollT > 0 ? 0 : -Math.abs(moving) * 1.2) - Math.sin(p.aim) * recoil)).setRotation(rot).setScale(sx, sy);
    img.setAlpha(p.invuln > 0 && p.rollT <= 0 && Math.floor(t / 70) % 2 === 0 ? 0.35 : 1);
    this.shadowG.fillStyle(0x000000, 0.32).fillEllipse(p.x + 2, p.y + 14, 22, 8);
    if (p.rollT > 0) { this.ovG.lineStyle(1, 0xffffff, 0.35); this.ovG.strokeCircle(p.x, p.y, 14); }
    // 조준선 (구르기 쿨다운이 차오르는 호로도 쓴다)
    const m = this.muzzle;
    if (this.muzzleT > 0) { this.muzzleT--; m.setVisible(true).setPosition(p.x + Math.cos(p.aim) * 22, p.y + Math.sin(p.aim) * 22).setScale(0.55 + Math.random() * 0.3).setAlpha(0.9); } else m.setVisible(false);
    const ax = p.x + Math.cos(p.aim) * 38, ay = p.y + Math.sin(p.aim) * 38;
    this.ovG.lineStyle(1, 0xffffff, 0.35); this.ovG.beginPath(); this.ovG.moveTo(p.x + Math.cos(p.aim) * 26, p.y + Math.sin(p.aim) * 26); this.ovG.lineTo(ax + Math.cos(p.aim) * 90, ay + Math.sin(p.aim) * 90); this.ovG.strokePath();
    if (p.rollCd > 0) { this.ovG.lineStyle(2, 0x93c5fd, 0.8); this.ovG.beginPath(); this.ovG.arc(p.x, p.y + 20, 9, -Math.PI / 2, -Math.PI / 2 + (1 - p.rollCd / 66) * Math.PI * 2); this.ovG.strokePath(); }
    if (this.mouse.used && !this.touchMode) { this.ovG.lineStyle(1, 0xffffff, 0.8); this.ovG.strokeCircle(this.mouse.x, this.mouse.y, 7); this.ovG.beginPath(); this.ovG.moveTo(this.mouse.x - 11, this.mouse.y); this.ovG.lineTo(this.mouse.x + 11, this.mouse.y); this.ovG.moveTo(this.mouse.x, this.mouse.y - 11); this.ovG.lineTo(this.mouse.x, this.mouse.y + 11); this.ovG.strokePath(); }
  }

  private renderHud(): void {
    const g = this.g, p = g.p, h = this.hudG, T = this.hudText;
    h.clear();
    // 체력 하트
    for (let i = 0; i < p.maxHp; i++) {
      const full = p.hp >= i + 1, half = !full && p.hp > i, x0 = 12 + i * 18, y0 = 34;
      HEART.forEach((row, ry) => { for (let rx = 0; rx < 7; rx++) if (row[rx] === 'X') { h.fillStyle(full || (half && rx < 4) ? 0xef4444 : 0x3b0d12, 1); h.fillRect(x0 + rx * 2, y0 + ry * 2, 2, 2); } });
    }
    T.room.setText(`ROOM ${Math.min(g.room + 1, ROOM_COUNT)}/${ROOM_COUNT}${g.isBossRoom ? '  BOSS' : ''}`);
    T.score.setText(String(Math.round(g.score)));
    const w = WEAPONS[p.weapon];
    T.weapon.setText(p.weapon === 'pistol' ? w.name : `${w.name}  ${p.ammo}/${w.ammo}`).setColor(p.weapon === 'pistol' ? '#cbd5e1' : '#fde68a');
    T.grenade.setText(`수류탄 ×${p.grenades}`);
    T.combo.setText(g.combo >= 2 ? `${g.combo} COMBO  ×${(1 + 0.2 * Math.min(g.combo - 1, 10)).toFixed(1)}` : '').setAlpha(g.comboT > 0 ? Math.min(1, g.comboT / 30) : 0);
    const b = g.boss;
    if (b) { T.boss.setText('격납고 수문장'); h.fillStyle(0x0f172a, 0.8); h.fillRect(W / 2 - 100, 56, 200, 8); h.fillStyle(0xef4444, 1); h.fillRect(W / 2 - 100, 56, 200 * Math.max(0, b.hp / b.maxHp), 8); h.lineStyle(1, 0xffffff, 0.5); h.strokeRect(W / 2 - 100, 56, 200, 8); } else T.boss.setText('');
    if (!g.doorOpen) T.hint.setText(this.tutorialT > 0 ? this.touchMode ? '왼쪽 스틱: 이동 · 오른쪽 스틱: 조준·사격' : 'WASD 이동 · 마우스 조준/클릭 사격 · Shift 구르기 · Q 수류탄' : '').setAlpha(this.tutorialT > 0 ? Math.min(1, this.tutorialT / 30) : 0);
    else T.hint.setAlpha(0.7 + 0.3 * Math.sin(this.time.now * 0.008));
    // 모바일 버튼/스틱
    const touch = this.touchMode || this.sys.game.device.input.touch;
    T.roll.setText(touch ? '구르기' : ''); T.gren.setText(touch ? '수류탄' : '');
    if (touch) {
      for (const [bx, by, on] of [[W - 52, H - 252, p.rollCd <= 0], [W - 52, H - 332, p.grenades > 0 && p.grenadeCd <= 0]] as [number, number, boolean][]) {
        h.fillStyle(0x0f172a, 0.5); h.fillCircle(bx, by, 30); h.lineStyle(2, on ? 0x7dd3fc : 0x475569, 0.9); h.strokeCircle(bx, by, 30);
      }
      for (const s of [this.moveStick, this.aimStick]) if (s.id >= 0) { h.lineStyle(2, 0xffffff, 0.3); h.strokeCircle(s.ax, s.ay, 52); h.fillStyle(0xffffff, 0.35); h.fillCircle(s.ax + s.vx * 52, s.ay + s.vy * 52, 18); }
    }
    if (this.bannerT > 0) { this.bannerT--; if (this.bannerT < 30) this.banner.setAlpha(this.bannerT / 30); }
    // 일시정지/사망 오버레이
    if (this.paused) { h.fillStyle(0x000000, 0.6); h.fillRect(0, 0, W, H); }
    if (this.stage === 'DEAD') { h.fillStyle(0x000000, 0.6); h.fillRect(0, 0, W, H); }
    this.overlayText();
  }

  private ovT?: Phaser.GameObjects.Text;
  private overlayText(): void {
    if (!this.ovT) { this.ovT = this.add.text(W / 2, H / 2, '', { ...textStyle(20, '#ffffff'), align: 'center', lineSpacing: 10 }).setOrigin(0.5); this.ui.add(this.ovT); }
    if (this.paused) this.ovT.setText(`일시정지\n\n탭 / Enter: 계속\nT 두 번: 포기하고 본편으로${this.quitArmed ? '\n\n한 번 더 T → 포기 확인' : ''}`).setVisible(true);
    else if (this.stage === 'DEAD') this.ovT.setText(this.sim.lives > 0 ? `격추당했다…\n\n목숨 −1 · 이 룸에서 다시 도전\n(탭 / Enter)` : `격추당했다…\n\n더 이상 목숨이 없다\n(탭 / Enter)`).setVisible(true);
    else this.ovT.setVisible(false);
  }
}
