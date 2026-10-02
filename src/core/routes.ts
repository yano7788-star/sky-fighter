import type { Rng } from './rng';

/** 스테이지 사이 항로 선택: 안전한 길 vs 위험한 길(점수 ↑). 다음 스테이지 동안만 적용된다 (순수 규칙) */
export type RouteId = 'r_calm' | 'r_supply' | 'r_risk' | 'r_ambush';

export interface RouteDef {
  id: RouteId; name: string; icon: string; color: string; desc: string; risky: boolean;
  spawn: number;    // 적 출현 빈도 배율
  bullet: number;   // 적 탄 속도 배율
  score: number;    // 처치 점수 배율
  xp: number;       // 경험치 배율
  drop: number;     // 아이템 드랍 배율
  hordes: 'normal' | 'none' | 'extra';   // 인해전술: 그대로 / 없음 / 1회 추가
  heal: number;     // 선택 즉시 회복 (최대 에너지 비율)
}

export const ROUTES: Record<RouteId, RouteDef> = {
  r_calm: {
    id: 'r_calm', name: '고요한 항로', icon: '🌤', color: '#67e8f9', risky: false,
    spawn: 0.9, bullet: 1, score: 0.9, xp: 0.85, drop: 1, hordes: 'none', heal: 0.1,
    desc: '적이 적고 대군이 없음\n에너지 10% 회복\n점수 ×0.9',
  },
  r_supply: {
    id: 'r_supply', name: '보급 항로', icon: '📦', color: '#4ade80', risky: false,
    spawn: 1, bullet: 1, score: 1, xp: 1, drop: 1.15, hordes: 'normal', heal: 0.05,
    desc: '아이템 드랍 ×1.15\n에너지 5% 회복',
  },
  r_risk: {
    id: 'r_risk', name: '위험 항로', icon: '🔥', color: '#f87171', risky: true,
    spawn: 1.2, bullet: 1.25, score: 1.5, xp: 1, drop: 1, hordes: 'normal', heal: 0,
    desc: '적 ×1.2 · 적 탄 +25%\n점수 ×1.5\n(보상은 점수뿐)',
  },
  r_ambush: {
    id: 'r_ambush', name: '매복 항로', icon: '☠', color: '#c084fc', risky: true,
    spawn: 1, bullet: 1, score: 1.35, xp: 1, drop: 1, hordes: 'extra', heal: 0,
    desc: '대군이 한 번 더 습격\n점수 ×1.35\n(보상은 점수뿐)',
  },
};

/** 안전한 항로 1개 + 위험한 항로 1개 (좌우 순서는 무작위) */
export function offerRoutes(rng: Rng): RouteId[] {
  const safe = (['r_calm', 'r_supply'] as RouteId[])[Math.floor(rng() * 2)];
  const risky = (['r_risk', 'r_ambush'] as RouteId[])[Math.floor(rng() * 2)];
  return rng() < 0.5 ? [safe, risky] : [risky, safe];
}
