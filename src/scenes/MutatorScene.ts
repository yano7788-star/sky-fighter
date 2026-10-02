import Phaser from 'phaser';
import { H, W } from '../core/config';
import { MUTATORS, mutatorOf, offerMutators, type MutatorId } from '../core/mutators';
import { createRng } from '../core/rng';
import { textStyle } from '../render/hud';
import { R } from '../render/textures';
import { audio } from '../systems/audio';

const CARD_H = 124, TOP = 150, GAP = 12;
const NONE = { y: H - 118, h: 54 };

/** 출격 전 런 모디파이어 선택: 위험을 지고 보상을 키운다. 선택하지 않아도 된다 */
export class MutatorScene extends Phaser.Scene {
  private offers: MutatorId[] = [];
  private started = false;
  private sel = 3;                 // 게임패드 선택 위치: 0~2 = 카드, 3 = 선택 안 함
  private hl!: Phaser.GameObjects.Graphics;
  private readyAt = 0;           // 입력 유예 시각 (이전 화면에서 누르고 있던 키가 바로 선택으로 넘어가는 것 방지)
  private padPrev: Record<string, boolean> = {};

  constructor() { super('MutatorScene'); }

  create(): void {
    this.started = false; this.sel = 3; this.padPrev = {}; this.readyAt = this.time.now + 350;
    this.offers = offerMutators(createRng((Math.random() * 0xffffffff) >>> 0));
    const root = this.add.container(0, 0).setScale(R);
    root.add(this.add.rectangle(0, 0, W, H, 0x050a16, 1).setOrigin(0, 0));
    root.add(this.add.text(W / 2, 54, 'RUN MODIFIER', textStyle(30, '#fbbf24')).setOrigin(0.5).setShadow(0, 0, '#f59e0b', 14, true, true));
    root.add(this.add.text(W / 2, 92, '위험을 지고 보상을 키우세요', textStyle(14, '#cbd5e1', false)).setOrigin(0.5));
    root.add(this.add.text(W / 2, 114, '선택하지 않고 그냥 출격해도 됩니다', textStyle(11, '#64748b', false)).setOrigin(0.5));

    const g = this.add.graphics(); root.add(g);
    this.hl = this.add.graphics(); root.add(this.hl);
    this.offers.forEach((id, i) => {
      const m = mutatorOf(id)!, y = TOP + i * (CARD_H + GAP), col = Phaser.Display.Color.HexStringToColor(m.color).color;
      g.fillStyle(0x0b1426, 1); g.fillRoundedRect(20, y, W - 40, CARD_H, 14);
      g.lineStyle(2, col, 0.9); g.strokeRoundedRect(20, y, W - 40, CARD_H, 14);
      g.fillStyle(col, 0.14); g.fillRoundedRect(20, y, 84, CARD_H, { tl: 14, tr: 0, bl: 14, br: 0 });
      root.add(this.add.text(62, y + CARD_H / 2, m.icon, { fontFamily: 'sans-serif', fontSize: '44px', fontStyle: 'bold', color: m.color, resolution: R }).setOrigin(0.5));
      root.add(this.add.text(120, y + 14, `${i + 1}. ${m.name}`, textStyle(19, '#f8fafc')));
      root.add(this.add.text(120, y + 48, `▼ ${m.risk}`, { ...textStyle(13, '#fca5a5', false), wordWrap: { width: W - 150 } }));
      root.add(this.add.text(120, y + 78, `▲ ${m.reward}`, { ...textStyle(13, '#86efac', false), wordWrap: { width: W - 150 } }));
    });
    g.fillStyle(0x1e293b, 1); g.fillRoundedRect(40, NONE.y, W - 80, NONE.h, 12);
    g.lineStyle(1.5, 0x475569, 1); g.strokeRoundedRect(40, NONE.y, W - 80, NONE.h, 12);
    root.add(this.add.text(W / 2, NONE.y + NONE.h / 2, '선택 안 함 (기본) — Enter', textStyle(16, '#e2e8f0')).setOrigin(0.5));

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onTap(p.x / R, p.y / R));
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      audio.unlock();
      if (e.repeat || this.time.now < this.readyAt) return;   // 키를 계속 누르고 있어도 자동으로 넘어가지 않게
      if (e.key === '1' || e.key === '2' || e.key === '3') this.pick(this.offers[Number(e.key) - 1] ?? null);
      else if (e.key === 'Enter' || e.key === ' ' || e.key === '0') this.pick(null);
      else if (e.key === 'Escape') this.scene.start('TitleScene');
    });
    void MUTATORS;
  }

  private onTap(x: number, y: number): void {
    audio.unlock();
    if (this.time.now < this.readyAt) return;
    if (y >= NONE.y && y <= NONE.y + NONE.h && x > 40 && x < W - 40) { this.pick(null); return; }
    this.offers.forEach((id, i) => {
      const cy = TOP + i * (CARD_H + GAP);
      if (y >= cy && y <= cy + CARD_H && x > 20 && x < W - 20) this.pick(id);
    });
  }

  /** 게임패드: 십자키 위아래로 이동, A 선택, Start 선택 안 함, B 뒤로 */
  update(): void {
    const g = this.hl; g.clear();
    const y = this.sel < 3 ? TOP + this.sel * (CARD_H + GAP) : NONE.y, h = this.sel < 3 ? CARD_H : NONE.h, x = this.sel < 3 ? 20 : 40, w = W - 2 * x;
    g.lineStyle(3, 0xffffff, 0.55 + 0.3 * Math.sin(this.time.now * 0.008)); g.strokeRoundedRect(x - 3, y - 3, w + 6, h + 6, 16);
    const pad = this.input.gamepad?.getPad(0);
    if (!pad || !pad.connected || this.time.now < this.readyAt) return;
    const btn = (i: number) => !!pad.buttons[i]?.pressed;
    const edge = (n: string, down: boolean) => { const was = this.padPrev[n]; this.padPrev[n] = down; return down && !was; };
    const ay = pad.axes[1]?.getValue() ?? 0;
    if (edge('up', btn(12) || ay < -0.6)) this.sel = (this.sel + 3) % 4;
    if (edge('down', btn(13) || ay > 0.6)) this.sel = (this.sel + 1) % 4;
    if (edge('a', btn(0))) this.pick(this.sel < 3 ? this.offers[this.sel] : null);
    if (edge('start', btn(9))) this.pick(null);
    if (edge('b', btn(1))) this.scene.start('TitleScene');
  }

  private pick(id: MutatorId | null): void {
    if (this.started) return;
    this.started = true;
    audio.sfx(id ? 'enrage' : 'item');
    this.scene.start('GameScene', { mutator: id });
  }
}
