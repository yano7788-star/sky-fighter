import Phaser from 'phaser';
import { H, W } from '../core/config';
import { META_UPGRADES, type MetaId } from '../core/meta';
import { textStyle } from '../render/hud';
import { R } from '../render/textures';
import { audio } from '../systems/audio';
import { loadMeta, saveMeta, type MetaSave } from '../systems/storage';

const ROW_TOP = 150, ROW_H = 84, ROW_W = W - 36;
const BUY = { w: 96, h: 38 };

/** 격납고: 런에서 모은 크레딧으로 영구 강화를 구매한다 */
export class HangarScene extends Phaser.Scene {
  private meta!: MetaSave;
  private g!: Phaser.GameObjects.Graphics;
  private credits!: Phaser.GameObjects.Text;
  private rows: { name: Phaser.GameObjects.Text; desc: Phaser.GameObjects.Text; cost: Phaser.GameObjects.Text }[] = [];
  private toast!: Phaser.GameObjects.Text;

  constructor() { super('HangarScene'); }

  create(): void {
    this.meta = loadMeta(); this.rows = [];
    const root = this.add.container(0, 0).setScale(R);
    root.add(this.add.rectangle(0, 0, W, H, 0x050a16, 1).setOrigin(0, 0));
    this.g = this.add.graphics(); root.add(this.g);
    root.add(this.add.text(W / 2, 54, 'HANGAR', textStyle(34, '#38bdf8')).setOrigin(0.5).setShadow(0, 0, '#0ea5e9', 14, true, true));
    root.add(this.add.text(W / 2, 90, '런이 끝나면 크레딧을 얻고, 여기서 영구 강화를 구매합니다', textStyle(12, '#94a3b8', false)).setOrigin(0.5));
    this.credits = this.add.text(W / 2, 122, '', textStyle(18, '#fde047')).setOrigin(0.5); root.add(this.credits);

    META_UPGRADES.forEach((_u, i) => {
      const y = ROW_TOP + i * (ROW_H + 8);
      const name = this.add.text(36, y + 14, '', textStyle(16, '#f8fafc')).setOrigin(0, 0);
      const desc = this.add.text(36, y + 40, '', { ...textStyle(12, '#94a3b8', false), wordWrap: { width: ROW_W - BUY.w - 50 } }).setOrigin(0, 0);
      const cost = this.add.text(W - 36 - BUY.w / 2, y + ROW_H / 2, '', textStyle(14, '#0b1220')).setOrigin(0.5);
      root.add([name, desc, cost]); this.rows.push({ name, desc, cost });
    });
    this.toast = this.add.text(W / 2, H - 120, '', textStyle(14, '#4ade80')).setOrigin(0.5); root.add(this.toast);
    root.add(this.add.text(W / 2, H - 52, '← BACK', textStyle(18, '#cbd5e1')).setOrigin(0.5));

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onTap(p.x / R, p.y / R));
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Backspace') this.back(); });
    this.refresh();
  }

  private back(): void { this.scene.start('TitleScene'); }

  private buyRect(i: number) {
    const y = ROW_TOP + i * (ROW_H + 8);
    return { x: W - 36 - BUY.w, y: y + (ROW_H - BUY.h) / 2, w: BUY.w, h: BUY.h };
  }

  private onTap(x: number, y: number): void {
    audio.unlock();
    if (y > H - 90) { this.back(); return; }
    META_UPGRADES.forEach((u, i) => {
      const r = this.buyRect(i);
      if (x >= r.x - 6 && x <= r.x + r.w + 6 && y >= r.y - 6 && y <= r.y + r.h + 6) this.buy(u.id);
    });
  }

  private buy(id: MetaId): void {
    const u = META_UPGRADES.find(m => m.id === id)!;
    const lvNow = this.meta.levels[id] ?? 0;
    if (lvNow >= u.max) return;
    const cost = u.cost(lvNow);
    if (this.meta.credits < cost) { this.toast.setText('크레딧이 부족합니다').setColor('#f87171'); return; }
    this.meta.credits -= cost; this.meta.levels[id] = lvNow + 1; saveMeta(this.meta);
    audio.sfx('item');
    this.toast.setText(`${u.name} Lv${lvNow + 1} 구매!`).setColor('#4ade80');
    this.refresh();
  }

  private refresh(): void {
    this.credits.setText(`CREDITS  ${this.meta.credits}`);
    const g = this.g; g.clear();
    META_UPGRADES.forEach((u, i) => {
      const y = ROW_TOP + i * (ROW_H + 8), l = this.meta.levels[u.id] ?? 0, maxed = l >= u.max;
      g.fillStyle(0x0b1426, 1); g.fillRoundedRect(18, y, ROW_W, ROW_H, 12);
      g.lineStyle(1.5, 0x1e3a5f, 1); g.strokeRoundedRect(18, y, ROW_W, ROW_H, 12);
      for (let k = 0; k < u.max; k++) {   // 레벨 표시 점
        g.fillStyle(k < l ? 0x38bdf8 : 0x1e293b, 1); g.fillCircle(36 + k * 14, y + ROW_H - 12, 4.5);
      }
      const r = this.buyRect(i), can = !maxed && this.meta.credits >= u.cost(l);
      g.fillStyle(maxed ? 0x334155 : can ? 0xfde047 : 0x64748b, 1); g.fillRoundedRect(r.x, r.y, r.w, r.h, 10);
      const row = this.rows[i];
      row.name.setText(`${u.icon} ${u.name}   Lv ${l}/${u.max}`);
      row.desc.setText(maxed ? `${u.desc(l)}  (최대)` : `${u.desc(l)}  →  ${u.desc(l + 1)}`);
      row.cost.setText(maxed ? 'MAX' : `${u.cost(l)} ◆`).setColor(maxed ? '#94a3b8' : '#0b1220');
    });
  }
}
