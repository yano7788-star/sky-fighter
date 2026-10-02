import Phaser from 'phaser';
import { H, PLAYER, STEP_MS, W } from '../core/config';
import { Sim } from '../core/sim';
import type { SimEvent } from '../core/types';
import { ScrollingBackground } from '../render/background';
import { Fx } from '../render/fx';
import { Hud, UI, inZone, isUiZone } from '../render/hud';
import { R, S, bulletTexture } from '../render/textures';
import { audio, type BgmName } from '../systems/audio';
import { loadBest, saveBest, type BestRecord } from '../systems/storage';

const MOVE_KEYS = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's', ' '];
const PREVENT_KEYS = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '];

export class GameScene extends Phaser.Scene {
  private sim!: Sim;
  private hud!: Hud;
  private bg!: ScrollingBackground;
  private fx!: Fx;
  private world!: Phaser.GameObjects.Container;
  private ui!: Phaser.GameObjects.Container;

  private layers: Record<string, Phaser.GameObjects.Container> = {};
  private pools: Record<string, Phaser.GameObjects.Image[]> = { items: [], enemies: [], pbullets: [], missiles: [], ebullets: [] };
  private playerImg!: Phaser.GameObjects.Image;
  private muzzleImgs: Phaser.GameObjects.Image[] = [];
  private bossImg!: Phaser.GameObjects.Image;
  private bossG!: Phaser.GameObjects.Graphics;
  private midG!: Phaser.GameObjects.Graphics;
  private midImg!: Phaser.GameObjects.Image;
  private auraG!: Phaser.GameObjects.Graphics;

  private paused = false;
  private acc = 0;
  private hitStop = 0;
  private shake = 0;
  private muzzle = 0;
  private resultTimer = 0;
  private resultKind: 'GAMEOVER' | 'GAMECLEAR' | null = null;
  private best: BestRecord = loadBest();
  private newRecord = false;

  // 입력 상태
  private activeId: number | null = null;
  private firing = false;
  private fireGrace = 0;
  private targetX = W / 2;
  private targetY = PLAYER.spawnY;
  private keys = new Set<string>();
  private bombQueued = false;
  private padFire = false;
  private padX = 0;
  private padY = 0;
  private padPrev: Record<string, boolean> = {};

  constructor() { super('GameScene'); }

  create(): void {
    // Phaser는 같은 씬 인스턴스를 재사용하므로, 이전 실행에서 파괴된 오브젝트 참조를 반드시 버린다
    this.pools = { items: [], enemies: [], pbullets: [], missiles: [], ebullets: [] };
    this.muzzleImgs = []; this.layers = {}; this.resultTimer = 0;
    this.world = this.add.container(0, 0).setScale(R);
    this.ui = this.add.container(0, 0).setScale(R);
    for (const name of ['bg', 'items', 'enemies', 'boss', 'player', 'pbullets', 'missiles', 'ebullets', 'fx']) {
      this.layers[name] = this.add.container(0, 0);
      this.world.add(this.layers[name]);
    }

    this.newSim();
    this.bg = new ScrollingBackground(this, this.layers.bg, this.sim.rng);
    this.fx = new Fx(this, this.layers.fx);
    this.hud = new Hud(this, this.ui);

    // 플레이어 / 총구 섬광 / 보스
    this.playerImg = this.add.image(0, 0, 'player');
    const aspect = this.playerImg.height / this.playerImg.width;
    this.playerImg.setDisplaySize(100, 100 * aspect);
    this.layers.player.add(this.playerImg);
    for (let i = 0; i < 2; i++) {
      const m = this.add.image(0, 0, 'dot').setScale(S * 10 / 8).setTint(0xfef9c3).setVisible(false);
      m.setBlendMode(Phaser.BlendModes.ADD);
      this.layers.player.add(m); this.muzzleImgs.push(m);
    }
    this.bossG = this.add.graphics();
    this.bossImg = this.add.image(0, 0, 'boss1_n').setVisible(false);
    this.midG = this.add.graphics();
    this.midImg = this.add.image(0, 0, 'boss2_n').setVisible(false);
    this.auraG = this.add.graphics();
    this.layers.boss.add([this.bossG, this.bossImg, this.midImg, this.midG]);
    this.layers.player.add(this.auraG);

    this.setupInput();
    this.resetRun();
  }

