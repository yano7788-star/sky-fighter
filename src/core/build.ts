import type { Rng } from './rng';

/**
 * 런 중 성장(빌드) 시스템 — 레벨업 카드로 모듈을 강화하고, 조건을 만족하면 두 모듈을 "융합"해 진화시킨다.
 * (순수 데이터/규칙. Phaser 무관)
 */
export type ModuleId = 'spread' | 'pierce' | 'homing' | 'drone' | 'laser';
export type PassiveId = 'rate' | 'power' | 'magnet' | 'vitality' | 'scholar' | 'bombcap' | 'luck' | 'aegis';
export type FusionId = 'swarm' | 'railgun' | 'hunter';
export type CardId = ModuleId | PassiveId | FusionId;
export type CardKind = 'module' | 'passive' | 'fusion';

export interface CardDef {
  id: CardId;
  kind: CardKind;
  name: string;
  /** 현재 레벨(0이면 신규 획득) 기준으로, 이 카드를 고르면 얻는 효과 설명 */
  desc: (nextLevel: number) => string;
  max: number;
  weight: number;
  color: string;
  icon: string;
}

export const CARDS: Record<CardId, CardDef> = {
  // ---- 무기 모듈 (최대 4레벨) ----
  spread:  { id: 'spread',  kind: 'module', name: '산탄',      max: 4, weight: 10, color: '#fbbf24', icon: '⫷', desc: l => `옆으로 퍼지는 보조탄 +${l * 2}발` },
  pierce:  { id: 'pierce',  kind: 'module', name: '관통탄',    max: 4, weight: 10, color: '#f87171', icon: '➤', desc: l => `기본탄이 적 ${l}기 관통, 피해 +${l * 15}%` },
  homing:  { id: 'homing',  kind: 'module', name: '유도 미사일', max: 4, weight: 10, color: '#f472b6', icon: '✦', desc: l => `미사일 상시 발사 (주기 ${[0, 40, 30, 24, 18][l]}f)` },
  drone:   { id: 'drone',   kind: 'module', name: '위성 드론',  max: 4, weight: 9,  color: '#34d399', icon: '◎', desc: l => `기체 주위를 도는 드론 ${l}기가 함께 사격` },
  laser:   { id: 'laser',   kind: 'module', name: '관통 레이저', max: 4, weight: 8,  color: '#60a5fa', icon: '│', desc: l => `사격 중 전방 레이저 (폭 ${10 + l * 3}, 피해 상승)` },
  // ---- 패시브 ----
  rate:     { id: 'rate',     kind: 'passive', name: '연사 가속',   max: 5, weight: 8, color: '#fde047', icon: '»', desc: l => `연사 속도 +${l * 8}%` },
  power:    { id: 'power',    kind: 'passive', name: '화력 증폭',   max: 5, weight: 8, color: '#fb923c', icon: '▲', desc: l => `모든 피해 +${l * 12}%` },
  magnet:   { id: 'magnet',   kind: 'passive', name: '자력 코어',   max: 3, weight: 5, color: '#c084fc', icon: '◐', desc: l => `경험치·아이템 흡수 범위 +${l * 40}%` },
  vitality: { id: 'vitality', kind: 'passive', name: '강화 장갑',   max: 3, weight: 6, color: '#4ade80', icon: '✚', desc: l => `최대 에너지 +${l * 25} (즉시 25 회복)` },
  scholar:  { id: 'scholar',  kind: 'passive', name: '전술 분석',   max: 3, weight: 5, color: '#38bdf8', icon: '★', desc: l => `경험치 획득 +${l * 15}%` },
  bombcap:  { id: 'bombcap',  kind: 'passive', name: '폭탄 보급',   max: 2, weight: 4, color: '#ef4444', icon: '●', desc: l => `폭탄 최대 보유 +1 (총 ${2 + l}), 폭탄 1개 지급` },
  luck:     { id: 'luck',     kind: 'passive', name: '행운',        max: 3, weight: 4, color: '#facc15', icon: '♣', desc: l => `아이템 드랍률 +${l * 25}%` },
  aegis:    { id: 'aegis',    kind: 'passive', name: '자동 방벽',   max: 3, weight: 5, color: '#22d3ee', icon: '⬡', desc: l => `${[0, 28, 20, 14][l]}초마다 피격 1회를 막는 방벽 자동 생성` },
  // ---- 융합 (두 모듈이 3레벨 이상일 때 등장, 1회) ----
  swarm:   { id: 'swarm',   kind: 'fusion', name: '스웜 바라지',  max: 1, weight: 0, color: '#fb923c', icon: '❖', desc: () => '산탄 + 유도 융합: 보조탄이 적을 추적하고 피해 +40%' },
  railgun: { id: 'railgun', kind: 'fusion', name: '레일건',       max: 1, weight: 0, color: '#38bdf8', icon: '⟫', desc: () => '관통 + 레이저 융합: 레이저가 2배 굵어지고 피해 2배, 기본탄 관통 +2' },
  hunter:  { id: 'hunter',  kind: 'fusion', name: '헌터 스쿼드',  max: 1, weight: 0, color: '#a3e635', icon: '✹', desc: () => '유도 + 드론 융합: 드론이 유도 미사일을 발사' },
};

