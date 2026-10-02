import Phaser from 'phaser';
import { H, W } from '../core/config';
import { textStyle } from '../render/hud';
import { R } from '../render/textures';
import { audio } from '../systems/audio';
import { loadBest } from '../systems/storage';

export class TitleScene extends Phaser.Scene {
  private btn!: Phaser.GameObjects.Graphics;
  private started = false;

  constructor() { super('TitleScene'); }

  create(): void {
    this.started = false;
    const root = this.add.container(0, 0).setScale(R);

    // 시작 화면 이미지: 화면을 꽉 채우도록(cover) 배치
    const img = this.add.image(W / 2, H / 2, 'Startscreen');
    const k = Math.max(W / img.width, H / img.height);
    img.setScale(k);
    root.add(img);

    this.btn = this.add.graphics();
    root.add(this.btn);

    const best = loadBest();
    if (best.score > 0) {
      root.add(this.add.text(W / 2, H * 0.955, `BEST ${best.score}  ·  STAGE ${best.stage}`, textStyle(13, '#94a3b8')).setOrigin(0.5));
    }

    const start = () => {
      if (this.started) return;
      this.started = true;
      audio.unlock();          // 사용자 제스처 안에서 오디오 잠금 해제
      this.scene.start('GameScene');
    };
    this.input.on('pointerdown', start);
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') start(); });
  }

  update(time: number): void {
    // 시작 버튼 펄스 외곽선
    const pulse = 0.5 + Math.sin(time * 0.006) * 0.5;
    const bw = Math.min(W * 0.72, 320), bh = 58, bx = (W - bw) / 2, by = H * 0.84;
    this.btn.clear();
    this.btn.lineStyle(3, 0x38bdf8, 0.4 + pulse * 0.6);
    this.btn.strokeRoundedRect(bx, by, bw, bh, 12);

    const pad = this.input.gamepad?.getPad(0);
    if (pad && (pad.buttons[0]?.pressed || pad.buttons[9]?.pressed) && !this.started) {
      this.started = true; audio.unlock(); this.scene.start('GameScene');
    }
  }
}
