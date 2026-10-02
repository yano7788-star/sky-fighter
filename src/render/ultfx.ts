import Phaser from 'phaser';
import { H, W } from '../core/config';
import { ULT } from '../core/data';
import type { Sim } from '../core/sim';
import { R } from './textures';

const easeOutBack = (x: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

/**
 * 궁극기 「자매의 손바닥」 연출: 컷인 카드(skill_card) → 작은 손바닥들이 쏟아지고 거대한 손바닥이 화면 전체로 낙하(skill_palm) → 충격파·섬광.
 * 시뮬레이션의 ult.phase / ult.t 를 읽어 그리기만 한다.
 */
export class UltFx {
  private root: Phaser.GameObjects.Container;
  private g: Phaser.GameObjects.Graphics;
  private dim: Phaser.GameObjects.Rectangle;
  private flash: Phaser.GameObjects.Rectangle;
  private card: Phaser.GameObjects.Image;
  private glow: Phaser.GameObjects.Image;
  private palms: Phaser.GameObjects.Image[] = [];

  constructor(scene: Phaser.Scene, ui: Phaser.GameObjects.Container) {
    this.root = scene.add.container(0, 0).setVisible(false);
    ui.add(this.root);
    this.dim = scene.add.rectangle(0, 0, W, H, 0x02060e, 0).setOrigin(0, 0);
    this.g = scene.add.graphics();
    this.glow = scene.add.image(W / 2, H * 0.48, 'dot').setTint(0x67e8f9).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    this.card = scene.add.image(W / 2, H * 0.48, 'skill_card_soft');
    this.root.add([this.dim, this.g, this.glow, this.card]);
    for (let i = 0; i < 10; i++) { const p = scene.add.image(0, 0, 'skill_palm').setVisible(false); this.palms.push(p); this.root.add(p); }
    this.flash = scene.add.rectangle(0, 0, W, H, 0xffffff, 0).setOrigin(0, 0);
    this.root.add(this.flash);
    void R;
  }

  private palm(i: number, cx: number, cy: number, h: number, alpha: number, rot: number): void {
    const p = this.palms[i];
    const w = (h * p.frame.width) / p.frame.height;
    p.setVisible(true).setPosition(cx, cy).setDisplaySize(w, h).setAlpha(Math.max(0, Math.min(1, alpha))).setRotation(rot);
  }

  render(sim: Sim): void {
    const phase = sim.ult.phase, t = sim.ult.t;
    if (phase === 'IDLE') { this.root.setVisible(false); return; }
    this.root.setVisible(true);
    const g = this.g; g.clear();
    this.glow.setAlpha(0);
    this.palms.forEach(p => p.setVisible(false));
    this.card.setVisible(false); this.flash.setAlpha(0);

    if (phase === 'CUTIN') {
      const T = ULT.frames.CUTIN;
      this.dim.setFillStyle(0x02060e, 0.82 * Math.min(1, t / 14));
      // 천천히 도는 빛줄기
      g.fillStyle(0x67e8f9, 0.1 * Math.min(1, t / 20));
      for (let i = 0; i < 14; i++) {
        const a = t * 0.004 + (i * Math.PI * 2) / 14;
        const cx = W / 2, cy = H * 0.48, L = H * 1.2;
        g.fillTriangle(cx, cy, cx + Math.sin(a - 0.07) * L, cy - Math.cos(a - 0.07) * L, cx + Math.sin(a + 0.07) * L, cy - Math.cos(a + 0.07) * L);
      }
      const inK = Math.min(1, t / 18), out = Math.max(0, Math.min(1, (T - t) / 16));
      const sc = Math.min((W * 0.86) / this.card.frame.width, (H * 0.8) / this.card.frame.height);
      const s = (0.8 + 0.2 * easeOutBack(inK)) * (1 + (0.025 * t) / T) * sc;
      this.card.setVisible(true).setScale(s).setAlpha(Math.min(1, t / 10) * out).setPosition(W / 2, H * 0.48 + (1 - inK) * 36);
      // 카드 뒤의 은은한 청록 후광 (딱딱한 테두리 대신)
      const ch = this.card.frame.height * s;
      this.glow.setPosition(W / 2, this.card.y).setDisplaySize(ch * 0.95, ch * 1.2).setAlpha(0.3 * Math.min(1, t / 14) * out);
    } else if (phase === 'FALL') {
      const T = ULT.frames.FALL, k = t / T, fall = Math.pow(k, 2.2);
      this.dim.setFillStyle(0x02060e, 0.82 - 0.27 * k);
      for (let i = 0; i < 8; i++) {   // 작은 손바닥들이 먼저 쏟아진다
        const lt = t - i * 4; if (lt < 0 || lt > 34) continue;
        const kk = lt / 34;
        this.palm(i, (W * (i + 0.5)) / 8 + Math.sin(i * 2.1) * 14, -80 + (H + 160) * kk * kk, 90 + (i % 3) * 22, 0.55, Math.sin(i) * 0.4);
      }
      const bigH = H * 1.05, sc = 0.45 + 0.55 * fall;   // 거대한 손바닥이 멀리서 → 가까이
      const cy = -bigH * 0.6 + (H * 0.52 + bigH * 0.6) * fall, rot = -0.3 * (1 - fall);
      this.palm(8, W / 2 + Math.sin(k * 6) * 10 * (1 - fall), cy, bigH * sc, 0.55 + 0.45 * fall, rot);
    } else {   // IMPACT
      const k = t / ULT.frames.IMPACT, bigH = H * 1.05;
      this.dim.setFillStyle(0x02060e, Math.max(0, 0.55 * (1 - t / 30)));
      this.palm(9, W / 2, H * 0.52 + t * 0.5, bigH * (1 + 0.05 * k), t < 10 ? 1 : 1 - (t - 10) / 42, 0);
      for (let i = 0; i < 3; i++) {   // 충격파
        const rt = t - i * 5; if (rt < 0) continue;
        g.lineStyle(Math.max(1, 9 - rt * 0.2), 0xa5f3fc, Math.max(0, 0.7 - rt / 38));
        g.strokeCircle(W / 2, H * 0.55, rt * 14);
      }
      this.flash.setAlpha(Math.max(0, 0.95 - t / 14));
    }
  }
}
