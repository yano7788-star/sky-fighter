import Phaser from 'phaser';
import { H, W } from '../core/config';
import { textStyle } from '../render/hud';
import { R, buildStaticTextures } from '../render/textures';

const IMAGES = [
  'ally_cat', 'ally_dog', 'enemy_warship', 'enemy_scout', 'enemy_zigzag', 'enemy_kamikaze', 'enemy_drone', 'enemy_mine', 'enemy_turret', 'enemy_rock', 'midboss_2', 'midboss_3',
  'skill_card', 'skill_palm', 'player', 'player_skin2', 'player_skin3', 'pilot1', 'pilot2', 'bomb',
  'boss1', 'boss2', 'boss3', 'boss4', 'boss5', 'bg1', 'bg2', 'bg3', 'bg4', 'bg5', 'title_bg', 'logo',
  'overlay_clouds', 'gem', 'drone', 'item_P', 'item_M', 'item_E', 'item_B', 'item_G', 'item_L',
];

// 지상전 픽셀 아트 (PNG 팔레트 이미지, NEAREST 필터로 그린다) — tools/process-ground.cjs
export const GROUND_PNG = [
  'g_ace_f', 'g_ace_b', 'g_sis1_f', 'g_sis1_b', 'g_sis2_f', 'g_sis2_b', 'g_rifle', 'g_charger', 'g_sniper', 'g_turret', 'g_drone', 'g_tank', 'g_boss', 'g_floor', 'g_wall',
  'p2_walk0', 'p2_walk1', 'p2_walk2', 'p2_walk3', 'p2_fire0', 'p2_fire1', 'p2_pistol0', 'p2_pistol1', 'p2_corpse', 't2_atlas',
  'i_pistol', 'i_smg', 'i_shotgun', 'i_rail', 'i_grenade', 'i_medkit', 'i_ammo', 'i_crate', 'b2_0', 'b2_1', 'b2_2', 'b2_dmg1', 'b2_dmg2',
  'p_barrier', 'p_stack', 'p_crate', 'p_crates2', 'p_door', 'p_door2', 'p_dooropen', 'p_barrel', 'p_weapon', 'p_weapon2', 'p_pad',
];

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
    for (const name of IMAGES) this.load.image(name, `${name}.webp?v=${__BUILD__}`);
    for (const name of GROUND_PNG) this.load.image(name, `${name}.png?v=${__BUILD__}`);
    this.load.spritesheet('explosion', `explosion.webp?v=${__BUILD__}`, { frameWidth: 128, frameHeight: 128 });   // 13프레임 폭발 스프라이트
  }

  create(): void {
    buildStaticTextures(this);
    for (const name of GROUND_PNG) this.textures.get(name).setFilter(Phaser.Textures.FilterMode.NEAREST);   // 픽셀 아트: 보간 없이
    if (!this.anims.exists('explosion')) this.anims.create({ key: 'explosion', frames: this.anims.generateFrameNumbers('explosion', { start: 0, end: 12 }), frameRate: 28, repeat: 0 });
    this.scene.start('TitleScene');
  }
}
