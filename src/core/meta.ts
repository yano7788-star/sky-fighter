// 영구 성장(격납고): 런이 끝날 때 크레딧을 얻고, 크레딧으로 다음 런부터 적용되는 강화를 산다. (순수 규칙)
export interface MetaParams {
  energyBonus: number;   // 시작 최대 에너지 보너스
  startBombs: number;    // 시작 폭탄 추가
  xpMult: number;        // 경험치 배율
  luckMult: number;      // 드랍률 배율
  ultStart: number;      // 시작 필살 게이지
}
export type MetaId = 'hull' | 'munitions' | 'intel' | 'salvage' | 'burst';
export interface MetaUpgrade { id: MetaId; name: string; icon: string; max: number; desc: (lv: number) => string; cost: (lv: number) => number; }

export const META_UPGRADES: MetaUpgrade[] = [
  { id: 'hull',      name: '장갑 강화',   icon: '✚', max: 5, desc: l => `시작 최대 에너지 +${l * 10}`,        cost: l => 150 * (l + 1) },
  { id: 'munitions', name: '탄약 보급',   icon: '●', max: 2, desc: l => `시작 폭탄 +${l}`,                    cost: l => 400 * (l + 1) },
  { id: 'intel',     name: '전술 데이터', icon: '★', max: 5, desc: l => `경험치 획득 +${l * 10}%`,            cost: l => 120 * (l + 1) },
  { id: 'salvage',   name: '회수 장비',   icon: '♣', max: 5, desc: l => `아이템 드랍률 +${l * 10}%`,          cost: l => 120 * (l + 1) },
  { id: 'burst',     name: '버스트 코어', icon: '✋', max: 3, desc: l => `시작 필살 게이지 +${l * 20}`,        cost: l => 250 * (l + 1) },
];

export type MetaLevels = Partial<Record<MetaId, number>>;

export function metaParams(levels: MetaLevels): MetaParams {
  const l = (id: MetaId) => levels[id] ?? 0;
  return { energyBonus: l('hull') * 10, startBombs: l('munitions'), xpMult: 1 + l('intel') * 0.1, luckMult: 1 + l('salvage') * 0.1, ultStart: l('burst') * 20 };
}
export const NO_META: MetaParams = metaParams({});

/** 런 결과 → 획득 크레딧 */
export const creditsFor = (score: number, stage: number, cleared: boolean): number =>
  Math.floor(score / 20) + stage * 30 + (cleared ? 300 : 0);
