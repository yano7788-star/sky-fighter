import Phaser from 'phaser';
import { H, W } from '../core/config';
import { PILOTS } from '../core/meta';
import { textStyle } from '../render/hud';
import { R } from '../render/textures';
import { audio } from '../systems/audio';
import { loadMeta, saveMeta, type MetaSave } from '../systems/storage';

const CARD_W = 136, CARD_H = 380, GAP = 8, TOP = 120;

/** 파일럿 선택: 에이스(기본) / 언니 / 동생. 크레딧으로 해금하고, 선택한 파일럿의 기체와 패시브로 출격한다 */
export class PilotScene extends Phaser.Scene {
  private meta!: MetaSave;
  private g!: Phaser.GameObjects.Graphics;
  private credits!: Phaser.GameObjects.Text;
  private toast!: Phaser.GameObjects.Text;
  private labels: { state: Phaser.GameObjects.Text }[] = [];

  constructor() { super('PilotScene'); }

  private cardX(i: number): number { return (W - (CARD_W * 3 + GAP * 2)) / 2 + i * (CARD_W + GAP); }

  create(): void {
    this.meta = loadMeta(); this.labels = [];
    const root = this.add.container(0, 0).setScale(R);
    root.add(this.add.rectangle(0, 0, W, H, 0x050a16, 1).setOrigin(0, 0));
    this.g = this.add.graphics(); root.add(this.g);
    root.add(this.add.text(W / 2, 48, 'PILOT', textStyle(34, '#38bdf8')).setOrigin(0.5).setShadow(0, 0, '#0ea5e9', 14, true, true));
    root.add(this.add.text(W / 2, 82, '파일럿마다 기체 색과 패시브가 다릅니다', textStyle(12, '#94a3b8', false)).setOrigin(0.5));
    this.credits = this.add.text(W / 2, 104, '', textStyle(15, '#fde047')).setOrigin(0.5); root.add(this.credits);

    PILOTS.forEach((p, i) => {
      const x = this.cardX(i), cx = x + CARD_W / 2;
      // 초상화(에이스는 기체 이미지)
      const img = this.add.image(cx, TOP + 92, p.portrait);
      const k = Math.min((CARD_W - 18) / img.width, 150 / img.height);
      img.setScale(k); root.add(img);
      root.add(this.add.text(cx, TOP + 186, p.name, textStyle(20, '#f8fafc')).setOrigin(0.5));
      root.add(this.add.text(cx, TOP + 210, p.title, textStyle(10.5, '#94a3b8', false)).setOrigin(0.5));
      root.add(this.add.text(cx, TOP + 232, p.perks.map(t => '• ' + t).join('\n'), { ...textStyle(11, '#cbd5e1', false), wordWrap: { width: CARD_W - 18 }, lineSpacing: 4 }).setOrigin(0.5, 0));
      const state = this.add.text(cx, TOP + CARD_H - 26, '', textStyle(14, '#0b1220')).setOrigin(0.5);
      root.add(state); this.labels.push({ state });
    });
    this.toast = this.add.text(W / 2, H - 120, '', textStyle(14, '#4ade80')).setOrigin(0.5); root.add(this.toast);
    root.add(this.add.text(W / 2, H - 52, '← BACK', textStyle(18, '#cbd5e1')).setOrigin(0.5));

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onTap(p.x / R, p.y / R));
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Backspace') this.back(); });
    this.refresh();
  }

  private back(): void { this.scene.start('TitleScene'); }

  private onTap(x: number, y: number): void {
    audio.unlock();
    if (y > H - 90) { this.back(); return; }
    PILOTS.forEach((p, i) => {
      const cx = this.cardX(i);
      if (x < cx || x > cx + CARD_W || y < TOP || y > TOP + CARD_H) return;
      const owned = this.meta.pilots.owned.includes(p.id);
      if (owned) {
        this.meta.pilots.selected = p.id; saveMeta(this.meta); audio.sfx('item');
        this.toast.setText(`${p.name} 선택!`).setColor('#4ade80');
      } else if (this.meta.credits >= p.cost) {
        this.meta.credits -= p.cost; this.meta.pilots.owned.push(p.id); this.meta.pilots.selected = p.id; saveMeta(this.meta); audio.sfx('heal');
        this.toast.setText(`${p.name} 해금! 바로 선택되었습니다`).setColor('#fde047');
      } else {
        this.toast.setText(`크레딧이 부족합니다 (${p.cost} 필요)`).setColor('#f87171');
      }
      this.refresh();
    });
  }

  private refresh(): void {
    this.credits.setText(`CREDITS  ${this.meta.credits}`);
    const g = this.g; g.clear();
    PILOTS.forEach((p, i) => {
      const x = this.cardX(i), owned = this.meta.pilots.owned.includes(p.id), sel = this.meta.pilots.selected === p.id;
      g.fillStyle(0x0b1426, 1); g.fillRoundedRect(x, TOP, CARD_W, CARD_H, 14);
      g.lineStyle(sel ? 3.5 : 1.5, sel ? 0xfde047 : owned ? 0x38bdf8 : 0x334155, 1); g.strokeRoundedRect(x, TOP, CARD_W, CARD_H, 14);
      const bx = x + 12, by = TOP + CARD_H - 44, bw = CARD_W - 24, bh = 36;
      const can = owned || this.meta.credits >= p.cost;
      g.fillStyle(sel ? 0xfde047 : owned ? 0x38bdf8 : can ? 0x4ade80 : 0x64748b, 1); g.fillRoundedRect(bx, by, bw, bh, 10);
      this.labels[i].state.setText(sel ? '선택됨 ✓' : owned ? '선택' : `해금 ${p.cost} ◆`);
    });
  }
}
