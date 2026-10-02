import Phaser from 'phaser';
import { H, W } from '../core/config';
import type { Rng } from '../core/rng';
import { S } from './textures';

const MARGIN = 8;   // 화면 흔들림 때 가장자리가 비어 보이지 않도록 사방으로 여유

interface Layer { tier: number; imgs: Phaser.GameObjects.Image[]; }

/**
 * 세로 스크롤 배경 + 스테이지 전환 크로스페이드 + 별.
 * 거울 타일링: 홀수 번째 타일을 상하 반전해서 이음새에서 항상 같은 가장자리끼리 맞닿게 한다
 * (원본 위·아래 가장자리가 달라도 끊김 없이 이어진다).
 */
export class ScrollingBackground {
  private scrollY = 0;
  private cur = 1;
  private prev = 0;
  private fade = 1;
  private layers: Layer[] = [];
  private stars: { x: number; y: number; r: number; speed: number; layer: number; img: Phaser.GameObjects.Image }[] = [];

  constructor(private scene: Phaser.Scene, parent: Phaser.GameObjects.Container, rng: Rng) {
    for (let l = 0; l < 2; l++) {
      const imgs: Phaser.GameObjects.Image[] = [];
      for (let i = 0; i < 4; i++) {
        const img = scene.add.image(-MARGIN, 0, 'bg1').setOrigin(0, 0).setVisible(false);
        parent.add(img); imgs.push(img);
      }
      this.layers.push({ tier: 0, imgs });
    }
    // 배경 위에 얹는 어두운 막 (탄환·기체가 잘 보이도록)
    parent.add(scene.add.rectangle(0, 0, W, H, 0x03050a, 0.42).setOrigin(0, 0));
    for (let i = 0; i < 75; i++) {
      const layer = Math.floor(rng() * 3);
      const img = scene.add.image(0, 0, 'star').setScale(S);
      img.setAlpha(layer === 2 ? 0.7 : 0.3);
      if (layer !== 2) img.setTint(0x94a3b8);
      parent.add(img);
      this.stars.push({ x: rng() * W, y: rng() * H, r: rng() * 1.5 + 0.4, speed: rng() * 1.8 + 0.5, layer, img });
    }
  }

  reset(): void { this.scrollY = 0; this.cur = 1; this.prev = 0; this.fade = 1; }

  setTier(tier: number): void {
    if (tier === this.cur) return;
    this.prev = this.cur; this.cur = tier; this.fade = 0;
  }

  /** 60Hz 틱마다 호출 */
  tick(): void {
    this.scrollY += 1.4;
    if (this.fade < 1) { this.fade = Math.min(1, this.fade + 1 / 60); if (this.fade >= 1) this.prev = 0; }
    for (const s of this.stars) { s.y += s.speed * 0.8; if (s.y > H) { s.y = 0; s.x = Math.random() * W; } }
  }

  render(): void {
    const crossfading = this.prev !== 0 && this.fade < 1;
    this.placeLayer(this.layers[0], crossfading ? this.prev : this.cur, 1);
    this.placeLayer(this.layers[1], crossfading ? this.cur : 0, crossfading ? this.fade : 0);
    for (const s of this.stars) s.img.setPosition(s.x, s.y).setScale(S * s.r * 0.8 * 2 / 6 * R_STAR);
  }

  private placeLayer(layer: Layer, tier: number, alpha: number): void {
    if (!tier || alpha <= 0) { layer.imgs.forEach(i => i.setVisible(false)); return; }
    const key = `bg${tier}`;
    const src = this.scene.textures.get(key).getSourceImage() as HTMLImageElement;
    const drawW = W + MARGIN * 2;
    const drawH = Math.max(1, Math.ceil(drawW * (src.height / src.width)));
    this.scrollY %= drawH * 2;   // 원본 + 반전 타일 2장이 한 주기
    let n = 0;
    for (let k = Math.floor(-this.scrollY / drawH) - 1; n < layer.imgs.length; k++) {
      const y = Math.floor(this.scrollY + k * drawH);
      if (y >= H) break;
      if (y + drawH + 1 < 0) continue;
      const img = layer.imgs[n++];
      if (img.texture.key !== key) img.setTexture(key);
      img.setVisible(true).setAlpha(alpha).setPosition(-MARGIN, y).setDisplaySize(drawW, drawH + 1);
      img.setFlipY(((k % 2) + 2) % 2 === 1);
    }
    for (; n < layer.imgs.length; n++) layer.imgs[n].setVisible(false);
    layer.tier = tier;
  }
}

const R_STAR = 1;   // 별 스케일 보정 (6px 텍스처 기준)