  // ------------------------------------------------------------------ 초기화 / 재시작
  private newSim(): void { this.sim = new Sim((Math.random() * 0xffffffff) >>> 0); }

  private resetRun(): void {
    this.newSim();
    this.acc = 0; this.hitStop = 0; this.shake = 0; this.muzzle = 0; this.paused = false;
    this.resultKind = null; this.newRecord = false;
    this.targetX = W / 2; this.targetY = PLAYER.spawnY;
    this.activeId = null; this.firing = false; this.fireGrace = 0; this.bombQueued = false; this.keys.clear();
    this.bg.reset(); this.fx.clear(); this.hud.resetState(this.sim);
    this.hud.showResult(null); this.hud.setPaused(false);
    audio.rewind(); audio.resume();
  }

  // ------------------------------------------------------------------ 입력
  private setupInput(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.pressAt(p.id, p.x / R, p.y / R));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => { if (p.isDown) this.moveAt(p.id, p.x / R, p.y / R); });
    const up = (p: Phaser.Input.Pointer) => this.releaseAt(p.id);
    this.input.on('pointerup', up); this.input.on('pointerupoutside', up);

    const kb = this.input.keyboard!;
    kb.addCapture(PREVENT_KEYS.map(k => (k === ' ' ? 'SPACE' : k.replace('arrow', '').toUpperCase())));
    kb.on('keydown', (e: KeyboardEvent) => this.onKeyDown(e));
    kb.on('keyup', (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase()));

    const onHidden = () => { this.persistBestInRun(); this.setPaused(true); };
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHidden);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.game.events.off(Phaser.Core.Events.HIDDEN, onHidden); audio.resume(); });
    const onBlur = () => this.keys.clear();
    const onPageHide = () => this.persistBestInRun();
    window.addEventListener('blur', onBlur); window.addEventListener('pagehide', onPageHide);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { window.removeEventListener('blur', onBlur); window.removeEventListener('pagehide', onPageHide); });
  }

  private onKeyDown(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    audio.unlock();
    if (e.repeat) { if (!this.paused && !this.resultKind && MOVE_KEYS.includes(k)) this.keys.add(k); return; }
    if (k === 'p' || k === 'escape') { this.setPaused(!this.paused); return; }
    if (this.paused) { if (k === 'enter' || k === ' ') this.setPaused(false); return; }
    if (k === 'm') { audio.toggleMute(); return; }
    if (this.resultKind) { if (k === 'enter' || k === ' ') this.resultTap(); return; }
    if (k === 'b' || k === 'x' || k === 'shift') { this.bombQueued = true; return; }
    this.keys.add(k);
  }

  private pressAt(id: number, x: number, y: number): void {
    audio.unlock();
    if (this.paused) { this.setPaused(false); return; }
    if (this.resultKind) { this.resultTap(); return; }
    if (inZone(UI.sound, x, y)) { audio.toggleMute(); return; }
    if (inZone(UI.pause, x, y)) { this.setPaused(true); return; }
    if (inZone(UI.bomb, x, y)) { this.bombQueued = true; return; }
    if (this.activeId !== null) return;         // 이미 다른 손가락이 조작 중이면 무시 (보조 손가락은 버튼 전용)
    this.activeId = id; this.firing = true; this.fireGrace = 10;
    this.targetX = x; this.targetY = y - 50;
  }
  private moveAt(id: number, x: number, y: number): void {
    if (this.paused || this.resultKind || id !== this.activeId || isUiZone(x, y)) return;
    this.targetX = x; this.targetY = y - 50;
  }
  private releaseAt(id: number): void { if (id === this.activeId) { this.activeId = null; this.firing = false; } }

  private resultTap(): void {
    if (this.resultTimer > 0) return;
    if (this.resultKind === 'GAMEOVER') this.resetRun();
    else this.scene.start('TitleScene');
  }

  private setPaused(v: boolean): void {
    if (v === this.paused || (v && (this.resultKind || !this.sim))) return;
    this.paused = v; this.acc = 0;
    this.activeId = null; this.firing = false; this.keys.clear();
    this.hud.setPaused(v);
    if (v) audio.suspend(); else audio.resume();
  }

  private pollGamepad(): void {
    const pad = this.input.gamepad?.getPad(0);
    if (!pad || !pad.connected) { this.padX = this.padY = 0; this.padFire = false; return; }
    const dz = (v: number) => (Math.abs(v) < 0.25 ? 0 : v);
    const btn = (i: number) => !!pad.buttons[i]?.pressed;
    const edge = (name: string, down: boolean) => { const was = this.padPrev[name]; this.padPrev[name] = down; return down && !was; };
    this.padX = dz(pad.axes[0]?.getValue() ?? 0) + (btn(15) ? 1 : 0) - (btn(14) ? 1 : 0);
    this.padY = dz(pad.axes[1]?.getValue() ?? 0) + (btn(13) ? 1 : 0) - (btn(12) ? 1 : 0);
    this.padFire = btn(0) || btn(5) || btn(7);
    if (edge('start', btn(9))) { audio.unlock(); if (this.paused) this.setPaused(false); else if (this.resultKind) this.resultTap(); else this.setPaused(true); }
    if (edge('a', btn(0))) { if (this.paused) this.setPaused(false); else if (this.resultKind) this.resultTap(); }
    if (edge('bomb', btn(1) || btn(2)) && !this.paused && !this.resultKind) this.bombQueued = true;
  }

  // ------------------------------------------------------------------ 메인 루프 (고정 60Hz 틱 + 매 프레임 렌더)
  update(_time: number, delta: number): void {
    this.pollGamepad();
    if (!this.paused) {
      let dt = delta;
      if (Math.abs(dt - STEP_MS) < 2) dt = STEP_MS;       // 60Hz 지터 보정
      this.acc += Math.min(dt, 100);                      // 탭 복귀 등 긴 지연은 잘라서 순간이동 방지
      let n = 0;
      while (this.acc >= STEP_MS - 0.5 && n < 3) { this.tick(); this.acc -= STEP_MS; n++; }
      if (n >= 3) this.acc = 0;
    }
    this.render();
  }

  private wantedBgm(): BgmName | null {
    const s = this.sim;
    if (this.paused || this.resultKind || s.state !== 'PLAYING') return null;
    return s.boss || s.stagePhase === 'WARNING' ? 'boss' : 'normal';
  }

  private tick(): void {
    audio.updateMusic(this.wantedBgm());
    if (this.hitStop > 0) {                                // 히트스톱: 타격 순간 잠깐 멈춤
      this.hitStop--;
      if (this.bombQueued) { this.bombQueued = false; this.sim.fireBomb(); for (const e of this.sim.drainEvents()) this.handleEvent(e); }   // 폭탄은 지연 없이
      return;
    }
    const s = this.sim;
    this.hud.tick(s); this.fx.tick(); this.bg.tick();
    if (this.shake > 0.3) this.shake *= 0.88; else this.shake = 0;
    if (this.muzzle > 0) this.muzzle--;
    if (this.resultTimer > 0) this.resultTimer--;
    if (this.resultKind) { this.hud.showResult(this.resultInfo(), this.resultTimer <= 0); return; }

    this.pollKeyboardMove();
    const wantFire = this.firing || this.fireGrace > 0 || this.keys.has(' ') || this.padFire;
    if (this.fireGrace > 0) this.fireGrace--;
    s.step({ targetX: this.targetX, targetY: this.targetY, fire: wantFire, bomb: this.bombQueued });
    this.bombQueued = false;

    for (const e of s.drainEvents()) this.handleEvent(e);
    if (s.frame % 2 === 0) for (const m of s.missiles) this.fx.trail(m.x, m.y, '#ec4899');
    if (s.stagePhase === 'INTRO') this.bg.setTier(s.bossTier);
  }

  private pollKeyboardMove(): void {
    const k = this.keys;
    let dx = (k.has('arrowright') || k.has('d') ? 1 : 0) - (k.has('arrowleft') || k.has('a') ? 1 : 0) + this.padX;
    let dy = (k.has('arrowdown') || k.has('s') ? 1 : 0) - (k.has('arrowup') || k.has('w') ? 1 : 0) + this.padY;
    if (!dx && !dy) return;
    const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    const sp = 9;
    this.targetX = Math.max(PLAYER.minX, Math.min(PLAYER.maxX, this.targetX + dx * sp));
    this.targetY = Math.max(PLAYER.minY, Math.min(PLAYER.maxY, this.targetY + dy * sp));
  }

  private handleEvent(e: SimEvent): void {
    switch (e.t) {
      case 'sfx': audio.sfx(e.name); break;
      case 'explosion': this.fx.explosion(e.x, e.y, e.color, e.count); break;
      case 'ring': this.fx.ring(e.x, e.y, e.color, e.max); break;
      case 'shake': this.shake = Math.max(this.shake, e.v); break;
      case 'hitstop': this.hitStop = Math.max(this.hitStop, e.frames); break;
      case 'flash': this.hud.flash(e.kind, e.v); break;
      case 'vibrate': try { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(e.pattern); } catch { /* 미지원 */ } break;   // 사용자 입력 전에는 브라우저가 차단
      case 'muzzle': this.muzzle = 3; break;
      case 'graze': this.fx.explosion(e.x, e.y, '#e0f2fe', 2); break;
      case 'combo': break;   // HUD가 sim.combo를 직접 읽는다
      case 'hitspark': if (this.sim.frame % 3 === 0) this.fx.ring(e.x, e.y, '#fde047', 16); break;
      case 'gameover': case 'gameclear': this.finishRun(e.t === 'gameover' ? 'GAMEOVER' : 'GAMECLEAR'); break;
    }
  }

  // ------------------------------------------------------------------ 결과 / 기록
  private finishRun(kind: 'GAMEOVER' | 'GAMECLEAR'): void {
    const s = this.sim;
    this.newRecord = s.score > this.best.score;
    this.best = { score: Math.max(this.best.score, s.score), stage: Math.max(this.best.stage, s.bossTier) };
    saveBest(this.best);
    this.resultKind = kind; this.resultTimer = 90;
    this.activeId = null; this.firing = false;
    this.hud.showResult(this.resultInfo(), false);
  }
  private resultInfo() {
    return { kind: this.resultKind!, score: this.sim.score, stage: this.sim.bossTier, best: this.best, newRecord: this.newRecord };
  }
  /** 플레이 도중 탭을 닫아도 신기록이 사라지지 않게 저장 (메모리의 best는 건드리지 않아 NEW RECORD 판정 유지) */
  persistBestInRun(): void {
    const s = this.sim;
    if (s && !this.resultKind && s.score > loadBest().score) saveBest({ score: s.score, stage: s.bossTier });
  }

  // ------------------------------------------------------------------ 렌더
  private sync<T>(poolName: string, layer: Phaser.GameObjects.Container, list: T[], tex: (t: T) => string, place: (img: Phaser.GameObjects.Image, t: T) => void): void {
    const pool = this.pools[poolName];
    for (let i = 0; i < list.length; i++) {
      let img = pool[i];
      if (!img) { img = this.add.image(0, 0, tex(list[i])).setScale(S); layer.add(img); pool.push(img); }
      const key = tex(list[i]);
      if (img.texture.key !== key) img.setTexture(key);
      img.setVisible(true); place(img, list[i]);
    }
    for (let i = list.length; i < pool.length; i++) pool[i].setVisible(false);
  }

  private render(): void {
    const s = this.sim;
    // 화면 흔들림은 월드에만 적용 (HUD는 흔들리지 않음)
    const sh = this.paused ? 0 : this.shake;   // 일시정지 중에는 흔들림 정지
    this.world.setPosition(sh > 0.3 ? (Math.random() - 0.5) * sh * R : 0, sh > 0.3 ? (Math.random() - 0.5) * sh * R : 0);
    this.bg.render();

    this.sync('items', this.layers.items, s.items, it => `item_${it.type}`, (img, it) => img.setPosition(it.x, it.y));
    this.sync('enemies', this.layers.enemies, s.enemies, e => `enemy_${e.type}`, (img, e) => img.setPosition(e.x, e.y));
    this.sync('pbullets', this.layers.pbullets, s.bullets, () => 'pbullet', (img, b) => img.setPosition(b.x, b.y));
    this.sync('missiles', this.layers.missiles, s.missiles, () => 'missile', (img, m) => img.setPosition(m.x, m.y).setRotation(Math.atan2(m.vy, m.vx) + Math.PI / 2));
    this.sync('ebullets', this.layers.ebullets, s.enemyBullets, b => bulletTexture(this, b.color, b.r), (img, b) => img.setPosition(b.x, b.y));

    const p = s.player;
    this.playerImg.setPosition(p.x, p.y).setAlpha(p.invincible > 0 && Math.floor(s.frame / 4) % 2 === 0 ? 0.4 : 1);
    this.muzzleImgs.forEach((m, i) => m.setVisible(this.muzzle > 0).setPosition(p.x + (i ? 18 : -18), p.y - 30));
    this.renderPlayerAuras();
    this.renderBoss();

    this.fx.render();
    this.hud.render(s, this.best.score, audio.muted);
  }

  /** 실드 / 자석 범위 표시 */
  private renderPlayerAuras(): void {
    const g = this.auraG, p = this.sim.player, f = this.sim.frame;
    g.clear();
    if (p.shield > 0) {
      const blink = p.shield < 120 && Math.floor(f / 5) % 2 === 0;   // 끝나기 2초 전부터 깜빡임
      if (!blink) {
        g.lineStyle(2.5, 0x60a5fa, 0.9); g.strokeCircle(p.x, p.y, 38 + Math.sin(f * 0.15) * 2);
        g.fillStyle(0x3b82f6, 0.14); g.fillCircle(p.x, p.y, 38);
      }
    }
    if (p.magnet > 0 && (p.magnet > 120 || Math.floor(f / 5) % 2 === 0)) {
      g.lineStyle(1.5, 0xc084fc, 0.35); g.strokeCircle(p.x, p.y, 150);
    }
  }

  private renderMidBoss(): void {
    const m = this.sim.midBoss, g = this.midG;
    g.clear();
    if (!m) { this.midImg.setVisible(false); return; }
    const frame = this.sim.frame;
    const key = `boss${m.tier}_n`;
    const clean = this.textures.get(`boss${m.tier}`).getSourceImage() as HTMLImageElement;
    const outlined = this.textures.get(key).getSourceImage() as HTMLImageElement;
    const scale = Math.min(m.width / clean.width, m.height / clean.height);
    const jit = m.dying && !this.paused;
    const cx = m.x + (jit ? (Math.random() - 0.5) * 6 : 0), cy = m.y + (jit ? (Math.random() - 0.5) * 5 : 0);
    this.midImg.setTexture(key).setVisible(true).setPosition(cx, cy).setRotation(Math.PI)
      .setDisplaySize(outlined.width * scale, outlined.height * scale)
      .setAlpha(m.dying && Math.floor(frame / 3) % 2 === 0 ? 0.6 : 1).setTint(m.state === 'CHARGE' && Math.floor(frame / 4) % 2 === 0 ? 0xffb4b4 : 0xffffff);
    if (m.dying) return;

    // 체력 바 (머리 위)
    const bw = m.width, bx = m.x - bw / 2, by = m.y - m.height / 2 - 14;
    g.fillStyle(0x0f172a, 0.8); g.fillRect(bx, by, bw, 5);
    g.fillStyle(0xf97316, 1); g.fillRect(bx, by, bw * Math.max(0, m.hp / m.maxHp), 5);
    g.lineStyle(1, 0xfed7aa, 1); g.strokeRect(bx, by, bw, 5);

    // 레이저: 예고선(가는 점멸선) → 발사(굵은 빔)
    if (m.state === 'CHARGE') {
      const a = 0.25 + 0.35 * Math.abs(Math.sin(m.stateTimer * 0.35));
      g.lineStyle(2, 0xff4d4d, a); g.beginPath(); g.moveTo(m.laserX, m.y + m.height / 2); g.lineTo(m.laserX, H); g.strokePath();
      g.fillStyle(0xff4d4d, a * 0.5); g.fillCircle(m.x, m.y + m.height / 2, 6 + m.stateTimer * 0.15);
    } else if (m.state === 'FIRE') {
      const w = 68 * Math.min(1, m.stateTimer / 6) * Math.min(1, (45 - m.stateTimer) / 8 + 0.2);
      g.fillStyle(0xff3b3b, 0.45); g.fillRect(m.laserX - w / 2, m.y + m.height / 2, w, H);
      g.fillStyle(0xfff1f1, 0.9); g.fillRect(m.laserX - w * 0.22, m.y + m.height / 2, w * 0.44, H);
    }
  }

  private renderBoss(): void {
    this.renderMidBoss();
    const b = this.sim.boss, g = this.bossG, frame = this.sim.frame;
    g.clear();
    if (!b) { this.bossImg.setVisible(false); return; }
    const jit = b.dying && !this.paused;
    const jx = jit ? (Math.random() - 0.5) * 8 : 0, jy = jit ? (Math.random() - 0.5) * 6 : 0;
    const alpha = b.dying && Math.floor(frame / 3) % 2 === 0 ? 0.6 : 1;
    const cx = b.x + jx, cy = b.y + jy;
    const col = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;
    const main = col(b.phase2 ? '#f43f5e' : b.subColor);

    if (!b.dying) {
      // SF 전술 타겟팅 브래킷 (┌ ┐ └ ┘)
      const hw = b.width * 1.14 / 2, hh = b.height * 1.14 / 2, pulse = Math.sin(frame * 0.12) * 2.5, L = 16;
      g.lineStyle(2.5, main, 1);
      const corner = (sx: number, sy: number) => {
        g.beginPath();
        g.moveTo(cx + sx * (hw + pulse), cy + sy * (hh + pulse) - sy * L);
        g.lineTo(cx + sx * (hw + pulse), cy + sy * (hh + pulse));
        g.lineTo(cx + sx * (hw + pulse) - sx * L, cy + sy * (hh + pulse));
        g.strokePath();
      };
      corner(-1, -1); corner(1, -1); corner(-1, 1); corner(1, 1);
    }
    if (b.phase2 && !b.dying) {   // 2페이즈 각성 오라
      const pulse = 12 + Math.sin(frame * 0.22) * 6;
      g.lineStyle(3, Math.floor(frame / 5) % 2 === 0 ? 0xf43f5e : 0xfacc15, 1); g.strokeCircle(cx, cy, b.width / 2 + pulse);
      g.lineStyle(1.5, 0xf43f5e, 0.45); g.strokeCircle(cx, cy, b.width / 2 + pulse * 0.6);
    }

    const clean = this.textures.get(`boss${b.tier}`).getSourceImage() as HTMLImageElement;
    const key = b.phase2 ? `boss${b.tier}_p2` : `boss${b.tier}_n`;
    const scale = Math.min(b.width / clean.width, b.height / clean.height);
    const outlined = this.textures.get(key).getSourceImage() as HTMLImageElement;
    this.bossImg.setTexture(key).setVisible(true).setPosition(cx, cy).setRotation(Math.PI).setAlpha(alpha)
      .setDisplaySize(outlined.width * scale, outlined.height * scale);
  }
}

