import Phaser from 'phaser';
import { H, W } from '../core/config';
import { TAGLINE, VERSION } from '../branding';
import { dailyMutator, dayKey, mutatorOf } from '../core/mutators';
import { FONT, textStyle } from '../render/hud';
import { R, S } from '../render/textures';
import { audio } from '../systems/audio';
import { loadBest, loadMeta } from '../systems/storage';

const START = { x: W / 2, y: H * 0.8, w: 300, h: 60 };
const DAILY = { x: W / 2, y: H * 0.8 - 52, w: 300, h: 34 };
const HELP = { x: W / 2 + 125, y: H * 0.8 + 62, w: 120, h: 34 };
const HANGAR = { x: W / 2 - 125, y: H * 0.8 + 62, w: 120, h: 34 };
const PILOT = { x: W / 2, y: H * 0.8 + 62, w: 110, h: 34 };
const SOUND = { x: W - 34, y: 34, r: 24 };

const HELP_TEXT = [
  ['조작', '#38bdf8'],
  ['터치·마우스: 누른 채 드래그 = 이동 + 자동 발사\n오른쪽 아래 = 폭탄 · 왼쪽 아래 = 필살기/동료', '#e2e8f0'],
  ['키보드: 방향키/WASD 이동 · Space 발사 · B 폭탄\nR 필살기 · Q 고양이 · E 강아지 · P 일시정지 · M 음소거', '#e2e8f0'],
  ['게임패드: 스틱 이동 · A 발사 · B 폭탄 · Y 필살기 · LB/LT 동료', '#e2e8f0'],
  ['성장 (이번 런 한정)', '#38bdf8'],
  ['적을 잡으면 청록 젬이 떨어집니다 → 모으면 레벨업 → 카드 3장 중 1장 선택\n산탄·관통·유도·드론·레이저를 키우고, 두 모듈이 Lv3이 되면 ★융합 카드(스웜/레일건/헌터)가 등장!', '#e2e8f0'],
  ['스킬', '#38bdf8'],
  ['필살기: 처치·그레이즈로 게이지 충전. 에이스=자매의 손바닥(화면 강타) · 언니=미사일 포격 · 동생=시간 정지\n동료 아이템(C/D): 고양이=8초 흡혈+유도탄 · 강아지=8초 방어막 (스테이지당 1회)\n폭탄: 탄 전부 제거 + 보스 큰 피해 + 1.5초 무적', '#e2e8f0'],
  ['아이템 · 요령', '#38bdf8'],
  ['P 파워업 · M 유도미사일 · E 에너지 · B 폭탄 · G 자석 · L 목숨\n연속 처치 콤보 / 탄을 스치는 그레이즈 / 무피격 클리어 S랭크 보너스\n격납고(HANGAR)에서 크레딧으로 영구 강화 · 파일럿(PILOT)에서 자매 해금', '#e2e8f0'],
] as const;

export class TitleScene extends Phaser.Scene {
  private started = false;
  private btn!: Phaser.GameObjects.Graphics;
  private jet!: Phaser.GameObjects.Image;
  private shots: { img: Phaser.GameObjects.Image; y: number }[] = [];
  private art!: Phaser.GameObjects.Image;
  private helpGroup: Phaser.GameObjects.GameObject[] = [];
  private helpOpen = false;
  private muteText!: Phaser.GameObjects.Text;

  constructor() { super('TitleScene'); }

  create(): void {
    this.started = false; this.helpOpen = false;
    this.shots = []; this.helpGroup = [];
    const root = this.add.container(0, 0).setScale(R);

    // 배경: 타이틀 키아트 (화면을 꽉 채우도록 cover)
    this.art = this.add.image(W / 2, H / 2, 'title_bg');
    this.art.setScale(Math.max(W / this.art.width, H / this.art.height) * 1.04);
    root.add(this.art);

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
    this.jet.setDisplaySize(120, (120 * this.jet.height) / this.jet.width);
    root.add(this.jet);

    // 로고 (이미지)
    const logo = this.add.image(W / 2, H * 0.17, 'logo');
    logo.setDisplaySize(W * 0.84, (W * 0.84 * logo.height) / logo.width);
    root.add(logo);
    root.add(this.add.text(W / 2, H * 0.17 + logo.displayHeight / 2 + 18, TAGLINE, { ...textStyle(12, '#cbd5e1', false), wordWrap: { width: W - 60 }, align: 'center' }).setOrigin(0.5).setShadow(0, 0, '#000', 6, true, true));

    // 버튼
    this.btn = this.add.graphics(); root.add(this.btn);
    root.add(this.add.text(START.x, START.y, 'START MISSION', textStyle(24, '#f8fafc')).setOrigin(0.5).setShadow(0, 0, '#0ea5e9', 8, true, true));
    root.add(this.add.text(HELP.x, HELP.y, '? HOW TO PLAY', textStyle(13, '#94a3b8')).setOrigin(0.5));
    root.add(this.add.text(HANGAR.x, HANGAR.y, '⚙ HANGAR', textStyle(13, '#fde047')).setOrigin(0.5));
    root.add(this.add.text(PILOT.x, PILOT.y, '✈ PILOT', textStyle(13, '#7dd3fc')).setOrigin(0.5));
    const dm = mutatorOf(dailyMutator(dayKey()));
    root.add(this.add.text(DAILY.x, DAILY.y, `📅 일일 도전 · ${dm ? dm.name : ''}`, textStyle(14, '#fbbf24')).setOrigin(0.5).setShadow(0, 0, '#000', 6, true, true));

    const best = loadBest();
    root.add(this.add.text(W / 2, H * 0.935, (best.score > 0 ? `BEST ${best.score}  ·  STAGE ${best.stage}` : 'NO RECORD YET') + `   ·   CREDITS ${loadMeta().credits}`, textStyle(13, '#94a3b8')).setOrigin(0.5));
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
      else if (e.key.toLowerCase() === 'g') this.scene.start('HangarScene');
      else if (e.key.toLowerCase() === 'o') this.scene.start('PilotScene');
      else if (e.key.toLowerCase() === 'd') { this.started = true; this.scene.start('GameScene', { daily: true }); }
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
    if (Math.abs(x - DAILY.x) < DAILY.w / 2 && Math.abs(y - DAILY.y) < DAILY.h / 2 + 4) { this.started = true; audio.unlock(); this.scene.start('GameScene', { daily: true }); return; }
    if (Math.abs(x - PILOT.x) < PILOT.w / 2 && Math.abs(y - PILOT.y) < PILOT.h / 2 + 6) { this.scene.start('PilotScene'); return; }
    if (Math.abs(x - HANGAR.x) < HANGAR.w / 2 && Math.abs(y - HANGAR.y) < HANGAR.h / 2 + 6) { this.scene.start('HangarScene'); return; }
    this.start();   // 화면 어디를 눌러도 시작 (모바일 편의)
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    audio.unlock();    // 사용자 제스처 안에서 오디오 잠금 해제
    this.scene.start('MutatorScene');
  }

  update(time: number): void {
    this.art.setScale(Math.max(W / this.art.width, H / this.art.height) * (1.04 + Math.sin(time * 0.0004) * 0.012));   // 아주 느리게 숨 쉬는 배경

    // 전투기 부유 + 엔진 불꽃
    const bob = Math.sin(time * 0.002) * 6;
    this.jet.setY(H * 0.58 + bob);
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

}
