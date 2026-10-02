import Phaser from 'phaser';
import { H, W } from '../core/config';
import { MISSION_ALL_BONUS, dailyMissions } from '../core/missions';
import { dayKey } from '../core/mutators';
import { textStyle } from '../render/hud';
import { R } from '../render/textures';
import { audio } from '../systems/audio';
import { loadMissions } from '../systems/storage';

/** 오늘의 미션 3개와 진행도 */
export class MissionScene extends Phaser.Scene {
  constructor() { super('MissionScene'); }

  create(): void {
    const key = dayKey(), list = dailyMissions(key), save = loadMissions(key);
    const root = this.add.container(0, 0).setScale(R);
    root.add(this.add.rectangle(0, 0, W, H, 0x050a16, 1).setOrigin(0, 0));
    root.add(this.add.text(W / 2, 54, 'DAILY MISSIONS', textStyle(28, '#38bdf8')).setOrigin(0.5).setShadow(0, 0, '#0ea5e9', 14, true, true));
    root.add(this.add.text(W / 2, 90, `${key} · 여러 판에 걸쳐 누적됩니다`, textStyle(12, '#94a3b8', false)).setOrigin(0.5));
    const g = this.add.graphics(); root.add(g);
    list.forEach((m, i) => {
      const y = 130 + i * 112, cur = Math.min(m.goal, save.progress[m.id] ?? 0), done = save.done.includes(m.id), k = cur / m.goal;
      g.fillStyle(done ? 0x0b3b2a : 0x0b1426, 1); g.fillRoundedRect(20, y, W - 40, 100, 12);
      g.lineStyle(2, done ? 0x4ade80 : 0x1e293b, 1); g.strokeRoundedRect(20, y, W - 40, 100, 12);
      root.add(this.add.text(36, y + 14, (done ? '✔ ' : '') + m.desc, { ...textStyle(15, done ? '#bbf7d0' : '#f8fafc'), wordWrap: { width: W - 150 } }));
      root.add(this.add.text(W - 36, y + 14, `+${m.reward}`, textStyle(15, done ? '#4ade80' : '#fde047')).setOrigin(1, 0));
      g.fillStyle(0x0f172a, 1); g.fillRoundedRect(36, y + 62, W - 72, 14, 7);
      if (k > 0) { g.fillStyle(done ? 0x4ade80 : 0x38bdf8, 1); g.fillRoundedRect(36, y + 62, Math.max(14, (W - 72) * k), 14, 7); }
      root.add(this.add.text(W / 2, y + 69, `${cur >= 1000 ? cur.toLocaleString() : Math.floor(cur)} / ${m.goal >= 1000 ? m.goal.toLocaleString() : m.goal}`, textStyle(11, '#e2e8f0')).setOrigin(0.5));
    });
    root.add(this.add.text(W / 2, 130 + 3 * 112 + 14, save.bonus ? '★ 전체 완료 보너스 획득!' : `3개 모두 완료하면 보너스 +${MISSION_ALL_BONUS}`, textStyle(14, save.bonus ? '#facc15' : '#94a3b8')).setOrigin(0.5));
    root.add(this.add.text(W / 2, H - 40, '← BACK', textStyle(18, '#cbd5e1')).setOrigin(0.5));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { audio.unlock(); if (p.y / R > H - 80) this.scene.start('TitleScene'); });
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Backspace') this.scene.start('TitleScene'); });
  }
}
