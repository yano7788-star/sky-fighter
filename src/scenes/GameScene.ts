import Phaser from 'phaser';
import { CARDS, lv, type CardId } from '../core/build';
import { H, PLAYER, STEP_MS, W } from '../core/config';
import { BOMB, COMPANION_FRAMES, HAZARD, SHIELD_R } from '../core/data';
import { creditsFor, metaParams, pilotOf } from '../core/meta';
import { dailyMutator, dailySeed, dayKey } from '../core/mutators';
import { Sim } from '../core/sim';
import type { SimEvent, SkillKey } from '../core/types';
import { ParallaxOverlay, ScrollingBackground } from '../render/background';
import { Fx } from '../render/fx';
import { Hud, RESULT_BTN, UI, companionZoneActive, inRect, inZone, isUiZone } from '../render/hud';
import { LevelUpOverlay } from '../render/levelup';
import { UltFx } from '../render/ultfx';
import { R, S, bulletTexture } from '../render/textures';
import { audio, type BgmName } from '../systems/audio';
import { newlyUnlocked } from '../core/achievements';
import { loadAch, saveAch, loadBest, loadDaily, loadMeta, saveBest, saveDaily, saveMeta, type BestRecord } from '../systems/storage';

const MOVE_KEYS = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's', ' '];
const PREVENT_KEYS = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '];

export class GameScene extends Phaser.Scene {
  private sim!: Sim;
  private hud!: Hud;
  private levelup!: LevelUpOverlay;
  private ultfx!: UltFx;
  private shownPending: CardId[] | null = null;
  private bg!: ScrollingBackground;
  private overlay!: ParallaxOverlay;
  private fx!: Fx;
  private world!: Phaser.GameObjects.Container;
  private ui!: Phaser.GameObjects.Container;

  private layers: Record<string, Phaser.GameObjects.Container> = {};
  private pools: Record<string, Phaser.GameObjects.Image[]> = { items: [], enemies: [], pbullets: [], missiles: [], ebullets: [], gems: [], drones: [] };
  private playerImg!: Phaser.GameObjects.Image;
  private muzzleImgs: Phaser.GameObjects.Image[] = [];
  private bossImg!: Phaser.GameObjects.Image;
  private bossG!: Phaser.GameObjects.Graphics;
  private midG!: Phaser.GameObjects.Graphics;
  private hazG!: Phaser.GameObjects.Graphics;
  private midImg!: Phaser.GameObjects.Image;
  private auraG!: Phaser.GameObjects.Graphics;
  private beamG!: Phaser.GameObjects.Graphics;
  private fieldG!: Phaser.GameObjects.Graphics;
  private compG!: Phaser.GameObjects.Graphics;
  private catImg!: Phaser.GameObjects.Image;
  private dogImg!: Phaser.GameObjects.Image;
  private compPos = { cat: { x: 0, y: 0 }, dog: { x: 0, y: 0 } };
  private skillQueued: SkillKey | null = null;
  private runCredits = 0;
  private newAch: string[] = [];
  private creditsPaid = 0;      // 이번 런에서 이미 지급한 크레딧 (미션 클리어 후 무한 모드 이어하기 대응)
  private bestBefore = 0;       // 런 시작 시점의 최고 점수 (신기록 판정 기준)

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

  private mutatorId: string | null = null;
  private daily: { key: string; seed: number } | null = null;   // 일일 도전: 날짜 고정 시드 + 고정 모디파이어

  constructor() { super('GameScene'); }

  /** 출격 전에 고른 런 모디파이어를 받는다 (MutatorScene에서 전달) */
  init(data: { mutator?: string | null; daily?: boolean }): void {
    if (data?.daily) { const key = dayKey(); this.daily = { key, seed: dailySeed(key) }; this.mutatorId = dailyMutator(key); }
    else { this.daily = null; this.mutatorId = data?.mutator ?? null; }
  }

