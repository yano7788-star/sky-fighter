import Phaser from 'phaser';
import { H, W } from '../core/config';
import { textStyle } from '../render/hud';
import { R, buildStaticTextures } from '../render/textures';

const IMAGES = ['ally_cat', 'ally_dog', 'enemy_warship', 'midboss', 'skill_card', 'skill_palm', 'player', 'bomb', 'boss1', 'boss2', 'boss3', 'boss4', 'boss5', 'bg1', 'bg2', 'bg3', 'bg4', 'bg5'];

/** 이미지 로딩 + 공용 텍스처 생성. 로딩 진행 바를 보여준다. */
export class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  preload(): void {
    const root = this.add.container(0, 0).setScale(R);
    const bw = Math.min(W * 0.6, 260), bx = (W - bw) / 2, by = H * 0.5;
    const track = this.add.rectangle(bx, by, bw, 8, 0x0f172a, 0.9).setOrigin(0, 0);
    const bar = this.add.rectangle(bx, by, 0, 8, 0x38bdf8).setOrigin(0, 0);
    const label = this.add.text(W / 2, by - 14, 'LOADING 0%', textStyle(13, '#cbd5e1')).setOrigin(0.5);
    root.add([track, bar, label]);
    this.load.on('progress', (p: number) => { bar.width = bw * p; label.setText(`LOADING ${Math.round(p * 100)}%`); });

    this.load.setPath('assets/img/');
    for (const name of IMAGES) this.load.image(name, `${name}.webp`);
  }

  create(): void {
    buildStaticTextures(this);
    this.scene.start('TitleScene');
  }
}
