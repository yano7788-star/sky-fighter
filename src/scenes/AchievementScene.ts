import Phaser from 'phaser';
import { H, W } from '../core/config';
import { ACHIEVEMENTS } from '../core/achievements';
import { textStyle } from '../render/hud';
import { R } from '../render/textures';
import { audio } from '../systems/audio';
import { loadAch } from '../systems/storage';

const TOP = 116, ROW_H = 38;

/** 업적 목록: 달성하면 크레딧 보상(한 번만) */
export class AchievementScene extends Phaser.Scene {
  constructor() { super('AchievementScene'); }

  create(): void {
    const have = loadAch();
    const root = this.add.container(0, 0).setScale(R);
    root.add(this.add.rectangle(0, 0, W, H, 0x050a16, 1).setOrigin(0, 0));
    root.add(this.add.text(W / 2, 46, 'ACHIEVEMENTS', textStyle(30, '#fbbf24')).setOrigin(0.5).setShadow(0, 0, '#f59e0b', 14, true, true));
    root.add(this.add.text(W / 2, 84, `${have.length} / ${ACHIEVEMENTS.length} 달성`, textStyle(14, '#94a3b8', false)).setOrigin(0.5));
    const g = this.add.graphics(); root.add(g);
    ACHIEVEMENTS.forEach((a, i) => {
      const y = TOP + i * ROW_H, done = have.includes(a.id);
      g.fillStyle(done ? 0x3b2f0a : 0x0b1426, 1); g.fillRoundedRect(16, y, W - 32, ROW_H - 4, 8);
      g.lineStyle(1.5, done ? 0xfbbf24 : 0x1e293b, 1); g.strokeRoundedRect(16, y, W - 32, ROW_H - 4, 8);
      root.add(this.add.text(40, y + (ROW_H - 4) / 2, done ? a.icon : '🔒', { fontFamily: 'sans-serif', fontSize: '18px', resolution: R }).setOrigin(0.5));
      root.add(this.add.text(66, y + 4, a.name, textStyle(13, done ? '#fde68a' : '#94a3b8')));
      root.add(this.add.text(66, y + 20, a.desc, textStyle(10.5, done ? '#cbd5e1' : '#64748b', false)));
      root.add(this.add.text(W - 28, y + (ROW_H - 4) / 2, `+${a.reward}`, textStyle(12, done ? '#4ade80' : '#475569')).setOrigin(1, 0.5));
    });
    root.add(this.add.text(W / 2, H - 40, '← BACK', textStyle(18, '#cbd5e1')).setOrigin(0.5));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { audio.unlock(); if (p.y / R > H - 80) this.scene.start('TitleScene'); });
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Backspace') this.scene.start('TitleScene'); });
  }
}