  create(): void {
    // Phaser는 같은 씬 인스턴스를 재사용하므로, 이전 실행에서 파괴된 오브젝트 참조를 반드시 버린다
    this.pools = { items: [], enemies: [], pbullets: [], missiles: [], ebullets: [], gems: [], drones: [] };
    this.shownPending = null;
    this.muzzleImgs = []; this.layers = {}; this.resultTimer = 0;
    this.playerImg = null as unknown as Phaser.GameObjects.Image;   // 재사용된 씬 인스턴스의 파괴된 참조 제거
    this.world = this.add.container(0, 0).setScale(R);
    this.ui = this.add.container(0, 0).setScale(R);
    for (const name of ['bg', 'field', 'items', 'gems', 'enemies', 'boss', 'beam', 'companion', 'player', 'pbullets', 'missiles', 'ebullets', 'fx']) {
      this.layers[name] = this.add.container(0, 0);
      this.world.add(this.layers[name]);
    }

    this.newSim();
    this.bg = new ScrollingBackground(this, this.layers.bg, this.sim.rng);
    this.overlay = new ParallaxOverlay(this, this.layers.bg);
    this.fx = new Fx(this, this.layers.fx);
    this.hud = new Hud(this, this.ui);
    this.hud.daily = !!this.daily;
    this.levelup = new LevelUpOverlay(this, this.ui);
    this.ultfx = new UltFx(this, this.ui);

    // 플레이어 / 총구 섬광 / 보스
    this.playerImg = this.add.image(0, 0, pilotOf(loadMeta().pilots.selected).skin);
    this.applySkin(pilotOf(loadMeta().pilots.selected).skin);   // 선택한 파일럿의 기체(세로로 긴 제트)
    this.layers.player.add(this.playerImg);
    for (let i = 0; i < 2; i++) {
      const m = this.add.image(0, 0, 'dot').setScale(S * 10 / 8).setTint(0xfef9c3).setVisible(false);
      m.setBlendMode(Phaser.BlendModes.ADD);
      this.layers.player.add(m); this.muzzleImgs.push(m);
    }
    this.bossG = this.add.graphics();
    this.bossImg = this.add.image(0, 0, 'boss1_n').setVisible(false);
    this.midG = this.add.graphics();
    this.hazG = this.add.graphics();
    this.midImg = this.add.image(0, 0, 'boss2_n').setVisible(false);
    this.auraG = this.add.graphics();
    this.layers.boss.add([this.hazG, this.bossG, this.bossImg, this.midImg, this.midG]);
    this.layers.player.add(this.auraG);
    this.fieldG = this.add.graphics(); this.layers.field.add(this.fieldG);
    this.beamG = this.add.graphics(); this.layers.beam.add(this.beamG);
    this.compG = this.add.graphics();
    this.catImg = this.add.image(0, 0, 'ally_cat').setVisible(false);
    this.dogImg = this.add.image(0, 0, 'ally_dog').setVisible(false);
    this.layers.companion.add([this.compG, this.catImg, this.dogImg]);

    this.setupInput();
    this.resetRun();
  }

  // ------------------------------------------------------------------ 초기화 / 재시작
  /** 격납고 강화 + 선택한 파일럿 패시브를 반영해 새 런을 시작하고, 파일럿의 기체 스킨을 적용한다 */
  private newSim(): void {
    const m = loadMeta();
    this.sim = new Sim(this.daily ? this.daily.seed : (Math.random() * 0xffffffff) >>> 0, metaParams(m.levels, m.pilots.selected, this.mutatorId));
    if (this.playerImg) this.applySkin(pilotOf(m.pilots.selected).skin);
  }

  private applySkin(key: string): void {
    this.playerImg.setTexture(key);
    this.playerImg.setDisplaySize(66, (66 * this.playerImg.frame.height) / this.playerImg.frame.width);
  }

  private resetRun(): void {
    this.newSim();
    this.acc = 0; this.hitStop = 0; this.shake = 0; this.muzzle = 0; this.paused = false;
    this.resultKind = null; this.newRecord = false;
    this.targetX = W / 2; this.targetY = PLAYER.spawnY;
    this.activeId = null; this.firing = false; this.fireGrace = 0; this.bombQueued = false; this.skillQueued = null; this.keys.clear();
    this.runCredits = 0; this.creditsPaid = 0; this.newAch = []; this.bestBefore = loadBest().score; this.shownPending = null; this.levelup.hide();
    this.bg.reset(); this.overlay.setStage(1); this.fx.clear(); this.hud.resetState(this.sim);
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
    if (this.resultKind === 'GAMECLEAR' && k === 'escape') { if (this.resultTimer <= 0) this.scene.start('TitleScene'); return; }
    if (k === 'p' || k === 'escape') { this.setPaused(!this.paused); return; }
    if (this.paused) { if (k === 'enter' || k === ' ') this.setPaused(false); return; }
    if (k === 'm') { audio.toggleMute(); return; }
    if (this.sim.pending) {   // 레벨업 카드 선택
      if (k === '1' || k === '2' || k === '3') this.pickCard(Number(k) - 1);
      else if (k === 'arrowleft' || k === 'a') this.levelup.moveSelection(-1);
      else if (k === 'arrowright' || k === 'd') this.levelup.moveSelection(1);
      else if (k === 'enter' || k === ' ') this.pickCard(this.levelup.getSelected());
      return;
    }
    if (this.resultKind) { if (k === 'enter' || k === ' ') this.resultTap(); return; }
    if (k === 'b' || k === 'x' || k === 'shift') { this.bombQueued = true; return; }
    if (k === 'q') { this.skillQueued = 'cat'; return; }
    if (k === 'e') { this.skillQueued = 'dog'; return; }
    if (k === 'r') { this.skillQueued = 'ult'; return; }
    this.keys.add(k);
  }

