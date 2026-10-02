import Phaser from 'phaser';
import { textStyle } from './hud';
import { S } from './textures';

interface Particle { x: number; y: number; vx: number; vy: number; r: number; alpha: number; color: number; }
interface Ring { x: number; y: number; r: number; max: number; color: number; a: number; }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; len: number; color: number; }
interface Blob { x: number; y: number; size: number; life: number; max: number; color: number; }
interface Pop { x: number; y: number; life: number; max: number; text: string; color: string; size: number; }

const MAX_PARTICLES = 700;
const hex = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;

/** 폭발 파티클 + 충격 링 + 스파크 + 섬광 + 점수 팝업 (순수 연출 — 시뮬레이션 규칙과 무관) */
export class Fx {
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private sparks: Spark[] = [];
  private blobs: Blob[] = [];
  private pops: Pop[] = [];
  private pool: Phaser.GameObjects.Image[] = [];
  private sparkPool: Phaser.GameObjects.Image[] = [];
  private blobPool: Phaser.GameObjects.Image[] = [];
  private popPool: Phaser.GameObjects.Text[] = [];
  private gfx: Phaser.GameObjects.Graphics;
  private boomPool: Phaser.GameObjects.Sprite[] = [];

  constructor(private scene: Phaser.Scene, private parent: Phaser.GameObjects.Container) {
    this.gfx = scene.add.graphics();
    parent.add(this.gfx);
  }

  clear(): void {
    this.particles.length = 0; this.rings.length = 0; this.sparks.length = 0; this.blobs.length = 0; this.pops.length = 0;
    this.boomPool.forEach(b => { b.stop(); b.setVisible(false); });
  }

  /** 스프라이트 폭발: 파티클이 많은 폭발(count>=10)에만 곁들인다. 크기는 count에 비례 */
  private boomSprite(x: number, y: number, count: number): void {
    let sp = this.boomPool.find(b => !b.visible);
    if (!sp) {
      if (this.boomPool.length >= 16) return;
      sp = this.scene.add.sprite(0, 0, 'explosion'); this.parent.add(sp); this.boomPool.push(sp);
      sp.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sp!.setVisible(false));
    }
    const size = Math.max(44, Math.min(170, 22 + count * 3.1));
    sp.setVisible(true).setPosition(x, y).setDisplaySize(size, size).setRotation(Math.random() * Math.PI * 2).setAlpha(0.95);
    sp.play('explosion');
  }

  explosion(x: number, y: number, color: string, count: number): void {
    if (count >= 10) this.boomSprite(x, y, count);
    const c = hex(color);
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const ang = Math.random() * Math.PI * 2, spd = Math.random() * 5 + 2;
      this.particles.push({ x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, r: Math.random() * 3 + 1.5, alpha: 1, color: c });
    }
  }
  trail(x: number, y: number, color: string): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({ x, y, vx: (Math.random() - 0.5) * 1.5, vy: (Math.random() - 0.5) * 1.5, r: 2, alpha: 0.8, color: hex(color) });
  }
  ring(x: number, y: number, color: string, max: number): void {
    this.rings.push({ x, y, r: 4, max, color: hex(color), a: 1 });
  }

  /** 속도 방향으로 늘어나는 날카로운 불꽃 줄기 (착탄 순간의 타격감) */
  sparkBurst(x: number, y: number, color: string, count: number): void {
    const c = hex(color);
    for (let i = 0; i < count && this.sparks.length < 160; i++) {
      const a = Math.random() * Math.PI * 2, sp = 5 + Math.random() * 9, life = 10 + Math.random() * 10;
      this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, len: 5 + Math.random() * 9, color: c });
    }
  }

  /** 짧게 번쩍이는 둥근 섬광 (가산 합성) */
  flashBlob(x: number, y: number, size: number, color = 0xffffff): void {
    if (this.blobs.length < 24) this.blobs.push({ x, y, size, life: 9, max: 9, color });
  }

  /** 떠오르며 사라지는 숫자 팝업 (처치 점수 등) */
  pop(x: number, y: number, text: string, color = '#ffffff', size = 14): void {
    if (this.pops.length >= 14) this.pops.shift();
    this.pops.push({ x, y, life: 46, max: 46, text, color, size });
  }

  /** 60Hz 틱마다 */
  tick(): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx; p.y += p.vy; p.alpha -= 0.035;
      if (p.alpha <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const g = this.rings[i];
      g.r += (g.max - g.r) * 0.18 + 1; g.a -= 0.05;
      if (g.a <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.x += s.vx; s.y += s.vy; s.vx *= 0.9; s.vy *= 0.9; s.vy += 0.15;
      if (--s.life <= 0) this.sparks.splice(i, 1);
    }
    for (let i = this.blobs.length - 1; i >= 0; i--) if (--this.blobs[i].life <= 0) this.blobs.splice(i, 1);
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i]; p.y -= 0.9; if (--p.life <= 0) this.pops.splice(i, 1);
    }
  }

  private img(pool: Phaser.GameObjects.Image[], n: number, additive: boolean): Phaser.GameObjects.Image {
    let img = pool[n];
    if (!img) { img = this.scene.add.image(0, 0, 'dot'); if (additive) img.setBlendMode(Phaser.BlendModes.ADD); this.parent.add(img); pool.push(img); }
    return img;
  }

  render(): void {
    let n = 0;
    for (const p of this.particles) {
      const img = this.img(this.pool, n++, false);
      img.setVisible(true).setPosition(p.x, p.y).setAlpha(Math.max(0, p.alpha)).setTint(p.color).setScale(S * p.r * 2 / 8);
    }
    for (; n < this.pool.length; n++) this.pool[n].setVisible(false);

    n = 0;
    for (const s of this.sparks) {
      const img = this.img(this.sparkPool, n++, true), k = s.life / s.max;
      img.setVisible(true).setPosition(s.x, s.y).setRotation(Math.atan2(s.vy, s.vx)).setTint(s.color).setAlpha(k)
        .setScale(S * (s.len * (0.4 + k)) / 8, S * 1.3 / 8 * 2);
    }
    for (; n < this.sparkPool.length; n++) this.sparkPool[n].setVisible(false);

    n = 0;
    for (const b of this.blobs) {
      const img = this.img(this.blobPool, n++, true), k = b.life / b.max;
      img.setVisible(true).setPosition(b.x, b.y).setTint(b.color).setAlpha(k).setScale(S * (b.size * (1.3 - 0.5 * k)) / 8);
    }
    for (; n < this.blobPool.length; n++) this.blobPool[n].setVisible(false);

    n = 0;
    for (const p of this.pops) {
      let t = this.popPool[n];
      if (!t) { t = this.scene.add.text(0, 0, '', textStyle(14, '#fff')).setOrigin(0.5); t.setShadow(0, 0, '#000', 4, true, true); this.parent.add(t); this.popPool.push(t); }
      n++;
      const k = p.life / p.max, grow = 1 + Math.max(0, k - 0.8) * 3;
      if (t.text !== p.text) t.setText(p.text);
      t.setVisible(true).setPosition(p.x, p.y).setColor(p.color).setFontSize(p.size).setAlpha(Math.min(1, k * 1.8)).setScale(grow);
    }
    for (; n < this.popPool.length; n++) this.popPool[n].setVisible(false);

    this.gfx.clear();
    for (const g of this.rings) {
      this.gfx.lineStyle(3 * g.a + 1, g.color, g.a);
      this.gfx.strokeCircle(g.x, g.y, g.r);
    }
  }
}
