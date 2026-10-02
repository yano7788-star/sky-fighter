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

/**
 * 패럴랙스 오버레이: 배경보다 훨씬 빠르게 흐르는 반투명 구름 줄기 2겹.
 * 배경 스크롤과 속도 차이가 나서 깊이감(속도감)이 생긴다. 스테이지마다 색조가 바뀐다.
 * 이미지 위·아래 가장자리가 비어 있어 거울 타일링해도 이음새가 보이지 않는다.
 */
const OVERLAY_TINT = [0xffffff, 0xffffff, 0xffd9b0, 0xffe9a8, 0xffb8a8, 0xd9bcff];   // 인덱스 = 스테이지

export class ParallaxOverlay {
  private layers: { imgs: Phaser.GameObjects.Image[]; speed: number; scroll: number; alpha: number; scale: number; flipX: boolean; xOff: number }[] = [];
  private tier = 1;

  constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container) {
    const defs = [
      // scale>=1.3 이고 |xOff| <= (scale-1)*W/2 라서 이미지의 좌우 끝이 항상 화면 밖에 있다 (끝이 잘려 보이는 문제 방지)
      { speed: 2.7, alpha: 0.55, scale: 1.3, flipX: false, xOff: -35 },
      { speed: 4.1, alpha: 0.38, scale: 1.45, flipX: true, xOff: 55 },
    ];
    for (const d of defs) {
      const imgs: Phaser.GameObjects.Image[] = [];
      for (let i = 0; i < 3; i++) { const img = scene.add.image(0, 0, 'overlay_clouds').setOrigin(0, 0).setVisible(false); parent.add(img); imgs.push(img); }
      this.layers.push({ imgs, scroll: Math.random() * 1000, ...d });
    }
    this.setStage(1);
  }

  setStage(tier: number): void {
    this.tier = tier;
    const c = OVERLAY_TINT[Math.min(tier, OVERLAY_TINT.length - 1)];
    for (const l of this.layers) l.imgs.forEach(i => i.setTint(c));
  }
  stage(): number { return this.tier; }

  tick(): void { for (const l of this.layers) l.scroll += l.speed; }

  render(): void {
    for (const l of this.layers) {
      const first = l.imgs[0];
      const drawW = W * l.scale, drawH = Math.ceil(drawW * (first.frame.height / first.frame.width));
      const period = drawH * 2;
      const sc = ((l.scroll % period) + period) % period;
      let n = 0;
      for (let k = Math.floor(-sc / drawH) - 1; n < l.imgs.length; k++) {
        const y = Math.floor(sc + k * drawH);
        if (y >= H) break;
        if (y + drawH < 0) continue;
        const img = l.imgs[n++];
        img.setVisible(true).setAlpha(l.alpha).setPosition(l.xOff - (drawW - W) / 2, y).setDisplaySize(drawW, drawH)
          .setFlipY(((k % 2) + 2) % 2 === 1).setFlipX(l.flipX);
      }
      for (; n < l.imgs.length; n++) l.imgs[n].setVisible(false);
    }
  }
}
