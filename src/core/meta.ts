// 영구 성장(격납고): 런이 끝날 때 크레딧을 얻고, 크레딧으로 다음 런부터 적용되는 강화를 산다. (순수 규칙)
import { effectsOf, type MutatorEffects } from './mutators';
export interface MetaParams {
  energyBonus: number;   // 시작 최대 에너지 보너스
  startBombs: number;    // 시작 폭탄 추가
  xpMult: number;        // 경험치 배율
  luckMult: number;      // 드랍률 배율
  ultStart: number;      // 시작 필살 게이지
  rateMult: number;      // 연사 배율 (파일럿 패시브)
  dmgMult: number;       // 피해 배율 (파일럿 패시브)
  magnetMult: number;    // 젬·아이템 흡수 범위 배율 (파일럿 패시브)
  pilot: string;         // 선택한 파일럿 id (궁극기 종류 결정)
  mutator: string | null; // 이번 런의 모디파이어 id
  mut: MutatorEffects;   // 모디파이어 효과(배율)
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

// ---------------------------------------------------------------------------
// 파일럿 (자매) — 기체 스킨 + 패시브. 격납고 크레딧으로 해금
// ---------------------------------------------------------------------------
import type { UltKind } from './types';
export type PilotId = 'ace' | 'sister1' | 'sister2';
export interface PilotDef {
  id: PilotId; name: string; title: string;
  skin: string;        // 게임 중 기체 텍스처 키
  portrait: string;    // 선택 화면 초상화 텍스처 키
  cost: number;        // 해금 크레딧 (0이면 기본 제공)
  ult: UltKind;        // 파일럿 전용 궁극기
  passive: { energyBonus?: number; xpMult?: number; rateMult?: number; dmgMult?: number; magnetMult?: number };
  perks: string[];
}
export const PILOTS: PilotDef[] = [
  { id: 'ace', name: '에이스', title: '기본 기체', skin: 'player', portrait: 'player', cost: 0, ult: 'palm', passive: {},
    perks: ['특별한 능력은 없지만 가장 균형 잡힌 기체'] },
  { id: 'sister1', name: '언니', title: '공격형 · 블랙 레드', skin: 'player_skin2', portrait: 'pilot1', cost: 400, ult: 'barrage', passive: { rateMult: 1.15, dmgMult: 1.1 },
    perks: ['연사 속도 +15%', '모든 피해 +10%', '궁극기: 미사일 포격'] },
  { id: 'sister2', name: '동생', title: '성장형 · 화이트 골드', skin: 'player_skin3', portrait: 'pilot2', cost: 400, ult: 'timestop', passive: { energyBonus: 25, magnetMult: 1.3, xpMult: 1.1 },
    perks: ['시작 최대 에너지 +25', '젬·아이템 흡수 범위 +30%', '경험치 획득 +10%', '궁극기: 시간 정지'] },
];
export const pilotOf = (id: string): PilotDef => PILOTS.find(p => p.id === id) ?? PILOTS[0];

export function metaParams(levels: MetaLevels, pilot: PilotId | string = 'ace', mutator: string | null = null): MetaParams {
  const mut = effectsOf(mutator);
  const l = (id: MetaId) => levels[id] ?? 0;
  const p = pilotOf(pilot).passive;
  return {
    energyBonus: l('hull') * 10 + (p.energyBonus ?? 0), startBombs: l('munitions'),
    xpMult: (1 + l('intel') * 0.1) * (p.xpMult ?? 1) * mut.xp, luckMult: (1 + l('salvage') * 0.1) * mut.drop, ultStart: l('burst') * 20,
    rateMult: p.rateMult ?? 1, dmgMult: (p.dmgMult ?? 1) * mut.dmg, magnetMult: p.magnetMult ?? 1, pilot: pilotOf(pilot).id,
    mutator: mutator ?? null, mut,
  };
}
export const NO_META: MetaParams = metaParams({});

/** 런 결과 → 획득 크레딧 */
export const creditsFor = (score: number, stage: number, cleared: boolean): number =>
  Math.floor(score / 20) + stage * 30 + (cleared ? 300 : 0);