  private pressAt(id: number, x: number, y: number): void {
    audio.unlock();
    if (this.paused) { this.setPaused(false); return; }
    if (this.resultKind) { this.resultTap(x, y); return; }
    if (this.sim.pending) { const i = this.levelup.hit(x, y); if (i >= 0) { this.levelup.select(i); this.pickCard(i); } return; }
    if (inZone(UI.sound, x, y)) { audio.toggleMute(); return; }
    if (inZone(UI.pause, x, y)) { this.setPaused(true); return; }
    if (inZone(UI.bomb, x, y)) { this.bombQueued = true; return; }
    if (inZone(UI.ult, x, y)) { this.skillQueued = 'ult'; return; }
    if (inZone(UI.cat, x, y) && companionZoneActive(this.sim, 'cat')) { this.skillQueued = 'cat'; return; }
    if (inZone(UI.dog, x, y) && companionZoneActive(this.sim, 'dog')) { this.skillQueued = 'dog'; return; }
    if (this.activeId !== null) return;         // 이미 다른 손가락이 조작 중이면 무시 (보조 손가락은 버튼 전용)
    this.activeId = id; this.firing = true; this.fireGrace = 10;
    this.targetX = x; this.targetY = y - 50;
  }
  private moveAt(id: number, x: number, y: number): void {
    if (this.paused || this.resultKind || id !== this.activeId || isUiZone(x, y, this.sim)) return;
    this.targetX = x; this.targetY = y - 50;
  }
  private releaseAt(id: number): void { if (id === this.activeId) { this.activeId = null; this.firing = false; } }

  private pickCard(i: number): void {
    if (!this.sim.pending || i < 0 || i >= this.sim.pending.length) return;
    this.sim.chooseCard(i);
    this.levelup.hide(); this.shownPending = null;
    for (const e of this.sim.drainEvents()) this.handleEvent(e);
  }

  private buildSummary(): string {
    const b = this.sim.build, ids = (Object.keys(CARDS) as CardId[]).filter(id => lv(b, id) > 0);
    const body = ids.length ? ids.map(id => `${CARDS[id].name} ${CARDS[id].kind === 'fusion' ? '★' : 'Lv' + lv(b, id)}`).join('  ·  ') : '아직 획득한 카드가 없습니다';
    return `LV ${this.sim.level}  ·  기본 대포 Lv${this.sim.weaponLevel}\n${body}`;
  }

  /** 결과 화면 입력: 게임오버=재출격, 미션 클리어=[무한 모드 계속]/[타이틀로] (좌표가 없으면 키보드·패드 → 무한 모드 계속) */
  private resultTap(x?: number, y?: number): void {
    if (this.resultTimer > 0) return;
    if (this.resultKind === 'GAMEOVER') { if (this.daily) this.scene.start('GameScene', { daily: true }); else this.scene.start('MutatorScene'); return; }   // 재출격: 일일 도전은 같은 조건으로, 일반 출격은 모디파이어를 다시 고른다
    let choice: 'continue' | 'title' = 'continue';
    if (x !== undefined && y !== undefined) {
      if (inRect(RESULT_BTN.title, x, y)) choice = 'title';
      else if (inRect(RESULT_BTN.cont, x, y)) choice = 'continue';
      else return;   // 버튼 밖 탭은 무시 (실수로 나가지 않도록)
    }
    if (choice === 'title') this.scene.start('TitleScene'); else this.startEndless();
  }

  private startEndless(): void {
    this.sim.startEndless();
    this.resultKind = null; this.resultTimer = 0;
    this.hud.showResult(null);
    this.activeId = null; this.firing = false;
    audio.sfx('item');
  }

  private setPaused(v: boolean): void {
    if (v === this.paused || (v && (this.resultKind || !this.sim || this.sim.pending))) return;
    this.paused = v; this.acc = 0;
    this.activeId = null; this.firing = false; this.keys.clear();
    if (v) this.hud.setBuildText(this.buildSummary());
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
    if (this.paused) return;
    if (this.sim.pending) {   // 카드 선택: 좌우로 이동, A로 선택
      if (edge('left', btn(14) || (pad.axes[0]?.getValue() ?? 0) < -0.6)) this.levelup.moveSelection(-1);
      if (edge('right', btn(15) || (pad.axes[0]?.getValue() ?? 0) > 0.6)) this.levelup.moveSelection(1);
      if (edge('a2', btn(0))) this.pickCard(this.levelup.getSelected());
      return;
    }
    if (edge('bomb', btn(1) || btn(2)) && !this.paused && !this.resultKind) this.bombQueued = true;
    if (edge('ult', btn(3)) && !this.paused && !this.resultKind) this.skillQueued = 'ult';
    if (edge('cat', btn(4)) && !this.paused && !this.resultKind) this.skillQueued = 'cat';
    if (edge('dog', btn(6)) && !this.paused && !this.resultKind) this.skillQueued = 'dog';
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
    if (s.boss || s.stagePhase === 'WARNING') return 'boss';
    return s.stageTier >= 4 ? 'solar' : 'normal';   // 후반 스테이지는 새 곡(Target Solar Core)
  }

