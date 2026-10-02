import Phaser from 'phaser';
import { S } from './textures';

interface Particle { x: number; y: number; vx: number; vy: number; r: number; alpha: number; color: number; }
interface Ring { x: number; y: number; r: number; max: number; color: number; a: number; }

const MAX_PARTICLES = 700;
const hex = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;

/** 폭발 파티클 + 충격 링 (순수 연출 — 시뮬레이션 규칙과 무관) */
export class Fx {
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private pool: Phaser.GameObjects.Image[] = [];
  private gfx: Phaser.GameObjects.Graphics;
  private boomPool: Phaser.GameObjects.Sprite[] = [];

  constructor(private scene: Phaser.Scene, private parent: Phaser.GameObjects.Container) {
    this.gfx = scene.add.graphics();
    parent.add(this.gfx);
  }

  clear(): void { this.particles.length = 0; this.rings.length = 0; this.boomPool.forEach(b => { b.stop(); b.setVisible(false); }); }

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
  }

  render(): void {
    let n = 0;
    for (const p of this.particles) {
      let img = this.pool[n];
      if (!img) { img = this.scene.add.image(0, 0, 'dot'); this.parent.add(img); this.pool.push(img); }
      img.setVisible(true).setPosition(p.x, p.y).setAlpha(Math.max(0, p.alpha)).setTint(p.color).setScale(S * p.r * 2 / 8);
      n++;
    }
    for (; n < this.pool.length; n++) this.pool[n].setVisible(false);

    this.gfx.clear();
    for (const g of this.rings) {
      this.gfx.lineStyle(3 * g.a + 1, g.color, g.a);
      this.gfx.strokeCircle(g.x, g.y, g.r);
    }
  }
}