/** 융합 조건: 두 모듈이 모두 이 레벨 이상 */
export const FUSION_REQUIRE: Record<FusionId, { a: ModuleId; b: ModuleId; level: number }> = {
  swarm:   { a: 'spread', b: 'homing', level: 3 },
  railgun: { a: 'pierce', b: 'laser',  level: 3 },
  hunter:  { a: 'homing', b: 'drone',  level: 3 },
};

export interface Build {
  levels: Partial<Record<CardId, number>>;
}
export const newBuild = (): Build => ({ levels: {} });
export const lv = (b: Build, id: CardId): number => b.levels[id] ?? 0;
export const hasFusion = (b: Build, id: FusionId): boolean => lv(b, id) > 0;

export function fusionAvailable(b: Build, id: FusionId): boolean {
  const r = FUSION_REQUIRE[id];
  return !hasFusion(b, id) && lv(b, r.a) >= r.level && lv(b, r.b) >= r.level;
}

/**
 * 레벨업 카드 3장 제안. 융합이 가능하면 반드시 1장은 융합 카드. 최대 레벨인 카드는 제외.
 * 같은 카드는 중복 제안하지 않는다.
 */
export function offerCards(b: Build, rng: Rng, count = 3): CardId[] {
  const out: CardId[] = [];
  for (const id of Object.keys(FUSION_REQUIRE) as FusionId[]) {
    if (out.length < count && fusionAvailable(b, id)) out.push(id);
  }
  const pool = (Object.keys(CARDS) as CardId[]).filter(id => {
    const c = CARDS[id];
    return c.kind !== 'fusion' && lv(b, id) < c.max && !out.includes(id);
  });
  while (out.length < count && pool.length) {
    // 이미 가진 모듈을 더 강화하도록 약간 가중(빌드가 한 방향으로 쌓이는 맛)
    const weights = pool.map(id => CARDS[id].weight * (CARDS[id].kind === 'module' && lv(b, id) > 0 ? 1.4 : 1));
    const total = weights.reduce((a, c) => a + c, 0);
    let r = rng() * total, idx = 0;
    for (; idx < pool.length - 1; idx++) { r -= weights[idx]; if (r < 0) break; }
    out.push(pool[idx]); pool.splice(idx, 1);
  }
  return out;
}

/** 레벨 n → n+1 에 필요한 경험치 */
export const xpNeeded = (level: number): number => 55 + 30 * (level - 1);

/** 현재 빌드로부터 계산되는 전투 수치 (시뮬레이션이 매 틱 참조) */
export interface BuildStats {
  rateMult: number; dmgMult: number; magnetMult: number; xpMult: number; luckMult: number;
  spread: number; pierce: number; homing: number; drones: number; laser: number;
  swarm: boolean; railgun: boolean; hunter: boolean;
  bombCapBonus: number; aegisSeconds: number; maxEnergyBonus: number;
}
export function statsOf(b: Build, meta: { xpMult?: number } = {}): BuildStats {
  return {
    rateMult: 1 + 0.08 * lv(b, 'rate'),
    dmgMult: 1 + 0.12 * lv(b, 'power'),
    magnetMult: 1 + 0.4 * lv(b, 'magnet'),
    xpMult: (1 + 0.15 * lv(b, 'scholar')) * (meta.xpMult ?? 1),
    luckMult: 1 + 0.25 * lv(b, 'luck'),
    spread: lv(b, 'spread'), pierce: lv(b, 'pierce'), homing: lv(b, 'homing'), drones: lv(b, 'drone'), laser: lv(b, 'laser'),
    swarm: hasFusion(b, 'swarm'), railgun: hasFusion(b, 'railgun'), hunter: hasFusion(b, 'hunter'),
    bombCapBonus: lv(b, 'bombcap'),
    aegisSeconds: [0, 28, 20, 14][lv(b, 'aegis')] ?? 0,
    maxEnergyBonus: 25 * lv(b, 'vitality'),
  };
}