  private tick(): void {
    audio.updateMusic(this.wantedBgm());
    if (this.hitStop > 0) {                                // 히트스톱: 타격 순간 잠깐 멈춤
      this.hitStop--;
      if (this.bombQueued) { this.bombQueued = false; this.sim.fireBomb(); for (const e of this.sim.drainEvents()) this.handleEvent(e); }   // 폭탄은 지연 없이
      return;
    }
    const s = this.sim;
    if (s.pending) {   // 레벨업 카드 선택 중: 시뮬레이션 정지, 오버레이 표시
      if (this.shownPending !== s.pending) { this.shownPending = s.pending; this.levelup.show(s.pending, s.build); this.activeId = null; this.firing = false; }
      this.fx.tick();
      return;
    }
    this.hud.tick(s); this.fx.tick(); this.bg.tick(); this.overlay.tick();
    if (this.shake > 0.3) this.shake *= 0.88; else this.shake = 0;
    if (this.muzzle > 0) this.muzzle--;
    if (this.resultTimer > 0) this.resultTimer--;
    if (this.resultKind) { this.hud.showResult(this.resultInfo(), this.resultTimer <= 0); return; }

    this.pollKeyboardMove();
    const wantFire = this.firing || this.fireGrace > 0 || this.keys.has(' ') || this.padFire;
    if (this.fireGrace > 0) this.fireGrace--;
    s.step({ targetX: this.targetX, targetY: this.targetY, fire: wantFire, bomb: this.bombQueued, skill: this.skillQueued });
    this.bombQueued = false; this.skillQueued = null;

    for (const e of s.drainEvents()) this.handleEvent(e);
    if (s.midBoss && s.midBoss.state === 'FIRE') this.shake = Math.max(this.shake, 3);   // 레이저 발사 중 진동
    if (s.frame % 2 === 0) for (const m of s.missiles) this.fx.trail(m.x, m.y, '#ec4899');
    if (s.stagePhase === 'INTRO') this.bg.setTier(s.stageTier);
    if (this.overlay.stage() !== s.stageTier) this.overlay.setStage(s.stageTier);
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
      case 'bomb':   // 폭탄: 화면을 가르는 3중 충격파
        this.fx.ring(e.x, e.y, '#ffffff', 420); this.fx.ring(e.x, e.y, '#fb923c', 320); this.fx.ring(e.x, e.y, '#fde68a', 220);
        this.fx.explosion(e.x, e.y, '#fb923c', 40); break;
      case 'missileHit': {   // 미사일 착탄: 충격 링 + 날카로운 스파크 + 섬광 + 흔들림 + 묵직한 소리
        const k = e.kill;
        this.fx.ring(e.x, e.y, '#fda4af', k ? 120 : 64); this.fx.ring(e.x, e.y, '#ffffff', k ? 70 : 38);
        this.fx.sparkBurst(e.x, e.y, '#fecdd3', k ? 22 : 12); this.fx.sparkBurst(e.x, e.y, '#fb923c', k ? 12 : 6);
        this.fx.flashBlob(e.x, e.y, k ? 110 : 64, 0xfff1f2);
        this.shake = Math.max(this.shake, k ? 5 : 2.5);
        if (k) this.hitStop = Math.max(this.hitStop, 2);
        audio.sfx('missileHit');
        break;
      }
      case 'kill': {   // 처치: 점수 팝업, 미사일로 잡았으면 더 큰 폭발
        const big = this.sim.multiplier >= 1.5;
        this.fx.pop(e.x, e.y - 12, `+${e.pts}`, big ? '#fde047' : '#ffffff', big ? 17 : 14);
        if (e.missile) { this.fx.explosion(e.x, e.y, '#fb923c', 24); this.fx.explosion(e.x, e.y, '#fecdd3', 10); this.fx.ring(e.x, e.y, '#fb923c', 90); }
        break;
      }
      case 'levelup': audio.sfx('item'); break;
      case 'heal': this.fx.explosion(e.x, e.y, '#4ade80', 10); break;
      case 'skill': if (e.key === 'ult') { this.activeId = null; this.firing = false; } break;
      case 'ult':
        if (e.phase === 'IMPACT') { this.fx.ring(W / 2, H * 0.55, '#a5f3fc', 500); audio.sfx('boom'); }
        else if (e.phase === 'CUTIN') audio.sfx('enrage');
        else if (e.phase === 'ACTIVE') { audio.sfx(this.sim.ult.kind === 'barrage' ? 'boom' : 'laserCharge'); this.fx.ring(W / 2, H * 0.5, this.sim.ult.kind === 'barrage' ? '#fb923c' : '#7dd3fc', 420); }
        break;
      case 'gem': break;
      case 'hitspark': if (this.sim.frame % 3 === 0) this.fx.ring(e.x, e.y, '#fde047', 16); break;
      case 'gameover': case 'gameclear': this.finishRun(e.t === 'gameover' ? 'GAMEOVER' : 'GAMECLEAR'); break;
    }
  }

  // ------------------------------------------------------------------ 결과 / 기록
  private finishRun(kind: 'GAMEOVER' | 'GAMECLEAR'): void {
    const s = this.sim;
    this.newRecord = s.score > this.bestBefore;
    let dailyBonus = 1;
    if (this.daily) {   // 일일 도전 기록 저장, 첫 도전에는 크레딧 +25%
      const d = loadDaily(this.daily.key);
      if (d.runs === 0) dailyBonus = 1.25;
      this.newRecord = s.score > d.best; d.best = Math.max(d.best, s.score); d.runs++; saveDaily(d);
    }
    this.best = { score: Math.max(this.best.score, s.score), stage: Math.max(this.best.stage, s.bossTier) };
    saveBest(this.best);
    const total = Math.floor(creditsFor(s.score, s.bossTier, s.endless || kind === 'GAMECLEAR') * s.meta.mut.credit * dailyBonus);
    const meta = loadMeta(); meta.credits += Math.max(0, total - this.creditsPaid); saveMeta(meta);   // 무한 모드로 이어 간 경우 이미 지급한 크레딧은 제외
    this.creditsPaid = Math.max(this.creditsPaid, total); this.runCredits = total;
    const have = loadAch(), got = newlyUnlocked(s.runStats(!!this.daily), have);   // 업적: 새로 달성한 것만 보상 지급
    this.newAch = got.map(a => a.icon + ' ' + a.name);
    if (got.length) {
      saveAch([...have, ...got.map(a => a.id)]);
      const m2 = loadMeta(); m2.credits += got.reduce((n, a) => n + a.reward, 0); saveMeta(m2);
      this.runCredits += got.reduce((n, a) => n + a.reward, 0);
    }
    this.resultKind = kind; this.resultTimer = 90;
    this.activeId = null; this.firing = false;
    this.hud.showResult(this.resultInfo(), false);
  }
  private resultInfo() {
    return { newAch: this.newAch, dailyBest: this.daily ? loadDaily(this.daily.key).best : undefined, kind: this.resultKind!, score: this.sim.score, stage: this.sim.bossTier, level: this.sim.level, credits: this.runCredits, best: this.best, newRecord: this.newRecord };
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
    this.bg.render(); this.overlay.render();

    this.sync('items', this.layers.items, s.items, it => `item_${it.type}`, (img, it) => img.setPosition(it.x, it.y).setDisplaySize(32, 32));
    this.sync('gems', this.layers.gems, s.gems, () => 'gem', (img, g) => img.setPosition(g.x, g.y + Math.sin((s.frame + g.x) * 0.1) * 1.5).setDisplaySize(17, 17));
    this.sync('enemies', this.layers.enemies, s.enemies, e => (e.type === 'sniper' ? 'enemy_warship' : `enemy_${e.type}`), (img, e) => {
      // 전용 스프라이트: 정찰기/지그재그/돌진형은 위를 향하는 그림이라 180° 돌려 아래를 보게 하고, 저격형(워쉽)은 그대로
      const w = e.type === 'sniper' ? 64 : e.type === 'scout' ? 46 : e.type === 'zigzag' ? 50 : 40;
      img.setPosition(e.x, e.y).setDisplaySize(w, (w * img.frame.height) / img.frame.width).setRotation(e.type === 'sniper' ? 0 : Math.PI);
      if (e.flash && e.flash > 0) img.setTintFill(0xffffff); else img.clearTint();   // 피격 순간 하얗게 번쩍
    });
    this.sync('pbullets', this.layers.pbullets, s.bullets, () => 'pbullet', (img, b) => img.setPosition(b.x, b.y));
    this.sync('missiles', this.layers.missiles, s.missiles, () => 'missile', (img, m) => img.setPosition(m.x, m.y).setRotation(Math.atan2(m.vy, m.vx) + Math.PI / 2));
    this.sync('ebullets', this.layers.ebullets, s.enemyBullets, b => bulletTexture(this, b.color, b.r), (img, b) => img.setPosition(b.x, b.y));

    const p = s.player;
    this.playerImg.setPosition(p.x, p.y).setAlpha(p.invincible > 0 && Math.floor(s.frame / 4) % 2 === 0 ? 0.4 : 1);
    this.muzzleImgs.forEach((m, i) => m.setVisible(this.muzzle > 0).setPosition(p.x + (i ? 18 : -18), p.y - 30));
    this.sync('drones', this.layers.player, s.dronePositions(), () => 'drone', (img, d) => img.setPosition(d.x, d.y).setDisplaySize(26, 26));
    this.renderPlayerAuras();
    this.renderWeaponFx();
    this.renderCompanions();
    this.renderHazards();
    this.renderBoss();
    this.ultfx.render(s);
    this.levelup.update(this.time.now);

    this.fx.render();
    this.hud.render(s, this.best.score, audio.muted);
  }

  /** 레이저 빔 + 폭탄 폭발장 */
  private renderWeaponFx(): void {
    const s = this.sim, p = s.player, g = this.beamG, f = this.fieldG;
    g.clear(); f.clear();
    if (s.laser.on) {
      const w = s.laser.w * (1 + Math.sin(s.frame * 0.6) * 0.08), rail = s.hasFusion('railgun'), prism = s.hasFusion('prism');
      for (const o of s.laser.offs) {
        const bx = p.x + o;
        g.fillStyle(prism ? 0xe879f9 : rail ? 0x38bdf8 : 0x3b82f6, 0.35); g.fillRect(bx - w / 2 - 3, 0, w + 6, p.y - 24);
        g.fillStyle(prism ? 0xf5d0fe : rail ? 0xe0f2fe : 0x93c5fd, 0.8); g.fillRect(bx - w / 2, 0, w, p.y - 24);
        g.fillStyle(0xffffff, 0.95); g.fillRect(bx - w * 0.18, 0, w * 0.36, p.y - 24);
      }
    }
    if (s.bombT > 0) {   // 폭탄 폭발장: 퍼져 나가는 원
      const k = 1 - s.bombT / BOMB.fieldFrames, r = BOMB.fieldRadiusMax * Math.sqrt(k), a = 1 - k;
      f.fillStyle(0xfb923c, 0.16 * a); f.fillCircle(s.bombX, s.bombY, r);
      f.lineStyle(6 * a + 1, 0xffedd5, 0.85 * a); f.strokeCircle(s.bombX, s.bombY, r);
      f.lineStyle(3 * a + 1, 0xf97316, 0.7 * a); f.strokeCircle(s.bombX, s.bombY, r * 0.82);
    }
  }

  /** 동료(고양이/강아지) 스프라이트·흡혈 오라·방어막 */
  private renderCompanions(): void {
    const s = this.sim, p = s.player, g = this.compG, f = s.frame;
    g.clear();
    const defs: ['cat' | 'dog', Phaser.GameObjects.Image, number][] = [['cat', this.catImg, -64], ['dog', this.dogImg, 64]];
    for (const [key, img, side] of defs) {
      const c = s.comp[key];
      if (!c.active) { img.setVisible(false); this.compPos[key].x = p.x + side; this.compPos[key].y = p.y + 160; continue; }
      const age = COMPANION_FRAMES - c.timer, ease = Math.max(0, Math.min(1, age / 25, c.timer / 25)), e2 = 1 - (1 - ease) * (1 - ease);
      const pos = this.compPos[key];
      pos.x += (Math.max(30, Math.min(W - 30, p.x + side)) - pos.x) * 0.18; pos.y += (p.y + 10 - pos.y) * 0.18;
      const bob = Math.sin(f * 0.12 + (side > 0 ? 1.6 : 0)) * 3;
      img.setVisible(true).setPosition(pos.x, pos.y + (1 - e2) * 150 + bob).setAlpha(e2)
        .setDisplaySize(54, (54 * img.frame.height) / img.frame.width);
      const blink = c.timer < (key === 'dog' ? 120 : 90) && Math.floor(f / 6) % 2 === 0;
      if (key === 'cat') {   // 흡혈 오라 + 동료와 이어진 점선
        const R2 = 46 + Math.sin(f * 0.18) * 3;
        g.fillStyle(0xf43f5e, (blink ? 0.08 : 0.2) * e2); g.fillCircle(p.x, p.y, R2);
        g.lineStyle(2, 0xfb7185, (blink ? 0.3 : 0.7) * e2);
        for (let i = 0; i < 6; i++) { const t0 = ((i + (f * 0.04) % 1) / 6), t1 = t0 + 0.07; g.beginPath(); g.moveTo(pos.x + (p.x - pos.x) * t0, pos.y + (p.y - pos.y) * t0); g.lineTo(pos.x + (p.x - pos.x) * t1, pos.y + (p.y - pos.y) * t1); g.strokePath(); }
      } else {   // 방어막 (회전하는 문양 포함)
        const R2 = SHIELD_R * (0.55 + 0.45 * e2) + Math.sin(f * 0.2) * 1.5, a = (blink ? 0.4 : 1) * Math.min(1, e2 * 1.5);
        g.fillStyle(0x67e8f9, 0.12 * a); g.fillCircle(p.x, p.y, R2);
        g.lineStyle(2.5, 0xa5f3fc, a); g.strokeCircle(p.x, p.y, R2);
        g.lineStyle(1.5, 0xcffafe, 0.55 * a);
        for (let i = 0; i < 6; i++) { const a0 = f * 0.03 + (i * Math.PI) / 3; g.beginPath(); g.arc(p.x, p.y, R2 - 6, a0, a0 + 0.6); g.strokePath(); }
      }
    }
  }

  /** 실드 / 자석 범위 표시 */
  private renderPlayerAuras(): void {
    const g = this.auraG, p = this.sim.player, f = this.sim.frame;
    g.clear();
    if (p.shield > 0) {
      g.lineStyle(2.5, 0x60a5fa, 0.9); g.strokeCircle(p.x, p.y, 38 + Math.sin(f * 0.15) * 2);   // 방벽은 피격 전까지 유지
      g.fillStyle(0x3b82f6, 0.14); g.fillCircle(p.x, p.y, 38);
    }
    if (p.magnet > 0 && (p.magnet > 120 || Math.floor(f / 5) % 2 === 0)) {
      g.lineStyle(1.5, 0xc084fc, 0.35); g.strokeCircle(p.x, p.y, 150);
    }
  }

  /** 장애물: 예고(깜빡이는 표시) → 위험 구간. 바람은 화면을 가로지르는 줄무늬로 표현 */
  private renderHazards(): void {
    const s = this.sim, g = this.hazG, f = s.frame;
    g.clear();
    for (const h of s.hazards) {
      if (h.kind === 'meteor') {
        if (h.t <= h.warn) {   // 낙하 예고: 위쪽에 깜빡이는 화살표와 흐린 궤적
          const a = 0.2 + 0.5 * Math.abs(Math.sin(h.t * 0.3));
          g.lineStyle(2, 0xfb923c, a * 0.5); g.beginPath(); g.moveTo(h.x, 0); g.lineTo(h.x, H); g.strokePath();
          g.fillStyle(0xfb923c, a); g.fillTriangle(h.x - 12, 10, h.x + 12, 10, h.x, 30);
        } else {
          g.lineStyle(10, 0xf97316, 0.25); g.beginPath(); g.moveTo(h.x, h.y - 70); g.lineTo(h.x, h.y); g.strokePath();
          g.fillStyle(0xea580c, 0.9); g.fillCircle(h.x, h.y, 15); g.fillStyle(0xfde68a, 0.95); g.fillCircle(h.x, h.y, 8);
        }
      } else {
        const hw = HAZARD.lavaHalfW;
        if (h.t <= h.warn) {
          const a = 0.1 + 0.25 * Math.abs(Math.sin(h.t * 0.25));
          g.fillStyle(0xef4444, a); g.fillRect(h.x - hw, 0, hw * 2, H);
          g.lineStyle(1, 0xfca5a5, a * 2); g.strokeRect(h.x - hw, 0, hw * 2, H);
        } else {
          const k = Math.min(1, (h.t - h.warn) / 5) * Math.min(1, (h.warn + h.dur - h.t) / 8 + 0.3);
          g.fillStyle(0xdc2626, 0.5 * k); g.fillRect(h.x - hw * 1.5, 0, hw * 3, H);
          g.fillStyle(0xf97316, 0.75 * k); g.fillRect(h.x - hw, 0, hw * 2, H);
          g.fillStyle(0xfef3c7, 0.9 * k); g.fillRect(h.x - hw * 0.35, 0, hw * 0.7, H);
        }
      }
    }
    if (s.windWarn > 0 || s.windT > 0) {   // 바람 줄무늬
      const a = s.windT > 0 ? 0.28 : 0.1 + 0.1 * Math.abs(Math.sin(f * 0.3));
      for (let i = 0; i < 16; i++) {
        const y = (i * 53 + 17) % H, len = 50 + (i % 4) * 25, sp = 14 + (i % 3) * 5;
        const x = (((f * sp * s.windDir + i * 97) % (W + 160)) + (W + 160)) % (W + 160) - 80;
        g.lineStyle(2, 0xe0f2fe, a); g.beginPath(); g.moveTo(x, y); g.lineTo(x - s.windDir * len, y); g.strokePath();
      }
    }
  }

  private renderMidBoss(): void {
    const m = this.sim.midBoss, g = this.midG;
    g.clear();
    if (!m) { this.midImg.setVisible(false); return; }
    const frame = this.sim.frame;
    const jit = m.dying && !this.paused;
    const cx = m.x + (jit ? (Math.random() - 0.5) * 6 : 0), cy = m.y + (jit ? (Math.random() - 0.5) * 5 : 0);
    const mkey = `midboss_${m.tier}`, mfr = this.textures.get(mkey).getSourceImage() as HTMLImageElement;
    const mw = m.width * 1.25;   // 중간보스: 스테이지별 전용 기체 (위를 향하는 그림이라 180° 회전)
    this.midImg.setTexture(mkey).setVisible(true).setPosition(cx, cy + Math.sin(frame * 0.1) * 2).setRotation(Math.PI)
      .setDisplaySize(mw, (mw * mfr.height) / mfr.width)
      .setAlpha(m.dying && Math.floor(frame / 3) % 2 === 0 ? 0.6 : 1).setTint(m.state === 'CHARGE' && Math.floor(frame / 4) % 2 === 0 ? 0xffb4b4 : 0xffffff);
    if (m.dying) return;

    // 체력 바 (머리 위)
    const bw = m.width, bx = m.x - bw / 2, by = m.y - m.height / 2 - 14;
    g.fillStyle(0x0f172a, 0.8); g.fillRect(bx, by, bw, 5);
    g.fillStyle(0xf97316, 1); g.fillRect(bx, by, bw * Math.max(0, m.hp / m.maxHp), 5);
    g.lineStyle(1, 0xfed7aa, 1); g.strokeRect(bx, by, bw, 5);

    // 레이저: 보스 코에서 곧게 내려오는 예고선 → 발사. 발사 중에는 배경 전체가 번쩍이고 바닥에 충돌 섬광이 생긴다
    const nx = m.laserX, ny = m.y + m.height * 0.62;
    if (m.state === 'CHARGE') {
      const k = m.stateTimer / 70, a = 0.25 + 0.4 * Math.abs(Math.sin(m.stateTimer * 0.35));
      g.lineStyle(2, 0xff4d4d, a); g.beginPath(); g.moveTo(nx, ny); g.lineTo(nx, H); g.strokePath();
      for (const off of [-34, 34]) { g.lineStyle(1, 0xff7a7a, a * 0.5); g.beginPath(); g.moveTo(nx + off, ny + 24); g.lineTo(nx + off, H); g.strokePath(); }   // 맞는 폭을 알려 주는 가이드
      const r = 5 + k * 20 + Math.sin(frame * 0.5) * 2;   // 코 앞에 에너지가 모이는 구체
      g.fillStyle(0xff3b3b, 0.35); g.fillCircle(nx, ny, r * 1.8); g.fillStyle(0xffd0d0, 0.9); g.fillCircle(nx, ny, r * 0.6);
      if (frame % 2 === 0) this.fx.chargeSpark(nx, ny, '#ff8a8a');
    } else if (m.state === 'FIRE') {
      const t = m.stateTimer, w = 66 * Math.min(1, t / 6) * Math.min(1, (45 - t) / 8 + 0.2), flick = 0.85 + Math.random() * 0.15;
      g.fillStyle(0x02040c, 0.2 * Math.min(1, t / 5)); g.fillRect(0, 0, W, H);       // 배경을 살짝 어둡게 눌러 빔을 돋보이게
      g.fillStyle(0xff2d2d, 0.06 * flick); g.fillRect(0, 0, W, H);                   // 화면 전체 붉은 기운
      for (let i = 0; i < 6; i++) {                                                  // 부드러운 후광: 겹겹의 사각형
        const k = i / 5; g.fillStyle(0xff5a3c, 0.05 + 0.05 * (1 - k) * flick); g.fillRect(nx - w * (2.1 - k * 1.2), ny, w * (4.2 - k * 2.4), H);
      }
      g.fillStyle(0xff3b3b, 0.5); g.fillRect(nx - w / 2, ny, w, H);
      g.fillStyle(0xfff1f1, 0.95); g.fillRect(nx - w * 0.2, ny, w * 0.4, H);
      for (let i = 0; i < 6; i++) {                                                  // 빔을 따라 흐르는 밝은 띠
        const yy = ny + ((frame * 30 + i * 150) % (H - ny)); g.fillStyle(0xffffff, 0.55); g.fillRect(nx - w * 0.34, yy, w * 0.68, 16);
      }
      g.fillStyle(0xffe4e4, 0.9); g.fillCircle(nx, ny, w * 0.38);                    // 발사구 광구
      g.fillStyle(0xff5a3c, 0.35 * flick); g.fillCircle(nx, ny, w * 0.8);
      g.fillStyle(0xff7a3c, 0.5 * flick); g.fillEllipse(nx, H - 6, w * 3, 38);       // 바닥 충돌 섬광
      g.fillStyle(0xffffff, 0.8 * flick); g.fillEllipse(nx, H - 6, w * 1.3, 18);
      if (frame % 2 === 0) this.fx.sparkBurst(nx + (Math.random() < 0.5 ? -w / 2 : w / 2), ny + Math.random() * (H - ny), '#ffb4a8', 2);   // 빔 가장자리 불꽃
      if (frame % 3 === 0) this.fx.sparkBurst(nx + (Math.random() - 0.5) * w * 1.6, H - 10, '#ffd2a0', 2);                                    // 바닥에서 튀는 불꽃
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
    if (b.phase3 && !b.dying) {   // 3페이즈: 보라색 외곽 오라가 하나 더
      const p3 = 30 + Math.sin(frame * 0.3) * 8;
      g.lineStyle(3, 0xe879f9, 0.8); g.strokeCircle(cx, cy, b.width / 2 + p3);
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

