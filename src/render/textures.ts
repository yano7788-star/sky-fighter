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

const ITEM_COLORS: Record<ItemType, string> = { P: '#10b981', M: '#ec4899', E: '#06b6d4', B: '#ef4444', G: '#a855f7', L: '#f43f5e', C: '#fb7185', D: '#fb923c' };

/** 부트 시 한 번 만드는 공용 텍스처 */
export function buildStaticTextures(scene: Phaser.Scene): void {
  buildSoftCard(scene);
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
    const ally = type === 'C' ? 'ally_cat' : type === 'D' ? 'ally_dog' : null;
    makeTexture(scene, `item_${type}`, 34, 34, c => {
      if (ally) {   // 동료 아이템: 어두운 원판 + 색 테두리 + 동료 얼굴
        c.fillStyle = 'rgba(15,23,42,0.92)'; c.beginPath(); c.arc(17, 17, 16, 0, Math.PI * 2); c.fill();
        c.lineWidth = 2.5; c.strokeStyle = ITEM_COLORS[type]; c.stroke();
        const img = scene.textures.get(ally).getSourceImage() as HTMLImageElement;
        const w = 24, h = (w * img.height) / img.width; c.drawImage(img, 17 - w / 2, 17 - h / 2, w, h);
      } else {
        c.fillStyle = ITEM_COLORS[type]; c.beginPath(); c.arc(17, 17, 12, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#fff'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(type, 17, 17.5);
      }
    });
  }
  // 경험치 젬 (청록 다이아몬드)
  makeTexture(scene, 'gem', 12, 14, c => {
    c.fillStyle = '#22d3ee'; c.strokeStyle = '#ecfeff'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(6, 1); c.lineTo(11, 7); c.lineTo(6, 13); c.lineTo(1, 7); c.closePath(); c.fill(); c.stroke();
  });
  // 비행기가 아닌 적들 (생성 텍스처)
  makeTexture(scene, 'enemy_drone', 26, 26, c => {   // 벌떼 드론: 붉은 눈의 작은 구체 + 날개
    c.fillStyle = '#7f1d1d'; c.strokeStyle = '#fca5a5'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(2, 8); c.lineTo(10, 13); c.lineTo(2, 18); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(24, 8); c.lineTo(16, 13); c.lineTo(24, 18); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#991b1b'; c.beginPath(); c.arc(13, 13, 7, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = '#fef08a'; c.beginPath(); c.arc(13, 13, 2.6, 0, Math.PI * 2); c.fill();
  });
  makeTexture(scene, 'enemy_mine', 44, 44, c => {   // 부유 기뢰: 가시 달린 구체
    c.strokeStyle = '#a16207'; c.lineWidth = 3;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; c.beginPath(); c.moveTo(22 + Math.cos(a) * 11, 22 + Math.sin(a) * 11); c.lineTo(22 + Math.cos(a) * 20, 22 + Math.sin(a) * 20); c.stroke(); }
    c.fillStyle = '#422006'; c.strokeStyle = '#facc15'; c.lineWidth = 2; c.beginPath(); c.arc(22, 22, 12, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = '#ef4444'; c.beginPath(); c.arc(22, 22, 4, 0, Math.PI * 2); c.fill();
  });
  makeTexture(scene, 'enemy_turret', 52, 52, c => {   // 지상 포대: 팔각 기단 + 세 갈래 포신
    c.fillStyle = '#334155'; c.strokeStyle = '#94a3b8'; c.lineWidth = 2;
    c.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; c.lineTo(26 + Math.cos(a) * 23, 26 + Math.sin(a) * 23); } c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#475569'; for (const dx of [-8, 0, 8]) c.fillRect(24 + dx, 26, 4, 22);
    c.fillStyle = '#1e293b'; c.strokeStyle = '#facc15'; c.beginPath(); c.arc(26, 24, 11, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = '#facc15'; c.beginPath(); c.arc(26, 24, 3.5, 0, Math.PI * 2); c.fill();
  });
  makeTexture(scene, 'enemy_rock', 58, 58, c => {   // 운석 괴수: 울퉁불퉁한 바위 + 갈라진 틈의 용암빛
    c.fillStyle = '#44403c'; c.strokeStyle = '#a8a29e'; c.lineWidth = 2;
    c.beginPath(); const pts = [[8, 22], [18, 6], [36, 4], [52, 16], [54, 38], [42, 54], [20, 52], [6, 40]];
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill(); c.stroke();
    c.strokeStyle = '#fb923c'; c.lineWidth = 2; c.beginPath(); c.moveTo(20, 14); c.lineTo(30, 28); c.lineTo(26, 40); c.moveTo(30, 28); c.lineTo(44, 30); c.stroke();
    c.fillStyle = '#fde68a'; c.beginPath(); c.arc(24, 26, 3, 0, Math.PI * 2); c.arc(36, 24, 3, 0, Math.PI * 2); c.fill();
  });
  makeTexture(scene, 'drone', 22, 22, c => {
    c.fillStyle = '#065f46'; c.strokeStyle = '#34d399'; c.lineWidth = 2; c.beginPath(); c.arc(11, 11, 8, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = '#a7f3d0'; c.beginPath(); c.arc(11, 11, 3, 0, Math.PI * 2); c.fill();
  });
  for (let t = 1; t <= 5; t++) {
    const src = scene.textures.get(`boss${t}`).getSourceImage() as HTMLImageElement;
    outlinedBoss(scene, `boss${t}_n`, src, BOSS_CONFIGS[t].subColor, '#ffffff');
    outlinedBoss(scene, `boss${t}_p2`, src, '#f43f5e', '#ef4444');
  }
}

/** 적 탄환: 외곽 블랙 + 네온 바디 + 백색 코어 (색·반경 조합별로 한 번만 생성) */
const bulletKeys = new Map<string, Map<number, string>>();   // 매 프레임 탄마다 문자열을 만들지 않도록 캐시
export function bulletTexture(scene: Phaser.Scene, color: string, r: number): string {
  let byR = bulletKeys.get(color); if (!byR) bulletKeys.set(color, byR = new Map());
  const cached = byR.get(r); if (cached && scene.textures.exists(cached)) return cached;
  const key = `eb_${color}_${r}`; byR.set(r, key);
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

/** 궁극기 컷인 카드: 모서리를 둥글게 + 가장자리를 부드럽게 페더링해서 화면에 자연스럽게 녹아들게 한다 */
export function buildSoftCard(scene: Phaser.Scene): void {
  if (scene.textures.exists('skill_card_soft') || !scene.textures.exists('skill_card')) return;
  const src = scene.textures.get('skill_card').getSourceImage() as HTMLImageElement;
  const w = src.width, h = src.height;
  const tex = scene.textures.createCanvas('skill_card_soft', w, h);
  if (!tex) return;
  const ctx = tex.context;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const r = 44, F = 38;   // 모서리 반경, 페더(흐림) 폭
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = Math.abs(x + 0.5 - w / 2) - (w / 2 - r), dy = Math.abs(y + 0.5 - h / 2) - (h / 2 - r);
    const sdf = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;   // 음수 = 안쪽
    let f = Math.max(0, Math.min(1, -sdf / F)); f = f * f * (3 - 2 * f);
    d[(y * w + x) * 4 + 3] = Math.round(d[(y * w + x) * 4 + 3] * f);
  }
  ctx.putImageData(img, 0, 0);
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
