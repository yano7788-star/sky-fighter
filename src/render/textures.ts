import Phaser from 'phaser';
import { BOSS_CONFIGS } from '../core/data';
import type { ItemType } from '../core/types';

/** 렌더 배율: 논리 좌표(450x800)를 R배 해상도로 그린다 → 고해상도/큰 화면에서도 선명 */
export const R = 2;
export const S = 1 / R;   // R배로 만든 생성 텍스처를 논리 크기로 되돌리는 스케일

type Draw = (ctx: CanvasRenderingContext2D) => void;

/** 논리 크기(w x h)로 그리면 R배 해상도 캔버스 텍스처가 만들어진다 */
export function makeTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: Draw): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, Math.ceil(w * R), Math.ceil(h * R));
  if (!tex) return;
  const ctx = tex.context;
  ctx.scale(R, R);
  draw(ctx);
  tex.refresh();
}

const ITEM_COLORS: Record<ItemType, string> = { P: '#10b981', M: '#ec4899', E: '#06b6d4', B: '#ef4444', S: '#3b82f6', G: '#a855f7', L: '#f43f5e' };

/** 부트 시 한 번 만드는 공용 텍스처 */
export function buildStaticTextures(scene: Phaser.Scene): void {
  makeTexture(scene, 'pbullet', 10, 10, c => { c.fillStyle = '#fde047'; c.beginPath(); c.arc(5, 5, 3.5, 0, Math.PI * 2); c.fill(); });
  makeTexture(scene, 'missile', 8, 20, c => {
    c.fillStyle = '#f43f5e'; c.fillRect(1.5, 5, 5, 14);
    c.fillStyle = '#fbcfe8'; c.fillRect(2.5, 3, 3, 4);
  });
  // 적 4종 (아래를 향함). 전용 스프라이트가 준비되면 이 임시 도형을 대체한다 (docs/ASSET_PROMPTS.md)
  makeTexture(scene, 'enemy_scout', 40, 34, c => {
    c.fillStyle = '#f43f5e'; c.beginPath(); c.moveTo(20, 32); c.lineTo(38, 4); c.lineTo(2, 4); c.closePath(); c.fill();
  });
  makeTexture(scene, 'enemy_zigzag', 40, 40, c => {   // 주황 육각 드론
    c.fillStyle = '#f97316'; c.strokeStyle = '#fed7aa'; c.lineWidth = 2; c.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (Math.PI / 3) * i; const x = 20 + Math.cos(a) * 17, y = 20 + Math.sin(a) * 17; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
    c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#fff7ed'; c.beginPath(); c.arc(20, 20, 5, 0, Math.PI * 2); c.fill();
  });
  makeTexture(scene, 'enemy_kamikaze', 32, 46, c => {   // 보라색 돌진 미사일 (붉은 코)
    c.fillStyle = '#7c3aed'; c.beginPath(); c.moveTo(16, 44); c.lineTo(30, 6); c.lineTo(16, 12); c.lineTo(2, 6); c.closePath(); c.fill();
    c.fillStyle = '#ef4444'; c.beginPath(); c.moveTo(16, 44); c.lineTo(22, 28); c.lineTo(10, 28); c.closePath(); c.fill();
  });
  makeTexture(scene, 'enemy_sniper', 46, 52, c => {   // 회청색 저격함 + 긴 포신
    c.fillStyle = '#475569'; c.beginPath(); c.moveTo(23, 30); c.lineTo(44, 8); c.lineTo(34, 4); c.lineTo(12, 4); c.lineTo(2, 8); c.closePath(); c.fill();
    c.fillStyle = '#94a3b8'; c.fillRect(20, 20, 6, 30);
    c.fillStyle = '#38bdf8'; c.beginPath(); c.arc(23, 14, 4, 0, Math.PI * 2); c.fill();
  });
  makeTexture(scene, 'dot', 8, 8, c => { c.fillStyle = '#fff'; c.beginPath(); c.arc(4, 4, 4, 0, Math.PI * 2); c.fill(); });
  makeTexture(scene, 'star', 6, 6, c => { c.fillStyle = '#fff'; c.beginPath(); c.arc(3, 3, 3, 0, Math.PI * 2); c.fill(); });
  for (const type of Object.keys(ITEM_COLORS) as ItemType[]) {
    makeTexture(scene, `item_${type}`, 26, 26, c => {
      c.fillStyle = ITEM_COLORS[type]; c.beginPath(); c.arc(13, 13, 12, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(type, 13, 13.5);
    });
  }
  for (let t = 1; t <= 5; t++) {
    const src = scene.textures.get(`boss${t}`).getSourceImage() as HTMLImageElement;
    outlinedBoss(scene, `boss${t}_n`, src, BOSS_CONFIGS[t].subColor, '#ffffff');
    outlinedBoss(scene, `boss${t}_p2`, src, '#f43f5e', '#ef4444');
  }
}

/** 적 탄환: 외곽 블랙 + 네온 바디 + 백색 코어 (색·반경 조합별로 한 번만 생성) */
export function bulletTexture(scene: Phaser.Scene, color: string, r: number): string {
  const key = `eb_${color}_${r}`;
  const size = (r + 1.8) * 2 + 2;
  makeTexture(scene, key, size, size, c => {
    const m = size / 2;
    c.fillStyle = 'rgba(0,0,0,0.9)'; c.beginPath(); c.arc(m, m, r + 1.8, 0, Math.PI * 2); c.fill();
    c.fillStyle = color; c.beginPath(); c.arc(m, m, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(m, m, Math.max(1.5, r * 0.45), 0, Math.PI * 2); c.fill();
  });
  return key;
}

/** 초고대비 보스 스프라이트 아웃라인: 단색 실루엣을 12방향으로 겹쳐 네온 테두리를 만든다 */
function outlinedBoss(scene: Phaser.Scene, key: string, src: HTMLImageElement, stroke: string, glow: string): void {
  if (scene.textures.exists(key)) return;
  const k = (src.width / 1024) * 1.5;   // 원본(1024px) 기준 값을 현재 스프라이트 크기에 맞춰 스케일
  const pad = Math.ceil(10 * k) + 2;
  const w = src.width + pad * 2, h = src.height + pad * 2;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const octx = tex.context;
  const sil = document.createElement('canvas'); sil.width = w; sil.height = h;
  const sctx = sil.getContext('2d')!;
  sctx.drawImage(src, pad, pad);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = stroke; sctx.fillRect(0, 0, w, h);
  octx.shadowColor = glow; octx.shadowBlur = 12 * k;
  const o = [[-2.5, 0], [2.5, 0], [0, -2.5], [0, 2.5], [-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8], [-3.2, 0], [3.2, 0], [0, -3.2], [0, 3.2]];
  for (const [ox, oy] of o) octx.drawImage(sil, ox * k, oy * k);
  octx.shadowBlur = 0;
  octx.drawImage(src, pad, pad);
  tex.refresh();
}

/** 이미지에서 투명하지 않은 영역의 중심(0~1 비율) — 폭탄 버튼의 숫자를 그림 중심에 맞추기 위해 사용 */
export function contentCenter(scene: Phaser.Scene, key: string): { x: number; y: number } {
  try {
    const src = scene.textures.get(key).getSourceImage() as HTMLImageElement;
    const w = src.width, h = src.height;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true })!;
    cx.drawImage(src, 0, 0);
    const d = cx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 40) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < 0) return { x: 0.5, y: 0.5 };
    return { x: (minX + maxX + 1) / 2 / w, y: (minY + maxY + 1) / 2 / h };
  } catch { return { x: 0.5, y: 0.5 }; }
}
