import Phaser from 'phaser';
import { H, W } from '../core/config';
import { createRng } from '../core/rng';
import { SUBTITLE, TAGLINE, TITLE_LINES, VERSION } from '../branding';
import { ScrollingBackground } from '../render/background';
import { FONT, textStyle } from '../render/hud';
import { R, S } from '../render/textures';
import { audio } from '../systems/audio';
import { loadBest } from '../systems/storage';

const START = { x: W / 2, y: H * 0.8, w: 300, h: 60 };
const HELP = { x: W / 2, y: H * 0.8 + 62, w: 160, h: 34 };
const SOUND = { x: W - 34, y: 34, r: 24 };

const HELP_TEXT = [
  ['조작', '#38bdf8'],
  ['터치·마우스: 누른 채 드래그 = 이동 + 자동 발사\n오른쪽 아래 버튼 = 폭탄', '#e2e8f0'],
  ['키보드: 방향키/WASD 이동 · Space 발사 · B 폭탄\nP/ESC 일시정지 · M 음소거', '#e2e8f0'],
  ['게임패드: 스틱 이동 · A 발사 · B 폭탄 · Start 일시정지', '#e2e8f0'],
  ['아이템', '#38bdf8'],
  ['P 파워업 · M 유도미사일 · E 에너지 · B 폭탄\nS 실드(피격 1회 방어) · G 자석 · L 목숨', '#e2e8f0'],
  ['요령', '#38bdf8'],
  ['연속으로 처치하면 점수 배율 상승 (피격 시 초기화)\n탄을 아슬아슬하게 스치면 그레이즈 보너스\n스테이지를 피격 없이 클리어하면 S랭크 보너스', '#e2e8f0'],
] as const;

export class TitleScene extends Phaser.Scene {
  private started = false;
  private btn!: Phaser.GameObjects.Graphics;
  private jet!: Phaser.GameObjects.Image;
  private flames: Phaser.GameObjects.Image[] = [];
  private shots: { img: Phaser.GameObjects.Image; y: number }[] = [];
  private bg!: ScrollingBackground;
  private helpGroup: Phaser.GameObjects.GameObject[] = [];
  private helpOpen = false;
  private muteText!: Phaser.GameObjects.Text;
  private nextBg = 0;

  constructor() { super('TitleScene'); }

