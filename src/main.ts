import Phaser from 'phaser';
import { H, W } from './core/config';
import { R } from './render/textures';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { HangarScene } from './scenes/HangarScene';
import { PilotScene } from './scenes/PilotScene';
import { TitleScene } from './scenes/TitleScene';

// 논리 해상도 450x800(9:16)을 R배 해상도로 렌더링하고, 화면 크기에 맞춰 FIT으로 확대/축소한다
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#03050a',
  width: W * R,
  height: H * R,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  audio: { noAudio: true },                       // 오디오는 src/systems/audio.ts가 직접 관리
  input: { gamepad: true, activePointers: 3 },
  render: { antialias: true, roundPixels: false },
  scene: [BootScene, TitleScene, GameScene, HangarScene, PilotScene],
});

// 개발 중 브라우저 콘솔에서 상태를 확인할 수 있게 노출 (빌드에는 포함되지 않음)
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;

// 오프라인 플레이(PWA) — 개발 서버에서는 캐시가 방해되므로 빌드(production)에서만 등록
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => { /* 무시 */ }));
}
