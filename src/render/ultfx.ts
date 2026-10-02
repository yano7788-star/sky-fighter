import Phaser from 'phaser';
import { H, W } from '../core/config';
import { ULT, ULT_KIND } from '../core/data';
import type { Sim } from '../core/sim';
import { textStyle } from './hud';
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
  private portrait: Phaser.GameObjects.Image;
  private pGlow: Phaser.GameObjects.Image;
  private title: Phaser.GameObjects.Text;
  private sub: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, ui: Phaser.GameObjects.Container) {
    this.root = scene.add.container(0, 0).setVisible(false);
    ui.add(this.root);
    this.dim = scene.add.rectangle(0, 0, W, H, 0x02060e, 0).setOrigin(0, 0);
    this.g = scene.add.graphics();
    this.glow = scene.add.image(W / 2, H * 0.48, 'dot').setTint(0x67e8f9).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    this.card = scene.add.image(W / 2, H * 0.48, 'skill_card_soft');
    this.root.add([this.dim, this.g, this.glow, this.card]);
    for (let i = 0; i < 10; i++) { const p = scene.add.image(0, 0, 'skill_palm').setVisible(false); this.palms.push(p); this.root.add(p); }
    // 언니/동생 궁극기 컷인용: 초상화 + 후광 + 기술 이름
    this.pGlow = scene.add.image(W / 2, H * 0.5, 'dot').setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setVisible(false);
    this.portrait = scene.add.image(W / 2, H * 0.5, 'pilot1').setVisible(false);
    this.title = scene.add.text(W / 2, H * 0.78, '', { ...textStyle(40, '#ffffff'), stroke: '#02060e', strokeThickness: 6 }).setOrigin(0.5).setVisible(false);
    this.sub = scene.add.text(W / 2, H * 0.7, '', textStyle(16, '#e2e8f0')).setOrigin(0.5).setVisible(false);
    this.root.add([this.pGlow, this.portrait, this.sub, this.title]);
    this.flash = scene.add.rectangle(0, 0, W, H, 0xffffff, 0).setOrigin(0, 0);
    this.root.add(this.flash);
    void R;
  }

  private palm(i: number, cx: number, cy: number, h: number, alpha: number, rot: number): void {
    const p = this.palms[i];
    const w = (h * p.frame.width) / p.frame.height;
    p.setVisible(true).setPosition(cx, cy).setDisplaySize(w, h).setAlpha(Math.max(0, Math.min(1, alpha))).setRotation(rot);
  }

  /** 언니(미사일 포격) / 동생(시간 정지): 초상화 컷인 → 지속 효과 표시 */
  private renderPilot(sim: Sim): void {
    const { phase, t, kind } = sim.ult, g = this.g, k = ULT_KIND[kind];
    const cfg = kind === 'barrage'
      ? { tex: 'pilot1', name: k.name, owner: '언니', col: 0xfb923c, css: '#fdba74', dir: -1 }
      : { tex: 'pilot2', name: k.name, owner: '동생', col: 0x38bdf8, css: '#7dd3fc', dir: 1 };
    if (phase === 'CUTIN') {
      const T = k.cutin, inK = Math.min(1, t / 16), out = Math.max(0, Math.min(1, (T - t) / 12));
      this.dim.setFillStyle(0x02060e, 0.82 * Math.min(1, t / 10));
      g.lineStyle(3, cfg.col, 0.42 * Math.min(1, t / 12) * out);   // 흐르는 사선 스피드 라인
      for (let i = 0; i < 16; i++) {
        const y = ((i * 91 + t * 30) % (H + 240)) - 120;
        g.beginPath(); g.moveTo(-60, y); g.lineTo(W + 60, y - 240 * cfg.dir * -1); g.strokePath();
      }
      const targetX = cfg.dir < 0 ? W * 0.38 : W * 0.62, startX = cfg.dir < 0 ? -W * 0.35 : W * 1.35;
      const ease = 1 - Math.pow(1 - inK, 3), ph = H * 0.78;
      this.portrait.setTexture(cfg.tex).setVisible(true).setAlpha(out).setPosition(startX + (targetX - startX) * ease, H * 0.5);
      this.portrait.setDisplaySize((ph * this.portrait.frame.width) / this.portrait.frame.height, ph);
      this.pGlow.setVisible(true).setTint(cfg.col).setPosition(this.portrait.x, H * 0.5).setDisplaySize(ph * 0.9, ph * 1.1).setAlpha(0.35 * out * inK);
      const slam = Math.min(1, Math.max(0, (t - 14) / 8));
      this.title.setVisible(slam > 0).setText(cfg.name).setFontSize(40).setColor(cfg.css).setAlpha(out).setScale(2.4 - 1.4 * slam).setPosition(W / 2, H * 0.8);
      this.sub.setVisible(slam > 0).setText(`${cfg.owner}의 궁극기`).setAlpha(out * slam).setPosition(W / 2, H * 0.73);
    } else {   // ACTIVE
      const remain = Math.max(0, ('active' in k ? k.active : 0) - t) / 60, pulse = 0.5 + 0.5 * Math.sin(t * 0.2);
      this.dim.setFillStyle(0x02060e, 0);
      if (kind === 'barrage') {   // 화면 가장자리가 주황으로 맥동
        g.fillStyle(cfg.col, 0.08 + 0.1 * pulse);
        g.fillRect(0, 0, W, 22); g.fillRect(0, H - 22, W, 22); g.fillRect(0, 0, 18, H); g.fillRect(W - 18, 0, 18, H);
      } else {   // 시간 정지: 푸른 막 + 시계 문양
        g.fillStyle(0x1d4ed8, 0.1); g.fillRect(0, 0, W, H);
        const cx = W / 2, cy = H * 0.5, r = 150 + Math.sin(t * 0.08) * 6;
        g.lineStyle(3, 0x7dd3fc, 0.5); g.strokeCircle(cx, cy, r); g.lineStyle(1.5, 0xbae6fd, 0.35); g.strokeCircle(cx, cy, r - 14);
        for (let i = 0; i < 12; i++) { const a = (i * Math.PI) / 6; g.lineStyle(i % 3 === 0 ? 4 : 2, 0xbae6fd, 0.55); g.beginPath(); g.moveTo(cx + Math.sin(a) * (r - 10), cy - Math.cos(a) * (r - 10)); g.lineTo(cx + Math.sin(a) * (r + 6), cy - Math.cos(a) * (r + 6)); g.strokePath(); }
        const ha = -t * 0.12; g.lineStyle(3, 0xe0f2fe, 0.7); g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(ha) * (r - 22), cy - Math.cos(ha) * (r - 22)); g.strokePath();
      }
      void remain;   // 남은 시간은 HUD의 필살기 버튼 링/라벨에 표시 (보스·HUD와 겹치지 않게)
    }
  }

  /** 일시정지·카드 선택·결과 화면 중에는 궁극기 연출이 위를 덮지 않도록 숨긴다 */
  hide(): void { this.root.setVisible(false); }

  render(sim: Sim): void {
    const phase = sim.ult.phase, t = sim.ult.t;
    if (phase === 'IDLE') { this.root.setVisible(false); return; }
    this.root.setVisible(true);
    const g = this.g; g.clear();
    this.glow.setAlpha(0);
    this.palms.forEach(p => p.setVisible(false));
    this.card.setVisible(false); this.flash.setAlpha(0);
    this.portrait.setVisible(false); this.pGlow.setVisible(false); this.title.setVisible(false); this.sub.setVisible(false);
    if (sim.ult.kind !== 'palm') { this.renderPilot(sim); return; }

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