  create(): void {
    this.started = false; this.helpOpen = false;
    this.flames = []; this.shots = []; this.helpGroup = [];
    const root = this.add.container(0, 0).setScale(R);

    // 배경: 스테이지 배경들을 천천히 순환 + 별
    this.bg = new ScrollingBackground(this, root, createRng(7));
    this.bg.reset();
    this.nextBg = -1;

    // 위·아래를 어둡게 눌러 로고/버튼 가독성 확보
    const shade = this.add.graphics();
    shade.fillGradientStyle(0x03050a, 0x03050a, 0x03050a, 0x03050a, 0.85, 0.85, 0, 0);
    shade.fillRect(0, 0, W, H * 0.42);
    shade.fillGradientStyle(0x03050a, 0x03050a, 0x03050a, 0x03050a, 0, 0, 0.9, 0.9);
    shade.fillRect(0, H * 0.62, W, H * 0.38);
    root.add(shade);

    // 전투기 + 엔진 불꽃 + 위로 쏘는 탄
    for (let i = 0; i < 10; i++) {
      const img = this.add.image(0, -50, 'pbullet').setScale(S).setVisible(false);
      root.add(img); this.shots.push({ img, y: -50 });
    }
    this.jet = this.add.image(W / 2, H * 0.58, 'player');
    const ar = this.jet.height / this.jet.width;
    this.jet.setDisplaySize(130, 130 * ar);
    for (const dx of [-14, 14]) {
      const f = this.add.image(W / 2 + dx, H * 0.58 + 42, 'dot').setTint(0xfb923c).setBlendMode(Phaser.BlendModes.ADD);
      this.flames.push(f); root.add(f);
    }
    root.add(this.jet);

    // 로고
    TITLE_LINES.forEach((line, i) => {
      const size = i === 0 ? 62 : 52;
      const t = this.add.text(W / 2, H * 0.14 + i * 62, line, {
        ...textStyle(size, '#f8fafc'), stroke: '#0ea5e9', strokeThickness: 5,
      }).setOrigin(0.5).setShadow(0, 0, '#22d3ee', 18, true, true);
      root.add(t);
    });
    const sub = this.add.text(W / 2, H * 0.14 + TITLE_LINES.length * 62 + 4, SUBTITLE.split('').join(' '), textStyle(20, '#22d3ee')).setOrigin(0.5);
    sub.setShadow(0, 0, '#0891b2', 10, true, true);
    root.add(sub);
    root.add(this.add.text(W / 2, H * 0.14 + TITLE_LINES.length * 62 + 36, TAGLINE, { ...textStyle(12, '#94a3b8', false), wordWrap: { width: W - 60 }, align: 'center' }).setOrigin(0.5));

    // 버튼
    this.btn = this.add.graphics(); root.add(this.btn);
    root.add(this.add.text(START.x, START.y, 'START MISSION', textStyle(24, '#f8fafc')).setOrigin(0.5).setShadow(0, 0, '#0ea5e9', 8, true, true));
    root.add(this.add.text(HELP.x, HELP.y, '? HOW TO PLAY', textStyle(13, '#94a3b8')).setOrigin(0.5));

    const best = loadBest();
    root.add(this.add.text(W / 2, H * 0.935, best.score > 0 ? `BEST ${best.score}  ·  STAGE ${best.stage}` : 'NO RECORD YET', textStyle(13, '#94a3b8')).setOrigin(0.5));
    root.add(this.add.text(W - 10, H - 8, VERSION, textStyle(10, '#475569', false)).setOrigin(1, 1));
    this.muteText = this.add.text(SOUND.x, SOUND.y, '', { fontFamily: FONT, fontSize: '20px', resolution: R }).setOrigin(0.5);
    root.add(this.muteText);

    this.buildHelp(root);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onTap(p.x / R, p.y / R));
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      audio.unlock();
      if (e.key === 'Enter' || e.key === ' ') { if (this.helpOpen) this.toggleHelp(false); else this.start(); }
      else if (e.key === 'Escape') this.toggleHelp(false);
      else if (e.key.toLowerCase() === 'h' || e.key === '?') this.toggleHelp(!this.helpOpen);
      else if (e.key.toLowerCase() === 'm') audio.toggleMute();
    });
  }

  private buildHelp(root: Phaser.GameObjects.Container): void {
    const panel = this.add.graphics();
    panel.fillStyle(0x03050a, 0.94); panel.fillRect(0, 0, W, H);
    panel.lineStyle(1.5, 0x38bdf8, 0.7); panel.strokeRoundedRect(20, 60, W - 40, H - 150, 14);
    const items: Phaser.GameObjects.GameObject[] = [panel];
    let y = 82;
    for (const [text, color] of HELP_TEXT) {
      const heading = color === '#38bdf8';
      const t = this.add.text(36, y, text, { ...textStyle(heading ? 16 : 13, color, heading), wordWrap: { width: W - 72 }, lineSpacing: 5 });
      items.push(t); y += t.height + (heading ? 8 : 16);
    }
    items.push(this.add.text(W / 2, H - 100, '화면을 탭하면 닫힙니다', textStyle(12, '#64748b', false)).setOrigin(0.5));
    items.forEach(o => { root.add(o); (o as Phaser.GameObjects.Components.Visible & Phaser.GameObjects.GameObject).setVisible(false); });
    this.helpGroup = items;
  }

  private toggleHelp(v: boolean): void {
    this.helpOpen = v;
    this.helpGroup.forEach(o => (o as Phaser.GameObjects.Components.Visible & Phaser.GameObjects.GameObject).setVisible(v));
  }

  private onTap(x: number, y: number): void {
    audio.unlock();
    if (this.helpOpen) { this.toggleHelp(false); return; }
    if (Math.hypot(x - SOUND.x, y - SOUND.y) < SOUND.r + 8) { audio.toggleMute(); return; }
    if (Math.abs(x - HELP.x) < HELP.w / 2 && Math.abs(y - HELP.y) < HELP.h / 2 + 6) { this.toggleHelp(true); return; }
    this.start();   // 화면 어디를 눌러도 시작 (모바일 편의)
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    audio.unlock();    // 사용자 제스처 안에서 오디오 잠금 해제
    this.scene.start('GameScene');
  }

  update(time: number): void {
    this.bg.tick(); this.bg.render();
    if (this.nextBg < 0) this.nextBg = time + 5000;
    if (time > this.nextBg) { this.nextBg = time + 6000; this.bg.setTier((this.bgTier = (this.bgTier % 5) + 1)); }

    // 전투기 부유 + 엔진 불꽃
    const bob = Math.sin(time * 0.002) * 6;
    this.jet.setY(H * 0.58 + bob);
    this.flames.forEach((f, i) => f.setPosition(W / 2 + (i ? 14 : -14), H * 0.58 + bob + 44).setScale(S * (1.1 + Math.random() * 0.5), S * (1.8 + Math.random() * 1.2)).setAlpha(0.7 + Math.random() * 0.3));
    // 위로 올라가는 탄
    if (Math.floor(time / 130) !== Math.floor((time - 16) / 130)) {
      const free = this.shots.find(s => !s.img.visible);
      if (free) { free.y = H * 0.58 + bob - 40; free.img.setVisible(true); free.img.x = W / 2 + (Math.random() < 0.5 ? -18 : 18); }
    }
    for (const s of this.shots) {
      if (!s.img.visible) continue;
      s.y -= 12; s.img.y = s.y;
      if (s.y < H * 0.3) s.img.setVisible(false);
    }

    // 시작 버튼 (펄스 외곽선 + 안쪽 채움)
    const pulse = 0.5 + Math.sin(time * 0.006) * 0.5;
    this.btn.clear();
    this.btn.fillStyle(0x0c4a6e, 0.55);
    this.btn.fillRoundedRect(START.x - START.w / 2, START.y - START.h / 2, START.w, START.h, 14);
    this.btn.lineStyle(3, 0x38bdf8, 0.45 + pulse * 0.55);
    this.btn.strokeRoundedRect(START.x - START.w / 2, START.y - START.h / 2, START.w, START.h, 14);

    this.muteText.setText(audio.muted ? '🔇' : '🔊').setAlpha(0.85);

    const pad = this.input.gamepad?.getPad(0);
    if (pad && (pad.buttons[0]?.pressed || pad.buttons[9]?.pressed) && !this.started && !this.helpOpen) this.start();
  }

  private bgTier = 1;
}
